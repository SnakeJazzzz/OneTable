import * as XLSX from 'xlsx';
import type { PrismaClient } from '@prisma/client';
import { Chain } from '@prisma/client';

export type CatalogImportResult = {
  productsCreated: number;
  productsExisting: number;
  mappingsCreated: number;
  mappingsSkippedDuplicate: number;
  warnings: string[];
};

const CHAIN_HEADER_MAP: Record<string, Chain> = {
  'AL SUPER': Chain.AL_SUPER,
  'AMAZON': Chain.AMAZON,
  'CHEDRAUI': Chain.CHEDRAUI,
  'HEB': Chain.HEB,
  'LA COMER': Chain.LA_COMER,
  'SORIANA': Chain.SORIANA,
};

const STANDARD_HEADERS = ['Producto VIKS', 'Producto'] as const;

export async function importCatalog(
  input: { clientId: string; fileBuffer: Buffer },
  db: PrismaClient,
): Promise<CatalogImportResult> {
  const wb = XLSX.read(input.fileBuffer, { type: 'buffer' });
  const sheet = wb.Sheets['Catalogo_Producto'];
  if (!sheet) throw new Error('Sheet "Catalogo_Producto" not found');

  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });

  const stats: CatalogImportResult = {
    productsCreated: 0,
    productsExisting: 0,
    mappingsCreated: 0,
    mappingsSkippedDuplicate: 0,
    warnings: [],
  };

  if (rows.length === 0) return stats;

  const firstRow = rows[0];
  const standardHeader = STANDARD_HEADERS.find(h => h in firstRow);
  if (!standardHeader) {
    throw new Error(
      `No standard column header found. Expected one of: ${STANDARD_HEADERS.join(', ')}`,
    );
  }

  // Build the list of chain columns and warn about unknown ones
  const chainColumns: Array<{ header: string; chain: Chain }> = [];
  for (const key of Object.keys(firstRow)) {
    if (key === standardHeader) continue;
    const upper = key.trim().toUpperCase();
    if (upper in CHAIN_HEADER_MAP) {
      chainColumns.push({ header: key, chain: CHAIN_HEADER_MAP[upper] });
    } else {
      stats.warnings.push(`Ignoring unknown chain column header: "${key}"`);
    }
  }

  for (const row of rows) {
    const nameStandard = String(row[standardHeader] ?? '').trim();
    if (!nameStandard) continue;

    // Get-or-create product
    const existing = await db.product.findUnique({
      where: { clientId_nameStandard: { clientId: input.clientId, nameStandard } },
    });

    let productId: string;
    if (existing) {
      stats.productsExisting++;
      productId = existing.id;
    } else {
      const created = await db.product.create({
        data: { clientId: input.clientId, nameStandard },
      });
      stats.productsCreated++;
      productId = created.id;
    }

    // Create mappings for non-null chain cells
    for (const { header, chain } of chainColumns) {
      const rawValue = row[header];
      if (rawValue === null || rawValue === undefined || rawValue === '') continue;

      const portalString = String(rawValue).trim();
      if (!portalString) continue;

      try {
        await db.productMapping.create({
          data: { clientId: input.clientId, productId, chain, portalString },
        });
        stats.mappingsCreated++;
      } catch (err: unknown) {
        const e = err as { code?: string };
        if (e.code === 'P2002') {
          stats.mappingsSkippedDuplicate++;
          stats.warnings.push(
            `Duplicate mapping skipped: chain=${chain} portalString="${portalString}"`,
          );
        } else {
          throw err;
        }
      }
    }
  }

  return stats;
}
