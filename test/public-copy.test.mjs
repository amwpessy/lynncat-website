import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('support page publishes moderation contact and reporting information', async () => {
  const html = await readFile('markets/support.html', 'utf8');
  assert.match(html, /举报|Report/);
  assert.match(html, /community\.html/);
});

test('privacy page discloses community content and pseudonymous anti-abuse data', async () => {
  const html = await readFile('markets/privacy.html', 'utf8');
  assert.match(html, /昵称|nickname/i);
  assert.match(html, /举报|report/i);
  assert.match(html, /哈希|hashed/i);
});
