/**
 * /api/portales/price-overrides — per-chain price overrides (§3.2.4, §4.3).
 *
 *   GET ?chain= → the client's FULL catalog with this chain's override merged
 *                 per product (override: null when the product has no row).
 *   PUT         → DECLARATIVE write of the full desired state for
 *                 (productId, chain). Both prices null/empty → the row is
 *                 deleted (absence = use base, §4.3); at least one value →
 *                 upsert on @@unique([productId, chain]).
 *
 * PUT body contract: { chain, productId, purchasePrice, salePrice } — ALL FOUR
 * keys must be present. A missing key is a 400 INVALID_BODY, never interpreted
 * as null: in a declarative PUT, treating absence as null turns a badly built
 * client into silent data loss (sending only purchasePrice would wipe the sale
 * override without any error). Absence = rejection, never interpretation.
 *
 * Auth: required. clientId ALWAYS comes from the session, never the body.
 * ProductPriceOverride has no clientId column — tenancy is enforced via
 * ownership of the Product (404 PRODUCT_NOT_FOUND, mappings POST precedent).
 *
 * NOTE (B-1 scope): only salePrice has a query-side consumer today
 * (SALES_AMOUNT_CASCADE in core/kpis/queries.ts). purchasePrice is stored but
 * not consumed by any query yet — stored now so the UI captures both fields.
 *
 * Decimal serialization: prices are serialized to string (never float).
 */

import { db } from '@/lib/db';
import { requireAuth, errorResponse } from '@/lib/auth-helpers';
import { parseChain } from '@/lib/portales/chains';
import { parsePriceInput } from '@/lib/prices';

// GET ?chain= → catalog + this chain's overrides in one payload (no N+1: the
// override rows arrive through the Product relation, filtered by chain).
export async function GET(req: Request): Promise<Response> {
  const s = await requireAuth();
  if (s instanceof Response) return s;
  const chain = parseChain(new URL(req.url).searchParams.get('chain'));
  if (!chain) return errorResponse('INVALID_CHAIN', 'Unknown chain', 400);

  const products = await db.product.findMany({
    where: { clientId: s.clientId },
    select: {
      id: true,
      skuCode: true,
      nameStandard: true,
      purchasePriceBase: true,
      salePriceBase: true,
      overrides: {
        where: { chain },
        select: { purchasePrice: true, salePrice: true },
      },
    },
    orderBy: { nameStandard: 'asc' },
  });

  const rows = products.map((p) => {
    // @@unique([productId, chain]) guarantees at most one row per product here.
    const o = p.overrides[0];
    return {
      productId: p.id,
      skuCode: p.skuCode,
      nameStandard: p.nameStandard,
      purchasePriceBase: p.purchasePriceBase?.toString() ?? null,
      salePriceBase: p.salePriceBase?.toString() ?? null,
      override: o
        ? {
            purchasePrice: o.purchasePrice?.toString() ?? null,
            salePrice: o.salePrice?.toString() ?? null,
          }
        : null,
    };
  });

  return Response.json({ rows });
}

// PUT { chain, productId, purchasePrice, salePrice } → declarative full-state
// write for (productId, chain). See the header comment for the key contract.
export async function PUT(req: Request): Promise<Response> {
  const s = await requireAuth();
  if (s instanceof Response) return s;

  let body: { chain?: unknown; productId?: unknown; purchasePrice?: unknown; salePrice?: unknown };
  try {
    body = await req.json();
  } catch {
    return errorResponse('INVALID_BODY', 'Body must be JSON', 400);
  }

  // req.json() resolves for ANY valid JSON — null, "str", 5, true, [] included
  // (the declared type above is a fiction over `any`). The `in` checks below
  // throw a TypeError on non-objects, so reject them here with the contract's
  // 400 instead of leaking a raw 500. Arrays are excluded explicitly: 'chain'
  // in [] is false by accident, not by contract.
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return errorResponse('INVALID_BODY', 'Body must be a JSON object', 400);
  }

  // All four keys must be explicit — absence is a client bug, not a null.
  for (const key of ['chain', 'productId', 'purchasePrice', 'salePrice'] as const) {
    if (!(key in body)) {
      return errorResponse('INVALID_BODY', `Missing key: ${key} (all four keys are required)`, 400);
    }
  }
  if (typeof body.productId !== 'string' || !body.productId) {
    return errorResponse('INVALID_BODY', 'productId must be a non-empty string', 400);
  }
  const productId = body.productId;

  const chain = parseChain(body.chain);
  if (!chain) return errorResponse('INVALID_CHAIN', 'Unknown chain', 400);

  const purchase = parsePriceInput(body.purchasePrice);
  const sale = parsePriceInput(body.salePrice);
  if (purchase.kind === 'invalid' || sale.kind === 'invalid') {
    return errorResponse(
      'INVALID_PRICE',
      'El precio debe ser un número no negativo, con máximo 2 decimales.',
      400,
    );
  }

  // Tenancy: the override table has no clientId — ownership of the Product is
  // the guard (mappings POST precedent).
  const owns = await db.product.findFirst({
    where: { id: productId, clientId: s.clientId },
    select: { id: true },
  });
  if (!owns) return errorResponse('PRODUCT_NOT_FOUND', 'SKU not in your catalog', 404);

  if (purchase.kind === 'empty' && sale.kind === 'empty') {
    // Both empty → no override row at all (§4.3: absence = use base).
    // deleteMany is idempotent when the row never existed.
    await db.productPriceOverride.deleteMany({ where: { productId, chain } });
    return Response.json({ ok: true });
  }

  const purchasePrice = purchase.kind === 'value' ? purchase.value : null;
  const salePrice = sale.kind === 'value' ? sale.value : null;
  await db.productPriceOverride.upsert({
    where: { productId_chain: { productId, chain } },
    create: { productId, chain, purchasePrice, salePrice },
    update: { purchasePrice, salePrice },
  });
  return Response.json({ ok: true });
}
