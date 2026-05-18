import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { amazonInvParser } from '@/core/parsers/amazon-inv';
import { AMAZON_INV_EXPECTED } from '@/tests/fixtures/amazon-inv-expected';

const SAMPLE = resolve(__dirname, '../../docs/specs/viks-data/samples/amazon-inv-sample.xlsx');

describe('amazonInvParser', () => {
  it('parses 9 rows with ASIN as portalRawProduct, null store, AMAZON/INVENTARIO metadata', async () => {
    const buffer = await readFile(SAMPLE);
    const result = await amazonInvParser.parse({ buffer, fileType: 'INVENTARIO', originalFilename: 'amazon-inv-sample.xlsx' });
    expect(result.rows).toEqual(AMAZON_INV_EXPECTED);
    expect(result.metadata.chain).toBe('AMAZON');
    expect(result.metadata.fileType).toBe('INVENTARIO');
    expect(result.metadata.rowCount).toBe(9);
  });

  it('does not emit salesUnits on any row', async () => {
    const buffer = await readFile(SAMPLE);
    const result = await amazonInvParser.parse({ buffer, fileType: 'INVENTARIO', originalFilename: 'amazon-inv-sample.xlsx' });
    for (const r of result.rows) {
      expect((r as any)['salesUnits']).toBeUndefined();
    }
  });

  it('emits sha256 file hash and correct size', async () => {
    const buffer = await readFile(SAMPLE);
    const result = await amazonInvParser.parse({ buffer, fileType: 'INVENTARIO', originalFilename: 'amazon-inv-sample.xlsx' });
    expect(result.metadata.fileHash).toMatch(/^[0-9a-f]{64}$/);
    expect(result.metadata.fileSizeBytes).toBe(buffer.length);
  });
});
