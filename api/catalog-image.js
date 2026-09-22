// JPEG images for catalog crawlers; source is restricted to this storefront's assets.
const sharp = require('sharp');
module.exports = async function(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.status(405).end(); return; }
  const src = req.query && req.query.src;
  if (typeof src !== 'string' || !/^assets\/[a-zA-Z0-9_-]+\.(webp|png|jpe?g)$/i.test(src)) {
    res.status(400).send('Invalid image'); return;
  }
  try {
    const upstream = await fetch('https://www.babygirl.com.ua/' + src, {
      redirect: 'error', signal: AbortSignal.timeout(12000)
    });
    if (!upstream.ok || !String(upstream.headers.get('content-type')).startsWith('image/')) {
      res.status(404).send('Image not found'); return;
    }
    const input = Buffer.from(await upstream.arrayBuffer());
    if (input.length > 16 * 1024 * 1024) { res.status(413).send('Image too large'); return; }
    const image = await sharp(input, { limitInputPixels: 40000000 }).rotate()
      .flatten({ background: '#ffffff' })
      .resize({ width: 2000, height: 2000, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 90, chromaSubsampling: '4:4:4' }).toBuffer();
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Content-Length', String(image.length));
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.status(200);
    if (req.method === 'HEAD') res.end(); else res.send(image);
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(502).send('Image temporarily unavailable');
  }
};
