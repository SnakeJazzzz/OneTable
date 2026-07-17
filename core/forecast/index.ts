// Forecasting scaffold — gate-only implementation (B5 T3, spec §9.2.1/§9.2.3).
//
// Fase 2 ships ONLY the "3 months" gate: getForecast counts distinct periods
// with real sales for one (clientId, productId, chain) series and always
// returns `kind: 'insufficient'` (the 'forecast' branch — baseline-ma3 — is
// Fase 2.5). getForecastOverview (C2, external-filter correction) is the
// aggregated listing the /api/forecast route consumes in ONE query instead of
// iterating getForecast per product×chain.
//
// Purity contract (same as core/kpis/queries): read-only, PrismaClient and
// clientId injected by the caller, zero imports from lib/ or Next — core/
// stays extractable to Python/FastAPI in Fase 3.
//
// Tenant scoping: the frozen §9.2.1 signature takes clientId ONLY (no userId,
// unlike core/kpis/queries' doubled belt). D3 closes the model to one Client
// per account, so the clientId WHERE is the tenant boundary here.
import type { PrismaClient, Chain } from '@prisma/client';

// Placeholder for the 2.5 baseline-ma3 build. §9.2.1 references ForecastPoint
// without defining it; this minimal shape exists so the frozen ForecastResult
// union compiles today. Finalize (confidence bands, amounts, etc.) in 2.5 —
// nothing consumes the 'forecast' branch in Fase 2.
export type ForecastPoint = {
  periodYear: number;
  periodMonth: number;
  salesUnits: number;
};

// EXACT shape per spec §9.2.1 (frozen design).
export type ForecastResult =
  | {
      kind: 'forecast';
      method: 'baseline-ma3';
      points: ForecastPoint[];
      confidence: 'low' | 'medium';
    }
  | {
      kind: 'insufficient';
      monthsAvailable: number;
      monthsRequired: 3;
      nextEligible: string /* YYYY-MM */;
    };

export type ForecastOverviewRow = {
  productId: string;
  productName: string;
  chain: Chain;
  monthsAvailable: number;
  nextEligible: string /* YYYY-MM */;
};

const MONTHS_REQUIRED = 3;

// Linear month key, same convention as core/kpis/queries.getSalesTrend:
// k = year * 12 + month - 1. Reversible: year = floor(k/12), month = k%12 + 1.
function toMonthKey(periodYear: number, periodMonth: number): number {
  return periodYear * 12 + periodMonth - 1;
}

function monthKeyToYYYYMM(k: number): string {
  const year = Math.floor(k / 12);
  const month = (k % 12) + 1;
  return `${year}-${String(month).padStart(2, '0')}`;
}

// nextEligible semantics — SCAFFOLD DECISION, closed by Michael 2026-07-16
// (C1 of the T3 external filter), revisitable in 2.5 (today only the
// Forecasting card consumes this field):
//   (a) monthsAvailable > 0: nextEligible = LAST period with data
//       + (3 - monthsAvailable) months. "Last period with data" = the most
//       recent period where salesUnits > 0 (gaps in the series do not reset
//       the count — 2 months available means 1 more month is needed, counted
//       from the last real data point).
//   (b) monthsAvailable = 0 (no anchor period — case not contemplated by
//       §9.2.1): nextEligible = current month + 3.
// Note on the ≥3 stub (see getForecast): the formula is applied uniformly, so
// with monthsAvailable ≥ 3 the value lands in the present/past and is not
// meaningful — the UI ignores it on that branch by design.
function computeNextEligible(
  monthsAvailable: number,
  lastMonthKey: number | null,
  now: Date,
): string {
  if (monthsAvailable === 0 || lastMonthKey === null) {
    const currentKey = now.getFullYear() * 12 + now.getMonth(); // getMonth() is 0-based → already y*12 + m - 1
    return monthKeyToYYYYMM(currentKey + MONTHS_REQUIRED);
  }
  return monthKeyToYYYYMM(lastMonthKey + (MONTHS_REQUIRED - monthsAvailable));
}

/**
 * The "3 months" gate (spec §9.2.1 — frozen signature). Counts DISTINCT
 * periods with salesUnits > 0 for (clientId, productId, chain); rows with
 * salesUnits 0 or NULL do not count as available months.
 *
 * SCAFFOLD STUB (documented, conscious): even when monthsAvailable ≥ 3 this
 * returns `kind: 'insufficient'` with the REAL monthsAvailable — the
 * 'forecast' branch (baseline-ma3) is built in Fase 2.5. The UI renders
 * "Forecast disponible próximamente" for that edge instead of the
 * contradictory "necesito 3 meses" copy. When 2.5 merges, this function grows
 * the forecast branch and the card auto-renders it without UI changes
 * (§9.2.3).
 */
export async function getForecast(
  db: PrismaClient,
  args: { clientId: string; productId: string; chain: Chain },
): Promise<ForecastResult> {
  const { clientId, productId, chain } = args;

  // Prisma groupBy (not raw SQL): one read-only query returning the distinct
  // (periodYear, periodMonth) pairs with real sales. A single series holds at
  // most a few dozen periods, so reducing count/max in JS is trivially cheap
  // and avoids raw-SQL enum casting for `chain`.
  const periods = await db.selloutData.groupBy({
    by: ['periodYear', 'periodMonth'],
    where: {
      clientId,
      productId,
      chain,
      salesUnits: { gt: 0 }, // excludes NULL too — NULL never satisfies > 0
    },
  });

  const monthsAvailable = periods.length;
  let lastMonthKey: number | null = null;
  for (const p of periods) {
    const k = toMonthKey(p.periodYear, p.periodMonth);
    if (lastMonthKey === null || k > lastMonthKey) lastMonthKey = k;
  }

  return {
    kind: 'insufficient',
    monthsAvailable,
    monthsRequired: MONTHS_REQUIRED,
    nextEligible: computeNextEligible(monthsAvailable, lastMonthKey, new Date()),
  };
}

/**
 * Aggregated gate listing for /api/forecast (C2). ONE query: GROUP BY
 * productId × chain over the client's SelloutData, counting distinct periods
 * with salesUnits > 0 and joining Product for the display name. The route
 * calls this once — never getForecast in a loop.
 *
 * Unmapped rows (productId NULL) are excluded by the INNER JOIN: forecasting
 * is defined per catalog product (§9.2), and an unmapped raw string has no
 * product identity to forecast against.
 *
 * A product×chain whose rows ALL have salesUnits 0/NULL still appears (the
 * FILTER clause zeroes the count, the group survives) with monthsAvailable 0
 * — honest "no real sales yet" state for the card.
 */
export async function getForecastOverview(
  db: PrismaClient,
  args: { clientId: string },
): Promise<ForecastOverviewRow[]> {
  const { clientId } = args;

  const rows = await db.$queryRaw<
    Array<{
      product_id: string;
      product_name: string;
      chain: Chain;
      months_available: bigint;
      last_month_key: number | null;
    }>
  >`
    SELECT
      sd."productId"    AS product_id,
      p."nameStandard"  AS product_name,
      sd.chain          AS chain,
      COUNT(DISTINCT sd."periodYear" * 12 + sd."periodMonth" - 1)
        FILTER (WHERE sd."salesUnits" > 0)::bigint AS months_available,
      MAX(sd."periodYear" * 12 + sd."periodMonth" - 1)
        FILTER (WHERE sd."salesUnits" > 0)         AS last_month_key
    FROM "SelloutData" sd
    JOIN "Product" p ON p.id = sd."productId"
    WHERE sd."clientId" = ${clientId}
    GROUP BY sd."productId", p."nameStandard", sd.chain
    ORDER BY p."nameStandard" ASC, sd.chain ASC
  `;

  const now = new Date();
  return rows.map((r) => {
    const monthsAvailable = Number(r.months_available);
    const lastMonthKey = r.last_month_key === null ? null : Number(r.last_month_key);
    return {
      productId: r.product_id,
      productName: r.product_name,
      chain: r.chain,
      monthsAvailable,
      nextEligible: computeNextEligible(monthsAvailable, lastMonthKey, now),
    };
  });
}
