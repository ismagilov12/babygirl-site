// api/promo.js — perevirka promo-kod'iv. Skeleton.
//
// Returns: { ok, code, percent, valid, reason? }
// Promo records live in {brand}_promos: code, percent, active, expires_at, min_total

const cfg = require('./_config');
const T = cfg.T;
const ALLOWED_ORIGINS_EXACT = new Set(cfg.ALLOWED_ORIGINS_EXACT);

function setCors(req, res) {
  const origin = req.headers.origin || '';
  const isAllowed = ALLOWED_ORIGINS_EXACT.has(origin) ||
    cfg.ALLOWED_ORIGIN_SUFFIX.some(s => origin.endsWith(s));
  if (isAllowed) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

async function sb(path) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  const r = await fetch(url + '/rest/v1/' + path, {
    headers: { 'apikey': key, 'Authorization': 'Bearer ' + key }
  });
  if (!r.ok) return null;
  return r.json();
}

module.exports = async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { body = {}; }
  }
  body = body || {};
  const code = String(body.code || '').toUpperCase().trim();
  const total = Number(body.total || 0);
  if (!code) return res.status(400).json({ ok: false, error: 'code required' });

  const rows = await sb(T.PROMOS + '?code=eq.' + encodeURIComponent(code) + '&active=eq.true&limit=1');
  if (!Array.isArray(rows) || !rows.length) {
    return res.status(200).json({ ok: true, valid: false, code, reason: 'not found' });
  }
  const row = rows[0];
  if (row.expires_at && new Date(row.expires_at) < new Date()) {
    return res.status(200).json({ ok: true, valid: false, code, reason: 'expired' });
  }
  if (row.min_total && total < Number(row.min_total)) {
    return res.status(200).json({
      ok: true, valid: false, code,
      reason: 'min_total_not_met',
      min_total: Number(row.min_total)
    });
  }
  return res.status(200).json({
    ok: true, valid: true, code,
    percent: Number(row.percent || 0),
    discount_uah: Math.round(total * Number(row.percent || 0) / 100)
  });
};
