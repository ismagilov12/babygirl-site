// api/_fb_capi.js — Meta Conversions API helper.
//
// Server-side mirror of the browser Pixel for high-value events (Purchase mainly).
// Browser Pixel is blocked by AdBlock / iOS ATT / Safari ITP for 30–60% of users;
// CAPI runs server→server so Meta gets the event regardless. When both fire with
// the SAME event_id, Meta deduplicates and counts one Purchase with much higher
// match quality (browser fbp/fbc + server email/phone hash).
//
// Env vars (Vercel):
//   FB_ACCESS_TOKEN     — System User token, ads_management scope
//   FB_PIXEL_ID         — dataset/pixel id (== 1636827497584775 for BabyGirl)
//   FB_TEST_EVENT_CODE  — optional, set to TEST12345 from Events Manager → Test Events
//                         while smoke-testing; remove for prod.
//
// All functions are fire-and-forget friendly: errors are logged but never thrown
// to the caller (we don't want a Meta hiccup to break order processing).

const crypto = require('crypto');

const GRAPH_VERSION = 'v19.0';
const API_BASE = 'https://graph.facebook.com';

function sha256Lower(s) {
  if (s == null) return null;
  const v = String(s).trim().toLowerCase();
  if (!v) return null;
  return crypto.createHash('sha256').update(v, 'utf8').digest('hex');
}

// Normalize phone to digits only, then sha256 (Meta requirement).
function hashPhone(p) {
  if (!p) return null;
  const digits = String(p).replace(/[^\d]/g, '');
  if (!digits) return null;
  return crypto.createHash('sha256').update(digits, 'utf8').digest('hex');
}

function hashEmail(e) {
  return sha256Lower(e);
}

// Trim FN/LN: lowercase, no whitespace, sha256.
function hashName(n) {
  if (!n) return null;
  const v = String(n).trim().toLowerCase().replace(/\s+/g, '');
  if (!v) return null;
  return crypto.createHash('sha256').update(v, 'utf8').digest('hex');
}

// Build user_data block per Meta spec.
// fbp/fbc come from browser cookies (_fbp / _fbc) — pass them through unchanged.
// client_ip_address and client_user_agent must NOT be hashed.
function buildUserData(opts) {
  opts = opts || {};
  const ud = {};
  const emHash = hashEmail(opts.email);
  const phHash = hashPhone(opts.phone);
  // Meta accepts arrays for em/ph (multiple values supported).
  if (emHash) ud.em = [emHash];
  if (phHash) ud.ph = [phHash];

  // First/last name from "Іван Петров" — split on first space.
  if (opts.fio) {
    const parts = String(opts.fio).trim().split(/\s+/);
    const fnHash = hashName(parts[0]);
    const lnHash = parts.length > 1 ? hashName(parts.slice(1).join(' ')) : null;
    if (fnHash) ud.fn = [fnHash];
    if (lnHash) ud.ln = [lnHash];
  }
  if (opts.country) {
    const c = hashName(opts.country); // ISO-2, lowercase, hashed
    if (c) ud.country = [c];
  }
  if (opts.city) {
    const c = hashName(opts.city);
    if (c) ud.ct = [c];
  }
  if (opts.fbp) ud.fbp = String(opts.fbp);
  if (opts.fbc) ud.fbc = String(opts.fbc);
  if (opts.client_ip) ud.client_ip_address = String(opts.client_ip);
  if (opts.client_ua) ud.client_user_agent = String(opts.client_ua);
  return ud;
}

// Build a Purchase event payload.
// event_id MUST equal the same id used on browser Pixel (orderReference for us)
// so Meta deduplicates browser+server.
function buildPurchaseEvent(opts) {
  opts = opts || {};
  const eventTime = Math.floor((opts.event_time_ms || Date.now()) / 1000);
  const customData = {
    currency: opts.currency || 'UAH',
    value: Number(opts.value) || 0
  };
  if (Array.isArray(opts.content_ids) && opts.content_ids.length) {
    customData.content_ids = opts.content_ids.map(String);
    customData.content_type = 'product';
  }
  if (opts.num_items != null) customData.num_items = Number(opts.num_items);
  if (Array.isArray(opts.contents) && opts.contents.length) {
    customData.contents = opts.contents;
  }
  if (opts.order_id) customData.order_id = String(opts.order_id);

  const evt = {
    event_name: 'Purchase',
    event_time: eventTime,
    event_id: String(opts.event_id || opts.order_id || ''),
    action_source: 'website',
    event_source_url: opts.event_source_url || ('https://' + (process.env.FB_EVENT_SOURCE_DOMAIN || 'babygirl.com.ua') + '/'),
    user_data: buildUserData(opts),
    custom_data: customData
  };
  return evt;
}

// Send one or more events to Meta. Returns { ok, status, body, fbtrace_id }.
// Never throws. Logs on warn for visibility in Vercel function logs.
async function sendEvents(events) {
  const pixelId = process.env.FB_PIXEL_ID;
  const token = process.env.FB_ACCESS_TOKEN;
  if (!pixelId || !token) {
    console.warn('[capi] missing FB_PIXEL_ID or FB_ACCESS_TOKEN — event NOT sent');
    return { ok: false, error: 'capi_not_configured' };
  }
  if (!Array.isArray(events) || !events.length) {
    return { ok: false, error: 'no_events' };
  }
  const payload = { data: events };
  const testCode = process.env.FB_TEST_EVENT_CODE;
  if (testCode) payload.test_event_code = testCode;

  const url = API_BASE + '/' + GRAPH_VERSION + '/' + pixelId + '/events?access_token=' + encodeURIComponent(token);
  const opts = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  };

  // One retry on network failure (500ms backoff).
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch(url, opts);
      const text = await r.text().catch(() => '');
      let parsed = null;
      try { parsed = text ? JSON.parse(text) : null; } catch (e) { parsed = null; }
      if (r.ok) {
        console.log('[capi] sent', {
          events: events.length,
          event_names: events.map(e => e.event_name).join(','),
          fbtrace_id: parsed && parsed.fbtrace_id,
          events_received: parsed && parsed.events_received,
          test: !!testCode
        });
        return { ok: true, status: r.status, body: parsed };
      }
      console.warn('[capi] non-2xx', {
        status: r.status,
        body: text.slice(0, 500),
        fbtrace_id: parsed && parsed.error && parsed.error.fbtrace_id
      });
      // 4xx → не ретраим (валидация/permissions), 5xx → ретрай
      if (r.status < 500) return { ok: false, status: r.status, body: parsed };
    } catch (e) {
      console.warn('[capi] fetch threw', e && e.message);
    }
    if (attempt === 0) await new Promise(res => setTimeout(res, 500));
  }
  return { ok: false, error: 'network_failed_after_retry' };
}

// Convenience: send a single Purchase event.
async function sendPurchase(opts) {
  const evt = buildPurchaseEvent(opts);
  if (!evt.event_id) {
    console.warn('[capi] sendPurchase missing event_id — skipping (would break dedup)');
    return { ok: false, error: 'missing_event_id' };
  }
  return await sendEvents([evt]);
}

// Fire-and-forget wrapper — for use in API handlers where we don't want to block
// the response on Meta latency. Errors are logged inside sendPurchase.
function sendPurchaseFireAndForget(opts) {
  try {
    sendPurchase(opts).catch(e => console.warn('[capi] fnf catch', e && e.message));
  } catch (e) {
    console.warn('[capi] fnf sync throw', e && e.message);
  }
}

module.exports = {
  buildUserData,
  buildPurchaseEvent,
  sendEvents,
  sendPurchase,
  sendPurchaseFireAndForget,
  // exposed for unit tests / debugging
  _hash: { hashEmail, hashPhone, hashName }
};
