import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '@/lib/db';
import { makeCuid } from '@/core/ids';
import { backfillSelloutProductId, assignMapping, resolveConflict, deleteMapping, retargetMapping } from '@/core/normalizer/resolve';
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
    await db.user.deleteMany({ where: { email: { startsWith: 'b5-3-delete-' } } });
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
    ).rejects.toThrow(/cannot delete a CONFLICTED mapping/);

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
    ).rejects.toThrow(/requires firstSeenUploadId/);

    // Rolled back: SelloutData NOT nulled, mapping NOT deleted.
    const rows = await db.selloutData.findMany({ where: { clientId, chain: 'AL_SUPER', portalRawProduct: 'P' }, select: { productId: true } });
    expect(rows).toHaveLength(4);
    expect(rows.every((r) => r.productId === skuX.id)).toBe(true);
    const m = await db.productMapping.findFirst({ where: { clientId, chain: 'AL_SUPER', portalString: 'P' } });
    expect(m).not.toBeNull();
    expect(m?.status).toBe('CONFIRMED');
  });

  // §11.5a-fix: presence-of-data rule. A string added by hand (+Agregar otro
  // string) that NEVER came in a file has no SelloutData rows — deleting its
  // mapping must NOT re-queue it into UnmappedProduct (there are no orphan sales
  // to re-attribute; requeueing would create a false "sin mapear" task).
  it('does NOT re-queue a string with zero SelloutData rows (manually added string)', async () => {
    const { clientId, userId } = await seedClient2('b4-delete-5@test.local');
    const skuX = await db.product.create({ data: { clientId, nameStandard: 'X', skuCode: makeCuid() } });
    // Manual mapping: CONFIRMED, but the string never appeared in any upload.
    await db.productMapping.create({ data: { clientId, chain: 'AL_SUPER', portalString: 'MANUAL-ONLY', productId: skuX.id, status: 'CONFIRMED' } });
    const up = await mkUpload(clientId, userId, 'AL_SUPER');
    // Sibling sellout row via a DIFFERENT string, attributed to the same SKU —
    // proves the delete touches no SelloutData at all.
    await db.selloutData.create({ data: { clientId, userId, uploadId: up.id, chain: 'AL_SUPER', productId: skuX.id, portalRawProduct: 'OTHER', storeId: 'SO1', periodYear: 2026, periodMonth: 1, salesUnits: 1 } });

    // The route still derives + passes firstSeenUploadId; the no-requeue decision
    // must come from the data-presence signal, not from a missing uploadId.
    await deleteMapping(db, { clientId, chain: 'AL_SUPER', portalString: 'MANUAL-ONLY', productId: skuX.id, firstSeenUploadId: up.id });

    // (a) the mapping no longer exists.
    const m = await db.productMapping.findFirst({ where: { clientId, chain: 'AL_SUPER', portalString: 'MANUAL-ONLY' } });
    expect(m).toBeNull();
    // (b) NOT re-queued: no UnmappedProduct row for the string.
    const unmapped = await db.unmappedProduct.findFirst({ where: { clientId, chain: 'AL_SUPER', portalString: 'MANUAL-ONLY' } });
    expect(unmapped).toBeNull();
    // (c) no SelloutData was touched: zero rows for the string, and the sibling
    //     row (different string, same SKU) keeps its attribution.
    const manualRows = await db.selloutData.count({ where: { clientId, chain: 'AL_SUPER', portalRawProduct: 'MANUAL-ONLY' } });
    expect(manualRows).toBe(0);
    const sibling = await db.selloutData.findFirst({ where: { clientId, chain: 'AL_SUPER', portalRawProduct: 'OTHER' } });
    expect(sibling?.productId).toBe(skuX.id);
  });

  it('throws (404 path) when the mapping does not exist', async () => {
    const { clientId } = await seedClient2('b4-delete-4@test.local');
    const skuX = await db.product.create({ data: { clientId, nameStandard: 'X', skuCode: makeCuid() } });

    await expect(
      deleteMapping(db, { clientId, chain: 'AL_SUPER', portalString: 'NOPE', productId: skuX.id, firstSeenUploadId: 'anything' }),
    ).rejects.toThrow(/mapping not found/);
  });

  // B5-3 A6 — combined edge: zero SelloutData rows AND firstSeenUploadId absent.
  // With count 0 the requeue step is skipped entirely, so the shared guard that
  // throws on a missing uploadId never runs: the delete must resolve cleanly.
  it('resolves without throwing when the string has zero rows AND firstSeenUploadId is absent', async () => {
    const { clientId } = await seedClient2('b5-3-delete-edge@test.local');
    const skuX = await db.product.create({ data: { clientId, nameStandard: 'X', skuCode: makeCuid() } });
    // Manual mapping: CONFIRMED, string never appeared in any upload.
    await db.productMapping.create({ data: { clientId, chain: 'AL_SUPER', portalString: 'MANUAL-NO-UP', productId: skuX.id, status: 'CONFIRMED' } });

    await deleteMapping(db, { clientId, chain: 'AL_SUPER', portalString: 'MANUAL-NO-UP', productId: skuX.id, firstSeenUploadId: undefined });

    // (a) the mapping is gone.
    const m = await db.productMapping.findFirst({ where: { clientId, chain: 'AL_SUPER', portalString: 'MANUAL-NO-UP' } });
    expect(m).toBeNull();
    // (b) ZERO new UnmappedProduct rows — no requeue happened.
    const unmapped = await db.unmappedProduct.count({ where: { clientId, chain: 'AL_SUPER', portalString: 'MANUAL-NO-UP' } });
    expect(unmapped).toBe(0);
  });
});

describe('retargetMapping', () => {
  afterAll(async () => {
    await db.user.deleteMany({ where: { email: { startsWith: 'b4-retarget-' } } });
  });

  it('happy path: retargets P→X to Y in-place — rows re-attributed, same mapping row id, status CONFIRMED', async () => {
    const { clientId, userId } = await seedClient2('b4-retarget-1@test.local');
    const skuX = await db.product.create({ data: { clientId, nameStandard: 'X', skuCode: makeCuid() } });
    const skuY = await db.product.create({ data: { clientId, nameStandard: 'Y', skuCode: makeCuid() } });
    const before = await db.productMapping.create({ data: { clientId, chain: 'AL_SUPER', portalString: 'P', productId: skuX.id, status: 'CONFIRMED' } });
    const up = await mkUpload(clientId, userId, 'AL_SUPER');
    for (let i = 0; i < 4; i++) {
      await db.selloutData.create({ data: { clientId, userId, uploadId: up.id, chain: 'AL_SUPER', productId: skuX.id, portalRawProduct: 'P', storeId: `SP${i}`, periodYear: 2026, periodMonth: 1, salesUnits: 1 } });
    }

    await retargetMapping(db, { clientId, chain: 'AL_SUPER', portalString: 'P', oldProductId: skuX.id, newProductId: skuY.id });

    // All P rows now attributed to Y.
    const rows = await db.selloutData.findMany({ where: { clientId, chain: 'AL_SUPER', portalRawProduct: 'P' }, select: { productId: true } });
    expect(rows).toHaveLength(4);
    expect(rows.every((r) => r.productId === skuY.id)).toBe(true);
    // In-place UPDATE: exactly one mapping row, SAME id as before (catches a
    // drift to delete+create), productId=Y, status=CONFIRMED.
    const maps = await db.productMapping.findMany({ where: { clientId, chain: 'AL_SUPER', portalString: 'P' } });
    expect(maps).toHaveLength(1);
    expect(maps[0].id).toBe(before.id);
    expect(maps[0].productId).toBe(skuY.id);
    expect(maps[0].status).toBe('CONFIRMED');
  });

  it('MULTI-VALUE GUARD: retargeting P1→X leaves P2→X (rows AND mapping) fully intact', async () => {
    const { clientId, userId } = await seedClient2('b4-retarget-2@test.local');
    const skuX = await db.product.create({ data: { clientId, nameStandard: 'X', skuCode: makeCuid() } });
    const skuY = await db.product.create({ data: { clientId, nameStandard: 'Y', skuCode: makeCuid() } });
    // Multi-value SKU: P1 and P2 both map to X.
    await db.productMapping.create({ data: { clientId, chain: 'AL_SUPER', portalString: 'P1', productId: skuX.id, status: 'CONFIRMED' } });
    const p2Map = await db.productMapping.create({ data: { clientId, chain: 'AL_SUPER', portalString: 'P2', productId: skuX.id, status: 'CONFIRMED' } });
    const up = await mkUpload(clientId, userId, 'AL_SUPER');
    for (let i = 0; i < 5; i++) {
      await db.selloutData.create({ data: { clientId, userId, uploadId: up.id, chain: 'AL_SUPER', productId: skuX.id, portalRawProduct: 'P1', storeId: `SA${i}`, periodYear: 2026, periodMonth: 1, salesUnits: 1 } });
    }
    for (let i = 0; i < 3; i++) {
      await db.selloutData.create({ data: { clientId, userId, uploadId: up.id, chain: 'AL_SUPER', productId: skuX.id, portalRawProduct: 'P2', storeId: `SB${i}`, periodYear: 2026, periodMonth: 1, salesUnits: 1 } });
    }

    await retargetMapping(db, { clientId, chain: 'AL_SUPER', portalString: 'P1', oldProductId: skuX.id, newProductId: skuY.id });

    // P1 rows moved to Y.
    const p1Rows = await db.selloutData.findMany({ where: { clientId, chain: 'AL_SUPER', portalRawProduct: 'P1' }, select: { productId: true } });
    expect(p1Rows).toHaveLength(5);
    expect(p1Rows.every((r) => r.productId === skuY.id)).toBe(true);
    // P2 rows UNTOUCHED (still X) — the portalRawProduct filter in both
    // primitives is the guard; without it these 3 rows would be reverted/swept.
    const p2Rows = await db.selloutData.findMany({ where: { clientId, chain: 'AL_SUPER', portalRawProduct: 'P2' }, select: { productId: true } });
    expect(p2Rows).toHaveLength(3);
    expect(p2Rows.every((r) => r.productId === skuX.id)).toBe(true);
    // P2 mapping untouched.
    const p2After = await db.productMapping.findFirst({ where: { clientId, chain: 'AL_SUPER', portalString: 'P2' } });
    expect(p2After?.id).toBe(p2Map.id);
    expect(p2After?.productId).toBe(skuX.id);
    expect(p2After?.status).toBe('CONFIRMED');
  });

  it('UnmappedProduct queue untouched: identical before/after, no queue row for the retargeted string', async () => {
    const { clientId, userId } = await seedClient2('b4-retarget-3@test.local');
    const skuX = await db.product.create({ data: { clientId, nameStandard: 'X', skuCode: makeCuid() } });
    const skuY = await db.product.create({ data: { clientId, nameStandard: 'Y', skuCode: makeCuid() } });
    await db.productMapping.create({ data: { clientId, chain: 'AL_SUPER', portalString: 'P1', productId: skuX.id, status: 'CONFIRMED' } });
    const up = await mkUpload(clientId, userId, 'AL_SUPER');
    await mkSellout(clientId, userId, up.id, 'AL_SUPER', 'P1', skuX.id);
    // Unrelated queue entry (a different, genuinely unmapped string).
    await db.unmappedProduct.create({ data: { clientId, chain: 'AL_SUPER', portalString: 'OTHER-UNMAPPED', firstSeenUploadId: up.id } });
    const queueBefore = await db.unmappedProduct.findMany({ where: { clientId }, orderBy: { id: 'asc' } });

    await retargetMapping(db, { clientId, chain: 'AL_SUPER', portalString: 'P1', oldProductId: skuX.id, newProductId: skuY.id });

    // Queue state identical before/after (the string never stops being mapped).
    const queueAfter = await db.unmappedProduct.findMany({ where: { clientId }, orderBy: { id: 'asc' } });
    expect(queueAfter).toEqual(queueBefore);
    // And specifically: no queue row for P1.
    const p1Queue = await db.unmappedProduct.findFirst({ where: { clientId, chain: 'AL_SUPER', portalString: 'P1' } });
    expect(p1Queue).toBeNull();
  });

  it('rejects a CONFLICTED mapping — throws, zero mutations (conflicts go through resolveConflict)', async () => {
    const { clientId, userId } = await seedClient2('b4-retarget-4@test.local');
    const skuA = await db.product.create({ data: { clientId, nameStandard: 'A', skuCode: makeCuid() } });
    const skuB = await db.product.create({ data: { clientId, nameStandard: 'B', skuCode: makeCuid() } });
    const skuC = await db.product.create({ data: { clientId, nameStandard: 'C', skuCode: makeCuid() } });
    await db.productMapping.create({ data: { clientId, chain: 'AL_SUPER', portalString: 'P', productId: skuA.id, status: 'CONFLICTED' } });
    await db.productMapping.create({ data: { clientId, chain: 'AL_SUPER', portalString: 'P', productId: skuB.id, status: 'CONFLICTED' } });
    const up = await mkUpload(clientId, userId, 'AL_SUPER');
    await mkSellout(clientId, userId, up.id, 'AL_SUPER', 'P', null);

    await expect(
      retargetMapping(db, { clientId, chain: 'AL_SUPER', portalString: 'P', oldProductId: skuA.id, newProductId: skuC.id }),
    ).rejects.toThrow(/cannot retarget a CONFLICTED mapping/);

    // Zero mutations: both CONFLICTED rows survive with their productIds; sellout still NULL.
    const maps = await db.productMapping.findMany({ where: { clientId, chain: 'AL_SUPER', portalString: 'P' } });
    expect(maps).toHaveLength(2);
    expect(maps.every((m) => m.status === 'CONFLICTED')).toBe(true);
    expect(new Set(maps.map((m) => m.productId))).toEqual(new Set([skuA.id, skuB.id]));
    const s = await db.selloutData.findFirst({ where: { clientId, portalRawProduct: 'P' } });
    expect(s?.productId).toBeNull();
  });

  it('throws (404 path) when the mapping does not exist', async () => {
    const { clientId } = await seedClient2('b4-retarget-5@test.local');
    const skuX = await db.product.create({ data: { clientId, nameStandard: 'X', skuCode: makeCuid() } });
    const skuY = await db.product.create({ data: { clientId, nameStandard: 'Y', skuCode: makeCuid() } });

    await expect(
      retargetMapping(db, { clientId, chain: 'AL_SUPER', portalString: 'NOPE', oldProductId: skuX.id, newProductId: skuY.id }),
    ).rejects.toThrow(/not found/);
  });

  it('rejects newProductId === oldProductId — throws, zero writes', async () => {
    const { clientId, userId } = await seedClient2('b4-retarget-6@test.local');
    const skuX = await db.product.create({ data: { clientId, nameStandard: 'X', skuCode: makeCuid() } });
    // PENDING_REVIEW on purpose: a spurious status write (→ CONFIRMED) would be caught below.
    await db.productMapping.create({ data: { clientId, chain: 'AL_SUPER', portalString: 'P', productId: skuX.id, status: 'PENDING_REVIEW' } });
    const up = await mkUpload(clientId, userId, 'AL_SUPER');
    await mkSellout(clientId, userId, up.id, 'AL_SUPER', 'P', skuX.id);

    await expect(
      retargetMapping(db, { clientId, chain: 'AL_SUPER', portalString: 'P', oldProductId: skuX.id, newProductId: skuX.id }),
    ).rejects.toThrow(/newProductId equals oldProductId/);

    // Zero writes: mapping keeps productId AND status; sellout keeps attribution.
    const m = await db.productMapping.findFirst({ where: { clientId, chain: 'AL_SUPER', portalString: 'P' } });
    expect(m?.productId).toBe(skuX.id);
    expect(m?.status).toBe('PENDING_REVIEW');
    const s = await db.selloutData.findFirst({ where: { clientId, portalRawProduct: 'P' } });
    expect(s?.productId).toBe(skuX.id);
  });

  it('rejects a newProductId belonging to ANOTHER client — throws, zero mutations', async () => {
    const { clientId, userId } = await seedClient2('b4-retarget-7@test.local');
    const { clientId: otherClientId } = await seedClient2('b4-retarget-7b@test.local');
    const skuX = await db.product.create({ data: { clientId, nameStandard: 'X', skuCode: makeCuid() } });
    const foreignY = await db.product.create({ data: { clientId: otherClientId, nameStandard: 'Y', skuCode: makeCuid() } });
    await db.productMapping.create({ data: { clientId, chain: 'AL_SUPER', portalString: 'P', productId: skuX.id, status: 'CONFIRMED' } });
    const up = await mkUpload(clientId, userId, 'AL_SUPER');
    await mkSellout(clientId, userId, up.id, 'AL_SUPER', 'P', skuX.id);

    await expect(
      retargetMapping(db, { clientId, chain: 'AL_SUPER', portalString: 'P', oldProductId: skuX.id, newProductId: foreignY.id }),
    ).rejects.toThrow(/does not exist or does not belong/);

    // Zero mutations: mapping still X/CONFIRMED, sellout still attributed to X.
    const m = await db.productMapping.findFirst({ where: { clientId, chain: 'AL_SUPER', portalString: 'P' } });
    expect(m?.productId).toBe(skuX.id);
    expect(m?.status).toBe('CONFIRMED');
    const s = await db.selloutData.findFirst({ where: { clientId, portalRawProduct: 'P' } });
    expect(s?.productId).toBe(skuX.id);
  });

  it('sweeps pre-existing NULL rows of the string to the new SKU (backfill step 5 behavior)', async () => {
    const { clientId, userId } = await seedClient2('b4-retarget-8@test.local');
    const skuX = await db.product.create({ data: { clientId, nameStandard: 'X', skuCode: makeCuid() } });
    const skuY = await db.product.create({ data: { clientId, nameStandard: 'Y', skuCode: makeCuid() } });
    await db.productMapping.create({ data: { clientId, chain: 'AL_SUPER', portalString: 'P', productId: skuX.id, status: 'CONFIRMED' } });
    const up = await mkUpload(clientId, userId, 'AL_SUPER');
    // 2 rows attributed to X + 2 pre-existing NULL rows for the SAME string
    // (e.g. leftovers from an old conflict window).
    for (let i = 0; i < 2; i++) {
      await db.selloutData.create({ data: { clientId, userId, uploadId: up.id, chain: 'AL_SUPER', productId: skuX.id, portalRawProduct: 'P', storeId: `SX${i}`, periodYear: 2026, periodMonth: 1, salesUnits: 1 } });
    }
    for (let i = 0; i < 2; i++) {
      await db.selloutData.create({ data: { clientId, userId, uploadId: up.id, chain: 'AL_SUPER', productId: null, portalRawProduct: 'P', storeId: `SN${i}`, periodYear: 2026, periodMonth: 1, salesUnits: 1 } });
    }

    await retargetMapping(db, { clientId, chain: 'AL_SUPER', portalString: 'P', oldProductId: skuX.id, newProductId: skuY.id });

    // ALL 4 rows (previously-attributed AND previously-NULL) end on Y: the string
    // now maps to Y, so its NULL leftovers belong to Y too — deliberate.
    const rows = await db.selloutData.findMany({ where: { clientId, chain: 'AL_SUPER', portalRawProduct: 'P' }, select: { productId: true } });
    expect(rows).toHaveLength(4);
    expect(rows.every((r) => r.productId === skuY.id)).toBe(true);
  });

  it('PENDING_REVIEW mapping retargeted → ends CONFIRMED (deliberate confirmation)', async () => {
    const { clientId, userId } = await seedClient2('b4-retarget-9@test.local');
    const skuX = await db.product.create({ data: { clientId, nameStandard: 'X', skuCode: makeCuid() } });
    const skuY = await db.product.create({ data: { clientId, nameStandard: 'Y', skuCode: makeCuid() } });
    const before = await db.productMapping.create({ data: { clientId, chain: 'AL_SUPER', portalString: 'P', productId: skuX.id, status: 'PENDING_REVIEW' } });
    const up = await mkUpload(clientId, userId, 'AL_SUPER');
    await mkSellout(clientId, userId, up.id, 'AL_SUPER', 'P', skuX.id);

    await retargetMapping(db, { clientId, chain: 'AL_SUPER', portalString: 'P', oldProductId: skuX.id, newProductId: skuY.id });

    const m = await db.productMapping.findFirst({ where: { clientId, chain: 'AL_SUPER', portalString: 'P' } });
    expect(m?.id).toBe(before.id);
    expect(m?.productId).toBe(skuY.id);
    expect(m?.status).toBe('CONFIRMED');
    const s = await db.selloutData.findFirst({ where: { clientId, portalRawProduct: 'P' } });
    expect(s?.productId).toBe(skuY.id);
  });
});
