/**
 * GET /api/forecast — forecasting gate overview for the Forecasting card
 * (B5 T3, spec §9.2.3 + C2 of the T3 brief).
 *
 * Read-only. Returns one row per (product × chain) of the session's client:
 *   { productId, productName, chain, monthsAvailable, nextEligible }
 *
 * ONE call to getForecastOverview (single aggregated query) — never
 * getForecast iterated per product×chain.
 *
 * Auth: required. clientId comes EXCLUSIVELY from the JWT via requireAuth();
 * the request URL/query is ignored entirely, so injected ids are inert.
 */

import { db } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { getForecastOverview } from '@/core/forecast';

// The request is accepted but deliberately unread: no query param can steer
// tenant identity (test group asserts injected ?clientId=... is inert).
export async function GET(_req: Request): Promise<Response> {
  const sessionOrError = await requireAuth();
  if (sessionOrError instanceof Response) return sessionOrError;
  const { clientId } = sessionOrError;

  const rows = await getForecastOverview(db, { clientId });
  return Response.json({ rows });
}
