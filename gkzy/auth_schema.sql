-- 授权码与管理员会话表（D1）。本地与线上都需执行：
--   npx wrangler d1 execute gkzy --local  --file gkzy/auth_schema.sql -y
--   npx wrangler d1 execute gkzy --remote --file gkzy/auth_schema.sql -y
CREATE TABLE IF NOT EXISTS auth_codes (
  code       TEXT PRIMARY KEY,
  max_uses   INTEGER NOT NULL DEFAULT 10,
  used_count INTEGER NOT NULL DEFAULT 0,
  revoked    INTEGER NOT NULL DEFAULT 0,
  note       TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS admin_sessions (
  token      TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sess_exp ON admin_sessions(expires_at);
