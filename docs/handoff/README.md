# Índice de handoffs

> Registro histórico: los handoffs NO se editan después de escritos. Los
> paths que citan reflejan el layout del repo al momento de su escritura
> (pueden apuntar a ubicaciones pre-archivo, p.ej. specs que hoy viven en
> `docs/archive/`); eso es esperado, no un error.

Formato: archivo — qué cierra — commit/PR asociado.

## Fase 1 (demo ANTAD, branch `plan/onetable-fase1`)

- `session-1-end-of-day-1.md` — cierre del día 1 de Fase 1: spec congelada
  (5 ajustes), plan ejecutable, setup con mitigaciones supply-chain — 24
  commits del día 1 en `plan/onetable-fase1`.
- `session-2-end-of-backend.md` — backend de Fase 1 completo, pre-gate G1
  (72/72 tests, tsc limpio) — hasta commit `57b1723`.
- `g9-vercel-deploy.md` — gate G9: deploy a Vercel pre-demo ANTAD, con
  pre-flight checks — cierre del branch de Fase 1.

## Fase 2 (beta VIKS, feature branches off `main`)

- `b4-phase4-handoff.md` — puente de las fases 1-3 del bloque B4 (Portales)
  hacia las fases 4-5 (Tasks 9-13) — movido acá desde
  `docs/superpowers/sdd/` en B-4 (2026-07-15); referencias antiguas a esa
  ubicación son historia.
- `b4-phase5-handoff.md` — puente de las fases 1-4 del bloque B4 (Portales)
  hacia Task 12 (smoke gate) y Task 13 (PR) — desemboca en el PR #11
  (`a74704e` en main).
- `session-b4-followups-end.md` — mini-bloque post-B4: FF-1 (confirmar
  PENDING_REVIEW), FF-2 (notices de conflicto), FF-3 (coverage de rutas
  Portales) — commit `94f076d` en main.
- `session-b5-1-end.md` — task B-1 del bloque B (capa de dinero): cascada §7
  de montos al query — commit `1491d61` en `feat/b5-money`; el handoff entró
  al repo en `260eebd`.
- `session-b5-block-end.md` — cierre del bloque B completo (B-1 + B-2 + B-3
  + B-4, 5 commits en `feat/b5-money`, suite 277/277) — viaja en el commit
  de B-4; el PR del bloque queda abierto para merge de Michael. Próximo
  bloque: hardening (scope en `.superpowers/sdd/hardening-backlog.md`).
