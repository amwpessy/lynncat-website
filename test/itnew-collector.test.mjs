import test from 'node:test';
import assert from 'node:assert/strict';

import { createFakeD1 } from './helpers/itnew-fakes.mjs';
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
