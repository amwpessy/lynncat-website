import test from 'node:test';
import assert from 'node:assert/strict';

import { publishCandidate, unpublishArticle } from '../src/itnew/publisher.js';

const NOW = Date.parse('2026-07-19T08:00:00Z');
const MAX_SECTION_BYTES = 409600;
const IMAGE_MAX_BYTES = 8 * 1024 * 1024;
const PNG_BYTES = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);
const JPEG_BYTES = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1]);

function operationFrom(sql) {
  return /\/\*\s*itnew:([a-z_]+)\s*\*\//.exec(sql)?.[1];
}

class Statement {
  constructor(db, sql, bindings = []) {
    this.db = db;
    this.sql = sql;
    this.operation = operationFrom(sql);
    this.bindings = bindings;
  }

  bind(...bindings) {
    return new Statement(this.db, this.sql, bindings);
  }

  async first() {
    return this.db.execute(this, this.db.state, 'first');
  }

  async run() {
    return this.db.execute(this, this.db.state, 'run');
  }
}

class PublisherD1 {
  constructor({ sources = [], articles = [], candidates = [candidate()],
    failBatchOperation = null } = {}) {
    this.state = {
      sources: structuredClone(sources), articles: structuredClone(articles),
      sections: [], images: [], candidates: structuredClone(candidates), audits: [],
    };
    this.failBatchOperation = failBatchOperation;
    this.batchCalls = [];
    this.executions = [];
  }

  prepare(sql) { return new Statement(this, sql); }

  async batch(statements) {
    this.batchCalls.push(statements.map((statement) => ({
      operation: statement.operation, bindings: [...statement.bindings],
    })));
    const transaction = structuredClone(this.state);
    const results = [];
    for (const statement of statements) {
      if (statement.operation === this.failBatchOperation) {
        throw new Error(`simulated D1 failure: ${statement.operation}`);
      }
      results.push(this.execute(statement, transaction, 'run'));
    }
    this.state = transaction;
    return results;
  }

  execute(statement, state, method) {
    const { operation, bindings } = statement;
    this.executions.push({ operation, bindings: [...bindings], method });
    switch (operation) {
      case 'publisher_source_current':
        return structuredClone(state.sources.find(({ id }) => id === bindings[0]) ?? null);
      case 'publisher_candidate_current':
        return structuredClone(state.candidates.find(({ id }) => id === bindings[0]) ?? null);
      case 'publisher_article_ref': {
        const row = state.articles.find(({ id }) => id === bindings[0]);
        return row ? { id: row.id, slug: row.slug, status: row.status } : null;
      }
      case 'publisher_article_status': {
        const row = state.articles.find(({ id }) => id === bindings[0]);
        return row ? { id: row.id, status: row.status } : null;
      }
      case 'publisher_article_insert': {
        const [id, candidate_id, slug, source_id, canonical_url, title, summary, language, category,
          rights_mode, article_permission_verified, license_name, license_url,
          attribution_text, hero_image_kind, hero_image_key, source_published_at,
          published_at, status] = bindings;
        const claimed = state.candidates.find((row) => row.id === candidate_id
          && ['pending', 'processing_error'].includes(row.status) && row.article_id == null);
        if (!claimed) throw new Error('D1_ERROR: itnew_candidate_not_publishable');
        if (state.articles.some((row) => row.candidate_id === candidate_id)) {
          throw new Error('D1_ERROR: UNIQUE constraint failed: itnew_articles.candidate_id');
        }
        state.articles.push({ id, candidate_id, slug, source_id, canonical_url, title, summary, language,
          category, rights_mode, article_permission_verified, license_name, license_url,
          attribution_text, hero_image_kind, hero_image_key, source_published_at,
          published_at, status });
        return { success: true, meta: { changes: 1 } };
      }
      case 'publisher_section_insert': {
        const [id, article_id, section_index, html] = bindings;
        state.sections.push({ id, article_id, section_index, html });
        return { success: true, meta: { changes: 1 } };
      }
      case 'publisher_image_insert': {
        const [id, article_id, object_key, source_url, alt_text, sort_order, created_at] = bindings;
        state.images.push({ id, article_id, object_key, source_url, alt_text, sort_order, created_at });
        return { success: true, meta: { changes: 1 } };
      }
      case 'publisher_candidate_approve': {
        const [article_id, reviewed_at, id] = bindings;
        const row = state.candidates.find((entry) => entry.id === id
          && ['pending', 'processing_error'].includes(entry.status) && entry.article_id == null);
        if (row) Object.assign(row, { status: 'approved', article_id, reviewed_at, processing_error: null });
        return { success: true, meta: { changes: row ? 1 : 0 } };
      }
      case 'publisher_candidate_error': {
        const [processing_error, reviewed_at, id] = bindings;
        const row = state.candidates.find((entry) => entry.id === id
          && ['pending', 'processing_error'].includes(entry.status));
        if (row) Object.assign(row, { status: 'processing_error', processing_error, reviewed_at });
        return { success: true, meta: { changes: row ? 1 : 0 } };
      }
      case 'publisher_audit_insert': {
        const [id, admin_id, action, target_type, target_id, batch_id, result,
          details_json, created_at] = bindings;
        state.audits.push({ id, admin_id, action, target_type, target_id, batch_id,
          result, details_json, created_at });
        return { success: true, meta: { changes: 1 } };
      }
      case 'publisher_unpublish_audit': {
        if (state.last_changes !== 1) return { success: true, meta: { changes: 0 } };
        const [id, admin_id, action, target_type, target_id, batch_id, result,
          details_json, created_at] = bindings;
        state.audits.push({ id, admin_id, action, target_type, target_id, batch_id,
          result, details_json, created_at });
        state.last_changes = 1;
        return { success: true, meta: { changes: 1 } };
      }
      case 'publisher_article_unpublish': {
        const [id] = bindings;
        const row = state.articles.find((article) => article.id === id && article.status === 'published');
        if (row) row.status = 'unpublished';
        state.last_changes = row ? 1 : 0;
        return { success: true, meta: { changes: row ? 1 : 0 } };
      }
      default:
        throw new Error(`unsupported publisher SQL: ${operation}`);
    }
  }
}

function r2({ staged = new Map(), failGet = false, failPut = false } = {}) {
  const calls = { get: [], put: [], delete: [] };
  return {
    calls,
    async get(key) {
      calls.get.push(key);
      if (failGet) throw new Error('secret body read response');
      if (!staged.has(key)) return null;
      const value = staged.get(key);
      return { async text() { return value; } };
    },
    async put(key, value, options) {
      calls.put.push({ key, value: new Uint8Array(value), options });
      if (failPut) throw new Error('R2 image write denied');
      return { key };
    },
    async delete(key) { calls.delete.push(key); },
  };
}

function source(overrides = {}) {
  return {
    id: 'source-1', rights_mode: 'summary_link', license_name: null,
    license_url: null, attribution_template: null,
    homepage_url: 'https://source.example/', feed_url: 'https://feeds.source.example/rss',
    ...overrides,
  };
}

function candidate(overrides = {}) {
  return {
    id: 'candidate-1', batch_id: 'batch-1', source_id: 'source-1',
    canonical_url: 'https://news.example/articles/one', title: 'Hello Cloud World',
    summary: 'Editor summary', staged_body_key: null, remote_image_url: null,
    language: 'en', category: 'development', rights_mode_snapshot: 'summary_link',
    license_snapshot_json: JSON.stringify({ articleAllowed: false }), status: 'pending',
    article_id: null, source_published_at: NOW - 1000, ...overrides,
  };
}

function licensedCandidate(overrides = {}) {
  return candidate({
    rights_mode_snapshot: 'licensed_full', staged_body_key: 'staged/body',
    license_snapshot_json: JSON.stringify({ articleAllowed: true, name: 'CC',
      url: 'https://license.example', attributionTemplate: 'By X' }),
    ...overrides,
  });
}

function context() {
  let next = 0;
  return { now: NOW, uuid: () => `uuid-${++next}`, fetchImpl: async () => {
    throw new Error('unexpected fetch');
  } };
}

function env(db, images = r2()) { return { ITNEW_DB: db, ITNEW_IMAGES: images }; }

function imageResponse(bytes, contentType = 'image/png', headers = {}) {
  const normalized = new Map(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
  normalized.set('content-type', contentType);
  const chunks = Array.isArray(bytes?.[0]) || bytes?.[0] instanceof Uint8Array
    ? bytes.map((chunk) => Uint8Array.from(chunk))
    : [Uint8Array.from(bytes)];
  let index = 0;
  let cancelled = false;
  const reader = {
    async read() {
      if (index >= chunks.length) return { done: true, value: undefined };
      return { done: false, value: chunks[index++] };
    },
    async cancel() { cancelled = true; },
  };
  return {
    ok: true, status: 200,
    headers: { get: (name) => normalized.get(String(name).toLowerCase()) ?? null },
    body: { getReader: () => reader },
    async arrayBuffer() { throw new Error('unbounded arrayBuffer must not be called'); },
    get cancelled() { return cancelled; },
  };
}

test('summary publication never reads body or image and uses category fallback', async () => {
  const db = new PublisherD1({ sources: [source()] });
  const images = r2({ staged: new Map([['staged/should-not-read', '<p>secret</p>']]) });
  let fetched = false;
  const result = await publishCandidate(env(db, images), candidate({
    staged_body_key: 'staged/should-not-read', remote_image_url: 'https://img.example/x.png',
  }), { ...context(), fetchImpl: async () => { fetched = true; } });

  assert.equal(result.status, 'published');
  assert.deepEqual(images.calls, { get: [], put: [], delete: [] });
  assert.equal(fetched, false);
  assert.equal(db.state.articles[0].rights_mode, 'summary_link');
  assert.equal(db.state.articles[0].article_permission_verified, 0);
  assert.equal(db.state.articles[0].hero_image_kind, 'fallback');
  assert.equal(db.state.articles[0].hero_image_key, '/itnew/assets/fallback/development.png');
  assert.equal(db.state.sections.length, 0);
  assert.equal(db.state.images.length, 0);
});

test('licensed full publication sanitizes and splits body and atomically persists evidence and image', async () => {
  const durable = licensedCandidate({ title: '中文标题', staged_body_key: 'staged/body.html',
    remote_image_url: 'https://cdn.news.example/hero',
    license_snapshot_json: JSON.stringify({ articleAllowed: true, name: 'CC BY',
      url: 'https://license.example/by', attributionTemplate: 'By Example' }) });
  const db = new PublisherD1({
    sources: [source({ rights_mode: 'licensed_full' })], candidates: [durable],
  });
  const body = `<script>bad()</script><p>${'云'.repeat(150000)}</p>`;
  const images = r2({ staged: new Map([['staged/body.html', body]]) });
  const ctx = context();
  ctx.fetchImpl = async () => imageResponse(PNG_BYTES, 'image/png');
  const result = await publishCandidate(env(db, images), { id: durable.id }, ctx);

  assert.equal(result.status, 'published');
  assert.match(result.slug, /^article-[0-9a-f]{12}$/);
  assert.equal(db.state.articles[0].article_permission_verified, 1);
  assert.equal(db.state.articles[0].license_name, 'CC BY');
  assert.equal(db.state.articles[0].attribution_text, 'By Example');
  assert.ok(db.state.sections.length >= 2);
  assert.deepEqual(db.state.sections.map(({ section_index }) => section_index),
    db.state.sections.map((_, index) => index));
  assert.ok(db.state.sections.every(({ html }) => !html.includes('script')
    && new TextEncoder().encode(html).byteLength <= MAX_SECTION_BYTES));
  assert.equal(db.state.images.length, 1);
  assert.equal(db.state.articles[0].hero_image_kind, 'r2');
  assert.deepEqual(db.batchCalls[0].map(({ operation }) => operation), [
    'publisher_article_insert',
    ...db.state.sections.map(() => 'publisher_section_insert'),
    'publisher_image_insert', 'publisher_candidate_approve', 'publisher_audit_insert',
  ]);
  const details = JSON.parse(db.state.audits[0].details_json);
  assert.equal(details.articleAllowed, true);
});

test('missing source or article permission downgrades without reading staged body', async () => {
  for (const [sourceRights, snapshot] of [
    ['summary_link', { articleAllowed: true, name: 'CC', url: 'https://l.example', attributionTemplate: 'By X' }],
    ['licensed_full', { articleAllowed: false, name: 'CC', url: 'https://l.example', attributionTemplate: 'By X' }],
  ]) {
    const db = new PublisherD1({ sources: [source({ rights_mode: sourceRights })] });
    db.state.candidates = [candidate({
      rights_mode_snapshot: 'licensed_full', staged_body_key: 'staged/body',
      license_snapshot_json: JSON.stringify(snapshot),
    })];
    const images = r2({ staged: new Map([['staged/body', '<p>not read</p>']]) });
    const result = await publishCandidate(env(db, images), candidate({
      rights_mode_snapshot: 'licensed_full', staged_body_key: 'staged/body',
      license_snapshot_json: JSON.stringify(snapshot),
    }), context());
    assert.equal(db.state.articles[0].rights_mode, 'summary_link');
    assert.deepEqual(images.calls.get, []);
    assert.ok(result.warnings.includes('permission_downgraded'));
    assert.equal(JSON.parse(db.state.audits[0].details_json).permissionDowngraded, true);
  }
});

test('body read or semantically empty sanitized content records only a safe processing error batch', async () => {
  for (const images of [r2({ failGet: true }), r2({ staged: new Map([[
    'staged/body', '<script>secret</script><p> &nbsp; </p>',
  ]]) })]) {
    const durable = licensedCandidate();
    const db = new PublisherD1({
      sources: [source({ rights_mode: 'licensed_full' })], candidates: [durable],
    });
    const result = await publishCandidate(env(db, images), candidate({
      rights_mode_snapshot: 'licensed_full', staged_body_key: 'staged/body',
      license_snapshot_json: JSON.stringify({ articleAllowed: true, name: 'CC',
        url: 'https://license.example', attributionTemplate: 'By X' }),
    }), context());
    assert.equal(result.status, 'processing_error');
    assert.equal(db.state.articles.length + db.state.sections.length + db.state.images.length, 0);
    assert.deepEqual(db.batchCalls[0].map(({ operation }) => operation),
      ['publisher_candidate_error', 'publisher_audit_insert']);
    assert.doesNotMatch(JSON.stringify(db.state.candidates) + JSON.stringify(db.state.audits),
      /secret|<script>/i);
  }
});

test('licensed image is content-addressed with normalized safe content type', async () => {
  const durable = licensedCandidate({ remote_image_url: 'https://cdn.news.example/a.jpg' });
  const db = new PublisherD1({
    sources: [source({ rights_mode: 'licensed_full' })], candidates: [durable],
  });
  const images = r2({ staged: new Map([['staged/body', '<p>body</p>']]) });
  const ctx = context();
  ctx.fetchImpl = async () => imageResponse(JPEG_BYTES, 'image/jpeg; charset=binary');
  await publishCandidate(env(db, images), { id: durable.id }, ctx);
  assert.match(images.calls.put[0].key, /^articles\/uuid-1\/[0-9a-f]{64}\.jpg$/);
  assert.deepEqual(images.calls.put[0].options,
    { httpMetadata: { contentType: 'image/jpeg' } });
});

test('image HTTP type size and R2 failures publish text with fallback warning', async () => {
  const failures = [
    async () => ({ ok: false, status: 403, headers: { get: () => null } }),
    async () => imageResponse([1], 'image/svg+xml'),
    async () => imageResponse([1], 'image/png', { 'content-length': String(8 * 1024 * 1024 + 1) }),
  ];
  for (const fetchImpl of failures) {
    const durable = licensedCandidate({ remote_image_url: 'https://cdn.news.example/hero' });
    const db = new PublisherD1({
      sources: [source({ rights_mode: 'licensed_full' })], candidates: [durable],
    });
    const images = r2({ staged: new Map([['staged/body', '<p>body</p>']]) });
    const result = await publishCandidate(env(db, images), candidate({
      rights_mode_snapshot: 'licensed_full', staged_body_key: 'staged/body',
      remote_image_url: 'https://img.example/hero',
      license_snapshot_json: JSON.stringify({ articleAllowed: true, name: 'CC',
        url: 'https://license.example', attributionTemplate: 'By X' }),
    }), { ...context(), fetchImpl });
    assert.equal(result.status, 'published');
    assert.ok(result.warnings.includes('image_copy_failed'));
    assert.equal(db.state.articles[0].hero_image_kind, 'fallback');
  }

  const durable = licensedCandidate({ remote_image_url: 'https://cdn.news.example/hero' });
  const db = new PublisherD1({
    sources: [source({ rights_mode: 'licensed_full' })], candidates: [durable],
  });
  const images = r2({ staged: new Map([['staged/body', '<p>body</p>']]), failPut: true });
  const result = await publishCandidate(env(db, images), candidate({
    rights_mode_snapshot: 'licensed_full', staged_body_key: 'staged/body',
    remote_image_url: 'https://img.example/hero',
    license_snapshot_json: JSON.stringify({ articleAllowed: true, name: 'CC',
      url: 'https://license.example', attributionTemplate: 'By X' }),
  }), { ...context(), fetchImpl: async () => imageResponse(PNG_BYTES, 'image/png') });
  assert.ok(result.warnings.includes('image_copy_failed'));
  assert.equal(db.state.articles[0].hero_image_kind, 'fallback');
});

test('oversized image streams are cancelled without using an unbounded body read', async () => {
  for (const headers of [{}, { 'content-length': 'not-a-number' }, { 'content-length': '1' }]) {
    const first = new Uint8Array(IMAGE_MAX_BYTES);
    first.set(PNG_BYTES);
    const response = imageResponse([first, Uint8Array.of(1)], 'image/png', headers);
    const durable = licensedCandidate({ remote_image_url: 'https://cdn.news.example/oversized.png' });
    const db = new PublisherD1({
      sources: [source({ rights_mode: 'licensed_full' })], candidates: [durable],
    });
    const images = r2({ staged: new Map([['staged/body', '<p>body</p>']]) });
    const result = await publishCandidate(env(db, images), { id: durable.id }, {
      ...context(), fetchImpl: async () => response,
    });
    assert.ok(result.warnings.includes('image_copy_failed'));
    assert.equal(response.cancelled, true);
    assert.equal(images.calls.put.length, 0);
  }
});

test('declared oversized image is rejected early and its body is cancelled', async () => {
  const response = imageResponse(PNG_BYTES, 'image/png', {
    'content-length': String(IMAGE_MAX_BYTES + 1),
  });
  const durable = licensedCandidate({ remote_image_url: 'https://cdn.news.example/declared.png' });
  const db = new PublisherD1({
    sources: [source({ rights_mode: 'licensed_full' })], candidates: [durable],
  });
  const images = r2({ staged: new Map([['staged/body', '<p>body</p>']]) });
  const result = await publishCandidate(env(db, images), { id: durable.id }, {
    ...context(), fetchImpl: async () => response,
  });
  assert.ok(result.warnings.includes('image_copy_failed'));
  assert.equal(response.cancelled, true);
  assert.equal(images.calls.put.length, 0);
});

test('image URL policy rejects SSRF-shaped and cross-site URLs before fetch', async () => {
  const denied = [
    'https://127.0.0.1/a.png',
    'https://[::1]/a.png',
    'https://localhost/a.png',
    'https://user:pass@news.example/a.png',
    'https://news.example:8443/a.png',
    'http://news.example/a.png',
    '//news.example/a.png',
    'https://unrelated.example/a.png',
  ];
  for (const remote_image_url of denied) {
    let fetched = false;
    const durable = licensedCandidate({ remote_image_url });
    const db = new PublisherD1({
      sources: [source({ rights_mode: 'licensed_full' })], candidates: [durable],
    });
    const images = r2({ staged: new Map([['staged/body', '<p>body</p>']]) });
    const result = await publishCandidate(env(db, images), { id: durable.id }, {
      ...context(), fetchImpl: async () => { fetched = true; return imageResponse(PNG_BYTES); },
    });
    assert.equal(fetched, false, remote_image_url);
    assert.ok(result.warnings.includes('image_copy_failed'), remote_image_url);
  }
});

test('image fetch uses manual redirects and rejects a public-to-private redirect', async () => {
  let init;
  const durable = licensedCandidate({ remote_image_url: 'https://news.example/start.png' });
  const db = new PublisherD1({
    sources: [source({ rights_mode: 'licensed_full' })], candidates: [durable],
  });
  const images = r2({ staged: new Map([['staged/body', '<p>body</p>']]) });
  const result = await publishCandidate(env(db, images), { id: durable.id }, {
    ...context(),
    fetchImpl: async (_url, requestInit) => {
      init = requestInit;
      return { ok: false, status: 302, headers: { get: (name) => (
        String(name).toLowerCase() === 'location' ? 'http://169.254.169.254/latest/meta-data' : null
      ) } };
    },
  });
  assert.equal(init.redirect, 'manual');
  assert.ok(result.warnings.includes('image_copy_failed'));
  assert.equal(images.calls.put.length, 0);
});

test('raster MIME must match its magic bytes', async () => {
  const mismatches = [
    ['image/jpeg', PNG_BYTES],
    ['image/png', JPEG_BYTES],
    ['image/gif', Uint8Array.from([0x47, 0x49, 0x46, 0x00])],
    ['image/webp', Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x4e, 0x4f])],
    ['image/avif', Uint8Array.from([0, 0, 0, 12, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32])],
  ];
  for (const [contentType, bytes] of mismatches) {
    const durable = licensedCandidate({ remote_image_url: 'https://cdn.news.example/file' });
    const db = new PublisherD1({
      sources: [source({ rights_mode: 'licensed_full' })], candidates: [durable],
    });
    const images = r2({ staged: new Map([['staged/body', '<p>body</p>']]) });
    const result = await publishCandidate(env(db, images), { id: durable.id }, {
      ...context(), fetchImpl: async () => imageResponse(bytes, contentType),
    });
    assert.ok(result.warnings.includes('image_copy_failed'), contentType);
    assert.equal(images.calls.put.length, 0);
  }
});

test('remote-image-only staged markup is semantically empty after sanitizing', async () => {
  const durable = licensedCandidate();
  const db = new PublisherD1({
    sources: [source({ rights_mode: 'licensed_full' })], candidates: [durable],
  });
  const images = r2({ staged: new Map([[
    'staged/body', '<img src="https://remote.example/tracker.png" alt="tracker">',
  ]]) });
  const result = await publishCandidate(env(db, images), { id: durable.id }, context());
  assert.equal(result.status, 'processing_error');
  assert.equal(db.state.articles.length, 0);
});

test('slug is deterministic bounded readable and collision-resistant by canonical URL', async () => {
  async function slugFor(overrides) {
    const durable = candidate(overrides);
    const db = new PublisherD1({ sources: [source()], candidates: [durable] });
    return (await publishCandidate(env(db), { id: durable.id }, context())).slug;
  }
  const english = await slugFor({ title: `Hello ${'VeryLong '.repeat(30)}World` });
  const chinese = await slugFor({ title: '纯中文标题' });
  assert.ok(english.startsWith('hello-verylong-'));
  assert.ok(english.length <= 96);
  assert.match(chinese, /^article-[0-9a-f]{12}$/);
  assert.equal(chinese, await slugFor({ title: '另一个标题' }));
  assert.notEqual(chinese, await slugFor({ title: '纯中文标题', canonical_url: 'https://news.example/two' }));
});

test('publisher uses the durable current candidate and rejects stale rejected or missing IDs', async () => {
  const rejectedDb = new PublisherD1({
    sources: [source()], candidates: [candidate({ status: 'rejected', title: 'Durable rejected' })],
  });
  assert.deepEqual(await publishCandidate(env(rejectedDb), candidate({
    status: 'pending', title: 'Untrusted caller title',
  }), context()), {
    status: 'candidate_conflict', articleId: null, slug: null, warnings: [],
  });
  assert.equal(rejectedDb.batchCalls.length, 0);

  const missingDb = new PublisherD1({ sources: [source()], candidates: [] });
  assert.deepEqual(await publishCandidate(env(missingDb), candidate(), context()), {
    status: 'not_found', articleId: null, slug: null, warnings: [],
  });
  assert.equal(missingDb.batchCalls.length, 0);
});

test('concurrent candidate publication has one atomic winner and one idempotent result', async () => {
  const durable = candidate();
  const db = new PublisherD1({ sources: [source()], candidates: [durable] });
  const [first, second] = await Promise.all([
    publishCandidate(env(db), { id: durable.id, title: 'Caller one' }, context()),
    publishCandidate(env(db), { id: durable.id, title: 'Caller two' }, context()),
  ]);

  assert.equal(first.status, 'published');
  assert.deepEqual(second, first);
  assert.equal(db.state.articles.length, 1);
  assert.equal(db.state.articles[0].candidate_id, durable.id);
  assert.equal(db.state.articles[0].title, durable.title);
  assert.equal(db.state.audits.length, 1);
});

test('repeated approval returns existing article without D1 batch or R2 work', async () => {
  const db = new PublisherD1({ sources: [source()], candidates: [candidate({
    status: 'approved', article_id: 'article-old',
  })], articles: [
    { id: 'article-old', candidate_id: 'candidate-1', slug: 'existing-slug', status: 'published' },
  ] });
  const images = r2();
  const result = await publishCandidate(env(db, images), candidate({
    status: 'approved', article_id: 'article-old', staged_body_key: 'staged/body',
  }), context());
  assert.deepEqual(result, { status: 'published', articleId: 'article-old',
    slug: 'existing-slug', warnings: [] });
  assert.equal(db.batchCalls.length, 0);
  assert.deepEqual(images.calls, { get: [], put: [], delete: [] });
});

test('D1 publication failure removes only newly copied image and leaves staged body', async () => {
  const durable = licensedCandidate({ remote_image_url: 'https://cdn.news.example/hero' });
  const db = new PublisherD1({
    sources: [source({ rights_mode: 'licensed_full' })], candidates: [durable],
    failBatchOperation: 'publisher_candidate_approve',
  });
  const images = r2({ staged: new Map([['staged/body', '<p>body</p>']]) });
  await assert.rejects(publishCandidate(env(db, images), candidate({
    rights_mode_snapshot: 'licensed_full', staged_body_key: 'staged/body',
    remote_image_url: 'https://img.example/hero',
    license_snapshot_json: JSON.stringify({ articleAllowed: true, name: 'CC',
      url: 'https://license.example', attributionTemplate: 'By X' }),
  }), { ...context(), fetchImpl: async () => imageResponse(PNG_BYTES, 'image/png') }), /simulated D1 failure/);
  assert.deepEqual(images.calls.delete, [images.calls.put[0].key]);
  assert.ok(!images.calls.delete.includes('staged/body'));
  assert.equal(db.state.articles.length, 0);
});

test('unpublish handles unknown and repeated requests without duplicate audit', async () => {
  const db = new PublisherD1({ articles: [
    { id: 'article-1', slug: 'one', status: 'published' },
  ] });
  assert.deepEqual(await unpublishArticle(env(db), 'missing', context()),
    { articleId: 'missing', status: 'not_found' });
  assert.deepEqual(await unpublishArticle(env(db), 'article-1', context()),
    { articleId: 'article-1', status: 'unpublished' });
  assert.deepEqual(db.batchCalls.at(-1).map(({ operation }) => operation),
    ['publisher_article_unpublish', 'publisher_unpublish_audit']);
  assert.deepEqual(await unpublishArticle(env(db), 'article-1', context()),
    { articleId: 'article-1', status: 'unpublished' });
  assert.equal(db.state.audits.length, 1);
  assert.equal(db.batchCalls.length, 1);
});

test('concurrent unpublish attempts create exactly one transition audit', async () => {
  const db = new PublisherD1({ articles: [
    { id: 'article-race', slug: 'race', status: 'published' },
  ] });
  const results = await Promise.all([
    unpublishArticle(env(db), 'article-race', context()),
    unpublishArticle(env(db), 'article-race', context()),
  ]);

  assert.deepEqual(results, [
    { articleId: 'article-race', status: 'unpublished' },
    { articleId: 'article-race', status: 'unpublished' },
  ]);
  assert.equal(db.state.articles[0].status, 'unpublished');
  assert.equal(db.state.audits.length, 1);
  assert.equal(db.batchCalls.length, 2);
  assert.ok(db.batchCalls.every((call) => call[1].operation === 'publisher_unpublish_audit'));
});
