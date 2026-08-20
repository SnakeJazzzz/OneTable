/**
 * Integration tests for lib/rate-limit.ts (hardening T2 §5, Tanda B) against
 * the Neon development DB (guard in tests/setup.ts already vetted the host).
 *
 * Covered (test plan §7):
 *   - under the limit passes, over the limit blocks (consume);
 *   - peek is read-only (never increments) and blocks at the limit;
 *   - recordFailure increments the same counter consume uses;
 *   - a NEW window resets the count, and the lazy cleanup deletes stale
 *     windows of the same scope+key (seeded past window — no sleeping on
 *     real clock boundaries, which would be racy against remote DB latency);
 *   - ATOMICITY: concurrent increments never lose a count (each RETURNING
 *     value is distinct — same concurrency concern batchUpsertUnmapped
 *     solved for UnmappedProduct);
 *   - FAIL-OPEN: a throwing query yields { allowed: true } + structured log
 *     instead of propagating.
 */
import { describe, it, expect, afterAll, vi } from 'vitest';
import { PrismaClient } from '@prisma/client';

// The helpers run through the app's db singleton; the fail-open test spies
// on it. Seeding/asserting uses a dedicated client — same database.
import { db as appDb } from '@/lib/db';
import {
  consumeRateLimit,
  normalizeKey,
  peekRateLimit,
  recordFailure,
  windowStartFor,
  KEY_MAX_LEN,
} from '@/lib/rate-limit';

const db = new PrismaClient();
const RUN_TAG = `t2-rl-${Date.now()}`;
const scope = (name: string) => `${RUN_TAG}:${name}`;
// One hour is wide enough that a test run never straddles a window boundary.
const WINDOW_MS = 60 * 60 * 1000;

afterAll(async () => {
  await db.rateLimit.deleteMany({ where: { scope: { startsWith: 't2-rl-' } } });
  await db.$disconnect();
  vi.restoreAllMocks();
});

describe('consumeRateLimit', () => {
  it('allows under the limit and blocks over it', async () => {
    const params = { scope: scope('consume'), key: 'k', limit: 3, windowMs: WINDOW_MS };

    const r1 = await consumeRateLimit(params);
    const r2 = await consumeRateLimit(params);
    const r3 = await consumeRateLimit(params);
    expect([r1, r2, r3]).toEqual([
      { allowed: true, count: 1 },
      { allowed: true, count: 2 },
      { allowed: true, count: 3 },
    ]);

    // limit+1-th consume is blocked.
    const r4 = await consumeRateLimit(params);
    expect(r4).toEqual({ allowed: false, count: 4 });
  });

  it('ATOMICITY: concurrent increments never lose a count', async () => {
    const params = { scope: scope('atomic'), key: 'k', limit: 100, windowMs: WINDOW_MS };
    const N = 10;

    const results = await Promise.all(
      Array.from({ length: N }, () => consumeRateLimit(params)),
    );

    // Every RETURNING value distinct 1..N — a lost update would duplicate a
    // count and the final row would sit below N.
    const counts = results.map((r) => r.count).sort((a, b) => a - b);
    expect(counts).toEqual(Array.from({ length: N }, (_, i) => i + 1));

    const rows = await db.rateLimit.findMany({ where: { scope: scope('atomic') } });
    expect(rows).toHaveLength(1);
    expect(rows[0].count).toBe(N);
  });

  it('a new window resets the count and lazily deletes the stale window', async () => {
    const s = scope('reset');
    const staleWindow = windowStartFor(WINDOW_MS, Date.now() - WINDOW_MS);
    // Seed an EXHAUSTED previous window.
    await db.rateLimit.create({
      data: { scope: s, key: 'k', windowStart: staleWindow, count: 99 },
    });

    // Current window starts fresh — the old count does not carry over.
    const r = await consumeRateLimit({ scope: s, key: 'k', limit: 3, windowMs: WINDOW_MS });
    expect(r).toEqual({ allowed: true, count: 1 });

    // ...and the increment's cleanup CTE removed the stale row.
    const rows = await db.rateLimit.findMany({ where: { scope: s, key: 'k' } });
    expect(rows).toHaveLength(1);
    expect(rows[0].windowStart.getTime()).toBe(windowStartFor(WINDOW_MS).getTime());
  });
});

describe('peekRateLimit', () => {
  it('reports budget without incrementing', async () => {
    const params = { scope: scope('peek'), key: 'k', limit: 2, windowMs: WINDOW_MS };

    // Empty window: allowed, count 0 — and still 0 after repeated peeks.
    expect(await peekRateLimit(params)).toEqual({ allowed: true, count: 0 });
    expect(await peekRateLimit(params)).toEqual({ allowed: true, count: 0 });

    await consumeRateLimit(params);
    expect(await peekRateLimit(params)).toEqual({ allowed: true, count: 1 });

    await consumeRateLimit(params);
    // At the limit there is no budget left: peek blocks, count untouched.
    expect(await peekRateLimit(params)).toEqual({ allowed: false, count: 2 });

    const rows = await db.rateLimit.findMany({ where: { scope: scope('peek') } });
    expect(rows[0].count).toBe(2); // peeks never wrote
  });
});

describe('recordFailure', () => {
  it('increments the same counter consume/peek read', async () => {
    const s = scope('failure');
    await recordFailure({ scope: s, key: 'k', windowMs: WINDOW_MS });
    await recordFailure({ scope: s, key: 'k', windowMs: WINDOW_MS });

    expect(
      await peekRateLimit({ scope: s, key: 'k', limit: 2, windowMs: WINDOW_MS }),
    ).toEqual({ allowed: false, count: 2 });
  });
});

describe('normalizeKey (I-3, hardening T6)', () => {
  it('BOUNDARY: a key of exactly KEY_MAX_LEN chars stays intact; one char more is hashed', () => {
    const atLimit = 'a'.repeat(KEY_MAX_LEN); // 256
    expect(normalizeKey(atLimit)).toBe(atLimit);

    const overLimit = 'a'.repeat(KEY_MAX_LEN + 1); // 257
    const hashed = normalizeKey(overLimit);
    expect(hashed).not.toBe(overLimit);
    // sha256 hex of the FULL key: 64 hex chars.
    expect(hashed).toMatch(/^[0-9a-f]{64}$/);
  });

  it('DETERMINISM / NO-COLLISION: same long key → same hash; distinct long keys → distinct hashes', () => {
    const longA = `login:email:${'a'.repeat(5000)}@evil.test`;
    const longB = `login:email:${'b'.repeat(5000)}@evil.test`;

    expect(normalizeKey(longA)).toBe(normalizeKey(longA));
    expect(normalizeKey(longA)).not.toBe(normalizeKey(longB));
  });

  it('consume and peek agree on the same row for an oversized key (SQL sees 64 chars)', async () => {
    const s = scope('longkey');
    const longKey = `${'x'.repeat(5000)}@evil.test`;

    const r = await consumeRateLimit({ scope: s, key: longKey, limit: 2, windowMs: WINDOW_MS });
    expect(r).toEqual({ allowed: true, count: 1 });

    // peek normalizes the SAME way — it reads the row consume wrote.
    expect(
      await peekRateLimit({ scope: s, key: longKey, limit: 2, windowMs: WINDOW_MS }),
    ).toEqual({ allowed: true, count: 1 });

    // The stored key is the sha256 hex, never the raw 5KB string.
    const rows = await db.rateLimit.findMany({ where: { scope: s } });
    expect(rows).toHaveLength(1);
    expect(rows[0].key).toBe(normalizeKey(longKey));
    expect(rows[0].key).toHaveLength(64);
  });
});

describe('fail-open (T2 §5.2)', () => {
  it('a throwing query is logged and treated as NOT limited', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const querySpy = vi
      .spyOn(appDb, '$queryRaw')
      .mockRejectedValue(new Error('synthetic neon outage'));

    try {
      const consumed = await consumeRateLimit({
        scope: scope('failopen'),
        key: 'k',
        limit: 1,
        windowMs: WINDOW_MS,
      });
      expect(consumed).toEqual({ allowed: true, count: 0 });

      const peeked = await peekRateLimit({
        scope: scope('failopen'),
        key: 'k',
        limit: 1,
        windowMs: WINDOW_MS,
      });
      expect(peeked).toEqual({ allowed: true, count: 0 });

      // recordFailure swallows too — never throws.
      await expect(
        recordFailure({ scope: scope('failopen'), key: 'k', windowMs: WINDOW_MS }),
      ).resolves.toBeUndefined();

      // Structured log per failure, with the fail-open outcome and NO key.
      expect(errorSpy).toHaveBeenCalledTimes(3);
      const logged = JSON.parse(errorSpy.mock.calls[0][0] as string) as Record<string, unknown>;
      expect(logged.source).toBe('rate-limit');
      expect(logged.outcome).toBe('fail-open');
      expect(logged.key).toBeUndefined();
    } finally {
      querySpy.mockRestore();
      errorSpy.mockRestore();
    }
  });
});
