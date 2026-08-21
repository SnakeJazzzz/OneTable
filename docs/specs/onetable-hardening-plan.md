# OneTable — Plan del bloque de HARDENING

> Documento faro del bloque (decisión de Michael 2026-07-20).
>
> **Regla de precedencia:** este plan manda en SCOPE, ORDEN y OWNERSHIP del
> bloque. El backlog (`.superpowers/sdd/hardening-backlog.md`) manda en DETALLE
> FINO y EVIDENCIA por ítem. Ante divergencia de scope, el plan gana.

---

## 1. Propósito y precedencia

Este documento fija qué entra al bloque de hardening, en qué orden se ejecuta y
quién es dueño de cada pieza: **[CC — código]** (Claude Code, dentro del repo)
vs **[MICHAEL — configuración humana]** (dashboards, consolas, secrets). El
detalle fino de cada task (evidencia file:line, severidades, greps) vive en la
sección "CORTE DE SCOPE — decidido por Michael 2026-07-20" del backlog y NO se
duplica acá.

Roadmap global (detalle en `CLAUDE.md` §Identidad del proyecto): Hardening →
Fase 2.5 (landing + cuentas) → Fase 3 (scrapers) → lanzamiento Fundadores;
VIKS arranca uso real post-Fase 3.

Nota Fase 2.5 (2026-07-29): dominio `onetable.mx` COMPRADO (2026-07-27);
su integración a Vercel se difiere a Fase 2.5 como tarea propia con smoke
(decisiones abiertas: apex vs www canónico, scope Production-only, DNS del
registrar .mx — A/CNAME manual vs nameservers a Vercel).

---

## 2. Registro de decisiones del bloque (2026-07-20)

- Trunk-based + previews de Vercel; NO branch `development` permanente.
- 3 branches de Neon (production / staging / dev) con `DATABASE_URL` por scope
  en Vercel (Production / Preview / Development).
- Backups = retención PITR del plan de Neon verificada + `pg_dump` semanal
  cifrado vía GitHub Action.
- Smoke de Michael sobre la URL de preview del PR = gate obligatorio pre-merge.
- `/api/health` con check de DB + monitor externo UptimeRobot con alerta a
  Michael.
- CSP: enforced en staging/preview desde el inicio; report-only en producción;
  flip de prod a enforced al quedar limpios los smokes de staging.
- `session.maxAge` 24h + `updateAge` ~1h (logout por ~1 día de inactividad).
- Auth: dummy `bcrypt.compare` para email inexistente + rate limit de login por
  email/IP con contador en Postgres + password policy (mín 10 chars, cap 72
  bytes por truncado de bcrypt).
- Cap de 10MB pre-parse en uploads (`data/upload`, `parametros/import`).
- Chatbot: límite por cliente (default 40/día), `maxOutputTokens` ~2000, cap
  ~8k chars por mensaje, caching verificado o `cache_control` explícito, system
  prompt anti-invención.
- Modelo verificado en la observability del gateway 2026-07-20:
  `anthropic/claude-haiku-4.5`, 28 requests, $0.22 — consistente con CERO
  caching.
- Rate limiter = UN solo mecanismo Postgres compartido login+chat; sin Redis ni
  dependencias nuevas.
- Sentry diferido con criterios: se escapan errores en la práctica con
  logs+Vercel, el dep tree pasa supply-chain al install, el free tier alcanza.
- Agente de triage de errores sobre logs = experimento post-bloque;
  prerequisito: logs estructurados (T4).
- ZAP baseline al cierre del bloque, con triage fix-ahora vs "hardening .2".
- xlsx = riesgo aceptado interim (cap 10MB); build vendored del CDN
  pre-Fundadores.
- Scrapers en repo separado con modelo push (detalle:
  `docs/specs/onetable-fase3-spec-draft.md` §Arquitectura de automatización).
- Protocolo supply-chain re-validado vigente (campañas activas confirmadas
  hasta jul 2026: Miasma 01-jun, AsyncAPI 14-jul).

---

## 3. Roadmap de tasks T1-T6

> T1..T6 = puntos 1..6 del CORTE DE SCOPE del backlog (detalle fino ahí). Cada
> task separa [CC — código] de [MICHAEL — configuración humana] y define su
> gate.

### T1 — ENTORNOS + DEVOPS (CORTE punto 1)

> **Estado: COMPLETADO 2026-07-29** — PR #15 mergeado a main (`936b8d1`);
> gate cerrado con evidencia (guard + 424 tests, health preview y prod,
> backup dry-run con `pg_restore --list` OK); UptimeRobot activo. Detalle:
> `docs/handoff/session-t1-close.md`.

**[MICHAEL — configuración humana]**
- Crear branches `production` y `staging` en la consola de Neon; capturar los
  connection strings.
- Configurar `DATABASE_URL` por scope en Vercel (Production / Preview /
  Development).
- Verificar el plan de Neon y anotar los días de retención PITR.
- Crear cuenta/monitor de UptimeRobot con alerta.
- Cargar los secrets del cron de backup en GitHub (URL de prod + clave de
  cifrado del dump).
- Editar `.env` local a mano (el hook `block-env-writes` impide a CC tocarlo).

**[CC — código]**
- `/api/health` con check de DB + test.
- Workflow YAML del `pg_dump` semanal cifrado.
- Verificar que la suite y los scripts locales solo puedan apuntar a dev.
- RUNBOOK paso a paso para la lista de Michael.
- Actualizar `CLAUDE.md` con el mapa de entornos y la regla de gate de preview.

**Gate:** ESTRICTO + verificación conjunta (`pnpm test` no toca prod; health
responde en preview y prod).

### T2 — SEGURIDAD (CORTE punto 2)

> **Estado: COMPLETADO 2026-08-11** — PR #16 mergeado a main (`0f0d44e`);
> gate cerrado con evidencia (migraciones aplicadas a staging y production
> con strings directos de Neon, smoke de preview con CSP enforced y console
> limpia, csp-report de prod verificado con POST manual → 204 + log en
> Runtime Logs, violations reales en prod: CERO). Suite 461 tests / 49
> archivos. Detalle: `docs/handoff/session-t2-close.md`.

**[CC — código]**
- Bump `next` 14.2.18 → 14.2.35 con protocolo supply-chain + grep RSC
  post-bump + re-run `pnpm audit` registrando los highs restantes.
- Security headers + CSP por entorno (`VERCEL_ENV`).
- `session.maxAge` 24h + `updateAge` ~1h.
- Dummy `bcrypt.compare` para email inexistente.
- Rate limiter Postgres (modelo Prisma + migración + helper REUSABLE).
- Password policy (mín 10 chars, cap 72 bytes).
- Caps de 10MB en `data/upload` y `parametros/import`.

**[MICHAEL — configuración humana]**
- Autorizar la migración de schema.
- Smoke completo sobre preview con CSP enforced (login, upload, dashboard,
  chat).
- Revisar violations del report-only en prod.

**Gate:** ESTRICTO (auth + data layer).

### T3 — CHATBOT (CORTE punto 3)

> **Estado: COMPLETADO 2026-08-13** — PR #17 mergeado a main (`3ff2438`) +
> fix post-gate de caching §4.6 en PR #18 (`67d9d91`); gate cerrado con
> evidencia (migraciones aplicadas a staging y production con strings
> directos de Neon; smoke de calidad en preview con los 4 guiones
> anti-invención pasados y console sin violations CSP; caching
> write→read verificado en producción — ~85% de ahorro por request
> cacheado, 52% en la sesión medida; la causa del 0/0 del anclaje
> message-level original quedó DESCONOCIDA tras refutar dos hipótesis —
> no reintroducirlo sin evidencia nueva). Suite 479 tests / 49 archivos.
> Detalle: `docs/handoff/session-t3-close.md`.

**[CC — código]**
- Reusar el rate limiter con límite por cliente (default 40/día).
- `maxOutputTokens` ~2000; cap ~8k chars por mensaje;
  `cache_control`/`providerOptions`.
- System prompt anti-invención + fix del framing "cuentas de la plataforma".

**[MICHAEL — configuración humana]**
- Verificar cache hits en la observability del gateway post-deploy (evidencia
  de costo por request antes/después).
- Smoke de calidad pidiendo recomendaciones para verificar que se detiene en
  vez de inventar.

**Gate:** ESTRICTO en route/config + smoke de Michael.

### T4 — ROBUSTEZ / OBSERVABILIDAD (CORTE punto 4)

> **Estado: COMPLETADO 2026-08-15** — PR #19 mergeado a main (`9ef19a1`);
> gate cerrado con evidencia (smoke (d) sobre el preview de la branch:
> `error.tsx` con estilo de la app ante DB caída real, 500 JSON
> `INTERNAL` + líneas de log estructurado verificadas EN VIVO en Runtime
> Logs, 24 rutas ƒ en build, e2e completo post-restauración; CI re-valida
> 510 tests / 53 archivos). `withRouteErrors` en 23/24 rutas (nextauth
> excluida por evidencia empírica OQ-1) + `ServiceError` + guards de
> body + boundaries + logs estructurados (prerequisito del agente de
> triage: CUMPLIDO). Detalle: `docs/handoff/session-t4-close.md`.

**[CC — código]**
- Error boundaries (`error.tsx`, `global-error.tsx`, `not-found.tsx` con
  estilo de la app).
- Sweep `withRouteErrors()` + error codes/classes en los services en UNA sola
  pasada.
- Logs estructurados con contexto en el error path.

**[MICHAEL — configuración humana]**
- Smoke de boundaries forzando un error en staging.

**Gate:** ESTRICTO (toca todas las rutas).

### T5 — COPY (CORTE punto 5)

> **Estado: COMPLETADO 2026-08-17** — PR #20 mergeado a main
> (`b73c6e8`); gate UI cerrado con smoke completo de Michael (guión §10
> del brief: MTL con restauración y anti-envenenamiento, 429 sin doble
> punto con captura y restauración de `chatDailyLimit`, idioma §4.4).
> Suite 510/53. Detalle: `docs/handoff/session-t5-close.md`.

**[CC — código]**
- Barrido voseo → tuteo con re-grep.

**[MICHAEL — configuración humana]**
- Smoke visual.

**Gate:** UI.

### T6 — CIERRE DEL BLOQUE (CORTE punto 6)

**[CC — código]**
- Correr ZAP baseline contra staging (docker local) y entregar reporte
  triageado.

**[MICHAEL — configuración humana]**
- Triage conjunto y decisión fix-ahora vs "hardening .2".
- Autorizar el flip de CSP en prod a enforced.
- Verificación final.

**Gate:** decisión de Michael.

---

## 4. Criterios de cierre del bloque

- T1-T6 completados o cortados explícitamente por Michael.
- ZAP baseline corrido y triageado.
- CSP de prod enforced.
- Backlog re-anotado con lo que se movió de gate.

---

## 5. Punteros

- Detalle fino + corte de scope: `.superpowers/sdd/hardening-backlog.md`
  (§CORTE DE SCOPE).
- Arquitectura de scrapers y AES-GCM: `docs/specs/onetable-fase3-spec-draft.md`.
- Contexto operativo y reglas: `CLAUDE.md`.
- Handoffs de sesión: `docs/handoff/` (índice en su README).
