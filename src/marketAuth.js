import {
  encryptRefreshToken,
  exchangeAppleAuthorizationCode,
  verifyAppleIdentityToken,
} from './marketCrypto.js';

const PLATFORMS = new Set(['macos', 'ios', 'watchos']);
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export async function handleMarketAuth(request, env) {
  try {
    const body = await parseJson(request);
    if (!body) throw marketError('invalid_json', 400);

    const platform = cleanPlatform(body.platform);
    const installationId = cleanInstallationId(body.installationId);
    const nonce = cleanNonce(body.nonce);
    const identityToken = cleanCredential(body.identityToken);
    const authorizationCode = cleanCredential(body.authorizationCode);
    if (!platform) throw marketError('invalid_platform', 400);
    if (!installationId) throw marketError('invalid_installation_id', 400);
    if (!nonce) throw marketError('invalid_nonce', 400);
    if (!identityToken || !authorizationCode) throw marketError('invalid_apple_credential', 400);
    requireHashConfiguration(env);

    const verifyIdentityToken = env?.VERIFY_APPLE_IDENTITY_TOKEN || verifyAppleIdentityToken;
    const exchangeAuthorizationCode = env?.EXCHANGE_APPLE_AUTHORIZATION_CODE || exchangeAppleAuthorizationCode;
    const sealRefreshToken = env?.ENCRYPT_REFRESH_TOKEN || encryptRefreshToken;
    const payload = await verifyIdentityToken(identityToken, nonce, env);
    const tokens = await exchangeAuthorizationCode(authorizationCode, payload.aud, env);
    if (!cleanCredential(tokens?.id_token)) throw marketError('invalid_apple_token', 401);
    const exchangedPayload = await verifyIdentityToken(tokens.id_token, nonce, env);
    if (exchangedPayload.sub !== payload.sub || exchangedPayload.aud !== payload.aud) {
      throw marketError('invalid_apple_token', 401);
    }
    const appleSubjectHash = await secretHash(env.APPLE_SUBJECT_HASH_SALT, payload.sub, env);
    const installationHash = await secretHash(env.INSTALLATION_HASH_SALT, installationId, env);
    const encryptedRefreshToken = await sealRefreshToken(tokens.refresh_token, env);
    const now = nowFor(env);
    const repository = repositoryFor(env);

    let user = await repository.findUserByAppleSubjectHash(appleSubjectHash);
    if (!user) {
      user = await repository.createUser({
        id: randomId('usr', env),
        publicId: randomId('pub', env),
        appleSubjectHash,
        nickname: anonymousNickname(appleSubjectHash),
        pointsBalance: 0,
        pointsEarnedTotal: 0,
        leaderboardVisible: true,
        balanceChangedAt: now,
        status: 'active',
        createdAt: now,
        updatedAt: now,
      });
    }
    if (!user || user.status !== 'active') throw marketError('account_unavailable', 403);

    await repository.saveAppleCredential({
      userId: user.id,
      encryptedRefreshToken,
      tokenKeyVersion: positiveInteger(env.APPLE_TOKEN_KEY_VERSION, 1),
      updatedAt: now,
    });

    let device = await repository.findDevice(user.id, installationHash);
    device = await repository.saveDevice(device ? {
      ...device,
      platform,
      lastSeenAt: now,
      revokedAt: null,
    } : {
      id: randomId('dev', env),
      userId: user.id,
      installationHash,
      platform,
      createdAt: now,
      lastSeenAt: now,
      revokedAt: null,
    });

    const sessionToken = encodeBase64Url(randomBytes(32, env));
    const session = await repository.createSession({
      id: randomId('ses', env),
      userId: user.id,
      deviceId: device.id,
      tokenHash: await secretHash(env.SESSION_HASH_SALT, sessionToken, env),
      createdAt: now,
      lastUsedAt: now,
      expiresAt: now + positiveInteger(env.SESSION_TTL_MS, SESSION_TTL_MS),
      revokedAt: null,
    });

    return json({ sessionToken, account: publicAccount(user) }, 201);
  } catch (error) {
    if (typeof error?.code === 'string' && Number.isInteger(error?.status)) {
      return json({ error: error.code }, error.status);
    }
    return json({ error: 'authentication_failed' }, 500);
  }
}

export async function authenticateMarketRequest(request, env) {
  if (!isConfiguredString(env?.SESSION_HASH_SALT)) {
    throw marketError('session_configuration_unavailable', 503);
  }
  const match = request.headers.get('Authorization')?.match(/^Bearer\s+([^\s]{8,512})$/i);
  if (!match) throw marketError('login_required', 401);

  const tokenHash = await secretHash(env.SESSION_HASH_SALT, match[1], env);
  const repository = repositoryFor(env);
  const session = await repository.findSessionByTokenHash(tokenHash);
  if (!session || !session.user || !session.device) throw marketError('login_required', 401);
  if (session.revokedAt != null || session.device.revokedAt != null) {
    throw marketError('session_revoked', 401);
  }
  const now = nowFor(env);
  if (!Number.isFinite(Number(session.expiresAt)) || Number(session.expiresAt) <= now) {
    throw marketError('session_expired', 401);
  }
  if (session.user.status !== 'active') throw marketError('account_unavailable', 403);

  await repository.touchSession(session.id, now);
  return {
    userId: session.user.id,
    publicId: session.user.publicId,
    deviceId: session.device.id,
    sessionId: session.id,
    nickname: session.user.nickname,
    pointsBalance: Number(session.user.pointsBalance),
  };
}

function repositoryFor(env) {
  if (env?.MARKET_AUTH_REPOSITORY) return env.MARKET_AUTH_REPOSITORY;
  if (env?.DB) return d1Repository(env.DB);
  throw marketError('account_storage_unavailable', 503);
}

function d1Repository(db) {
  return {
    async findUserByAppleSubjectHash(appleSubjectHash) {
      const row = await db.prepare(`
        SELECT id, public_id, apple_subject_hash, nickname, points_balance,
          points_earned_total, leaderboard_visible, balance_changed_at, status,
          created_at, updated_at
        FROM market_users WHERE apple_subject_hash = ? LIMIT 1
      `).bind(appleSubjectHash).first();
      return row ? mapUser(row) : null;
    },

    async createUser(user) {
      await db.prepare(`
        INSERT INTO market_users (
          id, public_id, apple_subject_hash, nickname, points_balance, points_earned_total,
          leaderboard_visible, balance_changed_at, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(apple_subject_hash) DO NOTHING
      `).bind(
        user.id, user.publicId, user.appleSubjectHash, user.nickname, user.pointsBalance,
        user.pointsEarnedTotal, user.leaderboardVisible ? 1 : 0, user.balanceChangedAt,
        user.status, user.createdAt, user.updatedAt,
      ).run();
      return this.findUserByAppleSubjectHash(user.appleSubjectHash);
    },

    async saveAppleCredential(credential) {
      await db.prepare(`
        INSERT INTO market_apple_credentials (user_id, encrypted_refresh_token, token_key_version, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
          encrypted_refresh_token = excluded.encrypted_refresh_token,
          token_key_version = excluded.token_key_version,
          updated_at = excluded.updated_at
      `).bind(
        credential.userId, credential.encryptedRefreshToken,
        credential.tokenKeyVersion, credential.updatedAt,
      ).run();
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
          platform = excluded.platform,
          last_seen_at = excluded.last_seen_at,
          revoked_at = NULL
      `).bind(
        device.id, device.userId, device.installationHash, device.platform,
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

    async findSessionByTokenHash(tokenHash) {
      const row = await db.prepare(`
        SELECT s.id AS session_id, s.user_id AS session_user_id, s.device_id AS session_device_id,
          s.token_hash, s.created_at AS session_created_at, s.last_used_at, s.expires_at,
          s.revoked_at AS session_revoked_at,
          u.id AS user_id, u.public_id, u.apple_subject_hash, u.nickname, u.points_balance,
          u.points_earned_total, u.leaderboard_visible, u.balance_changed_at, u.status,
          u.created_at AS user_created_at, u.updated_at AS user_updated_at,
          d.id AS device_id, d.user_id AS device_user_id, d.installation_hash, d.platform,
          d.created_at AS device_created_at, d.last_seen_at, d.revoked_at AS device_revoked_at
        FROM market_user_sessions s
        JOIN market_users u ON u.id = s.user_id
        JOIN market_user_devices d ON d.id = s.device_id
        WHERE s.token_hash = ? LIMIT 1
      `).bind(tokenHash).first();
      if (!row) return null;
      return {
        id: row.session_id,
        userId: row.session_user_id,
        deviceId: row.session_device_id,
        tokenHash: row.token_hash,
        createdAt: Number(row.session_created_at),
        lastUsedAt: Number(row.last_used_at),
        expiresAt: Number(row.expires_at),
        revokedAt: row.session_revoked_at == null ? null : Number(row.session_revoked_at),
        user: mapUser({
          id: row.user_id,
          public_id: row.public_id,
          apple_subject_hash: row.apple_subject_hash,
          nickname: row.nickname,
          points_balance: row.points_balance,
          points_earned_total: row.points_earned_total,
          leaderboard_visible: row.leaderboard_visible,
          balance_changed_at: row.balance_changed_at,
          status: row.status,
          created_at: row.user_created_at,
          updated_at: row.user_updated_at,
        }),
        device: mapDevice({
          id: row.device_id,
          user_id: row.device_user_id,
          installation_hash: row.installation_hash,
          platform: row.platform,
          created_at: row.device_created_at,
          last_seen_at: row.last_seen_at,
          revoked_at: row.device_revoked_at,
        }),
      };
    },

    async touchSession(sessionId, lastUsedAt) {
      await db.prepare(
        'UPDATE market_user_sessions SET last_used_at = ? WHERE id = ? AND revoked_at IS NULL',
      ).bind(lastUsedAt, sessionId).run();
    },
  };
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
    updatedAt: Number(row.updated_at),
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

function anonymousNickname(subjectHash) {
  const suffix = Number.parseInt(subjectHash.slice(0, 8), 16) % 10_000;
  return `Lynncat ${String(suffix).padStart(4, '0')}`;
}

async function secretHash(salt, value, env) {
  const digest = await cryptoFor(env).subtle.digest(
    'SHA-256', new TextEncoder().encode(`${salt}:${value}`),
  );
  return bytesToHex(digest);
}

function requireHashConfiguration(env) {
  for (const key of ['APPLE_SUBJECT_HASH_SALT', 'INSTALLATION_HASH_SALT', 'SESSION_HASH_SALT']) {
    if (!isConfiguredString(env?.[key])) throw marketError('authentication_configuration_unavailable', 503);
  }
}

function cleanPlatform(value) {
  return typeof value === 'string' && PLATFORMS.has(value) ? value : '';
}

function cleanInstallationId(value) {
  if (typeof value !== 'string') return '';
  const cleaned = value.trim();
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(cleaned) ? cleaned : '';
}

function cleanNonce(value) {
  if (typeof value !== 'string') return '';
  const cleaned = value.trim();
  return /^[A-Za-z0-9._~-]{8,256}$/.test(cleaned) ? cleaned : '';
}

function cleanCredential(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 16_384 ? value : '';
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

function isConfiguredString(value) {
  return typeof value === 'string' && value.trim().length > 0;
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
