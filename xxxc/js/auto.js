// 汽车销量（网页版，由小程序 pages/autoUS、pages/autoCN 转换）
(function () {
  var cfg = window.AUTO_CFG;
  var D = window.XYXC_DATA[cfg.key];

  function brandRow(item) {
    return '<div class="tbl-row">' +
      '<div class="col-rank"><div class="rank-badge ' + (item.rank <= 3 ? 'rank-top' : '') + '">' + item.rank + '</div></div>' +
      '<div class="col-name"><div class="name-main">' + item.name + '</div>' +
      (item.note ? '<div class="name-note">' + item.note + '</div>' : '') + '</div>' +
      '<div class="col-sales"><div class="sales-num">' + item.salesFmt + '</div></div>' +
      '<div class="col-yoy"><div class="pct ' + item.yoyCls + '">' + item.yoyArrow + ' ' + item.yoyFmt + '</div></div>' +
      '<div class="col-mom"><div class="pct ' + item.momCls + '">' + item.momFmt + '</div></div></div>' +
      '<div class="row-divider"></div>';
  }
  function modelRow(item) {
    return '<div class="tbl-row">' +
      '<div class="col-rank"><div class="rank-badge ' + (item.rank <= 3 ? 'rank-top' : '') + '">' + item.rank + '</div></div>' +
      '<div class="col-model"><div class="name-main">' + item.name + '</div>' +
      '<div class="name-sub">' + item.brand + '</div>' +
      (item.note ? '<div class="name-note">' + item.note + '</div>' : '') + '</div>' +
      '<div class="col-sales"><div class="sales-num">' + item.salesFmt + '</div></div>' +
      '<div class="col-yoy"><div class="pct ' + item.yoyCls + '">' + item.yoyArrow + ' ' + item.yoyFmt + '</div></div>' +
      '<div class="col-mom"><div class="pct ' + item.momCls + '">' + item.momFmt + '</div></div></div>' +
      '<div class="row-divider"></div>';
  }

  document.getElementById('brandList').innerHTML = D.brands.map(brandRow).join('');
  document.getElementById('modelList').innerHTML = D.models.map(modelRow).join('');

  // Tab 切换
  var tabs = document.querySelectorAll('.tab-item');
  tabs.forEach(function (t) {
    t.addEventListener('click', function () {
      var tab = t.getAttribute('data-tab');
      tabs.forEach(function (x) { x.classList.toggle(cfg.tabActiveClass, x === t); });
      document.querySelectorAll('[data-panel]').forEach(function (p) {
        p.style.display = p.getAttribute('data-panel') === tab ? '' : 'none';
      });
    });
  });
})();
