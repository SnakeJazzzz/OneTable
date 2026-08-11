/**
 * auth.ts — NextAuth v5 configuration (S12).
 *
 * Convention: NextAuth v5 places the config at the project root (`auth.ts`)
 * and re-exports `handlers` from `app/api/auth/[...nextauth]/route.ts`. The
 * `auth()` helper returned here works in:
 *   - Server Components
 *   - Route Handlers (`app/api/*\/route.ts`)
 *   - Server Actions
 *   - Middleware (via `auth((req) => ...)` wrapper — see G1's middleware.ts)
 *
 * Session strategy = JWT (no DB sessions). Multi-tenancy is enforced by
 * embedding `clientId` directly in the JWT payload at sign-in. Route handlers
 * read `session.user.clientId` and feed it into KPI/normalizer queries; the
 * frontend NEVER passes clientId in request bodies.
 *
 * Fase 1 assumption: each User has exactly 1 Client (`User.clients[0]`).
 * Multi-client support is Fase 2 work; when introduced, the JWT will carry a
 * list and the route handlers will require a `?clientId=` query param scoped
 * against that list.
 *
 * Required env: AUTH_SECRET (32-byte random base64). NextAuth v5 throws at
 * runtime if absent. Tests set this in `tests/setup.ts` before NextAuth loads.
 *
 * (@auth/prisma-adapter, unused since Fase 1 — JWT strategy needs no
 * adapter — was removed from package.json in hardening T2 Tanda B.)
 */

import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { compare } from 'bcryptjs';
import { db } from './lib/db';
import {
  peekRateLimit,
  recordFailure,
  AUTH_WINDOW_MS,
  LOGIN_EMAIL_LIMIT,
  AUTH_IP_LIMIT,
} from './lib/rate-limit';

// Precomputed bcrypt hash (rounds 10 — same cost as real user hashes) of a
// throwaway string. When the email does not exist, or the user has no
// clients, authorize() still runs ONE bcrypt compare against this constant
// before returning null. Without it, "email not registered" returns ~100x
// faster than "wrong password", letting an attacker enumerate registered
// emails by timing (hardening T2, §2.6). The compare result is discarded
// on purpose — it can never be true for a real password.
const DUMMY_BCRYPT_HASH =
  '$2a$10$3SCDERLz3k3giI9UDMWCFO.koM.oPC3OtUtJ21NeK7TIdUuROLk3C';

// Login rate limit scopes (hardening T2 §5.3). Pinned policy: 5 failures /
// 15 min per email PLUS 20 failures / 15 min per IP — limits and window are
// shared constants in lib/rate-limit.ts so signup stays in lockstep.
const LOGIN_EMAIL_SCOPE = 'login:email';
const LOGIN_IP_SCOPE = 'login:ip';

// Record a credential FAILURE in both scopes. Success neither increments
// nor resets anything (fixed-window simple). Overshoot race accepted (§5.3):
// two concurrent attempts can both pass the peek below and both record the
// failure, so the counter may exceed the limit by a handful — harmless, the
// window just closes marginally tighter. recordFailure is fail-open inside.
async function recordLoginFailure(email: string, ip: string): Promise<void> {
  await Promise.all([
    recordFailure({ scope: LOGIN_EMAIL_SCOPE, key: email, windowMs: AUTH_WINDOW_MS }),
    recordFailure({ scope: LOGIN_IP_SCOPE, key: ip, windowMs: AUTH_WINDOW_MS }),
  ]);
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  // maxAge: 24h ROLLING idle window, not an absolute lifetime. Under
  // strategy 'jwt' the JWT is re-signed with exp = now + maxAge on every
  // session read, so a cookie used at least once a day never expires; only
  // 24h of full inactivity ends the session. Semantics verified against the
  // installed source of @auth/core@0.41.3.
  session: { strategy: 'jwt', maxAge: 86400 },
  secret: process.env.AUTH_SECRET,
  trustHost: true, // required for AUTH_URL inference in Vercel previews / dev
  pages: { signIn: '/login' }, // G1 owns the /login page
  providers: [
    Credentials({
      // Custom shape; the actual form UI lives in G1.
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      // Signature `authorize(credentials, request)` verified empirically on
      // the installed next-auth 5.0.0-beta.32 → @auth/core@0.41.3: the
      // callback action destructures the original headers and calls
      // `provider.authorize(credentials, new Request(url, { headers, ... }))`
      // (lib/actions/callback/index.js:12,231-233), so `request` carries the
      // original x-forwarded-for.
      async authorize(creds, request) {
        if (!creds?.email || !creds?.password) return null;
        const email = String(creds.email).trim().toLowerCase();
        const password = String(creds.password);

        // Client IP = first hop of x-forwarded-for (Vercel sets it; the
        // first entry is the client). Outside Vercel (tests call authorize()
        // directly without a request; local direct hits may lack the header)
        // fall back to a shared 'unknown' bucket instead of skipping the
        // check — skipping would let a stripped header bypass the IP limit.
        const ip =
          request?.headers?.get('x-forwarded-for')?.split(',')[0]?.trim() ||
          'unknown';

        // Rate limit peek BEFORE the user lookup and any bcrypt work (§5.3).
        // A limited attempt returns the SAME generic null as bad credentials
        // — accepted anti-oracle trade-off (§2.7): a distinct "rate limited"
        // response would leak which emails are registered / under attack.
        // peekRateLimit is fail-open: a limiter DB error never 500s login.
        const [byEmail, byIp] = await Promise.all([
          peekRateLimit({
            scope: LOGIN_EMAIL_SCOPE,
            key: email,
            limit: LOGIN_EMAIL_LIMIT,
            windowMs: AUTH_WINDOW_MS,
          }),
          peekRateLimit({
            scope: LOGIN_IP_SCOPE,
            key: ip,
            limit: AUTH_IP_LIMIT,
            windowMs: AUTH_WINDOW_MS,
          }),
        ]);
        if (!byEmail.allowed || !byIp.allowed) return null;

        // Look up user + first client in one query. F1 assumes 1:1 user→client.
        const user = await db.user.findUnique({
          where: { email },
          include: { clients: { take: 1, orderBy: { createdAt: 'asc' } } },
        });
        if (!user || user.clients.length === 0) {
          // Timing equalizer — see DUMMY_BCRYPT_HASH above.
          await compare(password, DUMMY_BCRYPT_HASH);
          await recordLoginFailure(email, ip);
          return null;
        }

        const ok = await compare(password, user.passwordHash);
        if (!ok) {
          await recordLoginFailure(email, ip);
          return null;
        }

        // NEVER include passwordHash in the returned object — it would flow
        // into the JWT and then the session response on every request.
        return {
          id: user.id,
          email: user.email,
          name: user.name ?? undefined,
          clientId: user.clients[0].id,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      // `user` is only defined on the sign-in tick. Persist id + clientId
      // so subsequent requests can read them without another DB hit.
      if (user) {
        token.id = user.id;
        token.clientId = user.clientId;
      }
      return token;
    },
    async session({ session, token }) {
      // Mirror token → session.user. The next-auth.d.ts module augmentation
      // makes these typed without `as any` at call sites.
      if (token && session.user) {
        if (token.id) session.user.id = token.id;
        if (token.clientId) session.user.clientId = token.clientId;
      }
      return session;
    },
  },
});
