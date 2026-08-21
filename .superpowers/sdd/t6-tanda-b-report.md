# T6 — TANDA B: fixes autorizados del triage + flip de CSP — reporte del implementer

> Generado 2026-08-20 sobre `feat/hardening-t6` @ `24f9793` + working tree
> SUCIO (protocolo: el implementer para en GREEN, cero git). Ejecuta el
> brief congelado `t6-cierre-brief.md` §4 F4 + las decisiones de Michael de
> `t6-zap-report.md` §5. Scope: 6 piezas de código + 1 de CI. Implementer
> fresco, sin installs (por diseño de la tanda).

---

## 0. Resumen de archivos tocados (git status al cierre)

```
 M .github/workflows/backup.yml        (I-4 sweep)
 M app/api/portales/mappings/route.ts  (I-8 P2025→404)
 M lib/rate-limit.ts                   (I-3 cap/hash de key)
 M lib/security-headers.ts             (flip CSP + form-action + COOP + comments)
 M next.config.mjs                     (poweredByHeader: false)
 M tests/lib/rate-limit.test.ts        (tests I-3)
 M tests/lib/security-headers.test.ts  (asserts flip/form-action/COOP)
?? tests/api/mappings-p2025.test.ts    (tests I-8, archivo nuevo)
```

156 insertions / 22 deletions (`git diff --stat`) + el archivo de test nuevo.

---

## 1. Pieza (1) — FLIP de CSP a enforced en production

**Archivo:** `lib/security-headers.ts`

- `buildCspHeader` (ahora líneas 113-120): el branch
  `env === 'production' ? 'Content-Security-Policy-Report-Only' : …`
  DESAPARECIÓ — todos los entornos emiten la key
  `'Content-Security-Policy'` (enforced). Firma intacta
  (`(env: CspEnv): Header`); el `value` sigue saliendo de
  `buildCspDirectives(env).join('; ')`.
- Comments reformulados al tiempo correcto, conservando el contexto
  histórico:
  - Header del módulo (líneas 12-20): el mapping de entornos ahora dice
    production → ENFORCED "(flipped in T6; it shipped as Report-Only from
    T2 while gated on zero violations — the last one, zod's `allowsEval`
    probe, was fixed via jitless in T6 Tanda A)".
  - Docstring de `buildCspHeader` (líneas 109-112): "ENFORCED everywhere.
    Production started in Report-Only (T2) and was flipped to enforced in
    T6…".
  - **Extensión menor (mismo espíritu, mismo lib):** la NOTA de
    `frame-ancestors` (líneas 37-41) afirmaba en presente que production
    entrega Report-Only y que por eso los browsers ignoran
    `frame-ancestors` ahí. Post-flip eso quedaba FALSO — la reformulé al
    pasado ("as production was pre-flip, T2→T6") y aclaré que ahora
    `frame-ancestors 'none'` está activo en todos los entornos, con
    `X-Frame-Options: DENY` como segunda capa redundante. El brief nombró
    líneas ~14-15 y ~99-100; este tercer comment era del mismo tipo
    (desactualizado por el flip) y dejarlo habría sido un hallazgo de
    review. Cero cambio de comportamiento.

**Test:** `tests/lib/security-headers.test.ts`
- El `it` de production (líneas 39-41) INVERTIDO: título "production emits
  the ENFORCED header (flipped in T6; Report-Only was T2..T5)", assert
  `buildCspHeader('production').key === 'Content-Security-Policy'`.
- `buildSecurityHeaders` (líneas 96-112): assert nuevo de que la única key
  CSP es la enforced en los TRES entornos.
- Los asserts de preview/development enforced siguen intactos y verdes.

## 2. Pieza (2) — `form-action 'self'` (Z-1)

**Archivo:** `lib/security-headers.ts`, `buildCspDirectives` (línea 106):
`"form-action 'self'"` agregada entre `base-uri 'self'` y
`report-uri` — posición coherente: es la otra directiva que NO cae al
fallback de default-src, con comment del porqué (Z-1). Aplica en TODOS los
entornos (el array base es compartido). Tightening puro: cero orígenes
nuevos (§6 del brief respetado).

**Test:** assert `toContain("form-action 'self'")` en el loop
preview+production (línea 67) Y en el test de development (línea 91).

## 3. Pieza (3) — COOP `same-origin` (Z-7)

**Archivo:** `lib/security-headers.ts`, `buildAlwaysEnforcedHeaders`
(línea 74): `{ key: 'Cross-Origin-Opener-Policy', value: 'same-origin' }`
como quinto header, con comment de que COEP quedó FUERA (Z-6 descartado).

**Test:** `toHaveLength(4)` → `toHaveLength(5)` (línea 35), assert nuevo
key+value de COOP (línea 33) y assert explícito de que COEP NO está
(línea 34). `buildSecurityHeaders` pasa de 5 a 6 headers totales — el
assert `toHaveLength(5)` de ese describe también se actualizó a 6 (línea
98) con assert de presencia de COOP.

## 4. Pieza (4) — `poweredByHeader: false` (Z-8)

**Archivo:** `next.config.mjs` línea 16, con comment. El hook `headers()`
y el import del builder quedaron intactos.

**Verificación:** NO hay test unit posible (comportamiento runtime del
server, no del builder puro). La verificación real es el smoke de preview
de Michael: `curl -sI <preview-url>/ | grep -i x-powered-by` → cero
resultado esperado (hoy el 307 de `/` lo manda).

## 5. Pieza (5) — I-3: cap/hash de la key del limiter

**Archivo:** `lib/rate-limit.ts` — diseño EXACTO de Michael implementado:

- `KEY_MAX_LEN = 256` exportada (línea 74) con comment del porqué (vector
  `login:email` ~5KB → upsert lanza → fail-open silencioso del scope).
- `normalizeKey(key)` exportada y pura (líneas 84-87): longitud ≤ 256 →
  key INTACTA; > 256 → sha256 hex (64 chars) de la key COMPLETA vía
  `createHash('sha256')`.
- Aplicada en los DOS entry points por los que TODA key entra al SQL —
  cubren los tres sitios de SQL:
  - `incrementWindow` (línea 120, param renombrado a `rawKey`): normaliza
    UNA vez y el `key` normalizado alimenta tanto el DELETE del cleanup
    CTE como el INSERT…ON CONFLICT (sitios 1 y 2). Usado por
    `consumeRateLimit` Y `recordFailure`.
  - `peekRateLimit` (línea 169, destructuring `key: rawKey`): mismo
    normalizeKey antes de su SELECT propio (sitio 3). Peek y
    consume/record coinciden en la misma fila.
- Política fail-open, números de límite y semántica de ventana: INTACTOS.

**⚠ DRIFT del brief (reportado, no improvisación fuera de scope):** el
brief pedía `createHash` **de `node:crypto`**. Con ese specifier
`pnpm build` FALLA: `lib/rate-limit.ts` entra al bundle EDGE vía
`auth.ts` → `middleware.ts`, y el webpack del layer edge de Next 14 no
maneja el scheme `node:` (`UnhandledSchemeError: Reading from
"node:crypto" is not handled by plugins` — log en scratchpad,
build-run.log; import trace: `node:crypto ← ./lib/rate-limit.ts ←
./auth.ts`). El specifier BARE `'crypto'` (línea 35, con comment del
porqué) compila y es la MISMA API/función — la llamada solo se EJECUTA en
Node runtime (authorize/route handlers); el wrapper de middleware solo
decodifica el JWT y jamás toca normalizeKey. Verificado empíricamente en
ambas direcciones (build rojo con `node:`, verde con bare).
**Costo residual:** el build ahora emite UN warning nuevo no-bloqueante:
"A Node.js module is loaded ('crypto' at line 33) which is not supported
in the Edge Runtime" (import trace rate-limit ← auth). Es exacto y
benigno (código muerto en el bundle edge). Alternativas si el warning
molesta: (a) Web Crypto `crypto.subtle.digest` — sin warning pero vuelve
`normalizeKey` async y diverge más del diseño decidido; (b) el split
edge-safe estándar de NextAuth v5 (`auth.config.ts`) — fix estructural,
fuera de scope de T6. Decisión para Michael/reviewers.

**Tests:** `tests/lib/rate-limit.test.ts`, describe nuevo
"normalizeKey (I-3, hardening T6)" (líneas ~131-168):
- FRONTERA: key de exactamente 256 chars intacta; 257 chars → hasheada,
  64 chars, `/^[0-9a-f]{64}$/`, ≠ original.
- DETERMINISMO / NO-COLISIÓN: misma key larga → mismo hash; dos keys
  largas DISTINTAS (>256) → hashes DISTINTOS. Testeado DIRECTO sobre el
  helper puro exportado (opción preferida del brief).
- Integración extra: consume + peek con la MISMA key de ~5KB coinciden en
  la MISMA fila; la fila almacenada tiene la key de 64 chars (nunca el
  string crudo).

## 6. Pieza (6) — I-8: P2025 → 404 en mappings DELETE/PATCH

**Archivo:** `app/api/portales/mappings/route.ts`
- Import nuevo (línea 9): `import { Prisma } from '@prisma/client'` como
  VALUE import (el `instanceof` necesita el valor); `MappingStatus` sigue
  `import type` aparte. Mismo patrón que `app/api/auth/signup/route.ts:17`
  y `price-overrides/route.ts`.
- `handleDelete` catch (línea 103) y `handlePatch` catch (línea 159):
  rama nueva ANTES del `throw e` final —
  `e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025'`
  → `errorResponse('MAPPING_NOT_FOUND', 'No existe ese mapeo.', 404)`
  (misma copy/código que la rama ServiceError, por consistencia). El
  switch de ServiceError y el rethrow final quedan intactos.

**Tests:** `tests/api/mappings-p2025.test.ts` (archivo NUEVO) — mismo
patrón zero-DB de `mappings-e1-rethrow.test.ts` (vi.mock del service; ese
archivo documenta por qué NO se spyea el PrismaClient real: restaurar el
spy corrompe `$transaction`). Además mockea `@/lib/db` porque
`handleDelete` hace `db.upload.findFirst` a nivel route ANTES del service.
3 casos:
- DELETE: service lanza P2025 (construido con
  `new Prisma.PrismaClientKnownRequestError('…', { code: 'P2025',
  clientVersion: 'test' })`) → 404 + body code `MAPPING_NOT_FOUND`, sin
  log del wrapper.
- PATCH: ídem → 404 + `MAPPING_NOT_FOUND`.
- Estrechez: OTRO code Prisma (P2002) sigue rethrowing → 500 `INTERNAL` +
  1 log estructurado (la rama no traga nada que no sea P2025).

## 7. Pieza (I-4) — sweep de RateLimit en backup.yml

**Archivo:** `.github/workflows/backup.yml`, step nuevo
"Sweep de filas stale de RateLimit (I-4, hardening T6)" (líneas 108-126):
- `DELETE FROM "RateLimit" WHERE "windowStart" < now() - interval '7 days';`
  vía `/usr/lib/postgresql/17/bin/psql "$BACKUP_DATABASE_URL"` (mismo
  path absoluto que pg_dump; psql viene en el postgresql-client-17 que el
  workflow ya instala). `set -euo pipefail` como los demás steps. Mismo
  secret `BACKUP_DATABASE_URL` (production unpooled — por diseño: el
  sweep corre contra la DB real de prod).
- Comment en el step con el porqué completo (I-4: keys IP one-shot del
  flood posible al csp-report público crecen sin cota en Neon Free; el
  cleanup lazy del limiter solo barre ventanas viejas del MISMO
  scope+key; piggyback en el cron diario existente, cero infra nueva).
- **Posición elegida (dentro del margen que dio el diseño):** DESPUÉS del
  step de pg_dump+cifrado Y después del upload del artifact. Criterio: el
  diseño exigía "después del dump" (el backup del día captura el estado
  previo al sweep — cumplido en ambas posiciones); entre las dos opciones
  que dio el brief elegí post-upload para que un fallo del sweep JAMÁS
  bloquee la subida del RESPALDO PRIMARIO (perder un sweep diario es
  trivial e idempotente; perder un backup no). El costo simétrico (upload
  falla → sweep de ese día no corre) es menor y se auto-repara al día
  siguiente.

**Verificación:** no hay test unit de CI. La verificación real es el
próximo run del cron (o un `workflow_dispatch` dry-run de Michael
post-merge — el dispatch solo está disponible desde la branch default).

---

## 8. No-tocar (§6 del brief) — constancia

- Cero orígenes nuevos en la CSP; cero `'unsafe-eval'`; los
  `'unsafe-inline'` de script-src/style-src INTACTOS (líneas 88-99 del
  lib, sin cambios).
- `lib/db-guard.ts`: intacto. Staging de Neon: no tocada.
- `chat-panel.tsx` y `lib/zod-jitless.ts` (Tanda A): intactos.
- `scripts/preflight.ts`: ni corrido ni tocado.
- Vars legacy de Vercel: no leídas.
- Anclaje message-level de caching (T3): no reintroducido.
- `lib/route-errors.ts` (Q-5: INTERNAL ratificado): CERO cambio.

## 9. Verificación (evidencia)

1. **`pnpm typecheck`** → exit 0 (prisma generate + `tsc --noEmit`
   limpios).
2. **Procesos previos:** `ps aux | grep -E "vitest|pnpm test|next dev"`
   → vacío antes de cada run de suite.
3. **`pnpm test` (suite completa, Neon dev):**
   - Run inicial post-cambios: 54/55 files — `tests/normalizer/
     resolve.test.ts` falló con "Can't reach database server" (hiccup de
     conectividad Neon, archivo NO tocado por esta tanda); re-run
     standalone del archivo: 26/26 verde. Segundo run completo: 4 flakes
     de la misma familia DB-remota.
   - **Run completo VERDE (árbol con todo el diff salvo el specifier de
     crypto):** `Test Files 55 passed (55) · Tests 517 passed (517)`
     (430s). Log: scratchpad/suite-run3.log.
   - **Run completo FINAL sobre el árbol definitivo** (única edición
     posterior: `node:crypto` → `'crypto'`, mismo API): exit 0,
     `Test Files 55 passed (55) · Tests 517 passed (517)`. Este es el run
     que respalda el GREEN de la tanda.
4. **`pnpm build`** → exit 0 (tras el fix del specifier — ver drift en
   §5). Con `node:crypto` el build FALLABA (evidencia en §5). Nota: 1
   warning nuevo no-bloqueante del edge bundle, documentado en §5.
5. **Checklist supply-chain (punto 8, sin installs en esta tanda):**
   - `./scripts/check-supply-chain.sh` → "✅ Clean — no infection
     markers detected" (exit 0), corrido como verificación post-task.
   - Pins: `grep -E '"[\^~]' package.json` → cero matches (pins exact).
   - Lockfile: grep de tokens sospechosos → cero resultados (clean).
   - CERO paquetes instalados/agregados; `pnpm-lock.yaml` sin cambios.

## 10. Diff conceptual por pieza (resumen de una línea)

| Pieza | Diff conceptual |
|---|---|
| (1) flip | `buildCspHeader`: branch por env eliminado → key enforced única; 3 comments re-tensados al pasado |
| (2) form-action | +1 directiva `form-action 'self'` en el array base de `buildCspDirectives` |
| (3) COOP | +1 header `Cross-Origin-Opener-Policy: same-origin` en `buildAlwaysEnforcedHeaders` |
| (4) X-Powered-By | +`poweredByHeader: false` en `nextConfig` |
| (5) I-3 | +`KEY_MAX_LEN`/`normalizeKey` puros y exportados; normalización en los 2 entry points SQL (3 sitios) |
| (6) I-8 | +rama P2025→404 antes del rethrow en los 2 catches; +import VALUE de `Prisma` |
| (I-4) sweep | +step psql DELETE 7-days en backup.yml, post-dump/post-upload, mismo secret |

## 11. Pendientes que NO son de esta tanda (para el controller)

- Smoke de preview de Michael (obligatorio pre-merge): console limpia +
  `curl -sI` de headers (CSP enforced ya estaba en preview; verificar
  ausencia de `X-Powered-By`, presencia de COOP y `form-action` en el
  CSP).
- Post-merge/deploy: verificación del flip en prod
  (`curl -sI https://onetable-gold.vercel.app/ | grep -i
  content-security` → sin `-Report-Only`).
- Primer run del sweep I-4: próximo cron diario o workflow_dispatch.
- DECISIÓN pendiente de Michael/review sobre el drift de §5 (specifier
  `'crypto'` + warning de edge bundle vs alternativas listadas).
