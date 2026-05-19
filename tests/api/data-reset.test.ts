import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';

vi.mock('@/auth', () => ({
  auth: vi.fn(),
}));

import { POST } from '@/app/api/data/reset/route';
import { auth } from '@/auth';

const db = new PrismaClient();

const RUN_TAG = `data-reset-${Date.now()}`;
const email = (suffix: string) => `${RUN_TAG}-${suffix}@example.test`;

describe('POST /api/data/reset', () => {
  beforeAll(async () => {
    await db.user.deleteMany({ where: { email: { startsWith: 'data-reset-' } } });
  });

  afterAll(async () => {
    await db.user.deleteMany({ where: { email: { startsWith: 'data-reset-' } } });
    await db.$disconnect();
    vi.restoreAllMocks();
  });

  function mockSession(userId: string, clientId: string, mail: string) {
    vi.mocked(auth).mockResolvedValueOnce({
      user: { id: userId, clientId, email: mail },
      expires: new Date(Date.now() + 60_000).toISOString(),
    } as any);
  }

  it('returns 401 when no session', async () => {
    vi.mocked(auth).mockResolvedValueOnce(null as any);
    const res = await POST();
    expect(res.status).toBe(401);
  });

  it('wipes SelloutData + UnmappedProduct + Upload for the current client', async () => {
    const u = await db.user.create({
      data: { email: email('single'), passwordHash: 'x' },
    });
    const c = await db.client.create({ data: { name: 'TEST RESET', userId: u.id } });

    // Seed: 1 Upload + 2 SelloutData rows + 1 UnmappedProduct
    const upload = await db.upload.create({
      data: {
        clientId: c.id,
        userId: u.id,
        chain: 'SORIANA',
        fileType: 'MIXED',
        originalFilename: 'reset.xlsx',
        fileHash: 'h',
        fileSizeBytes: 1,
      },
    });
    await db.selloutData.createMany({
      data: [
        {
          clientId: c.id,
          userId: u.id,
          chain: 'SORIANA',
          portalRawProduct: 'P1',
          periodYear: 2026,
          periodMonth: 1,
          salesUnits: 10,
        },
        {
          clientId: c.id,
          userId: u.id,
          chain: 'CHEDRAUI',
          portalRawProduct: 'P2',
          periodYear: 2026,
          periodMonth: 1,
          salesUnits: 5,
        },
      ],
    });
    await db.unmappedProduct.create({
      data: {
        clientId: c.id,
        chain: 'SORIANA',
        portalString: 'UNMAPPED',
        firstSeenUploadId: upload.id,
      },
    });

    try {
      mockSession(u.id, c.id, u.email);
      const res = await POST();
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        selloutRowsDeleted: number;
        unmappedDeleted: number;
        uploadsDeleted: number;
      };
      expect(body.selloutRowsDeleted).toBe(2);
      expect(body.unmappedDeleted).toBe(1);
      expect(body.uploadsDeleted).toBe(1);

      // Confirm the rows are actually gone.
      expect(await db.selloutData.count({ where: { clientId: c.id } })).toBe(0);
      expect(await db.upload.count({ where: { clientId: c.id } })).toBe(0);
      expect(await db.unmappedProduct.count({ where: { clientId: c.id } })).toBe(0);
    } finally {
      await db.user.delete({ where: { id: u.id } });
    }
  });

  it('does NOT touch another client when wiping (multi-tenant isolation)', async () => {
    // Client A — will get wiped.
    const ua = await db.user.create({
      data: { email: email('a'), passwordHash: 'x' },
    });
    const ca = await db.client.create({ data: { name: 'CLIENT A', userId: ua.id } });
    const uploadA = await db.upload.create({
      data: {
        clientId: ca.id,
        userId: ua.id,
        chain: 'SORIANA',
        fileType: 'MIXED',
        originalFilename: 'a.xlsx',
        fileHash: 'a',
        fileSizeBytes: 1,
      },
    });
    await db.selloutData.create({
      data: {
        clientId: ca.id,
        userId: ua.id,
        chain: 'SORIANA',
        portalRawProduct: 'A',
        periodYear: 2026,
        periodMonth: 1,
        salesUnits: 10,
      },
    });
    await db.unmappedProduct.create({
      data: {
        clientId: ca.id,
        chain: 'SORIANA',
        portalString: 'UNMAPPED A',
        firstSeenUploadId: uploadA.id,
      },
    });

    // Client B — must remain untouched.
    const ub = await db.user.create({
      data: { email: email('b'), passwordHash: 'x' },
    });
    const cb = await db.client.create({ data: { name: 'CLIENT B', userId: ub.id } });
    const uploadB = await db.upload.create({
      data: {
        clientId: cb.id,
        userId: ub.id,
        chain: 'CHEDRAUI',
        fileType: 'MIXED',
        originalFilename: 'b.xlsx',
        fileHash: 'b',
        fileSizeBytes: 1,
      },
    });
    await db.selloutData.create({
      data: {
        clientId: cb.id,
        userId: ub.id,
        chain: 'CHEDRAUI',
        portalRawProduct: 'B',
        periodYear: 2026,
        periodMonth: 1,
        salesUnits: 20,
      },
    });
    await db.unmappedProduct.create({
      data: {
        clientId: cb.id,
        chain: 'CHEDRAUI',
        portalString: 'UNMAPPED B',
        firstSeenUploadId: uploadB.id,
      },
    });

    try {
      // Authenticated as A — POST should wipe A only.
      mockSession(ua.id, ca.id, ua.email);
      const res = await POST();
      expect(res.status).toBe(200);

      // A wiped.
      expect(await db.selloutData.count({ where: { clientId: ca.id } })).toBe(0);
      expect(await db.upload.count({ where: { clientId: ca.id } })).toBe(0);
      expect(await db.unmappedProduct.count({ where: { clientId: ca.id } })).toBe(0);

      // B intact — this is the critical isolation assertion.
      expect(await db.selloutData.count({ where: { clientId: cb.id } })).toBe(1);
      expect(await db.upload.count({ where: { clientId: cb.id } })).toBe(1);
      expect(await db.unmappedProduct.count({ where: { clientId: cb.id } })).toBe(1);
    } finally {
      await db.user.delete({ where: { id: ua.id } });
      await db.user.delete({ where: { id: ub.id } });
    }
  });
});
