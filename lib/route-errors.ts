/**
 * lib/route-errors.ts — outer error net for API route handlers (hardening T4).
 *
 * `withRouteErrors(route, handler)` wraps a route handler COMPLETELY: any
 * uncaught throw becomes a uniform 500 `{ error: { code: 'INTERNAL' } }`
 * (same shape as the whole errorResponse family) plus ONE structured JSON
 * log line. It is the OUTER net — route-internal try/catch blocks with their
 * own semantics (400/404/409 mappings, health's 503, csp-report's 204) are
 * preserved untouched; whatever they don't handle and re-throw lands here.
 *
 * Repo invariant (T4, 24/24): EVERY route.ts under app/api exports handlers
 * wrapped in withRouteErrors — no grep exceptions, even where the wrapper is
 * dead code (health) — so "is this route covered?" never needs case analysis.
 *
 * Log format follows the T2 precedent (logFailOpen in lib/rate-limit.ts):
 * console.error + JSON.stringify, one line, greppable/parseable by
 * `source`. Timestamp and requestId are added per-line by Vercel's runtime
 * logs — not duplicated here. This is the input contract for the post-block
 * triage agent.
 *
 * `clientId` NEVER appears in the wrapper's own log line — it is resolved
 * INSIDE handlers (requireAuth) and is not available in the outer catch.
 * Handlers that log from their own catch blocks call `logRouteError`
 * directly and pass whatever context they hold (clientId included).
 * AsyncLocalStorage or any other context-passing mechanism is deliberately
 * out (T4 brief E2): zero new complexity.
 *
 * Next.js sentinels (T4 brief E4): as of T4 there are ZERO uses of
 * `redirect()`/`notFound()` in app/api (verified empirically). If a future
 * route uses them, this wrapper MUST also re-throw errors whose `digest`
 * starts with 'NEXT_REDIRECT' or 'NEXT_NOT_FOUND' before logging — today
 * that check would be dead code, so it is documented, not implemented.
 *
 * One sentinel IS live and re-thrown: DYNAMIC_SERVER_USAGE. During `next
 * build`, static optimization of GET routes invokes the handler; `auth()`
 * (via `headers()`) throws DynamicServerError, which is Next's internal
 * signal to mark the route dynamic (ƒ). Verified empirically (build of
 * 2026-08-14): without the re-throw the wrapper logs a bogus
 * `source:'api'` error line for every GET route on every build. Never
 * reachable on a real request — dynamic routes skip static optimization at
 * runtime.
 */

import { errorResponse } from '@/lib/auth-helpers';

export type RouteErrorContext = {
  /** HTTP method, when the caller knows it (the wrapper duck-types args[0]). */
  method?: string;
  /** Tenant id — only ever passed by direct calls from inside handlers. */
  clientId?: string;
  /**
   * omitMessage rule (T4 brief OQ-2): routes that handle RAW USER CONTENT
   * (e.g. chat payloads) pass `omitMessage: true` so the log line carries
   * name/code but never the error message. The stack is omitted too: V8
   * stacks embed the message in their first line, so keeping the stack
   * would defeat the omission.
   */
  omitMessage?: boolean;
};

/** Extract a Prisma P-code or any string `code` off an unknown error. */
function codeOf(err: unknown): string | undefined {
  if (typeof err === 'object' && err !== null) {
    const code = (err as { code?: unknown }).code;
    if (typeof code === 'string') return code;
  }
  return undefined;
}

/**
 * Emit ONE structured JSON error line for a route error path.
 * Default detail level is message + stack (max signal for triage; the log is
 * server-only with ~1h retention on Hobby) — see RouteErrorContext.omitMessage
 * for the exception rule.
 */
export function logRouteError(
  route: string,
  err: unknown,
  ctx?: RouteErrorContext,
): void {
  const isError = err instanceof Error;
  const line: Record<string, unknown> = {
    source: 'api',
    route,
  };
  if (ctx?.method !== undefined) line.method = ctx.method;
  if (ctx?.clientId !== undefined) line.clientId = ctx.clientId;
  line.name = isError ? err.name : typeof err;
  const code = codeOf(err);
  if (code !== undefined) line.code = code;
  if (!ctx?.omitMessage) {
    line.message = isError ? err.message : String(err);
    if (isError && err.stack !== undefined) line.stack = err.stack;
  }
  console.error(JSON.stringify(line));
}

/**
 * Next's build-time sentinel for "this route is dynamic" (see header
 * comment). Matched by digest — the class lives in Next internals
 * (next/dist/client/components/hooks-server-context: DYNAMIC_ERROR_CODE).
 */
function isDynamicServerUsage(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { digest?: unknown }).digest === 'DYNAMIC_SERVER_USAGE'
  );
}

/** Duck-type the HTTP method off the first handler arg when it is a Request. */
function methodOf(arg: unknown): string | undefined {
  if (typeof arg === 'object' && arg !== null) {
    const method = (arg as { method?: unknown }).method;
    if (typeof method === 'string') return method;
  }
  return undefined;
}

/**
 * Wrap a route handler: uncaught throws → structured log + 500 INTERNAL with
 * the standard `{ error: { code, message } }` shape. A Response RETURNED by
 * the handler (401 from requireAuth, any 4xx/5xx the route maps itself) is
 * passed through untouched and never logged.
 */
export function withRouteErrors<A extends unknown[]>(
  route: string,
  handler: (...args: A) => Promise<Response>,
): (...args: A) => Promise<Response> {
  return async (...args: A): Promise<Response> => {
    try {
      return await handler(...args);
    } catch (err) {
      // Build-time-only sentinel: hand it back to Next untouched.
      if (isDynamicServerUsage(err)) throw err;
      logRouteError(route, err, { method: methodOf(args[0]) });
      return errorResponse('INTERNAL', 'Error interno del servidor', 500);
    }
  };
}
