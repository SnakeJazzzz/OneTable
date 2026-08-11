/**
 * lib/rate-limit.ts — reusable Postgres-backed fixed-window rate limiter
 * (hardening T2 §5).
 *
 * Why Postgres and not an in-memory Map: Vercel functions are stateless and
 * horizontally scaled — a per-instance counter is trivially bypassed by
 * hitting different instances. The RateLimit table is the single shared
 * store; one atomic upsert per consume keeps it race-free.
 *
 * Window semantics: FIXED windows aligned to the epoch boundary —
 * `windowStart = floor(now / windowMs) * windowMs` — never rolling. This
 * same semantic defines T3's "per day" chat quota (day = aligned 24h
 * window). A new window starts with a fresh counter; old windows for the
 * same (scope, key) are cleaned up lazily by the increment statement itself
 * (no cron needed).
 *
 * FAIL-OPEN policy (T2 §5.2): if the limiter's query throws (Neon hiccup,
 * pool exhaustion), we log a structured error and treat the request as NOT
 * limited. Rationale: the limiter protects against brute force, but a DB
 * blip must never turn into a sitewide 500 on login/signup. The raw key
 * (email / IP) is deliberately NOT logged — scope + error are enough to
 * observe failures without writing PII into Vercel logs.
 *
 * Consumers (T2): auth.ts (login, per-email + per-IP) and
 * app/api/auth/signup/route.ts (per-IP). T3 reuses consumeRateLimit for the
 * chat quota — the limit is a PARAMETER, never hardcoded here.
 */

import { db } from './db';

export type RateLimitParams = {
  /** Namespace for the counter, e.g. 'login:email'. */
  scope: string;
  /** Identity being limited within the scope (email, IP, clientId...). */
  key: string;
  /** Max allowed count per window. */
  limit: number;
  /** Window length in ms. Windows are fixed, aligned to the epoch. */
  windowMs: number;
};

export type RateLimitResult = {
  allowed: boolean;
  /** Counter value observed (peek) or after increment (consume). */
  count: number;
};

// ---------------------------------------------------------------------------
// Pinned policies (T2 §2.7): login = 5 failures/15min per email PLUS
// 20 failures/15min per IP. Signup shares the SAME IP policy (same numbers,
// separate scope/bucket). Exported from here so auth.ts and the signup route
// never drift apart on the numbers.
// ---------------------------------------------------------------------------

export const AUTH_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
export const LOGIN_EMAIL_LIMIT = 5;
export const AUTH_IP_LIMIT = 20;

/** Compute the fixed, boundary-aligned start of the current window. */
export function windowStartFor(windowMs: number, now: number = Date.now()): Date {
  return new Date(Math.floor(now / windowMs) * windowMs);
}

function logFailOpen(op: string, scope: string, err: unknown): void {
  console.error(
    JSON.stringify({
      source: 'rate-limit',
      op,
      scope,
      outcome: 'fail-open',
      error: err instanceof Error ? err.message : String(err),
    }),
  );
}

/**
 * Atomically increment the (scope, key, current window) counter and return
 * the post-increment count. One statement does everything:
 *   - the data-modifying CTE deletes stale windows for the same scope+key
 *     (lazy cleanup — data-modifying CTEs always execute, referenced or not);
 *   - the INSERT ... ON CONFLICT targets the composite PK, so two concurrent
 *     calls serialize on the row and neither increment is lost (same raw
 *     pattern as batchUpsertUnmapped in core/normalizer/upsert.ts).
 */
async function incrementWindow(
  scope: string,
  key: string,
  windowMs: number,
): Promise<number> {
  const windowStart = windowStartFor(windowMs);
  const rows = await db.$queryRaw<Array<{ count: number }>>`
    WITH cleanup AS (
      DELETE FROM "RateLimit"
      WHERE "scope" = ${scope} AND "key" = ${key} AND "windowStart" < ${windowStart}
    )
    INSERT INTO "RateLimit" ("scope", "key", "windowStart", "count")
    VALUES (${scope}, ${key}, ${windowStart}, 1)
    ON CONFLICT ("scope", "key", "windowStart")
    DO UPDATE SET "count" = "RateLimit"."count" + 1
    RETURNING "count";
  `;
  return rows[0].count;
}

/**
 * Consume one unit of the (scope, key) budget for the current window.
 * Returns `allowed: true` while the post-increment count is within `limit`
 * (i.e. the limit-th consume is still allowed; the limit+1-th is not).
 * FAIL-OPEN on DB errors.
 */
export async function consumeRateLimit({
  scope,
  key,
  limit,
  windowMs,
}: RateLimitParams): Promise<RateLimitResult> {
  try {
    const count = await incrementWindow(scope, key, windowMs);
    return { allowed: count <= limit, count };
  } catch (err) {
    logFailOpen('consume', scope, err);
    return { allowed: true, count: 0 };
  }
}

/**
 * Read-only check of the current window: does (scope, key) still have
 * budget? Does NOT increment. Used by login, where only FAILURES consume
 * budget (recordFailure) but every attempt must first check the counter.
 * FAIL-OPEN on DB errors.
 */
export async function peekRateLimit({
  scope,
  key,
  limit,
  windowMs,
}: RateLimitParams): Promise<RateLimitResult> {
  const windowStart = windowStartFor(windowMs);
  try {
    const rows = await db.$queryRaw<Array<{ count: number }>>`
      SELECT "count" FROM "RateLimit"
      WHERE "scope" = ${scope} AND "key" = ${key} AND "windowStart" = ${windowStart};
    `;
    const count = rows.length > 0 ? rows[0].count : 0;
    return { allowed: count < limit, count };
  } catch (err) {
    logFailOpen('peek', scope, err);
    return { allowed: true, count: 0 };
  }
}

/**
 * Record one failure against (scope, key) — same atomic upsert as consume,
 * result discarded. Login calls this ONLY on credential failure; success
 * neither increments nor resets (fixed-window simple). FAIL-OPEN.
 */
export async function recordFailure({
  scope,
  key,
  windowMs,
}: Omit<RateLimitParams, 'limit'>): Promise<void> {
  try {
    await incrementWindow(scope, key, windowMs);
  } catch (err) {
    logFailOpen('recordFailure', scope, err);
  }
}
