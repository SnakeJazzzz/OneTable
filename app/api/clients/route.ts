/**
 * GET /api/clients — return the authenticated user's single client (F1).
 *
 * Fase 1 multi-tenancy is 1 user → 1 client. The dashboard header reads this
 * to show the client name. Fase 2 will turn the response into an array.
 *
 * Auth: required. 401 if no session. clientId taken from the JWT, never from
 * a query param.
 */

import { db } from '@/lib/db';
import { requireAuth, errorResponse } from '@/lib/auth-helpers';

export async function GET(): Promise<Response> {
  const sessionOrError = await requireAuth();
  if (sessionOrError instanceof Response) return sessionOrError;
  const { clientId, userId } = sessionOrError;

  // Double-belt tenant check: clientId comes from JWT, but we re-verify the
  // (clientId, userId) ownership against the DB to defend against a stale
  // token whose clientId no longer belongs to the user (e.g. deletion).
  const client = await db.client.findFirst({
    where: { id: clientId, userId },
    select: { id: true, name: true, email: true, createdAt: true },
  });
  if (!client) {
    return errorResponse('CLIENT_NOT_FOUND', 'Authenticated client not found', 404);
  }

  return Response.json(client);
}
