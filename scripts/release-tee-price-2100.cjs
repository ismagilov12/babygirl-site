// One-time production release for the storefront's regular T-shirt sale.
const release = 'regular-tees-sale-1500-20261117';
const selection = 'active=eq.true&family=in.(tee,icons,self-love,soft-rebel)&uid=neq.baby-girl';
const receiptPath = 'bg_products?uid=eq.tee-too-sexy-stress';
const price = 1500;
const priceOld = 2100;

async function request(path, patch) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const response = await fetch(process.env.SUPABASE_URL + '/rest/v1/' + path, {
    method: patch ? 'PATCH' : 'GET',
    headers: {
      apikey: key,
      Authorization: 'Bearer ' + key,
      'Content-Type': 'application/json',
      Prefer: 'return=representation'
    },
    body: patch ? JSON.stringify(patch) : undefined
  });
  if (!response.ok) throw new Error('Catalog request failed: HTTP ' + response.status);
  return response.json();
}

async function main() {
  if (process.env.VERCEL_ENV !== 'production') return;
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Catalog service configuration missing');
  }

  const [receipt] = await request(receiptPath + '&select=uid,attrs');
  if (!receipt) throw new Error('T-shirt release receipt product missing');
  if (receipt.attrs?.tee_price_release === release) return;

  const catalog = 'bg_products?' + selection + '&select=uid,price&limit=500';
  const products = await request(catalog);
  if (!products.length || products.length >= 500) throw new Error('Unexpected T-shirt catalog size');

  const uids = products.map(p => encodeURIComponent(p.uid)).join(',');
  const crm = 'products?bg_uid=in.(' + uids + ')&select=bg_uid,price&limit=1000';
  const crmProducts = await request(crm);
  if (crmProducts.length >= 1000) throw new Error('Unexpected CRM catalog size');

  const updated = await request(catalog, { price, price_old: priceOld });
  const updatedCrm = await request(crm, { price });
  if (updated.length !== products.length || updated.some(p => Number(p.price) !== price || Number(p.price_old) !== priceOld) ||
      updatedCrm.length !== crmProducts.length || updatedCrm.some(p => Number(p.price) !== price)) {
    throw new Error('T-shirt price verification failed');
  }

  const [current] = await request(receiptPath + '&select=attrs');
  const [saved] = await request(receiptPath + '&select=attrs', {
    attrs: { ...current.attrs, tee_price_release: release }
  });
  if (saved?.attrs?.tee_price_release !== release) throw new Error('Release receipt verification failed');
  console.log('Set ' + updated.length + ' T-shirts to UAH ' + price + ' with UAH ' + priceOld + ' crossed out; updated ' + updatedCrm.length + ' CRM records.');
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
