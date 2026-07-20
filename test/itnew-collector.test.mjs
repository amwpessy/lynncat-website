import test from 'node:test';
import assert from 'node:assert/strict';

import { collectNextBatch } from '../src/itnew/collector.js';
import { createFakeD1, createFakeR2, createFetchHarness } from './helpers/itnew-fakes.mjs';
import {
  closeBatchIfResolved,
  createBatchWithCandidates,
  findExistingKeys,
  getBlockingBatch,
  listEnabledSources,
  recordSourceRun,
  syncSourceRegistry,
  updateSourceHealth,
} from '../src/itnew/repository.js';

const now = Date.parse('2026-07-19T00:00:00Z');

const sourceFixtures = {
  '36kr': { feed_url: 'https://36kr.com/feed', language: 'zh' },
  'infoq-cn': { feed_url: 'https://www.infoq.cn/feed', language: 'zh' },
  oschina: { feed_url: 'https://www.oschina.net/news/rss', language: 'zh' },
  solidot: { feed_url: 'https://www.solidot.org/index.rss', language: 'zh' },
  techcrunch: { feed_url: 'https://techcrunch.com/feed/', language: 'en' },
  'the-verge': { feed_url: 'https://www.theverge.com/rss/index.xml', language: 'en' },
  'ars-technica': { feed_url: 'https://feeds.arstechnica.com/arstechnica/index', language: 'en' },
  wired: { feed_url: 'https://www.wired.com/feed/rss', language: 'en' },
  'hacker-news': {
    feed_url: 'https://hacker-news.firebaseio.com/v0/topstories.json',
    language: 'en',
  },
};

function enabledSource(id, overrides = {}) {
  const fixture = sourceFixtures[id];
  return {
    id,
    name: id,
    feed_url: fixture.feed_url,
    homepage_url: `https://${id}.test/`,
    language: fixture.language,
    rights_mode: 'summary_link',
    license_name: null,
    license_url: null,
    attribution_template: null,
    priority_weight: 25,
    enabled: 1,
    etag: null,
    last_modified: null,
    last_success_at: null,
    last_error_at: null,
    last_error: null,
    ...overrides,
  };
}

function xmlEscape(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function rss(entries) {
  return `<rss><channel>${entries.map((entry, index) => `
    <item>
      <title>${xmlEscape(entry.title)}</title>
      <link>${xmlEscape(entry.url)}</link>
      <description>${xmlEscape(entry.summary ?? `Summary ${index}`)}</description>
      <content:encoded><![CDATA[${entry.content ?? ''}]]></content:encoded>
      <pubDate>${new Date(entry.publishedAt ?? now - 60_000).toUTCString()}</pubDate>
    </item>`).join('')}</channel></rss>`;
}

function response(body = '', { status = 200, headers = {} } = {}) {
  const normalized = new Map(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (name) => normalized.get(String(name).toLowerCase()) ?? null },
    async text() { return body; },
  };
}

function uuidSequence(prefix = 'id') {
  let next = 0;
  return () => `${prefix}-${++next}`;
}

function collectorEnv(db, images = createFakeR2()) {
  return { ITNEW_DB: db, ITNEW_IMAGES: images };
}

function feedEntries(sourceId, count, { category = 'development', start = 0 } = {}) {
  const keyword = {
    development: 'Developer', security: 'Security', AI: 'AI', chips: 'Chip',
    robotics: 'Robot', internet: 'Browser', hardware: 'Hardware', frontier: 'Frontier',
  }[category];
  const distinctTopics = [
    'databases reach orbit',
    'robots explore the ocean',
    'quantum networks cross cities',
    'tiny satellites map forests',
    'new compilers accelerate science',
    'wearable sensors protect athletes',
  ];
  return Array.from({ length: count }, (_, index) => ({
    title: `${keyword} ${sourceId} ${distinctTopics[(start + index) % distinctTopics.length]} ${start + index}`,
    url: `https://${sourceId}.test/story/${start + index}`,
    summary: `${sourceId} summary ${start + index}`,
    content: `<p>${sourceId} body ${start + index}</p>`,
    publishedAt: now - index * 1000,
  }));
}

function registrySource(overrides = {}) {
  return {
    id: 'source-1',
    name: 'Source One',
    feedUrl: 'https://source.test/feed',
    homepageUrl: 'https://source.test/',
    language: 'en',
    priorityWeight: 25,
    rightsMode: 'summary_link',
    enabledByDefault: false,
    licenseName: null,
    licenseUrl: null,
    attributionTemplate: null,
    ...overrides,
  };
}

function batch(id = 'batch-1', overrides = {}) {
  return {
    id,
    status: 'open',
    targetCount: 30,
    candidateCount: 1,
    collectedAt: now,
    closedAt: null,
    warnings: [],
    ...overrides,
  };
}

function candidate(id = 'candidate-1', batchId = 'batch-1', overrides = {}) {
  return {
    id,
    batchId,
    sourceId: 'source-1',
    canonicalUrl: `https://source.test/${id}`,
    contentFingerprint: `fingerprint-${id}`,
    title: `Title ${id}`,
    summary: `Summary ${id}`,
    stagedBodyKey: null,
    remoteImageUrl: null,
    language: 'en',
    category: 'development',
    score: 80,
    rightsModeSnapshot: 'summary_link',
    licenseSnapshot: null,
    status: 'pending',
    processingError: null,
    articleId: null,
    sourcePublishedAt: now - 1000,
    createdAt: now,
    reviewedAt: null,
    ...overrides,
  };
}

function sourceRun(id = 'run-1', batchId = 'batch-1', overrides = {}) {
  return {
    id,
    sourceId: 'source-1',
    batchId,
    startedAt: now - 100,
    completedAt: now,
    status: 'success',
    durationMs: 100,
    candidateCount: 1,
    error: null,
    ...overrides,
  };
}

test('source sync inserts registry rows disabled and summary-link on first run', async () => {
  const db = createFakeD1();
  await syncSourceRegistry(db, [
    registrySource(),
    registrySource({ id: 'source-2', rightsMode: 'licensed_full', enabledByDefault: true }),
  ], now);

  assert.equal(db.sources.length, 2);
  assert.ok(db.sources.every(({ enabled }) => enabled === 0));
  assert.ok(db.sources.every(({ rights_mode }) => rights_mode === 'summary_link'));
});

test('source re-sync refreshes registry metadata without overwriting promoted state', async () => {
  const db = createFakeD1();
  await syncSourceRegistry(db, [registrySource()], now);
  Object.assign(db.sources[0], {
    enabled: 1,
    rights_mode: 'licensed_full',
    license_name: 'Manual license',
    license_url: 'https://license.test/',
    attribution_template: '{author}',
    etag: 'etag-old',
    last_modified: 'Sat, 18 Jul 2026 00:00:00 GMT',
    last_success_at: now - 5000,
    last_error_at: now - 9000,
    last_error: 'old error',
  });

  await syncSourceRegistry(db, [registrySource({
    name: 'Renamed Source',
    feedUrl: 'https://source.test/new-feed',
    homepageUrl: 'https://source.test/new-home',
    language: 'zh',
    priorityWeight: 70,
    licenseName: 'Registry license must not replace manual state',
  })], now + 1000);

  assert.deepEqual(db.sources[0], {
    id: 'source-1',
    name: 'Renamed Source',
    feed_url: 'https://source.test/new-feed',
    homepage_url: 'https://source.test/new-home',
    language: 'zh',
    rights_mode: 'licensed_full',
    license_name: 'Manual license',
    license_url: 'https://license.test/',
    attribution_template: '{author}',
    priority_weight: 70,
    enabled: 1,
    etag: 'etag-old',
    last_modified: 'Sat, 18 Jul 2026 00:00:00 GMT',
    last_success_at: now - 5000,
    last_error_at: now - 9000,
    last_error: 'old error',
  });
});

test('blocking batch detection covers open, pending, processing-error and clean states', async () => {
  const openDb = createFakeD1({ batches: [{ id: 'open', status: 'open', collected_at: 1 }] });
  assert.equal((await getBlockingBatch(openDb)).id, 'open');

  for (const status of ['pending', 'processing_error']) {
    const db = createFakeD1({
      batches: [{ id: `batch-${status}`, status: 'closed', collected_at: 2 }],
      candidates: [{ id: `candidate-${status}`, batch_id: `batch-${status}`, status }],
    });
    assert.equal((await getBlockingBatch(db)).id, `batch-${status}`);
  }

  const cleanDb = createFakeD1({
    batches: [{ id: 'closed', status: 'closed', collected_at: 3 }],
    candidates: [{ id: 'approved', batch_id: 'closed', status: 'approved' }],
  });
  assert.equal(await getBlockingBatch(cleanDb), null);
});

test('enabled sources are ordered by descending priority and stable ID', async () => {
  const db = createFakeD1({ sources: [
    { id: 'z-low', enabled: 1, priority_weight: 10 },
    { id: 'z-high', enabled: 1, priority_weight: 50 },
    { id: 'a-high', enabled: 1, priority_weight: 50 },
    { id: 'disabled', enabled: 0, priority_weight: 100 },
  ] });
  assert.deepEqual((await listEnabledSources(db)).map(({ id }) => id), ['a-high', 'z-high', 'z-low']);
});

test('existing-key lookup chunks each key type into at most 80 bound values', async () => {
  const canonicalUrls = Array.from({ length: 161 }, (_, index) => `https://existing.test/${index}`);
  const fingerprints = Array.from({ length: 161 }, (_, index) => `fingerprint-${index}`);
  const db = createFakeD1({ candidates: [0, 80, 160].map((index) => ({
    id: `candidate-${index}`,
    canonical_url: canonicalUrls[index],
    content_fingerprint: fingerprints[index],
  })) });

  const existing = await findExistingKeys(db, canonicalUrls, fingerprints);
  assert.deepEqual([...existing.canonicalUrls], [canonicalUrls[0], canonicalUrls[80], canonicalUrls[160]]);
  assert.deepEqual([...existing.fingerprints], [fingerprints[0], fingerprints[80], fingerprints[160]]);

  const lookups = db.history.executions.filter(({ operation }) => operation.startsWith('existing_'));
  assert.equal(lookups.length, 6);
  assert.ok(lookups.every(({ bindings }) => bindings.length <= 80));
  assert.deepEqual(lookups.map(({ bindings }) => bindings.length), [80, 80, 1, 80, 80, 1]);
});

test('batch creation inserts the batch and every candidate in one atomic D1 batch call', async () => {
  const db = createFakeD1();
  const candidates = [candidate('candidate-1'), candidate('candidate-2')];
  await createBatchWithCandidates(db, batch('batch-1', { candidateCount: 2 }), candidates);

  assert.equal(db.history.batchCalls.length, 1);
  assert.deepEqual(db.history.batchCalls[0].map(({ operation }) => operation), [
    'batch_insert', 'candidate_insert', 'candidate_insert',
  ]);
  assert.equal(db.batches.length, 1);
  assert.equal(db.candidates.length, 2);
});

test('batch creation atomically persists candidates and linked source runs', async () => {
  const db = createFakeD1();
  const candidates = [candidate('candidate-1')];
  const runs = [
    sourceRun('run-success'),
    sourceRun('run-error', 'batch-1', { status: 'error', candidateCount: 0, error: 'offline' }),
  ];

  await createBatchWithCandidates(db, batch('batch-1'), candidates, runs);

  assert.deepEqual(db.history.batchCalls[0].map(({ operation }) => operation), [
    'batch_insert', 'candidate_insert', 'source_run_insert', 'source_run_insert',
  ]);
  assert.equal(db.batches.length, 1);
  assert.equal(db.candidates.length, 1);
  assert.equal(db.sourceRuns.length, 2);
  assert.ok(db.sourceRuns.every(({ batch_id }) => batch_id === 'batch-1'));
});

test('a source-run failure rolls back the batch, candidates and every source run', async () => {
  const db = createFakeD1({ failBatchOperation: 'source_run_insert' });

  await assert.rejects(
    createBatchWithCandidates(
      db,
      batch('batch-1'),
      [candidate('candidate-1')],
      [sourceRun('run-1')],
    ),
    /simulated D1 batch failure: source_run_insert/,
  );

  assert.equal(db.batches.length, 0);
  assert.equal(db.candidates.length, 0);
  assert.equal(db.sourceRuns.length, 0);
});

test('concurrent batch creates leave one open batch and expose a stable repository conflict', async () => {
  const db = createFakeD1();
  const results = await Promise.allSettled([
    createBatchWithCandidates(db, batch('batch-a'), [candidate('candidate-a', 'batch-a')]),
    createBatchWithCandidates(db, batch('batch-b'), [candidate('candidate-b', 'batch-b')]),
  ]);

  assert.equal(results.filter(({ status }) => status === 'fulfilled').length, 1);
  const conflict = results.find(({ status }) => status === 'rejected').reason;
  assert.equal(conflict.code, 'batch_in_progress');
  assert.equal(conflict.message, 'batch_in_progress');
  assert.equal(db.batches.filter(({ status }) => status === 'open').length, 1);
  assert.equal(db.candidates.length, 1);
});

test('source runs and health updates retain values safely through D1 bindings', async () => {
  const db = createFakeD1({ sources: [{
    id: 'source-1', enabled: 1, etag: null, last_modified: null,
    last_success_at: now - 10_000, last_error_at: null, last_error: null,
  }] });
  const safeError = "upstream failed: '); DROP TABLE itnew_sources; --";
  await recordSourceRun(db, {
    id: 'run-1', sourceId: 'source-1', batchId: null, startedAt: now - 250,
    completedAt: now, status: 'error', durationMs: 250, candidateCount: 0, error: safeError,
  });
  await updateSourceHealth(db, 'source-1', {
    etag: 'etag-new', lastModified: 'Sun, 19 Jul 2026 00:00:00 GMT',
    lastErrorAt: now, lastError: safeError,
  });

  assert.equal(db.sourceRuns[0].error, safeError);
  assert.equal(db.sources[0].etag, 'etag-new');
  assert.equal(db.sources[0].last_success_at, now - 10_000);
  assert.equal(db.sources[0].last_error, safeError);
  assert.ok(db.history.bindings.some(({ values }) => values.includes(safeError)));
  assert.ok(db.history.prepared.every(({ sql }) => !sql.includes(safeError)));
});

test('batch closes only after pending and processing-error candidates are resolved', async () => {
  const db = createFakeD1({
    batches: [{ id: 'batch-1', status: 'open', collected_at: now, closed_at: null }],
    candidates: [
      { id: 'pending', batch_id: 'batch-1', status: 'pending' },
      { id: 'retry', batch_id: 'batch-1', status: 'processing_error' },
    ],
  });

  assert.equal(await closeBatchIfResolved(db, 'batch-1', now + 1000), false);
  db.candidates[0].status = 'approved';
  assert.equal(await closeBatchIfResolved(db, 'batch-1', now + 2000), false);
  db.candidates[1].status = 'rejected';
  assert.equal(await closeBatchIfResolved(db, 'batch-1', now + 3000), true);
  assert.equal(db.batches[0].status, 'closed');
  assert.equal(db.batches[0].closed_at, now + 3000);
});

test('collector rejects missing bindings without exposing binding names', async () => {
  await assert.rejects(collectNextBatch({}, { now }), (error) => {
    assert.equal(error.message, 'IT news collector is not configured');
    assert.doesNotMatch(error.message, /ITNEW_/);
    return true;
  });
});

test('blocking open, pending and processing-error work gates before any fetch', async () => {
  const states = [
    {
      batches: [{ id: 'open', status: 'open', collected_at: now }],
      candidates: [],
    },
    {
      batches: [{ id: 'pending-batch', status: 'closed', collected_at: now }],
      candidates: [{ id: 'pending', batch_id: 'pending-batch', status: 'pending' }],
    },
    {
      batches: [{ id: 'error-batch', status: 'closed', collected_at: now }],
      candidates: [{ id: 'error', batch_id: 'error-batch', status: 'processing_error' }],
    },
  ];

  for (const state of states) {
    const db = createFakeD1({ sources: [enabledSource('techcrunch')], ...state });
    const fetchImpl = createFetchHarness();
    const result = await collectNextBatch(collectorEnv(db), { now, fetchImpl, uuid: uuidSequence() });
    assert.deepEqual(result, { status: 'batch_in_progress', batchId: state.batches[0].id });
    assert.equal(fetchImpl.calls.length, 0);
  }
});

test('one timed-out source and one successful source still create a batch and record both outcomes', async () => {
  const db = createFakeD1({ sources: [enabledSource('36kr'), enabledSource('techcrunch')] });
  const fetchImpl = createFetchHarness({
    [sourceFixtures['36kr'].feed_url]: (_url, { signal }) => new Promise((_, reject) => {
      signal.addEventListener('abort', () => reject(new Error('upstream aborted by timeout')), { once: true });
    }),
    [sourceFixtures.techcrunch.feed_url]: response(rss(feedEntries('techcrunch', 2))),
  });

  const result = await collectNextBatch(collectorEnv(db), {
    now, fetchImpl, timeoutMs: 1, uuid: uuidSequence(),
  });

  assert.equal(result.status, 'created');
  assert.equal(result.candidateCount, 2);
  assert.equal(db.batches.length, 1);
  assert.equal(db.sourceRuns.length, 2);
  assert.deepEqual(new Set(db.sourceRuns.map(({ status }) => status)), new Set(['success', 'error']));
  assert.ok(db.sourceRuns.every(({ batch_id }) => batch_id === result.batchId));
  assert.deepEqual(db.history.batchCalls.at(-1).map(({ operation }) => operation), [
    'batch_insert', 'candidate_insert', 'candidate_insert', 'source_run_insert', 'source_run_insert',
  ]);
  assert.ok(db.sources.find(({ id }) => id === 'techcrunch').last_success_at);
  assert.match(db.sources.find(({ id }) => id === '36kr').last_error, /aborted by timeout/);
});

test('all enabled sources failing returns all_sources_failed without a batch', async () => {
  const db = createFakeD1({ sources: [enabledSource('36kr'), enabledSource('techcrunch')] });
  const fetchImpl = createFetchHarness({ default: () => { throw new Error('offline'); } });

  const result = await collectNextBatch(collectorEnv(db), { now, fetchImpl, uuid: uuidSequence() });

  assert.deepEqual(result, { status: 'all_sources_failed', candidateCount: 0 });
  assert.equal(db.batches.length, 0);
  assert.equal(db.sourceRuns.length, 2);
  assert.ok(db.sourceRuns.every(({ status }) => status === 'error'));
  assert.ok(db.sourceRuns.every(({ batch_id }) => batch_id === null));
});

test('collector selects exactly 30 while obeying language, source and category caps', async () => {
  const definitions = [
    ['36kr', 'security'], ['infoq-cn', 'AI'], ['oschina', 'chips'], ['solidot', 'development'],
    ['techcrunch', 'security'], ['the-verge', 'AI'], ['ars-technica', 'chips'], ['wired', 'development'],
  ];
  const db = createFakeD1({ sources: definitions.map(([id]) => enabledSource(id)) });
  const routes = Object.fromEntries(definitions.map(([id, category]) => [
    sourceFixtures[id].feed_url,
    response(rss(feedEntries(id, 6, { category }))),
  ]));

  const result = await collectNextBatch(collectorEnv(db), {
    now, fetchImpl: createFetchHarness(routes), uuid: uuidSequence(),
  });

  assert.equal(result.candidateCount, 30);
  assert.equal(db.candidates.length, 30);
  assert.deepEqual(Object.fromEntries(['zh', 'en'].map((language) => [
    language, db.candidates.filter((candidate) => candidate.language === language).length,
  ])), { zh: 15, en: 15 });
  for (const field of ['source_id', 'category']) {
    const counts = new Map();
    for (const item of db.candidates) counts.set(item[field], (counts.get(item[field]) || 0) + 1);
    assert.ok([...counts.values()].every((count) => count <= (field === 'source_id' ? 5 : 8)));
  }
});

test('fewer than 30 candidates creates a smaller batch with an insufficient warning', async () => {
  const db = createFakeD1({ sources: [enabledSource('techcrunch')] });
  const fetchImpl = createFetchHarness({
    [sourceFixtures.techcrunch.feed_url]: response(rss(feedEntries('techcrunch', 3))),
  });

  const result = await collectNextBatch(collectorEnv(db), { now, fetchImpl, uuid: uuidSequence() });

  assert.equal(result.status, 'created');
  assert.equal(result.candidateCount, 3);
  assert.ok(result.warnings.includes('insufficient_candidates'));
  assert.equal(db.candidates.length, 3);
});

test('stored canonical and fingerprint duplicates plus near-title duplicates are excluded', async () => {
  const source = enabledSource('techcrunch');
  const db = createFakeD1({ sources: [source] });
  const firstFetch = createFetchHarness({
    [source.feed_url]: response(rss([{
      title: 'Original fingerprint title', url: 'https://techcrunch.test/original',
      summary: 'Shared summary', content: '<p>Shared full body</p>',
    }])),
  });
  await collectNextBatch(collectorEnv(db), { now, fetchImpl: firstFetch, uuid: uuidSequence('first') });
  db.batches[0].status = 'closed';
  db.candidates[0].status = 'approved';

  const secondFetch = createFetchHarness({
    [source.feed_url]: response(rss([
      { title: 'Different canonical title', url: 'https://techcrunch.test/original', content: '<p>Different</p>' },
      { title: 'Renamed fingerprint item', url: 'https://techcrunch.test/renamed', summary: 'Other', content: '<p>Shared full body</p>' },
      { title: 'A remarkable developer platform launch', url: 'https://techcrunch.test/near-1', content: '<p>Near one</p>' },
      { title: 'A remarkable developer platform launch!', url: 'https://techcrunch.test/near-2', content: '<p>Near two</p>' },
      { title: 'Unique security bulletin', url: 'https://techcrunch.test/unique', content: '<p>Unique</p>' },
    ])),
  });
  const result = await collectNextBatch(collectorEnv(db), {
    now: now + 1000, fetchImpl: secondFetch, uuid: uuidSequence('second'),
  });

  assert.equal(result.candidateCount, 2);
  const secondBatch = db.batches.find(({ id }) => id === result.batchId);
  const titles = db.candidates.filter(({ batch_id }) => batch_id === secondBatch.id).map(({ title }) => title);
  assert.equal(titles.filter((title) => title.startsWith('A remarkable')).length, 1);
  assert.ok(titles.includes('Unique security bulletin'));
});

test('HN hydrates no more than 20 numeric IDs with concurrency capped at 10', async () => {
  const db = createFakeD1({ sources: [enabledSource('hacker-news')] });
  let active = 0;
  let maximumActive = 0;
  let itemRequests = 0;
  const topUrl = sourceFixtures['hacker-news'].feed_url;
  const fetchImpl = createFetchHarness({
    [topUrl]: response(JSON.stringify(Array.from({ length: 80 }, (_, index) => index + 1))),
    default: async (url) => {
      itemRequests += 1;
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active -= 1;
      const id = Number(url.match(/(\d+)\.json$/)[1]);
      return response(JSON.stringify({ id, title: `Developer HN ${id}`, url: `https://hn.test/${id}`, time: now / 1000 }));
    },
  });

  await collectNextBatch(collectorEnv(db), { now, fetchImpl, uuid: uuidSequence() });

  assert.equal(itemRequests, 20);
  assert.ok(maximumActive > 1);
  assert.ok(maximumActive <= 10);
});

test('one failed HN item preserves hydrated siblings and persists a stable warning', async () => {
  const source = enabledSource('hacker-news');
  const db = createFakeD1({ sources: [source] });
  const fetchImpl = createFetchHarness({
    [source.feed_url]: response('[1,2,3]'),
    default: (url) => {
      const id = Number(url.match(/(\d+)\.json$/)[1]);
      if (id === 2) return response('', { status: 503 });
      return response(JSON.stringify({
        id,
        title: id === 1 ? 'Developer database release' : 'Security browser update',
        url: `https://hn.test/${id}`,
        time: now / 1000,
      }));
    },
  });

  const result = await collectNextBatch(collectorEnv(db), { now, fetchImpl, uuid: uuidSequence() });

  assert.equal(result.status, 'created');
  assert.equal(result.candidateCount, 2);
  assert.ok(result.warnings.includes('hn_item_failed:2:HTTP 503'));
  assert.ok(JSON.parse(db.batches[0].warnings_json).includes('hn_item_failed:2:HTTP 503'));
});

test('conditional validators are sent and refreshed while 304 is a successful empty source', async () => {
  const source = enabledSource('techcrunch', {
    etag: 'old-tag', last_modified: 'Sat, 18 Jul 2026 00:00:00 GMT',
  });
  const db = createFakeD1({ sources: [source] });
  const fetchImpl = createFetchHarness({
    [source.feed_url]: response('', {
      status: 304,
      headers: { etag: 'new-tag', 'last-modified': 'Sun, 19 Jul 2026 00:00:00 GMT' },
    }),
  });

  const result = await collectNextBatch(collectorEnv(db), { now, fetchImpl, uuid: uuidSequence() });

  assert.equal(result.status, 'no_new_candidates');
  const requestHeaders = fetchImpl.calls[0].init.headers;
  assert.equal(requestHeaders['If-None-Match'], 'old-tag');
  assert.equal(requestHeaders['If-Modified-Since'], 'Sat, 18 Jul 2026 00:00:00 GMT');
  assert.equal(db.sources[0].etag, 'new-tag');
  assert.equal(db.sources[0].last_modified, 'Sun, 19 Jul 2026 00:00:00 GMT');
  assert.equal(db.sourceRuns[0].status, 'success');
  assert.equal(db.sourceRuns[0].batch_id, null);
});

test('full-text R2 staging requires promoted source rights, explicit article permission and content', async () => {
  const source = enabledSource('hacker-news', {
    rights_mode: 'licensed_full', license_name: 'Test License', license_url: 'https://license.test/',
  });
  const db = createFakeD1({ sources: [source] });
  const images = createFakeR2();
  const topUrl = source.feed_url;
  const items = {
    1: { id: 1, title: 'Developer allowed', url: 'https://hn.test/1', time: now / 1000, articlePermissionVerified: true, content: '<p>Allowed body</p>' },
    2: { id: 2, title: 'Developer unverified', url: 'https://hn.test/2', time: now / 1000, articlePermissionVerified: false, content: '<p>Unverified body</p>' },
    3: { id: 3, title: 'Developer empty', url: 'https://hn.test/3', time: now / 1000, articlePermissionVerified: true, content: '' },
  };
  const fetchImpl = createFetchHarness({
    [topUrl]: response('[1,2,3]'),
    default: (url) => response(JSON.stringify(items[Number(url.match(/(\d+)\.json$/)[1])])),
  });

  const result = await collectNextBatch(collectorEnv(db, images), { now, fetchImpl, uuid: uuidSequence() });

  assert.equal(result.candidateCount, 3);
  assert.equal(images.puts.length, 1);
  assert.match(images.puts[0].key, /^staged\/[a-f0-9]{64}\.html$/);
  const rights = Object.fromEntries(db.candidates.map(({ title, rights_mode_snapshot }) => [title, rights_mode_snapshot]));
  assert.equal(rights['Developer allowed'], 'licensed_full');
  assert.equal(rights['Developer unverified'], 'summary_link');
  assert.equal(rights['Developer empty'], 'summary_link');
  assert.equal(db.candidates.filter(({ staged_body_key }) => staged_body_key).length, 1);
  const licenseSnapshots = Object.fromEntries(db.candidates.map((candidate) => [
    candidate.title,
    JSON.parse(candidate.license_snapshot_json),
  ]));
  assert.equal(licenseSnapshots['Developer allowed'].articleAllowed, true);
  assert.equal(licenseSnapshots['Developer unverified'].articleAllowed, false);
  assert.equal(licenseSnapshots['Developer empty'].articleAllowed, false);
});

test('explicit article permission cannot stage full text when source rights remain summary_link', async () => {
  const source = enabledSource('hacker-news', { rights_mode: 'summary_link' });
  const db = createFakeD1({ sources: [source] });
  const images = createFakeR2();
  const fetchImpl = createFetchHarness({
    [source.feed_url]: response('[1]'),
    default: response(JSON.stringify({
      id: 1, title: 'Developer source-rights gate', url: 'https://hn.test/rights', time: now / 1000,
      articlePermissionVerified: true, content: '<p>Permission alone is insufficient</p>',
    })),
  });

  await collectNextBatch(collectorEnv(db, images), { now, fetchImpl, uuid: uuidSequence() });

  assert.equal(images.puts.length, 0);
  assert.equal(db.candidates[0].staged_body_key, null);
  assert.equal(db.candidates[0].rights_mode_snapshot, 'summary_link');
  assert.equal(JSON.parse(db.candidates[0].license_snapshot_json).articleAllowed, false);
});

test('one R2 put failure downgrades only that candidate and identifies it safely', async () => {
  const source = enabledSource('hacker-news', { rights_mode: 'licensed_full' });
  const db = createFakeD1({ sources: [source] });
  const images = createFakeR2({ failPut: (_put, index) => index === 0 });
  const fetchImpl = createFetchHarness({
    [source.feed_url]: response('[1,2]'),
    default: (url) => {
      const id = Number(url.match(/(\d+)\.json$/)[1]);
      return response(JSON.stringify({
        id,
        title: id === 1 ? 'Developer licensed failure' : 'Security licensed success',
        url: `https://hn.test/${id}`,
        time: now / 1000,
        articlePermissionVerified: true,
        content: `<p>Secret full body ${id}</p>`,
      }));
    },
  });

  const result = await collectNextBatch(collectorEnv(db, images), { now, fetchImpl, uuid: uuidSequence() });

  const failed = db.candidates.find(({ staged_body_key }) => staged_body_key === null);
  const staged = db.candidates.find(({ staged_body_key }) => staged_body_key !== null);
  const warning = result.warnings.find((item) => item.startsWith('r2_put_failed:'));
  assert.equal(images.puts.length, 2);
  assert.ok(failed);
  assert.ok(staged);
  assert.equal(failed.rights_mode_snapshot, 'summary_link');
  assert.equal(staged.rights_mode_snapshot, 'licensed_full');
  assert.equal(JSON.parse(failed.license_snapshot_json).articleAllowed, false);
  assert.equal(JSON.parse(staged.license_snapshot_json).articleAllowed, true);
  assert.equal(warning, `r2_put_failed:${failed.id}`);
  assert.doesNotMatch(warning, /Secret full body/);
  assert.ok(JSON.parse(db.batches[0].warnings_json).includes(warning));
});

test('two concurrent collections leave one created batch and one batch_in_progress result', async () => {
  const source = enabledSource('techcrunch');
  const db = createFakeD1({ sources: [source] });
  const fetchImpl = createFetchHarness({
    [source.feed_url]: response(rss(feedEntries('techcrunch', 1))),
  });
  const uuid = uuidSequence('concurrent');

  const results = await Promise.all([
    collectNextBatch(collectorEnv(db), { now, fetchImpl, uuid }),
    collectNextBatch(collectorEnv(db), { now, fetchImpl, uuid }),
  ]);

  assert.deepEqual(results.map(({ status }) => status).sort(), ['batch_in_progress', 'created']);
  assert.equal(db.batches.filter(({ status }) => status === 'open').length, 1);
  const created = results.find(({ status }) => status === 'created');
  assert.equal(db.sourceRuns.filter(({ batch_id }) => batch_id === created.batchId).length, 1);
  assert.equal(db.sourceRuns.filter(({ batch_id }) => batch_id === null).length, 1);
});

test('language balance fallback is observable when both pools have 15 but caps prevent 15/15', async () => {
  const definitions = [
    ['36kr', 'security'], ['infoq-cn', 'security'], ['oschina', 'security'],
    ['techcrunch', 'development'], ['the-verge', 'AI'], ['ars-technica', 'chips'],
  ];
  const db = createFakeD1({ sources: definitions.map(([id]) => enabledSource(id)) });
  const fetchImpl = createFetchHarness(Object.fromEntries(definitions.map(([id, category]) => [
    sourceFixtures[id].feed_url, response(rss(feedEntries(id, 5, { category }))),
  ])));

  const result = await collectNextBatch(collectorEnv(db), { now, fetchImpl, uuid: uuidSequence() });

  assert.ok(result.warnings.includes('language_balance_fallback'));
  const languages = db.candidates.reduce((counts, candidate) => ({
    ...counts, [candidate.language]: (counts[candidate.language] || 0) + 1,
  }), {});
  assert.notDeepEqual(languages, { zh: 15, en: 15 });
});
