// 每日资讯页面逻辑
(function() {
  const SUPABASE_URL = 'https://krtnriuqfnrmlvvjdqtg.supabase.co';
  const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtydG5yaXVxZm5ybWx2dmpkcXRnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIyOTM0MDMsImV4cCI6MjA5Nzg2OTQwM30.maN7a-bdgBtSup9EDeracnf4Hu6-ix9tQHml8oEIQjs';

  let currentDate = new Date();
  currentDate.setHours(0, 0, 0, 0);
  let selectedCategory = 'all';

  // DOM 元素
  const newsList = document.getElementById('newsList');
  const dateDisplay = document.getElementById('dateDisplay');
  const prevDateBtn = document.getElementById('prevDateBtn');
  const nextDateBtn = document.getElementById('nextDateBtn');
  const tabButtons = document.querySelectorAll('.tab-btn');

  // 初始化
  init();

  function init() {
    // 检查 Supabase 配置
    if (!SUPABASE_URL || !SUPABASE_KEY) {
      showError('❌ 尚未配置 Supabase 数据库<br>请先创建项目并提供凭证');
      return;
    }

    // 事件监听
    prevDateBtn.addEventListener('click', prevDate);
    nextDateBtn.addEventListener('click', nextDate);
    tabButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        tabButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        selectedCategory = btn.dataset.category;
        loadNews();
      });
    });

    // 首次加载
    loadNews();
  }

  function prevDate() {
    currentDate.setDate(currentDate.getDate() - 1);
    updateDateDisplay();
    loadNews();
  }

  function nextDate() {
    if (currentDate < new Date()) {
      currentDate.setDate(currentDate.getDate() + 1);
      updateDateDisplay();
      loadNews();
    }
  }

  function updateDateDisplay() {
    const options = { month: 'short', day: 'numeric', weekday: 'short' };
    dateDisplay.textContent = currentDate.toLocaleDateString('zh-CN', options);

    // 禁用/启用按钮
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    nextDateBtn.disabled = currentDate >= today;
  }

  async function loadNews() {
    showLoading();
    updateDateDisplay();

    try {
      // 构建查询条件
      const startOfDay = new Date(currentDate);
      const endOfDay = new Date(currentDate);
      endOfDay.setDate(endOfDay.getDate() + 1);

      let url = `${SUPABASE_URL}/rest/v1/news?published_at=gte.${startOfDay.toISOString()}&published_at=lt.${endOfDay.toISOString()}&order=published_at.desc`;

      if (selectedCategory !== 'all') {
        url += `&category=eq.${selectedCategory}`;
      }

      const response = await fetch(url, {
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`
        }
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();

      if (!data || data.length === 0) {
        showEmpty();
        return;
      }

      renderNews(data);
    } catch (error) {
      console.error('加载资讯失败:', error);
      showError(`⚠️ 加载失败<br>${error.message}`);
    }
  }

  function renderNews(newsData) {
    newsList.innerHTML = newsData.map(item => `
      <a href="${item.article_url}" target="_blank" rel="noopener" class="news-item-link">
        <div class="news-item">
          <div class="news-item-top">
            <span class="news-category-badge">${getCategoryEmoji(item.category)} ${getCategoryLabel(item.category)}</span>
            <span class="news-item-time">${formatTime(item.published_at)}</span>
          </div>
          <div class="news-item-title">${escapeHtml(item.title)}</div>
          ${item.summary ? `<div class="news-item-summary">${escapeHtml(item.summary)}</div>` : ''}
          <div class="news-item-source">来源：${escapeHtml(item.source)}</div>
        </div>
      </a>
    `).join('');
  }

  function showLoading() {
    newsList.innerHTML = `
      <div class="loading-state">
        <div class="spinner"></div>
        <div>加载资讯中...</div>
      </div>
    `;
  }

  function showEmpty() {
    newsList.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">📭</div>
        <div class="empty-text">这一天还没有资讯</div>
      </div>
    `;
  }

  function showError(message) {
    newsList.innerHTML = `
      <div class="error-state">
        <strong>⚠️ 加载错误</strong>
        ${message}
      </div>
    `;
  }

  function getCategoryEmoji(category) {
    const emojis = { IT: '💻', Finance: '💰', Auto: '🚗', Game: '🎮' };
    return emojis[category] || '📰';
  }

  function getCategoryLabel(category) {
    const labels = { IT: 'IT业界', Finance: '金融', Auto: '汽车', Game: '游戏' };
    return labels[category] || category;
  }

  function formatTime(dateStr) {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now - date;

    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;

    return date.toLocaleDateString('zh-CN');
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
})();
