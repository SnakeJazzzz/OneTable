# Handoff — Sesión B5-1 (cierre 2026-07-14)

> Este archivo queda untracked al cierre de la sesión; entra al repo en el
> primer commit de B-2 (mismo patrón que `session-b4-followups-end.md`, que
> entró en 1491d61).

## 1. Commit de la sesión

- **1491d61** en `feat/b5-money` (off main @ 94f076d) — `feat(b5-1)`: cascada
  §7 de VENTA al query (archivo → override → base → NULL).
- 4 files, +458/−30: `core/kpis/queries.ts` (fragmentos compartidos
  `SALES_AMOUNT_CASCADE` + `SALES_CASCADE_JOINS`, consumidos por las 4
  queries de dinero incl. ambos períodos de `getDashboardKpis`; LEFT JOINs
  per §8.4), `tests/kpis/money-cascade.test.ts` (nuevo),
  `.superpowers/sdd/b4-followups.md` (ledger), y
  `docs/handoff/session-b4-followups-end.md` (tracked por primera vez).
- Suite **240/240** pre-commit (234 previas + 6 de money-cascade), un solo
  proceso contra la dev DB compartida.
- Doble review ciega (spec compliance + code quality, agentes separados):
  **PASS** — cero Critical, cero Important, 5 minors registrados en el
  ledger (`.superpowers/sdd/b4-followups.md`, sección "B-1 — minors de
  review").

## 2. Estado al cierre

- Working tree con DOS pendientes deliberados para el primer commit de docs
  de B-2:
  - `M CLAUDE.md` — sección "## Modo de trabajo" actualizada al protocolo
    vigente (implementer GREEN-sucio sin git, doble review ciega, commit
    solo con "commiteá" de Michael, gates ESTRICTO vs UI, reglas operativas
    permanentes). Editada post-handoff, intencional, NO es residuo — no
    revertir ni "limpiar".
  - `?? docs/handoff/session-b5-1-end.md` — este archivo.
- **Sin push, sin PR** — el bloque B viaja completo (B-1 + B-2) en un solo
  PR cuando cierre B-2.

## 3. Próximo task — B-2: UI de overrides en la card de Portales

- **Gate UI**: cierre = smoke visual de Michael, no CI.
- Alcance per spec §3.2.4 y §4.3: editar/persistir `ProductPriceOverride`
  por (producto, cadena) desde la card de cada portal; al agregar el portal
  aparecen los precios globales, se editan para esa cadena o se dejan igual.
- La capa de query (B-1) **ya consume los overrides** — la UI de B-2 solo
  escribe.
- El brief de B-2 se escribe FRESCO en la próxima sesión, post re-grounding
  contra el repo real (regla de brainstorm re-grounding: no confiar en spec
  ni en este handoff para afirmaciones de estado — verificar con grep/read).
- Primer commit de B-2 = commit de docs: este handoff + el CLAUDE.md
  actualizado (docs(b5): handoff B5-1 + protocolo vigente en CLAUDE.md),
  ANTES de escribir el brief.

## 4. Obligaciones que B-2 hereda (explícitas)

- **Test obligatorio**: override con `salePrice` NULL (purchase-only, estado
  legal per schema `Decimal?`) cae a base en la cascada. Una fila de seed
  extra en `tests/kpis/money-cascade.test.ts`. Registrado en el ledger
  sección "B-1 — minors de review". B-2 hace alcanzable ese estado desde la
  UI, por eso el pin es suyo.
- **Footguns de rutas/UI vigentes** (heredados del bloque B4, siguen
  aplicando a toda ruta/componente nuevo de B-2):
  - `clientId` SIEMPRE de `requireAuth()`, nunca del body.
  - El cliente chequea `res.ok` ANTES de parsear (409 `{error}` vs 200
    `{ok}`/`{result}`).
  - Notices condicionales sobre data refetcheada, no clears ciegos.

## 5. Lecciones operativas de la sesión

- **`.superpowers/sdd/b4-followups.md` está gitignored pero tracked**: `git
  add` requiere `-f` SIEMPRE (el warning es inofensivo). `git check-ignore`
  dio un falso negativo una vez — no confiar en él para este path; el `-f`
  es el modo permanente.
- **Aritmética de seeds de test verificable a mano en el doc-comment del
  archivo** (patrón de `money-cascade.test.ts`: seed shape + totales
  esperados calculados en el comentario de cabecera) facilitó las reviews
  ciegas — repetir en tests de B-2 si aplica.
