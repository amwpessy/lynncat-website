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

const state = {
  category: '',
  language: '',
  query: '',
  controller: null,
  requestId: 0,
};

const elements = {
  latest: document.querySelector('#latest'),
  latestList: document.querySelector('#latestList'),
  feedStatus: document.querySelector('#feedStatus'),
  retryButton: document.querySelector('#retryButton'),
  resultCount: document.querySelector('#resultCount'),
  searchForm: document.querySelector('#searchForm'),
  searchInput: document.querySelector('#searchInput'),
};

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

function normalizedItem(value) {
  if (!value || typeof value !== 'object') return null;
  const slug = text(value.slug);
  const title = text(value.title);
  if (!slug || !title) return null;
  return {
    slug,
    title,
    summary: summaryText(value.summary, '暂无摘要。'),
    language: value.language === 'zh' ? 'zh' : 'en',
    category: text(value.category, 'frontier'),
    sourceName: text(value.sourceName, 'ITNEW'),
    sourcePublishedAt: validTimestamp(value.sourcePublishedAt),
    publishedAt: validTimestamp(value.publishedAt),
    heroImageUrl: safeImageUrl(value.heroImageUrl, value.category),
  };
}

function articleHref(item) {
  return `/itnew/article/${encodeURIComponent(item.slug)}`;
}

function readTime(item) {
  const length = Array.from(`${item.title} ${item.summary}`).length;
  return `${Math.max(1, Math.ceil(length / 260))} min read`;
}

function dateValue(item) {
  return item.sourcePublishedAt ?? item.publishedAt;
}

function formatDate(value, includeTime = false) {
  const timestamp = validTimestamp(value);
  if (timestamp == null) return '时间待确认';
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return '时间待确认';
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'short',
    day: 'numeric',
    ...(includeTime ? { hour: '2-digit', minute: '2-digit', hour12: false } : {}),
  }).format(date);
}

function languageLabel(language) {
  return language === 'zh' ? '中文' : 'EN';
}

function createMeta(item, className) {
  const meta = document.createElement('div');
  meta.className = className;
  for (const value of [item.sourceName, languageLabel(item.language), readTime(item)]) {
    const part = document.createElement('span');
    part.textContent = value;
    meta.append(part);
  }
  return meta;
}

function configureImage(image, item, eager = false) {
  const fallback = topicFallback(item.category);
  image.src = item.heroImageUrl;
  image.alt = `${item.title} — ${item.category} 主题配图`;
  image.decoding = 'async';
  image.loading = eager ? 'eager' : 'lazy';
  image.addEventListener('error', () => {
    if (image.src.endsWith(fallback)) return;
    image.src = fallback;
  }, { once: true });
}

function createSkeletonLine(className = '') {
  const line = document.createElement('span');
  line.className = `skeleton skeleton-line ${className}`.trim();
  return line;
}

function renderLoading() {
  elements.latest.setAttribute('aria-busy', 'true');
  elements.feedStatus.className = 'feed-status';
  elements.feedStatus.textContent = '正在读取最新信号… / Loading reviewed stories…';
  elements.retryButton.hidden = true;
  elements.resultCount.textContent = '';

  const rows = Array.from({ length: 4 }, () => {
    const row = document.createElement('li');
    row.className = 'latest-row';
    row.setAttribute('aria-hidden', 'true');
    row.append(createSkeletonLine('short'), createSkeletonLine(), createSkeletonLine());
    return row;
  });
  elements.latestList.replaceChildren(...rows);
}

function createLatestRow(item, index) {
  const row = document.createElement('li');
  row.className = 'latest-row';

  const time = document.createElement('time');
  const timestamp = dateValue(item);
  time.className = 'latest-time';
  time.textContent = formatDate(timestamp, true);
  if (timestamp != null) time.dateTime = new Date(timestamp).toISOString();

  const image = document.createElement('img');
  image.className = 'latest-thumb';
  configureImage(image, item, index === 0);
  image.alt = `${item.title} 对应的主题图片`;

  const copy = document.createElement('div');
  copy.className = 'latest-copy';
  const link = document.createElement('a');
  link.className = 'story-link';
  link.href = articleHref(item);
  const heading = document.createElement('h3');
  heading.textContent = item.title;
  link.append(heading);
  copy.append(link, createMeta(item, 'latest-meta'));

  row.append(time, image, copy);
  return row;
}

function renderLatest(items) {
  elements.latestList.replaceChildren(...items.map(createLatestRow));
  elements.resultCount.textContent = `${items.length} 条已审核资讯`;
}

function clearBusyState() {
  elements.latest.setAttribute('aria-busy', 'false');
}

function renderEmpty() {
  clearBusyState();
  elements.latestList.replaceChildren();
  elements.resultCount.textContent = '0 条资讯';
  elements.feedStatus.className = 'feed-status';
  elements.feedStatus.textContent = '当前筛选下暂无内容。审核通过的文章将在这里出现，请稍后再来。';
  elements.retryButton.hidden = true;
}

function renderError() {
  clearBusyState();
  elements.latestList.replaceChildren();
  elements.resultCount.textContent = '';
  elements.feedStatus.className = 'feed-status error';
  elements.feedStatus.textContent = '资讯暂时无法载入，请检查网络后重试。';
  elements.retryButton.hidden = false;
}

function renderItems(items) {
  clearBusyState();
  elements.feedStatus.textContent = '';
  elements.retryButton.hidden = true;
  renderLatest(items);
}

function searchUrl() {
  const parameters = new URLSearchParams({ limit: '30' });
  if (state.category) parameters.set('category', state.category);
  if (state.language) parameters.set('language', state.language);
  if (state.query) parameters.set('q', state.query);
  return `/itnew/api/articles?${parameters.toString()}`;
}

async function loadArticles() {
  state.controller?.abort();
  const controller = new AbortController();
  const requestId = ++state.requestId;
  state.controller = controller;
  renderLoading();

  try {
    const response = await fetch(searchUrl(), {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
      credentials: 'same-origin',
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    if (requestId !== state.requestId) return;
    const items = Array.isArray(payload?.items)
      ? payload.items.map(normalizedItem).filter(Boolean)
      : [];
    if (items.length === 0) renderEmpty();
    else renderItems(items);
  } catch (error) {
    if (controller.signal.aborted || requestId !== state.requestId) return;
    renderError();
  }
}

function setPressed(container, attribute, value) {
  for (const button of container.querySelectorAll(`button[${attribute}]`)) {
    button.setAttribute('aria-pressed', String(button.dataset[attribute.slice(5)] === value));
  }
}

document.querySelector('#categoryFilters').addEventListener('click', (event) => {
  const button = event.target.closest('button[data-category]');
  if (!button) return;
  state.category = button.dataset.category || '';
  setPressed(event.currentTarget, 'data-category', state.category);
  loadArticles();
});

document.querySelector('#languageFilters').addEventListener('click', (event) => {
  const button = event.target.closest('button[data-language]');
  if (!button) return;
  state.language = button.dataset.language || '';
  setPressed(event.currentTarget, 'data-language', state.language);
  loadArticles();
});

elements.searchForm.addEventListener('submit', (event) => {
  event.preventDefault();
  state.query = elements.searchInput.value.trim();
  loadArticles();
});

elements.retryButton.addEventListener('click', loadArticles);
loadArticles();
