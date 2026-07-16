/**
 * /api/parametros/skus — list + create the client's canonical SKUs (Products).
 *
 *   GET  → list this client's Products (id, skuCode, nameStandard, prices).
 *   POST → create a Product. `skuCode` defaults to a generated cuid when absent.
 *
 * Auth: required. clientId comes from the session token, never the body/query.
 *
 * DEVIATION #1 (vs spec §1): these routes resolve `clientId` via `requireAuth()`
 * — NOT a `getCurrentClient(userId)` helper. The session JWT already carries the
 * resolved clientId (NextAuth populates it at sign-in, enforcing the 1-Client
 * invariant there), so re-resolving per request would be a redundant DB hit with
 * no added safety. This is intentional, not an oversight of §1's prescription.
 *
 * Decimal serialization: `purchasePriceBase`/`salePriceBase` are Prisma Decimal
 * and are serialized to string (never Number/float) so precision is preserved.
 */

import { Prisma } from '@prisma/client';
import { db } from '@/lib/db';
import { requireAuth, errorResponse } from '@/lib/auth-helpers';
import { makeCuid } from '@/core/ids';
import { parsePriceInput } from '@/lib/prices';

type CreateSkuBody = {
  nameStandard?: unknown;
  skuCode?: unknown;
  purchasePriceBase?: unknown;
  salePriceBase?: unknown;
};

// Route-local semantics over the shared parser (lib/prices.ts): on create, an
// empty input means "don't write the column" (omit).
type PriceResult =
  | { kind: 'omit' } // absent/empty → don't write the column
  | { kind: 'value'; value: string }
  | { kind: 'invalid' };

function parseOptionalPrice(raw: unknown): PriceResult {
  const parsed = parsePriceInput(raw);
  return parsed.kind === 'empty' ? { kind: 'omit' } : parsed;
}

export async function GET(): Promise<Response> {
  const sessionOrError = await requireAuth();
  if (sessionOrError instanceof Response) return sessionOrError;
  const { clientId } = sessionOrError;

  const products = await db.product.findMany({
    where: { clientId },
    select: {
      id: true,
      skuCode: true,
      nameStandard: true,
      purchasePriceBase: true,
      salePriceBase: true,
    },
    orderBy: { nameStandard: 'asc' },
  });

  const skus = products.map((p) => ({
    id: p.id,
    skuCode: p.skuCode,
    nameStandard: p.nameStandard,
    purchasePriceBase: p.purchasePriceBase?.toString() ?? null,
    salePriceBase: p.salePriceBase?.toString() ?? null,
  }));

  return Response.json({ skus });
}

export async function POST(req: Request): Promise<Response> {
  const sessionOrError = await requireAuth();
  if (sessionOrError instanceof Response) return sessionOrError;
  const { clientId } = sessionOrError;

  let body: CreateSkuBody;
  try {
    body = (await req.json()) as CreateSkuBody;
  } catch {
    return errorResponse('INVALID_BODY', 'Body must be JSON', 400);
  }

  const nameStandard = typeof body.nameStandard === 'string' ? body.nameStandard.trim() : '';
  if (!nameStandard) {
    return errorResponse('INVALID_NAME', 'El nombre del producto es obligatorio.', 400);
  }

  const skuCodeRaw = typeof body.skuCode === 'string' ? body.skuCode.trim() : '';
  const skuCode = skuCodeRaw || makeCuid();

  const purchase = parseOptionalPrice(body.purchasePriceBase);
  const sale = parseOptionalPrice(body.salePriceBase);
  if (purchase.kind === 'invalid' || sale.kind === 'invalid') {
    return errorResponse(
      'INVALID_PRICE',
      'El precio debe ser un número no negativo, con máximo 2 decimales.',
      400,
    );
  }

  const data: Prisma.ProductCreateInput = {
    client: { connect: { id: clientId } },
    skuCode,
    nameStandard,
  };
  if (purchase.kind === 'value') data.purchasePriceBase = purchase.value;
  if (sale.kind === 'value') data.salePriceBase = sale.value;

  try {
    const created = await db.product.create({
      data,
      select: {
        id: true,
        skuCode: true,
        nameStandard: true,
        purchasePriceBase: true,
        salePriceBase: true,
      },
    });
    return Response.json(
      {
        sku: {
          id: created.id,
          skuCode: created.skuCode,
          nameStandard: created.nameStandard,
          purchasePriceBase: created.purchasePriceBase?.toString() ?? null,
          salePriceBase: created.salePriceBase?.toString() ?? null,
        },
      },
      { status: 201 },
    );
  } catch (err) {
    // P2002 on @@unique([clientId, skuCode]) → the code is taken for this client.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return errorResponse('SKU_CODE_TAKEN', 'Ese código ya existe.', 409);
    }
    console.error('[parametros/skus] unexpected error:', err);
    return errorResponse('INTERNAL_ERROR', 'Error al crear el SKU.', 500);
  }
}
