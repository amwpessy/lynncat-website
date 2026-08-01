PRAGMA foreign_keys = ON;

CREATE TABLE market_shuihu_draws (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES market_users(id) ON DELETE CASCADE,
  device_id TEXT REFERENCES market_user_devices(id) ON DELETE SET NULL,
  card_id INTEGER NOT NULL CHECK (card_id BETWEEN 1 AND 108),
  points_cost INTEGER NOT NULL CHECK (points_cost = 1000),
  balance_after INTEGER NOT NULL CHECK (balance_after >= 0),
  draw_day TEXT NOT NULL,
  is_new INTEGER NOT NULL CHECK (is_new IN (0, 1)),
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
);

CREATE TABLE market_shuihu_collection (
  user_id TEXT NOT NULL REFERENCES market_users(id) ON DELETE CASCADE,
  card_id INTEGER NOT NULL CHECK (card_id BETWEEN 1 AND 108),
  copies INTEGER NOT NULL DEFAULT 1 CHECK (copies > 0),
  first_drawn_at INTEGER NOT NULL,
  last_drawn_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, card_id)
);

CREATE TABLE market_shuihu_rewards (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES market_users(id) ON DELETE CASCADE,
  set_key TEXT NOT NULL,
  points_awarded INTEGER NOT NULL CHECK (points_awarded = 1000000),
  trigger_draw_id TEXT NOT NULL UNIQUE REFERENCES market_shuihu_draws(id) ON DELETE RESTRICT,
  awarded_at INTEGER NOT NULL,
  UNIQUE (user_id, set_key)
);

CREATE INDEX idx_market_shuihu_draws_daily
  ON market_shuihu_draws(user_id, created_at);

CREATE INDEX idx_market_shuihu_collection_user
  ON market_shuihu_collection(user_id, card_id);
