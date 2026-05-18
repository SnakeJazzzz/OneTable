import type { Prisma, Chain } from '@prisma/client';
import { randomUUID } from 'node:crypto';

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

export async function upsertSelloutRow(
  tx: Prisma.TransactionClient,
  row: SelloutRowInput,
): Promise<{ action: 'inserted' | 'updated' }> {
  const id = `c${randomUUID().replace(/-/g, '').slice(0, 24)}`;
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
    ) VALUES (
      ${id}, ${row.clientId}, ${row.userId}, ${row.uploadId},
      ${row.periodYear}, ${row.periodMonth}, ${row.periodDate},
      ${row.chain}::"Chain", ${row.productId}, ${row.portalRawProduct},
      ${row.storeId}, ${row.storeName}, ${row.storeFormat},
      ${row.salesUnits ?? null}, ${row.salesUnitsEstimated ?? false}, ${row.salesAmountMxn ?? null},
      ${row.purchasesUnits ?? null}, ${row.purchasesAmountMxn ?? null},
      ${row.inventoryUnits ?? null}, ${row.inventoryAmountCostMxn ?? null}, ${row.inventoryAmountPriceMxn ?? null},
      ${row.daysOfInventory}, NOW(), NOW()
    )
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
  return { action: result[0].inserted_flag ? 'inserted' : 'updated' };
}

export async function upsertUnmapped(
  tx: Prisma.TransactionClient,
  clientId: string,
  chain: Chain,
  portalString: string,
  uploadId: string,
): Promise<{ isNew: boolean }> {
  const existing = await tx.unmappedProduct.findUnique({
    where: { clientId_chain_portalString: { clientId, chain, portalString } },
  });
  if (existing) {
    await tx.unmappedProduct.update({
      where: { id: existing.id },
      data: { occurrenceCount: existing.occurrenceCount + 1 },
    });
    return { isNew: false };
  }
  await tx.unmappedProduct.create({
    data: { clientId, chain, portalString, firstSeenUploadId: uploadId, occurrenceCount: 1 },
  });
  return { isNew: true };
}
