// Hardening T4 E1 — the conserved `throw e` in mappings DELETE/PATCH:
// a NON-ServiceError throw from the service must NOT be swallowed by the
// typed catch; it re-throws and lands in withRouteErrors → 500 INTERNAL
// (standard JSON shape) + one structured log line. Pre-T4 this was a raw
// Next 500 with no shape and no structured log.
//
// Own file (not portales-mappings.test.ts) on purpose: forcing a generic
// throw through the REAL service would require spying on the shared
// PrismaClient proxy, and restoring such a spy corrupts `$transaction` for
// every later test in the file (verified empirically). Here the service
// module is vi.mock-ed instead — zero DB, zero Prisma spies.
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/auth', () => ({
  auth: vi.fn(),
}));

vi.mock('@/core/normalizer/resolve', () => ({
  assignMapping: vi.fn(),
  deleteMapping: vi.fn(),
  retargetMapping: vi.fn(),
}));

import { PATCH } from '@/app/api/portales/mappings/route';
import { auth } from '@/auth';
import { retargetMapping } from '@/core/normalizer/resolve';
// REAL errors module (not mocked): the route's `instanceof ServiceError`
// check must see the same class this test throws.
import { ServiceError } from '@/core/normalizer/errors';

function mockSession() {
  vi.mocked(auth).mockResolvedValueOnce({
    user: { id: 'u-e1', clientId: 'c-e1', email: 'e1@test.local', name: 'Tester' },
    expires: new Date(Date.now() + 60_000).toISOString(),
  } as any);
}

function patchReq(): Request {
  return new Request('http://test/api/portales/mappings', {
    method: 'PATCH',
    body: JSON.stringify({
      chain: 'SORIANA',
      portalString: 'P',
      oldProductId: 'old-id',
      newProductId: 'new-id',
    }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('T4 E1 — mappings PATCH: conserved rethrow feeds the wrapper', () => {
  it('a NON-ServiceError service throw → 500 INTERNAL + structured log', async () => {
    mockSession();
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(retargetMapping).mockRejectedValueOnce(new Error('infra boom'));

    const res = await PATCH(patchReq());

    expect(res.status).toBe(500);
    expect((await res.json()).error.code).toBe('INTERNAL');

    expect(errSpy).toHaveBeenCalledTimes(1);
    const line = JSON.parse(errSpy.mock.calls[0][0] as string);
    expect(line.source).toBe('api');
    expect(line.route).toBe('portales/mappings');
    expect(line.method).toBe('PATCH');
    expect(line.message).toBe('infra boom');
    errSpy.mockRestore();
  });

  it('a ServiceError code WITHOUT a route mapping (defense-in-depth family) also re-throws → 500 INTERNAL', async () => {
    mockSession();
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(retargetMapping).mockRejectedValueOnce(
      new ServiceError('INVALID_WINNER', 'not reachable from PATCH, but the switch must not swallow it'),
    );

    const res = await PATCH(patchReq());

    expect(res.status).toBe(500);
    expect((await res.json()).error.code).toBe('INTERNAL');
    expect(errSpy).toHaveBeenCalledTimes(1);
    errSpy.mockRestore();
  });

  it('sanity: a mapped ServiceError code still hits the typed branch (404, no wrapper log)', async () => {
    mockSession();
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(retargetMapping).mockRejectedValueOnce(
      new ServiceError('MAPPING_NOT_FOUND', 'retargetMapping: mapping not found'),
    );

    const res = await PATCH(patchReq());

    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe('MAPPING_NOT_FOUND');
    expect(errSpy).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });
});
