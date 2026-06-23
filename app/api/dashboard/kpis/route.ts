/**
 * GET /api/dashboard/kpis — bundle of 6 KPI/chart queries for one period.
 *
 * Query params (both optional):
 *   ?periodYear=YYYY  (e.g. 2025)
 *   ?periodMonth=M    (1–12)
 *
 * If either is missing or unparseable, the route resolves the default via
 * `getDefaultPeriod`: the most recent period with ≥2 chains of data (S12.1).
 * Falls back to the latest period overall if no multi-chain period exists.
 * If the client has zero rows yet, the response returns zeroed KPIs + empty
 * arrays and a `noData: true` flag so the frontend can render an empty state
 * instead of crashing on `undefined.salesAmountMxn`.
 *
 * Auth: required. clientId + userId are taken from the JWT and passed to the
 * S8 query helpers, which enforce the (clientId, userId) WHERE doubled-belt.
 *
 * All 6 queries run in parallel via `Promise.all` — they share no state and
 * the Neon pool handles concurrent connections cleanly.
 */

import { db } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import { getThresholdCuts } from '@/lib/thresholds';
import {
  getDashboardKpis,
  getSalesTrend,
  getSalesByChainForPeriod,
  getInventorySemaforo,
  getTopSkusByChain,
  getDaysOfInventoryBySku,
  getDefaultPeriod,
} from '@/core/kpis/queries';

const TOP_SKUS_LIMIT = 5;
const TREND_MONTHS_BACK = 6;

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

  // Global, period-independent counts for the Dashboard banners (§8.4). Hoisted
  // above the noData check so the banners show even in an empty/onboarding period.
  const [unmappedCount, conflictRows] = await Promise.all([
    db.unmappedProduct.count({ where: { clientId, resolvedAt: null } }),
    db.productMapping.findMany({
      where: { clientId, status: 'CONFLICTED' },
      select: { chain: true, portalString: true },
      distinct: ['chain', 'portalString'], // FIX-3 — cross-chain
    }),
  ]);
  const conflictCount = conflictRows.length;

  const url = new URL(req.url);
  let periodYear = parsePeriodParam(url.searchParams.get('periodYear'), 2000, 2100);
  let periodMonth = parsePeriodParam(url.searchParams.get('periodMonth'), 1, 12);

  // Auto-detect period if params absent or invalid. Prefer the most recent
  // multi-chain period (S12.1) so the dashboard doesn't open on a single-chain
  // snapshot when other portals have older but richer data.
  if (periodYear === null || periodMonth === null) {
    const defaultPeriod = await getDefaultPeriod(db, { clientId, userId });

    if (!defaultPeriod) {
      // No data at all — empty-state response.
      return Response.json({
        noData: true,
        period: null,
        kpis: {
          salesAmountMxn: 0,
          variationPct: null,
          salesUnits: 0,
          activeAlertsSkuCount: 0,
        },
        trend: [],
        byChain: [],
        semaforo: [],
        topSkus: [],
        daysInv: [],
        unmappedCount,
        conflictCount,
      });
    }
    periodYear = defaultPeriod.periodYear;
    periodMonth = defaultPeriod.periodMonth;
  }

  const baseParams = { clientId, userId };
  const periodParams = { ...baseParams, periodYear, periodMonth };

  // Per-client alert bands, loaded ONCE per request (not per row).
  const cuts = await getThresholdCuts(db, clientId);

  // Six queries in parallel — independent, no shared state.
  const [kpis, trend, byChain, semaforo, topSkus, daysInv] = await Promise.all([
    getDashboardKpis(db, periodParams, cuts),
    getSalesTrend(db, { ...baseParams, monthsBack: TREND_MONTHS_BACK }),
    getSalesByChainForPeriod(db, periodParams),
    getInventorySemaforo(db, periodParams, cuts),
    getTopSkusByChain(db, { ...periodParams, limit: TOP_SKUS_LIMIT }),
    getDaysOfInventoryBySku(db, periodParams),
  ]);

  return Response.json({
    noData: false,
    period: { year: periodYear, month: periodMonth },
    kpis,
    trend,
    byChain,
    semaforo,
    topSkus,
    daysInv,
    unmappedCount,
    conflictCount,
  });
}
