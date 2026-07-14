# B4 (Portales) — Phase 4 handoff

> Written at the close of Fase 3 (Tasks 6-8 committed). Read this in a FRESH
> session alongside `CLAUDE.md`, `docs/specs/onetable-fase2-spec.md` (§3.2, §5,
> §6, §8), and `docs/superpowers/plans/2026-06-22-b4-portales.md` (Tasks 9-13).
> Every state claim below was verified empirically (grep/read) at write time —
> but re-verify any path/symbol before building on it (backlog-hygiene rule).

---

## 1. Git state

- **Branch:** `feat/b4-portales`
- **Base:** B3 HEAD `83ac5ea` (`feat/b3 parametros and drilldown (#10)`)
- **8 B4 commits over the base, in order:**

| # | Hash | Message |
|---|------|---------|
| 1 | `350fe31` | feat(b4): MappingLookup discriminated union + read-side conflict (§8.3) |
| 2 | `f106d40` | feat(b4): shared backfillSelloutProductId primitive + §8.6 guard (net-new) |
| 3 | `619b0e7` | feat(b4): assignMapping (D1+D3 detection) + resolveConflict services (§8.5) |
| 4 | `a534fbe` | feat(b4): Portales resolution/mapping/counts APIs + dashboard unmapped/conflict counts |
| 5 | `da98fcc` | feat(b4): canonicalize weight tokens (86 GR → 86g) before band UI (§5.3/D4) |
| 6 | `b404a54` | feat(b4): portal credentials API (username only, §6.1) + seed Fase 3 doc-fix |
| 7 | `43d88e0` | feat(b4): upload route accepts explicit chain (cards drive chain, §3.2.4) |
| 8 | `9865995` | feat(b4): Portales card shell + credentials UI + per-card upload; remove Análisis upload |

- **Tree:** clean except ONE untracked file — `docs/superpowers/plans/2026-06-22-b4-portales.md` (the plan itself; intentionally untracked). Confirm with `git status --short` → only that `.md`.
- **Phases:** 1 = Tasks 1-4 (data core), 2 = Task 5 (weight tokens), 3 = Tasks 6-8 (credentials API, explicit upload, Portales UI). Phase 4 = Tasks 9-11 (mapping/conflict UI), then 12 (smoke) + 13 (PR).

---

## 2. What is built (Phases 1-3) — real files + exports

### `core/normalizer/`
- **`types.ts`**
  - `type MappingLookupResult = { kind: 'mapped'; productId } | { kind: 'unmapped' } | { kind: 'conflict' }` (discriminated union, §8.3).
  - `type MappingLookup = (chain: Chain, portalString: string) => MappingLookupResult`.
  - `type NormalizationInput`, `type NormalizationStats`.
- **`lookup.ts`**
  - `type MappingRow = { chain, portalString, productId, status }`.
  - `function buildMappingLookup(rows: MappingRow[]): MappingLookup` — builds the closure; CONFLICTED rows resolve to `{ kind: 'conflict' }` (read-side), so conflicted strings get `productId = NULL` on write (sum in totals, excluded from SKU analysis).
- **`resolve.ts`** (all `async`)
  - `backfillSelloutProductId(db, { clientId, chain, portalString, productId })` — the NET-NEW shared primitive (the spec's "ya existe" was a phantom). Matches on **`SelloutData.portalRawProduct`** (THE FOOTGUN — see §5).
  - `assignMapping(db, { clientId, chain, portalString, productId, status })` — D1 + D3 detection, update-then-insert order; returns `AssignResult` = `mapped` | `conflict` | `conflict_exists`. Refuses an already-CONFLICTED key (FIX-1 → 409).
  - `resolveConflict(db, { clientId, chain, portalString, winnerProductId|null, firstSeenUploadId })` — §8.5 "Es éste" / "Ninguno".
  - Guarded by `tests/normalizer/resolve.test.ts` (the §8.6 footgun guard).

### `core/fuzzy/` (barrel `index.ts` re-exports `./token-set-ratio`, `./weight`, `./code-detector`, `./match`)
- `tokenize(s: string): Set<string>` — token-set tokenizer (token-set-ratio.ts).
- `canonicalizeWeights(s: string): string` — "86 GR" → "86g" normalization (weight.ts, §5.3/D4, Task 5).
- `isMostlyCodes(strings: string[], threshold = 0.7): boolean` — §5.4 code-column detector (skip fuzzy for ASIN/code columns).
- `PROVISIONAL_FUZZY_THRESHOLDS: FuzzyThresholds = { tHigh: 0.7, tLow: 0.3 }`.
- `type FuzzyThresholds = { tHigh, tLow }`; `type CatalogEntry = { productId, nameStandard }`.
- `type FuzzySuggestion = { productId: string|null; nameStandard: string|null; score: number; band: FuzzyBand }`.
- `classifyBand(score, thresholds): FuzzyBand` — `high` (≥tHigh) / `medium` (≥tLow) / `low`.
- `suggestMatch(portalString, catalog: CatalogEntry[], thresholds): FuzzySuggestion` — best single catalog entry. Caller decides per band. `scoreMatch = tokenSetRatio × weightPenalty` (§14).

### `app/api/portales/` (clientId ALWAYS from `requireAuth()` session, never body)
- **`mappings/route.ts`**
  - `GET ?chain=` → `{ mappings: [{ id, portalString, productId, status, product: { nameStandard, skuCode } }] }` (ordered by portalString).
  - `POST { chain, portalString, productId, status? }` → `{ result }` (AssignResult). status defaults CONFIRMED; PENDING_REVIEW if sent. Verifies the product belongs to the client (409 on conflict, FIX-1).
- **`conflicts/route.ts`**
  - `GET ?chain=` → `{ conflicts: [{ portalString, candidates }] }` (grouped CONFLICTED rows).
  - `POST { chain, portalString, winnerProductId|null, firstSeenUploadId? }` → `{ ok: true }`. "Ninguno" (null winner) needs an upload to re-anchor; clean 409 if none (FIX-5).
- **`counts/route.ts`**
  - `GET ?chain=` → `{ unmappedCount, pendingReviewCount, conflictCount }` (conflictCount uses `distinct: ['portalString']`).
- **`credentials/route.ts`** (§6.1 — username only)
  - `GET` → `{ credentials: [{ chain, username, isActive, hasPasswordPending }] }`.
  - `PUT { chain, username }` → `{ ok: true }`. NEVER accepts/stores a password. `hasPasswordPending` stays true. Upsert by `clientId_chain`.
- **NOT YET BUILT:** `/api/portales/mappings/suggestions` — built in **Task 9** (`buildMappingSuggestions`). The scaffold hook `useChainSuggestions` references it but it 404s until Task 9 lands.

### `lib/portales/chains.ts`
- `CHAINS = ['SORIANA','CHEDRAUI','HEB','AL_SUPER','LA_COMER','AMAZON'] as const`.
- `parseChain(raw: unknown): Chain | null` (guarded narrowing, the canonical helper — 4+ consumers).
- `FILE_TYPES = ['MIXED','VENTAS','INVENTARIO'] as const`.
- `parseFileType(raw: unknown): FileType | null` (centralized here in Task 7 to avoid enum drift).

### `app/api/dashboard/kpis/route.ts`
- Already returns `unmappedCount` + `conflictCount`. Both are HOISTED **above** the `noData` check and returned in BOTH the noData branch AND the loaded branch (FIX-7), so the two Dashboard banners render during an empty/onboarding period. `conflictCount` uses `distinct: ['chain','portalString']` — **cross-chain** (FIX-3). Do NOT retype/reorder the six existing KPI queries when touching this (FIX-6 regression guard).

### `lib/hooks/use-portales.ts`
- **Built + consumed now:** `useCredentials()` (GET /api/portales/credentials), `useChainCounts(chain)` (GET /api/portales/counts?chain=). Both `{ data, loading, error, refetch }`, mirroring `use-uploads.ts`.
- **Scaffold hooks for Task 10/11** (each returns `data: unknown` with a `// TODO Task 10/11: replace unknown with the real row interface before consuming.` anchor):
  - `useChainMappings(chain)` → /api/portales/mappings?chain= (route EXISTS).
  - `useChainSuggestions(chain)` → /api/portales/mappings/suggestions?chain= (**route built in Task 9**).
  - `useChainConflicts(chain)` → /api/portales/conflicts?chain= (route EXISTS).
  - These fire `useEffect→refetch` on mount when first consumed — an early error before the endpoint exists is expected, not a hook bug (follow-up #5).

### `components/portales/`
- **`../../app/(dashboard)/portales/page.tsx`** — thin SERVER shell: `<header>` + `<PortalesGrid />`.
- **`portales-grid.tsx`** — `'use client'` wrapper. Calls `useCredentials()` ONCE for the page; owns `ENABLED = ['SORIANA','CHEDRAUI','AMAZON']` (→ `<ChainCard>`) and `COMING_SOON = ['HEB','AL_SUPER','LA_COMER']` (→ "próximamente" placeholders, `.replace(/_/g,' ')`). Passes each card `initialUsername` + `credLoading`.
- **`chain-card.tsx`** — `'use client'`. Props `{ chain, initialUsername, credLoading }`. Calls `useChainCounts(chain)` itself (per-card). Renders header counts ("N sin mapear · N por verificar · N en conflicto"), the §3.2.4 "configuración incompleta" warning (`role="status" aria-live="polite"`), `<CredentialsForm>`, `<ChainUpload>`, and the Task 10/11 MOUNT POINTS (see §3).
- **`credentials-form.tsx`** — username `Input` saved via PUT (body `{ chain, username }`, password-free); disabled password `Input` with EXACT "Fase 3" microcopy. `save()` has try/catch/finally + `res.ok` + inline success/error feedback (never stuck). `useEffect([initialUsername])` resync.
- **`chain-upload.tsx`** — per-card upload (adapted from the deleted `upload-zone.tsx`). Posts `files` + explicit `chain` + `fileType`. Amazon → TWO `SingleSlot` (VENTAS + INVENTARIO, independent state); others → ONE (MIXED). `.xlsx` + 10 MB checks kept; filename-needle validation dropped (explicit chain makes it irrelevant). `onUploaded` fires only on success → refetches counts.

---

## 3. What remains (Tasks 9-13)

| Task | Nature | Summary |
|------|--------|---------|
| **9** | Backend, TDD | `buildMappingSuggestions` orchestration (code-detector skip → bands) + the `/api/portales/mappings/suggestions` route. Backend/TDD, low risk (~30 LOC), normal gate. NOTE: Fase 4 is the heaviest PHASE in the project, but the weight lives in the UI GATEs (Tasks 10-11), not this task. |
| **10** | UI GATE | Mapping UI in the card: bands (high pre-fill / medium requires explicit check / low+manual SKU picker) + multi-valor (`[+ Agregar otro string]`) + Amazon/code manual pick-list. Human visual review. |
| **11** | UI GATE | Conflict-resolution UI ("Es éste" / "Ninguno") + TWO Dashboard banners (unmapped yellow, conflict orange → both link `/portales`) + PENDING_REVIEW count. Human visual review. |
| **12** | Smoke | Full end-to-end browser gate against seed/real data — NOT green CI alone. |
| **13** | PR | Push + open the B4 PR; CI green + smoke approved = close. |

**Exact mount points in `components/portales/chain-card.tsx`** (lines 76-77, immediately before the closing `</Card>`):
```tsx
      {/* TODO Task 10: mapping section */}
      {/* TODO Task 11: conflict section */}
```
Task 10 mounts `MappingSection` (consumes `useChainMappings` + `useChainSuggestions`) at the line-76 comment; Task 11 mounts `ConflictSection` (consumes `useChainConflicts`) at the line-77 comment. Both render only when their counts > 0 per the plan.

---

## 4. Logged follow-ups (`.superpowers/sdd/b4-followups.md`)

Pending, NOT to be done inside Tasks 9-11 unless they intersect:
- **#3 (Task 6):** route-handler behavioral tests for the credentials route (401 / JSON-parse 400 / unknown-chain 400 / blank-username 400 / `{ ok: true }`), mocking `@/auth` like sibling routes — DO IN ONE coverage pass across all 4 Portales routes, not one-by-one.
- **#4-#7 (Task 6) minors:** `parseChain(body.chain ?? null)` consistency; `_req: Request` on credentials GET; PUT leaves `isActive` untouched (reactivation question); test password-absence cast alternative → all to the whole-branch review.
- **#1-minor (Task 7):** file-as-field per-file error says "field missing" instead of "must be plain text, not a file" (cosmetic) → whole-branch review.
- **Optional (Task 7):** rename `lib/portales/chains.ts` to a portal-metadata name now that it also holds FILE_TYPES/parseFileType (re-touches 4 import sites; no functional gain today) → whole-branch review.
- **#5 (Task 8):** scaffold hooks fire on mount → Task 10/11 implementer should not treat an early error/404 as a hook bug.
- **#8 (Task 8):** `chain-upload.tsx` per-slot `<p>` label not associated (htmlFor/id) with the hidden file input (compensated by dropzone aria-label) → Task 10/11 / whole-branch review.

---

## 5. Binding reminders for Phase 4

**Decisions (D1-D4):**
- **D1:** enabled chains = SORIANA, CHEDRAUI, AMAZON (cards). HEB/AL_SUPER/LA_COMER = placeholders. Fuzzy runs during parse, 1 route-level round-trip.
- **D2:** the MONEY layer (ProductPriceOverride read/write + §7 query resolution + dual rendering) is DEFERRED out of B4 entirely — B4 is units-only. Do NOT half-build price override.
- **D3:** multi-tenancy = 1 Client per account, forced in app layer; `clientId` from the JWT via `requireAuth()` (NOT `getCurrentClient`/`lib/tenant.ts` — that door stays closed in Fase 2).
- **D4:** weight penalty + token-norm in fuzzy (built, Task 5). The fuzzy metric redesign is OUT of B4.

**Integration points (get these exactly right):**
- **Lookup READ vs detection WRITE:** the normalizer's `MappingLookup` is the READ side (resolves a portalString to mapped/unmapped/conflict at normalize time). `assignMapping`/`resolveConflict` are the WRITE side (D1 create + D3 conflict detection). Don't conflate them.
- **THE FOOTGUN — `portalRawProduct` vs `portalString`:** backfill matches on `SelloutData.portalRawProduct` (the raw upload value), while mappings key on `portalString` (the normalized mapping key). They are NOT interchangeable. `tests/normalizer/resolve.test.ts` (§8.6 guard) exists precisely to catch a regression here. Any new backfill call must match `portalRawProduct`.
- **Two Dashboard banners:** fed by `/api/dashboard/kpis` (NOT the onetable route — that path shed its dead `unmappedCount`). `conflictCount` is `distinct: ['chain','portalString']` → cross-chain (two chains with the same conflicted string = 2). Both counts are returned in the noData branch too (FIX-7) so banners show in the empty state. Banners render on the DASHBOARD (§8.4/DEC-B), not the Análisis drill-down.
- **PENDING_REVIEW count:** §3.2.3 — PENDING_REVIEW data STILL enters KPIs (no new JOIN, KPIs are not emptied by the flag). The count is a separate display, not a KPI filter.

**Fuzzy realism:** medium-band and manual are the COMMON case, not high-band auto-accept. The UI must make medium (explicit-check-before-accept) and low/manual (SKU picker) first-class, not edge cases. Amazon/code columns skip suggestions entirely (`isMostlyCodes`, §5.4) → manual pick-list, not garbage suggestions.

**DB state:** the database currently holds **~2636 real Soriana rows** loaded during the Task 8 visual smoke (user-confirmed on screen — not re-counted at handoff write time). Phase 4 development/smoke runs against this real data, not an empty DB. If a destructive reset is ever needed, this is now real-ish client-shaped data → confirm with the user first per CLAUDE.md (the trigger is "real data loaded", which has occurred).

---

## 6. Fresh-session startup (after `/clear`)

1. Read `CLAUDE.md` (auto) + `docs/specs/onetable-fase2-spec.md` (§5, §8 for Task 9).
2. Read `docs/superpowers/plans/2026-06-22-b4-portales.md` Task 9 (line ~1403).
3. Read THIS handoff.
4. Confirm git: `git log --oneline -9` shows the 8 B4 commits over `83ac5ea`, tree clean.
5. Start Task 9 (subagent-driven, TDD) — wait for the user's Phase 4 kickoff prompt.
