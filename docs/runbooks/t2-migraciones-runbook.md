# Runbook T2 — Migraciones de DB por entorno (pasos de Michael)

> Hardening T2 Tanda B, 2026-08-04. Este runbook cubre la aplicación de
> migraciones Prisma en `staging` y `production`, que corre MICHAEL desde su
> terminal — Claude Code solo migra `development` (el guard de T1 bloquea
> todo lo demás, y las credenciales de staging/production nunca pasan por
> CC). El flujo es genérico: toda migración futura sigue estos mismos pasos.
>
> Migración que motiva el runbook: `20260805005159_add_rate_limit` (tabla
> `RateLimit` del rate limiter de T2 §5). Es puramente ADITIVA — el código
> deployado no la referencia hasta que el PR de T2 llegue — así que
> aplicarla ANTES del deploy es seguro y elimina la ventana
> deploy-sin-tabla. Sin la tabla en staging, el limiter de la preview
> caería en fail-open permanente (login/signup funcionan pero SIN rate
> limit y con log de errores en cada intento) — el smoke del gate no sería
> representativo.

---

## Regla de oro — de dónde salen los connection strings

**SIEMPRE de la CONSOLA DE NEON** (proyecto `quiet-dawn-60852807`):
branch → "Connect" → copiar el string **DIRECTO/unpooled** (el host SIN
sufijo `-pooler`). Prisma migrate es incompatible con PgBouncer transaction
pooling — misma familia de constraint que el `pg_dump` del backup de T1.

**PROHIBIDO** leer las vars legacy de Vercel (`DATABASE_URL_UNPOOLED`,
`POSTGRES_*`, `PG*`): siguen administradas por la integración apuntando a
**PRODUCTION en los 3 scopes** (ítem abierto del ledger). Un
`migrate deploy` "de staging" alimentado por una de esas vars migraría
production en silencio.

Si el comando falla con error de channel binding / TLS, quita
`&channel_binding=require` del string (deja `sslmode=require`) — mismo
remedio documentado para `BACKUP_DATABASE_URL` en el ledger.

---

## Paso 1 — Staging: ANTES de tu smoke de preview

Con el string **directo** de la branch `staging` copiado de la consola de
Neon (no lo pegues en ningún archivo del repo):

```bash
DATABASE_URL="<string DIRECTO de staging>" pnpm exec prisma migrate deploy
```

Verificación:

```bash
DATABASE_URL="<string DIRECTO de staging>" pnpm exec prisma migrate status
```

Debe reportar "Database schema is up to date". Recién entonces corre el
smoke sobre la URL de preview del PR (la preview usa la branch `staging`).

Nota: si en algún momento reseteas `staging` con "Reset from parent"
DESPUÉS de aplicar la migración pero ANTES del merge a production, el reset
la borra (clona el estado de production) — re-aplicala.

## Paso 2 — Production: ANTES del merge

Ídem con el string **directo** de la branch `production`:

```bash
DATABASE_URL="<string DIRECTO de production>" pnpm exec prisma migrate deploy
DATABASE_URL="<string DIRECTO de production>" pnpm exec prisma migrate status
```

La migración es aditiva: aplicarla pre-merge es seguro (el código en
producción no toca la tabla nueva) y garantiza que el deploy del merge
aterrice con la tabla ya presente.

## Paso 3 — Development (referencia, ya ejecutado)

`development` la migra el implementer de CC durante su run con
`prisma migrate dev` (ejecutado 2026-08-04 para `add_rate_limit`).
Mecanismo: el CLI de Prisma NO lee `.env.local` (solo `./.env`,
`prisma/.env` o el shell env; en este repo no existen los dos primeros) —
la var se exporta en el shell del comando leyéndola de `.env.local`.

## Futuro

Automatizar `migrate deploy` (buildCommand o GitHub Action) está registrado
en el ledger como ítem futuro, BLOQUEADO por el ítem de vars legacy de
Vercel: automatizar hoy obligaría a poner strings unpooled en secrets/vars
mientras las legacy siguen apuntando a production en los 3 scopes.
