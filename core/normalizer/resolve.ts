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

// THE shared SelloutData revert — exact inverse mirror of backfillSelloutProductId.
// Extracted verbatim from deleteMapping's step 2 (§11.5a) so retargetMapping (§11.6a)
// shares the exact same revert. Sets productId back to NULL and returns the count
// (the count IS deleteMapping's presence-of-data signal — no extra query).
//
// FOOTGUN (mirror of backfillSelloutProductId): the revert MUST filter
// SelloutData by `portalRawProduct: portalString` — without it, a multi-value SKU
// (P→X and P2→X) would lose P2's rows too. `productId` is the extra belt.
//
// `db` is a PrismaClient OR a transaction client — typed as the union so callers
// inside a $transaction pass `tx`.
export async function revertSelloutProductId(
  db: PrismaClient | Prisma.TransactionClient,
  args: { clientId: string; chain: Chain; portalString: string; productId: string },
): Promise<number> {
  const result = await db.selloutData.updateMany({
    where: {
      clientId: args.clientId,
      chain: args.chain,
      portalRawProduct: args.portalString, // ← footgun: scope to THIS string only
      productId: args.productId,
    },
    data: { productId: null },
  });
  return result.count;
}

// Re-queue a portalString into the UnmappedProduct queue (resolvedAt/resolvedProductId
// cleared on update). Extracted verbatim from resolveConflict's "Ninguno" branch so
// deleteMapping (§11.5a revert) shares the exact same guard + upsert behavior. The
// firstSeenUploadId is RECEIVED as an arg — the upload derivation is route-policy
// (mirrors conflicts/route.ts), never done here in core.
//
// `tx` is typed as the PrismaClient | TransactionClient union (same as
// backfillSelloutProductId) so callers inside a $transaction pass `tx`.
export async function requeueUnmappedProduct(
  tx: PrismaClient | Prisma.TransactionClient,
  args: { clientId: string; chain: Chain; portalString: string; firstSeenUploadId?: string },
): Promise<void> {
  if (!args.firstSeenUploadId) {
    throw new Error('requeueUnmappedProduct requires firstSeenUploadId to re-anchor the portal string');
  }
  await tx.unmappedProduct.upsert({
    where: { clientId_chain_portalString: { clientId: args.clientId, chain: args.chain, portalString: args.portalString } },
    create: { clientId: args.clientId, chain: args.chain, portalString: args.portalString, firstSeenUploadId: args.firstSeenUploadId },
    update: { resolvedAt: null, resolvedProductId: null },
  });
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
      // Guard + upsert extracted to requeueUnmappedProduct (behavior unchanged):
      // throws the same error when firstSeenUploadId is absent.
      await requeueUnmappedProduct(tx, {
        clientId: args.clientId, chain: args.chain, portalString: args.portalString, firstSeenUploadId: args.firstSeenUploadId,
      });
    }
  });
}

// §11.5a — delete a CONFIRMED/PENDING_REVIEW mapping (the inverse of assignMapping).
// One atomic transaction: revert the backfill (inverse of backfillSelloutProductId),
// delete the mapping row, re-queue the portalString ONLY if the revert touched real
// SelloutData rows (§11.5a-fix, presence-of-data rule): a string added by hand
// (+Agregar otro string) that never came in a file has no rows — nothing orphaned
// to re-attribute — so requeueing it would create a false "sin mapear" task.
// firstSeenUploadId is RECEIVED as an arg — the route derives the most recent
// upload and passes it (mirrors conflicts/route.ts); core never derives the upload.
//
// CONFLICTED mappings are NOT deletable here — those are resolved via the conflict
// UI (resolveConflict). A non-existent mapping throws (route → 404).
//
// FOOTGUN (mirror of backfillSelloutProductId): the revert MUST filter
// SelloutData by `portalRawProduct: portalString` — without it, a multi-value SKU
// (P→X and P2→X) would lose P2's rows too. `productId` is the extra belt.
export async function deleteMapping(
  db: PrismaClient,
  args: {
    clientId: string;
    chain: Chain;
    portalString: string;
    productId: string;
    firstSeenUploadId?: string;
  },
): Promise<void> {
  await db.$transaction(async (tx) => {
    // 1. Verify the mapping exists, belongs to the client, and is NOT CONFLICTED.
    const existing = await tx.productMapping.findFirst({
      where: { clientId: args.clientId, chain: args.chain, portalString: args.portalString, productId: args.productId },
    });
    if (!existing) {
      throw new Error('deleteMapping: mapping not found');
    }
    if (existing.status === 'CONFLICTED') {
      throw new Error('deleteMapping: cannot delete a CONFLICTED mapping; resolve it via the conflict UI');
    }

    // 2. REVERT the backfill — inverse of backfillSelloutProductId, via the
    //    shared primitive (portalRawProduct filter = multi-value footgun guard).
    //    The count of reverted rows IS the presence-of-data signal for step 4
    //    (no extra query needed).
    //
    //    SERVICE-DESIGN NOTE: the presence signal is productId-SCOPED — rows of
    //    this portalString whose productId is NULL don't count, so a string with
    //    only-NULL rows yields count 0 → no requeue. Unreachable in current
    //    flows (assignMapping backfills on create; normalize attributes
    //    CONFIRMED mappings at insert), it becomes real only if a future flow
    //    creates mappings without backfilling.
    const reverted = await revertSelloutProductId(tx, {
      clientId: args.clientId, chain: args.chain, portalString: args.portalString, productId: args.productId,
    });

    // 3. DELETE the mapping row (scoped to the exact row we verified).
    await tx.productMapping.delete({ where: { id: existing.id } });

    // 4. Re-queue the string ONLY when real rows were reverted (§11.5a-fix).
    //    count === 0 → manually added string with no data: delete ends here, no
    //    false "sin mapear" task. count > 0 → same behavior as before; if
    //    firstSeenUploadId is absent the shared guard throws, which aborts the
    //    whole $transaction — steps 2 & 3 roll back, so we never leave
    //    SelloutData nulled + mapping deleted without re-queueing. The
    //    conditional lives HERE (the caller), NOT inside requeueUnmappedProduct —
    //    the primitive is shared with resolveConflict's "Ninguno" branch, whose
    //    behavior must not change.
    if (reverted > 0) {
      await requeueUnmappedProduct(tx, {
        clientId: args.clientId, chain: args.chain, portalString: args.portalString, firstSeenUploadId: args.firstSeenUploadId,
      });
    }
  });
}

// §11.6a — re-target an active (CONFIRMED/PENDING_REVIEW) mapping to a different
// SKU, IN-PLACE. One atomic transaction: revert → update → backfill. This is an
// UPDATE of the existing mapping row (id/createdAt preserved), NOT delete+create,
// NOT an orchestration of deleteMapping+assignMapping — the string never stops
// being mapped, so it never passes through the conflict flow or the unmapped queue.
//
// Guards (all BEFORE any mutation):
//  - mapping not found → throw (route → 404).
//  - CONFLICTED → throw (conflicts are resolved via resolveConflict, never here).
//  - newProductId === oldProductId → throw (no-op retarget prohibited; zero writes).
//  - newProductId must exist AND belong to clientId (tenancy check lives HERE in
//    the service, not delegated to the route).
//
// ORDER revert→update→backfill is NON-NEGOTIABLE: the backfill matches
// productId IS NULL — run before the revert it would match 0 rows and the later
// revert would leave everything NULL ("retargeted but de-attributed"). Both
// primitives filter by portalRawProduct — the multi-value footgun guard.
//
// DESIGN NOTE: the backfill (step 5) also sweeps PRE-EXISTING NULL rows of the
// same portalString (e.g. leftovers from an old conflict window). Deliberate:
// the string now maps to newProductId, those rows belong to it. UnmappedProduct
// is NOT touched in any step — the string never stops being mapped — hence no
// firstSeenUploadId in the signature: no requeue is possible here.
export async function retargetMapping(
  db: PrismaClient,
  args: {
    clientId: string;
    chain: Chain;
    portalString: string;
    oldProductId: string;
    newProductId: string;
  },
): Promise<void> {
  await db.$transaction(async (tx) => {
    // 1. The mapping must exist for this exact (clientId, chain, portalString, oldProductId) tuple.
    const existing = await tx.productMapping.findFirst({
      where: { clientId: args.clientId, chain: args.chain, portalString: args.portalString, productId: args.oldProductId },
    });
    if (!existing) {
      throw new Error('retargetMapping: mapping not found');
    }

    // 2. Guards, before any mutation.
    if (existing.status === 'CONFLICTED') {
      throw new Error('retargetMapping: cannot retarget a CONFLICTED mapping; resolve it via the conflict UI');
    }
    //    PLACEMENT: the no-op guard runs after the mapping findFirst (one DB
    //    check) and BEFORE the target check — deliberate error precedence:
    //    a missing mapping answers not-found (route → 404) first.
    if (args.newProductId === args.oldProductId) {
      throw new Error('retargetMapping: newProductId equals oldProductId (no-op retarget is not allowed)');
    }
    //    Fetching the full Product row (no `select`) is accepted here;
    //    `select: { id: true }` would suffice, but no logic changes in this
    //    sweep (B5-3, comment-only).
    const target = await tx.product.findFirst({
      where: { id: args.newProductId, clientId: args.clientId },
    });
    if (!target) {
      throw new Error('retargetMapping: newProductId does not exist or does not belong to this client');
    }

    // 3. REVERT the old attribution (scoped to THIS string — footgun guard).
    await revertSelloutProductId(tx, {
      clientId: args.clientId, chain: args.chain, portalString: args.portalString, productId: args.oldProductId,
    });

    // 4. UPDATE the mapping row in-place (same id, same createdAt). CONFIRMED
    //    always — a re-target is a deliberate confirmation, even from PENDING_REVIEW.
    await tx.productMapping.update({
      where: { id: existing.id },
      data: { productId: args.newProductId, status: 'CONFIRMED' },
    });

    // 5. BACKFILL to the new SKU (matches productId IS NULL — see design note).
    await backfillSelloutProductId(tx, {
      clientId: args.clientId, chain: args.chain, portalString: args.portalString, productId: args.newProductId,
    });
  });
}
