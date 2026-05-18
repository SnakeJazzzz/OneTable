import { createHash } from 'node:crypto';
import * as XLSX from 'xlsx';
import type { Chain, FileType } from '@prisma/client';
import type { ParsedRow, ParserResult, PortalParser } from './types';
import { parseShortSpanishMonthYear } from '../dates/spanish-months';

export const sorianaParser: PortalParser = {
  chain: 'SORIANA' as Chain,
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
        const mesStr = String(r['Mes']);
        const { year, month } = parseShortSpanishMonthYear(mesStr);

        const row: ParsedRow = {
          periodYear: year,
          periodMonth: month,
          portalRawProduct: String(r['Artículo']),
          storeId: String(r['Código Tienda']),
          storeName: String(r['Tienda']),
          storeFormat: null,
        };

        const ventaPesos = r['Venta (Pesos)'];
        const ventaUnidades = r['Venta (Unidades)'];
        const compraUnidades = r['Compra (Unidades)'];
        const compraPesos = r['Compra (Pesos)'];
        const inventario = r['Inventario (Actual)'];

        if (ventaPesos !== null) row.salesAmountMxn = Number(ventaPesos);
        if (ventaUnidades !== null) row.salesUnits = Number(ventaUnidades);
        if (compraUnidades !== null) row.purchasesUnits = Number(compraUnidades);
        if (compraPesos !== null) row.purchasesAmountMxn = Number(compraPesos);
        if (inventario !== null) row.inventoryUnits = Number(inventario);

        rows.push(row);
      } catch (err) {
        warnings.push({ rowIndex: i + 1, message: (err as Error).message });
      }
    }

    const fileHash = createHash('sha256').update(buffer).digest('hex');

    return {
      metadata: {
        chain: 'SORIANA' as Chain,
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
