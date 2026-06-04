import { makeCuid } from '../ids';
import * as XLSX from 'xlsx';
import type { PrismaClient, Prisma } from '@prisma/client';

// User-facing Parámetros importer (§10.1). Distinct from the seed-only
// core/catalog/import.ts. Additive, idempotent, non-destructive.
// NEVER touches ProductMapping or SelloutData — no Prisma calls to those models.
export type ParametersImportResult = {
  created: number;
  updated: number;
  skippedNoName: number;
  newCatalogMode: boolean; // true when the Código column was absent
  warnings: string[];
};

const NEW_CATALOG_WARNING =
  'este Excel no tiene códigos. Para actualizaciones futuras, exportá primero desde Parámetros.';

// Header detection is case/accent-tolerant. We normalize by stripping accents,
// lowercasing, and trimming, then match against canonical keys.
function normalizeHeader(h: string): string {
  return h
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip combining diacritics (á → a)
    .trim()
    .toLowerCase();
}

const CODIGO_KEYS = new Set(['codigo']); // matches "Código" and "Codigo"
const PRODUCTO_KEYS = new Set(['producto']);
const PRECIO_COMPRA_KEYS = new Set(['preciocompra', 'precio compra']);
const PRECIO_VENTA_KEYS = new Set(['precioventa', 'precio venta']);

// Returns a trimmed string price if the cell holds a real numeric value, else
// null (blank / null / non-numeric are all treated as "absent" — no write,
// never zero). We pass the raw numeric STRING to Prisma's Decimal field.
function parsePrice(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? String(raw) : null;
  }
  const s = String(raw).trim();
  if (s === '') return null;
  // Accept plain decimal numbers only. Anything non-numeric is "absent".
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return s;
}

function cellToString(raw: unknown): string {
  if (raw === null || raw === undefined) return '';
  return String(raw).trim();
}

export async function importParameters(
  input: { clientId: string; fileBuffer: Buffer },
  db: PrismaClient,
): Promise<ParametersImportResult> {
  const wb = XLSX.read(input.fileBuffer, { type: 'buffer' });
  // Sheet-selection strategy: read the FIRST sheet (simplest robust choice for
  // a user-facing importer; the export only ever produces one sheet).
  const sheetName = wb.SheetNames[0];

  const result: ParametersImportResult = {
    created: 0,
    updated: 0,
    skippedNoName: 0,
    newCatalogMode: false,
    warnings: [],
  };

  if (!sheetName) return result;
  const sheet = wb.Sheets[sheetName];
  if (!sheet) return result;

  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });
  if (rows.length === 0) return result;

  // Resolve the original header keys from the first row by normalized matching.
  const firstRow = rows[0];
  let codigoKey: string | null = null;
  let productoKey: string | null = null;
  let precioCompraKey: string | null = null;
  let precioVentaKey: string | null = null;

  for (const key of Object.keys(firstRow)) {
    const norm = normalizeHeader(key);
    if (codigoKey === null && CODIGO_KEYS.has(norm)) codigoKey = key;
    else if (productoKey === null && PRODUCTO_KEYS.has(norm)) productoKey = key;
    else if (precioCompraKey === null && PRECIO_COMPRA_KEYS.has(norm)) precioCompraKey = key;
    else if (precioVentaKey === null && PRECIO_VENTA_KEYS.has(norm)) precioVentaKey = key;
  }

  // New-catalog mode: the Código column is absent → every row is a create.
  result.newCatalogMode = codigoKey === null;
  if (result.newCatalogMode) {
    result.warnings.push(NEW_CATALOG_WARNING);
  }

  for (const row of rows) {
    const nameStandard = productoKey ? cellToString(row[productoKey]) : '';
    if (!nameStandard) {
      result.skippedNoName++;
      continue;
    }

    const purchase = precioCompraKey ? parsePrice(row[precioCompraKey]) : null;
    const sale = precioVentaKey ? parsePrice(row[precioVentaKey]) : null;

    const rawCode = codigoKey ? cellToString(row[codigoKey]) : '';

    // Decide skuCode for matching/creation:
    // - new-catalog mode OR empty Código → create with a generated cuid.
    // - Código present → match by (clientId, skuCode); update or insert.
    if (result.newCatalogMode || rawCode === '') {
      await createProduct(db, input.clientId, makeCuid(), nameStandard, purchase, sale);
      result.created++;
      continue;
    }

    const existing = await db.product.findUnique({
      where: { clientId_skuCode: { clientId: input.clientId, skuCode: rawCode } },
    });

    if (existing) {
      // Excel-wins WITHOUT destruction by empty: include a field in the update
      // payload ONLY when its cell carries a value. Omitted key = unchanged.
      const data: Prisma.ProductUpdateInput = { nameStandard };
      if (purchase !== null) data.purchasePriceBase = purchase;
      if (sale !== null) data.salePriceBase = sale;
      await db.product.update({
        where: { clientId_skuCode: { clientId: input.clientId, skuCode: rawCode } },
        data,
      });
      result.updated++;
    } else {
      await createProduct(db, input.clientId, rawCode, nameStandard, purchase, sale);
      result.created++;
    }
  }

  return result;
}

async function createProduct(
  db: PrismaClient,
  clientId: string,
  skuCode: string,
  nameStandard: string,
  purchase: string | null,
  sale: string | null,
): Promise<void> {
  const data: Prisma.ProductCreateInput = {
    client: { connect: { id: clientId } },
    skuCode,
    nameStandard,
  };
  if (purchase !== null) data.purchasePriceBase = purchase;
  if (sale !== null) data.salePriceBase = sale;
  await db.product.create({ data });
}
