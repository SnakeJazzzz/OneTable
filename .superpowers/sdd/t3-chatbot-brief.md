# Brief — T3 CHATBOT (CORTE punto 3 / plan faro §3 T3)

> Estado: v2 CON ENMIENDAS DEL FILTRO (GO) — 2026-08-11. La v1 (mismo
> día) recibió GO del filtro externo con enmiendas E1-E4; este v2 las
> fija junto con las decisiones de Michael que cierran las 3 OQs, los
> riders y el resultado de la verificación de cache hits (ver
> §DECISIONES CERRADAS al final). Cero implementación hasta que Michael
> commitee este brief y autorice el dispatch. Verificación empírica
> corrida HOY sobre `feat/hardening-t3` @ `b00bc4e` (árbol limpio;
> main @ `0f0d44e` = squash de T2, PR #16).
>
> Protocolo: el prompt del implementer lleva como prefijo literal la
> sección "⚠ Seguridad supply chain — NO NEGOCIABLE" de `CLAUDE.md`. El
> implementer PARA en GREEN con árbol sucio (no git). Doble review CIEGA
> en carriles separados + fix pass + re-review del carril hallador. Gate
> ESTRICTO en route/config (diff crudo a Michael antes de commit) + smoke
> de calidad de Michael. Branch: `feat/hardening-t3`.

---

## 1. Verificación empírica del estado real (2026-08-11)

Cada punto verificado hoy contra el repo. Si el dispatch se aleja en el
tiempo, re-correr los greps de este bloque.

1. **Runtime de la ruta: YA declarado.** `app/api/ai/chat/route.ts:57`
   tiene `export const runtime = 'nodejs'` (comment en `:39-40` explica el
   porqué: Prisma no corre en edge). **NO es un cambio de T3** — la
   preocupación "limiter Prisma vs edge" está resuelta desde B5; el
   limiter de T2 correrá en el mismo runtime Node sin fricción.
2. **Cap C1 de CANTIDAD:** `MAX_CHAT_MESSAGES = 30` (`route.ts:62`),
   aplicado en `trimMessages` (`route.ts:108-113`): strip de mensajes
   `role: 'system'` del cliente, ventana de los últimos 30 mensajes
   COMPLETOS, alineada a que abra con `role: 'user'`. Sigue sin cap de
   TAMAÑO por mensaje (ledger, origen review quality T2 B5) y sin rate
   limit (ledger, origen brief T1 B5 §6).
3. **`streamText` actual** (`route.ts:160-181`): `model: chatModel()`,
   `system: SYSTEM_PROMPT`, `messages` vía `convertToModelMessages(...,
   { ignoreIncompleteToolCalls: true })`, `tools: buildTools(...)`,
   `stopWhen: stepCountIs(5)`. **SIN `maxOutputTokens`, SIN
   `temperature`, SIN `providerOptions`** (grep confirmado). El estado de
   `temperature` se REPORTA (ítem MEDIO del ledger); setearla queda FUERA
   del corte (frontera §8.3).
4. **Manejo de errores actual:** 401 vía `requireAuth()` (`route.ts:116`),
   400 `INVALID_BODY` / `INVALID_MESSAGES` (`:124,132,143,157`), stream
   errors → literal `'CHAT_ERROR'` en `toUIMessageStreamResponse`
   (`:185`). `errorResponse(code, message, status)` de
   `lib/auth-helpers.ts:27-37` es el shape estándar — sirve tal cual para
   el 429.
5. **Contrato real de `consumeRateLimit`** (`lib/rate-limit.ts:111-124`):
   firma `{ scope, key, limit, windowMs }` → `{ allowed, count }`;
   incremento atómico (INSERT ... ON CONFLICT sobre PK compuesta
   `(scope, key, windowStart)`, cleanup lazy en CTE,
   `lib/rate-limit.ts:91-101`); **ventana FIJA alineada a la época**:
   `windowStart = floor(now / windowMs) * windowMs`
   (`windowStartFor`, `:60-62`) — exactamente la semántica que el corte
   fija para el día del chat. **FAIL-OPEN** en error de DB (`:120-123`,
   log estructurado sin PII). El límite es PARÁMETRO (comment `:26-27`
   ya anticipa el reuso de T3). **T3 lo REUSA sin modificarlo.**
6. **Modelo:** `CHAT_MODEL_ID = 'anthropic/claude-haiku-4.5'` (con punto)
   en `lib/ai/model.ts:19`, resuelto por el AI Gateway vía string;
   indirection `chatModel()` mockeable en tests (`:21-23`).
7. **Caching: CERO configurado.** Grep de
   `cache_control|cacheControl|providerOptions` en `app/ lib/ core/` →
   0 resultados (confirmado hoy; coincide con el snapshot del corte y el
   ítem MEDIO del ledger). La PRECONDICIÓN de byte-estabilidad está
   garantizada: `SYSTEM_PROMPT` es const de módulo sin interpolación
   volátil (`route.ts:64-86`) y la identidad de tools
   (name/description/schema) vive a nivel módulo en cada tool file
   (`core/ai/tools/index.ts:3-7`); solo los execute closures se bindean
   por request. **`maxOutputTokens?: number` y `providerOptions` EXISTEN
   en el `streamText` de `ai@6.0.168`** (verificado en
   `node_modules/ai/dist/index.d.ts:599,2841` — no es claim de memoria).
8. **`core/ai/tools/*`: deuda del ledger SIN cambios** (confirmado por
   grep hoy): spread de `input` en los 7 execute (p.ej.
   `get-dashboard-kpis.ts:35`, `get-sales-trend.ts:35`) y dup
   slice/totalRows (`get-onetable-rows.ts:44-45`,
   `get-days-of-inventory.ts:42-43`). **NO son scope de T3.**
9. **Config por cliente: NO EXISTE hoy.** `model Client`
   (`prisma/schema.prisma:24-41`) no tiene ningún campo de
   plan/quota/config; la única relación de config es `ThresholdConfig`
   (umbrales de alertas, otra cosa). Grep de `plan|quota|limit` en el
   schema → solo el modelo `RateLimit` de T2 (`schema.prisma:242-249`).
   **Dónde vive: DECIDIDO por Michael — opción (A), ver §4.1.**
10. **429 ya tiene patrón en el repo:** signup
    (`app/api/auth/signup/route.ts:52-62`) responde
    `errorResponse('RATE_LIMITED', ..., 429)` tras `consumeRateLimit` —
    el chat sigue el mismo shape.
11. **UI del chat ante errores:** `components/analisis/chat-panel.tsx:27`
    muestra UN copy genérico para todo error ("Ocurrió un error al
    procesar tu pregunta. Vuelve a intentarlo."). Un 429 de quota diaria
    mostraría "vuelve a intentarlo" — engañoso (reintentar no ayuda hasta
    la próxima ventana). Ver §4.4.
12. **Tests existentes:** `tests/ai/chat-route.test.ts` mockea `@/auth`,
    `@/lib/auth-helpers`, `@/lib/db`, `@/lib/thresholds`,
    `@/lib/ai/model` (MockLanguageModelV3) y `core/kpis/queries` — la
    infraestructura para testear rate limit/caps/params sin red ya
    existe. Baseline de la suite: **461 tests / 49 archivos**
    (cierre de T2, `docs/handoff/session-t2-close.md` §2).
13. **Evidencia de invención (casos de prueba del smoke de calidad):**
    (a) Smoke T3 B5 2026-07-16 (ledger, sección Pre-lanzamiento):
    sugerencias de reorden con 150-200 u y "plan de 8,050 unidades" NO
    derivadas de ninguna tool + misatribución de inventario total de
    cadena (16,231 u) presentado como de un producto; mismo origen, el
    framing "cuentas de la plataforma" para titular cadenas. (b) Smoke
    T2 2026-08-11 (reportado por Michael en el kickoff de T3; NO está
    aún en el ledger — anotarlo al cierre de T3): "descenso de 33%" para
    52→34 unidades (real: 34.6%) — aritmética imprecisa SOBRE tool
    results correctos. El caso (b) muestra que "solo derivado de tools"
    no basta: la derivación aritmética debe ser correcta o declararse
    aproximada.
14. **`app/api/csp-report/route.ts` (rider 1 aprobado — ver §4.7):**
    endpoint PÚBLICO sin auth y HOY sin DB (comment `:11` "No DB" —
    actualizarlo en el diff), cap de body en dos fases
    (Content-Length `:23-26`, post-read `:34-36`, 32KB), parse
    leniente y log estructurado vía `console.warn` (`:49-56`);
    responde 204 (`:58`) salvo 413/400. La extracción de IP para el
    limiter ya tiene patrón en el repo: signup usa
    `req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown'` (`app/api/auth/signup/route.ts:51`). Tests existentes:
    `tests/api/csp-report.test.ts`.

---

## 2. Parámetros YA DECIDIDOS del corte (no re-abrir)

- **Rate limit por cliente:** reusar `consumeRateLimit`; scope propio
  `'chat:client'`; key = `clientId` (de la sesión, nunca del body);
  límite leído de config por cliente, **default 40/día**;
  `windowMs = 86_400_000`.
- **Semántica EXACTA de la ventana:** fija, alineada a la frontera de la
  época — `windowStart = floor(now / 86_400_000) * 86_400_000` — es
  decir, el "día" resetea a **medianoche UTC = 18:00 en CDMX** (UTC-6
  fijo; México no tiene DST desde 2022). Sin aproximaciones: no es
  rolling-24h ni medianoche local. Documentarlo en comment de la ruta.
- **`maxOutputTokens: 2000`.**
- **Cap ~8000 chars por mensaje** (TAMAÑO — complementa el C1 de
  cantidad; detalle de semántica en §4.3).
- **Caching, orden decidido:** la verificación de cache hits en la
  observability del gateway es **[MICHAEL — config humana]**, con
  evidencia de costo por request antes/después (baseline del corte
  2026-07-20: $0.22 / 28 requests = CERO caching); si no hay hits,
  `cache_control`/`providerOptions` explícito es **[CC — código]**.
  **EJECUTADA PRE-DISPATCH (2026-08-11): resultado CERO HITS → el
  wiring entra como scope normal de la tanda (§4.6).**
- **System prompt anti-invención:** recomendaciones cuantitativas SOLO
  derivadas aritméticamente de tool results — si no puede, debe decirlo
  y detenerse. Incluye el fix del framing "cuentas de la plataforma".
  Casos de prueba del smoke: §1.13 (a) y (b).
- **Gate:** ESTRICTO en route/config + smoke de calidad de Michael.
- La ruta del chat SE TOCA en T3 (el no-tocar de T2 expira acá); el
  matcher del middleware NO se toca (la condición Q-3 del ledger no se
  dispara: T3 no toca `middleware.ts`).

---

## 3. Scope de T3 (qué entra — todas las decisiones cerradas)

1. Campo `chatDailyLimit Int @default(40)` en `Client` + migración
   aditiva (§4.1 — DECIDIDO: opción A).
2. Rate limit en `app/api/ai/chat/route.ts` con `consumeRateLimit`
   (§4.2), 429 `RATE_LIMITED` con el shape estándar; path "Client
   inexistente con sesión viva" pinneado a 401 (E4).
3. AMBOS caps de tamaño (§4.3 — DECIDIDO): 8000 chars sobre la suma de
   text parts de cada mensaje user + 64KB sobre el JSON serializado de
   cualquier mensaje de la ventana trimmeada; ambos ⇒ 400
   `MESSAGE_TOO_LONG`.
4. `maxOutputTokens: 2000` en `streamText`.
5. System prompt: bloque anti-invención + fix de framing (§4.5), sin
   romper la byte-estabilidad (sigue siendo const de módulo).
6. Caching explícito `providerOptions`/`cacheControl` (§4.6 — ENTRA
   como scope normal: la verificación de Michael corrió PRE-dispatch
   con resultado CERO HITS).
7. Copy específico del 429 en `chat-panel.tsx` (§4.4 — DECIDIDO que
   entra, con E3: sin hora hardcodeada).
8. Rate limit por IP del `csp-report` (§4.7 — rider 1 APROBADO):
   scope `'csp-report:ip'`, 60 / 15 min, drop silencioso.
9. Tests de todo lo anterior (§6).

---

## 4. Diseño propuesto

### 4.1 Dónde vive la config por cliente — DECIDIDO: opción (A)

El corte pide "límite leído de config por cliente (default 40/día,
preparado para planes futuros)". Hoy no existe nada (§1.9). **Michael
fijó la opción (A): `chatDailyLimit Int @default(40)` en `model
Client`.** Migración aditiva de una línea; lectura = un `findUnique`
por PK en la ruta (barato, indexado); los seeds y tests no necesitan
tocar nada (default en DB). "Preparado para planes futuros" en su
versión mínima: cuando exista noción de plan, el plan escribe este
campo. (Las opciones B — tabla 1-1 — y C — constante — de la v1 quedan
descartadas.)

La migración es aditiva → mismo flujo del runbook de T2
(`docs/runbooks/t2-migraciones-runbook.md`): `migrate dev` contra
development la corre CC (DATABASE_URL exportada en shell desde
`.env.local`); staging y production las migra MICHAEL con string directo
de la consola de Neon (staging antes del smoke de preview, production
antes del merge). PROHIBIDO leer las vars legacy de Vercel.

### 4.2 Orden del handler y semántica del consumo

Orden propuesto en `POST`:

1. `requireAuth()` (ya existe) → 401.
2. Parse + `trimMessages` + cap de tamaño + `safeValidateUIMessages`
   (ya existen, más el cap nuevo) → 400.
3. **Recién acá** `consumeRateLimit({ scope: 'chat:client', key:
   clientId, limit, windowMs: 86_400_000 })` → si `!allowed`, 429
   `RATE_LIMITED`.
4. `streamText` con `maxOutputTokens: 2000`.

Razón del orden: la quota protege el COSTO del modelo; un request
malformado (400) no debe quemar quota. El consume va inmediatamente
antes de `streamText`, así `count ≤ limit` ≡ "requests que efectivamente
llegaron al modelo". Fail-open del limiter (heredado de T2): un hiccup
de Neon degrada a "sin límite", nunca a chat caído — coherente con la
política pinneada en T2 §5.2. El límite se lee de DB
(`db.client.findUnique` por PK, select mínimo de `chatDailyLimit`)
antes del consume.

**Path pinneado por E4 (ya NO a criterio del implementer):**
`findUnique` → `null` (Client borrado con sesión viva) ⇒ **401 con el
shape estándar** (`errorResponse`); el modelo NO se invoca y
`consumeRateLimit` NO se llama. Si el `findUnique` LANZA (DB caída):
comportamiento aceptado por el filtro — NO se agrega manejo nuevo; una
línea de comment lo documenta. Precisión empírica sobre el texto de la
enmienda (drift menor, reportado a Michael): en el handler actual NO
hay catch que cubra ese punto — el único try envuelve `req.json()`
(`route.ts:121-125`) y el `onError → 'CHAT_ERROR'` de `:185` aplica a
errores DEL STREAM, no a throws pre-`streamText` — así que un throw
del `findUnique` propaga al 500 default de Next (mismo patrón que las
rutas clase b/c del ledger; lo subsume el sweep `withRouteErrors()` de
T4). La DECISIÓN de E4 queda intacta (aceptado, cero manejo nuevo);
solo se corrige la descripción del comportamiento resultante (500
default, no CHAT_ERROR).

Sin `Retry-After` en el 429: T2 lo dejó como minor del ledger para el
limiter en general; el chat no lo estrena por su cuenta (consistencia).

### 4.3 Semántica del cap de tamaño — DECIDIDO: entran AMBOS caps

"~8000 chars por mensaje" tiene una arruga: en el formato UIMessage de
`ai@6` los tool results viven DENTRO de parts de mensajes assistant del
historial client-side, y un tool result legítimo (p.ej. 20 filas de
`getOneTableRows`) puede superar 8k serializado. Propuesta:

- **Cap duro de 8000 chars sobre la suma de text parts de cada mensaje
  `role: 'user'`** → 400 `MESSAGE_TOO_LONG` (code nuevo, shape
  estándar). Es el vector real: texto tipeado/pegado por el usuario.
- **Cap grueso de 64KB sobre el JSON serializado de CUALQUIER mensaje**
  (incluye assistant/tool parts) → mismo 400. Cierra el hueco de que el
  historial es client-side y un atacante autenticado puede forjar "tool
  results" gigantes; 64KB deja pasar con holgura todo resultado legítimo
  de las 7 tools (limits de filas pequeños por diseño).

Ambos caps corren pre-validación, sobre la ventana ya trimmeada (no
sobre los 30+ mensajes descartados). **DECIDIDO por Michael: entran
AMBOS.** Frontera exacta: 8000 chars exactos PASA; >8000 ⇒ 400
`MESSAGE_TOO_LONG` (mismo code para el cap grueso de 64KB).

**Nota E2 del filtro (aceptada, NO se implementa ahora):** queda un
residual de ~30×64KB ≈ 1.9MB por request (ventana llena de mensajes al
tope del cap grueso). Se anota en el ledger AL CIERRE de T3 como minor:
un request así revienta el contexto del modelo y falla en el gateway
antes de facturar; candidato futuro si duele: cap de ventana TOTAL.

### 4.4 UI del 429 — DECIDIDO: ENTRA, con enmienda E3

Con `useChat`/DefaultChatTransport, un 429 pre-stream cae en `error` y
el panel muestra "Vuelve a intentarlo" (§1.11) — copy engañoso para una
quota diaria. Scope: en `chat-panel.tsx`, si el error corresponde a
`RATE_LIMITED`, mostrar copy específico en tuteo.

**E3: el copy NO hardcodea "18:00".** La hora del próximo reset se
calcula EN EL CLIENTE — próxima medianoche UTC convertida a hora local
del browser vía `Date`/`toLocaleTimeString` — o el copy va sin hora.
Razón del filtro: municipios fronterizos de México con DST (UTC-7/-8)
— "18:00" solo vale en UTC-6. Preferencia: hora calculada; sin hora es
fallback aceptable si el cálculo ensucia el componente. El implementer
sigue VERIFICANDO empíricamente qué llega en `error.message` con
`ai@6.0.168` antes de codificar el match (regla empirical-first; no
asumir el shape del transport).

### 4.5 System prompt anti-invención

Editar `SYSTEM_PROMPT` (sigue const de módulo, cero interpolación).
Agregar a "Data discipline" (borrador para el implementer, en inglés
como el resto del prompt):

- Recomendaciones/planes cuantitativos (reorder quantities, targets,
  forecasts): SOLO si cada número se deriva aritméticamente de tool
  results de ESTA conversación, mostrando la operación; si no se puede,
  decir explícitamente que no hay base en los datos para recomendar una
  cifra y detenerse (ofrecer qué dato haría falta).
- Aritmética derivada: calcular con cuidado; porcentajes redondeados a
  un decimal o presentados como aproximados ("≈35%"), nunca una cifra
  precisa incorrecta (caso §1.13.b: 52→34 es -34.6%, no "33%").
- Nunca atribuir un agregado de cadena a un producto ni viceversa: cada
  cifra se reporta con el nivel exacto que la tool devolvió
  (caso §1.13.a).
- Framing: las cadenas (Soriana, Chedraui, ...) se llaman "cadenas" o
  "retailers"; PROHIBIDO "cuentas de la plataforma" u otra
  reinterpretación.

El texto final lo escribe el implementer; estos cuatro puntos son el
contrato. Los casos §1.13 (a) y (b) son los casos de prueba del smoke
de calidad de Michael.

### 4.6 Caching — ENTRA como scope normal (verificación corrida: CERO HITS)

La verificación de [MICHAEL] corrió PRE-dispatch sobre la observability
del gateway: resultado **CERO HITS** (consistente con el baseline del
corte, $0.22/28 requests). Por la decisión ya tomada en el corte, el
wiring explícito ENTRA a la tanda como scope normal, revisado por
AMBOS carriles como el resto del diff.

**E1 aplicada:** queda ELIMINADO el camino de la v1 "el implementer
deja el wiring FUERA y se agrega como fix-rider del mismo gate" — un
fix-rider post-review introduciría código sin doble review. No hay
condicional en la tanda: la decisión quedó resuelta antes del dispatch.

Mecánica: `providerOptions` con `anthropic.cacheControl`
(`{ type: 'ephemeral' }`) sobre system prompt + tools — la opción existe
en `streamText` de `ai@6.0.168` (§1.7), pero el punto EXACTO de anclaje
(call-level vs message-level, y cómo lo propaga el gateway con model
string) lo verifica el implementer empíricamente (scratch + doc del AI
SDK instalado) ANTES de codificar — no se asume de memoria. Cierre de
esta pieza: evidencia de Michael post-deploy (costo por request menor +
hits visibles en la observability), no solo el diff.

### 4.7 Rate limit por IP del csp-report (rider 1 — APROBADO, entra)

Estado actual verificado en §1.14. Diseño fijado por Michael:
`consumeRateLimit` con scope `'csp-report:ip'`, key = IP (mismo patrón
de extracción que signup: primer entry de `x-forwarded-for`, fallback
`'unknown'` — `app/api/auth/signup/route.ts:51`), **límite 60 /
`windowMs` 900_000** (15 min, misma ventana que auth). Al exceder:
**204 SIN loguear el reporte** — drop silencioso: no dar feedback del
umbral al atacante y proteger la señal "cero violations" que habilita
el flip de CSP en T6. Orden en el handler: el consume corre DESPUÉS de
los caps de body existentes (un 413/400 no quema budget del IP) y
ANTES del `console.warn`. Nota: esto introduce la PRIMERA dependencia
de DB de la ruta (el comment `:11` "No DB" se actualiza en el diff);
el fail-open del limiter garantiza que una DB caída degrada a "loguear
todo", nunca a perder reportes ni a tirar el endpoint.

---

## 5. Estructura del task: TANDA ÚNICA

Diff proyectado: `schema.prisma` (1 campo) + 1 migración aditiva +
`app/api/ai/chat/route.ts` (~50-70 líneas entre limiter, caps, params,
prompt y providerOptions) + `app/api/csp-report/route.ts` (~10-15
líneas, §4.7) + `components/analisis/chat-panel.tsx` (~10-15 líneas,
§4.4) + tests (~200-250 líneas en dos archivos existentes). Sin forks
condicionales: TODAS las decisiones quedaron cerradas pre-dispatch
(§DECISIONES CERRADAS). Muy por debajo del umbral que en T2 justificó
dos tandas (deps+config vs data layer). **UN implementer, UNA tanda,
doble review ciega, un fix pass.** El prompt del implementer:
autocontenido, con este brief como fuente + prefijo supply-chain
literal.

---

## 6. Test plan (Vitest contra development, guard T1 activo)

Baseline: **461 tests / 49 archivos**. Chat en
`tests/ai/chat-route.test.ts` (infra de mocks ya existente, §1.12),
csp-report en `tests/api/csp-report.test.ts` (existente, §1.14);
`lib/rate-limit.ts` NO se re-testea (cubierto en T2) — se mockea
`@/lib/db` o directamente `@/lib/rate-limit` según el nivel:

- 429 `RATE_LIMITED` cuando `consumeRateLimit` → `!allowed`; shape
  estándar `{error:{code,message}}`; el modelo NO se invoca (assert
  sobre el mock de `chatModel`).
- Request válido consume con `{ scope: 'chat:client', key: clientId
  de la SESIÓN, windowMs: 86_400_000, limit: <valor del Client> }`
  (assert de args — clava scope/key/window contra regresiones).
- Límite leído del Client: default 40 y un valor custom (mock del
  `findUnique`).
- 400 `MESSAGE_TOO_LONG`: user message de >8000 chars; mensaje de
  exactamente 8000 pasa (frontera); si entra el cap grueso: mensaje
  assistant con parts serializadas >64KB → 400.
- Un 400 (body inválido o cap) NO consume quota (assert de que
  `consumeRateLimit` no fue llamado).
- `maxOutputTokens: 2000` llega al modelo (assert sobre las
  callOptions capturadas por `MockLanguageModelV3`).
- System prompt: assert de que contiene los marcadores anti-invención
  y NO contiene interpolación volátil (sigue siendo el const).
- Fail-open: `consumeRateLimit` que resuelve `{allowed:true,count:0}`
  (comportamiento T2 ante DB caída) → el chat responde normal.
- **E4:** `findUnique` → `null` ⇒ 401 shape estándar, modelo NO
  invocado, `consumeRateLimit` NO llamado. (El path "findUnique lanza"
  no lleva test nuevo: comportamiento aceptado sin manejo nuevo,
  §4.2.)
- Caching (§4.6): `providerOptions`/`cacheControl` llega al modelo —
  assert sobre las callOptions capturadas por `MockLanguageModelV3`,
  ajustado a la mecánica de anclaje que el implementer verifique.
- csp-report (§4.7, en `tests/api/csp-report.test.ts`): bajo el límite
  → 204 + `console.warn` llamado; `consumeRateLimit` → `!allowed` ⇒
  204 y `console.warn` NO llamado (drop silencioso — el status NO
  cambia); args del consume clavados (`scope: 'csp-report:ip'`, key de
  `x-forwarded-for`, `limit: 60`, `windowMs: 900_000`); un 413 por cap
  de body NO consume budget.

Reglas operativas: avisar a Michael antes de correr la suite (posible
`pnpm dev` activo); cero procesos huérfanos antes del dispatch; un solo
proceso de test contra la dev DB.

## 7. No-tocar

- `lib/rate-limit.ts` — se REUSA tal cual; el límite es parámetro.
- `core/ai/tools/*` — la deuda del ledger (spread de input, dup slice)
  queda donde está; T3 no la paga.
- `middleware.ts` — no se toca; Q-3 no se dispara.
- `lib/ai/model.ts` — el modelo queda `anthropic/claude-haiku-4.5`.
- `temperature` — NO se setea (fuera del corte; queda como ítem MEDIO
  del ledger).
- `getDefaultPeriod` / semántica de período del chat — pregunta de
  producto diferida a uso real de VIKS (ledger, Pre-lanzamiento).
- `scripts/preflight.ts` (LEGACY), vars legacy de Vercel, `.env*`.

## 8. Riders — RESUELTOS por Michael (2026-08-11)

1. **Rate limit por IP del `csp-report` — APROBADO, ENTRA al scope**
   (diseño en §4.7, estado empírico en §1.14). Deja de ser rider: es
   scope normal de la tanda, revisado por ambos carriles. Valor: la
   señal "cero violations" que habilita el flip de CSP en T6 deja de
   ser envenenable por flood.
2. **Pre-check de `AI_GATEWAY_API_KEY` al boot — NO ENTRA.** Queda en
   el ledger (sev BAJA): el fallo ya es observable (CHAT_ERROR + logs).
3. **Anotar en el ledger el hallazgo §1.13.b — CONFIRMADO** (docs del
   cierre de T3, mismo commit de cierre; junto con el minor E2 del
   residual de ventana total, §4.3).

## 9. Split [CC] / [MICHAEL]

**[CC — código]** Campo `chatDailyLimit` + migración (dev) + rate limit
429 + path 401 de E4 + AMBOS caps de tamaño + `maxOutputTokens` +
system prompt anti-invención + providerOptions de caching (§4.6) +
rate limit del csp-report (§4.7) + copy del 429 en el panel (§4.4/E3)
+ tests.

**[MICHAEL — configuración humana]**
- ~~Decidir §4.1~~ HECHO (opción A). ~~Verificar cache hits~~ HECHO
  pre-dispatch: CERO HITS (§4.6).
- Autorizar la migración; `migrate deploy` en staging (pre-smoke de
  preview) y production (pre-merge) con strings directos de Neon
  (runbook T2).
- Smoke de calidad sobre la URL de preview: pedir recomendaciones de
  reorden/compra y verificar que el bot se detiene o deriva con
  aritmética explícita en vez de inventar (casos §1.13 a y b como
  guiones); verificar que nunca dice "cuentas de la plataforma";
  smoke e2e del flow completo del chat (regla de smoke completo: el
  gate toca UI vía §4.4); disparar el 429 si es práctico (bajar el
  límite del Client de prueba en staging a 2-3 vía SQL) y verificar el
  copy nuevo sin hora hardcodeada.
- Post-deploy: evidencia de caching en la observability (costo por
  request menor + hits visibles) — cierre de la pieza §4.6.

## 10. Gate

ESTRICTO en route/config: diff crudo completo + ambos outputs de review
a Michael ANTES de commit. Cierre del gate = smoke de calidad de
Michael sobre preview (contra staging migrada) + evidencia de caching
(§4.6). Merge: solo Michael. Los minors no bloqueantes de la doble
review van al ledger (`git add -f`) en el mismo commit.

## DECISIONES CERRADAS (Michael vía filtro externo, 2026-08-11)

Reemplaza la sección OPEN QUESTIONS de la v1 — nada queda abierto:

1. **OQ1 → opción (A):** `chatDailyLimit Int @default(40)` en `model
   Client`; migración aditiva, flujo del runbook de T2 (§4.1).
2. **OQ2 → AMBOS caps:** 8000 chars sobre la suma de text parts de
   cada mensaje user (8000 exactos pasa) + 64KB sobre el JSON
   serializado de cualquier mensaje de la ventana trimmeada; ambos ⇒
   400 `MESSAGE_TOO_LONG` (§4.3). Residual E2 → ledger al cierre.
3. **OQ3 → ENTRA** el copy específico del 429 en `chat-panel.tsx`, con
   E3: sin "18:00" hardcodeado — hora calculada client-side (próxima
   medianoche UTC → hora local) o copy sin hora (§4.4).
4. **Rider 1 → ENTRA** (csp-report, §4.7: `'csp-report:ip'`, 60/15min,
   drop silencioso 204 + test). **Rider 2 → NO entra** (ledger).
   **Rider 3 → confirmado** (docs del cierre).
5. **Caching:** verificación [MICHAEL] corrida PRE-dispatch → **CERO
   HITS** → el wiring `providerOptions`/`cacheControl` entra como
   scope normal de la tanda (§4.6; E1: eliminado el camino fix-rider).
6. **Enmiendas E1-E4 aplicadas** en §4.6, §4.3, §4.4 y §4.2+§6
   respectivamente.
