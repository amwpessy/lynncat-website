import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import worker from '../src/worker.js';
import {
  buildTreasuryYieldSnapshot,
  handleTreasuryYields,
  parseTreasuryYieldXml,
} from '../src/treasuryYields.js';

function xmlEntry(id, date, rates) {
  const fields = Object.entries(rates)
    .map(([field, value]) => `<d:${field} m:type="Edm.Double">${value}</d:${field}>`)
    .join('');
  return `<entry><id>${id}</id><content><m:properties>
    <d:NEW_DATE m:type="Edm.DateTime">${date}T00:00:00</d:NEW_DATE>
    ${fields}
  </m:properties></content></entry>`;
}

function xmlFeed(entries) {
  return `<?xml version="1.0"?><feed
    xmlns:d="http://schemas.microsoft.com/ado/2007/08/dataservices"
    xmlns:m="http://schemas.microsoft.com/ado/2007/08/dataservices/metadata">
    ${entries.join('')}
  </feed>`;
}

const priorEntry = xmlEntry(1, '2026-07-28', {
  BC_1MONTH: 4.34,
  BC_3MONTH: 4.31,
  BC_6MONTH: 4.18,
  BC_1YEAR: 3.98,
  BC_2YEAR: 4.16,
  BC_5YEAR: 4.29,
  BC_10YEAR: 4.61,
  BC_30YEAR: 4.98,
});
const latestEntry = xmlEntry(2, '2026-07-29', {
  BC_1MONTH: 4.33,
  BC_3MONTH: 4.30,
  BC_6MONTH: 4.17,
  BC_1YEAR: 3.99,
  BC_2YEAR: 4.22,
  BC_5YEAR: 4.35,
  BC_10YEAR: 4.67,
  BC_30YEAR: 5.04,
});
const sampleXml = xmlFeed([latestEntry, priorEntry]);

test('Treasury XML parser extracts and sorts the official par-yield fields', () => {
  const rows = parseTreasuryYieldXml(sampleXml);
  assert.deepEqual(rows.map((row) => row.date), ['2026-07-28', '2026-07-29']);
  assert.equal(rows[1].rates['1M'], 4.33);
  assert.equal(rows[1].rates['2Y'], 4.22);
  assert.equal(rows[1].rates['10Y'], 4.67);
  assert.equal(rows[1].rates['30Y'], 5.04);
});

test('yield snapshot calculates basis-point changes and the 2s10s curve shape', () => {
  const snapshot = buildTreasuryYieldSnapshot(parseTreasuryYieldXml(sampleXml), 123);
  assert.equal(snapshot.asOf, '2026-07-29');
  assert.equal(snapshot.previousDate, '2026-07-28');
  assert.equal(snapshot.fetchedAt, 123);
  assert.equal(snapshot.curve.find((item) => item.key === '10Y').changeBp, 6);
  assert.equal(snapshot.spread2s10sBp, 45);
  assert.equal(snapshot.curveShape, 'normal');
});

test('yield endpoint requests the official Treasury feed and returns cacheable JSON', async () => {
  const urls = [];
  const stored = [];
  const response = await handleTreasuryYields(
    new Request('https://lynncat.com/xxxc/treasury-yields'),
    {
      now: Date.UTC(2026, 6, 30),
      fetchImpl: async (url) => {
        urls.push(String(url));
        return new Response(sampleXml);
      },
      cache: {
        match: async () => null,
        put: async (request, value) => stored.push([request, value]),
      },
    },
  );

  assert.equal(response.status, 200);
  assert.match(response.headers.get('Cache-Control'), /s-maxage=1800/);
  assert.equal(urls.length, 1);
  assert.match(urls[0], /data=daily_treasury_yield_curve/);
  assert.match(urls[0], /field_tdr_date_value=2026/);
  assert.equal(stored.length, 1);
  assert.equal((await response.json()).curve.length, 8);
});

test('yield endpoint joins the prior year when the new year has only one record', async () => {
  const years = [];
  const response = await handleTreasuryYields(
    new Request('https://lynncat.com/xxxc/treasury-yields'),
    {
      now: Date.UTC(2026, 0, 2),
      fetchImpl: async (url) => {
        const year = new URL(url).searchParams.get('field_tdr_date_value');
        years.push(year);
        return new Response(xmlFeed([year === '2026' ? latestEntry : priorEntry]));
      },
      cache: null,
    },
  );
  const payload = await response.json();
  assert.deepEqual(years, ['2026', '2025']);
  assert.equal(payload.previousDate, '2026-07-28');
  assert.equal(payload.curve.find((item) => item.key === '10Y').changeBp, 6);
});

test('yield endpoint returns the last official snapshot as stale when Treasury is unavailable', async () => {
  const cached = buildTreasuryYieldSnapshot(parseTreasuryYieldXml(sampleXml), 1);
  const response = await handleTreasuryYields(
    new Request('https://lynncat.com/xxxc/treasury-yields'),
    {
      now: Date.UTC(2026, 6, 30),
      fetchImpl: async () => { throw new Error('upstream unavailable'); },
      cache: { match: async () => Response.json(cached), put: async () => {} },
    },
  );
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('X-Data-Stale'), 'true');
  assert.equal(payload.stale, true);
  assert.equal(payload.asOf, '2026-07-29');
});

test('worker route marks yield JSON as noindex', async () => {
  const originalFetch = globalThis.fetch;
  const originalCaches = globalThis.caches;
  globalThis.fetch = async () => new Response(sampleXml);
  globalThis.caches = { default: { match: async () => null, put: async () => {} } };
  try {
    const response = await worker.fetch(
      new Request('https://lynncat.com/xxxc/treasury-yields'),
      { ASSETS: { fetch: async () => new Response('asset') } },
      {},
    );
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('X-Robots-Tag'), 'noindex, nofollow');
    assert.equal((await response.json()).asOf, '2026-07-29');
  } finally {
    globalThis.fetch = originalFetch;
    if (originalCaches === undefined) delete globalThis.caches;
    else globalThis.caches = originalCaches;
  }
});

test('homepage debt detail renders the yield curve while the legacy debt page stays unchanged', async () => {
  const [source, deployedSource, css, legacyHtml] = await Promise.all([
    readFile(new URL('../markets-home.js', import.meta.url), 'utf8'),
    readFile(new URL('../markets-home-20260730k.js', import.meta.url), 'utf8'),
    readFile(new URL('../markets-home.css', import.meta.url), 'utf8'),
    readFile(new URL('../xxxc/debt.html', import.meta.url), 'utf8'),
  ]);
  assert.equal(deployedSource, source);
  assert.match(source, /refreshTreasuryYields\(false\)/);
  assert.match(source, /api\("\/xxxc\/treasury-yields"/);
  assert.match(source, /function treasuryYieldSection\(/);
  assert.match(source, /id="treasury-yield-chart"/);
  assert.match(source, /\["2Y", "10Y", "30Y"\]/);
  assert.match(source, /2年—10年利差/);
  assert.match(source, /renderDebtDetail\(target, state\.detailCache\.DEBT, state\.treasuryYields\)/);
  assert.match(css, /\.treasury-yield-key-grid/);
  assert.match(css, /\.treasury-yield-term-grid/);
  assert.doesNotMatch(legacyHtml, /yieldCurve|美国国债收益率曲线|2年—10年利差/);
});
