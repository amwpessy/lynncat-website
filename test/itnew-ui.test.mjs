import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function source(path) {
  return readFile(path, 'utf8');
}

test('public home has the accessible editorial structure and strict single-column latest feed', async () => {
  const [html, css, app] = await Promise.all([
    source('itnew/index.html'), source('itnew/styles.css'), source('itnew/app.js'),
  ]);

  assert.doesNotMatch(html, /href=["'][^"']*\/itnew\/admin/iu);
  assert.match(html, /<button[^>]+data-category=["'][^"']+["'][^>]+aria-pressed=/iu);
  assert.match(html, /<button[^>]+data-language=["'][^"']+["'][^>]+aria-pressed=/iu);
  assert.match(html, /<label[^>]+for=["']searchInput["'][^>]*>[^<]+<\/label>/iu);
  assert.match(html, /<ol[^>]+id=["']latestList["'][^>]+class=["'][^"']*latest-list/iu);
  for (const category of [
    'AI', 'chips', 'internet', 'development', 'security', 'robotics', 'hardware', 'frontier',
  ]) {
    assert.match(html, new RegExp(`data-category=["']${category}["']`, 'u'));
  }

  const focus = html.indexOf('id="focus"');
  const picks = html.indexOf('id="editorPicks"');
  const latest = html.indexOf('LATEST SIGNALS · 最新资讯');
  assert.ok(focus >= 0 && picks > focus && latest > picks);

  for (const token of [
    '--ink: #17213d', '--muted: #65708b', '--paper: #f7f8fc', '--surface: #ffffff',
    '--lavender: #7867e6', '--lavender-soft: #ece9ff', '--mint: #58c8a4',
    '--line: #e4e7f0', '--danger: #d85b67', '--radius-card: 22px',
    '--shadow-card: 0 18px 50px rgba(31, 38, 74, .09)',
  ]) assert.match(css, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'u'));
  assert.match(css, /\.latest-list\s*\{[^}]*flex-direction:\s*column/isu);
  assert.match(css, /\.latest-thumb\s*\{[^}]*width:\s*144px[^}]*height:\s*96px/isu);
  assert.match(css, /@media[^{}]*max-width:\s*720px[\s\S]*?\.latest-thumb\s*\{[^}]*width:\s*104px[^}]*height:\s*78px/iu);
  assert.match(css, /:focus-visible/iu);
  assert.match(css, /prefers-reduced-motion:\s*reduce/iu);
  assert.match(css, /@media[^{}]*max-width/iu);

  const latestFunction = app.slice(app.indexOf('function createLatestRow'), app.indexOf('function renderLatest'));
  assert.ok(latestFunction.indexOf("createElement('time')") < latestFunction.indexOf("createElement('img')"));
  assert.ok(latestFunction.indexOf("createElement('img')") < latestFunction.indexOf("createElement('h3')"));
  assert.match(latestFunction, /image\.alt\s*=/u);
  assert.match(app, /\/itnew\/article\/\$\{encodeURIComponent\(/u);
  assert.doesNotMatch(app, /\.innerHTML\s*=/u);
  assert.match(app, /\.textContent\s*=/u);
  assert.match(app, /AbortController/u);
  assert.match(app, /审核通过的文章将在这里出现/u);
  assert.match(html, /id=["']retryButton["']/u);
  for (const fallback of ['ai', 'chips', 'cloud', 'development', 'devices', 'frontier', 'robotics', 'security']) {
    assert.match(app, new RegExp(`/itnew/assets/fallback/${fallback}\\.png`, 'u'));
  }
});

test('article page safely distinguishes licensed sections from summary-only content', async () => {
  const [html, css, script] = await Promise.all([
    source('itnew/article.html'), source('itnew/styles.css'), source('itnew/article.js'),
  ]);

  assert.doesNotMatch(html, /href=["'][^"']*\/itnew\/admin/iu);
  for (const id of ['articleTitle', 'articleMeta', 'rightsNotice', 'articleBody', 'originalLink']) {
    assert.match(html, new RegExp(`id=["']${id}["']`, 'u'));
  }
  assert.match(html, /id=["']originalLink["'][^>]+target=["']_blank["'][^>]+rel=["']noopener noreferrer["']/iu);
  assert.match(script, /location\.pathname/u);
  assert.match(script, /\/itnew\/api\/articles\/\$\{encodeURIComponent\(/u);
  assert.match(script, /rightsMode\s*===\s*['"]licensed_full['"][\s\S]*?renderLicensedBody\(article\)/u);
  assert.match(script, /Array\.isArray\(article\.sections\)[\s\S]*?sectionElement\.innerHTML\s*=\s*sectionHtml/u);
  assert.match(script, /summaryElement\.textContent\s*=/u);
  assert.match(script, /此来源未授权全文转载，本站仅提供编辑摘要。/u);
  assert.match(script, /document\.title\s*=/u);
  assert.match(script, /AbortController/u);
  assert.match(script, /new URL\([^)]*location\.origin/u);
  assert.match(css, /\.article-body\s+img\s*\{[^}]*max-width:\s*100%/isu);
  assert.match(css, /\.article-hero-media\s*\{[^}]*aspect-ratio:/isu);
  assert.match(css, /figcaption/iu);
});
