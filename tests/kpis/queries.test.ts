import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient, type Chain } from '@prisma/client';
import {
  getDashboardKpis,
  getSalesTrend,
  getSalesByChainForPeriod,
  getInventorySemaforo,
  getTopSkusByChain,
  getDaysOfInventoryBySku,
} from '@/core/kpis/queries';

const db = new PrismaClient();
const TEST_EMAIL = 'test-kpis-s8@example.com';

// Seed shape (current period = 2025-03):
//
//  SORIANA / A / store 001: sales 100 / $1000 / inv 20
//  SORIANA / A / store 002: sales  50 / $ 500 / inv 10  → aggregated 150 sales, 30 inv → daysInv 6  → CRITICO
//  SORIANA / B / store 001: sales  50 / $ 750 / inv 100 → daysInv 60  → OK
//  SORIANA / C / store 001: sales  10 / $ 100 / inv 100 → daysInv 300 → EXCESO
//  SORIANA / D / store 001: sales   0 / $   0 / inv 50  → daysInv NULL (salesUnits=0) → SIN_DATOS
//  SORIANA / E / store 001: sales 100 / $1000 / inv 0   → inv=0 → SIN_STOCK
//  SORIANA / UNMAPPED       sales  20 / $ 200 / inv 10  → daysInv 15 → ATENCION (productId=NULL)
//  AMAZON  / A             sales 200 / NULL  / inv 50  → daysInv 7.5 → RIESGO
//  AMAZON  / B             sales 100 / NULL  / inv 80  → daysInv 24  → OK
//
// KPI expectations for 2025-03:
//   salesAmountMxn = 1000+500+750+100+0+1000+200 = 3550 (Amazon NULL excluded)
//   salesUnits     = 100+50+50+10+0+100+20+200+100 = 630
//   prev (2025-02) sum = $1000  → variationPct = (3550-1000)/1000*100 = 255
//   activeAlertsSkuCount = COUNT(DISTINCT productId) over alerts ∈ {SIN_STOCK, CRITICO, RIESGO}
//     Product A (CRITICO on SORIANA, RIESGO on AMAZON) → counted once
//     Product E (SIN_STOCK on SORIANA) → counted once
//     Unmapped row CRITICO would not count (productId NULL); ours is ATENCION anyway.
//     Total = 2
//
// Trend (monthsBack=6 anchored to latest period = 2025-03):
//   2024-10 SORIANA / AMAZON (1 row each)
//   2024-11 SORIANA / AMAZON
//   2024-12 SORIANA / AMAZON
//   2025-01 SORIANA / AMAZON
//   2025-02 SORIANA (2 rows summing $1000) / AMAZON
//   2025-03 SORIANA (many) / AMAZON (2 rows)
//   → exactly 12 (chain, year, month) buckets

describe('KPI queries (S8) — integration against Neon', () => {
  let clientId: string;
  let userId: string;
  let productA: string;
  let productB: string;
  let productC: string;
  let productD: string;
  let productE: string;

  beforeAll(async () => {
    await db.user.deleteMany({ where: { email: TEST_EMAIL } });
    const u = await db.user.create({ data: { email: TEST_EMAIL, passwordHash: 'x' } });
    userId = u.id;
    const c = await db.client.create({ data: { name: 'TEST KPIS S8', userId } });
    clientId = c.id;

    const pA = await db.product.create({ data: { clientId, nameStandard: 'PRODUCT A' } });
    const pB = await db.product.create({ data: { clientId, nameStandard: 'PRODUCT B' } });
    const pC = await db.product.create({ data: { clientId, nameStandard: 'PRODUCT C' } });
    const pD = await db.product.create({ data: { clientId, nameStandard: 'PRODUCT D' } });
    const pE = await db.product.create({ data: { clientId, nameStandard: 'PRODUCT E' } });
    productA = pA.id;
    productB = pB.id;
    productC = pC.id;
    productD = pD.id;
    productE = pE.id;

    const upload = await db.upload.create({
      data: {
        clientId,
        userId,
        chain: 'SORIANA' as Chain,
        fileType: 'MIXED',
        originalFilename: 'kpi-seed.xlsx',
        fileHash: 'kpi-seed-h1',
        fileSizeBytes: 1,
      },
    });

    const mkRow = (data: {
      chain: Chain;
      productId: string | null;
      portalRawProduct: string;
      storeId: string | null;
      year: number;
      month: number;
      salesUnits: number | null;
      salesAmountMxn: number | null;
      inventoryUnits: number | null;
    }) => ({
      clientId,
      userId,
      uploadId: upload.id,
      chain: data.chain,
      productId: data.productId,
      portalRawProduct: data.portalRawProduct,
      storeId: data.storeId,
      storeName: null,
      storeFormat: null,
      periodYear: data.year,
      periodMonth: data.month,
      periodDate: null,
      salesUnits: data.salesUnits,
      salesAmountMxn: data.salesAmountMxn,
      inventoryUnits: data.inventoryUnits,
    });

    // ---- Current period 2025-03 ----
    await db.selloutData.createMany({
      data: [
        mkRow({ chain: 'SORIANA', productId: productA, portalRawProduct: 'PROD-A-SOR', storeId: '001', year: 2025, month: 3, salesUnits: 100, salesAmountMxn: 1000, inventoryUnits: 20 }),
        mkRow({ chain: 'SORIANA', productId: productA, portalRawProduct: 'PROD-A-SOR', storeId: '002', year: 2025, month: 3, salesUnits: 50, salesAmountMxn: 500, inventoryUnits: 10 }),
        mkRow({ chain: 'SORIANA', productId: productB, portalRawProduct: 'PROD-B-SOR', storeId: '001', year: 2025, month: 3, salesUnits: 50, salesAmountMxn: 750, inventoryUnits: 100 }),
        mkRow({ chain: 'SORIANA', productId: productC, portalRawProduct: 'PROD-C-SOR', storeId: '001', year: 2025, month: 3, salesUnits: 10, salesAmountMxn: 100, inventoryUnits: 100 }),
        mkRow({ chain: 'SORIANA', productId: productD, portalRawProduct: 'PROD-D-SOR', storeId: '001', year: 2025, month: 3, salesUnits: 0,  salesAmountMxn: 0,   inventoryUnits: 50  }),
        mkRow({ chain: 'SORIANA', productId: productE, portalRawProduct: 'PROD-E-SOR', storeId: '001', year: 2025, month: 3, salesUnits: 100, salesAmountMxn: 1000, inventoryUnits: 0 }),
        mkRow({ chain: 'SORIANA', productId: null,     portalRawProduct: 'PROD-UNK',  storeId: '001', year: 2025, month: 3, salesUnits: 20, salesAmountMxn: 200, inventoryUnits: 10 }),
        mkRow({ chain: 'AMAZON',  productId: productA, portalRawProduct: 'ASIN-A',    storeId: null,  year: 2025, month: 3, salesUnits: 200, salesAmountMxn: null, inventoryUnits: 50 }),
        mkRow({ chain: 'AMAZON',  productId: productB, portalRawProduct: 'ASIN-B',    storeId: null,  year: 2025, month: 3, salesUnits: 100, salesAmountMxn: null, inventoryUnits: 80 }),
      ],
    });

    // ---- Previous period 2025-02 (for variation) ----
    await db.selloutData.createMany({
      data: [
        mkRow({ chain: 'SORIANA', productId: productA, portalRawProduct: 'PROD-A-SOR', storeId: '001', year: 2025, month: 2, salesUnits: 60, salesAmountMxn: 600, inventoryUnits: 50 }),
        mkRow({ chain: 'SORIANA', productId: productB, portalRawProduct: 'PROD-B-SOR', storeId: '001', year: 2025, month: 2, salesUnits: 30, salesAmountMxn: 400, inventoryUnits: 80 }),
        mkRow({ chain: 'AMAZON',  productId: productA, portalRawProduct: 'ASIN-A',    storeId: null,  year: 2025, month: 2, salesUnits: 50, salesAmountMxn: null, inventoryUnits: 30 }),
      ],
    });

    // ---- Trend buckets 2024-10..2025-01 (1 row per chain per month) ----
    const trendBuckets: Array<[number, number]> = [
      [2024, 10],
      [2024, 11],
      [2024, 12],
      [2025, 1],
    ];
    for (const [year, month] of trendBuckets) {
      await db.selloutData.createMany({
        data: [
          mkRow({ chain: 'SORIANA', productId: productA, portalRawProduct: 'PROD-A-SOR', storeId: '001', year, month, salesUnits: 10 * month, salesAmountMxn: 100 * month, inventoryUnits: 10 }),
          mkRow({ chain: 'AMAZON',  productId: productA, portalRawProduct: 'ASIN-A',    storeId: null,  year, month, salesUnits: 5 * month, salesAmountMxn: null, inventoryUnits: 5 }),
        ],
      });
    }
  });

  afterAll(async () => {
    await db.user.deleteMany({ where: { email: TEST_EMAIL } });
    await db.$disconnect();
  });

  describe('getDashboardKpis', () => {
    it('returns 4 KPI values for current period 2025-03', async () => {
      const kpis = await getDashboardKpis(db, {
        clientId,
        userId,
        periodYear: 2025,
        periodMonth: 3,
      });

      expect(kpis.salesAmountMxn).toBe(3550);
      expect(kpis.salesUnits).toBe(630);
      // (3550 - 1000) / 1000 * 100 = 255
      expect(kpis.variationPct).toBeCloseTo(255, 5);
      expect(kpis.activeAlertsSkuCount).toBe(2);
    });

    it('returns variationPct=null when previous period has no data', async () => {
      const kpis = await getDashboardKpis(db, {
        clientId,
        userId,
        periodYear: 2024,
        periodMonth: 10, // no 2024-09 data
      });
      expect(kpis.variationPct).toBeNull();
    });

    it('handles January rollover (prev = previous year December)', async () => {
      // current = 2025-01, prev = 2024-12
      const kpis = await getDashboardKpis(db, {
        clientId,
        userId,
        periodYear: 2025,
        periodMonth: 1,
      });
      // 2025-01 SORIANA sales = 100*1=100, AMAZON null → total $ = 100
      // 2024-12 SORIANA sales = 100*12=1200, AMAZON null → total $ = 1200
      // variation = (100-1200)/1200*100 ≈ -91.666
      expect(kpis.salesAmountMxn).toBe(100);
      expect(kpis.variationPct).toBeCloseTo(-91.6667, 3);
    });
  });

  describe('getSalesByChainForPeriod', () => {
    it('groups by chain for 2025-03', async () => {
      const rows = await getSalesByChainForPeriod(db, {
        clientId,
        userId,
        periodYear: 2025,
        periodMonth: 3,
      });

      const byChain = Object.fromEntries(rows.map((r) => [r.chain, r]));
      expect(byChain.SORIANA.salesUnits).toBe(330);
      expect(byChain.SORIANA.salesAmountMxn).toBe(3550);
      expect(byChain.AMAZON.salesUnits).toBe(300);
      expect(byChain.AMAZON.salesAmountMxn).toBe(0); // all NULL collapses to 0
    });
  });

  describe('getSalesTrend', () => {
    it('returns 6-month trend × 2 chains anchored to latest period', async () => {
      const rows = await getSalesTrend(db, { clientId, userId, monthsBack: 6 });
      expect(rows.length).toBe(12); // 6 months × 2 chains
      // sorted ascending by year, month, then chain
      expect(rows[0].periodYear).toBe(2024);
      expect(rows[0].periodMonth).toBe(10);
      expect(rows[rows.length - 1].periodYear).toBe(2025);
      expect(rows[rows.length - 1].periodMonth).toBe(3);
    });

    it('SORIANA 2025-03 trend point matches sum', async () => {
      const rows = await getSalesTrend(db, { clientId, userId, monthsBack: 6 });
      const target = rows.find(
        (r) => r.chain === 'SORIANA' && r.periodYear === 2025 && r.periodMonth === 3,
      );
      expect(target?.salesAmountMxn).toBe(3550);
      expect(target?.salesUnits).toBe(330);
    });
  });

  describe('getInventorySemaforo', () => {
    it('aggregates inventoryUnits + salesUnits across stores per (product, chain) and classifies alert', async () => {
      const rows = await getInventorySemaforo(db, {
        clientId,
        userId,
        periodYear: 2025,
        periodMonth: 3,
      });

      // Expected rows: 6 SORIANA (A, B, C, D, E, unmapped) + 2 AMAZON (A, B) = 8
      expect(rows.length).toBe(8);

      const find = (productName: string, chain: Chain) =>
        rows.find((r) => r.productName === productName && r.chain === chain);

      expect(find('PRODUCT A', 'SORIANA')?.alert).toBe('CRITICO'); // 30/150*30=6
      expect(find('PRODUCT B', 'SORIANA')?.alert).toBe('OK'); // 100/50*30=60
      expect(find('PRODUCT C', 'SORIANA')?.alert).toBe('EXCESO'); // 300
      expect(find('PRODUCT D', 'SORIANA')?.alert).toBe('SIN_DATOS'); // sales=0
      expect(find('PRODUCT E', 'SORIANA')?.alert).toBe('SIN_STOCK'); // inv=0
      expect(find('PROD-UNK', 'SORIANA')?.alert).toBe('ATENCION'); // 10/20*30=15
      expect(find('PRODUCT A', 'AMAZON')?.alert).toBe('RIESGO'); // 50/200*30=7.5
      expect(find('PRODUCT B', 'AMAZON')?.alert).toBe('OK'); // 80/100*30=24
    });

    it('preserves productId=null for unmapped rows', async () => {
      const rows = await getInventorySemaforo(db, {
        clientId,
        userId,
        periodYear: 2025,
        periodMonth: 3,
      });
      const unmapped = rows.find((r) => r.productName === 'PROD-UNK');
      expect(unmapped?.productId).toBeNull();
    });
  });

  describe('getTopSkusByChain', () => {
    it('respects limit per chain and orders desc by salesUnits', async () => {
      const rows = await getTopSkusByChain(db, {
        clientId,
        userId,
        periodYear: 2025,
        periodMonth: 3,
        limit: 2,
      });

      const soriana = rows.filter((r) => r.chain === 'SORIANA');
      const amazon = rows.filter((r) => r.chain === 'AMAZON');
      expect(soriana.length).toBe(2);
      expect(amazon.length).toBe(2);

      // SORIANA top 2 (by sum salesUnits across stores):
      //   A=150, E=100, B=50, unmapped=20, C=10, D=0 → top 2 = A, E
      expect(soriana[0].productName).toBe('PRODUCT A');
      expect(soriana[0].salesUnits).toBe(150);
      expect(soriana[1].productName).toBe('PRODUCT E');
      expect(soriana[1].salesUnits).toBe(100);

      // AMAZON top 2: A=200, B=100
      expect(amazon[0].productName).toBe('PRODUCT A');
      expect(amazon[0].salesUnits).toBe(200);
      expect(amazon[1].productName).toBe('PRODUCT B');
      expect(amazon[1].salesUnits).toBe(100);
    });
  });

  describe('getDaysOfInventoryBySku', () => {
    it('computes daysOfInventory at query using inv/sales*30 (AJUSTE 1)', async () => {
      const rows = await getDaysOfInventoryBySku(db, {
        clientId,
        userId,
        periodYear: 2025,
        periodMonth: 3,
      });

      const find = (productName: string, chain: Chain) =>
        rows.find((r) => r.productName === productName && r.chain === chain);

      expect(find('PRODUCT A', 'SORIANA')?.daysOfInventory).toBeCloseTo(6, 5); // 30/150*30
      expect(find('PRODUCT B', 'SORIANA')?.daysOfInventory).toBe(60);
      expect(find('PRODUCT C', 'SORIANA')?.daysOfInventory).toBe(300);
      expect(find('PRODUCT D', 'SORIANA')?.daysOfInventory).toBeNull(); // sales=0
      expect(find('PRODUCT A', 'AMAZON')?.daysOfInventory).toBeCloseTo(7.5, 5);
    });
  });
});
