# Handoff — Cierre de T5 (COPY)

> Sesiones 2026-08-15 → 2026-08-17. Task T5 del bloque de hardening
> (CORTE punto 5 / plan faro §3 T5). PR #20 mergeado a main por squash
> (`b73c6e8`) el 2026-08-17 tras gate UI cerrado con smoke completo de
> Michael. Branch `feat/hardening-t5` borrada (remota y local).

## 1. Commits del task (orden cronológico)

- `2004521` — docs(t4): precisión F-2 en ledger (versión de next-auth
  en la observación de b4). Micro-fix pre-brief: beta.25 CONFIRMADO
  vía `git show <hash>:pnpm-lock.yaml` (vigente desde `48d554d`
  2026-05-18 hasta el bump a beta.32 en T2 `0f0d44e`).
- `506fd7a` — docs(t5): brief v2 congelado post-filtro + ítems de
  ledger (cap deployed, 401 UX). El brief pasó DOS pases del filtro
  externo (v1 GO con enmiendas E1-E6 + resolución de las 4 OQs por
  Michael; v2 GO para dispatch con micro-ediciones pre-freeze,
  aplicadas antes del freeze).
- `14d3533` — feat(t5): copy — barrido voseo→tuteo (23 hits), manejo
  del 400 en chat-panel (Q-1/Q-2/Q-3 de T3 + limpieza de historial),
  política de idioma por audiencia (OQ-1=A). Tanda única: 21 archivos
  código/tests + 4 docs (reporte, ambas reviews, ledger con los 4
  minors nuevos).
- `b73c6e8` — T5 — COPY (hardening punto 5) (#20). Squash a main por
  Michael.

## 2. Protocolo ejecutado

- Brief con verificación empírica (file:line, greps re-corribles) →
  filtro externo v1 (GO con enmiendas) → v2 con decisiones de Michael
  (OQ-1=A política de idioma por audiencia; OQ-2=a copy signup sin
  número; OQ-3 `errorCodeOf` LOCAL; OQ-4 copy del 400 sin número) →
  segundo pase (GO para dispatch) → micro-ediciones + freeze.
- Implementer FRESCO, tanda única, prefijo supply-chain literal. PARÓ
  en GREEN con árbol sucio, cero git. R-2 source-verified contra
  node_modules (`@ai-sdk/react@3.0.170`: `setMessages` setter puro
  sincrónico; input local del panel; server valida TODOS los mensajes
  de la ventana de 30). Suite 510/510 en 53 archivos, typecheck y
  build verdes, cero installs, cero archivos nuevos de código.
- Doble review CIEGA en carriles separados: **spec PASS limpio** (6
  ítems COMPLIANT verificados contra el working tree; checkpoint 1 —
  la validación de ventana no fue tocada por el diff — y checkpoint 2
  — los dos literales "Sign in required" en tests son autocontenidos —
  ambos PASS) / **quality PASS CON MINORS** (0 MAJOR, 4 MINOR:
  Q-1 envenenamiento residual por camino compuesto, Q-2 restauración
  puede pisar borrador, Q-3 copy 429 duplicado JSX/announcer, Q-4 nota
  teórica de useMemo). Cero MAJOR → SIN fix pass (precedente T3/T4);
  los 4 minors al ledger en el mismo commit.
- Diff crudo completo + ambas reviews + reporte → filtro ESTRICTO
  externo: GO. "Commiteá" de Michael → commit + push + PR #20.
- Reviews y reporte commiteados: `.superpowers/sdd/t5-report.md`,
  `t5-review-spec.md`, `t5-review-quality.md`. Brief frozen:
  `t5-copy-brief.md` @ `506fd7a`.

## 3. Gate de T5 — CERRADO (smoke completo de Michael sobre el preview, 2026-08-17 ~00:00-01:00 CDMX, verificado por Michael y el filtro)

Preview verificado pre-smoke: deploy READY con
`githubCommitRef = feat/hardening-t5` @ `14d3533` (lección T4).

- **Paso 1 (voseo): PASS** — pasada visual completa, cero voseo.
- **Paso 2 (MESSAGE_TOO_LONG): PASS** — copy exacto sin Reintentar,
  mensaje removido del hilo, texto restaurado al input
  (indistinguible de "nunca borrado" por velocidad del 400 —
  esperado), y pregunta corta RESPONDIDA tras DOS 400s consecutivos
  (anti-envenenamiento validado con dos ofensores removidos).
- **Paso 3 (announcer):** cerrado en el gate; evidencia:
  [SLOT — Michael: opción (a) "Verificado por Michael post-merge
  sobre el deployment de main:
  `document.querySelector('p[role=status]').textContent` = copy de
  MESSAGE_TOO_LONG durante el 400 — PASS" / opción (b) "Cerrado con
  la evidencia de la doble review (ambos carriles verificaron la
  simetría del announcer con el render sobre el mismo errorCode);
  sin verificación DOM en vivo — aceptado por Michael como gate"].
- **Paso 4 (ALL_FILES_FAILED): el disparador planificado NO lo
  ejercitó** — hallazgo de producto PRE-EXISTENTE: SheetJS parsea
  texto plano vía fallback CSV → workbook con 0 filas → pipeline
  exitoso → "Procesado / Total 0" en verde para un archivo basura
  (.txt renombrado a .xlsx, slots soriana y amazon). Registrado en el
  ledger (destino: triage pre-Fundadores / hardening .2). El string
  español de ALL_FILES_FAILED tiene cobertura automatizada (suite).
- **Paso 4b (probe cap 10MB):** gate CLIENT-SIDE de 10MB intercepta
  antes de cualquier request ("Tamaño máximo 10 MB (recibido
  11.0 MB)", cero POST en logs de Vercel). El gate client-side no
  estaba en el inventario del brief (premisa del paso 5b incompleta) —
  hallazgo del smoke; ítem del ledger actualizado (la pregunta
  plataforma-vs-app queda abierta SOLO para clientes API, baja
  prioridad).
- **Paso 5 (429): PASS** — hora "6:00 p.m." SIN doble punto.
- **Paso 6 (restauración): PASS** — `chatDailyLimit` restaurado +
  pregunta post-restauración respondida.
- **Bonus CSP (fuera del guión):** dos violations REALES de eval con
  DB SANA en navegación normal, capturadas por csp-report con
  disposition enforce — `/dashboard` 2026-08-17T06:04:40Z y
  `/analisis` 06:52:36Z, mismo chunk `34-09a2e5143d5aa06c.js:16:36104`.
  Páginas funcionales pese al bloqueo. RESPONDE la pregunta abierta de
  T4: SÍ dispara con DB sana, y también en /dashboard. Identificar el
  origen del eval del chunk 34 es ahora PRECONDICIÓN DURA del flip de
  CSP de T6 (ítem del ledger ampliado).

## 4. Pendientes que deja T5 (registrados en el ledger)

- **Minors de la doble review de T5** (sección "T5 — minors de la
  doble review"): Q-1 (envenenamiento residual por camino compuesto —
  destino próximo touch de chat-panel.tsx), Q-2 (restauración puede
  pisar borrador en tipeo — ídem), Q-3 (copy del 429 duplicado
  JSX/announcer — ídem), Q-4 (nota teórica useMemo, sin acción).
- **Hallazgos del smoke:** parse leniente de no-xlsx (ítem nuevo,
  triage pre-Fundadores / hardening .2 — decide Michael); cap 10MB
  client-side (ítem actualizado, lado API a T6 solo si se triagea);
  eval del chunk 34 con DB sana (ítem del flip CSP ampliado,
  precondición dura de T6).
- **Q-2/Q-3/Q-4 de T4 siguen diferidos** a su próximo touch real
  (`app/error.tsx` / `lib/route-errors.ts`) — T5 no tocó esos
  archivos, como declaraba el brief §1.6/§7.
- **Slot del paso 3 del smoke (announcer):** evidencia exacta a
  precisar por Michael (ver §3).

## 5. Estado del repo al cierre

- `main` @ `b73c6e8`, working tree limpio post-cierre. Branch
  `feat/hardening-t5` borrada (remota y local).
- Suite: 510 tests / 53 archivos. CI del squash en main: verificar
  verde (estaba in_progress al momento de escribir este handoff; el
  mismo commit pasó el required check `ci` en el PR).
- Branch nueva `feat/hardening-t6` creada off main; este handoff +
  ledger + plan faro actualizados son su primer commit.

## 6. Próximo task

**T6 — CIERRE DEL BLOQUE (CORTE punto 6, plan faro §3 T6).** Scope:
ZAP baseline contra staging (docker local) + triage conjunto con
Michael (fix inmediato vs "hardening .2") + flip de CSP en prod a
enforced — cuya PRECONDICIÓN DURA es ahora identificar el origen del
eval del chunk `34-09a2e5143d5aa06c.js` (dispara con DB sana en
/dashboard y /analisis; ¿recharts u otro vendor?). Ítems del ledger
con destino T6 acumulados: sweep global del rate limiter + cap de
longitud de key (agravados por csp-report público), triage Q-1 de T4
(P2025 → 500), lado API del cap de 10MB (si se triagea). Primer paso:
brief de T6 con verificación empírica del estado real, al filtro
externo ANTES de cualquier ejecución.
