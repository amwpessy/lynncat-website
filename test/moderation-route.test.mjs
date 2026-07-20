import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import marketWorker from '../src/worker.js';

const siteRoot = new URL('../', import.meta.url);

function environment() {
  return {
    MODERATION_USERNAME: 'moderator',
    MODERATION_PASSWORD: 'secret',
    ASSETS: {
      async fetch(request) {
        const pathname = new URL(request.url).pathname.replace(/^\//, '');
        try {
          const body = await readFile(new URL(pathname, siteRoot));
          return new Response(body, { status: 200 });
        } catch {
          return new Response('Not found', { status: 404 });
        }
      },
    },
  };
}

test('moderation console is protected and community rules stay public', async () => {
  const env = environment();
  const moderation = await marketWorker.fetch(
    new Request('https://unit.test/markets/moderation'), env, {},
  );
  const community = await marketWorker.fetch(
    new Request('https://unit.test/markets/community.html'), env, {},
  );
  const html = await community.text();

  assert.equal(moderation.status, 401);
  assert.equal(community.status, 200);
  assert.match(html, /社区规则|Community Rules/);
});

test('internal worker files are never served as public assets', async () => {
  for (const pathname of [
    '/docs',
    '/migrations',
    '/src/community-schema.sql',
    '/test/market-worker.test.mjs',
    '/docs/release/lynncat-points-apple-setup.md',
    '/docs/superpowers/plans/2026-07-19-itnew.md',
    '/migrations/0002_lynncat_accounts_points.sql',
    '/.superpowers/sdd/progress.md',
  ]) {
    const response = await marketWorker.fetch(
      new Request(`https://unit.test${pathname}`), environment(), {},
    );
    assert.equal(response.status, 404, pathname);
  }
});
