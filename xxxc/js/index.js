// 稀赢新材 · 市场数据仪表盘（网页版，由小程序 pages/index 转换）
(function () {
  var INTERVAL = 10;       // 刷新间隔（秒）
  var OZ = 31.1035;        // 金衡盎司 → 克

  // ── 工具函数 ────────────────────────────────
  function fmt(n, d) {
    if (d === undefined) d = 2;
    if (n === null || n === undefined || isNaN(n)) return '—';
    var fixed = Number(n).toFixed(d);
    var parts = fixed.split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return d === 0 ? parts[0] : parts.join('.');
  }
  var sign = function (n) { return n >= 0 ? '+' : ''; };
  var arrow = function (n) { return Math.abs(n) < 0.001 ? '◆' : (n > 0 ? '▲' : '▼'); };
  var cls = function (n) { return Math.abs(n) < 0.001 ? 'flat' : (n > 0 ? 'up' : 'dn'); };

  // ── 请求封装（浏览器 fetch，错误静默）────────
  function req(url) {
    return fetch(url).then(function (r) {
      var ct = r.headers.get('content-type') || '';
      var p = ct.indexOf('json') >= 0 ? r.json() : r.text();
      return p.then(function (data) { return { ok: true, data: data, status: r.status }; });
    }).catch(function () { return { ok: false }; });
  }

  // ── DOM 辅助 ───────────────────────────────
  function $(id) { return document.getElementById(id); }
  function setT(id, txt) { var el = $(id); if (el) el.textContent = txt; }
  function setBadge(el, arr, pct, c) {
    if (!el) return;
    el.textContent = arr + ' ' + pct + '%';
    el.className = el.className.replace(/\b(up|dn|flat)\b/g, '').trim() + ' ' + c;
  }

  var state = {
    cny: 0, goldUsd: 0, btcUsd: 0,
    refreshCount: 0, timer: null, tick: INTERVAL, loading: true
  };

  // ── 汇率 ───────────────────────────────────
  function loadFX() {
    return req('https://open.er-api.com/v6/latest/USD').then(function (r) {
      if (!r.ok) return;
      try {
        var rate = parseFloat(r.data.rates.CNY);
        state.cny = rate;
        setT('fxRate', rate.toFixed(4));
        setT('fxRate2', rate.toFixed(4));
        setT('fxInverse', (1 / rate).toFixed(4));
        setT('fxR1000', fmt(1000 * rate, 0));
      } catch (e) {}
    });
  }

  // ── 国债 ───────────────────────────────────
  function loadDebt() {
    var url = 'https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v2/accounting/od/debt_to_penny' +
      '?sort=-record_date&page[number]=1&page[size]=1' +
      '&fields=record_date,tot_pub_debt_out_amt,debt_held_public_amt,intragov_hold_amt';
    return req(url).then(function (r) {
      if (!r.ok) return;
      try {
        var d = r.data.data[0];
        var tot = parseFloat(d.tot_pub_debt_out_amt);
        var pub = parseFloat(d.debt_held_public_amt);
        var gov = parseFloat(d.intragov_hold_amt);
        var s = fmt(tot).split('.');
        var pubPct = parseFloat((pub / tot * 100).toFixed(1));
        var govPct = parseFloat((gov / tot * 100).toFixed(1));
        setT('debtInt', s[0]);
        setT('debtDec', '.' + (s[1] || '00'));
        setT('debtTril', (tot / 1e12).toFixed(2));
        setT('debtDate', d.record_date);
        setT('debtPubFmt', fmt(pub, 0));
        setT('debtPubPct', pubPct + '%');
        setT('debtGovFmt', fmt(gov, 0));
        setT('debtGovPct', govPct + '%');
        $('debtPubBar').style.width = pubPct + '%';
        $('debtGovBar').style.width = govPct + '%';
      } catch (e) {}
    });
  }

  // ── 贵金属 ─────────────────────────────────
  function loadMetal(sym, key) {
    return req('https://api.gold-api.com/price/' + sym).then(function (r) {
      if (!r.ok) return;
      try {
        var price = parseFloat(r.data.price);
        var prev = parseFloat(r.data.prev_close_price || price);
        var chg = price - prev;
        var pct = prev ? chg / prev * 100 : 0;
        var cny = state.cny;
        var gramCny = cny > 0 ? price / OZ * cny : 0;
        var kgCny = gramCny * 1000;
        if (key === 'gold') state.goldUsd = price;
        var card = document.querySelector('[data-metal="' + key + '"]');
        if (!card) return;
        card.querySelector('.m-price').textContent = fmt(price);
        card.querySelector('.m-gram').textContent = cny > 0 ? fmt(gramCny, 1) : '—';
        card.querySelector('.m-kg').textContent = cny > 0 ? fmt(kgCny, 0) : '—';
        setBadge(card.querySelector('.m-badge'), arrow(chg), sign(pct) + Math.abs(pct).toFixed(2), cls(chg));
      } catch (e) {}
    });
  }

  // ── 大饼 ───────────────────────────────────
  function loadBTC() {
    return req('https://api.gold-api.com/price/BTC').then(function (r) {
      if (!r.ok) return;
      try {
        var price = parseFloat(r.data.price);
        var prev = parseFloat(r.data.prev_close_price || price);
        var chg = price - prev;
        var pct = prev ? chg / prev * 100 : 0;
        var cny = state.cny;
        state.btcUsd = price;
        setT('btcPrice', fmt(price, 0));
        setT('btcCny', cny > 0 ? fmt(price * cny, 0) : '—');
        setBadge($('btcBadge'), arrow(chg), sign(pct) + Math.abs(pct).toFixed(2), cls(chg));
        var chgEl = $('btcChg');
        chgEl.textContent = arrow(chg) + ' ' + sign(pct) + Math.abs(pct).toFixed(2) + '%';
        chgEl.className = 'sub-val ' + cls(chg);
      } catch (e) {}
    });
  }

  // ── 指数 ──
  // 经 Cloudflare Pages Function（/xxxc/sina）服务端代理新浪行情，
  // 补 Referer 头并加 CORS。本地静态预览无函数环境会失败，静默保持 —。
  function loadIndex(list, handler) {
    return req('sina?list=' + encodeURIComponent(list)).then(function (r) {
      if (!r.ok || typeof r.data !== 'string') return;
      try { handler(r.data); } catch (e) {}
    });
  }
  function loadUSIndex() {
    // 新浪美股字段：[0]名称 [1]现价 [2]涨跌幅% [3]时间 [4]涨跌额
    return loadIndex('gb_$inx,gb_$ixic', function (data) {
      data.split('\n').forEach(function (line) {
        if (line.indexOf('"') < 0) return;
        var m = line.match(/"([^"]*)"/);
        var parts = (m ? m[1] : '').split(',');
        if (parts.length < 4) return;
        var price = parseFloat(parts[1]), pct = parseFloat(parts[2]);
        if (line.indexOf('gb_$inx') >= 0) {
          setT('spPrice', fmt(price)); setBadge($('spBadge'), arrow(pct), sign(pct) + Math.abs(pct).toFixed(2), cls(pct));
        } else if (line.indexOf('gb_$ixic') >= 0) {
          setT('nasdaqPrice', fmt(price)); setBadge($('nasdaqBadge'), arrow(pct), sign(pct) + Math.abs(pct).toFixed(2), cls(pct));
        }
      });
    });
  }
  function loadCNIndex() {
    return loadIndex('sh000001,sz399001', function (data) {
      data.split('\n').forEach(function (line) {
        if (line.indexOf('"') < 0) return;
        var m = line.match(/"([^"]*)"/);
        var parts = (m ? m[1] : '').split(',');
        if (parts.length < 4) return;
        var price = parseFloat(parts[3]), prev = parseFloat(parts[2]);
        var chg = price - prev, pct = prev ? chg / prev * 100 : 0;
        if (line.indexOf('sh000001') >= 0) {
          setT('shPrice', fmt(price)); setBadge($('shBadge'), arrow(chg), sign(pct) + Math.abs(pct).toFixed(2), cls(chg));
        } else if (line.indexOf('sz399001') >= 0) {
          setT('szPrice', fmt(price)); setBadge($('szBadge'), arrow(chg), sign(pct) + Math.abs(pct).toFixed(2), cls(chg));
        }
      });
    });
  }

  // ── 黄金 vs 大饼比价 ───────────────────────
  function calcRatio() {
    var g = state.goldUsd, b = state.btcUsd;
    if (!g || !b) return;
    var kgUsd = g / OZ * 1000;
    var btcPerKg = kgUsd / b;
    var gramPerBtc = b / (g / OZ);
    var el = $('ratioGoldBtc');
    el.textContent = btcPerKg.toFixed(3);
    el.className = 'ratio-val ' + (btcPerKg >= 1 ? 'up' : 'dn');
    setT('ratioBtcGold', fmt(gramPerBtc, 1));
  }

  // ── 稀有金属报价（本地数据）─────────────────
  function renderRare() {
    var D = window.XYXC_DATA.index;
    setT('rareDate', D.rareUpdateDate);
    var html = D.rareMetals.map(function (m) {
      return '<div class="rare-item">' +
        '<div class="rare-top"><div class="rare-icon">' + m.icon + '</div>' +
        '<div class="rare-names"><div class="rare-name">' + m.name + '</div>' +
        '<div class="rare-symbol">' + m.symbol + ' · ' + m.nameEn + '</div></div></div>' +
        '<div class="rare-price">' + m.priceWan + '</div>' +
        '<div class="rare-use">' + m.use + '</div></div>';
    }).join('');
    $('rareGrid').innerHTML = html;
  }

  // ── 事件 & 风险（本地数据）──────────────────
  function renderEvents() {
    var D = window.XYXC_DATA.index;
    $('eventsList').innerHTML = D.events.map(function (e) {
      return '<div class="tbl-row">' +
        '<div class="tbl-date-col"><div class="tbl-date">' + e.date + '</div>' +
        '<div class="event-tag tag-impact-' + e.color + '">' + e.tag + '</div></div>' +
        '<div class="tbl-event-col"><div class="tbl-title">' + e.title + '</div>' +
        '<div class="tbl-imp impact-' + e.color + '">影响：' + e.impact + '</div></div>' +
        '<div class="tbl-impact-col"><div class="tbl-desc">' + e.impactDesc + '</div></div></div>' +
        '<div class="tbl-divider"></div>';
    }).join('');

    function levelCls(l) { return l === '高' ? 'high' : l === '中' ? 'mid' : 'low'; }
    function riskHtml(item) {
      return '<div class="risk-item"><div class="risk-header">' +
        '<div class="risk-title">' + item.icon + ' ' + item.title + '</div>' +
        '<div class="risk-level level-' + levelCls(item.level) + '">' + item.level + '</div></div>' +
        '<div class="risk-affects">' + item.affects.map(function (af) {
          return '<div class="affect-tag' + (item.type === 'support' ? ' support' : '') + '">' + af + '</div>';
        }).join('') + '</div>' +
        '<div class="risk-desc">' + item.desc + '</div></div>';
    }
    $('risksRisk').innerHTML = D.risks.filter(function (r) { return r.type === 'risk'; }).map(riskHtml).join('');
    $('risksSupport').innerHTML = D.risks.filter(function (r) { return r.type === 'support'; }).map(riskHtml).join('');
  }

  // ── 倒计时 ─────────────────────────────────
  function startTimer() {
    stopTimer();
    state.tick = INTERVAL;
    state.timer = setInterval(function () {
      state.tick--;
      $('progressFill').style.width = (state.tick / INTERVAL * 100) + '%';
      setT('progressTxt', state.tick + ' 秒后刷新');
      if (state.tick <= 0) { state.tick = INTERVAL; refresh(); }
    }, 1000);
  }
  function stopTimer() { if (state.timer) { clearInterval(state.timer); state.timer = null; } }

  // ── 主刷新 ─────────────────────────────────
  function setLoading(on) {
    state.loading = on;
    $('liveDot').className = 'live-dot' + (on ? ' loading' : '');
    setT('liveTxt', on ? '加载中' : 'LIVE');
  }

  function refresh() {
    setLoading(true);
    loadFX().then(function () {
      return Promise.all([
        loadDebt(),
        loadMetal('XAU', 'gold'),
        loadMetal('XAG', 'silver'),
        loadMetal('XPT', 'platinum'),
        loadMetal('XPD', 'palladium'),
        loadBTC(),
        loadUSIndex(),
        loadCNIndex()
      ]);
    }).then(function () {
      calcRatio();
      var now = new Date();
      var pad = function (n) { return String(n).padStart(2, '0'); };
      var ts = now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate()) + ' ' +
        pad(now.getHours()) + ':' + pad(now.getMinutes()) + ':' + pad(now.getSeconds());
      state.refreshCount++;
      $('statusbar').style.display = 'flex';
      setT('statusTime', '更新 ' + ts);
      setT('statusCnt', '第 ' + state.refreshCount + ' 次');
      setLoading(false);
      startTimer();
    });
  }

  // ── 启动 ───────────────────────────────────
  renderRare();
  renderEvents();
  refresh();
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) stopTimer(); else startTimer();
  });
})();
