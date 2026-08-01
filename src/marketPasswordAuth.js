import { authenticateMarketRequest } from './marketAuth.js';

const PLATFORMS = new Set(['macos', 'ios', 'watchos', 'web']);
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const DEFAULT_PASSWORD_ITERATIONS = 100_000;
const MINIMUM_PASSWORD_ITERATIONS = 100_000;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_BLOCK_MS = 15 * 60 * 1000;
const MAX_LOGIN_FAILURES = 5;

export async function handleMarketPasswordAuth(request, env) {
  try {
    const url = new URL(request.url);
    if (request.method !== 'POST') throw marketError('method_not_allowed', 405);
    requireConfiguration(env);

    const body = await parseJson(request);
    if (!body) throw marketError('invalid_json', 400);
    const username = cleanUsername(body.username);
    const password = cleanPassword(body.password);
    if (!username) throw marketError('invalid_username', 422);
    if (!password) throw marketError('invalid_password', 422);

    if (url.pathname === '/markets/auth/password/link') {
      return await linkPasswordCredential(request, env, username, password);
    }

    const platform = cleanPlatform(body.platform);
    const installationId = cleanInstallationId(body.installationId);
    if (!platform) throw marketError('invalid_platform', 400);
    if (!installationId) throw marketError('invalid_installation_id', 400);

    if (url.pathname === '/markets/auth/password/register') {
      return await registerPasswordAccount(request, env, {
        username, password, platform, installationId,
      });
    }
    if (url.pathname === '/markets/auth/password/login') {
      return await loginWithPassword(request, env, {
        username, password, platform, installationId,
      });
    }
    throw marketError('route_not_found', 404);
  } catch (error) {
    if (typeof error?.code === 'string' && Number.isInteger(error?.status)) {
      return json({ error: error.code }, error.status);
    }
    console.error('market_password_auth_failed', {
      name: String(error?.name || 'Error').slice(0, 80),
      message: String(error?.message || 'Unknown error').slice(0, 240),
    });
    return json({ error: 'authentication_failed' }, 500);
  }
}

async function registerPasswordAccount(request, env, input) {
  const repository = repositoryFor(env);
  const usernameHash = await secretHash(env.LOGIN_IDENTIFIER_SALT, input.username, env);
  if (await repository.findPasswordCredential(usernameHash)) {
    throw marketError('username_unavailable', 409);
  }

  const now = nowFor(env);
  const passwordSalt = encodeBase64Url(randomBytes(24, env));
  const passwordIterations = passwordIterationsFor(env);
  const passwordHash = await derivePasswordHash(
    input.password, passwordSalt, passwordIterations, env,
  );
  const placeholderSubjectHash = await secretHash(
    env.APPLE_SUBJECT_HASH_SALT,
    `password-account:${encodeBase64Url(randomBytes(32, env))}`,
    env,
  );
  const user = {
    id: randomId('usr', env),
    publicId: randomId('pub', env),
    appleSubjectHash: placeholderSubjectHash,
    nickname: `LC ${input.username}`,
    pointsBalance: 0,
    pointsEarnedTotal: 0,
    leaderboardVisible: true,
    balanceChangedAt: now,
    status: 'active',
    createdAt: now,
    updatedAt: now,
  };
  const credential = {
    userId: user.id,
    usernameHash,
    passwordSalt,
    passwordHash,
    passwordIterations,
    updatedAt: now,
  };

  try {
    const created = await repository.createPasswordAccount({ user, credential });
    if (!created) throw marketError('username_unavailable', 409);
  } catch (error) {
    if (error?.code === 'username_unavailable') throw error;
    if (await repository.findPasswordCredential(usernameHash)) {
      throw marketError('username_unavailable', 409);
    }
    throw error;
  }

  const result = await issueSession(repository, user, input, env, now);
  return json(result, 201);
}

async function loginWithPassword(request, env, input) {
  const repository = repositoryFor(env);
  const usernameHash = await secretHash(env.LOGIN_IDENTIFIER_SALT, input.username, env);
  const attemptKey = await loginAttemptKey(request, usernameHash, env);
  const now = nowFor(env);
  const attempt = await repository.findPasswordAttempt(attemptKey);
  if (Number(attempt?.blockedUntil) > now) throw marketError('login_temporarily_locked', 429);

  const stored = await repository.findPasswordCredential(usernameHash);
  const dummySalt = encodeBase64Url(
    new Uint8Array((await cryptoFor(env).subtle.digest(
      'SHA-256', new TextEncoder().encode(`unknown:${usernameHash}`),
    )).slice(0, 24)),
  );
  const passwordMatches = await verifyPassword(
    input.password,
    stored?.passwordSalt || dummySalt,
    stored?.passwordIterations || passwordIterationsFor(env),
    stored?.passwordHash || '0'.repeat(64),
    env,
  );
  if (!stored?.user || stored.user.status !== 'active' || !passwordMatches) {
    await recordLoginFailure(repository, attemptKey, attempt, now);
    throw marketError('invalid_login', 401);
  }

  await repository.clearPasswordAttempt(attemptKey);
  const user = await restoreLegacyPasswordNickname(
    repository, stored.user, input.username, now,
  );
  const result = await issueSession(repository, user, input, env, now);
  return json(result);
}

async function linkPasswordCredential(request, env, username, password) {
  const principal = await authenticateMarketRequest(request, env);
  const repository = repositoryFor(env);
  const usernameHash = await secretHash(env.LOGIN_IDENTIFIER_SALT, username, env);
  const existing = await repository.findPasswordCredential(usernameHash);
  if (existing && existing.user?.id !== principal.userId) {
    throw marketError('username_unavailable', 409);
  }

  const now = nowFor(env);
  const passwordSalt = encodeBase64Url(randomBytes(24, env));
  const passwordIterations = passwordIterationsFor(env);
  const credential = {
    userId: principal.userId,
    usernameHash,
    passwordSalt,
    passwordHash: await derivePasswordHash(password, passwordSalt, passwordIterations, env),
    passwordIterations,
    updatedAt: now,
  };
  try {
    await repository.savePasswordCredential(credential);
  } catch (error) {
    const owner = await repository.findPasswordCredential(usernameHash);
    if (owner?.user?.id !== principal.userId) {
      throw marketError('username_unavailable', 409);
    }
    throw error;
  }
  return json({ linked: true });
}

async function issueSession(repository, user, input, env, now) {
  const installationHash = await secretHash(
    env.INSTALLATION_HASH_SALT, input.installationId, env,
  );
  let device = await repository.findDevice(user.id, installationHash);
  device = await repository.saveDevice(device ? {
    ...device,
    platform: input.platform,
    lastSeenAt: now,
    revokedAt: null,
  } : {
    id: randomId('dev', env),
    userId: user.id,
    installationHash,
    platform: input.platform,
    createdAt: now,
    lastSeenAt: now,
    revokedAt: null,
  });

  const sessionToken = encodeBase64Url(randomBytes(32, env));
  await repository.createSession({
    id: randomId('ses', env),
    userId: user.id,
    deviceId: device.id,
    tokenHash: await secretHash(env.SESSION_HASH_SALT, sessionToken, env),
    createdAt: now,
    lastUsedAt: now,
    expiresAt: now + positiveInteger(env.SESSION_TTL_MS, SESSION_TTL_MS),
    revokedAt: null,
  });
  return { sessionToken, account: publicAccount(user) };
}

async function recordLoginFailure(repository, attemptKey, previous, now) {
  const inWindow = previous && now - Number(previous.windowStartedAt) < LOGIN_WINDOW_MS;
  const attempts = inWindow ? Number(previous.attempts) + 1 : 1;
  await repository.savePasswordAttempt({
    attemptKeyHash: attemptKey,
    attempts,
    windowStartedAt: inWindow ? Number(previous.windowStartedAt) : now,
    blockedUntil: attempts >= MAX_LOGIN_FAILURES ? now + LOGIN_BLOCK_MS : null,
    updatedAt: now,
  });
}

async function loginAttemptKey(request, usernameHash, env) {
  const address = request.headers.get('CF-Connecting-IP') || 'unknown';
  return secretHash(env.LOGIN_RATE_LIMIT_SALT, `${address}:${usernameHash}`, env);
}

function repositoryFor(env) {
  if (env?.MARKET_PASSWORD_REPOSITORY) return env.MARKET_PASSWORD_REPOSITORY;
  if (env?.MARKET_AUTH_REPOSITORY?.findPasswordCredential) return env.MARKET_AUTH_REPOSITORY;
  if (env?.DB) return d1Repository(env.DB);
  throw marketError('account_storage_unavailable', 503);
}

function d1Repository(db) {
  return {
    async findPasswordCredential(usernameHash) {
      const row = await db.prepare(`
        SELECT c.user_id, c.username_hash, c.password_salt, c.password_hash,
          c.password_iterations, c.updated_at,
          u.id, u.public_id, u.apple_subject_hash, u.nickname, u.points_balance,
          u.points_earned_total, u.leaderboard_visible, u.balance_changed_at,
          u.status, u.created_at, u.updated_at AS user_updated_at
        FROM market_password_credentials c
        JOIN market_users u ON u.id = c.user_id
        WHERE c.username_hash = ? LIMIT 1
      `).bind(usernameHash).first();
      return row ? {
        userId: row.user_id,
        usernameHash: row.username_hash,
        passwordSalt: row.password_salt,
        passwordHash: row.password_hash,
        passwordIterations: Number(row.password_iterations),
        updatedAt: Number(row.updated_at),
        user: mapUser(row),
      } : null;
    },

    async createPasswordAccount({ user, credential }) {
      const results = await db.batch([
        db.prepare(`
          INSERT INTO market_users (
            id, public_id, apple_subject_hash, nickname, points_balance, points_earned_total,
            leaderboard_visible, balance_changed_at, status, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).bind(
          user.id, user.publicId, user.appleSubjectHash, user.nickname, user.pointsBalance,
          user.pointsEarnedTotal, user.leaderboardVisible ? 1 : 0, user.balanceChangedAt,
          user.status, user.createdAt, user.updatedAt,
        ),
        passwordCredentialStatement(db, credential),
      ]);
      return Number(results[0]?.meta?.changes) === 1
        && Number(results[1]?.meta?.changes) === 1;
    },

    async savePasswordCredential(credential) {
      await db.prepare(`
        INSERT INTO market_password_credentials (
          user_id, username_hash, password_salt, password_hash, password_iterations, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
          username_hash = excluded.username_hash,
          password_salt = excluded.password_salt,
          password_hash = excluded.password_hash,
          password_iterations = excluded.password_iterations,
          updated_at = excluded.updated_at
      `).bind(
        credential.userId, credential.usernameHash, credential.passwordSalt,
        credential.passwordHash, credential.passwordIterations, credential.updatedAt,
      ).run();
    },

    async restoreLegacyNickname(userId, currentNickname, fullNickname, updatedAt) {
      const result = await db.prepare(`
        UPDATE market_users
        SET nickname = ?, updated_at = ?
        WHERE id = ? AND nickname = ? AND status = 'active'
      `).bind(fullNickname, updatedAt, userId, currentNickname).run();
      return Number(result.meta?.changes) === 1;
    },

    async findDevice(userId, installationHash) {
      const row = await db.prepare(`
        SELECT id, user_id, installation_hash, platform, created_at, last_seen_at, revoked_at
        FROM market_user_devices WHERE user_id = ? AND installation_hash = ? LIMIT 1
      `).bind(userId, installationHash).first();
      return row ? mapDevice(row) : null;
    },

    async saveDevice(device) {
      await db.prepare(`
        INSERT INTO market_user_devices (
          id, user_id, installation_hash, platform, created_at, last_seen_at, revoked_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, installation_hash) DO UPDATE SET
          platform = excluded.platform, last_seen_at = excluded.last_seen_at, revoked_at = NULL
      `).bind(
        device.id, device.userId, device.installationHash, databasePlatformFor(device.platform),
        device.createdAt, device.lastSeenAt, device.revokedAt,
      ).run();
      return this.findDevice(device.userId, device.installationHash);
    },

    async createSession(session) {
      await db.prepare(`
        INSERT INTO market_user_sessions (
          id, user_id, device_id, token_hash, created_at, last_used_at, expires_at, revoked_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        session.id, session.userId, session.deviceId, session.tokenHash,
        session.createdAt, session.lastUsedAt, session.expiresAt, session.revokedAt,
      ).run();
      return session;
    },

    async findPasswordAttempt(attemptKeyHash) {
      const row = await db.prepare(`
        SELECT attempt_key_hash, attempts, window_started_at, blocked_until, updated_at
        FROM market_password_attempts WHERE attempt_key_hash = ? LIMIT 1
      `).bind(attemptKeyHash).first();
      return row ? {
        attemptKeyHash: row.attempt_key_hash,
        attempts: Number(row.attempts),
        windowStartedAt: Number(row.window_started_at),
        blockedUntil: row.blocked_until == null ? null : Number(row.blocked_until),
        updatedAt: Number(row.updated_at),
      } : null;
    },

    async savePasswordAttempt(attempt) {
      await db.prepare(`
        INSERT INTO market_password_attempts (
          attempt_key_hash, attempts, window_started_at, blocked_until, updated_at
        ) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(attempt_key_hash) DO UPDATE SET
          attempts = excluded.attempts,
          window_started_at = excluded.window_started_at,
          blocked_until = excluded.blocked_until,
          updated_at = excluded.updated_at
      `).bind(
        attempt.attemptKeyHash, attempt.attempts, attempt.windowStartedAt,
        attempt.blockedUntil, attempt.updatedAt,
      ).run();
    },

    async clearPasswordAttempt(attemptKeyHash) {
      await db.prepare(
        'DELETE FROM market_password_attempts WHERE attempt_key_hash = ?',
      ).bind(attemptKeyHash).run();
    },
  };
}

function passwordCredentialStatement(db, credential) {
  return db.prepare(`
    INSERT INTO market_password_credentials (
      user_id, username_hash, password_salt, password_hash, password_iterations, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).bind(
    credential.userId, credential.usernameHash, credential.passwordSalt,
    credential.passwordHash, credential.passwordIterations, credential.updatedAt,
  );
}

async function derivePasswordHash(password, passwordSalt, iterations, env) {
  const crypto = cryptoFor(env);
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(`${env.PASSWORD_PEPPER}:${password}`),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits({
    name: 'PBKDF2',
    hash: 'SHA-256',
    salt: decodeBase64Url(passwordSalt),
    iterations,
  }, key, 256);
  return bytesToHex(bits);
}

async function verifyPassword(password, salt, iterations, expectedHash, env) {
  const actual = await derivePasswordHash(password, salt, iterations, env);
  return constantTimeEqual(actual, expectedHash);
}

function constantTimeEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const length = Math.max(left.length, right.length);
  let difference = left.length ^ right.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (left.charCodeAt(index % Math.max(left.length, 1)) || 0)
      ^ (right.charCodeAt(index % Math.max(right.length, 1)) || 0);
  }
  return difference === 0;
}

function cleanUsername(value) {
  if (typeof value !== 'string') return '';
  const username = value.normalize('NFKC').trim().toLowerCase();
  return /^[a-z0-9][a-z0-9._-]{3,31}$/.test(username) ? username : '';
}

function cleanPassword(value) {
  if (typeof value !== 'string' || value.length < 8 || value.length > 128) return '';
  if (!/[A-Za-z]/.test(value) || !/[0-9]/.test(value)) return '';
  return value;
}

function cleanPlatform(value) {
  return typeof value === 'string' && PLATFORMS.has(value) ? value : '';
}

function cleanInstallationId(value) {
  if (typeof value !== 'string') return '';
  const cleaned = value.trim();
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(cleaned) ? cleaned : '';
}

function mapUser(row) {
  return {
    id: row.id,
    publicId: row.public_id,
    appleSubjectHash: row.apple_subject_hash,
    nickname: row.nickname,
    pointsBalance: Number(row.points_balance),
    pointsEarnedTotal: Number(row.points_earned_total),
    leaderboardVisible: Boolean(row.leaderboard_visible),
    balanceChangedAt: Number(row.balance_changed_at),
    status: row.status,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.user_updated_at),
  };
}

function mapDevice(row) {
  return {
    id: row.id,
    userId: row.user_id,
    installationHash: row.installation_hash,
    platform: row.platform,
    createdAt: Number(row.created_at),
    lastSeenAt: Number(row.last_seen_at),
    revokedAt: row.revoked_at == null ? null : Number(row.revoked_at),
  };
}

function publicAccount(user) {
  return {
    id: user.publicId,
    nickname: user.nickname,
    pointsBalance: Number(user.pointsBalance),
    pointsEarnedTotal: Number(user.pointsEarnedTotal),
    leaderboardVisible: Boolean(user.leaderboardVisible),
  };
}

// The production device table predates web login and currently constrains this
// column to the three native Apple platforms. Keep accepting "web" at the API
// boundary while storing it in the compatible desktop bucket so registration
// and login remain atomic without a risky live-table rebuild.
export function databasePlatformFor(platform) {
  return platform === 'web' ? 'macos' : platform;
}

async function restoreLegacyPasswordNickname(repository, user, username, now) {
  const legacyNickname = `LC ${username.slice(0, 6)}`;
  const fullNickname = `LC ${username}`;
  if (legacyNickname === fullNickname || user.nickname !== legacyNickname) return user;
  const restored = await repository.restoreLegacyNickname(
    user.id, legacyNickname, fullNickname, now,
  );
  return restored ? { ...user, nickname: fullNickname, updatedAt: now } : user;
}

function requireConfiguration(env) {
  for (const key of [
    'APPLE_SUBJECT_HASH_SALT', 'INSTALLATION_HASH_SALT', 'SESSION_HASH_SALT',
    'LOGIN_IDENTIFIER_SALT', 'LOGIN_RATE_LIMIT_SALT', 'PASSWORD_PEPPER',
  ]) {
    if (typeof env?.[key] !== 'string' || !env[key].trim()) {
      throw marketError('authentication_configuration_unavailable', 503);
    }
  }
}

function passwordIterationsFor(env) {
  const value = Number(env?.PASSWORD_HASH_ITERATIONS);
  if (Number.isSafeInteger(value) && value >= MINIMUM_PASSWORD_ITERATIONS) return value;
  return DEFAULT_PASSWORD_ITERATIONS;
}

async function parseJson(request) {
  try {
    const body = await request.json();
    return body && typeof body === 'object' && !Array.isArray(body) ? body : null;
  } catch {
    return null;
  }
}

function randomId(prefix, env) {
  return `${prefix}_${encodeBase64Url(randomBytes(16, env))}`;
}

function randomBytes(length, env) {
  if (typeof env?.RANDOM_BYTES === 'function') {
    const bytes = env.RANDOM_BYTES(length);
    if (bytes instanceof Uint8Array && bytes.byteLength === length) return bytes;
    throw marketError('authentication_configuration_unavailable', 503);
  }
  const bytes = new Uint8Array(length);
  cryptoFor(env).getRandomValues(bytes);
  return bytes;
}

async function secretHash(salt, value, env) {
  const digest = await cryptoFor(env).subtle.digest(
    'SHA-256', new TextEncoder().encode(`${salt}:${value}`),
  );
  return bytesToHex(digest);
}

function decodeBase64Url(value) {
  const input = String(value || '');
  if (!/^[A-Za-z0-9_-]+$/.test(input)) throw marketError('authentication_failed', 500);
  const padded = input.replace(/-/g, '+').replace(/_/g, '/')
    + '='.repeat((4 - (input.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function encodeBase64Url(value) {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function bytesToHex(value) {
  return Array.from(new Uint8Array(value), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function cryptoFor(env) {
  return env?.CRYPTO || globalThis.crypto;
}

function nowFor(env) {
  const candidate = typeof env?.NOW === 'function' ? env.NOW() : env?.NOW;
  return Number.isFinite(candidate) ? Number(candidate) : Date.now();
}

function positiveInteger(value, fallback) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : fallback;
}

function marketError(code, status) {
  return Object.assign(new Error(code), { code, status });
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}
