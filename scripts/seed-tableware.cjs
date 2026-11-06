// Register the tableware release once per product so future admin edits are preserved.
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { syncProductToCrm, expectedCrmRows } = require('../api/_crm-catalog');

const release = 'baby-girl-tableware-20261106';

async function main() {
  if (process.env.VERCEL_ENV !== 'production') return;
  const origin = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!origin || !key) throw new Error('Catalog service configuration missing');

  async function sb(path, options = {}) {
    const response = await fetch(origin + '/rest/v1/' + path, {
      method: options.method || 'GET',
      headers: {
        apikey: key,
        Authorization: 'Bearer ' + key,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
        ...options.headers
      },
      body: options.body
    });
    if (!response.ok) throw new Error('Tableware catalog request failed: HTTP ' + response.status);
    const body = await response.text();
    return body.trim() ? JSON.parse(body) : [];
  }

  const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8');
  const catalog = JSON.parse(html.match(/<script id="DATA" type="application\/json">([\s\S]*?)<\/script>/)[1]);
  const products = catalog.all.filter(product => product.family === 'plate' &&
    /^(plate|mug)-/.test(product.uid));
  if (products.length !== 11) throw new Error('Expected eleven tableware products');

  for (const product of products) {
    const path = 'bg_products?uid=eq.' + encodeURIComponent(product.uid);
    let [saved] = await sb(path);
    if (saved?.attrs?.tableware_release === release) continue;

    if (!saved) {
      [saved] = await sb('bg_products?on_conflict=uid', {
        method: 'POST',
        headers: { Prefer: 'return=representation,resolution=ignore-duplicates' },
        body: JSON.stringify(product)
      });
      if (!saved) [saved] = await sb(path);
    }
    if (!saved) throw new Error('Missing admin product: ' + product.uid);

    if (product.uid === 'mug-pink-bunny' && saved.description !== product.description) {
      [saved] = await sb(path, {
        method: 'PATCH',
        body: JSON.stringify({ description: product.description })
      });
    }

    await syncProductToCrm(sb, saved);
    const crmRows = await sb('products?select=sku,price,is_active,description&bg_uid=eq.' +
      encodeURIComponent(product.uid));
    for (const expected of expectedCrmRows(saved)) {
      if (!crmRows.some(row => row.sku === expected.sku && Number(row.price) === expected.price &&
          row.is_active === expected.is_active && row.description === expected.description)) {
        throw new Error('Missing or stale CRM product: ' + expected.sku);
      }
    }

    await sb(path, {
      method: 'PATCH',
      body: JSON.stringify({ attrs: { ...saved.attrs, tableware_release: release } })
    });
  }
  console.log('Baby Girl tableware registered in the admin catalog and CRM.');
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
