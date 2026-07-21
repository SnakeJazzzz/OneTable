# Runbook T1 — Entornos, backups y monitoreo (pasos de Michael)

> Hardening T1, 2026-07-20. Este runbook cubre TODO lo que vive en dashboards
> y archivos que Claude Code no puede tocar (hook `block-env-writes`). Sigue
> los pasos EN ORDEN — el paso 0 va primero porque tu máquina hoy apunta a
> production.
>
> Contexto ya ejecutado por ti en la consola de Neon (2026-07-20): branches
> `production` (default, ex-main), `staging` y `development` (hijas de
> `production`) en el proyecto `quiet-dawn-60852807` (DB `onetable-db`,
> Postgres 17, Free tier vía integración Vercel↔Neon). Las branches
> `staging` y `development` nacieron con auto-delete de 7 días (default del
> Free tier) y ya lo DESACTIVASTE en ambas (2026-07-20).

---

## Paso 0 — Cambiar tu `.env.local` a development (ANTES que todo)

Tu `.env.local` actual apunta a la branch **production**. Hasta que lo
cambies, cualquier `pnpm test` / `pnpm db:seed` / `pnpm db:reset` local va a
ser BLOQUEADO por el guard nuevo (eso es correcto y esperado).

1. En la consola de Neon, abre la branch `development` y copia su connection
   string **pooled** (el que termina en `-pooler.…neon.tech`).
2. Edita `.env.local` a mano (vi/VS Code, no Claude Code):
   - Reemplaza el valor de `DATABASE_URL` por el string de `development`.
   - Agrega la línea nueva:

   ```
   ONETABLE_DB_ENV=development
   ```

   Ese marker es el segundo mecanismo del guard: sin él, cualquier host
   remoto no-production también se bloquea.
3. Agrega también el marker documentado a `.env.example` a mano (el hook
   impide que Claude Code lo haga):

   ```
   # Marker del guard de entorno (lib/db-guard.ts). Obligatorio para correr
   # tests/seed/reset locales contra la branch development de Neon.
   ONETABLE_DB_ENV="development"
   ```

4. Verifica: `pnpm exec tsx scripts/db-guard.ts` debe imprimir
   `✅ DB guard: host permitido para operaciones destructivas locales.`

Nota: si más adelante corres `vercel env pull .env.local`, el pull trae las
vars del scope Development — revisa que `DATABASE_URL` haya quedado apuntando
a `development` y que el marker `ONETABLE_DB_ENV` siga presente (el pull lo
pisa solo si lo defines en Vercel; si no, re-agrégalo a mano).

---

## Paso 1 — Env vars por scope en Vercel (árbol de decisión)

Hoy la integración Neon maneja `DATABASE_URL`, `DATABASE_URL_UNPOOLED`,
`POSTGRES_*` y `PG*` con scope "All Environments" (apuntando a production).
El objetivo: cada scope de Vercel usa su branch de Neon.

| Scope Vercel | Branch de Neon |
|---|---|
| Production | `production` |
| Preview | `staging` (FIJA — no branch-por-preview) |
| Development | `development` |

**Opción 1 (preferida): restringir la integración a Production.**

1. En Vercel → Settings → Environment Variables, ubica las vars que maneja la
   integración Neon.
2. Si la integración permite editar el scope: restringe TODAS sus vars al
   scope **Production** únicamente.
3. Crea a mano `DATABASE_URL` en scope **Preview** con el connection string
   pooled de la branch `staging`.
4. Crea a mano `DATABASE_URL` en scope **Development** con el string pooled
   de la branch `development`.

**Opción 2 (fallback): si la integración NO permite editar el scope.**

1. En la configuración de la integración Neon (Vercel → Integrations →
   Neon → Manage), desconecta el sync de environment variables (la conexión
   de la DB no se toca, solo el sync de vars).
2. Crea `DATABASE_URL` manual en los TRES scopes con el string de la branch
   correspondiente según la tabla de arriba.

En ambas opciones: redeploy de production después del cambio para confirmar
que nada se rompió (el valor efectivo de Production no debe cambiar).

---

## Paso 2 — Secrets del backup en GitHub

El workflow `.github/workflows/backup.yml` (dump diario cifrado) necesita dos
secrets de Actions:

1. `BACKUP_DATABASE_URL`: el connection string **DIRECTO/unpooled** de la
   branch `production` (en Neon: el string SIN `-pooler`). `pg_dump` contra
   el pooler falla o degrada.
2. `BACKUP_ENCRYPTION_KEY`: genera una passphrase con:

   ```bash
   openssl rand -base64 32
   ```

   Guárdala también en tu password manager — sin ella los dumps cifrados NO
   se pueden descifrar.

Cárgalos con el CLI (o en GitHub → Settings → Secrets and variables →
Actions → New repository secret):

```bash
gh secret set BACKUP_DATABASE_URL
gh secret set BACKUP_ENCRYPTION_KEY
```

(cada comando abre un prompt; pega el valor ahí para que no quede en el
history de la shell).

Para descifrar un dump descargado:

```bash
openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 \
  -in onetable-<stamp>.dump.enc -out onetable-<stamp>.dump \
  -pass env:BACKUP_ENCRYPTION_KEY
```

y restaurar con `pg_restore` (formato custom).

---

## Paso 3 — UptimeRobot

1. Crea una cuenta nueva en uptimerobot.com (el plan free alcanza).
2. Nuevo monitor:
   - Tipo: **HTTP(s)**.
   - URL: `https://<dominio-de-prod>/api/health`.
   - Intervalo: el mínimo del plan free (5 min).
3. Alert contact: tu email. Verifica que llegue el mail de confirmación.
4. Smoke: abre `/api/health` en el browser — debe responder
   `{"status":"ok","db":"up"}` con 200. El monitor marca DOWN cuando el
   endpoint devuelve 503 (DB caída) o no responde.

---

## Paso 4 — Mantenimiento de staging

La branch `staging` sirve a TODAS las previews. Cuando un smoke la ensucie
(datos de prueba, uploads basura), en la consola de Neon: branch `staging` →
**"Reset from parent"** — la vuelve a clonar desde `production`. Es la
operación estándar; no borres/recrees la branch.

**Advertencia (aprendido 2026-07-20):** toda branch NUEVA en Neon Free tier
nace con **auto-delete/expiración de 7 días** por default. Si algún día creas
otra branch (la que sea), desactiva el auto-delete inmediatamente al crearla
— `staging` y `development` ya lo tienen desactivado, pero el default
reaparece en cada branch nueva.

Nota: staging también está en la blocklist INCONDICIONAL del guard local
(igual que production) — para repoblarla o limpiarla se usa la consola de
Neon, nunca `pnpm db:seed`/`db:reset` desde tu máquina.

---

## Paso 5 — Riesgo de backups (leer, no ejecutar)

- El PITR del Free tier de Neon retiene solo **6 HORAS**. El dump diario del
  workflow es por lo tanto el **RESPALDO PRIMARIO**, no una segunda capa.
- Retención de artifacts: 7 días (~7 dumps). El storage de Actions del plan
  free es ~500MB y la DB hoy pesa ~36MB — hay margen, pero crece con la DB.
- **Antes del Programa Fundadores**: re-evaluar upgrade del plan de Neon
  (PITR más largo) o storage externo para los dumps (S3/R2). Registrado
  también en el backlog de hardening.

---

## Paso 6 — Verificación conjunta del gate T1

- **(a) Guard**: con un `.env.local` apuntando a production (o antes de
  ejecutar el paso 0), `pnpm test` debe abortar con el mensaje del DB guard
  sin tocar la DB. Evidencia ya capturada en el reporte del implementer.
  Después del paso 0, `pnpm test` debe correr verde contra `development`.
- **(b) Health**: `/api/health` responde 200 `{"status":"ok","db":"up"}` en
  la URL de preview del PR y en producción (post-merge).
- **(c) Backup dry-run — POST-merge**: GitHub solo registra el
  cron/`workflow_dispatch` desde la branch default, así que esto se hace
  después del merge a `main`: Actions → workflow `backup` → **Run
  workflow**. Verifica que el run termine verde, descarga el artifact,
  descífralo con el comando del paso 2 y confirma que `pg_restore --list`
  lista el contenido.
