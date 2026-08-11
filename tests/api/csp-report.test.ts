import { describe, it, expect, vi, afterEach } from 'vitest';

import { POST } from '@/app/api/csp-report/route';

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
});
