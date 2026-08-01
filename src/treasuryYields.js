const TREASURY_YIELD_ENDPOINT =
  'https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml';
const CACHE_KEY = 'https://lynncat.com/__internal/treasury-yields-v1';
const FRESH_CACHE_MS = 60 * 60 * 1000;

export const TREASURY_YIELD_TERMS = [
  { key: '1M', label: '1个月', field: 'BC_1MONTH', years: 1 / 12 },
  { key: '2M', label: '2个月', field: 'BC_2MONTH', years: 2 / 12 },
  { key: '3M', label: '3个月', field: 'BC_3MONTH', years: 3 / 12 },
  { key: '4M', label: '4个月', field: 'BC_4MONTH', years: 4 / 12 },
  { key: '6M', label: '6个月', field: 'BC_6MONTH', years: 0.5 },
  { key: '1Y', label: '1年', field: 'BC_1YEAR', years: 1 },
  { key: '2Y', label: '2年', field: 'BC_2YEAR', years: 2 },
  { key: '3Y', label: '3年', field: 'BC_3YEAR', years: 3 },
  { key: '5Y', label: '5年', field: 'BC_5YEAR', years: 5 },
  { key: '7Y', label: '7年', field: 'BC_7YEAR', years: 7 },
  { key: '10Y', label: '10年', field: 'BC_10YEAR', years: 10 },
  { key: '20Y', label: '20年', field: 'BC_20YEAR', years: 20 },
  { key: '30Y', label: '30年', field: 'BC_30YEAR', years: 30 },
];

function escapedRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function xmlValue(entry, field) {
  const tag = escapedRegExp(field);
  const match = entry.match(
    new RegExp(`<(?:(?:\\w+):)?${tag}(?:\\s[^>]*)?>([^<]*)<\\/(?:(?:\\w+):)?${tag}>`, 'i'),
  );
  return match?.[1]?.trim() || '';
}

export function parseTreasuryYieldXml(xml) {
  if (typeof xml !== 'string' || !xml.trim()) return [];
  const entries = xml.match(/<(?:\w+:)?entry(?:\s[^>]*)?>[\s\S]*?<\/(?:\w+:)?entry>/gi) || [];
  const rows = [];

  for (const entry of entries) {
    const rawDate = xmlValue(entry, 'NEW_DATE');
    const date = rawDate.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
    if (!date) continue;

    const rates = {};
    for (const term of TREASURY_YIELD_TERMS) {
      const raw = xmlValue(entry, term.field);
      const value = Number(raw);
      if (raw !== '' && Number.isFinite(value) && value >= 0 && value < 100) {
        rates[term.key] = value;
      }
    }
    if (Object.keys(rates).length > 0) rows.push({ date, rates });
  }

  return rows.sort((left, right) => left.date.localeCompare(right.date));
}

function roundedBasisPoints(value) {
  return Math.round(value * 10) / 10;
}

export function buildTreasuryYieldSnapshot(rows, fetchedAt = Date.now()) {
  const byDate = new Map();
  for (const row of rows || []) {
    if (row?.date && row?.rates && typeof row.rates === 'object') byDate.set(row.date, row);
  }
  const ordered = [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date));
  const latest = ordered.at(-1);
  if (!latest) throw new Error('Treasury yield data has no valid rows');
  const previous = ordered.at(-2);

  const curve = TREASURY_YIELD_TERMS.flatMap((term) => {
    const value = latest.rates[term.key];
    if (!Number.isFinite(value)) return [];
    const previousValue = previous?.rates?.[term.key];
    return [{
      key: term.key,
      label: term.label,
      years: term.years,
      value,
      previousValue: Number.isFinite(previousValue) ? previousValue : null,
      changeBp: Number.isFinite(previousValue)
        ? roundedBasisPoints((value - previousValue) * 100)
        : null,
    }];
  });

  const values = Object.fromEntries(curve.map((item) => [item.key, item.value]));
  const spread2s10sBp = Number.isFinite(values['2Y']) && Number.isFinite(values['10Y'])
    ? roundedBasisPoints((values['10Y'] - values['2Y']) * 100)
    : null;
  const curveShape = spread2s10sBp == null
    ? 'unknown'
    : spread2s10sBp > 5
      ? 'normal'
      : spread2s10sBp < -5
        ? 'inverted'
        : 'flat';

  return {
    asOf: latest.date,
    previousDate: previous?.date || null,
    fetchedAt,
    stale: false,
    source: 'U.S. Department of the Treasury',
    curve,
    spread2s10sBp,
    curveShape,
  };
}

async function fetchYieldYear(year, fetchImpl) {
  const url = new URL(TREASURY_YIELD_ENDPOINT);
  url.searchParams.set('data', 'daily_treasury_yield_curve');
  url.searchParams.set('field_tdr_date_value', String(year));
  const response = await fetchImpl(url.toString(), {
    headers: { Accept: 'application/xml, text/xml;q=0.9' },
    cf: { cacheEverything: true, cacheTtl: 3600 },
  });
  if (!response.ok) throw new Error(`Treasury yield request failed (${response.status})`);
  return parseTreasuryYieldXml(await response.text());
}

async function readCache(cache) {
  if (!cache) return null;
  try {
    const response = await cache.match(new Request(CACHE_KEY));
    if (!response?.ok) return null;
    const payload = await response.json();
    return payload?.asOf && Array.isArray(payload.curve) ? payload : null;
  } catch {
    return null;
  }
}

async function writeCache(cache, payload) {
  if (!cache) return;
  try {
    await cache.put(new Request(CACHE_KEY), new Response(JSON.stringify(payload), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'public, max-age=604800',
      },
    }));
  } catch {
    // The live response remains usable when edge cache storage is unavailable.
  }
}

function jsonResponse(payload, status = 200, extraHeaders = {}, head = false) {
  return new Response(head ? null : JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': status === 200
        ? 'public, max-age=300, s-maxage=1800, stale-while-revalidate=86400'
        : 'no-store',
      'Access-Control-Allow-Origin': '*',
      ...extraHeaders,
    },
  });
}

export async function handleTreasuryYields(
  request,
  {
    fetchImpl = globalThis.fetch,
    cache = globalThis.caches?.default,
    now = Date.now(),
  } = {},
) {
  const isHead = request.method === 'HEAD';
  if (request.method !== 'GET' && !isHead) {
    return jsonResponse({ error: 'method_not_allowed' }, 405, { Allow: 'GET, HEAD' });
  }

  const cached = await readCache(cache);
  if (cached && Number.isFinite(cached.fetchedAt) && now - cached.fetchedAt < FRESH_CACHE_MS) {
    return jsonResponse(cached, 200, {}, isHead);
  }

  try {
    const currentYear = new Date(now).getUTCFullYear();
    let rows = await fetchYieldYear(currentYear, fetchImpl);
    if (rows.length < 2) {
      rows = [...await fetchYieldYear(currentYear - 1, fetchImpl), ...rows];
    }
    const payload = buildTreasuryYieldSnapshot(rows, now);
    await writeCache(cache, payload);
    return jsonResponse(payload, 200, {}, isHead);
  } catch {
    if (cached) {
      return jsonResponse(
        { ...cached, stale: true },
        200,
        { 'X-Data-Stale': 'true' },
        isHead,
      );
    }
    return jsonResponse({ error: 'treasury_yields_unavailable' }, 502, {}, isHead);
  }
}
