# Review — Carril SPEC COMPLIANCE — T2 SEGURIDAD Tanda B

Fecha: 2026-08-04. Base: `feat/hardening-t2` @ `ee88699` + working tree dirty
(scope de esta review). Fuente de verdad: `.superpowers/sdd/t2-seguridad-brief.md`
v2 (§2.7-2.9, §3 Tanda B, §4, §5 completo, §7 subset B, §9) + los 7 riders del
dispatch. Método: lectura íntegra del diff y de los 6 archivos nuevos, greps
empíricos, inspección del paquete INSTALADO (`@auth/core@0.41.3`),
`pnpm exec tsc --noEmit` (exit 0) y `pnpm lint` (0 errores/warnings). NO se
corrió Vitest, git mutante, installs ni comandos Prisma contra DB (prohibidos);
la migración se verificó por lectura de `migration.sql`.

> Nota de recuperación (2026-08-04): este archivo re-emite a path durable la
> review originalmente escrita en scratchpad (borrada por limpieza de /tmp),
> reconstruida fielmente del transcript del reviewer. Contenido sin cambios.

## VEREDICTO: PASS CON MINORS → **PASS tras el fix pass** (ver "Re-review post-fix" al final)

Un (1) hallazgo MINOR en la review original, resuelto en el fix pass. Cero
BLOCKER, cero MAJOR. Todo lo pinneado del brief §5 (modelo, API, wiring
login, wiring signup), §2.7-2.9, §4 (docs/runbook/ledger) y los 7 riders del
dispatch está implementado y verificado empíricamente.

---

## Hallazgos

### H1 — MINOR — Rider updateAge: el comment de `auth.ts` SÍ menciona `updateAge` (y el ledger afirma lo contrario) — [RESUELTO en fix pass]

- **Archivo:** `auth.ts:76-82` (comment sobre `session:`) y
  `.superpowers/sdd/hardening-backlog.md` (nota EJECUTADO del ítem D1).
- **Cláusula:** rider 2 del dispatch — "comment rolling conservado **sin
  mención a updateAge**".
- **Evidencia:** el comment nuevo decía literalmente "(updateAge was dropped
  in T2 Tanda B — it is a NO-OP under the JWT strategy, only read on the
  database-sessions branch; ledger D1.)" — es una mención a `updateAge`.
  Además, la nota EJECUTADO del ledger afirma "comentario de la semántica
  rolling conservado **sin la mención a `updateAge`**", que bajo lectura
  literal era una afirmación de estado que NO coincidía con el archivo
  (regla de backlog hygiene: los claims de estado deben ser empíricamente
  ciertos al escribirse).
- **Atenuante / ambigüedad:** hay una lectura caritativa en la que la
  "mención" a eliminar era la vieja justificación "it stays because the
  brief (T2 §2.5) pins this exact config" (que sí desapareció), y la nueva
  parenthetical era documentación del drop con puntero al ledger — útil, no
  dañina. La config en sí (`{ strategy: 'jwt', maxAge: 86400 }`) y el assert
  ajustado en `tests/api/auth-authorize.test.ts:107-111` cumplían el rider
  EXACTO. Fix aplicado: una línea (borrar la parenthetical) — ver re-review.

---

## Micro-decisiones flaggeadas — evaluación contra brief/dispatch

1. **IP fallback a `'unknown'`** (auth.ts:99-104, signup route:52): el brief
   no cubre el caso sin header; el fallback NO salta el check (saltarlo
   habilitaría bypass por header stripped) — coherente con la intención del
   rate limit por IP. CONFORME.
2. **Signup usa `consumeRateLimit` por POST** (vs peek+recordFailure de
   login): el brief §2.7/OQ-4 pinnea "misma política de IP" = números
   (20/15min, cumplido vía constantes compartidas), no la semántica
   failure-only — que en signup no existe (el "éxito" ES el abuso). §5.2 no
   restringe consume a T3. CONFORME.
3. **Cleanup lazy como CTE data-modifying en el mismo statement**
   (lib/rate-limit.ts:91-101): cumple literalmente "montado en el mismo
   increment" del §5.2, con el DELETE exacto pinneado (scope+key,
   windowStart < actual). CONFORME.
4. **`pnpm --config.ignore-scripts=true remove`**: `pnpm remove` no acepta el
   flag (documentado en report §0); la config equivalente respeta la
   mitigación #1. Lockfile diff = SOLO removals (adapter@2.7.4,
   @auth/core@0.37.4, jose@5.10.0 transitiva). CONFORME.
5. **Constantes compartidas** (`lib/upload-limits.ts`,
   `AUTH_WINDOW_MS`/`LOGIN_EMAIL_LIMIT`/`AUTH_IP_LIMIT` +
   `windowStartFor` exportados de `lib/rate-limit.ts`): el brief pinnea los
   nombres de los TRES helpers, no prohíbe exports auxiliares; las constantes
   sirven exactamente al "que login y signup no diverjan". CONFORME (no es
   overreach de scope).
6. **Asserts frontera ==10MB como "NO rechazado por el cap"**: el test plan
   pinnea "==10MB pasa [el cap]"; el assert pinnea exactamente eso
   (`not 413` / `not FILE_TOO_LARGE` / `not /file too large/`). La lenidad de
   XLSX.read es ortogonal a la frontera. CONFORME.

---

## Verificado conforme (evidencia empírica)

**§5.1 Modelo + migración**
- `prisma/schema.prisma:240-247`: modelo `RateLimit` EXACTO al pinneado
  (scope/key/windowStart/count `@default(1)`, `@@id([scope, key,
  windowStart])`, sin índices extra — punto cerrado por el filtro).
- `prisma/migrations/20260805005159_add_rate_limit/migration.sql`: CREATE
  TABLE + PK compuesta, puramente ADITIVA; carpeta contiene SOLO
  migration.sql.
- Migración SOLO contra development (rider 3): `.env.local` →
  `DATABASE_URL` apunta a `ep-morning-dream-apphzoy1` DIRECTO (sin
  `-pooler`), que NO está en la blocklist del guard
  (`lib/db-guard.ts:35,44`: production=`ep-muddy-bar-ap8e9lyb`,
  staging=`ep-lingering-salad-apedj0u3`). Mecanismo `DATABASE_URL`→CLI
  documentado en report §1 y verificado adyacente: ni `./.env` ni
  `prisma/.env` existen (ls confirmado); consistente con P1012.

**§5.2 API (nombres finales)**
- `lib/rate-limit.ts`: `consumeRateLimit`/`peekRateLimit`/`recordFailure` con
  las firmas pinneadas; upsert raw `INSERT ... ON CONFLICT ("scope","key",
  "windowStart") DO UPDATE ... RETURNING "count"` (patrón
  batchUpsertUnmapped, apunta a la PK); `windowStart =
  floor(now/windowMs)*windowMs` (ventanas fijas alineadas); peek = SELECT
  read-only sin incremento; recordFailure = mismo upsert; FAIL-OPEN en los
  tres (catch → log estructurado sin key/PII → `{allowed:true}`, nunca 500).
- Semánticas de conteo coherentes: consume permite exactamente `limit`
  eventos por ventana; peek bloquea con `count >= limit` (5 fallos → 6º
  intento bloqueado; 20 signups → 21º bloqueado).

**§5.3 Wiring login** (`auth.ts`)
- Firma `authorize(creds, request)` verificada sobre el paquete INSTALADO
  (rider 4): `node_modules/.pnpm/@auth+core@0.41.3/.../lib/actions/callback/
  index.js` destructura `headers` del request original (línea "const { query,
  body, method, headers } = request") y llama `provider.authorize(credentials,
  new Request(url, { headers, method, body: JSON.stringify(body) }))`.
  next-auth instalado = 5.0.0-beta.32.
- IP = primer hop de `x-forwarded-for` (`split(',')[0]?.trim()`), igual en
  signup (rider 4/5).
- Peek por email (`login:email`) Y por IP (`login:ip`) en Promise.all ANTES
  del `db.user.findUnique` y de cualquier bcrypt; cualquiera excede → null
  genérico (trade-off §2.7, comentado). Fallo de credenciales (post dummy
  compare o password errado) → `recordLoginFailure` en AMBOS scopes. Éxito no
  incrementa ni resetea. Overshoot documentado en comment (§5.3.4 aceptado).
- Política pinneada: 5/15min email, 20/15min IP vía constantes compartidas
  (rider 5).

**§5.4 Wiring signup** (`app/api/auth/signup/route.ts`)
- Rate limit por IP como PRIMER paso (antes de parsear body y de bcrypt),
  scope `signup:ip`, misma política de IP (constantes compartidas), bucket
  separado del de login (comentado).
- 429 + `RATE_LIMITED` vía `errorResponse()` — convención verificada
  empíricamente: `lib/auth-helpers.ts:27-37` produce `{ error: { code,
  message } }`, codes SCREAMING_SNAKE en las hermanas (rider 6). Copy en
  tuteo ("Intenta de nuevo"). Asimetría con login documentada en comment
  (decidida §5.4 — no levantada, como manda el brief).

**§2.9 Caps 10MB**
- `lib/upload-limits.ts`: `MAX_UPLOAD_FILE_BYTES = 10 * 1024 * 1024`.
- `data/upload`: cap POR ARCHIVO con `file.size` ANTES de `arrayBuffer()`
  (cap en processOneFile ~línea 229; `arrayBuffer()` recién en ~258), shape
  existente `{ filename, error }`; los demás archivos siguen procesándose.
- `parametros/import`: `part.size` pre-buffer → 413 + `FILE_TOO_LARGE` con el
  shape `errorResponse` del repo (status y code pinneados por el brief;
  nesting dictado por el repo, verificado).

**Rider 1 (adapter)**
- `package.json`: `@auth/prisma-adapter` fuera; pins exact intactos.
- `pnpm-lock.yaml`: diff = SOLO removals; cero referencias a
  `@auth/core@0.37.4` / `@auth/prisma-adapter` (grep = 0);
  `node_modules/@auth` (symlink top-level) no existe. Único `@auth/core`
  del lockfile: 0.41.3.
- Ledger: RESOLUCIÓN marcada EJECUTADO con cifras (50 vulns 2c/26h/20m/2l;
  los 3 GHSAs de 0.37.4 nombrados como desaparecidos).
- Observación (no hallazgo): queda un directorio huérfano
  `node_modules/.pnpm/@auth+core@0.37.4/` en el virtual store local —
  artefacto no commiteado que pnpm poda en el próximo install; no afecta
  lockfile ni audit (que leen el lockfile).

**§4 Docs (rider 7)**
- `docs/runbooks/t2-migraciones-runbook.md` (nuevo, patrón T1): regla de oro
  strings de la CONSOLA DE NEON directos/unpooled; prohibición explícita de
  `DATABASE_URL_UNPOOLED`/`POSTGRES_*`/`PG*` de Vercel; Paso 1 staging
  `migrate deploy` ANTES del smoke de preview (+ nota de Reset from parent);
  Paso 2 production ANTES del merge (aditiva, ventana deploy-sin-tabla
  eliminada); Paso 3 development referencia; nota channel_binding; sección
  Futuro apuntando al ítem bloqueado.
- `CLAUDE.md` §Mapa de entornos: bullet "Migraciones por entorno" con el
  flujo completo + prohibición de vars legacy + puntero al runbook. Única
  edición a CLAUDE.md en el diff.
- Ledger: ítem nuevo "Automatizar `prisma migrate deploy`" marcado BLOQUEADO
  por el ítem de vars legacy, insertado inmediatamente después de ese ítem.

**§7 Test plan (subset Tanda B)**
- `tests/lib/rate-limit.test.ts` (nuevo): bajo/sobre el límite; ATOMICIDAD
  (10 consumes concurrentes → RETURNING 1..10 distintos, fila final =10);
  ventana nueva resetea + cleanup lazy borra la stale (seed, sin sleeps);
  peek read-only y bloquea en el límite; recordFailure incrementa el mismo
  contador; fail-open ({allowed:true} + log estructurado sin key).
- `tests/api/auth-authorize.test.ts`: assert de config `{ strategy: 'jwt',
  maxAge: 86400 }` (rider 2); los 3 tests de dummy compare CONSERVADOS
  (email inexistente llama compare y retorna null; user sin clients ídem;
  creds faltantes sin compare); fallo registra en AMBOS scopes; éxito NO
  incrementa (assert de cero filas); email over-limit e IP over-limit → null
  genérico SIN tocar la tabla de users (spy de findUnique no llamado, compare
  no llamado).
- `tests/api/signup.test.ts`: IP sobre el límite → 429 + `RATE_LIMITED` y el
  user NO se creó; cleanup de filas RateLimit.
- `tests/api/upload.test.ts`: >10MB rechaza con `{ filename, error }`;
  ==10MB pasa el cap (frontera pinneada; mock de `File.size` sin
  materializar bytes).
- `tests/api/parametros-import-cap.test.ts` (nuevo): >10MB → 413 +
  `FILE_TOO_LARGE`; ==10MB no-413.

**§9 No-tocar (chequeo negativo)**
- `app/api/ai/chat/route.ts`, `middleware.ts`, `vercel.json`: NO aparecen en
  `git status` (limpios).
- Voseo "Verificá que sea un .xlsx válido" intacto en
  `app/api/parametros/import/route.ts:65`.
- `EMAIL_TAKEN` 409 intacto en `app/api/auth/signup/route.ts:140`.
- Nada fuera de scope en el diff: los 12 tracked + 6 untracked corresponden
  1:1 a los deliverables del brief/dispatch (más el report del implementer en
  `.superpowers/sdd/`, esperado por protocolo).

**Toolchain**
- `pnpm exec tsc --noEmit` → exit 0. `pnpm lint` → "No ESLint warnings or
  errors". Cliente Prisma regenerado (los tests tipados contra `db.rateLimit`
  compilan).

---

## Re-review post-fix (2026-08-04)

Fix pass aplicado al working tree (sigue dirty, sin commits). Verificación
empírica del carril spec:

**a) H1 RESUELTO bajo lectura literal.**
- `grep -n updateAge auth.ts` → CERO hits. El comment de `session:` quedó:
  semántica rolling completa conservada ("24h ROLLING idle window ... only
  24h of full inactivity ends the session.") + la frase de verificación
  contra `@auth/core@0.41.3` — la parenthetical "(updateAge was dropped...)"
  fue eliminada. Config intacta: `session: { strategy: 'jwt', maxAge: 86400 }`.
- Claim del ledger D1 ("comentario de la semántica rolling conservado sin la
  mención a `updateAge`") ahora es LITERALMENTE VERDADERO — no necesitó
  ajuste, como afirmó el fixer.
- Las dos menciones restantes a `updateAge` viven en
  `tests/api/auth-authorize.test.ts:3,105` (header del archivo y nombre del
  test del assert) — fuera del alcance del rider, que pinneaba el comment
  rolling de `auth.ts` y pedía el assert ajustado en ese test (cumplido).

**b) Cero regresiones de spec en los archivos tocados por el fixer.**
- `app/api/data/upload/route.ts`, `app/api/parametros/import/route.ts`,
  `lib/upload-limits.ts`: SOLO texto de comments cambió (verificado por
  re-lectura del diff completo). La lógica pinneada queda idéntica: chequeo
  de `file.size`/`part.size` ANTES de `arrayBuffer()`, umbral
  `> MAX_UPLOAD_FILE_BYTES` (==10MB pasa), shape `{ filename, error }`
  per-file en upload, 413 + `FILE_TOO_LARGE` vía `errorResponse` en
  parametros/import. Mismos codes, mismos status, mismos mensajes de error
  de producto.
- §9 sigue intacto: chat route / `middleware.ts` / `vercel.json` ausentes de
  `git status`; voseo "Verificá..." en `app/api/parametros/import/route.ts:66`
  y `EMAIL_TAKEN` 409 en `app/api/auth/signup/route.ts:140` sin tocar; el
  diff de signup no cambió respecto de lo revisado (27 adiciones, las
  mismas).
- Ledger: subsección nueva "T2 Tanda B — minors de la doble review" —
  conforme al protocolo (minors al ledger, nunca al diff de código); su
  contenido es del otro carril y no se evalúa acá.
- `git status` sin archivos nuevos ni fuera de scope. `pnpm exec tsc
  --noEmit` re-corrido post-fix → exit 0.

**c) VEREDICTO FINAL DEL CARRIL SPEC: PASS** (H1 resuelto; cero hallazgos
abiertos).
