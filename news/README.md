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
└── ...

/functions/news
└── fetch.js               # 后端定时收集函数

/index.html               # 主页（已添加 news 导航块）
```

## 🚀 访问方式

- **前端页面**：`https://lynncat.com/news/`
- **后端 API**：`https://lynncat.com/functions/news/fetch?secret=YOUR_SECRET`

## 🎯 核心功能

### 前端特性
- ✅ 日期选择器（浏览历史 7 天资讯）
- ✅ 分类筛选（IT、金融、汽车、全部）
- ✅ 响应式设计（手机/平板/桌面适配）
- ✅ 深色/浅色主题自动切换（基于北京时间）
- ✅ 原文链接跳转

### 数据源
- News API（可选，需要申请密钥）
- RSS 源（IT之家、cnBeta、新浪财经、汽车之家等）

### 存储
- Supabase PostgreSQL 数据库
- 7 天自动过期策略

## 🔧 配置信息

### Supabase 凭证
```
项目 URL: https://krtnriuqfnrmlvvjdqtg.supabase.co
Anon Key: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtydG5yaXVxZm5ybWx2dmpkcXRnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIyOTM0MDMsImV4cCI6MjA5Nzg2OTQwM30.maN7a-bdgBtSup9EDeracnf4Hu6-ix9tQHml8oEIQjs
```

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

### wrangler.toml 环境变量

```toml
[env.production]
vars = { 
  SUPABASE_URL = "https://krtnriuqfnrmlvvjdqtg.supabase.co",
  SUPABASE_KEY = "Service Role Key（不要用 Anon Key）",
  NEWS_API_KEY = "来自 newsapi.org（可选）",
  NEWS_SECRET = "自定义密钥，防止未授权访问"
}
```

### 定时任务

**方案 A：EasyCron（推荐）**
- 访问 https://www.easycron.com
- 创建任务，每天凌晨 2:00 执行
- URL：`https://lynncat.com/functions/news/fetch?secret=YOUR_SECRET`

**方案 B：GitHub Actions**
```yaml
name: Daily News Fetch
on:
  schedule:
    - cron: '0 18 * * *'  # UTC 18:00 = 北京时间 02:00
jobs:
  fetch:
    runs-on: ubuntu-latest
    steps:
      - run: curl -X POST "${{ secrets.NEWS_FETCH_URL }}?secret=${{ secrets.NEWS_SECRET }}"
```

## 📊 数据统计

目前数据库中有 **12 条测试资讯**：
- 💻 IT 业界：4 条
- 💰 金融：4 条  
- 🚗 汽车：4 条

## 🔐 安全说明

- Anon Key 可以放在前端代码中（已配置行级安全）
- Service Role Key 只用在后端函数中（保密）
- 所有用户只有读权限，不能通过 API 直接修改数据

## 🛠️ 开发指南

### 修改资讯分类
编辑 `functions/news/fetch.js` 中的 `categorizeArticle()` 函数，修改关键词列表。

### 添加 RSS 源
编辑 `functions/news/fetch.js` 中的 `rssFeeds` 数组。

### 修改页面样式
- `css/news.css` - 资讯卡片样式
- `css/theme.css` - 主题色和深浅色配置

### 调试前端
在浏览器 DevTools 中：
```javascript
// 查看当前配置
console.log('Supabase URL:', 'https://krtnriuqfnrmlvvjdqtg.supabase.co');

// 手动加载资讯
fetch('https://krtnriuqfnrmlvvjdqtg.supabase.co/rest/v1/news?limit=5')
  .then(r => r.json())
  .then(d => console.log(d))
```

## 📝 常见问题

**Q: 前端无法加载资讯**
- A: 检查浏览器控制台错误信息，确认 Supabase 凭证是否正确

**Q: 后端函数执行失败**
- A: 查看 Cloudflare Pages 日志，检查环境变量配置

**Q: 如何手动触发数据收集？**
```bash
curl -X POST "https://lynncat.com/functions/news/fetch?secret=YOUR_SECRET"
```

## 📚 相关资源

- [Supabase 文档](https://supabase.com/docs)
- [News API](https://newsapi.org)
- [Cloudflare Pages Functions](https://pages.cloudflare.com/)
- [EasyCron](https://www.easycron.com)

---

**最后更新**：2026-06-24
