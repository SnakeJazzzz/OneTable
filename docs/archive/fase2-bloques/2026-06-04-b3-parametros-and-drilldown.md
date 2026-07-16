# B3 — Parámetros + Drill-down Move Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land block B3 of Fase 2: (Pieza A) build the net-new **Parámetros** page — canonical SKU listing with editable `skuCode` CRUD, a net-new additive/idempotent Excel importer `core/parameters/import.ts`, base prices, and a thresholds form with inline no-overlap validation; and (Pieza B) **move the drill-down** (`OneTable` + unmapped banner) from Dashboard to Análisis, giving Análisis its own period selector. Plus the shared prerequisites the two halves need: consolidate cuid generation into `core/ids.ts`, and rename the stub routes `/catalogo`→`/parametros` and `/clientes`→`/portales`.

**Architecture:** Two feature halves that are independent at the spec level (dependency graph §12.2: `B3.params` depends on B2.clf which is merged; `B3.drill` is independent). They share three small prerequisite pieces that land first so neither half blocks on the other:

- **Pieza A (Parámetros)** is the larger half: a pure importer module (TDD), a pure threshold-validation function (TDD), SKU + threshold API routes (JWT-auth, `requireAuth()` pattern), and the Parámetros UI page. Every Product create site uses `core/ids.ts` (Task 1).
- **Pieza B (drill-down move)** is small and low-coupling — the re-grounding confirmed `OneTable` takes only a `periodKey` prop and self-contains its filters + banner, so the move is: delete two lines from Dashboard, add the component + a reused period selector to Análisis. No refactor of the component, no endpoint rename (`/api/dashboard/onetable` stays put, §3.3.1).

**Three closed-decision deviations (documented, NOT silent):** the implementer must preserve these as written-down decisions so a future reader doesn't take them for oversights:
1. **No `getCurrentClient`/`lib/tenant.ts`** (spec §1 prescribes it). `clientId` is already a single value in the JWT via `requireAuth()`/`auth()`; the helper would be a redundant DB lookup and the multi-marca door it guards is not open in Fase 2. Parámetros routes resolve `clientId` from the session, like every other route. Conscious deviation from a closed decision — documented in Task 5.
2. **Unmapped banner is neutralized in B3, retargeted to Portales in B4.** Today it links to `/catalogo` ("Resolver en Catálogo"). The renamed route + the fact that resolution moves to Portales (§3.2/§8.4, built in B4) means the B3 banner must NOT point at a "coming soon" dead-end. In B3 it becomes neutral text ("N productos sin mapear…") with no actionable link. **Re-pointing it to Portales is an explicit B4 task, not a loose note** (recorded in §"B4 follow-ups" at the end of this plan).
3. **Routes are renamed now** (`/catalogo`→`/parametros`, `/clientes`→`/portales`), not just the sidebar labels. Spec §2 reads literally "Renombre = solo el link del sidebar"; this deviates because the pages are empty stubs today, so renaming the route is trivial now and expensive after B3/B4 fill them — and a permanent URL/label mismatch (`/catalogo` showing "Parámetros") is forever legibility debt. Conscious deviation — documented in Task 2.

**Tech Stack:** Next.js 14 App Router + TypeScript, Prisma 6.19.3 + Neon Postgres, Tailwind + shadcn/ui, `xlsx` 0.18.5 (present), Vitest, pnpm 10.26.1 (`--ignore-scripts`, exact pins — Mini Shai-Hulud protocol). **B3 adds zero new packages** unless a shadcn component is needed (see protocol below).

**Source spec:** `docs/specs/onetable-fase2-spec.md` is the design source of truth: §3.1 (Parámetros), §3.3 (Análisis/drill-down), §3.4 (Dashboard loses drill-down+banner), §10 (Parámetros importer), §4.2/§4.5 (Product/ThresholdConfig schema, already migrated in B1). Defer to it on any ambiguity. No new design doc — the spec is the design.

---

## Supply-chain protocol (CLAUDE.md §8 — NON-NEGOTIABLE prefix for any implementer)

B3 should add **zero new packages**. If a task genuinely needs a shadcn/ui component not yet present (`shadcn add <component>` or a `pnpm add`), it MUST follow CLAUDE.md §8: `pnpm add --ignore-scripts` (or `shadcn add` under the same rules), exact pin (no `^`/`~`), run `./scripts/check-supply-chain.sh` before+after, grep the lockfile for worm tokens, never delete `pnpm-lock.yaml`, and report (name, exact version, technical reason) in the handoff. The mandatory post-task verification (3 commands) runs at the end of every task below:

```bash
./scripts/check-supply-chain.sh
grep -E '"[\^~]' package.json && exit 1 || echo "✅ pins exact"
grep -E "tanstack|squawk|uipath|mistral|cap-js|intercom-client|router_init|setup\.mjs|router_runtime" pnpm-lock.yaml | grep -v lightningcss && exit 1 || echo "✅ lockfile clean"
```

---

## Files

| Path | Action | Responsibility |
|---|---|---|
| `core/ids.ts` | Create | `makeCuid()` (the `c${uuid…24}` shape) as the single production cuid generator. |
| `core/normalizer/upsert.ts` | Modify | Drop the inline `makeCuid`; import from `core/ids`. |
| `core/catalog/import.ts` | Modify | Drop the inline `makeSkuCode`; import `makeCuid` from `core/ids`. |
| `app/(dashboard)/parametros/page.tsx` | Create (rename of `catalogo/`) | Parámetros UI: SKU list/CRUD + base prices + threshold form + import. |
| `app/(dashboard)/portales/page.tsx` | Create (rename of `clientes/`) | Portales stub (still "coming soon" — built in B4). |
| `app/(dashboard)/catalogo/page.tsx` | Delete | Renamed to `parametros/`. |
| `app/(dashboard)/clientes/page.tsx` | Delete | Renamed to `portales/`. |
| `components/dashboard/sidebar.tsx` | Modify | Relabel + re-path: Clientes→Portales `/portales`, Catálogo→Parámetros `/parametros`. |
| `components/dashboard/unmapped-banner.tsx` | Modify | Neutralize: remove the `/catalogo` link; plain non-actionable text (decision #2). |
| `lib/thresholds.ts` | Modify | Add pure `validateThresholdCuts(cuts)` (no-overlap, all > 0). Reused by API + UI. |
| `core/parameters/import.ts` | Create | Net-new additive/idempotent Excel importer (Código/Producto/PrecioCompra/PrecioVenta). Never touches `ProductMapping`. |
| `app/api/parametros/skus/route.ts` | Create | GET (list) + POST (create SKU). |
| `app/api/parametros/skus/[id]/route.ts` | Create | PATCH (edit name/prices/skuCode) + DELETE. |
| `app/api/parametros/thresholds/route.ts` | Create | GET (current cuts) + PUT (save, server-guarded by `validateThresholdCuts`). |
| `app/api/parametros/import/route.ts` | Create | POST multipart → `core/parameters/import.ts`. |
| `app/api/parametros/export/route.ts` | Create | GET → xlsx with `Código` as column A (round-trip, §10.2). |
| `lib/hooks/use-parametros.ts` | Create | Client hooks for the Parámetros page (SKUs, thresholds). |
| `app/(dashboard)/analisis/page.tsx` | Modify | Add period selector (reuse `useDashboardPeriods` + `PeriodSelector`) + render `<OneTable>`. |
| `app/(dashboard)/dashboard/page.tsx` | Modify | Remove the `OneTable` import + `<OneTable>` render (§3.4). |
| `tests/ids/ids.test.ts` | Create | Lock the cuid shape. |
| `tests/lib/thresholds.test.ts` | Modify | Add `validateThresholdCuts` cases (existing `getThresholdCuts` tests stay). |
| `tests/parameters/import.test.ts` | Create | §10.5 obligatory tests (empty-cell non-destruction; SelloutData/ProductMapping untouched count). |

**Note:** wiring fuzzy suggestions into mapping, conflict-resolution UI, the Portales cards, and re-pointing the unmapped banner to Portales are all **B4** — out of scope here.

---

## Task 1: `core/ids.ts` — consolidate cuid generation (atomic refactor)

The B1 comment in `core/catalog/import.ts:9` predicted this: "Consolidate into a shared `core/ids.ts` when B3 adds more production create sites." B3's Parámetros SKU-create is that new site. `makeCuid` (normalizer/upsert.ts:41) and `makeSkuCode` (catalog/import.ts:10) are byte-identical (`c${randomUUID().replace(/-/g,'').slice(0,24)}`). Consolidate, no behavior change — existing tests must stay green.

**Files:** Create `core/ids.ts`, `tests/ids/ids.test.ts`; Modify `core/normalizer/upsert.ts`, `core/catalog/import.ts`.

- [ ] **Step 1: Confirm clean starting state** — on `feat/b3-parametros-and-drilldown` off updated `main` (the gitignore-lock PR is merged), clean tree.

- [ ] **Step 2: Write `tests/ids/ids.test.ts`** — assert `makeCuid()` returns a 25-char string matching `/^c[0-9a-f]{24}$/`, and two calls differ.

- [ ] **Step 3: Run it → FAIL** (`Cannot find module '@/core/ids'`).

- [ ] **Step 4: Create `core/ids.ts`:**

```typescript
// Single production cuid-shaped opaque id generator. No Prisma @default on
// skuCode (spec §4.2), so the TS layer provides ids at every create site:
// catalog seed import, the normalizer UPSERT, and Parámetros SKU CRUD (B3).
import { randomUUID } from 'node:crypto';

export function makeCuid(): string {
  return `c${randomUUID().replace(/-/g, '').slice(0, 24)}`;
}
```

- [ ] **Step 5: Update call sites** — in `core/normalizer/upsert.ts` delete the local `makeCuid` (line 41-43) and `import { makeCuid } from '../ids'`; in `core/catalog/import.ts` delete `makeSkuCode` (line 10-12), `import { makeCuid } from '../ids'`, and replace the `skuCode: makeSkuCode()` call (line 91) with `skuCode: makeCuid()`. Drop the now-stale `randomUUID` imports where no longer used.

- [ ] **Step 6: `pnpm vitest run tests/ids` then `pnpm typecheck`** → PASS.

- [ ] **Step 7: `pnpm test`** → full suite green (normalizer + catalog import tests unchanged in behavior).

- [ ] **Step 8: Supply-chain post-task verification (3 commands).**

- [ ] **Step 9: Commit** — `refactor(b3): consolidate cuid generation into core/ids.ts`.

---

## Task 2: Route rename + sidebar relabel + neutralize unmapped banner

Renames the two stub routes and relabels the sidebar (deviation #3), and neutralizes the unmapped banner so the rename doesn't leave a dangling `/catalogo` href (deviation #2). One atomic commit — the route delete and the href fix must land together or `/catalogo` 404s.

**Files:** rename `app/(dashboard)/catalogo/` → `parametros/`, `app/(dashboard)/clientes/` → `portales/`; Modify `middleware.ts`, `components/dashboard/sidebar.tsx`, `components/dashboard/unmapped-banner.tsx`.

- [ ] **Step 1: Pre-check refs (BROAD grep — the build will NOT catch a stale route ref).** Run BOTH forms (with and without the leading slash, to catch bare-string refs, hrefs without a slash, and dynamically-built paths), repo-wide over code:
  - `grep -rn "catalogo\|clientes" --include="*.ts" --include="*.tsx" --include="*.js" --include="*.json" . | grep -v node_modules | grep -v "\.next/" | grep -v "/docs/"`
  - `grep -rn "/catalogo\|/clientes" --include="*.ts" --include="*.tsx" .`
  - Also eyeball auth/redirect surfaces specifically: `middleware.ts`, `auth.ts`, `app/(auth)/**`, and any `router.push`/`redirect(`/`callbackUrl` (verified: login/signup push to `/dashboard`, unaffected — but re-confirm).
  - **List EVERY file the grep returns in the Task 2 report so the user can confirm the list is complete before the old routes are deleted.** Classify each hit as (a) a route reference to update, or (b) a false positive to leave alone.
  - **Known hits as of plan-writing (2026-06-04 grep):** TO UPDATE → `middleware.ts:7-8` (`PROTECTED_PREFIXES` — **critical: rename without this leaves `/parametros` and `/portales` UNPROTECTED by auth**), `components/dashboard/sidebar.tsx:24-25`, `components/dashboard/unmapped-banner.tsx:20`. FALSE POSITIVES (leave alone) → `tests/catalog/import.test.ts` and `scripts/seed.ts` (reference the xlsx fixture `catalogo-productos.xlsx`, not the route), `core/catalog/import.ts` dir name (the seed importer module, not a route), `app/(dashboard)/clientes/page.tsx:6` (copy text inside the stub being renamed — moves with the dir). If the live grep returns anything beyond this list, STOP and report before deleting routes.

- [ ] **Step 2: Move the route dirs** with `git mv` (preserve history):
  - `git mv "app/(dashboard)/catalogo" "app/(dashboard)/parametros"`
  - `git mv "app/(dashboard)/clientes" "app/(dashboard)/portales"`

- [ ] **Step 2b: Update `middleware.ts` `PROTECTED_PREFIXES`** — replace `'/clientes'`→`'/portales'` and `'/catalogo'`→`'/parametros'`. Without this the renamed routes are not auth-gated (an unauthenticated user reaches them instead of redirecting to `/login`). This is the single most important ref the sidebar/banner-only grep missed.

- [ ] **Step 3: Rewrite the moved stubs** — `parametros/page.tsx` heading "Parámetros" (real UI lands in Task 6; keep a minimal stub here so the route compiles); `portales/page.tsx` heading "Portales", text "Configuración de portales — disponible en la siguiente entrega." (built in B4).

- [ ] **Step 4: Sidebar** — in `NAV_ITEMS` change `{ href: '/clientes', label: 'Clientes' }` → `{ href: '/portales', label: 'Portales' }` and `{ href: '/catalogo', label: 'Catálogo' }` → `{ href: '/parametros', label: 'Parámetros' }`. Pick sensible lucide icons (e.g. `Store` for Portales, `SlidersHorizontal` for Parámetros) or keep existing.

- [ ] **Step 5: Neutralize `unmapped-banner.tsx`** (decision #2). Remove the `<Link href="/catalogo">` block entirely; render only the count text. Keep the `count <= 0 → null` guard. Add a one-line comment: `// B4 re-points this to /portales once Portales conflict/unmapped resolution exists (spec §3.2/§8.4).`

- [ ] **Step 6: `pnpm typecheck` + `pnpm build`** → PASS. **Note: the build does NOT validate hrefs** — Next does not fail the build for a `<Link>` to a non-existent route (a stale href only 404s at runtime). So a green build here proves nothing about broken links; the real 404/route verification is the broad grep in Step 1 plus the manual smoke in Task 7 (hit `/parametros` and `/portales` → render; `/catalogo` and `/clientes` → 404). Do not treat a passing build as evidence the rename is complete.

- [ ] **Step 7: Supply-chain verification (3 commands).**

- [ ] **Step 8: Commit** — `feat(b3): rename catalogo→parametros, clientes→portales; neutralize unmapped banner`. Body documents deviations #2 and #3 with their reasons (route stubs are empty so rename is cheap now; banner retarget deferred to B4 to avoid a coming-soon dead-end).

> **Transitional state between Task 2 and Task 3 (expected, correct — not a bug when reviewing intermediate commits):** Task 2 neutralizes the banner but does NOT yet move the drill-down, so after Task 2's commit the (now neutral, link-less) banner still renders on the Dashboard via `<OneTable>`. The drill-down + banner only leave the Dashboard in Task 3. So a reviewer looking at the Task 2 commit in isolation will see a neutralized banner still on Dashboard — that is the intended interim state, not a missed cleanup.

---

## Task 3: Move the drill-down (OneTable + banner) Dashboard → Análisis

The low-coupling half. `OneTable` takes only `periodKey` and self-contains filters + the (now neutral) banner. Dashboard loses it (§3.4); Análisis gains it plus its own period selector. **Reuse `useDashboardPeriods` + `PeriodSelector`** — that is the real reusable mechanism (the hook calls `/api/dashboard/periods`, which uses `getDefaultPeriod` server-side); do NOT call `getDefaultPeriod` from the client. The endpoint `/api/dashboard/onetable` is NOT renamed (§3.3.1). The upload UI stays in Análisis in B3 (it moves to Portales in B4).

**Files:** Modify `app/(dashboard)/dashboard/page.tsx`, `app/(dashboard)/analisis/page.tsx`.

- [ ] **Step 1: Dashboard — remove the drill-down** — delete the `OneTable` import (line 18) and `<OneTable periodKey={period} />` (line 138). Dashboard keeps its own `useDashboardPeriods` + `PeriodSelector` (drives KPIs/charts) and `useDashboardData`. Nothing else changes.

- [ ] **Step 2: Análisis — add period state** mirroring Dashboard's pattern: `const { periods, defaultPeriod, loading: periodsLoading } = useDashboardPeriods();` + `const [period, setPeriod] = useState<string|undefined>(undefined);` + the `useEffect` that sets `period` to `defaultPeriod` once loaded.

- [ ] **Step 3: Análisis — render** the `<PeriodSelector>` in the header (right side, like Dashboard) and `<OneTable periodKey={period} />` as a new section below the "Uploads recientes" list. The upload zone + uploads list stay (B4 moves upload to Portales). Add a short section heading so the consolidated table reads as a distinct block.

- [ ] **Step 4: `pnpm typecheck` + `pnpm test`** → PASS. Existing dashboard/onetable route tests are unaffected (endpoint unchanged).

- [ ] **Step 5: Supply-chain verification (3 commands).**

- [ ] **Step 6: Commit** — `feat(b3): move OneTable drill-down + banner from Dashboard to Análisis`.

---

## Task 4: `core/parameters/import.ts` — additive idempotent Excel importer (TDD)

Net-new, user-facing, distinct from the seed-only `core/catalog/import.ts` (§10.1 — do NOT refactor catalog). Columns `Código`, `Producto`, `PrecioCompra`, `PrecioVenta`. **Never touches `ProductMapping` or `SelloutData`.** Upsert semantics = Excel-wins **without destruction by empty** (§10.3): a present cell overwrites DB; an empty cell leaves DB intact (never NULLs it). Re-import is idempotent and never deletes. Row behavior by `Código` per §10.2.

**Files:** Create `core/parameters/import.ts`, `tests/parameters/import.test.ts`.

- [ ] **Step 1: Write the failing tests** (§10.5 obligatory + §10.2 row cases):
  - Re-import with empty `PrecioCompra`/`PrecioVenta` cells → the Product keeps its prior prices (non-destruction).
  - `SelloutData` count and `ProductMapping` count are identical before/after a re-import (importer touches neither).
  - `Código` present + exists → UPDATE name + prices (Excel-wins).
  - `Código` present + not in DB → INSERT with that code as the user override.
  - `Código` empty → INSERT with `makeCuid()`.
  - No `Código` column at all → "new catalog" mode: every row inserts, result carries a prominent warning.
  - Idempotency: importing the same buffer twice leaves state identical.

- [ ] **Step 2: Run → FAIL** (`Cannot find module`).

- [ ] **Step 3: Implement.** Contract:

```typescript
export type ParametersImportResult = {
  created: number;
  updated: number;
  skippedNoName: number;
  newCatalogMode: boolean; // true when the Código column was absent
  warnings: string[];
};

export async function importParameters(
  input: { clientId: string; fileBuffer: Buffer },
  db: PrismaClient,
): Promise<ParametersImportResult>;
```

Implementation notes:
- Read sheet via `xlsx`; detect header `Código` (case/accent-tolerant: also accept `Codigo`). Header `Producto` is the name; `PrecioCompra`→`purchasePriceBase`, `PrecioVenta`→`salePriceBase`.
- Parse prices as `Decimal` strings (NEVER float) — pass strings to Prisma `Decimal` fields; treat blank/`null`/non-numeric as "absent" (no write), not zero.
- Match key is `skuCode` (the `Código` column), looked up via `findUnique({ where: { clientId_skuCode: { clientId, skuCode } } })` (the `@@unique([clientId, skuCode])` from §4.2). NEVER match by name (§10.2 footgun rationale — rename → silent dup).
- Empty-cell non-destruction: build the `update` payload by including a field ONLY when its cell has a value; omit otherwise (Prisma omitted field = unchanged).
- `Código` empty → `create` with `skuCode: makeCuid()` (from `core/ids`).
- New-catalog mode (no `Código` column): every row is a create; push the §10.2 warning ("este Excel no tiene códigos. Para actualizaciones futuras, exportá primero desde Parámetros.").
- Blank `Producto` → `skippedNoName++`, continue.

- [ ] **Step 4: Run tests → PASS. `pnpm typecheck`.**

- [ ] **Step 5: Supply-chain verification (3 commands).**

- [ ] **Step 6: Commit** — `feat(b3): core/parameters/import.ts additive idempotent importer §10`.

---

## Task 5: Parámetros API routes (SKU CRUD + thresholds + import/export)

Backend for the page. All routes resolve `clientId` from the session via `requireAuth()` — **NOT** a `getCurrentClient` helper (deviation #1; document the reason in a header comment on `skus/route.ts` so §1's prescription isn't read as forgotten). Threshold PUT is server-guarded by `validateThresholdCuts` (never trust the client).

**Files:** Create `app/api/parametros/skus/route.ts`, `app/api/parametros/skus/[id]/route.ts`, `app/api/parametros/thresholds/route.ts`, `app/api/parametros/import/route.ts`, `app/api/parametros/export/route.ts`; Modify `lib/thresholds.ts`; Modify `tests/lib/thresholds.test.ts`.

- [ ] **Step 1: Add `validateThresholdCuts` to `lib/thresholds.ts`** (pure, reused by API + UI):

```typescript
export type ThresholdValidation = { ok: true } | { ok: false; error: string };

// §3.1.3: reject overlapping cuts. All > 0 and strictly increasing.
export function validateThresholdCuts(c: ThresholdCuts): ThresholdValidation {
  if (![c.critico, c.riesgo, c.atencion, c.exceso].every((n) => Number.isInteger(n) && n > 0))
    return { ok: false, error: 'Todos los cortes deben ser enteros mayores a 0.' };
  if (!(c.critico < c.riesgo && c.riesgo < c.atencion && c.atencion < c.exceso))
    return { ok: false, error: 'Los cortes deben cumplir: crítico < riesgo < atención < exceso.' };
  return { ok: true };
}
```

- [ ] **Step 2: Tests for `validateThresholdCuts`** in `tests/lib/thresholds.test.ts` — valid set ok; equal adjacent rejected; descending rejected; zero/negative rejected. (Existing `getThresholdCuts` tests stay.)

- [ ] **Step 3: `skus/route.ts`** — `GET` lists the client's Products (`id, skuCode, nameStandard, purchasePriceBase, salePriceBase`, ordered by name; serialize `Decimal`→string). `POST` creates: body `{ nameStandard, skuCode?, purchasePriceBase?, salePriceBase? }`; `skuCode` defaults to `makeCuid()`; on `@@unique([clientId, skuCode])` collision (P2002) return 409 with a clear message. Header comment records deviation #1.

- [ ] **Step 4: `skus/[id]/route.ts`** — `PATCH` edits name/prices and supports the **atomic skuCode rename** (§10.4: rename is a UI/UPDATE op preserving FKs, never the Excel path); scope the `where` to `{ id, clientId }` so a tenant can't touch another's row; P2002 on skuCode → 409. `DELETE` removes the Product (cascade clears its mappings/overrides/sellout per schema) scoped to `{ id, clientId }`.

- [ ] **Step 5: `thresholds/route.ts`** — `GET` returns the client's cuts via `getThresholdCuts`. `PUT` parses body cuts, runs `validateThresholdCuts`; on `!ok` return 422 `{ error: { code: 'INVALID_THRESHOLDS', message } }`; on ok `upsert` the `ThresholdConfig` row (it exists from signup, but upsert is defensive).

- [ ] **Step 6: `import/route.ts`** — `POST` multipart, read the file part to a Buffer, call `importParameters({ clientId, fileBuffer }, db)`, return the `ParametersImportResult`. `export/route.ts` — `GET` builds an xlsx from the client's Products with **`Código` as column A** (header literal `Código`), then `Producto`, `PrecioCompra`, `PrecioVenta` (§10.2 round-trip); stream as a download.

- [ ] **Step 7: `pnpm typecheck` + `pnpm test`** → PASS.

- [ ] **Step 8: Supply-chain verification (3 commands).**

- [ ] **Step 9: Commit** — `feat(b3): Parámetros API — SKU CRUD, thresholds validation, import/export`.

---

## Task 6: Parámetros UI page

Assembles the page on `/parametros`. Human-reviewed (gate). Build with shadcn/ui primitives already present; if a new component is needed, follow the supply-chain protocol. Reuse `validateThresholdCuts` from `lib/thresholds.ts` for **inline** validation (error rendered next to the field, not a toast — §3.1.3).

**Files:** Create `lib/hooks/use-parametros.ts`; replace the `app/(dashboard)/parametros/page.tsx` stub with the real page (+ any `components/parametros/*` pieces the implementer factors out).

- [ ] **Step 1: `use-parametros.ts`** — hooks to fetch/mutate SKUs (`GET/POST/PATCH/DELETE /api/parametros/skus`) and thresholds (`GET/PUT /api/parametros/thresholds`), with optimistic-or-refetch updates and error surfacing (mirror the existing hook style in `lib/hooks/`).

- [ ] **Step 2: SKU section** — table of canonical SKUs (`skuCode`, `Producto`, `PrecioCompra`, `PrecioVenta`) with add / edit / delete. `skuCode` is editable inline (atomic rename, §10.4); show the §10.4 microcopy near the field ("El código se edita desde la app, no desde el Excel."). A SKU with no mappings is a valid state — render normally (§3.1.1).

- [ ] **Step 3: Import/export controls** — an "Exportar catálogo" button (hits `/export`) and an import dropzone (hits `/import`) showing the §10.2 microcopy ("Para actualizar SKUs existentes, exportá primero el catálogo desde Parámetros. La columna Código es el enlace entre tu Excel y tus SKUs."). On import success, show the result counts + any `warnings` (esp. the new-catalog warning).

- [ ] **Step 4: Thresholds form** — four integer inputs (crítico/riesgo/atención/exceso) seeded from `GET /thresholds`. On change/submit run `validateThresholdCuts` client-side and render the error **inline** under the offending fields; disable save while invalid. On save, `PUT`; surface the server 422 inline too (defense in depth).

- [ ] **Step 5: `pnpm typecheck` + `pnpm build`** → PASS.

- [ ] **Step 6: Supply-chain verification (3 commands).** If a shadcn component was added, also report it (name, exact pinned version, reason) per §8.

- [ ] **Step 7: Commit** — `feat(b3): Parámetros UI — SKU CRUD, base prices, thresholds, import/export`.

---

## Task 7: Smoke gate (human visual verification — NOT just green CI)

B3 is the first block with navigable UI, so the close-out criterion is **visual verification in the browser against seed data**, per the gate pattern (CLAUDE.md modo de trabajo + spec §7.2.1) and the user's "smoke completo end-to-end" rule (test the whole affected flow, not just the new slice; watch the browser console for runtime errors that tsc-clean + green-tests can still hide).

Run `pnpm dev`, sign in with the seed account, and verify:

- [ ] **Routes/sidebar:** sidebar shows **Parámetros** and **Portales** (not Catálogo/Clientes); both navigate; old `/catalogo` and `/clientes` 404; no console errors on mount of any page.
- [ ] **Drill-down moved:** Dashboard renders KPIs + charts and **no** OneTable / no unmapped banner. Análisis renders its **own** period selector + the OneTable (filters chain/store/SKU/alert work, CSV/Excel export downloads, pagination works). Changing the period in Análisis re-fetches the table.
- [ ] **Banner neutral:** when seed data has unmapped products, the banner shows the count as plain text with **no** link to a coming-soon page (decision #2).
- [ ] **Parámetros CRUD:** create a SKU, edit its name/prices, rename its `skuCode` (verify it persists and existing data isn't orphaned), delete a SKU. Base prices save and round-trip.
- [ ] **Threshold validation:** entering overlapping cuts (e.g. riesgo ≤ crítico) shows an **inline** error and blocks save; a valid increasing set saves and persists on reload.
- [ ] **Importer round-trip:** export the catalog, re-import the same file → no duplicate SKUs, prices intact (empty-cell non-destruction visible); import an Excel without a `Código` column → new-catalog warning appears.
- [ ] **Integration regression:** after editing thresholds in Parámetros, the Dashboard "SKUs con alerta activa" KPI and the Análisis alert column reflect the new cuts (closes the loop B2→B3). **If the KPI does NOT change after saving new thresholds, do NOT file a bug yet — first rule out caching:** force a hard refresh (Cmd-Shift-R), and check whether the data path is cached (Next RSC payload cache, any `unstable_cache`/`revalidate` on the KPI/threshold fetch, or stale browser-side hook state that needs a refetch). Only after a hard refresh still shows stale cuts is it a real regression. (Thresholds are loaded once per request server-side via `getThresholdCuts`, so a missing revalidation/refetch is the likeliest false alarm.)

When all boxes pass, the gate is approved by the user. Record any defects as follow-ups; do not mark B3 complete on green CI alone.

---

## B4 follow-ups (explicit, created by B3 decisions)

- **Re-point the unmapped banner to Portales** (decision #2): once Portales has the unmapped/conflict resolution UI (§3.2/§8.4), restore an actionable link from the banner to `/portales`. This is a concrete B4 task, not optional polish.
- **Move the upload UI** from Análisis to the per-chain Portales cards (§2/§3.2.4) — B4.

---

## Verification summary (per task)

Every task ends with: `pnpm typecheck`, the relevant `pnpm test` (or `pnpm vitest run <path>` for TDD tasks), the 3 supply-chain commands, and a focused commit. Task 7 adds the human visual gate. No task is "done" with a red typecheck, a red test, or an un-run supply-chain check.
