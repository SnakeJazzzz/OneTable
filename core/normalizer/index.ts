import type { PrismaClient } from '@prisma/client';
import type { NormalizationInput, NormalizationStats } from './types';
import {
  batchUpsertSelloutRows,
  batchUpsertUnmapped,
  type SelloutRowInput,
  type UnmappedAggregate,
} from './upsert';

/**
 * Batch size for multi-row INSERT…ON CONFLICT.
 *
 * Chosen as 500. Postgres caps bind parameters at 65,535 per query;
 * SelloutData has 22 insertable columns → 500 × 22 = 11,000 params, safely
 * below the cap (room to grow to ~2,500 before hitting it). 500 also keeps
 * each batch's SQL payload under a few hundred KB, which avoids tickling
 * Neon's edge-protocol size limits. Empirically (see H2 handoff), at 500
 * Soriana-real (2,636 rows) completes its 6 batches in ~3-5s total, well
 * inside the 120s transaction budget.
 *
 * If you need to raise it: re-verify against (a) the 65,535 param ceiling
 * and (b) Neon's `pgbouncer` statement size limit if that becomes the
 * bottleneck rather than per-row latency.
 */
const BATCH_SIZE = 500;

/**
 * Normalize a parsed portal file into SelloutData + UnmappedProduct.
 *
 * Strategy (H2 — batched):
 *   1. Iterate parser rows once. For each:
 *      - Map → SelloutRowInput, push to `sellouts` queue.
 *      - If unmapped, aggregate (chain, portalString) → occurrence count.
 *   2. Chunk `sellouts` into BATCH_SIZE windows; each window is ONE
 *      batched `INSERT … ON CONFLICT DO UPDATE` statement.
 *   3. After all sellout batches, emit ONE batched UPSERT for
 *      UnmappedProduct with summed occurrence counts.
 *   4. Wrap all of the above in a single `$transaction({ timeout: 120_000 })`.
 *      Atomicity rationale: a partial upload would mid-corrupt KPI queries
 *      during the upload window (UI showing inconsistent state). Better to
 *      either fully apply or fully roll back. 120s is generous — empirically
 *      preflight (~3,200 rows) finishes in <15s, leaving ~8× headroom for
 *      Neon latency spikes.
 *
 * Mapping resolution: `mappingLookup` is a JS closure provided by the caller
 * (built via `buildMappingLookup(mappings)` in core/normalizer/lookup.ts — see
 * the upload route and scripts/preflight.ts). Returns the §8.3 union, so
 * CONFLICTED state reads as `conflict` (productId NULL) instead of last-wins.
 * Pre-resolved in JS — ZERO DB round-trips per row for mapping. Verified by
 * `tests/normalizer/batch.test.ts > resolves mappings without per-row DB hits`.
 */
export async function normalize(
  input: NormalizationInput,
  db: PrismaClient,
): Promise<NormalizationStats> {
  const { clientId, userId, uploadId, parserResult, mappingLookup } = input;
  const stats: NormalizationStats = {
    rowsTotal: parserResult.rows.length,
    rowsInserted: 0,
    rowsUpdated: 0,
    rowsUnmapped: 0,
    rowsConflicted: 0,
    newUnmappedProducts: 0,
    warnings: parserResult.warnings.map(w => `r${w.rowIndex}: ${w.message}`),
  };

  // ── Phase 1 — build per-row inputs in JS (no DB) ─────────────────────────
  const sellouts: SelloutRowInput[] = [];
  // Key: `${chain}|${portalString}` — dedupes within a single normalize() call.
  const unmappedAgg = new Map<string, UnmappedAggregate>();

  for (const row of parserResult.rows) {
    const chain = parserResult.metadata.chain;
    const result = mappingLookup(chain, row.portalRawProduct);
    // mapped → attribute; unmapped/conflict → productId NULL (excluded from
    // SKU-level KPIs, §8.4). Only genuine unmapped goes to the queue; conflict
    // lives in ProductMapping(status=CONFLICTED), not UnmappedProduct (§8.3).
    const productId = result.kind === 'mapped' ? result.productId : null;
    sellouts.push({
      clientId,
      userId,
      uploadId,
      chain,
      productId,
      periodYear: row.periodYear,
      periodMonth: row.periodMonth,
      periodDate: row.periodDate ?? null,
      portalRawProduct: row.portalRawProduct,
      storeId: row.storeId,
      storeName: row.storeName,
      storeFormat: row.storeFormat,
      salesUnits: row.salesUnits,
      salesUnitsEstimated: row.salesUnitsEstimated,
      salesAmountMxn: row.salesAmountMxn,
      purchasesUnits: row.purchasesUnits,
      purchasesAmountMxn: row.purchasesAmountMxn,
      inventoryUnits: row.inventoryUnits,
      inventoryAmountCostMxn: row.inventoryAmountCostMxn,
      inventoryAmountPriceMxn: row.inventoryAmountPriceMxn,
      daysOfInventory: row.daysOfInventory ?? null,
    });

    if (result.kind === 'unmapped') {
      stats.rowsUnmapped++;
      const key = `${chain}|${row.portalRawProduct}`;
      const existing = unmappedAgg.get(key);
      if (existing) {
        existing.occurrenceCount++;
      } else {
        unmappedAgg.set(key, {
          chain,
          portalString: row.portalRawProduct,
          firstSeenUploadId: uploadId,
          occurrenceCount: 1,
        });
      }
    } else if (result.kind === 'conflict') {
      stats.rowsConflicted++;
    }
  }

  // ── Phase 2 — execute all batches inside one transaction ────────────────
  const totalBatches = Math.ceil(sellouts.length / BATCH_SIZE);
  await db.$transaction(
    async (tx) => {
      for (let i = 0; i < sellouts.length; i += BATCH_SIZE) {
        const batch = sellouts.slice(i, i + BATCH_SIZE);
        const batchNum = Math.floor(i / BATCH_SIZE) + 1;
        // eslint-disable-next-line no-console -- structured progress log; helps debug mid-stream batch failures
        console.log(
          `[normalize] Processing batch ${batchNum}/${totalBatches} (${batch.length} rows)…`,
        );
        const { inserted, updated } = await batchUpsertSelloutRows(tx, batch);
        stats.rowsInserted += inserted;
        stats.rowsUpdated += updated;
      }

      // One batched UPSERT for all unmapped pairs collected during phase 1.
      if (unmappedAgg.size > 0) {
        // eslint-disable-next-line no-console
        console.log(
          `[normalize] Upserting ${unmappedAgg.size} unmapped (chain, portalString) pairs…`,
        );
        const { newCount } = await batchUpsertUnmapped(tx, clientId, [...unmappedAgg.values()]);
        stats.newUnmappedProducts = newCount;
      }
    },
    { timeout: 120_000 },
  );

  return stats;
}
