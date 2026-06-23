import { type Prisma, type Chain, type PrismaClient } from '@prisma/client';

// THE shared SelloutData backfill. Net-new in B4 (Fase 1 §4.4 blueprint; no
// prior implementation existed). Both resolution flows — unmapped (D1) and
// conflict (§8.5) — call THIS, never a divergent UPDATE.
//
// FOOTGUN: SelloutData uses `portalRawProduct`; ProductMapping uses
// `portalString`. The match is on SelloutData.portalRawProduct. A mismatch
// matches 0 rows, passes typecheck, and looks like "resolved but unattributed".
// The §8.6 test (tests/normalizer/resolve.test.ts) is the guard.
//
// `db` is a PrismaClient OR a transaction client — typed as the union so callers
// inside a $transaction pass `tx`.
export async function backfillSelloutProductId(
  db: PrismaClient | Prisma.TransactionClient,
  args: { clientId: string; chain: Chain; portalString: string; productId: string },
): Promise<number> {
  const result = await db.selloutData.updateMany({
    where: {
      clientId: args.clientId,
      chain: args.chain,
      portalRawProduct: args.portalString, // ← footgun: portalString → portalRawProduct
      productId: null,
    },
    data: { productId: args.productId },
  });
  return result.count;
}
