markdown# CLAUDE.md — OneTable Project Context

> Este archivo se carga automáticamente al inicio de cada sesión de Claude Code en este repo. Contiene contexto que NO debe perderse entre sesiones.

---

## Identidad del proyecto

**OneTable** — SaaS B2B para proveedores de retail en México. Consolida sell-out e inventario de 6 portales (Soriana, Chedraui, HEB, Al Super, La Comer, Amazon) en una tabla unificada + dashboard.

**Primer cliente real:** VIKS Jerky Co.
**Fase actual:** Fase 2 (beta con VIKS). Fase 1 (demo ANTAD) cerrada y deployada en Vercel.
**Repo:** github.com/SnakeJazzzz/OneTable
**Branch de trabajo:** feature branches off `main`. **Estado actual:** branch protection en GitHub sigue OFF (ADR-001); la única protección contra commits directos a `main` es el hook local `block-main-writes`. **Plan Fase 2:** branch protection ON en pre-work B0 (ver `onetable-fase2-spec.md §11.1`).

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

**Monorepo simple.** Todo dentro de un solo Next.js. Carpeta `core/` con lógica pura sin imports de Next.js, diseñada para migrarse a Python/FastAPI en Fase 3.

---

## Documentos fuente de verdad (leer en este orden si arrancás fresh)

**Autoritativo para Fase 2 (lo que se está construyendo ahora):**

1. `docs/specs/onetable-fase2-spec.md` — **fuente única de verdad** de decisiones, schema, flujos y orden de ejecución de Fase 2. Cualquier divergencia entre otros docs y esta spec: la spec gana.
2. `docs/specs/onetable-fase3-spec-draft.md` — diseño congelado de items diferidos a Fase 3 (AES-GCM credenciales, multi-marca eventual, build de forecasting si llega tarde).

**Histórico de Fase 1 (referencia, no autoritativo para Fase 2):**

3. `docs/specs/onetable-fase1-spec.md` — spec del demo ANTAD. Útil para entender por qué algunas piezas son como son (UPSERT key, NULLS NOT DISTINCT, normalizer agnóstico). Las referencias prescriptivas a Fase 2 en este doc ya fueron corregidas con punteros a fase2-spec.
4. `docs/plans/onetable-fase1-plan.md` — plan ejecutable Fase 1. Mismo tratamiento de punteros.
5. `docs/handoff/session-*.md` + `docs/handoff/g9-vercel-deploy.md` — handoffs del demo Fase 1.
6. `docs/adr/ADR-001-branch-protection-off-during-setup.md` — decisión consciente sobre branch protection OFF durante setup. Trigger ya disparado; se re-habilita en Fase 2 B0.

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
- **D3 (revisado para Fase 2):** Multi-tenancy = 1 Client por cuenta, forzado en capa de app (helper `getCurrentClient(userId)` en `lib/tenant.ts`), no en schema. Fase 1 modeló User como agency con múltiples Clients; Fase 2 cierra el modelo a 1-a-1 sin migración de datos. Ver `onetable-fase2-spec.md §1`. Multi-marca futura = remover el check del helper.
- **D4:** KPIs se calculan al query, NUNCA al insert. Incluye `daysOfInventory` (AJUSTE 1 al spec).
- **D5:** Export Excel/CSV client-side con SheetJS. No server-side.
- **D6:** Selector manual de portal en upload (no auto-detect).
- **D7:** Productos sin mapear → `SelloutData.productId = NULL` + insert en `UnmappedProduct`. Banner en dashboard con CTA a Catálogo. No rechazar el upload.
- **D8 (estado presente vs plan Fase 2):** Branch protection en GitHub está OFF desde setup (ADR-001). Hoy la única protección contra commits directos a `main` es el hook local `block-main-writes`. **Plan Fase 2:** se re-habilita ON en pre-work B0 (`onetable-fase2-spec.md §11.1`) junto con CI de los 89 tests como required status check.

---

## Decisiones técnicas cerradas durante brainstorming

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

**Subagent-driven, protocolo vigente (Fase 2, bloque B en adelante).**

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

### Operaciones destructivas de DB

Operaciones destructivas de DB (`migrate reset`, `drop`) NO requieren consentimiento explícito mientras no exista data real de cliente — el sistema está en construcción. A PARTIR de que VIKS (o cualquier cliente) cargue data real en la beta de Fase 2, todo reset destructivo requiere OK explícito del usuario EN EL MOMENTO, no derivado de la aprobación de un plan. El disparador es el evento (data real cargada), no una fecha.

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

1. **`PREFLIGHT_DATABASE_URL` no agregado a `.env.example`** — hook `block-env-writes` bloqueó la edición. Verificado pendiente. Si Fase 2 reusa el preflight script, agregar manualmente.
2. **Segunda Neon branch para preflight DB** — pendiente. Necesario si se reusa preflight.
3. **Prisma 6.19.3 deprecation warning** sobre `package.json#prisma` (deprecated en Prisma 7, migra a `prisma.config.ts`). Diferido — decidir en Fase 2 si se migra o se sigue posponiendo.
4. **G2 Step 0 follow-ups remanentes** (typecheck script ya HECHO en `package.json:15`):
   - Emerald HSL: cambiar `158 64% 40%` → `160 84% 39%` en `app/globals.css` (`:root` y `.dark`). Verificar en pasada visual — el demo se deployó así que probablemente quedó OK.
   - Tokens shadcn faltantes (`--card`, `--popover`, `--accent`, `--destructive`, `--secondary`, `--input`, `--ring`, `--radius`). Verificar.
   - Reforzar `scripts/check-supply-chain.sh` con `set -euo pipefail` + quote vars. Verificar.
5. **`upsertUnmapped()` race condition latente** en `core/normalizer/upsert.ts` — usa findUnique + create/update en vez de raw INSERT...ON CONFLICT. Se aborda en Fase 2 B4 (Portales) al refactorear normalizer para conflict resolution (`onetable-fase2-spec.md §8.3`).
6. **Scaffolds pre-existentes commiteados** en `app/(auth)/`, `app/(dashboard)/`, `app/(marketing)/`, `app/api/`, `core/analytics/`, `core/types/`, `lib/`, `prisma/`. NO requieren limpieza — son estructura preparada para gates futuras.

---

## Cómo arranca cada sesión nueva

1. Leer este `CLAUDE.md` (auto).
2. `git log --oneline main..HEAD | head -15` para ver estado de commits desde main.
3. Leer `docs/handoff/session-N-end-of-day-X.md` más reciente si existe handoff Fase 2.
4. **Identificar el próximo bloque/task contra `docs/specs/onetable-fase2-spec.md §12`** (orden B0→B6).
5. Confirmar con el usuario antes de dispatchear el primer implementer.

---

## Cómo cierra cada sesión

Antes de `/clear`, generar un `docs/handoff/session-N-end-of-day-X.md` con:
- Commits agregados en orden cronológico
- Tasks completas con número de tests passing
- Estado del working tree
- TODOs / blockers para próxima sesión
- Próximo task recomendado

---

## Contacto

Usuario: SnakeJazzzz. Mac M3 Max, VS Code. CS grad Tec de Monterrey, freelance dev/consultor en México. Stack cómodo: Python/FastAPI, JS/Node, React, PostgreSQL, Vercel, AWS. Trabaja en español, prefiere comunicación directa.