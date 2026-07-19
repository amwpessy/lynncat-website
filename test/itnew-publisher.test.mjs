import test from 'node:test';
import assert from 'node:assert/strict';

import { publishCandidate, unpublishArticle } from '../src/itnew/publisher.js';

const NOW = Date.parse('2026-07-19T08:00:00Z');
const MAX_SECTION_BYTES = 409600;

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
  constructor({ sources = [], articles = [], failBatchOperation = null } = {}) {
    this.state = {
      sources: structuredClone(sources), articles: structuredClone(articles),
      sections: [], images: [], candidates: [], audits: [],
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
      case 'publisher_article_ref': {
        const row = state.articles.find(({ id }) => id === bindings[0]);
        return row ? { id: row.id, slug: row.slug, status: row.status } : null;
      }
      case 'publisher_article_status': {
        const row = state.articles.find(({ id }) => id === bindings[0]);
        return row ? { id: row.id, status: row.status } : null;
      }
      case 'publisher_article_insert': {
        const [id, slug, source_id, canonical_url, title, summary, language, category,
          rights_mode, article_permission_verified, license_name, license_url,
          attribution_text, hero_image_kind, hero_image_key, source_published_at,
          published_at, status] = bindings;
        state.articles.push({ id, slug, source_id, canonical_url, title, summary, language,
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
        state.candidates.push({ id, status: 'approved', article_id, reviewed_at, processing_error: null });
        return { success: true, meta: { changes: 1 } };
      }
      case 'publisher_candidate_error': {
        const [processing_error, reviewed_at, id] = bindings;
        state.candidates.push({ id, status: 'processing_error', processing_error, reviewed_at });
        return { success: true, meta: { changes: 1 } };
      }
      case 'publisher_audit_insert': {
        const [id, admin_id, action, target_type, target_id, batch_id, result,
          details_json, created_at] = bindings;
        state.audits.push({ id, admin_id, action, target_type, target_id, batch_id,
          result, details_json, created_at });
        return { success: true, meta: { changes: 1 } };
      }
      case 'publisher_article_unpublish': {
        const [id] = bindings;
        const row = state.articles.find((article) => article.id === id && article.status === 'published');
        if (row) row.status = 'unpublished';
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
    license_url: null, attribution_template: null, ...overrides,
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
  return {
    ok: true, status: 200,
    headers: { get: (name) => normalized.get(String(name).toLowerCase()) ?? null },
    async arrayBuffer() { return Uint8Array.from(bytes).buffer; },
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
  const db = new PublisherD1({ sources: [source({ rights_mode: 'licensed_full' })] });
  const body = `<script>bad()</script><p>${'云'.repeat(150000)}</p>`;
  const images = r2({ staged: new Map([['staged/body.html', body]]) });
  const ctx = context();
  ctx.fetchImpl = async () => imageResponse([1, 2, 3], 'image/png');
  const result = await publishCandidate(env(db, images), candidate({
    title: '中文标题', rights_mode_snapshot: 'licensed_full',
    staged_body_key: 'staged/body.html', remote_image_url: 'https://img.example/hero',
    license_snapshot_json: JSON.stringify({ articleAllowed: true, name: 'CC BY',
      url: 'https://license.example/by', attributionTemplate: 'By Example' }),
  }), ctx);

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
    const db = new PublisherD1({ sources: [source({ rights_mode: 'licensed_full' })] });
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
  const db = new PublisherD1({ sources: [source({ rights_mode: 'licensed_full' })] });
  const images = r2({ staged: new Map([['staged/body', '<p>body</p>']]) });
  const ctx = context();
  ctx.fetchImpl = async () => imageResponse([1, 2, 3], 'image/jpeg; charset=binary');
  await publishCandidate(env(db, images), candidate({
    rights_mode_snapshot: 'licensed_full', staged_body_key: 'staged/body',
    remote_image_url: 'https://img.example/a.svg',
    license_snapshot_json: JSON.stringify({ articleAllowed: true, name: 'CC',
      url: 'https://license.example', attributionTemplate: 'By X' }),
  }), ctx);
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
    const db = new PublisherD1({ sources: [source({ rights_mode: 'licensed_full' })] });
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

  const db = new PublisherD1({ sources: [source({ rights_mode: 'licensed_full' })] });
  const images = r2({ staged: new Map([['staged/body', '<p>body</p>']]), failPut: true });
  const result = await publishCandidate(env(db, images), candidate({
    rights_mode_snapshot: 'licensed_full', staged_body_key: 'staged/body',
    remote_image_url: 'https://img.example/hero',
    license_snapshot_json: JSON.stringify({ articleAllowed: true, name: 'CC',
      url: 'https://license.example', attributionTemplate: 'By X' }),
  }), { ...context(), fetchImpl: async () => imageResponse([1], 'image/png') });
  assert.ok(result.warnings.includes('image_copy_failed'));
  assert.equal(db.state.articles[0].hero_image_kind, 'fallback');
});

test('slug is deterministic bounded readable and collision-resistant by canonical URL', async () => {
  async function slugFor(overrides) {
    const db = new PublisherD1({ sources: [source()] });
    return (await publishCandidate(env(db), candidate(overrides), context())).slug;
  }
  const english = await slugFor({ title: `Hello ${'VeryLong '.repeat(30)}World` });
  const chinese = await slugFor({ title: '纯中文标题' });
  assert.ok(english.startsWith('hello-verylong-'));
  assert.ok(english.length <= 96);
  assert.match(chinese, /^article-[0-9a-f]{12}$/);
  assert.equal(chinese, await slugFor({ title: '另一个标题' }));
  assert.notEqual(chinese, await slugFor({ title: '纯中文标题', canonical_url: 'https://news.example/two' }));
});

test('repeated approval returns existing article without D1 batch or R2 work', async () => {
  const db = new PublisherD1({ sources: [source()], articles: [
    { id: 'article-old', slug: 'existing-slug', status: 'published' },
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
  const db = new PublisherD1({
    sources: [source({ rights_mode: 'licensed_full' })], failBatchOperation: 'publisher_candidate_approve',
  });
  const images = r2({ staged: new Map([['staged/body', '<p>body</p>']]) });
  await assert.rejects(publishCandidate(env(db, images), candidate({
    rights_mode_snapshot: 'licensed_full', staged_body_key: 'staged/body',
    remote_image_url: 'https://img.example/hero',
    license_snapshot_json: JSON.stringify({ articleAllowed: true, name: 'CC',
      url: 'https://license.example', attributionTemplate: 'By X' }),
  }), { ...context(), fetchImpl: async () => imageResponse([1], 'image/png') }), /simulated D1 failure/);
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
    ['publisher_article_unpublish', 'publisher_audit_insert']);
  assert.deepEqual(await unpublishArticle(env(db), 'article-1', context()),
    { articleId: 'article-1', status: 'unpublished' });
  assert.equal(db.state.audits.length, 1);
  assert.equal(db.batchCalls.length, 1);
});
