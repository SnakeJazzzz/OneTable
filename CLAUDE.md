# CLAUDE.md — OneTable Project Context

> Este archivo se carga automáticamente al inicio de cada sesión de Claude Code en este repo. Contiene contexto que NO debe perderse entre sesiones.

---

## Identidad del proyecto

**OneTable** — SaaS B2B para proveedores de retail en México. Consolida sell-out e inventario de 6 portales (Soriana, Chedraui, HEB, Al Super, La Comer, Amazon) en una tabla unificada + dashboard.

**Primer cliente real:** VIKS Jerky Co.
**Fase actual:** Bloque de HARDENING (pre-Fase 3). Fase 2 CERRADA por Michael el 2026-07-16 — bloques B0-B5 mergeados a main (último: PR #14, a5fc3ae), smoke de producción pasado (chatbot + onboarding completo en prod). B6 (parsers HEB / Al Super / La Comer) quedó FUERA de Fase 2, bloqueado por falta de archivos reales de esos portales; se retoma cuando existan. El scope candidato del hardening vive en `.superpowers/sdd/hardening-backlog.md`; el corte lo decide Michael. Fase 1 (demo ANTAD) cerrada y deployada en Vercel.
**Repo:** github.com/SnakeJazzzz/OneTable
**Branch de trabajo:** feature branches off `main`. **Estado actual (verificado 2026-07-15 vía `gh api .../branches/main/protection`):** branch protection ON — required status check `ci` (strict) + `enforce_admins`; force-push y delete bloqueados. Se habilitó en el pre-work B0 como estaba planeado. El hook local `block-main-writes` sigue activo como segunda capa. ADR-001 (protection OFF durante setup) queda como referencia histórica de por qué estuvo apagada.

---

## Stack inmutable

- Next.js 14 App Router + TypeScript
- Tailwind CSS + shadcn/ui
- Prisma 6.19.3 + Neon Postgres
- NextAuth v5 (5.0.0-beta.25, JWT, no DB sessions)
- Recharts, SheetJS (xlsx), Papaparse
- bcryptjs (no bcrypt — pure JS para Vercel)
- Vitest (tests integration y unit)
- Vercel deploy
- Chatbot IA (desde B5): Vercel AI SDK 6 (`ai@6.0.168`, `@ai-sdk/react@3.0.170`) + zod 4, modelo `anthropic/claude-haiku-4.5` vía AI Gateway (`lib/ai/model.ts`); requiere `AI_GATEWAY_API_KEY` en Vercel

**Monorepo simple.** Todo dentro de un solo Next.js. Carpeta `core/` con lógica pura sin imports de Next.js, diseñada para migrarse a Python/FastAPI en Fase 3.

---

## Documentos fuente de verdad (leer en este orden si arrancás fresh)

**El mapa completo de docs/ (qué manda, qué es historia, cómo transita) vive en `docs/README.md`.**

**Autoritativo para el bloque actual (hardening):**

1. `.superpowers/sdd/hardening-backlog.md` — scope candidato del bloque (working doc tracked vía `git add -f`). El corte del scope lo decide Michael.
2. `docs/specs/onetable-fase3-spec-draft.md` — diseño congelado de items diferidos a Fase 3 (AES-GCM credenciales, multi-marca eventual, build de forecasting si llega tarde).

**Histórico (referencia, no autoritativo — vive en `docs/archive/` y en `docs/handoff/`):**

3. `docs/archive/fase2/onetable-fase2-spec.md` — spec de Fase 2 (fue la fuente única de verdad durante B0-B5; archivada al cierre 2026-07-16). Se consulta para el "por qué" de schema, flujos y decisiones de Fase 2.
4. `docs/archive/fase2-bloques/` — planes y design docs de los bloques ejecutados de Fase 2.
5. `docs/archive/fase1/onetable-fase1-spec.md` + `onetable-fase1-plan.md` — spec y plan del demo ANTAD. Útiles para entender por qué algunas piezas son como son (UPSERT key, NULLS NOT DISTINCT, normalizer agnóstico).
6. `docs/handoff/` — handoffs de todas las sesiones (índice en `docs/handoff/README.md`). Registro histórico: no se editan.
7. `docs/adr/ADR-001-branch-protection-off-during-setup.md` — por qué branch protection estuvo OFF durante el setup. Cumplida: hoy está ON (ver D8).

**Para particularidades de los portales (parsers):** `docs/specs/viks-data/README.md`.

---

## ⚠ Seguridad supply chain — NO NEGOCIABLE

Hay un worm activo en npm desde mayo 11, 2026 ("Mini Shai-Hulud", CVE-2026-45321). Estas mitigaciones son inmutables en TODA instalación:

1. **SIEMPRE** `pnpm install --ignore-scripts` y `pnpm add --ignore-scripts <pkg>`. Sin excepciones.
2. **Pin exact** (sin `^` ni `~`) en todo `package.json`. Verificable con: `grep -E '"[\^~]' package.json && exit 1 || echo OK`.
3. **Ejecutar `./scripts/check-supply-chain.sh`** antes Y después de cada install.
4. **Grep del lockfile post-install** contra tokens sospechosos:
```bash
   grep -E "tanstack|squawk|uipath|mistral|cap-js|intercom-client|router_init|setup\.mjs|router_runtime" pnpm-lock.yaml | grep -v lightningcss
```
   Cero resultados esperado. Si aparece algo, PARAR y notificar usuario.
5. **NUNCA borrar `pnpm-lock.yaml`** una vez creado y commiteado. Si hay troubleshooting, borrar solo `node_modules`.
6. **Paquetes nuevos no listados:** el implementer PUEDE agregarlos auto-servicio si cumple las 5 mitigaciones técnicas anteriores + reporte explícito en el handoff con (nombre, versión exacta, razón técnica). NO requiere aprobación previa del usuario. Versión debe ser razonablemente pre-incidente (publicada antes del 29-abril-2026); si dudoso, flag en el reporte.
7. **`shadcn add <component>`** sigue las mismas reglas que #6.
8. **Verificación automática post-task** mandatoria al final de CADA implementer task:
```bash
   ./scripts/check-supply-chain.sh
   grep -E '"[\^~]' package.json && exit 1 || echo "✅ pins exact"
   grep -E "tanstack|squawk|uipath|mistral|cap-js|intercom-client|router_init|setup\.mjs|router_runtime" pnpm-lock.yaml | grep -v lightningcss && exit 1 || echo "✅ lockfile clean"
```

**El prompt template de cada implementer subagent DEBE incluir literal esta sección como prefijo.** No depender de que el subagente las descubra leyendo el plan.

---

## Decisiones arquitectónicas cerradas (D1-D8, no re-cuestionar)

- **D1:** 3 portales habilitados en Fase 1 (Soriana, Chedraui, Amazon). HEB/AL SUPER/LA COMER aparecen en UI como "próximamente". Arquitectura drop-in para agregar los 3 restantes post-demo.
- **D2:** Polish visual concentrado en Dashboard + Landing. Resto "functional, clean, minimal".
- **D3 (revisado para Fase 2; drift corregido 2026-07-17 con OK de Michael):** Multi-tenancy = 1 Client por cuenta, forzado en capa de app, no en schema. Mecanismo real (verificado): el `clientId` viaja en el JWT de sesión y `requireAuth()` en `lib/auth-helpers.ts` lo extrae; ningún endpoint acepta clientId del request body/query. El helper `getCurrentClient(userId)`/`lib/tenant.ts` que la spec proponía NUNCA existió (evidencia en brief T1 B5 §1.5). Fase 1 modeló User como agency con múltiples Clients; Fase 2 cerró el modelo a 1-a-1 sin migración de datos. Ver `onetable-fase2-spec.md §1`. Multi-marca futura = poner la selección de Client en la sesión en vez del 1-a-1 fijado al login.
- **D4:** KPIs se calculan al query, NUNCA al insert. Incluye `daysOfInventory` (AJUSTE 1 al spec).
- **D5:** Export Excel/CSV client-side con SheetJS. No server-side.
- **D6:** Selector manual de portal en upload (no auto-detect).
- **D7:** Productos sin mapear → `SelloutData.productId = NULL` + insert en `UnmappedProduct`. Banner en dashboard con CTA a Catálogo. No rechazar el upload.
- **D8 (cumplida en B0):** Branch protection en GitHub está ON (verificado 2026-07-15): required status check `ci` que corre la suite completa en cada PR + `enforce_admins`. Estuvo OFF durante el setup por decisión consciente (ADR-001, referencia histórica). El hook local `block-main-writes` se conserva como segunda capa.

---

## Decisiones técnicas cerradas durante brainstorming

> Las referencias `onetable-fase2-spec.md §…` de esta sección y de D1-D8 apuntan a `docs/archive/fase2/onetable-fase2-spec.md` (spec archivada al cierre de Fase 2).

- **Upload UX (Fase 1 → revisado en Fase 2):** en Fase 1 vivió en Análisis con auto-detect del chain por filename. En Fase 2 se mueve a la card de cada portal en la página Portales, con chain implícito por la card (`onetable-fase2-spec.md §3.2.4`). Amazon usa dos inputs por separado (Ventas / Inventario).
- **UPSERT key:** `(clientId, chain, storeId, portalRawProduct, periodYear, periodMonth)` con `NULLS NOT DISTINCT` (Postgres 15+) + `COALESCE` per campo. SQL usa `ON CONFLICT (cols)` NO `ON CONFLICT ON CONSTRAINT` (AJUSTE 5). Conservado en Fase 2.
- **Catálogo onboarding (Fase 1 → reformulado en Fase 2):** en Fase 2 se separa en dos páginas. Parámetros maneja el catálogo canónico (SKUs + precios + thresholds) con importer nuevo `core/parameters/import.ts`. Portales maneja los mappings + unmapped + conflict resolution. Detalle en `onetable-fase2-spec.md §3.1` y `§3.2`.
- **PortalCredential:** username almacenado, password descartado silenciosamente. Microcopy actual: "se solicitará al activar la automatización (Fase 3)". El cifrado AES-256-GCM se difiere a Fase 3 (ver `onetable-fase2-spec.md §6` y `onetable-fase3-spec-draft.md §1`).
- **Alert thresholds:** defaults SIN_STOCK / CRITICO<7 / RIESGO<14 / ATENCION<21 / OK 21-60 / EXCESO>60 / SIN_DATOS. Configurables en Fase 2 vía tabla `ThresholdConfig` (ver `onetable-fase2-spec.md §4.5`); refactor de `classifyAlert` con templatización SQL en `onetable-fase2-spec.md §4.8`.
- **Seed:** estático puro (user + client + catálogo + portal credentials). NO popula SelloutData. El demo ES el upload en vivo. Conservado en Fase 2.
- **Pre-flight recomendado** antes de demos a VIKS (era obligatorio para ANTAD). Script en `scripts/preflight.ts`.
- **Theme:** dark mode primero, accent emerald `#10B981` (HSL `160 84% 39%` — corregir de `158 64% 40%` en G2 Step 0).

---

## Modo de trabajo

**Subagent-driven, protocolo vigente (desde Fase 2 bloque B; sigue aplicando en el bloque de hardening).**

Por task:
1. Brief/plan del task filtrado por el sparring partner de Michael ANTES de
   dispatchar (él lo manda ya filtrado o confirma el go).
2. Implementer subagent FRESCO por task, prompt con el prefijo literal de la
   sección supply-chain de este archivo. El implementer PARA en GREEN con
   árbol sucio: NO git add, NO commit, NO push. Reporte en
   .superpowers/sdd/<task>-report.md.
3. Doble review CIEGA en carriles separados (spec compliance + code quality),
   agentes distintos, ninguno ve el output del otro. Nunca se fusionan.
4. Fix pass: hallazgos van a un fixer; re-review SOLO del carril que encontró
   el hallazgo (la ceguera es entre carriles, no entre pases).
5. Diff crudo completo + ambos outputs de review van a Michael (que los pasa
   por su filtro externo). Resúmenes no reemplazan al diff.
6. Michael autoriza con "commiteá". Recién ahí el controller commitea.
7. Minors de review que no bloquean → al ledger tracked
   (.superpowers/sdd/b4-followups.md, git add -f SIEMPRE — está gitignored
   aunque tracked; no confiar en check-ignore para este path) en el mismo
   commit, nunca al diff.

Gates: ESTRICTO (diff a Michael ANTES de commit — data layer, queries de
KPIs, alto blast-radius) vs UI GATE (cierre = smoke visual de Michael, no CI).

Reglas operativas permanentes:
- Merges: SOLO Michael (gh pr merge N --squash --delete-branch).
- Operaciones destructivas de git: SOLO Michael en su terminal;
  git branch --show-current antes de todo reset/force/delete.
- Cero procesos huérfanos antes de dispatchar (ps aux | grep -E
  "vitest|pnpm test"); jamás dos procesos de test contra la Neon dev DB
  compartida; avisar a Michael antes de correr la suite (puede tener
  pnpm dev activo).
- Prompts a subagents: autocontenidos o apuntando a archivos del repo. Las
  sesiones se /clear-ean; nada vive en memoria entre bloques.
- Mensajes de commit sin referencias falsas de spec; tasks post-plan citan
  el ledger.
- Los paths de un commit salen de git status al momento de commitear,
  nunca de una lista pre-compuesta en el brief o el plan (un fix pass
  puede haber agregado archivos).

### Operaciones destructivas de DB

Operaciones destructivas de DB (`migrate reset`, `drop`) NO requieren consentimiento explícito mientras no exista data real de cliente — el sistema está en construcción. A PARTIR de que VIKS (o cualquier cliente) cargue data real en la beta de Fase 2, todo reset destructivo requiere OK explícito del usuario EN EL MOMENTO, no derivado de la aprobación de un plan. El disparador es el evento (data real cargada), no una fecha.

**Estado 2026-07-17: el trigger es INMINENTE** — VIKS está por cargar data real y la Neon dev/prod es COMPARTIDA (un `pnpm test` local puede truncar data que el cliente ve en prod). Por eso "DB de prod separada + backups" es el primer ítem de implementación del bloque de hardening, ya decidido por Michael. Hasta que esa separación exista, tratar TODA operación destructiva contra la DB como si el trigger ya hubiera disparado.

---

## Hooks de seguridad activos (`.claude/hooks/`)

- `block-main-writes` — Bloquea commits directos a main.
- `block-env-writes` — Bloquea ediciones a `.env*` files. Si necesitás editar `.env.example`, el usuario debe hacerlo manualmente vía `vi` desde terminal.
- `block-force-push` — Bloquea force-push destructivos.
- `block-rm-rf-absolute` — Bloquea `rm -rf /path/absoluto`.

Los 4 están testeados y activos.

---

## Comandos de verificación frecuentes

```bash
# Antes de empezar cualquier task
git status
git log --oneline main..HEAD | head -10

# Antes y después de install
./scripts/check-supply-chain.sh

# Tests
pnpm test

# Build
pnpm build
pnpm typecheck

# Verificar pins
grep -E '"[\^~]' package.json && echo "❌ FOUND" || echo "✅ pins exact"

# Verificar lockfile
grep -E "tanstack|squawk|uipath|mistral|cap-js|intercom-client|router_init|setup\.mjs|router_runtime" pnpm-lock.yaml | grep -v lightningcss
```

---

## Comportamiento esperado del Claude

- **Comunicación directa, sin filler.** Opciones con trade-offs cuando aplica.
- **Verdad sobre velocidad.** Si una decisión es mala, decirlo. Si una estimación es optimista, decirlo.
- **No emojis** (salvo los necesarios en outputs de scripts como ✅/❌).
- **Español neutro.** Comentarios en código preferentemente en inglés (estándar técnico).
- **Si Claude Code encuentra una decisión que no está en el plan ni en el spec, PARAR y consultar usuario.**
- **NO inventar versiones de paquetes.** Si una versión pineada no existe o tiene peer-dep que no resuelve, parar y consultar.
- **NO usar `create-next-app` ni scaffolders auto-installer** (violan mitigación supply chain #1).

---

## Pendientes conocidos del usuario (recordar cuando aplique)

> Auditados uno por uno contra el repo el 2026-07-15 (B-4). Re-verificados 2026-07-17 al cierre de Fase 2: #1 (PREFLIGHT sigue faltando en `.env.example`), #3 (key `prisma` sigue en `package.json:17`) y el pendiente de #4 (`check-supply-chain.sh` sigue sin `set -euo pipefail`) continúan vigentes. Los tachados quedan como registro.

1. **`PREFLIGHT_DATABASE_URL` no agregado a `.env.example`** — hook `block-env-writes` bloqueó la edición. **Re-verificado 2026-07-15: sigue faltando** (`grep PREFLIGHT .env.example` → vacío). Si Fase 2 reusa el preflight script, agregar manualmente.
2. **Segunda Neon branch para preflight DB** — confirmado por Michael 2026-07-15: NO existe. Va en el bloque de hardening de infraestructura pre-lanzamiento (ver hardening-backlog.md). Necesaria solo si se reusa el preflight script.
3. **Prisma deprecation warning** sobre `package.json#prisma` — **re-verificado 2026-07-15: la key sigue en `package.json:17`**, Prisma sigue en 6.19.3 (deprecated en Prisma 7, migra a `prisma.config.ts`). Diferido — decidir en el bloque de hardening o al subir de major.
4. **G2 Step 0 follow-ups** (typecheck script HECHO en `package.json:15`) — re-verificados 2026-07-15:
   - ~~Tokens shadcn faltantes~~ **HECHO**: `--card`, `--popover`, `--accent`, `--destructive`, `--secondary`, `--input`, `--ring`, `--radius` existen todos en `app/globals.css:9-26`.
   - ~~Emerald HSL~~ **CERRADO (decisión de Michael, 2026-07-15)**: el valor deployado `--primary: 142 71% 45%` queda como el color del producto. El target `160 84% 39%` se descarta (corrección de brainstorm nunca aplicada, superada por dos deploys de uso real). Si hay pasada de identidad visual pre-lanzamiento comercial, ahí se re-decide el theme completo (incluido el bloque `.dark` inexistente) — registrado en hardening-backlog.md sección "Pre-lanzamiento".
   - **Pendiente**: reforzar `scripts/check-supply-chain.sh` con `set -euo pipefail` + quote vars (re-verificado: el script no lo tiene).
5. ~~**`upsertUnmapped()` race condition latente**~~ **RESUELTO en B4** (re-verificado 2026-07-15): el normalizer usa `batchUpsertUnmapped` con raw `INSERT ... ON CONFLICT ... DO UPDATE` (`core/normalizer/upsert.ts:171-178`); no queda ningún findUnique+create/update.
6. ~~**Scaffolds pre-existentes commiteados**~~ **VENCIDO**: los gates de Fase 2 poblaron esas carpetas con rutas y lógica reales (`app/(auth)/login|register|signup`, `app/(dashboard)/analisis|dashboard|parametros|portales|promotoria`, etc.). Ya no son scaffolds.

---

## Cómo arranca cada sesión nueva

1. Leer este `CLAUDE.md` (auto).
2. `git log --oneline main..HEAD | head -15` para ver estado de commits desde main.
3. Leer el handoff más reciente en `docs/handoff/` (índice en su README).
4. **Identificar el próximo task contra `.superpowers/sdd/hardening-backlog.md`** (el corte del scope del bloque lo decide Michael; DB de prod separada + backups es el primer ítem de implementación, ya decidido).
5. Confirmar con el usuario antes de dispatchear el primer implementer.

---

## Cómo cierra cada sesión

Antes de `/clear`, generar un `docs/handoff/session-N-end-of-day-X.md` con:
- Commits agregados en orden cronológico
- Tasks completas con número de tests passing
- Estado del working tree
- TODOs / blockers para próxima sesión
- Próximo task recomendado

Si el cierre es de BLOQUE o FASE, además:
- Mover specs/planes ejecutados a `docs/archive/` (git mv + grep de
  punteros), actualizar `docs/README.md`. El detalle del procedimiento
  vive en `docs/README.md`.

---

## Contacto

Usuario: SnakeJazzzz. Mac M3 Max, VS Code. CS grad Tec de Monterrey, freelance dev/consultor en México. Stack cómodo: Python/FastAPI, JS/Node, React, PostgreSQL, Vercel, AWS. Trabaja en español, prefiere comunicación directa.