import { NextRequest, NextResponse } from 'next/server';

// serika.cc is the short-link domain: every request to it must land on the
// app domain (serika.chat) with the same path + query. The check is exact on
// hostname so requests already on serika.chat can never re-enter this branch
// (no redirect loops).
const SHORT_LINK_HOSTS = new Set(['serika.cc', 'www.serika.cc']);
const APP_HOST = 'serika.chat';

export function middleware(request: NextRequest) {
  const host = request.nextUrl.hostname.toLowerCase();

  if (SHORT_LINK_HOSTS.has(host)) {
    const url = request.nextUrl.clone();
    url.hostname = APP_HOST;
    url.protocol = 'https:';
    url.port = '';

    // Single-segment paths (e.g. /abc123) are invite codes — redirect to
    // /invite/CODE so the URL bar shows a clean invite URL on serika.chat.
    const segments = url.pathname.split('/').filter(Boolean);
    if (segments.length === 1 && segments[0] !== 'api') {
      url.pathname = `/invite/${segments[0]}`;
    }

    return NextResponse.redirect(url, 308);
  }

  return NextResponse.next();
}

export const config = {
  // Skip static assets, image optimization, and upload routes (large bodies);
  // API + pages both redirect so stale serika.cc deep links never dead-end.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icons/|api/upload).*)'],
};
