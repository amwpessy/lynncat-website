import test from 'node:test';
import assert from 'node:assert/strict';
import { handleMessages, normalizeRoomId, classifyText, toPublicMessage } from '../src/messages.js';

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

function createEnv(DB) {
  return {
    DB,
    AUTHOR_HASH_SALT: 'hash-salt',
    AUTHOR_KEY_SECRET: 'key-secret',
  };
}

function postMessage(body, headers = {}) {
  return new Request('https://example.test/markets/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

function createFakeD1() {
  const rows = [];
  const db = {
    inserts: [],
    writeCount: 0,
    identityLookupCount: 0,
    prepare(sql) {
      return {
        bind(...values) {
          return {
            async run() {
              if (/^\s*DELETE/i.test(sql)) {
                db.writeCount += 1;
                return { success: true };
              }
              if (/^\s*INSERT/i.test(sql)) {
                const [id, roomId, nickname, text, authorHash, authorKey, createdAt, expiresAt] = values;
                const row = { id, room_id: roomId, nickname, text, author_hash: authorHash, author_key: authorKey, created_at: createdAt, expires_at: expiresAt };
                rows.push(row);
                db.inserts.push(row);
                db.writeCount += 1;
                return { success: true };
              }
              throw new Error(`Unsupported fake D1 write: ${sql}`);
            },
            async first() {
              db.identityLookupCount += 1;
              const [authorHash, roomId] = values;
              return rows.find((row) => row.author_hash === authorHash && (roomId === undefined || row.room_id === roomId)) || null;
            },
          };
        },
      };
    },
  };
  return db;
}
