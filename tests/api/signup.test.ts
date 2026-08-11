import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';

// Block next-auth from initializing in the vitest env (it imports next/server
// which the test runner cannot resolve). The route under test does not call
// auth() — it only transitively imports it via lib/auth-helpers (errorResponse).
vi.mock('@/auth', () => ({
  auth: vi.fn(),
}));

import { POST } from '@/app/api/auth/signup/route';
import { windowStartFor, AUTH_WINDOW_MS, AUTH_IP_LIMIT } from '@/lib/rate-limit';

const db = new PrismaClient();

// Use timestamped emails so reruns don't collide if cleanup fails.
const RUN_TAG = `g1-signup-${Date.now()}`;
const newEmail = (suffix: string) => `${RUN_TAG}-${suffix}@example.test`;
// Per-run unique IP: every POST consumes one unit of the signup:ip budget
// (T2 §5.4), so a shared 'unknown' bucket would accumulate across suite
// reruns inside one 15-min fixed window and eventually 429 unrelated tests.
const RUN_IP = `${RUN_TAG}-ip`;

const createdEmails: string[] = [];

function jsonRequest(body: unknown, ip: string = RUN_IP): Request {
  return new Request('http://localhost/api/auth/signup', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
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
    await db.rateLimit.deleteMany({ where: { key: { startsWith: 'g1-signup-' } } });
    await db.$disconnect();
  });

  it('creates User + Client atomically in a single operation', async () => {
    const email = newEmail('happy');
    createdEmails.push(email);

    const res = await POST(
      jsonRequest({ email, password: 'secret1234', clientName: 'Acme Corp' }),
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
    expect(user!.passwordHash).not.toBe('secret1234');
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
      jsonRequest({ email, password: 'secret1234', clientName: 'First Co' }),
    );
    expect(first.status).toBe(200);

    const second = await POST(
      jsonRequest({ email, password: 'other45678', clientName: 'Second Co' }),
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
      jsonRequest({ email: 'not-an-email', password: 'secret1234', clientName: 'X Co' }),
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

  // T2 §2.8 password policy boundaries: min 10 chars, cap 72 BYTES.
  it('returns 400 for a 9-char password (below the 10-char minimum)', async () => {
    const email = newEmail('pw9');
    const res = await POST(
      jsonRequest({ email, password: '123456789', clientName: 'X Co' }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('INVALID_PASSWORD');
  });

  it('accepts a password of exactly 10 chars', async () => {
    const email = newEmail('pw10');
    createdEmails.push(email);
    const res = await POST(
      jsonRequest({ email, password: '1234567890', clientName: 'X Co' }),
    );
    expect(res.status).toBe(200);
  });

  it('returns 400 for a password over 72 bytes (multibyte counts bytes, not chars)', async () => {
    const email = newEmail('pwbytes');
    // 25 emojis = 25 chars but 100 UTF-8 bytes — over the 72-byte bcrypt cap.
    const password = '\u{1F512}'.repeat(25);
    expect(Buffer.byteLength(password, 'utf8')).toBe(100);
    const res = await POST(
      jsonRequest({ email, password, clientName: 'X Co' }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('PASSWORD_TOO_LONG');
  });

  it('accepts a password of exactly 72 bytes', async () => {
    const email = newEmail('pw72');
    createdEmails.push(email);
    const res = await POST(
      jsonRequest({ email, password: 'a'.repeat(72), clientName: 'X Co' }),
    );
    expect(res.status).toBe(200);
  });

  it('returns 400 for missing clientName', async () => {
    const email = newEmail('noname');
    const res = await POST(jsonRequest({ email, password: 'secret1234' }));
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('INVALID_CLIENT_NAME');
  });

  // T2 §5.4: per-IP rate limit, same policy as login IP (20/15min), honest
  // 429 (unlike login's generic null — deliberate asymmetry, no account
  // oracle to protect on signup).
  it('returns 429 RATE_LIMITED when the IP is over the limit', async () => {
    const ip = `${RUN_TAG}-ip-limited`;
    // Exhaust the current fixed window for this IP; the next POST's consume
    // increments past the limit and must be rejected before any work.
    await db.rateLimit.create({
      data: {
        scope: 'signup:ip',
        key: ip,
        windowStart: windowStartFor(AUTH_WINDOW_MS),
        count: AUTH_IP_LIMIT,
      },
    });

    const email = newEmail('ratelimited');
    const res = await POST(
      jsonRequest({ email, password: 'secret1234', clientName: 'Limited Co' }, ip),
    );
    expect(res.status).toBe(429);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('RATE_LIMITED');

    // The rejected attempt never reached the DB write path.
    const user = await db.user.findUnique({ where: { email } });
    expect(user).toBeNull();
  });
});
