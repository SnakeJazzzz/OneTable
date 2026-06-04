import type { PrismaClient } from '@prisma/client';
import { DEFAULT_CUTS, type ThresholdCuts } from '@/core/alerts/classify';

// Loads a client's ThresholdConfig and maps it to ThresholdCuts. Every Client
// gets a ThresholdConfig at signup (B1 §4.5), so the fallback is defensive —
// it covers direct DB callers / pre-B1 rows. Called ONCE per request in the
// dashboard routes; never inside a per-row loop.
export async function getThresholdCuts(
  db: PrismaClient,
  clientId: string,
): Promise<ThresholdCuts> {
  const cfg = await db.thresholdConfig.findUnique({ where: { clientId } });
  if (!cfg) return DEFAULT_CUTS;
  return {
    critico: cfg.criticoDays,
    riesgo: cfg.riesgoDays,
    atencion: cfg.atencionDays,
    exceso: cfg.excesoDays,
  };
}
