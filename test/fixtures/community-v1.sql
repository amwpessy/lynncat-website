CREATE TABLE IF NOT EXISTS market_messages (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL,
  nickname TEXT,
  text TEXT NOT NULL,
  author_hash TEXT NOT NULL,
  author_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'hidden', 'removed')),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  hidden_at INTEGER,
  removed_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_market_messages_author_key ON market_messages(author_key, id);
CREATE INDEX IF NOT EXISTS idx_market_messages_room_public ON market_messages(room_id, status, expires_at DESC);
CREATE INDEX IF NOT EXISTS idx_market_messages_author_created ON market_messages(author_hash, created_at DESC);

CREATE TABLE IF NOT EXISTS market_reports (
  id TEXT PRIMARY KEY,
  message_id TEXT NOT NULL,
  reporter_hash TEXT NOT NULL,
  reason TEXT NOT NULL,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'dismissed')),
  created_at INTEGER NOT NULL,
  resolved_at INTEGER,
  UNIQUE(message_id, reporter_hash)
);
CREATE INDEX IF NOT EXISTS idx_market_reports_status_created ON market_reports(status, created_at DESC);

CREATE TABLE IF NOT EXISTS market_moderation_actions (
  id TEXT PRIMARY KEY,
  target_type TEXT NOT NULL CHECK (target_type IN ('message', 'author', 'report')),
  target_id TEXT NOT NULL,
  action TEXT NOT NULL,
  note TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS market_banned_authors (
  author_hash TEXT PRIMARY KEY,
  banned_at INTEGER NOT NULL,
  note TEXT
);
