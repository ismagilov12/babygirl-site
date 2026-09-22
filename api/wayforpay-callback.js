// api/wayforpay-callback.js — Service URL webhook from WayForPay.
// Скелет із досвіду ULTERA · SECURITY v2.
//
// Що робить:
//   1. STRICT signature verify (без подпису = відмова)
//   2. Idempotency: INSERT у {brand}_wayforpay_events з unique(order_ref, status)
//   3. Логує raw_payload, source_ip — для аудиту.
//   4. На першій події 'Approved' оновлює orders.payment_status='paid' і
//      шле Meta CAPI Purchase (server-side mirror браузерного Pixel).
//   5. Відповідає WayForPay підписаним JSON {orderReference,status,time,signature}.
//
// CORS навмисно НЕ виставляємо — це server-to-server.

const crypto = require('crypto');
const cfg = require('./_config');
const T = cfg.T;
const capi = require('./_fb_capi');

async function sb(path, opts) {
  opts = opts || {};
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Database unavailable');
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
    throw new Error('Database operation failed');
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

  try {
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

  // Always retry incomplete processing; an inserted webhook is not proof of delivery.
  if (transactionStatus === 'Approved') {
    const ref = encodeURIComponent(orderReference);
    const trackRows = await sb('bg_order_tracking?order_ref=eq.' + ref + '&limit=1');
    const tracking = Array.isArray(trackRows) && trackRows[0];
    const orderRows = tracking && tracking.order_data ? [tracking.order_data] :
      await sb(T.ORDERS + '?number=eq.' + ref + '&limit=1');
    const order = Array.isArray(orderRows) && orderRows[0];
    if (!order) return res.status(503).json({ error: 'Order unavailable; retry callback' });
    const isCod = order.payment_method === 'cod' || order.payment_method === 'np';
    const expectedAmount = isCod ? Number(cfg.COD_PREPAYMENT_AMOUNT_UAH) : Number(order.total);
    if (currency !== 'UAH' || !Number.isFinite(Number(amount)) ||
        Math.round(Number(amount)*100) !== Math.round(expectedAmount*100) ||
        (process.env.WAYFORPAY_MERCHANT && merchantAccount !== process.env.WAYFORPAY_MERCHANT)) {
      return res.status(400).json({ error: 'Payment does not match saved order' });
    }
    const paidAt = (tracking && tracking.paid_at) || new Date().toISOString();
    const updated = await sb(T.ORDERS + '?number=eq.' + ref, {
      method: 'PATCH', headers: { Prefer: 'return=representation' },
      body: JSON.stringify({ payment_status: 'paid', paid_at: paidAt })
    });
    if (!Array.isArray(updated) || !updated.length) throw new Error('Order update failed');
    await sb('bg_order_tracking?on_conflict=order_ref', {
      method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify({ order_ref: orderReference, order_data: order, paid_at: paidAt })
    });
    if (!(tracking && tracking.capi_sent_at)) {
      const items = Array.isArray(order.items) ? order.items : [];
      const contents = items.map(it => ({ id: String(it.uid || '').replace('|','-'),
        quantity: Number(it.qty) || 1 })).filter(it => it.id);
      const sent = await capi.sendPurchase({
        event_id: orderReference, order_id: orderReference,
        event_time_ms: new Date(paidAt).getTime(),
        value: Number(order.total), currency: 'UAH',
        content_ids: contents.map(it => it.id), contents,
        num_items: contents.reduce((n,it) => n + it.quantity, 0),
        email: order.customer_email, phone: order.customer_phone, fio: order.customer_name,
        city: order.delivery_city, country: 'ua',
        fbp: tracking && tracking.fbp, fbc: tracking && tracking.fbc,
        client_ip: tracking && tracking.client_ip, client_ua: tracking && tracking.client_ua,
        event_source_url: order.landing_url || ('https://' + cfg.SITE_DOMAIN + '/')
      });
      if (!sent.ok) throw new Error('Meta delivery failed; retry callback');
      await sb('bg_order_tracking?order_ref=eq.' + ref, { method: 'PATCH',
        body: JSON.stringify({ capi_sent_at: new Date().toISOString() }) });
    }
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
    orderReference: orderReference, status: status, time: responseTime, signature: responseSig
  });
  } catch (e) {
    console.error('[wfp-callback] processing failed:', e.message);
    return res.status(503).json({ error: 'Processing incomplete; retry callback' });
  }
};

