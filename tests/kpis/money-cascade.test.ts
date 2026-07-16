import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient, type Chain } from '@prisma/client';
import {
  getDashboardKpis,
  getSalesTrend,
  getSalesByChainForPeriod,
  getOneTableRows,
} from '@/core/kpis/queries';
import { DEFAULT_CUTS } from '@/core/alerts/classify';

const db = new PrismaClient();
const TEST_EMAIL = 'b5-money-cascade@test.local';

// B-1 §7 money cascade — integration against the shared dev DB.
//
// Per-row sale amount = COALESCE(file amount, units × override.salePrice,
// units × salePriceBase) → NULL. Never fabricated. Verified against both
// aggregate functions (getDashboardKpis / getSalesByChainForPeriod /
// getSalesTrend) and the per-row form (getOneTableRows).
//
// Seed shape — current period 2026-05:
//   P1: base 50.00, SORIANA override 80.00
//   P2: base 40.00, SORIANA override 70.00
//   P3: base 30.00, no override
//   P4: no base, no override
//   P5: no base, SORIANA override 25.00
//   P6: base 60.00, SORIANA override purchase-only (purchase 99.00, sale NULL)
//
//   Row A: SORIANA P1  amount 1234.56, units 10 → FILE wins → 1234.56 (not 800)
//   Row B: SORIANA P2  amount NULL,    units 10 → OVERRIDE  → 700.00
//   Row C: SORIANA P3  amount NULL,    units 10 → BASE      → 300.00
//   Row D: SORIANA P4  amount NULL,    units 10 → NULL (all 3 levels missing)
//   Row E: SORIANA P5  amount NULL,    units NULL → NULL (override present but
//          no units — derived branches propagate NULL, nothing fabricated)
//   Row F: SORIANA unmapped (productId NULL) amount 500, units 5 → still sums
//          (pins LEFT JOIN — an INNER would silently drop this row)
//   Row G: AMAZON  P2  amount NULL,    units 10 → BASE → 400.00 (override is
//          SORIANA-scoped; pins the ppo.chain = sd.chain join condition)
//   Row H: SORIANA P6  amount NULL,    units 10 → BASE → 600.00 (purchase-only
//          override row EXISTS but its salePrice is NULL — a legal state per
//          schema — so the sale cascade must fall through to base, B5-2)
//
//   SORIANA total = 1234.56 + 700 + 300 + 500 + 600 = 3334.56
//   AMAZON  total = 400
//   Grand   total = 3734.56 · units = 10+10+10+10+5+10+10 = 65 (E units NULL)
//
// Previous period 2026-04 (pins cascade on the PREV side of getDashboardKpis):
//   SORIANA P2 amount NULL, units 4 → override → 280.00
//   variationPct = (3734.56 - 280) / 280 * 100 ≈ 1233.7714
describe('§7 money cascade (B-1) — integration against dev DB', () => {
  let clientId: string;
  let userId: string;

  beforeAll(async () => {
    await db.user.deleteMany({ where: { email: TEST_EMAIL } });
    const u = await db.user.create({ data: { email: TEST_EMAIL, passwordHash: 'x' } });
    userId = u.id;
    const c = await db.client.create({ data: { name: 'TEST B5 MONEY', userId } });
    clientId = c.id;

    const p1 = await db.product.create({
      data: { clientId, nameStandard: 'CASCADE P1', skuCode: 'B5M-P1', salePriceBase: '50.00' },
    });
    const p2 = await db.product.create({
      data: { clientId, nameStandard: 'CASCADE P2', skuCode: 'B5M-P2', salePriceBase: '40.00' },
    });
    const p3 = await db.product.create({
      data: { clientId, nameStandard: 'CASCADE P3', skuCode: 'B5M-P3', salePriceBase: '30.00' },
    });
    const p4 = await db.product.create({
      data: { clientId, nameStandard: 'CASCADE P4', skuCode: 'B5M-P4' },
    });
    const p5 = await db.product.create({
      data: { clientId, nameStandard: 'CASCADE P5', skuCode: 'B5M-P5' },
    });
    const p6 = await db.product.create({
      data: { clientId, nameStandard: 'CASCADE P6', skuCode: 'B5M-P6', salePriceBase: '60.00' },
    });

    await db.productPriceOverride.createMany({
      data: [
        { productId: p1.id, chain: 'SORIANA' as Chain, salePrice: '80.00' },
        { productId: p2.id, chain: 'SORIANA' as Chain, salePrice: '70.00' },
        { productId: p5.id, chain: 'SORIANA' as Chain, salePrice: '25.00' },
        // Purchase-only override (legal per schema): salePrice NULL must make
        // the sale cascade fall through to base, not to NULL (B5-2).
        { productId: p6.id, chain: 'SORIANA' as Chain, purchasePrice: '99.00', salePrice: null },
      ],
    });

    const upload = await db.upload.create({
      data: {
        clientId,
        userId,
        chain: 'SORIANA' as Chain,
        fileType: 'MIXED',
        originalFilename: 'b5-money-seed.xlsx',
        fileHash: 'b5-money-seed',
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
      inventoryUnits: null,
    });

    // ---- Current period 2026-05 ----
    await db.selloutData.createMany({
      data: [
        mkRow({ chain: 'SORIANA', productId: p1.id, portalRawProduct: 'B5M-ROW-A', storeId: '001', year: 2026, month: 5, salesUnits: 10, salesAmountMxn: 1234.56 }),
        mkRow({ chain: 'SORIANA', productId: p2.id, portalRawProduct: 'B5M-ROW-B', storeId: '001', year: 2026, month: 5, salesUnits: 10, salesAmountMxn: null }),
        mkRow({ chain: 'SORIANA', productId: p3.id, portalRawProduct: 'B5M-ROW-C', storeId: '001', year: 2026, month: 5, salesUnits: 10, salesAmountMxn: null }),
        mkRow({ chain: 'SORIANA', productId: p4.id, portalRawProduct: 'B5M-ROW-D', storeId: '001', year: 2026, month: 5, salesUnits: 10, salesAmountMxn: null }),
        mkRow({ chain: 'SORIANA', productId: p5.id, portalRawProduct: 'B5M-ROW-E', storeId: '001', year: 2026, month: 5, salesUnits: null, salesAmountMxn: null }),
        mkRow({ chain: 'SORIANA', productId: null,  portalRawProduct: 'B5M-ROW-F', storeId: '001', year: 2026, month: 5, salesUnits: 5,  salesAmountMxn: 500 }),
        mkRow({ chain: 'AMAZON',  productId: p2.id, portalRawProduct: 'B5M-ROW-G', storeId: null,  year: 2026, month: 5, salesUnits: 10, salesAmountMxn: null }),
        mkRow({ chain: 'SORIANA', productId: p6.id, portalRawProduct: 'B5M-ROW-H', storeId: '001', year: 2026, month: 5, salesUnits: 10, salesAmountMxn: null }),
      ],
    });

    // ---- Previous period 2026-04 (prev-side cascade pin) ----
    await db.selloutData.createMany({
      data: [
        mkRow({ chain: 'SORIANA', productId: p2.id, portalRawProduct: 'B5M-ROW-B', storeId: '001', year: 2026, month: 4, salesUnits: 4, salesAmountMxn: null }),
      ],
    });
  });

  afterAll(async () => {
    // Cascade from User wipes Client → Product → overrides / SelloutData / Upload.
    await db.user.deleteMany({ where: { email: TEST_EMAIL } });
    await db.$disconnect();
  });

  describe('getOneTableRows (per-row cascade)', () => {
    it('resolves each cascade level per row and never fabricates', async () => {
      const rows = await getOneTableRows(
        db,
        { clientId, userId, periodYear: 2026, periodMonth: 5 },
        DEFAULT_CUTS,
      );
      const byRaw = Object.fromEntries(rows.map((r) => [r.portalRawProduct, r]));

      // Level 1 — file amount wins over an existing override (80 × 10 = 800 loses).
      expect(byRaw['B5M-ROW-A'].salesAmountMxn).toBeCloseTo(1234.56, 2);
      // Level 2 — override wins over base (70 × 10, not 40 × 10).
      expect(byRaw['B5M-ROW-B'].salesAmountMxn).toBeCloseTo(700, 2);
      // Level 3 — base only.
      expect(byRaw['B5M-ROW-C'].salesAmountMxn).toBeCloseTo(300, 2);
      // Level 4 — all three levels missing → null, never 0.
      expect(byRaw['B5M-ROW-D'].salesAmountMxn).toBeNull();
      // salesUnits NULL with override present → derived branches NULL → null.
      expect(byRaw['B5M-ROW-E'].salesAmountMxn).toBeNull();
      // productId NULL keeps its file amount (LEFT JOIN, row not dropped).
      expect(byRaw['B5M-ROW-F'].salesAmountMxn).toBeCloseTo(500, 2);
      // Override is chain-scoped: AMAZON row for P2 falls to base (40 × 10).
      expect(byRaw['B5M-ROW-G'].salesAmountMxn).toBeCloseTo(400, 2);
      // Purchase-only override row: salePrice NULL → cascade FALLS TO BASE
      // (60 × 10), not to NULL — the row's existence must not short-circuit.
      expect(byRaw['B5M-ROW-H'].salesAmountMxn).toBeCloseTo(600, 2);
    });
  });

  describe('getSalesByChainForPeriod (aggregate cascade)', () => {
    it('sums the cascade per chain, keeps unmapped rows, scopes overrides by chain', async () => {
      const rows = await getSalesByChainForPeriod(db, {
        clientId,
        userId,
        periodYear: 2026,
        periodMonth: 5,
      });
      const byChain = Object.fromEntries(rows.map((r) => [r.chain, r]));

      // 1234.56 (file) + 700 (override) + 300 (base) + 500 (unmapped file) +
      // 600 (purchase-only override → base) = 3334.56 — D and E contribute
      // nothing (NULL, never 0).
      expect(byChain.SORIANA.salesAmountMxn).toBeCloseTo(3334.56, 2);
      // AMAZON uses base (override is SORIANA-only): 400.
      expect(byChain.AMAZON.salesAmountMxn).toBeCloseTo(400, 2);
    });
  });

  describe('getSalesTrend (aggregate cascade per point)', () => {
    it('applies the cascade to each trend point', async () => {
      const rows = await getSalesTrend(db, { clientId, userId, monthsBack: 2 });
      const find = (chain: Chain, y: number, m: number) =>
        rows.find((r) => r.chain === chain && r.periodYear === y && r.periodMonth === m);

      expect(find('SORIANA', 2026, 5)?.salesAmountMxn).toBeCloseTo(3334.56, 2);
      expect(find('AMAZON', 2026, 5)?.salesAmountMxn).toBeCloseTo(400, 2);
      // 2026-04 point is pure override-derived (4 × 70 = 280).
      expect(find('SORIANA', 2026, 4)?.salesAmountMxn).toBeCloseTo(280, 2);
    });
  });

  describe('getDashboardKpis (cascade on BOTH periods)', () => {
    it('cascades the current aggregate and units', async () => {
      const kpis = await getDashboardKpis(
        db,
        { clientId, userId, periodYear: 2026, periodMonth: 5 },
        DEFAULT_CUTS,
      );
      expect(kpis.salesAmountMxn).toBeCloseTo(3734.56, 2);
      expect(kpis.salesUnits).toBe(65);
    });

    it('cascades the PREVIOUS aggregate so variationPct reflects §7 on both sides', async () => {
      // Prev period (2026-04) has NO file amount — only override-derived 280.
      // Without the prev-side wiring, prevSales would be 0 → variationPct null.
      const kpis = await getDashboardKpis(
        db,
        { clientId, userId, periodYear: 2026, periodMonth: 5 },
        DEFAULT_CUTS,
      );
      expect(kpis.variationPct).toBeCloseTo(((3734.56 - 280) / 280) * 100, 3);
    });

    it('prev-period cascade sanity: 2026-04 as its own current period sums 280', async () => {
      const kpis = await getDashboardKpis(
        db,
        { clientId, userId, periodYear: 2026, periodMonth: 4 },
        DEFAULT_CUTS,
      );
      expect(kpis.salesAmountMxn).toBeCloseTo(280, 2);
    });
  });
});
