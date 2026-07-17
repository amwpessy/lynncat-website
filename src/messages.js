const MESSAGE_TTL_MS = 60 * 60 * 1000;
const COOLDOWN_MS = 3 * 60 * 1000;
const MAX_NICKNAME_LENGTH = 14;

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

  if (request.method === 'GET') {
    await purgeExpired(env.DB);
    return handleGet(request, env.DB);
  }
  if (request.method === 'POST') {
    return handlePost(request, env);
  }
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

async function purgeExpired(db) {
  await db.prepare('DELETE FROM market_messages WHERE expires_at < ?').bind(Date.now()).run();
}

async function handleGet(request, db) {
  const url = new URL(request.url);
  const room = normalizeRoomId(url.searchParams.get('room') || url.searchParams.get('roomId'));
  if (!room) return json({ error: 'missing_room' }, 400);

  const result = await db.prepare(`
    SELECT id, room_id, nickname, text, created_at, expires_at, author_key
    FROM market_messages
    WHERE room_id = ? AND status = 'active' AND expires_at >= ?
    ORDER BY created_at DESC
    LIMIT 50
  `).bind(room, Date.now()).all();

  return json({ messages: (result.results || []).map(toPublicMessage) });
}

async function handlePost(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  if (!hasIdentityConfiguration(env)) {
    return json({ error: 'identity_configuration_unavailable' }, 503);
  }

  const room = normalizeRoomId(body.roomId || body.room || '');
  const classifiedText = classifyText(body.text || '');
  const nickname = cleanNickname(body.nickname || '');
  const clientId = cleanClientId(body.clientId);

  if (!clientId) return json({ error: 'missing_guest_identity' }, 400);
  if (!room) return json({ error: 'missing_room' }, 400);
  if (!classifiedText.allowed) return json({ error: classifiedText.code }, 400);

  await purgeExpired(env.DB);

  const authorHash = await hashGuestId(clientId, env.AUTHOR_HASH_SALT);
  const authorKey = await authorKeyFor(clientId, env.AUTHOR_KEY_SECRET);
  const now = Date.now();
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

function hasIdentityConfiguration(env) {
  return isConfiguredSecret(env.AUTHOR_HASH_SALT) && isConfiguredSecret(env.AUTHOR_KEY_SECRET);
}

function isConfiguredSecret(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function cleanClientId(value) {
  if (typeof value !== 'string') return '';
  const clientId = value.trim();
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{7,79}$/.test(clientId) ? clientId : '';
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
