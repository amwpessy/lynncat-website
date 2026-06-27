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
  const empty = { chong: [], wen: [], bao: [] };
  if (!year) return j({ inProvince: empty, outProvince: empty, year: null, basis: rank ? 'rank' : 'score', usesLeft: auth.usesLeft, maxUses: auth.maxUses });

  const useRank = rank != null;
  const basis = useRank ? 'rank' : 'score';
  let rows;
  if (useRank) {
    // 按比例(0.45x~2.4x)算窗口；位次越靠头部(数字越小)按比例算出的绝对宽度会退化到几乎为0，
    // 而全国最难考的学校最低位次通常也有几十到上百名，导致查不到任何结果。
    // 加一个固定的最小绝对宽度兜底，确保头部/尾部极端位次也能匹配到学校。
    const MIN_SPAN = 3000;
    const lo = Math.max(0, Math.min(Math.floor(rank * 0.45), rank - MIN_SPAN));
    const hi = Math.max(Math.ceil(rank * 2.4), rank + MIN_SPAN);
    // 艺术类等科类官方不发布位次("一分一段")，min_section 全部为空。只按位次查会把这些
    // 科类整个排除掉。若用户也填了分数，对这类"无位次"记录额外按分数窗口兜底纳入。
    if (score != null) {
      rows = await env.DB.prepare(
        `SELECT cs.*, s.f985, s.f211, s.dual_class_name, s.province_name, s.city_name
         FROM college_score cs LEFT JOIN schools s ON s.school_id=cs.school_id
         WHERE cs.local_province_id=? AND cs.local_type_name=? AND cs.year=?
           AND (
             (cs.min_section IS NOT NULL AND cs.min_section BETWEEN ? AND ?)
             OR (cs.min_section IS NULL AND cs.min_score IS NOT NULL AND cs.min_score BETWEEN ? AND ?)
           )
         ORDER BY cs.min_section`)
        .bind(prov, type, year, lo, hi, score - 40, score + 25).all();
    } else {
      rows = await env.DB.prepare(
        `SELECT cs.*, s.f985, s.f211, s.dual_class_name, s.province_name, s.city_name
         FROM college_score cs LEFT JOIN schools s ON s.school_id=cs.school_id
         WHERE cs.local_province_id=? AND cs.local_type_name=? AND cs.year=?
           AND cs.min_section IS NOT NULL
           AND cs.min_section BETWEEN ? AND ?
         ORDER BY cs.min_section`)
        .bind(prov, type, year, lo, hi).all();
    }
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

  // 同校同批次下常有几十个"专业组"，选科要求和分数线只差1~2分，逐条展示会被同一所
  // 学校刷屏，看起来像重复。按(学校+批次)聚合成一张卡：用"最容易上的那个专业组"的
  // 分数/位次决定冲稳保(因为那是这个批次里把握最大的入口)，同时展示分数区间和专业组总数，
  // 点卡片仍可在弹层里看到该校全部专业组明细。
  const batches = new Map();
  for (const r of (rows.results || [])) {
    const bKey = r.school_id + '|' + (r.local_batch_name ?? '');
    let b = batches.get(bKey);
    if (!b) {
      b = {
        school_id: r.school_id, school_name: r.school_name, batch: r.local_batch_name,
        f985: r.f985, f211: r.f211, dual: r.dual_class_name,
        province: r.province_name, city: r.city_name, local_province_name: r.local_province_name,
        sgInfoSet: new Set(), groupCount: 0,
        easyScore: r.min_score, easySection: r.min_section,   // 该批次里最容易进的一条(用于分类)
        hardScore: r.min_score, hardSection: r.min_section,   // 该批次里最难进的一条(用于展示区间)
      };
      batches.set(bKey, b);
    }
    b.groupCount++;
    if (r.sg_info) b.sgInfoSet.add(r.sg_info);
    // 位次模式下，没有位次(如艺术类)的记录排不进比较，只在双方都没有位次时才退化成比分数
    let easier, harder;
    if (useRank) {
      if (r.min_section != null && b.easySection == null) easier = true;
      else if (r.min_section == null && b.easySection != null) easier = false;
      else if (r.min_section != null) easier = r.min_section > b.easySection;
      else easier = r.min_score < b.easyScore;
      if (r.min_section != null && b.hardSection == null) harder = true;
      else if (r.min_section == null && b.hardSection != null) harder = false;
      else if (r.min_section != null) harder = r.min_section < b.hardSection;
      else harder = r.min_score > b.hardScore;
    } else {
      easier = r.min_score < b.easyScore;
      harder = r.min_score > b.hardScore;
    }
    if (easier) { b.easyScore = r.min_score; b.easySection = r.min_section; }
    if (harder) { b.hardScore = r.min_score; b.hardSection = r.min_section; }
  }

  // 按学校所在省份是否=考生所在省份，拆成本省/外省两组，各自再分冲稳保
  const inG = { chong: [], wen: [], bao: [] };
  const outG = { chong: [], wen: [], bao: [] };
  for (const b of batches.values()) {
    const item = {
      school_id: b.school_id, school_name: b.school_name, batch: b.batch,
      sg_info: b.sgInfoSet.size === 1 ? [...b.sgInfoSet][0]
        : (b.sgInfoSet.size > 1 ? `${b.sgInfoSet.size}种选科要求` : null),
      min_score: b.easyScore, min_section: b.easySection,
      score_range: b.hardScore !== b.easyScore ? [b.hardScore, b.easyScore].sort((x, y) => x - y) : null,
      section_range: b.hardSection !== b.easySection ? [b.hardSection, b.easySection].sort((x, y) => x - y) : null,
      groupCount: b.groupCount,
      f985: b.f985, f211: b.f211, dual: b.dual, province: b.province, city: b.city,
    };
    const g = (item.province && item.province === b.local_province_name) ? inG : outG;
    // 位次模式下若该批次完全没有位次数据(如艺术类)，退化成按分数比较；前提是用户也填了分数
    if (useRank && item.min_section != null) {
      const ratio = item.min_section / rank;
      item.delta = rank - item.min_section;
      item.deltaBasis = 'rank';
      if (ratio < 0.93) g.chong.push(item);
      else if (ratio <= 1.10) g.wen.push(item);
      else g.bao.push(item);
    } else if (item.min_score != null && score != null) {
      const diff = score - item.min_score;
      item.delta = diff;
      item.deltaBasis = 'score';
      if (diff < 0) g.chong.push(item);
      else if (diff <= 8) g.wen.push(item);
      else g.bao.push(item);
    }
  }
  const cap = a => a.slice(0, 40);
  // 位次为空的(分数兜底)条目排序时退化用分数差比较，避免 null 参与数值运算
  const keyOf = it => it.min_section ?? (it.min_score != null ? -it.min_score : 0);
  const finalize = g => {
    if (useRank) {
      g.chong.sort((a, b) => keyOf(b) - keyOf(a));
      g.bao.sort((a, b) => keyOf(a) - keyOf(b));
    }
    return { chong: cap(g.chong), wen: cap(g.wen), bao: cap(g.bao) };
  };
  return j({
    inProvince: finalize(inG), outProvince: finalize(outG),
    year, basis, usesLeft: auth.usesLeft, maxUses: auth.maxUses,
  });
}

// ── 需授权码（不消耗）：某院校在该省的专业线 ──
async function majors(env, q) {
  const prov = +q.get('prov');
  const type = q.get('type') || '';
  const sid = +q.get('school_id');
  if (!prov || !sid) return j({ error: 'prov & school_id required' }, 400);
  if (!await codeExists(env, q.get('code'))) return j({ error: '请输入有效授权码' }, 403);

  // 该校近5年录取线趋势(按批次)：同一批次每年取最容易上的那条(分最低/位次最大)作代表，
  // 方便考生一眼看出这所学校历年录取线的变化趋势。
  const trendRows = await env.DB.prepare(
    `SELECT year, local_batch_name AS batch, MIN(min_score) AS min_score,
            MAX(min_section) AS min_section
     FROM college_score
     WHERE local_province_id=? AND school_id=? ${type ? 'AND local_type_name=?' : ''}
       AND min_score IS NOT NULL
     GROUP BY year, local_batch_name
     ORDER BY year DESC, min_section ASC
     LIMIT 50`)
    .bind(...(type ? [prov, sid, type] : [prov, sid])).all();

  const r = await env.DB.prepare(
    `SELECT year, spname, sp_name, level2_name, local_batch_name,
            min_score, max_score, min_section
     FROM major_score
     WHERE local_province_id=? AND school_id=? ${type ? 'AND local_type_name=?' : ''}
     ORDER BY year DESC, min_section ASC
     LIMIT 200`)
    .bind(...(type ? [prov, sid, type] : [prov, sid])).all();
  return j({ trend: trendRows.results || [], majors: r.results || [] });
}
