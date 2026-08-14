# Brief — T4 ROBUSTEZ / OBSERVABILIDAD (CORTE punto 4 / plan faro §3 T4)

> Estado: v2 — enmiendas del filtro E1-E6 + resoluciones de Michael,
> 2026-08-13. La v1 (mismo día) recibió GO del filtro externo con
> enmiendas; este v2 las fija junto con las resoluciones de Michael que
> cierran las 4 OQs, los 3 riders y la estructura (ver §DECISIONES
> CERRADAS al final). Cero implementación hasta que Michael commitee
> este brief y autorice el dispatch. Verificación empírica corrida
> sobre `feat/hardening-t4` @ `7b42cc4` (árbol limpio; main @ `67d9d91`
> = fix post-gate de caching T3, PR #18); los checks nuevos de E3/E4
> corridos 2026-08-14 sobre el mismo commit.
>
> Protocolo: el prompt del implementer lleva como prefijo literal la
> sección "⚠ Seguridad supply chain — NO NEGOCIABLE" de `CLAUDE.md`. El
> implementer PARA en GREEN con árbol sucio (no git). Doble review CIEGA
> en carriles separados + fix pass + re-review del carril hallador. Gate
> ESTRICTO (toca todas las rutas) + smoke de Michael forzando un error
> en staging (mecanismo DECIDIDO: opción (d), ver §9). Branch:
> `feat/hardening-t4`.

---

## 1. Verificación empírica del estado real (2026-08-13; §1.13-§1.14 del 2026-08-14)

Cada punto verificado contra el repo. Si el dispatch se aleja en el
tiempo, re-correr los greps de este bloque.

1. **`withRouteErrors()` NO existe — es a crear.** Grep de
   `withRouteErrors` en `app/ lib/ core/ components/ tests/` → 0
   resultados. Tampoco existe ningún wrapper equivalente.
2. **Error boundaries: CERO.** `find app -name "error.tsx" -o -name
   "global-error.tsx" -o -name "not-found.tsx" -o -name "loading.tsx"`
   → 0 resultados. Un throw en cualquier página/layout server cae en la
   pantalla default de Next; una URL inexistente cae en el 404 default
   sin estilo. Coincide con el ítem MEDIO del ledger (auditoría
   2026-07-17), sin cambios desde entonces.
3. **Inventario de rutas API: 24 archivos `route.ts`** bajo `app/api/`.
   Re-clasificación FRESCA (la lista clase b/c del ledger es de
   2026-07-17; T2/T3 agregaron `csp-report` y cambiaron `ai/chat` y
   `auth/signup` — line numbers del ledger tienen drift, los de abajo
   son de hoy):

   **Clase (a) — cobertura completa, NO son el gap:**
   - `auth/signup` (catch global `:143`, log `[signup]`).
   - `data/reset` (catch `:55`).
   - `parametros/import` (catch del importer `:63` + catch de formData).
   - `health` (try/catch con timeout de 5s → 503 semántico propio;
     **no tocar su semántica**).
   - `csp-report` (dos try, parse leniente, nunca 500).
   - `ai/chat` — cobertura casi completa por diseño de T3: 400s
     tempranos, stream errors → `'CHAT_ERROR'` (`route.ts:317`).
     EXCEPCIÓN documentada: el `db.client.findUnique` del quota lookup
     (`route.ts:248-251`) y el `consumeRateLimit` (`:261`) corren fuera
     de todo try; el comment `route.ts:244-247` dice literal "If the
     read throws (DB down), it propagates to Next's default 500 —
     accepted behavior... T4's route-error sweep subsumes it". **Este
     sweep DEBE cerrar esa deuda** (es la única pieza del chat que se
     toca).

   **Clase (b) — try/catch parcial (típicamente solo `req.json()`); la
   llamada de DB/servicio queda fuera → 500 crudo:**
   - `data/upload`: `db.productMapping.findMany:178` y
     `db.upload.create:264` fuera de try. El parser/normalize per-file
     SÍ está cubierto (`:277-333`, persiste FAILED en el Upload row) —
     esa mecánica per-file NO se toca.
   - `parametros/skus`: GET `findMany:49` sin try (el POST sí tiene,
     `:110-133`, log `[parametros/skus]`).
   - `parametros/skus/[id]`: DELETE `deleteMany:144` sin try (el PATCH
     sí tiene, `:94-125`).
   - `parametros/thresholds`: GET `getThresholdCuts:40` sin try; PUT
     `upsert:68` fuera del try (que solo cubre el json parse `:50-52`).
   - `portales/conflicts`: GET `findMany:12` sin try; POST
     `findFirst:44`, `findFirst:55` y `resolveConflict:64` fuera del
     try (solo json parse `:31-33`).
   - `portales/credentials`: GET `findMany:9` sin try; PUT `upsert:35`
     fuera del try.
   - `portales/mappings`: GET `findMany:13` sin try; POST
     `findFirst:37` y `assignMapping:40` fuera del try; DELETE
     `findFirst:66` fuera (el servicio sí en try `:71-83`); PATCH
     servicio en try `:105-125` — ambos catch terminan en `throw e`
     (`:83`, `:125`): un throw no matcheado por substring RE-LANZA →
     hoy 500 crudo (post-sweep: ese rethrow alimenta al wrapper, E1).
   - `portales/price-overrides`: GET `findMany:41` sin try; PUT
     `findFirst:126`, `deleteMany:135` y `upsert:141` fuera del try
     (solo json parse `:85-87`). Acá vive el TOCTOU del ledger:
     Product borrado entre el ownership check y el upsert → P2003 →
     500 crudo.

   **Clase (c) — CERO try/catch (todo throw = 500 crudo):**
   `clients` (`findFirst:23`), `dashboard/kpis`, `dashboard/onetable`,
   `dashboard/periods`, `forecast` (`getForecastOverview:27`),
   `parametros/export`, `portales/counts`,
   `portales/mappings/suggestions`, `uploads`. (9 rutas; confirmado
   con `grep -c "try {"` = 0 en cada una.)

   **Caso especial:** `auth/[...nextauth]/route.ts` re-exporta
   `handlers` de NextAuth (6 líneas). Un throw dentro de `authorize`
   (p.ej. `db.user.findUnique`, `auth.ts:127-131`) propaga por el
   handler de NextAuth — es la evidencia registrada del ledger:
   `/api/auth/callback/credentials` devolvió stack trace crudo en prod
   (`docs/handoff/session-b4-followups-end.md:65-67`). Ver §4.6 y
   DECISIONES CERRADAS (OQ-1: SÍ condicionado).
4. **Substring error-matching (ítem del ledger) — 6 sitios, un solo
   archivo:** `app/api/portales/mappings/route.ts:75,78`
   (DELETE) y `:115,118,121,124` (PATCH), matcheando contra los
   mensajes de los throws de `core/normalizer/resolve.ts:249,252,329,
   334,340,349` (`deleteMapping`/`retargetMapping`). `resolve.ts`
   también lanza en `:70` (requeue sin uploadId) y `:193`
   (`resolveConflict` winner no candidato) — hoy sin mapeo en ruta
   (los pre-checks de `conflicts/route.ts:43-62` los anticipan; quedan
   como defensa en profundidad). Grep re-corrible:
   `grep -rn "msg.includes" app/api` y
   `grep -n "throw new Error" core/normalizer/resolve.ts`.
5. **Guard de body no-objeto: solo existe en price-overrides**
   (`price-overrides/route.ts:96`: `typeof body !== 'object' || body
   === null || Array.isArray(body)`). Grep de `typeof body` en
   `app/api` → ese único hit más el del chat
   (`ai/chat/route.ts:204`, forma distinta pero equivalente).
   AUSENTE en: `mappings` POST/DELETE/PATCH, `credentials` PUT,
   `conflicts` POST, `thresholds` PUT — en todos, un body JSON válido
   no-objeto (`null`, string, número) tira TypeError al acceder
   propiedades → 500 crudo. (El ledger listaba mappings POST y
   credentials PUT; la lista real de hoy es más larga. R1 DECIDIDO:
   entran las 6.)
6. **Logging actual en error paths: dos formatos conviven.**
   - JSON estructurado de una línea (precedente a seguir):
     `lib/rate-limit.ts:65-74` (`logFailOpen` — `{source, op, scope,
     outcome, error}` vía `console.error(JSON.stringify(...))`) y
     `csp-report/route.ts:79-86` (`{source, receivedAt, userAgent,
     report}` vía `console.warn`).
   - Ad-hoc `[tag]` + objeto error crudo: `[signup]` (`:143`),
     `[data-reset]` (`:55`), `[parametros/skus]` (`:138`),
     `[parametros/skus/[id]]` (`:129`), `[parametros/import]` (`:63`),
     `[ai-chat]` (`:240`, deliberadamente SOLO el error name — nunca
     el payload, puede llevar contenido de usuario), `[ai-tools]`
     (`core/ai/tools/context.ts:175`, deliberadamente name+code, nunca
     message). Los hooks client-side (`lib/hooks/*`) loguean en el
     browser — fuera de scope de observabilidad server.
   - Ningún log server lleva hoy `clientId`/ruta/método de forma
     sistemática; no hay requestId propio (Vercel agrega el suyo por
     línea de log en runtime logs).
7. **Estilo de la app a replicar en boundaries:** dark-first vía
   `:root` en `app/globals.css:6-27` (tokens shadcn completos:
   `--background 240 10% 4%`, `--primary 142 71% 45%`, `--radius`,
   etc.). Componentes disponibles: `components/ui/` = `button.tsx`,
   `card.tsx`, `confirm-dialog.tsx`, `input.tsx`, `label.tsx`. Root
   layout mínimo (`app/layout.tsx`: html lang="es" > body > Providers)
   — `global-error.tsx` debe replicar ese esqueleto (html/body propios
   por contrato de Next) y ser autocontenido en estilos: el CSS global
   NO se asume presente si el root layout murió (mecánica exacta y
   restricción CSP en §4.6/E3).
8. **Superficie server-side de páginas (para dimensionar boundaries):**
   `app/page.tsx` (server: `auth()` + redirect),
   `app/(dashboard)/layout.tsx` (server: `auth()` +
   `db.client.findFirst:29-32` — ÚNICO acceso a DB en páginas/layouts),
   `app/(dashboard)/portales/page.tsx` y `promotoria/page.tsx` (server
   pero estáticos, sin DB). El resto de páginas son `'use client'`
   (login, signup, analisis, dashboard, parametros) con data fetching
   vía hooks que ya manejan su propio error state. `(auth)/register` y
   `(marketing)` son carpetas `.gitkeep` vacías. Conclusión: el
   throw-surface server real es el layout del dashboard + los redirect
   de `auth()`; `error.tsx` en root cubre ambos. El `findFirst` del
   layout es además el vehículo del smoke (d) de §9: DB caída → throw
   del layout → `error.tsx`.
9. **Q-1/Q-2/Q-3 de T3 (destino "próximo touch de chat-panel.tsx — T4
   o T5"): el scope de T4 NO toca `chat-panel.tsx`.** Verificado: los
   boundaries son archivos nuevos bajo `app/`; el sweep toca
   `app/api/**` + `core/normalizer/resolve.ts` + `lib/`; el único
   cambio del chat es server-side (§1.3). `chat-panel.tsx` no aparece
   en ningún ítem del scope → **Q-1 (400 MESSAGE_TOO_LONG sin manejo),
   Q-2 (copy de reset tras medianoche UTC) y Q-3 (a11y del announcer)
   quedan para T5** (T5 ya toca el archivo por el punto doble del copy
   del 429).
10. **Infra de tests:** Vitest 2.1.8, SIN environment DOM (no jsdom/
    happy-dom/@testing-library en devDependencies — verificado en
    `package.json`; los hits del lockfile son peer-deps opcionales de
    vitest). Los tests de rutas invocan handlers como funciones con
    mocks de `@/lib/db` y `@/auth` (19 archivos en `tests/api/`).
    Baseline de la suite: **479 tests / 49 archivos** (cierre de T3,
    plan faro §3). Implicación: los boundaries NO llevan render tests
    (no hay DOM env y no se agrega dep por esto) — cierre vía
    typecheck + build + smoke de Michael; opcional barato:
    `renderToStaticMarkup` de `react-dom/server` para assert de
    contenido (cero deps nuevas), a criterio del implementer.
11. **Tests existentes acoplados al substring-matching:**
    `tests/api/portales-mappings.test.ts` simula los throws del
    servicio con `new Error('...')` conteniendo los substrings — al
    migrar a error classes (§4.3) esos mocks deben lanzar la clase
    nueva o los casos 409/404 caerían al 500 genérico. El implementer
    los ajusta en el mismo diff (re-grep al ejecutar:
    `grep -n "CONFLICTED\|not found" tests/api/portales-mappings.test.ts`).
12. **Retención de runtime logs en Vercel Hobby: ~1 hora.** Las
    verificaciones de logs estructurados del gate deben hacerse EN
    VIVO (disparar el error y leer Runtime Logs en la misma sesión).
    Los logs estructurados de este task son el PREREQUISITO declarado
    del agente de triage post-bloque (plan faro §2, registro de
    decisiones; Sentry sigue DIFERIDO con sus criterios — no entra).
13. **(E3a, verificado 2026-08-14) CSP y estilos de los boundaries:**
    `lib/security-headers.ts:88` fija `style-src 'self'
    'unsafe-inline'` INCONDICIONAL en todos los entornos (el comment
    `:87` lo justifica: styled-jsx / inline style attributes; solo
    `script-src` varía por entorno, `:74-79`). Es decir: inline styles
    y `<style>` NO generan violations bajo la CSP enforced de preview.
    La restricción E3 de §4.6 queda igualmente escrita por si la CSP
    se endurece: el mecanismo robusto es CSS importado por el propio
    `global-error.tsx`, y la verificación es empírica (build +
    prod-mode local), no de memoria.
14. **(E4, verificado 2026-08-14) `redirect(`/`notFound(` en
    `app/api`: CERO hits** (`grep -rn "redirect(\|notFound(" app/api`
    → vacío). Ninguna ruta API usa los sentinels de Next
    (NEXT_REDIRECT/NEXT_NOT_FOUND), así que el wrapper NO necesita
    re-lanzarlos hoy. Nota defensiva en §4.1 para el futuro.

---

## 2. Parámetros YA DECIDIDOS del corte (no re-abrir)

- **Error boundaries:** `error.tsx`, `global-error.tsx`,
  `not-found.tsx` **con estilo de la app** (tokens/componentes de §1.7;
  copy nuevo en tuteo mexicano desde el inicio — regla es-MX del
  proyecto).
- **Sweep `withRouteErrors()` + error codes/classes en los services en
  UNA SOLA pasada por rutas** — no fixes goteados: las 24 rutas quedan
  uniformes en un solo diff. Invariante 24/24 (E6): TODAS las rutas se
  envuelven, `health` incluida, sin excepción de grep.
- **Logs estructurados con contexto en el error path** — prerequisito
  del agente de triage post-bloque (plan faro, registro de decisiones).
- **Sentry NO entra** (diferido con criterios, ledger "Fuera del
  bloque").
- **Gate ESTRICTO** (toca todas las rutas): diff crudo completo + ambos
  outputs de review a Michael ANTES de commit. Smoke de Michael
  forzando un error en staging (mecanismo (d), §9).
- **Cero dependencias nuevas** (sin pino/winston: `console.*` +
  `JSON.stringify` como el precedente de T2 en `lib/rate-limit.ts`).
  Sin AsyncLocalStorage ni mecanismos de contexto (E2).

---

## 3. Scope de T4 (qué entra — todas las decisiones cerradas)

1. `lib/route-errors.ts` nuevo: `withRouteErrors()` + logger
   estructurado de errores de ruta (§4.1-§4.2).
2. Aplicarlo a las 24 rutas — invariante 24/24, `health` y
   `auth/[...nextauth]` incluidas (nextauth condicionado a la
   verificación empírica de OQ-1, ver DECISIONES CERRADAS). Cierra:
   los 500 crudos de clase b/c, el throw del quota lookup del chat
   (§1.3) y el TOCTOU de price-overrides (§4.4).
3. Error classes con `code` en `core/normalizer/` + reemplazo del
   substring-matching en `mappings/route.ts` conservando el `throw e`
   (§4.3/E1).
4. Guard de body no-objeto replicado en las 6 rutas/verbos de §1.5
   (R1 DECIDIDO: entra completo).
5. Mapeo fino P2003 → 404 en price-overrides PUT (R2 DECIDIDO: entra).
6. Boundaries: `app/error.tsx`, `app/global-error.tsx`,
   `app/not-found.tsx` (§4.6; R3 DECIDIDO: sin boundary de segmento).
7. Unificación de los 5 `console.error` ad-hoc de error paths de rutas
   al formato JSON del helper (OQ-4 DECIDIDA: sí; los dos casos
   deliberadamente minimizados — `[ai-chat]` y `[ai-tools]` —
   conservan su política de no-payload).
8. Tests de todo lo anterior (§6) + TABLA de 24 filas en el reporte
   del implementer (E6, §5).

---

## 4. Diseño propuesto

### 4.1 `withRouteErrors()` — forma y alcance

Wrapper de handler en `lib/route-errors.ts`:

```ts
export function withRouteErrors<A extends unknown[]>(
  route: string,
  handler: (...args: A) => Promise<Response>,
): (...args: A) => Promise<Response> {
  return async (...args) => {
    try {
      return await handler(...args);
    } catch (err) {
      logRouteError(route, err, { method: methodOf(args[0]) });
      return errorResponse('INTERNAL', 'Error interno del servidor', 500);
    }
  };
}
```

- Envuelve el handler COMPLETO (incluye los `req.json()` ya cubiertos —
  los try/catch internos existentes con semántica propia se CONSERVAN:
  el wrapper es la red externa, no reemplaza los mapeos 400/404/409
  finos).
- **Origen de `method` (E2):** `args[0].method` cuando el primer arg
  es un Request (duck-type: `typeof args[0]?.method === 'string'`);
  ausente si no (p.ej. handlers invocados sin Request en tests). Sin
  parsing extra.
- Uso: `export const GET = withRouteErrors('portales/counts', async (req) => {...})`
  o envolviendo la función nombrada existente — el implementer elige la
  forma de MENOR diff, uniforme en todas las rutas.
- Shape del 500: `errorResponse('INTERNAL', ..., 500)` de
  `lib/auth-helpers.ts:27-37` — mismo `{error:{code,message}}` que toda
  la familia. Los hooks client (`use-*.ts`) ya tratan cualquier
  `!res.ok` como error con mensaje genérico → cero cambio client-side
  necesario.
- **Invariante 24/24 (E6, DECIDIDO):** `health` SE ENVUELVE también —
  su try/catch interno + 503 semántico hacen del wrapper código muerto
  ahí, y eso es exactamente lo que lo hace inocuo; el valor es que la
  regla del repo quede sin excepciones de grep ("toda ruta exporta
  handlers envueltos"). `csp-report` ídem (su contrato "204 siempre" lo
  preserva su catch interno; el wrapper es red externa).
- **Sentinels de Next (E4):** verificado CERO usos de
  `redirect()`/`notFound()` en `app/api` (§1.14) — el wrapper no
  necesita tratamiento especial hoy. Nota defensiva en comment del
  helper: si una ruta futura los usa, el wrapper debe re-lanzar los
  errores cuyo `digest` empiece con `NEXT_REDIRECT`/`NEXT_NOT_FOUND`
  (hoy sería código muerto — NO se implementa, solo se documenta).
- `auth/[...nextauth]`: SÍ se envuelve, condicionado a la verificación
  empírica del implementer (DECISIONES CERRADAS, OQ-1): forzar un
  throw en `authorize` en dev y documentar en el reporte QUÉ escapa
  del handler de NextAuth; si nada escapa, queda sin wrap + comment +
  evidencia en el reporte.

### 4.2 Log estructurado del error path

`logRouteError(route, err, ctx?)` en el mismo `lib/route-errors.ts`,
formato de una línea compatible con el precedente `logFailOpen` de T2:

```json
{"source":"api","route":"portales/mappings","method":"DELETE",
 "name":"PrismaClientKnownRequestError","code":"P2003",
 "message":"...","stack":"..."}
```

- Campos: `source:'api'`, `route`, `method` (de `args[0].method`, E2),
  `name` (clase del error), `code` (Prisma P-code o `code` del error
  si existe), `message`, `stack`. Timestamp y requestId los pone
  Vercel por línea — no se duplican.
- **`clientId` (E2): NO va en la línea del wrapper** — en el catch
  externo no está disponible (se resuelve DENTRO del handler vía
  `requireAuth`). `clientId` solo aparece en logs emitidos desde
  dentro de handlers: los 5 sitios ad-hoc migrados (OQ-4) llaman
  `logRouteError(route, err, ctx)` DIRECTO con el contexto que ya
  tienen en mano. **PROHIBIDO AsyncLocalStorage u otro mecanismo de
  contexto para pasarlo al wrapper — cero complejidad nueva.**
- Nivel de detalle (OQ-2 DECIDIDA): `message` + `stack` por default
  (máxima señal para el triage post-bloque; server-only, retención
  ~1h). La regla queda ESCRITA en el helper: rutas que manejen
  contenido de usuario crudo pasan `{ omitMessage: true }`. Las dos
  excepciones existentes se preservan: `[ai-chat]` validación
  (`route.ts:240`, solo error name) y `[ai-tools]`
  (`core/ai/tools/context.ts`, name+code) no cambian su política — se
  alinea el formato solo si es trivial; en duda, quedan como están con
  comment.
- Esto es lo que consumirá el agente de triage post-bloque: formato
  greppeable/parseable por `source`.

### 4.3 Error codes/classes en services (con E1)

Nueva clase en `core/normalizer/errors.ts` (core sigue puro, sin
imports de Next):

```ts
export class ServiceError extends Error {
  constructor(public readonly code: ServiceErrorCode, message: string) { ... }
}
```

- Códigos para los throws HOY matcheados por substring (mínimo):
  `MAPPING_NOT_FOUND`, `MAPPING_CONFLICTED`, `NOOP_RETARGET`,
  `PRODUCT_NOT_FOUND` — reemplazan los `throw new Error(...)` de
  `resolve.ts:249,252,329,334,340,349`. Los throws `:70` y `:193`
  (defensa en profundidad tras pre-checks de ruta) también migran a
  `ServiceError` (códigos propios) para que la familia quede completa —
  su path en ruta sigue siendo el 500 del wrapper (hoy inalcanzables
  salvo race).
- **`mappings/route.ts` DELETE/PATCH (E1 — corrige la v1):** los
  `msg.includes(...)` se reemplazan por un branch tipado y el
  **`throw e` SE CONSERVA**:

  ```ts
  catch (e) {
    if (e instanceof ServiceError) {
      switch (e.code) { /* → return errorResponse(...) con los mismos
        status/copy que hoy */ }
    }
    throw e; // lo no-ServiceError sube al wrapper: 500 JSON + log
  }
  ```

  El rethrow es lo que ALIMENTA al wrapper — eliminarlo dejaría al
  handler resolver `undefined` y Next fallaría FUERA del wrapper, sin
  log ni shape. Lo que este sweep elimina es el COMPORTAMIENTO
  residual de hoy (rethrow → 500 crudo de Next), no la sentencia: el
  mismo `throw e` ahora aterriza en `withRouteErrors` → 500
  `INTERNAL` + línea JSON.
- Los throws de parsers/catalog (`core/parsers/*`,
  `core/catalog/import.ts`, `core/dates/*`) NO migran: ya los
  capturan los catch per-file de upload/import y su mensaje es parte
  del contrato per-file de la UI (idioma de esa familia = decisión T5).

### 4.4 TOCTOU price-overrides PUT (R2 — ENTRA)

Con el wrapper, el P2003 del race pasa de 500 crudo a 500 JSON + log —
ese es el piso. R2 DECIDIDO: entra el mapeo fino — catch local
alrededor del `deleteMany/upsert` (`price-overrides/route.ts:135,141`)
que mapee `PrismaClientKnownRequestError` con `code === 'P2003'` → 404
`PRODUCT_NOT_FOUND` (el Product dejó de existir — mismo contrato que
el ownership check `:126` que perdió la carrera). Paridad con mappings
POST no se persigue (su ventana equivalente termina en `assignMapping`
con FKs distintas); si el implementer encuentra fricción, lo declara y
el P2003 queda en el 500 del wrapper.

### 4.5 Guard de body no-objeto (R1 — ENTRA completo)

Replicar el guard de `price-overrides/route.ts:96` (mismas 3 líneas,
mismo `INVALID_BODY` 400) tras el `req.json()` de LAS SEIS:
`mappings` POST, DELETE y PATCH; `credentials` PUT; `conflicts` POST;
`thresholds` PUT. (El ledger nombraba 2; la verificación encontró 6 —
§1.5. R1 DECIDIDO: entran las 6.)

### 4.6 Error boundaries (con E3)

- **`app/not-found.tsx`** (server component): 404 con estilo de la app
  (tokens §1.7, `Card`/`Button` de `components/ui`), copy en tuteo,
  CTA a `/dashboard` (la raíz `/` redirige por sesión — `app/page.tsx`).
- **`app/error.tsx`** (`'use client'` por contrato de Next): mensaje
  genérico sin detalles técnicos (el `error.digest` puede mostrarse
  como referencia corta), botón "Intentar de nuevo" con `reset()`,
  mismo estilo. Cubre los throws de `(dashboard)/layout.tsx` y de
  cualquier página server (§1.8).
- **`app/global-error.tsx`** (`'use client'`): fallback si muere el
  root layout; debe renderizar `<html lang="es"><body>` propios y ser
  AUTOCONTENIDO en estilos (§1.7 — no asumir que `globals.css` llegó).
- **Restricción CSP (E3):** los tres boundaries NO generan violations
  bajo la CSP enforced de preview. Estado verificado (§1.13):
  `style-src 'self' 'unsafe-inline'` es incondicional en todos los
  entornos → inline styles hoy NO violan. Si el mecanismo elegido
  requiriera algo que `style-src` no permita, el camino robusto es que
  `global-error.tsx` importe su PROPIO archivo CSS (Next bundlea el
  CSS importado por el propio global-error aunque el root layout haya
  muerto) — **verificación empírica del implementer con `pnpm build` +
  prod-mode local (`pnpm start`), no de memoria.**
- Boundary de segmento `(dashboard)/error.tsx` NO entra (R3
  DECIDIDO): las páginas del dashboard son client con error-states
  propios en hooks, y un `error.tsx` de segmento no captura throws de
  SU PROPIO layout (los captura el de root) — el root boundary cubre
  el caso real.
- `loading.tsx` NO entra (no está en el corte).
- Client Components y runtime: los boundaries montan en DOM real →
  regla de smoke completo end-to-end aplica (memoria del proyecto): el
  cierre incluye navegación real, no solo tsc/tests.

### 4.7 Chat: cierre de la deuda documentada + posición sobre Q-4 (E5)

El comment de `ai/chat/route.ts:244-247` se actualiza: el throw del
quota lookup ya no propaga al 500 default sino al wrapper (500 JSON +
log estructurado). Nada más del chat se toca (caching, caps, prompt:
NO-TOCAR — recién gateados en T3).

**Posición sobre Q-4 del ledger (E5):** el pre-check de
`Content-Length` del chat NO entra a T4 aunque el sweep toque
`ai/chat/route.ts` — no es manejo de errores; es de la familia "caps
de recursos", junto con el ítem hermano de `Content-Length` en
upload/import (T2 Tanda B). Queda en el ledger sin cambio de destino.

---

## 5. Estructura del task: TANDA ÚNICA (DECIDIDA, con condición E6)

Diff proyectado: `lib/route-errors.ts` nuevo (~60-80 líneas) +
`core/normalizer/errors.ts` nuevo (~20) + `resolve.ts` (8 throws) +
24 `route.ts` (mecánico: wrap + guards + unificación de logs; ~5-15
líneas c/u) + 3 boundaries nuevos (~40-60 c/u) + tests (~250-350
líneas entre nuevos y ajustes). Es UN solo patrón aplicado en
abanico; el corte además exige "UNA sola pasada por rutas".
**UN implementer, UNA tanda, doble review ciega, fix pass.**

**Condición E6 (DECIDIDA):** el reporte del implementer
(`.superpowers/sdd/t4-report.md`) incluye una TABLA de 24 filas —
columnas: ruta, clase (a/b/c), wrapped sí/no, guard de body agregado
sí/no, log migrado sí/no — como evidencia mecánica del abanico para
ambos carriles de review y para el filtro. Toda celda "no" lleva su
porqué en una nota al pie de la tabla.

---

## 6. Test plan (Vitest contra development, guard T1 activo)

Baseline: **479 tests / 49 archivos**. Sin environment DOM (§1.10) —
los boundaries no llevan render tests obligatorios.

- `lib/route-errors.test.ts` nuevo: passthrough (handler OK → misma
  Response, mismo body); handler que lanza → 500 con shape
  `{error:{code:'INTERNAL'}}`; `console.error` llamado UNA vez con JSON
  parseable que incluye `source:'api'`, `route`, `name` y `method`
  cuando el primer arg es Request (spy + `JSON.parse` del arg); un
  `Response` retornado por el handler (p.ej. el 401 de `requireAuth`)
  NO se loguea ni se transforma; `omitMessage: true` omite `message`.
- Por familia de rutas (muestra representativa, no las 24): mock de
  `@/lib/db` que lanza → 500 `INTERNAL` + log llamado, en al menos una
  clase (b) (`thresholds` PUT o `credentials` PUT) y una clase (c)
  (`dashboard/kpis` o `forecast`). El resto queda cubierto por el
  patrón único + la tabla E6 + review de que el wrap está aplicado.
- `portales-mappings.test.ts`: mocks de throws migrados a
  `ServiceError` (§1.11); asserts existentes de 409/404 intactos; caso
  nuevo: throw NO-ServiceError → el catch interno re-lanza (E1) y el
  wrapper responde 500 `INTERNAL` (antes: 500 crudo de Next).
- Guards de body no-objeto: por cada ruta/verbo de §4.5, body `null` y
  body string → 400 `INVALID_BODY` (hoy: TypeError).
- price-overrides PUT: mock de upsert que lanza P2003 → 404
  `PRODUCT_NOT_FOUND` (§4.4); otro código Prisma → 500 `INTERNAL`.
- chat: throw del `findUnique` del quota → 500 `INTERNAL` shape
  estándar (hoy sin test — el path estaba documentado como aceptado).
- csp-report/health: asserts existentes siguen verdes (sus contratos
  204/503 no cambian; el wrapper es código muerto en health y eso es
  lo esperado).
- Boundaries: typecheck + `pnpm build` (falla ruidoso si `error.tsx`
  no es client component o `global-error` está mal formado); opcional
  `renderToStaticMarkup` (§1.10).

Reglas operativas: avisar a Michael antes de correr la suite (posible
`pnpm dev` activo); cero procesos huérfanos; un solo proceso de test
contra la dev DB.

---

## 7. No-tocar

- `components/analisis/chat-panel.tsx` — **Q-1/Q-2/Q-3 de T3 quedan a
  T5** (§1.9; T4 no toca el archivo, T5 sí por el copy del 429).
- Caps/caching/prompt del chat (`route.ts` de ai/chat más allá de
  §4.7) — recién gateados en T3; el anclaje message-level de caching
  PROHIBIDO reintroducir sin evidencia nueva (ledger §4.6). **Q-4 del
  ledger (pre-check de Content-Length) NO entra (E5, §4.7).**
- Semántica de `health` (503 + timeout) y de `csp-report` (204
  siempre, drop silencioso del limiter) — ambos se ENVUELVEN (24/24)
  sin cambiar su contrato.
- Mecánica per-file de `data/upload` (catch que persiste FAILED,
  `:320-333`) y el IDIOMA de sus errores per-file (decisión T5).
- Throws de `core/parsers/*`, `core/catalog/import.ts`,
  `core/dates/*` (§4.3, contrato per-file).
- `lib/rate-limit.ts`, `middleware.ts` (la deuda del matcher —
  Q-3 de T1 — no se dispara: no se toca el matcher), `auth.ts` salvo
  lo que requiera la verificación empírica de OQ-1, `lib/hooks/*`
  (logs de browser, no server).
- Copy voseo pre-existente (T5): el sweep NO corrige voseo en rutas
  que toca (p.ej. "resolvelo" en mappings `:76,116`, "Resolvé" `:44`)
  — mezclar el barrido acá rompería el corte de T5; el copy NUEVO de
  T4 sí nace en tuteo.
- `scripts/preflight.ts` (LEGACY), vars legacy de Vercel, `.env*`.

---

## 8. Riders — RESUELTOS por Michael (2026-08-13)

1. **Guard de body en las 6 rutas/verbos (R1) — ENTRA completo**
   (§4.5).
2. **Mapeo fino P2003 → 404 en price-overrides PUT (R2) — ENTRA**
   (§4.4; piso alternativo si fricciona: 500 del wrapper, declarado en
   el reporte).
3. **`(dashboard)/error.tsx` de segmento (R3) — NO entra** (§4.6).

---

## 9. Split [CC] / [MICHAEL]

**[CC — código]** `lib/route-errors.ts` + wrap de 24 rutas (invariante
24/24) + `core/normalizer/errors.ts` + migración de throws y del
substring-matching (conservando `throw e`, E1) + guards de body (6) +
mapeo P2003 + 3 boundaries + unificación de 5 logs ad-hoc + tests +
update del comment del chat + verificación empírica del wrap de
nextauth (OQ-1) + TABLA E6 en el reporte. Sin migraciones de schema,
sin deps nuevas, sin config de Vercel — el task es 100% código.

**[MICHAEL — configuración humana]** Smoke sobre la URL de preview del
PR (staging), EN VIVO por la retención ~1h de logs (§1.12), **console
del browser sin violations CSP en todo el smoke (E3c, precedente
T2/T3)**:

- **`not-found`:** navegar a una URL inexistente en el preview normal
  → 404 con estilo de la app.
- **`error.tsx` + 500 JSON + log del wrapper — mecanismo (d),
  DECIDIDO:** Michael rompe temporalmente `DATABASE_URL` del scope
  Preview en Vercel (string bien formado con credenciales inválidas;
  Prisma conecta lazy → falla en la primera query, no en boot) +
  redeploy. Con sesión YA INICIADA (ver caveat), navegar al dashboard:
  el `findFirst` del layout (§1.8) lanza → `error.tsx` con estilo de
  la app; pegarle a una ruta API (p.ej. refetch de portales) →
  respuesta 500 `{error:{code:'INTERNAL'}}` y la línea JSON
  (`source:'api'`, route, name/code) visible en Runtime Logs
  INMEDIATAMENTE después. DB caída = la clase de falla dominante,
  ejercitada en infra real, CERO commits de código, sin revert.
  Restaurar la var + redeploy → smoke normal del gate.
  **Caveats:** la var de Preview es COMPARTIDA entre branches
  (ventana corta, avisar si hay otra preview activa); el login falla
  mientras dure (authorize hace DB) — iniciar sesión ANTES de romper
  la var. **Fallback si (d) fricciona:** opción (a) de la v1 — commit
  temporal con throw detrás de query param, smoke, revert, re-smoke
  corto de la preview final.
- **`global-error.tsx`:** NO alcanzable ni por (a) ni por (d) en infra
  real → verificación LOCAL en prod mode ([CC] la corre y la documenta
  con evidencia en el reporte: `pnpm build` + `pnpm start` con throw
  temporal NO commiteado en el root layout) + el gate de build.
- **Smoke e2e del flow normal** (login → dashboard → portales → chat)
  sobre la preview restaurada: el sweep tocó todas las rutas; regla de
  smoke completo aplica.
- Merge del PR (solo Michael).

---

## 10. Gate

ESTRICTO (toca todas las rutas): diff crudo completo + ambos outputs
de review a Michael ANTES de commit. Cierre del gate = smoke de
Michael sobre preview (§9, mecanismo (d), console sin violations CSP)
con verificación de logs EN VIVO. Los minors no bloqueantes de la
doble review van al ledger (`git add -f`) en el mismo commit.

---

## DECISIONES CERRADAS (Michael vía filtro externo, 2026-08-13)

Reemplaza la sección OPEN QUESTIONS de la v1 — nada queda abierto:

1. **OQ-1 → SÍ, condicionado:** los handlers de NextAuth se envuelven,
   sujeto a verificación empírica del implementer — forzar un throw en
   `authorize` en dev y documentar en el reporte QUÉ escapa del
   handler de NextAuth; si nada escapa, sin wrap + comment + evidencia
   (§4.1).
2. **OQ-2 → message + stack por default**, con la regla `omitMessage`
   escrita en el helper y las excepciones `[ai-chat]`/`[ai-tools]`
   preservadas (§4.2).
3. **OQ-3 → mecanismo (d), nuevo (reemplaza a la (a) de la v1 como
   recomendada):** romper temporalmente `DATABASE_URL` del scope
   Preview + redeploy — ejercita `error.tsx` y el 500 JSON + log del
   wrapper en infra real con cero commits; caveats documentados
   (var compartida, login caído durante la ventana, sesión previa);
   `global-error.tsx` vía prod-mode local + gate de build; not-found
   vía URL inexistente; (a) queda como fallback (§9).
4. **OQ-4 → SÍ:** los 5 logs ad-hoc de error paths de rutas migran al
   helper JSON en el mismo diff (§4.2).
5. **Riders:** R1 ENTRA completo (6 rutas/verbos), R2 ENTRA, R3 NO
   entra (§8).
6. **Estructura → TANDA ÚNICA** con la tabla de 24 filas de E6 en el
   reporte del implementer como condición (§5).
7. **Enmiendas E1-E6 aplicadas** en §4.3, §4.1/§4.2, §1.13+§4.6+§9,
   §1.14+§4.1, §4.7 y §5+§4.1 respectivamente.
