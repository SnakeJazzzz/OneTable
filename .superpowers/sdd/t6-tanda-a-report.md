# Reporte T6 — Tanda A: fix jitless (F0)

Implementer report. Branch `feat/hardening-t6` @ `59f285c`, árbol SUCIO
(cero git por protocolo). Spec: `.superpowers/sdd/t6-cierre-brief.md` §4
F0 (+ §1.1 contexto, §6 no-tocar). Fecha: 2026-08-17.

## Qué se hizo

### 1. `lib/zod-jitless.ts` (NUEVO, 34 líneas)

Módulo side-effect: `import { z } from 'zod'` +
`z.config({ jitless: true })` a nivel de módulo, INCONDICIONAL (sin
guard `typeof window`, decisión de Michael — aplica también SSR/server).
El comment (inglés, estándar del repo) documenta:

- El porqué: probe `util.allowsEval` de zod 4.3.6
  (`try { new Function("") }`) dispara violation CSP real
  (`script-src` sin `'unsafe-eval'`) — reports de los smokes T4/T5,
  chunk `34-09a2e5143d5aa06c.js:16:36104`, desde /analisis y
  /dashboard; cadena de import ai → @ai-sdk/provider-utils → zod.
- El mecanismo del fix: gate JIT de `$ZodObject`
  (`node_modules/zod/v4/core/schemas.js:901-918`) hace short-circuit
  con `jitless: true` — el probe ni se evalúa.
- Puntero al ledger: `.superpowers/sdd/hardening-backlog.md`, CORTE
  punto 2, ítem del eval del chunk 34 (~líneas 63-82). Verificado
  empíricamente que el ítem vive ahí (`sed -n '60,85p'`).
- WARNING de NO reordenar imports (requisito E3): evaluación
  depth-first de módulos ES → debe ser el PRIMER import de cualquier
  entry cliente que arrastre zod; los import-sorters son el riesgo
  típico.

### 2. `components/analisis/chat-panel.tsx:26-29` (UNA línea de import + comment guard)

`import '@/lib/zod-jitless';` como PRIMER import del archivo
(líneas 26-29 post-edit: 3 líneas de comment "MUST stay the first
import" + la línea de import), inmediatamente ANTES de todo otro import
(el primero era `react`, ex-línea 26). `'use client'` queda en línea 1
(verificado empíricamente antes de editar) y el header comment del
archivo (líneas 3-24) intacto. NADA MÁS del archivo se tocó: cero
reordenamiento, cero formato, el área de manejo de errores intacta
(Q-1/Q-2/Q-3 de T5 NO activados — §6 del brief).

Decisión no obvia: el import va después del header comment del archivo
(no en línea 2) — los comments no son imports, el requisito E3 es "primer
import" y así queda; el comment guard adyacente protege contra sorters.

### 3. `tests/lib/zod-jitless.test.ts` (NUEVO — el "opcional" del brief, hecho)

Importa el módulo por side effect y asserta
`z.core.globalConfig.jitless === true`. Ubicado en `tests/lib/`
consistente con `security-headers.test.ts` (mismo estilo de imports,
alias `@/`).

**Estado global documentado (pedido de la spec):** `z.config` muta el
`globalConfig` compartido del proceso de test — todo test del mismo
proceso posterior al import ve `jitless=true`. Es seguro por diseño:
jitless solo apaga el fast-path compilado de `$ZodObject` y cae al parse
regular — resultados idénticos, cero cambio de comportamiento. Ningún
test de la suite depende de `jitless=false` (la suite completa pasa,
ver abajo). El caveat está en comment dentro del test.

## Verificación previa (empirical-first)

- Alias `@/*` → `./*` confirmado en `tsconfig.json:17`; el patrón
  `@/lib/...` ya se usa en chat-panel.tsx (líneas 30-33).
- `'use client'` en línea 1 de chat-panel.tsx, confirmado por lectura.
- API jitless verificada en el zod pineado ANTES de escribir código:
  `node -e "const {z}=require('zod'); z.config({jitless:true}); ..."`
  → `{"jitless":true}`; typing en
  `node_modules/zod/v4/core/core.d.ts:67`.
- Cero procesos vitest/pnpm-test concurrentes antes de correr la suite
  (`ps aux | grep -E "vitest|pnpm test"` → vacío).

## Verificación de tanda (todo GREEN)

| Comando | Resultado |
|---|---|
| `pnpm typecheck` | exit 0, cero errores |
| `pnpm test` | **54/54 files, 511/511 tests passed** (run definitivo, 237s) |
| `pnpm build` | exit 0, build completo |

**Nota de flake (no relacionado al cambio):** el PRIMER run de la suite
falló `tests/normalizer/resolve.test.ts` en el SETUP
(`db.user.deleteMany` en `seedClient`, tests/normalizer/resolve.test.ts:34)
— contención/timeout contra la Neon dev DB compartida, no toca nada del
diff (el diff es config de zod + un test nuevo aislado). Diagnóstico
empírico: el archivo pasa en aislamiento (26/26) y el re-run completo de
la suite dio 54/54 files, 511/511 tests. Observación menor: el primer
run reportó "508 passed | 3 skipped (511)", el segundo "511 passed
(511)" — hay 3 tests con skip condicional en la suite que en el run
definitivo corrieron y pasaron; lo dejo constatado para los reviewers.

**Verificación extra del bundle (post-build):** el call sobrevive la
minificación y llega al client bundle de /analisis —
`grep "jitless:!0" '.next/static/chunks/app/(dashboard)/analisis/page-*.js'`
→ match (es `z.config({jitless:true})` minificado); referencias
`jitless` también en el vendor chunk 34 nuevo
(`34-a51906d908b472b7.js`, el gate de schemas.js). La verificación
RUNTIME del requisito E3 (console sin violation en preview enforced) es
F1 [MICHAEL], como manda el brief.

## Drift spec→realidad

Ninguno. Todo lo afirmado por la spec se verificó empíricamente y
coincidió (alias, 'use client', API jitless, estructura de tests,
ubicación del ítem del ledger).

## Supply chain (checklist #8 — cero installs en la tanda, por diseño)

```
./scripts/check-supply-chain.sh
→ ✅ Clean — no infection markers detected
grep -E '"[\^~]' package.json → sin matches → ✅ pins exact
grep -E "tanstack|squawk|..." pnpm-lock.yaml | grep -v lightningcss
→ sin matches → ✅ lockfile clean
```

`pnpm-lock.yaml` y `package.json` intactos (cero installs).

## Archivos del diff (árbol sucio, cero git)

- `lib/zod-jitless.ts` (nuevo)
- `components/analisis/chat-panel.tsx` (4 líneas agregadas: 26-29)
- `tests/lib/zod-jitless.test.ts` (nuevo)
- `.superpowers/sdd/t6-tanda-a-report.md` (este reporte; recordar
  `git add -f` para paths de `.superpowers/sdd/` al commitear)

Cero shells de background vivas. Cero loops de polling. Blockers: ninguno.
