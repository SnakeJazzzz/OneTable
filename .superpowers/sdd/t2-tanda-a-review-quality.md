# Review CODE QUALITY — Hardening T2 Tanda A (working tree, `feat/hardening-t2`)

Fecha: 2026-08-03. Reviewer: carril quality (ciego al carril spec).

> Nota de recuperación (2026-08-03): este archivo re-emite fielmente la review
> escrita originalmente en el scratchpad de sesión (borrado por la limpieza
> periódica de /tmp). Contenido reconstruido del transcript del reviewer, sin
> re-análisis. La review quedó cerrada sobre la Tanda A (commiteada en ee88699).

## Veredicto original: **FAIL** (1 MAJOR de fix trivial; cero BLOCKERs; el resto MINORS)
## Veredicto final post-fix: **PASS CON MINORS** (ver "Re-review post-fix" al final)

El MAJOR no era un bug de runtime que rompiera nada — era una opción de config
inerte cuyo comentario (y test) documentaban un comportamiento de seguridad que
NO era el real. Se resolvió en el fix pass (documentación corregida + decisión
de config escalada), con lo que el veredicto pasó a PASS CON MINORS.

Verificación empírica realizada (no solo lectura):
- `pnpm typecheck` → exit 0. `pnpm lint` → 0 warnings/errors.
- `next.config.mjs` cargado nativamente con Node 23.11 (`import()` +
  `headers()` ejecutado): el import `.ts` por type stripping FUNCIONA y el
  output de headers es el esperado (5 headers, CSP dev con `unsafe-eval` y
  `ws:`).
- `DUMMY_BCRYPT_HASH` validado con bcryptjs real: 60 chars, prefijo
  `$2a$10$`, `compare()` resuelve `false` sin throw; timing promedio 54.43ms
  (dummy) vs 54.21ms (hash real rounds 10) — el equalizador iguala el costo
  de verdad.
- `updateAge` rastreado en el source instalado de `@auth/core@0.41.3`
  (hallazgo 1).
- Lockfile diff auditado paquete por paquete + grep mandatorio de tokens del
  worm → limpio (hallazgo 0 abajo, sin issues).

---

## Hallazgos

### 1. MAJOR — `auth.ts:45-47`: `updateAge` es un no-op bajo strategy JWT y el comentario documenta un modelo de expiración FALSO

Verificado contra el source instalado
(`node_modules/.pnpm/@auth+core@0.41.3/.../lib/actions/session.js`):

- `options.session.updateAge` se lee UNA sola vez (línea 77), dentro del
  branch de **database sessions**. El branch JWT (el nuestro) jamás lo
  consulta.
- En el branch JWT, CADA lectura de sesión re-firma el JWE con
  `setIssuedAt()` + expiry `now + maxAge` y re-emite la cookie con
  `expires = now + maxAge`. No hay throttle de ningún tipo.

Consecuencias concretas:

1. El comentario "maxAge: absolute JWT/session lifetime of 24h" es falso:
   la sesión es **rolling/sliding**. Un usuario (o un atacante con una
   cookie robada) que toque la app al menos una vez cada 24h mantiene la
   sesión viva INDEFINIDAMENTE. Solo la inactividad >24h la mata. Cualquier
   razonamiento futuro tipo "el token robado muere solo a las 24h máximo"
   construido sobre este comentario es incorrecto.
2. El comentario "updateAge: the rolling-expiry refresh happens at most
   once per hour" es falso: el refresh ocurre en cada request que lea
   sesión, `updateAge` no hace nada.
3. `tests/api/auth-authorize.test.ts:64-70` asserta que el objeto de config
   contiene `updateAge: 3600` — testea el eco de una perilla inerte,
   cimentando la ilusión de que hace algo.

Fix esperado (trivial): quitar `updateAge` (o dejarlo con comentario que
diga explícitamente que es inerte bajo JWT) y corregir el comentario de
`maxAge` a "ventana rolling de 24h de inactividad" — que ES una política
razonable y sigue siendo mejor que el default de 30 días. Ajustar el assert
del test en consecuencia. Si la intención del hardening era expiración
ABSOLUTA de 24h, eso requiere lógica custom en el callback `jwt` (comparar
un `iat` propio persistido) — decisión para el owner, no la tomo yo.

### 2. MINOR — `app/api/csp-report/route.ts:28-36`: el cap NO es pre-materialización para clientes maliciosos

`req.text()` bufferea el body COMPLETO en memoria antes del chequeo
`raw.length`. El chequeo de `Content-Length` solo protege contra clientes
honestos: un atacante manda transfer-encoding chunked sin Content-Length (o
mintiendo) y el proceso materializa el body entero igual. Escenario: POST
chunked de 100MB → 100MB en heap antes del 413. En Vercel el daño está
acotado por el cap de plataforma (~4.5MB por request), así que en prod es
ruido más que DoS real; en `next dev` / self-host no hay cota. Un cap real
pre-materialización requiere leer `req.body` con un reader y abortar al
pasar el límite. Nota menor adicional: `raw.length` cuenta code units
UTF-16, no bytes — un body multibyte de hasta ~4x 32KB en bytes pasa el
chequeo (acotado, pero el "32KB" del comentario no es exacto en bytes).

### 3. MINOR — `app/api/csp-report/route.ts`: sin rate limit ni autenticidad — el log es floodeable y la señal de T6 es forjable

Endpoint público que escribe hasta ~32KB a stdout por request, sin rate
limiting ni dedup. Dos consecuencias concretas: (a) flooding de logs de
Vercel (costo/ruido) con un loop de `curl`; (b) cualquiera puede POSTear
reportes FALSOS con el shape correcto — y la decisión T6 de flipear
production a enforced se basa en leer estos logs. Un reporte forjado es
indistinguible de uno real (no hay validación de origen posible con
report-uri, es inherente al mecanismo). No es un defecto del código en sí
— es una limitación que T6 debe conocer al interpretar los logs: filtrar
por user-agent/patrones y tratar la señal como orientativa, no como
ground truth. Dejar registrado.

### 4. MINOR — copy UI vs server: "72 caracteres" vs "72 bytes" (`app/(auth)/signup/page.tsx:25`)

El server rechaza por BYTES (`route.ts:60`, correcto para bcrypt) y su
mensaje dice "máximo 72 bytes". El `ERROR_COPY` del form dice "máximo 72
caracteres". Escenario: password de 40 emojis (40 chars percibidos, 160
bytes) → el usuario ve "máximo 72 caracteres" teniendo menos de 72 — el
mensaje es factualmente falso exactamente en los casos donde la distinción
bytes/chars importa. Sugerencia de copy: "demasiado larga" a secas o
"usa una contraseña más corta". Cosmético pero es el único caso donde el
error se muestra y confunde.

### 5. MINOR — import `.ts` en `next.config.mjs`: sin pin de `engines`, la técnica depende silenciosamente del Node del entorno

Verificado que funciona local (Node 23.11) y CI corre Node 24
(`ci.yml:90`). Pero no hay `"engines"` en `package.json` ni runtime pin en
`vercel.json`: si el project setting de Node en Vercel quedó en 20.x/18.x
(o un colaborador local corre <22.18), `next build`/`next dev` muere en la
carga del config con `ERR_UNKNOWN_FILE_EXTENSION`. Falla LOUD (no hay modo
silencioso), pero el mensaje no dice "subí Node" — costo de diagnóstico.
Recomendación barata: `"engines": { "node": ">=22.18" }` + verificar el
Node version del proyecto en el dashboard de Vercel antes del deploy del
PR. Nota de ruido: cada comando `next` ahora imprime `ExperimentalWarning:
Type Stripping` + el warning `MODULE_TYPELESS_PACKAGE_JSON` (reparse de
`lib/security-headers.ts` como ESM). Inofensivo pero visible en todos los
builds.

### 6. MINOR — CSP ENFORCED en preview va a romper el Vercel Toolbar

`script-src 'self'` enforced en preview bloquea el script de
`vercel.live` que Vercel inyecta en preview deployments para miembros del
team (toolbar de comments/feedback). Escenario concreto: Michael abre la
preview URL para el smoke pre-merge → consola con violaciones CSP del
toolbar + toolbar no funcional + cada violación POSTea a
`/api/csp-report` (pagando además el decode de sesión del middleware, que
sí corre en ese path). No afecta la app en sí ni production (Report-Only,
sin toolbar). Si el toolbar no se usa, es solo ruido; si se usa, va a
sorprender. Opciones: allowlistear `https://vercel.live` + `wss://*.pusher.com`
solo en preview, o aceptar el ruido documentándolo.

### 7. MINOR — `tests/api/auth-authorize.test.ts`: asserts de compare cuentan llamadas pero no argumentos, y falta el path "user real + password incorrecta"

- Los tests de miss assertan `toHaveBeenCalledTimes(1)` pero no CONTRA QUÉ
  se comparó. Si un refactor futuro pasara `user?.passwordHash ?? ''` en
  vez del dummy (rompiendo el equalizador — compare contra '' retorna en
  microsegundos), estos tests seguirían verdes. Assert barato:
  `toHaveBeenCalledWith('whatever-password', expect.stringMatching(/^\$2a\$10\$/))`.
- No hay caso "email existente + password incorrecta → null con
  exactamente 1 compare (sin doble compare)" ni el happy path por este
  harness. Los dos paths editados sí están cubiertos; esto es cobertura
  del invariante completo del diff (ningún path con 0 o 2 compares).

## Hallazgo 0 (sin issue) — Lockfile / bumps: LIMPIO

Auditado el diff completo de `pnpm-lock.yaml`:
- `next@14.2.35` trae `@next/swc-*@14.2.33` — verificado que viene de los
  `optionalDependencies` declarados por el propio `next@14.2.35` en el
  registry (snapshot del lockfile), no es inyección.
- `next-auth@5.0.0-beta.32` → `@auth/core@0.41.3` (jose 6.2.8,
  oauth4webapi 3.8.6, preact 10.24.3 — dep set normal de @auth/core).
- Removidos: `cookie@0.7.1`, `@types/cookie`, preact viejo — consistentes
  con el upgrade de @auth/core. Desapareció el marker `deprecated: This
  version has a security vulnerability` del next viejo (el motivo del bump).
- Grep mandatorio de tokens del worm → cero hits.
- Observación (ya registrada como cleanup en el repo): `@auth/prisma-adapter`
  (UNUSED) sigue anclando un `@auth/core@0.37.4` duplicado en el árbol.

## Observaciones (sin severidad, no accionables ahora)

- Señal de timing residual en `authorize()`: path dummy = findUnique MISS +
  compare; path real = findUnique HIT con join de clients + compare. El
  bcrypt (~54ms medidos) domina, pero el delta de DB (~1-5ms en Neon) no
  está igualado. Aceptable — el equalizador cumple su objetivo contra el
  gap de ~100x original.
- `lib/security-headers.ts:89`: el comentario justifica `img-src data:
  blob:` con el export SheetJS, pero las descargas por anchor `blob:` no
  las gobierna `img-src`. La directiva es inofensiva y future-proof;
  solo la justificación es imprecisa.
- `password.length < MIN_PASSWORD` cuenta code units UTF-16: 5 emojis
  astrales = length 10 → pasa el mínimo "10 caracteres" con 5 chars
  percibidos. Entropía suficiente igual; no accionable.
- El early-return de credenciales vacías en `authorize()` NO lleva dummy
  compare — correcto: solo revela "request malformado", no existencia de
  cuenta, y el test lo fija explícitamente.

## Fortalezas (informativas)

- El módulo de headers es genuinamente puro (cero imports), erasable-only
  como promete su header comment, y el consumo desde `next.config.mjs`
  quedó verificable por unit tests — buen corte de seams.
- El rechazo (no truncado) de passwords >72 bytes es la decisión correcta
  frente al truncado silencioso de bcrypt, con el boundary test multibyte
  (25 emojis = 100 bytes) probando exactamente la distinción bytes/chars.
- El harness de `auth-authorize.test.ts` (NextAuth stub captura-config +
  provider factory identidad) ejercita el `authorize()` REAL contra la DB
  real — no un doble. Es el patrón correcto para testear config de
  NextAuth v5 sin restructurar `auth.ts`.
- Log del csp-report: todo pasa por `JSON.stringify` (report re-parseado,
  user-agent, raw truncado a 2KB) → newlines/controles escapados, sin
  vector de log injection ni de multilínea forjada.

---

## Re-review post-fix (2026-08-03, mismo carril, working tree post-fixer)

### a) Hallazgo 1 (MAJOR, updateAge/comentario en auth.ts): RESUELTO — SÍ

Verificado empíricamente re-leyendo `auth.ts`:

- El comentario nuevo (`auth.ts:45-51`) describe la semántica REAL y
  coincide punto por punto con lo que yo verifiqué en el source instalado
  de `@auth/core@0.41.3`: (1) maxAge = ventana rolling de idle de 24h, no
  vida absoluta; (2) re-firma con `exp = now + maxAge` en cada lectura de
  sesión; (3) cookie usada al menos 1 vez/día no expira nunca, solo 24h de
  inactividad total la mata; (4) `updateAge` es NO-OP bajo JWT (solo se lee
  en el branch de database sessions); (5) se conserva porque el brief §2.5
  pinnea la config. Cero afirmaciones falsas remanentes.
- Config y comportamiento INTACTOS: `git diff auth.ts` filtrado a líneas de
  código (sin comentarios) muestra exactamente los 3 cambios originales de
  la tanda (DUMMY_BCRYPT_HASH, la línea `session: {...}` sin modificar
  respecto al diff pre-fix, y el bloque del dummy compare). El fixer solo
  tocó comentarios.
- `tests/api/auth-authorize.test.ts` sin tocar — correcto: verifiqué (grep
  de `maxAge|updateAge|absolute|rolling`) que sus textos solo describen la
  CONFIG ("uses JWT strategy with maxAge 86400 and updateAge 3600"), que es
  una afirmación verdadera como pin de config; no afirman semántica de
  expiración. Mi frase original "cimenta la ilusión" queda neutralizada por
  el comentario corregido en `auth.ts`, que es donde vive la verdad.
- La decisión de config (dropear `updateAge` / expiry absoluto) quedó
  escalada a Michael en el ledger — resolución correcta para un cambio que
  el brief pinnea. "Documentación corregida + decisión escalada" es
  exactamente el cierre que pedía el hallazgo.

### b) Ledger — fidelidad de los ítems 1-7 de "T2 Tanda A — minors de la doble review"

Leídos SOLO esos ítems (`hardening-backlog.md:678-716`). Los 7 capturan
fielmente defecto, archivo:línea y escenario — line numbers re-verificados
contra los archivos reales:

1. Session rolling / updateAge inerte (`auth.ts:52` ✓) — semántica, causa y
   opciones correctas; tag de decisión pendiente presente. Fiel.
2. Cap no pre-materialización (`route.ts:30,34` ✓ — `req.text()` y el
   chequeo `raw.length`) — chunked sin Content-Length, cota Vercel ~4.5MB,
   nota UTF-16. Fiel.
3. Sin rate limit / forjable (route completa) — captura el envenenamiento de
   la señal de T6 y la mitigación candidata. Fiel.
4. Copy 72 chars vs bytes (`page.tsx:25` ✓, ERROR_COPY). Fiel.
5. Import `.ts` / Node ≥22.18 (`next.config.mjs:9` ✓) — failure mode ruidoso
   y warnings capturados. Imprecisión menor de redacción: el paréntesis
   "(`vercel.json` es no-tocar en T2)" — mi remedio propuesto era `engines`
   en `package.json`, no en `vercel.json`; no cambia el defecto registrado
   ni la accionabilidad (el ítem sigue apuntando bien al riesgo). No
   bloquea.
6. CSP preview vs Vercel Toolbar (`lib/security-headers.ts`) — tag
   [DECISIÓN PENDIENTE, PRE-SMOKE] presente, opciones correctas. Fiel.
7. Endurecer auth-authorize.test (`:94,104` ✓ — los dos
   `toHaveBeenCalledTimes(1)`) — captura el assert-con-DUMMY faltante y el
   path wrong-password. Fiel.

(El ítem 8 de la sección — HMR — no corresponde a mis hallazgos; no lo
evalúo.)

### c) Veredicto final del carril quality

**PASS CON MINORS** — el MAJOR queda resuelto (comentario corregido a la
semántica real verificada + decisión de config escalada a Michael en el
ledger); los 6 MINORS están fielmente registrados en el ledger conforme al
protocolo; única objeción: la imprecisión cosmética de redacción en el ítem
5 del ledger (engines vive en `package.json`), que puede corregirse en el
mismo commit del ledger o ignorarse.
