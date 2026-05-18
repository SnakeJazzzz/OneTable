/**
 * next-auth.d.ts — Module augmentation for NextAuth v5 types.
 *
 * Adds:
 *   - `Session.user.id` and `Session.user.clientId` (required in route handlers)
 *   - `User.clientId` (set by the Credentials provider's `authorize()`)
 *   - `JWT.id` and `JWT.clientId` (persisted between requests)
 *
 * Without this file, `session.user.clientId` and `(user as any).clientId`
 * cast everywhere. With it, the auth.ts callbacks and route handlers compile
 * with no `any`. tsconfig already globs `**\/*.ts`, so this file is picked up
 * automatically.
 */

import 'next-auth';
import 'next-auth/jwt';

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      email: string;
      name?: string;
      clientId: string;
    };
  }

  // Augment the User returned by `authorize()` so its return shape is typed.
  interface User {
    clientId?: string;
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id?: string;
    clientId?: string;
  }
}
