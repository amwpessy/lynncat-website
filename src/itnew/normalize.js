const TRACKING_PARAMETERS = new Set(['fbclid', 'gclid', 'spm', 'ref']);
const HOUR_MS = 60 * 60 * 1000;

const CATEGORY_KEYWORDS = [
  ['security', ['security', 'secure', 'vulnerability', 'breach', 'malware', 'ransomware', 'cyber', 'patch', '安全', '漏洞', '攻击', '勒索', '恶意软件', '补丁']],
  ['AI', ['artificial intelligence', 'machine learning', 'large language model', 'llm', 'generative ai', 'ai ', ' ai', '人工智能', '机器学习', '大模型', '生成式', '智能体']],
  ['chips', ['chip', 'semiconductor', 'processor', 'cpu', 'gpu', 'soc', '芯片', '半导体', '处理器', '晶圆']],
  ['robotics', ['robot', 'drone', 'autonomous vehicle', '机器人', '无人机', '自动驾驶']],
  ['development', ['developer', 'programming', 'software', 'open source', 'github', 'api', 'framework', 'database', '开发', '编程', '软件', '开源', '数据库', '框架']],
  ['internet', ['internet', 'browser', 'cloud', 'network', 'web', 'saas', '互联网', '浏览器', '云计算', '网络']],
  ['hardware', ['hardware', 'device', 'laptop', 'phone', 'display', 'wearable', '硬件', '设备', '电脑', '手机', '显示器', '可穿戴']],
];

function decodeXml(value = '') {
  return String(value)
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#([0-9]+);/g, (_, code) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&amp;/gi, '&')
    .trim();
}

function elementValue(block, names) {
  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = block.match(new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}\\s*>`, 'i'));
    if (match) return decodeXml(match[1]);
  }
  return '';
}

function attributes(markup = '') {
  const result = {};
  for (const match of markup.matchAll(/([:\w-]+)\s*=\s*(["'])([\s\S]*?)\2/g)) {
    result[match[1].toLowerCase()] = decodeXml(match[3]);
  }
  return result;
}

function atomLink(block) {
  const links = [...block.matchAll(/<link\b([^>]*)\/?\s*>/gi)].map((match) => attributes(match[1]));
  const link = links.find(({ rel, href }) => href && (!rel || rel === 'alternate')) || links.find(({ href }) => href);
  return link?.href || '';
}

function imageLink(block) {
  for (const pattern of [/<enclosure\b([^>]*)\/?\s*>/gi, /<media:(?:content|thumbnail)\b([^>]*)\/?\s*>/gi]) {
    for (const match of block.matchAll(pattern)) {
      const attrs = attributes(match[1]);
      if (attrs.url && (!attrs.type || attrs.type.startsWith('image/'))) return attrs.url;
    }
  }
  return null;
}

function parsedDate(value) {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function parseHackerNews(input) {
  let parsed;
  try {
    parsed = typeof input === 'string' ? JSON.parse(input) : input;
  } catch {
    return [];
  }
  const items = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.items) ? parsed.items : parsed ? [parsed] : [];
  if (!Array.isArray(items)) return [];
  return items.filter((item) => item && typeof item === 'object' && item.title).map((item) => ({
    title: String(item.title),
    url: item.url || `https://news.ycombinator.com/item?id=${item.id}`,
    id: String(item.id ?? ''),
    summary: item.text || '',
    content: '',
    publishedAt: Number.isFinite(item.time) ? item.time * 1000 : null,
    author: item.by || '',
    imageUrl: null,
  }));
}

export function parseFeed(input, source = {}) {
  if (source.adapter === 'hn_json') return parseHackerNews(input);
  if (typeof input !== 'string') return [];
  const blocks = [...input.matchAll(/<(item|entry)(?:\s[^>]*)?>([\s\S]*?)<\/\1\s*>/gi)];
  return blocks.map(([, kind, block]) => {
    const authorBlock = elementValue(block, ['author', 'dc:creator']);
    const dateValue = elementValue(block, ['pubDate', 'published', 'updated']);
    return {
      title: elementValue(block, ['title']),
      url: kind.toLowerCase() === 'entry' ? atomLink(block) || elementValue(block, ['link']) : elementValue(block, ['link']),
      id: elementValue(block, ['guid', 'id']),
      summary: elementValue(block, ['description', 'summary']),
      content: elementValue(block, ['content:encoded', 'content']),
      publishedAt: parsedDate(dateValue),
      author: elementValue(authorBlock, ['name']) || authorBlock,
      imageUrl: imageLink(block),
    };
  });
}

export function canonicalizeUrl(value) {
  try {
    const url = new URL(value);
    url.hostname = url.hostname.toLowerCase();
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      const normalized = key.toLowerCase();
      if (normalized.startsWith('utm_') || TRACKING_PARAMETERS.has(normalized)) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    if (url.pathname.length > 1) url.pathname = url.pathname.replace(/\/+$/, '');
    const serialized = url.toString().replace(/\?$/, '');
    return url.pathname === '/' ? serialized.replace(/\/(?=\?|$)/, '') : serialized;
  } catch {
    return '';
  }
}

function detectLanguage(text) {
  const meaningful = String(text).match(/[\p{L}\p{N}]/gu) || [];
  if (!meaningful.length) return 'en';
  const han = meaningful.filter((character) => /\p{Script=Han}/u.test(character)).length;
  return han / meaningful.length >= 0.2 ? 'zh' : 'en';
}

function classify(text) {
  const haystack = ` ${String(text).toLowerCase()} `;
  for (const [category, keywords] of CATEGORY_KEYWORDS) {
    if (keywords.some((keyword) => haystack.includes(keyword))) return category;
  }
  return 'frontier';
}

export function normalizeEntry(entry, source = {}, now = Date.now()) {
  const title = String(entry?.title || '').trim();
  const summary = String(entry?.summary || entry?.description || '').trim();
  const content = String(entry?.content || '').trim();
  const publishedAt = typeof entry?.publishedAt === 'number'
    ? entry.publishedAt
    : parsedDate(entry?.publishedAt || entry?.pubDate);
  const language = source.language === 'zh' || source.language === 'en'
    ? source.language
    : detectLanguage(`${title} ${summary}`);
  return {
    ...entry,
    title,
    summary,
    content,
    canonicalUrl: canonicalizeUrl(entry?.url || entry?.link || ''),
    sourceId: source.id,
    sourceName: source.name,
    sourceWeight: source.priorityWeight ?? source.priority_weight ?? 0,
    rightsMode: source.rightsMode || source.rights_mode || 'summary_link',
    language,
    category: classify(`${title} ${summary}`),
    publishedAt,
    normalizedAt: now,
  };
}

export function scoreCandidate(candidate, now = Date.now()) {
  const publishedAt = Number(candidate?.publishedAt);
  const age = Number.isFinite(publishedAt) ? Math.max(0, now - publishedAt) : null;
  if (age !== null && age > 48 * HOUR_MS) return 0;
  let freshness = 0;
  if (age !== null && age <= 3 * HOUR_MS) freshness = 25;
  else if (age !== null && age <= 12 * HOUR_MS) freshness = 20;
  else if (age !== null && age <= 24 * HOUR_MS) freshness = 15;
  else if (age !== null && age <= 48 * HOUR_MS) freshness = 8;
  const total = ['sourceWeight', 'itRelevance', 'completeness', 'corroboration']
    .reduce((sum, key) => sum + (Number(candidate?.[key]) || 0), freshness);
  return Math.max(0, Math.min(100, Math.round(total)));
}

function titleKey(title) {
  return String(title || '').toLocaleLowerCase().replace(/[\p{P}\p{S}\s]+/gu, '');
}

function similarity(left, right) {
  if (left === right) return left ? 1 : 0;
  if (!left || !right) return 0;
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    let diagonal = previous[0];
    previous[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const above = previous[rightIndex];
      previous[rightIndex] = Math.min(
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + 1,
        diagonal + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
      diagonal = above;
    }
  }
  return 1 - previous[right.length] / Math.max(left.length, right.length);
}

function deduplicate(items) {
  const accepted = [];
  const urls = new Set();
  for (const item of [...items].filter((candidate) => Number(candidate?.score) > 0).sort((a, b) => b.score - a.score)) {
    if (item.canonicalUrl && urls.has(item.canonicalUrl)) continue;
    const key = titleKey(item.title);
    if (accepted.some(({ key: other }) => similarity(key, other) >= 0.9)) continue;
    accepted.push({ item, key });
    if (item.canonicalUrl) urls.add(item.canonicalUrl);
  }
  return accepted.map(({ item }) => item);
}

export function selectBalancedCandidates(items, limit) {
  const target = Math.max(0, Math.floor(Number(limit) || 0));
  if (!target) return [];
  const candidates = deduplicate(Array.isArray(items) ? items : []);
  const selected = [];
  const selectedIds = new Set();
  const sourceCounts = new Map();
  const categoryCounts = new Map();

  const canSelect = (item) => (
    !selectedIds.has(item)
    && (sourceCounts.get(item.sourceId) || 0) < 5
    && (categoryCounts.get(item.category) || 0) < 8
  );
  const add = (item) => {
    selected.push(item);
    selectedIds.add(item);
    sourceCounts.set(item.sourceId, (sourceCounts.get(item.sourceId) || 0) + 1);
    categoryCounts.set(item.category, (categoryCounts.get(item.category) || 0) + 1);
  };
  const takeLanguage = (language, quota) => {
    for (const item of candidates) {
      if (selected.length >= target || quota <= 0) break;
      if (item.language === language && canSelect(item)) {
        add(item);
        quota -= 1;
      }
    }
  };

  const quotas = { zh: Math.ceil(target / 2), en: Math.floor(target / 2) };
  const languageOrder = ['zh', 'en'].sort((left, right) => (
    candidates.filter((item) => item.language === left).length
    - candidates.filter((item) => item.language === right).length
  ));
  for (const language of languageOrder) takeLanguage(language, quotas[language]);
  for (const item of candidates) {
    if (selected.length >= target) break;
    if (canSelect(item)) add(item);
  }
  return selected;
}
