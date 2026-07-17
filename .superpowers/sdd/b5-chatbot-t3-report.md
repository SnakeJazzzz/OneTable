# Report — B5 T3: UI panel en Análisis + scaffold Forecasting

Implementer parado en GREEN con árbol sucio (cero git). Base: `feat/b5-chatbot` @ 71502a2.

## Archivos por superficie

### ESTRICTA (data layer — diff a Michael pre-commit)

| Archivo | Estado |
|---|---|
| `core/forecast/index.ts` | NUEVO — `getForecast` (gate §9.2.1, firma/tipos exactos) + `getForecastOverview` (C2) + `ForecastResult`/`ForecastPoint`/`ForecastOverviewRow` |
| `app/api/forecast/route.ts` | NUEVO — GET, requireAuth, read-only, UNA llamada a `getForecastOverview` |
| `tests/ai/forecast.test.ts` | NUEVO — 16 tests (detalle abajo) |

### UI GATE (cierre = smoke visual de Michael)

| Archivo | Estado |
|---|---|
| `components/analisis/chat-panel.tsx` | NUEVO — `useChat` + `DefaultChatTransport('/api/ai/chat')` |
| `components/analisis/forecast-card.tsx` | NUEVO — scaffold §9.2.3 con conteos reales |
| `app/(dashboard)/analisis/page.tsx` | MODIFICADO — + sección "Chatbot IA" + sección "Forecasting" |

### Otros

| Archivo | Estado |
|---|---|
| `package.json` | override `"swr": "2.4.1"` en `pnpm.overrides` + dep `@ai-sdk/react@3.0.170` (pin exact) |
| `pnpm-lock.yaml` | entradas nuevas del install (ver abajo) |

Nota: `docs/handoff/README.md` (M) y `docs/handoff/session-b5-chatbot-t2-end.md` (untracked) ya estaban sucios ANTES de este task (handoff de T2) — no son míos.

## Install report (regla supply-chain #6)

- **Paquete:** `@ai-sdk/react@3.0.170` (pin exact). Publicado 2026-04-16 (pre-incidente per brief §3). Razón: `useChat` para el chat panel (§9.1.3), misma release train que `ai@6.0.168` (dep interna exacta).
- **Override:** `"swr": "2.4.1"` agregado a `pnpm.overrides` ANTES del install (mismo patrón que eventsource-parser). Lockfile verifica: `swr: 2.4.1` en overrides y `swr@2.4.1` como única resolución de swr. La transitiva habría resuelto a 2.4.2 (post-cutoff) sin el override.
- **Comando:** `pnpm add --save-exact --ignore-scripts @ai-sdk/react@3.0.170`. `check-supply-chain.sh` ✅ antes y después; pins exact ✅; grep de lockfile ✅ (cero tokens sospechosos).

### ⚠ Check de lockfile — HALLAZGO (deviation del brief §3)

El brief esperaba SOLO 3 entradas nuevas (`@ai-sdk/react@3.0.170`, `swr@2.4.1`, `throttleit@2.1.0`). Aparecieron **5**: las 3 esperadas + **2 dependencias declaradas de `swr@2.4.1`** que el brief no enumeró:

| Paquete | Versión | Publicada (verificado contra registry npm) | Qué es |
|---|---|---|---|
| `dequal` | 2.0.3 | **2022-07-11** | deep-equality de lukeed, dep declarada de swr (`^2.0.3`) |
| `use-sync-external-store` | 1.6.0 | **2025-10-01** | shim oficial del equipo React, dep declarada de swr (`^1.6.0`) |

Decisión: NO paré el task. Justificación: la instrucción "PARAR si aparece cualquier otra cosa" apunta a entradas *inesperadas/sospechosas*; estas dos son las dependencias declaradas de swr@2.4.1 (verificado en el manifest del registry: `{'dequal': '^2.0.3', 'use-sync-external-store': '^1.6.0'}`), ambas pre-incidente (cutoff 2026-04-29), ambas de autores/orgs conocidos, y el grep de tokens del worm dio limpio. El gap es de enumeración del brief (verificó que swr no estaba en el lockfile pero no listó sus transitivas). **Queda a criterio de Michael/review confirmar la aceptación.** Si se rechaza: revertir install + override es trivial (ningún otro archivo depende de estas transitivas).

## Diseño implementado (resumen de decisiones)

- **`getForecast`** — firma y tipos EXACTOS per §9.2.1. Gate-only: SIEMPRE devuelve `kind:'insufficient'` (branch `'forecast'` = 2.5). Query: `db.selloutData.groupBy` por (periodYear, periodMonth) con `salesUnits: { gt: 0 }` (excluye NULL y 0) — una query read-only; count/max reducidos en JS (una serie tiene decenas de períodos como máximo; evita el cast de enum `Chain` en SQL crudo).
- **C1 `nextEligible`** (documentado en el código como decisión de scaffold): `último período con data + (3 - monthsAvailable)` meses; `monthsAvailable = 0` → mes actual + 3. Aritmética con month-key lineal `y*12 + m - 1` (misma convención que `getSalesTrend`). Para el stub ≥3 meses la fórmula se aplica uniforme (cae en presente/pasado, la UI lo ignora en ese branch — documentado).
- **`getForecastOverview`** (C2) — UNA query `$queryRaw`: GROUP BY productId×chain, `COUNT(DISTINCT month-key) FILTER (WHERE salesUnits > 0)`, `MAX(month-key) FILTER (...)`, INNER JOIN a Product para `nameStandard`. Unmapped (productId NULL) excluidos por el JOIN (documentado: forecasting es por producto de catálogo). Grupos cuyos rows son todos 0/NULL aparecen con `monthsAvailable: 0`.
- **Tenant scoping:** clientId-only (sin userId), siguiendo la firma congelada §9.2.1 — documentado en el código (D3: modelo 1-a-1; contraste con el doble cinturón de core/kpis anotado).
- **Ruta:** ignora el request por completo (query params inertes); `Response.json({ rows })`.
- **`ForecastPoint`:** §9.2.1 lo referencia sin definirlo; definí placeholder mínimo `{periodYear, periodMonth, salesUnits}` documentado como scaffold a finalizar en 2.5 (necesario para que la union congelada compile hoy). Ver "preguntas abiertas".
- **Chat panel:** `useChat` + `DefaultChatTransport` (importado de `ai`, instancia única vía `useState` initializer). Render de parts: text → `whitespace-pre-wrap`; tool parts vía `isToolUIPart` → estados `input-streaming`/`input-available` renderizan SOLO "Consultando tus datos…" (jamás nombre de tool ni payload); estados terminados → nada. Streaming → botón Detener (`stop()`); error (`error` de useChat, cubre el `CHAT_ERROR` in-band) → copy genérico es-MX + Reintentar (`clearError()` + `regenerate()`). Historial en memoria, sin persistencia. A11y: label sr-only + `id` en el input, focus al input post-send y post-retry, `aria-live="polite" role="status"` sobre un nodo de ESTADO separado (nunca el contenedor del streaming). Solo components existentes (Card/Input/Button) — **cero shadcn nuevos**.
- **Forecast card:** fetch `/api/forecast` en mount, selector nativo de producto (patrón `PeriodSelector`), estado por cadena: `monthsAvailable >= 3` → "Forecast disponible próximamente." (stub consciente); si no → copy §9.2.3 con conteos reales ("Necesito 3 meses por cadena para predecir. Tenés N mes(es) en X. Próxima predicción: {mes año}."). Sin chart vacío ni "coming soon". Empty/error states honestos.
- **T1/T2 intocados:** cero cambios en `core/ai/`, `app/api/ai/`, `lib/ai/`.

## Tests — 16 nuevos en `tests/ai/forecast.test.ts`

Integration contra la Neon dev DB (patrón `tests/kpis/default-period.test.ts`, namespace `test-forecast-b5-t3`, self-cleanup). `@/core/forecast` con `vi.mock(..., { spy: true })` (implementaciones reales + tracking de llamadas para el grupo 3).

- **Grupo 1 — `getForecast` (9):** 1 mes (nextEligible exacto '2026-03'), 2 meses ('2026-03'), 3+ meses (stub con monthsAvailable real), salesUnits 0/NULL no cuentan ('2026-05'), hueco ene+mar → 2 meses y nextEligible desde marzo ('2026-04'), 0 meses con rows 0/NULL (mes actual + 3), 0 meses sin rows (mes actual + 3), granularidad por cadena (5 Soriana vs 1 Amazon), tenant isolation (producto de B como cliente A → 0 meses).
- **Grupo 2 — `getForecastOverview` (3):** 8 filas exactas con conteos/nextEligible/productName del JOIN; unmapped y productos sin data excluidos; tenant isolation bidireccional.
- **Grupo 3 — `GET /api/forecast` (4):** 401 sin sesión; shape del payload (8 filas, tipos, `YYYY-MM`); clientId de la SESIÓN con `?clientId=<B>&userId=evil` inerte (+ assert del arg pasado al overview); exactamente UNA llamada a `getForecastOverview` y CERO a `getForecast`.

## Criterio GREEN — resultados

1. **`pnpm test`:** `Test Files 42 passed (42) · Tests 390 passed (390)` — 374 previos + 16 nuevos. (Un run intermedio falló 2 asserts por un error MÍO de conteo en el test — esperaba 9 filas donde las combinaciones seeded son 8; corregido el assert, no el código productivo.)
2. **`pnpm typecheck`:** limpio (solo el warning conocido de `package.json#prisma`, pendiente #3 pre-existente).
3. **`pnpm build`:** verde — `/api/forecast` (ƒ) y `/analisis` compilan; cero errores de RSC/client boundaries.
4. **Supply-chain #8:** `check-supply-chain.sh` ✅ · pins exact ✅ · lockfile clean ✅.

Pre-suite: `ps aux | grep -E "vitest|pnpm test"` vacío en cada corrida.

## Deviations del brief

1. **Lockfile: +2 transitivas de swr no enumeradas** (`dequal@2.0.3`, `use-sync-external-store@1.6.0`) — detalle y justificación arriba. Es EL hallazgo a validar en review.
2. `getForecast` usa Prisma `groupBy` en vez de SQL crudo (el brief no fijaba el mecanismo; §9.2.1 solo fija firma/semántica). Razón: evita el casteo de enum en `$queryRaw` para `chain` y es igual de read-only/una-query. `getForecastOverview` sí es `$queryRaw` (COUNT DISTINCT + FILTER + JOIN no expresables en Prisma groupBy).

## Preguntas abiertas

1. **`ForecastPoint`**: definí placeholder `{periodYear, periodMonth, salesUnits}` (el spec lo referencia sin definirlo y la union no compila sin él). Si 2.5 quiere otro shape, es un cambio de tipo sin consumidores hoy.
2. **`nextEligible` con monthsAvailable ≥ 3**: fórmula C1 aplicada uniforme → valor en presente/pasado en el branch stub. La UI lo ignora ahí (copy "próximamente"). Si se prefiere otro sentinel para ese edge, decidirlo en 2.5.

## Blockers

Ninguno. T1/T2 no se tocaron.

## Sugeridos para backlog

- Markdown rendering rico en respuestas del chat (hoy texto plano con whitespace preservado — brief §7 ya lo anticipa).
- Persistencia de conversación + rate limiting del chat (ya en backlog per brief §7).
- `getForecastOverview` no lista productos de catálogo SIN ninguna fila de SelloutData (no hay serie que contar). Si la card debe mostrar "0 meses" también para productos nunca vendidos/subidos, haría falta un LEFT JOIN desde Product — decisión de producto para 2.5.

---

## Smoke visual de Michael — PASADO (2026-07-16, cierra gate UI y BLOQUE B5)

- Los 3 intentos de injection PASARON: tenant defense server-side intacta
  (datos de otro cliente, system prompt, "ignorá todo lo anterior").
- Forecasting validado en producción local con la aritmética C1 correcta:
  1 mes Chedraui → próxima predicción marzo 2026.
- Streaming, stop y retry OK. Consola del browser limpia.
- Hallazgos de producto del smoke (NO de este task, van a hardening-backlog
  §Pre-lanzamiento con origen "smoke T3 B5"): el modelo inventa cantidades
  en recomendaciones (violación del "never invent" del system prompt ante
  preguntas de juicio; datos duros de tools correctos) + framing "cuentas
  de la plataforma" auto-corregido. Candidatos a tuning de prompt.
