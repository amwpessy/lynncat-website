import { authenticateMarketRequest } from './marketAuth.js';

export const HEARTBEAT_MIN_GAP_MS = 15_000;
export const HEARTBEAT_STALE_MS = 45_000;
export const CREDIT_SECONDS = 60;

export function nextLeaseState(lease, now) {
  if (!lease || now - lease.lastHeartbeatAt > HEARTBEAT_STALE_MS) {
    return { activeSeconds: 0, credited: false, reset: true };
  }
  const elapsed = now - lease.lastHeartbeatAt;
  if (elapsed < HEARTBEAT_MIN_GAP_MS) {
    return { activeSeconds: lease.activeSeconds, credited: false, reset: false };
  }
  const total = lease.activeSeconds + Math.min(30, Math.floor(elapsed / 1000));
  return {
    activeSeconds: total >= CREDIT_SECONDS ? total - CREDIT_SECONDS : total,
    credited: total >= CREDIT_SECONDS,
    reset: false,
  };
}

export async function handleMarketHeartbeat(request, env) {
  try {
    if (request.method !== 'POST') throw marketError('method_not_allowed', 405);
    const principal = await authenticateMarketRequest(request, env);
    const body = await parseJson(request);
    const expectedVersion = leaseVersion(body?.leaseVersion);
    const idempotencyKey = cleanIdempotencyKey(request.headers.get('Idempotency-Key'));
    if (expectedVersion == null) throw marketError('invalid_lease_version', 400);
    if (!idempotencyKey) throw marketError('invalid_idempotency_key', 400);

    const now = nowFor(env);
    const repository = repositoryFor(env);
    const state = await repository.loadPointState(principal.userId, principal.deviceId);
    const currentVersion = state.lease?.leaseVersion ?? 0;
    if (currentVersion !== expectedVersion) return heartbeatResponse(state, now, false);

    const next = nextLeaseState(state.lease, now);
    if (state.lease && !next.reset && now - state.lease.lastHeartbeatAt < HEARTBEAT_MIN_GAP_MS) {
      return heartbeatResponse(state, now, false);
    }

    const lease = {
      deviceId: principal.deviceId,
      userId: principal.userId,
      startedAt: state.lease && !next.reset ? state.lease.startedAt : now,
      lastHeartbeatAt: now,
      activeSeconds: next.activeSeconds,
      updatedAt: now,
    };
    const result = await repository.commitHeartbeat({
      userId: principal.userId,
      deviceId: principal.deviceId,
      expectedVersion,
      lease,
      credit: next.credited,
      idempotencyKey,
      now,
    });
    const freshState = await repository.loadPointState(principal.userId, principal.deviceId);
    return heartbeatResponse(freshState, now, result.credited);
  } catch (error) {
    return marketFailure(error);
  }
}

export async function handleMarketHeartbeatStop(request, env) {
  try {
    if (request.method !== 'POST') throw marketError('method_not_allowed', 405);
    const principal = await authenticateMarketRequest(request, env);
    const body = await parseJson(request);
    if (!body) throw marketError('invalid_json', 400);
    const expectedVersion = strictLeaseVersion(body.leaseVersion);
    if (expectedVersion == null) throw marketError('invalid_lease_version', 400);

    const now = nowFor(env);
    const repository = repositoryFor(env);
    await repository.stopLease({
      userId: principal.userId,
      deviceId: principal.deviceId,
      expectedVersion,
    });
    const state = await repository.loadPointState(principal.userId, principal.deviceId);
    return heartbeatResponse(state, now, false);
  } catch (error) {
    return marketFailure(error);
  }
}

function heartbeatResponse(state, serverTime, credited) {
  const lease = state.lease;
  const activeSeconds = Number(lease?.activeSeconds ?? 0);
  return json({
    credited,
    pointsBalance: Number(state.user?.pointsBalance ?? 0),
    activeSeconds,
    leaseVersion: Number(lease?.leaseVersion ?? 0),
    serverTime,
    nextCreditAt: lease
      ? lease.lastHeartbeatAt + Math.max(0, CREDIT_SECONDS - activeSeconds) * 1000
      : null,
  });
}

function repositoryFor(env) {
  if (env?.MARKET_POINTS_REPOSITORY) return env.MARKET_POINTS_REPOSITORY;
  if (env?.MARKET_AUTH_REPOSITORY?.loadPointState) return env.MARKET_AUTH_REPOSITORY;
  if (env?.DB) return d1Repository(env.DB);
  throw marketError('account_storage_unavailable', 503);
}

function d1Repository(db) {
  return {
    async loadPointState(userId, deviceId) {
      const [user, lease] = await db.batch([
        db.prepare(`
          SELECT id, points_balance
          FROM market_users WHERE id = ? LIMIT 1
        `).bind(userId),
        db.prepare(`
          SELECT device_id, user_id, started_at, last_heartbeat_at, active_seconds, lease_version, updated_at
          FROM market_online_leases WHERE device_id = ? AND user_id = ? LIMIT 1
        `).bind(deviceId, userId),
      ]);
      return { user: mapUser(user.results?.[0]), lease: mapLease(lease.results?.[0]) };
    },

    async commitHeartbeat({ userId, deviceId, expectedVersion, lease, credit, idempotencyKey, now }) {
      let leaseMutation;
      if (expectedVersion === 0 && credit) {
        leaseMutation = db.prepare(`
          INSERT INTO market_online_leases (
            device_id, user_id, started_at, last_heartbeat_at, active_seconds, lease_version, updated_at
          )
          SELECT ?, ?, ?, ?, ?, 1, ?
          WHERE NOT EXISTS (
            SELECT 1 FROM market_point_ledger WHERE idempotency_key = ?
          )
          ON CONFLICT(device_id) DO NOTHING
        `).bind(
          deviceId, userId, lease.startedAt, lease.lastHeartbeatAt, lease.activeSeconds, lease.updatedAt,
          idempotencyKey,
        );
      } else if (expectedVersion === 0) {
        leaseMutation = db.prepare(`
          INSERT INTO market_online_leases (
            device_id, user_id, started_at, last_heartbeat_at, active_seconds, lease_version, updated_at
          ) VALUES (?, ?, ?, ?, ?, 1, ?)
          ON CONFLICT(device_id) DO NOTHING
        `).bind(
          deviceId, userId, lease.startedAt, lease.lastHeartbeatAt, lease.activeSeconds, lease.updatedAt,
        );
      } else {
        const idempotencyGuard = credit ? `
            AND NOT EXISTS (
              SELECT 1 FROM market_point_ledger WHERE idempotency_key = ?
            )` : '';
        const bindings = [
          lease.lastHeartbeatAt, lease.activeSeconds, lease.updatedAt, deviceId, userId, expectedVersion,
        ];
        if (credit) bindings.push(idempotencyKey);
        leaseMutation = db.prepare(`
          UPDATE market_online_leases
          SET last_heartbeat_at = ?, active_seconds = ?, lease_version = lease_version + 1, updated_at = ?
          WHERE device_id = ? AND user_id = ? AND lease_version = ?${idempotencyGuard}
        `).bind(...bindings);
      }

      if (!credit) {
        const [leaseResult] = await db.batch([leaseMutation]);
        return { updated: Number(leaseResult.meta?.changes) === 1, credited: false };
      }

      const ledgerId = randomId('ledger');
      const [leaseResult, ledgerResult] = await db.batch([
        leaseMutation,
        db.prepare(`
          INSERT INTO market_point_ledger (
            id, user_id, device_id, kind, amount, balance_after,
            reference_type, reference_id, idempotency_key, created_at
          )
          SELECT ?, ?, ?, 'online_credit', 1, points_balance + 1,
            'foreground_lease', ?, ?, ?
          FROM market_users WHERE id = ? AND changes() = 1
          ON CONFLICT(idempotency_key) DO NOTHING
        `).bind(ledgerId, userId, deviceId, deviceId, idempotencyKey, now, userId),
        db.prepare(`
          UPDATE market_users
          SET points_balance = points_balance + 1,
            points_earned_total = points_earned_total + 1,
            balance_changed_at = ?, updated_at = ?
          WHERE id = ? AND changes() = 1
        `).bind(now, now, userId),
      ]);
      return {
        updated: Number(leaseResult.meta?.changes) === 1,
        credited: Number(ledgerResult.meta?.changes) === 1,
      };
    },

    async stopLease({ userId, deviceId, expectedVersion }) {
      if (strictLeaseVersion(expectedVersion) == null) return { removed: false };
      const statement = db.prepare(`
        DELETE FROM market_online_leases
        WHERE device_id = ? AND user_id = ? AND lease_version = ?
      `).bind(deviceId, userId, expectedVersion);
      const result = await statement.run();
      return { removed: Number(result.meta?.changes) === 1 };
    },
  };
}

function mapUser(row) {
  return row ? { id: row.id, pointsBalance: Number(row.points_balance) } : null;
}

function mapLease(row) {
  if (!row) return null;
  return {
    deviceId: row.device_id,
    userId: row.user_id,
    startedAt: Number(row.started_at),
    lastHeartbeatAt: Number(row.last_heartbeat_at),
    activeSeconds: Number(row.active_seconds),
    leaseVersion: Number(row.lease_version),
    updatedAt: Number(row.updated_at),
  };
}

function leaseVersion(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

function strictLeaseVersion(value) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function cleanIdempotencyKey(value) {
  if (typeof value !== 'string') return '';
  const key = value.trim();
  return /^[A-Za-z0-9._:-]{1,200}$/.test(key) ? key : '';
}

async function parseJson(request) {
  try {
    const body = await request.json();
    return body && typeof body === 'object' && !Array.isArray(body) ? body : null;
  } catch {
    return null;
  }
}

function nowFor(env) {
  const candidate = typeof env?.NOW === 'function' ? env.NOW() : env?.NOW;
  return Number.isFinite(candidate) ? Number(candidate) : Date.now();
}

function randomId(prefix) {
  return `${prefix}_${crypto.randomUUID()}`;
}

function marketError(code, status) {
  return Object.assign(new Error(code), { code, status });
}

function marketFailure(error) {
  if (typeof error?.code === 'string' && Number.isInteger(error?.status)) {
    return json({ error: error.code }, error.status);
  }
  return json({ error: 'points_unavailable' }, 500);
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
