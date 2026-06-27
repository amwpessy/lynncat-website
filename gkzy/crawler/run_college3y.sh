#!/usr/bin/env bash
# 精简版：只抓"院校线"(学校+年份+最低分/位次)，仅近3年(2023-2025)，不抓专业线明细。
# 用于快速覆盖"按近3年学校最低分做冲稳保推荐"这个核心需求。
# 完整版(含专业线、近5年)见 run_all.sh，可随时切回去继续跑。
set -e
cd "$(dirname "$0")"

C="${CONCURRENCY:-2}"
D="${DELAY:-0.8}"
YEARS="2025 2024 2023"

echo "[1/3] 院校列表"
python3 crawl.py schools --delay "$D"

echo "[2/3] 院校线 · 专科优先（近3年，确保大专批尽快可查）"
python3 crawl.py college --level 专科 --years $YEARS --concurrency "$C" --delay "$D"

echo "[3/3] 院校线 · 其余全部（近3年，断点续抓，已完成的会跳过）"
python3 crawl.py college --years $YEARS --concurrency "$C" --delay "$D"

echo "== 完成，统计 =="
python3 crawl.py stats
echo "下一步：python3 export_d1.py 生成 D1 导入 SQL"
