// 灵猫高考 · 志愿填报参考 — Worker API（数据存于 Cloudflare D1，绑定名 DB）
// 公开：/gkzy/api/meta
// 需授权码：/gkzy/api/recommend（每次查询消耗1次）、/gkzy/api/majors（详情，不消耗）
// 管理员：/gkzy/api/admin/{login,codes,generate}（账号 admin，密码用 Worker secret ADMIN_PASSWORD）

const j = (obj, status = 200, cache = 'no-store') =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': cache },
  });

export async function handleGkzy(request, env) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/gkzy\/api\//, '');
  const q = url.searchParams;
  if (!env.DB) return j({ error: 'D1 数据库未绑定(DB)，请先创建并导入数据' }, 503);

  try {
    if (path === 'meta') return await meta(env, q);
    if (path === 'admin/login') return await adminLogin(request, env);
    if (path === 'admin/codes') return await adminCodes(request, env);
    if (path === 'admin/generate') return await adminGenerate(request, env);
    if (path === 'recommend') return await recommend(env, q);
    if (path === 'majors') return await majors(env, q);
    return j({ error: 'unknown endpoint' }, 404);
  } catch (e) {
    return j({ error: String(e && e.message || e) }, 500);
  }
}

// ── 授权码 ─────────────────────────────────────────────
// 校验并消耗 1 次（原子 UPDATE）。返回 {ok, status, error?, usesLeft?, maxUses?}
async function consumeCode(env, code) {
  code = (code || '').trim();
  if (!code) return { ok: false, status: 403, error: '请输入授权码' };
  const row = await env.DB.prepare(
    'SELECT max_uses, used_count FROM auth_codes WHERE code=?').bind(code).first();
  if (!row) return { ok: false, status: 403, error: '授权码无效' };
  const res = await env.DB.prepare(
    'UPDATE auth_codes SET used_count=used_count+1 WHERE code=? AND used_count<max_uses')
    .bind(code).run();
  const changed = res.meta && res.meta.changes;
  if (!changed) return { ok: false, status: 403, error: '授权码已用完', usesLeft: 0, maxUses: row.max_uses };
  return { ok: true, usesLeft: row.max_uses - row.used_count - 1, maxUses: row.max_uses };
}

// 仅校验存在（用于详情查看，不消耗次数）
async function codeExists(env, code) {
  code = (code || '').trim();
  if (!code) return false;
  const row = await env.DB.prepare('SELECT 1 FROM auth_codes WHERE code=?').bind(code).first();
  return !!row;
}

// ── 管理员鉴权 ─────────────────────────────────────────
function bearer(request, q) {
  const h = request.headers.get('authorization') || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  return (m && m[1]) || q.get('token') || '';
}

async function requireAdmin(request, env) {
  const url = new URL(request.url);
  const token = bearer(request, url.searchParams);
  if (!token) return false;
  const row = await env.DB.prepare(
    "SELECT 1 FROM admin_sessions WHERE token=? AND expires_at > datetime('now')")
    .bind(token).first();
  return !!row;
}

function randHex(n) {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return [...a].map(b => b.toString(16).padStart(2, '0')).join('');
}

function randCode() {
  const al = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // 去除易混 0/O/1/I/L
  const a = new Uint8Array(8);
  crypto.getRandomValues(a);
  let s = '';
  for (const b of a) s += al[b % al.length];
  return 'GK' + s;
}

async function adminLogin(request, env) {
  if (request.method !== 'POST') return j({ error: 'POST only' }, 405);
  const body = await request.json().catch(() => ({}));
  const user = (body.username || '').trim();
  const pass = body.password || '';
  const okUser = user === (env.ADMIN_USER || 'admin');
  const okPass = env.ADMIN_PASSWORD ? pass === env.ADMIN_PASSWORD : false;
  if (!okUser || !okPass) return j({ error: '账号或密码错误' }, 401);
  const token = randHex(24);
  await env.DB.prepare(
    "INSERT INTO admin_sessions(token, expires_at) VALUES (?, datetime('now','+7 days'))")
    .bind(token).run();
  return j({ token });
}

async function adminCodes(request, env) {
  if (!await requireAdmin(request, env)) return j({ error: '未登录或登录已过期' }, 401);
  const r = await env.DB.prepare(
    'SELECT code, max_uses, used_count, created_at, note FROM auth_codes ORDER BY created_at DESC, rowid DESC')
    .all();
  const codes = r.results || [];
  const total = codes.length;
  const totalUses = codes.reduce((s, c) => s + (c.used_count || 0), 0);
  return j({ codes, total, totalUses });
}

async function adminGenerate(request, env) {
  if (!await requireAdmin(request, env)) return j({ error: '未登录或登录已过期' }, 401);
  if (request.method !== 'POST') return j({ error: 'POST only' }, 405);
  const body = await request.json().catch(() => ({}));
  const count = Math.max(1, Math.min(200, parseInt(body.count, 10) || 1));
  const maxUses = Math.max(1, Math.min(1000, parseInt(body.maxUses, 10) || 10));
  const note = (body.note || '').slice(0, 60) || null;
  const created = [];
  for (let i = 0; i < count; i++) {
    const code = randCode();
    try {
      await env.DB.prepare(
        'INSERT INTO auth_codes(code, max_uses, note) VALUES (?,?,?)')
        .bind(code, maxUses, note).run();
      created.push(code);
    } catch (_) { i--; } // 主键冲突极少，重试
  }
  return j({ codes: created, maxUses });
}

// ── 公开：某省可用科类与最新数据年份 ──
async function meta(env, q) {
  const prov = +q.get('prov');
  if (!prov) return j({ error: 'prov required' }, 400);
  const t = await env.DB.prepare(
    `SELECT DISTINCT local_type_name AS t FROM college_score
     WHERE local_province_id=? AND local_type_name IS NOT NULL
     ORDER BY local_type_name`).bind(prov).all();
  const y = await env.DB.prepare(
    `SELECT MAX(year) AS y FROM college_score WHERE local_province_id=?`).bind(prov).first();
  return j({ types: (t.results || []).map(r => r.t), latestYear: y && y.y }, 200, 'public, max-age=3600');
}

// ── 需授权码：冲稳保推荐（消耗1次） ──
async function recommend(env, q) {
  const prov = +q.get('prov');
  const type = q.get('type') || '';
  const rank = q.get('rank') ? +q.get('rank') : null;
  const score = q.get('score') ? +q.get('score') : null;
  if (!prov || !type) return j({ error: 'prov & type required' }, 400);

  // 授权校验 + 计次
  const auth = await consumeCode(env, q.get('code'));
  if (!auth.ok) return j({ error: auth.error, usesLeft: auth.usesLeft, maxUses: auth.maxUses }, auth.status);

  // 最新有数据的年份
  const yr = await env.DB.prepare(
    `SELECT MAX(year) AS y FROM college_score WHERE local_province_id=? AND local_type_name=?`)
    .bind(prov, type).first();
  const year = yr && yr.y;
  if (!year) return j({ chong: [], wen: [], bao: [], year: null, basis: rank ? 'rank' : 'score', usesLeft: auth.usesLeft, maxUses: auth.maxUses });

  const useRank = rank != null;
  const basis = useRank ? 'rank' : 'score';
  let rows;
  if (useRank) {
    rows = await env.DB.prepare(
      `SELECT cs.*, s.f985, s.f211, s.dual_class_name, s.province_name, s.city_name
       FROM college_score cs LEFT JOIN schools s ON s.school_id=cs.school_id
       WHERE cs.local_province_id=? AND cs.local_type_name=? AND cs.year=?
         AND cs.min_section IS NOT NULL
         AND cs.min_section BETWEEN ? AND ?
       ORDER BY cs.min_section`)
      .bind(prov, type, year, Math.floor(rank * 0.45), Math.ceil(rank * 2.4)).all();
  } else {
    rows = await env.DB.prepare(
      `SELECT cs.*, s.f985, s.f211, s.dual_class_name, s.province_name, s.city_name
       FROM college_score cs LEFT JOIN schools s ON s.school_id=cs.school_id
       WHERE cs.local_province_id=? AND cs.local_type_name=? AND cs.year=?
         AND cs.min_score IS NOT NULL
         AND cs.min_score BETWEEN ? AND ?
       ORDER BY cs.min_score DESC`)
      .bind(prov, type, year, score - 40, score + 25).all();
  }

  const chong = [], wen = [], bao = [];
  const seen = new Set();
  for (const r of (rows.results || [])) {
    const key = r.school_id + '|' + (r.special_group ?? '') + '|' + (r.local_batch_name ?? '');
    if (seen.has(key)) continue;
    seen.add(key);
    const item = {
      school_id: r.school_id, school_name: r.school_name,
      batch: r.local_batch_name, sg_name: r.sg_name,
      min_score: r.min_score, min_section: r.min_section,
      f985: r.f985, f211: r.f211, dual: r.dual_class_name,
      province: r.province_name, city: r.city_name,
    };
    if (useRank) {
      const ratio = r.min_section / rank;
      item.delta = rank - r.min_section;
      if (ratio < 0.93) chong.push(item);
      else if (ratio <= 1.10) wen.push(item);
      else bao.push(item);
    } else {
      const diff = score - r.min_score;
      item.delta = diff;
      if (diff < 0) chong.push(item);
      else if (diff <= 8) wen.push(item);
      else bao.push(item);
    }
  }
  const cap = a => a.slice(0, 40);
  if (useRank) {
    chong.sort((a, b) => b.min_section - a.min_section);
    bao.sort((a, b) => a.min_section - b.min_section);
  }
  return j({ chong: cap(chong), wen: cap(wen), bao: cap(bao), year, basis, usesLeft: auth.usesLeft, maxUses: auth.maxUses });
}

// ── 需授权码（不消耗）：某院校在该省的专业线 ──
async function majors(env, q) {
  const prov = +q.get('prov');
  const type = q.get('type') || '';
  const sid = +q.get('school_id');
  if (!prov || !sid) return j({ error: 'prov & school_id required' }, 400);
  if (!await codeExists(env, q.get('code'))) return j({ error: '请输入有效授权码' }, 403);
  const r = await env.DB.prepare(
    `SELECT year, spname, sp_name, level2_name, local_batch_name,
            min_score, max_score, min_section
     FROM major_score
     WHERE local_province_id=? AND school_id=? ${type ? 'AND local_type_name=?' : ''}
     ORDER BY year DESC, min_section ASC
     LIMIT 200`)
    .bind(...(type ? [prov, sid, type] : [prov, sid])).all();
  return j({ majors: r.results || [] });
}
