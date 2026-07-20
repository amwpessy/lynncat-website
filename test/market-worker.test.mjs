import test from 'node:test';
import assert from 'node:assert/strict';
import marketWorker, { marketPointsMode } from '../src/worker.js';
import { createMessageAccountEnv } from './helpers/market-account-fakes.mjs';

const ACCOUNT_ROUTES = [
  { path: '/markets/auth/apple', methods: ['POST'], wrongMethod: 'GET' },
  { path: '/markets/auth/logout', methods: ['POST'], wrongMethod: 'GET' },
  { path: '/markets/account', methods: ['GET', 'DELETE'], wrongMethod: 'POST' },
  { path: '/markets/account/profile', methods: ['PUT'], wrongMethod: 'GET' },
  { path: '/markets/points/heartbeat', methods: ['POST'], wrongMethod: 'GET' },
  { path: '/markets/points/heartbeat/stop', methods: ['POST'], wrongMethod: 'GET' },
  { path: '/markets/points/ledger', methods: ['GET'], wrongMethod: 'POST' },
  { path: '/markets/leaderboard', methods: ['GET'], wrongMethod: 'POST' },
];
const MESSAGE_ROUTES = [
  { path: '/markets/messages', methods: ['GET', 'POST'], wrongMethod: 'DELETE' },
  { path: '/markets/messages/missing/reports', methods: ['POST'], wrongMethod: 'GET' },
];
const KNOWN_ROUTES = [...ACCOUNT_ROUTES, ...MESSAGE_ROUTES];

test('account and point routes are registered before static assets', async () => {
  for (const { methods, path } of ACCOUNT_ROUTES) {
    for (const method of methods) {
      const env = workerEnv('optional');
      const response = await marketWorker.fetch(apiRequest(method, path), env, {});

      assert.notEqual(response.status, 404, `${method} ${path}`);
      assert.notEqual(response.status, 405, `${method} ${path}`);
      assert.equal(env.assetRequests.length, 0, `${method} ${path}`);
    }
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
    for (const { methods, path } of ACCOUNT_ROUTES) {
      for (const method of methods) {
        const env = workerEnv(mode);
        const response = await marketWorker.fetch(apiRequest(method, path), env, {});

        assert.equal(response.status, 503, `${String(mode)} ${method} ${path}`);
        assert.equal(response.headers.get('Cache-Control'), 'no-store');
        assert.equal(response.headers.get('Access-Control-Allow-Origin'), '*');
        assert.deepEqual(await response.json(), { error: 'market_points_disabled' });
        assert.equal(env.assetRequests.length, 0);
      }
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

test('every known route OPTIONS advertises only its methods and the shared request headers', async () => {
  for (const { path, methods } of KNOWN_ROUTES) {
    const env = workerEnv('optional');
    const response = await marketWorker.fetch(apiRequest('OPTIONS', path, {
      Origin: 'https://lynncat.com',
      'Access-Control-Request-Method': methods[0],
      'Access-Control-Request-Headers': 'authorization,content-type,idempotency-key',
    }), env, {});

    assert.equal(response.status, 204, path);
    assert.deepEqual(headerValues(response, 'Access-Control-Allow-Methods'), [...methods, 'OPTIONS'], path);
    assert.deepEqual(headerValues(response, 'Allow'), [...methods, 'OPTIONS'], path);
    assert.deepEqual(headerValues(response, 'Access-Control-Allow-Headers')
      .map((value) => value.toLowerCase()).sort(), [
      'authorization', 'content-type', 'idempotency-key',
    ], path);
    assert.equal(response.headers.get('Cache-Control'), 'no-store', path);
    assert.equal(env.assetRequests.length, 0, path);
  }
});

test('known routes reject wrong methods with route-specific Allow metadata', async () => {
  for (const { path, methods, wrongMethod } of KNOWN_ROUTES) {
    const env = workerEnv('optional');
    const response = await marketWorker.fetch(apiRequest(wrongMethod, path), env, {});

    assert.equal(response.status, 405, `${wrongMethod} ${path}`);
    assert.deepEqual(headerValues(response, 'Allow'), [...methods, 'OPTIONS'], path);
    assert.deepEqual(headerValues(response, 'Access-Control-Allow-Methods'), [...methods, 'OPTIONS'], path);
    assert.deepEqual(await response.json(), { error: 'method_not_allowed' }, path);
    assert.equal(response.headers.get('Cache-Control'), 'no-store', path);
    assert.equal(env.assetRequests.length, 0, path);
  }
});

test('unknown market API namespace OPTIONS returns 404 without claiming methods', async () => {
  for (const path of ['/markets/account/unknown', '/markets/messages/unknown']) {
    const env = workerEnv('optional');
    const response = await marketWorker.fetch(apiRequest('OPTIONS', path), env, {});

    assert.equal(response.status, 404, path);
    assert.deepEqual(await response.json(), { error: 'route_not_found' }, path);
    assert.equal(response.headers.get('Access-Control-Allow-Methods'), null, path);
    assert.equal(response.headers.get('Cache-Control'), 'no-store', path);
    assert.equal(env.assetRequests.length, 0, path);
  }
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

function headerValues(response, name) {
  const value = response.headers.get(name);
  return value ? value.split(/\s*,\s*/).filter(Boolean) : [];
}
