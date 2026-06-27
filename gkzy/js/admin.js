// 灵猫高考 · 管理员后台
const API = '/gkzy/api/admin';
const $ = id => document.getElementById(id);
let token = localStorage.getItem('gkzy_admin_token') || '';

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function show(view) {
  $('loginView').hidden = view !== 'login';
  $('dashView').hidden = view !== 'dash';
  $('logout').style.display = view === 'dash' ? '' : 'none';
}

// ── 登录 ──
async function login() {
  const username = $('username').value.trim();
  const password = $('password').value;
  $('loginMsg').textContent = '登录中…';
  $('loginMsg').className = 'status';
  try {
    const r = await fetch(`${API}/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || '登录失败');
    token = d.token;
    localStorage.setItem('gkzy_admin_token', token);
    enterDash();
  } catch (e) {
    $('loginMsg').textContent = e.message;
    $('loginMsg').className = 'status err';
  }
}
$('loginBtn').addEventListener('click', login);
$('password').addEventListener('keydown', e => { if (e.key === 'Enter') login(); });

$('logout').addEventListener('click', e => {
  e.preventDefault();
  localStorage.removeItem('gkzy_admin_token');
  token = '';
  show('login');
});

function authHeaders() { return { 'authorization': 'Bearer ' + token, 'content-type': 'application/json' }; }

async function enterDash() {
  show('dash');
  await loadCodes();
}

// ── 加载授权码列表 ──
async function loadCodes() {
  try {
    const r = await fetch(`${API}/codes`, { headers: authHeaders() });
    if (r.status === 401) { localStorage.removeItem('gkzy_admin_token'); token = ''; show('login'); return; }
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || '加载失败');
    $('stTotal').textContent = d.total;
    $('stUses').textContent = d.totalUses;
    renderCodes(d.codes);
  } catch (e) {
    $('codesBody').innerHTML = `<tr><td colspan="5" class="empty">${esc(e.message)}</td></tr>`;
  }
}

function renderCodes(codes) {
  const body = $('codesBody');
  if (!codes.length) { body.innerHTML = '<tr><td colspan="5" class="empty">暂无授权码，点上方生成</td></tr>'; return; }
  body.innerHTML = codes.map(c => {
    const pct = c.max_uses ? Math.min(100, Math.round(c.used_count / c.max_uses * 100)) : 0;
    const exhausted = c.used_count >= c.max_uses;
    const revoked = !!c.revoked;
    return `<tr style="${revoked ? 'opacity:.55' : ''}">
      <td class="code">${esc(c.code)}${revoked ? ' <span class="tag" style="background:#fdecec;color:var(--chong)">已注销</span>' : ''}</td>
      <td><span class="bar"><i style="width:${pct}%"></i></span>
          <span style="color:${exhausted ? 'var(--chong)' : 'var(--muted)'}">${c.used_count} / ${c.max_uses}${exhausted ? '（已用完）' : ''}</span></td>
      <td style="color:var(--muted)">${esc(c.note || '')}</td>
      <td style="color:var(--muted)">${esc((c.created_at || '').replace('T', ' '))}</td>
      <td style="display:flex;gap:6px">
        <button class="copybtn" data-code="${esc(c.code)}">复制</button>
        <button class="copybtn revokebtn" data-code="${esc(c.code)}" data-revoked="${revoked ? '1' : '0'}"
          style="${revoked ? 'color:var(--bao);border-color:var(--bao)' : 'color:var(--chong);border-color:var(--chong)'}">
          ${revoked ? '恢复' : '注销'}
        </button>
      </td>
    </tr>`;
  }).join('');
  body.querySelectorAll('.copybtn:not(.revokebtn)').forEach(b =>
    b.addEventListener('click', () => copy(b.dataset.code, b)));
  body.querySelectorAll('.revokebtn').forEach(b =>
    b.addEventListener('click', () => toggleRevoke(b.dataset.code, b.dataset.revoked === '1', b)));
}

async function toggleRevoke(code, currentlyRevoked, btn) {
  const nextRevoked = !currentlyRevoked;
  if (nextRevoked && !confirm(`确定要注销授权码 ${code} 吗？注销后该码立即无法继续查询。`)) return;
  btn.disabled = true;
  try {
    const r = await fetch(`${API}/revoke`, {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({ code, revoked: nextRevoked }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || '操作失败');
    await loadCodes();
  } catch (e) {
    alert(e.message);
    btn.disabled = false;
  }
}

function copy(text, el) {
  navigator.clipboard?.writeText(text).then(() => {
    if (el) { const t = el.textContent; el.textContent = '已复制'; setTimeout(() => el.textContent = t, 1200); }
  });
}

// ── 生成授权码 ──
$('genForm').addEventListener('submit', async e => {
  e.preventDefault();
  const count = $('genCount').value, maxUses = $('genMax').value, note = $('genNote').value.trim();
  const btn = e.target.querySelector('.btn');
  btn.disabled = true; btn.textContent = '生成中…';
  try {
    const r = await fetch(`${API}/generate`, {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({ count, maxUses, note }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || '生成失败');
    showNew(d.codes, d.maxUses);
    await loadCodes();
  } catch (e2) {
    showNew([], 0, e2.message);
  } finally {
    btn.disabled = false; btn.textContent = '生成授权码';
  }
});

function showNew(codes, maxUses, err) {
  const box = $('newCodes');
  if (err) { box.innerHTML = `<div class="newcodes" style="background:#fdecec;border-color:#f5b5b5"><div class="t" style="color:var(--chong)">${esc(err)}</div></div>`; return; }
  box.innerHTML = `<div class="newcodes">
    <div class="t">✓ 已生成 ${codes.length} 个授权码（每码 ${maxUses} 次）—— 点击可复制</div>
    <div class="chips">${codes.map(c => `<span class="chip" data-code="${esc(c)}">${esc(c)}</span>`).join('')}</div>
  </div>`;
  box.querySelectorAll('.chip').forEach(ch =>
    ch.addEventListener('click', () => copy(ch.dataset.code, null)));
}

// ── 启动 ──
if (token) enterDash(); else show('login');
