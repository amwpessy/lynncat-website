const SUMMARY_NOTICE = '此来源未授权全文转载，本站仅提供编辑摘要。';
const LICENSED_NOTICE = '本文已获授权转载，转载与再使用请遵守所列许可证。';
const FALLBACK_IMAGES = Object.freeze({
  AI: '/itnew/assets/fallback/ai.png',
  chips: '/itnew/assets/fallback/chips.png',
  internet: '/itnew/assets/fallback/cloud.png',
  development: '/itnew/assets/fallback/development.png',
  hardware: '/itnew/assets/fallback/devices.png',
  frontier: '/itnew/assets/fallback/frontier.png',
  robotics: '/itnew/assets/fallback/robotics.png',
  security: '/itnew/assets/fallback/security.png',
});

const elements = {
  status: document.querySelector('#articleStatus'),
  retry: document.querySelector('#articleRetry'),
  content: document.querySelector('#articleContent'),
  eyebrow: document.querySelector('#articleEyebrow'),
  title: document.querySelector('#articleTitle'),
  meta: document.querySelector('#articleMeta'),
  image: document.querySelector('#articleImage'),
  caption: document.querySelector('#articleCaption'),
  summary: document.querySelector('#articleSummary'),
  rightsNotice: document.querySelector('#rightsNotice'),
  license: document.querySelector('#licenseBlock'),
  body: document.querySelector('#articleBody'),
  originalLink: document.querySelector('#originalLink'),
  originalUnavailable: document.querySelector('#originalUnavailable'),
};

let controller = null;
let requestId = 0;

function text(value, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function summaryText(value, fallback = '') {
  const raw = text(value);
  if (!raw) return fallback;
  const documentValue = new DOMParser().parseFromString(raw, 'text/html');
  const result = text(documentValue.body.textContent?.replace(/\s+/gu, ' '));
  return result && !/^点击查看原文[>》]?[。.!！]?$/u.test(result) ? result : fallback;
}

function validTimestamp(value) {
  if (value == null || value === '' || (typeof value === 'string' && !value.trim())) return null;
  const timestamp = Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) return null;
  const clippedTimestamp = new Date(timestamp).getTime();
  return Number.isFinite(clippedTimestamp) ? clippedTimestamp : null;
}

function slugFromPath() {
  const prefix = '/itnew/article/';
  if (!location.pathname.startsWith(prefix)) return null;
  const encodedSlug = location.pathname.slice(prefix.length);
  if (!encodedSlug || encodedSlug.includes('/')) return null;
  try {
    const slug = decodeURIComponent(encodedSlug);
    return slug && !slug.includes('/') ? slug : null;
  } catch {
    return null;
  }
}

function topicFallback(category) {
  return FALLBACK_IMAGES[category] || FALLBACK_IMAGES.frontier;
}

function safeImageUrl(value, category) {
  const fallback = topicFallback(category);
  if (typeof value !== 'string' || !value) return fallback;
  try {
    const candidate = new URL(value, location.origin);
    if (candidate.origin !== location.origin) return fallback;
    if (!candidate.pathname.startsWith('/itnew/images/')
      && !candidate.pathname.startsWith('/itnew/assets/fallback/')) return fallback;
    return candidate.pathname;
  } catch {
    return fallback;
  }
}

function safeExternalUrl(value) {
  if (typeof value !== 'string' || !value) return null;
  try {
    const candidate = new URL(value, location.origin);
    if (!['http:', 'https:'].includes(candidate.protocol)
      || candidate.username || candidate.password) return null;
    return candidate.href;
  } catch {
    return null;
  }
}

function formatDate(value) {
  const timestamp = validTimestamp(value);
  if (timestamp == null) return '时间待确认';
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '时间待确认';
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit',
    hour12: false,
  }).format(date);
}

function appendMeta(term, description) {
  const group = document.createElement('div');
  const label = document.createElement('dt');
  label.textContent = term;
  const value = document.createElement('dd');
  value.textContent = description;
  group.append(label, value);
  elements.meta.append(group);
}

function renderMeta(article) {
  elements.meta.replaceChildren();
  appendMeta('来源', text(article.sourceName, '来源待确认'));
  appendMeta('语言', article.language === 'zh' ? '中文' : 'English');
  appendMeta('发布时间', formatDate(
    validTimestamp(article.sourcePublishedAt) ?? validTimestamp(article.publishedAt),
  ));
}

function appendLicenseLine(label, value) {
  if (!value) return;
  const line = document.createElement('p');
  const strong = document.createElement('strong');
  strong.textContent = `${label}：`;
  line.append(strong, document.createTextNode(value));
  elements.license.append(line);
}

function renderLicense(article) {
  elements.license.replaceChildren();
  appendLicenseLine('许可', text(article.license?.name));
  appendLicenseLine('署名', text(article.license?.attribution));
  const licenseUrl = safeExternalUrl(article.license?.url);
  if (licenseUrl) {
    const line = document.createElement('p');
    const link = document.createElement('a');
    link.href = licenseUrl;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = '查看许可条款 / View license';
    line.append(link);
    elements.license.append(line);
  }
  elements.license.hidden = elements.license.childElementCount === 0;
}

function renderLicensedBody(article) {
  elements.body.replaceChildren();
  const sections = Array.isArray(article.sections)
    ? article.sections.filter((section) => typeof section === 'string')
    : [];
  for (const sectionHtml of sections) {
    const sectionElement = document.createElement('section');
    sectionElement.className = 'article-section';
    sectionElement.innerHTML = sectionHtml;
    elements.body.append(sectionElement);
  }
  if (sections.length === 0) {
    const unavailable = document.createElement('p');
    unavailable.textContent = '正文暂不可用，请前往原始来源阅读。';
    elements.body.append(unavailable);
  }
}

function renderSummaryBody(article) {
  elements.body.replaceChildren();
  const summaryElement = document.createElement('p');
  summaryElement.textContent = summaryText(article.summary, '暂无摘要。');
  elements.body.append(summaryElement);
}

function renderOriginalLink(value) {
  const url = safeExternalUrl(value);
  elements.originalLink.hidden = !url;
  elements.originalUnavailable.hidden = Boolean(url);
  if (url) elements.originalLink.href = url;
  else elements.originalLink.removeAttribute('href');
}

function renderArticle(article) {
  const title = text(article.title, '未命名文章');
  const category = text(article.category, 'frontier');
  const licensed = article.rightsMode === 'licensed_full';

  document.title = `${title} · ITNEW`;
  document.documentElement.lang = article.language === 'en' ? 'en' : 'zh-CN';
  elements.eyebrow.textContent = `${category.toUpperCase()} · ${licensed ? 'LICENSED FULL' : 'SUMMARY'}`;
  elements.title.textContent = title;
  elements.summary.textContent = summaryText(article.summary, '暂无摘要。');
  elements.summary.hidden = !licensed;
  renderMeta(article);

  const fallback = topicFallback(category);
  elements.image.src = safeImageUrl(article.heroImageUrl, category);
  elements.image.alt = `${title} — ${category} 主题配图`;
  elements.image.addEventListener('error', () => {
    if (elements.image.src.endsWith(fallback)) return;
    elements.image.src = fallback;
  }, { once: true });
  elements.caption.textContent = `${text(article.sourceName, 'ITNEW')} · ${category}`;

  if (article.rightsMode === 'licensed_full') {
    elements.rightsNotice.textContent = LICENSED_NOTICE;
    renderLicense(article);
    renderLicensedBody(article);
  } else {
    elements.rightsNotice.textContent = SUMMARY_NOTICE;
    elements.license.replaceChildren();
    elements.license.hidden = true;
    renderSummaryBody(article);
  }
  renderOriginalLink(article.originalUrl);

  elements.status.textContent = '';
  elements.retry.hidden = true;
  elements.content.hidden = false;
}

function renderLoading() {
  elements.content.hidden = true;
  elements.retry.hidden = true;
  elements.status.className = 'article-status';
  elements.status.textContent = '正在加载文章… / Loading article…';
}

function renderError(message) {
  elements.content.hidden = true;
  elements.status.className = 'article-status feed-status error';
  elements.status.textContent = message;
  elements.retry.hidden = false;
}

async function loadArticle() {
  const slug = slugFromPath();
  if (!slug) {
    renderError('文章地址无效，请返回首页重新选择。');
    return;
  }

  controller?.abort();
  controller = new AbortController();
  const currentRequest = ++requestId;
  renderLoading();

  try {
    const response = await fetch(`/itnew/api/articles/${encodeURIComponent(slug)}`, {
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
      signal: controller.signal,
    });
    if (currentRequest !== requestId) return;
    if (response.status === 404) {
      renderError('文章不存在、尚未发布或已下线。');
      return;
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const article = await response.json();
    if (currentRequest !== requestId) return;
    if (!article || typeof article !== 'object') throw new Error('Invalid article');
    renderArticle(article);
  } catch (error) {
    if (controller.signal.aborted || currentRequest !== requestId) return;
    renderError('文章暂时无法载入，请检查网络后重试。');
  }
}

elements.retry.addEventListener('click', loadArticle);
loadArticle();
