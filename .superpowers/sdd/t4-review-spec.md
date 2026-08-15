# T4 — Review carril SPEC COMPLIANCE

> Reviewer: carril spec, review CIEGA (no se leyó ningún output de otro
> reviewer ni el parcial descartado). Fecha: 2026-08-14. Base: brief v2
> `.superpowers/sdd/t4-robustez-brief.md`, diff
> `.superpowers/sdd/t4-working-diff.txt` (verificado idéntico al `git diff`
> vivo), archivos untracked leídos del working tree, reporte
> `.superpowers/sdd/t4-report.md`. HEAD `a056d18`, árbol sucio como se
> declaró. Review 100% estática: lectura + greps. CERO git de escritura,
> cero suite/build/typecheck corridos (regla dura del dispatch).

## VEREDICTO: APPROVE WITH MINORS

El diff cumple el brief v2 en los 8 ítems del scope, las 6 enmiendas
E1-E6, las 4 OQs cerradas, los 3 riders y la lista no-tocar de §7. Las
6 desviaciones declaradas en el reporte están bien documentadas y
acotadas; 3 de ellas divergen de la LETRA del brief y quedan listadas
como MINORS para que Michael las sancione explícitamente en el gate
(recomendación: aceptar las tres). Ningún hallazgo MAJOR.

---

## Checks corridos (evidencia del cumplimiento)

1. **Invariante 24/24 (E6) — verificado contra el working tree, no
   contra la tabla.** `find app/api -name route.ts` → 24 archivos.
   Conteo por archivo de `= withRouteErrors(` vs verbos exportados
   directo: 23/24 con TODOS sus verbos envueltos (mappings 4/4,
   skus 2/2, thresholds 2/2, conflicts 2/2, credentials 2/2,
   price-overrides 2/2, skus/[id] 2/2, resto 1/1); cero
   `export (const|function) GET|POST|PUT|PATCH|DELETE` sin wrapper
   fuera de `auth/[...nextauth]/route.ts` (nota: `grep -L
   "withRouteErrors"` del prompt da vacío porque el COMMENT de
   nextauth menciona el símbolo — el check real fue por
   `= withRouteErrors(`). La única excepción es la sancionada por
   OQ-1. Tabla E6 del reporte coincide con la realidad fila por fila;
   toda celda "no" tiene footnote y los footnotes verificados son
   correctos (guard equivalente del chat en
   `app/api/ai/chat/route.ts:199-213`, confirmado por lectura).
2. **OQ-1 (nextauth sin wrap):** la letra del brief es "si nada
   escapa, sin wrap + comment + evidencia". Los tres requisitos están:
   evidencia empírica en el reporte §2 (302 → `/api/auth/error`, body
   0 bytes, `[auth][error]` del logger de @auth/core, stack
   next-auth 5.0.0-beta.32 / @auth/core 0.41.3), comment en
   `app/api/auth/[...nextauth]/route.ts:5-14` apuntando al reporte, y
   `auth.ts` SIN residuo del probe (`git status --porcelain` no lo
   lista; tampoco `app/layout.tsx` del probe de global-error). La
   evidencia sostiene la decisión según la condición del brief.
3. **E1 (mappings DELETE/PATCH):** `throw e` CONSERVADO en ambos catch
   (`app/api/portales/mappings/route.ts:100` DELETE, `:151` PATCH,
   post-diff); mapeo por `instanceof ServiceError` + `switch (e.code)`;
   los 4 pares status/copy IDÉNTICOS a los pre-T4 (verificado contra
   los hunks eliminados del diff: 409 CONFLICTED "Ese mapeo está en
   conflicto; resolvelo…", 404 MAPPING_NOT_FOUND "No existe ese
   mapeo.", 409 NOOP_RETARGET "El SKU nuevo es igual al actual.",
   404 PRODUCT_NOT_FOUND "Ese SKU no existe en tu catálogo.").
   `grep -rn "msg.includes" app/api` → 0 hits.
4. **E2:** `methodOf(args[0])` por duck-type (`lib/route-errors.ts:
   112-118`); la línea del wrapper NO lleva clientId (`:136` pasa solo
   `{ method }`); `grep AsyncLocalStorage` → solo el comment que lo
   prohíbe; los 5 logs migrados llaman `logRouteError` directo con ctx
   (signup sin clientId con justificación en comment — no hay tenant
   aún; data/reset, parametros/import, skus POST, skus/[id] PATCH con
   `clientId` en mano).
5. **E3 (boundaries):** `app/error.tsx` ('use client', `reset()`,
   digest como referencia, Card/Button de la app), `app/not-found.tsx`
   (server, Card, CTA a /dashboard), `app/global-error.tsx` ('use
   client', `<html lang="es"><body>` propios, estilos 100% inline con
   valores del theme hardcodeados — autocontenido). Copy nuevo en
   tuteo; grep de formas voseantes en los 5 archivos nuevos → 0 hits
   (el "resolvelo" que persiste en mappings es copy PRE-existente
   conservado, exactamente lo que §7 exige).
6. **E4/E5:** NEXT_REDIRECT/NEXT_NOT_FOUND NO implementados — solo
   documentados en el header del helper (`lib/route-errors.ts:28-32`),
   como pide E4. El re-throw agregado es SOLO `DYNAMIC_SERVER_USAGE`
   (ver S-2). E5: `grep -i content-length app/api/ai/chat/route.ts` →
   0 hits — el pre-check de Q-4 NO entró.
7. **OQ-2:** default message+stack (`lib/route-errors.ts:91-94`);
   regla `omitMessage` ESCRITA en el helper (`:52-58`) y testeada;
   `[ai-chat]` (`route.ts:241`, solo error name) y `[ai-tools]`
   (`core/ai/tools/context.ts:175`) intactos — ninguno aparece en el
   diff ni en status.
8. **OQ-4:** los 5 sitios del inventario §1.6 migrados (visibles en el
   diff: signup, data/reset, parametros/import, parametros/skus,
   parametros/skus/[id]); no quedan `console.error('[tag]'` en error
   paths de rutas fuera de los dos minimizados por política.
9. **R1:** guard idéntico al patrón fuente (misma condición
   `typeof body !== 'object' || body === null || Array.isArray(body)`,
   mismo `INVALID_BODY` / "Body must be a JSON object" 400 que
   `price-overrides/route.ts:98-100`) en LAS 6: mappings POST/DELETE/
   PATCH, credentials PUT, conflicts POST, thresholds PUT. Testeado
   ×2 casos c/u en `tests/api/body-guards.test.ts` (12 tests).
10. **R2:** P2003 → 404 `PRODUCT_NOT_FOUND` en price-overrides PUT,
    catch local con `instanceof PrismaClientKnownRequestError` +
    `code === 'P2003'`, rethrow del resto al wrapper; +2 tests. (Sobre
    el alcance deleteMany vs upsert, ver S-4.)
11. **R3:** `app/(dashboard)/error.tsx` NO existe (ls → no such file).
12. **§4.7:** comment del quota lookup actualizado (diff `:25-31` del
    chat); el resto del diff del chat es SOLO import + rename a
    `handlePost` + export envuelto — caps/caching/prompt intactos.
13. **§7 no-tocar:** `git diff --name-only` no contiene chat-panel.tsx,
    lib/rate-limit.ts, middleware.ts, auth.ts ni app/layout.tsx;
    health y csp-report solo ganan wrapper + comment (contratos 200/503
    y 204-siempre intactos — sus try internos no se tocaron); mecánica
    per-file de upload intacta (el hunk de upload es solo el wrap);
    parsers/catalog/dates sin cambios; voseo pre-existente conservado.
14. **§3.3 completo:** los 8 throws de `resolve.ts` migrados a
    `ServiceError` (`grep "throw new Error" core/normalizer/resolve.ts`
    → 0); 6 códigos incl. los dos defensa-en-profundidad
    (`MISSING_UPLOAD_ANCHOR`, `INVALID_WINNER`); `core/normalizer/
    errors.ts` sin imports de Next (core puro).
15. **Test plan §6:** todos los puntos obligatorios presentes y
    verificados por lectura: route-errors unit (11: passthrough,
    Response 4xx no logueada, 500 shape, línea JSON única con
    source/route/name/method, method ausente sin Request, code Prisma,
    omitMessage, +sentinel y non-Error), familia clase b (thresholds
    PUT) + clase c (dashboard/kpis) en `route-errors-sweep.test.ts`,
    caso E1 rethrow (en archivo propio — desviación #3, ver S-5),
    body-guards (12), price-overrides P2003/otro código (+2), chat
    quota throw (+1). Conteo estático de tests nuevos = 31, consistente
    con el claim 479→510. La suite NO se corrió en esta review (regla
    del dispatch); los números verdes son claim del implementer.
16. **Reporte completo según el dispatch:** tabla E6 con porqués ✓,
    evidencias (a) OQ-1 y (b) global-error prod-mode ✓ (con residual
    declarado honestamente: check de console en browser real queda al
    smoke de Michael — el propio brief §9/E3c ya lo asigna ahí),
    desviaciones declaradas ✓, suite/typecheck/build ✓ (claims),
    supply-chain ✓ (cero deps nuevas, cero installs — consistente con
    un diff sin package.json/pnpm-lock), lista de archivos = `git
    status` real (9 nuevos + 30 modificados, cotejado 1:1) ✓.
17. **Scope creep:** ninguno. Todo archivo tocado mapea a un ítem del
    scope §3; la observación del footnote 4 (extender R1 a signup/skus)
    quedó correctamente como propuesta para el ledger, NO implementada.
18. **Diff file fidelidad:** `diff <(git diff)
    .superpowers/sdd/t4-working-diff.txt` → idénticos.

---

## Hallazgos

**S-1 — MINOR — Drift no declarado del brief §1.11 vs realidad de los
tests de mappings.** El brief afirmaba que `tests/api/
portales-mappings.test.ts` "simula los throws del servicio con `new
Error('...')` conteniendo los substrings" y que el implementer debía
ajustar esos mocks. Verificación empírica: ese archivo es de
INTEGRACIÓN — induce los throws creando filas CONFLICTED reales en la
DB (`tests/api/portales-mappings.test.ts:123-124,186-187,315-316`) y
ejercitando el servicio real, que ahora lanza `ServiceError`
naturalmente; no había mocks que migrar y los asserts 409/404 siguen
válidos por construcción. El resultado es CORRECTO (nada que corregir
en código), pero el reporte declara "sin drift respecto al brief"
(t4-report.md:5-7) cuando §1.11 estaba fácticamente errado sobre el
mecanismo, y no explica por qué la migración de mocks pedida no fue
necesaria. Incumple la regla de backlog hygiene del proyecto (drift
brief-vs-realidad se reporta, no se absorbe en silencio). Destino:
ledger / corrección del reporte, no bloquea.

**S-2 — MINOR — Desviación #1 (re-throw de `DYNAMIC_SERVER_USAGE`)
requiere sanción explícita de Michael.** El brief (E4, §4.1) fijaba
"cero tratamiento de sentinels implementado, solo nota defensiva"; el
implementer implementó un re-throw por digest para un sentinel
DISTINTO de los dos de E4, por hallazgo empírico en `pnpm build`
(líneas `source:'api'` espurias en cada build; con el fix: 0, rutas
siguen ƒ). Evaluación: bien declarada (t4-report.md §4.1), bien
acotada (solo digest `DYNAMIC_SERVER_USAGE`, solo alcanzable en
build-time; NEXT_REDIRECT/NEXT_NOT_FOUND siguen sin implementar, como
pide E4), con comment justificatorio (`lib/route-errors.ts:34-41`) y
unit test propio. No contradice el brief — extiende su letra por
necesidad empírica que el brief no previó. Formalmente es una decisión
fuera del plan tomada sin PARAR a consultar (regla CLAUDE.md);
recomendación: aceptar en el gate — el fallback (consultar) habría
producido el mismo fix.

**S-3 — MINOR — Desviación #5 (`omitMessage` omite también `stack`)
excede la letra de OQ-2.** El brief solo pedía omitir `message`; el
implementer omite además `stack` porque los stacks de V8 embeben el
message en su primera línea — mantener el stack anularía la regla.
Declarada (t4-report.md §4.5), documentada en el helper
(`lib/route-errors.ts:52-58`) y testeada
(`tests/lib/route-errors.test.ts:161-170`). Cumple la INTENCIÓN de
OQ-2 mejor que su letra. Recomendación: aceptar.

**S-4 — MINOR — Desviación #6 (catch P2003 solo en el `upsert`, no en
el `deleteMany`).** El brief §4.4 decía "catch local alrededor del
`deleteMany/upsert` (`:135,141`)"; el implementer envolvió solo el
upsert, con razonamiento en comment (`app/api/portales/price-overrides/
route.ts`, hunk del diff `:866-875`): borrar filas de override no puede
violar la FK de `productId` (peor caso: 0 filas borradas), y cualquier
otro throw del deleteMany cae al wrapper (el piso que el propio brief
acepta). Declarada (t4-report.md §4.6). Narrowing sano y acotado.
Recomendación: aceptar.

---

Sin hallazgos MAJOR. Los MINORS S-2/S-3/S-4 son desviaciones DECLARADAS
que el protocolo canaliza vía este gate; S-1 es una corrección de
reporte para el ledger. APPROVE WITH MINORS.
