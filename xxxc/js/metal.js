// 黄金/白银历史关口（网页版，由小程序 pages/gold、pages/silver 转换）
(function () {
  var cfg = window.METAL_CFG;
  var OZ = 31.1035;
  var D = window.XYXC_DATA[cfg.key];

  function $(id) { return document.getElementById(id); }
  function setT(id, t) { var e = $(id); if (e && t != null) e.textContent = t; }

  // 摘要
  setT('sPrice', D.summary.price);
  setT('sGram', D.summary.gramCny);
  setT('sDate', D.summary.date);
  setT('sAth', D.summary.ath);
  setT('sAthDate', D.summary.athDate);

  function rowsUsd(list) {
    return list.map(function (item) {
      return '<div class="tbl-row ' + (item.isUp ? 'row-up' : 'row-dn') + '">' +
        '<div class="ml-lv-col"><div class="ml-lv ' + (item.isUp ? 'up' : 'dn') + '">' + item.label + '</div>' +
        '<div class="ml-cny" data-lv="' + item.lv + '">' + item.gramCny + '</div></div>' +
        '<div class="ml-type-col"><div class="type-badge ' + (item.isUp ? 'badge-up' : 'badge-dn') + '">' + item.typeLabel + '</div></div>' +
        '<div class="ml-date-col"><div class="ml-date">' + item.date + '</div></div>' +
        '<div class="ml-note-col"><div class="ml-note">' + item.note + '</div></div></div>' +
        '<div class="tbl-divider"></div>';
    }).join('');
  }
  function rowsCny(list) {
    return list.map(function (item) {
      return '<div class="tbl-row ' + (item.isUp ? 'row-up' : 'row-dn') + '">' +
        '<div class="ml-lv-col"><div class="ml-lv ' + (item.isUp ? 'up' : 'dn') + '">' + item.label + '</div>' +
        '<div class="ml-cny" data-lv="' + item.lv + '">≈' + item.usdApprox + '</div></div>' +
        '<div class="ml-type-col"><div class="type-badge ' + (item.isUp ? 'badge-up' : 'badge-dn') + '">' + item.typeLabel + '</div></div>' +
        '<div class="ml-date-col"><div class="ml-date">' + item.date + '</div></div>' +
        '<div class="ml-note-col"><div class="ml-note">' + item.note + '</div></div></div>' +
        '<div class="tbl-divider"></div>';
    }).join('');
  }

  $('usdList').innerHTML = rowsUsd(D.usdMilestones);
  $('cnyList').innerHTML = rowsCny(D.cnyMilestones);

  // Tab 切换
  var tabs = document.querySelectorAll('.tab-item');
  tabs.forEach(function (t) {
    t.addEventListener('click', function () {
      var tab = t.getAttribute('data-tab');
      tabs.forEach(function (x) { x.classList.toggle('tab-active', x === t); });
      document.querySelectorAll('[data-panel]').forEach(function (p) {
        p.style.display = p.getAttribute('data-panel') === tab ? '' : 'none';
      });
    });
  });

  // 实时汇率刷新换算列（与小程序一致：成功则用实时汇率，否则保留 7.25 回退值）
  fetch('https://open.er-api.com/v6/latest/USD').then(function (r) { return r.json(); }).then(function (j) {
    var cny = parseFloat(j.rates.CNY);
    if (!cny) return;
    // 美元关口的 ¥/克
    $('usdList').querySelectorAll('.ml-cny').forEach(function (el) {
      var lv = parseFloat(el.getAttribute('data-lv'));
      el.textContent = '¥' + Math.round(lv / OZ * cny) + '/克';
    });
    // 人民币关口的 $ 近似（白银按 lv 反算；黄金为固定历史价，不变）
    if (cfg.cnyApproxFromLv) {
      $('cnyList').querySelectorAll('.ml-cny').forEach(function (el) {
        var lv = parseFloat(el.getAttribute('data-lv'));
        el.textContent = '≈$' + (lv * OZ / cny).toFixed(1);
      });
    }
  }).catch(function () {});
})();
