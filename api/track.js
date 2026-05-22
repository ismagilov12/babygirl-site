// api/track.js — fire-and-forget analytics ingest для BabyGirl.
// POST { event_name, session_id, client_id?, product_uid?, value?, currency?, page_url?, landing_url?, referrer?, fbp?, fbc?, meta? }
// → INSERT в bg_analytics_events. CORS strict. Без rate limit (фронт делает throttle сам).

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

function getIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return req.headers['x-real-ip'] || 'unknown';
}

const ALLOWED_EVENTS = new Set([
  'page_view', 'view_item', 'add_to_cart', 'remove_from_cart',
  'begin_checkout', 'purchase', 'color_switch', 'click', 'funnel_step', 'section_view'
]);

module.exports = async function handler(req, res) {
  const corsOk = setCors(req, res);
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST')    { res.status(405).json({ error: 'method' }); return; }
  if (!corsOk)                  { res.status(403).json({ error: 'origin' }); return; }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) { res.status(500).json({ error: 'env' }); return; }

  // Body parse + sanitize
  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch (_) { b = {}; } }
  if (!b || typeof b !== 'object') { res.status(400).json({ error: 'body' }); return; }

  const event_name = String(b.event_name || '').trim();
  if (!ALLOWED_EVENTS.has(event_name)) { res.status(400).json({ error: 'event_name' }); return; }

  const row = {
    event_name,
    event_id:    b.event_id    ? String(b.event_id).slice(0, 80)    : null,
    session_id:  b.session_id  ? String(b.session_id).slice(0, 80)  : null,
    client_id:   b.client_id   ? String(b.client_id).slice(0, 80)   : null,
    user_agent:  (req.headers['user-agent'] || '').slice(0, 400),
    referrer:    b.referrer    ? String(b.referrer).slice(0, 800)   : null,
    landing_url: b.landing_url ? String(b.landing_url).slice(0, 800): null,
    page_url:    b.page_url    ? String(b.page_url).slice(0, 800)   : null,
    fbp:         b.fbp         ? String(b.fbp).slice(0, 120)        : null,
    fbc:         b.fbc         ? String(b.fbc).slice(0, 240)        : null,
    product_uid: b.product_uid ? String(b.product_uid).slice(0, 80) : null,
    value:       (typeof b.value === 'number' && isFinite(b.value)) ? b.value : null,
    currency:    b.currency    ? String(b.currency).slice(0, 8)     : 'UAH',
    meta:        (b.meta && typeof b.meta === 'object') ? b.meta : null,
    source_ip:   getIp(req),
  };

  try {
    const r = await fetch(url + '/rest/v1/' + T.ANALYTICS_EVENTS, {
      method: 'POST',
      headers: {
        apikey: key,
        Authorization: 'Bearer ' + key,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal'
      },
      body: JSON.stringify(row)
    });
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      console.warn('[track/insert]', r.status, t.slice(0, 200));
      res.status(202).json({ ok: false }); return;
    }
  } catch (e) {
    console.warn('[track] err', e && e.message);
    res.status(202).json({ ok: false }); return;
  }
  res.status(204).end();
};
