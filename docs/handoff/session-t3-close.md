# Handoff — Cierre de T3 (CHATBOT)

Fecha del handoff: 2026-08-13. T3 COMPLETADO el 2026-08-13 (verificado por
Michael y el filtro externo): PR #17 mergeado a main por squash (`3ff2438`,
branch `feat/hardening-t3` borrada) + fix post-gate de caching §4.6 en PR
#18 (`67d9d91`, branch `fix/t3-caching-gateway` borrada). Este handoff
registra el estado final del gate con su evidencia. Es el primer commit de
la branch `feat/hardening-t4` (patrón de cierres anteriores: los docs de
cierre abren la branch del task siguiente).

## 1. Commits del task (orden cronológico)

- `2f620a5` — brief v2 de T3 con enmiendas del filtro E1-E4 (GO), las 3
  OQs y los riders resueltos por Michael (`.superpowers/sdd/
  t3-chatbot-brief.md`).
- `5867f82` — **Tanda única**: campo `chatDailyLimit Int @default(40)` en
  `Client` + migración aditiva; quota diaria por cliente en
  `app/api/ai/chat/route.ts` vía `consumeRateLimit` reusado de T2 (scope
  `'chat:client'`, key = clientId de la sesión, ventana fija de 24h
  alineada a la época → 429 `RATE_LIMITED`; path E4: Client inexistente
  con sesión viva → 401, sin invocar modelo ni consumir quota); AMBOS
  caps de tamaño (8000 chars sobre text parts de mensajes user + 64KB
  sobre el JSON de cualquier mensaje de la ventana → 400
  `MESSAGE_TOO_LONG`, un 400 no quema quota); `maxOutputTokens: 2000`;
  system prompt anti-invención (derivación aritmética explícita o
  detenerse; nivel exacto de agregación; framing "cadenas", prohibido
  "cuentas de la plataforma"); cache breakpoint message-level
  (`SystemModelMessage` + `anthropic.cacheControl` — REEMPLAZADO en
  `9cdce38`, ver §3); rate limit por IP del csp-report (scope
  `'csp-report:ip'`, 60/15min, drop silencioso 204); copy específico del
  429 en `chat-panel.tsx` con hora de reset CALCULADA client-side (E3).
- `3ff2438` — squash del PR #17 a main.
- `9cdce38` — **fix post-gate §4.6** (branch `fix/t3-caching-gateway`):
  caching vía `providerOptions: { gateway: { caching: 'auto' } }`,
  anclaje message-level eliminado, vuelta a `system: SYSTEM_PROMPT`
  (string byte-estable). Ver §3.
- `67d9d91` — squash del PR #18 a main.

Protocolo: implementer fresco → doble review CIEGA en carriles separados
(cero MAJOR: el diff fue al filtro externo SIN fix pass) → diff crudo +
outputs al filtro externo de Michael → commit autorizado. El fix §4.6
llevó su propio ciclo: diagnóstico empírico contra el gateway real +
re-review quality de agente fresco (APPROVE WITH MINORS, 0/0/1). Reports
y reviews commiteados en `.superpowers/sdd/` (`t3-report.md`,
`t3-review-{spec,quality}.md`, `t3-caching-fix-report.md`,
`t3-caching-fix-review-quality.md`, `t3-caching-fix-scratch-evidence.md`).

## 2. Gate de T3 — CERRADO (evidencia verificada por Michael y el filtro externo)

- **Migraciones por entorno (runbook T2):** `migrate deploy` OK contra
  **staging** el 2026-08-12 ~20:38 CDMX (host `ep-lingering-salad`,
  string DIRECTO de la consola de Neon) y contra **production** pre-merge
  del PR #17, re-verificado 2026-08-12 ~21:45 con `migrate status`
  "up to date" (host `ep-muddy-bar`).
- **Smoke de calidad (preview del PR #17, 2026-08-12, console sin
  violations CSP): LOS 4 GUIONES PASAN.**
  - (a) Reorden Chilli Lime 86g: se negó a dar cifra, nombró los datos
    faltantes y ofreció los disponibles (caso §1.13.a del brief).
  - (b) Comparación mensual por SKU: parada honesta — declaró que las
    tools solo exponen tendencia por cadena. La rama aritmética quedó
    cubierta por el guión de cadenas: 5 derivaciones verificadas a mano
    por Michael, todas exactas a un decimal (caso §1.13.b).
  - Framing: "cadenas" siempre, nunca "cuentas de la plataforma".
  - 429 práctico: copy en tuteo con hora de reset CALCULADA client-side
    (E3 verificada), sin botón Reintentar, el error se limpia al
    escribir.
  - Bonus no pedido por el guión: declaró la truncación "50 de 1,387"
    filas y se negó a totalizar sin agregación.
- **Suite:** 479 tests / 49 archivos verdes (baseline pre-T3: 461/49).
- **Caching en producción:** evidencia del fix §4.6, ver §3.

## 3. Fix post-gate §4.6 — caching (PR #18, squash `67d9d91`)

El anclaje message-level (`SystemModelMessage` +
`providerOptions.anthropic.cacheControl`) commiteado en el PR #17 dio
**0/0 (cero cache write, cero cache read) en producción** en la
observability del gateway. **Causa: DESCONOCIDA.** Las dos hipótesis
fueron REFUTADAS por el filtro con los CSVs de prod en mano: (1) routing
a provider fallback — falsa, la columna Provider de los 22 requests =
`anthropic` en todos; (2) artefacto de medición del dashboard — falsa,
los costos de prod son precio pleno exacto (un cache read facturaría
0.1x y se nota). El scratch desde afuera SÍ cacheó con el mismo anclaje
(6/6 requests), así que el problema es algo del camino runtime de
prod → gateway, no del mecanismo en sí. Detalle completo:
`.superpowers/sdd/t3-caching-fix-scratch-evidence.md`. **NO reintroducir
el anclaje message-level sin evidencia nueva.**

Reemplazo: `providerOptions: { gateway: { caching: 'auto' } }` — el
mecanismo documentado del gateway, server-side y provider-agnóstico (el
gateway coloca los breakpoints él mismo, sin depender de que las
providerOptions sobrevivan el camino desde el runtime).

**EVIDENCIA EN PRODUCCIÓN (2026-08-13 07:16-07:20 UTC, CSV de 17
requests verificado por el filtro externo con facturación exacta, DOS
conversaciones):** ciclo completo write→read en ambas — Write 11,683 →
5 reads consecutivos (11,683→12,376 con writes incrementales) y Write
11,681 → 3 reads. Requests cacheados $0.0017-0.0032 vs ~$0.0135 sin
cache (~85% de ahorro por request); sesión completa $0.0745 vs ~$0.155
estimado sin caching (52%); promedio $0.00438/request vs baseline
$0.00786 del corte 2026-07-20.

**HALLAZGO documentado (ledger, sección T3 minors):** el `'auto'` del
gateway tiene umbral de tamaño — prompts de ~3-3.8K tokens no se marcan
para cache, ~12K sí. El residual (requests cortos sin cachear, ~$0.002
c/u, acotado por el cap de 40/día) es ACEPTADO por Michael, con trigger
de revisión si el costo del chat pesa a escala Founders.

## 4. Config humana asociada (hecha por Michael durante el task)

- `migrate deploy` en staging (pre-smoke) y production (pre-merge) con
  strings directos de la consola de Neon (§2).
- Guión del 429: bajó `chatDailyLimit` del Client de prueba en staging
  vía SQL para disparar el 429 y RESTAURÓ el valor al terminar —
  verificado que TODO quedó en 40.
- Deployments de producción confirmados Current en ambas mediciones de
  caching (3ff2438 y 67d9d91, screenshots del dashboard).

## 5. Pendientes que deja T3 (registrados en el ledger)

- **Minors de la doble review** (sección "T3 — minors de la doble
  review"): S-1 (botón Reintentar oculto solo en RATE_LIMITED), Q-1
  (panel sin manejo del 400 `MESSAGE_TOO_LONG`), Q-2 (copy de reset
  invertido al cruzar medianoche UTC), Q-3 (a11y del announcer) — Q-1/
  Q-2/Q-3 con destino "próximo touch de chat-panel.tsx (T4 o T5)"; Q-4
  (sin pre-check de Content-Length), Q-5 (429 en español vs convención
  inglesa → T5), Q-6 (propiedades del limiter expuestas en endpoint sin
  auth → destino T6, candidato sweep piggyback en el workflow de
  backup), Q-7/Q-8 (tests), F-1 (assert de providerOptions solo en el
  primer doStreamCall).
- **Minor E2 nuevo:** residual de ventana total ~30×64KB ≈ 1.9MB por
  request; candidato futuro: cap de ventana TOTAL.
- **Observación §4.6:** umbral de tamaño del gateway caching 'auto' +
  prohibición de reintroducir el anclaje message-level sin evidencia
  nueva (§3).
- **Copy para T5:** el copy del 429 termina en punto doble
  ("...6:00 p.m..").
- **Producto (chatbot que inventa, EN OBSERVACIÓN):** T3 endureció el
  prompt y el smoke pasó, pero se observó deriva residual post-fix
  ("41.0%" para un valor real de 40.8%) — el ítem queda en observación
  con uso real de VIKS.
- **Producto (familia getDefaultPeriod):** falta tool de agregación
  server-side por tienda/SKU y de comparación mensual por SKU — la
  agregación en-contexto de filas crudas es frágil por diseño (totales
  de "mejor tienda" divergentes entre corridas). Re-evaluar con VIKS.

## 6. Estado del repo al cierre

- `main` @ `67d9d91`, working tree limpio. Branches `feat/hardening-t3`
  y `fix/t3-caching-gateway` borradas (remotas y locales).
- Branch nueva `feat/hardening-t4` creada off main para el task
  siguiente; este handoff + ledger + plan actualizados son su primer
  commit.

## 7. Próximo task

**T4 — ROBUSTEZ / OBSERVABILIDAD (CORTE punto 4, plan faro §3 T4).**
Scope: error boundaries (`error.tsx`, `global-error.tsx`, `not-found.tsx`
con estilo de la app); sweep `withRouteErrors()` + error codes/classes
en los services en UNA sola pasada por rutas (rutas clase b/c ya
listadas en el ledger); logs estructurados con contexto en el error
path. Gate ESTRICTO (toca todas las rutas). Primer paso: brief con
verificación empírica del estado real ANTES de afirmar nada — brief
para filtro externo, cero implementación hasta el go de Michael. Al
tocar `chat-panel.tsx` considerar los minors Q-1/Q-2/Q-3 de T3 (destino
"T4 o T5, lo que llegue primero").
