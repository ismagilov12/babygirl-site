// A separate catalog SKU lets the existing server-side checkout validate the version price.
const { syncProductToCrm, expectedCrmRows } = require('../api/_crm-catalog');
async function main() {
  if (process.env.VERCEL_ENV !== 'production') return;
  const origin = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!origin || !key) throw new Error('Catalog service configuration missing');
  async function sb(path, options = {}) {
    const response = await fetch(origin + '/rest/v1/' + path, {
      method: options.method || 'GET',
      headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json',
        Prefer: 'return=representation', ...options.headers }, body: options.body
    });
    if (!response.ok) throw new Error('Bad Baby extended version request failed: HTTP ' + response.status);
    const text = await response.text(); return text.trim() ? JSON.parse(text) : [];
  }
  const uid = 'bad-baby-long';
  let product = (await sb('bg_products?uid=eq.' + uid + '&select=*'))[0];
  if (!product) {
    const base = (await sb('bg_products?uid=eq.bad-baby&select=*'))[0];
    if (!base) throw new Error('Bad Baby T-shirt missing');
    product = {};
    for (const field of ['family','photo_main','photos','sizes','colors','cost']) {
      if (base[field] !== undefined) product[field] = base[field];
    }
    Object.assign(product, { uid, title: base.title + ' — подовжена версія (можна носити як сукню)',
      price: 2500, price_old: null, active: true, featured: false, in_grid: false,
      description: 'Подовжена версія Bad Baby — можна носити як сукню.\n\n' + (base.description || ''),
      attrs: { ...base.attrs, feed_enabled: false, parent_uid: 'bad-baby', version: 'long' }
    });
    product = (await sb('bg_products', { method: 'POST', body: JSON.stringify(product) }))[0];
  }
  await syncProductToCrm(sb, product, { siteOrigin: 'https://www.babygirl.com.ua' });
  const saved = (await sb('bg_products?uid=eq.' + uid + '&select=uid,price,in_grid,active'))[0];
  const crm = await sb('products?bg_uid=eq.' + uid + '&select=sku,price,is_active');
  if (!saved || !saved.active || saved.in_grid !== product.in_grid || Number(saved.price) !== Number(product.price) ||
      expectedCrmRows(product).some(row => !crm.some(x => x.sku === row.sku && Number(x.price) === Number(row.price) && x.is_active))) {
    throw new Error('Bad Baby extended version verification failed');
  }
  console.log('Bad Baby extended version verified in storefront and CRM: ' + saved.price + ' UAH');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
