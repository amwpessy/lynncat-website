// 美国国债历史详情（网页版，由小程序 pages/debt 转换）
(function () {
  var BASE = 'https://api.fiscaldata.treasury.gov/services/api/fiscal_service';

  function fmt(n, d) {
    if (d === undefined) d = 2;
    if (!n && n !== 0) return '—';
    var fixed = Number(n).toFixed(d);
    var parts = fixed.split('.');
    parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return d === 0 ? parts[0] : parts.join('.');
  }
  function req(url) {
    return fetch(url).then(function (r) { return r.json(); })
      .then(function (data) { return { ok: true, data: data }; })
      .catch(function () { return { ok: false }; });
  }
  function $(id) { return document.getElementById(id); }
  function setT(id, t) { var e = $(id); if (e) e.textContent = t; }

  // 里程碑（静态，来自 data.js）
  function renderMilestones() {
    var mils = window.XYXC_DATA.debt.milestones;
    $('milList').innerHTML = mils.map(function (item) {
      return '<div class="tbl-row mil-row">' +
        '<div class="mil-tril-col"><div class="mil-badge ' + (item.fast ? 'mil-fast' : '') + '">' + item.label + '</div></div>' +
        '<div class="mil-date-col"><div class="mil-date">' + item.date + '</div></div>' +
        '<div class="mil-days-col"><div class="mil-days ' + (item.fast ? 'days-fast' : 'days-slow') + '">' + item.days + '</div></div>' +
        '<div class="mil-note-col"><div class="mil-note-txt">' + item.note + '</div></div></div>' +
        '<div class="tbl-divider"></div>';
    }).join('');
  }

  // 近90天每日（实时获取）
  function loadDaily() {
    var url = BASE + '/v2/accounting/od/debt_to_penny' +
      '?sort=-record_date&page[number]=1&page[size]=90' +
      '&fields=record_date,tot_pub_debt_out_amt';
    return req(url).then(function (r) {
      if (!r.ok) { $('dailyList').innerHTML = '<div style="padding:14px 6px;font-size:11px;color:#94a3b8">数据获取失败</div>'; return; }
      try {
        var rows = r.data.data;
        if (!rows || rows.length < 2) return;
        var sorted = rows.slice().reverse();
        var list = [], maxInc = 0, maxDate = '', totalInc = 0, incCount = 0;
        for (var i = 1; i < sorted.length; i++) {
          var cur = parseFloat(sorted[i].tot_pub_debt_out_amt);
          var prev = parseFloat(sorted[i - 1].tot_pub_debt_out_amt);
          var chg = cur - prev;
          var pct = prev > 0 ? chg / prev * 100 : 0;
          if (chg > 0) { totalInc += chg; incCount++; if (chg > maxInc) { maxInc = chg; maxDate = sorted[i].record_date; } }
          list.push({
            date: sorted[i].record_date,
            total: fmt(cur / 1e12, 4) + ' 万亿',
            change: (chg >= 0 ? '+' : '') + fmt(chg / 1e8, 2) + ' 亿',
            changePct: (pct >= 0 ? '+' : '') + pct.toFixed(4) + '%',
            isUp: chg > 0, isDown: chg < 0
          });
        }
        list.reverse();
        var latest = parseFloat(sorted[sorted.length - 1].tot_pub_debt_out_amt);
        var latestDate = sorted[sorted.length - 1].record_date;
        var avg = incCount > 0 ? totalInc / incCount : 0;
        setT('sLatest', fmt(latest / 1e12, 4) + ' 万亿美元');
        setT('sLatestDate', latestDate);
        setT('sAvg', '+' + fmt(avg / 1e8, 0) + ' 亿/天');
        setT('sMax', '+' + fmt(maxInc / 1e8, 0) + ' 亿');
        setT('sMaxDate', maxDate);
        $('dailyList').innerHTML = list.map(function (item) {
          var c = item.isUp ? 'up' : item.isDown ? 'dn' : 'flat';
          return '<div class="tbl-row day-row">' +
            '<div class="day-date-col"><div class="day-date">' + item.date + '</div></div>' +
            '<div class="day-total-col"><div class="day-total">' + item.total + '</div></div>' +
            '<div class="day-chg-col"><div class="day-chg ' + c + '">' + item.change + '</div></div>' +
            '<div class="day-pct-col"><div class="day-pct ' + c + '">' + item.changePct + '</div></div></div>' +
            '<div class="tbl-divider"></div>';
        }).join('');
      } catch (e) {}
    });
  }

  renderMilestones();
  loadDaily().then(function () { $('loadingBar').style.display = 'none'; });
})();
