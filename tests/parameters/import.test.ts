import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as XLSX from 'xlsx';
import { PrismaClient, Chain, FileType } from '@prisma/client';
import { importParameters } from '@/core/parameters/import';

const db = new PrismaClient();
const TEST_EMAIL = 'test-parameters-import@example.com';

// Sheet-selection strategy under test: importParameters reads the FIRST sheet
// (wb.SheetNames[0]). All fixtures here build a single-sheet workbook, so the
// sheet name is irrelevant — but we name it 'Parametros' for clarity.
function buildBuffer(aoa: unknown[][]): Buffer {
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Parametros');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

const HEADER = ['Código', 'Producto', 'PrecioCompra', 'PrecioVenta'];

describe('importParameters (additive, idempotent, non-destructive)', () => {
  let clientId: string;

  beforeAll(async () => {
    await db.user.deleteMany({ where: { email: TEST_EMAIL } });
    const user = await db.user.create({
      data: { email: TEST_EMAIL, passwordHash: 'x', name: 'test-parameters' },
    });
    const client = await db.client.create({
      data: { name: 'TEST PARAMETERS IMPORT', userId: user.id },
    });
    clientId = client.id;
  });

  afterAll(async () => {
    await db.user.deleteMany({ where: { email: TEST_EMAIL } });
    await db.$disconnect();
  });

  it('Código lifecycle: INSERT → UPDATE (Excel-wins) → empty cells preserve prices', async () => {
    // Single test walking the full lifecycle on one row so the insert→update→
    // non-destruction chain is explicit and not coupled across separate `it`s
    // via shared mutable DB state. Fresh client keeps it fully isolated.
    const email = 'test-parameters-import-lifecycle@example.com';
    await db.user.deleteMany({ where: { email } });
    const u = await db.user.create({ data: { email, passwordHash: 'x' } });
    const c = await db.client.create({ data: { name: 'TEST LIFECYCLE', userId: u.id } });
    try {
      // Step 1: Código present + not in DB → INSERT with that code.
      const insertBuf = buildBuffer([HEADER, ['CL-86', 'Chilli Lime 86g', '100.00', '150.50']]);
      const insertRes = await importParameters({ clientId: c.id, fileBuffer: insertBuf }, db);
      expect(insertRes.created).toBe(1);
      expect(insertRes.updated).toBe(0);
      expect(insertRes.newCatalogMode).toBe(false);

      let p = await db.product.findUnique({
        where: { clientId_skuCode: { clientId: c.id, skuCode: 'CL-86' } },
      });
      expect(p).not.toBeNull();
      expect(p!.nameStandard).toBe('Chilli Lime 86g');
      expect(p!.purchasePriceBase!.toString()).toBe('100');
      expect(p!.salePriceBase!.toString()).toBe('150.5');

      // Step 2: Código present + exists → UPDATE name + prices (Excel-wins).
      const updateBuf = buildBuffer([HEADER, ['CL-86', 'Chili Lime 86g', '110.00', '160.00']]);
      const updateRes = await importParameters({ clientId: c.id, fileBuffer: updateBuf }, db);
      expect(updateRes.created).toBe(0);
      expect(updateRes.updated).toBe(1);

      p = await db.product.findUnique({
        where: { clientId_skuCode: { clientId: c.id, skuCode: 'CL-86' } },
      });
      expect(p!.nameStandard).toBe('Chili Lime 86g');
      expect(p!.purchasePriceBase!.toString()).toBe('110');
      expect(p!.salePriceBase!.toString()).toBe('160');

      // Step 3: re-import with empty price cells keeps prior prices (§10.3).
      const emptyBuf = buildBuffer([HEADER, ['CL-86', 'Chili Lime 86g', '', '']]);
      const emptyRes = await importParameters({ clientId: c.id, fileBuffer: emptyBuf }, db);
      expect(emptyRes.updated).toBe(1);

      p = await db.product.findUnique({
        where: { clientId_skuCode: { clientId: c.id, skuCode: 'CL-86' } },
      });
      // Prices MUST be untouched — empty cell never NULLs the DB.
      expect(p!.purchasePriceBase).not.toBeNull();
      expect(p!.salePriceBase).not.toBeNull();
      expect(p!.purchasePriceBase!.toString()).toBe('110');
      expect(p!.salePriceBase!.toString()).toBe('160');
    } finally {
      await db.user.deleteMany({ where: { email } });
    }
  });

  it('Código empty → INSERT with makeCuid()', async () => {
    const buf = buildBuffer([HEADER, ['', 'No Code Product', '50.00', '75.00']]);
    const res = await importParameters({ clientId, fileBuffer: buf }, db);

    expect(res.created).toBe(1);
    // The created product should have a cuid-shaped skuCode (c + 24 hex).
    const products = await db.product.findMany({
      where: { clientId, nameStandard: 'No Code Product' },
    });
    expect(products).toHaveLength(1);
    expect(products[0].skuCode).toMatch(/^c[0-9a-f]{24}$/);
  });

  it('Blank Producto → skippedNoName++, no insert', async () => {
    const buf = buildBuffer([HEADER, ['SKIP-1', '', '10.00', '20.00']]);
    const res = await importParameters({ clientId, fileBuffer: buf }, db);

    expect(res.skippedNoName).toBe(1);
    expect(res.created).toBe(0);
    expect(res.updated).toBe(0);
    const p = await db.product.findUnique({
      where: { clientId_skuCode: { clientId, skuCode: 'SKIP-1' } },
    });
    expect(p).toBeNull();
  });

  it('No Código column → new-catalog mode: every row inserts + prominent warning', async () => {
    // Fresh client to keep this case isolated.
    const email = 'test-parameters-import-newcat@example.com';
    await db.user.deleteMany({ where: { email } });
    const u = await db.user.create({ data: { email, passwordHash: 'x' } });
    const c = await db.client.create({ data: { name: 'TEST NEWCAT', userId: u.id } });
    try {
      const buf = buildBuffer([
        ['Producto', 'PrecioCompra', 'PrecioVenta'],
        ['Row A', '11.00', '22.00'],
        ['Row B', '33.00', '44.00'],
      ]);
      const res = await importParameters({ clientId: c.id, fileBuffer: buf }, db);

      expect(res.newCatalogMode).toBe(true);
      expect(res.created).toBe(2);
      expect(res.updated).toBe(0);
      expect(
        res.warnings.some((w) => w.includes('este Excel no tiene códigos')),
      ).toBe(true);

      const products = await db.product.findMany({ where: { clientId: c.id } });
      expect(products).toHaveLength(2);
      // Each got a cuid-shaped skuCode.
      for (const p of products) {
        expect(p.skuCode).toMatch(/^c[0-9a-f]{24}$/);
      }
    } finally {
      await db.user.deleteMany({ where: { email } });
    }
  });

  it('never touches ProductMapping or SelloutData: counts identical before/after re-import', async () => {
    // Fresh client. Build a Product, a ProductMapping, and a SelloutData row.
    const email = 'test-parameters-import-counts@example.com';
    await db.user.deleteMany({ where: { email } });
    const u = await db.user.create({ data: { email, passwordHash: 'x' } });
    const c = await db.client.create({ data: { name: 'TEST COUNTS', userId: u.id } });
    try {
      // Seed a product via the importer (Código path) so it exists for re-import.
      const seedBuf = buildBuffer([HEADER, ['CNT-1', 'Counted Product', '100.00', '200.00']]);
      await importParameters({ clientId: c.id, fileBuffer: seedBuf }, db);
      const product = await db.product.findUnique({
        where: { clientId_skuCode: { clientId: c.id, skuCode: 'CNT-1' } },
      });
      expect(product).not.toBeNull();

      // Minimal valid ProductMapping.
      await db.productMapping.create({
        data: {
          clientId: c.id,
          productId: product!.id,
          chain: Chain.SORIANA,
          portalString: 'RAW SORIANA STRING',
        },
      });

      // Minimal valid Upload (required for SelloutData? uploadId is optional, but we
      // create one to keep the row realistic; SelloutData.userId is required).
      const upload = await db.upload.create({
        data: {
          clientId: c.id,
          userId: u.id,
          chain: Chain.SORIANA,
          fileType: FileType.MIXED,
          originalFilename: 'x.xlsx',
          fileHash: 'deadbeef',
          fileSizeBytes: 1,
        },
      });

      // Minimal valid SelloutData (required: clientId, userId, periodYear,
      // periodMonth, chain, portalRawProduct).
      await db.selloutData.create({
        data: {
          clientId: c.id,
          userId: u.id,
          uploadId: upload.id,
          periodYear: 2026,
          periodMonth: 1,
          chain: Chain.SORIANA,
          portalRawProduct: 'RAW SORIANA STRING',
          productId: product!.id,
        },
      });

      const mappingsBefore = await db.productMapping.count({ where: { clientId: c.id } });
      const selloutBefore = await db.selloutData.count({ where: { clientId: c.id } });
      expect(mappingsBefore).toBe(1);
      expect(selloutBefore).toBe(1);

      // Re-import the same buffer.
      await importParameters({ clientId: c.id, fileBuffer: seedBuf }, db);

      const mappingsAfter = await db.productMapping.count({ where: { clientId: c.id } });
      const selloutAfter = await db.selloutData.count({ where: { clientId: c.id } });
      expect(mappingsAfter).toBe(mappingsBefore);
      expect(selloutAfter).toBe(selloutBefore);
    } finally {
      await db.user.deleteMany({ where: { email } });
    }
  });

  it('numeric-typed price cells import exactly (typeof === number branch)', async () => {
    const email = 'test-parameters-import-numeric@example.com';
    await db.user.deleteMany({ where: { email } });
    const u = await db.user.create({ data: { email, passwordHash: 'x' } });
    const c = await db.client.create({ data: { name: 'TEST NUMERIC', userId: u.id } });
    try {
      // aoa_to_sheet preserves JS number types, so these exercise the numeric
      // branch of parsePrice (NOT the string branch).
      const buf = buildBuffer([HEADER, ['NUM-1', 'Numeric Cell', 100.5, 200]]);
      const res = await importParameters({ clientId: c.id, fileBuffer: buf }, db);
      expect(res.created).toBe(1);

      const p = await db.product.findUnique({
        where: { clientId_skuCode: { clientId: c.id, skuCode: 'NUM-1' } },
      });
      expect(p!.purchasePriceBase!.toString()).toBe('100.5');
      expect(p!.salePriceBase!.toString()).toBe('200');
    } finally {
      await db.user.deleteMany({ where: { email } });
    }
  });

  it('malformed price strings are treated as absent (no silent corruption)', async () => {
    const email = 'test-parameters-import-malformed@example.com';
    await db.user.deleteMany({ where: { email } });
    const u = await db.user.create({ data: { email, passwordHash: 'x' } });
    const c = await db.client.create({ data: { name: 'TEST MALFORMED', userId: u.id } });
    try {
      // Hex "0x10" (Number→16), scientific "1e3" (Number→1000), "abc", "-5":
      // each MUST be absent (null), never coerced to a number. This would FAIL
      // against the old permissive parsePrice (which returned 16 / 1000 / -5).
      const buf = buildBuffer([
        HEADER,
        ['MAL-1', 'Malformed', '0x10', '1e3'],
        ['MAL-2', 'Malformed Abc', 'abc', '-5'],
      ]);
      const res = await importParameters({ clientId: c.id, fileBuffer: buf }, db);
      expect(res.created).toBe(2);

      const p1 = await db.product.findUnique({
        where: { clientId_skuCode: { clientId: c.id, skuCode: 'MAL-1' } },
      });
      expect(p1!.purchasePriceBase).toBeNull();
      expect(p1!.salePriceBase).toBeNull();

      const p2 = await db.product.findUnique({
        where: { clientId_skuCode: { clientId: c.id, skuCode: 'MAL-2' } },
      });
      expect(p2!.purchasePriceBase).toBeNull();
      expect(p2!.salePriceBase).toBeNull();
    } finally {
      await db.user.deleteMany({ where: { email } });
    }
  });

  it('over-range price is omitted with a warning; in-range price still writes', async () => {
    const email = 'test-parameters-import-overrange@example.com';
    await db.user.deleteMany({ where: { email } });
    const u = await db.user.create({ data: { email, passwordHash: 'x' } });
    const c = await db.client.create({ data: { name: 'TEST OVERRANGE', userId: u.id } });
    try {
      // 123456789012345 exceeds Decimal(12,2) → purchase omitted + warning.
      // 5.00 fits → sale still written. No throw.
      const buf = buildBuffer([HEADER, ['BIG-1', 'Too Big', '123456789012345', '5.00']]);
      const res = await importParameters({ clientId: c.id, fileBuffer: buf }, db);
      expect(res.created).toBe(1);
      expect(res.warnings.some((w) => w.includes('Too Big') && w.includes('fuera de rango'))).toBe(
        true,
      );

      const p = await db.product.findUnique({
        where: { clientId_skuCode: { clientId: c.id, skuCode: 'BIG-1' } },
      });
      expect(p!.purchasePriceBase).toBeNull();
      expect(p!.salePriceBase!.toString()).toBe('5');
    } finally {
      await db.user.deleteMany({ where: { email } });
    }
  });

  it('idempotency: importing the same buffer twice leaves state identical', async () => {
    const email = 'test-parameters-import-idem@example.com';
    await db.user.deleteMany({ where: { email } });
    const u = await db.user.create({ data: { email, passwordHash: 'x' } });
    const c = await db.client.create({ data: { name: 'TEST IDEM', userId: u.id } });
    try {
      const buf = buildBuffer([
        HEADER,
        ['IDEM-1', 'Idem One', '100.00', '150.00'],
        ['IDEM-2', 'Idem Two', '200.00', '250.00'],
      ]);
      const first = await importParameters({ clientId: c.id, fileBuffer: buf }, db);
      expect(first.created).toBe(2);

      const productsAfterFirst = await db.product.findMany({
        where: { clientId: c.id },
        orderBy: { skuCode: 'asc' },
      });

      const second = await importParameters({ clientId: c.id, fileBuffer: buf }, db);
      expect(second.created).toBe(0);
      expect(second.updated).toBe(2);

      const productsAfterSecond = await db.product.findMany({
        where: { clientId: c.id },
        orderBy: { skuCode: 'asc' },
      });

      expect(productsAfterSecond).toHaveLength(productsAfterFirst.length);
      for (let i = 0; i < productsAfterFirst.length; i++) {
        const a = productsAfterFirst[i];
        const b = productsAfterSecond[i];
        expect(b.skuCode).toBe(a.skuCode);
        expect(b.nameStandard).toBe(a.nameStandard);
        expect(b.purchasePriceBase!.toString()).toBe(a.purchasePriceBase!.toString());
        expect(b.salePriceBase!.toString()).toBe(a.salePriceBase!.toString());
      }
    } finally {
      await db.user.deleteMany({ where: { email } });
    }
  });
});
