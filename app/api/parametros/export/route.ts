/**
 * GET /api/parametros/export — download the client's canonical catalog as an
 * xlsx (§10.2 round-trip with the importer). Column order is load-bearing:
 *   A: Código (header literal "Código") — the importer keys updates off this,
 *   B: Producto, C: PrecioCompra, D: PrecioVenta.
 * Re-importing an exported file is a no-op (every row matches by Código).
 *
 * Auth: required. clientId from the session token.
 *
 * Decimal serialization: price cells are written as strings (empty string when
 * null), never floats, so precision survives the round-trip.
 */

import * as XLSX from 'xlsx';
import { db } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';

const HEADER = ['Código', 'Producto', 'PrecioCompra', 'PrecioVenta'] as const;

export async function GET(): Promise<Response> {
  const sessionOrError = await requireAuth();
  if (sessionOrError instanceof Response) return sessionOrError;
  const { clientId } = sessionOrError;

  const products = await db.product.findMany({
    where: { clientId },
    select: {
      skuCode: true,
      nameStandard: true,
      purchasePriceBase: true,
      salePriceBase: true,
    },
    orderBy: { nameStandard: 'asc' },
  });

  const rows = products.map((p) => ({
    'Código': p.skuCode,
    Producto: p.nameStandard,
    PrecioCompra: p.purchasePriceBase?.toString() ?? '',
    PrecioVenta: p.salePriceBase?.toString() ?? '',
  }));

  // header: [...] pins column order even if rows is empty (header-only sheet).
  const sheet = XLSX.utils.json_to_sheet(rows, { header: [...HEADER] });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, 'Parámetros');

  const buffer: Buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

  return new Response(buffer, {
    status: 200,
    headers: {
      'content-type':
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': 'attachment; filename="parametros.xlsx"',
    },
  });
}
