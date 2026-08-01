import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import worker from '../src/worker.js';
import { renderPublishedArticle, handleItnewArticlePage } from '../src/itnew/articlePage.js';
import { handleItnewPublicRequest } from '../src/itnew/public.js';
import { handleSitemap, STATIC_SITEMAP_PATHS } from '../src/seo.js';

const siteRoot = new URL('../', import.meta.url);

function sitemapDb(rows) {
  return {
    prepare(sql) {
      assert.match(sql, /seo:published_articles/u);
      assert.match(sql, /status\s*=\s*'published'/u);
      return {
        async all() {
          return { success: true, results: structuredClone(rows) };
        },
      };
    },
  };
}

function publishedRow(overrides = {}) {
  return {
    id: 'article-1',
    slug: 'safe-slug',
    canonical_url: 'https://source.example/story',
    title: '芯片与 AI 的下一步',
    summary: '这是一段清晰、独立的编辑摘要。',
    language: 'zh',
    category: 'chips',
    rights_mode: 'summary_link',
    license_name: null,
    license_url: null,
    attribution_text: null,
    hero_image_kind: 'fallback',
    hero_image_key: null,
    source_published_at: Date.UTC(2026, 6, 20),
    published_at: Date.UTC(2026, 6, 21),
    source_name: 'Example Source',
    status: 'published',
    ...overrides,
  };
}

function articleDb(row = publishedRow()) {
  return {
    prepare(sql) {
      const operation = /\/\*\s*itnew:([a-z_]+)\s*\*\//u.exec(sql)?.[1];
      return {
        bindings: [],
        bind(...bindings) {
          this.bindings = bindings;
          return this;
        },
        async first() {
          assert.equal(operation, 'public_article_detail');
          return row && row.slug === this.bindings[0] ? structuredClone(row) : null;
        },
        async all() {
          assert.equal(operation, 'public_article_sections');
          return { success: true, results: [] };
        },
      };
    },
  };
}

async function articleTemplate() {
  return readFile(new URL('../itnew/article.html', import.meta.url), 'utf8');
}

test('robots.txt advertises the root sitemap without blocking render resources', async () => {
  const robots = await readFile(new URL('../robots.txt', import.meta.url), 'utf8');
  assert.match(robots, /^User-agent: \*\nAllow: \//u);
  assert.match(robots, /Sitemap: https:\/\/lynncat\.com\/sitemap\.xml/u);
  assert.doesNotMatch(robots, /Disallow:\s*\/(?:src|itnew\/api|markets\/dashboard)/u);
});

test('dynamic sitemap contains every canonical static route and published article URLs', async () => {
  const request = new Request('https://lynncat.com/sitemap.xml');
  const response = await handleSitemap(request, {
    ITNEW_DB: sitemapDb([
      { slug: 'first story', published_at: Date.UTC(2026, 6, 29) },
      { slug: 'unsafe/slug', published_at: Date.UTC(2026, 6, 28) },
      { slug: '', published_at: Date.UTC(2026, 6, 27) },
    ]),
  });
  const xml = await response.text();

  assert.equal(response.status, 200);
  assert.match(response.headers.get('Content-Type'), /^application\/xml/iu);
  assert.equal((xml.match(/<url>/gu) || []).length, STATIC_SITEMAP_PATHS.length + 1);
  for (const path of STATIC_SITEMAP_PATHS) {
    assert.match(xml, new RegExp(`<loc>https://lynncat\\.com${path.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}</loc>`));
  }
  assert.match(xml, /<loc>https:\/\/lynncat\.com\/itnew\/article\/first%20story<\/loc>/u);
  assert.match(xml, /<lastmod>2026-07-29<\/lastmod>/u);
  assert.doesNotMatch(xml, /unsafe|itnew\/admin|markets\/moderation|\/qa\//u);
});

test('every static sitemap URL declares the same clean self-canonical URL', async () => {
  for (const path of STATIC_SITEMAP_PATHS) {
    const relative = path === '/'
      ? 'index.html'
      : path.endsWith('/') ? `${path.slice(1)}index.html` : `${path.slice(1)}.html`;
    const html = await readFile(new URL(`../${relative}`, import.meta.url), 'utf8');
    assert.match(
      html,
      new RegExp(`<link rel="canonical" href="https://lynncat\\.com${path.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}">`),
      path,
    );
  }
});

test('homepage publishes search, social and site-identity metadata with crawlable legacy links', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  for (const marker of [
    '<link rel="canonical" href="https://lynncat.com/">',
    '<meta property="og:image" content="https://lynncat.com/markets/assets/og.png">',
    '<meta name="twitter:card" content="summary_large_image">',
    '"@type": "WebSite"',
    '"@type": "Organization"',
    'href="/xxxc/"',
    'href="/christmas-carol/"',
    'href="/coin/"',
    'href="/feeding/"',
  ]) {
    assert.ok(html.includes(marker), marker);
  }
});

test('admin, moderation, generic article and QA pages cannot enter the search index', async () => {
  for (const [file, pattern] of [
    ['itnew/admin/index.html', /noindex,nofollow,noarchive/u],
    ['markets/moderation.html', /noindex,nofollow,noarchive/u],
    ['itnew/article.html', /noindex,nofollow/u],
    ['qa/feature-parity-comparison.html', /noindex,nofollow,noarchive/u],
  ]) {
    const html = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.match(html, pattern, file);
  }
});

test('published ITNEW article prerender emits unique safe metadata and visible source content', async () => {
  const template = await articleTemplate();
  const html = renderPublishedArticle(template, {
    slug: 'story with spaces',
    title: '<img src=x onerror=alert(1)>芯片进展',
    summary: '<strong>摘要</strong> &amp; 可信来源',
    language: 'zh',
    category: 'chips',
    rightsMode: 'summary_link',
    heroImageUrl: '/itnew/assets/fallback/chips.png',
    sourceName: '示例来源',
    sourcePublishedAt: Date.UTC(2026, 6, 20),
    publishedAt: Date.UTC(2026, 6, 21),
    originalUrl: 'https://source.example/story',
    sections: [],
  });

  assert.match(html, /<html lang="zh-CN">/u);
  assert.match(html, /<meta name="robots" content="index,follow/u);
  assert.match(html, /https:\/\/lynncat\.com\/itnew\/article\/story%20with%20spaces/u);
  assert.match(html, /<h1 id="articleTitle">芯片进展<\/h1>/u);
  assert.match(html, /<div id="articleBody" class="article-body"><p>摘要 &amp; 可信来源<\/p><\/div>/u);
  assert.match(html, /<meta property="og:type" content="article">/u);
  assert.match(html, /"@type":"WebPage"/u);
  assert.doesNotMatch(html, /<img src=x onerror/u);
  assert.doesNotMatch(html, /noindex,nofollow/u);
});

test('article route returns prerendered 200 for published slugs and a true noindex 404 otherwise', async () => {
  const template = await articleTemplate();
  const assetRequests = [];
  const env = {
    ITNEW_DB: articleDb(),
    ASSETS: {
      async fetch(request) {
        assetRequests.push(new URL(request.url).pathname);
        return new Response(template, {
          headers: { 'Content-Type': 'text/html; charset=utf-8', ETag: '"asset"' },
        });
      },
    },
  };

  const published = await handleItnewArticlePage(
    new Request('https://lynncat.com/itnew/article/safe-slug'), env, 'safe-slug',
  );
  const publishedHtml = await published.text();
  assert.equal(published.status, 200);
  assert.match(publishedHtml, /芯片与 AI 的下一步/u);
  assert.equal(published.headers.get('ETag'), null);
  assert.deepEqual(assetRequests, ['/itnew/article']);

  const missing = await handleItnewArticlePage(
    new Request('https://lynncat.com/itnew/article/missing'), env, 'missing',
  );
  assert.equal(missing.status, 404);
  assert.equal(missing.headers.get('X-Robots-Tag'), 'noindex, nofollow');
});

test('JSON APIs carry noindex directives', async () => {
  const response = await handleItnewPublicRequest(
    new Request('https://lynncat.com/itnew/api/not-a-route'),
    {},
  );
  assert.equal(response.status, 404);
  assert.equal(response.headers.get('X-Robots-Tag'), 'noindex, nofollow');
});

test('site worker serves sitemap before assets and rejects QA artifacts', async () => {
  const assetRequests = [];
  const env = {
    ASSETS: {
      async fetch(request) {
        assetRequests.push(request.url);
        return new Response('asset');
      },
    },
  };
  const sitemap = await worker.fetch(
    new Request('https://lynncat.com/sitemap.xml'), env, {},
  );
  assert.equal(sitemap.status, 200);
  assert.match(await sitemap.text(), /<urlset/u);

  const qa = await worker.fetch(
    new Request('https://lynncat.com/qa/feature-parity-comparison'), env, {},
  );
  assert.equal(qa.status, 404);
  assert.deepEqual(assetRequests, []);

  const wordSource = await worker.fetch(
    new Request('https://lynncat.com/words/%E6%80%BB%E5%8D%95%E8%AF%8D.txt'), env, {},
  );
  assert.equal(wordSource.status, 200);
  assert.equal(wordSource.headers.get('X-Robots-Tag'), 'noindex, nofollow');
  assert.deepEqual(assetRequests, [
    'https://lynncat.com/words/%E6%80%BB%E5%8D%95%E8%AF%8D.txt',
  ]);
});
