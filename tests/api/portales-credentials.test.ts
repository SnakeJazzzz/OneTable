import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '@/lib/db';

const EMAIL = 'b4-creds@test.local';

describe('PortalCredential write contract', () => {
  let clientId: string;
  beforeAll(async () => {
    await db.user.deleteMany({ where: { email: EMAIL } });
    const u = await db.user.create({ data: { email: EMAIL, passwordHash: 'x' } });
    const c = await db.client.create({ data: { name: 'B4 CREDS', userId: u.id } });
    clientId = c.id;
  });
  afterAll(async () => {
    await db.user.deleteMany({ where: { email: EMAIL } });
    await db.$disconnect();
  });

  it('create + update dedup by (clientId, chain), stays password-free', async () => {
    // First upsert: CREATE path (no existing row for this (clientId, chain)).
    // update shape intentionally matches the route's real update: { username } only.
    await db.portalCredential.upsert({
      where: { clientId_chain: { clientId, chain: 'SORIANA' } },
      create: { clientId, chain: 'SORIANA', username: 'viks', isActive: true, hasPasswordPending: true },
      update: { username: 'viks-2' },
    });

    // Second upsert: UPDATE path — same (clientId, chain), different username.
    // This exercises the real dedup path and the { username }-only update shape.
    await db.portalCredential.upsert({
      where: { clientId_chain: { clientId, chain: 'SORIANA' } },
      create: { clientId, chain: 'SORIANA', username: 'viks-2', isActive: true, hasPasswordPending: true },
      update: { username: 'viks-2' },
    });

    // (a) Exactly one row for (clientId, chain) — dedup by unique index.
    const rows = await db.portalCredential.findMany({ where: { clientId, chain: 'SORIANA' } });
    expect(rows).toHaveLength(1);
    const row = rows[0];

    // (b) Username is the second value — proves the update path ran.
    expect(row.username).toBe('viks-2');

    // (c) hasPasswordPending is still true — proves flag survives a username-only update.
    expect(row.hasPasswordPending).toBe(true);

    // (d) The schema has no `password` column — this is the §6.1 guarantee. If a
    // password column is ever added, it shows up in the row's keys and this
    // assertion fails loudly (no cast needed).
    expect(Object.keys(row)).not.toContain('password');
  });
});
