import { publishedArticleForSlug } from './public.js';

const SITE_ORIGIN = 'https://lynncat.com';
const ARTICLE_CACHE = 'public, max-age=60, stale-while-revalidate=300';

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function decodeCommonEntities(value) {
  const named = {
    amp: '&', apos: "'", gt: '>', lt: '<', nbsp: ' ', quot: '"',
  };
  return value.replace(/&(#(?:x[0-9a-f]+|\d+)|[a-z]+);/giu, (match, entity) => {
    const lower = entity.toLowerCase();
    if (lower in named) return named[lower];
    if (lower.startsWith('#x')) {
      const codePoint = Number.parseInt(lower.slice(2), 16);
      return Number.isSafeInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint) : match;
    }
    if (lower.startsWith('#')) {
      const codePoint = Number.parseInt(lower.slice(1), 10);
      return Number.isSafeInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint) : match;
    }
    return match;
  });
}

function plainText(value, fallback = '') {
  if (typeof value !== 'string') return fallback;
  const text = decodeCommonEntities(value.replace(/<[^>]*>/gu, ' '))
    .replace(/\s+/gu, ' ')
    .trim();
  return text || fallback;
}

function truncate(value, maximum) {
  const characters = Array.from(value);
  return characters.length <= maximum
    ? value
    : `${characters.slice(0, Math.max(1, maximum - 1)).join('').trimEnd()}…`;
}

function safeExternalUrl(value) {
  if (typeof value !== 'string' || !value) return null;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol)
      && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
}

function absoluteImageUrl(value) {
  try {
    const url = new URL(value, SITE_ORIGIN);
    return url.origin === SITE_ORIGIN ? url.href : `${SITE_ORIGIN}/itnew/assets/fallback/frontier.png`;
  } catch {
    return `${SITE_ORIGIN}/itnew/assets/fallback/frontier.png`;
  }
}

function isoDate(value) {
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return null;
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function jsonLd(value) {
  return JSON.stringify(value)
    .replaceAll('<', '\\u003c')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029');
}

function articleMetadata(article) {
  const title = plainText(article.title, 'ITNEW 科技资讯');
  const description = truncate(plainText(article.summary, 'ITNEW 双语科技资讯。'), 180);
  const canonical = `${SITE_ORIGIN}/itnew/article/${encodeURIComponent(article.slug)}`;
  const image = absoluteImageUrl(article.heroImageUrl);
  const language = article.language === 'en' ? 'en' : 'zh-CN';
  const published = isoDate(article.sourcePublishedAt) || isoDate(article.publishedAt);
  const structuredData = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: title,
    description,
    url: canonical,
    inLanguage: language,
    primaryImageOfPage: {
      '@type': 'ImageObject',
      url: image,
    },
    isPartOf: {
      '@type': 'WebSite',
      name: 'ITNEW',
      url: `${SITE_ORIGIN}/itnew/`,
    },
    ...(published ? { datePublished: published } : {}),
  };
  const publishedMeta = published
    ? `\n  <meta property="article:published_time" content="${escapeHtml(published)}">`
    : '';

  return {
    title,
    description,
    canonical,
    image,
    language,
    head: [
      `  <meta name="description" content="${escapeHtml(description)}">`,
      '  <meta name="robots" content="index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1">',
      `  <link rel="canonical" href="${escapeHtml(canonical)}">`,
      '  <meta property="og:type" content="article">',
      `  <meta property="og:site_name" content="ITNEW">`,
      `  <meta property="og:title" content="${escapeHtml(title)}">`,
      `  <meta property="og:description" content="${escapeHtml(description)}">`,
      `  <meta property="og:url" content="${escapeHtml(canonical)}">`,
      `  <meta property="og:image" content="${escapeHtml(image)}">${publishedMeta}`,
      '  <meta name="twitter:card" content="summary_large_image">',
      `  <meta name="twitter:title" content="${escapeHtml(title)}">`,
      `  <meta name="twitter:description" content="${escapeHtml(description)}">`,
      `  <meta name="twitter:image" content="${escapeHtml(image)}">`,
      `  <script type="application/ld+json">${jsonLd(structuredData)}</script>`,
      `  <title>${escapeHtml(title)} · ITNEW</title>`,
    ].join('\n'),
  };
}

function articleBody(article, summary) {
  if (article.rightsMode !== 'licensed_full') return `<p>${escapeHtml(summary)}</p>`;
  const sections = Array.isArray(article.sections)
    ? article.sections.filter((section) => typeof section === 'string')
    : [];
  if (sections.length === 0) return '<p>正文暂不可用，请前往原始来源阅读。</p>';
  return sections.map((section) => (
    `<section class="article-section">${section}</section>`
  )).join('');
}

export function renderPublishedArticle(template, article) {
  const metadata = articleMetadata(article);
  const summary = plainText(article.summary, '暂无摘要。');
  const category = plainText(article.category, 'frontier').toUpperCase();
  const source = plainText(article.sourceName, 'ITNEW');
  const published = isoDate(article.sourcePublishedAt) || isoDate(article.publishedAt);
  const displayDate = published ? published.slice(0, 10) : '时间待确认';
  const licensed = article.rightsMode === 'licensed_full';
  const rightsNotice = licensed
    ? '本文已获授权转载，转载与再使用请遵守所列许可证。'
    : '此来源未授权全文转载，本站仅提供编辑摘要。';
  const originalUrl = safeExternalUrl(article.originalUrl);
  const image = absoluteImageUrl(article.heroImageUrl);

  return template
    .replace('<html lang="zh-CN">', `<html lang="${metadata.language}">`)
    .replace(
      [
        '  <meta name="description" content="ITNEW 站内文章详情。">',
        '  <meta name="robots" content="noindex,nofollow">',
        '  <link rel="canonical" href="https://lynncat.com/itnew/article">',
        '  <title>文章 · ITNEW</title>',
      ].join('\n'),
      metadata.head,
    )
    .replace(
      '<div id="articleStatus" class="article-status" role="status" aria-live="polite">',
      '<div id="articleStatus" class="article-status" role="status" aria-live="polite" hidden>',
    )
    .replace('<article id="articleContent" hidden>', '<article id="articleContent">')
    .replace(
      '<p id="articleEyebrow" class="section-kicker"></p>',
      `<p id="articleEyebrow" class="section-kicker">${escapeHtml(category)} · ${licensed ? 'LICENSED FULL' : 'SUMMARY'}</p>`,
    )
    .replace('<h1 id="articleTitle"></h1>', `<h1 id="articleTitle">${escapeHtml(metadata.title)}</h1>`)
    .replace(
      '<dl id="articleMeta" class="article-meta"></dl>',
      `<dl id="articleMeta" class="article-meta"><div><dt>来源</dt><dd>${escapeHtml(source)}</dd></div><div><dt>语言</dt><dd>${article.language === 'en' ? 'English' : '中文'}</dd></div><div><dt>发布时间</dt><dd>${escapeHtml(displayDate)}</dd></div></dl>`,
    )
    .replace(
      '<img id="articleImage" alt="">',
      `<img id="articleImage" src="${escapeHtml(image)}" alt="${escapeHtml(`${metadata.title} — ${category} 主题配图`)}">`,
    )
    .replace(
      '<figcaption id="articleCaption"></figcaption>',
      `<figcaption id="articleCaption">${escapeHtml(`${source} · ${category}`)}</figcaption>`,
    )
    .replace(
      '<p id="articleSummary" class="article-summary"></p>',
      `<p id="articleSummary" class="article-summary"${licensed ? '' : ' hidden'}>${escapeHtml(summary)}</p>`,
    )
    .replace('<p id="rightsNotice"></p>', `<p id="rightsNotice">${escapeHtml(rightsNotice)}</p>`)
    .replace(
      '<div id="articleBody" class="article-body"></div>',
      `<div id="articleBody" class="article-body">${articleBody(article, summary)}</div>`,
    )
    .replace(
      '<a id="originalLink" class="original-link" href="/itnew/" target="_blank" rel="noopener noreferrer">',
      `<a id="originalLink" class="original-link" href="${escapeHtml(originalUrl || '/itnew/')}" target="_blank" rel="noopener noreferrer"${originalUrl ? '' : ' hidden'}>`,
    )
    .replace(
      '<p id="originalUnavailable" class="muted-copy" hidden>原文地址暂不可用。</p>',
      `<p id="originalUnavailable" class="muted-copy"${originalUrl ? ' hidden' : ''}>原文地址暂不可用。</p>`,
    );
}

function transformedResponse(templateResponse, body, status, request) {
  const headers = new Headers(templateResponse.headers);
  headers.set('Content-Type', 'text/html; charset=utf-8');
  headers.set('Cache-Control', ARTICLE_CACHE);
  headers.set('X-Content-Type-Options', 'nosniff');
  headers.delete('Content-Length');
  headers.delete('Content-Encoding');
  headers.delete('ETag');
  return new Response(request.method === 'HEAD' ? null : body, { status, headers });
}

export async function handleItnewArticlePage(request, env, slug) {
  const templateResponse = await env.ASSETS.fetch(
    new Request(new URL('/itnew/article', request.url), request),
  );
  if (!env?.ITNEW_DB || !['GET', 'HEAD'].includes(request.method)) return templateResponse;

  const template = await templateResponse.text();
  try {
    const article = await publishedArticleForSlug(env, slug);
    if (!article) {
      const headers = new Headers(templateResponse.headers);
      headers.set('X-Robots-Tag', 'noindex, nofollow');
      headers.delete('Content-Length');
      return new Response(request.method === 'HEAD' ? null : template, {
        status: 404,
        headers,
      });
    }
    return transformedResponse(templateResponse, renderPublishedArticle(template, article), 200, request);
  } catch (error) {
    console.error('itnew_article_prerender_failed', {
      name: String(error?.name || 'Error').slice(0, 120),
      message: String(error?.message || 'Unable to prerender article').slice(0, 300),
    });
    return transformedResponse(templateResponse, template, templateResponse.status, request);
  }
}
