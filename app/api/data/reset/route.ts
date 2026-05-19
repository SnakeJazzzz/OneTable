/**
 * POST /api/data/reset — wipe of SelloutData + UnmappedProduct + Upload for
 * the authenticated user's client. Preserves User, Client, Product (catalog),
 * ProductMapping, and PortalCredential — so the user can re-upload immediately
 * with the same mappings.
 *
 * Tenancy: double-belt filter (clientId + userId) on every deleteMany to
 * defend against a stale JWT whose clientId no longer belongs to its user.
 * UnmappedProduct schema has no userId column (only clientId), so the
 * double-belt for that table reduces to clientId.
 *
 * Deletion order matters for accurate counts:
 *   1. SelloutData first — its FK to Upload is onDelete: SetNull, so SelloutData
 *      rows are NOT cascaded when Upload deletes. We need an explicit deleteMany.
 *   2. UnmappedProduct second — its FK to Upload is onDelete: Cascade, so if
 *      we deleted Upload first, UnmappedProduct rows would be gone and the
 *      count would always be 0. Doing it before Upload keeps the count honest.
 *   3. Upload last — at this point its referenced UnmappedProduct rows are
 *      already deleted, so Upload deletion does not trigger cascades.
 *
 * All three deletes run inside `db.$transaction` so a mid-stream failure
 * leaves the row counts consistent.
 *
 * Auth: required. 401 if no session.
 */

import { db } from '@/lib/db';
import { requireAuth, errorResponse } from '@/lib/auth-helpers';

export async function POST(): Promise<Response> {
  const sessionOrError = await requireAuth();
  if (sessionOrError instanceof Response) return sessionOrError;
  const { clientId, userId } = sessionOrError;

  try {
    const result = await db.$transaction(async (tx) => {
      const sellout = await tx.selloutData.deleteMany({
        where: { clientId, userId },
      });
      const unmapped = await tx.unmappedProduct.deleteMany({
        where: { clientId },
      });
      const uploads = await tx.upload.deleteMany({
        where: { clientId, userId },
      });
      return {
        selloutRowsDeleted: sellout.count,
        unmappedDeleted: unmapped.count,
        uploadsDeleted: uploads.count,
      };
    });

    return Response.json(result);
  } catch (err) {
    console.error('[data-reset] failed:', err);
    return errorResponse('INTERNAL_ERROR', 'Error al borrar datos', 500);
  }
}
