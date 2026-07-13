const MESSAGE_TTL_MS = 60 * 60 * 1000;
const COOLDOWN_MS = 3 * 60 * 1000;
const MAX_TEXT_LENGTH = 200;
const MAX_NICKNAME_LENGTH = 14;
const MAX_BOARD_LENGTH = 64;

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

  await ensureMessagesTable(env.DB);
  await purgeExpired(env.DB);

  if (request.method === 'GET') {
    return handleGet(request, env.DB);
  }
  if (request.method === 'POST') {
    return handlePost(request, env.DB);
  }
  return json({ error: 'method_not_allowed' }, 405);
}

async function ensureMessagesTable(db) {
  await db.prepare(`
    CREATE TABLE IF NOT EXISTS market_messages (
      id TEXT PRIMARY KEY,
      board_symbol TEXT NOT NULL,
      nickname TEXT,
      text TEXT NOT NULL,
      client_id TEXT NOT NULL,
      created_at INTEGER NOT NULL
    )
  `).run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_market_messages_board_created ON market_messages(board_symbol, created_at DESC)').run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_market_messages_client_created ON market_messages(client_id, created_at DESC)').run();
}

async function purgeExpired(db) {
  const cutoff = Date.now() - MESSAGE_TTL_MS;
  await db.prepare('DELETE FROM market_messages WHERE created_at < ?').bind(cutoff).run();
}

async function handleGet(request, db) {
  const url = new URL(request.url);
  const board = cleanBoard(url.searchParams.get('board'));
  if (!board) return json({ error: 'missing_board' }, 400);

  const cutoff = Date.now() - MESSAGE_TTL_MS;
  const result = await db.prepare(`
    SELECT id, board_symbol, nickname, text, created_at
    FROM market_messages
    WHERE board_symbol = ? AND created_at >= ?
    ORDER BY created_at DESC
    LIMIT 50
  `).bind(board, cutoff).all();

  return json({ messages: (result.results || []).map(rowToMessage) });
}

async function handlePost(request, db) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  const board = cleanBoard(body.boardSymbol || body.board || '');
  const text = cleanText(body.text || '');
  const nickname = cleanNickname(body.nickname || '');
  const clientId = cleanClientId(body.clientId || request.headers.get('CF-Connecting-IP') || 'unknown');

  if (!board) return json({ error: 'missing_board' }, 400);
  if (!text) return json({ error: 'empty_text' }, 400);

  const last = await db.prepare(`
    SELECT created_at FROM market_messages
    WHERE client_id = ?
    ORDER BY created_at DESC
    LIMIT 1
  `).bind(clientId).first();

  const now = Date.now();
  if (last && now - Number(last.created_at) < COOLDOWN_MS) {
    const remainingCooldown = Math.ceil((COOLDOWN_MS - (now - Number(last.created_at))) / 1000);
    return json({ error: 'cooldown', remainingCooldown }, 429);
  }

  const id = crypto.randomUUID();
  await db.prepare(`
    INSERT INTO market_messages (id, board_symbol, nickname, text, client_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(id, board, nickname || null, text, clientId, now).run();

  return json({
    message: rowToMessage({ id, board_symbol: board, nickname: nickname || null, text, created_at: now }),
    remainingCooldown: Math.ceil(COOLDOWN_MS / 1000),
  }, 201);
}

function rowToMessage(row) {
  return {
    id: row.id,
    boardSymbol: row.board_symbol,
    nickname: row.nickname || null,
    text: row.text,
    createdAt: Number(row.created_at),
  };
}

function cleanBoard(value) {
  return String(value || '').trim().slice(0, MAX_BOARD_LENGTH).replace(/[^A-Za-z0-9_\-.]/g, '');
}

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT_LENGTH);
}

function cleanNickname(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, MAX_NICKNAME_LENGTH);
}

function cleanClientId(value) {
  return String(value || 'unknown').trim().slice(0, 80) || 'unknown';
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
