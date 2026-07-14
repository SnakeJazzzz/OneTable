import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { makeCuid } from '@/core/ids';

// Mock @/auth BEFORE importing the route handler — otherwise auth.ts runs
// for real and pulls a JWT cookie from a non-existent request.
vi.mock('@/auth', () => ({
  auth: vi.fn(),
}));

// The POST endpoint (resolveConflict) is deliberately OUT of scope here — it's
// covered at the service level by tests/normalizer/resolve.test.ts. This file
// only exercises the GET handler.
import { GET } from '@/app/api/portales/conflicts/route';
import { auth } from '@/auth';

const db = new PrismaClient();
const EMAIL = 'ff3-conflicts@test.local';

describe('GET /api/portales/conflicts', () => {
  let userId: string;
  let clientId: string;

  beforeAll(async () => {
    await db.user.deleteMany({ where: { email: EMAIL } });
    const u = await db.user.create({ data: { email: EMAIL, passwordHash: 'x' } });
    userId = u.id;
    const c = await db.client.create({ data: { name: 'FF3 CONFLICTS', userId } });
    clientId = c.id;
  });

  afterAll(async () => {
    await db.user.deleteMany({ where: { email: EMAIL } });
    await db.$disconnect();
    vi.restoreAllMocks();
  });

  function mockSession() {
    vi.mocked(auth).mockResolvedValueOnce({
      user: { id: userId, clientId, email: EMAIL, name: 'Tester' },
      expires: new Date(Date.now() + 60_000).toISOString(),
    } as any);
  }
  function req(qs: string): Request {
    return new Request(`http://test/api/portales/conflicts${qs}`);
  }

  it('401 without session', async () => {
    vi.mocked(auth).mockResolvedValueOnce(null as any);
    const res = await GET(req('?chain=SORIANA'));
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe('UNAUTHORIZED');
  });

  it('400 INVALID_CHAIN for an unknown chain', async () => {
    mockSession();
    const res = await GET(req('?chain=NOPE'));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe('INVALID_CHAIN');
  });

  it('200 groups CONFLICTED rows by portalString, each with its candidate SKUs', async () => {
    const skuA = await db.product.create({ data: { clientId, nameStandard: 'A', skuCode: makeCuid() } });
    const skuB = await db.product.create({ data: { clientId, nameStandard: 'B', skuCode: makeCuid() } });
    await db.productMapping.create({ data: { clientId, chain: 'CHEDRAUI', portalString: 'CONF-P', productId: skuA.id, status: 'CONFLICTED' } });
    await db.productMapping.create({ data: { clientId, chain: 'CHEDRAUI', portalString: 'CONF-P', productId: skuB.id, status: 'CONFLICTED' } });
    // Non-conflicted sibling row must NOT bleed into the grouping.
    const skuOther = await db.product.create({ data: { clientId, nameStandard: 'Other', skuCode: makeCuid() } });
    await db.productMapping.create({ data: { clientId, chain: 'CHEDRAUI', portalString: 'CONFIRMED-STR', productId: skuOther.id, status: 'CONFIRMED' } });

    mockSession();
    const res = await GET(req('?chain=CHEDRAUI'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { conflicts: { portalString: string; candidates: { productId: string; nameStandard: string; skuCode: string }[] }[] };
    expect(body.conflicts).toHaveLength(1);
    expect(body.conflicts[0].portalString).toBe('CONF-P');
    expect(body.conflicts[0].candidates).toHaveLength(2);
    const candidateSkus = body.conflicts[0].candidates.map((c) => c.skuCode).sort();
    expect(candidateSkus).toEqual([skuA.skuCode, skuB.skuCode].sort());
  });
});
