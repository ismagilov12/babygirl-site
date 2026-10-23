// Replace only Playboy product photos; preserve lifestyle photos, video and size guide.
const { syncProductToCrm } = require('../api/_crm-catalog');
async function main() {
  if (process.env.VERCEL_ENV !== 'production') return;
  const origin = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!origin || !key) throw new Error('Catalog service configuration missing');
  async function sb(path, options = {}) {
    const response = await fetch(origin + '/rest/v1/' + path, {
      method: options.method || 'GET',
      headers: { apikey: key, Authorization: 'Bearer ' + key,
        'Content-Type': 'application/json', Prefer: 'return=representation',
        ...options.headers }, body: options.body
    });
    if (!response.ok) throw new Error('Playboy catalog request failed: HTTP ' + response.status);
    const body = await response.text();
    return body.trim() ? JSON.parse(body) : [];
  }
  const path = 'bg_products?uid=eq.playboy';
  let product = (await sb(path + '&select=*'))[0];
  if (!product) throw new Error('Existing Playboy tee not found');
  if (product.attrs?.playboy_photos_20261023) return;
  const photos = ['black', 'white', 'pink'].map(color => 'assets/playboy-product-' + color + '.webp');
  const extras = (product.photos || []).filter(photo => !photo.includes('static.tildacdn.com/') && !photos.includes(photo));
  const palette = { black: ['Black', '#0A0A0A'], white: ['White', '#FFFFFF'], pink: ['Pink', '#FF4FA1'] };
  const colors = Object.keys(palette).map((code, index) => ({
    code, name: palette[code][0], hex: palette[code][1], photo: photos[index],
    photos: [photos[index], ...photos.filter(photo => photo !== photos[index]), ...extras]
  }));
  await sb(path, { method: 'PATCH', body: JSON.stringify({
    photo_main: photos[0], photos: [...photos, ...extras], colors,
    attrs: { ...product.attrs, feed_enabled: true }
  }) });
  product = (await sb(path + '&select=*'))[0];
  if (product?.photo_main !== photos[0] || product.colors?.length !== 3 || product.photos.some(photo => photo.includes('static.tildacdn.com/'))) throw new Error('Playboy photo verification failed');
  await syncProductToCrm(sb, product);
  await sb(path, { method: 'PATCH', body: JSON.stringify({
    attrs: { ...product.attrs, playboy_photos_20261023: true }
  }) });
  console.log('Playboy three product photos replaced and verified; CRM synced.');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
