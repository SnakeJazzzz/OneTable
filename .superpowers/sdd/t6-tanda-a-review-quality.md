# Review QUALITY — T6 Tanda A (zod jitless / CSP eval fix)

Reviewer: carril code quality. Branch `feat/hardening-t6`, working tree
sucio. Alcance: `lib/zod-jitless.ts` (nuevo), `components/analisis/
chat-panel.tsx` (import + comment guard), `tests/lib/zod-jitless.test.ts`
(nuevo). Fecha: 2026-08-17.

## Veredicto: APPROVE WITH MINORS

Cero MAJOR. El mecanismo del fix es correcto y está verificado contra el
source instalado; los hallazgos son de precisión de comments y de riesgo
de regresión futura silenciosa, ninguno bloquea el commit.

## Verificación empírica del mecanismo (base del veredicto)

Todo re-corrible; paths absolutos bajo
`/Users/michaelthemac/Desktop/Projectos/One_Table_father/OneTable/`.

- **Probe y gate reales.** `node_modules/zod/v4/core/util.js:150-161`:
  `allowsEval = cached(() => { ... new F("") ... })` — getter LAZY
  (`util.js:28-40`, `Object.defineProperty` en primer acceso). Único
  consumidor de `.value` en todo zod:
  `node_modules/zod/v4/core/schemas.js:903`
  (`const fastEnabled = jit && allowsEval.value`), con
  `const jit = !core.globalConfig.jitless` en `schemas.js:901`. Con
  `jitless: true`, `jit === false` → short-circuit → el probe
  `new Function("")` jamás se evalúa. El claim central del comment es
  EXACTO, incluidas las líneas 901-918 citadas.
- **Momento de captura = construcción del schema.** Las líneas 901-903
  corren en el init de cada `$ZodObject` (no en cada parse). El comment
  de `lib/zod-jitless.ts:27` ("before any zod schema is constructed or
  parsed") lo refleja correctamente.
- **Una sola instancia de zod en el grafo client.**
  `node_modules/.pnpm` tiene exactamente `zod@4.3.6`.
  `@ai-sdk/provider-utils@4.0.23` (dist ESM) importa `zod/v4` y
  `zod/v3`; el root `zod` (ESM `index.js`) re-exporta
  `./v4/classic/external.js`. Ambos specifiers convergen vía condición
  `import` en el MISMO `v4/core/core.js` (donde vive `globalConfig`,
  `core.js:71-75`) → un solo `globalConfig` en el bundle webpack. El
  hazard dual CJS/ESM no aplica al client (webpack resuelve `import`
  consistente); en vitest ídem (ESM en ambos imports del test).
- **Orden de evaluación client.** Grep exhaustivo de
  `app/ components/ lib/ core/`: el ÚNICO módulo client que arrastra
  zod/ai es `components/analisis/chat-panel.tsx` (los demás matches —
  `app/api/ai/chat/route.ts`, `lib/ai/model.ts`, `core/ai/tools/*` —
  son server-only). Cero `import()` dinámicos en app code. chat-panel
  es el único punto de entrada de zod al client y su primer import es
  `@/lib/zod-jitless` (ESM depth-first ⇒ `z.config` corre antes de que
  `ai`/`@ai-sdk/react` evalúen). El ordering hoy es sólido.
- **Tree-shaking.** `package.json` del repo NO declara `sideEffects` ⇒
  webpack conserva el import side-effect-only de app code. El
  `"sideEffects": false` de zod es irrelevante: `zod-jitless.ts` USA el
  binding `z` (llamada `z.config`), no es import puro. Confirmado en el
  build presente: `grep "jitless:!0"
  .next/static/chunks/app/(dashboard)/analisis/page-4a3ba3845b66558e.js`
  → 1 match.
- **`z.config` no pisa otra config.** `core.js:72-75` hace
  `Object.assign(globalConfig, newConfig)` — solo agrega `jitless`, no
  clobberea `customError`/`localeError` si alguien configura locales.

## Hallazgos

### Q-1 (MINOR) — Protección de un solo punto: regresión futura silenciosa si otro client component importa zod

El fix vive exclusivamente en el primer import de chat-panel. Hoy
alcanza (verificado: ningún otro módulo client importa zod). Pero el
día que cualquier client component nuevo importe zod por una ruta que
no pase por chat-panel — escenario MUY probable en Fase 2.5
(validación de forms de landing/cuentas con zod) — el primer
`z.object()` de ese grafo captura `jit = true` en construcción
(`schemas.js:901`), el probe dispara y la violation CSP vuelve, sin
señal alguna en build/typecheck/tests. La única defensa es un comment
en `lib/zod-jitless.ts` que nadie va a leer al escribir un form nuevo.

La alternativa de hoistear el import a un client component raíz del
layout se descartaría con razón (metería todo zod classic en el bundle
de TODAS las rutas), así que el diseño actual es defendible. Pedido
concreto no bloqueante: registrar el invariante en el ledger
(`.superpowers/sdd/`) como ítem de vigilancia, y opcionalmente un
guard estático barato — p. ej. `no-restricted-imports` de eslint sobre
`zod` en `components/**` con mensaje que apunte al patrón zod-jitless —
para que el import nuevo falle lint en vez de degradar silencioso.

### Q-2 (MINOR) — Comment de `lib/zod-jitless.ts:16-19` afirma una garantía server que el código no provee

"jitless also applies on SSR/server. The chat tools parse without JIT"
— no garantizado. Evidencia: `grep -rn zod-jitless app core lib` →
vacío; `app/api/ai/chat/route.ts:58-72` importa `core/ai/tools` y
`lib/ai/model` pero NUNCA `zod-jitless`. En el server, jitless solo se
setea si el módulo de chat-panel (SSR de /analisis) evaluó ANTES en el
mismo runtime Y sobre la misma instancia de módulo zod — condición
incidental y nondeterminística (en Vercel, la page y el route handler
pueden ni compartir función). Escenario concreto: cold start que
atiende `/api/ai/chat` directo → los chat tools parsean CON JIT,
contradiciendo el comment literal. Funcionalmente benigno (el server
no tiene CSP contra eval; resultados de parse idénticos), pero el
comment promete lo que el código no garantiza. Fix de una línea:
reformular a "applies wherever THIS module evaluates (client bundle +
the SSR pass of /analisis); the chat API route keeps its own default".

### Q-3 (MINOR) — Comment del test sobresstima el alcance del estado global mutado

`tests/lib/zod-jitless.test.ts:9-11` afirma "every test running in
this process after this import sees jitless=true". Con la config real
del repo (`vitest.config.ts`: `fileParallelism: false`, sin `isolate`
override ⇒ default `isolate: true`, `node_modules/vitest/dist/
config.d.ts:32`) cada archivo de test corre con registro de módulos
fresco: la mutación queda confinada al archivo, no al proceso. El
error es en la dirección segura (sobreadvierte), y aunque leakeara
sería benigno, pero un comment que documenta un caveat de estado
global debería describir el aislamiento real. Nit adjunto, mismo
archivo: `z.core.globalConfig.jitless` funciona (namespace `core`
exportado en `v4/classic/external.js:1`, `globalConfig` en
`core.js:71`) pero `z.config().jitless` — el wrapper público sin args
devuelve el mismo objeto (`core.js:72-75`) — es marginalmente más
estable ante reorganizaciones internas de zod. El test no es
tautológico: valida el wiring real (side-effect al importar + alias
`@/`), que es lo que puede romperse en refactors. Suficiente para el
scope; la verificación de comportamiento (ausencia de violation) es
del smoke runtime.

## Afirmaciones del reporte del implementer contrastadas

- Mecanismo del gate y líneas 901-918: CONFIRMADO contra source.
- "el probe ni se evalúa": CONFIRMADO (lazy getter + short-circuit,
  único consumidor).
- Supervivencia en bundle (`jitless:!0` en el chunk de /analisis):
  CONFIRMADO en el `.next` presente.
- "aplica también SSR/server" (decisión sin guard `typeof window`): la
  decisión de no-guard es correcta y simplifica, pero el alcance server
  real es el de Q-2, no el que el comment enuncia.
- Suite/typecheck/build GREEN: no re-corridos (prohibido por
  protocolo); se toma la evidencia del reporte.

## Fix pass Q-2/Q-3 (re-review del carril quality, 2026-08-18)

### Veredicto del fix pass: PASS

Ambos hallazgos resueltos con exactitud técnica; cero cambios en
código ejecutable; cero archivos extra en el working tree.

### Q-2 — RESUELTO EXACTO

El comment reformulado (`lib/zod-jitless.ts:16-20`) ahora dice:
"jitless applies wherever THIS module evaluates — the client bundle
and the SSR pass of /analisis. The chat API route never imports this
module and keeps zod's own default". Verificación empírica de cada
claim:

- **El route del chat NO importa el módulo** (ni directo ni
  transitivo): `app/api/ai/chat/route.ts:58-72` importa `ai`,
  `@/lib/db`, `@/lib/auth-helpers`, `@/lib/route-errors`,
  `@/lib/rate-limit`, `@/lib/thresholds`, `@/lib/ai/model` y
  `@/core/ai/tools` — ninguno es `zod-jitless`. Grep repo-wide de
  `zod-jitless` en `app/ components/ lib/ core/ tests/` → exactamente
  2 importadores: `components/analisis/chat-panel.tsx:29` y
  `tests/lib/zod-jitless.test.ts:5`. Cero rutas transitivas (ningún
  módulo de `lib/` ni `core/` lo menciona).
- **"SSR pass of /analisis" es preciso**: chat-panel es `'use client'`
  (línea 1) e importado solo por
  `app/(dashboard)/analisis/page.tsx:13`; los módulos de client
  components sí evalúan en el pase SSR de esa page, y solo de esa.
- **La decisión de Michael sigue documentada**:
  `lib/zod-jitless.ts:16-17` — "UNCONDITIONAL on purpose (no `typeof
  window` guard — Michael's decision, 2026-08-17)". Intacta, con fecha.

La garantía server falsa ("jitless also applies on SSR/server. The
chat tools parse without JIT") desapareció del archivo (grep → 0
matches).

### Q-3 — RESUELTO EXACTO

El comment del test (`tests/lib/zod-jitless.test.ts:9-12`) ahora
describe el aislamiento real: "the suite runs with fileParallelism:
false + isolate (default true) (vitest.config.ts), so each test file
gets a fresh module registry — the mutation stays confined to THIS
file, not the whole process". Contrastado:

- `vitest.config.ts:27` → `fileParallelism: false`. Cero key `isolate`
  en el archivo (grep → 0) ⇒ aplica el default.
- Default `isolate: true` confirmado en
  `node_modules/vitest/dist/config.d.ts:32` (`configDefaults`).
- Semántica correcta: con `isolate: true` cada archivo de test corre
  en environment/worker fresco ⇒ registro de módulos fresco ⇒ la
  mutación de `globalConfig` muere con el archivo. El claim
  sobredimensionado ("every test running in this process...")
  desapareció (grep → 0 matches).
- El caveat "harmless anyway" (líneas 13-15) se conserva — correcto,
  jitless no cambia resultados de parse.

### Cero cambios ejecutables / cero archivos extra

- `lib/zod-jitless.ts`: las únicas líneas ejecutables siguen siendo
  `import { z } from 'zod';` (línea 31) y
  `z.config({ jitless: true });` (línea 33). Todo lo demás es comment.
- `tests/lib/zod-jitless.test.ts`: estructura intacta — imports de
  vitest/zod (líneas 1-2), side-effect import `@/lib/zod-jitless`
  (línea 5), un solo `describe`/`it`, assert
  `expect(z.core.globalConfig.jitless).toBe(true)` (línea 16). El nit
  del assert (`z.config().jitless` como alternativa) quedó SIN aplicar,
  consistente con la decisión de mandarlo al ledger.
- `git diff components/analisis/chat-panel.tsx`: idéntico a lo ya
  revisado en la tanda (comment de ordering + import side-effect-only,
  líneas 26-29); el fix pass no lo tocó.
- `git status --porcelain` → exactamente `M chat-panel.tsx`,
  `?? lib/zod-jitless.ts`, `?? tests/lib/zod-jitless.test.ts`. Los
  reportes de `.superpowers/sdd/` no aparecen por el gitignore del
  path (esperado; se agregan con `git add -f` al commit).

Hallazgos nuevos: ninguno. Q-1 y el nit del assert quedan en el
ledger como se decidió; no se re-abre la review general.
