import test from 'node:test';
import assert from 'node:assert/strict';

import { AuthError } from '../src/itnew/auth.js';
import { handleItnewAdminRequest } from '../src/itnew/admin.js';

const ORIGIN = 'https://itnew.test';

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function request(method, path, body = undefined) {
  return new Request(`${ORIGIN}${path}`, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function harness() {
  const calls = [];
  const responseFor = (name) => async ({ params = {} } = {}) => {
    calls.push({ type: 'handler', name, params });
    return jsonResponse({ route: name, params });
  };
  return {
    calls,
    context: {
      auth: {
        async requireAdmin() {
          calls.push({ type: 'auth', name: 'requireAdmin' });
          return { sub: 'admin', csrf: 'csrf-token' };
        },
        async validateAdminMutation() {
          calls.push({ type: 'auth', name: 'validateAdminMutation' });
          return { sub: 'admin', csrf: 'csrf-token' };
        },
      },
      services: {
        login: responseFor('login'),
        logout: responseFor('logout'),
        session: responseFor('session'),
        reviewCurrent: responseFor('reviewCurrent'),
        reviewBulk: responseFor('reviewBulk'),
        retryCandidate: responseFor('retryCandidate'),
        collect: responseFor('collect'),
        listArticles: responseFor('listArticles'),
        unpublishArticle: responseFor('unpublishArticle'),
        listSources: responseFor('listSources'),
        toggleSource: responseFor('toggleSource'),
        listBatches: responseFor('listBatches'),
      },
    },
  };
}

const ROUTES = [
  ['POST', '/itnew/admin/api/login', 'login', {}],
  ['POST', '/itnew/admin/api/logout', 'logout', {}],
  ['GET', '/itnew/admin/api/session', 'session', {}],
  ['GET', '/itnew/admin/api/review/current', 'reviewCurrent', {}],
  ['POST', '/itnew/admin/api/review/bulk', 'reviewBulk', {}],
  ['POST', '/itnew/admin/api/review/candidate-7/retry', 'retryCandidate', { id: 'candidate-7' }],
  ['POST', '/itnew/admin/api/collect', 'collect', {}],
  ['GET', '/itnew/admin/api/articles', 'listArticles', {}],
  ['POST', '/itnew/admin/api/articles/article-9/unpublish', 'unpublishArticle', { id: 'article-9' }],
  ['GET', '/itnew/admin/api/sources', 'listSources', {}],
  ['POST', '/itnew/admin/api/sources/source-3/toggle', 'toggleSource', { id: 'source-3' }],
  ['GET', '/itnew/admin/api/batches', 'listBatches', {}],
];

test('dispatches exactly the twelve admin route and method contracts', async () => {
  for (const [method, path, expectedRoute, expectedParams] of ROUTES) {
    const { context } = harness();
    const response = await handleItnewAdminRequest(request(method, path), {}, context);
    assert.equal(response.status, 200, `${method} ${path}`);
    assert.deepEqual(await response.json(), { route: expectedRoute, params: expectedParams });
  }
});

test('returns 404 for an unknown path and 405 for a known path with the wrong method', async () => {
  const { context } = harness();
  const missing = await handleItnewAdminRequest(request('GET', '/itnew/admin/api/missing'), {}, context);
  assert.equal(missing.status, 404);
  assert.deepEqual(await missing.json(), { error: 'not_found' });

  for (const [method, path] of ROUTES) {
    const wrongMethod = method === 'GET' ? 'POST' : 'GET';
    const response = await handleItnewAdminRequest(request(wrongMethod, path), {}, context);
    assert.equal(response.status, 405, `${wrongMethod} ${path}`);
    assert.deepEqual(await response.json(), { error: 'method_not_allowed' });
  }
});

test('login, logout, and session preserve their authentication call boundaries', async () => {
  const cases = [
    ['POST', '/itnew/admin/api/login', ['login']],
    ['POST', '/itnew/admin/api/logout', ['validateAdminMutation', 'logout']],
    ['GET', '/itnew/admin/api/session', ['requireAdmin', 'session']],
  ];

  for (const [method, path, expected] of cases) {
    const { calls, context } = harness();
    await handleItnewAdminRequest(request(method, path), {}, context);
    assert.deepEqual(calls.map(({ name }) => name), expected, `${method} ${path}`);
  }
});

test('every non-login mutation runs the auth guard before a handler can parse the body', async () => {
  const mutations = ROUTES.filter(([method, path]) => method === 'POST' && !path.endsWith('/login'));

  for (const [method, path, serviceName] of mutations) {
    let parsed = false;
    let handled = false;
    const mutationRequest = request(method, path, { value: true });
    mutationRequest.json = async () => {
      parsed = true;
      return { value: true };
    };
    const { context } = harness();
    context.auth.validateAdminMutation = async () => {
      throw new AuthError('invalid_origin', 403);
    };
    context.services[serviceName] = async ({ request: guardedRequest }) => {
      handled = true;
      await guardedRequest.json();
      return jsonResponse({ ok: true });
    };

    const response = await handleItnewAdminRequest(mutationRequest, {}, context);
    assert.equal(response.status, 403, `${method} ${path}`);
    assert.deepEqual(await response.json(), { error: 'invalid_origin' });
    assert.equal(handled, false, `${serviceName} handler ran before authorization`);
    assert.equal(parsed, false, `${serviceName} parsed before authorization`);
  }
});

function operationFrom(sql) {
  return /\/\*\s*itnew:([a-z_]+)\s*\*\//u.exec(sql)?.[1];
}

function changes(count = 1) {
  return { success: true, meta: { changes: count } };
}

class FakeStatement {
  constructor(db, sql, bindings = []) {
    this.db = db;
    this.sql = sql;
    this.operation = operationFrom(sql);
    this.bindings = bindings;
  }

  bind(...bindings) {
    return new FakeStatement(this.db, this.sql, bindings).withOperation(this.operation);
  }
  withOperation(operation) { this.operation = operation; return this; }
  async first() { return this.db.execute(this, this.db.state); }
  async all() { return { success: true, results: this.db.execute(this, this.db.state) }; }
  async run() { return this.db.execute(this, this.db.state); }
}

class FakeAdminDb {
  constructor({ batches = [], candidates = [], sources = [], articles = [] } = {}) {
    this.state = structuredClone({ batches, candidates, sources, articles, audits: [] });
    this.batchCalls = [];
    this.preparedSql = [];
    this.executions = [];
  }

  prepare(sql) {
    this.preparedSql.push(sql);
    return new FakeStatement(this, sql);
  }

  async batch(statements) {
    if (this.beforeBatch) {
      this.beforeBatch(this.state);
      this.beforeBatch = null;
    }
    this.batchCalls.push(statements.map(({ operation }) => operation));
    const transaction = structuredClone(this.state);
    const results = statements.map((statement) => this.execute(statement, transaction));
    this.state = transaction;
    return results;
  }

  execute({ operation, bindings, sql = '' }, state) {
    this.executions.push({ operation, sql, bindings: [...bindings] });
    switch (operation) {
      case 'admin_current_batch':
      case 'blocking_open':
        return structuredClone(state.batches.find(({ status }) => status === 'open') ?? null);
      case 'blocking_candidates': {
        const unresolved = new Set(state.candidates
          .filter(({ status }) => ['pending', 'processing_error'].includes(status))
          .map(({ batch_id }) => batch_id));
        return structuredClone(state.batches.find(({ id }) => unresolved.has(id)) ?? null);
      }
      case 'admin_review_candidates': {
        const [batchId, limit, offset] = bindings;
        return structuredClone(state.candidates.filter(({ batch_id }) => batch_id === batchId)
          .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(offset, offset + limit));
      }
      case 'admin_review_total':
        return { total: state.candidates.filter(({ batch_id }) => batch_id === bindings[0]).length };
      case 'admin_candidates_by_ids': {
        const wanted = new Set(bindings);
        return structuredClone(state.candidates.filter(({ id }) => wanted.has(id))
          .sort((a, b) => a.id.localeCompare(b.id)));
      }
      case 'admin_candidate_retry':
        return structuredClone(state.candidates.find(({ id }) => id === bindings[0]) ?? null);
      case 'admin_reject_claim': {
        const [marker, batchId, count, ...ids] = bindings;
        const wanted = new Set(ids);
        const rows = state.candidates.filter((entry) => wanted.has(entry.id)
          && entry.batch_id === batchId && entry.status === 'pending' && entry.article_id == null);
        if (rows.length === count && wanted.size === count) {
          for (const row of rows) row.processing_error = marker;
        }
        return changes(rows.length === count && wanted.size === count ? count : 0);
      }
      case 'admin_candidate_reject': {
        const [reviewedAt, id, batchId, marker] = bindings;
        const row = state.candidates.find((entry) => entry.id === id
          && entry.batch_id === batchId && entry.status === 'pending' && entry.article_id == null
          && entry.processing_error === marker);
        if (row) Object.assign(row, { status: 'rejected', reviewed_at: reviewedAt,
          processing_error: null });
        state.lastChanges = row ? 1 : 0;
        return changes(row ? 1 : 0);
      }
      case 'admin_review_counts': {
        const result = { pending: 0, approved: 0, rejected: 0, processing_error: 0 };
        for (const row of state.candidates.filter(({ batch_id }) => batch_id === bindings[0])) {
          result[row.status] += 1;
        }
        return result;
      }
      case 'admin_batch_close': {
        const [closedAt, batchId] = bindings;
        const row = state.batches.find(({ id, status }) => id === batchId && status === 'open');
        const unresolved = state.candidates.some(({ batch_id, status }) => batch_id === batchId
          && ['pending', 'processing_error'].includes(status));
        if (row && !unresolved) Object.assign(row, { status: 'closed', closed_at: closedAt });
        return changes(row && !unresolved ? 1 : 0);
      }
      case 'admin_conditional_batch_close': {
        const [closedAt, batchId, summaryAuditId] = bindings;
        const row = state.batches.find(({ id, status }) => id === batchId && status === 'open');
        const hasSummary = state.audits.some(({ id, action, target_id }) => id === summaryAuditId
          && action === 'bulk_review' && target_id === batchId);
        const unresolved = state.candidates.some(({ batch_id, status }) => batch_id === batchId
          && ['pending', 'processing_error'].includes(status));
        if (row && hasSummary && !unresolved) {
          Object.assign(row, { status: 'closed', closed_at: closedAt });
        }
        return changes(row && hasSummary && !unresolved ? 1 : 0);
      }
      case 'admin_audit_insert':
      case 'publisher_audit_insert':
      case 'publisher_processing_error_audit':
      case 'publisher_unpublish_audit':
      case 'admin_candidate_audit_insert':
      case 'admin_summary_audit_insert': {
        if ((operation === 'publisher_processing_error_audit'
          || operation === 'publisher_unpublish_audit'
          || operation === 'admin_candidate_audit_insert') && state.lastChanges !== 1) return changes(0);
        if (operation === 'admin_summary_audit_insert') {
          const count = bindings[9];
          const ids = new Set(bindings.slice(10));
          const found = state.audits.filter(({ id }) => ids.has(id)).length;
          if (found !== count || ids.size !== count) return changes(0);
        }
        const [id, admin_id, action, target_type, target_id, batch_id, result,
          details_json, created_at] = bindings;
        state.audits.push({ id, admin_id, action, target_type, target_id, batch_id,
          result, details_json, created_at });
        return changes();
      }
      case 'publisher_source_current':
        return structuredClone(state.sources.find(({ id }) => id === bindings[0]) ?? null);
      case 'publisher_article_insert': {
        const [id, candidate_id, slug, source_id, canonical_url, title, summary, language,
          category, rights_mode, article_permission_verified, license_name, license_url,
          attribution_text, hero_image_kind, hero_image_key, source_published_at,
          published_at, status] = bindings;
        const candidateRow = state.candidates.find((row) => row.id === candidate_id
          && ['pending', 'processing_error'].includes(row.status) && row.article_id == null);
        if (!candidateRow) throw new Error('D1_ERROR: itnew_candidate_not_publishable');
        state.articles.push({ id, candidate_id, slug, source_id, canonical_url, title, summary,
          language, category, rights_mode, article_permission_verified, license_name, license_url,
          attribution_text, hero_image_kind, hero_image_key, source_published_at,
          published_at, status });
        return changes();
      }
      case 'publisher_candidate_approve': {
        const [articleId, reviewedAt, id] = bindings;
        const row = state.candidates.find((entry) => entry.id === id
          && ['pending', 'processing_error'].includes(entry.status) && entry.article_id == null);
        if (row) Object.assign(row, { status: 'approved', article_id: articleId,
          reviewed_at: reviewedAt, processing_error: null });
        return changes(row ? 1 : 0);
      }
      case 'publisher_candidate_error': {
        const [error, reviewedAt, id] = bindings;
        const row = state.candidates.find((entry) => entry.id === id
          && ['pending', 'processing_error'].includes(entry.status) && entry.article_id == null);
        if (row) Object.assign(row, { status: 'processing_error', processing_error: error,
          reviewed_at: reviewedAt });
        state.lastChanges = row ? 1 : 0;
        return changes(row ? 1 : 0);
      }
      case 'publisher_article_status': {
        const row = state.articles.find(({ id }) => id === bindings[0]);
        return row ? { id: row.id, status: row.status } : null;
      }
      case 'publisher_article_unpublish': {
        const row = state.articles.find((entry) => entry.id === bindings[0]
          && entry.status === 'published');
        if (row) row.status = 'unpublished';
        state.lastChanges = row ? 1 : 0;
        return changes(row ? 1 : 0);
      }
      case 'admin_source_current':
        return structuredClone(state.sources.find(({ id }) => id === bindings[0]) ?? null);
      case 'admin_source_toggle': {
        const [enabled, id] = bindings;
        const row = state.sources.find((entry) => entry.id === id);
        if (row) row.enabled = enabled;
        return changes(row ? 1 : 0);
      }
      case 'admin_article_list': {
        const filterBindings = bindings.slice(0, -2);
        let bindingIndex = 0;
        let rows = [...state.articles];
        if (/instr\s*\(\s*lower\s*\(\s*a\.title/iu.test(sql)) {
          const query = String(filterBindings[bindingIndex]).toLowerCase();
          bindingIndex += 2;
          rows = rows.filter((row) => `${row.title || ''} ${row.source_id || ''}`
            .toLowerCase().includes(query));
        }
        if (/a\.status\s*=\s*\?/iu.test(sql)) {
          const status = filterBindings[bindingIndex];
          rows = rows.filter((row) => row.status === status);
        }
        return structuredClone(rows
          .sort((a, b) => b.published_at - a.published_at || a.id.localeCompare(b.id))
          .slice(bindings.at(-1), bindings.at(-1) + bindings.at(-2)));
      }
      case 'admin_article_total': {
        let bindingIndex = 0;
        let rows = [...state.articles];
        if (/instr\s*\(\s*lower\s*\(\s*a\.title/iu.test(sql)) {
          const query = String(bindings[bindingIndex]).toLowerCase();
          bindingIndex += 2;
          rows = rows.filter((row) => `${row.title || ''} ${row.source_id || ''}`
            .toLowerCase().includes(query));
        }
        if (/a\.status\s*=\s*\?/iu.test(sql)) {
          rows = rows.filter((row) => row.status === bindings[bindingIndex]);
        }
        return { total: rows.length };
      }
      case 'admin_source_list':
        return structuredClone([...state.sources]
          .sort((a, b) => b.priority_weight - a.priority_weight || a.id.localeCompare(b.id))
          .slice(bindings[1], bindings[1] + bindings[0]));
      case 'admin_source_total': return { total: state.sources.length };
      case 'admin_batch_list':
        return structuredClone([...state.batches]
          .sort((a, b) => b.collected_at - a.collected_at || a.id.localeCompare(b.id))
          .slice(bindings[1], bindings[1] + bindings[0])
          .map((batch) => {
            const counts = { pending_count: 0, approved_count: 0, rejected_count: 0,
              error_count: 0 };
            for (const candidate of state.candidates.filter(({ batch_id }) => batch_id === batch.id)) {
              if (candidate.status === 'pending') counts.pending_count += 1;
              if (candidate.status === 'approved') counts.approved_count += 1;
              if (candidate.status === 'rejected') counts.rejected_count += 1;
              if (candidate.status === 'processing_error') counts.error_count += 1;
            }
            return { ...batch, ...counts };
          }));
      case 'admin_batch_total': return { total: state.batches.length };
      default: throw new Error(`unsupported fake operation: ${operation}`);
    }
  }
}

function sourceRow(overrides = {}) {
  return { id: 'source-1', rights_mode: 'summary_link', homepage_url: 'https://source.test/',
    feed_url: 'https://source.test/feed', priority_weight: 10, enabled: 1, ...overrides };
}

function batchRow(overrides = {}) {
  return { id: 'batch-1', status: 'open', collected_at: 10, closed_at: null, ...overrides };
}

function candidateRow(id, overrides = {}) {
  return { id, batch_id: 'batch-1', source_id: 'source-1',
    canonical_url: `https://source.test/${id}`, title: `Title ${id}`, summary: 'Summary',
    staged_body_key: null, remote_image_url: null, language: 'en', category: 'development',
    score: 80, rights_mode_snapshot: 'summary_link', license_snapshot_json: null,
    status: 'pending', processing_error: null, article_id: null, source_published_at: 1,
    reviewed_at: null, ...overrides };
}

function environment(seed = {}) {
  return {
    ITNEW_DB: new FakeAdminDb(seed),
    ITNEW_IMAGES: {
      async get() { return null; }, async head() { return null; },
      async put() {}, async delete() {},
    },
  };
}

function authenticatedContext(overrides = {}) {
  let sequence = 0;
  return {
    now: 1000,
    uuid: () => `uuid-${++sequence}`,
    auth: {
      requireAdmin: async () => ({ sub: 'admin', csrf: 'csrf-token' }),
      validateAdminMutation: async () => ({ sub: 'admin', csrf: 'csrf-token' }),
    },
    ...overrides,
  };
}

async function callAdmin(env, method, path, body, context = authenticatedContext()) {
  const response = await handleItnewAdminRequest(request(method, path, body), env, context);
  return { response, body: await response.json() };
}

test('bulk rejects malformed or incomplete candidate sets before any mutation', async () => {
  let publisherCalls = 0;
  const context = authenticatedContext({
    publisher: {
      async prepareCandidatePublication() { publisherCalls += 1; },
    },
  });
  const invalidBodies = [
    {},
    { batchId: 'batch-1', candidateIds: [], decision: 'approve' },
    { batchId: 'batch-1', candidateIds: ['one', 'one'], decision: 'reject' },
    { batchId: 'batch-1', candidateIds: Array.from({ length: 31 }, (_, index) => `c-${index}`), decision: 'approve' },
    { batchId: 'batch-1', candidateIds: ['one'], decision: 'maybe' },
    { batchId: 'batch-1', candidateIds: ['one'], decision: 'reject', extra: true },
  ];
  for (const body of invalidBodies) {
    const env = environment({ batches: [batchRow()], candidates: [candidateRow('one')] });
    const result = await callAdmin(env, 'POST', '/itnew/admin/api/review/bulk', body, context);
    assert.equal(result.response.status, 400);
    assert.deepEqual(result.body, { error: 'invalid_request' });
    assert.equal(env.ITNEW_DB.batchCalls.length, 0);
  }

  for (const candidates of [
    [candidateRow('one')],
    [candidateRow('one'), candidateRow('two', { batch_id: 'other' })],
    [candidateRow('one'), candidateRow('two', { status: 'rejected' })],
  ]) {
    const env = environment({ batches: [batchRow()], candidates });
    const result = await callAdmin(env, 'POST', '/itnew/admin/api/review/bulk', {
      batchId: 'batch-1', candidateIds: ['one', 'two'], decision: 'reject',
    }, context);
    assert.equal(result.response.status, 409);
    assert.deepEqual(result.body, { error: 'candidate_conflict' });
    assert.equal(env.ITNEW_DB.batchCalls.length, 0);
  }
  assert.equal(publisherCalls, 0);
});

test('bulk reject uses one transaction with stable audits, updated counts, and batch closure', async () => {
  const env = environment({
    batches: [batchRow()],
    candidates: [candidateRow('two'), candidateRow('one')],
  });
  const result = await callAdmin(env, 'POST', '/itnew/admin/api/review/bulk', {
    batchId: 'batch-1', candidateIds: ['two', 'one'], decision: 'reject',
  });

  assert.equal(result.response.status, 200);
  assert.deepEqual(result.body, {
    batchId: 'batch-1',
    decision: 'reject',
    candidateIds: ['one', 'two'],
    counts: { pending: 0, approved: 0, rejected: 2, processing_error: 0 },
    closed: true,
  });
  assert.equal(env.ITNEW_DB.batchCalls.length, 1);
  assert.deepEqual(env.ITNEW_DB.state.candidates.map(({ status }) => status),
    ['rejected', 'rejected']);
  assert.deepEqual(env.ITNEW_DB.state.audits.map(({ action, target_id }) => ({ action, target_id })), [
    { action: 'reject', target_id: 'one' },
    { action: 'reject', target_id: 'two' },
    { action: 'bulk_review', target_id: 'batch-1' },
  ]);
  assert.equal(env.ITNEW_DB.state.batches[0].status, 'closed');
});

test('bulk reject remains all-or-none when a candidate changes after complete-set validation', async () => {
  const env = environment({
    batches: [batchRow()],
    candidates: [candidateRow('one'), candidateRow('two')],
  });
  env.ITNEW_DB.beforeBatch = (state) => {
    state.candidates.find(({ id }) => id === 'two').status = 'rejected';
  };
  const result = await callAdmin(env, 'POST', '/itnew/admin/api/review/bulk', {
    batchId: 'batch-1', candidateIds: ['one', 'two'], decision: 'reject',
  });
  assert.equal(result.response.status, 409);
  assert.deepEqual(result.body, { error: 'candidate_conflict' });
  assert.deepEqual(env.ITNEW_DB.state.candidates.map(({ status }) => status),
    ['pending', 'rejected']);
  assert.equal(env.ITNEW_DB.state.audits.length, 0);
});

test('failed last-candidate reject claim cannot close the batch after a concurrent approval', async () => {
  const env = environment({
    batches: [batchRow()],
    candidates: [candidateRow('only')],
  });
  env.ITNEW_DB.beforeBatch = (state) => {
    Object.assign(state.candidates[0], {
      status: 'approved',
      article_id: 'concurrent-article',
      reviewed_at: 999,
    });
  };

  const result = await callAdmin(env, 'POST', '/itnew/admin/api/review/bulk', {
    batchId: 'batch-1', candidateIds: ['only'], decision: 'reject',
  });

  assert.equal(result.response.status, 409);
  assert.deepEqual(result.body, { error: 'candidate_conflict' });
  assert.equal(env.ITNEW_DB.state.batches[0].status, 'open');
  assert.equal(env.ITNEW_DB.state.batches[0].closed_at, null);
  assert.deepEqual(env.ITNEW_DB.state.candidates[0], candidateRow('only', {
    status: 'approved',
    article_id: 'concurrent-article',
    reviewed_at: 999,
  }));
  assert.equal(env.ITNEW_DB.state.audits.length, 0);
});

test('bulk approve commits all prepared publications once and isolates one preparation failure', async () => {
  const goodEnv = environment({
    batches: [batchRow()],
    candidates: [candidateRow('one'), candidateRow('two')],
    sources: [sourceRow()],
  });
  const good = await callAdmin(goodEnv, 'POST', '/itnew/admin/api/review/bulk', {
    batchId: 'batch-1', candidateIds: ['one', 'two'], decision: 'approve',
  });
  assert.equal(good.response.status, 200);
  assert.equal(goodEnv.ITNEW_DB.batchCalls.length, 1);
  assert.equal(goodEnv.ITNEW_DB.state.articles.length, 2);
  assert.equal(goodEnv.ITNEW_DB.state.audits.length, 3);
  assert.deepEqual(good.body, {
    batchId: 'batch-1',
    decision: 'approve',
    candidateIds: ['one', 'two'],
    counts: { pending: 0, approved: 2, rejected: 0, processing_error: 0 },
    closed: true,
  });

  const badEnv = environment({
    batches: [batchRow()],
    candidates: [candidateRow('bad', {
      rights_mode_snapshot: 'licensed_full', staged_body_key: 'missing',
      license_snapshot_json: JSON.stringify({ articleAllowed: true, name: 'CC',
        url: 'https://license.test', attributionTemplate: 'By Source' }),
    }), candidateRow('good')],
    sources: [sourceRow({ rights_mode: 'licensed_full' })],
  });
  const bad = await callAdmin(badEnv, 'POST', '/itnew/admin/api/review/bulk', {
    batchId: 'batch-1', candidateIds: ['bad', 'good'], decision: 'approve',
  });
  assert.equal(bad.response.status, 409);
  assert.deepEqual(bad.body, { error: 'candidate_conflict' });
  assert.equal(badEnv.ITNEW_DB.state.articles.length, 0);
  assert.deepEqual(badEnv.ITNEW_DB.state.candidates.map(({ status }) => status),
    ['processing_error', 'pending']);
  assert.equal(badEnv.ITNEW_DB.state.audits.length, 1);
});

test('retry accepts only processing_error and publishes through one safe transaction', async () => {
  for (const status of ['pending', 'rejected', 'approved']) {
    const env = environment({ candidates: [candidateRow('candidate-1', { status })] });
    const result = await callAdmin(env, 'POST', '/itnew/admin/api/review/candidate-1/retry');
    assert.equal(result.response.status, 409);
    assert.deepEqual(result.body, { error: 'candidate_conflict' });
    assert.equal(env.ITNEW_DB.batchCalls.length, 0);
  }

  const env = environment({
    batches: [batchRow()],
    candidates: [candidateRow('candidate-1', {
      status: 'processing_error', processing_error: 'body_processing_failed',
    })],
    sources: [sourceRow()],
  });
  const result = await callAdmin(env, 'POST', '/itnew/admin/api/review/candidate-1/retry');
  assert.equal(result.response.status, 200);
  assert.equal(result.body.status, 'published');
  assert.deepEqual(result.body.counts,
    { pending: 0, approved: 1, rejected: 0, processing_error: 0 });
  assert.equal(result.body.closed, true);
  assert.equal(env.ITNEW_DB.batchCalls.length, 1);
  assert.equal(env.ITNEW_DB.state.articles.length, 1);
  assert.equal(env.ITNEW_DB.state.batches[0].status, 'closed');
});

test('manual collect remains blocked until no open or unresolved batch exists', async () => {
  const env = environment({
    batches: [batchRow()],
    candidates: [candidateRow('candidate-1')],
  });
  let calls = 0;
  const context = authenticatedContext({
    collectImpl: async () => {
      calls += 1;
      return { status: 'created', batchId: 'batch-new', candidateCount: 30 };
    },
  });
  const blocked = await callAdmin(env, 'POST', '/itnew/admin/api/collect', undefined, context);
  assert.equal(blocked.response.status, 409);
  assert.deepEqual(blocked.body, { error: 'batch_in_progress' });
  assert.equal(calls, 0);

  env.ITNEW_DB.state.batches[0].status = 'closed';
  env.ITNEW_DB.state.candidates[0].status = 'rejected';
  const collected = await callAdmin(env, 'POST', '/itnew/admin/api/collect', undefined, context);
  assert.equal(collected.response.status, 201);
  assert.deepEqual(collected.body,
    { status: 'created', batchId: 'batch-new', candidateCount: 30 });
  assert.equal(calls, 1);
});

test('source toggle accepts only enabled and cannot mutate rights configuration', async () => {
  const env = environment({ sources: [sourceRow({ rights_mode: 'licensed_full' })] });
  const bad = await callAdmin(env, 'POST', '/itnew/admin/api/sources/source-1/toggle', {
    enabled: false,
    rightsMode: 'summary_link',
  });
  assert.equal(bad.response.status, 400);
  assert.deepEqual(bad.body, { error: 'invalid_request' });
  assert.equal(env.ITNEW_DB.state.sources[0].enabled, 1);
  assert.equal(env.ITNEW_DB.state.sources[0].rights_mode, 'licensed_full');

  const good = await callAdmin(env, 'POST', '/itnew/admin/api/sources/source-1/toggle', {
    enabled: false,
  });
  assert.equal(good.response.status, 200);
  assert.deepEqual(good.body, { id: 'source-1', enabled: false });
  assert.equal(env.ITNEW_DB.state.sources[0].enabled, 0);
  assert.equal(env.ITNEW_DB.state.sources[0].rights_mode, 'licensed_full');

  const missing = await callAdmin(env, 'POST', '/itnew/admin/api/sources/missing/toggle', {
    enabled: true,
  });
  assert.equal(missing.response.status, 404);
  assert.deepEqual(missing.body, { error: 'not_found' });
});

test('review, articles, sources, and batches enforce bounded pagination and stable sorting', async () => {
  const env = environment({
    batches: [
      batchRow({ id: 'batch-b', collected_at: 2 }),
      batchRow({ id: 'batch-a', collected_at: 2, status: 'closed' }),
    ],
    candidates: [
      candidateRow('candidate-b', { batch_id: 'batch-b', score: 5 }),
      candidateRow('candidate-a', { batch_id: 'batch-b', score: 5 }),
    ],
    sources: [
      sourceRow({ id: 'source-b', priority_weight: 5 }),
      sourceRow({ id: 'source-a', priority_weight: 5 }),
    ],
    articles: [
      { id: 'article-b', status: 'published', published_at: 5 },
      { id: 'article-a', status: 'published', published_at: 5 },
    ],
  });

  for (const path of [
    '/itnew/admin/api/review/current?limit=51',
    '/itnew/admin/api/articles?limit=51',
    '/itnew/admin/api/sources?limit=51',
    '/itnew/admin/api/batches?limit=51',
  ]) {
    const result = await callAdmin(env, 'GET', path);
    assert.equal(result.response.status, 400, path);
    assert.deepEqual(result.body, { error: 'invalid_request' });
  }

  const review = await callAdmin(env, 'GET', '/itnew/admin/api/review/current?limit=50');
  assert.equal(review.response.status, 200);
  assert.equal(review.body.batch.id, 'batch-b');
  assert.deepEqual(review.body.candidates.map(({ id }) => id), ['candidate-a', 'candidate-b']);
  assert.deepEqual({ total: review.body.total, limit: review.body.limit, offset: review.body.offset },
    { total: 2, limit: 50, offset: 0 });

  for (const [path, expected] of [
    ['/itnew/admin/api/articles?limit=50', ['article-a', 'article-b']],
    ['/itnew/admin/api/sources?limit=50', ['source-a', 'source-b']],
    ['/itnew/admin/api/batches?limit=50', ['batch-a', 'batch-b']],
  ]) {
    const result = await callAdmin(env, 'GET', path);
    assert.equal(result.response.status, 200);
    assert.deepEqual(result.body.items.map(({ id }) => id), expected);
    assert.deepEqual({ total: result.body.total, limit: result.body.limit, offset: result.body.offset },
      { total: 2, limit: 50, offset: 0 });
  }
});

test('batch history returns real per-status candidate counts from one grouped left join', async () => {
  const env = environment({
    batches: [
      batchRow({ id: 'batch-empty', collected_at: 20 }),
      batchRow({ id: 'batch-counted', collected_at: 10 }),
    ],
    candidates: [
      candidateRow('pending', { batch_id: 'batch-counted', status: 'pending' }),
      candidateRow('approved', { batch_id: 'batch-counted', status: 'approved' }),
      candidateRow('rejected', { batch_id: 'batch-counted', status: 'rejected' }),
      candidateRow('error', { batch_id: 'batch-counted', status: 'processing_error' }),
    ],
  });

  const result = await callAdmin(env, 'GET', '/itnew/admin/api/batches?limit=2&offset=0');
  assert.equal(result.response.status, 200);
  assert.deepEqual(result.body.items.map((batch) => ({
    id: batch.id,
    pending_count: batch.pending_count,
    approved_count: batch.approved_count,
    rejected_count: batch.rejected_count,
    error_count: batch.error_count,
  })), [
    { id: 'batch-empty', pending_count: 0, approved_count: 0, rejected_count: 0,
      error_count: 0 },
    { id: 'batch-counted', pending_count: 1, approved_count: 1, rejected_count: 1,
      error_count: 1 },
  ]);
  assert.deepEqual({ total: result.body.total, limit: result.body.limit, offset: result.body.offset },
    { total: 2, limit: 2, offset: 0 });

  const paged = await callAdmin(env, 'GET', '/itnew/admin/api/batches?limit=1&offset=1');
  assert.deepEqual(paged.body.items.map(({ id, pending_count, approved_count,
    rejected_count, error_count }) => ({ id, pending_count, approved_count,
    rejected_count, error_count })), [
    { id: 'batch-counted', pending_count: 1, approved_count: 1, rejected_count: 1,
      error_count: 1 },
  ]);
  assert.deepEqual({ total: paged.body.total, limit: paged.body.limit, offset: paged.body.offset },
    { total: 2, limit: 1, offset: 1 });

  const sql = env.ITNEW_DB.preparedSql.find((statement) => statement.includes('itnew:admin_batch_list'));
  assert.match(sql, /FROM\s+itnew_batches\s+(?:AS\s+)?b\s+LEFT\s+JOIN\s+itnew_candidates\s+(?:AS\s+)?c/iu);
  for (const status of ['pending', 'approved', 'rejected', 'processing_error']) {
    assert.match(sql, new RegExp(`SUM\\s*\\(\\s*CASE\\s+WHEN\\s+c\\.status\\s*=\\s*'${status}'`, 'iu'));
  }
  assert.match(sql, /GROUP\s+BY\s+b\.id/iu);
  assert.match(sql, /ORDER\s+BY\s+b\.collected_at\s+DESC\s*,\s*b\.id\s+ASC/iu);
});

test('article management filters title or source and status with shared bound SQL', async () => {
  const env = environment({ articles: [
    { id: 'one', title: 'Cloud launch', source_id: 'wire', status: 'unpublished', published_at: 30 },
    { id: 'two', title: 'Other title', source_id: 'cloud-weekly', status: 'unpublished', published_at: 20 },
    { id: 'three', title: 'Cloud live', source_id: 'wire', status: 'published', published_at: 10 },
  ] });
  const q = encodeURIComponent('CLOUD');
  const result = await callAdmin(env, 'GET',
    `/itnew/admin/api/articles?q=${q}&status=unpublished&limit=1&offset=1`);

  assert.equal(result.response.status, 200);
  assert.deepEqual(result.body.items.map(({ id }) => id), ['two']);
  assert.deepEqual({ total: result.body.total, limit: result.body.limit, offset: result.body.offset },
    { total: 2, limit: 1, offset: 1 });

  const list = env.ITNEW_DB.executions.find(({ operation }) => operation === 'admin_article_list');
  const total = env.ITNEW_DB.executions.find(({ operation }) => operation === 'admin_article_total');
  assert.match(list.sql, /instr\s*\(\s*lower\s*\(\s*a\.title\s*\)\s*,\s*lower\s*\(\s*\?\s*\)\s*\)/iu);
  assert.match(list.sql, /instr\s*\(\s*lower\s*\(\s*a\.source_id\s*\)\s*,\s*lower\s*\(\s*\?\s*\)\s*\)/iu);
  assert.match(list.sql, /a\.status\s*=\s*\?/iu);
  assert.deepEqual(list.bindings, ['CLOUD', 'CLOUD', 'unpublished', 1, 1]);
  assert.deepEqual(total.bindings, ['CLOUD', 'CLOUD', 'unpublished']);
  assert.match(total.sql, /WHERE[\s\S]*instr[\s\S]*a\.status\s*=\s*\?/iu);
});

test('article management rejects unknown repeated oversized controlled and invalid filters before D1', async () => {
  const invalidPaths = [
    '/itnew/admin/api/articles?unknown=1',
    '/itnew/admin/api/articles?q=a&q=b',
    '/itnew/admin/api/articles?status=published&status=unpublished',
    '/itnew/admin/api/articles?limit=1&limit=2',
    '/itnew/admin/api/articles?offset=0&offset=1',
    `/itnew/admin/api/articles?q=${'a'.repeat(201)}`,
    '/itnew/admin/api/articles?q=cloud%00wire',
    '/itnew/admin/api/articles?status=draft',
    '/itnew/admin/api/articles?status=',
  ];
  for (const path of invalidPaths) {
    const env = environment({ articles: [{ id: 'private' }] });
    const result = await callAdmin(env, 'GET', path);
    assert.equal(result.response.status, 400, path);
    assert.deepEqual(result.body, { error: 'invalid_request' }, path);
    assert.equal(env.ITNEW_DB.preparedSql.length, 0, path);
  }
});

test('article unpublish maps not_found and preserves publisher idempotency', async () => {
  const env = environment({
    articles: [{ id: 'article-1', status: 'published', published_at: 5 }],
  });
  const missing = await callAdmin(env, 'POST', '/itnew/admin/api/articles/missing/unpublish');
  assert.equal(missing.response.status, 404);
  assert.deepEqual(missing.body, { error: 'not_found' });

  const first = await callAdmin(env, 'POST', '/itnew/admin/api/articles/article-1/unpublish');
  assert.equal(first.response.status, 200);
  assert.deepEqual(first.body, { articleId: 'article-1', status: 'unpublished' });
  const repeated = await callAdmin(env, 'POST', '/itnew/admin/api/articles/article-1/unpublish');
  assert.equal(repeated.response.status, 200);
  assert.deepEqual(repeated.body, { articleId: 'article-1', status: 'unpublished' });
  assert.equal(env.ITNEW_DB.state.audits.length, 1);
});

test('login and session map missing administrator configuration to the public stable code', async () => {
  const login = await handleItnewAdminRequest(request('POST', '/itnew/admin/api/login', {
    username: 'admin', password: 'password',
  }), {}, { now: 1000 });
  assert.equal(login.status, 503);
  assert.deepEqual(await login.json(), { error: 'system_not_configured' });

  const { context } = harness();
  context.auth.requireAdmin = async () => {
    throw new AuthError('admin_not_configured', 503);
  };
  const session = await handleItnewAdminRequest(
    request('GET', '/itnew/admin/api/session'),
    {},
    context,
  );
  assert.equal(session.status, 503);
  assert.deepEqual(await session.json(), { error: 'system_not_configured' });
});

test('default session recovery returns csrf in a no-store response', async () => {
  const response = await handleItnewAdminRequest(
    request('GET', '/itnew/admin/api/session'),
    {},
    {
      now: 1000,
      auth: {
        requireAdmin: async () => ({ sub: 'admin', csrf: 'recovered-csrf' }),
      },
    },
  );
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual(await response.json(), {
    authenticated: true,
    adminId: 'admin',
    csrf: 'recovered-csrf',
  });
});
