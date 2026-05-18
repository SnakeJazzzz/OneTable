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
          "inventoryUnits" = 0
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
//    Aggregates across stores. classifyAlert applied in JS (single source of truth — S9).
export async function getInventorySemaforo(
  db: PrismaClient,
  params: PeriodParams,
): Promise<SkuInventoryStatus[]> {
  const { clientId, userId, periodYear, periodMonth } = params;

  const rows = await db.$queryRaw<
    Array<{
      product_id: string | null;
      product_name: string;
      chain: Chain;
      inventory_units: bigint | null;
      sales_units: bigint | null;
    }>
  >`
    SELECT
      sd."productId"                                              AS product_id,
      COALESCE(p."nameStandard", sd."portalRawProduct")           AS product_name,
      sd.chain                                                    AS chain,
      SUM(sd."inventoryUnits")::bigint                            AS inventory_units,
      SUM(sd."salesUnits")::bigint                                AS sales_units
    FROM "SelloutData" sd
    LEFT JOIN "Product" p ON p.id = sd."productId"
    WHERE sd."clientId"   = ${clientId}
      AND sd."userId"     = ${userId}
      AND sd."periodYear" = ${periodYear}
      AND sd."periodMonth"= ${periodMonth}
    GROUP BY sd."productId", p."nameStandard", sd."portalRawProduct", sd.chain
    ORDER BY product_name ASC, sd.chain ASC
  `;

  return rows.map((r) => {
    const inv = r.inventory_units == null ? null : Number(r.inventory_units);
    const sales = r.sales_units == null ? null : Number(r.sales_units);
    const daysOfInv = sales !== null && sales > 0 && inv !== null ? (inv / sales) * 30 : null;
    return {
      productId: r.product_id,
      productName: r.product_name,
      chain: r.chain,
      alert: classifyAlert(inv, daysOfInv),
    };
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
//    daysOfInv computed at query (AJUSTE 1), aggregated across stores.
export async function getDaysOfInventoryBySku(
  db: PrismaClient,
  params: PeriodParams,
): Promise<Array<{ productName: string; chain: Chain; daysOfInventory: number | null }>> {
  const { clientId, userId, periodYear, periodMonth } = params;

  const rows = await db.$queryRaw<
    Array<{
      product_name: string;
      chain: Chain;
      days_of_inventory: number | null;
    }>
  >`
    SELECT
      COALESCE(p."nameStandard", sd."portalRawProduct") AS product_name,
      sd.chain                                          AS chain,
      CASE
        WHEN SUM(sd."salesUnits") > 0
        THEN (SUM(sd."inventoryUnits")::float8 / SUM(sd."salesUnits")) * 30
        ELSE NULL
      END                                               AS days_of_inventory
    FROM "SelloutData" sd
    LEFT JOIN "Product" p ON p.id = sd."productId"
    WHERE sd."clientId"   = ${clientId}
      AND sd."userId"     = ${userId}
      AND sd."periodYear" = ${periodYear}
      AND sd."periodMonth"= ${periodMonth}
    GROUP BY sd."productId", p."nameStandard", sd."portalRawProduct", sd.chain
    ORDER BY product_name ASC, sd.chain ASC
  `;

  return rows.map((r) => ({
    productName: r.product_name,
    chain: r.chain,
    daysOfInventory: r.days_of_inventory == null ? null : Number(r.days_of_inventory),
  }));
}
