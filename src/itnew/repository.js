const LOOKUP_CHUNK_SIZE = 80;

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

function chunks(values, size = LOOKUP_CHUNK_SIZE) {
  const groups = [];
  for (let index = 0; index < values.length; index += size) {
    groups.push(values.slice(index, index + size));
  }
  return groups;
}

function changesFrom(result) {
  return Number(result?.meta?.changes ?? result?.changes ?? 0);
}

function jsonValue(value) {
  if (value == null || typeof value === 'string') return value ?? null;
  return JSON.stringify(value);
}

function isOpenBatchConflict(error) {
  const message = String(error?.message || error);
  return /itnew_one_open_batch|UNIQUE constraint failed:\s*itnew_batches\.status/i.test(message);
}

function batchConflict(error) {
  const conflict = new Error('batch_in_progress', { cause: error });
  conflict.code = 'batch_in_progress';
  return conflict;
}

export async function syncSourceRegistry(db, registry, now) {
  void now;
  const statements = registry.map((source) => db.prepare(`
    /* itnew:source_upsert */
    INSERT INTO itnew_sources (
      id, name, feed_url, homepage_url, language, rights_mode,
      license_name, license_url, attribution_template, priority_weight, enabled
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name = excluded.name,
      feed_url = excluded.feed_url,
      homepage_url = excluded.homepage_url,
      language = excluded.language,
      priority_weight = excluded.priority_weight
  `).bind(
    source.id,
    source.name,
    source.feedUrl,
    source.homepageUrl,
    source.language,
    'summary_link',
    source.licenseName ?? null,
    source.licenseUrl ?? null,
    source.attributionTemplate ?? null,
    source.priorityWeight ?? 0,
    0,
  ));
  if (statements.length > 0) await db.batch(statements);
}

export async function getBlockingBatch(db) {
  const open = await db.prepare(`
    /* itnew:blocking_open */
    SELECT *
    FROM itnew_batches
    WHERE status = 'open'
    ORDER BY collected_at ASC
    LIMIT 1
  `).first();
  if (open) return open;

  return db.prepare(`
    /* itnew:blocking_candidates */
    SELECT b.*
    FROM itnew_batches AS b
    WHERE EXISTS (
      SELECT 1
      FROM itnew_candidates AS c
      WHERE c.batch_id = b.id
        AND c.status IN ('pending', 'processing_error')
    )
    ORDER BY b.collected_at ASC
    LIMIT 1
  `).first();
}

export async function listEnabledSources(db) {
  const result = await db.prepare(`
    /* itnew:enabled_sources */
    SELECT *
    FROM itnew_sources
    WHERE enabled = 1
    ORDER BY priority_weight DESC, id ASC
  `).all();
  return result.results;
}

async function findValues(db, operation, column, values) {
  const found = new Set();
  for (const group of chunks([...new Set(values)])) {
    const placeholders = group.map(() => '?').join(', ');
    const result = await db.prepare(`
      /* itnew:${operation} */
      SELECT ${column}
      FROM itnew_candidates
      WHERE ${column} IN (${placeholders})
    `).bind(...group).all();
    for (const row of result.results) found.add(row[column]);
  }
  return found;
}

export async function findExistingKeys(db, canonicalUrls, fingerprints) {
  const existingUrls = await findValues(db, 'existing_urls', 'canonical_url', canonicalUrls);
  const existingFingerprints = await findValues(
    db,
    'existing_fingerprints',
    'content_fingerprint',
    fingerprints,
  );
  return { canonicalUrls: existingUrls, fingerprints: existingFingerprints };
}

function batchInsert(db, batch, candidateCount) {
  return db.prepare(`
    /* itnew:batch_insert */
    INSERT INTO itnew_batches (
      id, status, target_count, candidate_count, collected_at, closed_at, warnings_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(
    batch.id,
    batch.status ?? 'open',
    batch.targetCount,
    batch.candidateCount ?? candidateCount,
    batch.collectedAt,
    batch.closedAt ?? null,
    batch.warningsJson ?? jsonValue(batch.warnings ?? []),
  );
}

function candidateInsert(db, candidate) {
  return db.prepare(`
    /* itnew:candidate_insert */
    INSERT INTO itnew_candidates (
      id, batch_id, source_id, canonical_url, content_fingerprint, title, summary,
      staged_body_key, remote_image_url, language, category, score, rights_mode_snapshot,
      license_snapshot_json, status, processing_error, article_id, source_published_at,
      created_at, reviewed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    candidate.id,
    candidate.batchId,
    candidate.sourceId,
    candidate.canonicalUrl,
    candidate.contentFingerprint,
    candidate.title,
    candidate.summary,
    candidate.stagedBodyKey ?? null,
    candidate.remoteImageUrl ?? null,
    candidate.language,
    candidate.category,
    candidate.score,
    candidate.rightsModeSnapshot,
    candidate.licenseSnapshotJson ?? jsonValue(candidate.licenseSnapshot),
    candidate.status ?? 'pending',
    candidate.processingError ?? null,
    candidate.articleId ?? null,
    candidate.sourcePublishedAt ?? null,
    candidate.createdAt,
    candidate.reviewedAt ?? null,
  );
}

function sourceRunInsert(db, run) {
  return db.prepare(`
    /* itnew:source_run_insert */
    INSERT INTO itnew_source_runs (
      id, source_id, batch_id, started_at, completed_at, status,
      duration_ms, candidate_count, error
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    run.id,
    run.sourceId,
    run.batchId ?? null,
    run.startedAt,
    run.completedAt ?? null,
    run.status,
    run.durationMs ?? null,
    run.candidateCount ?? 0,
    run.error ?? null,
  );
}

export async function createBatchWithCandidates(db, batch, candidates, sourceRuns = []) {
  const statements = [
    batchInsert(db, batch, candidates.length),
    ...candidates.map((candidate) => candidateInsert(db, candidate)),
    ...sourceRuns.map((run) => sourceRunInsert(db, run)),
  ];
  try {
    return await db.batch(statements);
  } catch (error) {
    if (isOpenBatchConflict(error)) throw batchConflict(error);
    throw error;
  }
}

export async function recordSourceRun(db, run) {
  return sourceRunInsert(db, run).run();
}

export async function updateSourceHealth(db, sourceId, health) {
  return db.prepare(`
    /* itnew:source_health_update */
    UPDATE itnew_sources SET
      etag = CASE WHEN ? = 1 THEN ? ELSE etag END,
      last_modified = CASE WHEN ? = 1 THEN ? ELSE last_modified END,
      last_success_at = CASE WHEN ? = 1 THEN ? ELSE last_success_at END,
      last_error_at = CASE WHEN ? = 1 THEN ? ELSE last_error_at END,
      last_error = CASE WHEN ? = 1 THEN ? ELSE last_error END
    WHERE id = ?
  `).bind(
    Number(hasOwn(health, 'etag')), health.etag ?? null,
    Number(hasOwn(health, 'lastModified')), health.lastModified ?? null,
    Number(hasOwn(health, 'lastSuccessAt')), health.lastSuccessAt ?? null,
    Number(hasOwn(health, 'lastErrorAt')), health.lastErrorAt ?? null,
    Number(hasOwn(health, 'lastError')), health.lastError ?? null,
    sourceId,
  ).run();
}

export async function closeBatchIfResolved(db, batchId, now) {
  const result = await db.prepare(`
    /* itnew:batch_close */
    UPDATE itnew_batches
    SET status = 'closed', closed_at = ?
    WHERE id = ?
      AND status = 'open'
      AND NOT EXISTS (
        SELECT 1
        FROM itnew_candidates
        WHERE batch_id = ?
          AND status IN ('pending', 'processing_error')
      )
  `).bind(now, batchId, batchId).run();
  return changesFrom(result) > 0;
}
