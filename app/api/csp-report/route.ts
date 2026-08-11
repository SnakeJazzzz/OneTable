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
 * No DB. The report is logged structured to stdout (Vercel captures it in
 * the function logs); T6 reviews those logs before flipping production
 * from Report-Only to enforced.
 *
 * Body cap: violation reports are ~1KB; anything huge is garbage or abuse.
 * We check Content-Length first (cheap reject before reading) and then the
 * actual read size (Content-Length is optional/spoofable).
 */

const MAX_BODY_BYTES = 32 * 1024; // 32KB — generous for a ~1KB report

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
