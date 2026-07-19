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
  if (/<img\b[^>]*\ssrc="\/itnew\/(?:images|assets\/fallback)\//i.test(html)) return true;
  return html.replace(/<[^>]*>/g, '').replaceAll('\u00a0', ' ').trim().length > 0;
}

function sourceCurrent(db, sourceId) {
  return db.prepare(`
    /* itnew:publisher_source_current */
    SELECT id, rights_mode, homepage_url, feed_url
    FROM itnew_sources
    WHERE id = ?
    LIMIT 1
  `).bind(sourceId).first();
}

function candidateCurrent(db, candidateId) {
  return db.prepare(`
    /* itnew:publisher_candidate_current */
    SELECT *
    FROM itnew_candidates
    WHERE id = ?
    LIMIT 1
  `).bind(candidateId).first();
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

function imageKeyReference(db, key) {
  return db.prepare(`
    /* itnew:publisher_image_key_reference */
    SELECT 1 AS referenced
    FROM itnew_articles
    WHERE hero_image_kind = 'r2' AND hero_image_key = ?
    LIMIT 1
  `).bind(key).first();
}

function articleInsert(db, article) {
  return db.prepare(`
    /* itnew:publisher_article_insert */
    INSERT INTO itnew_articles (
      id, candidate_id, slug, source_id, canonical_url, title, summary, language, category,
      rights_mode, article_permission_verified, license_name, license_url,
      attribution_text, hero_image_kind, hero_image_key, source_published_at,
      published_at, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    article.id, article.candidateId, article.slug, article.sourceId, article.canonicalUrl,
    article.title, article.summary, article.language, article.category,
    article.rightsMode, article.articlePermissionVerified, article.licenseName,
    article.licenseUrl, article.attributionText, article.heroImageKind,
    article.heroImageKey, article.sourcePublishedAt, article.publishedAt, 'published',
  );
}

function isCandidateClaimConflict(error) {
  const message = String(error?.message ?? error);
  return /itnew_candidate_not_publishable|UNIQUE constraint failed:\s*itnew_articles\.candidate_id/i
    .test(message);
}

async function candidateResult(db, candidate) {
  const articleId = value(candidate, 'article_id', 'articleId');
  if (candidate?.status === 'approved' && articleId) {
    const existing = await articleReference(db, articleId);
    if (existing) {
      return { status: existing.status === 'unpublished' ? 'unpublished' : 'published',
        articleId: existing.id, slug: existing.slug, warnings: [] };
    }
    return { status: 'candidate_conflict', articleId, slug: null, warnings: [] };
  }
  return null;
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

function processingErrorAuditInsert(db, audit) {
  return db.prepare(`
    /* itnew:publisher_processing_error_audit */
    INSERT INTO itnew_audit_log (
      id, admin_id, action, target_type, target_id, batch_id,
      result, details_json, created_at
    )
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
    WHERE changes() = 1
  `).bind(
    audit.id, audit.adminId, 'publish', 'candidate', audit.candidateId,
    audit.batchId, 'processing_error', JSON.stringify({ error: audit.code }), audit.createdAt,
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

function unpublishAuditInsert(db, audit) {
  return db.prepare(`
    /* itnew:publisher_unpublish_audit */
    INSERT INTO itnew_audit_log (
      id, admin_id, action, target_type, target_id, batch_id,
      result, details_json, created_at
    )
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
    WHERE changes() = 1
  `).bind(
    audit.id, audit.adminId, 'unpublish', 'article', audit.articleId,
    null, 'unpublished', '{}', audit.createdAt,
  );
}

async function recordProcessingError(db, candidate, code, now, uuid, adminId) {
  const candidateId = value(candidate, 'id', 'id');
  const results = await db.batch([
    candidateError(db, candidateId, code, now),
    processingErrorAuditInsert(db, {
      id: makeId(uuid), adminId, candidateId,
      batchId: value(candidate, 'batch_id', 'batchId'), code, createdAt: now,
    }),
  ]);
  const changed = Number(results[0]?.meta?.changes ?? results[0]?.changes ?? 0);
  if (changed === 0) {
    const current = await candidateCurrent(db, candidateId);
    if (!current) return { status: 'not_found', articleId: null, slug: null, warnings: [] };
    const winner = await candidateResult(db, current);
    return winner ?? { status: 'candidate_conflict', articleId: null, slug: null, warnings: [] };
  }
  return { status: 'processing_error', articleId: null, slug: null, warnings: [code] };
}

function responseHeader(response, name) {
  return response?.headers?.get?.(name) ?? null;
}

function isIpLiteral(hostname) {
  return hostname.includes(':') || /^\d+(?:\.\d+){3}$/.test(hostname);
}

function isPrivateName(hostname) {
  return !hostname.includes('.') || hostname === 'localhost'
    || hostname.endsWith('.localhost') || hostname.endsWith('.local')
    || hostname.endsWith('.internal') || hostname.endsWith('.lan')
    || hostname.endsWith('.home') || hostname.endsWith('.home.arpa');
}

function hostnameFrom(value) {
  try { return new URL(value).hostname.toLowerCase().replace(/\.$/, ''); } catch { return ''; }
}

function sameOrSubdomain(hostname, base) {
  return Boolean(base) && (hostname === base || hostname.endsWith(`.${base}`));
}

function permittedImageUrl(url, canonicalUrl, source) {
  const parsed = new URL(url);
  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, '');
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port
    || isIpLiteral(hostname) || isPrivateName(hostname)) throw new Error('image_url_invalid');
  const bases = [canonicalUrl, source?.homepage_url, source?.feed_url]
    .map(hostnameFrom).filter(Boolean);
  if (!bases.some((base) => sameOrSubdomain(hostname, base))) {
    throw new Error('image_host_not_permitted');
  }
  return parsed;
}

async function boundedImageBytes(response) {
  const reader = response?.body?.getReader?.();
  if (!reader) throw new Error('image_body_unavailable');
  const chunks = [];
  let total = 0;
  let completed = false;
  try {
    while (true) {
      const { done, value: chunk } = await reader.read();
      if (done) {
        completed = true;
        break;
      }
      const bytes = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
      total += bytes.byteLength;
      if (total > IMAGE_MAX_BYTES) throw new Error('image_too_large');
      chunks.push(bytes);
    }
  } catch (error) {
    if (!completed) {
      try { await reader.cancel(); } catch { /* Keep the bounded-read error. */ }
    }
    throw error;
  } finally {
    try { reader.releaseLock?.(); } catch { /* Nothing else uses this response. */ }
  }

  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return combined;
}

async function cancelImageBody(response) {
  try {
    if (typeof response?.body?.cancel === 'function') await response.body.cancel();
    else await response?.body?.getReader?.().cancel();
  } catch { /* Rejection remains a safe image fallback. */ }
}

function startsWith(bytes, signature) {
  return bytes.byteLength >= signature.length
    && signature.every((byte, index) => bytes[index] === byte);
}

function ascii(bytes, start, length) {
  if (bytes.byteLength < start + length) return '';
  return String.fromCharCode(...bytes.subarray(start, start + length));
}

function hasRasterSignature(contentType, bytes) {
  switch (contentType) {
    case 'image/jpeg':
      return startsWith(bytes, [0xff, 0xd8, 0xff]);
    case 'image/png':
      return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case 'image/gif':
      return ascii(bytes, 0, 6) === 'GIF87a' || ascii(bytes, 0, 6) === 'GIF89a';
    case 'image/webp':
      return ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP';
    case 'image/avif': {
      if (ascii(bytes, 4, 4) !== 'ftyp') return false;
      for (let offset = 8; offset + 4 <= bytes.byteLength; offset += 4) {
        const brand = ascii(bytes, offset, 4);
        if (brand === 'avif' || brand === 'avis') return true;
      }
      return false;
    }
    default:
      return false;
  }
}

async function copyHeroImage(images, url, articleId, fetchImpl, policy) {
  const parsed = permittedImageUrl(url, policy.canonicalUrl, policy.source);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), IMAGE_TIMEOUT_MS);
  try {
    const response = await fetchImpl(parsed.href, { signal: controller.signal, redirect: 'manual' });
    if (response?.status >= 300 && response.status < 400) throw new Error('image_redirect_denied');
    if (!response?.ok) throw new Error('image_http_failed');
    const contentType = String(responseHeader(response, 'content-type') ?? '')
      .split(';', 1)[0].trim().toLowerCase();
    const extension = IMAGE_TYPES.get(contentType);
    if (!extension) throw new Error('image_type_not_allowed');
    const contentLength = Number(responseHeader(response, 'content-length'));
    if (Number.isFinite(contentLength) && contentLength > IMAGE_MAX_BYTES) {
      await cancelImageBody(response);
      throw new Error('image_too_large');
    }
    const bytes = await boundedImageBytes(response);
    if (!hasRasterSignature(contentType, bytes)) throw new Error('image_signature_mismatch');
    const key = `articles/${articleId}/${await sha256Hex(bytes)}.${extension}`;
    const preexisting = Boolean(await images.head(key));
    await images.put(key, bytes, { httpMetadata: { contentType } });
    return { key, contentType, preexisting };
  } finally {
    clearTimeout(timeout);
  }
}

async function cleanupCopiedImage(db, images, copiedImage) {
  if (!copiedImage || copiedImage.preexisting) return;
  try {
    const referenced = await imageKeyReference(db, copiedImage.key);
    if (!referenced) await images.delete(copiedImage.key);
  } catch { /* Preserve the D1 failure and any potentially shared object. */ }
}

export async function publishCandidate(env, candidate, context = {}) {
  configured(env);
  const db = env.ITNEW_DB;
  const images = env.ITNEW_IMAGES;
  const now = publicationTime(context.now);
  const uuid = context.uuid;
  const fetchImpl = context.fetchImpl || fetch;
  const adminId = stringValue(context.adminId) || 'system';
  const candidateId = value(candidate, 'id', 'id');
  candidate = await candidateCurrent(db, candidateId);
  if (!candidate) {
    return { status: 'not_found', articleId: null, slug: null, warnings: [] };
  }
  const existingResult = await candidateResult(db, candidate);
  if (existingResult) return existingResult;
  const status = value(candidate, 'status', 'status');
  if (status !== 'pending' && status !== 'processing_error') {
    return { status: 'candidate_conflict', articleId: null, slug: null, warnings: [] };
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
      copiedImage = await copyHeroImage(images, remoteImageUrl, articleId, fetchImpl, {
        canonicalUrl, source,
      });
      heroImageKind = 'r2';
      heroImageKey = copiedImage.key;
    } catch {
      warnings.push('image_copy_failed');
    }
  }

  const article = {
    id: articleId, candidateId, slug, sourceId, canonicalUrl,
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
    await cleanupCopiedImage(db, images, copiedImage);
    if (isCandidateClaimConflict(error)) {
      const current = await candidateCurrent(db, candidateId);
      const winner = await candidateResult(db, current);
      return winner ?? { status: 'candidate_conflict', articleId: null, slug: null, warnings: [] };
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
  const results = await db.batch([
    articleUnpublish(db, articleId),
    unpublishAuditInsert(db, {
      id: makeId(uuid), adminId, articleId, createdAt: now,
    }),
  ]);
  const changed = Number(results[0]?.meta?.changes ?? results[0]?.changes ?? 0);
  if (changed === 0) return { articleId, status: 'unpublished' };
  return { articleId, status: 'unpublished' };
}
