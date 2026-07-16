# Brief — B5 (Chatbot IA §9.1) · T1: Tool layer (`core/ai/tools/`)

> Gate: **ESTRICTO** (diff a Michael antes de commit). Cero UI. Cero rutas.
> Este brief va a filtro externo ANTES de cualquier dispatch.
> El prompt del implementer DEBE llevar como prefijo literal la sección
> supply-chain de CLAUDE.md.
>
> Corte del bloque (cerrado): T1 tool layer (este brief) → T2 route
> `/api/ai/chat` (ESTRICTO) → T3 UI panel en Análisis (UI GATE).

Verificación empírica realizada el 2026-07-15 sobre main @ c104f33, working
tree limpio, suite 277/277 al cierre del bloque anterior.

---

## 1. Re-grounding — hallazgos con evidencia

### 1.1 Inventario real de `core/kpis/queries.ts`

8 exports: 7 funciones de data (4 dinero + 3 inventario/alertas) + 1 helper.
Todas reciben `db: PrismaClient` como primer arg y `clientId`/`userId` dentro
del objeto `params` (tipos `BaseParams` / `PeriodParams`, queries.ts:81-82).
Todas son READ-ONLY (`$queryRaw` SELECT; cero mutaciones).

| Función | Firma (params más allá de db) | Devuelve | Extra |
|---|---|---|---|
| `getDefaultPeriod` (queries.ts:96) | `BaseParams` | `{periodYear, periodMonth} \| null` | helper S12.1, período más reciente con ≥2 cadenas |
| `getDashboardKpis` (queries.ts:134) | `PeriodParams`, `cuts: ThresholdCuts` | `DashboardKpis` (4 escalares) | dinero |
| `getSalesTrend` (queries.ts:216) | `BaseParams & {monthsBack: number}` | `ChainSalesPoint[]` | dinero; NO recibe período (ancla al más reciente) |
| `getSalesByChainForPeriod` (queries.ts:267) | `PeriodParams` | `{chain, salesAmountMxn, salesUnits}[]` | dinero |
| `getTopSkusByChain` (queries.ts:430) | `PeriodParams & {limit: number}` | `{chain, productName, salesUnits}[]` | dinero; `limit` ya existe |
| `getInventorySemaforo` (queries.ts:323) | `PeriodParams`, `cuts` | `SkuInventoryStatus[]` | inventario |
| `getOneTableRows` (queries.ts:495) | `PeriodParams`, `cuts` | `OneTableRow[]` (TODAS las rows del período, ~3,188 reales) | inventario; **NO tiene param `limit`** |
| `getDaysOfInventoryBySku` (queries.ts:576) | `PeriodParams` | `{productName, chain, daysOfInventory}[]` | inventario |

`ThresholdCuts` se resuelve con `getThresholdCuts(db, clientId)` de
`lib/thresholds.ts` (patrón verificado en `app/api/dashboard/kpis/route.ts:100`).

Enum `Chain` real (prisma/schema.prisma): `SORIANA, CHEDRAUI, HEB, AL_SUPER,
LA_COMER, AMAZON`. Los `z.enum` de los schemas usan estos literales (o
`Object.values(Chain)` de `@prisma/client` para no duplicar).

### 1.2 Mapeo tool ↔ función (propuesto) y discrepancias vs §9.1.1

Catálogo spec (6): `getDashboardKpis`, `getTopSkusByChain`, `getSalesTrend`,
`getInventorySemaforo`, `getOneTableRows`, `getDaysOfInventoryBySku`.

| Tool | Función | Schema (sin clientId/userId, todos `.strict()`) | Notas |
|---|---|---|---|
| `getDashboardKpis` | idem | `{periodYear?, periodMonth?}` | carga `cuts` en execute |
| `getSalesTrend` | idem | `{monthsBack: int 1..24 default 6}` | sin período by design |
| `getSalesByChainForPeriod` | idem | `{periodYear?, periodMonth?}` | **agregada** — ver D-2 |
| `getTopSkusByChain` | idem | `{periodYear?, periodMonth?, limit: int 1..50 default 20}` | |
| `getInventorySemaforo` | idem | `{periodYear?, periodMonth?}` | carga `cuts` |
| `getOneTableRows` | idem | `{periodYear?, periodMonth?, limit: int 1..50 default 20}` | cap en wrapper — ver D-1 |
| `getDaysOfInventoryBySku` | idem | `{periodYear?, periodMonth?, limit: int 1..50 default 20}` | slice en wrapper |

**Discrepancias encontradas (spec vs código real):**

- **D-1 — `getOneTableRows` no tiene `limit`.** La spec §9.1.1 dice "(con
  `limit` cap 50, default 20)" pero la función real devuelve todas las rows
  del período sin parámetro de corte. Propuesta: el wrapper hace
  `rows.slice(0, limit)` server-side antes de devolver al modelo. El costo de
  DB no cambia (query completa igual), pero el payload al modelo queda capped
  — que es lo que la mitigación de costo persigue. **NO se toca
  `core/kpis/queries.ts` en T1** (agregar LIMIT SQL = blast radius sobre 6
  consumidores del dashboard; si se quiere, es ítem aparte).
- **D-2 — `getSalesByChainForPeriod` existe y no está en el catálogo.** Query
  de dinero directa ("¿cuánto vendí por cadena este mes?"). La spec marca el
  catálogo como "refinables"; propuesta: incluirla como 7ª tool. Costo ~0.
- **D-3 — El modelo no conoce el período vigente.** El catálogo no tiene tool
  de resolución de período y los schemas de la spec lo exigen required — el
  modelo lo adivinaría. Propuesta (recomendada): `periodYear`/`periodMonth`
  **opcionales** en los schemas; si faltan, el execute resuelve con
  `getDefaultPeriod` (mismo default que el dashboard, S12.1). Alternativa
  descartada: exponer `getDefaultPeriod` como tool — quema 1 de los 5 steps
  en casi toda conversación. Si vienen ambos params, se usan tal cual; si
  viene solo uno, el schema lo rechaza (`.refine` de par completo o ambos
  opcionales-juntos).
- **D-4 — Model string del gateway usa PUNTO, no guión.** Verificado hoy
  contra `https://ai-gateway.vercel.sh/v1/models`: el ID real es
  `anthropic/claude-haiku-4.5` (y `anthropic/claude-sonnet-4.6` para el
  escalado que menciona la spec). La spec §9.1.3 escribe
  `'anthropic/claude-haiku-4-5'` con guiones — ese string NO existe en el
  catálogo del gateway. La constante (T2) debe ser
  `'anthropic/claude-haiku-4.5'`. No reabre la decisión de modelo; corrige el
  literal.
- **D-5 — `maxSteps` no existe en AI SDK v6.** Verificado contra los types
  reales de `ai@6.0.168` (unpkg, `dist/index.d.ts`): `streamText` no acepta
  `maxSteps`; el cap es `stopWhen: stepCountIs(5)` (default
  `stepCountIs(1)`). Afecta a T2; queda catalogado acá para que el brief de
  T2 no lo redescubra.
- **D-6 — Firma real de `execute` en el pin propuesto.** `ai@6.0.168`:
  `execute: (input, options: ToolCallOptions)` — cero matches de
  `toolsContext`/`contextSchema` en el `.d.ts` (esa API de context
  primera-clase existe solo en versiones posteriores del SDK; la doc pública
  actual la muestra pero no aplica al pin). Existe `experimental_context` en
  `streamText`, pero es experimental. Conclusión: la **factory
  `buildTools({...})` con closure** (decisión cerrada) no es solo la opción
  preferida — es la única vía estable en el pin. Confirmada.

### 1.3 Scaffold UI de forecasting con estado 'insufficient'

**NO existe.** Evidencia: `grep -rn "insufficient" app/ components/` → 0 hits;
`grep -rln "forecast" app/ components/` → 0 hits. Tampoco existe
`core/forecast/`. La spec §12 lo ubicaba en B3/B4 pero nunca se construyó.
Fuera de scope de T1 (y del bloque chatbot); queda registrado como gap de la
spec vs realidad para que Michael decida dónde cae (¿T3 junto al panel en
Análisis, o hardening-backlog?). Recordatorio cerrado: el chatbot **NO recibe
tool de forecast** (§9.2 = diseño congelado, build 2.5).

### 1.4 zod

**NO está en el proyecto.** Evidencia: 0 matches en `package.json`, no existe
`node_modules/zod/`, `grep -c "zod" pnpm-lock.yaml` → 0 (ni como transitiva).
Hay que instalarlo (ver §3).

### 1.5 Patrón de auth real — drift vs CLAUDE.md/spec

- `lib/tenant.ts` **NO existe** (el dir `lib/` tiene: auth-helpers.ts, db.ts,
  hooks/, portales/, prices.ts, thresholds.ts, utils.ts).
- `getCurrentClient()` **NO existe como código** en el repo. Única mención:
  comment en `app/api/parametros/skus/route.ts:9-13` documentando la
  **DEVIATION #1** — las rutas resuelven `clientId` vía `requireAuth()`
  porque el JWT ya lo trae (NextAuth lo popula al sign-in, aplicando el
  invariante 1-Client ahí).
- Patrón real: `requireAuth()` de `lib/auth-helpers.ts:50` → devuelve
  `{userId, clientId, email}` o un `Response` 401. Ruta de referencia:
  `app/api/dashboard/kpis/route.ts:46-48`. Ese es el patrón que T2 usará para
  armar el context de `buildTools`.
- **Drift de docs a corregir** (decisión de Michael, no de este task):
  CLAUDE.md D3 dice "helper `getCurrentClient(userId)` en `lib/tenant.ts`" —
  claim stale. Candidato a la próxima pasada de depuración de CLAUDE.md.

---

## 2. Diseño T1 (aplica decisiones cerradas — no reabrir)

### 2.1 Estructura de archivos

```
core/ai/tools/
  context.ts          — type ToolContext = { db: PrismaClient; clientId: string; userId: string }
                        + resolver MEMOIZADO de período default (C1): la primera
                        llamada consulta getDefaultPeriod, las siguientes reusan
                        el resultado dentro del mismo context/request; cero
                        consultas si el usuario especificó período en todos los
                        calls. + helpers compartidos (caps)
  get-dashboard-kpis.ts
  get-sales-trend.ts
  get-sales-by-chain.ts
  get-top-skus.ts
  get-inventory-semaforo.ts
  get-onetable-rows.ts
  get-days-of-inventory.ts
  index.ts            — buildTools(ctx: ToolContext): ToolSet
```

- `core/` se mantiene puro: cero imports de Next.js/NextAuth. `db` entra por
  el context (inyectable en tests), igual que en `core/kpis/queries.ts`.
- Un archivo por tool (§9.1.1). Cada archivo exporta el **schema y la
  description a nivel módulo** (const estables → prompt caching: la identidad
  de name/description/schema no varía por request) y una factory
  `makeXTool(ctx)` que solo liga el closure del execute. `buildTools(ctx)`
  las compone en el `ToolSet` que consume T2.

### 2.2 Reglas del wrapper (cerradas)

- Todos los `inputSchema` con `.strict()` — objeto extraño (incl.
  `clientId`/`userId` inyectados por prompt injection) = rechazo, no strip.
- `clientId`/`userId` JAMÁS en el schema. En el execute, spread con context AL
  FINAL: `{ ...args, clientId: ctx.clientId, userId: ctx.userId }` — el
  context gana siempre (defensa en profundidad si la validación fallara).
- Solo wrappers de queries READ-ONLY existentes. Cero mutaciones, cero SQL
  libre, cero queries nuevas.
- `limit` default 20 / max 50 en tools de lista (schema + slice donde la
  función no lo soporte nativo, D-1).
- **Eco del período usado (C1):** toda tool que use período incluye en su
  tool result el período efectivamente usado —
  `{ periodYear, periodMonth, ...data }` — tanto cuando vino provisto en el
  input como cuando se resolvió por default. El modelo siempre sabe sobre qué
  mes está respondiendo.
- Errores: try/catch dentro del execute → tool result
  `{ error: 'TOOL_EXECUTION_ERROR' }` (shape genérico). Nunca message/stack
  de Prisma/Neon al stream. Log server-side permitido (console.error) sin
  payload de data.
- **Sin-data distinguible (C3):** cuando el período debe resolverse por
  default y `getDefaultPeriod` → null (cliente sin data), el tool result es
  `{ error: 'NO_DATA' }` — shape documentado, DISTINTO de
  `TOOL_EXECUTION_ERROR`. No es un fallo de ejecución: es una respuesta
  válida que el modelo puede verbalizar ("todavía no hay datos cargados").
- `cuts`: `getThresholdCuts(db, ctx.clientId)` dentro del execute de las 3
  tools que lo requieren (query barata por-cliente; no vale complicar
  buildTools con prefetch async).

### 2.3 Fuera de scope T1 (catalogado para T2/T3)

- Route `/api/ai/chat`: runtime Node (Prisma no corre en edge), streaming,
  `stopWhen: stepCountIs(5)` (D-5), modelo constante
  `'anthropic/claude-haiku-4.5'` (D-4), historial client-side + cap de
  mensajes server-side, sin persistencia en DB.
- `.env`: `AI_GATEWAY_API_KEY` la agrega Michael a mano (hook
  block-env-writes). T1 no la necesita — los tests no tocan la API.
- UI panel en Análisis (T3, UI GATE) + `@ai-sdk/react`.

---

## 3. Paquetes a instalar (T1)

Regla supply-chain #6: preferir publicación pre-2026-04-29. La línea v6 de
`ai` es estable desde 2025-12-22 (6.0.0), así que **existe pin estable
pre-cutoff — no hace falta excepción**.

**Recomendación (Opción A — pre-cutoff, misma release train):**

| Paquete | Versión exacta | Publicada | Razón |
|---|---|---|---|
| `ai` | `6.0.168` | 2026-04-16 | AI SDK v6 (§9.1.3): `tool()`, `ToolSet`, types. Última v6 pre-cutoff. |
| `zod` | `4.3.6` | 2026-01-22 | inputSchemas. Peer de `ai@6.0.168` = `^3.25.76 \|\| ^4.1.8` → satisfecho. Última zod 4.x estable pre-cutoff. |

- T1 instala SOLO estas dos. `@ai-sdk/react@3.0.170` (2026-04-16, misma
  release train que ai@6.0.168 — su dep interna es exactamente `ai@6.0.168`;
  peer react `^18` OK con react 18.3.1 del proyecto) queda documentada para
  instalarse en T3, no ahora.
- Transitivas que trae `ai@6.0.168` (para el grep post-install del lockfile):
  `@ai-sdk/gateway@3.0.104`, `@ai-sdk/provider@3.0.8`,
  `@ai-sdk/provider-utils@4.0.23`, `@opentelemetry/api@1.9.0`. Ninguna en la
  lista de tokens sospechosos. `engines: node >=18` OK.
- `@ai-sdk/gateway` transitiva = el provider default del gateway: model
  string plano `'anthropic/claude-haiku-4.5'` + `AI_GATEWAY_API_KEY`, sin
  `@ai-sdk/anthropic`.

**Opción B (descartable, para constancia):** última v6 = `6.0.228`
(2026-07-15, hoy). Post-incidente → requeriría flag explícito; ~3 meses de
fixes que T1 no necesita (los cambios gordos son de `useChat`/UI — re-evaluar
recién en T3 si algo lo exige, con flag).

Mitigaciones en el install (literal): `pnpm add --ignore-scripts ai@6.0.168
zod@4.3.6`, pins exactos sin `^~`, `./scripts/check-supply-chain.sh` antes y
después, grep del lockfile contra tokens del worm, jamás borrar
`pnpm-lock.yaml`.

---

## 4. Plan de tests (Vitest, `core/ai/tools/*.test.ts` o `tests/` según convención vigente)

JAMÁS contra la API real (CI no tiene key — decisión cerrada). T1 es tool
layer puro: se testean los `execute` directo con context inyectado + schemas
con `safeParse`. No hace falta mock del language model en T1 (eso es T2).
`db` mockeado (objeto con `$queryRaw` stub) o `vi.mock` del módulo
`core/kpis/queries` con spies — preferido lo segundo: asserts sobre los
params exactos que recibe cada query.

1. **Rechazo `.strict()` de clientId inyectado (cerrado, obligatorio):** por
   cada tool, `schema.safeParse({...validInput, clientId: 'evil'})` →
   `success: false`. Ídem `userId` y una key basura arbitraria.
2. **Orden de inyección (cerrado, obligatorio):** llamando el execute del
   closure DIRECTO (bypass de validación, simula fallo del SDK) con
   `{...args, clientId: 'evil', userId: 'evil'}`, la query subyacente recibe
   `ctx.clientId`/`ctx.userId` — el spread con context al final gana. Assert
   sobre el spy de la query.
3. **Defaults y caps de schema:** `limit` ausente → 20; `limit: 50` OK;
   `limit: 51` y `limit: 0` → rechazo; `periodMonth: 13` → rechazo.
   **(C2) Período a medias:** solo `periodYear` sin `periodMonth` → rechazo
   del schema; solo `periodMonth` sin `periodYear` → rechazo. (Ambos o
   ninguno.)
4. **Cap de payload (D-1):** `getOneTableRows` con query que devuelve >50
   rows → el wrapper devuelve exactamente `limit`.
5. **Resolución de período (D-3 + C1 + C3):**
   - sin `periodYear/periodMonth` → se llama `getDefaultPeriod` con el
     context y su resultado alimenta la query; con ambos params →
     `getDefaultPeriod` NO se llama.
   - **(C1-a) Eco:** el tool result incluye `{periodYear, periodMonth}`
     efectivamente usados — en AMBOS casos (provisto y resuelto por default).
   - **(C1-b) Memoización:** dos executes sobre el MISMO context sin período
     en el input → `getDefaultPeriod` se llama exactamente UNA vez (spy con
     call count).
   - **(C3) Sin data:** `getDefaultPeriod` → null → tool result
     `{ error: 'NO_DATA' }`, no throw, y NO `TOOL_EXECUTION_ERROR`.
6. **cuts:** las 3 tools que lo requieren llaman `getThresholdCuts(db,
   ctx.clientId)` y pasan el resultado.
7. **Error path:** query que lanza (error Prisma simulado con message
   sensible) → tool result `{error: 'TOOL_EXECUTION_ERROR'}`; el message
   original NO aparece en el resultado. Distinguible de `NO_DATA` (C3): un
   cliente sin data produce `NO_DATA`, nunca el genérico.
8. **Estabilidad de identidad (caching):** dos llamadas a `buildTools` con
   contexts distintos devuelven tools con el MISMO name/description/schema
   (referencia o deep-equal) y distinto closure.

Recordatorio operativo: cero procesos huérfanos antes de correr la suite
(`ps aux | grep -E "vitest|pnpm test"`), avisar a Michael antes (puede tener
`pnpm dev` contra la Neon dev DB).

## 4-bis. Minors a criterio del implementer (no bloquean)

- Descriptions de tools en inglés con hint de uso ("Use when the user asks
  ..."), estilo del ejemplo de spec §9.1.1.
- Ubicación de tests: verificar la convención real mirando `tests/` (o donde
  viva la suite) ANTES de crear archivos — no asumir colocation.
- Zod 4: `z.strictObject()` o `z.object().strict()`, la que sea consistente
  en todos los schemas.

## 5. Criterio GREEN

- `pnpm test` — suite completa verde (277 previos + los nuevos de §4).
- `pnpm typecheck` limpio.
- Verificación supply-chain post-task (los 3 comandos de CLAUDE.md #8) ✅.
- Implementer PARA en GREEN con árbol sucio: NO git add, NO commit, NO push.
  Reporte en `.superpowers/sdd/b5-chatbot-t1-report.md`.
- Después: doble review ciega (spec compliance / code quality, carriles
  separados), diff crudo + reviews a Michael, commit solo con "commiteá".

## 6. Pendientes de registro (no son scope de T1)

- **Rate limiting por usuario del chat** → diferido a hardening. Registrar en
  `.superpowers/sdd/hardening-backlog.md` sección Observabilidad/prod
  (`git add -f` al commitear — el path está gitignored aunque tracked). En
  esta sesión solo queda anotado acá.
- **Drift CLAUDE.md D3** (`getCurrentClient`/`lib/tenant.ts` no existen; el
  patrón real es `requireAuth()` en `lib/auth-helpers.ts`) → corrección de
  docs pendiente de OK de Michael.
- **Scaffold forecasting 'insufficient' inexistente** (§1.3) → decidir
  ubicación (T3 vs hardening-backlog).
