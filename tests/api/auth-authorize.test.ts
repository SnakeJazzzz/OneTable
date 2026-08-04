/**
 * Tests for auth.ts (hardening T2, Tanda A):
 *   - session config: maxAge 86400 / updateAge 3600 (§2.5)
 *   - dummy bcrypt.compare timing equalizer in authorize() (§2.6):
 *     unknown email and user-without-clients BOTH run compare() and
 *     return null.
 *
 * auth.ts calls NextAuth() at module load, and next-auth imports
 * next/server which the vitest runner cannot resolve. So we mock the
 * next-auth entry points: NextAuth becomes a capture-the-config stub and
 * the Credentials provider factory becomes the identity function — which
 * gives the test the REAL provider config (with the real authorize())
 * without restructuring auth.ts.
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
import '@/auth';

type CapturedConfig = {
  session: { strategy: string; maxAge: number; updateAge: number };
  providers: Array<{
    authorize: (creds: Record<string, unknown>) => Promise<unknown>;
  }>;
};

const config = nextAuthSpy.mock.calls[0][0] as unknown as CapturedConfig;
const authorize = (creds: Record<string, unknown>) =>
  config.providers[0].authorize(creds);
const compareSpy = vi.mocked(compare);

const db = new PrismaClient();
const RUN_TAG = `t2-auth-${Date.now()}`;
const NO_CLIENT_EMAIL = `${RUN_TAG}-noclient@example.test`;

describe('auth.ts session config (T2 §2.5)', () => {
  it('uses JWT strategy with maxAge 86400 and updateAge 3600', () => {
    expect(config.session).toEqual({
      strategy: 'jwt',
      maxAge: 86400,
      updateAge: 3600,
    });
  });
});

describe('authorize() dummy compare (T2 §2.6)', () => {
  beforeAll(async () => {
    await db.user.deleteMany({ where: { email: { startsWith: 't2-auth-' } } });
    // User WITHOUT clients: authorize() must treat it like a miss.
    await db.user.create({
      data: { email: NO_CLIENT_EMAIL, passwordHash: 'x-not-a-real-hash' },
    });
  });

  afterAll(async () => {
    await db.user.deleteMany({ where: { email: { startsWith: 't2-auth-' } } });
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
});
