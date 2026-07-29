# Handoff — T1 pasos 1-2 del runbook (ejecución humana, Vercel + GitHub)

Fecha: 2026-07-29. Branch `feat/hardening`, PR #15 abierto (T1 commiteado en
`2c19587`). Michael ejecutó los pasos 1-2 de
`docs/runbooks/t1-entornos-runbook.md` con ayuda de un chat EXTERNO sin
contexto del bloque; este handoff registra los hechos FILTRADOS por el
sparring externo (los claims erróneos del handoff externo se corrigen en §3
para que no renazcan).

> Handoff untracked a propósito (convención): viaja en el commit de docs de
> esta sesión junto con su línea de índice en `docs/handoff/README.md`.

## 1. Paso 1 — Env vars por scope en Vercel: CERRADO

**Verificación empírica (la que manda):** `vercel env pull` por ambiente
ANTES del fix mostró los TRES scopes resolviendo a production (`ap8e9lyb`).
DESPUÉS del fix: production→`ap8e9lyb`, preview→`apedj0u3` (staging),
development→`apphzoy1`. Preview y Development ya no tocan prod.

**Método real (variante de la opción 2 del runbook):** se borró SOLO la
`DATABASE_URL` administrada por la integración Neon y se crearon 3 entradas
manuales por scope (pooled; **Sensitive OFF** — Sensitive rompe `env pull` y
Vercel lo prohíbe en Development). Marker `ONETABLE_DB_ENV=development`
agregado en scope Development. Redeploy de prod + smoke OK
(onetable-gold.vercel.app, valor idéntico al previo).

**TRADE-OFF ACEPTADO:** la integración ya no propaga rotaciones de
credenciales de `DATABASE_URL`; una rotación en Neon se replica A MANO en
los 3 scopes + `BACKUP_DATABASE_URL`. (Nota de mantenimiento agregada al
runbook en esta misma sesión.)

## 2. Paso 2 — Secrets del backup en GitHub: CERRADO

- `BACKUP_DATABASE_URL`: string unpooled de production, con
  `channel_binding=require`.
- `BACKUP_ENCRYPTION_KEY`: passphrase guardada en el password manager ANTES
  de setear el secret.
- Ambos vía `gh secret set`; `gh secret list` confirma los dos.

Nota preventiva: si el dry-run del backup (post-merge) falla con error de
channel binding en el runner, remover `channel_binding=require` del secret y
dejar `sslmode=require`. (Espejo en el ledger.)

## 3. Correcciones a claims del handoff externo (para que no renazcan)

- **`backup.yml` SÍ existe** — commiteado en `2c19587`; artifacts + retención
  7 días ya decididos. El chat externo afirmó que faltaba crearlo.
- **T1 NO está cerrado** — faltan: (b) health en preview (smoke de Michael) y
  en prod (post-merge), (c) dry-run del backup (post-merge), UptimeRobot
  (paso 3) y el merge del PR #15.
- **El guard NO afecta previews** — solo corre en tests/seed/reset
  (`tests/setup.ts`, `scripts/seed.ts`, `scripts/db-guard.ts`); nada de eso
  se ejecuta en builds ni en runtime de Vercel.

**Ambiente custom "Pre-production" en Vercel (hallazgo post-pasos, resuelto):**
Michael confirmó con screenshot que en Vercel existía un ambiente CUSTOM
"Pre-production", de origen no rastreado (probablemente creado por el chat
externo durante los pasos 1-2; nuestro flujo nunca lo creó). Michael lo
verificó vacío — sin branch asignada ni vars propias — y lo BORRÓ el
2026-07-29. Razón de la decisión: el diseño T1 es trunk-based + preview
contra staging fija; el ítem de pre-producción del backlog quedó fuera del
corte — si algún día se quiere pre-prod real, se crea con intención y con
branch de Neon propia.

## 4. Ítems nuevos al ledger (registrados en esta sesión)

1. Vars legacy de la integración (`DATABASE_URL_UNPOOLED`, `POSTGRES_*`,
   `PG*`) siguen administradas apuntando a PRODUCTION en los 3 scopes —
   inerte hoy, footgun futuro.
2. Confirmar el toggle de preview-branching OFF en la config de la
   integración Neon (evidencia empírica lo sugiere; falta ver el toggle).
3. Espejo de la nota de channel binding del §2.

## 5. Fase 2.5 — dominio

`onetable.mx` COMPRADO (2026-07-27). Integración diferida a Fase 2.5 como
tarea propia con smoke. Decisiones abiertas: apex vs www canónico, scope
Production-only, DNS del registrar .mx (A/CNAME manual vs nameservers a
Vercel). Registrado en el plan de hardening (§1 roadmap) y en el backlog.

## 6. Estado del gate T1 tras esta sesión

- (a) Guard: CERRADO (ambas mitades, ver PR #15).
- (b) Health: mitad preview PENDIENTE del smoke de Michael sobre la preview
  del PR #15 (que ya corre contra staging gracias al paso 1); mitad prod
  post-merge.
- (c) Backup dry-run: post-merge (secrets ya cargados).
- Pendiente también: UptimeRobot (paso 3, post-merge) y merge (solo Michael).
