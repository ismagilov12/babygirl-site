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

  const { orderReference, clientFirstName, clientLastName, clientEmail, clientPhone } = body;
  if (typeof orderReference !== 'string' || !/^BG-[a-z0-9-]+$/i.test(orderReference)) {
    return res.status(400).json({ error: 'Valid orderReference is required' });
  }
  const rows = await sb('bg_order_tracking?order_ref=eq.' + encodeURIComponent(orderReference) + '&select=order_data,paid_at&limit=1');
  const snapshot = Array.isArray(rows) && rows[0];
  const order = snapshot && snapshot.order_data;
  if (!order || order.status === 'lead' || order.payment_status === 'failed') {
    return res.status(409).json({ error: 'Saved order not found' });
  }
  if (snapshot.paid_at || order.payment_status === 'paid') return res.status(409).json({ error: 'Order already paid' });
  const items = Array.isArray(order.items) ? order.items : [];
  const isCod = order.payment_method === 'cod' || order.payment_method === 'np';
  const authoritativeAmount = isCod ? Number(cfg.COD_PREPAYMENT_AMOUNT_UAH) : Number(order.total);
  if (!(authoritativeAmount > 0) || !items.length) {
    return res.status(409).json({ error: 'Invalid saved order amount' });
  }
  // One order line avoids per-unit rounding discrepancies with the saved total.
  const productName = [(isCod ? 'Передплата ' : 'Замовлення ') + cfg.PROJECT_NAME + ' ' + orderReference];
  const productCount = ['1'];
  const productPrice = [authoritativeAmount.toFixed(2)];

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

