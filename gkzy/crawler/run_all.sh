#!/usr/bin/env bash
# 顺序跑完整套抓取（断点续抓，可随时 Ctrl-C 后重跑本脚本继续）。
# 顺序执行而非并行双开，避免同时打同一站点被风控。
set -e
cd "$(dirname "$0")"

# 保守默认：掌上高考按IP风控较严，过快会触发 1069 临时封禁。
# crawl.py 内置全局熔断，遇 1069 所有线程一起冷却；这里仍以稳为先。
C="${CONCURRENCY:-2}"
D="${DELAY:-0.8}"

echo "[1/5] 院校列表"
python3 crawl.py schools --delay "$D"

echo "[2/5] 专业线 · 重点院校优先（985/211/双一流，约164所×5年，量小但用户最关心，先抓完）"
python3 crawl.py major --key-schools --concurrency "$C" --delay "$D"

echo "[3/5] 院校线 · 专科优先（1507所×5年，确保大专批尽快可查）"
python3 crawl.py college --level 专科 --concurrency "$C" --delay "$D"

echo "[4/5] 院校线 · 其余全部（断点续抓，已完成的会跳过）"
python3 crawl.py college --concurrency "$C" --delay "$D"

echo "[5/5] 专业线 · 其余全部（2991校×5年，最久，断点续抓）"
python3 crawl.py major --concurrency "$C" --delay "$D"

echo "== 完成，统计 =="
python3 crawl.py stats
echo "下一步：python3 export_d1.py 生成 D1 导入 SQL"
