import test from 'node:test';
import assert from 'node:assert/strict';
import { handleMessages, normalizeRoomId, classifyText, toPublicMessage } from '../src/messages.js';
import marketWorker, { moderatorCredentialsMatch } from '../src/worker.js';
import {
  authenticatedPostMessage,
  createMessageAccountEnv,
} from './helpers/market-account-fakes.mjs';

test('normalizeRoomId keeps a concrete room and rejects malformed input', () => {
  assert.equal(normalizeRoomId(' XAU '), 'XAU');
  assert.equal(normalizeRoomId('CURRENT_NEWS'), 'CURRENT_NEWS');
  assert.equal(normalizeRoomId('XAU<script>'), '');
});

test('classifyText rejects URLs, personal contact and guaranteed-return solicitation', () => {
  assert.equal(classifyText('加我微信 abc123').allowed, false);
  assert.equal(classifyText('https://example.com 进群').allowed, false);
  assert.equal(classifyText('跟单保证收益').allowed, false);
  assert.equal(classifyText('今晚关注美元和实际利率').allowed, true);
});

test('toPublicMessage never exposes private author fields', () => {
  const result = toPublicMessage({
    id: 'm1', room_id: 'XAU', nickname: 'A', text: '观察',
    created_at: 1, expires_at: 2, author_key: 'opaque', author_hash: 'secret',
    user_id: 'private-user', point_ledger_id: 'private-ledger', request_key: 'private-key',
  });
  assert.deepEqual(result, {
    id: 'm1', roomId: 'XAU', nickname: 'A', text: '观察',
    createdAt: 1, expiresAt: 2, authorKey: 'opaque',
  });
});

test('public reads bind the requested room and active status only', async () => {
  const { response, bindings } = await requestMessages('https://unit.test/markets/messages?room=XAU');

  assert.equal(response.status, 200);
  assert.deepEqual(bindings.slice(0, 3), ['XAU', 'active', 1_000_000]);
});

test('OPTIONS permits authenticated idempotent publishing headers', async () => {
  const response = await handleMessages(new Request('https://unit.test/markets/messages', {
    method: 'OPTIONS',
    headers: {
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'authorization,content-type,idempotency-key',
      Origin: 'https://lynncat.com',
    },
  }), createMessageAccountEnv());
  const allowedHeaders = response.headers.get('Access-Control-Allow-Headers')
    .toLowerCase().split(/\s*,\s*/);

  assert.equal(response.status, 204);
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), '*');
  assert.match(response.headers.get('Access-Control-Allow-Methods'), /\bPOST\b/);
  assert.deepEqual(allowedHeaders.sort(), ['authorization', 'content-type', 'idempotency-key']);
});

test('a third distinct report hides a public message and records an action', async () => {
  const result = await reportMessage({ messageId: 'm1', reporterIds: ['r1', 'r2', 'r3'] });

  assert.equal(result.messageStatus, 'hidden');
  assert.equal(result.moderationAction, 'auto_hidden_after_reports');
  assert.equal(result.batchCount, 1);
});

test('report responses return the final persisted message status', async () => {
  const db = createFakeD1({ messages: [{ id: 'm1', status: 'active' }] });
  const env = createEnv(db);

  for (const reporterId of ['r1', 'r2']) {
    const response = await handleMessages(reportRequest('m1', reporterId), env);
    assert.equal(response.status, 201);
  }

  db.afterBatch = () => {
    db.messages.find((message) => message.id === 'm1').status = 'removed';
  };
  const response = await handleMessages(reportRequest('m1', 'r3'), env);

  assert.equal(response.status, 201);
  assert.equal((await response.json()).messageStatus, 'removed');
});

test('required mode rejects a legacy guest POST before publishing or debiting', async () => {
  const env = createMessageAccountEnv({ points: 3, mode: 'required' });
  const response = await handleMessages(postMessage({
    roomId: 'XAU', text: '关注实际利率', clientId: 'guest-client-1234',
  }, { 'Idempotency-Key': 'guest-publish' }), env);

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: 'login_required' });
  assert.equal(env.repo.messages.size, 0);
  assert.equal(env.repo.ledger.size, 0);
});

test('disabled mode preserves legacy guest publishing, moderation, bans and guest-room cooldown', async () => {
  const env = createMessageAccountEnv({ points: 3, mode: 'disabled' });
  const first = await handleMessages(postMessage({
    roomId: 'XAU', text: '关注实际利率', nickname: 'Legacy', clientId: 'guest-client-1234',
  }), env);
  const sameGuestRoom = await handleMessages(postMessage({
    roomId: 'XAU', text: '第二条观点', clientId: 'guest-client-1234',
  }), env);
  const sameGuestOtherRoom = await handleMessages(postMessage({
    roomId: 'EURUSD', text: '欧元观点', clientId: 'guest-client-1234',
  }), env);
  const otherGuestSameRoom = await handleMessages(postMessage({
    roomId: 'XAU', text: '另一位访客', clientId: 'other-guest-1234',
  }, { Authorization: 'Bearer malformed' }), env);
  const moderated = await handleMessages(postMessage({
    roomId: 'XAU', text: '加我微信', clientId: 'moderated-guest-1234',
  }), env);
  env.DB.banGuest('banned-guest-1234');
  const banned = await handleMessages(postMessage({
    roomId: 'XAU', text: '正常观点', clientId: 'banned-guest-1234',
  }), env);

  assert.deepEqual(
    [first.status, sameGuestRoom.status, sameGuestOtherRoom.status, otherGuestSameRoom.status],
    [201, 429, 201, 201],
  );
  assert.equal((await first.json()).message.nickname, 'Legacy');
  assert.equal((await sameGuestRoom.json()).error, 'cooldown');
  assert.deepEqual(await moderated.json(), { error: 'unsafe_financial_solicitation' });
  assert.deepEqual(await banned.json(), { error: 'author_banned' });
  assert.equal(env.repo.messages.size, 3);
  assert.equal(env.repo.ledger.size, 0);
  assert.equal(env.repo.user.pointsBalance, 3);
});

test('optional mode keeps headerless legacy posts but authenticates any Authorization attempt', async () => {
  const guestEnv = createMessageAccountEnv({ points: 3, mode: 'optional' });
  const guest = await handleMessages(postMessage({
    roomId: 'XAU', text: '访客观点', clientId: 'guest-client-1234',
  }), guestEnv);

  const malformedEnv = createMessageAccountEnv({ points: 3, mode: 'optional' });
  const malformed = await handleMessages(postMessage({
    roomId: 'XAU', text: '不应降级', clientId: 'guest-client-1234',
  }, { Authorization: 'Bearer bad' }), malformedEnv);

  assert.equal(guest.status, 201);
  assert.equal(guestEnv.repo.ledger.size, 0);
  assert.equal(malformed.status, 401);
  assert.deepEqual(await malformed.json(), { error: 'login_required' });
  assert.equal(malformedEnv.repo.messages.size, 0);
  assert.equal(malformedEnv.repo.ledger.size, 0);
});

test('optional mode authenticated POST atomically debits three points and publishes once', async () => {
  const env = createMessageAccountEnv({ points: 3, nickname: 'Server Name', mode: 'optional' });
  const request = authenticatedPostMessage({
    roomId: 'XAU', text: '关注实际利率', requestKey: 'publish-1',
    nickname: 'Spoofed Name', clientId: 'spoofed-client-1234',
  });

  const first = await handleMessages(request, env);
  const duplicate = await handleMessages(request, env);
  const firstBody = await first.json();
  const duplicateBody = await duplicate.json();
  const message = [...env.repo.messages.values()][0];
  const ledger = [...env.repo.ledger.values()][0];

  assert.equal(first.status, 201);
  assert.equal(duplicate.status, 200);
  assert.deepEqual(duplicateBody, firstBody);
  assert.equal(firstBody.pointsBalance, 0);
  assert.equal(firstBody.message.nickname, 'Server Name');
  assert.equal(firstBody.message.expiresAt - firstBody.message.createdAt, 24 * 60 * 60 * 1000);
  assert.equal(env.repo.user.pointsBalance, 0);
  assert.equal(env.repo.messages.size, 1);
  assert.equal(env.repo.ledger.size, 1);
  assert.equal(message.userId, env.repo.user.id);
  assert.equal(message.pointLedgerId, ledger.id);
  assert.equal(message.requestKey, 'publish-1');
  assert.equal(ledger.userId, env.repo.user.id);
  assert.equal(ledger.deviceId, env.defaultAccount.deviceId);
  assert.equal(ledger.kind, 'message_debit');
  assert.equal(ledger.amount, -3);
  assert.equal(ledger.balanceAfter, 0);
  assert.equal(ledger.referenceType, 'message');
  assert.equal(ledger.referenceId, message.id);
  assert.deepEqual(env.DB.publishBatches, [
    ['message_insert', 'ledger_insert', 'balance_update'],
  ]);
});

test('a retained owner replay returns before purge or another publish batch', async () => {
  const env = createMessageAccountEnv({ points: 6 });
  const request = authenticatedPostMessage({
    roomId: 'XAU', text: '保留期内观点', requestKey: 'retained-replay',
  });
  const first = await handleMessages(request, env);
  const firstBody = await first.json();
  env.advance((24 * 60 * 60 * 1000) - 1);
  const batchCount = env.DB.publishBatches.length;

  const replay = await handleMessages(request, env);

  assert.equal(replay.status, 200);
  assert.deepEqual((await replay.json()).message, firstBody.message);
  assert.equal(env.DB.publishBatches.length, batchCount);
  assert.equal(env.repo.messages.size, 1);
  assert.equal(env.repo.ledger.size, 1);
  assert.equal(env.repo.user.pointsBalance, 3);
});

test('an owner replay at expiresAt returns publish_conflict and removes expired content', async () => {
  const env = createMessageAccountEnv({ points: 3 });
  const request = authenticatedPostMessage({
    roomId: 'XAU', text: '到期观点', requestKey: 'expired-replay',
  });
  const first = await handleMessages(request, env);
  assert.equal(first.status, 201);
  env.advance(24 * 60 * 60 * 1000);
  const batchCount = env.DB.publishBatches.length;

  const replay = await handleMessages(request, env);

  assert.equal(replay.status, 409);
  assert.deepEqual(await replay.json(), { error: 'publish_conflict' });
  assert.equal(env.DB.publishBatches.length, batchCount);
  assert.equal(env.repo.messages.size, 0);
  assert.equal(env.repo.ledger.size, 1);
  assert.equal(env.repo.user.pointsBalance, 0);
});

test('a previously purged owner request key returns owner-safe publish_conflict', async () => {
  const env = createMessageAccountEnv({ points: 3 });
  const request = authenticatedPostMessage({
    roomId: 'XAU', text: '已清理观点', requestKey: 'purged-replay',
  });
  const first = await handleMessages(request, env);
  assert.equal(first.status, 201);
  env.repo.messages.clear();
  const batchCount = env.DB.publishBatches.length;

  const replay = await handleMessages(request, env);

  assert.equal(replay.status, 409);
  assert.deepEqual(await replay.json(), { error: 'publish_conflict' });
  assert.equal(env.DB.publishBatches.length, batchCount);
  assert.equal(env.repo.messages.size, 0);
  assert.equal(env.repo.ledger.size, 1);
  assert.equal(env.repo.user.pointsBalance, 0);
});

test('a later publish batch failure rolls back message ledger and balance', async () => {
  const env = createMessageAccountEnv({ points: 3 });
  env.DB.failNextPublishBatchAt = 'balance_update';

  const response = await handleMessages(authenticatedPostMessage({
    roomId: 'XAU', text: '事务失败观点', requestKey: 'batch-failure',
  }), env);

  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: 'publish_unavailable' });
  assert.equal(env.repo.messages.size, 0);
  assert.equal(env.repo.ledger.size, 0);
  assert.equal(env.repo.user.pointsBalance, 3);
});

test('another user cannot reveal or reuse an existing request key', async () => {
  const env = createMessageAccountEnv({ points: 6 });
  const other = env.addAccount({
    userId: 'user-other', deviceId: 'device-other', token: 'other-session-token', points: 6,
  });
  const first = await handleMessages(authenticatedPostMessage({
    roomId: 'XAU', text: '第一位用户观点', requestKey: 'shared-key',
  }), env);
  const second = await handleMessages(authenticatedPostMessage({
    roomId: 'EURUSD', text: '第二位用户观点', requestKey: 'shared-key', token: other.token,
  }), env);

  assert.equal(first.status, 201);
  assert.equal(second.status, 409);
  assert.deepEqual(await second.json(), { error: 'publish_conflict' });
  assert.equal(env.repo.messages.size, 1);
  assert.equal(env.repo.ledger.size, 1);
  assert.equal(env.repo.users.get(other.userId).pointsBalance, 6);
});

test('a request key already used by a non-message ledger cannot create an uncharged message', async () => {
  const env = createMessageAccountEnv({ points: 3 });
  env.repo.ledger.set('credit-key', {
    id: 'credit-ledger',
    userId: env.repo.user.id,
    deviceId: env.defaultAccount.deviceId,
    kind: 'online_credit',
    amount: 1,
    balanceAfter: 3,
    idempotencyKey: 'credit-key',
    createdAt: env.NOW() - 1_000,
  });

  const response = await handleMessages(authenticatedPostMessage({
    roomId: 'XAU', text: '正常观点', requestKey: 'credit-key',
  }), env);

  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { error: 'publish_conflict' });
  assert.equal(env.repo.messages.size, 0);
  assert.equal(env.repo.ledger.size, 1);
  assert.equal(env.repo.user.pointsBalance, 3);
});

test('moderation, cooldown, insufficient points and bans never debit', async () => {
  const scenarios = [
    {
      name: 'moderation', points: 10, text: '加我微信', status: 422,
      error: 'unsafe_financial_solicitation',
    },
    {
      name: 'cooldown', points: 10, text: '正常观点', status: 429,
      error: 'cooldown', existingMessage: true,
    },
    {
      name: 'insufficient', points: 2, text: '正常观点', status: 422,
      error: 'insufficient_points',
    },
    {
      name: 'ban', points: 10, text: '正常观点', status: 403,
      error: 'author_banned', banned: true,
    },
  ];

  for (const scenario of scenarios) {
    const env = createMessageAccountEnv({
      points: scenario.points,
      existingMessage: scenario.existingMessage,
      banned: scenario.banned,
    });
    const originalMessageCount = env.repo.messages.size;
    const response = await handleMessages(authenticatedPostMessage({
      roomId: 'XAU', text: scenario.text, requestKey: scenario.name,
    }), env);

    assert.equal(response.status, scenario.status, scenario.name);
    assert.equal((await response.json()).error, scenario.error, scenario.name);
    assert.equal(env.repo.ledger.size, 0, scenario.name);
    assert.equal(env.repo.messages.size, originalMessageCount, scenario.name);
    assert.equal(env.repo.user.pointsBalance, scenario.points, scenario.name);
  }
});

test('missing and malformed idempotency keys never debit or publish', async () => {
  for (const requestKey of [undefined, ' ', 'bad key', 'x'.repeat(201)]) {
    const env = createMessageAccountEnv({ points: 3 });
    const response = await handleMessages(authenticatedPostMessage({
      roomId: 'XAU', text: '正常观点', requestKey,
    }), env);

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: 'missing_idempotency_key' });
    assert.equal(env.repo.ledger.size, 0);
    assert.equal(env.repo.messages.size, 0);
    assert.equal(env.repo.user.pointsBalance, 3);
  }
});

test('expired and revoked authentication never debit or publish', async () => {
  for (const sessionState of ['expired', 'revoked']) {
    const env = createMessageAccountEnv({ points: 3, sessionState });
    const response = await handleMessages(authenticatedPostMessage({
      roomId: 'XAU', text: '正常观点', requestKey: sessionState,
    }), env);

    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: `session_${sessionState}` });
    assert.equal(env.repo.ledger.size, 0);
    assert.equal(env.repo.messages.size, 0);
    assert.equal(env.repo.user.pointsBalance, 3);
  }
});

test('concurrent requests cannot overspend a three-point balance', async () => {
  const env = createMessageAccountEnv({ points: 3 });
  const responses = await Promise.all([
    handleMessages(authenticatedPostMessage({ roomId: 'XAU', text: '观点一', requestKey: 'race-1' }), env),
    handleMessages(authenticatedPostMessage({ roomId: 'EURUSD', text: '观点二', requestKey: 'race-2' }), env),
  ]);

  assert.deepEqual(responses.map((response) => response.status).sort(), [201, 422]);
  assert.equal(env.repo.messages.size, 1);
  assert.equal(env.repo.ledger.size, 1);
  assert.equal(env.repo.user.pointsBalance, 0);
});

test('concurrent requests cannot bypass the same-user same-room cooldown', async () => {
  const env = createMessageAccountEnv({ points: 6 });
  const responses = await Promise.all([
    handleMessages(authenticatedPostMessage({ roomId: 'XAU', text: '观点一', requestKey: 'cooldown-1' }), env),
    handleMessages(authenticatedPostMessage({ roomId: 'XAU', text: '观点二', requestKey: 'cooldown-2' }), env),
  ]);

  assert.deepEqual(responses.map((response) => response.status).sort(), [201, 429]);
  assert.equal(env.repo.messages.size, 1);
  assert.equal(env.repo.ledger.size, 1);
  assert.equal(env.repo.user.pointsBalance, 3);
});

test('cooldown is scoped per user and per room with stable user-derived author keys', async () => {
  const env = createMessageAccountEnv({ points: 9 });
  const other = env.addAccount({
    userId: 'user-other', deviceId: 'device-other', token: 'other-session-token', points: 3,
  });
  const first = await handleMessages(authenticatedPostMessage({
    roomId: 'XAU', text: '黄金观点', requestKey: 'scope-1', clientId: 'first-client-1234',
  }), env);
  const otherRoom = await handleMessages(authenticatedPostMessage({
    roomId: 'EURUSD', text: '欧元观点', requestKey: 'scope-2', clientId: 'second-client-1234',
  }), env);
  const otherUser = await handleMessages(authenticatedPostMessage({
    roomId: 'XAU', text: '另一用户观点', requestKey: 'scope-3', token: other.token,
  }), env);
  const sameRoom = await handleMessages(authenticatedPostMessage({
    roomId: 'XAU', text: '冷却中观点', requestKey: 'scope-4',
  }), env);
  const ownMessages = [...env.repo.messages.values()].filter((message) => message.userId === env.repo.user.id);

  assert.deepEqual([first.status, otherRoom.status, otherUser.status, sameRoom.status], [201, 201, 201, 429]);
  assert.equal(ownMessages.length, 2);
  assert.equal(ownMessages[0].authorHash, ownMessages[1].authorHash);
  assert.equal(ownMessages[0].authorKey, ownMessages[1].authorKey);
  assert.notEqual(ownMessages[0].authorKey, [...env.repo.messages.values()].find((message) => message.userId === other.userId).authorKey);
});

test('moderation reports require Basic authentication', async () => {
  const db = createFakeD1();
  const env = createEnv(db);
  env.MODERATION_USERNAME = 'moderator';
  env.MODERATION_PASSWORD = 'correct horse battery staple';
  env.ASSETS = { fetch: async () => new Response('asset') };

  const rejected = await marketWorker.fetch(
    new Request('https://unit.test/markets/moderation/api/reports'), env, {},
  );
  const accepted = await marketWorker.fetch(
    new Request('https://unit.test/markets/moderation/api/reports', {
      headers: { Authorization: basicAuth('moderator', 'correct horse battery staple') },
    }), env, {},
  );

  assert.equal(rejected.status, 401);
  assert.match(rejected.headers.get('WWW-Authenticate'), /^Basic /);
  assert.equal(accepted.status, 200);
  assert.deepEqual(await accepted.json(), { reports: [] });
});

test('moderation reports honor the requested report status', async () => {
  const db = createFakeD1();
  const env = moderatorEnv(db);

  const response = await marketWorker.fetch(new Request(
    'https://unit.test/markets/moderation/api/reports?status=open',
    { headers: moderatorHeaders() },
  ), env, {});

  assert.equal(response.status, 200);
  assert.equal(db.bindings.at(-1), 'open');
});

test('moderator authentication compares username and password when username mismatches', () => {
  const comparisons = [];
  const authorized = moderatorCredentialsMatch(
    'wrong-user',
    'correct-password',
    'moderator',
    'correct-password',
    (actual, expected) => {
      comparisons.push([actual, expected]);
      return actual === expected;
    },
  );

  assert.equal(authorized, false);
  assert.deepEqual(comparisons, [
    ['wrong-user', 'moderator'],
    ['correct-password', 'correct-password'],
  ]);
});

test('moderator message updates batch the state mutation with its audit action', async () => {
  const db = createFakeD1({ messages: [{ id: 'm1', status: 'active' }] });
  const env = moderatorEnv(db);

  const response = await marketWorker.fetch(new Request(
    'https://unit.test/markets/moderation/api/messages/m1',
    {
      method: 'PUT',
      headers: moderatorHeaders(),
      body: JSON.stringify({ status: 'hidden', note: 'reviewed' }),
    },
  ), env, {});

  assert.equal(response.status, 200);
  assert.equal(db.batchCount, 1);
  assert.equal(db.actions.at(-1)?.action, 'message_hidden');
});

test('moderator author bans batch every author mutation with the audit action', async () => {
  const db = createFakeD1({ messages: [
    { id: 'm1', author_key: 'author-key', author_hash: 'hash-1', status: 'active' },
    { id: 'm2', author_key: 'author-key', author_hash: 'hash-2', status: 'active' },
  ] });
  const env = moderatorEnv(db);

  const response = await marketWorker.fetch(new Request(
    'https://unit.test/markets/moderation/api/authors/author-key',
    {
      method: 'PUT',
      headers: moderatorHeaders(),
      body: JSON.stringify({ action: 'ban', note: 'reviewed' }),
    },
  ), env, {});

  assert.equal(response.status, 200);
  assert.equal(db.batchCount, 1);
  assert.equal(db.bannedAuthors.size, 2);
  assert.equal(db.actions.at(-1)?.action, 'author_banned');
});

test('moderator ban blocks a new key while retained same-key replay returns the original', async () => {
  const env = createMessageAccountEnv({ points: 9 });
  Object.assign(env, {
    MODERATION_USERNAME: 'moderator',
    MODERATION_PASSWORD: 'secret',
    ASSETS: { fetch: async () => new Response('asset') },
  });
  const originalRequest = authenticatedPostMessage({
    roomId: 'XAU', text: '原始观点', requestKey: 'ban-original',
  });
  const published = await handleMessages(originalRequest, env);
  const publishedBody = await published.json();

  const banned = await marketWorker.fetch(new Request(
    `https://unit.test/markets/moderation/api/authors/${publishedBody.message.authorKey}`,
    {
      method: 'PUT',
      headers: moderatorHeaders(),
      body: JSON.stringify({ action: 'ban', note: 'reviewed' }),
    },
  ), env, {});
  assert.equal(banned.status, 200);

  const beforeBlockedPost = {
    balance: env.repo.user.pointsBalance,
    messages: env.repo.messages.size,
    ledger: env.repo.ledger.size,
  };
  const blocked = await handleMessages(authenticatedPostMessage({
    roomId: 'EURUSD', text: '封禁后新观点', requestKey: 'ban-new',
  }), env);
  const replay = await handleMessages(originalRequest, env);
  const replayBody = await replay.json();

  assert.equal(blocked.status, 403);
  assert.deepEqual(await blocked.json(), { error: 'author_banned' });
  assert.equal(replay.status, 200);
  assert.deepEqual(replayBody.message, publishedBody.message);
  assert.equal(replayBody.pointsBalance, beforeBlockedPost.balance);
  assert.deepEqual({
    balance: env.repo.user.pointsBalance,
    messages: env.repo.messages.size,
    ledger: env.repo.ledger.size,
  }, beforeBlockedPost);
});

function createEnv(DB) {
  return {
    DB,
    AUTHOR_HASH_SALT: 'hash-salt',
    AUTHOR_KEY_SECRET: 'key-secret',
    NOW: 1_000_000,
  };
}

function postMessage(body, headers = {}) {
  return new Request('https://example.test/markets/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

function basicAuth(username, password) {
  return `Basic ${btoa(`${username}:${password}`)}`;
}

function moderatorHeaders() {
  return {
    Authorization: basicAuth('moderator', 'secret'),
    'Content-Type': 'application/json',
  };
}

function moderatorEnv(db) {
  return {
    ...createEnv(db),
    MODERATION_USERNAME: 'moderator',
    MODERATION_PASSWORD: 'secret',
    ASSETS: { fetch: async () => new Response('asset') },
  };
}

async function requestMessages(url) {
  const db = createFakeD1();
  const response = await handleMessages(new Request(url), createEnv(db));
  return { response, bindings: db.bindings };
}

async function reportMessage({ messageId, reporterIds }) {
  const db = createFakeD1({ messages: [{ id: messageId, status: 'active' }] });
  const env = createEnv(db);

  for (const reporterId of reporterIds) {
    const response = await handleMessages(reportRequest(messageId, reporterId), env);
    assert.equal(response.status, 201);
  }

  return {
    messageStatus: db.messages.find((message) => message.id === messageId)?.status,
    moderationAction: db.actions.at(-1)?.action,
    batchCount: db.batchCount,
  };
}

function reportRequest(messageId, reporterId) {
  return new Request(`https://unit.test/markets/messages/${messageId}/reports`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reporterId, reason: 'spam' }),
  });
}

function createFakeD1({ synchronizeCooldownReads = false, messages = [], bannedAuthorHashes = [] } = {}) {
  const rows = messages.map((message) => ({ ...message }));
  const reports = [];
  const bannedAuthors = new Map(bannedAuthorHashes.map((authorHash) => [authorHash, { author_hash: authorHash }]));
  let cooldownReadCount = 0;
  let releaseCooldownReads;
  const cooldownReadBarrier = new Promise((resolve) => {
    releaseCooldownReads = resolve;
  });
  const db = {
    bindings: [],
    messages: rows,
    actions: [],
    reports,
    bannedAuthors,
    batchCount: 0,
    inserts: [],
    writeCount: 0,
    identityLookupCount: 0,
    conditionalInsertUsed: false,
    async batch(statements) {
      db.batchCount += 1;
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      db.afterBatch?.();
      return results;
    },
    prepare(sql) {
      return {
        bind(...values) {
          db.bindings.push(...values);
          return {
            async run() {
              if (/^\s*DELETE/i.test(sql)) {
                if (/market_messages/i.test(sql)) {
                  const [now] = values;
                  for (let index = rows.length - 1; index >= 0; index -= 1) {
                    if (Number(rows[index].expires_at) < now) rows.splice(index, 1);
                  }
                }
                if (/market_banned_authors/i.test(sql)) bannedAuthors.delete(values[0]);
                db.writeCount += 1;
                return { success: true };
              }
              if (/INSERT\s+INTO\s+market_banned_authors/i.test(sql)) {
                const [authorHash, bannedAt, note] = values;
                bannedAuthors.set(authorHash, { author_hash: authorHash, banned_at: bannedAt, note });
                db.writeCount += 1;
                return { success: true, meta: { changes: 1 } };
              }
              if (/INSERT\s+INTO\s+market_reports/i.test(sql)) {
                const [id, messageId, reporterHash, reason, note, createdAt] = values;
                const duplicate = reports.some((report) => report.message_id === messageId && report.reporter_hash === reporterHash);
                if (duplicate) return { success: true, meta: { changes: 0 } };
                reports.push({ id, message_id: messageId, reporter_hash: reporterHash, reason, note, status: 'open', created_at: createdAt });
                db.writeCount += 1;
                return { success: true, meta: { changes: 1 } };
              }
              if (/INSERT\s+INTO\s+market_moderation_actions/i.test(sql)) {
                const [id, targetType, targetId, action, note, createdAt] = values;
                db.actions.push({ id, target_type: targetType, target_id: targetId, action, note, created_at: createdAt });
                db.writeCount += 1;
                return { success: true, meta: { changes: 1 } };
              }
              if (/UPDATE\s+market_messages\s+SET\s+status\s*=\s*'hidden'/i.test(sql)) {
                const [hiddenAt, messageId] = values;
                const message = rows.find((row) => row.id === messageId && row.status === 'active');
                if (!message) return { success: true, meta: { changes: 0 } };
                message.status = 'hidden';
                message.hidden_at = hiddenAt;
                db.writeCount += 1;
                return { success: true, meta: { changes: 1 } };
              }
              if (/UPDATE\s+market_messages\s+SET\s+status\s*=\s*\?/i.test(sql)) {
                const status = values[0];
                const messageId = values.at(-1);
                const message = rows.find((row) => row.id === messageId);
                if (!message) return { success: true, meta: { changes: 0 } };
                message.status = status;
                db.writeCount += 1;
                return { success: true, meta: { changes: 1 } };
              }
              if (/^\s*INSERT/i.test(sql)) {
                const [id, roomId, nickname, text, authorHash, authorKey, createdAt, expiresAt] = values;
                if (/WHERE NOT EXISTS/i.test(sql)) {
                  db.conditionalInsertUsed = true;
                  const [, , , , , , , , cooldownAuthorHash, cooldownRoomId, cooldownCutoff] = values;
                  const isCoolingDown = rows.some((row) => (
                    row.author_hash === cooldownAuthorHash
                    && row.room_id === cooldownRoomId
                    && row.created_at > cooldownCutoff
                  ));
                  if (isCoolingDown) return { success: true, meta: { changes: 0 } };
                }
                const row = {
                  id, room_id: roomId, nickname, text, author_hash: authorHash, author_key: authorKey,
                  status: 'active', created_at: createdAt, expires_at: expiresAt,
                };
                rows.push(row);
                db.inserts.push(row);
                db.writeCount += 1;
                return { success: true, meta: { changes: 1 } };
              }
              throw new Error(`Unsupported fake D1 write: ${sql}`);
            },
            async first() {
              db.identityLookupCount += 1;
              if (/market_banned_authors/i.test(sql)) {
                return bannedAuthors.has(values[0]) ? { 1: 1 } : null;
              }
              if (/SELECT\s+id,\s*status\s+FROM\s+market_messages/i.test(sql)) {
                return rows.find((row) => row.id === values[0]) || null;
              }
              if (/COUNT\(\*\)\s+AS\s+count\s+FROM\s+market_reports/i.test(sql)) {
                return { count: reports.filter((report) => report.message_id === values[0] && report.status === 'open').length };
              }
              const [authorHash, roomId] = values;
              if (synchronizeCooldownReads && !db.conditionalInsertUsed && /SELECT\s+created_at\s+FROM/i.test(sql)) {
                cooldownReadCount += 1;
                if (cooldownReadCount === 2) releaseCooldownReads();
                await cooldownReadBarrier;
              }
              return rows
                .filter((row) => row.author_hash === authorHash && (roomId === undefined || row.room_id === roomId))
                .sort((a, b) => b.created_at - a.created_at)[0] || null;
            },
            async all() {
              if (/SELECT\s+DISTINCT\s+author_hash\s+FROM\s+market_messages/i.test(sql)) {
                const hashes = new Set(rows.filter((row) => row.author_key === values[0]).map((row) => row.author_hash));
                return { results: [...hashes].filter(Boolean).map((author_hash) => ({ author_hash })) };
              }
              if (/FROM\s+market_messages/i.test(sql) && /room_id\s*=\s*\?/i.test(sql)) {
                const [roomId, status, now] = values;
                return {
                  results: rows
                    .filter((row) => row.room_id === roomId && row.status === status && Number(row.expires_at) > now)
                    .sort((a, b) => b.created_at - a.created_at)
                    .slice(0, 50),
                };
              }
              if (/FROM\s+market_reports/i.test(sql)) return { results: reports };
              return { results: [] };
            },
          };
        },
      };
    },
  };
  return db;
}
