/**
 * GET /api/dashboard/kpis — bundle of 6 KPI/chart queries for one period.
 *
 * Query params (both optional):
 *   ?periodYear=YYYY  (e.g. 2025)
 *   ?periodMonth=M    (1–12)
 *
 * If either is missing or unparseable, the route auto-detects the LATEST
 * (year, month) present in SelloutData for this client. If the client has
 * zero rows yet, the response returns zeroed KPIs + empty arrays and a
 * `noData: true` flag so the frontend can render an empty state instead of
 * crashing on `undefined.salesAmountMxn`.
 *
 * Auth: required. clientId + userId are taken from the JWT and passed to the
 * S8 query helpers, which enforce the (clientId, userId) WHERE doubled-belt.
 *
 * All 6 queries run in parallel via `Promise.all` — they share no state and
 * the Neon pool handles concurrent connections cleanly.
 */

import { db } from '@/lib/db';
import { requireAuth } from '@/lib/auth-helpers';
import {
  getDashboardKpis,
  getSalesTrend,
  getSalesByChainForPeriod,
  getInventorySemaforo,
  getTopSkusByChain,
  getDaysOfInventoryBySku,
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

  const url = new URL(req.url);
  let periodYear = parsePeriodParam(url.searchParams.get('periodYear'), 2000, 2100);
  let periodMonth = parsePeriodParam(url.searchParams.get('periodMonth'), 1, 12);

  // Auto-detect latest period if params absent or invalid.
  if (periodYear === null || periodMonth === null) {
    const latest = await db.selloutData.findFirst({
      where: { clientId, userId },
      orderBy: [{ periodYear: 'desc' }, { periodMonth: 'desc' }],
      select: { periodYear: true, periodMonth: true },
    });

    if (!latest) {
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
      });
    }
    periodYear = latest.periodYear;
    periodMonth = latest.periodMonth;
  }

  const baseParams = { clientId, userId };
  const periodParams = { ...baseParams, periodYear, periodMonth };

  // Six queries in parallel — independent, no shared state.
  const [kpis, trend, byChain, semaforo, topSkus, daysInv] = await Promise.all([
    getDashboardKpis(db, periodParams),
    getSalesTrend(db, { ...baseParams, monthsBack: TREND_MONTHS_BACK }),
    getSalesByChainForPeriod(db, periodParams),
    getInventorySemaforo(db, periodParams),
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
  });
}
