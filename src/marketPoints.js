import { authenticateMarketRequest } from './marketAuth.js';

export const HEARTBEAT_MIN_GAP_MS = 15_000;
export const HEARTBEAT_STALE_MS = 45_000;
export const CREDIT_SECONDS = 60;
export const POKER_DAILY_WIN_LIMIT = 7_500;
export const SHUIHU_DRAW_COST = 1_000;
export const SHUIHU_DAILY_DRAW_LIMIT = 10;
export const SHUIHU_CARD_COUNT = 108;
export const SHUIHU_COMPLETION_REWARD = 1_000_000;
const CHINA_UTC_OFFSET_MS = 8 * 60 * 60 * 1_000;

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
    if (!body) throw marketError('invalid_json', 400);
    const expectedVersion = strictLeaseVersion(body.leaseVersion);
    const idempotencyKey = cleanIdempotencyKey(request.headers.get('Idempotency-Key'));
    if (expectedVersion == null) throw marketError('invalid_lease_version', 400);
    if (!idempotencyKey) throw marketError('invalid_idempotency_key', 400);

    const now = nowFor(env);
    const repository = repositoryFor(env);
    const state = await repository.loadPointState(principal.userId, principal.deviceId);
    const currentVersion = state.lease?.leaseVersion ?? 0;
    if (currentVersion !== expectedVersion) {
      return heartbeatResponse(normalizeStaleConflictState(state, now), now, false);
    }

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

export function pokerDayWindow(now) {
  const shifted = new Date(now + CHINA_UTC_OFFSET_MS);
  const year = shifted.getUTCFullYear();
  const month = shifted.getUTCMonth();
  const day = shifted.getUTCDate();
  const dayKey = [
    year,
    String(month + 1).padStart(2, '0'),
    String(day).padStart(2, '0'),
  ].join('-');
  const dayStart = Date.UTC(year, month, day) - CHINA_UTC_OFFSET_MS;
  const resetsAt = Date.UTC(year, month, day + 1) - CHINA_UTC_OFFSET_MS;
  return { dayKey, dayStart, dayEnd: resetsAt, resetsAt };
}

export async function handleMarketPokerStatus(request, env) {
  try {
    if (request.method !== 'GET') throw marketError('method_not_allowed', 405);
    const principal = await authenticateMarketRequest(request, env);
    const window = pokerDayWindow(nowFor(env));
    const state = await repositoryFor(env).loadPokerStatus({
      userId: principal.userId,
      ...window,
    });
    if (!state?.user) throw marketError('account_not_found', 404);
    return pokerStatusResponse(state, window);
  } catch (error) {
    return marketFailure(error);
  }
}

export async function handleMarketPokerSettlement(request, env) {
  try {
    if (request.method !== 'POST') throw marketError('method_not_allowed', 405);
    const principal = await authenticateMarketRequest(request, env);
    const body = await parseJson(request);
    if (!body) throw marketError('invalid_json', 400);
    const handId = cleanHandId(body.handId);
    const requestedDelta = strictPointDelta(body.delta);
    const idempotencyKey = cleanIdempotencyKey(request.headers.get('Idempotency-Key'));
    if (!handId) throw marketError('invalid_hand_id', 400);
    if (requestedDelta == null) throw marketError('invalid_hand_delta', 400);
    if (!idempotencyKey) throw marketError('invalid_idempotency_key', 400);

    const now = nowFor(env);
    const window = pokerDayWindow(now);
    const settlement = await repositoryFor(env).settlePokerHand({
      userId: principal.userId,
      deviceId: principal.deviceId,
      handId,
      requestedDelta,
      idempotencyKey,
      now,
      dailyLimit: POKER_DAILY_WIN_LIMIT,
      ...window,
    });
    if (!settlement) throw marketError('poker_settlement_unavailable', 503);
    return json({ settlement: pokerSettlementPayload(settlement, window) });
  } catch (error) {
    return marketFailure(error);
  }
}

export async function handleMarketShuihuStatus(request, env) {
  try {
    if (request.method !== 'GET') throw marketError('method_not_allowed', 405);
    const principal = await authenticateMarketRequest(request, env);
    const window = pokerDayWindow(nowFor(env));
    const state = await repositoryFor(env).loadShuihuStatus({
      userId: principal.userId,
      ...window,
    });
    if (!state?.user) throw marketError('account_not_found', 404);
    return json({ cards: shuihuStatusPayload(state, window) });
  } catch (error) {
    return marketFailure(error);
  }
}

export async function handleMarketShuihuDraw(request, env) {
  try {
    if (request.method !== 'POST') throw marketError('method_not_allowed', 405);
    const principal = await authenticateMarketRequest(request, env);
    const idempotencyKey = cleanIdempotencyKey(request.headers.get('Idempotency-Key'));
    if (!idempotencyKey) throw marketError('invalid_idempotency_key', 400);

    const now = nowFor(env);
    const window = pokerDayWindow(now);
    const repository = repositoryFor(env);
    const result = await repository.drawShuihuCard({
      userId: principal.userId,
      deviceId: principal.deviceId,
      cardId: randomShuihuCardId(env),
      idempotencyKey,
      now,
      cost: SHUIHU_DRAW_COST,
      dailyLimit: SHUIHU_DAILY_DRAW_LIMIT,
      completionReward: SHUIHU_COMPLETION_REWARD,
      ...window,
    });
    if (!result) {
      const state = await repository.loadShuihuStatus({
        userId: principal.userId,
        ...window,
      });
      if (!state?.user) throw marketError('account_not_found', 404);
      if (Number(state.drawsUsed ?? 0) >= SHUIHU_DAILY_DRAW_LIMIT) {
        throw marketError('daily_draw_limit', 429);
      }
      if (Number(state.user.pointsBalance ?? 0) < SHUIHU_DRAW_COST) {
        throw marketError('insufficient_points', 409);
      }
      throw marketError('card_draw_unavailable', 503);
    }
    return json({ draw: shuihuDrawPayload(result, window) });
  } catch (error) {
    return marketFailure(error);
  }
}

function pokerStatusResponse(state, window) {
  const dailyWon = Math.max(0, Number(state.dailyWon ?? 0));
  return json({
    poker: {
      pointsBalance: Number(state.user.pointsBalance),
      dailyWon,
      dailyLimit: POKER_DAILY_WIN_LIMIT,
      dailyRemaining: Math.max(0, POKER_DAILY_WIN_LIMIT - dailyWon),
      dayKey: window.dayKey,
      resetsAt: window.resetsAt,
    },
  });
}

function shuihuStatusPayload(state, window) {
  const collection = normalizeShuihuCollection(state.collection);
  return {
    pointsBalance: Number(state.user.pointsBalance),
    drawsUsed: Math.max(0, Number(state.drawsUsed ?? 0)),
    dailyLimit: SHUIHU_DAILY_DRAW_LIMIT,
    drawsRemaining: Math.max(0, SHUIHU_DAILY_DRAW_LIMIT - Number(state.drawsUsed ?? 0)),
    dayKey: window.dayKey,
    resetsAt: window.resetsAt,
    uniqueCount: collection.length,
    totalCopies: collection.reduce((total, entry) => total + entry.copies, 0),
    rewardClaimed: Boolean(state.rewardClaimed),
    collection,
  };
}

function shuihuDrawPayload(result, window) {
  const status = shuihuStatusPayload(result.status, window);
  return {
    cardId: Number(result.cardId),
    isNew: Boolean(result.isNew),
    copies: Number(result.copies),
    cost: SHUIHU_DRAW_COST,
    ...status,
    rewardGranted: Boolean(result.rewardGranted),
    rewardAmount: result.rewardGranted ? SHUIHU_COMPLETION_REWARD : 0,
  };
}

function normalizeShuihuCollection(collection) {
  return (Array.isArray(collection) ? collection : [])
    .map((entry) => ({
      cardId: Number(entry.cardId),
      copies: Math.max(0, Number(entry.copies)),
    }))
    .filter((entry) => (
      Number.isInteger(entry.cardId)
      && entry.cardId >= 1
      && entry.cardId <= SHUIHU_CARD_COUNT
      && entry.copies > 0
    ))
    .sort((left, right) => left.cardId - right.cardId);
}

function pokerSettlementPayload(settlement, window) {
  const dailyWon = Math.max(0, Number(settlement.dailyWon ?? 0));
  return {
    handId: settlement.handId,
    requestedDelta: Number(settlement.requestedDelta),
    appliedDelta: Number(settlement.appliedDelta),
    pointsBalance: Number(settlement.pointsBalance),
    dailyWon,
    dailyLimit: POKER_DAILY_WIN_LIMIT,
    dailyRemaining: Math.max(0, POKER_DAILY_WIN_LIMIT - dailyWon),
    dayKey: window.dayKey,
    resetsAt: window.resetsAt,
  };
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

function normalizeStaleConflictState(state, now) {
  const lease = state.lease;
  if (!lease || now - lease.lastHeartbeatAt <= HEARTBEAT_STALE_MS) return state;
  return {
    ...state,
    lease: {
      ...lease,
      startedAt: now,
      lastHeartbeatAt: now,
      activeSeconds: 0,
      updatedAt: now,
    },
  };
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

    async loadPokerStatus({ userId, dayStart, dayEnd }) {
      const [user, winnings] = await db.batch([
        db.prepare(`
          SELECT id, points_balance
          FROM market_users WHERE id = ? AND status = 'active' LIMIT 1
        `).bind(userId),
        db.prepare(`
          SELECT COALESCE(SUM(CASE WHEN applied_delta > 0 THEN applied_delta ELSE 0 END), 0) AS daily_won
          FROM market_poker_hands
          WHERE user_id = ? AND created_at >= ? AND created_at < ?
        `).bind(userId, dayStart, dayEnd),
      ]);
      return {
        user: mapUser(user.results?.[0]),
        dailyWon: Number(winnings.results?.[0]?.daily_won ?? 0),
      };
    },

    async settlePokerHand({
      userId, deviceId, handId, requestedDelta, idempotencyKey, now,
      dailyLimit, dayKey, dayStart, dayEnd,
    }) {
      const rowId = randomId('poker');
      await db.batch([
        db.prepare(`
          WITH input(
            id, user_id, device_id, hand_id, requested_delta, day_key,
            idempotency_key, created_at, daily_limit, day_start, day_end
          ) AS (VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)),
          account AS (
            SELECT u.points_balance, i.*
            FROM market_users u JOIN input i ON i.user_id = u.id
            WHERE u.status = 'active'
          ),
          daily AS (
            SELECT COALESCE(SUM(
              CASE WHEN h.applied_delta > 0 THEN h.applied_delta ELSE 0 END
            ), 0) AS daily_won
            FROM market_poker_hands h, input i
            WHERE h.user_id = i.user_id
              AND h.created_at >= i.day_start AND h.created_at < i.day_end
          ),
          calculated AS (
            SELECT account.*,
              CASE
                WHEN requested_delta > 0
                  THEN MIN(requested_delta, MAX(0, daily_limit - daily_won))
                ELSE MAX(requested_delta, -points_balance)
              END AS applied_delta
            FROM account, daily
          )
          INSERT INTO market_poker_hands (
            id, user_id, device_id, hand_id, requested_delta, applied_delta,
            balance_after, play_day, idempotency_key, created_at
          )
          SELECT id, user_id, device_id, hand_id, requested_delta, applied_delta,
            points_balance + applied_delta, day_key, idempotency_key, created_at
          FROM calculated
          WHERE NOT EXISTS (
            SELECT 1 FROM market_poker_hands
            WHERE idempotency_key = calculated.idempotency_key
              OR (user_id = calculated.user_id AND hand_id = calculated.hand_id)
          )
        `).bind(
          rowId, userId, deviceId, handId, requestedDelta, dayKey,
          idempotencyKey, now, dailyLimit, dayStart, dayEnd,
        ),
        db.prepare(`
          UPDATE market_users
          SET points_balance = points_balance + COALESCE((
                SELECT applied_delta FROM market_poker_hands WHERE id = ?
              ), 0),
            points_earned_total = points_earned_total + MAX(0, COALESCE((
                SELECT applied_delta FROM market_poker_hands WHERE id = ?
              ), 0)),
            balance_changed_at = ?, updated_at = ?
          WHERE id = ? AND changes() = 1
        `).bind(rowId, rowId, now, now, userId),
      ]);

      const row = await db.prepare(`
        SELECT h.hand_id, h.requested_delta, h.applied_delta, h.balance_after,
          COALESCE((
            SELECT SUM(CASE WHEN d.applied_delta > 0 THEN d.applied_delta ELSE 0 END)
            FROM market_poker_hands d
            WHERE d.user_id = h.user_id AND d.created_at >= ? AND d.created_at < ?
          ), 0) AS daily_won
        FROM market_poker_hands h
        WHERE h.user_id = ? AND (h.idempotency_key = ? OR h.hand_id = ?)
        ORDER BY h.created_at ASC LIMIT 1
      `).bind(dayStart, dayEnd, userId, idempotencyKey, handId).first();
      return mapPokerSettlement(row);
    },

    async loadShuihuStatus({ userId, dayStart, dayEnd }) {
      const [user, draws, collection, reward] = await db.batch([
        db.prepare(`
          SELECT id, points_balance
          FROM market_users WHERE id = ? AND status = 'active' LIMIT 1
        `).bind(userId),
        db.prepare(`
          SELECT COUNT(*) AS draws_used
          FROM market_shuihu_draws
          WHERE user_id = ? AND created_at >= ? AND created_at < ?
        `).bind(userId, dayStart, dayEnd),
        db.prepare(`
          SELECT card_id, copies
          FROM market_shuihu_collection
          WHERE user_id = ?
          ORDER BY card_id ASC
        `).bind(userId),
        db.prepare(`
          SELECT 1 AS claimed
          FROM market_shuihu_rewards
          WHERE user_id = ? AND set_key = 'shuihu-108-v1'
          LIMIT 1
        `).bind(userId),
      ]);
      return {
        user: mapUser(user.results?.[0]),
        drawsUsed: Number(draws.results?.[0]?.draws_used ?? 0),
        collection: (collection.results ?? []).map(mapShuihuCollectionEntry),
        rewardClaimed: Boolean(reward.results?.[0]?.claimed),
      };
    },

    async drawShuihuCard({
      userId, deviceId, cardId, idempotencyKey, now, cost, dailyLimit,
      completionReward, dayKey, dayStart, dayEnd,
    }) {
      const drawId = randomId('shuihu');
      const rewardId = randomId('reward');
      await db.batch([
        db.prepare(`
          WITH input(
            id, user_id, device_id, card_id, points_cost, draw_day,
            idempotency_key, created_at, daily_limit, day_start, day_end
          ) AS (VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)),
          account AS (
            SELECT u.points_balance, i.*
            FROM market_users u JOIN input i ON i.user_id = u.id
            WHERE u.status = 'active'
          ),
          daily AS (
            SELECT COUNT(*) AS draws_used
            FROM market_shuihu_draws d, input i
            WHERE d.user_id = i.user_id
              AND d.created_at >= i.day_start AND d.created_at < i.day_end
          )
          INSERT INTO market_shuihu_draws (
            id, user_id, device_id, card_id, points_cost, balance_after,
            draw_day, is_new, idempotency_key, created_at
          )
          SELECT id, user_id, device_id, card_id, points_cost,
            points_balance - points_cost, draw_day,
            CASE WHEN EXISTS (
              SELECT 1 FROM market_shuihu_collection c
              WHERE c.user_id = account.user_id AND c.card_id = account.card_id
            ) THEN 0 ELSE 1 END,
            idempotency_key, created_at
          FROM account, daily
          WHERE points_balance >= points_cost
            AND draws_used < daily_limit
            AND NOT EXISTS (
              SELECT 1 FROM market_shuihu_draws
              WHERE idempotency_key = account.idempotency_key
            )
        `).bind(
          drawId, userId, deviceId, cardId, cost, dayKey,
          idempotencyKey, now, dailyLimit, dayStart, dayEnd,
        ),
        db.prepare(`
          UPDATE market_users
          SET points_balance = points_balance - ?,
            balance_changed_at = ?, updated_at = ?
          WHERE id = ? AND EXISTS (
            SELECT 1 FROM market_shuihu_draws WHERE id = ?
          )
        `).bind(cost, now, now, userId, drawId),
        db.prepare(`
          INSERT INTO market_shuihu_collection (
            user_id, card_id, copies, first_drawn_at, last_drawn_at
          )
          SELECT user_id, card_id, 1, created_at, created_at
          FROM market_shuihu_draws WHERE id = ?
          ON CONFLICT(user_id, card_id) DO UPDATE SET
            copies = copies + 1,
            last_drawn_at = excluded.last_drawn_at
        `).bind(drawId),
        db.prepare(`
          INSERT INTO market_shuihu_rewards (
            id, user_id, set_key, points_awarded, trigger_draw_id, awarded_at
          )
          SELECT ?, ?, 'shuihu-108-v1', ?, ?, ?
          WHERE EXISTS (SELECT 1 FROM market_shuihu_draws WHERE id = ?)
            AND (
              SELECT COUNT(*) FROM market_shuihu_collection WHERE user_id = ?
            ) = ?
          ON CONFLICT(user_id, set_key) DO NOTHING
        `).bind(
          rewardId, userId, completionReward, drawId, now,
          drawId, userId, SHUIHU_CARD_COUNT,
        ),
        db.prepare(`
          UPDATE market_users
          SET points_balance = points_balance + ?,
            points_earned_total = points_earned_total + ?,
            balance_changed_at = ?, updated_at = ?
          WHERE id = ? AND EXISTS (
            SELECT 1 FROM market_shuihu_rewards WHERE trigger_draw_id = ?
          )
        `).bind(completionReward, completionReward, now, now, userId, drawId),
      ]);

      const draw = await db.prepare(`
        SELECT id, card_id, points_cost, is_new
        FROM market_shuihu_draws
        WHERE user_id = ? AND idempotency_key = ?
        LIMIT 1
      `).bind(userId, idempotencyKey).first();
      if (!draw) return null;

      const status = await this.loadShuihuStatus({ userId, dayStart, dayEnd });
      const entry = status.collection.find((item) => item.cardId === Number(draw.card_id));
      const reward = await db.prepare(`
        SELECT 1 AS granted
        FROM market_shuihu_rewards
        WHERE user_id = ? AND set_key = 'shuihu-108-v1' AND trigger_draw_id = ?
        LIMIT 1
      `).bind(userId, draw.id).first();
      return {
        cardId: Number(draw.card_id),
        isNew: Boolean(draw.is_new),
        copies: Number(entry?.copies ?? 0),
        cost: Number(draw.points_cost),
        rewardGranted: Boolean(reward?.granted),
        status,
      };
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

function mapPokerSettlement(row) {
  if (!row) return null;
  return {
    handId: row.hand_id,
    requestedDelta: Number(row.requested_delta),
    appliedDelta: Number(row.applied_delta),
    pointsBalance: Number(row.balance_after),
    dailyWon: Number(row.daily_won),
  };
}

function mapShuihuCollectionEntry(row) {
  return {
    cardId: Number(row.card_id),
    copies: Number(row.copies),
  };
}

function strictLeaseVersion(value) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function cleanIdempotencyKey(value) {
  if (typeof value !== 'string') return '';
  const key = value.trim();
  return /^[A-Za-z0-9._:-]{1,200}$/.test(key) ? key : '';
}

function cleanHandId(value) {
  if (typeof value !== 'string') return '';
  const handId = value.trim().toLowerCase();
  return /^[a-z0-9-]{8,80}$/.test(handId) ? handId : '';
}

function strictPointDelta(value) {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && Math.abs(value) <= 1_000_000
    ? value
    : null;
}

export function randomShuihuCardId(env) {
  const injected = typeof env?.RANDOM_SHUIHU_CARD_ID === 'function'
    ? env.RANDOM_SHUIHU_CARD_ID()
    : env?.RANDOM_SHUIHU_CARD_ID;
  if (Number.isInteger(injected) && injected >= 1 && injected <= SHUIHU_CARD_COUNT) {
    return Number(injected);
  }

  const sampleSpace = 0x1_0000_0000;
  const unbiasedCeiling = sampleSpace - (sampleSpace % SHUIHU_CARD_COUNT);
  const values = new Uint32Array(1);
  do {
    crypto.getRandomValues(values);
  } while (values[0] >= unbiasedCeiling);
  return (values[0] % SHUIHU_CARD_COUNT) + 1;
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
