# T4 — ROBUSTEZ / OBSERVABILIDAD — reporte del implementer

> Fecha: 2026-08-14. Branch `feat/hardening-t4` @ `a056d18` (verificado al
> inicio y al cierre — HEAD no cambió durante el task; verificación (c) del
> prompt: los greps de §1 del brief se re-validaron leyendo cada archivo
> completo antes de tocarlo; UN drift encontrado — ver §"Drift
> brief→realidad" abajo). Estado: **GREEN
> con árbol sucio** — cero git (no add / no commit / no push).

## Resumen

- `lib/route-errors.ts` NUEVO: `withRouteErrors()` + `logRouteError()` (JSON
  de una línea, precedente `logFailOpen` de T2; regla `omitMessage` escrita
  en el helper; sin clientId en la línea del wrapper; sin AsyncLocalStorage).
- 23/24 rutas envueltas. `auth/[...nextauth]` queda SIN wrap por resultado
  de la verificación empírica OQ-1 (nada escapa de NextAuth — ver §OQ-1),
  con comment + evidencia, tal como el brief lo condiciona.
- `core/normalizer/errors.ts` NUEVO (`ServiceError` + 6 códigos); los 8
  `throw new Error` de `resolve.ts` migrados; substring-matching de
  `mappings/route.ts` reemplazado por branch tipado CONSERVANDO `throw e`
  (E1).
- Guard de body no-objeto replicado en las 6 rutas/verbos de R1.
- P2003 → 404 `PRODUCT_NOT_FOUND` en price-overrides PUT (R2, sin fricción).
- 3 boundaries nuevos (`app/not-found.tsx`, `app/error.tsx`,
  `app/global-error.tsx`), copy en tuteo mexicano, global-error autocontenido
  en estilos.
- 5 logs ad-hoc migrados a `logRouteError` (OQ-4); `[ai-chat]`/`[ai-tools]`
  intactos (política de no-payload conservada).
- Comment del quota lookup del chat actualizado (§4.7). Nada más del chat
  tocado.
- **Suite: 510 tests / 53 archivos, TODOS verdes** (baseline 479/49 → +31
  tests, +4 archivos, cero regresiones). `pnpm typecheck` limpio.
  `pnpm build` limpio.

## 1. Tabla E6 — 24 rutas

| # | Ruta | Clase | Wrapped | Guard body agregado | Log migrado |
|---|------|-------|---------|---------------------|-------------|
| 1 | `ai/chat` | a | sí | no¹ | no² |
| 2 | `auth/[...nextauth]` | especial | **no³** | n/a (NextAuth parsea) | n/a³ |
| 3 | `auth/signup` | a | sí | no⁴ | **sí** |
| 4 | `clients` | c | sí | n/a (GET sin body) | n/a⁵ |
| 5 | `csp-report` | a | sí⁶ | n/a (parse leniente propio) | no⁶ |
| 6 | `dashboard/kpis` | c | sí | n/a (GET) | n/a⁵ |
| 7 | `dashboard/onetable` | c | sí | n/a (GET) | n/a⁵ |
| 8 | `dashboard/periods` | c | sí | n/a (GET) | n/a⁵ |
| 9 | `data/reset` | a | sí | n/a (POST sin body) | **sí** |
| 10 | `data/upload` | b | sí | n/a (multipart, no JSON) | no⁷ |
| 11 | `forecast` | c | sí | n/a (GET) | n/a⁵ |
| 12 | `health` | a | sí⁸ | n/a (GET) | n/a⁵ |
| 13 | `parametros/export` | c | sí | n/a (GET) | n/a⁵ |
| 14 | `parametros/import` | a | sí | n/a (multipart) | **sí** |
| 15 | `parametros/skus` | b | sí | no⁴ | **sí** (POST) |
| 16 | `parametros/skus/[id]` | b | sí | no⁴ | **sí** (PATCH) |
| 17 | `parametros/thresholds` | b | sí | **sí** (PUT) | n/a⁵ |
| 18 | `portales/conflicts` | b | sí | **sí** (POST) | n/a⁵ |
| 19 | `portales/counts` | c | sí | n/a (GET) | n/a⁵ |
| 20 | `portales/credentials` | b | sí | **sí** (PUT) | n/a⁵ |
| 21 | `portales/mappings` | b | sí | **sí** (POST, DELETE, PATCH) | n/a⁵ |
| 22 | `portales/mappings/suggestions` | c | sí | n/a (GET) | n/a⁵ |
| 23 | `portales/price-overrides` | b | sí | ya existía (es el patrón fuente) | n/a⁵ |
| 24 | `uploads` | c | sí | n/a (GET) | n/a⁵ |

**Notas al pie:**

1. El chat ya tenía guard equivalente (`route.ts:203-213`: `typeof body ===
   'object' && body !== null` + check de `messages` array) — no está en la
   lista R1 de 6 y no se duplicó.
2. `[ai-chat]` (validación, `:240`) conserva su política deliberada de
   solo-error-name (nunca payload) — el brief la preserva explícitamente.
   El throw del quota lookup ahora cae al wrapper (deuda T3 cerrada, §4.7).
3. OQ-1: verificación empírica concluyó que NADA escapa del handler de
   NextAuth (ver §OQ-1 abajo) → según la decisión cerrada del brief ("si
   nada escapa, sin wrap + comment + evidencia"), queda sin wrap con comment
   en `app/api/auth/[...nextauth]/route.ts` apuntando a este reporte. Sus
   errores fluyen por el logger propio de NextAuth (`[auth][error]`), no por
   `source:'api'`.
4. Fuera de la lista R1 (el brief fija LAS 6: mappings ×3, credentials PUT,
   conflicts POST, thresholds PUT). Observación para el ledger (no
   implementada — sería scope drift): `auth/signup` (`body.email` sobre
   `null`) y `parametros/skus` POST / `skus/[id]` PATCH (`'key' in body`
   sobre `null`/primitivos) también aceptan JSON válido no-objeto que
   dispara TypeError; post-T4 ese path ya NO es 500 crudo sino 500 INTERNAL
   JSON + log del wrapper (piso cubierto), pero el 400 fino requeriría
   extender R1. Decisión para Michael/ledger.
5. Esa ruta no tenía log ad-hoc en error paths (el inventario de 5 del brief
   §1.6 es exhaustivo: signup, data-reset, parametros/skus,
   parametros/skus/[id], parametros/import — los 5 migrados).
6. `csp-report` conserva su log estructurado PROPIO (`source:'csp-report'`,
   `console.warn`) — es el sink de reportes, no un error path. Contrato "204
   siempre" intacto (suite verde sin tocar asserts).
7. `data/upload`: la mecánica per-file (catch que persiste FAILED,
   `:320-333`) es NO-TOCAR y no es un log de ruta — persiste en el Upload
   row. El wrapper cubre lo que escapa de ella (p.ej. `findMany:178` /
   `upload.create:264` fuera de try).
8. En `health` el wrapper es código muerto por diseño (try/catch interno +
   503 semántico) — exactamente lo que el invariante 24/24 pide; contrato
   200/503 intacto (suite verde sin tocar asserts).

## 2. Evidencia OQ-1 — nextauth (verificación (a) del prompt)

Procedimiento (dev server local, edición temporal en `auth.ts` REVERTIDA —
verificable: `auth.ts` no aparece en `git status`):

1. `throw new Error('T4-OQ1-PROBE: forced throw in authorize')` como primera
   línea de `authorize()`.
2. `pnpm dev` + flujo real de callback con CSRF:
   `GET /api/auth/csrf` (cookie + token) →
   `POST /api/auth/callback/credentials` (form-urlencoded con csrfToken).

Resultado observado (next-auth `5.0.0-beta.32` / `@auth/core 0.41.3`):

- **Respuesta HTTP: `302 Found`**, `location:
  http://localhost:3000/api/auth/error?error=Configuration`, **body VACÍO
  (0 bytes)** — ni stack, ni 500, ni JSON.
- **Server log:** `[auth][error] CallbackRouteError: ...` +
  `[auth][cause]: Error: T4-OQ1-PROBE: forced throw in authorize` — emitido
  por el logger interno de `@auth/core` (su `Auth()` envuelve el pipeline
  completo en su propio try/catch).

Conclusión: el throw NUNCA escapa del handler — un `withRouteErrors` ahí
sería código inalcanzable y sugeriría (falsamente) que los errores de auth
fluyen por `source:'api'`. **Decisión: sin wrap**, comment con la evidencia
en la ruta (condición del brief cumplida). Nota: la evidencia histórica del
ledger ("stack trace crudo en `/api/auth/callback/credentials` en prod", B4)
no se reprodujo con el stack actual — ese comportamiento es previo al rework
de auth de T2.

## 3. Evidencia global-error en prod mode (verificación (b) del prompt)

Procedimiento (edición temporal en `app/layout.tsx` REVERTIDA — no aparece
en `git status`): throw condicionado a env var runtime-only
(`T4_GLOBAL_ERROR_PROBE=1`, unset durante build para no romper prerenders) →
`pnpm build` → `T4_GLOBAL_ERROR_PROBE=1 pnpm start`.

Resultados observados:

- `GET /` → **HTTP 500** con el shell `<html id="__next_error__">` que carga
  `/_next/static/chunks/app/global-error-77d2aa3b9c0fa1e8.js` — Next 14
  monta `global-error` CLIENT-side sobre ese shell (comportamiento estándar
  del App Router para throws del root layout).
- **Header CSP capturado en la misma respuesta (ENFORCED — local `pnpm
  start` resuelve env `development`):** `style-src 'self' 'unsafe-inline'`
  presente (además `script-src 'self' 'unsafe-inline' 'unsafe-eval'`,
  `default-src 'self'`).
- **Chunk buildeado verificado:** contiene el componente compilado — copy
  ("Intentar de nuevo", "Referencia:", "Algo salió mal" con unicode
  escapado) y los estilos inline (`backgroundColor:"hsl(240 10% 4%)"` etc.),
  y CERO URLs externas. Todo recurso del documento viene de `'self'` y todo
  estilo es atributo inline → permitido por `style-src 'unsafe-inline'`
  (incondicional en `lib/security-headers.ts:88`, re-verificado): **cero
  violations posibles bajo esta policy**.
- **Server matado y verificado:** `pkill next start` + kill del
  `next-server` residual; `ps aux | grep -E "next start|next-server|next
  dev"` → vacío al cierre. Cero shells de background vivas.

**Residual declarado:** el check de console EN BROWSER real no se pudo
correr desde esta sesión (extensión Claude-in-Chrome no conectada). La
evidencia anterior (policy + contenido exacto del chunk + shell 500) cierra
el caso analíticamente sobre artefactos reales de build; la confirmación
visual en DOM queda cubierta por el smoke de Michael (§9 del brief ya lo
prevé: "console del browser sin violations CSP en todo el smoke", E3c).

## 4. Desviaciones declaradas respecto al brief

1. **Sentinel `DYNAMIC_SERVER_USAGE` re-lanzado por el wrapper** (no estaba
   en el brief; E4 solo cubría NEXT_REDIRECT/NEXT_NOT_FOUND como nota
   defensiva no implementada). Hallazgo empírico durante `pnpm build`: la
   optimización estática de Next invoca los handlers GET; `auth()` (vía
   `headers()`) lanza `DynamicServerError` (digest `DYNAMIC_SERVER_USAGE`) —
   es la señal INTERNA de Next para marcar la ruta como dynamic (ƒ). Sin el
   re-throw, el wrapper la capturaba y emitía una línea `source:'api'`
   ESPURIA por cada ruta GET en cada build (verificado: 7+ líneas por
   build; con el fix: 0, y las rutas siguen marcadas ƒ). Implementado como
   check por digest + unit test + comment con la justificación. NO se
   implementó el par NEXT_REDIRECT/NEXT_NOT_FOUND (sigue siendo código
   muerto — solo documentado, como pide E4).
2. **`auth/[...nextauth]` sin wrap** — no es desviación sino la rama
   prevista por OQ-1 ante la evidencia (§2); se lista por transparencia del
   invariante: 23/24 wrapped + 1 excepción documentada con evidencia.
3. **Test E1 en archivo propio** (`tests/api/mappings-e1-rethrow.test.ts`
   con `vi.mock` del módulo de servicio) en lugar de dentro de
   `portales-mappings.test.ts`: forzar el throw genérico vía spy sobre el
   PrismaClient compartido corrompe `$transaction` al restaurar el spy
   (verificado empíricamente: `db.$transaction is not a function` en todos
   los PATCH posteriores del archivo). El caso E1 del test plan se cubre
   igual (non-ServiceError → rethrow → wrapper 500 + log), más dos casos
   extra (código ServiceError sin mapeo → 500; código mapeado → 404 sin
   log).
4. **Mock de `@/auth` agregado a `tests/api/health.test.ts` y
   `tests/api/csp-report.test.ts`**: el wrap hace que esas rutas importen
   `lib/route-errors` → `lib/auth-helpers` → `@/auth` → next-auth →
   `next/server`, irresoluble bajo vitest (misma razón por la que TODOS los
   demás tests de api ya lo mockean). Asserts y contratos intactos — solo
   el preámbulo estándar de mock.
5. **`omitMessage` omite también `stack`** (el brief solo menciona
   `message`): los stacks de V8 embeben el message en su primera línea —
   omitir uno sin el otro anularía la regla. Documentado en el helper y
   testeado.
6. **P2003 en price-overrides**: el catch envuelve solo el `upsert` (`:141`)
   y no el `deleteMany` (`:135`) — borrar filas de override no puede violar
   la FK de `productId` (peor caso: 0 filas borradas). Comment en el código.
   R2 entró sin fricción — el piso alternativo no fue necesario.

## Drift brief→realidad (S-1 del carril spec)

El brief v2 §1.11 afirmaba que `tests/api/portales-mappings.test.ts`
simulaba los throws del servicio con mocks `new Error('...')` conteniendo
los substrings, y que esos mocks debían migrar a `ServiceError`. La
realidad del archivo es otra: es un test de INTEGRACIÓN — induce los
throws con filas CONFLICTED reales en la dev DB y el servicio REAL
(`core/normalizer/resolve.ts`), que ahora lanza `ServiceError`
naturalmente. No había mocks que migrar, y los asserts 409/404 quedaron
válidos por construcción (el servicio real emite la clase nueva y la
ruta la mapea por `instanceof` + code). El brief commiteado queda FROZEN
(regla del proyecto); esta corrección viaja acá y en el ledger (sección
"T4 — minors de la doble review", ítem S-1).

## 5. Suite / typecheck / build

- **`pnpm test`: 53 archivos / 510 tests — TODOS passing** (corrida final
  completa, un solo proceso, dev DB con guard T1; cero procesos huérfanos
  antes y después). Baseline 479/49 → +31/+4:
  `tests/lib/route-errors.test.ts` (11), `tests/api/body-guards.test.ts`
  (12), `tests/api/route-errors-sweep.test.ts` (2, clase b + clase c),
  `tests/api/mappings-e1-rethrow.test.ts` (3),
  `portales-price-overrides.test.ts` (+2: P2003→404, otro P-code→500),
  `chat-route.test.ts` (+1: quota lookup throw → 500 INTERNAL).
- **`pnpm typecheck`**: limpio (0 errores).
- **`pnpm build`**: ✓ Compiled successfully; 32 páginas generadas; las 24
  rutas api marcadas ƒ (Dynamic); **0 líneas `source:'api'` espurias** en el
  build final (ver desviación #1).

## 6. Verificación supply-chain post-task

```
./scripts/check-supply-chain.sh
→ ✅ Clean — no infection markers detected

grep -E '"[\^~]' package.json → sin hits → ✅ pins exact

grep -E "tanstack|squawk|uipath|mistral|cap-js|intercom-client|router_init|setup\.mjs|router_runtime" pnpm-lock.yaml | grep -v lightningcss
→ sin hits → ✅ lockfile clean
```

**Cero dependencias nuevas** (como exige el brief). Cero installs.

## 7. Archivos (de `git status` al cierre, no de memoria)

**Nuevos (9):**
- `lib/route-errors.ts`
- `core/normalizer/errors.ts`
- `app/error.tsx`
- `app/global-error.tsx`
- `app/not-found.tsx`
- `tests/lib/route-errors.test.ts`
- `tests/api/body-guards.test.ts`
- `tests/api/mappings-e1-rethrow.test.ts`
- `tests/api/route-errors-sweep.test.ts`

**Modificados (30):**
- `core/normalizer/resolve.ts` (8 throws → ServiceError)
- Las 24 `app/api/**/route.ts` (23 wrap + guards + logs + P2003 + comment
  del chat; `auth/[...nextauth]/route.ts` = comment OQ-1 sin wrap)
- `tests/ai/chat-route.test.ts`, `tests/api/csp-report.test.ts`,
  `tests/api/health.test.ts`, `tests/api/portales-mappings.test.ts`,
  `tests/api/portales-price-overrides.test.ts`

**Revertidos (no aparecen en status):** `auth.ts` (probe OQ-1),
`app/layout.tsx` (probe global-error). Scratch de render eliminado.
