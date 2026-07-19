import test from 'node:test';
import assert from 'node:assert/strict';
import { handleMarketAuth } from '../src/marketAuth.js';
import { handleMarketHeartbeat, handleMarketHeartbeatStop } from '../src/marketPoints.js';
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

test('a racing lease update is re-read before returning a conflict response', async () => {
  const { env, sessionToken } = await signedInEnv({ now: 1_000_000, points: 0 });
  const principal = await principalFor(env, sessionToken);
  await heartbeat(env, sessionToken, 'first', 0);
  env.advance(20_000);
  env.repo.nextHeartbeatConflict = {
    deviceId: principal.deviceId,
    userId: principal.userId,
    startedAt: 1_000_000,
    lastHeartbeatAt: 1_020_000,
    activeSeconds: 20,
    leaseVersion: 2,
    updatedAt: 1_020_000,
  };

  const conflict = await heartbeat(env, sessionToken, 'racing-client', 1);

  assert.deepEqual(pickLease(conflict), { activeSeconds: 20, leaseVersion: 2 });
  assert.equal(conflict.credited, false);
});

test('two devices earn online credits independently for the same user', async () => {
  const { env, sessionToken: first } = await signedInEnv({ now: 1_000_000, points: 0 });
  const login = await handleMarketAuth(appleCredentialRequest('macos', 'mac-install'), env);
  const { sessionToken: second } = await login.json();

  await heartbeat(env, first, 'ios-1', 0);
  await heartbeat(env, second, 'mac-1', 0);
  for (const [version, suffix] of [[1, '2'], [2, '3'], [3, '4']]) {
    env.advance(20_000);
    await heartbeat(env, first, `ios-${suffix}`, version);
    await heartbeat(env, second, `mac-${suffix}`, version);
  }

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
  const response = await handleMarketHeartbeat(new Request('https://unit.test/markets/points/heartbeat', {
    method: 'POST',
    headers: {
      Authorization: bearerRequest(sessionToken).headers.get('Authorization'),
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
    },
    body: JSON.stringify({ leaseVersion }),
  }), env);
  assert.equal(response.status, 200);
  return response.json();
}

async function stop(env, sessionToken, leaseVersion) {
  const response = await handleMarketHeartbeatStop(new Request('https://unit.test/markets/points/heartbeat/stop', {
    method: 'POST',
    headers: {
      Authorization: bearerRequest(sessionToken).headers.get('Authorization'),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ leaseVersion }),
  }), env);
  assert.equal(response.status, 200);
  return response.json();
}

function pickLease(result) {
  return { activeSeconds: result.activeSeconds, leaseVersion: result.leaseVersion };
}
