import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient, type Chain } from '@prisma/client';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { sorianaParser } from '@/core/parsers/soriana';
import { normalize } from '@/core/normalizer';
import type { ParserResult } from '@/core/parsers/types';

const db = new PrismaClient();
const TEST_EMAIL = 'test-norm-s7@example.com';

describe('normalize() against real Soriana sample', () => {
  let clientId: string;
  let userId: string;

  beforeAll(async () => {
    await db.user.deleteMany({ where: { email: TEST_EMAIL } });
    const u = await db.user.create({ data: { email: TEST_EMAIL, passwordHash: 'x' } });
    userId = u.id;
    const c = await db.client.create({ data: { name: 'TEST NORM S7', userId } });
    clientId = c.id;
  });

  afterAll(async () => {
    await db.user.deleteMany({ where: { email: TEST_EMAIL } });
    await db.$disconnect();
  });

  beforeEach(async () => {
    await db.selloutData.deleteMany({ where: { clientId } });
    await db.unmappedProduct.deleteMany({ where: { clientId } });
    await db.upload.deleteMany({ where: { clientId } });
  });

  it('inserts 60 rows, all unmapped if catalog is empty', async () => {
    const upload = await db.upload.create({
      data: {
        clientId,
        userId,
        chain: 'SORIANA' as Chain,
        fileType: 'MIXED',
        originalFilename: 'soriana.xlsx',
        fileHash: 'h1',
        fileSizeBytes: 1,
      },
    });
    const buf = await readFile(
      resolve(__dirname, '../../docs/specs/viks-data/samples/soriana-sample.xlsx'),
    );
    const parsed = await sorianaParser.parse({
      buffer: buf,
      fileType: 'MIXED',
      originalFilename: 'soriana-sample.xlsx',
    });
    const stats = await normalize(
      {
        clientId,
        userId,
        uploadId: upload.id,
        parserResult: parsed,
        mappingLookup: () => null,
      },
      db,
    );

    expect(stats.rowsTotal).toBe(60);
    expect(stats.rowsInserted).toBe(60);
    expect(stats.rowsUpdated).toBe(0);
    expect(stats.rowsUnmapped).toBe(60);
    expect(stats.newUnmappedProducts).toBeGreaterThan(0);

    const dbCount = await db.selloutData.count({ where: { clientId } });
    expect(dbCount).toBe(60);
    const unmappedCount = await db.unmappedProduct.count({ where: { clientId } });
    expect(unmappedCount).toBeGreaterThan(0);
  });

  it('on re-upload of same data, updates 60 and inserts 0 (idempotent)', async () => {
    const upload = await db.upload.create({
      data: {
        clientId,
        userId,
        chain: 'SORIANA' as Chain,
        fileType: 'MIXED',
        originalFilename: 'soriana.xlsx',
        fileHash: 'h2',
        fileSizeBytes: 1,
      },
    });
    const buf = await readFile(
      resolve(__dirname, '../../docs/specs/viks-data/samples/soriana-sample.xlsx'),
    );
    const parsed = await sorianaParser.parse({
      buffer: buf,
      fileType: 'MIXED',
      originalFilename: 'soriana-sample.xlsx',
    });
    await normalize(
      { clientId, userId, uploadId: upload.id, parserResult: parsed, mappingLookup: () => null },
      db,
    );
    const stats2 = await normalize(
      { clientId, userId, uploadId: upload.id, parserResult: parsed, mappingLookup: () => null },
      db,
    );

    expect(stats2.rowsInserted).toBe(0);
    expect(stats2.rowsUpdated).toBe(60);
    const dbCount = await db.selloutData.count({ where: { clientId } });
    expect(dbCount).toBe(60);
  });

  it('COALESCE merge: inventory-only upload after ventas-only upload preserves ventas', async () => {
    const u1 = await db.upload.create({
      data: {
        clientId,
        userId,
        chain: 'SORIANA' as Chain,
        fileType: 'VENTAS',
        originalFilename: 'v.xlsx',
        fileHash: 'v1',
        fileSizeBytes: 1,
      },
    });
    const u2 = await db.upload.create({
      data: {
        clientId,
        userId,
        chain: 'SORIANA' as Chain,
        fileType: 'INVENTARIO',
        originalFilename: 'i.xlsx',
        fileHash: 'i1',
        fileSizeBytes: 1,
      },
    });

    const ventas: ParserResult = {
      metadata: {
        chain: 'SORIANA' as Chain,
        fileType: 'VENTAS',
        originalFilename: 'v.xlsx',
        fileHash: 'v1',
        fileSizeBytes: 1,
        rowCount: 1,
      },
      rows: [
        {
          periodYear: 2026,
          periodMonth: 1,
          portalRawProduct: 'TEST PRODUCT',
          storeId: '0001',
          storeName: 'TEST STORE',
          storeFormat: null,
          salesUnits: 100,
          salesAmountMxn: 5000,
        },
      ],
      warnings: [],
    };
    const inventario: ParserResult = {
      metadata: {
        chain: 'SORIANA' as Chain,
        fileType: 'INVENTARIO',
        originalFilename: 'i.xlsx',
        fileHash: 'i1',
        fileSizeBytes: 1,
        rowCount: 1,
      },
      rows: [
        {
          periodYear: 2026,
          periodMonth: 1,
          portalRawProduct: 'TEST PRODUCT',
          storeId: '0001',
          storeName: 'TEST STORE',
          storeFormat: null,
          inventoryUnits: 50,
        },
      ],
      warnings: [],
    };

    await normalize(
      { clientId, userId, uploadId: u1.id, parserResult: ventas, mappingLookup: () => null },
      db,
    );
    const stats2 = await normalize(
      { clientId, userId, uploadId: u2.id, parserResult: inventario, mappingLookup: () => null },
      db,
    );

    expect(stats2.rowsInserted).toBe(0);
    expect(stats2.rowsUpdated).toBe(1);

    const rows = await db.selloutData.findMany({ where: { clientId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].salesUnits).toBe(100); // preserved from first upload
    expect(rows[0].salesAmountMxn?.toNumber()).toBe(5000); // preserved
    expect(rows[0].inventoryUnits).toBe(50); // new from second upload
  });
});
