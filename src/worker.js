import { handleSina } from './sina.js';
import { handleNewsFetch, runNewsFetch } from './newsFetch.js';
import { handleMessages } from './messages.js';
import { handleItnewRequest, runItnewCollection } from './itnew/index.js';

const MESSAGE_STATUSES = new Set(['active', 'hidden', 'removed']);
const AUTHOR_ACTIONS = new Set(['ban', 'unban']);
const REPORT_STATUSES = new Set(['open', 'resolved', 'dismissed']);
const PRIVATE_ASSET_PREFIXES = ['/src/', '/test/', '/dist/', '/.git/', '/.claude/', '/.openai/', '/.wrangler/'];
const PRIVATE_ASSET_PATHS = new Set([
  '/.DS_Store', '/.dev.vars', '/.assetsignore', '/.gitignore', '/README.md', '/wrangler.toml',
]);

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (isPrivateAssetPath(url.pathname)) return new Response('Not found', { status: 404 });

    if (url.pathname === '/xxxc/sina') return handleSina(request);
    if (url.pathname === '/news/fetch') return handleNewsFetch(request, env);
    if (url.pathname === '/markets/messages' || /^\/markets\/messages\/[^/]+\/reports$/.test(url.pathname)) {
      return handleMessages(request, env);
    }

    if (url.pathname.startsWith('/markets/moderation')) {
      if (!requireModerator(request, env)) return authenticationRequired();
      if (url.pathname === '/markets/moderation') {
        return env.ASSETS.fetch(new Request(new URL('/markets/moderation.html', url), request));
      }
      return handleModeration(request, env);
    }

    if (url.pathname === '/itnew' || url.pathname.startsWith('/itnew/')) {
      return handleItnewRequest(request, env, ctx);
    }

    return env.ASSETS.fetch(request);
  },

  async scheduled(event, env, ctx) {
    runScheduledJobs(env, ctx.waitUntil.bind(ctx));
  },
};

function boundedErrorText(value, fallback) {
  return typeof value === 'string' && value ? value.slice(0, 500) : fallback;
}

export function safeError(error) {
  let name;
  let message;
  try {
    name = error?.name;
    message = error?.message;
  } catch {
    return { name: 'Error', message: 'Unknown error' };
  }
  if (typeof error === 'string') message = error;
  return {
    name: boundedErrorText(name, 'Error'),
    message: boundedErrorText(message, 'Unknown error'),
  };
}

function guardedScheduledJob(label, job, env) {
  let result;
  try {
    result = job(env);
  } catch (error) {
    result = Promise.reject(error);
  }
  return Promise.resolve(result).catch((error) => {
    console.error(label, safeError(error));
  });
}

export function runScheduledJobs(
  env,
  waitUntil,
  jobs = { runNewsFetch, runItnewCollection },
) {
  const newsPromise = guardedScheduledJob('news_fetch_failed', jobs.runNewsFetch, env);
  const itnewPromise = guardedScheduledJob(
    'itnew_collection_failed', jobs.runItnewCollection, env,
  );
  waitUntil(newsPromise);
  waitUntil(itnewPromise);
}

export function isPrivateAssetPath(pathname) {
  return PRIVATE_ASSET_PATHS.has(pathname)
    || pathname.endsWith('/.DS_Store')
    || PRIVATE_ASSET_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

export function requireModerator(request, env) {
  if (!isConfiguredSecret(env.MODERATION_USERNAME) || !isConfiguredSecret(env.MODERATION_PASSWORD)) return false;
  const authorization = request.headers.get('Authorization');
  const match = authorization?.match(/^Basic\s+(.+)$/i);
  if (!match) return false;

  try {
    const [username, ...passwordParts] = atob(match[1]).split(':');
    return moderatorCredentialsMatch(
      username,
      passwordParts.join(':'),
      env.MODERATION_USERNAME,
      env.MODERATION_PASSWORD,
    );
  } catch {
    return false;
  }
}

export function moderatorCredentialsMatch(username, password, expectedUsername, expectedPassword, compare = constantTimeEqual) {
  const usernameMatches = compare(username, expectedUsername);
  const passwordMatches = compare(password, expectedPassword);
  return usernameMatches && passwordMatches;
}

export async function handleModeration(request, env) {
  if (!requireModerator(request, env)) return authenticationRequired();

  const url = new URL(request.url);
  if (request.method === 'GET' && url.pathname === '/markets/moderation/api/reports') {
    const status = url.searchParams.get('status') || 'open';
    if (!REPORT_STATUSES.has(status)) return json({ error: 'invalid_report_status' }, 400);
    return listReports(env.DB, status);
  }

  const messageMatch = url.pathname.match(/^\/markets\/moderation\/api\/messages\/([^/]+)$/);
  if (request.method === 'PUT' && messageMatch) {
    return updateMessage(env.DB, decodePathSegment(messageMatch[1]), request, nowFor(env));
  }

  const authorMatch = url.pathname.match(/^\/markets\/moderation\/api\/authors\/([^/]+)$/);
  if (request.method === 'PUT' && authorMatch) {
    return updateAuthor(env.DB, decodePathSegment(authorMatch[1]), request, nowFor(env));
  }

  return json({ error: 'not_found' }, 404);
}

async function listReports(db, status) {
  const result = await db.prepare(`
    SELECT r.id, r.message_id, r.reporter_hash, r.reason, r.note, r.status, r.created_at,
      m.room_id, m.nickname, m.text, m.author_key, m.author_hash, m.status AS message_status
    FROM market_reports r
    LEFT JOIN market_messages m ON m.id = r.message_id
    WHERE r.status = ?
    ORDER BY r.created_at DESC
    LIMIT 200
  `).bind(status).all();
  return json({ reports: result.results || [] });
}

async function updateMessage(db, messageId, request, now) {
  const body = await parseJson(request);
  const status = body?.status;
  if (!messageId || !MESSAGE_STATUSES.has(status)) return json({ error: 'invalid_message_status' }, 400);

  const updatedColumn = status === 'hidden' ? 'hidden_at' : status === 'removed' ? 'removed_at' : null;
  const statement = updatedColumn
    ? `UPDATE market_messages SET status = ?, ${updatedColumn} = ? WHERE id = ?`
    : 'UPDATE market_messages SET status = ? WHERE id = ?';
  const bindings = updatedColumn ? [status, now, messageId] : [status, messageId];
  const update = db.prepare(statement).bind(...bindings);
  const action = db.prepare(`
    INSERT INTO market_moderation_actions (id, target_type, target_id, action, note, created_at)
    SELECT ?, ?, ?, ?, ?, ? WHERE changes() = 1
  `).bind(crypto.randomUUID(), 'message', messageId, `message_${status}`, cleanNote(body.note), now);
  const [result] = await db.batch([update, action]);
  if (Number(result.meta?.changes) === 0) return json({ error: 'message_not_found' }, 404);

  return json({ messageId, status });
}

async function updateAuthor(db, authorKey, request, now) {
  const body = await parseJson(request);
  const action = body?.action;
  if (!authorKey || !AUTHOR_ACTIONS.has(action)) return json({ error: 'invalid_author_action' }, 400);

  const result = await db.prepare(
    'SELECT DISTINCT author_hash FROM market_messages WHERE author_key = ?',
  ).bind(authorKey).all();
  const authorHashes = (result.results || []).map((row) => row.author_hash).filter(Boolean);
  if (authorHashes.length === 0) return json({ error: 'author_not_found' }, 404);

  const note = cleanNote(body.note);
  const authorMutations = authorHashes.map((authorHash) => {
    if (action === 'ban') {
      return db.prepare(`
        INSERT INTO market_banned_authors (author_hash, banned_at, note)
        VALUES (?, ?, ?)
        ON CONFLICT(author_hash) DO UPDATE SET banned_at = excluded.banned_at, note = excluded.note
      `).bind(authorHash, now, note);
    } else {
      return db.prepare('DELETE FROM market_banned_authors WHERE author_hash = ?').bind(authorHash);
    }
  });

  await db.batch([
    ...authorMutations,
    moderationActionStatement(db, 'author', authorKey, `author_${action}ned`, note, now),
  ]);
  return json({ authorKey, action, affectedAuthors: authorHashes.length });
}

function moderationActionStatement(db, targetType, targetId, action, note, now) {
  return db.prepare(`
    INSERT INTO market_moderation_actions (id, target_type, target_id, action, note, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).bind(crypto.randomUUID(), targetType, targetId, action, note, now);
}

function authenticationRequired() {
  return new Response('Authentication required', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="Lynncat moderation", charset="UTF-8"' },
  });
}

function constantTimeEqual(left, right) {
  const leftBytes = new TextEncoder().encode(String(left));
  const rightBytes = new TextEncoder().encode(String(right));
  const length = Math.max(leftBytes.length, rightBytes.length);
  let difference = leftBytes.length ^ rightBytes.length;
  for (let index = 0; index < length; index += 1) {
    difference |= (leftBytes[index] || 0) ^ (rightBytes[index] || 0);
  }
  return difference === 0;
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

function cleanNote(value) {
  if (typeof value !== 'string') return null;
  const note = value.replace(/\s+/g, ' ').trim().slice(0, 500);
  return note || null;
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
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
