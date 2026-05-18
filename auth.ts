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
 * Note on @auth/prisma-adapter: present in package.json but UNUSED in Fase 1
 * (JWT strategy needs no adapter). Removal is a Fase 2 cleanup item.
 */

import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { compare } from 'bcryptjs';
import { db } from './lib/db';

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: 'jwt' },
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
      async authorize(creds) {
        if (!creds?.email || !creds?.password) return null;
        const email = String(creds.email).trim().toLowerCase();
        const password = String(creds.password);

        // Look up user + first client in one query. F1 assumes 1:1 user→client.
        const user = await db.user.findUnique({
          where: { email },
          include: { clients: { take: 1, orderBy: { createdAt: 'asc' } } },
        });
        if (!user || user.clients.length === 0) return null;

        const ok = await compare(password, user.passwordHash);
        if (!ok) return null;

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
