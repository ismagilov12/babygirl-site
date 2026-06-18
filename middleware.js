import { rewrite, next } from '@vercel/functions';

// Runs before the filesystem, so it can serve the Showgirl page at the
// root of showgirl.world even though index.html (BabyGirl) exists at "/".
export const config = { matcher: '/' };

export default function middleware(request) {
  const host = (request.headers.get('host') || '').toLowerCase();
  if (host === 'showgirl.world' || host === 'www.showgirl.world') {
    return rewrite(new URL('/showgirl', request.url));
  }
  return next();
}
