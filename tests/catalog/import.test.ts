import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { importCatalog } from '@/core/catalog/import';

const CATALOG_PATH = resolve(__dirname, '../../docs/specs/viks-data/catalogo-productos.xlsx');
const db = new PrismaClient();
const TEST_EMAIL = 'test-import-s6@example.com';

// Verified by inspecting catalogo-productos.xlsx:
// - 15 product rows (rows 2-16, row 1 is the header)
// - AL SUPER duplicate: "(T)CARNE SECA TROZO CITRUS GINGER VIKS JERKY 100 GRAMOS"
//   appears for both "Chilli Lime 100g" (row 2) and "Habanero 100g" (row 8)
const EXPECTED_PRODUCTS = 15;

describe('importCatalog (against real VIKS catalogo-productos.xlsx)', () => {
  let clientId: string;

  beforeAll(async () => {
    // Clean up from any prior test run
    await db.user.deleteMany({ where: { email: TEST_EMAIL } });
    const user = await db.user.create({ data: { email: TEST_EMAIL, passwordHash: 'x', name: 'test-s6' } });
    const client = await db.client.create({ data: { name: 'TEST IMPORT S6 VIKS', userId: user.id } });
    clientId = client.id;
  });

  afterAll(async () => {
    await db.user.deleteMany({ where: { email: TEST_EMAIL } });
    await db.$disconnect();
  });

  it(`imports ${EXPECTED_PRODUCTS} products from VIKS catalog`, async () => {
    const buf = await readFile(CATALOG_PATH);
    const stats = await importCatalog({ clientId, fileBuffer: buf }, db);
    expect(stats.productsCreated).toBe(EXPECTED_PRODUCTS);
    expect(stats.productsExisting).toBe(0);
  });

  it('detects the known AL SUPER duplicate (CITRUS GINGER mapped to 2 products)', async () => {
    // Use a fresh client so products start clean and we see one duplicate
    await db.user.deleteMany({ where: { email: 'test-import-s6-dup@example.com' } });
    const u = await db.user.create({ data: { email: 'test-import-s6-dup@example.com', passwordHash: 'x' } });
    const c = await db.client.create({ data: { name: 'TEST DUP', userId: u.id } });
    try {
      const buf = await readFile(CATALOG_PATH);
      const stats = await importCatalog({ clientId: c.id, fileBuffer: buf }, db);
      expect(stats.mappingsSkippedDuplicate).toBe(1);
      expect(
        stats.warnings.some(w => w.includes('CITRUS GINGER') && w.includes('AL_SUPER'))
      ).toBe(true);
      // Mappings created should be substantial (many non-null chain cells across 15 products)
      expect(stats.mappingsCreated).toBeGreaterThan(20);
    } finally {
      await db.user.deleteMany({ where: { email: 'test-import-s6-dup@example.com' } });
    }
  });

  it('warns about unknown chain columns (1 STOP, 7 ELEVEN, etc.)', async () => {
    await db.user.deleteMany({ where: { email: 'test-import-s6-warn@example.com' } });
    const u = await db.user.create({ data: { email: 'test-import-s6-warn@example.com', passwordHash: 'x' } });
    const c = await db.client.create({ data: { name: 'TEST WARN', userId: u.id } });
    try {
      const buf = await readFile(CATALOG_PATH);
      const stats = await importCatalog({ clientId: c.id, fileBuffer: buf }, db);
      // These columns exist in catalogo-productos.xlsx but are not in CHAIN_HEADER_MAP
      const expectedUnknown = ['1 STOP', '7 ELEVEN', 'CASA LEY', 'PITS', 'SUPER NATURISTA', 'VINOS AMERICA'];
      for (const colName of expectedUnknown) {
        expect(stats.warnings.some(w => w.includes(colName))).toBe(true);
      }
    } finally {
      await db.user.deleteMany({ where: { email: 'test-import-s6-warn@example.com' } });
    }
  });
});
