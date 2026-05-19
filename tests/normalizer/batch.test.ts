import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient, type Chain, type FileType } from '@prisma/client';
import { normalize } from '@/core/normalizer';
import type { ParsedRow, ParserResult } from '@/core/parsers/types';

/**
 * H2 — Batched normalizer regression tests.
 *
 * Covers:
 *   1. Perf budget (3,000 synthetic rows < 60s).
 *   2. Batch boundary correctness (1,499 / 1,500 / 1,501 rows).
 *   3. Mapping cache: zero ProductMapping queries during normalize.
 *   4. COALESCE preservation across batched UPSERT (NULLs from inv-only
 *      upload don't wipe previously-stored ventas values).
 *   5. Idempotency at scale (re-upload → all updates, no inserts).
 *
 * Isolated by `TEST_EMAIL` — does NOT collide with normalize.test.ts or
 * the demo seed.
 */

const db = new PrismaClient();
const TEST_EMAIL = 'test-h2-batch@example.com';

const CHAIN: Chain = 'SORIANA';
const FILE_TYPE: FileType = 'MIXED';

function syntheticParserResult(rowCount: number, fingerprint: string): ParserResult {
  const rows: ParsedRow[] = [];
  for (let i = 0; i < rowCount; i++) {
    rows.push({
      periodYear: 2026,
      periodMonth: 1,
      portalRawProduct: `${fingerprint}-PROD-${i}`,
      // Vary storeId across rows to keep all unique on the
      // (clientId, chain, storeId, portalRawProduct, periodYear, periodMonth) key
      // even though portalRawProduct is already unique. Tests both axes.
      storeId: `S${(i % 10).toString().padStart(4, '0')}`,
      storeName: `STORE ${i % 10}`,
      storeFormat: null,
      salesUnits: i + 1,
      salesAmountMxn: (i + 1) * 10,
      inventoryUnits: i % 7,
    });
  }
  return {
    metadata: {
      chain: CHAIN,
      fileType: FILE_TYPE,
      originalFilename: `synth-${fingerprint}.xlsx`,
      fileHash: `hash-${fingerprint}`,
      fileSizeBytes: 1,
      rowCount,
    },
    rows,
    warnings: [],
  };
}

describe('normalize() batched UPSERT (H2)', () => {
  let clientId: string;
  let userId: string;

  beforeAll(async () => {
    await db.user.deleteMany({ where: { email: TEST_EMAIL } });
    const u = await db.user.create({ data: { email: TEST_EMAIL, passwordHash: 'x' } });
    userId = u.id;
    const c = await db.client.create({ data: { name: 'TEST H2 BATCH', userId } });
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
    await db.productMapping.deleteMany({ where: { clientId } });
    await db.product.deleteMany({ where: { clientId } });
  });

  it('processes 3,000 synthetic rows in under 60s (perf budget)', async () => {
    const upload = await db.upload.create({
      data: {
        clientId,
        userId,
        chain: CHAIN,
        fileType: FILE_TYPE,
        originalFilename: 'synth-3000.xlsx',
        fileHash: 'h-3000',
        fileSizeBytes: 1,
      },
    });
    const parsed = syntheticParserResult(3000, 'perf');

    const t0 = Date.now();
    const stats = await normalize(
      { clientId, userId, uploadId: upload.id, parserResult: parsed, mappingLookup: () => null },
      db,
    );
    const elapsed = Date.now() - t0;

    expect(stats.rowsTotal).toBe(3000);
    expect(stats.rowsInserted).toBe(3000);
    expect(stats.rowsUpdated).toBe(0);
    expect(elapsed).toBeLessThan(60_000);
    if (elapsed > 30_000) {
      // Soft warning, not a fail.
      // eslint-disable-next-line no-console
      console.warn(
        `[batch.test.ts] ⚠ SOFT-WARN: 3,000-row normalize took ${elapsed}ms (>30s). ` +
          `Investigate Neon latency or batch size.`,
      );
    }
  });

  it.each([1499, 1500, 1501])(
    'normalizes exactly %d rows correctly across batch boundaries',
    async (rowCount) => {
      const upload = await db.upload.create({
        data: {
          clientId,
          userId,
          chain: CHAIN,
          fileType: FILE_TYPE,
          originalFilename: `synth-${rowCount}.xlsx`,
          fileHash: `h-${rowCount}`,
          fileSizeBytes: 1,
        },
      });
      const parsed = syntheticParserResult(rowCount, `b${rowCount}`);
      const stats = await normalize(
        { clientId, userId, uploadId: upload.id, parserResult: parsed, mappingLookup: () => null },
        db,
      );
      expect(stats.rowsTotal).toBe(rowCount);
      expect(stats.rowsInserted).toBe(rowCount);
      expect(stats.rowsUpdated).toBe(0);
      const dbCount = await db.selloutData.count({ where: { clientId } });
      expect(dbCount).toBe(rowCount);
    },
  );

  it('resolves mappings without per-row DB hits (mappingLookup is pre-resolved JS)', async () => {
    // Insert 1 mapping; build 1,000 rows referencing same portalRawProduct.
    const product = await db.product.create({
      data: { clientId, nameStandard: 'TEST-MAPPED-PRODUCT' },
    });
    await db.productMapping.create({
      data: { clientId, productId: product.id, chain: CHAIN, portalString: 'MAPPED-PROD' },
    });

    const upload = await db.upload.create({
      data: {
        clientId,
        userId,
        chain: CHAIN,
        fileType: FILE_TYPE,
        originalFilename: 'synth-mapped.xlsx',
        fileHash: 'h-mapped',
        fileSizeBytes: 1,
      },
    });
    const rows: ParsedRow[] = [];
    for (let i = 0; i < 1000; i++) {
      rows.push({
        periodYear: 2026,
        periodMonth: 1,
        portalRawProduct: 'MAPPED-PROD',
        storeId: `S${i.toString().padStart(4, '0')}`,
        storeName: null,
        storeFormat: null,
        salesUnits: 1,
      });
    }
    const parsed: ParserResult = {
      metadata: {
        chain: CHAIN,
        fileType: FILE_TYPE,
        originalFilename: 'synth-mapped.xlsx',
        fileHash: 'h-mapped',
        fileSizeBytes: 1,
        rowCount: 1000,
      },
      rows,
      warnings: [],
    };

    // Pre-resolved Map → JS closure. No DB hit per row by design.
    const mappingMap = new Map<string, string>([[`${CHAIN}:MAPPED-PROD`, product.id]]);

    // Track all SQL queries made during normalize().
    const queries: string[] = [];
    // Prisma 6 supports `$on('query', ...)` only when the client is constructed
    // with `log: ['query']`. Use a lightweight `$use` middleware instead — works
    // on the default client. NB: middleware runs for `findUnique`/`findFirst`
    // /etc. but NOT for $queryRaw — which is desirable here: we only care
    // whether a per-row mapping fetch was issued.
    const probe = new PrismaClient({ log: ['query'] as never });
    // We cannot easily reuse `db` for `$on('query', …)` after construction,
    // so swap to a probe client just for this assertion.
    probe.$on('query' as never, ((e: { query: string }) => {
      queries.push(e.query);
    }) as never);

    await normalize(
      {
        clientId,
        userId,
        uploadId: upload.id,
        parserResult: parsed,
        mappingLookup: (chain, portalString) => mappingMap.get(`${chain}:${portalString}`) ?? null,
      },
      probe,
    );
    await probe.$disconnect();

    const productMappingQueries = queries.filter(
      (q) => q.includes('"ProductMapping"') || q.includes('ProductMapping'),
    );
    // Zero — mappingLookup is a pre-resolved JS Map.get, not a DB call.
    expect(productMappingQueries).toHaveLength(0);
  });

  it('preserves COALESCE merge across batched UPSERT (inv-only after ventas-only)', async () => {
    const u1 = await db.upload.create({
      data: {
        clientId,
        userId,
        chain: CHAIN,
        fileType: 'VENTAS',
        originalFilename: 'v.xlsx',
        fileHash: 'v',
        fileSizeBytes: 1,
      },
    });
    const u2 = await db.upload.create({
      data: {
        clientId,
        userId,
        chain: CHAIN,
        fileType: 'INVENTARIO',
        originalFilename: 'i.xlsx',
        fileHash: 'i',
        fileSizeBytes: 1,
      },
    });

    // 600 rows (forces ≥1 batch boundary at 500). All share the same period
    // and have different storeIds → unique per row.
    const ventasRows: ParsedRow[] = [];
    const invRows: ParsedRow[] = [];
    for (let i = 0; i < 600; i++) {
      const storeId = `STR${i.toString().padStart(4, '0')}`;
      ventasRows.push({
        periodYear: 2026,
        periodMonth: 1,
        portalRawProduct: 'CO-PRODUCT',
        storeId,
        storeName: null,
        storeFormat: null,
        salesUnits: 5,
        salesAmountMxn: 100,
        // inventoryUnits intentionally absent
      });
      invRows.push({
        periodYear: 2026,
        periodMonth: 1,
        portalRawProduct: 'CO-PRODUCT',
        storeId,
        storeName: null,
        storeFormat: null,
        // salesUnits/salesAmountMxn intentionally absent
        inventoryUnits: 10,
      });
    }

    const ventasParsed: ParserResult = {
      metadata: {
        chain: CHAIN,
        fileType: 'VENTAS',
        originalFilename: 'v.xlsx',
        fileHash: 'v',
        fileSizeBytes: 1,
        rowCount: 600,
      },
      rows: ventasRows,
      warnings: [],
    };
    const invParsed: ParserResult = {
      metadata: {
        chain: CHAIN,
        fileType: 'INVENTARIO',
        originalFilename: 'i.xlsx',
        fileHash: 'i',
        fileSizeBytes: 1,
        rowCount: 600,
      },
      rows: invRows,
      warnings: [],
    };

    await normalize(
      { clientId, userId, uploadId: u1.id, parserResult: ventasParsed, mappingLookup: () => null },
      db,
    );
    const stats2 = await normalize(
      { clientId, userId, uploadId: u2.id, parserResult: invParsed, mappingLookup: () => null },
      db,
    );

    expect(stats2.rowsInserted).toBe(0);
    expect(stats2.rowsUpdated).toBe(600);

    const sample = await db.selloutData.findFirst({
      where: { clientId, portalRawProduct: 'CO-PRODUCT', storeId: 'STR0000' },
    });
    expect(sample).not.toBeNull();
    expect(sample!.salesUnits).toBe(5); // preserved
    expect(sample!.salesAmountMxn?.toNumber()).toBe(100); // preserved
    expect(sample!.inventoryUnits).toBe(10); // new value

    // Also verify total count is consistent.
    const total = await db.selloutData.count({ where: { clientId } });
    expect(total).toBe(600);
  });

  it('is idempotent at scale (1,500 rows re-uploaded → all updates, zero inserts)', async () => {
    const u1 = await db.upload.create({
      data: {
        clientId,
        userId,
        chain: CHAIN,
        fileType: FILE_TYPE,
        originalFilename: 'idem.xlsx',
        fileHash: 'idem1',
        fileSizeBytes: 1,
      },
    });
    const u2 = await db.upload.create({
      data: {
        clientId,
        userId,
        chain: CHAIN,
        fileType: FILE_TYPE,
        originalFilename: 'idem.xlsx',
        fileHash: 'idem2',
        fileSizeBytes: 1,
      },
    });
    const parsed = syntheticParserResult(1500, 'idem');

    const stats1 = await normalize(
      { clientId, userId, uploadId: u1.id, parserResult: parsed, mappingLookup: () => null },
      db,
    );
    expect(stats1.rowsInserted).toBe(1500);
    expect(stats1.rowsUpdated).toBe(0);

    const stats2 = await normalize(
      { clientId, userId, uploadId: u2.id, parserResult: parsed, mappingLookup: () => null },
      db,
    );
    expect(stats2.rowsInserted).toBe(0);
    expect(stats2.rowsUpdated).toBe(1500);

    const total = await db.selloutData.count({ where: { clientId } });
    expect(total).toBe(1500);
  });
});
