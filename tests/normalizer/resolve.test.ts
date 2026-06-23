import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '@/lib/db';
import { makeCuid } from '@/core/ids';
import { backfillSelloutProductId } from '@/core/normalizer/resolve';

const TEST_EMAIL = 'b4-resolve@test.local';

async function seedClient() {
  await db.user.deleteMany({ where: { email: TEST_EMAIL } });
  const u = await db.user.create({ data: { email: TEST_EMAIL, passwordHash: 'x' } });
  const c = await db.client.create({ data: { name: 'B4 RESOLVE', userId: u.id } });
  return { userId: u.id, clientId: c.id };
}

describe('backfillSelloutProductId', () => {
  let clientId: string;
  let userId: string;

  beforeAll(async () => {
    ({ clientId, userId } = await seedClient());
  });

  afterAll(async () => {
    await db.user.deleteMany({ where: { email: TEST_EMAIL } });
    await db.$disconnect();
  });

  it('§8.6: attributes all conflicted-then-resolved rows to the winner', async () => {
    const upload = await db.upload.create({
      data: {
        clientId, userId, chain: 'AL_SUPER', fileType: 'MIXED',
        originalFilename: 'f.xlsx', fileHash: makeCuid(), fileSizeBytes: 1, status: 'COMPLETED',
      },
    });
    const skuA = await db.product.create({ data: { clientId, nameStandard: 'Chilli Lime 100g', skuCode: makeCuid() } });
    const PORTAL = '(T)CARNE SECA CITRUS GINGER 100 GRAMOS';
    // 5 sellout rows for the conflicted portalString, productId NULL (as normalize left them).
    for (let i = 0; i < 5; i++) {
      await db.selloutData.create({
        data: {
          clientId, userId, uploadId: upload.id, chain: 'AL_SUPER', productId: null,
          portalRawProduct: PORTAL, storeId: `S${i}`, periodYear: 2026, periodMonth: 1,
          salesUnits: 10, inventoryUnits: 20,
        },
      });
    }

    const updated = await backfillSelloutProductId(db, {
      clientId, chain: 'AL_SUPER', portalString: PORTAL, productId: skuA.id,
    });

    expect(updated).toBe(5);
    const rows = await db.selloutData.findMany({
      where: { clientId, chain: 'AL_SUPER', portalRawProduct: PORTAL },
      select: { productId: true },
    });
    expect(rows).toHaveLength(5);
    expect(rows.every((r) => r.productId === skuA.id)).toBe(true);
  });

  it('sibling (unmapped flow): attributes only NULL rows, leaves already-attributed rows alone', async () => {
    const upload = await db.upload.create({
      data: {
        clientId, userId, chain: 'SORIANA', fileType: 'MIXED',
        originalFilename: 'g.xlsx', fileHash: makeCuid(), fileSizeBytes: 1, status: 'COMPLETED',
      },
    });
    const sku = await db.product.create({ data: { clientId, nameStandard: 'Mango 86g', skuCode: makeCuid() } });
    const other = await db.product.create({ data: { clientId, nameStandard: 'Other', skuCode: makeCuid() } });
    const PORTAL = 'MANGO HABANERO 86G';
    await db.selloutData.create({
      data: { clientId, userId, uploadId: upload.id, chain: 'SORIANA', productId: null,
        portalRawProduct: PORTAL, storeId: 'A', periodYear: 2026, periodMonth: 2, salesUnits: 1 },
    });
    await db.selloutData.create({
      data: { clientId, userId, uploadId: upload.id, chain: 'SORIANA', productId: other.id,
        portalRawProduct: PORTAL, storeId: 'B', periodYear: 2026, periodMonth: 2, salesUnits: 1 },
    });

    const updated = await backfillSelloutProductId(db, {
      clientId, chain: 'SORIANA', portalString: PORTAL, productId: sku.id,
    });

    // Only the NULL row is attributed; the WHERE productId IS NULL guard protects
    // the row already attributed to `other`.
    expect(updated).toBe(1);
    const attributedToOther = await db.selloutData.count({
      where: { clientId, chain: 'SORIANA', portalRawProduct: PORTAL, productId: other.id },
    });
    expect(attributedToOther).toBe(1);
  });

  it('returns 0 when no NULL rows match (no-op, no throw) — direct footgun proof', async () => {
    // The positive proof of the footgun's failure mode: a portalString that
    // matches nothing returns 0 rows rather than throwing. If the WHERE matched
    // on a wrong column, every real backfill would silently land here.
    const sku = await db.product.create({ data: { clientId, nameStandard: 'NoMatch', skuCode: makeCuid() } });
    const updated = await backfillSelloutProductId(db, {
      clientId, chain: 'HEB', portalString: 'NONEXISTENT-PORTAL-STRING', productId: sku.id,
    });
    expect(updated).toBe(0);
  });
});
