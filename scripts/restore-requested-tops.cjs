// Restore these existing tops once; subsequent admin edits stay authoritative.
const { syncProductToCrm, expectedCrmRows } = require('../api/_crm-catalog');
const uids = ['crop-badgirls', 'crop-bad-baby', 'crop-only-fans', 'crop-pornstar'];
const marker = 'restored_requested_tops_20261025';
async function main() {
  if (process.env.VERCEL_ENV !== 'production') return;
  const origin = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!origin || !key) throw new Error('Catalog service configuration missing');
  async function sb(path, options = {}) {
    const response = await fetch(origin + '/rest/v1/' + path, {
      method: options.method || 'GET',
      headers: { apikey: key, Authorization: 'Bearer ' + key,
        'Content-Type': 'application/json', Prefer: 'return=representation',
        ...options.headers }, body: options.body
    });
    if (!response.ok) throw new Error('Top restoration request failed: HTTP ' + response.status);
    const body = await response.text();
    return body.trim() ? JSON.parse(body) : [];
  }
  // Validate all four identities before changing any rows.
  const products = await sb('bg_products?select=*&uid=in.(' + uids.join(',') + ')');
  if (products.length !== uids.length || uids.some(uid => !products.some(p => p.uid === uid && p.family === 'crop' && p.photo_main && p.price > 0))) {
    throw new Error('Expected existing top catalog records not found');
  }
  for (const uid of uids) {
    const current = products.find(p => p.uid === uid);
    if (current.attrs?.[marker]) continue;
    const path = 'bg_products?uid=eq.' + uid;
    const saved = (await sb(path, { method: 'PATCH', body: JSON.stringify({
      active: true, in_grid: true, updated_at: new Date().toISOString()
    }) }))[0];
    if (!saved?.active || !saved.in_grid || saved.price !== current.price ||
        saved.photo_main !== current.photo_main ||
        JSON.stringify(saved.colors) !== JSON.stringify(current.colors) ||
        JSON.stringify(saved.photos) !== JSON.stringify(current.photos)) {
      throw new Error('Top restoration verification failed: ' + uid);
    }
    await syncProductToCrm(sb, saved, { siteOrigin: 'https://www.babygirl.com.ua' });
    const crm = await sb('products?select=sku,price,is_active,image_url&bg_uid=eq.' + uid);
    for (const row of expectedCrmRows(saved)) {
      if (!crm.some(x => x.sku === row.sku && x.price === row.price && x.is_active && x.image_url === row.image_url)) {
        throw new Error('Top CRM verification failed: ' + uid);
      }
    }
    await sb(path, { method: 'PATCH', body: JSON.stringify({
      attrs: { ...saved.attrs, [marker]: true }
    }) });
    console.log('Top restored; photos, colors and price preserved; CRM verified: ' + uid);
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
