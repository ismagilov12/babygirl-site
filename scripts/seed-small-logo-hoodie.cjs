// One scoped catalog release; future admin edits remain authoritative.
const product = require('../data/small-logo-hoodie.json');
const { syncProductToCrm, expectedCrmRows } = require('../api/_crm-catalog');
const release = 'small-logo-hoodie-20261027';

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
    if (!response.ok) throw new Error('Small-logo hoodie catalog request failed: HTTP ' + response.status);
    const body = await response.text();
    return body.trim() ? JSON.parse(body) : [];
  }
  const path = 'bg_products?uid=eq.' + product.uid;
  const current = (await sb(path + '&select=*'))[0];
  if (current?.attrs?.catalog_release === release) {
    console.log('Small-logo hoodie catalog release already registered');
    return;
  }
  if (current && (current.title !== product.title || current.price !== product.price)) {
    throw new Error('Existing Small-logo hoodie differs; refusing to replace admin edits');
  }
  const rows = current ? [current] : await sb('bg_products?on_conflict=uid', {
    method: 'POST', headers: { Prefer: 'return=representation,resolution=ignore-duplicates' },
    body: JSON.stringify(product)
  });
  const saved = rows[0] || (await sb(path + '&select=*'))[0];
  if (!saved || saved.title !== product.title || saved.price !== 2990 ||
      !saved.active || !saved.in_grid || saved.colors?.length !== 2 ||
      saved.photos?.length !== 3 || saved.photo_main !== product.photo_main) {
    throw new Error('Small-logo hoodie storefront verification failed');
  }
  await syncProductToCrm(sb, saved, { siteOrigin: 'https://www.babygirl.com.ua' });
  const crm = await sb('products?select=sku,price,is_active,image_url&bg_uid=eq.' + product.uid);
  const expected = expectedCrmRows(saved);
  for (const row of expected) {
    if (!crm.some(x => x.sku === row.sku && x.price === row.price &&
        x.is_active && x.image_url === row.image_url)) {
      throw new Error('Small-logo hoodie CRM verification failed: ' + row.sku);
    }
  }
  await sb(path, { method: 'PATCH', body: JSON.stringify({
    attrs: { ...saved.attrs, catalog_release: release }
  }) });
  const verified = (await sb(path + '&select=uid,price,attrs'))[0];
  if (verified?.price !== 2990 || verified?.attrs?.catalog_release !== release) {
    throw new Error('Small-logo hoodie release marker verification failed');
  }
  console.log('Small-logo hoodie storefront and CRM verified: ' + product.uid + ', ' + expected.length + ' CRM rows.');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
