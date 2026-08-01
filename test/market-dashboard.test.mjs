import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  crossHistoryPayload,
  detailPayload,
  fetchDebtHistory,
  fetchDebtLatest,
  fetchGoldApiQuote,
  fetchSinaOilQuotes,
  handleMarketPublicData,
  livePayload,
  parseChinaMarketCapRanking,
  parseCountryMarketCapHtml,
  parseRss,
  parseSinaChinaMarketCapRanking,
  parseSinaHongKongCandidates,
} from '../src/marketDashboard.js';

test('market news RSS parser keeps source metadata and extracts article imagery', () => {
  const items = parseRss(`
    <rss><channel><item>
      <title><![CDATA[AI agents reach production]]></title>
      <link>https://example.com/agents</link>
      <description><![CDATA[<p>A useful summary.</p><img src="https://example.com/agents.png">]]></description>
      <pubDate>Wed, 29 Jul 2026 08:00:00 GMT</pubDate>
      <category>AI</category>
    </item></channel></rss>
  `, { source: 'Test Feed', category: 'Tech' });

  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'AI agents reach production');
  assert.equal(items[0].summary, 'A useful summary.');
  assert.equal(items[0].image, 'https://example.com/agents.png');
  assert.equal(items[0].source, 'Test Feed');
  assert.equal(items[0].category, 'AI');
});

test('market news RSS parser supports Atom links', () => {
  const items = parseRss(`
    <feed><entry>
      <title>Market infrastructure update</title>
      <link href="https://example.com/market"/>
      <summary>Infrastructure details</summary>
      <updated>2026-07-29T09:00:00Z</updated>
    </entry></feed>
  `, { source: 'Atom Feed', category: 'Markets' });

  assert.equal(items.length, 1);
  assert.equal(items[0].url, 'https://example.com/market');
  assert.equal(items[0].category, 'Markets');
});

test('debt detail keeps a stable response when Fiscal Data is temporarily unavailable', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('upstream unavailable'); };
  try {
    const payload = await detailPayload(new URL('https://example.com/markets/details?symbol=DEBT'));
    assert.equal(payload.type, 'debt');
    assert.deepEqual(payload.points, []);
    assert.ok(payload.milestones.length >= 9);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('debt quote and history use the Mac Fiscal Data window and raw-dollar changes', async () => {
  const originalFetch = globalThis.fetch;
  const urls = [];
  const rows = [
    { record_date: '2026-07-28', tot_pub_debt_out_amt: '39797152899275.21' },
    { record_date: '2026-07-27', tot_pub_debt_out_amt: '39713964053447.11' },
    { record_date: '2026-07-24', tot_pub_debt_out_amt: '39692374867364.99' },
  ];
  globalThis.fetch = async (url) => {
    urls.push(String(url));
    return Response.json({ data: rows });
  };
  try {
    const quote = await fetchDebtLatest();
    const history = await fetchDebtHistory();
    assert.equal(quote.recordDate, '2026-07-28');
    assert.ok(Math.abs(quote.value - 39.79715289927521) < 1e-10);
    assert.ok(Math.abs(quote.dailyChangeUSD - 83_188_845_828.10) < 0.01);
    assert.equal(quote.isStale, false);
    assert.equal(history.length, 2);
    assert.equal(history.at(-1).recordDate, '2026-07-28');
    assert.ok(urls.every((url) => url.includes('page%5Bsize%5D=400')));
    assert.ok(urls.every((url) => url.includes('fields=record_date%2Ctot_pub_debt_out_amt')));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('debt fetch falls back to the last successful official edge snapshot', async () => {
  const originalFetch = globalThis.fetch;
  const originalCaches = globalThis.caches;
  globalThis.fetch = async () => { throw new Error('Treasury unavailable'); };
  globalThis.caches = {
    default: {
      match: async () => Response.json({
        fetchedAt: 1,
        rows: [
          { recordDate: '2026-07-28', totalDebt: 39797152899275.21 },
          { recordDate: '2026-07-27', totalDebt: 39713964053447.11 },
        ],
      }),
      put: async () => {},
    },
  };
  try {
    const quote = await fetchDebtLatest();
    assert.equal(quote.recordDate, '2026-07-28');
    assert.equal(quote.isStale, true);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalCaches === undefined) delete globalThis.caches;
    else globalThis.caches = originalCaches;
  }
});

test('Sina oil parser preserves live price, previous close and source metadata', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response([
    'var hq_str_hf_CL="82.89,0,0,0,0,0,23:42:00,79.25,0,0,0,0,2026-07-29";',
    'var hq_str_hf_OIL="86.42,0,0,0,0,0,23:42:00,83.18,0,0,0,0,2026-07-29";',
  ].join('\n'));
  try {
    const quotes = await fetchSinaOilQuotes();
    assert.equal(quotes.length, 2);
    assert.deepEqual(quotes.map((quote) => quote.symbol), ['WTI', 'BRENT']);
    assert.equal(quotes[0].value, 82.89);
    assert.equal(quotes[0].previous, 79.25);
    assert.equal(quotes[0].source, '新浪国际期货');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('gold quote uses the same Gold API XAU spot contract as the Mac client', async () => {
  const originalFetch = globalThis.fetch;
  let requestedUrl = '';
  let requestedOptions = null;
  globalThis.fetch = async (url, options) => {
    requestedUrl = String(url);
    requestedOptions = options;
    return Response.json({
      currency: 'USD',
      name: 'Gold',
      price: 4045.100098,
      symbol: 'XAU',
      updatedAt: '2026-07-30T05:11:21Z',
    });
  };
  try {
    const quote = await fetchGoldApiQuote();
    assert.equal(requestedUrl, 'https://api.gold-api.com/price/XAU');
    assert.equal(requestedOptions.cf, undefined);
    assert.equal(quote.value, 4045.100098);
    assert.equal(quote.updatedAt, Date.parse('2026-07-30T05:11:21Z'));
    assert.equal(quote.quoteKind, 'spot');
    assert.match(quote.source, /Gold API/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('economic calendar accepts the Mac 45-day window and bounds larger requests', async () => {
  const originalFetch = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(String(url));
    return Response.json({ data: { rows: [] } });
  };
  try {
    const response = await handleMarketPublicData(new Request('https://example.com/markets/events?days=999'));
    assert.equal(response.status, 200);
    assert.equal(urls.length, 46);
    assert.deepEqual((await response.json()).events, []);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('period switching is immediate and independently filters the cached Mac one-year windows', async () => {
  const source = await readFile(new URL('../markets-home.js', import.meta.url), 'utf8');
  const handlerStart = source.indexOf('$$(".period-switcher [data-period]")');
  const handlerEnd = source.indexOf('$$("[data-trend]")', handlerStart);
  const periodHandler = source.slice(handlerStart, handlerEnd);

  assert.match(source, /function filterHistory\(points, period = state\.period\)/);
  assert.match(source, /history\?symbol=.*period=1y/);
  assert.match(periodHandler, /renderTrend\(\)/);
  assert.match(periodHandler, /renderMonitor\(\)/);
  assert.doesNotMatch(periodHandler, /refreshDashboard|refreshHistories|await |api\(/);
  assert.match(periodHandler, /scope === "monitor"[\s\S]*state\.monitorPeriod/);
  assert.match(periodHandler, /state\.period = button\.dataset\.period/);
  assert.doesNotMatch(source, /shortHistories|ensureShortHistories|SHORT_HISTORY/);
});

test('daily and weekly selectors reuse the Mac 370-day daily history instead of refetching intraday bars', async () => {
  const originalFetch = globalThis.fetch;
  const urls = [];
  const timestamps = Array.from({ length: 12 }, (_, index) => 1_785_300_000 + index * 300);
  globalThis.fetch = async (url) => {
    urls.push(String(url));
    return Response.json({
      chart: {
        result: [{
          timestamp: timestamps,
          indicators: { quote: [{ close: timestamps.map((_, index) => 24_000 + index) }] },
        }],
      },
    });
  };
  try {
    const daily = await handleMarketPublicData(new Request('https://example.com/markets/history?symbol=NASDAQ&period=1d'));
    const weekly = await handleMarketPublicData(new Request('https://example.com/markets/history?symbol=NASDAQ&period=1w'));
    assert.equal((await daily.json()).points.length, 12);
    assert.equal((await weekly.json()).points.length, 12);
    assert.match(urls[0], /range=1y&interval=1d/);
    assert.match(urls[1], /range=1y&interval=1d/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('live payload preserves the Mac source groups and refresh contracts', async () => {
  const originalFetch = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async (url) => {
    const value = String(url);
    urls.push(value);
    if (value.includes('open.er-api.com')) {
      return Response.json({ rates: {
        CNY: 6.77, HKD: 7.84, EUR: 0.87, GBP: 0.75,
        JPY: 163, KRW: 1448, RUB: 79, INR: 95,
      } });
    }
    if (value.includes('api.gold-api.com')) {
      const symbol = value.split('/').at(-1);
      return Response.json({ symbol, price: symbol === 'BTC' ? 64_000 : symbol === 'ETH' ? 3_000 : 2_000 });
    }
    if (value.includes('api.binance.com')) {
      return Response.json({ lastPrice: '7', openPrice: '6', closeTime: 1_785_396_300_000 });
    }
    if (value.includes('qt.gtimg.cn')) {
      return new Response([
        'v_us_DJI="0~Dow~0~42000~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~10~0.02";',
        'v_us_IXIC="0~Nasdaq~0~24500~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~20~0.08";',
        'v_us_INX="0~S&P 500~0~7000~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~0~5~0.07";',
      ].join('\n'));
    }
    if (value.includes('hq.sinajs.cn')) {
      return new Response([
        'var hq_str_hf_CL="82.89,0,0,0,0,0,23:42:00,79.25,0,0,0,0,2026-07-29";',
        'var hq_str_hf_OIL="86.42,0,0,0,0,0,23:42:00,83.18,0,0,0,0,2026-07-29";',
      ].join('\n'));
    }
    throw new Error(`unexpected URL ${value}`);
  };
  try {
    const indices = await livePayload(new URL('https://example.com/markets/live?group=indices'));
    const oil = await livePayload(new URL('https://example.com/markets/live?group=oil'));
    const base = await livePayload(new URL('https://example.com/markets/live?group=base'));
    assert.deepEqual(Object.keys(indices.quotes).sort(), ['DOW', 'NASDAQ', 'SP500']);
    assert.deepEqual(Object.keys(oil.quotes).sort(), ['BRENT', 'WTI']);
    assert.deepEqual(Object.keys(base.quotes).sort(), [
      'BTC', 'DOGE', 'ETH', 'PALLADIUM', 'PLATINUM', 'SILVER', 'TRUMP', 'XAU',
    ]);
    assert.equal(base.quotes.BTC.usd, 64_000);
    assert.equal(base.quotes.BTC.value, 433_280);
    assert.equal(urls.filter((url) => url.includes('qt.gtimg.cn')).length, 1);
    assert.equal(urls.filter((url) => url.includes('hq.sinajs.cn')).length, 1);
    assert.equal(urls.some((url) => url.includes('/v8/finance/chart/')), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('top five sparklines use session live samples while the trend keeps historical series', async () => {
  const source = await readFile(new URL('../markets-home.js', import.meta.url), 'utf8');
  const focusStart = source.indexOf('function renderFocusCards()');
  const focusEnd = source.indexOf('function renderTrend()', focusStart);
  const focusRenderer = source.slice(focusStart, focusEnd);
  const trendStart = focusEnd;
  const trendEnd = source.indexOf('function renderMonitor()', trendStart);
  const trendRenderer = source.slice(trendStart, trendEnd);

  assert.match(source, /GOLD_REFRESH_MS = 1_000/);
  assert.match(source, /FAST_MARKET_REFRESH_MS = 3_000/);
  assert.match(source, /OIL_REFRESH_MS = 8_000/);
  assert.match(source, /BASE_MARKET_REFRESH_MS = 30_000/);
  assert.match(source, /api\(`\$\{API_ROOT\}\/live\?group=/);
  assert.match(source, /appendFocusLivePoint\("XAU", state\.quotes\.XAU\)/);
  assert.match(focusRenderer, /symbol === "DEBT" \? seriesFor\("DEBT", "1w"\) : focusLiveSeriesFor\(symbol\)/);
  assert.match(trendRenderer, /seriesFor\(symbol\)/);
});

test('financial charts keep live-session and historical-period semantics aligned with their visuals', async () => {
  const source = await readFile(new URL('../markets-home.js', import.meta.url), 'utf8');
  const markup = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const styles = await readFile(new URL('../markets-home.css', import.meta.url), 'utf8');
  const focusStart = source.indexOf('function renderFocusCards()');
  const focusEnd = source.indexOf('function drawTrendChart(', focusStart);
  const focusRenderer = source.slice(focusStart, focusEnd);
  const trendStart = source.indexOf('function renderTrend()');
  const trendEnd = source.indexOf('function renderMonitor()', trendStart);
  const trendRenderer = source.slice(trendStart, trendEnd);

  assert.match(source, /timeSpan > 0 \? \(point\.time - firstTime\) \/ timeSpan/);
  assert.match(source, /function focusWindowMetrics\(points\)/);
  assert.match(focusRenderer, /liveMetrics\.change/);
  assert.match(focusRenderer, /symbol === "DEBT" \? Number\(quote\.change \|\| 0\) : Number\(liveMetrics\.change \|\| 0\)/);
  assert.doesNotMatch(focusRenderer, /baseline:\s*true/);
  assert.match(source, /formatAxisValue:\s*\(value\) => formatSeriesValue/);
  assert.match(source, /function drawTrendChart\(\)[\s\S]*fillAlpha:\s*0\.28/);
  assert.match(source, /scaleValues:[\s\S]*point\.low[\s\S]*point\.high/);
  assert.doesNotMatch(source, /function updateTrendTooltip\(event\)/);
  assert.doesNotMatch(source, /addEventListener\("pointermove", updateTrendTooltip\)/);
  assert.doesNotMatch(source, /seededSeries/);
  assert.doesNotMatch(markup, /data-live-window|id="trend-open"|legend-baseline/);
  assert.doesNotMatch(styles, /touch-action:pan-y/);
  assert.match(styles, /--radius:8px/);
  assert.match(markup, /编辑摘要 · 非实时模型/);
});

test('cross-market history uses the Mac source matrix and returns source-specific series in one request', async () => {
  const originalFetch = globalThis.fetch;
  const urls = [];
  const worker = await readFile(new URL('../src/worker.js', import.meta.url), 'utf8');
  assert.match(worker, /'\/markets\/cross-history'/);
  globalThis.fetch = async (url) => {
    const value = String(url);
    urls.push(value);
    if (value.includes('web.ifzq.gtimg.cn')) {
      const symbol = decodeURIComponent(value).match(/param=([^,]+)/)?.[1];
      return Response.json({ data: {
        [symbol]: { day: [
          ['2026-07-28', '1', '100'],
          ['2026-07-29', '1', '101'],
        ] },
      } });
    }
    if (value.includes('query1.finance.yahoo.com')) {
      return Response.json({ chart: { result: [{
        timestamp: [1_785_196_800, 1_785_283_200],
        indicators: { quote: [{ close: [100, 101], high: [101, 102], low: [99, 100] }] },
      }] } });
    }
    if (value.includes('api.frankfurter.dev')) {
      return Response.json({ rates: {
        '2026-07-28': { CNY: 6.7, EUR: 0.8, GBP: 0.7, JPY: 145, KRW: 1_380, INR: 86 },
        '2026-07-29': { CNY: 6.8, EUR: 0.81, GBP: 0.71, JPY: 146, KRW: 1_381, INR: 87 },
      } });
    }
    if (value.includes('cbr.ru')) {
      return new Response([
        '<Record Date="28.07.2026"><Value>80,1</Value></Record>',
        '<Record Date="29.07.2026"><Value>80,2</Value></Record>',
      ].join(''));
    }
    if (value.includes('GlobalFuturesService')) {
      const symbol = new URL(value).searchParams.get('symbol');
      const base = { CL: 82, OIL: 86, GC: 4_000, XAU: 4_020, XAG: 52 }[symbol] || 10;
      return Response.json([
        { date: '2026-07-28', close: String(base) },
        { date: '2026-07-29', close: String(base + 1) },
      ]);
    }
    if (value.includes('InnerFuturesNewService')) {
      return Response.json([{ d: '2026-07-28', c: '880' }, { d: '2026-07-29', c: '881' }]);
    }
    if (value.includes('sge.com.cn')) return new Response('<html></html>');
    if (value.includes('data-api.binance.vision')) {
      return Response.json([
        [1_785_196_800_000, 0, 0, 0, '64000'],
        [1_785_283_200_000, 0, 0, 0, '65000'],
      ]);
    }
    if (value.includes('jgjc.ndrc.gov.cn')) return new Response('<html></html>');
    throw new Error(`unexpected URL ${value}`);
  };
  try {
    const payload = await crossHistoryPayload();
    assert.deepEqual(payload.histories.NASDAQ.map((point) => point.value), [100, 101]);
    assert.deepEqual(payload.histories.WTI.map((point) => point.value), [82, 83]);
    assert.deepEqual(payload.histories.USDCNY.map((point) => point.value), [6.7, 6.8]);
    assert.deepEqual(payload.histories.USDRUB.map((point) => point.value), [80.1, 80.2]);
    assert.deepEqual(payload.histories.SHANGHAI_FUTURES.map((point) => point.value), [880, 881]);
    assert.equal(payload.histories.SHUIBEI.length, 2);
    assert.equal(payload.histories.GOLD_SILVER.length, 2);
    assert.equal(payload.histories.KGBTC.length, 2);
    assert.ok(urls.some((url) => url.includes('Frankfurter') || url.includes('frankfurter')));
    assert.ok(urls.some((url) => url.includes('GlobalFuturesService')));
    assert.ok(urls.some((url) => url.includes('appstock/app/fqkline')));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('web poker keeps the Mac blind, side-pot and idempotent pending-settlement contracts', async () => {
  const source = await readFile(new URL('../markets-home.js', import.meta.url), 'utf8');

  assert.match(source, /pokerContribute\(smallBlind,\s*25\)/);
  assert.match(source, /pokerContribute\(bigBlind,\s*50\)/);
  assert.match(source, /function pokerSidePots\(\)/);
  assert.match(source, /lynncat-poker-pending/);
  assert.match(source, /localStorage\.removeItem\("lynncat-poker-pending"\)/);
});

test('web poker validates raise-to actions and pot presets through one Mac-compatible rule set', async () => {
  const [source, html] = await Promise.all([
    readFile(new URL('../markets-home.js', import.meta.url), 'utf8'),
    readFile(new URL('../index.html', import.meta.url), 'utf8'),
  ]);

  assert.match(html, /src="\/poker-rules\.js\?v=20260730k"/);
  assert.match(html, /加注至 \/ Raise to/);
  assert.match(html, /id="raise-max"[^>]*>上限 \/ Max/);
  assert.doesNotMatch(html, /id="raise-all-in"/);
  assert.match(source, /function pokerRaiseBounds\(player\)/);
  assert.match(source, /if \(raised && !raiseBounds\.canRaise\) return/);
  assert.match(source, /presetTarget\(fraction, pokerRaiseSituation\(player\)\)/);
  assert.match(source, /key === "r" && !\$\("#poker-raise"\)\.disabled/);
  assert.match(source, /state\.poker\.phase === "playing" \|\| state\.poker\.phase === "settling"/);
  assert.match(source, /\$\("#poker-deal"\)\.disabled = state\.poker\.phase === "playing"/);
  assert.doesNotMatch(source, /clamp\(Math\.round\(state\.poker\.pot/);
});

test('web poker keeps card slots stable and isolates seat and result presentation', async () => {
  const [source, html, css] = await Promise.all([
    readFile(new URL('../markets-home.js', import.meta.url), 'utf8'),
    readFile(new URL('../index.html', import.meta.url), 'utf8'),
    readFile(new URL('../markets-home.css', import.meta.url), 'utf8'),
  ]);

  assert.match(html, /class="seat-info"/);
  assert.match(html, /id="poker-result-panel"/);
  assert.match(html, /id="community-cards"[^>]*>(?:<span class="playing-card placeholder"[^>]*><\/span>){5}/);
  assert.match(css, /\.seat>\.seat-info/);
  assert.doesNotMatch(css, /\.seat span\{/);
  assert.match(css, /\.poker-controls\{[^}]*repeat\(4,minmax\(88px,120px\)\)/);
  assert.match(source, /player\.folded \|\| \(player\.id !== 0 && !revealOpponents\)/);
  assert.match(source, /\[data-seat="\$\{state\.poker\.dealer\}"\] \.seat-info/);
  assert.match(source, /while \(community\.length < 5\) community\.push\(pokerCardPlaceholderHTML\(\)\)/);
  assert.match(source, /seat\.classList\.toggle\("is-active", state\.poker\.phase === "playing" && player\.id === state\.poker\.actor\)/);
  assert.match(source, /function showPokerResult\(/);
});

test('shuihu draw booth defaults to a neutral card back until a draw or owned-card selection', async () => {
  const [source, html, css] = await Promise.all([
    readFile(new URL('../markets-home.js', import.meta.url), 'utf8'),
    readFile(new URL('../index.html', import.meta.url), 'utf8'),
    readFile(new URL('../markets-home.css', import.meta.url), 'utf8'),
  ]);

  assert.match(html, /id="featured-card"[^>]*>[\s\S]*?class="hero-card-back"/);
  assert.match(html, /HERO MUSTER · 108/);
  assert.match(css, /\.hero-card-back\{/);
  assert.match(source, /function renderFeaturedPlaceholder\(/);
  assert.match(source, /delete target\.dataset\.cardId/);
  assert.doesNotMatch(source, /ownedCards\.keys\(\)\]\.at\(-1\)/);
  assert.doesNotMatch(source, /dataset\.cardId \|\| [^;\n]*\|\| 4/);
});

test('web debt display converts dollars to 亿元 and never dates a fallback as current', async () => {
  const source = await readFile(new URL('../markets-home.js', import.meta.url), 'utf8');

  assert.match(source, /rawDollars \/ 1e8/);
  assert.match(source, /recordDate:\s*"2026-07-28"/);
  assert.match(source, /isStale:\s*true/);
  assert.match(source, /HISTORY_SYMBOLS\.filter\(\(symbol\) => symbol !== "DEBT"\)/);
  assert.match(source, /else if \(symbol === "DEBT"\) \{\s*renderDebtDetail/);
  assert.doesNotMatch(source, /dailyChangeBillions \|\| 215\.89/);
});

test('web gold display keeps XAU spot separate from COMEX futures and refreshes directly', async () => {
  const source = await readFile(new URL('../markets-home.js', import.meta.url), 'utf8');

  assert.match(source, /GOLD_PUBLIC_URL = "https:\/\/api\.gold-api\.com\/price\/XAU"/);
  assert.match(source, /\["COMEX_GOLD", "美国黄金报价", "GC · 新浪全球期货日线"\]/);
  assert.match(source, /SHUIBEI", "水贝现货黄金参考", "复用 Au99\.99 参考，并非独立采价"/);
  assert.match(source, /target === "USD" \? quote\.usd/);
  assert.match(source, /setInterval\(\(\) => \{[\s\S]*refreshGoldDirect\(true\)/);
  assert.match(source, /Gold API · XAU 现货 · 最近真实缓存/);
  assert.doesNotMatch(source, /XAU:\s*\{[^}]*updatedAt:\s*Date\.now\(\)/s);
});

test('China A-share ranking combines Shanghai and Shenzhen companies by total market cap', () => {
  const rows = Array.from({ length: 22 }, (_, index) => {
    const market = index % 2;
    return {
      f12: String(600000 + index).padStart(6, '0'),
      f13: market,
      f14: `公司 ${index + 1}`,
      f2: 10 + index,
      f3: index % 3 ? 1.25 : -0.5,
      f4: index % 3 ? 0.2 : -0.1,
      f20: (index + 1) * 1e11,
      f21: (index + 1) * 8e10,
    };
  }).reverse();
  const ranking = parseChinaMarketCapRanking({ data: { diff: rows } });

  assert.equal(ranking.length, 20);
  assert.equal(ranking[0].name, '公司 22');
  assert.equal(ranking[0].marketCapCny, 2.2e12);
  assert.ok(ranking.every((stock, index) => index === 0 || ranking[index - 1].marketCapCny >= stock.marketCapCny));
  assert.ok(ranking.some((stock) => stock.exchangeCode === 'SSE' && stock.symbol.startsWith('sh')));
  assert.ok(ranking.some((stock) => stock.exchangeCode === 'SZSE' && stock.symbol.startsWith('sz')));
});

test('Sina A-share ranking converts ten-thousand-yuan market caps and keeps both exchanges', () => {
  const ranking = parseSinaChinaMarketCapRanking([
    { symbol: 'sz300750', code: '300750', name: '宁德时代', trade: '520.12', pricechange: 3.2, changepercent: 0.62, mktcap: 180000000, nmc: 150000000 },
    { symbol: 'sh601398', code: '601398', name: '工商银行', trade: '8.15', pricechange: 0.2, changepercent: 2.516, mktcap: 290471099.52753, nmc: 219733953.21929 },
  ]);

  assert.equal(ranking.length, 2);
  assert.equal(ranking[0].ticker, '601398');
  assert.ok(Math.abs(ranking[0].marketCapCny - 2_904_710_995_275.3) < 1);
  assert.equal(ranking[0].exchangeCode, 'SSE');
  assert.equal(ranking[1].exchangeCode, 'SZSE');
});

test('China A-share detail returns two indices and 20 annual company trends', async () => {
  const originalFetch = globalThis.fetch;
  const rankingRows = Array.from({ length: 20 }, (_, index) => ({
    f12: String((index % 2 ? 300000 : 600000) + index).padStart(6, '0'),
    f13: index % 2,
    f14: `A股公司 ${index + 1}`,
    f2: 20 + index,
    f3: 0.5 + index / 10,
    f4: 0.2,
    f20: (20 - index) * 1e11,
    f21: (20 - index) * 8e10,
  }));
  const quoteLine = (symbol, name, value) => {
    const fields = Array(46).fill('');
    fields[1] = name;
    fields[3] = String(value);
    fields[31] = '8.5';
    fields[32] = '0.25';
    return `v_${symbol}="${fields.join('~')}";`;
  };
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes('push2.eastmoney.com')) {
      return new Response(JSON.stringify({ data: { diff: rankingRows } }), {
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url.includes('qt.gtimg.cn')) {
      return new Response([
        quoteLine('sh000001', '上证指数', 3800.5),
        quoteLine('sz399001', '深证成指', 12600.8),
      ].join('\n'));
    }
    if (url.includes('appstock/app/fqkline')) {
      const symbol = new URL(url).searchParams.get('param').split(',')[0];
      return new Response(JSON.stringify({
        data: {
          [symbol]: {
            qfqday: [
              ['2025-07-30', '10', '10.5', '10.8', '9.9', '100'],
              ['2026-01-30', '10.5', '11', '11.2', '10.4', '110'],
              ['2026-07-30', '11', '12', '12.1', '10.9', '120'],
            ],
          },
        },
      }), { headers: { 'Content-Type': 'application/json' } });
    }
    throw new Error(`Unexpected request: ${url}`);
  };

  try {
    const payload = await detailPayload(new URL('https://example.com/markets/details?symbol=CN_STOCKS'));
    assert.equal(payload.type, 'cn-stocks');
    assert.deepEqual(payload.indices.map((index) => index.symbol), ['SSE', 'SZSE']);
    assert.equal(payload.indices[0].value, 3800.5);
    assert.equal(payload.indices[1].value, 12600.8);
    assert.equal(payload.stocks.length, 20);
    assert.ok(payload.stocks.every((stock) => stock.history.length === 3));
    assert.ok(payload.stocks.every((stock, index) => index === 0 || payload.stocks[index - 1].marketCapCny >= stock.marketCapCny));
    assert.equal(payload.rankingScope, 'all-a-shares');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('homepage A-share monitor opens the dedicated responsive market detail', async () => {
  const [source, deployedSource, css] = await Promise.all([
    readFile(new URL('../markets-home.js', import.meta.url), 'utf8'),
    readFile(new URL('../markets-home-20260730k.js', import.meta.url), 'utf8'),
    readFile(new URL('../markets-home.css', import.meta.url), 'utf8'),
  ]);

  assert.equal(source, deployedSource);
  assert.match(source, /symbol === "SSE" \? "CN_STOCKS"/);
  assert.match(source, /data-monitor-detail="\$\{detailSymbol\}"/);
  assert.match(source, /details\?symbol=\$\{encodeURIComponent\(specialized\)\}/);
  assert.match(source, /function renderChinaStocksDetail\(/);
  assert.match(source, /上证指数/);
  assert.match(source, /深证成指/);
  assert.match(source, /沪深两市总市值前 20 家企业/);
  assert.match(source, /data-china-stock-chart/);
  assert.match(css, /\.monitor-row\.is-clickable/);
  assert.match(css, /\.cn-index-grid/);
  assert.match(css, /\.cn-stock-table/);
  assert.match(css, /\.cn-stock-spark/);
});

test('Hong Kong active-stock parser keeps only live five-digit HKEX symbols', () => {
  assert.deepEqual(parseSinaHongKongCandidates([
    { symbol: '00700', lasttrade: '471.8' },
    { symbol: '00005', lasttrade: '164.5' },
    { symbol: '1234', lasttrade: '8.1' },
    { symbol: '09988', lasttrade: '0' },
  ]), ['hk00700', 'hk00005']);
});

test('Hong Kong detail returns Hang Seng and 20 companies sorted by live market cap', async () => {
  const originalFetch = globalThis.fetch;
  const quoteLine = (symbol) => {
    const fields = Array(78).fill('');
    const ticker = symbol.slice(2);
    const isIndex = symbol === 'hkHSI';
    fields[1] = isIndex ? 'Hang Seng Index' : `HK Company ${ticker}`;
    fields[3] = isIndex ? '25858.88' : String(20 + Number(ticker.slice(-2)) / 10);
    fields[31] = '1.5';
    fields[32] = '0.75';
    fields[44] = isIndex ? '0' : String(50_000 - Number(ticker));
    fields[45] = isIndex ? '0' : String(60_000 - Number(ticker));
    return `v_${symbol}="${fields.join('~')}";`;
  };
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes('Market_Center.getHKStockData')) {
      return new Response(JSON.stringify([
        { symbol: '00700', lasttrade: '471.8' },
        { symbol: '09988', lasttrade: '111.8' },
        { symbol: '03690', lasttrade: '92.65' },
      ]), { headers: { 'Content-Type': 'application/json' } });
    }
    if (url.includes('qt.gtimg.cn')) {
      const symbols = url.split('q=')[1].split(',');
      return new Response(symbols.map(quoteLine).join('\n'));
    }
    if (url.includes('appstock/app/fqkline')) {
      const symbol = new URL(url).searchParams.get('param').split(',')[0];
      return new Response(JSON.stringify({
        data: {
          [symbol]: {
            qfqday: [
              ['2025-07-31', '10', '10.5', '10.8', '9.9', '100'],
              ['2026-01-30', '10.5', '11', '11.2', '10.4', '110'],
              ['2026-07-31', '11', '12', '12.1', '10.9', '120'],
            ],
          },
        },
      }), { headers: { 'Content-Type': 'application/json' } });
    }
    throw new Error(`Unexpected request: ${url}`);
  };

  try {
    const payload = await detailPayload(new URL('https://example.com/markets/details?symbol=HK_STOCKS'));
    assert.equal(payload.type, 'hk-stocks');
    assert.equal(payload.index.symbol, 'HSI');
    assert.equal(payload.index.value, 25858.88);
    assert.equal(payload.index.history.length, 3);
    assert.equal(payload.stocks.length, 20);
    assert.ok(payload.stocks.every((stock) => stock.history.length === 3));
    assert.ok(payload.stocks.every((stock, index) => index === 0 || payload.stocks[index - 1].marketCapHkd >= stock.marketCapHkd));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('homepage Hang Seng monitor opens the responsive Hong Kong market detail', async () => {
  const [source, deployedSource, css] = await Promise.all([
    readFile(new URL('../markets-home.js', import.meta.url), 'utf8'),
    readFile(new URL('../markets-home-20260730k.js', import.meta.url), 'utf8'),
    readFile(new URL('../markets-home.css', import.meta.url), 'utf8'),
  ]);

  assert.equal(source, deployedSource);
  assert.match(source, /data-monitor-detail="\$\{detailSymbol\}"/);
  assert.match(source, /symbol === "HSI" \? "HK_STOCKS"/);
  assert.match(source, /function renderHongKongStocksDetail\(/);
  assert.match(source, /香港恒生指数走势/);
  assert.match(source, /香港交易所总市值前 20 家企业/);
  assert.match(source, /data-hk-stock-chart/);
  assert.match(css, /\.hk-stock-table/);
  assert.match(css, /\.hk-stock-spark/);
  assert.match(css, /\.hk-index-detail-chart/);
});

test('country market-cap parser keeps local exchange tickers and maps listed ADR aliases', () => {
  const html = `
    <table><tbody>
      <tr><td class="name-td"><div class="company-name">Toyota</div><div class="company-code"><span>Ticker</span>TM</div></td><td class="td-right" data-sort="300000000000"></td></tr>
      <tr><td class="name-td"><div class="company-name">SoftBank Group</div><div class="company-code"><span>Ticker</span>9984.T</div></td><td class="td-right" data-sort="100000000000"></td></tr>
      <tr><td class="name-td"><div class="company-name">Foreign listing</div><div class="company-code"><span>Ticker</span>FOREIGN</div></td><td class="td-right" data-sort="90000000000"></td></tr>
    </tbody></table>`;
  const stocks = parseCountryMarketCapHtml(html, 'JP_STOCKS');

  assert.deepEqual(stocks.map((stock) => stock.symbol), ['7203.T', '9984.T']);
  assert.equal(stocks[0].marketCapUsd, 300000000000);
  assert.equal(stocks[0].exchangeCode, 'TSE');
});

test('regional market detail returns 20 ranked companies and ignores unfinished zero Yahoo bars', async () => {
  const originalFetch = globalThis.fetch;
  const rows = Array.from({ length: 20 }, (_, index) => {
    const ticker = `${7000 + index}.T`;
    const marketCap = 300_000_000_000 - index * 5_000_000_000;
    return `<tr><td class="name-td"><div class="company-name">Japan Company ${index + 1}</div><div class="company-code"><span>Ticker</span>${ticker}</div></td><td class="td-right" data-sort="${marketCap}"></td></tr>`;
  }).join('');
  globalThis.fetch = async (input) => {
    const url = String(input);
    if (url.includes('companiesmarketcap.com/japan/')) return new Response(`<table>${rows}</table>`);
    if (url.includes('query1.finance.yahoo.com/v8/finance/chart/')) {
      return Response.json({
        chart: {
          result: [{
            timestamp: [1, 2, 3],
            indicators: {
              quote: [{
                close: [100, 110, 0],
                high: [101, 111, 112],
                low: [99, 109, 0],
              }],
            },
          }],
        },
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  };

  try {
    const payload = await detailPayload(new URL('https://example.com/markets/details?symbol=JP_STOCKS'));
    assert.equal(payload.type, 'regional-stocks');
    assert.equal(payload.market, 'JP_STOCKS');
    assert.equal(payload.index.symbol, 'N225');
    assert.equal(payload.index.value, 110);
    assert.equal(payload.index.history.length, 2);
    assert.equal(payload.stocks.length, 20);
    assert.ok(payload.stocks.every((stock) => stock.history.length === 2));
    assert.ok(payload.stocks.every((stock, index) => index === 0 || payload.stocks[index - 1].marketCapUsd >= stock.marketCapUsd));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Japan Korea Taiwan and India monitors open responsive top-20 market pages', async () => {
  const [source, deployedSource, css] = await Promise.all([
    readFile(new URL('../markets-home.js', import.meta.url), 'utf8'),
    readFile(new URL('../markets-home-20260730k.js', import.meta.url), 'utf8'),
    readFile(new URL('../markets-home.css', import.meta.url), 'utf8'),
  ]);

  assert.equal(source, deployedSource);
  assert.match(source, /symbol === "N225" \? "JP_STOCKS"/);
  assert.match(source, /symbol === "KOSPI" \? "KR_STOCKS"/);
  assert.match(source, /symbol === "TWII" \? "TW_STOCKS"/);
  assert.match(source, /symbol === "NIFTY" \? "IN_STOCKS"/);
  assert.match(source, /function renderRegionalStocksDetail\(/);
  assert.match(source, /市值前 20 家企业/);
  assert.match(source, /data-regional-stock-chart/);
  assert.match(css, /\.regional-stock-table/);
  assert.match(css, /\.regional-stock-spark/);
  assert.match(css, /\.regional-index-detail-chart/);
});
