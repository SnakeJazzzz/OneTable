# T5 — COPY: reporte del implementer (2026-08-15)

> Brief frozen: `.superpowers/sdd/t5-copy-brief.md` @ `506fd7a`.
> Branch `feat/hardening-t5`. Árbol SUCIO, cero git (21 archivos M).
> Este archivo NO se commitea.

## 1. Resumen de cambios por archivo

### 1.1 Barrido voseo→tuteo (§4.1 — los 23 hits, cero cambio de lógica)

API / core (5):
- `app/api/portales/mappings/route.ts:51` — "Resolvé el conflicto" → "Resuelve el conflicto"
- `app/api/portales/mappings/route.ts:91` — "resolvelo desde" → "resuélvelo desde"
- `app/api/portales/mappings/route.ts:137` — ídem (replace de ambas ocurrencias del mismo string)
- `app/api/parametros/import/route.ts:69` — "Verificá que sea" → "Verifica que sea"
- `core/parameters/import.ts:17` — "exportá primero" → "exporta primero"

UI (18):
- `app/(auth)/login/page.tsx:55` — "Accedé" → "Accede"
- `app/(auth)/login/page.tsx:97` — "¿No tenés cuenta?" → "¿No tienes cuenta?"
- `app/(auth)/signup/page.tsx:92` — "Empezá" → "Empieza"
- `app/(auth)/signup/page.tsx:152` — "¿Ya tenés cuenta?" → "¿Ya tienes cuenta?"
- `app/(dashboard)/analisis/page.tsx:73` — "Subí" → "Sube"
- `app/(dashboard)/portales/page.tsx:10` — "Configurá" → "Configura"
- `components/dashboard/conflict-banner.tsx:13` — "Resolvelos" → "Resuélvelos"
- `components/dashboard/dashboard-empty.tsx:17` — "Subí" → "Sube"
- `components/portales/conflict-section.tsx:10` — "Resolvé" → "Resuelve"
- `components/portales/chain-upload.tsx:242` — "Arrastrá o hacé clic" → "Arrastra o haz clic"
- `components/portales/mapping-section.tsx:173` — "Seleccioná" → "Selecciona"
- `components/portales/mapping-section.tsx:248` — "Revisá" → "Revisa"
- `components/portales/mapping-section.tsx:712` — "Resolvelo" → "Resuélvelo"
- `components/portales/mapping-section.tsx:836` — "mapeá" → "mapea"
- `components/parametros/import-zone.tsx:137` — "exportá" → "exporta"
- `components/parametros/import-zone.tsx:186` — "Arrastrá … hacé clic" → "Arrastra … haz clic"
- `components/parametros/thresholds-form.tsx:82` — "Ingresá" → "Ingresa"
- `components/parametros/sku-table.tsx:347` — "Agregá … importá" → "Agrega … importa"

R-1: cero formas voseantes NO listadas encontradas (los 3 greps de
cierre no cazaron nada nuevo). Sin deltas de barrido.

### 1.2 chat-panel.tsx (§4.2, los 5 puntos — CÓDIGO)

`components/analisis/chat-panel.tsx`:
- **Q-1 / errorCodeOf:** `isRateLimitError` (ex :37-44) generalizado a
  `errorCodeOf(error): string | null` (ahora :52-59), LOCAL, con el
  comment "Deliberately LOCAL: promote to lib/ when a second consumer
  exists". Const nueva `MESSAGE_TOO_LONG_COPY` (:39-43) con el copy
  EXACTO del brief: "Tu mensaje es demasiado largo para enviarse.
  Acórtalo e inténtalo de nuevo."
- **Render del error** (ahora :232-260): branch triple sobre
  `errorCode` — `RATE_LIMITED` → copy de cuota (sin punto final tras la
  hora); `MESSAGE_TOO_LONG` → copy nuevo SIN botón Reintentar (rider
  S-1); resto → `ERROR_COPY` + Reintentar como hoy.
- **Limpieza del historial + restauración (§4.2.2 / E2)** (:135-171):
  efecto disparado por `error`, con guard anti-loop `handledErrorRef`
  (una vez por objeto de error). Si `errorCodeOf(error) ===
  'MESSAGE_TOO_LONG'`: `setMessages` (functional updater) remueve el
  ÚLTIMO mensaje de usuario sin mensaje de asistente posterior (loop
  desde el final, break en el primer 'assistant'); el texto de las
  parts tipo 'text' del removido se restaura con el `setInput` local.
  El criterio NO usa la constante 8000.
- **Q-2** (:124-131): `quotaResetTime = useMemo(() => (error ?
  quotaResetLocalTime() : null), [error])` — capturada una vez por
  objeto de error; el JSX y el announcer usan la memo, ya no la llamada
  inline por render.
- **Q-3** (:298-311): announcer `aria-live` ramifica con el mismo
  `errorCode`, simétrico al render: 429 → copy de cuota con hora; 400 →
  `MESSAGE_TOO_LONG_COPY`; resto → genérico actual.
- **Punto doble** (:239-241): removido el "." del JSX tras
  `{quotaResetTime}` (la hora es-MX ya termina en "a.m."/"p.m.").
- Header comment del archivo actualizado a la semántica nueva.

### 1.3 Signup (§4.3)

- `app/(auth)/signup/page.tsx:25` — `PASSWORD_TOO_LONG` del cliente →
  "La contraseña es demasiado larga. Usa una más corta." El message del
  server (`signup/route.ts`, "máximo 72 bytes") NO se tocó.

### 1.4 Política de idioma OQ-1=A (§4.4 — lista exacta, codes intactos)

`app/api/data/upload/route.ts` (familia per-file, R-3: datos dinámicos
y nombres de campo `chain`/`fileType` preservados literales):
- :165 → "el campo chain debe ser texto plano, no un archivo"
- :166 → "falta el campo chain"
- :167 → `cadena desconocida: "X"`
- :168 → "el campo fileType debe ser texto plano, no un archivo"
- :169 → "falta el campo fileType"
- :170 → `fileType desconocido: "X"`
- :171 → `metadatos de carga inválidos: ${issues.join('; ')}`
- :197 (ALL_FILES_FAILED) → "No se pudo procesar ningún archivo."
- :240 → `archivo demasiado grande: ${file.size} bytes (máximo ${MAX_UPLOAD_FILE_BYTES} bytes / 10 MB)`
- :249-250 → "tipo de archivo desconocido — el nombre debe corresponder a soriana, chedraui, amazon ventas o amazon inv"
- :258 → `no hay parser para ${resolved.chain}/${resolved.fileType}`

Top-level y compartidos:
- `app/api/portales/mappings/route.ts:46` (PRODUCT_NOT_FOUND) → "Ese SKU no existe en tu catálogo." (armoniza con :143 existente)
- `app/api/portales/price-overrides/route.ts:132` y :156 (PRODUCT_NOT_FOUND) → ídem
- `lib/auth-helpers.ts:53` (UNAUTHORIZED de `requireAuth`) → "Tu sesión expiró. Inicia sesión de nuevo."
- `app/api/ai/chat/route.ts:269-276` (RATE_LIMITED 429) → "Daily chat quota exceeded" (+ comment dev-facing). El UNAUTHORIZED de la ruta del chat (:256, ahora :259) queda "Sign in required" en inglés, como manda el brief.

El catch-all del parser y todo el plumbing inglés declarado: sin cambios.

### 1.5 Tests (§6)

`tests/api/upload.test.ts` — los 7 asserts regex actualizados:
- :160, :175 — `/invalid explicit/` → `/metadatos de carga inválidos/`
- :190 — `/chain field missing/` → `/falta el campo chain/`
- :213 — `/chain field must be a plain text value, not a file/` → `/el campo chain debe ser texto plano, no un archivo/`
- :240 — `/file too large/` → `/archivo demasiado grande/`
- :252 — assert NEGADO `.not.toMatch(/file too large/)` → `.not.toMatch(/archivo demasiado grande/)` (sigue negado)
- :269 — `/unknown file type/` → `/tipo de archivo desconocido/`

Ningún otro test necesitó cambios (suite completa GREEN sin más ajustes).

## 2. Verificación R-2 (empírica, contra node_modules instalados, ANTES de codear)

Source-verified (el source instalado ES el runtime):
- **(i) `setMessages`:** existe en types
  (`node_modules/@ai-sdk/react/dist/index.d.ts`, `UseChatHelpers`) Y en
  runtime (`dist/index.mjs:210-217`): el functional updater se ejecuta
  SINCRÓNICAMENTE (`messagesParam = messagesParam(chatRef.current.messages)`)
  y asigna `chatRef.current.messages = messagesParam`. El setter de
  `messages` en `AbstractChat` (`node_modules/ai/dist/index.mjs:13110-13112`)
  es `this.state.messages = messages` — asignación pura de estado, CERO
  requests, cero `makeRequest`, cero `sendAutomaticallyWhen` (ese solo
  corre dentro del flow de request). Mutarlo en un efecto post-error no
  re-dispara nada. La ejecución sincrónica del updater es además lo que
  garantiza que `restoredText` esté poblado antes del `setInput`.
- **(ii) Restauración del input:** confirmado que el input es estado
  LOCAL (`useState`, `chat-panel.tsx:103` pre-cambio) — `useChat` de
  `@ai-sdk/react@3.0.170` no gestiona input (no hay `input`/`setInput`
  en `UseChatHelpers`; sí existen en `useCompletion`, que no usamos).
  Mecanismo implementado: `setInput` local + texto extraído de las
  parts `type === 'text'` del mensaje removido (join con '\n'; en la
  práctica el panel manda un único text part vía `sendMessage({ text })`).
- **(iii) Premisa del envenenamiento:** confirmado en
  `app/api/ai/chat/route.ts:180-190` — `exceedsSizeCaps(trimmed)` itera
  TODOS los mensajes de la ventana trimmed (últimos 30) y cualquier
  mensaje de usuario > `MAX_USER_MESSAGE_CHARS` re-dispara el 400. La
  remoción del ofensor del estado local es necesaria y suficiente.

Queda al smoke de Michael (sin infra de component tests — §1.8):
- El ciclo completo montado en DOM real: pegar >8,000 chars → copy
  nuevo sin Reintentar + texto restaurado en el input → acortar →
  respuesta normal (guión §10 paso 2).
- El announcer (`role="status"`) reflejando causa específica (paso 4).
- La hora del 429 estable por objeto de error (paso 3).

## 3. Deltas contra el brief frozen

- **Ninguno de sustancia.** Los 23 hits estaban donde el brief dice;
  los strings propuestos de §4.4 se aplicaron tal cual; los 7 asserts
  eran exactamente los listados; ningún otro test falló por strings.
- Micro-nota (no-delta): tras las ediciones, algunas referencias de
  línea del brief corren unas líneas (p.ej. el 429 del chat quedó en
  `route.ts:269-276` por el comment dev-facing agregado; el UNAUTHORIZED
  del chat quedó en :259). Codes intactos en todos los casos.
- Flake de infra (no relacionado): la PRIMERA corrida de la suite
  completa falló en `tests/normalizer/resolve.test.ts` (error de Prisma
  en el `seedClient` — `db.user.deleteMany` — durante la corrida de
  ~249s contra la Neon dev DB). El archivo pasa 26/26 en aislamiento y
  la re-corrida completa quedó GREEN 510/510. No toqué código de
  normalizer; consistente con drop transitorio de conexión.

## 4. Greps de cierre (§1.1) — falsos positivos remanentes

- **Grep 1 (dirigido):** CERO hits (exit 1).
- **Grep 3 (-ás/-és/-ís + sos):** 5 hits, todos falsos positivos:
  "más" ×3 (`signup/page.tsx:25` copy nuevo, `chain-upload.tsx:339`,
  `import-zone.tsx:252`) y "Podrás" ×2 (`chat-panel.tsx:239,269` —
  futuro, no voseo).
- **Grep 2 (tilde final):** solo palabras no-verbales / no-voseo:
  "está" ×5 (signup:22, mappings:51,91,137, db-guard:113,
  chat-panel:266), "solicitará" ×2 (credentials-form:60,63), "aquí" ×4
  (chain-upload:200, sku-table:224, import-zone:146,186), "mostrará"
  (dashboard-charts:175), "Qué" (chat-panel:212) y "vendí"
  (chat-panel:211 — la exclusión declarada del brief, primera persona
  del pasado, NO tocado).

## 5. Comandos de cierre

- `pnpm test`: **GREEN — 53 files passed (53), 510 tests passed (510)**,
  duración 221s. (Primera corrida: 52/53 con el flake de §3; re-corrida
  única instancia, cero procesos huérfanos al cierre, verificado con
  `ps aux | grep -E "vitest|pnpm test"`.)
- `pnpm typecheck`: **GREEN** (exit 0, cero errores).
- `pnpm build`: **GREEN** (compila, lint pasa; únicos warnings los
  pre-existentes: deprecación `package.json#prisma` — pendiente
  conocido #3 — y los MODULE_TYPELESS de `lib/security-headers.ts`).
- 3 greps §1.1: limpios (detalle en §4).
- Checkpoint §1.7 (carril spec, verificado también aquí): los dos
  literales "Sign in required" en tests SON autocontenidos —
  `tests/ai/chat-route.test.ts:278` construye el 401 con
  `errorResponse(...)` inline para mockear `requireAuth`;
  `tests/lib/route-errors.test.ts:47` arma la Response a mano. Ninguno
  importa el message de `lib/auth-helpers.ts`. Suite GREEN lo confirma.

## 6. Verificación supply-chain (punto 8)

- `./scripts/check-supply-chain.sh` → "✅ Clean — no infection markers
  detected".
- `grep -E '"[\^~]' package.json` → cero hits (pins exact OK).
- Grep del lockfile contra tokens sospechosos → cero hits (lockfile
  clean OK).
- **Cero installs, cero paquetes nuevos, cero archivos nuevos de
  código** (este reporte es el único archivo nuevo, y es el entregable
  requerido).

## 7. Estado del árbol

SUCIO por diseño (implementer para en GREEN sin git): 21 archivos `M`
(los listados en §1) + este reporte untracked. Cero add/commit/push/
stash. Cero shells de background vivas.
