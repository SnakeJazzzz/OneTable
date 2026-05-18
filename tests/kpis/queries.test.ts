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
// H1 SEMANTIC NOTE: per-store rows are classified individually via classifyAlert,
// then worst-case alert per (sku, chain) is returned. SUM-then-classify is gone.
//
//  SORIANA / A / store 001: sales 100 / $1000 / inv 20  → daysInv 6  → CRITICO
//  SORIANA / A / store 002: sales  50 / $ 500 / inv 10  → daysInv 6  → CRITICO
//    → worst-case (A, SORIANA) = CRITICO (both stores CRITICO; same result, new semantics)
//  SORIANA / B / store 001: sales  50 / $ 750 / inv 100 → daysInv 60  → OK
//  SORIANA / C / store 001: sales  10 / $ 100 / inv 100 → daysInv 300 → EXCESO
//  SORIANA / D / store 001: sales   0 / $   0 / inv 50  → daysInv NULL (salesUnits=0) → SIN_DATOS
//  SORIANA / E / store 001: sales 100 / $1000 / inv 0   → inv=0 → SIN_STOCK
//  SORIANA / UNMAPPED       sales  20 / $ 200 / inv 10  → daysInv 15 → ATENCION (productId=NULL)
//  AMAZON  / A             sales 200 / NULL  / inv 50  → daysInv 7.5 → RIESGO
//  AMAZON  / B             sales 100 / NULL  / inv 80  → daysInv 24  → OK
//
// H1 regression — multi-store mixed alerts:
//  SORIANA / F / store 001: sales   2 / $  20 / inv 10  → daysInv 150 → EXCESO
//  SORIANA / F / store 002: sales   5 / $  50 / inv 0   → inv=0 → SIN_STOCK
//    → worst-case (F, SORIANA) = SIN_STOCK; daysOfInv worst-case = 0
//
// H1 regression — negative inventory (accounting adjustment):
//  SORIANA / G / store 001: sales  10 / $ 100 / inv -3  → inv<=0 → SIN_STOCK
//  SORIANA / G / store 002: sales   2 / $  20 / inv 50  → daysInv 750 → EXCESO
//    → worst-case (G, SORIANA) = SIN_STOCK; daysOfInv worst-case = 0
//
// KPI expectations for 2025-03:
//   salesAmountMxn = 1000+500+750+100+0+1000+200 + 20+50+100+20 = 3740 (Amazon NULL excluded)
//   salesUnits     = 100+50+50+10+0+100+20+200+100 + 2+5+10+2 = 649
//   prev (2025-02) sum = $1000  → variationPct = (3740-1000)/1000*100 = 274
//   activeAlertsSkuCount = COUNT(DISTINCT productId) over alerts ∈ {SIN_STOCK, CRITICO, RIESGO}
//     H1 (KPI4): predicate is per-row; KPI4 uses `inventoryUnits <= 0` (H1) to count negatives.
//     Product A (CRITICO on SORIANA store 001, RIESGO on AMAZON) → counted once
//     Product E (SIN_STOCK on SORIANA store 001) → counted once
//     Product F (SIN_STOCK on SORIANA store 002) → counted once
//     Product G (SIN_STOCK on SORIANA store 001 via inv<=0) → counted once
//     Unmapped row CRITICO would not count (productId NULL); ours is ATENCION anyway.
//     Total = 4
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
  let productF: string;
  let productG: string;

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
    const pF = await db.product.create({ data: { clientId, nameStandard: 'PRODUCT F' } });
    const pG = await db.product.create({ data: { clientId, nameStandard: 'PRODUCT G' } });
    productA = pA.id;
    productB = pB.id;
    productC = pC.id;
    productD = pD.id;
    productE = pE.id;
    productF = pF.id;
    productG = pG.id;

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
        // H1 regression — multi-store mixed alerts (EXCESO + SIN_STOCK → worst-case SIN_STOCK)
        mkRow({ chain: 'SORIANA', productId: productF, portalRawProduct: 'PROD-F-SOR', storeId: '001', year: 2025, month: 3, salesUnits: 2,  salesAmountMxn: 20,  inventoryUnits: 10 }),
        mkRow({ chain: 'SORIANA', productId: productF, portalRawProduct: 'PROD-F-SOR', storeId: '002', year: 2025, month: 3, salesUnits: 5,  salesAmountMxn: 50,  inventoryUnits: 0 }),
        // H1 regression — negative inventory accounting adjustment (SIN_STOCK via inv<=0)
        mkRow({ chain: 'SORIANA', productId: productG, portalRawProduct: 'PROD-G-SOR', storeId: '001', year: 2025, month: 3, salesUnits: 10, salesAmountMxn: 100, inventoryUnits: -3 }),
        mkRow({ chain: 'SORIANA', productId: productG, portalRawProduct: 'PROD-G-SOR', storeId: '002', year: 2025, month: 3, salesUnits: 2,  salesAmountMxn: 20,  inventoryUnits: 50 }),
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

      // H1: F and G added 20+50+100+20=190 MXN, 2+5+10+2=19 units to the seed.
      expect(kpis.salesAmountMxn).toBe(3740);
      expect(kpis.salesUnits).toBe(649);
      // (3740 - 1000) / 1000 * 100 = 274
      expect(kpis.variationPct).toBeCloseTo(274, 5);
      // H1: KPI4 now uses `inventoryUnits <= 0` (was `= 0`). Distinct alerted SKUs:
      //   A (CRITICO), E (inv=0 → SIN_STOCK), F (inv=0 in store 002 → SIN_STOCK),
      //   G (inv=-3 in store 001 → SIN_STOCK via <= 0) = 4
      expect(kpis.activeAlertsSkuCount).toBe(4);
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
      // H1: SORIANA now includes F (7 units, $70) and G (12 units, $120) → 330+19=349, 3550+190=3740
      expect(byChain.SORIANA.salesUnits).toBe(349);
      expect(byChain.SORIANA.salesAmountMxn).toBe(3740);
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
      // H1: F + G added 190 MXN / 19 units to SORIANA 2025-03.
      expect(target?.salesAmountMxn).toBe(3740);
      expect(target?.salesUnits).toBe(349);
    });
  });

  describe('getInventorySemaforo', () => {
    it('classifies each store-row individually and returns worst-case alert per (product, chain)', async () => {
      const rows = await getInventorySemaforo(db, {
        clientId,
        userId,
        periodYear: 2025,
        periodMonth: 3,
      });

      // H1: worst-case folds per-store rows. Buckets:
      //   SORIANA: A, B, C, D, E, unmapped, F, G + AMAZON: A, B = 10
      expect(rows.length).toBe(10);

      const find = (productName: string, chain: Chain) =>
        rows.find((r) => r.productName === productName && r.chain === chain);

      // SEMANTIC NOTE (H1): A was CRITICO via SUM(30)/SUM(150)*30=6 pre-fix.
      // Post-fix: store 001 daysInv=6 (CRITICO), store 002 daysInv=6 (CRITICO) → worst=CRITICO.
      // Same value, different path.
      expect(find('PRODUCT A', 'SORIANA')?.alert).toBe('CRITICO');
      expect(find('PRODUCT B', 'SORIANA')?.alert).toBe('OK'); // single store, 100/50*30=60
      expect(find('PRODUCT C', 'SORIANA')?.alert).toBe('EXCESO'); // single store, 300
      expect(find('PRODUCT D', 'SORIANA')?.alert).toBe('SIN_DATOS'); // sales=0
      expect(find('PRODUCT E', 'SORIANA')?.alert).toBe('SIN_STOCK'); // inv=0
      expect(find('PROD-UNK', 'SORIANA')?.alert).toBe('ATENCION'); // 10/20*30=15
      expect(find('PRODUCT A', 'AMAZON')?.alert).toBe('RIESGO'); // 50/200*30=7.5
      expect(find('PRODUCT B', 'AMAZON')?.alert).toBe('OK'); // 80/100*30=24

      // H1 NEW: worst-case must surface the SIN_STOCK store, not dilute via SUM.
      //   Pre-fix would have computed SUM(10+0)=10 inv / SUM(2+5)=7 sales * 30 ≈ 42.9 → OK (BUG).
      expect(find('PRODUCT F', 'SORIANA')?.alert).toBe('SIN_STOCK');

      // H1 NEW: negative inventory in one store flags the SKU.
      //   Pre-fix would have computed SUM(-3+50)=47 inv / SUM(10+2)=12 sales * 30 ≈ 117.5 → EXCESO (BUG).
      expect(find('PRODUCT G', 'SORIANA')?.alert).toBe('SIN_STOCK');
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
    it('returns worst-case (lowest) daysOfInventory per SKU across stores', async () => {
      const rows = await getDaysOfInventoryBySku(db, {
        clientId,
        userId,
        periodYear: 2025,
        periodMonth: 3,
      });

      const find = (productName: string, chain: Chain) =>
        rows.find((r) => r.productName === productName && r.chain === chain);

      // SEMANTIC NOTE (H1): Product A pre-fix used SUM/SUM=30/150*30=6. Post-fix:
      // store 001 has inv/sales*30=20/100*30=6, store 002 has 10/50*30=6 → min=6.
      // Same value, but now reflecting the worst-case store (or tie).
      expect(find('PRODUCT A', 'SORIANA')?.daysOfInventory).toBeCloseTo(6, 5);
      expect(find('PRODUCT B', 'SORIANA')?.daysOfInventory).toBe(60);
      expect(find('PRODUCT C', 'SORIANA')?.daysOfInventory).toBe(300);
      expect(find('PRODUCT D', 'SORIANA')?.daysOfInventory).toBeNull(); // sales=0
      expect(find('PRODUCT A', 'AMAZON')?.daysOfInventory).toBeCloseTo(7.5, 5);

      // H1 NEW: F mixed = EXCESO store (10/2*30=150) + SIN_STOCK store (inv=0).
      //   Pre-fix: SUM(10+0)/SUM(2+5)*30 ≈ 42.9. Post-fix: 0 (the about-to-stockout store).
      expect(find('PRODUCT F', 'SORIANA')?.daysOfInventory).toBe(0);

      // H1 NEW: G negative-inv store contributes 0; the EXCESO store has 750.
      //   Post-fix worst-case = 0 (out today via accounting adjustment).
      expect(find('PRODUCT G', 'SORIANA')?.daysOfInventory).toBe(0);
    });
  });
});
