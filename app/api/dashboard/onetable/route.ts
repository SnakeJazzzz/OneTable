/**
 * GET /api/dashboard/onetable — full per-store rows for a period.
 *
 * Powers the consolidated OneTable on /dashboard (G5b). The unmapped-products
 * count moved to the dashboard onboarding banners (§8.4, served by
 * /api/dashboard/kpis); this route no longer returns it.
 *
 * Query params (both optional):
 *   ?periodYear=YYYY
 *   ?periodMonth=M
 *
 * If absent or invalid, the route resolves the default via getDefaultPeriod
 * (multi-chain-preferred, same as /api/dashboard/kpis). When the client has
 * no data, returns empty arrays + period=null.
 *
 * Auth: required. clientId + userId from the JWT; double-belt WHERE.
 */

import { db } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { getThresholdCuts } from '@/lib/thresholds';
import { getOneTableRows, getDefaultPeriod } from '@/core/kpis/queries';

function parsePeriodParam(raw: string | null, min: number, max: number): number | null {
  if (raw === null || raw === '') return null;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) return null;
  return n;
}

export async function GET(req: Request): Promise<Response> {
  const sessionOrError = await requireAuth();
  if (sessionOrError instanceof Response) return sessionOrError;
  const { clientId, userId } = sessionOrError;

  const url = new URL(req.url);
  let periodYear = parsePeriodParam(url.searchParams.get('periodYear'), 2000, 2100);
  let periodMonth = parsePeriodParam(url.searchParams.get('periodMonth'), 1, 12);

  if (periodYear === null || periodMonth === null) {
    const def = await getDefaultPeriod(db, { clientId, userId });
    if (!def) {
      return Response.json({
        period: null,
        rows: [],
      });
    }
    periodYear = def.periodYear;
    periodMonth = def.periodMonth;
  }

  // Per-client alert bands, loaded ONCE per request (not per row).
  const cuts = await getThresholdCuts(db, clientId);

  const rows = await getOneTableRows(db, { clientId, userId, periodYear, periodMonth }, cuts);

  return Response.json({
    period: { year: periodYear, month: periodMonth },
    rows,
  });
}
