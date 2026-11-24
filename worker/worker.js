// マイクローゼット 商品ページ読み取りサーバー(Cloudflare Workers)
// 使い方:
//   GET /?url=<商品ページURL>  → { name, brand, image, price, color, description, url }
//   GET /img?url=<画像URL>      → 画像をそのまま返す(アプリ側で縮小するため CORS 付きで中継)
//
// アプリ以外から使われないよう、許可するオリジンを絞っています。
const ALLOWED_ORIGINS = ['https://rnonow.github.io', 'http://localhost:8765', 'null'];
const MAX_HTML = 3 * 1024 * 1024;   // 3MB
const MAX_IMG = 8 * 1024 * 1024;    // 8MB
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

export default {
  async fetch(req) {
    const origin = req.headers.get('Origin') || '';
    const cors = {
      'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Vary': 'Origin',
    };
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (origin && !ALLOWED_ORIGINS.includes(origin)) return json({ error: 'origin not allowed' }, 403, cors);

    const u = new URL(req.url);
    const target = safeUrl(u.searchParams.get('url'));
    if (!target) return json({ error: 'URLが正しくありません' }, 400, cors);

    try {
      if (u.pathname === '/img') {
        const r = await fetch(target, { headers: { 'User-Agent': UA, 'Accept': 'image/*' }, redirect: 'follow' });
        const type = r.headers.get('Content-Type') || '';
        if (!r.ok || !type.startsWith('image/')) return json({ error: '画像を取得できませんでした' }, 502, cors);
        const buf = await r.arrayBuffer();
        if (buf.byteLength > MAX_IMG) return json({ error: '画像が大きすぎます' }, 413, cors);
        return new Response(buf, { headers: { ...cors, 'Content-Type': type, 'Cache-Control': 'public, max-age=86400' } });
      }

      const r = await fetch(target, { headers: { 'User-Agent': UA, 'Accept': 'text/html', 'Accept-Language': 'ja,en;q=0.8' }, redirect: 'follow' });
      if (!r.ok) return json({ error: `ページを開けませんでした(${r.status})` }, 502, cors);
      const buf = await r.arrayBuffer();
      if (buf.byteLength > MAX_HTML) return json({ error: 'ページが大きすぎます' }, 413, cors);
      const html = decode(buf, r.headers.get('Content-Type'));
      return json(extract(html, r.url || target.href), 200, cors);
    } catch (e) {
      return json({ error: '読み取りに失敗しました' }, 502, cors);
    }
  },
};

function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), { status, headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8' } });
}

// http(s) のみ。社内ネットワークやローカルへのアクセスは拒否
function safeUrl(s) {
  try {
    const u = new URL(s);
    if (!/^https?:$/.test(u.protocol)) return null;
    const h = u.hostname;
    if (h === 'localhost' || h.endsWith('.local') || h.endsWith('.internal') ||
        /^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || h.includes(':')) return null;
    return u;
  } catch { return null; }
}

// 文字コード(Shift_JIS や EUC-JP の日本のECサイトにも対応)
function decode(buf, ctype) {
  let cs = (ctype || '').match(/charset=([\w-]+)/i)?.[1];
  if (!cs) {
    const head = new TextDecoder('latin1').decode(buf.slice(0, 4096));
    cs = head.match(/<meta[^>]+charset=["']?([\w-]+)/i)?.[1];
  }
  try { return new TextDecoder((cs || 'utf-8').toLowerCase()).decode(buf); }
  catch { return new TextDecoder('utf-8').decode(buf); }
}

function unescapeHtml(s) {
  return String(s || '').replace(/&(#x?[0-9a-f]+|amp|lt|gt|quot|apos|#39|nbsp);/gi, (m, e) => {
    const k = e.toLowerCase();
    if (k === 'amp') return '&'; if (k === 'lt') return '<'; if (k === 'gt') return '>';
    if (k === 'quot') return '"'; if (k === 'apos' || k === '#39') return "'"; if (k === 'nbsp') return ' ';
    if (k.startsWith('#x')) return String.fromCodePoint(parseInt(k.slice(2), 16));
    if (k.startsWith('#')) return String.fromCodePoint(parseInt(k.slice(1), 10));
    return m;
  }).trim();
}

function meta(html, key) {
  const re = new RegExp(`<meta[^>]+(?:property|name|itemprop)=["']${key}["'][^>]*>`, 'i');
  const tag = html.match(re)?.[0];
  if (!tag) return '';
  return unescapeHtml(tag.match(/content=["']([^"']*)["']/i)?.[1] || '');
}

function findProduct(node) {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) { for (const n of node) { const p = findProduct(n); if (p) return p; } return null; }
  const t = node['@type'];
  if (t === 'Product' || (Array.isArray(t) && t.includes('Product')) || t === 'ProductGroup') return node;
  for (const k of ['@graph', 'mainEntity', 'itemListElement']) { const p = findProduct(node[k]); if (p) return p; }
  return null;
}

function extract(html, pageUrl) {
  let product = null;
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { product = findProduct(JSON.parse(m[1].trim())); if (product) break; } catch {}
  }
  const pick = v => Array.isArray(v) ? v[0] : v;
  const str = v => typeof v === 'string' ? v : (v && (v.name || v.url || v['@id'])) || '';

  const title = unescapeHtml(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] || '');
  const name = unescapeHtml(str(product?.name)) || meta(html, 'og:title') || meta(html, 'twitter:title') || title;
  const brand = unescapeHtml(str(pick(product?.brand))) || meta(html, 'product:brand') || meta(html, 'og:brand') || '';
  let image = str(pick(product?.image)) || meta(html, 'og:image') || meta(html, 'og:image:secure_url') || meta(html, 'twitter:image');
  if (image) { try { image = new URL(image, pageUrl).href; } catch { image = ''; } }
  const offer = pick(product?.offers);
  const price = offer ? `${offer.price || offer.lowPrice || ''}${offer.priceCurrency ? ' ' + offer.priceCurrency : ''}`.trim()
                      : (meta(html, 'product:price:amount') ? `${meta(html, 'product:price:amount')} ${meta(html, 'product:price:currency')}`.trim() : '');
  const color = unescapeHtml(str(product?.color)) || meta(html, 'product:color') || '';
  const category = unescapeHtml(str(product?.category)) || '';
  const description = (unescapeHtml(str(product?.description)) || meta(html, 'og:description') || meta(html, 'description')).slice(0, 400);
  const site = meta(html, 'og:site_name') || new URL(pageUrl).hostname;

  return { name: name.slice(0, 200), brand: brand.slice(0, 100), image, price, color, category, description, site, url: pageUrl };
}
