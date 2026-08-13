import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mocked at the module level (same rationale as tests/ai/chat-route.test.ts):
// the limiter's own semantics are covered by the T2 suite; here we assert the
// route's contract with it — and mocking also keeps this suite off the real
// db that lib/rate-limit imports.
vi.mock('@/lib/rate-limit', () => ({ consumeRateLimit: vi.fn() }));

import { POST } from '@/app/api/csp-report/route';
import { consumeRateLimit } from '@/lib/rate-limit';

function reportRequest(
  body: string,
  headers: Record<string, string> = {},
): Request {
  return new Request('http://localhost/api/csp-report', {
    method: 'POST',
    headers: { 'content-type': 'application/csp-report', ...headers },
    body,
  });
}

const SAMPLE_REPORT = JSON.stringify({
  'csp-report': {
    'document-uri': 'https://onetable.example/dashboard',
    'violated-directive': 'img-src',
    'blocked-uri': 'https://evil.example/pixel.png',
    'original-policy': "default-src 'self'",
  },
});

describe('POST /api/csp-report', () => {
  beforeEach(() => {
    vi.mocked(consumeRateLimit).mockReset();
    vi.mocked(consumeRateLimit).mockResolvedValue({ allowed: true, count: 1 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('accepts an anonymous valid report with 204 and logs it structured', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const res = await POST(reportRequest(SAMPLE_REPORT));
    expect(res.status).toBe(204);

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const logged = JSON.parse(warnSpy.mock.calls[0][0] as string) as {
      source: string;
      report: { 'csp-report': { 'violated-directive': string } };
    };
    expect(logged.source).toBe('csp-report');
    expect(logged.report['csp-report']['violated-directive']).toBe('img-src');
  });

  it('logs an unparseable body without throwing (observe, not validate)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const res = await POST(reportRequest('not json at all'));
    expect(res.status).toBe(204);

    const logged = JSON.parse(warnSpy.mock.calls[0][0] as string) as {
      report: { unparseable: string };
    };
    expect(logged.report.unparseable).toBe('not json at all');
  });

  it('rejects a giant body with 413 without logging it', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // 33KB > 32KB cap.
    const res = await POST(reportRequest('x'.repeat(33 * 1024)));
    expect(res.status).toBe(413);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('rejects via Content-Length before reading when the header is huge', async () => {
    const res = await POST(
      reportRequest(SAMPLE_REPORT, { 'content-length': String(10 * 1024 * 1024) }),
    );
    expect(res.status).toBe(413);
  });

  // -------------------------------------------------------------------------
  // Hardening T3 §4.7 — per-IP rate limit (60 / 15 min, silent drop)
  // -------------------------------------------------------------------------

  it('consumes with the pinned scope/limit/window, keyed by the first x-forwarded-for entry', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const res = await POST(
      reportRequest(SAMPLE_REPORT, { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' }),
    );
    expect(res.status).toBe(204);
    expect(warnSpy).toHaveBeenCalledTimes(1);

    expect(vi.mocked(consumeRateLimit)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(consumeRateLimit)).toHaveBeenCalledWith({
      scope: 'csp-report:ip',
      key: '1.2.3.4',
      limit: 60,
      windowMs: 900_000,
    });
  });

  it("falls back to key 'unknown' when x-forwarded-for is absent", async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    await POST(reportRequest(SAMPLE_REPORT));

    expect(vi.mocked(consumeRateLimit)).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'unknown' }),
    );
  });

  it('over the limit → SILENT drop: same 204, console.warn never called', async () => {
    vi.mocked(consumeRateLimit).mockResolvedValue({ allowed: false, count: 61 });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const res = await POST(reportRequest(SAMPLE_REPORT));

    // The status NEVER changes: no feedback about the threshold reaches the
    // sender, and the report is simply not logged.
    expect(res.status).toBe(204);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('a 413 body-cap reject never consumes the IP budget', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    const res = await POST(reportRequest('x'.repeat(33 * 1024)));
    expect(res.status).toBe(413);
    expect(vi.mocked(consumeRateLimit)).not.toHaveBeenCalled();
  });

  it('a Content-Length reject never consumes the IP budget either', async () => {
    const res = await POST(
      reportRequest(SAMPLE_REPORT, { 'content-length': String(10 * 1024 * 1024) }),
    );
    expect(res.status).toBe(413);
    expect(vi.mocked(consumeRateLimit)).not.toHaveBeenCalled();
  });
});
