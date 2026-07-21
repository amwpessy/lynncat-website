import test from 'node:test';
import assert from 'node:assert/strict';

import { handleItnewRequest } from '../src/itnew/index.js';
import worker, { runScheduledJobs } from '../src/worker.js';

const ORIGIN = 'https://itnew.test';

function request(path, method = 'GET') {
  return new Request(`${ORIGIN}${path}`, { method });
}

function routeEnvironment() {
  const requests = [];
  return {
    requests,
    env: {
      ASSETS: {
        async fetch(assetRequest) {
          requests.push(assetRequest);
          return new Response(`asset:${new URL(assetRequest.url).pathname}`);
        },
      },
    },
  };
}

function routeHandlers(calls) {
  return {
    async admin(request) {
      calls.push(['admin', new URL(request.url).pathname]);
      return new Response('admin-api');
    },
    async public(request) {
      calls.push(['public', new URL(request.url).pathname]);
      return new Response('public-api');
    },
  };
}

test('itnew dispatcher sends admin APIs before public APIs and images', async () => {
  const calls = [];
  const configured = routeEnvironment();
  const handlers = routeHandlers(calls);

  for (const [path, body] of [
    ['/itnew/admin/api', 'admin-api'],
    ['/itnew/admin/api/session', 'admin-api'],
    ['/itnew/api', 'public-api'],
    ['/itnew/api/articles', 'public-api'],
    ['/itnew/images', 'public-api'],
    ['/itnew/images/articles/a/hero.png', 'public-api'],
  ]) {
    const response = await handleItnewRequest(request(path), configured.env, {}, handlers);
    assert.equal(await response.text(), body, path);
  }

  assert.deepEqual(calls, [
    ['admin', '/itnew/admin/api'],
    ['admin', '/itnew/admin/api/session'],
    ['public', '/itnew/api'],
    ['public', '/itnew/api/articles'],
    ['public', '/itnew/images'],
    ['public', '/itnew/images/articles/a/hero.png'],
  ]);
  assert.deepEqual(configured.requests, []);
});

test('article pages rewrite non-empty slugs to the canonical extensionless asset without redirecting the browser URL', async () => {
  const configured = routeEnvironment();
  const original = request('/itnew/article/real-slug?language=zh');
  const response = await handleItnewRequest(original, configured.env, {}, routeHandlers([]));

  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'asset:/itnew/article');
  assert.equal(original.url, `${ORIGIN}/itnew/article/real-slug?language=zh`);
  assert.equal(configured.requests.length, 1);
  assert.equal(new URL(configured.requests[0].url).pathname, '/itnew/article');

  await handleItnewRequest(request('/itnew/article/'), configured.env, {}, routeHandlers([]));
  assert.equal(new URL(configured.requests[1].url).pathname, '/itnew/article/');
});

test('itnew roots redirect to trailing slashes and static roots remain distinct asset requests', async () => {
  const configured = routeEnvironment();

  for (const [path, location] of [
    ['/itnew', `${ORIGIN}/itnew/`],
    ['/itnew/admin', `${ORIGIN}/itnew/admin/`],
  ]) {
    const response = await handleItnewRequest(request(path), configured.env, {}, routeHandlers([]));
    assert.equal(response.status, 308, path);
    assert.equal(response.headers.get('Location'), location, path);
  }

  for (const path of ['/itnew/', '/itnew/admin/', '/itnew/styles.css']) {
    const response = await handleItnewRequest(request(path), configured.env, {}, routeHandlers([]));
    assert.equal(await response.text(), `asset:${path}`, path);
  }
  assert.deepEqual(configured.requests.map((item) => new URL(item.url).pathname), [
    '/itnew/', '/itnew/admin/', '/itnew/styles.css',
  ]);
});

test('unknown itnew API is a JSON 404 and never falls through to static HTML', async () => {
  const configured = routeEnvironment();
  const response = await handleItnewRequest(
    request('/itnew/api/not-a-route'), configured.env, {},
  );

  assert.equal(response.status, 404);
  assert.match(response.headers.get('Content-Type'), /^application\/json/iu);
  assert.deepEqual(await response.json(), { error: 'not_found' });
  assert.deepEqual(configured.requests, []);
});

test('site worker dispatches itnew before its final asset fallback', async () => {
  const configured = routeEnvironment();
  const api = await worker.fetch(request('/itnew/api/not-a-route'), configured.env, {});
  assert.equal(api.status, 404);
  assert.match(api.headers.get('Content-Type'), /^application\/json/iu);
  assert.deepEqual(configured.requests, []);

  const asset = await worker.fetch(request('/itnew/static.css'), configured.env, {});
  assert.equal(await asset.text(), 'asset:/itnew/static.css');
  assert.equal(new URL(configured.requests[0].url).pathname, '/itnew/static.css');
});

async function captureScheduled(jobs) {
  const waited = [];
  const logs = [];
  const originalError = console.error;
  console.error = (...values) => logs.push(values);
  try {
    runScheduledJobs({ marker: 'env' }, (promise) => waited.push(promise), jobs);
    await Promise.all(waited);
  } finally {
    console.error = originalError;
  }
  return { waited, logs };
}

test('scheduled jobs both start immediately and register independent successful promises', async () => {
  const starts = [];
  const result = await captureScheduled({
    runNewsFetch(env) {
      starts.push(['news', env.marker]);
      return 'sync-success';
    },
    runItnewCollection(env) {
      starts.push(['itnew', env.marker]);
      return Promise.resolve('async-success');
    },
  });

  assert.deepEqual(starts, [['news', 'env'], ['itnew', 'env']]);
  assert.equal(result.waited.length, 2);
  assert.deepEqual(result.logs, []);
});

test('a synchronous job throw cannot block the other job and logs only a safe bounded error', async () => {
  const starts = [];
  const thrown = new Error('x'.repeat(800));
  thrown.name = 'CollectorError';
  thrown.headers = { Authorization: 'secret-header' };
  thrown.body = 'secret-body';
  thrown.secret = 'secret-value';

  const result = await captureScheduled({
    runNewsFetch() {
      starts.push('news');
      throw thrown;
    },
    runItnewCollection() {
      starts.push('itnew');
      return Promise.resolve();
    },
  });

  assert.deepEqual(starts, ['news', 'itnew']);
  assert.equal(result.waited.length, 2);
  assert.equal(result.logs.length, 1);
  assert.equal(result.logs[0][0], 'news_fetch_failed');
  assert.deepEqual(Object.keys(result.logs[0][1]).sort(), ['message', 'name']);
  assert.equal(result.logs[0][1].name, 'CollectorError');
  assert.equal(result.logs[0][1].message.length, 500);
  assert.doesNotMatch(JSON.stringify(result.logs), /secret-header|secret-body|secret-value/u);
});

test('an asynchronous collection rejection is caught independently after news starts', async () => {
  const starts = [];
  const result = await captureScheduled({
    runNewsFetch() {
      starts.push('news');
      return Promise.resolve();
    },
    runItnewCollection() {
      starts.push('itnew');
      return Promise.reject({
        name: 'D1Error', message: 'collection failed', headers: 'private', body: 'private',
      });
    },
  });

  assert.deepEqual(starts, ['news', 'itnew']);
  assert.equal(result.waited.length, 2);
  assert.deepEqual(result.logs, [[
    'itnew_collection_failed', { name: 'D1Error', message: 'collection failed' },
  ]]);
});

test('worker scheduled delegates both default jobs to separate waitUntil promises', async () => {
  const waited = [];
  const logs = [];
  const originalError = console.error;
  console.error = (...values) => logs.push(values);
  try {
    await worker.scheduled({}, {}, { waitUntil: (promise) => waited.push(promise) });
    assert.equal(waited.length, 2);
    await Promise.all(waited);
  } finally {
    console.error = originalError;
  }
  assert.deepEqual(logs.map(([label]) => label).sort(), [
    'itnew_collection_failed', 'news_fetch_failed',
  ]);
  assert.ok(logs.every(([, error]) => (
    Object.keys(error).sort().join(',') === 'message,name'
      && error.name.length <= 500 && error.message.length <= 500
  )));
});
