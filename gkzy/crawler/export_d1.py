#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
把本地 SQLite (data/gkzy.db) 导出为可被 Cloudflare D1 执行的 SQL。
丢弃体积巨大的 raw 列（仅留档用，服务层不需要），按多行 INSERT 批量化。

用法：
  python3 export_d1.py                 # 生成 d1_schema.sql + d1_import_*.sql
  python3 export_d1.py --batch 800     # 每条INSERT行数

导入（本地预览）：
  npx wrangler d1 execute gkzy --local --file gkzy/crawler/d1_schema.sql
  for f in gkzy/crawler/d1_import_*.sql; do npx wrangler d1 execute gkzy --local --file "$f"; done
导入（线上）：把 --local 换成 --remote
"""
import argparse
import os
import sqlite3

HERE = os.path.dirname(os.path.abspath(__file__))
DB = os.path.join(HERE, "..", "data", "gkzy.db")

SCHEMA = """PRAGMA foreign_keys=OFF;
DROP TABLE IF EXISTS schools;
CREATE TABLE schools(school_id INTEGER PRIMARY KEY, name TEXT, province_name TEXT,
 city_name TEXT, level_name TEXT, nature_name TEXT, belong TEXT,
 f985 INTEGER, f211 INTEGER, dual_class TEXT, dual_class_name TEXT, code_enroll TEXT);

DROP TABLE IF EXISTS college_score;
CREATE TABLE college_score(local_province_id INTEGER, local_province_name TEXT, year INTEGER,
 school_id INTEGER, school_name TEXT, local_batch_name TEXT, local_type_name TEXT,
 special_group TEXT, sg_name TEXT, sg_info TEXT, min_score INTEGER, min_section INTEGER,
 proscore INTEGER, diff INTEGER);
CREATE INDEX idx_cs_lookup ON college_score(local_province_id,year,local_type_name,min_section);
CREATE INDEX idx_cs_school ON college_score(school_id,local_province_id);

DROP TABLE IF EXISTS major_score;
CREATE TABLE major_score(special_id INTEGER, local_province_id INTEGER, local_province_name TEXT,
 year INTEGER, school_id INTEGER, school_name TEXT, spname TEXT, sp_name TEXT,
 level2_name TEXT, level3_name TEXT, local_batch_name TEXT, local_type_name TEXT,
 special_group TEXT, min_score INTEGER, max_score INTEGER, avg_score INTEGER,
 min_section INTEGER, proscore INTEGER, info TEXT);
CREATE INDEX idx_ms_lookup ON major_score(local_province_id,year,local_type_name,min_section);
CREATE INDEX idx_ms_school ON major_score(school_id,local_province_id,year);
"""

COLS = {
    "schools": ["school_id", "name", "province_name", "city_name", "level_name",
                "nature_name", "belong", "f985", "f211", "dual_class",
                "dual_class_name", "code_enroll"],
    "college_score": ["local_province_id", "local_province_name", "year", "school_id",
                      "school_name", "local_batch_name", "local_type_name",
                      "special_group", "sg_name", "sg_info", "min_score",
                      "min_section", "proscore", "diff"],
    "major_score": ["special_id", "local_province_id", "local_province_name", "year",
                    "school_id", "school_name", "spname", "sp_name", "level2_name",
                    "level3_name", "local_batch_name", "local_type_name",
                    "special_group", "min_score", "max_score", "avg_score",
                    "min_section", "proscore", "info"],
}


def lit(v):
    if v is None:
        return "NULL"
    if isinstance(v, (int, float)):
        return str(v)
    return "'" + str(v).replace("'", "''") + "'"


def dump_table(conn, table, cols, batch, out_prefix):
    cur = conn.execute(f"SELECT {','.join(cols)} FROM {table}")
    collist = "(" + ",".join(cols) + ")"
    idx, n, fh, fname = 0, 0, None, None
    files = []
    buf, bn = [], 0

    def open_new():
        nonlocal idx, fh, fname
        idx += 1
        fname = f"{out_prefix}_{table}_{idx:03d}.sql"
        fh = open(fname, "w", encoding="utf-8")
        files.append(fname)

    MAX_BYTES = 60000      # 单条INSERT字节上限，规避 D1 SQLITE_TOOBIG
    MAX_FILE_BYTES = 8_000_000  # 单文件上限，规避 wrangler 大文件问题
    open_new()
    nbytes = 0          # 当前INSERT累计字节
    file_bytes = 0      # 当前文件累计字节

    def flush():
        nonlocal buf, bn, nbytes, file_bytes
        stmt = f"INSERT INTO {table}{collist} VALUES\n" + ",\n".join(buf) + ";\n"
        fh.write(stmt)
        file_bytes += len(stmt.encode("utf-8"))
        buf, bn, nbytes = [], 0, 0

    for row in cur:
        tup = "(" + ",".join(lit(v) for v in row) + ")"
        buf.append(tup)
        bn += 1
        n += 1
        nbytes += len(tup.encode("utf-8"))
        if bn >= batch or nbytes >= MAX_BYTES:
            flush()
            if file_bytes >= MAX_FILE_BYTES:
                fh.close()
                open_new()
                file_bytes = 0
    if buf:
        fh.write(f"INSERT INTO {table}{collist} VALUES\n" + ",\n".join(buf) + ";\n")
    fh.close()
    return n, files


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--batch", type=int, default=500, help="每条INSERT行数")
    args = ap.parse_args()

    conn = sqlite3.connect(DB)
    schema_path = os.path.join(HERE, "d1_schema.sql")
    with open(schema_path, "w", encoding="utf-8") as f:
        f.write(SCHEMA)
    print("写出", os.path.relpath(schema_path))

    prefix = os.path.join(HERE, "d1_import")
    # 清掉旧分片
    for old in os.listdir(HERE):
        if old.startswith("d1_import_") and old.endswith(".sql"):
            os.remove(os.path.join(HERE, old))

    total_files = []
    for table, cols in COLS.items():
        n, files = dump_table(conn, table, cols, args.batch, prefix)
        total_files += files
        print(f"{table}: {n} 行 -> {len(files)} 个文件")
    conn.close()
    print(f"共 {len(total_files)} 个导入分片，前缀 d1_import_*")


if __name__ == "__main__":
    main()
