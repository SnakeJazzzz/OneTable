import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';

vi.mock('@/auth', () => ({
  auth: vi.fn(),
}));

import { GET } from '@/app/api/dashboard/onetable/route';
import { auth } from '@/auth';

const db = new PrismaClient();
const TEST_EMAIL = 'test-api-dashboard-onetable@example.com';

describe('GET /api/dashboard/onetable', () => {
  let userId: string;
  let clientId: string;

  beforeAll(async () => {
    await db.user.deleteMany({ where: { email: TEST_EMAIL } });
    const u = await db.user.create({ data: { email: TEST_EMAIL, passwordHash: 'x' } });
    userId = u.id;
    const c = await db.client.create({ data: { name: 'TEST ONETABLE', userId } });
    clientId = c.id;
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
    const res = await GET(new Request('http://test/api/dashboard/onetable'));
    expect(res.status).toBe(401);
  });

  it('returns empty arrays when client has no SelloutData', async () => {
    mockSession();
    const res = await GET(new Request('http://test/api/dashboard/onetable'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rows: unknown[]; period: null };
    expect(body.rows).toEqual([]);
    expect(body.period).toBeNull();
  });

  it('returns classified rows for the requested period', async () => {
    // Create a mapped Product so the Soriana row has isUnmapped=false.
    const mappedProduct = await db.product.create({
      data: { clientId, nameStandard: 'Producto Test Standard', skuCode: 'SKU-ONETABLE-1' },
    });
    await db.selloutData.createMany({
      data: [
        // Soriana / store A / mapped product (inv 50, sales 10 → days 150 → EXCESO)
        {
          clientId,
          userId,
          chain: 'SORIANA',
          productId: mappedProduct.id,
          portalRawProduct: 'Producto Test',
          storeId: 'A',
          storeName: 'TIENDA A',
          periodYear: 2026,
          periodMonth: 1,
          salesUnits: 10,
          salesAmountMxn: 500,
          inventoryUnits: 50,
        },
        // Chedraui / store B / unmapped (productId NULL → isUnmapped=true)
        {
          clientId,
          userId,
          chain: 'CHEDRAUI',
          portalRawProduct: 'PRODUCTO SIN MAPEAR',
          storeId: 'B',
          storeName: 'TIENDA B',
          periodYear: 2026,
          periodMonth: 1,
          salesUnits: 5,
          inventoryUnits: 0, // → SIN_STOCK
        },
      ],
    });
    // An unmapped-product entry exercises the unmapped path; the count itself
    // moved to /api/dashboard/kpis, so this route no longer reports it.
    const dummyUpload = await db.upload.create({
      data: {
        clientId,
        userId,
        chain: 'CHEDRAUI',
        fileType: 'MIXED',
        originalFilename: 'dummy.xlsx',
        fileHash: 'dh',
        fileSizeBytes: 1,
      },
    });
    await db.unmappedProduct.create({
      data: {
        clientId,
        chain: 'CHEDRAUI',
        portalString: 'PRODUCTO SIN MAPEAR',
        firstSeenUploadId: dummyUpload.id,
      },
    });

    try {
      mockSession();
      const res = await GET(
        new Request('http://test/api/dashboard/onetable?periodYear=2026&periodMonth=1'),
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        period: { year: number; month: number };
        rows: Array<{
          chain: string;
          storeName: string | null;
          productName: string;
          alert: string;
          isUnmapped: boolean;
          salesUnitsEstimated: boolean;
          daysOfInventory: number | null;
        }>;
      };
      expect(body.period).toEqual({ year: 2026, month: 1 });
      expect(body.rows).toHaveLength(2);

      const soriana = body.rows.find((r) => r.chain === 'SORIANA')!;
      expect(soriana.alert).toBe('EXCESO');
      expect(soriana.isUnmapped).toBe(false);
      expect(soriana.daysOfInventory).toBe(150);

      const chedraui = body.rows.find((r) => r.chain === 'CHEDRAUI')!;
      expect(chedraui.alert).toBe('SIN_STOCK');
      expect(chedraui.isUnmapped).toBe(true);
    } finally {
      await db.selloutData.deleteMany({ where: { clientId } });
      await db.unmappedProduct.deleteMany({ where: { clientId } });
      await db.upload.deleteMany({ where: { clientId } });
      await db.product.deleteMany({ where: { clientId } });
    }
  });
});
