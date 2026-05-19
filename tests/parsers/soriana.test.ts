import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { sorianaParser } from '@/core/parsers/soriana';
import { SORIANA_EXPECTED_FIRST_3_ROWS, SORIANA_EXPECTED_TOTAL_ROWS } from '@/tests/fixtures/soriana-expected';

const SAMPLE_PATH = resolve(__dirname, '../../docs/specs/viks-data/samples/soriana-sample.xlsx');

describe('sorianaParser', () => {
  it('parses the VIKS sample with expected row count', async () => {
    const buffer = await readFile(SAMPLE_PATH);
    const result = await sorianaParser.parse({ buffer, fileType: 'MIXED', originalFilename: 'soriana-sample.xlsx' });
    expect(result.rows).toHaveLength(SORIANA_EXPECTED_TOTAL_ROWS);
    expect(result.metadata.chain).toBe('SORIANA');
    expect(result.metadata.fileType).toBe('MIXED');
  });

  it('produces the expected first 3 rows', async () => {
    const buffer = await readFile(SAMPLE_PATH);
    const result = await sorianaParser.parse({ buffer, fileType: 'MIXED', originalFilename: 'soriana-sample.xlsx' });
    expect(result.rows.slice(0, 3)).toEqual(SORIANA_EXPECTED_FIRST_3_ROWS);
  });

  it('preserves null compras (purchases) when not provided, and emits compras when present', async () => {
    const buffer = await readFile(SAMPLE_PATH);
    const result = await sorianaParser.parse({ buffer, fileType: 'MIXED', originalFilename: 'soriana-sample.xlsx' });
    // Most rows have null compras — verify those rows have undefined purchasesUnits/purchasesAmountMxn
    const noCompras = result.rows.filter(r => r.purchasesUnits === undefined && r.purchasesAmountMxn === undefined);
    expect(noCompras.length).toBeGreaterThan(0);
    // Some rows DO have compras in this sample (4 rows) — verify they are emitted
    const withCompras = result.rows.filter(r => r.purchasesUnits !== undefined || r.purchasesAmountMxn !== undefined);
    expect(withCompras.length).toBe(4);
    // Spot-check: no row should have purchasesUnits without purchasesAmountMxn or vice versa
    expect(withCompras.every(r => r.purchasesUnits !== undefined && r.purchasesAmountMxn !== undefined)).toBe(true);
  });

  it('emits SORIANA metadata with correct file hash and size', async () => {
    const buffer = await readFile(SAMPLE_PATH);
    const result = await sorianaParser.parse({ buffer, fileType: 'MIXED', originalFilename: 'soriana-sample.xlsx' });
    expect(result.metadata.fileSizeBytes).toBe(buffer.length);
    expect(result.metadata.fileHash).toMatch(/^[0-9a-f]{64}$/);  // sha256 hex
    expect(result.metadata.rowCount).toBe(60);
  });
});
