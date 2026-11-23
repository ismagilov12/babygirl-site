import { rewrite, next } from '@vercel/functions';

// Runs before the filesystem, so it can serve the Showgirl pages on
// showgirl.world even though index.html / en.html (BabyGirl) exist at
// "/" and "/en".
//   showgirl.world/    -> /showgirl-en  (unified checkout: Ukraine + worldwide)
//   showgirl.world/en  -> /showgirl-en  (same unified storefront)
export const config = { matcher: ['/', '/en', '/en/', '/showgirl', '/showgirl/', '/black-friday', '/black-friday.html'] };

const SHOWGIRL_HOSTS = ['showgirl.world', 'www.showgirl.world'];

export default function middleware(request) {
  const host = (request.headers.get('host') || '').toLowerCase();
  if (SHOWGIRL_HOSTS.indexOf(host) === -1) return next();

  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  if (path === '/black-friday' || path === '/black-friday.html') {
    return Response.redirect(new URL('/black-friday' + url.search, 'https://www.babygirl.com.ua'), 307);
  }
  const target = '/showgirl-en';
  return rewrite(new URL(target + url.search, request.url));
}
