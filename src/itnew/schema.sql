CREATE TABLE IF NOT EXISTS itnew_sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  feed_url TEXT NOT NULL,
  homepage_url TEXT NOT NULL,
  language TEXT NOT NULL CHECK (language IN ('zh', 'en')),
  rights_mode TEXT NOT NULL CHECK (rights_mode IN ('licensed_full', 'summary_link')),
  license_name TEXT,
  license_url TEXT,
  attribution_template TEXT,
  priority_weight INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
  etag TEXT,
  last_modified TEXT,
  last_success_at INTEGER,
  last_error_at INTEGER,
  last_error TEXT
);

CREATE TABLE IF NOT EXISTS itnew_batches (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  target_count INTEGER NOT NULL,
  candidate_count INTEGER NOT NULL DEFAULT 0,
  collected_at INTEGER NOT NULL,
  closed_at INTEGER,
  warnings_json TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS itnew_one_open_batch
  ON itnew_batches(status) WHERE status = 'open';

CREATE TABLE IF NOT EXISTS itnew_candidates (
  id TEXT PRIMARY KEY,
  batch_id TEXT NOT NULL REFERENCES itnew_batches(id),
  source_id TEXT NOT NULL REFERENCES itnew_sources(id),
  canonical_url TEXT NOT NULL,
  content_fingerprint TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  staged_body_key TEXT,
  remote_image_url TEXT,
  language TEXT NOT NULL CHECK (language IN ('zh', 'en')),
  category TEXT NOT NULL CHECK (category IN ('AI', 'chips', 'internet', 'development', 'security', 'robotics', 'hardware', 'frontier')),
  score INTEGER NOT NULL,
  rights_mode_snapshot TEXT NOT NULL CHECK (rights_mode_snapshot IN ('licensed_full', 'summary_link')),
  license_snapshot_json TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'processing_error')),
  processing_error TEXT,
  article_id TEXT,
  source_published_at INTEGER,
  created_at INTEGER NOT NULL,
  reviewed_at INTEGER
);

CREATE UNIQUE INDEX IF NOT EXISTS itnew_candidates_canonical_url_unique
  ON itnew_candidates(canonical_url);
CREATE UNIQUE INDEX IF NOT EXISTS itnew_candidates_content_fingerprint_unique
  ON itnew_candidates(content_fingerprint);
CREATE INDEX IF NOT EXISTS itnew_candidates_batch_status
  ON itnew_candidates(batch_id, status);

CREATE TABLE IF NOT EXISTS itnew_articles (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  source_id TEXT NOT NULL REFERENCES itnew_sources(id),
  canonical_url TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  language TEXT NOT NULL CHECK (language IN ('zh', 'en')),
  category TEXT NOT NULL CHECK (category IN ('AI', 'chips', 'internet', 'development', 'security', 'robotics', 'hardware', 'frontier')),
  rights_mode TEXT NOT NULL CHECK (rights_mode IN ('licensed_full', 'summary_link')),
  license_name TEXT,
  license_url TEXT,
  attribution_text TEXT,
  hero_image_kind TEXT NOT NULL CHECK (hero_image_kind IN ('r2', 'fallback')),
  hero_image_key TEXT,
  source_published_at INTEGER,
  published_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('published', 'unpublished'))
);

CREATE INDEX IF NOT EXISTS itnew_articles_status_published_at
  ON itnew_articles(status, published_at DESC);
CREATE INDEX IF NOT EXISTS itnew_articles_category_published_at
  ON itnew_articles(category, published_at DESC);

CREATE TABLE IF NOT EXISTS itnew_article_sections (
  id TEXT PRIMARY KEY,
  article_id TEXT NOT NULL REFERENCES itnew_articles(id),
  section_index INTEGER NOT NULL,
  html TEXT NOT NULL,
  UNIQUE(article_id, section_index)
);

CREATE TABLE IF NOT EXISTS itnew_article_images (
  id TEXT PRIMARY KEY,
  article_id TEXT NOT NULL REFERENCES itnew_articles(id),
  object_key TEXT NOT NULL,
  source_url TEXT,
  alt_text TEXT,
  sort_order INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(article_id, object_key)
);

CREATE TABLE IF NOT EXISTS itnew_login_attempts (
  ip_hash TEXT PRIMARY KEY,
  window_started_at INTEGER NOT NULL,
  failure_count INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER
);

CREATE TABLE IF NOT EXISTS itnew_audit_log (
  id TEXT PRIMARY KEY,
  admin_id TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  batch_id TEXT REFERENCES itnew_batches(id),
  result TEXT NOT NULL,
  details_json TEXT,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS itnew_audit_log_batch_created_at
  ON itnew_audit_log(batch_id, created_at DESC);

CREATE TABLE IF NOT EXISTS itnew_source_runs (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES itnew_sources(id),
  batch_id TEXT REFERENCES itnew_batches(id),
  started_at INTEGER NOT NULL,
  completed_at INTEGER,
  status TEXT NOT NULL,
  duration_ms INTEGER,
  candidate_count INTEGER NOT NULL DEFAULT 0,
  error TEXT
);

CREATE INDEX IF NOT EXISTS itnew_source_runs_source_started_at
  ON itnew_source_runs(source_id, started_at DESC);

CREATE VIRTUAL TABLE IF NOT EXISTS itnew_articles_fts USING fts5(
  title,
  summary,
  content='itnew_articles',
  content_rowid='rowid'
);

CREATE TRIGGER IF NOT EXISTS itnew_articles_fts_insert
AFTER INSERT ON itnew_articles BEGIN
  INSERT INTO itnew_articles_fts(rowid, title, summary)
  VALUES (new.rowid, new.title, new.summary);
END;

CREATE TRIGGER IF NOT EXISTS itnew_articles_fts_update
AFTER UPDATE OF title, summary ON itnew_articles BEGIN
  INSERT INTO itnew_articles_fts(itnew_articles_fts, rowid, title, summary)
  VALUES ('delete', old.rowid, old.title, old.summary);
  INSERT INTO itnew_articles_fts(rowid, title, summary)
  VALUES (new.rowid, new.title, new.summary);
END;

CREATE TRIGGER IF NOT EXISTS itnew_articles_fts_delete
AFTER DELETE ON itnew_articles BEGIN
  INSERT INTO itnew_articles_fts(itnew_articles_fts, rowid, title, summary)
  VALUES ('delete', old.rowid, old.title, old.summary);
END;
