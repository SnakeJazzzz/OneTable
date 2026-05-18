import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PrismaClient, type Chain } from '@prisma/client';

vi.mock('@/auth', () => ({ auth: vi.fn() }));

import { getDefaultPeriod } from '@/core/kpis/queries';
import { GET } from '@/app/api/dashboard/kpis/route';
import { auth } from '@/auth';

const db = new PrismaClient();
const TEST_EMAIL_BASE = 'test-default-period-s12-1';

// Each test uses an isolated user+client because the scenarios (multi-chain
// available, single-chain only, empty) require different seed states.
describe('getDefaultPeriod (S12.1) + /api/dashboard/kpis default resolution', () => {
  let userIdMulti: string;
  let clientIdMulti: string;
  let userIdSingle: string;
  let clientIdSingle: string;
  let userIdEmpty: string;
  let clientIdEmpty: string;

  beforeAll(async () => {
    await db.user.deleteMany({
      where: { email: { startsWith: TEST_EMAIL_BASE } },
    });

    // ── Scenario A: multi-chain coverage ────────────────────────────────────
    // 2026-01: SORIANA + CHEDRAUI + AMAZON (3 chains)
    // 2026-03: SORIANA only (1 chain) — newer but single-chain
    // Expected default: 2026-01 (latest multi-chain, NOT 2026-03)
    const uA = await db.user.create({
      data: { email: `${TEST_EMAIL_BASE}-multi@example.com`, passwordHash: 'x' },
    });
    userIdMulti = uA.id;
    const cA = await db.client.create({ data: { name: 'MULTI', userId: uA.id } });
    clientIdMulti = cA.id;
    const upA = await db.upload.create({
      data: {
        clientId: cA.id, userId: uA.id, chain: 'SORIANA' as Chain,
        fileType: 'MIXED', originalFilename: 'a.xlsx', fileHash: 'a-h', fileSizeBytes: 1,
      },
    });
    await db.selloutData.createMany({
      data: [
        // 2026-01 multi-chain
        { clientId: cA.id, userId: uA.id, uploadId: upA.id, chain: 'SORIANA',  productId: null, portalRawProduct: 'A-SOR', storeId: '001', periodYear: 2026, periodMonth: 1, salesUnits: 10, inventoryUnits: 20 },
        { clientId: cA.id, userId: uA.id, uploadId: upA.id, chain: 'CHEDRAUI', productId: null, portalRawProduct: 'A-CHE', storeId: '001', periodYear: 2026, periodMonth: 1, salesUnits: 10, inventoryUnits: 20 },
        { clientId: cA.id, userId: uA.id, uploadId: upA.id, chain: 'AMAZON',   productId: null, portalRawProduct: 'A-AMZ', storeId: null,  periodYear: 2026, periodMonth: 1, salesUnits: 10, inventoryUnits: 20 },
        // 2026-03 single-chain (newer)
        { clientId: cA.id, userId: uA.id, uploadId: upA.id, chain: 'SORIANA',  productId: null, portalRawProduct: 'A-SOR', storeId: '002', periodYear: 2026, periodMonth: 3, salesUnits: 10, inventoryUnits: 20 },
      ],
    });

    // ── Scenario B: single-chain only ───────────────────────────────────────
    // All rows are SORIANA. getDefaultPeriod must fall back to the latest single-chain period.
    const uB = await db.user.create({
      data: { email: `${TEST_EMAIL_BASE}-single@example.com`, passwordHash: 'x' },
    });
    userIdSingle = uB.id;
    const cB = await db.client.create({ data: { name: 'SINGLE', userId: uB.id } });
    clientIdSingle = cB.id;
    const upB = await db.upload.create({
      data: {
        clientId: cB.id, userId: uB.id, chain: 'SORIANA' as Chain,
        fileType: 'MIXED', originalFilename: 'b.xlsx', fileHash: 'b-h', fileSizeBytes: 1,
      },
    });
    await db.selloutData.createMany({
      data: [
        { clientId: cB.id, userId: uB.id, uploadId: upB.id, chain: 'SORIANA', productId: null, portalRawProduct: 'B-SOR', storeId: '001', periodYear: 2025, periodMonth: 12, salesUnits: 10, inventoryUnits: 20 },
        { clientId: cB.id, userId: uB.id, uploadId: upB.id, chain: 'SORIANA', productId: null, portalRawProduct: 'B-SOR', storeId: '001', periodYear: 2026, periodMonth: 2, salesUnits: 10, inventoryUnits: 20 },
      ],
    });

    // ── Scenario C: empty client ────────────────────────────────────────────
    const uC = await db.user.create({
      data: { email: `${TEST_EMAIL_BASE}-empty@example.com`, passwordHash: 'x' },
    });
    userIdEmpty = uC.id;
    const cC = await db.client.create({ data: { name: 'EMPTY', userId: uC.id } });
    clientIdEmpty = cC.id;
  });

  afterAll(async () => {
    await db.user.deleteMany({
      where: { email: { startsWith: TEST_EMAIL_BASE } },
    });
    await db.$disconnect();
    vi.restoreAllMocks();
  });

  it('returns the latest multi-chain period when one exists (skipping newer single-chain)', async () => {
    const result = await getDefaultPeriod(db, { clientId: clientIdMulti, userId: userIdMulti });
    expect(result).toEqual({ periodYear: 2026, periodMonth: 1 });
    // Not 2026-03 (newer but single-chain).
  });

  it('falls back to the latest period when no multi-chain period exists', async () => {
    const result = await getDefaultPeriod(db, { clientId: clientIdSingle, userId: userIdSingle });
    expect(result).toEqual({ periodYear: 2026, periodMonth: 2 });
  });

  it('returns null when the client has no SelloutData rows', async () => {
    const result = await getDefaultPeriod(db, { clientId: clientIdEmpty, userId: userIdEmpty });
    expect(result).toBeNull();
  });

  it('/api/dashboard/kpis without query params resolves to the multi-chain period (S12.1)', async () => {
    vi.mocked(auth).mockResolvedValueOnce({
      user: { id: userIdMulti, clientId: clientIdMulti, email: `${TEST_EMAIL_BASE}-multi@example.com` },
      expires: new Date(Date.now() + 60_000).toISOString(),
    } as any);

    const res = await GET(new Request('http://test/api/dashboard/kpis'));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.noData).toBe(false);
    // Period should be 2026-01 (multi-chain), NOT 2026-03 (newer but single-chain).
    expect(body.period).toEqual({ year: 2026, month: 1 });
  });
});
