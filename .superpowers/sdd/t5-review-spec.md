# T5 — Review carril SPEC (compliance contra brief frozen)

> Reviewer: carril spec, review ciega (sin acceso al carril quality).
> Brief: `.superpowers/sdd/t5-copy-brief.md` @ `506fd7a` (HEAD verificado:
> `506fd7a1d26c...`). Diff contrastado: `.superpowers/sdd/t5-working-diff.txt`
> vs working tree real (`git diff` — 21 archivos M, coincide 1:1 con el
> diff entregado; cero untracked de código). Reporte del implementer
> contrastado claim por claim. Fecha: 2026-08-15.
> Alcance: EXCLUSIVAMENTE compliance contra la letra del brief. Cero
> juicios de calidad/estilo (carril quality).

---

## Veredicto global: **PASS**

Cero desviaciones MAJOR. Cero desviaciones MINOR contra la letra del
brief. Ambos checkpoints obligatorios: PASS. Un slip aritmético trivial
en el REPORTE del implementer (no en el código) — anotado abajo, no es
desviación del diff.

---

## 1. Veredicto por ítem del brief

### §4.1 + §3.1 — Barrido voseo→tuteo (23 hits): **COMPLIANT**

- Los 23 hits accionables de la tabla §1.1 están todos en el diff, en
  los sitios exactos, con las equivalencias EXACTAS de §3.1
  (Resolvé→Resuelve, resolvelo→resuélvelo, Resolvelos→Resuélvelos,
  Verificá→Verifica, exportá→exporta, Accedé→Accede, tenés→tienes,
  Empezá→Empieza, Subí→Sube, Configurá→Configura, Arrastrá→Arrastra,
  hacé→haz, Seleccioná→Selecciona, Revisá→Revisa, mapeá→mapea,
  Ingresá→Ingresa, Agregá→Agrega, importá→importa). Conteo por archivo
  re-verificado contra el diff: login ×2, signup ×2 (sin contar §4.3),
  analisis ×1, portales page ×1, mappings route ×3, parametros/import
  route ×1, core/parameters/import.ts ×1, conflict-banner ×1,
  dashboard-empty ×1, import-zone ×2, sku-table ×1, thresholds-form ×1,
  chain-upload ×1, conflict-section ×1, mapping-section ×4 = **23**.
- Cero cambio de lógica en esos hunks: todos son string-only
  (verificado hunk por hunk en el diff).
- **Los 3 greps de §1.1 re-corridos por este reviewer (2026-08-15,
  working tree):**
  - Grep 1 (dirigido): **CERO hits** (exit 1).
  - Grep 2 (tilde final): 15 hits, todos no-voseantes: "está" ×6
    (signup:22, mappings:51,91,137, db-guard:113, chat-panel:266),
    "solicitará" ×2, "aquí" ×4, "mostrará" ×1, "Qué" ×1, "vendí" ×1
    (`chat-panel.tsx:211` — la exclusión declarada del brief, INTACTA).
  - Grep 3 (-ás/-és/-ís + sos): 5 hits, todos falsos positivos: "más"
    ×3 (signup:25 — copy nuevo de §4.3 —, chain-upload:339,
    import-zone:252), "Podrás" ×2 (chat-panel:239,269 — futuro).
  - **Cero líneas voseantes accionables.** Criterio de cierre del
    barrido: CUMPLIDO.
- R-1: el implementer reporta cero formas nuevas; mis greps lo
  confirman.

### §4.2 — chat-panel.tsx, los 5 puntos: **COMPLIANT**

Archivo post-diff leído completo (`components/analisis/chat-panel.tsx`).

1. **errorCodeOf LOCAL + comment de promoción:** `errorCodeOf(error):
   string | null` en `:51-58`, generalización directa del ex
   `isRateLimitError` (parsea el body JSON del transport, devuelve
   `parsed.error?.code ?? null`). Comment presente: "Deliberately
   LOCAL: promote to lib/ when a second consumer exists" (`:50`) — en
   inglés, conforme §7. COMPLIANT.
2. **Copy del 400 EXACTO, sin Reintentar:** `MESSAGE_TOO_LONG_COPY`
   (`:41-42`) = "Tu mensaje es demasiado largo para enviarse. Acórtalo
   e inténtalo de nuevo." — byte-exacto contra §2 OQ-4 / §4.2.1. El
   branch `MESSAGE_TOO_LONG` del render (`:243-249`) NO tiene botón
   Reintentar (el botón solo existe en el branch genérico `:250-256`,
   como manda "resto → ERROR_COPY + Reintentar, como hoy"). El branch
   `RATE_LIMITED` (`:233-242`) tampoco lo tiene (rider S-1 preservado).
   COMPLIANT.
3. **Limpieza E2 + restauración:** efecto en `:150-177`. Verificado
   contra la letra:
   - Remueve **el último mensaje de usuario sin respuesta de asistente
     posterior**: loop desde el final, `break` al primer 'assistant'
     antes de encontrar un 'user' (`:161-167`) — implementa
     exactamente el criterio del brief.
   - **SIN la constante 8000 en el cliente**: cero literal 8000 /
     MAX_USER_MESSAGE_CHARS en el panel (verificado por lectura
     completa del archivo).
   - **Restaura el texto al input**: extrae las parts `type === 'text'`
     del mensaje removido y `setInput(restoredText)` (`:169-176`) —
     mecanismo esperado por R-2 (input es estado local `useState`,
     `:125`).
   - **Una vez por objeto de error, guard anti-loop**:
     `handledErrorRef` (ref al último error procesado, `:150-153`) —
     exactamente el mecanismo sugerido por el brief.
   - R-2 (verificación empírica types+runtime de `setMessages` /
     `setInput`): el reporte §2 documenta verificación source-level
     contra `@ai-sdk/react@3.0.170` y `ai` instalados (updater
     sincrónico, setter puro sin requests) ANTES de codear. Cumple la
     letra de R-2; la validación en DOM real queda al smoke §10 paso 2,
     como el propio brief lo estructura (§1.8: sin infra de component
     tests). COMPLIANT.
4. **Q-2:** `quotaResetTime = useMemo(() => (error ?
   quotaResetLocalTime() : null), [error])` (`:138-141`) — capturada
   una vez por objeto de error; el JSX (`:240`) y el announcer (`:269`)
   consumen la memo; cero llamadas inline a `quotaResetLocalTime()` en
   render. Es literalmente el fix candidato que el brief propone.
   COMPLIANT.
5. **Q-3:** announcer `aria-live` (`:264-276`) ramifica sobre el MISMO
   `errorCode` que el render visual, simétrico: 429 → copy de cuota con
   hora (mismo texto que el visual, sin punto final tras la hora), 400
   → `MESSAGE_TOO_LONG_COPY`, resto → genérico actual. COMPLIANT.
6. **Punto doble del 429:** el JSX cierra en `{quotaResetTime}` sin "."
   posterior (`:240`), y el announcer ídem (`:269`) — "…p.m.." resuelto
   en ambos surfaces. COMPLIANT.

### §4.3 — Signup: **COMPLIANT**

- `app/(auth)/signup/page.tsx:25` → `PASSWORD_TOO_LONG: 'La contraseña
  es demasiado larga. Usa una más corta.'` — byte-exacto contra OQ-2=(a).
  Sin número, sin reglas de bytes.
- Server INTACTO: `app/api/auth/signup/route.ts:88-91` sigue con
  `Buffer.byteLength` y el message "Tu contraseña es demasiado larga
  (máximo ${MAX_PASSWORD_BYTES} bytes)" — sin cambios (el archivo ni
  aparece en el diff).

### §4.4 — Política de idioma OQ-1=A, lista EXACTA: **COMPLIANT**

**Inglés → español** — cada string cotejado carácter por carácter
contra la tabla del brief:

| Sitio | String aplicado | ¿Exacto? |
|---|---|---|
| upload :171 | `metadatos de carga inválidos: ${issues.join('; ')}` | SÍ |
| upload :165 | `el campo chain debe ser texto plano, no un archivo` | SÍ |
| upload :166 | `falta el campo chain` | SÍ |
| upload :167 | `cadena desconocida: "${chainStr}"` | SÍ |
| upload :168 | `el campo fileType debe ser texto plano, no un archivo` | SÍ |
| upload :169 | `falta el campo fileType` | SÍ |
| upload :170 | `fileType desconocido: "${fileTypeStr}"` | SÍ |
| upload :240 | `archivo demasiado grande: ${file.size} bytes (máximo ${MAX_UPLOAD_FILE_BYTES} bytes / 10 MB)` | SÍ |
| upload :246-249 | `tipo de archivo desconocido — el nombre debe corresponder a soriana, chedraui, amazon ventas o amazon inv` | SÍ (em-dash preservado) |
| upload :255-258 | `no hay parser para ${resolved.chain}/${resolved.fileType}` | SÍ |
| upload :197 ALL_FILES_FAILED | `No se pudo procesar ningún archivo.` | SÍ |
| mappings :46 PRODUCT_NOT_FOUND | `Ese SKU no existe en tu catálogo.` | SÍ (armoniza con :143 existente) |
| price-overrides :132 y :156 PRODUCT_NOT_FOUND | ídem ×2 | SÍ |
| lib/auth-helpers.ts :53 UNAUTHORIZED | `Tu sesión expiró. Inicia sesión de nuevo.` | SÍ (redacción validada por Michael) |

**Español → inglés:** `ai/chat/route.ts` 429 RATE_LIMITED → `Daily
chat quota exceeded` — exacto (con comment dev-facing en inglés).

**Codes inmutables:** en el diff, cada code aparece en pares
removed/added idénticos (ALL_FILES_FAILED, CONFLICTED ×2 pares,
CONFLICT_EXISTS, PRODUCT_NOT_FOUND ×3 pares, UNAUTHORIZED); RATE_LIMITED
e INVALID_XLSX ni figuran en líneas cambiadas (solo cambió la línea del
message). CERO codes tocados.

**R-3:** todos los datos dinámicos preservados (`${chainStr}`,
`${fileTypeStr}`, `${file.size}`, `${MAX_UPLOAD_FILE_BYTES}`,
`${resolved.chain}/${resolved.fileType}`, `${issues.join('; ')}`) y los
nombres de campo `chain`/`fileType` quedaron LITERALES en los strings
traducidos. COMPLIANT.

**Lo declarado inglés quedó INTACTO** (verificado por grep post-diff en
el working tree):
- INVALID_BODY family: chat route :201, :209-213 ("Request body must be
  valid JSON" / "…must include a 'messages' array") — intactos.
- INVALID_MESSAGES: "Conversation must include a user message" (:220-224),
  "Messages are not valid" (:242) — intactos.
- MESSAGE_TOO_LONG del server: "A message exceeds the allowed size"
  (:227-233) — intacto.
- UNAUTHORIZED del chat route: "Sign in required" (:256, post-diff) —
  intacto en inglés, como manda el brief.
- INVALID_CHAIN "Unknown chain": 10+ sitios verificados — intactos.
- NO_FILES "No files in request (use field name 'files')"
  (upload :140), NO_FILE "No file in request (field 'file')"
  (parametros/import :39), INVALID_MULTIPART ×2 ("Could not parse
  multipart body: …", upload :125-126 e import :31-32) — intactos.
- PASSWORD_TOO_LONG server "(máximo … bytes)" — intacto (ver §4.3).
- Catch-all de parsers (upload route, bloque catch `err.message` →
  `{ filename, error: message }`) — intacto, diagnóstico crudo en
  inglés como resto declarado.
- `clients/route.ts:28` "Authenticated client not found" — intacto
  (archivo fuera del diff).
- FILE_TOO_LARGE de parametros/import (:50, ya español sin voseo) —
  intacto, conforme E5 ("ya cumple — cero cambios").

### §6 — Tests: **COMPLIANT**

- Los **7 asserts** de `tests/api/upload.test.ts` ajustados, exactamente
  los del brief: :160 y :175 (`/invalid explicit/` → `/metadatos de
  carga inválidos/`), :190 (`/falta el campo chain/`), :213 (`/el campo
  chain debe ser texto plano, no un archivo/`), :240 (`/archivo
  demasiado grande/`), **:252 NEGADO preservado**
  (`.not.toMatch(/archivo demasiado grande/)` — sigue `.not`), :269
  (`/tipo de archivo desconocido/`). Cada regex nueva matchea el string
  de producción nuevo correspondiente.
- **Ningún otro test tocado**: `git diff --name-only` bajo `tests/` =
  solo `upload.test.ts`. Grep de los strings viejos sobre tests/ →
  cero ASSERTS remanentes (los 2 hits que quedan, :198 y :251, son
  COMMENTS del test, no asserts — el brief solo manda ajustar los 7
  asserts). Grep de "SKU not in your catalog", "No files could be
  processed", "Alcanzaste tu límite" en tests/ → cero hits, confirmando
  la premisa del brief (esos tests assert-ean code).
- Baseline: el implementer reporta suite GREEN 510/510 en 53 archivos
  (re-corrida tras un flake de conexión Neon en la primera, ajeno al
  diff — no toca normalizer). No re-corrí la suite (prohibido por mi
  mandato); el claim es consistente con el delta de asserts observado.

### §7 — No-tocar: **COMPLIANT**

- **SYSTEM_PROMPT intacto**: leído completo post-diff
  (`ai/chat/route.ts:106-128`) — el único hunk del archivo es el
  message del 429 + su comment. Caps, quota, caching, trimMessages:
  intactos.
- **lib/route-errors.ts**: fuera del diff (0 cambios).
- **Boundaries** (`app/error.tsx`, `global-error.tsx`,
  `not-found.tsx`): fuera del diff (0 cambios) — Q-2 de T4 no se metió,
  conforme §1.6.
- **Cero archivos nuevos de código**: `git status --porcelain` = 21 M,
  cero untracked en el repo (el t5-report.md vive en `.superpowers/sdd/`
  gitignored y es el entregable requerido, no código).
- **Cero installs**: `package.json` y `pnpm-lock.yaml` fuera del diff.
- **Comments en inglés**: todos los comments nuevos del diff
  (chat-panel header, MESSAGE_TOO_LONG_COPY, errorCodeOf, Q-1/Q-2/Q-3,
  dev-facing del 429) están en inglés.
- Rutas API: solo los strings exactos de §4.4 + voseantes de §1.1;
  cero cambios de lógica (hunk por hunk verificado).
- Schema/migraciones/tests/setup.ts/CI/seed: fuera del diff.

---

## 2. CHECKPOINTS OBLIGATORIOS

### CHECKPOINT 1 — premisa del envenenamiento (server valida TODA la ventana de 30): **PASS**

Verificado contra el código POST-diff de `app/api/ai/chat/route.ts`:
- `trimMessages()` (`:150-155`) produce la ventana de los últimos
  `MAX_CHAT_MESSAGES = 30` (`:79`) alineada a empezar en 'user'.
- `exceedsSizeCaps(trimmed)` (`:180-190`) itera **TODOS** los mensajes
  de esa ventana: `for (const m of trimmed)` — cualquier mensaje con
  `roleOf(m) === 'user'` y `userTextLength(m) > MAX_USER_MESSAGE_CHARS`
  (8000, `:90`) → `true` → 400 MESSAGE_TOO_LONG (`:227-233`).
- **El diff NO alteró esta validación**: el único hunk del archivo es
  `:268-276` (message del 429 + comment). `exceedsSizeCaps`,
  `userTextLength`, `trimMessages` y las constantes están fuera del
  diff, byte-idénticas a `506fd7a`.
- Conclusión: la premisa del mecanismo de limpieza del panel (un
  mensaje >8000 chars dejado en el historial re-dispara el 400 en cada
  request siguiente hasta salir de la ventana) SE SOSTIENE post-diff, y
  la remoción del ofensor vía `setMessages` es el fix correcto contra
  esa premisa.

### CHECKPOINT 2 — los dos "Sign in required" en tests son autocontenidos: **PASS (ambos)**

- **`tests/ai/chat-route.test.ts:278`** — AUTOCONTENIDO y VÁLIDO. El
  archivo mockea `@/lib/auth-helpers` PARCIALMENTE
  (`vi.mock` con `importOriginal`: real `errorResponse`, `requireAuth`
  reemplazado por `vi.fn()`). El test construye ÉL MISMO el 401:
  `const the401 = errorResponse('UNAUTHORIZED', 'Sign in required', 401)`
  — el literal "Sign in required" es un ARGUMENTO que el test pasa al
  builder genérico, no una lectura del message real de `requireAuth`
  (cuyo cuerpo ni se ejecuta: está mockeado con
  `mockResolvedValue(the401)`). Los asserts son de identidad y de code
  (`res === the401`, `body.error.code === 'UNAUTHORIZED'`), nunca del
  message. **Por qué sigue válido:** el test verifica que la ruta
  PROPAGA el Response de `requireAuth` sin tocarlo — semántica
  independiente del texto del message; que el fixture diga el string
  viejo es data arbitraria del mock.
- **`tests/lib/route-errors.test.ts:47`** — AUTOCONTENIDO y VÁLIDO.
  Construye el Response a mano
  (`new Response(JSON.stringify({ error: { code: 'UNAUTHORIZED',
  message: 'Sign in required' } }), …)`) sin importar NADA de
  `lib/auth-helpers`. **Por qué sigue válido:** testea que
  `withRouteErrors` devuelve intacto y sin loguear un error Response
  RETORNADO por el handler — el message es payload de utilería; ningún
  assert lo compara contra el message real del helper.
- En ambos casos el literal viejo en el fixture NO fija el nuevo
  message de producción, así que la suite no podía romperse por el flip
  de `auth-helpers.ts:53` — consistente con el GREEN reportado.

---

## 3. Deltas del implementer, evaluados contra la letra

- **"Ninguno de sustancia" (reporte §3):** CONFIRMADO. Los 23 hits, los
  strings de §4.4, los 7 asserts y los 5 puntos de §4.2 coinciden con
  la letra del brief; R-1 sin formas nuevas (mis greps lo corroboran).
- **Corrimiento de líneas post-edición** (429 en :269-276, UNAUTHORIZED
  del chat en :256 en mi lectura): esperado y sin impacto; codes y
  contenidos verificados en las posiciones reales.
- **Flake de la primera corrida** (resolve.test.ts, error de conexión
  Neon): ajeno al scope del diff (normalizer no tocado); la re-corrida
  GREEN 510/510 es el cierre que pide §6. Sin objeción de spec.
- **Micro-slip del REPORTE (no del código):** en §4 del reporte, el
  grep 2 lista "está ×5" pero enumera 6 sitios; mi corrida confirma
  **6** hits de "está" (los 6 sitios enumerados son correctos, el
  contador ×5 está off-by-one). Cero impacto: es un typo del reporte,
  el criterio de cierre ("cero líneas voseantes accionables") se cumple
  igual.

---

## 4. Veredicto global

**PASS.** Los 6 bloques del mandato (§4.1+§3.1, §4.2×5, §4.3, §4.4,
§6, §7) COMPLIANT sin desviaciones; CHECKPOINT 1 y CHECKPOINT 2 PASS.
Ningún hallazgo bloqueante ni minor contra la letra del brief frozen.
