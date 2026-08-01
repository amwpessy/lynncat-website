import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { handleMarketAuth } from '../src/marketAuth.js';
import {
  handleMarketHeartbeat,
  handleMarketHeartbeatStop,
  handleMarketPokerSettlement,
  handleMarketPokerStatus,
  pokerDayWindow,
} from '../src/marketPoints.js';
import {
  appleCredentialRequest,
  bearerRequest,
  createAccountEnv,
} from './helpers/market-account-fakes.mjs';

test('regular 20-second heartbeats credit exactly one point at 60 seconds', async () => {
  const { env, sessionToken } = await signedInEnv({ now: 1_000_000, points: 0 });
  await heartbeat(env, sessionToken, 'h1', 0);
  for (const [key, version] of [['h2', 1], ['h3', 2], ['h4', 3]]) {
    env.advance(20_000);
    await heartbeat(env, sessionToken, key, version);
  }

  assert.equal(env.repo.user.pointsBalance, 1);
  assert.equal(env.repo.user.pointsEarnedTotal, 1);
  assert.equal(env.repo.ledger.size, 1);
});

test('below-min-gap duplicate leaves the authoritative lease unchanged', async () => {
  const { env, sessionToken } = await signedInEnv({ now: 1_000_000, points: 0 });
  await heartbeat(env, sessionToken, 'first', 0);
  env.advance(10_000);

  const duplicate = await heartbeat(env, sessionToken, 'duplicate', 1);

  assert.deepEqual(pickLease(duplicate), { activeSeconds: 0, leaseVersion: 1 });
  assert.equal(env.repo.leases.values().next().value.lastHeartbeatAt, 1_000_000);
  assert.equal(env.repo.ledger.size, 0);
  assert.equal(duplicate.nextCreditAt, 1_060_000);
});

test('a heartbeat at exactly 15 seconds advances the lease', async () => {
  const { env, sessionToken } = await signedInEnv({ now: 1_000_000, points: 0 });
  await heartbeat(env, sessionToken, 'start', 0);
  env.advance(15_000);

  const accepted = await heartbeat(env, sessionToken, 'at-min-gap', 1);

  assert.deepEqual(pickLease(accepted), { activeSeconds: 15, leaseVersion: 2 });
  assert.equal(env.repo.leases.values().next().value.lastHeartbeatAt, 1_015_000);
});

test('a heartbeat at exactly 45 seconds remains continuous', async () => {
  const { env, sessionToken } = await signedInEnv({ now: 1_000_000, points: 0 });
  const principal = await principalFor(env, sessionToken);
  await heartbeat(env, sessionToken, 'start', 0);
  env.advance(45_000);

  const accepted = await heartbeat(env, sessionToken, 'at-stale-boundary', 1);
  const lease = env.repo.leases.get(principal.deviceId);

  assert.deepEqual(pickLease(accepted), { activeSeconds: 30, leaseVersion: 2 });
  assert.equal(lease.startedAt, 1_000_000);
  assert.equal(lease.lastHeartbeatAt, 1_045_000);
});

test('a heartbeat just beyond 45 seconds resets the lease', async () => {
  const { env, sessionToken } = await signedInEnv({ now: 1_000_000, points: 0 });
  const principal = await principalFor(env, sessionToken);
  await heartbeat(env, sessionToken, 'start', 0);
  env.advance(45_001);

  const reset = await heartbeat(env, sessionToken, 'past-stale-boundary', 1);
  const lease = env.repo.leases.get(principal.deviceId);

  assert.deepEqual(pickLease(reset), { activeSeconds: 0, leaseVersion: 2 });
  assert.equal(lease.startedAt, 1_045_001);
  assert.equal(lease.lastHeartbeatAt, 1_045_001);
});

test('stale heartbeats reset without backfill', async () => {
  const { env, sessionToken } = await signedInEnv({ now: 1_000_000, points: 0 });
  await heartbeat(env, sessionToken, 'same', 0);
  env.advance(90_000);

  const stale = await heartbeat(env, sessionToken, 'stale', 1);

  assert.equal(stale.credited, false);
  assert.equal(stale.activeSeconds, 0);
  assert.equal(stale.leaseVersion, 2);
  assert.equal(env.repo.user.pointsBalance, 0);
  assert.equal(env.repo.ledger.size, 0);
});

test('one heartbeat can grant no more than one point', async () => {
  const { env, sessionToken } = await signedInEnv({ now: 1_000_000, points: 0 });
  const principal = await principalFor(env, sessionToken);
  env.repo.leases.set(principal.deviceId, {
    deviceId: principal.deviceId,
    userId: principal.userId,
    startedAt: 900_000,
    lastHeartbeatAt: 970_000,
    activeSeconds: 59,
    leaseVersion: 4,
    updatedAt: 970_000,
  });

  const result = await heartbeat(env, sessionToken, 'only-one', 4);

  assert.equal(result.credited, true);
  assert.equal(result.activeSeconds, 29);
  assert.equal(env.repo.user.pointsBalance, 1);
  assert.equal(env.repo.ledger.size, 1);
});

test('optimistic version conflicts return fresh lease state without a credit', async () => {
  const { env, sessionToken } = await signedInEnv({ now: 1_000_000, points: 0 });
  await heartbeat(env, sessionToken, 'first', 0);
  env.advance(20_000);

  const conflict = await heartbeat(env, sessionToken, 'late-client', 0);

  assert.deepEqual(pickLease(conflict), { activeSeconds: 0, leaseVersion: 1 });
  assert.equal(conflict.credited, false);
  assert.equal(env.repo.user.pointsBalance, 0);
});

test('a stale lease version conflict returns fresh-start progress without replacing the stored lease', async () => {
  const { env, sessionToken } = await signedInEnv({ now: 1_000_000, points: 0 });
  const principal = await principalFor(env, sessionToken);
  const storedLease = {
    deviceId: principal.deviceId,
    userId: principal.userId,
    startedAt: 900_000,
    lastHeartbeatAt: 950_000,
    activeSeconds: 59,
    leaseVersion: 2,
    updatedAt: 950_000,
  };
  env.repo.leases.set(principal.deviceId, { ...storedLease });

  const conflict = await heartbeat(env, sessionToken, 'stale-conflict', 1);

  assert.deepEqual(pickLease(conflict), { activeSeconds: 0, leaseVersion: 2 });
  assert.equal(conflict.credited, false);
  assert.equal(conflict.nextCreditAt, 1_060_000);
  assert.deepEqual(env.repo.leases.get(principal.deviceId), storedLease);
});

test('heartbeat rejects non-numeric lease versions without creating a lease', async () => {
  const { env, sessionToken } = await signedInEnv({ now: 1_000_000, points: 0 });

  for (const body of [
    '{"leaseVersion":null}',
    '{"leaseVersion":"0"}',
    '{"leaseVersion":true}',
    '{"leaseVersion":0.5}',
    '{"leaseVersion":-1}',
  ]) {
    const response = await heartbeatResponse(env, sessionToken, body, 'strict-version');
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: 'invalid_lease_version' });
    assert.equal(env.repo.leases.size, 0);
  }
});

test('a racing lease update is re-read before returning a conflict response', async () => {
  const { env, sessionToken } = await signedInEnv({ now: 1_000_000, points: 0 });
  const principal = await principalFor(env, sessionToken);
  await heartbeat(env, sessionToken, 'first', 0);
  env.advance(20_000);
  env.repo.nextHeartbeatConflict = {
    deviceId: principal.deviceId,
    userId: principal.userId,
    startedAt: 1_000_000,
    lastHeartbeatAt: 1_015_000,
    activeSeconds: 20,
    leaseVersion: 2,
    updatedAt: 1_015_000,
  };

  const conflict = await heartbeat(env, sessionToken, 'racing-client', 1);

  assert.deepEqual(pickLease(conflict), { activeSeconds: 20, leaseVersion: 2 });
  assert.equal(conflict.credited, false);
  assert.equal(conflict.nextCreditAt, 1_055_000);
});

test('a reused credited idempotency key leaves active lease progress intact', async () => {
  const { env, sessionToken } = await signedInEnv({ now: 1_000_000, points: 0 });
  const principal = await principalFor(env, sessionToken);
  env.repo.leases.set(principal.deviceId, {
    deviceId: principal.deviceId,
    userId: principal.userId,
    startedAt: 900_000,
    lastHeartbeatAt: 980_000,
    activeSeconds: 59,
    leaseVersion: 1,
    updatedAt: 980_000,
  });
  const firstCredit = await heartbeat(env, sessionToken, 'credited-key', 1);
  env.advance(20_000);
  await heartbeat(env, sessionToken, 'continue-1', 2);
  env.advance(20_000);
  await heartbeat(env, sessionToken, 'continue-2', 3);
  env.advance(20_000);

  const duplicateCredit = await heartbeat(env, sessionToken, 'credited-key', 4);

  assert.equal(firstCredit.credited, true);
  assert.deepEqual(pickLease(duplicateCredit), { activeSeconds: 59, leaseVersion: 4 });
  assert.equal(env.repo.user.pointsBalance, 1);
  assert.equal(env.repo.ledger.size, 1);
});

test('two devices earn online credits independently for the same user', async () => {
  const { env, sessionToken: first } = await signedInEnv({ now: 1_000_000, points: 0 });
  const login = await handleMarketAuth(appleCredentialRequest('macos', 'mac-install'), env);
  const { sessionToken: second } = await login.json();

  await heartbeat(env, first, 'ios-1', 0);
  await heartbeat(env, second, 'mac-1', 0);
  for (const [version, suffix] of [[1, '2'], [2, '3']]) {
    env.advance(20_000);
    await heartbeat(env, first, `ios-${suffix}`, version);
    await heartbeat(env, second, `mac-${suffix}`, version);
  }
  env.advance(20_000);
  await Promise.all([
    heartbeat(env, first, 'ios-4', 3),
    heartbeat(env, second, 'mac-4', 3),
  ]);

  assert.equal(env.repo.user.pointsBalance, 2);
  assert.equal(env.repo.user.pointsEarnedTotal, 2);
  assert.equal(env.repo.ledger.size, 2);
});

test('stop removes only the authenticated device lease', async () => {
  const { env, sessionToken: first } = await signedInEnv({ now: 1_000_000, points: 0 });
  const login = await handleMarketAuth(appleCredentialRequest('macos', 'mac-install'), env);
  const { sessionToken: second } = await login.json();
  const firstPrincipal = await principalFor(env, first);
  const secondPrincipal = await principalFor(env, second);
  await heartbeat(env, first, 'ios-start', 0);
  await heartbeat(env, second, 'mac-start', 0);

  const stopped = await stop(env, first, 1);

  assert.equal(stopped.activeSeconds, 0);
  assert.equal(stopped.nextCreditAt, null);
  assert.equal(env.repo.leases.has(firstPrincipal.deviceId), false);
  assert.equal(env.repo.leases.has(secondPrincipal.deviceId), true);
});

test('stop rejects malformed or missing lease versions without deleting a lease', async () => {
  const { env, sessionToken } = await signedInEnv({ now: 1_000_000, points: 0 });
  const principal = await principalFor(env, sessionToken);
  await heartbeat(env, sessionToken, 'start', 0);

  for (const [body, expectedError] of [
    ['{', 'invalid_json'],
    ['{}', 'invalid_lease_version'],
    ['{"leaseVersion":1.5}', 'invalid_lease_version'],
    ['{"leaseVersion":"1"}', 'invalid_lease_version'],
    ['{"leaseVersion":-1}', 'invalid_lease_version'],
  ]) {
    const response = await stopResponse(env, sessionToken, body);
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: expectedError });
    assert.equal(env.repo.leases.has(principal.deviceId), true);
  }
});

test('a stale stop version returns the fresh lease without deleting it', async () => {
  const { env, sessionToken } = await signedInEnv({ now: 1_000_000, points: 0 });
  const principal = await principalFor(env, sessionToken);
  await heartbeat(env, sessionToken, 'start', 0);

  const stale = await stop(env, sessionToken, 0);

  assert.deepEqual(pickLease(stale), { activeSeconds: 0, leaseVersion: 1 });
  assert.equal(env.repo.leases.has(principal.deviceId), true);
});

test('heartbeat and stop fail closed without a bearer session', async () => {
  const env = createAccountEnv({ now: 1_000_000 });
  const heartbeatResponse = await handleMarketHeartbeat(new Request('https://unit.test/markets/points/heartbeat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'no-session' },
    body: JSON.stringify({ leaseVersion: 0 }),
  }), env);
  const stopResponse = await handleMarketHeartbeatStop(new Request('https://unit.test/markets/points/heartbeat/stop', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ leaseVersion: 0 }),
  }), env);

  assert.deepEqual(await heartbeatResponse.json(), { error: 'login_required' });
  assert.equal(heartbeatResponse.status, 401);
  assert.deepEqual(await stopResponse.json(), { error: 'login_required' });
  assert.equal(stopResponse.status, 401);
});

test('D1 credited lease mutations guard the ledger idempotency key before updating the lease', async () => {
  const source = await readFile(new URL('../src/marketPoints.js', import.meta.url), 'utf8');

  assert.match(source, /NOT EXISTS \(\s*SELECT 1 FROM market_point_ledger WHERE idempotency_key = \?\s*\)/);
});

test('poker day windows reset at midnight in China Standard Time', () => {
  const beforeMidnight = Date.parse('2026-07-23T15:59:59.000Z');
  const afterMidnight = beforeMidnight + 1_000;

  assert.equal(pokerDayWindow(beforeMidnight).dayKey, '2026-07-23');
  assert.equal(pokerDayWindow(afterMidnight).dayKey, '2026-07-24');
  assert.equal(pokerDayWindow(beforeMidnight).resetsAt, afterMidnight);
});

test('poker settlements apply wins and losses to the account balance', async () => {
  const { env, sessionToken } = await signedInEnv({ now: Date.parse('2026-07-23T08:00:00Z'), points: 1_000 });

  const win = await settlePoker(env, sessionToken, 'hand-win-0001', 600, 'poker-win-1');
  const loss = await settlePoker(env, sessionToken, 'hand-loss-001', -250, 'poker-loss-1');

  assert.equal(win.appliedDelta, 600);
  assert.equal(loss.appliedDelta, -250);
  assert.equal(loss.pointsBalance, 1_350);
  assert.equal(env.repo.user.pointsBalance, 1_350);
});

test('poker losses are clamped so points can never become negative', async () => {
  const { env, sessionToken } = await signedInEnv({ now: Date.parse('2026-07-23T08:00:00Z'), points: 120 });

  const loss = await settlePoker(env, sessionToken, 'hand-allin-01', -800, 'poker-allin');

  assert.equal(loss.appliedDelta, -120);
  assert.equal(loss.pointsBalance, 0);
  assert.equal(env.repo.user.pointsBalance, 0);
});

test('poker winnings are capped at 7500 points per China day', async () => {
  const { env, sessionToken } = await signedInEnv({ now: Date.parse('2026-07-23T08:00:00Z'), points: 100 });

  const first = await settlePoker(env, sessionToken, 'hand-cap-0001', 7_400, 'poker-cap-1');
  const second = await settlePoker(env, sessionToken, 'hand-cap-0002', 500, 'poker-cap-2');

  assert.equal(first.appliedDelta, 7_400);
  assert.equal(second.appliedDelta, 100);
  assert.equal(second.dailyWon, 7_500);
  assert.equal(second.dailyRemaining, 0);
  assert.equal(second.pointsBalance, 7_600);
});

test('duplicate poker settlements are idempotent by request key and hand id', async () => {
  const { env, sessionToken } = await signedInEnv({ now: Date.parse('2026-07-23T08:00:00Z'), points: 100 });

  const first = await settlePoker(env, sessionToken, 'hand-repeat-01', 500, 'poker-repeat-1');
  const repeatedKey = await settlePoker(env, sessionToken, 'hand-repeat-01', 500, 'poker-repeat-1');
  const repeatedHand = await settlePoker(env, sessionToken, 'hand-repeat-01', 900, 'poker-repeat-2');

  assert.deepEqual(repeatedKey, first);
  assert.equal(repeatedHand.appliedDelta, 500);
  assert.equal(env.repo.user.pointsBalance, 600);
  assert.equal(env.repo.pokerHands.size, 1);
});

test('poker status reports authoritative balance and daily remaining points', async () => {
  const { env, sessionToken } = await signedInEnv({ now: Date.parse('2026-07-23T08:00:00Z'), points: 1_000 });
  await settlePoker(env, sessionToken, 'hand-status-01', 320, 'poker-status-1');

  const response = await handleMarketPokerStatus(new Request(
    'https://unit.test/markets/points/poker',
    { headers: { Authorization: bearerRequest(sessionToken).headers.get('Authorization') } },
  ), env);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.poker.pointsBalance, 1_320);
  assert.equal(body.poker.dailyWon, 320);
  assert.equal(body.poker.dailyRemaining, 7_180);
});

test('poker settlement validates the hand result and requires authentication', async () => {
  const anonymousEnv = createAccountEnv({ now: Date.parse('2026-07-23T08:00:00Z') });
  const noSession = await handleMarketPokerSettlement(new Request(
    'https://unit.test/markets/points/poker/settle',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'poker-no-session' },
      body: JSON.stringify({ handId: 'hand-guest-01', delta: 20 }),
    },
  ), anonymousEnv);
  assert.equal(noSession.status, 401);

  const { env, sessionToken } = await signedInEnv({ now: anonymousEnv.NOW(), points: 100 });
  const invalid = await pokerSettlementResponse(
    env, sessionToken, '{"handId":"bad","delta":20}', 'poker-invalid',
  );
  assert.equal(invalid.status, 400);
  assert.deepEqual(await invalid.json(), { error: 'invalid_hand_id' });
});

async function signedInEnv({ now, points }) {
  const env = createAccountEnv({ now });
  const login = await handleMarketAuth(appleCredentialRequest(), env);
  const { sessionToken } = await login.json();
  env.repo.user.pointsBalance = points;
  env.repo.user.pointsEarnedTotal = points;
  return { env, sessionToken };
}

async function principalFor(env, sessionToken) {
  const session = await env.repo.findSessionByTokenHash(await digestSessionToken(sessionToken));
  return { userId: session.userId, deviceId: session.deviceId };
}

async function digestSessionToken(sessionToken) {
  const bytes = new TextEncoder().encode(`${'session-salt'}:${sessionToken}`);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function heartbeat(env, sessionToken, idempotencyKey, leaseVersion) {
  const response = await heartbeatResponse(
    env,
    sessionToken,
    JSON.stringify({ leaseVersion }),
    idempotencyKey,
  );
  assert.equal(response.status, 200);
  return response.json();
}

function heartbeatResponse(env, sessionToken, body, idempotencyKey) {
  return handleMarketHeartbeat(new Request('https://unit.test/markets/points/heartbeat', {
    method: 'POST',
    headers: {
      Authorization: bearerRequest(sessionToken).headers.get('Authorization'),
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    },
    body,
  }), env);
}

async function stop(env, sessionToken, leaseVersion) {
  const response = await stopResponse(env, sessionToken, JSON.stringify({ leaseVersion }));
  assert.equal(response.status, 200);
  return response.json();
}

function stopResponse(env, sessionToken, body) {
  return handleMarketHeartbeatStop(new Request('https://unit.test/markets/points/heartbeat/stop', {
    method: 'POST',
    headers: {
      Authorization: bearerRequest(sessionToken).headers.get('Authorization'),
      'Content-Type': 'application/json',
    },
    body,
  }), env);
}

async function settlePoker(env, sessionToken, handId, delta, idempotencyKey) {
  const response = await pokerSettlementResponse(
    env,
    sessionToken,
    JSON.stringify({ handId, delta }),
    idempotencyKey,
  );
  assert.equal(response.status, 200);
  return (await response.json()).settlement;
}

function pokerSettlementResponse(env, sessionToken, body, idempotencyKey) {
  return handleMarketPokerSettlement(new Request(
    'https://unit.test/markets/points/poker/settle',
    {
      method: 'POST',
      headers: {
        Authorization: bearerRequest(sessionToken).headers.get('Authorization'),
        'Content-Type': 'application/json',
        'Idempotency-Key': idempotencyKey,
      },
      body,
    },
  ), env);
}

function pickLease(result) {
  return { activeSeconds: result.activeSeconds, leaseVersion: result.leaseVersion };
}

test('web heartbeat starts at lease zero and mirrors the Mac twenty-second cadence', async () => {
  const [source, page] = await Promise.all([
    readFile(new URL('../markets-home.js', import.meta.url), 'utf8'),
    readFile(new URL('../index.html', import.meta.url), 'utf8'),
  ]);

  assert.match(source, /leaseVersion:\s*0/);
  assert.match(source, /payload\.leaseVersion \?\? state\.leaseVersion/);
  assert.match(source, /setInterval\(heartbeat,\s*20_000\)/);
  assert.match(source, /if \(payload\.credited\) state\.account\.pointsEarnedTotal/);
  assert.match(source, /state\.pokerStatus\.pointsBalance = Number\(payload\.pointsBalance\)/);
  assert.match(source, /state\.cardsStatus\.pointsBalance = Number\(payload\.pointsBalance\)/);
  assert.match(source, /points\/heartbeat\/stop/);
  assert.doesNotMatch(source, /localStorage\.getItem\("lynncat-lease-version"\)/);
  assert.match(page, /每分钟获得 1 积分/);
  assert.match(page, /id="online-credit-status"/);
});
