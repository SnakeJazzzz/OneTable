/**
 * lib/auth-helpers.ts — small helpers for protected route handlers (S12).
 *
 * Why: every protected route does the same 4-line dance:
 *   1. Call `await auth()`.
 *   2. If no session → return 401 with the project's standard error shape.
 *   3. Pull (userId, clientId) off the session — never from the request body.
 *   4. Proceed.
 *
 * Centralizing it makes route handlers smaller and ensures the error shape is
 * uniform across endpoints. Multi-tenancy invariant: `clientId` ALWAYS comes
 * from the session token. Never trust a clientId in a request body/query.
 */

import { auth } from '@/auth';

export type AuthedSession = {
  userId: string;
  clientId: string;
  email: string;
};

export type ApiError = {
  error: { code: string; message: string };
};

export function errorResponse(
  code: string,
  message: string,
  status: number,
): Response {
  const body: ApiError = { error: { code, message } };
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * Return `{ userId, clientId, email }` or a 401 Response.
 *
 * Usage pattern in a route handler:
 *
 *     const sessionOrError = await requireAuth();
 *     if (sessionOrError instanceof Response) return sessionOrError;
 *     const { userId, clientId } = sessionOrError;
 *
 * This avoids the temptation to write `auth()` checks inline and forget one.
 */
export async function requireAuth(): Promise<AuthedSession | Response> {
  const session = await auth();
  if (!session?.user?.id || !session.user.clientId) {
    return errorResponse('UNAUTHORIZED', 'Sign in required', 401);
  }
  return {
    userId: session.user.id,
    clientId: session.user.clientId,
    email: session.user.email,
  };
}
