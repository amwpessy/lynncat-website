import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('migration has all account and point constraints', async () => {
  const sql = await readFile(new URL('../migrations/0002_lynncat_accounts_points.sql', import.meta.url), 'utf8');
  for (const table of ['market_users', 'market_apple_credentials', 'market_user_devices',
    'market_user_sessions', 'market_online_leases', 'market_point_ledger']) {
    assert.match(sql, new RegExp(`CREATE TABLE ${table}`));
  }
  assert.match(sql, /points_balance INTEGER NOT NULL DEFAULT 0 CHECK \(points_balance >= 0\)/);
  assert.match(sql, /UNIQUE\(user_id, installation_hash\)/);
  assert.match(sql, /idempotency_key TEXT NOT NULL UNIQUE/);
  assert.match(sql, /ALTER TABLE market_messages ADD COLUMN request_key TEXT/);
});
