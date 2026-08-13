# Reporte — fix post-gate T3 §4.6: caching del chat vía gateway caching auto

Fecha: 2026-08-12. Branch: `fix/t3-caching-gateway` off main @ 3ff2438.
Working tree SUCIO, cero commits (esperando el "commiteá").

## Qué se hizo

1. **Diagnóstico empírico** contra el gateway real (6 requests, ~$0.032 USD,
   key leída de `.env.local` sin imprimirse jamás). Detalle y outputs crudos:
   `t3-caching-fix-scratch-evidence.md`.
   - Variante B (candidato, `providerOptions: { gateway: { caching: 'auto' } }`
     a nivel de llamada): **funciona** — req 1 cache write 11122, req 2 cache
     read 11122. Gate del fix cumplido.
   - Variante A (control, anclaje actual): **NO reprodujo el cero de prod** —
     cacheó write 11112 / read 11112. Variante C (anclaje + tools, réplica de
     la forma real de la llamada): también cacheó (11369/11369). Ver "Drift".

2. **Fix** en `app/api/ai/chat/route.ts`:
   - `streamText` gana `providerOptions: { gateway: { caching: 'auto' } }`.
   - `SYSTEM_MESSAGE` (SystemModelMessage + anthropic.cacheControl) eliminado;
     vuelta a `system: SYSTEM_PROMPT` (string, byte-estable, sin otro cambio).
   - Comments reescritos citando SOLO lo que la evidencia soporta: prod 0/0
     con el mecanismo viejo + verificación empírica del nuevo. NO se afirma
     "el anclaje no sobrevive el gateway" como verdad universal (el scratch
     lo desmiente — ver Drift).
   - Cero deps, cero escape hatches: `providerOptions` del SDK acepta el
     namespace `gateway` sin cast (tsc exit 0, verificado).

3. **Tests** (`tests/ai/chat-route.test.ts`, grupo 11): el test del breakpoint
   se reescribió — asserta `call.providerOptions === { gateway: { caching:
   'auto' } }` en las doStreamCalls capturadas y que `prompt[0]` volvió a
   system plano sin providerOptions. Byte-estabilidad + markers anti-invención
   intactos. Cero cambios en el resto de la suite.

## GREEN

- `pnpm typecheck`: exit 0.
- `pnpm test`: **479/479, 49 archivos** (baseline exacto). Nota: una primera
  corrida tuvo 1 archivo de integración flaky (`tests/normalizer/resolve.test.ts`,
  contención contra la Neon dev compartida); pasó 26/26 en aislamiento y la
  re-corrida completa dio 479/479 limpio. Verifiqué cero procesos
  vitest/pnpm-test/next-dev antes de cada corrida.
- `pnpm build`: exit 0.
- Supply-chain post-task: check-supply-chain limpio, pins exact, lockfile
  limpio y SIN cambios (no aparece en git status).

## Re-review (carril quality, agente fresco)

`t3-caching-fix-review-quality.md` — **APPROVE WITH MINORS**.
0 BLOCKER / 0 MAJOR / 1 MINOR (assert de providerOptions solo en la primera
doStreamCall; el reviewer verificó en el source del SDK que providerOptions
ya viaja en cada step — regression-lock opcional). El minor fue al ledger
`b4-followups.md` en esta misma entrega, no al diff.

## ⚠ DRIFT vs la premisa del brief (para tu filtro)

El brief asumía "variante A esperada: cero cache". El scratch NO lo
reprodujo: el anclaje message-level SÍ cacheó desde afuera, con y sin tools,
en 6/6 requests que ejecutaron en el provider `anthropic`. Tu evidencia de
prod (0/0 en 14 requests) sigue sin explicación confirmada. Dos hipótesis
verificables desde tu observability (detalle en el evidence doc):

1. **Routing de prod a un provider fallback** (`claudeaws`/`bedrock`/
   `vertexAnthropic`): ahí el namespace `anthropic` message-level podría
   ignorarse → cero breakpoints. Chequeable en la columna provider de esos
   14 requests.
2. **Semántica del dashboard**: que Cache Read/Write solo cuente el caching
   gestionado por el gateway y no el passthrough del provider. Chequeable
   por costo por request (un cache read factura 0.1x y se nota).

El fix es correcto bajo cualquiera de las dos: `gateway.caching: 'auto'` es
el mecanismo documentado, provider-agnóstico, verificado write→read, y
cachea 10 tokens más que el anclaje manual. Pero si tras el deploy la
observability SIGUE en 0/0, la hipótesis 2 gana y el problema era de
medición, no de caching — vale confirmarlo en el smoke de preview.

## Entregables

- Diff crudo completo: `t3-caching-fix-diff.patch` (o `git diff` en la branch).
- Evidencia del scratch: `t3-caching-fix-scratch-evidence.md`.
- Review quality: `t3-caching-fix-review-quality.md`.
- Ledger actualizado: `b4-followups.md` (M1 nuevo).

## Pendiente de tu autorización

Con tu "commiteá": commit (paths de `git status` al momento), push y
`gh pr create` hacia main — "Fix T3: caching del chat vía gateway caching
auto — cierre de §4.6". NO se mergea (eso es tuyo, post-smoke de preview
sobre staging).
