import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chedrauiParser } from '@/core/parsers/chedraui';
import { CHEDRAUI_EXPECTED_FIRST_2_ROWS, CHEDRAUI_EXPECTED_TOTAL_ROWS } from '@/tests/fixtures/chedraui-expected';

const SAMPLE = resolve(__dirname, '../../docs/specs/viks-data/samples/chedraui-sample.xlsx');

describe('chedrauiParser', () => {
  it('parses 40 rows with correct chain + fileType', async () => {
    const buffer = await readFile(SAMPLE);
    const result = await chedrauiParser.parse({ buffer, fileType: 'MIXED', originalFilename: 'chedraui-sample.xlsx' });
    expect(result.rows).toHaveLength(CHEDRAUI_EXPECTED_TOTAL_ROWS);
    expect(result.metadata.chain).toBe('CHEDRAUI');
    expect(result.metadata.fileType).toBe('MIXED');
  });

  it('extracts storeId as first 5 chars of Tienda, keeps full string as storeName', async () => {
    const buffer = await readFile(SAMPLE);
    const result = await chedrauiParser.parse({ buffer, fileType: 'MIXED', originalFilename: 'chedraui-sample.xlsx' });
    expect(result.rows.slice(0, 2)).toEqual(CHEDRAUI_EXPECTED_FIRST_2_ROWS);
  });

  it('emits only units (no MXN amounts) — Chedraui is unit-only', async () => {
    const buffer = await readFile(SAMPLE);
    const result = await chedrauiParser.parse({ buffer, fileType: 'MIXED', originalFilename: 'chedraui-sample.xlsx' });
    expect(result.rows.every(r => r.salesAmountMxn === undefined && r.purchasesAmountMxn === undefined && r.inventoryAmountCostMxn === undefined && r.inventoryAmountPriceMxn === undefined)).toBe(true);
  });

  it('drops Column1 (no field on parsed rows references it)', async () => {
    const buffer = await readFile(SAMPLE);
    const result = await chedrauiParser.parse({ buffer, fileType: 'MIXED', originalFilename: 'chedraui-sample.xlsx' });
    // No leakage of the row index column into emitted ParsedRow.
    expect((result.rows[0] as any).Column1).toBeUndefined();
  });
});
