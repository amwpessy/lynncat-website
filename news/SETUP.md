# 🗞️ 每日资讯系统配置指南

## 项目概述

每日资讯系统自动收集 IT业界、金融、汽车资讯，存储在 Supabase，通过前端页面展示。

**功能特性：**
- ✅ API + RSS 双源数据采集
- ✅ 每天自动更新（需配置定时任务）
- ✅ 按分类筛选（IT/金融/汽车）
- ✅ 7天历史记录
- ✅ 响应式设计

---

## 第一步：创建 Supabase 项目

### 1.1 创建项目
1. 访问 [supabase.com](https://supabase.com)
2. 点击 **"New Project"**
3. 填写项目信息：
   - **项目名**：`lynncat-news` 或其他名称
   - **数据库密码**：生成强密码，保存好！
   - **地区**：选择 Singapore 或 Hong Kong（距离较近）
4. 等待1-2分钟，项目创建完成

### 1.2 获取凭证
项目创建后，进入项目设置：
1. **Project Settings** → **API**
2. 复制以下两个信息：
   - **Project URL**（形如：`https://xxxxx.supabase.co`）
   - **Anon Key**（公开 API 密钥，可以放在前端代码中）

### 1.3 创建数据表
在 Supabase 控制面板，点击 **"SQL Editor"**，执行以下 SQL：

```sql
-- 创建资讯表
create table news (
  id bigint primary key generated always as identity,
  created_at timestamp default now(),
  title text not null,
  summary text,
  source text,
  category text check (category in ('IT', 'Finance', 'Auto')),
  image_url text,
  article_url text unique,
  published_at timestamp not null,
  unique(title, source)  -- 防止重复
);

-- 创建索引加快查询
create index idx_news_published_at on news(published_at desc);
create index idx_news_category on news(category);
create index idx_news_date_category on news(published_at desc, category);

-- 开启行级安全（RLS），允许所有人读取，禁止修改
alter table news enable row level security;

create policy "Allow public read" on news
  for select using (true);

create policy "Deny public modify" on news
  for insert, update, delete using (false);
```

---

## 第二步：配置前端

### 2.1 在浏览器中存储凭证
用户首次访问 `/xxxc/news` 页面时，需要在浏览器控制台输入 Supabase 凭证：

```javascript
// 在浏览器控制台（F12 → Console）执行：
localStorage.setItem('supabase_url', 'https://xxxxx.supabase.co');
localStorage.setItem('supabase_key', 'eyJxx...');  // Anon Key
```

**更安全的做法**：将凭证存储在环境变量，由前端加载。

### 2.2 或修改 js/news.js
编辑 `js/news.js` 顶部，直接填入凭证：

```javascript
const SUPABASE_URL = 'https://xxxxx.supabase.co';
const SUPABASE_KEY = 'eyJxx...';
```

---

## 第三步：配置后端数据收集

### 3.1 获取 News API 密钥（可选）

如需使用 News API（更丰富的资讯源）：
1. 访问 [newsapi.org](https://newsapi.org)
2. 注册账户，获取免费 API Key
3. 免费版本每月 1000 次请求，每个请求最多 100 条结果

### 3.2 配置 Cloudflare 环境变量

编辑项目根目录的 `wrangler.toml`，添加以下配置：

```toml
[env.production]
vars = { SUPABASE_URL = "https://xxxxx.supabase.co", SUPABASE_KEY = "eyJxx...", NEWS_API_KEY = "your-newsapi-key", NEWS_SECRET = "your-secret-key" }

[env.development]
vars = { SUPABASE_URL = "https://xxxxx.supabase.co", SUPABASE_KEY = "eyJxx...", NEWS_API_KEY = "", NEWS_SECRET = "demo-key-change-me" }
```

### 3.3 测试后端函数

在本地测试（需要 Cloudflare CLI）：

```bash
# 部署到 Cloudflare Pages
npm run deploy

# 手动触发数据收集（使用正确的密钥）
curl -X POST "https://your-site.pages.dev/xxxc/news-fetch?secret=your-secret-key"
```

---

## 第四步：设置定时数据收集

### 方案 A：使用 Cron 外部服务（推荐）

使用免费服务如 [EasyCron](https://www.easycron.com) 定时触发：

1. 注册 EasyCron 账户
2. 创建新 Cron 任务：
   - **URL**：`https://your-site.pages.dev/xxxc/news-fetch?secret=your-secret-key`
   - **执行频率**：每天 2:00 AM (UTC+8)
   - **方法**：POST

### 方案 B：使用 GitHub Actions

创建 `.github/workflows/news-fetch.yml`：

```yaml
name: Daily News Fetch

on:
  schedule:
    - cron: '0 18 * * *'  # 每天北京时间 02:00 (UTC 18:00)

jobs:
  fetch:
    runs-on: ubuntu-latest
    steps:
      - name: Fetch News
        run: |
          curl -X POST "${{ secrets.NEWS_FETCH_URL }}?secret=${{ secrets.NEWS_SECRET }}"
```

在 GitHub 仓库设置 Secrets：
- `NEWS_FETCH_URL`：`https://your-site.pages.dev/xxxc/news-fetch`
- `NEWS_SECRET`：你的密钥

### 方案 C：使用 Cloudflare Cron（需要 Workers）

如果使用 Cloudflare Workers，可配置内置的 Cron Trigger：

```javascript
export default {
  async scheduled(event, env, ctx) {
    // 定时执行的代码
    ctx.waitUntil(fetchNews(env));
  }
}
```

---

## 第五步：验证系统

### 5.1 手动测试数据收集
```bash
curl -X POST "https://your-site.pages.dev/xxxc/news-fetch?secret=your-secret-key"
```

预期响应：
```json
{
  "success": true,
  "message": "Processed 12 news items",
  "timestamp": "2026-06-24T10:30:00Z"
}
```

### 5.2 查看 Supabase 数据
1. 打开 Supabase 控制面板
2. 点击 **"Table Editor"**
3. 选择 `news` 表，应该能看到新增的资讯数据

### 5.3 访问前端页面
- 打开 `https://your-site.xxxc/news`
- 验证能正常显示资讯列表
- 测试分类筛选、日期切换功能

---

## 常见问题

### Q: 前端显示"尚未配置 Supabase 数据库"
**A:** 需要在浏览器 localStorage 中存储凭证，或在 `js/news.js` 中硬编码。

### Q: 数据一直是空的
**A:** 
1. 检查后端函数是否正确执行（查看 Cloudflare 日志）
2. 确认 Supabase 凭证正确
3. 检查 News API 配额是否用尽

### Q: 如何修改资讯分类？
编辑 `functions/xxxc/news-fetch.js` 中的 `categorizeArticle()` 函数，修改关键词列表。

### Q: 如何添加更多 RSS 源？
编辑 `functions/xxxc/news-fetch.js` 中的 `rssFeeds` 数组，添加新的 RSS 源 URL。

### Q: 数据收集太慢了
- 减少 RSS 源数量
- 减少每个 News API 查询的结果数（修改 `pageSize`）
- 增加并发请求（使用 `Promise.all()`）

---

## 后续优化

1. **添加搜索功能**：在前端添加关键词搜索
2. **添加收藏功能**：使用浏览器 localStorage 保存用户收藏
3. **优化 RSS 解析**：使用专门的 RSS 解析库
4. **添加评论系统**：集成 Disqus 或其他评论服务
5. **推送通知**：当有热点资讯时发送通知

---

## 文件清单

- ✅ `xxxc/news.html` - 资讯展示页面
- ✅ `xxxc/css/news.css` - 资讯样式
- ✅ `xxxc/js/news.js` - 前端逻辑
- ✅ `functions/xxxc/news-fetch.js` - 后端数据收集
- ✅ `xxxc/index.html` - 已添加资讯导航

---

**快速开始总结：**
1. ✅ 创建 Supabase 项目，获取 URL 和 Key
2. ✅ 在 Supabase 执行 SQL 创建表
3. ✅ 在 `js/news.js` 中配置凭证
4. ✅ 配置 `wrangler.toml` 环境变量
5. ✅ 设置定时任务（EasyCron/GitHub Actions）
6. ✅ 测试数据收集
7. ✅ 访问 `/xxxc/news` 查看效果

有问题随时联系！🚀
