PRAGMA foreign_keys = ON;

CREATE TABLE market_poker_hands (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES market_users(id) ON DELETE CASCADE,
  device_id TEXT REFERENCES market_user_devices(id) ON DELETE SET NULL,
  hand_id TEXT NOT NULL,
  requested_delta INTEGER NOT NULL,
  applied_delta INTEGER NOT NULL,
  balance_after INTEGER NOT NULL CHECK (balance_after >= 0),
  play_day TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  UNIQUE(user_id, hand_id)
);

CREATE INDEX idx_market_poker_hands_daily
  ON market_poker_hands(user_id, created_at, applied_delta);
