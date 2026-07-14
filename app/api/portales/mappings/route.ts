import { db } from '@/lib/db';
import { requireAuth, errorResponse } from '@/lib/auth-helpers';
import { assignMapping, deleteMapping, retargetMapping } from '@/core/normalizer/resolve';
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

// DELETE { chain, portalString, productId } → deleteMapping (§11.5a revert).
// Reverts the SelloutData backfill, removes the mapping, re-queues the string.
export async function DELETE(req: Request): Promise<Response> {
  const s = await requireAuth();
  if (s instanceof Response) return s;
  let body: { chain?: string; portalString?: string; productId?: string };
  try {
    body = await req.json();
  } catch {
    return errorResponse('INVALID_BODY', 'Body must be JSON', 400);
  }
  const chain = parseChain(body.chain ?? null);
  if (!chain) return errorResponse('INVALID_CHAIN', 'Unknown chain', 400);
  if (!body.portalString || !body.productId) return errorResponse('INVALID_BODY', 'portalString and productId required', 400);

  // Route-policy: derive the most recent upload to re-anchor the re-queued
  // UnmappedProduct (mirrors conflicts/route.ts). No upload → nothing to anchor:
  // return a clean 409 BEFORE calling the service.
  const up = await db.upload.findFirst({ where: { clientId: s.clientId, chain }, orderBy: { uploadedAt: 'desc' }, select: { id: true } });
  if (!up?.id) {
    return errorResponse('NO_UPLOAD', 'No hay archivos cargados para esta cadena; no se puede devolver el string a "sin mapear".', 409);
  }

  try {
    await deleteMapping(db, { clientId: s.clientId, chain, portalString: body.portalString, productId: body.productId, firstSeenUploadId: up.id });
  } catch (e) {
    const msg = e instanceof Error ? e.message : '';
    if (msg.includes('CONFLICTED')) {
      return errorResponse('CONFLICTED', 'Ese mapeo está en conflicto; resolvelo desde la sección de conflictos.', 409);
    }
    if (msg.includes('not found')) {
      return errorResponse('MAPPING_NOT_FOUND', 'No existe ese mapeo.', 404);
    }
    throw e;
  }
  return Response.json({ ok: true });
}

// PATCH { chain, portalString, oldProductId, newProductId } → retargetMapping (§11.6a).
// Re-points a mapped string to a different SKU in ONE step (revert + update-in-place
// + backfill, all inside the service transaction). Thin route: every guard lives in
// the service; here we only parse, auth-scope, and map throws → status codes.
export async function PATCH(req: Request): Promise<Response> {
  const s = await requireAuth();
  if (s instanceof Response) return s;
  let body: { chain?: string; portalString?: string; oldProductId?: string; newProductId?: string };
  try {
    body = await req.json();
  } catch {
    return errorResponse('INVALID_BODY', 'Body must be JSON', 400);
  }
  const chain = parseChain(body.chain ?? null);
  if (!chain) return errorResponse('INVALID_CHAIN', 'Unknown chain', 400);
  if (!body.portalString || !body.oldProductId || !body.newProductId) {
    return errorResponse('INVALID_BODY', 'portalString, oldProductId and newProductId required', 400);
  }

  try {
    await retargetMapping(db, {
      clientId: s.clientId,
      chain,
      portalString: body.portalString,
      oldProductId: body.oldProductId,
      newProductId: body.newProductId,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : '';
    if (msg.includes('CONFLICTED')) {
      return errorResponse('CONFLICTED', 'Ese mapeo está en conflicto; resolvelo desde la sección de conflictos.', 409);
    }
    if (msg.includes('not found')) {
      return errorResponse('MAPPING_NOT_FOUND', 'No existe ese mapeo.', 404);
    }
    if (msg.includes('equals oldProductId')) {
      return errorResponse('NOOP_RETARGET', 'El SKU nuevo es igual al actual.', 409);
    }
    if (msg.includes('does not exist or does not belong')) {
      return errorResponse('PRODUCT_NOT_FOUND', 'Ese SKU no existe en tu catálogo.', 404);
    }
    throw e;
  }
  return Response.json({ ok: true });
}
