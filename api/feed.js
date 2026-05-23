// api/feed.js — Facebook/Google Shopping XML product feed for BabyGirl
// URL: https://babygirl.com.ua/feed.xml (rewrite в vercel.json) → /api/feed
// Тянет из bg_products (active=true), генерит XML в формате Google Shopping (RSS 2.0 + g:* namespace).
// Multi-color товары -> отдельный SKU на цвет + общий g:item_group_id.

const cfg = require('./_config');
const T = cfg.T;

// Все ссылки в фиде ведут на www-домен. Apex (babygirl.com.ua) отдаёт 307 на www,
// FB scraper за redirect не всегда следует, отсюда пустые фото у некоторых товаров.
const SITE = 'https://www.' + String(cfg.SITE_DOMAIN || 'babygirl.com.ua').replace(/^www\./, '');
const BRAND = cfg.PROJECT_NAME || 'BabyGirl';
const CATEGORY = 'Apparel & Accessories > Clothing';

function xmlEscape(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function absUrl(path) {
  if (!path) return '';
  if (/^https?:\/\//i.test(path)) return path;
  return SITE + '/' + String(path).replace(/^\/+/, '');
}

function buildLink(uid, colorCode) {
  return SITE + '/?p=' + encodeURIComponent(uid) + (colorCode ? '&c=' + encodeURIComponent(colorCode) : '');
}

function isImage(url) {
  if (!url) return false;
  return /\.(webp|jpe?g|png|gif)(\?.*)?$/i.test(String(url));
}

function makeItem(p, color) {
  const isVariant = !!color;
  const sku = isVariant ? (p.uid + '-' + color.code) : p.uid;
  const title = isVariant ? (p.title + ' — ' + (color.name || color.code)) : p.title;
  const mainPhoto = isVariant && color.photo ? color.photo : (p.photo_main || (Array.isArray(p.photos) && p.photos[0]));
  if (!mainPhoto) return null;

  const allPhotos = Array.isArray(p.photos) ? p.photos : [];
  const extras = allPhotos
    .filter(u => isImage(u) && u !== mainPhoto)
    .slice(0, 20);

  const desc = p.description
    || (BRAND + ' · ' + p.title + (isVariant ? ' (' + (color.name || color.code) + ')' : ''));

  const sizes = Array.isArray(p.sizes) && p.sizes.length ? p.sizes.join(', ') : 'ONE SIZE';
  const price = (Number(p.price) || 0).toFixed(2) + ' UAH';

  const lines = [];
  lines.push('    <item>');
  lines.push('      <g:id>' + xmlEscape(sku) + '</g:id>');
  if (isVariant) lines.push('      <g:item_group_id>' + xmlEscape(p.uid) + '</g:item_group_id>');
  lines.push('      <g:title>' + xmlEscape(title) + '</g:title>');
  lines.push('      <g:description>' + xmlEscape(desc) + '</g:description>');
  lines.push('      <g:link>' + xmlEscape(buildLink(p.uid, isVariant ? color.code : null)) + '</g:link>');
  lines.push('      <g:image_link>' + xmlEscape(absUrl(mainPhoto)) + '</g:image_link>');
  extras.forEach(u => {
    lines.push('      <g:additional_image_link>' + xmlEscape(absUrl(u)) + '</g:additional_image_link>');
  });
  lines.push('      <g:availability>in stock</g:availability>');
  lines.push('      <g:condition>new</g:condition>');
  lines.push('      <g:price>' + xmlEscape(price) + '</g:price>');
  if (p.price_old && Number(p.price_old) > Number(p.price)) {
    lines.push('      <g:sale_price>' + xmlEscape(price) + '</g:sale_price>');
  }
  lines.push('      <g:brand>' + xmlEscape(BRAND) + '</g:brand>');
  if (isVariant && color.name) lines.push('      <g:color>' + xmlEscape(color.name) + '</g:color>');
  lines.push('      <g:size>' + xmlEscape(sizes) + '</g:size>');
  lines.push('      <g:gender>female</g:gender>');
  lines.push('      <g:age_group>adult</g:age_group>');
  lines.push('      <g:google_product_category>' + xmlEscape(CATEGORY) + '</g:google_product_category>');
  lines.push('      <g:identifier_exists>no</g:identifier_exists>');
  lines.push('      <g:custom_label_0>' + xmlEscape(p.family || '') + '</g:custom_label_0>');
  if (p.ribbon) lines.push('      <g:custom_label_1>' + xmlEscape(p.ribbon) + '</g:custom_label_1>');
  lines.push('    </item>');
  return lines.join('\n');
}

function fail(res, code, msg) {
  res.status(code);
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  res.send(String(msg || 'error'));
}

module.exports = async function handler(req, res) {
  const sbUrl = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!sbUrl || !key) { fail(res, 500, 'Supabase env not configured'); return; }

  let rows;
  try {
    const r = await fetch(sbUrl + '/rest/v1/' + T.PRODUCTS + '?select=uid,title,family,price,price_old,ribbon,photo_main,photos,sizes,colors,description,active,in_grid&active=eq.true&order=sort_order.asc', {
      headers: { apikey: key, Authorization: 'Bearer ' + key }
    });
    if (!r.ok) { fail(res, 502, 'Supabase fetch failed: ' + r.status); return; }
    rows = await r.json();
  } catch (e) {
    fail(res, 500, 'fetch err: ' + (e && e.message));
    return;
  }

  const items = [];
  for (const p of (rows || [])) {
    if (p.in_grid === false) continue;
    if (Array.isArray(p.colors) && p.colors.length > 0) {
      for (const c of p.colors) {
        if (!c || !c.code) continue;
        const it = makeItem(p, c);
        if (it) items.push(it);
      }
    } else {
      const it = makeItem(p, null);
      if (it) items.push(it);
    }
  }

  const now = new Date().toUTCString();
  const xml =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<rss xmlns:g="http://base.google.com/ns/1.0" version="2.0">\n' +
    '  <channel>\n' +
    '    <title>' + xmlEscape(BRAND) + ' Catalog</title>\n' +
    '    <link>' + SITE + '</link>\n' +
    '    <description>' + xmlEscape(BRAND) + ' product feed for Facebook Catalog / Google Merchant Center</description>\n' +
    '    <lastBuildDate>' + now + '</lastBuildDate>\n' +
    items.join('\n') + '\n' +
    '  </channel>\n' +
    '</rss>\n';

  res.status(200);
  res.setHeader('Content-Type', 'application/xml; c