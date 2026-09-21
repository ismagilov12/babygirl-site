// api/admin-products.js — CRUD endpoint для bg_products.
// Auth: header X-Admin-Password = env BG_ADMIN_PASSWORD.
// Operates через SUPABASE_SERVICE_ROLE_KEY (bypass RLS).
//
// Methods/actions (via POST body):
//   {action: "list"} // active catalog only
//   {action: "upsert", payload: {...product...}}
//   {action: "set_feed_enabled", payload: {uid: "...", enabled: true|false}}
//   {action: "retire", payload: {uid: "..."}}
//   {action: "delete", payload: {uid: "..."}}
//   {action: "reorder", payload: {orders: [{uid, sort_order}, ...]}}
//   {action: "sync_crm"} // repair/reconcile the entire active CRM catalog

const cfg = require('./_config');
const crmCatalog = require('./_crm-catalog');
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
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Admin-Password');
  return isAllowed;
}

async function sb(path, opts) {
  opts = opts || {};
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE env missing');
  const r = await fetch(url + '/rest/v1/' + path, {
    method: opts.method || 'GET',
    headers: Object.assign({
      'apikey': key,
      'Authorization': 'Bearer ' + key,
      'Content-Type': 'application/json',
      'Prefer': opts.prefer || 'return=representation'
    }, opts.headers || {}),
    body: opts.body
  });
  const text = await r.text().catch(() => '');
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch (e) { json = null; }
  if (!r.ok) {
    const err = new Error('Supabase ' + path + ' -> ' + r.status + ' ' + text.slice(0, 300));
    err.status = r.status;
    throw err;
  }
  return json;
}

module.exports = async function handler(req, res) {
  setCors(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST')    return res.status(405).json({ error: 'method not allowed' });

  // Auth
  const pwd = req.headers['x-admin-password'];
  const expected = process.env.BG_ADMIN_PASSWORD;
  if (!expected) return res.status(500).json({ error: 'BG_ADMIN_PASSWORD env not set' });
  if (!pwd || pwd !== expected) return res.status(401).json({ error: 'bad password' });

  let body = req.body;
  if (!body || typeof body === 'string') {
    try { body = JSON.parse(body || '{}'); } catch (e) { body = {}; }
  }
  const action = (body && body.action) || '';
  const payload = (body && body.payload) || {};

  try {
    if (action === 'list') {
      const rows = await sb(T.PRODUCTS + '?select=*&active=eq.true&order=sort_order.asc&limit=500');
      return res.status(200).json({ ok: true, products: rows || [] });
    }

    if (action === 'upsert') {
      if (!payload.uid || !payload.title || typeof payload.price !== 'number') {
        return res.status(400).json({ error: 'uid, title, price required' });
      }
      const allowedCols = [
        'uid','title','color_name','color_hex','family','price','price_old',
        'active','featured','in_grid','sort_order','ribbon','photo_main',
        'photos','sizes','colors','description','attrs'
      ];
      const clean = {};
      for (const k of allowedCols) if (k in payload) clean[k] = payload[k];
      if (clean.family === 'hoodie' && !String(clean.description || '').trim()) {
        clean.description = crmCatalog.DEFAULT_HOODIE_DESCRIPTION;
      }
      clean.updated_at = new Date().toISOString();
      const rows = await sb(
        T.PRODUCTS + '?on_conflict=uid',
        {
          method: 'POST',
          headers: { 'Prefer': 'return=representation,resolution=merge-duplicates' },
          body: JSON.stringify(clean)
        }
      );
      const product = (rows && rows[0]) || null;
      const crm = product ? await crmCatalog.syncProductToCrm(sb, product) : null;
      return res.status(200).json({ ok: true, product, crm });
    }

    if (action === 'set_feed_enabled') {
      if (!payload.uid || typeof payload.enabled !== 'boolean') {
        return res.status(400).json({ error: 'uid and boolean enabled required' });
      }

      const uid = String(payload.uid);
      const current = await sb(
        T.PRODUCTS + '?select=uid,attrs&uid=eq.' + encodeURIComponent(uid) + '&limit=1'
      );
      if (!current || !current[0]) return res.status(404).json({ error: 'product not found' });

      const attrs = Object.assign({}, current[0].attrs || {}, { feed_enabled: payload.enabled });
      const rows = await sb(
        T.PRODUCTS + '?uid=eq.' + encodeURIComponent(uid),
        {
          method: 'PATCH',
          headers: { 'Prefer': 'return=representation' },
          body: JSON.stringify({ attrs, updated_at: new Date().toISOString() })
        }
      );
      return res.status(200).json({ ok: true, product: (rows && rows[0]) || null });
    }

    if (action === 'retire') {
      if (!payload.uid) return res.status(400).json({ error: 'uid required' });

      const uid = String(payload.uid);
      const current = await sb(
        T.PRODUCTS + '?select=uid,attrs&uid=eq.' + encodeURIComponent(uid) + '&limit=1'
      );
      if (!current || !current[0]) return res.status(404).json({ error: 'product not found' });

      const retiredAt = new Date().toISOString();
      const attrs = Object.assign({}, current[0].attrs || {}, {
        feed_enabled: false,
        retired_at: retiredAt
      });
      const rows = await sb(
        T.PRODUCTS + '?uid=eq.' + encodeURIComponent(uid),
        {
          method: 'PATCH',
          headers: { 'Prefer': 'return=representation' },
          body: JSON.stringify({
            active: false,
            in_grid: false,
            featured: false,
            attrs,
            updated_at: retiredAt
          })
        }
      );
      const crm = await crmCatalog.deactivateCrmProduct(sb, uid);
      return res.status(200).json({ ok: true, product: (rows && rows[0]) || null, crm });
    }

    if (action === 'delete') {
      if (!payload.uid) return res.status(400).json({ error: 'uid required' });
      const uid = String(payload.uid);
      const current = await sb(
        T.PRODUCTS + '?select=uid,attrs&uid=eq.' + encodeURIComponent(uid) + '&limit=1'
      );
      if (!current || !current[0]) return res.status(404).json({ error: 'product not found' });
      const retiredAt = new Date().toISOString();
      const attrs = Object.assign({}, current[0].attrs || {}, {
        feed_enabled: false,
        retired_at: retiredAt
      });
      const rows = await sb(
        T.PRODUCTS + '?uid=eq.' + encodeURIComponent(uid),
        {
          method: 'PATCH',
          headers: { 'Prefer': 'return=representation' },
          body: JSON.stringify({
            active: false,
            in_grid: false,
            featured: false,
            attrs,
            updated_at: retiredAt
          })
        }
      );
      const crm = await crmCatalog.deactivateCrmProduct(sb, uid);
      return res.status(200).json({ ok: true, retired: true, product: (rows && rows[0]) || null, crm });
    }

    if (action === 'reorder') {
      // bulk sort_order update via individual PATCH (Supabase REST doesn't support batch update by id)
      const orders = Array.isArray(payload.orders) ? payload.orders : [];
      const updates = [];
      for (const o of orders) {
        if (!o.uid) continue;
        await sb(
          T.PRODUCTS + '?uid=eq.' + encodeURIComponent(o.uid),
          {
            method: 'PATCH',
            headers: { 'Prefer': 'return=minimal' },
            body: JSON.stringify({ sort_order: Number(o.sort_order) || 0 })
          }
        );
        updates.push(o.uid);
      }
      return res.status(200).json({ ok: true, updated: updates.length });
    }

    if (action === 'sync_crm') {
      const products = await sb(T.PRODUCTS + '?select=*&order=sort_order.asc&limit=1000');
      const crm = await crmCatalog.syncCatalogToCrm(sb, products || []);
      return res.status(200).json({ ok: true, crm });
    }

    return res.status(400).json({ error: 'unknown action: ' + action });
  } catch (e) {
    console.error('[admin-products] error', e);
    return res.status(e.status || 500).json({ error: e.message || 'server error' });
  }
};
