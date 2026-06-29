// api/wayforpay-reconcile.js — safety-net poller for WayForPay deposits.
//
// Зачем: WayForPay не всегда дёргает serviceUrl (/api/wayforpay-callback),
// поэтому онлайн-задаток (COD 200 грн) может не зафиксироваться. Этот эндпоинт
// периодически опрашивает WayForPay (CHECK_STATUS) по недавним НЕоплаченным
// bg_orders и, если транзакция Approved, ставит payment_status='paid' + paid_at.
// Триггер-зеркало дальше проставит prepayment=200 / наложку в orders (CRM).
//
// Запуск:
//   - Vercel Cron (GET, Authorization: Bearer $CRON_SECRET) — авто, каждые 10 хв.
//   - Вручну/бекфіл: GET /api/wayforpay-reconcile?key=<WAYFORPAY_SECRET>&days=30
//
// Идемпотентно: уже paid пропускаются; событие пишется в bg_wayforpay_events
// с unique(order_ref, transaction_status) → дубли игнорируются.

const crypto = require('crypto');
const cfg = require('./_config');
const T = cfg.T;

const WFP_API = 'https://api.wayforpay.com/api';

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
    console.warn('[wfp-reconcile/sb]', path, r.status, t.slice(0, 200));
    return null;
  }
  const txt = await r.text();
  return txt ? JSON.parse(txt) : null;
}

async function wfpCheckStatus(merchantAccount, secret, orderReference) {
  const signature = crypto.createHmac('md5', secret)
    .update([merchantAccount, orderReference].join(';'), 'utf8')
    .digest('hex');
  const body = {
    transactionType: 'CHECK_STATUS',
    merchantAccount,
    orderReference,
    merchantSignature: signature,
    apiVersion: 1
  };
  const r = await fetch(WFP_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!r.ok) return null;
  return r.json().catch(() => null);
}

module.exports = async function handler(req, res) {
  const merchantAccount = process.env.WAYFORPAY_MERCHANT;
  const secret = process.env.WAYFORPAY_SECRET;
  if (!merchantAccount || !secret) {
    return res.status(500).json({ error: 'WayForPay env not configured' });
  }

  // Auth: Vercel cron (Bearer CRON_SECRET) or manual (?key=WAYFORPAY_SECRET).
  const cronSecret = process.env.CRON_SECRET;
  const auth = req.headers['authorization'] || '';
  const qKey = (req.query && req.query.key) || '';
  const authorized =
    (cronSecret && auth === 'Bearer ' + cronSecret) ||
    (qKey && qKey === secret);
  if (!authorized) return res.status(401).json({ error: 'Unauthorized' });

  const days = Math.max(1, Math.min(90, parseInt((req.query && req.query.days) || '2', 10) || 2));
  const limit = Math.max(1, Math.min(100, parseInt((req.query && req.query.limit) || '50', 10) || 50));
  const sinceIso = new Date(Date.now() - days * 86400000).toISOString();

  // Recent NOT-paid orders. Deposit is paid at checkout, so we only need a short window.
  const orders = await sb(
    T.ORDERS +
    '?select=number,total,payment_status,paid_at,created_at' +
    '&payment_status=neq.paid&paid_at=is.null' +
    '&created_at=gte.' + encodeURIComponent(sinceIso) +
    '&order=created_at.desc&limit=' + limit
  );

  if (!Array.isArray(orders)) {
    return res.status(500).json({ error: 'Could not load orders' });
  }

  const checked = [];
  let approved = 0;

  for (const o of orders) {
    const ref = o.number;
    if (!ref) continue;
    const st = await wfpCheckStatus(merchantAccount, secret, ref);
    const status = st && (st.transactionStatus || st.reason || '');
    if (st && st.transactionStatus === 'Approved') {
      approved++;
      const paidAt = st.processingDate
        ? new Date(Number(st.processingDate) * 1000).toISOString()
        : new Date().toISOString();

      // Mark paid (fires bg_orders_mirror_to_orders → prepayment/наложка in CRM).
      await sb(T.ORDERS + '?number=eq.' + encodeURIComponent(ref), {
        method: 'PATCH',
        body: JSON.stringify({ payment_status: 'paid', paid_at: paidAt })
      });

      // Audit event (idempotent).
      await sb(T.WAYFORPAY_EVENTS, {
        method: 'POST',
        headers: { 'Prefer': 'resolution=ignore-duplicates' },
        body: JSON.stringify({
          order_ref: ref,
          transaction_status: 'Approved',
          amount: st.amount != null ? Number(st.amount) : null,
          currency: st.currency || 'UAH',
          auth_code: st.authCode || '',
          card_pan: st.cardPan || '',
          reason_code: st.reasonCode != null ? String(st.reasonCode) : '',
          raw_payload: st,
          source_ip: 'reconcile'
        })
      });
      checked.push({ ref, status: 'Approved', amount: st.amount });
    } else {
      checked.push({ ref, status: status || 'no-status' });
    }
  }

  return res.status(200).json({
    ok: true,
    window_days: days,
    scanned: orders.length,
    approved,
    details: checked
  });
};
