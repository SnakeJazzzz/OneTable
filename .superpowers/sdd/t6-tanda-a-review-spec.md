# Review SPEC COMPLIANCE — T6 Tanda A (fix jitless, F0)

Carril: spec compliance ÚNICAMENTE. Reviewer ciego al carril quality.
Base: working tree sucio sobre `feat/hardening-t6` @ `59f285c`.
Spec: `.superpowers/sdd/t6-cierre-brief.md` §4 F0 + §1.1 + §6.
Reporte del implementer verificado contra el árbol real
(`.superpowers/sdd/t6-tanda-a-report.md`) — no tomado como cierto.
Fecha: 2026-08-17.

## VEREDICTO GLOBAL: **PASS**

Cero violaciones. Cero desviaciones. Todos los ítems de spec COMPLIANT
con evidencia empírica re-corrible.

## Tabla de ítems de spec

| # | Ítem de spec (fuente) | Estado | Evidencia |
|---|---|---|---|
| 1 | Módulo nuevo `lib/zod-jitless.ts` con `z.config({ jitless: true })` a nivel de módulo (brief §4 F0) | COMPLIANT | `lib/zod-jitless.ts:30-32` — `import { z } from 'zod'` + `z.config({ jitless: true })` top-level, sin wrapper de función |
| 2 | INCONDICIONAL, sin guard `typeof window` (decisión de Michael, brief §1.1 y §4 F0) | COMPLIANT | `grep -n "typeof window" lib/zod-jitless.ts` → único hit es el COMMENT explicativo (línea 16, "no `typeof window` guard — Michael's decision"); cero guard real, cero condicional en el código (líneas 30-32 son todo el código ejecutable) |
| 3 | Comment con el porqué (violation CSP del probe `allowsEval`) + puntero al ledger (brief §4 F0) | COMPLIANT | `lib/zod-jitless.ts:3-14` (probe `util.allowsEval`, chunk `34-09a2e5143d5aa06c.js:16:36104`, cadena ai → provider-utils → zod, mecanismo del short-circuit); puntero al ledger en líneas 21-22. Puntero verificado empíricamente: `sed -n '60,85p' .superpowers/sdd/hardening-backlog.md` → el ítem del eval del chunk 34 vive exactamente ahí |
| 4 | Comment advirtiendo NO reordenar imports / riesgo import-sorters (requisito E3, brief §4 F0) | COMPLIANT | `lib/zod-jitless.ts:24-28` — WARNING explícito ("DO NOT REORDER IMPORTS… Import sorters are the typical way this breaks") |
| 5 | `lib/zod-jitless.ts` como PRIMER import de `components/analisis/chat-panel.tsx` (E3) | COMPLIANT | `components/analisis/chat-panel.tsx:29` — `import '@/lib/zod-jitless';`. Antes de la línea 29 solo hay: `'use client'` (línea 1), comments (3-28) y líneas en blanco — todo admisible. El siguiente import es `react` en línea 31. Alias `@/*` → `./*` verificado en `tsconfig.json:17` y en `vitest.config` (alias `'@'`, línea 30) |
| 6 | Diff de chat-panel.tsx = SOLO la línea de import (+ comment guard adyacente) | COMPLIANT | `git diff --numstat` → `5 0 components/analisis/chat-panel.tsx` (5 líneas agregadas, 0 borradas): 3 líneas de comment guard (26-28) + import (29) + 1 blank (30). El comment guard en el punto de uso NO lo considero desviación: es parte razonable del requisito E3 anti-sorter (el mecanismo de protección opera en el archivo donde el sorter actuaría), no excede el espíritu de "UNA línea de import" — cero lógica, cero otro cambio |
| 7 | Nada más de chat-panel.tsx tocado; área de manejo de errores intacta, Q-1/Q-2/Q-3 de T5 NO activados (no-tocar §6) | COMPLIANT | `git diff components/analisis/chat-panel.tsx` → un solo hunk (líneas 23-33 de contexto), cero deleciones, cero cambios fuera de la inserción del import. `ERROR_COPY` y el bloque de error handling sin tocar |
| 8 | Test unit: importa el módulo y asserta `z.core.globalConfig.jitless === true` (brief §4 F0, "opcional" — hecho) | COMPLIANT | `tests/lib/zod-jitless.test.ts:5` (side-effect import) y `:15` (`expect(z.core.globalConfig.jitless).toBe(true)`). API verificada empíricamente contra el zod pineado: `node -e "const {z}=require('zod'); ... z.config({jitless:true})"` → `z.core.globalConfig` existe y queda `{"jitless":true}`. Ubicación consistente con la suite existente (`tests/lib/` junto a `security-headers.test.ts` etc.) |
| 9 | Ningún otro archivo de código tocado fuera de scope | COMPLIANT | `git status --porcelain` → exactamente 3 entradas: `M components/analisis/chat-panel.tsx`, `?? lib/zod-jitless.ts`, `?? tests/lib/zod-jitless.test.ts`. El reporte del implementer en `.superpowers/sdd/` es legítimo (gitignored-but-tracked path, protocolo vigente) |
| 10 | Cero installs; `package.json` y `pnpm-lock.yaml` intactos (rider §7: T6 no instala nada) | COMPLIANT | Ni `package.json` ni `pnpm-lock.yaml` aparecen en `git status --porcelain` / `git diff --stat` |
| 11 | E3 — verificación ESTÁTICA del orden de evaluación de módulos | COMPLIANT | (a) El import es el primero del entry (ítem 5). (b) `lib/zod-jitless.ts` importa ÚNICAMENTE `zod` (línea 30) — ningún import que construya schemas antes del config. (c) Verificado en el vendor real que la cadena es segura: `node_modules/zod/v4/core/util.js:150` — `allowsEval = cached(...)` es getter LAZY (el probe `new Function("")` solo corre al acceder `.value`); `node_modules/zod/v4/core/schemas.js:901-903` — `const jit = !core.globalConfig.jitless; const fastEnabled = jit && allowsEval.value` → con `jitless: true` el `&&` hace short-circuit y `.value` nunca se accede. Importar `zod` en sí NO dispara el probe. La verificación RUNTIME (console de preview) queda para F1 [MICHAEL], como manda el brief — no se intentó |
| 12 | Único entry cliente que arrastra zod cubierto | COMPLIANT | `grep` de `from 'zod'`/`from 'ai'`/`from '@ai-sdk'` sobre `components/` y `app/`: los únicos consumidores client-side son `chat-panel.tsx:32-33`; `app/api/ai/chat/route.ts:64` es server (fuera del bundle cliente). Consistente con brief §1.1.5 (chunk 34 solo en `/(dashboard)/analisis/page`) |

## Verificación del reporte del implementer contra el árbol

Todas las afirmaciones verificables del reporte coinciden con la
realidad: archivos del diff (3 + reporte), líneas 26-29 de chat-panel,
`'use client'` en línea 1, alias en `tsconfig.json:17`, ubicación del
ítem del ledger, API jitless del zod pineado. La evidencia de suite
(54/54 files, 511/511, con flake de setup en primer run diagnosticado y
re-corrido) es plausible y consistente con un diff que no toca DB ni
lógica; no se re-ejecutó (prohibido por protocolo — dev DB compartida).

## Hallazgos

Ninguno. (S-0: sin hallazgos MAJOR ni MINOR.)
