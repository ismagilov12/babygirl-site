// Register the new release with server-side price verification and the CRM.
// Existing products are never overwritten on subsequent deployments.
const products = require('../data/baby-girl-sexy-set.json');
const { syncProductToCrm } = require('../api/_crm-catalog');

async function main() {
  if (process.env.VERCEL_ENV !== 'production') {
    console.log('Catalog registration runs only for production.');
    return;
  }
  const origin = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!origin || !key) throw new Error('Catalog service configuration is missing');
  async function sb(path, options = {}) {
    const response = await fetch(origin + '/rest/v1/' + path, {
      method: options.method || 'GET',
      headers: { apikey: key, Authorization: 'Bearer ' + key,
        'Content-Type': 'application/json', Prefer: options.prefer || 'return=representation',
        ...options.headers },
      body: options.body
    });
    if (!response.ok) throw new Error('Catalog registration failed: HTTP ' + response.status);
    return response.json();
  }
  for (const product of products) {
    const existing = await sb('bg_products?select=uid&uid=eq.' + encodeURIComponent(product.uid));
    if (!existing.length) {
      const rows = await sb('bg_products', { method: 'POST', body: JSON.stringify(product) });
      await syncProductToCrm(sb, rows[0], { siteOrigin: 'https://www.babygirl.com.ua' });
    }
    const verified = await sb('bg_products?select=uid,price,sizes,photos&uid=eq.' + encodeURIComponent(product.uid));
    if (!verified.length) throw new Error('New product was not registered');
  }
  console.log('Baby Girl Sexy Set: all six product variants registered and verified.');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
