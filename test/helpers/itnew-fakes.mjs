function copyRows(rows = []) {
  return rows.map((row) => ({ ...row }));
}

function operationFrom(sql) {
  const match = /\/\*\s*itnew:([a-z_]+)\s*\*\//.exec(sql);
  if (!match) throw new Error(`FakeD1 received unsupported SQL: ${sql}`);
  return match[1];
}

function successfulRun(changes = 1) {
  return { success: true, meta: { changes } };
}

function uniqueConstraint(target) {
  return new Error(`D1_ERROR: UNIQUE constraint failed: ${target}: SQLITE_CONSTRAINT`);
}

class FakeD1Statement {
  constructor(db, sql, bindings = []) {
    this.db = db;
    this.sql = sql;
    this.operation = operationFrom(sql);
    this.bindings = bindings;
  }

  bind(...bindings) {
    this.db.history.bindings.push({ operation: this.operation, values: [...bindings] });
    return new FakeD1Statement(this.db, this.sql, bindings);
  }

  async first(column) {
    const rows = this.db._execute(this, 'first');
    const row = rows[0] ?? null;
    return column && row ? row[column] : row;
  }

  async all() {
    return { success: true, results: this.db._execute(this, 'all') };
  }

  async run() {
    return this.db._execute(this, 'run');
  }
}

export class FakeD1 {
  constructor({
    sources = [], batches = [], candidates = [], sourceRuns = [], failBatchOperation = null,
  } = {}) {
    this.state = {
      sources: copyRows(sources),
      batches: copyRows(batches),
      candidates: copyRows(candidates),
      sourceRuns: copyRows(sourceRuns),
    };
    this.failBatchOperation = failBatchOperation;
    this.history = {
      prepared: [],
      bindings: [],
      executions: [],
      batchCalls: [],
    };
  }

  get sources() { return this.state.sources; }
  get batches() { return this.state.batches; }
  get candidates() { return this.state.candidates; }
  get sourceRuns() { return this.state.sourceRuns; }

  prepare(sql) {
    const operation = operationFrom(sql);
    this.history.prepared.push({ operation, sql });
    return new FakeD1Statement(this, sql);
  }

  async batch(statements) {
    this.history.batchCalls.push(statements.map((statement) => ({
      operation: statement.operation,
      bindings: [...statement.bindings],
    })));
    const transaction = {
      sources: copyRows(this.sources),
      batches: copyRows(this.batches),
      candidates: copyRows(this.candidates),
      sourceRuns: copyRows(this.sourceRuns),
    };
    const results = statements.map((statement) => {
      const result = this._execute(statement, 'run', transaction);
      if (statement.operation === this.failBatchOperation) {
        throw new Error(`simulated D1 batch failure: ${statement.operation}`);
      }
      return result;
    });
    this.state = transaction;
    return results;
  }

  _execute(statement, method, state = this.state) {
    this.history.executions.push({
      operation: statement.operation,
      method,
      bindings: [...statement.bindings],
    });
    return executeOperation(state, statement.operation, statement.bindings);
  }
}

function executeOperation(state, operation, bindings) {
  switch (operation) {
    case 'source_upsert': {
      const [
        id, name, feed_url, homepage_url, language, rights_mode,
        license_name, license_url, attribution_template, priority_weight, enabled,
      ] = bindings;
      const existing = state.sources.find((source) => source.id === id);
      if (existing) {
        Object.assign(existing, { name, feed_url, homepage_url, language, priority_weight });
      } else {
        state.sources.push({
          id, name, feed_url, homepage_url, language, rights_mode,
          license_name, license_url, attribution_template, priority_weight, enabled,
          etag: null, last_modified: null, last_success_at: null,
          last_error_at: null, last_error: null,
        });
      }
      return successfulRun();
    }
    case 'blocking_open':
      return copyRows(state.batches
        .filter(({ status }) => status === 'open')
        .sort((left, right) => left.collected_at - right.collected_at)
        .slice(0, 1));
    case 'blocking_candidates': {
      const blockingIds = new Set(state.candidates
        .filter(({ status }) => status === 'pending' || status === 'processing_error')
        .map(({ batch_id }) => batch_id));
      return copyRows(state.batches
        .filter(({ id }) => blockingIds.has(id))
        .sort((left, right) => left.collected_at - right.collected_at)
        .slice(0, 1));
    }
    case 'enabled_sources':
      return copyRows(state.sources
        .filter(({ enabled }) => enabled === 1)
        .sort((left, right) => right.priority_weight - left.priority_weight || left.id.localeCompare(right.id)));
    case 'existing_urls': {
      const wanted = new Set(bindings);
      return state.candidates
        .filter(({ canonical_url }) => wanted.has(canonical_url))
        .map(({ canonical_url }) => ({ canonical_url }));
    }
    case 'existing_fingerprints': {
      const wanted = new Set(bindings);
      return state.candidates
        .filter(({ content_fingerprint }) => wanted.has(content_fingerprint))
        .map(({ content_fingerprint }) => ({ content_fingerprint }));
    }
    case 'batch_insert': {
      const [id, status, target_count, candidate_count, collected_at, closed_at, warnings_json] = bindings;
      if (state.batches.some((row) => row.id === id)) throw uniqueConstraint('itnew_batches.id');
      if (status === 'open' && state.batches.some((row) => row.status === 'open')) {
        throw uniqueConstraint('itnew_batches.status');
      }
      state.batches.push({ id, status, target_count, candidate_count, collected_at, closed_at, warnings_json });
      return successfulRun();
    }
    case 'candidate_insert': {
      const [
        id, batch_id, source_id, canonical_url, content_fingerprint, title, summary,
        staged_body_key, remote_image_url, language, category, score, rights_mode_snapshot,
        license_snapshot_json, status, processing_error, article_id, source_published_at,
        created_at, reviewed_at,
      ] = bindings;
      if (state.candidates.some((row) => row.id === id)) throw uniqueConstraint('itnew_candidates.id');
      if (state.candidates.some((row) => row.canonical_url === canonical_url)) {
        throw uniqueConstraint('itnew_candidates.canonical_url');
      }
      if (state.candidates.some((row) => row.content_fingerprint === content_fingerprint)) {
        throw uniqueConstraint('itnew_candidates.content_fingerprint');
      }
      state.candidates.push({
        id, batch_id, source_id, canonical_url, content_fingerprint, title, summary,
        staged_body_key, remote_image_url, language, category, score, rights_mode_snapshot,
        license_snapshot_json, status, processing_error, article_id, source_published_at,
        created_at, reviewed_at,
      });
      return successfulRun();
    }
    case 'source_run_insert': {
      const [
        id, source_id, batch_id, started_at, completed_at, status,
        duration_ms, candidate_count, error,
      ] = bindings;
      state.sourceRuns.push({
        id, source_id, batch_id, started_at, completed_at, status,
        duration_ms, candidate_count, error,
      });
      return successfulRun();
    }
    case 'source_health_update': {
      const [
        hasEtag, etag, hasLastModified, lastModified, hasLastSuccessAt, lastSuccessAt,
        hasLastErrorAt, lastErrorAt, hasLastError, lastError, sourceId,
      ] = bindings;
      const source = state.sources.find(({ id }) => id === sourceId);
      if (!source) return successfulRun(0);
      if (hasEtag) source.etag = etag;
      if (hasLastModified) source.last_modified = lastModified;
      if (hasLastSuccessAt) source.last_success_at = lastSuccessAt;
      if (hasLastErrorAt) source.last_error_at = lastErrorAt;
      if (hasLastError) source.last_error = lastError;
      return successfulRun();
    }
    case 'batch_close': {
      const [closedAt, batchId] = bindings;
      const batch = state.batches.find(({ id, status }) => id === batchId && status === 'open');
      const unresolved = state.candidates.some(({ batch_id, status }) => (
        batch_id === batchId && (status === 'pending' || status === 'processing_error')
      ));
      if (!batch || unresolved) return successfulRun(0);
      batch.status = 'closed';
      batch.closed_at = closedAt;
      return successfulRun();
    }
    default:
      throw new Error(`FakeD1 does not support operation ${operation}`);
  }
}

export function createFakeD1(seed) {
  return new FakeD1(seed);
}

export function createFakeR2({ failPut = false } = {}) {
  const puts = [];
  return {
    puts,
    async put(key, value, options) {
      const put = { key, value, options };
      puts.push(put);
      const shouldFail = typeof failPut === 'function'
        ? failPut(put, puts.length - 1)
        : failPut;
      if (shouldFail) throw new Error('simulated R2 put failure');
      return { key };
    },
  };
}

export function createFetchHarness(routes = {}) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const href = String(url);
    calls.push({ url: href, init });
    const route = routes[href] ?? routes.default;
    if (!route) throw new Error(`No fake fetch route for ${href}`);
    return typeof route === 'function' ? route(href, init, calls) : route;
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}
