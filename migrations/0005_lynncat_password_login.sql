PRAGMA foreign_keys = ON;

CREATE TABLE market_password_credentials (
  user_id TEXT PRIMARY KEY REFERENCES market_users(id) ON DELETE CASCADE,
  username_hash TEXT NOT NULL UNIQUE,
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  password_iterations INTEGER NOT NULL CHECK (password_iterations >= 100000),
  updated_at INTEGER NOT NULL
);

CREATE TABLE market_password_attempts (
  attempt_key_hash TEXT PRIMARY KEY,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  window_started_at INTEGER NOT NULL,
  blocked_until INTEGER,
  updated_at INTEGER NOT NULL
);

CREATE INDEX idx_market_password_attempts_updated
  ON market_password_attempts(updated_at);
