# OneTable Fase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir el demo de OneTable para ANTAD: SaaS Next.js que parsea sell-out de Soriana/Chedraui/Amazon, normaliza a una tabla unificada con UPSERT idempotente, y muestra dashboard polished con KPIs + 5 charts + OneTable consolidada.

**Architecture:** Monolito Next.js 14 App Router + TS + Tailwind + shadcn/ui. Carpeta `core/` con lógica pura sin imports de Next (portable a Python en Fase 3). Prisma + Neon Postgres con UPSERT `NULLS NOT DISTINCT` + COALESCE per campo. Parser registry drop-in (`chain:fileType` → `PortalParser`). Normalizer escribe lo que provee el parser; campos faltantes se rellenan en uploads posteriores.

**Tech Stack:** Next.js 14 + TypeScript + Tailwind + shadcn/ui + Prisma + Neon Postgres + NextAuth v5 (JWT, Credentials) + Recharts + SheetJS (`xlsx`) + Papaparse + bcryptjs + Vitest + Vercel.

**Spec reference:** `docs/specs/onetable-fase1-spec.md`. Cada task referencia secciones específicas del spec — no re-leas el spec entero por task.

---

## ⚠️ Decisiones pendientes del usuario (resolver ANTES de G0)

Estas decisiones afectan la ejecución de tasks tempranas. El plan asume placeholders y los reemplaza cuando el usuario decide.

### PD1 — Versión exacta de `next-auth` (NextAuth v5)

NO usar `@beta` floating. Resolver versión estable beta exacta antes de S0.

**Cómo decidir:**
```bash
pnpm view next-auth versions --json | jq -r '.[]' | grep -E 'beta\.[0-9]+$' | tail -5
```
Pickear la más reciente. Documentar en este plan: `next-auth@5.0.0-beta.XX`.

### PD2 — Accent color del theme

shadcn init pide accent color. Opciones:

- **Linear green** — `#5E6AD2` base + green accent (#22C55E). Estilo "Linear", profesional.
- **Vercel blue** — neutral + blue accent (#3B82F6). Estilo "Vercel".
- **Supabase emerald** — neutral + emerald accent (#10B981). Estilo "Supabase".
- **Indigo** — neutral + indigo accent (#6366F1). Más "data tools".

Una vez decidido, hardcodear en `app/globals.css` durante G0.

---

## Dependency Graph

```
G0 (Bootstrap)
  └─→ S0 (Deps + Prisma init + Vitest harness)
        └─→ S1 (Schema + migrations + NULLS NOT DISTINCT)
              ├─→ S2 (Parser Soriana)      ┐
              ├─→ S3 (Parser Chedraui)     │ Paralelizables vía subagentes
              ├─→ S4 (Parser Amazon Ventas)│
              ├─→ S5 (Parser Amazon Inv)   ┘
              ├─→ S6 (Catalog importer)
              ├─→ S9 (Alerts classifier)   ← independiente, paralelizable
              └─→ S7 (Normalizer + UPSERT)
                    ├─→ S8 (KPIs)
                    ├─→ S10 (Seed) ──→ S11 (Pre-flight)
                    └─→ S12 (API routes)
                          ├─→ G1 (Auth UI)
                          └─→ G2 (Layout shell)
                                ├─→ G6 (Clientes)
                                ├─→ G7 (Catálogo)
                                ├─→ G5 (Análisis) ──→ ⚠ CP1 (Day 2 cut decision)
                                ├─→ G4 (Dashboard FULL)
                                ├─→ G3 (Landing)
                                ├─→ G8 (Promotoría)
                                └─→ G9 (Deploy + smoke) ──→ ⚠ CP2 (Day 4 final)
                                      ↑ depends on S10 + S11
```

---

## Branch & commit hygiene

- **Branch:** `plan/onetable-fase1` (actual). Hook bloquea writes a main.
- **Commits:** Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`, `test:`). Pequeños y enfocados.
- **NUNCA** `--no-verify`. NUNCA `git push --force`.
- Después de cada task: commit. Después de cada gate: commit + verificación del checklist §7.2.1.

---

## ⚠ SUPPLY CHAIN MITIGATIONS (aplican a TODA instalación durante todo el plan)

Contexto: incidente reciente de supply chain ("Mini Shai-Hulud"). Estas mitigaciones son no-negociables. Cualquier subagente debe respetarlas en cada `pnpm install`, `pnpm add`, o invocación de scaffolder externo.

### Reglas durante toda la ejecución del plan

1. **`scripts/check-supply-chain.sh`** debe existir y correr ANTES y DESPUÉS de cada `pnpm install` / `pnpm add`. Si detecta infección → PARAR y notificar usuario. NO rotar tokens.

2. **TODAS las versiones pineadas EXACTAS** en `package.json` (sin `^` ni `~`). Lista verificada pre-incidente (publicadas antes del 29-abril-2026):

   **Runtime deps:**
   - `next@14.2.18`
   - `react@18.3.1`
   - `react-dom@18.3.1`
   - `prisma@6.19.3`
   - `@prisma/client@6.19.3`
   - `next-auth@5.0.0-beta.25`
   - `@auth/prisma-adapter@2.7.4`
   - `recharts@2.13.0`
   - `xlsx@0.18.5`
   - `papaparse@5.4.1`
   - `bcryptjs@2.4.3`

   **Dev deps:**
   - `typescript@5.3.3`
   - `@types/node@20.17.10`
   - `@types/react@18.3.18`
   - `@types/react-dom@18.3.5`
   - `@types/bcryptjs@2.4.6`
   - `@types/papaparse@5.3.15`
   - `tailwindcss@3.4.17`
   - `postcss@8.5.1`
   - `autoprefixer@10.4.20`
   - `vitest@2.1.8`
   - `@vitest/coverage-v8@2.1.8`
   - `tsx@4.19.2`
   - `eslint@8.57.1`
   - `eslint-config-next@14.2.18`

3. **SIEMPRE** usar `pnpm install --ignore-scripts` y `pnpm add --ignore-scripts <pkg>`. Sin excepciones.

4. **Post-install ejecutar manualmente solo lo necesario:**
   - `pnpm dlx prisma@6.19.3 generate` después de S0 cuando schema.prisma exista.
   - NO correr otros postinstall hooks.

5. **NUNCA** borrar `pnpm-lock.yaml` una vez creado y commiteado. Si hay troubleshooting, borrar solo `node_modules` y reinstalar con `--ignore-scripts`.

6. **NO** ejecutar `pnpm view`, `pnpm search`, `npm view`. Si un task requiere paquete nuevo no listado, el implementer PUEDE agregarlo si cumple TODOS:
   - (a) Pin EXACTO sin `^` ni `~` en `package.json` (manual edit antes de install)
   - (b) `pnpm install --ignore-scripts` (nunca sin la flag)
   - (c) Supply-chain check pre + post-install
   - (d) Grep lockfile post-install contra suspicious tokens
   - (e) Reportar al final del task: lista de paquetes agregados con versiones exactas + razón técnica
   
   NO requiere aprobación previa del usuario, SÍ requiere reporte explícito en el handoff. Versión que se agregue debe ser razonablemente pre-incidente (29-abril-2026); si dudoso, marcar en el reporte para que el usuario confirme post-hoc.

7. **Para `pnpm dlx shadcn@latest add <component>`** (en G2, G6, G7, G5, G4, G8): mismas reglas que #6. Ejecutar directo con --ignore-scripts (o usando `--no-install` + manual pin + install) y reportar deps agregadas al final del task.

8. **Verificación lockfile post-install** (después de cada `pnpm install`/`pnpm add`):
   ```bash
   grep -E "tanstack|squawk|uipath|mistral|cap-js|intercom-client|lightning" pnpm-lock.yaml && echo "❌ SUSPICIOUS" || echo "✅ clean"
   grep -E "router_init|setup\.mjs|router_runtime" pnpm-lock.yaml && echo "❌ SUSPICIOUS" || echo "✅ clean"
   ```
   Cualquier hit → PARAR + notificar.

9. **NO usar `create-next-app`** ni similares scaffolders auto-installer. Scaffold manual (G0 paso a paso) garantiza control de versions + `--ignore-scripts` desde el inicio.

10. **Si una versión pineada no existe o tiene peer-dep que no resuelve:** PARAR y consultar usuario. NO improvisar versiones.

### Script `check-supply-chain.sh`

```bash
#!/bin/bash
set -euo pipefail
echo "Checking for Mini Shai-Hulud infection markers..."
INFECTED=0
[ -f ~/Library/LaunchAgents/com.user.gh-token-monitor.plist ] && echo "❌ INFECTED: gh-token-monitor daemon" && INFECTED=1
[ -f ~/.claude/router_runtime.js ] && echo "❌ INFECTED: router_runtime.js" && INFECTED=1
[ -f ~/.vscode/setup.mjs ] && echo "❌ INFECTED: setup.mjs" && INFECTED=1
[ "$INFECTED" -eq 1 ] && exit 1
echo "✅ Clean — no infection markers detected"
```

### Verificación automática post-task (mandatoria al final de CADA implementer task)

Después de implementer (antes de declarar DONE), correr:

```bash
./scripts/check-supply-chain.sh
grep -E '"[\^~]' package.json && echo "❌ FOUND caret/tilde" && exit 1 || echo "✅ all pins exact"
grep -E "tanstack|squawk|uipath|mistral|cap-js|intercom-client|router_init|setup\.mjs|router_runtime" pnpm-lock.yaml | grep -v lightningcss && echo "❌ SUSPICIOUS lockfile entry" && exit 1 || echo "✅ lockfile clean"
```

Si cualquier check falla, task NO es DONE — fix antes de commit.

### Dispatch pattern note

El prompt template del implementer subagent debe INCLUIR LITERAL la sección "Reglas durante toda la ejecución del plan" (las 10 reglas) como prefijo de cada prompt. No depender de que el subagente las descubra leyendo el plan.

---

## Tareas

### Task G0 — Bootstrap Next.js + shadcn + emerald theme (manual scaffold)

**Tipo:** Gate (decisión visual del accent color requiere usuario).
**Estimado:** 1.5h.
**Spec ref:** §1 (stack y layout), §7.2 G2 razones para gate, **SUPPLY CHAIN MITIGATIONS** (arriba del plan).
**Upstream deps:** ninguna.
**Downstream deps:** S0.
**Accent decidido (PD2):** **emerald `#10B981`** → HSL `158 64% 40%`.
**NextAuth pin (PD1):** `next-auth@5.0.0-beta.25`.

**Files:**
- Create: `scripts/check-supply-chain.sh`
- Create: `package.json`, `pnpm-lock.yaml`
- Create: `tsconfig.json`, `next.config.mjs`, `tailwind.config.ts`, `postcss.config.mjs`, `.eslintrc.json`
- Create: `app/layout.tsx`, `app/page.tsx`, `app/globals.css`
- Create: `lib/utils.ts` (cn() helper)
- Create: `components.json` (shadcn config, escrito a mano)
- Create: `.gitignore`

**Por qué scaffold manual (no `create-next-app`):** mitigación #9 — `create-next-app` corre `pnpm install` internamente sin `--ignore-scripts`. Bypass total al scaffolder garantiza control de versions + ignore-scripts desde el primer install.

- [ ] **Step 0a: Crear `scripts/check-supply-chain.sh`** (mitigación #1)

```bash
mkdir -p scripts
cat > scripts/check-supply-chain.sh <<'SH'
#!/bin/bash
echo "Checking for Mini Shai-Hulud infection markers..."
INFECTED=0
[ -f ~/Library/LaunchAgents/com.user.gh-token-monitor.plist ] && echo "❌ INFECTED: gh-token-monitor daemon" && INFECTED=1
[ -f ~/.claude/router_runtime.js ] && echo "❌ INFECTED: router_runtime.js" && INFECTED=1
[ -f ~/.vscode/setup.mjs ] && echo "❌ INFECTED: setup.mjs" && INFECTED=1
[ $INFECTED -eq 1 ] && exit 1
echo "✅ Clean — no infection markers detected"
SH
chmod +x scripts/check-supply-chain.sh
```

- [ ] **Step 0b: Correr supply-chain check PRE-bootstrap**

```bash
./scripts/check-supply-chain.sh
```
Expected: `✅ Clean`. Si retorna `❌ INFECTED` → PARAR, notificar usuario, NO rotar tokens.

- [ ] **Step 1: Verificar workspace limpio**

```bash
ls -la
git status
git branch --show-current
```
Expected: working tree clean, branch `plan/onetable-fase1`, NO `package.json` existente.

- [ ] **Step 2: Crear `package.json` con TODAS las deps pineadas exactas**

```bash
cat > package.json <<'JSON'
{
  "name": "onetable",
  "version": "0.1.0",
  "private": true,
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "next": "14.2.18",
    "react": "18.3.1",
    "react-dom": "18.3.1",
    "prisma": "6.19.3",
    "@prisma/client": "6.19.3",
    "next-auth": "5.0.0-beta.25",
    "@auth/prisma-adapter": "2.7.4",
    "recharts": "2.13.0",
    "xlsx": "0.18.5",
    "papaparse": "5.4.1",
    "bcryptjs": "2.4.3"
  },
  "devDependencies": {
    "typescript": "5.3.3",
    "@types/node": "20.17.10",
    "@types/react": "18.3.18",
    "@types/react-dom": "18.3.5",
    "@types/bcryptjs": "2.4.6",
    "@types/papaparse": "5.3.15",
    "tailwindcss": "3.4.17",
    "postcss": "8.5.1",
    "autoprefixer": "10.4.20",
    "vitest": "2.1.8",
    "@vitest/coverage-v8": "2.1.8",
    "tsx": "4.19.2",
    "eslint": "8.57.1",
    "eslint-config-next": "14.2.18"
  }
}
JSON
```

Verificar SIN caret/tilde:
```bash
grep -E '"[\^~]' package.json && echo "❌ FOUND ^ or ~" || echo "✅ all pins exact"
```
Expected: `✅ all pins exact`.

- [ ] **Step 3: Crear configs Next.js (manuales, sin scaffolder)**

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["dom", "dom.iterable", "esnext"],
    "allowJs": true,
    "skipLibCheck": true,
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "module": "esnext",
    "moduleResolution": "bundler",
    "resolveJsonModule": true,
    "isolatedModules": true,
    "jsx": "preserve",
    "incremental": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./*"] }
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

`next.config.mjs`:
```js
/** @type {import('next').NextConfig} */
const nextConfig = {};
export default nextConfig;
```

`postcss.config.mjs`:
```js
export default {
  plugins: { tailwindcss: {}, autoprefixer: {} },
};
```

`tailwind.config.ts`:
```ts
import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: ['class'],
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: { DEFAULT: 'hsl(var(--primary))', foreground: 'hsl(var(--primary-foreground))' },
        muted: { DEFAULT: 'hsl(var(--muted))', foreground: 'hsl(var(--muted-foreground))' },
        border: 'hsl(var(--border))',
      },
    },
  },
  plugins: [],
};
export default config;
```

`.eslintrc.json`:
```json
{ "extends": "next/core-web-vitals" }
```

`.gitignore`:
```
node_modules/
.next/
out/
.env
.env.local
*.tsbuildinfo
next-env.d.ts
.DS_Store
```

- [ ] **Step 4: Crear `app/layout.tsx`, `app/page.tsx`, `app/globals.css` (con emerald accent + dark mode)**

`app/globals.css`:
```css
@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    --background: 0 0% 100%;
    --foreground: 0 0% 3.9%;
    --muted: 0 0% 96.1%;
    --muted-foreground: 0 0% 45.1%;
    --border: 0 0% 89.8%;
    --primary: 158 64% 40%;          /* emerald #10B981 */
    --primary-foreground: 0 0% 98%;
  }
  .dark {
    --background: 0 0% 3.9%;
    --foreground: 0 0% 98%;
    --muted: 0 0% 14.9%;
    --muted-foreground: 0 0% 63.9%;
    --border: 0 0% 14.9%;
    --primary: 158 64% 40%;          /* emerald #10B981 */
    --primary-foreground: 0 0% 98%;
  }
}

* { @apply border-border; }
body { @apply bg-background text-foreground; }
```

`app/layout.tsx` (dark mode default activado):
```tsx
import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'OneTable', description: 'Portal de portales para retail' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" className="dark">
      <body>{children}</body>
    </html>
  );
}
```

`app/page.tsx` (smoke del accent — plain `<button>` con Tailwind, sin shadcn Button todavía):
```tsx
export default function Home() {
  return (
    <main className="flex min-h-screen items-center justify-center">
      <button className="bg-primary text-primary-foreground px-6 py-3 rounded-md font-medium">
        OneTable — emerald accent test
      </button>
    </main>
  );
}
```

- [ ] **Step 5: ~~lib/utils.ts~~ DIFERIDO a G2**

`cn()` helper requiere `clsx` + `tailwind-merge` que NO están en la lista pineada. G0 no necesita `cn()` (el smoke test usa `<button>` plano con Tailwind). Diferimos creación de `lib/utils.ts` a G2 (primer task que agrega componentes shadcn reales), donde aplicará mitigación #7: presentar versiones de `clsx` + `tailwind-merge` al usuario, esperar confirmación, agregar a pin list.

Crear placeholder vacío en `lib/` para que la carpeta exista:
```bash
mkdir -p lib
touch lib/.gitkeep
```

- [ ] **Step 6: Crear `components.json` (shadcn config a mano)**

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "default",
  "rsc": true,
  "tsx": true,
  "tailwind": {
    "config": "tailwind.config.ts",
    "css": "app/globals.css",
    "baseColor": "neutral",
    "cssVariables": true
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils"
  }
}
```

- [ ] **Step 7: Primer `pnpm install --ignore-scripts`**

PRE-check supply chain:
```bash
./scripts/check-supply-chain.sh
```
Expected: ✅ Clean.

Install:
```bash
pnpm install --ignore-scripts
```
Expected: `pnpm-lock.yaml` creado. Sin postinstall hooks ejecutados.

POST-check supply chain:
```bash
./scripts/check-supply-chain.sh
grep -E "tanstack|squawk|uipath|mistral|cap-js|intercom-client|lightning" pnpm-lock.yaml && echo "❌ SUSPICIOUS" || echo "✅ lockfile clean (no suspicious pkgs)"
grep -E "router_init|setup\.mjs|router_runtime" pnpm-lock.yaml && echo "❌ SUSPICIOUS" || echo "✅ lockfile clean (no infection markers)"
```
Expected: tres `✅`. Si alguno falla → PARAR + notificar.

- [ ] **Step 8: Verificar dev + build**

```bash
pnpm dev &
DEV_PID=$!
sleep 5
curl -sf http://localhost:3000 > /dev/null && echo "✅ dev OK" || echo "❌ dev failed"
kill $DEV_PID
pnpm build
```
Expected: `dev OK` + build sin errores TS.

- [ ] **Step 9: Verificación visual manual (Gate G0 checklist §7.2.1 G2-derived + G0-specific)**

Correr `pnpm dev`, abrir Chrome en http://localhost:3000:

- [ ] Fondo dark (oscuro)
- [ ] Botón visible con color emerald `#10B981` (verde-azulado vibrante)
- [ ] Sin errores rojos en DevTools console
- [ ] `pnpm build` exit code 0 (verificado Step 8)
- [ ] `components.json` existe con `baseColor: neutral, cssVariables: true`
- [ ] `package.json` tiene 0 caret/tilde versions (verificado Step 2)
- [ ] `scripts/check-supply-chain.sh` existe, es ejecutable, pasa
- [ ] `pnpm-lock.yaml` existe y está commiteado

- [ ] **Step 10: Commit**

```bash
git add scripts/ package.json pnpm-lock.yaml tsconfig.json next.config.mjs \
        tailwind.config.ts postcss.config.mjs .eslintrc.json .gitignore \
        app/ lib/ components.json
git commit -m "feat(bootstrap): manual scaffold Next.js 14 + emerald theme + supply-chain hardening (G0 ✓)"
```

---

### Task S0 — Prisma init + Vitest config + folder structure + scripts

**Tipo:** Sprint.
**Estimado:** 1h.
**Spec ref:** §6.1 (scripts package.json), §2 (Prisma schema preview).
**Upstream deps:** G0 (todas las deps runtime+dev ya instaladas con `--ignore-scripts` en G0).
**Downstream deps:** S1.
**Binary pass:** `pnpm prisma --version` retorna `6.19.3`; `pnpm test` reporta `No test files found` sin error; todas las carpetas core/ y tests/ existen.

**Files:**
- Modify: `package.json` (agregar scripts db:seed/db:reset/preflight + `prisma.seed` block).
- Create: `prisma/schema.prisma` (mínimo — provider + datasource).
- Create: `.env.example` (si no existe; agregar `DATABASE_URL` placeholder + `AUTH_SECRET` placeholder + `PREFLIGHT_DATABASE_URL` placeholder).
- Create: `vitest.config.ts`.
- Create: directorios vacíos con `.gitkeep` en `core/parsers/`, `core/normalizer/`, `core/catalog/`, `core/kpis/`, `core/alerts/`, `core/dates/`, `tests/parsers/`, `tests/fixtures/`. (`lib/` y `scripts/` ya existen.)

> **NO se instala nada nuevo en S0.** Todas las deps están en G0. Si surgiera necesidad de un paquete adicional, aplicar mitigación #6 y consultar al usuario.

- [ ] **Step 1: Crear estructura de carpetas**

```bash
mkdir -p core/parsers core/normalizer core/catalog core/kpis core/alerts core/dates
mkdir -p tests/parsers tests/fixtures
touch core/parsers/.gitkeep core/normalizer/.gitkeep core/catalog/.gitkeep \
      core/kpis/.gitkeep core/alerts/.gitkeep core/dates/.gitkeep \
      tests/parsers/.gitkeep tests/fixtures/.gitkeep
```

- [ ] **Step 2: Inicializar Prisma (sin install)**

```bash
pnpm exec prisma init --datasource-provider postgresql
```

`pnpm exec` usa el binario `prisma` ya instalado en G0, NO ejecuta `dlx` (que descargaría temp).

Expected: `prisma/schema.prisma` creado, mensaje sugiriendo agregar `DATABASE_URL` a `.env`.

Si `.env` se creó automáticamente con placeholder, BORRARLO si conflictúa con `.env.local` existente del usuario. La fuente de verdad es `.env.local`.

- [ ] **Step 3: Verificar/crear `.env.example`**

Si `.env.example` ya existe, agregar las vars que falten. Si no existe:

```bash
cat > .env.example <<'ENV'
# Neon Postgres connection string (project DB)
DATABASE_URL="postgresql://user:pass@host/db?sslmode=require"

# NextAuth v5 secret (genera con: openssl rand -base64 32)
AUTH_SECRET=""
AUTH_TRUST_HOST="true"

# Pre-flight DB (segunda Neon branch para validar uploads antes del demo)
PREFLIGHT_DATABASE_URL=""
ENV
```

- [ ] **Step 4: Crear `vitest.config.ts`**

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    coverage: { provider: 'v8', include: ['core/**/*.ts'] },
  },
  resolve: {
    alias: { '@': resolve(__dirname, '.') },
  },
});
```

- [ ] **Step 5: Actualizar scripts en `package.json`**

Editar `package.json` para agregar (manteniendo los scripts existentes):

```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "next lint",
    "test": "vitest run",
    "test:watch": "vitest",
    "db:seed": "tsx scripts/seed.ts",
    "db:reset": "prisma migrate reset --force",
    "preflight": "tsx scripts/preflight.ts"
  },
  "prisma": {
    "seed": "tsx scripts/seed.ts"
  }
}
```

- [ ] **Step 6: Verificación binaria del Sprint S0**

```bash
pnpm prisma --version
pnpm test 2>&1 | tee /tmp/s0-test.log
pnpm build
ls -d core/parsers core/normalizer core/catalog core/kpis core/alerts core/dates \
      tests/parsers tests/fixtures
```

Expected:
- `pnpm prisma --version` → `prisma : 6.19.3` (sin descargar binarios extra; usa el del install).
- `pnpm test` → "No test files found" (sin error fatal).
- `pnpm build` → exit 0.
- Todas las carpetas listadas existen.

- [ ] **Step 7: Verificar supply chain (no nuevos installs pero por hábito)**

```bash
./scripts/check-supply-chain.sh
```
Expected: ✅ Clean.

- [ ] **Step 8: Commit**

```bash
git add prisma/ vitest.config.ts package.json .env.example core/ tests/
git commit -m "feat(s0): Prisma init + Vitest config + core/ folder structure + scripts"
```

---

### Task S1 — Prisma schema + migration + NULLS NOT DISTINCT

**Tipo:** Sprint.
**Estimado:** 1.5h.
**Spec ref:** §2 (todo). §2.1 modelos, §2.2 NULLS NOT DISTINCT workaround, §2.3 UPSERT, §2.4 decisiones.
**Upstream deps:** S0.
**Downstream deps:** S2, S3, S4, S5, S6, S7, S9.
**Binary pass:** migration aplica sin error, índice `sellout_unique_idx` tiene `NULLS NOT DISTINCT` (verificable via `\d+ "SelloutData"` en psql).

**Files:**
- Modify: `prisma/schema.prisma` (reemplazar contenido completo).
- Create: `prisma/migrations/<timestamp>_init/migration.sql` (generada y editada manualmente).

- [ ] **Step 1: Copiar el schema completo de §2.1 del spec**

Reemplazar el contenido de `prisma/schema.prisma` con el bloque completo de §2.1 (líneas con `model User`, `model Client`, `enum Chain`, `model Product`, `model ProductMapping`, `model PortalCredential`, `enum FileType`, `enum UploadStatus`, `model Upload`, `model SelloutData`, `model UnmappedProduct`).

**No modificar absolutamente nada** de los modelos, enums, decoradores ni índices. El spec es la fuente de verdad. Si encontrás algo que parece bug en el schema, parar y preguntar antes de editar.

- [ ] **Step 2: Generar migration sin aplicar**

```bash
pnpm dlx prisma migrate dev --create-only --name init
```

Expected: `prisma/migrations/<timestamp>_init/migration.sql` creada. NO se aplica todavía.

- [ ] **Step 3: Editar migration.sql para NULLS NOT DISTINCT**

Abrir `prisma/migrations/<timestamp>_init/migration.sql`. Buscar la línea:

```sql
CREATE UNIQUE INDEX "sellout_unique_idx" ON "SelloutData"(...);
```

Reemplazar por:

```sql
CREATE UNIQUE INDEX "sellout_unique_idx" ON "SelloutData"(
  "clientId", "chain", "storeId", "portalRawProduct", "periodYear", "periodMonth"
) NULLS NOT DISTINCT;
```

Spec ref: §2.2 explica por qué.

- [ ] **Step 4: Aplicar migration**

```bash
pnpm dlx prisma migrate dev
```

Expected: migration aplicada sin error a la DB de `DATABASE_URL`.

- [ ] **Step 5: Verificar NULLS NOT DISTINCT en la DB**

```bash
pnpm dlx prisma db execute --stdin <<'SQL'
SELECT indexdef FROM pg_indexes WHERE indexname = 'sellout_unique_idx';
SQL
```

Expected output contiene `NULLS NOT DISTINCT`.

- [ ] **Step 6: Generar Prisma client**

```bash
pnpm dlx prisma generate
```

Expected: `node_modules/.prisma/client/` regenerado.

- [ ] **Step 7: Crear singleton Prisma client**

Crear `lib/db.ts`:

```typescript
// lib/db.ts
import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db;
```

- [ ] **Step 8: Verificación final del Sprint**

```bash
pnpm dlx prisma validate
pnpm build
```

Expected: ambos pasan sin error.

- [ ] **Step 9: Commit**

```bash
git add prisma/ lib/db.ts
git commit -m "feat(db): add Prisma schema with NULLS NOT DISTINCT on sellout_unique_idx"
```

---

### Task S2 — Parser Soriana

**Tipo:** Sprint (TDD estricto).
**Estimado:** 2h.
**Spec ref:** §3.1 (tipos compartidos), §3.3 Soriana, §3.4 reglas comunes.
**Upstream deps:** S0 (vitest), S1 (Prisma types).
**Downstream deps:** S7 (normalizer), seed/preflight.
**Paraleliza con:** S3, S4, S5.
**Binary pass:** `pnpm test tests/parsers/soriana.test.ts` pasa. Fixture esperada: ver Step 3.

**Files:**
- Create: `core/parsers/types.ts` (tipos compartidos, una sola vez para todos los parsers).
- Create: `core/dates/spanish-months.ts`.
- Create: `core/parsers/soriana.ts`.
- Create: `tests/parsers/soriana.test.ts`.
- Create: `tests/fixtures/soriana-expected.ts` (fixture esperada).

> Si este task se ejecuta antes que S3/S4/S5 y `core/parsers/types.ts` ya existe (creado por otro parser que arrancó primero), no recrearlo — solo importarlo.

- [ ] **Step 1: Crear `core/parsers/types.ts`**

Copiar EXACTAMENTE del spec §3.1. Tipos: `ParsedRow`, `ParserMetadata`, `ParserWarning`, `ParserResult`, `PortalParser` (interface).

- [ ] **Step 2: Crear `core/dates/spanish-months.ts`**

```typescript
// core/dates/spanish-months.ts
const SHORT_MAP: Record<string, number> = {
  Ene: 1, Feb: 2, Mar: 3, Abr: 4, May: 5, Jun: 6,
  Jul: 7, Ago: 8, Sep: 9, Oct: 10, Nov: 11, Dic: 12,
};

const LONG_MAP: Record<string, number> = {
  Enero: 1, Febrero: 2, Marzo: 3, Abril: 4, Mayo: 5, Junio: 6,
  Julio: 7, Agosto: 8, Septiembre: 9, Octubre: 10, Noviembre: 11, Diciembre: 12,
};

/** Parses "Ene 2026" → { year: 2026, month: 1 }. */
export function parseShortSpanishMonthYear(s: string): { year: number; month: number } {
  const [mon, yr] = s.trim().split(/\s+/);
  const month = SHORT_MAP[mon];
  if (!month) throw new Error(`Unknown short Spanish month: ${mon}`);
  return { year: parseInt(yr, 10), month };
}

/** Parses "Enero de 2026" → { year: 2026, month: 1 }. */
export function parseLongSpanishMonthYear(s: string): { year: number; month: number } {
  const m = s.trim().match(/^(\w+)\s+de\s+(\d{4})$/i);
  if (!m) throw new Error(`Cannot parse long Spanish month-year: ${s}`);
  const month = LONG_MAP[m[1].charAt(0).toUpperCase() + m[1].slice(1).toLowerCase()];
  if (!month) throw new Error(`Unknown long Spanish month: ${m[1]}`);
  return { year: parseInt(m[2], 10), month };
}
```

- [ ] **Step 3: Crear fixture esperada `tests/fixtures/soriana-expected.ts`**

Basado en lectura directa de `docs/specs/viks-data/samples/soriana-sample.xlsx` (60 rows). Verificar mediante `python3 -c "import openpyxl; ..."` o leyendo el README §1 que confirma estructura.

```typescript
// tests/fixtures/soriana-expected.ts
import type { ParsedRow } from '@/core/parsers/types';

export const SORIANA_EXPECTED_FIRST_3_ROWS: ParsedRow[] = [
  {
    periodYear: 2026, periodMonth: 1,
    portalRawProduct: "BEEFJERKY - CHILLI LIME 86 GR VIK'S 86",
    storeId: "0001", storeName: "SANTO DOMINGO", storeFormat: null,
    salesUnits: 3,
    salesAmountMxn: 406.93,
    inventoryUnits: 8,
  },
  {
    periodYear: 2026, periodMonth: 2,
    portalRawProduct: "BEEFJERKY - CHILLI LIME 86 GR VIK'S 86",
    storeId: "0001", storeName: "SANTO DOMINGO", storeFormat: null,
    salesUnits: 1,
    salesAmountMxn: 138.12,
    inventoryUnits: 8,
  },
  {
    periodYear: 2026, periodMonth: 3,
    portalRawProduct: "BEEFJERKY - CHILLI LIME 86 GR VIK'S 86",
    storeId: "0001", storeName: "SANTO DOMINGO", storeFormat: null,
    salesUnits: 2,
    salesAmountMxn: 278.12,
    inventoryUnits: 6,
  },
];

export const SORIANA_EXPECTED_TOTAL_ROWS = 60;
```

- [ ] **Step 4: Write failing test**

Crear `tests/parsers/soriana.test.ts`:

```typescript
// tests/parsers/soriana.test.ts
import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { sorianaParser } from '@/core/parsers/soriana';
import { SORIANA_EXPECTED_FIRST_3_ROWS, SORIANA_EXPECTED_TOTAL_ROWS } from '@/tests/fixtures/soriana-expected';

const SAMPLE_PATH = resolve(__dirname, '../../docs/specs/viks-data/samples/soriana-sample.xlsx');

describe('sorianaParser', () => {
  it('parses the VIKS sample with expected row count', async () => {
    const buffer = await readFile(SAMPLE_PATH);
    const result = await sorianaParser.parse({ buffer, fileType: 'MIXED', originalFilename: 'soriana-sample.xlsx' });
    expect(result.rows).toHaveLength(SORIANA_EXPECTED_TOTAL_ROWS);
    expect(result.metadata.chain).toBe('SORIANA');
    expect(result.metadata.fileType).toBe('MIXED');
  });

  it('produces the expected first 3 rows', async () => {
    const buffer = await readFile(SAMPLE_PATH);
    const result = await sorianaParser.parse({ buffer, fileType: 'MIXED', originalFilename: 'soriana-sample.xlsx' });
    expect(result.rows.slice(0, 3)).toEqual(SORIANA_EXPECTED_FIRST_3_ROWS);
  });

  it('preserves negative inventory and null compras', async () => {
    const buffer = await readFile(SAMPLE_PATH);
    const result = await sorianaParser.parse({ buffer, fileType: 'MIXED', originalFilename: 'soriana-sample.xlsx' });
    const allRows = result.rows;
    expect(allRows.every(r => r.purchasesUnits === undefined || r.purchasesUnits === null)).toBe(true);
  });
});
```

- [ ] **Step 5: Run test — verify it fails**

```bash
pnpm test tests/parsers/soriana.test.ts
```
Expected: FAIL — `sorianaParser` no existe.

- [ ] **Step 6: Implement `core/parsers/soriana.ts`**

```typescript
// core/parsers/soriana.ts
import { createHash } from 'node:crypto';
import * as XLSX from 'xlsx';
import type { Chain, FileType } from '@prisma/client';
import type { ParsedRow, ParserResult, PortalParser } from './types';
import { parseShortSpanishMonthYear } from '../dates/spanish-months';

export const sorianaParser: PortalParser = {
  chain: 'SORIANA' as Chain,
  supportedFileTypes: ['MIXED' as FileType],

  async parse({ buffer, fileType, originalFilename }) {
    const wb = XLSX.read(buffer, { type: 'buffer' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });

    const rows: ParsedRow[] = [];
    const warnings: ParserResult['warnings'] = [];

    for (let i = 0; i < raw.length; i++) {
      const r = raw[i];
      try {
        const mesStr = String(r['Mes']);
        const { year, month } = parseShortSpanishMonthYear(mesStr);
        const row: ParsedRow = {
          periodYear: year,
          periodMonth: month,
          portalRawProduct: String(r['Artículo']),
          storeId: String(r['Código Tienda']),
          storeName: String(r['Tienda']),
          storeFormat: null,
        };

        const ventaPesos = r['Venta (Pesos)'];
        const ventaUnidades = r['Venta (Unidades)'];
        const compraUnidades = r['Compra (Unidades)'];
        const compraPesos = r['Compra (Pesos)'];
        const inventario = r['Inventario (Actual)'];

        if (ventaPesos !== null) row.salesAmountMxn = Number(ventaPesos);
        if (ventaUnidades !== null) row.salesUnits = Number(ventaUnidades);
        if (compraUnidades !== null) row.purchasesUnits = Number(compraUnidades);
        if (compraPesos !== null) row.purchasesAmountMxn = Number(compraPesos);
        if (inventario !== null) row.inventoryUnits = Number(inventario);

        rows.push(row);
      } catch (err) {
        warnings.push({ rowIndex: i + 1, message: (err as Error).message });
      }
    }

    const fileHash = createHash('sha256').update(buffer).digest('hex');

    return {
      metadata: {
        chain: 'SORIANA' as Chain,
        fileType,
        originalFilename,
        fileHash,
        fileSizeBytes: buffer.length,
        rowCount: rows.length,
      },
      rows,
      warnings,
    };
  },
};
```

- [ ] **Step 7: Run test — verify it passes**

```bash
pnpm test tests/parsers/soriana.test.ts
```
Expected: PASS (3 tests).

- [ ] **Step 8: Commit**

```bash
git add core/parsers/types.ts core/parsers/soriana.ts core/dates/spanish-months.ts \
        tests/parsers/soriana.test.ts tests/fixtures/soriana-expected.ts
git commit -m "feat(parser): add Soriana xlsx parser with vitest fixture"
```

---

### Task S3 — Parser Chedraui

**Tipo:** Sprint (TDD).
**Estimado:** 1.5h.
**Spec ref:** §3.1 tipos, §3.3 Chedraui, §3.4 reglas.
**Upstream deps:** S0, S1.
**Downstream deps:** S7.
**Paraleliza con:** S2, S4, S5.
**Binary pass:** `pnpm test tests/parsers/chedraui.test.ts` pasa.

**Files:**
- Create: `core/parsers/chedraui.ts`.
- Create: `tests/parsers/chedraui.test.ts`.
- Create: `tests/fixtures/chedraui-expected.ts`.

- [ ] **Step 1: Crear fixture esperada**

```typescript
// tests/fixtures/chedraui-expected.ts
import type { ParsedRow } from '@/core/parsers/types';

export const CHEDRAUI_EXPECTED_FIRST_2_ROWS: ParsedRow[] = [
  {
    periodYear: 2026, periodMonth: 1,
    portalRawProduct: "Carne Seca Vik s Jerky Co Res Hab 86 gr (3845442)",
    storeId: "00100",
    storeName: "00100 CHEDRAUI SELECTO MEXICO FORTUNA 03-17",
    storeFormat: null,
    salesUnits: 2,
    inventoryUnits: 14,
  },
  {
    periodYear: 2026, periodMonth: 1,
    portalRawProduct: "Carne Seca Vik s Jerky Co Res Limo 86 gr (3845443)",
    storeId: "00100",
    storeName: "00100 CHEDRAUI SELECTO MEXICO FORTUNA 03-17",
    storeFormat: null,
    salesUnits: 2,
    inventoryUnits: 12,
  },
];

export const CHEDRAUI_EXPECTED_TOTAL_ROWS = 40;
```

- [ ] **Step 2: Write failing test**

Crear `tests/parsers/chedraui.test.ts` análogo a Soriana, ajustando:
- `SAMPLE_PATH` apunta a `chedraui-sample.xlsx`.
- Importa `chedrauiParser`.
- Assertions: `metadata.chain === 'CHEDRAUI'`, `fileType === 'MIXED'`, primer 2 rows match, no `salesAmountMxn` (Chedraui es unit-only).

- [ ] **Step 3: Run test — verify it fails**

```bash
pnpm test tests/parsers/chedraui.test.ts
```
Expected: FAIL.

- [ ] **Step 4: Implement `core/parsers/chedraui.ts`**

```typescript
// core/parsers/chedraui.ts
import { createHash } from 'node:crypto';
import * as XLSX from 'xlsx';
import type { Chain, FileType } from '@prisma/client';
import type { ParsedRow, ParserResult, PortalParser } from './types';
import { parseLongSpanishMonthYear } from '../dates/spanish-months';

export const chedrauiParser: PortalParser = {
  chain: 'CHEDRAUI' as Chain,
  supportedFileTypes: ['MIXED' as FileType],

  async parse({ buffer, fileType, originalFilename }) {
    const wb = XLSX.read(buffer, { type: 'buffer' });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });

    const rows: ParsedRow[] = [];
    const warnings: ParserResult['warnings'] = [];

    for (let i = 0; i < raw.length; i++) {
      const r = raw[i];
      try {
        const monthStr = String(r['Month']);
        const { year, month } = parseLongSpanishMonthYear(monthStr);
        const tiendaFull = String(r['Tienda']);
        const storeId = tiendaFull.slice(0, 5);

        const row: ParsedRow = {
          periodYear: year,
          periodMonth: month,
          portalRawProduct: String(r['Sku']),
          storeId,
          storeName: tiendaFull,
          storeFormat: null,
        };

        const inv = r['Inv Fin Uni'];
        const venta = r['Venta Neta en Unidades'];
        if (inv !== null) row.inventoryUnits = Number(inv);
        if (venta !== null) row.salesUnits = Number(venta);

        rows.push(row);
      } catch (err) {
        warnings.push({ rowIndex: i + 1, message: (err as Error).message });
      }
    }

    const fileHash = createHash('sha256').update(buffer).digest('hex');

    return {
      metadata: {
        chain: 'CHEDRAUI' as Chain,
        fileType, originalFilename, fileHash,
        fileSizeBytes: buffer.length, rowCount: rows.length,
      },
      rows, warnings,
    };
  },
};
```

- [ ] **Step 5: Run test — verify it passes**

```bash
pnpm test tests/parsers/chedraui.test.ts
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add core/parsers/chedraui.ts tests/parsers/chedraui.test.ts tests/fixtures/chedraui-expected.ts
git commit -m "feat(parser): add Chedraui xlsx parser with vitest fixture"
```

---

### Task S4 — Parser Amazon Ventas

**Tipo:** Sprint (TDD).
**Estimado:** 1h.
**Spec ref:** §3.3 Amazon Ventas.
**Upstream deps:** S0, S1.
**Downstream deps:** S7.
**Paraleliza con:** S2, S3, S5.
**Binary pass:** `pnpm test tests/parsers/amazon-ventas.test.ts` pasa.

**Files:**
- Create: `core/parsers/amazon-ventas.ts`.
- Create: `tests/parsers/amazon-ventas.test.ts`.
- Create: `tests/fixtures/amazon-ventas-expected.ts`.

- [ ] **Step 1: Crear fixture esperada (9 rows totales del sample)**

```typescript
// tests/fixtures/amazon-ventas-expected.ts
import type { ParsedRow } from '@/core/parsers/types';

export const AMAZON_VENTAS_EXPECTED: ParsedRow[] = [
  { periodYear: 2026, periodMonth: 1, portalRawProduct: 'B0D22Y7LZR', storeId: null, storeName: null, storeFormat: null, salesUnits: 346 },
  { periodYear: 2026, periodMonth: 1, portalRawProduct: 'B0D22Y6YSN', storeId: null, storeName: null, storeFormat: null, salesUnits: 237 },
  { periodYear: 2026, periodMonth: 1, portalRawProduct: 'B0D22YBT7P', storeId: null, storeName: null, storeFormat: null, salesUnits: 211 },
  { periodYear: 2026, periodMonth: 1, portalRawProduct: 'B0BPK3BGDB', storeId: null, storeName: null, storeFormat: null, salesUnits: 193 },
  { periodYear: 2026, periodMonth: 1, portalRawProduct: 'B0D22ZP6RB', storeId: null, storeName: null, storeFormat: null, salesUnits: 75 },
  { periodYear: 2026, periodMonth: 1, portalRawProduct: 'B0BPK41TLJ', storeId: null, storeName: null, storeFormat: null, salesUnits: 167 },
  { periodYear: 2026, periodMonth: 1, portalRawProduct: 'B0D22ZDV47', storeId: null, storeName: null, storeFormat: null, salesUnits: 68 },
  { periodYear: 2026, periodMonth: 1, portalRawProduct: 'B0D22Z7BV7', storeId: null, storeName: null, storeFormat: null, salesUnits: 99 },
  { periodYear: 2026, periodMonth: 1, portalRawProduct: 'B0BPK34LCW', storeId: null, storeName: null, storeFormat: null, salesUnits: 28 },
];
```

- [ ] **Step 2: Write failing test**

```typescript
// tests/parsers/amazon-ventas.test.ts
import { describe, it, expect } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { amazonVentasParser } from '@/core/parsers/amazon-ventas';
import { AMAZON_VENTAS_EXPECTED } from '@/tests/fixtures/amazon-ventas-expected';

const SAMPLE = resolve(__dirname, '../../docs/specs/viks-data/samples/amazon-ventas-sample.xlsx');

describe('amazonVentasParser', () => {
  it('parses 9 rows with ASIN as portalRawProduct and null store', async () => {
    const buffer = await readFile(SAMPLE);
    const result = await amazonVentasParser.parse({ buffer, fileType: 'VENTAS', originalFilename: 'amazon-ventas-sample.xlsx' });
    expect(result.rows).toEqual(AMAZON_VENTAS_EXPECTED);
    expect(result.metadata.chain).toBe('AMAZON');
    expect(result.metadata.fileType).toBe('VENTAS');
  });
});
```

- [ ] **Step 3: Run test — fails**

```bash
pnpm test tests/parsers/amazon-ventas.test.ts
```
Expected: FAIL.

- [ ] **Step 4: Implement `core/parsers/amazon-ventas.ts`**

```typescript
// core/parsers/amazon-ventas.ts
import { createHash } from 'node:crypto';
import * as XLSX from 'xlsx';
import type { Chain, FileType } from '@prisma/client';
import type { ParsedRow, ParserResult, PortalParser } from './types';

export const amazonVentasParser: PortalParser = {
  chain: 'AMAZON' as Chain,
  supportedFileTypes: ['VENTAS' as FileType],

  async parse({ buffer, fileType, originalFilename }) {
    const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });

    const rows: ParsedRow[] = [];
    const warnings: ParserResult['warnings'] = [];

    for (let i = 0; i < raw.length; i++) {
      const r = raw[i];
      try {
        const periodo = r['PERIODO'];
        if (!(periodo instanceof Date)) throw new Error(`PERIODO is not a Date: ${typeof periodo}`);
        const row: ParsedRow = {
          periodYear: periodo.getUTCFullYear(),
          periodMonth: periodo.getUTCMonth() + 1,
          portalRawProduct: String(r['ASIN']),
          storeId: null, storeName: null, storeFormat: null,
          salesUnits: Number(r['Unidades pedidas']),
        };
        rows.push(row);
      } catch (err) {
        warnings.push({ rowIndex: i + 1, message: (err as Error).message });
      }
    }

    const fileHash = createHash('sha256').update(buffer).digest('hex');
    return {
      metadata: { chain: 'AMAZON' as Chain, fileType, originalFilename, fileHash, fileSizeBytes: buffer.length, rowCount: rows.length },
      rows, warnings,
    };
  },
};
```

- [ ] **Step 5: Run test — pass**

```bash
pnpm test tests/parsers/amazon-ventas.test.ts
```
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add core/parsers/amazon-ventas.ts tests/parsers/amazon-ventas.test.ts tests/fixtures/amazon-ventas-expected.ts
git commit -m "feat(parser): add Amazon Ventas xlsx parser"
```

---

### Task S5 — Parser Amazon Inventario

**Tipo:** Sprint (TDD).
**Estimado:** 1h.
**Spec ref:** §3.3 Amazon Inventario.
**Upstream deps:** S0, S1.
**Downstream deps:** S7.
**Paraleliza con:** S2, S3, S4.
**Binary pass:** `pnpm test tests/parsers/amazon-inv.test.ts` pasa.

**Files:**
- Create: `core/parsers/amazon-inv.ts`.
- Create: `tests/parsers/amazon-inv.test.ts`.
- Create: `tests/fixtures/amazon-inv-expected.ts`.

- [ ] **Step 1: Crear fixture esperada**

Análogo a Amazon Ventas, 9 rows con `inventoryUnits` en lugar de `salesUnits`. Valores: `B0D22Y7LZR=338, B0D22YBT7P=251, B0D22Y6YSN=193, B0D22ZDV47=117, B0BPK3BGDB=233, B0D22ZP6RB=126, B0BPK41TLJ=203, B0D22Z7BV7=244, B0BPK34LCW=127`.

- [ ] **Step 2: Write failing test** análogo a S4, importando `amazonInvParser` y assertion `inventoryUnits` matches fixture.

- [ ] **Step 3: Run — fails.**

```bash
pnpm test tests/parsers/amazon-inv.test.ts
```

- [ ] **Step 4: Implement `core/parsers/amazon-inv.ts`**

Análogo a Amazon Ventas con dos diferencias:
- `supportedFileTypes: ['INVENTARIO' as FileType]`.
- En el loop: `inventoryUnits: Number(r['Unidades aptas para la venta disponibles'])` en lugar de `salesUnits`.
- Ignorar columna trailing nula (sheet_to_json ya la descarta si está vacía; verificar).

- [ ] **Step 5: Run — pass.**

```bash
pnpm test tests/parsers/amazon-inv.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add core/parsers/amazon-inv.ts tests/parsers/amazon-inv.test.ts tests/fixtures/amazon-inv-expected.ts
git commit -m "feat(parser): add Amazon Inventario xlsx parser"
```

---

### Task S6 — Catalog Excel importer

**Tipo:** Sprint (TDD).
**Estimado:** 2h.
**Spec ref:** §5.2 (formato Excel importable), §5.3 (pseudocódigo importer).
**Upstream deps:** S1.
**Downstream deps:** S7 (uses ProductMapping), S10 (seed lo invoca), S12 (API route `/api/catalog/import`).
**Binary pass:** `pnpm test tests/catalog/import.test.ts` pasa.

**Files:**
- Create: `core/catalog/import.ts`.
- Create: `tests/catalog/import.test.ts`.

- [ ] **Step 1: Definir tipos e interfaz**

`core/catalog/import.ts`:

```typescript
import * as XLSX from 'xlsx';
import type { PrismaClient, Chain } from '@prisma/client';

export type CatalogImportResult = {
  productsCreated: number;
  productsExisting: number;
  mappingsCreated: number;
  mappingsSkippedDuplicate: number;
  warnings: string[];
};

const CHAIN_HEADER_MAP: Record<string, Chain> = {
  'AL SUPER': 'AL_SUPER',
  'AMAZON': 'AMAZON',
  'CHEDRAUI': 'CHEDRAUI',
  'HEB': 'HEB',
  'LA COMER': 'LA_COMER',
  'SORIANA': 'SORIANA',
};

const STANDARD_HEADERS = ['Producto VIKS', 'Producto'] as const;

export async function importCatalog(
  input: { clientId: string; fileBuffer: Buffer },
  db: PrismaClient,
): Promise<CatalogImportResult> {
  const wb = XLSX.read(input.fileBuffer, { type: 'buffer' });
  const sheet = wb.Sheets['Catalogo_Producto'];
  if (!sheet) throw new Error('Sheet "Catalogo_Producto" not found');

  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });
  const stats: CatalogImportResult = {
    productsCreated: 0, productsExisting: 0,
    mappingsCreated: 0, mappingsSkippedDuplicate: 0,
    warnings: [],
  };

  // Detect standard column header
  const firstRow = rows[0] ?? {};
  const standardHeader = STANDARD_HEADERS.find(h => h in firstRow);
  if (!standardHeader) throw new Error(`No standard column header found. Expected one of: ${STANDARD_HEADERS.join(', ')}`);

  // Collect chain headers and warn about unknown ones
  const chainColumns: Array<{ header: string; chain: Chain }> = [];
  for (const key of Object.keys(firstRow)) {
    if (key === standardHeader) continue;
    const upper = key.trim().toUpperCase();
    if (upper in CHAIN_HEADER_MAP) chainColumns.push({ header: key, chain: CHAIN_HEADER_MAP[upper] });
    else stats.warnings.push(`Ignoring unknown chain column header: "${key}"`);
  }

  for (const r of rows) {
    const nameStandard = String(r[standardHeader] ?? '').trim();
    if (!nameStandard) continue;

    const existing = await db.product.findUnique({
      where: { clientId_nameStandard: { clientId: input.clientId, nameStandard } },
    });
    let productId: string;
    if (existing) { stats.productsExisting++; productId = existing.id; }
    else {
      const created = await db.product.create({ data: { clientId: input.clientId, nameStandard } });
      stats.productsCreated++;
      productId = created.id;
    }

    for (const { header, chain } of chainColumns) {
      const portalString = r[header];
      if (portalString === null || portalString === undefined || portalString === '') continue;
      const portalStringStr = String(portalString).trim();
      try {
        await db.productMapping.create({
          data: { clientId: input.clientId, productId, chain, portalString: portalStringStr },
        });
        stats.mappingsCreated++;
      } catch (err: any) {
        if (err.code === 'P2002') {
          stats.mappingsSkippedDuplicate++;
          stats.warnings.push(`Duplicate mapping skipped: client=${input.clientId} chain=${chain} portalString="${portalStringStr}"`);
        } else throw err;
      }
    }
  }

  return stats;
}
```

- [ ] **Step 2: Write failing test**

`tests/catalog/import.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { importCatalog } from '@/core/catalog/import';

const CATALOG_PATH = resolve(__dirname, '../../docs/specs/viks-data/catalogo-productos.xlsx');
const db = new PrismaClient();

describe('importCatalog (against real catalogo-productos.xlsx)', () => {
  let clientId: string;

  beforeAll(async () => {
    const user = await db.user.create({ data: { email: 'test-import@example.com', passwordHash: 'x', name: 'test' } });
    const client = await db.client.create({ data: { name: 'TEST IMPORT VIKS', userId: user.id } });
    clientId = client.id;
  });

  afterAll(async () => {
    await db.user.deleteMany({ where: { email: 'test-import@example.com' } });
    await db.$disconnect();
  });

  it('imports 16 products and the expected mappings, warning on the known AL SUPER duplicate', async () => {
    const buf = await readFile(CATALOG_PATH);
    const stats = await importCatalog({ clientId, fileBuffer: buf }, db);
    expect(stats.productsCreated).toBe(16);
    expect(stats.mappingsCreated).toBeGreaterThan(20);
    expect(stats.mappingsSkippedDuplicate).toBe(1);
    expect(stats.warnings.some(w => w.includes('CITRUS GINGER VIKS JERKY 100 GRAMOS'))).toBe(true);
  });
});
```

- [ ] **Step 3: Run — fails (module not found).**

```bash
pnpm test tests/catalog/import.test.ts
```

- [ ] **Step 4: Implementación ya escrita en Step 1.** Re-run:

```bash
pnpm test tests/catalog/import.test.ts
```
Expected: PASS.

> Si falla en `productsCreated=16` con 15 o 17: verificar el sample del catálogo. El conteo viene del README §catalogo y del sample real (16 filas de productos en sheet `Catalogo_Producto`).

- [ ] **Step 5: Commit**

```bash
git add core/catalog/import.ts tests/catalog/import.test.ts
git commit -m "feat(catalog): add Excel importer for VIKS pivoteado format with duplicate warning"
```

---

### Task S9 — Alert classifier (independiente)

**Tipo:** Sprint (TDD).
**Estimado:** 0.5h.
**Spec ref:** §9.2 (`classifyAlert` y SQL CASE).
**Upstream deps:** S0.
**Downstream deps:** S8 (KPI queries usan los thresholds), S12, G4.
**Paraleliza con:** S2-S6.
**Binary pass:** `pnpm test tests/alerts/classify.test.ts` pasa.

**Files:**
- Create: `core/alerts/classify.ts`.
- Create: `tests/alerts/classify.test.ts`.

- [ ] **Step 1: Write failing test**

```typescript
// tests/alerts/classify.test.ts
import { describe, it, expect } from 'vitest';
import { classifyAlert } from '@/core/alerts/classify';

describe('classifyAlert', () => {
  it.each([
    [0, null, 'SIN_STOCK'],
    [0, 5, 'SIN_STOCK'],
    [10, null, 'SIN_DATOS'],
    [10, 3, 'CRITICO'],
    [10, 6, 'CRITICO'],
    [10, 7, 'RIESGO'],
    [10, 13, 'RIESGO'],
    [10, 14, 'ATENCION'],
    [10, 20, 'ATENCION'],
    [10, 21, 'OK'],
    [10, 60, 'OK'],
    [10, 61, 'EXCESO'],
    [10, 1000, 'EXCESO'],
  ])('inv=%s, days=%s → %s', (inv, days, expected) => {
    expect(classifyAlert(inv as number, days as number | null)).toBe(expected);
  });
});
```

- [ ] **Step 2: Run — fails.**

- [ ] **Step 3: Implement (copiar literal del spec §9.2)**

```typescript
// core/alerts/classify.ts
export type AlertStatus =
  | 'SIN_STOCK' | 'CRITICO' | 'RIESGO' | 'ATENCION' | 'OK' | 'EXCESO' | 'SIN_DATOS';

export function classifyAlert(inventoryUnits: number | null, daysOfInventory: number | null): AlertStatus {
  if (inventoryUnits === 0) return 'SIN_STOCK';
  if (daysOfInventory === null) return 'SIN_DATOS';
  if (daysOfInventory < 7) return 'CRITICO';
  if (daysOfInventory < 14) return 'RIESGO';
  if (daysOfInventory < 21) return 'ATENCION';
  if (daysOfInventory <= 60) return 'OK';
  return 'EXCESO';
}
```

- [ ] **Step 4: Run — pass.**

- [ ] **Step 5: Commit**

```bash
git add core/alerts/classify.ts tests/alerts/classify.test.ts
git commit -m "feat(alerts): classifier with thresholds per spec §9.2"
```

---

### Task S7 — Normalizer + UPSERT raw SQL + unmapped tracking

**Tipo:** Sprint (TDD).
**Estimado:** 4h.
**Spec ref:** §2.3 (UPSERT con COALESCE), §4 (normalizer contract), §4.2 responsabilidades (RESPETAR el cambio del AJUSTE 1 — NO calcular daysOfInventory al insert), §4.3 pseudocódigo, §4.4 backfill.
**Upstream deps:** S1, S2 (o cualquier parser, para emitir ParserResult de input).
**Downstream deps:** S10, S12, G4, G5.
**Binary pass:** `pnpm test tests/normalizer/normalize.test.ts` pasa.

**Files:**
- Create: `core/normalizer/types.ts`.
- Create: `core/normalizer/upsert.ts`.
- Create: `core/normalizer/index.ts`.
- Create: `tests/normalizer/normalize.test.ts`.

- [ ] **Step 1: Crear `core/normalizer/types.ts`** copiando del spec §4.1.

- [ ] **Step 2: Crear `core/normalizer/upsert.ts`** con la raw SQL del spec §2.3.

```typescript
// core/normalizer/upsert.ts
import type { Prisma, Chain } from '@prisma/client';
import { randomUUID } from 'node:crypto';

export type SelloutRowInput = {
  clientId: string; userId: string; uploadId: string;
  chain: Chain;
  productId: string | null;
  periodYear: number; periodMonth: number; periodDate: Date | null;
  portalRawProduct: string;
  storeId: string | null; storeName: string | null; storeFormat: string | null;
  salesUnits?: number; salesUnitsEstimated?: boolean; salesAmountMxn?: number;
  purchasesUnits?: number; purchasesAmountMxn?: number;
  inventoryUnits?: number; inventoryAmountCostMxn?: number; inventoryAmountPriceMxn?: number;
  daysOfInventory: number | null;
};

export async function upsertSelloutRow(
  tx: Prisma.TransactionClient,
  row: SelloutRowInput,
): Promise<{ action: 'inserted' | 'updated' }> {
  const id = `c${randomUUID().replace(/-/g, '').slice(0, 24)}`;
  const result = await tx.$queryRaw<Array<{ inserted_flag: boolean }>>`
    INSERT INTO "SelloutData" (
      id, "clientId", "userId", "uploadId",
      "periodYear", "periodMonth", "periodDate",
      chain, "productId", "portalRawProduct",
      "storeId", "storeName", "storeFormat",
      "salesUnits", "salesUnitsEstimated", "salesAmountMxn",
      "purchasesUnits", "purchasesAmountMxn",
      "inventoryUnits", "inventoryAmountCostMxn", "inventoryAmountPriceMxn",
      "daysOfInventory", "createdAt", "updatedAt"
    ) VALUES (
      ${id}, ${row.clientId}, ${row.userId}, ${row.uploadId},
      ${row.periodYear}, ${row.periodMonth}, ${row.periodDate},
      ${row.chain}::"Chain", ${row.productId}, ${row.portalRawProduct},
      ${row.storeId}, ${row.storeName}, ${row.storeFormat},
      ${row.salesUnits ?? null}, ${row.salesUnitsEstimated ?? false}, ${row.salesAmountMxn ?? null},
      ${row.purchasesUnits ?? null}, ${row.purchasesAmountMxn ?? null},
      ${row.inventoryUnits ?? null}, ${row.inventoryAmountCostMxn ?? null}, ${row.inventoryAmountPriceMxn ?? null},
      ${row.daysOfInventory}, NOW(), NOW()
    )
    ON CONFLICT ON CONSTRAINT sellout_unique_idx DO UPDATE SET
      "uploadId"               = EXCLUDED."uploadId",
      "productId"              = COALESCE(EXCLUDED."productId", "SelloutData"."productId"),
      "storeName"              = COALESCE(EXCLUDED."storeName", "SelloutData"."storeName"),
      "storeFormat"            = COALESCE(EXCLUDED."storeFormat", "SelloutData"."storeFormat"),
      "salesUnits"             = COALESCE(EXCLUDED."salesUnits", "SelloutData"."salesUnits"),
      "salesUnitsEstimated"    = EXCLUDED."salesUnitsEstimated" OR "SelloutData"."salesUnitsEstimated",
      "salesAmountMxn"         = COALESCE(EXCLUDED."salesAmountMxn", "SelloutData"."salesAmountMxn"),
      "purchasesUnits"         = COALESCE(EXCLUDED."purchasesUnits", "SelloutData"."purchasesUnits"),
      "purchasesAmountMxn"     = COALESCE(EXCLUDED."purchasesAmountMxn", "SelloutData"."purchasesAmountMxn"),
      "inventoryUnits"         = COALESCE(EXCLUDED."inventoryUnits", "SelloutData"."inventoryUnits"),
      "inventoryAmountCostMxn" = COALESCE(EXCLUDED."inventoryAmountCostMxn", "SelloutData"."inventoryAmountCostMxn"),
      "inventoryAmountPriceMxn"= COALESCE(EXCLUDED."inventoryAmountPriceMxn", "SelloutData"."inventoryAmountPriceMxn"),
      "daysOfInventory"        = COALESCE(EXCLUDED."daysOfInventory", "SelloutData"."daysOfInventory"),
      "periodDate"             = COALESCE(EXCLUDED."periodDate", "SelloutData"."periodDate"),
      "updatedAt"              = NOW()
    RETURNING (xmax = 0) AS inserted_flag;
  `;
  return { action: result[0].inserted_flag ? 'inserted' : 'updated' };
}

export async function upsertUnmapped(
  tx: Prisma.TransactionClient,
  clientId: string,
  chain: Chain,
  portalString: string,
  uploadId: string,
): Promise<{ isNew: boolean }> {
  const existing = await tx.unmappedProduct.findUnique({
    where: { clientId_chain_portalString: { clientId, chain, portalString } },
  });
  if (existing) {
    await tx.unmappedProduct.update({
      where: { id: existing.id },
      data: { occurrenceCount: existing.occurrenceCount + 1 },
    });
    return { isNew: false };
  }
  await tx.unmappedProduct.create({
    data: { clientId, chain, portalString, firstSeenUploadId: uploadId, occurrenceCount: 1 },
  });
  return { isNew: true };
}
```

- [ ] **Step 3: Crear `core/normalizer/index.ts`** con el pseudocódigo del spec §4.3 (RESPETANDO el AJUSTE 1: `daysOfInventory = row.daysOfInventory ?? null`).

```typescript
// core/normalizer/index.ts
import type { PrismaClient } from '@prisma/client';
import type { NormalizationInput, NormalizationStats } from './types';
import { upsertSelloutRow, upsertUnmapped } from './upsert';

export async function normalize(input: NormalizationInput, db: PrismaClient): Promise<NormalizationStats> {
  const { clientId, userId, uploadId, parserResult, mappingLookup } = input;
  const stats: NormalizationStats = {
    rowsTotal: parserResult.rows.length,
    rowsInserted: 0, rowsUpdated: 0, rowsUnmapped: 0, newUnmappedProducts: 0,
    warnings: parserResult.warnings.map(w => `r${w.rowIndex}: ${w.message}`),
  };

  await db.$transaction(async (tx) => {
    for (const row of parserResult.rows) {
      const productId = mappingLookup(parserResult.metadata.chain, row.portalRawProduct);
      const daysInv = row.daysOfInventory ?? null;
      const result = await upsertSelloutRow(tx, {
        clientId, userId, uploadId,
        chain: parserResult.metadata.chain,
        productId,
        periodYear: row.periodYear,
        periodMonth: row.periodMonth,
        periodDate: row.periodDate ?? null,
        portalRawProduct: row.portalRawProduct,
        storeId: row.storeId, storeName: row.storeName, storeFormat: row.storeFormat,
        salesUnits: row.salesUnits, salesUnitsEstimated: row.salesUnitsEstimated, salesAmountMxn: row.salesAmountMxn,
        purchasesUnits: row.purchasesUnits, purchasesAmountMxn: row.purchasesAmountMxn,
        inventoryUnits: row.inventoryUnits, inventoryAmountCostMxn: row.inventoryAmountCostMxn, inventoryAmountPriceMxn: row.inventoryAmountPriceMxn,
        daysOfInventory: daysInv,
      });
      if (result.action === 'inserted') stats.rowsInserted++;
      else stats.rowsUpdated++;

      if (productId === null) {
        stats.rowsUnmapped++;
        const u = await upsertUnmapped(tx, clientId, parserResult.metadata.chain, row.portalRawProduct, uploadId);
        if (u.isNew) stats.newUnmappedProducts++;
      }
    }
  }, { timeout: 30_000 });

  return stats;
}
```

- [ ] **Step 4: Write failing test**

`tests/normalizer/normalize.test.ts` — orquesta parser real (Soriana) + DB real + mappingLookup en memoria. Verifica:
- Después de 1 upload: `rowsInserted == 60, rowsUpdated == 0, rowsUnmapped` consistente con cuántos rows de Soriana NO están mapeados en el catálogo VIKS.
- Después de re-upload del mismo archivo: `rowsInserted == 0, rowsUpdated == 60`.
- Después de un upload solo-inventario que llega después de un upload solo-ventas para las mismas filas: el campo de inventario NO sobrescribe ventas (verifica COALESCE).

Esqueleto:

```typescript
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { PrismaClient, type Chain } from '@prisma/client';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { sorianaParser } from '@/core/parsers/soriana';
import { normalize } from '@/core/normalizer';

const db = new PrismaClient();

describe('normalize (Soriana sample, idempotent UPSERT)', () => {
  let clientId: string; let userId: string; let uploadId: string;

  beforeAll(async () => {
    const u = await db.user.create({ data: { email: 'test-norm@example.com', passwordHash: 'x' } });
    userId = u.id;
    const c = await db.client.create({ data: { name: 'TEST NORM', userId } });
    clientId = c.id;
  });
  afterAll(async () => {
    await db.user.deleteMany({ where: { email: 'test-norm@example.com' } });
    await db.$disconnect();
  });
  beforeEach(async () => {
    await db.selloutData.deleteMany({ where: { clientId } });
    await db.unmappedProduct.deleteMany({ where: { clientId } });
    await db.upload.deleteMany({ where: { clientId } });
    const up = await db.upload.create({
      data: { clientId, userId, chain: 'SORIANA' as Chain, fileType: 'MIXED', originalFilename: 'test.xlsx', fileHash: 'x', fileSizeBytes: 0 },
    });
    uploadId = up.id;
  });

  it('inserts 60 rows, all unmapped if catalog is empty', async () => {
    const buf = await readFile(resolve(__dirname, '../../docs/specs/viks-data/samples/soriana-sample.xlsx'));
    const parsed = await sorianaParser.parse({ buffer: buf, fileType: 'MIXED', originalFilename: 'soriana.xlsx' });
    const stats = await normalize({ clientId, userId, uploadId, parserResult: parsed, mappingLookup: () => null }, db);
    expect(stats.rowsTotal).toBe(60);
    expect(stats.rowsInserted).toBe(60);
    expect(stats.rowsUpdated).toBe(0);
    expect(stats.rowsUnmapped).toBe(60);
  });

  it('on re-upload, updates 60 rows and inserts 0', async () => {
    const buf = await readFile(resolve(__dirname, '../../docs/specs/viks-data/samples/soriana-sample.xlsx'));
    const parsed = await sorianaParser.parse({ buffer: buf, fileType: 'MIXED', originalFilename: 'soriana.xlsx' });
    await normalize({ clientId, userId, uploadId, parserResult: parsed, mappingLookup: () => null }, db);
    const stats = await normalize({ clientId, userId, uploadId, parserResult: parsed, mappingLookup: () => null }, db);
    expect(stats.rowsInserted).toBe(0);
    expect(stats.rowsUpdated).toBe(60);
  });
});
```

- [ ] **Step 5: Run — fails (normalize not implemented o falla en UPSERT).** Iterar hasta pasar.

```bash
pnpm test tests/normalizer/normalize.test.ts
```

- [ ] **Step 6: Run all parser + normalizer tests para verificar regresión cero.**

```bash
pnpm test
```
Expected: ALL PASS.

- [ ] **Step 7: Commit**

```bash
git add core/normalizer/ tests/normalizer/
git commit -m "feat(normalizer): UPSERT with COALESCE per field, unmapped tracking, idempotent re-uploads"
```

---

### Task S8 — KPI compute + queries

**Tipo:** Sprint (TDD).
**Estimado:** 2h.
**Spec ref:** §9.1 KPIs del Dashboard, §9.2 SQL con CASE.
**Upstream deps:** S1, S7 (necesita data en `SelloutData` para tests).
**Downstream deps:** S12, G4.
**Binary pass:** `pnpm test tests/kpis/queries.test.ts` pasa.

**Files:**
- Create: `core/kpis/queries.ts` (funciones que devuelven los 4 KPI cards + datasets de los 5 charts).
- Create: `tests/kpis/queries.test.ts`.

- [ ] **Step 1: Definir interfaces**

```typescript
// core/kpis/queries.ts
import type { PrismaClient, Chain } from '@prisma/client';
import type { AlertStatus } from '../alerts/classify';

export type DashboardKpis = {
  salesAmountMxn: number;
  variationPct: number | null;
  salesUnits: number;
  activeAlertsSkuCount: number;
};

export type ChainSalesPoint = { chain: Chain; periodYear: number; periodMonth: number; salesAmountMxn: number; salesUnits: number };
export type SkuInventoryStatus = { productId: string | null; productName: string; chain: Chain; alert: AlertStatus };

export async function getDashboardKpis(db: PrismaClient, params: { clientId: string; userId: string; periodYear: number; periodMonth: number }): Promise<DashboardKpis> { /* impl */ throw new Error('NYI'); }
export async function getSalesTrend(db: PrismaClient, params: { clientId: string; userId: string; monthsBack: number }): Promise<ChainSalesPoint[]> { throw new Error('NYI'); }
export async function getSalesByChainForPeriod(db: PrismaClient, params: { clientId: string; userId: string; periodYear: number; periodMonth: number }): Promise<{ chain: Chain; salesAmountMxn: number; salesUnits: number }[]> { throw new Error('NYI'); }
export async function getInventorySemaforo(db: PrismaClient, params: { clientId: string; userId: string; periodYear: number; periodMonth: number }): Promise<SkuInventoryStatus[]> { throw new Error('NYI'); }
export async function getTopSkusByChain(db: PrismaClient, params: { clientId: string; userId: string; periodYear: number; periodMonth: number; limit: number }): Promise<{ chain: Chain; productName: string; salesUnits: number }[]> { throw new Error('NYI'); }
export async function getDaysOfInventoryBySku(db: PrismaClient, params: { clientId: string; userId: string; periodYear: number; periodMonth: number }): Promise<{ productName: string; chain: Chain; daysOfInventory: number | null }[]> { throw new Error('NYI'); }
```

- [ ] **Step 2: Write tests con fixtures sintéticas**

`tests/kpis/queries.test.ts` — sembrar manualmente 6-10 rows en `SelloutData` con casos borde (sales=0, todo NULL, mix de cadenas) y verificar que cada función devuelve lo esperado. Casos críticos:
- Variación % = NULL cuando no hay mes anterior.
- Excluir rows con `salesAmountMxn IS NULL` del total MXN.
- `daysOfInventory` se calcula al query con `CASE WHEN salesUnits > 0 THEN ...` (AJUSTE 1).
- Alert status derivado al query con el CASE del spec §9.2.

- [ ] **Step 3: Run — fail.**

- [ ] **Step 4: Implementar cada función con `db.$queryRaw` (SQL del spec §9.2).** Iterar hasta pasar tests.

- [ ] **Step 5: Run all tests.**

```bash
pnpm test
```

- [ ] **Step 6: Commit**

```bash
git add core/kpis/ tests/kpis/
git commit -m "feat(kpis): dashboard KPI queries with alert classification at query time"
```

---

### Task S10 — Seed script (estático puro)

**Tipo:** Sprint.
**Estimado:** 1h.
**Spec ref:** §6.1 (seed script), §6.3 (demo flow referencia).
**Upstream deps:** S1, S6 (`importCatalog`).
**Downstream deps:** S11, CP2.
**Binary pass:** `pnpm db:reset` corre sin error, deja DB con counts exactos: 1 user, 1 client, 16 products, ≥27 product_mappings (16 productos × promedio 1.7 cadenas non-null), 6 portal_credentials, 0 sellout_data, 0 unmapped_products, 0 uploads.

**Files:**
- Create: `scripts/seed.ts`.

- [ ] **Step 1: Implementar `scripts/seed.ts`** siguiendo §6.1 paso a paso.

```typescript
// scripts/seed.ts
import { PrismaClient, type Chain } from '@prisma/client';
import { hash } from 'bcryptjs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { importCatalog } from '../core/catalog/import';

const db = new PrismaClient();
const ALL_CHAINS: Chain[] = ['SORIANA', 'CHEDRAUI', 'HEB', 'AL_SUPER', 'LA_COMER', 'AMAZON'];

async function main() {
  if (process.env.NODE_ENV === 'production' && !process.argv.includes('--force')) {
    throw new Error('Refusing to seed production without --force');
  }

  console.log('Truncating tables…');
  await db.$executeRawUnsafe(`
    TRUNCATE TABLE "SelloutData", "UnmappedProduct", "Upload",
                   "ProductMapping", "Product", "PortalCredential",
                   "Client", "User"
    RESTART IDENTITY CASCADE;
  `);

  console.log('Creating demo user + client…');
  const user = await db.user.create({
    data: {
      email: 'demo@onetable.app',
      passwordHash: await hash('demo1234', 10),
      name: 'Demo VIKS',
    },
  });
  const client = await db.client.create({ data: { name: 'VIKS Jerky Co.', userId: user.id } });

  console.log('Importing catalogo-productos.xlsx…');
  const catalogPath = resolve(__dirname, '../docs/specs/viks-data/catalogo-productos.xlsx');
  const buf = await readFile(catalogPath);
  const stats = await importCatalog({ clientId: client.id, fileBuffer: buf }, db);
  console.log('Catalog import:', stats);

  console.log('Creating PortalCredential rows for all 6 chains…');
  for (const chain of ALL_CHAINS) {
    await db.portalCredential.create({
      data: {
        clientId: client.id, chain,
        username: chain === 'AMAZON' ? 'viks-demo@example.com' : 'viks-demo',
        isActive: true, hasPasswordPending: true,
      },
    });
  }

  const counts = {
    users: await db.user.count(),
    clients: await db.client.count(),
    products: await db.product.count(),
    mappings: await db.productMapping.count(),
    portalCredentials: await db.portalCredential.count(),
    selloutData: await db.selloutData.count(),
  };
  console.log('Seed complete:', counts);
  console.log('SelloutData empty intentionally — upload via /analisis during demo.');
}

main().finally(() => db.$disconnect());
```

- [ ] **Step 2: Run seed contra DB local/Neon**

```bash
pnpm db:reset
```

Expected: ejecuta migration reset + seed automático (vía `prisma.seed` hook), termina en <10s, imprime los counts esperados.

- [ ] **Step 3: Verificar counts vía psql**

```bash
pnpm dlx prisma db execute --stdin <<'SQL'
SELECT
  (SELECT count(*) FROM "User") AS users,
  (SELECT count(*) FROM "Client") AS clients,
  (SELECT count(*) FROM "Product") AS products,
  (SELECT count(*) FROM "ProductMapping") AS mappings,
  (SELECT count(*) FROM "PortalCredential") AS portal_creds,
  (SELECT count(*) FROM "SelloutData") AS sellout;
SQL
```

Expected: `users=1, clients=1, products=16, mappings≥27, portal_creds=6, sellout=0`.

- [ ] **Step 4: Commit**

```bash
git add scripts/seed.ts package.json
git commit -m "feat(seed): static demo seed (user+client+catalog+portal_creds), no parser execution"
```

---

### Task S11 — Pre-flight harness

**Tipo:** Sprint.
**Estimado:** 1h.
**Spec ref:** §6.2.
**Upstream deps:** S10 (seed corre primero), S2-S5 (parsers), S7 (normalizer).
**Downstream deps:** CP2.
**Binary pass:** `pnpm preflight` retorna exit code 0 contra `PREFLIGHT_DATABASE_URL`.

**Files:**
- Create: `scripts/preflight.ts`.

- [ ] **Step 1: Implementar el script** según spec §6.2 paso a paso.

```typescript
// scripts/preflight.ts
import { PrismaClient } from '@prisma/client';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { sorianaParser } from '../core/parsers/soriana';
import { chedrauiParser } from '../core/parsers/chedraui';
import { amazonVentasParser } from '../core/parsers/amazon-ventas';
import { amazonInvParser } from '../core/parsers/amazon-inv';
import { normalize } from '../core/normalizer';

const PREFLIGHT_URL = process.env.PREFLIGHT_DATABASE_URL;
if (!PREFLIGHT_URL) {
  console.error('PREFLIGHT_DATABASE_URL not set.');
  process.exit(1);
}
process.env.DATABASE_URL = PREFLIGHT_URL;

const db = new PrismaClient();
const SAMPLES = resolve(__dirname, '../docs/specs/viks-data/samples');

type Expect = { chain: string; fileType: 'MIXED' | 'VENTAS' | 'INVENTARIO'; file: string; parser: any; expectedRows: number };

const UPLOADS: Expect[] = [
  { chain: 'SORIANA', fileType: 'MIXED', file: 'soriana-sample.xlsx', parser: sorianaParser, expectedRows: 60 },
  { chain: 'CHEDRAUI', fileType: 'MIXED', file: 'chedraui-sample.xlsx', parser: chedrauiParser, expectedRows: 40 },
  { chain: 'AMAZON', fileType: 'VENTAS', file: 'amazon-ventas-sample.xlsx', parser: amazonVentasParser, expectedRows: 9 },
  { chain: 'AMAZON', fileType: 'INVENTARIO', file: 'amazon-inv-sample.xlsx', parser: amazonInvParser, expectedRows: 9 },
];

async function main() {
  console.log('Pre-flight: reset DB + seed…');
  // Asume que prisma migrate deploy + db:seed se ejecutaron antes via Makefile o por el operador.
  // Aquí solo validamos parsing + normalize.

  const client = await db.client.findFirstOrThrow({ where: { name: 'VIKS Jerky Co.' } });
  const user = await db.user.findFirstOrThrow({ where: { email: 'demo@onetable.app' } });
  const mappings = await db.productMapping.findMany({ where: { clientId: client.id } });
  const lookup = new Map(mappings.map(m => [`${m.chain}:${m.portalString}`, m.productId]));

  let failed = 0;
  for (const u of UPLOADS) {
    const buf = await readFile(resolve(SAMPLES, u.file));
    const parsed = await u.parser.parse({ buffer: buf, fileType: u.fileType, originalFilename: u.file });
    if (parsed.rows.length !== u.expectedRows) {
      console.error(`✗ ${u.file}: expected ${u.expectedRows} rows, got ${parsed.rows.length}`);
      failed++; continue;
    }
    const upload = await db.upload.create({
      data: { clientId: client.id, userId: user.id, chain: u.chain as any, fileType: u.fileType, originalFilename: u.file, fileHash: 'preflight', fileSizeBytes: buf.length },
    });
    const stats = await normalize({
      clientId: client.id, userId: user.id, uploadId: upload.id,
      parserResult: parsed,
      mappingLookup: (chain, portalString) => lookup.get(`${chain}:${portalString}`) ?? null,
    }, db);
    console.log(`✓ ${u.file}: ${stats.rowsInserted} inserted, ${stats.rowsUpdated} updated, ${stats.rowsUnmapped} unmapped`);
  }

  const total = await db.selloutData.count({ where: { clientId: client.id } });
  const unmapped = await db.unmappedProduct.count({ where: { clientId: client.id } });
  console.log(`Final: ${total} sellout rows, ${unmapped} unmapped products.`);

  if (failed > 0) { console.error(`Pre-flight FAILED: ${failed} parser mismatches.`); process.exit(1); }
  console.log('Pre-flight PASSED.');
}

main().finally(() => db.$disconnect());
```

- [ ] **Step 2: Crear segunda branch de Neon para preflight** (manual, via Neon dashboard). Capturar la URL en `PREFLIGHT_DATABASE_URL` en `.env.local`.

- [ ] **Step 3: Ejecutar end-to-end**

```bash
PREFLIGHT_DATABASE_URL="$PREFLIGHT_DATABASE_URL" pnpm dlx prisma migrate deploy
PREFLIGHT_DATABASE_URL="$PREFLIGHT_DATABASE_URL" pnpm db:seed
PREFLIGHT_DATABASE_URL="$PREFLIGHT_DATABASE_URL" pnpm preflight
```

Expected: exit code 0, log line `Pre-flight PASSED.`

- [ ] **Step 4: Commit**

```bash
git add scripts/preflight.ts
git commit -m "feat(preflight): end-to-end harness for parsers + normalizer against PREFLIGHT_DATABASE_URL"
```

---

### Task S12 — API routes

**Tipo:** Sprint.
**Estimado:** 3h.
**Spec ref:** §0.5 (resumen post-upload), §4 (normalizer), §5 (catalog), §0.4 D7 (banner unmapped).
**Upstream deps:** S6, S7, S8, S9, S10 (lib/db).
**Downstream deps:** G1, G5, G6, G7, G4.
**Binary pass:** vitest contra Next.js test server. Cada endpoint retorna shape esperado.

**Files:**
- Create: `lib/auth.ts` (NextAuth config base, sin UI todavía — solo callbacks JWT).
- Create: `app/api/auth/[...nextauth]/route.ts`.
- Create: `app/api/clients/route.ts` (GET list, POST create).
- Create: `app/api/clients/[clientId]/route.ts` (GET, PATCH, DELETE).
- Create: `app/api/clients/[clientId]/catalog/import/route.ts` (POST file upload).
- Create: `app/api/clients/[clientId]/catalog/resolve-unmapped/route.ts` (POST `{unmappedId, productId}`).
- Create: `app/api/uploads/route.ts` (POST file + chain + fileType → trigger normalize).
- Create: `app/api/dashboard/kpis/route.ts` (GET con params periodYear, periodMonth, clientId).
- Create: `tests/api/uploads.test.ts`, `tests/api/clients.test.ts`, `tests/api/dashboard.test.ts`.

> **Subagent note:** este task es grande. Si lo ejecuta un subagente, dividir en sub-commits por endpoint. El verificador (test) debe correr al final con todos los endpoints implementados.

- [ ] **Step 1: NextAuth config base**

```typescript
// lib/auth.ts
import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { compare } from 'bcryptjs';
import { db } from './db';

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: 'jwt' },
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;
        const user = await db.user.findUnique({ where: { email: String(credentials.email) } });
        if (!user) return null;
        const ok = await compare(String(credentials.password), user.passwordHash);
        return ok ? { id: user.id, email: user.email, name: user.name ?? undefined } : null;
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) token.userId = user.id;
      return token;
    },
    async session({ session, token }) {
      if (token.userId) (session.user as any).id = token.userId;
      return session;
    },
  },
  pages: { signIn: '/login' },
});
```

- [ ] **Step 2: Route handler para NextAuth**

```typescript
// app/api/auth/[...nextauth]/route.ts
export { GET, POST } from '@/lib/auth';
import { handlers } from '@/lib/auth';
export const { GET, POST } = handlers;
```

- [ ] **Step 3: `app/api/clients/route.ts`** GET (lista clientes del user logueado) + POST (crea client con portal credentials opcionales y catalog Excel opcional).

- [ ] **Step 4: `app/api/clients/[clientId]/route.ts`** GET, PATCH, DELETE — siempre verificando `client.userId === session.user.id`.

- [ ] **Step 5: `app/api/clients/[clientId]/catalog/import/route.ts`** POST con FormData (file) → invoca `importCatalog` → retorna stats.

- [ ] **Step 6: `app/api/clients/[clientId]/catalog/resolve-unmapped/route.ts`** POST `{unmappedId, productId}` → crea ProductMapping + backfill SelloutData (spec §4.4).

- [ ] **Step 7: `app/api/uploads/route.ts`** POST FormData (file, chain, fileType, clientId) → invoca parser via registry + normalize → retorna NormalizationStats.

```typescript
// app/api/uploads/route.ts (esqueleto)
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { getParser } from '@/core/parsers';
import { normalize } from '@/core/normalizer';
import { createHash } from 'node:crypto';

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  const form = await req.formData();
  const file = form.get('file') as File;
  const clientId = String(form.get('clientId'));
  const chain = String(form.get('chain')) as any;
  const fileType = String(form.get('fileType')) as any;
  // ownership check
  const client = await db.client.findFirst({ where: { id: clientId, userId: (session.user as any).id } });
  if (!client) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

  const buffer = Buffer.from(await file.arrayBuffer());
  const fileHash = createHash('sha256').update(buffer).digest('hex');

  const parser = getParser(chain, fileType);
  const parsed = await parser.parse({ buffer, fileType, originalFilename: file.name });
  const upload = await db.upload.create({
    data: { clientId, userId: (session.user as any).id, chain, fileType, originalFilename: file.name, fileHash, fileSizeBytes: buffer.length },
  });
  const mappings = await db.productMapping.findMany({ where: { clientId, chain } });
  const lookup = new Map(mappings.map(m => [m.portalString, m.productId]));
  const stats = await normalize({
    clientId, userId: (session.user as any).id, uploadId: upload.id,
    parserResult: parsed,
    mappingLookup: (_c, portalString) => lookup.get(portalString) ?? null,
  }, db);
  await db.upload.update({
    where: { id: upload.id },
    data: { status: 'COMPLETED', processedAt: new Date(), rowsTotal: stats.rowsTotal, rowsInserted: stats.rowsInserted, rowsUpdated: stats.rowsUpdated, rowsUnmapped: stats.rowsUnmapped },
  });
  return NextResponse.json({ uploadId: upload.id, stats });
}
```

- [ ] **Step 8: `app/api/dashboard/kpis/route.ts`** GET con `?clientId=...&periodYear=...&periodMonth=...` → invoca todas las funciones de S8 → retorna `{ kpis, trend, byChain, semaforo, topSkus, daysInv }`.

- [ ] **Step 9: Tests por endpoint**

Cada test crea user+client+mappings via Prisma, monta el handler de Next como función (no servidor real), llama con `Request` mock, verifica shape de respuesta.

- [ ] **Step 10: Run all tests.**

```bash
pnpm test
```

- [ ] **Step 11: Commit**

```bash
git add lib/auth.ts app/api/ tests/api/
git commit -m "feat(api): clients CRUD, uploads, catalog import/resolve, dashboard KPIs"
```

---

### Task G1 — Auth UI

**Tipo:** Gate.
**Estimado:** 3h.
**Spec ref:** §7.2.1 G1 (checklist binaria de aprobación).
**Upstream deps:** G0 (Next.js + shadcn), S12 (NextAuth + API auth).

**Files:**
- Create: `app/(auth)/login/page.tsx`.
- Create: `app/(auth)/signup/page.tsx`.
- Create: `app/(auth)/layout.tsx` (layout sin sidebar, full-screen centrado).
- Create: `app/api/auth/signup/route.ts` (POST `{email, password, name}` → crea User).
- Modify: `middleware.ts` (proteger `/dashboard`, `/analisis`, `/clientes`, `/catalogo`, `/promotoria`).

- [ ] **Step 1: Crear `middleware.ts` en root del proyecto**

```typescript
// middleware.ts
import { auth } from '@/lib/auth';
import { NextResponse } from 'next/server';

const PROTECTED = ['/dashboard', '/analisis', '/clientes', '/catalogo', '/promotoria'];

export default auth((req) => {
  const isProtected = PROTECTED.some(p => req.nextUrl.pathname.startsWith(p));
  if (isProtected && !req.auth) {
    const url = new URL('/login', req.url);
    return NextResponse.redirect(url);
  }
});

export const config = { matcher: ['/((?!api|_next/static|_next/image|favicon.ico).*)'] };
```

- [ ] **Step 2: Crear `app/(auth)/layout.tsx`** layout simple centrado.

- [ ] **Step 3: Crear `app/(auth)/login/page.tsx`**

Form con email + password + Button "Iniciar sesión" + Button secundario "Probar demo" (auto-fills demo@onetable.app/demo1234 y submitea) + link a /signup.

- [ ] **Step 4: Crear `app/(auth)/signup/page.tsx`**

Form con email + password + confirm + Button "Crear cuenta" + link a /login. POST a `/api/auth/signup`. Email duplicado → error inline.

- [ ] **Step 5: Crear `app/api/auth/signup/route.ts`** POST con bcryptjs hash + db.user.create + redirect.

- [ ] **Step 6: Verificación manual (Gate checklist §7.2.1 G1)**

Recorrer cada checkbox del checklist G1 manualmente en `http://localhost:3000`:

- [ ] /login renderiza correctamente
- [ ] /signup renderiza correctamente
- [ ] Login con demo@onetable.app / demo1234 → redirige a /dashboard, cookie JWT seteada
- [ ] "Probar demo" auto-fill + submit
- [ ] Sign-up con email único → crea user + redirige a /dashboard
- [ ] Sign-up con email duplicado → error inline (no toast genérico)
- [ ] /dashboard sin sesión → redirect a /login
- [ ] Logout limpia cookie + redirect a /login

- [ ] **Step 7: Commit**

```bash
git add app/\(auth\)/ app/api/auth/signup/ middleware.ts
git commit -m "feat(auth): login + signup + demo button + JWT middleware (G1 ✓)"
```

---

### Task G2 — Layout shell (sidebar + topbar + theme)

**Tipo:** Gate.
**Estimado:** 2.5h (incluye G0 follow-ups en Step 0).
**Spec ref:** §7.2.1 G2 (checklist).
**Upstream deps:** G0, G1 (session disponible).

**Files (G0 follow-ups + new):**
- Modify: `app/globals.css` (fix emerald HSL + agregar tokens shadcn faltantes)
- Modify: `tailwind.config.ts` (agregar tokens shadcn + content paths lib/ core/)
- Modify: `package.json` (agregar typecheck script)
- Modify: `scripts/check-supply-chain.sh` (set -euo pipefail + quote vars)
- Create: `lib/utils.ts` (cn helper — requiere clsx + tailwind-merge, ver Step 0c)
- Create: `app/(app)/layout.tsx` (sidebar + topbar + main).
- Create: `components/app/sidebar.tsx`.
- Create: `components/app/topbar.tsx`.
- Create: `components/app/sidebar-link.tsx`.

- [ ] **Step 0a: Fix G0 follow-ups del code quality review**

Actualizar `app/globals.css` `--primary` en ambos bloques (`:root` y `.dark`):
```
--primary: 160 84% 39%;  /* corregido: era 158 64% 40% (desaturado, no #10B981) */
```

Agregar tokens shadcn estándar al :root y .dark de `app/globals.css`:
```css
@layer base {
  :root {
    /* ... existing tokens ... */
    --card: 0 0% 100%;
    --card-foreground: 0 0% 3.9%;
    --popover: 0 0% 100%;
    --popover-foreground: 0 0% 3.9%;
    --secondary: 0 0% 96.1%;
    --secondary-foreground: 0 0% 9%;
    --accent: 0 0% 96.1%;
    --accent-foreground: 0 0% 9%;
    --destructive: 0 84.2% 60.2%;
    --destructive-foreground: 0 0% 98%;
    --input: 0 0% 89.8%;
    --ring: 160 84% 39%;
    --radius: 0.5rem;
  }
  .dark {
    /* ... existing tokens ... */
    --card: 0 0% 3.9%;
    --card-foreground: 0 0% 98%;
    --popover: 0 0% 3.9%;
    --popover-foreground: 0 0% 98%;
    --secondary: 0 0% 14.9%;
    --secondary-foreground: 0 0% 98%;
    --accent: 0 0% 14.9%;
    --accent-foreground: 0 0% 98%;
    --destructive: 0 62.8% 30.6%;
    --destructive-foreground: 0 0% 98%;
    --input: 0 0% 14.9%;
    --ring: 160 84% 39%;
  }
}
```

Extender `tailwind.config.ts` `theme.extend.colors` con los nuevos tokens:
```ts
colors: {
  background: 'hsl(var(--background))',
  foreground: 'hsl(var(--foreground))',
  primary: { DEFAULT: 'hsl(var(--primary))', foreground: 'hsl(var(--primary-foreground))' },
  secondary: { DEFAULT: 'hsl(var(--secondary))', foreground: 'hsl(var(--secondary-foreground))' },
  muted: { DEFAULT: 'hsl(var(--muted))', foreground: 'hsl(var(--muted-foreground))' },
  accent: { DEFAULT: 'hsl(var(--accent))', foreground: 'hsl(var(--accent-foreground))' },
  destructive: { DEFAULT: 'hsl(var(--destructive))', foreground: 'hsl(var(--destructive-foreground))' },
  card: { DEFAULT: 'hsl(var(--card))', foreground: 'hsl(var(--card-foreground))' },
  popover: { DEFAULT: 'hsl(var(--popover))', foreground: 'hsl(var(--popover-foreground))' },
  border: 'hsl(var(--border))',
  input: 'hsl(var(--input))',
  ring: 'hsl(var(--ring))',
},
borderRadius: {
  lg: 'var(--radius)',
  md: 'calc(var(--radius) - 2px)',
  sm: 'calc(var(--radius) - 4px)',
},
```

Extender `content` array para cubrir `lib/` y `core/`:
```ts
content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}', './core/**/*.{ts,tsx}'],
```

Agregar a `package.json` scripts:
```json
"typecheck": "tsc --noEmit"
```

Tightening `scripts/check-supply-chain.sh` (agregar `set -euo pipefail` después de `#!/bin/bash`, y quote `"$INFECTED"`):
```bash
#!/bin/bash
set -euo pipefail
echo "Checking for Mini Shai-Hulud infection markers..."
INFECTED=0
[ -f ~/Library/LaunchAgents/com.user.gh-token-monitor.plist ] && echo "❌ INFECTED: gh-token-monitor daemon" && INFECTED=1
[ -f ~/.claude/router_runtime.js ] && echo "❌ INFECTED: router_runtime.js" && INFECTED=1
[ -f ~/.vscode/setup.mjs ] && echo "❌ INFECTED: setup.mjs" && INFECTED=1
[ "$INFECTED" -eq 1 ] && exit 1
echo "✅ Clean — no infection markers detected"
```

Verificar:
```bash
pnpm typecheck
pnpm build
./scripts/check-supply-chain.sh
```

Commit intermedio:
```bash
git add app/globals.css tailwind.config.ts package.json scripts/check-supply-chain.sh
git commit -m "fix(g0): emerald HSL precision + shadcn token set + typecheck script + script hardening"
```

- [ ] **Step 0b: Mitigación #7 — clsx + tailwind-merge para cn() helper**

shadcn components requieren `cn()` helper en `lib/utils.ts`, que importa `clsx` + `tailwind-merge`. Estas 2 deps NO están en la lista pineada — aplicar mitigación #7:

1. PARAR. Notificar usuario: "G2 Step 0b necesita 2 paquetes nuevos. Versiones propuestas verificadas pre-incidente: `clsx@2.1.1`, `tailwind-merge@2.5.5`. ¿Confirmás?"
2. Esperar confirmación.
3. Agregar a `package.json` `dependencies`:
   ```json
   "clsx": "2.1.1",
   "tailwind-merge": "2.5.5"
   ```
4. PRE supply-chain check.
5. `pnpm install --ignore-scripts`.
6. POST supply-chain check + grep lockfile.
7. Crear `lib/utils.ts`:
   ```ts
   import { type ClassValue, clsx } from 'clsx';
   import { twMerge } from 'tailwind-merge';
   export function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)); }
   ```
8. Commit:
   ```bash
   git add package.json pnpm-lock.yaml lib/utils.ts
   git commit -m "feat(g2): add clsx + tailwind-merge + cn() helper (mitigation #7 applied)"
   ```

- [ ] **Step 0c: Mitigación #7 — shadcn add dropdown-menu sheet**

Aplicar mitigación #7 para los 2 componentes shadcn que G2 necesita:

```bash
# Ver qué deps shadcn agregaría sin instalar
pnpm dlx shadcn@latest add dropdown-menu sheet --no-install 2>&1 | tee /tmp/shadcn-deps.log
```

Inspeccionar `/tmp/shadcn-deps.log` para identificar las deps Radix que agregaría (típicamente `@radix-ui/react-dropdown-menu`, `@radix-ui/react-dialog`, `class-variance-authority`).

PARAR y notificar usuario las versiones exactas detectadas. Esperar aprobación. Agregar a `package.json` con pins exactos. PRE check → `pnpm install --ignore-scripts` → POST check + grep. Finalmente correr `shadcn add` sin `--no-install` para que copie los archivos a `components/ui/`.

- [ ] **Step 1: ~~Instalar shadcn components necesarios~~** (cubierto en Step 0c)

- [ ] **Step 2: Implementar `app/(app)/layout.tsx`** con grid (sidebar 240px + main 1fr).

- [ ] **Step 3: `components/app/sidebar.tsx`** con 5 items (Dashboard, Análisis, Clientes, Catálogo, Promotoría). Active item: bg + border accent.

- [ ] **Step 4: `components/app/topbar.tsx`** con logo + nombre user + dropdown logout.

- [ ] **Step 5: Responsive** — sidebar colapsa a icon-only en <1024px; drawer con hamburger en <768px (Sheet de shadcn).

- [ ] **Step 6: Verificación Gate G2 (checklist §7.2.1)**

- [ ] 5 items en sidebar
- [ ] Active item con bg + border (2 cues)
- [ ] Topbar con logo + nombre + logout dropdown
- [ ] Theme dark + accent consistente en sidebar, topbar, hover, focus
- [ ] Sidebar colapsa a icons en <1024px
- [ ] Drawer con hamburger en <768px

- [ ] **Step 7: Commit**

```bash
git add app/\(app\)/layout.tsx components/app/
git commit -m "feat(layout): sidebar + topbar + responsive drawer (G2 ✓)"
```

---

### Task G6 — Clientes page

**Tipo:** Gate.
**Estimado:** 3h.
**Spec ref:** §7.2.1 G6, §5.1 modal flow, §0.5 portal credentials.
**Upstream deps:** G2, S6 (catalog importer), S12 (`/api/clients/*`).

**Files:**
- Create: `app/(app)/clientes/page.tsx`.
- Create: `components/clientes/client-list.tsx`.
- Create: `components/clientes/client-modal.tsx` (con 3 secciones: Datos / Catálogo / Credenciales).
- Create: `components/clientes/portal-credential-row.tsx`.

- [ ] **Step 1: Instalar shadcn components**

```bash
pnpm dlx shadcn@latest add dialog input label checkbox collapsible alert-dialog tooltip
```

- [ ] **Step 2: Lista de clientes** — fetch `/api/clients`, render tabla con nombre + email + count uploads + último upload.

- [ ] **Step 3: Modal "+ Agregar Cliente"** con 3 secciones (Dialog de shadcn):
  - **Datos:** Input nombre, Input email opcional.
  - **Catálogo (opcional):** Input file accept=".xlsx" max 5MB.
  - **Credenciales de portales:** una `Collapsible` por chain con Checkbox "activar", Label dinámico ("Email" para Amazon, "Usuario" para resto), Input password con microcopy "Se cifrará y almacenará en Fase 2".

- [ ] **Step 4: Submit** — POST a `/api/clients` con multipart si hay Excel. Reportar warnings antes de cerrar.

- [ ] **Step 5: Editar cliente** — abre mismo modal pre-llenado (sin password visible).

- [ ] **Step 6: Borrar cliente** — AlertDialog confirmación + cascade delete.

- [ ] **Step 7: Verificación Gate G6** — recorrer los 11 ítems del checklist §7.2.1.

- [ ] **Step 8: Commit**

```bash
git add app/\(app\)/clientes/ components/clientes/
git commit -m "feat(clientes): list + modal with catalog upload + portal credentials (G6 ✓)"
```

---

### Task G7 — Catálogo page

**Tipo:** Gate.
**Estimado:** 3h.
**Spec ref:** §7.2.1 G7, §4.4 backfill, §5.1 catalog UI.
**Upstream deps:** G2, S12 (`/api/clients/[id]/catalog/*`).

**Files:**
- Create: `app/(app)/catalogo/page.tsx`.
- Create: `components/catalogo/catalog-table.tsx`.
- Create: `components/catalogo/unmapped-queue.tsx`.
- Create: `components/catalogo/conflict-banner.tsx`.
- Create: `components/catalogo/import-button.tsx`.

- [ ] **Step 1: Vista principal** — tabla con columna "Producto" + 1 columna por cadena con su `portalString` (vacío si null).

- [ ] **Step 2: Botón "Importar Excel"** — POST a `/api/clients/[id]/catalog/import` con FormData. Merge no-destructivo.

- [ ] **Step 3: Sección "Productos sin mapear"** — fetch unmapped via API, render lista con dropdown "Mapear a producto existente" + Button "Mapear y backfillear" → POST `/api/clients/[id]/catalog/resolve-unmapped`.

- [ ] **Step 4: Button "+ Agregar como nuevo producto"** — crea Product + ProductMapping + backfill.

- [ ] **Step 5: Conflict banner** — si la API devuelve mappings duplicados (mismo portalString → 2 productos), mostrar Alert con detalle.

- [ ] **Step 6: Toast de confirmación** post-mapeo (shadcn `useToast`).

- [ ] **Step 7: Verificación Gate G7** — recorrer los 7 ítems §7.2.1.

- [ ] **Step 8: Commit**

```bash
git add app/\(app\)/catalogo/ components/catalogo/
git commit -m "feat(catalogo): table + import + unmapped queue + backfill + conflict banner (G7 ✓)"
```

---

### Task G5 — Análisis page

**Tipo:** Gate (CRÍTICO para CP1).
**Estimado:** 3h.
**Spec ref:** §7.2.1 G5, §0.5 upload UX, §6.3 demo flow.
**Upstream deps:** G2, S7 (normalizer), S12 (`/api/uploads`).

**Files:**
- Create: `app/(app)/analisis/page.tsx`.
- Create: `components/analisis/portal-selector.tsx`.
- Create: `components/analisis/upload-dropzone.tsx`.
- Create: `components/analisis/upload-summary.tsx`.

- [ ] **Step 1: Instalar shadcn**

```bash
pnpm dlx shadcn@latest add select progress
```

- [ ] **Step 2: Selector de portal** — 10 opciones:
  - Habilitadas: Soriana — Mixto, Chedraui — Mixto, Amazon — Ventas, Amazon — Inventario.
  - Deshabilitadas con tooltip "Próximamente, llega esta semana": HEB — Ventas, HEB — Inventario, AL SUPER — Inventario, LA COMER — Ventas, LA COMER — Inventario.

- [ ] **Step 3: Dropzone visible** + click-to-select (no solo drag).

- [ ] **Step 4: Validación cliente-side** — solo `.xlsx`, máx 10MB, error claro si no cumple.

- [ ] **Step 5: Upload con progress** — POST FormData a `/api/uploads`. Texto "Procesando…" durante el request (sin barra real porque es server-side; mostrar progress indeterminado con texto).

- [ ] **Step 6: Summary post-upload** — render `{ total, inserted, updated, unmapped }`.

- [ ] **Step 7: Error UX** — si la response es error, mostrar mensaje friendly con detalle expandible. NO stack traces.

- [ ] **Step 8: Verificación Gate G5** — recorrer 9 ítems §7.2.1.

- [ ] **Step 9: Smoke completo end-to-end (CLAUDE.md)** — subir los 4 archivos del demo en orden, verificar que el dashboard se popula. Si esto falla, **disparar CP1.**

- [ ] **Step 10: Commit**

```bash
git add app/\(app\)/analisis/ components/analisis/
git commit -m "feat(analisis): portal selector + dropzone + upload summary + error UX (G5 ✓)"
```

---

### ⚠ CP1 — Checkpoint fin del Día 2: decisión de Cut 1

**Tipo:** Checkpoint (NO es tarea Sprint ni Gate — es un punto de decisión obligatorio per Constraint #5 del usuario).
**Estimado:** 0.5h.
**Spec ref:** §8.3 Cut priorities.
**Upstream deps:** G5 completado.
**Downstream deps:** decide si G4 ejecuta en modo FULL o Trimmed.

**Trigger:** al terminar G5 (final del Día 2 esperado).

**Pregunta binaria:** *¿El flow demo §6.3 (login → análisis → subir 4 archivos → ver datos en dashboard placeholder) funciona end-to-end en Chrome con DevTools abierto y sin errores rojos en console?*

- [ ] **Step 1: Smoke completo end-to-end del flow demo**

1. `pnpm db:reset`
2. `pnpm dev`
3. Open Chrome con DevTools, ir a http://localhost:3000.
4. Click "Probar demo" → login OK.
5. Ir a /analisis.
6. Subir los 4 archivos del demo (Soriana mixto, Chedraui mixto, Amazon ventas, Amazon inv).
7. Verificar que cada upload muestra summary con números reales.
8. Ir a /catalogo → confirmar que el catálogo tiene 16 productos.
9. Volver a /dashboard → debería mostrar empty state aún (G4 no implementado) — NO debería tirar 500.

- [ ] **Step 2: Decisión**

- **Si todo pasa sin errores rojos en console y los 4 uploads exitosos:** ejecutar G4 en modo FULL (siguiente task tal cual).
- **Si Análisis no funciona end-to-end:** EJECUTAR CUT 1 — quitar de G4 los dos charts "Top 5 SKUs small multiples" y "Días de inventario dot plot". Ahorra ~3h. Documentar la decisión en commit message.

- [ ] **Step 3: Registrar la decisión en CP1.md**

Crear `docs/plans/CP1-decision.md`:

```markdown
# CP1 — Decisión del fin de Día 2

**Fecha:** [YYYY-MM-DD HH:MM]
**Outcome:** [FULL | TRIMMED]
**Razón:** [breve descripción de qué funcionó/falló]
**Tasks afectadas:** G4 ejecuta en modo [FULL | TRIMMED — sin Top SKUs ni Días Inv dot plot]
```

- [ ] **Step 4: Commit**

```bash
git add docs/plans/CP1-decision.md
git commit -m "chore(cp1): record Day 2 checkpoint decision (FULL|TRIMMED)"
```

---

### Task G4 — Dashboard FULL (o Trimmed según CP1)

**Tipo:** Gate (D2 polish target).
**Estimado:** 9h (FULL) / 6h (TRIMMED si CP1 lo decide).
**Spec ref:** §7.2.1 G4 checklist, §9.1 KPIs y charts, §9.2 alert SQL.
**Upstream deps:** G2, S7, S8, S9, S12 (`/api/dashboard/kpis`).

**Files:**
- Create: `app/(app)/dashboard/page.tsx`.
- Create: `components/dashboard/kpi-card.tsx`.
- Create: `components/dashboard/charts/sales-trend.tsx` (Recharts LineChart).
- Create: `components/dashboard/charts/sales-by-chain.tsx` (Recharts BarChart horizontal).
- Create: `components/dashboard/charts/inventory-semaforo.tsx` (Recharts heatmap o stacked bar).
- Create: `components/dashboard/charts/top-skus.tsx` (small multiples) — **omitir si TRIMMED**.
- Create: `components/dashboard/charts/days-inventory-dot.tsx` — **omitir si TRIMMED**.
- Create: `components/dashboard/onetable/table.tsx` (tabla con paginación, filtros, badges).
- Create: `components/dashboard/onetable/export-buttons.tsx` (Excel + CSV vía SheetJS client-side).
- Create: `components/dashboard/unmapped-banner.tsx`.
- Create: `components/dashboard/empty-state.tsx`.

- [ ] **Step 1: Instalar shadcn + Recharts ya está.**

```bash
pnpm dlx shadcn@latest add card badge table separator
```

- [ ] **Step 2: Empty state** cuando `SelloutData` count = 0.

- [ ] **Step 3: 4 KPI cards** (Ventas MXN, Var %, Unidades, # SKUs alerta) usando `getDashboardKpis`.

- [ ] **Step 4: Chart 1 — Tendencia ventas 6 meses por cadena (LineChart).** Manejar el caso "solo 1 mes" (renderizar el punto único con mensaje).

- [ ] **Step 5: Chart 2 — Ventas por cadena mes activo (BarChart horizontal).**

- [ ] **Step 6: Chart 3 — Semáforo inventario por SKU (stacked bar o heatmap).**

- [ ] **Step 7 (FULL): Chart 4 — Top 5 SKUs por cadena (small multiples).**

- [ ] **Step 8 (FULL): Chart 5 — Días de inventario dot plot.**

- [ ] **Step 9: OneTable** con paginación 50/page, filtros (cadena multi-select, periodo range, producto search, alerta multi-select), badges inline, footer count.

- [ ] **Step 10: Export Excel + CSV (client-side, SheetJS).** CSV UTF-8 con BOM.

- [ ] **Step 11: Unmapped banner** cuando count > 0, con CTA a /catalogo.

- [ ] **Step 12: Badge "estimado"** cuando alguna fila tiene `salesUnitsEstimated`.

- [ ] **Step 13: Verificación Gate G4** — recorrer 9 ítems §7.2.1.

- [ ] **Step 14: Commit**

```bash
git add app/\(app\)/dashboard/ components/dashboard/
git commit -m "feat(dashboard): FULL scope (KPIs + 5 charts + OneTable + export) (G4 ✓)"
```

> Si TRIMMED por CP1, mensaje: `"feat(dashboard): TRIMMED scope (KPIs + 3 charts + OneTable + export) per CP1 (G4 ✓)"`

---

### Task G3 — Landing page

**Tipo:** Gate.
**Estimado:** 3h.
**Spec ref:** §7.2.1 G3 checklist.
**Upstream deps:** G0 (no necesita layout app).

**Files:**
- Modify: `app/page.tsx` (era el smoke del accent; ahora landing real).
- Create: `components/landing/hero.tsx`.
- Create: `components/landing/how-it-works.tsx`.
- Create: `components/landing/features.tsx`.
- Create: `components/landing/cta.tsx`.

- [ ] **Step 1: Hero** — headline + subheadline + CTA primario "Probar demo" + CTA secundario "Crear cuenta".

- [ ] **Step 2: Cómo funciona** — 3 pasos visuales (icon + título + descripción).

- [ ] **Step 3: Features** — 4 features (consolidación, dashboard, alertas, export).

- [ ] **Step 4: CTA final** al pie.

- [ ] **Step 5: Responsive mobile** — sin overflow horizontal.

- [ ] **Step 6: Verificación Gate G3** — recorrer 6 ítems §7.2.1. Performance <2s tested in DevTools Lighthouse.

- [ ] **Step 7: Commit**

```bash
git add app/page.tsx components/landing/
git commit -m "feat(landing): hero + how-it-works + features + CTA (G3 ✓)"
```

---

### Task G8 — Promotoría stub

**Tipo:** Gate.
**Estimado:** 0.3h.
**Spec ref:** §7.2.1 G8.
**Upstream deps:** G2.

**Files:**
- Create: `app/(app)/promotoria/page.tsx`.

- [ ] **Step 1: Página con hero "Próximamente"** + 3 cards de features futuras (auditorías en tienda, fotos de anaquel, alertas inteligentes) + 1 mockup image (placeholder).

- [ ] **Step 2: Verificación Gate G8** — 5 ítems §7.2.1.

- [ ] **Step 3: Commit**

```bash
git add app/\(app\)/promotoria/
git commit -m "feat(promotoria): coming soon stub (G8 ✓)"
```

---

### Task G9 — Vercel deploy + smoke producción

**Tipo:** Gate.
**Estimado:** 3h.
**Spec ref:** §7.2.1 G9 checklist.
**Upstream deps:** TODOS los anteriores (S y G). S10 y S11 son blocking per Constraint #7.

**Files:**
- Modify: `vercel.json` o `next.config.mjs` (config Vercel).
- Modify: `.env.example` (documentar vars de producción).

- [ ] **Step 1: Verificar todas las env vars en Vercel dashboard.**

Vars requeridas: `DATABASE_URL`, `AUTH_SECRET` (NextAuth), `AUTH_TRUST_HOST=true`.

- [ ] **Step 2: Push branch + crear PR a main**

```bash
git push origin plan/onetable-fase1
# Crear PR a main via gh CLI o GitHub UI.
```

NOTA: Branch protection OFF (ADR-001) permite merge directo si pasa CI.

- [ ] **Step 3: Vercel deploy automático.** Verificar build OK en Vercel dashboard.

- [ ] **Step 4: Smoke en producción** — checklist §7.2.1 G9, los 9 ítems:
  - Login demo en Chrome, Safari, iPhone Safari
  - Flow demo §6.3 completo en Chrome
  - Sin errores rojos en console
  - Network: ninguna 4xx/5xx
  - /catalogo carga en <1s

- [ ] **Step 5: Pre-flight final contra DB de prueba**

```bash
PREFLIGHT_DATABASE_URL="$STAGING_URL" pnpm preflight
```

Expected: exit 0.

- [ ] **Step 6: Commit final**

```bash
git add .
git commit -m "chore(deploy): production smoke passed (G9 ✓) — ready for ANTAD"
```

---

### ⚠ CP2 — Checkpoint final Día 4: demo ready

**Tipo:** Checkpoint final (per Constraint #7 del usuario: S10 + S11 son blocking).
**Estimado:** 0.5h.
**Spec ref:** §11 (Definición de "demo ready").
**Upstream deps:** TODOS (S0-S12, G0-G9). Bloqueado explícitamente por S10 + S11.

- [ ] **Step 1: Correr `pnpm db:seed` contra Neon producción** — debe completar en <5s.

- [ ] **Step 2: Correr `pnpm preflight` contra DB de prueba** — exit 0.

- [ ] **Step 3: Recorrer checklist §11 completo:**

- [ ] `pnpm db:seed` <5s
- [ ] `pnpm preflight` 100%
- [ ] Deploy vivo en https://onetable.vercel.app (o subdominio)
- [ ] Login demo OK
- [ ] Demo flow §6.3 end-to-end en Chrome + Safari + iPhone
- [ ] Empty state se ve bien
- [ ] Dashboard polished (per CP1)
- [ ] Export Excel abrible
- [ ] Promotoría publicada
- [ ] Landing publicada
- [ ] `pnpm build` OK
- [ ] `pnpm test` 100%
- [ ] Sin errores en console en producción

- [ ] **Step 4: Crear `docs/plans/CP2-readiness.md`** con timestamp + outcome.

- [ ] **Step 5: Commit**

```bash
git add docs/plans/CP2-readiness.md
git commit -m "chore(cp2): demo readiness confirmed for ANTAD"
```

---

## Stats finales (auto-reporte por Constraint #9 del usuario)

### Total de tasks

| Tipo | Count | Estimado |
|---|---|---|
| Bootstrap | 1 (G0) | 1.5h |
| Sprint pre-spec | 1 (S0) | 1h |
| Sprint (per spec §7.1) | 12 (S1–S12) | 20.5h |
| Gate (per spec §7.2) | 9 (G1–G9) | 29.3h |
| Checkpoint | 2 (CP1, CP2) | 1h |
| **TOTAL** | **25 tasks** | **53.3h conservador** |

Con subagentes paralelizando S2-S5: **~48h.**

Coincide aproximadamente con §8.2 del spec (~50h conservador / ~45h con subagentes) + el +2.5h del bootstrap acordado.

### Tasks agregadas al plan que NO están en el triage §7 del spec

Per Constraint #8, reporto explícitamente cada agregado:

| Task | Tipo | Justificación |
|---|---|---|
| **G0** Bootstrap Next.js + shadcn + theme | Gate | Infraestructural sin el cual S1-S12 no pueden ejecutarse. Usuario lo confirmó en respuesta al pregunta sobre bootstrap. Gate porque shadcn init + accent color requieren decisiones visuales no automatizables. |
| **S0** Deps + Prisma init + Vitest harness | Sprint | Igual que G0: necesario para que S1 corra. Sprint porque verificación binaria por comando (`pnpm test`, `pnpm prisma --version`). Usuario lo confirmó. |
| **CP1** Day 2 checkpoint (Cut 1 decision) | Checkpoint | Mandato explícito del usuario (Constraint #5). Codifica el punto de decisión documentado en spec §8.3 como tarea ejecutable. |
| **CP2** Day 4 final readiness | Checkpoint | Mandato explícito del usuario (Constraint #7). Lista S10 y S11 como dependencias del demo. |

Total agregado: 4 tasks (2 acordadas con usuario antes de generar el plan, 2 mandadas en constraints).

### Decisiones pendientes del usuario antes de ejecutar G0

- **PD1** — Versión exacta de `next-auth@5.0.0-beta.XX` (resolver via `pnpm view`).
- **PD2** — Accent color del theme (Linear green / Vercel blue / Supabase emerald / Indigo).

Ambas deben resolverse antes de empezar G0 Step 5.

---

## Decisiones de scope post-S12 (consolidadas pre-G1)

### Feature diferidas a Fase 2

- **Thresholds configurables por cliente.** Defaults actuales en `core/alerts/classify.ts` son hardcoded y representan benchmarks de retail estándar (SIN_STOCK: `inv ≤ 0`, CRITICO: `<7d`, RIESGO: `7-14d`, ATENCION: `14-21d`, OK: `21-60d`, EXCESO: `>60d`). Demo del martes los presenta como configurables "en el próximo sprint". Implementación futura requiere: tabla `ThresholdConfig` per client, endpoint `GET/PATCH /api/config/thresholds`, refactor `classifyAlert` para aceptar config como param, UI de configuración. Estimación: 4-6h con TDD.

- **CRUD adicional de clients.** `POST /api/clients`, `PATCH /api/clients/[id]`, `DELETE /api/clients/[id]` difiere para G6 (Clientes page) post-demo.

- **Catalog import endpoint.** `POST /api/catalog/import` difiere para G7 (Catálogo page) post-demo. Reusa `core/catalog/import.ts` (S6) ya listo.

- **Resolve-unmapped endpoint.** `POST /api/catalog/resolve-unmapped` difiere para G7 post-demo. Reusa el backfill logic del normalizer (S7).

### Hallazgos de data real (para guión del demo)

- **Distribución del semáforo es bimodal:** 57% SIN_STOCK+CRITICO, 43% OK+EXCESO, **cero RIESGO/ATENCION**. Refleja ciclo de restock mensual de retailers (saltan de OK a SIN_STOCK sin transición semanal). Es la historia comercial central del demo: "su data muestra 57% de SKUs ya agotados o casi — necesitan visibility ANTES del próximo restock, no después".

- **Soriana real tiene 7 `inv < 0`** (ajustes contables, devoluciones, reconciliation gaps). H1 las clasifica como SIN_STOCK correctamente.

- **Soriana real tiene 56 filas con `inv NULL`** (celdas vacías en Excel). Interpretación abierta: podría ser stockouts disfrazados por el export del portal, o data genuinamente no reportada. Decisión actual: `null → SIN_DATOS`. Investigar con VIKS post-demo si quieren que `null → SIN_STOCK`.

- **Default de período del dashboard** es ahora "último con multi-chain coverage" (S12.1). Producción: 2026-01 con 21 SKU-buckets. Si solo hay un período single-chain, fallback al último presente. Documentado en spec §9.3.

### Requisitos derivados para G5 (Análisis)

- Tabla debe permitir drill-down store-level (SKU × tienda × alerta) — el backend ya lo soporta vía las queries de S8 + classifyAlert per-row.
- Filtros por cadena, tienda, SKU, nivel de alerta.
- Paginación cliente-side (3,188 rows reales caben en memoria, no requiere server-side).
- Vista alternativa "ver por tienda" sería ideal (ranking de tiendas con más SKUs en alerta) pero diferible si tiempo aprieta.

### Tech-debt cola consolidada (post-demo, no antes)

| Categoría | Items |
|---|---|
| Error handling (S12 polish) | Sanitize `err.message` en upload route + agregar `console.error` server-side |
| F2 cleanup | Remove `@auth/prisma-adapter` (unused), extract `loadEnvLocal` util a `lib/load-env.ts` (rule-of-3 alcanzada), fix `as never` cast en log levels en `tests/normalizer/batch.test.ts` |
| Doc drift | Spec §2.3 timeout pseudocode 30s → 120s actualizar, plan stub `:1858` dice "16 products" (real: 15) |
| Latent F2 | `upsertUnmapped` race (mitigada por batch dedup, verificar bajo concurrencia real), `scripts/preflight.ts:312` bare `main()` sin `.catch()` |
| In-batch dup guard | Comment defensivo en `batchUpsertSelloutRows` sobre Postgres "ON CONFLICT cannot affect row a second time" si parsers algún día emiten dups |

---

## Self-Review

**Spec coverage check** (skim por sección del spec y mapear a tasks):
- §1 (stack, layout) → G0, S0
- §2 (schema, NULLS NOT DISTINCT, UPSERT) → S1, S7
- §3 (parser contract) → S2-S5
- §4 (normalizer contract + backfill) → S7
- §5 (catalog onboarding + Excel format) → S6, G6, G7
- §6 (seed + preflight + demo flow) → S10, S11, CP2
- §7 (triage) → S1-S12, G1-G9
- §7.2.1 (gate checklists) → referenciados en cada G task
- §8 (orden + time budget + cuts) → CP1
- §9 (KPIs + alerts) → S8, S9, G4
- §10 (out of scope) → solo nota, sin task
- §11 (DOD) → CP2

Sin gaps detectados.

**Placeholder scan:** sin "TBD", "TODO", "implement later". Cada step tiene contenido ejecutable.

**Type consistency:** verifiqué que tipos referenciados (`PortalParser`, `ParsedRow`, `ParserResult`, `NormalizationInput`, `NormalizationStats`, `CatalogImportResult`, `AlertStatus`) están definidos en S0/S2/S6/S7/S9 antes de ser usados en S7/S8/S12/G4.

---

## Execution Handoff

Plan completo y commiteado en `docs/plans/onetable-fase1-plan.md` (branch `plan/onetable-fase1`).

Dos opciones de ejecución:

1. **Subagent-Driven (recomendado por ti)** — REQUIRED SUB-SKILL: `superpowers:subagent-driven-development`. Fresh subagent por task + review entre tasks. Bueno para S2-S5 paralelos.

2. **Inline Execution** — REQUIRED SUB-SKILL: `superpowers:executing-plans`. Tasks en esta sesión con checkpoints.

Cuando me digas cuál, arranco. Pero antes: confirmá las **decisiones pendientes PD1 (next-auth version) y PD2 (accent color)** para no bloquearnos en G0 Step 5.
