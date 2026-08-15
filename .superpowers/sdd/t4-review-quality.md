# T4 — Review CODE QUALITY (carril ciego)

> Reviewer: carril quality. Fecha: 2026-08-14. Branch `feat/hardening-t4` @
> HEAD `a056d18`, working tree sucio (implementación sin commitear). Review
> ESTÁTICA: lectura del diff (`.superpowers/sdd/t4-working-diff.txt`), de los
> 9 archivos nuevos, del reporte del implementer, y greps puntuales de
> verificación (node_modules de Next, schema de Prisma, rutas). Cero git,
> cero ediciones, cero suite/build/typecheck (regla dura respetada).

## Veredicto: **APPROVE WITH MINORS**

Cero hallazgos MAJOR. El diseño central es sólido: el wrapper preserva la
firma genérica de los handlers (incluye `[id]` con params dinámicos, y el
rest-param captura el Request real aún cuando el handler tipado no lo
declara, así que `method` se loguea igual en GETs sin args), el passthrough
de Responses devueltas no loguea, el rethrow del sentinel
`DYNAMIC_SERVER_USAGE` coincide EXACTAMENTE con el check interno de Next
14.2.35 (`isDynamicServerError` en
`node_modules/next/dist/client/components/hooks-server-context.js:23-35`
matchea por el mismo digest string — verificado), y la afirmación "cero
`redirect()`/`notFound()` en app/api" se re-verificó con grep (cero hits).
El P2003→404 no puede producir falso 404 por otra FK: `ProductPriceOverride`
tiene UNA sola FK (`productId`, `prisma/schema.prisma:101-112`; `chain` es
enum). Las justificaciones técnicas del reporte que evalué se sostienen
(ver §Justificaciones). Los MINORS van al ledger.

---

## Hallazgos

### Q-1 (MINOR) — Regresión de semántica en race de doble-DELETE/PATCH de mappings: P2025 pasó de 404 a 500

**Evidencia:** `core/normalizer/resolve.ts:272`
(`tx.productMapping.delete({ where: { id: existing.id } })`) y `:360`
(`tx.productMapping.update(...)` en retarget); catch tipado en
`app/api/portales/mappings/route.ts:88-96` (DELETE) y `:134-146` (PATCH).

**Escenario concreto:** dos DELETE del mismo mapeo en paralelo (doble click
en la UI de Portales). Ambas transacciones pasan el `findFirst` (read
committed: los reads no bloquean), T1 borra y commitea, el `delete` de T2
encuentra 0 filas → Prisma lanza **P2025**, cuyo message es "An operation
failed because it depends on one or more records that were required but not
found." Pre-T4, `msg.includes('not found')` capturaba (accidentalmente) ese
message → **404 MAPPING_NOT_FOUND** (semánticamente correcto: el mapeo ya no
existe). Post-T4, P2025 no es ServiceError → rethrow → **500 INTERNAL** +
línea `source:'api'`. Mismo escenario para PATCH (retarget concurrente con
un delete). No bloquea: la ventana es angosta, el estado final de la DB es
correcto, y el 500 ahora al menos deja log — pero es un cambio de contrato
observable que el "CONSERVANDO throw e" del diseño no conserva. Fix barato
si se quiere: mapear `Prisma.PrismaClientKnownRequestError` + `P2025` → 404
en esos dos catches.

### Q-2 (MINOR) — `app/error.tsx`: `reset()` a secas probablemente no recupera errores de server components — justo el caso dominante declarado

**Evidencia:** `app/error.tsx:38` (`<Button onClick={reset}>`); el header
del archivo (`:4-7`) declara como caso dominante el throw del dashboard
layout (DB read server-side).

**Escenario concreto:** DB caída → el layout del dashboard lanza en el
server → boundary montado. La DB vuelve. El usuario aprieta "Intentar de
nuevo": `reset()` solo re-renderiza client-side el subtree del boundary —
NO dispara un nuevo request RSC, así que no hay payload nuevo del server y
el boundary re-erra de inmediato aunque el server ya esté sano. Es el
comportamiento conocido de App Router en Next 14; la receta documentada para
errores de server es `startTransition(() => { router.refresh(); reset(); })`.
Tal como está, el botón es un no-op para el caso que el propio archivo
nombra como dominante (los errores client-side sí se recuperan). No
bloquea (el boundary cumple su función principal: no más pantalla blanca),
y el smoke de Michael puede confirmarlo o refutarlo en runtime real. Fix:
`useRouter` + refresh+reset en transición.

### Q-3 (MINOR) — `omitMessage` es inalcanzable a través del wrapper: la regla OQ-2 que el propio helper documenta no la ejerce ningún call site de producción

**Evidencia:** `lib/route-errors.ts:51-58` (doc de `omitMessage` nombrando
"chat payloads" como el caso), `:136` (el wrapper SIEMPRE llama
`logRouteError(route, err, { method })` — no hay forma de pasar
`omitMessage` por ruta), `app/api/ai/chat/route.ts:320` (POST del chat
envuelto sin opción de omitir).

**Escenario:** hoy la superficie de throws no-atrapados del chat
post-validación es DB/limiter (sin contenido de usuario — verifiqué el
handler: parse, caps y validación devuelven 4xx internamente), así que NO
hay leak vivo construible; el hallazgo es que la regla escrita en el helper
("routes that handle RAW USER CONTENT pass omitMessage: true") no tiene
mecanismo para cumplirse vía `withRouteErrors` y solo la ejercen los tests.
Si mañana un throw del pipeline del chat embebe contenido del prompt en su
`message` (p.ej. un APICallError del SDK citando el request), el wrapper lo
loguea completo con stack, contra la política T3 del propio archivo. Fix
mínimo: tercer parámetro opcional de `withRouteErrors` con
`Pick<RouteErrorContext,'omitMessage'>` y usarlo en `ai/chat`; o borrar la
promesa del doc-comment para que no documente un contrato que nadie puede
invocar.

### Q-4 (MINOR) — La red externa puede lanzar mientras loguea: `String(err)` sobre un valor exótico rompe la garantía del 500 uniforme

**Evidencia:** `lib/route-errors.ts:92` (`line.message = isError ?
err.message : String(err)`), ejecutado dentro del catch de `:133-138`.

**Escenario:** un handler lanza un valor sin conversión a primitivo —
`throw Object.create(null)` o un objeto cuyo `toString` lanza. `String(err)`
tira TypeError DENTRO del catch del wrapper → la promise del handler
envuelto rechaza → Next devuelve su 500 crudo sin log estructurado — exacto
lo que la red vino a eliminar. Declarado honesto: NINGÚN throw site actual
del repo produce un valor así (por eso MINOR y no MAJOR) — pero esta función
es el último catch del sistema y su contrato es "nunca fallo"; un
`try/catch` de una línea alrededor del cuerpo de `logRouteError` (fallback
`console.error('[route-errors] logging failed')`) lo hace incondicional.
(`JSON.stringify` en sí es seguro aquí: todos los values del objeto son
strings — sin refs circulares posibles.)

### Q-5 (MINOR) — Dos códigos públicos para el mismo semántico: `INTERNAL` (wrapper) vs `INTERNAL_ERROR` (catches internos preexistentes)

**Evidencia:** `lib/route-errors.ts:137` (`errorResponse('INTERNAL', ...)`)
vs `app/api/auth/signup/route.ts:92`, `app/api/data/reset/route.ts` y
`app/api/parametros/skus{,[id]}/route.ts` (todos `INTERNAL_ERROR`).

**Escenario:** un mismo cliente/consumidor (o el agente de triage
post-bloque agrupando por code) ve el error interno de `skus` POST como
`INTERNAL_ERROR` (catch interno) y el de `skus` GET como `INTERNAL`
(wrapper) — dos buckets para una sola condición. Verifiqué con grep que hoy
NINGÚN código client-side branchea sobre ninguno de los dos (cero impacto
funcional actual), por eso MINOR cosmético — pero es una bifurcación de
contrato nueva que T4 introduce y que conviene decidir ahora (unificar en
uno u otro) antes de que algún consumidor la fije.

### Q-6 (MINOR) — El branch `Array.isArray` del guard de body no tiene test: la matriz de body-guards solo cubre `null` y string

**Evidencia:** `tests/api/body-guards.test.ts:39-42` (`CASES` = `'null'` y
`'"soy un string"'`) contra el guard de tres condiciones
(`typeof !== 'object' || null || Array.isArray`) replicado en las 6 rutas.

**Escenario:** una futura "simplificación" del guard que borre el
`Array.isArray` (un array ES `typeof 'object'`) dejaría pasar `[]` hasta el
property access / spread con comportamiento indefinido por ruta — y la suite
seguiría verde: ningún assert lo caza. El branch distintivo del guard (lo
único que el `typeof` no cubre) es exactamente el que quedó sin cobertura.
Fix: agregar `['array body', '[]']` (y opcionalmente `['number body', '5']`)
a `CASES` — 12→18/24 asserts gratis con la matriz existente.

### Q-7 (MINOR) — `lib/route-errors` arrastra `@/auth`/next-auth a rutas que no lo necesitan, por importar `errorResponse` desde `lib/auth-helpers`

**Evidencia:** `lib/route-errors.ts:44` (`import { errorResponse } from
'@/lib/auth-helpers'`); `lib/auth-helpers.ts:15` (`import { auth } from
'@/auth'`); costo ya materializado: `tests/api/health.test.ts:8` y
`tests/api/csp-report.test.ts:12` tuvieron que agregar `vi.mock('@/auth')`
SOLO por esta cadena (los comments de ambos lo dicen explícito).

**Escenario:** `errorResponse` es una función pura de 10 líneas; acoplarla
al módulo que importa la config completa de NextAuth hace que health y
csp-report (rutas sin auth por diseño) carguen next-auth transitivamente en
cada cold start y que TODO test futuro de cualquier módulo que toque
`route-errors` necesite el mock de `@/auth` como peaje. No es bug — es
cohesión: mover `errorResponse`/`ApiError` a un leaf module (p.ej.
`lib/api-errors.ts`, re-export desde auth-helpers para no tocar 20 call
sites) elimina la cadena. Refactor pequeño pero con blast radius de imports;
razonable diferirlo al ledger.

---

## Justificaciones del implementer evaluadas (se sostienen)

1. **Rethrow de `DYNAMIC_SERVER_USAGE` por digest** — correcto para
   14.2.35: el check replica 1:1 el `isDynamicServerError` interno de Next
   (mismo campo, mismo string; verificado en node_modules). Inalcanzable en
   requests reales (las rutas quedan ƒ), así que no puede tragarse un error
   genuino. El unit test (`tests/lib/route-errors.test.ts:119-129`) asserta
   identidad del objeto re-lanzado y cero log. Bien.
2. **`omitMessage` omite también `stack`** — correcto y necesario: la
   primera línea de un stack V8 ES `name: message`; omitir uno sin el otro
   anularía la regla. Testeado (`:161-170`).
3. **Test E1 en archivo propio con `vi.mock` del servicio** — la
   alternativa (spy sobre el proxy de PrismaClient compartido) es
   plausiblemente corrupta al restore (vi.spyOn define own-property sobre un
   proxy cuyo original no es own-property; el restore deja el cliente en
   estado inconsistente), y el archivo incluye el sanity test (caso 3:
   ServiceError mapeado → 404 SIN log) que protege contra over-mocking del
   propio mock. Además importa el módulo REAL de errors para que el
   `instanceof` cruce el mismo class object que usa la ruta — el detalle que
   suele romperse con vi.mock, resuelto bien acá.
4. **P2003 solo en el `upsert`, no en el `deleteMany`** — correcto: borrar
   filas de override no puede violar la FK (peor caso 0 filas), y con una
   sola FK en el modelo el catch no puede producir falso 404 (Q-verificado
   arriba).
5. **Mocks de `@/auth` en health/csp-report** — necesarios dada la cadena de
   imports (aunque la cadena misma es Q-7); los asserts preexistentes de
   ambos archivos quedaron intactos (solo preámbulo agregado — verificado en
   el diff).
6. **nextauth sin wrap** — desde el lente de calidad, wrappear un handler
   del que nada escapa sería código muerto que además documentaría mal el
   flujo real de sus errores; el comment in-situ con la evidencia es la
   forma correcta de fijar la excepción. (Si 23/24 es aceptable como scope
   es juicio del otro carril.)

## Notas de no-hallazgo (chequeados, sin problema)

- Handlers sync/async: todos los handlers son `async`, así que todo throw
  pre-primer-await es rechazo de promise y el `await handler(...)` lo
  captura. Cubierto.
- `instanceof ServiceError` en producción: ruta y servicio importan el mismo
  módulo real — un solo class object, sin riesgo de boundary.
- Rutas migradas muestreadas contra el diff (signup, skus, skus/[id],
  data/reset, parametros/import, thresholds, credentials, conflicts, chat,
  health, csp-report): cero cambios de status/copy/headers, `requireAuth`
  en la misma posición, early returns intactos; los reemplazos de
  `console.error` ad-hoc → `logRouteError` conservan el catch-and-return
  (sin rethrow, sin doble log del wrapper).
- Los códigos ServiceError (6) cubren los 8 throws migrados sin colisión
  (MAPPING_NOT_FOUND y MAPPING_CONFLICTED compartidos entre delete/retarget
  a propósito — mismo mapeo de status en ambos verbos).
- `logRouteError` con stack multilínea: JSON.stringify escapa los `\n` —
  la línea sigue siendo UNA línea. OK.
- Spies de console.error en los tests nuevos: todos con
  `mockImplementation(() => {})` + restore (o `restoreAllMocks` en
  afterEach del sweep); ningún assert previo debilitado en los 5 archivos
  de test modificados (diff: solo preámbulos de mock + tests aditivos + un
  comment).
