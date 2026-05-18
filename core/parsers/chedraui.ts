import { createHash } from 'node:crypto';
import * as XLSX from 'xlsx';
import type { Chain, FileType } from '@prisma/client';
import type { ParsedRow, ParserResult, PortalParser } from './types';
import { parseLongSpanishMonthYear } from '../dates/spanish-months';

export const chedrauiParser: PortalParser = {
  chain: 'CHEDRAUI' as Chain,
  supportedFileTypes: ['MIXED' as FileType],

  async parse({ buffer, fileType, originalFilename }) {
    const wb = XLSX.read(buffer, { type: 'buffer' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });

    const rows: ParsedRow[] = [];
    const warnings: ParserResult['warnings'] = [];

    for (let i = 0; i < raw.length; i++) {
      const r = raw[i];
      try {
        const monthStr = String(r['Month']);
        const { year, month } = parseLongSpanishMonthYear(monthStr);
        const tiendaFull = String(r['Tienda']);
        const storeId = tiendaFull.slice(0, 5);

        const row: ParsedRow = {
          periodYear: year,
          periodMonth: month,
          portalRawProduct: String(r['Sku']),
          storeId,
          storeName: tiendaFull,
          storeFormat: null,
        };

        const inv = r['Inv Fin Uni'];
        const venta = r['Venta Neta en Unidades'];
        if (inv !== null) row.inventoryUnits = Number(inv);
        if (venta !== null) row.salesUnits = Number(venta);

        rows.push(row);
      } catch (err) {
        warnings.push({ rowIndex: i + 1, message: (err as Error).message });
      }
    }

    const fileHash = createHash('sha256').update(buffer).digest('hex');

    return {
      metadata: {
        chain: 'CHEDRAUI' as Chain,
        fileType,
        originalFilename,
        fileHash,
        fileSizeBytes: buffer.length,
        rowCount: rows.length,
      },
      rows,
      warnings,
    };
  },
};
