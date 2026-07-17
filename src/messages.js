const MESSAGE_TTL_MS = 60 * 60 * 1000;
const COOLDOWN_MS = 3 * 60 * 1000;
const MAX_NICKNAME_LENGTH = 14;
const REPORT_REASONS = new Set([
  'spam', 'harassment', 'sexual_or_violent', 'personal_information', 'scam', 'other',
]);

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Cache-Control': 'no-store',
};

export async function handleMessages(request, env) {
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const url = new URL(request.url);
  const reportMatch = url.pathname.match(/^\/markets\/messages\/([^/]+)\/reports$/);
  if (reportMatch) {
    if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
    return handleReport(request, env, decodePathSegment(reportMatch[1]));
  }

  if (request.method === 'GET') return handleGet(request, env);
  if (request.method === 'POST') return handlePost(request, env);
  return json({ error: 'method_not_allowed' }, 405);
}

export function normalizeRoomId(value) {
  const room = String(value || '').trim();
  return /^[A-Za-z0-9_.-]{1,64}$/.test(room) ? room : '';
}

export function classifyText(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  if (!text) return { allowed: false, code: 'empty_text', text: '' };
  if (/(https?:\/\/|www\.|\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b)/i.test(text)) return { allowed: false, code: 'external_contact', text };
  if (/(微信|vx|telegram|whatsapp|加群|私聊|保证收益|稳赚|带单|跟单|转账|充值)/i.test(text)) return { allowed: false, code: 'unsafe_financial_solicitation', text };
  if (/(色情|裸聊|强奸|杀了你|去死)/i.test(text)) return { allowed: false, code: 'objectionable_content', text };
  return { allowed: true, code: null, text };
}

export function toPublicMessage(row) {
  return {
    id: row.id,
    roomId: row.room_id,
    nickname: row.nickname || null,
    text: row.text,
    createdAt: Number(row.created_at),
    expiresAt: Number(row.expires_at),
    authorKey: row.author_key,
  };
}

async function handleGet(request, env) {
  const url = new URL(request.url);
  const room = normalizeRoomId(url.searchParams.get('room') || url.searchParams.get('roomId'));
  if (!room) return json({ error: 'missing_room' }, 400);

  const result = await env.DB.prepare(`
    SELECT id, room_id, nickname, text, author_key, created_at, expires_at
    FROM market_messages
    WHERE room_id = ? AND status = ? AND expires_at > ?
    ORDER BY created_at DESC
    LIMIT 50
  `).bind(room, 'active', nowFor(env)).all();

  return json({ messages: (result.results || []).map(toPublicMessage) });
}

async function handlePost(request, env) {
  const body = await parseJson(request);
  if (!body) return json({ error: 'invalid_json' }, 400);
  if (!hasIdentityConfiguration(env)) return json({ error: 'identity_configuration_unavailable' }, 503);

  const room = normalizeRoomId(body.roomId ?? body.boardSymbol);
  const classifiedText = classifyText(body.text);
  const nickname = cleanNickname(body.nickname);
  const clientId = cleanClientId(body.clientId);

  if (!clientId) return json({ error: 'missing_guest_identity' }, 400);
  if (!room) return json({ error: 'missing_room' }, 400);
  if (!classifiedText.allowed) {
    return json({ error: classifiedText.code }, classifiedText.code === 'empty_text' ? 400 : 422);
  }

  const authorHash = await hashGuestId(clientId, env.AUTHOR_HASH_SALT);
  const banned = await env.DB.prepare(
    'SELECT 1 FROM market_banned_authors WHERE author_hash = ? LIMIT 1',
  ).bind(authorHash).first();
  if (banned) return json({ error: 'author_banned' }, 403);

  const authorKey = await authorKeyFor(clientId, env.AUTHOR_KEY_SECRET);
  const now = nowFor(env);
  await purgeExpired(env.DB, now);
  const id = crypto.randomUUID();
  const expiresAt = now + MESSAGE_TTL_MS;
  const cooldownCutoff = now - COOLDOWN_MS;
  const insertResult = await env.DB.prepare(`
    INSERT INTO market_messages (id, room_id, nickname, text, author_hash, author_key, status, created_at, expires_at)
    SELECT ?, ?, ?, ?, ?, ?, 'active', ?, ?
    WHERE NOT EXISTS (
      SELECT 1 FROM market_messages
      WHERE author_hash = ? AND room_id = ? AND created_at > ?
    )
  `).bind(
    id, room, nickname || null, classifiedText.text, authorHash, authorKey, now, expiresAt,
    authorHash, room, cooldownCutoff,
  ).run();

  if (Number(insertResult.meta?.changes) === 0) {
    const last = await env.DB.prepare(`
      SELECT created_at FROM market_messages
      WHERE author_hash = ? AND room_id = ?
      ORDER BY created_at DESC
      LIMIT 1
    `).bind(authorHash, room).first();
    const elapsed = last ? now - Number(last.created_at) : COOLDOWN_MS;
    const remainingCooldown = Math.max(0, Math.ceil((COOLDOWN_MS - elapsed) / 1000));
    return json({ error: 'cooldown', remainingCooldown }, 429);
  }

  return json({
    message: toPublicMessage({
      id, room_id: room, nickname: nickname || null, text: classifiedText.text,
      created_at: now, expires_at: expiresAt, author_key: authorKey,
    }),
    remainingCooldown: Math.ceil(COOLDOWN_MS / 1000),
  }, 201);
}

async function handleReport(request, env, messageId) {
  const body = await parseJson(request);
  if (!body) return json({ error: 'invalid_json' }, 400);
  if (!hasIdentityConfiguration(env)) return json({ error: 'identity_configuration_unavailable' }, 503);

  const reporterId = cleanReporterId(body.reporterId);
  const reason = typeof body.reason === 'string' ? body.reason : '';
  const note = cleanNote(body.note);
  if (!messageId || !reporterId || !REPORT_REASONS.has(reason)) return json({ error: 'invalid_report' }, 400);

  const message = await env.DB.prepare(
    'SELECT id, status FROM market_messages WHERE id = ? LIMIT 1',
  ).bind(messageId).first();
  if (!message) return json({ error: 'message_not_found' }, 404);

  const now = nowFor(env);
  const reporterHash = await hashGuestId(reporterId, env.AUTHOR_HASH_SALT);
  const reportResult = await env.DB.prepare(`
    INSERT INTO market_reports (id, message_id, reporter_hash, reason, note, status, created_at)
    VALUES (?, ?, ?, ?, ?, 'open', ?)
    ON CONFLICT(message_id, reporter_hash) DO NOTHING
  `).bind(crypto.randomUUID(), messageId, reporterHash, reason, note, now).run();
  const countRow = await env.DB.prepare(`
    SELECT COUNT(*) AS count FROM market_reports
    WHERE message_id = ? AND status = 'open'
  `).bind(messageId).first();

  let hidden = false;
  if (Number(countRow?.count) >= 3) {
    hidden = await autoHideAfterReports(env.DB, messageId, now);
  }

  const finalMessage = await env.DB.prepare(
    'SELECT id, status FROM market_messages WHERE id = ? LIMIT 1',
  ).bind(messageId).first();

  return json({
    report: { messageId, reason, openReports: Number(countRow?.count) || 0 },
    messageStatus: finalMessage?.status || (hidden ? 'hidden' : message.status),
  }, Number(reportResult.meta?.changes) > 0 ? 201 : 200);
}

async function purgeExpired(db, now) {
  await db.prepare('DELETE FROM market_messages WHERE expires_at < ?').bind(now).run();
}

async function recordModerationAction(db, targetType, targetId, action, note, now) {
  await db.prepare(`
    INSERT INTO market_moderation_actions (id, target_type, target_id, action, note, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(crypto.randomUUID(), targetType, targetId, action, note, now).run();
}

async function autoHideAfterReports(db, messageId, now) {
  const update = db.prepare(`
    UPDATE market_messages
    SET status = 'hidden', hidden_at = ?
    WHERE id = ? AND status = 'active'
  `).bind(now, messageId);

  if (typeof db.batch === 'function') {
    const results = await db.batch([
      update,
      db.prepare(`
        INSERT INTO market_moderation_actions (id, target_type, target_id, action, note, created_at)
        SELECT ?, ?, ?, ?, ?, ? WHERE changes() = 1
      `).bind(crypto.randomUUID(), 'message', messageId, 'auto_hidden_after_reports', null, now),
    ]);
    return Number(results[0]?.meta?.changes) > 0;
  }

  const result = await update.run();
  if (Number(result.meta?.changes) === 0) return false;
  await recordModerationAction(db, 'message', messageId, 'auto_hidden_after_reports', null, now);
  return true;
}

async function hashGuestId(guestId, salt) {
  return sha256(`${String(salt || '')}:${guestId}`);
}

async function authorKeyFor(guestId, secret) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(String(secret || '')),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(guestId));
  return bytesToHex(signature);
}

async function sha256(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return bytesToHex(digest);
}

function bytesToHex(buffer) {
  return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function cleanNickname(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, MAX_NICKNAME_LENGTH);
}

function cleanClientId(value) {
  if (typeof value !== 'string') return '';
  const clientId = value.trim();
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{7,79}$/.test(clientId) ? clientId : '';
}

function cleanReporterId(value) {
  if (typeof value !== 'string') return '';
  const reporterId = value.trim();
  return reporterId.length > 0 && reporterId.length <= 128 ? reporterId : '';
}

function cleanNote(value) {
  if (typeof value !== 'string') return null;
  const note = value.replace(/\s+/g, ' ').trim().slice(0, 500);
  return note || null;
}

function hasIdentityConfiguration(env) {
  return isConfiguredSecret(env.AUTHOR_HASH_SALT) && isConfiguredSecret(env.AUTHOR_KEY_SECRET);
}

function isConfiguredSecret(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

async function parseJson(request) {
  try {
    const body = await request.json();
    return body && typeof body === 'object' && !Array.isArray(body) ? body : null;
  } catch {
    return null;
  }
}

function decodePathSegment(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return '';
  }
}

function nowFor(env) {
  const candidate = typeof env.NOW === 'function' ? env.NOW() : env.NOW;
  return Number.isFinite(candidate) ? Number(candidate) : Date.now();
}

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json; charset=utf-8',
    },
  });
}
