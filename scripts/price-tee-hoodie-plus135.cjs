// One-time catalog price release. Per-product receipts make interrupted builds safe to retry.
const RELEASE = 'tee-hoodie-plus135-20261103';
const FAMILIES = new Set(['tee', 'icons', 'self-love', 'soft-rebel', 'long', 'hoodie']);
async function runRelease(env = process.env, request = fetch) {
  if (env.VERCEL_ENV !== 'production') return { updated: 0 };
  const origin = env.SUPABASE_URL, key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!origin || !key) throw new Error('Catalog service configuration missing');
  async function sb(path, method = 'GET', body) {
    const response = await request(origin + '/rest/v1/' + path, {
      method,
      headers: { apikey:key, Authorization:'Bearer ' + key, 'Content-Type':'application/json', Prefer:'return=representation' },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    if (!response.ok) throw new Error('Price release request failed: HTTP ' + response.status);
    const text = await response.text();
    return text.trim() ? JSON.parse(text) : [];
  }
  const rows = await sb('bg_products?active=eq.true&select=uid,title,family,price,attrs&order=uid.asc&limit=1000');
  if (!rows.length || rows.length >= 1000) throw new Error('Unexpected catalog size');
  const targets = rows.filter(p => FAMILIES.has(p.family));
  let updated = 0;
  for (const p of targets) {
    let current = p;
    const uid = encodeURIComponent(p.uid);
    if (!p.attrs?.[RELEASE]) {
      const before = Number(p.price);
      if (!Number.isFinite(before) || before <= 0) throw new Error('Invalid price: ' + p.uid);
      const after = before + 135;
      const patch = { price:after, attrs:{...p.attrs, [RELEASE]:{before,after}} };
      if (p.uid === 'soft-rebel') patch.family = 'tee';
      if (p.uid === 'bad-baby-long') { patch.family = 'long'; patch.in_grid = true; }
      const saved = await sb('bg_products?uid=eq.' + uid + '&price=eq.' + before, 'PATCH', patch);
      if (saved.length === 1) { current = saved[0]; updated++; }
      else {
        current = (await sb('bg_products?uid=eq.' + uid + '&select=uid,price,attrs'))[0];
        if (!current?.attrs?.[RELEASE]) throw new Error('Concurrent price change: ' + p.uid);
      }
    }
    // Sync matching CRM product/color cards to the canonical selling price.
    await sb('products?bg_uid=eq.' + uid, 'PATCH', {price:Number(current.price)});
    const check = await sb('bg_products?uid=eq.' + uid + '&select=price,attrs');
    if (check.length !== 1 || !check[0].attrs?.[RELEASE] || Number(check[0].price) !== Number(current.price))
      throw new Error('Catalog verification failed: ' + p.uid);
    const crm = await sb('products?bg_uid=eq.' + uid + '&select=price');
    if (crm.some(row => Number(row.price) !== Number(current.price))) throw new Error('CRM verification failed: ' + p.uid);
  }
  console.log('Price release verified: ' + targets.length + ' products; newly increased: ' + updated);
  return {updated, total:targets.length};
}
module.exports = {runRelease, RELEASE};
if (require.main === module) runRelease().catch(error => { console.error(error.message); process.exitCode = 1; });
