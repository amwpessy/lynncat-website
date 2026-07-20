const API_BASE = '/itnew/admin/api';
const SESSION_ENDPOINT = '/itnew/admin/api/session';
const USERNAME_PREFERENCE = 'itnew-admin-username';

const state = {
  csrf: null,
  adminId: '',
  activeView: 'review',
  currentBatch: null,
  candidates: [],
  articles: [],
  sources: [],
  batches: [],
  selection: new Set(),
  mutating: false,
  requests: new Map(),
};

const elements = Object.fromEntries([
  'loginShell', 'appShell', 'loginForm', 'loginSubmit', 'loginError', 'rateLimitStatus',
  'appShell', 'adminIdentity', 'viewTitle', 'collectNow', 'logoutButton',
  'reviewView', 'publishedView', 'sourcesView', 'batchesView',
  'batchIdentity', 'pendingCount', 'approvedCount', 'rejectedCount', 'errorCount',
  'reviewStatus', 'reviewGrid', 'selectVisible', 'selectedCount', 'bulkApprove', 'bulkReject',
  'publishedSearch', 'publishedFilter', 'publishedStatus', 'publishedList',
  'sourcesStatus', 'sourcesList', 'batchesStatus', 'batchesList',
  'previewDialog', 'previewEyebrow', 'previewTitle', 'previewSummary', 'previewMeta',
  'previewOriginal',
].map((id) => [id, document.getElementById(id)]));

const loginFields = {
  username: elements.loginForm.elements.namedItem('username'),
  password: elements.loginForm.elements.namedItem('password'),
  remember: elements.loginForm.elements.namedItem('remember'),
};

function createElement(tagName, className, value) {
  const element = document.createElement(tagName);
  if (className) element.className = className;
  if (value !== undefined) element.textContent = String(value);
  return element;
}

function cleanText(value, fallback = '—') {
  const result = typeof value === 'string' ? value.trim() : '';
  return result || fallback;
}

function validDate(value) {
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) && Math.abs(timestamp) <= 8.64e15;
}

function formatDate(value, fallback = '时间未知') {
  if (!validDate(value)) return fallback;
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function readingTime(summary) {
  const length = cleanText(summary, '').replace(/\s+/gu, '').length;
  return `${Math.max(1, Math.ceil(length / 350))} 分钟阅读`;
}

function safeExternalUrl(value) {
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

function safeCoverUrl(value, category) {
  const external = safeExternalUrl(value);
  if (external) return external;
  const fallback = {
    ai: '/itnew/assets/fallback/ai.png',
    chips: '/itnew/assets/fallback/chips.png',
    internet: '/itnew/assets/fallback/cloud.png',
    development: '/itnew/assets/fallback/development.png',
    hardware: '/itnew/assets/fallback/devices.png',
    frontier: '/itnew/assets/fallback/frontier.png',
    robotics: '/itnew/assets/fallback/robotics.png',
    security: '/itnew/assets/fallback/security.png',
  };
  return fallback[String(category || '').toLowerCase()] || '/itnew/assets/fallback/frontier.png';
}

function configureExternalLink(link, value) {
  const safeUrl = safeExternalUrl(value);
  link.hidden = !safeUrl;
  link.removeAttribute('href');
  if (!safeUrl) return;
  link.href = safeUrl;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
}

function setStatus(element, message, isError = false) {
  element.textContent = message;
  element.classList.toggle('error', isError);
}

function replaceChildren(element, children = []) {
  element.replaceChildren(...children);
}

function beginRequest(key) {
  const previous = state.requests.get(key);
  if (previous) previous.controller.abort();
  const request = {
    controller: new AbortController(),
    id: (previous?.id || 0) + 1,
  };
  state.requests.set(key, request);
  return request;
}

function isCurrentRequest(key, request) {
  return state.requests.get(key) === request && !request.controller.signal.aborted;
}

async function parsePayload(response) {
  const type = response.headers.get('content-type') || '';
  if (!type.includes('application/json')) return {};
  return response.json();
}

async function apiRequest(path, options = {}) {
  const method = options.method || 'GET';
  const mutationHeaders = method !== 'GET' && path !== '/login'
    ? { 'X-CSRF-Token': state.csrf }
    : {};
  const headers = {
    Accept: 'application/json',
    ...mutationHeaders,
  };
  const request = {
    method,
    credentials: 'same-origin',
    headers,
    signal: options.signal,
  };
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    request.body = JSON.stringify(options.body);
  }
  const response = await fetch(`${API_BASE}${path}`, request);
  if (response.status === 401 && path !== '/login') {
    showLogin('登录已失效，请重新登录。');
  }
  return response;
}

function showLogin(message = '') {
  state.csrf = null;
  state.adminId = '';
  state.selection.clear();
  elements.appShell.hidden = true;
  elements.loginShell.hidden = false;
  elements.loginError.hidden = !message;
  elements.loginError.textContent = message;
  loginFields.password.value = '';
}

function showApp() {
  elements.loginShell.hidden = true;
  elements.appShell.hidden = false;
  elements.loginError.hidden = true;
  elements.adminIdentity.textContent = state.adminId ? `管理员 · ${state.adminId}` : '管理员';
  switchView('review');
}

function restoreUsernamePreference() {
  try {
    const remembered = localStorage.getItem(USERNAME_PREFERENCE);
    if (remembered) {
      loginFields.username.value = remembered;
      loginFields.remember.checked = true;
    }
  } catch {
    loginFields.remember.checked = false;
  }
}

function saveUsernamePreference() {
  try {
    if (loginFields.remember.checked) {
      localStorage.setItem(USERNAME_PREFERENCE, loginFields.username.value.trim());
    } else {
      localStorage.removeItem(USERNAME_PREFERENCE);
    }
  } catch {
    // The preference is optional; login must still work when storage is unavailable.
  }
}

let rateLimitTimer = null;

function startRateLimit(rawSeconds) {
  window.clearInterval(rateLimitTimer);
  let remaining = Math.max(1, Number.parseInt(rawSeconds, 10) || 60);
  const update = () => {
    elements.loginSubmit.disabled = remaining > 0;
    elements.rateLimitStatus.textContent = remaining > 0 ? `尝试过于频繁，请在 ${remaining} 秒后重试。` : '';
    remaining -= 1;
    if (remaining < 0) {
      window.clearInterval(rateLimitTimer);
      rateLimitTimer = null;
      elements.loginSubmit.disabled = false;
    }
  };
  update();
  rateLimitTimer = window.setInterval(update, 1000);
}

async function restoreSession() {
  const request = beginRequest('session');
  try {
    const response = await fetch(SESSION_ENDPOINT, {
      credentials: 'same-origin',
      signal: request.controller.signal,
      headers: { Accept: 'application/json' },
    });
    if (!isCurrentRequest('session', request)) return;
    if (response.status === 401) {
      showLogin();
      return;
    }
    if (response.status === 503) {
      showLogin('控制台暂未配置完成，请稍后重试。');
      return;
    }
    if (!response.ok) throw new Error('session');
    const payload = await parsePayload(response);
    if (!payload.authenticated || !payload.csrf) {
      showLogin();
      return;
    }
    state.csrf = payload.csrf;
    state.adminId = cleanText(payload.adminId, 'admin');
    showApp();
    await loadReview();
  } catch (error) {
    if (error.name !== 'AbortError') showLogin('无法连接控制台，请检查网络后重试。');
  }
}

elements.loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (elements.loginSubmit.disabled) return;
  elements.loginSubmit.disabled = true;
  elements.loginError.hidden = true;
  elements.rateLimitStatus.textContent = '正在验证…';
  try {
    const response = await apiRequest('/login', {
      method: 'POST',
      body: {
        username: loginFields.username.value.trim(),
        password: loginFields.password.value,
      },
    });
    if (response.status === 401) {
      showLogin('账号或密码不正确。');
      return;
    }
    if (response.status === 429) {
      startRateLimit(response.headers.get('Retry-After'));
      return;
    }
    if (response.status === 503) {
      showLogin('控制台暂未配置完成，请联系运维人员。');
      return;
    }
    if (!response.ok) throw new Error('login');
    const payload = await parsePayload(response);
    if (!payload.csrf) throw new Error('csrf');
    state.csrf = payload.csrf;
    state.adminId = cleanText(payload.adminId, loginFields.username.value.trim());
    saveUsernamePreference();
    loginFields.password.value = '';
    elements.rateLimitStatus.textContent = '';
    showApp();
    await loadReview();
  } catch {
    showLogin('登录请求失败，请检查网络后重试。');
  } finally {
    if (!rateLimitTimer) elements.loginSubmit.disabled = false;
  }
});

function updateProgress() {
  const count = (status) => state.candidates.filter((candidate) => candidate.status === status).length;
  elements.pendingCount.textContent = count('pending');
  elements.approvedCount.textContent = count('approved');
  elements.rejectedCount.textContent = count('rejected');
  elements.errorCount.textContent = count('processing_error');
}

function makeBadge(value, className) {
  return createElement('span', `badge ${className}`, cleanText(value));
}

function makeAction(label, action, id, className = 'secondary-button') {
  const button = createElement('button', className, label);
  button.type = 'button';
  button.setAttribute('data-action', action); // data-action preview / approve / reject / retry
  button.dataset.id = id;
  return button;
}

function renderReviewCard(candidate) {
  const card = createElement('article', 'review-card');
  const cover = createElement('img', 'review-cover');
  cover.src = safeCoverUrl(candidate.remote_image_url, candidate.category);
  cover.alt = '';
  cover.loading = 'lazy';
  cover.referrerPolicy = 'no-referrer';
  cover.addEventListener('error', () => {
    cover.src = safeCoverUrl('', candidate.category);
  }, { once: true });

  const body = createElement('div', 'review-card-body');
  const head = createElement('div', 'review-card-head');
  if (candidate.status === 'pending') {
    const select = createElement('input', 'review-select');
    select.type = 'checkbox';
    select.checked = state.selection.has(candidate.id);
    select.dataset.id = candidate.id;
    select.setAttribute('aria-label', `选择 ${cleanText(candidate.title, '候选资讯')}`);
    head.append(select);
  } else {
    head.append(makeBadge(candidate.status, 'review-status'));
  }
  head.append(createElement('strong', 'review-score', Number.isFinite(Number(candidate.score)) ? `${Number(candidate.score).toFixed(1)} 分` : '未评分'));

  const badges = createElement('div', 'badge-row');
  badges.append(
    makeBadge(candidate.category, 'review-category'),
    makeBadge(candidate.language, 'review-language'),
    makeBadge(candidate.rights_mode_snapshot, 'review-rights rights'),
  );
  const title = createElement('h3', 'review-title', cleanText(candidate.title, '无标题候选'));
  const summary = createElement('p', 'review-summary summary', cleanText(candidate.summary, '暂无摘要'));
  const meta = createElement('div', 'review-meta');
  meta.append(
    createElement('span', 'review-source', `来源 ${cleanText(candidate.source_id)}`),
    createElement('span', 'review-time', formatDate(candidate.source_published_at || candidate.created_at)),
    createElement('span', 'review-read-time', readingTime(candidate.summary)),
  );
  const actions = createElement('div', 'review-card-actions');
  if (candidate.status === 'processing_error') {
    actions.append(makeAction('重试处理', 'retry', candidate.id, 'primary-button retry-action'));
    const error = createElement('p', 'processing-error', cleanText(candidate.processing_error, '处理失败'));
    body.append(head, badges, title, summary, meta, error, actions);
  } else if (candidate.status === 'pending') {
    actions.append(
      makeAction('预览', 'preview', candidate.id),
      makeAction('拒绝', 'reject', candidate.id, 'secondary-button danger-button'),
      makeAction('批准', 'approve', candidate.id, 'primary-button'),
    );
    body.append(head, badges, title, summary, meta, actions);
  } else {
    body.append(head, badges, title, summary, meta);
  }
  card.append(cover, body);
  return card;
}

function updateSelection() {
  const visiblePending = state.candidates.filter((candidate) => candidate.status === 'pending');
  for (const id of [...state.selection]) {
    if (!visiblePending.some((candidate) => candidate.id === id)) state.selection.delete(id);
  }
  const count = state.selection.size;
  elements.selectedCount.textContent = `已选择 ${count} 项`;
  elements.bulkApprove.disabled = count === 0 || state.mutating;
  elements.bulkReject.disabled = count === 0 || state.mutating;
  elements.selectVisible.disabled = visiblePending.length === 0 || state.mutating;
  elements.selectVisible.checked = visiblePending.length > 0 && count === visiblePending.length;
  elements.selectVisible.indeterminate = count > 0 && count < visiblePending.length;
}

function renderReview() {
  updateProgress();
  replaceChildren(elements.reviewGrid, state.candidates.map(renderReviewCard));
  updateSelection();
  if (!state.currentBatch) {
    elements.batchIdentity.textContent = '当前没有开放批次';
    setStatus(elements.reviewStatus, '本轮审核已完成，可立即开始新一轮采集。');
  } else if (!state.candidates.length) {
    elements.batchIdentity.textContent = `批次 ${state.currentBatch.id}`;
    setStatus(elements.reviewStatus, '当前批次暂无候选内容。');
  } else {
    elements.batchIdentity.textContent = `批次 ${state.currentBatch.id} · ${state.candidates.length} 条候选`;
    setStatus(elements.reviewStatus, '');
  }
  elements.collectNow.disabled = Boolean(state.currentBatch);
}

async function loadReview() {
  const request = beginRequest('review');
  setStatus(elements.reviewStatus, '正在加载审核队列…');
  try {
    const response = await apiRequest('/review/current?limit=50&offset=0', { signal: request.controller.signal });
    if (!response.ok) throw new Error('review');
    const payload = await parsePayload(response);
    if (!isCurrentRequest('review', request)) return;
    state.currentBatch = payload.batch || null;
    state.candidates = Array.isArray(payload.candidates) ? payload.candidates : [];
    state.selection.clear();
    renderReview();
  } catch (error) {
    if (error.name !== 'AbortError' && isCurrentRequest('review', request)) {
      setStatus(elements.reviewStatus, '审核队列加载失败，请稍后重试。', true);
    }
  }
}

function previewCandidate(candidate) {
  elements.previewEyebrow.textContent = `${cleanText(candidate.category)} · ${cleanText(candidate.language)}`;
  elements.previewTitle.textContent = cleanText(candidate.title, '无标题候选');
  elements.previewSummary.textContent = cleanText(candidate.summary, '暂无摘要');
  const meta = [
    ['来源', candidate.source_id],
    ['版权模式', candidate.rights_mode_snapshot],
    ['评分', candidate.score],
    ['发布时间', formatDate(candidate.source_published_at || candidate.created_at)],
  ].map(([term, value]) => {
    const row = document.createDocumentFragment();
    row.append(createElement('dt', '', term), createElement('dd', '', cleanText(String(value ?? ''))));
    return row;
  });
  replaceChildren(elements.previewMeta, meta);
  configureExternalLink(elements.previewOriginal, candidate.canonical_url);
  if (typeof elements.previewDialog.showModal === 'function') elements.previewDialog.showModal();
  else elements.previewDialog.setAttribute('open', '');
}

async function runBulk(candidateIds, decision) {
  const ids = [...new Set(candidateIds)].filter((id) => state.candidates.some((candidate) => candidate.id === id && candidate.status === 'pending'));
  const count = ids.length;
  if (!count || state.mutating) return;
  if (!window.confirm(`确认${decision === 'approve' ? '批准' : '拒绝'} ${count} 条候选资讯？`)) return;
  state.mutating = true;
  updateSelection();
  try {
    const response = await apiRequest('/review/bulk', {
      method: 'POST',
      body: { batchId: state.currentBatch?.id, candidateIds: ids, decision },
    });
    if (!response.ok) throw new Error('bulk');
    await loadReview();
  } catch {
    setStatus(elements.reviewStatus, '批量操作失败，队列未改动，请重试。', true);
  } finally {
    state.mutating = false;
    updateSelection();
  }
}

async function retryCandidate(candidate) {
  if (!candidate || candidate.status !== 'processing_error' || state.mutating) return;
  if (!window.confirm('确认重新处理这条候选资讯？')) return;
  state.mutating = true;
  try {
    const response = await apiRequest(`/review/${encodeURIComponent(candidate.id)}/retry`, { method: 'POST' });
    if (!response.ok) throw new Error('retry');
    await loadReview();
  } catch {
    setStatus(elements.reviewStatus, '重试请求失败，请稍后再试。', true);
  } finally {
    state.mutating = false;
  }
}

elements.reviewGrid.addEventListener('change', (event) => {
  const checkbox = event.target.closest('.review-select');
  if (!checkbox) return;
  if (checkbox.checked) state.selection.add(checkbox.dataset.id);
  else state.selection.delete(checkbox.dataset.id);
  updateSelection();
});

elements.reviewGrid.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const candidate = state.candidates.find((item) => item.id === button.dataset.id);
  if (!candidate) return;
  if (button.dataset.action === 'preview') previewCandidate(candidate);
  if (button.dataset.action === 'approve') runBulk([candidate.id], 'approve');
  if (button.dataset.action === 'reject') runBulk([candidate.id], 'reject');
  if (button.dataset.action === 'retry') retryCandidate(candidate);
});

elements.selectVisible.addEventListener('change', () => {
  const pending = state.candidates.filter((candidate) => candidate.status === 'pending');
  state.selection.clear();
  if (elements.selectVisible.checked) pending.forEach((candidate) => state.selection.add(candidate.id));
  elements.reviewGrid.querySelectorAll('.review-select').forEach((checkbox) => {
    checkbox.checked = state.selection.has(checkbox.dataset.id);
  });
  updateSelection();
});

elements.bulkApprove.addEventListener('click', () => runBulk([...state.selection], 'approve'));
elements.bulkReject.addEventListener('click', () => runBulk([...state.selection], 'reject'));

function renderErrorRetry(container, message, retry) {
  const wrap = createElement('div', 'empty-state');
  wrap.append(createElement('p', '', message));
  const button = createElement('button', 'secondary-button', '重新加载');
  button.type = 'button';
  button.addEventListener('click', retry);
  wrap.append(button);
  replaceChildren(container, [wrap]);
}

function articleMatches(article) {
  const query = elements.publishedSearch.value.trim().toLocaleLowerCase('zh-CN');
  const status = elements.publishedFilter.value;
  const searchable = `${cleanText(article.title, '')} ${cleanText(article.source_id, '')}`.toLocaleLowerCase('zh-CN');
  return (!query || searchable.includes(query)) && (!status || article.status === status);
}

function renderPublished() {
  const articles = state.articles.filter(articleMatches);
  if (!articles.length) {
    replaceChildren(elements.publishedList, [createElement('p', 'empty-state', '没有符合当前条件的文章。')]);
    return;
  }
  replaceChildren(elements.publishedList, articles.map((article) => {
    const row = createElement('article', 'management-row');
    const copy = createElement('div', 'management-copy');
    copy.append(
      createElement('p', 'eyebrow', `${cleanText(article.category)} · ${cleanText(article.status)}`),
      createElement('h3', '', cleanText(article.title, '无标题文章')),
      createElement('p', 'muted-copy', `${cleanText(article.source_id, '来源未知')} · ${formatDate(article.published_at)} · ${cleanText(article.rights_mode)}`),
    );
    const actions = createElement('div', 'management-actions');
    const internal = createElement('a', 'secondary-button', '站内查看');
    internal.href = `/itnew/article/${encodeURIComponent(cleanText(article.slug, ''))}`;
    const original = createElement('a', 'secondary-button external-link', '查看原文 ↗');
    configureExternalLink(original, article.canonical_url);
    actions.append(internal, original);
    if (article.status === 'published') {
      const button = createElement('button', 'secondary-button danger-button', '下线');
      button.type = 'button';
      button.addEventListener('click', () => unpublishArticle(article));
      actions.append(button);
    }
    row.append(copy, actions);
    return row;
  }));
}

async function loadPublished() {
  const request = beginRequest('articles');
  setStatus(elements.publishedStatus, '正在加载已发布内容…');
  try {
    const response = await apiRequest('/articles?limit=50&offset=0', { signal: request.controller.signal });
    if (!response.ok) throw new Error('articles');
    const payload = await parsePayload(response);
    if (!isCurrentRequest('articles', request)) return;
    state.articles = Array.isArray(payload.items) ? payload.items : [];
    setStatus(elements.publishedStatus, `共 ${state.articles.length} 条记录。`);
    renderPublished();
  } catch (error) {
    if (error.name !== 'AbortError' && isCurrentRequest('articles', request)) {
      setStatus(elements.publishedStatus, '发布记录加载失败。', true);
      renderErrorRetry(elements.publishedList, '无法读取发布记录。', loadPublished);
    }
  }
}

async function unpublishArticle(article) {
  if (state.mutating || !window.confirm(`确认下线《${cleanText(article.title)}》？`)) return;
  state.mutating = true;
  try {
    const response = await apiRequest(`/articles/${encodeURIComponent(article.id)}/unpublish`, { method: 'POST' });
    if (!response.ok) throw new Error('unpublish');
    await loadPublished();
  } catch {
    setStatus(elements.publishedStatus, '下线失败，请重试。', true);
  } finally {
    state.mutating = false;
  }
}

function sourceHealth(source) {
  if (!source.enabled) return ['已停用', 'health-muted'];
  if (source.last_error) return ['需关注', 'health-error'];
  if (source.last_success_at) return ['健康', 'health-good'];
  return ['等待首次采集', 'health-muted'];
}

function renderSources() {
  if (!state.sources.length) {
    replaceChildren(elements.sourcesList, [createElement('p', 'empty-state', '尚未配置采集来源。')]);
    return;
  }
  replaceChildren(elements.sourcesList, state.sources.map((source) => {
    const card = createElement('article', 'management-card');
    const [health, healthClass] = sourceHealth(source);
    card.append(
      createElement('span', `health-pill ${healthClass}`, health),
      createElement('h3', '', cleanText(source.name, source.id)),
      createElement('p', 'muted-copy', `语言 ${cleanText(source.language)} · 固定版权 ${cleanText(source.rights_mode)}`),
      createElement('p', 'detail-line', `最近成功：${formatDate(source.last_success_at, '尚无成功记录')}`),
      createElement('p', 'detail-line', `最近错误：${formatDate(source.last_error_at, '无')} · ${cleanText(source.last_error, '无')}`),
    );
    const homepage = createElement('a', 'external-link', '来源主页 ↗');
    configureExternalLink(homepage, source.homepage_url);
    const toggle = createElement('button', source.enabled ? 'secondary-button danger-button' : 'primary-button', source.enabled ? '停用来源' : '启用来源');
    toggle.type = 'button';
    toggle.addEventListener('click', () => toggleSource(source));
    card.append(homepage, toggle);
    return card;
  }));
}

async function loadSources() {
  const request = beginRequest('sources');
  setStatus(elements.sourcesStatus, '正在检查来源健康…');
  try {
    const response = await apiRequest('/sources', { signal: request.controller.signal });
    if (!response.ok) throw new Error('sources');
    const payload = await parsePayload(response);
    if (!isCurrentRequest('sources', request)) return;
    state.sources = Array.isArray(payload.items) ? payload.items : [];
    setStatus(elements.sourcesStatus, `已检查 ${state.sources.length} 个来源。`);
    renderSources();
  } catch (error) {
    if (error.name !== 'AbortError' && isCurrentRequest('sources', request)) {
      setStatus(elements.sourcesStatus, '来源健康加载失败。', true);
      renderErrorRetry(elements.sourcesList, '无法读取来源状态。', loadSources);
    }
  }
}

async function toggleSource(source) {
  if (state.mutating) return;
  state.mutating = true;
  try {
    const response = await apiRequest(`/sources/${encodeURIComponent(source.id)}/toggle`, {
      method: 'POST',
      body: { enabled: !source.enabled },
    });
    if (!response.ok) throw new Error('toggle');
    await loadSources();
  } catch {
    setStatus(elements.sourcesStatus, '来源状态更新失败，请重试。', true);
  } finally {
    state.mutating = false;
  }
}

function warningText(rawWarnings) {
  if (Array.isArray(rawWarnings)) return rawWarnings.map(String).join('；') || '无';
  if (typeof rawWarnings !== 'string' || !rawWarnings.trim()) return '无';
  try {
    const parsed = JSON.parse(rawWarnings);
    return Array.isArray(parsed) ? parsed.map(String).join('；') || '无' : String(parsed);
  } catch {
    return rawWarnings;
  }
}

function countOrDash(value) {
  return Number.isFinite(Number(value)) ? String(Number(value)) : '—';
}

function renderBatches() {
  if (!state.batches.length) {
    replaceChildren(elements.batchesList, [createElement('p', 'empty-state', '尚无采集批次。')]);
    return;
  }
  replaceChildren(elements.batchesList, state.batches.map((batch) => {
    const row = createElement('article', 'management-row batch-row');
    const copy = createElement('div', 'management-copy');
    copy.append(
      createElement('p', 'eyebrow', `${cleanText(batch.status)} · 批次 ${cleanText(batch.id)}`),
      createElement('h3', '', `候选 ${countOrDash(batch.candidate_count)} / 目标 ${countOrDash(batch.target_count)}`),
      createElement('p', 'muted-copy', `批准 ${countOrDash(batch.approved_count)} · 拒绝 ${countOrDash(batch.rejected_count)} · 错误 ${countOrDash(batch.error_count)}`),
      createElement('p', 'detail-line', `采集：${formatDate(batch.collected_at)} · 关闭：${formatDate(batch.closed_at, '仍开放')}`),
      createElement('p', 'warning-line', `警告：${warningText(batch.warnings_json)}`),
    );
    row.append(copy);
    return row;
  }));
}

async function loadBatches() {
  const request = beginRequest('batches');
  setStatus(elements.batchesStatus, '正在加载采集历史…');
  try {
    const response = await apiRequest('/batches?limit=50&offset=0', { signal: request.controller.signal });
    if (!response.ok) throw new Error('batches');
    const payload = await parsePayload(response);
    if (!isCurrentRequest('batches', request)) return;
    state.batches = Array.isArray(payload.items) ? payload.items : [];
    setStatus(elements.batchesStatus, `共 ${state.batches.length} 个批次。`);
    renderBatches();
  } catch (error) {
    if (error.name !== 'AbortError' && isCurrentRequest('batches', request)) {
      setStatus(elements.batchesStatus, '采集历史加载失败。', true);
      renderErrorRetry(elements.batchesList, '无法读取批次记录。', loadBatches);
    }
  }
}

const viewConfig = {
  review: { title: '审核队列', load: loadReview },
  published: { title: '已发布', load: loadPublished },
  sources: { title: '来源健康', load: loadSources },
  batches: { title: '采集批次', load: loadBatches },
};

function switchView(view) {
  if (!viewConfig[view]) return;
  state.activeView = view;
  elements.viewTitle.textContent = viewConfig[view].title;
  document.querySelectorAll('.view-panel').forEach((panel) => {
    panel.hidden = panel.dataset.view !== view;
  });
  document.querySelectorAll('.nav-button').forEach((button) => {
    if (button.dataset.view === view) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
  if (view !== 'review') viewConfig[view].load();
}

document.querySelector('.sidebar-nav').addEventListener('click', (event) => {
  const button = event.target.closest('.nav-button[data-view]');
  if (button) switchView(button.dataset.view);
});

elements.publishedSearch.addEventListener('input', renderPublished);
elements.publishedFilter.addEventListener('change', renderPublished);

elements.collectNow.addEventListener('click', async () => {
  if (state.currentBatch || state.mutating) return;
  state.mutating = true;
  elements.collectNow.disabled = true;
  setStatus(elements.reviewStatus, '正在启动新一轮采集…');
  try {
    const response = await apiRequest('/collect', { method: 'POST' });
    if (!response.ok) throw new Error('collect');
    await loadReview();
  } catch {
    setStatus(elements.reviewStatus, '采集启动失败，请稍后重试。', true);
  } finally {
    state.mutating = false;
    elements.collectNow.disabled = Boolean(state.currentBatch);
  }
});

elements.logoutButton.addEventListener('click', async () => {
  if (state.mutating) return;
  state.mutating = true;
  try {
    await apiRequest('/logout', { method: 'POST' });
  } finally {
    state.mutating = false;
    showLogin('已安全退出。');
  }
});

restoreUsernamePreference();
restoreSession();
