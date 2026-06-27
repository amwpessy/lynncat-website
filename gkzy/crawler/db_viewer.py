#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
本地 SQLite 数据浏览器（纯stdlib，只读，不影响抓取本身）。

用法：
  python3 db_viewer.py [--port 8800]
然后打开 http://localhost:8800/

功能：
- 左侧表列表(行数)，点击浏览数据，分页
- 自带一个只读 SQL 查询框，自由查询(仅允许 SELECT/PRAGMA/EXPLAIN，不允许写操作)
"""
import argparse
import http.server
import json
import os
import re
import sqlite3
import urllib.parse

HERE = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(HERE, "..", "data", "gkzy.db")
PAGE_SIZE = 50

READONLY_RE = re.compile(r"^\s*(SELECT|PRAGMA|EXPLAIN|WITH)\b", re.IGNORECASE)


def db():
    conn = sqlite3.connect(DB_PATH, timeout=5)
    conn.execute("PRAGMA query_only=1")  # 连接层禁止写操作，双重保险
    return conn


def list_tables(conn):
    rows = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    ).fetchall()
    out = []
    for (name,) in rows:
        try:
            cnt = conn.execute(f"SELECT COUNT(*) FROM {name}").fetchone()[0]
        except sqlite3.Error:
            cnt = None
        out.append({"name": name, "rows": cnt})
    return out


def run_query(conn, sql, limit_if_select=True):
    sql_stripped = sql.strip().rstrip(";")
    if not READONLY_RE.match(sql_stripped):
        raise ValueError("仅允许 SELECT / PRAGMA / EXPLAIN / WITH 查询")
    cur = conn.execute(sql_stripped)
    cols = [d[0] for d in cur.description] if cur.description else []
    rows = cur.fetchmany(2000)  # 硬上限，避免一次查太多撑爆页面
    return cols, [list(r) for r in rows]


def table_page(conn, name, page):
    # 表名白名单校验，防止注入
    valid = {t["name"] for t in list_tables(conn)}
    if name not in valid:
        raise ValueError("未知表名")
    total = conn.execute(f"SELECT COUNT(*) FROM {name}").fetchone()[0]
    offset = page * PAGE_SIZE
    cur = conn.execute(f"SELECT * FROM {name} LIMIT ? OFFSET ?", (PAGE_SIZE, offset))
    cols = [d[0] for d in cur.description]
    rows = [list(r) for r in cur.fetchall()]
    return {"cols": cols, "rows": rows, "total": total, "page": page,
            "pages": max(1, (total + PAGE_SIZE - 1) // PAGE_SIZE)}


PAGE = """<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>gkzy 数据库浏览器</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
:root{--bg:#f6f7f9;--surface:#fff;--border:#e4e7ec;--text:#1a2430;--muted:#697586;
  --accent:#f5a623;--accent2:#e07020;}
body{background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;
  display:flex;height:100vh;overflow:hidden}
.sidebar{width:220px;flex:0 0 auto;background:var(--surface);border-right:1px solid var(--border);
  padding:16px;overflow-y:auto}
.sidebar h1{font-size:15px;margin-bottom:14px}
.tbl-item{padding:9px 10px;border-radius:8px;cursor:pointer;font-size:13.5px;margin-bottom:3px;
  display:flex;justify-content:space-between}
.tbl-item:hover{background:#f2f4f7}
.tbl-item.active{background:#fdf3e0;color:var(--accent2);font-weight:700}
.tbl-item .n{color:var(--muted);font-size:11.5px}
.main{flex:1;display:flex;flex-direction:column;overflow:hidden}
.toolbar{padding:14px 18px;border-bottom:1px solid var(--border);background:var(--surface)}
.sqlbox{width:100%;font-family:ui-monospace,Menlo,monospace;font-size:13px;padding:9px 11px;
  border:1px solid var(--border);border-radius:8px;resize:vertical;min-height:38px}
.row{display:flex;gap:8px;margin-top:8px;align-items:center}
.btn{background:linear-gradient(135deg,var(--accent),var(--accent2));color:#1a1a1a;border:none;
  font-weight:700;font-size:13px;padding:8px 16px;border-radius:8px;cursor:pointer}
.btn.ghost{background:none;border:1px solid var(--border);color:var(--text);font-weight:600}
.pageinfo{font-size:12.5px;color:var(--muted)}
.content{flex:1;overflow:auto;padding:0 18px 18px}
table{width:100%;border-collapse:collapse;font-size:12.5px;background:var(--surface)}
th,td{text-align:left;padding:7px 10px;border-bottom:1px solid var(--border);white-space:nowrap;
  max-width:280px;overflow:hidden;text-overflow:ellipsis}
th{position:sticky;top:0;background:var(--surface);color:var(--muted);font-weight:600;z-index:1}
tr:hover td{background:#fafbfc}
.err{color:#e3506a;padding:14px 18px;font-size:13px}
.empty{color:var(--muted);padding:30px;text-align:center}
</style>
</head>
<body>
<div class="sidebar">
  <h1>🐱 数据表</h1>
  <div id="tableList">加载中…</div>
</div>
<div class="main">
  <div class="toolbar">
    <textarea class="sqlbox" id="sql" placeholder="SELECT * FROM schools LIMIT 50"></textarea>
    <div class="row">
      <button class="btn" id="runBtn">运行查询</button>
      <button class="btn ghost" id="prevBtn">← 上一页</button>
      <span class="pageinfo" id="pageInfo"></span>
      <button class="btn ghost" id="nextBtn">下一页 →</button>
    </div>
  </div>
  <div class="content" id="content"><div class="empty">点左侧表名浏览数据，或在上方输入只读SQL查询</div></div>
</div>
<script>
const $ = id => document.getElementById(id);
let curTable = null, curPage = 0, curPages = 1, curSql = null;

async function loadTables(){
  const r = await fetch('/api/tables');
  const d = await r.json();
  $('tableList').innerHTML = d.tables.map(t =>
    `<div class="tbl-item" data-name="${t.name}"><span>${t.name}</span><span class="n">${(t.rows??'-').toLocaleString?.()??t.rows}</span></div>`
  ).join('');
  $('tableList').querySelectorAll('.tbl-item').forEach(el =>
    el.addEventListener('click', () => openTable(el.dataset.name)));
}

function renderTable(cols, rows){
  if (!rows.length) { $('content').innerHTML = '<div class="empty">没有数据</div>'; return; }
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  $('content').innerHTML = `<table><thead><tr>${cols.map(c=>`<th>${esc(c)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map(r=>`<tr>${r.map(v=>`<td title="${esc(v)}">${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}

async function openTable(name, page=0){
  curTable = name; curSql = null; curPage = page;
  document.querySelectorAll('.tbl-item').forEach(el => el.classList.toggle('active', el.dataset.name===name));
  $('sql').value = '';
  const r = await fetch(`/api/table?name=${encodeURIComponent(name)}&page=${page}`);
  const d = await r.json();
  if (d.error) { $('content').innerHTML = `<div class="err">${d.error}</div>`; return; }
  curPages = d.pages;
  $('pageInfo').textContent = `第 ${d.page+1}/${d.pages} 页 · 共 ${d.total.toLocaleString()} 行`;
  renderTable(d.cols, d.rows);
}

async function runSql(){
  const sql = $('sql').value.trim();
  if (!sql) return;
  curTable = null; curSql = sql;
  $('pageInfo').textContent = '';
  document.querySelectorAll('.tbl-item').forEach(el => el.classList.remove('active'));
  try {
    const r = await fetch('/api/query', {method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({sql})});
    const d = await r.json();
    if (d.error) { $('content').innerHTML = `<div class="err">${d.error}</div>`; return; }
    $('pageInfo').textContent = `${d.rows.length} 行（最多显示2000行）`;
    renderTable(d.cols, d.rows);
  } catch(e) {
    $('content').innerHTML = `<div class="err">${e.message}</div>`;
  }
}

$('runBtn').addEventListener('click', runSql);
$('sql').addEventListener('keydown', e => { if ((e.metaKey||e.ctrlKey) && e.key==='Enter') runSql(); });
$('prevBtn').addEventListener('click', () => { if (curTable && curPage>0) openTable(curTable, curPage-1); });
$('nextBtn').addEventListener('click', () => { if (curTable && curPage<curPages-1) openTable(curTable, curPage+1); });

loadTables();
</script>
</body>
</html>
"""


class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass

    def _send(self, code, body, ctype="application/json"):
        data = body.encode("utf-8") if isinstance(body, str) else body
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        parsed = urllib.parse.urlsplit(self.path)
        path = parsed.path
        q = urllib.parse.parse_qs(parsed.query)
        try:
            if path in ("/", "/index.html"):
                self._send(200, PAGE, "text/html; charset=utf-8")
            elif path == "/api/tables":
                conn = db()
                try:
                    self._send(200, json.dumps({"tables": list_tables(conn)}, ensure_ascii=False))
                finally:
                    conn.close()
            elif path == "/api/table":
                name = (q.get("name") or [""])[0]
                page = int((q.get("page") or ["0"])[0])
                conn = db()
                try:
                    self._send(200, json.dumps(table_page(conn, name, page), ensure_ascii=False, default=str))
                except Exception as e:
                    self._send(200, json.dumps({"error": str(e)}, ensure_ascii=False))
                finally:
                    conn.close()
            else:
                self._send(404, "not found", "text/plain")
        except Exception as e:
            self._send(500, json.dumps({"error": str(e)}))

    def do_POST(self):
        if self.path != "/api/query":
            self._send(404, "not found", "text/plain")
            return
        length = int(self.headers.get("content-length", 0))
        body = json.loads(self.rfile.read(length) or b"{}")
        sql = body.get("sql", "")
        conn = db()
        try:
            cols, rows = run_query(conn, sql)
            self._send(200, json.dumps({"cols": cols, "rows": rows}, ensure_ascii=False, default=str))
        except Exception as e:
            self._send(200, json.dumps({"error": str(e)}, ensure_ascii=False))
        finally:
            conn.close()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8800)
    args = ap.parse_args()
    server = http.server.ThreadingHTTPServer(("127.0.0.1", args.port), Handler)
    print(f"数据库浏览器: http://127.0.0.1:{args.port}/")
    server.serve_forever()


if __name__ == "__main__":
    main()
