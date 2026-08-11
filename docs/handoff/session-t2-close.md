# Handoff — Cierre de T2 (SEGURIDAD)

Fecha del handoff: 2026-08-11. T2 COMPLETADO el 2026-08-11 (verificado por
Michael): PR #16 mergeado a main por squash (`0f0d44e`, branch
`feat/hardening-t2` borrada). Este handoff registra el estado final del
gate con su evidencia. Es el primer commit de la branch `feat/hardening-t3`
(patrón de cierres anteriores: los docs de cierre abren la branch del task
siguiente).

## 1. Commits del task (orden cronológico)

- `62bf386` — brief v2 de T2 con enmiendas del filtro (GO), commiteado por
  Michael.
- `ee88699` — **Tanda A** (deps + config): bumps `next` 14.2.35 /
  `eslint-config-next` 14.2.35 / `next-auth` 5.0.0-beta.32; security
  headers siempre-enforced + CSP por entorno (`VERCEL_ENV`) con builder
  puro en `lib/security-headers.ts`; endpoint `POST /api/csp-report`
  (cap 32KB); `session { maxAge: 86400 }` + dummy `bcrypt.compare`
  precomputado; password policy 10 chars / cap 72 bytes.
- `feefc47` — **Tanda B** (data layer): modelo `RateLimit` + migración
  `20260805005159_add_rate_limit` (aditiva); helpers reusables
  `lib/rate-limit.ts` (consume/peek/recordFailure, upsert atómico con
  cleanup lazy en CTE, fail-open); wiring de login (5 fallos/15min por
  email, 20/15min por IP, null genérico anti-oráculo) y signup (429 +
  `RATE_LIMITED` por IP); caps de 10MB en `data/upload` (per-file) y
  `parametros/import` (413 + `FILE_TOO_LARGE`); riders: remoción de
  `@auth/prisma-adapter` (dep muerta) y drop de `updateAge` (no-op bajo
  JWT); runbook `docs/runbooks/t2-migraciones-runbook.md`.
- `0f0d44e` — squash del PR #16 a main.

Protocolo por tanda: implementer fresco → doble review CIEGA en carriles
separados → fix pass → re-review del carril hallador → diff crudo +
outputs al filtro externo de Michael → commit autorizado. Reports y los 4
outputs de review viven commiteados en `.superpowers/sdd/`
(`t2-tanda-{a,b}-report.md`, `t2-tanda-{a,b}-review-{spec,quality}.md`).

## 2. Gate de T2 — CERRADO (evidencia verificada por Michael, 2026-08-11)

- **Migraciones por entorno (§4 del brief):** `prisma migrate deploy` +
  `migrate status` OK contra **staging** (pre-smoke) Y **production**
  (pre-merge; host `ep-muddy-bar`), con strings DIRECTOS de la consola de
  Neon — "Database schema is up to date!" en ambos. En development la
  aplicó el implementer de Tanda B.
- **Smoke de preview** (CSP enforced) completo con console limpia: login,
  signup, upload Portales, dashboard con charts, Parámetros import, chat.
  Smoke de prod (`/analisis`) ídem.
- **csp-report (criterio §10 en dos partes):** (a) POST manual de prueba
  al endpoint de prod → 204 con log visible en Runtime Logs. La
  verificación del log fue con un RE-DISPARO del POST a las 15:06 local
  del 2026-08-11 (Request ID `nstdk-1786482388243`, 204, JSON
  estructurado con blocked-uri de prueba visible en Runtime Logs de
  production); el POST original de ~14:5x dio 204 pero su log ya no era
  buscable por la retención de runtime logs del plan (~1h). Un primer
  404 fue pre-promoción del deployment, benigno. **Nota operativa para
  futuros gates que dependan de logs: la retención de runtime logs es
  ~1h — verificar EN VIVO, no después.**
  (b) violations reales en prod: **CERO**. Ambas cosas son la evidencia
  para el flip de CSP de prod a enforced en T6. (El eval de `/promotoria`
  observado en Report-Only queda como ítem pre-T6 ya registrado en el
  ledger.)
- **Build de production limpio:** next 14.2.35, adapter removido,
  `/api/csp-report` en rutas.
- **Suite:** 461 tests / 49 archivos verdes (baseline pre-T2: 424/44).
- **Audit:** 70 vulns pre-task → 50 al cierre (criticals accionables
  cerrados: middleware bypass de next, fail-open y homoglyph de
  next-auth, y el fantasma de `@auth/core@0.37.4` vía adapter removido).
  Los 2 criticals restantes son de vitest (dev-only). Triage completo en
  el ledger.

## 3. Config humana asociada (hecha por Michael durante el task)

- `.env.local` con string DIRECTO de development (sin `-pooler`) para
  `prisma migrate dev`.
- Vercel Toolbar OFF en pre-production y production (resolución del minor
  de CSP preview vs `vercel.live`).
- Node del proyecto Vercel verificado 24.x (requisito del import `.ts`
  en `next.config.mjs`, ≥22.18).

## 4. Pendientes que deja T2 (registrados en el ledger)

- **Pre-T6:** eval de `/promotoria` visto en Report-Only de prod —
  revisar antes del flip de CSP a enforced (T6, junto con el criterio de
  violations CERO ya satisfecho hoy).
- **Cierre trivial de Tanda A:** primer `pnpm dev` de Michael con browser
  abierto confirma HMR + cero violations CSP en console (la verificación
  in-browser quedó parcial; los smokes de preview/prod no la cubren
  porque el HMR es solo-dev).
- Minors de las dobles reviews de ambas tandas: secciones "T2 Tanda A/B —
  minors de la doble review" del ledger (cap de longitud de key del
  limiter, TTL/sweep global, Retry-After, flake residual de frontera,
  Content-Length pre-check, copy 72 caracteres/bytes, idioma de los
  errores per-file de upload → T5, endurecer asserts de authorize).
- "Automatizar `migrate deploy` (buildCommand o GitHub Action)" —
  BLOQUEADO por el ítem de vars legacy de Vercel.

## 5. Estado del repo al cierre

- `main` @ `0f0d44e`, working tree limpio. Branch `feat/hardening-t2`
  borrada (remota y local).
- Branch nueva `feat/hardening-t3` creada off main para el task
  siguiente; este handoff + ledger + plan actualizados son su primer
  commit.

## 6. Próximo task

**T3 — CHATBOT (CORTE punto 3), gate: cierre = smoke de Michael.**
Parámetros ya decididos en el corte: reusar `consumeRateLimit` de
`lib/rate-limit.ts` con límite por cliente (default 40/día; día = ventana
de 24h ALINEADA, semántica fijada en el brief de T2 §5.1);
`maxOutputTokens` ~2000; cap ~8k chars por mensaje; verificar cache hits
del gateway y si no existen configurar `cache_control`/`providerOptions`;
system prompt anti-invención (recomendaciones cuantitativas SOLO derivadas
de tool results) + fix del framing "cuentas de la plataforma". La
dependencia de créditos del gateway está satisfecha desde T1 (top-up
verificado). Primer paso: brief con verificación empírica del estado real
de `app/api/ai/chat/route.ts` y `core/ai/` ANTES de afirmar nada — brief
para filtro externo, cero implementación hasta el go.
