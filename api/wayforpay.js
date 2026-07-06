// api/wayforpay.js — створює payment intent у WayForPay.

const crypto = require('crypto');
const cfg = require('./_config');
const T = cfg.T;
const ALLOWED_ORIGINS_EXACT = new Set(cfg.ALLOWED_ORIGINS_EXACT);

function setCors(req, res) {
  const origin = req.headers.origin || '';
  const isAllowed =
    ALLOWED_ORIGINS_EXACT.has(origin) ||
    cfg.ALLOWED_ORIGIN_SUFFIX.some(s => origin.endsWith(s));
  if (isAllowed) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  return isAllowed;
}

function getClientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return req.headers['x-real-ip'] || (req.socket && req.socket.remoteAddress) || 'unknown';
}

async function sb(path, opts) {
  opts = opts || {};
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  const r = await fetch(url + '/rest/v1/' + path, {
    method: opts.method || 'GET',
    headers: Object.assign({
      'apikey': key,
      'Authorization': 'Bearer ' + key,
      'Content-Type': 'application/json'
    }, opts.headers || {}),
    body: opts.body
  });
  if (!r.ok) {
    const t = await r.text().catch(() => '');
    console.warn('[wfp/sb]', path, r.status, t.slice(0, 200));
    return null;
  }
  const txt = await r.text();
  return txt ? JSON.parse(txt) : null;
}

async function rateLimit(ip) {
  const r = await sb('rpc/check_and_increment_rate_limit', {
    method: 'POST',
    body: JSON.stringify({ p_ip: ip, p_endpoint: 'wayforpay', p_limit: cfg.RL.wayforpay })
  });
  return r || { allowed: true, skipped: true };
}

// Кошик зберігає складений uid "base|colorCode" для кольорових товарів;
// у bg_products лише base-uid, тому перед перерахунком цін відрізаємо суфікс.
function baseUid(u) { return String(u || '').split('|')[0]; }

async function computeTotal(items) {
  const norm = (items || []).map(it => ({
    uid: baseUid(it && it.uid),
    qty: parseInt((it && it.qty) || 1, 10) || 1
  }));
  return await sb('rpc/compute_order_total', {
    method: 'POST',
    body: JSON.stringify({ p_items: norm, p_table: T.PRODUCTS })
  });
}

async function getProductNames(uids) {
  if (!uids.length) return {};
  const q = encodeURIComponent('(' + uids.map(u => '"' + u + '"').join(',') + ')');
  const rows = await sb(T.PRODUCTS + '?uid=in.' + q + '&select=uid,title,color_name');
  const byUid = {};
  if (Array.isArray(rows)) {
    for (const row of rows) {
      const name = [row.title, row.color_name].filter(Boolean).join(' / ');
      byUid[row.uid] = name || row.title || row.uid;
    }
  }
  return byUid;
}

// Server-side validate promo code (НЕ довіряємо percent з фронту).
// Returns { valid:bool, percent:number, reason?:string }.
async function validatePromoServer(code, subtotalUAH) {
  if (!code) return { valid: false, percent: 0 };
  const safe = String(code).toUpperCase().trim();
  if (!safe) return { valid: false, percent: 0 };
  const rows = await sb(T.PROMOS + '?code=eq.' + encodeURIComponent(safe) + '&active=eq.true&limit=1');
  if (!Array.isArray(rows) || !rows.length) return { valid: false, percent: 0, reason: 'not_found' };
  const row = rows[0];
  if (row.expires_at && new Date(row.expires_at) < new Date()) return { valid: false, percent: 0, reason: 'expired' };
  if (row.min_total && Number(subtotalUAH) < Number(row.min_total)) {
    return { valid: false, percent: 0, reason: 'min_total_not_met' };
  }
  const pct = Math.max(0, Math.min(100, parseInt(row.percent || 0, 10)));
  return { valid: true, percent: pct };
}

// Реплікує клієнтську логіку BUNDLE_DISCOUNT_PCT: кожна одиниця починаючи з 2-ї
// отримує -bundlePct%. Потім поверх — promoPct% з усієї суми.
// Повертає { lines: [{uid, qty, unitPriceAfter, lineTotalAfter}], total }.
function applyDiscounts(breakdown, bundlePct, promoPct) {
  bundlePct = Math.max(0, Math.min(100, Number(bundlePct) || 0));
  promoPct  = Math.max(0, Math.min(100, Number(promoPct)  || 0));
  let unitIdx = 0;
  const lines = [];
  for (const line of breakdown) {
    const qty  = parseInt(line.qty || 1, 10);
    const unit = Number(line.unit_price);
    let lineSum = 0;
    for (let i = 0; i < qty; i++) {
      unitIdx++;
      let u = unit;
      if (unitIdx >= 2 && bundlePct > 0) {
        u = unit * (100 - bundlePct) / 100;
      }
      if (promoPct > 0) {
        u = u * (100 - promoPct) / 100;
      }
      lineSum += u;
    }
    // Округлюємо суму лінії до копійок; усереднена ціна за одиницю.
    const lineTotalAfter = Math.round(lineSum * 100) / 100;
    const unitPriceAfter = Math.round((lineTotalAfter / qty) * 100) / 100;
    lines.push({
      uid: line.uid,
      qty: qty,
      unitPriceAfter: unitPriceAfter,
      lineTotalAfter: lineTotalAfter
    });
  }
  // Фінальна сума = сума ліній (а не line.qty * unitPriceAfter, бо округлення).
  // Але для WFP підпис рахується саме як sum(productPrice[i]*productCount[i]).
  // Тому пересчитуємо total через unitPriceAfter * qty, як це робить WFP.
  let total = 0;
  for (const ln of lines) total += ln.unitPriceAfter * ln.qty;
  total = Math.round(total * 100) / 100;
  return { lines, total };
}

module.exports = async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const merchantAccount = process.env.WAYFORPAY_MERCHANT;
  const secretKey = process.env.WAYFORPAY_SECRET;
  const merchantDomainName = process.env.WAYFORPAY_DOMAIN || cfg.SITE_DOMAIN;
  if (!merchantAccount || !secretKey) {
    console.error('[wfp] env vars missing');
    return res.status(500).json({ error: 'Payment system not configured' });
  }

  const ip = getClientIp(req);
  const rl = await rateLimit(ip);
  if (!rl.allowed) {
    res.setHeader('Retry-After', String(rl.retry_after || 60));
    return res.status(429).json({ error: 'Too many requests' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { return res.status(400).json({ error: 'Invalid JSON' }); }
  }
  body = body || {};

  const { orderReference, items, clientFirstName, clientLastName, clientEmail, clientPhone, payment_method } = body;
  // Discount inputs (опціональні): promo_code валідується серверно, bundle_discount_pct
  // береться з фронту як параметр UX, але обмежується розумним діапазоном.
  const promoCodeIn  = (typeof body.promo_code === 'string' ? body.promo_code : '').trim();
  const bundlePctIn  = Math.max(0, Math.min(50, parseInt(body.bundle_discount_pct || 0, 10) || 0));

  if (!orderReference || typeof orderReference !== 'string') {
    return res.status(400).json({ error: 'orderReference is required' });
  }
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'items must be a non-empty array of {uid, qty}' });
  }

  let productName, productCount, productPrice, authoritativeAmount;
  if (payment_method === 'cod' && cfg.COD_PREPAYMENT_AMOUNT_UAH > 0) {
    // COD передплата — фіксована сума, промо/bundle не застосовуються.
    authoritativeAmount = Number(cfg.COD_PREPAYMENT_AMOUNT_UAH);
    productName  = ['Передплата ' + cfg.PROJECT_NAME];
    productCount = ['1'];
    productPrice = [authoritativeAmount.toFixed(2)];
  } else {
    const priceResult = await computeTotal(items);
    if (!priceResult || !priceResult.ok) {
      return res.status(400).json({
        error: (priceResult && priceResult.error) || 'Price calculation failed',
        missing: priceResult && priceResult.missing
      });
    }
    const subtotal = Number(priceResult.total);
    if (!(subtotal > 0)) {
      return res.status(400).json({ error: 'Computed amount is not positive' });
    }

    // Серверна валідація промо (від min_total рахуємо ДО bundle, бо так на фронті).
    const promo = await validatePromoServer(promoCodeIn, subtotal);
    // Застосовуємо знижки (bundle + promo).
    const discounted = applyDiscounts(priceResult.breakdown, bundlePctIn, promo.percent);
    authoritativeAmount = discounted.total;
    if (!(authoritativeAmount > 0)) {
      return res.status(400).json({ error: 'Discounted amount is not positive' });
    }

    const uids = items.map(it => baseUid(it.uid));
    const names = await getProductNames(uids);
    productName = []; productCount = []; productPrice = [];
    for (const line of discounted.lines) {
      productName.push(names[line.uid] || line.uid);
      productCount.push(String(line.qty));
      productPrice.push(line.unitPriceAfter.toFixed(2));
    }
  }

  const orderDate = Math.floor(Date.now() / 1000);
  const currency = 'UAH';
  const amountStr = authoritativeAmount.toFixed(2);

  const signatureFields = [
    merchantAccount, merchantDomainName, orderReference,
    String(orderDate), amountStr, currency,
    ...productName, ...productCount, ...productPrice
  ];
  const merchantSignature = crypto
    .createHmac('md5', secretKey)
    .update(signatureFields.join(';'), 'utf8')
    .digest('hex');

  const base = 'https://' + merchantDomainName;
  // approvedUrl/declinedUrl ведут НАПРЯМУЮ на /api/thanks (serverless),
  // минуя /thanks: там rewrite + cleanUrls конфликтовали и страница висла
  // (белый экран после оплаты). /api/thanks принимает и GET, и POST от WFP.
  // Pass amount + num_items so thanks page can fire browser Pixel Purchase with
  // accurate value. Note: for COD this is the prepayment (200), full order total
  // goes via CAPI from wayforpay-callback (bg_orders.total).
  const numItems = items.reduce(function(s, it){ return s + (parseInt((it && it.qty) || 1, 10)); }, 0);
  const thanksQs = '&order=' + encodeURIComponent(orderReference) +
                   '&amount=' + encodeURIComponent(amountStr) +
                   '&n=' + encodeURIComponent(String(numItems));
  const approvedUrl = base + '/api/thanks?paid=1' + thanksQs;
  const declinedUrl = base + '/api/thanks?paid=0' + thanksQs;
  const serviceUrl  = base + '/api/wayforpay-callback';

  return res.status(200).json({
    ok: true,
    paymentUrl: 'https://secure.wayforpay.com/pay',
    formData: {
      merchantAccount,
      merchantAuthType: 'SimpleSignature',
      merchantDomainName,
      merchantSignature,
      orderReference,
      orderDate: String(orderDate),
      amount: amountStr,
      currency,
      productName, productCount, productPrice,
      clientFirstName: clientFirstName || '',
      clientLastName: clientLastName || '',
      clientEmail: clientEmail || '',
      clientPhone: clientPhone || '',
      returnUrl: approvedUrl,
      serviceUrl,
      approvedUrl,
      declinedUrl,
      language: 'UA'
    },
    authoritativeAmount
  });
};
