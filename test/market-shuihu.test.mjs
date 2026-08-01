import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { handleMarketAuth } from '../src/marketAuth.js';
import {
  handleMarketShuihuDraw,
  handleMarketShuihuStatus,
  randomShuihuCardId,
  SHUIHU_COMPLETION_REWARD,
} from '../src/marketPoints.js';
import {
  appleCredentialRequest,
  bearerRequest,
  createAccountEnv,
} from './helpers/market-account-fakes.mjs';

test('shuihu status reports authoritative balance, collection, and China-day draw limit', async () => {
  const { env, sessionToken } = await signedInEnv(6_000);
  env.repo.shuihuCollection.set(`${env.repo.user.id}:14`, {
    userId: env.repo.user.id,
    cardId: 14,
    copies: 2,
  });

  const response = await statusResponse(env, sessionToken);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.cards.pointsBalance, 6_000);
  assert.equal(body.cards.dailyLimit, 10);
  assert.equal(body.cards.drawsRemaining, 10);
  assert.equal(body.cards.uniqueCount, 1);
  assert.equal(body.cards.totalCopies, 2);
  assert.deepEqual(body.cards.collection, [{ cardId: 14, copies: 2 }]);
});

test('a shuihu draw costs 1000 points and uses only the server-selected card id', async () => {
  const { env, sessionToken } = await signedInEnv(4_000);
  env.RANDOM_SHUIHU_CARD_ID = 36;

  const response = await drawResponse(env, sessionToken, 'draw-first');
  const draw = (await response.json()).draw;

  assert.equal(response.status, 200);
  assert.equal(draw.cardId, 36);
  assert.equal(draw.cost, 1_000);
  assert.equal(draw.pointsBalance, 3_000);
  assert.equal(draw.drawsUsed, 1);
  assert.equal(draw.drawsRemaining, 9);
  assert.equal(draw.isNew, true);
  assert.equal(draw.copies, 1);
  assert.equal(env.repo.user.pointsBalance, 3_000);
});

test('shuihu draw retries are idempotent and do not charge twice', async () => {
  const { env, sessionToken } = await signedInEnv(4_000);
  env.RANDOM_SHUIHU_CARD_ID = 9;

  const first = (await (await drawResponse(env, sessionToken, 'draw-repeat')).json()).draw;
  env.RANDOM_SHUIHU_CARD_ID = 14;
  const repeated = (await (await drawResponse(env, sessionToken, 'draw-repeat')).json()).draw;

  assert.equal(repeated.cardId, first.cardId);
  assert.equal(repeated.copies, 1);
  assert.equal(repeated.pointsBalance, 3_000);
  assert.equal(env.repo.shuihuDraws.size, 1);
});

test('shuihu draws stop at 10 per China day', async () => {
  const { env, sessionToken } = await signedInEnv(20_000);
  let nextCard = 1;
  env.RANDOM_SHUIHU_CARD_ID = () => nextCard++;

  for (let index = 0; index < 10; index += 1) {
    const response = await drawResponse(env, sessionToken, `draw-limit-${index}`);
    assert.equal(response.status, 200);
  }
  const blocked = await drawResponse(env, sessionToken, 'draw-limit-11');

  assert.equal(blocked.status, 429);
  assert.deepEqual(await blocked.json(), { error: 'daily_draw_limit' });
  assert.equal(env.repo.user.pointsBalance, 10_000);
});

test('shuihu draw rejects an account with fewer than 1000 points', async () => {
  const { env, sessionToken } = await signedInEnv(999);
  env.RANDOM_SHUIHU_CARD_ID = 1;

  const response = await drawResponse(env, sessionToken, 'draw-no-points');

  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), { error: 'insufficient_points' });
  assert.equal(env.repo.shuihuDraws.size, 0);
});

test('collecting the 108th distinct card awards one million points exactly once', async () => {
  const { env, sessionToken } = await signedInEnv(3_000);
  const userId = env.repo.user.id;
  for (let cardId = 1; cardId < 108; cardId += 1) {
    env.repo.shuihuCollection.set(`${userId}:${cardId}`, {
      userId,
      cardId,
      copies: 1,
    });
  }
  env.RANDOM_SHUIHU_CARD_ID = 108;

  const first = (await (await drawResponse(env, sessionToken, 'draw-complete')).json()).draw;
  const repeated = (await (await drawResponse(env, sessionToken, 'draw-complete')).json()).draw;

  assert.equal(first.uniqueCount, 108);
  assert.equal(first.rewardGranted, true);
  assert.equal(first.rewardAmount, SHUIHU_COMPLETION_REWARD);
  assert.equal(first.pointsBalance, 1_002_000);
  assert.equal(repeated.pointsBalance, 1_002_000);
  assert.equal(env.repo.shuihuRewards.size, 1);
});

test('uniform card selection uses rejection sampling across all 108 ids', async () => {
  assert.equal(randomShuihuCardId({ RANDOM_SHUIHU_CARD_ID: 1 }), 1);
  assert.equal(randomShuihuCardId({ RANDOM_SHUIHU_CARD_ID: 108 }), 108);
  const source = await readFile(new URL('../src/marketPoints.js', import.meta.url), 'utf8');
  assert.match(source, /sampleSpace - \(sampleSpace % SHUIHU_CARD_COUNT\)/);
  assert.match(source, /values\[0\] % SHUIHU_CARD_COUNT\) \+ 1/);
});

async function signedInEnv(points) {
  const env = createAccountEnv({ now: Date.parse('2026-07-24T06:00:00.000Z') });
  const login = await handleMarketAuth(appleCredentialRequest(), env);
  const { sessionToken } = await login.json();
  env.repo.user.pointsBalance = points;
  env.repo.user.pointsEarnedTotal = points;
  return { env, sessionToken };
}

function statusResponse(env, sessionToken) {
  return handleMarketShuihuStatus(new Request(
    'https://unit.test/markets/points/shuihu',
    { headers: { Authorization: bearerRequest(sessionToken).headers.get('Authorization') } },
  ), env);
}

function drawResponse(env, sessionToken, idempotencyKey) {
  return handleMarketShuihuDraw(new Request(
    'https://unit.test/markets/points/shuihu/draw',
    {
      method: 'POST',
      headers: {
        Authorization: bearerRequest(sessionToken).headers.get('Authorization'),
        'Idempotency-Key': idempotencyKey,
      },
    },
  ), env);
}
