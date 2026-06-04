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

// Max integer-part value for a Decimal(12,2) column: 10 integer digits, so the
// numeric value must be < 10^10. Postgres rounds extra decimal places (scale)
// automatically, so we only guard integer-part precision, not decimal places.
const DECIMAL_12_2_MAX_EXCLUSIVE = 10_000_000_000; // 10^10

// Result of parsing a price cell:
// - { ok: true; value } → a canonical, non-negative decimal STRING to write.
// - { ok: false; reason: 'absent' } → blank / null / non-numeric → no write.
// - { ok: false; reason: 'tooLarge' } → numeric but exceeds Decimal(12,2);
//   caller omits the write AND surfaces a warning so the user isn't left
//   wondering why the price silently vanished.
type PriceParse =
  | { ok: true; value: string }
  | { ok: false; reason: 'absent' | 'tooLarge' };

// Strict, non-negative plain decimal only. Rejects hex ("0x10"), scientific
// notation ("1e3"), signs ("-5"), commas, currency symbols, embedded
// whitespace — ALL treated as "absent" (no write, never zero), per §10.2/§10.3.
function parsePrice(raw: unknown): PriceParse {
  if (raw === null || raw === undefined) return { ok: false, reason: 'absent' };

  if (typeof raw === 'number') {
    if (!Number.isFinite(raw) || raw < 0) return { ok: false, reason: 'absent' };
    if (raw >= DECIMAL_12_2_MAX_EXCLUSIVE) return { ok: false, reason: 'tooLarge' };
    return { ok: true, value: String(raw) };
  }

  const s = String(raw).trim();
  if (s === '') return { ok: false, reason: 'absent' };
  // Accept ONLY a plain non-negative decimal; anything else is "absent".
  if (!/^\d+(\.\d+)?$/.test(s)) return { ok: false, reason: 'absent' };
  if (Number(s) >= DECIMAL_12_2_MAX_EXCLUSIVE) return { ok: false, reason: 'tooLarge' };
  return { ok: true, value: s };
}

// Resolve a price cell into a writable decimal string (or null = no write),
// emitting a warning on the result when the value is numeric but out of range.
// Keeps parsePrice pure; warning emission lives here, in importParameters scope.
function resolvePrice(
  key: string | null,
  row: Record<string, unknown>,
  label: 'Compra' | 'Venta',
  nameStandard: string,
  result: ParametersImportResult,
): string | null {
  if (!key) return null;
  const parsed = parsePrice(row[key]);
  if (parsed.ok) return parsed.value;
  if (parsed.reason === 'tooLarge') {
    result.warnings.push(
      `Precio ${label} fuera de rango para "${nameStandard}" (excede ${'numeric(12,2)'}); se omitió ese precio.`,
    );
  }
  return null;
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

    const purchase = resolvePrice(precioCompraKey, row, 'Compra', nameStandard, result);
    const sale = resolvePrice(precioVentaKey, row, 'Venta', nameStandard, result);

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
