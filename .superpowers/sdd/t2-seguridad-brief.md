# Brief v2 — T2 SEGURIDAD (CORTE punto 2 / plan faro §3 T2)

> Estado: v2 PARA FILTRO EXTERNO (2026-08-03). La v1 (2026-07-30) recibió
> NO-GO del filtro por 2 huecos bloqueantes (migración por entorno §4,
> contrato del rate limiter §5); esta v2 los cierra e incorpora las
> decisiones ya tomadas por Michael (las 4 OQs de la v1 quedan RESUELTAS,
> ver §8). Cero implementación hasta el go.
>
> Protocolo: el prompt de CADA implementer lleva como prefijo literal la
> sección "⚠ Seguridad supply chain — NO NEGOCIABLE" de `CLAUDE.md`. El
> implementer PARA en GREEN con árbol sucio (no git). Doble review ciega
> por tanda. Gate ESTRICTO (auth + data layer): diff crudo completo a
> Michael ANTES de cada commit. Branch: `feat/hardening-t2` (docs de cierre
> de T1 en `ed17414`).

---

## 1. Verificación empírica del estado real (2026-07-30, main @ 936b8d1)

Verificado contra repo/registry; cada punto cita evidencia. (Si el dispatch
se aleja en el tiempo, re-correr los greps baratos de este bloque.)

1. **`next` 14.2.18 pinned exact** (`package.json:34`); lockfile con una
   sola entrada `next@14.2.18` (`pnpm-lock.yaml:2203,5063`). **`next@14.2.35`
   EXISTE en el registry** (`npm view` verificado) y es la última 14.2.x.
   **`eslint-config-next` está en 14.2.18** (`package.json:54`) y **14.2.35
   existe** (`npm view` verificado) — bump en lockstep.
2. **`next.config.mjs` es `{}` vacío** (3 líneas) — `headers()` se agrega
   desde cero. **`vercel.json` NO tiene bloque `headers`** (solo
   schema/framework/installCommand con `--ignore-scripts`/buildCommand — no
   tocar).
3. **`auth.ts`:** `session: { strategy: 'jwt' }` única key (línea 35) — sin
   `maxAge`/`updateAge` (default NextAuth = 30 días). `authorize()` retorna
   `null` en la línea 56 para email inexistente o sin clients SIN correr
   bcrypt (el `compare` está en la 58) — timing side-channel confirmado.
   `trustHost: true` (línea 37). Firma actual: `authorize(creds)` — NO
   recibe el request hoy; la verificación empírica de la firma
   `authorize(credentials, request)` se hace en TANDA B sobre la versión ya
   bumpeada de next-auth (beta.32), no sobre la actual.
4. **Signup (`app/api/auth/signup/route.ts`):** `MIN_PASSWORD = 6`
   (línea 22), sin cap de 72 bytes, `BCRYPT_ROUNDS = 10`. Try/catch con
   cobertura completa. 409 `EMAIL_TAKEN` queda (Fase 2.5, fuera de scope).
   **Client-side:** `app/(auth)/signup/page.tsx:132` tiene `minLength={6}`
   — sube a 10 en el mismo diff (copy nuevo en tuteo).
5. **`app/api/data/upload/route.ts`:** SIN cap de tamaño — `buffer.length`
   solo se registra (línea 259); el buffer se materializa en la 247
   (`file.arrayBuffer()`). Multi-file: el cap es POR ARCHIVO, con
   `file.size` ANTES de `arrayBuffer()` (pre-buffer).
   **`app/api/parametros/import/route.ts`:** ídem, buffer en línea 40, sin
   cap. La línea 51 tiene voseo ("Verificá") — NO tocar, es T5.
6. **`middleware.ts`:** check de EXISTENCIA (`!req.auth`) sobre 5 prefijos;
   matcher excluye `api/auth|api/health|_next/...`. Q-3 del ledger (prefijo
   abierto de `api/health`) solo se activa SI se toca el matcher (§3 Tanda
   A, csp-report).
7. **Blast radius real del CVE de middleware (grep pre-bump; se re-corre
   post-bump):** CERO `page.tsx` importa `@/lib/db` (grep vacío); la data
   viaja por API routes con `requireAuth()` (~20 rutas). Además
   `app/(dashboard)/layout.tsx:23-25` re-chequea `auth()` server-side y
   redirige (defensa en profundidad YA presente). Un bypass de middleware
   expone shells sin data.
8. **`pnpm audit` (2026-07-30): 65 vulns — 7 critical / 28 high / 26
   moderate / 4 low.** Relevante:
   - `next`: 1 critical (Authorization Bypass in Middleware, patched
     ≥14.2.25) + 10 high. 14.2.35 cierra el critical + los 2 DoS de Server
     Components (patched ≥14.2.34/≥14.2.35). Los highs restantes piden
     ≥15.0.8..≥15.5.21 (cruzan major) — se REGISTRAN, no se fixean.
   - `next-auth@5.0.0-beta.25`: **2 CRITICAL + 1 high, patched
     ≥5.0.0-beta.32** (espejo `@auth/core` 0.37.2/0.37.4, patched 0.41.3).
     Criticals: "existence-based auth checks fail open" (exactamente
     nuestro patrón middleware/requireAuth) y homoglyph email-normalizer
     bypass. **Decisión de Michael: el bump a beta.32 ENTRA en T2, Tanda A**
     (era OQ-1). Registrar los advisory IDs del audit en el ledger.
   - `vitest`: 2 critical DEV-ONLY (Vitest UI server; no corre en CI/prod).
     Registrar, no accionar.
   - `xlsx`: 2 high sin patch en npm — riesgo aceptado interim; la
     mitigación ES el cap de 10MB de este task.
9. **Prisma schema:** NO existe modelo de rate limit (9 modelos, `grep
   "^model"`); 3 migraciones en `prisma/migrations/`. Schema nuevo pinneado
   en §5; aplicación por entorno en §4.
10. **Chat (`app/api/ai/chat/route.ts`):** sin rate limit (diferido
    explícito, línea 37). T2 construye los helpers REUSABLES; el wiring del
    chat es T3 — la ruta del chat NO se toca en T2.

## 2. Parámetros DECIDIDOS (corte punto 2 + resoluciones de Michael; no re-abrir)

1. Bump `next` 14.2.18 → 14.2.35, `eslint-config-next` en lockstep,
   `next-auth` beta.25 → beta.32. Protocolo supply-chain completo en cada
   install. Post-bump: re-grep RSC (§1.7) + re-run `pnpm audit` registrando
   restantes en el ledger. CLAUDE.md §Stack se actualiza con las 3 versiones
   en el mismo diff.
2. Security headers ENFORCED en todos los entornos: `X-Content-Type-Options:
   nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy:
   strict-origin-when-cross-origin`, `Permissions-Policy: camera=(),
   microphone=(), geolocation=()`.
3. CSP por entorno vía `VERCEL_ENV` (build-time; preview y production son
   builds separados): preview → `Content-Security-Policy` ENFORCED;
   production → `Content-Security-Policy-Report-Only`; dev local → enforced
   con relajaciones de dev (§6). Flip de prod = T6.
4. Endpoint `POST /api/csp-report` (Opción A decidida): sin DB, log
   estructurado a Vercel logs, cap de tamaño de body, público.
5. `session: { strategy: 'jwt', maxAge: 86400, updateAge: 3600 }`.
6. Dummy `bcrypt.compare` para email inexistente / user sin clients:
   constante precomputada (rounds 10) con comentario del porqué (timing);
   `await compare()` SIEMPRE antes de retornar null.
7. Rate limiter Postgres REUSABLE — contrato y schema PINNEADOS en §5.
   Política de login: **5 fallos/15min por email, 20 fallos/15min por IP.**
   Signup: rate limit por IP con la MISMA política de IP que login.
   Trade-off aceptado (escrito, que ningún carril lo levante): el usuario
   rate-limited recibe el MISMO error genérico de credenciales
   (anti-oráculo > UX).
8. Password policy en signup: mín 10 chars + cap 72 bytes
   (`Buffer.byteLength(password, 'utf8') > 72` → 400, RECHAZAR, nunca
   truncar). Users existentes no se tocan.
9. Caps de 10MB pre-buffer: `data/upload` per-file (`file.size` antes de
   `arrayBuffer()`, shape existente `{ filename, error }`);
   `parametros/import` request-level → **status 413 + code
   `FILE_TOO_LARGE`** (spec pinneada) con el **shape de error EXISTENTE
   de las rutas hermanas, verificado empíricamente por el implementer
   ANTES de escribir el handler** (el status y el code son spec; el
   nesting del shape lo dicta el repo, no este brief).

## 3. Estructura del task: DOS TANDAS (decisión de Michael)

Cada tanda = implementer FRESCO + doble review ciega + fix pass + diff
crudo a Michael + commit autorizado. UN solo PR y UN solo smoke de preview
al final (post tanda B).

### Tanda A — deps + config (SIN schema)

Orden sugerido del implementer:
1. **Bumps:** `next` 14.2.35 + `eslint-config-next` 14.2.35 + `next-auth`
   5.0.0-beta.32 (pins exact). Supply-chain completo antes/después.
   Verificación empírica de breaking changes beta→beta: smoke dev de
   login/signOut/middleware ANTES de declarar GREEN (regla
   empirical-first: types ≠ runtime). Greps post-bump §1.7 + re-run
   `pnpm audit`; advisory IDs y highs restantes al ledger. CLAUDE.md
   §Stack actualizado en el mismo diff.
2. **Headers + CSP:** set siempre-enforced (§2.2) + builder CSP puro en
   `lib/security-headers.ts` (unit-testeable; `next.config.mjs` solo lo
   consume) + endpoint `POST /api/csp-report`. Verificar EMPÍRICAMENTE que
   un POST anónimo a `/api/csp-report` pasa el middleware con el matcher
   actual; SOLO si hay que tocar el matcher, se activa Q-3 del ledger y se
   cierra el prefijo de `api/health` en la MISMA edición.
3. **Auth/session:** `maxAge`/`updateAge` + dummy `bcrypt.compare`.
4. **Password policy:** signup route + `minLength` + copy (tuteo) del form.

### Tanda B — data layer (schema + wiring + caps)

Orden sugerido:
1. **Modelo + migración + helpers** del §5 (la migración se aplica por
   entorno según §4; en development la corre el implementer).
2. **Wiring a login** (§5.3) y **a signup por IP** (misma política de IP).
   ACÁ se verifica empíricamente la firma `authorize(credentials, request)`
   sobre next-auth beta.32 ya instalado, ANTES de cablear IP.
3. **Caps de 10MB** en `data/upload` y `parametros/import` (§2.9).

## 4. Aplicación de la migración por entorno (bloqueante del gate)

> Sin la tabla en staging, el login de la PREVIEW tira 500 y el smoke del
> gate muere. Este flujo es parte del task, no un afterthought.

- **development:** el implementer de Tanda B corre `prisma migrate dev`
  durante su run. ANTES: verificación empírica de cómo recibe
  `DATABASE_URL` el CLI de Prisma en ESTE repo (adyacente a Q-2 del
  ledger: el CLI lee `./.env`, `prisma/.env` o shell env — NO `.env.local`;
  hoy no existe ni `.env` ni `prisma/.env`). Documentar el mecanismo real
  encontrado en el report del implementer.
  **`prisma migrate dev` TAMBIÉN requiere conexión DIRECTA** — mismo
  constraint que staging/prod: Prisma migrate es incompatible con
  PgBouncer transaction pooling, y los endpoints `-pooler` de Neon son
  pooled (misma familia que la lección del pg_dump de T1). Por eso:
  (a) **paso PRE-dispatch de Tanda B:** verificar si el host del
  `DATABASE_URL` de `.env.local` tiene sufijo `-pooler`; si es pooled,
  MICHAEL edita `.env.local` con el string DIRECTO de development (el
  hook `block-env-writes` impide que CC lo haga) o provee el string al
  momento del dispatch; (b) **regla para el implementer:** si descubre el
  problema a mitad de run, PARAR y pedir a Michael — no improvisar
  conexiones ni tocar env.
- **staging:** MICHAEL corre `prisma migrate deploy` desde su terminal con
  el connection string UNPOOLED de la branch `staging`, ANTES de su smoke
  de preview.
- **production:** MICHAEL, ídem con la unpooled de `production`, ANTES del
  merge. La migración es puramente ADITIVA (tabla nueva que el código
  desplegado no referencia): aplicarla pre-merge es seguro y elimina la
  ventana deploy-sin-tabla.
- **WARNING:** PROHIBIDO que cualquier tooling lea las vars legacy
  `DATABASE_URL_UNPOOLED` / `POSTGRES_*` / `PG*` de Vercel — apuntan a
  PRODUCTION en los 3 scopes (ítem abierto del ledger). Los strings
  unpooled los saca Michael de la consola de Neon, no de Vercel.
- **Deliverables del task:** sección nueva de runbook en `docs/runbooks/`
  (patrón del runbook de T1) con estos pasos para Michael; regla en
  CLAUDE.md §Mapa de entornos. Al ledger: ítem futuro "automatizar
  `migrate deploy` (buildCommand o GitHub Action)", BLOQUEADO por el ítem
  de vars legacy.

## 5. Rate limiter — contrato y schema PINNEADOS

### 5.1 Modelo Prisma

```prisma
model RateLimit {
  scope       String
  key         String
  windowStart DateTime
  count       Int      @default(1)

  @@id([scope, key, windowStart])
}
```

`windowStart = floor(Date.now() / windowMs) * windowMs`, computado en la
app — ventanas FIJAS alineadas a frontera (esta semántica define también el
"40/día" de T3: día = ventana de 24h alineada, no rolling). Modelo CERRADO:
el `@@id` compuesto quedó APROBADO por el filtro (una sola constraint, sin
índice redundante; el `ON CONFLICT` apunta a la PK).

### 5.2 API en `lib/` (nombres finales)

- `consumeRateLimit({ scope, key, limit, windowMs })` → upsert crudo
  atómico (sketch abajo), compara `count` contra `limit`, retorna
  `{ allowed, count }`. ESTE es el que T3 reusa para el chat (límite por
  parámetro, no hardcodeado).
- `peekRateLimit({ scope, key, limit, windowMs })` → SELECT read-only de la
  ventana vigente; NO incrementa.
- `recordFailure({ scope, key, windowMs })` → el mismo upsert de consume;
  login lo llama SOLO en fallo de credenciales.

Sketch SQL del upsert (mismo patrón raw que `batchUpsertUnmapped`):

```sql
INSERT INTO "RateLimit" ("scope", "key", "windowStart", "count")
VALUES ($1, $2, $3, 1)
ON CONFLICT ("scope", "key", "windowStart")
DO UPDATE SET "count" = "RateLimit"."count" + 1
RETURNING "count";
```

- **Cleanup lazy:** `DELETE FROM "RateLimit" WHERE "scope" = $1 AND "key"
  = $2 AND "windowStart" < $3` montado en el mismo increment (ventanas
  stale del mismo scope+key).
- **Fail-open:** si la query del limiter tira, log estructurado + tratar
  como NO-limitado. Nunca un 500 crudo por culpa del limiter.

### 5.3 Wiring de login (en `authorize()`)

1. `peekRateLimit` por email Y por IP ANTES del lookup de user y de
   cualquier bcrypt → si cualquiera excede, retornar `null` (mismo error
   genérico, §2.7).
2. En FALLO de credenciales (email inexistente tras el dummy compare, o
   password errado): `recordFailure` en AMBOS scopes.
3. El ÉXITO no incrementa ni resetea nada (fixed-window simple).
4. **Overshoot por carrera** peek→fail concurrente (dos requests pasan el
   peek y ambos registran el fallo): ACEPTADO e inocuo — a lo sumo el
   contador pasa el límite por un puñado; documentar en comentario.

### 5.4 Wiring de signup — respuesta rate-limited PINNEADA

Signup rate-limited responde **429 + code de rate limit consistente con la
convención de codes del repo** (verificado empíricamente por el
implementer, mismo criterio que el shape de E2/§2.9). Porqué de la
ASIMETRÍA con login (dejar escrito, que ningún carril lo levante): en
signup el límite es por IP y no hay oráculo de cuentas que proteger, así
que NO aplica el error genérico de credenciales — un 429 honesto es mejor
UX sin costo de seguridad.

## 6. Notas CSP para el implementer

- **Paso previo obligatorio:** inventario EMPÍRICO de orígenes externos
  (grep de fonts/imágenes/fetch a hosts externos en app/, components/,
  lib/) ANTES de fijar directivas — no asumir `'self'`-only sin evidencia.
- Directivas base esperadas (ajustar con el inventario): `default-src
  'self'`; `script-src 'self' 'unsafe-inline'` (RSC payload inline; nonces
  requieren middleware por-request — fuera de scope, registrar como deuda
  si duele); `style-src 'self' 'unsafe-inline'`; `img-src 'self' data:
  blob:`; `connect-src 'self'`; `frame-ancestors 'none'`; `object-src
  'none'`; `base-uri 'self'`; `report-uri /api/csp-report` (y/o
  `report-to`).
- **Dev enforced:** agregar `'unsafe-eval'` a script-src solo-dev y
  VERIFICAR el HMR de `next dev` (websocket) — si hace falta, `ws:` en
  connect-src SOLO-dev.
- **`frame-ancestors` se IGNORA en Report-Only:** el anti-iframe efectivo
  de prod es `X-Frame-Options: DENY` del set siempre-enforced. NO hay gap
  — que ningún carril de review lo levante como hallazgo.

## 7. Test plan (Vitest contra development — guard T1 activo)

- `lib/security-headers`: por `VERCEL_ENV` produce header
  enforced/report-only y directivas esperadas (unit del builder puro).
- Rate limiter: los TRES helpers (`consumeRateLimit`, `peekRateLimit`,
  `recordFailure`) con integration contra dev DB — bajo el límite pasa,
  sobre el límite bloquea, ventana nueva resetea, y ATOMICIDAD del upsert
  (dos increments concurrentes no pierden cuenta — patrón del test de
  concurrencia existente).
- Login: **el éxito NO incrementa el contador** (assert explícito); email
  inexistente LLAMA `compare` (spy) y retorna null; user sin clients ídem;
  rate-limited retorna null SIN tocar la tabla de users.
- Signup: password 9 chars → 400; 10 chars OK; >72 bytes (multibyte, p.ej.
  25 emojis) → 400; rate limit por IP sobre el límite → **429 con el code
  de rate limit** (shape según la convención del repo, §5.4).
- Caps con frontera PINNEADA: **>10MB rechaza, ==10MB pasa** (mock de File
  con `size` seteado, sin materializar bytes reales); status 413 + code
  `FILE_TOO_LARGE` en `parametros/import` (shape del repo, §2.9).
- `/api/csp-report`: POST anónimo con report válido → 2xx + log; body
  gigante → rechazado por el cap.
- Session config: assert de `maxAge`/`updateAge`.
- Suite completa verde al cierre de cada tanda (hoy: 424 tests / 44
  archivos).

## 8. Ex-OQs — RESUELTAS por Michael (registro, no re-abrir)

- **OQ-1 (bump next-auth):** INCLUIDO en Tanda A → beta.32. Advisory IDs al
  ledger; verificación empírica de breaking changes con smoke dev antes del
  GREEN; CLAUDE.md §Stack actualizado en el mismo diff.
- **OQ-2 (números de login):** 5 fallos/15min por email, 20/15min por IP.
  Trade-off anti-oráculo aceptado y documentado (§2.7).
- **OQ-3 (violations de prod):** Opción A — endpoint `POST /api/csp-report`
  con log estructurado a Vercel logs, sin DB, cap de body.
- **OQ-4 (signup):** INCLUIDO en Tanda B — rate limit por IP, misma
  política de IP que login.

## 9. No tocar en T2

`app/api/ai/chat/route.ts` (T3); matcher del middleware SALVO que
csp-report lo exija (y entonces Q-3 va en la misma edición); copy voseo
pre-existente (T5); enumeración `EMAIL_TAKEN` (Fase 2.5); `vercel.json`.

## 10. Gate

ESTRICTO por tanda: diff crudo completo + ambos carriles de review a
Michael antes de CADA commit. El schema del §5 queda autorizado al aprobar
este brief (el implementer de Tanda B lo aplica en development a mitad de
run). Migraciones de staging (pre-smoke) y production (pre-merge) las corre
Michael según §4. UN PR; smoke de Michael sobre la preview (CSP enforced:
login, signup, upload, dashboard con charts, Parámetros import, chat)
obligatorio pre-merge. Cierre = smoke verde + criterio de csp-report en
DOS partes (el estado deseado en prod es CERO violations, así que
"logueando en prod" nunca se cumpliría en el caso bueno): (a) mecanismo
verificado con un POST de prueba MANUAL de Michael al endpoint de prod
(log visible en Vercel logs = pipeline vivo); (b) violations reales
revisadas, con expectativa de CERO — ambas cosas son la evidencia para el
flip de T6.
