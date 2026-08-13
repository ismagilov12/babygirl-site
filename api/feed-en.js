// api/feed-en.js — EN/EUR product feed для Meta Commerce Manager (реклама на ЕС).
// URL: https://babygirl.com.ua/feed-en.xml (rewrite в vercel.json) -> /api/feed-en
//
// Отличия от /feed.xml (украинский фид):
//   1. Валюта EUR, цены считаются как на /en:  price = UAH x EN_MARKUP_BASE / EUR_RATE,
//      sale_price = UAH x EN_MARKUP / EUR_RATE  (EN_MARKUP = base x (100 - EN_SALE_PCT)/100).
//   2. g:link ведёт на /en?p=<uid>&c=<color>  (не на украинскую главную).
//   3. Английские title/description из api/_en_i18n.js (в БД описания украинские).
//   4. Исключены EN_HIDDEN — товары с принтами знаменитостей/лицензионных персонажей
//      (те же 16+, что скрыты на /en): у Meta это IP-strike и бан кабинета.
//   5. Товары showgirl (family sg-*) по умолчанию НЕ в фиде — бельё режется модерацией Meta.
//      Включить: /feed-en.xml?sg=1
//
// g:id совпадает с content_ids, которые шлёт пиксель на /en: <uid> или <uid>-<colorCode>.
// Если поменять формат здесь — сломается матчинг DPA, поправить и fbSku() в en.html.

const cfg = require('./_config');
const i18n = require('./_en_i18n');
const T = cfg.T;

const SITE = 'https://www.' + String(cfg.SITE_DOMAIN || 'babygirl.com.ua').replace(/^www\./, '');
const BRAND = cfg.PROJECT_NAME || 'BabyGirl';
const CATEGORY = 'Apparel & Accessories > Clothing';

// Товары, чьи названия/принты Meta режет по adult-политике (и/или дают strike).
// В фид попадают, но помечены custom_label_3=risky — в Commerce Manager собери
// product set по custom_label_3 = safe и крути рекламу только по нему.
const META_RISKY = {
  'only-fans': 1, 'crop-only-fans': 1,     // название = adult-сервис
  'crop-pornstar': 1,                      // принт «Porn Star»
  'crop-gods-favorite': 1,                 // принт «GOD'S FAVORITE SLUT»
  'good-pussy': 1, 'crop-goodpussy': 1,    // двусмысленность в названии
  'erotica': 1,                            // название
  'belt': 1, 'sg-garter': 1                // бельё/пояс для чулок
};

// Битые картинки, которые Meta не сможет забрать (иначе весь item уходит в ошибку фида).
const BROKEN_IMG = { 'assets/crop-sexy-white.webp': 1 };

// Держать в синхроне с en.html / showgirl-en.html и с api/westernbid.js
const FX = Number(process.env.WB_FX_UAH_PER_UNIT || 53.43);
const MARKUP_BASE = Number(process.env.WB_PRICE_MARKUP || 2);
const SALE_PCT = Number(process.env.WB_EN_SALE_PCT != null ? process.env.WB_EN_SALE_PCT : 20);
const MARKUP = Math.round(MARKUP_BASE * (100 - SALE_PCT)) / 100;

function xmlEscape(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function stripTags(s) {
  return String(s == null ? '' : s).replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

function absUrl(path) {
  if (!path) return '';
  if (/^https?:\/\//i.test(path)) return path;
  return SITE + '/' + String(path).replace(/^\/+/, '');
}

function buildLink(uid, colorCode, isSg) {
  const base = SITE + (isSg ? '/showgirl-en' : '/en');
  return base + '?p=' + encodeURIComponent(uid) + (colorCode ? '&c=' + encodeURIComponent(colorCode) : '');
}

function isImage(url) {
  return !!url && /\.(webp|jpe?g|png|gif)(\?.*)?$/i.test(String(url));
}

function eur(uah, mult) {
  return (Math.round((Number(uah || 0) * mult / FX) * 100) / 100).toFixed(2);
}

function makeItem(p, color) {
  const isVariant = !!color;
  const isSg = /^sg-/.test(String(p.family || ''));
  const sku = isVariant ? (p.uid + '-' + color.code) : p.uid;

  const baseTitle = i18n.EN_TITLE[p.uid] || p.title;
  const title = isVariant ? (baseTitle + ' — ' + (color.name || color.code)) : baseTitle;

  const mainPhoto = isVariant && color.photo ? color.photo : (p.photo_main || (Array.isArray(p.photos) && p.photos[0]));
  if (!mainPhoto || !isImage(mainPhoto) || BROKEN_IMG[mainPhoto]) return null;

  const allPhotos = Array.isArray(p.photos) ? p.photos : [];
  const extras = allPhotos.filter(u => isImage(u) && u !== mainPhoto && !BROKEN_IMG[u]).slice(0, 20);

  // Описание берём ТОЛЬКО английское. Украинское из БД в EU-рекламу пускать нельзя.
  const desc = stripTags(i18n.EN_DESCR[p.uid] || (BRAND + ' · ' + baseTitle + (isVariant ? ' (' + (color.name || color.code) + ')' : '')));

  const sizes = Array.isArray(p.sizes) && p.sizes.length ? p.sizes.join(', ') : 'ONE SIZE';
  const uah = Number(p.price) || 0;
  if (uah <= 0) return null;

  const priceFull = eur(uah, MARKUP_BASE) + ' EUR';
  const priceSale = eur(uah, MARKUP) + ' EUR';
  const hasSale = SALE_PCT > 0;

  const lines = [];
  lines.push('    <item>');
  lines.push('      <g:id>' + xmlEscape(sku) + '</g:id>');
  if (isVariant) lines.push('      <g:item_group_id>' + xmlEscape(p.uid) + '</g:item_group_id>');
  lines.push('      <g:title>' + xmlEscape(title) + '</g:title>');
  lines.push('      <g:description>' + xmlEscape(desc) + '</g:description>');
  lines.push('      <g:link>' + xmlEscape(buildLink(p.uid, isVariant ? color.code : null, isSg)) + '</g:link>');
  lines.push('      <g:image_link>' + xmlEscape(absUrl(mainPhoto)) + '</g:image_link>');
  extras.forEach(u => { lines.push('      <g:additional_image_link>' + xmlEscape(absUrl(u)) + '</g:additional_image_link>'); });
  lines.push('      <g:availability>in stock</g:availability>');
  lines.push('      <g:condition>new</g:condition>');
  lines.push('      <g:price>' + xmlEscape(priceFull) + '</g:price>');
  if (hasSale) lines.push('      <g:sale_price>' + xmlEscape(priceSale) + '</g:sale_price>');
  lines.push('      <g:brand>' + xmlEscape(BRAND) + '</g:brand>');
  if (isVariant && color.name) lines.push('      <g:color>' + xmlEscape(color.name) + '</g:color>');
  lines.push('      <g:size>' + xmlEscape(sizes) + '</g:size>');
  lines.push('      <g:gender>female</g:gender>');
  lines.push('      <g:age_group>adult</g:age_group>');
  lines.push('      <g:google_product_category>' + xmlEscape(CATEGORY) + '</g:google_product_category>');
  lines.push('      <g:identifier_exists>no</g:identifier_exists>');
  lines.push('      <g:shipping_weight>0.35 kg</g:shipping_weight>');
  lines.push('      <g:custom_label_0>' + xmlEscape(p.family || '') + '</g:custom_label_0>');
  if (p.ribbon) lines.push('      <g:custom_label_1>' + xmlEscape(p.ribbon) + '</g:custom_label_1>');
  lines.push('      <g:custom_label_2>' + xmlEscape(Number(eur(uah, MARKUP)) >= 60 ? 'high-ticket' : 'entry') + '</g:custom_label_2>');
  lines.push('      <g:custom_label_3>' + xmlEscape((META_RISKY[p.uid] || isSg) ? 'risky' : 'safe') + '</g:custom_label_3>');
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

  const withSg = String((req.query && req.query.sg) || '') === '1';

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
    const family = String(p.family || '');
    if (i18n.EN_HIDDEN[p.uid]) continue;          // celeb/IP принты — вне EU-рекламы
    if (family === 'sg-addon') continue;          // скрытые SKU апселла
    const isSg = /^sg-/.test(family);
    if (isSg && !withSg) continue;                // бельё — только по ?sg=1
    if (!isSg && p.in_grid === false) continue;   // не в витрине UA

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
    '    <title>' + xmlEscape(BRAND) + ' Catalog (EN / EUR)</title>\n' +
    '    <link>' + SITE + '/en</link>\n' +
    '    <description>' + xmlEscape(BRAND) + ' international product feed for Meta Catalog — EUR, English</description>\n' +
    '    <lastBuildDate>' + now + '</lastBuildDate>\n' +
    items.join('\n') + '\n' +
    '  </channel>\n' +
    '</rss>\n';

  res.status(200);
  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=600, s-maxage=600');
  res.send(xml);
};
