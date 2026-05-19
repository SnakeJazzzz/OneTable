import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';

// Mock @/auth BEFORE importing the route handler — otherwise auth.ts runs
// for real and pulls a JWT cookie from a non-existent request.
vi.mock('@/auth', () => ({
  auth: vi.fn(),
}));

import { GET } from '@/app/api/clients/route';
import { auth } from '@/auth';

const db = new PrismaClient();
const TEST_EMAIL = 'test-api-clients-s12@example.com';

describe('GET /api/clients', () => {
  let userId: string;
  let clientId: string;

  beforeAll(async () => {
    await db.user.deleteMany({ where: { email: TEST_EMAIL } });
    const u = await db.user.create({ data: { email: TEST_EMAIL, passwordHash: 'x' } });
    userId = u.id;
    const c = await db.client.create({
      data: { name: 'TEST API CLIENT S12', email: 'tenant@example.com', userId },
    });
    clientId = c.id;
  });

  afterAll(async () => {
    await db.user.deleteMany({ where: { email: TEST_EMAIL } });
    await db.$disconnect();
    vi.restoreAllMocks();
  });

  it('returns 401 when no session', async () => {
    vi.mocked(auth).mockResolvedValueOnce(null as any);

    const res = await GET();
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('returns the authenticated user client', async () => {
    vi.mocked(auth).mockResolvedValueOnce({
      user: { id: userId, clientId, email: TEST_EMAIL, name: 'Tester' },
      expires: new Date(Date.now() + 60_000).toISOString(),
    } as any);

    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(clientId);
    expect(body.name).toBe('TEST API CLIENT S12');
    expect(body.email).toBe('tenant@example.com');
    expect(typeof body.createdAt).toBe('string');
    // Should NEVER leak passwordHash or other sensitive fields.
    expect(body).not.toHaveProperty('passwordHash');
    expect(body).not.toHaveProperty('userId');
  });

  it('returns 404 when session points at a non-existent client', async () => {
    vi.mocked(auth).mockResolvedValueOnce({
      user: { id: userId, clientId: 'cltzzz_nonexistent', email: TEST_EMAIL },
      expires: new Date(Date.now() + 60_000).toISOString(),
    } as any);

    const res = await GET();
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe('CLIENT_NOT_FOUND');
  });
});
