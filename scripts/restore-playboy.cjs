// Restore the existing Playboy tee once, preserving its photos, price and stock.
const { syncProductToCrm } = require('../api/_crm-catalog');
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
    if (!response.ok) throw new Error('Playboy catalog request failed: HTTP ' + response.status);
    const body = await response.text();
    return body.trim() ? JSON.parse(body) : [];
  }
  const path = 'bg_products?uid=eq.playboy';
  let product = (await sb(path + '&select=*'))[0];
  if (!product) throw new Error('Existing Playboy tee not found');
  if (product.attrs?.restored_playboy_20261023) return;
  await sb(path, { method: 'PATCH', body: JSON.stringify({
    active: true, in_grid: true,
    attrs: { ...product.attrs, feed_enabled: true }
  }) });
  product = (await sb(path + '&select=*'))[0];
  if (!product?.active || !product.in_grid) throw new Error('Playboy restoration verification failed');
  await syncProductToCrm(sb, product);
  await sb(path, { method: 'PATCH', body: JSON.stringify({
    attrs: { ...product.attrs, restored_playboy_20261023: true }
  }) });
  console.log('Playboy tee restored and verified; CRM synced.');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
