import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PrismaClient, type Chain } from '@prisma/client';

vi.mock('@/auth', () => ({
  auth: vi.fn(),
}));

import { GET } from '@/app/api/dashboard/kpis/route';
import { auth } from '@/auth';

const db = new PrismaClient();
const TEST_EMAIL = 'test-api-kpis-s12@example.com';

describe('GET /api/dashboard/kpis', () => {
  let userId: string;
  let clientId: string;

  beforeAll(async () => {
    await db.user.deleteMany({ where: { email: TEST_EMAIL } });
    const u = await db.user.create({ data: { email: TEST_EMAIL, passwordHash: 'x' } });
    userId = u.id;
    const c = await db.client.create({ data: { name: 'TEST API KPIS S12', userId } });
    clientId = c.id;

    const product = await db.product.create({ data: { clientId, nameStandard: 'PROD-X' } });
    const upload = await db.upload.create({
      data: {
        clientId,
        userId,
        chain: 'SORIANA' as Chain,
        fileType: 'MIXED',
        originalFilename: 'kpi-api-seed.xlsx',
        fileHash: 'api-kpis-s12-h1',
        fileSizeBytes: 1,
      },
    });

    // Minimal seed: 1 mapped + 1 unmapped row in 2025-04; 1 row in 2025-03
    // (for variationPct denominator).
    await db.selloutData.createMany({
      data: [
        {
          clientId, userId, uploadId: upload.id, chain: 'SORIANA',
          productId: product.id, portalRawProduct: 'PROD-X-SOR', storeId: '001',
          periodYear: 2025, periodMonth: 4,
          salesUnits: 100, salesAmountMxn: 1000, inventoryUnits: 50,
        },
        {
          clientId, userId, uploadId: upload.id, chain: 'AMAZON',
          productId: null, portalRawProduct: 'ASIN-UNK', storeId: null,
          periodYear: 2025, periodMonth: 4,
          salesUnits: 10, salesAmountMxn: 100, inventoryUnits: 5,
        },
        {
          clientId, userId, uploadId: upload.id, chain: 'SORIANA',
          productId: product.id, portalRawProduct: 'PROD-X-SOR', storeId: '001',
          periodYear: 2025, periodMonth: 3,
          salesUnits: 50, salesAmountMxn: 500, inventoryUnits: 100,
        },
      ],
    });
  });

  afterAll(async () => {
    await db.user.deleteMany({ where: { email: TEST_EMAIL } });
    await db.$disconnect();
    vi.restoreAllMocks();
  });

  function mockSession() {
    vi.mocked(auth).mockResolvedValueOnce({
      user: { id: userId, clientId, email: TEST_EMAIL },
      expires: new Date(Date.now() + 60_000).toISOString(),
    } as any);
  }

  it('returns 401 when no session', async () => {
    vi.mocked(auth).mockResolvedValueOnce(null as any);

    const res = await GET(new Request('http://test/api/dashboard/kpis'));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('returns full payload with explicit periodYear/periodMonth', async () => {
    mockSession();

    const res = await GET(
      new Request('http://test/api/dashboard/kpis?periodYear=2025&periodMonth=4'),
    );
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.noData).toBe(false);
    expect(body.period).toEqual({ year: 2025, month: 4 });

    // 6 sections present (per spec §12 / S12 step 8).
    expect(body).toHaveProperty('kpis');
    expect(body).toHaveProperty('trend');
    expect(body).toHaveProperty('byChain');
    expect(body).toHaveProperty('semaforo');
    expect(body).toHaveProperty('topSkus');
    expect(body).toHaveProperty('daysInv');

    expect(body.kpis.salesAmountMxn).toBe(1100); // 1000 + 100
    expect(body.kpis.salesUnits).toBe(110); // 100 + 10
    // variation = (1100 - 500) / 500 * 100 = 120
    expect(body.kpis.variationPct).toBeCloseTo(120, 5);
  });

  it('auto-detects latest period when params absent', async () => {
    mockSession();
    const res = await GET(new Request('http://test/api/dashboard/kpis'));
    expect(res.status).toBe(200);
    const body = await res.json();
    // Latest seeded period is 2025-04.
    expect(body.period).toEqual({ year: 2025, month: 4 });
    expect(body.noData).toBe(false);
  });

  it('returns noData=true when client has zero rows (empty state)', async () => {
    // Use a fresh client with no SelloutData.
    const u = await db.user.create({
      data: { email: 'test-api-kpis-empty-s12@example.com', passwordHash: 'x' },
    });
    const c = await db.client.create({ data: { name: 'EMPTY CLIENT', userId: u.id } });
    try {
      vi.mocked(auth).mockResolvedValueOnce({
        user: { id: u.id, clientId: c.id, email: u.email },
        expires: new Date(Date.now() + 60_000).toISOString(),
      } as any);

      const res = await GET(new Request('http://test/api/dashboard/kpis'));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.noData).toBe(true);
      expect(body.period).toBeNull();
      expect(body.kpis.salesAmountMxn).toBe(0);
      expect(body.kpis.salesUnits).toBe(0);
      expect(body.trend).toEqual([]);
      expect(body.byChain).toEqual([]);
      expect(body.semaforo).toEqual([]);
      expect(body.topSkus).toEqual([]);
      expect(body.daysInv).toEqual([]);
    } finally {
      await db.user.delete({ where: { id: u.id } });
    }
  });
});
