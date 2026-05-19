/**
 * GET /api/dashboard/periods — list of all (year, month) periods present in
 * SelloutData for the authenticated client, plus the resolved default.
 *
 * Powers the dashboard's period selector. Empty list when the client has no
 * data yet — the page renders the empty state and hides the selector.
 *
 * Auth: required. clientId + userId from the JWT, double-belt WHERE.
 *
 * Response shape:
 *   { periods: string[], defaultPeriod: string | null }
 * Each period is "YYYY-MM" (zero-padded month). Sorted descending so the most
 * recent period is the first option. defaultPeriod uses the same multi-chain-
 * preferred resolution that /api/dashboard/kpis uses (S12.1).
 */

import { db } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { getDefaultPeriod } from '@/core/kpis/queries';

function format(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

export async function GET(): Promise<Response> {
  const sessionOrError = await requireAuth();
  if (sessionOrError instanceof Response) return sessionOrError;
  const { clientId, userId } = sessionOrError;

  const rows = await db.$queryRaw<Array<{ y: number; m: number }>>`
    SELECT DISTINCT "periodYear" AS y, "periodMonth" AS m
    FROM "SelloutData"
    WHERE "clientId" = ${clientId} AND "userId" = ${userId}
    ORDER BY y DESC, m DESC
  `;

  const periods = rows.map((r) => format(Number(r.y), Number(r.m)));

  if (periods.length === 0) {
    return Response.json({ periods: [], defaultPeriod: null });
  }

  const def = await getDefaultPeriod(db, { clientId, userId });
  const defaultPeriod = def ? format(def.periodYear, def.periodMonth) : null;

  return Response.json({ periods, defaultPeriod });
}
