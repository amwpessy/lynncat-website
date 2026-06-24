# 🗞️ 灵猫每日资讯系统

每天自动收集 IT 业界、金融、汽车等最新资讯，按分类聚合展示。

## 📁 项目结构

```
/news
├── index.html              # 资讯展示页面
├── js/
│   └── news.js            # 前端逻辑（Supabase 连接、数据加载）
├── css/
│   ├── global.css         # 全局样式
│   ├── news.css           # 资讯页面样式
│   └── theme.css          # 深色/浅色主题
├── README.md              # 本文件
├── SETUP.md               # 配置步骤
└── SUPABASE_INIT.sql      # 数据库初始化脚本

/src                       # Cloudflare Workers 入口（整站共用，不止 news）
├── worker.js              # 路由分发：/xxxc/sina、/news/fetch，其余落到静态资源
├── sina.js                # 新浪行情代理（xxxc 看板用）
└── newsFetch.js           # 资讯收集逻辑（本模块）

/index.html               # 主页（已添加 news 导航块）
```

⚠️ **本站部署在 Cloudflare Workers（不是 Cloudflare Pages）**。`wrangler.toml` 里
`main = "src/worker.js"` 是真正处理请求的入口；`/functions/*` 这种 Pages 专属的
文件路由约定在这里完全不生效。如果以后要加新的后端接口，必须在 `src/worker.js`
里手动加路由，不能只丢一个文件到 `functions/` 目录。

## 🚀 访问方式

- **前端页面**：`https://lynncat.com/news/`
- **后端 API**：`https://lynncat.com/news/fetch?secret=YOUR_SECRET`

## 🎯 核心功能

### 前端特性
- ✅ 日期选择器（浏览历史 7 天资讯）
- ✅ 分类筛选（IT、金融、汽车、全部）
- ✅ 响应式设计（手机/平板/桌面适配）
- ✅ 深色/浅色主题自动切换（基于北京时间）
- ✅ 原文链接跳转

### 数据源
- 中文 RSS（IT之家 `ithome.com/rss/`、少数派 `sspai.com/feed`、36氪 `36kr.com/feed`）
  混合抓取，按标题关键词分类成 IT / Finance / Auto，匹配不到任何关键词的条目会被丢弃
- News API（可选，需要在 `newsapi.org` 申请密钥并设置 `NEWS_API_KEY`）

> Google News RSS 试过，**在 Cloudflare Workers 的出口 IP 下会被反爬虫拦截返回
> 503**（本机 curl 测试是 200，因为 IP 信誉不同），所以弃用了，别再加回去。

### 存储
- Supabase PostgreSQL 数据库
- 7 天自动过期策略（每次抓取时顺手清理）

## 🔧 配置信息

### Supabase 凭证
```
项目 URL: https://krtnriuqfnrmlvvjdqtg.supabase.co
Anon Key: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtydG5yaXVxZm5ybWx2dmpkcXRnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIyOTM0MDMsImV4cCI6MjA5Nzg2OTQwM30.maN7a-bdgBtSup9EDeracnf4Hu6-ix9tQHml8oEIQjs
```
（Service Role Key 不写在这里，已经作为 Workers Secret 配置，参见下方）

### 数据库表
表名：`public.news`
- `id` - 主键（自增）
- `created_at` - 创建时间
- `title` - 资讯标题
- `summary` - 摘要
- `source` - 来源
- `category` - 分类（IT/Finance/Auto）
- `image_url` - 配图
- `article_url` - 原文链接
- `published_at` - 发布时间

## 📡 后端配置

### Workers Secrets

环境变量通过 `wrangler secret put` 设置（不是写在 `wrangler.toml` 里，那个文件
里的 `vars` 只适合非敏感配置）：

```bash
echo "<值>" | npx wrangler secret put SUPABASE_URL --name lynncat-website
echo "<值>" | npx wrangler secret put SUPABASE_KEY --name lynncat-website   # Service Role Key
echo "<值>" | npx wrangler secret put NEWS_SECRET --name lynncat-website
echo "<值>" | npx wrangler secret put NEWS_API_KEY --name lynncat-website  # 可选
```

需要的 API Token 权限：`Account → Workers Scripts → Edit`（Pages 权限对这个项目
没用，因为这是 Workers 项目）。

查看已设置的 secret 名称（看不到值）：
```bash
npx wrangler secret list --name lynncat-website
```

### 定时任务

用的是 Cloudflare **原生 Cron Trigger**，已经写在 `wrangler.toml` 里：

```toml
[triggers]
crons = ["0 18 * * *"]  # UTC 18:00 = 北京时间 02:00
```

对应 `src/worker.js` 里的 `scheduled()` 处理函数会自动调用资讯抓取逻辑。不需要
GitHub Actions、不需要 EasyCron 之类的第三方定时服务。

## 🔐 安全说明

- Anon Key 可以放在前端代码中（已配置行级安全）
- Service Role Key 只用在后端（Workers Secret，保密）
- 所有用户只有读权限，不能通过 API 直接修改数据

## 🛠️ 开发指南

### 修改资讯分类
编辑 `src/newsFetch.js` 中的 `categorizeArticle()` 函数，修改关键词列表。

### 添加 RSS 源
编辑 `src/newsFetch.js` 中的 `RSS_FEEDS` 数组。**加新源之前先用 curl 验证它真实
存在且返回有效 RSS**，然后部署后用 `wrangler tail` 确认 Cloudflare 的出口 IP 没
被对方拦截（参考上面 Google News 503 的坑）。

### 修改页面样式
- `css/news.css` - 资讯卡片样式
- `css/theme.css` - 主题色和深浅色配置

### 调试后端
```bash
export CLOUDFLARE_API_TOKEN="..."
export CLOUDFLARE_ACCOUNT_ID="5f552cbf633cc1839eb6381334e75535"
npx wrangler tail lynncat-website --format pretty
# 另开一个终端触发一次
curl "https://lynncat.com/news/fetch?secret=YOUR_SECRET"
```

### 调试前端
在浏览器 DevTools 中：
```javascript
fetch('https://krtnriuqfnrmlvvjdqtg.supabase.co/rest/v1/news?limit=5', {
  headers: { apikey: 'ANON_KEY', Authorization: 'Bearer ANON_KEY' }
}).then(r => r.json()).then(d => console.log(d))
```

## 📝 常见问题

**Q: 前端无法加载资讯**
- A: 检查浏览器控制台错误信息，确认 Supabase 凭证是否正确

**Q: 后端函数执行失败 / 一直 404**
- A: 确认 `wrangler.toml` 里有 `main = "src/worker.js"`，且 `src/worker.js` 里有对应路由。
  这个项目是 Workers 部署，`functions/` 目录的 Pages 路由约定不生效。

**Q: 如何手动触发数据收集？**
```bash
curl "https://lynncat.com/news/fetch?secret=YOUR_SECRET"
```

## 📚 相关资源

- [Supabase 文档](https://supabase.com/docs)
- [News API](https://newsapi.org)
- [Cloudflare Workers Cron Triggers](https://developers.cloudflare.com/workers/configuration/cron-triggers/)
- [Cloudflare Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/)

---

**最后更新**：2026-06-24
