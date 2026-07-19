const SESSION_COOKIE = 'itnew_admin_session';
const SESSION_PATH = '/itnew/admin';
const SESSION_TTL_SECONDS = 8 * 60 * 60;
const FAILURE_WINDOW_MS = 15 * 60 * 1000;
const FAILURE_LIMIT = 5;
const encoder = new TextEncoder();

export class AuthError extends Error {
  constructor(code, status) {
    super(code);
    this.name = 'AuthError';
    this.code = code;
    this.status = status;
  }
}

function assertAdminSecrets(env) {
  for (const key of [
    'ITNEW_ADMIN_USERNAME',
    'ITNEW_ADMIN_PASSWORD',
    'ITNEW_SESSION_SECRET',
    'ITNEW_IP_PEPPER',
  ]) {
    if (!env?.[key]) throw new AuthError('admin_not_configured', 503);
  }
}

export function constantTimeEqual(left, right) {
  const leftBytes = encoder.encode(String(left));
  const rightBytes = encoder.encode(String(right));
  const length = Math.max(leftBytes.length, rightBytes.length);
  let mismatch = leftBytes.length ^ rightBytes.length;
  for (let index = 0; index < length; index += 1) {
    mismatch |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return mismatch === 0;
}

function bytesToBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

function base64UrlToBytes(value) {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) throw new Error('invalid_base64url');
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const binary = atob(value.replaceAll('-', '+').replaceAll('_', '/') + padding);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function hmac(payload, secret) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(String(secret)),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  return bytesToBase64Url(new Uint8Array(signature));
}

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function randomToken() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

async function createSessionToken(username, secret, now) {
  const session = {
    sub: String(username),
    exp: Math.floor(now / 1000) + SESSION_TTL_SECONDS,
    csrf: randomToken(),
    nonce: randomToken(),
  };
  const payload = bytesToBase64Url(encoder.encode(JSON.stringify(session)));
  return { session, token: `${payload}.${await hmac(payload, secret)}` };
}

async function verifySessionToken(token, secret, now) {
  if (typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const [payload, suppliedSignature] = parts;

  try {
    const expectedSignature = await hmac(payload, secret);
    if (!constantTimeEqual(suppliedSignature, expectedSignature)) return null;
    const session = JSON.parse(new TextDecoder().decode(base64UrlToBytes(payload)));
    if (!session || typeof session !== 'object' || Array.isArray(session)) return null;
    if (!constantTimeEqual(Object.keys(session).sort().join(','), 'csrf,exp,nonce,sub')) return null;
    if (
      typeof session.sub !== 'string'
      || typeof session.csrf !== 'string'
      || typeof session.nonce !== 'string'
      || !Number.isInteger(session.exp)
      || session.exp <= Math.floor(now / 1000)
    ) return null;
    return session;
  } catch {
    return null;
  }
}

function readCookie(request, name) {
  const cookieHeader = request.headers.get('Cookie') || '';
  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim();
  }
  return null;
}

function sessionCookie(token, maxAge) {
  return `${SESSION_COOKIE}=${token}; HttpOnly; Secure; SameSite=Strict; Path=${SESSION_PATH}; Max-Age=${maxAge}`;
}

function jsonResponse(body, status, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...headers,
    },
  });
}

function authErrorResponse(error) {
  return jsonResponse({ error: error.code }, error.status);
}

async function parseLoginBody(request) {
  try {
    const body = await request.json();
    return {
      username: typeof body?.username === 'string' ? body.username : '',
      password: typeof body?.password === 'string' ? body.password : '',
    };
  } catch {
    return { username: '', password: '' };
  }
}

async function ipDigest(request, pepper) {
  const ip = request.headers.get('CF-Connecting-IP') || '';
  return sha256Hex(`${String(pepper)}:${ip}`);
}

async function getLoginAttempt(db, digest) {
  return db.prepare(`
    /* itnew:login_attempt_get */
    SELECT ip_hash, window_started_at, failure_count, locked_until
    FROM itnew_login_attempts
    WHERE ip_hash = ?
  `).bind(digest).first();
}

async function registerLoginFailure(db, digest, now) {
  return db.prepare(`
    /* itnew:login_attempt_register_failure */
    INSERT INTO itnew_login_attempts (
      ip_hash, window_started_at, failure_count, locked_until
    ) VALUES (?1, ?2, 1, NULL)
    ON CONFLICT(ip_hash) DO UPDATE SET
      window_started_at = CASE
        WHEN itnew_login_attempts.locked_until > ?2
          THEN itnew_login_attempts.window_started_at
        WHEN ?2 - itnew_login_attempts.window_started_at >= ?3
          THEN ?2
        ELSE itnew_login_attempts.window_started_at
      END,
      failure_count = CASE
        WHEN itnew_login_attempts.locked_until > ?2
          THEN itnew_login_attempts.failure_count
        WHEN ?2 - itnew_login_attempts.window_started_at >= ?3
          THEN 1
        ELSE itnew_login_attempts.failure_count + 1
      END,
      locked_until = CASE
        WHEN itnew_login_attempts.locked_until > ?2
          THEN itnew_login_attempts.locked_until
        WHEN ?2 - itnew_login_attempts.window_started_at >= ?3
          THEN NULL
        WHEN itnew_login_attempts.failure_count + 1 >= ?4
          THEN itnew_login_attempts.window_started_at + ?3
        ELSE NULL
      END
    RETURNING ip_hash, window_started_at, failure_count, locked_until
  `).bind(digest, now, FAILURE_WINDOW_MS, FAILURE_LIMIT).first();
}

async function resetLoginAttempt(db, digest, now) {
  return db.prepare(`
    /* itnew:login_attempt_reset */
    INSERT INTO itnew_login_attempts (
      ip_hash, window_started_at, failure_count, locked_until
    ) VALUES (?, ?, 0, NULL)
    ON CONFLICT(ip_hash) DO UPDATE SET
      window_started_at = excluded.window_started_at,
      failure_count = 0,
      locked_until = NULL
  `).bind(digest, now).run();
}

function rateLimited(lockedUntil, now) {
  return jsonResponse(
    { error: 'rate_limited' },
    429,
    { 'Retry-After': String(Math.max(1, Math.ceil((lockedUntil - now) / 1000))) },
  );
}

export async function handleLogin(request, env, now = Date.now()) {
  try {
    assertAdminSecrets(env);
  } catch (error) {
    if (error instanceof AuthError) return authErrorResponse(error);
    throw error;
  }

  const credentials = await parseLoginBody(request);
  const usernameMatches = constantTimeEqual(credentials.username, env.ITNEW_ADMIN_USERNAME);
  const passwordMatches = constantTimeEqual(credentials.password, env.ITNEW_ADMIN_PASSWORD);
  const digest = await ipDigest(request, env.ITNEW_IP_PEPPER);
  const attempt = await getLoginAttempt(env.ITNEW_DB, digest);

  if (attempt?.locked_until > now) return rateLimited(attempt.locked_until, now);

  if (usernameMatches && passwordMatches) {
    await resetLoginAttempt(env.ITNEW_DB, digest, now);
    const { session, token } = await createSessionToken(env.ITNEW_ADMIN_USERNAME, env.ITNEW_SESSION_SECRET, now);
    return jsonResponse(
      { csrf: session.csrf },
      200,
      { 'Set-Cookie': sessionCookie(token, SESSION_TTL_SECONDS) },
    );
  }

  const registered = await registerLoginFailure(env.ITNEW_DB, digest, now);
  if (registered.locked_until > now) return rateLimited(registered.locked_until, now);
  return jsonResponse({ error: 'invalid_credentials' }, 401);
}

export async function requireAdmin(request, env, now = Date.now()) {
  assertAdminSecrets(env);
  const token = readCookie(request, SESSION_COOKIE);
  const session = await verifySessionToken(token, env.ITNEW_SESSION_SECRET, now);
  if (!session || !constantTimeEqual(session.sub, env.ITNEW_ADMIN_USERNAME)) {
    throw new AuthError('authentication_required', 401);
  }
  return session;
}

export async function validateAdminMutation(request, env, now = Date.now()) {
  const session = await requireAdmin(request, env, now);
  const requestUrl = new URL(request.url);
  if (request.headers.get('Origin') !== requestUrl.origin) {
    throw new AuthError('invalid_origin', 403);
  }
  if (!constantTimeEqual(request.headers.get('X-CSRF-Token') || '', session.csrf)) {
    throw new AuthError('invalid_csrf', 403);
  }
  return session;
}

async function recordLogout(db, session, now) {
  return db.prepare(`
    /* itnew:audit_insert */
    INSERT INTO itnew_audit_log (
      id, admin_id, action, target_type, target_id, batch_id,
      result, details_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    crypto.randomUUID(),
    session.sub,
    'logout',
    'admin_session',
    'self',
    null,
    'success',
    null,
    now,
  ).run();
}

export async function handleLogout(request, env, now = Date.now()) {
  try {
    const session = await validateAdminMutation(request, env, now);
    await recordLogout(env.ITNEW_DB, session, now);
    return jsonResponse(
      { ok: true },
      200,
      { 'Set-Cookie': sessionCookie('', 0) },
    );
  } catch (error) {
    if (error instanceof AuthError) return authErrorResponse(error);
    throw error;
  }
}
