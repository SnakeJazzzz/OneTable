# docs/ — mapa y reglas

La dimensión que organiza este árbol es **autoridad**, no frecuencia de
cambio: qué documento manda hoy, qué es registro histórico, y qué es
material de trabajo de sesión.

## Mapa de carpetas

| Carpeta | Regla |
|---|---|
| `docs/` (raíz y subcarpetas no listadas abajo) | **ACTIVO — manda hoy.** Si un doc activo contradice la realidad del repo, se corrige el doc (verificación empírica primero). |
| `docs/archive/` | **Registro histórico inmutable.** No se edita; se consulta para el "por qué", nunca para estado presente. Sus referencias internas reflejan el layout al momento de archivarse. |
| `docs/handoff/` | **Registro histórico** de cierres de sesión (índice en [`handoff/README.md`](handoff/README.md)). No se editan una vez escritos. Se quedan acá (no en archive/) porque los briefs los citan por este path. |
| `.superpowers/sdd/` (fuera de docs/) | **Working docs** de sesión: briefs, reportes, reviews, ledgers. Gitignored con excepciones tracked vía `git add -f`. Material EFÍMERO: al cerrar un bloque, los working docs de sus tasks se purgan (ver Regla de tránsito); solo sobreviven los ledgers vivos (`hardening-backlog.md`, `b4-followups.md`). |

(`docs/superpowers/`, `docs/plans/` y `docs/decisions/` existieron como
scaffolding de fases previas; quedaron vacías y se eliminaron en el
cleanup de docs de 2026-08-26.)

## Docs activos

| Archivo | Qué es | Cuándo se consulta |
|---|---|---|
| `specs/onetable-fase3-spec-draft.md` | Diseño congelado de lo diferido a Fase 3 (AES-GCM, arquitectura de scrapers, multi-marca, forecasting). | Al evaluar si algo "va ahora o va a Fase 3". |
| `specs/viks-data/README.md` | Particularidades de los archivos reales de cada portal (parsers). | Al tocar parsers o depurar un archivo de VIKS. |
| `adr/ADR-001-branch-protection-off-during-setup.md` | Por qué branch protection estuvo OFF durante el setup (hoy está ON). | Arqueología de decisiones. |
| `specs/onetable-srs-v1.docx` | SRS legacy (el proyecto se llamaba "Scopium"). | Casi nunca; contexto pre-Fase 1. |

## Registro histórico

- `archive/fase1/` — spec y plan del demo ANTAD (Fase 1).
- `archive/fase2/` — spec de Fase 2 (cerrada 2026-07-16, bloques B0-B5;
  B6 quedó fuera, bloqueado por archivos reales). Era la fuente única de
  verdad de Fase 2; hoy se consulta para el "por qué", no para estado
  presente. §9.2 (forecasting) y §12/B6 siguen citándose desde el draft
  de Fase 3 como diseño congelado.
- `archive/fase2-bloques/` — planes y design docs de bloques de Fase 2 ya
  ejecutados (B0 plan+design, B1, B2, B3, B4; B5 no tuvo plan en docs/,
  sus briefs viven en `.superpowers/sdd/`).
- `archive/hardening/` — plan faro del bloque de HARDENING (cerrado
  2026-08-20, T1-T6 completados, PRs #15-#21; flip de CSP de prod a
  enforced verificado). El ledger (`hardening-backlog.md`) NO se archiva
  — sigue VIVO para "hardening .2" y Fase 2.5. Handoff de cierre:
  `handoff/session-t6-close.md`.
- `archive/sdd-working-docs-digest.md` — digest de los working docs de
  `.superpowers/sdd/` purgados en el cleanup de 2026-08-26 (briefs,
  reportes y reviews de tasks cerrados de Fase 2 y hardening).
  Los que estaban tracked se recuperan completos vía git history
  (`git log --all -- .superpowers/sdd/<file>`); los untracked solo
  existen resumidos en este digest.
- `handoff/` — todos los handoffs de sesión (ver su README).

## Regla de tránsito

Al cerrar una **fase** o un **bloque**: los specs/planes ejecutados se
mueven a `docs/archive/` con `git mv` (preserva historia) + caza de
punteros (`grep -rn` del filename viejo en TODO el repo; toda referencia en
docs ACTIVOS se actualiza en el mismo commit — las referencias dentro de
handoffs y docs ya archivados se dejan como están, son historia). Después
se actualiza este README. Este paso es parte del ritual de cierre de sesión
de `CLAUDE.md` ("Cómo cierra cada sesión").

Además, los **working docs** de `.superpowers/sdd/` de los tasks del
bloque cerrado se purgan: los tracked con `git rm` (quedan recuperables
en git history), los untracked se resumen primero en el digest de
`docs/archive/` (o en uno nuevo por bloque) y recién entonces se borran.
Los diffs/patches de trabajo se borran directo — se reconstruyen con
`git show` del commit mergeado. Los ledgers vivos nunca se purgan.
