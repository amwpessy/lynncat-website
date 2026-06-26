// 灵猫高考 · 志愿填报参考 — Worker API（数据存于 Cloudflare D1，绑定名 DB）
// 路由：/gkzy/api/meta | /gkzy/api/recommend | /gkzy/api/majors

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=3600' },
  });

export async function handleGkzy(request, env) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/gkzy\/api\//, '');
  const q = url.searchParams;
  if (!env.DB) return json({ error: 'D1 数据库未绑定(DB)，请先创建并导入数据' }, 503);

  try {
    if (path === 'meta') return await meta(env, q);
    if (path === 'recommend') return await recommend(env, q);
    if (path === 'majors') return await majors(env, q);
    return json({ error: 'unknown endpoint' }, 404);
  } catch (e) {
    return json({ error: String(e && e.message || e) }, 500);
  }
}

// 某省可用科类与最新数据年份
async function meta(env, q) {
  const prov = +q.get('prov');
  if (!prov) return json({ error: 'prov required' }, 400);
  const t = await env.DB.prepare(
    `SELECT DISTINCT local_type_name AS t FROM college_score
     WHERE local_province_id=? AND local_type_name IS NOT NULL
     ORDER BY local_type_name`).bind(prov).all();
  const y = await env.DB.prepare(
    `SELECT MAX(year) AS y FROM college_score WHERE local_province_id=?`).bind(prov).first();
  return json({ types: (t.results || []).map(r => r.t), latestYear: y && y.y });
}

// 冲稳保推荐
async function recommend(env, q) {
  const prov = +q.get('prov');
  const type = q.get('type') || '';
  const rank = q.get('rank') ? +q.get('rank') : null;
  const score = q.get('score') ? +q.get('score') : null;
  if (!prov || !type) return json({ error: 'prov & type required' }, 400);

  // 最新有数据的年份
  const yr = await env.DB.prepare(
    `SELECT MAX(year) AS y FROM college_score WHERE local_province_id=? AND local_type_name=?`)
    .bind(prov, type).first();
  const year = yr && yr.y;
  if (!year) return json({ chong: [], wen: [], bao: [], year: null, basis: rank ? 'rank' : 'score' });

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
      item.delta = rank - r.min_section; // 正=我位次更靠后(学校更易)
      if (ratio < 0.93) chong.push(item);
      else if (ratio <= 1.10) wen.push(item);
      else bao.push(item);
    } else {
      const diff = score - r.min_score; // 正=我分更高(学校更易)
      item.delta = diff;
      if (diff < 0) chong.push(item);
      else if (diff <= 8) wen.push(item);
      else bao.push(item);
    }
  }
  const cap = a => a.slice(0, 40);
  // 冲：最接近我的排最前；保：最接近我的排最前
  if (useRank) {
    chong.sort((a, b) => b.min_section - a.min_section);
    bao.sort((a, b) => a.min_section - b.min_section);
  }
  return json({ chong: cap(chong), wen: cap(wen), bao: cap(bao), year, basis });
}

// 某院校在该省的专业线（近年）
async function majors(env, q) {
  const prov = +q.get('prov');
  const type = q.get('type') || '';
  const sid = +q.get('school_id');
  if (!prov || !sid) return json({ error: 'prov & school_id required' }, 400);
  const r = await env.DB.prepare(
    `SELECT year, spname, sp_name, level2_name, local_batch_name,
            min_score, max_score, min_section
     FROM major_score
     WHERE local_province_id=? AND school_id=? ${type ? 'AND local_type_name=?' : ''}
     ORDER BY year DESC, min_section ASC
     LIMIT 200`)
    .bind(...(type ? [prov, sid, type] : [prov, sid])).all();
  return json({ majors: r.results || [] });
}
