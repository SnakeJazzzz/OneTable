import { db } from '@/lib/db';
import { requireAuth, errorResponse } from '@/lib/auth-helpers';
import { assignMapping } from '@/core/normalizer/resolve';
import { parseChain } from '@/lib/portales/chains';
import type { MappingStatus } from '@prisma/client';

// GET ?chain= → existing mappings (rows per SKU, §3.2.1).
export async function GET(req: Request): Promise<Response> {
  const s = await requireAuth();
  if (s instanceof Response) return s;
  const chain = parseChain(new URL(req.url).searchParams.get('chain'));
  if (!chain) return errorResponse('INVALID_CHAIN', 'Unknown chain', 400);
  const mappings = await db.productMapping.findMany({
    where: { clientId: s.clientId, chain },
    select: { id: true, portalString: true, productId: true, status: true, product: { select: { nameStandard: true, skuCode: true } } },
    orderBy: { portalString: 'asc' },
  });
  return Response.json({ mappings });
}

// POST { chain, portalString, productId, status } → assignMapping (D1/D3).
export async function POST(req: Request): Promise<Response> {
  const s = await requireAuth();
  if (s instanceof Response) return s;
  let body: { chain?: string; portalString?: string; productId?: string; status?: string };
  try {
    body = await req.json();
  } catch {
    return errorResponse('INVALID_BODY', 'Body must be JSON', 400);
  }
  const chain = parseChain(body.chain ?? null);
  if (!chain) return errorResponse('INVALID_CHAIN', 'Unknown chain', 400);
  if (!body.portalString || !body.productId) return errorResponse('INVALID_BODY', 'portalString and productId required', 400);
  const status: Extract<MappingStatus, 'CONFIRMED' | 'PENDING_REVIEW'> =
    body.status === 'PENDING_REVIEW' ? 'PENDING_REVIEW' : 'CONFIRMED';
  // Defense: confirm the product belongs to this tenant.
  const owns = await db.product.findFirst({ where: { id: body.productId, clientId: s.clientId }, select: { id: true } });
  if (!owns) return errorResponse('PRODUCT_NOT_FOUND', 'SKU not in your catalog', 404);

  const result = await assignMapping(db, { clientId: s.clientId, chain, portalString: body.portalString, productId: body.productId, status });
  // FIX-1: refuse mapping onto an unresolved conflict with a clear 409.
  if (result.kind === 'conflict_exists') {
    return errorResponse('CONFLICT_EXISTS', 'Ese portal string está en conflicto. Resolvé el conflicto antes de mapearlo.', 409);
  }
  return Response.json({ result });
}
