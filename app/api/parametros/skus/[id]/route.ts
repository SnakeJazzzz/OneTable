/**
 * /api/parametros/skus/[id] — edit + delete a single canonical SKU (Product).
 *
 *   PATCH  → edit name / prices, and support an atomic skuCode rename.
 *   DELETE → remove the Product (schema cascade clears its mappings, overrides,
 *            and SelloutData).
 *
 * Auth: required. Every `where` is scoped to `{ id, clientId }` so a tenant can
 * never read or mutate another client's Product row.
 *
 * §10.4: a skuCode rename is a UI/UPDATE op that preserves FKs (it is NOT the
 * Excel import path, which matches/creates by code). Renames flow through PATCH.
 *
 * Decimal serialization: prices are serialized to string (never float).
 */

import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { requireAuth, errorResponse } from '@/lib/auth-helpers';

type PatchSkuBody = {
  nameStandard?: unknown;
  skuCode?: unknown;
  purchasePriceBase?: unknown;
  salePriceBase?: unknown;
};

// Tri-state price parse: omitted key vs explicit null/empty vs value vs invalid.
// On PATCH an explicit empty string / null clears the price; an omitted key
// leaves it unchanged.
type PriceResult =
  | { kind: 'absent' } // key not present in body → leave column unchanged
  | { kind: 'clear' } // explicit null/empty → write null
  | { kind: 'value'; value: string }
  | { kind: 'invalid' };

function parsePatchPrice(present: boolean, raw: unknown): PriceResult {
  if (!present) return { kind: 'absent' };
  if (raw === null || raw === undefined || raw === '') return { kind: 'clear' };
  const s = String(raw).trim();
  if (s === '') return { kind: 'clear' };
  if (!/^\d+(\.\d+)?$/.test(s)) return { kind: 'invalid' };
  return { kind: 'value', value: s };
}

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  const sessionOrError = await requireAuth();
  if (sessionOrError instanceof Response) return sessionOrError;
  const { clientId } = sessionOrError;

  let body: PatchSkuBody;
  try {
    body = (await req.json()) as PatchSkuBody;
  } catch {
    return errorResponse('INVALID_BODY', 'Body must be JSON', 400);
  }

  const data: Prisma.ProductUpdateInput = {};

  if ('nameStandard' in body) {
    const nameStandard = typeof body.nameStandard === 'string' ? body.nameStandard.trim() : '';
    if (!nameStandard) {
      return errorResponse('INVALID_NAME', 'El nombre del producto es obligatorio.', 400);
    }
    data.nameStandard = nameStandard;
  }

  if ('skuCode' in body) {
    const skuCode = typeof body.skuCode === 'string' ? body.skuCode.trim() : '';
    if (!skuCode) {
      return errorResponse('INVALID_SKU_CODE', 'El código no puede estar vacío.', 400);
    }
    data.skuCode = skuCode;
  }

  const purchase = parsePatchPrice('purchasePriceBase' in body, body.purchasePriceBase);
  const sale = parsePatchPrice('salePriceBase' in body, body.salePriceBase);
  if (purchase.kind === 'invalid' || sale.kind === 'invalid') {
    return errorResponse(
      'INVALID_PRICE',
      'Los precios deben ser números decimales no negativos.',
      400,
    );
  }
  if (purchase.kind === 'value') data.purchasePriceBase = purchase.value;
  if (purchase.kind === 'clear') data.purchasePriceBase = null;
  if (sale.kind === 'value') data.salePriceBase = sale.value;
  if (sale.kind === 'clear') data.salePriceBase = null;

  if (Object.keys(data).length === 0) {
    return errorResponse('NO_FIELDS', 'No hay campos para actualizar.', 400);
  }

  try {
    // Scope to { id, clientId } via updateMany so a tenant can't touch another's
    // row. updateMany returns a count rather than throwing P2025 when the row is
    // absent (or belongs to another client), which lets us 404 cleanly.
    const res = await db.product.updateMany({
      where: { id: params.id, clientId },
      data,
    });
    if (res.count === 0) {
      return errorResponse('NOT_FOUND', 'SKU no encontrado.', 404);
    }

    const updated = await db.product.findFirst({
      where: { id: params.id, clientId },
      select: {
        id: true,
        skuCode: true,
        nameStandard: true,
        purchasePriceBase: true,
        salePriceBase: true,
      },
    });
    return Response.json({
      sku: updated && {
        id: updated.id,
        skuCode: updated.skuCode,
        nameStandard: updated.nameStandard,
        purchasePriceBase: updated.purchasePriceBase?.toString() ?? null,
        salePriceBase: updated.salePriceBase?.toString() ?? null,
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return errorResponse('SKU_CODE_TAKEN', 'Ese código ya existe.', 409);
    }
    console.error('[parametros/skus/[id]] unexpected error:', err);
    return errorResponse('INTERNAL_ERROR', 'Error al actualizar el SKU.', 500);
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } },
): Promise<Response> {
  const sessionOrError = await requireAuth();
  if (sessionOrError instanceof Response) return sessionOrError;
  const { clientId } = sessionOrError;

  // deleteMany scoped to { id, clientId } — cascades clear mappings/overrides/
  // sellout per schema. A 0 count means not-found or another tenant's row.
  const res = await db.product.deleteMany({ where: { id: params.id, clientId } });
  if (res.count === 0) {
    return errorResponse('NOT_FOUND', 'SKU no encontrado.', 404);
  }
  return Response.json({ ok: true });
}
