# OneTable

> Plataforma SaaS B2B de consolidación de sell-out e inventario para proveedores de
> retail en México. Centraliza datos de portales (Soriana, Chedraui, HEB, Al Super,
> La Comer, Amazon) en una tabla unificada + dashboard.

OneTable resuelve la consolidación manual de sell-out que las PyMEs hoy hacen a mano en Excel.

**Estado actual:** Fase 2 (beta con VIKS Jerky Co.). Fase 1 (demo ANTAD) deployada en Vercel.

## Stack

- Next.js 14 (App Router) + TypeScript
- Tailwind CSS + shadcn/ui
- Prisma 6.19.3 + Neon Postgres
- NextAuth v5 (JWT, sin sessions table)
- Recharts, SheetJS (xlsx), Papaparse
- Vitest (integration + unit)
- Deploy: Vercel

## Setup

> Supply chain: este repo respeta el protocolo Mini Shai-Hulud. Toda instalación debe
> correr con `--ignore-scripts`. Detalle en `CLAUDE.md`.

```bash
# 1. Clonar e instalar sin scripts
git clone https://github.com/SnakeJazzzz/OneTable.git
cd OneTable
pnpm install --ignore-scripts

# 2. Variables de entorno (.env.local gitignored, NUNCA commitearlo)
cp .env.example .env.local
# Editá .env.local y llená los valores. Variables requeridas:
#   - DATABASE_URL, DATABASE_URL_UNPOOLED  (Neon Postgres connection strings)
#   - AUTH_SECRET                           (openssl rand -base64 32)
#   - AUTH_URL                              (dev: http://localhost:3000)
#   - DEMO_USER_EMAIL, DEMO_USER_PASSWORD   (para el seed)

# 3. DB (migrations ya están en prisma/migrations/)
pnpm prisma migrate deploy

# 4. Seed con data demo (1 user, 1 client VIKS, 16 productos + mappings + credentials)
pnpm db:seed

# 5. Dev
pnpm dev    # → http://localhost:3000

# 6. Tests
pnpm test           # one-shot
pnpm test:watch     # watch mode

# 7. Typecheck + build
pnpm typecheck
pnpm build
```

Verificación post-install (parte del protocolo de supply chain):

```bash
./scripts/check-supply-chain.sh
grep -E '"[\^~]' package.json && exit 1 || echo "OK pins exact"
```

## Estructura del repo

```
app/              Next.js App Router (auth/, dashboard/, marketing/, api/)
components/       UI (shadcn + custom)
core/             Lógica de negocio pura (sin imports de Next)
  alerts/         clasificación de alertas
  catalog/        importer de seed (formato VIKS pivoteado)
  kpis/           queries de KPIs
  normalizer/     UPSERT batch + tracking de unmapped
  parsers/        parsers por portal
lib/              helpers server-side (auth, prisma client, tenant)
prisma/           schema + migrations
scripts/          seed, preflight, supply chain check
tests/            Vitest
docs/             specs, plans, handoffs, ADRs
```

## Visión por fases

- **Fase 1 — Demo ANTAD.** COMPLETA. Deployada en Vercel.
- **Fase 2 — Beta con VIKS.** CERRADA (2026-07-16, bloques B0-B5). B6 (parsers HEB / Al Super / La Comer) quedó fuera, bloqueado por falta de archivos reales de esos portales. Spec: `docs/archive/fase2/onetable-fase2-spec.md`.
- **Bloque de hardening — EN CURSO.** Pre-Fase 3: infraestructura (DB prod separada + backups), seguridad y deuda acumulada. Scope en `.superpowers/sdd/hardening-backlog.md`.
- **Fase 3 — Scrapers automáticos** (Python + FastAPI + Playwright). Cifrado AES-GCM se activa acá. Draft: `docs/specs/onetable-fase3-spec-draft.md`.
- **Fase 4 — APIs directas con cadenas.** Negociar integración via API oficial con las cadenas grandes.
- **Fase 5 — Promotoría y servicios.** Auditoría en tienda, conexión a CRM, alertas inteligentes, recomendaciones de reposición.

## Docs clave

- **Mapa completo de docs/ (activo vs archivo):** `docs/README.md`.
- **Contexto operativo y reglas:** `CLAUDE.md` (raíz).
- **Draft de Fase 3:** `docs/specs/onetable-fase3-spec-draft.md`.
- **Histórico Fase 2 (referencia):** `docs/archive/fase2/onetable-fase2-spec.md` + planes de bloque en `docs/archive/fase2-bloques/`.
- **Histórico Fase 1 (referencia):** `docs/archive/fase1/onetable-fase1-spec.md` + `docs/archive/fase1/onetable-fase1-plan.md`.
- **SRS legacy:** `docs/specs/onetable-srs-v1.docx` — el proyecto se llamaba "Scopium"; las referencias a ese nombre se ignoran.

## Cliente

VIKS Jerky Co. — primer cliente real. Data en `docs/specs/viks-data/`.
