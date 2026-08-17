# T5 — Review carril QUALITY (calidad de código)

> Reviewer ciego del carril quality. Insumos: diff crudo
> (`.superpowers/sdd/t5-working-diff.txt`, aplicado sobre `506fd7a`),
> brief como contexto de intención, reporte del implementer como claims
> a contrastar. Verificación source-level contra las librerías
> instaladas (`@ai-sdk/react@3.0.170`, `ai@6.0.168`). Solo calidad de
> código; cero compliance contra la letra del brief.

## Veredicto global: **PASS CON MINORS**

Cero hallazgos MAJOR. La lógica nueva de `chat-panel.tsx` es correcta
en el flujo principal y en los caminos de retry; los claims del
implementer sobre el runtime de la librería se verificaron ciertos
contra el source instalado. Los 4 hallazgos son de robustez/edge-case.

---

## Verificaciones de fondo (lo que se confirmó correcto)

Contra `node_modules` instalado (el source ES el runtime):

1. **`setMessages` con functional updater es sincrónico** —
   `@ai-sdk/react/dist/index.mjs` (~:210): `messagesParam =
   messagesParam(chatRef.current.messages)` y asignación directa a
   `chatRef.current.messages`. El setter de `messages` en
   `AbstractChat` (`ai/dist/index.mjs:13110-13112`) es asignación pura
   de estado — cero requests, cero `sendAutomaticallyWhen`. El claim
   del comment en `chat-panel.tsx:156-158` (que `restoredText` está
   poblado antes del `setInput`) es cierto.
2. **Un objeto de error fresco por fallo** — `makeRequest` arranca con
   `setStatus({ status: "submitted", error: void 0 })`
   (`ai/dist/index.mjs:13153`) y el catch setea un `Error` nuevo por
   intento (el transport hace `new Error(await response.text())`).
   El guard `handledErrorRef` por identidad de objeto
   (`chat-panel.tsx:150-153`) es correcto: corre exactamente una vez
   por error, incluidos errores consecutivos idénticos en texto, y el
   early-return para códigos no-MTL (RATE_LIMITED, genérico) marca el
   error como visto sin efectos colaterales — correcto.
3. **El append optimista del user message ocurre antes del POST**
   (`sendMessage` → `state.pushMessage` → `makeRequest`), y el error
   path NO lo remueve — la remoción del panel es necesaria, y en el
   flujo principal (mensaje largo → 400 inmediato, pre-stream) el
   último mensaje es siempre el ofensor. Un stream parcial del
   asistente no puede coexistir con MESSAGE_TOO_LONG: el server valida
   caps antes de abrir el stream (400 pre-stream), y el CHAT_ERROR
   in-band produce `error.message` no-JSON → `errorCodeOf` → null →
   rama genérica. Bien razonado.
4. **Camino de retry cruzado correcto**: mensaje largo falla por red
   (errorCode null → genérico con Reintentar) → click Reintentar →
   `regenerate()` re-manda el historial (con el user message trailing
   incluido, verificado en `regenerate`, `ai/dist/index.mjs`) → 400
   MTL → el efecto remueve el ofensor (es el último user sin
   assistant posterior) y restaura. Correcto.
5. **StrictMode dev**: doble invocación del efecto guardada por el ref
   (segunda corrida early-return). El updater de `setMessages` no es
   React setState (no hay doble invocación de updater).
6. **Q-2 / useMemo `[error]`**: con `error === undefined` devuelve
   null sin invocar `quotaResetLocalTime()`; se recomputa solo al
   cambiar la identidad del error — congela la hora por objeto de
   error como se busca. Deps correctas.
7. **Announcer (Q-3)**: ramifica sobre el mismo `errorCode` que el
   render visual — sin divergencia de estado; sigue sin apuntar al
   contenedor de streaming (cero regresión del patrón a11y previo).
   `role="status"` + `aria-live="polite"` intactos.
8. **Strings de API**: template literals bien formados; datos dinámicos
   preservados (`${chainStr}`, `${file.size}`, `${MAX_UPLOAD_FILE_BYTES}`,
   `${resolved.chain}/${resolved.fileType}`, `${issues.join('; ')}`);
   acentos/encoding correctos en el archivo real; cero cambios de
   lógica en las rutas tocadas (solo literales y un comment).
9. **Tests** (`tests/api/upload.test.ts`): los 7 regexes nuevos prueban
   lo mismo que los viejos; ninguno matchearía el string viejo (eran
   ingleses); el assert negado de :252 sigue negado Y respaldado por el
   assert positivo de :240 sobre el mismo string (si la implementación
   regresara a inglés, :240 falla — la negación no queda vacua). Los
   dos literales "Sign in required" en tests son autocontenidos
   (`tests/ai/chat-route.test.ts:278` pasa el message explícito a
   `errorResponse`; `tests/lib/route-errors.test.ts:47` arma el JSON a
   mano) — el cambio de `lib/auth-helpers.ts:53` no los rompe. El 429
   del chat se assert-ea por code (`tests/ai/chat-route.test.ts:676`).
10. **Barrido voseo→tuteo**: reemplazos puros de string, cero lógica
    tocada, conjugaciones tuteo correctas (Resuelve/resuélvelo/haz/
    mapea/etc.), pluralización de `conflict-banner.tsx` intacta.

---

## Hallazgos

### Q-1 — MINOR: mensaje ofensor NO adyacente → el efecto remueve un mensaje inocente y el panel queda envenenado

`components/analisis/chat-panel.tsx:159-175`

El criterio de remoción ("último user message sin assistant posterior")
asume que el ofensor es el último trailing. Hay un camino compuesto
donde no lo es:

1. El usuario manda un mensaje largo A → el fetch falla por RED (blip
   offline): `error.message` = "Failed to fetch" → `errorCodeOf` →
   null → rama genérica. A queda en `messages`.
2. En vez de click en Reintentar, el usuario escribe un mensaje corto
   B y lo manda: `handleSubmit` → `clearError()` → `sendMessage(B)` →
   `messages = [..., A(user), B(user)]` (dos user trailing —
   verificado: nada remueve A en ese camino).
3. El server 400-ea por A (los caps iteran TODA la ventana) → el
   efecto encuentra B (último user sin assistant después), remueve a B
   —el inocente— y restaura SU texto con el copy "Tu mensaje es
   demasiado largo" sobre un mensaje corto. A nunca sale del
   historial: cada reenvío repite el ciclo. Escape solo navegando
   fuera de /analisis (historial en memoria).

Severidad MINOR y no MAJOR porque: requiere el fallo de red previo
exactamente en el send del mensaje largo; el camino primario y el de
Reintentar quedan correctos; el estado pre-T5 era estrictamente peor
(envenenamiento sin remoción alguna); y hay escape (reset por
navegación). Fix sugerido si se quiere cerrar: remover TODOS los user
messages trailing (no solo el último) restaurando el texto del más
reciente, o capturar el id del mensaje enviado en `handleSubmit` y
remover por id.

### Q-2 — MINOR: la restauración al input puede pisar texto que el usuario está escribiendo

`components/analisis/chat-panel.tsx:176`

El `<Input>` NO se deshabilita mientras `isBusy` (solo cambia el botón
a Detener). Secuencia: usuario manda el mensaje largo (input queda
vacío por `setInput('')`), empieza a tipear un borrador nuevo durante
el in-flight, llega el 400 → `setInput(restoredText)` pisa el borrador
sin aviso. Ventana chica (latencia del POST) y el texto restaurado es
probablemente lo que el usuario quiere editar, pero es pérdida de
input del usuario. Mitigación barata: restaurar solo si
`input.trim() === ''` (con el trade-off de perder la restauración en
ese caso — decisión de UX menor).

### Q-3 — MINOR: copy del 429 duplicado inline entre el render y el announcer (drift risk)

`components/analisis/chat-panel.tsx:238-241` vs `:269`

La frase "Alcanzaste tu límite diario de preguntas al asistente.
Podrás volver a preguntar a las …" vive dos veces: como texto JSX y
como template literal del announcer. MESSAGE_TOO_LONG sí comparte
`MESSAGE_TOO_LONG_COPY`; el copy de cuota no tiene const equivalente.
Una edición futura de una sola de las dos copias desincroniza lo que
ve el usuario vidente de lo que oye el usuario de screen reader — el
tipo de drift que este mismo task vino a limpiar. Sugerencia: extraer
`quotaCopy(time)` o una const con placeholder.

### Q-4 — MINOR (teórico): `useMemo` no garantiza semánticamente "una vez por objeto de error"

`components/analisis/chat-panel.tsx:138-141`

Per React docs, el cache de `useMemo` es optimización, no garantía —
React puede descartarlo (hoy solo bajo features como `<Offscreen>`/
re-mounts). Si se descartara con el 429 montado cruzando medianoche
UTC, la hora saltaría +24h (el bug exacto de Q-2 de T3). Con React 18
estable y este árbol, no es reproducible en la práctica — se registra
como nota de robustez, no exige cambio. La alternativa a prueba de
todo sería estado (`useState` + el mismo efecto guardado por ref que
ya existe).

---

## Resumen

- MAJOR: 0
- MINOR: 4 (Q-1 edge-case de remoción con ofensor no-adyacente; Q-2
  clobber del input en tipeo concurrente; Q-3 duplicación del copy de
  cuota render/announcer; Q-4 nota teórica de useMemo)

**Veredicto: PASS CON MINORS.**
