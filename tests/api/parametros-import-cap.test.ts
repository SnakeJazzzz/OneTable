/**
 * Route-level tests for the 10MB cap on POST /api/parametros/import
 * (hardening T2 §2.9). The importer core has its own suite in
 * tests/parameters/import.test.ts — this file only pins the HTTP guard:
 * status 413 + code FILE_TOO_LARGE (both spec-pinned), error shape from the
 * repo convention (errorResponse → { error: { code, message } }).
 *
 * Boundary files mock `File.size` via Object.defineProperty on a tiny real
 * File — no 10MB of bytes are ever materialized — and reach the route
 * through a stubbed `req.formData()` (a real multipart Request would
 * re-serialize the File and recompute size from actual bytes).
 */
import { describe, it, expect, vi, afterAll } from 'vitest';

vi.mock('@/auth', () => ({
  auth: vi.fn(),
}));

import { POST } from '@/app/api/parametros/import/route';
import { auth } from '@/auth';
import { MAX_UPLOAD_FILE_BYTES } from '@/lib/upload-limits';

function mockSession(): void {
  vi.mocked(auth).mockResolvedValueOnce({
    user: { id: 'fake-user', clientId: 'fake-client', email: 't2-cap@example.test' },
    expires: new Date(Date.now() + 60_000).toISOString(),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
}

function makeSizedFileReq(size: number): Request {
  const file = new File([new Uint8Array(16)], 'parametros.xlsx');
  Object.defineProperty(file, 'size', { value: size });
  const form = { get: (name: string) => (name === 'file' ? file : null) };
  return { formData: async () => form } as unknown as Request;
}

afterAll(() => {
  vi.restoreAllMocks();
});

describe('POST /api/parametros/import — 10MB cap (T2 §2.9)', () => {
  it('rejects a file over 10MB with 413 + FILE_TOO_LARGE (pre-buffer)', async () => {
    mockSession();
    const res = await POST(makeSizedFileReq(MAX_UPLOAD_FILE_BYTES + 1));
    expect(res.status).toBe(413);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('FILE_TOO_LARGE');
  });

  it('a file of exactly 10MB passes the cap (reaches the importer)', async () => {
    mockSession();
    // Silence the route's console.error in case the importer throws.
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await POST(makeSizedFileReq(MAX_UPLOAD_FILE_BYTES));
    errorSpy.mockRestore();
    // The pinned boundary assertion is that ==10MB is NOT rejected by the
    // cap. (Empirically, xlsx parses 16 zero bytes leniently as an empty
    // workbook, so the importer returns a 200 no-op — either way, what must
    // NOT happen is a 413 FILE_TOO_LARGE.)
    expect(res.status).not.toBe(413);
    const body = (await res.json()) as { error?: { code?: string } };
    expect(body.error?.code).not.toBe('FILE_TOO_LARGE');
  });
});
