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

test('poker migration keeps hand settlements unique and balances non-negative', async () => {
  const sql = await readFile(new URL('../migrations/0003_codexpilot_poker.sql', import.meta.url), 'utf8');

  assert.match(sql, /CREATE TABLE market_poker_hands/);
  assert.match(sql, /balance_after INTEGER NOT NULL CHECK \(balance_after >= 0\)/);
  assert.match(sql, /idempotency_key TEXT NOT NULL UNIQUE/);
  assert.match(sql, /UNIQUE\(user_id, hand_id\)/);
  assert.match(sql, /CREATE INDEX idx_market_poker_hands_daily/);
});

test('shuihu migration constrains cards, draw cost, and one completion reward per user', async () => {
  const sql = await readFile(new URL('../migrations/0004_shuihu_card_collection.sql', import.meta.url), 'utf8');

  for (const table of [
    'market_shuihu_draws',
    'market_shuihu_collection',
    'market_shuihu_rewards',
  ]) {
    assert.match(sql, new RegExp(`CREATE TABLE ${table}`));
  }
  assert.match(sql, /card_id INTEGER NOT NULL CHECK \(card_id BETWEEN 1 AND 108\)/);
  assert.match(sql, /points_cost INTEGER NOT NULL CHECK \(points_cost = 1000\)/);
  assert.match(sql, /points_awarded INTEGER NOT NULL CHECK \(points_awarded = 1000000\)/);
  assert.match(sql, /UNIQUE \(user_id, set_key\)/);
  assert.match(sql, /idempotency_key TEXT NOT NULL UNIQUE/);
});

test('password authentication migration stores only derived credentials', async () => {
  const sql = await readFile(new URL('../migrations/0005_lynncat_password_login.sql', import.meta.url), 'utf8');

  assert.match(sql, /CREATE TABLE market_password_credentials/);
  assert.match(sql, /username_hash TEXT NOT NULL UNIQUE/);
  assert.match(sql, /password_salt TEXT NOT NULL/);
  assert.match(sql, /password_hash TEXT NOT NULL/);
  assert.match(sql, /password_iterations INTEGER NOT NULL CHECK \(password_iterations >= 100000\)/);
  assert.match(sql, /CREATE TABLE market_password_attempts/);
  assert.match(sql, /blocked_until INTEGER/);
  assert.doesNotMatch(sql, /\busername TEXT\b/);
  assert.doesNotMatch(sql, /\bpassword TEXT\b/);
});
