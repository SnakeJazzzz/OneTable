import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { getThresholdCuts, validateThresholdCuts } from '@/lib/thresholds';
import { DEFAULT_CUTS } from '@/core/alerts/classify';

const db = new PrismaClient();
const TEST_EMAIL = 'b2-thresholds@test.local';

describe('getThresholdCuts', () => {
  let withCfgClientId: string;
  let noCfgClientId: string;

  beforeAll(async () => {
    await db.user.deleteMany({ where: { email: TEST_EMAIL } });
    const u = await db.user.create({ data: { email: TEST_EMAIL, passwordHash: 'x' } });

    const c1 = await db.client.create({
      data: {
        name: 'B2 WITH CFG',
        userId: u.id,
        thresholdConfig: {
          create: { criticoDays: 3, riesgoDays: 9, atencionDays: 15, excesoDays: 45 },
        },
      },
    });
    withCfgClientId = c1.id;

    // A client deliberately created WITHOUT a ThresholdConfig (defensive path).
    const c2 = await db.client.create({ data: { name: 'B2 NO CFG', userId: u.id } });
    noCfgClientId = c2.id;
  });

  afterAll(async () => {
    await db.user.deleteMany({ where: { email: TEST_EMAIL } });
    await db.$disconnect();
  });

  it('returns the configured cuts when a ThresholdConfig exists', async () => {
    const cuts = await getThresholdCuts(db, withCfgClientId);
    expect(cuts).toEqual({ critico: 3, riesgo: 9, atencion: 15, exceso: 45 });
  });

  it('falls back to DEFAULT_CUTS when no ThresholdConfig exists', async () => {
    const cuts = await getThresholdCuts(db, noCfgClientId);
    expect(cuts).toEqual(DEFAULT_CUTS);
  });
});

describe('validateThresholdCuts', () => {
  it('accepts a strictly increasing positive-integer set', () => {
    expect(validateThresholdCuts({ critico: 7, riesgo: 14, atencion: 21, exceso: 60 })).toEqual({
      ok: true,
    });
  });

  it('rejects equal adjacent cuts (overlap)', () => {
    const r = validateThresholdCuts({ critico: 7, riesgo: 7, atencion: 21, exceso: 60 });
    expect(r.ok).toBe(false);
  });

  it('rejects descending cuts', () => {
    const r = validateThresholdCuts({ critico: 60, riesgo: 21, atencion: 14, exceso: 7 });
    expect(r.ok).toBe(false);
  });

  it('rejects a zero cut', () => {
    const r = validateThresholdCuts({ critico: 0, riesgo: 14, atencion: 21, exceso: 60 });
    expect(r.ok).toBe(false);
  });

  it('rejects a negative cut', () => {
    const r = validateThresholdCuts({ critico: -1, riesgo: 14, atencion: 21, exceso: 60 });
    expect(r.ok).toBe(false);
  });

  it('rejects a non-integer cut', () => {
    const r = validateThresholdCuts({ critico: 7.5, riesgo: 14, atencion: 21, exceso: 60 });
    expect(r.ok).toBe(false);
  });
});
