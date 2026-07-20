import test from 'node:test';
import assert from 'node:assert/strict';

import {
  canonicalizeUrl,
  normalizeEntry,
  parseFeed,
  scoreCandidate,
  selectBalancedCandidates,
} from '../src/itnew/normalize.js';
import { SOURCE_REGISTRY } from '../src/itnew/sources.js';

const now = Date.parse('2026-07-19T00:00:00Z');
const zhSource = { id: 'zh-test', language: 'zh', priorityWeight: 30, rightsMode: 'summary_link' };
const enSource = { id: 'en-test', language: 'en', priorityWeight: 30, rightsMode: 'summary_link' };

function countBy(items, key) {
  return items.reduce((counts, item) => {
    counts[item[key]] = (counts[item[key]] || 0) + 1;
    return counts;
  }, {});
}

test('source registry contains the confirmed sources, adapters, and disabled defaults', () => {
  assert.deepEqual(SOURCE_REGISTRY.map(({ id }) => id), [
    '36kr', 'infoq-cn', 'oschina', 'solidot', 'sspai', 'jiqizhixin',
    'techcrunch', 'the-verge', 'ars-technica', 'wired', 'mit-technology-review',
    'cloudflare-blog', 'github-blog', 'github-changelog', 'hacker-news',
    'fedora-magazine', 'mozilla-hacks',
  ]);
  assert.ok(SOURCE_REGISTRY.every(({ enabledByDefault }) => enabledByDefault === false));
  assert.ok(SOURCE_REGISTRY.every(({ rightsMode }) => rightsMode === 'summary_link'));
  assert.equal(SOURCE_REGISTRY.find(({ id }) => id === 'hacker-news').adapter, 'hn_json');
  assert.ok(SOURCE_REGISTRY.filter(({ id }) => id !== 'hacker-news').every(({ adapter }) => adapter === 'feed'));
  assert.deepEqual(
    SOURCE_REGISTRY.filter(({ fullTextEligibility }) => fullTextEligibility === 'article_verification_required').map(({ id }) => id),
    ['fedora-magazine', 'mozilla-hacks'],
  );
});

test('canonicalizeUrl removes tracking, normalizes the host, and sorts remaining parameters', () => {
  assert.equal(
    canonicalizeUrl('https://Example.com/a/?utm_source=x&b=2#top'),
    'https://example.com/a?b=2',
  );
  assert.equal(
    canonicalizeUrl('https://EXAMPLE.com:443/a/?z=3&fbclid=x&a=1&ref=home&gclid=y&spm=9'),
    'https://example.com/a?a=1&z=3',
  );
  assert.equal(canonicalizeUrl('https://example.com/'), 'https://example.com');
});

test('parseFeed extracts RSS fields, CDATA, entities, content and an enclosure image', () => {
  const rss = `<?xml version="1.0"?>
    <rss xmlns:content="http://purl.org/rss/1.0/modules/content/">
      <channel><item>
        <title><![CDATA[新芯片 &amp; AI]]></title>
        <link>https://example.cn/story?utm_medium=rss</link>
        <guid>rss-1</guid>
        <description><![CDATA[<p>摘要 &amp; 更多</p>]]></description>
        <content:encoded><![CDATA[<article>正文<script>globalThis.pwned=true</script></article>]]></content:encoded>
        <pubDate>Sat, 18 Jul 2026 23:00:00 GMT</pubDate>
        <dc:creator>编辑部</dc:creator>
        <enclosure url="https://img.test/rss.jpg" type="image/jpeg" />
      </item></channel>
    </rss>`;

  assert.deepEqual(parseFeed(rss, zhSource), [{
    title: '新芯片 & AI',
    url: 'https://example.cn/story?utm_medium=rss',
    id: 'rss-1',
    summary: '<p>摘要 & 更多</p>',
    content: '<article>正文<script>globalThis.pwned=true</script></article>',
    publishedAt: Date.parse('2026-07-18T23:00:00Z'),
    author: '编辑部',
    imageUrl: 'https://img.test/rss.jpg',
  }]);
  assert.equal(globalThis.pwned, undefined);
});

test('parseFeed extracts Atom links and reports invalid dates and missing images as null', () => {
  const atom = `<?xml version="1.0"?>
    <feed xmlns="http://www.w3.org/2005/Atom">
      <entry>
        <title>Browser &amp; Security</title>
        <link rel="alternate" href="https://example.com/security?utm_campaign=feed" />
        <id>atom-1</id>
        <summary><![CDATA[Critical <b>update</b>]]></summary>
        <content><![CDATA[Patch details]]></content>
        <published>not-a-date</published>
        <author><name>Alice &amp; Bob</name></author>
      </entry>
    </feed>`;

  assert.deepEqual(parseFeed(atom, enSource), [{
    title: 'Browser & Security',
    url: 'https://example.com/security?utm_campaign=feed',
    id: 'atom-1',
    summary: 'Critical <b>update</b>',
    content: 'Patch details',
    publishedAt: null,
    author: 'Alice & Bob',
    imageUrl: null,
  }]);
});

test('parseFeed adapts Hacker News JSON without fetching article URLs', () => {
  const source = { ...enSource, adapter: 'hn_json' };
  const json = JSON.stringify([
    { id: 42, title: 'Show HN: Tiny compiler', url: 'https://example.com/compiler', time: 1784415600, by: 'grace' },
  ]);
  assert.deepEqual(parseFeed(json, source), [{
    title: 'Show HN: Tiny compiler',
    url: 'https://example.com/compiler',
    id: '42',
    summary: '',
    content: '',
    publishedAt: 1784415600_000,
    author: 'grace',
    imageUrl: null,
  }]);
  assert.equal(parseFeed(JSON.stringify({ id: 43, title: 'Single story', by: 'ada' }), source)[0].url, 'https://news.ycombinator.com/item?id=43');
});

test('Hacker News adapter turns topstories IDs into deterministic Task 3 hydration references', () => {
  assert.deepEqual(parseFeed(JSON.stringify([123, 456, 0, -1, 1.5, '789', null]), { adapter: 'hn_json' }), [
    { id: 123, hydrationUrl: 'https://hacker-news.firebaseio.com/v0/item/123.json' },
    { id: 456, hydrationUrl: 'https://hacker-news.firebaseio.com/v0/item/456.json' },
  ]);
});

test('normalizeEntry trusts configured language and classifies bilingual keywords', () => {
  assert.equal(normalizeEntry({ title: '新型 AI 芯片发布', url: 'https://x.test/1' }, zhSource, now).language, 'zh');
  assert.equal(normalizeEntry({ title: 'Critical browser security update', url: 'https://x.test/2' }, enSource, now).category, 'security');
  assert.equal(normalizeEntry({ title: '量子计算新进展', url: 'https://x.test/3' }, { ...zhSource, language: 'auto' }, now).language, 'zh');
  assert.equal(normalizeEntry({ title: 'A new quantum computing milestone', url: 'https://x.test/4' }, { ...enSource, language: 'auto' }, now).language, 'en');
  assert.equal(normalizeEntry({ title: 'Unmapped research milestone', url: 'https://x.test/5' }, enSource, now).category, 'frontier');
});

test('normalizeEntry stores a bounded plain-text summary instead of feed HTML', () => {
  const normalized = normalizeEntry({
    title: 'Developer update',
    url: 'https://x.test/summary',
    summary: `<p>Hello <strong>developers</strong>.</p><script>unsafe()</script><p>${'界'.repeat(700)}</p>`,
  }, enSource, now);
  assert.doesNotMatch(normalized.summary, /<[^>]+>|unsafe/u);
  assert.match(normalized.summary, /^Hello developers\. /u);
  assert.equal(Array.from(normalized.summary).length, 600);
  assert.match(normalized.summary, /…$/u);
});

test('normalizeEntry accepts snake-case source fields returned by itnew_sources', () => {
  const normalized = normalizeEntry(
    { title: 'Critical patch', url: 'https://x.test/6' },
    { id: 'db-source', name: 'DB Source', language: 'en', priority_weight: 28, rights_mode: 'licensed_full' },
    now,
  );
  assert.equal(normalized.sourceWeight, 28);
  assert.equal(normalized.rightsMode, 'licensed_full');
});

test('scoreCandidate applies freshness bands, clamps and excludes items older than 48 hours', () => {
  const base = { sourceWeight: 30, itRelevance: 20, completeness: 15, corroboration: 10 };
  assert.equal(scoreCandidate({ ...base, publishedAt: now - 2 * 3600_000 }, now), 100);
  assert.equal(scoreCandidate({ ...base, publishedAt: now - 10 * 3600_000 }, now), 95);
  assert.equal(scoreCandidate({ ...base, publishedAt: now - 20 * 3600_000 }, now), 90);
  assert.equal(scoreCandidate({ ...base, publishedAt: now - 36 * 3600_000 }, now), 83);
  assert.equal(scoreCandidate({ ...base, publishedAt: now - 49 * 3600_000 }, now), 0);
  assert.equal(scoreCandidate({ sourceWeight: 99, publishedAt: now + 1000, itRelevance: 99, completeness: 99, corroboration: 99 }, now), 100);
});

test('selectBalancedCandidates fills 30 bilingual slots while enforcing source and category caps', () => {
  const categories = ['AI', 'chips', 'internet', 'development', 'security', 'hardware'];
  const pool = Array.from({ length: 48 }, (_, index) => ({
    id: `item-${index}`,
    title: String.fromCodePoint(0x4e00 + index).repeat(10),
    language: index % 2 === 0 ? 'zh' : 'en',
    sourceId: `source-${index % 12}`,
    category: categories[index % categories.length],
    score: 100 - index,
  }));
  const selected = selectBalancedCandidates(pool, 30);
  assert.equal(selected.length, 30);
  assert.deepEqual(countBy(selected, 'language'), { zh: 15, en: 15 });
  assert.ok(Object.values(countBy(selected, 'sourceId')).every((count) => count <= 5));
  assert.ok(Object.values(countBy(selected, 'category')).every((count) => count <= 8));
});

test('selectBalancedCandidates reserves shared-source capacity for the scarcer language', () => {
  const titleBases = { zshared: 0x5200, zalt: 0x5300, eshared: 0x5400, ealt: 0x5500 };
  const make = (count, prefix, fields) => Array.from({ length: count }, (_, index) => ({
    id: `${prefix}-${index}`,
    title: String.fromCodePoint(titleBases[prefix] + index).repeat(10),
    ...fields(index),
  }));
  const pool = [
    ...make(5, 'zshared', () => ({ language: 'zh', sourceId: 'shared', category: 'development', score: 100 })),
    ...make(15, 'zalt', (index) => ({ language: 'zh', sourceId: `zh-${index % 3}`, category: ['AI', 'chips', 'internet'][index % 3], score: 80 })),
    ...make(5, 'eshared', () => ({ language: 'en', sourceId: 'shared', category: 'security', score: 95 })),
    ...make(10, 'ealt', (index) => ({ language: 'en', sourceId: `en-${index % 2}`, category: ['hardware', 'frontier'][index % 2], score: 75 })),
  ];
  assert.deepEqual(countBy(selectBalancedCandidates(pool, 30), 'language'), { en: 15, zh: 15 });
});

test('selectBalancedCandidates finds a feasible 15/15 split under competing category and source caps', () => {
  const titleBases = { zhigh: 0x6100, zalt: 0x6200, eblocked: 0x6300, eok: 0x6400, edecoy: 0x6500 };
  const make = (count, prefix, fields) => Array.from({ length: count }, (_, index) => ({
    id: `${prefix}-${index}`,
    title: String.fromCodePoint(titleBases[prefix] + index).repeat(10),
    ...fields(index),
  }));
  const pool = [
    ...make(8, 'zhigh', (index) => ({ language: 'zh', sourceId: index < 5 ? 'shared' : 'zh-high', category: 'AI', score: 100 - index })),
    ...make(15, 'zalt', (index) => ({ language: 'zh', sourceId: `zh-alt-${index % 3}`, category: ['internet', 'development', 'hardware'][index % 3], score: 80 - index })),
    ...make(8, 'eblocked', (index) => ({ language: 'en', sourceId: `en-ai-${index % 2}`, category: 'AI', score: 95 - index })),
    ...make(8, 'eok', (index) => ({ language: 'en', sourceId: `en-ok-${index % 2}`, category: 'chips', score: 90 - index })),
    ...make(10, 'edecoy', (index) => ({ language: 'en', sourceId: 'shared', category: index < 5 ? 'security' : 'frontier', score: 85 - index })),
  ];
  const selected = selectBalancedCandidates(pool, 30);
  assert.equal(selected.length, 30);
  assert.deepEqual(countBy(selected, 'language'), { zh: 15, en: 15 });
  assert.ok(Object.values(countBy(selected, 'sourceId')).every((count) => count <= 5));
  assert.ok(Object.values(countBy(selected, 'category')).every((count) => count <= 8));
});

test('selectBalancedCandidates clusters near-duplicate titles and retains the highest score', () => {
  const pool = [
    { id: 'low', title: 'Critical browser security update!', language: 'en', sourceId: 'a', category: 'security', score: 70 },
    { id: 'high', title: 'CRITICAL browser security update', language: 'en', sourceId: 'b', category: 'security', score: 95 },
    { id: 'other', title: 'A different hardware launch', language: 'en', sourceId: 'c', category: 'hardware', score: 80 },
    { id: 'stale', title: 'Old item', language: 'en', sourceId: 'd', category: 'frontier', score: 0 },
  ];
  assert.deepEqual(selectBalancedCandidates(pool, 10).map(({ id }) => id), ['high', 'other']);
});
