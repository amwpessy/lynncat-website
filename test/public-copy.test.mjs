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

test('points release guide documents safe token-key rotation without embedding key material', async () => {
  const guide = await readFile('docs/release/lynncat-points-apple-setup.md', 'utf8');

  assert.match(guide, /APPLE_TOKEN_ENCRYPTION_KEYS[\s\S]*JSON object/i);
  assert.match(guide, /positive string versions/i);
  assert.match(guide, /32-byte[\s\S]*(standard Base64|Base64URL)/i);
  assert.match(guide, /zero[\s\S]*market_apple_credentials[\s\S]*token_key_version/i);
  assert.match(guide, /rollback[\s\S]*backup[\s\S]*remov/i);
  assert.match(guide, /rotating[\s\S]*does not rewrite old credentials/i);
  assert.match(guide, /APPLE_TOKEN_ENCRYPTION_KEY[\s\S]*fallback[\s\S]*current APPLE_TOKEN_KEY_VERSION/i);
  assert.match(guide, /account deletion[\s\S]*retry[\s\S]*old key/i);
  assert.match(guide, /placeholder/i);
  assert.doesNotMatch(guide, /"\d+"\s*:\s*"[A-Za-z0-9+/_-]{40,}={0,2}"/);
  assert.doesNotMatch(guide, /-----BEGIN (?:EC |RSA )?PRIVATE KEY-----/);
});
