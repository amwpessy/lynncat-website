import { handleSina } from './sina.js';
import { handleNewsFetch, runNewsFetch } from './newsFetch.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/xxxc/sina') {
      return handleSina(request);
    }

    if (url.pathname === '/news/fetch') {
      return handleNewsFetch(request, env);
    }

    return env.ASSETS.fetch(request);
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(runNewsFetch(env));
  }
};
