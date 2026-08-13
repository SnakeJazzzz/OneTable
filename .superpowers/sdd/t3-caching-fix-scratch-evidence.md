# Evidencia empírica — diagnóstico de caching vía AI Gateway (fix post-gate T3 §4.6)

Fecha: 2026-08-12. Scratch fuera del repo (`ai@6.0.168` instalado con
`--ignore-scripts` en el scratchpad de la sesión), contra el gateway REAL con
`AI_GATEWAY_API_KEY` leída de `.env.local` (la key jamás se imprimió; los
outputs de abajo no la contienen). Modelo `anthropic/claude-haiku-4.5`.
System prompts sintéticos byte-estables (~11k tokens, sobre el mínimo
cacheable de Haiku 4.5 = 2048), prefijo distinto por variante para evitar
contaminación cruzada de cache. 6 requests en total (el cap del brief).
Costo total: ~$0.032 USD (suma de los `gateway.cost` reportados).

## Resumen de resultados

| Variante | Mecanismo | Req 1 (write/read) | Req 2 (write/read) |
|---|---|---|---|
| A (control: anclaje actual de route.ts) | `SystemModelMessage` + `providerOptions.anthropic.cacheControl` | **11112 / 0** | **0 / 11112** |
| B (candidato) | system string + `providerOptions: { gateway: { caching: 'auto' } }` | **11122 / 0** | **0 / 11122** |
| C (anclaje actual + tools, réplica de la forma real de la llamada) | como A + 1 tool + `stopWhen` | **11369 / 0** | **0 / 11369** |

`finalProvider` fue `anthropic` en los 6 requests (en B req1 y C req2 el
planning arrancó en `claudeaws` pero ejecutó `anthropic`).

## ⚠ DRIFT vs la premisa del brief

El brief esperaba **variante A = cero cache** (consistente con la evidencia de
observability de producción del 2026-08-12: Cache Read=0 / Cache Write=0 en
las 2 corridas de 7 requests contra el deployment 3ff2438). El scratch **NO
reprodujo ese cero**: el anclaje message-level SÍ cacheó desde el scratch, con
y sin tools. Es decir: "el anclaje NO sobrevive el paso por el gateway" NO es
cierto como afirmación universal — no la escribimos en los comments del fix.

Lo que sí está establecido:
- En producción, con el anclaje message-level, el caching NO se materializó
  (evidencia de Michael, 14 requests, deployment confirmado Current).
- `gateway.caching: 'auto'` funciona verificado (write→read) y es el mecanismo
  DOCUMENTADO del gateway para providers de cache explícito
  (vercel.com/docs/ai-gateway/models-and-providers/automatic-caching): el
  gateway coloca los breakpoints él mismo, agnóstico del provider al que
  rutee.

Hipótesis para el 0/0 de prod — AMBAS REFUTADAS por el filtro externo
(Michael, 2026-08-13, con los CSVs de observability de prod del 2026-08-12
en mano):

1. **Routing a provider no-`anthropic` — REFUTADA**: la columna Provider de
   los 22 requests de prod de los CSVs = `anthropic` en todos — ejecutaron
   en el provider directo, igual que el scratch. El namespace message-level
   no fue ignorado por routing a fallback.
2. **Semántica del dashboard (artefacto de medición) — REFUTADA**: el costo
   del gateway SÍ factura cache reads a 0.1x (verificado en este mismo
   scratch: A req2 = $0.0011442 exacto, consistente con read a 0.1x). Los
   costos de prod son precio PLENO exacto (p.ej. 12,382×$1/M + 261×$5/M =
   $0.013687) ⇒ no hubo caching real en prod; no es un artefacto de cómo
   mide el dashboard.

**Estado final: causa del 0/0 de prod con el anclaje message-level =
DESCONOCIDA** (mismo SDK, mismo provider final; algo del entorno
prod→gateway). El fix NO depende de resolverla: `gateway.caching: 'auto'`
es server-side y provider-agnóstico — el gateway coloca los breakpoints él
mismo, sin depender de que las providerOptions message-level sobrevivan el
camino desde el runtime de prod. Árbitro: CSV de observability post-deploy
de Michael. Además, cacheó 10 tokens más que el anclaje manual en el mismo
prompt.

## Outputs crudos

### Variante A — request 1

```json
usage: {
  "inputTokens": 11125,
  "inputTokenDetails": { "noCacheTokens": 13, "cacheReadTokens": 0, "cacheWriteTokens": 11112 },
  "outputTokens": 4, "totalTokens": 11129,
  "raw": {
    "input_tokens": 13, "cache_creation_input_tokens": 11112, "cache_read_input_tokens": 0,
    "cache_creation": { "ephemeral_5m_input_tokens": 11112, "ephemeral_1h_input_tokens": 0 },
    "output_tokens": 4, "service_tier": "standard"
  },
  "cachedInputTokens": 0
}
providerMetadata.anthropic: { "cacheCreationInputTokens": 11112, ... }
providerMetadata.gateway: { "routing": { "resolvedProvider": "anthropic", "finalProvider": "anthropic" }, "cost": "0.013923" }
```

### Variante A — request 2

```json
usage: {
  "inputTokens": 11125,
  "inputTokenDetails": { "noCacheTokens": 13, "cacheReadTokens": 11112, "cacheWriteTokens": 0 },
  "raw": { "input_tokens": 13, "cache_creation_input_tokens": 0, "cache_read_input_tokens": 11112 },
  "cachedInputTokens": 11112
}
providerMetadata.gateway: { "routing": { "resolvedProvider": "anthropic", "finalProvider": "anthropic" }, "cost": "0.0011442" }
```

### Variante B — request 1

```json
usage: {
  "inputTokens": 11125,
  "inputTokenDetails": { "noCacheTokens": 3, "cacheReadTokens": 0, "cacheWriteTokens": 11122 },
  "raw": { "input_tokens": 3, "cache_creation_input_tokens": 11122, "cache_read_input_tokens": 0 },
  "cachedInputTokens": 0
}
providerMetadata.gateway: { "routing": { "resolvedProvider": "claudeaws", "finalProvider": "anthropic" }, "cost": "0.0139255" }
```

### Variante B — request 2

```json
usage: {
  "inputTokens": 11125,
  "inputTokenDetails": { "noCacheTokens": 3, "cacheReadTokens": 11122, "cacheWriteTokens": 0 },
  "raw": { "input_tokens": 3, "cache_creation_input_tokens": 0, "cache_read_input_tokens": 11122 },
  "cachedInputTokens": 11122
}
providerMetadata.gateway: { "routing": { "resolvedProvider": "anthropic", "finalProvider": "anthropic" }, "cost": "0.0011352" }
```

### Variante C (anclaje actual + tools) — request 1

```json
usage.inputTokenDetails: { "noCacheTokens": 335, "cacheReadTokens": 0, "cacheWriteTokens": 11369 }
anthropic usage: { "input_tokens": 335, "cache_creation_input_tokens": 11369, "cache_read_input_tokens": 0 }
gateway routing: { "resolvedProvider": "anthropic", "finalProvider": "anthropic" }
```

### Variante C — request 2

```json
usage.inputTokenDetails: { "noCacheTokens": 335, "cacheReadTokens": 11369, "cacheWriteTokens": 0 }
anthropic usage: { "input_tokens": 335, "cache_creation_input_tokens": 0, "cache_read_input_tokens": 11369 }
gateway routing: { "resolvedProvider": "claudeaws", "finalProvider": "anthropic" }
```

## Scripts

Los scripts (`diag.mjs`, `diag2.mjs`) viven en el scratchpad de la sesión:
`/private/tmp/claude-501/-Users-michaelthemac-Desktop-Projectos-One-Table-father-OneTable/d79a7b41-60f9-4021-a7cb-b91d580b9b79/scratchpad/cache-diag/`
(efímero — este archivo es el registro durable). Leen la key de `.env.local`
en runtime y no la imprimen.
