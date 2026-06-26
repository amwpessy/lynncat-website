#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
高考录取分数线抓取器（掌上高考公开接口，2021–2025）

子命令：
  schools   抓取院校列表（约2991所）→ schools 表
  college   抓取院校投档/录取线（31省×5年，整省分页）→ college_score 表
  major     抓取专业录取线（2991校×5年，按校+年分页，一次返回所有省）→ major_score 表
  stats     打印各表行数与抓取进度

特性：纯标准库、断点续抓(crawl_state)、限速+抖动、失败指数退避重试、并发分区。

示例：
  python3 crawl.py schools
  python3 crawl.py college                 # 全部省×年
  python3 crawl.py college --provinces 41 44 --years 2024 2025
  python3 crawl.py major --concurrency 6 --delay 0.25
  python3 crawl.py stats
"""
import argparse
import json
import os
import random
import sqlite3
import sys
import threading
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed

HERE = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(HERE, "..", "data", "gkzy.db")
SCHEMA = os.path.join(HERE, "schema.sql")

API = "https://api.zjzw.cn/web/api/"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")
REFERER = "https://www.gaokao.cn/"
PAGE_SIZE = 20  # 接口硬上限

YEARS = [2025, 2024, 2023, 2022, 2021]
# 标准GB省级行政区划码（31个，不含港澳台）
PROVINCES = {
    11: "北京", 12: "天津", 13: "河北", 14: "山西", 15: "内蒙古",
    21: "辽宁", 22: "吉林", 23: "黑龙江", 31: "上海", 32: "江苏",
    33: "浙江", 34: "安徽", 35: "福建", 36: "江西", 37: "山东",
    41: "河南", 42: "湖北", 43: "湖南", 44: "广东", 45: "广西",
    46: "海南", 50: "重庆", 51: "四川", 52: "贵州", 53: "云南",
    54: "西藏", 61: "陕西", 62: "甘肃", 63: "青海", 64: "宁夏", 65: "新疆",
}

_tls = threading.local()

# 全局限速熔断：任一线程被 1069 限速时，设置全局冷却时间戳，
# 所有线程在下次请求前都等待，避免一起冲击已被临时封禁的 IP。
_cooldown_until = 0.0
_cooldown_lock = threading.Lock()


def _respect_cooldown():
    while True:
        with _cooldown_lock:
            wait = _cooldown_until - time.time()
        if wait <= 0:
            return
        time.sleep(min(wait, 5))


def _trip_cooldown(seconds):
    global _cooldown_until
    with _cooldown_lock:
        _cooldown_until = max(_cooldown_until, time.time() + seconds)


# ── 数据库 ─────────────────────────────────────────────
def connect():
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    conn = sqlite3.connect(DB_PATH, timeout=60)
    conn.execute("PRAGMA busy_timeout=60000")
    return conn


def init_db():
    conn = connect()
    with open(SCHEMA, encoding="utf-8") as f:
        conn.executescript(f.read())
    # 旧版过严的唯一索引会误删同校同省同年跨批次的专业记录，改用「先删后插」幂等
    conn.execute("DROP INDEX IF EXISTS idx_ms_uniq")
    conn.commit()
    conn.close()


# ── HTTP（带重试/退避/限速） ──────────────────────────────
def api_get(params, delay=0.3, max_retries=8):
    """请求接口，返回 data dict（含 item/numFound）；失败抛异常。
    对限速码 1069 采用更长的冷却（不轻易放弃，因为是临时风控）。"""
    qs = urllib.parse.urlencode(params)
    url = f"{API}?{qs}"
    last = None
    for attempt in range(max_retries):
        _respect_cooldown()  # 若全局处于熔断冷却，先一起等待
        # 限速 + 抖动
        time.sleep(delay + random.uniform(0, delay))
        rate_limited = False
        try:
            req = urllib.request.Request(url, headers={
                "User-Agent": UA,
                "Referer": REFERER,
                "Accept": "application/json, text/plain, */*",
            })
            with urllib.request.urlopen(req, timeout=30) as r:
                body = r.read().decode("utf-8", "replace")
            j = json.loads(body)
            code = str(j.get("code"))
            data = j.get("data")
            if code == "0000" and isinstance(data, dict):
                return data
            # data 为 list/空 = 翻过末页（正常终止信号）
            if code == "0000" and not isinstance(data, dict):
                return {"item": [], "numFound": 0}
            last = f"code={code} msg={j.get('message')}"
            rate_limited = (code == "1069")  # 访问太过频繁
        except Exception as e:  # 网络/JSON 异常
            last = repr(e)
        # 限速错误等久一点（线性增长 15s→上限90s），其余指数退避
        if rate_limited:
            back = min(90, 15 * (attempt + 1)) + random.uniform(0, 5)
            _trip_cooldown(back)  # 让所有线程一起冷却，避免群体冲击被封IP
        else:
            back = min(30, (2 ** attempt) * 0.5) + random.uniform(0, 1)
        time.sleep(back)
    raise RuntimeError(f"请求失败({max_retries}次): {last}\n  {url}")


def fetch_all_pages(base_params, delay, label=""):
    """对一个分区翻页抓全部记录。返回 (rows, numFound)。"""
    rows = []
    p = dict(base_params, size=PAGE_SIZE, page=1)
    first = api_get(p, delay=delay)
    num = int(first.get("numFound") or 0)
    rows.extend(first.get("item") or [])
    if num <= PAGE_SIZE:
        return rows, num
    pages = (num + PAGE_SIZE - 1) // PAGE_SIZE
    for page in range(2, pages + 1):
        d = api_get(dict(base_params, size=PAGE_SIZE, page=page), delay=delay)
        items = d.get("item") or []
        if not items:
            break
        rows.extend(items)
    return rows, num


# ── 断点续抓 ───────────────────────────────────────────
def is_done(conn, kind, part_key):
    cur = conn.execute(
        "SELECT 1 FROM crawl_state WHERE kind=? AND part_key=? AND status='done'",
        (kind, part_key))
    return cur.fetchone() is not None


def mark_done(conn, kind, part_key, rows):
    conn.execute(
        "INSERT OR REPLACE INTO crawl_state(kind,part_key,status,rows,updated_at) "
        "VALUES (?,?, 'done', ?, datetime('now'))", (kind, part_key, rows))


def to_int(v):
    try:
        if v in (None, "", "-"):
            return None
        return int(float(v))
    except (TypeError, ValueError):
        return None


# ── schools ───────────────────────────────────────────
def cmd_schools(args):
    conn = connect()
    if is_done(conn, "schools", "all") and not args.force:
        print("院校列表已抓取（--force 可重抓）")
        return
    print("抓取院校列表…")
    rows, num = fetch_all_pages(
        {"uri": "apidata/api/gk/school/lists", "keyword": ""}, args.delay)
    print(f"  numFound={num}, 实得 {len(rows)} 条")
    recs = []
    for s in rows:
        recs.append((
            to_int(s.get("school_id")), s.get("name"), s.get("province_name"),
            s.get("city_name"), s.get("level_name"), s.get("nature_name"),
            s.get("belong"), to_int(s.get("f985")), to_int(s.get("f211")),
            str(s.get("dual_class")), s.get("dual_class_name"),
            s.get("code_enroll"), json.dumps(s, ensure_ascii=False),
        ))
    conn.executemany(
        "INSERT OR REPLACE INTO schools(school_id,name,province_name,city_name,"
        "level_name,nature_name,belong,f985,f211,dual_class,dual_class_name,"
        "code_enroll,raw) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)", recs)
    mark_done(conn, "schools", "all", len(recs))
    conn.commit()
    conn.close()
    print(f"✅ 入库 {len(recs)} 所院校")


# ── college 院校线 ─────────────────────────────────────
# 注意：接口整省分页硬上限 page 200(4000条)，故与专业线统一按「校+年」分区，
# 一次返回该校所有省份记录（每校远低于4000，绝不触顶）。考生省份从
# local_province_name 解析（行内 province_id 是院校所在省，不可用）。
def _college_rows(items, year):
    out = []
    for it in items:
        pid = _prov_id_by_name(it.get("local_province_name"))
        if pid is None:
            continue  # 非31省统招(如港澳/特殊类)，跳过
        mn = to_int(it.get("min"))
        pro = to_int(it.get("proscore"))
        out.append((
            pid, it.get("local_province_name"), year,
            to_int(it.get("school_id")), it.get("name"),
            it.get("local_batch_name"), it.get("local_type_name"),
            str(it.get("special_group")), it.get("sg_name"), it.get("sg_info"),
            mn, to_int(it.get("min_section")), pro,
            (mn - pro) if (mn is not None and pro is not None) else to_int(it.get("diff")),
            json.dumps(it, ensure_ascii=False),
        ))
    return out


def _do_college_part(sid, year, delay):
    items, num = fetch_all_pages({
        "uri": "apidata/api/gk/score/province",
        "school_id": sid, "year": year,
    }, delay, label=f"school{sid}-{year}")
    return sid, year, items, num


def cmd_college(args):
    conn = connect()
    sids = _select_sids(conn, args)
    if not sids:
        print("无匹配院校（schools 表为空或 --level 没命中），先运行: python3 crawl.py schools")
        return
    years = args.years or YEARS
    tasks = [(s, y) for s in sids for y in years
             if not (is_done(conn, "college", f"{s}|{y}") and not args.force)]
    total = len(sids) * len(years)
    print(f"院校线：{total} 个分区(校×年)，待抓 {len(tasks)} 个，"
          f"并发{args.concurrency} 限速{args.delay}s")
    done = 0
    with ThreadPoolExecutor(max_workers=args.concurrency) as ex:
        futs = {ex.submit(_do_college_part, s, y, args.delay): (s, y) for s, y in tasks}
        for fut in as_completed(futs):
            s, y = futs[fut]
            try:
                sid, year, items, num = fut.result()
            except Exception as e:
                print(f"  ✗ school{s}-{y} 失败: {e}")
                continue
            recs = _college_rows(items, year)
            # 先删后插：重入幂等
            conn.execute("DELETE FROM college_score WHERE school_id=? AND year=?",
                         (sid, year))
            conn.executemany(
                "INSERT INTO college_score(local_province_id,local_province_name,"
                "year,school_id,school_name,local_batch_name,local_type_name,"
                "special_group,sg_name,sg_info,min_score,min_section,proscore,diff,raw)"
                " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", recs)
            mark_done(conn, "college", f"{sid}|{year}", len(recs))
            conn.commit()
            done += 1
            if done % 50 == 0 or done == len(tasks):
                print(f"  [{done}/{len(tasks)}] …最近 school{sid}-{year}: {len(recs)} 条")
    conn.close()
    print("✅ 院校线完成")


# ── major 专业线 ───────────────────────────────────────
def _major_rows(items, year):
    out = []
    for it in items:
        pid = _prov_id_by_name(it.get("local_province_name"))  # 考生省，非院校省
        if pid is None:
            continue
        out.append((
            to_int(it.get("special_id")), pid,
            it.get("local_province_name"), year,
            to_int(it.get("school_id")), it.get("name"),
            it.get("spname"), it.get("sp_name"),
            it.get("level2_name"), it.get("level3_name"),
            it.get("local_batch_name"), it.get("local_type_name"),
            str(it.get("special_group")),
            to_int(it.get("min")), to_int(it.get("max")), to_int(it.get("average")),
            to_int(it.get("min_section")), to_int(it.get("proscore")),
            it.get("info"), json.dumps(it, ensure_ascii=False),
        ))
    return out


_NAME2ID = {v: k for k, v in PROVINCES.items()}


def _prov_id_by_name(name):
    return _NAME2ID.get(name)


def _do_major_part(sid, year, delay):
    items, num = fetch_all_pages({
        "uri": "apidata/api/gk/score/special",
        "school_id": sid, "year": year,
    }, delay, label=f"school{sid}-{year}")
    return sid, year, items, num


def _select_sids(conn, args):
    """根据 --schools / --level 选择院校ID列表。"""
    if args.schools:
        return args.schools
    if getattr(args, "level", None):
        rows = conn.execute(
            "SELECT school_id FROM schools WHERE level_name LIKE ? ORDER BY school_id",
            (f"%{args.level}%",)).fetchall()
    else:
        rows = conn.execute("SELECT school_id FROM schools ORDER BY school_id").fetchall()
    return [r[0] for r in rows]


def cmd_major(args):
    conn = connect()
    sids = _select_sids(conn, args)
    if not sids:
        print("无匹配院校（schools 表为空或 --level 没命中），先运行: python3 crawl.py schools")
        return
    years = args.years or YEARS
    tasks = [(s, y) for s in sids for y in years
             if not (is_done(conn, "major", f"{s}|{y}") and not args.force)]
    total = len(sids) * len(years)
    print(f"专业线：{total} 个分区(校×年)，待抓 {len(tasks)} 个，"
          f"并发{args.concurrency} 限速{args.delay}s")
    done = 0
    with ThreadPoolExecutor(max_workers=args.concurrency) as ex:
        futs = {ex.submit(_do_major_part, s, y, args.delay): (s, y) for s, y in tasks}
        for fut in as_completed(futs):
            s, y = futs[fut]
            try:
                sid, year, items, num = fut.result()
            except Exception as e:
                print(f"  ✗ school{s}-{y} 失败: {e}")
                continue
            recs = _major_rows(items, year)
            conn.execute("DELETE FROM major_score WHERE school_id=? AND year=?",
                         (sid, year))
            if recs:
                conn.executemany(
                    "INSERT OR IGNORE INTO major_score(special_id,local_province_id,"
                    "local_province_name,year,school_id,school_name,spname,sp_name,"
                    "level2_name,level3_name,local_batch_name,local_type_name,"
                    "special_group,min_score,max_score,avg_score,min_section,proscore,"
                    "info,raw) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", recs)
            mark_done(conn, "major", f"{sid}|{year}", len(recs))
            conn.commit()
            done += 1
            if done % 25 == 0 or done == len(tasks):
                print(f"  [{done}/{len(tasks)}] …最近 school{sid}-{year}: {len(recs)} 条")
    conn.close()
    print("✅ 专业线完成")


# ── stats ─────────────────────────────────────────────
def cmd_stats(args):
    conn = connect()
    def n(q):
        return conn.execute(q).fetchone()[0]
    print("== 数据量 ==")
    print(f"  schools       : {n('SELECT COUNT(*) FROM schools')}")
    print(f"  college_score : {n('SELECT COUNT(*) FROM college_score')}")
    print(f"  major_score   : {n('SELECT COUNT(*) FROM major_score')}")
    print("== 抓取进度(分区已完成数) ==")
    for kind in ("schools", "college", "major"):
        c = n(f"SELECT COUNT(*) FROM crawl_state WHERE kind='{kind}' AND status='done'")
        print(f"  {kind:8s}: {c} 分区")
    sz = os.path.getsize(DB_PATH) / 1e6 if os.path.exists(DB_PATH) else 0
    print(f"== DB 大小: {sz:.1f} MB ==")
    conn.close()


def main():
    ap = argparse.ArgumentParser(description="高考分数线抓取器（掌上高考）")
    sub = ap.add_subparsers(dest="cmd", required=True)

    def common(p):
        p.add_argument("--delay", type=float, default=0.3, help="每请求基础限速秒(默认0.3)")
        p.add_argument("--concurrency", type=int, default=4, help="并发分区数(默认4)")
        p.add_argument("--force", action="store_true", help="忽略断点重抓")

    p = sub.add_parser("schools"); common(p)
    p = sub.add_parser("college"); common(p)
    p.add_argument("--schools", type=int, nargs="*", help="院校ID筛选")
    p.add_argument("--level", help="按院校层次筛选，如 专科/本科（匹配 schools.level_name 包含此字符串）")
    p.add_argument("--years", type=int, nargs="*", help="年份筛选")
    p = sub.add_parser("major"); common(p)
    p.add_argument("--schools", type=int, nargs="*", help="院校ID筛选")
    p.add_argument("--level", help="按院校层次筛选，如 专科/本科")
    p.add_argument("--years", type=int, nargs="*", help="年份筛选")
    sub.add_parser("stats")

    args = ap.parse_args()
    init_db()
    {"schools": cmd_schools, "college": cmd_college,
     "major": cmd_major, "stats": cmd_stats}[args.cmd](args)


if __name__ == "__main__":
    main()
