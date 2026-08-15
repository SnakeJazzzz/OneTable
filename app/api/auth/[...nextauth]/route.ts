// NextAuth v5 — re-export the route handlers from the root auth.ts config.
// `handlers` is `{ GET, POST }` — both verbs serve all /api/auth/* subpaths
// (signin, signout, callback, csrf, session, providers).
//
// T4 (OQ-1): deliberately NOT wrapped in withRouteErrors — the only sanctioned
// exception to the 24/24 invariant, backed by empirical verification
// (2026-08-14, next-auth 5.0.0-beta.32 / @auth/core 0.41.3): a forced throw
// inside `authorize` never escapes the handler. @auth/core's Auth() catches it,
// logs `[auth][error] CallbackRouteError` (+ cause) through its own logger, and
// responds 302 → /api/auth/error?error=Configuration with an EMPTY body — no
// stack, no 500, nothing for an outer wrapper to catch. Wrapping would be
// unreachable code and would misleadingly suggest this route's errors flow
// through the `source:'api'` log line (they flow through NextAuth's logger).
// Evidence: .superpowers/sdd/t4-report.md §OQ-1.
import { handlers } from '@/auth';

export const { GET, POST } = handlers;
