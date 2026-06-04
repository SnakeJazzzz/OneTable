import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';

// Block next-auth from initializing in the vitest env (it imports next/server
// which the test runner cannot resolve). The route under test does not call
// auth() — it only transitively imports it via lib/auth-helpers (errorResponse).
vi.mock('@/auth', () => ({
  auth: vi.fn(),
}));

import { POST } from '@/app/api/auth/signup/route';

const db = new PrismaClient();

// Use timestamped emails so reruns don't collide if cleanup fails.
const RUN_TAG = `g1-signup-${Date.now()}`;
const newEmail = (suffix: string) => `${RUN_TAG}-${suffix}@example.test`;

const createdEmails: string[] = [];

function jsonRequest(body: unknown): Request {
  return new Request('http://localhost/api/auth/signup', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/auth/signup', () => {
  beforeAll(async () => {
    // Defensive cleanup of stale rows from prior failed runs.
    await db.user.deleteMany({ where: { email: { startsWith: 'g1-signup-' } } });
  });

  afterEach(async () => {
    // Tear down rows created by this test block. Cascade onDelete will clear
    // the Client rows too.
    if (createdEmails.length > 0) {
      await db.user.deleteMany({ where: { email: { in: createdEmails } } });
      createdEmails.length = 0;
    }
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  it('creates User + Client atomically in a single operation', async () => {
    const email = newEmail('happy');
    createdEmails.push(email);

    const res = await POST(
      jsonRequest({ email, password: 'secret123', clientName: 'Acme Corp' }),
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; user: { id: string; email: string }; client: { id: string; name: string } };
    expect(body.ok).toBe(true);
    expect(body.user.email).toBe(email);
    expect(body.client.name).toBe('Acme Corp');

    // Verify both rows landed in DB and the Client is correctly linked.
    const user = await db.user.findUnique({
      where: { email },
      include: { clients: true },
    });
    expect(user).not.toBeNull();
    expect(user!.passwordHash).not.toBe('secret123');
    expect(user!.passwordHash.length).toBeGreaterThan(20);
    expect(user!.clients).toHaveLength(1);
    expect(user!.clients[0].name).toBe('Acme Corp');
    expect(user!.clients[0].userId).toBe(user!.id);

    // §4.5 lifecycle: the Client is born with a default ThresholdConfig.
    const tc = await db.thresholdConfig.findUnique({
      where: { clientId: user!.clients[0].id },
    });
    expect(tc).not.toBeNull();
    expect(tc!.criticoDays).toBe(7);
    expect(tc!.riesgoDays).toBe(14);
    expect(tc!.atencionDays).toBe(21);
    expect(tc!.excesoDays).toBe(60);
  });

  it('returns 409 when email already exists', async () => {
    const email = newEmail('dup');
    createdEmails.push(email);

    const first = await POST(
      jsonRequest({ email, password: 'secret123', clientName: 'First Co' }),
    );
    expect(first.status).toBe(200);

    const second = await POST(
      jsonRequest({ email, password: 'other456', clientName: 'Second Co' }),
    );
    expect(second.status).toBe(409);
    const body = (await second.json()) as { error: { code: string } };
    expect(body.error.code).toBe('EMAIL_TAKEN');

    // Confirm the second attempt didn't create a phantom client.
    const clients = await db.client.findMany({ where: { name: 'Second Co' } });
    expect(clients).toHaveLength(0);
  });

  it('returns 400 for invalid email', async () => {
    const res = await POST(
      jsonRequest({ email: 'not-an-email', password: 'secret123', clientName: 'X Co' }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('INVALID_EMAIL');
  });

  it('returns 400 for short password', async () => {
    const email = newEmail('shortpw');
    const res = await POST(
      jsonRequest({ email, password: '123', clientName: 'X Co' }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('INVALID_PASSWORD');
  });

  it('returns 400 for missing clientName', async () => {
    const email = newEmail('noname');
    const res = await POST(jsonRequest({ email, password: 'secret123' }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('INVALID_CLIENT_NAME');
  });
});
