import { CATEGORIES, LANGUAGES, fallbackForCategory } from './constants.js';

const JSON_CACHE = 'public, max-age=60, stale-while-revalidate=300';
const IMAGE_CACHE = 'public, max-age=86400, immutable';
const SAFE_IMAGE_TYPES = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif',
]);

class PublicApiError extends Error {
  constructor(code, status) {
    super(code);
    this.name = 'PublicApiError';
    this.code = code;
    this.status = status;
  }
}

function jsonResponse(body, status = 200, cacheControl = JSON_CACHE) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': cacheControl,
    },
  });
}

function errorResponse(code, status) {
  return jsonResponse({ error: code }, status, 'no-store');
}

function oneValue(search, name) {
  const values = search.getAll(name);
  if (values.length > 1) throw new PublicApiError('invalid_request', 400);
  return values[0] ?? null;
}

function positiveInteger(value, fallback, maximum = Number.MAX_SAFE_INTEGER) {
  if (value == null) return fallback;
  if (!/^[1-9]\d*$/u.test(value)) throw new PublicApiError('invalid_request', 400);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > maximum) {
    throw new PublicApiError('invalid_request', 400);
  }
  return parsed;
}

function listParameters(request) {
  const search = new URL(request.url).searchParams;
  const allowed = new Set(['category', 'language', 'q', 'page', 'limit']);
  if ([...search.keys()].some((key) => !allowed.has(key))) {
    throw new PublicApiError('invalid_request', 400);
  }
  const category = oneValue(search, 'category');
  const language = oneValue(search, 'language');
  const q = oneValue(search, 'q');
  if (category != null && !CATEGORIES.has(category)) {
    throw new PublicApiError('invalid_request', 400);
  }
  if (language != null && !LANGUAGES.has(language)) {
    throw new PublicApiError('invalid_request', 400);
  }
  if (q != null && /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(q)) {
    throw new PublicApiError('invalid_request', 400);
  }
  const page = positiveInteger(oneValue(search, 'page'), 1);
  const limit = positiveInteger(oneValue(search, 'limit'), 20, 30);
  const offset = (page - 1) * limit;
  if (!Number.isSafeInteger(offset)) throw new PublicApiError('invalid_request', 400);
  return { category, language, q: q?.trim() ?? '', page, limit, offset };
}

function ftsExpression(q) {
  return q.split(/\s+/u)
    .filter(Boolean)
    .map((token) => `"${token.replaceAll('"', '""')}"`)
    .join(' AND ');
}

function storedImageKey(key) {
  if (typeof key !== 'string' || !key.startsWith('articles/')) return null;
  const segments = key.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..'
    || segment.includes('\\') || /[\u0000-\u001f\u007f]/u.test(segment))) return null;
  return segments.map((segment) => encodeURIComponent(segment)).join('/');
}

function heroImageUrl(row) {
  if (row.hero_image_kind === 'r2') {
    const key = storedImageKey(row.hero_image_key);
    if (key) return `/itnew/images/${key}`;
  }
  return fallbackForCategory(row.category);
}

function publicListItem(row) {
  return {
    slug: row.slug,
    title: row.title,
    summary: row.summary,
    language: row.language,
    category: row.category,
    rightsMode: row.rights_mode,
    heroImageUrl: heroImageUrl(row),
    sourceName: row.source_name,
    sourcePublishedAt: row.source_published_at,
    publishedAt: row.published_at,
  };
}

function publicDetail(row, sections) {
  const licensed = row.rights_mode === 'licensed_full';
  return {
    ...publicListItem(row),
    originalUrl: row.canonical_url,
    rightsNotice: licensed
      ? '本文已获授权转载，转载与再使用请遵守所列许可证。'
      : '此来源未授权全文转载，本站仅提供编辑摘要。',
    license: licensed ? {
      name: row.license_name,
      url: row.license_url,
      attribution: row.attribution_text,
    } : null,
    sections,
  };
}

function filterSql(parameters, alias = 'a') {
  const conditions = [`${alias}.status = 'published'`];
  const bindings = [];
  if (parameters.category != null) {
    conditions.push(`${alias}.category = ?`);
    bindings.push(parameters.category);
  }
  if (parameters.language != null) {
    conditions.push(`${alias}.language = ?`);
    bindings.push(parameters.language);
  }
  return { conditions, bindings };
}

async function listArticlesService({ request, env }) {
  if (!env?.ITNEW_DB) throw new PublicApiError('internal_error', 500);
  const parameters = listParameters(request);
  const db = env.ITNEW_DB;
  const { conditions, bindings } = filterSql(parameters);
  const where = conditions.join(' AND ');
  if (parameters.q) {
    const match = ftsExpression(parameters.q);
    const [itemsResult, countRow] = await Promise.all([
      db.prepare(`
        /* itnew:public_article_search */
        SELECT
          a.slug, a.title, a.summary, a.language, a.category, a.rights_mode,
          a.hero_image_kind, a.hero_image_key, a.source_published_at, a.published_at,
          s.name AS source_name
        FROM itnew_articles AS a
        JOIN itnew_sources AS s ON s.id = a.source_id
        JOIN itnew_articles_fts ON itnew_articles_fts.rowid = a.rowid
        WHERE itnew_articles_fts MATCH ? AND ${where}
        ORDER BY a.published_at DESC, a.id ASC
        LIMIT ? OFFSET ?
      `).bind(match, ...bindings, parameters.limit, parameters.offset).all(),
      db.prepare(`
        /* itnew:public_article_search_count */
        SELECT COUNT(*) AS total
        FROM itnew_articles AS a
        JOIN itnew_articles_fts ON itnew_articles_fts.rowid = a.rowid
        WHERE itnew_articles_fts MATCH ? AND ${where}
      `).bind(match, ...bindings).first(),
    ]);
    const total = Number(countRow?.total ?? 0);
    return jsonResponse({
      items: itemsResult.results.map(publicListItem),
      page: parameters.page,
      limit: parameters.limit,
      total,
      hasMore: parameters.offset + itemsResult.results.length < total,
    });
  }
  const [itemsResult, countRow] = await Promise.all([
    db.prepare(`
      /* itnew:public_article_list */
      SELECT
        a.slug, a.title, a.summary, a.language, a.category, a.rights_mode,
        a.hero_image_kind, a.hero_image_key, a.source_published_at, a.published_at,
        s.name AS source_name
      FROM itnew_articles AS a
      JOIN itnew_sources AS s ON s.id = a.source_id
      WHERE ${where}
      ORDER BY a.published_at DESC, a.id ASC
      LIMIT ? OFFSET ?
    `).bind(...bindings, parameters.limit, parameters.offset).all(),
    db.prepare(`
      /* itnew:public_article_count */
      SELECT COUNT(*) AS total
      FROM itnew_articles AS a
      WHERE ${where}
    `).bind(...bindings).first(),
  ]);
  const total = Number(countRow?.total ?? 0);
  return jsonResponse({
    items: itemsResult.results.map(publicListItem),
    page: parameters.page,
    limit: parameters.limit,
    total,
    hasMore: parameters.offset + itemsResult.results.length < total,
  });
}

async function articleDetailService({ env, params }) {
  if (!env?.ITNEW_DB) throw new PublicApiError('internal_error', 500);
  const db = env.ITNEW_DB;
  const row = await db.prepare(`
    /* itnew:public_article_detail */
    SELECT
      a.id, a.slug, a.canonical_url, a.title, a.summary, a.language, a.category,
      a.rights_mode, a.license_name, a.license_url, a.attribution_text,
      a.hero_image_kind, a.hero_image_key, a.source_published_at, a.published_at,
      s.name AS source_name
    FROM itnew_articles AS a
    JOIN itnew_sources AS s ON s.id = a.source_id
    WHERE a.slug = ? AND a.status = 'published'
    LIMIT 1
  `).bind(params.slug).first();
  if (!row) throw new PublicApiError('not_found', 404);

  let sections = [];
  if (row.rights_mode === 'licensed_full') {
    const result = await db.prepare(`
      /* itnew:public_article_sections */
      SELECT html
      FROM itnew_article_sections
      WHERE article_id = ?
      ORDER BY section_index ASC
    `).bind(row.id).all();
    sections = result.results.map(({ html }) => html);
  }
  return jsonResponse(publicDetail(row, sections));
}

function decodedArticleImageKey(encodedKey) {
  if (/%(?:2f|5c)/iu.test(encodedKey)) throw new PublicApiError('not_found', 404);
  let decoded;
  try {
    decoded = decodeURIComponent(encodedKey);
  } catch {
    throw new PublicApiError('not_found', 404);
  }
  if (/%[0-9a-f]{2}/iu.test(decoded)
    || decoded.startsWith('/')
    || decoded.includes('\\')
    || /[\u0000-\u001f\u007f]/u.test(decoded)) {
    throw new PublicApiError('not_found', 404);
  }
  const segments = decoded.split('/');
  if (segments.length < 3 || segments[0] !== 'articles'
    || segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new PublicApiError('not_found', 404);
  }
  return decoded;
}

function safeObjectContentType(object) {
  const contentType = String(object?.httpMetadata?.contentType ?? '')
    .split(';', 1)[0].trim().toLowerCase();
  return SAFE_IMAGE_TYPES.has(contentType) ? contentType : 'application/octet-stream';
}

async function articleImageService({ env, params }) {
  if (!env?.ITNEW_IMAGES) throw new PublicApiError('internal_error', 500);
  const key = decodedArticleImageKey(params.encodedKey);
  const object = await env.ITNEW_IMAGES.get(key);
  if (!object) throw new PublicApiError('not_found', 404);
  return new Response(object.body, {
    status: 200,
    headers: {
      'Content-Type': safeObjectContentType(object),
      'Cache-Control': IMAGE_CACHE,
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

const defaultServices = {
  listArticles: listArticlesService,
  articleDetail: articleDetailService,
  articleImage: articleImageService,
};

function routeFor(request) {
  const pathname = new URL(request.url).pathname;
  let service = null;
  let params = {};
  if (pathname === '/itnew/api/articles') {
    service = 'listArticles';
  } else if (pathname.startsWith('/itnew/api/articles/')) {
    const encodedSlug = pathname.slice('/itnew/api/articles/'.length);
    if (encodedSlug && !encodedSlug.includes('/')) {
      service = 'articleDetail';
      params = { slug: decodeURIComponent(encodedSlug) };
    }
  } else if (pathname.startsWith('/itnew/images/')) {
    const encodedKey = pathname.slice('/itnew/images/'.length);
    if (encodedKey && !encodedKey.endsWith('/')) {
      service = 'articleImage';
      params = { encodedKey };
    }
  }
  if (!service) return { status: 404 };
  if (request.method !== 'GET') return { status: 405 };
  return { service, params };
}

export async function handleItnewPublicRequest(request, env, context = {}) {
  let matched;
  try {
    matched = routeFor(request);
  } catch {
    return errorResponse('not_found', 404);
  }
  if (matched.status === 404) return errorResponse('not_found', 404);
  if (matched.status === 405) return errorResponse('method_not_allowed', 405);
  const service = { ...defaultServices, ...context.services }[matched.service];
  if (typeof service !== 'function') return errorResponse('internal_error', 500);
  try {
    return await service({ request, env, context, params: matched.params });
  } catch (error) {
    if (error instanceof PublicApiError) return errorResponse(error.code, error.status);
    return errorResponse('internal_error', 500);
  }
}
