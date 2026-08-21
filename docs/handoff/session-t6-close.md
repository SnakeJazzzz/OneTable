# Handoff — Cierre de T6 (CIERRE DEL BLOQUE) y CIERRE DEL BLOQUE DE HARDENING

> Sesiones 2026-08-17 → 2026-08-20. T6 fue task de EJECUCIÓN + DECISIÓN
> (scan + triage + flip), no de features. Con su gate cerrado, el BLOQUE
> DE HARDENING completo queda CERRADO: T1-T6, PRs #15-#21, los cuatro
> criterios del plan §4 en verde. Plan faro archivado en
> `docs/archive/hardening/onetable-hardening-plan.md`.

## 1. Commits del task (orden cronológico)

1. `7f05c25` — paso 0 (docs): precisión del handoff de T5 — evidencia
   del announcer (paso 3 del smoke).
2. `59f285c` — freeze del brief v2 de T6 post-filtro (E1-E5 + decisiones
   de Michael sobre las 6 OQs; `t6-cierre-brief.md` congelado).
3. `24f9793` — **Tanda A**: fix jitless (`z.config({jitless:true})` en
   `lib/zod-jitless.ts`, primer import de chat-panel.tsx, requisito E3)
   — cierra el origen del eval del chunk 34 (zod 4.3.6
   `util.allowsEval`). Suite 511/54 en su momento.
4. `5383549` — F2 (docs): ZAP baseline + curl del body limit + triage
   F3 decidido por Michael sobre el reporte (`t6-zap-report.md` +
   `t6-zap-raw.html`).
5. `98a6e4e` — **Tanda B**: flip CSP enforced en prod, `form-action
   'self'`, COOP `same-origin`, `poweredByHeader: false`, cap/hash de
   key del limiter (I-3), P2025→404 en mappings (I-8), sweep RateLimit
   en backup.yml (I-4). Incluye el fix pass M-3 (`continue-on-error`
   del sweep) — fue UN solo commit, el fix pass se aplicó pre-commit
   con re-review del carril quality (PASS).
6. `538603f` — squash del PR #21 a main ("T6 — CIERRE DEL BLOQUE
   (hardening punto 6)"), merge de Michael, branch borrada.

## 2. Protocolo ejecutado

- **Dos tandas con ciclo completo cada una** (decisión E2 del filtro):
  implementer fresco con prefijo supply-chain literal, GREEN con árbol
  sucio (cero git del implementer), doble review CIEGA en carriles
  separados (spec compliance + code quality, agentes distintos, ninguno
  vio el output del otro), diff crudo + ambas reviews al filtro externo,
  "commiteá" de Michael.
  - Tanda A: spec PASS limpio / quality APPROVE WITH MINORS (cero
    MAJOR). Fix pass Q-2/Q-3 inline con re-review del carril quality
    (PASS); Q-1 y nit al ledger.
  - Tanda B: spec PASS WITH NOTES (7/7 piezas fieles, cero scope-creep)
    / quality APPROVE WITH MINORS (cero MAJOR). Fix pass M-3 inline con
    re-review del carril quality (PASS); M-2 y residual al ledger.
- **Drift sancionado** (precedente S-2 de T4 — desviación esencial
  reportada y sancionada): specifier bare `'crypto'` en
  `lib/rate-limit.ts` en vez del `node:crypto` del brief —
  `node:crypto` rompe el build del bundle EDGE (el módulo entra vía
  `auth.ts` → `middleware.ts`; `UnhandledSchemeError` del webpack edge
  de Next 14, verificado empíricamente). Misma API, cero cambio de
  comportamiento; trigger de re-unificación en el ledger (próximo bump
  de Next).
- **F2 — ZAP baseline + curl** (2026-08-18): baseline pasivo contra la
  preview del PR #21 (CSP enforced, Neon staging) con Protection Bypass
  vía replacer → FAIL 0 / WARN 11 (plugin-IDs) / PASS 56; 17 alertas
  nombradas → 15 filas triageadas (Z-12 agrupa las 3 variantes de
  storability del plugin 10049). HTML crudo verificado limpio de
  secrets (0 ocurrencias en 4 greps). Curl del body limit con TRES data
  points: 11MB → 413 `FUNCTION_PAYLOAD_TOO_LARGE` de plataforma, 5MB →
  413 ídem (consistente con el límite de 4.5MB, premisa E1 CONFIRMADA),
  control 10KB → 400 JSON de la app post-auth (el 413 no enmascara
  auth). Alcance declarado sin inflar: superficie pre-login; páginas
  autenticadas FUERA.
- **Triage F3** (Michael, 2026-08-18, sobre el reporte — sin sesión
  aparte): 12 decisiones registradas en `t6-zap-report.md` §5 —
  6 FIX-AHORA a Tanda B (Z-1, Z-7, Z-8, I-3, I-4, I-8), 2 riesgos
  aceptados con trigger (Z-4, I-5a), I-6 a .2, I-7 cerrado inalcanzable
  en Vercel, Q-5 de T4 decidido (`INTERNAL` ratificado canónico, cero
  código), resto descartado con análisis por fila.
- **F2 fue commit docs-only sin doble review** (excepción calibrada:
  filtro externo + Michael); ídem este cierre F5.

## 3. Gate de T6 — CERRADO (verificación del flip EN PROD por Michael, 2026-08-20 ~19:49-19:55 CDMX)

- curl a `https://onetable-gold.vercel.app/login` →
  `Content-Security-Policy` ENFORCED (sin `-Report-Only`) con
  `form-action 'self'`.
- `cross-origin-opener-policy: same-origin` presente; `x-powered-by`
  AUSENTE.
- Navegación completa de prod (login, dashboard, /analisis con chat
  streaming, /portales) con console limpia bajo filtro "Refused".
- Runtime Logs del csp-report en SILENCIO total durante la sesión —
  señal leída con el caveat de autenticidad de I-2 (la console del
  smoke manda; el silencio corrobora).
- Precondición dura del flip (origen del eval del chunk 34) cerrada en
  Tanda A y verificada dos veces: smoke F1 en preview (console de
  /dashboard y /analisis sin violation) y este smoke de prod.

## 4. CIERRE DEL BLOQUE — criterios del plan §4 en verde

1. **T1-T6 completados**: PRs #15 (T1), #16 (T2), #17+#18 (T3), #19
   (T4), #20 (T5), #21 (T6) — todos mergeados con gate cerrado y
   evidencia por task.
2. **ZAP baseline corrido y triageado**: F2 + F3 (arriba).
3. **CSP de prod enforced**: flip en Tanda B, verificado en prod
   (sección 3).
4. **Backlog re-anotado**: pasada final en `hardening-backlog.md` —
   I-1 CERRADO (origen zod + cifra "461/49" stale corregida a 517/55),
   I-2 parcialmente-stale re-anotado (rate limit existe desde T3; queda
   la autenticidad como nota de lectura permanente), I-9 constatado,
   I-3/I-4/I-8 marcados RESUELTOS con hashes, I-7 CERRADO, I-6 a .2,
   I-5 cerrado por triage, Q-5 T4 DECIDIDO, flip cerrado con evidencia,
   y sección nueva "T6 — cierre del bloque" con los destinos del triage.

## 5. Pendientes que deja el bloque

**Riesgo aceptado con trigger:**
- Z-4 `ACAO: *` de plataforma en superficie pública — re-mirar en Fase
  2.5 si aparece contenido sensible pre-login.
- I-5(a) writes anónimos del csp-report a Neon — si el flood duele:
  WAF/edge (.2).

**Hardening .2:**
- Nonces por request para eliminar `'unsafe-inline'` de
  script-src/style-src (deuda T2, pre-triaged).
- I-6 pre-check de Content-Length en uploads (residual solo
  dev/self-host).
- COEP (descartado ahora; re-evaluar solo si aparece necesidad de
  cross-origin isolation).

**Próximo touch:**
- `::warning::` explícito en fallo del sweep (backup.yml) — mitigación
  del residual sweep-only del fix pass M-3 (fallas solo-sweep quedan
  como anotación silenciosa del run).
- Re-unificar `'crypto'` → `node:crypto` cuando el edge layer de Next
  soporte el scheme (verificar en el próximo bump de Next).
- M-2: copy del 404 en race de PATCH de mappings (marginal).
- Guard eslint `no-restricted-imports` sobre zod en `components/**`
  (protección de un solo punto del jitless — Fase 2.5 / próximo touch
  de eslint).
- Minors "próximo touch" heredados de T4/T5 (en sus secciones del
  ledger).

**Operativos [MICHAEL]:**
- **Primer run real del sweep I-4**: próximo cron diario de backup.yml
  (07:17 UTC) o `workflow_dispatch` manual — verificar que el step
  corre verde y borra filas.
- Rotación/borrado del Protection Bypass secret post-scan
  (RECOMENDADO en el brief §8) — si no se hizo ya.

**Pre-Fundadores (sin cambio):**
- `xlsx` vendored (2 high sin patch en npm; mitigación actual: cap de
  10MB).
- Parse leniente de archivos no-xlsx (triage pre-Fundadores / .2).

## 6. Estado del repo al cierre

- `main` @ `538603f` (squash del PR #21). Branch `feat/hardening-t6`
  borrada. Suite en main: **517 tests / 55 archivos**, typecheck y
  build verdes. Prod deployada con CSP enforced.
- Branch de este cierre: `docs/hardening-cierre` (docs-only, PR
  "Cierre del bloque de hardening").
- Ledger `hardening-backlog.md` VIVO (no se archiva): fuente de la
  deuda para .2 y Fase 2.5.
- Plan faro archivado: `docs/archive/hardening/onetable-hardening-plan.md`
  (punteros activos actualizados en `docs/README.md` y `CLAUDE.md`).

## 7. Lecciones operativas nuevas de T6

- **Headers de preview con SSO de Vercel ON**: un curl sin bypass no ve
  la app — ve el muro SSO (302 a vercel.com/sso-api). Verificación de
  headers de preview: DevTools del browser autenticado, o curl con el
  header `x-vercel-protection-bypass`. El ZAP baseline necesita el
  bypass inyectado como header en TODOS los requests (replacer via
  `-z`), si no escanea el muro SSO en vez de la app.
- **Patrón de secrets para scans/curls**: Protection Bypass secret y
  cookie de sesión SIEMPRE por env vars del shell (jamás literales en
  comandos, logs o transcript); revisar el output crudo del scanner por
  capturas antes de commitear; rotación del secret post-scan.
- **Curl con control**: un test de límite de plataforma necesita un
  control chico que SÍ llegue a la app con las mismas credenciales —
  si no, un 413 podría enmascarar un muro de auth y el dato del triage
  sería inválido.

## 8. Próxima parada

**Fase 2.5 — landing + cuentas** (roadmap confirmado: Hardening →
Fase 2.5 → Fase 3 → Fundadores; pagos diferidos a post-Fase 3).
Primera tarea per plan §1 (nota 2026-07-29): **integración del dominio
`onetable.mx`** (comprado 2026-07-27) a Vercel, como tarea propia con
smoke propio. Arranque de sesión: brainstorm de Fase 2.5 con
re-grounding empírico (regla vigente) — el ledger tiene los ítems
marcados "Fase 2.5" (401 UX, enumeración de signup, Z-4, guard de
zod, theme/identidad visual pre-lanzamiento). El re-grounding DEBE
incluir la pasada de consistencia de los checkboxes pre-corte del
ledger que T2/T3 subsumieron y nunca se marcaron: security headers,
timing side-channel/lockout, `maxAge` default, política de password,
rate limit + caps + `maxOutputTokens` + caching del chat, cap de
archivo de upload — y el de re-validación de `clientId`, que es
PARCIAL (maxAge sí, re-validación no). Cada uno se verifica contra el
repo REAL antes de marcar (regla de backlog hygiene), no contra la
memoria de los cierres.
