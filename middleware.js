import { rewrite, next } from '@vercel/functions';

// Runs before the filesystem, so it can serve the Showgirl pages on
// showgirl.world even though index.html / en.html (BabyGirl) exist at
// "/" and "/en".
//   showgirl.world/    -> /showgirl     (UA, UAH)
//   showgirl.world/en  -> /showgirl-en  (EN, EUR)
export const config = { matcher: ['/', '/en', '/en/'] };

const SHOWGIRL_HOSTS = ['showgirl.world', 'www.showgirl.world'];

export default function middleware(request) {
  const host = (request.headers.get('host') || '').toLowerCase();
  if (SHOWGIRL_HOSTS.indexOf(host) === -1) return next();

  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const target = path === '/en' ? '/showgirl-en' : '/showgirl';
  return rewrite(new URL(target + url.search, request.url));
}
