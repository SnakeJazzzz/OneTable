# B0 — CI workflow + branch protection on `main`

> Design doc del bloque B0 de Fase 2 (ver `docs/specs/onetable-fase2-spec.md §11.1` y `§12`).
> Producto del brainstorming Superpowers (2026-06-03), una persona desarrollando sola sobre
> el repo OneTable.
>
> **Scope:** atómico. Solo CI + branch protection. Pendientes operacionales relacionados
> (hardening de `check-supply-chain.sh`, `PREFLIGHT_DATABASE_URL` en `.env.example`, fixes
> visuales de G2 Step 0) se manejan en los bloques que los tocan o como micro-PRs aparte.

---

## 1. Overview

### 1.1 Qué entrega B0

1. **Un archivo nuevo**: `.github/workflows/ci.yml` — workflow de GitHub Actions que corre
   en `push` a `main` y en `pull_request` apuntando a `main`.
2. **Una configuración remota en GitHub**: branch protection rules en `main` con el check
   `ci` como required status check, enforce on administrators incluido.

### 1.2 Orden de implementación obligatorio

GitHub no permite marcar un check como required si nunca corrió. El required check name
no aparece en el dropdown de Settings → Branches hasta que un workflow lo registró en el
catálogo de checks del repo. Esto define la secuencia:

1. Crear branch `feat/b0-ci-and-protection` desde `main`.
2. Agregar `ci.yml` (contenido en §2). Commit.
3. PR a `main`. **El CI corre por primera vez en este PR.** Si pasa, GitHub registra `ci`
   como check candidato.
4. Mergear el PR (sin branch protection aún — no podés requerir un check que no existe).
5. **Recién después del merge**, activar branch protection en `main` apuntando al check
   `ci` (§3).
6. Verificación final con un **PR DRAFT desechable** (§5.2): se rompe el CI a propósito,
   se confirma que la protección bloquea el merge, y se cierra el PR sin mergear. No se
   arregla y se mergea — eso mezclaría la prueba con un cambio real y obligaría al ciclo
   romper→arreglar sobre algo que sí querés.

**Ventana entre paso 4 y paso 5:** entre el merge del workflow y la activación de la
protección, `main` corre CI pero no está protegido. Como los pasos 4 y 5 se ejecutan
consecutivos por la misma persona en minutos, el riesgo real es cero. Vale recordar que
**activar/desactivar branch protection es reversible desde Settings → Branches → Edit con
un click**, así que cualquier configuración que quede mal se corrige inmediatamente sin
necesidad de toolage.

---

## 2. El workflow — `.github/workflows/ci.yml`

```yaml
name: ci

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

# Cancela runs en progreso de la misma ref cuando llega un push nuevo.
# Evita gastar minutos en builds obsoletos sin afectar el run final.
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  # El nombre del check que GitHub registra para required status checks es la KEY
  # del job ("ci" en este caso), no el `name:` del workflow.
  # No agregamos `name: ci` adentro del job porque sería redundante y agrega
  # ambigüedad si después se agregan más jobs.
  ci:
    runs-on: ubuntu-latest
    timeout-minutes: 15

    # Postgres efímero. Health check garantiza que el step de migrate
    # no se ejecute antes de que el container esté listo.
    services:
      postgres:
        image: postgres:16
        env:
          POSTGRES_USER: postgres
          POSTGRES_PASSWORD: postgres
          POSTGRES_DB: onetable_test
        ports:
          - 5432:5432
        options: >-
          --health-cmd="pg_isready -U postgres"
          --health-interval=5s
          --health-timeout=5s
          --health-retries=10

    env:
      # Connection string al Postgres del service container.
      # NO se usan secrets de Neon — CI corre standalone, sin tocar producción.
      DATABASE_URL: postgresql://postgres:postgres@localhost:5432/onetable_test?schema=public
      # AUTH_SECRET dummy de 32 bytes en base64 (formato que documenta auth.ts:22).
      # Generado una sola vez con `openssl rand -base64 32` al cerrar B0; pineado
      # acá para reproducibilidad. NUNCA reusar este valor en otro environment.
      # NextAuth v5 beta.25 acepta strings no-base64 (verificado: tests/setup.ts
      # usa "test-only-..." y pasan 89/89), pero matchear el formato documentado
      # cubre el caso de que una beta futura endurezca la validación.
      AUTH_SECRET: G0zzCIic/bXamnXRSeYLNL1GIsomqr2u19M/S0PeRZ8=
      AUTH_URL: http://localhost:3000
      # NO se setean DEMO_USER_EMAIL/PASSWORD: scripts/seed.ts:69-70 los tiene
      # hardcoded como constants exportadas, no los lee de process.env. Como
      # tampoco se corre seed en CI (§7.6) y los tests usan sus propios TEST_EMAIL
      # aislados, agregarlos sería superficie inerte. La discrepancia con
      # .env.example (que los lista) es housekeeping aparte, fuera de B0.

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      # Static supply-chain checks contra estado commiteado.
      # Corren ANTES de install: si fallan, no se descarga ningún package.
      # Patrón Mini Shai-Hulud aplicado al espíritu, no copiado del antes/después local
      # (donde sirve por motivos distintos — ver §7.2 sobre el script host-level).
      - name: Verify pinned package versions
        run: |
          if grep -E '"[\^~]' package.json; then
            echo "::error::Pins flexibles (^ o ~) en package.json. Protocolo Mini Shai-Hulud requiere pins exactos."
            exit 1
          fi
          echo "OK pins exact"

      - name: Check lockfile for Mini Shai-Hulud tokens
        run: |
          if grep -E "tanstack|squawk|uipath|mistral|cap-js|intercom-client|router_init|setup\.mjs|router_runtime" pnpm-lock.yaml | grep -v lightningcss; then
            echo "::error::Lockfile contiene un marker conocido de Mini Shai-Hulud."
            exit 1
          fi
          echo "OK lockfile clean"

      # pnpm via packageManager field del package.json (10.26.1 con SHA).
      # action-setup@v4 lo lee automáticamente — no se pinea versión en el YAML.
      - name: Setup pnpm
        uses: pnpm/action-setup@v4

      # Node 24 — matchea producción real de Vercel (verificado contra `vercel project ls`).
      # Cache: pnpm activa el cache del store de pnpm con la lockfile como key.
      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: pnpm

      # --frozen-lockfile garantiza que el lockfile no se actualiza silenciosamente.
      # Si package.json y lockfile desincronizan, falla acá (no instala).
      # --ignore-scripts cierra el otro borde del protocolo supply chain.
      - name: Install dependencies
        run: pnpm install --frozen-lockfile --ignore-scripts

      # Typecheck primero — fail-fast sobre análisis estático antes de levantar la DB.
      # typecheck internamente corre `prisma generate && tsc --noEmit` (ver package.json).
      - name: Typecheck
        run: pnpm typecheck

      # Migrations contra el Postgres del service container.
      # Los tests son self-contained (cada uno crea su propio User+Client+data
      # con TEST_EMAIL aislado y los limpia en beforeAll). NO se corre `db:seed`
      # acá porque ningún test depende de la data del seed estático — ver §7.6.
      - name: Apply migrations
        run: pnpm prisma migrate deploy

      # Build (next build). También invoca `prisma generate` internamente (idempotente).
      - name: Build
        run: pnpm build

      # 89 tests. ~22s local con DB real; en CI suele rondar 30-50s por overhead del runner.
      - name: Test
        run: pnpm test
```

### 2.1 Notas técnicas del workflow

- **`concurrency` block**: cancela runs en progreso para la misma ref cuando llega un push
  nuevo. Evita gastar minutos en CI sobre commits ya obsoletos. No afecta correrness — el
  último run es el que cuenta.
- **`timeout-minutes: 15`**: net de seguridad ancho. Target real ~3-4 min wall-clock.
- **PG health check**: `pg_isready` evita race entre el boot del container y el primer
  `prisma migrate deploy`.
- **`@types/node` 20 vs runtime 24**: drift menor, forward-compatible para el código actual.
  No bloquea B0. Upgradar `@types/node` a 24 es housekeeping de un commit aparte (§7.1).
- **El check `pgrep "tanstack|..."` excluye `lightningcss`**: igual que en el patrón
  local — `lightningcss` legítimamente contiene la substring `cap-js` y siempre da
  falso positivo.

---

## 3. Branch protection — settings

Configurar en GitHub Settings → Branches → Branch protection rules → Add rule
(Branch name pattern: `main`) **después** de que el workflow haya corrido al menos una vez
y el check `ci` esté en el catálogo de checks.

### 3.1 Reglas activas

| Setting | Valor | Por qué |
|---|---|---|
| Require a pull request before merging | ✓ | Toda change pasa por PR. |
|   ↳ Required approving reviews | **0** | Solo dev — no hay otro revisor humano. La política es "PR + CI verde", no "PR + review humano". |
|   ↳ Dismiss stale pull request approvals when new commits are pushed | — | No aplica con 0 reviews. |
|   ↳ Require review from Code Owners | — | Sin CODEOWNERS file. |
| Require status checks to pass before merging | ✓ | El gate de B0. |
|   ↳ Require branches to be up to date before merging | ✓ | Evita merge surprises por race con otros PRs. A esta escala el costo de reruns es teórico. |
|   ↳ Status checks required | **`ci`** | El job único del workflow (key del job, no nombre del workflow — ver §2.1). Después del primer run, verificar el string exacto que GitHub registró en Settings → Branches → Edit rule → search status check; usar ese mismo string. |
| Require conversation resolution before merging | ✗ | No hay revisores con conversaciones que resolver. |
| Require signed commits | ✗ | No hay signing setupeado — incluirlo bloquearía inmediato sin valor inmediato. Adoptable después. |
| Require linear history | ✗ | No restringir el merge UI default; rebase/squash/merge commits todos permitidos. |
| Require deployments to succeed before merging | ✗ | Vercel deploy es separate concern; no se acopla al CI. |
| Lock branch | ✗ | — |
| **Do not allow bypassing the above settings** | ✓ | **Crítico.** Aplica las reglas a administradores (incluyendo el dueño del repo). Sin este toggle, la protección es una cerradura con llave maestra en el bolsillo del admin — no protege contra el escenario que justificó ADR-001 (push directo a main bajo apuro). |
| Restrict who can push to matching branches | ✗ | Solo dev, irrelevante. |
| Allow force pushes | ✗ | El hook local también bloquea; redundancia barata. |
| Allow deletions | ✗ | — |

### 3.2 Alternativa CLI (en lugar de la UI)

`gh api -X PUT` con el payload completo:

```bash
gh api -X PUT repos/SnakeJazzzz/OneTable/branches/main/protection \
  --input - <<'EOF'
{
  "required_status_checks": {
    "strict": true,
    "contexts": ["ci"]
  },
  "enforce_admins": true,
  "required_pull_request_reviews": {
    "required_approving_review_count": 0,
    "dismiss_stale_reviews": false,
    "require_code_owner_reviews": false
  },
  "restrictions": null,
  "required_linear_history": false,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "required_conversation_resolution": false,
  "lock_branch": false,
  "allow_fork_syncing": false
}
EOF
```

Cualquiera de los dos métodos produce el mismo resultado. La UI es más auditable
visualmente; el CLI es scriptable.

---

## 4. Environment + secrets

**Resultado clave de §2: cero secrets de GitHub Secrets requeridos.**

El workflow declara todos los env vars inline en el bloque `env:` del job. Razones:
- `DATABASE_URL` apunta al service container local (`localhost:5432`). Postgres efímero,
  sin credenciales sensibles.
- `AUTH_SECRET` en CI es un dummy ("ci-secret-not-for-prod-do-not-reuse"). NextAuth lo
  necesita para arrancar, pero los tests no validan firmas reales. Marcado en el comentario
  como **nunca reusar en otro environment**.
- `DEMO_USER_EMAIL` / `DEMO_USER_PASSWORD` **NO se setean en CI**: `scripts/seed.ts:69-70`
  los tiene hardcoded como constants exportadas, no los lee de `process.env`. Como
  además no se corre seed en CI (§7.6) y los tests crean su propio `TEST_EMAIL` aislado,
  agregarlos al env sería superficie inerte. La discrepancia con `.env.example` (que sí
  los lista) es housekeeping aparte.
- No se necesita ningún Neon credential. No se necesita ningún Vercel token.

**Consecuencia operativa:** un fork del repo puede correr el CI completo sin requerir
ningún secret. Reproducibilidad total.

---

## 5. Pasos de implementación

### 5.1 Flujo de la implementación de B0

1. `git checkout main && git pull` para confirmar main al día.
2. `git checkout -b feat/b0-ci-and-protection`.
3. Crear `.github/workflows/ci.yml` con el contenido de §2.
4. Commit: `feat(ci): add ci workflow for typecheck + build + test`.
5. Push branch.
6. `gh pr create` con title y body descriptivos.
7. **Watch the first CI run**. Si falla, iterar normalmente (fix → push → re-run).
   Algunas cosas a chequear si falla:
   - PG service container health (logs del runner).
   - `prisma migrate deploy` sobre PG vacío (tendría que aplicar todas las migrations
     limpias; verificadas localmente).
   - Tests requieren `NULLS NOT DISTINCT` que PG 16 soporta.
8. Una vez CI verde, mergear el PR (sin protection aún).
9. Activar branch protection en `main` con la config de §3 (UI o CLI).

### 5.2 Verificación final con PR DRAFT desechable

10. Crear branch `chore/verify-branch-protection`.
11. Introducir un error a propósito — el más barato: en cualquier `.ts` del repo, agregar
    una línea con un type error obvio (ej. `const x: number = "string";`).
12. Push, crear PR **en modo DRAFT** a `main`.
13. Cuando el CI corra y falle (≤ 1 min para typecheck), verificar:
    - El botón de merge en el PR muestra "Required status check 'ci' failing".
    - No hay opción "Merge anyway" disponible para el administrador (gracias a
      "Do not allow bypassing").
14. **Cerrar el PR sin mergear.** No se arregla, no se mergea, no se libra el cambio
    a `main`. Cerrar la branch en GitHub (o `git branch -D` local).
15. Confirmado: B0 completo. Mover a B1.

---

## 6. Verificación de que B0 funcionó

Checklist objetivo (no estético):

- [ ] El workflow `ci` aparece en Actions tab del repo.
- [ ] El workflow corrió ≥ 1 vez en `main` (post-merge) y ≥ 1 vez en un PR (durante B0).
- [ ] Settings → Branches muestra la regla para `main` con `ci` como required check.
- [ ] El toggle "Do not allow bypassing the above settings" está ON.
- [ ] El PR DRAFT desechable de §5.2 verificó el bloqueo y se cerró sin mergear.
- [ ] Un intento manual de `git push origin main` desde local falla (hook local +
      protección remota).
- [ ] Test suite del repo sigue dando 89 passing en CI (paridad con local).

---

## 7. Fuera de scope explícito

Estos items aparecen relacionados pero quedan FUERA de B0 deliberadamente. Se enumeran
para que no se cuelen en el plan.

### 7.1 Housekeeping operacional

- `set -euo pipefail` + quote vars en `scripts/check-supply-chain.sh` (Pendiente 4
  último sub-bullet en `CLAUDE.md`). Micro-PR aparte cuando se quiera.
- `@types/node` 20 → 24 para alinear con runtime de Vercel. Commit chico aparte.
- `PREFLIGHT_DATABASE_URL` en `.env.example` (Pendiente 1). Solo necesario si se reusa
  `pnpm preflight` localmente para demos.
- Segunda Neon branch para preflight (Pendiente 2). Mismo.
- pnpm 10.26.1 → 11.5.1. Major bump deliberado, fuera de B0.
- Vercel CLI 54.1.0 → 54.4.1 (no afecta CI pero notado en el environment).

### 7.2 `scripts/check-supply-chain.sh` se queda local-only

El script chequea markers de infección en `~/Library/LaunchAgents/`, `~/.claude/`,
`~/.vscode/`. Sirve para verificar la máquina del developer, no para verificar el repo.
En CI sobre runner efímero, esos paths no existen — correr el script en CI sería
un check decorativo con falsa sensación de seguridad. **Queda fuera del CI por diseño;
sigue corriendo localmente antes y después de install como red de seguridad del
developer (ver `CLAUDE.md §8`).**

### 7.3 Lint

`pnpm lint` (= `next lint`) NO entra al CI en B0. Razones:
- No se corre hoy localmente; probable deuda acumulada haría fallar el primer run y
  ensuciaría el ensayo del workflow.
- next lint tiende a warnings ruidosos sobre patrones de App Router.

Orden correcto cuando se quiera incorporar: correr `pnpm lint` local, resolver la deuda
en un commit aparte, después sumar el step al CI.

### 7.4 Vercel preview deploys como required check

Vercel hace su propio preview deploy en cada PR. **No se acopla al CI**. La protección
de `main` requiere SOLO el check `ci` del workflow GitHub Actions. Si el preview deploy
de Vercel falla pero el CI pasa, el merge se permite — son sistemas separados con
responsabilidades distintas. Acoplar Vercel al required check es decisión de otro bloque
(probablemente nunca, dado que el deploy de prod en Vercel es post-merge auto).

### 7.5 `vercel.ts` migration

El Vercel knowledge update sugiere `vercel.ts` como recomendado en lugar de `vercel.json`.
El repo usa `vercel.json` hoy. Migrar es housekeeping de otro round, fuera de B0.

### 7.6 `pnpm db:seed` queda fuera del CI

Los tests del repo son self-contained: cada test crea su propio User + Client + data
con un `TEST_EMAIL` aislado (verificable en `tests/api/dashboard-kpis.test.ts:11-30`,
`tests/normalizer/batch.test.ts:21-22` con comentario explícito *"Isolated by TEST_EMAIL
— does NOT collide with normalize.test.ts or the demo seed"*, mismo patrón en el resto).

Ningún test lee data del seed estático. Por lo tanto correr `pnpm db:seed` en CI agrega
~5s + una superficie de fallo (seed depende de leer `docs/specs/viks-data/catalogo-productos.xlsx`,
parseo de Excel, etc.) sin valor para los tests. Mismo reflejo que con
`check-supply-chain.sh`: "este step hace algo real en CI, o se copió del local sin pensar".

El seed sigue corriendo localmente para que el demo y el dev UI tengan data poblada.

---

## 8. Riesgos y mitigaciones

| Riesgo | Probabilidad | Mitigación |
|---|---|---|
| Postgres 16 service container no levanta a tiempo | Baja | Health check con 10 retries × 5s = 50s grace. |
| `prisma migrate deploy` falla sobre PG vacío | Baja | Migraciones verificadas con `migrate reset` local; mismo flujo aplica acá. |
| Tests fallan en CI por timeout (22s local pueden ser más en runner) | Media | `timeout-minutes: 15` da net amplísimo. Si tests específicos tardan más, agregar `testTimeout` en `vitest.config.ts` apropiadamente. |
| El first PR del workflow no registra el check `ci` en GitHub | Muy baja | Si pasa, registra. Si no pasa, iterás hasta que pase. Si después del verde no aparece en el dropdown de Settings, refrescar/esperar — GitHub puede tardar minutos. |
| Activar branch protection con `enforce_admins=true` me bloquea inmediato | Por diseño | El punto exacto del bloque. Reversible desde Settings en 1 click si una emergencia real lo justifica. |

---

## 9. Estimación

| Item | Tiempo |
|---|---|
| Escribir `ci.yml` | 30 min |
| Primer PR + watch CI + iterar | 60 min (si todo va bien; +30 min si hay debug) |
| Configurar branch protection | 5 min |
| PR DRAFT de verificación + cleanup | 15 min |
| **Total B0** | **~1.5-2.5h** |

Coherente con el estimado del spec (2-3h en `onetable-fase2-spec.md §12`).

---

## 10. Decisiones cerradas durante el brainstorming (audit trail)

1. **Test DB**: GitHub Actions service container `postgres:16`. No Neon en CI.
2. **Workflow structure**: single sequential job.
3. **Step order**: install → typecheck → migrate → build → test. Typecheck antes
   de DB para fail-fast sobre análisis estático. **No se corre `db:seed`**
   en CI — tests son self-contained (ver §7.6).
4. **Supply chain checks en CI**: 2 greps (pins exact + lockfile tokens) + `--frozen-lockfile`.
   El script host-level NO entra.
5. **Triggers**: `push:main` + `pull_request:main`. El push trigger es para mantener
   "main siempre verde por sí mismo" (badges, automatizaciones), no belt-and-suspenders.
6. **Node version**: 24.x (verificado contra `vercel project ls` que reporta Node 24.x
   para el proyecto `onetable` en producción).
7. **pnpm**: 10.26.1 via `packageManager` field; `pnpm/action-setup@v4` lo lee.
8. **Branch protection**: firm-minimal con `enforce_admins=true` ("Do not allow bypassing"),
   sin signed commits ni linear history en este bloque.
9. **Implementation sequence**: workflow merged primero (para registrar el check), después
   se activa branch protection. Verificación con PR DRAFT desechable.

---

## 11. Próximo paso

Siguiente bloque: **B1**, definido en `onetable-fase2-spec.md §12`. Re-grounding obligatorio
contra el código real antes de cualquier discusión del cómo. Sin diseño previo en este doc.
