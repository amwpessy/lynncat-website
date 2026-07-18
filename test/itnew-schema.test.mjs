import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
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

async function runSchema(statements) {
  const schema = await readFile(new URL('../src/itnew/schema.sql', import.meta.url), 'utf8');
  return spawnSync('sqlite3', [':memory:'], {
    encoding: 'utf8',
    input: `.bail on\nPRAGMA foreign_keys = ON;\n${schema}\n${statements.join('\n')}\n`,
  });
}

function sourceSql(rightsMode) {
  return `INSERT INTO itnew_sources (id, name, feed_url, homepage_url, language, rights_mode)
    VALUES ('source-1', 'Source', 'https://feed.test', 'https://test', 'en', '${rightsMode}');`;
}

function articleSql({ rightsMode = 'summary_link', permissionVerified = 0 } = {}) {
  return `INSERT INTO itnew_articles (
    id, slug, source_id, canonical_url, title, summary, language, category,
    rights_mode, article_permission_verified, hero_image_kind, published_at
  ) VALUES (
    'article-1', 'article-1', 'source-1', 'https://test/article-1', 'Title', 'Summary', 'en', 'AI',
    '${rightsMode}', ${permissionVerified}, 'fallback', 1
  );`;
}

test('schema enforces the 400 KiB UTF-8 body-section limit', async () => {
  const sectionAtLimit = `${'你'.repeat(136533)}a`;
  const sectionOverLimit = `${sectionAtLimit}a`;
  assert.equal(Buffer.byteLength(sectionAtLimit, 'utf8'), 409600);
  assert.equal(Buffer.byteLength(sectionOverLimit, 'utf8'), 409601);

  const accepted = await runSchema([
    sourceSql('summary_link'),
    articleSql(),
    `INSERT INTO itnew_article_sections (id, article_id, section_index, html)
      VALUES ('section-1', 'article-1', 0, '${sectionAtLimit}');`,
  ]);
  assert.equal(accepted.status, 0, accepted.stderr);

  const rejected = await runSchema([
    sourceSql('summary_link'),
    articleSql(),
    `INSERT INTO itnew_article_sections (id, article_id, section_index, html)
      VALUES ('section-1', 'article-1', 0, '${sectionOverLimit}');`,
  ]);
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /CHECK constraint failed/);
});

test('schema requires source and article permission for full-text articles', async () => {
  const sourceOnly = await runSchema([
    sourceSql('licensed_full'),
    articleSql({ rightsMode: 'licensed_full', permissionVerified: 0 }),
  ]);
  assert.notEqual(sourceOnly.status, 0);

  const articleOnly = await runSchema([
    sourceSql('summary_link'),
    articleSql({ rightsMode: 'licensed_full', permissionVerified: 1 }),
  ]);
  assert.notEqual(articleOnly.status, 0);

  const neither = await runSchema([
    sourceSql('summary_link'),
    articleSql({ rightsMode: 'licensed_full', permissionVerified: 0 }),
  ]);
  assert.notEqual(neither.status, 0);

  const both = await runSchema([
    sourceSql('licensed_full'),
    articleSql({ rightsMode: 'licensed_full', permissionVerified: 1 }),
  ]);
  assert.equal(both.status, 0, both.stderr);

  const summaryLink = await runSchema([
    sourceSql('summary_link'),
    articleSql(),
  ]);
  assert.equal(summaryLink.status, 0, summaryLink.stderr);

  const updateRejected = await runSchema([
    sourceSql('summary_link'),
    articleSql(),
    "UPDATE itnew_articles SET rights_mode = 'licensed_full', article_permission_verified = 1 WHERE id = 'article-1';",
  ]);
  assert.notEqual(updateRejected.status, 0);
});
