import {
  AuthError,
  handleLogin,
  handleLogout,
  requireAdmin,
  validateAdminMutation,
} from './auth.js';
import {
  PublicationPreparationError,
  cleanupPreparedPublication,
  isCandidateClaimConflict,
  prepareCandidatePublication,
  preparedPublicationStatements,
  processingErrorStatements,
  unpublishArticle as publishUnpublishArticle,
} from './publisher.js';
import { collectNextBatch } from './collector.js';
import { getBlockingBatch } from './repository.js';

function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...headers,
    },
  });
}

class AdminApiError extends Error {
  constructor(code, status) {
    super(code);
    this.name = 'AdminApiError';
    this.code = code;
    this.status = status;
  }
}

async function requestJson(request) {
  try {
    return await request.json();
  } catch {
    throw new AdminApiError('invalid_request', 400);
  }
}

function exactKeys(value, expected) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join('\0') === [...expected].sort().join('\0');
}

function validateBulkBody(body) {
  if (!exactKeys(body, ['batchId', 'candidateIds', 'decision'])
    || typeof body.batchId !== 'string' || !body.batchId
    || !Array.isArray(body.candidateIds)
    || body.candidateIds.length < 1 || body.candidateIds.length > 30
    || !body.candidateIds.every((id) => typeof id === 'string' && id)
    || new Set(body.candidateIds).size !== body.candidateIds.length
    || !['approve', 'reject'].includes(body.decision)) {
    throw new AdminApiError('invalid_request', 400);
  }
  return body;
}

async function candidatesForReview(db, ids) {
  const placeholders = ids.map(() => '?').join(', ');
  const result = await db.prepare(`
    /* itnew:admin_candidates_by_ids */
    SELECT *
    FROM itnew_candidates
    WHERE id IN (${placeholders})
    ORDER BY id ASC
  `).bind(...ids).all();
  return result.results;
}

async function reviewBulkService({ request, env, context, session }) {
  const body = validateBulkBody(await requestJson(request));
  const db = env.ITNEW_DB;
  const candidates = await candidatesForReview(db, body.candidateIds);
  if (candidates.length !== body.candidateIds.length
    || candidates.some((candidate) => candidate.batch_id !== body.batchId
      || candidate.status !== 'pending' || candidate.article_id != null)) {
    throw new AdminApiError('candidate_conflict', 409);
  }
  const sortedCandidates = [...candidates].sort((left, right) => left.id.localeCompare(right.id));
  if (body.decision === 'reject') {
    const now = requestNow(context);
    const marker = `reject:${makeId(context)}`;
    const statements = [rejectClaimStatement(
      db,
      sortedCandidates.map(({ id }) => id),
      body.batchId,
      marker,
    )];
    const candidateAuditIds = [];
    for (const candidate of sortedCandidates) {
      const auditId = makeId(context);
      candidateAuditIds.push(auditId);
      statements.push(candidateRejectStatement(db, candidate.id, body.batchId, marker, now));
      statements.push(conditionalCandidateAuditStatement(db, {
        id: auditId, adminId: session.sub, action: 'reject', targetType: 'candidate',
        targetId: candidate.id, batchId: body.batchId, result: 'rejected',
        details: {}, createdAt: now,
      }));
    }
    const summaryAuditId = makeId(context);
    statements.push(conditionalSummaryAuditStatement(db, {
      id: summaryAuditId, adminId: session.sub, action: 'bulk_review', targetType: 'batch',
      targetId: body.batchId, batchId: body.batchId, result: 'rejected',
      details: { decision: body.decision, candidateIds: sortedCandidates.map(({ id }) => id) },
      createdAt: now,
    }, candidateAuditIds));
    statements.push(conditionalCloseBatchStatement(db, body.batchId, now, summaryAuditId));
    const results = await db.batch(statements);
    if (changesFrom(results[0]) !== sortedCandidates.length) {
      throw new AdminApiError('candidate_conflict', 409);
    }
    for (let index = 0; index < sortedCandidates.length; index += 1) {
      if (changesFrom(results[1 + (index * 2)]) !== 1) {
        throw new AdminApiError('candidate_conflict', 409);
      }
    }
    return jsonResponse({
      batchId: body.batchId,
      decision: body.decision,
      candidateIds: sortedCandidates.map(({ id }) => id),
      counts: await reviewCounts(db, body.batchId),
      closed: changesFrom(results.at(-1)) === 1,
    });
  }

  const publisher = publisherFor(context);
  const publicationContext = {
    now: requestNow(context),
    uuid: context.uuid,
    fetchImpl: context.fetchImpl,
    adminId: session.sub,
  };
  const prepared = [];
  for (const candidate of sortedCandidates) {
    try {
      prepared.push(await publisher.prepareCandidatePublication(env, candidate, publicationContext));
    } catch (error) {
      await Promise.all(prepared.map((item) => publisher.cleanupPreparedPublication(env, item)));
      if (error instanceof PublicationPreparationError) {
        await db.batch(publisher.processingErrorStatements(
          db,
          candidate,
          error.code,
          publicationContext,
        ));
        throw new AdminApiError('candidate_conflict', 409);
      }
      throw error;
    }
  }

  const now = requestNow(context);
  const statements = prepared.flatMap((item) => publisher.preparedPublicationStatements(env, item));
  statements.push(auditStatement(db, {
    id: makeId(context), adminId: session.sub, action: 'bulk_review', targetType: 'batch',
    targetId: body.batchId, batchId: body.batchId, result: 'approved',
    details: { decision: body.decision, candidateIds: sortedCandidates.map(({ id }) => id) },
    createdAt: now,
  }));
  statements.push(closeBatchStatement(db, body.batchId, now));
  let results;
  try {
    results = await db.batch(statements);
  } catch (error) {
    await Promise.all(prepared.map((item) => publisher.cleanupPreparedPublication(env, item)));
    if (publisher.isCandidateClaimConflict(error)) {
      throw new AdminApiError('candidate_conflict', 409);
    }
    throw error;
  }
  return jsonResponse({
    batchId: body.batchId,
    decision: body.decision,
    candidateIds: sortedCandidates.map(({ id }) => id),
    counts: await reviewCounts(db, body.batchId),
    closed: changesFrom(results.at(-1)) === 1,
  });
}

function publisherFor(context) {
  return {
    prepareCandidatePublication,
    preparedPublicationStatements,
    cleanupPreparedPublication,
    processingErrorStatements,
    isCandidateClaimConflict,
    ...context.publisher,
  };
}

async function retryCandidateService({ env, context, session, params }) {
  const db = env.ITNEW_DB;
  const candidate = await db.prepare(`
    /* itnew:admin_candidate_retry */
    SELECT * FROM itnew_candidates WHERE id = ? LIMIT 1
  `).bind(params.id).first();
  if (!candidate) throw new AdminApiError('not_found', 404);
  if (candidate.status !== 'processing_error' || candidate.article_id != null) {
    throw new AdminApiError('candidate_conflict', 409);
  }

  const publisher = publisherFor(context);
  const now = requestNow(context);
  const publicationContext = {
    now,
    uuid: context.uuid,
    fetchImpl: context.fetchImpl,
    adminId: session.sub,
  };
  let prepared;
  try {
    prepared = await publisher.prepareCandidatePublication(env, candidate, publicationContext);
  } catch (error) {
    if (error instanceof PublicationPreparationError) {
      await db.batch(publisher.processingErrorStatements(
        db,
        candidate,
        error.code,
        publicationContext,
      ));
      throw new AdminApiError('candidate_conflict', 409);
    }
    throw error;
  }

  const statements = publisher.preparedPublicationStatements(env, prepared);
  statements.push(auditStatement(db, {
    id: makeId(context), adminId: session.sub, action: 'retry', targetType: 'candidate',
    targetId: candidate.id, batchId: candidate.batch_id, result: 'published',
    details: {}, createdAt: now,
  }));
  statements.push(closeBatchStatement(db, candidate.batch_id, now));
  let results;
  try {
    results = await db.batch(statements);
  } catch (error) {
    await publisher.cleanupPreparedPublication(env, prepared);
    if (publisher.isCandidateClaimConflict(error)) {
      throw new AdminApiError('candidate_conflict', 409);
    }
    throw error;
  }
  return jsonResponse({
    ...prepared.result,
    counts: await reviewCounts(db, candidate.batch_id),
    closed: changesFrom(results.at(-1)) === 1,
  });
}

async function collectService({ env, context }) {
  const blocking = await getBlockingBatch(env.ITNEW_DB);
  if (blocking) throw new AdminApiError('batch_in_progress', 409);
  const collectImpl = context.collectImpl || collectNextBatch;
  const result = await collectImpl(env, {
    now: requestNow(context),
    uuid: context.uuid,
    fetchImpl: context.fetchImpl,
    trigger: 'manual',
  });
  if (result?.status === 'batch_in_progress') {
    throw new AdminApiError('batch_in_progress', 409);
  }
  return jsonResponse(result, result?.status === 'created' ? 201 : 200);
}

async function toggleSourceService({ request, env, params }) {
  const body = await requestJson(request);
  if (!exactKeys(body, ['enabled']) || typeof body.enabled !== 'boolean') {
    throw new AdminApiError('invalid_request', 400);
  }
  const db = env.ITNEW_DB;
  const source = await db.prepare(`
    /* itnew:admin_source_current */
    SELECT id, enabled FROM itnew_sources WHERE id = ? LIMIT 1
  `).bind(params.id).first();
  if (!source) throw new AdminApiError('not_found', 404);
  const result = await db.prepare(`
    /* itnew:admin_source_toggle */
    UPDATE itnew_sources SET enabled = ? WHERE id = ?
  `).bind(Number(body.enabled), params.id).run();
  if (changesFrom(result) !== 1) throw new AdminApiError('not_found', 404);
  return jsonResponse({ id: params.id, enabled: body.enabled });
}

function pagination(request) {
  const search = new URL(request.url).searchParams;
  const limitValue = search.get('limit') ?? '20';
  const offsetValue = search.get('offset') ?? '0';
  if (!/^\d+$/u.test(limitValue) || !/^\d+$/u.test(offsetValue)) {
    throw new AdminApiError('invalid_request', 400);
  }
  const limit = Number(limitValue);
  const offset = Number(offsetValue);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50
    || !Number.isSafeInteger(offset) || offset < 0) {
    throw new AdminApiError('invalid_request', 400);
  }
  return { limit, offset };
}

async function reviewCurrentService({ request, env }) {
  const { limit, offset } = pagination(request);
  const db = env.ITNEW_DB;
  const batch = await db.prepare(`
    /* itnew:admin_current_batch */
    SELECT * FROM itnew_batches
    WHERE status = 'open'
    ORDER BY collected_at ASC, id ASC
    LIMIT 1
  `).first();
  if (!batch) {
    return jsonResponse({ batch: null, candidates: [], total: 0, limit, offset });
  }
  const [candidatesResult, totalRow] = await Promise.all([
    db.prepare(`
      /* itnew:admin_review_candidates */
      SELECT * FROM itnew_candidates
      WHERE batch_id = ?
      ORDER BY score DESC, id ASC
      LIMIT ? OFFSET ?
    `).bind(batch.id, limit, offset).all(),
    db.prepare(`
      /* itnew:admin_review_total */
      SELECT COUNT(*) AS total FROM itnew_candidates WHERE batch_id = ?
    `).bind(batch.id).first(),
  ]);
  return jsonResponse({
    batch,
    candidates: candidatesResult.results,
    total: Number(totalRow?.total ?? 0),
    limit,
    offset,
  });
}

async function listArticlesService({ request, env }) {
  const { limit, offset } = pagination(request);
  const db = env.ITNEW_DB;
  const [result, total] = await Promise.all([
    db.prepare(`
      /* itnew:admin_article_list */
      SELECT * FROM itnew_articles
      ORDER BY published_at DESC, id ASC
      LIMIT ? OFFSET ?
    `).bind(limit, offset).all(),
    db.prepare(`
      /* itnew:admin_article_total */
      SELECT COUNT(*) AS total FROM itnew_articles
    `).first(),
  ]);
  return jsonResponse({ items: result.results, total: Number(total?.total ?? 0), limit, offset });
}

async function listSourcesService({ request, env }) {
  const { limit, offset } = pagination(request);
  const db = env.ITNEW_DB;
  const [result, total] = await Promise.all([
    db.prepare(`
      /* itnew:admin_source_list */
      SELECT * FROM itnew_sources
      ORDER BY priority_weight DESC, id ASC
      LIMIT ? OFFSET ?
    `).bind(limit, offset).all(),
    db.prepare(`
      /* itnew:admin_source_total */
      SELECT COUNT(*) AS total FROM itnew_sources
    `).first(),
  ]);
  return jsonResponse({ items: result.results, total: Number(total?.total ?? 0), limit, offset });
}

async function listBatchesService({ request, env }) {
  const { limit, offset } = pagination(request);
  const db = env.ITNEW_DB;
  const [result, total] = await Promise.all([
    db.prepare(`
      /* itnew:admin_batch_list */
      SELECT
        b.*,
        COALESCE(SUM(CASE WHEN c.status = 'pending' THEN 1 ELSE 0 END), 0) AS pending_count,
        COALESCE(SUM(CASE WHEN c.status = 'approved' THEN 1 ELSE 0 END), 0) AS approved_count,
        COALESCE(SUM(CASE WHEN c.status = 'rejected' THEN 1 ELSE 0 END), 0) AS rejected_count,
        COALESCE(SUM(CASE WHEN c.status = 'processing_error' THEN 1 ELSE 0 END), 0) AS error_count
      FROM itnew_batches b
      LEFT JOIN itnew_candidates c ON c.batch_id = b.id
      GROUP BY b.id
      ORDER BY b.collected_at DESC, b.id ASC
      LIMIT ? OFFSET ?
    `).bind(limit, offset).all(),
    db.prepare(`
      /* itnew:admin_batch_total */
      SELECT COUNT(*) AS total FROM itnew_batches
    `).first(),
  ]);
  return jsonResponse({ items: result.results, total: Number(total?.total ?? 0), limit, offset });
}

async function unpublishArticleService({ env, context, session, params }) {
  const unpublishImpl = context.unpublishImpl || publishUnpublishArticle;
  const result = await unpublishImpl(env, params.id, {
    now: requestNow(context),
    uuid: context.uuid,
    adminId: session.sub,
  });
  if (result?.status === 'not_found') throw new AdminApiError('not_found', 404);
  return jsonResponse(result);
}

function requestNow(context) {
  return typeof context.now === 'function' ? context.now() : (context.now ?? Date.now());
}

async function loginService({ request, env, context }) {
  const response = await handleLogin(request, env, requestNow(context));
  if (response.status === 503) {
    try {
      const body = await response.clone().json();
      if (body?.error === 'admin_not_configured') {
        return jsonResponse({ error: 'system_not_configured' }, 503);
      }
    } catch { /* Preserve the authentication response if it is not JSON. */ }
  }
  return response;
}

function makeId(context) {
  return (context.uuid || (() => crypto.randomUUID()))();
}

function changesFrom(result) {
  return Number(result?.meta?.changes ?? result?.changes ?? 0);
}

function rejectClaimStatement(db, candidateIds, batchId, marker) {
  const placeholders = candidateIds.map((_, index) => `?${index + 4}`).join(', ');
  return db.prepare(`
    /* itnew:admin_reject_claim */
    UPDATE itnew_candidates
    SET processing_error = ?1
    WHERE batch_id = ?2
      AND status = 'pending'
      AND article_id IS NULL
      AND id IN (${placeholders})
      AND ?3 = (
        SELECT COUNT(*) FROM itnew_candidates
        WHERE batch_id = ?2
          AND status = 'pending'
          AND article_id IS NULL
          AND id IN (${placeholders})
      )
  `).bind(marker, batchId, candidateIds.length, ...candidateIds);
}

function candidateRejectStatement(db, candidateId, batchId, marker, now) {
  return db.prepare(`
    /* itnew:admin_candidate_reject */
    UPDATE itnew_candidates
    SET status = 'rejected', processing_error = NULL, reviewed_at = ?
    WHERE id = ? AND batch_id = ? AND status = 'pending' AND article_id IS NULL
      AND processing_error = ?
  `).bind(now, candidateId, batchId, marker);
}

function auditStatement(db, audit) {
  return db.prepare(`
    /* itnew:admin_audit_insert */
    INSERT INTO itnew_audit_log (
      id, admin_id, action, target_type, target_id, batch_id,
      result, details_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    audit.id, audit.adminId, audit.action, audit.targetType, audit.targetId,
    audit.batchId, audit.result, JSON.stringify(audit.details), audit.createdAt,
  );
}

function conditionalCandidateAuditStatement(db, audit) {
  return db.prepare(`
    /* itnew:admin_candidate_audit_insert */
    INSERT INTO itnew_audit_log (
      id, admin_id, action, target_type, target_id, batch_id,
      result, details_json, created_at
    )
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
    WHERE changes() = 1
  `).bind(
    audit.id, audit.adminId, audit.action, audit.targetType, audit.targetId,
    audit.batchId, audit.result, JSON.stringify(audit.details), audit.createdAt,
  );
}

function conditionalSummaryAuditStatement(db, audit, candidateAuditIds) {
  const placeholders = candidateAuditIds.map((_, index) => `?${index + 11}`).join(', ');
  return db.prepare(`
    /* itnew:admin_summary_audit_insert */
    INSERT INTO itnew_audit_log (
      id, admin_id, action, target_type, target_id, batch_id,
      result, details_json, created_at
    )
    SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9
    WHERE ?10 = (
      SELECT COUNT(*) FROM itnew_audit_log WHERE id IN (${placeholders})
    )
  `).bind(
    audit.id, audit.adminId, audit.action, audit.targetType, audit.targetId,
    audit.batchId, audit.result, JSON.stringify(audit.details), audit.createdAt,
    candidateAuditIds.length, ...candidateAuditIds,
  );
}

function closeBatchStatement(db, batchId, now) {
  return db.prepare(`
    /* itnew:admin_batch_close */
    UPDATE itnew_batches
    SET status = 'closed', closed_at = ?1
    WHERE id = ?2 AND status = 'open'
      AND NOT EXISTS (
        SELECT 1 FROM itnew_candidates
        WHERE batch_id = ?2 AND status IN ('pending', 'processing_error')
      )
  `).bind(now, batchId);
}

function conditionalCloseBatchStatement(db, batchId, now, summaryAuditId) {
  return db.prepare(`
    /* itnew:admin_conditional_batch_close */
    UPDATE itnew_batches
    SET status = 'closed', closed_at = ?1
    WHERE id = ?2 AND status = 'open'
      AND EXISTS (
        SELECT 1 FROM itnew_audit_log
        WHERE id = ?3 AND action = 'bulk_review' AND target_id = ?2
      )
      AND NOT EXISTS (
        SELECT 1 FROM itnew_candidates
        WHERE batch_id = ?2 AND status IN ('pending', 'processing_error')
      )
  `).bind(now, batchId, summaryAuditId);
}

async function reviewCounts(db, batchId) {
  const row = await db.prepare(`
    /* itnew:admin_review_counts */
    SELECT
      SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
      SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END) AS approved,
      SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) AS rejected,
      SUM(CASE WHEN status = 'processing_error' THEN 1 ELSE 0 END) AS processing_error
    FROM itnew_candidates
    WHERE batch_id = ?
  `).bind(batchId).first();
  return {
    pending: Number(row?.pending ?? 0),
    approved: Number(row?.approved ?? 0),
    rejected: Number(row?.rejected ?? 0),
    processing_error: Number(row?.processing_error ?? 0),
  };
}

const defaultAuth = {
  requireAdmin,
  validateAdminMutation,
};

const defaultServices = {
  login: loginService,
  logout: ({ request, env, context }) => handleLogout(request, env, requestNow(context)),
  session: ({ session }) => jsonResponse({
    authenticated: true,
    adminId: session.sub,
    csrf: session.csrf,
  }),
  reviewBulk: reviewBulkService,
  retryCandidate: retryCandidateService,
  collect: collectService,
  toggleSource: toggleSourceService,
  reviewCurrent: reviewCurrentService,
  listArticles: listArticlesService,
  listSources: listSourcesService,
  listBatches: listBatchesService,
  unpublishArticle: unpublishArticleService,
};

const ROUTES = [
  { method: 'POST', pattern: ['login'], service: 'login', auth: 'none' },
  { method: 'POST', pattern: ['logout'], service: 'logout', auth: 'mutation' },
  { method: 'GET', pattern: ['session'], service: 'session', auth: 'admin' },
  { method: 'GET', pattern: ['review', 'current'], service: 'reviewCurrent', auth: 'admin' },
  { method: 'POST', pattern: ['review', 'bulk'], service: 'reviewBulk', auth: 'mutation' },
  { method: 'POST', pattern: ['review', ':id', 'retry'], service: 'retryCandidate', auth: 'mutation' },
  { method: 'POST', pattern: ['collect'], service: 'collect', auth: 'mutation' },
  { method: 'GET', pattern: ['articles'], service: 'listArticles', auth: 'admin' },
  { method: 'POST', pattern: ['articles', ':id', 'unpublish'], service: 'unpublishArticle', auth: 'mutation' },
  { method: 'GET', pattern: ['sources'], service: 'listSources', auth: 'admin' },
  { method: 'POST', pattern: ['sources', ':id', 'toggle'], service: 'toggleSource', auth: 'mutation' },
  { method: 'GET', pattern: ['batches'], service: 'listBatches', auth: 'admin' },
];

function matchPattern(pattern, segments) {
  if (pattern.length !== segments.length) return null;
  const params = {};
  for (let index = 0; index < pattern.length; index += 1) {
    const expected = pattern[index];
    const actual = segments[index];
    if (expected.startsWith(':')) {
      if (!actual) return null;
      params[expected.slice(1)] = decodeURIComponent(actual);
    } else if (expected !== actual) {
      return null;
    }
  }
  return params;
}

function routeFor(request) {
  const url = new URL(request.url);
  const prefix = '/itnew/admin/api/';
  if (!url.pathname.startsWith(prefix)) return { status: 404 };
  const tail = url.pathname.slice(prefix.length);
  if (!tail || tail.endsWith('/')) return { status: 404 };
  const segments = tail.split('/');
  const pathMatches = [];
  for (const route of ROUTES) {
    const params = matchPattern(route.pattern, segments);
    if (params) pathMatches.push({ route, params });
  }
  if (pathMatches.length === 0) return { status: 404 };
  const methodMatch = pathMatches.find(({ route }) => route.method === request.method);
  return methodMatch ?? { status: 405 };
}

function publicError(error) {
  if (error instanceof AdminApiError) return jsonResponse({ error: error.code }, error.status);
  if (error instanceof AuthError) {
    const code = error.code === 'admin_not_configured' ? 'system_not_configured' : error.code;
    return jsonResponse({ error: code }, error.status);
  }
  return jsonResponse({ error: 'internal_error' }, 500);
}

export async function handleItnewAdminRequest(request, env, context = {}) {
  let matched;
  try {
    matched = routeFor(request);
  } catch {
    return jsonResponse({ error: 'not_found' }, 404);
  }
  if (matched.status === 404) return jsonResponse({ error: 'not_found' }, 404);
  if (matched.status === 405) return jsonResponse({ error: 'method_not_allowed' }, 405);

  const auth = { ...defaultAuth, ...context.auth };
  const services = { ...defaultServices, ...context.services };
  const service = services[matched.route.service];
  if (typeof service !== 'function') return jsonResponse({ error: 'internal_error' }, 500);

  try {
    let session = null;
    const now = requestNow(context);
    if (matched.route.auth === 'admin') {
      session = await auth.requireAdmin(request, env, now);
    } else if (matched.route.auth === 'mutation') {
      session = await auth.validateAdminMutation(request, env, now);
    }
    return await service({
      request,
      env,
      context,
      session,
      params: matched.params,
    });
  } catch (error) {
    return publicError(error);
  }
}
