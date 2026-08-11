/**
 * Tests for auth.ts (hardening T2, Tandas A + B):
 *   - session config: maxAge 86400 only — updateAge was dropped in Tanda B
 *     (NO-OP under the JWT strategy; ledger D1)
 *   - dummy bcrypt.compare timing equalizer in authorize() (§2.6):
 *     unknown email and user-without-clients BOTH run compare() and
 *     return null.
 *   - login rate limiting (§5.3): peek before lookup, failures recorded in
 *     both scopes, success does not increment, rate-limited returns the
 *     same generic null WITHOUT touching the users table.
 *
 * auth.ts calls NextAuth() at module load, and next-auth imports
 * next/server which the vitest runner cannot resolve. So we mock the
 * next-auth entry points: NextAuth becomes a capture-the-config stub and
 * the Credentials provider factory becomes the identity function — which
 * gives the test the REAL provider config (with the real authorize())
 * without restructuring auth.ts.
 *
 * Every authorize() call passes a Request with a per-run unique
 * x-forwarded-for: without it the IP scope key falls back to the shared
 * 'unknown' bucket, and repeated suite runs inside one 15-min fixed window
 * would accumulate failures until the IP limit (20) starts blocking tests.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';

// vi.mock factories are hoisted above module-level consts — vi.hoisted keeps
// the spy reference valid inside them.
const { nextAuthSpy } = vi.hoisted(() => ({
  nextAuthSpy: vi.fn((_config: unknown) => ({
    handlers: {},
    auth: vi.fn(),
    signIn: vi.fn(),
    signOut: vi.fn(),
  })),
}));

vi.mock('next-auth', () => ({ default: nextAuthSpy }));
// Identity: the provider "factory" returns its config untouched so the
// test can reach the real authorize().
vi.mock('next-auth/providers/credentials', () => ({
  default: (config: unknown) => config,
}));

// Spy on bcryptjs.compare while keeping the real implementation — the
// dummy-compare assertions need call counts, the wrong-password path needs
// real bcrypt semantics.
vi.mock('bcryptjs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('bcryptjs')>();
  return { ...actual, compare: vi.fn(actual.compare) };
});

import { compare } from 'bcryptjs';
// auth.ts and lib/rate-limit.ts read/write through this singleton — spying
// on it observes exactly what authorize() does.
import { db as appDb } from '@/lib/db';
import {
  windowStartFor,
  AUTH_WINDOW_MS,
  LOGIN_EMAIL_LIMIT,
  AUTH_IP_LIMIT,
} from '@/lib/rate-limit';
import '@/auth';

type CapturedConfig = {
  session: { strategy: string; maxAge: number };
  providers: Array<{
    authorize: (
      creds: Record<string, unknown>,
      request?: Request,
    ) => Promise<unknown>;
  }>;
};

const config = nextAuthSpy.mock.calls[0][0] as unknown as CapturedConfig;

const RUN_TAG = `t2-auth-${Date.now()}`;
const DEFAULT_IP = `${RUN_TAG}-ip`;

// Real authorize() with a synthetic request carrying x-forwarded-for, the
// same way @auth/core@0.41.3 forwards the original headers (verified in
// lib/actions/callback/index.js:231-233 of the installed package).
const authorize = (creds: Record<string, unknown>, ip: string = DEFAULT_IP) =>
  config.providers[0].authorize(
    creds,
    new Request('http://localhost/api/auth/callback/credentials', {
      method: 'POST',
      headers: { 'x-forwarded-for': ip },
    }),
  );
const compareSpy = vi.mocked(compare);

const db = new PrismaClient();
const NO_CLIENT_EMAIL = `${RUN_TAG}-noclient@example.test`;
const REAL_EMAIL = `${RUN_TAG}-real@example.test`;
const REAL_PASSWORD = 'correct-horse-battery';

async function cleanup(): Promise<void> {
  await db.user.deleteMany({ where: { email: { startsWith: 't2-auth-' } } });
  // Email keys and IP keys both start with the run tag prefix.
  await db.rateLimit.deleteMany({ where: { key: { startsWith: 't2-auth-' } } });
}

describe('auth.ts session config (T2 §2.5 + Tanda B rider)', () => {
  it('uses JWT strategy with maxAge 86400 and no updateAge (NO-OP under JWT)', () => {
    expect(config.session).toEqual({ strategy: 'jwt', maxAge: 86400 });
  });
});

describe('authorize() dummy compare (T2 §2.6)', () => {
  beforeAll(async () => {
    await cleanup();
    // User WITHOUT clients: authorize() must treat it like a miss.
    await db.user.create({
      data: { email: NO_CLIENT_EMAIL, passwordHash: 'x-not-a-real-hash' },
    });
  });

  afterAll(async () => {
    await cleanup();
    await db.$disconnect();
  });

  it('unknown email: calls compare (timing equalizer) and returns null', async () => {
    compareSpy.mockClear();
    const result = await authorize({
      email: `${RUN_TAG}-ghost@example.test`,
      password: 'whatever-password',
    });
    expect(result).toBeNull();
    expect(compareSpy).toHaveBeenCalledTimes(1);
  });

  it('user without clients: calls compare and returns null', async () => {
    compareSpy.mockClear();
    const result = await authorize({
      email: NO_CLIENT_EMAIL,
      password: 'whatever-password',
    });
    expect(result).toBeNull();
    expect(compareSpy).toHaveBeenCalledTimes(1);
  });

  it('missing credentials: returns null WITHOUT compare (no lookup happened)', async () => {
    compareSpy.mockClear();
    const result = await authorize({ email: '', password: '' });
    expect(result).toBeNull();
    expect(compareSpy).not.toHaveBeenCalled();
  });

  it('credential failure records one failure in BOTH scopes (email + IP)', async () => {
    const email = `${RUN_TAG}-bothscopes@example.test`;
    const ip = `${RUN_TAG}-ip-bothscopes`;
    const result = await authorize({ email, password: 'nope-nope-nope' }, ip);
    expect(result).toBeNull();

    // Window-agnostic lookup (scope+key, any windowStart) so the assert
    // cannot flake if the test crosses a 15-min window boundary mid-run.
    const emailRows = await db.rateLimit.findMany({
      where: { scope: 'login:email', key: email },
    });
    const ipRows = await db.rateLimit.findMany({
      where: { scope: 'login:ip', key: ip },
    });
    expect(emailRows.reduce((s, r) => s + r.count, 0)).toBe(1);
    expect(ipRows.reduce((s, r) => s + r.count, 0)).toBe(1);
  });
});

describe('authorize() rate limiting (T2 §5.3)', () => {
  beforeAll(async () => {
    await cleanup();
    // Real user WITH a client so the success path is reachable. hash() comes
    // from the UNMOCKED bcryptjs (the vi.mock factory only guarantees
    // `compare`; importActual sidesteps the partial mock).
    const { hash } = await vi.importActual<typeof import('bcryptjs')>('bcryptjs');
    await db.user.create({
      data: {
        email: REAL_EMAIL,
        passwordHash: await hash(REAL_PASSWORD, 10),
        clients: { create: { name: 'T2 RATE LIMIT TEST' } },
      },
    });
  });

  afterAll(async () => {
    await cleanup();
    vi.restoreAllMocks();
  });

  it('successful login does NOT increment any counter', async () => {
    const ip = `${RUN_TAG}-ip-success`;
    const result = await authorize(
      { email: REAL_EMAIL, password: REAL_PASSWORD },
      ip,
    );
    expect(result).not.toBeNull();
    expect((result as { clientId: string }).clientId).toBeTruthy();

    const rows = await db.rateLimit.findMany({
      where: { key: { in: [REAL_EMAIL, ip] } },
    });
    expect(rows).toHaveLength(0);
  });

  it('email over the limit: returns generic null WITHOUT touching the users table', async () => {
    const email = `${RUN_TAG}-limited@example.test`;
    await db.rateLimit.create({
      data: {
        scope: 'login:email',
        key: email,
        windowStart: windowStartFor(AUTH_WINDOW_MS),
        count: LOGIN_EMAIL_LIMIT,
      },
    });

    const findUniqueSpy = vi.spyOn(appDb.user, 'findUnique');
    compareSpy.mockClear();
    const result = await authorize({ email, password: 'whatever-password' });
    expect(result).toBeNull(); // same generic null as bad credentials (§2.7)
    expect(findUniqueSpy).not.toHaveBeenCalled(); // no user lookup
    expect(compareSpy).not.toHaveBeenCalled(); // no bcrypt work either
    findUniqueSpy.mockRestore();
  });

  it('IP over the limit: returns generic null WITHOUT touching the users table', async () => {
    const ip = `${RUN_TAG}-ip-limited`;
    await db.rateLimit.create({
      data: {
        scope: 'login:ip',
        key: ip,
        windowStart: windowStartFor(AUTH_WINDOW_MS),
        count: AUTH_IP_LIMIT,
      },
    });

    const findUniqueSpy = vi.spyOn(appDb.user, 'findUnique');
    compareSpy.mockClear();
    const result = await authorize(
      { email: `${RUN_TAG}-anyone@example.test`, password: 'whatever' },
      ip,
    );
    expect(result).toBeNull();
    expect(findUniqueSpy).not.toHaveBeenCalled();
    expect(compareSpy).not.toHaveBeenCalled();
    findUniqueSpy.mockRestore();
  });
});
