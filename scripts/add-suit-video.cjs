const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const video = 'assets/suit-baby-girl-video-20261028.mp4';
const source = path.join(__dirname, '../video-source/suit-20261028');
const files = fs.readdirSync(source).filter(name => /^part-\d{2}\.bin$/.test(name)).sort();
if (files.length !== 26) throw new Error('Suit video source incomplete');
const bytes = Buffer.concat(files.map(name => fs.readFileSync(path.join(source, name))));
if (crypto.createHash('sha256').update(bytes).digest('hex') !== '422b7a8eb6546a891a1cf1b6329cb5fb970bacf9449f2f6102ce74a7fb9622f2') throw new Error('Suit video integrity check failed');
fs.writeFileSync(path.join(__dirname, '..', video), bytes);
const release = 'suit-video-20261028';
async function main() {
  if (process.env.VERCEL_ENV !== 'production') return;
  const origin = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!origin || !key) throw new Error('Catalog configuration missing');
  async function sb(route, body) {
    const response = await fetch(origin + '/rest/v1/' + route, {
      method: body ? 'PATCH' : 'GET',
      headers: { apikey: key, Authorization: 'Bearer ' + key,
        'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: body ? JSON.stringify(body) : undefined
    });
    if (!response.ok) throw new Error('Suit video catalog HTTP ' + response.status);
    return response.json();
  }
  const route = 'bg_products?uid=eq.suit-baby-girl';
  const current = (await sb(route + '&select=*'))[0];
  if (!current || current.family !== 'suit') throw new Error('Oversized Suit missing');
  const codes = ['pink', 'black'];
  if (codes.some(code => !current.colors?.some(color => color.code === code))) throw new Error('Suit colors missing');
  const unique = values => [...new Set(values.filter(Boolean))];
  const colors = current.colors.map(color => codes.includes(color.code)
    ? { ...color, photos: unique([...(color.photos?.length ? color.photos : [color.photo]), video]) }
    : color);
  const photos = unique([...(current.photos?.length ? current.photos : [current.photo_main]), video]);
  await sb(route, { colors, photos });
  const saved = (await sb(route + '&select=*'))[0];
  if (saved.price !== current.price || saved.photo_main !== current.photo_main ||
      JSON.stringify(saved.colors) !== JSON.stringify(colors) ||
      JSON.stringify(saved.photos) !== JSON.stringify(photos)) throw new Error('Suit video gallery verification failed');
  await sb(route, { attrs: { ...saved.attrs, suit_video_release: release } });
  console.log('Suit video verified in pink and black galleries; existing photos and price preserved.');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
