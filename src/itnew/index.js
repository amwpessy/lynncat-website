import { handleItnewAdminRequest } from './admin.js';
import { collectNextBatch } from './collector.js';
import { handleItnewPublicRequest } from './public.js';

const defaultHandlers = {
  admin: handleItnewAdminRequest,
  public: handleItnewPublicRequest,
};

function redirectWithTrailingSlash(url, pathname) {
  const destination = new URL(url);
  destination.pathname = pathname;
  return Response.redirect(destination, 308);
}

export async function handleItnewRequest(request, env, ctx = {}, handlers = defaultHandlers) {
  const url = new URL(request.url);
  const { pathname } = url;

  if (pathname === '/itnew/admin/api' || pathname.startsWith('/itnew/admin/api/')) {
    return handlers.admin(request, env, ctx);
  }
  if (pathname === '/itnew/api' || pathname.startsWith('/itnew/api/')
    || pathname === '/itnew/images' || pathname.startsWith('/itnew/images/')) {
    return handlers.public(request, env, ctx);
  }
  if (/^\/itnew\/article\/[^/]+$/u.test(pathname)) {
    // Fetch the canonical extensionless asset so Cloudflare's HTML handling
    // serves article.html instead of redirecting the browser and dropping the slug.
    return env.ASSETS.fetch(new Request(new URL('/itnew/article', url), request));
  }
  if (pathname === '/itnew/admin') {
    return redirectWithTrailingSlash(url, '/itnew/admin/');
  }
  if (pathname === '/itnew') {
    return redirectWithTrailingSlash(url, '/itnew/');
  }
  return env.ASSETS.fetch(request);
}

export function runItnewCollection(env) {
  return collectNextBatch(env);
}
