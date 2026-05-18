# Session 2 — End of Backend (pre-G1 handoff)

**Branch:** `plan/onetable-fase1` · **Last commit:** `57b1723` · **Tests:** 72/72 ✓ · **tsc:** clean · **Supply chain:** clean

---

## TL;DR

Backend 100% complete. Frontend (G1–G9) is next. Demo deadline: martes ANTAD (~2-3 días).

The full pipeline works end-to-end against real VIKS data: parse → normalize → KPI queries → alert classification → HTTP API. Preflight runs in 28s with 3,188 real rows. The 4 API endpoints are wired and verified via curl + integration tests.

---

## Commits S0..S12.1 (10 commits this session, plus S0..S9 from session 1)

```
57b1723  fix(api): smart period default + plan/spec updates pre-G1 (S12.1)
2b39214  feat(api): auth + upload + dashboard + clients routes (S12 ✓)
4d6336b  fix(normalizer): batch UPSERT for production-scale datasets (H2)
93d8d0d  fix(kpis,alerts): worst-case aggregation + negative inventory handling (H1)
4f85584  feat(preflight): end-to-end pipeline validation script (S11 ✓)
8059f90  feat(seed): static seed script for demo data (S10 ✓)
077fc69  feat(kpis): KPI + chart queries with daysOfInv at query (S8 ✓)
dd1f161  feat(alerts): classifier with thresholds per spec §9.2 (S9 ✓)
1c7b420  spec: AJUSTE 5 — fix ON CONFLICT SQL syntax (column list, not constraint name)
e9a43e6  feat(normalizer): UPSERT raw SQL with COALESCE per field + unmapped tracking (S7 ✓)
```

Two hotfixes (H1, H2) were discovered during preflight migration to real data — both blocking for the demo and both shipped before S12.

---

## Decisions the next Claude must know for G1

### 1. Thresholds DIFERIDOS post-demo

`core/alerts/classify.ts` is hardcoded. Spec §9.2 says configurable, but Fase 1 ships defaults. **Pitch para vendedores:** "los defaults vienen de benchmarks de retail estándar. Son 100% configurables — esa configuración llega en el próximo sprint. ¿Qué números harían más sentido para VIKS?"

If anyone in G1 asks "where do we configure thresholds?" the answer is: NOT in this sprint. Don't build the UI for it. Plan §"Decisiones de scope post-S12" documents the F2 work needed.

### 2. Default período del dashboard YA es inteligente (S12.1)

`getDefaultPeriod()` en `core/kpis/queries.ts` resuelve a "último período con multi-chain coverage" si no se pasan params. En la data actual: 2026-01 con 21 SKU-buckets (NO 2026-03 que solo tiene Soriana).

**G4 implementer:** el selector de período en el dashboard puede dejar default vacío (auto-resuelve via `/api/dashboard/kpis` sin params). Si quieren mostrar 2026-03 (single-chain Soriana), pasar params explícitos. Documentado en spec §9.3.

### 3. G5 requiere drill-down store-level

La tabla consolidada de Análisis debe permitir ver SKU × tienda × alerta. El backend ya tiene la data per-store en `SelloutData`; classify se hace per-row en el JS post-fetch.

Filtros mínimos: cadena, tienda, SKU, nivel de alerta. Paginación cliente-side (3,188 filas reales caben en memoria, no requiere server-side). Vista "ranking de tiendas con más alertas" es ideal pero diferible.

### 4. Distribución del semáforo es bimodal (relevante para deck del demo)

Con data real: 57% SIN_STOCK+CRITICO, 43% OK+EXCESO, **cero RIESGO/ATENCION**. Refleja ciclo de restock mensual (saltan de OK a SIN_STOCK sin transición semanal). **Esto ES la historia del demo**, no un bug. Punchline: "su data muestra 57% de SKUs ya agotados o casi — necesitan visibility ANTES del próximo restock, no después".

---

## Items pendientes del usuario (manual, hooks bloquean ediciones automáticas)

1. **`AUTH_SECRET` en `.env.local`** — NextAuth v5 throws at runtime sin esto. El hook `block-env-writes` bloquea ediciones automáticas. Generá con:
   ```bash
   openssl rand -base64 32
   ```
   Y agregarlo manualmente vía `vi .env.local`. Sin esto, `pnpm dev` falla al primer login.

2. **DB state actual:** vacía (preflight + investigation scripts wipearon). Antes de empezar G1, correr `pnpm db:seed` para tener demo user + client + catalog + portal credentials.

---

## Próximo task: G1 — Auth UI

**Crítico:** signup DEBE crear `User` + `Client` atómicamente. `auth.ts:56` rechaza login si `user.clients.length === 0`. Sin Client row, login retorna null silenciosamente.

### Archivos a crear

- `middleware.ts` (root) — protege rutas `['/dashboard', '/analisis', '/clientes', '/catalogo', '/promotoria']` usando `auth` import de `@/auth`
- `app/providers.tsx` (`'use client'`) — wrappea con `<SessionProvider>` de `next-auth/react`
- `app/layout.tsx` — import `<Providers>` y wrappea `{children}`
- `app/(auth)/login/page.tsx` — formulario con `signIn('credentials', { email, password, redirect: false })`. Inline error si `res?.error`. Success → `router.push('/dashboard')`
- `app/(auth)/signup/page.tsx` — formulario que POSTea a `/api/auth/signup`
- `app/api/auth/signup/route.ts` — handler que:
  1. Valida email + password
  2. `bcryptjs.hash(password, 10)`
  3. **Transaction**: `db.user.create({ ..., clients: { create: { name: '...' } } })` — User + Client en una sola operación
  4. Auto-`signIn()` post-creación, o redirect a `/login`

### Cómo invocar signIn() (client-side)

```ts
'use client';
import { signIn } from 'next-auth/react';
const res = await signIn('credentials', { email, password, redirect: false });
if (res?.error) { /* show inline error */ }
else if (res?.ok) { router.push('/dashboard'); }
```

### Cómo invocar auth() (server-side)

- `auth()` from `@/auth` funciona en: server components, route handlers, server actions, `middleware.ts`
- `useSession()` from `next-auth/react` funciona SOLO en: client components

### CSRF

NextAuth v5 handles internally cuando usás `signIn()` de `next-auth/react`. NO necesitás fetchear `/api/auth/csrf` manualmente para el flow estándar.

### Logout

```ts
import { signOut } from 'next-auth/react';
await signOut({ callbackUrl: '/login' });
```

### Demo user

Si necesitás un "Demo button" en /login: pre-llenar email=`demo@onetable.app` password=`demo1234` y submit. La seed ya creó este user.

---

## Tech-debt cola (post-demo, NO antes)

- **Error handling polish en `/api/data/upload`:** sanitizar `err.message` (líneas 116-120 y 252-263) + agregar `console.error` server-side. Sin esto, errores en producción son opacos en Vercel logs.
- **`@auth/prisma-adapter` unused** — está en deps pero no se importa (usamos JWT sessions). F2 cleanup.
- **`loadEnvLocal` duplicated 3×** (preflight, seed, tests/setup) — rule-of-3 alcanzada, extract a `lib/load-env.ts`.
- **CRUD adicional faltante:** POST/PATCH/DELETE `/api/clients/[id]`, `/api/catalog/import`, `/api/catalog/resolve-unmapped`. **G6 (Clientes) y G7 (Catálogo) los necesitan** — dispatchear mini-task antes de esos gates.
- **Spec doc drift:** spec §2.3 pseudocode dice timeout 30s pero código usa 120s (justificado in-code). Spec §9.2 dice `inv === 0` pero código usa `<= 0` (H1, documentado). Patchear cuando haya tiempo.
- **`/api/data/upload` vs plan `/api/uploads`:** path divergence. El impl gana, el plan está stale.

---

## Hallazgos de S12 sobre NextAuth v5 ↔ App Router

1. **`auth.ts` al root** (NO `lib/auth.ts`) — convención v5. El middleware importa desde `@/auth`.
2. **Module augmentation en `next-auth.d.ts`** — sin esto, `session.user.clientId` requiere `as any` en toda la app. Ya está creado, no tocar.
3. **`trustHost: true`** en config — required para Vercel previews + AUTH_URL inference en dev. Si lo quitan, NextAuth throws "UntrustedHost".
4. **`session: { strategy: 'jwt' }`** — explícito. NO DB sessions. `@auth/prisma-adapter` queda sin uso.
5. **Cookie name:** `authjs.session-token` (no `next-auth.session-token` como v4). Si G1 hace inspección manual de cookies, usar el nuevo nombre.
6. **`signIn()` server-side** (desde server action) sí funciona, pero el client-side `signIn()` de `next-auth/react` es más simple para el form de login.
7. **Demo curl flow (para QA manual):**
   ```bash
   curl -c /tmp/c.txt http://localhost:3000/api/auth/csrf
   # POST a /api/auth/callback/credentials con email + password + csrfToken + json=true
   # Captura cookie authjs.session-token
   curl -b /tmp/c.txt http://localhost:3000/api/clients
   ```

---

## Status check antes de arrancar G1

```bash
git log --oneline main..HEAD | head -5    # debe mostrar 57b1723 al tope
pnpm test                                  # 72/72 ✓
pnpm exec tsc --noEmit                     # clean
./scripts/check-supply-chain.sh            # ✅ Clean
cat .env.local | grep AUTH_SECRET          # debe existir, sino agregalo
pnpm db:seed                                # repuebla demo data
```

Si todo OK → arrancar G1 con subagent + doble review (mismo pattern que S12).

---

**Sesión 2 cierra acá. Backend completo. Frontend abre con G1.**
