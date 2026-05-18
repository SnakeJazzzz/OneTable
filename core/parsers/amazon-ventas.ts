import { createHash } from 'node:crypto';
import * as XLSX from 'xlsx';
import type { Chain, FileType } from '@prisma/client';
import type { ParsedRow, ParserResult, PortalParser } from './types';

export const amazonVentasParser: PortalParser = {
  chain: 'AMAZON' as Chain,
  supportedFileTypes: ['VENTAS' as FileType],

  async parse({ buffer, fileType, originalFilename }) {
    const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });

    const rows: ParsedRow[] = [];
    const warnings: ParserResult['warnings'] = [];

    for (let i = 0; i < raw.length; i++) {
      const r = raw[i];
      try {
        const periodo = r['PERIODO'];
        if (!(periodo instanceof Date)) throw new Error(`PERIODO is not a Date: ${typeof periodo}`);
        const row: ParsedRow = {
          periodYear: periodo.getUTCFullYear(),
          periodMonth: periodo.getUTCMonth() + 1,
          portalRawProduct: String(r['ASIN']),
          storeId: null,
          storeName: null,
          storeFormat: null,
          salesUnits: Number(r['Unidades pedidas']),
        };
        rows.push(row);
      } catch (err) {
        warnings.push({ rowIndex: i + 1, message: (err as Error).message });
      }
    }

    const fileHash = createHash('sha256').update(buffer).digest('hex');
    return {
      metadata: {
        chain: 'AMAZON' as Chain,
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
