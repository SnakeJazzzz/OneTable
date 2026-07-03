import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '@/lib/db';
import { makeCuid } from '@/core/ids';
import { backfillSelloutProductId, assignMapping, resolveConflict, deleteMapping } from '@/core/normalizer/resolve';
import type { Chain } from '@prisma/client';

const TEST_EMAIL = 'b4-resolve@test.local';

async function seedClient() {
  await db.user.deleteMany({ where: { email: TEST_EMAIL } });
  const u = await db.user.create({ data: { email: TEST_EMAIL, passwordHash: 'x' } });
  const c = await db.client.create({ data: { name: 'B4 RESOLVE', userId: u.id } });
  return { userId: u.id, clientId: c.id };
}

async function seedClient2(email: string) {
  await db.user.deleteMany({ where: { email } });
  const u = await db.user.create({ data: { email, passwordHash: 'x' } });
  const c = await db.client.create({ data: { name: 'B4', userId: u.id } });
  return { userId: u.id, clientId: c.id };
}
async function mkUpload(clientId: string, userId: string, chain: Chain) {
  return db.upload.create({ data: { clientId, userId, chain, fileType: 'MIXED', originalFilename: 'x', fileHash: makeCuid(), fileSizeBytes: 1, status: 'COMPLETED' } });
}
async function mkSellout(clientId: string, userId: string, uploadId: string, chain: Chain, portal: string, productId: string | null) {
  return db.selloutData.create({ data: { clientId, userId, uploadId, chain, productId, portalRawProduct: portal, storeId: 'S', periodYear: 2026, periodMonth: 1, salesUnits: 1 } });
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

describe('assignMapping', () => {
  afterAll(async () => {
    await db.user.deleteMany({ where: { email: { startsWith: 'b4-assign-' } } });
  });

  it('maps a fresh portalString → CONFIRMED + backfills NULL sellout rows', async () => {
    const { clientId, userId } = await seedClient2('b4-assign-1@test.local');
    const sku = await db.product.create({ data: { clientId, nameStandard: 'A', skuCode: makeCuid() } });
    const up = await mkUpload(clientId, userId, 'SORIANA');
    await mkSellout(clientId, userId, up.id, 'SORIANA', 'STRING-1', null);

    const res = await assignMapping(db, { clientId, chain: 'SORIANA', portalString: 'STRING-1', productId: sku.id, status: 'CONFIRMED' });

    expect(res.kind).toBe('mapped');
    const m = await db.productMapping.findFirst({ where: { clientId, chain: 'SORIANA', portalString: 'STRING-1' } });
    expect(m?.status).toBe('CONFIRMED');
    const s = await db.selloutData.findFirst({ where: { clientId, portalRawProduct: 'STRING-1' } });
    expect(s?.productId).toBe(sku.id);
  });

  it('D3: mapping an already-CONFIRMED string to a 2nd SKU creates a conflict (both CONFLICTED, order: update-then-insert)', async () => {
    const { clientId } = await seedClient2('b4-assign-2@test.local');
    const skuA = await db.product.create({ data: { clientId, nameStandard: 'A', skuCode: makeCuid() } });
    const skuB = await db.product.create({ data: { clientId, nameStandard: 'B', skuCode: makeCuid() } });
    await db.productMapping.create({ data: { clientId, chain: 'AL_SUPER', portalString: 'P', productId: skuA.id, status: 'CONFIRMED' } });

    const res = await assignMapping(db, { clientId, chain: 'AL_SUPER', portalString: 'P', productId: skuB.id, status: 'CONFIRMED' });

    expect(res.kind).toBe('conflict');
    const rows = await db.productMapping.findMany({ where: { clientId, chain: 'AL_SUPER', portalString: 'P' } });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.status === 'CONFLICTED')).toBe(true);
  });

  it('FIX-1: mapping onto an already-CONFLICTED key creates no 3rd row and attributes nothing', async () => {
    const { clientId, userId } = await seedClient2('b4-assign-3@test.local');
    const skuA = await db.product.create({ data: { clientId, nameStandard: 'A', skuCode: makeCuid() } });
    const skuB = await db.product.create({ data: { clientId, nameStandard: 'B', skuCode: makeCuid() } });
    const skuC = await db.product.create({ data: { clientId, nameStandard: 'C', skuCode: makeCuid() } });
    await db.productMapping.create({ data: { clientId, chain: 'AL_SUPER', portalString: 'P', productId: skuA.id, status: 'CONFLICTED' } });
    await db.productMapping.create({ data: { clientId, chain: 'AL_SUPER', portalString: 'P', productId: skuB.id, status: 'CONFLICTED' } });
    const up = await mkUpload(clientId, userId, 'AL_SUPER');
    await mkSellout(clientId, userId, up.id, 'AL_SUPER', 'P', null);

    const res = await assignMapping(db, { clientId, chain: 'AL_SUPER', portalString: 'P', productId: skuC.id, status: 'CONFIRMED' });

    expect(res.kind).toBe('conflict_exists');
    const rows = await db.productMapping.findMany({ where: { clientId, chain: 'AL_SUPER', portalString: 'P' } });
    expect(rows).toHaveLength(2); // no 3rd row
    const s = await db.selloutData.findFirst({ where: { clientId, portalRawProduct: 'P' } });
    expect(s?.productId).toBeNull(); // nothing attributed
  });

  it('idempotent: re-assigning the same string→same SKU promotes PENDING_REVIEW→CONFIRMED, no new row, backfills', async () => {
    const { clientId, userId } = await seedClient2('b4-assign-4@test.local');
    const sku = await db.product.create({ data: { clientId, nameStandard: 'A', skuCode: makeCuid() } });
    const up = await mkUpload(clientId, userId, 'SORIANA');
    await mkSellout(clientId, userId, up.id, 'SORIANA', 'STRING-IDEM', null);

    // First assign as PENDING_REVIEW, then re-assign the same SKU as CONFIRMED.
    const first = await assignMapping(db, { clientId, chain: 'SORIANA', portalString: 'STRING-IDEM', productId: sku.id, status: 'PENDING_REVIEW' });
    expect(first.kind).toBe('mapped');
    const second = await assignMapping(db, { clientId, chain: 'SORIANA', portalString: 'STRING-IDEM', productId: sku.id, status: 'CONFIRMED' });
    expect(second.kind).toBe('mapped');

    const rows = await db.productMapping.findMany({ where: { clientId, chain: 'SORIANA', portalString: 'STRING-IDEM' } });
    expect(rows).toHaveLength(1); // no duplicate row
    expect(rows[0].status).toBe('CONFIRMED'); // promoted
    const s = await db.selloutData.findFirst({ where: { clientId, portalRawProduct: 'STRING-IDEM' } });
    expect(s?.productId).toBe(sku.id);
  });
});

describe('resolveConflict', () => {
  afterAll(async () => {
    await db.user.deleteMany({ where: { email: { startsWith: 'b4-resolve-' } } });
  });

  it('"Es éste": deletes losers, winner → CONFIRMED, backfills sellout', async () => {
    const { clientId, userId } = await seedClient2('b4-resolve-win@test.local');
    const skuA = await db.product.create({ data: { clientId, nameStandard: 'A', skuCode: makeCuid() } });
    const skuB = await db.product.create({ data: { clientId, nameStandard: 'B', skuCode: makeCuid() } });
    await db.productMapping.create({ data: { clientId, chain: 'AL_SUPER', portalString: 'P', productId: skuA.id, status: 'CONFLICTED' } });
    await db.productMapping.create({ data: { clientId, chain: 'AL_SUPER', portalString: 'P', productId: skuB.id, status: 'CONFLICTED' } });
    const up = await mkUpload(clientId, userId, 'AL_SUPER');
    await mkSellout(clientId, userId, up.id, 'AL_SUPER', 'P', null);

    await resolveConflict(db, { clientId, chain: 'AL_SUPER', portalString: 'P', winnerProductId: skuA.id });

    const rows = await db.productMapping.findMany({ where: { clientId, chain: 'AL_SUPER', portalString: 'P' } });
    expect(rows).toHaveLength(1);
    expect(rows[0].productId).toBe(skuA.id);
    expect(rows[0].status).toBe('CONFIRMED');
    const s = await db.selloutData.findFirst({ where: { clientId, portalRawProduct: 'P' } });
    expect(s?.productId).toBe(skuA.id);
  });

  it('"Ninguno": deletes all candidates, string returns to the unmapped queue', async () => {
    const { clientId, userId } = await seedClient2('b4-resolve-none@test.local');
    const skuA = await db.product.create({ data: { clientId, nameStandard: 'A', skuCode: makeCuid() } });
    await db.productMapping.create({ data: { clientId, chain: 'AL_SUPER', portalString: 'P', productId: skuA.id, status: 'CONFLICTED' } });
    const up = await mkUpload(clientId, userId, 'AL_SUPER');

    await resolveConflict(db, { clientId, chain: 'AL_SUPER', portalString: 'P', winnerProductId: null, firstSeenUploadId: up.id });

    const rows = await db.productMapping.findMany({ where: { clientId, chain: 'AL_SUPER', portalString: 'P' } });
    expect(rows).toHaveLength(0);
    const unmapped = await db.unmappedProduct.findFirst({ where: { clientId, chain: 'AL_SUPER', portalString: 'P' } });
    expect(unmapped).not.toBeNull();
  });

  it('#1 guard: "Es éste" with a winner that is NOT a candidate aborts — deletes nothing, attributes nothing', async () => {
    const { clientId, userId } = await seedClient2('b4-resolve-badwin@test.local');
    const skuA = await db.product.create({ data: { clientId, nameStandard: 'A', skuCode: makeCuid() } });
    const skuB = await db.product.create({ data: { clientId, nameStandard: 'B', skuCode: makeCuid() } });
    const outsider = await db.product.create({ data: { clientId, nameStandard: 'Outsider', skuCode: makeCuid() } });
    await db.productMapping.create({ data: { clientId, chain: 'AL_SUPER', portalString: 'P', productId: skuA.id, status: 'CONFLICTED' } });
    await db.productMapping.create({ data: { clientId, chain: 'AL_SUPER', portalString: 'P', productId: skuB.id, status: 'CONFLICTED' } });
    const up = await mkUpload(clientId, userId, 'AL_SUPER');
    await mkSellout(clientId, userId, up.id, 'AL_SUPER', 'P', null);

    await expect(
      resolveConflict(db, { clientId, chain: 'AL_SUPER', portalString: 'P', winnerProductId: outsider.id }),
    ).rejects.toThrow(/no es un candidato/);

    // Transaction rolled back: both CONFLICTED rows survive, sellout still NULL.
    const rows = await db.productMapping.findMany({ where: { clientId, chain: 'AL_SUPER', portalString: 'P' } });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.status === 'CONFLICTED')).toBe(true);
    const s = await db.selloutData.findFirst({ where: { clientId, portalRawProduct: 'P' } });
    expect(s?.productId).toBeNull();
  });

  it('"Es éste" with the winner as the sole candidate (no losers): promotes + backfills, deletes nothing', async () => {
    const { clientId, userId } = await seedClient2('b4-resolve-solo@test.local');
    const skuA = await db.product.create({ data: { clientId, nameStandard: 'A', skuCode: makeCuid() } });
    await db.productMapping.create({ data: { clientId, chain: 'AL_SUPER', portalString: 'P', productId: skuA.id, status: 'CONFLICTED' } });
    const up = await mkUpload(clientId, userId, 'AL_SUPER');
    await mkSellout(clientId, userId, up.id, 'AL_SUPER', 'P', null);

    await resolveConflict(db, { clientId, chain: 'AL_SUPER', portalString: 'P', winnerProductId: skuA.id });

    const rows = await db.productMapping.findMany({ where: { clientId, chain: 'AL_SUPER', portalString: 'P' } });
    expect(rows).toHaveLength(1);
    expect(rows[0].productId).toBe(skuA.id);
    expect(rows[0].status).toBe('CONFIRMED');
    const s = await db.selloutData.findFirst({ where: { clientId, portalRawProduct: 'P' } });
    expect(s?.productId).toBe(skuA.id);
  });
});

describe('deleteMapping', () => {
  afterAll(async () => {
    await db.user.deleteMany({ where: { email: { startsWith: 'b4-delete-' } } });
  });

  it('reverts ONLY the deleted string\'s sellout rows (multi-value footgun guard), re-queues it, removes the mapping', async () => {
    const { clientId, userId } = await seedClient2('b4-delete-1@test.local');
    const skuX = await db.product.create({ data: { clientId, nameStandard: 'X', skuCode: makeCuid() } });
    // Multi-value SKU: both P and P2 map to X (CONFIRMED).
    await db.productMapping.create({ data: { clientId, chain: 'AL_SUPER', portalString: 'P', productId: skuX.id, status: 'CONFIRMED' } });
    await db.productMapping.create({ data: { clientId, chain: 'AL_SUPER', portalString: 'P2', productId: skuX.id, status: 'CONFIRMED' } });
    const up = await mkUpload(clientId, userId, 'AL_SUPER');
    // 5 rows attributed via P, 3 rows attributed via P2 — all to X. Distinct
    // storeIds: the UPSERT key is (clientId,chain,storeId,portalRawProduct,year,month).
    for (let i = 0; i < 5; i++) {
      await db.selloutData.create({ data: { clientId, userId, uploadId: up.id, chain: 'AL_SUPER', productId: skuX.id, portalRawProduct: 'P', storeId: `SP${i}`, periodYear: 2026, periodMonth: 1, salesUnits: 1 } });
    }
    for (let i = 0; i < 3; i++) {
      await db.selloutData.create({ data: { clientId, userId, uploadId: up.id, chain: 'AL_SUPER', productId: skuX.id, portalRawProduct: 'P2', storeId: `SP2${i}`, periodYear: 2026, periodMonth: 1, salesUnits: 1 } });
    }

    await deleteMapping(db, { clientId, chain: 'AL_SUPER', portalString: 'P', productId: skuX.id, firstSeenUploadId: up.id });

    // (a) the 5 P rows → NULL.
    const pRows = await db.selloutData.findMany({ where: { clientId, chain: 'AL_SUPER', portalRawProduct: 'P' }, select: { productId: true } });
    expect(pRows).toHaveLength(5);
    expect(pRows.every((r) => r.productId === null)).toBe(true);
    // (b) the 3 P2 rows STILL attributed to X — the footgun guard: revert filtered
    //     by portalRawProduct=P, NOT just productId=X.
    const p2Rows = await db.selloutData.findMany({ where: { clientId, chain: 'AL_SUPER', portalRawProduct: 'P2' }, select: { productId: true } });
    expect(p2Rows).toHaveLength(3);
    expect(p2Rows.every((r) => r.productId === skuX.id)).toBe(true);
    // (c) P back in the unmapped queue (resolvedAt null).
    const unmapped = await db.unmappedProduct.findFirst({ where: { clientId, chain: 'AL_SUPER', portalString: 'P' } });
    expect(unmapped).not.toBeNull();
    expect(unmapped?.resolvedAt).toBeNull();
    // (d) the (P, X) mapping no longer exists; (P2, X) still does.
    const pMap = await db.productMapping.findFirst({ where: { clientId, chain: 'AL_SUPER', portalString: 'P' } });
    expect(pMap).toBeNull();
    const p2Map = await db.productMapping.findFirst({ where: { clientId, chain: 'AL_SUPER', portalString: 'P2' } });
    expect(p2Map).not.toBeNull();
  });

  it('rejects deleting a CONFLICTED mapping (those are resolved via the conflict UI, not delete)', async () => {
    const { clientId } = await seedClient2('b4-delete-2@test.local');
    const skuA = await db.product.create({ data: { clientId, nameStandard: 'A', skuCode: makeCuid() } });
    const skuB = await db.product.create({ data: { clientId, nameStandard: 'B', skuCode: makeCuid() } });
    await db.productMapping.create({ data: { clientId, chain: 'AL_SUPER', portalString: 'P', productId: skuA.id, status: 'CONFLICTED' } });
    await db.productMapping.create({ data: { clientId, chain: 'AL_SUPER', portalString: 'P', productId: skuB.id, status: 'CONFLICTED' } });

    await expect(
      deleteMapping(db, { clientId, chain: 'AL_SUPER', portalString: 'P', productId: skuA.id, firstSeenUploadId: 'irrelevant' }),
    ).rejects.toThrow();

    // Untouched: both CONFLICTED rows survive.
    const rows = await db.productMapping.findMany({ where: { clientId, chain: 'AL_SUPER', portalString: 'P' } });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.status === 'CONFLICTED')).toBe(true);
  });

  // NO_UPLOAD path asserted at the SERVICE level: deleteMapping receives
  // firstSeenUploadId as an arg (route derives + passes it — Option A keeps the
  // upload derivation out of core). With no upload to anchor the re-queue, the
  // route passes firstSeenUploadId=undefined and the shared requeue guard throws,
  // rolling back the WHOLE tx (revert + delete must NOT persist without re-queue).
  it('throws and rolls back the whole tx when there is no upload to re-anchor (firstSeenUploadId absent)', async () => {
    const { clientId, userId } = await seedClient2('b4-delete-3@test.local');
    const skuX = await db.product.create({ data: { clientId, nameStandard: 'X', skuCode: makeCuid() } });
    await db.productMapping.create({ data: { clientId, chain: 'AL_SUPER', portalString: 'P', productId: skuX.id, status: 'CONFIRMED' } });
    const up = await mkUpload(clientId, userId, 'AL_SUPER');
    for (let i = 0; i < 4; i++) {
      await db.selloutData.create({ data: { clientId, userId, uploadId: up.id, chain: 'AL_SUPER', productId: skuX.id, portalRawProduct: 'P', storeId: `SP${i}`, periodYear: 2026, periodMonth: 1, salesUnits: 1 } });
    }

    await expect(
      deleteMapping(db, { clientId, chain: 'AL_SUPER', portalString: 'P', productId: skuX.id, firstSeenUploadId: undefined }),
    ).rejects.toThrow();

    // Rolled back: SelloutData NOT nulled, mapping NOT deleted.
    const rows = await db.selloutData.findMany({ where: { clientId, chain: 'AL_SUPER', portalRawProduct: 'P' }, select: { productId: true } });
    expect(rows).toHaveLength(4);
    expect(rows.every((r) => r.productId === skuX.id)).toBe(true);
    const m = await db.productMapping.findFirst({ where: { clientId, chain: 'AL_SUPER', portalString: 'P' } });
    expect(m).not.toBeNull();
    expect(m?.status).toBe('CONFIRMED');
  });

  it('throws (404 path) when the mapping does not exist', async () => {
    const { clientId } = await seedClient2('b4-delete-4@test.local');
    const skuX = await db.product.create({ data: { clientId, nameStandard: 'X', skuCode: makeCuid() } });

    await expect(
      deleteMapping(db, { clientId, chain: 'AL_SUPER', portalString: 'NOPE', productId: skuX.id, firstSeenUploadId: 'anything' }),
    ).rejects.toThrow();
  });
});
