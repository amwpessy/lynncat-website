import test from 'node:test';
import assert from 'node:assert/strict';
import marketWorker, { marketPointsMode } from '../src/worker.js';
import { createMessageAccountEnv } from './helpers/market-account-fakes.mjs';

const ROUTES = [
  ['POST', '/markets/auth/apple'],
  ['POST', '/markets/auth/logout'],
  ['GET', '/markets/account'],
  ['DELETE', '/markets/account'],
  ['PUT', '/markets/account/profile'],
  ['POST', '/markets/points/heartbeat'],
  ['POST', '/markets/points/heartbeat/stop'],
  ['GET', '/markets/points/ledger'],
  ['GET', '/markets/leaderboard'],
];

test('account and point routes are registered before static assets', async () => {
  for (const [method, path] of ROUTES) {
    const env = workerEnv('optional');
    const response = await marketWorker.fetch(apiRequest(method, path), env, {});

    assert.notEqual(response.status, 404, `${method} ${path}`);
    assert.notEqual(response.status, 405, `${method} ${path}`);
    assert.equal(env.assetRequests.length, 0, `${method} ${path}`);
  }
});

test('unset and invalid rollout modes normalize to disabled', () => {
  assert.equal(marketPointsMode({}), 'disabled');
  assert.equal(marketPointsMode({ MARKET_POINTS_MODE: '' }), 'disabled');
  assert.equal(marketPointsMode({ MARKET_POINTS_MODE: 'OPTIONAL' }), 'disabled');
  assert.equal(marketPointsMode({ MARKET_POINTS_MODE: 'unexpected' }), 'disabled');
  assert.equal(marketPointsMode({ MARKET_POINTS_MODE: 'optional' }), 'optional');
  assert.equal(marketPointsMode({ MARKET_POINTS_MODE: 'required' }), 'required');
});

test('disabled, unset and invalid modes return no-store 503 for every account route', async () => {
  for (const mode of [undefined, 'disabled', 'unexpected']) {
    for (const [method, path] of ROUTES) {
      const env = workerEnv(mode);
      const response = await marketWorker.fetch(apiRequest(method, path), env, {});

      assert.equal(response.status, 503, `${String(mode)} ${method} ${path}`);
      assert.equal(response.headers.get('Cache-Control'), 'no-store');
      assert.equal(response.headers.get('Access-Control-Allow-Origin'), '*');
      assert.deepEqual(await response.json(), { error: 'market_points_disabled' });
      assert.equal(env.assetRequests.length, 0);
    }
  }
});

test('private account responses are no-store and omit storage-only fields', async () => {
  const env = workerEnv('optional');
  const response = await marketWorker.fetch(apiRequest('GET', '/markets/account', {
    Authorization: `Bearer ${env.defaultAccount.token}`,
  }), env, {});
  const text = await response.text();

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(response.headers.get('Access-Control-Allow-Origin'), '*');
  assert.doesNotMatch(text, /token_hash|apple_subject|installation_hash|sessionToken/);
});

test('market API OPTIONS is mode-independent and permits auth and idempotency headers', async () => {
  for (const mode of [undefined, 'disabled', 'optional', 'required']) {
    const env = workerEnv(mode);
    const response = await marketWorker.fetch(apiRequest('OPTIONS', '/markets/points/heartbeat', {
      Origin: 'https://lynncat.com',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'authorization,content-type,idempotency-key',
    }), env, {});
    const headers = response.headers.get('Access-Control-Allow-Headers')
      .toLowerCase().split(/\s*,\s*/).sort();

    assert.equal(response.status, 204, String(mode));
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    assert.deepEqual(headers, ['authorization', 'content-type', 'idempotency-key']);
  }
});

test('known routes reject wrong methods and unknown market API routes return stable JSON 404', async () => {
  const env = workerEnv('optional');
  const wrongMethod = await marketWorker.fetch(apiRequest('POST', '/markets/account'), env, {});
  const unknown = await marketWorker.fetch(apiRequest('GET', '/markets/account/unknown'), env, {});

  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongMethod.headers.get('Allow'), 'GET, DELETE, OPTIONS');
  assert.deepEqual(await wrongMethod.json(), { error: 'method_not_allowed' });
  assert.equal(unknown.status, 404);
  assert.deepEqual(await unknown.json(), { error: 'route_not_found' });
  assert.equal(unknown.headers.get('Cache-Control'), 'no-store');
  assert.equal(env.assetRequests.length, 0);
});

test('message reads and reports stay routed in every rollout mode', async () => {
  for (const mode of [undefined, 'disabled', 'optional', 'required']) {
    const env = workerEnv(mode);
    const read = await marketWorker.fetch(
      new Request('https://unit.test/markets/messages?room=XAU'), env, {},
    );
    const report = await marketWorker.fetch(new Request(
      'https://unit.test/markets/messages/missing/reports',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reporterId: 'reporter-123', reason: 'spam' }),
      },
    ), env, {});

    assert.equal(read.status, 200, String(mode));
    assert.equal(report.status, 404, String(mode));
    assert.equal(env.assetRequests.length, 0);
  }
});

function workerEnv(mode) {
  const env = createMessageAccountEnv();
  if (mode === undefined) delete env.MARKET_POINTS_MODE;
  else env.MARKET_POINTS_MODE = mode;
  env.assetRequests = [];
  env.ASSETS = {
    fetch: async (request) => {
      env.assetRequests.push(request.url);
      return new Response('asset response');
    },
  };
  return env;
}

function apiRequest(method, path, headers = {}) {
  return new Request(`https://unit.test${path}`, { method, headers });
}
