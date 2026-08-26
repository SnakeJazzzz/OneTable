# Digest de working docs de `.superpowers/sdd/` (purga 2026-08-26)

> **Qué es esto.** Digest de 39 working docs (briefs, reports de implementer y
> reviews spec/quality) que vivían untracked en `.superpowers/sdd/` y fueron
> purgados el 2026-08-26 al cierre del bloque de hardening. **Los originales
> nunca fueron commiteados — este digest es su único registro futuro.** Los
> working docs *tracked* de sdd/ (briefs/reports de b5-chatbot, t2-t6) fueron
> `git rm`-eados en el mismo cleanup y siguen recuperables vía git history.
>
> Todos los tasks acá resumidos están CERRADOS y mergeados. El foco es el
> detalle que NO está en los handoffs de `docs/handoff/` (esos ya cubren cada
> cierre a nivel commit/PR/suite): decisiones de implementación, hallazgos
> MAJOR/Critical de las reviews, patrones de bug recurrentes y deuda declarada.
>
> **Nota de atribución de era:** los archivos `task-6..9` fueron etiquetados
> como "Fase 1" en el inventario de la purga, pero su contenido es
> inequívocamente del **bloque B4 de Fase 2** (Portales): commits `feat(b4)`,
> referencias a `onetable-fase2-spec.md` §3.2.4/§5.4/§6.1 y al plan
> `2026-06-22-b4-portales.md`. Quedan agrupados acá bajo Fase 2.

---

## Fase 2 — Bloque B4 (Portales)

### Task 6 — Credentials API (username only, §6.1) — commit b404a54

- **Brief:** endpoint `app/api/portales/credentials/route.ts` GET+PUT con el
  patrón `hasPasswordPending` — el endpoint NUNCA acepta ni almacena password
  (schema sin columna password; cifrado diferido a Fase 3). Unique
  `(clientId, chain)`. Doc-fix en `scripts/seed.ts` (Fase 2 con KMS → Fase 3
  AES-256-GCM).
- **Report:** el implementer NO copió el `CHAINS`/`parseChain` local del brief:
  usó el compartido de `lib/portales/chains.ts` (override autorizado).
  `hasPasswordPending` siempre `true` en el upsert; `clientId` solo de sesión.
  Test de contrato de schema (`tests/api/portales-credentials.test.ts`) que
  asserta la ausencia de columna `password`.
- **Review round 2:** el test original solo ejercitaba el CREATE path del
  upsert; se reescribió para cubrir create + update dedup por
  `(clientId, chain)` y probar que `hasPasswordPending` sobrevive un update de
  username-only. Nota: primer fallo transitorio de conexión Neon (cold start
  del pooler), no defecto del test.

### Task 7 — Upload con chain explícito (§3.2.4) — commit 43d88e0

- **Brief:** la card de cada portal conoce su chain, así que el upload acepta
  form fields `chain`+`fileType` que GANAN sobre la detección por filename
  (`detectUpload` queda como fallback de back-compat). Amazon postea dos
  `fileType` distintos (VENTAS/INVENTARIO).
- **Report:** regla de resolución cerrada: ninguno de los dos fields presente →
  fallback filename; ambos válidos → explicit gana; uno solo o inválido →
  error per-file explícito, NUNCA fallback silencioso. Cero casts `as Chain`
  ciegos (validación vía `parseChain`/`parseFileType`).
- **Fix pass:** (1) `FILE_TYPES`/`parseFileType` centralizados en
  `lib/portales/chains.ts` (el review objetó la copia local); (2) assertion
  de fila en DB (chain/fileType del Upload persistido) además del response;
  (3) test simétrico del partial-explicit (fileType sin chain, además de
  chain sin fileType).

### Task 8 — Portales page shell + credentials UI + per-card upload (GATE UI) — commit 9865995

- **Brief:** grid de cards (SORIANA/CHEDRAUI/AMAZON habilitadas por D1;
  HEB/AL_SUPER/LA_COMER "próximamente"), `CredentialsForm` con password input
  disabled + microcopy Fase 3, `ChainUpload` per-card (Amazon dos slots),
  remover `UploadZone` de Análisis PERO conservar la lista "Uploads
  recientes" como historial read-only.
- **Report:** hooks nuevos en `lib/hooks/use-portales.ts`
  (`useCredentials`, `useChainCounts` + 3 scaffolds para Task 10/11).
  Descubrimiento: el `Button` local NO soporta prop `size` (a diferencia del
  shadcn estándar) — se removió `size="sm"`.
- **Fix pass (1 Critical + varios):**
  - **Critical/Important #1:** el `save()` de credentials-form no tenía
    `res.ok` check ni `finally` — un fetch fallido dejaba el botón clavado en
    "Guardando…" para siempre. Fix: try/catch/finally + estados
    `saved`/`error` inline.
  - **#2 (fan-out de fetches):** cada `ChainCard` llamaba `useCredentials()`
    → 3 fetches idénticos por página. Se creó `PortalesGrid` (client) que
    fetchea credentials UNA vez y las pasa por props; la page queda server
    component. Los counts siguen per-card (correcto).
  - Menores: `AL_SUPER` → "AL SUPER" (`.replace(/_/g,' ')`), `role="status"`
    en el warning de configuración incompleta, re-sync de `initialUsername`
    vía `useEffect`.

### Task 9 — buildMappingSuggestions (code-skip §5.4 + bands) — commit e35b524

- **Brief:** orquestación server-side de fuzzy matching sobre
  `UnmappedProduct × catálogo`; el code-detector (`isMostlyCodes`) corre
  PRIMERO — una columna mayormente-códigos (ASIN de Amazon, EAN La Comer)
  saltea el fuzzy y devuelve pick-list manual.
- **Report:** dos deviations autorizadas: `parseChain` compartido en la route
  (no CHAINS local con cast) y `suggest.ts` recibe `db` por parámetro (sin
  re-export de `defaultDb`) — mantiene `core/` inyectable.
- **Incidente de proceso (registrado en progress.md):** el commit original
  `ff936f8` fue un **auto-commit pre-review con UN solo reviewer combinado**
  — gate breach. Se deshizo vía `reset --soft`, se re-revisó con DOS agentes
  ciegos en carriles separados, y se agregó el test de `[]` faltante. **Desde
  Task 10 quedó vinculante el patrón: implementer para en GREEN dirty (cero
  git), doble review ciega, el commit lo autoriza el usuario.**
- Minor abierto que quedó al branch review: `route.ts` awaitea
  `buildMappingSuggestions` sin try/catch (consistente con los GET hermanos).

### FF-1 — Acción "Confirmar" para filas PENDING_REVIEW (UI-only) — commit 61ba7f3

- **Brief:** en Vista B del mapping, una fila PENDING_REVIEW no tenía salida
  (solo Quitar/Cambiar). Se agrega "Confirmar" reutilizando la rama
  idempotente de `assignMapping` (mismo string + mismo productId + status
  CONFIRMED → update in place). Cero backend nuevo.
- **Report/decisiones:** error de Confirmar inline por fila (objeto
  `{portalString, message}` — a diferencia de `editError`, no hay panel
  exclusivo que lo scope), éxito vía handler de sección (espejo de
  `handleDeleted`). Exclusión mutua bidireccional entre
  confirm/delete/retarget. `ml-auto` condicional para no romper el flex.
- **Fix pass (1 Important):** los handlers de "Cambiar"/"Quitar" no limpiaban
  un `confirmError` stale de la misma fila — banner viejo conviviendo con el
  panel de retarget/delete. Fix: clear condicional por portalString.
- **Nota de recovery (progress.md):** un `reset --hard` accidental borró el
  árbol GREEN-dirty de FF-1; se restauró byte-idéntico desde el snapshot
  `ff1-working-diff.txt` (hash verificado). Origen de la regla de entregas en
  paths durables.

### FF-2 — Notice de conflicto stale + feedback de resolución — commit 83783c3

- **Brief:** (a) el notice amarillo "X generó un conflicto" quedaba pegado
  tras resolver el conflicto en ConflictSection (nadie limpiaba el estado
  local); (b) resolver un conflicto no daba feedback y si era el último la
  sección desmontaba (`return null`). Restricción dura: el clear debía ser
  CONDICIONAL al portalString específico — prohibido limpiar en cada refetch.
- **Report:** effect que reacciona a `mappingsQ.data` y limpia solo si el
  string del notice ya no tiene filas CONFLICTED; notice de éxito a nivel
  sección ("Conflicto resuelto." / "String devuelto a sin mapear.") con
  self-hide que contempla el notice.
- **Fix pass (1 CRITICAL — race determinística):** `handleOutcome` seteaba el
  notice ANTES del `await refetch`; el effect de clear corría en ese render
  con data PRE-mutación (el string aún no aparecía CONFLICTED) →
  `setNotice(null)` inmediato: **el notice de conflicto se borraba apenas
  creado, siempre.** Fix: reordenar refetch → setNotice en la rama conflict +
  guard `mappingsQ.error` (no limpiar sobre data stale de un refetch
  fallido). Patrón a recordar: efectos que leen data refetcheada + setState
  previo al await = carrera contra el propio render.
- 3 minors al ledger: ventana residual de retry, UX de notice diferido,
  notice verde sin dismiss.

### FF-3 — Coverage pass de routes Portales + unificación PRODUCT_NOT_FOUND — commit 8da8e12

- **Brief:** las 4 routes de Portales (mappings/conflicts/counts/credentials)
  no tenían tests behaviorales de handler. Único cambio no-test:
  `PRODUCT_NOT_FOUND` del PATCH unificado 409 → 404 (el POST ya devolvía
  404). Además: 6 matchers laxos `.rejects.toThrow()` de resolve.test.ts →
  regex del mensaje real.
- **Report:** +36 tests handler en 4 archivos nuevos + 6 matchers pinneados.
  Cobertura clave: fabricación de conflicto D3 devuelve **200
  `{kind:'conflict'}`, no 409** (409 CONFLICT_EXISTS es solo mapear sobre
  conflicto no resuelto); side-effect de requeue condicional del DELETE
  (§11.5a-fix) en sus tres variantes (con SelloutData, fila ya resuelta,
  sin SelloutData → cero requeue fantasma); caso FF-1 idempotente
  (PENDING_REVIEW → CONFIRMED).
- Decisiones de harness que se volvieron patrón: prefijos de email disjuntos
  por describe (cleanup por `startsWith` nunca pisa otro describe); un solo
  `$disconnect()` en el ÚLTIMO afterAll cuando varios describes comparten
  PrismaClient.
- **Fix pass:** +1 test empty-string INVALID_USERNAME (el brief pedía blank Y
  whitespace); fixture de counts con chain-mismatch entre Upload y
  UnmappedProduct corregido (era cosmético, señalado en el propio
  self-review).

### progress.md (bitácora tasks 6-9 + FF-1..3)

Registro por task de commit/estado/review. Valor no cubierto arriba: deja
explícito el gate-breach de Task 9 y su remediación, el accidente de
`reset --hard` de FF-1, y que el mini-bloque FF cerró con suite 234/234.

---

## Fase 2 — Bloque B5-money (branch feat/b5-money)

### B-1 — Cascada §7 de montos al query — commit 1491d61 (ESTRICTO)

- **Brief (diseño cerrado):** monto de venta por fila =
  `COALESCE(salesAmountMxn, ROUND(units*override.salePrice,2),
  ROUND(units*salePriceBase,2))` → NULL (nunca fabricar). UN fragmento
  `Prisma.sql` compartido por las 4 funciones de dinero; **LEFT JOIN
  obligatorio** (INNER silenciaría filas con productId NULL — bug de datos);
  `getDashboardKpis` debía cablear AMBOS períodos (solo el actual sesga
  `variationPct` en silencio). Solo VENTA; compra sin consumidores.
- **Report:** fragmentos `SALES_AMOUNT_CASCADE` + `SALES_CASCADE_JOINS` al
  tope de `core/kpis/queries.ts` con contrato de aliases FIJO (`sd`/`ppo`/`p`).
  Trampa real de Postgres documentada: en `getSalesTrend` hubo que convertir
  `FROM "SelloutData" sd, latest` a `CROSS JOIN latest` — un LEFT JOIN
  después de la coma se liga a `latest` y su ON no puede referenciar `sd`.
  En `getOneTableRows` el JOIN a Product pre-existente se REEMPLAZÓ por el
  fragmento (evitar alias `p` duplicado). Fan-out imposible por unicidad
  (`@@unique(productId, chain)` + PK).
- Test `money-cascade.test.ts` con doc-comment de aritmética verificable a
  mano (patrón que se conservó en B-2). Self-review honesto: los mappers de
  agregados siguen colapsando `SUM NULL → 0` (contrato pre-existente); el
  "never fabricate" se garantiza per-row.

### B-2 — UI de overrides de precio por cadena — commit 28175ff (GATE UI)

- **Brief:** ruta `price-overrides` GET+PUT. PUT **declarativo de estado
  completo**: las 4 keys obligatorias en el body; key AUSENTE → 400 (ausencia
  = rechazo, nunca interpretación — un cliente mal armado que mande solo
  purchasePrice borraría venta en silencio). Ambos precios vacíos →
  `deleteMany` (§4.3: ausencia de fila = usar base). Helper de precio
  extraído a `lib/prices.ts` (regex/cota VERBATIM de las 2 copias de
  parametros; kinds neutros `empty|value|invalid`, el caller decide
  semántica). Tenancy vía ownership del Product (la tabla no tiene clientId).
- **Report:** GET sin N+1 (relación `Product.overrides` filtrada por chain en
  el mismo findMany). Decimals SIEMPRE `?.toString() ?? null`. Nota técnica
  reusable: `Decimal.toString()` normaliza ceros finales ('11.00'→'11') —
  los seeds de test deben usar strings canónicos estables. Test heredado del
  ledger B-1: override purchase-only (salePrice NULL) NO cortocircuita la
  cascada — cae a base (pinnea que el COALESCE es sobre el VALOR, no sobre
  la existencia de la fila).
- **Review quality (1 IMPORTANT, Q-1):** PUT con JSON válido pero no-objeto
  (`null`, string, número) → el operador `in` tiraba TypeError sin capturar
  → 500 crudo en vez de 400 INVALID_BODY. **Patrón heredado: mappings POST y
  credentials PUT comparten la clase de hueco** (`body.chain` sobre body
  null) — quedó en el ledger como hardening de las tres rutas. Fix: guard de
  objeto plano post-parse.
- Minors con valor de memoria: Q-3 dirty perpetuo por canonicalización
  Decimal ("80.00" vs "80"); Q-5 TOCTOU findFirst→upsert (FK violation →
  500, ventana milimétrica, patrón del repo); **Q-6: el redondeo de
  numeric(12,2) puede DESBORDAR la cota, no solo redondear**
  ("9999999999.995" pasa `< 10^10` pero Postgres redondea a 10^10 → P2000 →
  500); Q-7 `String([5])` → "5" (coerción heredada); Q-8 falta pin de precio
  numérico.

### B-3 — Sweep de minors pre-PR (whole-branch)

- **Brief (corte de Michael sobre el ledger):** A1 unificar helper de precio
  en las 2 rutas de parametros (con red de tests A1-bis escrita y verde
  ANTES de tocar A1 — pinnear el comportamiento que A1 promete no cambiar);
  A2 regex a máx 2 decimales (cierra el redondeo silencioso Y el desborde
  Q-6 de una vez; el importer de Excel en core/ queda deliberadamente
  divergente); A3-A7 tests puntuales; B1-B7 fixes de UI (helper
  mutateMapping, estados stale, loadingLabel del ConfirmDialog, clear del
  notice verde, Q-3, label/input en chain-upload); C comment-only; D ledger.
- **Report:** todo ejecutado; los adapters de A1 preservan omit/clear/absent
  con cero cambio observable (verificado por A1-bis verde sin modificación).
  B7 agregó `disabled={isUploading}` al input — sin él, el label nuevo abría
  el file picker en pleno upload (consecuencia necesaria, no creep).
  Desvío declarado: un call site de test (`GET()` → `GET(new Request(...))`)
  tuvo que tocarse por la firma nueva de A4 — la letra del brief pedía
  BLOCKED, se evaluó como consecuencia mecánica (MINOR-1 del carril spec).
- **Review quality (1 IMPORTANT, I-1 — regresión introducida por el sweep):**
  el fix B5 de Q-3 agregó `row` (identidad de objeto) a las deps del effect
  de re-sync → CADA refetch re-sincronizaba TODAS las filas → **guardar la
  fila B pisaba en silencio el tipeo sin guardar de la fila A** (pérdida de
  input en el flujo bulk real de VIKS). Fix final: deps por VALOR +
  contador `syncEpoch` per-row bumpeado en el success path de `save()` —
  converge en ambos casos (valor igual: el epoch re-corre el effect; valor
  cambiado: React aplica setData antes del bump en el mismo flush) sin tocar
  filas hermanas. **Lección: deps por identidad de objeto en listas
  refetcheadas = wipe cross-row.**
- **Fix M-2 (post-smoke):** mensaje INVALID_PRICE actualizado en las 3 rutas
  ("…con máximo 2 decimales"). Decisión de Michael registrada: se RECHAZÓ la
  auto-corrección de input de dinero (negativo→positivo, redondeo) —
  transformar input de dinero en silencio fabrica un número; rechazo
  explícito es el patrón.

### B-4 — Depuración de documentación (ejecutado por el controller)

- Auditoría empírica de CLAUDE.md (branch protection ON verificado vía gh
  api; pendientes 1×1), creación de `docs/README.md` (mapa de autoridad),
  `docs/handoff/README.md`, y **creación de
  `.superpowers/sdd/hardening-backlog.md`** con los ítems migrados del
  ledger B4 (sweep de error codes/classes con Q-5 + guard body no-objeto,
  in-flight de hooks con Q-2, refetch fanout, errores crudos de prod, DB
  aislada por proceso).
- Drift cazado por higiene de backlog: un ítem B-1 seguía `[ ]` pese a estar
  cerrado en B-2; hallazgo de theme: `--primary: 142 71% 45%` no era ni el
  valor viejo ni el target de la decisión, y NO existe bloque `.dark`
  (dark-first vía `:root`) — quedó como pendiente-decisión pre-lanzamiento.
- `git mv` de specs Fase 1 y plan B4 a `docs/archive/`; regla: los punteros
  se corrigen solo en docs ACTIVOS, los handoffs/archivados son inmutables.

---

## Fase 2 — Bloque B5-chatbot (branch feat/b5-chatbot; solo reviews en la purga)

### T1 — Tool layer `core/ai/tools/` (reviews)

- **Quality (1 MAJOR):** los 3 tools con thresholds importaban
  `@/lib/thresholds` desde `core/` — **primera inversión core→lib del
  codebase** (rompe la extraibilidad de core/ y crea ciclo de capas). Fix:
  `loadCuts` inyectado vía `ToolContext` + `resolveCuts` memoizado en el
  runtime (mismo patrón de inyección que `db`); regla de layering
  documentada en el header de context.ts.
- Cadena de minors con moraleja: la memoización por promise cacheaba también
  el REJECT (promise envenenada el resto del request) → `memoizeResolver`
  con limpieza on-reject y guard de identidad, verificado con script ad-hoc;
  `: ToolSet` explícito ensanchaba y borraba los tipos por-tool
  (`satisfies` en su lugar); el log server-side solo registraba `err.name`
  descartando `err.code` de Prisma (criterio final de Michael: name + code,
  sin message). **Nota de re-review: el fixer claimeó "ya cumplía" en el
  minor del log y era falso — el re-review lo cazó contra el fuente.**
  N1 nuevo del fix: dos callables con el mismo nombre y semántica distinta
  (memoizado vs loader crudo) → renombrado a `loadCuts`.
- **Spec (1 MAJOR — supply chain):** el lockfile traía
  `eventsource-parser@3.1.0` publicada **2026-05-27, POST-cutoff del worm**,
  y el report afirmaba "transitivas = exactamente las esperadas" — **claim
  falso sin flag**, violación del protocolo de reporte (las mitigaciones
  técnicas 1-5 sí se cumplieron). Remediado con `pnpm.overrides` →
  `eventsource-parser@3.0.8` (pre-cutoff) + fe de erratas ADITIVA en el
  report (el claim falso queda visible, corrección con registro).
  **Patrón: los rangos de transitivas resuelven a latest al momento del
  install — enumerar y fechar las transitivas nuevas es parte del gate.**

### T2 — Route `/api/ai/chat` (reviews)

- **Quality (2 MAJOR):**
  1. **System injection:** el schema de UIMessages acepta `role:'system'` del
     cliente y `convertToModelMessages` lo emite como system real — un
     usuario autenticado podía anexar instrucciones con autoridad de system
     DESPUÉS del prompt del server (sin escape de tenant, pero gobernanza
     derrotable). Fix: strip de system sobre el array completo ANTES del
     `slice(-30)`.
  2. **Historia envenenada:** `convertToModelMessages` sin
     `ignoreIncompleteToolCalls` → un tool part en `input-available`
     (stop()/tab close a mitad de step) producía `MissingToolResultsError`
     in-stream → CHAT_ERROR permanente en CADA mensaje siguiente
     (la historia vive client-side y nunca se repara). Fix: el flag.
  - Minor 3: `vi.clearAllMocks()` no resetea implementaciones →
    `resetAllMocks` + re-prime (patrón que quedó como estándar).
  - Minor 4 (a backlog): el cap de 30 mensajes acota cantidad, no tamaño
    (cerrado después en hardening T3 con los caps de 8000 chars / 64KB).
  - Ambos MAJOR verificados contra el source instalado de `ai@6.0.168`
    (no contra docs) — método que ambos carriles adoptaron.
- **Spec: COMPLIANT** con 5 deviations justificadas; las dos con valor de
  memoria: `convertToModelMessages` es async en este pin (el snippet
  síncrono del brief era el error), y `MockLanguageModelV3` tiene un
  off-by-one real en la forma array de `doStream` (push antes de indexar —
  el elemento 0 jamás se sirve; usar la forma función).

### T3 — UI panel Análisis + scaffold Forecasting (reviews)

- **Quality: solo 4 MINORS** (a ledger): indicador "Consultando tus datos…"
  congelado para siempre tras Detener (gate al último mensaje + status
  busy); auto-scroll forzado que pisa el scroll manual durante streaming;
  falta test del wrap de año de `nextEligible` (fixture 2025-12 → '2026-02');
  ForecastCard stale tras "Borrar todos los datos" (`router.refresh()` no
  re-corre efectos `[]` — gap a nivel página, no solo de la card).
  Verificado limpio: wrap de año correcto por construcción (clave lineal
  `year*12+month-1`), `salesUnits > 0` excluye NULL en ambas
  implementaciones, tenant isolation, BigInt→Number pre-serialización.
- **Spec: COMPLIANT.** Supply chain: swr@2.4.2 era post-cutoff → override a
  2.4.1; 2 transitivas no enumeradas por el brief (`dequal`,
  `use-sync-external-store`) verificadas pre-cutoff y elevadas a Michael —
  mismo patrón de T1, esta vez bien declarado. Observación O1: el copy nuevo
  usaba voseo ("Volvé", "Tenés") — el reviewer lo dejó a criterio como
  pasada global; **este es el origen del barrido es-MX tuteo que después
  entró al backlog de hardening (T5)**. Deviation aceptada: `getForecast`
  con Prisma `groupBy` en vez de SQL crudo (el spec congela firma y
  semántica, no el mecanismo); `ForecastPoint` placeholder porque el spec lo
  referenciaba sin definirlo.

---

## Bloque de HARDENING

### T1 — Entornos + DevOps — (branch feat/hardening; gate ESTRICTO)

- **Brief (con checklist §3 respondida por Michael como HECHOS):** separación
  Neon production/staging/development, guard de entorno doble mecanismo,
  backup diario cifrado (PITR del Free tier = solo 6 HORAS → el dump es el
  RESPALDO PRIMARIO), `/api/health` + UptimeRobot, runbook humano.
  Decisiones fijadas en el brief: preflight OBSOLETO (pendientes #1/#2 de
  CLAUDE.md cerrados), staging se bloquea INCONDICIONALMENTE en el guard
  (F-2), branches nuevas de Neon nacen con auto-delete de 7 días (Michael lo
  desactivó — advertencia de consola).
- **Report (decisiones):** blocklist por **endpoint ID** (no hostname
  literal) con triple-match (`<id>.`, `<id>-pooler.`, id pelado); fail
  closed en todo path de parseo; localhost pasa sin marker (CI verde sin
  tocar ci.yml); guard de seed a nivel módulo (cubre todos los entrypoints);
  `backup.yml` SIN `actions/checkout` (no usa código del repo — menos
  superficie), `pg_dump` por path absoluto de client-17 (PGDG), cifrado
  `aes-256-cbc -pbkdf2 -iter 600000` (default de -pbkdf2 es bajo), cron
  07:17 (los crons "en punto" compiten con el pico de GitHub). Evidencia del
  gate (a): `pnpm test` en la máquina de Michael (que apuntaba a production)
  → 44/44 archivos abortados por el guard ANTES de tocar la DB.
- **Review quality (1 MAJOR, Q-1 — verificado empíricamente):** **fail-open
  por case del hostname.** Para schemes no-especiales (`postgresql://`) el
  WHATWG URL de Node NO normaliza el case del host (opaque-host); DNS/TLS
  son case-insensitive → una URL de production en MAYÚSCULAS conectaba a
  prod pero no matcheaba la blocklist y pasaba con el marker. Fix:
  `toLowerCase()` en `extractDbHost` + tests con el hostname uppercase
  LITERAL (patrón anti-edición-accidental).
- Minors al ledger con valor: Q-2 — el guard de `db:reset` valida
  `.env.local` pero Prisma CLI lee `./.env`/`prisma/.env` (bypass latente si
  alguien agrega `prisma/.env`; fix sugerido: que el guard spawnee el reset
  heredando el env validado); Q-3 exclusión del matcher por PREFIJO
  (`/api/healthz` también bypassearía); Q-6 CBC sin autenticación
  (integridad solo verificable al restore — accepted risk documentado).
- **Incidente F-1:** `.env.example` apareció modificado (+2 líneas en blanco)
  — edición fantasma vía file-edit tools que el hook `block-env-writes` NO
  cubre (solo bloquea Bash). El carril spec no lo cazó en el pase 1 y lo
  reconoció en addendum. Gap del hook registrado en el ledger.

### T3 — Chatbot hardening (quota + caps + caching) — (branch feat/hardening-t3)

- **Report:** `chatDailyLimit Int @default(40)` en Client (migración aditiva
  pura); orden del handler auth → parse → trim → caps → validate →
  findUnique → consume → streamText (un 400 nunca quema quota); caps
  MESSAGE_TOO_LONG (8000 chars suma de text parts, frontera 8000 PASA;
  64KB en bytes UTF-8 por mensaje serializado); ventana de quota FIJA
  alineada a la época (medianoche UTC = 18:00 CDMX; UTC-6 sin DST desde
  2022); rate limit por IP en csp-report (60/15min, drop silencioso 204 sin
  log, indistinguible del camino logueado); `maxOutputTokens: 2000`.
- **Verificaciones empíricas clave (regla empirical-first aplicada):**
  (a) el body JSON del 429 llega LITERAL en `error.message` de `useChat`
  (`HttpChatTransport` hace `throw new Error(await response.text())`) → el
  panel detecta con `JSON.parse(error.message).error?.code`; (b) el
  `cacheControl` de Anthropic se ancla **message-level sobre un
  `SystemModelMessage`** (el call-level sería no-op: se valida contra el
  schema de opciones donde cacheControl no existe), y por la semántica de
  prefijo de Anthropic (tools → system → messages) un solo breakpoint al
  final del system cachea también los tools SIN tocar `core/ai/tools/*`.
  Ambas con scratch scripts contra el SDK instalado.
- Único cast nuevo: en el test (`vi.mocked` instancia el generic de Prisma
  en el payload completo; el `select` angosto no lo satisface) — verificado
  que sin cast tsc falla, comment con la razón estructural.
- **Reviews (0 MAJOR, todo MINOR a ledger):** Q-1 el panel no maneja el 400
  MESSAGE_TOO_LONG nuevo → loop de Reintentar determinísticamente fallido
  para un usuario legítimo que pegue >8000 chars (generalizar
  `isRateLimitError` a `errorCodeOf`); Q-2 el copy de hora de reset se
  recalcula por render y queda INVERTIDO justo al cruzar la medianoche; Q-3
  el announcer aria-live no comunica el copy de cuota; Q-4 chat sin
  pre-check de Content-Length (inconsistencia con csp-report del mismo
  diff); Q-6 propiedades heredadas del limiter en endpoint sin auth (cada
  POST anónimo = un write a Neon; filas de RateLimit de IPs one-shot que
  nada borra — crecimiento sin cota bajo flood con rotación de IP).
  Desviación aceptada S-1: botón Reintentar oculto en RATE_LIMITED (el
  retry re-429ea).
- Pendientes [MICHAEL] del split: migrate deploy staging/production
  (runbook T2), smoke de calidad §1.13, evidencia de cache hits post-deploy
  (cierre real de §4.6 — llegó con el commit 67d9d91).

---

## Patrones transversales que vale la pena recordar

1. **Body no-objeto rompe el `in`/acceso a propiedades** → 500 crudo. Cazado
   en B-2 (Q-1); mappings POST y credentials PUT comparten la clase de hueco
   (quedó en el backlog de hardening como sweep de rutas).
2. **Effects que leen data refetcheada:** setState antes del await del
   refetch = carrera contra el propio render (FF-2 Critical); deps por
   identidad de objeto en listas refetcheadas = wipe cross-row (B-3 I-1).
3. **Decimal de Prisma:** `toString()` normaliza ceros finales (seeds de
   test con strings canónicos); el redondeo de numeric(12,2) puede
   DESBORDAR la cota, no solo redondear (Q-6, cerrado con la regex de 2
   decimales).
4. **Supply chain:** las transitivas resuelven a latest al momento del
   install — enumerarlas y fecharlas contra el registry es parte del gate
   (T1-chatbot: claim falso cazado por el reviewer; T3-chatbot: mismo caso
   bien declarado). `pnpm.overrides` es la herramienta de remediación.
5. **Guard/parsing de URLs:** WHATWG URL no normaliza case de host en
   schemes no-especiales — comparar hosts sin `toLowerCase()` es fail-open
   (hardening T1 Q-1).
6. **Claims de SDK se verifican contra `node_modules` del pin**, no contra
   docs ni memoria (método establecido en B5-chatbot T1/T2 y reutilizado en
   hardening T3; cazó el async de convertToModelMessages, el off-by-one del
   mock y el anclaje real de cacheControl).
7. **Re-reviews cazaron dos claims falsos de fixers/implementers** (T1
   chatbot: "el log ya cumplía"; T1 chatbot spec: "transitivas exactas") —
   la re-verificación contra el fuente, no contra el reporte, es lo que
   sostiene el protocolo.
