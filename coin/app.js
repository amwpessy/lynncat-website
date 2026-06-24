// 灵猫币 · 在线挖矿（Supabase 后端）
(function () {
  'use strict';

  var SUPABASE_URL = 'https://ndwafsoitodanawxfdob.supabase.co';
  var SUPABASE_ANON_KEY = 'sb_publishable_7mxUvl503DLkuRw006Atug_mkspk6Eb';
  var sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  var $ = function (id) { return document.getElementById(id); };
  var authCard = $('authCard'), mineCard = $('mineCard'), xferCard = $('xferCard'), histCard = $('histCard');
  var authTitle = $('authTitle'), authBtn = $('authBtn'), authSwitch = $('authSwitch'), authMsg = $('authMsg');
  var fUser = $('fUser'), fEmail = $('fEmail'), fPass = $('fPass'), fNew = $('fNew');
  var uEl = $('username'), eEl = $('email'), pEl = $('password'), npEl = $('newpassword');
  var meName = $('meName'), balanceEl = $('balance'), onlineEl = $('online'), rateEl = $('rate');
  var lbBody = $('lbBody'), histBody = $('histBody');
  var xferTo = $('xferTo'), xferAmt = $('xferAmt'), xferBtn = $('xferBtn'), xferMsg = $('xferMsg');

  var mode = 'login';
  var me = null;
  var serverBalance = 0, displayBalance = 0, online = 1;
  var mineTimer = null, visualTimer = null, lbTimer = null;
  var isRecovery = /type=recovery/.test(location.hash || '');

  var fmt = function (n, d) { d = d == null ? 6 : d; return Number(n).toFixed(d); };
  function setMsg(el, text, kind) { el.textContent = text || ''; el.className = 'msg' + (kind ? ' ' + kind : ''); }
  function show(el, on) { el.classList.toggle('hide', !on); }
  function validUser(u) { return /^[a-zA-Z0-9_]{3,20}$/.test(u); }
  function validEmail(e) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e); }

  // ── 模式切换：login / register / forgot / reset ──
  function setMode(m) {
    mode = m;
    setMsg(authMsg, '');
    show(fUser, m === 'login' || m === 'register');
    show(fEmail, m === 'register' || m === 'forgot');
    show(fPass, m === 'login' || m === 'register');
    show(fNew, m === 'reset');
    pEl.setAttribute('autocomplete', m === 'register' ? 'new-password' : 'current-password');

    if (m === 'login') {
      authTitle.textContent = '登录';
      authBtn.textContent = '登录';
      authSwitch.innerHTML = '还没有账号？<a id="toReg">注册</a> · <a id="toForgot" class="link-muted">忘记密码？</a>';
      $('toReg').onclick = function () { setMode('register'); };
      $('toForgot').onclick = function () { setMode('forgot'); };
    } else if (m === 'register') {
      authTitle.textContent = '注册';
      authBtn.textContent = '注册并开挖';
      authSwitch.innerHTML = '已有账号？<a id="toLogin">去登录</a>';
      $('toLogin').onclick = function () { setMode('login'); };
    } else if (m === 'forgot') {
      authTitle.textContent = '找回密码';
      authBtn.textContent = '发送重置邮件';
      authSwitch.innerHTML = '<a id="toLogin">返回登录</a>';
      $('toLogin').onclick = function () { setMode('login'); };
    } else if (m === 'reset') {
      authTitle.textContent = '设置新密码';
      authBtn.textContent = '保存新密码';
      authSwitch.innerHTML = '';
    }
  }

  authBtn.onclick = function () { doAuth(); };
  [pEl, npEl, eEl].forEach(function (el) {
    el.addEventListener('keydown', function (e) { if (e.key === 'Enter') doAuth(); });
  });

  async function doAuth() {
    authBtn.disabled = true;
    try {
      if (mode === 'login') {
        var lu = uEl.value.trim(), p = pEl.value;
        if (!lu) throw new Error('请输入用户名');
        if (!p) throw new Error('请输入密码');
        setMsg(authMsg, '登录中…');
        // 用户名 → 登录邮箱
        var le = await sb.rpc('email_for_login', { p_username: lu });
        if (le.error || !le.data) throw new Error('用户名或密码错误');
        var lin = await sb.auth.signInWithPassword({ email: le.data, password: p });
        if (lin.error) {
          if (/Invalid login/i.test(lin.error.message)) throw new Error('用户名或密码错误');
          throw lin.error;
        }
        await onLoggedIn();

      } else if (mode === 'register') {
        var u = uEl.value.trim(), re = eEl.value.trim(), rp = pEl.value;
        if (!validUser(u)) throw new Error('用户名需为 3–20 位字母、数字或下划线');
        if (!validEmail(re)) throw new Error('请输入有效邮箱（用于找回密码）');
        if (!rp || rp.length < 6) throw new Error('密码至少 6 位');
        setMsg(authMsg, '注册中…');
        // 先检查用户名是否已被占用（大小写不敏感），避免产生孤立账号
        var taken = await sb.rpc('username_taken', { p_username: u });
        if (!taken.error && taken.data === true) throw new Error('用户名已被占用，请换一个');
        var reg = await sb.auth.signUp({ email: re, password: rp, options: { data: { username: u } } });
        if (reg.error) {
          var m1 = reg.error.message || '';
          if (/already registered|exists/i.test(m1)) throw new Error('该邮箱已注册，请直接登录');
          throw reg.error;
        }
        if (!reg.data.session) {
          var si = await sb.auth.signInWithPassword({ email: re, password: rp });
          if (si.error) throw new Error('注册成功，请前往登录');
        }
        var uid = (await sb.auth.getUser()).data.user.id;
        var ins = await sb.from('coin_profiles').insert({ id: uid, username: u });
        if (ins.error && !/duplicate|unique/i.test(ins.error.message)) {
          if (/unique/i.test(ins.error.message)) throw new Error('用户名已被占用');
          throw ins.error;
        }
        await onLoggedIn();

      } else if (mode === 'forgot') {
        var fe = eEl.value.trim();
        if (!validEmail(fe)) throw new Error('请输入有效邮箱');
        setMsg(authMsg, '发送中…');
        var redirect = location.origin + location.pathname;
        var rr = await sb.auth.resetPasswordForEmail(fe, { redirectTo: redirect });
        if (rr.error) throw rr.error;
        setMsg(authMsg, '若该邮箱已注册，重置链接已发送，请查收邮件（含垃圾箱）。', 'ok');

      } else if (mode === 'reset') {
        var np = npEl.value;
        if (!np || np.length < 6) throw new Error('新密码至少 6 位');
        setMsg(authMsg, '保存中…');
        var up = await sb.auth.updateUser({ password: np });
        if (up.error) throw up.error;
        // 清掉 URL 上的 recovery 片段
        history.replaceState(null, '', location.pathname);
        setMsg(authMsg, '密码已更新', 'ok');
        await onLoggedIn();
      }
    } catch (err) {
      setMsg(authMsg, err.message || '出错了，请重试', 'err');
    } finally {
      authBtn.disabled = false;
    }
  }

  // ── 登录成功 ──
  async function onLoggedIn() {
    var ures = await sb.auth.getUser();
    var user = ures.data.user;
    if (!user) return;
    var prof = await sb.from('coin_profiles').select('username,balance').eq('id', user.id).maybeSingle();
    if (prof.error) throw prof.error;
    if (!prof.data) {
      var uname = (user.user_metadata && user.user_metadata.username) || ('miner_' + user.id.slice(0, 6));
      await sb.from('coin_profiles').insert({ id: user.id, username: uname });
      prof = { data: { username: uname, balance: 0 } };
    }
    me = { id: user.id, username: prof.data.username };
    serverBalance = displayBalance = Number(prof.data.balance) || 0;

    meName.textContent = me.username;
    authCard.classList.add('hide');
    mineCard.classList.remove('hide');
    xferCard.classList.remove('hide');
    histCard.classList.remove('hide');
    renderBalance();
    startMining();
    loadTransfers();
    loadLeaderboard();
  }

  // ── 挖矿 ──
  function startMining() {
    stopMining();
    tickServer();
    mineTimer = setInterval(tickServer, 2000);
    visualTimer = setInterval(function () { displayBalance += 1 / online; renderBalance(); }, 1000);
  }
  function stopMining() {
    if (mineTimer) clearInterval(mineTimer);
    if (visualTimer) clearInterval(visualTimer);
    mineTimer = visualTimer = null;
  }
  async function tickServer() {
    var r = await sb.rpc('mine');
    if (r.error) return;
    serverBalance = Number(r.data.balance);
    online = Math.max(1, Number(r.data.online) || 1);
    displayBalance = serverBalance;
    onlineEl.textContent = online;
    rateEl.textContent = fmt(1 / online, 6);
    renderBalance();
  }
  function renderBalance() { balanceEl.textContent = fmt(displayBalance, 6); }

  // ── 转账 ──
  xferBtn.onclick = async function () {
    var to = xferTo.value.trim(), amt = parseFloat(xferAmt.value);
    if (!to) return setMsg(xferMsg, '请输入收款用户名', 'err');
    if (!(amt > 0)) return setMsg(xferMsg, '请输入大于 0 的数量', 'err');
    xferBtn.disabled = true; setMsg(xferMsg, '转账中…');
    var r = await sb.rpc('transfer_coin', { to_user: to, amount: amt });
    xferBtn.disabled = false;
    if (r.error) {
      var m = r.error.message || '';
      var map = { recipient_not_found: '收款用户不存在', cannot_self: '不能转给自己', insufficient: '余额不足', amount_invalid: '金额无效' };
      var key = Object.keys(map).find(function (k) { return m.indexOf(k) >= 0; });
      return setMsg(xferMsg, key ? map[key] : '转账失败：' + m, 'err');
    }
    setMsg(xferMsg, '已转 ' + fmt(amt, 6) + ' 灵猫币给 ' + to, 'ok');
    xferAmt.value = ''; xferTo.value = '';
    await tickServer();
    loadTransfers();
    loadLeaderboard();
  };

  // ── 转账记录 ──
  async function loadTransfers() {
    if (!me) return;
    var r = await sb.rpc('my_transfers');
    if (r.error || !r.data) return;
    if (!r.data.length) { histBody.innerHTML = '<tr><td colspan="4" style="color:var(--muted)">暂无记录</td></tr>'; return; }
    histBody.innerHTML = r.data.map(function (t) {
      var out = t.direction === 'out';
      var when = new Date(t.created_at);
      var ts = when.getFullYear() + '-' + pad(when.getMonth() + 1) + '-' + pad(when.getDate()) + ' ' + pad(when.getHours()) + ':' + pad(when.getMinutes());
      return '<tr>' +
        '<td style="color:var(--muted)">' + ts + '</td>' +
        '<td class="tdir ' + (out ? 'out' : 'in') + '">' + (out ? '转出' : '收到') + '</td>' +
        '<td>' + escapeHtml(t.counterparty) + '</td>' +
        '<td class="bal tamt ' + (out ? 'out' : 'in') + '">' + (out ? '-' : '+') + fmt(t.amount, 6) + '</td></tr>';
    }).join('');
  }
  function pad(n) { return String(n).padStart(2, '0'); }

  // ── 排行榜 ──
  async function loadLeaderboard() {
    var r = await sb.rpc('coin_leaderboard');
    if (r.error || !r.data) return;
    if (!r.data.length) { lbBody.innerHTML = '<tr><td colspan="3" style="color:var(--muted)">还没有矿工，快来当第一个！</td></tr>'; return; }
    lbBody.innerHTML = r.data.map(function (row, i) {
      var meRow = me && row.username === me.username;
      var dot = row.is_online ? '<span class="on">●</span> ' : '<span class="off">○</span> ';
      return '<tr class="' + (meRow ? 'me-row' : '') + '">' +
        '<td class="rank' + (i < 3 ? ' top' : '') + '">' + (i + 1) + '</td>' +
        '<td>' + dot + escapeHtml(row.username) + (meRow ? ' （我）' : '') + '</td>' +
        '<td class="bal">' + fmt(row.balance, 6) + '</td></tr>';
    }).join('');
  }
  function escapeHtml(s) { return String(s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }

  // ── 退出 ──
  $('logoutBtn').onclick = async function () {
    stopMining();
    await sb.auth.signOut();
    me = null;
    mineCard.classList.add('hide');
    xferCard.classList.add('hide');
    histCard.classList.add('hide');
    authCard.classList.remove('hide');
    uEl.value = ''; eEl.value = ''; pEl.value = ''; npEl.value = '';
    setMode('login');
  };

  window.addEventListener('beforeunload', stopMining);

  // ── 找回密码：收到 recovery 链接时进入「设置新密码」 ──
  sb.auth.onAuthStateChange(function (event) {
    if (event === 'PASSWORD_RECOVERY') {
      stopMining();
      mineCard.classList.add('hide');
      xferCard.classList.add('hide');
      histCard.classList.add('hide');
      authCard.classList.remove('hide');
      setMode('reset');
    }
  });

  // ── 启动 ──
  setMode('login');
  loadLeaderboard();
  lbTimer = setInterval(function () { if (me) loadLeaderboard(); }, 3000);
  sb.auth.getSession().then(function (res) {
    if (res.data.session && !isRecovery) onLoggedIn().catch(function (e) { setMsg(authMsg, e.message || '', 'err'); });
  });
})();
