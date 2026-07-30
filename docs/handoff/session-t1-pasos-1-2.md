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

- **El ambiente "Pre-production (custom)" NO existe** — el handoff externo
  lo listó como ambiente existente de Vercel; claim erróneo: leyó una
  opción del dropdown de FILTROS de la página de Environment Variables
  como si fuera un ambiente real del proyecto. Verificado por Michael con
  screenshots (2026-07-29): Settings → Environments solo muestra
  Production, Preview y Development; "Pre-production" tampoco aparece como
  opción de scope al crear env vars — es UI de Vercel, no un ambiente del
  proyecto. Nadie creó ni borró nada. (Una versión previa de este handoff,
  commiteada en da7797a, registró el claim como "ambiente custom de origen
  no rastreado, borrado por Michael" — también incorrecto; este párrafo es
  la corrección factual.) Contexto de diseño: no existe ni se necesita
  pre-prod como ambiente de Vercel — el diseño T1 es trunk-based + preview
  contra staging fija; pre-prod real se crearía con intención y con branch
  de Neon propia.

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

## 7. Smoke de preview (2026-07-29)

Smoke de 6 puntos de Michael sobre la preview del PR #15:

1. **`/api/health`** → `{"status":"ok","db":"up"}` — **criterio (b) mitad
   preview CERRADO.**
2. **Login OK** con cuenta nueva creada en staging. Aclaración importante:
   los tests NO tocaron staging — el wipe fue en development, por diseño;
   staging conserva el snapshot de production del 2026-07-20 (Michael no
   recordaba el password de la demo). Onboarding completo re-ejecutado OK.
3. **Redirect incógnito:** en preview lo intercepta la Deployment
   Protection de Vercel antes que el app (esperado — doble muro); en
   producción el redirect del middleware SÍ disparó pero a dominio
   equivocado → H1.
4. **Dashboard con data OK.**
5. **Portales y Análisis OK; chatbot ERROR** → H3.
6. **Data de prueba quedó en staging** (se limpia con "Reset from parent"
   cuando Michael quiera).

### Hallazgos (PRE-EXISTENTES de configuración, fechados 18-may en Vercel; ninguno introducido por el PR — el smoke sobre preview los sacó a la luz por primera vez)

**H1 — `AUTH_URL` mal configurada por scope (root cause de dos síntomas) —
RESUELTO por Michael (2026-07-29, config-only en Vercel):**

- (a) signOut en preview redirigía a `https://$vercel_url/login` LITERAL
  (`DNS_PROBE_FINISHED_NXDOMAIN`) — el valor del scope Preview era el
  string `$VERCEL_URL` sin interpolar; Vercel NO interpola valores de env
  vars.
- (b) En producción, `/dashboard` sin sesión redirigía a
  `https://onetable.vercel.app/login` — dominio que NO pertenece al
  proyecto (el proyecto vive en `onetable-gold.vercel.app`;
  `onetable.vercel.app` es de un tercero y hoy sirve un 404 ajeno) —
  superficie menor de phishing. El comment viejo de `.env.example`
  documentaba exactamente esa config rota.
- Resolución: Production `AUTH_URL=https://onetable-gold.vercel.app`;
  scope Preview: entrada `AUTH_URL` ELIMINADA por completo (`auth.ts`
  tiene `trustHost: true` → NextAuth deriva el host del request en cada
  preview); Development intacta (`localhost:3000`). `.env.example`:
  comment corregido a mano por Michael.
- Nota técnica: el login normal nunca se rompió porque el form postea
  same-host; `AUTH_URL` solo gobierna URLs absolutas (signOut, redirect
  del middleware) — flujos que nunca se habían smokeado antes.

**H3 — Chatbot en preview: error opaco al preguntar** ("Ocurrió un error
al procesar tu pregunta"). Hipótesis principal: `AI_GATEWAY_API_KEY` sin
el scope Preview. Michael revisó el scope en Vercel y lo corrigió si
faltaba; el CIERRE de H3 es el re-test del chat sobre la preview
regenerada (los cambios de env vars solo aplican a deployments nuevos).
Si el re-test sigue fallando: H3 queda abierto en el ledger con siguiente
paso = diagnóstico por logs del deploy de preview; se resuelve en T3 (no
bloquea el merge de T1 — decisión de Michael).

**Regla nueva del gate de preview (decisión de Michael, 2026-07-29,
registrada en CLAUDE.md):** los commits docs-only posteriores al smoke NO
lo invalidan — el smoke ata al código que corre, no a los docs.
