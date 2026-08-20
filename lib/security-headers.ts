/**
 * lib/security-headers.ts — pure security-header builders (hardening T2).
 *
 * PURE module: no Next.js imports, no side effects — unit-testeable with
 * Vitest and consumed by `next.config.mjs` via its `headers()` hook.
 * `next.config.mjs` imports this file with an explicit `.ts` extension and
 * relies on Node's native type stripping (default-on since Node 22.18 /
 * 23.6; CI runs Node 24). Keep the syntax ERASABLE-ONLY: types, interfaces
 * and `import type` are fine; enums / namespaces / parameter properties
 * would break the config load.
 *
 * Environment mapping (decided in T2 brief §2.3, resolved at BUILD time via
 * `VERCEL_ENV` — preview and production are separate builds):
 *   - production  → `Content-Security-Policy` ENFORCED (flipped in T6; it
 *                    shipped as Report-Only from T2 while gated on zero
 *                    violations — the last one, zod's `allowsEval` probe,
 *                    was fixed via jitless in T6 Tanda A).
 *   - preview     → `Content-Security-Policy` ENFORCED (previews are where
 *                    the policy is exercised for real, pre-merge smoke).
 *   - development → ENFORCED with dev-only relaxations (see below).
 *
 * Directive inventory (EMPIRICAL, 2026-08-03): grep of app/, components/,
 * lib/ and core/ found ZERO external origins — no web fonts (no next/font,
 * no @font-face, no @import), no external images (no next/image, no
 * src="http..."), and every client fetch() targets a relative /api/ path.
 * The AI chat calls the Vercel AI Gateway server-side only (not subject to
 * the browser CSP). Hence the 'self'-only baseline below.
 *
 * Dev-only relaxations:
 *   - `'unsafe-eval'` in script-src: React Fast Refresh / webpack dev
 *     runtime use eval'd source maps.
 *   - `ws:` in connect-src: the `next dev` HMR websocket
 *     (`/_next/webpack-hmr`, handshake verified against the dev server).
 *     Kept dev-only and defensively: browser support for matching ws://
 *     same-host against 'self' is inconsistent across versions, and a
 *     blocked HMR socket fails loudly in the console if this ever needs
 *     revisiting. Zero production impact.
 *
 * NOTE on frame-ancestors: browsers IGNORE `frame-ancestors` when a policy
 * is delivered as Report-Only (as production was pre-flip, T2→T6). Since
 * the T6 flip every environment enforces, so `frame-ancestors 'none'` is
 * active everywhere; `X-Frame-Options: DENY` below stays as the redundant
 * second layer. Do not flag the redundancy in review.
 */

export type CspEnv = 'development' | 'preview' | 'production';

export type Header = { key: string; value: string };

/** Map `process.env.VERCEL_ENV` to a CSP environment. Anything that is not
 * a Vercel production/preview build (local `next dev`, local `next build`,
 * CI) is treated as development. */
export function resolveCspEnv(vercelEnv: string | undefined): CspEnv {
  if (vercelEnv === 'production') return 'production';
  if (vercelEnv === 'preview') return 'preview';
  return 'development';
}

/** Always-enforced response headers — identical in ALL environments
 * (T2 brief §2.2). */
export function buildAlwaysEnforcedHeaders(): Header[] {
  return [
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    {
      key: 'Permissions-Policy',
      value: 'camera=(), microphone=(), geolocation=()',
    },
    // COOP (T6, ZAP Z-7): isolates the window from cross-origin openers.
    // No OAuth-popup flows exist to break. COEP was considered and
    // DISCARDED (Z-6): no cross-origin isolation need, and a misapplied
    // COEP breaks embedded resources.
    { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  ];
}

/** CSP directive list for the given environment. */
export function buildCspDirectives(env: CspEnv): string[] {
  const isDev = env === 'development';

  // 'unsafe-inline' in script-src: Next.js App Router streams the RSC
  // payload as inline <script> chunks; removing it requires per-request
  // nonces via middleware — out of scope for T2 (registered as debt).
  const scriptSrc = isDev
    ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
    : "script-src 'self' 'unsafe-inline'";

  // ws: dev-only — next dev HMR websocket (see header comment).
  const connectSrc = isDev ? "connect-src 'self' ws:" : "connect-src 'self'";

  return [
    "default-src 'self'",
    scriptSrc,
    // 'unsafe-inline' in style-src: styled-jsx / inline style attributes.
    "style-src 'self' 'unsafe-inline'",
    // data:/blob: — client-side Excel/CSV export (SheetJS) builds blob URLs.
    "img-src 'self' data: blob:",
    connectSrc,
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    // form-action does NOT fall back to default-src (T6, ZAP Z-1): without
    // it an XSS could exfiltrate via <form action=evil>. Pure tightening —
    // the app's forms submit same-origin (client-side onSubmit → /api/*).
    "form-action 'self'",
    'report-uri /api/csp-report',
  ];
}

/** The CSP header for the given environment: ENFORCED everywhere.
 * Production started in Report-Only (T2) and was flipped to enforced in T6
 * once violations hit zero — since then every environment emits the same
 * enforced key; only the directives vary (dev relaxations). */
export function buildCspHeader(env: CspEnv): Header {
  return {
    key: 'Content-Security-Policy',
    value: buildCspDirectives(env).join('; '),
  };
}

/** Full header set consumed by `next.config.mjs`. */
export function buildSecurityHeaders(env: CspEnv): Header[] {
  return [...buildAlwaysEnforcedHeaders(), buildCspHeader(env)];
}
