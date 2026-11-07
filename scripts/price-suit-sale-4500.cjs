// One product release for the pink and black variants of the Oversized Suit.
const { syncProductToCrm } = require('../api/_crm-catalog');
const release = 'suit-sale-4500-20261107';
async function main() {
  if (process.env.VERCEL_ENV !== 'production') return;
  const origin = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!origin || !key) throw new Error('Catalog configuration missing');
  async function sb(path, options = {}) {
    const response = await fetch(origin + '/rest/v1/' + path, {
      method: options.method || 'GET',
      headers: {apikey:key, Authorization:'Bearer ' + key, 'Content-Type':'application/json',
        Prefer:'return=representation', ...options.headers},
      body: options.body
    });
    if (!response.ok) throw new Error('Suit sale request failed: HTTP ' + response.status);
    const body = await response.text();
    return body.trim() ? JSON.parse(body) : [];
  }
  const path = 'bg_products?uid=eq.suit-baby-girl';
  const [current] = await sb(path);
  if (!current || current.family !== 'suit') throw new Error('Suit product missing');
  if (current.attrs?.suit_sale_release === release) return;
  const [saved] = await sb(path, {method:'PATCH', body:JSON.stringify({price:4500,price_old:6000})});
  if (!saved || Number(saved.price) !== 4500 || Number(saved.price_old) !== 6000) {
    throw new Error('Suit sale price verification failed');
  }
  await syncProductToCrm(sb, saved);
  const crm = await sb('products?select=sku,price&bg_uid=eq.suit-baby-girl');
  if (!crm.length || crm.some(row => Number(row.price) !== 4500)) {
    throw new Error('Suit CRM sale price verification failed');
  }
  await sb(path, {method:'PATCH',body:JSON.stringify({
    attrs:{...saved.attrs,suit_sale_release:release}
  })});
  console.log('Pink and black Suit sale verified in storefront and CRM: 4500 UAH, previous price 6000 UAH.');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
