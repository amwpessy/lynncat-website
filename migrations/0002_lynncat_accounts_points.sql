PRAGMA foreign_keys = ON;
CREATE TABLE market_users (
  id TEXT PRIMARY KEY, public_id TEXT NOT NULL UNIQUE, apple_subject_hash TEXT NOT NULL UNIQUE,
  nickname TEXT NOT NULL, points_balance INTEGER NOT NULL DEFAULT 0 CHECK (points_balance >= 0),
  points_earned_total INTEGER NOT NULL DEFAULT 0 CHECK (points_earned_total >= 0),
  leaderboard_visible INTEGER NOT NULL DEFAULT 1 CHECK (leaderboard_visible IN (0, 1)),
  balance_changed_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deleted')),
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted_at INTEGER
);
CREATE TABLE market_apple_credentials (
  user_id TEXT PRIMARY KEY REFERENCES market_users(id) ON DELETE CASCADE,
  encrypted_refresh_token TEXT NOT NULL, token_key_version INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE market_user_devices (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES market_users(id) ON DELETE CASCADE,
  installation_hash TEXT NOT NULL, platform TEXT NOT NULL CHECK (platform IN ('macos','ios','watchos')),
  created_at INTEGER NOT NULL, last_seen_at INTEGER NOT NULL, revoked_at INTEGER,
  UNIQUE(user_id, installation_hash)
);
CREATE TABLE market_user_sessions (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES market_users(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL REFERENCES market_user_devices(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL, last_used_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL, revoked_at INTEGER
);
CREATE TABLE market_online_leases (
  device_id TEXT PRIMARY KEY REFERENCES market_user_devices(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES market_users(id) ON DELETE CASCADE,
  started_at INTEGER NOT NULL, last_heartbeat_at INTEGER NOT NULL,
  active_seconds INTEGER NOT NULL DEFAULT 0, lease_version INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL
);
CREATE TABLE market_point_ledger (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES market_users(id) ON DELETE CASCADE,
  device_id TEXT REFERENCES market_user_devices(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('online_credit','message_debit','admin_adjustment','reversal')),
  amount INTEGER NOT NULL CHECK (amount <> 0), balance_after INTEGER NOT NULL CHECK (balance_after >= 0),
  reference_type TEXT, reference_id TEXT, idempotency_key TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL
);
ALTER TABLE market_messages ADD COLUMN user_id TEXT;
ALTER TABLE market_messages ADD COLUMN point_ledger_id TEXT;
ALTER TABLE market_messages ADD COLUMN request_key TEXT;
CREATE UNIQUE INDEX idx_market_messages_request_key ON market_messages(request_key) WHERE request_key IS NOT NULL;
CREATE INDEX idx_market_users_leaderboard ON market_users(leaderboard_visible, points_balance DESC, balance_changed_at ASC);
