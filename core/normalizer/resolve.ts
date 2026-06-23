import { type Prisma, type Chain, type PrismaClient, type MappingStatus } from '@prisma/client';

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

type AssignResult = { kind: 'mapped' } | { kind: 'conflict' } | { kind: 'conflict_exists' };

// D1 main flow + D3 conflict detection. Runs in a transaction.
//  - key already has CONFLICTED rows (FIX-1) → refuse: return 'conflict_exists',
//    create nothing, backfill nothing. Mapping onto an unresolved conflict would
//    spawn an orphan CONFIRMED row the lookup ignores (it still reads 'conflict')
//    and attribute sellout the next normalize resets to NULL — a contradictory
//    state. The user must resolve the conflict first (§8.5 UI).
//  - portalString not yet mapped (to a different SKU) → create CONFIRMED/
//    PENDING_REVIEW + backfill + mark any UnmappedProduct resolved → 'mapped'.
//  - portalString already mapped to a DIFFERENT SKU (non-conflicted) → D3
//    conflict: UPDATE existing → CONFLICTED *first*, THEN INSERT new →
//    CONFLICTED (reverse order trips the partial unique index, P2002). No
//    backfill — conflicted rows stay productId NULL (§8.3/§8.4) → 'conflict'.
export async function assignMapping(
  db: PrismaClient,
  args: {
    clientId: string;
    chain: Chain;
    portalString: string;
    productId: string;
    status: Extract<MappingStatus, 'CONFIRMED' | 'PENDING_REVIEW'>;
  },
): Promise<AssignResult> {
  return db.$transaction(async (tx) => {
    // FIX-1 guard: if the key is already in conflict, refuse before touching anything.
    // The count→findFirst→create sequence has a theoretical TOCTOU race under
    // concurrent assigns to the same key; the partial unique index
    // ProductMapping_active_unique (WHERE status <> 'CONFLICTED') is the backstop —
    // a racing second create gets P2002 rather than a duplicate active mapping.
    const conflicted = await tx.productMapping.count({
      where: {
        clientId: args.clientId,
        chain: args.chain,
        portalString: args.portalString,
        status: 'CONFLICTED',
      },
    });
    if (conflicted > 0) return { kind: 'conflict_exists' };

    const existing = await tx.productMapping.findFirst({
      where: {
        clientId: args.clientId,
        chain: args.chain,
        portalString: args.portalString,
        status: { not: 'CONFLICTED' },
      },
    });

    if (existing && existing.productId !== args.productId) {
      // D3 — order is mandatory: update-then-insert.
      await tx.productMapping.update({ where: { id: existing.id }, data: { status: 'CONFLICTED' } });
      await tx.productMapping.create({
        data: {
          clientId: args.clientId, chain: args.chain, portalString: args.portalString,
          productId: args.productId, status: 'CONFLICTED',
        },
      });
      return { kind: 'conflict' };
    }

    if (existing && existing.productId === args.productId) {
      // Idempotent: same string → same SKU. Ensure desired status, then backfill.
      await tx.productMapping.update({ where: { id: existing.id }, data: { status: args.status } });
    } else {
      await tx.productMapping.create({
        data: {
          clientId: args.clientId, chain: args.chain, portalString: args.portalString,
          productId: args.productId, status: args.status,
        },
      });
    }

    await backfillSelloutProductId(tx, {
      clientId: args.clientId, chain: args.chain, portalString: args.portalString, productId: args.productId,
    });
    await tx.unmappedProduct.updateMany({
      where: { clientId: args.clientId, chain: args.chain, portalString: args.portalString, resolvedAt: null },
      data: { resolvedAt: new Date(), resolvedProductId: args.productId },
    });
    return { kind: 'mapped' };
  });
}

// §8.5 conflict resolution. Both branches are atomic.
//  - winnerProductId set ("Es éste"): the winner MUST be one of the conflict's
//    candidates (trust boundary — abort otherwise, before any mutation). DELETE
//    the losing candidate mappings, UPDATE the winner → CONFIRMED, backfill
//    SelloutData. The winner update is scoped to the candidate row we read, not a
//    free productId filter, so it operates on exactly the set we inspected.
//  - winnerProductId null ("Ninguno"): DELETE all candidate mappings; the
//    string falls back to the UnmappedProduct queue (needs firstSeenUploadId).
export async function resolveConflict(
  db: PrismaClient,
  args: {
    clientId: string;
    chain: Chain;
    portalString: string;
    winnerProductId: string | null;
    firstSeenUploadId?: string;
  },
): Promise<void> {
  await db.$transaction(async (tx) => {
    const candidates = await tx.productMapping.findMany({
      where: { clientId: args.clientId, chain: args.chain, portalString: args.portalString, status: 'CONFLICTED' },
    });

    if (args.winnerProductId) {
      // Trust boundary: the winner must be one of the CONFLICTED candidates we
      // just read. Otherwise we'd delete every candidate (all become "losers")
      // and backfill sellout to a SKU with no surviving mapping row — a corrupt
      // state. Abort before any mutation (rolls back the transaction).
      const winnerIds = candidates.filter((c) => c.productId === args.winnerProductId).map((c) => c.id);
      if (winnerIds.length === 0) {
        throw new Error('resolveConflict "Es éste": winnerProductId no es un candidato del conflicto');
      }
      const losers = candidates.filter((c) => c.productId !== args.winnerProductId).map((c) => c.id);
      if (losers.length > 0) await tx.productMapping.deleteMany({ where: { id: { in: losers } } });
      // Scope the promotion to the candidate row we read (not a free productId filter).
      await tx.productMapping.updateMany({
        where: { id: { in: winnerIds } },
        data: { status: 'CONFIRMED' },
      });
      await backfillSelloutProductId(tx, {
        clientId: args.clientId, chain: args.chain, portalString: args.portalString, productId: args.winnerProductId,
      });
    } else {
      await tx.productMapping.deleteMany({
        where: { clientId: args.clientId, chain: args.chain, portalString: args.portalString, status: 'CONFLICTED' },
      });
      if (!args.firstSeenUploadId) {
        throw new Error('resolveConflict "Ninguno" requires firstSeenUploadId to re-queue the unmapped string');
      }
      await tx.unmappedProduct.upsert({
        where: { clientId_chain_portalString: { clientId: args.clientId, chain: args.chain, portalString: args.portalString } },
        create: { clientId: args.clientId, chain: args.chain, portalString: args.portalString, firstSeenUploadId: args.firstSeenUploadId },
        update: { resolvedAt: null, resolvedProductId: null },
      });
    }
  });
}
