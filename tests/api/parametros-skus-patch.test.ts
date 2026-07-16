import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';

// Mock @/auth BEFORE importing the route handlers — otherwise auth.ts runs
// for real and pulls a JWT cookie from a non-existent request.
vi.mock('@/auth', () => ({
  auth: vi.fn(),
}));

import { PATCH } from '@/app/api/parametros/skus/[id]/route';
import { POST } from '@/app/api/parametros/skus/route';
import { auth } from '@/auth';

// Handler-level coverage for /api/parametros/skus (B5-3, item A1-bis).
//
// These tests PIN the current behavior of the PATCH price tri-state
// (absent → leave unchanged, ''/null → clear to NULL, value → write) and the
// POST omit semantics BEFORE the price parsing is unified onto lib/prices.ts
// (item A1). Cases "absent" vs "clear" are exactly where an inverted adapter
// mapping would silently wipe or preserve prices the wrong way around.
//
// NOTE on Decimal assertions: Prisma Decimal.toString() normalizes trailing
// zeros ('11.00' → '11'), so seeded prices use values whose canonical string
// is stable (e.g. '10.25').
const db = new PrismaClient();
const EMAIL = 'b5-3-skus@test.local';
const OTHER_EMAIL = 'b5-3-skus-other@test.local';

describe('parametros/skus handlers (PATCH price tri-state + POST omit)', () => {
  let userId: string;
  let clientId: string;
  // One product per mutating test so tests stay independent.
  let pUpdate: string; // PATCH writes a valid price
  let pAbsent: string; // key absent → price untouched
  let pClearEmpty: string; // key present with '' → price cleared
  let pClearNull: string; // key present with null → price cleared
  let pInvalid: string; // invalid price → 400, row intact
  // Other tenant
  let otherProductId: string;

  beforeAll(async () => {
    await db.user.deleteMany({ where: { email: { in: [EMAIL, OTHER_EMAIL] } } });
    const u = await db.user.create({ data: { email: EMAIL, passwordHash: 'x' } });
    userId = u.id;
    const c = await db.client.create({ data: { name: 'B5-3 SKUS', userId } });
    clientId = c.id;

    const mkProduct = (name: string, code: string) =>
      db.product.create({
        data: {
          clientId,
          nameStandard: name,
          skuCode: code,
          purchasePriceBase: '10.25',
          salePriceBase: '20.75',
        },
      });
    pUpdate = (await mkProduct('B53 UPDATE', 'B53-A')).id;
    pAbsent = (await mkProduct('B53 ABSENT', 'B53-B')).id;
    pClearEmpty = (await mkProduct('B53 CLEAR EMPTY', 'B53-C')).id;
    pClearNull = (await mkProduct('B53 CLEAR NULL', 'B53-D')).id;
    pInvalid = (await mkProduct('B53 INVALID', 'B53-E')).id;

    // Second tenant: its product must never be reachable through the main session.
    const u2 = await db.user.create({ data: { email: OTHER_EMAIL, passwordHash: 'x' } });
    const c2 = await db.client.create({ data: { name: 'B5-3 OTHER TENANT', userId: u2.id } });
    otherProductId = (
      await db.product.create({
        data: { clientId: c2.id, nameStandard: 'B53 AJENO', skuCode: 'B53-X' },
      })
    ).id;
  });

  afterAll(async () => {
    // Cascade from User wipes Client → Product.
    await db.user.deleteMany({ where: { email: { in: [EMAIL, OTHER_EMAIL] } } });
    await db.$disconnect();
    vi.restoreAllMocks();
  });

  function mockSession() {
    vi.mocked(auth).mockResolvedValueOnce({
      user: { id: userId, clientId, email: EMAIL, name: 'Tester' },
      expires: new Date(Date.now() + 60_000).toISOString(),
    } as any);
  }

  function patchReq(id: string, body: unknown) {
    const req = new Request(`http://test/api/parametros/skus/${id}`, {
      method: 'PATCH',
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });
    return PATCH(req, { params: { id } });
  }

  function postReq(body: unknown) {
    return POST(
      new Request('http://test/api/parametros/skus', {
        method: 'POST',
        body: typeof body === 'string' ? body : JSON.stringify(body),
      }),
    );
  }

  async function readPrices(id: string) {
    const row = await db.product.findUnique({
      where: { id },
      select: { purchasePriceBase: true, salePriceBase: true },
    });
    return {
      purchase: row?.purchasePriceBase?.toString() ?? null,
      sale: row?.salePriceBase?.toString() ?? null,
    };
  }

  // ---- PATCH: price tri-state ----

  it('PATCH with a valid price returns 200 and persists it', async () => {
    mockSession();
    const res = await patchReq(pUpdate, { purchasePriceBase: '33.25' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sku.purchasePriceBase).toBe('33.25');

    expect(await readPrices(pUpdate)).toEqual({ purchase: '33.25', sale: '20.75' });
  });

  it('PATCH with the price key ABSENT leaves the existing price intact', async () => {
    mockSession();
    // Only the name changes; both price keys are missing from the body.
    const res = await patchReq(pAbsent, { nameStandard: 'B53 ABSENT RENAMED' });
    expect(res.status).toBe(200);

    expect(await readPrices(pAbsent)).toEqual({ purchase: '10.25', sale: '20.75' });
  });

  it('PATCH with the price key present as "" clears the price to NULL', async () => {
    mockSession();
    const res = await patchReq(pClearEmpty, { purchasePriceBase: '' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sku.purchasePriceBase).toBeNull();

    expect(await readPrices(pClearEmpty)).toEqual({ purchase: null, sale: '20.75' });
  });

  it('PATCH with the price key present as null clears the price to NULL', async () => {
    mockSession();
    const res = await patchReq(pClearNull, { salePriceBase: null });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sku.salePriceBase).toBeNull();

    expect(await readPrices(pClearNull)).toEqual({ purchase: '10.25', sale: null });
  });

  it('PATCH with an invalid price returns 400 INVALID_PRICE and leaves the row intact', async () => {
    for (const bad of ['-5', 'abc', '10000000000']) {
      mockSession();
      const res = await patchReq(pInvalid, { purchasePriceBase: bad });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe('INVALID_PRICE');
    }
    expect(await readPrices(pInvalid)).toEqual({ purchase: '10.25', sale: '20.75' });
  });

  it('PATCH with a 3-decimal price returns 400 INVALID_PRICE (B5-3 A2: 2-decimal cap)', async () => {
    // Deliberate behavior change pinned here: pre-A2 "10.999" was accepted and
    // Postgres silently rounded it to 11.00 in numeric(12,2).
    mockSession();
    const res = await patchReq(pInvalid, { purchasePriceBase: '10.999' });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('INVALID_PRICE');
    expect(await readPrices(pInvalid)).toEqual({ purchase: '10.25', sale: '20.75' });
  });

  it('PATCH returns 404 NOT_FOUND for another tenant\'s SKU and for a nonexistent id', async () => {
    for (const id of [otherProductId, 'does-not-exist']) {
      mockSession();
      const res = await patchReq(id, { purchasePriceBase: '1.25' });
      expect(res.status).toBe(404);
      const body = await res.json();
      expect(body.error.code).toBe('NOT_FOUND');
    }
    // Cross-tenant write must not have landed.
    const other = await db.product.findUnique({
      where: { id: otherProductId },
      select: { purchasePriceBase: true },
    });
    expect(other?.purchasePriceBase).toBeNull();
  });

  // ---- POST: omit semantics on create ----

  it('POST with price keys omitted creates the SKU with NULL prices', async () => {
    mockSession();
    const res = await postReq({ nameStandard: 'B53 CREATED OMIT', skuCode: 'B53-P1' });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.sku.purchasePriceBase).toBeNull();
    expect(body.sku.salePriceBase).toBeNull();

    expect(await readPrices(body.sku.id)).toEqual({ purchase: null, sale: null });
  });

  it('POST with valid prices creates the SKU and persists them', async () => {
    mockSession();
    const res = await postReq({
      nameStandard: 'B53 CREATED PRICED',
      skuCode: 'B53-P2',
      purchasePriceBase: '12.25',
      salePriceBase: '24.75',
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.sku.purchasePriceBase).toBe('12.25');
    expect(body.sku.salePriceBase).toBe('24.75');
  });

  it('POST with an invalid price returns 400 INVALID_PRICE and creates nothing', async () => {
    mockSession();
    const res = await postReq({
      nameStandard: 'B53 NEVER CREATED',
      skuCode: 'B53-P3',
      purchasePriceBase: 'abc',
    });
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('INVALID_PRICE');

    const row = await db.product.findFirst({ where: { clientId, skuCode: 'B53-P3' } });
    expect(row).toBeNull();
  });
});
