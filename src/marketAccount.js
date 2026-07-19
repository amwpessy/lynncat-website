import { authenticateMarketRequest } from './marketAuth.js';
import { revokeAppleRefreshToken } from './marketCrypto.js';
import { classifyText } from './messages.js';

const MAX_NICKNAME_CHARACTERS = 14;
const DEFAULT_LEDGER_LIMIT = 20;
const MAX_LEDGER_LIMIT = 100;

export async function handleMarketAccount(request, env) {
  const url = new URL(request.url);
  if (url.pathname === '/markets/account') {
    if (request.method === 'GET') return handleMarketProfile(request, env);
    if (request.method === 'DELETE') return handleDeleteMarketAccount(request, env);
  }
  if (url.pathname === '/markets/account/profile') return handleMarketProfile(request, env);
  if (url.pathname === '/markets/leaderboard') return handleMarketLeaderboard(request, env);
  if (url.pathname === '/markets/points/ledger') return handlePointLedger(request, env);
  if (url.pathname === '/markets/auth/logout') return handleLogout(request, env);
  return json({ error: 'route_not_found' }, 404);
}

export async function handleMarketProfile(request, env) {
  try {
    if (request.method !== 'GET' && request.method !== 'PUT') {
      throw marketError('method_not_allowed', 405);
    }
    const principal = await authenticateMarketRequest(request, env);
    const repository = repositoryFor(env);
    let account;

    if (request.method === 'GET') {
      account = await repository.loadAccount(principal.userId);
    } else {
      const body = await parseJson(request);
      if (!body) throw marketError('invalid_json', 400);
      const updates = profileUpdates(body);
      account = await repository.updateProfile(principal.userId, updates, nowFor(env));
    }

    if (!account) throw marketError('account_unavailable', 404);
    return json({ account: toPublicAccount(account) });
  } catch (error) {
    return marketFailure(error);
  }
}

export async function handleMarketLeaderboard(request, env) {
  try {
    if (request.method !== 'GET') throw marketError('method_not_allowed', 405);
    const principal = await optionalPrincipal(request, env);
    const currentPublicId = principal?.publicId ?? null;
    const rows = await repositoryFor(env).loadLeaderboard(currentPublicId);
    const entries = rows
      .filter((row) => Number(row.rank) <= 100)
      .map((row) => toLeaderboardEntry(row, currentPublicId));
    const self = currentPublicId == null
      ? null
      : rows.find((row) => publicIdFor(row) === currentPublicId);
    return json({
      entries,
      me: self ? toLeaderboardEntry(self, currentPublicId) : null,
    });
  } catch (error) {
    return marketFailure(error);
  }
}

export async function handlePointLedger(request, env) {
  try {
    if (request.method !== 'GET') throw marketError('method_not_allowed', 405);
    const principal = await authenticateMarketRequest(request, env);
    const url = new URL(request.url);
    const limit = ledgerLimit(url.searchParams.get('limit'));
    const cursor = decodeLedgerCursor(url.searchParams.get('cursor'));
    const rows = await repositoryFor(env).loadPointLedger(principal.userId, {
      beforeCreatedAt: cursor?.createdAt,
      beforeId: cursor?.id,
      limit: limit + 1,
    });
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    return json({
      entries: page.map(toPublicLedgerEntry),
      nextCursor: rows.length > limit && last
        ? encodeLedgerCursor(createdAtFor(last), idFor(last))
        : null,
    });
  } catch (error) {
    return marketFailure(error);
  }
}

export async function handleLogout(request, env) {
  try {
    if (request.method !== 'POST') throw marketError('method_not_allowed', 405);
    const principal = await authenticateMarketRequest(request, env);
    await repositoryFor(env).revokeSession(principal.userId, principal.sessionId, nowFor(env));
    return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return marketFailure(error);
  }
}

export async function handleDeleteMarketAccount(request, env) {
  try {
    if (request.method !== 'DELETE') throw marketError('method_not_allowed', 405);
    const principal = await authenticateMarketRequest(request, env);
    const repository = repositoryFor(env);

    try {
      const stored = await repository.findAppleCredential(principal.userId);
      if (!stored?.encryptedRefreshToken) throw new Error('missing Apple credential');
      const decrypt = env?.DECRYPT_APPLE_CREDENTIAL || decryptAppleCredential;
      const credential = await decrypt(stored.encryptedRefreshToken, env);
      const revoke = env?.REVOKE_APPLE_REFRESH_TOKEN || revokeAppleRefreshToken;
      await revoke(credential.refreshToken, credential.clientId, env);
      await repository.deleteAccountData(principal.userId);
    } catch {
      throw marketError('account_deletion_retry', 503);
    }

    return new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return marketFailure(error);
  }
}

export function toPublicAccount(row) {
  return {
    id: publicIdFor(row),
    nickname: row.nickname,
    pointsBalance: Number(row.points_balance ?? row.pointsBalance),
    pointsEarnedTotal: Number(row.points_earned_total ?? row.pointsEarnedTotal),
    leaderboardVisible: Boolean(row.leaderboard_visible ?? row.leaderboardVisible),
  };
}

export async function decryptAppleCredential(encrypted, env) {
  try {
    const parts = String(encrypted || '').split('.');
    if (parts.length !== 3 || parts[0] !== 'v1') throw new Error('invalid envelope');
    const rawKey = decodeBase64Url(String(env?.APPLE_TOKEN_ENCRYPTION_KEY || '').trim());
    if (rawKey.byteLength !== 32) throw new Error('invalid key');
    const iv = decodeBase64Url(parts[1]);
    if (iv.byteLength !== 12) throw new Error('invalid iv');
    const key = await cryptoFor(env).subtle.importKey(
      'raw', rawKey, { name: 'AES-GCM' }, false, ['decrypt'],
    );
    const plaintext = await cryptoFor(env).subtle.decrypt(
      { name: 'AES-GCM', iv }, key, decodeBase64Url(parts[2]),
    );
    const credential = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plaintext));
    if (credential?.version !== 1
      || !isCredentialString(credential.refreshToken)
      || !isCredentialString(credential.clientId)) {
      throw new Error('invalid credential');
    }
    return {
      version: 1,
      refreshToken: credential.refreshToken,
      clientId: credential.clientId,
    };
  } catch {
    throw marketError('invalid_apple_credential', 400);
  }
}

function repositoryFor(env) {
  if (env?.MARKET_ACCOUNT_REPOSITORY) return env.MARKET_ACCOUNT_REPOSITORY;
  if (env?.MARKET_AUTH_REPOSITORY?.loadAccount) return env.MARKET_AUTH_REPOSITORY;
  if (env?.DB) return d1Repository(env.DB);
  throw marketError('account_storage_unavailable', 503);
}

function optionalPrincipal(request, env) {
  return request.headers.has('Authorization')
    ? authenticateMarketRequest(request, env)
    : null;
}

function d1Repository(db) {
  return {
    async loadAccount(userId) {
      return db.prepare(`
        SELECT public_id, nickname, points_balance, points_earned_total, leaderboard_visible
        FROM market_users WHERE id = ? AND status = 'active' LIMIT 1
      `).bind(userId).first();
    },

    async updateProfile(userId, updates, updatedAt) {
      await db.prepare(`
        UPDATE market_users
        SET nickname = COALESCE(?, nickname),
          leaderboard_visible = COALESCE(?, leaderboard_visible),
          updated_at = ?
        WHERE id = ? AND status = 'active'
      `).bind(
        updates.nickname ?? null,
        updates.leaderboardVisible == null ? null : (updates.leaderboardVisible ? 1 : 0),
        updatedAt,
        userId,
      ).run();
      return this.loadAccount(userId);
    },

    async loadLeaderboard(currentPublicId) {
      const result = await db.prepare(`
        WITH ranked AS (
          SELECT public_id, nickname, points_balance,
            ROW_NUMBER() OVER (
              ORDER BY points_balance DESC, balance_changed_at ASC, id ASC
            ) AS rank
          FROM market_users
          WHERE status = 'active' AND leaderboard_visible = 1
        )
        SELECT public_id, nickname, points_balance, rank
        FROM ranked
        WHERE rank <= 100 OR public_id = ?
        ORDER BY rank ASC
      `).bind(currentPublicId).all();
      return result.results || [];
    },

    async loadPointLedger(userId, { beforeCreatedAt, beforeId, limit }) {
      const hasCursor = beforeCreatedAt != null;
      const result = await db.prepare(`
        SELECT id, kind, amount, balance_after, created_at
        FROM market_point_ledger
        WHERE user_id = ?
          AND (? = 0 OR created_at < ? OR (created_at = ? AND id < ?))
        ORDER BY created_at DESC, id DESC
        LIMIT ?
      `).bind(
        userId,
        hasCursor ? 1 : 0,
        beforeCreatedAt ?? 0,
        beforeCreatedAt ?? 0,
        beforeId ?? '',
        limit,
      ).all();
      return result.results || [];
    },

    async revokeSession(userId, sessionId, revokedAt) {
      await db.prepare(`
        UPDATE market_user_sessions SET revoked_at = ?
        WHERE id = ? AND user_id = ? AND revoked_at IS NULL
      `).bind(revokedAt, sessionId, userId).run();
    },

    async findAppleCredential(userId) {
      const row = await db.prepare(`
        SELECT encrypted_refresh_token, token_key_version
        FROM market_apple_credentials WHERE user_id = ? LIMIT 1
      `).bind(userId).first();
      return row ? {
        encryptedRefreshToken: row.encrypted_refresh_token,
        tokenKeyVersion: Number(row.token_key_version),
      } : null;
    },

    async deleteAccountData(userId) {
      await db.batch([
        db.prepare(`
          DELETE FROM market_reports
          WHERE message_id IN (
            SELECT id FROM market_messages WHERE user_id = ? AND status = 'active'
          )
        `).bind(userId),
        db.prepare(
          `DELETE FROM market_messages WHERE user_id = ? AND status = 'active'`,
        ).bind(userId),
        db.prepare(`DELETE FROM market_user_sessions WHERE user_id = ?`).bind(userId),
        db.prepare(`DELETE FROM market_online_leases WHERE user_id = ?`).bind(userId),
        db.prepare(`DELETE FROM market_point_ledger WHERE user_id = ?`).bind(userId),
        db.prepare(`DELETE FROM market_user_devices WHERE user_id = ?`).bind(userId),
        db.prepare(`DELETE FROM market_apple_credentials WHERE user_id = ?`).bind(userId),
        db.prepare(`DELETE FROM market_users WHERE id = ?`).bind(userId),
      ]);
    },
  };
}

function profileUpdates(body) {
  const updates = {};
  if (Object.hasOwn(body, 'nickname')) updates.nickname = cleanNickname(body.nickname);
  if (Object.hasOwn(body, 'leaderboardVisible')) {
    if (typeof body.leaderboardVisible !== 'boolean') {
      throw marketError('invalid_leaderboard_visibility', 400);
    }
    updates.leaderboardVisible = body.leaderboardVisible;
  }
  if (Object.keys(updates).length === 0) throw marketError('invalid_profile', 400);
  return updates;
}

function cleanNickname(value) {
  if (typeof value !== 'string') throw marketError('nickname_rejected', 422);
  const nickname = value.normalize('NFKC').replace(/\s+/gu, ' ').trim();
  if (!nickname || Array.from(nickname).length > MAX_NICKNAME_CHARACTERS
    || /[\p{Cc}\p{Cf}]/u.test(nickname)) {
    throw marketError('nickname_rejected', 422);
  }
  const classified = classifyText(nickname);
  if (!classified.allowed) throw marketError('nickname_rejected', 422);
  return classified.text;
}

function ledgerLimit(value) {
  if (value == null || value === '') return DEFAULT_LEDGER_LIMIT;
  if (!/^\d+$/.test(value)) throw marketError('invalid_limit', 400);
  const limit = Number(value);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LEDGER_LIMIT) {
    throw marketError('invalid_limit', 400);
  }
  return limit;
}

function decodeLedgerCursor(value) {
  if (value == null || value === '') return null;
  try {
    const parsed = JSON.parse(new TextDecoder().decode(decodeBase64Url(value)));
    if (!Number.isSafeInteger(parsed?.createdAt) || parsed.createdAt < 0
      || typeof parsed?.id !== 'string' || !parsed.id || parsed.id.length > 200) {
      throw new Error('invalid cursor');
    }
    return parsed;
  } catch {
    throw marketError('invalid_cursor', 400);
  }
}

function encodeLedgerCursor(createdAt, id) {
  return encodeBase64Url(new TextEncoder().encode(JSON.stringify({ createdAt, id })));
}

function toLeaderboardEntry(row, currentPublicId) {
  const publicId = publicIdFor(row);
  return {
    rank: Number(row.rank),
    publicId,
    nickname: row.nickname,
    pointsBalance: Number(row.points_balance ?? row.pointsBalance),
    isCurrentUser: currentPublicId != null && publicId === currentPublicId,
  };
}

function toPublicLedgerEntry(row) {
  return {
    id: idFor(row),
    kind: row.kind,
    amount: Number(row.amount),
    balanceAfter: Number(row.balance_after ?? row.balanceAfter),
    createdAt: createdAtFor(row),
  };
}

function publicIdFor(row) {
  return row.public_id ?? row.publicId;
}

function idFor(row) {
  return row.id;
}

function createdAtFor(row) {
  return Number(row.created_at ?? row.createdAt);
}

async function parseJson(request) {
  try {
    const body = await request.json();
    return body && typeof body === 'object' && !Array.isArray(body) ? body : null;
  } catch {
    return null;
  }
}

function decodeBase64Url(value) {
  const input = String(value || '');
  if (!/^[A-Za-z0-9_-]*$/.test(input)) throw new Error('invalid base64url');
  const padded = input.replace(/-/g, '+').replace(/_/g, '/')
    + '='.repeat((4 - (input.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function encodeBase64Url(value) {
  let binary = '';
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function cryptoFor(env) {
  return env?.CRYPTO || globalThis.crypto;
}

function nowFor(env) {
  const candidate = typeof env?.NOW === 'function' ? env.NOW() : env?.NOW;
  return Number.isFinite(candidate) ? Number(candidate) : Date.now();
}

function isCredentialString(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 16_384;
}

function marketError(code, status) {
  return Object.assign(new Error(code), { code, status });
}

function marketFailure(error) {
  if (typeof error?.code === 'string' && Number.isInteger(error?.status)) {
    return json({ error: error.code }, error.status);
  }
  return json({ error: 'account_unavailable' }, 500);
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
