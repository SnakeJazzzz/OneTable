import { describe, it, expect } from 'vitest';

import {
  buildAlwaysEnforcedHeaders,
  buildCspDirectives,
  buildCspHeader,
  buildSecurityHeaders,
  resolveCspEnv,
} from '@/lib/security-headers';

describe('resolveCspEnv', () => {
  it('maps VERCEL_ENV values to CSP environments', () => {
    expect(resolveCspEnv('production')).toBe('production');
    expect(resolveCspEnv('preview')).toBe('preview');
    expect(resolveCspEnv('development')).toBe('development');
    // Local dev / local build / CI: VERCEL_ENV is unset.
    expect(resolveCspEnv(undefined)).toBe('development');
    expect(resolveCspEnv('')).toBe('development');
  });
});

describe('buildAlwaysEnforcedHeaders', () => {
  it('returns the four always-enforced headers (T2 §2.2)', () => {
    const headers = buildAlwaysEnforcedHeaders();
    const byKey = Object.fromEntries(headers.map((h) => [h.key, h.value]));
    expect(byKey['X-Content-Type-Options']).toBe('nosniff');
    expect(byKey['X-Frame-Options']).toBe('DENY');
    expect(byKey['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
    expect(byKey['Permissions-Policy']).toBe(
      'camera=(), microphone=(), geolocation=()',
    );
    expect(headers).toHaveLength(4);
  });
});

describe('buildCspHeader', () => {
  it('production emits Report-Only (flip to enforced is T6)', () => {
    expect(buildCspHeader('production').key).toBe(
      'Content-Security-Policy-Report-Only',
    );
  });

  it('preview emits the ENFORCED header', () => {
    expect(buildCspHeader('preview').key).toBe('Content-Security-Policy');
  });

  it('development emits the ENFORCED header', () => {
    expect(buildCspHeader('development').key).toBe('Content-Security-Policy');
  });

  it('joins directives with "; "', () => {
    const { value } = buildCspHeader('preview');
    expect(value).toBe(buildCspDirectives('preview').join('; '));
  });
});

describe('buildCspDirectives', () => {
  it('preview/production share the strict baseline directives', () => {
    for (const env of ['preview', 'production'] as const) {
      const d = buildCspDirectives(env);
      expect(d).toContain("default-src 'self'");
      expect(d).toContain("script-src 'self' 'unsafe-inline'");
      expect(d).toContain("style-src 'self' 'unsafe-inline'");
      expect(d).toContain("img-src 'self' data: blob:");
      expect(d).toContain("connect-src 'self'");
      expect(d).toContain("frame-ancestors 'none'");
      expect(d).toContain("object-src 'none'");
      expect(d).toContain("base-uri 'self'");
      expect(d).toContain('report-uri /api/csp-report');
    }
  });

  it('preview/production do NOT include dev relaxations', () => {
    for (const env of ['preview', 'production'] as const) {
      const joined = buildCspDirectives(env).join('; ');
      expect(joined).not.toContain("'unsafe-eval'");
      expect(joined).not.toContain('ws:');
    }
  });

  it('development adds unsafe-eval (Fast Refresh) and ws: (HMR socket) only', () => {
    const d = buildCspDirectives('development');
    expect(d).toContain("script-src 'self' 'unsafe-inline' 'unsafe-eval'");
    expect(d).toContain("connect-src 'self' ws:");
    // Everything else stays identical to the strict baseline.
    expect(d).toContain("default-src 'self'");
    expect(d).toContain("frame-ancestors 'none'");
    expect(d).toContain('report-uri /api/csp-report');
  });
});

describe('buildSecurityHeaders', () => {
  it('always-enforced set + one CSP header, in every environment', () => {
    for (const env of ['development', 'preview', 'production'] as const) {
      const headers = buildSecurityHeaders(env);
      expect(headers).toHaveLength(5);
      const keys = headers.map((h) => h.key);
      expect(keys).toContain('X-Content-Type-Options');
      expect(keys).toContain('X-Frame-Options');
      expect(keys).toContain('Referrer-Policy');
      expect(keys).toContain('Permissions-Policy');
      const cspKeys = keys.filter((k) => k.startsWith('Content-Security-Policy'));
      expect(cspKeys).toHaveLength(1);
    }
  });
});
