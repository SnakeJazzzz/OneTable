import { describe, it, expect, afterAll, vi } from 'vitest';
import { GET } from '@/app/api/health/route';
import { db } from '@/lib/db';

describe('GET /api/health', () => {
  afterAll(async () => {
    await db.$disconnect();
    vi.restoreAllMocks();
  });

  it('returns 200 { status: ok, db: up } when the DB is reachable', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    // toEqual is exact: also asserts no extra keys (no versions/hosts leak).
    expect(await res.json()).toEqual({ status: 'ok', db: 'up' });
  });

  it('returns 503 { status: error, db: down } when the DB check fails', async () => {
    vi.spyOn(db, '$queryRaw').mockRejectedValueOnce(new Error('boom'));
    const res = await GET();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ status: 'error', db: 'down' });
  });
});
