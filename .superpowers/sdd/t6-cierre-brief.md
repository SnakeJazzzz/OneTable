# Brief T6 — CIERRE DEL BLOQUE (hardening punto 6) — v2

> Para el filtro externo de Michael. v1 2026-08-17 → filtro: GO CON
> ENMIENDAS (E1-E5) + decisiones de Michael sobre las 6 OQs. Este v2
> (2026-08-17, mismo día) incorpora todo; las OQs quedan RESUELTAS e
> integradas en el cuerpo — no hay sección de open questions porque no
> surgió ninguna nueva genuina al redactar. Generado sobre
> `feat/hardening-t6` @ `7f05c25` (árbol limpio). CERO implementación
> hasta el go; el v2 vuelve al filtro antes del freeze y del dispatch.
> Fuentes: plan faro §3 T6 / §4, ledger §CORTE punto 6 + grep completo
> "T6|pre-T6", handoffs T4 §4 y T5 §3-§4, CLAUDE.md.
> T6 es task de EJECUCIÓN + DECISIÓN, no de features: el scan corre,
> el triage es conjunto, el flip lo autoriza Michael. El corazón de
> este brief es el split [CC]/[MICHAEL] (§8).

---

## 1. Verificación empírica (2026-08-17, comandos re-corribles)

### 1.1 Origen del eval del chunk 34 — RESUELTO: zod 4.3.6 (`util.allowsEval`)

**La precondición dura del flip está cumplida en su parte de
identificación.** Evidencia en cadena, cada paso re-corrible:

1. **El build local reproduce el chunk byte-idéntico.** `pnpm build`
   sobre `7f05c25` emite `.next/static/chunks/34-09a2e5143d5aa06c.js`
   — MISMO content-hash que el chunk citado por los reports CSP de los
   smokes de T4/T5. Lo que se analiza abajo ES el código que corrió en
   los deployments (hash de webpack = hash de contenido).
2. **La posición exacta del report (`16:36104`) es el probe de zod.**
   ```bash
   awk 'NR==16' .next/static/chunks/34-09a2e5143d5aa06c.js | cut -c36050-36200
   # → ...userAgent?.includes("Cloudflare"))return!1;try{return Function(""),!0}catch(e){return!1}...
   ```
   Línea 16, col ~36104 cae exactamente en `Function("")`. Es el ÚNICO
   chunk del build con ese patrón (`grep -l 'Function("")'` sobre
   todos los chunks → solo el 34). No hay ningún `eval(` literal en el
   bundle (los matches de "eval" son `Nevalida` — locale esperanto de
   zod — y `unevaluatedItems`; el chunk contiene el marker de versión
   `{major:4,minor:3,...}` = zod 4.3.x).
3. **Mapeo al source del vendor.** `node_modules/zod/v4/core/util.js:150-163`:
   `allowsEval = cached(() => { ...if UA includes "Cloudflare" return false;
   try { const F = Function; new F(""); return true } catch { return false } })`.
   Es FEATURE-DETECTION con catch — por eso las páginas funcionan con
   el eval bloqueado (dato del smoke de T5): zod cae al parse no-JIT.
   El report CSP dispara igual (los reports se emiten aunque la
   excepción se capture).
4. **Hay un segundo eval-site, cubierto por el mismo gate.**
   `Doc.compile()` (`return Function(...)`, byte-offset ~150950 del
   chunk) es el compilador JIT del fast-pass de `$ZodObject`. Solo es
   alcanzable si el probe devolvió `true`:
   `node_modules/zod/v4/core/schemas.js:901-918` —
   `const jit = !core.globalConfig.jitless; const fastEnabled = jit && allowsEval.value;`
   → con `jitless: true`, el `&&` hace short-circuit y **el probe ni
   siquiera se evalúa**: cero `Function`, cero violation.
5. **Cadena de import al client bundle.**
   `components/analisis/chat-panel.tsx:27-28` (`useChat` de
   `@ai-sdk/react`, `DefaultChatTransport`/`isToolUIPart` de `ai`) →
   `ai@6.0.168` → `@ai-sdk/provider-utils@4.0.23` (peer
   `zod ^3.25.76 || ^4.1.8`, resuelto al `zod@4.3.6` pineado del
   proyecto) → zod v4 entero en el bundle client de /analisis.
   `app-build-manifest.json`: el chunk 34 aparece SOLO en
   `/(dashboard)/analisis/page`.
6. **Por qué disparó también en /dashboard** (smoke T5, 06:04Z): el
   chunk se carga/evalúa vía client-side navigation/prefetch del App
   Router hacia /analisis; `allowsEval` es `cached()` → un probe por
   evaluación del módulo (una vez por pestaña). Consistente con dos
   reports puntuales y no un stream continuo. (Explicación plausible
   con mecanismo verificado; el document-uri del report refleja la
   página activa al momento de evaluar el módulo.) El eval histórico
   de /promotoria (T2, Report-Only, otro hash de chunk) es
   plausiblemente la misma familia — mismo vendor re-chunkeado — pero
   no lo re-verifiqué contra ese build viejo: no afecta la decisión.
7. **El fix de config del vendor EXISTE y está verificado empírico**
   (regla bidireccional: no afirmar sin correr):
   ```bash
   node -e "const {z}=require('zod'); z.config({jitless:true}); console.log(JSON.stringify(z.core.globalConfig))"
   # → {"jitless":true}
   ```
   `config`/`jitless` son API pública tipada de zod 4.3.6
   (`node_modules/zod/v4/core/core.d.ts:67`, export en
   `classic/external.d.ts:8`).

**DECISIÓN DE MICHAEL (2026-08-17): opción A — fix jitless
(`z.config({ jitless: true })`), incondicional (sin guard
`typeof window`).** El jitless aplica también en SSR/server (los tools
del chat parsean no-JIT: costo marginal aceptado, cero cambio
funcional, código más simple — una rama menos que testear). La opción
B (riesgo aceptado documentado) queda **DESCARTADA** y se registra el
porqué: técnicamente era segura (el fallback de zod funciona con el
eval bloqueado), pero con prod enforced cada sesión que navegue
/analisis emitiría violations al csp-report → ruido PERMANENTE
exactamente en la señal que el flip necesita limpia, y en Runtime
Logs. `'unsafe-eval'` en la CSP nunca fue opción (dictado del task;
además no hay nada que desbloquear — las páginas funcionan).

La spec del fix (incluido el REQUISITO de orden de evaluación de
módulos) vive en §4, Tanda A.

### 1.2 CSP actual por entorno — el flip es cambio de CÓDIGO

`lib/security-headers.ts` (resuelto a BUILD time vía `VERCEL_ENV`,
`resolveCspEnv` líneas 50-54):

| Entorno | Header | Detalle |
|---|---|---|
| production | `Content-Security-Policy-Report-Only` | `buildCspHeader`, líneas 101-107: la key se elige por `env === 'production'` |
| preview (staging) | `Content-Security-Policy` ENFORCED | mismas directivas estrictas |
| development | ENFORCED + relaxations (`'unsafe-eval'`, `ws:`) | líneas 77-82 |

**El flip = diff commiteable de ~3 líneas** (quitar el branch de
`buildCspHeader` o invertir la condición) + test
(`tests/lib/security-headers.test.ts:37-39` asserta hoy Report-Only
para production) + comments desactualizados (líneas 14-15, 99-100 del
lib; posiblemente docstrings). NO es env var ni config de dashboard.
Consecuencia para el split: [CC] escribe el diff (dentro de la Tanda
B, §4); el flip EFECTIVO ocurre en el deploy de prod post-merge — que
es de [MICHAEL] (merge + verificación `curl -sI
https://onetable-gold.vercel.app | grep -i content-security`).

Nota de triage esperable: ZAP va a flaggear `'unsafe-inline'` en
script-src/style-src (líneas 74-79, 88). Es deuda CONOCIDA y
registrada de T2 (nonces por request via middleware = fuera de scope,
comment en el propio builder). Pre-triaged: riesgo aceptado del
bloque, candidato .2/futuro — no re-litigar en el triage.

### 1.3 ZAP baseline — qué hace falta y qué alcance REAL tiene

- **Docker local: CLI 28.4.0 y daemon ACTIVO** (verificado
  `docker info` → ServerVersion 28.4.0). La config es de [MICHAEL];
  hoy ya está operativa en esta Mac.
- **HALLAZGO que condiciona el runbook: Vercel Authentication (SSO)
  está ON para el proyecto** — verificado vía API
  (`ssoProtection: enabled, all_except_custom_domains`) y
  empíricamente:
  ```bash
  curl -s -o /dev/null -w "%{http_code}\n" https://onetable-gold.vercel.app/api/health   # 200 (prod, público)
  curl -s -D - -o /dev/null https://onetable-git-feat-hardening-t6-michael-devlyn-s-projects.vercel.app/api/health | grep -i location
  # → location: https://vercel.com/sso-api?url=...  (302: muro SSO de Vercel)
  ```
  **Un ZAP sin credenciales contra la preview escanea el muro SSO de
  Vercel, no la app.** Se necesita el **Protection Bypass for
  Automation** secret ([MICHAEL] lo genera en Project Settings →
  Deployment Protection) inyectado por ZAP como header
  `x-vercel-protection-bypass` en TODOS los requests (mecanismo: el
  replacer de ZAP vía flag `-z`, ver §4 F2). El secret es un secret
  real: no se commitea, no va a logs, se pasa por env var del shell.
  Rotarlo/borrarlo post-scan es RECOMENDADO (§8).
- **Target:** la URL de preview del PR de T6 (alias
  `onetable-git-feat-hardening-t6-michael-devlyn-s-projects.vercel.app`,
  ya existe con el push de `7f05c25`) — corre contra Neon `staging` y
  con CSP ENFORCED, que es el estado que el flip llevará a prod.
  Consistente con el plan ("contra staging").
- **Modo:** `zap-baseline.py` de la imagen estable oficial
  (`ghcr.io/zaproxy/zaproxy:stable`; el nombre legacy en Docker Hub es
  `zaproxy/zap-stable` — cualquiera de los dos, el pull lo decide
  Michael). Baseline = spider (~1 min) + reglas PASIVAS; cero active
  scan, cero payloads de ataque.
- **Alcance REAL, sin inflar:** el baseline NO soporta login de la app
  (la autenticación de ZAP con context files es del scan completo, no
  del baseline). Superficie efectiva = **pre-login**: `/` (redirect),
  `/login`, `/signup`, `/api/health`, headers/estáticos de esas
  respuestas, y los 401/redirects de las rutas protegidas. Las
  páginas autenticadas (dashboard, análisis, portales, parámetros,
  promotoría) y los flujos con sesión quedan FUERA — se declara así
  en el reporte. Lo que sí cubre bien: headers de seguridad,
  cookies, CSP, redirects, info-leaks de superficie pública — que es
  exactamente la superficie expuesta a internet pre-Fase 3.
- **Dimensión preview-vs-prod del reporte (E4):** la superficie
  escaneada es la PREVIEW con bypass — Vercel inyecta headers y
  artefactos propios de previews (p.ej. `x-robots-tag: noindex`,
  headers del bypass) que NO existen en prod, y a la inversa la
  preview corre CSP enforced mientras prod hoy es Report-Only. Cada
  hallazgo del reporte sale marcado en columna propia:
  **"artefacto de plataforma/preview"** vs **"aplica a prod"** (con
  el matiz post-flip cuando corresponda).
- **Efecto colateral declarado:** el spider puede POSTear el form de
  login → filas de rate-limit y ruido en la DB de staging. Post-scan:
  "Reset from parent" de staging en Neon ([MICHAEL], runbook T1 ya lo
  contempla).
- **Entregable:** reporte triageado en
  `.superpowers/sdd/t6-zap-report.md` — tabla por hallazgo: regla ZAP,
  evidencia (URL + header/valor), severidad ZAP, dimensión
  preview-vs-prod (E4), análisis de CC (aplica/falso positivo/deuda
  conocida con puntero al ledger), recomendación fix-ahora vs .2 vs
  descartar. El HTML crudo de ZAP se guarda junto (`t6-zap-raw.html`)
  — path durable, no /tmp; ambos artefactos se commitean con
  `git add -f` (§7).

### 1.4 Inventario COMPLETO del ledger con destino T6 / pre-T6

Grep re-corrible: `grep -n -i "t6\|pre-t6" .superpowers/sdd/hardening-backlog.md`
(11 hits, todos auditados; recomendación entra/no-entra en §5).

| # | Ítem (ledger línea) | Estado empírico verificado |
|---|---|---|
| I-1 | Eval del chunk 34 — precondición dura del flip (63-82) | Origen RESUELTO (§1.1). Decisión de Michael: fix jitless (Tanda A, §4). |
| I-2 | csp-report "sin rate limit ni autenticidad" (909-913) | **PARCIALMENTE STALE**: T3 §4.7 YA implementó rate limit por IP — `app/api/csp-report/route.ts:20,59-66` (60 reports/15min por IP, consumo post-parse-guard, drop silencioso 204). Lo que QUEDA: autenticidad (reportes forjables DENTRO del budget con curl). Es caveat de LECTURA de la evidencia del flip, no código pendiente. Re-anotar el ledger (criterio §4 "backlog re-anotado"). |
| I-3 | Sin cap de longitud de `key` del limiter (954-959, "destino T6") | Vigente en `lib/rate-limit.ts`. Matiz verificado: csp-report usa IP como key (`route.ts:58` — `x-forwarded-for` primer elemento, confiable y de longitud acotada EN Vercel), así que el agravante real del vector key-larga sigue siendo `login:email` (email ~5KB → upsert lanza → fail-open silencioso del scope email). Fix candidato barato: truncar/hashear keys > N chars antes del SQL. |
| I-4 | Sin TTL/sweep global de filas stale (960-965, "destino T6") | Vigente. Agravado por csp-report público (keys IP one-shot de flood quedan para siempre — crecimiento sin cota en Neon Free). Candidato ya apuntado por el cierre de T3 (1055-1057): sweep piggyback en `.github/workflows/backup.yml` (cron diario YA existente, cero infra nueva) — un `DELETE FROM "RateLimit" WHERE windowStart < now() - interval X`. |
| I-5 | Q-6 de T3: propiedades heredadas del limiter en endpoint sin auth (1046-1057, "triage a más tardar en T6") | Es el paraguas de I-3/I-4 + "(a) cada POST anónimo = un write a Neon" (el limiter acota el LOGGING, no la carga de DB). El triage de T6 lo CIERRA decidiendo I-3/I-4; (a) no tiene fix barato sin infra (WAF/edge) → declarar riesgo aceptado con trigger de revisión. |
| I-6 | Pre-check de Content-Length en uploads (948-953, "ya diferido a T6" según 347) | Vigente (`req.formData()` materializa antes del chequeo `file.size`). **Premisa corregida por el filtro (E1):** la documentación oficial de Vercel (Functions Limits, actualizada 2026-07-01) sigue declarando **4.5MB** como máximo de request body (413 `FUNCTION_PAYLOAD_TOO_LARGE`); la afirmación del v1 sobre "bodies de 100MB" queda RETIRADA (confundía beta de bundle size / otros productos). El curl de F2 (§4) es la verificación definitiva. Resultado esperado: **413 de plataforma ANTES del código de la app** → I-6 se queda en .2 (el riesgo residual es solo dev/self-host, ya anotado). |
| I-7 | Lado API del cap per-file 10MB (332-348, "Destino: T6 solo el lado API, si se triagea que vale") | El smoke de T5 respondió el lado UI (gate client-side intercepta, cero POST). Mismo curl de F2: resultado esperado 413 de plataforma → I-7 **cierra como inalcanzable en Vercel para clientes API** (el cap server queda como defensa en profundidad para dev/self-host). Si el curl contradice la premisa, el triage decide con el dato en mano. |
| I-8 | Q-1 de T4: race doble-DELETE/PATCH → P2025 → 500 (1133-1142, "próximo touch de mappings/route.ts o triage T6") | Vigente. Fix barato conocido: mapear `PrismaClientKnownRequestError` P2025 → 404 en los dos catch (`app/api/portales/mappings/route.ts:88-96,134-146`) + test. Ventana angosta, datos finales correctos — severidad baja. |
| I-9 | Audit baseline limpio del critical de `@auth/core` antes de T6 (871-874) | **YA EJECUTADO** (Tanda B de T2, 2026-08-04: `@auth/prisma-adapter` removido, los 3 GHSAs fuera del audit). Cero acción; solo constatarlo al cierre. |

NO tienen destino T6 (se declaran para que Michael vea el corte
completo): minors Q-1..Q-4 de T5 y Q-2/Q-3/Q-4/Q-6/Q-7 de T4
("próximo touch" de sus archivos / ".2"), parse leniente de no-xlsx
(triage pre-Fundadores / .2), deuda UX del 401 (Fase 2.5),
enumeración de signup (Fase 2.5), xlsx vendored (pre-Fundadores).
Caso especial Q-5 de T4 (`INTERNAL` vs `INTERNAL_ERROR`): **decidido
por Michael** — SOLO la DECISIÓN se toma dentro del triage conjunto
de F3 (el bloque cierra aquí y el agente de triage es lo siguiente);
el código va al próximo touch de `lib/route-errors.ts` o al kickoff
del agente.

**Interacción I-1 ↔ Q-1/Q-2/Q-3 de T5 — RESUELTA por Michael:** la
línea de import que la Tanda A agrega a `chat-panel.tsx` **NO
dispara** la regla "próximo touch" ("touch" = edición funcional del
área de manejo de errores, no un import ajeno). Los minors siguen
diferidos en el ledger con su destino intacto.

### 1.5 Criterios de cierre del bloque (plan §4) vs estado real

| Criterio | Estado HOY | Qué falta exactamente |
|---|---|---|
| T1-T6 completados o cortados | T1-T5 COMPLETADOS (PRs #15-#20, gates cerrados con evidencia) | T6 = este task |
| ZAP baseline corrido y triageado | NO corrido | F2-F3 de §4 (scan + triage conjunto) |
| CSP de prod enforced | Report-Only (`lib/security-headers.ts:101-107`) | Tanda A (jitless) + Tanda B (flip) + merge + verificación post-deploy |
| Backlog re-anotado con lo que se movió de gate | Parcial (T1-T5 anotados al cierre de cada task) | Pasada de re-anotación T6: I-2 stale, I-9 constatado, destinos finales del triage (fix-ahora vs .2 vs aceptado), origen del eval documentado, y la observación menor del filtro: la cola del ítem del eval (ledger ~línea 82) dice "Suite 461/49" — cifra stale de la era T2, corregir en la misma pasada |

Además, por CLAUDE.md §"Cómo cierra cada sesión" (cierre de BLOQUE):
mover specs/planes ejecutados a `docs/archive/` + actualizar
`docs/README.md` + handoff final. Entra al scope docs de F5.

---

## 2. Parámetros ya decididos (no re-abrir)

- ZAP **baseline** (pasivo) contra **staging** vía preview; triage
  conjunto fix-ahora vs "hardening .2"; flip de CSP autorizado por
  Michael (plan §2 y §3 T6).
- `'unsafe-eval'` NO entra a la CSP en ningún caso.
- El barrido de copy NO se reabre (T5 cerrado).
- Prod no tiene usuarios reales hasta post-Fase 3 → el flip no tiene
  ventana de riesgo de usuarios (decisión 2026-07-20).
- Merges solo Michael; smoke de preview obligatorio pre-merge; commits
  docs-only post-smoke no lo invalidan.
- No reintroducir el anclaje message-level de caching sin evidencia
  nueva (T3).
- **Decisiones de Michael 2026-08-17 (ex-OQs del v1, integradas en el
  cuerpo):** fix jitless opción A, incondicional sin guard; el import
  en chat-panel NO dispara "próximo touch"; estructura de DOS TANDAS
  con doble review ciega completa en ambas (E2); curl >10MB pre-triage
  con premisa corregida (E1); decisión Q-5 de T4 dentro del triage.

---

## 3. Scope propuesto

**Entra (columna vertebral, no negociable dentro de T6):**
1. **Tanda A:** fix jitless (I-1, decidido) — ciclo completo de
   implementación (§4 F0).
2. ZAP baseline contra la preview del PR T6 (ya con el fix) + reporte
   triageado con dimensión preview-vs-prod.
3. Curl autenticado >10MB contra la preview (verificación definitiva
   de I-6/I-7) ANTES del triage.
4. Triage conjunto con Michael de: hallazgos ZAP + I-3, I-4, I-5(a),
   I-6/I-7 (con el dato del curl), I-8, y la decisión de Q-5 de T4
   (tabla única, cada ítem con recomendación — §5).
5. **Tanda B:** fixes autorizados del triage + diff del flip de CSP —
   un solo ciclo completo idéntico al de la Tanda A (§4 F4).
6. Cierre del bloque: re-anotación del ledger (incluye I-2 stale, I-9
   constatado y el "Suite 461/49" stale de ~línea 82), criterios §4
   en verde, archivo de docs de bloque, handoff final.

**Candidatos de la Tanda B, SOLO con go explícito de Michael en el
triage (fix barato ya dimensionado):** I-3 (cap de key), I-4 (sweep
piggyback), I-8 (P2025 → 404), más lo que el ZAP mande a fix-ahora.

**NO entra:** todo lo listado en §1.4 como "NO tienen destino T6";
cualquier hallazgo ZAP que el triage mande a .2; features nuevas de
cualquier tipo.

---

## 4. Plan de ejecución — DOS TANDAS (E2, confirmado por Michael)

> Razón de la estructura: el scan debe reflejar el estado final que va
> a prod, y NADA llega a la preview sin commit autorizado. Por eso el
> fix jitless va en su propia tanda ANTES del scan (Tanda A), y los
> fixes del triage + el flip van juntos en una segunda tanda después
> (Tanda B). Ambas con el ciclo completo del protocolo — implementer
> fresco con prefijo supply-chain, doble review ciega en carriles
> separados, diff crudo al filtro, "commiteá" de Michael.

- **F0 — TANDA A: fix jitless** [ciclo completo]. Spec del fix:
  - Módulo nuevo `lib/zod-jitless.ts`: importa `z` de `zod`, llama
    `z.config({ jitless: true })` a nivel de módulo, INCONDICIONAL
    (sin guard `typeof window` — decisión de Michael; aplica también
    en SSR/server, costo marginal aceptado). Comment con el porqué
    (violation CSP del probe `allowsEval`, puntero al ledger).
  - **REQUISITO de spec (E3) — orden de evaluación de módulos:**
    `z.config` debe ejecutar ANTES de cualquier construcción/parse de
    schemas zod del grafo cliente. Mecanismo: evaluación depth-first
    de módulos ES → `lib/zod-jitless.ts` va como PRIMER import de
    `components/analisis/chat-panel.tsx`, y el módulo lleva comment
    advirtiendo NO reordenar imports (los sorters de imports son el
    riesgo típico).
  - Verificación de tanda: typecheck, suite, build (GREEN, árbol
    sucio, cero git del implementer). Test unit barato opcional del
    implementer: importar el módulo y assertar
    `z.core.globalConfig.jitless === true`.
  - Ciclo: implementer fresco + doble review ciega + diff crudo al
    filtro + "commiteá" de Michael + push → la preview de F1/F2
    CONTIENE el fix.
- **F1 — PR de T6 + verificación empírica del requisito E3**
  [MICHAEL]: PR abierto con la Tanda A → preview deploy contra
  staging con CSP enforced. El smoke de preview verifica EN CONSOLE:
  /analisis y /dashboard SIN la violation de eval — esa observación
  ES la verificación empírica del requisito de orden de módulos (E3)
  y el cierre de la precondición dura del flip (preview enforced es
  el laboratorio exacto del estado post-flip).
- **F2 — ZAP baseline + curl del body limit** [CC ejecuta; MICHAEL
  provee]. Michael genera el Protection Bypass secret y lo pasa por
  env var del shell; CC corre (comando de referencia, se congela en
  el runbook del PR):
  ```bash
  docker run --rm -v "$(pwd)/zap-out:/zap/wrk:rw" ghcr.io/zaproxy/zaproxy:stable \
    zap-baseline.py -t https://onetable-git-feat-hardening-t6-michael-devlyn-s-projects.vercel.app \
    -r t6-zap-raw.html \
    -z "-config replacer.full_list(0).description=vercelbypass \
        -config replacer.full_list(0).enabled=true \
        -config replacer.full_list(0).matchtype=REQ_HEADER \
        -config replacer.full_list(0).matchstr=x-vercel-protection-bypass \
        -config replacer.full_list(0).replacement=$VERCEL_BYPASS_SECRET"
  ```
  Salida triageada a `.superpowers/sdd/t6-zap-report.md`, cuya tabla
  lleva la columna preview-vs-prod (E4). El HTML crudo
  (`t6-zap-raw.html`) es output de ZAP tal cual — sin columna ni
  edición; solo se sanitiza si captura el bypass header. Ambos
  artefactos se commitean con `git add -f` (§7).
  **Curl del body limit (pre-triage, decisión de Michael):** POST
  autenticado >10MB contra `data/upload` de la preview (bypass header
  + cookie de sesión de la cuenta de smoke de staging que Michael
  provea — la cookie viaja IGUAL que el bypass secret: env var del
  shell, jamás literal en el comando ni en logs/transcript;
  alternativamente lo corre Michael con CC dictando el comando). Resultado esperado (premisa E1): **413
  `FUNCTION_PAYLOAD_TOO_LARGE` de la plataforma antes del código de
  la app**. El dato va a la tabla del triage (I-6/I-7 se deciden con
  resultado en mano).
  Post-scan: [MICHAEL] resetea staging ("Reset from parent") si quedó
  sucia.
- **F3 — Triage conjunto** [MICHAEL decide, CC documenta]: tabla única
  (hallazgos ZAP con su dimensión preview-vs-prod + I-3/I-4/I-5a +
  I-6/I-7 con el dato del curl + I-8 + la decisión de Q-5 de T4 —
  SOLO la decisión, el código no entra a T6). Cada fila sale con:
  fix-ahora / .2 / riesgo aceptado documentado.
- **F4 — TANDA B: fixes autorizados + flip de CSP** [ciclo completo,
  idéntico al de la Tanda A]. Contenido: los fix-ahora que F3
  autorizó + el diff del flip (`buildCspHeader` + test + comments,
  §1.2). Ciclo: implementer fresco + doble review ciega + diff crudo
  al filtro + "commiteá" + push. Después: smoke de preview de Michael
  (obligatorio pre-merge; preview ya corre enforced — el flip no
  cambia preview) + merge (squash) por Michael. Post-deploy:
  [MICHAEL] verifica
  `curl -sI https://onetable-gold.vercel.app/ | grep -i content-security`
  → `Content-Security-Policy` (sin `-Report-Only`) + navegación de
  prod con console limpia + csp-report de Runtime Logs quieto. La
  señal se lee con el caveat de I-2 (forjable dentro del budget):
  console limpia del smoke manda; el silencio del csp-report
  corrobora.
- **F5 — Cierre del bloque** [CC docs / MICHAEL verifica]:
  re-anotación del ledger (I-2, I-9, destinos del triage, origen del
  eval, y el "Suite 461/49" stale de ~línea 82 — observación del
  filtro), plan faro §3 T6 y §4 marcados, archivo de specs ejecutadas
  a `docs/archive/` + `docs/README.md`, handoff final del bloque,
  siguiente parada declarada (Fase 2.5).

Orden F0→F1→F2: el scan corre DESPUÉS del fix del eval para que los
hallazgos reflejen el estado final que va a prod (y para que el
baseline no reporte ruido del probe ya decidido).

---

## 5. Recomendaciones por ítem (Michael corta; ninguno se omite)

| Ítem | Recomendación | Por qué |
|---|---|---|
| I-1 eval chunk 34 | **DECIDIDO: fix jitless — Tanda A (F0)** | Fix de vendor-config real, verificado empírico, ~5 líneas; la opción B (descartada) ensuciaba permanentemente la señal post-flip |
| I-2 csp-report autenticidad | NO entra como código; **entra como re-anotación + caveat de lectura** | El rate limit ya existe (T3); autenticidad no tiene fix barato y la evidencia del flip no depende solo de esa señal |
| I-3 cap de key del limiter | **Candidato Tanda B si Michael lo corta a fix-ahora** (~1h con test) | Vector real en login:email (fail-open silencioso); cierre limpio del bloque de seguridad |
| I-4 sweep global TTL | **Candidato Tanda B como piggyback en backup.yml** (cron diario existente, cero infra) | Crecimiento sin cota en Free tier; el candidato ya estaba apuntado al cierre de T3 |
| I-5(a) writes anónimos a Neon | Riesgo aceptado documentado + trigger de revisión (si el flood duele: WAF/edge, .2) | Sin fix barato app-level; el limiter ya acota el logging |
| I-6 Content-Length pre-check | **Se decide con el curl de F2 en mano.** Resultado esperado (premisa E1: 4.5MB de plataforma, 413 antes del código): queda en .2 (riesgo residual solo dev/self-host, ya anotado) | La premisa del v1 ("100MB") fue corregida por el filtro; el curl es la verificación definitiva |
| I-7 cap per-file lado API | **Se decide con el mismo curl.** Resultado esperado: cierra como INALCANZABLE en Vercel para clientes API (el cap server queda como defensa en profundidad dev/self-host) | Ídem I-6; si el curl contradice la premisa, el triage decide con el dato |
| I-8 P2025 → 404 | Triage; candidato Tanda B (2 catches + test) si Michael quiere cerrar sin 500s conocidos; si no, queda "próximo touch" | Severidad baja (race angosta, datos correctos), pero es el último 500 conocido del bloque |
| I-9 audit critical | Cero acción — constatar en el handoff | Ya ejecutado en T2 Tanda B |
| Q-5 T4 (INTERNAL vs INTERNAL_ERROR) | **DECIDIDO: la decisión se toma en el triage de F3** (solo decisión; código al próximo touch de lib/route-errors.ts o al kickoff del agente) | "Decidir antes del agente post-bloque" y el bloque cierra aquí |

---

## 6. No-tocar

- Todo lo cerrado en T1-T5, salvo lo que el triage del ZAP mande CON
  autorización explícita de Michael por ítem.
- El barrido de copy (T5) no se reabre; tuteo intacto.
- `chat-panel.tsx` más allá de la línea de import de la Tanda A: los
  minors Q-1/Q-2/Q-3 de T5 NO se activan (decisión de Michael — el
  import no es "touch" funcional del área de manejo de errores).
- `scripts/preflight.ts` (LEGACY — no correr).
- Vars legacy de Vercel (`DATABASE_URL_UNPOOLED`, `POSTGRES_*`, `PG*`)
  — prohibido leerlas.
- El anclaje message-level de caching (T3) — no reintroducir.
- Directivas de la CSP más allá del flip de key: NO se agregan
  orígenes, NO se agrega `'unsafe-eval'`, los `'unsafe-inline'` quedan
  como deuda registrada (nonces = .2/futuro).
- La branch `staging` de Neon solo se toca vía "Reset from parent"
  ([MICHAEL]); el guard de `lib/db-guard.ts` no se modifica.

---

## 7. Riders

- **Supply chain:** T6 no instala NADA por diseño (ZAP corre en
  docker, fuera del árbol npm). Si algún fix del triage requiriera un
  paquete: se aplica el protocolo completo de CLAUDE.md + reporte en
  handoff. Verificación post-task obligatoria igual (checklist §8 de
  CLAUDE.md) aunque no haya installs.
- **Secrets:** el Protection Bypass secret jamás se commitea ni se
  loguea; vive en el shell de Michael. El HTML crudo de ZAP se revisa
  antes de commitear por si captura headers sensibles (el bypass va en
  request headers — ZAP los incluye en evidencias; sanitizar si
  aparece). La rotación post-scan es RECOMENDADA (§8).
- **Artefactos ZAP (E5a):** `t6-zap-report.md` y `t6-zap-raw.html`
  van a `.superpowers/sdd/` y se commitean con **`git add -f`**
  SIEMPRE — el path está gitignored aunque tracked, mismo tratamiento
  que el ledger; no confiar en check-ignore para este path.
- **Staging sucia post-ZAP:** reset from parent de Neon ([MICHAEL]).
- **Minors nuevos de reviews de T6:** al ledger en el mismo commit
  (`git add -f`), nunca al diff — protocolo vigente.
- **Cero shells de background al cerrar turno; cero loops de polling**
  sobre vercel/gh (incidente 2026-07-29). La verificación de deploys
  es de Michael o un chequeo puntual de CC a pedido.

---

## 8. Split [CC]/[MICHAEL] — el corazón del task

**[CC — código/ejecución]**
- Tanda A: fix jitless (spec §4 F0) — implementer fresco, GREEN con
  árbol sucio, doble review ciega, diff crudo al filtro.
- Correr el ZAP baseline (docker, comando congelado en el runbook del
  PR) y producir el reporte triageado con dimensión preview-vs-prod +
  análisis por hallazgo; commitear artefactos con `git add -f` (tras
  sanitizar el HTML si captura el bypass header).
- Correr el curl autenticado >10MB (o dictárselo a Michael) y llevar
  el resultado a la tabla del triage.
- Tanda B: fixes autorizados + diff del flip — mismo ciclo completo.
- Re-anotación del ledger, archivo de docs del bloque, handoff final.

**[MICHAEL — configuración humana/decisión]**
- "Commiteá" de cada tanda (A y B) tras el filtro; push/PR/merge.
- Generar el Protection Bypass secret (Project Settings → Deployment
  Protection) y proveerlo por shell; **rotarlo/borrarlo post-scan:
  RECOMENDADO** (el secret viaja en args de proceso y en las
  evidencias de ZAP).
- Proveer la cookie/cuenta de smoke de staging para el curl de F2 (o
  correrlo él con el comando dictado).
- Smoke de preview del PR T6 (obligatorio pre-merge): console de
  /analisis y /dashboard sin violation de eval (= verificación E3) +
  flujo e2e normal.
- Todas las decisiones del triage (F3), incluida la de Q-5 de T4.
- Reset from parent de staging post-ZAP si quedó sucia.
- Autorizar el flip dentro de la Tanda B + merge del PR (squash) +
  borrar branch.
- Verificación final post-deploy de prod: header enforced via curl,
  navegación con console limpia, Runtime Logs del csp-report quieto.
- Dar por cerrado el BLOQUE (gate de T6 = su decisión, plan §3).
