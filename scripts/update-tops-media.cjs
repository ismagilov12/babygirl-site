// Apply the requested top prices and gallery cleanup once, using existing SKUs.
const { syncProductToCrm, expectedCrmRows } = require('../api/_crm-catalog');
const topUids = ['crop-badgirls', 'crop-bad-baby', 'crop-only-fans', 'crop-pornstar'];
const release = 'tops_1100_clean_gallery_20261025';
function unwanted(url, top) {
  return String(url).includes('crop-collection-video.mp4') ||
    (top && String(url).includes('tee-label-20261012-'));
}
function cleanedMedia(product, top) {
  return {
    photos: (product.photos || []).filter(url => !unwanted(url, top)),
    colors: (product.colors || []).map(color => {
      const clean = { ...color };
      if (Array.isArray(color.photos)) clean.photos = color.photos.filter(url => !unwanted(url, top));
      return clean;
    })
  };
}
async function main() {
  if (process.env.VERCEL_ENV !== 'production') return;
  const origin = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!origin || !key) throw new Error('Catalog service configuration missing');
  async function sb(path, options = {}) {
    const response = await fetch(origin + '/rest/v1/' + path, {
      method: options.method || 'GET',
      headers: { apikey: key, Authorization: 'Bearer ' + key,
        'Content-Type': 'application/json', Prefer: 'return=representation', ...options.headers },
      body: options.body
    });
    if (!response.ok) throw new Error('Catalog update failed: HTTP ' + response.status);
    const body = await response.text();
    return body.trim() ? JSON.parse(body) : [];
  }
  const products = await sb('bg_products?select=*&limit=1000');
  if (topUids.some(uid => !products.some(p => p.uid === uid && p.family === 'crop'))) {
    throw new Error('Expected four existing tops not found');
  }
  for (const product of products) {
    if (String(product.family).startsWith('sg-')) continue;
    const top = topUids.includes(product.uid);
    const updatePrice = top && !product.attrs?.[release];
    const media = cleanedMedia(product, top);
    const mediaChanged = JSON.stringify(media.photos) !== JSON.stringify(product.photos || []) ||
      JSON.stringify(media.colors) !== JSON.stringify(product.colors || []);
    if (!updatePrice && !mediaChanged) continue;
    const path = 'bg_products?uid=eq.' + encodeURIComponent(product.uid);
    const patch = { ...media, updated_at: new Date().toISOString() };
    if (updatePrice) { patch.price = 1100; patch.price_old = null; }
    const saved = (await sb(path, { method: 'PATCH', body: JSON.stringify(patch) }))[0];
    if (!saved || (updatePrice && (saved.price !== 1100 || saved.price_old !== null)) ||
        JSON.stringify(saved.photos) !== JSON.stringify(media.photos) ||
        JSON.stringify(saved.colors) !== JSON.stringify(media.colors) ||
        saved.active !== product.active || saved.in_grid !== product.in_grid) {
      throw new Error('Catalog update verification failed: ' + product.uid);
    }
    if (top) {
      await syncProductToCrm(sb, saved, { siteOrigin: 'https://www.babygirl.com.ua' });
      const crm = await sb('products?select=sku,price,is_active&bg_uid=eq.' + product.uid);
      for (const row of expectedCrmRows(saved)) {
        if (!crm.some(x => x.sku === row.sku && x.price === saved.price && x.is_active)) {
          throw new Error('CRM top price verification failed: ' + product.uid);
        }
      }
      await sb(path, { method: 'PATCH', body: JSON.stringify({ attrs: { ...saved.attrs, [release]: true } }) });
    }
    console.log('Catalog media and price verified: ' + product.uid);
  }
  const verified = await sb('bg_products?select=uid,price,photos,colors,attrs&limit=1000');
  if (verified.some(p => p.photos?.some(url => unwanted(url, topUids.includes(p.uid))) ||
      p.colors?.some(c => c.photos?.some(url => unwanted(url, topUids.includes(p.uid)))))) {
    throw new Error('Unwanted media remains in catalog');
  }
  console.log('Requested top prices, CRM prices and gallery cleanup verified.');
}
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { cleanedMedia, main };
