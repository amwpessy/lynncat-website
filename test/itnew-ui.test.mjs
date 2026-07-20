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

test('public masthead keeps discovery compact before the first story', async () => {
  const [html, css] = await Promise.all([
    source('itnew/index.html'), source('itnew/styles.css'),
  ]);

  assert.match(html, /class=["']filter-rail["'][\s\S]*id=["']categoryFilters["'][\s\S]*id=["']languageFilters["']/iu);
  assert.match(html, /<label[^>]+class=["']visually-hidden["'][^>]+for=["']searchInput["']/iu);
  assert.match(css, /\.site-header\s*\{[^}]*padding:\s*16px 0 4px/isu);
  assert.match(css, /\.discovery-bar\s*\{[^}]*margin-top:\s*10px[^}]*padding:\s*8px 10px/isu);
  assert.match(css, /\.page-shell\s*\{[^}]*padding:\s*28px 0 84px/isu);
  const phone = css.match(/@media\s*\(max-width:\s*720px\)[\s\S]*?(?=@media|$)/iu)?.[0] || '';
  assert.match(phone, /\.discovery-bar\s*\{[^}]*grid-template-columns:\s*1fr[^}]*margin-top:\s*8px/isu);
  assert.match(phone, /\.page-shell\s*\{[^}]*padding-top:\s*18px/isu);
  assert.match(phone, /\.focus-copy\s*\{[^}]*min-height:\s*210px/isu);
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

test('nullable timestamps fall back safely instead of rendering the Unix epoch', async () => {
  const [app, article] = await Promise.all([
    source('itnew/app.js'), source('itnew/article.js'),
  ]);

  for (const script of [app, article]) {
    assert.match(script, /function validTimestamp\(value\)/u);
    assert.match(script, /value\s*==\s*null\s*\|\|\s*value\s*===\s*['"]['"]/u);
    assert.match(script, /!Number\.isFinite\(timestamp\)\s*\|\|\s*timestamp\s*<=\s*0/u);
  }
  assert.match(app, /sourcePublishedAt:\s*validTimestamp\(value\.sourcePublishedAt\)/u);
  assert.match(app, /publishedAt:\s*validTimestamp\(value\.publishedAt\)/u);
  assert.match(app, /return\s+item\.sourcePublishedAt\s*\?\?\s*item\.publishedAt/u);
  assert.match(article, /validTimestamp\(article\.sourcePublishedAt\)\s*\?\?\s*validTimestamp\(article\.publishedAt\)/u);
  assert.doesNotMatch(app, /sourcePublishedAt:\s*Number\(/u);
});

test('timestamp validation enforces the Date TimeClip range before ISO formatting', async () => {
  const scripts = await Promise.all([source('itnew/app.js'), source('itnew/article.js')]);
  for (const script of scripts) {
    const match = script.match(/function validTimestamp\(value\)\s*\{([\s\S]*?)\n\}/u);
    assert.ok(match);
    const validTimestamp = Function('value', match[1]);
    for (const invalid of [null, undefined, '', ' ', 'invalid', 0, -1, 1e300, 8.64e15 + 1]) {
      assert.equal(validTimestamp(invalid), null, String(invalid));
    }
    for (const valid of [1, 1_700_000_000_000, 8.64e15]) {
      assert.equal(validTimestamp(valid), valid, String(valid));
      assert.doesNotThrow(() => new Date(validTimestamp(valid)).toISOString());
    }
    assert.match(script, /new Date\(timestamp\)\.getTime\(\)/u);
  }
});

test('mobile metadata remains visible and keyboard focus has a high-contrast search ring', async () => {
  const css = await source('itnew/styles.css');

  assert.match(css, /--focus:\s*#4b3ca7/iu);
  assert.match(css, /:focus-visible\s*\{[^}]*outline:\s*3px solid var\(--focus\)/isu);
  assert.match(css, /\.search-control:focus-within\s*\{[^}]*(?:border-color|box-shadow):\s*[^;}]*var\(--focus\)/isu);
  assert.ok(css.indexOf('.search-control:focus-within') > css.indexOf('.search-control input'));
  assert.doesNotMatch(css, /\.latest-meta[^{}]*span[^{}]*\{[^}]*display:\s*none/isu);
  const phone = css.slice(css.indexOf('@media (max-width: 440px)'));
  assert.match(phone, /\.latest-meta\s*\{[^}]*gap:[^}]*font-size:/isu);
  assert.match(css, /prefers-reduced-motion:\s*reduce/iu);

  const luminance = (hex) => hex.match(/[0-9a-f]{2}/giu)
    .map((component) => Number.parseInt(component, 16) / 255)
    .map((component) => (component <= .04045
      ? component / 12.92 : ((component + .055) / 1.055) ** 2.4))
    .reduce((total, component, index) => total + component * [.2126, .7152, .0722][index], 0);
  const contrast = (left, right) => {
    const values = [luminance(left), luminance(right)].sort((a, b) => b - a);
    return (values[0] + .05) / (values[1] + .05);
  };
  for (const background of ['#ffffff', '#f7f8fc', '#ece9ff']) {
    assert.ok(contrast('#4b3ca7', background) >= 3, background);
  }
});

test('focus inside the dark editorial hero uses a dedicated contrasting token', async () => {
  const css = await source('itnew/styles.css');
  assert.match(css, /--focus-on-dark:\s*#58c8a4/iu);
  assert.match(css, /\.focus-copy\s+:focus-visible\s*\{[^}]*outline-color:\s*var\(--focus-on-dark\)/isu);
  assert.ok(css.indexOf('.focus-copy :focus-visible') > css.indexOf(':focus-visible'));

  const luminance = (hex) => hex.match(/[0-9a-f]{2}/giu)
    .map((component) => Number.parseInt(component, 16) / 255)
    .map((component) => (component <= .04045
      ? component / 12.92 : ((component + .055) / 1.055) ** 2.4))
    .reduce((total, component, index) => total + component * [.2126, .7152, .0722][index], 0);
  const contrast = (left, right) => {
    const values = [luminance(left), luminance(right)].sort((a, b) => b - a);
    return (values[0] + .05) / (values[1] + .05);
  };
  for (const background of ['#1a2445', '#252b58']) {
    assert.ok(contrast('#58c8a4', background) >= 3, background);
  }
});

test('admin login and application shells are separate accessible states without preset credentials', async () => {
  const [html, css, app] = await Promise.all([
    source('itnew/admin/index.html'), source('itnew/admin/styles.css'), source('itnew/admin/app.js'),
  ]);

  assert.match(html, /id=["']loginShell["'][\s\S]*id=["']appShell["'][^>]*hidden/iu);
  assert.match(html, /<form[^>]+id=["']loginForm["']/iu);
  assert.match(html, /<input[^>]+name=["']username["'][^>]+autocomplete=["']username["'][^>]+value=["']admin["']/iu);
  assert.match(html, /<input[^>]+name=["']password["'][^>]+type=["']password["'][^>]+autocomplete=["']current-password["']/iu);
  const passwordInput = html.match(/<input[^>]+name=["']password["'][^>]*>/iu)?.[0] || '';
  assert.doesNotMatch(passwordInput, /\svalue=/iu);
  assert.match(html, /<input[^>]+name=["']remember["'][^>]+type=["']checkbox["']/iu);
  assert.match(html, /id=["']loginError["']/u);
  assert.match(html, /id=["']rateLimitStatus["']/u);
  assert.match(css, /\.login-shell\s*\{[^}]*grid-template-columns:/isu);
  assert.match(css, /\.technology-visual/iu);
  assert.match(app, /\/itnew\/admin\/api\/session/u);
  assert.match(app, /response\.status\s*===\s*401/u);
  assert.match(app, /response\.status\s*===\s*429[\s\S]*?Retry-After/u);
  assert.match(app, /response\.status\s*===\s*503/u);
  assert.match(app, /function\s+summaryText[\s\S]*?DOMParser/u);
  assert.match(app, /review-summary summary['"],\s*summaryText\(/u);
  assert.doesNotMatch(app, /(?:localStorage|sessionStorage)[\s\S]{0,100}csrf/iu);
});

test('admin review uses a fatigue-reducing responsive card grid and guarded batch actions', async () => {
  const [html, css, app] = await Promise.all([
    source('itnew/admin/index.html'), source('itnew/admin/styles.css'), source('itnew/admin/app.js'),
  ]);

  assert.match(html, /id=["']reviewGrid["']/u);
  assert.match(css, /\.review-grid\s*\{[^}]*display:\s*grid[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)[^}]*gap:\s*22px/isu);
  assert.match(css, /@media\s*\(max-width:\s*1100px\)[\s\S]*?\.review-grid\s*\{[^}]*repeat\(2,\s*minmax\(0,\s*1fr\)\)/iu);
  assert.match(css, /@media\s*\(max-width:\s*700px\)[\s\S]*?\.review-grid\s*\{[^}]*grid-template-columns:\s*1fr/iu);
  assert.match(css, /\.review-main\s*\{[^}]*padding-bottom:\s*112px/isu);
  assert.match(css, /\.summary\s*\{[^}]*-webkit-line-clamp:\s*2[^}]*overflow:\s*hidden/isu);
  assert.match(css, /\.bulk-toolbar\s*\{[^}]*(?:position:\s*sticky|position:\s*fixed)/isu);
  for (const id of ['selectedCount', 'bulkApprove', 'bulkReject', 'selectVisible', 'collectNow']) {
    assert.match(html, new RegExp(`id=["']${id}["']`, 'u'));
  }
  assert.match(app, /new Set\(\)/u);
  assert.match(app, /status\s*===\s*['"]pending['"]/u);
  assert.match(app, /status\s*===\s*['"]processing_error['"][\s\S]*?retry/iu);
  for (const label of ['cover', 'score', 'category', 'language', 'rights', 'title', 'summary', 'source', 'time', 'read-time']) {
    assert.match(app, new RegExp(`review-${label}`, 'u'));
  }
  for (const action of ['preview', 'approve', 'reject']) {
    assert.match(app, new RegExp(`data-action[^\n]+${action}`, 'u'));
  }
  assert.match(html, /<dialog[^>]+id=["']previewDialog["']/iu);
  assert.match(app, /window\.confirm\([^)]*count/iu);
  assert.match(app, /state\.mutating/u);
  assert.match(app, /loadReview\(\)/u);
});

test('admin views cover publication sources and batches with safe session-bound mutations', async () => {
  const [html, app] = await Promise.all([
    source('itnew/admin/index.html'), source('itnew/admin/app.js'),
  ]);

  for (const view of ['review', 'published', 'sources', 'batches']) {
    assert.match(html, new RegExp(`data-view=["']${view}["']`, 'u'));
    assert.match(html, new RegExp(`id=["']${view}View["']`, 'u'));
  }
  assert.match(html, /id=["']logoutButton["']/u);
  for (const route of ['/articles', '/sources', '/batches', '/collect', '/logout']) {
    assert.match(app, new RegExp(route, 'u'));
  }
  assert.match(app, /credentials:\s*['"]same-origin['"]/u);
  assert.match(app, /['"]X-CSRF-Token['"]\s*:\s*state\.csrf/u);
  assert.match(app, /method\s*!==\s*['"]GET['"][\s\S]*?path\s*!==\s*['"]\/login['"]/u);
  assert.doesNotMatch(app, /\.innerHTML\s*=/u);
  assert.match(app, /\.textContent\s*=/u);
  assert.match(app, /function safeExternalUrl/u);
  assert.match(app, /rel\s*=\s*['"]noopener noreferrer['"]/u);
  assert.match(app, /AbortController/u);
  assert.match(app, /processing_error|last_success_at|last_error|rights_mode|warnings_json/u);
  assert.match(app, /collectNow\.disabled\s*=\s*Boolean\(state\.currentBatch\)/u);
});

test('admin logout preserves a valid app session unless the server confirms logout', async () => {
  const [html, app] = await Promise.all([
    source('itnew/admin/index.html'), source('itnew/admin/app.js'),
  ]);
  assert.match(html, /id=["']logoutStatus["'][^>]*role=["']alert["']/iu);
  const start = app.indexOf('async function logout()');
  const end = app.indexOf('\nrestoreUsernamePreference()', start);
  assert.ok(start >= 0 && end > start, 'named logout workflow must be inspectable');
  const logout = app.slice(start, end);
  assert.match(logout, /response\.ok\s*\|\|\s*response\.status\s*===\s*401/u);
  assert.match(logout, /退出未完成/u);
  assert.doesNotMatch(logout, /finally\s*\{[\s\S]*?showLogin/iu);
});

test('admin auth requests share one generation so stale session recovery cannot replace login', async () => {
  const app = await source('itnew/admin/app.js');
  assert.match(app, /authGeneration:\s*0/u);
  assert.match(app, /function beginAuthRequest\(\)[\s\S]*?beginRequest\(['"]auth['"]\)[\s\S]*?authGeneration\s*\+=\s*1/iu);
  assert.match(app, /function isCurrentAuthRequest/u);
  assert.match(app, /async function restoreSession\(\)[\s\S]*?beginAuthRequest\(\)[\s\S]*?isCurrentAuthRequest\(request\)[\s\S]*?response\.status\s*===\s*401/iu);
  const loginStart = app.indexOf("elements.loginForm.addEventListener('submit'");
  const loginEnd = app.indexOf('\nfunction updateProgress()', loginStart);
  const login = app.slice(loginStart, loginEnd);
  assert.match(login, /beginAuthRequest\(\)[\s\S]*?apiRequest\(['"]\/login['"]/iu);
  assert.match(login, /isCurrentAuthRequest\(request\)[\s\S]*?response\.status\s*===\s*401/iu);
});

test('admin dates reject nullable and blank values before applying the Date TimeClip', async () => {
  const app = await source('itnew/admin/app.js');
  assert.match(app, /function timestampValue\(value\)\s*\{[\s\S]*?value\s*==\s*null[\s\S]*?value\.trim\(\)\s*===\s*['"]['"][\s\S]*?Number\.isFinite[\s\S]*?8\.64e15/iu);
  const helperStart = app.indexOf('function timestampValue(value)');
  const helperEnd = app.indexOf('\nfunction readingTime(', helperStart);
  const helpers = Function(`${app.slice(helperStart, helperEnd)}; return { timestampValue, formatDate };`)();
  for (const value of [null, undefined, '', '   ', 0, -1, 1e300, Number.NaN, 1.5]) {
    assert.equal(helpers.timestampValue(value), null, String(value));
  }
  assert.equal(helpers.timestampValue(1_000), 1_000);
  assert.equal(helpers.formatDate(null, 'fallback'), 'fallback');
  assert.match(app, /formatDate\(source\.last_success_at,\s*['"]尚无成功记录['"]\)/u);
  assert.match(app, /formatDate\(source\.last_error_at,\s*['"]无['"]\)/u);
  assert.match(app, /formatDate\(batch\.closed_at,\s*['"]仍开放['"]\)/u);
});

test('admin list views expose accessible server-backed pagination and source priority', async () => {
  const [html, css, app] = await Promise.all([
    source('itnew/admin/index.html'), source('itnew/admin/styles.css'), source('itnew/admin/app.js'),
  ]);
  for (const name of ['published', 'sources', 'batches']) {
    for (const suffix of ['Prev', 'Page', 'Next']) {
      assert.match(html, new RegExp(`id=["']${name}${suffix}["']`, 'u'));
    }
  }
  assert.match(css, /\.pagination-controls\s*\{/u);
  assert.match(app, /pagination:\s*\{[\s\S]*?articles:[\s\S]*?sources:[\s\S]*?batches:/iu);
  assert.match(app, /payload\.total[\s\S]*?payload\.limit[\s\S]*?payload\.offset/iu);
  assert.match(app, /\/sources\?limit=\$\{page\.limit\}&offset=\$\{page\.offset\}/u);
  assert.match(app, /priority_weight/u);
  assert.match(app, /function changePage/u);
});

test('published search and status query the complete server result set from page one', async () => {
  const [html, app] = await Promise.all([
    source('itnew/admin/index.html'), source('itnew/admin/app.js'),
  ]);
  assert.match(html, /id=["']publishedSearch["'][^>]*maxlength=["']200["']/iu);
  assert.doesNotMatch(app, /function articleMatches/u);
  assert.match(app, /new URLSearchParams\(\{[\s\S]*?limit:[\s\S]*?offset:/iu);
  assert.match(app, /parameters\.set\(['"]q['"]/u);
  assert.match(app, /parameters\.set\(['"]status['"]/u);
  assert.match(app, /function reloadPublishedFromFirstPage\(\)[\s\S]*?pagination\.articles\.offset\s*=\s*0[\s\S]*?loadPublished\(\)/iu);
  assert.match(app, /publishedSearch[\s\S]*?setTimeout\([\s\S]*?250/iu);
  assert.match(app, /publishedFilter[\s\S]*?reloadPublishedFromFirstPage/iu);
});

test('paginated mutations restore controls after clearing the mutation guard', async () => {
  const app = await source('itnew/admin/app.js');
  const unpublishStart = app.indexOf('async function unpublishArticle(');
  const unpublishEnd = app.indexOf('\nfunction sourceHealth(', unpublishStart);
  const unpublish = app.slice(unpublishStart, unpublishEnd);
  assert.match(unpublish, /finally\s*\{[\s\S]*?state\.mutating\s*=\s*false;[\s\S]*?renderPagination\(['"]articles['"]\)/iu);

  const toggleStart = app.indexOf('async function toggleSource(');
  const toggleEnd = app.indexOf('\nfunction warningText(', toggleStart);
  const toggle = app.slice(toggleStart, toggleEnd);
  assert.match(toggle, /finally\s*\{[\s\S]*?state\.mutating\s*=\s*false;[\s\S]*?renderPagination\(['"]sources['"]\)/iu);
});
