// api/westernbid.js — BabyGirl international checkout (EN version, /en) via Western Bid.
// Скелет із ULTERA api/westernbid.js, адаптовано під BabyGirl (_config, bg_* таблиці,
// промо/бандл-знижки як в api/wayforpay.js). Створює замовлення в bg_orders
// (payment_method='westernbid', payment_status='pending'), номер замовлення
// вшивається у WB `invoice`, IPN-callback знаходить рядок і лишається ідемпотентним.
//
// Env vars:
//   WB_LOGIN                merchant login (public, goes into the form)
//   WB_SECRET               merchant secret (server only, used for md5 sign)
//   WB_ENDPOINT             gateway URL (default https://shop.westernbid.info)
//   WB_CURRENCY             currency_code sent to WB (default 'EUR')
//   WB_FX_UAH_PER_UNIT      UAH per 1 unit of WB_CURRENCY (frontend en.html EUR_RATE must match!)
//   WB_RETURN_URL           success return (default https://babygirl.com.ua/en?paid=1)
//   WB_CANCEL_URL           cancel return  (default https://babygirl.com.ua/en?paid=0)
//   WB_NOTIFY_URL           IPN url (default https://babygirl.com.ua/api/westernbid-callback)
//   WB_GATE                 optional; 'stripe.com' routes via Stripe (default PayPal)
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//   TURNSTILE_SECRET        (optional)

const crypto = require('crypto');
const cfg = require('./_config');
const tg = require('./_tg');
const T = cfg.T;
const ALLOWED_ORIGINS_EXACT = new Set(cfg.ALLOWED_ORIGINS_EXACT);

const SITE_BASE = 'https://' + cfg.SITE_DOMAIN;

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
    console.warn('[wb/sb]', path, r.status, t.slice(0, 200));
    return null;
  }
  const txt = await r.text();
  return txt ? JSON.parse(txt) : null;
}

async function rateLimit(ip) {
  const r = await sb('rpc/check_and_increment_rate_limit', {
    method: 'POST',
    body: JSON.stringify({ p_ip: ip, p_endpoint: 'westernbid', p_limit: 10 })
  });
  return r || { allowed: true, skipped: true };
}

async function verifyTurnstile(token, remoteIp) {
  const secret = process.env.TURNSTILE_SECRET;
  if (!secret) return { ok: true, skipped: true };
  if (!token) return { ok: false, error: 'captcha token missing' };
  try {
    const form = new URLSearchParams();
    form.set('secret', secret);
    form.set('response', token);
    if (remoteIp) form.set('remoteip', remoteIp);
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form });
    const data = await r.json();
    return { ok: !!data.success, errors: data['error-codes'] || [] };
  } catch (e) { return { ok: false, error: e.message }; }
}

async function computeTotal(items) {
  const payload = (items || []).map(it => ({
    uid: String(it.uid || ''),
    qty: parseInt(it.qty || 1, 10)
  }));
  return await sb('rpc/compute_order_total', {
    method: 'POST',
    body: JSON.stringify({ p_items: payload, p_table: T.PRODUCTS })
  });
}

// Серверна валідація промо-коду (як в api/wayforpay.js) — НЕ довіряємо percent з фронту.
async function validatePromoServer(code, subtotalUAH) {
  if (!code) return { valid: false, percent: 0 };
  const safe = String(code).toUpperCase().trim();
  if (!safe) return { valid: false, percent: 0 };
  const rows = await sb(T.PROMOS + '?code=eq.' + encodeURIComponent(safe) + '&active=eq.true&limit=1');
  if (!Array.isArray(rows) || !rows.length) return { valid: false, percent: 0 };
  const row = rows[0];
  if (row.expires_at && new Date(row.expires_at) < new Date()) return { valid: false, percent: 0 };
  if (row.min_total && Number(subtotalUAH) < Number(row.min_total)) return { valid: false, percent: 0 };
  return { valid: true, percent: Math.max(0, Math.min(100, parseInt(row.percent || 0, 10))) };
}

// Реплікує клієнтську логіку BUNDLE + PROMO (як в api/wayforpay.js).
// Повертає { lines: [{uid, qty, unitPriceAfter, lineTotalAfter}], total } (UAH).
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
      if (unitIdx >= 2 && bundlePct > 0) u = unit * (100 - bundlePct) / 100;
      if (promoPct > 0)                  u = u    * (100 - promoPct)  / 100;
      lineSum += u;
    }
    const lineTotalAfter = Math.round(lineSum * 100) / 100;
    const unitPriceAfter = Math.round((lineTotalAfter / qty) * 100) / 100;
    lines.push({ uid: line.uid, qty: qty, unitPriceAfter: unitPriceAfter, lineTotalAfter: lineTotalAfter });
  }
  let total = 0;
  for (const ln of lines) total += ln.unitPriceAfter * ln.qty;
  total = Math.round(total * 100) / 100;
  return { lines, total };
}

async function saveOrder(order) {
  const rows = await sb(T.ORDERS, {
    method: 'POST',
    headers: { 'Prefer': 'return=representation' },
    body: JSON.stringify(order)
  });
  return Array.isArray(rows) ? rows[0] : null;
}

function md5(s) { return crypto.createHash('md5').update(String(s), 'utf8').digest('hex'); }

// Nova Global shipping zones (EUR per order). Keep in sync with en.html (EN_ZINFO)!
const SHIP_Z1 = ['PL', 'SK', 'HU', 'RO', 'CZ', 'MD'];
const SHIP_Z2 = ['DE', 'AT', 'FR', 'IT', 'ES', 'NL', 'BE', 'LU', 'PT', 'IE', 'DK', 'SE', 'FI', 'GR', 'LT', 'LV', 'EE', 'SI', 'HR', 'BG', 'CH', 'NO'];
const SHIP_Z3 = ['GB'];
const SHIP_Z4 = ['US', 'CA'];
function shippingEur(country) {
  const c = String(country || '').toUpperCase();
  if (SHIP_Z1.indexOf(c) >= 0) return 7;
  if (SHIP_Z2.indexOf(c) >= 0) return 9;
  if (SHIP_Z3.indexOf(c) >= 0) return 11;
  if (SHIP_Z4.indexOf(c) >= 0) return 15;
  return 22;
}

function splitName(full) {
  const parts = String(full || '').trim().split(/\s+/);
  if (parts.length <= 1) return { first: parts[0] || 'Customer', last: '-' };
  return { first: parts[0], last: parts.slice(1).join(' ') };
}

module.exports = async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const ip = getClientIp(req);
  const rl = await rateLimit(ip);
  if (!rl.allowed) {
    res.setHeader('Retry-After', String(rl.retry_after || 60));
    return res.status(429).json({ ok: false, error: 'Too many requests' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { return res.status(400).json({ ok: false, error: 'Invalid JSON' }); }
  }
  body = body || {};

  if (!body.fio || !body.phone) return res.status(400).json({ ok: false, error: 'Missing fio/phone' });
  if (!body.email) return res.status(400).json({ ok: false, error: 'Email required for international payment' });
  if (!Array.isArray(body.items) || body.items.length === 0) return res.status(400).json({ ok: false, error: 'Missing items' });
  if (!body.country || !body.city || !body.address1) return res.status(400).json({ ok: false, error: 'Missing shipping address (country/city/address)' });

  const captcha = await verifyTurnstile(body.captchaToken, ip);
  if (!captcha.ok) return res.status(403).json({ ok: false, error: 'Captcha failed', detail: captcha.errors || captcha.error });

  // Авторитетна сума в UAH через compute_order_total (+ bundle/promo як на WFP-гілці).
  const priced = await computeTotal(body.items);
  let uahTotal;
  let discounted = null;
  let appliedPromoCode = null;
  let appliedPromoPct = 0;
  const bundlePctIn = Math.max(0, Math.min(50, parseInt(body.bundle_discount_pct || 0, 10) || 0));
  if (priced && priced.ok && Number(priced.total) > 0) {
    const subtotal = Number(priced.total);
    const promo = await validatePromoServer(body.promo_code, subtotal);
    if (promo.valid) {
      appliedPromoCode = String(body.promo_code || '').toUpperCase().trim();
      appliedPromoPct = promo.percent;
    }
    discounted = applyDiscounts(priced.breakdown, bundlePctIn, appliedPromoPct);
    uahTotal = discounted.total;
  } else {
    // Фолбек на клієнтські ціни (без знижок), щоб не блокувати продаж.
    uahTotal = (body.items || []).reduce(function (s, it) {
      return s + (parseFloat(it.price) || 0) * (parseInt(it.qty || 1, 10));
    }, 0);
  }
  if (!(uahTotal > 0)) return res.status(400).json({ ok: false, error: 'Invalid total' });

  // Конвертація (env-driven).
  const currency = String(process.env.WB_CURRENCY || 'EUR').toUpperCase();
  const fx = Number(process.env.WB_FX_UAH_PER_UNIT || 0);
  if (!(fx > 0)) return res.status(500).json({ ok: false, error: 'FX rate not configured (WB_FX_UAH_PER_UNIT)' });
  const amountNum = Math.round((uahTotal / fx) * 100) / 100;
  const amount = amountNum.toFixed(2);
  const shipEur = shippingEur(body.country);
  const totalEur = Math.round((amountNum + shipEur) * 100) / 100;

  const wbLogin = process.env.WB_LOGIN;
  const wbSecret = process.env.WB_SECRET;
  if (!wbLogin || !wbSecret) return res.status(500).json({ ok: false, error: 'WB credentials not configured' });

  // Номер як у api/order.js (спільний префікс BG- для дзеркала в CRM).
  const orderNum = 'BG-' + Date.now().toString(36).toUpperCase();

  const discountNote = (appliedPromoCode || bundlePctIn > 0)
    ? ' [discount: ' + (appliedPromoCode ? appliedPromoCode + '−' + appliedPromoPct + '%' : '')
        + (bundlePctIn > 0 ? (appliedPromoCode ? ' + ' : '') + 'bundle−' + bundlePctIn + '%' : '') + ']'
    : '';

  // Канонічний total лишається в UAH; формат "WB <CUR> ... = <total>" парсить callback (анти-тампер).
  // Префікс "САЙТ" потрібен CRM (мапиться bg_orders.notes → orders.comment через тригер).
  const orderRow = await saveOrder({
    number: orderNum,
    customer_name: body.fio,
    customer_phone: body.phone,
    customer_email: body.email,
    delivery_type: 'intl',
    delivery_city: body.city,
    delivery_branch: [body.address1, body.zip, body.country].filter(Boolean).join(', '),
    payment_method: 'westernbid',
    payment_status: 'pending',
    items: body.items,
    total: uahTotal,
    status: 'new',
    notes: 'САЙТ EN · WB ' + currency + ' goods ' + amount + ' + ship ' + shipEur.toFixed(2) +
      ' = ' + totalEur.toFixed(2) + ' @ ' + fx + ' UAH/unit' + discountNote,
    session_id:  (typeof body.session_id  === 'string' ? body.session_id  : '').slice(0, 200)  || null,
    referrer:    (typeof body.referrer    === 'string' ? body.referrer    : '').slice(0, 2000) || null,
    landing_url: (typeof body.landing_url === 'string' ? body.landing_url : '').slice(0, 2000) || null
  });

  const orderNumber = orderRow && orderRow.number ? String(orderRow.number) : orderNum;
  const invoice = orderNumber + '-' + crypto.randomBytes(3).toString('hex');

  // TG-сповіщення про нове EN-замовлення (fire-and-forget, оплата ще pending).
  const esc = s => String(s == null ? '' : s).replace(/[&<>]/g, c => c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;');
  const itemsTxt = (body.items || []).map(it =>
    '· ' + esc(it.title || it.uid) + (it.color_name ? ' / ' + esc(it.color_name) : '') + ' ×' + (parseInt(it.qty || 1, 10))
  ).join('\n');
  tg.fireAndForget(tg.sendAdminMessage(
    '🌍 <b>НОВЕ EN-ЗАМОВЛЕННЯ (WesternBid)</b> · <code>' + esc(orderNumber) + '</code>\n' +
    '💰 <b>' + esc(totalEur.toFixed(2)) + ' ' + esc(currency) + '</b> (товари ' + esc(amount) + ' + доставка ' + esc(shipEur.toFixed(2)) + ') ≈ ' + esc(Math.round(uahTotal)) + ' ₴\n' +
    '👤 ' + esc(body.fio) + ' · ' + esc(body.phone) + '\n' +
    '✉️ ' + esc(body.email) + '\n' +
    '📦 ' + esc(body.country) + ' · ' + esc(body.city) + (body.zip ? ' · ' + esc(body.zip) : '') + '\n' +
    '🏠 ' + esc(body.address1) + '\n' +
    itemsTxt + '\n' +
    '⏳ очікує оплату (card/PayPal)'
  ));

  const wbHash = md5(wbLogin + wbSecret + amount + invoice);
  const nm = splitName(body.fio);
  const endpoint = process.env.WB_ENDPOINT || 'https://shop.westernbid.info';

  const fields = {
    charset: 'utf-8',
    wb_login: wbLogin,
    wb_hash: wbHash,
    invoice: invoice,
    amount: amount,
    currency_code: currency,
    item_name: 'BabyGirl order ' + orderNumber,
    first_name: nm.first,
    last_name: nm.last,
    email: body.email,
    phone: String(body.phone),
    address1: String(body.address1),
    city: String(body.city),
    country: String(body.country),
    zip: String(body.zip || ''),
    state: String(body.state || ''),
    shipping: shipEur.toFixed(2),
    return: process.env.WB_RETURN_URL || (SITE_BASE + '/en?paid=1'),
    cancel_return: process.env.WB_CANCEL_URL || (SITE_BASE + '/en?paid=0'),
    notify_url: process.env.WB_NOTIFY_URL || (SITE_BASE + '/api/westernbid-callback')
  };

  // Default gateway: PayPal (також приймає гостьові картки). WB_GATE=stripe.com → Stripe.
  const gate = String(process.env.WB_GATE || '').trim();
  if (gate) fields.gate = gate;
  if (gate === 'stripe.com' && String(body.state || '').toUpperCase() === 'FL') {
    fields.sales_tax = (Math.round(amountNum * 0.07 * 100) / 100).toFixed(2);
  }

  // Построчні позиції — по докам WB всі шість полів обовʼязкові.
  const lineByUid = discounted ? discounted.lines : null;
  (body.items || []).forEach(function (it, i) {
    const n = i + 1;
    const line = lineByUid ? lineByUid.find(function (b) { return b.uid === String(it.uid || ''); }) : null;
    const unitUah = line ? Number(line.unitPriceAfter) : (parseFloat(it.price) || 0);
    const unitCur = Math.round((unitUah / fx) * 100) / 100;
    const baseUid = String(it.uid || '').split('|')[0];
    const label = (it.title || 'BabyGirl item') + (it.color_name ? ' / ' + it.color_name : '') + (it.size ? ' / ' + it.size : '');
    fields['item_name_' + n] = label;
    fields['item_number_' + n] = String(it.uid || '');
    fields['amount_' + n] = unitCur.toFixed(2);
    fields['quantity_' + n] = String(parseInt(it.qty || 1, 10));
    fields['url_' + n] = baseUid ? (SITE_BASE + '/en?p=' + encodeURIComponent(baseUid)) : (SITE_BASE + '/en');
    fields['description_' + n] = label;
  });

  return res.status(200).json({
    ok: true,
    endpoint: endpoint,
    method: 'POST',
    fields: fields,
    invoice: invoice,
    amount: amount,
    currency: currency,
    shipping: shipEur.toFixed(2),
    total: totalEur.toFixed(2),
    order_number: orderNumber,
    uah_total: uahTotal
  });
};
