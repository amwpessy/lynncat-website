// 灵猫币 · 在线挖矿（Supabase 后端）
(function () {
  'use strict';

  // ── 配置（与 feeding 同一个 Supabase 项目）──
  var SUPABASE_URL = 'https://ndwafsoitodanawxfdob.supabase.co';
  var SUPABASE_ANON_KEY = 'sb_publishable_7mxUvl503DLkuRw006Atug_mkspk6Eb';
  var EMAIL_DOMAIN = '@lynncat.com'; // 用「用户名→合成邮箱」实现纯用户名登录（该域名通过 Supabase 校验）

  var sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // ── DOM ──
  var $ = function (id) { return document.getElementById(id); };
  var authCard = $('authCard'), mineCard = $('mineCard'), xferCard = $('xferCard');
  var authTitle = $('authTitle'), authBtn = $('authBtn'), authSwitch = $('authSwitch'),
      authMsg = $('authMsg'), uEl = $('username'), pEl = $('password');
  var meName = $('meName'), balanceEl = $('balance'), onlineEl = $('online'), rateEl = $('rate');
  var lbBody = $('lbBody');
  var xferTo = $('xferTo'), xferAmt = $('xferAmt'), xferBtn = $('xferBtn'), xferMsg = $('xferMsg');

  // ── 状态 ──
  var mode = 'login';          // 'login' | 'register'
  var me = null;               // { id, username }
  var serverBalance = 0, displayBalance = 0, online = 1;
  var mineTimer = null, visualTimer = null, lbTimer = null;

  var fmt = function (n, d) { d = d == null ? 6 : d; return Number(n).toFixed(d); };
  function setMsg(el, text, kind) { el.textContent = text || ''; el.className = 'msg' + (kind ? ' ' + kind : ''); }
  function emailFor(u) { return u.toLowerCase() + EMAIL_DOMAIN; }
  function validUser(u) { return /^[a-zA-Z0-9_]{3,20}$/.test(u); }

  // ── 登录 / 注册 切换 ──
  function setMode(m) {
    mode = m;
    if (m === 'login') {
      authTitle.textContent = '登录';
      authBtn.textContent = '登录';
      authSwitch.innerHTML = '还没有账号？<a id="toReg">注册一个</a>';
      $('toReg').onclick = function () { setMode('register'); };
      pEl.setAttribute('autocomplete', 'current-password');
    } else {
      authTitle.textContent = '注册';
      authBtn.textContent = '注册并开挖';
      authSwitch.innerHTML = '已有账号？<a id="toLogin">去登录</a>';
      $('toLogin').onclick = function () { setMode('login'); };
      pEl.setAttribute('autocomplete', 'new-password');
    }
    setMsg(authMsg, '');
  }

  // ── 提交登录/注册 ──
  authBtn.onclick = function () { doAuth(); };
  pEl.addEventListener('keydown', function (e) { if (e.key === 'Enter') doAuth(); });

  async function doAuth() {
    var u = uEl.value.trim(), p = pEl.value;
    if (!validUser(u)) { return setMsg(authMsg, '用户名需为 3–20 位字母、数字或下划线', 'err'); }
    if (!p || p.length < 6) { return setMsg(authMsg, '密码至少 6 位', 'err'); }
    authBtn.disabled = true; setMsg(authMsg, '处理中…');

    try {
      if (mode === 'register') {
        var reg = await sb.auth.signUp({ email: emailFor(u), password: p, options: { data: { username: u } } });
        if (reg.error) {
          var em = reg.error.message || '';
          if (/already registered|exists/i.test(em)) throw new Error('该用户名已被注册，请直接登录');
          throw reg.error;
        }
        // 关闭邮箱确认后，signUp 会直接返回 session
        if (!reg.data.session) {
          var si = await sb.auth.signInWithPassword({ email: emailFor(u), password: p });
          if (si.error) throw new Error('注册成功，但需要在 Supabase 后台关闭「邮箱确认」后才能登录');
        }
        // 创建资料
        var uid = (await sb.auth.getUser()).data.user.id;
        var ins = await sb.from('coin_profiles').insert({ id: uid, username: u });
        if (ins.error && !/duplicate|unique/i.test(ins.error.message)) throw ins.error;
      } else {
        var lin = await sb.auth.signInWithPassword({ email: emailFor(u), password: p });
        if (lin.error) {
          if (/Invalid login/i.test(lin.error.message)) throw new Error('用户名或密码错误');
          throw lin.error;
        }
      }
      await onLoggedIn();
    } catch (err) {
      setMsg(authMsg, err.message || '出错了，请重试', 'err');
    } finally {
      authBtn.disabled = false;
    }
  }

  // ── 登录成功后 ──
  async function onLoggedIn() {
    var ures = await sb.auth.getUser();
    var user = ures.data.user;
    if (!user) return;
    // 取/建资料
    var prof = await sb.from('coin_profiles').select('username,balance').eq('id', user.id).maybeSingle();
    if (prof.error) throw prof.error;
    if (!prof.data) {
      var uname = (user.user_metadata && user.user_metadata.username) || user.email.split('@')[0];
      await sb.from('coin_profiles').insert({ id: user.id, username: uname });
      prof = { data: { username: uname, balance: 0 } };
    }
    me = { id: user.id, username: prof.data.username };
    serverBalance = displayBalance = Number(prof.data.balance) || 0;

    meName.textContent = me.username;
    authCard.classList.add('hide');
    mineCard.classList.remove('hide');
    xferCard.classList.remove('hide');
    renderBalance();
    startMining();
  }

  // ── 挖矿 ──
  function startMining() {
    stopMining();
    tickServer();                         // 立即领一次
    mineTimer = setInterval(tickServer, 2000);
    visualTimer = setInterval(function () {
      displayBalance += 1 / online;       // 两次服务器结算之间，平滑显示
      renderBalance();
    }, 1000);
  }
  function stopMining() {
    if (mineTimer) clearInterval(mineTimer);
    if (visualTimer) clearInterval(visualTimer);
    mineTimer = visualTimer = null;
  }
  async function tickServer() {
    var r = await sb.rpc('mine');
    if (r.error) return; // 静默，下次再试
    serverBalance = Number(r.data.balance);
    online = Math.max(1, Number(r.data.online) || 1);
    displayBalance = serverBalance;       // 以服务器为准
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
    xferAmt.value = '';
    await tickServer();   // 立即刷新自己的余额
    loadLeaderboard();
  };

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
    authCard.classList.remove('hide');
    uEl.value = ''; pEl.value = '';
    setMode('login');
  };

  // 离开页面时停止心跳
  window.addEventListener('beforeunload', stopMining);

  // ── 启动 ──
  setMode('login');
  loadLeaderboard();
  lbTimer = setInterval(loadLeaderboard, 3000);
  sb.auth.getSession().then(function (res) {
    if (res.data.session) onLoggedIn().catch(function (e) { setMsg(authMsg, e.message || '', 'err'); });
  });
})();
