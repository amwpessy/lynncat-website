(() => {
  "use strict";

  const API_ROOT = "/markets";
  const GOLD_PUBLIC_URL = "https://api.gold-api.com/price/XAU";
  const GOLD_LOCAL_CACHE_KEY = "lynncat-gold-spot-v2";
  const GOLD_REFRESH_MS = 1_000;
  const FAST_MARKET_REFRESH_MS = 3_000;
  const OIL_REFRESH_MS = 8_000;
  const BASE_MARKET_REFRESH_MS = 30_000;
  const FOCUS_LIVE_MAX_POINTS = 120;
  const TROY_OUNCE_GRAMS = 31.1034768;
  const DEBT_PUBLIC_URL = "https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v2/accounting/od/debt_to_penny?sort=-record_date&page%5Bnumber%5D=1&page%5Bsize%5D=400&fields=record_date%2Ctot_pub_debt_out_amt";
  const DEBT_LOCAL_CACHE_KEY = "lynncat-debt-official-v3";
  const TREASURY_YIELDS_LOCAL_CACHE_KEY = "lynncat-treasury-yields-v1";
  const ASSET_ORDER = ["DEBT", "XAU", "NASDAQ", "BTC", "WTI"];
  const SECONDARY_ASSETS = ["SILVER", "PLATINUM", "PALLADIUM", "ETH", "DOGE", "TRUMP"];
  const LIVE_SPARK_SYMBOLS = [...ASSET_ORDER.filter((symbol) => symbol !== "DEBT"), ...SECONDARY_ASSETS];
  const PERIOD_LABELS = { "1d": "最近一天", "1w": "最近一周", "1m": "最近一个月", "1y": "最近一年" };
  const REGION = {
    cn: { currency: "CNY", locale: "zh-CN", symbol: "¥" },
    hk: { currency: "HKD", locale: "zh-HK", symbol: "HK$" },
    us: { currency: "USD", locale: "en-US", symbol: "$" },
  };
  const ASSET_META = {
    DEBT: { name: "美国国债", unit: "万亿美元", decimals: 4, room: "US_DEBT" },
    XAU: { name: "黄金", unit: "克", decimals: 2, room: "XAU" },
    NASDAQ: { name: "纳斯达克指数", unit: "点", decimals: 0, room: "US_STOCKS" },
    BTC: { name: "比特币", unit: "枚", decimals: 0, room: "BTC" },
    WTI: { name: "WTI 原油", unit: "桶", decimals: 2, room: "OIL" },
    SILVER: { name: "白银", unit: "盎司", decimals: 2, room: "XAG" },
    PLATINUM: { name: "铂金", unit: "盎司", decimals: 2, room: "XPT" },
    PALLADIUM: { name: "钯金", unit: "盎司", decimals: 2, room: "XPD" },
    ETH: { name: "以太坊", unit: "枚", decimals: 0, room: "ETH" },
    DOGE: { name: "狗狗币", unit: "枚", decimals: 4, room: "DOGE" },
    TRUMP: { name: "Official Trump", unit: "枚", decimals: 2, room: "TRUMP" },
    CN_STOCKS: { name: "中国 A 股市场", unit: "点", decimals: 2, room: "CN_STOCKS" },
    HK_STOCKS: { name: "香港股票市场", unit: "点", decimals: 2, room: "HK_STOCKS" },
    JP_STOCKS: { name: "日本股票市场", unit: "点", decimals: 2, room: "JP_STOCKS" },
    KR_STOCKS: { name: "韩国股票市场", unit: "点", decimals: 2, room: "KR_STOCKS" },
    TW_STOCKS: { name: "台湾股票市场", unit: "点", decimals: 2, room: "TW_STOCKS" },
    IN_STOCKS: { name: "印度股票市场", unit: "点", decimals: 2, room: "IN_STOCKS" },
    EVENTS: { name: "近期重要事件", unit: "", decimals: 0, room: "ECON_EVENTS" },
  };
  const MONITOR_GROUPS = {
    stocks: [
      ["NASDAQ", "纳斯达克指数", "us.IXIC · 腾讯前复权日线"],
      ["SSE", "中国上证 A 股指数", "sh000001 · 腾讯前复权日线"],
      ["HSI", "香港恒生指数", "hkHSI · 腾讯前复权日线"],
      ["N225", "日本日经 225 指数", "N225 · Yahoo 日线"],
      ["KOSPI", "韩国综合指数", "KOSPI · Yahoo 日线"],
      ["TWII", "台湾加权指数", "TWII · Yahoo 日线"],
      ["NIFTY", "印度 NIFTY 50 指数", "NIFTY · Yahoo 日线"],
    ],
    fx: [
      ["USDCNY", "美元兑人民币", "USD/CNY · Frankfurter"],
      ["USDEUR", "美元兑欧元", "USD/EUR · Frankfurter"],
      ["USDGBP", "美元兑英镑", "USD/GBP · Frankfurter"],
      ["USDJPY", "美元兑日元", "USD/JPY · Frankfurter"],
      ["USDKRW", "美元兑韩元", "USD/KRW · Frankfurter"],
      ["USDRUB", "美元兑卢布", "USD/RUB · CBR"],
      ["USDINR", "美元兑印度卢比", "USD/INR · Frankfurter"],
    ],
    energy: [
      ["WTI", "WTI 原油", "CL · 新浪全球期货日线"],
      ["BRENT", "布伦特原油", "OIL · 新浪全球期货日线"],
      ["RBOB", "美国无铅汽油", "RBOB · NYMEX"],
      ["CN92", "中国 92 号汽油", "价格监测中心 · 全国均价"],
      ["CN95", "中国 95 号汽油", "价格监测中心 · 全国均价"],
      ["CN98", "中国 98 号汽油", "价格监测中心 · 全国均价"],
      ["CN0D", "中国 0 号柴油", "价格监测中心 · 全国均价"],
    ],
    metals: [
      ["COMEX_GOLD", "美国黄金报价", "GC · 新浪全球期货日线"],
      ["LONDON_GOLD", "伦敦金报价", "XAU · 新浪全球期货日线"],
      ["SHANGHAI_SPOT", "上海黄金现货报价", "Au99.99 · 上金所 / 汇率折算"],
      ["SHANGHAI_FUTURES", "上海黄金期货报价", "AU0 · 新浪国内期货日线"],
      ["SHUIBEI", "水贝现货黄金参考", "复用 Au99.99 参考，并非独立采价"],
      ["GOLD_SILVER", "黄金白银比", "XAU/XAG · 同日比值"],
      ["KGBTC", "1千克黄金 / 比特币", "KG→BTC · 统一口径"],
    ],
  };
  const HISTORY_SYMBOLS = [
    ...ASSET_ORDER, ...SECONDARY_ASSETS, "DOW", "SP500",
  ];
  const CROSS_HISTORY_SYMBOLS = [...new Set(Object.values(MONITOR_GROUPS)
    .flat()
    .map(([symbol]) => symbol))];

  const fallbackQuotes = {
    DEBT: {
      value: 39.79715289927521,
      change: 0.2094700134,
      dailyChangeUSD: 83_188_845_828.10,
      dailyChangeBillions: 83.1888458281,
      recordDate: "2026-07-28",
      unit: "trillion",
      source: "美国财政部 Fiscal Data",
      updatedAt: Date.parse("2026-07-28T00:00:00Z"),
      isStale: true,
    },
    XAU: {
      value: 880.9330326543239,
      usd: 4045.100098,
      change: 0,
      unit: "gram",
      source: "Gold API · XAU 现货 · 最近真实缓存",
      updatedAt: Date.parse("2026-07-30T05:11:21Z"),
      quoteKind: "spot",
      isStale: true,
    },
    COMEX_GOLD: { value: 4099.6, change: 0.6160265063, source: "Yahoo COMEX 黄金期货", quoteKind: "futures" },
    NASDAQ: { value: 24877, change: -0.22, unit: "points", source: "腾讯 / Yahoo Finance", updatedAt: Date.now() },
    BTC: { value: 435956, usd: 64352, change: 0.88, unit: "coin", source: "Gold API · USD/CNY", updatedAt: Date.now() },
    WTI: { value: 82.89, change: 4.58, unit: "barrel", source: "Sina / Yahoo Finance", updatedAt: Date.now() },
    SSE: { value: 3813, change: -6.4, source: "腾讯日线" },
    HSI: { value: 25311, change: 9.92, source: "腾讯日线" },
    N225: { value: 41864, change: 2.08, source: "Yahoo 日线" },
    KOSPI: { value: 3254, change: 3.15, source: "Yahoo 日线" },
    TWII: { value: 23889, change: 2.64, source: "Yahoo 日线" },
    NIFTY: { value: 25743, change: 1.43, source: "Yahoo 日线" },
    USDCNY: { value: 6.7746, change: -0.31, source: "Frankfurter" },
    USDHKD: { value: 7.812, change: 0.04, source: "Frankfurter" },
    EURUSD: { value: 1.173, change: 0.28, source: "Frankfurter" },
    USDEUR: { value: 0.8525, change: 0.28, source: "Frankfurter" },
    USDGBP: { value: 0.742, change: 0.1, source: "Frankfurter" },
    USDJPY: { value: 147.2, change: -0.64, source: "Frankfurter" },
    USDKRW: { value: 1384.2, change: 0.12, source: "Frankfurter" },
    USDRUB: { value: 81.1, change: 0.45, source: "CBR" },
    USDINR: { value: 86.4, change: 0.08, source: "Frankfurter" },
    BRENT: { value: 86.42, change: 3.9, source: "Sina" },
    NATGAS: { value: 3.21, change: -1.7, source: "Yahoo" },
    RBOB: { value: 2.61, change: 1.2, source: "Yahoo" },
    CN92: { value: 7.82, change: 0, source: "价格监测中心" },
    CN95: { value: 8.33, change: 0, source: "价格监测中心" },
    CN98: { value: 9.17, change: 0, source: "价格监测中心" },
    CN0D: { value: 7.49, change: 0, source: "价格监测中心" },
    SILVER: { value: 11.39, usd: 52.31, change: 0, source: "Gold API · XAG · 最近缓存" },
    PLATINUM: { value: 327.58, usd: 1504, change: 0, source: "Gold API · XPT · 最近缓存" },
    PALLADIUM: { value: 282.70, usd: 1298, change: 0, source: "Gold API · XPD · 最近缓存" },
    ETH: { value: 24788, usd: 3660, change: 0, source: "Gold API · ETH · 最近缓存" },
    DOGE: { value: 0.88, usd: 0.13, change: -0.42, source: "Binance DOGE/USDT · 最近缓存" },
    TRUMP: { value: 47.4, usd: 7.0, change: 2.14, source: "Binance TRUMP/USDT · 最近缓存" },
    DOW: { value: 52747, change: 0.31, source: "Yahoo Finance" },
    SP500: { value: 7429, change: 0.27, source: "Yahoo Finance" },
    KGBTC: { value: 2.0148, change: -0.2, source: "XAU/BTC 统一换算" },
    LONDON_GOLD: { value: 4032.8, change: -0.09, source: "伦敦现货参考" },
    SHANGHAI_SPOT: { value: 878.37, change: -0.09, source: "上金所 / 折算" },
    SHANGHAI_FUTURES: { value: 878.37, change: -0.09, source: "沪金连续 / 折算" },
    SHUIBEI: { value: 878.37, change: -0.09, source: "水贝现货参考" },
    GOLD_SILVER: { value: 77.09, change: -1.89, source: "XAU/XAG 同日比值" },
  };

  const state = {
    route: "overview",
    region: localStorage.getItem("lynncat-region") || "cn",
    theme: localStorage.getItem("lynncat-theme") || "pilot",
    period: "1m",
    monitorPeriod: "1m",
    trendAsset: "XAU",
    monitorCategory: "stocks",
    quotes: structuredClone(fallbackQuotes),
    focusLiveSeries: Object.fromEntries(LIVE_SPARK_SYMBOLS.map((symbol) => [symbol, []])),
    focusLiveTimer: null,
    oilLiveTimer: null,
    baseLiveTimer: null,
    trendChartPoints: [],
    trendChartGeometry: null,
    trendHoverIndex: null,
    histories: {},
    crossHistories: {},
    historyUpdatedAt: 0,
    historyRequest: null,
    crossHistoryUpdatedAt: 0,
    crossHistoryRequest: null,
    debtUpdatedAt: 0,
    debtRequest: null,
    treasuryYields: null,
    treasuryYieldsUpdatedAt: 0,
    treasuryYieldsRequest: null,
    goldUpdatedAt: 0,
    goldRequest: null,
    goldRefreshTimer: null,
    goldSessionOpen: Number(sessionStorage.getItem("lynncat-gold-session-open") || 0),
    events: [],
    eventsFull: [],
    eventsLoaded: false,
    eventImpactFilter: "all",
    detailCache: {},
    stockIndexSymbol: "SP500",
    stockIndexYear: null,
    chinaIndexSymbol: "SSE",
    chinaStockSymbol: null,
    hongKongStockSymbol: null,
    regionalStockSymbols: {
      JP_STOCKS: null,
      KR_STOCKS: null,
      TW_STOCKS: null,
      IN_STOCKS: null,
    },
    detailChartPoints: null,
    news: { tech: [], current: [] },
    token: localStorage.getItem("lynncat-market-session") || "",
    account: null,
    installationId: getInstallationId(),
    leaseVersion: 0,
    activeSeconds: 0,
    nextCreditAt: null,
    heartbeatServerOffset: 0,
    heartbeatRequest: null,
    heartbeatTimer: null,
    onlineStatusTimer: null,
    authMode: "login",
    currentDetail: null,
    currentRoom: null,
    ownedCards: new Map(),
    cardsStatus: null,
    cardFilter: "all",
    pokerStatus: null,
    poker: createPokerState(),
    goldReserves: [],
    alerts: loadLocalJson("lynncat-price-alerts", []),
    blockedAuthors: new Set(loadLocalJson("lynncat-blocked-authors", [])),
    messageTimer: null,
  };

  function loadLocalJson(key, fallback) {
    try {
      const parsed = JSON.parse(localStorage.getItem(key));
      return parsed ?? fallback;
    } catch {
      return fallback;
    }
  }

  function getInstallationId() {
    const stored = localStorage.getItem("lynncat-web-installation");
    if (stored) return stored;
    const next = crypto.randomUUID();
    localStorage.setItem("lynncat-web-installation", next);
    return next;
  }

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
  const escapeHTML = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
  })[character]);
  const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));
  const dateLabel = (timestamp) => new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit" }).format(new Date(timestamp));
  const clockLabel = (timestamp) => new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).format(new Date(timestamp));
  const chartTimeLabel = (timestamp, period = state.period, detailed = false) => {
    const options = period === "1d"
      ? { hour: "2-digit", minute: "2-digit", hour12: false }
      : period === "1w"
        ? detailed
          ? { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }
          : { weekday: "short", hour: "2-digit", hour12: false }
        : period === "1y"
          ? { year: "numeric", month: "2-digit" }
          : { month: "2-digit", day: "2-digit" };
    return new Intl.DateTimeFormat("zh-CN", options).format(new Date(timestamp));
  };
  const timeAgo = (timestamp) => {
    const seconds = Math.max(0, (Date.now() - Number(timestamp || Date.now())) / 1000);
    if (seconds < 60) return "刚刚";
    if (seconds < 3600) return `${Math.floor(seconds / 60)}分钟前`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}小时前`;
    return dateLabel(timestamp);
  };
  const signedPercent = (value) => `${Number(value) >= 0 ? "+" : ""}${Number(value || 0).toFixed(2)}%`;

  function formatNumber(value, digits = 2) {
    return new Intl.NumberFormat(REGION[state.region].locale, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    }).format(Number(value || 0));
  }

  function convertedValue(symbol, quote) {
    const rates = state.rates || { CNY: 6.7746, HKD: 7.812, USD: 1 };
    const target = REGION[state.region].currency;
    if (symbol === "DEBT" || symbol === "NASDAQ") return quote.value;
    if (["XAU", "SILVER", "PLATINUM", "PALLADIUM"].includes(symbol) && quote.usd) {
      return target === "USD" ? quote.usd : quote.usd * (rates[target] || 1) / TROY_OUNCE_GRAMS;
    }
    if (["BTC", "ETH", "DOGE", "TRUMP"].includes(symbol) && quote.usd) return quote.usd * (rates[target] || 1);
    if (symbol === "WTI") return quote.value;
    return quote.value;
  }

  function formatQuote(symbol, quote = state.quotes[symbol]) {
    const value = convertedValue(symbol, quote);
    if (symbol === "DEBT") return `$${Number(value).toFixed(2)}T`;
    if (symbol === "NASDAQ") return formatNumber(value, 0);
    if (symbol === "WTI") return `$${formatNumber(value, 2)}`;
    return `${REGION[state.region].symbol}${formatNumber(value, ["BTC", "ETH"].includes(symbol) ? 0 : ASSET_META[symbol]?.decimals ?? 2)}`;
  }

  function displaySeriesValue(symbol, value) {
    const numeric = Number(value);
    const rates = state.rates || { CNY: 6.7746, HKD: 7.812, USD: 1 };
    const target = REGION[state.region].currency;
    if (symbol === "XAU") {
      if (target === "USD") return numeric * TROY_OUNCE_GRAMS / Number(rates.CNY || 1);
      if (target === "HKD") return numeric * Number(rates.HKD || 1) / Number(rates.CNY || 1);
    }
    if (["BTC", "ETH", "DOGE", "TRUMP"].includes(symbol) && target !== "CNY") {
      return numeric * Number(rates[target] || 1) / Number(rates.CNY || 1);
    }
    return numeric;
  }

  function formatSeriesValue(symbol, value, compact = false) {
    const numeric = Number(value);
    if (symbol === "DEBT") return `$${numeric.toFixed(compact ? 2 : 3)}T`;
    if (symbol === "NASDAQ") return formatNumber(numeric, 0);
    if (symbol === "WTI") return `$${formatNumber(numeric, 2)}`;
    const digits = symbol === "BTC" ? 0 : compact ? Math.min(2, ASSET_META[symbol]?.decimals ?? 2) : ASSET_META[symbol]?.decimals ?? 2;
    return `${REGION[state.region].symbol}${formatNumber(numeric, digits)}`;
  }

  function focusWindowMetrics(points) {
    if (!Array.isArray(points) || points.length < 2) {
      return { change: null, label: "正在建立曲线" };
    }
    const first = points[0];
    const last = points.at(-1);
    const elapsed = Math.max(0, last.time - first.time);
    if (elapsed < 1_000 || !(Number(first.value) > 0)) {
      return { change: null, label: "正在建立曲线" };
    }
    return {
      change: (Number(last.value) / Number(first.value) - 1) * 100,
      label: elapsed < 60 * 60_000
        ? `${Math.max(1, Math.round(elapsed / 60_000))}分钟 · ${clockLabel(first.time)}起`
        : `${(elapsed / 60 / 60_000).toFixed(1)}小时 · ${clockLabel(first.time)}起`,
    };
  }

  function debtChangeYi(quote) {
    const rawDollars = Number(quote?.dailyChangeUSD);
    if (Number.isFinite(rawDollars)) return rawDollars / 1e8;
    const billions = Number(quote?.dailyChangeBillions);
    return Number.isFinite(billions) ? billions * 10 : 0;
  }

  function debtSourceLabel(quote, compact = false) {
    const recordTime = quote?.recordDate
      ? Date.parse(`${quote.recordDate}T00:00:00Z`)
      : Number(quote?.updatedAt);
    const date = compact && Number.isFinite(recordTime)
      ? dateLabel(recordTime)
      : quote?.recordDate || (Number.isFinite(recordTime) ? new Date(recordTime).toLocaleDateString("zh-CN") : "日期未知");
    return `${quote?.source || "美国财政部 Fiscal Data"} · ${date}${quote?.isStale ? " · 最近官方缓存" : ""}`;
  }

  async function api(path, options = {}) {
    const headers = new Headers(options.headers || {});
    headers.set("Accept", "application/json");
    if (options.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    if (state.token && options.auth !== false) headers.set("Authorization", `Bearer ${state.token}`);
    const response = await fetch(path, { ...options, headers, cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.error || `HTTP ${response.status}`);
      error.code = payload.error;
      error.status = response.status;
      error.payload = payload;
      throw error;
    }
    return payload;
  }

  function appendFocusLivePoint(symbol, quote, observedAt = Date.now()) {
    if (!LIVE_SPARK_SYMBOLS.includes(symbol)) return;
    const value = Number(quote?.value);
    if (!Number.isFinite(value)) return;
    const points = state.focusLiveSeries[symbol];
    const minimumGap = symbol === "XAU" ? 900
      : symbol === "NASDAQ" ? 2_800
        : symbol === "WTI" ? 7_800
          : 29_000;
    const latest = points.at(-1);
    if (latest && observedAt - latest.time < minimumGap) {
      latest.time = observedAt;
      latest.value = value;
    } else {
      points.push({ time: observedAt, value });
      if (points.length > FOCUS_LIVE_MAX_POINTS) points.splice(0, points.length - FOCUS_LIVE_MAX_POINTS);
    }
  }

  function focusLiveSeriesFor(symbol) {
    return state.focusLiveSeries[symbol] || [];
  }

  async function refreshFocusLiveQuotes(group = "all") {
    if (document.hidden) return;
    const requestKey = `focusLiveRequest:${group}`;
    if (state[requestKey]) return state[requestKey];
    const request = api(`${API_ROOT}/live?group=${encodeURIComponent(group)}`, { auth: false }).then((payload) => {
      if (payload.rates) state.rates = { ...state.rates, ...payload.rates };
      for (const [symbol, quote] of Object.entries(payload.quotes || {})) {
        state.quotes[symbol] = { ...state.quotes[symbol], ...quote };
        if (LIVE_SPARK_SYMBOLS.includes(symbol)) appendFocusLivePoint(symbol, state.quotes[symbol]);
      }
      recalculateGoldDerived();
      renderFocusCards();
      renderSecondaryMarkets();
    }).finally(() => {
      if (state[requestKey] === request) state[requestKey] = null;
    });
    state[requestKey] = request;
    return request;
  }

  function startFocusLiveRefresh() {
    clearInterval(state.focusLiveTimer);
    clearInterval(state.oilLiveTimer);
    clearInterval(state.baseLiveTimer);
    state.focusLiveTimer = setInterval(() => {
      if (state.route === "overview") refreshFocusLiveQuotes("indices").catch(() => {});
    }, FAST_MARKET_REFRESH_MS);
    state.oilLiveTimer = setInterval(() => {
      if (state.route === "overview") refreshFocusLiveQuotes("oil").catch(() => {});
    }, OIL_REFRESH_MS);
    state.baseLiveTimer = setInterval(() => {
      if (state.route === "overview") refreshFocusLiveQuotes("base").catch(() => {});
    }, BASE_MARKET_REFRESH_MS);
  }

  function recalculateGoldDerived() {
    const quote = state.quotes.XAU;
    if (!(Number(quote?.usd) > 0)) return;
    state.quotes.LONDON_GOLD = {
      ...quote,
      value: quote.usd,
      source: "Gold API · XAU/USD 现货",
    };
    state.quotes.SHANGHAI_SPOT = { ...quote, source: "Au99.99 / 现货汇率折算参考" };
    state.quotes.SHANGHAI_FUTURES = { ...quote, source: "沪金连续 / 现货汇率折算参考" };
    state.quotes.SHUIBEI = { ...quote, source: "水贝现货 / Au99.99 参考" };
    if (Number(state.quotes.SILVER?.usd) > 0) {
      state.quotes.GOLD_SILVER = {
        value: quote.usd / state.quotes.SILVER.usd,
        change: Number(quote.change || 0) - Number(state.quotes.SILVER.change || 0),
        source: "XAU 现货 / 白银期货同日比值",
      };
    }
    if (Number(state.quotes.BTC?.usd) > 0) {
      state.quotes.KGBTC = {
        value: quote.usd * (1000 / TROY_OUNCE_GRAMS) / state.quotes.BTC.usd,
        change: Number(quote.change || 0) - Number(state.quotes.BTC.change || 0),
        source: "XAU/BTC 统一换算",
      };
    }
  }

  function applyGoldSpotQuote(payload, options = {}) {
    const price = Number(payload?.price ?? payload?.usd);
    if (!(price > 0)) return false;
    const parsedUpdatedAt = typeof payload.updatedAt === "number"
      ? payload.updatedAt
      : Date.parse(String(payload.updatedAt || ""));
    const updatedAt = Number.isFinite(parsedUpdatedAt) ? parsedUpdatedAt : Date.now();
    const currentUpdatedAt = Number(state.quotes.XAU?.updatedAt || 0);
    if (!options.allowOlder && updatedAt < currentUpdatedAt) return false;
    if (!options.isStale && !(state.goldSessionOpen > 0)) {
      state.goldSessionOpen = price;
      sessionStorage.setItem("lynncat-gold-session-open", String(price));
    }
    const open = state.goldSessionOpen > 0 ? state.goldSessionOpen : price;
    const cnyRate = Number(state.rates?.CNY || fallbackQuotes.USDCNY.value);
    state.quotes.XAU = {
      ...state.quotes.XAU,
      value: price * cnyRate / TROY_OUNCE_GRAMS,
      usd: price,
      change: open > 0 ? (price / open - 1) * 100 : 0,
      source: options.source || "Gold API · XAU 现货 · USD/CNY",
      updatedAt,
      quoteKind: "spot",
      isStale: Boolean(options.isStale),
    };
    state.goldUpdatedAt = Math.max(state.goldUpdatedAt, updatedAt);
    recalculateGoldDerived();
    if (!options.isStale) appendFocusLivePoint("XAU", state.quotes.XAU);
    return true;
  }

  function restoreGoldCache() {
    const cached = loadLocalJson(GOLD_LOCAL_CACHE_KEY, null);
    if (!(Number(cached?.price) > 0)) return;
    applyGoldSpotQuote(cached, {
      isStale: Date.now() - Number(cached.fetchedAt || 0) > GOLD_REFRESH_MS * 3,
      source: "Gold API · XAU 现货 · 本机缓存",
      allowOlder: true,
    });
  }

  async function refreshGoldDirect(force = false) {
    if (state.goldRequest) return state.goldRequest;
    const cached = loadLocalJson(GOLD_LOCAL_CACHE_KEY, null);
    if (!force && Number(cached?.price) > 0 && Date.now() - Number(cached.fetchedAt || 0) < GOLD_REFRESH_MS) {
      applyGoldSpotQuote(cached, { source: "Gold API · XAU 现货 · USD/CNY", allowOlder: true });
      return;
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    const request = fetch(GOLD_PUBLIC_URL, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store",
      credentials: "omit",
      signal: controller.signal,
    }).then(async (response) => {
      if (!response.ok) throw new Error(`Gold API HTTP ${response.status}`);
      const payload = await response.json();
      if (!applyGoldSpotQuote(payload)) throw new Error("Gold API returned an invalid XAU quote");
      try {
        localStorage.setItem(GOLD_LOCAL_CACHE_KEY, JSON.stringify({
          price: Number(payload.price),
          updatedAt: payload.updatedAt,
          fetchedAt: Date.now(),
        }));
      } catch {}
      renderDashboard();
      if (state.currentDetail === "XAU" && state.route === "detail") {
        renderGoldDetail($("#detail-content"), state.detailCache.XAU);
        requestAnimationFrame(() => drawLineChart($("#detail-chart"), seriesFor("XAU"), {
          fill: true, grid: true, padding: 10, lineWidth: 2,
        }));
      }
    }).finally(() => {
      clearTimeout(timeout);
      if (state.goldRequest === request) state.goldRequest = null;
    });
    state.goldRequest = request;
    return request;
  }

  function startGoldRefresh() {
    clearInterval(state.goldRefreshTimer);
    state.goldRefreshTimer = setInterval(() => {
      const isGoldVisible = state.route === "overview"
        || (state.route === "detail" && state.currentDetail === "XAU");
      if (!document.hidden && isGoldVisible) refreshGoldDirect(true).catch(() => {});
    }, GOLD_REFRESH_MS);
  }

  function initializeFallbackHistories() {
    HISTORY_SYMBOLS.forEach((symbol) => { state.histories[symbol] = []; });
    CROSS_HISTORY_SYMBOLS.forEach((symbol) => { state.crossHistories[symbol] = []; });
    const cached = loadLocalJson("lynncat-market-history-v2", null);
    if (cached && Date.now() - Number(cached.updatedAt || 0) < 15 * 60_000 && cached.histories) {
      HISTORY_SYMBOLS.forEach((symbol) => {
        if (Array.isArray(cached.histories[symbol]) && cached.histories[symbol].length >= 2) {
          state.histories[symbol] = cached.histories[symbol];
        }
      });
      state.historyUpdatedAt = Number(cached.updatedAt || 0);
    }
    const cachedCross = loadLocalJson("lynncat-cross-market-history-v1", null);
    if (cachedCross && Date.now() - Number(cachedCross.updatedAt || 0) < 15 * 60_000) {
      CROSS_HISTORY_SYMBOLS.forEach((symbol) => {
        if (Array.isArray(cachedCross.histories?.[symbol]) && cachedCross.histories[symbol].length >= 2) {
          state.crossHistories[symbol] = cachedCross.histories[symbol];
        }
      });
      state.crossHistoryUpdatedAt = Number(cachedCross.updatedAt || 0);
    }
    const cachedDebt = loadLocalJson(DEBT_LOCAL_CACHE_KEY, null);
    if (cachedDebt?.rows?.length >= 2 && applyTreasuryDebtRows(cachedDebt.rows, true)) {
      state.debtUpdatedAt = Number(cachedDebt.fetchedAt || 0);
    }
    const cachedYields = loadLocalJson(TREASURY_YIELDS_LOCAL_CACHE_KEY, null);
    if (cachedYields?.payload?.curve?.length) {
      state.treasuryYields = { ...cachedYields.payload, stale: true };
      state.treasuryYieldsUpdatedAt = Number(cachedYields.fetchedAt || 0);
    }
    restoreGoldCache();
  }

  function normalizeTreasuryDebtRows(rows) {
    return (Array.isArray(rows) ? rows : []).flatMap((row) => {
      const recordDate = String(row?.recordDate || row?.record_date || "");
      const totalDebt = Number(row?.totalDebt ?? row?.tot_pub_debt_out_amt);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(recordDate) || !(totalDebt > 0)) return [];
      return [{ recordDate, totalDebt }];
    }).sort((left, right) => right.recordDate.localeCompare(left.recordDate));
  }

  function applyTreasuryDebtRows(rawRows, isStale) {
    const rows = normalizeTreasuryDebtRows(rawRows);
    if (rows.length < 2) return false;
    const latest = rows[0];
    const previous = rows[1];
    if (state.quotes.DEBT?.recordDate && latest.recordDate < state.quotes.DEBT.recordDate) return false;
    const dailyChangeUSD = latest.totalDebt - previous.totalDebt;
    state.quotes.DEBT = {
      ...state.quotes.DEBT,
      value: latest.totalDebt / 1e12,
      change: previous.totalDebt ? (latest.totalDebt / previous.totalDebt - 1) * 100 : 0,
      dailyChangeUSD,
      dailyChangeBillions: dailyChangeUSD / 1e9,
      recordDate: latest.recordDate,
      updatedAt: Date.parse(`${latest.recordDate}T00:00:00Z`),
      source: "美国财政部 Fiscal Data",
      isStale,
    };
    const ascending = rows.slice(0, 91).reverse();
    if (ascending.length >= 2) {
      state.histories.DEBT = ascending.slice(1).map((row, index) => ({
        time: Date.parse(`${row.recordDate}T00:00:00Z`),
        recordDate: row.recordDate,
        value: row.totalDebt / 1e12,
        dailyChangeUSD: row.totalDebt - ascending[index].totalDebt,
      }));
    }
    if (!isStale) appendFocusLivePoint("DEBT", state.quotes.DEBT);
    return true;
  }

  async function refreshDebtDirect(force = false) {
    if (!force && state.debtRequest) return state.debtRequest;
    if (!force && Date.now() - state.debtUpdatedAt < 5 * 60_000) return;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);
    const request = fetch(DEBT_PUBLIC_URL, {
      cache: "no-store",
      credentials: "omit",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    }).then(async (response) => {
      if (!response.ok) throw new Error(`Fiscal Data HTTP ${response.status}`);
      const payload = await response.json();
      const rows = normalizeTreasuryDebtRows(payload.data);
      if (!applyTreasuryDebtRows(rows, false)) throw new Error("Fiscal Data records unavailable");
      state.debtUpdatedAt = Date.now();
      try {
        localStorage.setItem(DEBT_LOCAL_CACHE_KEY, JSON.stringify({
          fetchedAt: state.debtUpdatedAt,
          rows: rows.slice(0, 91),
        }));
      } catch {}
      renderDashboard();
      if (state.currentDetail === "DEBT") {
        renderDebtDetail($("#detail-content"), state.detailCache.DEBT, state.treasuryYields);
      }
    }).finally(() => {
      clearTimeout(timeout);
      if (state.debtRequest === request) state.debtRequest = null;
    });
    state.debtRequest = request;
    return request;
  }

  async function refreshTreasuryYields(force = false) {
    if (!force && state.treasuryYieldsRequest) return state.treasuryYieldsRequest;
    if (
      !force
      && state.treasuryYields?.curve?.length
      && Date.now() - state.treasuryYieldsUpdatedAt < 30 * 60_000
    ) return state.treasuryYields;

    const request = api("/xxxc/treasury-yields", { auth: false }).then((payload) => {
      if (!Array.isArray(payload?.curve) || !payload.curve.length) {
        throw new Error("Treasury yield curve unavailable");
      }
      state.treasuryYields = payload;
      state.treasuryYieldsUpdatedAt = Date.now();
      try {
        localStorage.setItem(TREASURY_YIELDS_LOCAL_CACHE_KEY, JSON.stringify({
          fetchedAt: state.treasuryYieldsUpdatedAt,
          payload,
        }));
      } catch {}
      return payload;
    }).finally(() => {
      if (state.treasuryYieldsRequest === request) state.treasuryYieldsRequest = null;
    });
    state.treasuryYieldsRequest = request;
    return request;
  }

  function setTheme(theme) {
    state.theme = theme;
    document.documentElement.dataset.theme = theme;
    localStorage.setItem("lynncat-theme", theme);
    $$("[data-theme-value]").forEach((button) => button.classList.toggle("is-active", button.dataset.themeValue === theme));
    requestAnimationFrame(renderAllCharts);
  }

  function setRegion(region) {
    state.region = region;
    localStorage.setItem("lynncat-region", region);
    $$("[data-region]").forEach((button) => button.classList.toggle("is-active", button.dataset.region === region));
    renderDashboard();
    if (state.currentDetail) renderDetail(state.currentDetail);
  }

  function showRoute(route) {
    state.route = route;
    $$(".route-panel").forEach((panel) => panel.classList.toggle("is-active", panel.dataset.panel === route));
    $$(".nav-tab").forEach((button) => button.classList.toggle("is-active", button.dataset.route === route));
    $("#primary-navigation").classList.remove("is-open");
    $("#mobile-nav-toggle").setAttribute("aria-expanded", "false");
    history.replaceState(null, "", route === "overview" ? "/" : `/#${route}`);
    if (route === "tech" || route === "news") loadNews(route === "tech" ? "tech" : "current");
    if (route === "poker") refreshPokerStatus();
    if (route === "cards") refreshCardsStatus();
    if (route === "overview") refreshFocusLiveQuotes().catch(() => {});
    if (route === "overview" || route === "detail") {
      requestAnimationFrame(() => {
        if (route === "overview") renderDashboard();
        if (route === "detail" && state.currentDetail) renderDetail(state.currentDetail);
      });
    }
    clearInterval(state.messageTimer);
    state.messageTimer = route === "detail"
      ? setInterval(() => { if (!document.hidden && state.currentRoom) loadMessages(state.currentRoom, false); }, 5_000)
      : null;
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function filterHistory(points, period = state.period) {
    if (!Array.isArray(points) || points.length < 2) return points || [];
    const sorted = [...points].sort((left, right) => Number(left.time) - Number(right.time));
    const latest = Number(sorted.at(-1).time);
    const cutoff = {
      "1d": latest - 86_400_000,
      "1w": latest - 7 * 86_400_000,
      "1m": latest - 31 * 86_400_000,
      "1y": latest - 366 * 86_400_000,
    }[period] ?? latest - 31 * 86_400_000;
    const filtered = sorted.filter((point) => Number(point.time) >= cutoff && Number(point.time) <= latest);
    return filtered.length >= 2 ? filtered : sorted.slice(-2);
  }

  function seriesFor(symbol, period = state.period) {
    return filterHistory(state.histories[symbol] || [], period);
  }

  function crossSeriesFor(symbol, period = state.monitorPeriod) {
    const points = state.crossHistories[symbol]?.length
      ? state.crossHistories[symbol]
      : state.histories[symbol];
    return filterHistory(points || [], period);
  }

  function canvasSetup(canvas) {
    const rect = canvas.getBoundingClientRect();
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    const width = Math.max(10, rect.width);
    const height = Math.max(10, rect.height);
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    const context = canvas.getContext("2d");
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    return { context, width, height };
  }

  function cssColor(name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }

  function drawLineChart(canvas, points, options = {}) {
    if (!canvas) return null;
    const { context, width, height } = canvasSetup(canvas);
    context.clearRect(0, 0, width, height);
    if (!points?.length) return null;
    const normalizedPoints = points
      .map((point) => ({ time: Number(point.time), value: Number(point.value) }))
      .filter((point) => Number.isFinite(point.time) && Number.isFinite(point.value))
      .sort((left, right) => left.time - right.time);
    if (!normalizedPoints.length) return null;
    const suppliedPadding = options.padding ?? 7;
    const padding = typeof suppliedPadding === "number"
      ? { top: suppliedPadding, right: suppliedPadding, bottom: suppliedPadding, left: suppliedPadding }
      : {
          top: suppliedPadding.top ?? 8,
          right: suppliedPadding.right ?? 8,
          bottom: suppliedPadding.bottom ?? 8,
          left: suppliedPadding.left ?? 8,
        };
    const plot = {
      left: padding.left,
      right: width - padding.right,
      top: padding.top,
      bottom: height - padding.bottom,
    };
    plot.width = Math.max(1, plot.right - plot.left);
    plot.height = Math.max(1, plot.bottom - plot.top);
    const values = normalizedPoints.map((point) => point.value);
    const scaleValues = (Array.isArray(options.scaleValues) ? options.scaleValues : values)
      .map(Number)
      .filter(Number.isFinite);
    const rawMin = Math.min(...scaleValues);
    const rawMax = Math.max(...scaleValues);
    const reference = Math.max(Math.abs(values[0]), Math.abs(values.at(-1)), 1);
    const observedSpan = rawMax - rawMin;
    const minimumSpan = Math.max(reference * (options.minimumSpanRatio ?? 0.001), 0.000001);
    const span = Math.max(observedSpan, minimumSpan);
    const scaleMin = rawMin - Math.max(0, span - observedSpan) / 2;
    const scaleMax = rawMax + Math.max(0, span - observedSpan) / 2;
    const minimum = scaleMin - span * (options.verticalPadding ?? 0.12);
    const maximum = scaleMax + span * (options.verticalPadding ?? 0.12);
    const firstTime = normalizedPoints[0].time;
    const lastTime = normalizedPoints.at(-1).time;
    const timeSpan = lastTime - firstTime;
    const coordinate = (point, index) => ({
      x: normalizedPoints.length === 1
        ? plot.left + plot.width / 2
        : plot.left + (timeSpan > 0 ? (point.time - firstTime) / timeSpan : index / (normalizedPoints.length - 1)) * plot.width,
      y: plot.top + (maximum - point.value) / (maximum - minimum) * plot.height,
    });
    const coordinates = normalizedPoints.map(coordinate);
    const line = options.color || (values.at(-1) >= values[0] ? cssColor("--up") : cssColor("--down"));
    const tracePath = () => {
      context.moveTo(coordinates[0].x, coordinates[0].y);
      for (let index = 0; index < coordinates.length - 1; index += 1) {
        const previous = coordinates[index - 1] || coordinates[index];
        const current = coordinates[index];
        const next = coordinates[index + 1];
        const following = coordinates[index + 2] || next;
        if (options.smooth === false) {
          context.lineTo(next.x, next.y);
          continue;
        }
        context.bezierCurveTo(
          current.x + (next.x - previous.x) / 6,
          clamp(current.y + (next.y - previous.y) / 6, plot.top, plot.bottom),
          next.x - (following.x - current.x) / 6,
          clamp(next.y - (following.y - current.y) / 6, plot.top, plot.bottom),
          next.x,
          next.y
        );
      }
    };

    if (options.grid) {
      context.strokeStyle = cssColor("--separator");
      context.lineWidth = 0.7;
      context.font = "500 9px ui-monospace, SFMono-Regular, Menlo, monospace";
      context.textAlign = "right";
      context.textBaseline = "middle";
      for (let index = 0; index <= 4; index += 1) {
        const y = plot.top + index / 4 * plot.height;
        context.beginPath(); context.moveTo(plot.left, y); context.lineTo(plot.right, y); context.stroke();
        if (options.formatAxisValue) {
          const axisValue = maximum - index / 4 * (maximum - minimum);
          context.fillStyle = cssColor("--ink-dim");
          context.fillText(options.formatAxisValue(axisValue), width - 3, y);
        }
      }
    }

    if (options.fill && coordinates.length > 1) {
      context.beginPath();
      tracePath();
      context.lineTo(coordinates.at(-1).x, plot.bottom);
      context.lineTo(coordinates[0].x, plot.bottom);
      context.closePath();
      const gradient = context.createLinearGradient(0, plot.top, 0, plot.bottom);
      gradient.addColorStop(0, colorWithAlpha(line, options.fillAlpha ?? 0.18));
      gradient.addColorStop(1, colorWithAlpha(line, 0.015));
      context.fillStyle = gradient;
      context.fill();
    }

    if (options.baseline && coordinates.length > 1) {
      const baselineY = plot.top + (maximum - values[0]) / (maximum - minimum) * plot.height;
      context.save();
      context.setLineDash([4, 4]);
      context.strokeStyle = colorWithAlpha(cssColor("--ink-dim"), 0.55);
      context.lineWidth = 0.8;
      context.beginPath();
      context.moveTo(plot.left, baselineY);
      context.lineTo(plot.right, baselineY);
      context.stroke();
      context.restore();
    }

    context.save();
    context.strokeStyle = line;
    context.lineWidth = options.lineWidth || 1.6;
    context.lineJoin = "round";
    context.lineCap = "round";
    context.beginPath();
    tracePath();
    if (coordinates.length > 1) context.stroke();
    context.restore();

    if (options.endpoint) {
      const lastPoint = coordinates.at(-1);
      context.beginPath();
      context.arc(lastPoint.x, lastPoint.y, options.endpointRadius ?? 2.7, 0, Math.PI * 2);
      context.fillStyle = cssColor("--surface-solid");
      context.fill();
      context.strokeStyle = line;
      context.lineWidth = 1.7;
      context.stroke();
    }

    const crosshairIndex = Number(options.crosshairIndex);
    if (Number.isInteger(crosshairIndex) && coordinates[crosshairIndex]) {
      const active = coordinates[crosshairIndex];
      context.save();
      context.setLineDash([3, 3]);
      context.strokeStyle = colorWithAlpha(cssColor("--ink-dim"), 0.68);
      context.lineWidth = 0.8;
      context.beginPath();
      context.moveTo(active.x, plot.top);
      context.lineTo(active.x, plot.bottom);
      context.moveTo(plot.left, active.y);
      context.lineTo(plot.right, active.y);
      context.stroke();
      context.restore();
      context.beginPath();
      context.arc(active.x, active.y, 4, 0, Math.PI * 2);
      context.fillStyle = line;
      context.fill();
      context.strokeStyle = cssColor("--surface-solid");
      context.lineWidth = 2;
      context.stroke();
    }

    return { coordinates, points: normalizedPoints, plot, minimum, maximum, color: line };
  }

  function drawBarChart(canvas, points) {
    if (!canvas || !points?.length) return;
    const { context, width, height } = canvasSetup(canvas);
    context.clearRect(0, 0, width, height);
    const maximum = Math.max(...points.map((point) => Math.abs(Number(point.value))), 1);
    const baseline = height / 2;
    const gap = 4;
    const barWidth = Math.max(3, (width - gap * (points.length + 1)) / points.length);
    points.forEach((point, index) => {
      const value = Number(point.value);
      const barHeight = Math.abs(value) / maximum * (height / 2 - 10);
      context.fillStyle = value >= 0 ? cssColor("--up") : cssColor("--down");
      context.fillRect(gap + index * (barWidth + gap), value >= 0 ? baseline - barHeight : baseline, barWidth, barHeight);
    });
    context.strokeStyle = cssColor("--separator");
    context.beginPath();
    context.moveTo(0, baseline);
    context.lineTo(width, baseline);
    context.stroke();
  }

  function colorWithAlpha(color, alpha) {
    if (color.startsWith("#")) {
      const hex = color.slice(1);
      const expanded = hex.length === 3 ? [...hex].map((character) => character + character).join("") : hex;
      const value = Number.parseInt(expanded, 16);
      return `rgba(${value >> 16},${value >> 8 & 255},${value & 255},${alpha})`;
    }
    return color.replace("rgb(", "rgba(").replace(")", `,${alpha})`);
  }

  function renderFocusCards() {
    ASSET_ORDER.forEach((symbol) => {
      const quote = state.quotes[symbol] || fallbackQuotes[symbol];
      const value = $(`[data-quote-value="${symbol}"]`);
      const change = $(`[data-quote-change="${symbol}"]`);
      const source = $(`[data-quote-source="${symbol}"]`);
      const points = symbol === "DEBT" ? seriesFor("DEBT", "1w") : focusLiveSeriesFor(symbol);
      const chartPoints = points.length === 1
        ? [{ time: points[0].time - 1_000, value: points[0].value }, points[0]]
        : points;
      const liveMetrics = focusWindowMetrics(points);
      const direction = symbol === "DEBT" ? Number(quote.change || 0) : Number(liveMetrics.change || 0);
      if (value) value.textContent = formatQuote(symbol, quote);
      if (change) {
        if (symbol === "DEBT") {
          const amount = debtChangeYi(quote);
          change.textContent = `${amount >= 0 ? "+" : "-"}${formatNumber(Math.abs(amount), 2)} 亿 / 日`;
        } else {
          change.textContent = liveMetrics.change === null ? "—" : signedPercent(liveMetrics.change);
        }
        change.className = `focus-change ${direction >= 0 ? "up" : "down"}`;
      }
      if (source) {
        if (symbol === "DEBT") source.textContent = `财政部 · 近7天 · ${quote.recordDate || "最新官方记录"}`;
        else if (symbol === "NASDAQ") source.textContent = "纳斯达克综合指数 · 点";
        else if (symbol === "WTI") source.textContent = "WTI · 美元 / 桶";
        else if (symbol === "XAU") source.textContent = state.region === "us" ? "美元 / 金衡盎司" : `${REGION[state.region].currency === "HKD" ? "港币" : "人民币"} / 克`;
        else if (symbol === "BTC") source.textContent = `${REGION[state.region].currency === "USD" ? "美元" : REGION[state.region].currency === "HKD" ? "港币" : "人民币"} / 枚`;
      }
      const sparkline = $(`[data-sparkline="${symbol}"]`);
      const card = sparkline?.closest(".focus-card");
      card?.classList.toggle("is-up", direction >= 0);
      card?.classList.toggle("is-down", direction < 0);
      drawLineChart(sparkline, chartPoints, {
        fill: true,
        fillAlpha: 0.22,
        padding: 2,
        lineWidth: 1.6,
        minimumSpanRatio: 0.0016,
        verticalPadding: 0.12,
      });
    });
  }

  function drawTrendChart() {
    const symbol = state.trendAsset;
    state.trendChartGeometry = drawLineChart($("#trend-chart"), state.trendChartPoints, {
      fill: true,
      fillAlpha: 0.28,
      grid: true,
      padding: { top: 10, right: 68, bottom: 8, left: 8 },
      lineWidth: 2,
      minimumSpanRatio: 0.0016,
      verticalPadding: 0.12,
      scaleValues: state.trendChartPoints.flatMap((point) => [point.low ?? point.value, point.high ?? point.value]),
      formatAxisValue: (value) => formatSeriesValue(symbol, value, true),
    });
    return state.trendChartGeometry;
  }

  function renderTrend() {
    const symbol = state.trendAsset;
    const points = seriesFor(symbol).map((point) => ({
      time: Number(point.time),
      value: displaySeriesValue(symbol, point.value),
      high: displaySeriesValue(symbol, point.high ?? point.value),
      low: displaySeriesValue(symbol, point.low ?? point.value),
    }));
    if (!points.length) {
      state.trendChartPoints = [];
      $("#trend-name").textContent = ASSET_META[symbol].name;
      $("#trend-value").textContent = formatQuote(symbol, state.quotes[symbol]);
      $("#trend-change").textContent = "—";
      $("#trend-change").className = "";
      $("#trend-high").textContent = "—";
      $("#trend-low").textContent = "—";
      drawTrendChart();
      return;
    }
    const values = points.map((point) => point.value);
    const rising = values.at(-1) >= values[0];
    state.trendChartPoints = points;
    $("#trend-name").textContent = ASSET_META[symbol].name;
    $("#trend-value").textContent = formatQuote(symbol, state.quotes[symbol]);
    $("#trend-change").textContent = signedPercent((values.at(-1) / values[0] - 1) * 100);
    $("#trend-change").className = rising ? "up" : "down";
    $("#trend-high").textContent = formatSeriesValue(symbol, Math.max(...points.map((point) => point.high)));
    $("#trend-low").textContent = formatSeriesValue(symbol, Math.min(...points.map((point) => point.low)));
    drawTrendChart();
  }

  function renderMonitor() {
    const group = MONITOR_GROUPS[state.monitorCategory];
    $("#monitor-list").innerHTML = group.map(([symbol, name, source]) => {
      const points = crossSeriesFor(symbol, state.monitorPeriod);
      const historicalValue = Number(points.at(-1)?.value);
      const quote = state.quotes[symbol];
      if (!quote && !Number.isFinite(historicalValue)) return "";
      const first = Number(points[0]?.value);
      const last = Number(points.at(-1)?.value);
      const periodChange = first > 0 && Number.isFinite(last) ? (last / first - 1) * 100 : null;
      const detailSymbol = symbol === "SSE" ? "CN_STOCKS"
        : symbol === "HSI" ? "HK_STOCKS"
          : symbol === "N225" ? "JP_STOCKS"
            : symbol === "KOSPI" ? "KR_STOCKS"
              : symbol === "TWII" ? "TW_STOCKS"
                : symbol === "NIFTY" ? "IN_STOCKS"
                  : "";
      const clickable = Boolean(detailSymbol);
      const detailLabel = `查看${name}市场详情`;
      const tag = clickable ? "button" : "div";
      return `<${tag} class="monitor-row${clickable ? " is-clickable" : ""}" ${clickable ? `type="button" data-monitor-detail="${detailSymbol}" aria-label="${detailLabel}"` : ""}>
        <span><strong>${escapeHTML(name)}</strong><small>${escapeHTML(source)}</small></span>
        <canvas data-monitor-chart="${symbol}" aria-label="${escapeHTML(name)}走势"></canvas>
        <span class="monitor-value">${formatMonitorValue(symbol, Number.isFinite(historicalValue) ? historicalValue : quote.value)}<em class="${Number(periodChange || 0) >= 0 ? "up" : "down"}">${periodChange === null ? "—" : signedPercent(periodChange)}</em></span>
      </${tag}>`;
    }).join("") || `<div class="empty-monitor">当前分类暂无数据</div>`;
    $$("[data-monitor-chart]").forEach((canvas) => drawLineChart(canvas, crossSeriesFor(canvas.dataset.monitorChart, state.monitorPeriod), {
      fill: true, fillAlpha: 0.12, padding: 2, lineWidth: 1.2, verticalPadding: 0.12,
    }));
  }

  function formatMonitorValue(symbol, value) {
    if (symbol === "COMEX_GOLD") return `$${formatNumber(value, 2)}`;
    if (symbol === "BTC") return formatQuote(symbol, { ...state.quotes[symbol], value });
    if (symbol === "WTI") return `$${formatNumber(value, 2)}`;
    if (["USDCNY", "USDHKD", "USDEUR", "USDGBP", "USDJPY", "USDKRW", "USDRUB", "USDINR", "KGBTC", "GOLD_SILVER"].includes(symbol)) return formatNumber(value, value < 10 ? 4 : 2);
    if (["SILVER", "PLATINUM", "PALLADIUM", "BRENT", "NATGAS", "RBOB", "LONDON_GOLD"].includes(symbol)) return `$${formatNumber(value, symbol === "RBOB" ? 3 : 2)}`;
    if (["CN92", "CN95", "CN98", "CN0D", "SHANGHAI_SPOT", "SHANGHAI_FUTURES", "SHUIBEI"].includes(symbol)) return `¥${formatNumber(value, 2)}`;
    return formatNumber(value, 0);
  }

  function fallbackEconomicEvents() {
    return [
      { date: Date.now(), tag: "宏观", titleCN: "美国消费者信心", impact: "中", descCN: "关注消费韧性与风险偏好的变化。", source: "Nasdaq" },
      { date: Date.now() + 86_400_000, tag: "FOMC", titleCN: "美联储政策指引", impact: "高", descCN: "措辞偏鹰或偏鸽会直接影响美元、美债收益率、黄金和美股估值。", source: "Nasdaq" },
      { date: Date.now() + 172_800_000, tag: "通胀", titleCN: "美国核心 PCE", impact: "高", descCN: "通胀路径将影响降息预期和实际利率。", source: "Nasdaq" },
    ];
  }

  function renderEvents() {
    const events = (state.events.length ? state.events : fallbackEconomicEvents()).slice(0, 6);
    $("#events-list").innerHTML = events.map((event) => `<div class="event-row">
      <time>${dateLabel(event.date || event.timestamp)}</time>
      <span class="event-tag">${escapeHTML(event.tag || "宏观")}</span>
      <div><strong>${escapeHTML(event.titleCN || event.title)}</strong><p>${escapeHTML(event.descCN || event.description || "")}</p></div>
      <span class="impact ${event.impact === "高" ? "high" : "medium"}">影响：${escapeHTML(event.impact || "中")}</span>
    </div>`).join("");
  }

  function renderSecondaryMarkets() {
    const assets = [
      ["SILVER", "bi-moon-stars", "XAG"], ["PLATINUM", "bi-gem", "XPT"],
      ["PALLADIUM", "bi-diamond", "XPD"], ["ETH", "bi-coin", "ETH"],
      ["DOGE", "bi-currency-exchange", "DOGE"], ["TRUMP", "bi-stars", "TRUMP"],
    ];
    $("#secondary-grid").innerHTML = assets.map(([symbol, icon, code]) => {
      const quote = state.quotes[symbol] || fallbackQuotes[symbol];
      const points = focusLiveSeriesFor(symbol);
      const session = focusWindowMetrics(points);
      return `<button class="secondary-card" data-secondary-detail="${symbol}" type="button">
        <i class="bi ${icon}"></i><span><strong>${escapeHTML(ASSET_META[symbol].name)}</strong><small>${code}</small></span>
        <b>${formatQuote(symbol, quote)}</b><small class="${Number(session.change || 0) >= 0 ? "up" : "down"}">${session.change === null ? "—" : signedPercent(session.change)}</small>
        <canvas data-secondary-chart="${symbol}" aria-label="${escapeHTML(ASSET_META[symbol].name)}本次运行走势"></canvas>
      </button>`;
    }).join("");
    $("#secondary-updated").textContent = `更新于 ${new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(new Date())}`;
    $$("[data-secondary-detail]").forEach((button) => button.addEventListener("click", () => {
      renderDetail(button.dataset.secondaryDetail);
      showRoute("detail");
    }));
    $$("[data-secondary-chart]").forEach((canvas) => {
      const points = focusLiveSeriesFor(canvas.dataset.secondaryChart);
      const chartPoints = points.length === 1
        ? [{ time: points[0].time - 1_000, value: points[0].value }, points[0]]
        : points;
      drawLineChart(canvas, chartPoints, {
        fill: true, fillAlpha: 0.22, padding: 2, lineWidth: 1.6, verticalPadding: 0.12,
      });
    });
  }

  function renderGoldReserves() {
    const points = state.goldReserves.length ? state.goldReserves : [
      ["2025-06", 7390], ["2025-07", 7395], ["2025-08", 7400], ["2025-09", 7406],
      ["2025-10", 7409], ["2025-11", 7412], ["2025-12", 7415], ["2026-01", 7419],
      ["2026-02", 7422], ["2026-03", 7438], ["2026-04", 7464], ["2026-05", 7496], ["2026-06", 7544],
    ].map(([month, totalWanOz]) => ({ month, totalWanOz }));
    const latest = points.at(-1);
    const previous = points.at(-2);
    $("#reserve-total").textContent = formatNumber(latest.totalWanOz, 0);
    $("#reserve-change").textContent = `+${formatNumber(latest.totalWanOz - previous.totalWanOz, 0)}`;
    $("#reserve-axis").innerHTML = `<span>${escapeHTML(points[0].month)}</span><span>${escapeHTML(points[Math.floor(points.length / 2)].month)}</span><span>${escapeHTML(latest.month)}</span>`;
    drawLineChart($("#reserve-chart"), points.map((point) => ({
      time: Date.parse(`${point.month}-01T00:00:00Z`), value: point.totalWanOz,
    })), { fill: true, grid: true, padding: 7, lineWidth: 1.8, color: cssColor("--amber") });
  }

  function renderOverviewIntelligence() {
    const fallbacks = { tech: fallbackNews.tech, current: fallbackNews.current };
    ["tech", "current"].forEach((type) => {
      const items = (state.news[type].length ? state.news[type] : fallbacks[type]).slice(0, 4);
      $(`#overview-${type}-feed`).innerHTML = items.map((item) => `<a class="intelligence-row" href="${escapeHTML(item.url || "#")}" target="_blank" rel="noopener noreferrer"><strong>${escapeHTML(item.title)}</strong><span><b>${escapeHTML(item.source || "Lynncat")}</b><time>${timeAgo(item.publishedAt)}</time></span></a>`).join("");
    });
  }

  function renderDashboard() {
    renderFocusCards();
    renderSecondaryMarkets();
    renderTrend();
    renderMonitor();
    renderEvents();
    renderGoldReserves();
    renderOverviewIntelligence();
    checkPriceAlerts();
  }

  function renderAllCharts() {
    renderDashboard();
    if (state.currentDetail) renderDetail(state.currentDetail);
  }

  async function refreshHistories(force = false) {
    if (!force && state.historyRequest) return state.historyRequest;
    if (!force && Date.now() - state.historyUpdatedAt < 5 * 60_000) return;
    const mainRequests = HISTORY_SYMBOLS.filter((symbol) => symbol !== "DEBT").map(async (symbol) => {
      const history = await api(`${API_ROOT}/history?symbol=${encodeURIComponent(symbol)}&period=1y`, { auth: false });
      if (history.points?.length) state.histories[symbol] = history.points;
    });
    const request = Promise.allSettled(mainRequests).then(() => {
      state.historyUpdatedAt = Date.now();
      try {
        localStorage.setItem("lynncat-market-history-v2", JSON.stringify({
          updatedAt: state.historyUpdatedAt,
          histories: Object.fromEntries(HISTORY_SYMBOLS.map((symbol) => [symbol, state.histories[symbol]])),
        }));
      } catch {}
      renderDashboard();
    }).finally(() => {
      if (state.historyRequest === request) state.historyRequest = null;
    });
    state.historyRequest = request;
    return request;
  }

  async function refreshCrossHistories(force = false) {
    if (!force && state.crossHistoryRequest) return state.crossHistoryRequest;
    if (!force && Date.now() - state.crossHistoryUpdatedAt < 5 * 60_000) return;
    const request = api(`${API_ROOT}/cross-history?v=20260730i`, { auth: false }).then((payload) => {
      Object.entries(payload.histories || {}).forEach(([symbol, points]) => {
        if (CROSS_HISTORY_SYMBOLS.includes(symbol) && Array.isArray(points) && points.length >= 2) {
          state.crossHistories[symbol] = points;
        }
      });
      state.crossHistoryUpdatedAt = Date.now();
      try {
        localStorage.setItem("lynncat-cross-market-history-v1", JSON.stringify({
          updatedAt: state.crossHistoryUpdatedAt,
          histories: Object.fromEntries(CROSS_HISTORY_SYMBOLS.map((symbol) => [symbol, state.crossHistories[symbol]])),
        }));
      } catch {}
      renderMonitor();
    }).finally(() => {
      if (state.crossHistoryRequest === request) state.crossHistoryRequest = null;
    });
    state.crossHistoryRequest = request;
    return request;
  }

  async function refreshDashboard(showFeedback = false) {
    $("#refresh-all-button i").classList.add("spin");
    const debtRefresh = refreshDebtDirect(showFeedback);
    debtRefresh?.catch(() => {});
    const goldRefresh = refreshGoldDirect(showFeedback);
    goldRefresh?.catch(() => {});
    try {
      const historyRefresh = refreshHistories(showFeedback);
      historyRefresh?.catch(() => {});
      const crossHistoryRefresh = refreshCrossHistories(showFeedback);
      crossHistoryRefresh?.catch(() => {});
      const payload = await api(`${API_ROOT}/dashboard`, { auth: false });
      if (payload.rates) state.rates = payload.rates;
      Object.entries(payload.quotes || {}).forEach(([symbol, quote]) => {
        if (symbol === "DEBT" && state.quotes.DEBT?.recordDate && quote.recordDate < state.quotes.DEBT.recordDate) return;
        if (symbol === "XAU") {
          applyGoldSpotQuote(quote, {
            isStale: Boolean(quote.isStale),
            source: quote.source || "Gold API · XAU 现货 · USD/CNY",
          });
          return;
        }
        state.quotes[symbol] = { ...state.quotes[symbol], ...quote };
        if (LIVE_SPARK_SYMBOLS.includes(symbol) && !quote.isStale) {
          appendFocusLivePoint(symbol, state.quotes[symbol]);
        }
      });
      recalculateGoldDerived();
      if (Array.isArray(payload.events)) state.events = payload.events;
      if (Array.isArray(payload.goldReserves)) state.goldReserves = payload.goldReserves;
      renderDashboard();
      if (showFeedback) await Promise.allSettled([historyRefresh, crossHistoryRefresh, debtRefresh, goldRefresh]);
      Promise.allSettled([loadNews("tech"), loadNews("current")]).then(renderOverviewIntelligence);
      if (showFeedback) toast("行情与事件已更新");
    } catch (error) {
      renderDashboard();
      if (showFeedback) toast("实时接口暂不可用，已保留最近数据");
    } finally {
      $("#refresh-all-button i").classList.remove("spin");
    }
  }

  const fallbackNews = {
    tech: [
      { category: "深科技", source: "Solidot", title: "AI 安全智能体正在改变软件漏洞发现方式", summary: "多智能体协作与自动验证正成为安全研究的新工作流。", publishedAt: Date.now() - 3600000, image: "/itnew/assets/fallback/ai.png", url: "/itnew/" },
      { category: "资讯", source: "量子位", title: "国产 AI 底座与端侧模型继续加速", summary: "从推理框架到终端硬件，新的产品组合正在缩短模型落地周期。", publishedAt: Date.now() - 7200000, image: "/itnew/assets/fallback/chips.png", url: "/itnew/" },
      { category: "深科技", source: "MIT Technology Review", title: "Robotics enters a new phase of practical deployment", summary: "Industrial and service robots are moving from demonstrations into repeatable workflows.", publishedAt: Date.now() - 10800000, image: "/itnew/assets/fallback/robotics.png", url: "/itnew/" },
    ],
    current: [
      { category: "财经时事", source: "FT中文网", title: "全球市场继续评估政策与增长的平衡", summary: "投资者关注主要经济体的财政、利率与产业政策变化。", publishedAt: Date.now() - 5400000, url: "https://www.ftchinese.com/" },
      { category: "财经时事", source: "Reuters", title: "Major markets weigh inflation and central-bank signals", summary: "Rates, currencies and commodities react to incoming economic data.", publishedAt: Date.now() - 9000000, url: "https://www.reuters.com/" },
      { category: "世界", source: "Al Jazeera", title: "Energy security returns to the global agenda", summary: "Oil supply, shipping routes and regional risks remain important market drivers.", publishedAt: Date.now() - 14400000, url: "https://www.aljazeera.com/" },
    ],
  };

  async function loadNews(type, force = false) {
    const key = type === "tech" ? "tech" : "current";
    const target = $(`#${key === "tech" ? "tech" : "current"}-news-list`);
    if (state.news[key].length && !force) return renderNews(key);
    target.innerHTML = `<div class="loading-card"></div><div class="loading-card"></div><div class="loading-card"></div>`;
    try {
      const payload = await api(`${API_ROOT}/news?type=${key}${force ? `&_refresh=${Date.now()}` : ""}`, { auth: false });
      state.news[key] = payload.items?.length ? payload.items : fallbackNews[key];
    } catch {
      state.news[key] = fallbackNews[key];
    }
    renderNews(key);
  }

  function renderNews(type) {
    const target = $(`#${type === "tech" ? "tech" : "current"}-news-list`);
    target.innerHTML = state.news[type].map((item) => `<article class="news-card ${item.image ? "" : "no-image"}">
      ${item.image ? `<img class="news-image" src="${escapeHTML(item.image)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ""}
      <div class="news-copy">
        <div class="news-meta"><span class="news-tag">${escapeHTML(item.category || (type === "tech" ? "科技" : "时事"))}</span><span>${escapeHTML(item.source || "Lynncat")}</span></div>
        <h2>${escapeHTML(item.title)}</h2><p>${escapeHTML(item.summary || "")}</p>
      </div>
      <time>${timeAgo(item.publishedAt)}</time>
      <a class="news-link" href="${escapeHTML(item.url || "#")}" target="_blank" rel="noopener noreferrer"><i class="bi bi-compass"></i> 打开原文</a>
    </article>`).join("");
    const updated = $(`[data-news-updated="${type}"]`);
    if (updated) updated.textContent = `更新于 ${new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date())}`;
    renderOverviewIntelligence();
  }

  async function renderDetail(symbol) {
    state.currentDetail = symbol;
    const specialized = symbol === "NASDAQ" ? "US_STOCKS"
      : symbol === "WTI" ? "OIL"
        : symbol === "SSE" ? "CN_STOCKS"
          : symbol === "HSI" ? "HK_STOCKS"
            : symbol === "N225" ? "JP_STOCKS"
              : symbol === "KOSPI" ? "KR_STOCKS"
                : symbol === "TWII" ? "TW_STOCKS"
                  : symbol === "NIFTY" ? "IN_STOCKS"
                    : symbol;
    state.currentRoom = ASSET_META[symbol]?.room || specialized;
    $("#detail-title").textContent = ASSET_META[symbol]?.name || symbol;
    $("#detail-symbol").textContent = symbol;
    $("#community-room-name").textContent = ASSET_META[symbol]?.name || symbol;
    const target = $("#detail-content");
    target.innerHTML = `<div class="loading-card"></div><div class="loading-card"></div>`;
    if (symbol === "EVENTS") {
      await renderEventsDetail(target);
    } else if (symbol === "DEBT") {
      renderDebtDetail(target, state.detailCache.DEBT, state.treasuryYields);
      const detailsRequest = state.detailCache.DEBT
        ? Promise.resolve(state.detailCache.DEBT)
        : api(`${API_ROOT}/details?symbol=DEBT`, { auth: false }).then((details) => {
          state.detailCache.DEBT = details;
          return details;
        });
      const yieldsRequest = refreshTreasuryYields(false);
      yieldsRequest.then(() => {
        if (state.currentDetail === "DEBT") {
          renderDebtDetail(target, state.detailCache.DEBT, state.treasuryYields);
        }
      }).catch(() => {});
      Promise.allSettled([
        refreshDebtDirect(false),
        yieldsRequest,
        detailsRequest,
      ]).then(() => {
        if (state.currentDetail !== "DEBT") return;
        renderDebtDetail(target, state.detailCache.DEBT, state.treasuryYields);
      });
    } else {
      let details = null;
      if (["NASDAQ", "WTI", "XAU", "CN_STOCKS", "HK_STOCKS", "JP_STOCKS", "KR_STOCKS", "TW_STOCKS", "IN_STOCKS"].includes(symbol)) {
        try {
          details = state.detailCache[specialized] || await api(`${API_ROOT}/details?symbol=${encodeURIComponent(specialized)}`, { auth: false });
          state.detailCache[specialized] = details;
        } catch {}
      }
      if (symbol === "NASDAQ") renderUSStocksDetail(target, details);
      else if (symbol === "WTI") renderOilDetail(target, details);
      else if (symbol === "XAU") renderGoldDetail(target, details);
      else if (symbol === "CN_STOCKS") renderChinaStocksDetail(target, details);
      else if (symbol === "HK_STOCKS") renderHongKongStocksDetail(target, details);
      else if (["JP_STOCKS", "KR_STOCKS", "TW_STOCKS", "IN_STOCKS"].includes(symbol)) renderRegionalStocksDetail(target, details);
      else renderGenericDetail(target, symbol);
    }
    requestAnimationFrame(() => {
      const canvas = $("#detail-chart");
      const isRealtimeAsset = LIVE_SPARK_SYMBOLS.includes(symbol);
      if (canvas) drawLineChart(canvas, state.detailChartPoints || seriesFor(symbol), {
        fill: true,
        fillAlpha: isRealtimeAsset ? 0.22 : 0.28,
        grid: !isRealtimeAsset,
        padding: isRealtimeAsset ? 2 : 10,
        lineWidth: 2,
        verticalPadding: 0.12,
      });
      state.detailChartPoints = null;
    });
    loadMessages(state.currentRoom);
  }

  async function renderEventsDetail(target) {
    if (!state.eventsLoaded) {
      target.innerHTML = `<div class="loading-card"></div><div class="loading-card"></div>`;
      try {
        const payload = await api(`${API_ROOT}/events?days=45`, { auth: false });
        state.eventsFull = payload.events || [];
      } catch {
        state.eventsFull = state.events;
      }
      state.eventsLoaded = true;
    }
    const events = (state.eventsFull.length ? state.eventsFull : state.events.length ? state.events : fallbackEconomicEvents())
      .filter((event) => state.eventImpactFilter === "all" || event.impact === "高");
    target.innerHTML = `<div class="detail-hero"><div><h1>近期重要事件 <span class="symbol-chip">EVENTS</span></h1><p>未来 45 天美国宏观经济日历与跨资产影响</p></div><div class="detail-source">Nasdaq Economic Calendar<br>${events.length} 个相关事件</div></div>
      <div class="detail-chart-card"><div class="panel-heading"><div><h2>事件日历</h2><p>与 Mac 客户端相同的 45 天窗口</p></div><div class="segmented detail-filter"><button data-event-filter="all" class="${state.eventImpactFilter === "all" ? "is-active" : ""}">全部</button><button data-event-filter="high" class="${state.eventImpactFilter === "high" ? "is-active" : ""}">高影响</button></div></div>
      <div class="detail-events">${events.map(eventRowHTML).join("") || `<div class="message-empty">当前筛选条件下没有事件。</div>`}</div></div>`;
  }

  function eventRowHTML(event) {
    return `<div class="event-row"><time>${dateLabel(event.date || event.timestamp)}</time><span class="event-tag">${escapeHTML(event.tag || "宏观")}</span><div><strong>${escapeHTML(event.titleCN || event.title)}</strong><p>${escapeHTML(event.descCN || event.description || "")}</p><small>${escapeHTML(event.source || "Nasdaq")}</small></div><span class="impact ${event.impact === "高" ? "high" : "medium"}">影响：${escapeHTML(event.impact || "中")}</span></div>`;
  }

  function renderGenericDetail(target, symbol) {
    const quote = state.quotes[symbol] || fallbackQuotes[symbol];
    const realtime = focusLiveSeriesFor(symbol);
    const chartPoints = realtime.length === 1
      ? [{ time: realtime[0].time - 1_000, value: realtime[0].value }, realtime[0]]
      : realtime;
    const history = seriesFor(symbol, "1y");
    const values = history.map((point) => point.value);
    const sessionChange = focusWindowMetrics(realtime).change;
    state.detailChartPoints = chartPoints;
    target.innerHTML = `${detailHero(ASSET_META[symbol]?.name || symbol, symbol, formatQuote(symbol, quote), signedPercent(sessionChange ?? quote.change), quote.source, quote.updatedAt)}
      <div class="detail-chart-card"><div class="panel-heading"><div><h2>本次运行走势</h2><p>实时采样 · 最多保留 120 点</p></div></div><div class="chart-wrap realtime-detail-chart"><canvas id="detail-chart"></canvas></div></div>
      <div class="detail-metrics">${detailMetrics(symbol, quote)}</div>
      <div class="detail-chart-card"><div class="panel-heading"><div><h2>历年走势</h2><p>${values.length ? `低 ${formatNumber(Math.min(...values), ASSET_META[symbol]?.decimals ?? 2)} · 高 ${formatNumber(Math.max(...values), ASSET_META[symbol]?.decimals ?? 2)}` : "暂无可验证的历史数据"}</p></div></div><div class="chart-wrap"><canvas id="detail-history-chart"></canvas></div></div>`;
    requestAnimationFrame(() => drawLineChart($("#detail-history-chart"), history, {
      fill: true, fillAlpha: 0.28, grid: true, padding: { top: 10, right: 64, bottom: 10, left: 8 }, lineWidth: 2,
    }));
  }

  function treasuryYieldItem(yields, key) {
    return yields?.curve?.find((item) => item.key === key) || null;
  }

  function basisPointLabel(value) {
    if (value === null || value === undefined || value === "") return "—";
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return "—";
    const rounded = Math.round(numeric * 10) / 10;
    return `${rounded > 0 ? "+" : ""}${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)} bp`;
  }

  function treasuryYieldSection(yields) {
    const curve = Array.isArray(yields?.curve) ? yields.curve : [];
    if (!curve.length) {
      return `<section class="detail-chart-card treasury-yield-card">
        <div class="panel-heading"><div><h2>美国国债收益率曲线</h2><p>美国财政部每日票面收益率</p></div></div>
        <div class="treasury-yield-loading"><i class="bi bi-arrow-repeat"></i><span>正在同步最新收益率…</span></div>
      </section>`;
    }

    const keyHTML = ["2Y", "10Y", "30Y"].map((key) => {
      const item = treasuryYieldItem(yields, key);
      return `<div class="treasury-yield-key ${key === "10Y" ? "featured" : ""}">
        <small>${escapeHTML(item?.label || key)}期</small>
        <strong>${formatNumber(item?.value, 2)}%</strong>
        <span class="${Number(item?.changeBp) >= 0 ? "up" : "down"}">${basisPointLabel(item?.changeBp)}</span>
      </div>`;
    }).join("");
    const termsHTML = curve.map((item) => `<div class="treasury-yield-term">
      <small>${escapeHTML(item.label)}</small>
      <strong>${formatNumber(item.value, 2)}%</strong>
      <span class="${Number(item.changeBp) >= 0 ? "up" : "down"}">${basisPointLabel(item.changeBp)}</span>
    </div>`).join("");
    const shapeLabels = { normal: "正向", inverted: "倒挂", flat: "趋平", unknown: "—" };
    const shape = shapeLabels[yields.curveShape] || "—";
    const shapeClass = yields.curveShape === "inverted" ? "down" : yields.curveShape === "normal" ? "up" : "";
    return `<section class="detail-chart-card treasury-yield-card">
      <div class="panel-heading"><div><h2>美国国债收益率曲线</h2><p>美国财政部每日票面收益率 · ${escapeHTML(yields.asOf || "日期未知")}</p></div><span class="yield-source-chip">OFFICIAL</span></div>
      <div class="treasury-yield-key-grid">${keyHTML}</div>
      <div class="chart-wrap treasury-yield-chart-wrap"><canvas id="treasury-yield-chart" role="img" aria-label="美国国债不同期限收益率曲线"></canvas></div>
      <div class="treasury-yield-term-grid" aria-label="全部期限美债收益率">${termsHTML}</div>
      <div class="treasury-yield-spread"><span>2年—10年利差</span><strong>${basisPointLabel(yields.spread2s10sBp)}</strong><em class="${shapeClass}">${shape}</em></div>
      <div class="data-note">收益率为年化百分比，日变化单位为基点（bp）${yields.previousDate ? `；对比 ${escapeHTML(yields.previousDate)}` : ""}${yields.stale ? "；当前显示最近一次成功记录" : ""}。数据来源：U.S. Department of the Treasury。</div>
    </section>`;
  }

  function drawTreasuryYieldCurve(canvas, curve) {
    if (!canvas || !Array.isArray(curve)) return;
    const keys = ["3M", "6M", "1Y", "2Y", "5Y", "10Y", "30Y"];
    const points = keys.map((key) => curve.find((item) => item.key === key)).filter(Boolean);
    if (points.length < 2) return;
    const width = Math.max(300, Math.floor(canvas.getBoundingClientRect().width || 640));
    const height = Math.max(190, Math.floor(canvas.getBoundingClientRect().height || 220));
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    const context = canvas.getContext("2d");
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);

    const padding = { left: 43, right: 24, top: 31, bottom: 34 };
    const plotWidth = width - padding.left - padding.right;
    const plotHeight = height - padding.top - padding.bottom;
    const values = points.map((point) => Number(point.value));
    let minimum = Math.min(...values);
    let maximum = Math.max(...values);
    const range = Math.max(maximum - minimum, 0.25);
    minimum -= range * 0.18;
    maximum += range * 0.18;
    const coordinates = points.map((item, index) => ({
      item,
      x: padding.left + plotWidth * index / (points.length - 1),
      y: padding.top + (maximum - Number(item.value)) / (maximum - minimum) * plotHeight,
    }));

    context.font = "9px ui-monospace, SFMono-Regular, monospace";
    context.fillStyle = cssColor("--ink-dim");
    context.strokeStyle = cssColor("--separator");
    context.lineWidth = 1;
    for (let index = 0; index < 4; index += 1) {
      const y = padding.top + plotHeight * index / 3;
      context.beginPath();
      context.moveTo(padding.left, y);
      context.lineTo(width - padding.right, y);
      context.stroke();
      const label = maximum - (maximum - minimum) * index / 3;
      context.textAlign = "right";
      context.fillText(`${label.toFixed(1)}%`, padding.left - 7, y + 3);
    }

    context.save();
    context.globalAlpha = 0.14;
    context.fillStyle = cssColor("--accent");
    context.beginPath();
    coordinates.forEach((point, index) => {
      if (index === 0) context.moveTo(point.x, point.y);
      else context.lineTo(point.x, point.y);
    });
    context.lineTo(coordinates.at(-1).x, height - padding.bottom);
    context.lineTo(coordinates[0].x, height - padding.bottom);
    context.closePath();
    context.fill();
    context.restore();

    context.beginPath();
    coordinates.forEach((point, index) => {
      if (index === 0) context.moveTo(point.x, point.y);
      else context.lineTo(point.x, point.y);
    });
    context.strokeStyle = cssColor("--accent");
    context.lineWidth = 2.2;
    context.lineJoin = "round";
    context.lineCap = "round";
    context.stroke();

    coordinates.forEach((point) => {
      context.beginPath();
      context.arc(point.x, point.y, 3.5, 0, Math.PI * 2);
      context.fillStyle = cssColor("--accent");
      context.fill();
      context.fillStyle = cssColor("--ink");
      context.font = "700 9px ui-monospace, SFMono-Regular, monospace";
      context.textAlign = "center";
      context.fillText(Number(point.item.value).toFixed(2), point.x, Math.max(12, point.y - 9));
      context.fillStyle = cssColor("--ink-dim");
      context.font = "9px ui-monospace, SFMono-Regular, monospace";
      context.fillText(point.item.label, point.x, height - 10);
    });
  }

  function renderDebtDetail(target, details, yields) {
    if (details?.quote && (!state.quotes.DEBT?.recordDate || details.quote.recordDate >= state.quotes.DEBT.recordDate)) {
      state.quotes.DEBT = { ...state.quotes.DEBT, ...details.quote };
    }
    const quote = state.quotes.DEBT;
    const points = details?.points?.length ? details.points : seriesFor("DEBT");
    state.histories.DEBT = points;
    const positiveChanges = points.map((point, index) => {
      const previous = points[index - 1];
      const raw = Number(point.dailyChangeUSD);
      return Number.isFinite(raw) ? raw : previous ? (point.value - previous.value) * 1e12 : 0;
    }).filter((change) => change > 0);
    const computedAverage = positiveChanges.length
      ? positiveChanges.reduce((sum, change) => sum + change, 0) / positiveChanges.length
      : 0;
    const average = Number(details?.averagePositiveDailyIncrease ?? computedAverage) / 1e8;
    const maximum = Number(details?.maximumDailyIncrease?.delta ?? Math.max(0, ...positiveChanges)) / 1e8;
    const dailyChange = debtChangeYi(quote);
    target.innerHTML = `${detailHero("美国国家总债务", "DEBT", `$${Number(quote.value).toFixed(4)} 万亿美元`, `${dailyChange >= 0 ? "+" : ""}${formatNumber(dailyChange, 2)} 亿美元`, debtSourceLabel(quote), quote.updatedAt)}
      <div class="detail-metrics"><div class="metric-card"><small>最新总额</small><strong>${Number(quote.value).toFixed(4)}T</strong></div><div class="metric-card"><small>正增长日均增加</small><strong class="down">+${formatNumber(average, 2)} 亿</strong></div><div class="metric-card"><small>单日最大增加</small><strong class="down">+${formatNumber(maximum, 2)} 亿</strong></div></div>
      ${treasuryYieldSection(yields)}
      <div class="detail-chart-card"><div class="panel-heading"><div><h2>近90条记录走势</h2><p>公众持有债务总额 · 万亿美元</p></div></div><div class="chart-wrap"><canvas id="detail-chart"></canvas></div></div>
      ${historyTable(points, "万亿美元")}
      <div class="detail-chart-card"><h2 class="detail-section-title">万亿美元里程碑</h2><div class="milestone-list">${(details?.milestones || []).map((item) => `<div class="milestone"><strong>$${item.trillion}T</strong><small>${item.date}</small><span>较上一万亿用时 ${item.days} 天</span></div>`).join("") || "<p>正在同步里程碑…</p>"}</div></div>`;
    requestAnimationFrame(() => {
      if (state.currentDetail !== "DEBT") return;
      drawLineChart($("#detail-chart"), points, { fill: true, grid: true, padding: 10, lineWidth: 2 });
      drawTreasuryYieldCurve($("#treasury-yield-chart"), yields?.curve);
    });
  }

  function renderUSStocksDetail(target, details) {
    const fallbackIndices = [
      { symbol: "DOW", value: state.quotes.DOW?.value || 52747, change: state.quotes.DOW?.change || 0 },
      { symbol: "NASDAQ", value: state.quotes.NASDAQ.value, change: state.quotes.NASDAQ.change },
      { symbol: "SP500", value: state.quotes.SP500?.value || 7429, change: state.quotes.SP500?.change || 0 },
    ];
    const indices = details?.indices?.length ? details.indices : fallbackIndices;
    const names = { DOW: "道琼斯工业指数", NASDAQ: "纳斯达克综合指数", SP500: "标普 500 指数" };
    const stocks = details?.stocks || [];
    const selectedIndex = indices.find((item) => item.symbol === state.stockIndexSymbol) || indices[0];
    const history = selectedIndex?.history || seriesFor(selectedIndex?.symbol || "NASDAQ", "1y");
    const years = [...new Set(history.map((point) => new Date(point.time).getFullYear()))].sort((left, right) => right - left);
    if (!years.includes(state.stockIndexYear)) state.stockIndexYear = years[0] || new Date().getFullYear();
    const yearPoints = history.filter((point) => new Date(point.time).getFullYear() === state.stockIndexYear);
    const values = yearPoints.map((point) => Number(point.value));
    const first = values[0] || 0;
    const last = values.at(-1) || first;
    const yearlyChange = first ? (last / first - 1) * 100 : 0;
    state.detailChartPoints = yearPoints.length >= 2 ? yearPoints : history;
    const marketCap = Number(details?.marketCap || 64e12);
    const goldOz = marketCap / 4_175 / 1e8;
    const goldTons = marketCap / 4_175 * 0.0311034768 / 1000;
    target.innerHTML = `${detailHero("美国股票市场", "US STOCKS", formatQuote("NASDAQ", state.quotes.NASDAQ), signedPercent(state.quotes.NASDAQ.change), "腾讯行情 · 延迟以源站为准", details?.updatedAt || Date.now())}
      <div class="stock-index-grid">${indices.map((quote) => `<button class="metric-card index-card ${quote.symbol === state.stockIndexSymbol ? "is-selected" : ""}" data-stock-index="${quote.symbol}" type="button"><small>${escapeHTML(names[quote.symbol] || quote.symbol)}</small><strong>${formatNumber(quote.value, 0)}</strong><span class="${quote.change >= 0 ? "up" : "down"}">${signedPercent(quote.change)}</span></button>`).join("")}</div>
      <div class="detail-chart-card"><div class="panel-heading"><div><h2>${escapeHTML(names[selectedIndex?.symbol] || "美股指数")}历年走势</h2><p>10 年日线 · USD</p></div><label class="year-picker">年份<select id="stock-history-year">${years.map((year) => `<option value="${year}" ${year === state.stockIndexYear ? "selected" : ""}>${year} 年</option>`).join("")}</select></label></div>
      <div class="year-stat-row"><span>年初 <strong>${formatNumber(first, 0)}</strong></span><span>年末 <strong>${formatNumber(last, 0)}</strong></span><span>最高 <strong>${formatNumber(Math.max(...values, 0), 0)}</strong></span><span>最低 <strong>${formatNumber(values.length ? Math.min(...values) : 0, 0)}</strong></span><span>年涨幅 <strong class="${yearlyChange >= 0 ? "up" : "down"}">${signedPercent(yearlyChange)}</strong></span></div><div class="chart-wrap"><canvas id="detail-chart"></canvas></div></div>
      <div class="detail-chart-card"><h2 class="detail-section-title">20 家代表公司行情</h2><div class="stock-table-wrap"><table class="detail-table"><thead><tr><th>排名</th><th>代码 / 公司</th><th>最新价</th><th>涨跌额</th><th>涨跌幅</th><th>市值</th></tr></thead><tbody>${stocks.map((stock, index) => `<tr><td>${index + 1}</td><td><span class="stock-name"><strong>${escapeHTML(stock.ticker)}</strong><small>${escapeHTML(stock.name || stock.ticker)}</small></span></td><td>$${formatNumber(stock.value, 2)}</td><td class="${stock.absoluteChange >= 0 ? "up" : "down"}">${stock.absoluteChange >= 0 ? "+" : ""}${formatNumber(stock.absoluteChange, 2)}</td><td class="${stock.change >= 0 ? "up" : "down"}">${signedPercent(stock.change)}</td><td>${stock.marketCapBillion >= 1_000 ? `$${formatNumber(stock.marketCapBillion / 1_000, 3)}T` : `$${formatNumber(stock.marketCapBillion, 2)}B`}</td></tr>`).join("") || `<tr><td colspan="6">腾讯个股数据正在同步；指数行情可正常使用。</td></tr>`}</tbody></table></div></div>
      <div class="gold-context"><div class="metric-card"><small>美国股市总市值 · 动态估算</small><strong>$${formatNumber(marketCap / 1e12, 2)}T</strong><span>64T 基准 × 标普500当日涨跌</span></div><div class="metric-card"><small>折合黄金 · 静态 $4,175/oz</small><strong>${formatNumber(goldOz, 2)} 亿盎司</strong></div><div class="metric-card"><small>折合黄金重量</small><strong>${formatNumber(goldTons, 0)} 吨</strong></div></div>`;
  }

  function formatCnyMarketCap(value) {
    const amount = Number(value);
    if (!(amount > 0)) return "—";
    if (amount >= 1e12) return `¥${formatNumber(amount / 1e12, 2)} 万亿`;
    return `¥${formatNumber(amount / 1e8, 0)} 亿`;
  }

  function renderChinaStocksDetail(target, details) {
    const indices = details?.indices || [];
    const stocks = details?.stocks || [];
    if (!indices.length) {
      target.innerHTML = `${detailHero("中国 A 股市场", "SSE · SZSE", "数据同步中", "—", "腾讯行情 · 东方财富市值排行", details?.updatedAt || Date.now())}
        <div class="detail-chart-card"><div class="message-empty">沪深市场数据暂时不可用，请稍后重新打开。</div></div>`;
      return;
    }

    const indexNames = { SSE: "上证指数", SZSE: "深证成指" };
    const selectedIndex = indices.find((item) => item.symbol === state.chinaIndexSymbol) || indices[0];
    state.chinaIndexSymbol = selectedIndex.symbol;
    if (!stocks.some((stock) => stock.symbol === state.chinaStockSymbol)) {
      state.chinaStockSymbol = stocks[0]?.symbol || null;
    }
    const selectedStock = stocks.find((stock) => stock.symbol === state.chinaStockSymbol) || stocks[0];
    state.detailChartPoints = selectedIndex.history || [];
    const rankingNote = details.rankingScope === "large-cap-fallback"
      ? "当前使用大型股后备集合按实时市值排序"
      : "覆盖上交所主板、科创板与深交所主板、创业板";

    target.innerHTML = `${detailHero("中国 A 股市场", "SSE · SZSE", formatNumber(selectedIndex.value, 2), signedPercent(selectedIndex.change), "腾讯行情 · 延迟以源站为准", details.updatedAt || Date.now())}
      <div class="cn-index-grid">${indices.map((index) => `<button class="cn-index-card ${index.symbol === state.chinaIndexSymbol ? "is-selected" : ""}" data-china-index="${escapeHTML(index.symbol)}" type="button">
        <span><small>${escapeHTML(index.exchange)}</small><b>${escapeHTML(indexNames[index.symbol] || index.name)}</b></span>
        <strong>${formatNumber(index.value, 2)}</strong>
        <em class="${index.change >= 0 ? "up" : "down"}">${signedPercent(index.change)}</em>
        <canvas data-china-index-chart="${escapeHTML(index.symbol)}" aria-label="${escapeHTML(index.name)}一年走势"></canvas>
      </button>`).join("")}</div>
      <div class="detail-chart-card"><div class="panel-heading"><div><h2>${escapeHTML(indexNames[selectedIndex.symbol] || selectedIndex.name)}走势</h2><p>近一年前复权日线 · ${escapeHTML(selectedIndex.exchange)}</p></div></div><div class="chart-wrap"><canvas id="detail-chart"></canvas></div></div>
      ${selectedStock ? `<div class="detail-chart-card cn-stock-focus">
        <div class="panel-heading"><div><h2>${escapeHTML(selectedStock.name)} · ${escapeHTML(selectedStock.ticker)}</h2><p>${escapeHTML(selectedStock.exchange)} · 近一年前复权日线</p></div><span class="cn-market-cap">${formatCnyMarketCap(selectedStock.marketCapCny)}</span></div>
        <div class="cn-stock-focus-metrics"><span>最新 <strong>¥${formatNumber(selectedStock.value, 2)}</strong></span><span>涨跌 <strong class="${selectedStock.change >= 0 ? "up" : "down"}">${signedPercent(selectedStock.change)}</strong></span><span>排名 <strong>#${stocks.indexOf(selectedStock) + 1}</strong></span></div>
        <div class="chart-wrap cn-stock-detail-chart"><canvas id="cn-stock-detail-chart"></canvas></div>
      </div>` : ""}
      <div class="detail-chart-card"><div class="panel-heading"><div><h2>沪深两市总市值前 20 家企业</h2><p>${rankingNote} · 点击公司查看大图</p></div><span class="yield-source-chip">MARKET CAP</span></div>
        <div class="stock-table-wrap"><table class="detail-table cn-stock-table"><thead><tr><th>排名</th><th>交易所</th><th>代码 / 公司</th><th>最新价</th><th>涨跌幅</th><th>总市值</th><th>一年走势</th></tr></thead><tbody>
        ${stocks.map((stock, index) => `<tr class="${stock.symbol === state.chinaStockSymbol ? "is-selected" : ""}">
          <td>${index + 1}</td><td><span class="exchange-badge ${stock.exchangeCode === "SSE" ? "sse" : "szse"}">${escapeHTML(stock.exchange)}</span></td>
          <td><button class="stock-select-button" data-china-stock="${escapeHTML(stock.symbol)}" type="button"><strong>${escapeHTML(stock.ticker)}</strong><small>${escapeHTML(stock.name)}</small></button></td>
          <td>¥${formatNumber(stock.value, 2)}</td><td class="${stock.change >= 0 ? "up" : "down"}">${signedPercent(stock.change)}</td>
          <td>${formatCnyMarketCap(stock.marketCapCny)}</td><td><canvas class="cn-stock-spark" data-china-stock-chart="${escapeHTML(stock.symbol)}" aria-label="${escapeHTML(stock.name)}一年走势"></canvas></td>
        </tr>`).join("") || `<tr><td colspan="7">市值排行正在同步。</td></tr>`}</tbody></table></div>
        <div class="data-note">排行来源：${escapeHTML(details.rankingSource || "东方财富沪深A股总市值排行")}；走势来源：${escapeHTML(details.historySource || "腾讯前复权日线")}。行情可能延迟，仅供参考。</div>
      </div>`;

    requestAnimationFrame(() => {
      if (state.currentDetail !== "CN_STOCKS") return;
      drawLineChart($("#detail-chart"), selectedIndex.history || [], {
        fill: true, fillAlpha: 0.24, grid: true, padding: 10, lineWidth: 2,
      });
      drawLineChart($("#cn-stock-detail-chart"), selectedStock?.history || [], {
        fill: true, fillAlpha: 0.20, grid: true, padding: 9, lineWidth: 2,
      });
      $$("[data-china-index-chart]", target).forEach((canvas) => {
        const index = indices.find((item) => item.symbol === canvas.dataset.chinaIndexChart);
        drawLineChart(canvas, index?.history || [], { fill: true, fillAlpha: 0.12, padding: 2, lineWidth: 1.2 });
      });
      $$("[data-china-stock-chart]", target).forEach((canvas) => {
        const stock = stocks.find((item) => item.symbol === canvas.dataset.chinaStockChart);
        drawLineChart(canvas, stock?.history || [], { fill: true, fillAlpha: 0.10, padding: 2, lineWidth: 1.1 });
      });
    });
  }

  function formatHkdMarketCap(value) {
    const amount = Number(value);
    if (!(amount > 0)) return "—";
    if (amount >= 1e12) return `HK$${formatNumber(amount / 1e12, 2)} 万亿`;
    return `HK$${formatNumber(amount / 1e8, 0)} 亿`;
  }

  function renderHongKongStocksDetail(target, details) {
    const index = details?.index;
    const stocks = details?.stocks || [];
    if (!index) {
      target.innerHTML = `${detailHero("香港股票市场", "HSI · HKEX", "数据同步中", "—", "腾讯港股行情", details?.updatedAt || Date.now())}
        <div class="detail-chart-card"><div class="message-empty">港股市场数据暂时不可用，请稍后重新打开。</div></div>`;
      return;
    }
    if (!stocks.some((stock) => stock.symbol === state.hongKongStockSymbol)) {
      state.hongKongStockSymbol = stocks[0]?.symbol || null;
    }
    const selectedStock = stocks.find((stock) => stock.symbol === state.hongKongStockSymbol) || stocks[0];
    state.detailChartPoints = index.history || [];

    target.innerHTML = `${detailHero("香港股票市场", "HSI · HKEX", formatNumber(index.value, 2), signedPercent(index.change), "腾讯行情 · 延迟以源站为准", details.updatedAt || Date.now())}
      <div class="detail-chart-card hk-index-overview"><div class="panel-heading"><div><h2>香港恒生指数走势</h2><p>近一年前复权日线 · 香港交易所</p></div><span class="yield-source-chip">HSI</span></div>
        <div class="chart-wrap hk-index-detail-chart"><canvas id="detail-chart"></canvas></div>
      </div>
      ${selectedStock ? `<div class="detail-chart-card hk-stock-focus">
        <div class="panel-heading"><div><h2>${escapeHTML(selectedStock.name)} · ${escapeHTML(selectedStock.ticker)}</h2><p>香港交易所 · 近一年前复权日线</p></div><span class="cn-market-cap">${formatHkdMarketCap(selectedStock.marketCapHkd)}</span></div>
        <div class="cn-stock-focus-metrics"><span>最新 <strong>HK$${formatNumber(selectedStock.value, 3)}</strong></span><span>涨跌 <strong class="${selectedStock.change >= 0 ? "up" : "down"}">${signedPercent(selectedStock.change)}</strong></span><span>市值排名 <strong>#${stocks.indexOf(selectedStock) + 1}</strong></span></div>
        <div class="chart-wrap hk-stock-detail-chart"><canvas id="hk-stock-detail-chart"></canvas></div>
      </div>` : ""}
      <div class="detail-chart-card"><div class="panel-heading"><div><h2>香港交易所总市值前 20 家企业</h2><p>按公司实时总市值排序 · 点击公司查看大图</p></div><span class="yield-source-chip">HK MARKET CAP</span></div>
        <div class="stock-table-wrap"><table class="detail-table hk-stock-table"><thead><tr><th>排名</th><th>代码 / 公司</th><th>最新价</th><th>涨跌额</th><th>涨跌幅</th><th>公司总市值</th><th>一年走势</th></tr></thead><tbody>
        ${stocks.map((stock, rank) => `<tr class="${stock.symbol === state.hongKongStockSymbol ? "is-selected" : ""}">
          <td>${rank + 1}</td><td><button class="stock-select-button" data-hk-stock="${escapeHTML(stock.symbol)}" type="button"><strong>${escapeHTML(stock.ticker)}</strong><small>${escapeHTML(stock.name)}</small></button></td>
          <td>HK$${formatNumber(stock.value, 3)}</td><td class="${stock.absoluteChange >= 0 ? "up" : "down"}">${stock.absoluteChange >= 0 ? "+" : ""}${formatNumber(stock.absoluteChange, 3)}</td>
          <td class="${stock.change >= 0 ? "up" : "down"}">${signedPercent(stock.change)}</td><td>${formatHkdMarketCap(stock.marketCapHkd)}</td>
          <td><canvas class="hk-stock-spark" data-hk-stock-chart="${escapeHTML(stock.symbol)}" aria-label="${escapeHTML(stock.name)}一年走势"></canvas></td>
        </tr>`).join("") || `<tr><td colspan="7">港股市值排行正在同步。</td></tr>`}</tbody></table></div>
        <div class="data-note">排行来源：${escapeHTML(details.rankingSource || "腾讯港股实时总市值")}；走势来源：${escapeHTML(details.historySource || "腾讯前复权日线")}。新上市公司从上市首日开始显示，行情可能延迟，仅供参考。</div>
      </div>`;

    requestAnimationFrame(() => {
      if (state.currentDetail !== "HK_STOCKS") return;
      drawLineChart($("#detail-chart"), index.history || [], {
        fill: true, fillAlpha: 0.24, grid: true, padding: 10, lineWidth: 2,
      });
      drawLineChart($("#hk-stock-detail-chart"), selectedStock?.history || [], {
        fill: true, fillAlpha: 0.20, grid: true, padding: 9, lineWidth: 2,
      });
      $$("[data-hk-stock-chart]", target).forEach((canvas) => {
        const stock = stocks.find((item) => item.symbol === canvas.dataset.hkStockChart);
        drawLineChart(canvas, stock?.history || [], { fill: true, fillAlpha: 0.10, padding: 2, lineWidth: 1.1 });
      });
    });
  }

  function formatUsdMarketCap(value) {
    const amount = Number(value);
    if (!(amount > 0)) return "—";
    if (amount >= 1e12) return `US$${formatNumber(amount / 1e12, 2)} 万亿`;
    return `US$${formatNumber(amount / 1e9, 2)} B`;
  }

  function renderRegionalStocksDetail(target, details) {
    const index = details?.index;
    const stocks = details?.stocks || [];
    const market = details?.market || state.currentDetail;
    const marketName = details?.name || ASSET_META[market]?.name || "股票市场";
    const exchange = details?.exchange || "";
    const exchangeCode = details?.exchangeCode || "";
    const currencySymbol = details?.currencySymbol || "";
    const priceDecimals = ["JPY", "KRW"].includes(details?.currency) ? 0 : 2;
    if (!index) {
      target.innerHTML = `${detailHero(marketName, exchangeCode, "数据同步中", "—", "Yahoo Finance 日线", details?.updatedAt || Date.now())}
        <div class="detail-chart-card"><div class="message-empty">市场数据暂时不可用，请稍后重新打开。</div></div>`;
      return;
    }

    if (!stocks.some((stock) => stock.symbol === state.regionalStockSymbols[market])) {
      state.regionalStockSymbols[market] = stocks[0]?.symbol || null;
    }
    const selectedStock = stocks.find((stock) => stock.symbol === state.regionalStockSymbols[market]) || stocks[0];
    state.detailChartPoints = index.history || [];

    target.innerHTML = `${detailHero(marketName, `${escapeHTML(index.symbol)} · ${escapeHTML(exchangeCode)}`, formatNumber(index.value, 2), signedPercent(index.change), "Yahoo Finance 日线 · 延迟以源站为准", details.updatedAt || Date.now())}
      <div class="detail-chart-card regional-index-overview"><div class="panel-heading"><div><h2>${escapeHTML(index.name)}走势</h2><p>近一年日线 · ${escapeHTML(exchange)}</p></div><span class="yield-source-chip">${escapeHTML(index.symbol)}</span></div>
        <div class="chart-wrap regional-index-detail-chart"><canvas id="detail-chart"></canvas></div>
      </div>
      ${selectedStock ? `<div class="detail-chart-card regional-stock-focus">
        <div class="panel-heading"><div><h2>${escapeHTML(selectedStock.name)} · ${escapeHTML(selectedStock.ticker)}</h2><p>${escapeHTML(exchange)} · 近一年日线</p></div><span class="cn-market-cap">${formatUsdMarketCap(selectedStock.marketCapUsd)}</span></div>
        <div class="cn-stock-focus-metrics"><span>最新 <strong>${escapeHTML(currencySymbol)}${selectedStock.value > 0 ? formatNumber(selectedStock.value, priceDecimals) : "—"}</strong></span><span>涨跌 <strong class="${selectedStock.change >= 0 ? "up" : "down"}">${signedPercent(selectedStock.change)}</strong></span><span>市值排名 <strong>#${stocks.indexOf(selectedStock) + 1}</strong></span></div>
        <div class="chart-wrap regional-stock-detail-chart"><canvas id="regional-stock-detail-chart"></canvas></div>
      </div>` : ""}
      <div class="detail-chart-card"><div class="panel-heading"><div><h2>${escapeHTML(exchange)}市值前 20 家企业</h2><p>按美元总市值每日排序 · 点击公司查看大图</p></div><span class="yield-source-chip">${escapeHTML(exchangeCode)} MARKET CAP</span></div>
        <div class="stock-table-wrap"><table class="detail-table regional-stock-table"><thead><tr><th>排名</th><th>代码 / 公司</th><th>最新价</th><th>涨跌额</th><th>涨跌幅</th><th>公司总市值</th><th>一年走势</th></tr></thead><tbody>
        ${stocks.map((stock, rank) => `<tr class="${stock.symbol === state.regionalStockSymbols[market] ? "is-selected" : ""}">
          <td>${rank + 1}</td><td><button class="stock-select-button" data-regional-stock="${escapeHTML(stock.symbol)}" type="button"><strong>${escapeHTML(stock.ticker)}</strong><small>${escapeHTML(stock.name)}</small></button></td>
          <td>${escapeHTML(currencySymbol)}${stock.value > 0 ? formatNumber(stock.value, priceDecimals) : "—"}</td><td class="${stock.absoluteChange >= 0 ? "up" : "down"}">${stock.value > 0 ? `${stock.absoluteChange >= 0 ? "+" : ""}${formatNumber(stock.absoluteChange, priceDecimals)}` : "—"}</td>
          <td class="${stock.change >= 0 ? "up" : "down"}">${stock.value > 0 ? signedPercent(stock.change) : "—"}</td><td>${formatUsdMarketCap(stock.marketCapUsd)}</td>
          <td><canvas class="regional-stock-spark" data-regional-stock-chart="${escapeHTML(stock.symbol)}" aria-label="${escapeHTML(stock.name)}一年走势"></canvas></td>
        </tr>`).join("") || `<tr><td colspan="7">市值排行正在同步。</td></tr>`}</tbody></table></div>
        <div class="data-note">排行来源：${escapeHTML(details.rankingSource || "CompaniesMarketCap 每日市值排行")}；走势来源：${escapeHTML(details.historySource || "Yahoo Finance 日线")}；最新价使用当地货币，市值统一折算为美元。新上市公司从上市首日开始显示，行情可能延迟，仅供参考。</div>
      </div>`;

    requestAnimationFrame(() => {
      if (state.currentDetail !== market) return;
      drawLineChart($("#detail-chart"), index.history || [], {
        fill: true, fillAlpha: 0.24, grid: true, padding: 10, lineWidth: 2,
      });
      drawLineChart($("#regional-stock-detail-chart"), selectedStock?.history || [], {
        fill: true, fillAlpha: 0.20, grid: true, padding: 9, lineWidth: 2,
      });
      $$("[data-regional-stock-chart]", target).forEach((canvas) => {
        const stock = stocks.find((item) => item.symbol === canvas.dataset.regionalStockChart);
        drawLineChart(canvas, stock?.history || [], { fill: true, fillAlpha: 0.10, padding: 2, lineWidth: 1.1 });
      });
    });
  }

  function renderOilDetail(target, details) {
    const quotes = details?.quotes?.length ? details.quotes : [
      { symbol: "WTI", ...state.quotes.WTI }, { symbol: "BRENT", ...state.quotes.BRENT },
    ];
    const names = { WTI: "美国原油 · WTI", BRENT: "布伦特原油 · Brent" };
    target.innerHTML = `${detailHero("原油与能源", "OIL", `$${formatNumber(quotes[0]?.value || state.quotes.WTI.value, 2)}`, signedPercent(quotes[0]?.change ?? state.quotes.WTI.change), quotes[0]?.source || "新浪环球期货", details?.updatedAt || Date.now())}
      <div class="oil-grid">${quotes.map((quote) => `<div class="metric-card"><small>${escapeHTML(names[quote.symbol] || quote.symbol)}</small><strong>$${formatNumber(quote.value, 2)}</strong><span class="${quote.change >= 0 ? "up" : "down"}">${signedPercent(quote.change)} · ¥${formatNumber(quote.value * (state.rates?.CNY || 6.78), 2)}</span><small>昨收 $${formatNumber(quote.previous ?? quote.value, 2)} · ${escapeHTML(quote.timeText || "最新交易时段")}</small></div>`).join("")}</div>
      <div class="detail-chart-card"><div class="panel-heading"><div><h2>WTI 走势</h2><p>美元 / 桶 · 根据所选周期刷新</p></div></div><div class="chart-wrap"><canvas id="detail-chart"></canvas></div></div>`;
  }

  function renderGoldDetail(target, details) {
    if (details?.quote) {
      applyGoldSpotQuote(details.quote, {
        isStale: Boolean(details.quote.isStale),
        source: details.quote.source || "Gold API · XAU 现货 · USD/CNY",
      });
    }
    const quote = state.quotes.XAU;
    const realtime = focusLiveSeriesFor("XAU");
    state.detailChartPoints = realtime.length === 1
      ? [{ time: realtime[0].time - 1_000, value: realtime[0].value }, realtime[0]]
      : realtime;
    const sinaGoldPoints = details?.history?.length >= 2
      ? details.history
      : state.crossHistories.LONDON_GOLD;
    const hasSinaGoldHistory = sinaGoldPoints?.length >= 2;
    const goldHistory = hasSinaGoldHistory
      ? sinaGoldPoints.map((point) => ({
          ...point,
          value: convertedValue("XAU", { usd: point.value, value: point.value }),
        }))
      : seriesFor("XAU", "1y").map((point) => ({
          ...point,
          value: displaySeriesValue("XAU", point.value),
        }));
    const reserves = details?.reserves?.length ? details.reserves : state.goldReserves;
    const latest = reserves?.at(-1);
    const changes = (reserves || []).slice(1).map((item, index) => ({
      ...item,
      change: Number(item.totalWanOz) - Number(reserves[index].totalWanOz),
    }));
    target.innerHTML = `${detailHero("黄金", "XAU", formatQuote("XAU", quote), signedPercent(quote.change), quote.source, quote.updatedAt)}
      <div class="detail-chart-card"><div class="panel-heading"><div><h2>本次运行走势</h2><p>Gold API 实时采样 · 最多保留 120 点</p></div></div><div class="chart-wrap realtime-detail-chart"><canvas id="detail-chart"></canvas></div></div>
      <div class="detail-metrics">${detailMetrics("XAU", quote)}</div>
      <div class="detail-metrics"><div class="metric-card"><small>最新黄金储备总计</small><strong>${formatNumber(latest?.totalWanOz || 0, 0)} 万盎司</strong><span>${escapeHTML(latest?.month || "—")}</span></div><div class="metric-card"><small>最新单月增持</small><strong class="up">+${formatNumber(changes.at(-1)?.change || 0, 0)} 万盎司</strong><span>约合 ${formatNumber((changes.at(-1)?.change || 0) * 0.311034768, 2)} 吨</span></div><div class="metric-card"><small>当前增持状态</small><strong>连续 20 个月</strong><span>本轮增持自 2024 年 11 月重启</span></div></div>
      <div class="reserve-detail-grid"><div class="detail-chart-card"><div class="panel-heading"><div><h2>每月增减持数量</h2><p>万盎司</p></div></div><div class="chart-wrap reserve-detail-chart"><canvas id="gold-reserve-change-chart"></canvas></div></div><div class="detail-chart-card"><div class="panel-heading"><div><h2>黄金储备总量走势</h2><p>更新至 2026 年 6 月</p></div></div><div class="chart-wrap reserve-detail-chart"><canvas id="gold-reserve-detail-chart"></canvas></div></div></div>
      <div class="detail-chart-card"><h2 class="detail-section-title">历史数据明细（最近 12 个月）</h2><div class="stock-table-wrap"><table class="detail-table"><thead><tr><th>月份</th><th>储备总计</th><th>月度增减</th><th>折合吨数</th></tr></thead><tbody>${changes.slice(-12).reverse().map((item) => `<tr><td>${escapeHTML(item.month)}</td><td>${formatNumber(item.totalWanOz, 0)} 万盎司</td><td class="${item.change >= 0 ? "up" : "down"}">${item.change >= 0 ? "+" : ""}${formatNumber(item.change, 0)}</td><td>${item.change >= 0 ? "+" : ""}${formatNumber(item.change * 0.311034768, 2)} 吨</td></tr>`).join("")}</tbody></table></div></div>
      <div class="detail-chart-card"><div class="panel-heading"><div><h2>黄金历年走势</h2><p>${hasSinaGoldHistory ? "新浪 XAU 历史日线" : "最近有效历史缓存"} · 按当前区域换算</p></div></div><div class="chart-wrap"><canvas id="gold-history-chart"></canvas></div></div>
      <div class="data-note">中国央行黄金储备为客户端内置月度数据，当前截止 ${escapeHTML(details?.reserveDataAsOf || "2026-06")}；Mac 客户端当前未接入美国黄金 ETF 每日持仓。</div>`;
    requestAnimationFrame(() => {
      drawLineChart($("#gold-reserve-detail-chart"), (reserves || []).map((item) => ({ time: Date.parse(`${item.month}-01T00:00:00Z`), value: item.totalWanOz })), { fill: true, grid: true, padding: 10, color: cssColor("--amber") });
      drawBarChart($("#gold-reserve-change-chart"), changes.map((item) => ({ value: item.change })));
      drawLineChart($("#gold-history-chart"), goldHistory, {
        fill: true, fillAlpha: 0.28, grid: true, padding: { top: 10, right: 64, bottom: 10, left: 8 }, lineWidth: 2,
      });
    });
  }

  function detailHero(title, symbol, value, change, source, updatedAt) {
    return `<div class="detail-hero"><div><h1>${escapeHTML(title)} <span class="symbol-chip">${symbol}</span></h1><div class="detail-price"><strong>${escapeHTML(value)}</strong><span class="${String(change).startsWith("-") ? "down" : "up"}">${escapeHTML(change)}</span></div></div><div class="detail-source">${escapeHTML(source || "Lynncat Markets")}<br>更新于 ${timeAgo(updatedAt)}</div></div>`;
  }

  function detailMetrics(symbol, quote) {
    if (symbol === "XAU") return `<div class="metric-card"><small>美元现货 / oz</small><strong>$${formatNumber(quote.usd || 4032.8, 2)}</strong></div><div class="metric-card"><small>1千克黄金 · KG→BTC</small><strong>${formatNumber(state.quotes.KGBTC.value, 4)}</strong></div><div class="metric-card"><small>美元兑人民币 · USD/CNY</small><strong>${formatNumber(state.rates?.CNY || 6.7746, 4)}</strong></div>`;
    if (symbol === "NASDAQ") return `<div class="metric-card"><small>道琼斯工业指数</small><strong>52,747</strong></div><div class="metric-card"><small>纳斯达克综合指数</small><strong>${formatNumber(quote.value, 0)}</strong></div><div class="metric-card"><small>标普 500 指数</small><strong>7,429</strong></div>`;
    if (symbol === "BTC") return `<div class="metric-card"><small>美元价格</small><strong>$${formatNumber(quote.usd || quote.value / 6.7746, 0)}</strong></div><div class="metric-card"><small>1千克黄金 / BTC</small><strong>${formatNumber(state.quotes.KGBTC.value, 4)}</strong></div><div class="metric-card"><small>24小时涨跌</small><strong class="${quote.change >= 0 ? "up" : "down"}">${signedPercent(quote.change)}</strong></div>`;
    return `<div class="metric-card"><small>最新价格</small><strong>${formatQuote(symbol, quote)}</strong></div><div class="metric-card"><small>日内涨跌</small><strong class="${quote.change >= 0 ? "up" : "down"}">${signedPercent(quote.change)}</strong></div><div class="metric-card"><small>数据来源</small><strong>${escapeHTML(quote.source || "Lynncat")}</strong></div>`;
  }

  function historyTable(points, unit) {
    return `<div class="detail-chart-card"><div class="panel-heading"><div><h2>每日增减数据</h2><p>按最新记录倒序排列</p></div></div><table class="detail-table"><thead><tr><th>日期</th><th>总额</th><th>单日增减</th><th>涨跌幅</th></tr></thead><tbody>${points.slice(-12).reverse().map((point, index, reversed) => {
      const previous = reversed[index + 1]?.value ?? point.value;
      const delta = point.value - previous;
      return `<tr><td>${dateLabel(point.time)}</td><td>${formatNumber(point.value, 4)} ${unit}</td><td class="${delta >= 0 ? "up" : "down"}">${delta >= 0 ? "+" : ""}${formatNumber(delta * 10000, 2)} 亿</td><td>${signedPercent(previous ? delta / previous * 100 : 0)}</td></tr>`;
    }).join("")}</tbody></table></div>`;
  }

  async function loadMessages(room, showLoading = true) {
    const target = $("#community-message-list");
    if (showLoading) target.innerHTML = `<div class="message-empty">正在读取市场交流…</div>`;
    try {
      const payload = await api(`${API_ROOT}/messages?room=${encodeURIComponent(room)}`, { auth: false });
      renderMessages(payload.messages || []);
    } catch {
      renderMessages([]);
    }
  }

  function renderMessages(messages) {
    const visible = messages.filter((message) => !state.blockedAuthors.has(message.authorKey));
    $("#community-message-list").innerHTML = visible.length ? visible.map((message) => {
      const remainingMinutes = Math.max(0, Math.ceil((Number(message.expiresAt || 0) - Date.now()) / 60_000));
      const remaining = remainingMinutes >= 60 ? `${Math.floor(remainingMinutes / 60)}小时后隐藏` : `${remainingMinutes}分钟后隐藏`;
      return `<article class="message-item" data-message-id="${escapeHTML(message.id)}" data-author-key="${escapeHTML(message.authorKey)}"><i class="bi bi-chat-square-text"></i><div><p>${escapeHTML(message.text)}</p><small>${escapeHTML(message.nickname || "林猫用户")} · ${timeAgo(message.createdAt)} · ${remaining}</small></div><div class="message-actions"><button data-report-message type="button" title="举报"><i class="bi bi-flag"></i></button><button data-block-author type="button" title="屏蔽作者"><i class="bi bi-person-slash"></i></button></div></article>`;
    }).join("") : `<div class="message-empty">当前品种还没有交流内容。</div>`;
  }

  async function reportMessage(messageId) {
    const allowedReasons = ["spam", "harassment", "sexual_or_violent", "personal_information", "scam", "other"];
    const reason = window.prompt("举报原因：spam / harassment / sexual_or_violent / personal_information / scam / other", "spam");
    if (!reason) return;
    try {
      await api(`${API_ROOT}/messages/${encodeURIComponent(messageId)}/reports`, {
        method: "POST", auth: false,
        body: JSON.stringify({ reporterId: state.installationId, reason: allowedReasons.includes(reason) ? reason : "other" }),
      });
      toast("举报已提交，感谢协助维护社区");
      loadMessages(state.currentRoom, false);
    } catch {
      toast("举报发送失败，请稍后重试");
    }
  }

  function blockAuthor(authorKey) {
    state.blockedAuthors.add(authorKey);
    localStorage.setItem("lynncat-blocked-authors", JSON.stringify([...state.blockedAuthors]));
    $$(`[data-author-key="${CSS.escape(authorKey)}"]`).forEach((element) => element.remove());
    toast("已在当前浏览器屏蔽该作者");
  }

  function openBlockedAuthors() {
    const authors = [...state.blockedAuthors];
    $("#blocked-authors-list").innerHTML = authors.length ? authors.map((authorKey, index) => `<div class="alert-item" data-blocked-key="${escapeHTML(authorKey)}"><span><strong>已屏蔽的交流用户 ${index + 1}</strong><small>本机浏览器屏蔽</small></span><button class="dialog-secondary compact-button" data-unblock-author type="button">解除屏蔽</button></div>`).join("") : `<div class="message-empty">目前没有屏蔽用户。</div>`;
    if (!$("#blocked-authors-dialog").open) openDialog($("#blocked-authors-dialog"));
  }

  async function submitMessage(event) {
    event.preventDefault();
    if (!state.token) return openAccountDialog();
    const input = $("#community-message-input");
    const text = input.value.trim();
    if (!text) return;
    try {
      await api(`${API_ROOT}/messages`, {
        method: "POST",
        headers: { "Idempotency-Key": `lynncat-web-message-${crypto.randomUUID()}` },
        body: JSON.stringify({ roomId: state.currentRoom, text }),
      });
      input.value = "";
      $("#message-counter").textContent = "0 / 200";
      await loadMessages(state.currentRoom);
      await refreshAccount();
      toast("留言已发布，将公开显示 24 小时");
    } catch (error) {
      toast(errorMessage(error));
    }
  }

  function openDialog(dialog) {
    $("#modal-backdrop").hidden = false;
    dialog.showModal();
  }

  function closeDialog(dialog) {
    dialog.close();
    $("#modal-backdrop").hidden = !$$("dialog[open]").length;
  }

  function openAccountDialog() {
    renderAccountDialog();
    openDialog($("#account-dialog"));
    if (state.account) loadLedger();
  }

  function renderAccountDialog() {
    $("#signed-out-account").hidden = Boolean(state.account);
    $("#signed-in-account").hidden = !state.account;
    if (state.account) {
      $("#account-nickname").textContent = state.account.nickname || "林猫用户";
      $("#account-public-id").textContent = state.account.publicId || "已登录";
      $("#account-points").textContent = formatNumber(state.account.pointsBalance, 0);
      $("#account-earned").textContent = formatNumber(state.account.pointsEarnedTotal, 0);
      $("#profile-nickname").value = state.account.nickname || "";
      $("#profile-leaderboard-visible").checked = Boolean(state.account.leaderboardVisible);
    }
  }

  async function saveProfile(event) {
    event.preventDefault();
    try {
      const payload = await api(`${API_ROOT}/account/profile`, {
        method: "PUT",
        body: JSON.stringify({
          nickname: $("#profile-nickname").value.trim(),
          leaderboardVisible: $("#profile-leaderboard-visible").checked,
        }),
      });
      state.account = payload.account;
      updateAccountUI();
      toast("账户资料已保存");
    } catch (error) {
      toast(errorMessage(error));
    }
  }

  async function loadLedger() {
    const target = $("#account-ledger");
    target.innerHTML = "<li>正在读取积分记录…</li>";
    try {
      const payload = await api(`${API_ROOT}/points/ledger?limit=30`);
      const labels = {
        heartbeat_credit: "运行林猫行情", message_debit: "发布市场交流",
        poker_settlement: "德州扑克结算", shuihu_draw: "水浒抽卡",
        shuihu_completion_reward: "集齐一百单八将",
      };
      target.innerHTML = (payload.entries || []).map((entry) => `<li><span>${escapeHTML(labels[entry.kind] || entry.kind)}<br>${timeAgo(entry.createdAt)}</span><strong class="${entry.amount >= 0 ? "up" : "down"}">${entry.amount >= 0 ? "+" : ""}${formatNumber(entry.amount, 0)} · ${formatNumber(entry.balanceAfter, 0)}</strong></li>`).join("") || "<li>暂无积分记录</li>";
    } catch {
      target.innerHTML = "<li>积分明细暂时无法读取</li>";
    }
  }

  async function deleteAccount() {
    if (!window.confirm("将永久删除账户、积分、明细与当前交流内容。确定继续吗？")) return;
    try {
      await api(`${API_ROOT}/account`, { method: "DELETE" });
      clearSession();
      closeDialog($("#account-dialog"));
      toast("林猫账户及关联数据已删除");
    } catch (error) {
      toast(errorMessage(error));
    }
  }

  function setAuthMode(mode) {
    state.authMode = mode;
    $$("[data-auth-mode]").forEach((button) => button.classList.toggle("is-active", button.dataset.authMode === mode));
    $("#auth-submit").textContent = mode === "login" ? "登录" : "注册并登录";
    $("#auth-password").autocomplete = mode === "login" ? "current-password" : "new-password";
  }

  async function submitAuth(event) {
    event.preventDefault();
    const username = $("#auth-username").value.trim();
    const password = $("#auth-password").value;
    const feedback = $("#auth-feedback");
    feedback.textContent = "正在验证…";
    try {
      const payload = await api(`${API_ROOT}/auth/password/${state.authMode}`, {
        method: "POST", auth: false,
        body: JSON.stringify({ username, password, platform: "web", installationId: state.installationId }),
      });
      state.token = payload.sessionToken;
      state.account = payload.account;
      resetHeartbeatState();
      localStorage.setItem("lynncat-market-session", state.token);
      feedback.textContent = "";
      updateAccountUI();
      renderAccountDialog();
      startHeartbeat();
      await Promise.allSettled([refreshPokerStatus(), refreshCardsStatus()]);
      toast(state.authMode === "login" ? "登录成功" : "账号已创建");
    } catch (error) {
      feedback.textContent = errorMessage(error);
    }
  }

  async function refreshAccount() {
    if (!state.token) return null;
    try {
      const payload = await api(`${API_ROOT}/account`);
      state.account = payload.account;
      updateAccountUI();
      return state.account;
    } catch (error) {
      if (error.status === 401) clearSession();
      return null;
    }
  }

  function updateAccountUI() {
    $("#account-button-label").textContent = state.account ? `${state.account.nickname} · ${formatNumber(state.account.pointsBalance, 0)}` : "登录林猫账号";
    renderAccountDialog();
    updateOnlineCreditUI();
  }

  function resetHeartbeatState() {
    state.leaseVersion = 0;
    state.activeSeconds = 0;
    state.nextCreditAt = null;
    state.heartbeatServerOffset = 0;
    localStorage.removeItem("lynncat-lease-version");
  }

  function updateOnlineCreditUI() {
    const target = $("#online-credit-status");
    if (!target) return;
    if (!state.account) {
      target.innerHTML = `<i class="bi bi-clock-history"></i><span>登录后，页面保持前台在线，每分钟获得 1 积分。</span>`;
      return;
    }
    if (document.hidden) {
      target.innerHTML = `<i class="bi bi-pause-circle"></i><span>在线积分已暂停，返回页面后继续累计。</span>`;
      return;
    }
    const serverNow = Date.now() + state.heartbeatServerOffset;
    const seconds = Number.isFinite(Number(state.nextCreditAt))
      ? Math.max(0, Math.ceil((Number(state.nextCreditAt) - serverNow) / 1000))
      : Math.max(0, 60 - Number(state.activeSeconds || 0));
    target.innerHTML = `<i class="bi bi-timer"></i><span>在线累计中 · ${seconds || 60} 秒后 +1 积分</span>`;
  }

  function clearSession() {
    state.token = "";
    state.account = null;
    state.cardsStatus = null;
    state.ownedCards = new Map();
    state.pokerStatus = null;
    state.poker = createPokerState();
    localStorage.removeItem("lynncat-market-session");
    clearInterval(state.heartbeatTimer);
    clearInterval(state.onlineStatusTimer);
    state.heartbeatTimer = null;
    state.onlineStatusTimer = null;
    state.heartbeatRequest = null;
    const featuredCard = $("#featured-card");
    if (featuredCard) delete featuredCard.dataset.cardId;
    resetHeartbeatState();
    updateAccountUI();
    renderCards();
    renderPokerIdleCards();
    hidePokerResult();
    showPokerMessage("准备发牌 / Ready to deal", "登录林猫账号后，使用积分牌桌开始一手牌。");
    setPokerControls(false);
    renderPokerStatus();
  }

  async function logout() {
    if (state.heartbeatRequest) await state.heartbeatRequest.catch(() => {});
    if (state.token) {
      await api(`${API_ROOT}/points/heartbeat/stop`, {
        method: "POST",
        body: JSON.stringify({ leaseVersion: state.leaseVersion }),
      }).catch(() => {});
      await api(`${API_ROOT}/auth/logout`, { method: "POST" }).catch(() => {});
    }
    clearSession();
    closeDialog($("#account-dialog"));
    toast("已退出登录");
  }

  async function heartbeat() {
    if (!state.token || document.hidden) return;
    if (state.heartbeatRequest) return state.heartbeatRequest;
    const heartbeatToken = state.token;
    const request = (async () => {
      const payload = await api(`${API_ROOT}/points/heartbeat`, {
        method: "POST",
        headers: { "Idempotency-Key": `lynncat-web-heartbeat-${crypto.randomUUID()}` },
        body: JSON.stringify({ leaseVersion: state.leaseVersion }),
      });
      if (state.token !== heartbeatToken) return null;
      state.leaseVersion = Number(payload.leaseVersion ?? state.leaseVersion);
      state.activeSeconds = Number(payload.activeSeconds ?? state.activeSeconds);
      state.nextCreditAt = payload.nextCreditAt == null ? null : Number(payload.nextCreditAt);
      state.heartbeatServerOffset = Number(payload.serverTime || Date.now()) - Date.now();
      if (state.account) {
        state.account.pointsBalance = Number(payload.pointsBalance);
        if (payload.credited) state.account.pointsEarnedTotal = Number(state.account.pointsEarnedTotal || 0) + 1;
      }
      if (state.pokerStatus) state.pokerStatus.pointsBalance = Number(payload.pointsBalance);
      if (state.cardsStatus) state.cardsStatus.pointsBalance = Number(payload.pointsBalance);
      updateAccountUI();
      renderPokerStatus();
      renderCards();
      if (payload.credited && $("#account-dialog").open) loadLedger();
      return payload;
    })().catch((error) => {
      if (error?.status === 401) clearSession();
      updateOnlineCreditUI();
      return null;
    }).finally(() => {
      if (state.heartbeatRequest === request) state.heartbeatRequest = null;
    });
    state.heartbeatRequest = request;
    return request;
  }

  function startHeartbeat() {
    clearInterval(state.heartbeatTimer);
    clearInterval(state.onlineStatusTimer);
    heartbeat();
    state.heartbeatTimer = setInterval(heartbeat, 20_000);
    state.onlineStatusTimer = setInterval(updateOnlineCreditUI, 1_000);
    updateOnlineCreditUI();
  }

  async function loadLeaderboard() {
    const target = $("#leaderboard-list");
    target.innerHTML = `<li><span>—</span><strong>正在读取</strong><span>—</span></li>`;
    openDialog($("#leaderboard-dialog"));
    try {
      const payload = await api(`${API_ROOT}/leaderboard`, { auth: Boolean(state.token) });
      const entries = payload.entries || payload.leaderboard || [];
      target.innerHTML = entries.length ? entries.map((entry, index) => `<li><b>${index + 1}</b><strong>${escapeHTML(entry.nickname || "林猫用户")}</strong><span>${formatNumber(entry.pointsBalance ?? entry.points, 0)} PTS</span></li>`).join("") : `<li><b>—</b><strong>暂无排行数据</strong><span>—</span></li>`;
    } catch {
      target.innerHTML = `<li><b>1</b><strong>等待第一位林猫用户</strong><span>—</span></li>`;
    }
  }

  async function refreshCardsStatus() {
    if (!state.token) {
      state.cardsStatus = null; state.ownedCards = new Map(); renderCards(); return;
    }
    try {
      const payload = await api(`${API_ROOT}/points/shuihu`);
      state.cardsStatus = payload.cards;
      state.ownedCards = new Map((payload.cards.collection || []).map((entry) => [Number(entry.cardId), Number(entry.copies)]));
      if (state.account) state.account.pointsBalance = payload.cards.pointsBalance;
      renderCards();
      updateAccountUI();
    } catch (error) {
      if (error.status === 401) clearSession();
      renderCards();
    }
  }

  function renderCards() {
    const status = state.cardsStatus;
    $("#cards-points").textContent = state.account ? formatNumber(status?.pointsBalance ?? state.account.pointsBalance, 0) : "—";
    $("#cards-unique").textContent = `${status?.uniqueCount || 0} / 108`;
    $("#cards-draws").textContent = `${status?.drawsUsed || 0} / ${status?.dailyLimit || 10}`;
    const progress = Math.round((status?.uniqueCount || 0) / 108 * 100);
    $("#cards-progress-label").textContent = `${progress}%`;
    $("#cards-progress").style.width = `${progress}%`;
    $("#draw-remaining").textContent = state.token ? `今日剩余 ${status?.drawsRemaining ?? 10} 次 · 每位武将概率 1/108` : "登录后可查看今日抽卡次数";
    $("#draw-card-button").disabled = !state.token || (status?.drawsRemaining ?? 10) <= 0;
    const featuredId = Number($("#featured-card").dataset.cardId);
    if (Number.isInteger(featuredId) && featuredId >= 1 && featuredId <= 108 && state.ownedCards.has(featuredId)) {
      renderFeaturedCard(featuredId);
    } else {
      renderFeaturedPlaceholder();
    }
    renderCardGrid();
  }

  function cardData(id) {
    return (window.SHUIHU_CARDS || []).find((card) => card.id === Number(id)) || {
      id: Number(id), star: Number(id) <= 36 ? "天罡星" : "地煞星", nickname: "梁山好汉", name: `第${id}将`, role: "梁山头领", weapon: "兵器", signature: "替天行道", command: 70, might: 70, wisdom: 70, charisma: 70,
    };
  }

  function renderFeaturedCard(id) {
    const card = cardData(id);
    const copies = state.ownedCards.get(Number(id)) || 0;
    $("#featured-card").dataset.cardId = String(id);
    $("#featured-card").innerHTML = heroCardHTML(card, copies || 1);
  }

  function renderFeaturedPlaceholder() {
    const target = $("#featured-card");
    delete target.dataset.cardId;
    target.innerHTML = `<article class="hero-card-back" aria-label="聚义卡背，尚未抽卡">
      <div class="hero-card-back-inner"><i class="bi bi-star-fill" aria-hidden="true"></i><strong>聚 义</strong><span>水浒一百单八将</span><small>HERO MUSTER · 108</small></div>
    </article>`;
  }

  function heroCardHTML(card, copies) {
    return `<article class="hero-card">
      <div class="hero-card-top"><span>${String(card.id).padStart(3, "0")} · ${escapeHTML(card.star)}</span><i class="bi bi-star-fill" aria-hidden="true"></i></div>
      ${shuihuArtworkHTML(card, "large")}
      <div class="hero-card-copy"><strong>${escapeHTML(card.nickname)} · ${escapeHTML(card.name)}</strong><small>${escapeHTML(card.weapon)}，${escapeHTML(card.signature)}</small>
        <div class="rating-row"><span>统 ${card.command}<i style="width:${card.command}%"></i></span><span>武 ${card.might}<i style="width:${card.might}%"></i></span><span>智 ${card.wisdom}<i style="width:${card.wisdom}%"></i></span><span>魅 ${card.charisma}<i style="width:${card.charisma}%"></i></span></div>
      </div><b class="copy-badge">×${copies}</b>
    </article>`;
  }

  function shuihuArtworkHTML(card, size = "small") {
    const weapon = String(card.weapon || "");
    const glyph = /扇|书|算盘|笔|符/.test(weapon) ? "羽" : /弓|弩|箭/.test(weapon) ? "弓" : /刀|剑/.test(weapon) ? "刃" : /枪|矛|叉|戟/.test(weapon) ? "枪" : /斧|锤|棒|鞭/.test(weapon) ? "武" : "义";
    const hue = card.id <= 36 ? 42 + (card.id % 5) * 4 : 164 + (card.id % 7) * 5;
    return `<div class="shuihu-art ${size}" style="--card-hue:${hue}" role="img" aria-label="${escapeHTML(card.nickname)} ${escapeHTML(card.name)}"><i>${glyph}</i><span>${escapeHTML(card.name)}</span><small>${escapeHTML(card.weapon)}</small></div>`;
  }

  function renderCardGrid() {
    const cards = window.SHUIHU_CARDS || Array.from({ length: 108 }, (_, index) => cardData(index + 1));
    const filtered = cards.filter((card) => {
      const owned = state.ownedCards.has(card.id);
      return state.cardFilter === "all" || (state.cardFilter === "owned" ? owned : !owned);
    });
    $("#card-grid").innerHTML = filtered.map((card) => {
      const copies = state.ownedCards.get(card.id) || 0;
      if (!copies) return `<button class="collection-card missing" data-card-id="${card.id}" type="button" aria-label="第${card.id}张，尚未获得"><span><b>${String(card.id).padStart(3, "0")}</b><i>?</i><small>${card.id <= 36 ? "天罡待聚" : "地煞待聚"}</small></span></button>`;
      return `<button class="collection-card" data-card-id="${card.id}" type="button">${shuihuArtworkHTML(card)}<span class="collection-card-copy"><strong>${escapeHTML(card.nickname)} · ${escapeHTML(card.name)}</strong><small>${escapeHTML(card.star)} · ${card.might} 武</small></span><b class="copy-badge">×${copies}</b></button>`;
    }).join("");
  }

  async function drawCard() {
    if (!state.token) return openAccountDialog();
    const button = $("#draw-card-button");
    button.disabled = true;
    $("#draw-feedback").textContent = "正在聚义抽卡…";
    try {
      const payload = await api(`${API_ROOT}/points/shuihu/draw`, {
        method: "POST",
        headers: { "Idempotency-Key": `lynncat-markets-shuihu-${crypto.randomUUID()}` },
      });
      state.cardsStatus = payload.draw;
      state.ownedCards = new Map((payload.draw.collection || []).map((entry) => [Number(entry.cardId), Number(entry.copies)]));
      if (state.account) state.account.pointsBalance = payload.draw.pointsBalance;
      $("#featured-card").dataset.cardId = String(payload.draw.cardId);
      renderCards();
      $("#draw-feedback").textContent = payload.draw.rewardGranted ? "聚义圆满！已获得 1,000,000 积分" : payload.draw.isNew ? `新武将入册！第 ${payload.draw.uniqueCount} / 108 张` : `重复卡 · 当前共 ${payload.draw.copies} 张`;
      toast(`抽到 ${cardData(payload.draw.cardId).nickname} · ${cardData(payload.draw.cardId).name}`);
      updateAccountUI();
    } catch (error) {
      $("#draw-feedback").textContent = errorMessage(error);
      button.disabled = false;
    }
  }

  const POKER_PLAYER_NAMES = ["你 / You", "Lin", "Taka", "Jo"];

  function createPokerState() {
    return {
      phase: "ready", street: "idle", deck: [], players: [], community: [], pot: 0,
      currentBet: 0, handId: null, dealer: 3, handNo: 0, actor: -1,
      hasActed: new Set(), startingBalance: 0, result: null,
      soundOn: localStorage.getItem("lynncat-poker-sound") !== "off",
    };
  }

  function buildDeck() {
    const suits = ["♠", "♥", "♦", "♣"];
    const ranks = [
      ["2", 2], ["3", 3], ["4", 4], ["5", 5], ["6", 6], ["7", 7], ["8", 8], ["9", 9], ["10", 10], ["J", 11], ["Q", 12], ["K", 13], ["A", 14],
    ];
    return suits.flatMap((suit) => ranks.map(([rank, value]) => ({ suit, rank, value })));
  }

  function secureShuffle(cards) {
    for (let index = cards.length - 1; index > 0; index -= 1) {
      const random = new Uint32Array(1);
      crypto.getRandomValues(random);
      const target = random[0] % (index + 1);
      [cards[index], cards[target]] = [cards[target], cards[index]];
    }
    return cards;
  }

  function pokerCardPlaceholderHTML() {
    return `<span class="playing-card placeholder" aria-hidden="true"></span>`;
  }

  function cardHTML(card, hidden = false) {
    if (!card) return pokerCardPlaceholderHTML();
    if (hidden) return `<span class="playing-card back" aria-label="暗牌"></span>`;
    const suit = ["♠", "♥", "♦", "♣"].includes(card.suit) ? card.suit : "?";
    const rank = escapeHTML(String(card.rank || "?"));
    const red = suit === "♥" || suit === "♦";
    return `<span class="playing-card ${red ? "red" : ""}" aria-label="${rank}${suit}"><span>${rank}${suit}</span><span class="suit-large">${suit}</span><span class="card-bottom">${rank}${suit}</span></span>`;
  }

  function renderPokerIdleCards() {
    $$("[data-seat] .hole-cards").forEach((target) => {
      target.innerHTML = pokerCardPlaceholderHTML().repeat(2);
    });
    $$("[data-seat]").forEach((seat) => {
      seat.classList.remove("is-active", "folded");
      const stack = $(".seat-info b", seat);
      if (stack) stack.textContent = seat.dataset.seat === "0" ? "— PTS" : "2,500 PTS";
    });
    $$(".dealer-chip").forEach((chip) => chip.remove());
    const dealerSeat = $(`[data-seat="3"] .seat-info`);
    if (dealerSeat) dealerSeat.insertAdjacentHTML("afterbegin", `<i class="dealer-chip">D</i> `);
    $("#community-cards").innerHTML = pokerCardPlaceholderHTML().repeat(5);
    $("#poker-pot").textContent = "0 PTS";
    $("#hand-strength").textContent = "尚未发牌 / No cards";
    $("#hand-strength-detail").textContent = "—";
  }

  async function refreshPokerStatus() {
    if (!state.token) {
      state.pokerStatus = null; renderPokerStatus(); return;
    }
    try {
      const payload = await api(`${API_ROOT}/points/poker`);
      state.pokerStatus = payload.poker;
      if (state.account) state.account.pointsBalance = payload.poker.pointsBalance;
      renderPokerStatus();
      updateAccountUI();
    } catch {
      renderPokerStatus();
    }
  }

  function renderPokerStatus() {
    const status = state.pokerStatus;
    $("#poker-points").textContent = state.account ? formatNumber(status?.pointsBalance ?? state.account.pointsBalance, 0) : "—";
    $("#poker-won").textContent = status ? `${formatNumber(status.dailyWon, 0)} / ${formatNumber(status.dailyLimit, 0)}` : "—";
    const percent = status ? clamp(status.dailyWon / status.dailyLimit * 100, 0, 100) : 0;
    $("#poker-limit-percent").textContent = `${Math.round(percent)}%`;
    $("#poker-progress").style.width = `${percent}%`;
    $("#poker-remaining").textContent = status ? `剩余 ${formatNumber(status.dailyRemaining, 0)} 分 / ${formatNumber(status.dailyRemaining, 0)} remaining` : "登录后同步额度";
    if (state.poker.phase === "ready") {
      const balance = status?.pointsBalance ?? state.account?.pointsBalance;
      $("#user-stack").textContent = Number.isFinite(Number(balance)) ? `${formatNumber(balance, 0)} PTS` : "— PTS";
    }
    const pending = loadLocalJson("lynncat-poker-pending", null);
    if (pending) {
      $("#poker-hand-status").textContent = "RETRY";
      $("#poker-deal").innerHTML = `<i class="bi bi-arrow-repeat"></i><span>重试结算 / Retry</span>`;
      if (pending.result) {
        showPokerResult(pending.result, "结算尚未同步，开始下一手前请重试。/ Settlement pending.", { error: true, action: "重试结算 / Retry" });
      } else {
        showPokerMessage("发现待结算牌局 / Pending settlement", "完成服务器结算前不能开始新牌局。");
      }
      return;
    }
    if (!state.token) {
      showPokerMessage("准备发牌 / Ready to deal", "登录林猫账号后，使用积分牌桌开始一手牌。");
      return;
    }
    if (status && Number(status.dailyRemaining) <= 0 && state.poker.phase === "ready") {
      showPokerMessage("今日赢分已达每日额度 / Daily Limit Reached", "额度将在中国时区次日 00:00 重置。");
      return;
    }
    if (state.poker.phase === "ready") {
      $("#poker-table-message").hidden = true;
    }
  }

  function logHand(text, type = "") {
    const list = $("#hand-log-list");
    if (list.children.length === 1 && list.textContent.includes("等待发牌")) list.innerHTML = "";
    const item = document.createElement("li");
    item.className = type;
    item.innerHTML = `<i class="bi bi-${type === "win" ? "check-circle" : type === "loss" ? "x-circle" : "record-circle"}"></i><span>${escapeHTML(text)}</span>`;
    list.prepend(item);
  }

  function pokerRandom() {
    const value = new Uint32Array(1);
    crypto.getRandomValues(value);
    return value[0] / 0x1_0000_0000;
  }

  function playPokerSound(kind = "chip") {
    if (!state.poker.soundOn || !window.AudioContext) return;
    try {
      const context = new AudioContext();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = kind === "win" ? "sine" : "triangle";
      oscillator.frequency.value = kind === "deal" ? 330 : kind === "win" ? 660 : kind === "fold" ? 180 : 440;
      gain.gain.setValueAtTime(0.045, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.12);
      oscillator.connect(gain).connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.12);
      oscillator.addEventListener("ended", () => context.close());
    } catch {}
  }

  function activePokerPlayers() {
    return state.poker.players.filter((player) => !player.folded);
  }

  function nextPokerActor(after) {
    for (let offset = 1; offset <= state.poker.players.length; offset += 1) {
      const candidate = (after + offset) % state.poker.players.length;
      const player = state.poker.players[candidate];
      if (!player.folded && player.stack > 0) return candidate;
    }
    return null;
  }

  function pokerContribute(player, amount) {
    const paid = Math.min(Math.max(0, amount), player.stack);
    player.stack -= paid;
    player.bet += paid;
    player.contribution += paid;
    state.poker.pot += paid;
    return paid;
  }

  function pokerRoundOver() {
    const contenders = state.poker.players.filter((player) => !player.folded && player.stack > 0);
    return !contenders.length || (contenders.every((player) => state.poker.hasActed.has(player.id))
      && contenders.every((player) => player.bet === state.poker.currentBet));
  }

  function pokerStreetLabel() {
    return ({ preflop: "PREFLOP", flop: "FLOP", turn: "TURN", river: "RIVER" })[state.poker.street] || "READY";
  }

  async function dealPokerHand() {
    if (state.poker.phase === "playing" || state.poker.phase === "settling") return;
    if (!state.token) return openAccountDialog();
    const pending = loadLocalJson("lynncat-poker-pending", null);
    if (pending) return settlePoker(pending.delta, pending.message, pending.type, pending.handId, pending.result);
    if (!state.pokerStatus) await refreshPokerStatus();
    if ((state.pokerStatus?.dailyRemaining ?? 1) <= 0) {
      showPokerMessage("今日赢分已达每日额度 / Daily Limit Reached", "额度将在中国时区次日 00:00 重置。");
      return;
    }
    const previousDealer = state.poker.dealer ?? 3;
    const handNo = Number(state.poker.handNo || 0) + 1;
    const dealer = (previousDealer + 1) % 4;
    const deck = secureShuffle(buildDeck());
    const bankroll = Number(state.pokerStatus?.pointsBalance || state.account?.pointsBalance || 0);
    if (bankroll <= 0) return showPokerMessage("积分不足 / No points", "在线运行或参与社区可获得积分。");
    hidePokerResult();
    const players = Array.from({ length: 4 }, (_, id) => ({
      id, cards: [deck.pop(), deck.pop()], stack: id === 0 ? bankroll : 2500,
      folded: false, contribution: 0, bet: 0,
    }));
    state.poker = {
      phase: "playing", street: "preflop", deck, players, community: [], pot: 0,
      currentBet: 50, handId: crypto.randomUUID(), dealer, handNo, actor: -1,
      hasActed: new Set(), startingBalance: bankroll, result: null, soundOn: state.poker.soundOn,
    };
    const smallBlind = players[(dealer + 1) % 4];
    const bigBlind = players[(dealer + 2) % 4];
    pokerContribute(smallBlind, 25);
    pokerContribute(bigBlind, 50);
    $("#poker-hand-status").textContent = "PREFLOP";
    $("#poker-table-message").hidden = true;
    renderPokerCards(false);
    setPokerControls(false);
    updateHandStrength();
    configureRaiseSlider();
    logHand(`第 ${handNo} 手 · 按钮位在 ${POKER_PLAYER_NAMES[dealer]}`);
    logHand(`${POKER_PLAYER_NAMES[smallBlind.id]} 投入小盲 25 PTS`);
    logHand(`${POKER_PLAYER_NAMES[bigBlind.id]} 投入大盲 50 PTS`);
    playPokerSound("deal");
    state.poker.actor = nextPokerActor(dealer) ?? dealer;
    await runPokerEngine();
  }

  function renderPokerCards(revealOpponents = false) {
    state.poker.players.forEach((player) => {
      const target = player.id === 0 ? $("#user-hole-cards") : $(`[data-seat="${player.id}"] .hole-cards`);
      const hidden = player.folded || (player.id !== 0 && !revealOpponents);
      target.innerHTML = player.cards.map((card) => cardHTML(card, hidden)).join("");
      const seat = $(`[data-seat="${player.id}"]`);
      if (seat) {
        const stack = $(".seat-info b", seat);
        if (stack) stack.textContent = `${formatNumber(player.stack, 0)} PTS`;
        seat.classList.toggle("folded", player.folded);
        seat.classList.toggle("is-active", state.poker.phase === "playing" && player.id === state.poker.actor);
      }
    });
    $$(".dealer-chip").forEach((chip) => chip.remove());
    const dealerSeat = $(`[data-seat="${state.poker.dealer}"] .seat-info`);
    if (dealerSeat) dealerSeat.insertAdjacentHTML("afterbegin", `<i class="dealer-chip">D</i> `);
    const community = state.poker.community.map((card) => cardHTML(card));
    while (community.length < 5) community.push(pokerCardPlaceholderHTML());
    $("#community-cards").innerHTML = community.join("");
    $("#poker-pot").textContent = `${formatNumber(state.poker.pot, 0)} PTS`;
  }

  function setPokerControls(active) {
    const player = state.poker.players[0];
    const canRaise = Boolean(active && player && pokerRaiseBounds(player).canRaise);
    $("#poker-fold").disabled = !active;
    $("#poker-check").disabled = !active;
    $("#poker-raise").disabled = !canRaise;
    $("#poker-deal").disabled = state.poker.phase === "playing" || state.poker.phase === "settling";
    $("#raise-control").hidden = !canRaise;
  }

  function showPokerMessage(title, detail) {
    hidePokerResult();
    const message = $("#poker-table-message");
    message.hidden = false;
    $("strong", message).textContent = title;
    $("span", message).textContent = detail;
  }

  function hidePokerResult() {
    const panel = $("#poker-result-panel");
    const log = $("#poker-log-panel");
    if (panel) panel.hidden = true;
    if (log) log.hidden = false;
  }

  function showPokerResult(result, statusText, options = {}) {
    const panel = $("#poker-result-panel");
    const log = $("#poker-log-panel");
    if (!panel || !log || !result) return;
    $("#poker-table-message").hidden = true;
    const summaries = Array.isArray(result.winnerSummaries) ? result.winnerSummaries : [];
    const user = result.user || {};
    const net = Number(user.netDelta || 0);
    const contribution = Math.max(0, Number(user.contribution || 0));
    const payout = Math.max(0, Number(user.payout || 0));
    const winners = summaries.map((summary) => {
      const cards = Array.isArray(summary.cards) ? summary.cards.slice(0, 5) : [];
      return `<div class="poker-winner"><strong>${escapeHTML(summary.name || "赢家 / Winner")}</strong><small>${escapeHTML(summary.hand || result.reason || "对手全部弃牌 / Everyone folded")}</small><div class="poker-result-cards ${cards.length ? "" : "empty"}">${cards.length ? cards.map((card) => cardHTML(card)).join("") : "无人跟注，底牌不公开 / Uncontested"}</div></div>`;
    }).join("");
    const action = options.action || "下一手 / Next Hand";
    panel.innerHTML = `<div class="poker-result-heading"><i class="bi bi-trophy-fill" aria-hidden="true"></i><span><small>摊牌结果 / RESULT</small><strong>${escapeHTML(result.message || "本手结束 / Hand over")}</strong></span></div>
      <div class="poker-result-section"><small>赢家与最佳五张 / WINNERS · BEST FIVE</small>${winners}</div>
      <div class="poker-result-section"><small>你的结算 / YOUR SETTLEMENT</small><div class="poker-result-metrics"><span><small>投入 / BET</small><strong>${formatNumber(contribution, 0)}</strong></span><span><small>赢回 / PAYOUT</small><strong>${formatNumber(payout, 0)}</strong></span><span><small>净额 / NET</small><strong>${net >= 0 ? "+" : ""}${formatNumber(net, 0)}</strong></span></div></div>
      <p class="poker-result-status ${options.error ? "error" : ""}">${escapeHTML(statusText || "")}</p>
      <button class="poker-result-action" type="button">${escapeHTML(action)}</button>`;
    panel.hidden = false;
    log.hidden = true;
    $(".poker-result-action", panel).addEventListener("click", dealPokerHand);
  }

  function configureRaiseSlider() {
    const slider = $("#raise-slider");
    const player = state.poker.players[0];
    const { minimum, maximum, canRaise } = pokerRaiseBounds(player);
    slider.min = String(minimum);
    slider.max = String(maximum);
    const previous = Number(slider.value);
    slider.value = String(canRaise && Number.isFinite(previous) && previous >= minimum && previous <= maximum
      ? window.LynncatPokerRules.normalizeTarget(previous, pokerRaiseSituation(player))
      : minimum);
    $("#raise-value").textContent = `${formatNumber(slider.value, 0)} PTS`;
  }

  function pokerRaiseSituation(player) {
    return {
      currentBet: state.poker.currentBet,
      pot: state.poker.pot,
      stack: Number(player?.stack || 0),
      bet: Number(player?.bet || 0),
    };
  }

  function pokerRaiseBounds(player) {
    return window.LynncatPokerRules.raiseBounds(pokerRaiseSituation(player));
  }

  function setPokerRaisePreset(fraction) {
    const player = state.poker.players[0];
    const target = window.LynncatPokerRules.presetTarget(fraction, pokerRaiseSituation(player));
    if (target === null) return;
    const slider = $("#raise-slider");
    slider.value = String(target);
    slider.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function setPokerRaiseMaximum() {
    const player = state.poker.players[0];
    const bounds = pokerRaiseBounds(player);
    if (!bounds.canRaise) return;
    const slider = $("#raise-slider");
    slider.value = String(bounds.maximum);
    slider.dispatchEvent(new Event("input", { bubbles: true }));
  }

  async function advancePokerStreet(raised = false) {
    if (state.poker.phase !== "playing" || state.poker.actor !== 0) return;
    const player = state.poker.players[0];
    const raiseBounds = pokerRaiseBounds(player);
    if (raised && !raiseBounds.canRaise) return;
    setPokerControls(false);
    if (raised) {
      const target = window.LynncatPokerRules.normalizeTarget(
        $("#raise-slider").value,
        pokerRaiseSituation(player),
      );
      if (target === null || target <= state.poker.currentBet) {
        setPokerControls(true);
        configureRaiseSlider();
        return;
      }
      pokerContribute(player, Math.max(0, target - player.bet));
      state.poker.currentBet = Math.max(state.poker.currentBet, player.bet);
      logHand(`你加注至 ${formatNumber(player.bet, 0)} PTS`);
      playPokerSound("chip");
    } else {
      const due = Math.max(0, state.poker.currentBet - player.bet);
      const paid = pokerContribute(player, due);
      logHand(due ? `你跟注 ${formatNumber(paid, 0)} PTS` : "你过牌 · 牌局继续");
      playPokerSound("chip");
    }
    state.poker.hasActed.add(0);
    state.poker.actor = nextPokerActor(0) ?? 0;
    renderPokerCards(false);
    await runPokerEngine();
  }

  async function foldPokerHand() {
    if (state.poker.phase !== "playing" || state.poker.actor !== 0) return;
    state.poker.players[0].folded = true;
    state.poker.hasActed.add(0);
    state.poker.actor = nextPokerActor(0) ?? 0;
    logHand("你弃牌 / Folded", "loss");
    playPokerSound("fold");
    renderPokerCards(false);
    setPokerControls(false);
    await runPokerEngine();
  }

  async function runPokerEngine() {
    let safety = 0;
    while (state.poker.phase === "playing" && safety++ < 400) {
      const active = activePokerPlayers();
      if (active.length === 1) return finishPokerByFold(active[0]);
      if (pokerRoundOver()) {
        if (state.poker.street === "river") return finishPokerHand();
        await dealNextPokerStreet();
        continue;
      }
      const player = state.poker.players[state.poker.actor];
      if (!player || player.folded || player.stack <= 0) {
        if (player) state.poker.hasActed.add(player.id);
        state.poker.actor = nextPokerActor(state.poker.actor) ?? 0;
        continue;
      }
      if (player.id === 0) {
        const due = Math.max(0, state.poker.currentBet - player.bet);
        $("#poker-check-label").textContent = due ? `跟注 ${formatNumber(Math.min(due, player.stack), 0)} / Call` : "过牌 / Check";
        $("#poker-hand-status").textContent = pokerStreetLabel();
        configureRaiseSlider();
        setPokerControls(true);
        renderPokerCards(false);
        updateHandStrength();
        return;
      }
      await pokerBotAct(player);
      state.poker.hasActed.add(player.id);
      state.poker.actor = nextPokerActor(player.id) ?? 0;
      renderPokerCards(false);
      await sleep(180);
    }
  }

  async function pokerBotAct(player) {
    const due = Math.max(0, state.poker.currentBet - player.bet);
    const high = Math.max(...player.cards.map((card) => card.value)) / 14;
    const pair = player.cards[0].value === player.cards[1].value ? 0.32 : 0;
    const made = state.poker.community.length >= 3 ? bestHand([...player.cards, ...state.poker.community]).category / 9 : 0;
    const equity = clamp(high * 0.48 + pair + made * 0.5, 0, 1);
    const potOdds = due / Math.max(1, state.poker.pot + due);
    const name = POKER_PLAYER_NAMES[player.id];
    if (due > 0 && equity + pokerRandom() * 0.18 < potOdds + 0.08) {
      player.folded = true;
      logHand(`${name} 弃牌`);
      playPokerSound("fold");
      return;
    }
    const raiseBounds = pokerRaiseBounds(player);
    const raiseTarget = raiseBounds.canRaise
      ? window.LynncatPokerRules.normalizeTarget(
        due === 0
          ? Math.max(50, Math.floor(state.poker.pot / 2 / 50) * 50)
          : state.poker.currentBet + Math.max(50, Math.floor(state.poker.pot / 2 / 50) * 50),
        pokerRaiseSituation(player),
      )
      : null;
    if (player.stack > due && equity > 0.7 && pokerRandom() < 0.32 && raiseTarget > state.poker.currentBet) {
      const target = raiseTarget;
      pokerContribute(player, Math.max(0, target - player.bet));
      state.poker.currentBet = Math.max(state.poker.currentBet, player.bet);
      logHand(`${name} 加注至 ${formatNumber(player.bet, 0)} PTS`);
    } else {
      const paid = pokerContribute(player, due);
      logHand(due ? `${name} 跟注 ${formatNumber(paid, 0)} PTS` : `${name} 过牌`);
    }
    playPokerSound("chip");
  }

  async function dealNextPokerStreet() {
    state.poker.players.forEach((player) => { player.bet = 0; });
    state.poker.currentBet = 0;
    state.poker.hasActed = new Set();
    if (state.poker.street === "preflop") {
      state.poker.street = "flop";
      state.poker.deck.pop();
      state.poker.community.push(state.poker.deck.pop(), state.poker.deck.pop(), state.poker.deck.pop());
    } else if (state.poker.street === "flop") {
      state.poker.street = "turn";
      state.poker.deck.pop();
      state.poker.community.push(state.poker.deck.pop());
    } else {
      state.poker.street = "river";
      state.poker.deck.pop();
      state.poker.community.push(state.poker.deck.pop());
    }
    state.poker.actor = nextPokerActor(state.poker.dealer) ?? state.poker.dealer;
    $("#poker-hand-status").textContent = pokerStreetLabel();
    logHand(`${pokerStreetLabel()} · ${state.poker.community.map((card) => `${card.rank}${card.suit}`).join(" ")}`);
    playPokerSound("deal");
    renderPokerCards(false);
    updateHandStrength();
    await sleep(260);
  }

  function pokerSidePots() {
    const levels = [...new Set(state.poker.players.map((player) => player.contribution).filter((value) => value > 0))].sort((left, right) => left - right);
    let previous = 0;
    return levels.map((level) => {
      const contributors = state.poker.players.filter((player) => player.contribution >= level);
      const amount = (level - previous) * contributors.length;
      previous = level;
      return { amount, eligible: contributors.filter((player) => !player.folded) };
    }).filter((layer) => layer.amount > 0 && layer.eligible.length);
  }

  async function finishPokerHand() {
    while (state.poker.community.length < 5) state.poker.community.push(state.poker.deck.pop());
    const scores = new Map(activePokerPlayers().map((player) => [player.id, bestHand([...player.cards, ...state.poker.community])]));
    const allWinners = new Set();
    pokerSidePots().forEach((layer) => {
      const sorted = layer.eligible.map((player) => ({ player, score: scores.get(player.id) })).sort((left, right) => compareScore(right.score, left.score));
      const winners = sorted.filter((entry) => compareScore(entry.score, sorted[0].score) === 0);
      const share = Math.floor(layer.amount / winners.length);
      let remainder = layer.amount % winners.length;
      winners.forEach(({ player }) => {
        player.stack += share + (remainder-- > 0 ? 1 : 0);
        allWinners.add(player.id);
      });
    });
    renderPokerCards(true);
    const userScore = bestHand([...state.poker.players[0].cards, ...state.poker.community]);
    $("#hand-strength").textContent = userScore.name;
    $("#hand-strength-detail").textContent = userScore.label;
    const delta = state.poker.players[0].stack - state.poker.startingBalance;
    const winnerNames = [...allWinners].map((id) => POKER_PLAYER_NAMES[id]).join("、");
    const message = allWinners.has(0) ? `你以${userScore.name}获得底池` : `${winnerNames} 赢得底池`;
    const human = state.poker.players[0];
    const result = {
      message,
      reason: userScore.name,
      potAmount: state.poker.pot,
      winnerSummaries: [...allWinners].map((id) => ({
        name: POKER_PLAYER_NAMES[id],
        hand: scores.get(id)?.name || "最佳牌型 / Best hand",
        cards: scores.get(id)?.cards || [],
      })),
      user: {
        contribution: human.contribution,
        payout: Math.max(0, human.contribution + delta),
        netDelta: delta,
      },
    };
    state.poker.result = result;
    await settlePoker(delta, message, delta >= 0 ? "win" : "loss", undefined, result);
  }

  async function finishPokerByFold(winner) {
    winner.stack += state.poker.pot;
    const delta = state.poker.players[0].stack - state.poker.startingBalance;
    renderPokerCards(false);
    const human = state.poker.players[0];
    const message = `${POKER_PLAYER_NAMES[winner.id]} 收下无人跟注的底池`;
    const result = {
      message,
      reason: "对手全部弃牌 / Everyone folded",
      potAmount: state.poker.pot,
      winnerSummaries: [{
        name: POKER_PLAYER_NAMES[winner.id],
        hand: "对手全部弃牌 / Everyone folded",
        cards: [],
      }],
      user: {
        contribution: human.contribution,
        payout: Math.max(0, human.contribution + delta),
        netDelta: delta,
      },
    };
    state.poker.result = result;
    await settlePoker(delta, message, delta >= 0 ? "win" : "loss", undefined, result);
  }

  async function settlePoker(delta, message, type, handId = state.poker.handId, result = state.poker.result) {
    state.poker.phase = "settling";
    state.poker.result = result || null;
    $$("[data-seat]").forEach((seat) => seat.classList.remove("is-active"));
    setPokerControls(false);
    $("#poker-hand-status").textContent = "SETTLE";
    logHand(`${message} · 净变化 ${delta >= 0 ? "+" : ""}${delta} PTS`, type);
    localStorage.setItem("lynncat-poker-pending", JSON.stringify({ handId, delta, message, type, result }));
    try {
      const payload = await api(`${API_ROOT}/points/poker/settle`, {
        method: "POST",
        headers: { "Idempotency-Key": `lynncat-markets-poker-${handId}` },
        body: JSON.stringify({ handId, delta }),
      });
      state.pokerStatus = {
        pointsBalance: payload.settlement.pointsBalance,
        dailyWon: payload.settlement.dailyWon,
        dailyLimit: payload.settlement.dailyLimit,
        dailyRemaining: payload.settlement.dailyRemaining,
      };
      if (state.account) state.account.pointsBalance = payload.settlement.pointsBalance;
      localStorage.removeItem("lynncat-poker-pending");
      state.poker.phase = "ready";
      $("#poker-hand-status").textContent = "READY";
      $("#poker-deal").innerHTML = `<i class="bi bi-collection-fill"></i><span>下一手 / Next</span>`;
      renderPokerStatus();
      updateAccountUI();
      if (result) {
        showPokerResult(result, `账户积分已同步 · 本手计入 ${payload.settlement.appliedDelta >= 0 ? "+" : ""}${payload.settlement.appliedDelta} PTS`, { action: "下一手 / Next Hand" });
      }
      playPokerSound("win");
    } catch (error) {
      state.poker.phase = "settlement-error";
      $("#poker-hand-status").textContent = "RETRY";
      $("#poker-deal").innerHTML = `<i class="bi bi-arrow-repeat"></i><span>重试结算 / Retry</span>`;
      if (result) {
        showPokerResult(result, `结算暂未同步：${errorMessage(error)}。开始下一手前必须重试。`, { error: true, action: "重试结算 / Retry" });
      } else {
        showPokerMessage(message, `结算暂未同步：${errorMessage(error)}。开始下一手前必须重试。`);
      }
    }
    $("#poker-deal").disabled = false;
  }

  function updateHandStrength() {
    const cards = [...(state.poker.players[0]?.cards || []), ...state.poker.community];
    if (cards.length < 2) return;
    const score = cards.length >= 5 ? bestHand(cards) : { name: cards[0].value === cards[1].value ? "一对 / Pair" : "高牌 / High Card", label: cards.map((card) => `${card.rank}${card.suit}`).join(" ") };
    $("#hand-strength").textContent = score.name;
    $("#hand-strength-detail").textContent = score.label;
  }

  function bestHand(cards) {
    const combinations = choose(cards, 5);
    return combinations.map(rankFive).sort(compareScore).at(-1);
  }

  function choose(cards, count, start = 0, prefix = [], output = []) {
    if (prefix.length === count) { output.push(prefix); return output; }
    for (let index = start; index <= cards.length - (count - prefix.length); index += 1) choose(cards, count, index + 1, [...prefix, cards[index]], output);
    return output;
  }

  function rankFive(cards) {
    const values = cards.map((card) => card.value).sort((a, b) => b - a);
    const counts = new Map();
    values.forEach((value) => counts.set(value, (counts.get(value) || 0) + 1));
    const groups = [...counts.entries()].sort((left, right) => right[1] - left[1] || right[0] - left[0]);
    const flush = cards.every((card) => card.suit === cards[0].suit);
    let unique = [...new Set(values)];
    if (unique[0] === 14) unique = [...unique, 1];
    let straightHigh = 0;
    for (let index = 0; index <= unique.length - 5; index += 1) if (unique[index] - unique[index + 4] === 4) straightHigh = Math.max(straightHigh, unique[index]);
    let category; let tiebreak; let name;
    if (flush && straightHigh) { category = 8; tiebreak = [straightHigh]; name = straightHigh === 14 ? "皇家同花顺 / Royal Flush" : "同花顺 / Straight Flush"; }
    else if (groups[0][1] === 4) { category = 7; tiebreak = [groups[0][0], groups[1][0]]; name = "四条 / Four of a Kind"; }
    else if (groups[0][1] === 3 && groups[1][1] === 2) { category = 6; tiebreak = [groups[0][0], groups[1][0]]; name = "葫芦 / Full House"; }
    else if (flush) { category = 5; tiebreak = values; name = "同花 / Flush"; }
    else if (straightHigh) { category = 4; tiebreak = [straightHigh]; name = "顺子 / Straight"; }
    else if (groups[0][1] === 3) { category = 3; tiebreak = [groups[0][0], ...groups.slice(1).map((group) => group[0]).sort((a, b) => b - a)]; name = "三条 / Three of a Kind"; }
    else if (groups[0][1] === 2 && groups[1][1] === 2) { category = 2; tiebreak = [Math.max(groups[0][0], groups[1][0]), Math.min(groups[0][0], groups[1][0]), groups[2][0]]; name = "两对 / Two Pair"; }
    else if (groups[0][1] === 2) { category = 1; tiebreak = [groups[0][0], ...groups.slice(1).map((group) => group[0]).sort((a, b) => b - a)]; name = "一对 / Pair"; }
    else { category = 0; tiebreak = values; name = "高牌 / High Card"; }
    return { category, tiebreak, name, label: cards.map((card) => `${card.rank}${card.suit}`).join(" "), cards };
  }

  function compareScore(left, right) {
    if (left.category !== right.category) return left.category - right.category;
    for (let index = 0; index < Math.max(left.tiebreak.length, right.tiebreak.length); index += 1) {
      if ((left.tiebreak[index] || 0) !== (right.tiebreak[index] || 0)) return (left.tiebreak[index] || 0) - (right.tiebreak[index] || 0);
    }
    return 0;
  }

  function openAlertsDialog() {
    renderAlerts();
    openDialog($("#alerts-dialog"));
  }

  function renderAlerts() {
    $("#alerts-list").innerHTML = state.alerts.length ? state.alerts.map((alert) => {
      const currency = alert.currency || "CNY";
      const current = alertMarketValue(alert.symbol, currency);
      return `<div class="alert-item" data-alert-id="${escapeHTML(alert.id)}"><span><strong>${escapeHTML(ASSET_META[alert.symbol]?.name || alert.symbol)} ${alert.direction === "above" ? "高于" : "低于"} ${currency === "USD" ? "$" : "¥"}${formatNumber(alert.target, ASSET_META[alert.symbol]?.decimals ?? 2)}</strong><small>当前 ${currency === "USD" ? "$" : "¥"}${formatNumber(current, ASSET_META[alert.symbol]?.decimals ?? 2)} · ${alert.enabled ? "监控中" : "已停用"}${alert.triggered ? " · 已触发" : ""}</small></span><input data-toggle-alert type="checkbox" ${alert.enabled ? "checked" : ""} aria-label="启用提醒"><button data-delete-alert type="button" aria-label="删除提醒"><i class="bi bi-trash3"></i></button></div>`;
    }).join("") : `<div class="message-empty">尚未添加价格提醒。</div>`;
    updateAlertCurrentPrice();
  }

  function alertMarketValue(symbol, currency) {
    const quote = state.quotes[symbol] || {};
    const rate = currency === "USD" ? 1 : Number(state.rates?.CNY || 6.7746);
    if (["XAU", "SILVER", "PLATINUM", "PALLADIUM"].includes(symbol)) {
      const usdPerOunce = Number(quote.usd || 0);
      return usdPerOunce * rate / 31.1034768;
    }
    if (["BTC", "ETH", "DOGE", "TRUMP"].includes(symbol)) {
      return Number(quote.usd ?? (Number(quote.value || 0) / Number(state.rates?.CNY || 6.7746))) * rate;
    }
    return Number(quote.value || 0);
  }

  function updateAlertCurrentPrice() {
    const symbol = $("#alert-symbol")?.value;
    const currency = $("#alert-currency")?.value || "CNY";
    const target = $("#alert-current-price");
    if (!symbol || !target) return;
    const value = alertMarketValue(symbol, currency);
    target.textContent = `当前 ${currency === "USD" ? "$" : "¥"}${formatNumber(value, ASSET_META[symbol]?.decimals ?? 2)}${["XAU", "SILVER", "PLATINUM", "PALLADIUM"].includes(symbol) ? " / 克" : " / 枚"}`;
  }

  function saveAlerts() {
    localStorage.setItem("lynncat-price-alerts", JSON.stringify(state.alerts));
    renderAlerts();
  }

  function addPriceAlert(event) {
    event.preventDefault();
    const target = Number($("#alert-target").value);
    if (!Number.isFinite(target) || target <= 0) return toast("请输入有效目标价格");
    state.alerts.push({
      id: crypto.randomUUID(), symbol: $("#alert-symbol").value,
      direction: $("#alert-direction").value, currency: $("#alert-currency").value,
      target, enabled: true, triggered: false,
    });
    $("#alert-target").value = "";
    saveAlerts();
    toast("价格提醒已添加");
  }

  function checkPriceAlerts() {
    let changed = false;
    state.alerts.forEach((alert) => {
      const quote = state.quotes[alert.symbol];
      if (!quote || !alert.enabled) return;
      const value = alertMarketValue(alert.symbol, alert.currency || "CNY");
      const reached = alert.direction === "above" ? value >= alert.target : value <= alert.target;
      if (reached && !alert.triggered) {
        alert.triggered = true; changed = true;
        const message = `${ASSET_META[alert.symbol]?.name || alert.symbol} 已${alert.direction === "above" ? "高于" : "低于"} ${(alert.currency || "CNY") === "USD" ? "$" : "¥"}${formatNumber(alert.target, ASSET_META[alert.symbol]?.decimals ?? 2)}`;
        toast(message);
        if (typeof Notification !== "undefined" && Notification.permission === "granted") {
          new Notification("林猫行情价格提醒", { body: message, icon: "/markets/assets/lynncat-markets-icon.png" });
        }
      } else if (!reached && alert.triggered) {
        alert.triggered = false; changed = true;
      }
    });
    if (changed) localStorage.setItem("lynncat-price-alerts", JSON.stringify(state.alerts));
  }

  async function toggleMarketDisplay() {
    document.body.classList.toggle("market-display");
    if (document.body.classList.contains("market-display")) {
      await document.documentElement.requestFullscreen?.().catch(() => {});
    } else if (document.fullscreenElement) {
      await document.exitFullscreen?.().catch(() => {});
    }
    requestAnimationFrame(renderAllCharts);
  }

  function errorMessage(error) {
    const messages = {
      invalid_login: "账号名或密码不正确",
      login_temporarily_locked: "登录尝试过多，请稍后再试",
      username_unavailable: "这个账号名已被使用",
      invalid_username: "账号名格式不正确",
      invalid_password: "密码至少 8 位，并包含字母和数字",
      authentication_failed: "登录服务暂时不可用，请稍后重试",
      authentication_configuration_unavailable: "登录服务暂时不可用，请稍后重试",
      account_storage_unavailable: "账号存储暂时不可用，请稍后重试",
      insufficient_points: "积分不足",
      daily_draw_limit: "今日抽卡次数已用完",
      cooldown: `当前房间仍在冷却，请稍后再发`,
      session_expired: "登录已过期，请重新登录",
      unauthorized: "请先登录林猫账号",
    };
    return messages[error?.code] || "操作未完成，请稍后重试";
  }

  function toast(message) {
    const element = document.createElement("div");
    element.className = "toast";
    element.textContent = message;
    $("#toast-region").append(element);
    setTimeout(() => element.remove(), 3600);
  }

  function bindEvents() {
    $$(".nav-tab").forEach((button) => button.addEventListener("click", () => showRoute(button.dataset.route)));
    $("#mobile-nav-toggle").addEventListener("click", () => {
      const open = $("#primary-navigation").classList.toggle("is-open");
      $("#mobile-nav-toggle").setAttribute("aria-expanded", String(open));
    });
    $$("[data-theme-value]").forEach((button) => button.addEventListener("click", () => setTheme(button.dataset.themeValue)));
    $$("[data-region]").forEach((button) => button.addEventListener("click", () => setRegion(button.dataset.region)));
    $("#refresh-all-button").addEventListener("click", () => refreshDashboard(true));
    $("#refresh-monitor-button").addEventListener("click", async () => {
      const icon = $("#refresh-monitor-button i");
      icon.classList.add("spin");
      try {
        await refreshCrossHistories(true);
        toast("跨市场历史行情已更新");
      } catch {
        toast("跨市场接口暂不可用，已保留最近数据");
      } finally {
        icon.classList.remove("spin");
      }
    });
    $("#alerts-button").addEventListener("click", openAlertsDialog);
    $("#display-button").addEventListener("click", toggleMarketDisplay);
    $$("[data-route-link]").forEach((button) => button.addEventListener("click", () => showRoute(button.dataset.routeLink)));
    $("#account-button").addEventListener("click", openAccountDialog);
    $("#leaderboard-button").addEventListener("click", loadLeaderboard);
    $("#auth-form").addEventListener("submit", submitAuth);
    $$("[data-auth-mode]").forEach((button) => button.addEventListener("click", () => setAuthMode(button.dataset.authMode)));
    $("#logout-button").addEventListener("click", logout);
    $("#profile-form").addEventListener("submit", saveProfile);
    $("#ledger-refresh-button").addEventListener("click", loadLedger);
    $("#delete-account-button").addEventListener("click", deleteAccount);
    $("#alert-form").addEventListener("submit", addPriceAlert);
    $("#alert-symbol").addEventListener("change", updateAlertCurrentPrice);
    $("#alert-currency").addEventListener("change", updateAlertCurrentPrice);
    $("#alerts-list").addEventListener("change", (event) => {
      if (!event.target.matches("[data-toggle-alert]")) return;
      const id = event.target.closest("[data-alert-id]").dataset.alertId;
      const alert = state.alerts.find((item) => item.id === id);
      if (alert) { alert.enabled = event.target.checked; alert.triggered = false; saveAlerts(); }
    });
    $("#alerts-list").addEventListener("click", (event) => {
      const button = event.target.closest("[data-delete-alert]");
      if (!button) return;
      const id = button.closest("[data-alert-id]").dataset.alertId;
      state.alerts = state.alerts.filter((item) => item.id !== id);
      saveAlerts();
    });
    $("#notification-permission-button").addEventListener("click", async () => {
      if (typeof Notification === "undefined") return toast("当前浏览器不支持系统通知");
      const permission = await Notification.requestPermission();
      toast(permission === "granted" ? "浏览器通知已启用" : "浏览器通知未获允许");
    });
    $$("[data-close-dialog]").forEach((button) => button.addEventListener("click", () => closeDialog(button.closest("dialog"))));
    $("#modal-backdrop").addEventListener("click", () => $$("dialog[open]").forEach(closeDialog));
    $$(".focus-card[data-detail], [data-detail]").forEach((button) => button.addEventListener("click", () => {
      renderDetail(button.dataset.detail);
      showRoute("detail");
    }));
    $("#monitor-list").addEventListener("click", (event) => {
      const row = event.target.closest("[data-monitor-detail]");
      if (!row) return;
      renderDetail(row.dataset.monitorDetail);
      showRoute("detail");
    });
    $("#detail-back-button").addEventListener("click", () => showRoute("overview"));
    $("#community-refresh-button").addEventListener("click", () => loadMessages(state.currentRoom));
    $("#community-blocked-button").addEventListener("click", openBlockedAuthors);
    $("#blocked-authors-list").addEventListener("click", (event) => {
      const button = event.target.closest("[data-unblock-author]");
      if (!button) return;
      state.blockedAuthors.delete(button.closest("[data-blocked-key]").dataset.blockedKey);
      localStorage.setItem("lynncat-blocked-authors", JSON.stringify([...state.blockedAuthors]));
      openBlockedAuthors();
      loadMessages(state.currentRoom, false);
    });
    $("#community-message-form").addEventListener("submit", submitMessage);
    $("#community-message-list").addEventListener("click", (event) => {
      const item = event.target.closest("[data-message-id]");
      if (!item) return;
      if (event.target.closest("[data-report-message]")) reportMessage(item.dataset.messageId);
      if (event.target.closest("[data-block-author]")) blockAuthor(item.dataset.authorKey);
    });
    $("#community-message-input").addEventListener("input", (event) => $("#message-counter").textContent = `${event.target.value.length} / 200`);
    $("#detail-content").addEventListener("click", (event) => {
      const eventFilter = event.target.closest("[data-event-filter]");
      if (eventFilter) {
        state.eventImpactFilter = eventFilter.dataset.eventFilter;
        renderEventsDetail($("#detail-content"));
        return;
      }
      const indexButton = event.target.closest("[data-stock-index]");
      if (indexButton) {
        state.stockIndexSymbol = indexButton.dataset.stockIndex;
        state.stockIndexYear = null;
        renderUSStocksDetail($("#detail-content"), state.detailCache.US_STOCKS);
        requestAnimationFrame(() => drawLineChart($("#detail-chart"), state.detailChartPoints || [], { fill: true, grid: true, padding: 10, lineWidth: 2 }));
        return;
      }
      const chinaIndex = event.target.closest("[data-china-index]");
      if (chinaIndex) {
        state.chinaIndexSymbol = chinaIndex.dataset.chinaIndex;
        renderChinaStocksDetail($("#detail-content"), state.detailCache.CN_STOCKS);
        return;
      }
      const chinaStock = event.target.closest("[data-china-stock]");
      if (chinaStock) {
        state.chinaStockSymbol = chinaStock.dataset.chinaStock;
        renderChinaStocksDetail($("#detail-content"), state.detailCache.CN_STOCKS);
        return;
      }
      const hongKongStock = event.target.closest("[data-hk-stock]");
      if (hongKongStock) {
        state.hongKongStockSymbol = hongKongStock.dataset.hkStock;
        renderHongKongStocksDetail($("#detail-content"), state.detailCache.HK_STOCKS);
        return;
      }
      const regionalStock = event.target.closest("[data-regional-stock]");
      if (regionalStock && state.regionalStockSymbols[state.currentDetail] !== undefined) {
        state.regionalStockSymbols[state.currentDetail] = regionalStock.dataset.regionalStock;
        renderRegionalStocksDetail($("#detail-content"), state.detailCache[state.currentDetail]);
      }
    });
    $("#detail-content").addEventListener("change", (event) => {
      if (event.target.id !== "stock-history-year") return;
      state.stockIndexYear = Number(event.target.value);
      renderUSStocksDetail($("#detail-content"), state.detailCache.US_STOCKS);
      requestAnimationFrame(() => drawLineChart($("#detail-chart"), state.detailChartPoints || [], { fill: true, grid: true, padding: 10, lineWidth: 2 }));
    });
    $$(".period-switcher [data-period]").forEach((button) => button.addEventListener("click", () => {
      const switcher = button.closest("[data-period-scope]");
      const scope = switcher?.dataset.periodScope || "trend";
      if (scope === "monitor") {
        state.monitorPeriod = button.dataset.period;
        $$("[data-period]", switcher).forEach((candidate) => candidate.classList.toggle("is-active", candidate.dataset.period === state.monitorPeriod));
        $$("[data-monitor-period-label]").forEach((label) => label.textContent = `${PERIOD_LABELS[state.monitorPeriod]}走势`);
        $$("[data-monitor-period-short]").forEach((label) => label.textContent = { "1d": "日", "1w": "周", "1m": "月", "1y": "年" }[state.monitorPeriod]);
        renderMonitor();
        return;
      }
      state.period = button.dataset.period;
      $$("[data-period]", switcher).forEach((candidate) => candidate.classList.toggle("is-active", candidate.dataset.period === state.period));
      $$("[data-period-label]").forEach((label) => label.textContent = `${PERIOD_LABELS[state.period]}走势`);
      renderTrend();
    }));
    $$("[data-trend]").forEach((button) => button.addEventListener("click", () => {
      state.trendAsset = button.dataset.trend;
      $$("[data-trend]").forEach((candidate) => candidate.classList.toggle("is-active", candidate.dataset.trend === state.trendAsset));
      renderTrend();
    }));
    $$("[data-category]").forEach((button) => button.addEventListener("click", () => {
      state.monitorCategory = button.dataset.category;
      $$("[data-category]").forEach((candidate) => candidate.classList.toggle("is-active", candidate.dataset.category === state.monitorCategory));
      renderMonitor();
    }));
    $$("[data-refresh-news]").forEach((button) => button.addEventListener("click", () => loadNews(button.dataset.refreshNews === "tech" ? "tech" : "current", true)));
    $("#poker-sync-button").addEventListener("click", refreshPokerStatus);
    $("#poker-deal").addEventListener("click", dealPokerHand);
    $("#poker-check").addEventListener("click", () => advancePokerStreet(false));
    $("#poker-raise").addEventListener("click", () => advancePokerStreet(true));
    $("#poker-fold").addEventListener("click", foldPokerHand);
    $("#raise-slider").addEventListener("input", (event) => $("#raise-value").textContent = `${formatNumber(event.target.value, 0)} PTS`);
    $("#raise-half-pot").addEventListener("click", () => setPokerRaisePreset(0.5));
    $("#raise-pot").addEventListener("click", () => setPokerRaisePreset(1));
    $("#raise-max").addEventListener("click", setPokerRaiseMaximum);
    $("#hand-ranks-button").addEventListener("click", () => openDialog($("#ranks-dialog")));
    $("#poker-sound-button").addEventListener("click", (event) => {
      state.poker.soundOn = !state.poker.soundOn;
      localStorage.setItem("lynncat-poker-sound", state.poker.soundOn ? "on" : "off");
      const icon = $("i", event.currentTarget);
      icon.className = state.poker.soundOn ? "bi bi-volume-up-fill" : "bi bi-volume-mute-fill";
      if (state.poker.soundOn) playPokerSound("chip");
    });
    $("#cards-sync-button").addEventListener("click", refreshCardsStatus);
    $("#draw-card-button").addEventListener("click", drawCard);
    $$("[data-card-filter]").forEach((button) => button.addEventListener("click", () => {
      state.cardFilter = button.dataset.cardFilter;
      $$("[data-card-filter]").forEach((candidate) => candidate.classList.toggle("is-active", candidate.dataset.cardFilter === state.cardFilter));
      renderCardGrid();
    }));
    $("#card-grid").addEventListener("click", (event) => {
      const card = event.target.closest("[data-card-id]");
      if (card && state.ownedCards.has(Number(card.dataset.cardId))) {
        renderFeaturedCard(Number(card.dataset.cardId));
        $(".draw-booth").scrollIntoView({ behavior: "smooth", block: "nearest" });
      }
    });
    window.addEventListener("resize", debounce(renderAllCharts, 120));
    document.addEventListener("visibilitychange", () => {
      updateOnlineCreditUI();
      if (document.hidden) return;
      heartbeat();
      refreshGoldDirect(true).catch(() => {});
      if (state.route === "overview") refreshFocusLiveQuotes().catch(() => {});
    });
    document.addEventListener("fullscreenchange", () => {
      if (!document.fullscreenElement) document.body.classList.remove("market-display");
      requestAnimationFrame(renderAllCharts);
    });
    document.addEventListener("keydown", (event) => {
      if (state.route !== "poker" || state.poker.phase !== "playing" || /INPUT|TEXTAREA|SELECT/.test(event.target.tagName)) return;
      const key = event.key.toLowerCase();
      if (key === "f" && !$("#poker-fold").disabled) foldPokerHand();
      if (key === "c" && !$("#poker-check").disabled) advancePokerStreet(false);
      if (key === "r" && !$("#poker-raise").disabled) advancePokerStreet(true);
    });
  }

  function debounce(callback, delay) {
    let timer;
    return (...argumentsList) => {
      clearTimeout(timer);
      timer = setTimeout(() => callback(...argumentsList), delay);
    };
  }

  async function init() {
    initializeFallbackHistories();
    document.documentElement.dataset.theme = state.theme;
    setTheme(state.theme);
    setRegion(state.region);
    bindEvents();
    renderDashboard();
    renderCards();
    renderPokerIdleCards();
    renderPokerStatus();
    $("i", $("#poker-sound-button")).className = state.poker.soundOn ? "bi bi-volume-up-fill" : "bi bi-volume-mute-fill";
    $("#copyright-year").textContent = String(new Date().getFullYear());
    const hashRoute = location.hash.slice(1);
    if (["overview", "tech", "news", "poker", "cards"].includes(hashRoute)) showRoute(hashRoute);
    startGoldRefresh();
    startFocusLiveRefresh();
    await Promise.allSettled([
      refreshDashboard(),
      refreshGoldDirect(true),
      state.token ? refreshAccount() : Promise.resolve(),
    ]);
    Promise.allSettled([
    ]);
    if (state.token) {
      startHeartbeat();
      await Promise.allSettled([refreshPokerStatus(), refreshCardsStatus()]);
    }
  }

  init();
})();
