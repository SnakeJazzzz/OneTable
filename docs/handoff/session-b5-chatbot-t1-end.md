# Handoff — sesión B5 Chatbot IA (§9.1): T1 cerrado, brief T2 pendiente de filtro

Fecha de cierre: 2026-07-16 (sesión arrancó 2026-07-15). Bloque: **B5
Chatbot IA** (spec §9.1), corte en 3 tasks: T1 tool layer (ESTRICTO) →
T2 route `/api/ai/chat` (ESTRICTO) → T3 UI panel en Análisis (UI GATE).

> Este handoff queda UNTRACKED a propósito (sin "commiteá" no hay commit) —
> entra al repo en el próximo commit del bloque, junto con la línea de índice
> agregada a `docs/handoff/README.md`.

## 1. Commits de la sesión (branch `feat/b5-chatbot`, off main @ c104f33)

- **895113e** `feat(b5-chatbot-t1)` — tool layer `core/ai/tools`: 7 tools
  zod strictObject sobre las queries read-only de `core/kpis/queries.ts`
  (incluye `getSalesByChainForPeriod`, D-2), `buildTools(ctx)` con closure
  (context server-side gana siempre), resolvers memoizados por request
  (período default S12.1 + `loadCuts` inyectado — core/ sin imports de
  lib/), errores `TOOL_EXECUTION_ERROR` / `NO_DATA` distinguibles, caps
  20/50 con slice + `totalRows`. Deps: `ai@6.0.168` + `zod@4.3.6` (pins
  exactos pre-cutoff) + override `eventsource-parser@3.0.8` vía
  `pnpm.overrides`. Incluye brief y report del task (add -f) y 3 ítems
  nuevos en `hardening-backlog.md`.

**Branch pusheada a origin** (`git push -u origin feat/b5-chatbot`,
2026-07-16) como backup remoto. **SIN PR** — el PR es al cierre del bloque
completo, post-T3.

## 2. T1: proceso completo (para el registro)

Brief → filtro de Michael (GO con C1/C2/C3) → implementer (GREEN 351/351,
74 tests) → doble review ciega → 2 MAJORs: transitiva post-cutoff
`eventsource-parser@3.1.0` sin flag + ciclo core↔lib por import de
`@/lib/thresholds` (inducido por el brief §2.2 — corresponsabilidad del
brief registrada) → fix pass aprobado (override a 3.0.8 pre-cutoff rama (a);
`loadCuts` inyectado; rejection no cacheada; 5 tests más) → re-reviews →
micro-fix final (log con `err.name/code`; rename `resolveCuts`→`loadCuts`
en ToolContext) → re-review CLEAN → "commiteá" → 895113e.

- **Suite al cierre: 357/357** (40 archivos; 80 en `tests/ai/tools.test.ts`).
  `pnpm typecheck` limpio. Supply-chain #8: 3 checks verdes.
- Artefactos del task: brief y report COMMITEADOS
  (`.superpowers/sdd/b5-chatbot-t1-{brief,report}.md`); las 2 reviews y el
  working-diff quedaron locales (untracked, convención).
- Fe de erratas en el report: el claim del implementer sobre transitivas era
  falso (3 no listadas); corregido con registro, original intacto.

## 3. Estado del working tree

- **Limpio respecto del commit 895113e** salvo: este handoff (untracked),
  la línea nueva en `docs/handoff/README.md` (modified, sin commitear) y
  los artefactos locales de `.superpowers/sdd/` (gitignored): brief T2,
  reviews T1, working-diff T1.
- `.env*` intactos. `AI_GATEWAY_API_KEY` NO existe aún en `.env.local` ni
  `.env.example` — la agrega Michael a mano cuando arranque T2 (necesaria
  solo para el smoke, no para los tests).

## 4. Próximo paso — T2, PENDIENTE DE FILTRO EXTERNO

**`.superpowers/sdd/b5-chatbot-t2-brief.md` está escrito y PATCHEADO con las
2 decisiones de Michael (2026-07-16):**

1. Cap: `MAX_CHAT_MESSAGES = 30`, trim a los últimos 30 en límites de
   mensaje completos (nunca tool results huérfanos de su tool call; test
   del edge incluido en el plan).
2. Smoke: curl con la key de Michael contra `/api/ai/chat` EN T2 (no se
   difiere a T3) — compromiso escrito de validar el override de
   `eventsource-parser@3.0.8` en el smoke de streaming; el curl aísla
   streaming de UI.

**⚠ NO DISPATCHAR NADA hasta que Michael traiga el go filtrado del brief de
T2.** El brief ya recoge los insumos de T1: `stopWhen: stepCountIs(5)` (no
existe maxSteps en v6), modelo `anthropic/claude-haiku-4.5` (con PUNTO — el
ID con guiones de la spec no existe en el gateway), `requireAuth()` de
`lib/auth-helpers.ts` (no getCurrentClient — drift de CLAUDE.md D3 pendiente
de corrección de docs), `loadCuts: () => getThresholdCuts(db, clientId)` al
armar buildTools, runtime Node explícito, tests con `MockLanguageModelV3` de
`ai/test` (verificado que existe en 6.0.168 — cero API real), y el doble
vocabulario sin-data (`NO_DATA` vs `rows: []` de getSalesTrend) obligatorio
en el system prompt.

## 5. Cómo arranca la próxima sesión

1. `CLAUDE.md` (auto).
2. Este handoff.
3. `.superpowers/sdd/b5-chatbot-t2-brief.md` (la espec de T2).
4. Esperar el go filtrado de Michael → dispatchar implementer T2 fresco con
   prefijo supply-chain literal (aunque T2 no instala nada).
5. Recordatorios vigentes: cero procesos huérfanos antes de la suite; avisar
   a Michael antes de correrla; merges y operaciones destructivas SOLO
   Michael; commit solo con "commiteá".

## 6. Pendientes que NO son de T2 (no perder)

- Drift docs CLAUDE.md D3 (`getCurrentClient`/`lib/tenant.ts` no existen) —
  corrección pendiente de OK de Michael.
- Scaffold forecasting `insufficient` NO existe (spec §12 lo ubicaba en
  B3/B4) — decidir ubicación (¿T3 junto al panel? ¿hardening-backlog?).
- `hardening-backlog.md` sumó 4 ítems esta sesión: spread 3ª capa, dedup
  slice/totalRows, rate limiting del chat (Observabilidad/prod), flush de
  microtasks mágico (Infra de tests).
- PR del bloque B (dinero) seguía abierto al inicio de esta sesión — estado
  del merge a verificar en la próxima (`gh pr list`).
