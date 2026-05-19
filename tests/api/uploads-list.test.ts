import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';

vi.mock('@/auth', () => ({
  auth: vi.fn(),
}));

import { GET } from '@/app/api/uploads/route';
import { auth } from '@/auth';

const db = new PrismaClient();
const TEST_EMAIL = 'test-api-uploads-list@example.com';

describe('GET /api/uploads', () => {
  let userId: string;
  let clientId: string;

  beforeAll(async () => {
    await db.user.deleteMany({ where: { email: TEST_EMAIL } });
    const u = await db.user.create({ data: { email: TEST_EMAIL, passwordHash: 'x' } });
    userId = u.id;
    const c = await db.client.create({ data: { name: 'TEST UPLOADS LIST', userId } });
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

  it('returns empty array when client has no uploads', async () => {
    mockSession();
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { uploads: unknown[] };
    expect(body.uploads).toEqual([]);
  });

  it('returns uploads in desc order by uploadedAt', async () => {
    // Insert 3 uploads at different times. Sleep between to guarantee distinct
    // uploadedAt values (Postgres timestamp has microsecond precision but the
    // Prisma client may quantize on the same tick).
    const first = await db.upload.create({
      data: {
        clientId,
        userId,
        chain: 'SORIANA',
        fileType: 'MIXED',
        originalFilename: 'soriana-real.xlsx',
        fileHash: 'h1',
        fileSizeBytes: 100,
        status: 'COMPLETED',
        rowsTotal: 10,
        rowsInserted: 10,
      },
    });
    await new Promise((r) => setTimeout(r, 10));
    const second = await db.upload.create({
      data: {
        clientId,
        userId,
        chain: 'CHEDRAUI',
        fileType: 'MIXED',
        originalFilename: 'chedraui-real.xlsx',
        fileHash: 'h2',
        fileSizeBytes: 200,
        status: 'COMPLETED',
        rowsTotal: 20,
        rowsInserted: 15,
        rowsUpdated: 5,
      },
    });
    await new Promise((r) => setTimeout(r, 10));
    const third = await db.upload.create({
      data: {
        clientId,
        userId,
        chain: 'AMAZON',
        fileType: 'VENTAS',
        originalFilename: 'amazon-ventas-real.xlsx',
        fileHash: 'h3',
        fileSizeBytes: 300,
        status: 'FAILED',
        errorMessage: 'parse failed',
      },
    });

    try {
      mockSession();
      const res = await GET();
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        uploads: Array<{ id: string; chain: string; status: string; originalFilename: string }>;
      };
      expect(body.uploads).toHaveLength(3);
      // Most recent first.
      expect(body.uploads[0].id).toBe(third.id);
      expect(body.uploads[0].status).toBe('FAILED');
      expect(body.uploads[1].id).toBe(second.id);
      expect(body.uploads[2].id).toBe(first.id);
      expect(body.uploads[0].originalFilename).toBe('amazon-ventas-real.xlsx');
    } finally {
      await db.upload.deleteMany({ where: { clientId } });
    }
  });
});
