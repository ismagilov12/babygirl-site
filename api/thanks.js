// api/thanks.js — serves thanks.html on any method (GET/POST).
// WFP делает POST на approvedUrl/declinedUrl → Vercel static отвергает POST'ом 405,
// поэтому отдаём через serverless handler. cleanUrls + rewrite в vercel.json
// делают /thanks → /api/thanks (см. vercel.json).

const fs = require('fs');
const path = require('path');

let cachedHtml = null;

function loadHtml() {
  if (cachedHtml) return cachedHtml;
  // thanks.html лежит в корне репозитория (рядом с index.html).
  // На Vercel relative path к serverless function — это process.cwd() = корень проекта.
  const candidates = [
    path.join(process.cwd(), 'thanks.html'),
    path.join(__dirname, '..', 'thanks.html'),
  ];
  for (const p of candidates) {
    try {
      cachedHtml = fs.readFileSync(p, 'utf-8');
      return cachedHtml;
    } catch (_) {}
  }
  return null;
}

module.exports = async function handler(req, res) {
  // CORS / OPTIONS — мало ли
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(204).end();
  }

  // Принимаем GET (юзер сам открыл) и POST (WFP redirect с form-data).
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).send('Method Not Allowed');
  }

  const html = loadHtml();
  if (!html) {
    console.error('[thanks] thanks.html not found in any candidate path');
    return res.status(500).send('thanks template missing');
  }

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=60, must-revalidate');
  return res.status(200).send(html);
};
