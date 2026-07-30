# Handoff — Cierre de T1 (ENTORNOS + DEVOPS)

Fecha del handoff: 2026-07-30. T1 COMPLETADO el 2026-07-29 (confirmado por
Michael): PR #15 mergeado a main por squash (`936b8d1`, branch
`feat/hardening` borrada). Este handoff registra el estado FINAL del gate con
su evidencia y el cierre de los hallazgos del smoke de preview
(`session-t1-pasos-1-2.md` §7). Es el primer commit de la branch
`feat/hardening-t2` (patrón del cierre de Fase 2: docs de cierre abren la
branch del task siguiente).

## 1. Gate de T1 — CERRADO (los 3 criterios, con evidencia)

- **(a) Guard de entorno:** suite BLOQUEADA al apuntar a production y a
  staging (el guard corta antes de tocar la DB) y VERDE contra development —
  44 archivos, 424 tests. Doble mecanismo de `lib/db-guard.ts`: blocklist por
  host de los endpoints de production/staging + marker
  `ONETABLE_DB_ENV=development` obligatorio para hosts remotos.
- **(b) Health:** `GET /api/health` → 200 `{"status":"ok","db":"up"}` en la
  preview del PR #15 (contra la branch `staging` de Neon) Y en producción
  (`onetable-gold.vercel.app/api/health`, post-merge).
- **(c) Backup dry-run:** workflow `backup.yml` corrido a mano post-merge
  (workflow_dispatch), artifact descargado, descifrado con
  `BACKUP_ENCRYPTION_KEY` y validado con `pg_restore --list` OK. El cron
  diario queda operativo como respaldo primario (PITR del Free tier = 6h).

## 2. Monitoreo — UptimeRobot ACTIVO

Monitor de UptimeRobot sobre `/api/health` de producción con alerta por
email a Michael. Cierra el último [MICHAEL] del task (paso 3 del runbook
`docs/runbooks/t1-entornos-runbook.md`).

## 3. Hallazgos del smoke de preview — CERRADOS

- **H1 (`AUTH_URL` por scope) — CERRADO también en prod.** Resolución
  config-only de Michael (detalle en `session-t1-pasos-1-2.md` §7):
  Production → `https://onetable-gold.vercel.app`; Preview → entrada
  eliminada (`trustHost: true` deriva el host del request). Verificación en
  prod: incógnito → `/dashboard` redirige a
  `onetable-gold.vercel.app/login` (ya no al dominio de tercero
  `onetable.vercel.app`).
- **H3 (AI Gateway 403 `RestrictedModelsError`) — CERRADO.** Resolución:
  top-up de $20 USD en el AI Gateway (billing, sin redeploy). Re-test de
  Michael: chat FUNCIONANDO en preview y en producción. La DEPENDENCIA de
  T3 (créditos activos del gateway) queda satisfecha; el rate limit de T3
  sigue siendo la protección de ese saldo.

## 4. Estado del repo al cierre

- `main` @ `936b8d1` (squash del PR #15), working tree limpio.
- Branch nueva `feat/hardening-t2` creada off main para el bloque T2.
- Ledger (`.superpowers/sdd/hardening-backlog.md`): T1 marcado COMPLETADO en
  el CORTE punto 1; H3 → [x]; anotaciones de cierre en los ítems que
  citaban el gateway roto. Plan faro: línea de estado en §3 T1.

## 5. Próximo task

**T2 — SEGURIDAD (CORTE punto 2), gate ESTRICTO (auth + data layer).**
Parámetros ya decididos: bump `next` → 14.2.35 con protocolo supply-chain +
grep RSC post-bump + re-run `pnpm audit`; security headers enforced + CSP
staging/preview-enforced y prod-report-only vía `VERCEL_ENV`;
`session.maxAge` 24h + `updateAge` ~1h; dummy `bcrypt.compare`; rate limiter
Postgres REUSABLE (login + chat, límite por cliente); password policy mín 10
chars / cap 72 bytes; caps de 10MB pre-parse en `data/upload` y
`parametros/import`. Primer paso: brief con verificación empírica del estado
real (package.json + lockfile, `next.config.mjs`, `auth.ts`, signup route,
rutas de upload/import, `middleware.ts`) ANTES de afirmar nada — brief para
filtro externo, cero implementación hasta el go.
