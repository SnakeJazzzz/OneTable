import type { PrismaClient } from '@prisma/client';
import type { NormalizationInput, NormalizationStats } from './types';
import { upsertSelloutRow, upsertUnmapped } from './upsert';

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
    newUnmappedProducts: 0,
    warnings: parserResult.warnings.map(w => `r${w.rowIndex}: ${w.message}`),
  };

  await db.$transaction(async (tx) => {
    for (const row of parserResult.rows) {
      const productId = mappingLookup(parserResult.metadata.chain, row.portalRawProduct);
      const daysInv = row.daysOfInventory ?? null;
      const result = await upsertSelloutRow(tx, {
        clientId,
        userId,
        uploadId,
        chain: parserResult.metadata.chain,
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
        daysOfInventory: daysInv,
      });
      if (result.action === 'inserted') stats.rowsInserted++;
      else stats.rowsUpdated++;

      if (productId === null) {
        stats.rowsUnmapped++;
        const u = await upsertUnmapped(
          tx,
          clientId,
          parserResult.metadata.chain,
          row.portalRawProduct,
          uploadId,
        );
        if (u.isNew) stats.newUnmappedProducts++;
      }
    }
  }, { timeout: 30_000 });

  return stats;
}
