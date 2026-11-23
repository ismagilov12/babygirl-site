'use strict';

// Public campaign selected only by the separate /black-friday storefront.
// Catalog records, regular-store discounts and advertising feeds stay unchanged.
const ID = 'babygirl-black-friday-2026';
const NOTE = '[campaign:' + ID + ']';
const money = value => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
const baseUid = uid => String(uid || '').split('|')[0];
const requested = body => body && body.campaign === ID;
const BLACK_FRIDAY_PRICES = Object.freeze({ tee: 1290, hoodie: 2190, crop: 990, babyGirlSuit: 2890 });

// The campaign builder embeds these same rules in the Ukrainian preview.
function campaignIncludes(product) {
  return !!(product && product.uid && product.active !== false && product.family &&
    !/^(?:sg-|plate-|mug-|cup-|baby-girl-sexy-set-)/.test(product.uid) &&
    !/^(?:sg-|(?:plate|mug|cup|tableware|sexy-set)$)/.test(product.family));
}

function campaignPrice(product) {
  if (product.uid === 'suit-baby-girl') return BLACK_FRIDAY_PRICES.babyGirlSuit;
  switch (product.family) {
    case 'tee': case 'icons': case 'soft-rebel': case 'self-love': case 'long':
      return BLACK_FRIDAY_PRICES.tee;
    case 'hoodie': case 'zip': case 'mask':
      return BLACK_FRIDAY_PRICES.hoodie;
    case 'crop':
      return BLACK_FRIDAY_PRICES.crop;
    case 'suit': case 'longsleeve': case 'jacket':
      return Math.round(Number(product.price) * 50) / 100;
    default:
      return Number(product.price);
  }
}

async function apply(result, readCatalog, productTable) {
  if (!result || !result.ok || !Array.isArray(result.breakdown) || !result.breakdown.length) return null;
  const uids = [...new Set(result.breakdown.map(line => baseUid(line.uid)))];
  const query = encodeURIComponent('(' + uids.map(uid => JSON.stringify(uid)).join(',') + ')');
  const rows = await readCatalog(productTable + '?select=uid,family,price,active&active=eq.true&uid=in.' + query);
  if (!Array.isArray(rows)) return null;
  const byUid = new Map(rows.map(product => [product.uid, product]));
  for (const line of result.breakdown) {
    const product = byUid.get(baseUid(line.uid));
    if (!campaignIncludes(product) || !(line.unit_price > 0) || Number(product.price) !== Number(line.unit_price)) return null;
  }
  const breakdown = result.breakdown.map(line => {
    const original = Number(line.unit_price);
    const unit = campaignPrice(byUid.get(baseUid(line.uid)));
    const subtotal = money(unit * line.qty);
    return { ...line, original_price: original, unit_price: unit, subtotal, line_total: subtotal };
  });
  return { ...result, original_total: Number(result.total), breakdown, total: money(breakdown.reduce((sum, line) => sum + line.line_total, 0)) };
}

function priceItems(items, result) {
  const prices = new Map(result.breakdown.map(line => [line.uid, line]));
  return items.map(item => {
    const line = prices.get(baseUid(item.uid));
    const old = line.original_price > line.unit_price ? line.original_price : null;
    return { ...item, qty: Math.max(1, parseInt(item.qty, 10) || 1), price: line.unit_price, price_old: old, campaign: ID };
  });
}

function basketKey(items) {
  const quantities = new Map();
  for (const item of items || []) {
    const uid = String(item.uid || '');
    quantities.set(uid, (quantities.get(uid) || 0) + Math.max(1, parseInt(item.qty, 10) || 1));
  }
  return JSON.stringify([...quantities].sort((a, b) => a[0].localeCompare(b[0])));
}

function matchesOrder(order, items, result, payment) {
  const unitPrices = new Map(result.breakdown.map(line => [baseUid(line.uid), line.unit_price]));
  return !!(order && String(order.notes || '').includes(NOTE) && order.payment_method === payment &&
    Array.isArray(order.items) && order.items.every(item => item.campaign === ID && Number(item.price) === unitPrices.get(baseUid(item.uid))) &&
    basketKey(order.items) === basketKey(items) && money(order.total) === result.total);
}

module.exports = { ID, NOTE, BLACK_FRIDAY_PRICES, campaignIncludes, campaignPrice, requested, apply, priceItems, matchesOrder, money };
