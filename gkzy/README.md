# 灵猫高考 · 志愿填报参考系统（gkzy）

基于近 5 年（2021–2025）全国真实录取数据，按**位次**为考生智能匹配「冲 / 稳 / 保」院校与专业。

## 架构

```
掌上高考公开接口 ──(crawler/crawl.py)──► 本地 SQLite (data/gkzy.db)
                                              │ export_d1.py（去 raw、按字节分片）
                                              ▼
                                     Cloudflare D1 (gkzy)
                                              ▲
   前端 index.html ──► Worker /gkzy/api/* (src/gkzy.js) ──┘
```

- **数据源**：掌上高考 `api.zjzw.cn/web/api/`（公开 JSON，无需登录）
- **存储**：抓取落本地 SQLite；服务层用 Cloudflare D1（与 SQLite 同构，易导入）
- **服务**：复用站点的 Cloudflare Worker（`src/worker.js` 路由 `/gkzy/api/*` → `src/gkzy.js`）
- **前端**：纯静态 `index.html` + `css/gkzy.css` + `js/gkzy.js`

## 关键接口事实（逆向所得）

| 项 | 结论 |
|---|---|
| 院校线 | `uri=apidata/api/gk/score/province`，**按「校+年」分区**（整省分页有 page 200 / 4000 条硬上限） |
| 专业线 | `uri=apidata/api/gk/score/special`，按「校+年」分区，一次返回所有省 |
| 院校列表 | `uri=apidata/api/gk/school/lists`，共 2991 所 |
| 单页上限 | `size=20`（≥30 报错） |
| 考生省份 | 取行内 `local_province_name`（`province_id` 是**院校**所在省，勿用） |

## 数据量

- 院校线 ≈ 90 万行、专业线 ≈ 700 万行，合计约 9M 行 / ~1.8GB（SQLite，含 raw）
- 导入 D1 时丢弃 `raw` 列，体积大幅缩减

## 抓取（crawler/）

纯 Python 标准库，断点续抓、限速+抖动、失败指数退避、并发分区。

```bash
cd gkzy/crawler
python3 crawl.py schools                      # 院校列表(2991)
python3 crawl.py college --concurrency 5 --delay 0.25   # 院校线(2991校×5年)
python3 crawl.py major   --concurrency 5 --delay 0.25   # 专业线(2991校×5年)
python3 crawl.py stats                         # 查看进度与行数

# 一键全量（顺序执行，避免并发双开打同一站点）
./run_all.sh
```

中断后重跑同一命令会自动跳过已完成分区（`crawl_state` 表）。

## 导入 D1 与部署

```bash
# 1. 从 SQLite 生成 D1 导入 SQL（schema + 分片 INSERT）
cd gkzy/crawler && python3 export_d1.py

# 2. 创建 D1 库，把返回的 database_id 填进根目录 wrangler.toml
npx wrangler d1 create gkzy

# 3. 导入（本地预览用 --local，线上用 --remote）
cd ../..
npx wrangler d1 execute gkzy --remote --file gkzy/crawler/d1_schema.sql
for f in gkzy/crawler/d1_import_*.sql; do
  npx wrangler d1 execute gkzy --remote --file "$f"
done

# 4. 部署（本仓库惯例：合并到 main 由用户在 Cloudflare 侧触发）
```

本地预览：`npx wrangler dev --local`，访问 `http://localhost:8787/gkzy/`。

> 注意：`.assetsignore` 已排除 `gkzy/data`、`gkzy/crawler`，避免把 GB 级 .db 当静态资源上传（25MiB 上限）。

## API

| 端点 | 说明 |
|---|---|
| `GET /gkzy/api/meta?prov=41` | 该省可用科类 + 最新数据年份 |
| `GET /gkzy/api/recommend?prov=41&type=理科&rank=5000[&score=600]` | 冲/稳/保 推荐（按位次优先，回退分数） |
| `GET /gkzy/api/majors?prov=41&type=理科&school_id=140` | 某院校在该省的专业线 |

**冲稳保判定**（位次 ratio = 院校往年最低位次 / 我的位次）：
- 冲 ratio < 0.93（院校更难）｜ 稳 0.93–1.10 ｜ 保 > 1.10（院校更稳妥）

## 免责声明

数据来源于公开渠道整理，仅供参考，请以各省考试院与高校官方公布为准。
