// Cloudflare Pages Function — 定时收集每日资讯
// 需要在 wrangler.toml 中配置定时触发器，或通过外部服务定时调用此端点
// 调用方式: POST /news/fetch?secret=YOUR_SECRET

export async function onRequest(context) {
  // 验证密钥（防止未授权调用）
  const secret = new URL(context.request.url).searchParams.get('secret');
  const expectedSecret = context.env.NEWS_SECRET || 'demo-key-change-me';

  if (secret !== expectedSecret) {
    return new Response('Unauthorized', { status: 401 });
  }

  try {
    const supabaseUrl = context.env.SUPABASE_URL;
    const supabaseKey = context.env.SUPABASE_KEY;
    const newsApiKey = context.env.NEWS_API_KEY;

    if (!supabaseUrl || !supabaseKey) {
      return new Response('Missing Supabase config', { status: 500 });
    }

    const allNews = [];

    // 从 News API 获取资讯（如果配置了密钥）
    if (newsApiKey) {
      const newsApiNews = await fetchFromNewsApi(newsApiKey);
      allNews.push(...newsApiNews);
    }

    // 从 RSS 源获取资讯
    const rssNews = await fetchFromRss();
    allNews.push(...rssNews);

    // 去重
    const uniqueNews = deduplicateNews(allNews);

    // 存储到 Supabase
    if (uniqueNews.length > 0) {
      const stored = await storeNews(supabaseUrl, supabaseKey, uniqueNews);
      console.log(`Stored ${stored} news items`);
    }

    // 清理 7 天以前的数据
    await cleanOldNews(supabaseUrl, supabaseKey);

    return new Response(
      JSON.stringify({
        success: true,
        message: `Processed ${uniqueNews.length} news items`,
        timestamp: new Date().toISOString()
      }),
      { headers: { 'content-type': 'application/json' } }
    );
  } catch (error) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { 'content-type': 'application/json' } }
    );
  }
}

async function fetchFromNewsApi(apiKey) {
  const keywords = [
    'technology AI startup',
    'finance stock market',
    'automotive electric vehicles'
  ];

  const results = [];

  for (const keyword of keywords) {
    try {
      const response = await fetch(
        `https://newsapi.org/v2/everything?q=${encodeURIComponent(keyword)}&sortBy=publishedAt&language=zh&pageSize=5&apiKey=${apiKey}`,
        { timeout: 10000 }
      );

      if (!response.ok) continue;

      const data = await response.json();
      if (!data.articles) continue;

      for (const article of data.articles) {
        const category = categorizeArticle(article.title + ' ' + (article.description || ''));
        if (category) {
          results.push({
            title: article.title,
            summary: article.description,
            source: article.source?.name || 'News API',
            category,
            image_url: article.urlToImage,
            article_url: article.url,
            published_at: new Date(article.publishedAt).toISOString()
          });
        }
      }
    } catch (error) {
      console.error(`Error fetching from News API (${keyword}):`, error);
    }
  }

  return results;
}

async function fetchFromRss() {
  // RSS 源列表（中文科技、财经、汽车媒体）
  const rssFeeds = [
    'http://feeds.ithome.com/rss/feed.xml', // IT之家
    'http://www.cnbeta.com/rss', // cnBeta
    'https://finance.sina.com.cn/realstock/rss.shtml', // 新浪财经
    'http://rss.carstuff.cn', // 汽车之家
  ];

  const results = [];

  for (const feedUrl of rssFeeds) {
    try {
      const response = await fetch(feedUrl, { timeout: 8000 });
      if (!response.ok) continue;

      const xml = await response.text();
      const items = parseRss(xml);

      for (const item of items) {
        const category = categorizeArticle(item.title);
        if (category) {
          results.push({
            title: item.title,
            summary: item.description,
            source: item.source || 'RSS Feed',
            category,
            image_url: item.image || null,
            article_url: item.link,
            published_at: new Date(item.pubDate).toISOString()
          });
        }
      }
    } catch (error) {
      console.error(`Error fetching RSS (${feedUrl}):`, error);
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
      return m ? m[1].replace(/<[^>]+>/g, '').trim() : '';
    };

    const item = {
      title: getTag('title'),
      description: getTag('description'),
      link: getTag('link'),
      pubDate: getTag('pubDate'),
      source: ''
    };

    if (item.title) items.push(item);
  }

  return items;
}

function categorizeArticle(text) {
  const itKeywords = ['AI', '科技', '互联网', '软件', '编程', '算法', '技术', '芯片', '电脑', '应用'];
  const financeKeywords = ['股票', '基金', '债券', '汇率', '理财', '投资', '金融', '银行', '期货', '黄金'];
  const autoKeywords = ['汽车', '车型', '销量', '新能源', '电动车', '自驾', '驾驶', '车企', '品牌'];

  const lowerText = text.toLowerCase();

  for (const kw of itKeywords) {
    if (lowerText.includes(kw.toLowerCase())) return 'IT';
  }
  for (const kw of financeKeywords) {
    if (lowerText.includes(kw.toLowerCase())) return 'Finance';
  }
  for (const kw of autoKeywords) {
    if (lowerText.includes(kw.toLowerCase())) return 'Auto';
  }

  return null;
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
  // 按分类限制，每个分类最多 5 条
  const categoryLimit = new Map();
  const limitedNews = [];

  for (const item of newsItems) {
    const count = categoryLimit.get(item.category) || 0;
    if (count < 5) {
      limitedNews.push(item);
      categoryLimit.set(item.category, count + 1);
    }
  }

  // 分批插入（避免请求体过大）
  const batchSize = 50;
  let stored = 0;

  for (let i = 0; i < limitedNews.length; i += batchSize) {
    const batch = limitedNews.slice(i, i + batchSize);

    try {
      const response = await fetch(`${supabaseUrl}/rest/v1/news`, {
        method: 'POST',
        headers: {
          'apikey': supabaseKey,
          'Authorization': `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json',
          'Prefer': 'resolution=ignore-duplicates' // 忽略重复键冲突
        },
        body: JSON.stringify(batch)
      });

      if (response.ok) {
        stored += batch.length;
      } else {
        console.error(`Batch insert failed: ${response.status}`);
      }
    } catch (error) {
      console.error('Batch insert error:', error);
    }
  }

  return stored;
}

async function cleanOldNews(supabaseUrl, supabaseKey) {
  // 删除 7 天前的数据
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
