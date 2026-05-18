import type { PrismaClient, Chain } from '@prisma/client';
import { classifyAlert, type AlertStatus } from '../alerts/classify';

// =====================================================================
// Types
// =====================================================================

export type DashboardKpis = {
  salesAmountMxn: number;
  variationPct: number | null;
  salesUnits: number;
  activeAlertsSkuCount: number;
};

export type ChainSalesPoint = {
  chain: Chain;
  periodYear: number;
  periodMonth: number;
  salesAmountMxn: number;
  salesUnits: number;
};

export type SkuInventoryStatus = {
  productId: string | null;
  productName: string;
  chain: Chain;
  alert: AlertStatus;
};

type BaseParams = { clientId: string; userId: string };
type PeriodParams = BaseParams & { periodYear: number; periodMonth: number };

// =====================================================================
// Default period resolution (S12.1)
// =====================================================================

// Returns the most recent period where ≥2 chains have SelloutData for this
// client. Falls back to the latest period overall if no multi-chain period
// exists. Returns null if the client has no data at all.
//
// Why: real VIKS data has staggered portal coverage — Soriana reports through
// 2026-03 but Chedraui + Amazon only through 2026-01. Without this, the
// dashboard default would open on 2026-03 showing only Soriana (5 buckets vs
// the 21 multi-chain buckets the user expects to see).
export async function getDefaultPeriod(
  db: PrismaClient,
  params: BaseParams,
): Promise<{ periodYear: number; periodMonth: number } | null> {
  const { clientId, userId } = params;

  // Single round-trip: multi-chain preferred, single-chain fallback, sorted by
  // priority then recency. Postgres handles the UNION ALL + ORDER BY in one pass.
  const rows = await db.$queryRaw<Array<{ y: number; m: number; priority: number }>>`
    (
      SELECT "periodYear" AS y, "periodMonth" AS m, 1 AS priority
      FROM "SelloutData"
      WHERE "clientId" = ${clientId} AND "userId" = ${userId}
      GROUP BY "periodYear", "periodMonth"
      HAVING COUNT(DISTINCT chain) >= 2
      ORDER BY "periodYear" DESC, "periodMonth" DESC
      LIMIT 1
    )
    UNION ALL
    (
      SELECT "periodYear" AS y, "periodMonth" AS m, 2 AS priority
      FROM "SelloutData"
      WHERE "clientId" = ${clientId} AND "userId" = ${userId}
      ORDER BY "periodYear" DESC, "periodMonth" DESC
      LIMIT 1
    )
    ORDER BY priority ASC
    LIMIT 1
  `;

  if (rows.length === 0) return null;
  return { periodYear: Number(rows[0].y), periodMonth: Number(rows[0].m) };
}

// =====================================================================
// KPIs (4 cards) — spec §9.1
// =====================================================================

export async function getDashboardKpis(
  db: PrismaClient,
  params: PeriodParams,
): Promise<DashboardKpis> {
  const { clientId, userId, periodYear, periodMonth } = params;
  const prevYear = periodMonth === 1 ? periodYear - 1 : periodYear;
  const prevMonth = periodMonth === 1 ? 12 : periodMonth - 1;

  // Three parallel raw queries. daysOfInv computed at query per AJUSTE 1.
  // KPI4 inlined CASE: alert ∈ {SIN_STOCK, CRITICO, RIESGO} (per spec §9.1).
  // KPI4 evaluates the predicate per row (not per aggregated SKU) and then
  // COUNT(DISTINCT productId) collapses to one count per SKU. That semantic
  // matches "worst-case per SKU": any single store-row in {SIN_STOCK, CRITICO,
  // RIESGO} flags the entire SKU as alerted. H1: `<= 0` (was `= 0`) treats
  // negative inventory adjustments as SIN_STOCK — mirrors classifyAlert(JS).
  const [current, prev, alerts] = await Promise.all([
    db.$queryRaw<Array<{ sales_amount: number | null; sales_units: bigint | null }>>`
      SELECT
        SUM("salesAmountMxn")::float8 AS sales_amount,
        SUM("salesUnits")::bigint    AS sales_units
      FROM "SelloutData"
      WHERE "clientId"   = ${clientId}
        AND "userId"     = ${userId}
        AND "periodYear" = ${periodYear}
        AND "periodMonth"= ${periodMonth}
    `,
    db.$queryRaw<Array<{ sales_amount: number | null }>>`
      SELECT SUM("salesAmountMxn")::float8 AS sales_amount
      FROM "SelloutData"
      WHERE "clientId"   = ${clientId}
        AND "userId"     = ${userId}
        AND "periodYear" = ${prevYear}
        AND "periodMonth"= ${prevMonth}
    `,
    // COUNT(DISTINCT productId) naturally excludes unmapped (productId NULL).
    // daysOfInv computed inline: inv/sales*30, comparing < 14 covers CRITICO ∪ RIESGO.
    db.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(DISTINCT "productId")::bigint AS count
      FROM "SelloutData"
      WHERE "clientId"   = ${clientId}
        AND "userId"     = ${userId}
        AND "periodYear" = ${periodYear}
        AND "periodMonth"= ${periodMonth}
        AND "productId" IS NOT NULL
        AND (
          "inventoryUnits" <= 0
          OR (
            "salesUnits"     IS NOT NULL AND "salesUnits"     > 0
            AND "inventoryUnits" IS NOT NULL
            AND ("inventoryUnits"::float8 / "salesUnits") * 30 < 14
          )
        )
    `,
  ]);

  const salesAmountMxn = Number(current[0]?.sales_amount ?? 0);
  const salesUnits = Number(current[0]?.sales_units ?? 0);
  const prevSales = Number(prev[0]?.sales_amount ?? 0);
  const activeAlertsSkuCount = Number(alerts[0]?.count ?? 0);

  // Division by zero (no prev data OR prev all-zero) → null.
  const variationPct =
    prevSales === 0 ? null : ((salesAmountMxn - prevSales) / prevSales) * 100;

  return { salesAmountMxn, variationPct, salesUnits, activeAlertsSkuCount };
}

// =====================================================================
// Charts (5) — spec §9.1
// =====================================================================

// 1. Tendencia ventas últimos N meses por cadena
//    Anchored to the latest (periodYear, periodMonth) present in data for this client.
export async function getSalesTrend(
  db: PrismaClient,
  params: BaseParams & { monthsBack: number },
): Promise<ChainSalesPoint[]> {
  const { clientId, userId, monthsBack } = params;

  const rows = await db.$queryRaw<
    Array<{
      chain: Chain;
      periodYear: number;
      periodMonth: number;
      sales_amount: number | null;
      sales_units: bigint | null;
    }>
  >`
    WITH latest AS (
      SELECT MAX("periodYear" * 12 + "periodMonth" - 1) AS k
      FROM "SelloutData"
      WHERE "clientId" = ${clientId} AND "userId" = ${userId}
    )
    SELECT
      sd.chain                                 AS chain,
      sd."periodYear"                          AS "periodYear",
      sd."periodMonth"                         AS "periodMonth",
      SUM(sd."salesAmountMxn")::float8         AS sales_amount,
      SUM(sd."salesUnits")::bigint             AS sales_units
    FROM "SelloutData" sd, latest
    WHERE sd."clientId" = ${clientId}
      AND sd."userId"   = ${userId}
      AND latest.k IS NOT NULL
      AND (sd."periodYear" * 12 + sd."periodMonth" - 1) >  latest.k - ${monthsBack}
      AND (sd."periodYear" * 12 + sd."periodMonth" - 1) <= latest.k
    GROUP BY sd.chain, sd."periodYear", sd."periodMonth"
    ORDER BY sd."periodYear" ASC, sd."periodMonth" ASC, sd.chain ASC
  `;

  return rows.map((r) => ({
    chain: r.chain,
    periodYear: Number(r.periodYear),
    periodMonth: Number(r.periodMonth),
    salesAmountMxn: Number(r.sales_amount ?? 0),
    salesUnits: Number(r.sales_units ?? 0),
  }));
}

// 2. Ventas por cadena mes activo
export async function getSalesByChainForPeriod(
  db: PrismaClient,
  params: PeriodParams,
): Promise<Array<{ chain: Chain; salesAmountMxn: number; salesUnits: number }>> {
  const { clientId, userId, periodYear, periodMonth } = params;

  const rows = await db.$queryRaw<
    Array<{
      chain: Chain;
      sales_amount: number | null;
      sales_units: bigint | null;
    }>
  >`
    SELECT
      chain                              AS chain,
      SUM("salesAmountMxn")::float8      AS sales_amount,
      SUM("salesUnits")::bigint          AS sales_units
    FROM "SelloutData"
    WHERE "clientId"   = ${clientId}
      AND "userId"     = ${userId}
      AND "periodYear" = ${periodYear}
      AND "periodMonth"= ${periodMonth}
    GROUP BY chain
    ORDER BY chain ASC
  `;

  return rows.map((r) => ({
    chain: r.chain,
    salesAmountMxn: Number(r.sales_amount ?? 0),
    salesUnits: Number(r.sales_units ?? 0),
  }));
}

// 3. Semáforo inventario por SKU (heatmap producto × cadena con alerta)
//    H1 (worst-case): fetch per-store rows, classify each individually via
//    classifyAlert (SSOT), then reduce to the worst-case alert per (sku, chain).
//    Prior behavior (SUM-then-classify) diluted stockouts: a chain with 13
//    stockout rows + 1 healthy row could appear OK on the semáforo. Spec §9.1
//    requires "Color: estado de alerta agregado (worst-case por SKU)".
export async function getInventorySemaforo(
  db: PrismaClient,
  params: PeriodParams,
): Promise<SkuInventoryStatus[]> {
  const { clientId, userId, periodYear, periodMonth } = params;

  // Per-store rows; ORDER BY drives deterministic output order after reduction.
  const rows = await db.$queryRaw<
    Array<{
      product_id: string | null;
      product_name: string;
      chain: Chain;
      inventory_units: number | null;
      sales_units: bigint | null;
    }>
  >`
    SELECT
      sd."productId"                                              AS product_id,
      COALESCE(p."nameStandard", sd."portalRawProduct")           AS product_name,
      sd.chain                                                    AS chain,
      sd."inventoryUnits"                                         AS inventory_units,
      sd."salesUnits"::bigint                                     AS sales_units
    FROM "SelloutData" sd
    LEFT JOIN "Product" p ON p.id = sd."productId"
    WHERE sd."clientId"   = ${clientId}
      AND sd."userId"     = ${userId}
      AND sd."periodYear" = ${periodYear}
      AND sd."periodMonth"= ${periodMonth}
    ORDER BY product_name ASC, sd.chain ASC
  `;

  // Severity ranking (lowest = worst). Used to fold many stores → one alert.
  const severity: Record<AlertStatus, number> = {
    SIN_STOCK: 1,
    CRITICO: 2,
    RIESGO: 3,
    ATENCION: 4,
    EXCESO: 5,
    OK: 6,
    SIN_DATOS: 7,
  };

  // Group key = `${productId ?? portalRawProduct}|${chain}`. We use
  // product_name as the proxy for portalRawProduct in the unmapped case
  // because SELECT COALESCEs them — same shape as the prior SUM grouping.
  type Bucket = {
    productId: string | null;
    productName: string;
    chain: Chain;
    alert: AlertStatus;
  };
  const buckets = new Map<string, Bucket>();

  for (const r of rows) {
    const inv = r.inventory_units == null ? null : Number(r.inventory_units);
    const sales = r.sales_units == null ? null : Number(r.sales_units);
    const daysOfInv =
      sales !== null && sales > 0 && inv !== null ? (inv / sales) * 30 : null;
    const rowAlert = classifyAlert(inv, daysOfInv);

    const key = `${r.product_id ?? r.product_name}|${r.chain}`;
    const existing = buckets.get(key);
    if (!existing) {
      buckets.set(key, {
        productId: r.product_id,
        productName: r.product_name,
        chain: r.chain,
        alert: rowAlert,
      });
    } else if (severity[rowAlert] < severity[existing.alert]) {
      existing.alert = rowAlert;
    }
  }

  // Preserve the legacy output ordering: productName ASC, chain ASC.
  return Array.from(buckets.values()).sort((a, b) => {
    if (a.productName !== b.productName) return a.productName < b.productName ? -1 : 1;
    return a.chain < b.chain ? -1 : a.chain > b.chain ? 1 : 0;
  });
}

// 4. Top N SKUs por cadena (small multiples)
export async function getTopSkusByChain(
  db: PrismaClient,
  params: PeriodParams & { limit: number },
): Promise<Array<{ chain: Chain; productName: string; salesUnits: number }>> {
  const { clientId, userId, periodYear, periodMonth, limit } = params;

  const rows = await db.$queryRaw<
    Array<{ chain: Chain; product_name: string; sales_units: bigint | null }>
  >`
    WITH agg AS (
      SELECT
        sd.chain                                            AS chain,
        COALESCE(p."nameStandard", sd."portalRawProduct")   AS product_name,
        SUM(sd."salesUnits")::bigint                        AS sales_units
      FROM "SelloutData" sd
      LEFT JOIN "Product" p ON p.id = sd."productId"
      WHERE sd."clientId"   = ${clientId}
        AND sd."userId"     = ${userId}
        AND sd."periodYear" = ${periodYear}
        AND sd."periodMonth"= ${periodMonth}
      GROUP BY sd.chain, sd."productId", p."nameStandard", sd."portalRawProduct"
    ),
    ranked AS (
      SELECT
        chain, product_name, sales_units,
        ROW_NUMBER() OVER (PARTITION BY chain ORDER BY sales_units DESC NULLS LAST) AS rn
      FROM agg
    )
    SELECT chain, product_name, sales_units
    FROM ranked
    WHERE rn <= ${limit}
    ORDER BY chain ASC, sales_units DESC NULLS LAST
  `;

  return rows.map((r) => ({
    chain: r.chain,
    productName: r.product_name,
    salesUnits: Number(r.sales_units ?? 0),
  }));
}

// 5. Días de inventario por SKU (dot plot)
//    H1 (worst-case): the dot plot answers "how soon does this SKU run out?".
//    Aggregating SUM(inv)/SUM(sales) lets a healthy store hide a stockout in
//    a sibling store. We now fetch per-store rows and return the LOWEST
//    daysOfInv per (sku, chain) — the most-at-risk store. Stores with
//    inv<=0 (SIN_STOCK semantics) contribute daysOfInv=0 to highlight "out
//    today". If every row for a SKU has sales=0 and inv>0, daysOfInv=null.
export async function getDaysOfInventoryBySku(
  db: PrismaClient,
  params: PeriodParams,
): Promise<Array<{ productName: string; chain: Chain; daysOfInventory: number | null }>> {
  const { clientId, userId, periodYear, periodMonth } = params;

  const rows = await db.$queryRaw<
    Array<{
      product_id: string | null;
      product_name: string;
      chain: Chain;
      inventory_units: number | null;
      sales_units: bigint | null;
    }>
  >`
    SELECT
      sd."productId"                                    AS product_id,
      COALESCE(p."nameStandard", sd."portalRawProduct") AS product_name,
      sd.chain                                          AS chain,
      sd."inventoryUnits"                               AS inventory_units,
      sd."salesUnits"::bigint                           AS sales_units
    FROM "SelloutData" sd
    LEFT JOIN "Product" p ON p.id = sd."productId"
    WHERE sd."clientId"   = ${clientId}
      AND sd."userId"     = ${userId}
      AND sd."periodYear" = ${periodYear}
      AND sd."periodMonth"= ${periodMonth}
    ORDER BY product_name ASC, sd.chain ASC
  `;

  type Bucket = {
    productName: string;
    chain: Chain;
    daysOfInventory: number | null;
  };
  const buckets = new Map<string, Bucket>();

  for (const r of rows) {
    const inv = r.inventory_units == null ? null : Number(r.inventory_units);
    const sales = r.sales_units == null ? null : Number(r.sales_units);
    // H1: inv<=0 → daysOfInv = 0 (about-to-stockout signal for the dot plot).
    // sales>0 → standard inv/sales*30. Otherwise null (no signal possible).
    let rowDays: number | null;
    if (inv !== null && inv <= 0) {
      rowDays = 0;
    } else if (sales !== null && sales > 0 && inv !== null) {
      rowDays = (inv / sales) * 30;
    } else {
      rowDays = null;
    }

    const key = `${r.product_id ?? r.product_name}|${r.chain}`;
    const existing = buckets.get(key);
    if (!existing) {
      buckets.set(key, {
        productName: r.product_name,
        chain: r.chain,
        daysOfInventory: rowDays,
      });
    } else {
      // Worst-case = lowest non-null daysOfInv. null is treated as "no signal"
      // and replaced by any non-null value; if no row ever supplies a number,
      // it stays null.
      if (existing.daysOfInventory === null && rowDays !== null) {
        existing.daysOfInventory = rowDays;
      } else if (
        rowDays !== null &&
        existing.daysOfInventory !== null &&
        rowDays < existing.daysOfInventory
      ) {
        existing.daysOfInventory = rowDays;
      }
    }
  }

  return Array.from(buckets.values()).sort((a, b) => {
    if (a.productName !== b.productName) return a.productName < b.productName ? -1 : 1;
    return a.chain < b.chain ? -1 : a.chain > b.chain ? 1 : 0;
  });
}
