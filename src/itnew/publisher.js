import { BODY_SECTION_MAX_BYTES, fallbackForCategory } from './constants.js';
import { sanitizeArticleHtml, splitArticleSections } from './sanitize.js';

const IMAGE_TIMEOUT_MS = 12_000;
const IMAGE_MAX_BYTES = 8 * 1024 * 1024;
const IMAGE_TYPES = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
  ['image/gif', 'gif'],
  ['image/avif', 'avif'],
]);

function configured(env) {
  if (!env?.ITNEW_DB || !env?.ITNEW_IMAGES) {
    throw new Error('IT news publisher is not configured');
  }
}

function value(candidate, snakeName, camelName) {
  return candidate?.[snakeName] ?? candidate?.[camelName] ?? null;
}

function publicationTime(now) {
  const resolved = typeof now === 'function' ? now() : now;
  return Number.isFinite(resolved) ? resolved : Date.now();
}

function makeId(uuid) {
  return (uuid || (() => crypto.randomUUID()))();
}

function stringValue(input) {
  return typeof input === 'string' ? input.trim() : '';
}

async function sha256Hex(input) {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function articleSlug(title, canonicalUrl) {
  const words = String(title ?? '').match(/[A-Za-z0-9]+/g) ?? [];
  const readable = words.join('-').toLowerCase() || 'article';
  const suffix = (await sha256Hex(String(canonicalUrl ?? ''))).slice(0, 12);
  const base = readable.slice(0, 96 - suffix.length - 1).replace(/-+$/g, '') || 'article';
  return `${base}-${suffix}`;
}

function parseLicense(candidate) {
  const raw = value(candidate, 'license_snapshot_json', 'licenseSnapshotJson');
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      articleAllowed: parsed.articleAllowed === true,
      name: stringValue(parsed.name ?? parsed.licenseName),
      url: stringValue(parsed.url ?? parsed.licenseUrl),
      attribution: stringValue(parsed.attributionTemplate ?? parsed.attribution),
    };
  } catch {
    return null;
  }
}

function validFullPermission(candidate, source, license) {
  return value(candidate, 'rights_mode_snapshot', 'rightsModeSnapshot') === 'licensed_full'
    && source?.rights_mode === 'licensed_full'
    && license?.articleAllowed === true
    && Boolean(license.name && license.url && license.attribution);
}

function hasArticleContent(html) {
  if (/<img\b/i.test(html)) return true;
  return html.replace(/<[^>]*>/g, '').replaceAll('\u00a0', ' ').trim().length > 0;
}

function sourceCurrent(db, sourceId) {
  return db.prepare(`
    /* itnew:publisher_source_current */
    SELECT id, rights_mode
    FROM itnew_sources
    WHERE id = ?
    LIMIT 1
  `).bind(sourceId).first();
}

function articleReference(db, articleId) {
  return db.prepare(`
    /* itnew:publisher_article_ref */
    SELECT id, slug, status
    FROM itnew_articles
    WHERE id = ?
    LIMIT 1
  `).bind(articleId).first();
}

function articleStatus(db, articleId) {
  return db.prepare(`
    /* itnew:publisher_article_status */
    SELECT id, status
    FROM itnew_articles
    WHERE id = ?
    LIMIT 1
  `).bind(articleId).first();
}

function articleInsert(db, article) {
  return db.prepare(`
    /* itnew:publisher_article_insert */
    INSERT INTO itnew_articles (
      id, slug, source_id, canonical_url, title, summary, language, category,
      rights_mode, article_permission_verified, license_name, license_url,
      attribution_text, hero_image_kind, hero_image_key, source_published_at,
      published_at, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    article.id, article.slug, article.sourceId, article.canonicalUrl,
    article.title, article.summary, article.language, article.category,
    article.rightsMode, article.articlePermissionVerified, article.licenseName,
    article.licenseUrl, article.attributionText, article.heroImageKind,
    article.heroImageKey, article.sourcePublishedAt, article.publishedAt, 'published',
  );
}

function sectionInsert(db, section) {
  return db.prepare(`
    /* itnew:publisher_section_insert */
    INSERT INTO itnew_article_sections (id, article_id, section_index, html)
    VALUES (?, ?, ?, ?)
  `).bind(section.id, section.articleId, section.index, section.html);
}

function imageInsert(db, image) {
  return db.prepare(`
    /* itnew:publisher_image_insert */
    INSERT INTO itnew_article_images (
      id, article_id, object_key, source_url, alt_text, sort_order, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).bind(
    image.id, image.articleId, image.key, image.sourceUrl,
    image.altText, image.sortOrder, image.createdAt,
  );
}

function candidateApprove(db, candidateId, articleId, now) {
  return db.prepare(`
    /* itnew:publisher_candidate_approve */
    UPDATE itnew_candidates
    SET status = 'approved', article_id = ?, processing_error = NULL, reviewed_at = ?
    WHERE id = ? AND status IN ('pending', 'processing_error')
  `).bind(articleId, now, candidateId);
}

function candidateError(db, candidateId, code, now) {
  return db.prepare(`
    /* itnew:publisher_candidate_error */
    UPDATE itnew_candidates
    SET status = 'processing_error', processing_error = ?, reviewed_at = ?
    WHERE id = ? AND status IN ('pending', 'processing_error')
  `).bind(code, now, candidateId);
}

function auditInsert(db, audit) {
  return db.prepare(`
    /* itnew:publisher_audit_insert */
    INSERT INTO itnew_audit_log (
      id, admin_id, action, target_type, target_id, batch_id,
      result, details_json, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    audit.id, audit.adminId, audit.action, audit.targetType, audit.targetId,
    audit.batchId, audit.result, JSON.stringify(audit.details), audit.createdAt,
  );
}

function articleUnpublish(db, articleId) {
  return db.prepare(`
    /* itnew:publisher_article_unpublish */
    UPDATE itnew_articles
    SET status = 'unpublished'
    WHERE id = ? AND status = 'published'
  `).bind(articleId);
}

async function recordProcessingError(db, candidate, code, now, uuid, adminId) {
  const candidateId = value(candidate, 'id', 'id');
  await db.batch([
    candidateError(db, candidateId, code, now),
    auditInsert(db, {
      id: makeId(uuid), adminId, action: 'publish', targetType: 'candidate',
      targetId: candidateId, batchId: value(candidate, 'batch_id', 'batchId'),
      result: 'processing_error', details: { error: code }, createdAt: now,
    }),
  ]);
  return { status: 'processing_error', articleId: null, slug: null, warnings: [code] };
}

function responseHeader(response, name) {
  return response?.headers?.get?.(name) ?? null;
}

async function copyHeroImage(images, url, articleId, fetchImpl) {
  const parsed = new URL(url);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') throw new Error('image_url_invalid');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), IMAGE_TIMEOUT_MS);
  try {
    const response = await fetchImpl(parsed.href, { signal: controller.signal });
    if (!response?.ok) throw new Error('image_http_failed');
    const contentType = String(responseHeader(response, 'content-type') ?? '')
      .split(';', 1)[0].trim().toLowerCase();
    const extension = IMAGE_TYPES.get(contentType);
    if (!extension) throw new Error('image_type_not_allowed');
    const contentLength = Number(responseHeader(response, 'content-length'));
    if (Number.isFinite(contentLength) && contentLength > IMAGE_MAX_BYTES) {
      throw new Error('image_too_large');
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > IMAGE_MAX_BYTES) throw new Error('image_too_large');
    const key = `articles/${articleId}/${await sha256Hex(bytes)}.${extension}`;
    await images.put(key, bytes, { httpMetadata: { contentType } });
    return { key, contentType };
  } finally {
    clearTimeout(timeout);
  }
}

export async function publishCandidate(env, candidate, context = {}) {
  configured(env);
  const db = env.ITNEW_DB;
  const images = env.ITNEW_IMAGES;
  const now = publicationTime(context.now);
  const uuid = context.uuid;
  const fetchImpl = context.fetchImpl || fetch;
  const adminId = stringValue(context.adminId) || 'system';
  const status = value(candidate, 'status', 'status');
  const existingArticleId = value(candidate, 'article_id', 'articleId');

  if (status === 'approved' && existingArticleId) {
    const existing = await articleReference(db, existingArticleId);
    if (existing) {
      return { status: existing.status === 'unpublished' ? 'unpublished' : 'published',
        articleId: existing.id, slug: existing.slug, warnings: [] };
    }
    return { status: 'processing_error', articleId: existingArticleId, slug: null,
      warnings: ['approved_article_missing'] };
  }
  if (status !== 'pending' && status !== 'processing_error') {
    return { status: 'processing_error', articleId: null, slug: null,
      warnings: ['candidate_not_publishable'] };
  }

  const sourceId = value(candidate, 'source_id', 'sourceId');
  const source = await sourceCurrent(db, sourceId);
  const license = parseLicense(candidate);
  const requestedFull = value(candidate, 'rights_mode_snapshot', 'rightsModeSnapshot') === 'licensed_full';
  const fullPermission = validFullPermission(candidate, source, license);
  const warnings = [];
  if (requestedFull && !fullPermission) warnings.push('permission_downgraded');

  let sections = [];
  if (fullPermission) {
    const stagedBodyKey = stringValue(value(candidate, 'staged_body_key', 'stagedBodyKey'));
    if (!stagedBodyKey) {
      return recordProcessingError(db, candidate, 'staged_body_missing', now, uuid, adminId);
    }
    try {
      const object = await images.get(stagedBodyKey);
      if (!object || typeof object.text !== 'function') throw new Error('body_unavailable');
      const body = await object.text();
      const sanitized = sanitizeArticleHtml(body);
      if (!hasArticleContent(sanitized)) throw new Error('empty_sanitized_body');
      sections = splitArticleSections(sanitized, BODY_SECTION_MAX_BYTES);
      if (sections.length === 0) throw new Error('empty_sanitized_body');
    } catch {
      return recordProcessingError(db, candidate, 'body_processing_failed', now, uuid, adminId);
    }
  }

  const articleId = makeId(uuid);
  const canonicalUrl = String(value(candidate, 'canonical_url', 'canonicalUrl') ?? '');
  const slug = await articleSlug(value(candidate, 'title', 'title'), canonicalUrl);
  const category = value(candidate, 'category', 'category');
  let heroImageKind = 'fallback';
  let heroImageKey = fallbackForCategory(category);
  let copiedImage = null;
  const remoteImageUrl = stringValue(value(candidate, 'remote_image_url', 'remoteImageUrl'));
  if (fullPermission && remoteImageUrl) {
    try {
      copiedImage = await copyHeroImage(images, remoteImageUrl, articleId, fetchImpl);
      heroImageKind = 'r2';
      heroImageKey = copiedImage.key;
    } catch {
      warnings.push('image_copy_failed');
    }
  }

  const article = {
    id: articleId, slug, sourceId, canonicalUrl,
    title: String(value(candidate, 'title', 'title') ?? ''),
    summary: String(value(candidate, 'summary', 'summary') ?? ''),
    language: value(candidate, 'language', 'language'), category,
    rightsMode: fullPermission ? 'licensed_full' : 'summary_link',
    articlePermissionVerified: fullPermission ? 1 : 0,
    licenseName: fullPermission ? license.name : null,
    licenseUrl: fullPermission ? license.url : null,
    attributionText: fullPermission ? license.attribution : null,
    heroImageKind, heroImageKey,
    sourcePublishedAt: value(candidate, 'source_published_at', 'sourcePublishedAt'),
    publishedAt: now,
  };
  const sectionRows = sections.map((html, index) => ({
    id: makeId(uuid), articleId, index, html,
  }));
  const imageRow = copiedImage ? {
    id: makeId(uuid), articleId, key: copiedImage.key, sourceUrl: remoteImageUrl,
    altText: article.title, sortOrder: 0, createdAt: now,
  } : null;
  const permissionDowngraded = requestedFull && !fullPermission;
  const statements = [
    articleInsert(db, article),
    ...sectionRows.map((section) => sectionInsert(db, section)),
    ...(imageRow ? [imageInsert(db, imageRow)] : []),
    candidateApprove(db, value(candidate, 'id', 'id'), articleId, now),
    auditInsert(db, {
      id: makeId(uuid), adminId, action: 'publish', targetType: 'candidate',
      targetId: value(candidate, 'id', 'id'), batchId: value(candidate, 'batch_id', 'batchId'),
      result: 'published', details: {
        rightsMode: article.rightsMode,
        articleAllowed: fullPermission,
        permissionDowngraded,
        warnings,
      }, createdAt: now,
    }),
  ];

  try {
    await db.batch(statements);
  } catch (error) {
    if (copiedImage) {
      try { await images.delete(copiedImage.key); } catch { /* Preserve the D1 failure. */ }
    }
    throw error;
  }
  return { status: 'published', articleId, slug, warnings };
}

export async function unpublishArticle(env, articleId, context = {}) {
  configured(env);
  const db = env.ITNEW_DB;
  const existing = await articleStatus(db, articleId);
  if (!existing) return { articleId, status: 'not_found' };
  if (existing.status === 'unpublished') return { articleId, status: 'unpublished' };

  const now = publicationTime(context.now);
  const uuid = context.uuid;
  const adminId = stringValue(context.adminId) || 'system';
  await db.batch([
    articleUnpublish(db, articleId),
    auditInsert(db, {
      id: makeId(uuid), adminId, action: 'unpublish', targetType: 'article',
      targetId: articleId, batchId: null, result: 'unpublished',
      details: {}, createdAt: now,
    }),
  ]);
  return { articleId, status: 'unpublished' };
}
