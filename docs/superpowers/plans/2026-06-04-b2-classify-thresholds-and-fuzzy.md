# B2 — Classify/Threshold Refactor + Fuzzy Matching Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the two independent Fase 2 foundations of block B2: (Pieza A) make `classifyAlert` take its threshold cuts as a required parameter and thread a per-request `ThresholdConfig` (with a `DEFAULT_CUTS` fallback) through the three KPI queries that classify — including templatizing the one inline threshold in the KPI4 SQL with `Prisma.sql` parametric interpolation (§4.8); and (Pieza B) build a pure own-implementation fuzzy-matching module in `core/fuzzy/` (token-set-ratio × weight-penalty guard, code detector, three bands) plus deterministic Vitest tests and a parameterized calibration harness (§5).

**Architecture:** Two fully independent units that share no files.

- **Pieza A is ONE atomic commit.** Changing `classifyAlert`'s signature breaks `core/kpis/queries.ts` (3 call sites) at typecheck; changing those query signatures breaks the two dashboard routes; changing `classify.test.ts`/`queries.test.ts` is forced by the same signature. There is no green intermediate state, so the signature change, the `lib/thresholds.ts` adapter, the SQL templatization, the route wiring, and all test updates land together (same pattern as B1 Task 1).

- **Pieza B is a set of TDD-clean, separately-committable pure modules.** Each `core/fuzzy/*` file is a pure function with no Next/Prisma import, so each (module + test) pair is its own green commit. The `scripts/calibrate-fuzzy.ts` harness is a tool, not production code; it is verified by running it, not by a unit test. **Integration of the fuzzy module into the parse/normalize pipeline is B4, NOT B2** — B2 only builds and unit-tests the primitives + produces PROVISIONAL calibrated cuts.

**Tech Stack:** TypeScript, Prisma 6.19.3 + Postgres (Neon local / `postgres:16` in CI), Vitest, `xlsx` 0.18.5 + `tsx` 4.19.2 (both already present), pnpm 10.26.1 (`--ignore-scripts`, exact pins — Mini Shai-Hulud protocol).

**Source spec:** `docs/specs/onetable-fase2-spec.md` is the design source of truth (§4.8 classify/threshold refactor, §5 fuzzy, §14 real VIKS edge cases, §12 block B2). Defer to it on any ambiguity. No new design doc — the spec is the design.

**Calibration honesty (carry into Pieza B):** with Amazon skipped by the code detector (§5.4) and Chedraui barely pre-filled, the calibration runs effectively only over Soriana, and HEB has NO real file in the repo (only samples; the real HEB file is a B6 externally-blocked dependency). Therefore the resulting `tHigh`/`tLow` are documented as **PROVISIONAL (Soriana-derived)**, NOT final cuts. `scripts/calibrate-fuzzy.ts` is parameterized to re-run against new chains without code edits, and the fuzzy module reads cuts as a **parameter** — it never hardcodes them at a call site.

---

## Supply-chain protocol (CLAUDE.md §8 — NON-NEGOTIABLE prefix for any implementer)

B2 adds **zero new packages**. The fuzzy module is an own implementation precisely for supply-chain reasons — do NOT `pnpm add` `fuse.js` / `string-similarity` / `fuzzball` or any matching library. If a step ever requires a new package, it MUST follow CLAUDE.md §8: `pnpm add --ignore-scripts`, exact pin (no `^`/`~`), run `./scripts/check-supply-chain.sh` before+after, grep the lockfile for worm tokens, never delete `pnpm-lock.yaml`. The mandatory post-task verification (3 commands) runs at the end of every task below.

---

## Files

| Path | Action | Responsibility |
|---|---|---|
| `core/alerts/classify.ts` | Modify | Add `ThresholdCuts` type + `DEFAULT_CUTS` const; add a required 3rd `cuts` param to `classifyAlert`, replacing the hardcoded 7/14/21/60. |
| `lib/thresholds.ts` | Create | `getThresholdCuts(db, clientId)` — load the client's `ThresholdConfig`, map to `ThresholdCuts`, fall back to `DEFAULT_CUTS` when absent. |
| `core/kpis/queries.ts` | Modify | Thread `cuts: ThresholdCuts` through `getDashboardKpis` (templatize KPI4's `< 14` → `< ${cuts.riesgo}`), `getInventorySemaforo`, `getOneTableRows`. The 4 non-classifying queries are untouched. |
| `app/api/dashboard/kpis/route.ts` | Modify | Fetch cuts once per request; pass to `getDashboardKpis` + `getInventorySemaforo`. |
| `app/api/dashboard/onetable/route.ts` | Modify | Fetch cuts once per request; pass to `getOneTableRows`. |
| `tests/alerts/classify.test.ts` | Modify | Pass `DEFAULT_CUTS` to every existing case; add a custom-cuts describe block. |
| `tests/kpis/queries.test.ts` | Modify | Pass `DEFAULT_CUTS` to the 3 `getDashboardKpis` + 2 `getInventorySemaforo` calls; add a custom-cuts integration test proving SQL templatization. |
| `tests/lib/thresholds.test.ts` | Create | Integration test: custom `ThresholdConfig` → those cuts; no config → `DEFAULT_CUTS`. |
| `core/fuzzy/token-set-ratio.ts` | Create | `tokenize` + `tokenSetRatio` (Sørensen-Dice over token sets). |
| `core/fuzzy/weight.ts` | Create | `extractWeightGrams` + `weightPenalty` (hard guard demoting cross-weight matches). |
| `core/fuzzy/code-detector.ts` | Create | `isCodeLike` (ASIN/EAN) + `isMostlyCodes` (column-level skip decision). |
| `core/fuzzy/match.ts` | Create | `scoreMatch`, `FuzzyThresholds`, `PROVISIONAL_FUZZY_THRESHOLDS`, `classifyBand`, `suggestMatch`. |
| `core/fuzzy/index.ts` | Create | Barrel re-exports. |
| `tests/fuzzy/token-set-ratio.test.ts` | Create | Deterministic unit tests for tokenize + ratio. |
| `tests/fuzzy/weight.test.ts` | Create | Deterministic unit tests for extract + penalty. |
| `tests/fuzzy/code-detector.test.ts` | Create | Deterministic unit tests for code detection. |
| `tests/fuzzy/match.test.ts` | Create | Deterministic tests incl. canonical VIKS §14 cases (86g vs 20g). |
| `scripts/calibrate-fuzzy.ts` | Create | Parameterized harness: parse real files via the B1 registry, score vs catalog ground truth, print score×correctness table + suggested PROVISIONAL cuts. |

**Note for a future block (NOT B2):** wiring `suggestMatch` into normalize/upload (writing `ProductMapping.status = PENDING_REVIEW`/`CONFLICTED`, surfacing the bands in the Portales UI) is **B4** (§8). B2 stops at unit-tested primitives + a calibration output.

---

## Task 1: classify/threshold refactor + SQL templatization + route wiring (atomic)

This task is **one commit**. Adding a required 3rd param to `classifyAlert` breaks `core/kpis/queries.ts:317` and `:483` at typecheck; adding `cuts` to the three query signatures breaks both dashboard routes; the new signature breaks `tests/alerts/classify.test.ts` (2-arg calls) and `tests/kpis/queries.test.ts` (5 calls). No green intermediate exists, so all of it lands together (same shape as B1 Task 1).

**Files:**
- Modify: `core/alerts/classify.ts:10-25`
- Create: `lib/thresholds.ts`
- Modify: `core/kpis/queries.ts:2` (import), `:84-86` + `:119-135` (getDashboardKpis), `:261-263` + `:317` (getInventorySemaforo), `:432-434` + `:483` (getOneTableRows)
- Modify: `app/api/dashboard/kpis/route.ts:22-32,81-92`
- Modify: `app/api/dashboard/onetable/route.ts:18-20,49-54`
- Modify: `tests/alerts/classify.test.ts` (whole file)
- Modify: `tests/kpis/queries.test.ts:1-8` (import), `:190,209,220` (getDashboardKpis), `:276,310` (getInventorySemaforo), + new integration test
- Create: `tests/lib/thresholds.test.ts`

- [ ] **Step 1: Confirm clean starting state**

```bash
git checkout main && git pull --ff-only
git checkout -b feat/b2-classify-thresholds-and-fuzzy
git status   # working tree clean (ignoring untracked .superpowers/)
```

Expected: on branch `feat/b2-classify-thresholds-and-fuzzy`, clean tree.

- [ ] **Step 2: Add `ThresholdCuts` + `DEFAULT_CUTS` and the required `cuts` param to `classifyAlert`**

In `core/alerts/classify.ts`, after the `AlertStatus` union (line 8), add the type + default, and replace the function (lines 10-25):

```typescript
export type ThresholdCuts = {
  critico: number; // days < critico → CRITICO
  riesgo: number; // days < riesgo   → RIESGO
  atencion: number; // days < atencion → ATENCION
  exceso: number; // days <= exceso  → OK; days > exceso → EXCESO
};

// The Fase 1 hardcoded bands, now the fallback when a Client has no
// ThresholdConfig row. Matches the ThresholdConfig column defaults (spec §4.5).
export const DEFAULT_CUTS: ThresholdCuts = {
  critico: 7,
  riesgo: 14,
  atencion: 21,
  exceso: 60,
};

export function classifyAlert(
  inventoryUnits: number | null,
  daysOfInventory: number | null,
  cuts: ThresholdCuts,
): AlertStatus {
  // H1: Negative values represent accounting adjustments (returns, reconciliation
  // gaps, post-period corrections) — treated as SIN_STOCK because there is no
  // sellable stock. Spec §9.2 pseudocode says `=== 0`; this widens to `<= 0`
  // for runtime robustness against real-world data.
  if (inventoryUnits !== null && inventoryUnits <= 0) return 'SIN_STOCK';
  if (daysOfInventory === null) return 'SIN_DATOS';
  if (daysOfInventory < cuts.critico) return 'CRITICO';
  if (daysOfInventory < cuts.riesgo) return 'RIESGO';
  if (daysOfInventory < cuts.atencion) return 'ATENCION';
  if (daysOfInventory <= cuts.exceso) return 'OK';
  return 'EXCESO';
}
```

The 3rd param is **required** (no `= DEFAULT_CUTS` default) on purpose: every call site must be explicit about which cuts it used, mirroring the "no silent default" decision. Callers that want the Fase 1 behavior pass `DEFAULT_CUTS` explicitly.

- [ ] **Step 3: Create `lib/thresholds.ts` — the DB→cuts adapter**

Create `lib/thresholds.ts`:

```typescript
import type { PrismaClient } from '@prisma/client';
import { DEFAULT_CUTS, type ThresholdCuts } from '@/core/alerts/classify';

// Loads a client's ThresholdConfig and maps it to ThresholdCuts. Every Client
// gets a ThresholdConfig at signup (B1 §4.5), so the fallback is defensive —
// it covers direct DB callers / pre-B1 rows. Called ONCE per request in the
// dashboard routes; never inside a per-row loop.
export async function getThresholdCuts(
  db: PrismaClient,
  clientId: string,
): Promise<ThresholdCuts> {
  const cfg = await db.thresholdConfig.findUnique({ where: { clientId } });
  if (!cfg) return DEFAULT_CUTS;
  return {
    critico: cfg.criticoDays,
    riesgo: cfg.riesgoDays,
    atencion: cfg.atencionDays,
    exceso: cfg.excesoDays,
  };
}
```

- [ ] **Step 4: Thread `cuts` into `core/kpis/queries.ts`**

(a) Extend the classify import (line 2):

```typescript
import { classifyAlert, type AlertStatus, type ThresholdCuts } from '../alerts/classify';
```

(b) `getDashboardKpis` — add the param (lines 84-87 become):

```typescript
export async function getDashboardKpis(
  db: PrismaClient,
  params: PeriodParams,
  cuts: ThresholdCuts,
): Promise<DashboardKpis> {
```

(c) `getDashboardKpis` — templatize the KPI4 threshold. The `14` is the `riesgo` cut (the predicate counts SIN_STOCK ∪ CRITICO ∪ RIESGO = `inv <= 0` OR `days < riesgo`). Update the comment (line 119) and the `db.$queryRaw` tagged template (line 133). `${cuts.riesgo}` is auto-parameterized by Prisma's tagged template (it becomes a bound `$N` placeholder — this is the `Prisma.sql` parametric path, NOT `$queryRawUnsafe`):

```typescript
    // COUNT(DISTINCT productId) naturally excludes unmapped (productId NULL).
    // daysOfInv computed inline: inv/sales*30; comparing < cuts.riesgo covers
    // CRITICO ∪ RIESGO. cuts.riesgo is interpolated via the $queryRaw tagged
    // template → bound as a query parameter (NOT string-concatenated). §4.8.
    db.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(DISTINCT "productId")::bigint AS count
      FROM "SelloutData"
      WHERE "clientId"   = ${clientId}
        AND "userId"     = ${userId}
        AND "periodYear" = ${periodYear}
        AND "periodMonth"= ${periodMonth}
        AND "productId" IS NOT NULL
        AND (
          "inventoryUnits" <= 0
          OR (
            "salesUnits"     IS NOT NULL AND "salesUnits"     > 0
            AND "inventoryUnits" IS NOT NULL
            AND ("inventoryUnits"::float8 / "salesUnits") * 30 < ${cuts.riesgo}
          )
        )
    `,
```

(d) `getInventorySemaforo` — add the param (lines 261-264 become):

```typescript
export async function getInventorySemaforo(
  db: PrismaClient,
  params: PeriodParams,
  cuts: ThresholdCuts,
): Promise<SkuInventoryStatus[]> {
```

and pass `cuts` to the classify call (line 317):

```typescript
    const rowAlert = classifyAlert(inv, daysOfInv, cuts);
```

(e) `getOneTableRows` — add the param (lines 432-435 become):

```typescript
export async function getOneTableRows(
  db: PrismaClient,
  params: PeriodParams,
  cuts: ThresholdCuts,
): Promise<OneTableRow[]> {
```

and pass `cuts` to the classify call (line 483):

```typescript
    const alert = classifyAlert(inv, days, cuts);
```

Leave `getSalesTrend`, `getSalesByChainForPeriod`, `getTopSkusByChain`, `getDaysOfInventoryBySku` UNCHANGED — they don't classify.

- [ ] **Step 5: Wire the cuts fetch into `app/api/dashboard/kpis/route.ts`**

(a) Add the import after the queries import (after line 32):

```typescript
import { getThresholdCuts } from '@/lib/thresholds';
```

(b) After the period is resolved and `periodParams` is built (after line 82), fetch cuts once, then pass to the two classifying queries (lines 85-92 block). The empty-state early return (lines 60-76) is BEFORE this point, so the no-data path never queries cuts:

```typescript
  const cuts = await getThresholdCuts(db, clientId);

  // Six queries in parallel — independent, no shared state.
  const [kpis, trend, byChain, semaforo, topSkus, daysInv] = await Promise.all([
    getDashboardKpis(db, periodParams, cuts),
    getSalesTrend(db, { ...baseParams, monthsBack: TREND_MONTHS_BACK }),
    getSalesByChainForPeriod(db, periodParams),
    getInventorySemaforo(db, periodParams, cuts),
    getTopSkusByChain(db, { ...periodParams, limit: TOP_SKUS_LIMIT }),
    getDaysOfInventoryBySku(db, periodParams),
  ]);
```

- [ ] **Step 6: Wire the cuts fetch into `app/api/dashboard/onetable/route.ts`**

(a) Extend the import (line 20):

```typescript
import { getOneTableRows, getDefaultPeriod } from '@/core/kpis/queries';
import { getThresholdCuts } from '@/lib/thresholds';
```

(b) After the period is resolved (after line 49), fetch cuts and pass to `getOneTableRows` (lines 51-54 block). The empty-state early return (lines 40-46) is before this point:

```typescript
  const cuts = await getThresholdCuts(db, clientId);

  const [rows, unmappedCount] = await Promise.all([
    getOneTableRows(db, { clientId, userId, periodYear, periodMonth }, cuts),
    db.unmappedProduct.count({ where: { clientId, resolvedAt: null } }),
  ]);
```

- [ ] **Step 7: Rewrite `tests/alerts/classify.test.ts` for the new signature**

Replace the whole file. The existing band cases now pass `DEFAULT_CUTS`; a second describe block proves custom cuts shift the bands:

```typescript
import { describe, it, expect } from 'vitest';
import { classifyAlert, DEFAULT_CUTS, type ThresholdCuts } from '@/core/alerts/classify';

describe('classifyAlert (DEFAULT_CUTS)', () => {
  it.each([
    // inv<=0 → SIN_STOCK regardless of days
    [0, null, 'SIN_STOCK'],
    [0, 5, 'SIN_STOCK'],
    [0, 50, 'SIN_STOCK'],
    // H1: inv<0 (accounting adjustments, returns) → SIN_STOCK
    [-5, 10, 'SIN_STOCK'],
    [-1, null, 'SIN_STOCK'],
    [-100, 0, 'SIN_STOCK'],
    // days null (inv != 0) → SIN_DATOS
    [10, null, 'SIN_DATOS'],
    [null, null, 'SIN_DATOS'],
    // days < 7 → CRITICO
    [10, 0, 'CRITICO'],
    [10, 3, 'CRITICO'],
    [10, 6, 'CRITICO'],
    // 7 <= days < 14 → RIESGO
    [10, 7, 'RIESGO'],
    [10, 13, 'RIESGO'],
    // 14 <= days < 21 → ATENCION
    [10, 14, 'ATENCION'],
    [10, 20, 'ATENCION'],
    // 21 <= days <= 60 → OK
    [10, 21, 'OK'],
    [10, 30, 'OK'],
    [10, 60, 'OK'],
    // days > 60 → EXCESO
    [10, 61, 'EXCESO'],
    [10, 1000, 'EXCESO'],
  ])('inv=%s, days=%s → %s', (inv, days, expected) => {
    expect(
      classifyAlert(inv as number | null, days as number | null, DEFAULT_CUTS),
    ).toBe(expected);
  });
});

describe('classifyAlert (custom cuts shift the bands)', () => {
  // Wider riesgo: a 13-day SKU that was RIESGO under defaults stays RIESGO,
  // but an 18-day SKU that was ATENCION under defaults becomes RIESGO.
  const wide: ThresholdCuts = { critico: 7, riesgo: 30, atencion: 40, exceso: 60 };

  it.each([
    [10, 18, 'RIESGO'], // 18 < 30 → RIESGO (was ATENCION under defaults)
    [10, 35, 'ATENCION'], // 30 <= 35 < 40 → ATENCION
    [10, 50, 'OK'], // 40 <= 50 <= 60 → OK
    [10, 61, 'EXCESO'], // > exceso
    [10, 6, 'CRITICO'], // critico unchanged
  ])('wide cuts: inv=%s, days=%s → %s', (inv, days, expected) => {
    expect(
      classifyAlert(inv as number | null, days as number | null, wide),
    ).toBe(expected);
  });
});
```

- [ ] **Step 8: Update `tests/kpis/queries.test.ts` call sites + add the templatization integration test**

(a) Extend the imports (lines 1-8 block) to add `DEFAULT_CUTS`:

```typescript
import { classifyAlert, DEFAULT_CUTS } from '@/core/alerts/classify';
```

(Place it alongside the existing imports; the file already imports the query functions. If `classifyAlert` is not already imported here, import only `DEFAULT_CUTS`.)

(b) Add `DEFAULT_CUTS` as the 3rd arg to the three `getDashboardKpis` calls (lines 190, 209, 220) and the two `getInventorySemaforo` calls (lines 276, 310). Example for line 190:

```typescript
      const kpis = await getDashboardKpis(
        db,
        { clientId, userId, periodYear: 2025, periodMonth: 3 },
        DEFAULT_CUTS,
      );
```

Apply the same `, DEFAULT_CUTS` 3rd argument to the calls at 209, 220, 276, 310. Their existing expectations are unchanged (DEFAULT_CUTS == the old hardcoded bands).

(c) Add a custom-cuts integration test inside the `describe('getDashboardKpis', ...)` block (after the case ending at line 206). It proves the SQL `< ${cuts.riesgo}` templatization actually parameterizes: with `riesgo: 30`, AMAZON `productB` (inv=80, sales=100 → daysInv = 80/100*30 = 24) now satisfies `24 < 30` and joins the alerted set, raising the count from 4 to 5:

```typescript
    it('templatized KPI4 threshold: wider riesgo counts more SKUs', async () => {
      // Default riesgo=14 → alerted SKUs {A, E, F, G} = 4 (asserted above).
      // riesgo=30 additionally catches AMAZON productB: inv=80 / sales=100 * 30
      // = 24 daysInv, which is < 30 but not < 14. Proves cuts.riesgo is bound
      // into the SQL, not the old hardcoded 14.
      const wide = { critico: 7, riesgo: 30, atencion: 40, exceso: 60 };
      const kpis = await getDashboardKpis(
        db,
        { clientId, userId, periodYear: 2025, periodMonth: 3 },
        wide,
      );
      expect(kpis.activeAlertsSkuCount).toBe(5);
    });
```

- [ ] **Step 9: Create `tests/lib/thresholds.test.ts`**

Mirror the existing integration-test setup style (real `db`, unique test email, cleanup in `afterAll`). Note `lib/thresholds.ts` imports `@/core/alerts/classify`, so this also locks the `DEFAULT_CUTS` mapping:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { db } from '@/lib/db';
import { getThresholdCuts } from '@/lib/thresholds';
import { DEFAULT_CUTS } from '@/core/alerts/classify';

const TEST_EMAIL = 'b2-thresholds@test.local';

describe('getThresholdCuts', () => {
  let withCfgClientId: string;
  let noCfgClientId: string;

  beforeAll(async () => {
    await db.user.deleteMany({ where: { email: TEST_EMAIL } });
    const u = await db.user.create({ data: { email: TEST_EMAIL, passwordHash: 'x' } });

    const c1 = await db.client.create({
      data: {
        name: 'B2 WITH CFG',
        userId: u.id,
        thresholdConfig: {
          create: { criticoDays: 3, riesgoDays: 9, atencionDays: 15, excesoDays: 45 },
        },
      },
    });
    withCfgClientId = c1.id;

    // A client deliberately created WITHOUT a ThresholdConfig (defensive path).
    const c2 = await db.client.create({ data: { name: 'B2 NO CFG', userId: u.id } });
    noCfgClientId = c2.id;
  });

  afterAll(async () => {
    await db.user.deleteMany({ where: { email: TEST_EMAIL } });
    await db.$disconnect();
  });

  it('returns the configured cuts when a ThresholdConfig exists', async () => {
    const cuts = await getThresholdCuts(db, withCfgClientId);
    expect(cuts).toEqual({ critico: 3, riesgo: 9, atencion: 15, exceso: 45 });
  });

  it('falls back to DEFAULT_CUTS when no ThresholdConfig exists', async () => {
    const cuts = await getThresholdCuts(db, noCfgClientId);
    expect(cuts).toEqual(DEFAULT_CUTS);
  });
});
```

If the shared test `db` singleton is imported elsewhere as a different symbol, match the existing convention in `tests/kpis/queries.test.ts` (it constructs/imports `db` at the top — reuse that exact import).

- [ ] **Step 10: Typecheck**

```bash
pnpm typecheck
```

Expected: PASS. If it errors at `queries.ts:317`/`:483` (`Expected 3 arguments, but got 2`), Step 4d/4e wasn't applied; if at the route files, Step 5/6 wasn't applied.

- [ ] **Step 11: Run the full test suite**

```bash
pnpm test
```

Expected: green. Test count rises by the new cases: `classify.test.ts` gains the custom-cuts describe (5 `it.each` rows = 5 tests), `queries.test.ts` gains 1 integration test, `tests/lib/thresholds.test.ts` adds 2 tests. The route tests (`dashboard-kpis.test.ts`, `dashboard-onetable.test.ts`) stay green because they exercise the route, which now fetches a real `ThresholdConfig` (seeded by B1) or falls back to `DEFAULT_CUTS` — identical numbers to before. If `dashboard-kpis.test.ts` changes its `activeAlertsSkuCount`, the test client is missing its ThresholdConfig AND the fallback differs from defaults — investigate, do not "fix" by editing the expectation.

- [ ] **Step 12: Supply-chain post-task verification (CLAUDE.md §8)**

```bash
./scripts/check-supply-chain.sh
grep -E '"[\^~]' package.json && exit 1 || echo "✅ pins exact"
grep -E "tanstack|squawk|uipath|mistral|cap-js|intercom-client|router_init|setup\.mjs|router_runtime" pnpm-lock.yaml | grep -v lightningcss && exit 1 || echo "✅ lockfile clean"
```

Expected: script OK, `✅ pins exact`, `✅ lockfile clean`. (B2 added no packages; `pnpm-lock.yaml` unchanged.)

- [ ] **Step 13: Commit**

```bash
git add core/alerts/classify.ts lib/thresholds.ts core/kpis/queries.ts app/api/dashboard/kpis/route.ts app/api/dashboard/onetable/route.ts tests/alerts/classify.test.ts tests/kpis/queries.test.ts tests/lib/thresholds.test.ts
git commit -m "$(cat <<'EOF'
feat(b2): classifyAlert takes ThresholdCuts; thread per-request config

onetable-fase2-spec.md §4.8 — the alert bands stop being hardcoded.

- core/alerts/classify.ts: add ThresholdCuts type + DEFAULT_CUTS; classifyAlert
  gains a required 3rd `cuts` param replacing the inline 7/14/21/60.
- lib/thresholds.ts: getThresholdCuts(db, clientId) loads the client's
  ThresholdConfig (B1 §4.5), maps to ThresholdCuts, DEFAULT_CUTS fallback.
- core/kpis/queries.ts: thread cuts through getDashboardKpis (KPI4 SQL `< 14`
  → `< ${cuts.riesgo}`, parameterized via the $queryRaw tagged template, NOT
  $queryRawUnsafe), getInventorySemaforo, getOneTableRows.
- dashboard kpis + onetable routes: fetch cuts ONCE per request, pass down.

Tests: classify.test.ts rewritten for the 3-arg signature + custom-cuts band
cases; queries.test.ts adds a templatization integration test (riesgo=30 lifts
activeAlertsSkuCount 4→5 via AMAZON productB daysInv=24); tests/lib/thresholds
locks the config→cuts mapping + DEFAULT_CUTS fallback.
EOF
)"
```

Expected: one commit. `git status` clean.

---

## Task 2: `core/fuzzy/token-set-ratio.ts` (Sørensen-Dice over token sets)

The base similarity: lowercase, strip punctuation, split into a token SET (dedup + order-insensitive), score `(2·|A∩B|) / (|A|+|B|)`. Tokens of length 1 are dropped so single stray letters don't inflate the score.

**Files:**
- Create: `core/fuzzy/token-set-ratio.ts`
- Create: `tests/fuzzy/token-set-ratio.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/fuzzy/token-set-ratio.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { tokenize, tokenSetRatio } from '@/core/fuzzy/token-set-ratio';

describe('tokenize', () => {
  it('lowercases, strips punctuation, drops length-1 tokens, dedups', () => {
    expect([...tokenize('Carne Seca, ORIGINAL!! a')].sort()).toEqual([
      'carne',
      'original',
      'seca',
    ]);
  });

  it('keeps alphanumeric weight tokens like 86g', () => {
    expect(tokenize('Chilli Lime 86g').has('86g')).toBe(true);
  });
});

describe('tokenSetRatio', () => {
  it('returns 1 for identical token sets (order/dup-insensitive)', () => {
    expect(tokenSetRatio('carne seca original', 'original seca carne carne')).toBe(1);
  });

  it('returns 0 when either side has no usable tokens', () => {
    expect(tokenSetRatio('', 'carne seca')).toBe(0);
    expect(tokenSetRatio('a', 'carne seca')).toBe(0);
  });

  it('scores partial overlap via Sørensen-Dice', () => {
    // A={carne,seca,lime} B={carne,seca,mango} → 2*2/(3+3)=0.6667
    expect(tokenSetRatio('carne seca lime', 'carne seca mango')).toBeCloseTo(0.6667, 4);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
pnpm vitest run tests/fuzzy/token-set-ratio.test.ts
```

Expected: FAIL — `Cannot find module '@/core/fuzzy/token-set-ratio'`.

- [ ] **Step 3: Implement**

Create `core/fuzzy/token-set-ratio.ts`:

```typescript
// Pure string similarity. No Next/Prisma imports — core/ stays portable to
// the Fase 3 Python service. Own implementation (no fuzzy library) per the
// supply-chain protocol.

// Lowercase, replace every non-letter/non-number/non-space with a space, split
// on whitespace, drop length-1 noise tokens, dedup into a Set. \p{L}\p{N} with
// the u flag keeps accented letters (e.g. "jalapeño") and digits (e.g. "86g").
export function tokenize(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 1),
  );
}

// Sørensen-Dice coefficient over the two token sets: (2·|A∩B|) / (|A|+|B|).
// Returns 0 if either set is empty (no basis for comparison).
export function tokenSetRatio(a: string, b: string): number {
  const sa = tokenize(a);
  const sb = tokenize(b);
  if (sa.size === 0 || sb.size === 0) return 0;
  let intersection = 0;
  for (const t of sa) if (sb.has(t)) intersection++;
  return (2 * intersection) / (sa.size + sb.size);
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm vitest run tests/fuzzy/token-set-ratio.test.ts
```

Expected: PASS.

- [ ] **Step 5: Supply-chain post-task verification (CLAUDE.md §8)**

```bash
./scripts/check-supply-chain.sh
grep -E '"[\^~]' package.json && exit 1 || echo "✅ pins exact"
grep -E "tanstack|squawk|uipath|mistral|cap-js|intercom-client|router_init|setup\.mjs|router_runtime" pnpm-lock.yaml | grep -v lightningcss && exit 1 || echo "✅ lockfile clean"
```

Expected: script OK, `✅ pins exact`, `✅ lockfile clean`.

- [ ] **Step 6: Commit**

```bash
git add core/fuzzy/token-set-ratio.ts tests/fuzzy/token-set-ratio.test.ts
git commit -m "feat(b2): fuzzy token-set-ratio (Sørensen-Dice, own impl) §5.3"
```

---

## Task 3: `core/fuzzy/weight.ts` (weight-penalty hard guard)

The §14 reality: "Chilli Lime 86g" must NOT match "Chilli Lime 20g". Token overlap alone scores them 0.67 (same words). A multiplicative weight penalty demotes cross-weight matches so the wrong gram-size lands in the LOW band.

**Files:**
- Create: `core/fuzzy/weight.ts`
- Create: `tests/fuzzy/weight.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/fuzzy/weight.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { extractWeightGrams, weightPenalty } from '@/core/fuzzy/weight';

describe('extractWeightGrams', () => {
  it.each([
    ['Chilli Lime 86g', 86],
    ['CARNE SECA 100 GRAMOS', 100],
    ['Original 28GR', 28],
    ['Mango 20 g', 20],
    ['No weight here', null],
  ])('%s → %s', (s, expected) => {
    expect(extractWeightGrams(s)).toBe(expected);
  });
});

describe('weightPenalty', () => {
  it('is 1 when neither side has a weight', () => {
    expect(weightPenalty('carne seca', 'carne original')).toBe(1);
  });

  it('is 1 when one side has no weight (cannot penalize)', () => {
    expect(weightPenalty('carne 86g', 'carne seca')).toBe(1);
  });

  it('is 1 when both weights are equal', () => {
    expect(weightPenalty('lime 86g', 'lime 86 g')).toBe(1);
  });

  it('demotes cross-weight matches proportionally', () => {
    // |86-20|/86 = 0.767 → penalty 0.233
    expect(weightPenalty('lime 86g', 'lime 20g')).toBeCloseTo(0.2326, 3);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
pnpm vitest run tests/fuzzy/weight.test.ts
```

Expected: FAIL — `Cannot find module '@/core/fuzzy/weight'`.

- [ ] **Step 3: Implement**

Create `core/fuzzy/weight.ts`:

```typescript
// Matches an integer gram weight: digits + optional space + a gram unit.
// Covers "86g", "100 GRAMOS", "28GR", "20 g". Case-insensitive.
const WEIGHT_RE = /\b(\d{1,4})\s*(g|gr|grs|gramos?)\b/i;

export function extractWeightGrams(s: string): number | null {
  const m = s.match(WEIGHT_RE);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
}

// Multiplicative guard applied on top of the token-set ratio. Returns 1 (no
// penalty) when a weight can't be compared — either side missing, or equal.
// Otherwise scales down by the relative gram difference, clamped at 0. This is
// what keeps "86g" from matching "20g" (penalty ≈ 0.23) so the wrong size
// falls into the LOW band even though the words are identical (§5.3 / §14).
export function weightPenalty(a: string, b: string): number {
  const wa = extractWeightGrams(a);
  const wb = extractWeightGrams(b);
  if (wa === null || wb === null) return 1;
  if (wa === wb) return 1;
  return Math.max(0, 1 - Math.abs(wa - wb) / Math.max(wa, wb));
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm vitest run tests/fuzzy/weight.test.ts
```

Expected: PASS.

- [ ] **Step 5: Supply-chain post-task verification (CLAUDE.md §8)**

```bash
./scripts/check-supply-chain.sh
grep -E '"[\^~]' package.json && exit 1 || echo "✅ pins exact"
grep -E "tanstack|squawk|uipath|mistral|cap-js|intercom-client|router_init|setup\.mjs|router_runtime" pnpm-lock.yaml | grep -v lightningcss && exit 1 || echo "✅ lockfile clean"
```

Expected: script OK, `✅ pins exact`, `✅ lockfile clean`.

- [ ] **Step 6: Commit**

```bash
git add core/fuzzy/weight.ts tests/fuzzy/weight.test.ts
git commit -m "feat(b2): fuzzy weight-penalty guard (demote cross-weight) §5.3/§14"
```

---

## Task 4: `core/fuzzy/code-detector.ts` (ASIN/EAN skip decision)

§5.4: code-based portals (Amazon ASIN, La Comer EAN) should SKIP fuzzy entirely — their portal "names" are opaque codes, so token similarity is meaningless. `isCodeLike` classifies one string; `isMostlyCodes` decides at the column level (a portal column that's ≥70% codes is a code column).

**Files:**
- Create: `core/fuzzy/code-detector.ts`
- Create: `tests/fuzzy/code-detector.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/fuzzy/code-detector.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { isCodeLike, isMostlyCodes } from '@/core/fuzzy/code-detector';

describe('isCodeLike', () => {
  it.each([
    ['B07XYZ1234', true], // ASIN: 10-char uppercase alphanumeric
    ['7501234567890', true], // EAN-13: 13 digits
    ['750123456789', true], // EAN-12: 12 digits
    ['Carne Seca Original', false],
    ['86g', false],
    ['SHORT', false], // not 10 chars, not 12-14 digits
  ])('%s → %s', (s, expected) => {
    expect(isCodeLike(s)).toBe(expected);
  });
});

describe('isMostlyCodes', () => {
  it('true when ≥70% of the column is code-like', () => {
    expect(isMostlyCodes(['B07XYZ1234', 'B07AAA1111', 'B07BBB2222', 'Some Name'])).toBe(true);
  });

  it('false for a column of product names', () => {
    expect(isMostlyCodes(['Carne Seca Original', 'Chilli Lime 86g', 'Mango 20g'])).toBe(false);
  });

  it('false for an empty column', () => {
    expect(isMostlyCodes([])).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
pnpm vitest run tests/fuzzy/code-detector.test.ts
```

Expected: FAIL — `Cannot find module '@/core/fuzzy/code-detector'`.

- [ ] **Step 3: Implement**

Create `core/fuzzy/code-detector.ts`:

```typescript
// ASIN: exactly 10 uppercase letters/digits (Amazon). EAN/UPC: 12-14 digits.
// Kept strict (uppercase-only ASIN) so a lowercase 10-letter product word does
// not register as a code. False positives on a single cell don't matter — the
// skip decision is made at the column level by isMostlyCodes.
const ASIN_RE = /^[A-Z0-9]{10}$/;
const EAN_RE = /^\d{12,14}$/;

export function isCodeLike(s: string): boolean {
  const t = s.trim();
  return ASIN_RE.test(t) || EAN_RE.test(t);
}

// Column-level decision: is this portal column code-based (→ skip fuzzy, §5.4)?
// Default threshold 0.7 tolerates a few stray human-entered names in an
// otherwise code column. Empty column → false (nothing to skip).
export function isMostlyCodes(strings: string[], threshold = 0.7): boolean {
  if (strings.length === 0) return false;
  const codeCount = strings.filter(isCodeLike).length;
  return codeCount / strings.length >= threshold;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm vitest run tests/fuzzy/code-detector.test.ts
```

Expected: PASS.

- [ ] **Step 5: Supply-chain post-task verification (CLAUDE.md §8)**

```bash
./scripts/check-supply-chain.sh
grep -E '"[\^~]' package.json && exit 1 || echo "✅ pins exact"
grep -E "tanstack|squawk|uipath|mistral|cap-js|intercom-client|router_init|setup\.mjs|router_runtime" pnpm-lock.yaml | grep -v lightningcss && exit 1 || echo "✅ lockfile clean"
```

Expected: script OK, `✅ pins exact`, `✅ lockfile clean`.

- [ ] **Step 6: Commit**

```bash
git add core/fuzzy/code-detector.ts tests/fuzzy/code-detector.test.ts
git commit -m "feat(b2): fuzzy code detector (ASIN/EAN column skip) §5.4"
```

---

## Task 5: `core/fuzzy/match.ts` + `index.ts` (score, bands, suggestMatch)

Combines the primitives: `scoreMatch = tokenSetRatio × weightPenalty`; three bands from a `FuzzyThresholds` parameter (high → CONFIRMED on accept, medium → required review, low → manual); `suggestMatch` picks the best catalog entry. The thresholds are a **parameter** — `PROVISIONAL_FUZZY_THRESHOLDS` is exported as a starting point but is explicitly NOT hardcoded into the scoring path. Includes the canonical §14 VIKS cases.

**Files:**
- Create: `core/fuzzy/match.ts`
- Create: `core/fuzzy/index.ts`
- Create: `tests/fuzzy/match.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/fuzzy/match.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  scoreMatch,
  classifyBand,
  suggestMatch,
  PROVISIONAL_FUZZY_THRESHOLDS,
  type CatalogEntry,
} from '@/core/fuzzy/match';

describe('scoreMatch', () => {
  it('is tokenSetRatio × weightPenalty', () => {
    // identical words, identical weight → 1 × 1
    expect(scoreMatch('chilli lime 86g', 'chilli lime 86g')).toBe(1);
  });

  it('demotes the §14 cross-weight case (86g vs 20g)', () => {
    // tokenSetRatio({chilli,lime,86g},{chilli,lime,20g}) = 2*2/6 = 0.6667
    // weightPenalty = 0.2326 → score ≈ 0.1551
    expect(scoreMatch('chilli lime 86g', 'chilli lime 20g')).toBeCloseTo(0.1551, 3);
  });
});

describe('classifyBand', () => {
  const t = { tHigh: 0.7, tLow: 0.3 };
  it.each([
    [0.95, 'high'],
    [0.7, 'high'],
    [0.5, 'medium'],
    [0.3, 'medium'],
    [0.155, 'low'],
    [0, 'low'],
  ])('score=%s → %s', (score, band) => {
    expect(classifyBand(score as number, t)).toBe(band);
  });
});

describe('suggestMatch', () => {
  const catalog: CatalogEntry[] = [
    { productId: 'p86', nameStandard: 'Chilli Lime 86g' },
    { productId: 'p20', nameStandard: 'Chilli Lime 20g' },
    { productId: 'pman', nameStandard: 'Mango Habanero 86g' },
  ];

  it('picks the correct weight variant (86g portal → 86g SKU, high band)', () => {
    const r = suggestMatch('CHILLI LIME 86G', catalog, PROVISIONAL_FUZZY_THRESHOLDS);
    expect(r.productId).toBe('p86');
    expect(r.band).toBe('high');
  });

  it('the wrong-weight twin lands in the LOW band as the runner-up logic', () => {
    // Against a catalog that only has the 20g twin, the 86g portal string is
    // demoted to low (not silently confirmed).
    const r = suggestMatch('CHILLI LIME 86G', [{ productId: 'p20', nameStandard: 'Chilli Lime 20g' }], PROVISIONAL_FUZZY_THRESHOLDS);
    expect(r.productId).toBe('p20');
    expect(r.band).toBe('low');
  });

  it('returns a low/empty suggestion for an empty catalog', () => {
    const r = suggestMatch('anything', [], PROVISIONAL_FUZZY_THRESHOLDS);
    expect(r.productId).toBeNull();
    expect(r.band).toBe('low');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
pnpm vitest run tests/fuzzy/match.test.ts
```

Expected: FAIL — `Cannot find module '@/core/fuzzy/match'`.

- [ ] **Step 3: Implement `match.ts`**

Create `core/fuzzy/match.ts`:

```typescript
import { tokenSetRatio } from './token-set-ratio';
import { weightPenalty } from './weight';

export type FuzzyThresholds = { tHigh: number; tLow: number };
export type FuzzyBand = 'high' | 'medium' | 'low';

// PROVISIONAL — derived effectively from Soriana alone (Amazon is code-skipped
// by the detector §5.4, Chedraui is barely pre-filled, HEB has NO real file in
// the repo until B6). Re-generate with scripts/calibrate-fuzzy.ts when new
// chains get real files. These are a STARTING POINT passed as a parameter; the
// scoring path never hardcodes them. (spec §5.6)
export const PROVISIONAL_FUZZY_THRESHOLDS: FuzzyThresholds = { tHigh: 0.7, tLow: 0.3 };

export type CatalogEntry = { productId: string; nameStandard: string };

export type FuzzySuggestion = {
  productId: string | null;
  nameStandard: string | null;
  score: number;
  band: FuzzyBand;
};

// Combined score: token similarity gated by the weight-penalty guard. A perfect
// word match with a wrong gram size scores low (§14).
export function scoreMatch(a: string, b: string): number {
  return tokenSetRatio(a, b) * weightPenalty(a, b);
}

export function classifyBand(score: number, thresholds: FuzzyThresholds): FuzzyBand {
  if (score >= thresholds.tHigh) return 'high';
  if (score >= thresholds.tLow) return 'medium';
  return 'low';
}

// Best catalog entry for a portal string. Caller decides what to do per band
// (high → CONFIRMED on accept, medium → required review, low → manual). The
// catalog is assumed already filtered to this client; code-based columns are
// skipped upstream via isMostlyCodes (§5.4) before calling this.
export function suggestMatch(
  portalString: string,
  catalog: CatalogEntry[],
  thresholds: FuzzyThresholds,
): FuzzySuggestion {
  let best: CatalogEntry | null = null;
  let bestScore = -1;
  for (const entry of catalog) {
    const s = scoreMatch(portalString, entry.nameStandard);
    if (s > bestScore) {
      bestScore = s;
      best = entry;
    }
  }
  if (best === null) {
    return { productId: null, nameStandard: null, score: 0, band: 'low' };
  }
  return {
    productId: best.productId,
    nameStandard: best.nameStandard,
    score: bestScore,
    band: classifyBand(bestScore, thresholds),
  };
}
```

- [ ] **Step 4: Implement the barrel `index.ts`**

Create `core/fuzzy/index.ts`:

```typescript
export * from './token-set-ratio';
export * from './weight';
export * from './code-detector';
export * from './match';
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
pnpm vitest run tests/fuzzy/match.test.ts
```

Expected: PASS. (If the 86g-vs-20g score assertion fails, re-derive: ratio 0.6667 × penalty 0.2326 = 0.1551 — a mismatch means `tokenize` is dropping or keeping the `86g`/`20g` token differently than Task 2 specified.)

- [ ] **Step 6: Typecheck (barrel + cross-module wiring)**

```bash
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 7: Supply-chain post-task verification (CLAUDE.md §8)**

```bash
./scripts/check-supply-chain.sh
grep -E '"[\^~]' package.json && exit 1 || echo "✅ pins exact"
grep -E "tanstack|squawk|uipath|mistral|cap-js|intercom-client|router_init|setup\.mjs|router_runtime" pnpm-lock.yaml | grep -v lightningcss && exit 1 || echo "✅ lockfile clean"
```

Expected: script OK, `✅ pins exact`, `✅ lockfile clean`.

- [ ] **Step 8: Commit**

```bash
git add core/fuzzy/match.ts core/fuzzy/index.ts tests/fuzzy/match.test.ts
git commit -m "$(cat <<'EOF'
feat(b2): fuzzy match scoring + 3 bands + suggestMatch §5.3/§5.5

scoreMatch = tokenSetRatio × weightPenalty; classifyBand reads a
FuzzyThresholds PARAMETER (not hardcoded). PROVISIONAL_FUZZY_THRESHOLDS
exported as a Soriana-derived starting point, regenerable via
scripts/calibrate-fuzzy.ts. Canonical §14 case covered: Chilli Lime 86g
vs 20g scores ≈0.155 → LOW band, never silently confirmed.
EOF
)"
```

---

## Task 6: `scripts/calibrate-fuzzy.ts` (parameterized PROVISIONAL-cuts harness)

A tool, not production code — verified by running it, not a unit test. It parses each available real portal file via the B1 registry, scores every (non-code) portal string against the catalog ground truth, and prints a score×correctness table plus a suggested `tHigh`/`tLow`. Parameterized via a `REAL_FILES` map so new chains drop in without code edits. Mirrors `scripts/preflight.ts` exactly: relative imports + pure-Node `.env.local` loading BEFORE importing `@prisma/client`-touching modules. (Note: the parsers used here are pure and don't need the DB, but we keep the env-first pattern so a future DB-backed catalog read is a one-line change.)

**Files:**
- Create: `scripts/calibrate-fuzzy.ts`

- [ ] **Step 1: Implement the harness**

Create `scripts/calibrate-fuzzy.ts`:

```typescript
/**
 * scripts/calibrate-fuzzy.ts — derive PROVISIONAL fuzzy cuts (spec §5.6).
 *
 * Reads the catalog (ground truth: each VIKS standard name + its verbatim
 * per-chain portal strings) and each available REAL portal file, parses the
 * portal file via the B1 registry, skips code-like strings (§5.4), scores every
 * remaining portal string against the catalog, and reports:
 *   - a per-row table: portalString | bestMatch | score | correct?
 *   - the score distribution of CORRECT vs INCORRECT best-matches
 *   - a suggested (tHigh, tLow) split
 *
 * ⚠ PROVISIONAL: with Amazon code-skipped and Chedraui barely pre-filled, this
 * runs effectively over Soriana only; HEB has no real file until B6. Treat the
 * output as Soriana-derived, NOT final. Re-run with new chains by adding to
 * REAL_FILES below — no other code change needed.
 *
 * Run: pnpm tsx scripts/calibrate-fuzzy.ts
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as XLSX from 'xlsx';
import type { Chain, FileType } from '@prisma/client';

import { getParser } from '../core/parsers/registry';
import { scoreMatch, isCodeLike, type CatalogEntry } from '../core/fuzzy';

// ---- Parameterization: add a chain here to fold it into calibration ----
type RealFile = { file: string; fileType: FileType; catalogColumn: string };
const REAL_FILES: Partial<Record<Chain, RealFile>> = {
  SORIANA: { file: 'soriana-real.xlsx', fileType: 'MIXED', catalogColumn: 'SORIANA' },
  CHEDRAUI: { file: 'Chedraui-real.xlsx', fileType: 'MIXED', catalogColumn: 'CHEDRAUI' },
  AMAZON: { file: 'amazon-ventas-real.xlsx', fileType: 'VENTAS', catalogColumn: 'AMAZON' },
  // HEB: drop in when the real HEB file arrives in B6 (only samples exist today).
};

const SAMPLES_DIR = resolve(__dirname, '../docs/specs/viks-data/samples');
const CATALOG_FILE = resolve(__dirname, '../docs/specs/viks-data/catalogo-productos.xlsx');
const CATALOG_SHEET = 'Catalogo_Producto';
const STANDARD_COLUMN = 'Producto VIKS';

type GroundTruth = {
  catalog: CatalogEntry[]; // { productId: standardName-as-id, nameStandard }
  // catalogColumn -> (portalString -> standardName)
  byChainColumn: Record<string, Map<string, string>>;
};

function loadGroundTruth(): GroundTruth {
  const wb = XLSX.read(readFileSync(CATALOG_FILE), { type: 'buffer' });
  const sheet = wb.Sheets[CATALOG_SHEET];
  if (!sheet) throw new Error(`Catalog sheet "${CATALOG_SHEET}" not found`);
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });

  const catalog: CatalogEntry[] = [];
  const byChainColumn: Record<string, Map<string, string>> = {};
  for (const cfg of Object.values(REAL_FILES)) {
    byChainColumn[cfg!.catalogColumn] = new Map();
  }

  for (const row of rows) {
    const std = String(row[STANDARD_COLUMN] ?? '').trim();
    if (!std) continue;
    catalog.push({ productId: std, nameStandard: std });
    for (const col of Object.keys(byChainColumn)) {
      const v = row[col];
      if (v === null || v === undefined || String(v).trim() === '') continue;
      byChainColumn[col].set(String(v).trim(), std);
    }
  }
  return { catalog, byChainColumn };
}

type ScoredRow = { portalString: string; best: string; score: number; correct: boolean };

async function calibrateChain(
  chain: Chain,
  cfg: RealFile,
  gt: GroundTruth,
): Promise<ScoredRow[]> {
  const parser = getParser(chain, cfg.fileType);
  if (!parser) {
    console.warn(`  no parser for ${chain}/${cfg.fileType} — skipping`);
    return [];
  }
  const buffer = readFileSync(resolve(SAMPLES_DIR, cfg.file));
  const parsed = await parser.parse({ buffer, fileType: cfg.fileType, originalFilename: cfg.file });

  const truthMap = gt.byChainColumn[cfg.catalogColumn] ?? new Map<string, string>();
  const seen = new Set<string>();
  const scored: ScoredRow[] = [];

  for (const r of parsed.rows) {
    const portalString = r.portalRawProduct.trim();
    if (!portalString || seen.has(portalString)) continue;
    seen.add(portalString);
    if (isCodeLike(portalString)) continue; // §5.4: code columns skip fuzzy

    let best = '';
    let bestScore = -1;
    for (const entry of gt.catalog) {
      const s = scoreMatch(portalString, entry.nameStandard);
      if (s > bestScore) {
        bestScore = s;
        best = entry.nameStandard;
      }
    }
    const expected = truthMap.get(portalString) ?? null;
    scored.push({
      portalString,
      best,
      score: bestScore,
      // Only judged when ground truth exists for this portal string.
      correct: expected !== null && best === expected,
    });
  }
  return scored;
}

function suggestCuts(rows: ScoredRow[]): { tHigh: number; tLow: number } {
  const judged = rows.filter((r) => r.score >= 0);
  const correct = judged.filter((r) => r.correct).map((r) => r.score).sort((a, b) => a - b);
  const incorrect = judged.filter((r) => !r.correct).map((r) => r.score).sort((a, b) => a - b);
  // tHigh: a score at/above which correct dominates — use the 10th percentile of
  // correct scores. tLow: the 90th percentile of incorrect scores. Both are
  // heuristic starting points for a human to eyeball against the table.
  const pct = (xs: number[], p: number): number =>
    xs.length === 0 ? NaN : xs[Math.min(xs.length - 1, Math.floor(p * xs.length))];
  return {
    tHigh: Number(pct(correct, 0.1).toFixed(3)),
    tLow: Number(pct(incorrect, 0.9).toFixed(3)),
  };
}

async function main(): Promise<void> {
  const gt = loadGroundTruth();
  const all: ScoredRow[] = [];

  for (const [chain, cfg] of Object.entries(REAL_FILES) as Array<[Chain, RealFile]>) {
    console.log(`\n=== ${chain} (${cfg.file}) ===`);
    const scored = await calibrateChain(chain, cfg, gt);
    const judged = scored.filter((r) => r.score >= 0);
    for (const r of judged.slice(0, 40)) {
      console.log(
        `  ${r.score.toFixed(3)}  ${r.correct ? 'OK ' : 'XX '} ${r.portalString.slice(0, 40).padEnd(40)} -> ${r.best.slice(0, 40)}`,
      );
    }
    console.log(`  rows scored: ${judged.length}`);
    all.push(...scored);
  }

  const cuts = suggestCuts(all);
  console.log('\n=== SUGGESTED PROVISIONAL CUTS (Soriana-derived, NOT final) ===');
  console.log(`  tHigh ≈ ${cuts.tHigh}   tLow ≈ ${cuts.tLow}`);
  console.log('  Eyeball these against the table above before adopting. Re-run');
  console.log('  with new chains via the REAL_FILES map. (spec §5.6)');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

> **Implementer note (names verified in-session against real code/data — do NOT re-derive):**
> - `core/parsers/types.ts`: `ParserResult.rows: ParsedRow[]`, `ParsedRow.portalRawProduct: string` (required). The `parsed.rows` / `r.portalRawProduct` access above is correct as written.
> - `docs/specs/viks-data/catalogo-productos.xlsx`: sheet `Catalogo_Producto`; standard column `Producto VIKS`; chain headers verbatim `AL SUPER | AMAZON | CHEDRAUI | HEB | LA COMER | SORIANA` (plus non-enabled chains). The three `catalogColumn` values used here (`SORIANA`/`CHEDRAUI`/`AMAZON`) are exact matches — no uppercasing/space-normalization needed.
> - Reality check: the catalog is sparse (e.g. row "Chilli Lime 100g" has only `AL SUPER` filled). Many SORIANA/AMAZON/CHEDRAUI cells are null — the harness skips empty cells; this is the documented PROVISIONAL/Soriana-thin calibration, not a bug.

- [ ] **Step 2: Run the harness against the real files**

```bash
pnpm tsx scripts/calibrate-fuzzy.ts
```

Expected: a per-chain table of `score OK/XX portalString -> bestMatch` and a final `tHigh ≈ … tLow ≈ …` line. This is exploratory output — it does NOT gate; the goal is a sane PROVISIONAL split (Soriana correct-matches clustering high, mismatches low). If `parsed.rows`/`portalRawProduct` throws, apply the implementer note's field fix. If Amazon prints "rows scored: 0", that's expected — its strings are ASINs, code-skipped by design.

- [ ] **Step 3: Record the observed PROVISIONAL cuts (no code change)**

If the harness's suggested `tHigh`/`tLow` differ materially from `PROVISIONAL_FUZZY_THRESHOLDS` (0.7 / 0.3) in `core/fuzzy/match.ts`, do NOT silently edit the constant. The constant is a documented starting point; updating it is a judgment call for the human reviewer (the cuts are PROVISIONAL/Soriana-only). Note the observed values in the PR description for review.

- [ ] **Step 4: Typecheck**

```bash
pnpm typecheck
```

Expected: PASS (the script is included in the tsc project).

- [ ] **Step 5: Supply-chain post-task verification (CLAUDE.md §8)**

```bash
./scripts/check-supply-chain.sh
grep -E '"[\^~]' package.json && exit 1 || echo "✅ pins exact"
grep -E "tanstack|squawk|uipath|mistral|cap-js|intercom-client|router_init|setup\.mjs|router_runtime" pnpm-lock.yaml | grep -v lightningcss && exit 1 || echo "✅ lockfile clean"
```

Expected: script OK, `✅ pins exact`, `✅ lockfile clean`.

- [ ] **Step 6: Commit**

```bash
git add scripts/calibrate-fuzzy.ts
git commit -m "$(cat <<'EOF'
feat(b2): parameterized fuzzy calibration harness §5.6

Parses real portal files via the B1 registry, scores against catalog ground
truth, prints score×correctness + suggested PROVISIONAL cuts. Parameterized
via REAL_FILES so new chains drop in without code edits. Documented as
Soriana-derived (Amazon code-skipped, Chedraui sparse, HEB B6-blocked).
EOF
)"
```

---

## Task 7: Open the B2 PR

**Files:** None (remote).

- [ ] **Step 1: Push and open the PR (CI is the close criterion)**

```bash
git push -u origin feat/b2-classify-thresholds-and-fuzzy
gh pr create --title "feat(b2): classify/threshold refactor + fuzzy matching module" --body "$(cat <<'EOF'
## Summary

Block B2 of Fase 2 (onetable-fase2-spec.md §4.8, §5, §12) — two independent foundations.

**Pieza A — classify/threshold refactor (§4.8):**
- classifyAlert takes a required ThresholdCuts param (DEFAULT_CUTS fallback).
- lib/thresholds.ts loads per-Client ThresholdConfig → cuts.
- KPI4 SQL threshold templatized (< 14 → < ${cuts.riesgo}) via the $queryRaw
  tagged template (parameterized, NOT $queryRawUnsafe).
- Dashboard kpis + onetable routes fetch cuts once per request.

**Pieza B — own-implementation fuzzy module (§5):**
- core/fuzzy: token-set-ratio (Sørensen-Dice), weight-penalty guard, ASIN/EAN
  code detector, scoreMatch + 3 bands + suggestMatch. No fuzzy library
  (supply-chain). Thresholds are a PARAMETER, not hardcoded.
- scripts/calibrate-fuzzy.ts: parameterized harness producing PROVISIONAL,
  Soriana-derived cuts (Amazon code-skipped, Chedraui sparse, HEB B6-blocked).

Pipeline integration of the fuzzy module is B4, NOT this PR.

## Calibration honesty
The PROVISIONAL_FUZZY_THRESHOLDS (0.7 / 0.3) are Soriana-derived starting points,
not final cuts. Observed harness output: <fill in tHigh/tLow from Task 6 Step 2-3>.

## Test plan
- [ ] CI (the B0 \`ci\` check) is green: typecheck, build, full suite.
- [ ] classify.test.ts: DEFAULT_CUTS band cases + custom-cuts cases pass.
- [ ] queries.test.ts: templatization integration test (riesgo=30 → count 4→5) passes.
- [ ] tests/lib/thresholds.test.ts: config→cuts + DEFAULT_CUTS fallback pass.
- [ ] tests/fuzzy/*: token-set-ratio, weight, code-detector, match all green incl. §14 86g/20g.
- [ ] \`pnpm tsx scripts/calibrate-fuzzy.ts\` runs and prints a sane Soriana split.
EOF
)"
```

- [ ] **Step 2: Watch CI to green, then it's mergeable**

```bash
gh pr checks --watch
```

Expected: the `ci` check passes (B0 branch protection requires it before merge). **Close criterion for B2: CI green.** If CI fails, debug per the failed step; do not merge red.

---

## Self-review

**Spec coverage (`onetable-fase2-spec.md`):**

| Spec section | Covered |
|---|---|
| §4.8 classifyAlert refactor (cuts param) | Task 1 Step 2 |
| §4.8 SQL templatization (parametric, not Unsafe) | Task 1 Step 4c |
| §4.8 load ThresholdConfig 1× per request | Task 1 Steps 3, 5, 6 |
| §5.3 token-set-ratio + weight penalty | Tasks 2, 3 |
| §5.4 code detector (skip ASIN/EAN columns) | Task 4 |
| §5.5 three bands + suggestMatch | Task 5 |
| §5.6 calibration (parameterized, PROVISIONAL) | Task 6 |
| §5.7 Chedraui sparse acknowledgement | Task 6 docstring + PR body |
| §14 real VIKS edge cases (86g vs 20g) | Task 3 + Task 5 tests |
| §12 B2 close criterion (CI green) | Task 7 |
| CLAUDE.md §8 supply chain | post-task verification every task |

**Not in B2 (correctly deferred):** wiring `suggestMatch` into normalize/upload + `ProductMapping.status` transitions + Portales conflict UI (§8 → B4); adopting the harness's cuts as the live default (human decision, PR review); HEB real-file calibration (B6, externally blocked).

**Placeholder scan:** No TBD/TODO/"implement later". Every code step shows the exact code. The only runtime fill-in is the PR body's observed `tHigh/tLow` line (Task 6 produces those numbers at runtime — they can't be known before executing). The four harness names Task 6 depends on (`parsed.rows`/`portalRawProduct`, sheet `Catalogo_Producto`, column `Producto VIKS`, chain headers `SORIANA/CHEDRAUI/AMAZON`) were **verified in-session against `core/parsers/types.ts` and `catalogo-productos.xlsx`** and baked into Task 6's implementer note as confirmed facts.

**Fixture arithmetic verified (Task 1 Step 8c):** against the real `tests/kpis/queries.test.ts` 2025-03 fixtures, default `riesgo=14` alerts {A,E,F,G}=4 (matches the existing assertion); `riesgo=30` adds exactly product B (AMAZON row inv=80/sales=100 → daysInv=24, the only SKU with days in (14,30]) → 5. The 4→5 case is empirically sound, not assumed.

**Type/name consistency:** `ThresholdCuts` (`critico/riesgo/atencion/exceso`) consistent across `classify.ts`, `lib/thresholds.ts`, `queries.ts`, and all tests. `DEFAULT_CUTS` used as the explicit 3rd arg in `classify.test.ts` + `queries.test.ts`. `cuts: ThresholdCuts` is the 3rd param on all three threaded queries (`getDashboardKpis`, `getInventorySemaforo`, `getOneTableRows`) and the route calls match. `FuzzyThresholds` (`tHigh/tLow`) consistent across `match.ts` + `match.test.ts` + `calibrate-fuzzy.ts`; `scoreMatch`/`classifyBand`/`suggestMatch`/`CatalogEntry`/`isCodeLike` names consistent between `core/fuzzy/match.ts`, the barrel `index.ts`, and both consumers. The custom-cuts arithmetic is internally consistent: AMAZON `productB` (inv=80, sales=100) → daysInv 24, counted only when `riesgo > 24` (the test uses 30), lifting `activeAlertsSkuCount` 4→5.

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-04-b2-classify-thresholds-and-fuzzy.md`. Two execution options:

**1. Subagent-Driven (recommended)** — a fresh subagent per task with two-stage review (spec compliance + code quality) between tasks, per CLAUDE.md "modo de trabajo". Task 1 is the high-blast-radius atomic one (signature change rippling through queries + routes + tests); independent review catches drift early. Tasks 2-6 are small TDD-clean units ideal for fast per-task iteration.

**2. Inline Execution** — execute in this session via `superpowers:executing-plans`, with checkpoints. Better continuity for iterating on the calibration harness output (Task 6) in one sitting.

Which approach?
