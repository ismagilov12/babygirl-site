// Append the approved photos only to the pink Oversized Suit gallery.
const release = 'pink-suit-gallery-20261028';
const photos = [
  "assets/suit-baby-girl-pink-lifestyle-1-20261028.webp",
  "assets/suit-baby-girl-pink-lifestyle-2-20261028.webp",
  "assets/suit-baby-girl-pink-lifestyle-3-20261028.webp",
  "assets/suit-baby-girl-pink-lifestyle-4-20261028.webp",
  "assets/suit-baby-girl-pink-lifestyle-5-20261028.webp",
  "assets/suit-baby-girl-pink-lifestyle-6-20261028.webp",
  "assets/suit-baby-girl-pink-lifestyle-7-20261028.webp"
];
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
    if (!response.ok) throw new Error('Pink suit gallery request failed: HTTP ' + response.status);
    const body = await response.text();
    return body.trim() ? JSON.parse(body) : [];
  }
  const path = 'bg_products?uid=eq.suit-baby-girl';
  const current = (await sb(path + '&select=*'))[0];
  if (!current || current.family !== 'suit') throw new Error('Oversized Suit not found');
  if (current.attrs?.pink_photos_release === release) {
    console.log('Pink suit gallery release already applied');
    return;
  }
  const pink = (current.colors || []).find(color => color.code === 'pink');
  if (!pink) throw new Error('Pink suit color not found');
  const unique = items => [...new Set(items.filter(Boolean))];
  const colors = current.colors.map(color => color.code === 'pink'
    ? { ...color, photos: unique([...(color.photos || [color.photo]), ...photos]) }
    : color);
  await sb(path, { method: 'PATCH', body: JSON.stringify({
    photos: unique([...(current.photos || [current.photo_main]), ...photos]), colors
  }) });
  const saved = (await sb(path + '&select=*'))[0];
  const savedPink = (saved?.colors || []).find(color => color.code === 'pink');
  if (!savedPink || photos.some(photo => !savedPink.photos.includes(photo)) ||
      photos.some(photo => !saved.photos.includes(photo)) ||
      saved.photo_main !== current.photo_main || savedPink.photo !== pink.photo ||
      saved.price !== current.price ||
      JSON.stringify(saved.colors.filter(color => color.code !== 'pink')) !==
      JSON.stringify(current.colors.filter(color => color.code !== 'pink'))) {
    throw new Error('Pink suit gallery verification failed');
  }
  await sb(path, { method: 'PATCH', body: JSON.stringify({
    attrs: { ...saved.attrs, pink_photos_release: release }
  }) });
  console.log('Pink Oversized Suit gallery verified: 7 new photos; price and other colors preserved.');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
