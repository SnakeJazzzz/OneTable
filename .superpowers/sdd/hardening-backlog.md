# Hardening backlog — post-merge bloque B (creado 2026-07-15, B-4)

> Sucesor de `b4-followups.md` (cerrado 2026-07-15). Cada ítem migrado cita
> su origen; el texto de los migrados es VERBATIM del ledger anterior.
> Tracked pero gitignored: `git add -f` SIEMPRE.

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
      dev DB. Antes de que VIKS cargue data real: database/branch de prod
      separada, backups automáticos, y el trigger de "operaciones
      destructivas requieren OK explícito" (ya en CLAUDE.md) queda activo.
- [ ] **Ambiente de pre-producción** para smoke de deploys antes de
      promover a prod.
- [ ] (origen: pendiente #2 de CLAUDE.md, confirmado inexistente
      2026-07-15) **Segunda Neon branch para preflight DB** — junto con la
      DB de prod separada; necesaria solo si se reusa scripts/preflight.ts.
- [ ] (origen: brief T1 B5 §6, diferido por decisión) **Rate limiting por
      usuario del chat IA** (`/api/ai/chat`): cada mensaje dispara hasta 5
      steps de modelo + queries; sin límite por usuario el costo es
      open-ended. Diseñar junto con el resto de límites de prod.

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

## Pendiente-por-archivo

- [ ] **Code-skip §5.4 con archivo Amazon real** — ítem 5 del smoke de B4,
      abierto en el plan archivado
      (`docs/archive/fase2-bloques/2026-06-22-b4-portales.md:1673`): el
      smoke de B4 corrió con Soriana/Chedraui; la columna de códigos
      (Amazon/ASIN → pick-list manual, sin sugerencias basura) tiene
      cobertura unit (codeSkip §5.4) pero no smoke con archivo real.
      Verificar cuando exista un archivo Amazon; candidato al smoke de
      producción.
