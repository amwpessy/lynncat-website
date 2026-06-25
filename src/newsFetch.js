// 定时收集每日资讯 — 路由：/news/fetch?secret=YOUR_SECRET
// 数据源：中文科技/财经媒体 RSS（混合内容池，按关键词分类）+ News API（可选，需配置 NEWS_API_KEY）
//
// 注：Google News RSS 在 Cloudflare Workers 网络下会被其反爬虫机制拦截，
// 返回 503（本地用 curl 测试是 200，因为 IP 信誉不同），故不可用。
// 这三个源是从公网逐一验证过、且能在 Workers 出口 IP 下正常返回内容的真实 RSS。

const RSS_FEEDS = [
  'https://www.ithome.com/rss/',
  'https://sspai.com/feed',
  'https://www.36kr.com/feed'
];

export async function handleNewsFetch(request, env) {
  const secret = new URL(request.url).searchParams.get('secret');
  const expectedSecret = env.NEWS_SECRET || 'demo-key-change-me';

  if (secret !== expectedSecret) {
    return new Response('Unauthorized', { status: 401 });
  }

  try {
    const result = await runNewsFetch(env);
    return new Response(JSON.stringify({ success: true, ...result }), {
      headers: { 'content-type': 'application/json' }
    });
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { 'content-type': 'application/json' } }
    );
  }
}

export async function runNewsFetch(env) {
  const supabaseUrl = env.SUPABASE_URL;
  const supabaseKey = env.SUPABASE_KEY;
  const newsApiKey = env.NEWS_API_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Missing Supabase config');
  }

  const allNews = [];

  if (newsApiKey) {
    allNews.push(...await fetchFromNewsApi(newsApiKey));
  }

  allNews.push(...await fetchFromRss());

  const uniqueNews = deduplicateNews(allNews);

  let stored = 0;
  if (uniqueNews.length > 0) {
    stored = await storeNews(supabaseUrl, supabaseKey, uniqueNews);
  }

  await cleanOldNews(supabaseUrl, supabaseKey);

  return { fetched: uniqueNews.length, stored, timestamp: new Date().toISOString() };
}

async function fetchFromNewsApi(apiKey) {
  const keywords = [
    { category: 'IT', q: 'technology AI startup' },
    { category: 'Finance', q: 'finance stock market' },
    { category: 'Auto', q: 'automotive electric vehicles' }
  ];

  const results = [];

  for (const { category, q } of keywords) {
    try {
      const response = await fetch(
        `https://newsapi.org/v2/everything?q=${encodeURIComponent(q)}&sortBy=publishedAt&pageSize=5&apiKey=${apiKey}`
      );
      if (!response.ok) continue;

      const data = await response.json();
      if (!data.articles) continue;

      for (const article of data.articles) {
        results.push({
          title: article.title,
          summary: article.description || null,
          source: article.source?.name || 'News API',
          category,
          image_url: article.urlToImage || null,
          article_url: article.url,
          published_at: new Date(article.publishedAt).toISOString()
        });
      }
    } catch (error) {
      console.error(`Error fetching News API (${category}):`, error);
    }
  }

  return results;
}

async function fetchFromRss() {
  const results = [];

  for (const feedUrl of RSS_FEEDS) {
    try {
      const response = await fetch(feedUrl);
      if (!response.ok) {
        console.error(`RSS fetch (${feedUrl}) not ok: ${response.status}`);
        continue;
      }

      const xml = await response.text();
      const items = parseRss(xml).slice(0, 20);
      console.error(`RSS fetch (${feedUrl}) parsed ${items.length} items from ${xml.length} bytes`);

      for (const item of items) {
        if (!item.title || !item.link) continue;
        const category = categorizeArticle(item.title);
        if (!category) continue;
        results.push({
          title: item.title,
          summary: cleanSummary(item.description),
          source: item.source || new URL(feedUrl).hostname,
          category,
          image_url: null,
          article_url: item.link,
          published_at: item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString()
        });
      }
    } catch (error) {
      console.error(`Error fetching RSS (${feedUrl}):`, error);
    }
  }

  return results;
}

function categorizeArticle(text) {
  const itKeywords = ['AI', '科技股', '互联网', '软件', '编程', '算法', '芯片', '应用', '苹果', '华为', '小米', '谷歌', '微软', 'OpenAI', '大模型'];
  const financeKeywords = ['股票', '基金', '债券', '汇率', '理财', '投资', '金融', '银行', '期货', '黄金', '美股', '融资', 'IPO', '财报', '营收', '港股', 'A股'];
  const autoKeywords = ['汽车', '车型', '销量', '新能源', '电动车', '自驾', '驾驶', '车企', '蔚来', '理想', '小鹏', '比亚迪', '特斯拉'];

  for (const kw of itKeywords) if (text.includes(kw)) return 'IT';
  for (const kw of financeKeywords) if (text.includes(kw)) return 'Finance';
  for (const kw of autoKeywords) if (text.includes(kw)) return 'Auto';
  return null;
}

function parseRss(xml) {
  const items = [];
  const itemRegex = /<item>([\s\S]*?)<\/item>/g;
  let match;

  while ((match = itemRegex.exec(xml))) {
    const itemXml = match[1];

    const getTag = (tag) => {
      const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`);
      const m = regex.exec(itemXml);
      return m ? m[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim() : '';
    };

    const sourceMatch = /<source[^>]*>([\s\S]*?)<\/source>/.exec(itemXml);
    const source = sourceMatch ? sourceMatch[1].trim() : '';

    let title = getTag('title');
    if (source && title.endsWith(' - ' + source)) {
      title = title.slice(0, -(source.length + 3));
    }

    items.push({
      title,
      link: getTag('link'),
      pubDate: getTag('pubDate'),
      source,
      description: getTag('description')
    });
  }

  return items;
}

// RSS description 里的 HTML 标签是以 HTML 实体编码的（&lt;p&gt;...&lt;/p&gt;），
// 不是字面 <p> 标签，必须先解码实体、再去标签——顺序反了的话，字面 <tag> 还没出现，
// 去标签那一步直接扑空，解码完实体后标签反而原样保留在最终摘要里。
function cleanSummary(rawDescription) {
  if (!rawDescription) return null;
  let text = rawDescription
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/<[^>]+>/g, '')
    .replace(/查看全文|阅读全文|更多内容请点击/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return null;
  return text.length > 120 ? text.slice(0, 120) + '...' : text;
}

function deduplicateNews(news) {
  const seen = new Set();
  return news.filter(item => {
    const key = `${item.title}|${item.source}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// 每次运行最多新增 5 条（按分类轮流取，避免某一类把额度占满），
// 配合每小时一次的 Cron Trigger，控制更新节奏而不是一次性灌入一大批。
const MAX_PER_RUN = 5;

async function storeNews(supabaseUrl, supabaseKey, newsItems) {
  const byCategory = new Map();
  for (const item of newsItems) {
    if (!byCategory.has(item.category)) byCategory.set(item.category, []);
    byCategory.get(item.category).push(item);
  }

  const categories = [...byCategory.keys()];
  const limitedNews = [];
  let i = 0;
  while (limitedNews.length < MAX_PER_RUN && categories.some(c => byCategory.get(c).length > 0)) {
    const cat = categories[i % categories.length];
    const bucket = byCategory.get(cat);
    if (bucket.length > 0) limitedNews.push(bucket.shift());
    i++;
  }

  let stored = 0;

  try {
    // on_conflict=article_url 是必须的：article_url 的唯一约束不是主键（id 才是），
    // resolution=ignore-duplicates 不指定 on_conflict 时 PostgREST 只会按主键判重，
    // 实际命中 article_url 唯一约束时会直接返回 409 而不是静默跳过。
    const response = await fetch(`${supabaseUrl}/rest/v1/news?on_conflict=article_url`, {
      method: 'POST',
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=ignore-duplicates'
      },
      body: JSON.stringify(limitedNews)
    });

    if (response.ok) {
      stored = limitedNews.length;
    } else {
      console.error(`Insert failed: ${response.status} ${await response.text()}`);
    }
  } catch (error) {
    console.error('Insert error:', error);
  }

  return stored;
}

async function cleanOldNews(supabaseUrl, supabaseKey) {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  try {
    await fetch(`${supabaseUrl}/rest/v1/news?published_at=lt.${sevenDaysAgo.toISOString()}`, {
      method: 'DELETE',
      headers: {
        'apikey': supabaseKey,
        'Authorization': `Bearer ${supabaseKey}`
      }
    });
  } catch (error) {
    console.error('Error cleaning old news:', error);
  }
}
