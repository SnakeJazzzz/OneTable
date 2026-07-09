# B4 (Portales) — Phase 5 handoff: Task 12 (smoke gate) + Task 13 (PR)

> Written at the close of the 11.5/11.6 session (2026-07-08), before /clear. Read this
> in a FRESH session alongside `CLAUDE.md`, `docs/specs/onetable-fase2-spec.md` (§3.2,
> §5, §6, §8) and `docs/superpowers/plans/2026-06-22-b4-portales.md` (Task 12 checklist
> — replaced this session — and Task 13). Every state claim below was verified
> empirically (grep/read/git log) at write time — but re-verify any path/symbol before
> building on it (backlog-hygiene rule).

---

## 1. Git state

- **Branch:** `feat/b4-portales`. **Base:** B3 HEAD `83ac5ea`.
- **18 B4 commits over the base.** Phases 1-3 (Tasks 1-8, `350fe31`..`9865995`) are
  tabled in `docs/superpowers/sdd/b4-phase4-handoff.md` §1. Post-Phase-4 chain
  (`git log --oneline 9865995..HEAD`, oldest first):

| # | Hash | Task | Message |
|---|------|------|---------|
| 9 | `e35b524` | 9 | feat(b4): mapping suggestions orchestration (code-skip §5.4 + bands, D1) |
| 10 | `f6e0445` | 10 | feat(b4): codeSkip emits raw strings for manual pick-list (§5.4) |
| 11 | `bfd3384` | 10 | feat(b4): mapping UI — fuzzy bands + manual + code pick-list (§5.5) |
| 12 | `1726e0f` | 11 | feat(b4): conflict resolution UI (§8.5) + two Dashboard banners + PENDING_REVIEW count |
| 13 | `b6348e8` | — | test(harness): document cross-process dev-DB pollution gotcha; CI is isolated |
| 14 | `569e5ad` | 11.5a | feat(b4): deleteMapping service — revert backfill + shared requeue primitive (§8.5/§8.6) |
| 15 | `1b6852e` | 11.5b | feat(b4): delete-mapping UI — remove portal string with confirm (§3.2.1) |
| 16 | `0092600` | 11.5a-fix | fix(b4): deleteMapping only re-queues portal strings that had sellout data (§8.5) |
| 17 | `8923481` | 11.6a | feat(b4): retargetMapping service — in-place SKU retarget + extract revert primitive (§8.5) |
| 18 | `e712708` | 11.6b | feat(b4): retarget mapping UI — PATCH route + inline SKU change in Vista B (§3.2.1) |

- **Expected tree** after the doc commit of this session: clean except ONE untracked
  dir — `docs/superpowers/sdd/` (phase-4 handoff + task briefs/reports; intentionally
  untracked, precedent since Fase 3). The plan
  (`docs/superpowers/plans/2026-06-22-b4-portales.md`) and this handoff are tracked as
  of this session's doc commit. Confirm with `git status --short`.
- Suite state at close: **197 passed / 0 failed** (31 files, single process),
  typecheck/build clean.

## 2. What exists today (verified at write time)

### `core/normalizer/resolve.ts` — 7 exports

(The pre-session count was 6; 11.6a's extraction of `revertSelloutProductId` added one.)

1. `backfillSelloutProductId(db: PrismaClient | Prisma.TransactionClient, args: { clientId, chain, portalString, productId }): Promise<number>` — attributes SelloutData rows `WHERE portalRawProduct = portalString AND productId IS NULL` to the SKU; returns count.
2. `revertSelloutProductId(db: PrismaClient | Prisma.TransactionClient, args: { clientId, chain, portalString, productId }): Promise<number>` — exact inverse mirror (sets `productId = NULL`, scoped to the string AND the old productId); returns count. Extracted in 11.6a from deleteMapping's inline step 2; shared by deleteMapping + retargetMapping.
3. `requeueUnmappedProduct(tx: PrismaClient | Prisma.TransactionClient, args: { clientId, chain, portalString, firstSeenUploadId? }): Promise<void>` — upserts the string back into the UnmappedProduct queue; **throws if `firstSeenUploadId` is absent**. Shared by resolveConflict's "Ninguno" branch + deleteMapping.
4. `assignMapping(db: PrismaClient, args: { clientId, chain, portalString, productId, status: 'CONFIRMED' | 'PENDING_REVIEW' }): Promise<AssignResult>` — D1 mapping + D3 conflict detection (update-then-insert), FIX-1 CONFLICTED guard, backfills on success.
5. `resolveConflict(db: PrismaClient, args: { clientId, chain, portalString, winnerProductId: string | null, firstSeenUploadId? }): Promise<void>` — "Es éste" (winner CONFIRMED, losers deleted, backfill) / "Ninguno" (`winnerProductId: null` → all deleted + requeue).
6. `deleteMapping(db: PrismaClient, args: { clientId, chain, portalString, productId, firstSeenUploadId? }): Promise<void>` — one tx: verify (not-found/CONFLICTED throw) → revert via primitive → delete row → **requeue ONLY if revert count > 0** (11.5a-fix presence-of-data rule; a hand-added string with no rows just disappears).
7. `retargetMapping(db: PrismaClient, args: { clientId, chain, portalString, oldProductId, newProductId }): Promise<void>` — one tx: guards (not-found / CONFLICTED / no-op / tenancy of newProductId) → revert (old) → UPDATE mapping row in-place (same id, status forced CONFIRMED) → backfill (new). No `firstSeenUploadId` — never touches UnmappedProduct.

### `app/api/portales/mappings/route.ts` — 4 handlers

- `GET ?chain=` → existing mappings, rows per SKU (§3.2.1).
- `POST { chain, portalString, productId, status }` → assignMapping; conflict outcome surfaces to the UI.
- `DELETE { chain, portalString, productId }` → derives most-recent-upload as `firstSeenUploadId` (route policy) → deleteMapping; throws mapped by substring: CONFLICTED → 409, 'not found' → 404.
- `PATCH { chain, portalString, oldProductId, newProductId }` → retargetMapping (thin: zero business logic); CONFLICTED / no-op / foreign-or-missing product → 409, 'not found' → 404; success `{ ok: true }`. Added 11.6b.
- `clientId` ALWAYS from `requireAuth()`, never from the body. Error shape `{ error: { code, message } }` via `errorResponse`.

### UI (Vista B of `components/portales/mapping-section.tsx`)

Per string row: **"Cambiar"** (11.6b — inline panel, SkuSelect excluding the row's
current SKU, no modal) + **"Quitar"** (11.5b — ConfirmDialog). Both share the SAME
unified refetch (`suggestionsQ.refetch() + mappingsQ.refetch() + onMappingChange()`)
that propagates counts to chain-card / conflict section / Dashboard banners.

## 3. Footguns (all still live — respect them in any follow-up work)

1. **`portalRawProduct` vs `portalString`:** SelloutData's column is `portalRawProduct`; the mapping's is `portalString`. Every backfill/revert `where` must bridge them explicitly. Grep-check any new query.
2. **Multi-value guard:** both primitives filter by `portalRawProduct` (AND productId). Dropping that filter makes P2's rows follow P1's fate (the §8.6-style tests pin this — `tests/normalizer/resolve.test.ts`).
3. **Order revert → backfill (retarget):** backfill matches `productId IS NULL`; run before the revert it matches 0 rows and the revert then de-attributes everything. Pinned by tests; do not reorder.
4. **`res.ok` FIRST in UI fetch handlers:** 409/404 carry `{ error }`, 200 carries `{ ok }` — different shapes; parsing before checking `res.ok` breaks error display.
5. **Conditional requeue by data presence (11.5a-fix):** deleteMapping re-queues ONLY when the revert count > 0. The conditional lives in the CALLER, not in `requeueUnmappedProduct` — the primitive is shared with resolveConflict's "Ninguno", whose behavior must not change.
6. **Dev-DB is shared cross-process:** ONE vitest process at a time locally (see `vitest.config.ts` comment, commit `b6348e8`). CI is isolated and immune. Check for orphan processes before dispatching implementers.

## 4. What remains for B4

- **Task 12 — smoke gate (human visual):** checklist REPLACED this session in the plan
  (`docs/superpowers/plans/2026-06-22-b4-portales.md`, "Task 12"). Three-phase data
  strategy: FASE A (20 items against the real Soriana data already loaded — covers
  upload, bands, code-skip, multi-value, conflict, delete con/sin data, retarget,
  banners, credentials), FASE B (destructive reset — **explicit user OK at that
  moment**, CLAUDE.md protocol; the DB has real data), FASE C (onboarding from zero,
  FIX-7 empty-state banners). Gate closes on user approval, not green CI.
- **Task 13 — PR:** push + `gh pr create` (body template in the plan) + CI watch.
  Close criterion: CI green + smoke gate approved.

## 5. Open follow-ups

Ledger: `.superpowers/sdd/b4-followups.md` (gitignored — lives only on this machine).
Sections: Task 6 (#3 route-coverage pass — now includes the PATCH handler — and #4-#7),
Task 7, Task 8, Harness/test-infra (isolated DB per process; orphan-process hygiene),
and the 11.5/11.6 session items (409-vs-404 inconsistency, substring error-matching
sweep, shared fetch helper, stale edit-state, lax test matchers, 11.5a-fix signal
asymmetry notes, ConfirmDialog hardcoded loading label). None block Task 12/13; most
fold into the whole-branch review or the routes coverage pass.
