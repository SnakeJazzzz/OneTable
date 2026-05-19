markdown# CLAUDE.md — OneTable Project Context

> Este archivo se carga automáticamente al inicio de cada sesión de Claude Code en este repo. Contiene contexto que NO debe perderse entre sesiones.

---

## Identidad del proyecto

**OneTable** — SaaS B2B para proveedores de retail en México. Consolida sell-out e inventario de 6 portales (Soriana, Chedraui, HEB, Al Super, La Comer, Amazon) en una tabla unificada + dashboard.

**Primer cliente real:** VIKS Jerky Co.
**Deadline crítico:** Demo ANTAD martes (~2-3 días). Estamos en Fase 1.
**Repo:** github.com/SnakeJazzzz/OneTable
**Branch activa:** `plan/onetable-fase1`

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

1. `docs/specs/onetable-fase1-spec.md` — spec frozen con 5 ajustes aplicados. Q1-Q7 resueltos. Triage Sprint/Gate en §7.
2. `docs/plans/onetable-fase1-plan.md` — plan ejecutable con 25 tasks. Mitigaciones supply chain en sección dedicada.
3. `docs/handoff/session-1-end-of-day-1.md` — reporte del cierre de la sesión anterior (estado, commits, blockers).
4. `docs/adr/ADR-001-branch-protection-off-during-setup.md` — decisión consciente sobre branch protection OFF.

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
- **D3:** Multi-tenancy de un solo nivel. User es Agency. Client tiene FK a User. Sin tabla Agency en Fase 1.
- **D4:** KPIs se calculan al query, NUNCA al insert. Incluye `daysOfInventory` (AJUSTE 1 al spec).
- **D5:** Export Excel/CSV client-side con SheetJS. No server-side.
- **D6:** Selector manual de portal en upload (no auto-detect).
- **D7:** Productos sin mapear → `SelloutData.productId = NULL` + insert en `UnmappedProduct`. Banner en dashboard con CTA a Catálogo. No rechazar el upload.
- **D8:** Branch protection en GitHub OFF durante setup. Hook `block-main-writes` protege. Ver ADR-001.

---

## Decisiones técnicas cerradas durante brainstorming

- **Upload UX:** selector explícito por archivo (Soriana — Mixto, Chedraui — Mixto, Amazon — Ventas, Amazon — Inventario). Una `Upload` row por archivo.
- **UPSERT key:** `(clientId, chain, storeId, portalRawProduct, periodYear, periodMonth)` con `NULLS NOT DISTINCT` (Postgres 15+) + `COALESCE` per campo. SQL usa `ON CONFLICT (cols)` NO `ON CONFLICT ON CONSTRAINT` (AJUSTE 5).
- **Catálogo onboarding híbrido:** Excel opcional al crear cliente + incremental vía `UnmappedProduct`.
- **PortalCredential:** username almacenado, password descartado silenciosamente (microcopy explícito sobre Fase 2 con KMS).
- **Alert thresholds:** SIN_STOCK / CRITICO<7 / RIESGO<14 / ATENCION<21 / OK 21-60 / EXCESO>60 / SIN_DATOS. Configurables en Fase 2.
- **Seed:** estático puro (user + client + catálogo + portal credentials). NO popula SelloutData. El demo ES el upload en vivo.
- **Pre-flight obligatorio** antes de cada presentación.
- **Theme:** dark mode primero, accent emerald `#10B981` (HSL `160 84% 39%` — corregir de `158 64% 40%` en G2 Step 0).

---

## Modo de trabajo

**Subagent-driven con reviews dobles.** Cada task (Sprint o Gate):

1. Implementer subagent ejecuta el task. Prompt DEBE incluir literal la sección de mitigaciones supply chain.
2. Spec compliance reviewer subagent valida contra el spec.
3. Code quality reviewer subagent valida calidad técnica.
4. Post-task auto-verification mandatoria (3 comandos en sección supply chain).
5. Commit con mensaje descriptivo (`feat(sX): ...` o `feat(gX): ...`).

**Sprints** son self-verifiable con tests automáticos (parsers, normalizer, KPIs). Subagent puede ejecutarlos directo.

**Gates** requieren revisión humana visual (UI, layout, dashboard). El usuario abre el navegador y verifica contra el checklist de §7.2.1 del spec. Subagent puede preparar el código pero el usuario aprueba el gate.

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
pnpm typecheck  # requiere agregar a package.json en G2 Step 0

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

1. **`PREFLIGHT_DATABASE_URL` no agregado a `.env.example`** — hook `block-env-writes` bloqueó la edición. El usuario debe hacerlo manualmente vía `vi` antes de S11 (pre-flight).
2. **Segunda Neon branch para preflight DB** — pendiente. Necesario antes de S11.
3. **Prisma 6.19.3 deprecation warning** sobre `package.json#prisma` (deprecated en Prisma 7, migra a `prisma.config.ts`). Diferido a Fase 2.
4. **G2 Step 0 follow-ups** del code quality review de G0:
   - Emerald HSL: cambiar `158 64% 40%` → `160 84% 39%` en `app/globals.css` (`:root` y `.dark`).
   - Agregar tokens shadcn faltantes (`--card`, `--popover`, `--accent`, `--destructive`, `--secondary`, `--input`, `--ring`, `--radius`).
   - Agregar `typecheck` script al `package.json`.
   - Reforzar `scripts/check-supply-chain.sh` con `set -euo pipefail` + quote vars.
5. **clsx + tailwind-merge** se instalan en G2 Step 0b (`clsx@2.1.1`, `tailwind-merge@2.5.5`) bajo mitigación #6.
6. **`upsertUnmapped()` race condition latente** en `core/normalizer/upsert.ts` — usa findUnique + create/update en vez de raw INSERT...ON CONFLICT. No bloquea Fase 1 (single concurrent upload), TODO para Fase 2.
7. **Scaffolds pre-existentes commiteados** en `app/(auth)/`, `app/(dashboard)/`, `app/(marketing)/`, `app/api/`, `core/analytics/`, `core/types/`, `lib/`, `prisma/`. NO requieren limpieza — son estructura preparada para gates futuras.

---

## Cómo arranca cada sesión nueva

1. Leer este `CLAUDE.md` (auto).
2. `git log --oneline main..HEAD | head -15` para ver estado de commits.
3. Leer `docs/handoff/session-N-end-of-day-X.md` más reciente.
4. Identificar el próximo task del plan (`docs/plans/onetable-fase1-plan.md`).
5. Confirmar con el usuario antes de dispatcheur el primer implementer.

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