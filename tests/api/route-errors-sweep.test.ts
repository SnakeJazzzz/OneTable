// Hardening T4 §6 — representative family coverage of the withRouteErrors
// sweep: one class (b) route (parametros/thresholds PUT — partial try/catch,
// DB call was outside it) and one class (c) route (dashboard/kpis GET — zero
// try/catch pre-T4). A DB throw now yields 500 INTERNAL (standard shape) plus
// ONE structured JSON log line, instead of the pre-T4 raw Next 500.
//
// The remaining 22 routes are covered by the single shared pattern +
// tests/lib/route-errors.test.ts + the E6 table in the T4 report.
import { describe, it, expect, vi, afterAll, afterEach } from 'vitest';

// Mock @/auth BEFORE importing the route handlers — otherwise auth.ts runs
// for real and pulls a JWT cookie from a non-existent request.
vi.mock('@/auth', () => ({
  auth: vi.fn(),
}));

import { PUT as thresholdsPut } from '@/app/api/parametros/thresholds/route';
import { GET as kpisGet } from '@/app/api/dashboard/kpis/route';
import { auth } from '@/auth';
// The routes' own PrismaClient instance — spied on to force the throw.
import { db } from '@/lib/db';

function mockSession() {
  vi.mocked(auth).mockResolvedValueOnce({
    user: { id: 'u-sweep', clientId: 'c-sweep', email: 'sweep@test.local', name: 'Tester' },
    expires: new Date(Date.now() + 60_000).toISOString(),
  } as any);
}

afterEach(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  await db.$disconnect();
});

describe('T4 sweep — class (b): parametros/thresholds PUT', () => {
  it('a DB throw on the upsert (outside the old try) → 500 INTERNAL + structured log', async () => {
    mockSession();
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(db.thresholdConfig, 'upsert').mockRejectedValueOnce(new Error('neon down'));

    const res = await thresholdsPut(
      new Request('http://test/api/parametros/thresholds', {
        method: 'PUT',
        body: JSON.stringify({ critico: 7, riesgo: 14, atencion: 21, exceso: 60 }),
      }),
    );

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe('INTERNAL');

    expect(errSpy).toHaveBeenCalledTimes(1);
    const line = JSON.parse(errSpy.mock.calls[0][0] as string);
    expect(line.source).toBe('api');
    expect(line.route).toBe('parametros/thresholds');
    expect(line.method).toBe('PUT');
    expect(line.name).toBe('Error');
    expect(line.message).toBe('neon down');
  });
});

describe('T4 sweep — class (c): dashboard/kpis GET', () => {
  it('a DB throw on the first query (zero try/catch pre-T4) → 500 INTERNAL + structured log', async () => {
    mockSession();
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(db.unmappedProduct, 'count').mockRejectedValueOnce(new Error('neon down'));

    const res = await kpisGet(new Request('http://test/api/dashboard/kpis'));

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe('INTERNAL');

    expect(errSpy).toHaveBeenCalledTimes(1);
    const line = JSON.parse(errSpy.mock.calls[0][0] as string);
    expect(line.source).toBe('api');
    expect(line.route).toBe('dashboard/kpis');
    expect(line.method).toBe('GET');
    expect(line.name).toBe('Error');
  });
});
