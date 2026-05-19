import { Prisma, type Chain } from '@prisma/client';
import { randomUUID } from 'node:crypto';

/**
 * Row shape consumed by batched SelloutData UPSERT.
 *
 * NOTE: Pre-H2 this module exposed a row-by-row helper (`upsertSelloutRow`).
 * That helper has been removed in favor of `batchUpsertSelloutRows` below —
 * the single-row UPSERT inside `$transaction` was the root cause of P2028
 * timeouts on real fixtures (Soriana 2,636 rows × ~165ms = 7+ minutes).
 */
export type SelloutRowInput = {
  clientId: string;
  userId: string;
  uploadId: string;
  chain: Chain;
  productId: string | null;
  periodYear: number;
  periodMonth: number;
  periodDate: Date | null;
  portalRawProduct: string;
  storeId: string | null;
  storeName: string | null;
  storeFormat: string | null;
  salesUnits?: number;
  salesUnitsEstimated?: boolean;
  salesAmountMxn?: number;
  purchasesUnits?: number;
  purchasesAmountMxn?: number;
  inventoryUnits?: number;
  inventoryAmountCostMxn?: number;
  inventoryAmountPriceMxn?: number;
  daysOfInventory: number | null;
};

/**
 * Generate a cuid-shaped id matching the original row-by-row helper.
 * Kept inline (vs `@paralleldrive/cuid2` or similar) to avoid a new dep —
 * supply chain mitigation #6.
 */
function makeCuid(): string {
  return `c${randomUUID().replace(/-/g, '').slice(0, 24)}`;
}

/**
 * Batched UPSERT for SelloutData.
 *
 * One SQL statement covers up to BATCH_SIZE rows. Postgres parameter cap is
 * 65,535 per query; SelloutData has 22 insertable columns (id + 21 fields),
 * so BATCH_SIZE=500 → 11,000 params (safe). BATCH_SIZE can be raised to
 * ~2,500 before hitting the cap.
 *
 * Returns the inserted/updated split via `(xmax = 0)` — true for inserts
 * (no prior row), false for updates (existing row collided on the unique
 * index). See https://www.postgresql.org/docs/current/ddl-system-columns.html
 *
 * COALESCE semantics on the UPDATE side match the pre-H2 row-by-row helper
 * verbatim (spec §2.3 + AJUSTE 5).
 */
export async function batchUpsertSelloutRows(
  tx: Prisma.TransactionClient,
  rows: SelloutRowInput[],
): Promise<{ inserted: number; updated: number }> {
  if (rows.length === 0) return { inserted: 0, updated: 0 };

  const valueTuples = rows.map((r) => {
    const id = makeCuid();
    return Prisma.sql`(
      ${id},
      ${r.clientId},
      ${r.userId},
      ${r.uploadId},
      ${r.periodYear},
      ${r.periodMonth},
      ${r.periodDate},
      ${r.chain}::"Chain",
      ${r.productId},
      ${r.portalRawProduct},
      ${r.storeId},
      ${r.storeName},
      ${r.storeFormat},
      ${r.salesUnits ?? null},
      ${r.salesUnitsEstimated ?? false},
      ${r.salesAmountMxn ?? null},
      ${r.purchasesUnits ?? null},
      ${r.purchasesAmountMxn ?? null},
      ${r.inventoryUnits ?? null},
      ${r.inventoryAmountCostMxn ?? null},
      ${r.inventoryAmountPriceMxn ?? null},
      ${r.daysOfInventory},
      NOW(),
      NOW()
    )`;
  });

  const result = await tx.$queryRaw<Array<{ inserted_flag: boolean }>>`
    INSERT INTO "SelloutData" (
      id, "clientId", "userId", "uploadId",
      "periodYear", "periodMonth", "periodDate",
      chain, "productId", "portalRawProduct",
      "storeId", "storeName", "storeFormat",
      "salesUnits", "salesUnitsEstimated", "salesAmountMxn",
      "purchasesUnits", "purchasesAmountMxn",
      "inventoryUnits", "inventoryAmountCostMxn", "inventoryAmountPriceMxn",
      "daysOfInventory", "createdAt", "updatedAt"
    )
    VALUES ${Prisma.join(valueTuples)}
    ON CONFLICT ("clientId", chain, "storeId", "portalRawProduct", "periodYear", "periodMonth") DO UPDATE SET
      "uploadId"               = EXCLUDED."uploadId",
      "productId"              = COALESCE(EXCLUDED."productId", "SelloutData"."productId"),
      "storeName"              = COALESCE(EXCLUDED."storeName", "SelloutData"."storeName"),
      "storeFormat"            = COALESCE(EXCLUDED."storeFormat", "SelloutData"."storeFormat"),
      "salesUnits"             = COALESCE(EXCLUDED."salesUnits", "SelloutData"."salesUnits"),
      "salesUnitsEstimated"    = EXCLUDED."salesUnitsEstimated" OR "SelloutData"."salesUnitsEstimated",
      "salesAmountMxn"         = COALESCE(EXCLUDED."salesAmountMxn", "SelloutData"."salesAmountMxn"),
      "purchasesUnits"         = COALESCE(EXCLUDED."purchasesUnits", "SelloutData"."purchasesUnits"),
      "purchasesAmountMxn"     = COALESCE(EXCLUDED."purchasesAmountMxn", "SelloutData"."purchasesAmountMxn"),
      "inventoryUnits"         = COALESCE(EXCLUDED."inventoryUnits", "SelloutData"."inventoryUnits"),
      "inventoryAmountCostMxn" = COALESCE(EXCLUDED."inventoryAmountCostMxn", "SelloutData"."inventoryAmountCostMxn"),
      "inventoryAmountPriceMxn"= COALESCE(EXCLUDED."inventoryAmountPriceMxn", "SelloutData"."inventoryAmountPriceMxn"),
      "daysOfInventory"        = COALESCE(EXCLUDED."daysOfInventory", "SelloutData"."daysOfInventory"),
      "periodDate"             = COALESCE(EXCLUDED."periodDate", "SelloutData"."periodDate"),
      "updatedAt"              = NOW()
    RETURNING (xmax = 0) AS inserted_flag;
  `;

  let inserted = 0;
  let updated = 0;
  for (const r of result) {
    if (r.inserted_flag) inserted++;
    else updated++;
  }
  return { inserted, updated };
}

export type UnmappedAggregate = {
  chain: Chain;
  portalString: string;
  firstSeenUploadId: string;
  occurrenceCount: number;
};

/**
 * Batched UPSERT for UnmappedProduct.
 *
 * Accumulates `occurrenceCount` correctly across re-uploads:
 *   ON CONFLICT … SET "occurrenceCount" = existing + EXCLUDED
 *
 * `firstSeenUploadId` is kept stable across re-uploads (no overwrite).
 *
 * Returns the count of newly-inserted rows via `(xmax = 0)`.
 *
 * The caller is responsible for deduplicating (chain, portalString) within
 * the batch and summing occurrenceCount per-pair before calling — otherwise
 * the same (clientId, chain, portalString) key would appear twice in the
 * INSERT and Postgres rejects that as "ON CONFLICT DO UPDATE command
 * cannot affect row a second time".
 */
export async function batchUpsertUnmapped(
  tx: Prisma.TransactionClient,
  clientId: string,
  aggregates: UnmappedAggregate[],
): Promise<{ newCount: number }> {
  if (aggregates.length === 0) return { newCount: 0 };

  const valueTuples = aggregates.map((a) => {
    const id = makeCuid();
    return Prisma.sql`(
      ${id},
      ${clientId},
      ${a.chain}::"Chain",
      ${a.portalString},
      ${a.firstSeenUploadId},
      ${a.occurrenceCount},
      NOW(),
      NOW()
    )`;
  });

  const result = await tx.$queryRaw<Array<{ inserted_flag: boolean }>>`
    INSERT INTO "UnmappedProduct" (
      id, "clientId", chain, "portalString",
      "firstSeenUploadId", "occurrenceCount",
      "createdAt", "updatedAt"
    )
    VALUES ${Prisma.join(valueTuples)}
    ON CONFLICT ("clientId", chain, "portalString") DO UPDATE SET
      "occurrenceCount" = "UnmappedProduct"."occurrenceCount" + EXCLUDED."occurrenceCount",
      "updatedAt"       = NOW()
    RETURNING (xmax = 0) AS inserted_flag;
  `;

  let newCount = 0;
  for (const r of result) {
    if (r.inserted_flag) newCount++;
  }
  return { newCount };
}
