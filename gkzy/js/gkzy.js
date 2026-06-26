// 灵猫高考 · 志愿填报参考 前端逻辑
const API = '/gkzy/api';
const PROVINCES = [
  [11,'北京'],[12,'天津'],[13,'河北'],[14,'山西'],[15,'内蒙古'],
  [21,'辽宁'],[22,'吉林'],[23,'黑龙江'],[31,'上海'],[32,'江苏'],
  [33,'浙江'],[34,'安徽'],[35,'福建'],[36,'江西'],[37,'山东'],
  [41,'河南'],[42,'湖北'],[43,'湖南'],[44,'广东'],[45,'广西'],
  [46,'海南'],[50,'重庆'],[51,'四川'],[52,'贵州'],[53,'云南'],
  [54,'西藏'],[61,'陕西'],[62,'甘肃'],[63,'青海'],[64,'宁夏'],[65,'新疆'],
];

const $ = id => document.getElementById(id);
const provSel = $('prov'), typeSel = $('type');

// 初始化省份下拉
PROVINCES.forEach(([id, name]) => {
  const o = document.createElement('option');
  o.value = id; o.textContent = name;
  provSel.appendChild(o);
});
provSel.value = 41; // 默认河南

// 选省后拉取该省可用科类
async function loadTypes() {
  typeSel.innerHTML = '<option value="">加载中…</option>';
  try {
    const r = await fetch(`${API}/meta?prov=${provSel.value}`);
    const d = await r.json();
    typeSel.innerHTML = '';
    const types = (d.types && d.types.length) ? d.types : ['理科', '文科'];
    types.forEach(t => {
      const o = document.createElement('option');
      o.value = t; o.textContent = t;
      typeSel.appendChild(o);
    });
    if (d.latestYear) $('hint').dataset.year = d.latestYear;
  } catch (e) {
    typeSel.innerHTML = '<option value="理科">理科</option><option value="文科">文科</option>';
  }
}
provSel.addEventListener('change', loadTypes);
loadTypes();

// 授权码：本地记忆
const codeInput = $('code');
codeInput.value = localStorage.getItem('gkzy_code') || '';
function saveCode() {
  localStorage.setItem('gkzy_code', codeInput.value.trim());
  setStatus(codeInput.value.trim() ? '授权码已保存 ✓' : '已清除授权码');
}
$('saveCode').addEventListener('click', saveCode);
function showUses(left, max) {
  $('usesInfo').innerHTML = (left == null) ? ''
    : `本授权码剩余 <b>${left}</b> / ${max} 次`;
}

// 提交查询
$('queryForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const prov = provSel.value, type = typeSel.value;
  const score = $('score').value.trim(), rank = $('rank').value.trim();
  const code = codeInput.value.trim();
  if (!code) { setStatus('请先输入授权码（向管理员获取）', true); codeInput.focus(); return; }
  localStorage.setItem('gkzy_code', code);
  if (!rank && !score) { setStatus('请至少填写分数或位次', true); return; }

  const btn = e.target.querySelector('.btn');
  btn.disabled = true;
  setStatus('正在匹配院校…');
  $('results').hidden = true;

  try {
    const qs = new URLSearchParams({ prov, type, code });
    if (rank) qs.set('rank', rank);
    if (score) qs.set('score', score);
    const r = await fetch(`${API}/recommend?${qs}`);
    const d = await r.json();
    if (r.status === 403) {           // 授权码无效 / 已用完
      showUses(d.usesLeft, d.maxUses);
      setStatus(d.error || '授权码无效或已用完', true);
      return;
    }
    if (!r.ok) throw new Error(d.error || ('HTTP ' + r.status));
    render(d);
    showUses(d.usesLeft, d.maxUses);
  } catch (err) {
    setStatus('查询失败：' + err.message + '（数据可能仍在导入，请稍后重试）', true);
  } finally {
    btn.disabled = false;
  }
});

function setStatus(msg, err) {
  const s = $('status');
  s.textContent = msg || '';
  s.className = 'status' + (err ? ' err' : '');
}

function render(d) {
  const groups = [['C', d.chong], ['W', d.wen], ['B', d.bao]];
  let total = 0;
  groups.forEach(([k, arr]) => {
    arr = arr || [];
    total += arr.length;
    $('cnt' + k).textContent = arr.length;
    const box = $('list' + k);
    box.innerHTML = arr.length ? '' : '<div class="empty">暂无匹配</div>';
    arr.forEach(it => box.appendChild(card(it)));
  });
  setStatus(total ? `共匹配 ${total} 个志愿方向（基于 ${d.year} 年录取数据 · ${d.basis === 'rank' ? '按位次' : '按分数'}匹配）` : '没有匹配到院校，试试调整分数或位次');
  $('results').hidden = false;
}

function card(it) {
  const el = document.createElement('div');
  el.className = 'card';
  const tags = [];
  // 掌上高考编码：1=是，2=否（不能用真值判断，否则 2 也会被当作“是”）
  if (Number(it.f985) === 1) tags.push('<span class="tag t985">985</span>');
  if (Number(it.f211) === 1) tags.push('<span class="tag t211">211</span>');
  if (it.sg_name && it.sg_name !== 'null') tags.push(`<span class="tag tsg">${esc(it.sg_name)}</span>`);
  const loc = [it.province, it.city].filter(Boolean).join('·');
  const delta = it.delta != null
    ? `<span class="delta ${it.delta >= 0 ? 'up' : 'dn'}">${it.delta >= 0 ? '+' : ''}${it.delta}位</span>` : '';
  el.innerHTML = `
    <div class="row1"><span class="name">${esc(it.school_name)}</span></div>
    <div class="tags">${tags.join('')}<span class="tag">${esc(it.batch || '')}</span></div>
    <div class="meta">
      <span>${esc(loc)}</span>
      <span><span class="sc">${it.min_score ?? '—'}</span>分 / 位次 ${it.min_section ?? '—'} ${delta}</span>
    </div>`;
  el.addEventListener('click', () => openMajors(it));
  return el;
}

// 院校专业线详情
async function openMajors(it) {
  $('modalTitle').textContent = `${it.school_name} · 专业录取线`;
  $('modalBody').innerHTML = '<div class="empty">加载中…</div>';
  $('modal').hidden = false;
  try {
    const qs = new URLSearchParams({ prov: provSel.value, type: typeSel.value, school_id: it.school_id, code: codeInput.value.trim() });
    const r = await fetch(`${API}/majors?${qs}`);
    const d = await r.json();
    const rows = d.majors || [];
    if (!rows.length) { $('modalBody').innerHTML = '<div class="empty">暂无专业线数据（专业线抓取/导入中）</div>'; return; }
    $('modalBody').innerHTML = `<table class="mtable">
      <thead><tr><th>专业</th><th>年份</th><th>最低分</th><th>位次</th></tr></thead>
      <tbody>${rows.map(m => `<tr>
        <td class="n">${esc(m.sp_name || m.spname || '')}</td>
        <td>${m.year}</td><td>${m.min_score ?? '—'}</td><td>${m.min_section ?? '—'}</td>
      </tr>`).join('')}</tbody></table>`;
  } catch (e) {
    $('modalBody').innerHTML = '<div class="empty">加载失败</div>';
  }
}
$('modalClose').addEventListener('click', () => $('modal').hidden = true);
$('modal').addEventListener('click', e => { if (e.target.id === 'modal') $('modal').hidden = true; });

function esc(s) { return String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
