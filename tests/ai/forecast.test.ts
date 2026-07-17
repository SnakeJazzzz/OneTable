// B5 T3 — forecasting gate scaffold tests (brief §4): getForecast (§9.2.1
// frozen design, gate-only), getForecastOverview (C2 aggregated listing) and
// GET /api/forecast.
//
// Integration style (pattern: tests/kpis/default-period.test.ts): real Neon
// dev DB with a disjoint email namespace + self-cleanup. Only @/auth is
// mocked (next-auth pulls 'next/server', unresolvable under vitest).
// @/core/forecast is spy-wrapped ({ spy: true }: real implementations, call
// tracking) so the route group can assert ONE getForecastOverview call and
// ZERO getForecast iteration.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';

vi.mock('@/auth', () => ({ auth: vi.fn() }));
vi.mock('@/core/forecast', { spy: true });

import { getForecast, getForecastOverview } from '@/core/forecast';
import { GET } from '@/app/api/forecast/route';
import { auth } from '@/auth';

const db = new PrismaClient();
const TEST_EMAIL_BASE = 'test-forecast-b5-t3';

// Mirrors the C1 rule for monthsAvailable = 0: current month + 3, YYYY-MM.
function currentMonthPlus3(): string {
  const now = new Date();
  const k = now.getFullYear() * 12 + now.getMonth() + 3;
  return `${Math.floor(k / 12)}-${String((k % 12) + 1).padStart(2, '0')}`;
}

let userIdA: string;
let clientIdA: string;
let userIdB: string;
let clientIdB: string;

// Client A products (ids resolved in beforeAll)
let pOne: string; // SORIANA 1 month / CHEDRAUI 2 months
let pThree: string; // SORIANA 3 months (≥3 stub)
let pZero: string; // SORIANA: salesUnits 0 + NULL + one real month
let pNone: string; // SORIANA: only salesUnits 0/NULL rows → 0 months
let pGap: string; // SORIANA: ene + mar (hole in feb)
let pMulti: string; // SORIANA 5 months + AMAZON 1 month
let pEmpty: string; // no SelloutData rows at all
// Client B product
let pB: string;

beforeAll(async () => {
  await db.user.deleteMany({ where: { email: { startsWith: TEST_EMAIL_BASE } } });

  // ── Client A ─────────────────────────────────────────────────────────────
  const uA = await db.user.create({
    data: { email: `${TEST_EMAIL_BASE}-a@example.com`, passwordHash: 'x' },
  });
  userIdA = uA.id;
  const cA = await db.client.create({ data: { name: 'FORECAST-A', userId: uA.id } });
  clientIdA = cA.id;

  const mk = (name: string, sku: string) =>
    db.product.create({ data: { clientId: cA.id, skuCode: sku, nameStandard: name } });
  pOne = (await mk('Forecast Uno', 'FC-UNO')).id;
  pThree = (await mk('Forecast Tres', 'FC-TRES')).id;
  pZero = (await mk('Forecast Zero', 'FC-ZERO')).id;
  pNone = (await mk('Forecast Nada', 'FC-NADA')).id;
  pGap = (await mk('Forecast Hueco', 'FC-HUECO')).id;
  pMulti = (await mk('Forecast Multi', 'FC-MULTI')).id;
  pEmpty = (await mk('Forecast Vacio', 'FC-VACIO')).id;

  const rowA = (
    productId: string | null,
    raw: string,
    chain: 'SORIANA' | 'CHEDRAUI' | 'AMAZON',
    periodYear: number,
    periodMonth: number,
    salesUnits: number | null,
  ) => ({
    clientId: cA.id,
    userId: uA.id,
    chain,
    productId,
    portalRawProduct: raw,
    storeId: chain === 'AMAZON' ? null : '001',
    periodYear,
    periodMonth,
    salesUnits,
    inventoryUnits: 20,
  });

  await db.selloutData.createMany({
    data: [
      // pOne: SORIANA 1 month; CHEDRAUI 2 months
      rowA(pOne, 'RAW-UNO', 'SORIANA', 2026, 1, 10),
      rowA(pOne, 'RAW-UNO', 'CHEDRAUI', 2026, 1, 8),
      rowA(pOne, 'RAW-UNO', 'CHEDRAUI', 2026, 2, 9),
      // pThree: SORIANA 3 consecutive months (≥3 stub edge)
      rowA(pThree, 'RAW-TRES', 'SORIANA', 2026, 1, 5),
      rowA(pThree, 'RAW-TRES', 'SORIANA', 2026, 2, 6),
      rowA(pThree, 'RAW-TRES', 'SORIANA', 2026, 3, 7),
      // pZero: 0-sales and NULL-sales months must NOT count; one real month
      rowA(pZero, 'RAW-ZERO', 'SORIANA', 2026, 1, 0),
      rowA(pZero, 'RAW-ZERO', 'SORIANA', 2026, 2, null),
      rowA(pZero, 'RAW-ZERO', 'SORIANA', 2026, 3, 5),
      // pNone: rows exist but never a real sale → 0 months available
      rowA(pNone, 'RAW-NADA', 'SORIANA', 2026, 1, 0),
      rowA(pNone, 'RAW-NADA', 'SORIANA', 2026, 2, null),
      // pGap: ene + mar (feb missing) → 2 months, nextEligible from MARCH
      rowA(pGap, 'RAW-HUECO', 'SORIANA', 2026, 1, 3),
      rowA(pGap, 'RAW-HUECO', 'SORIANA', 2026, 3, 4),
      // pMulti: SORIANA 5 months (2025-09..2026-01) + AMAZON 1 month
      rowA(pMulti, 'RAW-MULTI', 'SORIANA', 2025, 9, 1),
      rowA(pMulti, 'RAW-MULTI', 'SORIANA', 2025, 10, 2),
      rowA(pMulti, 'RAW-MULTI', 'SORIANA', 2025, 11, 3),
      rowA(pMulti, 'RAW-MULTI', 'SORIANA', 2025, 12, 4),
      rowA(pMulti, 'RAW-MULTI', 'SORIANA', 2026, 1, 5),
      rowA(pMulti, 'RAW-MULTI-AMZ', 'AMAZON', 2026, 1, 6),
      // Unmapped row (productId NULL) — must never reach the overview
      rowA(null, 'RAW-UNMAPPED', 'SORIANA', 2026, 1, 99),
    ],
  });

  // ── Client B (tenant isolation) ──────────────────────────────────────────
  const uB = await db.user.create({
    data: { email: `${TEST_EMAIL_BASE}-b@example.com`, passwordHash: 'x' },
  });
  userIdB = uB.id;
  const cB = await db.client.create({ data: { name: 'FORECAST-B', userId: uB.id } });
  clientIdB = cB.id;
  pB = (
    await db.product.create({
      data: { clientId: cB.id, skuCode: 'FC-B', nameStandard: 'Forecast B' },
    })
  ).id;
  await db.selloutData.createMany({
    data: [1, 2, 3].map((m) => ({
      clientId: cB.id,
      userId: uB.id,
      chain: 'SORIANA' as const,
      productId: pB,
      portalRawProduct: 'RAW-B',
      storeId: '001',
      periodYear: 2026,
      periodMonth: m,
      salesUnits: 10,
      inventoryUnits: 20,
    })),
  });
});

afterAll(async () => {
  await db.user.deleteMany({ where: { email: { startsWith: TEST_EMAIL_BASE } } });
  await db.$disconnect();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Group 1 — getForecast (gate per §9.2.1 + C1 nextEligible semantics)
// ---------------------------------------------------------------------------

describe('getForecast — gate + nextEligible (group 1)', () => {
  it('1 month → insufficient with nextEligible = last period + 2 (exact YYYY-MM)', async () => {
    const r = await getForecast(db, { clientId: clientIdA, productId: pOne, chain: 'SORIANA' });
    expect(r).toEqual({
      kind: 'insufficient',
      monthsAvailable: 1,
      monthsRequired: 3,
      nextEligible: '2026-03',
    });
  });

  it('2 months → insufficient with nextEligible = last period + 1 (exact YYYY-MM)', async () => {
    const r = await getForecast(db, { clientId: clientIdA, productId: pOne, chain: 'CHEDRAUI' });
    expect(r).toEqual({
      kind: 'insufficient',
      monthsAvailable: 2,
      monthsRequired: 3,
      nextEligible: '2026-03',
    });
  });

  it('3+ months → documented stub: still insufficient, REAL monthsAvailable', async () => {
    const r = await getForecast(db, { clientId: clientIdA, productId: pThree, chain: 'SORIANA' });
    expect(r.kind).toBe('insufficient');
    if (r.kind === 'insufficient') {
      expect(r.monthsAvailable).toBe(3);
      expect(r.monthsRequired).toBe(3);
    }
  });

  it('salesUnits 0 and NULL do not count as available months', async () => {
    const r = await getForecast(db, { clientId: clientIdA, productId: pZero, chain: 'SORIANA' });
    // Only 2026-03 (salesUnits 5) counts → 1 month, next eligible 2026-05.
    expect(r).toEqual({
      kind: 'insufficient',
      monthsAvailable: 1,
      monthsRequired: 3,
      nextEligible: '2026-05',
    });
  });

  it('series with a hole (ene + mar) → 2 months, nextEligible counted from MARCH', async () => {
    const r = await getForecast(db, { clientId: clientIdA, productId: pGap, chain: 'SORIANA' });
    expect(r).toEqual({
      kind: 'insufficient',
      monthsAvailable: 2,
      monthsRequired: 3,
      nextEligible: '2026-04', // 2026-03 (last real period) + (3 - 2)
    });
  });

  it('0 months (rows exist, never a real sale) → nextEligible = current month + 3', async () => {
    const r = await getForecast(db, { clientId: clientIdA, productId: pNone, chain: 'SORIANA' });
    expect(r).toEqual({
      kind: 'insufficient',
      monthsAvailable: 0,
      monthsRequired: 3,
      nextEligible: currentMonthPlus3(),
    });
  });

  it('0 months (no rows at all) → nextEligible = current month + 3', async () => {
    const r = await getForecast(db, { clientId: clientIdA, productId: pEmpty, chain: 'SORIANA' });
    expect(r).toEqual({
      kind: 'insufficient',
      monthsAvailable: 0,
      monthsRequired: 3,
      nextEligible: currentMonthPlus3(),
    });
  });

  it('granularity per chain: 5 months SORIANA vs 1 month AMAZON on the same product', async () => {
    const soriana = await getForecast(db, { clientId: clientIdA, productId: pMulti, chain: 'SORIANA' });
    const amazon = await getForecast(db, { clientId: clientIdA, productId: pMulti, chain: 'AMAZON' });
    expect(soriana.kind).toBe('insufficient');
    if (soriana.kind === 'insufficient') expect(soriana.monthsAvailable).toBe(5);
    expect(amazon).toEqual({
      kind: 'insufficient',
      monthsAvailable: 1,
      monthsRequired: 3,
      nextEligible: '2026-03',
    });
  });

  it('tenant isolation: client A cannot see client B rows through B productId', async () => {
    // pB has 3 SORIANA months under client B; queried AS client A the WHERE
    // clientId must zero it out.
    const asA = await getForecast(db, { clientId: clientIdA, productId: pB, chain: 'SORIANA' });
    expect(asA.kind).toBe('insufficient');
    if (asA.kind === 'insufficient') expect(asA.monthsAvailable).toBe(0);

    const asB = await getForecast(db, { clientId: clientIdB, productId: pB, chain: 'SORIANA' });
    if (asB.kind === 'insufficient') expect(asB.monthsAvailable).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Group 2 — getForecastOverview (C2: one aggregated query)
// ---------------------------------------------------------------------------

describe('getForecastOverview (group 2)', () => {
  it('returns one row per product×chain with correct counts, JOINed names and nextEligible', async () => {
    const rows = await getForecastOverview(db, { clientId: clientIdA });

    const key = (productId: string, chain: string) =>
      rows.find((r) => r.productId === productId && r.chain === chain);

    // Exactly the 8 product×chain combos with SelloutData: pOne×2, pThree,
    // pZero, pNone, pGap, pMulti×2 (pEmpty has no rows; unmapped excluded).
    expect(rows).toHaveLength(8);

    expect(key(pOne, 'SORIANA')).toEqual({
      productId: pOne,
      productName: 'Forecast Uno',
      chain: 'SORIANA',
      monthsAvailable: 1,
      nextEligible: '2026-03',
    });
    expect(key(pOne, 'CHEDRAUI')).toMatchObject({
      productName: 'Forecast Uno',
      monthsAvailable: 2,
      nextEligible: '2026-03',
    });
    expect(key(pThree, 'SORIANA')).toMatchObject({ monthsAvailable: 3 });
    // 0/NULL sales periods do not count in the aggregated query either.
    expect(key(pZero, 'SORIANA')).toMatchObject({
      monthsAvailable: 1,
      nextEligible: '2026-05',
    });
    // Group with zero real-sales periods still appears, C1 zero-anchor rule.
    expect(key(pNone, 'SORIANA')).toMatchObject({
      monthsAvailable: 0,
      nextEligible: currentMonthPlus3(),
    });
    expect(key(pGap, 'SORIANA')).toMatchObject({
      monthsAvailable: 2,
      nextEligible: '2026-04',
    });
    expect(key(pMulti, 'SORIANA')).toMatchObject({ monthsAvailable: 5 });
    expect(key(pMulti, 'AMAZON')).toMatchObject({
      monthsAvailable: 1,
      nextEligible: '2026-03',
    });
  });

  it('excludes unmapped rows (productId NULL) and products without data', async () => {
    const rows = await getForecastOverview(db, { clientId: clientIdA });
    // Every row carries a real product id + JOINed name.
    for (const r of rows) {
      expect(r.productId).toBeTruthy();
      expect(r.productName).toBeTruthy();
    }
    // The unmapped raw string never surfaces, and pEmpty (no rows) is absent.
    expect(rows.some((r) => r.productName === 'RAW-UNMAPPED')).toBe(false);
    expect(rows.some((r) => r.productId === pEmpty)).toBe(false);
  });

  it('tenant isolation: each client only sees its own rows', async () => {
    const rowsA = await getForecastOverview(db, { clientId: clientIdA });
    const rowsB = await getForecastOverview(db, { clientId: clientIdB });

    expect(rowsA.some((r) => r.productId === pB)).toBe(false);
    expect(rowsB).toHaveLength(1);
    expect(rowsB[0]).toMatchObject({
      productId: pB,
      productName: 'Forecast B',
      chain: 'SORIANA',
      monthsAvailable: 3,
    });
    expect(rowsB.some((r) => r.productId === pOne)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Group 3 — GET /api/forecast
// ---------------------------------------------------------------------------

describe('GET /api/forecast (group 3)', () => {
  beforeEach(() => {
    // Call-history reset only ({ spy: true } keeps the real implementations):
    // the route asserts below must not count group 1/2 direct calls.
    vi.clearAllMocks();
  });

  function mockSession(userId: string, clientId: string, email: string) {
    vi.mocked(auth).mockResolvedValueOnce({
      user: { id: userId, clientId, email },
      expires: new Date(Date.now() + 60_000).toISOString(),
    } as any);
  }

  it('401 without a session', async () => {
    vi.mocked(auth).mockResolvedValueOnce(null as any);
    const res = await GET(new Request('http://test/api/forecast'));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('returns the session client rows with the expected shape', async () => {
    mockSession(userIdA, clientIdA, `${TEST_EMAIL_BASE}-a@example.com`);
    const res = await GET(new Request('http://test/api/forecast'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      rows: Array<{
        productId: string;
        productName: string;
        chain: string;
        monthsAvailable: number;
        nextEligible: string;
      }>;
    };
    expect(body.rows).toHaveLength(8);
    for (const r of body.rows) {
      expect(typeof r.productId).toBe('string');
      expect(typeof r.productName).toBe('string');
      expect(typeof r.chain).toBe('string');
      expect(typeof r.monthsAvailable).toBe('number');
      expect(r.nextEligible).toMatch(/^\d{4}-\d{2}$/);
    }
  });

  it('uses the SESSION clientId — an injected ?clientId query param is inert', async () => {
    mockSession(userIdA, clientIdA, `${TEST_EMAIL_BASE}-a@example.com`);
    const res = await GET(
      new Request(`http://test/api/forecast?clientId=${clientIdB}&userId=evil`),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rows: Array<{ productId: string }> };
    // Client A's data, not B's.
    expect(body.rows.some((r) => r.productId === pOne)).toBe(true);
    expect(body.rows.some((r) => r.productId === pB)).toBe(false);
    expect(vi.mocked(getForecastOverview)).toHaveBeenCalledWith(
      expect.anything(),
      { clientId: clientIdA },
    );
  });

  it('makes exactly ONE getForecastOverview call and never iterates getForecast', async () => {
    mockSession(userIdA, clientIdA, `${TEST_EMAIL_BASE}-a@example.com`);
    const res = await GET(new Request('http://test/api/forecast'));
    expect(res.status).toBe(200);
    await res.json();
    expect(vi.mocked(getForecastOverview)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(getForecast)).not.toHaveBeenCalled();
  });
});
