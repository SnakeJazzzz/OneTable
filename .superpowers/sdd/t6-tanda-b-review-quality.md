# T6 Tanda B — Code-Quality Review (quality lane)

**Scope:** working-tree diff vs HEAD (5383549) on `feat/hardening-t6`.
**Lane:** correctness / robustness / edge cases / consistency. NOT spec/scope compliance.
**Files:** `lib/rate-limit.ts`, `lib/security-headers.ts`, `next.config.mjs`,
`app/api/portales/mappings/route.ts`, `.github/workflows/backup.yml`,
`tests/lib/rate-limit.test.ts`, `tests/lib/security-headers.test.ts`,
`tests/api/mappings-p2025.test.ts` (new).

---

## Veredicto global: APPROVE WITH MINORS

El conjunto está bien hecho y es correcto. Verifiqué empíricamente los puntos
de mayor riesgo (umbral de key vs límite del índice btree de Postgres, ausencia
de un 4º sitio SQL que evada `normalizeKey`, cadena edge del import `crypto`,
forms externos que rompería `form-action`, seguridad/idempotencia del sweep).
**No hay MAJORs.** Lo que sigue son MINORs y NITs, ninguno bloqueante.

---

## MAJOR

Ninguno. Explícito: no encontré defectos de correctness que bloqueen el commit.

---

## MINOR

### M-1 — `normalizeKey`: umbral en CHARS es correcto para el objetivo real (verificado). Sin acción.
`lib/rate-limit.ts:84-87`. Confirmo que CHARS (no bytes) es el umbral correcto
para el objetivo. El mecanismo de falla que I-3 mitiga es el **índice btree del
PK compuesto** `@@id([scope, key, windowStart])` (`prisma/schema.prisma:251`):
Postgres rechaza tuplas de índice > ~2704 bytes ("index row size exceeds btree
maximum"), el INSERT tira, y el `try/catch` fail-open desactiva silenciosamente
ese scope. Peor caso de 256 chars en UTF-8 4-byte = ~1024 bytes + scope corto +
`windowStart` (8 B) + overhead → holgadamente < 2704. Un email multibyte de
≤256 chars **no** puede reventar el índice. El umbral en chars cumple el
objetivo sin necesidad de contar bytes. **Sin cambio requerido** — lo dejo
documentado porque el prompt lo pidió verificar y el resultado es "está bien".

### M-2 — P2025 → 404: la copy puede desalinearse en un race raro de PATCH (producto borrado mid-transacción).
`app/api/portales/mappings/route.ts:159-161`. El patrón
`instanceof Prisma.PrismaClientKnownRequestError && code === 'P2025'` es el
correcto y la rama es angosta (el test de narrowness lo prueba: P2002 → 500).
El caso dominante —el row del mapping desapareció por el doble-request— produce
copy 100% correcta ("No existe ese mapeo").

El borde: `retargetMapping` corre varias ops en una transacción; si el **producto
nuevo** se borra en la ventana TOCTOU entre el guard `PRODUCT_NOT_FOUND` del
servicio y el update de backfill, el P2025 escaparía y devolvería
`MAPPING_NOT_FOUND` (copy engañosa) en vez de `PRODUCT_NOT_FOUND`. El **status
sigue siendo un 4xx correcto** (algo referenciado ya no existe) y el escenario
es extremadamente improbable (requiere delete concurrente del producto justo
en esa ventana). No bloquea. Si se quiere pulir: nada — el costo de discriminar
qué row disparó el P2025 (parsear `e.meta`) no vale la pena para un race de
probabilidad marginal. Lo registro como conocido, no como fix.

### M-3 — backup.yml: el sweep sin `continue-on-error` marca ROJO todo el workflow de backup si falla el DELETE.
`.github/workflows/backup.yml:108-126`. La **posición** es correcta y el
objetivo declarado se cumple: el sweep va DESPUÉS del `upload-artifact`, así que
un fallo del sweep **no impide** que el respaldo primario ya haya subido (el
artifact existe). Correcto.

Pero sin `continue-on-error: true`, un fallo del `psql` (p.ej. Neon con hiccup
transitorio en ese instante) hace fallar el **job entero** → el run diario sale
rojo aunque el backup se completó. Esto puede generar ruido de alerta ("el
backup falló") cuando en realidad el backup está bien y solo falló la limpieza
oportunista. Tradeoff:
- **Dejar como está:** un fallo de sweep es visible (bueno), a costa de que
  "backup rojo" ya no signifique inequívocamente "backup falló".
- **`continue-on-error: true` en el step del sweep:** el run queda verde si solo
  falla el sweep; el fallo del sweep se ve como anotación pero no como job rojo.
  Riesgo: fallos recurrentes de sweep pasan más desapercibidos (pero el sweep es
  higiene de storage, no el respaldo — la criticidad es baja, y de todas formas
  se re-ejecuta al día siguiente idempotentemente).

Recomendación (opcional, no bloqueante): `continue-on-error: true` en el step
del sweep, para preservar la semántica "workflow rojo = respaldo comprometido".
Decisión de Michael; ambas son defendibles.

---

## NIT

### N-1 — `import { createHash } from 'crypto'` (bare) diverge del resto del repo, que usa `'node:crypto'`.
`lib/rate-limit.ts:35`. Los otros 6 sitios (`core/ids.ts`,
`core/parsers/*.ts`, `app/api/data/upload/route.ts`) usan `node:crypto`. Este es
el único bare `'crypto'`. **La divergencia está justificada y bien documentada**
en el comentario (líneas 29-34): `rate-limit.ts` entra al bundle edge vía
`middleware.ts → auth.ts → lib/rate-limit`, y el layer webpack edge de Next 14
no parsea el esquema `node:` (UnhandledSchemeError en build). Verifiqué la
cadena de imports: es real. La API `createHash` es idéntica entre ambos
specifiers. Y `normalizeKey` **solo ejecuta en runtime Node** (dentro de
`incrementWindow`/`peekRateLimit`, llamados por route handlers y el callback
`authorize`); el middleware solo decodifica el JWT y nunca invoca el limiter, así
que `createHash` jamás corre en edge aunque quede bundleado. La justificación es
técnicamente sólida. Sin acción — solo dejo constancia de que la inconsistencia
es intencional, no un descuido.

### N-2 — `psql -c` sin `-v ON_ERROR_STOP=1`.
`.github/workflows/backup.yml:125`. Para un único `-c`, un error SQL ya produce
exit code no-cero, así que `set -euo pipefail` lo captura correctamente —
`ON_ERROR_STOP` es redundante aquí. Lo menciono solo por consistencia defensiva;
no hace falta cambiarlo.

### N-3 — Sin cuarto sitio SQL que evada la normalización (verificado, todo OK).
Confirmé los 3 entry points de key hacia SQL: `incrementWindow` (usado por
`consumeRateLimit` y `recordFailure`) y `peekRateLimit` normalizan ambos. No
existe un 4º camino: los 4 callers externos (`auth.ts`, `signup/route.ts`,
`ai/chat/route.ts`, `csp-report/route.ts`) pasan siempre por esas funciones
públicas. Cobertura completa. Sin acción.

---

## Notas de correctness verificadas (sin hallazgo — todo correcto)

- **Determinismo / misma fila:** `peek`/`consume`/`recordFailure` normalizan
  idénticamente antes del SQL → misma key derivada → misma fila del PK. El test
  de integración `rate-limit.test.ts` ("consume and peek agree...") lo prueba
  contra la DB real. OK.
- **Colisión hash 64-hex vs key legítima:** solo se hashea para keys > 256
  chars; una key legítima de 64-hex (≤256) pasa intacta. Para que colisionara,
  un atacante necesitaría un preimage de sha256 igual a una key legítima
  específica — inviable. Además emails/IPs nunca lucen como 64-hex minúsculas, y
  las keys van namespaced por `scope`. No es un riesgo real.
- **`form-action 'self'`:** grep de `app/` y `components/` → CERO `<form
  action="http...">`. Todos los forms envían vía `onSubmit` → `fetch` a `/api/*`
  (same-origin), y `fetch` cae bajo `connect-src`, no `form-action`. NextAuth v5
  postea a `/api/auth/*` same-origin. No rompe ningún submit legítimo. Posición
  en el array (antes de `report-uri`) es irrelevante para el parsing de CSP. OK.
- **COOP `same-origin`:** no hay flujos OAuth-popup ni `window.open` (NextAuth
  credentials-only + JWT; el chat llama al gateway server-side). No rompe nada. OK.
- **`buildCspHeader` simplificado:** el `env` sigue usándose vía
  `buildCspDirectives(env)` (relajaciones dev intactas); el único cambio de
  comportamiento es el KEY de producción (Report-Only → enforced). Sin dead code,
  sin regresión en dev/preview. OK.
- **Sweep idempotente y seguro:** `DELETE ... WHERE windowStart < now() -
  interval '7 days'` re-ejecutado no borra nada la 2ª vez; la ventana legítima
  más larga es la cuota diaria de chat (24 h) ≪ 7 días, así que nunca borra una
  ventana activa. Toca solo la tabla efímera `RateLimit`. `set -euo pipefail`
  presente. `psql` por path absoluto = mismo `postgresql-client-17` que
  `pg_dump`. OK.
- **P2025 catch bien ubicado:** en `handleDelete` el `db.upload.findFirst`
  route-level (que devuelve `null`, nunca P2025) queda FUERA del `try` del
  servicio; el catch de P2025 solo envuelve `deleteMapping`. OK.
- **Tests nuevos ejercitan lo que dicen:**
  - `rate-limit.test.ts`: boundary 256/257, determinismo, no-colisión, y un test
    de integración real que verifica que la fila almacenada guarda el hash de 64
    chars (nunca el string de 5KB). Cubre exactamente-256 y 256+1. Helpers
    (`scope`, `WINDOW_MS`) existen; el cleanup `afterAll` (startsWith `t2-rl-`)
    cubre las keys nuevas. No falta la key vacía como caso, pero es trivialmente
    ≤256 → pasa intacta; su ausencia no es un gap real.
  - `security-headers.test.ts`: asserts positivos (COOP presente, form-action
    presente en strict y dev) y negativo (COEP `toBeUndefined`), conteos
    actualizados 4→5 y 5→6. No tautológicos.
  - `mappings-p2025.test.ts`: mocks correctos (mismo patrón que
    `mappings-e1-rethrow.test.ts`: servicio y `@/lib/db` mockeados, Prisma real
    para que `instanceof` matchee). Tres casos: DELETE P2025→404 sin log, PATCH
    P2025→404 sin log, y **narrowness** (P2002 → 500 + log una vez). Los asserts
    de "sin log" atan el 404 al camino que NO pasa por `withRouteErrors`. Sólido.
    Vive en `tests/api/`, cubierto por `include: ['tests/**/*.test.ts']`.

---

## Cierre

Trabajo correcto y consistente con los patrones del repo (errorResponse, estilo
de comentarios "por qué", branches tipados antes del rethrow, tests de
integración para el limiter + tests mockeados para las rutas). Los MINORs son
todos opcionales; el único con una decisión de producto detrás es **M-3**
(`continue-on-error` en el sweep) — vale la pena que Michael lo decida. Nada
bloquea el commit desde el carril de calidad.

## Fix pass M-3 (re-review del carril quality, agente fresco)

**Veredicto: PASS.** El fix hace exactamente lo que M-3 pedía y no rompe nada
estructural. Hallazgos abajo (ninguno bloquea).

### Verificación estructural

- `continue-on-error: true` está al nivel correcto: propiedad del step, 8
  espacios de indentación, consistente con `env:` y `run:` del mismo step
  (`backup.yml:126-129`). El orden de keys dentro del mapping del step es
  irrelevante para YAML; la posición elegida (después del comment block, antes
  de `env:`) es legible. YAML estructuralmente válido.
- Interacción con el `set -euo pipefail` interno del `run:`: coherente — el
  script falla rápido dentro del step y `continue-on-error` absorbe a nivel
  job. Es el patrón correcto (no se relajó el shell para "no fallar", que
  habría sido la solución mala).

### ¿Resuelve M-3?

Sí, exactamente. Semántica de GitHub Actions verificada contra lo que el
comment afirma: con `continue-on-error` a nivel step, un fallo deja
`steps.<id>.outcome = failure` pero `conclusion = success`; el job y el
workflow quedan VERDES y el runner emite la anotación de fallo en el summary
del run. Como el sweep es el ÚLTIMO step, no hay steps posteriores cuyo
comportamiento cambie — el único efecto observable es el que M-3 buscaba:
"workflow rojo = respaldo comprometido" vuelve a ser verdad (dump, cifrado y
upload son los únicos steps capaces de poner el run en rojo, junto con el
install y el check de secrets, que son precondiciones reales del respaldo).

### Hallazgos

- **MINOR — el argumento "no oculta roturas reales" es overbroad; existe un
  residual silencioso sweep-only.** El razonamiento del comment ("dump y sweep
  comparten secret y host: si algo está roto de verdad, el dump falla
  primero") es sólido para los modos de falla COMPARTIDOS: secret rotado o
  vaciado, host caído, auth revocada a nivel rol de conexión, endpoint de Neon
  migrado. Pero NO cubre modos de falla que solo afectan al sweep: tabla
  `RateLimit` renombrada/borrada por una migración futura (el SQL es raw, no
  pasa por Prisma), privilegio DELETE revocado selectivamente, o statement
  timeout si la tabla creció patológicamente. En esos casos el dump sigue
  verde y el sweep falla PARA SIEMPRE sin que nadie se entere: run verde, cero
  email de failure (GitHub solo notifica workflows rojos), y la anotación del
  step solo la ve quien abra el run a mano — cosa que nadie hace con un cron
  diario verde. Clasificación honesta: MINOR, no MAJOR, porque (a) la
  consecuencia del fallo prolongado es acotada — vuelve el crecimiento de
  filas stale, es decir el problema original de I-4, que es lento y solo
  materializa bajo flood de keys one-shot; (b) el DELETE es idempotente: el
  primer run sano después de arreglar la rotura recupera todo el atraso de un
  golpe; (c) el ítem I-5(a)/I-4 del backlog ya tiene triggers de revisión que
  actúan como red de detección eventual. El tradeoff (sweep silenciable vs
  backup con falsos rojos) es el correcto — M-3 existía precisamente porque el
  falso rojo del respaldo primario es el riesgo peor. Si se quiere cerrar el
  residual algún día, la forma barata es que el step de sweep emita
  `::warning::` explícito en fallo o que una migración futura que toque
  `RateLimit` grepee este workflow — candidato a una línea en el ledger, no a
  cambiar el diff.
- **NIT — una frase del comment es más fuerte que la realidad.** "No oculta
  roturas reales" debería decir "no oculta roturas compartidas con el dump" o
  similar; las roturas sweep-only descritas arriba SÍ quedan ocultas. El resto
  del comment es claro y veraz: la explicación del porqué (M-3, semántica
  rojo = respaldo comprometido), la afirmación sobre la anotación del step, la
  posición post-dump/post-upload, y el origen de psql (postgresql-client-17
  instalado en el primer step, mismo path absoluto) son todos correctos y
  verificables contra el archivo.

### Cierre del fix pass

El fix es mínimo, está en el lugar correcto, resuelve M-3 con la semántica
exacta buscada y documenta la decisión donde el próximo lector la va a
necesitar. El residual silencioso es real pero menor, acotado y con
recuperación automática — registrarlo en el ledger es suficiente; no amerita
re-abrir el diff.
