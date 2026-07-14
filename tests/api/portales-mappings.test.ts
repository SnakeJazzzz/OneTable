import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import type { Chain } from '@prisma/client';
import { makeCuid } from '@/core/ids';

// Mock @/auth BEFORE importing the route handler — otherwise auth.ts runs
// for real and pulls a JWT cookie from a non-existent request.
vi.mock('@/auth', () => ({
  auth: vi.fn(),
}));

import { POST, DELETE, PATCH } from '@/app/api/portales/mappings/route';
import { auth } from '@/auth';

const db = new PrismaClient();

async function mkClient(email: string, name: string) {
  await db.user.deleteMany({ where: { email } });
  const u = await db.user.create({ data: { email, passwordHash: 'x' } });
  const c = await db.client.create({ data: { name, userId: u.id } });
  return { userId: u.id, clientId: c.id, email };
}

function mockSession(userId: string, clientId: string, email: string) {
  vi.mocked(auth).mockResolvedValueOnce({
    user: { id: userId, clientId, email, name: 'Tester' },
    expires: new Date(Date.now() + 60_000).toISOString(),
  } as any);
}

async function mkUpload(clientId: string, userId: string, chain: Chain) {
  return db.upload.create({
    data: { clientId, userId, chain, fileType: 'MIXED', originalFilename: 'x', fileHash: makeCuid(), fileSizeBytes: 1, status: 'COMPLETED' },
  });
}
async function mkSellout(clientId: string, userId: string, uploadId: string, chain: Chain, portal: string, productId: string | null) {
  return db.selloutData.create({
    data: { clientId, userId, uploadId, chain, productId, portalRawProduct: portal, storeId: 'S', periodYear: 2026, periodMonth: 1, salesUnits: 1 },
  });
}

function jsonReq(method: string, body: unknown): Request {
  return new Request('http://test/api/portales/mappings', {
    method,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

describe('POST /api/portales/mappings', () => {
  const PREFIX = 'ff3-map-post-';

  afterAll(async () => {
    await db.user.deleteMany({ where: { email: { startsWith: PREFIX } } });
  });

  it('401 without session', async () => {
    vi.mocked(auth).mockResolvedValueOnce(null as any);
    const res = await POST(jsonReq('POST', {}));
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe('UNAUTHORIZED');
  });

  it('400 INVALID_BODY for a non-JSON body', async () => {
    const { userId, clientId, email } = await mkClient(`${PREFIX}1@test.local`, 'FF3 MAP POST 1');
    mockSession(userId, clientId, email);
    const res = await POST(jsonReq('POST', 'not-json'));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('INVALID_BODY');
  });

  it('400 INVALID_BODY when portalString/productId are missing', async () => {
    const { userId, clientId, email } = await mkClient(`${PREFIX}2@test.local`, 'FF3 MAP POST 2');
    mockSession(userId, clientId, email);
    const res = await POST(jsonReq('POST', { chain: 'SORIANA' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('INVALID_BODY');
  });

  it('400 INVALID_CHAIN for an unknown chain', async () => {
    const { userId, clientId, email } = await mkClient(`${PREFIX}3@test.local`, 'FF3 MAP POST 3');
    mockSession(userId, clientId, email);
    const res = await POST(jsonReq('POST', { chain: 'NOPE', portalString: 'P', productId: 'x' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('INVALID_CHAIN');
  });

  it('404 PRODUCT_NOT_FOUND for a nonexistent SKU', async () => {
    const { userId, clientId, email } = await mkClient(`${PREFIX}4@test.local`, 'FF3 MAP POST 4');
    mockSession(userId, clientId, email);
    const res = await POST(jsonReq('POST', { chain: 'SORIANA', portalString: 'P', productId: 'nonexistent-cuid' }));
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe('PRODUCT_NOT_FOUND');
  });

  it('404 PRODUCT_NOT_FOUND for a SKU belonging to another tenant', async () => {
    const { userId, clientId, email } = await mkClient(`${PREFIX}5@test.local`, 'FF3 MAP POST 5');
    const { clientId: otherClientId } = await mkClient(`${PREFIX}5b@test.local`, 'FF3 MAP POST 5B');
    const foreignSku = await db.product.create({ data: { clientId: otherClientId, nameStandard: 'Foreign', skuCode: makeCuid() } });
    mockSession(userId, clientId, email);
    const res = await POST(jsonReq('POST', { chain: 'SORIANA', portalString: 'P', productId: foreignSku.id }));
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe('PRODUCT_NOT_FOUND');
  });

  it('D3 conflict fabrication: mapping a string already mapped to a DIFFERENT SKU → 200 { kind: "conflict" }', async () => {
    const { userId, clientId, email } = await mkClient(`${PREFIX}6@test.local`, 'FF3 MAP POST 6');
    const skuA = await db.product.create({ data: { clientId, nameStandard: 'A', skuCode: makeCuid() } });
    const skuB = await db.product.create({ data: { clientId, nameStandard: 'B', skuCode: makeCuid() } });
    await db.productMapping.create({ data: { clientId, chain: 'SORIANA', portalString: 'P', productId: skuA.id, status: 'CONFIRMED' } });

    mockSession(userId, clientId, email);
    const res = await POST(jsonReq('POST', { chain: 'SORIANA', portalString: 'P', productId: skuB.id }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result.kind).toBe('conflict');
  });

  it('409 CONFLICT_EXISTS when mapping onto an unresolved conflict', async () => {
    const { userId, clientId, email } = await mkClient(`${PREFIX}7@test.local`, 'FF3 MAP POST 7');
    const skuA = await db.product.create({ data: { clientId, nameStandard: 'A', skuCode: makeCuid() } });
    const skuB = await db.product.create({ data: { clientId, nameStandard: 'B', skuCode: makeCuid() } });
    const skuC = await db.product.create({ data: { clientId, nameStandard: 'C', skuCode: makeCuid() } });
    await db.productMapping.create({ data: { clientId, chain: 'SORIANA', portalString: 'P', productId: skuA.id, status: 'CONFLICTED' } });
    await db.productMapping.create({ data: { clientId, chain: 'SORIANA', portalString: 'P', productId: skuB.id, status: 'CONFLICTED' } });

    mockSession(userId, clientId, email);
    const res = await POST(jsonReq('POST', { chain: 'SORIANA', portalString: 'P', productId: skuC.id }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('CONFLICT_EXISTS');
  });

  it('200 { kind: "mapped" } on a fresh success', async () => {
    const { userId, clientId, email } = await mkClient(`${PREFIX}8@test.local`, 'FF3 MAP POST 8');
    const sku = await db.product.create({ data: { clientId, nameStandard: 'A', skuCode: makeCuid() } });
    mockSession(userId, clientId, email);
    const res = await POST(jsonReq('POST', { chain: 'SORIANA', portalString: 'FRESH', productId: sku.id }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result.kind).toBe('mapped');
  });

  it('FF-1: re-POST of a PENDING_REVIEW row (same string, same SKU) with status CONFIRMED → 200 mapped, row CONFIRMED', async () => {
    const { userId, clientId, email } = await mkClient(`${PREFIX}9@test.local`, 'FF3 MAP POST 9');
    const sku = await db.product.create({ data: { clientId, nameStandard: 'A', skuCode: makeCuid() } });
    await db.productMapping.create({ data: { clientId, chain: 'SORIANA', portalString: 'P-IDEM', productId: sku.id, status: 'PENDING_REVIEW' } });

    mockSession(userId, clientId, email);
    const res = await POST(jsonReq('POST', { chain: 'SORIANA', portalString: 'P-IDEM', productId: sku.id, status: 'CONFIRMED' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result.kind).toBe('mapped');

    const row = await db.productMapping.findFirst({ where: { clientId, chain: 'SORIANA', portalString: 'P-IDEM' } });
    expect(row?.status).toBe('CONFIRMED');
  });
});

describe('DELETE /api/portales/mappings', () => {
  const PREFIX = 'ff3-map-delete-';

  afterAll(async () => {
    await db.user.deleteMany({ where: { email: { startsWith: PREFIX } } });
  });

  it('401 without session', async () => {
    vi.mocked(auth).mockResolvedValueOnce(null as any);
    const res = await DELETE(jsonReq('DELETE', {}));
    expect(res.status).toBe(401);
  });

  it('404 MAPPING_NOT_FOUND when the mapping does not exist (Upload present)', async () => {
    const { userId, clientId, email } = await mkClient(`${PREFIX}1@test.local`, 'FF3 MAP DEL 1');
    const sku = await db.product.create({ data: { clientId, nameStandard: 'X', skuCode: makeCuid() } });
    await mkUpload(clientId, userId, 'SORIANA'); // upload present → route pre-check passes, service throws not-found
    mockSession(userId, clientId, email);
    const res = await DELETE(jsonReq('DELETE', { chain: 'SORIANA', portalString: 'NOPE', productId: sku.id }));
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe('MAPPING_NOT_FOUND');
  });

  it('409 CONFLICTED when deleting a CONFLICTED mapping', async () => {
    const { userId, clientId, email } = await mkClient(`${PREFIX}2@test.local`, 'FF3 MAP DEL 2');
    const skuA = await db.product.create({ data: { clientId, nameStandard: 'A', skuCode: makeCuid() } });
    const skuB = await db.product.create({ data: { clientId, nameStandard: 'B', skuCode: makeCuid() } });
    await db.productMapping.create({ data: { clientId, chain: 'SORIANA', portalString: 'P', productId: skuA.id, status: 'CONFLICTED' } });
    await db.productMapping.create({ data: { clientId, chain: 'SORIANA', portalString: 'P', productId: skuB.id, status: 'CONFLICTED' } });
    await mkUpload(clientId, userId, 'SORIANA');
    mockSession(userId, clientId, email);
    const res = await DELETE(jsonReq('DELETE', { chain: 'SORIANA', portalString: 'P', productId: skuA.id }));
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('CONFLICTED');
  });

  it('409 NO_UPLOAD when there is no Upload for the chain (route pre-check, before the service)', async () => {
    const { userId, clientId, email } = await mkClient(`${PREFIX}3@test.local`, 'FF3 MAP DEL 3');
    const sku = await db.product.create({ data: { clientId, nameStandard: 'X', skuCode: makeCuid() } });
    await db.productMapping.create({ data: { clientId, chain: 'SORIANA', portalString: 'P', productId: sku.id, status: 'CONFIRMED' } });
    // No upload created for SORIANA.
    mockSession(userId, clientId, email);
    const res = await DELETE(jsonReq('DELETE', { chain: 'SORIANA', portalString: 'P', productId: sku.id }));
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('NO_UPLOAD');
  });

  it('side-effect (a): mapping WITH SelloutData → requeued into UnmappedProduct (resolvedAt null) + SelloutData.productId null', async () => {
    const { userId, clientId, email } = await mkClient(`${PREFIX}4@test.local`, 'FF3 MAP DEL 4');
    const sku = await db.product.create({ data: { clientId, nameStandard: 'X', skuCode: makeCuid() } });
    await db.productMapping.create({ data: { clientId, chain: 'SORIANA', portalString: 'P', productId: sku.id, status: 'CONFIRMED' } });
    const up = await mkUpload(clientId, userId, 'SORIANA');
    await mkSellout(clientId, userId, up.id, 'SORIANA', 'P', sku.id);

    mockSession(userId, clientId, email);
    const res = await DELETE(jsonReq('DELETE', { chain: 'SORIANA', portalString: 'P', productId: sku.id }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    const s = await db.selloutData.findFirst({ where: { clientId, portalRawProduct: 'P' } });
    expect(s?.productId).toBeNull();
    const unmapped = await db.unmappedProduct.findFirst({ where: { clientId, chain: 'SORIANA', portalString: 'P' } });
    expect(unmapped).not.toBeNull();
    expect(unmapped?.resolvedAt).toBeNull();
  });

  it('side-effect (a-variant): requeue resets resolvedAt when the UnmappedProduct row already existed (resolved)', async () => {
    const { userId, clientId, email } = await mkClient(`${PREFIX}4b@test.local`, 'FF3 MAP DEL 4B');
    const sku = await db.product.create({ data: { clientId, nameStandard: 'X', skuCode: makeCuid() } });
    await db.productMapping.create({ data: { clientId, chain: 'SORIANA', portalString: 'P', productId: sku.id, status: 'CONFIRMED' } });
    const up = await mkUpload(clientId, userId, 'SORIANA');
    await mkSellout(clientId, userId, up.id, 'SORIANA', 'P', sku.id);
    // Pre-existing UnmappedProduct row, already resolved (a prior resolution).
    await db.unmappedProduct.create({
      data: { clientId, chain: 'SORIANA', portalString: 'P', firstSeenUploadId: up.id, resolvedAt: new Date(), resolvedProductId: sku.id },
    });

    mockSession(userId, clientId, email);
    const res = await DELETE(jsonReq('DELETE', { chain: 'SORIANA', portalString: 'P', productId: sku.id }));
    expect(res.status).toBe(200);

    const unmapped = await db.unmappedProduct.findFirst({ where: { clientId, chain: 'SORIANA', portalString: 'P' } });
    expect(unmapped?.resolvedAt).toBeNull();
    expect(unmapped?.resolvedProductId).toBeNull();
  });

  it('side-effect (b): mapping WITHOUT SelloutData (manually added string) → DELETE ok, ZERO phantom requeue', async () => {
    const { userId, clientId, email } = await mkClient(`${PREFIX}5@test.local`, 'FF3 MAP DEL 5');
    const sku = await db.product.create({ data: { clientId, nameStandard: 'X', skuCode: makeCuid() } });
    await db.productMapping.create({ data: { clientId, chain: 'SORIANA', portalString: 'MANUAL-ONLY', productId: sku.id, status: 'CONFIRMED' } });
    // Upload exists (route pre-check needs one) but no SelloutData rows for this string.
    await mkUpload(clientId, userId, 'SORIANA');

    mockSession(userId, clientId, email);
    const res = await DELETE(jsonReq('DELETE', { chain: 'SORIANA', portalString: 'MANUAL-ONLY', productId: sku.id }));
    expect(res.status).toBe(200);

    const m = await db.productMapping.findFirst({ where: { clientId, chain: 'SORIANA', portalString: 'MANUAL-ONLY' } });
    expect(m).toBeNull();
    const unmapped = await db.unmappedProduct.findFirst({ where: { clientId, chain: 'SORIANA', portalString: 'MANUAL-ONLY' } });
    expect(unmapped).toBeNull();
  });
});

describe('PATCH /api/portales/mappings', () => {
  const PREFIX = 'ff3-map-patch-';

  afterAll(async () => {
    await db.user.deleteMany({ where: { email: { startsWith: PREFIX } } });
    await db.$disconnect();
    vi.restoreAllMocks();
  });

  it('401 without session', async () => {
    vi.mocked(auth).mockResolvedValueOnce(null as any);
    const res = await PATCH(jsonReq('PATCH', {}));
    expect(res.status).toBe(401);
  });

  it('400 INVALID_BODY for a non-JSON body', async () => {
    const { userId, clientId, email } = await mkClient(`${PREFIX}1@test.local`, 'FF3 MAP PATCH 1');
    mockSession(userId, clientId, email);
    const res = await PATCH(jsonReq('PATCH', 'not-json'));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('INVALID_BODY');
  });

  it('400 INVALID_BODY when oldProductId/newProductId are missing', async () => {
    const { userId, clientId, email } = await mkClient(`${PREFIX}2@test.local`, 'FF3 MAP PATCH 2');
    mockSession(userId, clientId, email);
    const res = await PATCH(jsonReq('PATCH', { chain: 'SORIANA', portalString: 'P' }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('INVALID_BODY');
  });

  it('404 MAPPING_NOT_FOUND when the mapping does not exist', async () => {
    const { userId, clientId, email } = await mkClient(`${PREFIX}3@test.local`, 'FF3 MAP PATCH 3');
    const skuX = await db.product.create({ data: { clientId, nameStandard: 'X', skuCode: makeCuid() } });
    const skuY = await db.product.create({ data: { clientId, nameStandard: 'Y', skuCode: makeCuid() } });
    mockSession(userId, clientId, email);
    const res = await PATCH(jsonReq('PATCH', { chain: 'SORIANA', portalString: 'NOPE', oldProductId: skuX.id, newProductId: skuY.id }));
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe('MAPPING_NOT_FOUND');
  });

  it('409 CONFLICTED when retargeting a CONFLICTED mapping', async () => {
    const { userId, clientId, email } = await mkClient(`${PREFIX}4@test.local`, 'FF3 MAP PATCH 4');
    const skuA = await db.product.create({ data: { clientId, nameStandard: 'A', skuCode: makeCuid() } });
    const skuB = await db.product.create({ data: { clientId, nameStandard: 'B', skuCode: makeCuid() } });
    const skuC = await db.product.create({ data: { clientId, nameStandard: 'C', skuCode: makeCuid() } });
    await db.productMapping.create({ data: { clientId, chain: 'SORIANA', portalString: 'P', productId: skuA.id, status: 'CONFLICTED' } });
    await db.productMapping.create({ data: { clientId, chain: 'SORIANA', portalString: 'P', productId: skuB.id, status: 'CONFLICTED' } });
    mockSession(userId, clientId, email);
    const res = await PATCH(jsonReq('PATCH', { chain: 'SORIANA', portalString: 'P', oldProductId: skuA.id, newProductId: skuC.id }));
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('CONFLICTED');
  });

  it('409 NOOP_RETARGET when newProductId equals oldProductId', async () => {
    const { userId, clientId, email } = await mkClient(`${PREFIX}5@test.local`, 'FF3 MAP PATCH 5');
    const skuX = await db.product.create({ data: { clientId, nameStandard: 'X', skuCode: makeCuid() } });
    await db.productMapping.create({ data: { clientId, chain: 'SORIANA', portalString: 'P', productId: skuX.id, status: 'CONFIRMED' } });
    mockSession(userId, clientId, email);
    const res = await PATCH(jsonReq('PATCH', { chain: 'SORIANA', portalString: 'P', oldProductId: skuX.id, newProductId: skuX.id }));
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe('NOOP_RETARGET');
  });

  it('404 PRODUCT_NOT_FOUND (post-unification pin) when newProductId does not exist / belongs to another tenant', async () => {
    const { userId, clientId, email } = await mkClient(`${PREFIX}6@test.local`, 'FF3 MAP PATCH 6');
    const { clientId: otherClientId } = await mkClient(`${PREFIX}6b@test.local`, 'FF3 MAP PATCH 6B');
    const skuX = await db.product.create({ data: { clientId, nameStandard: 'X', skuCode: makeCuid() } });
    const foreignY = await db.product.create({ data: { clientId: otherClientId, nameStandard: 'Y', skuCode: makeCuid() } });
    await db.productMapping.create({ data: { clientId, chain: 'SORIANA', portalString: 'P', productId: skuX.id, status: 'CONFIRMED' } });
    mockSession(userId, clientId, email);
    const res = await PATCH(jsonReq('PATCH', { chain: 'SORIANA', portalString: 'P', oldProductId: skuX.id, newProductId: foreignY.id }));
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe('PRODUCT_NOT_FOUND');
  });

  it('200 { ok: true } on success — row re-pointed and CONFIRMED', async () => {
    const { userId, clientId, email } = await mkClient(`${PREFIX}7@test.local`, 'FF3 MAP PATCH 7');
    const skuX = await db.product.create({ data: { clientId, nameStandard: 'X', skuCode: makeCuid() } });
    const skuY = await db.product.create({ data: { clientId, nameStandard: 'Y', skuCode: makeCuid() } });
    await db.productMapping.create({ data: { clientId, chain: 'SORIANA', portalString: 'P', productId: skuX.id, status: 'PENDING_REVIEW' } });
    mockSession(userId, clientId, email);
    const res = await PATCH(jsonReq('PATCH', { chain: 'SORIANA', portalString: 'P', oldProductId: skuX.id, newProductId: skuY.id }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    const row = await db.productMapping.findFirst({ where: { clientId, chain: 'SORIANA', portalString: 'P' } });
    expect(row?.productId).toBe(skuY.id);
    expect(row?.status).toBe('CONFIRMED');
  });
});
