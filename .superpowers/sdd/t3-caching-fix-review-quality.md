# Review — carril QUALITY — fix post-gate T3 caching (gateway.caching auto)

Fecha: 2026-08-12
Reviewer: carril code quality (ciego respecto del carril spec)
Diff revisado: `git diff` en `fix/t3-caching-gateway` contra HEAD = main @ 3ff2438
Archivos: `app/api/ai/chat/route.ts`, `tests/ai/chat-route.test.ts`

## Veredicto

**APPROVE WITH MINORS** (1 minor opcional, cero blockers, cero majors)

## Hallazgos

### MINOR-1 — `tests/ai/chat-route.test.ts:843-850` — providerOptions solo asertado en el step 1

El test nuevo asserta `providerOptions` únicamente en `doStreamCalls[0]`. En
producción el valor del caching está sobre todo en los steps posteriores del
tool loop (el gateway pone un breakpoint en el último message de cada request,
así que cada step del loop lee el cache del step anterior). El test de 5 steps
del grupo 4 (`doStreamCalls` length 5, ~línea 498-510) permitiría fijar el
invariante "rides on every step" con un assert de una línea sobre
`doStreamCalls[4].providerOptions`.

Por qué es MINOR y no MAJOR: verifiqué en el source instalado que el SDK lo
garantiza estructuralmente — `ai@6.0.168` computa
`stepProviderOptions = mergeObjects(providerOptions, prepareStepResult?.providerOptions)`
DENTRO del loop por step (`node_modules/ai/dist/index.mjs:7129`) y lo pasa a
cada `doStream` (`:7211`); la ruta no usa `prepareStep`, así que no hay
override posible. El assert extra sería regression-lock, no cobertura de un
gap real hoy. Puede ir al ledger como nice-to-have; no bloquea.

## Sin hallazgos en (verificado)

1. **Correctitud mecánica del mecanismo.** `providerOptions` a nivel de
   `streamText` llega a las callOptions del modelo: (a) el test del grupo 11
   lo captura en `doStreamCalls[0].providerOptions` y pasa; (b) el source del
   SDK lo propaga por step (ver MINOR-1); (c) la evidencia de scratch
   (variante B) lo verificó end-to-end contra el gateway real (write 11122 →
   read 11122). Además el shape es EXACTAMENTE el del ejemplo AI SDK de la
   doc oficial de automatic caching (fetcheada 2026-08-12, last_updated
   2026-07-28): `providerOptions: { gateway: { caching: 'auto' } }` en
   `streamText`. La doc confirma también que aplica a Anthropic direct,
   Vertex Y Bedrock — o sea el mecanismo nuevo es robusto al routing entre
   fallbacks del gateway, cosa que el namespace `anthropic` message-level no
   garantizaba (hipótesis 1 del evidence doc).

2. **Tipos sin escape hatches.** Cero `as`, cero `@ts-ignore` en el diff.
   `pnpm typecheck` → exit 0, cero errores. El import `type
   SystemModelMessage` se removió junto con su único uso — no quedan imports
   huérfanos.

3. **Honestidad de comments.** Contrastados contra
   `.superpowers/sdd/t3-caching-fix-scratch-evidence.md` y la doc de Vercel:
   - `route.ts:277-289`: dice "cannot be trusted end-to-end through the
     gateway" citando la evidencia de producción (0/0, deployment 3ff2438) —
     NO afirma "el anclaje no sobrevive el gateway" como verdad universal,
     que es exactamente la calibración correcta dado que el scratch (variantes
     A y C) sí cacheó. "Verified empirically... request 1 cache write > 0,
     request 2 cache read > 0" es literalmente la variante B del evidence doc.
   - "providers with explicit caching (Anthropic) need `gateway.caching:
     'auto'` at the call level": consistente con la doc ("For Anthropic,
     you'll need to set `caching: 'auto'` or manually add cache markers");
     leído en su cláusula ("the GATEWAY places the cache breakpoints itself")
     refiere al mecanismo gateway-managed, no niega la vía manual — que el
     mismo comment explica por qué se removió.
   - `route.ts:100-103` (comment de SYSTEM_PROMPT): actualizado a "the
     gateway's automatic prompt caching", apunta al call site. Coherente.
   - Cero comments stale: las únicas menciones residuales de
     `SystemModelMessage`/`cacheControl` son los dos comments intencionales
     que explican QUÉ se removió (`route.ts:284`, test `:842`) — grep sobre
     `app core lib tests components` no arroja nada más.

4. **Calidad del test reescrito** (`tests/ai/chat-route.test.ts:838-855`).
   Asserta ambas caras del fix: el mecanismo nuevo con `toEqual` estricto
   sobre `call.providerOptions` (cualquier namespace extra futuro rompe el
   test — tightness correcta) y la regresión del viejo
   (`system.providerOptions` → `toBeUndefined()`, `role === 'system'`). No
   hay cobertura perdida vs el test anterior: el viejo solo asertaba
   providerOptions del prompt[0]; el nuevo cubre eso (en negativo, que es lo
   correcto ahora) más el call-level. Cero asserts huérfanos. Suite del
   archivo: 30/30 passed.

5. **Byte-estabilidad de SYSTEM_PROMPT.** `git diff -U0` del route: ninguna
   línea del template literal aparece en el diff — solo comments alrededor.
   El test de byte-estabilidad + markers anti-invención (`system2 ===
   system1`, contains de SIN_DATOS/error markers) quedó intacto y pasa.

6. **Scope del diff.** `git status --short` → exactamente 2 archivos (`M
   app/api/ai/chat/route.ts`, `M tests/ai/chat-route.test.ts`). Cero deps
   nuevas, `pnpm-lock.yaml` y `package.json` intactos.

## Verificación empírica ejecutada

| Comando | Resultado |
|---|---|
| `git status --short` | Solo los 2 archivos del fix, working tree sin lockfile/package.json |
| `git diff` (completo) | Leído entero; sin escape hatches, sin cambios al body de SYSTEM_PROMPT |
| `git diff -U0 route.ts` + grep de líneas del prompt | Cero líneas del template literal en el diff |
| `grep -rn "SystemModelMessage\|SYSTEM_MESSAGE\|cacheControl"` en app/core/lib/tests/components | Solo los 2 comments intencionales (route.ts:284, test:842) |
| `pnpm typecheck` | exit 0, cero errores |
| `pnpm vitest run tests/ai/chat-route.test.ts` | 30/30 passed (127ms) |
| Lectura de `.superpowers/sdd/t3-caching-fix-scratch-evidence.md` | Comments del diff contrastados contra el drift documentado (A/C sí cachearon en scratch) — sin sobre-afirmaciones |
| WebFetch de vercel.com/docs/ai-gateway/models-and-providers/automatic-caching | Shape del fix idéntico al ejemplo oficial AI SDK; opt-in confirmado para Anthropic; soporta direct/Vertex/Bedrock |
| `grep`/`sed` sobre `node_modules/ai/dist/index.mjs` (7129, 7211) | `providerOptions` se mergea y pasa a `doStream` DENTRO del loop por step — rides en cada step del tool loop |

Nota de proceso: no corrí la suite completa (DB compartida, prohibido por el
brief); el archivo corrido es unit puro con modelo mockeado.
