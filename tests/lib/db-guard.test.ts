import { describe, it, expect } from 'vitest';
import {
  PRODUCTION_NEON_ENDPOINT_ID,
  STAGING_NEON_ENDPOINT_ID,
  DB_ENV_MARKER,
  DB_ENV_EXPECTED,
  extractDbHost,
  isProductionHost,
  isStagingHost,
  checkDbGuard,
} from '@/lib/db-guard';

// Real production/staging hostnames (hostname only — not secrets). Hardcoded
// on purpose so an accidental edit of the constants in lib/db-guard.ts fails
// loudly here instead of silently un-guarding production or staging.
const PROD_POOLED_HOST = 'ep-muddy-bar-ap8e9lyb-pooler.c-7.us-east-1.aws.neon.tech';
const PROD_UNPOOLED_HOST = 'ep-muddy-bar-ap8e9lyb.c-7.us-east-1.aws.neon.tech';
const STAGING_POOLED_HOST = 'ep-lingering-salad-apedj0u3-pooler.c-7.us-east-1.aws.neon.tech';
const STAGING_UNPOOLED_HOST = 'ep-lingering-salad-apedj0u3.c-7.us-east-1.aws.neon.tech';

// Fictional non-production Neon-style host for the marker cases.
const DEV_HOST = 'ep-fake-dev-branch-123456.c-7.us-east-1.aws.neon.tech';

function pgUrl(host: string): string {
  return `postgresql://user:not-a-real-password@${host}/neondb?sslmode=require`;
}

describe('PRODUCTION_NEON_ENDPOINT_ID', () => {
  it('is pinned to the production endpoint captured 2026-07-20', () => {
    expect(PRODUCTION_NEON_ENDPOINT_ID).toBe('ep-muddy-bar-ap8e9lyb');
  });
});

describe('STAGING_NEON_ENDPOINT_ID', () => {
  it('is pinned to the staging endpoint confirmed 2026-07-20', () => {
    expect(STAGING_NEON_ENDPOINT_ID).toBe('ep-lingering-salad-apedj0u3');
  });
});

describe('extractDbHost', () => {
  it('extracts the hostname from a postgres URL with credentials and params', () => {
    expect(extractDbHost(pgUrl(DEV_HOST))).toBe(DEV_HOST);
  });

  it('extracts localhost', () => {
    expect(extractDbHost('postgresql://postgres:postgres@localhost:5432/db')).toBe(
      'localhost',
    );
  });

  it('lowercases the hostname (WHATWG URL does not normalize case for postgresql://)', () => {
    expect(extractDbHost(pgUrl(DEV_HOST.toUpperCase()))).toBe(DEV_HOST);
  });

  it('strips brackets from IPv6 hosts', () => {
    expect(extractDbHost('postgresql://u:p@[::1]:5432/db')).toBe('::1');
  });

  it('returns null for garbage input', () => {
    expect(extractDbHost('not a url at all')).toBeNull();
  });

  it('returns null for a URL without host', () => {
    expect(extractDbHost('file:///tmp/db.sqlite')).toBeNull();
  });
});

describe('isProductionHost', () => {
  it('matches the pooled production host', () => {
    expect(isProductionHost(PROD_POOLED_HOST)).toBe(true);
  });

  it('matches the unpooled production host', () => {
    expect(isProductionHost(PROD_UNPOOLED_HOST)).toBe(true);
  });

  it('matches the bare endpoint id', () => {
    expect(isProductionHost(PRODUCTION_NEON_ENDPOINT_ID)).toBe(true);
  });

  it('does not match other Neon endpoints', () => {
    expect(isProductionHost(DEV_HOST)).toBe(false);
  });

  it('does not match a hostname that merely contains the id as a substring', () => {
    expect(isProductionHost(`prefix-${PRODUCTION_NEON_ENDPOINT_ID}.example.com`)).toBe(
      false,
    );
  });
});

describe('isStagingHost', () => {
  it('matches the pooled staging host', () => {
    expect(isStagingHost(STAGING_POOLED_HOST)).toBe(true);
  });

  it('matches the unpooled staging host', () => {
    expect(isStagingHost(STAGING_UNPOOLED_HOST)).toBe(true);
  });

  it('matches the bare endpoint id', () => {
    expect(isStagingHost(STAGING_NEON_ENDPOINT_ID)).toBe(true);
  });

  it('does not match other Neon endpoints', () => {
    expect(isStagingHost(DEV_HOST)).toBe(false);
    expect(isStagingHost(PROD_POOLED_HOST)).toBe(false);
  });
});

describe('checkDbGuard', () => {
  it('blocks the pooled production host even WITH the development marker', () => {
    const verdict = checkDbGuard(pgUrl(PROD_POOLED_HOST), DB_ENV_EXPECTED);
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) {
      expect(verdict.reason).toContain('PRODUCTION');
      expect(verdict.reason).toContain(PROD_POOLED_HOST);
      // Never leak credentials: the reason mentions the host, not the URL.
      expect(verdict.reason).not.toContain('not-a-real-password');
    }
  });

  it('blocks the pooled production host in UPPERCASE even WITH the development marker', () => {
    // DNS/TLS are case-insensitive: an uppercased hostname still connects to
    // production, so the guard must not be case-sensitive (fail-open otherwise).
    const upperHost = 'EP-MUDDY-BAR-AP8E9LYB-POOLER.C-7.US-EAST-1.AWS.NEON.TECH';
    const verdict = checkDbGuard(pgUrl(upperHost), DB_ENV_EXPECTED);
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) {
      expect(verdict.reason).toContain('PRODUCTION');
    }
  });

  it('blocks the unpooled production host without marker', () => {
    const verdict = checkDbGuard(pgUrl(PROD_UNPOOLED_HOST), undefined);
    expect(verdict.allowed).toBe(false);
  });

  it('blocks the pooled staging host even WITH the development marker', () => {
    const verdict = checkDbGuard(pgUrl(STAGING_POOLED_HOST), DB_ENV_EXPECTED);
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) {
      // Staging has its OWN reason (previews DB + "Reset from parent"), not
      // the production one.
      expect(verdict.reason).toContain('STAGING');
      expect(verdict.reason).toContain('Reset from parent');
      expect(verdict.reason).not.toContain('PRODUCTION');
      expect(verdict.reason).toContain(STAGING_POOLED_HOST);
      expect(verdict.reason).not.toContain('not-a-real-password');
    }
  });

  it('blocks the unpooled staging host without marker', () => {
    const verdict = checkDbGuard(pgUrl(STAGING_UNPOOLED_HOST), undefined);
    expect(verdict.allowed).toBe(false);
  });

  it('blocks the bare staging endpoint id as host', () => {
    expect(checkDbGuard(pgUrl(STAGING_NEON_ENDPOINT_ID), undefined).allowed).toBe(false);
  });

  it('blocks the pooled staging host in UPPERCASE even WITH the development marker', () => {
    const upperHost = 'EP-LINGERING-SALAD-APEDJ0U3-POOLER.C-7.US-EAST-1.AWS.NEON.TECH';
    const verdict = checkDbGuard(pgUrl(upperHost), DB_ENV_EXPECTED);
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) {
      expect(verdict.reason).toContain('STAGING');
    }
  });

  it('allows localhost without marker (CI service container)', () => {
    expect(
      checkDbGuard('postgresql://postgres:postgres@localhost:5432/onetable_test', undefined),
    ).toEqual({ allowed: true });
  });

  it('allows LOCALHOST in uppercase without marker (case-insensitive local match)', () => {
    expect(
      checkDbGuard('postgresql://postgres:postgres@LOCALHOST:5432/onetable_test', undefined),
    ).toEqual({ allowed: true });
  });

  it('allows 127.0.0.1 without marker', () => {
    expect(
      checkDbGuard('postgresql://postgres:postgres@127.0.0.1:5432/db', undefined),
    ).toEqual({ allowed: true });
  });

  it('blocks a remote non-production host WITHOUT the marker', () => {
    const verdict = checkDbGuard(pgUrl(DEV_HOST), undefined);
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) {
      expect(verdict.reason).toContain(DB_ENV_MARKER);
      expect(verdict.reason).toContain(DEV_HOST);
    }
  });

  it('blocks a remote non-production host with a WRONG marker value', () => {
    expect(checkDbGuard(pgUrl(DEV_HOST), 'production').allowed).toBe(false);
    expect(checkDbGuard(pgUrl(DEV_HOST), 'staging').allowed).toBe(false);
    expect(checkDbGuard(pgUrl(DEV_HOST), '').allowed).toBe(false);
  });

  it('allows a remote non-production host WITH ONETABLE_DB_ENV=development', () => {
    expect(checkDbGuard(pgUrl(DEV_HOST), DB_ENV_EXPECTED)).toEqual({ allowed: true });
  });

  it('blocks when DATABASE_URL is undefined', () => {
    const verdict = checkDbGuard(undefined, DB_ENV_EXPECTED);
    expect(verdict.allowed).toBe(false);
    if (!verdict.allowed) {
      expect(verdict.reason).toContain('DATABASE_URL no está definido');
    }
  });

  it('blocks when DATABASE_URL is unparseable (fail closed)', () => {
    expect(checkDbGuard('%%%not-a-url%%%', DB_ENV_EXPECTED).allowed).toBe(false);
  });
});
