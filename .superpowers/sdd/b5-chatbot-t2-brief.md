# Brief — B5 (Chatbot IA §9.1) · T2: Route `/api/ai/chat`

> Gate: **ESTRICTO** (diff a Michael antes de commit). Cero UI (T3). Cero
> instalaciones nuevas. Este brief va a filtro externo ANTES de dispatch.
> El prompt del implementer DEBE llevar el prefijo literal supply-chain de
> CLAUDE.md (aunque T2 no instala nada — la regla es por task, no por install).

Base: branch `feat/b5-chatbot` @ 895113e (T1 mergeado al branch, suite
357/357). Re-grounding verificado el 2026-07-16 contra los types reales de
`ai@6.0.168` (unpkg `dist/index.d.ts` y `dist/test/index.d.ts`) y el repo.

---

## 1. Re-grounding — hallazgos con evidencia

### 1.1 APIs del SDK verificadas en `ai@6.0.168` (types reales, no doc pública)

| API | Estado en 6.0.168 | Uso en T2 |
|---|---|---|
| `streamText({ model, system, messages, tools, stopWhen })` | existe; `stopWhen: StopCondition \| StopCondition[]`, default `stepCountIs(1)` | loop de tools |
| `stepCountIs(n)` | existe (d.ts:841) | **`stopWhen: stepCountIs(5)`** — la spec §9.1.2 dice `maxSteps: 5`; `maxSteps` NO existe en v6 (D-5 del brief T1) |
| `LanguageModel` | `GlobalProviderModelId \| LanguageModelV3 \| LanguageModelV2` (d.ts:96) | string plano rutea por el global provider = gateway → `AI_GATEWAY_API_KEY` |
| `safeValidateUIMessages` / `validateUIMessages` | existen (d.ts:4119-4140) | validación del body → 400 con shape del repo |
| `convertToModelMessages(messages)` | existe (d.ts:3855) | UIMessage[] → ModelMessage[] |
| `result.toUIMessageStreamResponse(options)` | existe (d.ts:2592), acepta `UIMessageStreamOptions` (incluye `onError`) | respuesta streaming para `useChat` de T3 |
| `ai/test` | subpath export real; exporta **`MockLanguageModelV3`**, `simulateReadableStream`, `mockId`, `mockValues` | mock del language model en tests — cero API real |

- **Modelo (D-4, T1):** el ID real del gateway es **`anthropic/claude-haiku-4.5`**
  (con punto; verificado contra `/v1/models` del gateway el 2026-07-15). El
  string con guiones de la spec §9.1.3 NO existe. Escalado futuro:
  `anthropic/claude-sonnet-4.6`.
- **`AI_GATEWAY_API_KEY`**: el provider gateway default la lee del env.
  Verificado: **NO está en `.env.example`** (el hook block-env-writes impide
  agregarla desde acá; Michael la agrega a mano a `.env.local` — y si quiere,
  la línea comentada en `.env.example` vía vi). Los tests NO la necesitan.

### 1.2 Patrón real de rutas del repo (referencia: `app/api/data/upload/route.ts`, `app/api/dashboard/kpis/route.ts`)

- Auth: `requireAuth()` de `lib/auth-helpers.ts` → `{userId, clientId, email}`
  o `Response` 401 con shape `{ error: { code, message } }` (`errorResponse`).
  NO existe `getCurrentClient`/`lib/tenant.ts` (drift documentado en T1).
- Errores: `errorResponse(code, message, status)` — mismo shape para el 400
  de body inválido.
- `db` desde `@/lib/db`. Header-comment estilo doc-block explicando el
  contrato de la ruta (convención de todas las rutas del repo).
- **Ninguna ruta del repo exporta `runtime` todavía** (grep vacío) — T2 es la
  primera: `export const runtime = 'nodejs'` explícito (Prisma no corre en
  edge; decisión cerrada).

### 1.3 Insumos del reporte de T1 que este brief recoge (cerrados, no re-abrir)

- `buildTools(ctx)` espera `{ db, clientId, userId, loadCuts }` — con
  **`loadCuts`** (nombre post-micro-fix):
  `buildTools({ db, clientId, userId, loadCuts: () => getThresholdCuts(db, clientId) })`.
  `getThresholdCuts` viene de `@/lib/thresholds` — importarlo en la RUTA es
  correcto (app→lib→core es la dirección permitida; el ciclo core→lib fue
  justamente lo que M2 eliminó).
- La memoización (período + cuts) vive en el runtime de core; la ruta solo
  pasa el loader crudo. `buildTools` se llama POR REQUEST (context fresco);
  names/descriptions/schemas son consts a nivel módulo → el prompt caching
  no se ve afectado por el re-build.
- Shapes de error de tools: `{error:'NO_DATA'}` (cliente sin data) y
  `{error:'TOOL_EXECUTION_ERROR'}` (fallo real). Las tools con período
  ECOAN `{periodYear, periodMonth}` en el resultado; las 2 tools con slice
  agregan `totalRows`.
- **Observación del reviewer de quality (obligatoria en el system prompt):**
  `getSalesTrend` expresa "sin data" como `rows: []` (array vacío), NO como
  `NO_DATA` — no usa período default. El system prompt debe documentar AMBOS
  vocabularios para que el modelo no interprete un array vacío como error ni
  espere NO_DATA de getSalesTrend.

---

## 2. Diseño T2 (aplica decisiones cerradas)

### 2.1 Archivos

```
lib/ai/model.ts            — CHAT_MODEL_ID = 'anthropic/claude-haiku-4.5' (const)
                             + chatModel(): LanguageModel (indirección mockeable:
                             los tests vi.mock-ean este módulo y devuelven
                             MockLanguageModelV3; prod devuelve el string)
app/api/ai/chat/route.ts   — POST handler + runtime='nodejs' + SYSTEM_PROMPT
                             + MAX_CHAT_MESSAGES (consts a nivel módulo)
tests/ai/chat-route.test.ts — tests (convención tests/<área>/ verificada en T1)
```

Sin `core/` nuevo: la orquestación del chat es Next-specific (Request/
Response/streaming), vive en la ruta. La única indirección extra es
`lib/ai/model.ts`, y existe SOLO para que los tests inyecten el mock sin
tocar red (mockear un string de gateway = interceptar HTTP: inaceptable).

### 2.2 Flujo del handler (POST)

1. `requireAuth()` → 401 estándar si no hay sesión. `{userId, clientId}` del
   JWT — jamás del body.
2. Parse JSON del body (try/catch → 400 `INVALID_BODY`). Shape esperado del
   `DefaultChatTransport` de useChat (T3): `{ messages: UIMessage[], ... }` —
   solo se consume `messages`; el resto se ignora.
3. **Cap server-side de mensajes (CERRADO por Michael, 2026-07-16, regla
   refinada en C1 del filtro):** `MAX_CHAT_MESSAGES = 30`. Regla operativa:
   (a) slice de los últimos 30 mensajes COMPLETOS (UIMessages enteros);
   (b) post-slice, descartar mensajes del inicio hasta que la ventana
   arranque con un mensaje `role: 'user'` (providers pueden rechazar
   historial que arranca en assistant).
   **Verificado contra los types del pin (d.ts:1659-1684):** en el formato
   `UIMessage` de `ai@6.0.168` NO existe rol 'tool' — los tool calls y sus
   results viven como `ToolUIPart` DENTRO de las parts del assistant
   message. Un tool result huérfano entre mensajes es estructuralmente
   imposible a este nivel: el slice de mensajes completos ocurre ANTES de
   `convertToModelMessages`, así que nunca puede partir un par
   call/result. No se testea ese escenario (no existe en el formato); el
   test del grupo 3 cubre la regla real (a)+(b).
   Razón del trim (vs 400): el historial es client-side por diseño; el
   server protege costo/context sin romper conversaciones largas.
4. `safeValidateUIMessages({ messages: trimmed })` → si `success: false` →
   400 `INVALID_MESSAGES` (sin detalles del validador al cliente; log
   server-side sin payload).
5. `streamText({ model: chatModel(), system: SYSTEM_PROMPT, messages:
   convertToModelMessages(validated), tools: buildTools({ db, clientId,
   userId, loadCuts: () => getThresholdCuts(db, clientId) }), stopWhen:
   stepCountIs(5) })`.
6. `return result.toUIMessageStreamResponse({ onError: () => 'CHAT_ERROR' })`
   — onError SIEMPRE devuelve el literal genérico: nunca message/stack al
   stream (mismo principio que las tools). Server stateless: nada se persiste
   (sin DB writes — fuera de scope B5).

### 2.3 System prompt (const estable — prompt caching §9.1.2)

Contenido requerido (redacción exacta a criterio del implementer, en inglés,
respuestas del asistente en español):

- Rol: asistente de datos de sell-out/inventario retail para el cliente
  actual; responde en español neutro; montos en MXN.
- SOLO responde con datos obtenidos vía tools — nunca inventa cifras. Si una
  tool no cubre la pregunta, lo dice.
- Preferí agregados con `limit` chico (§9.1.2); no pidas raw rows si un
  agregado alcanza.
- Semántica de período: si el usuario no especifica mes, las tools resuelven
  el período más reciente con data y lo ECOAN en el resultado — mencioná
  siempre sobre qué mes estás respondiendo.
- **Vocabularios de sin-data (ambos, §1.3):** `{error:'NO_DATA'}` = el
  cliente no tiene data cargada (decilo en esos términos);
  `getSalesTrend` con `rows: []` = sin data en la ventana pedida (NO es un
  error). `{error:'TOOL_EXECUTION_ERROR'}` = fallo técnico transitorio —
  ofrecé reintentar, no especules la causa.
- `totalRows > rows.length` en tools con slice = resultado truncado
  ("mostrando N de M").
- NADA volátil interpolado en el prompt (ni fecha, ni clientId) — estabilidad
  byte-a-byte para caching. El "período actual" NO va en el system prompt
  (lo resuelven las tools).

### 2.4 Reglas duras heredadas (cerradas)

- Modelo: constante fija `anthropic/claude-haiku-4.5` — sin routing dinámico,
  sin UI de selección.
- Historial client-side; server stateless; sin persistencia en DB.
- Runtime Node. Streaming siempre.
- Rate limiting por usuario: NO (ya registrado en hardening-backlog).
- Cero mutaciones: la ruta no escribe nada en DB.

## 3. Paquetes

**Ninguno.** `ai@6.0.168` y `zod@4.3.6` ya están (T1). `@ai-sdk/react` es de
T3. La verificación supply-chain #8 corre igual al cierre (regla por task).

## 4. Plan de tests (`tests/ai/chat-route.test.ts`, Vitest — cero API real, cero DB real)

Estrategia: importar `POST` de la ruta directo; `vi.mock` de
`@/lib/auth-helpers` (sesión fake / Response 401), `@/lib/db` (objeto stub),
`@/lib/thresholds`, `@/lib/ai/model` (→ `MockLanguageModelV3` de `ai/test`
con `doStream` programado), y `@/core/kpis/queries` cuando el escenario
ejercita tools. `simulateReadableStream` para los chunks del mock.

1. **401**: `requireAuth` devuelve Response → la ruta la propaga tal cual;
   el model mock NO fue llamado.
2. **400 body**: JSON inválido y `messages` ausente/no-array →
   `INVALID_BODY`; UIMessage malformado → `INVALID_MESSAGES` (vía
   `safeValidateUIMessages`). Sin detalles internos en el body de respuesta.
3. **Cap (server-side, regla C1)**: request con 40 mensajes → el prompt que
   recibe el model mock contiene ≤30 mensajes y el PRIMERO es `role: 'user'`
   (assert sobre `doStream`-call/prompt del mock). Caso adicional: ventana
   post-slice que arrancaría en assistant → se descartan los del inicio
   hasta el primer user. (Tool results huérfanos: NO se testea — imposible
   en el formato UIMessage del pin, ver §2.2.)
4. **Happy path streaming**: mock emite text-deltas → Response 200, stream
   consumible, el texto llega completo (leer el stream en el test).
5. **Wiring de tenant (crítico)**: mock emite un tool-call a una tool real →
   el spy de la query de core recibe `clientId`/`userId` DE LA SESIÓN
   mockeada (no del body, aunque el body traiga ids inyectados). Es el test
   de integración route→buildTools→context que T1 no podía cubrir.
6. **stopWhen**: mock que responde SIEMPRE tool-calls → el loop corta en 5
   steps (conteo de llamadas al mock = 5, sin loop infinito).
7. **onError**: mock cuyo stream falla → el stream de respuesta lleva el
   literal `CHAT_ERROR`; el message del error subyacente NO aparece ni en el
   stream ni en el response body.
8. **Sin persistencia**: el stub de db no recibe ningún write (spy sobre
   cualquier método de mutación del stub) en happy path ni en error.

## 5. Smoke (cierre del gate, con Michael)

Los tests no ejercitan el streaming real contra el gateway (nota registrada
en el reporte de T1). Smoke manual de Michael ANTES del commit:

**Precondición (C2 del filtro):** la cuenta dev de Michael debe tener
`SelloutData` cargada — el seed NO popula ventas; con DB vacía el smoke solo
validaría el path NO_DATA, no el streaming con tools reales.

**Estado ya confirmado por Michael (2026-07-16):** `AI_GATEWAY_API_KEY` ya
está en su `.env.local`; la cookie de sesión de NextAuth se llama
**`authjs.session-token`** (confirmado empíricamente por Michael — no
re-verificar). `pnpm dev` puede estar activo en su terminal: avisar antes de
correr la suite completa.

1. ~~Michael agrega `AI_GATEWAY_API_KEY`~~ — ya está (ver arriba).
2. `pnpm dev` + login con el usuario seed.
3. Curl listo-para-pegar: **el reporte del implementer DEBE incluir el
   comando final** usando el nombre de cookie confirmado
   `authjs.session-token` con placeholder `<TOKEN>` (Michael lo completa en
   su terminal; los tokens no viajan por chat). Forma esperada:
   `curl -N -X POST http://localhost:3000/api/ai/chat -H 'content-type: application/json' -H 'cookie: authjs.session-token=<TOKEN>' -d '{"messages":[{"id":"1","role":"user","parts":[{"type":"text","text":"¿cuánto vendí este mes por cadena?"}]}]}'`
   (el implementer ajusta el body si el shape final difiere).
4. Verificar: stream responde, la respuesta cita el período, tool-calls
   visibles en la observability del gateway.

**CERRADO por Michael (2026-07-16): el smoke curl va EN T2, no se difiere a
T3.** Razón registrada: el override de `eventsource-parser@3.0.8` (fix pass
T1) tiene compromiso escrito de validarse en el smoke de streaming de T2 —
el curl aísla el streaming de la UI, así que si algo se rompe por el
override se ve acá y no enredado con T3. El smoke es parte del cierre del
gate de T2 y lo corre Michael con su key local.

## 6. Criterio GREEN

- `pnpm test` completo verde (357 + los nuevos) + `pnpm typecheck` limpio +
  supply-chain #8 (sin installs, debe salir idéntico).
- Implementer PARA en GREEN con árbol sucio: NO git. Reporte en
  `.superpowers/sdd/b5-chatbot-t2-report.md`.
- Después: doble review ciega (mismos carriles), diff crudo + reviews a
  Michael, commit solo con su "commiteá".

## 7. Fuera de scope T2

- UI panel en Análisis, `@ai-sdk/react`, `useChat` (T3).
- Persistencia de conversaciones, rate limiting (backlog), routing de
  modelos, forecast tool (NO existe por decisión — §9.2 congelado).
- Ediciones a `.env*` (manuales de Michael).
