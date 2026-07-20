import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

import { handleItnewPublicRequest } from '../src/itnew/public.js';

const ORIGIN = 'https://itnew.test';

function operationFrom(sql) {
  return /\/\*\s*itnew:([a-z_]+)\s*\*\//u.exec(sql)?.[1];
}

class Statement {
  constructor(db, sql, bindings = []) {
    this.db = db;
    this.sql = sql;
    this.operation = operationFrom(sql);
    this.bindings = bindings;
  }

  bind(...bindings) { return new Statement(this.db, this.sql, bindings); }
  async first() { return this.db.execute(this, 'first'); }
  async all() { return { success: true, results: this.db.execute(this, 'all') }; }
}

class PublicDb {
  constructor(articles = [], sections = []) {
    this.articles = structuredClone(articles);
    this.sections = structuredClone(sections);
    this.executions = [];
  }

  prepare(sql) { return new Statement(this, sql); }

  execute(statement, method) {
    const { operation, sql, bindings } = statement;
    this.executions.push({ operation, sql, bindings: [...bindings], method });
    const published = this.articles.filter(({ status }) => status === 'published')
      .sort((left, right) => right.published_at - left.published_at
        || left.id.localeCompare(right.id));
    if (operation === 'public_article_list' || operation === 'public_article_search') {
      const [limit, offset] = bindings.slice(-2);
      return structuredClone(published.slice(offset, offset + limit));
    }
    if (operation === 'public_article_count' || operation === 'public_article_search_count') {
      return { total: published.length };
    }
    if (operation === 'public_article_detail') {
      return structuredClone(published.find(({ slug }) => slug === bindings[0]) ?? null);
    }
    if (operation === 'public_article_sections') {
      return structuredClone(this.sections.filter(({ article_id }) => article_id === bindings[0])
        .sort((left, right) => left.section_index - right.section_index));
    }
    throw new Error(`unsupported public SQL operation: ${operation}`);
  }
}

function article(overrides = {}) {
  return {
    id: 'article-1', candidate_id: 'candidate-secret', slug: 'safe-slug',
    source_id: 'source-internal', source_name: 'Example News', canonical_url: 'https://news.test/original',
    title: 'Public title', summary: 'Public summary', language: 'en', category: 'AI',
    rights_mode: 'summary_link', article_permission_verified: 0,
    license_name: null, license_url: null, attribution_text: null,
    hero_image_kind: 'fallback', hero_image_key: '/itnew/assets/fallback/ai.png',
    source_published_at: 100, published_at: 200, status: 'published',
    staged_body_key: 'staged/private', license_snapshot_json: '{"secret":true}',
    ...overrides,
  };
}

class PublicImages {
  constructor(objects = new Map()) {
    this.objects = objects;
    this.gets = [];
  }

  async get(key) {
    this.gets.push(key);
    return this.objects.get(key) ?? null;
  }
}

function env(articles = [], sections = [], images = new PublicImages()) {
  return { ITNEW_DB: new PublicDb(articles, sections), ITNEW_IMAGES: images };
}

function request(method, path) {
  return new Request(`${ORIGIN}${path}`, { method });
}

function markerResponse(route, params) {
  return new Response(JSON.stringify({ route, params }), {
    headers: { 'Content-Type': 'application/json' },
  });
}

test('dispatches only the three exact public GET contracts with 404 and 405 boundaries', async () => {
  const services = {
    listArticles: ({ params }) => markerResponse('listArticles', params),
    articleDetail: ({ params }) => markerResponse('articleDetail', params),
    articleImage: ({ params }) => markerResponse('articleImage', params),
  };
  for (const [path, route, params] of [
    ['/itnew/api/articles', 'listArticles', {}],
    ['/itnew/api/articles/example-slug', 'articleDetail', { slug: 'example-slug' }],
    ['/itnew/images/articles/article-1/hero.png', 'articleImage', {
      encodedKey: 'articles/article-1/hero.png',
    }],
  ]) {
    const response = await handleItnewPublicRequest(request('GET', path), {}, { services });
    assert.equal(response.status, 200, path);
    assert.deepEqual(await response.json(), { route, params });
  }

  const missing = await handleItnewPublicRequest(request('GET', '/itnew/api/missing'), {}, { services });
  assert.equal(missing.status, 404);
  assert.deepEqual(await missing.json(), { error: 'not_found' });
  const wrongMethod = await handleItnewPublicRequest(
    request('POST', '/itnew/api/articles'), {}, { services },
  );
  assert.equal(wrongMethod.status, 405);
  assert.deepEqual(await wrongMethod.json(), { error: 'method_not_allowed' });
});

test('list validates strict filters and pagination before querying D1', async () => {
  for (const query of [
    '?category=unknown', '?language=fr', '?page=0', '?page=1.5', '?page=9007199254740992',
    '?page=9007199254740991&limit=30', '?limit=0', '?limit=31', '?limit=2.5',
    '?category=AI&category=chips', '?q=one&q=two', '?unknown=value',
  ]) {
    const configured = env([article()]);
    const response = await handleItnewPublicRequest(
      request('GET', `/itnew/api/articles${query}`), configured,
    );
    assert.equal(response.status, 400, query);
    assert.deepEqual(await response.json(), { error: 'invalid_request' });
    assert.equal(configured.ITNEW_DB.executions.length, 0, query);
  }
});

test('ordinary list exposes only published whitelist fields with stable pagination and short cache', async () => {
  const configured = env([
    article({ id: 'article-b', slug: 'b', published_at: 300 }),
    article({ id: 'article-a', slug: 'a', published_at: 300 }),
    article({ id: 'hidden', slug: 'hidden', status: 'unpublished', published_at: 999 }),
  ]);
  const response = await handleItnewPublicRequest(
    request('GET', '/itnew/api/articles?page=1&limit=1'),
    configured,
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'public, max-age=60, stale-while-revalidate=300');
  assert.deepEqual(await response.json(), {
    items: [{
      slug: 'a', title: 'Public title', summary: 'Public summary', language: 'en', category: 'AI',
      rightsMode: 'summary_link', heroImageUrl: '/itnew/assets/fallback/ai.png',
      sourceName: 'Example News', sourcePublishedAt: 100, publishedAt: 300,
    }],
    page: 1,
    limit: 1,
    total: 2,
    hasMore: true,
  });
  const listSql = configured.ITNEW_DB.executions.find(({ operation }) => operation === 'public_article_list');
  assert.match(listSql.sql, /status\s*=\s*'published'/iu);
  assert.match(listSql.sql, /ORDER BY\s+a\.published_at DESC,\s*a\.id ASC/iu);
  assert.deepEqual(listSql.bindings, [1, 0]);
});

test('empty list is a cacheable 200 with the exact pagination contract', async () => {
  const response = await handleItnewPublicRequest(
    request('GET', '/itnew/api/articles?page=2&limit=20'),
    env(),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    items: [], page: 2, limit: 20, total: 0, hasMore: false,
  });
});

test('ordinary category and language filters remain bound values before limit and offset', async () => {
  const configured = env([article()]);
  const response = await handleItnewPublicRequest(request(
    'GET', '/itnew/api/articles?category=AI&language=zh&page=2&limit=2',
  ), configured);
  assert.equal(response.status, 200);
  const list = configured.ITNEW_DB.executions
    .find(({ operation }) => operation === 'public_article_list');
  const count = configured.ITNEW_DB.executions
    .find(({ operation }) => operation === 'public_article_count');
  assert.match(list.sql, /a\.category\s*=\s*\?/iu);
  assert.match(list.sql, /a\.language\s*=\s*\?/iu);
  assert.deepEqual(list.bindings, ['AI', 'zh', 2, 2]);
  assert.deepEqual(count.bindings, ['AI', 'zh']);
});

test('FTS search quotes and escapes every token, AND-joins it, and binds filters separately', async () => {
  const configured = env([article()]);
  const q = 'alpha "beta" OR NEAR(chip) 芯片';
  const response = await handleItnewPublicRequest(request(
    'GET',
    `/itnew/api/articles?category=AI&language=zh&q=${encodeURIComponent(q)}&page=1&limit=20`,
  ), configured);
  assert.equal(response.status, 200);

  const list = configured.ITNEW_DB.executions
    .find(({ operation }) => operation === 'public_article_search');
  const count = configured.ITNEW_DB.executions
    .find(({ operation }) => operation === 'public_article_search_count');
  const match = '"alpha" AND """beta""" AND "OR" AND "NEAR(chip)" AND "芯片"';
  assert.match(list.sql, /JOIN\s+itnew_articles_fts\s+ON\s+itnew_articles_fts\.rowid\s*=\s*a\.rowid/iu);
  assert.match(list.sql, /itnew_articles_fts\s+MATCH\s+\?/iu);
  assert.match(list.sql, /a\.status\s*=\s*'published'/iu);
  assert.deepEqual(list.bindings, [match, 'AI', 'zh', 20, 0]);
  assert.deepEqual(count.bindings, [match, 'AI', 'zh']);
});

test('FTS adversarial operators, quotes, punctuation, and CJK never become query syntax', async () => {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`
    CREATE VIRTUAL TABLE itnew_articles_fts USING fts5(title, summary);
    INSERT INTO itnew_articles_fts(title, summary) VALUES
      ('chip security alpha beta', '芯片 安全 one two foo'),
      ('quoted', 'a"b c');
  `);
  const realMatch = sqlite.prepare(`
    SELECT COUNT(*) AS total
    FROM itnew_articles_fts
    WHERE itnew_articles_fts MATCH ?
  `);
  for (const q of ['" OR * - NOT', 'NEAR(one two) title:^foo', '芯片 安全', 'a"b c']) {
    const configured = env([article()]);
    const response = await handleItnewPublicRequest(
      request('GET', `/itnew/api/articles?q=${encodeURIComponent(q)}`),
      configured,
    );
    assert.equal(response.status, 200, q);
    const execution = configured.ITNEW_DB.executions
      .find(({ operation }) => operation === 'public_article_search');
    assert.ok(execution, q);
    assert.equal(execution.bindings.length, 3);
    assert.match(execution.bindings[0], /^"(?:[^"]|"")*"(?: AND "(?:[^"]|"")*")*$/u, q);
    assert.doesNotThrow(() => realMatch.get(execution.bindings[0]), q);
  }
  sqlite.close();
});

test('blank q uses the ordinary indexed query and control characters are rejected before D1', async () => {
  const blank = env([article()]);
  const blankResponse = await handleItnewPublicRequest(
    request('GET', '/itnew/api/articles?q=%20%09%20'), blank,
  );
  assert.equal(blankResponse.status, 200);
  assert.deepEqual(blank.ITNEW_DB.executions.map(({ operation }) => operation).sort(),
    ['public_article_count', 'public_article_list']);
  assert.ok(blank.ITNEW_DB.executions.every(({ sql }) => !/\bMATCH\b/iu.test(sql)));

  const controlled = env([article()]);
  const controlledResponse = await handleItnewPublicRequest(
    request('GET', '/itnew/api/articles?q=chip%00OR'), controlled,
  );
  assert.equal(controlledResponse.status, 400);
  assert.deepEqual(await controlledResponse.json(), { error: 'invalid_request' });
  assert.equal(controlled.ITNEW_DB.executions.length, 0);
});

test('summary detail exposes an exact public whitelist and never loads stored sections', async () => {
  const configured = env([article()], [
    { id: 'private-section', article_id: 'article-1', section_index: 0, html: '<p>must not leak</p>' },
  ]);
  const response = await handleItnewPublicRequest(
    request('GET', '/itnew/api/articles/safe-slug'),
    configured,
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'public, max-age=60, stale-while-revalidate=300');
  assert.deepEqual(await response.json(), {
    slug: 'safe-slug',
    title: 'Public title',
    summary: 'Public summary',
    language: 'en',
    category: 'AI',
    rightsMode: 'summary_link',
    heroImageUrl: '/itnew/assets/fallback/ai.png',
    sourceName: 'Example News',
    sourcePublishedAt: 100,
    publishedAt: 200,
    originalUrl: 'https://news.test/original',
    rightsNotice: '此来源未授权全文转载，本站仅提供编辑摘要。',
    license: null,
    sections: [],
  });
  assert.deepEqual(configured.ITNEW_DB.executions.map(({ operation }) => operation),
    ['public_article_detail']);
  const detail = configured.ITNEW_DB.executions[0];
  assert.match(detail.sql, /a\.slug\s*=\s*\?/iu);
  assert.match(detail.sql, /a\.status\s*=\s*'published'/iu);
  assert.deepEqual(detail.bindings, ['safe-slug']);
});

test('licensed detail exposes ordered sanitized sections and persisted attribution evidence', async () => {
  const licensed = article({
    rights_mode: 'licensed_full', article_permission_verified: 1,
    license_name: 'CC BY-SA 4.0', license_url: 'https://license.test/by-sa',
    attribution_text: 'By Example', hero_image_kind: 'r2',
    hero_image_key: 'articles/article-1/hero image.webp',
  });
  const configured = env([licensed], [
    { id: 'section-2', article_id: 'article-1', section_index: 1, html: '<p>Second</p>' },
    { id: 'section-1', article_id: 'article-1', section_index: 0, html: '<p>First</p>' },
  ]);
  const response = await handleItnewPublicRequest(
    request('GET', '/itnew/api/articles/safe-slug'),
    configured,
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.deepEqual(body.sections, ['<p>First</p>', '<p>Second</p>']);
  assert.equal(body.heroImageUrl, '/itnew/images/articles/article-1/hero%20image.webp');
  assert.deepEqual(body.license, {
    name: 'CC BY-SA 4.0',
    url: 'https://license.test/by-sa',
    attribution: 'By Example',
  });
  assert.equal(body.rightsNotice, '本文已获授权转载，转载与再使用请遵守所列许可证。');
  assert.ok(!Object.hasOwn(body, 'candidateId'));
  assert.ok(!Object.hasOwn(body, 'articlePermissionVerified'));
  const sections = configured.ITNEW_DB.executions
    .find(({ operation }) => operation === 'public_article_sections');
  assert.match(sections.sql, /ORDER BY\s+section_index ASC/iu);
  assert.deepEqual(sections.bindings, ['article-1']);
});

test('unknown and unpublished detail slugs are indistinguishable 404 responses', async () => {
  const configured = env([article({ slug: 'hidden', status: 'unpublished' })]);
  for (const slug of ['missing', 'hidden']) {
    const response = await handleItnewPublicRequest(
      request('GET', `/itnew/api/articles/${slug}`), configured,
    );
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: 'not_found' });
  }
  assert.ok(configured.ITNEW_DB.executions.every(({ operation }) => operation !== 'public_article_sections'));
});

test('R2 image route safely decodes an article key and emits only fixed normalized headers', async () => {
  const key = 'articles/article-1/hero image.webp';
  const bytes = new Uint8Array([0x52, 0x49, 0x46, 0x46]);
  const images = new PublicImages(new Map([[key, {
    body: bytes,
    httpMetadata: {
      contentType: 'IMAGE/WEBP; charset=binary',
      cacheControl: 'private, no-store',
      contentDisposition: 'attachment; filename=secret',
    },
    customMetadata: { 'X-Secret': 'must-not-leak' },
    etag: 'private-etag',
  }]]));
  const response = await handleItnewPublicRequest(
    request('GET', '/itnew/images/articles/article-1/hero%20image.webp'),
    env([], [], images),
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Content-Type'), 'image/webp');
  assert.equal(response.headers.get('Cache-Control'), 'public, max-age=86400, immutable');
  assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.equal(response.headers.get('Content-Disposition'), null);
  assert.equal(response.headers.get('X-Secret'), null);
  assert.equal(response.headers.get('ETag'), null);
  assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [...bytes]);
  assert.deepEqual(images.gets, [key]);
});

test('R2 key validation rejects traversal, encoded separators, empty segments, controls, and namespaces', async () => {
  const unsafePaths = [
    '/itnew/images/staged/body.html',
    '/itnew/images/articles/%2e%2e/staged/body.html',
    '/itnew/images/articles/%252e%252e/body.html',
    '/itnew/images/articles%2Farticle-1%2Fhero.png',
    '/itnew/images/articles/article-1/%5Cevil.png',
    '/itnew/images/articles//hero.png',
    '/itnew/images/articles/article-1/%00hero.png',
    '/itnew/images/%2Farticles/article-1/hero.png',
    '/itnew/images/articles/./hero.png',
  ];
  for (const path of unsafePaths) {
    const images = new PublicImages();
    const response = await handleItnewPublicRequest(request('GET', path), env([], [], images));
    assert.equal(response.status, 404, path);
    assert.deepEqual(await response.json(), { error: 'not_found' });
    assert.equal(images.gets.length, 0, path);
  }
});

test('missing R2 object returns 404 and unsafe metadata falls back to non-sniffable octet-stream', async () => {
  const missingImages = new PublicImages();
  const missing = await handleItnewPublicRequest(
    request('GET', '/itnew/images/articles/article-1/missing.png'),
    env([], [], missingImages),
  );
  assert.equal(missing.status, 404);
  assert.deepEqual(await missing.json(), { error: 'not_found' });

  const key = 'articles/article-1/unknown.bin';
  const unsafeImages = new PublicImages(new Map([[key, {
    body: new Uint8Array([1, 2, 3]),
    httpMetadata: { contentType: 'text/html', contentLanguage: 'private' },
    customMetadata: { 'Set-Cookie': 'secret=1' },
  }]]));
  const unsafe = await handleItnewPublicRequest(
    request('GET', '/itnew/images/articles/article-1/unknown.bin'),
    env([], [], unsafeImages),
  );
  assert.equal(unsafe.status, 200);
  assert.equal(unsafe.headers.get('Content-Type'), 'application/octet-stream');
  assert.equal(unsafe.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.equal(unsafe.headers.get('Content-Language'), null);
  assert.equal(unsafe.headers.get('Set-Cookie'), null);
});

test('unexpected failures return only the stable internal error without sensitive details', async () => {
  const response = await handleItnewPublicRequest(
    request('GET', '/itnew/api/articles'),
    {},
    {
      services: {
        async listArticles() {
          throw new Error('D1 failure exposed staged/private-key and license_snapshot_json');
        },
      },
    },
  );
  assert.equal(response.status, 500);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(await response.json(), { error: 'internal_error' });
});
