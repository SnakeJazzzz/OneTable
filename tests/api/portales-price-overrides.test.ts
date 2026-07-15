import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';

// Mock @/auth BEFORE importing the route handler — otherwise auth.ts runs
// for real and pulls a JWT cookie from a non-existent request.
vi.mock('@/auth', () => ({
  auth: vi.fn(),
}));

import { GET, PUT } from '@/app/api/portales/price-overrides/route';
import { auth } from '@/auth';

// Handler-level coverage for /api/portales/price-overrides (B5-2):
// auth / validation / status codes / declarative-PUT write semantics.
// The read-side consumption of the rows is covered by tests/kpis/money-cascade.
//
// NOTE on Decimal assertions: Prisma Decimal.toString() normalizes trailing
// zeros ('11.00' → '11'), so seeded prices use values whose canonical string
// is stable (e.g. '11.25').
const db = new PrismaClient();
const EMAIL = 'b5-2-overrides@test.local';
const OTHER_EMAIL = 'b5-2-overrides-other@test.local';

describe('portales/price-overrides handler (GET + PUT)', () => {
  let userId: string;
  let clientId: string;
  // Main tenant products (one per write-path test so tests stay independent).
  let pWith: string; // has a SORIANA override seeded (GET merge)
  let pWithout: string; // no override (GET merge)
  let pCreate: string; // PUT creates a new row
  let pUpdate: string; // PUT updates an existing row (upsert)
  let pDelete: string; // PUT with both nulls deletes the row
  let pPurchaseOnly: string; // purchase-only override persists
  let pIntact: string; // missing-key 400 leaves the existing row intact
  // Other tenant
  let otherProductId: string;

  beforeAll(async () => {
    await db.user.deleteMany({ where: { email: { in: [EMAIL, OTHER_EMAIL] } } });
    const u = await db.user.create({ data: { email: EMAIL, passwordHash: 'x' } });
    userId = u.id;
    const c = await db.client.create({ data: { name: 'B5-2 OVERRIDES', userId } });
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
    pWith = (await mkProduct('B52 WITH OVERRIDE', 'B52-A')).id;
    pWithout = (await mkProduct('B52 WITHOUT OVERRIDE', 'B52-B')).id;
    pCreate = (await mkProduct('B52 CREATE', 'B52-C')).id;
    pUpdate = (await mkProduct('B52 UPDATE', 'B52-D')).id;
    pDelete = (await mkProduct('B52 DELETE', 'B52-E')).id;
    pPurchaseOnly = (await mkProduct('B52 PURCHASE ONLY', 'B52-F')).id;
    pIntact = (await mkProduct('B52 INTACT', 'B52-G')).id;

    await db.productPriceOverride.createMany({
      data: [
        { productId: pWith, chain: 'SORIANA', purchasePrice: '11.25', salePrice: '22.75' },
        { productId: pIntact, chain: 'SORIANA', purchasePrice: '5.25', salePrice: '6.75' },
      ],
    });

    // Second tenant: its product must never surface through the main session.
    const u2 = await db.user.create({ data: { email: OTHER_EMAIL, passwordHash: 'x' } });
    const c2 = await db.client.create({ data: { name: 'B5-2 OTHER TENANT', userId: u2.id } });
    otherProductId = (
      await db.product.create({
        data: { clientId: c2.id, nameStandard: 'B52 AJENO', skuCode: 'B52-X' },
      })
    ).id;
  });

  afterAll(async () => {
    // Cascade from User wipes Client → Product → ProductPriceOverride.
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

  function getReq(chain: string): Request {
    return new Request(`http://test/api/portales/price-overrides?chain=${chain}`);
  }

  function putReq(body: unknown): Request {
    return new Request('http://test/api/portales/price-overrides', {
      method: 'PUT',
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });
  }

  // ---- GET ----

  it('GET returns 401 when no session', async () => {
    vi.mocked(auth).mockResolvedValueOnce(null as any);
    const res = await GET(getReq('SORIANA'));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('GET returns 400 INVALID_CHAIN for an unknown chain', async () => {
    mockSession();
    const res = await GET(getReq('NOPE'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('INVALID_CHAIN');
  });

  it('GET returns the full catalog with the chain override merged per product', async () => {
    mockSession();
    const res = await GET(getReq('SORIANA'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      rows: Array<{
        productId: string;
        skuCode: string;
        nameStandard: string;
        purchasePriceBase: string | null;
        salePriceBase: string | null;
        override: { purchasePrice: string | null; salePrice: string | null } | null;
      }>;
    };
    const byId = Object.fromEntries(body.rows.map((r) => [r.productId, r]));

    // Product WITH an override: base + override merged, prices as strings.
    expect(byId[pWith]).toBeDefined();
    expect(byId[pWith].skuCode).toBe('B52-A');
    expect(byId[pWith].purchasePriceBase).toBe('10.25');
    expect(byId[pWith].salePriceBase).toBe('20.75');
    expect(byId[pWith].override).toEqual({ purchasePrice: '11.25', salePrice: '22.75' });

    // Product WITHOUT an override, in the SAME payload: override is null.
    expect(byId[pWithout]).toBeDefined();
    expect(byId[pWithout].override).toBeNull();
  });

  it('GET never surfaces another tenant\'s product', async () => {
    mockSession();
    const res = await GET(getReq('SORIANA'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rows: Array<{ productId: string }> };
    expect(body.rows.some((r) => r.productId === otherProductId)).toBe(false);
  });

  // ---- PUT ----

  it('PUT returns 401 when no session', async () => {
    vi.mocked(auth).mockResolvedValueOnce(null as any);
    const res = await PUT(
      putReq({ chain: 'SORIANA', productId: pCreate, purchasePrice: null, salePrice: null }),
    );
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('PUT returns 400 INVALID_BODY for a non-JSON body', async () => {
    mockSession();
    const res = await PUT(putReq('not-json'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('INVALID_BODY');
  });

  it('PUT returns 400 INVALID_BODY for valid-JSON non-object bodies (null / string / number)', async () => {
    // These parse fine ('null', '"str"', '5') but a `in` check on them would
    // throw — the route must answer with the contract's 400, never a raw 500.
    for (const raw of [JSON.stringify(null), JSON.stringify('str'), JSON.stringify(5)]) {
      mockSession();
      const res = await PUT(putReq(raw));
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe('INVALID_BODY');
    }
  });

  it('PUT returns 400 INVALID_BODY when a key is absent — and the existing row stays intact', async () => {
    mockSession();
    // salePrice key MISSING (the other three present): must be rejected, never
    // interpreted as null — otherwise this call would silently wipe salePrice.
    const res = await PUT(putReq({ chain: 'SORIANA', productId: pIntact, purchasePrice: '55.25' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('INVALID_BODY');

    const row = await db.productPriceOverride.findUnique({
      where: { productId_chain: { productId: pIntact, chain: 'SORIANA' } },
    });
    expect(row?.purchasePrice?.toString()).toBe('5.25');
    expect(row?.salePrice?.toString()).toBe('6.75');
  });

  it('PUT returns 400 INVALID_CHAIN for an unknown chain', async () => {
    mockSession();
    const res = await PUT(
      putReq({ chain: 'NOPE', productId: pCreate, purchasePrice: '1.25', salePrice: null }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('INVALID_CHAIN');
  });

  it('PUT returns 400 INVALID_PRICE for negative / non-numeric / overflow values', async () => {
    for (const bad of ['-5', 'abc', '10000000000']) {
      mockSession();
      const res = await PUT(
        putReq({ chain: 'SORIANA', productId: pCreate, purchasePrice: bad, salePrice: null }),
      );
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error.code).toBe('INVALID_PRICE');
    }
  });

  it('PUT returns 404 PRODUCT_NOT_FOUND for another tenant\'s product', async () => {
    mockSession();
    const res = await PUT(
      putReq({ chain: 'SORIANA', productId: otherProductId, purchasePrice: '1.25', salePrice: null }),
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe('PRODUCT_NOT_FOUND');

    // Cross-tenant write must not have landed.
    const row = await db.productPriceOverride.findUnique({
      where: { productId_chain: { productId: otherProductId, chain: 'SORIANA' } },
    });
    expect(row).toBeNull();
  });

  it('PUT returns 404 PRODUCT_NOT_FOUND for a nonexistent product', async () => {
    mockSession();
    const res = await PUT(
      putReq({ chain: 'SORIANA', productId: 'does-not-exist', purchasePrice: '1.25', salePrice: null }),
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe('PRODUCT_NOT_FOUND');
  });

  it('PUT creates a new override row', async () => {
    mockSession();
    const res = await PUT(
      putReq({ chain: 'SORIANA', productId: pCreate, purchasePrice: '12.34', salePrice: '56.78' }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });

    const row = await db.productPriceOverride.findUnique({
      where: { productId_chain: { productId: pCreate, chain: 'SORIANA' } },
    });
    expect(row?.purchasePrice?.toString()).toBe('12.34');
    expect(row?.salePrice?.toString()).toBe('56.78');
  });

  it('PUT updates an existing row in place (upsert)', async () => {
    mockSession();
    const res1 = await PUT(
      putReq({ chain: 'SORIANA', productId: pUpdate, purchasePrice: '1.25', salePrice: '2.75' }),
    );
    expect(res1.status).toBe(200);

    mockSession();
    const res2 = await PUT(
      putReq({ chain: 'SORIANA', productId: pUpdate, purchasePrice: '3.25', salePrice: '4.75' }),
    );
    expect(res2.status).toBe(200);

    const rows = await db.productPriceOverride.findMany({
      where: { productId: pUpdate, chain: 'SORIANA' },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].purchasePrice?.toString()).toBe('3.25');
    expect(rows[0].salePrice?.toString()).toBe('4.75');
  });

  it('PUT with both prices null deletes the row; a later GET reflects override: null', async () => {
    mockSession();
    const res1 = await PUT(
      putReq({ chain: 'SORIANA', productId: pDelete, purchasePrice: '7.25', salePrice: '8.75' }),
    );
    expect(res1.status).toBe(200);

    mockSession();
    const res2 = await PUT(
      putReq({ chain: 'SORIANA', productId: pDelete, purchasePrice: null, salePrice: null }),
    );
    expect(res2.status).toBe(200);
    expect(await res2.json()).toEqual({ ok: true });

    const row = await db.productPriceOverride.findUnique({
      where: { productId_chain: { productId: pDelete, chain: 'SORIANA' } },
    });
    expect(row).toBeNull();

    // Deleting an absent row is idempotent (§4.3: absence = base).
    mockSession();
    const res3 = await PUT(
      putReq({ chain: 'SORIANA', productId: pDelete, purchasePrice: null, salePrice: null }),
    );
    expect(res3.status).toBe(200);

    mockSession();
    const getRes = await GET(getReq('SORIANA'));
    const body = (await getRes.json()) as {
      rows: Array<{ productId: string; override: unknown }>;
    };
    const row2 = body.rows.find((r) => r.productId === pDelete);
    expect(row2).toBeDefined();
    expect(row2?.override).toBeNull();
  });

  it('PUT persists a purchase-only override (salePrice stays NULL)', async () => {
    mockSession();
    const res = await PUT(
      putReq({ chain: 'SORIANA', productId: pPurchaseOnly, purchasePrice: '9.25', salePrice: null }),
    );
    expect(res.status).toBe(200);

    const row = await db.productPriceOverride.findUnique({
      where: { productId_chain: { productId: pPurchaseOnly, chain: 'SORIANA' } },
    });
    expect(row).not.toBeNull();
    expect(row?.purchasePrice?.toString()).toBe('9.25');
    expect(row?.salePrice).toBeNull();
  });
});
