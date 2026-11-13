'use strict';

const SET_UIDS = [
  'sg-leo-black',
  'sg-leo-red',
  'sg-cow-pink',
  'sg-red-velvet',
  'sg-tension',
  'sg-bunny',
  'sg-pink-kiss',
  'sg-holographic-queen',
  'sg-blue-star',
  'sg-wild-lime'
];

(async function migrateShowgirlSetPrices() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.warn('[showgirl price] Supabase environment is unavailable; storefront price overrides remain active.');
    return;
  }

  try {
    const query = new URLSearchParams({
      uid: 'in.(' + SET_UIDS.join(',') + ')',
      price: 'eq.1495'
    });
    const response = await fetch(url.replace(/\\/$/, '') + '/rest/v1/bg_products?' + query.toString(), {
      method: 'PATCH',
      headers: {
        apikey: key,
        Authorization: 'Bearer ' + key,
        'Content-Type': 'application/json',
        Prefer: 'return=representation'
      },
      body: JSON.stringify({ price: 2000, price_old: 2990 })
    });
    if (!response.ok) {
      console.warn('[showgirl price] Catalog update was not applied:', response.status);
      return;
    }
    const rows = await response.json();
    console.log('[showgirl price] Updated legacy lingerie sets:', Array.isArray(rows) ? rows.length : 0);
  } catch (error) {
    console.warn('[showgirl price] Catalog update could not be completed:', error.message);
  }
})();
