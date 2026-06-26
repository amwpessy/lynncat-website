#!/usr/bin/env bash
# 顺序跑完整套抓取（断点续抓，可随时 Ctrl-C 后重跑本脚本继续）。
# 顺序执行而非并行双开，避免同时打同一站点被风控。
set -e
cd "$(dirname "$0")"

# 保守默认：掌上高考按IP风控较严，过快会触发 1069 临时封禁。
# crawl.py 内置全局熔断，遇 1069 所有线程一起冷却；这里仍以稳为先。
C="${CONCURRENCY:-2}"
D="${DELAY:-0.8}"

echo "[1/3] 院校列表"
python3 crawl.py schools --delay "$D"

echo "[2/3] 院校线（2991校×5年）"
python3 crawl.py college --concurrency "$C" --delay "$D"

echo "[3/3] 专业线（2991校×5年，最久）"
python3 crawl.py major --concurrency "$C" --delay "$D"

echo "== 完成，统计 =="
python3 crawl.py stats
echo "下一步：python3 export_d1.py 生成 D1 导入 SQL"
