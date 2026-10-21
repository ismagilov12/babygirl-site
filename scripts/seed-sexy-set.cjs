// Keep the six Sexy Set variants in sync with the storefront catalog and CRM.
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
    const body = await response.text();
    return body.trim() ? JSON.parse(body) : [];
  }
  for (const product of products) {
    const rows = await sb('bg_products?on_conflict=uid', {
      method: 'POST',
      prefer: 'return=representation,resolution=merge-duplicates',
      body: JSON.stringify(product)
    });
    await syncProductToCrm(sb, rows[0] || product, { siteOrigin: 'https://www.babygirl.com.ua' });

    const verified = await sb(
      'bg_products?select=uid,price,sizes,photo_main,photos,description&uid=eq.' + encodeURIComponent(product.uid)
    );
    const saved = verified[0];
    if (!saved || saved.price !== product.price || saved.photo_main !== product.photo_main ||
        saved.description !== product.description ||
        JSON.stringify(saved.sizes) !== JSON.stringify(product.sizes) ||
        JSON.stringify(saved.photos) !== JSON.stringify(product.photos)) {
      throw new Error('Sexy Set product verification failed: ' + product.uid);
    }
  }
  console.log('Baby Girl Sexy Set: all six product variants and CRM records synced and verified.');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
