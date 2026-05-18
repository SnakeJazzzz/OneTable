import type { ParsedRow } from '@/core/parsers/types';

export const CHEDRAUI_EXPECTED_FIRST_2_ROWS: ParsedRow[] = [
  {
    periodYear: 2026, periodMonth: 1,
    portalRawProduct: "Carne Seca Vik s Jerky Co Res Hab 86 gr (3845442)",
    storeId: "00100",
    storeName: "00100 CHEDRAUI SELECTO MEXICO FORTUNA 03-17",
    storeFormat: null,
    salesUnits: 2,
    inventoryUnits: 14,
  },
  {
    periodYear: 2026, periodMonth: 1,
    portalRawProduct: "Carne Seca Vik s Jerky Co Res Limo 86 gr (3845443)",
    storeId: "00100",
    storeName: "00100 CHEDRAUI SELECTO MEXICO FORTUNA 03-17",
    storeFormat: null,
    salesUnits: 2,
    inventoryUnits: 12,
  },
];

export const CHEDRAUI_EXPECTED_TOTAL_ROWS = 40;
