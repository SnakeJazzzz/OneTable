# Handoff — Sesión mini-bloque post-B4 (FF-1 / FF-2 / FF-3)

> Cierre 2026-07-14. Archivo untracked al generarse — entra al repo en el primer
> commit de docs de B-1.

## Commits de la sesión (orden cronológico)

| Commit | Qué |
|---|---|
| `39f59ac` | docs: handoff B4 phase 4 (histórico; re-ingresó por la branch tras el incidente de reset) |
| `61ba7f3` | feat(ff1): acción Confirmar para mappings PENDING_REVIEW en Vista B |
| `83783c3` | feat(ff2): clear de notice de conflicto post-resolución + feedback de éxito en conflict-section |
| `8da8e12` | test(ff3): coverage de routes Portales + unificación PRODUCT_NOT_FOUND a 404 en PATCH |
| `94f076d` | **squash del PR #12** (mini-bloque completo, mergeado a main; branches borradas) |

Cada FF corrió el loop completo: implementer fresco con prefijo supply-chain →
GREEN dirty sin git → doble carril ciego (spec + quality, agentes separados) →
fix pass cuando hubo hallazgos (FF-1: 1 Important; FF-2: 1 Critical race; FF-3:
2 Minor) → re-review del carril correspondiente → paquete a Michael → commit con
OK explícito.

## Estado al cierre

- `main` @ `94f076d`, working tree limpio.
- Suite **234/234** (35 archivos; 197 pre-FF-3 + 37 de FF-3). Typecheck y build
  verdes. Supply-chain limpio (script + pins + lockfile) en cada cierre.
- Prod smokeado OK por Michael post-merge.

## Incidente registrado (recuperado sin pérdida)

Un `git reset --hard origin/main` manual corrió parado en `feat/b4-followups`
en vez de `main`: borró el working tree GREEN-dirty de FF-1 (pre-commit) y dejó
`main` sin arreglar. Recuperación: el diff de review vivía gitignored en
`.superpowers/sdd/ff1-working-diff.txt` → `git apply` + verificación
`git hash-object` == `14fc5ff` (hash que la re-review de calidad había
verificado) = restauración byte-idéntica; el reflog reconstruyó la secuencia;
el handoff commiteado en el stray `feadb76` se rescató con `git show` y
re-entró como `39f59ac`. Lección en ledger (sección Harness): **verificar
branch con `git branch --show-current` antes de toda operación destructiva.**

## Ledger

- `.superpowers/sdd/b4-followups.md` quedó **tracked** desde `61ba7f3`
  (`git add -f`; el resto de `.superpowers/` sigue ignorado). Ojo: `git add`
  del path emite warning de gitignore y corta cadenas `&&` — es inofensivo
  para archivos ya tracked.
- Cerrados en la sesión: Task 6 #3 (coverage pass), inconsistencia
  PRODUCT_NOT_FOUND (unificada a 404), lax `.rejects.toThrow()` (6 matchers).
- **Drift pendiente:** los 2 ítems de "Task 12 smoke" (PENDING_REVIEW sin
  salida; notice de conflicto stale) siguen `[ ]` pero FF-1/FF-2 los cerraron.
  Se tachan (nota "tachado retroactivo") en el primer commit de B-1 que toque
  el ledger.
- Abiertos agrupados por destino: ver reporte de housekeeping 2026-07-14
  (whole-branch review: Task 6 #4/#5/#7, Task 7 #1-minor + rename opcional,
  shared mutation helper, stale edit-state + gemelos FF-1, ConfirmDialog
  loadingLabel, edge 11.5a-fix sin test, notice verde FF-2 sin dismiss;
  hardening: substring error-matching, ventana residual refetch fallido FF-2,
  errores técnicos crudos; document-or-decide: Task 6 #6 isActive,
  presence-signal productId-scoped, nits retargetMapping; Task 8 #5/#8 con
  destino vencido — reasignar o descartar; harness: DB aislada por proceso,
  higiene de procesos, higiene git).

## Nota de observabilidad (evidencia para hardening)

En prod, `/api/auth/callback/credentials` devuelve **stack trace crudo** en el
path de credenciales inválidas (benigno pero visible). Evidencia concreta para
el ítem de hardening "errores técnicos crudos".

## Próximo bloque: B — capa de dinero (D2 diferido de B4)

Corte definido por Michael en 2 tasks:

- **B-1 — resolución §7 de montos al query (ESTRICTO:** diff a Michael antes
  de cualquier commit**).**
- **B-2 — UI de overrides en la card de Portales (gate UI).**

### Hallazgo clave del re-grounding (2026-07-14)

**`ProductPriceOverride` YA existe migrada y es tabla huérfana** — coincide
campo por campo con spec §4.3 (`purchasePrice`/`salePrice Decimal(12,2)?`,
`@@unique([productId, chain])`, cascade desde Product) y tiene **cero
consumidores** en `core/`, `app/`, `lib/`, `components/`, `scripts/` (solo el
schema la menciona). `Product` ya cumple §4.2 (`purchasePriceBase`/
`salePriceBase Decimal?`, `@@unique([clientId, skuCode])`). **Cero delta de
schema: todo el bloque B es capa de query + UI.**

### Re-grounding completo (repo real vs spec, verificado empíricamente)

**Dónde se calculan montos hoy** — `core/kpis/queries.ts`, SQL crudo. Funciones
que consumen pesos:

| Función | Línea (uso de monto) | Uso |
|---|---|---|
| `getDashboardKpis` | :103 / :112 | `SUM("salesAmountMxn")` período actual y previo |
| `getSalesTrend` | :186 | `SUM(sd."salesAmountMxn")` por punto de la serie |
| `getSalesByChainForPeriod` | :225 | `SUM("salesAmountMxn")` por cadena |
| `getOneTableRows` | :473 | `sd."salesAmountMxn"` por fila (nullable) |

**El precio usado es exclusivamente `SelloutData.salesAmountMxn` — el monto del
archivo.** No existe fallback a override ni a precio base en ninguna query (los
únicos COALESCE del archivo son sobre `nameStandard`). La cascada de §7
(archivo → override → base → null) hoy está implementada solo en sus pasos 1 y 4.

**SelloutData y archivos sin monto:** 4 columnas de pesos por fila
(`salesAmountMxn`, `purchasesAmountMxn`, `inventoryAmountCostMxn`,
`inventoryAmountPriceMxn`, todas `Decimal(12,2)?`). Cuando el archivo no trae
pesos (Chedraui/Amazon per §7), el parser omite el campo (`soriana.ts:40` solo
lo setea si viene), el UPSERT inserta NULL preservando valor previo vía COALESCE
(`upsert.ts:75/:106`), y en el read-path `SUM` ignora NULLs → los agregados solo
suman lo que trajo pesos; la fila de OneTable muestra "—". **De las 4 columnas
de montos, las queries/UI consumen solo `salesAmountMxn`** — purchases/inventory
amounts se persisten pero nadie los lee.

**Shape del render actual:** OneTable (`components/dashboard/onetable.tsx`) —
columnas `Cadena / Tienda / Producto / Ventas U / Ventas MXN / Inv U / Días Inv
/ Alerta`; unidades y pesos conviven; null → "—" (`fmtMxn`); export CSV/Excel
incluye "Ventas MXN" (vacío si null). Dashboard — KPIs `salesAmountMxn` total +
`variationPct` + `salesUnits` + alertas activas (`queries.ts:152`); charts por
cadena con monto y unidades por punto.
