export const BATCH_TARGET_SIZE = 30;
export const BODY_SECTION_MAX_BYTES = 400 * 1024;
export const SESSION_TTL_SECONDS = 8 * 60 * 60;
export const LOGIN_WINDOW_SECONDS = 15 * 60;
export const LOGIN_MAX_FAILURES = 5;
export const RIGHTS_MODES = new Set(['licensed_full', 'summary_link']);
export const LANGUAGES = new Set(['zh', 'en']);
export const CATEGORIES = new Set([
  'AI', 'chips', 'internet', 'development', 'security',
  'robotics', 'hardware', 'frontier',
]);

const FALLBACKS = {
  AI: 'ai', chips: 'chips', security: 'security', robotics: 'robotics',
  development: 'development', internet: 'cloud', hardware: 'devices', frontier: 'frontier',
};

export function fallbackForCategory(category) {
  return `/itnew/assets/fallback/${FALLBACKS[category] || 'frontier'}.png`;
}
