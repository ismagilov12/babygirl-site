// api/wayforpay-callback.js — Service URL webhook from WayForPay.
// Скелет із досвіду ULTERA · SECURITY v2.
//
// Що робить:
//   1. STRICT signature verify (без подпису = відмова, не "якщо не співпало")
//   2. Idempotency: INSERT у {brand}_wayforpay_events з unique(order_ref, status)
//      → повтори не виконують side-effects двічі.
//   3. Логує raw_payload, source_ip — для аудиту.
//   4. На першій події 'Approved' можна оновити orders.payment_status='paid'
//      та дернути CRM. (TODO у Phase 2 — як на ULTERA.)
//   5. Відповідає WayForPay підписаним JSON {orderReference,status,time,signature}.
//
// CORS навмисно НЕ виставляємо — це server-to-server.

const crypto = require('crypto');
const cfg = require('./_config');
const T = cfg.T;

const SIG_FIELDS_ORDER = [
  'merchantAccount', 'orderReference', 'amount', 'currency',
  'authCode', 'cardPan', 'transactionStatus', 'reasonCode'
];

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
    console.warn('[wfp-cb/sb]', path, r.status, t.slice(0, 200));
    return null;
  }
  const txt = await r.text();
  return txt ? JSON.parse(txt) : null;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const secretKey = process.env.WAYFORPAY_SECRET;
  if (!secretKey) {
    console.error('[wfp-callback] WAYFORPAY_SECRET missing');
    return res.status(500).json({ error: 'Not configured' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  body = body || {};

  const {
    merchantAccount, orderReference, amount, currency,
    authCode, cardPan, transactionStatus, reasonCode, merchantSignature
  } = body;

  if (!orderReference) return res.status(400).json({ error: 'orderReference missing' });

  // STRICT signature
  const incoming = [
    merchantAccount || '',
    orderReference,
    amount != null ? String(amount) : '',
    currency || '',
    authCode || '',
    cardPan || '',
    transactionStatus || '',
    reasonCode != null ? String(reasonCode) : ''
  ];
  const expected = crypto.createHmac('md5', secretKey).update(incoming.join(';'), 'utf8').digest('hex');
  if (!merchantSignature || merchantSignature !== expected) {
    console.warn('[wfp-callback] signature mismatch', { orderReference, got: merchantSignature || '(missing)' });
    return res.status(400).json({ error: 'Invalid signature' });
  }

  // Idempotent insert
  const clientIp = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || '';
  let isFirstEvent = true;
  const inserted = await sb(T.WAYFORPAY_EVENTS, {
    method: 'POST',
    headers: { 'Prefer': 'resolution=ignore-duplicates,return=representation' },
    body: JSON.stringify({
      order_ref: orderReference,
      transaction_status: transactionStatus || '',
      amount: amount != null ? Number(amount) : null,
      currency: currency || '',
      auth_code: authCode || '',
      card_pan: cardPan || '',
      reason_code: reasonCode != null ? String(reasonCode) : '',
      raw_payload: body,
      source_ip: clientIp
    })
  });
  if (Array.isArray(inserted) && inserted.length === 0) isFirstEvent = false;

  console.log('[wfp-callback]', { orderReference, transactionStatus, amount, reasonCode, isFirstEvent });

  // Side-effects on first Approved
  if (isFirstEvent && transactionStatus === 'Approved') {
    await sb(T.ORDERS + '?number=eq.' + encodeURIComponent(orderReference), {
      method: 'PATCH',
      body: JSON.stringify({ payment_status: 'paid', paid_at: new Date().toISOString() })
    });
  }

  // Signed response
  const responseTime = Math.floor(Date.now() / 1000);
  const status = 'accept';
  const responseSig = crypto
    .createHmac('md5', secretKey)
    .update([orderReference, status, String(responseTime)].join(';'), 'utf8')
    .digest('hex');

  res.setHeader('Content-Type', 'application/json');
  return res.status(200).json({
    orderReference, status, time: responseTime, signature: responseSig
  });
};
