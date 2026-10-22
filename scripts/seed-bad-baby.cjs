// Register this catalog release once; later admin edits remain authoritative.
const hoodie = require('../data/bad-baby-hoodie.json');
const { syncProductToCrm, expectedCrmRows } = require('../api/_crm-catalog');
const release = 'bad-baby-20261022';

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
    if (!response.ok) throw new Error('Bad Baby catalog request failed: HTTP ' + response.status);
    const body = await response.text();
    return body.trim() ? JSON.parse(body) : [];
  }
  for (const uid of [hoodie.uid, 'bad-baby']) {
    const current = (await sb('bg_products?select=*&uid=eq.' + uid))[0];
    if (current?.attrs?.catalog_release === release) {
      console.log('Bad Baby catalog release already registered: ' + uid);
      continue;
    }
    if (uid === 'bad-baby' && !current) throw new Error('Existing Bad Baby tee not found');
    const product = uid === hoodie.uid ? hoodie : {
      uid, active: true, in_grid: true,
      attrs: { ...current.attrs, feed_enabled: true }
    };
    const rows = await sb('bg_products?on_conflict=uid', {
      method: 'POST',
      headers: { Prefer: 'return=representation,resolution=merge-duplicates' },
      body: JSON.stringify(product)
    });
    const saved = rows[0] || (await sb('bg_products?select=*&uid=eq.' + uid))[0];
    if (!saved || !saved.active || !saved.in_grid ||
        (uid === hoodie.uid && (saved.price !== 4500 || saved.colors?.length !== 2))) {
      throw new Error('Bad Baby storefront verification failed: ' + uid);
    }
    await syncProductToCrm(sb, saved, { siteOrigin: 'https://www.babygirl.com.ua' });
    const crm = await sb('products?select=sku,price,is_active,image_url&bg_uid=eq.' + uid);
    const expected = expectedCrmRows(saved);
    for (const row of expected) {
      if (!crm.some(x => x.sku === row.sku && x.price === row.price &&
          x.is_active && x.image_url === row.image_url)) {
        throw new Error('Bad Baby CRM verification failed: ' + row.sku);
      }
    }
    await sb('bg_products?uid=eq.' + uid, {
      method: 'PATCH', body: JSON.stringify({
        attrs: { ...saved.attrs, catalog_release: release }
      })
    });
    console.log('Bad Baby storefront and CRM verified: ' + uid + ', ' + expected.length + ' CRM rows.');
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
