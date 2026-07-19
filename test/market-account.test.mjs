import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import {
  decryptAppleCredential,
  handleDeleteMarketAccount,
  handleMarketAccount,
  handleMarketLeaderboard,
  handleMarketProfile,
  handlePointLedger,
} from '../src/marketAccount.js';
import { authenticateMarketRequest, handleMarketAuth } from '../src/marketAuth.js';
import { encryptRefreshToken } from '../src/marketCrypto.js';
import {
  appleCredentialRequest,
  authenticatedRequest,
  createAccountEnv,
  visibleUsers,
} from './helpers/market-account-fakes.mjs';

test('leaderboard returns the top 100 plus authenticated self outside the top 100', async () => {
  const { env, sessionToken, user } = await signedInEnv({ points: 0 });
  for (const rankedUser of visibleUsers(105)) env.repo.users.set(rankedUser.id, rankedUser);

  const response = await handleMarketLeaderboard(
    authenticatedRequest('/markets/leaderboard', sessionToken), env,
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.entries.length, 100);
  assert.deepEqual(body.me, {
    rank: 106,
    publicId: user.publicId,
    nickname: user.nickname,
    pointsBalance: 0,
    isCurrentUser: true,
  });
  assert.deepEqual(Object.keys(body.entries[0]).sort(), [
    'isCurrentUser', 'nickname', 'pointsBalance', 'publicId', 'rank',
  ]);
  assert.equal(JSON.stringify(body).includes('appleSubjectHash'), false);
});

test('leaderboard ordering is stable and excludes hidden and inactive users', async () => {
  const { env, sessionToken, user } = await signedInEnv({ points: 50 });
  Object.assign(user, { leaderboardVisible: false, balanceChangedAt: 50 });
  for (const rankedUser of [
    rankedFixture('z-id', 50, 100),
    rankedFixture('b-id', 50, 90),
    rankedFixture('a-id', 50, 90),
    { ...rankedFixture('hidden', 100, 1), leaderboardVisible: false },
    { ...rankedFixture('deleted', 100, 1), status: 'deleted' },
  ]) env.repo.users.set(rankedUser.id, rankedUser);

  const body = await json(await handleMarketLeaderboard(
    authenticatedRequest('/markets/leaderboard', sessionToken), env,
  ));

  assert.deepEqual(body.entries.map((entry) => entry.publicId), [
    'public-a-id', 'public-b-id', 'public-z-id',
  ]);
  assert.deepEqual(body.entries.map((entry) => entry.rank), [1, 2, 3]);
  assert.equal(body.me, null);
});

test('leaderboard is public without exposing an authenticated self entry', async () => {
  const env = createAccountEnv();
  for (const rankedUser of visibleUsers(3)) env.repo.users.set(rankedUser.id, rankedUser);

  const response = await handleMarketLeaderboard(
    new Request('https://unit.test/markets/leaderboard'), env,
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body.entries.map((entry) => entry.isCurrentUser), [false, false, false]);
  assert.equal(body.me, null);
});

test('profile reads and updates normalized nickname and leaderboard visibility', async () => {
  const { env, sessionToken, user } = await signedInEnv({ points: 42 });
  const response = await handleMarketProfile(authenticatedRequest(
    '/markets/account/profile', sessionToken,
    { method: 'PUT', body: { nickname: '  Lynn   Cat  ', leaderboardVisible: false } },
  ), env);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body.account, {
    id: user.publicId,
    nickname: 'Lynn Cat',
    pointsBalance: 42,
    pointsEarnedTotal: 42,
    leaderboardVisible: false,
  });
  const read = await json(await handleMarketAccount(
    authenticatedRequest('/markets/account', sessionToken), env,
  ));
  assert.deepEqual(read.account, body.account);
});

test('profile rejects empty, overlong and unsafe nicknames without mutation', async () => {
  const { env, sessionToken, user } = await signedInEnv({ points: 1 });
  const original = user.nickname;
  const cases = [
    '   ',
    '猫'.repeat(15),
    'x@y.co',
    '微信带单',
  ];

  for (const nickname of cases) {
    const response = await handleMarketProfile(authenticatedRequest(
      '/markets/account/profile', sessionToken, { method: 'PUT', body: { nickname } },
    ), env);
    assert.equal(response.status, 422);
    assert.deepEqual(await response.json(), { error: 'nickname_rejected' });
    assert.equal(user.nickname, original);
  }
});

test('anonymous nickname is stable, HMAC-derived and never uses Apple profile data', async () => {
  const first = await signedInEnv({ appleSubject: 'same-private-subject' });
  const second = await signedInEnv({ appleSubject: 'same-private-subject' });
  const other = await signedInEnv({ appleSubject: 'other-private-subject' });

  assert.match(first.user.nickname, /^Lynncat \d{4}$/);
  assert.equal(first.user.nickname, second.user.nickname);
  assert.notEqual(first.user.nickname, other.user.nickname);
  assert.doesNotMatch(first.user.nickname, /private-subject/);
});

test('ledger is private to the authenticated user and paginates with a stable cursor', async () => {
  const { env, sessionToken, user } = await signedInEnv({ points: 9 });
  for (const entry of [
    ledgerFixture('own-1', user.id, 100, 1),
    ledgerFixture('own-2', user.id, 200, -1),
    ledgerFixture('own-3', user.id, 300, 1),
    ledgerFixture('other', 'another-user', 400, 50),
  ]) env.repo.ledger.set(entry.idempotencyKey, entry);

  const first = await json(await handleMarketAccount(authenticatedRequest(
    '/markets/points/ledger?limit=2', sessionToken,
  ), env));
  const second = await json(await handleMarketAccount(authenticatedRequest(
    `/markets/points/ledger?limit=2&cursor=${encodeURIComponent(first.nextCursor)}`, sessionToken,
  ), env));

  assert.deepEqual(first.entries.map((entry) => entry.id), ['own-3', 'own-2']);
  assert.equal(typeof first.nextCursor, 'string');
  assert.deepEqual(second.entries.map((entry) => entry.id), ['own-1']);
  assert.equal(second.nextCursor, null);
  assert.deepEqual(Object.keys(first.entries[0]).sort(), [
    'amount', 'balanceAfter', 'createdAt', 'id', 'kind',
  ]);
  assert.doesNotMatch(JSON.stringify([first, second]), /another-user|device|idempotency|reference/i);
});

test('ledger rejects a malformed cursor', async () => {
  const { env, sessionToken } = await signedInEnv();
  const response = await handlePointLedger(authenticatedRequest(
    '/markets/points/ledger?cursor=not-a-cursor', sessionToken,
  ), env);

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: 'invalid_cursor' });
});

test('logout revokes only the current session', async () => {
  const env = createAccountEnv();
  const first = await login(env, 'ios', 'ios-install');
  const second = await login(env, 'macos', 'mac-install');

  const response = await handleMarketAccount(authenticatedRequest(
    '/markets/auth/logout', first.sessionToken, { method: 'POST' },
  ), env);

  assert.equal(response.status, 204);
  await assert.rejects(
    authenticateMarketRequest(authenticatedRequest('/markets/account', first.sessionToken), env),
    (error) => error.code === 'session_revoked',
  );
  const principal = await authenticateMarketRequest(
    authenticatedRequest('/markets/account', second.sessionToken), env,
  );
  assert.equal(principal.userId, second.user.id);
});

test('authentication encrypts a versioned credential envelope with refresh token and issuing client ID', async () => {
  const env = createAccountEnv({ appleClientId: 'com.lynncat.macos' });
  await login(env, 'macos', 'mac-install');

  assert.deepEqual(JSON.parse(env.encryptedCredentialPayload), {
    version: 1,
    refreshToken: 'raw-refresh-token',
    clientId: 'com.lynncat.macos',
  });
  assert.equal(env.repo.credentials.values().next().value.encryptedRefreshToken, 'sealed-refresh-token');
});

test('AES-GCM credential decryption restores only a valid versioned envelope', async () => {
  const key = new Uint8Array(32).fill(7);
  const envelope = { version: 1, refreshToken: 'correct-refresh', clientId: 'com.lynncat.ios' };
  const env = {
    APPLE_TOKEN_ENCRYPTION_KEY: Buffer.from(key).toString('base64url'),
    RANDOM_BYTES: (length) => new Uint8Array(length).fill(3),
  };
  const encrypted = await encryptRefreshToken(JSON.stringify(envelope), env);

  assert.deepEqual(await decryptAppleCredential(encrypted, env), envelope);
  await assert.rejects(
    decryptAppleCredential(await encryptRefreshToken('token-only', env), env),
    (error) => error.code === 'invalid_apple_credential',
  );
});

test('deletion revokes the correct token and client ID before atomically removing account data', async () => {
  const { env, sessionToken, user, principal } = await signedInEnv({
    points: 42, appleClientId: 'com.lynncat.watchos', platform: 'watchos',
  });
  seedDeletableState(env, user, principal.deviceId);

  const response = await handleDeleteMarketAccount(authenticatedRequest(
    '/markets/account', sessionToken, { method: 'DELETE' },
  ), env);

  assert.equal(response.status, 204);
  assert.deepEqual(env.apple.revokedTokens, [{
    refreshToken: 'raw-refresh-token', clientId: 'com.lynncat.watchos',
  }]);
  assert.deepEqual(env.operationLog.slice(-2), ['apple-revocation', 'account-delete-batch']);
  assert.deepEqual(stateSizes(env), {
    users: 0, credentials: 0, devices: 0, sessions: 0, leases: 0,
    ledger: 0, messages: 0, reports: 0,
  });
});

test('revocation failure returns retry and leaves account, sessions, messages and points intact', async () => {
  const { env, sessionToken, user, principal } = await signedInEnv({
    points: 42, revocationFails: true,
  });
  seedDeletableState(env, user, principal.deviceId);
  const before = snapshotState(env);

  const response = await handleDeleteMarketAccount(authenticatedRequest(
    '/markets/account', sessionToken, { method: 'DELETE' },
  ), env);

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: 'account_deletion_retry' });
  assert.deepEqual(snapshotState(env), before);
  assert.equal(env.operationLog.includes('account-delete-batch'), false);
});

test('D1 deletion is one batch with reports and active messages removed before the user', async () => {
  const source = await readFile(new URL('../src/marketAccount.js', import.meta.url), 'utf8');

  assert.match(source, /await db\.batch\(\[/);
  const reports = source.indexOf('DELETE FROM market_reports');
  const messages = source.indexOf('DELETE FROM market_messages');
  const sessions = source.indexOf('DELETE FROM market_user_sessions');
  const users = source.indexOf('DELETE FROM market_users');
  assert.ok(reports >= 0 && reports < messages && messages < sessions && sessions < users);
});

async function signedInEnv(options = {}) {
  const env = createAccountEnv(options);
  const result = await login(env, options.platform ?? 'ios', options.installationId ?? 'ios-install');
  result.user.pointsBalance = options.points ?? 0;
  result.user.pointsEarnedTotal = options.points ?? 0;
  return { env, ...result };
}

async function login(env, platform, installationId) {
  const response = await handleMarketAuth(appleCredentialRequest(platform, installationId), env);
  assert.equal(response.status, 201);
  const { sessionToken } = await response.json();
  const principal = await authenticateMarketRequest(
    authenticatedRequest('/markets/account', sessionToken), env,
  );
  return { sessionToken, principal, user: env.repo.users.get(principal.userId) };
}

function rankedFixture(id, pointsBalance, balanceChangedAt) {
  return {
    id, publicId: `public-${id}`, appleSubjectHash: `subject-${id}`, nickname: `Rank ${id}`,
    pointsBalance, pointsEarnedTotal: pointsBalance, leaderboardVisible: true,
    balanceChangedAt, status: 'active', createdAt: 1, updatedAt: 1,
  };
}

function ledgerFixture(id, userId, createdAt, amount) {
  return {
    id, userId, deviceId: `private-device-${id}`, kind: amount > 0 ? 'online_credit' : 'message_debit',
    amount, balanceAfter: 9, referenceType: 'private-reference', referenceId: `ref-${id}`,
    idempotencyKey: `key-${id}`, createdAt,
  };
}

function seedDeletableState(env, user, deviceId) {
  env.repo.messages.set('message-1', {
    id: 'message-1', userId: user.id, status: 'active', text: 'account message',
  });
  env.repo.reports.set('report-1', { id: 'report-1', messageId: 'message-1' });
  env.repo.leases.set(deviceId, { deviceId, userId: user.id });
  const entry = ledgerFixture('ledger-1', user.id, env.NOW(), 1);
  env.repo.ledger.set(entry.idempotencyKey, entry);
}

function stateSizes(env) {
  return Object.fromEntries(
    ['users', 'credentials', 'devices', 'sessions', 'leases', 'ledger', 'messages', 'reports']
      .map((key) => [key, env.repo[key].size]),
  );
}

function snapshotState(env) {
  return Object.fromEntries(
    ['users', 'credentials', 'devices', 'sessions', 'leases', 'ledger', 'messages', 'reports']
      .map((key) => [key, JSON.stringify([...env.repo[key]])]),
  );
}

async function json(response) {
  assert.equal(response.status, 200);
  return response.json();
}
