// api/order.js — frontend → Supabase (+ optional KeyCRM proxy)
// Скелет із досвіду ULTERA · v3 hardened
//
// Фічі:
//   - CORS whitelist (з api/_config.js)
//   - Rate limit per IP per minute (Supabase RPC check_and_increment_rate_limit)
//   - Cloudflare Turnstile — якщо TURNSTILE_SECRET в env
//   - Server-side amount recompute (RPC compute_order_total) — фронт не довіряємо
//   - stage-aware: 'lead' (брошена корзина) → тільки Supabase; 'final' → +CRM
//   - Attribution: session_id / referrer / landing_url пишемо у orders
//
// Required env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
// Optional env: TURNSTILE_SECRET, KEYCRM_TOKEN, KEYCRM_SOURCE_ID,
//               KEYCRM_PM_CARD, KEYCRM_PM_NP, KEYCRM_DS_NP

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
    console.warn('[order/sb]', path, r.status, t.slice(0, 200));
    return null;
  }
  const txt = await r.text();
  return txt ? JSON.parse(txt) : null;
}

async function checkRateLimit(ip, limit) {
  const r = await sb('rpc/check_and_increment_rate_limit', {
    method: 'POST',
    body: JSON.stringify({ p_ip: ip, p_endpoint: 'order', p_limit: limit })
  });
  return r || { allowed: true, skipped: true };
}

async function verifyTurnstile(token, ip) {
  const secret = process.env.TURNSTILE_SECRET;
  if (!secret) return { ok: true, skipped: true };
  if (!token) return { ok: false, error: 'captcha token missing' };
  try {
    const form = new URLSearchParams();
    form.set('secret', secret);
    form.set('response', token);
    if (ip) form.set('remoteip', ip);
    const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST', body: form
    });
    const data = await r.json();
    return { ok: !!data.success, errors: data['error-codes'] || [] };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function recomputePrices(items) {
  const payload = items.map(it => ({
    uid: String(it.uid || ''),
    qty: parseInt(it.qty || 1, 10)
  }));
  return await sb('rpc/compute_order_total', {
    method: 'POST',
    body: JSON.stringify({ p_items: payload, p_table: T.PRODUCTS })
  });
}

async function saveOrder(order) {
  const rows = await sb(T.ORDERS, {
    method: 'POST',
    headers: { 'Prefer': 'return=representation' },
    body: JSON.stringify(order)
  });
  return Array.isArray(rows) ? rows[0] : null;
}

module.exports = async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const ip = getClientIp(req);
  const rl = await checkRateLimit(ip, cfg.RL.order);
  if (!rl.allowed) {
    res.setHeader('Retry-After', String(rl.retry_after || 60));
    return res.status(429).json({ ok: false, error: 'Too many requests' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); }
    catch (e) { return res.status(400).json({ ok: false, error: 'Invalid JSON' }); }
  }
  body = body || {};

  if (!body.fio || !body.phone) {
    return res.status(400).json({ ok: false, error: 'Missing fio/phone' });
  }
  if (!Array.isArray(body.items) || body.items.length === 0) {
    return res.status(400).json({ ok: false, error: 'Missing items' });
  }

  const stage = String(body.stage || 'final').toLowerCase();
  const isLead = stage === 'lead';

  // captcha — лише для final-stage
  if (!isLead) {
    const captcha = await verifyTurnstile(body.captchaToken, ip);
    if (!captcha.ok) {
      return res.status(403).json({ ok: false, error: 'Captcha failed', detail: captcha.errors || captcha.error });
    }
  }

  // Server amount recompute. Якщо RPC недоступний — fallback на фронтові ціни
  // тільки для lead/COD; для card обов'язково RPC.
  const priced = await recomputePrices(body.items);
  let total = null;
  if (priced && priced.ok) {
    total = Number(priced.total);
  } else {
    if (!isLead && body.payment === 'card') {
      return res.status(400).json({ ok: false, error: 'Price verification failed' });
    }
    total = (body.items || []).reduce(
      (s, it) => s + (parseFloat(it.price) || 0) * (parseInt(it.qty || 1, 10)), 0
    );
  }

  const orderRow = await saveOrder({
    customer_name: body.fio,
    customer_phone: body.phone,
    customer_email: body.email || null,
    delivery_type: body.delivery_type || 'np',
    delivery_city: body.city || '',
    delivery_branch: body.wh || '',
    payment_method: body.payment || (isLead ? null : 'np'),
    payment_status: isLead ? 'lead' : (body.payment === 'card' ? 'pending' : 'cod'),
    items: body.items,
    total: total,
    status: isLead ? 'lead' : 'new',
    notes: body.comment || (isLead ? 'abandoned-cart lead' : ''),
    // Attribution
    session_id:  (typeof body.session_id  === 'string' ? body.session_id  : '').slice(0, 200)  || null,
    referrer:    (typeof body.referrer    === 'string' ? body.referrer    : '').slice(0, 2000) || null,
    landing_url: (typeof body.landing_url === 'string' ? body.landing_url : '').slice(0, 2000) || null,
  });

  if (isLead) {
    return res.status(200).json({
      ok: true, stage: 'lead',
      order_num: body.num || (orderRow && orderRow.number),
      authoritative_total: total,
      message: 'Lead saved; CRM deferred until final stage.'
    });
  }

  // KeyCRM proxy (optional)
  if (!cfg.KEYCRM.enabled || !process.env.KEYCRM_TOKEN) {
    return res.status(200).json({
      ok: true, stage: 'final', mock: !process.env.KEYCRM_TOKEN,
      order_num: body.num || (orderRow && orderRow.number),
      authoritative_total: total
    });
  }

  const pmCard = parseInt(process.env.KEYCRM_PM_CARD || '0', 10);
  const pmNp   = parseInt(process.env.KEYCRM_PM_NP   || '0', 10);
  const paymentMethodId = body.payment === 'card' ? pmCard : pmNp;

  const crmPayload = {
    source_id: parseInt(process.env.KEYCRM_SOURCE_ID || '1', 10),
    manager_comment: cfg.PROJECT_NAME + ' · ' + (body.num || (orderRow && orderRow.number) || '') +
      (body.payment === 'np' ? ' · наложка' : ' · картка'),
    buyer: { full_name: body.fio, phone: body.phone },
    shipping: {
      delivery_service_id: parseInt(process.env.KEYCRM_DS_NP || '1', 10),
      shipping_address_city: body.city || '',
      shipping_address_warehouse: body.wh || '',
      recipient_full_name: body.fio,
      recipient_phone: body.phone
    },
    payments: paymentMethodId ? [{
      payment_method_id: paymentMethodId,
      amount: total,
      status: 'not_paid',
      description: body.payment === 'card' ? 'Оплата карткою' : 'Наложений платіж'
    }] : [],
    products: (body.items || []).map(it => {
      const line = priced && priced.breakdown
        ? priced.breakdown.find(b => b.uid === String(it.uid || ''))
        : null;
      const unit = line ? Number(line.unit_price) : (parseFloat(it.price) || 0);
      return {
        sku: String(it.uid || ''),
        name: it.title + (it.color_name ? ' / ' + it.color_name : '') + (it.size ? ' / р.' + it.size : ''),
        price: unit,
        quantity: parseInt(it.qty || 1, 10),
        picture: it.photo || null
      };
    })
  };

  try {
    const r = await fetch('https://openapi.keycrm.app/v1/order', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': 'Bearer ' + process.env.KEYCRM_TOKEN
      },
      body: JSON.stringify(crmPayload)
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      return res.status(r.status).json({ ok: false, error: data.message || 'KeyCRM error', details: data });
    }
    return res.status(200).json({
      ok: true, stage: 'final',
      order_num: body.num || (orderRow && orderRow.number),
      keycrm_id: data.id || null,
      authoritative_total: total
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
};
