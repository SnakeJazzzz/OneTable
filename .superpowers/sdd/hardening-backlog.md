# Hardening backlog — post-merge bloque B (creado 2026-07-15, B-4)

> Sucesor de `b4-followups.md` (cerrado 2026-07-15). Cada ítem migrado cita
> su origen; el texto de los migrados es VERBATIM del ledger anterior.
> Tracked pero gitignored: `git add -f` SIEMPRE.

> **RE-GROUNDING 2026-07-17 (cierre de Fase 2, kickoff hardening):** los 20
> ítems pre-existentes fueron verificados uno por uno contra el repo real
> (main @ a5fc3ae). TODOS siguen vigentes; ninguno fue vuelto obsoleto por
> B5. Evidencia re-verificada de los accionables por código:
> - Substring error-matching: `app/api/portales/mappings/route.ts:75,78,115,118,121,124`.
> - TOCTOU price-overrides PUT: `findFirst` en `route.ts:126` → `upsert` en `:141`.
> - Guard body no-objeto: existe en `price-overrides/route.ts:96`; sigue
>   AUSENTE en `mappings/route.ts` y `credentials/route.ts` (grep `typeof body`).
> - `parsePriceInput` sigue con `String(raw)` (`lib/prices.ts:34-45`) —
>   arrays de un elemento pasan.
> - Spread de `input` en los 7 execute de `core/ai/tools/*.ts` (grep `...input`).
> - Dup slice/totalRows: `get-onetable-rows.ts:44-45` y `get-days-of-inventory.ts:42-43`.
> - Q-8 acoplado al orden: `pUpdate` reusado en
>   `tests/api/portales-price-overrides.test.ts:246,300,306`.
> - Flush mágico de 5 microtasks: `tests/ai/tools.test.ts:517`.
> - Hooks sin in-flight: `lib/hooks/use-portales.ts` usa refreshKey y no tiene
>   `AbortController` (los hooks de dashboard/onetable sí lo tienen).
> - Hint de precio: inputs con `inputMode="decimal"` pero sin validación
>   preventiva (`components/portales/price-override-section.tsx:133-148`).
> - Voseo: re-grep 2026-07-17 → 11 hits en los mismos 10 archivos listados.
> - Chat: trim de CANTIDAD en `app/api/ai/chat/route.ts:108-112`; sigue sin
>   rate limit ni cap de tamaño.
> Los ítems de infra (DB compartida, pre-prod, preflight branch, backups) no
> son verificables por código pero siguen vigentes por confirmación de estado.

## CORTE DE SCOPE — decidido por Michael 2026-07-20

> Decidido por Michael con su sparring externo (2026-07-20). Ordenado por
> valor; cortable desde abajo. Los ítems del backlog NO incluidos en este
> corte conservan su gate/disparador original en las secciones de abajo.

1. **ENTORNOS + DEVOPS.** **[COMPLETADO 2026-07-29 — PR #15 mergeado a
   main (`936b8d1`). Gate cerrado con evidencia: (a) guard bloqueando
   production/staging + suite verde contra development (44 archivos, 424
   tests); (b) health 200 `{"status":"ok","db":"up"}` en preview y prod;
   (c) backup dry-run manual post-merge con artifact descifrado y
   `pg_restore --list` OK. UptimeRobot activo sobre `/api/health` de prod.
   Detalle: handoff `session-t1-close.md`.]** Branches de Neon
   production/staging/dev con
   `DATABASE_URL` por entorno en Vercel (production/preview/development).
   Backups: verificar retención PITR del plan de Neon + GitHub Action cron
   semanal de pg_dump cifrado. El smoke de Michael sobre la URL de preview
   del PR se vuelve gate obligatorio pre-merge (documentar la regla en
   CLAUDE.md dentro del task). `/api/health` con check de DB + monitor
   externo (UptimeRobot) con alerta a Michael. Piggyback: branch de
   preflight (pendiente #2 de CLAUDE.md). Estrategia confirmada:
   trunk-based + previews de Vercel (NO branch development permanente).

2. **SEGURIDAD.** **[COMPLETADO 2026-08-11 — PR #16 mergeado a main
   (`0f0d44e`), branch borrada. Dos tandas con doble review ciega + fix
   pass cada una (reports y reviews commiteados en `.superpowers/sdd/`).
   Gate cerrado con evidencia: migrate deploy + status OK en staging Y
   production (strings directos de consola de Neon) pre-smoke/pre-merge;
   smoke de preview completo con CSP enforced y console limpia; smoke de
   prod (/analisis) ídem; POST manual al csp-report de prod → 204 con log
   en Runtime Logs; violations reales en prod: CERO (el eval de
   /promotoria en Report-Only queda como ítem pre-T6. **AMPLIADO por el
   smoke de T4, 2026-08-15:** violation CSP REAL en el error path de
   `/analisis` bajo enforced — script-src bloqueó un `eval` en
   `/_next/static/chunks/34-09a2e5143d5aa06c.js`, chunk de VENDOR;
   report completo capturado del csp-report 2026-08-15 05:03:44 UTC.
   Misma familia: el eval de vendor también es alcanzable desde
   /analisis bajo error path con CSP enforced. Antes del flip de prod a
   enforced en T6: identificar el origen del eval (¿recharts u otro
   vendor de /analisis?) y decidir fix vs riesgo aceptado.
   **AMPLIADO por el smoke de T5 (bonus, 2026-08-17):** dos violations
   REALES de eval con DB SANA en navegación normal, capturadas por
   csp-report con disposition enforce — `/dashboard`
   2026-08-17T06:04:40Z y `/analisis` 06:52:36Z, MISMO chunk
   `34-09a2e5143d5aa06c.js:16:36104`. Páginas funcionales pese al
   bloqueo. La pregunta abierta de T4 ("¿dispara con DB sana?") queda
   RESPONDIDA: SÍ, y también en /dashboard — no es exclusivo del error
   path. Identificar el origen del eval del chunk 34 es PRECONDICIÓN
   DURA del flip de T6. Puntero:
   `docs/handoff/session-t4-close.md` §4 y
   `docs/handoff/session-t5-close.md` §3). Suite 461/49.
   Audit: 70 → 50 vulns (criticals accionables cerrados; restantes
   triageados en este ledger). Detalle:
   `docs/handoff/session-t2-close.md`.]** `next` 14.2.18 → 14.2.35 con protocolo supply-chain
   completo + verificación post-bump (grep de páginas RSC que consulten DB
   sin `requireAuth` propio — determina el blast radius real del CVE de
   middleware; re-run de `pnpm audit` registrando los highs restantes).
   Security headers en `next.config.mjs`: nosniff, anti-iframe
   (frame-ancestors), Referrer-Policy, Permissions-Policy ENFORCED en
   todos los entornos. CSP: enforced en staging/preview desde el inicio,
   report-only en producción, flip de prod a enforced en cuanto los smokes
   de staging estén limpios (prod no tiene usuarios reales hasta post-Fase
   3 — decisión de Michael 2026-07-20). `session.maxAge` 24h + `updateAge`
   ~1h (logout por ~1 día de inactividad). Auth: dummy `bcrypt.compare`
   para email inexistente (timing) + rate limit de login por email/IP con
   contador en Postgres + password policy (mín 10 chars, cap 72 bytes por
   truncado de bcrypt). Cap de 10MB pre-parse en `data/upload` y
   `parametros/import`.

3. **CHATBOT.** **[COMPLETADO 2026-08-13 — PR #17 mergeado a main
   (`3ff2438`) + fix post-gate de caching §4.6 en PR #18 (`67d9d91`);
   branches borradas. Tanda única con doble review ciega (cero MAJOR —
   diff al filtro sin fix pass); el fix §4.6 con su propio ciclo
   (diagnóstico empírico + re-review quality, APPROVE WITH MINORS).
   Gate cerrado con evidencia: migrate deploy + status OK en staging
   (2026-08-12 ~20:38 CDMX, ep-lingering-salad) Y production (pre-merge,
   re-verificado ~21:45, ep-muddy-bar) con strings directos de consola
   de Neon; smoke de calidad en preview (console sin violations CSP) con
   LOS 4 GUIONES PASADOS (reorden: se negó a inventar cifra; comparación
   mensual por SKU: parada honesta; framing "cadenas" nunca "cuentas de
   la plataforma"; 429 con copy en tuteo y hora calculada client-side,
   sin Reintentar; bonus: declaró truncación "50 de 1,387" y se negó a
   totalizar sin agregación); caching write→read VERIFICADO EN
   PRODUCCIÓN (2026-08-13, CSV de 17 requests con facturación exacta,
   dos conversaciones con ciclo completo; ~85% de ahorro por request
   cacheado, 52% en la sesión). Suite 479/49. Detalle:
   `docs/handoff/session-t3-close.md`.]** Rate limit por usuario con contador Postgres, límite leído
   de config por cliente (default 40/día, preparado para planes futuros) —
   MISMO mecanismo que el rate limit de login, se construye una vez.
   `maxOutputTokens` ~2000. Cap ~8000 chars por mensaje. Modelo YA
   VERIFICADO por Michael en la observability del gateway (2026-07-20:
   `anthropic/claude-haiku-4.5`, 28 requests, $0.22 — sin drift de config;
   el costo por request es consistente con CERO caching), así que la tarea
   restante es verificar cache hits y, si no existen, configurar
   `cache_control`/`providerOptions` explícito. Anti-invención en system
   prompt: recomendaciones cuantitativas SOLO derivadas aritméticamente de
   tool results — si no puede, debe decirlo y detenerse; incluye el fix
   del framing "cuentas de la plataforma". Cierre = smoke de Michael.
   **DEPENDENCIA (2026-07-29, H3 del smoke T1): créditos activos del AI
   Gateway** — la verificación de cache hits y el smoke del chat los
   requieren (hoy el gateway rechaza el modelo por billing, 403
   RestrictedModelsError; top-up pendiente de Michael). El rate limit de
   este task es además la protección de ese saldo. **DEPENDENCIA
   SATISFECHA 2026-07-29 (cierre de H3): top-up de $20 USD hecho, chat
   verificado funcionando en preview y prod. El rate limit sigue siendo
   la protección del saldo.**

4. **ROBUSTEZ / OBSERVABILIDAD.** **[COMPLETADO 2026-08-15 — PR #19
   mergeado a main (`9ef19a1`), branch borrada. Tanda única con doble
   review ciega (APPROVE WITH MINORS ×2, cero MAJOR — diff al filtro
   sin fix pass; la primera corrida de reviews abortó por session limit
   y se re-corrió completa). Gate cerrado con evidencia del smoke (d)
   sobre el preview de la BRANCH (2026-08-14/15): DATABASE_URL de
   Preview rota + redeploy de la branch → `error.tsx` con estilo de la
   app en /dashboard//analisis//portales, 500 JSON
   `{error:{code:'INTERNAL'}}` en /api/uploads y /api/clients con
   líneas de log estructurado (`source:'api'`, route, method,
   PrismaClientInitializationError) verificadas EN VIVO en Runtime
   Logs; 24 rutas ƒ en build (re-throw DYNAMIC_SERVER_USAGE
   funcionando); e2e completo post-restauración. CI re-valida 510/53.
   `withRouteErrors` en 23/24 rutas — `auth/[...nextauth]` SIN wrap por
   evidencia empírica OQ-1 (nada escapa del handler de NextAuth).
   Desviaciones S-2/S-3/S-4 sancionadas; S-1 corregido en el reporte
   (brief frozen). Minors Q-1..Q-7 en la sección "T4 — minors de la
   doble review". Detalle: `docs/handoff/session-t4-close.md`.]**
   Error boundaries (`error.tsx`,
   `global-error.tsx`, `not-found.tsx` con estilo de la app). Sweep
   `withRouteErrors()` + error codes/classes en los services en UNA SOLA
   pasada por rutas (rutas clase b/c ya listadas en este backlog). Logs
   estructurados con contexto en el error path.

5. **COPY.** Barrido voseo → tuteo (greps de este backlog, re-verificar
   al ejecutar). **RESUELTO por T5 (PR #20, squash `b73c6e8`,
   2026-08-17):** barrido 23 hits / 15 archivos + Q-1/Q-2/Q-3 de T3 en
   chat-panel (400 con limpieza de historial, hora por error,
   announcer) + política de idioma por audiencia (OQ-1=A) + copy de
   signup (OQ-2=a). Gate UI cerrado con smoke completo de Michael.
   Detalle: `docs/handoff/session-t5-close.md`.

6. **CIERRE DEL BLOQUE.** Scanner baseline (OWASP ZAP) contra staging +
   triage de hallazgos con Michael (fix inmediato vs "hardening .2") +
   flip de CSP en prod a enforced.

### Fuera del bloque, con destino

- **xlsx build vendored del CDN** — pre-Fundadores; mitigación interim =
  cap de 10MB (punto 2).
- **Enumeración de signup (409 EMAIL_TAKEN)** — Fase 2.5, rediseño de
  signup con landing/cuentas.
- **Integración del dominio `onetable.mx`** (comprado 2026-07-27) — Fase
  2.5, tarea propia con smoke. Decisiones abiertas: apex vs www canónico,
  scope Production-only, DNS del registrar .mx (A/CNAME manual vs
  nameservers a Vercel).
- **Identidad visual** — pre-Fundadores.
- **Sentry** — evaluar POST-sweep de errores; criterios: se escapan
  errores en la práctica con logs+Vercel, el dep tree pasa supply-chain
  al install, el free tier alcanza.
- **Agente de triage de errores sobre logs** — experimento post-bloque;
  prerequisito: logs estructurados del punto 4; el reporte es el valor,
  el fix sigue pasando por el loop.

## Rutas / services

- [x] **Sweep de error codes/classes en services y rutas.** **RESUELTO
      por T4 (PR #19, `9ef19a1`, 2026-08-15):** los tres frentes en una
      sola pasada — (1) substring error-matching reemplazado por
      `ServiceError` con code (`core/normalizer/errors.ts`) en los 8
      throws de `resolve.ts` + mapeo por `instanceof` en mappings
      DELETE/PATCH conservando el `throw e` (E1); (2) TOCTOU de
      price-overrides PUT: catch local P2003→404 `PRODUCT_NOT_FOUND` en
      el upsert (el deleteMany no puede violar la FK); (3) guard de body
      no-objeto EXTENDIDO de los 2 listados a 6 rutas/verbos (mappings
      POST/DELETE/PATCH, credentials PUT, conflicts POST, thresholds
      PUT). Nota: Q-1 de T4 registra un residuo nuevo de la migración
      (P2025 en race de doble-DELETE pasó de 404 accidental a 500) — ver
      sección "T4 — minors". Incluía tres
      frentes de la misma familia:
      - (origen: b4-followups §11.5a-fix/11.6a/11.6b) **Substring
        error-matching in route throw-mapping (DELETE + PATCH):**
        `msg.includes(...)` against service error messages is
        brittle-by-design cosmetic debt (was consistency-preserving in
        11.5b/11.6b, deliberately NOT "improved" there). Sweep option: error
        codes/classes on the service throws.
      - (origen: b4-followups B-2 Q-5) **TOCTOU ownership→upsert en
        price-overrides PUT**: Product borrado entre findFirst y upsert →
        P2003 → 500 crudo. Mismo check-then-act que mappings POST (paridad
        deliberada), ventana milimétrica. Sin acción en B-2; candidato al
        sweep de error codes/classes ya registrado para las rutas.
      - (origen: hallazgo Q-1 de B-2, fixeado SOLO en price-overrides)
        **Guard de body no-objeto en mappings POST y credentials PUT**: un
        body JSON válido pero no-objeto (`null`, string, número, bool) tira
        TypeError en el acceso a propiedades → 500 crudo sin shape
        `{error}`. price-overrides ya tiene el guard (B-2 fix pass);
        replicarlo en las rutas hermanas.
- [ ] (origen: b4-followups B-2 Q-7) **parsePriceInput acepta arrays de un
      elemento** (`String([5])` → "5"): coerción heredada verbatim de
      parametros, paridad deliberada. Endurecer a `string | number | null`
      cuando se endurezca el helper (la unificación ya se hizo en B-3 A1;
      queda solo el endurecimiento de tipos).
- [ ] (origen: b4-followups B-3 M-1) **Test Q-8 acoplado al orden**: el test
      de precio numérico reusa el fixture `pUpdate` y deja muerta la rama
      create del test de upsert si se reordena. Desacoplar fixtures cuando
      se vuelva a tocar el archivo (tests/api/portales-price-overrides.test.ts).
- [ ] (origen: review quality T1 B5) **Spread de `input` en los execute de
      `core/ai/tools/` propaga claves no declaradas** hacia los params de
      query si se bypassea la validación del SDK. Defensa de tercera capa:
      construir los params explícitamente por clave. Hoy inocuo — los
      schemas `.strict()` + el test de orden de inyección (ctx spread al
      final) ya cubren; el riesgo es futuro (si una query gana un param
      opcional, una clave inyectada en modo bypass pasaría a controlarlo).
- [ ] (origen: review quality T1 B5) **Bloque slice/totalRows duplicado**
      entre `get-onetable-rows.ts` y `get-days-of-inventory.ts` (cap D-1 +
      `totalRows` + `rows.slice`): dedup en un helper compartido (p.ej.
      `capRows(rows, limit)` en `core/ai/tools/context.ts`, donde ya viven
      los schemas y helpers) la próxima vez que se toque el módulo.

## Hooks / UI

- [ ] **Señal de in-flight en los hooks de use-portales** — una mejora, tres
      síntomas registrados:
      - (origen: b4-followups B-2 Q-2) **Race de refetch compartido entre
        saves de filas distintas** (price-override-section +
        useChainPriceOverrides): dos saves dentro de un RTT pueden dejar el
        estado del hook en la respuesta stale (la data persistida es
        correcta; se auto-repara al próximo refetch/remount). Deuda de
        patrón compartida con los hooks hermanos sin señal de in-flight.
      - (origen: b4-followups FF-2) **Ventana residual si el refetch del
        POST falla**: retry vía refreshKey hace setError(null) sincrónico →
        render transitorio sin error con data stale que puede limpiar el
        notice antes del retry. Solo pierde feedback, no corrompe estado.
        Causa raíz: hooks sin señal de in-flight (pre-existente).
      - Contexto relacionado (nota cerrada "documentado, sin acción" en el
        ledger): el notice de la rama conflict aparece un round-trip después
        (tradeoff deliberado del reorden anti-race, en comentario en código).
- [ ] **NUEVO (evidencia: smoke de B-3, 2026-07-15, log de pnpm dev de
      Michael): cada mutación de mapping dispara 5-6 GETs de refetch**
      (mappings + suggestions + conflicts + counts, con duplicados) — costo
      del patrón refreshKey sin dedup. Misma familia que la señal de
      in-flight; el log del smoke es la evidencia para dimensionar el fix
      (dedup/coalescing de refetches, o un fetch agregado por card).
- [ ] (origen: decisión post-smoke B-3, cierre de M-2) **Hint client-side de
      validación de precio**: el server ya rechaza con mensaje preciso ("El
      precio debe ser un número no negativo, con máximo 2 decimales."); el
      hint preventivo en el input (pattern/title o validación en onChange)
      quedó explícitamente diferido a hardening. La auto-corrección de input
      fue RECHAZADA por decisión (no fabricar números que el usuario no
      tipeó).

## Observabilidad / prod

- [x] **Errores técnicos crudos de cara al usuario.** Evidencia registrada:
      en prod, `/api/auth/callback/credentials` devuelve stack trace crudo
      en el error path (docs/handoff/session-b4-followups-end.md:65-67).
      Barrido: error boundaries + mensajes de usuario en rutas y páginas;
      los 500 con shape `{error}` uniforme ya existen en las rutas de
      Portales/Parámetros — el gap es auth y páginas server-side.
      **RESUELTO por T4 (PR #19, `9ef19a1`, 2026-08-15):** rutas API
      cerradas por el wrapper (invariante 24/24, 500 JSON uniforme) y
      páginas por los boundaries (`error.tsx`/`global-error.tsx`/
      `not-found.tsx`). El residuo de auth quedó resuelto POR EVIDENCIA
      (OQ-1): NextAuth 5.0.0-beta.32 / @auth/core 0.41.3 maneja los
      throws de authorize internamente — 302 a /api/auth/error con body
      vacío, sin stack (verificación empírica del implementer, throw
      forzado con flujo real CSRF+callback; la observación de
      b4-followups era con next-auth 5.0.0-beta.25 — versión vigente en
      el lockfile desde `48d554d` (2026-05-18) hasta el bump a beta.32
      en T2 (`0f0d44e`), verificada vía `git show <hash>:pnpm-lock.yaml`
      — y no se reprodujo con beta.32). Sin wrap: sería código
      inalcanzable.
- [x] **DB de prod separada + backups.** Hoy dev y beta comparten la Neon
      dev DB. Database/branch de prod separada, backups automáticos.
      Fundamento actualizado 2026-07-20: por DISEÑO (dev/tests no deben
      poder truncar la DB que servirá prod), no por urgencia de VIKS
      (arranca uso real post-Fase 3); el trigger de "operaciones
      destructivas requieren OK explícito" (ya en CLAUDE.md) sigue siendo
      el EVENTO de data real cargada. **RESUELTO por T1 (2026-07-29):
      entornos Neon por scope + backup diario cifrado verificado
      restaurable — ver CORTE punto 1 y session-t1-close.md.**
- [x] **Ambiente de pre-producción** para smoke de deploys antes de
      promover a prod. **RESUELTO POR DISEÑO en T1: preview de Vercel
      contra staging fija + smoke obligatorio pre-merge cumple la función
      de pre-prod (decisión del corte: trunk-based, sin ambiente
      adicional).**
- [x] **OBSOLETO 2026-07-20 (decisión de Michael, T1):** (origen: pendiente
      #2 de CLAUDE.md, confirmado inexistente 2026-07-15) ~~Segunda Neon
      branch para preflight DB — junto con la DB de prod separada; necesaria
      solo si se reusa scripts/preflight.ts.~~ El preflight quedó reemplazado
      por la arquitectura de entornos de T1 (production/staging/development +
      CI standalone con postgres efímero); `scripts/preflight.ts` es LEGACY
      (header de advertencia agregado en T1) y NO se corre. No se crea branch
      de preflight. Pendientes #1 y #2 de CLAUDE.md cerrados como obsoletos.
- [ ] (origen: brief T1 B5 §6, diferido por decisión) **Rate limiting por
      usuario del chat IA** (`/api/ai/chat`): cada mensaje dispara hasta 5
      steps de modelo + queries; sin límite por usuario el costo es
      open-ended. Diseñar junto con el resto de límites de prod.
- [ ] (origen: review quality T2 B5) **Cap de TAMAÑO en el chat IA**
      (`/api/ai/chat`): el cap C1 acota CANTIDAD de mensajes (30) pero no
      TAMAÑO por mensaje — un mensaje de megabytes pasa entero al modelo.
      Evaluar cap de bytes/chars por mensaje o por ventana cuando se haga
      el hardening del chat (junto con el rate limiting del ítem anterior).
- [ ] (origen: filtro externo T5 v2, 2026-08-15) **Verificar
      alcanzabilidad real del cap per-file de 10MB de data/upload en
      deployed**: el límite de payload de las serverless functions de
      Vercel podría interceptar el request ANTES de que corra el cap de
      la app. **ACTUALIZADO por el smoke de T5 (paso 5b, 2026-08-17):
      RESPONDIDO para la UI** — existe una validación CLIENT-SIDE en el
      dropzone que corta a los 10MB ANTES de cualquier request
      (evidencia: mensaje client-side "Tamaño máximo 10 MB (recibido
      11.0 MB)", CERO POST en los logs de Vercel). Cap del server y
      límite de plataforma son INALCANZABLES desde la UI; la pregunta
      plataforma-vs-app queda abierta SOLO para clientes API (baja
      prioridad; medible con curl autenticado si se necesita). Nota de
      auditoría: el gate client-side NO estaba en el inventario del
      brief de T5 (premisa del paso 5b incompleta) — hallazgo del
      smoke; el brief queda frozen. Relacionado con el pre-check de
      Content-Length ya diferido a T6. Destino: T6 (solo el lado API,
      si se triagea que vale).
- [ ] (origen: filtro externo T5 v2, 2026-08-15) **Deuda UX del 401
      inline**: con sesión expirada, las secciones muestran el error como
      message crudo en vez de redirigir a login. T5 solo traduce el
      string. Destino: Fase 2.5 (rediseño con landing/cuentas).

## Infra de tests

- [ ] (origen: b4-followups harness 2026-07-02, texto verbatim) **Isolated
      DB/schema per process for concurrent local test runs — infra, NOT a
      Task 13/CI blocker.** Root cause (empirically confirmed): running two
      `pnpm test` processes at once against the shared Neon dev DB → one
      process's seed `TRUNCATE ... RESTART IDENTITY CASCADE`
      (tests/seed/seed.test.ts → scripts/seed.ts main()) deletes the
      Client/Product rows the other's inserts FK-reference →
      `*_clientId_fkey` violations (~4-7/run; reproduced 2x concurrent →
      both failed). A SINGLE process is deterministically green (187/187,
      10/10 on a faithful postgres:16 CI mirror). **CI is immune** —
      `.github/workflows/ci.yml` runs ONE `ci` job with a dedicated
      ephemeral `postgres:16` service + a single `pnpm test` step (not the
      shared dev DB), no matrix/sharding. The flakiness we observed was an
      ORCHESTRATION artifact (parallel review agents each running the suite
      on the shared dev DB), NOT a CI or test-code defect. Config-layer
      isolation is blocked on this stack: the normalizer issues UNqualified
      raw SQL that resolves via `search_path` (so a per-file Postgres schema
      does not isolate it), and the local Neon dev DB does not permit
      `CREATE DATABASE`. Real fix = a dedicated database/connection string
      per test process, wired through dev + CI env. Documented inline in
      `vitest.config.ts` (commit b6348e8). Only needed if concurrent local
      suites are ever run; CI never needs it.


- [ ] (origen: re-review quality T1 B5, 2026-07-16) **Flush de microtasks
      mágico en el test de concurrencia de cuts** (`tests/ai/tools.test.ts`):
      el test hace flush de 5 iteraciones de microtasks, número acoplado a la
      profundidad actual de awaits del código bajo test — si la cadena de
      awaits crece, el test puede volverse flaky/falso-verde. Reemplazar por
      un gate determinista (promise diferida que los dos paths awaiten) si se
      vuelve a tocar el archivo.

## Pre-lanzamiento

- [ ] (origen: decisión de Michael 2026-07-15, cierre del pendiente Emerald
      de CLAUDE.md) **Pasada de identidad visual pre-lanzamiento comercial**:
      re-decidir el theme completo — incluye el `--primary` actual
      (`142 71% 45%`, aceptado como definitivo para la beta; el target
      `160 84% 39%` del brainstorm quedó descartado) y el bloque `.dark`
      inexistente (hoy dark-first vía `:root`, sin modo claro). Solo si/
      cuando haya pasada de identidad visual; no es deuda de la beta.


- [ ] (origen: smoke T2 B5, observación de producto, 2026-07-16)
      **`getDefaultPeriod` prefiere el período más reciente con ≥2 cadenas
      sobre uno MÁS reciente con 1 sola.** Observado en el smoke: enero 2026
      elegido sobre marzo 2026 (que solo tiene Soriana). Comportamiento POR
      DISEÑO (S12.1), correcto para el dashboard; para el chatbot ("¿cuánto
      vendí este mes?") puede sorprender — el usuario puede esperar el mes
      calendario más reciente con data, no el más rico. Re-evaluar con uso
      real de VIKS. Pregunta de producto, NO bug.
      **Nota adjunta (smoke prod 2026-08-13, misma familia de resolución
      de período):** salto de período marzo→enero observado en prod tras
      un upload.

- [ ] (origen: smokes T3 2026-08-12/13, observación de PRODUCTO — familia
      getDefaultPeriod, re-evaluar con uso real de VIKS) **Faltan tools de
      agregación server-side por tienda/SKU y de comparación mensual por
      SKU en el chatbot.** Hoy el modelo agrega EN CONTEXTO sobre filas
      crudas de `getOneTableRows` — frágil por diseño. Evidencia
      acumulada de los smokes: totales de "mejor tienda" divergentes
      entre corridas (53u/$7,301.51 vs 69u/$8,773.50 para AGUILAS;
      $5,325 vs ~$7,325 en corridas previas), veredictos de "peor
      tienda" distintos entre corridas, y una suma con deriva de $0.01.
      El prompt anti-invención de T3 hace que el bot declare la
      truncación y se niegue a totalizar sin agregación (comportamiento
      correcto), pero la capacidad falta. Candidato: tools de agregación
      server-side + comparación mensual por SKU. Pregunta de producto,
      NO bug.

- [x] (origen: decisión de Michael 2026-07-16, review externa del diff
      ESTRICTA de T3 B5 / O1 del carril spec) **Pasada de copy es-MX
      pre-lanzamiento: voseo → tuteo mexicano en TODO el copy de producto.**
      **RESUELTO por T5 (PR #20, squash `b73c6e8`, 2026-08-17):**
      barrido completo — el inventario real al ejecutar fue 23 hits
      accionables en 15 archivos (la lista de abajo, de 2026-07-16,
      había quedado corta y con líneas corridas; inventario definitivo
      en el brief frozen `.superpowers/sdd/t5-copy-brief.md` §1.1).
      Cierre verificado con 3 greps (dirigido + tilde final + presente
      -ás/-és/-ís). El idioma de la familia per-file de upload quedó
      resuelto por la política por audiencia (OQ-1=A): per-file +
      ALL_FILES_FAILED + PRODUCT_NOT_FOUND + UNAUTHORIZED de
      auth-helpers → español tuteo; plumbing dev-facing declarado en
      inglés (brief §4.4). Gate UI cerrado con smoke de Michael.
      Registro histórico de la lista original:
      Regla nueva del proyecto: todo el copy en español mexicano (tuteo).
      El copy nuevo de T3 (chat-panel, forecast-card, secciones de Análisis)
      ya se corrigió en T3 mismo. Voseo PRE-EXISTENTE detectado por grep
      (2026-07-16), pendiente de barrido:
      `app/api/parametros/import/route.ts:51` ("Verificá"),
      `app/(auth)/signup/page.tsx:151` ("tenés"),
      `app/(auth)/login/page.tsx:97` ("tenés"),
      `app/(dashboard)/analisis/page.tsx:73` ("Subí", línea pre-T3),
      `components/dashboard/dashboard-empty.tsx:17` ("Subí"),
      `components/portales/chain-upload.tsx:242` ("Arrastrá o hacé"),
      `components/portales/mapping-section.tsx:173,248` ("Seleccioná",
      "Revisá"), `components/parametros/import-zone.tsx:186` ("Arrastrá",
      "hacé"), `components/parametros/thresholds-form.tsx:82` ("Ingresá"),
      `components/parametros/sku-table.tsx:347` ("Agregá", "importá").
      Grep de re-verificación al ejecutar el barrido (la lista puede crecer
      con bloques posteriores). Junto con la pasada de identidad visual.
      Además del voseo: decidir el IDIOMA de los errores per-file de
      `data/upload` (hoy en INGLÉS, pre-existente y user-visible en la UI
      de Portales; el cap nuevo de T2 "file too large..." siguió esa
      convención local — la pasada de T5 decide idioma de TODA esa
      familia, no solo tuteo). (Observación del filtro externo,
      2026-08-10.)

- [ ] (origen: smoke T5, 2026-08-17) **Parse leniente de archivos
      no-xlsx en upload**: SheetJS lee texto plano vía fallback CSV →
      workbook con 0 filas → pipeline exitoso → la UI muestra
      "Procesado / Total 0" en VERDE para un archivo basura (verificado
      en el smoke con .txt renombrado a .xlsx en los slots soriana y
      amazon). PRE-EXISTENTE (mismo mecanismo que documenta el test del
      boundary de 10MB). Consecuencia: `ALL_FILES_FAILED` solo es
      alcanzable desde la UI con archivos que hagan LANZAR a SheetJS
      (p.ej. firma ZIP corrupta) — por eso el paso 4 del smoke de T5 no
      lo ejercitó (el string español tiene cobertura automatizada en la
      suite). Candidato: validación de contenido mínimo (headers
      esperados) o aviso "0 filas procesadas" no-verde. Destino: triage
      pre-Fundadores / hardening .2 — decide Michael.

- [ ] (origen: smoke T3 B5, hallazgo de producto, 2026-07-16) **El chatbot
      INVENTA cantidades cuando se le piden recomendaciones.** Observado en
      el smoke: sugerencias de reorden con unidades específicas (150-200,
      plan de 8,050 unidades) NO derivadas de ninguna tool, y una
      misatribución concreta (inventario total de cadena 16,231 u presentado
      como inventario de un producto). Los datos duros de tools fueron
      correctos; la violación es del "never invent/estimate/extrapolate"
      del system prompt ante preguntas de juicio. Candidato: endurecer el
      system prompt — recomendaciones cuantitativas solo derivadas
      aritméticamente de tool results, o negarse.
      **Evidencia (b) adicional (brief T3 §1.13, smoke T2 2026-08-11):**
      "descenso de 33%" para 52→34 unidades (real: 34.6%) — aritmética
      imprecisa SOBRE tool results correctos; muestra que "solo derivado
      de tools" no basta, la derivación debe ser correcta o declararse
      aproximada. **Estado 2026-08-13: EN OBSERVACIÓN con uso real de
      VIKS.** T3 endureció el system prompt (derivación aritmética
      explícita o detenerse; nivel exacto de agregación; framing) y el
      smoke de calidad PASÓ (2026-08-12/13: 4 guiones, 5 derivaciones
      verificadas a mano exactas a un decimal). Pero hay deriva residual
      post-fix observada (smoke prod 2026-08-13: "41.0%" para un cálculo
      cuyo valor real es 40.8%) — el prompt REDUJO la deriva, no la
      eliminó.

- [ ] (mismo origen, menor) **Framing confuso: el modelo tituló cadenas
      como "cuentas de la plataforma"** antes de auto-corregirse. Sin leak
      de datos. Misma familia que el ítem anterior — resolver en el mismo
      tuning de prompt.

## Auditoría de superficie — 2026-07-17 (kickoff hardening)

> Ítems NUEVOS producidos por el threat model del estado real de la app (main
> @ a5fc3ae). Cada uno con evidencia file:line, severidad y esfuerzo estimado.
> Producidos por 3 auditorías paralelas (auth/sesiones, headers/errores,
> chatbot) + `pnpm audit`. NINGÚN fix aplicado — esto es descubrimiento.
> El corte de scope lo decide Michael.

### CRÍTICO / ALTO — infra y datos

- [x] **[YA DECIDIDO — primer ítem de implementación] DB de prod separada +
      backups.** Ya estaba en "Observabilidad / prod" abajo; se eleva acá por
      severidad. Neon dev/prod COMPARTIDA: `app/api/data/reset/route.ts` hace
      `$transaction` de `deleteMany` de SelloutData+UnmappedProduct+Upload
      (tenant-scoped pero inmediato, sin confirmación, sin soft-delete,
      `route.ts:36-51`); disparado desde DEV borra data REAL de prod del mismo
      cliente. `data/upload` escribe igual a la DB compartida. Fundamento
      actualizado 2026-07-20 (corrección de premisa de Michael): la separación
      es por DISEÑO — dev/tests no deben poder truncar la DB que servirá
      prod — no por urgencia de VIKS, que arranca uso real post-Fase 3; el
      trigger de "operaciones destructivas requieren OK explícito" sigue
      siendo el EVENTO de data real cargada. **Sev: CRÍTICA. Esfuerzo: M** (crear branch/
      DB Neon de prod, separar `DATABASE_URL` por entorno en Vercel, activar
      backups automáticos, verificar que `pnpm test` local no toque prod).
      **RESUELTO por T1 (2026-07-29): entornos Neon por scope + backup
      diario cifrado verificado restaurable — ver CORTE punto 1 y
      session-t1-close.md.**

- [ ] **`next@14.2.18` con 1 CVE crítico + 8 high (`pnpm audit`).** El crítico
      es **Authorization Bypass in Next.js Middleware** (patched ≥14.2.25) —
      relevante directo: `middleware.ts` es la capa de redirect de auth de las
      páginas. Highs: varios DoS con Server Components + SSRF (patched ≥14.2.34
      hasta ≥15.5.16). El fix completo cruza major (15.5.16); dentro del 14.x el
      salto a 14.2.25+ cierra el crítico y el DoS de Server Actions con riesgo
      bajo. `next-auth@5.0.0-beta.30` cierra un email-misdelivery moderate.
      `postcss@8.5.10` cierra un XSS moderate. **Sev: ALTA (bypass de auth).
      Esfuerzo: S** para el bump a 14.2.35 dentro de 14.x + smoke; **L** si se
      decide subir a Next 15 (breaking changes). Respetar supply-chain:
      `--ignore-scripts`, pin exact, grep de lockfile, check-supply-chain.

- [ ] **`xlsx@0.18.5` (SheetJS) con 2 CVE high sin patch en el registro npm**
      (Prototype Pollution + ReDoS; "patched: <0.0.0" = no hay fix en la
      versión de npm). SheetJS movió los fixes a su CDN propio fuera de npm.
      Superficie real: `data/upload` y `parametros/import` parsean archivos
      subidos por el usuario con `XLSX.read`. **Sev: ALTA (parseo de input
      no confiable). Esfuerzo: M** — evaluar migrar a la build de SheetJS del
      CDN oficial (rompe la mitigación de solo-npm; decisión de Michael) o
      acotar/validar el input antes del parse. Registrar decisión.

### ALTO — auth

- [ ] **Login timing side-channel + sin lockout/throttling.** `auth.ts:56`
      retorna `null` para email inexistente SIN correr bcrypt → un email no
      registrado responde medible­mente más rápido que un password errado en
      email existente (enumeración por timing). Además CERO lockout / backoff /
      rate-limit en el credentials provider ni en `/api/auth/signup`: guessing
      ilimitado de passwords. **Sev: ALTA. Esfuerzo: M** — dummy bcrypt.compare
      para usuarios desconocidos + rate limiting (mismo mecanismo que el rate
      limit del chat, ver sección prod).

- [ ] **`clientId` del JWT nunca se re-valida contra la DB durante la vida del
      token (default 30 días).** `auth.ts:73-90` escribe `clientId` solo en el
      tick de sign-in y lo copia verbatim; `requireAuth()` (`auth-helpers.ts:50-60`)
      chequea PRESENCIA, no existencia. Si un Client se borra/reasigna mientras
      el JWT vive, la sesión sigue cargando el `clientId` stale; si un clientId
      llegara a reusarse, riesgo de acceso cross-tenant. Tampoco hay revocación
      de sesión de User borrado. **Sev: ALTA (aunque hoy no hay borrado de
      Client en la app). Esfuerzo: S-M** — acortar `session.maxAge`/`updateAge`,
      o re-validar ownership del client en `requireAuth()`.

### MEDIO — auth

- [ ] **Sin `session.maxAge`/`jwt.maxAge` → default de NextAuth = 30 días**
      (`auth.ts:35`, única key de session). Ventana larga de sesión válida sin
      forma de revocar (JWT sin DB). **Sev: MEDIA. Esfuerzo: S.**

- [ ] **Enumeración de usuarios en signup:** email duplicado → 409 `EMAIL_TAKEN`
      distinguible de los 400 de validación (`signup/route.ts:100-101`). Un
      atacante puede sondear qué emails están registrados. **Sev: MEDIA
      (tensión con UX — mensaje claro vs privacidad). Esfuerzo: S.**

- [ ] **Política de password débil:** mínimo 6 chars, sin complejidad, sin cap
      de 72 bytes (bcrypt trunca silenciosamente >72) (`signup/route.ts:23,48,68`).
      **Sev: MEDIA. Esfuerzo: S.**

- [ ] **`trustHost: true` incondicional** (`auth.ts:37`), no gateado por entorno.
      OK detrás del proxy confiable de Vercel; riesgo de host-header injection
      (open-redirect/callback) si alguna vez se despliega detrás de un proxy no
      confiable. **Sev: BAJA hoy (Vercel), MEDIA como deuda. Esfuerzo: S** —
      gatear a non-prod o Vercel.

### MEDIO — headers y manejo de errores

- [ ] **Cero security headers configurados por el repo.** `next.config.mjs` es
      `{}` vacío; `middleware.ts` no muta headers; `vercel.json` sin bloque
      `headers`. Faltan CSP, X-Frame-Options, X-Content-Type-Options (nosniff),
      Referrer-Policy, Permissions-Policy. Vercel pone HSTS/HTTPS en el edge pero
      NINGUNO de los anteriores viene por default de plataforma. **Sev: MEDIA.
      Esfuerzo: S** — `async headers()` en `next.config.mjs` o bloque `headers`
      en `vercel.json`. CSP es la más laboriosa (hay que enumerar orígenes).

- [x] **[RESUELTO por T4 — PR #19 (`9ef19a1`), 2026-08-15: helper
      `withRouteErrors()` en `lib/route-errors.ts` aplicado a las 24
      rutas (23 wrapped + nextauth excluida por evidencia OQ-1) — 500
      `{error:{code:'INTERNAL'}}` uniforme + log JSON estructurado;
      verificado en infra real con DB caída en el smoke del gate.]**
      **Throws de DB inesperados devuelven 500 crudo (HTML/stack), no `{error}`,
      en la mayoría de las rutas.** Anti-patrón dominante: el try/catch envuelve
      solo `req.json()`/`formData()` y deja la llamada de DB afuera. Solo 4
      rutas con cobertura completa (`auth/signup`, `data/reset`,
      `parametros/import`, `ai/chat`). Rutas clase (c) sin ninguna cobertura:
      `clients`, `dashboard/kpis|onetable|periods`, `forecast`,
      `parametros/export`, `portales/counts`, `portales/mappings/suggestions`,
      `uploads`. Clase (b) parciales: `data/upload` (`findMany:177`,
      `upload.create:251` fuera de try), `parametros/skus` (GET), `skus/[id]`
      (DELETE), `thresholds` (PUT `upsert:68`), `conflicts`, `credentials`
      (PUT `upsert:35`), `mappings`, `price-overrides` (PUT). Emparenta con el
      ítem de "errores técnicos crudos" ya existente en la sección prod (auth
      callback). **Sev: MEDIA (leak de stack + UX). Esfuerzo: M** — helper
      `withRouteErrors()` que envuelva cada handler y mapee a `{error}` 500.

- [x] **[RESUELTO por T4 — PR #19 (`9ef19a1`), 2026-08-15: `app/error.tsx`,
      `app/global-error.tsx` (autocontenido, verificado en prod-mode
      local) y `app/not-found.tsx` con estilo de la app en tuteo;
      error.tsx verificado en infra real en el smoke del gate. Residuo
      Q-2 (reset() sin router.refresh()) en "T4 — minors".]**
      **Sin error boundaries en app/**: cero `error.tsx`, `global-error.tsx`,
      `not-found.tsx`. Un throw en cualquier página/RSC (incluido `(dashboard)/`)
      cae en la pantalla de error default de Next, sin estilo de la app y sin
      404 custom. **Sev: MEDIA (UX). Esfuerzo: S.**

### MEDIO — chatbot (costo/abuso)

- [ ] **Prompt caching de §9.1.2 NO está configurado en código.** Grep de
      `cacheControl`/`providerOptions`/`cache_control` en app/lib/core = CERO.
      `streamText` en `ai/chat/route.ts:160-181` no pasa `providerOptions`. Los
      comentarios solo garantizan que el prompt/tools son byte-estables (una
      PRECONDICIÓN del caching, no su activación). El ahorro de costo depende de
      que el AI Gateway cachee implícitamente — verificar en la observability
      del gateway si de verdad hay cache hits; si no, no hay caching. **Sev:
      MEDIA (costo). Esfuerzo: S** — setear `cache_control` en el system prompt/
      tools vía providerOptions, o confirmar el auto-cache del gateway con
      evidencia. (Nota: la tarea original de la sesión pedía verificar esto en
      la observability; queda como acción pendiente, no verificable por código.)

- [ ] **Sin `maxOutputTokens`/`maxTokens` ni `temperature` en el chat**
      (`ai/chat/route.ts`, grep vacío). Largo de output ilimitado. **Sev: MEDIA
      (costo). Esfuerzo: S.** (Complementa el rate-limit y el cap de tamaño ya
      listados en la sección prod.)

- [ ] **Sin cap de TAMAÑO de archivo en `data/upload`** — solo se computa
      `buffer.length` para registrarlo (`route.ts:259`), nunca se rechaza por
      tamaño. Un archivo gigante pasa entero a `XLSX.read` en memoria (agrava el
      ítem de xlsx). **Sev: MEDIA (DoS/costo memoria). Esfuerzo: S** — cap de
      bytes antes del parse.

- [ ] **Forecast route sin try/catch ni error path sanitizado**
      (`forecast/route.ts`): a diferencia del chat, un throw de
      `getForecastOverview` devuelve 500 default. Subsumido por el ítem general
      de manejo de errores de arriba; se anota por completitud. **Sev: BAJA.**

- [ ] **Falta gateway key → solo `CHAT_ERROR` opaco** (`ai/chat/route.ts:185`),
      sin pre-check de que `AI_GATEWAY_API_KEY` exista al boot. El usuario ve un
      error genérico sin distinguir config vs transitorio. Recordatorio operativo
      ya registrado en el handoff B5 (agregar la key en Vercel). **Sev: BAJA.
      Esfuerzo: S.** Anotación 2026-07-20 (Michael, vía T1): `AI_GATEWAY_API_KEY`
      YA está cargada en Vercel y verificada funcionando en prod — el
      recordatorio operativo del handoff B5 queda CERRADO. El pre-check al boot
      sigue pendiente; este ítem permanece abierto solo por eso.
      **Anotación 2026-07-29 (H3): el claim "verificada funcionando en
      prod" quedó STALE** — la key sigue cargada y es válida, pero el
      gateway rechaza el modelo por billing (403 RestrictedModelsError,
      free tier restringido post-16-jul); el chatbot de prod está roto
      hasta el top-up de créditos (ver ítem H3 en T1 follow-ups).
      **Anotación 2026-07-29 (cierre de H3): top-up hecho, chat
      verificado funcionando en preview y prod — el claim vuelve a ser
      cierto. El pre-check al boot sigue pendiente; el ítem permanece
      abierto solo por eso.**

## T1 follow-ups (minors de review quality, 2026-07-20)

> Hallazgos MINOR del carril quality de T1 (ENTORNOS + DEVOPS) que no
> bloquearon el commit. El MAJOR (Q-1, fail-open por case del hostname) se
> fixeó en el fix pass del mismo gate. Detalle completo con escenarios en
> `.superpowers/sdd/t1-entornos-review-quality.md`.

- [ ] (origen: review quality T1, Q-2) **`db:reset` valida una DATABASE_URL
      que `prisma migrate reset` no necesariamente usa**: son dos procesos;
      el guard carga `.env.local` pero el Prisma CLI solo lee `./.env` /
      `./prisma/.env` / shell env. Hoy convergen (no existe ni `.env` ni
      `prisma/.env`); bypass latente si alguien agrega `prisma/.env`. Fix:
      que `scripts/db-guard.ts` spawnee él mismo el reset heredando el env
      validado (eliminar el `&&` y la doble fuente de verdad).
- [ ] (origen: review quality T1, Q-3) **Matcher del middleware excluye
      `api/health` por PREFIJO**: `api/healthz`/`api/health-*` futuras
      bypassearían `auth()` silenciosamente (`middleware.ts:31`). Patrón
      idéntico al pre-existente de `api/auth`; deuda latente, no bug hoy.
      Cerrar el prefijo (`api/health$|api/health/`) cuando se toque el
      matcher.
- [ ] (origen: review quality T1, Q-4) **La rama de timeout de
      `/api/health` no tiene test** (`app/api/health/route.ts:17-25`):
      query colgada → 503 a los 5s. Agregar caso con `vi.useFakeTimers()` +
      promesa que nunca resuelve cuando se toque el archivo.
- [ ] (origen: review quality T1, Q-5 restante) **Matriz del guard: faltan
      casos `postgres://` (alias de scheme) y URL whitespace-only** en
      `tests/lib/db-guard.test.ts` (el caso de mayúsculas se agregó con el
      fix de Q-1). Ambos hoy se comportan bien (verificado empíricamente
      por el reviewer); los tests los clavarían contra regresiones.
- [x] (smoke preview T1, H1, 2026-07-29) **`AUTH_URL` mal configurada por
      scope en Vercel (pre-existente, 18-may)** — Preview tenía el string
      `$VERCEL_URL` literal sin interpolar (signOut → NXDOMAIN) y
      Production apuntaba a `onetable.vercel.app`, dominio de un TERCERO
      (el proyecto vive en `onetable-gold.vercel.app`) — el redirect del
      middleware sin sesión mandaba ahí (superficie menor de phishing).
      RESUELTO por Michael (config-only): Production →
      `https://onetable-gold.vercel.app`; Preview → entrada ELIMINADA
      (`trustHost: true` deriva el host del request); `.env.example`
      corregido a mano. Detalle en handoff `session-t1-pasos-1-2.md` §7.
- [x] (smoke preview T1, H3, 2026-07-29; root cause CERRADO por logs el
      mismo día) **Chatbot roto en preview Y producción: AI Gateway
      rechaza con 403 `RestrictedModelsError`** ("Free tier users do not
      have access to this model") para `anthropic/claude-haiku-4.5`,
      `totalProviderAttemptCount: 0` (request IDs `ncvkp-1785370096374` /
      `mmqck-1785370101557`). La hipótesis de key sin scope Preview era
      FALSA (key scoped a Production y Preview, screenshot de Michael).
      Es BILLING del gateway, no config de la app: los smokes del 15-16
      jul funcionaron ($0.22); Vercel restringió el free tier del gateway
      (o expiraron créditos promocionales) entre esa fecha y hoy. Cero
      usuarios afectados (VIKS post-F3). RESOLUCIÓN: top-up de créditos
      del gateway (billing de Michael; sin redeploy). CIERRE = re-test
      del chat post-top-up. NO bloquea el merge de T1 (decisión de
      Michael). **RESUELTO 2026-07-29: top-up de $20 USD al AI Gateway;
      re-test de Michael con el chat FUNCIONANDO en preview y en
      producción. La dependencia de T3 (créditos activos) queda
      satisfecha.**
- [ ] (smoke preview T1, menor, 2026-07-29) **`favicon.png` 404 en todos
      los deployments** (asset ausente). Cosmético — va con la pasada de
      identidad visual (Fase 2.5/pre-Fundadores).
- [x] (incidente 2026-07-29, detectado por Michael) **Shells de
      background de CC con loops `until vercel …` dispararon device-login
      flows del CLI sin auth**, llenando el Chrome de Michael de pestañas
      de login de Vercel (user_code visible; ningún login completado).
      Resolución: shells matadas y verificadas con ps (cero procesos);
      regla nueva en CLAUDE.md (reglas operativas): prohibidos los loops
      de polling sobre comandos que puedan requerir auth interactiva o
      abrir el navegador; cero shells de background vivas al cerrar el
      turno; el CLI de vercel NO se usa en esta máquina (sin auth, y no
      se autentica como side-effect — decisión explícita de Michael si
      algún día hace falta).
- [ ] (origen: handoff externo pasos 1-2, filtrado, 2026-07-29) **Vars
      legacy de la integración Neon (`DATABASE_URL_UNPOOLED`,
      `POSTGRES_*`, `PG*`) siguen administradas apuntando a PRODUCTION en
      los 3 scopes de Vercel.** Inerte hoy (el código solo lee
      `DATABASE_URL`); footgun si un futuro `directUrl` de Prisma o script
      lee una legacy → volvería a prod en silencio. Opciones al tocarlo:
      re-scopearlas a Production-only o eliminarlas del sync.
- [ ] (origen: T2 Tanda B §4, 2026-08-04) **Automatizar `prisma migrate
      deploy` (buildCommand de Vercel o GitHub Action)** para staging y
      production, hoy pasos manuales de Michael
      (`docs/runbooks/t2-migraciones-runbook.md`). **BLOQUEADO por el ítem
      anterior de vars legacy**: automatizar exigiría strings unpooled en
      vars/secrets mientras `DATABASE_URL_UNPOOLED`/`POSTGRES_*`/`PG*`
      sigan apuntando a production en los 3 scopes — un pipeline que las
      lea migraría production en silencio.
- [ ] (mismo origen) **Confirmar explícitamente el toggle de
      preview-branching OFF** en la config de la integración Neon (la
      evidencia empírica lo sugiere — preview resuelve a la branch staging
      fija; falta ver el toggle).
- [ ] (mismo origen) **Si el dry-run del backup falla con error de channel
      binding en el runner**, remover `channel_binding=require` del secret
      `BACKUP_DATABASE_URL` y dejar `sslmode=require` (nota también en el
      handoff `session-t1-pasos-1-2.md`).
- [ ] (origen: filtro externo T1, F-1) **El hook `block-env-writes` NO
      bloqueó una escritura accidental a `.env.example`** hecha con
      herramientas de edición de archivos (bloquea Bash sobre `.env*`, no
      file-edit tools). Evidencia: working tree de T1 con dos líneas en
      blanco agregadas a `.env.example` fuera de scope (revertido en el
      fix pass). Verificar y cerrar la cobertura del hook cuando se toque
      `.claude/hooks/`.
- [ ] (origen: review quality T1, Q-6) **Backup AES-256-CBC sin
      autenticación**: `openssl enc` no soporta AEAD — un dump corrupto/
      alterado solo se detecta al `pg_restore`. Accepted-risk del
      constraint cero-deps. Mitigación barata: subir `sha256sum` del `.enc`
      como segundo file del artifact y/o anotar el riesgo en el runbook
      paso 5.

## T2 Tanda A — audit post-bump y erratum del brief (2026-08-03)

### Erratum del brief T2 §1.9 (pedido por Michael)

El brief dice "9 modelos" en el schema Prisma; son **10** (verificado:
`grep -c "^model" prisma/schema.prisma` → 10). Conteo errado al escribir
el brief; el schema no cambió desde B1. La afirmación operativa del §1.9
es correcta: NO existe modelo `RateLimit` (grep vacío) y hay 3 migraciones
en `prisma/migrations/`.

### Advisories CERRADOS por el bump (next 14.2.18→14.2.35, next-auth beta.25→beta.32)

Fuente: endpoint bulk de advisories de npm consultado con versión vieja
vs. nueva (2026-08-03). Audit pre-bump: 70 vulns (7c/31h/28m/4l); post-bump:
53 (3c/27h/21m/2l).

`next` (9 cerrados):
- GHSA-f82v-jwr5-mffw **critical** — Authorization Bypass in Middleware
  (el CVE que motivó el bump; patched ≥14.2.25).
- GHSA-mwv6-3258-q52c high — DoS Server Components (≥14.2.34).
- GHSA-5j59-xgg2-r9c4 high — DoS Server Components, incomplete fix
  (≥14.2.35).
- GHSA-7m27-7ghc-44w9 moderate — DoS Server Actions (≥14.2.21).
- GHSA-g5qg-72qw-gw5v moderate — cache key confusion Image Optimization
  (≥14.2.31).
- GHSA-4342-x723-ch2f moderate — middleware redirect SSRF (≥14.2.32).
- GHSA-xv57-4mr9-wg8v moderate — content injection Image Optimization
  (≥14.2.31).
- GHSA-3h52-269p-cp9r low — dev server origin verification (≥14.2.30).
- GHSA-qpjv-v59x-3qc4 low — race condition cache poisoning (≥14.2.24).

`next-auth` (5 cerrados — TODOS los advisories de beta.25):
- GHSA-8fpg-xm3f-6cx3 **critical** — existence-based auth checks fail
  open (exactamente nuestro patrón middleware/requireAuth).
- GHSA-7rqj-j65f-68wh **critical** — email normalizer Unicode/homoglyph
  bypass.
- GHSA-xmf8-cvqr-rfgj high — getToken() uncaught exception en Bearer
  malformado.
- GHSA-5jpx-9hw9-2fx4 moderate — email misdelivery.
- GHSA-x445-f3h2-j279 moderate — OAuth state/nonce/PKCE cookies no
  atadas.

### Advisories RESTANTES post-bump — triage en dos grupos (instrucción de Michael)

**(a) Cadenas dev-only / build-time — registrar, NO accionar:**
- `vitest` 2 critical (GHSA-9crc-q9x8-hgqq, GHSA-5xrq-8626-4rwp): son del
  Vitest UI/browser server, que no corre en CI ni en prod — superficie
  solo en la máquina de dev con `--ui`.
- `brace-expansion` 3 GHSAs high (GHSA-3jxr-9vmj-r5cp, GHSA-mh99-v99m-4gvg,
  GHSA-rgw5-rvv9-x895, multipaths): ReDoS en tooling de lint/coverage
  (eslint, @vitest/coverage-v8) — nunca procesa input de usuarios.
- `glob` high (GHSA-5j98-mcp5-4vw2, vía eslint-config-next) y `js-yaml`
  high+moderate (GHSA-52cp-r559-cp3m, GHSA-h67p-54hq-rp68, vía eslint):
  solo corren en lint local/CI sobre archivos del repo.
- `vite` high+2 moderate (GHSA-fx2h-pf6j-xcff, GHSA-4w7w-66w2-5vf9,
  GHSA-v6wh-96g9-6wx3) y `esbuild` moderate (GHSA-67mh-4wv8-2f99, vía
  vitest/tsx): dev servers de test tooling, no expuestos ni deployados.
- `postcss` 2 high + 2 moderate (GHSA-6g55-p6wh-862q, GHSA-r28c-9q8g-f849,
  GHSA-qx2v-qp2m-jg93, GHSA-fxqj-rqcc-2cmp): parser de CSS en BUILD time
  sobre CSS propio del repo — no procesa input externo en runtime.

**(b) Dependencias con path a producción — registradas, decisión tomada:**
- `next` 8 high + 8 moderate + 2 low restantes (GHSA-h25m-26qc-wcjf,
  GHSA-q4gf-8mx6-v5v3, GHSA-8h8q-6873-q5fj, GHSA-c4j6-fc7j-m34r,
  GHSA-36qx-fr4f-26g5, GHSA-m99w-x7hq-7vfj, GHSA-89xv-2m56-2m9x,
  GHSA-p9j2-gv94-2wf4 los high): TODOS piden ≥15.0.8..≥15.5.21 — cruzan
  major (14→15), fuera del scope del hardening; se registran para el
  upgrade de major.
- `xlsx` 2 high (GHSA-4r6h-8v6p-xvw6 prototype pollution,
  GHSA-5pgg-2g8v-p4x9 ReDoS): SIN patch en npm — riesgo aceptado interim;
  la mitigación es el cap de 10MB por archivo (Tanda B de T2).
- `@auth/core@0.37.4` 1 critical + 1 high + 1 moderate
  (GHSA-7rqj-j65f-68wh, GHSA-xmf8-cvqr-rfgj, GHSA-x445-f3h2-j279): entran
  SOLO vía `@auth/prisma-adapter@2.7.4`, que está en package.json pero NO
  se importa en ningún lado (JWT strategy sin adapter; único match es un
  comentario en auth.ts) — código muerto sin path de ejecución. El
  next-auth bumpeado resuelve `@auth/core@0.41.3` (patched). Cierre
  definitivo = remover `@auth/prisma-adapter` (cleanup ya registrado de
  Fase 2); mientras tanto, cero superficie runtime.
  **RESOLUCIÓN (Michael, 2026-08-03): remover `@auth/prisma-adapter` como
  rider INICIAL de Tanda B** — un renglón en package.json + lockfile con
  `--ignore-scripts` + supply-chain antes/después + suite — para que el
  audit baseline quede limpio de ese critical antes de T6.
  **EJECUTADO (Tanda B, 2026-08-04):** `pnpm --config.ignore-scripts=true
  remove @auth/prisma-adapter` (el flag `--ignore-scripts` no existe en
  `pnpm remove`; se forzó vía config) — 3 paquetes fuera del lockfile
  (`@auth/prisma-adapter@2.7.4`, `@auth/core@0.37.4` y su transitiva);
  supply-chain limpio antes y después. Audit post-remoción: **50 vulns
  (2 critical / 26 high / 20 moderate / 2 low)** — desaparecieron
  exactamente los 3 GHSAs de `@auth/core@0.37.4` (GHSA-7rqj-j65f-68wh
  critical, GHSA-xmf8-cvqr-rfgj high, GHSA-x445-f3h2-j279 moderate;
  grep del audit → 0 matches). Los 2 critical restantes son los de
  vitest (dev-only, grupo (a) de este triage). El único `@auth/core` del
  lockfile es 0.41.3 (patched, vía next-auth beta.32).

## T2 Tanda A — minors de la doble review (no bloquean; registrados 2026-08-03)

- [x] **[RESUELTO por Michael 2026-08-03] Session rolling + `updateAge`
      inerte bajo JWT** (`auth.ts:52`) — bajo `strategy: 'jwt'` la sesión es
      rolling (idle window 24h, re-firma en cada lectura) y `updateAge` es
      NO-OP; comment corregido en el diff de Tanda A. RESOLUCIÓN: rolling
      ACEPTADO (coincide con la intención escrita del corte: "logout por ~1
      día de inactividad" = idle window). ACCIÓN PENDIENTE (rider de Tanda
      B, auth.ts ya se toca ahí): dropear `updateAge` de la config + ajustar
      el assert de config en `tests/api/auth-authorize.test.ts`. Expiry
      absoluto vía claim custom en el callback `jwt`: registrado como opción
      futura post-usuarios-reales, no ahora.
      **EJECUTADO (Tanda B, 2026-08-04):** config queda
      `{ strategy: 'jwt', maxAge: 86400 }`; comentario de la semántica
      rolling conservado sin la mención a `updateAge`; assert de config
      ajustado en `tests/api/auth-authorize.test.ts`.
- [ ] **csp-report: cap no pre-materialización**
      (`app/api/csp-report/route.ts:30,34`) — `req.text()` bufferea el body
      completo antes del chequeo de 32KB; un POST chunked sin Content-Length
      materializa todo (acotado ~4.5MB por Vercel; sin cota dura en
      dev/self-host). Además `raw.length` cuenta UTF-16 code units, no bytes.
      Riesgo bajo; endurecer si duele.
- [ ] **csp-report: sin rate limit ni autenticidad**
      (`app/api/csp-report/route.ts`) — reportes forjables/floodeables con
      curl; la señal "cero violations" que alimenta la evidencia del flip de
      T6 es envenenable. Mitigación candidata: rate limit por IP con el
      limiter reusable (T3) + leer la evidencia de T6 con este caveat.
- [x] **[RESUELTO por T5, PR #20 `b73c6e8`, 2026-08-17: OQ-2=(a) — copy
      del cliente → "La contraseña es demasiado larga. Usa una más
      corta." (sin número); message del server intacto (exacto en
      bytes, dev-facing).]**
      **Copy signup "máximo 72 caracteres" vs server 72 BYTES**
      (`app/(auth)/signup/page.tsx:25`, ERROR_COPY) — el mensaje es impreciso
      justo en los casos multibyte que lo disparan. Ajustar en la pasada de
      copy (T5) o próximo touch de la página. (Levantado por AMBOS carriles.)
- [ ] **Import `.ts` en `next.config.mjs` depende de Node ≥22.18 en el
      builder de Vercel** (`next.config.mjs:9`) — sin `engines` pin en
      `package.json` (candidato de remedio; fuera del scope del fix pass de
      Tanda A); si el project setting fuera menor,
      el build muere RUIDOSO con `ERR_UNKNOWN_FILE_EXTENSION` (se ve en el
      primer deploy del PR). Side-effect: 2 warnings de type stripping por
      comando `next`.
- [ ] **[RESUELTO por Michael 2026-08-03, PRE-SMOKE] CSP enforced en preview
      vs Vercel Toolbar** (`vercel.live`; `lib/security-headers.ts`) — la CSP
      de preview bloquearía el toolbar (violations en console + toolbar
      roto). RESOLUCIÓN: Michael APAGA el toolbar del proyecto en el
      dashboard de Vercel (config humana, ANTES del smoke de preview).
      Fallback si el toggle no existe: allowlist de `vercel.live`
      solo-preview como line item de Tanda B.
- [ ] **Endurecer `tests/api/auth-authorize.test.ts`**
      (`tests/api/auth-authorize.test.ts:94,104`) — assertar que `compare`
      fue llamado CON `DUMMY_BCRYPT_HASH` (hoy solo cuenta llamadas; un
      regreso a comparar contra `''` pasaría verde) + agregar el path "user
      existente + password incorrecta".
- [ ] **HMR bajo CSP dev: cierre pendiente** — verificación in-browser no
      realizada (extensión de Chrome desconectada; regla post-incidente);
      cierre = primer `pnpm dev` de Michael con browser abierto: HMR
      funcionando + cero violations CSP en console (falla ruidosa si no).

## T2 Tanda B — minors de la doble review (no bloquean; registrados 2026-08-04)

- [ ] **Cap de request-level como hardening opcional**
      (`app/api/data/upload/route.ts`, `app/api/parametros/import/route.ts`)
      — `req.formData()` materializa el body ANTES del chequeo de
      `file.size`; en Vercel el límite de body de la plataforma acota, en
      dev/self-host no. Comments corregidos en el fix pass de Tanda B;
      hardening candidato: pre-check de `Content-Length` antes de `formData()`.
- [ ] **Sin cap de longitud en `key` del rate limiter** (`lib/rate-limit.ts`;
      `auth.ts` scope `login:email`) — un "email" de ~5KB excede el máximo de
      btree index row (~2.7KB) → el upsert lanza → fail-open silencioso del
      scope email para esas keys + ruido de logs (scope IP intacto).
      Candidato: truncar/hashear keys largas antes del SQL. **Agravado por
      csp-report público desde T3 (Q-6); destino T6.**
- [ ] **Sin TTL/sweep global de filas stale** (`lib/rate-limit.ts`) — el
      cleanup lazy solo borra ventanas viejas del MISMO (scope,key); keys
      one-shot (p.ej. barrido distribuido de muchas IPs) dejan filas
      permanentes — crecimiento sin cota en Neon Free tier. Candidato:
      sweep global periódico (cron o piggyback). **Agravado por
      csp-report público desde T3 (Q-6); destino T6.**
- [ ] **429 de signup sin `Retry-After`** (`app/api/auth/signup/route.ts`)
      — el fin de ventana es computable; cosmético, mejora UX de clientes
      legítimos.
- [ ] **Flake residual de frontera de ventana en tests**
      (`tests/api/auth-authorize.test.ts` casos limited,
      `tests/api/signup.test.ts` caso 429) — si la frontera de 15min cae
      entre seed y llamada, el test falla (~≪0.1%); el assert está blindado
      window-agnostic, el seed no. Registrar por si aparece en CI.

## T3 — minors de la doble review (no bloquean; registrados 2026-08-11)

> Hallazgos MINOR de los carriles spec (S-*) y quality (Q-*) de la tanda
> única de T3 (chatbot). Cero MAJOR: el diff fue al filtro externo SIN fix
> pass. Detalle completo con escenarios en
> `.superpowers/sdd/t3-review-spec.md` y `t3-review-quality.md`.

- [ ] (S-1 spec) **Botón "Reintentar" oculto solo en el caso RATE_LIMITED**
      (`components/analisis/chat-panel.tsx:160-168`) — micro-decisión de UI
      más allá de la letra de §4.4 del brief, coherente con la intención
      (retry contra cuota diaria re-falla seguro). Desviación declarada por
      el implementer, aceptada por el carril spec.
- [x] **[RESUELTO por T5, PR #20 `b73c6e8`, 2026-08-17: `errorCodeOf`
      local + copy específico sin Reintentar + limpieza del historial
      envenenado con restauración al input (E2 del brief). 4 minors
      nuevos de la doble review de T5 registrados en su sección.]**
      (Q-1 quality) **El panel no maneja el 400 `MESSAGE_TOO_LONG` nuevo**:
      un usuario legítimo que pega >8000 chars cae en copy genérico +
      "Reintentar" que re-falla determinísticamente
      (`chat-panel.tsx:162-179`; el 400 nace en
      `app/api/ai/chat/route.ts:242-248`). El mecanismo de detección ya
      existe (`isRateLimitError` parsea el body); generalizarlo a un
      `errorCodeOf(error)` (~5 líneas) cuando se vuelva a tocar el panel.
      Destino: próximo touch de chat-panel.tsx (T4 error boundaries o T5
      copy, lo que llegue primero) — decisión de Michael vía filtro,
      2026-08-11.
- [x] **[RESUELTO por T5, PR #20 `b73c6e8`, 2026-08-17: hora capturada
      una vez por objeto de error vía `useMemo(..., [error])`.]**
      (Q-2 quality) **Copy de reset de cuota invertido tras cruzar la
      medianoche UTC**: `quotaResetLocalTime()` se recalcula por render
      (`chat-panel.tsx:49-58,169`) — con el 429 montado, al cruzar la
      frontera el copy salta a +24h justo cuando la cuota ACABA de
      resetearse. Deliberado según el implementer (reporte §8.3) pero
      infiel; candidato: capturar la hora al momento del error.
      Destino: próximo touch de chat-panel.tsx (T4 error boundaries o T5
      copy, lo que llegue primero) — decisión de Michael vía filtro,
      2026-08-11.
- [x] **[RESUELTO por T5, PR #20 `b73c6e8`, 2026-08-17: announcer
      ramificado con `errorCodeOf`, simétrico al render visual (429 con
      hora / 400 / genérico).]**
      (Q-3 quality) **a11y: el announcer `aria-live` nunca comunica el copy
      de cuota** (`chat-panel.tsx:184-192`) — screen reader solo oye el
      genérico "Ocurrió un error", sin causa ni hora de reset. Ramificar
      con `isRateLimitError`, simétrico al render visual.
      Destino: próximo touch de chat-panel.tsx (T4 error boundaries o T5
      copy, lo que llegue primero) — decisión de Michael vía filtro,
      2026-08-11.
- [ ] (Q-4 quality) **La ruta del chat sin pre-check de `Content-Length`**
      que csp-report SÍ estableció en el mismo diff
      (`app/api/ai/chat/route.ts:212-217` vs `csp-report/route.ts:40-43`):
      un body basura de hasta ~4.5MB (cap de plataforma) paga `req.json()`
      completo antes de los caps, y los mensajes descartados por el trim
      nunca se miden. Emparenta con el ítem de Content-Length de
      upload/import (T2 Tanda B, arriba).
- [x] **[CERRADA por T5, PR #20 `b73c6e8`, 2026-08-17: política por
      audiencia (OQ-1=A) — el message del 429 pasó a inglés ("Daily
      chat quota exceeded"), dev-facing; el copy español vive en el
      panel que branchea por code.]**
      (Q-5 quality) **Mensaje del 429 en español vs convención inglesa** de
      los `errorResponse` de la misma ruta (`route.ts:284-288`). Cero
      impacto (el panel detecta por `code`); alinear en T5 junto con la
      decisión de idioma de la familia de errores per-file de upload.
- [x] **[CERRADO por T5, PR #20 `b73c6e8`, 2026-08-17: punto del JSX
      removido; verificado en el smoke (paso 5: "6:00 p.m." sin doble
      punto).]**
      (smoke T3, copy, 2026-08-12 → T5) **El copy del 429 en el panel
      termina en punto doble** ("...6:00 p.m..") — el JSX cierra con "."
      tras `{quotaResetLocalTime()}` (`chat-panel.tsx:168-169`) y
      `toLocaleTimeString('es-MX')` ya devuelve la hora con "p.m."
      (verificado 2026-08-13). Cosmético; a la pasada de copy de T5
      (chat-panel.tsx).
- [ ] (Q-6 quality) **Propiedades heredadas del limiter T2 ahora expuestas
      en endpoint SIN auth** (csp-report; no son defecto del diff de T3):
      (a) cada POST anónimo = un write a Neon — el limiter acota el
      LOGGING, no la carga de DB (flood distribuido = amplificación de
      writes); (b) filas de `RateLimit` de IPs one-shot que nada borra —
      AGRAVA los ítems ya listados "Sin TTL/sweep global" y "Sin cap de
      longitud en `key`" (sección T2 Tanda B); (c) `x-forwarded-for`
      spoofeable fuera de Vercel (en Vercel el header es confiable;
      declarado por el implementer, reporte §8.1). **Destino (cierre T3,
      2026-08-13): triage a más tardar en T6; candidato: sweep global
      piggyback en el workflow de backup** (cron diario ya existente,
      cero infra nueva).
- [ ] (Q-7 quality, tests) **Cap de 64KB sin test de frontera exacta** (el
      de 8000 sí tiene su par 8000/8001;
      `tests/ai/chat-route.test.ts:804-820` usa payload muy pasado):
      una regresión `>`→`>=` o un cambio de unidad pasaría verde. Barato:
      mensaje cuyo JSON serializado mida exactamente 65536 bytes.
- [ ] (Q-8 quality, tests) **El test de byte-estabilidad del system prompt
      es tripwire, no prueba** (`chat-route.test.ts:856-876`, dos requests
      back-to-back): interpolación con granularidad diaria pasaría verde.
      La garantía real es el const de módulo sin interpolación
      (`route.ts:105-143`, verificado por lectura). Anotado el límite del
      assert; reemplazar solo si se vuelve a tocar el archivo.
- [ ] (F-1 quality, fix caching §4.6) **Assert de `providerOptions` solo en
      el primer doStreamCall** (`tests/ai/chat-route.test.ts:843-850`): el
      test del gateway caching asserta
      `providerOptions.gateway.caching === 'auto'` solo en
      `doStreamCalls[0]`; un assert de una línea en el test multi-step
      (5 calls) fijaría el invariante "viaja en cada step". Nota del
      reviewer: el SDK propaga providerOptions por step — verificado en
      el source de ai@6.0.168 (`dist/index.mjs:7129,7211`) — así que es
      regression-lock opcional, no gap real. Una línea cuando se vuelva
      a tocar el archivo.
- [ ] (E2 del filtro, brief T3 §4.3; registrado al cierre 2026-08-13)
      **Residual de ventana TOTAL: ~30×64KB ≈ 1.9MB por request** — los
      caps de T3 acotan por mensaje (8000 chars user / 64KB cualquiera),
      no la ventana completa; una ventana llena de mensajes al tope del
      cap grueso pasa los caps. Un request así revienta el contexto del
      modelo y falla en el gateway ANTES de facturar. Candidato futuro
      si duele: cap de ventana TOTAL.
- [ ] (observación §4.6, fix caching, 2026-08-13) **El
      `gateway.caching: 'auto'` tiene umbral de TAMAÑO**: prompts de
      ~3-3.8K tokens no se marcan para cache, ~12K sí (observado en los
      CSVs de prod del 2026-08-13). Residual ACEPTADO por Michael:
      requests cortos sin cachear a ~$0.002 c/u, acotado por el cap de
      40/día. Trigger de revisión: si el costo del chat pesa a escala
      Founders. **Además: el anclaje message-level
      `anthropic.cacheControl` NO funciona desde el runtime de Vercel**
      — 0/0 en prod con causa DESCONOCIDA (hipótesis de routing-fallback
      y de artefacto de medición REFUTADAS con los CSVs; el mismo
      anclaje SÍ cacheó desde un scratch externo, ver
      `t3-caching-fix-scratch-evidence.md`). **NO reintroducirlo sin
      evidencia nueva.**

## T4 — minors de la doble review (no bloquean; registrados 2026-08-14)

> Hallazgos MINOR de los carriles spec (S-*) y quality (Q-*) de la tanda
> única de T4 (robustez/observabilidad). Cero MAJOR: el diff fue al filtro
> externo SIN fix pass. Detalle completo con escenarios en
> `.superpowers/sdd/t4-review-spec.md` y `t4-review-quality.md`.

- [x] (S-1 spec) **Drift del brief §1.11 sobre los tests de mappings** —
      el brief afirmaba que `tests/api/portales-mappings.test.ts` mockeaba
      los throws del servicio con substrings a migrar; en realidad es un
      test de INTEGRACIÓN (induce los throws con filas CONFLICTED reales y
      el servicio real, que ahora lanza `ServiceError` naturalmente): no
      había mocks que migrar y los asserts 409/404 quedaron válidos por
      construcción. CORREGIDO en el reporte (`t4-report.md` §"Drift
      brief→realidad"); el brief commiteado queda FROZEN.
- [x] (S-2 spec, ACEPTADA por Michael en el gate) **Re-throw del sentinel
      `DYNAMIC_SERVER_USAGE` en el wrapper** (`lib/route-errors.ts`) —
      desviación esencial fuera de la letra de E4: sin él, la optimización
      estática del build captura el `DynamicServerError` de `auth()` y
      hornea rutas GET estáticas con 500 fijo + líneas `source:'api'`
      espurias (7+ por build; con el fix: 0, rutas siguen ƒ). Implementada,
      comentada y testeada; el match por digest replica 1:1 el
      `isDynamicServerError` interno de next 14.2.35 (verificado por el
      carril quality en node_modules). NEXT_REDIRECT/NEXT_NOT_FOUND siguen
      solo documentados (cero usos en app/api — E4).
- [x] (S-3 spec, ACEPTADA) **`omitMessage` omite también `stack`** —
      excede la letra de OQ-2 pero cumple su intención: los stacks de V8
      embeben el message en la primera línea; omitir uno sin el otro
      anularía la regla. Documentado en el helper y testeado.
- [x] (S-4 spec, ACEPTADA) **Catch P2003 solo en el `upsert` de
      price-overrides PUT, no en el `deleteMany`** — narrowing correcto:
      borrar filas de override no puede violar la FK de `productId` (peor
      caso: 0 filas borradas). Comment en el código.
- [ ] (Q-1 quality) **Race de doble-DELETE/PATCH de mappings: P2025 pasó
      de 404 accidental a 500 INTERNAL + log** — dos DELETE del mismo mapeo
      en paralelo (doble click): ambos pasan el `findFirst`, T1 borra, el
      `delete` de T2 lanza P2025 ("...required but not found"), que el
      substring-match pre-T4 capturaba → 404; post-T4 no es `ServiceError`
      → rethrow → 500 (`core/normalizer/resolve.ts:272,360`; catches en
      `app/api/portales/mappings/route.ts:88-96,134-146`). Ventana angosta,
      estado final de datos correcto. Fix barato: mapear
      `PrismaClientKnownRequestError` + P2025 → 404 en esos dos catch.
      Destino: próximo touch de mappings/route.ts o triage T6.
- [ ] (Q-2 quality) **`reset()` de `app/error.tsx` sin `router.refresh()`**
      (`app/error.tsx:38`) — el re-render de un boundary no re-fetchea
      Server Components: tras un throw del dashboard layout (DB caída, el
      caso dominante declarado), "Intentar de nuevo" probablemente no
      recupera aunque la DB haya vuelto; el patrón documentado de Next es
      `startTransition(() => { router.refresh(); reset(); })`. NOTA del
      filtro: el smoke (d) no puede validar ni refutar esto — las env vars
      se hornean por deployment (restaurar `DATABASE_URL` implica redeploy,
      que resetea todo). Destino: próximo touch de app/error.tsx.
- [ ] (Q-3 quality) **`omitMessage` inalcanzable vía `withRouteErrors`**
      (`lib/route-errors.ts:51-58`) — el wrapper no pasa ctx por ruta, así
      que la regla que el doc promete para rutas con contenido de usuario
      no tiene ningún call site de producción que pueda invocarla. Fix:
      tercer parámetro opcional de `withRouteErrors` o borrar la promesa
      del doc. Destino: próximo touch de lib/route-errors.ts.
- [ ] (Q-4 quality) **`logRouteError` puede lanzar con throws exóticos**
      (`lib/route-errors.ts:92`) — `String(err)` sobre un objeto sin
      `toString` (p.ej. `Object.create(null)`) lanza DENTRO del último
      catch → el wrapper rechaza → 500 crudo sin log. Ningún throw site
      actual lo produce; un try/catch de una línea alrededor del stringify
      hace la red incondicional. Destino: próximo touch de
      lib/route-errors.ts.
- [ ] (Q-5 quality) **Dos códigos públicos para el mismo semántico:**
      `INTERNAL` (wrapper, `lib/route-errors.ts:137`) vs `INTERNAL_ERROR`
      (catches internos pre-existentes de signup `route.ts:92`, data/reset,
      skus). Hoy ningún client branchea sobre ninguno de los dos. DECIDIR
      ANTES de construir el agente de triage post-bloque — agruparía una
      misma condición en dos buckets.
- [ ] (Q-6 quality) **Branch `Array.isArray` del guard de body sin test**
      (`tests/api/body-guards.test.ts:39-42` — CASES solo cubre `null` y
      string): borrar ese branch del guard dejaría la suite verde. Agregar
      `['array body', '[]']` a CASES en el próximo touch del archivo.
- [ ] (Q-7 quality) **`lib/route-errors` importa `errorResponse` desde
      `lib/auth-helpers`** (`lib/route-errors.ts:44` →
      `lib/auth-helpers.ts:15` → `@/auth` → next-auth) — arrastra next-auth
      al grafo de imports de health y csp-report (cold start + peaje de
      `vi.mock('@/auth')` nuevo en `tests/api/health.test.ts:8` y
      `tests/api/csp-report.test.ts:12`). `errorResponse` es pura;
      candidato: moverla a un leaf module (`lib/api-errors.ts`) con
      re-export desde auth-helpers. Destino: hardening .2.
- [ ] (observación del implementer, footnote 4 de la tabla E6 del reporte)
      **signup y skus también aceptan body JSON no-objeto** — hoy caen a
      500 JSON vía sus catch internos (no crudo, gracias al wrapper +
      catches pre-existentes); extender el guard R1 ahí (400 fino
      `INVALID_BODY`) = decisión futura, candidato al próximo touch de
      esas rutas.

## T5 — minors de la doble review (no bloquean; registrados 2026-08-15)

> Hallazgos MINOR del carril quality (Q-*) de la tanda única de T5
> (copy). Carril spec: PASS sin hallazgos y ambos checkpoints en PASS.
> Cero MAJOR: el diff fue al filtro externo SIN fix pass. Detalle
> completo con escenarios en `.superpowers/sdd/t5-review-spec.md` y
> `t5-review-quality.md`.

- [ ] (Q-1 quality) **Envenenamiento residual del historial por camino
      compuesto**: un mensaje largo que falla por RED (error genérico →
      queda en el historial) seguido de un mensaje corto NUEVO (en vez
      de Reintentar) → el server 400-ea por el mensaje viejo, pero el
      efecto de limpieza remueve y "restaura" el mensaje corto inocente
      (criterio "último user sin assistant posterior") — el ofensor
      nunca sale y el panel queda envenenado hasta navegar fuera
      (`components/analisis/chat-panel.tsx:159-175`). Camino compuesto
      y raro. Fix candidato: remover TODOS los user trailing sin
      assistant posterior, o capturar el id del ofensor en
      `handleSubmit`. Destino: próximo touch de chat-panel.tsx.
- [ ] (Q-2 quality) **`setInput(restoredText)` puede pisar un borrador
      en tipeo** cuando llega el 400 (el input no se deshabilita
      durante el in-flight; `chat-panel.tsx:176`). Destino: próximo
      touch de chat-panel.tsx.
- [ ] (Q-3 quality) **Copy del 429 duplicado inline** entre el JSX
      (`chat-panel.tsx:238-241`) y el announcer (`:269`) — riesgo de
      drift visual vs. screen reader; el de MESSAGE_TOO_LONG sí
      comparte const. Extraer a const compartida en el próximo touch.
- [ ] (Q-4 quality, teórico) **`useMemo` no es garantía semántica de
      "una vez por objeto de error"** per React docs (puede recomputar);
      nota de robustez sin acción requerida — el guard real del efecto
      de limpieza es `handledErrorRef`, no el memo.

## Pendiente-por-archivo

- [ ] **Code-skip §5.4 con archivo Amazon real** — ítem 5 del smoke de B4,
      abierto en el plan archivado
      (`docs/archive/fase2-bloques/2026-06-22-b4-portales.md:1673`): el
      smoke de B4 corrió con Soriana/Chedraui; la columna de códigos
      (Amazon/ASIN → pick-list manual, sin sugerencias basura) tiene
      cobertura unit (codeSkip §5.4) pero no smoke con archivo real.
      Verificar cuando exista un archivo Amazon; candidato al smoke de
      producción.
