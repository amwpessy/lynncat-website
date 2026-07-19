import test from 'node:test';
import assert from 'node:assert/strict';

import { sanitizeArticleHtml, splitArticleSections } from '../src/itnew/sanitize.js';

const encoder = new TextEncoder();
const voidTags = new Set(['br', 'hr', 'img']);

function decodeEntities(value) {
  const named = {
    amp: '&', apos: "'", gt: '>', lt: '<', nbsp: '\u00a0', quot: '"',
  };
  return value.replace(/&(#(?:x[0-9a-f]+|[0-9]+)|[a-z]+);/gi, (entity, body) => {
    if (body[0] !== '#') return named[body.toLowerCase()] ?? entity;
    const hexadecimal = body[1]?.toLowerCase() === 'x';
    const codePoint = Number.parseInt(body.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
    return Number.isInteger(codePoint) && codePoint > 0 && codePoint <= 0x10ffff
      && !(codePoint >= 0xd800 && codePoint <= 0xdfff)
      ? String.fromCodePoint(codePoint)
      : entity;
  });
}

function textContent(html) {
  return decodeEntities(html.replace(/<[^>]*>/g, ''));
}

function assertBalanced(html) {
  const stack = [];
  for (const match of html.matchAll(/<\/?([a-z][a-z0-9]*)(?:\s[^>]*)?>/g)) {
    const [token, tag] = match;
    if (voidTags.has(tag)) {
      assert.equal(token.startsWith('</'), false, `void closing tag in ${html.slice(0, 200)}`);
    } else if (token.startsWith('</')) {
      assert.equal(stack.pop(), tag, `unbalanced closing tag in ${html.slice(0, 200)}`);
    } else {
      stack.push(tag);
    }
  }
  assert.deepEqual(stack, [], `unclosed tags in ${html.slice(0, 200)}`);
}

test('sanitizeArticleHtml removes mixed-case and nested blocked regions with their contents', () => {
  const input = '<P>Safe<ScRiPt data-x=">">bad<STYLE>worse</STYLE></ScRiPt>'
    + '<IFRAME srcdoc="bad">frame</IFRAME>end</P>';

  assert.equal(sanitizeArticleHtml(input), '<p>Safeend</p>');
  assert.equal(
    sanitizeArticleHtml('<p>a<script><script>inner</script>outer</script>b</p>'),
    '<p>ab</p>',
  );
});

test('sanitizeArticleHtml treats slash-marked blocked tags as HTML start tags', () => {
  for (const tag of [
    'ScRiPt', 'StYlE', 'IfRaMe', 'FoRm', 'SvG', 'MaTh', 'ObJeCt', 'EmBeD', 'TeMpLaTe',
  ]) {
    assert.equal(
      sanitizeArticleHtml(`<p>safe<${tag}/>secret</${tag}>end</p>`),
      '<p>safeend</p>',
      tag,
    );
  }
  assert.equal(
    sanitizeArticleHtml('<p>a<SvG/><StYlE/>bad</style>still</svg>b</p>'),
    '<p>ab</p>',
  );
});

test('sanitizeArticleHtml drops dangerous, unknown, namespace and malformed attributes', () => {
  const input = '<p ONCLICK="run()" style="color:red" srcdoc="<script>" data-extra="x" '
    + 'xml:lang="en" bad@name="y">safe</p>'
    + '<a href="javascript:alert(1)" title=nope onclick=run()>bad link</a>';

  assert.equal(sanitizeArticleHtml(input), '<p>safe</p><a title="nope">bad link</a>');
});

test('sanitizeArticleHtml keeps only absolute HTTP(S) links, escapes values and forces rel', () => {
  const input = '<a title="A &quot;quote&quot; &amp; more" '
    + 'href="https://example.com/a?x=1&amp;y=2">go</a>'
    + '<a href="//example.com/x">scheme relative</a>'
    + '<a href="/relative">relative</a>'
    + '<a href="JaVaScRiPt&#58;alert(1)">script</a>';

  assert.equal(
    sanitizeArticleHtml(input),
    '<a href="https://example.com/a?x=1&amp;y=2" title="A &quot;quote&quot; &amp; more" '
      + 'rel="noopener noreferrer">go</a>'
      + '<a>scheme relative</a><a>relative</a><a>script</a>',
  );
});

test('sanitizeArticleHtml restricts image paths and dimensions', () => {
  const input = '<img src="/itnew/images/photo.png" alt="A &quot;B&quot;" width="08192" height="7">'
    + '<img src="/itnew/assets/fallback/ai.png" width="1">'
    + '<img src="https://example.com/x.png" width="8193" height="0">'
    + '<img src="data:image/png,x">'
    + '<img src="//example.com/x.png">'
    + '<img src="/itnew/images/%2e%2e/private.png">';

  assert.equal(
    sanitizeArticleHtml(input),
    '<img src="/itnew/images/photo.png" alt="A &quot;B&quot;" width="8192" height="7">'
      + '<img src="/itnew/assets/fallback/ai.png" width="1"><img><img><img><img>',
  );
});

test('sanitizeArticleHtml rejects ambiguous encoded image traversal, separators and controls', () => {
  const rejected = [
    '/itnew/images/%252e%252e/private.png',
    '/itnew/images/%252fprivate.png',
    '/itnew/images/%255cprivate.png',
    '/itnew/images/%2500private.png',
    '/itnew/images/%2e%2e/private.png',
    '/itnew/images/%2fprivate.png',
    '/itnew/images/%5cprivate.png',
    '/itnew/images/%00private.png',
    '/itnew/images/%0aprivate.png',
    '/itnew/images/%c2%80private.png',
    '/itnew/images/../assets/fallback/ai.png',
  ];

  assert.equal(
    sanitizeArticleHtml(rejected.map((src) => `<img src="${src}">`).join('')),
    '<img>'.repeat(rejected.length),
  );
  assert.equal(
    sanitizeArticleHtml(
      '<img src="/itnew/images/hash.png"><img src="/itnew/assets/fallback/ai.png">',
    ),
    '<img src="/itnew/images/hash.png"><img src="/itnew/assets/fallback/ai.png">',
  );
});

test('sanitizeArticleHtml balances malformed input and ignores non-top closing tags', () => {
  const result = sanitizeArticleHtml(
    '<P><strong>one</p>two</strong><unknown>three</unknown><br/></P>',
  );

  assert.equal(result, '<p><strong>onetwo</strong>three<br></p>');
  assertBalanced(result);
});

test('sanitizeArticleHtml handles deeply nested allowed tags without exhausting the call stack', () => {
  const depth = 12_000;
  const input = `${'<strong>'.repeat(depth)}x${'</strong>'.repeat(depth)}`;

  assert.equal(sanitizeArticleHtml(input), input);
});

test('sanitizeArticleHtml handles adversarial mismatched closes in linear time', { timeout: 1_000 }, () => {
  const depth = 30_000;
  const input = `${'<strong>'.repeat(depth)}x${'</p>'.repeat(depth)}`;
  const expected = `${'<strong>'.repeat(depth)}x${'</strong>'.repeat(depth)}`;
  const startedAt = performance.now();
  const result = sanitizeArticleHtml(input);
  const elapsed = performance.now() - startedAt;

  assert.equal(result, expected);
  assertBalanced(result);
  assert.ok(elapsed < 500, `mismatched closes took ${elapsed.toFixed(1)}ms`);
});

test('sanitizeArticleHtml escapes an unterminated quoted suffix once', { timeout: 1_000 }, () => {
  const repetitions = 30_000;
  const input = '<a "'.repeat(repetitions);
  const expected = '&lt;a "'.repeat(repetitions);
  const startedAt = performance.now();
  const result = sanitizeArticleHtml(input);
  const elapsed = performance.now() - startedAt;

  assert.equal(result, expected);
  assert.doesNotMatch(result, /<a(?:\s|>)/);
  assert.equal(textContent(result), input);
  assert.ok(elapsed < 500, `unterminated quoted suffix took ${elapsed.toFixed(1)}ms`);
});

test('sanitizeArticleHtml safely preserves text, decoded entities and supplementary Unicode', () => {
  assert.equal(
    sanitizeArticleHtml('<p>2 < 3 &amp; 4 > 1; &lt;script&gt; "quotes" &apos; 😀</p>'),
    '<p>2 &lt; 3 &amp; 4 &gt; 1; &lt;script&gt; "quotes" \' 😀</p>',
  );
});

test('splitArticleSections splits a sanitized 900KB body into balanced 400KB sections', () => {
  const input = `<p>${'你'.repeat(310_000)}</p>`;
  const sanitized = sanitizeArticleHtml(input);
  const chunks = splitArticleSections(input);

  assert.ok(chunks.length >= 3);
  for (const chunk of chunks) {
    assert.ok(chunk.length > 0);
    assert.ok(encoder.encode(chunk).byteLength <= 409_600);
    assertBalanced(chunk);
  }
  assert.equal(chunks.map(textContent).join(''), textContent(sanitized));
});

test('splitArticleSections reopens wrappers without losing or duplicating multibyte code points', () => {
  const input = `<blockquote><p>${'😀你'.repeat(80)}</p></blockquote>`;
  const sanitized = sanitizeArticleHtml(input);
  const chunks = splitArticleSections(input, 127);

  assert.ok(chunks.length > 2);
  assert.ok(chunks.every((chunk) => encoder.encode(chunk).byteLength <= 127));
  chunks.forEach(assertBalanced);
  assert.equal(chunks.map(textContent).join(''), textContent(sanitized));
});

test('splitArticleSections honors exact and one-byte-over UTF-8 boundaries', () => {
  const atLimit = `<p>${'a'.repeat(25)}</p>`;
  const overLimit = `<p>${'a'.repeat(26)}</p>`;

  assert.equal(encoder.encode(atLimit).byteLength, 32);
  assert.deepEqual(splitArticleSections(atLimit, 32), [atLimit]);

  const chunks = splitArticleSections(overLimit, 32);
  assert.equal(chunks.length, 2);
  assert.ok(chunks.every((chunk) => encoder.encode(chunk).byteLength <= 32));
  chunks.forEach(assertBalanced);
  assert.equal(chunks.map(textContent).join(''), 'a'.repeat(26));
});

test('splitArticleSections throws a stable error when no escaped unit and wrapper can fit', () => {
  assert.throws(
    () => splitArticleSections('<p>😀</p>', 10),
    (error) => error instanceof Error && error.message === 'article_section_limit_too_small',
  );
  assert.throws(
    () => splitArticleSections('a', 0),
    (error) => error instanceof Error && error.message === 'article_section_limit_too_small',
  );
});
