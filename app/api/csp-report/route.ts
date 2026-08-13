/**
 * POST /api/csp-report — CSP violation report sink (hardening T2, §2.4).
 *
 * PUBLIC endpoint (Opción A, T2 brief OQ-3): browsers POST violation
 * reports here fire-and-forget, with no auth cookie guarantees, so the
 * route must not require a session. The current middleware matcher DOES
 * run on this path, but the middleware only enforces auth on the five
 * protected page prefixes — an anonymous POST passes through (verified
 * empirically with a real POST against a dev server).
 *
 * The report is logged structured to stdout (Vercel captures it in the
 * function logs); T6 reviews those logs before flipping production from
 * Report-Only to enforced. The route's only DB dependency (since T3) is the
 * per-IP rate limiter below — the report itself is never persisted.
 *
 * Body cap: violation reports are ~1KB; anything huge is garbage or abuse.
 * We check Content-Length first (cheap reject before reading) and then the
 * actual read size (Content-Length is optional/spoofable).
 *
 * Per-IP rate limit (T3 §4.7): 60 reports / 15 min per IP, consumed AFTER
 * the body caps (a 413/400 never burns the IP's budget) and BEFORE the log.
 * Over the limit → 204 WITHOUT logging: a silent drop gives the attacker no
 * feedback about the threshold and protects the "zero violations" signal
 * that gates T6's CSP flip from being poisoned by a flood. FAIL-OPEN
 * (T2 §5.2): a limiter DB error degrades to "log everything", never to a
 * dead endpoint or lost reports.
 */

import { consumeRateLimit } from '@/lib/rate-limit';

const MAX_BODY_BYTES = 32 * 1024; // 32KB — generous for a ~1KB report

// Same IP-extraction pattern as signup (first x-forwarded-for entry,
// 'unknown' fallback); own scope so floods here never eat auth budgets.
const CSP_REPORT_IP_SCOPE = 'csp-report:ip';
const CSP_REPORT_IP_LIMIT = 60;
const CSP_REPORT_WINDOW_MS = 900_000; // 15 min — same window as auth

export async function POST(req: Request): Promise<Response> {
  const contentLength = Number(req.headers.get('content-length') ?? '0');
  if (contentLength > MAX_BODY_BYTES) {
    return new Response(null, { status: 413 });
  }

  let raw: string;
  try {
    raw = await req.text();
  } catch {
    return new Response(null, { status: 400 });
  }
  if (raw.length > MAX_BODY_BYTES) {
    return new Response(null, { status: 413 });
  }

  // Silent drop when the IP is over budget: same 204 as the logged path —
  // the status never reveals the threshold.
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
  const verdict = await consumeRateLimit({
    scope: CSP_REPORT_IP_SCOPE,
    key: ip,
    limit: CSP_REPORT_IP_LIMIT,
    windowMs: CSP_REPORT_WINDOW_MS,
  });
  if (!verdict.allowed) {
    return new Response(null, { status: 204 });
  }

  // Browsers send either `application/csp-report` ({"csp-report": {...}},
  // report-uri) or `application/reports+json` ([...], report-to). Parse
  // leniently: a malformed body is logged as-is (truncated) — the endpoint
  // exists to observe, not to validate.
  let report: unknown;
  try {
    report = JSON.parse(raw);
  } catch {
    report = { unparseable: raw.slice(0, 2048) };
  }

  console.warn(
    JSON.stringify({
      source: 'csp-report',
      receivedAt: new Date().toISOString(),
      userAgent: req.headers.get('user-agent') ?? null,
      report,
    }),
  );

  return new Response(null, { status: 204 });
}
