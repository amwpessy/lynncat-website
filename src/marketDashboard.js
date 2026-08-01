const JSON_HEADERS = {
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Cache-Control': 'public, max-age=60, s-maxage=180',
};

const CORE_SYMBOLS = {
  XAU: 'GC=F',
  DOW: '^DJI',
  SP500: '^GSPC',
  NASDAQ: '^IXIC',
  BTC: 'BTC-USD',
  ETH: 'ETH-USD',
  DOGE: 'DOGE-USD',
  TRUMP: 'TRUMP-USD',
  WTI: 'CL=F',
  SSE: '000001.SS',
  HSI: '^HSI',
  N225: '^N225',
  KOSPI: '^KS11',
  TWII: '^TWII',
  NIFTY: '^NSEI',
  BRENT: 'BZ=F',
  NATGAS: 'NG=F',
  RBOB: 'RB=F',
  SILVER: 'SI=F',
  PLATINUM: 'PL=F',
  PALLADIUM: 'PA=F',
};

const GOLD_API_BASE_URL = 'https://api.gold-api.com/price';
const GOLD_API_ASSETS = {
  XAU: 'XAU',
  SILVER: 'XAG',
  PLATINUM: 'XPT',
  PALLADIUM: 'XPD',
  BTC: 'BTC',
  ETH: 'ETH',
};
const BINANCE_SYMBOLS = { DOGE: 'DOGEUSDT', TRUMP: 'TRUMPUSDT' };
const TENCENT_INDEX_SYMBOLS = ['us.DJI', 'us.IXIC', 'us.INX'];
const TROY_OUNCE_GRAMS = 31.1034768;

const US_STOCKS = [
  'AAPL', 'MSFT', 'NVDA', 'GOOGL', 'AMZN', 'META', 'TSLA', 'AMD', 'TSM', 'AVGO',
  'LLY', 'JPM', 'V', 'WMT', 'UNH', 'XOM', 'NFLX', 'DIS', 'BA', 'INTC',
];

const CN_INDEXES = [
  { symbol: 'SSE', marketSymbol: 'sh000001', name: '上证指数', exchange: '上交所' },
  { symbol: 'SZSE', marketSymbol: 'sz399001', name: '深证成指', exchange: '深交所' },
];

const CN_STOCK_FALLBACK_SYMBOLS = [
  'sh601398', 'sh601939', 'sh601288', 'sh600941', 'sh601857',
  'sh601988', 'sh600519', 'sh601628', 'sh601088', 'sh601318',
  'sz300750', 'sh600036', 'sh601166', 'sz000858', 'sh601328',
  'sh601899', 'sz002594', 'sh600030', 'sh600028', 'sz000333',
];

const CN_MARKET_CAP_URL =
  'https://push2.eastmoney.com/api/qt/clist/get?pn=1&pz=20&po=1&np=1&fltt=2&invt=2&fid=f20'
  + '&fs=m%3A0%2Bt%3A6%2Cm%3A0%2Bt%3A80%2Cm%3A1%2Bt%3A2%2Cm%3A1%2Bt%3A23'
  + '&fields=f12%2Cf13%2Cf14%2Cf2%2Cf3%2Cf4%2Cf20%2Cf21';
const CN_SINA_MARKET_CAP_URL =
  'https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHQNodeData'
  + '?page=1&num=20&sort=mktcap&asc=0&node=hs_a&symbol=&_s_r_a=page';
const HK_INDEX = { symbol: 'HSI', marketSymbol: 'hkHSI', name: '香港恒生指数', exchange: '香港交易所' };
const HK_ACTIVE_STOCKS_URL =
  'https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/Market_Center.getHKStockData'
  + '?page=1&num=60&sort=amount&asc=0&node=qbgg_hk&_s_r_a=page';
const HK_LARGE_CAP_SYMBOLS = [
  '00005', '01299', '00939', '01398', '00388', '02318', '03988', '02628', '03968', '02388',
  '01288', '03328', '01658', '02888', '03360', '00700', '01810', '00981', '09999', '00992',
  '00285', '09988', '03690', '01211', '01024', '09992', '09888', '00669', '09618', '02020',
  '00175', '09961', '02015', '09633', '00027', '00288', '00066', '06690', '00300', '02319',
  '02313', '02331', '06181', '01928', '00291', '09901', '06862', '01929', '00322', '01044',
  '01876', '00883', '02899', '00857', '00001', '01088', '01378', '00386', '03993', '02057',
  '00267', '03750', '02382', '02618', '00868', '00316', '00968', '00941', '00728', '02688',
  '00762', '01038', '00836', '01519', '02600', '06160', '03692', '09926', '01093', '02269',
  '02359', '00241', '00016', '00002', '00003', '00006', '00012', '01109', '01997', '00823',
  '01113', '00017', '00019', '00023', '00101', '00688', '00960', '01177', '01833', '01918',
  '01988', '02328', '02601', '06030', '06818', '09660', '02423', '06618', '09626', '09868',
].map((ticker) => `hk${ticker}`);
const REGIONAL_MARKETS = {
  JP_STOCKS: {
    symbol: 'JP_STOCKS',
    routeSymbol: 'N225',
    countrySlug: 'japan',
    name: '日本股票市场',
    indexName: '日经 225 指数',
    indexYahooSymbol: '^N225',
    exchange: '东京证券交易所',
    exchangeCode: 'TSE',
    currency: 'JPY',
    currencySymbol: '¥',
    suffix: '.T',
    aliases: {
      MUFG: '8306.T', TM: '7203.T', SMFG: '8316.T', SONY: '6758.T',
      MFG: '8411.T', TAK: '4502.T', HMC: '7267.T', NMR: '8604.T',
    },
    fallback: [
      ['8306.T', 'Mitsubishi UFJ Financial', 252658335744], ['7203.T', 'Toyota', 226708799488],
      ['9984.T', 'SoftBank Group', 165203797828], ['8316.T', 'Sumitomo Mitsui Financial', 163884269568],
      ['9983.T', 'Fast Retailing', 151075649973], ['8035.T', 'Tokyo Electron', 148963122051],
      ['6501.T', 'Hitachi', 147800403708], ['285A.T', 'Kioxia Holdings', 135573295543],
      ['6758.T', 'Sony', 134156386304], ['6857.T', 'Advantest', 126842378935],
      ['8411.T', 'Mizuho Financial', 124928393216], ['6861.T', 'Keyence', 120120225671],
      ['6098.T', 'Recruit Holdings', 112767606244], ['8058.T', 'Mitsubishi Corporation', 109701197866],
      ['8766.T', 'Tokio Marine', 97727726951], ['8001.T', 'Itochu', 88709928706],
      ['8031.T', 'Mitsui & Co.', 87456289758], ['9432.T', 'NTT', 81197900632],
      ['7011.T', 'Mitsubishi Heavy Industries', 78735481285], ['2914.T', 'Japan Tobacco', 74213560623],
    ],
  },
  KR_STOCKS: {
    symbol: 'KR_STOCKS',
    routeSymbol: 'KOSPI',
    countrySlug: 'south-korea',
    name: '韩国股票市场',
    indexName: '韩国综合指数',
    indexYahooSymbol: '^KS11',
    exchange: '韩国交易所',
    exchangeCode: 'KRX',
    currency: 'KRW',
    currencySymbol: '₩',
    suffix: '.KS',
    aliases: {
      KB: '105560.KS', SHG: '055550.KS', WF: '316140.KS',
      PKX: '005490.KS', KEP: '015760.KS',
    },
    fallback: [
      ['005930.KS', 'Samsung Electronics', 957656601570], ['000660.KS', 'SK Hynix', 661153605816],
      ['402340.KS', 'SK Square', 74197875199], ['005380.KS', 'Hyundai Motor', 64749228688],
      ['373220.KS', 'LG Energy Solution', 52755430600], ['207940.KS', 'Samsung Biologics', 49800818880],
      ['105560.KS', 'KB Financial', 42152042496], ['055550.KS', 'Shinhan Financial', 33897476096],
      ['028260.KS', 'Samsung C&T', 33894191843], ['032830.KS', 'Samsung Life Insurance', 33400318444],
      ['329180.KS', 'HD Hyundai Heavy Industries', 33120013597], ['000270.KS', 'Kia', 33077576477],
      ['012450.KS', 'Hanwha Aerospace', 31353972203], ['068270.KS', 'Celltrion', 30698027480],
      ['012330.KS', 'Hyundai Mobis', 27959643835], ['034020.KS', 'Doosan Enerbility', 27107464738],
      ['086790.KS', 'Hana Financial', 23550666117], ['035420.KS', 'Naver', 20518242668],
      ['000810.KS', 'Samsung Fire & Marine', 19231467982], ['066570.KS', 'LG Electronics', 18726968312],
    ],
  },
  TW_STOCKS: {
    symbol: 'TW_STOCKS',
    routeSymbol: 'TWII',
    countrySlug: 'taiwan',
    name: '台湾股票市场',
    indexName: '台湾加权指数',
    indexYahooSymbol: '^TWII',
    exchange: '台湾证券交易所',
    exchangeCode: 'TWSE',
    currency: 'TWD',
    currencySymbol: 'NT$',
    suffix: '.TW',
    aliases: { TSM: '2330.TW', ASX: '3711.TW', UMC: '2303.TW', CHT: '2412.TW' },
    fallback: [
      ['2330.TW', 'TSMC', 2091964301312], ['2454.TW', 'MediaTek', 159561687018],
      ['2308.TW', 'Delta Electronics', 122813392369], ['2317.TW', 'Hon Hai Precision', 99302859117],
      ['6669.TW', 'Wiwynn', 84420873230], ['3711.TW', 'ASE Technology', 76042379264],
      ['2881.TW', 'Fubon Financial', 52365559608], ['2303.TW', 'United Microelectronics', 47312596992],
      ['2882.TW', 'Cathay Financial', 43155398480], ['2891.TW', 'CTBC Financial', 38368734999],
      ['1303.TW', 'Nan Ya Plastics', 35536749514], ['3037.TW', 'Unimicron', 34829677654],
      ['2345.TW', 'Accton Technology', 33420489638], ['2382.TW', 'Quanta Computer', 33232711585],
      ['2412.TW', 'Chunghwa Telecom', 33023526912], ['2408.TW', 'Nanya Technology', 31407598826],
      ['2327.TW', 'Yageo', 29042350760], ['2885.TW', 'Yuanta Financial', 25994916691],
      ['2887.TW', 'Taishin Financial', 25728068119], ['2360.TW', 'Chroma ATE', 25001827587],
    ],
  },
  IN_STOCKS: {
    symbol: 'IN_STOCKS',
    routeSymbol: 'NIFTY',
    countrySlug: 'india',
    name: '印度股票市场',
    indexName: '印度 NIFTY 50 指数',
    indexYahooSymbol: '^NSEI',
    exchange: '印度国家证券交易所',
    exchangeCode: 'NSE',
    currency: 'INR',
    currencySymbol: '₹',
    suffix: '.NS',
    aliases: {
      HDB: 'HDFCBANK.NS', IBN: 'ICICIBANK.NS', INFY: 'INFY.NS', 'AXISBANK.BO': 'AXISBANK.NS',
    },
    fallback: [
      ['RELIANCE.NS', 'Reliance Industries', 182880042562], ['BHARTIARTL.NS', 'Bharti Airtel', 127603284099],
      ['HDFCBANK.NS', 'HDFC Bank', 124061777920], ['ICICIBANK.NS', 'ICICI Bank', 107832287232],
      ['SBIN.NS', 'State Bank of India', 98924976558], ['TCS.NS', 'Tata Consultancy Services', 91966813730],
      ['BAJFINANCE.NS', 'Bajaj Finance', 68470085090], ['LT.NS', 'Larsen & Toubro', 56629538805],
      ['HINDUNILVR.NS', 'Hindustan Unilever', 51768615700], ['SUNPHARMA.NS', 'Sun Pharmaceutical', 50186150409],
      ['INFY.NS', 'Infosys', 48399380480], ['MARUTI.NS', 'Maruti Suzuki', 46626357029],
      ['ADANIENT.NS', 'Adani Enterprises', 45351608850], ['TITAN.NS', 'Titan Company', 44968846269],
      ['ADANIPOWER.NS', 'Adani Power', 42123160340], ['M&M.NS', 'Mahindra & Mahindra', 41213997144],
      ['KOTAKBANK.NS', 'Kotak Mahindra Bank', 40484515071], ['ADANIPORTS.NS', 'Adani Ports', 40075450408],
      ['AXISBANK.NS', 'Axis Bank', 39964463234], ['HCLTECH.NS', 'HCL Technologies', 38257452825],
    ],
  },
};

const GOLD_RESERVES = [
  ['2025-06', 7390], ['2025-07', 7395], ['2025-08', 7400], ['2025-09', 7406],
  ['2025-10', 7409], ['2025-11', 7412], ['2025-12', 7415], ['2026-01', 7419],
  ['2026-02', 7422], ['2026-03', 7438], ['2026-04', 7464], ['2026-05', 7496],
  ['2026-06', 7544],
].map(([month, totalWanOz]) => ({ month, totalWanOz }));

const DEBT_MILESTONES = [
  [39, '2026-03-20', 153], [38, '2025-10-18', 220], [37, '2025-03-12', 110],
  [36, '2024-11-22', 119], [35, '2024-07-26', 204], [34, '2024-01-04', 111],
  [33, '2023-09-15', 92], [32, '2023-06-15', 143], [31, '2023-01-23', 110],
].map(([trillion, date, days]) => ({ trillion, date, days }));

const DEBT_DATA_URL = 'https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v2/accounting/od/debt_to_penny?sort=-record_date&page%5Bnumber%5D=1&page%5Bsize%5D=400&fields=record_date%2Ctot_pub_debt_out_amt';
const DEBT_CACHE_URL = 'https://lynncat.com/__internal/markets/debt-to-penny-v3';
const DEBT_CACHE_FRESH_MS = 5 * 60_000;

const PERIODS = {
  '1d': { range: '1y', interval: '1d' },
  '1w': { range: '1y', interval: '1d' },
  '1m': { range: '1y', interval: '1d' },
  '1y': { range: '1y', interval: '1d' },
};

const TENCENT_HISTORY_SYMBOLS = {
  NASDAQ: 'us.IXIC',
  SSE: 'sh000001',
  HSI: 'hkHSI',
};

const SINA_GLOBAL_HISTORY_SYMBOLS = {
  WTI: 'CL',
  BRENT: 'OIL',
  COMEX_GOLD: 'GC',
  LONDON_GOLD: 'XAU',
  SILVER_CROSS: 'XAG',
};

const FRANKFURTER_SYMBOLS = {
  USDCNY: 'CNY',
  USDEUR: 'EUR',
  USDGBP: 'GBP',
  USDJPY: 'JPY',
  USDKRW: 'KRW',
  USDINR: 'INR',
};

const TECH_FEEDS = [
  { source: '量子位', category: 'AI', url: 'https://www.qbitai.com/feed' },
  { source: '爱范儿', category: '科技', url: 'https://www.ifanr.com/feed' },
  { source: 'Solidot', category: '深科技', url: 'https://www.solidot.org/index.rss' },
  { source: 'MIT Technology Review', category: 'Deep Tech', url: 'https://www.technologyreview.com/feed/' },
  { source: 'WIRED', category: 'Technology', url: 'https://www.wired.com/feed/rss' },
];

const CURRENT_FEEDS = [
  { source: 'FT中文网', category: '财经时事', url: 'https://www.ftchinese.com/rss/news' },
  { source: 'FT中文网', category: '财经时事', url: 'https://www.ftchinese.com/rss/feed' },
  { source: 'Reuters', category: 'World', url: 'https://www.reutersagency.com/feed/?best-topics=political-general&post_type=best' },
  { source: 'Al Jazeera English', category: 'World', url: 'https://www.aljazeera.com/xml/rss/all.xml' },
];

export async function handleMarketPublicData(request) {
  const url = new URL(request.url);
  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        ...JSON_HEADERS,
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  }
  if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);

  try {
    if (url.pathname === '/markets/dashboard') {
      return json(await dashboardPayload(), 200, { 'Cache-Control': 'no-store' });
    }
    if (url.pathname === '/markets/live') {
      return json(await livePayload(url), 200, { 'Cache-Control': 'no-store' });
    }
    if (url.pathname === '/markets/history') return json(await historyPayload(url));
    if (url.pathname === '/markets/cross-history') return json(await crossHistoryPayload());
    if (url.pathname === '/markets/news') return json(await newsPayload(url));
    if (url.pathname === '/markets/events') {
      const days = Math.min(45, Math.max(1, Number.parseInt(url.searchParams.get('days') || '6', 10) || 6));
      return json({ events: await fetchEconomicEvents(days) });
    }
    if (url.pathname === '/markets/details') return json(await detailPayload(url));
    return json({ error: 'route_not_found' }, 404);
  } catch (error) {
    if (typeof error?.code === 'string' && Number.isInteger(error?.status)) {
      return json({ error: error.code }, error.status);
    }
    console.error('market_public_data_failed', {
      pathname: url.pathname,
      message: String(error?.message || error).slice(0, 240),
    });
    return json({ error: 'market_data_unavailable' }, 502);
  }
}

export async function dashboardPayload() {
  const yahooEntries = Object.entries(CORE_SYMBOLS).filter(([symbol]) => ![
    'XAU', 'DOW', 'SP500', 'NASDAQ', 'BTC', 'ETH', 'DOGE', 'TRUMP',
    'WTI', 'BRENT', 'SILVER', 'PLATINUM', 'PALLADIUM',
  ].includes(symbol));
  const dashboardYahooEntries = [['COMEX_GOLD', CORE_SYMBOLS.XAU], ...yahooEntries];
  const [
    ratesResult,
    debtResult,
    eventsResult,
    goldResults,
    binanceResults,
    tencentResult,
    oilResult,
    ...quoteResults
  ] = await Promise.allSettled([
    fetchRates(),
    fetchDebtLatest(4_000, false),
    fetchEconomicEvents(2),
    Promise.allSettled(Object.entries(GOLD_API_ASSETS).map(async ([symbol, apiSymbol]) => [
      symbol,
      await fetchGoldApiQuote(apiSymbol),
    ])),
    Promise.allSettled(Object.entries(BINANCE_SYMBOLS).map(async ([symbol, marketSymbol]) => [
      symbol,
      await fetchBinanceTicker(symbol, marketSymbol),
    ])),
    fetchTencentQuotes(TENCENT_INDEX_SYMBOLS),
    fetchSinaOilQuotes(),
    ...dashboardYahooEntries.map(async ([symbol, yahooSymbol]) => [
      symbol,
      await fetchYahooQuote(yahooSymbol),
    ]),
  ]);
  const rates = ratesResult.status === 'fulfilled'
    ? ratesResult.value
    : { USD: 1, CNY: 6.78, HKD: 7.81 };
  const quotes = {};

  for (const result of quoteResults) {
    if (result.status !== 'fulfilled') continue;
    const [symbol, quote] = result.value;
    quotes[symbol] = normalizeQuote(symbol, quote, rates);
  }
  if (goldResults.status === 'fulfilled') {
    for (const result of goldResults.value) {
      if (result.status !== 'fulfilled') continue;
      const [symbol, quote] = result.value;
      quotes[symbol] = normalizeQuote(symbol, quote, rates);
    }
  }
  if (binanceResults.status === 'fulfilled') {
    for (const result of binanceResults.value) {
      if (result.status !== 'fulfilled') continue;
      const [symbol, quote] = result.value;
      quotes[symbol] = normalizeQuote(symbol, quote, rates);
    }
  }
  if (tencentResult.status === 'fulfilled') {
    for (const quote of tencentResult.value) {
      const symbol = { 'us.DJI': 'DOW', 'us.IXIC': 'NASDAQ', 'us.INX': 'SP500' }[quote.symbol];
      if (symbol) quotes[symbol] = quote;
    }
  }
  if (oilResult.status === 'fulfilled') {
    for (const quote of oilResult.value) quotes[quote.symbol] = quote;
  }
  if (debtResult.status === 'fulfilled') quotes.DEBT = debtResult.value;
  addDerivedQuotes(quotes, rates);

  return {
    quotes,
    rates,
    events: eventsResult.status === 'fulfilled' ? eventsResult.value : [],
    goldReserves: GOLD_RESERVES,
    updatedAt: Date.now(),
  };
}

export async function livePayload(url = null) {
  const group = url?.searchParams?.get('group') || 'all';
  const includeIndices = group === 'all' || group === 'fast' || group === 'indices';
  const includeOil = group === 'all' || group === 'fast' || group === 'oil';
  const includeBase = group === 'all' || group === 'base';
  const [ratesResult, goldResults, binanceResults, tencentResult, oilResult] = await Promise.allSettled([
    includeBase ? fetchRates() : Promise.resolve({ USD: 1 }),
    includeBase
      ? Promise.allSettled(Object.entries(GOLD_API_ASSETS).map(async ([symbol, apiSymbol]) => [
          symbol,
          await fetchGoldApiQuote(apiSymbol),
        ]))
      : Promise.resolve([]),
    includeBase
      ? Promise.allSettled(Object.entries(BINANCE_SYMBOLS).map(async ([symbol, marketSymbol]) => [
          symbol,
          await fetchBinanceTicker(symbol, marketSymbol),
        ]))
      : Promise.resolve([]),
    includeIndices ? fetchTencentQuotes(TENCENT_INDEX_SYMBOLS) : Promise.resolve([]),
    includeOil ? fetchSinaOilQuotes() : Promise.resolve([]),
  ]);
  const rates = ratesResult.status === 'fulfilled'
    ? ratesResult.value
    : { USD: 1, CNY: 6.78, HKD: 7.81 };
  const quotes = {};
  if (goldResults.status === 'fulfilled') {
    for (const result of goldResults.value) {
      if (result.status !== 'fulfilled') continue;
      const [symbol, quote] = result.value;
      quotes[symbol] = normalizeQuote(symbol, quote, rates);
    }
  }
  if (binanceResults.status === 'fulfilled') {
    for (const result of binanceResults.value) {
      if (result.status !== 'fulfilled') continue;
      const [symbol, quote] = result.value;
      quotes[symbol] = normalizeQuote(symbol, quote, rates);
    }
  }
  if (tencentResult.status === 'fulfilled') {
    for (const quote of tencentResult.value) {
      const symbol = { 'us.DJI': 'DOW', 'us.IXIC': 'NASDAQ', 'us.INX': 'SP500' }[quote.symbol];
      if (symbol) quotes[symbol] = quote;
    }
  }
  if (oilResult.status === 'fulfilled') {
    for (const quote of oilResult.value) quotes[quote.symbol] = quote;
  }
  return { quotes, rates, updatedAt: Date.now() };
}

export async function detailPayload(url) {
  const symbol = String(url.searchParams.get('symbol') || '').toUpperCase();
  if (symbol === 'CN_STOCKS' || symbol === 'SSE' || symbol === 'A_SHARES') {
    return fetchChinaStockMarketDetail();
  }
  if (symbol === 'HK_STOCKS' || symbol === 'HSI' || symbol === 'H_SHARES') {
    return fetchHongKongStockMarketDetail();
  }
  const regionalConfig = REGIONAL_MARKETS[symbol]
    || Object.values(REGIONAL_MARKETS).find((market) => market.routeSymbol === symbol);
  if (regionalConfig) return fetchRegionalStockMarketDetail(regionalConfig);
  if (symbol === 'US_STOCKS' || symbol === 'NASDAQ') {
    const tencent = await fetchTencentQuotes([
      ...TENCENT_INDEX_SYMBOLS,
      ...US_STOCKS.map((ticker) => `us${ticker}`),
    ]);
    const indexHistory = await Promise.allSettled(['DOW', 'NASDAQ', 'SP500'].map(async (key) => [
      key,
      await fetchYahooHistory(CORE_SYMBOLS[key], { range: '10y', interval: '1d' }),
    ]));
    const historyBySymbol = Object.fromEntries(indexHistory.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []));
    const indexKey = { 'us.DJI': 'DOW', 'us.IXIC': 'NASDAQ', 'us.INX': 'SP500' };
    const indices = tencent
      .filter((quote) => indexKey[quote.symbol])
      .map((quote) => ({
        ...quote,
        symbol: indexKey[quote.symbol],
        history: historyBySymbol[indexKey[quote.symbol]] || [],
      }));
    const stocks = tencent
      .filter((quote) => quote.symbol.startsWith('us') && !indexKey[quote.symbol])
      .sort((left, right) => right.marketCapBillion - left.marketCapBillion);
    const sp500Change = indices.find((quote) => quote.symbol === 'SP500')?.change || 0;
    return {
      type: 'us-stocks',
      indices,
      stocks,
      marketCap: 64_000_000_000_000 * (1 + sp500Change / 100),
      marketCapIsEstimate: true,
      updatedAt: Date.now(),
    };
  }
  if (symbol === 'DEBT' || symbol === 'US_DEBT') {
    let points = [];
    let quote = null;
    try {
      const snapshot = await fetchDebtDataset();
      points = debtHistoryFromRows(snapshot.rows);
      const latest = snapshot.rows[0].totalDebt;
      const previous = snapshot.rows[1]?.totalDebt ?? latest;
      quote = {
        value: latest / 1e12,
        change: previous ? (latest / previous - 1) * 100 : 0,
        dailyChangeUSD: latest - previous,
        dailyChangeBillions: (latest - previous) / 1e9,
        recordDate: snapshot.rows[0].recordDate,
        updatedAt: Date.parse(`${snapshot.rows[0].recordDate}T00:00:00Z`),
        isStale: snapshot.isStale,
        source: '美国财政部 Fiscal Data',
      };
    } catch {
      // Keep the detail contract available when Fiscal Data is temporarily unavailable.
    }
    const changes = points.map((point) => ({ ...point, delta: point.dailyChangeUSD }));
    const positive = changes.filter((item) => item.delta > 0);
    return {
      type: 'debt',
      quote,
      points,
      averagePositiveDailyIncrease: positive.length
        ? positive.reduce((sum, item) => sum + item.delta, 0) / positive.length : 0,
      maximumDailyIncrease: positive.reduce((max, item) => item.delta > max.delta ? item : max, { delta: 0 }),
      milestones: DEBT_MILESTONES,
      updatedAt: Date.now(),
    };
  }
  if (symbol === 'OIL' || symbol === 'WTI') {
    let live = [];
    try {
      live = await fetchSinaOilQuotes();
    } catch {
      // Yahoo remains the detail fallback when Sina is temporarily unavailable.
    }
    const entries = live.length ? [] : await Promise.allSettled(['WTI', 'BRENT'].map(async (key) => ({
      symbol: key,
      ...await fetchYahooQuote(CORE_SYMBOLS[key]),
    })));
    return {
      type: 'oil',
      quotes: live.length ? live : entries.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []),
      updatedAt: Date.now(),
    };
  }
  if (symbol === 'XAU') {
    const [goldResult, ratesResult, historyResult] = await Promise.all([
      Promise.resolve().then(fetchGoldApiQuote).then(
        (value) => ({ status: 'fulfilled', value }),
        (reason) => ({ status: 'rejected', reason }),
      ),
      Promise.resolve().then(fetchRates).then(
        (value) => ({ status: 'fulfilled', value }),
        (reason) => ({ status: 'rejected', reason }),
      ),
      Promise.resolve().then(() => fetchSinaHistory('XAU', false, 3_700)).then(
        (value) => ({ status: 'fulfilled', value }),
        (reason) => ({ status: 'rejected', reason }),
      ),
    ]);
    const rates = ratesResult.status === 'fulfilled'
      ? ratesResult.value
      : { USD: 1, CNY: 6.78, HKD: 7.81 };
    return {
      type: 'gold',
      quote: goldResult.status === 'fulfilled'
        ? normalizeQuote('XAU', goldResult.value, rates)
        : null,
      history: historyResult.status === 'fulfilled' ? historyResult.value : [],
      reserves: GOLD_RESERVES,
      reserveDataAsOf: '2026-06',
      updatedAt: Date.now(),
    };
  }
  throw Object.assign(new Error('unsupported_symbol'), { code: 'unsupported_symbol', status: 400 });
}

export async function historyPayload(url) {
  const symbol = String(url.searchParams.get('symbol') || '').toUpperCase();
  const period = PERIODS[url.searchParams.get('period')] || PERIODS['1m'];
  if (symbol === 'DEBT') return { symbol, points: await fetchDebtHistory() };
  const yahooSymbol = symbol === 'COMEX_GOLD' ? CORE_SYMBOLS.XAU : CORE_SYMBOLS[symbol];
  if (!yahooSymbol) return jsonError('unsupported_symbol', 400);

  const [points, rates] = await Promise.all([
    ['SILVER', 'PLATINUM', 'PALLADIUM'].includes(symbol)
      ? fetchSinaHistory({ SILVER: 'XAG', PLATINUM: 'XPT', PALLADIUM: 'XPD' }[symbol])
      : fetchYahooHistory(yahooSymbol, period),
    (symbol === 'XAU' || ['SILVER', 'PLATINUM', 'PALLADIUM', 'BTC', 'ETH', 'DOGE', 'TRUMP'].includes(symbol))
      ? fetchRates() : Promise.resolve({ USD: 1 }),
  ]);
  return {
    symbol,
    points: points.map((point) => ({
      time: point.time,
      value: convertHistoricalValue(symbol, point.value, rates),
      high: convertHistoricalValue(symbol, point.high ?? point.value, rates),
      low: convertHistoricalValue(symbol, point.low ?? point.value, rates),
    })),
  };
}

export async function crossHistoryPayload() {
  const yahooSymbols = {
    N225: '^N225',
    KOSPI: '^KS11',
    TWII: '^TWII',
    NIFTY: '^NSEI',
    RBOB: 'RB=F',
  };
  const [
    tencentResults,
    yahooResults,
    frankfurterResult,
    cbrResult,
    sinaResults,
    shanghaiFuturesResult,
    sgeResult,
    bitcoinResult,
    chinaRetailResult,
  ] = await Promise.all([
    Promise.allSettled(Object.entries(TENCENT_HISTORY_SYMBOLS).map(async ([symbol, marketSymbol]) => [
      symbol, await fetchTencentHistory(marketSymbol),
    ])),
    Promise.allSettled(Object.entries(yahooSymbols).map(async ([symbol, marketSymbol]) => [
      symbol, await fetchYahooHistory(marketSymbol, PERIODS['1y']),
    ])),
    Promise.resolve().then(fetchFrankfurterHistory).catch(() => ({})),
    Promise.resolve().then(fetchCbrHistory).catch(() => []),
    Promise.allSettled(Object.entries(SINA_GLOBAL_HISTORY_SYMBOLS).map(async ([symbol, marketSymbol]) => [
      symbol, await fetchSinaHistory(marketSymbol),
    ])),
    Promise.resolve().then(() => fetchSinaHistory('AU0', true)).catch(() => []),
    Promise.resolve().then(fetchSgeSpotHistory).catch(() => []),
    Promise.resolve().then(fetchBinanceBtcHistory).catch(() => []),
    Promise.resolve().then(fetchChinaRetailHistory).catch(() => ({})),
  ]);

  const histories = {};
  for (const result of [...tencentResults, ...yahooResults, ...sinaResults]) {
    if (result.status === 'fulfilled' && result.value[1].length >= 2) {
      histories[result.value[0]] = result.value[1];
    }
  }
  for (const [symbol, currency] of Object.entries(FRANKFURTER_SYMBOLS)) {
    if (frankfurterResult[currency]?.length >= 2) histories[symbol] = frankfurterResult[currency];
  }
  if (cbrResult.length >= 2) histories.USDRUB = cbrResult;
  if (shanghaiFuturesResult.length >= 2) histories.SHANGHAI_FUTURES = shanghaiFuturesResult;
  Object.assign(histories, chinaRetailResult);

  const london = histories.LONDON_GOLD || [];
  const silver = histories.SILVER_CROSS || [];
  delete histories.SILVER_CROSS;
  const cny = frankfurterResult.CNY || [];
  const convertedSpot = alignAndMap(london, cny, (gold, rate) => gold * rate / TROY_OUNCE_GRAMS);
  const shanghaiSpot = mergePreferredHistory(sgeResult, convertedSpot);
  if (shanghaiSpot.length >= 2) {
    histories.SHANGHAI_SPOT = shanghaiSpot;
    histories.SHUIBEI = shanghaiSpot;
  }
  const goldSilver = alignAndMap(london, silver, (gold, silverPrice) => gold / silverPrice);
  if (goldSilver.length >= 2) histories.GOLD_SILVER = goldSilver;
  const goldBitcoin = alignAndMap(
    london,
    bitcoinResult,
    (gold, bitcoin) => gold * (1_000 / TROY_OUNCE_GRAMS) / bitcoin,
  );
  if (goldBitcoin.length >= 2) histories.KGBTC = goldBitcoin;

  return { histories, updatedAt: Date.now() };
}

export async function newsPayload(url) {
  const type = url.searchParams.get('type') === 'current' ? 'current' : 'tech';
  const sources = type === 'tech' ? TECH_FEEDS : CURRENT_FEEDS;
  const settled = await Promise.allSettled(sources.map(fetchFeed));
  const seen = new Set();
  const items = settled
    .flatMap((result) => result.status === 'fulfilled' ? result.value : [])
    .sort((left, right) => right.publishedAt - left.publishedAt)
    .filter((item) => {
      const key = item.url || item.title.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 30);
  if (!items.length) throw new Error('news feeds returned no items');
  return { type, items, updatedAt: Date.now() };
}

async function fetchYahooQuote(symbol) {
  const payload = await fetchYahooChart(symbol, { range: '5d', interval: '1d' });
  const result = payload.chart?.result?.[0];
  if (!result) throw new Error(`missing Yahoo quote ${symbol}`);
  const meta = result.meta || {};
  const closes = (result.indicators?.quote?.[0]?.close || []).filter(Number.isFinite);
  const value = Number(meta.regularMarketPrice ?? closes.at(-1));
  const previous = Number(meta.chartPreviousClose ?? meta.previousClose ?? closes.at(-2) ?? value);
  if (!Number.isFinite(value)) throw new Error(`invalid Yahoo quote ${symbol}`);
  return {
    value,
    previous,
    change: previous ? (value / previous - 1) * 100 : 0,
    updatedAt: Number(meta.regularMarketTime || Math.floor(Date.now() / 1000)) * 1000,
    source: 'Yahoo Finance',
  };
}

export async function fetchGoldApiQuote(symbol = 'XAU') {
  const normalizedSymbol = String(symbol || 'XAU').toUpperCase();
  if (!Object.values(GOLD_API_ASSETS).includes(normalizedSymbol)) {
    throw new Error('unsupported Gold API symbol');
  }
  const payload = await fetchJson(`${GOLD_API_BASE_URL}/${normalizedSymbol}`, {
    bypassCache: true,
    timeoutMs: 10_000,
    headers: {
      Accept: 'application/json',
      'User-Agent': 'Mozilla/5.0 (compatible; LynncatMarkets/1.0)',
    },
  });
  const value = Number(payload.price);
  if (!(value > 0) || (payload.symbol && String(payload.symbol).toUpperCase() !== normalizedSymbol)) {
    throw new Error(`invalid Gold API ${normalizedSymbol} quote`);
  }
  const parsedUpdatedAt = Date.parse(String(payload.updatedAt || ''));
  return {
    value,
    previous: value,
    change: 0,
    updatedAt: Number.isFinite(parsedUpdatedAt) ? parsedUpdatedAt : Date.now(),
    source: `Gold API · ${normalizedSymbol}`,
    quoteKind: 'spot',
  };
}

async function fetchBinanceTicker(symbol, marketSymbol) {
  const payload = await fetchJson(`https://api.binance.com/api/v3/ticker/24hr?symbol=${encodeURIComponent(marketSymbol)}`, {
    bypassCache: true,
    timeoutMs: 10_000,
    headers: {
      Accept: 'application/json',
      'User-Agent': 'Mozilla/5.0 (compatible; LynncatMarkets/1.0)',
    },
  });
  const value = Number(payload.lastPrice);
  const previous = Number(payload.openPrice);
  if (!(value > 0) || !(previous > 0)) throw new Error(`invalid Binance ${symbol} quote`);
  return {
    value,
    previous,
    change: (value / previous - 1) * 100,
    updatedAt: Number(payload.closeTime) || Date.now(),
    source: `Binance ${marketSymbol}`,
  };
}

async function fetchTencentQuotes(symbols) {
  const response = await fetch(`https://qt.gtimg.cn/q=${symbols.join(',')}`, {
    headers: {
      Referer: 'https://finance.qq.com/',
      'User-Agent': 'Mozilla/5.0 (compatible; LynncatMarkets/1.0)',
    },
    cf: { cacheTtl: 3, cacheEverything: true },
  });
  if (!response.ok) throw new Error(`Tencent quote returned ${response.status}`);
  const bytes = await response.arrayBuffer();
  let text = '';
  try {
    text = new TextDecoder('gb18030').decode(bytes);
  } catch {
    text = new TextDecoder().decode(bytes);
  }
  const payloads = new Map();
  for (const match of text.matchAll(/v_([A-Za-z0-9_.]+)="([^"]*)"/g)) {
    const key = match[1];
    const fields = match[2].split('~');
    payloads.set(key, fields);
    payloads.set(key.replace(/^us_/, 'us.'), fields);
    payloads.set(key.replaceAll('_', '.'), fields);
  }
  return symbols.flatMap((symbol) => {
    const candidates = [
      symbol,
      symbol.replaceAll('.', '_'),
      symbol.replace(/^us\./, 'us_'),
      symbol.replaceAll('.', ''),
    ];
    const fields = candidates.map((candidate) => payloads.get(candidate)).find(Boolean);
    const value = Number(String(fields?.[3] || '').replaceAll(',', ''));
    if (!(value > 0)) return [];
    const absoluteChange = Number(String(fields?.[31] || '0').replaceAll(',', '')) || 0;
    const change = Number(String(fields?.[32] || '0').replaceAll(',', '')) || 0;
    const listedMarketCapBillion = (Number(String(fields?.[44] || '0').replaceAll(',', '')) || 0) / 10;
    const marketCapBillion = (Number(String(fields?.[45] || '0').replaceAll(',', '')) || 0) / 10;
    return [{
      symbol,
      ticker: symbol.replace(/^us[._]?/, ''),
      name: fields?.[1] || symbol,
      value,
      previous: value - absoluteChange,
      absoluteChange,
      change,
      listedMarketCapBillion,
      marketCapBillion,
      updatedAt: Date.now(),
      source: '腾讯行情',
    }];
  });
}

export function parseChinaMarketCapRanking(payload) {
  return (Array.isArray(payload?.data?.diff) ? payload.data.diff : []).flatMap((row) => {
    const ticker = String(row?.f12 || '').trim();
    const market = Number(row?.f13);
    const name = String(row?.f14 || '').trim();
    const value = Number(row?.f2);
    const change = Number(row?.f3);
    const absoluteChange = Number(row?.f4);
    const marketCapCny = Number(row?.f20);
    const floatMarketCapCny = Number(row?.f21);
    if (!/^\d{6}$/.test(ticker) || ![0, 1].includes(market) || !name
      || !(value > 0) || !(marketCapCny > 0)) return [];
    const isShanghai = market === 1;
    return [{
      symbol: `${isShanghai ? 'sh' : 'sz'}${ticker}`,
      ticker,
      name,
      exchange: isShanghai ? '上交所' : '深交所',
      exchangeCode: isShanghai ? 'SSE' : 'SZSE',
      value,
      previous: value - (Number.isFinite(absoluteChange) ? absoluteChange : 0),
      absoluteChange: Number.isFinite(absoluteChange) ? absoluteChange : 0,
      change: Number.isFinite(change) ? change : 0,
      marketCapCny,
      floatMarketCapCny: Number.isFinite(floatMarketCapCny) ? floatMarketCapCny : 0,
      marketCapBillion: marketCapCny / 1e9,
      source: '东方财富行情',
    }];
  }).sort((left, right) => right.marketCapCny - left.marketCapCny).slice(0, 20);
}

export function parseSinaChinaMarketCapRanking(payload) {
  return (Array.isArray(payload) ? payload : []).flatMap((row) => {
    const symbol = String(row?.symbol || '').trim().toLowerCase();
    const ticker = String(row?.code || symbol.slice(2)).trim();
    const name = String(row?.name || '').trim();
    const value = Number(row?.trade);
    const absoluteChange = Number(row?.pricechange);
    const change = Number(row?.changepercent);
    const marketCapCny = Number(row?.mktcap) * 10_000;
    const floatMarketCapCny = Number(row?.nmc) * 10_000;
    if (!/^(sh|sz)\d{6}$/.test(symbol) || !/^\d{6}$/.test(ticker) || !name
      || !(value > 0) || !(marketCapCny > 0)) return [];
    const isShanghai = symbol.startsWith('sh');
    return [{
      symbol,
      ticker,
      name,
      exchange: isShanghai ? '上交所' : '深交所',
      exchangeCode: isShanghai ? 'SSE' : 'SZSE',
      value,
      previous: value - (Number.isFinite(absoluteChange) ? absoluteChange : 0),
      absoluteChange: Number.isFinite(absoluteChange) ? absoluteChange : 0,
      change: Number.isFinite(change) ? change : 0,
      marketCapCny,
      floatMarketCapCny: Number.isFinite(floatMarketCapCny) ? floatMarketCapCny : 0,
      marketCapBillion: marketCapCny / 1e9,
      source: '新浪财经行情',
    }];
  }).sort((left, right) => right.marketCapCny - left.marketCapCny).slice(0, 20);
}

export function parseSinaHongKongCandidates(payload) {
  return (Array.isArray(payload) ? payload : []).flatMap((row) => {
    const ticker = String(row?.symbol || '').trim();
    const value = Number(row?.lasttrade);
    if (!/^\d{5}$/.test(ticker) || !(value > 0)) return [];
    return [`hk${ticker}`];
  });
}

async function fetchChinaTopMarketCapStocks() {
  try {
    const payload = await fetchJson(CN_SINA_MARKET_CAP_URL, {
      timeoutMs: 10_000,
      headers: {
        Accept: 'application/json',
        Referer: 'https://finance.sina.com.cn/',
        'User-Agent': 'Mozilla/5.0 (compatible; LynncatMarkets/1.0)',
      },
      cf: { cacheTtl: 180, cacheEverything: true },
    });
    const stocks = parseSinaChinaMarketCapRanking(payload);
    if (stocks.length < 20) throw new Error('Sina China market-cap ranking has insufficient rows');
    return {
      stocks,
      rankingScope: 'all-a-shares',
      rankingSource: '新浪财经沪深A股总市值排行',
    };
  } catch {
    const payload = await fetchJson(CN_MARKET_CAP_URL, {
      timeoutMs: 10_000,
      headers: {
        Accept: 'application/json',
        Referer: 'https://quote.eastmoney.com/',
        'User-Agent': 'Mozilla/5.0 (compatible; LynncatMarkets/1.0)',
      },
      cf: { cacheTtl: 180, cacheEverything: true },
    });
    const stocks = parseChinaMarketCapRanking(payload);
    if (stocks.length < 20) throw new Error('China market-cap ranking has insufficient rows');
    return {
      stocks,
      rankingScope: 'all-a-shares',
      rankingSource: '东方财富沪深A股总市值排行',
    };
  }
}

async function fetchChinaFallbackStocks() {
  const quotes = await fetchTencentQuotes(CN_STOCK_FALLBACK_SYMBOLS);
  const stocks = quotes.flatMap((quote) => {
    const ticker = quote.symbol.slice(2);
    const isShanghai = quote.symbol.startsWith('sh');
    const marketCapCny = Number(quote.marketCapBillion) * 1e9;
    if (!(marketCapCny > 0)) return [];
    return [{
      ...quote,
      ticker,
      exchange: isShanghai ? '上交所' : '深交所',
      exchangeCode: isShanghai ? 'SSE' : 'SZSE',
      marketCapCny,
      floatMarketCapCny: 0,
    }];
  }).sort((left, right) => right.marketCapCny - left.marketCapCny).slice(0, 20);
  if (stocks.length < 10) throw new Error('China stock fallback has insufficient rows');
  return {
    stocks,
    rankingScope: 'large-cap-fallback',
    rankingSource: '腾讯大型股行情后备集合',
  };
}

async function fetchTencentHistoryMap(symbols, concurrency = 6) {
  const unique = [...new Set(symbols)];
  const historyBySymbol = {};
  let cursor = 0;
  async function worker() {
    while (cursor < unique.length) {
      const symbol = unique[cursor];
      cursor += 1;
      try {
        historyBySymbol[symbol] = (await fetchTencentHistory(symbol)).slice(-250);
      } catch {
        historyBySymbol[symbol] = [];
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, unique.length) }, worker));
  return historyBySymbol;
}

async function fetchTencentQuoteBatches(symbols, batchSize = 70, concurrency = 3) {
  const unique = [...new Set(symbols)];
  const batches = [];
  for (let index = 0; index < unique.length; index += batchSize) {
    batches.push(unique.slice(index, index + batchSize));
  }
  const quotes = [];
  let cursor = 0;
  async function worker() {
    while (cursor < batches.length) {
      const batch = batches[cursor];
      cursor += 1;
      try {
        quotes.push(...await fetchTencentQuotes(batch));
      } catch {
        // One quote batch must not discard the remaining Hong Kong universe.
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, batches.length) }, worker));
  return quotes;
}

async function fetchHongKongLargeCapStocks() {
  let activeSymbols = [];
  try {
    const activePayload = await fetchJson(HK_ACTIVE_STOCKS_URL, {
      timeoutMs: 10_000,
      headers: {
        Accept: 'application/json',
        Referer: 'https://finance.sina.com.cn/',
        'User-Agent': 'Mozilla/5.0 (compatible; LynncatMarkets/1.0)',
      },
      cf: { cacheTtl: 180, cacheEverything: true },
    });
    activeSymbols = parseSinaHongKongCandidates(activePayload);
  } catch {
    // The maintained large-cap universe remains available when the active list is unavailable.
  }
  const quotes = await fetchTencentQuoteBatches([...HK_LARGE_CAP_SYMBOLS, ...activeSymbols]);
  const stocks = quotes.flatMap((quote) => {
    const marketCapHkd = Number(quote.marketCapBillion) * 1e9;
    const listedMarketCapHkd = Number(quote.listedMarketCapBillion) * 1e9;
    if (!quote.symbol.startsWith('hk') || !(marketCapHkd > 0)) return [];
    return [{
      ...quote,
      ticker: quote.symbol.slice(2),
      exchange: '香港交易所',
      exchangeCode: 'HKEX',
      marketCapHkd,
      listedMarketCapHkd,
    }];
  }).sort((left, right) => right.marketCapHkd - left.marketCapHkd).slice(0, 20);
  if (stocks.length < 20) throw new Error('Hong Kong market-cap ranking has insufficient rows');
  return stocks;
}

async function fetchHongKongStockMarketDetail() {
  const stocks = await fetchHongKongLargeCapStocks();
  const historySymbols = [HK_INDEX.marketSymbol, ...stocks.map((stock) => stock.symbol)];
  const [indexQuotes, historyBySymbol] = await Promise.all([
    fetchTencentQuotes([HK_INDEX.marketSymbol]).catch(() => []),
    fetchTencentHistoryMap(historySymbols),
  ]);
  const quote = indexQuotes[0];
  const history = historyBySymbol[HK_INDEX.marketSymbol] || [];
  const latest = history.at(-1)?.value;
  const previous = history.at(-2)?.value;
  const index = {
    ...HK_INDEX,
    value: Number(quote?.value) || Number(latest) || 0,
    previous: Number(quote?.previous) || Number(previous) || Number(latest) || 0,
    absoluteChange: Number(quote?.absoluteChange)
      || (Number.isFinite(latest) && Number.isFinite(previous) ? latest - previous : 0),
    change: Number(quote?.change)
      || (previous > 0 && Number.isFinite(latest) ? (latest / previous - 1) * 100 : 0),
    history,
    source: quote?.source || '腾讯前复权日线',
  };
  return {
    type: 'hk-stocks',
    index,
    stocks: stocks.map((stock) => ({
      ...stock,
      history: historyBySymbol[stock.symbol] || [],
    })),
    rankingScope: 'hkex-large-cap-universe',
    rankingSource: '腾讯港股实时总市值 · 新浪活跃股与恒生大型股候选池',
    historySource: '腾讯前复权日线',
    updatedAt: Date.now(),
  };
}

export function parseCountryMarketCapHtml(html, marketSymbol) {
  const config = REGIONAL_MARKETS[marketSymbol];
  if (!config) return [];
  const seen = new Set();
  const stocks = [];
  for (const match of String(html || '').matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const row = match[1];
    const rawName = row.match(/class=["']company-name["']>([\s\S]*?)<\/div>/i)?.[1];
    const sourceTicker = row.match(/class=["']company-code["']>[\s\S]*?<\/span>([^<]+)<\/div>/i)?.[1]?.trim();
    const marketCapText = row.match(/class=["']name-td["'][\s\S]*?<\/td><td class=["']td-right["'] data-sort=["']([0-9.]+)["']/i)?.[1];
    const yahooSymbol = config.aliases[sourceTicker] || sourceTicker;
    const marketCapUsd = Number(marketCapText);
    if (!rawName || !yahooSymbol?.endsWith(config.suffix) || !(marketCapUsd > 0) || seen.has(yahooSymbol)) continue;
    seen.add(yahooSymbol);
    stocks.push({
      symbol: yahooSymbol,
      yahooSymbol,
      ticker: yahooSymbol.slice(0, -config.suffix.length),
      name: cleanText(rawName),
      exchange: config.exchange,
      exchangeCode: config.exchangeCode,
      currency: config.currency,
      currencySymbol: config.currencySymbol,
      marketCapUsd,
      source: 'CompaniesMarketCap 每日市值排行',
    });
    if (stocks.length === 20) break;
  }
  return stocks;
}

function regionalFallbackStocks(config) {
  return config.fallback.map(([yahooSymbol, name, marketCapUsd]) => ({
    symbol: yahooSymbol,
    yahooSymbol,
    ticker: yahooSymbol.slice(0, -config.suffix.length),
    name,
    exchange: config.exchange,
    exchangeCode: config.exchangeCode,
    currency: config.currency,
    currencySymbol: config.currencySymbol,
    marketCapUsd,
    source: '最近市值排行后备快照',
  }));
}

async function fetchRegionalMarketCapRanking(config) {
  try {
    const html = await fetchText(
      `https://companiesmarketcap.com/${config.countrySlug}/largest-companies-in-${config.countrySlug}-by-market-cap/`,
      { timeoutMs: 12_000, cf: { cacheTtl: 3600, cacheEverything: true } },
    );
    const stocks = parseCountryMarketCapHtml(html, config.symbol);
    if (stocks.length < 20) throw new Error(`${config.symbol} market-cap ranking has insufficient rows`);
    return {
      stocks,
      rankingSource: 'CompaniesMarketCap 每日市值排行',
      rankingScope: 'daily-country-ranking',
    };
  } catch {
    return {
      stocks: regionalFallbackStocks(config),
      rankingSource: '最近市值排行后备快照',
      rankingScope: 'ranking-fallback',
    };
  }
}

async function fetchYahooHistoryMap(symbols, concurrency = 6) {
  const unique = [...new Set(symbols)];
  const historyBySymbol = {};
  let cursor = 0;
  async function worker() {
    while (cursor < unique.length) {
      const symbol = unique[cursor];
      cursor += 1;
      try {
        historyBySymbol[symbol] = (await fetchYahooHistory(symbol, { range: '1y', interval: '1d' })).slice(-250);
      } catch {
        historyBySymbol[symbol] = [];
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, unique.length) }, worker));
  return historyBySymbol;
}

async function fetchRegionalStockMarketDetail(config) {
  const ranking = await fetchRegionalMarketCapRanking(config);
  const historyBySymbol = await fetchYahooHistoryMap([
    config.indexYahooSymbol,
    ...ranking.stocks.map((stock) => stock.yahooSymbol),
  ]);
  const indexHistory = historyBySymbol[config.indexYahooSymbol] || [];
  const indexValue = Number(indexHistory.at(-1)?.value) || 0;
  const indexPrevious = Number(indexHistory.at(-2)?.value) || indexValue;
  const index = {
    symbol: config.routeSymbol,
    yahooSymbol: config.indexYahooSymbol,
    name: config.indexName,
    exchange: config.exchange,
    value: indexValue,
    previous: indexPrevious,
    absoluteChange: indexValue - indexPrevious,
    change: indexPrevious > 0 ? (indexValue / indexPrevious - 1) * 100 : 0,
    history: indexHistory,
    source: 'Yahoo Finance 日线',
  };
  const stocks = ranking.stocks.map((stock) => {
    const history = historyBySymbol[stock.yahooSymbol] || [];
    const value = Number(history.at(-1)?.value) || 0;
    const previous = Number(history.at(-2)?.value) || value;
    return {
      ...stock,
      value,
      previous,
      absoluteChange: value - previous,
      change: previous > 0 ? (value / previous - 1) * 100 : 0,
      history,
    };
  });
  return {
    type: 'regional-stocks',
    market: config.symbol,
    name: config.name,
    index,
    stocks,
    exchange: config.exchange,
    exchangeCode: config.exchangeCode,
    currency: config.currency,
    currencySymbol: config.currencySymbol,
    rankingSource: ranking.rankingSource,
    rankingScope: ranking.rankingScope,
    historySource: 'Yahoo Finance 日线',
    updatedAt: Date.now(),
  };
}

async function fetchChinaStockMarketDetail() {
  let ranking;
  try {
    ranking = await fetchChinaTopMarketCapStocks();
  } catch {
    ranking = await fetchChinaFallbackStocks();
  }

  const historySymbols = [
    ...CN_INDEXES.map((index) => index.marketSymbol),
    ...ranking.stocks.map((stock) => stock.symbol),
  ];
  const [indexQuoteResult, historyBySymbol] = await Promise.all([
    Promise.resolve().then(() => fetchTencentQuotes(CN_INDEXES.map((index) => index.marketSymbol))).catch(() => []),
    fetchTencentHistoryMap(historySymbols),
  ]);
  const quoteBySymbol = Object.fromEntries(indexQuoteResult.map((quote) => [quote.symbol, quote]));
  const indices = CN_INDEXES.map((index) => {
    const quote = quoteBySymbol[index.marketSymbol];
    const history = historyBySymbol[index.marketSymbol] || [];
    const latest = history.at(-1)?.value;
    const previous = history.at(-2)?.value;
    return {
      symbol: index.symbol,
      marketSymbol: index.marketSymbol,
      name: index.name,
      exchange: index.exchange,
      value: Number(quote?.value) || Number(latest) || 0,
      previous: Number(quote?.previous) || Number(previous) || Number(latest) || 0,
      absoluteChange: Number(quote?.absoluteChange)
        || (Number.isFinite(latest) && Number.isFinite(previous) ? latest - previous : 0),
      change: Number(quote?.change)
        || (previous > 0 && Number.isFinite(latest) ? (latest / previous - 1) * 100 : 0),
      history,
      source: quote?.source || '腾讯前复权日线',
    };
  });
  const stocks = ranking.stocks.map((stock) => ({
    ...stock,
    history: historyBySymbol[stock.symbol] || [],
  }));

  return {
    type: 'cn-stocks',
    indices,
    stocks,
    rankingScope: ranking.rankingScope,
    rankingSource: ranking.rankingSource,
    historySource: '腾讯前复权日线',
    updatedAt: Date.now(),
  };
}

async function fetchYahooHistory(symbol, period) {
  const payload = await fetchYahooChart(symbol, period);
  const result = payload.chart?.result?.[0];
  const timestamps = result?.timestamp || [];
  const quote = result?.indicators?.quote?.[0] || {};
  const closes = quote.close || [];
  const highs = quote.high || [];
  const lows = quote.low || [];
  const points = timestamps.map((timestamp, index) => ({
    time: Number(timestamp) * 1000,
    value: Number(closes[index]),
    high: Number.isFinite(Number(highs[index])) ? Number(highs[index]) : Number(closes[index]),
    low: Number.isFinite(Number(lows[index])) ? Number(lows[index]) : Number(closes[index]),
  })).filter((point) => Number.isFinite(point.value) && point.value > 0);
  if (points.length < 2) throw new Error(`missing Yahoo history ${symbol}`);
  return points;
}

async function fetchTencentHistory(symbol) {
  const payload = await fetchJson(
    `https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${encodeURIComponent(`${symbol},day,,,320,qfq`)}`,
    { headers: { Referer: 'https://finance.qq.com/', 'User-Agent': 'Mozilla/5.0 (compatible; LynncatMarkets/1.0)' } },
  );
  const root = payload.data?.[symbol] || {};
  const rows = root.day || root.qfqday || [];
  return normalizeHistory(rows.flatMap((row) => {
    const time = Date.parse(`${row?.[0]}T00:00:00Z`);
    const value = Number(row?.[2]);
    return Number.isFinite(time) && value > 0 ? [{ time, value, high: value, low: value }] : [];
  }));
}

async function fetchSinaHistory(symbol, domestic = false, maxDays = 371) {
  const service = domestic
    ? 'InnerFuturesNewService.getDailyKLine'
    : 'GlobalFuturesService.getGlobalFuturesDailyKLine';
  const payload = await fetchJson(
    `https://stock2.finance.sina.com.cn/futures/api/json.php/${service}?symbol=${encodeURIComponent(symbol)}`,
    { headers: { Referer: 'https://finance.sina.com.cn/', 'User-Agent': 'Mozilla/5.0 (compatible; LynncatMarkets/1.0)' } },
  );
  const dateKey = domestic ? 'd' : 'date';
  const closeKey = domestic ? 'c' : 'close';
  return normalizeHistory((Array.isArray(payload) ? payload : []).flatMap((row) => {
    const time = Date.parse(`${String(row?.[dateKey] || '').slice(0, 10)}T00:00:00Z`);
    const value = Number(row?.[closeKey]);
    return Number.isFinite(time) && value > 0 ? [{ time, value, high: value, low: value }] : [];
  }), maxDays);
}

async function fetchFrankfurterHistory() {
  const end = new Date();
  const start = new Date(end.getTime() - 370 * 86_400_000);
  const date = (value) => value.toISOString().slice(0, 10);
  const payload = await fetchJson(
    `https://api.frankfurter.dev/v1/${date(start)}..${date(end)}?from=USD&to=CNY,EUR,GBP,JPY,KRW,INR`,
  );
  const histories = {};
  for (const [dateText, rates] of Object.entries(payload.rates || {})) {
    const time = Date.parse(`${dateText}T00:00:00Z`);
    if (!Number.isFinite(time)) continue;
    for (const [currency, rawValue] of Object.entries(rates || {})) {
      const value = Number(rawValue);
      if (value > 0) histories[currency] = [...(histories[currency] || []), { time, value, high: value, low: value }];
    }
  }
  return Object.fromEntries(Object.entries(histories).map(([currency, points]) => [currency, normalizeHistory(points)]));
}

async function fetchCbrHistory() {
  const end = new Date();
  const start = new Date(end.getTime() - 370 * 86_400_000);
  const date = (value) => [
    String(value.getUTCDate()).padStart(2, '0'),
    String(value.getUTCMonth() + 1).padStart(2, '0'),
    value.getUTCFullYear(),
  ].join('/');
  const text = await fetchText(
    `https://www.cbr.ru/scripts/XML_dynamic.asp?date_req1=${encodeURIComponent(date(start))}&date_req2=${encodeURIComponent(date(end))}&VAL_NM_RQ=R01235`,
  );
  return normalizeHistory([...text.matchAll(/<Record Date="([^"]+)"[^>]*>[\s\S]*?<Value>([^<]+)<\/Value>[\s\S]*?<\/Record>/gi)].flatMap((match) => {
    const [day, month, year] = match[1].split('.');
    const time = Date.parse(`${year}-${month}-${day}T00:00:00Z`);
    const value = Number(match[2].replace(',', '.'));
    return Number.isFinite(time) && value > 0 ? [{ time, value, high: value, low: value }] : [];
  }));
}

async function fetchBinanceBtcHistory() {
  let latestError;
  for (const host of ['data-api.binance.vision', 'api.binance.com', 'api1.binance.com']) {
    try {
      const payload = await fetchJson(
        `https://${host}/api/v3/klines?symbol=BTCUSDT&interval=1d&limit=370`,
      );
      const points = normalizeHistory((Array.isArray(payload) ? payload : []).flatMap((row) => {
        const time = Number(row?.[0]);
        const value = Number(row?.[4]);
        return Number.isFinite(time) && value > 0 ? [{ time, value, high: value, low: value }] : [];
      }));
      if (points.length >= 2) return points;
    } catch (error) {
      latestError = error;
    }
  }
  throw latestError || new Error('Binance BTC history unavailable');
}

async function fetchSgeSpotHistory() {
  const end = new Date();
  const start = new Date(end.getTime() - 40 * 86_400_000);
  const date = (value) => value.toISOString().slice(0, 10);
  const pages = await Promise.allSettled([1, 2].map((page) => fetchText(
    `https://www.sge.com.cn/sjzx/quotation_daily_new?start_date=${date(start)}&end_date=${date(end)}&inst_ids=Au99.99&p=${page}`,
  )));
  const points = pages.flatMap((result) => result.status === 'fulfilled'
    ? parseTableRows(result.value).flatMap((cells) => {
        const time = Date.parse(`${cells[0]}T00:00:00Z`);
        const value = Number(String(cells[5] || '').replaceAll(',', ''));
        return cells.length >= 6 && String(cells[1]).toUpperCase() === 'AU99.99'
          && Number.isFinite(time) && value > 0
          ? [{ time, value, high: value, low: value }]
          : [];
      })
    : []);
  return normalizeHistory(points);
}

async function fetchChinaRetailHistory() {
  const listPages = await Promise.allSettled([
    'https://jgjc.ndrc.gov.cn/nyhyfxgd/index.jhtml',
    'https://jgjc.ndrc.gov.cn/nyhyfxgd/index_2.jhtml',
  ].map((url) => fetchText(url, { timeoutMs: 8_000 })));
  const articleUrls = [...new Set(listPages.flatMap((result) => {
    if (result.status !== 'fulfilled') return [];
    return [...result.value.matchAll(/<a[^>]*href=["'][^"']*\/nyxyfx\/([0-9]+)\.jhtml["'][^>]*>[\s\S]*?全国各省区成品油零售价格行情[\s\S]*?<\/a>/gi)]
      .map((match) => `https://jgjc.ndrc.gov.cn/nyxyfx/${match[1]}.jhtml`);
  }))].sort().reverse().slice(0, 12);
  const articles = await Promise.allSettled(articleUrls.map((url) => fetchText(url, { timeoutMs: 10_000 })));
  const histories = { CN92: [], CN95: [], CN98: [], CN0D: [] };
  for (const result of articles) {
    if (result.status !== 'fulfilled') continue;
    const dateText = result.value.match(/发布时间[：:]\s*(\d{4}-\d{2}-\d{2})/i)?.[1];
    const time = Date.parse(`${dateText}T00:00:00Z`);
    if (!Number.isFinite(time)) continue;
    for (const cells of parseTableRows(result.value)) {
      if (cells.length < 5 || cells[2] !== '元/升' || !['国家级', '全国'].includes(cells[3])) continue;
      const symbol = {
        '汽油|92号车用': 'CN92',
        '汽油|95号车用': 'CN95',
        '汽油|98号车用': 'CN98',
        '柴油|0号车用': 'CN0D',
      }[`${cells[0]}|${cells[1]}`];
      const value = Number(cells[4]);
      if (symbol && value > 0) histories[symbol].push({ time, value, high: value, low: value });
    }
  }
  return Object.fromEntries(Object.entries(histories)
    .map(([symbol, points]) => [symbol, normalizeHistory(points)])
    .filter(([, points]) => points.length >= 2));
}

function parseTableRows(html) {
  return [...String(html).matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((rowMatch) => (
    [...rowMatch[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)]
      .map((cell) => cleanText(cell[1]).replaceAll('\u00a0', ' ').trim())
  ));
}

function normalizeHistory(points, maxDays = 371) {
  const latestByDay = new Map();
  for (const point of points || []) {
    const time = Number(point.time);
    const value = Number(point.value);
    if (!(time > 0) || !(value > 0)) continue;
    latestByDay.set(new Date(time).toISOString().slice(0, 10), {
      time,
      value,
      high: Number(point.high) || value,
      low: Number(point.low) || value,
    });
  }
  const cutoff = Date.now() - maxDays * 86_400_000;
  return [...latestByDay.values()].sort((left, right) => left.time - right.time)
    .filter((point) => point.time >= cutoff);
}

function alignAndMap(numerator, denominator, transform) {
  const denominatorByDay = new Map((denominator || []).map((point) => [
    new Date(point.time).toISOString().slice(0, 10), point.value,
  ]));
  return normalizeHistory((numerator || []).flatMap((point) => {
    const other = denominatorByDay.get(new Date(point.time).toISOString().slice(0, 10));
    const value = Number(transform(point.value, other));
    return other > 0 && value > 0 ? [{ time: point.time, value, high: value, low: value }] : [];
  }));
}

function mergePreferredHistory(preferred, fallback) {
  const merged = new Map((fallback || []).map((point) => [
    new Date(point.time).toISOString().slice(0, 10), point,
  ]));
  for (const point of preferred || []) {
    merged.set(new Date(point.time).toISOString().slice(0, 10), point);
  }
  return normalizeHistory([...merged.values()]);
}

async function fetchYahooChart(symbol, period) {
  const encoded = encodeURIComponent(symbol);
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encoded}?range=${period.range}&interval=${period.interval}&includePrePost=false&events=div%2Csplits`;
  return fetchJson(url, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'Mozilla/5.0 (compatible; LynncatMarkets/1.0)',
    },
  });
}

async function fetchRates() {
  const payload = await fetchJson('https://open.er-api.com/v6/latest/USD');
  const rates = payload.rates || {};
  if (!Number.isFinite(Number(rates.CNY)) || !Number.isFinite(Number(rates.HKD))) {
    throw new Error('exchange rates unavailable');
  }
  return {
    USD: 1,
    CNY: Number(rates.CNY),
    HKD: Number(rates.HKD),
    EUR: Number(rates.EUR),
    GBP: Number(rates.GBP),
    JPY: Number(rates.JPY),
    KRW: Number(rates.KRW),
    RUB: Number(rates.RUB),
    INR: Number(rates.INR),
  };
}

export async function fetchSinaOilQuotes() {
  const response = await fetch('https://hq.sinajs.cn/list=hf_CL,hf_OIL', {
    headers: {
      Referer: 'https://finance.sina.com.cn',
      'User-Agent': 'Mozilla/5.0 (compatible; LynncatMarkets/1.0)',
    },
    cf: { cacheTtl: 8, cacheEverything: true },
  });
  if (!response.ok) throw new Error(`Sina oil returned ${response.status}`);
  const text = await response.text();
  return text.split(/\r?\n/).flatMap((line) => {
    const payload = line.match(/"([^"]*)"/)?.[1];
    if (!payload) return [];
    const parts = payload.split(',');
    const value = Number(parts[0]);
    const previous = Number(parts[7] || parts[2] || value);
    if (!(value > 0)) return [];
    const symbol = line.includes('hf_CL') ? 'WTI' : line.includes('hf_OIL') ? 'BRENT' : '';
    if (!symbol) return [];
    return [{
      symbol,
      value,
      previous,
      change: previous > 0 ? (value / previous - 1) * 100 : 0,
      changeAmount: value - previous,
      timeText: [parts[12], parts[6]].filter(Boolean).join(' '),
      source: '新浪国际期货',
      updatedAt: Date.now(),
    }];
  });
}

export async function fetchDebtLatest(timeoutMs = 30_000, logFailure = true) {
  const snapshot = await fetchDebtDataset(timeoutMs, logFailure);
  const latest = snapshot.rows[0].totalDebt;
  const previous = snapshot.rows[1]?.totalDebt ?? latest;
  return {
    value: latest / 1e12,
    change: previous ? (latest / previous - 1) * 100 : 0,
    dailyChangeUSD: latest - previous,
    dailyChangeBillions: (latest - previous) / 1e9,
    recordDate: snapshot.rows[0].recordDate,
    updatedAt: Date.parse(`${snapshot.rows[0].recordDate}T00:00:00Z`),
    isStale: snapshot.isStale,
    source: '美国财政部 Fiscal Data',
  };
}

export async function fetchDebtHistory() {
  const snapshot = await fetchDebtDataset(30_000);
  return debtHistoryFromRows(snapshot.rows);
}

async function fetchDebtDataset(timeoutMs = 30_000, logFailure = true) {
  const cached = await readDebtCache();
  if (cached && Date.now() - cached.fetchedAt < DEBT_CACHE_FRESH_MS) {
    return { ...cached, isStale: false };
  }

  try {
    const payload = await fetchJson(DEBT_DATA_URL, {
      bypassCache: true,
      headers: {
        Accept: 'application/json',
        'Cache-Control': 'no-store',
      },
      timeoutMs,
    });
    const rows = normalizeDebtRows(payload.data);
    if (rows.length < 2) throw new Error('Treasury debt data has insufficient records');
    const snapshot = { fetchedAt: Date.now(), rows };
    await writeDebtCache(snapshot);
    return { ...snapshot, isStale: false };
  } catch (error) {
    if (cached?.rows?.length >= 2) return { ...cached, isStale: true };
    if (logFailure) {
      console.warn('treasury_debt_fetch_failed', {
        message: String(error?.message || error).slice(0, 180),
      });
    }
    throw error;
  }
}

function normalizeDebtRows(rows) {
  return (Array.isArray(rows) ? rows : []).flatMap((row) => {
    const recordDate = String(row?.record_date || '');
    const totalDebt = Number(row?.tot_pub_debt_out_amt);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(recordDate) || !(totalDebt > 0)) return [];
    return [{ recordDate, totalDebt }];
  }).sort((left, right) => right.recordDate.localeCompare(left.recordDate));
}

function debtHistoryFromRows(rows) {
  const ascending = rows.slice(0, 91).reverse();
  return ascending.slice(1).map((row, index) => ({
    time: Date.parse(`${row.recordDate}T00:00:00Z`),
    recordDate: row.recordDate,
    value: row.totalDebt / 1e12,
    dailyChangeUSD: row.totalDebt - ascending[index].totalDebt,
  }));
}

async function readDebtCache() {
  const cache = globalThis.caches?.default;
  if (!cache) return null;
  try {
    const response = await cache.match(new Request(DEBT_CACHE_URL));
    if (!response) return null;
    const payload = await response.json();
    const rows = normalizeDebtRows(payload.rows?.map((row) => ({
      record_date: row.recordDate,
      tot_pub_debt_out_amt: row.totalDebt,
    })));
    const fetchedAt = Number(payload.fetchedAt);
    return rows.length >= 2 && Number.isFinite(fetchedAt) ? { fetchedAt, rows } : null;
  } catch {
    return null;
  }
}

async function writeDebtCache(snapshot) {
  const cache = globalThis.caches?.default;
  if (!cache) return;
  try {
    await cache.put(new Request(DEBT_CACHE_URL), new Response(JSON.stringify(snapshot), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'public, max-age=604800',
      },
    }));
  } catch {
    // A cache write failure must not discard a valid Treasury response.
  }
}

function normalizeQuote(symbol, quote, rates) {
  const normalized = { ...quote };
  if (['XAU', 'SILVER', 'PLATINUM', 'PALLADIUM'].includes(symbol)) {
    const goldApiSymbol = { XAU: 'XAU', SILVER: 'XAG', PLATINUM: 'XPT', PALLADIUM: 'XPD' }[symbol];
    normalized.usd = quote.value;
    normalized.value = quote.value * rates.CNY / TROY_OUNCE_GRAMS;
    normalized.source = `Gold API · ${goldApiSymbol} 现货 · USD/CNY`;
    normalized.quoteKind = 'spot';
  } else if (symbol === 'COMEX_GOLD') {
    normalized.source = 'Yahoo COMEX 黄金期货';
    normalized.quoteKind = 'futures';
  } else if (['BTC', 'ETH', 'DOGE', 'TRUMP'].includes(symbol)) {
    normalized.usd = quote.value;
    normalized.value = quote.value * rates.CNY;
    normalized.source = ['DOGE', 'TRUMP'].includes(symbol)
      ? `Binance ${symbol}/USDT`
      : `Gold API · ${symbol} · USD/CNY`;
  } else if (symbol === 'NASDAQ') {
    normalized.source = 'Yahoo 纳斯达克综合指数';
  } else if (symbol === 'WTI') {
    normalized.source = 'Yahoo WTI 原油';
  }
  return normalized;
}

function addDerivedQuotes(quotes, rates) {
  quotes.USDCNY = { value: rates.CNY, change: 0, source: 'Open ER API' };
  quotes.USDHKD = { value: rates.HKD, change: 0, source: 'Open ER API' };
  quotes.USDEUR = { value: rates.EUR, change: 0, source: 'Open ER API' };
  quotes.USDGBP = { value: rates.GBP, change: 0, source: 'Open ER API' };
  quotes.USDJPY = { value: rates.JPY, change: 0, source: 'Open ER API' };
  quotes.USDKRW = { value: rates.KRW, change: 0, source: 'Open ER API' };
  quotes.USDRUB = { value: rates.RUB, change: 0, source: 'Open ER API' };
  quotes.USDINR = { value: rates.INR, change: 0, source: 'Open ER API' };
  if (quotes.XAU?.usd) {
    quotes.LONDON_GOLD = { ...quotes.XAU, value: quotes.XAU.usd, source: 'Gold API · XAU/USD 现货' };
    quotes.SHANGHAI_SPOT = { ...quotes.XAU, source: 'Au99.99 / 汇率折算参考' };
    quotes.SHANGHAI_FUTURES = { ...quotes.XAU, source: '沪金连续 / 汇率折算参考' };
    quotes.SHUIBEI = { ...quotes.XAU, source: '水贝现货 / Au99.99 参考' };
  }
  if (quotes.XAU?.usd && quotes.SILVER?.usd) {
    quotes.GOLD_SILVER = {
      value: quotes.XAU.usd / quotes.SILVER.usd,
      change: Number(quotes.XAU.change || 0) - Number(quotes.SILVER.change || 0),
      source: '同日黄金 / 白银比值',
    };
  }
  Object.assign(quotes, {
    CN92: { value: 7.82, change: 0, source: '价格监测中心 · 最近全国均价' },
    CN95: { value: 8.33, change: 0, source: '价格监测中心 · 最近全国均价' },
    CN98: { value: 9.17, change: 0, source: '价格监测中心 · 最近全国均价' },
    CN0D: { value: 7.49, change: 0, source: '价格监测中心 · 最近全国均价' },
  });
  if (quotes.XAU?.usd && quotes.BTC?.usd) {
    quotes.KGBTC = {
      value: quotes.XAU.usd * (1000 / TROY_OUNCE_GRAMS) / quotes.BTC.usd,
      change: Number(quotes.XAU.change || 0) - Number(quotes.BTC.change || 0),
      source: 'XAU/BTC 统一换算',
    };
  }
}

function convertHistoricalValue(symbol, value, rates) {
  if (['XAU', 'SILVER', 'PLATINUM', 'PALLADIUM'].includes(symbol)) {
    return value * rates.CNY / TROY_OUNCE_GRAMS;
  }
  if (['BTC', 'ETH', 'DOGE', 'TRUMP'].includes(symbol)) return value * rates.CNY;
  return value;
}

async function fetchEconomicEvents(days) {
  const dates = Array.from({ length: days + 1 }, (_, offset) => {
    const date = new Date(Date.now() + offset * 86_400_000);
    return date.toISOString().slice(0, 10);
  });
  const settled = await Promise.allSettled(dates.map(fetchNasdaqEventsForDate));
  const events = settled
    .flatMap((result) => result.status === 'fulfilled' ? result.value : [])
    .filter((event) => isRelevantEvent(event.title))
    .sort((left, right) => left.date - right.date);
  const seen = new Set();
  return events.filter((event) => {
    const key = `${new Date(event.date).toISOString().slice(0, 10)}-${event.title.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, days > 6 ? 160 : 14);
}

async function fetchNasdaqEventsForDate(date) {
  const payload = await fetchJson(`https://api.nasdaq.com/api/calendar/economicevents?date=${date}`, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'Mozilla/5.0 (compatible; LynncatMarkets/1.0)',
    },
  });
  return (payload.data?.rows || []).filter((row) => row.country === 'United States').map((row) => {
    const title = cleanText(row.eventName);
    const high = isHighImpact(title);
    const values = [
      row.consensus ? `预期 ${cleanText(row.consensus)}` : '',
      row.previous ? `前值 ${cleanText(row.previous)}` : '',
      row.actual ? `实际 ${cleanText(row.actual)}` : '',
    ].filter(Boolean).join(' · ');
    return {
      date: Date.parse(`${date}T${normalizeGmt(row.gmt)}Z`),
      tag: eventTag(title),
      title,
      titleCN: localizeEventTitle(title),
      impact: high ? '高' : '中',
      descCN: `${values}${values ? '。' : ''}${high ? '关注数据对美元、美债收益率、黄金和美股估值的直接影响。' : '可作为宏观节奏参考。'}`,
      source: 'Nasdaq Economic Calendar',
    };
  });
}

function normalizeGmt(value) {
  const match = String(value || '').match(/(\d{1,2}):(\d{2})/);
  return match ? `${match[1].padStart(2, '0')}:${match[2]}:00` : '12:00:00';
}

function isRelevantEvent(title) {
  return /(fed|fomc|interest rate|inflation|cpi|ppi|non.?farm|payroll|unemployment|gdp|retail sales|pce|ism|consumer confidence|jobless|jolts|pmi)/i.test(title);
}

function isHighImpact(title) {
  return /(fomc|interest rate|cpi|ppi|non.?farm|payroll|unemployment|gdp|pce|fed chair)/i.test(title);
}

function eventTag(title) {
  if (/fed|fomc|interest/i.test(title)) return 'FOMC';
  if (/cpi|ppi|pce|inflation/i.test(title)) return '通胀';
  if (/payroll|jobless|unemployment|jolts/i.test(title)) return '就业';
  if (/gdp/i.test(title)) return 'GDP';
  return '宏观';
}

function localizeEventTitle(title) {
  const replacements = [
    [/consumer confidence/i, '美国消费者信心'],
    [/gross domestic product|gdp/i, '美国 GDP 数据'],
    [/consumer price index|cpi/i, '美国消费者价格指数'],
    [/producer price index|ppi/i, '美国生产者价格指数'],
    [/non.?farm payrolls?/i, '美国非农就业'],
    [/initial jobless claims?/i, '美国初请失业金人数'],
    [/retail sales/i, '美国零售销售'],
    [/fomc/i, '美联储 FOMC 事件'],
  ];
  for (const [pattern, localized] of replacements) {
    if (pattern.test(title)) return localized;
  }
  return title;
}

async function fetchFeed(source) {
  const response = await fetch(source.url, {
    headers: {
      Accept: 'application/rss+xml, application/xml, text/xml',
      'User-Agent': 'Mozilla/5.0 (compatible; LynncatMarkets/1.0)',
    },
    cf: { cacheTtl: 300, cacheEverything: true },
  });
  if (!response.ok) throw new Error(`feed ${source.source} returned ${response.status}`);
  return parseRss(await response.text(), source);
}

export function parseRss(xml, source) {
  const blocks = [...String(xml).matchAll(/<(item|entry)\b[\s\S]*?<\/\1>/gi)].map((match) => match[0]);
  return blocks.slice(0, 20).map((block) => {
    const title = cleanText(readTag(block, 'title'));
    const summaryHtml = readTag(block, 'description') || readTag(block, 'summary') || readTag(block, 'content:encoded') || readTag(block, 'content');
    const link = readLink(block);
    const published = readTag(block, 'pubDate') || readTag(block, 'published') || readTag(block, 'updated');
    const category = cleanText(readTag(block, 'category')) || source.category;
    return {
      title,
      summary: cleanText(summaryHtml).slice(0, 480),
      url: link,
      image: readImage(block, summaryHtml),
      publishedAt: Number.isFinite(Date.parse(published)) ? Date.parse(published) : Date.now(),
      source: source.source,
      category,
    };
  }).filter((item) => item.title && item.url);
}

function readTag(block, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = block.match(new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`, 'i'));
  return match?.[1] || '';
}

function readLink(block) {
  const text = cleanText(readTag(block, 'link'));
  if (/^https?:\/\//i.test(text)) return text;
  const href = block.match(/<link\b[^>]*\bhref=["']([^"']+)["'][^>]*>/i)?.[1];
  return decodeEntities(href || '');
}

function readImage(block, summaryHtml) {
  const enclosure = block.match(/<(?:media:content|media:thumbnail|enclosure)\b[^>]*\burl=["']([^"']+)["']/i)?.[1];
  const inline = String(summaryHtml).match(/<img\b[^>]*\bsrc=["']([^"']+)["']/i)?.[1];
  const image = decodeEntities(enclosure || inline || '');
  return /^https?:\/\//i.test(image) ? image : null;
}

function cleanText(value) {
  return decodeEntities(String(value || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim());
}

function decodeEntities(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));
}

async function fetchJson(url, options = {}) {
  const { timeoutMs = 12_000, bypassCache = false, ...fetchOptions } = options;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
      cf: bypassCache ? fetchOptions.cf : { cacheTtl: 120, cacheEverything: true, ...(fetchOptions.cf || {}) },
    });
    if (!response.ok) throw new Error(`${url} returned ${response.status}`);
    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchText(url, options = {}) {
  const { timeoutMs = 12_000, bypassCache = false, ...fetchOptions } = options;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; LynncatMarkets/1.0)',
        ...(fetchOptions.headers || {}),
      },
      cf: bypassCache ? fetchOptions.cf : { cacheTtl: 600, cacheEverything: true, ...(fetchOptions.cf || {}) },
    });
    if (!response.ok) throw new Error(`${url} returned ${response.status}`);
    return response.text();
  } finally {
    clearTimeout(timeout);
  }
}

function json(payload, status = 200, headers = {}) {
  if (payload instanceof Response) return payload;
  return new Response(JSON.stringify(payload), { status, headers: { ...JSON_HEADERS, ...headers } });
}

function jsonError(code, status) {
  const error = new Error(code);
  error.code = code;
  error.status = status;
  throw error;
}
