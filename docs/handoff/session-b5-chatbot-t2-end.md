# Handoff — sesión B5 Chatbot IA: T2 cerrado y commiteado, brief T3 pendiente de filtro

Fecha de cierre: 2026-07-16. Bloque **B5 Chatbot IA** (spec §9.1):
T1 ✅ commiteado → T2 ✅ commiteado → T3 (UI + forecast scaffold) con brief
listo, **PENDIENTE DE FILTRO EXTERNO**.

> Handoff UNTRACKED a propósito (convención: viaja en el próximo commit del
> bloque junto con su línea de índice en `docs/handoff/README.md`).

## 1. Commits del bloque (branch `feat/b5-chatbot`, off main @ c104f33, PUSHEADA a origin)

- **895113e** `feat(b5-chatbot-t1)` — tool layer `core/ai/tools` (7 tools,
  buildTools, resolvers memoizados, deps ai@6.0.168 + zod@4.3.6 + override
  eventsource-parser@3.0.8). Ver `docs/handoff/session-b5-chatbot-t1-end.md`.
- **71502a2** `feat(b5-chatbot-t2)` — route `/api/ai/chat`: streaming, trim
  C1 (30 mensajes completos + alineación a user), strip de system messages
  del cliente, `ignoreIncompleteToolCalls: true`, `stopWhen: stepCountIs(5)`,
  modelo constante `anthropic/claude-haiku-4.5` vía gateway
  (`lib/ai/model.ts` mockeable). Cero installs. Incluye el handoff de la
  sesión T1 + 4 ítems nuevos de backlog.

Working tree al cierre: **limpio respecto de 71502a2** salvo este handoff
(untracked), la línea nueva del índice en `docs/handoff/README.md`
(modified) y los artefactos locales gitignored de `.superpowers/sdd/`
(brief T3, reviews de T1/T2, working-diffs).

## 2. T2: cerrado completo

- **Ambos carriles CLEAN**: spec COMPLIANT desde el primer pase (12 puntos,
  5 deviations justificadas — la clave: `convertToModelMessages` devuelve
  Promise en el pin); quality CLEAN post fix pass (strip system injection,
  `ignoreIncompleteToolCalls`, higiene de mocks; cap de tamaño por mensaje
  → backlog).
- **Smoke de streaming de Michael PASADO 2 veces** (ronda inicial + curl de
  no-regresión post fix pass: $919,095.60 / 6,785 u, 2 cadenas, enero
  2026). **El override `eventsource-parser@3.0.8` quedó VALIDADO en
  streaming real** — compromiso de T1 saldado.
- **Suite: 374/374** (97 en `tests/ai/`), typecheck limpio, supply-chain
  verde.
- Colateral del smoke documentado en el reporte de T2: el claim del brief
  T1 sobre `getDefaultPeriod` era incompleto (la regla real tiene fallback
  a período más reciente a secas — queries.ts:88-90, por diseño S12.1);
  además la preferencia multi-cadena sobre mes más reciente quedó como
  pregunta de PRODUCTO en el backlog (§Pre-lanzamiento).

## 3. Próximo paso — T3, PENDIENTE DE FILTRO EXTERNO

**`.superpowers/sdd/b5-chatbot-t3-brief.md` escrito y PATCHEADO con las 3
decisiones de Michael (2026-07-16):**

1. **Override `swr@2.4.1`** (pre-cutoff) APROBADO — en `pnpm.overrides`
   ANTES del install de `@ai-sdk/react@3.0.170` (la transitiva `^2.2.5`
   resolvería a 2.4.2 post-cutoff). Mismo patrón que eventsource-parser.
2. **Scaffold forecasting APROBADO con gate doble por superficie**:
   `core/forecast/` + `GET /api/forecast` + sus tests = carril ESTRICTO
   (diff a Michael pre-commit); panel de chat + card = UI GATE (smoke
   visual). Un implementer, un commit, dos varas. Requisitos duros de
   `getForecast`: read-only puro (COUNT, cero writes), db/clientId
   inyectados patrón T1, cero imports de lib/ en core/.
3. **El smoke visual de T3 cierra el BLOQUE** → post-smoke, PR del bloque
   completo:
   ```
   gh pr create --title "feat(b5): chatbot IA tool-use (§9.1)" --body ...
   gh pr checks --watch
   ```
   Merge SOLO Michael: `gh pr merge <N> --squash --delete-branch`.

**⚠ NO DISPATCHAR NADA hasta que Michael traiga el go filtrado del brief de
T3.**

## 4. Cómo arranca la sesión fresca

1. `CLAUDE.md` (auto).
2. Este handoff.
3. `.superpowers/sdd/b5-chatbot-t3-brief.md`.
4. Esperar el go filtrado de Michael → implementer T3 fresco con prefijo
   supply-chain literal.
5. Recordatorios: cero procesos huérfanos antes de la suite; avisar a
   Michael antes de correrla (suele tener `pnpm dev` activo); GREEN de T3
   incluye `pnpm build` (client components); commit solo con "commiteá".

## 5. Pendientes no-T3 (no perder)

- **Drift docs CLAUDE.md D3**: `getCurrentClient`/`lib/tenant.ts` no
  existen; el patrón real es `requireAuth()` en `lib/auth-helpers.ts`.
  Corrección pendiente de OK de Michael.
- **hardening-backlog.md** sumó en estas sesiones: spread 3ª capa en
  executes, dedup slice/totalRows, rate limiting del chat, flush de
  microtasks mágico, cap de tamaño por mensaje del chat, y la pregunta de
  producto de `getDefaultPeriod` (multi-cadena vs mes más reciente).
- **PR del bloque de dinero** (feat/b5-money): estaba abierto al inicio de
  estas sesiones — verificar estado con `gh pr list` (si Michael ya lo
  mergeó, main se movió de c104f33 → evaluar rebase de `feat/b5-chatbot`
  ANTES de T3, decisión de Michael).
