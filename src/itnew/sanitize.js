const ALLOWED_TAGS = new Set([
  'p', 'h2', 'h3', 'h4', 'blockquote', 'pre', 'code', 'ul', 'ol', 'li',
  'strong', 'em', 'a', 'img', 'figure', 'figcaption', 'br', 'hr',
]);

const BLOCKED_TAGS = new Set([
  'script', 'style', 'iframe', 'form', 'svg', 'math', 'object', 'embed', 'template',
]);

const VOID_TAGS = new Set(['img', 'br', 'hr']);
const encoder = new TextEncoder();

const NAMED_ENTITIES = new Map([
  ['amp', '&'],
  ['apos', "'"],
  ['gt', '>'],
  ['lt', '<'],
  ['nbsp', '\u00a0'],
  ['quot', '"'],
]);

function isAsciiLetter(character) {
  return (character >= 'A' && character <= 'Z') || (character >= 'a' && character <= 'z');
}

function isTagNameCharacter(character) {
  return isAsciiLetter(character)
    || (character >= '0' && character <= '9')
    || character === ':' || character === '-';
}

function isWhitespace(character) {
  return character === ' ' || character === '\n' || character === '\r'
    || character === '\t' || character === '\f';
}

function findMarkupEnd(html, start) {
  let quote = null;
  for (let index = start; index < html.length; index += 1) {
    const character = html[index];
    if (quote) {
      if (character === quote) quote = null;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === '>') {
      return index;
    }
  }
  return -1;
}

// Reads one tag-like token without assuming that quoted attribute values are well formed.
function readMarkup(html, start) {
  if (html.startsWith('<!--', start)) {
    const commentEnd = html.indexOf('-->', start + 4);
    return { type: 'discard', end: commentEnd < 0 ? html.length : commentEnd + 3 };
  }

  let cursor = start + 1;
  if (html[cursor] === '!' || html[cursor] === '?') {
    const end = findMarkupEnd(html, cursor + 1);
    return end < 0
      ? { type: 'text_suffix', end: html.length }
      : { type: 'discard', end: end + 1 };
  }

  let closing = false;
  if (html[cursor] === '/') {
    closing = true;
    cursor += 1;
  }
  if (!isAsciiLetter(html[cursor])) return null;

  const nameStart = cursor;
  while (cursor < html.length && isTagNameCharacter(html[cursor])) cursor += 1;
  const name = html.slice(nameStart, cursor).toLowerCase();
  const end = findMarkupEnd(html, cursor);
  if (end < 0) return { type: 'text_suffix', end: html.length };

  let contentEnd = end;
  while (contentEnd > cursor && isWhitespace(html[contentEnd - 1])) contentEnd -= 1;
  const selfClosing = !closing && html[contentEnd - 1] === '/';
  if (selfClosing) {
    contentEnd -= 1;
    while (contentEnd > cursor && isWhitespace(html[contentEnd - 1])) contentEnd -= 1;
  }

  return {
    type: closing ? 'end' : 'start',
    name,
    attributes: closing ? '' : html.slice(cursor, contentEnd),
    selfClosing,
    end: end + 1,
  };
}

function normalizeScalars(value) {
  let normalized = '';
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    normalized += codePoint === 0 || (codePoint >= 0xd800 && codePoint <= 0xdfff)
      ? '\ufffd'
      : character;
  }
  return normalized;
}

function decodeEntities(value) {
  return value.replace(/&(#(?:x[0-9a-f]+|[0-9]+)|[a-z]+);/gi, (entity, body) => {
    if (body[0] !== '#') return NAMED_ENTITIES.get(body.toLowerCase()) ?? entity;

    const hexadecimal = body[1]?.toLowerCase() === 'x';
    const codePoint = Number.parseInt(body.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
    if (!Number.isInteger(codePoint) || codePoint <= 0 || codePoint > 0x10ffff
      || (codePoint >= 0xd800 && codePoint <= 0xdfff)) return entity;
    return String.fromCodePoint(codePoint);
  });
}

function normalizeValue(value) {
  return normalizeScalars(decodeEntities(value));
}

function escapeText(value) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function escapeAttribute(value) {
  return escapeText(value).replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}

function parseAttributes(source) {
  const attributes = new Map();
  let cursor = 0;

  while (cursor < source.length) {
    while (cursor < source.length && isWhitespace(source[cursor])) cursor += 1;
    if (cursor >= source.length) break;

    const nameStart = cursor;
    while (cursor < source.length && !isWhitespace(source[cursor])
      && source[cursor] !== '=' && source[cursor] !== '/') cursor += 1;
    const rawName = source.slice(nameStart, cursor);

    while (cursor < source.length && isWhitespace(source[cursor])) cursor += 1;
    let value = null;
    if (source[cursor] === '=') {
      cursor += 1;
      while (cursor < source.length && isWhitespace(source[cursor])) cursor += 1;
      if (source[cursor] === '"' || source[cursor] === "'") {
        const quote = source[cursor];
        cursor += 1;
        const valueStart = cursor;
        while (cursor < source.length && source[cursor] !== quote) cursor += 1;
        value = source.slice(valueStart, cursor);
        if (source[cursor] === quote) cursor += 1;
      } else {
        const valueStart = cursor;
        while (cursor < source.length && !isWhitespace(source[cursor])) cursor += 1;
        value = source.slice(valueStart, cursor);
      }
    }

    if (/^[A-Za-z][A-Za-z0-9_-]*$/.test(rawName)) {
      const name = rawName.toLowerCase();
      if (!attributes.has(name)) attributes.set(name, value === null ? null : normalizeValue(value));
    }

    if (cursor === nameStart) cursor += 1;
  }
  return attributes;
}

function safeLink(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

function safeImagePath(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return null;
  if (/%25/i.test(value) || /[\u0000-\u001f\u007f-\u009f]/.test(value)) return null;
  const rawPath = value.split(/[?#]/, 1)[0];
  if (/%(?:0[0-9a-f]|1[0-9a-f]|2e|2f|5c|7f)/i.test(rawPath) || rawPath.includes('\\')) {
    return null;
  }
  try {
    const decodedRawPath = decodeURIComponent(rawPath);
    if (/[\u0000-\u001f\u007f-\u009f\\]/.test(decodedRawPath)
      || decodedRawPath.split('/').some((segment) => segment === '.' || segment === '..')) return null;
    const url = new URL(value, 'https://itnew.invalid');
    if (url.origin !== 'https://itnew.invalid') return null;
    const decodedPath = decodeURIComponent(url.pathname);
    if (/[\u0000-\u001f\u007f-\u009f\\]/.test(decodedPath)
      || decodedPath.split('/').some((segment) => segment === '.' || segment === '..')) return null;
    if (!decodedPath.startsWith('/itnew/images/')
      && !decodedPath.startsWith('/itnew/assets/fallback/')) return null;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return null;
  }
}

function safeDimension(value) {
  if (typeof value !== 'string' || !/^[0-9]+$/.test(value)) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 && number <= 8192 ? String(number) : null;
}

function allowedAttributes(tag, source) {
  const parsed = parseAttributes(source);
  const attributes = [];

  if (tag === 'a') {
    const href = safeLink(parsed.get('href'));
    if (href) attributes.push(['href', href]);
    if (parsed.get('title') !== undefined && parsed.get('title') !== null) {
      attributes.push(['title', parsed.get('title')]);
    }
    if (href) attributes.push(['rel', 'noopener noreferrer']);
  } else if (tag === 'img') {
    const src = safeImagePath(parsed.get('src'));
    if (src) attributes.push(['src', src]);
    for (const name of ['alt', 'title']) {
      if (parsed.get(name) !== undefined && parsed.get(name) !== null) {
        attributes.push([name, parsed.get(name)]);
      }
    }
    for (const name of ['width', 'height']) {
      const dimension = safeDimension(parsed.get(name));
      if (dimension) attributes.push([name, dimension]);
    }
  }
  return attributes;
}

function appendText(parent, value) {
  if (!value) return;
  const normalized = normalizeValue(value);
  const previous = parent.children.at(-1);
  if (previous?.type === 'text') previous.value += normalized;
  else parent.children.push({ type: 'text', value: normalized });
}

function sanitizeToTree(input) {
  const html = String(input ?? '');
  const root = { type: 'root', children: [] };
  const stack = [root];
  const blocked = [];
  let cursor = 0;

  while (cursor < html.length) {
    if (html[cursor] !== '<') {
      const next = html.indexOf('<', cursor);
      const end = next < 0 ? html.length : next;
      if (blocked.length === 0) appendText(stack.at(-1), html.slice(cursor, end));
      cursor = end;
      continue;
    }

    const token = readMarkup(html, cursor);
    if (!token) {
      if (blocked.length === 0) appendText(stack.at(-1), '<');
      cursor += 1;
      continue;
    }
    if (token.type === 'text_suffix') {
      if (blocked.length === 0) appendText(stack.at(-1), html.slice(cursor, token.end));
      break;
    }
    cursor = token.end;
    if (token.type === 'discard') continue;

    if (blocked.length > 0) {
      if (token.type === 'start' && BLOCKED_TAGS.has(token.name)) {
        blocked.push(token.name);
      } else if (token.type === 'end' && token.name === blocked.at(-1)) {
        blocked.pop();
      }
      continue;
    }

    if (token.type === 'start' && BLOCKED_TAGS.has(token.name)) {
      blocked.push(token.name);
      continue;
    }
    if (!ALLOWED_TAGS.has(token.name)) continue;

    if (token.type === 'start') {
      const node = {
        type: 'element',
        tag: token.name,
        attributes: allowedAttributes(token.name, token.attributes),
        children: [],
      };
      stack.at(-1).children.push(node);
      if (!VOID_TAGS.has(token.name) && !token.selfClosing) stack.push(node);
    } else if (!VOID_TAGS.has(token.name) && stack.at(-1)?.tag === token.name) {
      stack.pop();
    }
  }
  return root;
}

function serializedAttributes(attributes) {
  return attributes.map(([name, value]) => ` ${name}="${escapeAttribute(value)}"`).join('');
}

function openingTag(node) {
  return `<${node.tag}${serializedAttributes(node.attributes)}>`;
}

function serializeNode(node) {
  const output = [];
  const pending = [node];

  while (pending.length > 0) {
    const current = pending.pop();
    if (current.type === 'closing') {
      output.push(current.value);
    } else if (current.type === 'text') {
      output.push(escapeText(current.value));
    } else {
      output.push(openingTag(current));
      if (!VOID_TAGS.has(current.tag)) {
        pending.push({ type: 'closing', value: `</${current.tag}>` });
        for (let index = current.children.length - 1; index >= 0; index -= 1) {
          pending.push(current.children[index]);
        }
      }
    }
  }
  return output.join('');
}

function byteLength(value) {
  return encoder.encode(value).byteLength;
}

function sectionLimitError() {
  return new Error('article_section_limit_too_small');
}

function* nodeEvents(node) {
  const pending = [node];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current.type === 'closing') {
      yield { type: 'close' };
    } else if (current.type === 'text') {
      for (const codePoint of current.value) {
        yield { type: 'atomic', value: escapeText(codePoint) };
      }
    } else {
      const opening = openingTag(current);
      if (VOID_TAGS.has(current.tag)) {
        yield { type: 'atomic', value: opening };
      } else {
        yield { type: 'open', value: opening, closing: `</${current.tag}>` };
        pending.push({ type: 'closing' });
        for (let index = current.children.length - 1; index >= 0; index -= 1) {
          pending.push(current.children[index]);
        }
      }
    }
  }
}

function splitOversizedNode(node, limit) {
  const chunks = [];
  const active = [];
  let parts = [];
  let currentBytes = 0;
  let closingBytes = 0;
  let dirty = false;

  function resetToActiveTags() {
    parts = active.map(({ opening }) => opening);
    currentBytes = active.reduce((total, entry) => total + entry.openingBytes, 0);
    dirty = false;
  }

  function flush() {
    if (!dirty) throw sectionLimitError();
    const closing = [...active].reverse().map((entry) => entry.closing).join('');
    const chunk = `${parts.join('')}${closing}`;
    if (!chunk || byteLength(chunk) > limit) throw sectionLimitError();
    chunks.push(chunk);
    resetToActiveTags();
  }

  for (const event of nodeEvents(node)) {
    if (event.type === 'open') {
      const entry = {
        opening: event.value,
        closing: event.closing,
        openingBytes: byteLength(event.value),
        closingBytes: byteLength(event.closing),
      };
      if (currentBytes + entry.openingBytes + closingBytes + entry.closingBytes > limit) {
        flush();
      }
      if (currentBytes + entry.openingBytes + closingBytes + entry.closingBytes > limit) {
        throw sectionLimitError();
      }
      parts.push(entry.opening);
      currentBytes += entry.openingBytes;
      closingBytes += entry.closingBytes;
      active.push(entry);
      dirty = true;
    } else if (event.type === 'close') {
      const entry = active.pop();
      if (!entry) throw sectionLimitError();
      parts.push(entry.closing);
      currentBytes += entry.closingBytes;
      closingBytes -= entry.closingBytes;
      dirty = true;
    } else {
      const valueBytes = byteLength(event.value);
      if (currentBytes + valueBytes + closingBytes > limit) flush();
      if (currentBytes + valueBytes + closingBytes > limit) throw sectionLimitError();
      parts.push(event.value);
      currentBytes += valueBytes;
      dirty = true;
    }
  }

  if (active.length !== 0 || closingBytes !== 0) throw sectionLimitError();
  if (dirty) {
    const chunk = parts.join('');
    if (!chunk || currentBytes > limit) throw sectionLimitError();
    chunks.push(chunk);
  }
  return chunks;
}

export function sanitizeArticleHtml(html) {
  return sanitizeToTree(html).children.map(serializeNode).join('');
}

export function splitArticleSections(html, maxBytes = 400 * 1024) {
  if (!Number.isFinite(maxBytes) || maxBytes < 1) throw sectionLimitError();
  const limit = Math.floor(maxBytes);
  const root = sanitizeToTree(html);
  const chunks = [];
  let pending = [];
  let pendingBytes = 0;

  function flushPending() {
    if (pendingBytes > 0) chunks.push(pending.join(''));
    pending = [];
    pendingBytes = 0;
  }

  for (const node of root.children) {
    const serialized = serializeNode(node);
    const serializedBytes = byteLength(serialized);
    if (serializedBytes > limit) {
      flushPending();
      chunks.push(...splitOversizedNode(node, limit));
    } else if (pendingBytes + serializedBytes > limit) {
      flushPending();
      pending.push(serialized);
      pendingBytes = serializedBytes;
    } else {
      pending.push(serialized);
      pendingBytes += serializedBytes;
    }
  }
  flushPending();
  return chunks;
}
