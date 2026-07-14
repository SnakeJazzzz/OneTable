import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';

// Mock @/auth BEFORE importing the route handler — otherwise auth.ts runs
// for real and pulls a JWT cookie from a non-existent request.
vi.mock('@/auth', () => ({
  auth: vi.fn(),
}));

import { GET, PUT } from '@/app/api/portales/credentials/route';
import { auth } from '@/auth';

// NOTE: tests/api/portales-credentials.test.ts already covers the write
// contract at the DB level (upsert dedup, password-free guarantee). This
// file is the handler-level coverage (auth/validation/status codes) — FF-3
// item #1. Do not duplicate or modify the sibling file's assertions.
const db = new PrismaClient();
const EMAIL = 'ff3-creds-handler@test.local';

describe('portales/credentials handler (GET + PUT)', () => {
  let userId: string;
  let clientId: string;

  beforeAll(async () => {
    await db.user.deleteMany({ where: { email: EMAIL } });
    const u = await db.user.create({ data: { email: EMAIL, passwordHash: 'x' } });
    userId = u.id;
    const c = await db.client.create({ data: { name: 'FF3 CREDS HANDLER', userId } });
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

  function putReq(body: unknown): Request {
    return new Request('http://test/api/portales/credentials', {
      method: 'PUT',
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });
  }

  it('GET returns 401 when no session', async () => {
    vi.mocked(auth).mockResolvedValueOnce(null as any);
    const res = await GET();
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('PUT returns 400 INVALID_BODY for a non-JSON body', async () => {
    mockSession();
    const res = await PUT(putReq('not-json'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('INVALID_BODY');
  });

  it('PUT returns 400 INVALID_CHAIN for an unknown chain', async () => {
    mockSession();
    const res = await PUT(putReq({ chain: 'NOPE', username: 'viks' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('INVALID_CHAIN');
  });

  it('PUT returns 400 INVALID_USERNAME for a blank/whitespace username', async () => {
    mockSession();
    const res = await PUT(putReq({ chain: 'SORIANA', username: '   ' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('INVALID_USERNAME');
  });

  it('PUT returns 400 INVALID_USERNAME for an empty-string username', async () => {
    mockSession();
    const res = await PUT(putReq({ chain: 'SORIANA', username: '' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('INVALID_USERNAME');
  });

  it('PUT succeeds, upserts the row, hasPasswordPending stays true', async () => {
    mockSession();
    const res = await PUT(putReq({ chain: 'CHEDRAUI', username: 'viks-handler' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true });

    const row = await db.portalCredential.findUnique({
      where: { clientId_chain: { clientId, chain: 'CHEDRAUI' } },
    });
    expect(row?.username).toBe('viks-handler');
    expect(row?.hasPasswordPending).toBe(true);
  });
});
