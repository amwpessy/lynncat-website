// 定时收集每日资讯 — 路由：/news/fetch?secret=YOUR_SECRET
// 数据源：Google News RSS（按分类拆成 3 个搜索源）+ News API（可选，需配置 NEWS_API_KEY）

const RSS_FEEDS = [
  { category: 'IT', url: 'https://news.google.com/rss/search?q=%E7%A7%91%E6%8A%80%20OR%20AI%20OR%20%E4%BA%92%E8%81%94%E7%BD%91%20OR%20%E8%8A%AF%E7%89%87&hl=zh-CN&gl=CN&ceid=CN:zh-Hans' },
  { category: 'Finance', url: 'https://news.google.com/rss/search?q=%E8%82%A1%E5%B8%82%20OR%20%E8%B4%A2%E7%BB%8F%20OR%20%E9%87%91%E8%9E%8D%20OR%20%E5%A4%AE%E8%A1%8C&hl=zh-CN&gl=CN&ceid=CN:zh-Hans' },
  { category: 'Auto', url: 'https://news.google.com/rss/search?q=%E6%B1%BD%E8%BD%A6%20OR%20%E6%96%B0%E8%83%BD%E6%BA%90%E6%B1%BD%E8%BD%A6%20OR%20%E7%94%B5%E5%8A%A8%E8%BD%A6&hl=zh-CN&gl=CN&ceid=CN:zh-Hans' }
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

  for (const feed of RSS_FEEDS) {
    try {
      const response = await fetch(feed.url);
      if (!response.ok) {
        console.error(`RSS fetch (${feed.category}) not ok: ${response.status}`);
        continue;
      }

      const xml = await response.text();
      const items = parseRss(xml).slice(0, 8);
      console.error(`RSS fetch (${feed.category}) parsed ${items.length} items from ${xml.length} bytes`);

      for (const item of items) {
        if (!item.title || !item.link) continue;
        results.push({
          title: item.title,
          summary: null,
          source: item.source || 'Google News',
          category: feed.category,
          image_url: null,
          article_url: item.link,
          published_at: item.pubDate ? new Date(item.pubDate).toISOString() : new Date().toISOString()
        });
      }
    } catch (error) {
      console.error(`Error fetching RSS (${feed.category}):`, error);
    }
  }

  return results;
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
      source
    });
  }

  return items;
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

async function storeNews(supabaseUrl, supabaseKey, newsItems) {
  const categoryLimit = new Map();
  const limitedNews = [];

  for (const item of newsItems) {
    const count = categoryLimit.get(item.category) || 0;
    if (count < 5) {
      limitedNews.push(item);
      categoryLimit.set(item.category, count + 1);
    }
  }

  let stored = 0;

  try {
    const response = await fetch(`${supabaseUrl}/rest/v1/news`, {
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
