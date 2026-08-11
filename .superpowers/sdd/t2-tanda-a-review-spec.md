# Review — CARRIL SPEC COMPLIANCE — T2 SEGURIDAD, Tanda A

Reviewer: spec-compliance lane, 2026-08-03. Fuente de verdad:
`.superpowers/sdd/t2-seguridad-brief.md` (v2 GO) + requisitos del dispatch.
Método: lectura íntegra del diff (tracked + 5 untracked), greps empíricos,
`pnpm typecheck` (exit 0), `pnpm lint` (clean), carga real de
`next.config.mjs` vía Node con `VERCEL_ENV` variado, validación empírica del
dummy hash con bcryptjs. NO se corrió Vitest ni dev server (prohibido).

> Nota de recuperación (2026-08-03): este archivo es una RE-EMISIÓN fiel de
> la review originalmente escrita en scratchpad (borrada por la limpieza de
> /tmp), reconstruida del transcript del reviewer. La review quedó cerrada
> sobre la Tanda A pre-commit.

## VEREDICTO: **PASS CON MINORS** (pre-fix) → **PASS** (post-fix, ver re-review al final)

Ningún parámetro pinneado del brief violado. Nada de Tanda B se coló. §9
no-tocar respetado íntegro. Los 3 minors son: una obligación de verificación
del brief que quedó PARCIAL (declarada, con cierre trivial definido), una
imprecisión de copy en el edge multibyte, y una inexactitud aritmética en el
report del implementer (no en el diff).

---

## Hallazgos

### H1 — MINOR — Verificación HMR in-browser bajo CSP dev: PARCIAL (obligación §6 no cerrada al 100%)

- **Archivo:** `lib/security-headers.ts:27-35` (comentario `ws:` dev-only) /
  report §7.1.
- **Cláusula:** brief §6: "agregar `'unsafe-eval'` a script-src solo-dev y
  VERIFICAR el HMR de `next dev` (websocket) — si hace falta, `ws:` en
  connect-src SOLO-dev". La inclusión de `ws:` es condicional a la
  verificación; la verificación quedó a medias.
- **Evidencia:** el implementer verificó el handshake ws server-side (101
  Switching Protocols) pero NO el enforcement de CSP sobre esa conexión, que
  solo ocurre en un browser. Lo declara honestamente (report §7.1) y la
  restricción es legítima (regla operativa post-incidente 2026-07-29: no
  abrir Chrome). `ws:` quedó incluido DEFENSIVAMENTE, correctamente acotado
  a dev (verifiqué empíricamente: `buildCspDirectives('preview'/'production')`
  NO contienen `ws:` ni `'unsafe-eval'` — cero impacto prod/preview).
- **Evaluación:** desvío ACEPTABLE dentro de sus restricciones operativas;
  el modo de fallo es ruidoso (HMR roto + violation en console) y el cierre
  es trivial: **el primer `pnpm dev` de Michael con browser abierto debe
  confirmar HMR funcionando + cero violations en console**. Debe quedar
  visible como pendiente del gate, no darse por cerrado.

### H2 — MINOR — Copy de cliente "72 caracteres" contradice la semántica pinneada de 72 BYTES en el edge multibyte

- **Archivo:** `app/(auth)/signup/page.tsx:25` (`'Tu contraseña es demasiado
  larga (máximo 72 caracteres)'`) vs `app/api/auth/signup/route.ts:63`
  (server: "72 bytes", correcto).
- **Cláusula:** brief §2.8 pinnea el cap en BYTES
  (`Buffer.byteLength(...) > 72`). El brief NO pinnea el texto del copy, así
  que no es violación de parámetro — pero el mensaje al usuario es falso en
  el caso multibyte: un password de 25 emojis (25 chars, 100 bytes) recibe
  "máximo 72 caracteres" sin exceder 72 caracteres.
- **Evaluación:** micro-decisión declarada por el implementer (report §4,
  "para el usuario final 'bytes' es ruido"). Non-blocking; a criterio de
  Michael si el copy se ajusta (p.ej. "demasiado larga") ahora o nunca.

### H3 — MINOR — Report del implementer: frase de conteo de tests internamente inconsistente

- **Archivo:** `.superpowers/sdd/t2-tanda-a-report.md:20-21` ("la tanda suma
  22 tests en 3 archivos nuevos + 4 en `signup.test.ts`").
- **Evidencia:** conteo empírico de los 3 archivos nuevos: 10
  (`security-headers.test.ts`) + 4 (`csp-report.test.ts`) + 4
  (`auth-authorize.test.ts`) = **18**, no 22. 18 + 4 de signup = 22 TOTAL,
  consistente con el delta 424→446 declarado. La aritmética global cierra;
  la frase atribuye mal la distribución.
- **Evaluación:** inexactitud del report, no del diff. Sin impacto en
  compliance del código.

---

## Micro-decisiones flaggeadas — evaluación contra el brief

1. **`PASSWORD_TOO_LONG` (400) nuevo:** CONFORME. Brief §2.8 pinnea status
   400 + rechazo, NO el code. El code nuevo no toca la enumeración
   `EMAIL_TAKEN` (§9) y el form lo necesita para mapear copy distinto
   (`ERROR_COPY` es code→string). Verificado: 400 con `errorResponse`
   (shape existente del repo), orden mínimo-primero/cap-después.
2. **Import `.ts` desde `next.config.mjs` (type stripping):** CONFORME con
   el pin "builder en lib/security-headers.ts consumido por next.config.mjs".
   Verificado empíricamente: cargué `next.config.mjs` con Node local y
   `headers()` devuelve exactamente el set pinneado (§2.2 + CSP por env).
   Riesgo residual (versión Node del builder de Vercel) declarado y de
   fallo ruidoso en el primer deploy del PR — aceptable; el smoke de preview
   obligatorio lo caza.
3. **`ws:` defensivo en connect-src dev:** ver H1. La inclusión en sí es
   compatible con §6 ("si hace falta, ws: SOLO-dev") y está correctamente
   acotada a dev; lo parcial es la verificación, no la directiva.

---

## Verificado conforme (empírico)

**§2.1 Bumps + dispatch #3:**
- `package.json`: `next 14.2.35`, `next-auth 5.0.0-beta.32`,
  `eslint-config-next 14.2.35`, pins exact (grep `"[\^~]` → cero).
- Lockfile: cero entradas `next@14.2.18` / `beta.25` /
  `eslint-config-next@14.2.18` restantes; TODO el diff del lockfile es el
  closure transitivo esperado de los 3 bumps (`@next/*@14.2.35`, swc
  14.2.33 —pareja correcta de next 14.2.35—, `@auth/core` 0.37.4/0.41.3,
  `jose@6.2.8`, swap de preact, remoción de cookie/@types-cookie). Nada
  ajeno.
- Supply chain: `check-supply-chain.sh` limpio; grep de tokens del worm en
  lockfile → cero matches; cero paquetes nuevos.
- `CLAUDE.md` §Stack: las 3 versiones actualizadas en el mismo diff; cero
  referencias stale a 14.2.18/beta.25 en el archivo.

**§2.2 + §2.3 Headers/CSP:**
- `lib/security-headers.ts`: builder puro, cero imports de Next. Los 4
  siempre-enforced EXACTOS al pin (nosniff / DENY /
  strict-origin-when-cross-origin / `camera=(), microphone=(),
  geolocation=()`), verificados por carga real del config.
- Mapeo por `VERCEL_ENV` verificado ejecutando el módulo: production →
  `Content-Security-Policy-Report-Only`; preview → `Content-Security-Policy`
  enforced; dev → enforced con `'unsafe-eval'` + `ws:`. Directivas base §6
  completas (default/script/style/img/connect/frame-ancestors/object-src/
  base-uri/report-uri) — output pegado del run: prod-dirs sin relajaciones
  dev.
- Inventario empírico de orígenes externos (§6 paso previo): corroborado
  por greps propios — cero `next/font`/`@font-face`/`next/image`, cero URLs
  http(s) no-comentario en runtime de app/components/lib. Baseline
  `'self'`-only justificado con evidencia.
- `frame-ancestors` en Report-Only: NO levantado (instrucción explícita §6).
- `'unsafe-inline'`: NO levantado (pinneado).

**§2.4 csp-report:**
- `app/api/csp-report/route.ts`: POST público, SIN DB (grep `lib/db` →
  cero), log estructurado JSON a stdout, cap 32KB en dos capas
  (Content-Length pre-read + tamaño real), 204/413. Matcher del middleware
  NO tocado (git status limpio sobre `middleware.ts`); estructuralmente
  consistente con el POST anónimo 204 reportado (el middleware solo exige
  auth en los 5 prefijos de página) → Q-3 correctamente NO activada, que es
  el resultado CORRECTO según §3 Tanda A punto 2.

**§2.5 + §2.6 Auth:**
- `auth.ts`: `session: { strategy: 'jwt', maxAge: 86400, updateAge: 3600 }`
  exacto.
- `DUMMY_BCRYPT_HASH` validado empíricamente con bcryptjs: 60 chars,
  `getRounds()` → **10**, `compare()` corre y devuelve false sin throw.
  `await compare()` ANTES del `return null` en AMBOS paths de miss (email
  inexistente / user sin clients — un solo bloque cubre los dos), con
  comentario del porqué (timing). El path de credenciales vacías retorna
  null sin compare (no pinneado como miss por el brief; test lo asserta).

**§2.8 Password policy:**
- `MIN_PASSWORD = 10`; `Buffer.byteLength(password, 'utf8') > 72` → 400
  RECHAZO (nunca truncar), comentario correcto. Users existentes intactos
  (cero cambios a login/hashes). Form: `minLength={10}`, hint "Mínimo 10
  caracteres.", `ERROR_COPY` nuevo en TUTEO ("Tu contraseña...").

**Test plan §7 (subset Tanda A) — presencia y contenido:**
- Builder CSP: 10 tests (mapeo env, enforced vs Report-Only, directivas
  base, relajaciones solo-dev, set de 5 headers).
- Authorize: session config exacta + email inexistente LLAMA compare (spy) y
  null + user sin clients ídem; el `authorize()` testeado es el REAL de
  `auth.ts` (mock de NextAuth como captura + provider factory identidad).
- Signup: 9 chars → 400; exactamente 10 → 200; 25 emojis (100 bytes,
  assertado con `Buffer.byteLength`) → 400 `PASSWORD_TOO_LONG`; exactamente
  72 bytes → 200 (frontera). Passwords de 9 chars pre-existentes subidas a
  10; grep propio confirma que ningún otro archivo de tests postea al
  signup.
- csp-report: 204 + log (spy), no-JSON → 204 `unparseable`, 33KB → 413 sin
  log, Content-Length gigante → 413 pre-read.
- `pnpm typecheck` exit 0; `pnpm lint` sin warnings (verificado por mí).

**Negativo — §9 no-tocar y Tanda B:**
- `app/api/ai/chat/route.ts`, `middleware.ts` (y su matcher),
  `vercel.json`, `prisma/schema.prisma`, `prisma/migrations/`,
  `app/api/data/upload/route.ts`, `app/api/parametros/import/route.ts`:
  NINGUNO en el diff (git status).
- Voseo pre-existente intacto: "Empezá…" (signup page:92), "¿Ya tenés
  cuenta?" (:152), "Verificá…" (`parametros/import/route.ts:51`).
- `EMAIL_TAKEN` 409 intacto (route + ERROR_COPY + test).
- Cero Tanda B: grep `RateLimit|consumeRateLimit|peekRateLimit|
  recordFailure|FILE_TOO_LARGE` sobre lib/, app/, auth.ts, tests/ → cero.
- Untracked: solo los 5 archivos esperados (`app/api/csp-report/` contiene
  únicamente `route.ts`).

**Dispatch #1 y #2 — ledger:**
- Entrada nueva "T2 Tanda A — audit post-bump y erratum del brief
  (2026-08-03)": advisory IDs cerrados listados con GHSA (next 9 incl. el
  critical de middleware; next-auth los 5 incl. los 2 criticals); restantes
  triageados en los DOS grupos pedidos — (a) dev-only y (b) path a
  producción — con fundamento por grupo (de hecho por ítem, que satisface
  el mínimo de "una línea por grupo"). Hallazgo adicional del `@auth/core`
  0.37.4 vía prisma-adapter no-importado bien fundamentado (verifiqué:
  único match de prisma-adapter es el comentario de `auth.ts:25`).
- Erratum §1.9 registrado; verificado empíricamente por mí:
  `grep -c "^model" prisma/schema.prisma` → **10**, no existe modelo
  `RateLimit`, 3 migraciones.

**Desvíos declarados del report (dispatch #4):** el smoke dev de
login/signOut/middleware está documentado con evidencia HTTP detallada
(302 + cookie, expires=+24h, 307/200, signOut) — no reproducible en este
carril (dev server prohibido) pero consistente con el código verificado.
El único obligatorio PARCIAL es el HMR in-browser (H1) — aceptable con
cierre pendiente explícito.

---

## Re-review post-fix (2026-08-03)

Alcance: SOLO la resolución de H1-H3 de este carril + verificación de que
el cambio de comentario en `auth.ts` (hallazgo de otro carril) no altera la
config pinneada. Método: lectura empírica del ledger y el report reales +
`git diff auth.ts`.

### H1 (HMR in-browser parcial) — **RESUELTO como registro fiel**

Verificado en `.superpowers/sdd/hardening-backlog.md`, sección "T2 Tanda A
— minors de la doble review (no bloquean; registrados 2026-08-03)": ítem
"**HMR bajo CSP dev: cierre pendiente**" presente, con el contenido exacto
del hallazgo — verificación in-browser no realizada (extensión Chrome
desconectada, regla post-incidente), cierre = primer `pnpm dev` de Michael
con browser abierto (HMR funcionando + cero violations CSP en console,
falla ruidosa si no). Sin cambio de código: consistente con mi propio
análisis (la inclusión de `ws:` era conforme; lo parcial era la
verificación). CORRECTO.

### H2 (copy "72 caracteres" vs 72 bytes) — **RESUELTO como registro fiel**

Verificado en la misma sección del ledger: ítem "**Copy signup 'máximo 72
caracteres' vs server 72 BYTES**" con archivo:referencia
(`app/(auth)/signup/page.tsx:25`, ERROR_COPY), diagnóstico correcto
(impreciso justo en los casos multibyte que lo disparan) y destino
(pasada de copy T5 o próximo touch de la página). Sin cambio de código —
conforme a la regla del protocolo: minors no bloqueantes van al ledger,
nunca al diff. CORRECTO.

### H3 (aritmética del report) — **RESUELTO como registro fiel**

Verificado en `.superpowers/sdd/t2-tanda-a-report.md:296-300`: bloque
"## Erratum post-review (2026-08-03)" APPENDEADO al final, cuerpo original
intacto (el report original terminaba en la línea 295; nada editado
arriba). La corrección es aritméticamente exacta: 18 en los 3 archivos
nuevos (10 + 4 + 4) + 4 en `signup.test.ts` = 22 total; delta 424→446
cierra. CORRECTO.

### Chequeo (b) — config de session intacta tras el fix de comentario

`git diff auth.ts` verificado: la línea de config es EXACTAMENTE
`session: { strategy: 'jwt', maxAge: 86400, updateAge: 3600 }` — idéntica
al pin del brief §2.5. El único cambio del fix pass es texto de comentario
(no evaluado en este carril; su hallazgo asociado vive en el ledger como
[DECISIÓN PENDIENTE DE MICHAEL], fuera de mi lente). El resto del diff de
`auth.ts` (DUMMY_BCRYPT_HASH + dummy compare en ambos miss paths) quedó
sin cambios respecto de lo ya revisado. COMPLIANCE INTACTA.

### Veredicto final del carril spec compliance

**PASS** — los 3 minors quedan resueltos como registro fiel en
ledger/erratum (que era su resolución correcta bajo el protocolo: ninguno
pedía cambio de código), la config §2.5 sigue exacta, y no hay hallazgos
nuevos. Sin objeciones. Nota para el gate (no objeción): el cierre real de
H1 sigue siendo un pendiente OPERATIVO de Michael (primer `pnpm dev` con
browser), correctamente registrado como tal.
