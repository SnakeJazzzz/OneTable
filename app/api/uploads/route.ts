/**
 * GET /api/uploads — list previous uploads for the authenticated client.
 *
 * Powers the /analisis page's "uploads recientes" section and lets the page
 * detect whether THIS is the user's first successful upload (so the post-
 * success redirect to /dashboard only fires once).
 *
 * Auth: required. clientId + userId from the JWT, double-belt WHERE.
 *
 * Response: { uploads: Array<{
 *   id, chain, fileType, status, originalFilename,
 *   rowsTotal, rowsInserted, rowsUpdated, rowsUnmapped,
 *   uploadedAt, processedAt
 * }> }
 */

import { db } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';

export async function GET(): Promise<Response> {
  const sessionOrError = await requireAuth();
  if (sessionOrError instanceof Response) return sessionOrError;
  const { clientId, userId } = sessionOrError;

  const uploads = await db.upload.findMany({
    where: { clientId, userId },
    orderBy: { uploadedAt: 'desc' },
    select: {
      id: true,
      chain: true,
      fileType: true,
      status: true,
      originalFilename: true,
      rowsTotal: true,
      rowsInserted: true,
      rowsUpdated: true,
      rowsUnmapped: true,
      uploadedAt: true,
      processedAt: true,
    },
  });

  return Response.json({ uploads });
}
