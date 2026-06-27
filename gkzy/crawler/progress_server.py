#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
本地抓取进度看板（纯stdlib，只读，不影响抓取本身）。

用法：
  python3 progress_server.py [--port 8799]
然后打开 http://localhost:8799/
"""
import argparse
import http.server
import json
import os
import re
import sqlite3
import time

HERE = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(HERE, "..", "data", "gkzy.db")
LOG_PATHS = [
    os.path.join(HERE, "..", "data", "run_all.log"),
    os.path.join(HERE, "..", "data", "run_college3y.log"),
]

SCHOOLS_TOTAL = 2991
YEARS = 5
RECENT_YEARS = (2023, 2024, 2025)


def active_log_path():
    """多个抓取脚本可能并存，取最近修改的那个日志文件。"""
    existing = [p for p in LOG_PATHS if os.path.exists(p)]
    if not existing:
        return None
    return max(existing, key=os.path.getmtime)


def db():
    conn = sqlite3.connect(DB_PATH, timeout=5)
    conn.execute("PRAGMA query_only=1")
    return conn


def one(conn, sql, params=()):
    row = conn.execute(sql, params).fetchone()
    return row[0] if row else 0


def recent_rate(conn, kind, window_sec=120):
    """最近 window_sec 秒内完成了多少分区，换算成 个/分钟。"""
    cutoff = time.strftime("%Y-%m-%d %H:%M:%S", time.gmtime(time.time() - window_sec))
    n = one(conn, "SELECT COUNT(*) FROM crawl_state WHERE kind=? AND updated_at>=?", (kind, cutoff))
    return round(n / (window_sec / 60), 1)


def current_stage():
    """从当前活跃的日志文件里找最近一条 [n/m] 阶段说明。"""
    log_path = active_log_path()
    if not log_path:
        return None
    try:
        with open(log_path, encoding="utf-8", errors="ignore") as f:
            lines = f.readlines()
    except OSError:
        return None
    for line in reversed(lines):
        m = re.match(r"\[(\d+)/(\d+)\]\s*(.+)", line.strip())
        if m:
            return {"step": int(m.group(1)), "total": int(m.group(2)), "label": m.group(3).strip(),
                    "script": os.path.basename(log_path)}
    return None


def last_error_recent(window=20):
    """检查日志最近N行是否有 1069 限速错误，用于提示当前是否在限速冷却。"""
    log_path = active_log_path()
    if not log_path:
        return False
    try:
        with open(log_path, encoding="utf-8", errors="ignore") as f:
            lines = f.readlines()[-window:]
    except OSError:
        return False
    return any("1069" in l for l in lines)


def table_schema(conn):
    rows = conn.execute(
        "SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    ).fetchall()
    out = []
    for name, sql in rows:
        cols = conn.execute(f"PRAGMA table_info({name})").fetchall()
        cnt = one(conn, f"SELECT COUNT(*) FROM {name}")
        out.append({
            "name": name,
            "rows": cnt,
            "columns": [{"name": c[1], "type": c[2]} for c in cols],
            "create_sql": sql,
        })
    return out


def build_progress():
    conn = db()
    try:
        schools = one(conn, "SELECT COUNT(*) FROM schools")
        key_schools_total = one(
            conn, "SELECT COUNT(*) FROM schools WHERE f985=1 OR f211=1 OR dual_class_name='双一流'")

        college_rows = one(conn, "SELECT COUNT(*) FROM college_score")
        college_done = one(conn, "SELECT COUNT(*) FROM crawl_state WHERE kind='college'")
        college_total = (schools or SCHOOLS_TOTAL) * YEARS

        years_sql = ",".join(str(y) for y in RECENT_YEARS)
        college_3y_done = one(conn, f"""
            SELECT COUNT(*) FROM crawl_state
            WHERE kind='college' AND CAST(substr(part_key,instr(part_key,'|')+1) AS INTEGER) IN ({years_sql})
        """)
        college_3y_total = (schools or SCHOOLS_TOTAL) * len(RECENT_YEARS)
        college_3y_rows = one(conn, f"SELECT COUNT(*) FROM college_score WHERE year IN ({years_sql})")

        major_rows = one(conn, "SELECT COUNT(*) FROM major_score")
        major_done = one(conn, "SELECT COUNT(*) FROM crawl_state WHERE kind='major'")
        major_total = (schools or SCHOOLS_TOTAL) * YEARS

        major_key_done = one(conn, f"""
            SELECT COUNT(*) FROM crawl_state cs
            WHERE cs.kind='major' AND CAST(substr(cs.part_key,1,instr(cs.part_key,'|')-1) AS INTEGER) IN
              (SELECT school_id FROM schools WHERE f985=1 OR f211=1 OR dual_class_name='双一流')
        """)
        major_key_total = (key_schools_total or 164) * YEARS

        college_rate = recent_rate(conn, "college")
        major_rate = recent_rate(conn, "major")

        db_size_mb = round(os.path.getsize(DB_PATH) / 1e6, 1) if os.path.exists(DB_PATH) else 0
        schema = table_schema(conn)
    finally:
        conn.close()

    return {
        "schools": schools,
        "schema": schema,
        "college_3y": {"rows": college_3y_rows, "done": college_3y_done, "total": college_3y_total,
                       "pct": round(college_3y_done / college_3y_total * 100, 1) if college_3y_total else 0},
        "college": {"rows": college_rows, "done": college_done, "total": college_total,
                    "pct": round(college_done / college_total * 100, 1) if college_total else 0,
                    "rate_per_min": college_rate},
        "major": {"rows": major_rows, "done": major_done, "total": major_total,
                  "pct": round(major_done / major_total * 100, 1) if major_total else 0,
                  "rate_per_min": major_rate},
        "major_key": {"done": major_key_done, "total": major_key_total,
                      "pct": round(major_key_done / major_key_total * 100, 1) if major_key_total else 0},
        "stage": current_stage(),
        "rate_limited_recently": last_error_recent(),
        "db_size_mb": db_size_mb,
        "ts": int(time.time()),
    }


PAGE = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>gkzy 抓取进度</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
:root{--bg:#f6f7f9;--surface:#fff;--border:#e4e7ec;--text:#1a2430;--muted:#697586;
  --accent:#f5a623;--accent2:#e07020;--ok:#1ea761;--warn:#d98a16;--bad:#e3506a;}
body{background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;
  padding:28px 20px 60px}
.wrap{max-width:760px;margin:0 auto}
h1{font-size:20px;margin-bottom:4px}
.sub{color:var(--muted);font-size:13px;margin-bottom:22px}
.stage{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:14px 18px;
  margin-bottom:18px;font-size:14px;display:flex;align-items:center;justify-content:space-between}
.stage b{color:var(--accent2)}
.badge{font-size:11.5px;padding:3px 10px;border-radius:100px;font-weight:600}
.badge.ok{background:#e8f7ef;color:var(--ok)}
.badge.warn{background:#fdf3e0;color:var(--warn)}
.card{background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:18px 20px;margin-bottom:16px}
.card h2{font-size:15px;margin-bottom:12px;display:flex;justify-content:space-between;align-items:baseline}
.card h2 .pct{font-size:22px;font-weight:800;color:var(--accent2)}
.bar{height:10px;border-radius:6px;background:#eef0f3;overflow:hidden;margin-bottom:10px}
.bar > i{display:block;height:100%;background:linear-gradient(90deg,var(--accent),var(--accent2));
  transition:width .4s}
.stats{display:flex;gap:18px;font-size:12.5px;color:var(--muted);flex-wrap:wrap}
.stats b{color:var(--text)}
.sub2{margin-top:12px;padding-top:12px;border-top:1px dashed var(--border)}
.foot{color:var(--muted);font-size:12px;text-align:center;margin-top:20px}
.schema-tbl{border:1px solid var(--border);border-radius:10px;padding:12px 14px;margin-bottom:10px}
.schema-tbl summary{cursor:pointer;font-weight:700;font-size:13.5px;display:flex;justify-content:space-between}
.schema-tbl summary .n{color:var(--muted);font-weight:500;font-size:12px}
.coltable{width:100%;border-collapse:collapse;font-size:12px;margin-top:10px}
.coltable th,.coltable td{text-align:left;padding:5px 8px;border-bottom:1px solid var(--border)}
.coltable th{color:var(--muted);font-weight:600}
.coltable td.ty{color:var(--muted);font-family:ui-monospace,Menlo,monospace}
</style>
</head>
<body>
<div class="wrap">
  <h1>🐱 灵猫高考 · 抓取进度</h1>
  <div class="sub">本地只读看板，每3秒自动刷新</div>

  <div class="stage" id="stageBox">加载中…</div>

  <div class="card">
    <h2>院校线 · 近3年(2023-2025) <span class="pct" id="college3yPct">—</span></h2>
    <div class="bar"><i id="college3yBar" style="width:0%"></i></div>
    <div class="stats">
      <span>已抓 <b id="college3yDone">—</b> / <span id="college3yTotal">—</span> 分区</span>
      <span>累计 <b id="college3yRows">—</b> 条数据</span>
    </div>
  </div>

  <div class="card">
    <h2>院校线 · 全部(2021-2025) <span class="pct" id="collegePct">—</span></h2>
    <div class="bar"><i id="collegeBar" style="width:0%"></i></div>
    <div class="stats">
      <span>已抓 <b id="collegeDone">—</b> / <span id="collegeTotal">—</span> 分区</span>
      <span>累计 <b id="collegeRows">—</b> 条数据</span>
      <span>速率 <b id="collegeRate">—</b> 分区/分钟</span>
    </div>
  </div>

  <div class="card">
    <h2>专业线 <span class="pct" id="majorPct">—</span></h2>
    <div class="bar"><i id="majorBar" style="width:0%"></i></div>
    <div class="stats">
      <span>已抓 <b id="majorDone">—</b> / <span id="majorTotal">—</span> 分区</span>
      <span>累计 <b id="majorRows">—</b> 条数据</span>
      <span>速率 <b id="majorRate">—</b> 分区/分钟</span>
    </div>
    <div class="sub2">
      <div class="stats"><span>🌟 重点院校(985/211/双一流) 专业线：<b id="majorKeyPct">—</b>（<span id="majorKeyDone">—</span> / <span id="majorKeyTotal">—</span> 分区）</span></div>
    </div>
  </div>

  <div class="card">
    <h2>数据表结构</h2>
    <div id="schemaBox">加载中…</div>
  </div>

  <div class="foot" id="footInfo">—</div>
</div>
<script>
async function tick(){
  try{
    const r = await fetch('/api/progress');
    const d = await r.json();
    const stage = d.stage ? `[${d.stage.step}/${d.stage.total}] ${d.stage.label} (${d.stage.script})` : '等待中…';
    document.getElementById('stageBox').innerHTML =
      `<span>当前阶段：<b>${stage}</b></span>` +
      (d.rate_limited_recently
        ? '<span class="badge warn">⏳ 限速冷却中</span>'
        : '<span class="badge ok">● 正常抓取</span>');

    document.getElementById('college3yPct').textContent = d.college_3y.pct + '%';
    document.getElementById('college3yBar').style.width = d.college_3y.pct + '%';
    document.getElementById('college3yDone').textContent = d.college_3y.done.toLocaleString();
    document.getElementById('college3yTotal').textContent = d.college_3y.total.toLocaleString();
    document.getElementById('college3yRows').textContent = d.college_3y.rows.toLocaleString();

    document.getElementById('collegePct').textContent = d.college.pct + '%';
    document.getElementById('collegeBar').style.width = d.college.pct + '%';
    document.getElementById('collegeDone').textContent = d.college.done.toLocaleString();
    document.getElementById('collegeTotal').textContent = d.college.total.toLocaleString();
    document.getElementById('collegeRows').textContent = d.college.rows.toLocaleString();
    document.getElementById('collegeRate').textContent = d.college.rate_per_min;

    document.getElementById('majorPct').textContent = d.major.pct + '%';
    document.getElementById('majorBar').style.width = d.major.pct + '%';
    document.getElementById('majorDone').textContent = d.major.done.toLocaleString();
    document.getElementById('majorTotal').textContent = d.major.total.toLocaleString();
    document.getElementById('majorRows').textContent = d.major.rows.toLocaleString();
    document.getElementById('majorRate').textContent = d.major.rate_per_min;

    document.getElementById('majorKeyPct').textContent = d.major_key.pct + '%';
    document.getElementById('majorKeyDone').textContent = d.major_key.done.toLocaleString();
    document.getElementById('majorKeyTotal').textContent = d.major_key.total.toLocaleString();

    document.getElementById('footInfo').textContent =
      `数据库 ${d.db_size_mb} MB · 院校总数 ${d.schools.toLocaleString()} · 更新于 ${new Date(d.ts*1000).toLocaleTimeString('zh-CN')}`;

    if (!window._schemaRendered && d.schema) {
      window._schemaRendered = true;
      document.getElementById('schemaBox').innerHTML = d.schema.map(t => `
        <details class="schema-tbl">
          <summary><span>${t.name}</span><span class="n">${t.rows.toLocaleString()} 行 / ${t.columns.length} 列</span></summary>
          <table class="coltable">
            <thead><tr><th>列名</th><th>类型</th></tr></thead>
            <tbody>${t.columns.map(c => `<tr><td>${c.name}</td><td class="ty">${c.type||'-'}</td></tr>`).join('')}</tbody>
          </table>
        </details>`).join('');
    }
  }catch(e){
    document.getElementById('stageBox').textContent = '读取失败：' + e.message;
  }
}
tick();
setInterval(tick, 3000);
</script>
</body>
</html>
"""


class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass  # 静默，避免刷屏

    def _send(self, code, body, ctype):
        data = body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == "/" or self.path == "/index.html":
            self._send(200, PAGE, "text/html; charset=utf-8")
        elif self.path == "/api/progress":
            try:
                self._send(200, json.dumps(build_progress(), ensure_ascii=False), "application/json")
            except Exception as e:
                self._send(500, json.dumps({"error": str(e)}), "application/json")
        else:
            self._send(404, "not found", "text/plain")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8799)
    args = ap.parse_args()
    server = http.server.ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    print(f"抓取进度看板: http://127.0.0.1:{args.port}/")
    server.serve_forever()


if __name__ == "__main__":
    main()
