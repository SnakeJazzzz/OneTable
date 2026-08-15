# Brief — T5 COPY (CORTE punto 5 / plan faro §3 T5)

> Estado: **v2 FROZEN post-segundo-pase del filtro, 2026-08-15.** La
> v1 (mismo día) recibió GO con enmiendas E1-E6; este v2 las fija
> junto con las decisiones de Michael (§2). El segundo pase dio GO
> PARA DISPATCH con micro-ediciones pre-freeze (aplicadas: line
> numbers reales de la tabla per-file, INVALID_CLIENT_NAME repuesto en
> §1.3, §10 paso 5 reescrito por alcanzabilidad verificada, R-2
> ampliado a la restauración del input, UNAUTHORIZED validado).
> Cualquier divergencia posterior viaja en `t5-report.md`, NUNCA como
> edición de este brief. Verificación empírica de la v1 corrida
> sobre `feat/hardening-t5` @ `2004521` (árbol limpio); los checks
> nuevos de E1/E2/E3/E5 corridos 2026-08-15 sobre el mismo commit. Si
> el dispatch se aleja en el tiempo, re-correr los greps de §1.
>
> Protocolo: el prompt del implementer lleva como prefijo literal la
> sección "⚠ Seguridad supply chain — NO NEGOCIABLE" de `CLAUDE.md`.
> El implementer PARA en GREEN con árbol sucio (no git). **T5 NO es un
> task de docs puros: Q-1/Q-2/Q-3 de T3 son cambios de CÓDIGO
> (comportamiento del chat-panel) → doble review CIEGA estándar en
> carriles separados aplica; la excepción calibrada de CLAUDE.md para
> docs NO aplica.** Gate: UI (smoke visual de Michael sobre la URL de
> preview, contra staging). Branch: `feat/hardening-t5`.

---

## 1. Verificación empírica del estado real (2026-08-15)

Cada punto verificado contra el repo con grep/read re-corrible.

### 1.1 Inventario REAL de voseo (aritmética E1): crudo 24 hits / 16 archivos; accionable 23 hits / 15 archivos

**Unidad: 1 hit = 1 línea** (las líneas con dos formas — p.ej.
"Arrastrá o hacé" — cuentan una). Conteo CRUDO del grep (incluyendo
"vendí"): **24 líneas en 16 archivos**. Exclusión explícita:
`components/analisis/chat-panel.tsx:141` "vendí" NO es voseo (primera
persona del pasado en la pregunta de ejemplo del chat — NO tocar).
Conteo ACCIONABLE: **23 líneas en 15 archivos**. (La lista del ledger
de 2026-07-16 — 11 hits / 10 archivos — quedó corta y con líneas
corridas.)

Greps corridos (re-corribles tal cual; el tercero es la enmienda E3):

```bash
# (1) dirigido — formas conocidas:
grep -rniE "tenés|querés|podés|sabés|debés|hacé\b|hacelo|mirá\b|verificá\b|empezá\b|subí\b|arrastrá\b|seleccioná\b|revisá\b|ingresá\b|agregá\b|importá\b|resolvé\b|resolvelo|exportá\b|configurá\b|accedé|mapeá|\bvos\b" app components lib core --include="*.ts" --include="*.tsx"
# (2) genérico — tilde final (caza imperativos voseantes no listados):
grep -rnoE "\b[A-Za-zñÑ]{2,}[áéí]\b" app components lib core --include="*.ts" --include="*.tsx"
# (3) E3 — voseo en presente (-ás/-és/-ís) + "sos":
grep -rnE "\b[A-Za-zñÑ]+[áéí]s\b|\bsos\b" app components lib core --include="*.ts" --include="*.tsx"
```

El grep (2) cazó 3 formas que la lista del ledger no tenía: "Accedé",
"mapeá" y el falso positivo "vendí". El grep (3), corrido 2026-08-15:
solo re-encuentra "tenés" ×2 (ya listados); falsos positivos triageados
a mano: "más" ×2, "Podrás" ×1 (futuro, no voseo). Cero formas nuevas.

**Criterio de cierre del barrido (contrastable):** re-correr los 3
greps → cero líneas voseantes accionables; los falsos positivos
remanentes se listan en el reporte del implementer (esperados: "más",
"Podrás", "vendí", y las palabras con tilde no-verbales del grep 2 tipo
"solicitará", "Qué", "aquí").

**Mensajes de API / core (5 hits — user-visible: la UI los renderiza
crudos, ver §1.4):**

| # | Sitio | Forma |
|---|---|---|
| 1 | `app/api/portales/mappings/route.ts:51` | "Resolvé" (el ledger decía :44) |
| 2 | `app/api/portales/mappings/route.ts:91` | "resolvelo" (ledger: :76) |
| 3 | `app/api/portales/mappings/route.ts:137` | "resolvelo" (ledger: :116) |
| 4 | `app/api/parametros/import/route.ts:69` | "Verificá" (ledger: :51) |
| 5 | `core/parameters/import.ts:17` | "exportá" (NUEVO — no estaba en el ledger) |

**Copy de UI (18 hits):**

| # | Sitio | Forma |
|---|---|---|
| 6 | `app/(auth)/login/page.tsx:55` | "Accedé" (NUEVO) |
| 7 | `app/(auth)/login/page.tsx:97` | "tenés" |
| 8 | `app/(auth)/signup/page.tsx:92` | "Empezá" (NUEVO) |
| 9 | `app/(auth)/signup/page.tsx:152` | "tenés" (ledger: :151) |
| 10 | `app/(dashboard)/analisis/page.tsx:73` | "Subí" |
| 11 | `app/(dashboard)/portales/page.tsx:10` | "Configurá" (NUEVO) |
| 12 | `components/dashboard/conflict-banner.tsx:13` | "Resolvelos" (NUEVO) |
| 13 | `components/dashboard/dashboard-empty.tsx:17` | "Subí" |
| 14 | `components/portales/conflict-section.tsx:10` | "Resolvé" (NUEVO) |
| 15 | `components/portales/chain-upload.tsx:242` | "Arrastrá o hacé" |
| 16 | `components/portales/mapping-section.tsx:173` | "Seleccioná" |
| 17 | `components/portales/mapping-section.tsx:248` | "Revisá" |
| 18 | `components/portales/mapping-section.tsx:712` | "Resolvelo" (NUEVO) |
| 19 | `components/portales/mapping-section.tsx:836` | "mapeá" (NUEVO) |
| 20 | `components/parametros/import-zone.tsx:137` | "exportá" (NUEVO) |
| 21 | `components/parametros/import-zone.tsx:186` | "Arrastrá … hacé" |
| 22 | `components/parametros/thresholds-form.tsx:82` | "Ingresá" |
| 23 | `components/parametros/sku-table.tsx:347` | "Agregá … importá" |

**Qué entra y qué no:** entran los 23 (todos son copy de producto o
mensajes que la UI muestra). NO entran: comments de código (cero hits
voseantes en comments — verificado, todos los hits son strings),
`lib/` (cero hits), el "vendí" de `chat-panel.tsx:141`, y docs/ (no es
copy de producto).

### 1.2 chat-panel.tsx — sitios exactos de Q-1/Q-2/Q-3 de T3 + punto doble

Archivo: `components/analisis/chat-panel.tsx` (228 líneas). Su copy ya
está en tuteo ("Alcanzaste", "Podrás", "Escribe", "Pregúntale", "Vuelve
a intentarlo") — el barrido §1.1 NO lo toca; lo tocan Q-1/Q-2/Q-3.

- **Q-1 (400 MESSAGE_TOO_LONG sin manejo):** `isRateLimitError()` vive
  en `chat-panel.tsx:37-44` — parsea `error.message` (el body JSON
  crudo del transport) y compara `parsed.error?.code === 'RATE_LIMITED'`.
  El branch de render de error está en `:162-179`: rama específica solo
  para rate-limit; TODO lo demás (incluido el 400) cae al copy genérico
  `ERROR_COPY` (`:29-30`) + botón "Reintentar" que re-falla
  determinísticamente. El 400 nace en `app/api/ai/chat/route.ts:228-232`
  (el ledger decía :242-248 — corrió con T4). El patrón `errorCodeOf`
  del ledger = generalizar `isRateLimitError` a una función que
  devuelva el `code` parseado (~5 líneas) y branchear sobre
  `'RATE_LIMITED' | 'MESSAGE_TOO_LONG'`. Queda LOCAL en el panel (§2,
  OQ-3).
- **Envenenamiento del historial (hallazgo de la v1, premisa
  PRE-VERIFICADA):** los caps del server corren sobre la ventana
  TRIMMED de los últimos 30 mensajes y `exceedsSizeCaps()` itera
  TODOS los mensajes de esa ventana — cualquier mensaje de usuario
  >8000 chars re-dispara el 400 (`route.ts:79-91` para las constantes;
  `:180-190` para el loop, leído 2026-08-15). `useChat` agrega el
  mensaje del usuario al estado local ANTES del POST; en el error el
  mensaje largo QUEDA en `messages` → la SIGUIENTE pregunta corta y
  legítima re-manda el mensaje largo en el historial → re-400 → panel
  inutilizable hasta que el mensaje salga de la ventana de 30. El fix
  de Q-1 debe REMOVER el mensaje ofensor del estado local
  (`setMessages`, verificado en
  `node_modules/@ai-sdk/react/dist/index.d.ts:23` — types; runtime a
  verificar por el implementer, regla empírica-bidireccional). Diseño
  del criterio de remoción en §4.2.2 (E2). CHECKPOINT del carril spec:
  re-confirmar en el código que el server valida TODOS los mensajes de
  usuario de la ventana de 30 (la premisa; pre-verificada aquí, el
  carril la re-contrasta contra el diff).
- **Q-2 (hora de reset recalculada por render):**
  `quotaResetLocalTime()` en `:49-58`, invocada inline en el JSX
  `:169`. Con el 429 montado, al cruzar medianoche UTC el copy salta a
  +24h justo cuando la cuota acaba de resetearse. Fix candidato:
  capturar la hora una vez por objeto de error (p.ej.
  `useMemo(() => quotaResetLocalTime(), [error])`).
- **Q-3 (announcer genérico):** `aria-live` en `:184-192` — en error
  siempre anuncia "Ocurrió un error en la conversación", sin causa ni
  hora de reset. Fix: ramificar con el mismo `errorCodeOf`, simétrico
  al render visual (429 → copy de cuota con hora; 400 → copy de
  mensaje largo).
- **Punto doble del 429:** `:168-169` — el JSX cierra con "." después
  de `{quotaResetLocalTime()}` y `toLocaleTimeString('es-MX')` ya
  devuelve "6:00 p.m." → "…p.m..". Fix: quitar el punto del JSX o
  reordenar la frase.
- **Rider de S-1 de T3 (aceptado):** "Reintentar" oculto en el caso
  RATE_LIMITED. Para MESSAGE_TOO_LONG aplica la misma lógica (retry
  re-falla seguro) → mismo tratamiento: copy específico, SIN botón; el
  reenvío es editar el texto restaurado en el input (§4.2.2).

### 1.3 Inventario ACTUAL de idiomas de TODOS los `errorResponse` del repo

Grep: `grep -rn "errorResponse(" app --include="*.ts"` (69 call sites)
+ `grep -rn "413" app/api/data/upload/route.ts app/api/parametros/import/route.ts`.
Familias por idioma HOY:

**Inglés (plumbing / requests malformados — normalmente solo los ve un
cliente buggy o un atacante):**
- `INVALID_BODY` en todas sus variantes ("Body must be JSON", "Body
  must be a JSON object", "portalString required", etc.) — signup,
  conflicts, mappings, price-overrides, credentials, thresholds, skus,
  chat.
- `INVALID_CHAIN` "Unknown chain" (6 rutas).
- `PRODUCT_NOT_FOUND` "SKU not in your catalog"
  (`mappings/route.ts:46`, `price-overrides/route.ts:132,156`) — SÍ
  llega a la UI (§1.4) → CAMBIA (§4.4).
- `UNAUTHORIZED` "Sign in required" (`lib/auth-helpers.ts:53`, el
  `requireAuth` compartido) — alcanzable por usuario (§1.10) →
  CAMBIA (§4.4).
- Chat (`app/api/ai/chat/route.ts`): "Request body must be valid
  JSON" (:201), "Request body must include a 'messages' array" (:209),
  "Conversation must include a user message" (:220), "A message
  exceeds the allowed size" (:228, MESSAGE_TOO_LONG — el panel lo
  cubre con copy local post-Q-1), "Messages are not valid" (:242),
  "Sign in required" (:256 — el panel nunca renderiza messages del
  server → queda inglés).
- Upload top-level (`app/api/data/upload/route.ts`): "Could not parse
  multipart body: …" (:124), "No files in request (use field name
  'files')" (:140), ALL_FILES_FAILED "No files could be processed"
  (:197) — este último SÍ llega a la UI como `top` (§1.4) → CAMBIA.
- `clients/route.ts:28` "Authenticated client not found".
- Import top-level (`parametros/import/route.ts`): "Could not parse
  multipart body" (:30-34), "No file in request (field 'file')" (:39).

**E5 — 413 top-level (verificado 2026-08-15): `data/upload` NO tiene
413 top-level.** El cap de 10MB en data/upload es SOLO per-file
(`route.ts:237-241`, shape per-file "file too large: …"; documentado
también en el header de `lib/upload-limits.ts:16-17`: "Consumers: …
data/upload (per-file, multi-file shape) y … parametros/import (single
file, 413 + FILE_TOO_LARGE)"). El ÚNICO 413 top-level del repo es
`parametros/import/route.ts:49-53` — FILE_TOO_LARGE, "El archivo
supera el límite de 10 MB.", YA en español sin voseo, renderizado por
`import-zone.tsx:115`. Destino bajo la política: ya cumple — cero
cambios. (La premisa de la enmienda — un 413 top-level en data/upload
— no corresponde al código actual.)

**Español (errores semánticos user-visible):**
- Signup completo (`auth/signup/route.ts`): RATE_LIMITED "Demasiados
  intentos…", INVALID_EMAIL, INVALID_PASSWORD, PASSWORD_TOO_LONG
  "… (máximo 72 bytes)" (dev-facing, NO se toca — §2),
  INVALID_CLIENT_NAME "Nombre de empresa debe tener entre X y Y
  caracteres", EMAIL_TAKEN, INTERNAL_ERROR. (Todo tuteo ya.)
- Mappings 409/404 (`:51,91,93,137,139,141,143`) — español CON voseo
  (§1.1 #1-3).
- Conflicts (`:56,68`), credentials (`:36`), skus (`:87,96,137,142` y
  `[id]`), price-overrides (`:119`), data/reset (`:59`), import
  FILE_TOO_LARGE (:49) e INVALID_XLSX (:67, con voseo §1.1 #4).
- Chat 429 (`route.ts:269-273`): "Alcanzaste tu límite diario de
  preguntas al asistente" — pasa a INGLÉS por decisión de Michael
  (§2, cierra Q-5): message dev-facing, el panel branchea por `code` y
  nunca renderiza el message del server. Cero tests afectados
  (assert-ean code).

**Familia per-file de upload (inglés, USER-VISIBLE crudo — CAMBIA,
lista exacta en §4.4):** `app/api/data/upload/route.ts` —
`invalid explicit upload metadata: …` con sub-issues "chain field
missing" / `unknown chain: "X"` / "chain field must be a plain text
value, not a file" (+ equivalentes de fileType) (:161-171), "file too
large: N bytes (max …)" (:240), "unknown file type — expected filename
to match soriana, chedraui, amazon ventas, or amazon inv" (:246-249),
"no parser registered for X/Y" (:255-258), y el catch-all
`err.message` del parser (:324-334, p.ej. "PERIODO is not a Date: …"
de `core/parsers/amazon-*.ts:22`) — el catch-all queda INGLÉS como
resto conocido declarado (es diagnóstico del parser, no copy).

### 1.4 Qué mensajes de API renderiza la UI crudos (define "user-visible")

Grep: `grep -rn "error?.message\|body?.error" components --include="*.tsx"`:
- `chain-upload.tsx:142` — `body?.error?.message` como mensaje top
  (401/ALL_FILES_FAILED/INVALID_MULTIPART/NO_FILES si ocurrieran) y
  `:145,154` — `perFile[0].error` como detail (TODA la familia
  per-file inglesa).
- `mapping-section.tsx:75,108` — messages de mappings (los voseantes
  #1-3 y "SKU not in your catalog" en inglés).
- `conflict-section.tsx:34`, `price-override-section.tsx:91`,
  `import-zone.tsx:115` — ídem sus rutas.
- El chat-panel NO muestra messages del server (solo branchea por
  code) — sus copys son locales.

### 1.5 Copy de signup "máximo 72 caracteres" vs server 72 BYTES

- Cliente: `app/(auth)/signup/page.tsx:26` — `PASSWORD_TOO_LONG: 'Tu
  contraseña es demasiado larga (máximo 72 caracteres)'`.
- Server: `app/api/auth/signup/route.ts:29` `MAX_PASSWORD_BYTES = 72`,
  chequeado con `Buffer.byteLength(password, 'utf8')` (:88); su
  message dice "(máximo 72 bytes)" — exacto server-side, dev-facing,
  NO se toca (§2).
- El desfase del cliente es real solo en passwords multibyte (ñ,
  acentos, emoji): "72 caracteres" promete de más. Redacción decidida
  en §2 (OQ-2); ejecución en §4.3.

### 1.6 Q-2 de T4 (`reset()` sin `router.refresh()` en app/error.tsx) — el barrido NO toca los boundaries

`app/error.tsx:33-38`, `app/global-error.tsx:87-91`,
`app/not-found.tsx:20-23`: su copy ya nació en tuteo ("buscas",
"Intenta de nuevo", "recarga la página") — cero hits en §1.1.
**Posición: T5 NO toca los boundaries → Q-2 de T4 queda para su
próximo touch real, como ya dice el ledger.** Meterlo aquí sería
scope-creep de comportamiento en un archivo que el task no necesita
abrir.

### 1.7 Tests que fijan strings de mensajes: el barrido voseo no toca ninguno; la lista de idioma toca 7 asserts en 1 archivo

Grep de las 23 formas de §1.1 en `tests/` → 0 hits: el barrido
voseo→tuteo puro NO toca ningún test. Los tests assert-ean
`error.code`, no messages… con UNA excepción:
`tests/api/upload.test.ts` fija por regex la familia per-file INGLESA
— **7 asserts** (corrección sobre los 6 de la v1; enumeración completa
vía `grep -nE "toMatch\(/|toContain\(" tests/api/upload.test.ts`):
`/invalid explicit/` (:160,175), `/chain field missing/` (:190),
`/chain field must be a plain text value, not a file/` (:213),
`/file too large/` (:240 y :252 — este último NEGADO, verifica que el
archivo bajo el cap NO lleva ese error), `/unknown file type/` (:269).
Todos se ajustan a los strings nuevos de §4.4. Ningún test assert-ea
"No files could be processed", "SKU not in your catalog" ni el 429
del chat por message (verificado por grep; los hits de "unknown chain"
en otros tests son NOMBRES de casos que assert-ean el code
INVALID_CHAIN). Baseline: 510 tests / 53 archivos (cierre T4).

**CHECKPOINT del carril spec (UNAUTHORIZED):** los dos hits del
literal "Sign in required" en tests (`tests/ai/chat-route.test.ts:278`,
`tests/lib/route-errors.test.ts:47`) PARECEN autocontenidos
(construyen el literal ellos mismos, no lo importan de auth-helpers) —
claim de la v1, A VERIFICAR por el carril spec en la implementación,
no darlo por hecho.

### 1.8 Infra de tests de componentes: NO existe

`vitest.config.ts` incluye solo `tests/**/*.test.ts` (no `.tsx`), sin
environment DOM; no hay @testing-library ni jsdom/happy-dom instalados
(los hits del lockfile son peers opcionales de vitest). Los cambios de
Q-1/Q-2/Q-3 en el panel NO pueden tener component tests sin levantar
infra nueva (fuera de scope — supply chain + peso). Con `errorCodeOf`
LOCAL (§2, OQ-3) tampoco hay unit test nuevo: la cobertura de esa
lógica es el smoke guiado (§10).

### 1.9 Inventario COMPLETO de ítems del ledger con destino T5 (ninguno omitido)

Grep `T5` sobre el ledger completo → 8 menciones, que colapsan en
estos ítems (todos ENTRAN, ratificado por el filtro):

| Ítem (línea del ledger) | Estado en este brief |
|---|---|
| CORTE punto 5 (:155): barrido voseo→tuteo | §4.1 |
| Pasada copy es-MX (:392-417) + idioma familia per-file de upload (:411-417) | §4.4 (OQ-1=A ejecutada) |
| Copy signup 72 caracteres vs 72 bytes (:855-857) | §4.3 (OQ-2=a) |
| T3 Q-1: panel no maneja 400 MESSAGE_TOO_LONG (:927-931) | §4.2 (incluye limpieza del historial) |
| T3 Q-2: hora de reset recalculada por render (:932-940) | §4.2.3 |
| T3 Q-3: announcer aria-live genérico (:941-947) | §4.2.4 |
| T3 Q-5: idioma del 429 del chat (:954-958) | CERRADA por §2 (429 → inglés) |
| Punto doble "…p.m.." (:960-964) | §4.2.5 |

Ítems de T4 SIN destino T5 que rozan el task: Q-2 de T4 (boundaries) —
NO entra (§1.6). Ningún otro ítem del ledger menciona T5.

### 1.10 Verificación E5 — alcanzabilidad desde la UI de los messages ingleses top-level (corrida en la v1, ACEPTADA por filtro y Michael)

- **NO_FILES (`upload/route.ts:140`): INALCANZABLE desde la UI.**
  `chain-upload.tsx` guardia con `if (!file || isUploading) return`
  (`:105`) y siempre appendea el campo `files` con un File real
  (`:109-111`). Solo un cliente no-UI lo dispara. → Queda en inglés,
  resto dev-facing declarado con este fundamento. Mismo fundamento
  para **NO_FILE de `parametros/import/route.ts:39`**:
  `import-zone.tsx` guardia `if (!file || isUploading) return`
  (`:93`) y appendea `file` incondicional (`:99`) — verificado
  2026-08-15.
- **INVALID_MULTIPART (`upload/route.ts:124`,
  `parametros/import/route.ts:30`): inalcanzable en la práctica.** El
  browser construye el multipart vía `FormData`; no existe acción de
  usuario que produzca un body que `req.formData()` no pueda parsear.
  El render path lo MOSTRARÍA si ocurriera (§1.4), pero no es un
  estado producible desde la UI. → Inglés declarado, fundamento
  "render path existe, estado no producible desde la UI".
- **UNAUTHORIZED "Sign in required" (`lib/auth-helpers.ts:53`): SÍ
  alcanzable por usuario.** Sesión JWT (24h) expira con la pestaña
  abierta → siguiente acción (upload, mapeo, import, override) → 401
  → el render path de §1.4 lo muestra crudo. Aplicación directa de la
  regla por audiencia → ENTRA al flip a español (§4.4). El
  UNAUTHORIZED de la ruta del chat (`route.ts:256`) queda en inglés
  (el panel nunca renderiza messages del server).

---

## 2. Parámetros YA DECIDIDOS (no re-abrir; incluye las resoluciones de Michael a las OQs de la v1, 2026-08-15)

- Regla del proyecto (Michael, 2026-07-16): TODO el copy de producto
  en español mexicano (tuteo). Nunca voseo.
- Los minors Q-1/Q-2/Q-3 de T3 tienen destino "próximo touch de
  chat-panel.tsx" decidido por Michael (2026-08-11); T5 ES ese touch.
- Gate UI: smoke de Michael sobre la URL de preview del PR (staging),
  obligatorio pre-merge (regla T1). No se invalida por commits
  docs-only posteriores (decisión 2026-07-29).
- **OQ-1 = A (política por AUDIENCIA):** todo message que PUEDA
  renderizarse a usuario → español de México (tuteo). Messages solo
  alcanzables por clientes no-UI (guards tipo "Body must be JSON") →
  inglés, convención dev-facing DECLARADA. Los `code` son contrato
  máquina: NO cambian. Consecuencias explícitas:
  - El 429 del chat pasa a INGLÉS (dev-facing: el panel branchea por
    code con copy local, nunca renderiza el message del server —
    §1.4). CIERRA Q-5 de T3. Cero tests afectados (assert-ean code).
  - INVALID_MULTIPART / NO_FILES / NO_FILE: quedan en inglés por la
    verificación de §1.10 (inalcanzables desde la UI), declarados con
    ese fundamento.
  - El message del server de PASSWORD_TOO_LONG
    (`signup/route.ts:100-104`) NO se toca: dev-facing (el cliente
    renderiza copy local por code) y "(máximo 72 bytes)" es exacto
    server-side. Cambia SOLO el copy del cliente (OQ-2).
  - UNAUTHORIZED de `lib/auth-helpers.ts:53`: ENTRA al flip a español
    (§1.10); el de la ruta del chat queda inglés.
- **OQ-2 = (a):** copy del cliente en `signup/page.tsx:26` → "La
  contraseña es demasiado larga. Usa una más corta." (o redacción
  equivalente). NADA de reglas de bytes simplificadas (E6b: son
  falsas por clase de caracter — no todo caracter no-ASCII pesa
  igual).
- **OQ-3 = LOCAL:** `errorCodeOf` queda en `chat-panel.tsx`, con
  comment "promover a lib/ cuando exista un segundo consumidor" (hoy
  no lo hay: los hooks de las demás secciones tratan `!res.ok`
  genérico; los errores per-file llegan en payload 200). Consecuencia
  en §6: NO hay unit test nuevo; la cobertura de esa lógica es el
  smoke guiado (§10).
- **OQ-4 = SIN número** (mismo fundamento que E2: drift con el cap del
  server). Copy del 400: **"Tu mensaje es demasiado largo para
  enviarse. Acórtalo e inténtalo de nuevo."** SIN botón Reintentar
  (rider S-1 de T3); el reenvío es editar el texto restaurado en el
  input (E2, §4.2.2).

---

## 3. Scope de T5

**ENTRA:**
1. Barrido voseo→tuteo: los 23 hits accionables de §1.1 (18 de UI + 5
   de API/core). Equivalencias: Resolvé→Resuelve,
   resolvelo→resuélvelo, Resolvelos→Resuélvelos, Verificá→Verifica,
   exportá→exporta, Accedé→Accede, tenés→tienes, Empezá→Empieza,
   Subí→Sube, Configurá→Configura, Arrastrá→Arrastra, hacé→haz,
   Seleccioná→Selecciona, Revisá→Revisa, mapeá→mapea,
   Ingresá→Ingresa, Agregá→Agrega, importá→importa. Cierre con los 3
   greps de §1.1.
2. chat-panel.tsx: Q-1 (con limpieza del historial + restauración al
   input), Q-2, Q-3, punto doble — detalle en §4.2.
3. Signup: copy de PASSWORD_TOO_LONG del cliente (§4.3).
4. Ejecución de la política de idioma OQ-1=A: la lista EXACTA de §4.4.

**NO ENTRA:** ver §7 (no-tocar) y §1.6 (Q-2 de T4).

---

## 4. Diseño propuesto

### 4.1 Barrido voseo→tuteo

Reemplazo string por string en los 23 sitios; cero cambio de lógica.
En los mensajes que son template literals con datos dinámicos, solo se
toca el texto. Cierre: los 3 greps de §1.1 → cero líneas voseantes
accionables; falsos positivos listados en el reporte.

### 4.2 chat-panel.tsx (código — doble review ciega)

1. Generalizar `isRateLimitError` → `errorCodeOf(error): string | null`
   (parsea el body JSON del transport, devuelve `error.code` o null).
   LOCAL en el panel, con comment "promover a lib/ cuando exista un
   segundo consumidor" (§2, OQ-3). Branch del render: `RATE_LIMITED` →
   copy actual de cuota (con §4.2.3 y §4.2.5); `MESSAGE_TOO_LONG` →
   **"Tu mensaje es demasiado largo para enviarse. Acórtalo e
   inténtalo de nuevo."** — SIN botón Reintentar (rider S-1); resto →
   `ERROR_COPY` + Reintentar, como hoy.
2. **Limpieza del historial + restauración (rediseño E2):** al
   detectar `MESSAGE_TOO_LONG`, remover del estado local (vía
   `setMessages`) **el último mensaje de usuario sin respuesta del
   asistente posterior** — el append optimista fallido. El criterio NO
   usa la constante 8000 en el cliente (evita drift con el cap del
   server). Al removerlo, **restaurar su texto al input** para que el
   usuario acorte y reenvíe (la v1 le perdía el pegado). La limpieza
   corre en un **efecto disparado por el error, una sola vez por
   objeto de error** (guard anti-loop, p.ej. ref al último error
   procesado). El implementer verifica el comportamiento runtime de
   `setMessages` + error state de `useChat` (types verificados; regla
   empírica-bidireccional). CHECKPOINT del carril spec: confirmar en
   el código del server que valida TODOS los mensajes de usuario de la
   ventana de 30 (premisa del envenenamiento; pre-verificada en §1.2).
3. Q-2: capturar la hora de reset una vez por objeto de error
   (`useMemo(..., [error])` o equivalente), no por render.
4. Q-3: el announcer `aria-live` ramifica con el mismo `errorCodeOf`:
   429 → anuncia el copy de cuota (con hora), 400 → el copy de mensaje
   largo, resto → el genérico actual.
5. Punto doble: quitar el "." del JSX tras `{…}` (la hora ya trae
   "p.m.").

### 4.3 Signup PASSWORD_TOO_LONG (OQ-2=a, decidida)

`app/(auth)/signup/page.tsx:26` → "La contraseña es demasiado larga.
Usa una más corta." Sin número, sin reglas de bytes. El message del
server NO se toca (§2).

### 4.4 Ejecución de OQ-1=A — lista EXACTA de messages que cambian de idioma

**Inglés → español (tuteo). R-3 aplica a TODA traducción: preservar
los datos dinámicos (tamaños, nombres de campo, chains) — el detail
per-file es también herramienta de debugging. Los nombres de campo de
la API (`chain`, `fileType`) quedan literales.**

Familia per-file de `app/api/data/upload/route.ts`:

| Sitio | String actual | Propuesto |
|---|---|---|
| :171 | `invalid explicit upload metadata: ${issues.join('; ')}` | `metadatos de carga inválidos: ${issues.join('; ')}` |
| :165 | `chain field must be a plain text value, not a file` | `el campo chain debe ser texto plano, no un archivo` |
| :166 | `chain field missing` | `falta el campo chain` |
| :167 | `unknown chain: "X"` | `cadena desconocida: "X"` |
| :168 | `fileType field must be a plain text value, not a file` | `el campo fileType debe ser texto plano, no un archivo` |
| :169 | `fileType field missing` | `falta el campo fileType` |
| :170 | `unknown fileType: "X"` | `fileType desconocido: "X"` |
| :240 | `file too large: N bytes (max M bytes / 10 MB)` | `archivo demasiado grande: N bytes (máximo M bytes / 10 MB)` |
| :246-249 | `unknown file type — expected filename to match soriana, chedraui, amazon ventas, or amazon inv` | `tipo de archivo desconocido — el nombre debe corresponder a soriana, chedraui, amazon ventas o amazon inv` |
| :255-258 | `no parser registered for ${chain}/${fileType}` | `no hay parser para ${chain}/${fileType}` |

Top-level y compartidos:

| Sitio | String actual | Propuesto |
|---|---|---|
| `upload/route.ts:197` (ALL_FILES_FAILED) | `No files could be processed` | `No se pudo procesar ningún archivo.` |
| `mappings/route.ts:46` (PRODUCT_NOT_FOUND) | `SKU not in your catalog` | `Ese SKU no existe en tu catálogo.` |
| `price-overrides/route.ts:132` (PRODUCT_NOT_FOUND) | `SKU not in your catalog` | `Ese SKU no existe en tu catálogo.` |
| `price-overrides/route.ts:156` (PRODUCT_NOT_FOUND) | `SKU not in your catalog` | `Ese SKU no existe en tu catálogo.` |
| `lib/auth-helpers.ts:53` (UNAUTHORIZED) | `Sign in required` | `Tu sesión expiró. Inicia sesión de nuevo.` (redacción VALIDADA por Michael, segundo pase del filtro) |

Nota PRODUCT_NOT_FOUND: la redacción propuesta ARMONIZA con la
española ya existente del mismo semántico en `mappings/route.ts:143`
("Ese SKU no existe en tu catálogo.") — un solo string para la misma
condición.

**Español → inglés:**

| Sitio | String actual | Propuesto |
|---|---|---|
| `ai/chat/route.ts:269-273` (RATE_LIMITED 429) | `Alcanzaste tu límite diario de preguntas al asistente` | `Daily chat quota exceeded` |

**Quedan en INGLÉS como convención dev-facing DECLARADA (fundamentos
en §1.3/§1.10):** todos los INVALID_BODY/guards de shape, INVALID_CHAIN
"Unknown chain", NO_FILES, NO_FILE, INVALID_MULTIPART ×2,
"Authenticated client not found", el plumbing completo de la ruta del
chat (incluidos MESSAGE_TOO_LONG — cubierto por copy local del panel —
y su UNAUTHORIZED :256), el message del server de PASSWORD_TOO_LONG, y
el catch-all `err.message` de los parsers (diagnóstico, resto conocido).

---

## 5. Estructura del task: TANDA ÚNICA (recomendación)

Un solo implementer con todo el scope (§3): el barrido es mecánico y
el único archivo con lógica es chat-panel.tsx; partirlo en dos tandas
duplicaría reviews para ~30 strings. Doble review ciega estándar
(carril spec + carril quality, agentes distintos, sin ver el output
del otro); fix pass + re-review del carril hallador si hay hallazgos.
Checkpoints explícitos del carril spec: §4.2.2 (premisa de validación
de ventana) y §1.7 (tests de UNAUTHORIZED autocontenidos). Diff crudo
completo + ambos reviews a Michael antes de commit.

---

## 6. Test plan (Vitest contra development, guard T1 activo)

- Baseline: **510 tests / 53 archivos** (cierre T4). Avisar a Michael
  antes de correr la suite (posible `pnpm dev` activo); cero procesos
  de test huérfanos.
- Barrido voseo: cero ajustes de tests (verificado §1.7).
- Ejecución de §4.4: actualizar los **7 asserts** regex de
  `tests/api/upload.test.ts` (:160,175,190,213,240,252,269) a los
  strings nuevos — incluido el assert NEGADO de :252. El 429 del chat
  y ALL_FILES_FAILED/PRODUCT_NOT_FOUND/UNAUTHORIZED: cero tests
  afectados en principio (assert-ean code — §1.7), con el CHECKPOINT
  de los dos literales "Sign in required" a verificar por el carril
  spec (autocontenidos, no importados).
- chat-panel: sin component tests posibles (§1.8) y sin unit test de
  `errorCodeOf` (queda local — §2, OQ-3). La cobertura de esa lógica
  es el smoke guiado (§10).
- Cierre: `pnpm test` + `pnpm typecheck` + `pnpm build` verdes +
  los 3 greps de §1.1 limpios + verificación supply-chain estándar (no
  hay installs previstos — si el implementer cree necesitar un
  paquete, PARAR y consultar).

---

## 7. No-tocar

- **System prompt, caps, quota y caching del chat**
  (`app/api/ai/chat/route.ts` salvo el message del 429 — §4.4): el
  SYSTEM_PROMPT es inglés POR DISEÑO (estándar técnico + tests lo
  fijan) — no es copy de producto.
- **Wrapper y logs de T4** (`lib/route-errors.ts`, `logRouteError`):
  Q-3/Q-4 de T4 quedan para su próximo touch real.
- **Boundaries** (`app/error.tsx`, `global-error.tsx`,
  `not-found.tsx`): ya en tuteo, cero hits; Q-2 de T4 queda diferido
  (§1.6).
- **Rutas API** salvo los strings exactos de §4.4 y los voseantes de
  §1.1 — cero cambios de lógica, códigos de error (`code`) INMUTABLES
  (contrato máquina).
- Schema, migraciones, deps (cero installs), `tests/setup.ts`, CI,
  seed.
- Comments de código (inglés, estándar).

---

## 8. Riders

- R-1: si al ejecutar el barrido el implementer encuentra formas
  voseantes NO listadas en §1.1 (los 3 greps reducen el riesgo pero no
  lo eliminan — p.ej. voseo sin tilde), las corrige y las REPORTA como
  delta contra este brief; no expande scope más allá de strings.
- R-2 (ampliado post-filtro): cubre AMBOS mecanismos de §4.2.2 —
  (i) la remoción del mensaje del historial (`setMessages`) y (ii) la
  restauración del texto al input. Sobre (ii): el input del panel es
  estado LOCAL (`useState`, `chat-panel.tsx:103`) — `useChat` de
  `@ai-sdk/react@3` ya no gestiona el input — así que el mecanismo
  esperado es el `setInput` local + extraer el texto de las parts del
  mensaje removido; el implementer verifica types Y runtime de ambos
  contra la versión instalada. Si cualquiera de los dos no tiene
  mecanismo limpio, PARAR y reportar antes de improvisar.
- R-3: TODA traducción de §4.4 preserva los datos dinámicos (tamaños,
  nombres de campo, chains) — el detail per-file es también
  herramienta de debugging; los nombres de campo de la API quedan
  literales.

---

## 9. Split [CC] / [MICHAEL]

**[CC]:** todo §3-§4 tras el go; reporte en
`.superpowers/sdd/t5-report.md`; diff crudo + reviews a Michael; cero
git hasta "commiteá".

**[MICHAEL]:** validar la redacción del UNAUTHORIZED nuevo (§4.4) en
el filtro de este v2; go del brief; para el smoke del 429 (§10):
**capturar el valor previo de `Client.chatDailyLimit` (default 40)
ANTES de bajarlo** en staging vía consola de Neon, bajarlo a un valor
chico, y **restaurarlo al cierre del smoke verificando con una
pregunta post-restauración** (E4); smoke visual en la URL de preview;
"commiteá" y merge.

---

## 10. Gate: UI — con guión corto de smoke (propuesto, tipo T3)

El task cambia COMPORTAMIENTO del panel (400, announcer, historial),
no solo strings — amerita guión:

1. **Voseo:** pasada visual por login, signup, dashboard (banner de
   conflictos + empty state), portales (upload + mappings +
   conflictos), parámetros (SKUs + thresholds + import), análisis —
   cero voseo.
2. **MESSAGE_TOO_LONG:** en /analisis pegar >8,000 caracteres → copy
   nuevo específico, SIN botón Reintentar, y el texto pegado RESTAURADO
   en el input (E2); después acortar/borrar y preguntar algo corto →
   DEBE responder normal (valida la limpieza del historial — el paso
   que caza el envenenamiento de §1.2).
3. **429 + punto doble + Q-2:** [MICHAEL] capturar el valor previo de
   `chatDailyLimit` y bajarlo en staging; agotar la cuota → copy de
   cuota con hora SIN doble punto.
4. **Announcer (Q-3):** con DevTools, inspeccionar el `<p role=
   "status">` sr-only durante los pasos 2-3 → el texto refleja la
   causa específica, no el genérico. (VoiceOver opcional.)
5. **Idioma (§4.4) — reescrito por alcanzabilidad (verificado
   2026-08-15):** `chain-upload.tsx` manda `chain` fijo por props
   (`:367-376`, `SingleSlot:26-34`) → "chain inválida" NO es
   producible desde la UI. Más aún: `onSubmit` appendea SIEMPRE
   `chain` y `fileType` explícitos (`:111-112`), y con metadata
   explícita `processOneFile` nunca corre la detección por filename
   (`resolved = ctx.explicit ?? detectUpload(...)`,
   `upload/route.ts:244`) → "tipo de archivo desconocido" TAMPOCO es
   producible desde la UI (solo clientes API legacy). Paso primario
   user-producible: subir un archivo CHICO corrupto (p.ej. un .txt
   renombrado a .xlsx) → el parser lanza → top `ALL_FILES_FAILED`
   **"No se pudo procesar ningún archivo."** en ESPAÑOL (el detail es
   el catch-all inglés del parser — resto declarado en §4.4,
   esperado). El detail per-file TRADUCIDO solo es observable vía el
   paso 5b.
5b. **OPCIONAL (probe instrumentado):** subir un archivo >10 MB —
   medir QUÉ intercepta primero en deployed: el cap per-file de la
   app (detail "archivo demasiado grande: …" en español) o un límite
   de payload de la plataforma (413 sin shape `{error}`). CUALQUIERA
   de los dos resultados es evidencia válida; si intercepta la
   plataforma, capturar la respuesta para el ítem nuevo del ledger
   (NO es fallo del task).
6. **Restauración (E4):** [MICHAEL] restaurar `chatDailyLimit` al
   valor capturado en el paso 3 y verificar con una pregunta
   post-restauración que el chat responde normal.

---

## OPEN QUESTIONS

Ninguna. Las 4 OQs de la v1 quedaron resueltas por Michael (§2) y la
redacción del UNAUTHORIZED quedó validada en el segundo pase del
filtro (§4.4).
