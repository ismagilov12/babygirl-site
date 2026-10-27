// Apply the requested price release once; preserve later admin price edits.
const release = 'four-tees-1500-20261027';
const families = ['tee', 'icons', 'soft-rebel', 'long'];
async function main() {
  if (process.env.VERCEL_ENV !== 'production') return;
  const origin = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!origin || !key) throw new Error('Catalog service configuration missing');
  async function sb(path, options = {}) {
    const response = await fetch(origin + '/rest/v1/' + path, {
      method: options.method || 'GET',
      headers: { apikey: key, Authorization: 'Bearer ' + key,
        'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: options.body
    });
    if (!response.ok) throw new Error('T-shirt price request failed: HTTP ' + response.status);
    const body = await response.text();
    return body.trim() ? JSON.parse(body) : [];
  }
  // Existing tee acts as a durable release receipt; no schema/settings changes.
  const receiptPath = 'bg_products?uid=eq.bad-baby';
  const receipt = (await sb(receiptPath + '&select=uid,attrs'))[0];
  if (!receipt) throw new Error('T-shirt release receipt product missing');
  if (receipt.attrs?.selected_price_release === release) {
    console.log('T-shirt UAH 1500 price release already applied');
    return;
  }
  const selection = 'bg_products?active=eq.true&uid=in.(bad-baby,tee-ya-ne-yibu,tee-pizdets,tee-pokhui)';
  const before = await sb(selection + '&select=uid,title,family,price&order=uid.asc&limit=1000');
  if (before.length !== 4) throw new Error('Unexpected T-shirt catalog size');
  for (const product of before) {
    if (!families.includes(product.family)) throw new Error('Unexpected product family');
    const uid = encodeURIComponent(product.uid);
    const saved = await sb('bg_products?uid=eq.' + uid, {
      method: 'PATCH', body: JSON.stringify({ price: 1500 })
    });
    if (saved.length !== 1 || saved[0].price !== 1500) throw new Error('T-shirt price verification failed: ' + product.uid);
    // Keep existing CRM cards and color variants at the same price; no other fields change.
    await sb('products?bg_uid=eq.' + uid, {
      method: 'PATCH', body: JSON.stringify({ price: 1500 })
    });
    const crm = await sb('products?bg_uid=eq.' + uid + '&select=price');
    if (crm.some(row => Number(row.price) !== 1500)) throw new Error('CRM price verification failed: ' + product.uid);
  }
  const after = await sb(selection + '&select=uid,price&limit=1000');
  if (after.length !== before.length || after.some(p => Number(p.price) !== 1500) ||
      before.some(p => !after.some(q => q.uid === p.uid))) {
    throw new Error('T-shirt catalog final price verification failed');
  }
  const freshReceipt = (await sb(receiptPath + '&select=attrs'))[0];
  await sb(receiptPath, { method: 'PATCH', body: JSON.stringify({
    attrs: { ...freshReceipt.attrs, selected_price_release: release }
  }) });
  console.log('T-shirt prices verified: ' + after.length + ' active products at UAH 1500; Bad Baby and three requested slogan tees.');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
