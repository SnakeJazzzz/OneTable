# Report — B5 (Chatbot IA) · T2: Route `/api/ai/chat`

Estado: **GREEN**. Implementer parado en árbol sucio (NO git add, NO commit,
NO push, `.env*` intacto). Fecha: 2026-07-16. Base: `feat/b5-chatbot` @
895113e.

---

## Archivos creados (lista real de `git status`)

```
?? app/api/ai/                       → app/api/ai/chat/route.ts
?? lib/ai/                           → lib/ai/model.ts
?? tests/ai/chat-route.test.ts
```

Pre-existentes en el árbol y NO tocados por este task (estaban sucios antes
de arrancar — presumiblemente handoff del controller):
`M docs/handoff/README.md` y `?? docs/handoff/session-b5-chatbot-t1-end.md`.

NO se tocó: `core/ai/tools/*`, `core/kpis/queries.ts`, `lib/thresholds.ts`,
`.env*`, `package.json`, `pnpm-lock.yaml`.

## Instalaciones

**CERO.** `package.json` y `pnpm-lock.yaml` no aparecen en `git status`
(idénticos a HEAD). `ai@6.0.168` y `zod@4.3.6` ya estaban de T1. NO se
instaló `@ai-sdk/react` (T3).

## Verificación supply-chain (regla #8, output real)

```
Checking for Mini Shai-Hulud infection markers...
✅ Clean — no infection markers detected
✅ pins exact
✅ lockfile clean
```

Idéntico al estado de cierre de T1, como exigía el brief (cero installs).

## Tests

- **Nuevos: 15** en `tests/ai/chat-route.test.ts` (los 8 grupos del brief §4).
- **Suite completa: 372/372 GREEN** (357 preexistentes + 15 nuevos).
- `pnpm typecheck` limpio (exit 0). Cero `as any` / `@ts-ignore` /
  `@ts-expect-error` en código nuevo y en tests.
- `ps aux | grep -E "vitest|pnpm test"` antes de la suite → cero procesos.

Cobertura por grupo:

1. **401** (1 test): `requireAuth` devuelve Response → la ruta la propaga
   POR REFERENCIA (`expect(res).toBe(the401)`); `chatModel` jamás llamado,
   `doStreamCalls` vacío.
2. **400 body** (5 tests): JSON inválido → `INVALID_BODY`; `messages`
   ausente → `INVALID_BODY`; `messages` no-array → `INVALID_BODY`; UIMessage
   malformado (role user sin `parts`, con payload señuelo) →
   `INVALID_MESSAGES` sin detalles del validador ni payload en la respuesta
   (assert negativo sobre `zod|expected|invalid_type` y sobre el señuelo) y
   log server-side con nombre de error solamente; `messages: []` →
   `INVALID_MESSAGES`; ventana sin ningún mensaje user → `INVALID_MESSAGES`
   (ver "Decisiones" abajo).
3. **Cap C1** (2 tests): 40 mensajes alternados → el prompt del mock
   contiene exactamente 30 no-system, el primero `role:'user'` (`msg-11`) y
   el último `msg-40`; caso ventana que arrancaría en assistant → 29
   mensajes, arranca en `msg-12` (user). Tool results huérfanos NO testeados
   (imposibles en el formato UIMessage del pin — brief §2.2).
4. **Happy path** (1 test): 200, stream consumible, texto completo llega
   (`Hola` + ` mundo`); además asserta que `prompt[0]` es el system prompt
   (contiene `NO_DATA`, `getSalesTrend`, `totalRows` — el doble vocabulario
   wireado de verdad).
5. **Wiring de tenant — CRÍTICO** (1 test): mock emite tool-call real a
   `getSalesByChainForPeriod` con período explícito; el body inyecta
   `clientId:'evil-client'`/`userId:'evil-user'` → el spy de la query recibe
   `clientId`/`userId` DE LA SESIÓN mockeada; dump de args de la query no
   contiene los ids inyectados. Es la integración route→buildTools→context
   que T1 no podía cubrir.
6. **stopWhen** (1 test): mock que SIEMPRE tool-callea → `doStreamCalls`
   length === 5 exacto y la query ejecutada 5 veces; sin loop infinito.
7. **onError** (1 test): stream con chunk `error` (message sensible) → la
   respuesta lleva el literal `CHAT_ERROR` y NO lleva el message subyacente.
8. **Sin persistencia** (2 tests): walk recursivo del stub de db (TODOS los
   métodos son spies — 84 spies) → cero llamadas a CUALQUIER método (más
   fuerte que "cero writes": con el query layer mockeado, NADA debe tocar el
   PrismaClient) en happy path y en error path.

Mock strategy (según brief §4): `MockLanguageModelV3` de `ai/test` +
`simulateReadableStream` de `ai`; `vi.mock` de `@/lib/ai/model`,
`@/lib/auth-helpers` (parcial — ver decisiones), `@/lib/db`,
`@/lib/thresholds`, `@/core/kpis/queries`, `@/auth`. `buildTools` REAL.
Jamás API real, jamás DB real.

## System prompt — decisiones de redacción

Citado completo (const `SYSTEM_PROMPT` en `app/api/ai/chat/route.ts`):

```
You are OneTable's data assistant for a retail supplier in Mexico. You answer questions about the current client's sell-out (sales) and inventory data across retail chains, using ONLY the provided tools.

Language and formatting:
- Always answer in neutral Spanish, regardless of the language of the question.
- All monetary amounts are Mexican pesos. Format them as MXN (e.g. "$12,345.60 MXN").

Data discipline:
- Only report figures that come from tool results. Never invent, estimate, or extrapolate numbers.
- If none of the tools can answer the question, say so plainly instead of guessing.
- Prefer aggregated tools with a small limit. Do not fetch raw rows (getOneTableRows) when an aggregate answers the question.

Periods:
- If the user does not specify a month, call tools WITHOUT periodYear/periodMonth: they resolve the most recent period with data and echo the resolved periodYear/periodMonth in their result. Always state which month and year your answer refers to.

Interpreting tool results:
- A result of {"error":"NO_DATA"} means the client has no data loaded yet. Say exactly that — no sales/inventory data has been uploaded — and suggest uploading portal files. It is not a technical failure.
- getSalesTrend expresses "no data" differently: it returns rows as an empty array ([]) when there is no data in the requested window. An empty trend is NOT an error and does not mean the client has no data at all — report it as "no data in that window".
- A result of {"error":"TOOL_EXECUTION_ERROR"} is a transient technical failure. Offer to retry; do not speculate about the cause.
- When a result includes totalRows and totalRows is greater than the number of rows returned, the list was truncated: tell the user you are showing N of M (in Spanish, e.g. "mostrando 20 de 3,188").
```

Decisiones de redacción (todas dentro del marco §2.3):

- **Cero volátiles**: ni fecha, ni ids, ni nombres de cadenas hardcodeados
  más allá de "retail chains" genérico — byte-estable para prompt caching.
  El "período actual" queda explícitamente delegado a las tools.
- **Doble vocabulario sin-data** (observación obligatoria del reviewer):
  `{"error":"NO_DATA"}` = cliente sin data cargada (con la aclaración de que
  NO es fallo técnico), vs `getSalesTrend` con `rows: []` = sin data en la
  ventana pedida y NO un error. Ambos redactados como bullets separados y
  contrastados ("expresses no data differently").
- **`totalRows`**: semántica de truncado con el ejemplo literal del reporte
  de T1 ("mostrando 20 de 3,188").
- **TOOL_EXECUTION_ERROR**: ofrecer reintento, prohibido especular causa.
- No se listan las 7 tools por nombre en el prompt (el SDK ya inyecta
  name/description/schema por su lado); solo se nombran `getOneTableRows` y
  `getSalesTrend` donde la instrucción es específica de esa tool.

## Deviations del brief (con porqué)

1. **`await convertToModelMessages(...)`** — el snippet del brief §2.2 lo usa
   síncrono, pero en `ai@6.0.168` devuelve `Promise<ModelMessage[]>`
   (verificado contra el d.ts del pin: `dist/index.d.ts:3855-3859`; tsc lo
   confirmó con TS2740 en la versión sin await). Un `await` — cero cambio
   semántico.
2. **Ventana post-trim vacía → 400 `INVALID_MESSAGES`** ("Conversation must
   include a user message"). El brief no especifica qué hacer con
   `messages: []` o una ventana 100% assistant (regla b descarta todo).
   Mandar 0 mensajes al modelo no es una conversación válida; 400 con el
   código de mensajes (no INVALID_BODY: el body parseó bien) es la salida
   coherente. 2 tests lo cubren.
3. **`vi.mock('@/auth')` agregado** (no estaba en la lista de mocks del
   brief §4): el mock de `@/lib/auth-helpers` es PARCIAL (via
   `importOriginal`) para conservar el `errorResponse` real — y el módulo
   real importa `@/auth` → next-auth → `next/server`, irresoluble bajo
   vitest (misma razón por la que TODOS los tests de `tests/api/*` mockean
   `@/auth`). Alternativa descartada: mock total de auth-helpers con un
   errorResponse duplicado a mano (drift silencioso si el shape real cambia).
4. **Grupo 5 usa doStream en forma FUNCIÓN, no array**: la forma array de
   `MockLanguageModelV3` en `ai@6.0.168` tiene un off-by-one (el mock hace
   `doStreamCalls.push(options)` ANTES de `return doStream[this.doStreamCalls.length]`
   — `dist/test/index.mjs:82-87` — así que el call 1 recibe el elemento 1 y
   el elemento 0 jamás se sirve). Verificado empíricamente: con array el
   tool-call nunca llegaba al modelo. Workaround local al test con un
   counter, comentado en el archivo. Bug upstream del mock, no de la ruta.
5. **`console.error` silenciado (spy) en los tests de error de stream
   (grupos 7/8)**: `streamText` loguea errores de stream server-side por
   default. No es leakage al cliente (el assert de no-leak es sobre la
   RESPUESTA), pero ensuciaba el output de la suite con stack traces.

Ninguna otra deviation. Flujo, archivos, consts (`CHAT_MODEL_ID` con punto,
`MAX_CHAT_MESSAGES = 30`, `SYSTEM_PROMPT` a nivel módulo), regla C1
(a)+(b), `runtime = 'nodejs'`, `stopWhen: stepCountIs(5)`,
`toUIMessageStreamResponse({ onError: () => 'CHAT_ERROR' })`, shapes de
error del repo y server stateless: todo literal del brief.

## Smoke (cierre del gate — corre Michael, brief §5)

Precondiciones ya confirmadas: `AI_GATEWAY_API_KEY` en `.env.local`; la
cuenta dev debe tener `SelloutData` cargada (C2 — con DB vacía solo se
valida el path NO_DATA); `pnpm dev` + login con el usuario seed; token de la
cookie `authjs.session-token` desde DevTools (no viaja por chat).

Comando listo-para-pegar (el body coincide EXACTO con el shape que espera la
ruta — verificado contra los tests):

```bash
curl -N -X POST http://localhost:3000/api/ai/chat \
  -H 'content-type: application/json' \
  -H 'cookie: authjs.session-token=<TOKEN>' \
  -d '{"messages":[{"id":"1","role":"user","parts":[{"type":"text","text":"¿cuánto vendí este mes por cadena?"}]}]}'
```

Verificar: el stream responde (SSE incremental, no un blob al final — acá se
valida el compromiso del override `eventsource-parser@3.0.8` del fix pass de
T1), la respuesta cita el período (mes/año), y los tool-calls aparecen en la
observability del gateway.

## Próximo paso (protocolo)

Doble review ciega (spec compliance / code quality, carriles separados) →
diff crudo + ambos reviews a Michael → smoke curl de Michael → commit solo
con su "commiteá".

## Smoke de streaming (corrido por Michael, 2026-07-16 — 2 rondas)

1. **Ronda 1 — NO_DATA con data cargada:** diagnóstico de Michael = error de
   operación, no bug. La cookie era de una sesión/cuenta ANTERIOR sin data
   (re-login y cuenta nueva creados mientras el server estuvo abajo; la data
   se subió en la cuenta nueva). Colateral valioso: la cuenta vieja devolvió
   NO_DATA — multi-tenancy comportándose exactamente como debe.
2. **Ronda 2 — SMOKE PASADO completo** con la cookie correcta:
   - Streaming real OK → **el override `eventsource-parser@3.0.8` queda
     VALIDADO en streaming real** (compromiso escrito del fix pass de T1,
     saldado).
   - Tool choice correcta: `getSalesByChainForPeriod` con input `{}`.
   - Eco de período OK: el modelo citó "marzo de 2026" sin pedírselo.
   - Números de Soriana correctos: $355,620.13 / 2,499 unidades.
   - Multi-tenancy OK entre ambas cuentas (vieja → NO_DATA; nueva → sus
     números).

### Nota de corrección de docs (hallazgo colateral del smoke)

La cuenta nueva tiene UNA sola cadena y `getDefaultPeriod` devolvió período
igual. Esto contradice el claim del brief de T1 §1.1 ("período más reciente
con ≥2 cadenas") pero NO es un bug: la regla REAL verificada en
`core/kpis/queries.ts:88-90` (comment) y en su SQL (UNION ALL con
`priority 1/2`, líneas 104-124) es de dos niveles — (1) período más reciente
con ≥2 cadenas; (2) FALLBACK: período más reciente a secas si no existe
ninguno multi-cadena; null solo sin data alguna. El claim del brief T1 era
un resumen incompleto (omitía el fallback). Drift de docs, no de código;
`queries.ts` intocado. El comportamiento observado en el smoke es el
correcto por diseño (S12.1).

---

## Fix pass (2026-07-16 — hallazgos del review de quality, contenido aprobado por Michael)

Estado: **GREEN**. Fixer parado en árbol sucio (NO git). **CERO installs**
(`package.json`/`pnpm-lock.yaml` intactos, no aparecen en `git status`).
`core/` y todo T1 intocados.

### M1 — system injection (decisión: STRIP)

- `app/api/ai/chat/route.ts`: `trimMessages` ahora filtra los mensajes
  `role: 'system'` del cliente ANTES del slice C1 y de validar/convertir. El
  `SYSTEM_PROMPT` del server es el ÚNICO system. Orden elegido:
  **strip primero, después trim/alineación a user** — así los system
  descartados no consumen cupo de los 30 (documentado en el comment del
  helper). Se extrajo un accessor defensivo `roleOf(m)` (el strip y la
  alineación corren pre-validación sobre `unknown`).
- Test nuevo: system messages inyectados al inicio Y en el medio del
  historial → 200 + stream OK; el prompt del mock lleva EXACTAMENTE un
  system (el del server, asserted por contenido), el texto inyectado no
  aparece en ningún role del prompt, y la conversación restante sobrevive
  intacta abriendo en user.

### M2 — conversación clavada en CHAT_ERROR (opción del pin)

- `app/api/ai/chat/route.ts`: `convertToModelMessages(validated.data,
  { ignoreIncompleteToolCalls: true })` (existe en `ai@6.0.168`,
  d.ts:3850-3857, default false; el runtime filtra tool parts en
  `input-streaming`/`input-available` — verificado en `dist/index.js:8386`).
- Test nuevo: historial con un tool part `tool-getSalesByChainForPeriod` en
  estado `input-available` (simula abort de T3 a mitad de tool step) →
  200 + stream OK, sin `CHAT_ERROR` in-band; el prompt del mock NO contiene
  el tool-call huérfano (`call-orphan` ausente, cero `tool-call`) y el text
  part del mismo assistant message SÍ sobrevive (se ignora el part, no el
  mensaje).

### Minor 3 — higiene de mocks

- `tests/ai/chat-route.test.ts`: `vi.clearAllMocks()` →
  `vi.resetAllMocks()` + re-prime completo de defaults en `beforeEach`,
  consistente con el patrón de `tests/ai/tools.test.ts` (T1): además de
  `requireAuth`/`getThresholdCuts`/`getDefaultPeriod` (que ya se
  re-primaban), ahora se priman las 7 queries de `core/kpis/queries` con
  defaults inertes. Ningún test dependía de la fuga: la suite pasó sin
  tocar priming local de ningún test existente.

### Minor 4 — al backlog

- `.superpowers/sdd/hardening-backlog.md` §"Observabilidad / prod": ítem
  nuevo (origen "review quality T2 B5") junto al de rate limiting — el cap
  C1 acota CANTIDAD (30) pero no TAMAÑO por mensaje; evaluar cap de
  bytes/chars por mensaje o por ventana en el hardening del chat.

### Verificación

- Tests nuevos: **2** (M1 + M2). `tests/ai/chat-route.test.ts`: 15 → **17**.
- Suite completa: **374/374 GREEN** (372 + 2). `pnpm typecheck` limpio
  (exit 0). `ps aux | grep -E "vitest|pnpm test"` antes de la suite → cero
  procesos.
- Supply-chain #8 idéntico: `✅ Clean` / `✅ pins exact` / `✅ lockfile
  clean`. Cero installs.

### Smoke — no-regresión

**El shape del body del curl del smoke NO cambió.** El comando de la sección
"Smoke" de arriba sigue válido tal cual: mismo endpoint, mismo
`{"messages":[...]}`, misma cookie. Un historial de un solo mensaje user ni
se trimea ni contiene system/tool parts, así que el fix pass es transparente
para ese request — Michael puede re-correr el MISMO curl como verificación
de no-regresión.
