// api/westernbid-callback.js — Western Bid IPN (server-to-server) для BabyGirl EN.
// WB POST-ить результат оплати. Перевіряємо md5-підпис, знаходимо замовлення за
// номером, вшитим в `invoice` (формат "BG-<base36>-<hex>"), і лише на валідному
// першому 'Completed' ставимо payment_status='paid' + Meta CAPI Purchase + TG.
// Ідемпотентно: повторний IPN по вже оплаченому замовленню — no-op 200.
//
// Env vars:
//   WB_LOGIN, WB_SECRET, WB_CURRENCY (default 'EUR')
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//   FB_PIXEL_ID, FB_ACCESS_TOKEN (через ./_fb_capi)
//   TG_BOT_TOKEN, TG_ADMIN_CHAT_ID (через ./_tg)

const crypto = require('crypto');
const cfg = require('./_config');
const tg = require('./_tg');
const capi = require('./_fb_capi');
const T = cfg.T;

function md5(s) { return crypto.createHash('md5').update(String(s), 'utf8').digest('hex'); }

function parseBody(req) {
  let b = req.body;
  if (b && typeof b === 'object') return b;
  const raw = typeof b === 'string' ? b : '';
  const out = {};
  try {
    const p = new URLSearchParams(raw);
    p.forEach(function (v, k) { out[k] = v; });
  } catch (e) { /* ignore */ }
  return out;
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
    console.warn('[wb-cb/sb]', path, r.status, t.slice(0, 200));
    return null;
  }
  const txt = await r.text();
  return txt ? JSON.parse(txt) : null;
}

async function findOrderByNumber(number) {
  if (!number) return null;
  const rows = await sb(T.ORDERS + '?number=eq.' + encodeURIComponent(number) +
    '&select=id,number,payment_status,total,customer_name,customer_phone,customer_email,delivery_city,items,notes&limit=1');
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

async function markPaid(id) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key || !id) return false;
  try {
    const r = await fetch(url + '/rest/v1/' + T.ORDERS + '?id=eq.' + encodeURIComponent(id), {
      method: 'PATCH',
      headers: { 'apikey': key, 'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
      body: JSON.stringify({ payment_status: 'paid' })
    });
    return r.ok;
  } catch (e) { console.error('[wb-cb] markPaid exception', e.message); return false; }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).send('Method not allowed'); }

  const b = parseBody(req);
  const wbHash = b.wb_hash || '';
  const wbResult = b.wb_result || '';
  const mcGross = b.mc_gross || '';
  const mcCurrency = String(b.mc_currency || '').toUpperCase();
  const invoice = b.invoice || '';
  const paymentStatus = b.payment_status || '';
  const payerEmail = b.payer_email || '';
  const txnId = b.transaction_id || b.txn_id || '';

  const wbLogin = process.env.WB_LOGIN;
  const wbSecret = process.env.WB_SECRET;
  if (!wbLogin || !wbSecret) { console.error('[wb-cb] WB creds missing'); return res.status(500).send('config'); }

  // Verify signature: md5( wb_login + wb_result + secret + mc_gross + invoice )
  const expected = md5(wbLogin + wbResult + wbSecret + mcGross + invoice);
  if (String(wbHash).toUpperCase() !== expected.toUpperCase()) {
    console.warn('[wb-cb] signature mismatch for invoice', invoice);
    return res.status(403).send('bad signature');
  }

  // WB дописує "<wb_login>-" спереду invoice, тому шукаємо BG-<base36>- будь-де.
  const m = /(BG-[A-Z0-9]+)-/.exec(String(invoice));
  const number = m ? m[1] : null;
  const order = await findOrderByNumber(number);
  if (!order) { console.warn('[wb-cb] order not found for invoice', invoice); return res.status(200).send('OK'); }

  // Ідемпотентність: вже paid → no-op.
  if (String(order.payment_status).toLowerCase() === 'paid') return res.status(200).send('OK');

  if (String(wbResult).toUpperCase() !== 'VERIFIED') {
    console.warn('[wb-cb] wb_result not VERIFIED (', wbResult, ') for', invoice);
    return res.status(200).send('OK');
  }
  if (String(paymentStatus).toLowerCase() !== 'completed') {
    console.log('[wb-cb] status', paymentStatus, 'for', invoice, '- no state change');
    return res.status(200).send('OK');
  }

  // Анти-тампер: сума/валюта IPN мають збігатись із записаним у notes
  // ("... WB EUR goods <g> + ship <s> = <total> @ <fx> ..."; mc_gross = повна сума).
  const currency = String(process.env.WB_CURRENCY || 'EUR').toUpperCase();
  const expM = /WB\s+([A-Z]{3})\b[\s\S]*?=\s*([\d.]+)/.exec(String(order.notes || '')) ||
               /WB\s+([A-Z]{3})\s+([\d.]+)/.exec(String(order.notes || ''));
  if (expM) {
    const expCur = expM[1];
    const expAmt = Number(expM[2]);
    const gotAmt = Number(mcGross);
    if (mcCurrency && mcCurrency !== expCur) {
      console.error('[wb-cb] CURRENCY MISMATCH', invoice, 'expected', expCur, 'got', mcCurrency, '- NOT marking paid');
      return res.status(200).send('OK');
    }
    if (isFinite(gotAmt) && isFinite(expAmt) && Math.abs(gotAmt - expAmt) > 0.02) {
      console.error('[wb-cb] AMOUNT MISMATCH', invoice, 'expected', expAmt, 'got', gotAmt, '- NOT marking paid');
      return res.status(200).send('OK');
    }
  }

  await markPaid(order.id);

  // Best-effort side effects — не блокують 200 для WB.
  try {
    const items = Array.isArray(order.items) ? order.items : [];
    const contentIds = items.map(it => String((it && it.uid) || '').split('|')[0]).filter(Boolean);
    const contents = items.map(it => ({
      id: String((it && it.uid) || '').split('|')[0],
      quantity: parseInt((it && it.qty) || 1, 10)
    }));
    const numItems = items.reduce((s, it) => s + (parseInt((it && it.qty) || 1, 10)), 0);
    capi.sendPurchaseFireAndForget({
      event_id: invoice,
      order_id: order.number,
      value: Number(mcGross) || 0,
      currency: mcCurrency || currency,
      content_ids: contentIds,
      contents: contents,
      num_items: numItems,
      email: payerEmail || order.customer_email,
      phone: order.customer_phone,
      fio: order.customer_name,
      city: order.delivery_city
    });
  } catch (e) { console.warn('[wb-cb] capi wrap', e.message); }

  try {
    const esc = s => String(s == null ? '' : s).replace(/[&<>]/g, c => c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;');
    tg.fireAndForget(tg.sendAdminMessage(
      '💳✅ <b>WB ОПЛАЧЕНО (EN)</b>\n' +
      '№ <code>' + esc(order.number) + '</code> · invoice ' + esc(invoice) + '\n' +
      '💰 <b>' + esc(mcGross) + ' ' + esc(mcCurrency || currency) + '</b> (≈ ' + esc(Math.round(Number(order.total) || 0)) + ' ₴)\n' +
      '👤 ' + esc(order.customer_name || '—') + ' · ' + esc(order.customer_phone || '—') +
      (order.customer_email ? ('\n✉️ ' + esc(order.customer_email)) : '') +
      (txnId ? ('\n🧾 txn ' + esc(txnId)) : '')
    ));
  } catch (e) { console.warn('[wb-cb] tg wrap', e.message); }

  return res.status(200).send('OK');
};
