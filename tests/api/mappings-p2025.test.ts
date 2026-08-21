// Hardening T6 I-8 — the double-DELETE/PATCH race: a concurrent request can
// reach the service after the mapping row is already gone, and Prisma throws
// PrismaClientKnownRequestError P2025 (record not found). Pre-T6 that fell
// through the typed ServiceError branch to the conserved `throw e` →
// withRouteErrors → 500 INTERNAL. Post-T6 both catches map P2025 to the same
// 404 MAPPING_NOT_FOUND the ServiceError path already returns — the race is
// benign (final data is correct), so it must not surface as a 500.
//
// Same zero-DB pattern as mappings-e1-rethrow.test.ts: the service module is
// vi.mock-ed (no Prisma spies — restoring spies on the shared PrismaClient
// proxy corrupts `$transaction`, verified there). `@/lib/db` is mocked too
// because handleDelete does a route-level `db.upload.findFirst` BEFORE
// calling the service.
import { describe, it, expect, vi, beforeEach } from 'vitest';
// REAL Prisma namespace: the route's `instanceof PrismaClientKnownRequestError`
// check must see the same class this test throws.
import { Prisma } from '@prisma/client';

vi.mock('@/auth', () => ({
  auth: vi.fn(),
}));

vi.mock('@/core/normalizer/resolve', () => ({
  assignMapping: vi.fn(),
  deleteMapping: vi.fn(),
  retargetMapping: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: {
    upload: { findFirst: vi.fn() },
  },
}));

import { DELETE, PATCH } from '@/app/api/portales/mappings/route';
import { auth } from '@/auth';
import { db } from '@/lib/db';
import { deleteMapping, retargetMapping } from '@/core/normalizer/resolve';

function mockSession() {
  vi.mocked(auth).mockResolvedValueOnce({
    user: { id: 'u-i8', clientId: 'c-i8', email: 'i8@test.local', name: 'Tester' },
    expires: new Date(Date.now() + 60_000).toISOString(),
  } as any);
}

function p2025(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('record not found', {
    code: 'P2025',
    clientVersion: 'test',
  });
}

function deleteReq(): Request {
  return new Request('http://test/api/portales/mappings', {
    method: 'DELETE',
    body: JSON.stringify({ chain: 'SORIANA', portalString: 'P', productId: 'prod-id' }),
  });
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

describe('T6 I-8 — mappings DELETE/PATCH: Prisma P2025 (lost race) → 404, not 500', () => {
  it('DELETE: service throws P2025 → 404 MAPPING_NOT_FOUND, no wrapper log', async () => {
    mockSession();
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // Route-level pre-check passes: there IS an upload to re-anchor to.
    vi.mocked(db.upload.findFirst).mockResolvedValueOnce({ id: 'up-i8' } as any);
    vi.mocked(deleteMapping).mockRejectedValueOnce(p2025());

    const res = await DELETE(deleteReq());

    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe('MAPPING_NOT_FOUND');
    expect(errSpy).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it('PATCH: service throws P2025 → 404 MAPPING_NOT_FOUND, no wrapper log', async () => {
    mockSession();
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(retargetMapping).mockRejectedValueOnce(p2025());

    const res = await PATCH(patchReq());

    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe('MAPPING_NOT_FOUND');
    expect(errSpy).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });

  it('narrowness: any OTHER Prisma code still re-throws to the wrapper → 500 INTERNAL', async () => {
    mockSession();
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.mocked(retargetMapping).mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('unique violated', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );

    const res = await PATCH(patchReq());

    expect(res.status).toBe(500);
    expect((await res.json()).error.code).toBe('INTERNAL');
    expect(errSpy).toHaveBeenCalledTimes(1);
    errSpy.mockRestore();
  });
});
