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

1. **ENTORNOS + DEVOPS.** Branches de Neon production/staging/dev con
   `DATABASE_URL` por entorno en Vercel (production/preview/development).
   Backups: verificar retención PITR del plan de Neon + GitHub Action cron
   semanal de pg_dump cifrado. El smoke de Michael sobre la URL de preview
   del PR se vuelve gate obligatorio pre-merge (documentar la regla en
   CLAUDE.md dentro del task). `/api/health` con check de DB + monitor
   externo (UptimeRobot) con alerta a Michael. Piggyback: branch de
   preflight (pendiente #2 de CLAUDE.md). Estrategia confirmada:
   trunk-based + previews de Vercel (NO branch development permanente).

2. **SEGURIDAD.** `next` 14.2.18 → 14.2.35 con protocolo supply-chain
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

3. **CHATBOT.** Rate limit por usuario con contador Postgres, límite leído
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

4. **ROBUSTEZ / OBSERVABILIDAD.** Error boundaries (`error.tsx`,
   `global-error.tsx`, `not-found.tsx` con estilo de la app). Sweep
   `withRouteErrors()` + error codes/classes en los services en UNA SOLA
   pasada por rutas (rutas clase b/c ya listadas en este backlog). Logs
   estructurados con contexto en el error path.

5. **COPY.** Barrido voseo → tuteo (greps de este backlog, re-verificar
   al ejecutar).

6. **CIERRE DEL BLOQUE.** Scanner baseline (OWASP ZAP) contra staging +
   triage de hallazgos con Michael (fix inmediato vs "hardening .2") +
   flip de CSP en prod a enforced.

### Fuera del bloque, con destino

- **xlsx build vendored del CDN** — pre-Fundadores; mitigación interim =
  cap de 10MB (punto 2).
- **Enumeración de signup (409 EMAIL_TAKEN)** — Fase 2.5, rediseño de
  signup con landing/cuentas.
- **Identidad visual** — pre-Fundadores.
- **Sentry** — evaluar POST-sweep de errores; criterios: se escapan
  errores en la práctica con logs+Vercel, el dep tree pasa supply-chain
  al install, el free tier alcanza.
- **Agente de triage de errores sobre logs** — experimento post-bloque;
  prerequisito: logs estructurados del punto 4; el reporte es el valor,
  el fix sigue pasando por el loop.

## Rutas / services

- [ ] **Sweep de error codes/classes en services y rutas.** Incluye tres
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

- [ ] **Errores técnicos crudos de cara al usuario.** Evidencia registrada:
      en prod, `/api/auth/callback/credentials` devuelve stack trace crudo
      en el error path (docs/handoff/session-b4-followups-end.md:65-67).
      Barrido: error boundaries + mensajes de usuario en rutas y páginas;
      los 500 con shape `{error}` uniforme ya existen en las rutas de
      Portales/Parámetros — el gap es auth y páginas server-side.
- [ ] **DB de prod separada + backups.** Hoy dev y beta comparten la Neon
      dev DB. Database/branch de prod separada, backups automáticos.
      Fundamento actualizado 2026-07-20: por DISEÑO (dev/tests no deben
      poder truncar la DB que servirá prod), no por urgencia de VIKS
      (arranca uso real post-Fase 3); el trigger de "operaciones
      destructivas requieren OK explícito" (ya en CLAUDE.md) sigue siendo
      el EVENTO de data real cargada.
- [ ] **Ambiente de pre-producción** para smoke de deploys antes de
      promover a prod.
- [ ] (origen: pendiente #2 de CLAUDE.md, confirmado inexistente
      2026-07-15) **Segunda Neon branch para preflight DB** — junto con la
      DB de prod separada; necesaria solo si se reusa scripts/preflight.ts.
- [ ] (origen: brief T1 B5 §6, diferido por decisión) **Rate limiting por
      usuario del chat IA** (`/api/ai/chat`): cada mensaje dispara hasta 5
      steps de modelo + queries; sin límite por usuario el costo es
      open-ended. Diseñar junto con el resto de límites de prod.
- [ ] (origen: review quality T2 B5) **Cap de TAMAÑO en el chat IA**
      (`/api/ai/chat`): el cap C1 acota CANTIDAD de mensajes (30) pero no
      TAMAÑO por mensaje — un mensaje de megabytes pasa entero al modelo.
      Evaluar cap de bytes/chars por mensaje o por ventana cuando se haga
      el hardening del chat (junto con el rate limiting del ítem anterior).

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

- [ ] (origen: decisión de Michael 2026-07-16, review externa del diff
      ESTRICTA de T3 B5 / O1 del carril spec) **Pasada de copy es-MX
      pre-lanzamiento: voseo → tuteo mexicano en TODO el copy de producto.**
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

- [ ] **[YA DECIDIDO — primer ítem de implementación] DB de prod separada +
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

- [ ] **Throws de DB inesperados devuelven 500 crudo (HTML/stack), no `{error}`,
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

- [ ] **Sin error boundaries en app/**: cero `error.tsx`, `global-error.tsx`,
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
      Esfuerzo: S.**

## Pendiente-por-archivo

- [ ] **Code-skip §5.4 con archivo Amazon real** — ítem 5 del smoke de B4,
      abierto en el plan archivado
      (`docs/archive/fase2-bloques/2026-06-22-b4-portales.md:1673`): el
      smoke de B4 corrió con Soriana/Chedraui; la columna de códigos
      (Amazon/ASIN → pick-list manual, sin sugerencias basura) tiene
      cobertura unit (codeSkip §5.4) pero no smoke con archivo real.
      Verificar cuando exista un archivo Amazon; candidato al smoke de
      producción.
