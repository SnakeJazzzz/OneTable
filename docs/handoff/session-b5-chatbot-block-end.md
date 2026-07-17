# Handoff — cierre del BLOQUE B5 Chatbot IA (§9.1 + scaffold §9.2)

Fecha de cierre: 2026-07-16. T1 + T2 + T3 completos, los 3 smokes de
Michael pasados, PR del bloque creado. Merge pendiente (SOLO Michael).

> Handoff UNTRACKED a propósito (convención: viaja en el próximo commit
> junto con su línea de índice en `docs/handoff/README.md`).

## 1. Commits del bloque (branch `feat/b5-chatbot`, off main @ c104f33)

En orden cronológico:

1. **895113e** `feat(b5-chatbot-t1)` — tool layer `core/ai/tools`: 7 tools,
   `buildTools` factory, resolvers de período memoizados; deps
   `ai@6.0.168` + `zod@4.3.6` + override `eventsource-parser@3.0.8`.
   Suite 357/357. Detalle en `session-b5-chatbot-t1-end.md`.
2. **71502a2** `feat(b5-chatbot-t2)` — route `/api/ai/chat`: streaming,
   trim C1 (30 mensajes + alineación a user), strip de system messages
   del cliente, `ignoreIncompleteToolCalls: true`,
   `stopWhen: stepCountIs(5)`, modelo `anthropic/claude-haiku-4.5` vía
   gateway (`lib/ai/model.ts` mockeable). Suite 374/374. Smoke de
   streaming pasado 2x. Detalle en `session-b5-chatbot-t2-end.md`.
3. **66ef457** `feat(b5-chatbot-t3)` — chat panel en Análisis
   (`useChat` + `DefaultChatTransport`), forecasting gate scaffold
   (`core/forecast/` con `getForecast` per §9.2.1 + `getForecastOverview`,
   `GET /api/forecast`, card §9.2.3 con conteos reales), install
   `@ai-sdk/react@3.0.170` + override `swr@2.4.1`. Suite 390/390
   (16 tests nuevos). Gate doble por superficie: ESTRICTA aprobada por
   review externa de Michael pre-commit; UI GATE cerrada por smoke.

## 2. Estado al cierre

- **Suite: 390/390** (97 en `tests/ai/` + 16 en `tests/ai/forecast.test.ts`
  del resto). Typecheck limpio, `pnpm build` verde, supply-chain verde.
- **Working tree**: limpio respecto de 66ef457 salvo este handoff
  (untracked) + su línea de índice en README.md (modified) + artefactos
  gitignored no trackeados de `.superpowers/sdd/` (reviews y diffs de T3).
- **Smokes pasados (los 3):** streaming T2 (2x), review externa del diff
  ESTRICTO de T3, smoke visual T3 (flow e2e completo: números contra
  Dashboard, historial in-memory, forecasting con aritmética C1 validada
  — 1 mes Chedraui → marzo 2026, stop/retry, consola limpia, y los 3
  intentos de injection PASADOS: tenant defense server-side intacta).
- **PR del bloque:** creado post-cierre (ver sección 4). CI verde =
  criterio de merge. Merge SOLO Michael:
  `gh pr merge <N> --squash --delete-branch`.

## 3. Decisiones y pendientes que SOBREVIVEN al bloque

- **Regla nueva de producto (Michael, 2026-07-16): todo el copy en español
  mexicano (tuteo).** El copy de T3 ya salió en tuteo; el voseo
  PRE-EXISTENTE (10 ubicaciones grep-eadas) quedó como barrido
  pre-lanzamiento en `hardening-backlog.md` §Pre-lanzamiento.
- **hardening-backlog.md sumó en este bloque:** chatbot inventa cantidades
  en recomendaciones (violación del "never invent" ante preguntas de
  juicio — candidato a endurecer system prompt) + framing "cuentas de la
  plataforma" (misma familia); pasada de copy es-MX; rate limiting del
  chat; cap de tamaño por mensaje; pregunta de producto de
  `getDefaultPeriod` (multi-cadena vs mes más reciente).
- **Ledger `b4-followups.md` sumó B5-T3:** M1 indicador de tool congelado
  tras stop; M2 auto-scroll pisa scroll manual; M3 gap de test wrap de año
  en `nextEligible`; M4 forecast-card stale tras reset (patrón de página);
  M5 JOIN del overview sin re-check de clientId (review externa).
- **Drift docs CLAUDE.md D3** (arrastrado): `getCurrentClient`/
  `lib/tenant.ts` no existen; el patrón real es `requireAuth()` en
  `lib/auth-helpers.ts`. Corrección pendiente de OK de Michael.
- **Branch `'forecast'` del gate (baseline-ma3) queda para 2.5** — cuando
  merge, la card auto-renderiza sin cambio de UI (stub ≥3 meses
  documentado en `core/forecast/index.ts`).
- **Archivado de docs:** este bloque no tenía plan/spec propio en
  `docs/specs/` (los briefs viven trackeados en `.superpowers/sdd/`);
  no hay nada que mover a `docs/archive/`.

## 4. Operativa post-cierre (para Michael)

1. **⚠ ANTES de verificar el deploy: agregar `AI_GATEWAY_API_KEY` en
   Vercel** (Settings → Environment Variables, production). Sin ella el
   chat en prod está ROTO.
2. Merge del PR: `gh pr merge <N> --squash --delete-branch`.
3. Post-merge: smoke de PRODUCCIÓN (mismo flow del smoke local contra la
   URL de prod).

## 5. Próximo paso recomendado

Identificar el próximo bloque contra `docs/specs/onetable-fase2-spec.md
§12` (orden B0→B6). Candidato natural: el bloque de hardening (scope
acumulado en `.superpowers/sdd/hardening-backlog.md`) o B6 según la spec.
Confirmar con Michael antes de dispatchear nada.
