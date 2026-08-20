# T6 — ZAP baseline + curl del body limit — reporte triageado (F2)

> Generado 2026-08-18 sobre `feat/hardening-t6` @ `24f9793` (PR #21,
> preview con Tanda A — jitless — incluida; smoke F1 de Michael PASADO).
> Ejecuta el brief congelado `t6-cierre-brief.md` §4 F2 y §1.3. Las
> recomendaciones son de CC; TODAS las decisiones son de Michael en el
> triage conjunto (F3). CC no implementó nada en F2.

---

## 1. Parámetros del scan

- **Target:** `https://onetable-git-feat-hardening-t6-michael-devlyn-s-projects.vercel.app`
  (preview del PR #21 → Neon `staging`, CSP **enforced** — el
  laboratorio exacto del estado post-flip).
- **Herramienta:** `ghcr.io/zaproxy/zaproxy:stable` (pull 2026-08-18,
  digest `sha256:781a2bda…`), `zap-baseline.py` — spider 1 min +
  reglas PASIVAS. Cero active scan, cero payloads.
- **Comando** (el secret viajó por env var del shell; jamás literal):

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

- **Resultado global:** `FAIL-NEW: 0 · WARN-NEW: 11 · PASS: 56`
  (exit 0). Los 11 plugin-IDs con WARN se desglosan en 17 alertas
  nombradas en el HTML (10055 y 90004 agrupan sub-alertas).
- **Reconciliación 17 alertas ↔ 15 filas de §3 (M1, verificado
  contra el HTML):** la tabla §3 tiene una fila por alerta nombrada,
  salvo Z-12, que agrupa las TRES variantes de storability del plugin
  10049 ("Non-Storable Content", "Storable and Cacheable Content",
  "Storable but Non-Cacheable Content") — mismo plugin, mismo
  análisis (comportamiento correcto de plataforma), misma decisión.
  17 − 2 = 15 filas; ninguna alerta quedó fuera.
- **Sanitización del HTML crudo (constancia):** se grep-eó
  `t6-zap-raw.html` y `zap.yaml` por el valor del bypass secret, el
  nombre del header `x-vercel-protection-bypass`, el valor de la
  cookie de sesión y el prefijo `authjs.session-token` → **0
  ocurrencias en los cuatro chequeos**. No hizo falta sanitizar; el
  HTML es output de ZAP tal cual. Movido a
  `.superpowers/sdd/t6-zap-raw.html`.

## 2. Declaración de alcance REAL (sin inflar)

Baseline pasivo = **superficie pre-login únicamente**: `/` (307 →
/login), `/login`, `/signup`, `/robots.txt` y `/sitemap.xml` (ambos
404 — no existen), estáticos `_next/*`, y los redirects de rutas
protegidas. Las páginas autenticadas (dashboard, análisis, portales,
parámetros, promotoría) y todo flujo con sesión quedan **FUERA** — el
baseline no soporta login de app. Lo que sí cubre bien: headers de
seguridad, cookies, CSP, redirects e info-leaks de la superficie
pública — exactamente la superficie expuesta a internet pre-Fase 3.

Verificación E4 hecha durante el triage: el CSP de la preview es
**byte-idéntico** al de prod salvo la key (`Content-Security-Policy`
enforced en preview vs `-Report-Only` en prod) — verificado con curl a
ambos el 2026-08-18. Los hallazgos de headers se re-verificaron contra
prod (pública) caso por caso; la columna E4 de cada fila sale de esa
verificación empírica, no de supuestos.

## 3. Hallazgos ZAP triageados

| # | Regla ZAP | Evidencia (URL + header/valor) | Sev. ZAP | Preview vs prod (E4) | Análisis CC | Recomendación |
|---|---|---|---|---|---|---|
| Z-1 | 10055 CSP: Failure to Define Directive with No Fallback | `/`, `/robots.txt`, `/sitemap.xml` — Other Info de ZAP: "The directive(s): **form-action** is/are among the directives that do not fallback to default-src" | Medium | **Aplica a prod** (mismo CSP; hoy Report-Only, post-flip enforced idéntico) | APLICA. Sin `form-action`, un XSS podría exfiltrar vía `<form action=evil>`. Mitigado parcialmente porque los forms reales son onSubmit client-side, pero la directiva es tightening puro, 0 orígenes nuevos. Nota: brief §6 veta agregar ORÍGENES y `'unsafe-eval'`; agregar `form-action 'self'` es restricción, no relajación — pero es cambio de directivas ⇒ decisión de Michael | **Fix-ahora (Tanda B)**: `form-action 'self'` en `buildCspHeader` + test (~15 min, va en el mismo diff del flip) |
| Z-2 | 10055 CSP: script-src `'unsafe-inline'` | Mismas URLs; política completa en evidencia | Medium | Aplica a prod (mismo CSP) | **Deuda PRE-TRIAGED de T2** — nonces por request = fuera de scope del bloque, comment en el propio builder. NO se re-litiga (brief §1.2) | .2/futuro (ya decidido) |
| Z-3 | 10055 CSP: style-src `'unsafe-inline'` | Ídem Z-2 | Medium | Aplica a prod | Ídem Z-2 | .2/futuro (ya decidido) |
| Z-4 | 10098 Cross-Domain Misconfiguration | `Access-Control-Allow-Origin: *` en `/`, `_next/static/*` (js/css), `/robots.txt`, `/sitemap.xml` | Medium | **Aplica a prod** — verificado: prod `/login` (200) y `/robots.txt` (404) también lo mandan | Header inyectado por plataforma/Next (no está en `lib/security-headers.ts` ni lo emiten las rutas API — verificado: la respuesta 400 de `/api/data/upload` NO lo trae). Solo cubre superficie pública/estáticos; sin `Allow-Credentials`, el CORS credencializado sigue bloqueado ⇒ nada no-público se vuelve legible cross-origin | **Riesgo aceptado / descartar**, con trigger: re-mirar en Fase 2.5 si aparece contenido sensible pre-login |
| Z-5 | 10055 CSP: Notices | "report-uri has been deprecated in favor of report-to" | Low | Aplica a prod | `report-uri` sigue soportado universalmente; `report-to` requiere `Reporting-Endpoints` y pierde soporte en browsers viejos. Trade-off conocido; el pipeline csp-report de T3 depende de report-uri | **Descartar** (revisar cuando browsers deprequen de verdad) |
| Z-6 | 90004 COEP missing | `/`, `/login`, `/signup` sin `Cross-Origin-Embedder-Policy` | Low | Aplica a prod | Solo necesario para cross-origin isolation (SharedArrayBuffer etc.) que la app no usa; COEP mal puesto rompe recursos embebidos | **Descartar/.2** |
| Z-7 | 90004 COOP missing | Mismas URLs sin `Cross-Origin-Opener-Policy` | Low | Aplica a prod | Hardening barato (`same-origin`): aísla el window de openers cross-origin. Sin flujos OAuth popup que romper. No urgente | **.2** (1 línea en el builder cuando se re-toque) |
| Z-8 | 10037 X-Powered-By leak | `X-Powered-By: Next.js` en el 307 de `/` | Low | **Aplica a prod** — verificado: prod `/` (307) lo manda | APLICA. `poweredByHeader: false` en `next.config.mjs` no está seteado (verificado). Fingerprinting menor; fix de 1 línea | **Fix-ahora (Tanda B)**: `poweredByHeader: false` (~5 min con snapshot de headers si existe test) |
| Z-9 | 10024 Sensitive Information in URL | `GET /login?email=…&password=ZAP`, `GET /signup?...&password=ZAP` | Info | Artefacto del SCAN (ni preview ni prod) | **FALSO POSITIVO**: esas URLs las forjó el propio spider — los `<form>` de login/signup son `onSubmit` client-side sin `method`/`action` (`app/(auth)/login/page.tsx:58`, `signup/page.tsx:96`); el flujo real POSTea vía NextAuth. Ningún usuario manda credenciales por query string | Descartar (opcional cosmético: `method="post"` defensivo en el JSX — próximo touch, no T6) |
| Z-10 | 10111 Authentication Request Identified | El mismo GET forjado del spider | Info | Artefacto del scan | Consecuencia de Z-9; informativo de ZAP, no hallazgo | Descartar |
| Z-11 | 10015 Re-examine Cache-control | `cache-control: public, max-age=0, must-revalidate` en `/`, `/login`, `/signup` | Info | Aplica a prod (default de Vercel para SSR) | `max-age=0, must-revalidate` fuerza revalidación siempre — no hay riesgo de stale/caching de contenido privado en la superficie pre-login (que además es pública) | Descartar |
| Z-12 | 10049 Non-Storable / Storable Content | `no-store` en el 307; `max-age=31536000` immutable en `_next/static/*` | Info | Aplica a prod (plataforma) | Comportamiento correcto: redirects no-store, estáticos content-hashed immutable | Descartar |
| Z-13 | 10050 Retrieved from Cache | `Age: N` en estáticos y `/` | Info | **Artefacto de plataforma** (CDN de Vercel) | CDN sirviendo estáticos content-hashed; esperado | Descartar |
| Z-14 | 10112 Session Management Response Identified | Cookies `__Secure-authjs.callback-url` / `__Host-authjs.csrf-token` seteadas en superficie pública | Info | Aplica a prod (comportamiento NextAuth) | NextAuth setea callback-url/csrf en páginas públicas por diseño; el session-token real NO aparece pre-login. Prefijos `__Secure-`/`__Host-` correctos | Descartar |
| Z-15 | 10109 Modern Web Application | `<script async>` de Next en `/` | Info | Ambos | Informativo puro ("esto es una SPA") | Descartar |

Observación no-seguridad (para el backlog de Fase 2.5, no del triage):
`/robots.txt` y `/sitemap.xml` devuelven 404 — no existen. Irrelevante
para hardening; relevante para SEO de la landing pre-lanzamiento.

## 4. Curl del body limit (I-6/I-7) — pre-triage

**Setup:** POST multipart autenticado contra
`/api/data/upload` de la preview, con `x-vercel-protection-bypass` y
la cookie de sesión de la cuenta de smoke de staging — ambos SIEMPRE
desde env vars del shell (`$VERCEL_BYPASS_SECRET`,
`$SMOKE_SESSION_COOKIE`), jamás literales. Body sintético con `dd`
de `/dev/zero`. Comando de referencia (secrets referenciados, no
expandidos):

```bash
dd if=/dev/zero of=big-11mb.bin bs=1m count=11
curl -s -o body.txt -D headers.txt -w "%{http_code}" \
  -X POST "https://onetable-git-feat-hardening-t6-…vercel.app/api/data/upload" \
  -H "x-vercel-protection-bypass: $VERCEL_BYPASS_SECRET" \
  -H "Cookie: $SMOKE_SESSION_COOKIE" \
  -F "files=@big-11mb.bin;filename=soriana-sellout-2026-07.xlsx" \
  -F "chain=SORIANA" -F "fileType=SELLOUT"
```

**Resultados (2026-08-18, tres data points):**

| Body | Status | Respuesta | Origen |
|---|---|---|---|
| 11 MB (11,534,786 bytes subidos) | **413** | `text/plain` — `Request Entity Too Large / FUNCTION_PAYLOAD_TOO_LARGE / sfo1::…`; header `x-vercel-error: FUNCTION_PAYLOAD_TOO_LARGE`, `server: Vercel` | **Plataforma** |
| 5 MB (5,243,330 bytes) | **413** | Idéntica (`FUNCTION_PAYLOAD_TOO_LARGE`) | **Plataforma** |
| 10 KB (control) | **400** | JSON de la app: `{"error":{"code":"ALL_FILES_FAILED",…},"perFile":[{"…":"fileType desconocido: \"SELLOUT\""}]}` con `x-matched-path: /api/data/upload` | **App** (post-`requireAuth` — la request estaba autenticada) |

**Lectura:**

1. **Premisa E1 CONFIRMADA.** El 413 lo emite la plataforma ANTES del
   código de la app: body `text/plain` de Vercel, sin el envelope
   JSON de `errorResponse`, sin los security headers del middleware.
   El corte a 5 MB es consistente con el límite documentado de
   4.5 MB (E1); la afirmación retirada del v1 ("100 MB") queda
   empíricamente refutada para este proyecto hoy.
2. **El control valida el experimento:** con la MISMA cookie y el
   MISMO bypass, un body chico llega al handler y devuelve el error
   de dominio de la app ⇒ el 413 no enmascara un muro de auth/SSO.
3. **Consecuencia I-6:** el pre-check de Content-Length en la app es
   inalcanzable en Vercel (la plataforma corta primero) ⇒
   recomendación: queda en **.2** (riesgo residual solo
   dev/self-host, ya anotado en el ledger).
4. **Consecuencia I-7:** el lado API del cap per-file 10 MB **cierra
   como INALCANZABLE en Vercel para clientes API** — la plataforma
   413-ea desde ~4.5 MB, muy por debajo del cap de 10 MB. El cap
   server (`MAX_UPLOAD_FILE_BYTES`) queda como defensa en
   profundidad para dev/self-host.
5. Dato colateral para el ledger: el control expuso que
   `fileType=SELLOUT` no es un valor válido del parser de metadatos
   (el error fue de dominio, no de tamaño) — irrelevante para
   I-6/I-7, cero acción.

## 5. Tabla ÚNICA de triage (F3 — RESUELTO)

Deuda pre-triaged que NO se re-litiga: Z-2/Z-3 (`'unsafe-inline'`,
T2, nonces = .2/futuro). Costos estimados por CC; "Tanda B" implica
ciclo completo del protocolo.

**F3 resuelto: Michael tomó TODAS las decisiones el 2026-08-18 sobre
este reporte (no hubo sesión aparte); columna final actualizada
2026-08-19.** Detalles de diseño decididos: I-3 = key intacta si
≤256 chars, si no sha256 hex de la key completa antes del SQL, con
tests de frontera 256/257 y de no-colisión entre dos keys largas
distintas. I-4 = step en `backup.yml` DESPUÉS del dump:
`DELETE FROM "RateLimit" WHERE "windowStart" < now() - interval
'7 days'` vía psql con `BACKUP_DATABASE_URL`. Z-7 entra a Tanda B
porque la tanda ya toca el builder (= "próximo touch").

| Ítem | Qué es | Recomendación CC | Costo est. | Decisión Michael |
|---|---|---|---|---|
| Z-1 | CSP sin `form-action` (Medium, aplica a prod) | **Fix-ahora, Tanda B** — `form-action 'self'` en el mismo diff del flip + test | ~15 min | **FIX-AHORA Tanda B** — `form-action 'self'` en buildCspHeader + assert en el test |
| Z-8 | `X-Powered-By: Next.js` (Low, aplica a prod) | **Fix-ahora, Tanda B** — `poweredByHeader: false` en next.config.mjs | ~5 min | **FIX-AHORA Tanda B** — `poweredByHeader: false` en next.config.mjs |
| Z-4 | `ACAO: *` de plataforma en superficie pública | Riesgo aceptado documentado; trigger de revisión en Fase 2.5 | 0 | **RIESGO ACEPTADO** documentado; trigger de revisión en Fase 2.5 |
| Z-7 | COOP missing | .2 (1 línea al próximo touch del builder) | 0 en T6 | **FIX-AHORA Tanda B** (la tanda ya toca el builder = próximo touch) — `Cross-Origin-Opener-Policy: same-origin` + assert |
| Z-5, Z-6, Z-9..Z-15 | Notices/COEP/artefactos/informativos | Descartar (análisis en §3) | 0 | **DESCARTADOS** (análisis §3) |
| I-3 | Cap de longitud de `key` del limiter (`lib/rate-limit.ts`) — vector real `login:email` ~5KB → fail-open silencioso | **Fix-ahora, Tanda B** — truncar/hashear keys > N chars + test | ~1 h | **FIX-AHORA Tanda B** — diseño en la nota de arriba (≤256 intacta / sha256 hex) + tests frontera y no-colisión |
| I-4 | Sin TTL/sweep de filas stale de RateLimit (crecimiento sin cota en Neon Free, agravado por csp-report público) | **Fix-ahora, Tanda B** — sweep piggyback en `backup.yml` (cron diario existente): `DELETE … WHERE windowStart < now() - interval` | ~1 h | **FIX-AHORA Tanda B** — step en backup.yml post-dump, DELETE 7 days vía psql con BACKUP_DATABASE_URL |
| I-5(a) | Cada POST anónimo a csp-report = un write a Neon (el limiter acota el logging, no la carga) | Riesgo aceptado documentado + trigger (si el flood duele: WAF/edge, .2) | 0 | **RIESGO ACEPTADO** documentado + trigger (si el flood duele: WAF/edge, .2) |
| I-6 | Pre-check de Content-Length en uploads | **.2** — curl §4: la plataforma 413-ea antes de la app; residual solo dev/self-host | 0 en T6 | **A .2** (dato del curl §4; residual solo dev/self-host) |
| I-7 | Lado API del cap per-file 10MB | **Cerrar como inalcanzable en Vercel** (dato §4); cap server queda como defensa en profundidad | 0 | **CERRADO** como inalcanzable en Vercel para clientes API (dato del curl §4) |
| I-8 | Race doble-DELETE/PATCH → P2025 → 500 en `app/api/portales/mappings/route.ts:88-96,134-146` | Candidato Tanda B (mapear P2025 → 404 en 2 catches + test) — último 500 conocido del bloque; si no, "próximo touch" | ~45 min | **FIX-AHORA Tanda B** — P2025 → 404 en los dos catches de mappings/route.ts + test |
| Q-5 T4 | `INTERNAL` vs `INTERNAL_ERROR` en `lib/route-errors.ts` | **SOLO la decisión** se toma aquí; el código va al próximo touch o al kickoff del agente post-bloque | 0 código en T6 | **DECIDIDO — `INTERNAL` RATIFICADO como código canónico**; cero cambio de código ahora ni al próximo touch; se documenta para el agente de triage post-bloque |

## 6. Post-scan

- **Staging quedó sucia** por el spider (POSTs/GETs al form de login,
  filas de rate-limit) y por los 3 curls (1 control llegó a la app).
  Un solo **"Reset from parent"** en Neon cubre todo — [MICHAEL].
- Rotar/borrar el Protection Bypass secret post-scan: RECOMENDADO
  (brief §8) — viajó en args de proceso del docker run.
- Artefactos de F2: este reporte + `t6-zap-raw.html` (limpio, §1).
  Ambos van con `git add -f` cuando Michael autorice — **en F2 no se
  commitea nada** (árbol sucio a propósito, protocolo vigente).
