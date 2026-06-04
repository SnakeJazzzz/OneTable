import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { main, DEMO_CLIENT_NAME } from '@/scripts/seed';

// This file runs the REAL static seed (scripts/seed.ts main()), which does a
// global TRUNCATE ... RESTART IDENTITY CASCADE before inserting. That is only
// safe because vitest.config.ts sets fileParallelism:false — no other test file
// runs concurrently. See the comment there.
const db = new PrismaClient();

describe('scripts/seed.ts — ThresholdConfig lifecycle', () => {
  // 60s: the seed does many sequential Neon round-trips (catalog import), which
  // exceeds vitest's 10s default hookTimeout.
  beforeAll(async () => {
    await main(db);
  }, 60000);

  afterAll(async () => {
    await db.$disconnect();
  });

  it('creates the VIKS client with a ThresholdConfig at the documented defaults', async () => {
    const client = await db.client.findFirst({ where: { name: DEMO_CLIENT_NAME } });
    expect(client).not.toBeNull();

    const tc = await db.thresholdConfig.findUnique({ where: { clientId: client!.id } });
    expect(tc).not.toBeNull();
    expect(tc!.criticoDays).toBe(7);
    expect(tc!.riesgoDays).toBe(14);
    expect(tc!.atencionDays).toBe(21);
    expect(tc!.excesoDays).toBe(60);
  });

  it('leaves no Client without a ThresholdConfig', async () => {
    const clients = await db.client.findMany({ select: { id: true } });
    expect(clients.length).toBeGreaterThan(0);

    const configs = await db.thresholdConfig.findMany({ select: { clientId: true } });
    const clientIdsWithConfig = new Set(configs.map(c => c.clientId));

    const orphans = clients.filter(c => !clientIdsWithConfig.has(c.id));
    expect(orphans).toHaveLength(0);
  });
});
