import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { makeCuid } from '@/core/ids';

// Mock @/auth BEFORE importing the route handler — otherwise auth.ts runs
// for real and pulls a JWT cookie from a non-existent request.
vi.mock('@/auth', () => ({
  auth: vi.fn(),
}));

import { GET } from '@/app/api/portales/counts/route';
import { auth } from '@/auth';

const db = new PrismaClient();
const EMAIL = 'ff3-counts@test.local';

describe('GET /api/portales/counts', () => {
  let userId: string;
  let clientId: string;

  beforeAll(async () => {
    await db.user.deleteMany({ where: { email: EMAIL } });
    const u = await db.user.create({ data: { email: EMAIL, passwordHash: 'x' } });
    userId = u.id;
    const c = await db.client.create({ data: { name: 'FF3 COUNTS', userId } });
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
    return new Request(`http://test/api/portales/counts${qs}`);
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

  it('200 returns { unmappedCount, pendingReviewCount, conflictCount } scoped to the chain', async () => {
    const skuA = await db.product.create({ data: { clientId, nameStandard: 'A', skuCode: makeCuid() } });
    const skuB = await db.product.create({ data: { clientId, nameStandard: 'B', skuCode: makeCuid() } });
    const up = await db.upload.create({
      data: { clientId, userId, chain: 'LA_COMER', fileType: 'MIXED', originalFilename: 'x', fileHash: makeCuid(), fileSizeBytes: 1, status: 'COMPLETED' },
    });
    // 2 unresolved unmapped, 1 resolved (must NOT count).
    await db.unmappedProduct.create({ data: { clientId, chain: 'LA_COMER', portalString: 'U1', firstSeenUploadId: up.id } });
    await db.unmappedProduct.create({ data: { clientId, chain: 'LA_COMER', portalString: 'U2', firstSeenUploadId: up.id } });
    await db.unmappedProduct.create({
      data: { clientId, chain: 'LA_COMER', portalString: 'U3', firstSeenUploadId: up.id, resolvedAt: new Date(), resolvedProductId: skuA.id },
    });
    // 1 PENDING_REVIEW mapping.
    await db.productMapping.create({ data: { clientId, chain: 'LA_COMER', portalString: 'PR1', productId: skuA.id, status: 'PENDING_REVIEW' } });
    // 1 conflicted portalString (2 CONFLICTED rows → distinct portalString count of 1).
    await db.productMapping.create({ data: { clientId, chain: 'LA_COMER', portalString: 'CF1', productId: skuA.id, status: 'CONFLICTED' } });
    await db.productMapping.create({ data: { clientId, chain: 'LA_COMER', portalString: 'CF1', productId: skuB.id, status: 'CONFLICTED' } });
    // Different chain — must not leak into the LA_COMER counts.
    const upSoriana = await db.upload.create({
      data: { clientId, userId, chain: 'SORIANA', fileType: 'MIXED', originalFilename: 'x', fileHash: makeCuid(), fileSizeBytes: 1, status: 'COMPLETED' },
    });
    await db.unmappedProduct.create({ data: { clientId, chain: 'SORIANA', portalString: 'OTHER-CHAIN', firstSeenUploadId: upSoriana.id } });

    mockSession();
    const res = await GET(req('?chain=LA_COMER'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ unmappedCount: 2, pendingReviewCount: 1, conflictCount: 1 });
  });
});
