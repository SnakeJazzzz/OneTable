import { db } from '@/lib/db';
import { requireAuth, errorResponse } from '@/lib/auth-helpers';
import { parseChain } from '@/lib/portales/chains';

// GET ?chain= → { unmappedCount, pendingReviewCount, conflictCount } for one card.
export async function GET(req: Request): Promise<Response> {
  const s = await requireAuth();
  if (s instanceof Response) return s;
  const chain = parseChain(new URL(req.url).searchParams.get('chain'));
  if (!chain) return errorResponse('INVALID_CHAIN', 'Unknown chain', 400);
  const [unmappedCount, pendingReviewCount, conflictRows] = await Promise.all([
    db.unmappedProduct.count({ where: { clientId: s.clientId, chain, resolvedAt: null } }),
    db.productMapping.count({ where: { clientId: s.clientId, chain, status: 'PENDING_REVIEW' } }),
    db.productMapping.findMany({ where: { clientId: s.clientId, chain, status: 'CONFLICTED' }, select: { portalString: true }, distinct: ['portalString'] }),
  ]);
  return Response.json({ unmappedCount, pendingReviewCount, conflictCount: conflictRows.length });
}
