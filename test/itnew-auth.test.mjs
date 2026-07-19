import test from 'node:test';
import assert from 'node:assert/strict';

import {
  constantTimeEqual,
  handleLogin,
  handleLogout,
  requireAdmin,
  validateAdminMutation,
} from '../src/itnew/auth.js';

const now = Date.parse('2026-07-19T00:00:00Z');
const origin = 'https://itnew.test';
const synthetic = Object.freeze({
  username: 'synthetic-admin-user',
  password: 'synthetic-admin-password',
  sessionSecret: 'synthetic-session-signing-secret',
  ipPepper: 'synthetic-ip-hash-pepper',
  ip: '192.0.2.44',
});

function operationFrom(sql) {
  const match = /\/\*\s*itnew:([a-z_]+)\s*\*\//.exec(sql);
  if (!match) throw new Error(`AuthD1 received unsupported SQL: ${sql}`);
  return match[1];
}

class AuthD1Statement {
  constructor(db, sql, bindings = [], operation = null) {
    this.db = db;
    this.operation = operation ?? operationFrom(sql);
    this.bindings = bindings;
  }

  bind(...bindings) {
    this.db.history.push({ operation: this.operation, bindings: [...bindings] });
    return new AuthD1Statement(this.db, '', bindings, this.operation);
  }

  async first() {
    if (this.operation !== 'login_attempt_get') throw new Error(`Unsupported first: ${this.operation}`);
    const row = this.db.attempts.get(this.bindings[0]);
    return row ? { ...row } : null;
  }

  async run() {
    if (this.operation === 'login_attempt_upsert') {
      const [ip_hash, window_started_at, failure_count, locked_until] = this.bindings;
      this.db.attempts.set(ip_hash, { ip_hash, window_started_at, failure_count, locked_until });
      return { success: true, meta: { changes: 1 } };
    }
    if (this.operation === 'login_attempt_clear') {
      const changes = Number(this.db.attempts.delete(this.bindings[0]));
      return { success: true, meta: { changes } };
    }
    if (this.operation === 'audit_insert') {
      const [id, admin_id, action, target_type, target_id, batch_id, result, details_json, created_at]
        = this.bindings;
      this.db.audits.push({
        id, admin_id, action, target_type, target_id, batch_id, result, details_json, created_at,
      });
      return { success: true, meta: { changes: 1 } };
    }
    throw new Error(`Unsupported run: ${this.operation}`);
  }
}

class AuthD1 {
  constructor() {
    this.attempts = new Map();
    this.audits = [];
    this.history = [];
  }

  prepare(sql) {
    return new AuthD1Statement(this, sql);
  }
}

function env(overrides = {}) {
  return {
    ITNEW_ADMIN_USERNAME: synthetic.username,
    ITNEW_ADMIN_PASSWORD: synthetic.password,
    ITNEW_SESSION_SECRET: synthetic.sessionSecret,
    ITNEW_IP_PEPPER: synthetic.ipPepper,
    ITNEW_DB: new AuthD1(),
    ...overrides,
  };
}

function loginRequest({ username = synthetic.username, password = synthetic.password, ip = synthetic.ip } = {}) {
  return new Request(`${origin}/itnew/admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': ip },
    body: JSON.stringify({ username, password }),
  });
}

function cookieToken(response) {
  return /^itnew_admin_session=([^;]+)/.exec(response.headers.get('Set-Cookie'))?.[1];
}

function sessionRequest(token, {
  method = 'GET', requestOrigin = origin, csrf, headerOrigin,
} = {}) {
  const headers = { Cookie: `itnew_admin_session=${token}` };
  if (csrf !== undefined) headers['X-CSRF-Token'] = csrf;
  if (headerOrigin !== undefined) headers.Origin = headerOrigin;
  return new Request(`${requestOrigin}/itnew/admin/api`, { method, headers });
}

async function responseJson(response) {
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  return response.json();
}

async function expectAuthError(promise, code, status) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.code, code);
    assert.equal(error.status, status);
    return true;
  });
}

test('login returns no-store 503 when any administrator secret is missing', async () => {
  for (const key of [
    'ITNEW_ADMIN_USERNAME', 'ITNEW_ADMIN_PASSWORD', 'ITNEW_SESSION_SECRET', 'ITNEW_IP_PEPPER',
  ]) {
    const configured = env({ [key]: '' });
    const response = await handleLogin(loginRequest(), configured, now);
    assert.equal(response.status, 503, key);
    assert.deepEqual(await responseJson(response), { error: 'admin_not_configured' });
    assert.equal(configured.ITNEW_DB.history.length, 0);
  }
});

test('valid login issues the exact signed session contract and resets active failures', async () => {
  const configured = env();
  const failed = await handleLogin(loginRequest({ password: 'synthetic-wrong-password' }), configured, now);
  assert.equal(failed.status, 401);
  assert.equal(configured.ITNEW_DB.attempts.size, 1);

  const response = await handleLogin(loginRequest(), configured, now + 1_000);
  assert.equal(response.status, 200);
  const body = await responseJson(response);
  assert.equal(typeof body.csrf, 'string');
  assert.ok(body.csrf.length >= 32);
  assert.equal(JSON.stringify(body).includes(synthetic.password), false);

  const setCookie = response.headers.get('Set-Cookie');
  assert.match(setCookie, /^itnew_admin_session=[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+;/);
  for (const attribute of [
    'HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/itnew/admin', 'Max-Age=28800',
  ]) assert.ok(setCookie.includes(attribute), attribute);

  const [payloadPart, signaturePart] = cookieToken(response).split('.');
  assert.ok(signaturePart);
  const payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8'));
  assert.deepEqual(Object.keys(payload).sort(), ['csrf', 'exp', 'nonce', 'sub']);
  assert.equal(payload.sub, synthetic.username);
  assert.equal(payload.exp, Math.floor((now + 1_000) / 1000) + 28_800);
  assert.equal(payload.csrf, body.csrf);
  assert.equal(typeof payload.nonce, 'string');
  assert.ok(payload.nonce.length >= 32);
  assert.equal(configured.ITNEW_DB.attempts.size, 0);
});

test('invalid credentials compare both supplied fields and persist only the peppered IP digest', async () => {
  let usernameReads = 0;
  let passwordReads = 0;
  const configured = env({
    ITNEW_ADMIN_USERNAME: { toString() { usernameReads += 1; return synthetic.username; } },
    ITNEW_ADMIN_PASSWORD: { toString() { passwordReads += 1; return synthetic.password; } },
  });
  const response = await handleLogin(loginRequest({
    username: 'synthetic-wrong-user', password: 'synthetic-wrong-password',
  }), configured, now);
  assert.equal(response.status, 401);
  assert.deepEqual(await responseJson(response), { error: 'invalid_credentials' });
  assert.equal(usernameReads, 1);
  assert.equal(passwordReads, 1);
  assert.equal(constantTimeEqual('same-value', 'same-value'), true);
  assert.equal(constantTimeEqual('same-value', 'different-value'), false);
  assert.equal(constantTimeEqual('short', 'a-much-longer-value'), false);

  const expectedDigest = Buffer.from(await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(`${synthetic.ipPepper}:${synthetic.ip}`),
  )).toString('hex');
  assert.deepEqual([...configured.ITNEW_DB.attempts.keys()], [expectedDigest]);
  assert.equal(JSON.stringify(configured.ITNEW_DB.history).includes(synthetic.ip), false);
});

test('the fifth failure inside fifteen minutes locks the digest and returns Retry-After', async () => {
  const configured = env();
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const response = await handleLogin(
      loginRequest({ password: `synthetic-wrong-${attempt}` }),
      configured,
      now + (attempt - 1) * 1_000,
    );
    assert.equal(response.status, attempt < 5 ? 401 : 429, `attempt ${attempt}`);
    const body = await responseJson(response);
    assert.deepEqual(body, { error: attempt < 5 ? 'invalid_credentials' : 'rate_limited' });
    if (attempt === 5) assert.equal(response.headers.get('Retry-After'), '896');
  }
  const [row] = configured.ITNEW_DB.attempts.values();
  assert.equal(row.failure_count, 5);
  assert.equal(row.window_started_at, now);
  assert.equal(row.locked_until, now + 15 * 60 * 1000);

  const locked = await handleLogin(loginRequest(), configured, now + 5_000);
  assert.equal(locked.status, 429);
  assert.deepEqual(await responseJson(locked), { error: 'rate_limited' });
});

test('failure window expires after fifteen minutes and starts again at one', async () => {
  const configured = env();
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await handleLogin(loginRequest({ password: 'synthetic-wrong-password' }), configured, now + attempt);
  }
  const response = await handleLogin(
    loginRequest({ password: 'synthetic-wrong-password' }),
    configured,
    now + 15 * 60 * 1000,
  );
  assert.equal(response.status, 401);
  const [row] = configured.ITNEW_DB.attempts.values();
  assert.equal(row.failure_count, 1);
  assert.equal(row.window_started_at, now + 15 * 60 * 1000);
  assert.equal(row.locked_until, null);
});

test('expired and signature-tampered cookies are rejected with stable 401 errors', async () => {
  const configured = env();
  const login = await handleLogin(loginRequest(), configured, now);
  const token = cookieToken(login);

  await expectAuthError(
    requireAdmin(sessionRequest(token), configured, now + 28_800_001),
    'authentication_required',
    401,
  );

  const [payload, signature] = token.split('.');
  const tamperedSignature = `${signature.slice(0, -1)}${signature.endsWith('A') ? 'B' : 'A'}`;
  await expectAuthError(
    requireAdmin(sessionRequest(`${payload}.${tamperedSignature}`), configured, now),
    'authentication_required',
    401,
  );
});

test('POST PUT and DELETE require exact same Origin and matching CSRF before mutation', async () => {
  const configured = env();
  const login = await handleLogin(loginRequest(), configured, now);
  const { csrf } = await login.json();
  const token = cookieToken(login);

  for (const method of ['POST', 'PUT', 'DELETE']) {
    await expectAuthError(
      validateAdminMutation(sessionRequest(token, { method, headerOrigin: origin }), configured, now),
      'invalid_csrf',
      403,
    );
    await expectAuthError(
      validateAdminMutation(sessionRequest(token, {
        method, headerOrigin: origin, csrf: 'synthetic-wrong-csrf',
      }), configured, now),
      'invalid_csrf',
      403,
    );
    await expectAuthError(
      validateAdminMutation(sessionRequest(token, {
        method, headerOrigin: 'https://other.test', csrf,
      }), configured, now),
      'invalid_origin',
      403,
    );
    const session = await validateAdminMutation(sessionRequest(token, {
      method, headerOrigin: origin, csrf,
    }), configured, now);
    assert.equal(session.sub, synthetic.username);
  }
});

test('logout validates mutation before clearing the cookie and records a token-free audit', async () => {
  const configured = env();
  const login = await handleLogin(loginRequest(), configured, now);
  const { csrf } = await login.json();
  const token = cookieToken(login);

  const rejected = await handleLogout(sessionRequest(token, {
    method: 'POST', headerOrigin: origin, csrf: 'synthetic-wrong-csrf',
  }), configured, now);
  assert.equal(rejected.status, 403);
  assert.deepEqual(await responseJson(rejected), { error: 'invalid_csrf' });
  assert.equal(configured.ITNEW_DB.audits.length, 0);

  const response = await handleLogout(sessionRequest(token, {
    method: 'POST', headerOrigin: origin, csrf,
  }), configured, now + 1_000);
  assert.equal(response.status, 200);
  assert.deepEqual(await responseJson(response), { ok: true });
  const setCookie = response.headers.get('Set-Cookie');
  assert.match(setCookie, /^itnew_admin_session=;/);
  for (const attribute of [
    'HttpOnly', 'Secure', 'SameSite=Strict', 'Path=/itnew/admin', 'Max-Age=0',
  ]) assert.ok(setCookie.includes(attribute), attribute);

  assert.equal(configured.ITNEW_DB.audits.length, 1);
  const audit = configured.ITNEW_DB.audits[0];
  assert.equal(audit.admin_id, synthetic.username);
  assert.equal(audit.action, 'logout');
  assert.equal(audit.result, 'success');
  assert.equal(audit.details_json, null);
  assert.equal(JSON.stringify(audit).includes(token), false);
  for (const secret of [synthetic.password, synthetic.sessionSecret, synthetic.ipPepper]) {
    assert.equal(JSON.stringify(audit).includes(secret), false);
  }
});
