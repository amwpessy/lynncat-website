import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  BATCH_TARGET_SIZE,
  BODY_SECTION_MAX_BYTES,
  fallbackForCategory,
} from '../src/itnew/constants.js';

test('itnew constants enforce the confirmed batch and body limits', () => {
  assert.equal(BATCH_TARGET_SIZE, 30);
  assert.equal(BODY_SECTION_MAX_BYTES, 400 * 1024);
  assert.equal(fallbackForCategory('AI'), '/itnew/assets/fallback/ai.png');
  assert.equal(fallbackForCategory('unknown'), '/itnew/assets/fallback/frontier.png');
});

test('schema contains isolated tables, an open-batch guard and article FTS', async () => {
  const sql = await readFile(new URL('../src/itnew/schema.sql', import.meta.url), 'utf8');
  for (const table of [
    'itnew_sources', 'itnew_batches', 'itnew_candidates', 'itnew_articles',
    'itnew_article_sections', 'itnew_article_images', 'itnew_login_attempts',
    'itnew_audit_log', 'itnew_source_runs',
  ]) assert.match(sql, new RegExp(`CREATE TABLE IF NOT EXISTS ${table}`));
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS itnew_one_open_batch[\s\S]*WHERE status = 'open'/);
  assert.match(sql, /CREATE VIRTUAL TABLE IF NOT EXISTS itnew_articles_fts USING fts5/);
  assert.match(sql, /CHECK \(rights_mode IN \('licensed_full', 'summary_link'\)\)/);
});
