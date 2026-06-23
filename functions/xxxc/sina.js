// Cloudflare Pages Function — 代理新浪行情接口
// 路由：/xxxc/sina?list=gb_$inx,gb_$ixic
// 浏览器无法直接请求 hq.sinajs.cn（需要 Referer 头、且被 CORS 拦截），
// 这里在服务端补上 Referer 并加上 CORS 头转发回去。
export async function onRequest(context) {
  const url = new URL(context.request.url);
  const list = url.searchParams.get('list');
  if (!list) {
    return new Response('missing ?list=', { status: 400 });
  }
  // 必须用原始 list（$、逗号不能被 URL 编码，否则新浪无法识别）
  const upstream = await fetch('https://hq.sinajs.cn/list=' + list, {
    headers: { 'Referer': 'https://finance.sina.com.cn' }
  });
  // 仅解析数字字段，GBK 中的中文名不影响逗号分隔结构，直接透传字节即可
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'access-control-allow-origin': '*',
      'cache-control': 'public, max-age=10'
    }
  });
}
