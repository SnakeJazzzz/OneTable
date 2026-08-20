# T6 — TANDA B: review de CUMPLIMIENTO DE SPEC (spec-compliance lane)

> Reviewer ciego al carril de calidad. Objeto: árbol de trabajo SUCIO vs
> HEAD (`5383549`) en `feat/hardening-t6`. Fuentes de verdad: `t6-zap-report.md`
> §5 (decisiones de Michael) + nota de diseño I-3/I-4, `t6-cierre-brief.md`
> §4 F4 / §1.2 / §6. Solo lectura; cero git, cero build, cero tests.

---

## VEREDICTO GLOBAL: **PASS WITH NOTES**

Las 7 piezas autorizadas están implementadas fielmente y con sus tests. Cero
scope-creep: cada archivo/línea del diff mapea a una de las 7 piezas o a un
comment desactualizado por el flip. La ÚNICA nota es una desviación TEXTUAL del
brief (specifier `'crypto'` vs `node:crypto`) que el implementer reportó
explícitamente y que NO altera el comportamiento funcional exigido por I-3
(mismo `createHash`, misma API). No es un fallo de spec: el diseño decidido
(≤256 intacta / sha256 hex de la key completa) se cumple byte a byte. Queda como
decisión de Michael, no del carril de spec.

---

## Pieza 1 — FLIP de CSP a enforced en production ✅

- `buildCspHeader` (`lib/security-headers.ts:115-120`): el branch
  `env === 'production' ? 'Content-Security-Policy-Report-Only' : 'Content-Security-Policy'`
  DESAPARECIÓ. Ahora retorna incondicionalmente `key: 'Content-Security-Policy'`.
  Firma intacta `(env: CspEnv): Header`; el `value` sigue de
  `buildCspDirectives(env).join('; ')`. Flip correcto y completo.
- Ningún entorno quedó mal: preview y development ya emitían enforced (no
  cambian); production pasa de Report-Only a enforced. El diseño resuelve por
  `VERCEL_ENV` a BUILD time se conserva (solo cambió la KEY, no las directivas).
- Comments desactualizados corregidos, los tres del mismo tipo:
  - Header del módulo `:14-17` (production → ENFORCED, con historia T2→T6).
  - Docstring de `buildCspHeader` `:111-114` (ENFORCED everywhere).
  - NOTA de `frame-ancestors` `:39-43` reformulada al pasado ("as production
    was pre-flip, T2→T6"). El brief §1.2 nombró "líneas 14-15, 99-100 + posibles
    docstrings"; este tercer comment cae bajo "posibles docstrings/comments
    desactualizados por el flip" — está DENTRO del scope del flip (§1.2: "comments
    desactualizados"), no es scope-creep. Cero cambio de comportamiento.
- Test `tests/lib/security-headers.test.ts`: el `it` de production (diff
  `:39-41`) INVERTIDO de Report-Only a enforced —
  `expect(buildCspHeader('production').key).toBe('Content-Security-Policy')`.
  Además el describe `buildSecurityHeaders` (`:96-112`) agrega assert de que la
  única key CSP es la enforced en los TRES entornos. Preview/dev enforced intactos.

## Pieza 2 — `form-action 'self'` (Z-1) ✅

- `buildCspDirectives` (`lib/security-headers.ts:106`): `"form-action 'self'"`
  agregada entre `base-uri 'self'` y `report-uri`. Array base compartido → aplica
  a los TRES entornos.
- Es TIGHTENING puro: cero orígenes nuevos, solo una directiva restrictiva.
  Coincide con Z-1 §5 ("`form-action 'self'` en buildCspHeader + assert").
- Test: assert `toContain("form-action 'self'")` en el loop preview+production
  (`security-headers.test.ts` diff `:67`) Y en el test de development (`:91`).

## Pieza 3 — COOP `same-origin` (Z-7), sin COEP ✅

- `buildAlwaysEnforcedHeaders` (`lib/security-headers.ts:70-74`):
  `{ key: 'Cross-Origin-Opener-Policy', value: 'same-origin' }` como quinto header.
  Comment explícito de que COEP quedó FUERA (Z-6 descartado). Correcto: NO se
  agregó COEP.
- Tests: `toHaveLength(4)` → `toHaveLength(5)` (diff `:35`), assert key+value de
  COOP, assert explícito `expect(byKey['Cross-Origin-Embedder-Policy']).toBeUndefined()`
  (COEP ausente). En `buildSecurityHeaders`: `toHaveLength(5)` → `toHaveLength(6)`
  + `expect(keys).toContain('Cross-Origin-Opener-Policy')`. Los dos `toHaveLength`
  que el brief pedía subir están cubiertos (4→5 en always-enforced, 5→6 en el set
  completo).

## Pieza 4 — `poweredByHeader: false` (Z-8) ✅

- `next.config.mjs:13-16`: `poweredByHeader: false` agregado al objeto
  `nextConfig`, con comment (Z-8). El hook `headers()` y el import del builder
  intactos. Sin test unit — esperado y así declarado (comportamiento runtime del
  server, no del builder puro). Coincide con §5 ("`poweredByHeader: false` en
  next.config.mjs").

## Pieza 5 — I-3: cap/hash de la key del limiter ✅ (diseño EXACTO)

- Diseño decidido por Michael (§5 nota I-3): "key intacta si ≤256 chars, si no
  sha256 hex de la key COMPLETA, ANTES del SQL". Implementado literal:
  - `KEY_MAX_LEN = 256` exportada (`lib/rate-limit.ts:74`).
  - `normalizeKey(key)` (`:84-87`): `if (key.length <= KEY_MAX_LEN) return key;`
    else `createHash('sha256').update(key).digest('hex')`. Hex de 64 chars de la
    key COMPLETA (no truncada antes de hashear). Determinista. EXACTO al diseño.
- Cobertura de TODOS los sitios SQL — verificado leyendo el archivo completo:
  - `incrementWindow` (`:115-120`): `const key = normalizeKey(rawKey)` ANTES del
    `$queryRaw`. El `key` normalizado alimenta el DELETE del cleanup CTE (`:125`) Y
    el INSERT…ON CONFLICT (`:127-131`) — sitios SQL 1 y 2. `incrementWindow` es
    llamado por `consumeRateLimit` (`:149`) Y por `recordFailure` (`:195`), así que
    ambos quedan cubiertos por la normalización única.
  - `peekRateLimit` (`:163-169`): `key: rawKey` en el destructuring +
    `const key = normalizeKey(rawKey)` ANTES del SELECT (`:172-175`) — sitio SQL 3.
  - NO queda ningún bypass: los tres $queryRaw del módulo (increment CTE+insert,
    peek select) usan la variable `key` ya normalizada; `rawKey` nunca toca SQL.
    `recordFailure` no tiene SQL propio — delega en `incrementWindow`.
- Tests `tests/lib/rate-limit.test.ts` (diff `:132-171`):
  - FRONTERA 256/257: key de exactamente `KEY_MAX_LEN` intacta; `KEY_MAX_LEN+1`
    hasheada, `/^[0-9a-f]{64}$/`, ≠ original. Cubre la frontera decidida.
  - DETERMINISMO / NO-COLISIÓN: misma key larga → mismo hash; dos keys largas
    DISTINTAS → hashes distintos. Cubre lo pedido en la nota de diseño.
  - Integración extra: consume+peek con la misma key ~5KB caen en la MISMA fila,
    y la fila almacenada tiene 64 chars (nunca el string crudo). Refuerza que
    peek/consume coinciden.

## Pieza 6 — I-8: P2025 → 404 en mappings DELETE/PATCH ✅

- `app/api/portales/mappings/route.ts`:
  - `handleDelete` catch (`:103-105`): rama
    `if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025')`
    → `errorResponse('MAPPING_NOT_FOUND', 'No existe ese mapeo.', 404)`, ANTES del
    `throw e` (`:106`).
  - `handlePatch` catch (`:159-161`): rama IDÉNTICA, ANTES del `throw e` (`:162`).
  - AMBOS catches cubiertos. En los dos, la rama P2025 va DESPUÉS del switch de
    `ServiceError` y ANTES del rethrow — orden correcto (P2025 no es ServiceError,
    así que el switch no lo intercepta; sin la rama nueva caería al rethrow → 500).
- Copy/código consistente con el `MAPPING_NOT_FOUND` existente: mismo code
  (`'MAPPING_NOT_FOUND'`), misma copy ("No existe ese mapeo."), mismo status 404
  — idéntico a la rama `case 'MAPPING_NOT_FOUND'` del switch de ServiceError
  (`:96` en DELETE, `:149` en PATCH). Consistencia total.
- Import VALUE `import { Prisma } from '@prisma/client'` (`:9`) necesario para el
  `instanceof`; `MappingStatus` sigue `import type` aparte (`:10`). Correcto.
- Test `tests/api/mappings-p2025.test.ts` (archivo NUEVO): 3 casos —
  DELETE P2025 → 404 `MAPPING_NOT_FOUND` sin log; PATCH P2025 → 404 sin log;
  ESTRECHEZ: OTRO code Prisma (P2002) sigue rethrowing → 500 `INTERNAL` + 1 log.
  El caso de estrechez confirma que la rama solo traga P2025, no cualquier
  PrismaClientKnownRequestError. Cobertura fiel de I-8.

## Pieza 7 — I-4: sweep de RateLimit en backup.yml ✅

- `.github/workflows/backup.yml:107-126`: step nuevo "Sweep de filas stale de
  RateLimit (I-4, hardening T6)".
  - Query EXACTA de §5:
    `DELETE FROM "RateLimit" WHERE "windowStart" < now() - interval '7 days';`
    vía `/usr/lib/postgresql/17/bin/psql "$BACKUP_DATABASE_URL"`.
  - Secret correcto: `BACKUP_DATABASE_URL` (el mismo del dump; §5 lo exige). NO
    inventa otro secret.
  - Posición: DESPUÉS del dump (y del upload del artifact). §5 decidió "después
    del dump" — cumplido. La elección post-upload (vs entre dump y upload) está
    justificada en el reporte y dentro del margen del diseño; no viola la spec
    (el requisito era "después del dump", que se cumple en ambas variantes).
  - `set -euo pipefail` presente. Env `BACKUP_DATABASE_URL` inyectado desde
    `secrets.BACKUP_DATABASE_URL`. Sin test unit — esperado (CI step).

---

## Scope-creep / No-tocar (§6 del brief) — SIN VIOLACIONES

- **CSP: cero orígenes nuevos.** Verificado `buildCspDirectives` (`:79-109`): las
  únicas adiciones son `form-action 'self'` (pieza 2, restricción). `default-src`,
  `img-src`, `connect-src` etc. sin nuevos hosts.
- **Cero `'unsafe-eval'` agregado** fuera del dev-only preexistente
  (`:86`, era ya así). **`'unsafe-inline'` de script-src/style-src INTACTOS**
  (`:87`, `:96`) — no tocados.
- **`lib/db-guard.ts`**: no aparece en el diff ni en `git status`. Intacto.
- **`chat-panel.tsx` y el fix jitless de Tanda A**: no aparecen en el diff.
  Intactos.
- **`lib/route-errors.ts` (Q-5 T4, INTERNAL ratificado sin cambio de código)**:
  no aparece en el diff. Intacto.
- **Inventario del diff vs las 7 piezas** (`git status --short`): 7 archivos
  modificados + 1 nuevo, TODOS mapeados:
  - `.github/workflows/backup.yml` → pieza 7.
  - `app/api/portales/mappings/route.ts` → pieza 6.
  - `lib/rate-limit.ts` → pieza 5.
  - `lib/security-headers.ts` → piezas 1+2+3.
  - `next.config.mjs` → pieza 4.
  - `tests/lib/rate-limit.test.ts` → tests pieza 5.
  - `tests/lib/security-headers.test.ts` → tests piezas 1+2+3.
  - `tests/api/mappings-p2025.test.ts` (nuevo) → tests pieza 6.
  - Ningún archivo/línea fuera de las 7 piezas. Cero scope-creep.

---

## Análisis del DRIFT de `crypto` (specifier bare vs `node:crypto`)

- **Hecho observado** (`lib/rate-limit.ts:29-35`): el implementer usa
  `import { createHash } from 'crypto'` (specifier BARE), no `'node:crypto'`,
  con comment que justifica: el módulo entra al bundle EDGE vía
  `auth.ts → middleware.ts`, y el webpack del layer edge de Next 14 no maneja el
  scheme `node:` (`UnhandledSchemeError` en build).
- **¿Desviación textual del brief?** SÍ. El prompt del review indica que el brief
  pedía `node:crypto`; el implementer usó `'crypto'`. Es una divergencia LITERAL
  del texto del brief, reportada explícitamente por el implementer (§5 de su
  reporte, marcada "⚠ DRIFT del brief"). No fue una improvisación silenciosa.
- **¿Altera el comportamiento de la función?** NO. `createHash` es la MISMA API de
  Node en ambos specifiers — `'crypto'` y `'node:crypto'` resuelven al mismo
  builtin; la única diferencia es el scheme del import. `normalizeKey` produce
  idéntico output (sha256 hex de la key completa). El diseño funcional de I-3
  (≤256 intacta / hash de la key completa antes del SQL) se cumple sin cambio.
- **¿Resultado sigue cumpliendo I-3?** SÍ. Cobertura de sitios SQL, frontera
  256/257, determinismo/no-colisión: todo intacto. El specifier no toca ninguna
  de esas propiedades.
- **Veredicto del carril de spec:** desviación TEXTUAL aceptable — el
  comportamiento exigido por la decisión de Michael se preserva completo. NO es
  mi carril decidir si el warning de build del edge bundle es tolerable (eso es de
  Michael); declaro que (a) hubo divergencia textual del brief, (b) fue reportada,
  y (c) el resultado funcional cumple I-3 sin merma. Queda como nota, no como
  fallo de spec.

---

## Cierre

7/7 piezas fieles al scope autorizado (decisiones §5 + diseño I-3/I-4 + flip
§1.2). Cero scope-creep, cero violación de §6 No-tocar. Única nota: el drift
textual `'crypto'` vs `node:crypto`, reportado y sin impacto funcional en I-3 —
elevado a Michael como decisión, no como bloqueo de spec.
