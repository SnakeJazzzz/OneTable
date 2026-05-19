import type { ParsedRow } from '@/core/parsers/types';

export const SORIANA_EXPECTED_FIRST_3_ROWS: ParsedRow[] = [
  {
    periodYear: 2026, periodMonth: 1,
    portalRawProduct: "BEEFJERKY - CHILLI LIME 86 GR VIK'S 86",
    storeId: '0001', storeName: 'SANTO DOMINGO', storeFormat: null,
    salesUnits: 3,
    salesAmountMxn: 406.93,
    inventoryUnits: 8,
  },
  {
    periodYear: 2026, periodMonth: 2,
    portalRawProduct: "BEEFJERKY - CHILLI LIME 86 GR VIK'S 86",
    storeId: '0001', storeName: 'SANTO DOMINGO', storeFormat: null,
    salesUnits: 1,
    salesAmountMxn: 138.12,
    inventoryUnits: 8,
  },
  {
    periodYear: 2026, periodMonth: 3,
    portalRawProduct: "BEEFJERKY - CHILLI LIME 86 GR VIK'S 86",
    storeId: '0001', storeName: 'SANTO DOMINGO', storeFormat: null,
    salesUnits: 2,
    salesAmountMxn: 278.12,
    inventoryUnits: 6,
  },
];

export const SORIANA_EXPECTED_TOTAL_ROWS = 60;
