# ADR-001: Branch protection OFF durante setup de Fase 1

**Fecha:** 2026-05-18  
**Status:** Aceptado  
**Deadline driver:** Demo ANTAD lunes-martes  

## Contexto

OneTable está en setup acelerado para demo ANTAD con deadline de 3-4 días. El repo en GitHub (SnakeJazzzz/OneTable) tiene branch protection DESACTIVADA durante esta fase. Esto se aleja de la práctica estándar de "nunca commit directo a main" que está documentada en el Plan V1.

## Decisión

Mantener branch protection OFF en GitHub durante todo el setup de Fase 1 (hasta el demo ANTAD inclusive).

## Justificación

1. **Velocidad:** Push directo a main durante setup elimina overhead de PRs auto-mergeados que solo agregan latencia.
2. **Único desarrollador:** No hay riesgo de conflicto con otros contributors durante esta fase.
3. **Defensa local intacta:** El hook `.claude/hooks/block-main-writes` previene commits accidentales a main desde Claude Code. Para overridear hace falta acción explícita del usuario. Esto cubre el 95% del riesgo real.

## Mitigaciones activas

- Hook `block-main-writes` testeado y bloqueando correctamente.
- Hook `block-env-writes` previene leaks de credenciales.
- Hook `block-force-push` previene rewrite de history.
- Hook `block-rm-rf-absolute` previene borrado accidental.

## Riesgos aceptados

- Si el usuario hace `git push origin main` manualmente desde terminal (fuera del scope del hook), no hay nada en GitHub que lo pare.
- Commits a main no pasan por CI antes de mergear (no hay CI configurada todavía).

## Trigger para revertir

Branch protection debe re-habilitarse en uno de estos eventos, lo que ocurra primero:

1. Inmediatamente después del demo ANTAD (deadline original).
2. Si en cualquier momento ingresa un segundo contributor al repo.
3. Si CI se configura (entonces require status checks before merge).

## Re-habilitación

Settings → Branches → Add rule:
- Pattern: `main`
- Require pull request before merging
- Require approvals: 1 (cuando haya un segundo dev) o 0 (solo)
- Require status checks: cuando CI esté configurada
- Require linear history: opcional, recomendado
