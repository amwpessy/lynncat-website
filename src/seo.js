const SITE_ORIGIN = 'https://lynncat.com';
const SITEMAP_CACHE = 'public, max-age=3600, stale-while-revalidate=86400';

export const STATIC_SITEMAP_PATHS = Object.freeze([
  '/',
  '/markets/',
  '/markets/community',
  '/markets/privacy',
  '/markets/support',
  '/itnew/',
]);

function xmlEscape(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function publishedDate(value) {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return null;
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function safeArticlePath(slug) {
  if (typeof slug !== 'string') return null;
  const normalized = slug.trim();
  if (!normalized || normalized.includes('/') || /[\u0000-\u001f\u007f]/u.test(normalized)) {
    return null;
  }
  return `/itnew/article/${encodeURIComponent(normalized)}`;
}

async function publishedArticleUrls(env) {
  if (!env?.ITNEW_DB) return [];
  try {
    const result = await env.ITNEW_DB.prepare(`
      /* seo:published_articles */
      SELECT slug, published_at
      FROM itnew_articles
      WHERE status = 'published'
      ORDER BY published_at DESC, id ASC
      LIMIT 49000
    `).all();
    return (result.results || []).flatMap((row) => {
      const path = safeArticlePath(row.slug);
      if (!path) return [];
      return [{
        location: `${SITE_ORIGIN}${path}`,
        lastModified: publishedDate(row.published_at),
      }];
    });
  } catch (error) {
    console.error('seo_sitemap_articles_failed', {
      name: String(error?.name || 'Error').slice(0, 120),
      message: String(error?.message || 'Unable to load published articles').slice(0, 300),
    });
    return [];
  }
}

function urlEntry({ location, lastModified = null }) {
  const lastmod = lastModified ? `\n    <lastmod>${xmlEscape(lastModified)}</lastmod>` : '';
  return `  <url>\n    <loc>${xmlEscape(location)}</loc>${lastmod}\n  </url>`;
}

export async function handleSitemap(request, env) {
  if (!['GET', 'HEAD'].includes(request.method)) {
    return new Response('Method Not Allowed', {
      status: 405,
      headers: { Allow: 'GET, HEAD', 'Cache-Control': 'no-store' },
    });
  }

  const staticUrls = STATIC_SITEMAP_PATHS.map((path) => ({
    location: `${SITE_ORIGIN}${path}`,
  }));
  const articleUrls = await publishedArticleUrls(env);
  const body = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...[...staticUrls, ...articleUrls].map(urlEntry),
    '</urlset>',
    '',
  ].join('\n');

  return new Response(request.method === 'HEAD' ? null : body, {
    status: 200,
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': SITEMAP_CACHE,
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

export function withNoIndex(response) {
  const headers = new Headers(response.headers);
  headers.set('X-Robots-Tag', 'noindex, nofollow');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
