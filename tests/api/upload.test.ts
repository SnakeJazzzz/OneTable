import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';

vi.mock('@/auth', () => ({
  auth: vi.fn(),
}));

import { POST } from '@/app/api/data/upload/route';
import { auth } from '@/auth';

const db = new PrismaClient();
const TEST_EMAIL = 'test-api-upload-s12@example.com';
const SAMPLES_DIR = resolve(__dirname, '../../docs/specs/viks-data/samples');

describe('POST /api/data/upload', () => {
  let userId: string;
  let clientId: string;

  beforeAll(async () => {
    await db.user.deleteMany({ where: { email: TEST_EMAIL } });
    const u = await db.user.create({ data: { email: TEST_EMAIL, passwordHash: 'x' } });
    userId = u.id;
    const c = await db.client.create({ data: { name: 'TEST API UPLOAD S12', userId } });
    clientId = c.id;
  });

  afterAll(async () => {
    await db.user.deleteMany({ where: { email: TEST_EMAIL } });
    await db.$disconnect();
    vi.restoreAllMocks();
  });

  function mockSession() {
    vi.mocked(auth).mockResolvedValueOnce({
      user: { id: userId, clientId, email: TEST_EMAIL },
      expires: new Date(Date.now() + 60_000).toISOString(),
    } as any);
  }

  function makeMultipartReq(
    files: Array<{ name: string; buffer: Buffer }>,
    fields?: Record<string, string>,
  ): Request {
    const form = new FormData();
    for (const f of files) {
      form.append(
        'files',
        new Blob([new Uint8Array(f.buffer)], {
          type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        }),
        f.name,
      );
    }
    if (fields) {
      for (const [key, value] of Object.entries(fields)) {
        form.append(key, value);
      }
    }
    return new Request('http://test/api/data/upload', { method: 'POST', body: form });
  }

  it('returns 401 when no session', async () => {
    vi.mocked(auth).mockResolvedValueOnce(null as any);

    const res = await POST(makeMultipartReq([]));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('returns 400 with NO_FILES when multipart has no file parts', async () => {
    mockSession();
    const form = new FormData();
    form.append('chain', 'SORIANA'); // arbitrary non-file field
    const req = new Request('http://test/api/data/upload', { method: 'POST', body: form });

    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('NO_FILES');
  });

  it(
    'processes a small soriana-sample.xlsx end-to-end',
    async () => {
      mockSession();
      const buffer = await readFile(resolve(SAMPLES_DIR, 'soriana-sample.xlsx'));

      const res = await POST(makeMultipartReq([{ name: 'soriana-sample.xlsx', buffer }]));
      expect(res.status).toBe(200);
      const body = await res.json();

      expect(body.perFile).toHaveLength(1);
      const f = body.perFile[0];
      expect(f.error).toBeUndefined();
      expect(f.chain).toBe('SORIANA');
      expect(f.fileType).toBe('MIXED');
      expect(typeof f.uploadId).toBe('string');
      expect(f.rowsTotal).toBeGreaterThan(0);
      expect(f.rowsInserted + f.rowsUpdated).toBe(f.rowsTotal);

      // Upload row was created and marked COMPLETED.
      const upload = await db.upload.findUnique({ where: { id: f.uploadId } });
      expect(upload?.status).toBe('COMPLETED');
      expect(upload?.clientId).toBe(clientId);
      expect(upload?.userId).toBe(userId);
      expect(upload?.processedAt).not.toBeNull();
    },
    60_000,
  );

  it(
    'routes correctly when explicit chain/fileType fields are set (filename is unrecognized)',
    async () => {
      mockSession();
      const buffer = await readFile(resolve(SAMPLES_DIR, 'soriana-sample.xlsx'));

      // 'report.xlsx' does NOT match detectUpload — proof that explicit fields win.
      const res = await POST(
        makeMultipartReq([{ name: 'report.xlsx', buffer }], {
          chain: 'SORIANA',
          fileType: 'MIXED',
        }),
      );
      expect(res.status).toBe(200);
      const body = await res.json();

      expect(body.perFile).toHaveLength(1);
      const f = body.perFile[0];
      expect(f.error).toBeUndefined();
      expect(f.chain).toBe('SORIANA');
      expect(f.fileType).toBe('MIXED');
      expect(typeof f.uploadId).toBe('string');
      expect(f.rowsTotal).toBeGreaterThan(0);
      expect(f.rowsInserted + f.rowsUpdated).toBe(f.rowsTotal);

      // Confirm the explicit chain/fileType were persisted to the Upload DB row.
      const upload = await db.upload.findUnique({ where: { id: f.uploadId } });
      expect(upload?.chain).toBe('SORIANA');
      expect(upload?.fileType).toBe('MIXED');
    },
    60_000,
  );

  it('returns per-file error when explicit chain field is invalid', async () => {
    mockSession();
    const fakeBuffer = Buffer.from('not really xlsx', 'utf-8');
    const res = await POST(
      makeMultipartReq([{ name: 'report.xlsx', buffer: fakeBuffer }], {
        chain: 'NOT_A_CHAIN',
        fileType: 'MIXED',
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('ALL_FILES_FAILED');
    expect(body.perFile).toHaveLength(1);
    expect(body.perFile[0].error).toMatch(/invalid explicit/);
  });

  it('returns per-file error when only one of chain/fileType is provided (chain without fileType)', async () => {
    mockSession();
    const fakeBuffer = Buffer.from('not really xlsx', 'utf-8');
    const res = await POST(
      makeMultipartReq([{ name: 'report.xlsx', buffer: fakeBuffer }], {
        chain: 'SORIANA',
        // fileType intentionally absent — malformed partial explicit
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('ALL_FILES_FAILED');
    expect(body.perFile[0].error).toMatch(/invalid explicit/);
  });

  it('returns per-file error when only one of chain/fileType is provided (fileType without chain)', async () => {
    mockSession();
    const fakeBuffer = Buffer.from('not really xlsx', 'utf-8');
    const res = await POST(
      makeMultipartReq([{ name: 'report.xlsx', buffer: fakeBuffer }], {
        fileType: 'MIXED',
        // chain intentionally absent — symmetric malformed partial explicit
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('ALL_FILES_FAILED');
    expect(body.perFile[0].error).toMatch(/chain field missing/);
  });

  it('returns per-file error naming the misuse when chain is sent as a File (B5-3 A5)', async () => {
    mockSession();
    const fakeBuffer = Buffer.from('not really xlsx', 'utf-8');
    // Hand-built form: `chain` is appended WITH a filename, which makes it a
    // File entry — a caller bug distinct from an absent field. The route must
    // say so instead of the misleading "chain field missing".
    const form = new FormData();
    form.append(
      'files',
      new Blob([new Uint8Array(fakeBuffer)], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }),
      'report.xlsx',
    );
    form.append('chain', new Blob(['SORIANA'], { type: 'text/plain' }), 'chain.txt');
    form.append('fileType', 'MIXED');
    const res = await POST(new Request('http://test/api/data/upload', { method: 'POST', body: form }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('ALL_FILES_FAILED');
    expect(body.perFile[0].error).toMatch(/chain field must be a plain text value, not a file/);
  });

  it('returns 400 when ALL files have unmatched filenames', async () => {
    mockSession();
    const fakeBuffer = Buffer.from('not really xlsx', 'utf-8');
    const res = await POST(
      makeMultipartReq([
        { name: 'unknown-file-1.xlsx', buffer: fakeBuffer },
        { name: 'random.xlsx', buffer: fakeBuffer },
      ]),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('ALL_FILES_FAILED');
    expect(body.perFile).toHaveLength(2);
    for (const f of body.perFile) {
      expect(f.error).toMatch(/unknown file type/);
    }
  });
});
