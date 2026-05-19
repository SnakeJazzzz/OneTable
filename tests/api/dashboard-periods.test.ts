import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';

vi.mock('@/auth', () => ({
  auth: vi.fn(),
}));

import { GET } from '@/app/api/dashboard/periods/route';
import { auth } from '@/auth';

const db = new PrismaClient();
const TEST_EMAIL = 'test-api-dashboard-periods@example.com';

describe('GET /api/dashboard/periods', () => {
  let userId: string;
  let clientId: string;

  beforeAll(async () => {
    await db.user.deleteMany({ where: { email: TEST_EMAIL } });
    const u = await db.user.create({ data: { email: TEST_EMAIL, passwordHash: 'x' } });
    userId = u.id;
    const c = await db.client.create({ data: { name: 'TEST PERIODS', userId } });
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
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it('returns empty arrays when client has no SelloutData', async () => {
    mockSession();
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { periods: string[]; defaultPeriod: string | null };
    expect(body.periods).toEqual([]);
    expect(body.defaultPeriod).toBeNull();
  });

  it('returns periods desc + multi-chain-preferred defaultPeriod', async () => {
    // Seed 3 periods × 2 chains for multi-chain coverage on 2025-02 and 2025-03.
    // 2025-04 has only SORIANA → single chain.
    await db.selloutData.createMany({
      data: [
        // 2025-02 multi-chain
        {
          clientId,
          userId,
          chain: 'SORIANA',
          portalRawProduct: 'A',
          periodYear: 2025,
          periodMonth: 2,
          salesUnits: 10,
        },
        {
          clientId,
          userId,
          chain: 'CHEDRAUI',
          portalRawProduct: 'A',
          periodYear: 2025,
          periodMonth: 2,
          salesUnits: 5,
        },
        // 2025-03 multi-chain
        {
          clientId,
          userId,
          chain: 'SORIANA',
          portalRawProduct: 'A',
          periodYear: 2025,
          periodMonth: 3,
          salesUnits: 10,
        },
        {
          clientId,
          userId,
          chain: 'CHEDRAUI',
          portalRawProduct: 'A',
          periodYear: 2025,
          periodMonth: 3,
          salesUnits: 5,
        },
        // 2025-04 single-chain (SORIANA only)
        {
          clientId,
          userId,
          chain: 'SORIANA',
          portalRawProduct: 'A',
          periodYear: 2025,
          periodMonth: 4,
          salesUnits: 20,
        },
      ],
    });

    try {
      mockSession();
      const res = await GET();
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        periods: string[];
        defaultPeriod: string | null;
      };
      expect(body.periods).toEqual(['2025-04', '2025-03', '2025-02']);
      // Multi-chain-preferred: 2025-03 wins over single-chain 2025-04.
      expect(body.defaultPeriod).toBe('2025-03');
    } finally {
      await db.selloutData.deleteMany({ where: { clientId } });
    }
  });
});
