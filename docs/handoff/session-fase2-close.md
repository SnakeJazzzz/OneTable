# Handoff — CIERRE DE FASE 2 + kickoff del bloque de HARDENING

Fecha: 2026-07-17. Fase 2 cerrada por Michael el 2026-07-16 (PR #14 mergeado,
main @ a5fc3ae, smoke de producción pasado). Esta sesión ejecutó el ritual de
cierre de FASE (docs) + el descubrimiento para el corte de scope del bloque de
hardening. NO se implementó ningún fix de producto.

> Handoff UNTRACKED a propósito (convención): viaja en el commit de cierre
> junto con su línea de índice en `docs/handoff/README.md` y el handoff de
> cierre de bloque B5 (también untracked).

## 1. Qué se hizo (branch `feat/hardening`, off main @ a5fc3ae)

### Tarea 1 — Cierre formal de Fase 2 (docs puros)
- **Archivado:** `git mv docs/specs/onetable-fase2-spec.md →
  docs/archive/fase2/onetable-fase2-spec.md`. Era la fuente única de verdad de
  Fase 2; ya ejecutada B0-B5.
- **Caza de punteros** (grep del filename viejo en todo el repo, referencias en
  docs ACTIVOS actualizadas; handoffs y docs ya archivados se dejaron como
  historia):
  - `README.md` (raíz): visión por fases actualizada (Fase 2 CERRADA, bloque de
    hardening EN CURSO, B6 fuera por archivos reales), punteros a la spec
    archivada.
  - `docs/README.md`: quitada la fila de la spec de docs activos, agregada
    `archive/fase2/` al registro histórico.
  - `docs/specs/onetable-fase3-spec-draft.md`: 3 referencias a la spec ahora
    apuntan a `docs/archive/fase2/…`; corregido el claim de `getCurrentClient()`
    (ver drift D3 abajo).
- **CLAUDE.md corregido** (cada claim verificado empíricamente primero, patrón
  B-4):
  - **Fence bug:** el archivo empezaba literal con `markdown#` (label de fence
    pegado en c104f33). Removido.
  - **Fase actual:** "Fase 2 (beta)" → "Bloque de HARDENING (pre-Fase 3)" con el
    estado real del cierre y B6 fuera de scope.
  - **Drift D3 (OK de Michael):** el helper `getCurrentClient(userId)`/
    `lib/tenant.ts` NUNCA existió (verificado: `ls lib/tenant.ts` → no such
    file; grep de `getCurrentClient` solo aparece en un comentario que niega su
    existencia en `app/api/parametros/skus/route.ts:10`). El mecanismo real es
    `requireAuth()` en `lib/auth-helpers.ts:50-60`: extrae `clientId` del JWT de
    sesión, ningún endpoint lo acepta del request. Corregido en CLAUDE.md D3 y
    en el draft de Fase 3.
  - **Documentos fuente de verdad:** reordenados — el autoritativo del bloque
    ahora es `hardening-backlog.md`; la spec de Fase 2 pasó a histórico.
  - **Ritual de arranque/cierre:** §"Cómo arranca" ahora apunta al backlog de
    hardening, no a `§12 B0→B6` de la spec archivada.
  - **Stack:** agregada la línea del chatbot IA de B5 (AI SDK 6, Haiku vía
    gateway, `AI_GATEWAY_API_KEY`).
  - **Operaciones destructivas de DB:** agregado el estado "trigger INMINENTE"
    (VIKS por cargar data real, Neon compartida) que eleva la disciplina.
  - **Pendientes conocidos:** re-verificados los 3 vigentes (#1 PREFLIGHT falta
    en `.env.example`, #3 key `prisma` en `package.json:17`, pendiente #4
    `check-supply-chain.sh` sin `set -euo pipefail`).

### Tarea 2 — Descubrimiento para el corte de scope (`hardening-backlog.md`)
- **Re-grounding:** los 20 ítems pre-existentes verificados uno por uno contra
  el repo real. TODOS siguen vigentes; NINGUNO obsoleto por B5. Evidencia
  file:line agregada al header del backlog.
- **Auditoría de superficie (ítems NUEVOS):** threat model del estado real vía
  3 auditorías paralelas (auth/sesiones, headers/manejo de errores, chatbot) +
  `pnpm audit`. Cada ítem con evidencia, severidad y esfuerzo. Resumen abajo.

## 2. Hallazgos de la auditoría (nuevos en el backlog, sección "Auditoría de superficie — 2026-07-17")

**CRÍTICO / ALTO:**
- **DB de prod separada + backups** [YA DECIDIDO como primer ítem]: Neon dev/prod
  compartida; `data/reset` borra data real de prod si se dispara desde dev.
- **`next@14.2.18`**: 1 CVE crítico (Authorization Bypass in Middleware, patched
  ≥14.2.25 — toca directo la capa de auth de `middleware.ts`) + 8 high (DoS/SSRF).
- **`xlsx@0.18.5`**: 2 high sin patch en npm (Prototype Pollution + ReDoS) sobre
  parseo de archivos subidos por el usuario.
- **Login timing side-channel + sin lockout**: enumeración por timing + guessing
  ilimitado de passwords.
- **`clientId` del JWT nunca re-validado** durante la vida del token (default 30d).

**MEDIO:** session maxAge default 30d; enumeración en signup (409 EMAIL_TAKEN);
password débil (min 6, sin cap 72 bytes); `trustHost` incondicional; cero
security headers; throws de DB → 500 crudo en la mayoría de rutas; sin error
boundaries en app/; prompt caching §9.1.2 NO configurado en código (verificar
gateway); sin `maxOutputTokens` ni cap de tamaño de archivo en upload.

**BAJO:** forecast sin try/catch; gateway key faltante → `CHAT_ERROR` opaco.

Detalle completo con file:line, severidad y esfuerzo en
`.superpowers/sdd/hardening-backlog.md`.

## 3. Estado del working tree al cierre de esta sesión

Branch `feat/hardening`. Cambios (todos DOCS, cero código de producto):
- `R` `docs/specs/onetable-fase2-spec.md` → `docs/archive/fase2/onetable-fase2-spec.md`
- `M` `CLAUDE.md`, `README.md`, `docs/README.md`,
  `docs/specs/onetable-fase3-spec-draft.md`, `docs/handoff/README.md`
- `??` `docs/handoff/session-b5-chatbot-block-end.md` (cierre de bloque B5,
  viaja acá), `docs/handoff/session-fase2-close.md` (este archivo)
- `M` (gitignored, `git add -f`) `.superpowers/sdd/hardening-backlog.md`

Sin correr la suite (cambios puramente de docs; no toca código ni tests).

## 4. Pendiente de Michael antes de implementar

1. **Autorizar el commit de cierre** ("commiteá"). Es el primer commit del
   branch `feat/hardening`, solo docs — excepción calibrada de doble review
   (filtro externo + Michael), como se acordó para cierres de docs.
2. **Cortar el scope del bloque** con su sparring externo sobre el backlog
   re-groundeado. El corte NO se decidió en esta sesión.
3. **⚠ `AI_GATEWAY_API_KEY` en Vercel** (heredado del handoff B5): sin ella el
   chat en prod está roto. Verificar antes del próximo smoke de prod.

## 5. Próximo paso recomendado

Primer ítem de implementación YA decidido por Michael, independiente del corte:
**DB de prod separada + backups** (trigger: VIKS por cargar data real). Arrancar
por ahí con el protocolo subagent-driven habitual (brief filtrado → implementer
fresco → doble review → diff a Michael → "commiteá").
