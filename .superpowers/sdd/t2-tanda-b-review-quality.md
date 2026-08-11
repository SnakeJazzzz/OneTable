# Review — Carril CODE QUALITY — T2 Tanda B (working tree dirty sobre ee88699)

> Re-emisión durable (2026-08-04, pedido del controller): el original vivía en el
> scratchpad de /tmp y fue borrado por la limpieza periódica de macOS. Contenido
> reconstruido fielmente del transcript del reviewer, sin re-análisis.

Scope revisado: diff tracked completo (`git diff`) + 6 archivos nuevos untracked íntegros.
Verificación estática ejecutada: `pnpm typecheck` limpio, `pnpm lint` limpio (solo warnings
de Node por type-stripping, preexistentes). No se corrió Vitest ni Prisma contra DB
(restricción operativa; suite reportada verde 461/49).

## Veredicto: PASS CON MINORS

Cero blockers, cero majors. El core (`lib/rate-limit.ts` + wiring en `auth.ts`/signup) es
sólido: el statement CTE-cleanup + `INSERT ... ON CONFLICT ... DO UPDATE ... RETURNING` es
atómico y correcto, y sigue fielmente el precedente raw-SQL del repo
(`core/normalizer/upsert.ts:171-182`). Cinco hallazgos MINOR abajo.

---

## Verificaciones que PASARON (registro, no hallazgos)

- **Atomicidad del upsert** (`lib/rate-limit.ts:91-101`): el DELETE del CTE (ventanas
  `windowStart < actual`) y el INSERT (ventana actual) nunca tocan la misma fila, así que
  no aplica la caveat de Postgres sobre CTEs data-modifying que afectan las mismas filas
  que el statement principal. Dos consumos concurrentes serializan en la fila del PK
  compuesto vía ON CONFLICT — sin lost updates. El test de atomicidad
  (`tests/lib/rate-limit.test.ts:61-77`) es un assert REAL de lost updates: exige RETURNING
  values distintos 1..N Y fila final == N; un lost update rompería ambos.
- **SQL injection**: todo va por tagged templates de `$queryRaw` (parametrizado). Sin
  interpolación de strings.
- **Tipos del RETURNING**: `count` es `INTEGER` (INT4) → Prisma lo devuelve como `number`,
  no `BigInt`. El trap de BigInt solo aplica a INT8/COUNT(*). Verificado también que un
  overflow de INT4 es inalcanzable (ventana de 15 min).
- **Off-by-one coherente**: `consume` permite `count <= limit` post-incremento (el consumo
  N.º `limit` pasa, el `limit+1` no) y `peek` bloquea con `count >= limit` (5 fallos
  registrados → 6.º intento bloqueado). Ambos matchean las políticas pinneadas y los tests
  fijan exactamente esa frontera.
- **Paths de registro de fallo en `auth.ts`**: no hay path donde un fallo de credenciales
  escape sin registrarse (miss de usuario/cliente → registra; password mal → registra) ni
  donde un éxito registre. Creds vacías y peek-bloqueado no registran — correcto (no son
  fallos de verificación). El dummy compare preexistente quedó intacto y el peek no
  introduce bcrypt work antes del gate.
- **Extracción de IP**: primer hop de `x-forwarded-for` con fallback `'unknown'`; maneja
  header vacío/`,1.2.3.4` (el `|| 'unknown'` absorbe el string vacío). En Vercel el header
  lo controla la plataforma; el comment documenta el trade-off del bucket compartido.
- **`windowStart` app-clock vs DB-clock**: irrelevante — solo la app escribe y lee
  `windowStart`, siempre con la misma fórmula; skew entre instancias Vercel (NTP, ms) es
  despreciable frente a ventanas de 15 min.
- **Lockfile**: la remoción sacó EXACTAMENTE `@auth/prisma-adapter@2.7.4` + sus transitivas
  únicas (`@auth/core@0.37.4`, `jose@5.10.0`). Nada más se movió. Consistente con el
  ledger ("3 paquetes").
- **Migración vs schema**: `TIMESTAMP(3)`/`TEXT`/`INTEGER DEFAULT 1`/PK compuesta — match
  1:1 con el modelo Prisma. Aditiva pura. Tipos razonables para el patrón de acceso
  (lookup exacto por PK; sin índices redundantes, correcto porque el ON CONFLICT targetea
  la PK).
- **Higiene de tests**: keys/scopes taggeados por run (`t2-auth-`, `g1-signup-`, `t2-rl-`),
  cleanup en `afterAll` cubre users Y rateLimit; spies restaurados (finally / mockRestore
  por test); el assert de "registra en ambos scopes" es window-agnóstico (suma sobre
  cualquier windowStart) — bien pensado contra cruces de frontera. El stub de
  `req.formData()` en los tests de cap matchea la superficie real que la ruta consume
  (`getAll('files')`/`getAll('file')`/`get('chain')`/`get('fileType')`).
- **Fail-open logging**: sin PII (key excluida deliberadamente), estructurado, testeado.

---

## Hallazgos

### 1. MINOR — El claim "the oversized payload is never buffered" es inexacto: `req.formData()` ya materializó el body completo antes de que `file.size` exista

`app/api/data/upload/route.ts:229-231`, `app/api/parametros/import/route.ts:41-45`,
`lib/upload-limits.ts:4-6`, y los comments de los tests repiten el claim.

`await req.formData()` parsea el multipart COMPLETO en memoria (undici materializa los
bytes del File) antes de que el chequeo de `file.size` pueda correr. El cap evita la
SEGUNDA copia (`arrayBuffer()`) y —lo que realmente importa— evita que `xlsx` parsee un
workbook gigante (la mitigación de los advisories), pero NO evita bufferear.

Escenario concreto: en dev local o self-host, un POST de 200MB → `formData()` materializa
los 200MB en memoria del proceso ANTES de que el cap devuelva el error → presión de
memoria/OOM que el comment dice explícitamente que no puede pasar. (En prod Vercel el
límite de payload de la plataforma —históricamente 4.5MB para funciones— rechazaría el
body antes de llegar a la ruta, lo que además implicaría que el cap de 10MB solo muerde
fuera de prod; vale verificar cuál límite gobierna hoy.) El fix barato si se quiere el
comportamiento prometido: pre-chequear `Content-Length` antes de `formData()`. Como mínimo,
corregir los comments para no documentar una garantía que no existe.

### 2. MINOR — Sin cap de longitud en `key`: un "email" gigante rompe el índice btree → fail-open silencioso del scope email

`lib/rate-limit.ts` acepta cualquier string como `key`; `auth.ts:96` alimenta
`String(creds.email).trim().toLowerCase()` sin límite de longitud, y `key` es componente
de la PK (btree).

Escenario concreto: un atacante POSTea credenciales con un "email" de ~5KB. Postgres
rechaza index rows por encima de ~2704 bytes ("index row size exceeds maximum") →
`incrementWindow` lanza → fail-open. Resultado: (a) el rate limit del scope `login:email`
queda silenciosamente inoperante para esas keys, (b) cada intento genera un log de error
fail-open (ruido que puede enmascarar fail-opens reales de Neon). Impacto acotado — esos
emails no pueden ser cuentas reales y el scope IP (key corta) sigue funcionando — por eso
MINOR y no MAJOR. Mitigación barata: truncar o hashear keys por encima de N bytes (o
rechazar emails absurdamente largos antes del peek, como ya hace signup con password).

### 3. MINOR — Crecimiento sin cota de la tabla `RateLimit` a través de keys únicas: el cleanup lazy solo limpia el MISMO (scope, key)

`lib/rate-limit.ts:92-95`: el DELETE solo remueve ventanas stale de la misma
`(scope, key)`, y solo cuando esa misma key vuelve a incrementar. Una key que nunca vuelve
(IP/email one-shot) deja su fila para siempre — no hay sweep global ni TTL ni cron.

Escenario concreto: un barrido de bots distribuido contra signup desde 100k IPs únicas →
100k filas permanentes que nada borra jamás, en un proyecto Neon Free tier. No bloquea
esta tanda (el volumen actual es cero), pero merece un ítem de ledger: sweep global
periódico (p. ej. piggyback en el workflow diario de backup: un
`DELETE FROM "RateLimit" WHERE "windowStart" < now() - interval '1 day'`).

### 4. MINOR — 429 de signup sin header `Retry-After`

`app/api/auth/signup/route.ts:58-64`: el 429 devuelve solo el body de error. El fin de la
ventana es computable (`windowStart + AUTH_WINDOW_MS`), y `Retry-After` es la convención
estándar que un cliente bien portado (o la página de signup) usaría para informar el
tiempo de espera real en vez del genérico "unos minutos". Cosmético; `errorResponse` no
acepta headers hoy, así que implica un mini-cambio de helper o `Response` directo.

### 5. MINOR — Flake residual de frontera de ventana en los tests que SIEMBRAN la ventana actual

`tests/api/auth-authorize.test.ts` ("email over the limit" ~línea 195, "IP over the limit"
~línea 220) y `tests/api/signup.test.ts` (429, ~línea 184): siembran la fila con
`windowStartFor(AUTH_WINDOW_MS)` evaluado al momento del seed. Si la frontera de 15 min
cae entre el seed y la llamada a `authorize()`/`POST`, el peek/consume calcula una ventana
NUEVA, ve count 0, permite el intento → el test falla (p. ej. `findUniqueSpy` sí fue
llamado). Los autores blindaron el lado del ASSERT (lookup window-agnóstico en el test de
"ambos scopes") pero no el lado del SEED. Probabilidad ≈ duración del test / 900s
(≪0.1%) y se autocura en rerun — nit, no exijo fix; si se quisiera cerrar, sembrar
también la ventana siguiente (`windowStartFor(AUTH_WINDOW_MS, Date.now() + AUTH_WINDOW_MS)`)
cubre ambos lados de la frontera.

---

## Nota de consistencia docs (solo interna, no compliance)

`CLAUDE.md` (mapa de entornos), el runbook `docs/runbooks/t2-migraciones-runbook.md` y el
ledger cuentan la misma historia sin contradicciones (nombre de migración, mecanismo de
`.env.local`, bloqueo por vars legacy, conteo de paquetes removidos vs lockfile real). El
timestamp `20260805...` en migración fechada 2026-08-04 es el UTC de Prisma — coherente.

---

# Re-review post-fix (2026-08-04)

Scope: verificación del fix pass sobre MIS hallazgos (comments corregidos + registro en
ledger) y del cambio de texto en el comment de `session` de `auth.ts`. Read-only; sin
tests ni comandos de DB.

## (a) Comments corregidos vs comportamiento real — VERIFICADO, ahora son EXACTOS

- `lib/upload-limits.ts` (header): dice "checked against `File.size` AFTER
  `req.formData()` (which already materialized the request body in memory) but BEFORE the
  xlsx parse — which is where the real risk lives", con la nota de que en Vercel el body
  ya está acotado por la plataforma y que en dev/self-host un POST enorme SÍ se bufferea
  antes del rechazo. Eso es exactamente el comportamiento que documenté en el hallazgo 1:
  la garantía real es "no segunda copia + no parse de xlsx", no "no buffering". Correcto.
- `app/api/data/upload/route.ts` (cap per-file en `processOneFile`): "checked on
  `file.size` after formData() (the body is already in memory at this point) but BEFORE
  the xlsx parse". Correcto. La lógica quedó intacta: misma condición
  `file.size > MAX_UPLOAD_FILE_BYTES` (boundary `>` pinneado), mismo shape de error
  per-file, mismo orden (post-explicitError, pre-detección).
- `app/api/parametros/import/route.ts`: mismo texto adaptado ("checked on `part.size`
  after formData() ... BEFORE the xlsx parse"). Lógica intacta: `>`, 413, FILE_TOO_LARGE,
  mismo orden pre-`arrayBuffer()`.

Cero cambios de lógica/orden/codes en los tres archivos — solo texto. Ningún comment
promete ya algo que el código no hace.

## (b) Ledger — los 5 ítems capturan fielmente mis hallazgos

`.superpowers/sdd/hardening-backlog.md:754-779`, subsección "T2 Tanda B — minors de la
doble review (no bloquean; registrados 2026-08-04)":

1. Cap request-level opcional (ambas rutas): captura el mecanismo (`formData()`
   materializa antes del chequeo), la distinción Vercel vs dev/self-host, y el candidato
   (`Content-Length` pre-check). Fiel a mi MINOR 1; la parte de comments consta como
   corregida en el fix pass. ✓
2. Sin cap de longitud en `key` (`lib/rate-limit.ts`; `auth.ts` scope `login:email`):
   conserva el escenario concreto (email ~5KB > ~2.7KB de btree index row → upsert lanza
   → fail-open silencioso del scope email + ruido de logs, scope IP intacto) y el
   candidato (truncar/hashear). Fiel a mi MINOR 2. ✓
3. Sin TTL/sweep global (`lib/rate-limit.ts`): captura que el cleanup lazy solo borra el
   MISMO (scope,key), el escenario de keys one-shot / barrido distribuido, el impacto en
   Neon Free tier y el candidato (sweep periódico). Fiel a mi MINOR 3. ✓
4. 429 sin `Retry-After` (`app/api/auth/signup/route.ts`): fiel a mi MINOR 4, marcado
   cosmético. ✓
5. Flake residual de frontera de ventana (`tests/api/auth-authorize.test.ts` casos
   limited, `tests/api/signup.test.ts` caso 429): captura el mecanismo (frontera entre
   seed y llamada), la probabilidad (~≪0.1%) y la asimetría assert-blindado/seed-no. Fiel
   a mi MINOR 5. ✓

Los ítems citan archivo (sin línea exacta en algunos, pero con símbolo/sección suficiente
para relocalizar — aceptable para un ledger que sobrevive a renumeraciones de línea).

## (c) Cambio en el comment de `session` de `auth.ts` — sin defecto de calidad

Se removió la oración parentética sobre el drop de `updateAge` en Tanda B. El comment
restante ("maxAge: 24h ROLLING idle window ... re-signed on every session read ...
Semantics verified against the installed source of @auth/core@0.41.3") sigue siendo
VERDADERO contra la config actual `session: { strategy: 'jwt', maxAge: 86400 }` — es
exactamente la semántica rolling que verifiqué en la review original. Solo texto; sin
defecto introducido.

## Veredicto final del carril: PASS

Los 5 MINORS quedaron resueltos conforme al protocolo (1 parcialmente en código —
comments — y su parte sustantiva + los otros 4 en el ledger, fieles). Ningún hallazgo
nuevo en el fix pass. Nada bloquea el commit por el carril code quality.
