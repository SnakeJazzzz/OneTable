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

export type ThresholdValidation = { ok: true } | { ok: false; error: string };

// §3.1.3: reject overlapping cuts. All > 0 and strictly increasing. Pure so it
// can be reused by both the thresholds PUT route (server-side guard, never trust
// the client) and the Parámetros UI for inline feedback before submit.
export function validateThresholdCuts(c: ThresholdCuts): ThresholdValidation {
  if (![c.critico, c.riesgo, c.atencion, c.exceso].every((n) => Number.isInteger(n) && n > 0))
    return { ok: false, error: 'Todos los cortes deben ser enteros mayores a 0.' };
  if (!(c.critico < c.riesgo && c.riesgo < c.atencion && c.atencion < c.exceso))
    return { ok: false, error: 'Los cortes deben cumplir: crítico < riesgo < atención < exceso.' };
  return { ok: true };
}
