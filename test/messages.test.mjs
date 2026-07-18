import test from 'node:test';
import assert from 'node:assert/strict';
import { handleMessages, normalizeRoomId, classifyText, toPublicMessage } from '../src/messages.js';
import marketWorker, { moderatorCredentialsMatch } from '../src/worker.js';

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

test('POST applies a guest cooldown independently to each room', async () => {
  const db = createFakeD1();
  const env = createEnv(db);
  const clientId = '8b497a28-9b48-4a89-8ba3-48ecb0c59dfe';

  const first = await handleMessages(postMessage({ roomId: 'XAU', text: '关注实际利率', clientId }), env);
  const second = await handleMessages(postMessage({ roomId: 'EURUSD', text: '关注欧洲央行', clientId }), env);

  assert.equal(first.status, 201);
  assert.equal(second.status, 201);
  assert.equal(db.inserts.length, 2);
});

test('POST atomically applies a guest cooldown to concurrent requests in one room', async () => {
  const db = createFakeD1({ synchronizeCooldownReads: true });
  const env = createEnv(db);
  const clientId = '8b497a28-9b48-4a89-8ba3-48ecb0c59dfe';

  const responses = await Promise.all([
    handleMessages(postMessage({ roomId: 'XAU', text: '关注实际利率', clientId }), env),
    handleMessages(postMessage({ roomId: 'XAU', text: '关注美元指数', clientId }), env),
  ]);

  assert.deepEqual(responses.map((response) => response.status).sort(), [201, 429]);
  assert.equal(db.inserts.length, 1);
});

test('POST requires a well-formed clientId and never falls back to request headers', async () => {
  for (const clientId of [undefined, ' ', 'bad identity']) {
    const db = createFakeD1();
    const response = await handleMessages(postMessage(
      { roomId: 'XAU', text: '关注实际利率', ...(clientId === undefined ? {} : { clientId }) },
      { 'CF-Connecting-IP': '203.0.113.10' },
    ), createEnv(db));

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: 'missing_guest_identity' });
    assert.equal(db.writeCount, 0);
  }
});

test('POST fails closed when an identity secret is missing or empty', async () => {
  const configurations = [
    { AUTHOR_HASH_SALT: undefined, AUTHOR_KEY_SECRET: 'key-secret' },
    { AUTHOR_HASH_SALT: 'hash-salt', AUTHOR_KEY_SECRET: ' ' },
  ];

  for (const configuration of configurations) {
    const db = createFakeD1();
    const response = await handleMessages(postMessage({
      roomId: 'XAU',
      text: '关注实际利率',
      clientId: '8b497a28-9b48-4a89-8ba3-48ecb0c59dfe',
    }), { DB: db, ...configuration });

    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { error: 'identity_configuration_unavailable' });
    assert.equal(db.writeCount, 0);
    assert.equal(db.identityLookupCount, 0);
  }
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

test('a moderator ban blocks future publishing by the matching author', async () => {
  const db = createFakeD1();
  const env = createEnv(db);
  env.MODERATION_USERNAME = 'moderator';
  env.MODERATION_PASSWORD = 'secret';
  env.ASSETS = { fetch: async () => new Response('asset') };
  const clientId = '8b497a28-9b48-4a89-8ba3-48ecb0c59dfe';

  const published = await handleMessages(postMessage({
    roomId: 'XAU', text: '关注实际利率', clientId,
  }), env);
  assert.equal(published.status, 201);
  const authorKey = db.inserts[0].author_key;

  const response = await marketWorker.fetch(new Request(
    `https://unit.test/markets/moderation/api/authors/${authorKey}`,
    {
      method: 'PUT',
      headers: {
        Authorization: basicAuth('moderator', 'secret'),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action: 'ban', note: 'repeated spam' }),
    },
  ), env, {});

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { authorKey, action: 'ban', affectedAuthors: 1 });
  assert.equal(db.bannedAuthors.has(db.inserts[0].author_hash), true);

  const blocked = await handleMessages(postMessage({
    roomId: 'EURUSD', text: '关注欧洲央行', clientId,
  }), env);
  assert.equal(blocked.status, 403);
  assert.deepEqual(await blocked.json(), { error: 'author_banned' });
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
