# G9 — Vercel deploy (pre-demo ANTAD)

Branch ready: `plan/onetable-fase1`. Tag: post the G5/G5b/Fix-bundle commit.

## Pre-flight checks (verify locally before deploy)

```bash
git status                              # working tree clean
pnpm typecheck                          # tsc clean
pnpm test                               # all passing
./scripts/check-supply-chain.sh         # ✅ clean
grep -E '"[\^~]' package.json && echo BAD || echo OK
git log --oneline main..HEAD | head -5  # commits to deploy
```

## Setup en Vercel (UI — una sola vez)

1. **Login**: https://vercel.com — usar la cuenta personal.
2. **Add New → Project** → "Import Git Repository" → seleccionar `SnakeJazzzz/OneTable`.
3. **Framework preset:** Next.js (auto-detectado).
4. **Root directory:** `./` (default).
5. **Build & Output settings:** TODO override — vienen del `vercel.json` en repo:
   - `installCommand`: `pnpm install --ignore-scripts` (CRITICO — bypassa postinstall scripts del worm; ya en vercel.json)
   - `buildCommand`: `pnpm build`
6. **Branch a deployar:** `plan/onetable-fase1` (override del default `main`, porque `main` está vacío). Configurar en *Settings → Git → Production Branch* después del primer import.

## Environment Variables (Production scope)

Antes del primer deploy, agregar en *Settings → Environment Variables*:

| Variable | Valor | Notas |
|---|---|---|
| `DATABASE_URL` | Neon production branch URL | NO reutilizar la branch de dev. Crear una nueva branch en Neon dashboard. |
| `AUTH_SECRET` | `openssl rand -base64 32` | Generar uno **nuevo** para prod (no copiar el de `.env.local`). |

**Opcionales / heredadas de Vercel:**
- `AUTH_URL` / `NEXTAUTH_URL` — NextAuth v5 con `trustHost: true` (ver `auth.ts:37`) las infiere del request en Vercel preview/prod. Omitir.
- `NODE_ENV` — Vercel lo set a `production` automáticamente.

**Scope:** seleccionar **Production** (y opcionalmente Preview si querés smoke pre-merge). NO marcar Development (corre local).

## Seed production DB

Después de configurar `DATABASE_URL`, antes del primer deploy:

```bash
# Localmente, con DATABASE_URL apuntando a la Neon prod branch:
export DATABASE_URL='<prod Neon URL>'
pnpm prisma migrate deploy        # apply migrations to prod DB
pnpm db:seed                      # creates demo@onetable.mx + VIKS Jerky + 15 products
unset DATABASE_URL                # restore local
```

Verificar:
```bash
DATABASE_URL='<prod>' pnpm exec tsx -e "
import { db } from './lib/db';
db.user.findMany({select:{email:true}}).then(console.log).finally(()=>db.\$disconnect());
"
# Debe imprimir: [{ email: 'demo@onetable.mx' }]
```

## Deploy

Después de los env vars + seed:

1. Vercel UI: *Deployments → Redeploy* (o esperar al next push a la branch).
2. Build time esperado: **~2–4 min** (Next.js build + Prisma generate).
3. Verificar build log: `pnpm install --ignore-scripts` debe aparecer en la primera fase.

URL probable: `onetable-<hash>.vercel.app` o `onetable-snakejazzzz.vercel.app`. Renombrar en *Settings → Domains → Project → Edit*.

## Smoke production (G9 acceptance)

| Test | Esperado |
|---|---|
| `GET https://<url>/` | 307 → `/login` |
| `GET https://<url>/login` | 200, form visible |
| Login con `demo@onetable.mx` / `demo1234` | 302 + cookie `authjs.session-token` set |
| `GET /dashboard` con cookie | 200, empty state ("Subí tu primer archivo en Análisis") |
| `POST /api/auth/signup` con email nuevo + clientName | 200, User + Client creados |
| Upload real `Chedraui-real.xlsx` en `/analisis` (slot Chedraui — Mixto) | Success + summary stats + redirect a /dashboard si era el primer upload |
| `/dashboard` post-upload | KPIs + 5 charts + OneTable + semáforo con distribución realista |

## Rollback (si algo falla)

- Vercel UI: *Deployments → seleccionar build anterior → Promote to Production*.
- DB rollback: las migrations no se revierten automáticamente. Si la migration es destructiva, restaurar Neon branch via *Neon dashboard → Branches → Restore*.

## Post-deploy housekeeping

- Confirmar que `.env.local` NO está en git (.gitignore lo cubre — verificado).
- Borrar la branch de Neon de dev si VIKS no la va a usar (no es crítico, pero limpia).
- Comprobar Vercel *Settings → Functions → Logs* después del primer login para asegurar que no hay `MISSING_AUTH_SECRET` ni errores de Prisma.

## Quien ejecuta

Vos desde tu Mac. Yo (Claude Code) no tengo acceso a Vercel ni a Neon. Te aviso cuando todo el código esté listo y commiteado en local — vos hacés `git push` y arrancás el setup en Vercel UI.
