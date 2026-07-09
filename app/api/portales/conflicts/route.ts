import { db } from '@/lib/db';
import { requireAuth, errorResponse } from '@/lib/auth-helpers';
import { resolveConflict } from '@/core/normalizer/resolve';
import { parseChain } from '@/lib/portales/chains';

// GET ?chain= → conflicts grouped by portalString with candidate SKUs (§8.5).
export async function GET(req: Request): Promise<Response> {
  const s = await requireAuth();
  if (s instanceof Response) return s;
  const chain = parseChain(new URL(req.url).searchParams.get('chain'));
  if (!chain) return errorResponse('INVALID_CHAIN', 'Unknown chain', 400);
  const rows = await db.productMapping.findMany({
    where: { clientId: s.clientId, chain, status: 'CONFLICTED' },
    select: { portalString: true, productId: true, product: { select: { nameStandard: true, skuCode: true } } },
    orderBy: { portalString: 'asc' },
  });
  const grouped = new Map<string, { productId: string; nameStandard: string; skuCode: string }[]>();
  for (const r of rows) {
    const list = grouped.get(r.portalString) ?? [];
    list.push({ productId: r.productId, nameStandard: r.product.nameStandard, skuCode: r.product.skuCode });
    grouped.set(r.portalString, list);
  }
  return Response.json({ conflicts: [...grouped.entries()].map(([portalString, candidates]) => ({ portalString, candidates })) });
}

// POST { chain, portalString, winnerProductId|null, firstSeenUploadId? } → resolveConflict.
export async function POST(req: Request): Promise<Response> {
  const s = await requireAuth();
  if (s instanceof Response) return s;
  let body: { chain?: string; portalString?: string; winnerProductId?: string | null; firstSeenUploadId?: string };
  try {
    body = await req.json();
  } catch {
    return errorResponse('INVALID_BODY', 'Body must be JSON', 400);
  }
  const chain = parseChain(body.chain ?? null);
  if (!chain) return errorResponse('INVALID_CHAIN', 'Unknown chain', 400);
  if (!body.portalString) return errorResponse('INVALID_BODY', 'portalString required', 400);
  // "Es éste": the winner must be one of the conflict's candidates. Anticipate the
  // service guard (resolveConflict throws on a non-candidate winner — Task 3 #1)
  // with a handled 409 instead of letting it surface as a raw 500. The service
  // guard stays as defense-in-depth; this is the route-level pre-check.
  if (body.winnerProductId) {
    const isCandidate = await db.productMapping.findFirst({
      where: { clientId: s.clientId, chain, portalString: body.portalString, productId: body.winnerProductId, status: 'CONFLICTED' },
      select: { id: true },
    });
    if (!isCandidate) {
      return errorResponse('INVALID_WINNER', 'El SKU ganador no es un candidato de este conflicto.', 409);
    }
  }
  // "Ninguno" needs an upload id to re-queue; derive the most recent one for this chain.
  let firstSeenUploadId = body.firstSeenUploadId;
  if (!body.winnerProductId && !firstSeenUploadId) {
    const up = await db.upload.findFirst({ where: { clientId: s.clientId, chain }, orderBy: { uploadedAt: 'desc' }, select: { id: true } });
    firstSeenUploadId = up?.id;
    // FIX-5: without an upload there is nothing to anchor the re-queued
    // UnmappedProduct to — return a clean 4xx instead of letting resolveConflict
    // throw (which would surface as a raw 500).
    if (!firstSeenUploadId) {
      return errorResponse('NO_UPLOAD', 'No hay archivos cargados para esta cadena; no se puede devolver el string a "sin mapear".', 409);
    }
  }
  await resolveConflict(db, { clientId: s.clientId, chain, portalString: body.portalString, winnerProductId: body.winnerProductId ?? null, firstSeenUploadId });
  return Response.json({ ok: true });
}
