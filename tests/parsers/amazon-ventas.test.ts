import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { amazonVentasParser } from '@/core/parsers/amazon-ventas';
import { AMAZON_VENTAS_EXPECTED } from '@/tests/fixtures/amazon-ventas-expected';

const SAMPLE = resolve(__dirname, '../../docs/specs/viks-data/samples/amazon-ventas-sample.xlsx');

describe('amazonVentasParser', () => {
  it('parses 9 rows with ASIN as portalRawProduct, null store, AMAZON/VENTAS metadata', async () => {
    const buffer = await readFile(SAMPLE);
    const result = await amazonVentasParser.parse({ buffer, fileType: 'VENTAS', originalFilename: 'amazon-ventas-sample.xlsx' });
    expect(result.rows).toEqual(AMAZON_VENTAS_EXPECTED);
    expect(result.metadata.chain).toBe('AMAZON');
    expect(result.metadata.fileType).toBe('VENTAS');
    expect(result.metadata.rowCount).toBe(9);
  });

  it('drops Título del Producto from emitted rows', async () => {
    const buffer = await readFile(SAMPLE);
    const result = await amazonVentasParser.parse({ buffer, fileType: 'VENTAS', originalFilename: 'amazon-ventas-sample.xlsx' });
    for (const r of result.rows) {
      expect((r as any)['Título del Producto']).toBeUndefined();
    }
  });

  it('emits sha256 file hash and correct size', async () => {
    const buffer = await readFile(SAMPLE);
    const result = await amazonVentasParser.parse({ buffer, fileType: 'VENTAS', originalFilename: 'amazon-ventas-sample.xlsx' });
    expect(result.metadata.fileHash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.metadata.fileSizeBytes).toBe(buffer.length);
  });
});
