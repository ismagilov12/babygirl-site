// api/wayforpay.js — створює payment intent у WayForPay.
// Скелет із досвіду ULTERA · SECURITY v2.
//
// Контракт від фронта (НОВИЙ — без amount):
//   { orderReference, items: [{uid, qty, size?}], clientFirstName, clientLastName,
//     clientEmail, clientPhone, payment_method? }
//
// Якщо payment_method === 'cod' і cfg.COD_PREPAYMENT_AMOUNT_UAH > 0 — сервер
// замінює items на одну позицію "Передплата ..." з фіксованою сумою з env/config
// (cf. ULTERA: для наложки беремо тільки 500₴ передоплати).
//
// Інакше — server amount recompute з RPC compute_order_total. Фронт ціни ігноруємо.

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

async function computeTotal(items) {
  return await sb('rpc/compute_order_total', {
    method: 'POST',
    body: JSON.stringify({ p_items: items, p_table: T.PRODUCTS })
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
  if (!orderReference || typeof orderReference !== 'string') {
    return res.status(400).json({ error: 'orderReference is required' });
  }
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'items must be a non-empty array of {uid, qty}' });
  }

  // === Branch: COD prepayment ===
  let productName, productCount, productPrice, authoritativeAmount;
  if (payment_method === 'cod' && cfg.COD_PREPAYMENT_AMOUNT_UAH > 0) {
    authoritativeAmount = Number(cfg.COD_PREPAYMENT_AMOUNT_UAH);
    productName  = ['Передплата ' + cfg.PROJECT_NAME];
    productCount = ['1'];
    productPrice = [authoritativeAmount.toFixed(2)];
  } else {
    // === Branch: full prepay — server amount recompute ===
    const priceResult = await computeTotal(items);
    if (!priceResult || !priceResult.ok) {
      return res.status(400).json({
        error: (priceResult && priceResult.error) || 'Price calculation failed',
        missing: priceResult && priceResult.missing
      });
    }
    authoritativeAmount = Number(priceResult.total);
    if (!(authoritativeAmount > 0)) {
      return res.status(400).json({ error: 'Computed amount is not positive' });
    }
    const uids = items.map(it => String(it.uid || ''));
    const names = await getProductNames(uids);
    productName = []; productCount = []; productPrice = [];
    for (const line of priceResult.breakdown) {
      productName.push(names[line.uid] || line.uid);
      productCount.push(String(line.qty));
      productPrice.push(Number(line.unit_price).toFixed(2));
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
  const returnUrl  = base + '/?paid=1&order=' + encodeURIComponent(orderReference);
  const serviceUrl = base + '/api/wayforpay-callback';

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
      returnUrl, serviceUrl,
      language: 'UA'
    },
    authoritativeAmount
  });
};
