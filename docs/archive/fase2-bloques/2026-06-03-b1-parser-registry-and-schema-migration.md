# B1 — Parser Registry + Schema Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the Fase 2 schema delta (§4.2–§4.5: `skuCode` + base prices on `Product`, `ProductPriceOverride`, `ThresholdConfig`, `ProductMapping.status` + partial unique index) with all mechanical call-site fixes, and build the `(chain, fileType) → PortalParser` registry that §11.3 left undone — leaving the 89-test suite green.

**Architecture:** Two independent, separately-committable units. (1) An atomic schema-migration commit: edit `schema.prisma`, generate the migration with `--create-only`, hand-edit the SQL to add a partial unique index (same flow as Fase 1's `NULLS NOT DISTINCT`), then fix every call site the delta breaks (`core/catalog/import.ts`, signup + seed `Client` creation, test fixtures) so typecheck + tests pass in one green commit. (2) A TDD'd parser registry keyed by `(chain, fileType)` extracted from the inline regex in the upload route; filename detection stays in the route until B4 moves upload to per-card.

**Tech Stack:** Prisma 6.19.3 + Postgres (Neon local / postgres:16 in CI), TypeScript, Vitest, pnpm 10.26.1 (`--ignore-scripts`, exact pins — Mini Shai-Hulud protocol).

**Source spec:** `docs/specs/onetable-fase2-spec.md` is the design source of truth (§4, §11.3, §12 block B1). Defer to it on any ambiguity. No new design doc — the spec is the design.

---

## Supply-chain protocol (CLAUDE.md §8 — NON-NEGOTIABLE prefix for any implementer)

B1 adds **zero new packages**. No `pnpm add` is expected. If a step ever requires one, it MUST follow CLAUDE.md §8: `pnpm add --ignore-scripts`, exact pin (no `^`/`~`), run `./scripts/check-supply-chain.sh` before+after, grep the lockfile for worm tokens, never delete `pnpm-lock.yaml`. The mandatory post-task verification (3 commands) runs at the end of every task below.

---

## Files

| Path | Action | Responsibility |
|---|---|---|
| `prisma/schema.prisma` | Modify | Add `skuCode`+prices+`overrides` to `Product`; swap `Product` unique; add `MappingStatus`+`status`+index to `ProductMapping`; add `ProductPriceOverride`; add `ThresholdConfig`; add `thresholdConfig` back-relation to `Client`. |
| `prisma/migrations/<ts>_fase2_b1_schema/migration.sql` | Create (generated, then hand-edit) | The migration. Hand-append the `ProductMapping` partial unique index (Prisma can't generate partial indexes). |
| `prisma/migrations/README.md` | Create | Document the hand-edited partial index so a future `migrate dev` doesn't regenerate/drop it. |
| `core/catalog/import.ts` | Modify | Generate `skuCode` on `product.create`; swap `findUnique({ clientId_nameStandard })` → `findFirst`. Seed-only code; contract unchanged (§10.1). |
| `app/api/auth/signup/route.ts` | Modify | Nested-create a default `ThresholdConfig` with the `Client` (§4.5 lifecycle). |
| `scripts/seed.ts` | Modify | Nested-create a default `ThresholdConfig` with the VIKS `Client`. |
| `tests/kpis/queries.test.ts` | Modify | Add `skuCode` to 7 `product.create` fixtures. |
| `tests/api/dashboard-onetable.test.ts` | Modify | Add `skuCode` to 1 `product.create` fixture. |
| `tests/api/dashboard-kpis.test.ts` | Modify | Add `skuCode` to 1 `product.create` fixture. |
| `tests/normalizer/batch.test.ts` | Modify | Add `skuCode` to 1 `product.create` fixture. |
| `tests/api/signup.test.ts` | Modify | Add an assertion that signup creates the default `ThresholdConfig` (locks the §4.5 invariant). |
| `core/parsers/registry.ts` | Create | `getParser(chain, fileType): PortalParser \| null`. |
| `tests/parsers/registry.test.ts` | Create | Unit test for the registry. |
| `app/api/data/upload/route.ts` | Modify | `detectUpload` returns `{ chain, fileType }`; parser selection delegates to `getParser`. Filename detection stays (moves to per-card in B4). |

**Note for a future block (NOT B1):** if B3 introduces several production `product.create` sites, centralize `skuCode` generation in a shared helper (e.g. `core/parameters/sku-code.ts`). For B1 the single production site (`import.ts`) generates inline.

---

## Task 1: Schema delta + migration + compatibility fixes (atomic)

This task is **one commit**. The schema change removes `Product`'s `clientId_nameStandard` compound key and makes `skuCode` `NOT NULL` with no Prisma `@default`, which breaks typecheck at `core/catalog/import.ts:70` and at 10 test `product.create` sites simultaneously. There is no green intermediate state, so all mechanical fixes land together. Migration is applied via `migrate reset` (§4.7) on an empty DB so the `NOT NULL` column needs no backfill default.

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<ts>_fase2_b1_schema/migration.sql` (generated + hand-edited)
- Create: `prisma/migrations/README.md`
- Modify: `core/catalog/import.ts:69-83`
- Modify: `app/api/auth/signup/route.ts:78-80`
- Modify: `scripts/seed.ts:116-118`
- Modify: `tests/kpis/queries.test.ts:81-87`, `tests/api/dashboard-onetable.test.ts:57-59`, `tests/api/dashboard-kpis.test.ts:25`, `tests/normalizer/batch.test.ts:148-150`
- Modify: `tests/api/signup.test.ts:62-73`

- [ ] **Step 1: Confirm clean starting state**

```bash
git checkout main && git pull --ff-only
git checkout -b feat/b1-schema-and-parser-registry
git status   # working tree clean (ignoring untracked .superpowers/)
```

Expected: on branch `feat/b1-schema-and-parser-registry`, clean tree.

- [ ] **Step 2: Edit `Product` in `prisma/schema.prisma`**

Replace the current `Product` model (lines 55-67) with:

```prisma
model Product {
  id                String   @id @default(cuid())
  clientId          String
  client            Client   @relation(fields: [clientId], references: [id], onDelete: Cascade)
  skuCode           String // NOT NULL — default cuid() generated in the TS layer at create time (no Prisma @default; see §4.2)
  nameStandard      String // viene de columna "Producto VIKS" del Excel
  purchasePriceBase Decimal? @db.Decimal(12, 2)
  salePriceBase     Decimal? @db.Decimal(12, 2)
  createdAt         DateTime @default(now())

  mappings    ProductMapping[]
  selloutData SelloutData[]
  overrides   ProductPriceOverride[]

  @@unique([clientId, skuCode])
  @@index([clientId])
}
```

Note: `@@unique([clientId, nameStandard])` is **removed**; `@@unique([clientId, skuCode])` added; `overrides` back-relation added.

- [ ] **Step 3: Edit `ProductMapping` in `prisma/schema.prisma`**

Add the enum just above the model, and replace the model (lines 69-83):

```prisma
enum MappingStatus {
  CONFIRMED
  PENDING_REVIEW
  CONFLICTED
}

model ProductMapping {
  id           String        @id @default(cuid())
  clientId     String
  client       Client        @relation(fields: [clientId], references: [id], onDelete: Cascade)
  productId    String
  product      Product       @relation(fields: [productId], references: [id], onDelete: Cascade)
  chain        Chain
  portalString String
  status       MappingStatus @default(CONFIRMED)
  createdAt    DateTime      @default(now())

  // @@unique([clientId, chain, portalString]) REMOVED — replaced by a hand-edited
  // partial unique index (WHERE status <> 'CONFLICTED') in the migration SQL (§4.4).
  @@index([clientId, chain])
  @@index([clientId, chain, portalString])
  @@index([productId])
}
```

- [ ] **Step 4: Add `ProductPriceOverride` + `ThresholdConfig` models**

Append after `ProductMapping`:

```prisma
model ProductPriceOverride {
  id            String   @id @default(cuid())
  productId     String
  product       Product  @relation(fields: [productId], references: [id], onDelete: Cascade)
  chain         Chain
  purchasePrice Decimal? @db.Decimal(12, 2)
  salePrice     Decimal? @db.Decimal(12, 2)
  updatedAt     DateTime @updatedAt

  @@unique([productId, chain])
  @@index([productId])
}

model ThresholdConfig {
  id           String   @id @default(cuid())
  clientId     String   @unique
  client       Client   @relation(fields: [clientId], references: [id], onDelete: Cascade)
  criticoDays  Int      @default(7)
  riesgoDays   Int      @default(14)
  atencionDays Int      @default(21)
  excesoDays   Int      @default(60)
  updatedAt    DateTime @updatedAt
}
```

- [ ] **Step 5: Add the `thresholdConfig` back-relation to `Client`**

In the `Client` model (lines 24-40), add one line to the relation block (the `overrides` relation lives on `Product`, not here — do not add it to `Client`):

```prisma
  unmappedProducts  UnmappedProduct[]
  thresholdConfig   ThresholdConfig?
```

- [ ] **Step 6: Generate the migration without applying it**

```bash
pnpm prisma migrate dev --create-only --name fase2_b1_schema
```

Expected: a new directory `prisma/migrations/<timestamp>_fase2_b1_schema/` containing `migration.sql`. It is generated but NOT applied (`--create-only`). The SQL should include: `ALTER TABLE "Product" ADD COLUMN "skuCode"...` + price columns, `DROP INDEX "Product_clientId_nameStandard_key"`, `CREATE UNIQUE INDEX "Product_clientId_skuCode_key"`, `CREATE TYPE "MappingStatus"`, `ALTER TABLE "ProductMapping" ADD COLUMN "status"`, `DROP INDEX "ProductMapping_clientId_chain_portalString_key"`, a new non-unique index on `(clientId, chain, portalString)`, and `CREATE TABLE "ProductPriceOverride"` + `"ThresholdConfig"`.

If `migrate dev --create-only` errors because the shadow DB can't be created, ensure `DATABASE_URL` points at a reachable Postgres (local Neon branch or a `postgres:16` container) and retry. Do not relax `--create-only`.

- [ ] **Step 7: Hand-edit the migration SQL — append the partial unique index**

Open the generated `prisma/migrations/<timestamp>_fase2_b1_schema/migration.sql`. Confirm it contains `DROP INDEX "ProductMapping_clientId_chain_portalString_key";`. Then append this statement to the **end** of the file (Prisma cannot express partial indexes; this is the §4.4 hand-edit, same flow as Fase 1's `NULLS NOT DISTINCT`):

```sql
-- Hand-edited (NOT generated by Prisma): partial unique index for ProductMapping.
-- Replaces the removed @@unique([clientId, chain, portalString]). CONFIRMED and
-- PENDING_REVIEW rows stay unique; CONFLICTED rows are exempt so N candidate SKUs
-- can claim the same portalString. See onetable-fase2-spec.md §4.4 / §8.
CREATE UNIQUE INDEX "ProductMapping_active_unique"
  ON "ProductMapping"("clientId", "chain", "portalString")
  WHERE "status" <> 'CONFLICTED';
```

- [ ] **Step 8: Document the hand-edited index**

Create `prisma/migrations/README.md`:

```markdown
# Migrations — hand-edited SQL

Some indexes in this project are **partial** or use **NULLS NOT DISTINCT**, which
Prisma does not generate from `schema.prisma`. They are hand-edited into the
migration SQL after `prisma migrate dev --create-only`. Do NOT regenerate or drop
them on a later `migrate dev` — if Prisma proposes dropping one of these, discard
that change.

| Index | Migration | Why hand-edited |
|---|---|---|
| `sellout_unique_idx` (`NULLS NOT DISTINCT`) | `20260518170659_init` | Postgres `NULLS NOT DISTINCT` not expressible in Prisma schema. |
| `ProductMapping_active_unique` (partial, `WHERE status <> 'CONFLICTED'`) | `fase2_b1_schema` | Partial unique index for conflict resolution (spec §4.4 / §8). |
```

- [ ] **Step 9: Fix `core/catalog/import.ts` — generate `skuCode`, drop the removed compound key**

In `core/catalog/import.ts`, add a `skuCode` generator near the top (after imports):

```typescript
import { randomUUID } from 'node:crypto';

// cuid-shaped opaque id, generated in the TS layer (schema has no @default on skuCode).
// Inline for B1's single production create site; centralize into a shared helper if
// B3 adds more production product.create sites (see plan note).
function makeSkuCode(): string {
  return `c${randomUUID().replace(/-/g, '').slice(0, 24)}`;
}
```

Replace the get-or-create block (lines 69-83) with:

```typescript
    // Get-or-create product. After §4.2 removed @@unique([clientId, nameStandard]),
    // look up by (clientId, nameStandard) via findFirst (the compound key no longer
    // exists on the generated client). On the reset+reseed path the table is empty,
    // so the "existing" branch never fires; the lookup is kept for direct callers.
    const existing = await db.product.findFirst({
      where: { clientId: input.clientId, nameStandard },
    });

    let productId: string;
    if (existing) {
      stats.productsExisting++;
      productId = existing.id;
    } else {
      const created = await db.product.create({
        data: { clientId: input.clientId, nameStandard, skuCode: makeSkuCode() },
      });
      stats.productsCreated++;
      productId = created.id;
    }
```

- [ ] **Step 10: Fix the signup endpoint — nested default `ThresholdConfig`**

In `app/api/auth/signup/route.ts`, change the nested `clients.create` (lines 78-80) so the `Client` is born with its `ThresholdConfig` in the same transaction (§4.5 invariant: every Client has a ThresholdConfig):

```typescript
        clients: {
          create: { name: clientNameRaw, thresholdConfig: { create: {} } },
        },
```

`create: {}` is valid because every `ThresholdConfig` column has a default (`criticoDays=7`, etc.) and `clientId` is set by the relation.

- [ ] **Step 11: Fix the seed — nested default `ThresholdConfig` for VIKS**

In `scripts/seed.ts`, change the `client.create` (lines 116-118) to:

```typescript
    const client = await db.client.create({
      data: { name: DEMO_CLIENT_NAME, userId: user.id, thresholdConfig: { create: {} } },
    });
```

Do NOT add base prices to the seed — out of scope for B1.

- [ ] **Step 12: Fix the 10 test `product.create` fixtures (add `skuCode`)**

`tests/kpis/queries.test.ts` lines 81-87 — give each product a distinct `skuCode` (same client → `@@unique([clientId, skuCode])` requires distinct):

```typescript
    const pA = await db.product.create({ data: { clientId, nameStandard: 'PRODUCT A', skuCode: 'SKU-A' } });
    const pB = await db.product.create({ data: { clientId, nameStandard: 'PRODUCT B', skuCode: 'SKU-B' } });
    const pC = await db.product.create({ data: { clientId, nameStandard: 'PRODUCT C', skuCode: 'SKU-C' } });
    const pD = await db.product.create({ data: { clientId, nameStandard: 'PRODUCT D', skuCode: 'SKU-D' } });
    const pE = await db.product.create({ data: { clientId, nameStandard: 'PRODUCT E', skuCode: 'SKU-E' } });
    const pF = await db.product.create({ data: { clientId, nameStandard: 'PRODUCT F', skuCode: 'SKU-F' } });
    const pG = await db.product.create({ data: { clientId, nameStandard: 'PRODUCT G', skuCode: 'SKU-G' } });
```

`tests/api/dashboard-onetable.test.ts` lines 57-59:

```typescript
    const mappedProduct = await db.product.create({
      data: { clientId, nameStandard: 'Producto Test Standard', skuCode: 'SKU-ONETABLE-1' },
    });
```

`tests/api/dashboard-kpis.test.ts` line 25:

```typescript
    const product = await db.product.create({ data: { clientId, nameStandard: 'PROD-X', skuCode: 'SKU-KPI-1' } });
```

`tests/normalizer/batch.test.ts` lines 148-150:

```typescript
    const product = await db.product.create({
      data: { clientId, nameStandard: 'TEST-MAPPED-PRODUCT', skuCode: 'SKU-BATCH-1' },
    });
```

- [ ] **Step 13: Add the `ThresholdConfig` invariant assertion to `tests/api/signup.test.ts`**

In the happy-path test (`creates User + Client atomically...`), after the existing client assertions (after line 72), add (this adds assertions to an existing `it()` — it does NOT change the 89-test count):

```typescript
    // §4.5 lifecycle: the Client is born with a default ThresholdConfig.
    const tc = await db.thresholdConfig.findUnique({
      where: { clientId: user!.clients[0].id },
    });
    expect(tc).not.toBeNull();
    expect(tc!.criticoDays).toBe(7);
    expect(tc!.riesgoDays).toBe(14);
    expect(tc!.atencionDays).toBe(21);
    expect(tc!.excesoDays).toBe(60);
```

- [ ] **Step 14: Apply the migration + reseed (empty DB → no backfill needed)**

```bash
pnpm db:reset
```

Expected: `prisma migrate reset --force` drops the DB, replays all migrations (including `fase2_b1_schema` with the hand-added partial index), then runs `scripts/seed.ts`. The seed log should show `products=15` and complete without error. If the seed fails on a `skuCode` null violation, Step 9 wasn't applied; if it fails on `thresholdConfig`, Step 11 wasn't applied.

- [ ] **Step 15: Typecheck**

```bash
pnpm typecheck
```

Expected: PASS (`prisma generate` regenerates the client with `skuCode`, `MappingStatus`, `thresholdConfig`, `ProductPriceOverride`; `tsc --noEmit` clean). If it fails at `import.ts` for `clientId_nameStandard`, Step 9 is incomplete.

- [ ] **Step 16: Run the full test suite**

```bash
pnpm test
```

Expected: **89 passed** (same count as before — Step 13 added assertions, not a new test). The `import.test.ts` duplicate test still passes: new mappings default to `CONFIRMED`, so the partial unique index still rejects the AL_SUPER `CITRUS GINGER` duplicate via `P2002` (`mappingsSkippedDuplicate === 1`). If any test fails on a missing `skuCode`, a fixture in Step 12 was missed.

- [ ] **Step 17: Supply-chain post-task verification (CLAUDE.md §8)**

```bash
./scripts/check-supply-chain.sh
grep -E '"[\^~]' package.json && exit 1 || echo "✅ pins exact"
grep -E "tanstack|squawk|uipath|mistral|cap-js|intercom-client|router_init|setup\.mjs|router_runtime" pnpm-lock.yaml | grep -v lightningcss && exit 1 || echo "✅ lockfile clean"
```

Expected: script OK, `✅ pins exact`, `✅ lockfile clean`. (B1 added no packages, so `pnpm-lock.yaml` should be unchanged.)

- [ ] **Step 18: Commit**

```bash
git add prisma/schema.prisma prisma/migrations core/catalog/import.ts app/api/auth/signup/route.ts scripts/seed.ts tests/kpis/queries.test.ts tests/api/dashboard-onetable.test.ts tests/api/dashboard-kpis.test.ts tests/normalizer/batch.test.ts tests/api/signup.test.ts
git commit -m "$(cat <<'EOF'
feat(b1): fase2 schema delta + threshold lifecycle + compat fixes

Schema (onetable-fase2-spec.md §4.2-§4.5):
- Product: add skuCode (NOT NULL, TS-generated cuid), purchasePriceBase /
  salePriceBase (Decimal 12,2), overrides relation; swap @@unique
  nameStandard -> skuCode.
- ProductMapping: add MappingStatus enum + status (default CONFIRMED);
  remove full unique, add non-unique index + hand-edited partial unique
  index (WHERE status <> 'CONFLICTED') for conflict resolution (§4.4/§8).
- New tables ProductPriceOverride, ThresholdConfig (+ Client back-relation).

Lifecycle (§4.5): default ThresholdConfig created atomically with every
Client (signup nested create + seed) so the "every Client has a
ThresholdConfig" invariant holds.

Compat fixes forced by the delta (mechanical, not refactors):
- core/catalog/import.ts: generate skuCode; findUnique(clientId_nameStandard)
  -> findFirst (compound key removed).
- 10 test product.create fixtures: add skuCode.

Migration via reset+reseed (§4.7). 89 tests green.
EOF
)"
```

Expected: one commit. `git status` clean.

---

## Task 2: Parser registry keyed by `(chain, fileType)`

Builds the registry §11.3 left undone (today the upload route hardcodes parser imports + selects via inline regex). Filename→`(chain, fileType)` detection **stays in the route** (it moves to per-card with an explicit chain in B4); this task only decouples *parser selection* from *parser wiring*. Behavior is identical, so `tests/api/upload.test.ts` stays green.

**Files:**
- Create: `core/parsers/registry.ts`
- Create: `tests/parsers/registry.test.ts`
- Modify: `app/api/data/upload/route.ts:44-74,182,210`

- [ ] **Step 1: Write the failing test**

Create `tests/parsers/registry.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { getParser } from '@/core/parsers/registry';
import { sorianaParser } from '@/core/parsers/soriana';
import { chedrauiParser } from '@/core/parsers/chedraui';
import { amazonVentasParser } from '@/core/parsers/amazon-ventas';
import { amazonInvParser } from '@/core/parsers/amazon-inv';

describe('getParser', () => {
  it('returns the right parser for each registered (chain, fileType)', () => {
    expect(getParser('SORIANA', 'MIXED')).toBe(sorianaParser);
    expect(getParser('CHEDRAUI', 'MIXED')).toBe(chedrauiParser);
    expect(getParser('AMAZON', 'VENTAS')).toBe(amazonVentasParser);
    expect(getParser('AMAZON', 'INVENTARIO')).toBe(amazonInvParser);
  });

  it('returns null for an unregistered (chain, fileType)', () => {
    // HEB / AL_SUPER / LA_COMER parsers are dropped in B6.
    expect(getParser('HEB', 'MIXED')).toBeNull();
    expect(getParser('AMAZON', 'MIXED')).toBeNull();
    expect(getParser('SORIANA', 'VENTAS')).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
pnpm vitest run tests/parsers/registry.test.ts
```

Expected: FAIL — `Cannot find module '@/core/parsers/registry'` (file doesn't exist yet).

- [ ] **Step 3: Implement the registry**

Create `core/parsers/registry.ts`:

```typescript
import type { Chain, FileType } from '@prisma/client';
import type { PortalParser } from './types';
import { sorianaParser } from './soriana';
import { chedrauiParser } from './chedraui';
import { amazonVentasParser } from './amazon-ventas';
import { amazonInvParser } from './amazon-inv';

// Keyed by `${chain}:${fileType}`. HEB / AL_SUPER / LA_COMER are added in B6
// once real sample files exist; today they intentionally return null.
const REGISTRY: Record<string, PortalParser> = {
  'SORIANA:MIXED': sorianaParser,
  'CHEDRAUI:MIXED': chedrauiParser,
  'AMAZON:VENTAS': amazonVentasParser,
  'AMAZON:INVENTARIO': amazonInvParser,
};

export function getParser(chain: Chain, fileType: FileType): PortalParser | null {
  return REGISTRY[`${chain}:${fileType}`] ?? null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
pnpm vitest run tests/parsers/registry.test.ts
```

Expected: PASS (5 assertions, 2 tests).

- [ ] **Step 5: Refactor the upload route to use the registry**

In `app/api/data/upload/route.ts`:

(a) Replace the four parser imports + the `PortalParser` import (lines 44-48) with a single registry import:

```typescript
import { getParser } from '@/core/parsers/registry';
```

(b) Change the `DetectedUpload` type and `detectUpload` so detection returns only `{ chain, fileType }` (filename logic unchanged) — replace lines 55-74:

```typescript
type DetectedUpload = { chain: Chain; fileType: FileType };

function detectUpload(filename: string): DetectedUpload | null {
  const lower = filename.toLowerCase();
  // Amazon ventas/inv must come BEFORE the generic amazon check; ventas is
  // most-specific so we test it first.
  if (/amazon.*ventas/.test(lower)) {
    return { chain: 'AMAZON', fileType: 'VENTAS' };
  }
  if (/amazon.*inv/.test(lower)) {
    return { chain: 'AMAZON', fileType: 'INVENTARIO' };
  }
  if (/soriana/.test(lower)) {
    return { chain: 'SORIANA', fileType: 'MIXED' };
  }
  if (/chedraui/.test(lower)) {
    return { chain: 'CHEDRAUI', fileType: 'MIXED' };
  }
  return null;
}
```

(c) In `processOneFile`, after the `detectUpload` null-check (after line 189), resolve the parser via the registry and bail if unregistered; then call `parser.parse` instead of `detected.parser.parse` (line 210):

```typescript
  const parser = getParser(detected.chain, detected.fileType);
  if (!parser) {
    return {
      filename: file.name,
      error: `no parser registered for ${detected.chain}/${detected.fileType}`,
    };
  }
```

And change the parse call (was `detected.parser.parse(...)`):

```typescript
    const parsed = await parser.parse({
      buffer,
      fileType: detected.fileType,
      originalFilename: file.name,
    });
```

- [ ] **Step 6: Typecheck**

```bash
pnpm typecheck
```

Expected: PASS. If it errors on `detected.parser`, the line-210 parse call wasn't updated.

- [ ] **Step 7: Run the full suite (registry + upload route behavior unchanged)**

```bash
pnpm test
```

Expected: **90 passed** (89 + the new `registry.test.ts` file's 2 tests = 91... see note). Actually: the prior count was 89; `registry.test.ts` adds 2 tests → **91 passed**. `tests/api/upload.test.ts` must stay green: soriana-sample → `SORIANA/MIXED` → `getParser` → `sorianaParser` (identical), and unknown filenames still hit `detectUpload`'s `null` → `ALL_FILES_FAILED`.

- [ ] **Step 8: Supply-chain post-task verification (CLAUDE.md §8)**

```bash
./scripts/check-supply-chain.sh
grep -E '"[\^~]' package.json && exit 1 || echo "✅ pins exact"
grep -E "tanstack|squawk|uipath|mistral|cap-js|intercom-client|router_init|setup\.mjs|router_runtime" pnpm-lock.yaml | grep -v lightningcss && exit 1 || echo "✅ lockfile clean"
```

Expected: script OK, `✅ pins exact`, `✅ lockfile clean`.

- [ ] **Step 9: Commit**

```bash
git add core/parsers/registry.ts tests/parsers/registry.test.ts app/api/data/upload/route.ts
git commit -m "$(cat <<'EOF'
feat(b1): parser registry keyed by (chain, fileType)

Builds the drop-in registry the Fase 1 spec designed but never implemented
(onetable-fase2-spec.md §11.3). getParser(chain, fileType) replaces the
hardcoded parser imports + selection in the upload route. Filename->(chain,
fileType) detection stays in the route until B4 moves upload to per-card.

HEB / AL_SUPER / LA_COMER return null until their parsers land in B6.
EOF
)"
```

Expected: one commit.

---

## Task 3: Open the B1 PR

**Files:** None (remote).

- [ ] **Step 1: Push and open the PR (CI is the close criterion)**

```bash
git push -u origin feat/b1-schema-and-parser-registry
gh pr create --title "feat(b1): fase2 schema migration + parser registry" --body "$(cat <<'EOF'
## Summary

Block B1 of Fase 2 (onetable-fase2-spec.md §4, §11.3, §12).

- Schema delta §4.2-§4.5: skuCode + base prices on Product, ProductPriceOverride,
  ThresholdConfig, ProductMapping.status enum + hand-edited partial unique index.
- ThresholdConfig lifecycle §4.5: default row created atomically with every Client
  (signup + seed).
- Parser registry §11.3 keyed by (chain, fileType); filename detection stays in the
  route until B4.
- Mechanical compat fixes forced by the delta: core/catalog/import.ts (skuCode +
  findFirst), 10 test fixtures.

## Test plan

- [ ] CI (the B0 \`ci\` check) is green: 91 tests, typecheck, build, migrate deploy.
- [ ] Migration applies cleanly on an empty Postgres in CI (migrate deploy).
- [ ] Local \`pnpm db:reset\` reseeds VIKS with skuCodes + a ThresholdConfig.
EOF
)"
```

- [ ] **Step 2: Watch CI to green, then it's mergeable**

```bash
gh pr checks --watch
```

Expected: the `ci` check passes (B0 branch protection requires it before merge). In CI the migration applies via `prisma migrate deploy` on the empty `postgres:16` service container — `skuCode NOT NULL` needs no default on an empty table, and the hand-added partial index runs as part of the SQL file. **Close criterion for B1: CI green (91 tests).** If CI fails, debug per the failed step; do not merge red.

---

## Self-review

**Spec coverage (`onetable-fase2-spec.md`):**

| Spec section | Covered |
|---|---|
| §4.2 Product (skuCode, prices, unique swap, overrides relation) | Task 1 Steps 2, 6-7 |
| §4.3 ProductPriceOverride | Task 1 Step 4 |
| §4.4 ProductMapping status enum + partial unique index | Task 1 Steps 3, 6-8 |
| §4.5 ThresholdConfig table + lifecycle (signup + seed) | Task 1 Steps 4, 5, 10, 11, 13 |
| §4.7 Migration via reset + reseed; hand-edited SQL exception | Task 1 Steps 6, 7, 14 |
| §10.1 catalog/import stays seed-only (compat touch, not refactor) | Task 1 Step 9 |
| §11.3 Parser registry (drop-in, replaces inline regex) | Task 2 |
| §12 B1 close criterion (89→91 tests green in CI) | Task 1 Step 16, Task 2 Step 7, Task 3 |
| CLAUDE.md §8 supply chain | post-task verification in Tasks 1 & 2 |

**Not in B1 (correctly deferred):** base prices in seed (Task 1 Step 11 note); discriminated-union `MappingLookup` + conflict-resolution normalizer/UI (§8 → B4); `core/parameters/import.ts` + idempotency tests (§10.5 → B3); `classifyAlert` refactor consuming `ThresholdConfig` (§4.8 → B2); HEB/AL_SUPER/LA_COMER parsers (§B6).

**Placeholder scan:** No TBD/TODO/"implement later". Every code step shows the exact code. The only non-literal is the migration timestamp directory (`<timestamp>`), which Prisma assigns — Step 6 explains it.

**Type/name consistency:** `skuCode` (String, no default) used consistently across schema, `import.ts`, and all fixtures. `MappingStatus`/`status`/`CONFIRMED` consistent (schema + partial index `WHERE status <> 'CONFLICTED'` + import dedup reasoning). `getParser(chain, fileType)` signature consistent across `registry.ts`, its test, and the route. `ThresholdConfig` field names (`criticoDays/riesgoDays/atencionDays/excesoDays`) consistent across schema and the signup assertion. Test count tracked: 89 (Task 1, assertions added to existing test) → 91 (Task 2 adds `registry.test.ts` with 2 tests).

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-06-03-b1-parser-registry-and-schema-migration.md`. Two execution options:

**1. Subagent-Driven (recommended)** — a fresh subagent per task with two-stage review (spec compliance + code quality) between tasks, per CLAUDE.md "modo de trabajo". Task 1 is the high-blast-radius one; independent review catches drift early.

**2. Inline Execution** — execute in this session via `superpowers:executing-plans`, with checkpoints. Better continuity for iterating on the first CI run.

Which approach?
