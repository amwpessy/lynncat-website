-- 给已存在的 auth_codes 表补 revoked 列(支持管理员注销授权码)。
-- 本地与线上都需执行一次：
--   npx wrangler d1 execute gkzy --local  --file gkzy/migrations/001_add_revoked.sql -y
--   npx wrangler d1 execute gkzy --remote --file gkzy/migrations/001_add_revoked.sql -y
ALTER TABLE auth_codes ADD COLUMN revoked INTEGER NOT NULL DEFAULT 0;
