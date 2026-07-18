import {
  normalizeEntry,
  parseFeed,
  scoreCandidate,
  selectBalancedCandidates,
} from './normalize.js';
import {
  createBatchWithCandidates,
  findExistingKeys,
  getBlockingBatch,
  listEnabledSources,
  recordSourceRun,
  syncSourceRegistry,
  updateSourceHealth,
} from './repository.js';
import { SOURCE_REGISTRY } from './sources.js';

const FETCH_TIMEOUT_MS = 12_000;
const HN_ITEM_LIMIT = 60;
const HN_CONCURRENCY = 10;
const BATCH_LIMIT = 30;

function collectionTime(value) {
  const resolved = typeof value === 'function' ? value() : value;
  return Number.isFinite(resolved) ? resolved : Date.now();
}

function errorText(error) {
  return error instanceof Error ? error.message : String(error);
}

function responseHeader(response, name) {
  return response?.headers?.get?.(name) ?? null;
}

function sourceHeaders(source) {
  const headers = {};
  if (source.etag) headers['If-None-Match'] = source.etag;
  if (source.last_modified) headers['If-Modified-Since'] = source.last_modified;
  return headers;
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(String(value));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function fingerprintInput(entry) {
  const body = String(entry.content || '').replace(/\s+/g, ' ').trim();
  if (body) return body;
  return `${entry.title}\n${entry.summary}`.toLocaleLowerCase().replace(/\s+/g, ' ').trim();
}

function mergeSource(row) {
  const registered = SOURCE_REGISTRY.find(({ id }) => id === row.id) || {};
  return { ...registered, ...row, adapter: registered.adapter || 'feed' };
}

async function hydrateHackerNews(references, source, fetchImpl, signal, warnings) {
  const queued = references.slice(0, HN_ITEM_LIMIT);
  const hydrated = [];
  let cursor = 0;
  let failures = 0;

  const worker = async () => {
    while (cursor < queued.length) {
      const reference = queued[cursor++];
      try {
        const response = await fetchImpl(reference.hydrationUrl, { signal });
        if (!response?.ok) throw new Error(`HTTP ${response?.status ?? 'unknown'}`);
        const body = await response.text();
        const raw = JSON.parse(body);
        const parsed = parseFeed(body, source);
        if (!parsed.length) throw new Error('invalid HN item');
        for (const entry of parsed) {
          hydrated.push({
            ...entry,
            ...(raw?.articlePermissionVerified === true ? { articlePermissionVerified: true } : {}),
            ...(typeof raw?.content === 'string' ? { content: raw.content } : {}),
          });
        }
      } catch (error) {
        failures += 1;
        warnings.push(`hn_item_failed:${reference.id}:${errorText(error)}`);
      }
    }
  };

  await Promise.all(Array.from(
    { length: Math.min(HN_CONCURRENCY, queued.length) },
    () => worker(),
  ));
  return { entries: hydrated, failures, requested: queued.length };
}

async function fetchSource(source, { fetchImpl, timeoutMs, makeUuid, now }) {
  const startedAt = Date.now();
  const warnings = [];
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let entries = [];
  let response = null;
  let fetchError = null;

  try {
    response = await fetchImpl(source.feed_url, {
      headers: sourceHeaders(source),
      signal: controller.signal,
    });
    if (response?.status === 304) {
      entries = [];
    } else {
      if (!response?.ok) throw new Error(`HTTP ${response?.status ?? 'unknown'}`);
      const body = await response.text();
      const parsed = parseFeed(body, source);
      if (source.adapter === 'hn_json') {
        const references = parsed.filter(({ hydrationUrl }) => hydrationUrl);
        const direct = parsed.filter(({ hydrationUrl }) => !hydrationUrl);
        const hydrated = await hydrateHackerNews(
          references,
          source,
          fetchImpl,
          controller.signal,
          warnings,
        );
        if (references.length && hydrated.requested === hydrated.failures && direct.length === 0) {
          throw new Error('all HN item hydrations failed');
        }
        entries = [...direct, ...hydrated.entries];
      } else {
        entries = parsed;
      }
    }
  } catch (error) {
    fetchError = error;
  } finally {
    clearTimeout(timeout);
  }

  const completedAt = Date.now();
  if (fetchError) {
    await updateSourceHealth(source.db, source.id, {
      lastErrorAt: now,
      lastError: errorText(fetchError),
    });
    await recordSourceRun(source.db, {
      id: makeUuid(),
      sourceId: source.id,
      batchId: null,
      startedAt,
      completedAt,
      status: 'error',
      durationMs: Math.max(0, completedAt - startedAt),
      candidateCount: 0,
      error: errorText(fetchError),
    });
    return { ok: false, source, entries: [], warnings, error: fetchError };
  }

  const health = { lastSuccessAt: now, lastError: null };
  const etag = responseHeader(response, 'etag');
  const lastModified = responseHeader(response, 'last-modified');
  if (etag !== null) health.etag = etag;
  if (lastModified !== null) health.lastModified = lastModified;
  await updateSourceHealth(source.db, source.id, health);
  await recordSourceRun(source.db, {
    id: makeUuid(),
    sourceId: source.id,
    batchId: null,
    startedAt,
    completedAt,
    status: 'success',
    durationMs: Math.max(0, completedAt - startedAt),
    candidateCount: entries.length,
    error: null,
  });
  return { ok: true, source, entries, warnings };
}

function licenseSnapshot(source) {
  return {
    name: source.license_name ?? null,
    url: source.license_url ?? null,
    attributionTemplate: source.attribution_template ?? null,
  };
}

async function stageCandidate(candidate, images, warnings) {
  const canStage = candidate.source.rights_mode === 'licensed_full'
    && candidate.articlePermissionVerified === true
    && String(candidate.content || '').trim().length > 0;
  if (!canStage) {
    return { stagedBodyKey: null, rightsModeSnapshot: 'summary_link', licenseSnapshot: null };
  }

  const stagedBodyKey = `staged/${await sha256(candidate.content)}.html`;
  try {
    await images.put(stagedBodyKey, candidate.content, {
      httpMetadata: { contentType: 'text/html; charset=utf-8' },
    });
    return {
      stagedBodyKey,
      rightsModeSnapshot: 'licensed_full',
      licenseSnapshot: licenseSnapshot(candidate.source),
    };
  } catch (error) {
    warnings.push(`r2_put_failed:${candidate.sourceId}:${errorText(error)}`);
    return { stagedBodyKey: null, rightsModeSnapshot: 'summary_link', licenseSnapshot: null };
  }
}

export async function collectNextBatch(env, options = {}) {
  if (!env?.ITNEW_DB || !env?.ITNEW_IMAGES) {
    throw new Error('IT news collector is not configured');
  }

  const db = env.ITNEW_DB;
  const now = collectionTime(options.now);
  const fetchImpl = options.fetchImpl || fetch;
  const makeUuid = options.uuid || (() => crypto.randomUUID());
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : FETCH_TIMEOUT_MS;
  void options.trigger;

  await syncSourceRegistry(db, SOURCE_REGISTRY, now);
  const blocking = await getBlockingBatch(db);
  if (blocking) return { status: 'batch_in_progress', batchId: blocking.id };

  const enabled = (await listEnabledSources(db)).map((row) => ({ ...mergeSource(row), db }));
  const fetched = await Promise.all(enabled.map((source) => fetchSource(source, {
    fetchImpl, timeoutMs, makeUuid, now,
  })));
  const failed = fetched.filter(({ ok }) => !ok);
  if (enabled.length > 0 && failed.length === enabled.length) {
    return { status: 'all_sources_failed', candidateCount: 0 };
  }

  const warnings = fetched.flatMap((result) => result.warnings);
  for (const result of failed) warnings.push(`source_failed:${result.source.id}:${errorText(result.error)}`);
  const prepared = [];
  for (const result of fetched.filter(({ ok }) => ok)) {
    for (const rawEntry of result.entries) {
      const normalized = normalizeEntry(rawEntry, result.source, now);
      const score = scoreCandidate(normalized, now);
      if (!normalized.canonicalUrl || score <= 0) continue;
      prepared.push({
        ...normalized,
        score,
        source: result.source,
        contentFingerprint: await sha256(fingerprintInput(normalized)),
      });
    }
  }

  const existing = await findExistingKeys(
    db,
    prepared.map(({ canonicalUrl }) => canonicalUrl),
    prepared.map(({ contentFingerprint }) => contentFingerprint),
  );
  const eligible = [];
  const seenCanonicalUrls = new Set();
  const seenFingerprints = new Set();
  for (const item of [...prepared].sort((left, right) => right.score - left.score)) {
    if (existing.canonicalUrls.has(item.canonicalUrl)
      || existing.fingerprints.has(item.contentFingerprint)
      || seenCanonicalUrls.has(item.canonicalUrl)
      || seenFingerprints.has(item.contentFingerprint)) continue;
    eligible.push(item);
    seenCanonicalUrls.add(item.canonicalUrl);
    seenFingerprints.add(item.contentFingerprint);
  }
  const selected = selectBalancedCandidates(eligible, BATCH_LIMIT);

  if (selected.length === 0) {
    const lateBlocking = await getBlockingBatch(db);
    if (lateBlocking) return { status: 'batch_in_progress', batchId: lateBlocking.id };
    return { status: 'no_new_candidates', candidateCount: 0, warnings };
  }
  if (selected.length < BATCH_LIMIT) warnings.push('insufficient_candidates');
  const eligibleLanguages = eligible.reduce((counts, candidate) => {
    counts[candidate.language] = (counts[candidate.language] || 0) + 1;
    return counts;
  }, {});
  const selectedLanguages = selected.reduce((counts, candidate) => {
    counts[candidate.language] = (counts[candidate.language] || 0) + 1;
    return counts;
  }, {});
  if ((eligibleLanguages.zh || 0) >= 15
    && (eligibleLanguages.en || 0) >= 15
    && ((selectedLanguages.zh || 0) !== 15 || (selectedLanguages.en || 0) !== 15)) {
    warnings.push('language_balance_fallback');
  }

  const batchId = makeUuid();
  const candidates = [];
  for (const item of selected) {
    const staged = await stageCandidate(item, env.ITNEW_IMAGES, warnings);
    candidates.push({
      id: makeUuid(),
      batchId,
      sourceId: item.sourceId,
      canonicalUrl: item.canonicalUrl,
      contentFingerprint: item.contentFingerprint,
      title: item.title,
      summary: item.summary,
      stagedBodyKey: staged.stagedBodyKey,
      remoteImageUrl: item.imageUrl ?? null,
      language: item.language,
      category: item.category,
      score: Math.round(item.score),
      rightsModeSnapshot: staged.rightsModeSnapshot,
      licenseSnapshot: staged.licenseSnapshot,
      status: 'pending',
      sourcePublishedAt: item.publishedAt,
      createdAt: now,
    });
  }

  try {
    await createBatchWithCandidates(db, {
      id: batchId,
      status: 'open',
      targetCount: BATCH_LIMIT,
      candidateCount: candidates.length,
      collectedAt: now,
      warnings,
    }, candidates);
  } catch (error) {
    if (error?.code === 'batch_in_progress') {
      const current = await getBlockingBatch(db);
      return { status: 'batch_in_progress', batchId: current?.id ?? null };
    }
    throw error;
  }

  return { status: 'created', batchId, candidateCount: candidates.length, warnings };
}
