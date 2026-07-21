import { auth } from '@/auth';
import { NextResponse } from 'next/server';

const PROTECTED_PREFIXES = [
  '/dashboard',
  '/analisis',
  '/portales',
  '/parametros',
  '/promotoria',
];

export default auth((req) => {
  const { nextUrl } = req;
  const path = nextUrl.pathname;
  const isProtected = PROTECTED_PREFIXES.some(
    (p) => path === p || path.startsWith(`${p}/`),
  );

  if (isProtected && !req.auth) {
    const loginUrl = new URL('/login', nextUrl);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
});

export const config = {
  // api/health is excluded so the external uptime monitor's pings skip the
  // auth() wrapper entirely (the route is public by design and each ping
  // would otherwise pay the session-decode cost — hardening T1).
  matcher: ['/((?!api/auth|api/health|_next/static|_next/image|favicon.ico).*)'],
};
