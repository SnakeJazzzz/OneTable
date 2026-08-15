# Handoff — Cierre de T4 (ROBUSTEZ / OBSERVABILIDAD)

Fecha del handoff: 2026-08-15. T4 COMPLETADO el 2026-08-15 (verificado por
Michael y el filtro externo): PR #19 mergeado a main por squash (`9ef19a1`,
branch `feat/hardening-t4` borrada, remota y local). Este handoff registra
el estado final del gate con su evidencia. Es el primer commit de la branch
`feat/hardening-t5` (patrón de cierres anteriores: los docs de cierre abren
la branch del task siguiente).

## 1. Commits del task (orden cronológico)

- `a056d18` — brief v2 de T4 con enmiendas del filtro E1-E6, las 4 OQs,
  los 3 riders y la estructura resueltos por Michael
  (`.superpowers/sdd/t4-robustez-brief.md`, FROZEN).
- `d0009e8` — **Tanda única** (implementación + ledger + reviews en el
  mismo commit, 43 archivos): `lib/route-errors.ts` NUEVO
  (`withRouteErrors()` + `logRouteError()` — 500
  `{error:{code:'INTERNAL'}}` uniforme + línea de log JSON
  `{source:'api', route, method, name, code, message, stack}` con regla
  `omitMessage`, sin clientId en la línea del wrapper, sin
  AsyncLocalStorage; re-throw del sentinel `DYNAMIC_SERVER_USAGE` — S-2,
  sancionada); wrap de 23/24 rutas API (`auth/[...nextauth]` sin wrap por
  evidencia empírica OQ-1); `core/normalizer/errors.ts` NUEVO
  (`ServiceError` con code) reemplazando los 8 throws de `resolve.ts` y el
  substring-matching de mappings DELETE/PATCH conservando el `throw e`
  (E1); guard de body no-objeto en 6 rutas/verbos (R1: mappings
  POST/DELETE/PATCH, credentials PUT, conflicts POST, thresholds PUT);
  P2003→404 en el upsert de price-overrides PUT (R2); 3 boundaries con
  estilo de la app en tuteo (`app/error.tsx`, `app/global-error.tsx`,
  `app/not-found.tsx`); 5 logs ad-hoc migrados al formato JSON (OQ-4);
  comment del quota lookup del chat actualizado (§4.7); +31 tests.
- `9ef19a1` — squash del PR #19 a main.

## 2. Protocolo ejecutado

- **Implementer fresco, GREEN 510/53** (baseline 479/49; typecheck y build
  limpios), con dos verificaciones empíricas propias:
  - **OQ-1 (nextauth):** throw forzado en `authorize` en dev con flujo
    real CSRF+callback — NADA escapa del handler de NextAuth
    (`@auth/core` 0.41.3 lo captura, loguea `[auth][error]
    CallbackRouteError` por su propio logger y responde 302 →
    `/api/auth/error?error=Configuration` con body vacío, sin stack, sin
    500) → rama sancionada del brief: SIN wrap + comment con evidencia en
    el route file. Probe revertido, `auth.ts` limpio.
  - **global-error en prod-mode local:** `pnpm build` + `pnpm start` con
    throw runtime-only en el root layout (revertido): el shell
    `__next_error__` carga el chunk de global-error con copy y estilos
    inline compilados, cero URLs externas — sin violations posibles bajo
    `style-src 'unsafe-inline'`. Server matado y verificado.
- **Doble review CIEGA** en carriles separados. La PRIMERA corrida fue
  ABORTADA por session limit de la API (ambos agentes murieron a mitad;
  el output parcial del carril spec se marcó descartado y luego se
  eliminó) — se RE-CORRIERON AMBOS carriles frescos y completos.
  Resultado: **APPROVE WITH MINORS ×2, cero MAJOR** → sin fix pass
  (precedente T3); minors S-1..S-4 y Q-1..Q-7 al ledger en el commit.
- **Filtro externo: GO con verificación independiente** — aritmética de
  los +31 tests re-verificada; S-2 confirmada ESENCIAL (sin el re-throw
  del sentinel, el build hornearía las rutas GET estáticas con 500 fijo);
  desviaciones S-2/S-3/S-4 SANCIONADAS por Michael en el gate.
- **S-1 corregido pre-commit:** el brief v2 §1.11 afirmaba que los tests
  de mappings mockeaban throws con substrings; en realidad son de
  INTEGRACIÓN (filas CONFLICTED reales + servicio real que ahora lanza
  `ServiceError` naturalmente) — no había mocks que migrar. Corrección en
  `t4-report.md` §"Drift brief→realidad" y en el ledger; el brief
  commiteado queda FROZEN.
- Reports y reviews commiteados en `.superpowers/sdd/` (`t4-report.md`
  con la tabla E6 de 24 filas, `t4-review-{spec,quality}.md`).

## 3. Gate de T4 — CERRADO (evidencia del smoke (d), verificada por Michael)

Smoke sobre el preview de la BRANCH (alias
`onetable-git-feat-hardening-t4`; Deployment Information con Branch:
`feat/hardening-t4` verificado en cada captura), 2026-08-14 ~23:00 a
2026-08-15 ~10:45 CDMX:

- **Mecanismo (d):** `DATABASE_URL` de Preview rota (string de staging
  `ep-lingering-salad` con credenciales inválidas) + redeploy DE LA
  BRANCH; sesión iniciada ANTES vía el alias estable.
- **`error.tsx` en infra real:** 500 de `/dashboard`, `/analisis` y
  `/portales` (throw del `findFirst` del layout) → card con estilo de la
  app y digest, sin violations de style.
- **500 JSON del wrapper:** `{error:{code:'INTERNAL'}}` verificado en
  browser contra `/api/uploads` y `/api/clients`; líneas
  `{"source":"api","route":"uploads"|"clients","method":"GET",
  "name":"PrismaClientInitializationError", message+stack}` verificadas
  EN VIVO en Runtime Logs (2026-08-15 16:39 UTC, deployment
  `dpl_DcYfhLGxJtZPHUtu4QXrsT6dQp2t`).
- **Bonus:** contratos de csp-report bajo DB caída verificados en vivo —
  fail-open del limiter con log JSON + 204 + report logueado.
- **Build del PR:** las 24 rutas API en ƒ (dinámicas) y `/_not-found`
  estática — el re-throw de `DYNAMIC_SERVER_USAGE` (S-2) funcionando en
  build real.
- **Restauración + e2e:** var restaurada + redeploy de la branch;
  dashboard con datos reales de staging, portales OK, `/api/clients` y
  `/api/uploads` en 200 con payload real, chat con streaming OK,
  not-found custom en URL inexistente.
- **CI del PR: SUCCESS** (re-valida 510/53); Vercel SUCCESS.

**Lección del runbook (d) (registrar para futuros smokes):** las env vars
se HORNEAN por deployment — cambiar `DATABASE_URL` de Preview no afecta
los deployments existentes; el redeploy debe ser DE LA BRANCH bajo prueba.
Los primeros intentos redeployaron el preview de main y el error no
aparecía — quedó documentado como lección: verificar SIEMPRE el Deployment
Information (Branch) antes de leer evidencia de un smoke.

## 4. Pendientes que deja T4 (registrados en el ledger)

- **Minors de la doble review** (sección "T4 — minors de la doble
  review"): Q-1 (P2025 en race de doble-DELETE/PATCH pasó de 404
  accidental a 500 — destino próximo touch de mappings/route.ts o triage
  T6), Q-2 (`reset()` sin `router.refresh()` — próximo touch de
  app/error.tsx; el smoke (d) no puede validar esto: las env vars se
  hornean por deployment), Q-3 (`omitMessage` sin call site de producción
  — próximo touch de lib/route-errors.ts), Q-4 (logRouteError puede
  lanzar con throws exóticos — ídem), **Q-5 (`INTERNAL` vs
  `INTERNAL_ERROR`: DECIDIR ANTES de construir el agente de triage
  post-bloque)**, Q-6 (branch Array.isArray del guard sin test), Q-7
  (`errorResponse` a leaf module — hardening .2), observación
  signup/skus (extender guard R1 — próximo touch de esas rutas).
- **Q-1/Q-2/Q-3 de T3 siguen para T5** (chat-panel.tsx: manejo del 400
  `MESSAGE_TOO_LONG`, copy de reset tras medianoche UTC, a11y del
  announcer) — T4 no tocó el archivo, como declaraba el brief §1.9.
- **HALLAZGO CSP del smoke (NO es de T4; amplió el ítem pre-T6 del
  ledger):** violation real en el error path de `/analisis` — script-src
  bloqueó un `eval` en `/_next/static/chunks/34-09a2e5143d5aa06c.js`
  (chunk de vendor; report completo capturado del csp-report, 2026-08-15
  05:03:44 UTC). Misma familia que el eval de `/promotoria` en
  Report-Only: antes del flip de prod a enforced (T6) hay que identificar
  el origen del eval (¿recharts u otro vendor de /analisis?) y decidir
  fix vs riesgo aceptado. Pregunta abierta: no se verificó si el eval
  también dispara en /analisis con DB sana (el e2e no lo midió).
- **Prerequisito del agente de triage post-bloque: CUMPLIDO** — los logs
  estructurados existen y están verificados en infra real (este gate).
  Resolver Q-5 antes de construirlo.

## 5. Estado del repo al cierre

- `main` @ `9ef19a1`, working tree limpio. Branch `feat/hardening-t4`
  borrada (remota y local).
- Suite: 510 tests / 53 archivos. CI verde en main.
- Branch nueva `feat/hardening-t5` creada off main para el task
  siguiente; este handoff + ledger + plan faro actualizados son su primer
  commit.

## 6. Próximo task

**T5 — COPY (CORTE punto 5, plan faro §3 T5).** Scope: barrido voseo →
tuteo con re-grep (la lista del ledger puede haber crecido — re-verificar
al ejecutar). **T5 toca `chat-panel.tsx`** → entran los minors diferidos
de T3: Q-1 (manejo del 400 `MESSAGE_TOO_LONG`), Q-2 (copy de reset tras
medianoche UTC), Q-3 (a11y del announcer), el punto doble del copy del
429 ("...6:00 p.m..") y Q-5 de T3 (idioma del 429 vs convención inglesa
de la ruta — junto con la decisión de idioma de la familia de errores
per-file de upload). Gate: UI (smoke visual de Michael). Primer paso:
brief con verificación empírica del estado real ANTES de afirmar nada —
brief para filtro externo, cero implementación hasta el go de Michael.
