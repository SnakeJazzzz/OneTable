import { db } from '@/lib/db';
import { requireAuth, errorResponse } from '@/lib/auth-helpers';
import { withRouteErrors } from '@/lib/route-errors';
import { assignMapping, deleteMapping, retargetMapping } from '@/core/normalizer/resolve';
import { ServiceError } from '@/core/normalizer/errors';
import { parseChain } from '@/lib/portales/chains';
import type { MappingStatus } from '@prisma/client';

// GET ?chain= → existing mappings (rows per SKU, §3.2.1).
async function handleGet(req: Request): Promise<Response> {
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
async function handlePost(req: Request): Promise<Response> {
  const s = await requireAuth();
  if (s instanceof Response) return s;
  let body: { chain?: string; portalString?: string; productId?: string; status?: string };
  try {
    body = await req.json();
  } catch {
    return errorResponse('INVALID_BODY', 'Body must be JSON', 400);
  }
  // req.json() resolves for ANY valid JSON (null, "str", 5, [] included);
  // property access on a non-object would TypeError → raw 500. Same guard as
  // price-overrides PUT (T4 §4.5).
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return errorResponse('INVALID_BODY', 'Body must be a JSON object', 400);
  }
  const chain = parseChain(body.chain ?? null);
  if (!chain) return errorResponse('INVALID_CHAIN', 'Unknown chain', 400);
  if (!body.portalString || !body.productId) return errorResponse('INVALID_BODY', 'portalString and productId required', 400);
  const status: Extract<MappingStatus, 'CONFIRMED' | 'PENDING_REVIEW'> =
    body.status === 'PENDING_REVIEW' ? 'PENDING_REVIEW' : 'CONFIRMED';
  // Defense: confirm the product belongs to this tenant.
  const owns = await db.product.findFirst({ where: { id: body.productId, clientId: s.clientId }, select: { id: true } });
  if (!owns) return errorResponse('PRODUCT_NOT_FOUND', 'Ese SKU no existe en tu catálogo.', 404);

  const result = await assignMapping(db, { clientId: s.clientId, chain, portalString: body.portalString, productId: body.productId, status });
  // FIX-1: refuse mapping onto an unresolved conflict with a clear 409.
  if (result.kind === 'conflict_exists') {
    return errorResponse('CONFLICT_EXISTS', 'Ese portal string está en conflicto. Resuelve el conflicto antes de mapearlo.', 409);
  }
  return Response.json({ result });
}

// DELETE { chain, portalString, productId } → deleteMapping (§11.5a revert).
// Reverts the SelloutData backfill, removes the mapping, re-queues the string.
async function handleDelete(req: Request): Promise<Response> {
  const s = await requireAuth();
  if (s instanceof Response) return s;
  let body: { chain?: string; portalString?: string; productId?: string };
  try {
    body = await req.json();
  } catch {
    return errorResponse('INVALID_BODY', 'Body must be JSON', 400);
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return errorResponse('INVALID_BODY', 'Body must be a JSON object', 400);
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
    // Typed branch (T4 §4.3/E1) — same status/copy as the pre-T4 substring
    // matching. Codes without a mapping here (defense-in-depth family) fall
    // through to the rethrow.
    if (e instanceof ServiceError) {
      switch (e.code) {
        case 'MAPPING_CONFLICTED':
          return errorResponse('CONFLICTED', 'Ese mapeo está en conflicto; resuélvelo desde la sección de conflictos.', 409);
        case 'MAPPING_NOT_FOUND':
          return errorResponse('MAPPING_NOT_FOUND', 'No existe ese mapeo.', 404);
      }
    }
    throw e; // non-ServiceError (and unmapped codes) go up to withRouteErrors: 500 JSON + log
  }
  return Response.json({ ok: true });
}

// PATCH { chain, portalString, oldProductId, newProductId } → retargetMapping (§11.6a).
// Re-points a mapped string to a different SKU in ONE step (revert + update-in-place
// + backfill, all inside the service transaction). Thin route: every guard lives in
// the service; here we only parse, auth-scope, and map ServiceError codes → status codes.
async function handlePatch(req: Request): Promise<Response> {
  const s = await requireAuth();
  if (s instanceof Response) return s;
  let body: { chain?: string; portalString?: string; oldProductId?: string; newProductId?: string };
  try {
    body = await req.json();
  } catch {
    return errorResponse('INVALID_BODY', 'Body must be JSON', 400);
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return errorResponse('INVALID_BODY', 'Body must be a JSON object', 400);
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
    // Typed branch (T4 §4.3/E1) — same status/copy as the pre-T4 substring
    // matching.
    if (e instanceof ServiceError) {
      switch (e.code) {
        case 'MAPPING_CONFLICTED':
          return errorResponse('CONFLICTED', 'Ese mapeo está en conflicto; resuélvelo desde la sección de conflictos.', 409);
        case 'MAPPING_NOT_FOUND':
          return errorResponse('MAPPING_NOT_FOUND', 'No existe ese mapeo.', 404);
        case 'NOOP_RETARGET':
          return errorResponse('NOOP_RETARGET', 'El SKU nuevo es igual al actual.', 409);
        case 'PRODUCT_NOT_FOUND':
          return errorResponse('PRODUCT_NOT_FOUND', 'Ese SKU no existe en tu catálogo.', 404);
      }
    }
    throw e; // non-ServiceError (and unmapped codes) go up to withRouteErrors: 500 JSON + log
  }
  return Response.json({ ok: true });
}

export const GET = withRouteErrors('portales/mappings', handleGet);
export const POST = withRouteErrors('portales/mappings', handlePost);
export const DELETE = withRouteErrors('portales/mappings', handleDelete);
export const PATCH = withRouteErrors('portales/mappings', handlePatch);
