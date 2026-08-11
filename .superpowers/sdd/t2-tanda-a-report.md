# Report — T2 SEGURIDAD, Tanda A (deps + config, SIN schema)

> Implementer fresco, 2026-08-03. Branch `feat/hardening-t2`, árbol DIRTY
> en GREEN — CERO git (ni add, ni commit, ni `git add -f` del ledger).
> Fuente de verdad: `.superpowers/sdd/t2-seguridad-brief.md` (v2, GO).

## Resumen ejecutivo

- 3 bumps aplicados con protocolo supply-chain completo; smoke dev
  empírico de login/signOut/middleware sobre beta.32 VERDE.
- Headers siempre-enforced + CSP por entorno (builder puro en
  `lib/security-headers.ts`) + endpoint `POST /api/csp-report` público
  verificado con POST real. Matcher del middleware NO tocado (Q-3 sigue
  en el ledger).
- `session { maxAge: 86400, updateAge: 3600 }` + dummy `bcrypt.compare`
  (constante precomputada rounds 10) en los dos paths de miss.
- Password policy signup: mín 10 chars + cap 72 bytes (rechazo, nunca
  truncar), form a `minLength={10}`, copy nuevo en tuteo.
- Suite completa: **446 tests / 47 archivos, todo verde** (baseline
  424/44; la tanda suma 22 tests en 3 archivos nuevos + 4 en
  `signup.test.ts`).
- Un item OBLIGATORIO quedó PARCIAL por bloqueo de entorno (verificación
  in-browser del HMR bajo CSP): ver §Desvíos.

## 1. Bumps de dependencias

### Qué se hizo

- `next` 14.2.18 → **14.2.35**, `next-auth` 5.0.0-beta.25 →
  **5.0.0-beta.32** (`pnpm add --ignore-scripts --save-exact`),
  `eslint-config-next` 14.2.18 → **14.2.35** (ídem, `-D`). Pins exact
  verificados. Lockfile con las entradas nuevas
  (`pnpm-lock.yaml:2199,2183,1550`).
- `./scripts/check-supply-chain.sh` ANTES y DESPUÉS de cada install:
  limpio. Grep de lockfile: limpio. (Outputs en §8.)
- `CLAUDE.md` §Stack inmutable actualizado con las 3 versiones en este
  mismo diff (líneas de Next.js y NextAuth).

### Verificación empírica beta.25→beta.32 y next (types ≠ runtime)

`next dev` en `PORT=3005` (proceso matado al cierre; cero shells vivas):

- **Login** (flujo HTTP real de NextAuth): `GET /api/auth/csrf` →
  `POST /api/auth/callback/credentials` con el user seedeado
  (`demo@onetable.mx` / `demo1234` de `scripts/seed.ts`) → **302 +
  `authjs.session-token` seteada**.
- **Sesión**: `GET /api/auth/session` → user con `id` + `clientId`
  (callbacks jwt/session intactos). `expires` = login + 24h EXACTAS
  (login 02:04:00Z → expira 02:03:58Z del día siguiente) — `maxAge:
  86400` confirmado en runtime, no solo en config.
- **Middleware**: `GET /dashboard` SIN cookie → **307 a `/login`**; CON
  cookie → **200**.
- **signOut**: `POST /api/auth/signout` con csrf → 302 + cookie borrada
  (`Max-Age=0`); `session` → `null`; `/dashboard` → 307 a `/login`.
- Nota no-regresión: los `Location` de dev apuntan a `localhost:3000`
  aunque el server corría en 3005 — es la `AUTH_URL=http://localhost:3000`
  PRE-EXISTENTE de `.env.local` (verificado por grep, sin tocar el
  archivo), consistente con el `pnpm dev` normal de Michael en 3000. No
  es efecto del bump.

### Greps post-bump (§1.7 del brief)

- CERO `page.tsx` importa `@/lib/db` (grep vacío, re-verificado
  post-bump) — blast radius del CVE de middleware sigue siendo shells
  sin data.

### Audit post-bump

`pnpm audit` 2026-08-03 post-bump: **53 vulns (3 critical / 27 high /
21 moderate / 2 low)** — el pre-bump del mismo día daba 70
(7c/31h/28m/4l). El detalle completo (IDs cerrados por el bump + triage
de restantes en los DOS grupos pedidos por Michael, con fundamento de
una línea cada uno) quedó registrado en el ledger
(`.superpowers/sdd/hardening-backlog.md` §"T2 Tanda A — audit post-bump
y erratum del brief"). Los cerrados/restantes se computaron
EMPÍRICAMENTE consultando el endpoint bulk de advisories de npm con
versión vieja vs. nueva (no de memoria). Puntos salientes:

- Cerrados: `next` 9 advisories (incl. GHSA-f82v-jwr5-mffw, el critical
  de middleware) y `next-auth` los 5 (incl. los 2 criticals
  GHSA-8fpg-xm3f-6cx3 fail-open y GHSA-7rqj-j65f-68wh homoglyph).
- Grupo (a) dev-only: vitest (2 criticals del UI server),
  brace-expansion/glob/js-yaml/vite/esbuild (lint/test tooling), postcss
  (build-time). Registrados, sin acción.
- Grupo (b) path a producción: `next` restantes piden ≥15.x (cruzan
  major — registrados para el upgrade de major); `xlsx` 2 high sin patch
  (riesgo aceptado interim; mitigación = cap 10MB de Tanda B).
- **Hallazgo adicional** (registrado en el ledger, grupo b): el critical
  GHSA-7rqj-j65f-68wh de `@auth/core` SIGUE apareciendo post-bump vía
  `@auth/core@0.37.4`, que entra SOLO por `@auth/prisma-adapter@2.7.4` —
  dependencia declarada pero NUNCA importada (JWT sin adapter; único
  match es un comentario en `auth.ts`). Cero superficie runtime; cierre
  definitivo = remover el adapter (cleanup ya registrado de Fase 2). El
  `@auth/core` que next-auth usa de verdad es 0.41.3 (patched).

### Erratum del brief (§1.9) — pedido por Michael

El brief dice "9 modelos"; son **10** (`grep -c "^model"
prisma/schema.prisma` → 10). Conteo errado al escribir el brief; schema
sin cambios desde B1. La afirmación operativa es correcta: NO existe
modelo `RateLimit` (grep vacío) y hay 3 migraciones. Registrado también
en el ledger.

## 2. Headers + CSP + csp-report

### Inventario EMPÍRICO de orígenes externos (paso previo obligatorio)

Greps sobre `app/`, `components/`, `lib/` (y `core/` de yapa):

- URLs `http(s)://` en código: UNA sola, un link de docs de Postgres en
  un comentario de `core/normalizer/upsert.ts:46`. Cero en runtime.
- Fonts: cero `next/font`, cero `@font-face`, cero `@import`.
- Imágenes: cero `next/image`, cero `src="http..."`.
- Fetch: todos los `fetch()` de cliente van a paths relativos `/api/...`
  (ej. `lib/hooks/use-dashboard-data.ts:104`). El chat de IA llama al AI
  Gateway SERVER-side (no sujeto a CSP del browser).

Conclusión: baseline `'self'`-only con evidencia, no por asunción.

### Implementación

- **`lib/security-headers.ts`** (NUEVO): builder PURO, cero imports de
  Next — `resolveCspEnv`, `buildAlwaysEnforcedHeaders` (§2.2: nosniff /
  DENY / strict-origin-when-cross-origin / Permissions-Policy),
  `buildCspDirectives`, `buildCspHeader`, `buildSecurityHeaders`.
  - Mapeo por `VERCEL_ENV` (build-time): production →
    `Content-Security-Policy-Report-Only`; preview → enforced; todo lo
    demás (dev local, CI) → enforced con relajaciones de dev.
  - Directivas base del brief §6 tal cual: `default-src 'self'`;
    `script-src 'self' 'unsafe-inline'` (RSC inline; nonces fuera de
    scope, documentado en comment); `style-src 'self' 'unsafe-inline'`;
    `img-src 'self' data: blob:`; `connect-src 'self'`; `frame-ancestors
    'none'`; `object-src 'none'`; `base-uri 'self'`; `report-uri
    /api/csp-report`.
  - Dev-only: `'unsafe-eval'` en script-src + `ws:` en connect-src.
  - `frame-ancestors` ignorado en Report-Only: documentado en el header
    del archivo con la nota de que el anti-iframe efectivo es
    `X-Frame-Options: DENY` (que ningún carril lo levante).
- **`next.config.mjs`**: solo consume el builder vía `headers()` con
  `source: '/(.*)'`.
  - **Decisión de implementación a validar por review**: el config
    importa `'./lib/security-headers.ts'` con extensión explícita — Node
    lo resuelve por type stripping nativo (default-on desde Node
    22.18/23.6). Verificado empíricamente: `pnpm build` VERDE en local
    (Node v23.11.0) y CI corre Node 24 (`ci.yml:90`). El brief pinneaba
    "builder en lib/security-headers.ts consumido por next.config.mjs" y
    esta es la única forma de cumplirlo sin duplicar la política; el
    riesgo residual es la versión de Node del builder de Vercel (si fuera
    <22.18 el build de preview fallaría RUIDOSAMENTE, no en silencio —
    se ve en el primer deploy del PR). Side-effect cosmético: Node emite
    un warning `MODULE_TYPELESS_PACKAGE_JSON` al cargar el config
    (agregar `"type": "module"` a package.json lo callaría, pero cambia
    el parsing de TODO el repo — no lo toqué).
- **`app/api/csp-report/route.ts`** (NUEVO): POST público, sin DB, log
  estructurado JSON a stdout (source/receivedAt/userAgent/report), cap
  de 32KB en dos capas (Content-Length pre-read + tamaño real
  post-read), 204 en éxito, 413 sobre el cap. Body no-JSON se loguea
  truncado como `{unparseable}` (observar, no validar).

### Verificación empírica (dev server real, puerto 3005)

- Headers en `/login`: los 4 siempre-enforced presentes + CSP enforced
  con relajaciones dev (output curl completo en la sesión).
- **POST anónimo a `/api/csp-report` con el matcher ACTUAL: 204** — pasa
  el middleware sin auth (el matcher lo matchea pero el middleware solo
  exige auth en los 5 prefijos protegidos). **El matcher NO se tocó** →
  Q-3 del ledger NO se activa, sigue abierto como estaba.
- Log estructurado visible en stdout del server (línea JSON con el
  report de prueba).
- Body de 40KB → 413.
- HMR: handshake websocket real contra `/_next/webpack-hmr` → **101
  Switching Protocols** (server-side OK). La parte IN-BROWSER quedó
  parcial — ver §Desvíos.

## 3. Auth/session (`auth.ts`)

- `session: { strategy: 'jwt', maxAge: 86400, updateAge: 3600 }`
  (runtime-confirmado por el `expires` del smoke, §1).
- `DUMMY_BCRYPT_HASH`: constante precomputada con bcryptjs rounds 10
  (mismo costo que los hashes reales). `await compare(password,
  DUMMY_BCRYPT_HASH)` SIEMPRE antes de retornar `null` en los dos paths
  de miss (email inexistente / user sin clients), con comentario del
  porqué (timing side-channel / enumeración de emails). Sin rate
  limiting (Tanda B).

## 4. Password policy signup

- `app/api/auth/signup/route.ts`: `MIN_PASSWORD = 10`;
  `MAX_PASSWORD_BYTES = 72` con `Buffer.byteLength(password, 'utf8') >
  72` → 400 RECHAZO (comentario: bcrypt trunca en 72 BYTES; truncar
  haría que dos passwords distintas verifiquen igual). Users existentes
  intactos. Orden: mínimo primero, cap después.
- **Micro-decisión tomada (flag para review)**: el cap usa code NUEVO
  `PASSWORD_TOO_LONG` (400) en vez de reusar `INVALID_PASSWORD`. Razón:
  el form mapea code→copy con `ERROR_COPY[code]`; un solo code no puede
  mostrar dos mensajes distintos. El brief no pinneaba el code; es copy/
  shape nuevo, no toca la enumeración existente.
- `app/(auth)/signup/page.tsx`: `minLength={10}` (línea del input),
  hint "Mínimo 10 caracteres.", `ERROR_COPY` actualizado en TUTEO: "Tu
  contraseña debe tener al menos 10 caracteres" / "Tu contraseña es
  demasiado larga (máximo 72 caracteres)". El voseo pre-existente de la
  página ("Empezá…", "¿Ya tenés cuenta?") NO se tocó (T5). Nota menor:
  el copy de cliente dice "72 caracteres" (el server dice "72 bytes",
  que es lo preciso); para el usuario final "bytes" es ruido — el caso
  multibyte real igual recibe el mensaje del copy.
- Verificación runtime vía server vivo: 9 chars → 400
  `INVALID_PASSWORD` con el copy nuevo; 25 emojis (100 bytes) → 400
  `PASSWORD_TOO_LONG`.

## 5. Tests (subset Tanda A del §7)

Nuevos:
- `tests/lib/security-headers.test.ts` (10): mapeo `VERCEL_ENV`,
  enforced vs Report-Only por entorno, directivas base, relajaciones
  SOLO-dev, set siempre-enforced completo (5 headers exactos).
- `tests/api/csp-report.test.ts` (4): POST anónimo válido → 204 + log
  estructurado (spy de console.warn); body no-JSON → 204 con
  `unparseable`; body 33KB → 413 sin log; Content-Length gigante → 413
  pre-read.
- `tests/api/auth-authorize.test.ts` (4): session config exacta
  (`maxAge: 86400` / `updateAge: 3600`); email inexistente LLAMA
  `compare` (spy sobre bcryptjs real) y retorna null; user sin clients
  ídem (user real sin clients en dev DB, con cleanup); credenciales
  vacías → null SIN compare. Técnica: mock de `next-auth` (captura de
  config) + provider factory identidad — el `authorize()` testeado es el
  REAL de `auth.ts`, sin reestructurar el archivo.

Modificados:
- `tests/api/signup.test.ts`: passwords de 9 chars pre-existentes subidas
  a 10 (`secret123`→`secret1234`, `other456`→`other45678`; barrido por
  grep: ningún otro archivo de tests postea al signup). Casos nuevos
  (4): 9 chars → 400; exactamente 10 → 200; 25 emojis = 100 bytes → 400
  `PASSWORD_TOO_LONG` (con assert de `Buffer.byteLength === 100`);
  exactamente 72 bytes → 200 (frontera).

Suite completa (un solo proceso, cero huérfanos verificado con ps antes
de correr): **47 archivos / 446 tests, TODO VERDE** (356s). `pnpm
typecheck` limpio. `pnpm build` VERDE. `pnpm lint` sin warnings.

## 6. NO tocado (§9)

`app/api/ai/chat/route.ts`; matcher del middleware (verificado que no
hacía falta → Q-3 sigue abierto); copy voseo pre-existente;
`EMAIL_TAKEN`; `vercel.json`; `prisma/schema.prisma` y migraciones; rate
limiter; caps de upload/import; `.env*` (solo LECTURA por grep para
diagnosticar el `AUTH_URL` del smoke).

## 7. Desvíos / paradas

1. **HMR bajo CSP in-browser: PARCIAL.** El brief exige verificar
   empíricamente el HMR de `next dev` (websocket) bajo la CSP enforced
   de dev. Lo verificable sin browser quedó verificado: handshake ws
   real contra `/_next/webpack-hmr` → 101. Pero la ENFORCEMENT de CSP
   sobre esa conexión ocurre solo en un browser, y la extensión de
   Chrome de CC no estaba conectada (2 intentos; no abrí Chrome por la
   regla operativa post-incidente 2026-07-29). Decisión tomada: `ws:` en
   connect-src SOLO-dev queda incluido DEFENSIVAMENTE (algunos browsers
   no matchean ws:// contra 'self'; costo cero en prod/preview), con
   comentario honesto en `lib/security-headers.ts` (sin claims de
   verificación que no hice). **Cierre pendiente trivial: el primer
   `pnpm dev` de Michael con el browser abierto confirma HMR + cero
   violations en console (falla ruidosa si no).**
2. **Import `.ts` desde `next.config.mjs`** — decisión de implementación
   forzada por Next 14 (el config no se transpila): documentada en §2
   con su evidencia y su riesgo residual (versión de Node del builder de
   Vercel; fallaría ruidoso en el build del preview, no en silencio).
3. **Code `PASSWORD_TOO_LONG` nuevo** — micro-decisión documentada en §4.
4. Sin paquetes nuevos agregados (cero items bajo mitigación #6).

## 8. Verificación supply-chain post-task (punto 8 del prefijo)

```
$ ./scripts/check-supply-chain.sh
Checking for Mini Shai-Hulud infection markers...
✅ Clean — no infection markers detected

$ grep -E '"[\^~]' package.json && exit 1 || echo OK
✅ pins exact

$ grep -E "tanstack|squawk|uipath|mistral|cap-js|intercom-client|router_init|setup\.mjs|router_runtime" pnpm-lock.yaml | grep -v lightningcss
✅ lockfile clean (cero matches)
```

## 9. Estado final del working tree (GREEN, dirty, cero git)

Modificados: `package.json`, `pnpm-lock.yaml`, `next.config.mjs`,
`auth.ts`, `app/api/auth/signup/route.ts`, `app/(auth)/signup/page.tsx`,
`tests/api/signup.test.ts`, `CLAUDE.md`,
`.superpowers/sdd/hardening-backlog.md`.
Nuevos: `lib/security-headers.ts`, `app/api/csp-report/route.ts`,
`tests/lib/security-headers.test.ts`, `tests/api/csp-report.test.ts`,
`tests/api/auth-authorize.test.ts`.

Cero shells de background vivas (dev server matado y verificado con ps).

## Erratum post-review (2026-08-03)

- §Resumen/§5: "la tanda suma 22 tests en 3 archivos nuevos" → son 18 en
  los 3 archivos nuevos (10 + 4 + 4); los otros 4 son los casos nuevos de
  `tests/api/signup.test.ts`. Total nuevo = 22 y el delta 424→446 cierra.
