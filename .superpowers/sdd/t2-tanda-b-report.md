# Report — T2 SEGURIDAD, Tanda B (data layer: schema + wiring + caps)

> Implementer fresco, 2026-08-04. Base: `feat/hardening-t2` @ `ee88699`
> (Tanda A commiteada, árbol limpio al arrancar). Estado final: GREEN con
> árbol sucio — CERO git (ni add, ni commit, ni push), como manda el
> protocolo. Suite completa: **461 tests / 49 archivos, todos verdes**
> (baseline 446/47 → +15 tests, +2 archivos). `pnpm build` verde.
> `tsc --noEmit` limpio.

---

## 0. Rider inicial — remoción de `@auth/prisma-adapter`

- Supply-chain ANTES: `check-supply-chain.sh` ✅ limpio; grep del lockfile ✅
  cero matches.
- **`pnpm remove` NO acepta `--ignore-scripts`** (verificado empíricamente:
  `ERROR Unknown option: 'ignore-scripts'`). Se forzó vía
  `pnpm --config.ignore-scripts=true remove @auth/prisma-adapter` (además
  pnpm v10 no corre lifecycle scripts de deps sin allowlist, doble capa).
- Resultado: 3 paquetes fuera del lockfile (`@auth/prisma-adapter@2.7.4`,
  `@auth/core@0.37.4` y transitiva). `node_modules/@auth` eliminado; el
  único `@auth/core` del lockfile es **0.41.3** (patched, vía next-auth
  beta.32).
- Supply-chain DESPUÉS: ✅ limpio; lockfile grep ✅; pins exact ✅.
- **Audit post-remoción: 50 vulns (2 critical / 26 high / 20 moderate /
  2 low)** — antes 53 (3c/27h/21m/2l). Desaparecieron exactamente los 3
  GHSAs de `@auth/core@0.37.4` (grep del audit → 0 matches de
  GHSA-7rqj-j65f-68wh / GHSA-xmf8-cvqr-rfgj / GHSA-x445-f3h2-j279). Los 2
  critical restantes son los de vitest (dev-only, ya triageados grupo (a)).
- Ledger: RESOLUCIÓN del ítem marcada EJECUTADO con estas cifras.
- `auth.ts`: nota del header sobre el adapter actualizada (ya no está "en
  package.json sin usar"; quedó constancia de la remoción).

## 1. Modelo `RateLimit` + migración

- `prisma/schema.prisma`: modelo EXACTO del brief §5.1 (`@@id([scope, key,
  windowStart])` compuesto, sin índices extra), con comment de semántica.
- **Mecanismo real de `DATABASE_URL` para el CLI de Prisma (adyacencia
  Q-2), verificado empíricamente:** no existen `./.env` ni `prisma/.env`
  (`ls` lo confirma) y `pnpm exec prisma migrate status` SIN la var en
  shell falla con **P1012 "Environment variable not found: DATABASE_URL"**
  — el CLI NO lee `.env.local`. Mecanismo usado: exportar la var en el
  shell del comando leyéndola de `.env.local` vía `node -e` (solo lectura
  del archivo; nunca se editó env ni se imprimió el secret — solo el host
  para verificación: `ep-morning-dream-apphzoy1...` directo, sin
  `-pooler`).
- `prisma migrate dev --name add_rate_limit` contra development: OK al
  primer intento, **sin error de channel binding** (el string conserva
  `channel_binding=require` y no molestó). Migración generada:
  `prisma/migrations/20260805005159_add_rate_limit/migration.sql` (CREATE
  TABLE + PK compuesta, puramente aditiva).

## 2. Helpers del rate limiter — `lib/rate-limit.ts` (nuevo)

- `consumeRateLimit({scope,key,limit,windowMs})` → upsert crudo atómico
  (patrón raw de `batchUpsertUnmapped`) con `RETURNING "count"`;
  `allowed = count <= limit`. Límite por PARÁMETRO (T3 reusa este para el
  chat).
- `peekRateLimit(...)` → SELECT read-only de la ventana vigente;
  `allowed = count < limit`; NO incrementa.
- `recordFailure({scope,key,windowMs})` → mismo upsert, resultado
  descartado.
- `windowStart = floor(Date.now()/windowMs)*windowMs` (ventanas FIJAS
  alineadas; helper exportado `windowStartFor`).
- **Cleanup lazy montado en el MISMO statement del increment**: CTE
  data-modifying `WITH cleanup AS (DELETE ... WHERE windowStart < $curr)`
  + `INSERT ... ON CONFLICT` — un solo round-trip (las CTEs de
  modificación ejecutan siempre, referenciadas o no).
- **FAIL-OPEN** en los tres helpers: catch → log estructurado JSON
  (`source: 'rate-limit'`, op, scope, outcome fail-open; el KEY
  deliberadamente NO se loguea — email/IP son PII en Vercel logs) →
  `{ allowed: true, count: 0 }`. Nunca un 500 por culpa del limiter.
- Políticas PINNEADAS como constantes exportadas (`AUTH_WINDOW_MS` 15min,
  `LOGIN_EMAIL_LIMIT` 5, `AUTH_IP_LIMIT` 20) para que login y signup no
  diverjan en los números.

## 3. Wiring de login (`auth.ts`)

- **Evidencia de la firma `authorize(credentials, request)` sobre el
  paquete INSTALADO** (no solo types): en
  `node_modules/.pnpm/@auth+core@0.41.3/.../lib/actions/callback/index.js`
  la línea 12 destructura `headers` del request original y las líneas
  231-233 llaman `provider.authorize(credentials, new Request(url,
  { headers, method, body }))` — el segundo argumento es un `Request`
  estándar que conserva `x-forwarded-for`. Types concuerdan
  (`providers/credentials.d.ts:53-65`: `request: Request`). Verificado
  también que next-auth `5.0.0-beta.32` resuelve `@auth/core@0.41.3`.
- IP = primer hop de `x-forwarded-for`; fallback a bucket `'unknown'` si
  no hay header/request (tests y hits directos) — NO se salta el check
  (saltarlo permitiría bypass por header stripped).
- `peekRateLimit` por email (scope `login:email`) Y por IP (`login:ip`) en
  `Promise.all`, ANTES del lookup de user y de cualquier bcrypt. Si
  cualquiera excede → `null` genérico (trade-off anti-oráculo §2.7,
  documentado en comment para que ningún carril lo levante).
- FALLO de credenciales (email inexistente tras dummy compare, o password
  errado) → `recordLoginFailure` en AMBOS scopes. ÉXITO no incrementa ni
  resetea. Overshoot por carrera peek→fail: ACEPTADO, documentado en el
  comment de `recordLoginFailure`.
- Política: 5 fallos/15min email, 20 fallos/15min IP (constantes de
  `lib/rate-limit.ts`).

## 4. Rider `updateAge`

- `auth.ts`: `session: { strategy: 'jwt', maxAge: 86400 }` — `updateAge`
  dropeado (D1 del ledger). Comment de semántica rolling conservado, sin
  la mención a `updateAge`. Assert de config ajustado en
  `tests/api/auth-authorize.test.ts`. Ledger: ítem D1 marcado ejecutado.

## 5. Wiring de signup (`app/api/auth/signup/route.ts`)

- `consumeRateLimit` por IP (scope `signup:ip`, misma política 20/15min
  vía las constantes compartidas; bucket separado del de login a
  propósito) como PRIMER paso del handler — antes de parsear body y de
  cualquier bcrypt. Cada POST consume (a diferencia de login: acá el abuso
  es la creación masiva, no el guessing).
- **Convención de codes verificada empíricamente:** las rutas hermanas
  responden `{ error: { code, message } }` vía `errorResponse()` de
  `lib/auth-helpers.ts:27-37` con codes SCREAMING_SNAKE (cita: la propia
  ruta signup usa `EMAIL_TAKEN`/`INVALID_PASSWORD`; upload usa
  `UNAUTHORIZED`/`NO_FILES`). Respuesta: **429 +
  `{ error: { code: 'RATE_LIMITED', message } }`** (copy en tuteo).
- Asimetría con login (429 honesto vs null genérico) documentada en el
  comment como DECIDIDA (§5.4): sin oráculo de cuentas que proteger.

## 6. Caps de 10MB (§2.9)

- Constante compartida nueva `lib/upload-limits.ts`
  (`MAX_UPLOAD_FILE_BYTES = 10 * 1024 * 1024`) con el porqué (mitigación
  interim de los 2 highs de xlsx).
- `app/api/data/upload/route.ts`: cap POR ARCHIVO con `file.size` ANTES de
  `arrayBuffer()` (pre-buffer), shape existente `{ filename, error }` del
  multi-file; los demás archivos del request siguen procesándose.
- `app/api/parametros/import/route.ts`: cap con `part.size` pre-buffer →
  **413 + `FILE_TOO_LARGE`** con el shape `errorResponse` del repo
  (verificado en las respuestas hermanas de la misma ruta). La línea de
  voseo ("Verificá…") NO se tocó (T5).

## 7. Docs del §4

- **Runbook nuevo `docs/runbooks/t2-migraciones-runbook.md`** (patrón del
  de T1): regla de oro (strings DIRECTOS de la CONSOLA DE NEON; PROHIBIDO
  leer `DATABASE_URL_UNPOOLED`/`POSTGRES_*`/`PG*` de Vercel), paso 1
  staging (`migrate deploy` ANTES del smoke de preview + nota de que un
  "Reset from parent" posterior la borra), paso 2 production (ANTES del
  merge), paso 3 development (referencia, ya ejecutado), nota de
  channel_binding, sección Futuro apuntando al ítem bloqueado del ledger.
- **CLAUDE.md §Mapa de entornos**: bullet nuevo "Migraciones por entorno"
  con el flujo completo + la prohibición de vars legacy.
- **Ledger**: ítem nuevo "Automatizar `prisma migrate deploy`
  (buildCommand o GitHub Action)" BLOQUEADO por el ítem de vars legacy
  (insertado inmediatamente después de ese ítem para que la adyacencia
  del blocker sea visible).

## 8. Tests (subset Tanda B del §7)

Nuevos/modificados — todos verdes:

- **`tests/lib/rate-limit.test.ts` (nuevo, 6 tests, integration contra dev
  DB):** bajo el límite pasa / sobre el límite bloquea; **ATOMICIDAD** (10
  `consumeRateLimit` concurrentes vía `Promise.all` → RETURNING values
  distintos 1..10 y fila final count=10, cero lost updates); ventana nueva
  resetea + cleanup lazy borra la ventana stale (seed de ventana pasada —
  sin sleeps contra el reloj real, que serían racy con la latencia de
  Neon); peek nunca incrementa y bloquea en el límite; recordFailure
  incrementa el mismo contador; **fail-open** (spy de `$queryRaw` que
  tira → `{allowed:true}` + log estructurado sin el key).
- **`tests/api/auth-authorize.test.ts` (4 → 8 tests):** assert de config
  sin `updateAge`; los 3 tests de dummy compare conservados (ahora con
  Request sintético con `x-forwarded-for` único por run — sin él, el
  bucket compartido `'unknown'` acumularía fallos entre reruns dentro de
  una ventana de 15min); fallo registra en AMBOS scopes (asserts
  window-agnostic para no flakear en fronteras de ventana); **éxito NO
  incrementa** (assert explícito de cero filas); email over-limit y IP
  over-limit → null genérico **sin tocar la tabla de users** (spy de
  `db.user.findUnique` no llamado, compare no llamado).
- **`tests/api/signup.test.ts` (+1):** IP sobre el límite → **429 +
  `RATE_LIMITED`** y el user NO se creó. Todos los requests del archivo
  llevan IP única por run (mismo razonamiento anti-acumulación) + cleanup
  de filas RateLimit.
- **`tests/api/upload.test.ts` (+2):** frontera PINNEADA — >10MB rechaza
  con `{ filename, error }` (`file too large`); ==10MB pasa el cap. Mock
  de File con `Object.defineProperty(file, 'size')` SIN materializar
  bytes, entregado vía `req.formData()` stubbeado (un Request multipart
  real re-serializa el File y recomputa size de los bytes reales,
  perdiendo el override).
- **`tests/api/parametros-import-cap.test.ts` (nuevo, 2 tests):** >10MB →
  **413 + `FILE_TOO_LARGE`**; ==10MB pasa el cap (hallazgo empírico
  menor: xlsx parsea 16 bytes basura LENIENTE como workbook vacío → la
  ruta devuelve 200 no-op en vez del 400 INVALID_XLSX asumido; el assert
  pinnea lo que importa — que NO haya 413 en la frontera).

**Suite completa: 461 tests / 49 archivos, verdes** (pre-check de procesos
huérfanos: cero). `pnpm build` verde. `tsc --noEmit` limpio.

## 9. Verificación supply-chain post-task (punto 8 del prefijo)

```
$ ./scripts/check-supply-chain.sh
✅ Clean — no infection markers detected
$ grep -E '"[\^~]' package.json || echo OK
✅ pins exact
$ grep -E "tanstack|squawk|uipath|mistral|cap-js|intercom-client|router_init|setup\.mjs|router_runtime" pnpm-lock.yaml | grep -v lightningcss || echo OK
✅ lockfile clean
```

## 10. Paradas / decisiones no respondidas

- **Ninguna.** No hubo error de channel binding en `migrate dev`; ninguna
  decisión requirió salirse de brief + ledger.
- Nota menor para los reviewers (no es drift): la lenidad de `XLSX.read`
  con buffers basura pequeños (workbook vacío en vez de throw) obligó a
  formular los asserts de frontera ==10MB como "NO rechazado por el cap"
  en lugar de "falla en parse" — el spec de la frontera (==10MB pasa el
  cap) queda pinneado igual.

## 11. Archivos tocados (del `git status` al cierre)

Modificados: `.superpowers/sdd/hardening-backlog.md`, `CLAUDE.md`,
`app/api/auth/signup/route.ts`, `app/api/data/upload/route.ts`,
`app/api/parametros/import/route.ts`, `auth.ts`, `package.json`,
`pnpm-lock.yaml`, `prisma/schema.prisma`,
`tests/api/auth-authorize.test.ts`, `tests/api/signup.test.ts`,
`tests/api/upload.test.ts`.
Nuevos: `docs/runbooks/t2-migraciones-runbook.md`, `lib/rate-limit.ts`,
`lib/upload-limits.ts`,
`prisma/migrations/20260805005159_add_rate_limit/` (migration.sql),
`tests/api/parametros-import-cap.test.ts`, `tests/lib/rate-limit.test.ts`,
`.superpowers/sdd/t2-tanda-b-report.md` (este report).
