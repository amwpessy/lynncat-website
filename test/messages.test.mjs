import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeRoomId, classifyText, toPublicMessage } from '../src/messages.js';

test('normalizeRoomId keeps a concrete room and rejects malformed input', () => {
  assert.equal(normalizeRoomId(' XAU '), 'XAU');
  assert.equal(normalizeRoomId('CURRENT_NEWS'), 'CURRENT_NEWS');
  assert.equal(normalizeRoomId('XAU<script>'), '');
});

test('classifyText rejects URLs, personal contact and guaranteed-return solicitation', () => {
  assert.equal(classifyText('加我微信 abc123').allowed, false);
  assert.equal(classifyText('https://example.com 进群').allowed, false);
  assert.equal(classifyText('跟单保证收益').allowed, false);
  assert.equal(classifyText('今晚关注美元和实际利率').allowed, true);
});

test('toPublicMessage never exposes private author fields', () => {
  const result = toPublicMessage({
    id: 'm1', room_id: 'XAU', nickname: 'A', text: '观察',
    created_at: 1, expires_at: 2, author_key: 'opaque', author_hash: 'secret',
  });
  assert.deepEqual(result, {
    id: 'm1', roomId: 'XAU', nickname: 'A', text: '观察',
    createdAt: 1, expiresAt: 2, authorKey: 'opaque',
  });
});
