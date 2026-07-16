# Handoff — cierre del bloque B (capa de dinero), 2026-07-15

> Este handoff viaja EN el commit de B-4 (el último del bloque) para entrar
> al PR del bloque completo.

## 1. Commits del bloque (branch `feat/b5-money`, off main @ 94f076d)

- **1491d61** `feat(b5-1)` — B-1: cascada §7 de VENTA al query (archivo →
  override → base → NULL), fragmentos compartidos consumidos por las 4
  queries de dinero, LEFT JOINs per §8.4. +6 tests (money-cascade).
- **260eebd** `docs(b5)` — handoff de B5-1 + protocolo de trabajo vigente
  en CLAUDE.md.
- **28175ff** `feat(b5-2)` — B-2: UI de overrides de precio por cadena en
  la card de Portales (§3.2.4): ruta /api/portales/price-overrides (GET +
  PUT declarativo de 4 keys), lib/prices.ts, PriceOverrideSection,
  useChainPriceOverrides. Pin heredado purchase-only → base. Gate UI:
  smoke de Michael aprobado.
- **8c90ce9** `fix(b5-3)` — B-3: sweep de minors pre-PR (16 ítems del
  ledger): helper de precio unificado + cap a 2 decimales en las 3 rutas,
  red de tests A1-bis pre-migración, fixes de stale-state en UI, mensaje
  INVALID_PRICE preciso (decisión post-smoke). Smoke de Michael aprobado.
- **(este commit)** `docs(b5-4)` — B-4: depuración de docs — claims stale
  de CLAUDE.md corregidos contra realidad verificada, docs/ reorganizado
  por autoridad (activo vs archivo, git mv con caza de punteros), ledger
  b4-followups cerrado, hardening-backlog.md creado como sucesor, índice
  de handoffs y este handoff.

## 2. Estado al cierre

- **Suite: 277/277** (39 archivos) al cierre de B-3; B-4 es docs puros
  (sin código, sin suite).
- **Working tree**: limpio post-commit de B-4.
- **PR del bloque**: abierto al cierre de esta sesión (los 5 commits
  juntos), pendiente de merge por Michael
  (`gh pr merge N --squash --delete-branch` cuando el check `ci` esté
  verde). El merge es SOLO de Michael.

## 3. Próximo bloque: hardening

- **Fuente única del scope**: `.superpowers/sdd/hardening-backlog.md`
  (sucesor del ledger cerrado `b4-followups.md`). Secciones: Rutas/services,
  Hooks/UI, Observabilidad/prod, Infra de tests, Pre-lanzamiento,
  Pendiente-por-archivo.
- La sesión del bloque de hardening arranca FRESCA post-/clear leyendo:
  1. `CLAUDE.md` (auto),
  2. `docs/README.md` (mapa de docs por autoridad),
  3. `.superpowers/sdd/hardening-backlog.md` (el scope).
- Recordatorios vigentes: brief filtrado antes de dispatchar; el corte de
  scope del bloque lo decide Michael sobre el backlog.
