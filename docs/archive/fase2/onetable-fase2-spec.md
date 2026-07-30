# OneTable — Spec Fase 2

> Spec congelada post-review técnico. Consolida las decisiones cerradas en la sesión de
> arquitectura posterior al demo ANTAD + las correcciones de tres rondas de review contra el
> código real. Las decisiones marcadas **[CC]** son las que quedaron como implementación a
> proponer por Claude Code; el resto está cerrado en *qué* y en *cómo*.
>
> Decisiones [CC] del draft original ya resueltas durante el review se documentan en §13.

---

## 0. Premisa de la fase

Se construye **sobre el demo de Fase 1**, no desde cero. La arquitectura del demo se diseñó
para esto (normalizer agnóstico al catálogo, KPIs al query, schema multi-tenant). Fase 2
convierte el demo en el producto vendible: onboarding self-serve completo por el usuario,
precios, thresholds configurables, chatbot IA, y la base para la automatización de Fase 3.

Objetivo de negocio: que una PyME (empezando por VIKS) **opere con OneTable como sistema
principal**, subiendo sus archivos a mano, sin intervención técnica de la agencia.

**Reality check del estado actual** (verificado contra el repo durante el review):
- El demo funciona en Vercel. 89 tests passing en 18 archivos.
- El "registry de parsers drop-in" que el spec de Fase 1 dejó diseñado **no se construyó**:
  hoy hay regex inline en `app/api/data/upload/route.ts:57-74`. Construir el registry de
  verdad es pre-work de Fase 2 (B1, ver §12).
- Las páginas G6 (Clientes) y G7 (Catálogo) existen como stubs "Coming soon" — no fueron
  "cortadas por endpoints faltantes". Toda la lógica de Portales y Parámetros es código
  net-new, no refactor.
- Mover el drill-down de Dashboard a Análisis **no es mecánico**: hay acoplamiento real
  documentado en §3.3.

---

## 1. Modelo de tenancy (CERRADO)

- **Una cuenta = una empresa = un análisis de sell-out.** OneTable analiza el sell-out de
  una sola marca/PyME por cuenta, a través de sus varios portales (Soriana, Chedraui,
  Amazon, …). No hay multi-manejo de marcas en una cuenta.
- **Se conserva la entidad `Client`** (no se colapsa dentro de `User`). Guarda la config de
  la marca: SKUs, precios base, thresholds.
- **Se fuerza 1 `Client` por cuenta en la capa de aplicación, NO en el schema.** El signup
  del demo ya crea User + Client atómicamente; esto solo formaliza lo que ya pasa.
- **Helper canónico `getCurrentClient(userId)` en `lib/tenant.ts`** — devuelve `client =
  await db.client.findFirstOrThrow({ where: { userId } })`. Asume 1 row; si algún día sale
  data corrupta con 2, throw temprano > comportamiento silencioso.
- **Puerta a multi-marca abierta para el futuro:** habilitarla = remover el `findFirst` del
  helper + exponer UI de selección. Sin migración de datos.
- Si alguien vende dos líneas distintas (ej. carne seca + dulces), por ahora van en la misma
  cuenta/tabla/análisis o usa dos cuentas. Solución dedicada a multi-producto: futuro.

---

## 2. Mapa de páginas (final Fase 2)

| Página | Estado actual en repo | Acción Fase 2 |
|---|---|---|
| Landing | existe (G3) | conserva |
| Auth | existe (G1) — login + signup crea User + Client | conserva |
| Dashboard | existe (G4) — KPIs + charts + drill-down | **se modifica:** pierde drill-down y unmapped-banner (se van a Análisis). Conserva KPIs + charts. |
| Análisis | existe (G5) — upload + lista de uploads | **se modifica:** recibe drill-down (OneTable con filtros/alertas/export) + chatbot IA (§9.1). Pierde el upload (se va a Portales por cadena). |
| **Portales** | hoy `/clientes` = stub "Coming soon" | **net-new.** Renombre = solo el link del sidebar; el código es construcción desde cero. Tarjeta por cadena con mapeo, override de precios, credenciales dummy, y upload. |
| **Parámetros** | hoy `/catalogo` = stub "Coming soon" | **net-new.** Reemplaza el concepto de Catálogo. SKUs canónicos + precios base + thresholds. |
| Promotoría | existe (G8) — coming-soon | conserva, sin cambios |

### Renombre crítico

La página que en el demo se llamaba **"Clientes" se renombra a "Portales".** No maneja
clientes (la cuenta entera ya ES el cliente); maneja cadenas. La entidad de schema detrás es
`Chain` + `PortalCredential`, no `Client`. Mantener el nombre viejo genera confusión real.

---

## 3. Detalle por página

### 3.1 Parámetros (reemplaza Catálogo)

Configuración de la única cuenta/marca. Responde *"cuáles son mis productos, qué cuestan,
cuándo me alerto"*.

#### 3.1.1 Listado canónico de SKUs

- Nombre oficial por SKU (ej. `Chilli Lime 86g`). Granularidad = sabor × peso (son SKUs
  distintos `Chilli Lime 86g` vs `Chilli Lime 20g`).
- Cada SKU lleva un **`skuCode` opaco** auto-generado al crear (cuid), sobrescribible por
  el usuario si maneja códigos internos propios. Detalle de modelo + round-trip en §10.
- **Bulk import:** Excel via el módulo nuevo `core/parameters/import.ts` (no confundir con
  `core/catalog/import.ts`, que queda como código de seed). Columnas del Excel: `Código`,
  `Producto`, `PrecioCompra`, `PrecioVenta`. **Nunca toca `ProductMapping`** — los mapeos
  viven en Portales.
- Alta/edición/borrado manual desde la UI.
- Un SKU puede existir sin ningún mapeo a portal (ej. `Machaca 500g` que no se vende aún).
  Estado válido; el dashboard no se rompe con SKUs sin sellout.
- Rename del `skuCode` es operación de UI (UPDATE atómico que preserva FKs), **NO** del
  Excel re-import. Detalle del footgun en §10.4.

#### 3.1.2 Precios base

- `purchasePriceBase` (compra = lo que la cadena le paga a la marca = ingreso real) y
  `salePriceBase` (venta = góndola). Ambos opcionales.
- **No hay defaults universales de precio** (nadie adivina cuánto cuesta el producto).
- **Los precios NO bloquean el análisis.** Sin precios: KPIs y gráficas en unidades desde
  el minuto cero. Al cargar precios: aparece el monto en pesos; las vistas en unidades **no
  desaparecen** (se suma la capa de dinero, no se reemplaza).
- Resolución de montos al query en §7.

#### 3.1.3 Thresholds de alerta de inventario

- 7 estados: `SIN_STOCK / CRITICO / RIESGO / ATENCION / OK / EXCESO / SIN_DATOS`.
- Defaults editables: `critico < 7d`, `riesgo < 14d`, `atencion < 21d`, `exceso > 60d`.
- **Solo globales:** aplican a TODOS los portales de la cuenta. Sin override por portal.
  (Si la dinámica de restock por cadena lo exige a futuro, se agrega; arranca sin override.)
- **Validación al guardar:** rechazar si los cortes se solapan
  (`critico < riesgo < atencion < exceso`, todos > 0). Error inline, no toast genérico.
- Schema en §4.5. Refactor de `classifyAlert` para aceptar la config como parámetro en §4.8.

### 3.2 Portales (renombre de Clientes)

Una tarjeta por cadena habilitada. Responde *"cómo se llama cada producto en cada portal y
cómo entran sus datos"*. Por tarjeta:

#### 3.2.1 Mapeo de SKUs

- **Fuzzy + manual** (algoritmo y bandas en §5).
- **Multi-valor:** un SKU puede tener varios `portalString` en el mismo portal (renames del
  portal mes a mes). El schema **ya soporta** N portalStrings → 1 SKU (la unique constraint
  `(clientId, chain, portalString)` impedía duplicados *del lado del portalString*, no del
  SKU). En Fase 2 esa unique constraint cambia por una **partial** que excluye `CONFLICTED`
  (ver §4.4); el comportamiento N-to-1 sigue válido.
- UI: por cada SKU canónico, lista de filas de `ProductMapping` independientes (mismo
  `productId`, mismo `chain`, distinto `portalString`). Con `[+ Agregar otro string]` abajo.

#### 3.2.2 Estados del mapeo

| Estado | Cuándo se asigna | Comportamiento en KPIs |
|---|---|---|
| `CONFIRMED` | Banda alta del fuzzy aceptada / banda media palomeada / mapeo manual aceptado | Entra normal |
| `PENDING_REVIEW` | **Solo** flag manual deliberado del usuario ("confirmar que sea el mismo producto" de la hoja NOTAS) | Entra normal (no requiere JOIN extra; ver §3.2.3) |
| `CONFLICTED` | Automático cuando 2+ SKUs reclaman el mismo `portalString` en la misma cadena | NO entra a queries SKU-level. Ver §8 |

**"Sin mapear" no es un status del mapping** → es la ausencia de mapping (cola
`UnmappedProduct`, ya existe en el schema).

#### 3.2.3 Señalización de PENDING_REVIEW

- **Contador simple en la tarjeta del portal:** `"3 por verificar"`. Count single-shot
  sobre `ProductMapping WHERE status = 'PENDING_REVIEW'` para esa cadena.
- **NO badges por fila** en el OneTable. **NO JOIN nuevo** en cada KPI query.
- La data `PENDING_REVIEW` entra a los KPIs por el JOIN existente con `Product` (los KPIs
  ya hacen `Sellout JOIN Product`, no necesitan saber del status). Excluirla dejaría el
  dashboard vacío durante el onboarding, que es cuando más hay.

#### 3.2.4 Resto de la tarjeta

- **Override de precios** para esa cadena (si vende a precio distinto al global).
  Al agregar el portal aparecen los globales; se editan para esa cadena o se dejan igual.
  Schema: `ProductPriceOverride`, ver §4.3.
- **Credenciales** (username + password dummy diferido, ver §6).
- **Upload manual** del archivo de ese portal (ahora manual; en Fase 3, automático vía
  scraper). El upload **sale de Análisis y vive acá, por cadena**. Para Amazon, dos
  inputs separados dentro del card (Ventas / Inventario).
- **Warning "configuración incompleta"** si la cadena tiene mapeos sin resolver
  (`UnmappedProduct WHERE resolvedAt IS NULL AND chain = X`).
- **Sección "En conflicto"** si hay mappings CONFLICTED para esa cadena (UI de resolución
  en §8.4).

### 3.3 Análisis (se modifica)

#### 3.3.1 Drill-down (OneTable)

Tabla SKU × tienda × alerta con filtros (cadena/tienda/SKU/alerta) + export Excel/CSV. **Se
mueve del Dashboard a acá. Read-only.**

**Coupling real al mudarse** (NO es refactor mecánico, son ~4-6h):

- El componente (`components/dashboard/onetable.tsx`) recibe **`periodKey` por prop desde
  el Dashboard** (que tiene period selector). Análisis no lo tiene hoy. **Decisión:** se
  agrega un period selector propio en Análisis. Default = periodo más reciente con data
  (reusar `getDefaultPeriod` que ya existe en `core/kpis/queries.ts`).
- Los filtros (chain/store/SKU/alert) son `useState` local. **Decisión:** se conservan
  locales por simplicidad. URL params como upgrade opcional si la UX lo justifica más
  adelante; no en Fase 2.
- El `unmapped-banner` (`components/dashboard/unmapped-banner.tsx`) está atado al render del
  OneTable. **Decisión:** se va con el OneTable a Análisis. El Dashboard pierde el banner;
  el banner aparece donde el usuario tiene contexto para resolverlo (la tabla con las rows
  "sin mapear" visibles).
- El endpoint `/api/dashboard/onetable` queda donde está. No se renombra a `/api/data/...`
  por cosmética — el costo de tocar la convención de naming no se justifica.

#### 3.3.2 Chatbot IA

Panel de chat sobre la data. Build real en Fase 2. Arquitectura tool-use sobre las queries
existentes. Detalle en §9.1.

#### 3.3.3 Forecasting

UI scaffold con estado `insufficient` mientras la serie no tenga ≥ 3 meses. Build del
modelo deferido a Fase 2.5. Detalle en §9.2.

### 3.4 Dashboard (se modifica)

- Conserva KPIs (4 cards) + gráficas (tendencia, ventas por cadena, top SKUs, semáforo).
- **Pierde la OneTable** (se va a Análisis).
- **Pierde el unmapped-banner** (se va con OneTable).

---

## 4. Delta de schema (CERRADO)

### 4.1 Conservado del demo

`User`, `Client`, `Product`, `ProductMapping`, `SelloutData`, `UnmappedProduct`,
`PortalCredential`. El UPSERT key, NULLS NOT DISTINCT, COALESCE per campo, worst-case
aggregation (H1), batch UPSERT (H2): intactos.

### 4.2 `Product` — cambios

```prisma
model Product {
  id                String   @id @default(cuid())
  clientId          String
  client            Client   @relation(fields: [clientId], references: [id], onDelete: Cascade)
  skuCode           String   // NOT NULL, default cuid() en TS al crear
  nameStandard      String
  purchasePriceBase Decimal? @db.Decimal(12, 2)
  salePriceBase     Decimal? @db.Decimal(12, 2)
  createdAt         DateTime @default(now())

  mappings    ProductMapping[]
  selloutData SelloutData[]
  overrides   ProductPriceOverride[]

  @@unique([clientId, skuCode])
  @@index([clientId])
}
```

**Cambios respecto al demo:**
- **`skuCode String` NOT NULL** — default `cuid()` generado en TS al crear (no `@default`
  Prisma; el TS layer lo provee). Identificador opaco; usuario puede sobrescribir.
- **`purchasePriceBase` / `salePriceBase` Decimal?** — nullable. **Tipo `Decimal` (Postgres
  `numeric`), NUNCA `Float`.** Float mete error de redondeo en dinero. Se guarda al centavo
  (ej. `150.50`); el redondeo es solo al desplegar.
- **`@@unique([clientId, skuCode])`** agregado.
- **`@@unique([clientId, nameStandard])`** **removido.** Permite SKUs con nombres repetidos
  (edge case, raro pero no patológico). Si se quiere validar nombre repetido, warning en
  app layer, no constraint hard.

### 4.3 `ProductPriceOverride` — tabla nueva

```prisma
model ProductPriceOverride {
  id            String   @id @default(cuid())
  productId     String
  product       Product  @relation(fields: [productId], references: [id], onDelete: Cascade)
  chain         Chain
  purchasePrice Decimal? @db.Decimal(12, 2)
  salePrice     Decimal? @db.Decimal(12, 2)
  updatedAt     DateTime @updatedAt

  @@unique([productId, chain])
  @@index([productId])
}
```

- `chain` usa el enum `Chain` (no string libre).
- Solo existen filas para overrides reales. Ausencia = usar el base.
- Borrado de un Product cascade-elimina sus overrides.

### 4.4 `ProductMapping` — cambios

```prisma
enum MappingStatus {
  CONFIRMED
  PENDING_REVIEW
  CONFLICTED
}

model ProductMapping {
  id           String        @id @default(cuid())
  clientId     String
  client       Client        @relation(fields: [clientId], references: [id], onDelete: Cascade)
  productId    String
  product      Product       @relation(fields: [productId], references: [id], onDelete: Cascade)
  chain        Chain
  portalString String
  status       MappingStatus @default(CONFIRMED)
  createdAt    DateTime      @default(now())

  // NOTA: @@unique([clientId, chain, portalString]) del demo se REMUEVE.
  // Se reemplaza por un partial unique index editado a mano en la migration SQL.
  @@index([clientId, chain])
  @@index([clientId, chain, portalString])
  @@index([productId])
}
```

**Partial unique index** (editar el SQL de la migration antes de aplicar, mismo patrón que
NULLS NOT DISTINCT en Fase 1):

```sql
CREATE UNIQUE INDEX "ProductMapping_active_unique"
  ON "ProductMapping"("clientId", "chain", "portalString")
  WHERE "status" <> 'CONFLICTED';
```

- Filas `CONFIRMED` y `PENDING_REVIEW` siguen sujetas a la unique constraint.
- Filas `CONFLICTED` quedan exentas → permite N rows con mismo
  `(clientId, chain, portalString)`, uno por cada SKU candidato.
- Postgres soporta partial indexes nativamente. Prisma no los genera del schema, así que
  el SQL se edita a mano. Documentar en el README de migrations para no regenerarlo.

### 4.5 `ThresholdConfig` — tabla nueva

```prisma
model ThresholdConfig {
  id           String   @id @default(cuid())
  clientId     String   @unique
  client       Client   @relation(fields: [clientId], references: [id], onDelete: Cascade)
  criticoDays  Int      @default(7)
  riesgoDays   Int      @default(14)
  atencionDays Int      @default(21)
  excesoDays   Int      @default(60)
  updatedAt    DateTime @updatedAt
}
```

**Razones de columnas tipadas (no JSON):**
- **Type safety en TS sin cast:** `config.criticoDays` es `number`; con JSON sería
  `config.cuts.critico as number`.
- **Validación a nivel DB futura:** podés agregar
  `CHECK (criticoDays < riesgoDays AND riesgoDays < atencionDays AND atencionDays <
  excesoDays)` cuando lo necesites. Imposible con JSON.
- **Templatización limpia del SQL** (§4.8).
- **No hay polimorfismo:** los 4 cortes son fijos para los 7 estados (`SIN_STOCK` y
  `SIN_DATOS` no usan cuts; `OK` y `EXCESO` se derivan).

**Lifecycle:**
- Crear `ThresholdConfig` con defaults atómicamente al crear un `Client` nuevo (en el
  endpoint de signup).
- Si un Client legacy no tiene row (no debería pasar después del backfill de migración,
  pero defensivo): fallback a defaults hardcoded en el código.
- App-layer validación al guardar: rechazar si los cortes se solapan.

### 4.6 `PortalCredential` — sin cambio estructural

- Se conserva `username` + `hasPasswordPending` (patrón del demo).
- Cifrado del password (AES-GCM + `keyVersion`) se difiere a Fase 3. Spec del diseño en
  `docs/specs/onetable-fase3-spec-draft.md §1`.

### 4.7 Migración

- **Estrategia: `prisma migrate reset` + reseed.** Data del demo es desechable (no hay
  producción a migrar); el seed regenera todo con cuids consistentes.
- Aditiva en el papel (columnas nullable + tablas vacías + un enum + un partial index +
  remoción de una unique), pero el reset + reseed es más limpio que un backfill de
  `skuCode` mezclado con cuids generados desde TS.
- **Excepción que requiere SQL editado a mano:** el partial unique index de
  `ProductMapping` (§4.4). Mismo flujo manual que ya se usó para NULLS NOT DISTINCT en
  Fase 1: `prisma migrate dev --create-only`, editar SQL, aplicar.
- Si el usuario quiere cargar precios base al seed VIKS para que los KPIs en pesos
  muestren algo en pitch: opcional, en el mismo paso de seed después del import del
  catálogo.

### 4.8 Refactor de `classifyAlert`

**Costo real: 8-10h** (el spec original lo estimaba en 4-6h; underestimate porque solo
contaba el TS).

Dos capas a tocar:

1. **TS** (`core/alerts/classify.ts`): signature acepta `cuts: ThresholdCuts`:
   ```ts
   type ThresholdCuts = { critico: number; riesgo: number; atencion: number; exceso: number };
   export function classifyAlert(
     inventoryUnits: number | null,
     daysOfInventory: number | null,
     cuts: ThresholdCuts,
   ): AlertStatus { ... }
   ```

2. **SQL** (`core/kpis/queries.ts`): el KPI4 "alertas activas" tiene un **CASE WHEN inline
   en SQL** dentro de `getDashboardKpis`. Hay que templatizarlo con `Prisma.sql` pasando
   los valores **validados como enteros > 0** (no `$queryRawUnsafe`; usar `Prisma.sql\`
   ... ${cuts.critico} ...\`` que es paramétrico). El resto de las queries (`getOneTableRows`,
   `getInventorySemaforo`) usan la función TS via post-processing y solo necesitan recibir
   el config como argumento.

**Cargar la config 1x por request** (cache de React Server Components o pasar como arg
desde el handler). Sin esto, cada query a `ThresholdConfig` por KPI sería 4× round trips
inútiles.

---

## 5. Fuzzy match — spec (CERRADO)

### 5.1 Dónde y cómo corre

- **Server-side, durante el parse.** El parser ya corre en el server.
- Pipeline: leer la columna de nombres del archivo → **extraer strings únicos** (Set,
  O(filas)) → fuzzy del set chico contra los SKUs del catálogo (decenas × decenas).
- Devuelve las sugerencias junto con el resultado del parse: **un solo round trip.**
- **Determinístico → testeable con Vitest.**

### 5.2 Algoritmo: implementación propia, no librería

**Decisión: implementación propia (~40 LOC TS) en `core/fuzzy/`.** Razones:

- **Supply chain:** Mini Shai-Hulud obliga a `--ignore-scripts` y pins exactos. Librerías
  populares (`fuse.js`, `string-similarity`, `fuzzball`) son legítimas pero suman
  superficie de dependencias indirectas que hay que auditar a cada update. Para 40 líneas,
  el costo de auditoría > el costo de implementarlo.
- **Determinismo y testabilidad:** propio garantiza que un cambio de versión de lib no
  movió los thresholds calibrados. La spec exige determinismo. Una lib con dependencia
  transitiva que cambie tokenización rompe la calibración silenciosamente.

**Pipeline conceptual:**

```ts
// core/fuzzy/token-set-ratio.ts
const tokenize = (s: string): Set<string> =>
  new Set(
    s.toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')   // strip puntuación
      .split(/\s+/)
      .filter(t => t.length > 1)
  );

export const tokenSetRatio = (a: string, b: string): number => {
  const A = tokenize(a), B = tokenize(b);
  if (A.size === 0 || B.size === 0) return 0;
  const inter = [...A].filter(t => B.has(t)).length;
  return (2 * inter) / (A.size + B.size);    // Sørensen-Dice
};
```

**Sin diccionario de palabras-ruido de VIKS.** Hardcodear "beefjerky", "carne seca",
"vik's" no escala a otros clientes. Si la precisión molesta a futuro → lista editable por
cliente (Fase 2 tardía o Fase 3, no ahora).

### 5.3 Peso como guarda dura, no señal

Extraer peso (número + g/gr/gramos) de ambos strings. Si ambos tienen peso y difieren →
bajar fuerte la confianza.

```ts
const WEIGHT_RE = /\b(\d{1,4})\s*(g|gr|grs|gramos?)\b/i;
export const extractWeightGrams = (s: string): number | null => {
  const m = s.match(WEIGHT_RE);
  return m ? parseInt(m[1], 10) : null;
};
export const weightPenalty = (a: string, b: string): number => {
  const wa = extractWeightGrams(a), wb = extractWeightGrams(b);
  if (wa === null || wb === null) return 1;           // no info → no penalty
  if (wa === wb) return 1;
  const diff = Math.abs(wa - wb) / Math.max(wa, wb);
  return Math.max(0, 1 - diff);
};
// score final = tokenSetRatio(a, b) * weightPenalty(a, b)
```

Esto evita colisionar `Chilli Lime 86g` con `Chilli Lime 20g`, y atrapa el caso real
`20g ↔ 28GR` de Soriana (lo deja en baja confianza, que es lo correcto: ese caso es
genuinamente incierto).

### 5.4 Detector de códigos (corre PRIMERO)

Si los strings de un portal son mayormente códigos (ASIN `B0…`, EAN de 13 dígitos) →
**salta el fuzzy entero** para ese portal y muestra los strings como pick-list manual.
Cubre Amazon (ASIN) y La Comer (barcode) automáticamente.

### 5.5 Tres bandas

| Banda | Condición | Comportamiento UI | Status al guardar |
|---|---|---|---|
| Alta | `score ≥ T_high` | Pre-llena, sin warning | `CONFIRMED` al aceptar |
| Media | `T_low ≤ score < T_high` | Pre-llena **con warning**; **requiere palomita explícita** del humano | `CONFIRMED` al palomear |
| Baja / código | `score < T_low` o gibberish | NO pre-llena; cae a casilla manual | `CONFIRMED` (default) salvo flag manual deliberado → `PENDING_REVIEW` |

- **Nunca auto-aplica.** Toda sugerencia es una propuesta que el humano acepta/rechaza.
- **Mapeo manual aceptado → `CONFIRMED`.** `PENDING_REVIEW` es **solo** flag deliberado
  del usuario (ej. casos "confirmar que sea el mismo producto" de la hoja NOTAS de VIKS).
  No automático.

### 5.6 Calibración como deliverable explícito

`T_high` y `T_low` **se calibran corriendo el fuzzy contra los 3 archivos reales**
(Soriana / Chedraui / HEB) y midiendo dónde empiezan los mismatches.

**Deliverable:** `scripts/calibrate-fuzzy.ts`. Output: tabla de score × is_correct sobre
los samples, con sugerencia de cortes. **No se congelan T_high/T_low sin medir.**

Arranque tentativo `T_high ≈ 0.7`, `T_low ≈ 0.3` — placeholder para arrancar el desarrollo;
se reemplazan con el output del script antes de cerrar el feature.

### 5.7 Caso Chedraui (acknowledgement)

Chedraui pre-llena casi nada — "Limo/Pim/Hab/Mar" son abreviaturas en español que no
matchean los nombres en inglés del catálogo VIKS. Esperado; degrada a manual sin romper
nada. El usuario hace mapeo manual de los SKUs de Chedraui en el onboarding.

### 5.8 Mapeo manual "a escala" — NO en Fase 2

Para el cliente VIKS (16 SKUs), el mapeo manual de Chedraui es tolerable. Para un cliente
futuro con 50+ SKUs, una herramienta de **bulk-assign** (multi-select de portalStrings +
asignar a SKU) sería ergonómica.

**Decisión:** NO se construye bulk-assign en Fase 2. Anotado como concern para cuando
entre el primer cliente de ≥ 50 SKUs.

### 5.9 Responsabilidad del usuario

El fuzzy sugiere; el humano reacomoda errores. La responsabilidad final del mapeo es del
usuario.

---

## 6. Credenciales de portal — Fase 2

### 6.1 Alcance en Fase 2

- **Solo se guarda `username`.** El password NO se captura ni almacena.
- Razón: el upload es manual; las credenciales solo se usan para el **scraping de Fase 3**.
  Guardar passwords que no se usan por meses = liability pura sin beneficio presente.
- En el front aparecen los campos de credenciales (para que el flujo se vea completo), pero
  el campo de password está **visiblemente inactivo** (disabled / microcopy "se solicitará
  al activar la automatización").
- **Regla no-negociable:** el campo dummy **NO transmite un password real al backend.**
  Replicar el patrón `hasPasswordPending` del demo: registra que hay credencial pendiente
  sin tocar la clave. Un campo dummy que mande la clave al server y la descarte/loguee
  crearía justo el riesgo que se está difiriendo.
- Microcopy debe decir explícitamente **"Fase 3"**, no "Fase 2 con KMS" (texto legacy del
  spec de Fase 1 que ya no aplica).

### 6.2 Cifrado en Fase 3

Diseño de AES-256-GCM, `keyVersion`, IV/authTag, gestión de master key, modelo de amenaza:
todo el detalle vive en **`docs/specs/onetable-fase3-spec-draft.md §1`**.

Se sacó de esta spec porque era diseño Fase 3 puro y sumaba ruido al alcance Fase 2.

---

## 7. Resolución de montos al query (respeta D4: al query, nunca al insert)

Para un `(producto, cadena)`, el monto en pesos sale de, en orden:

1. **El peso real del archivo si existe** (Soriana trae pesos; Chedraui/Amazon no) — el
   archivo manda.
2. Si no, el **override** de esa cadena (`ProductPriceOverride`).
3. Si no, el **precio base** del producto (`Product.purchasePriceBase` / `salePriceBase`).
4. Si no, **null → la UI muestra "—"**. Nunca se fabrica un número.

- Misma lógica de COALESCE que ya se usa en el UPSERT.
- Compra (ingreso real) y venta (góndola): dos campos independientes, ambos nullable.
- Moneda: **MXN único**, sin columna de moneda en Fase 2.
- **No requiere backfill** cuando el usuario carga precios después de tener SelloutData:
  como el cálculo es al query, los KPIs incorporan los precios nuevos automáticamente.

---

## 8. Resolución de conflictos `portalString` → 2+ SKUs (CERRADO)

### 8.1 Premisa

Decisión de producto: **se PERMITE el conflicto, no se bloquea.** Ambos mapeos se marcan
con `status = CONFLICTED` y el análisis sigue corriendo. El usuario ve resultados aunque
falte confirmar a qué SKU pertenece la data.

### 8.2 Schema

Cubierto en §4.4: `MappingStatus` enum + partial unique index que excluye `CONFLICTED`.
Permite N rows con mismo `(clientId, chain, portalString)` cuando todas son `CONFLICTED`.

### 8.3 Behavior del normalizer

El lookup ahora devuelve un discriminated union:

```ts
type MappingLookup = (chain: Chain, portalString: string) =>
  | { kind: 'mapped'; productId: string }
  | { kind: 'unmapped' }
  | { kind: 'conflict'; candidateIds: string[] };
```

| Resultado | SelloutData.productId | UnmappedProduct |
|---|---|---|
| `mapped` | productId | no se toca |
| `unmapped` | NULL | INSERT/UPDATE (flujo existente) |
| `conflict` | NULL | **no se toca** (el conflicto vive en `ProductMapping` con `status=CONFLICTED`) |

### 8.4 KPI integrity — framing honesto

- **Filas en conflicto NO entran a queries SKU-level** (mismo comportamiento que unmapped:
  `productId IS NULL` las excluye).
- **SÍ entran a totales no-agrupados-por-SKU** (ej. ventas totales del periodo por cadena
  que suman `salesAmountMxn` sin `GROUP BY productId`). El dinero ocurrió, la atribución a
  SKU está pendiente.
- **Microcopy en Portales** debe comunicar esto explícito:
  > *"Las filas en conflicto suman en los totales generales pero no en el análisis por SKU.
  > Resolvé el conflicto para que entren al detalle del producto."*
- **Banner en Dashboard separado del de unmapped:**
  > *"X portalStrings en conflicto. Resolvelos en Portales para que entren al análisis
  > por SKU."*

### 8.5 UI de resolución en Portales

En la card del portal, sección "En conflicto":

```
┌─ AMAZON ──────────────────────────────────────────────┐
│ Portal strings en conflicto (1):                      │
│ B07XKZJ8H1 → 2 candidatos:                            │
│   ○ Chilli Lime 100g     [Es éste]  [No, otro]        │
│   ○ Habanero 100g        [Es éste]  [No, otro]        │
└───────────────────────────────────────────────────────┘
```

**Acciones, ambas en transacción atómica:**

1. **"Es éste" en SKU X:**
   - DELETE de los ProductMapping de los candidatos perdedores.
   - UPDATE ProductMapping del ganador SET `status = CONFIRMED`.
   - UPDATE SelloutData SET `productId = X` WHERE `clientId = ? AND chain = ? AND
     portalRawProduct = ? AND productId IS NULL`. Backfill — mismo patrón que la
     resolución de `UnmappedProduct` que ya existe en el normalizer.

2. **"Ninguno":**
   - DELETE de todos los ProductMapping candidatos.
   - El portalString cae a "Sin mapear" (cola `UnmappedProduct` normal).

### 8.6 Test obligatorio

Vitest: crear conflicto, normalizar 5 filas con el portalString conflictuado, resolver a
SKU A, asertar que las 5 filas terminan con `productId = A`.

---

## 9. Chatbot IA y Forecasting

### 9.1 Chatbot IA — build en Fase 2

Arquitectura **tool-use sobre las queries existentes**. El modelo llama las funciones de
query como herramientas. **NO RAG sobre data cruda.**

#### 9.1.1 Wrapper layer

`core/ai/tools/` — un archivo por tool. Cada tool exporta:

```ts
tool({
  name: 'getTopSkus',
  description: 'Top N SKUs by sales units for a chain in a period. Use when the user asks "best sellers" / "top products" / "what sells most". Returns at most 50.',
  inputSchema: z.object({
    chain: z.enum([...]).optional(),
    periodYear: z.number().int(),
    periodMonth: z.number().int().min(1).max(12),
    limit: z.number().int().min(1).max(50).default(20),
  }),
  execute: async (args, context: { clientId: string; userId: string }) =>
    getTopSkusByChain(db, { ...args, clientId: context.clientId, userId: context.userId }),
});
```

**Crítico:** `inputSchema` **NO incluye `clientId` ni `userId`**. Si el modelo intentara
pasarlos por prompt injection, Zod los rechaza antes de llegar al execute. El `context` se
inyecta server-side desde la session de NextAuth en el handler de `/api/ai/chat`.

**Tools del catálogo inicial** (refinables): `getDashboardKpis`, `getTopSkusByChain`,
`getSalesTrend`, `getInventorySemaforo`, `getOneTableRows` (con `limit` cap 50, default 20),
`getDaysOfInventoryBySku`.

#### 9.1.2 Capping

- **`maxSteps: 5`** en el `streamText`/`generateText` de AI SDK. Después corta y devuelve
  lo que tenga. Evita loops del modelo.
- Tools que devuelven listas: `limit` parametrizado (default 20, max 50). Forzá el modelo
  a usar agregados (`getTopSkus(limit=5)`) en vez de leer raw rows.
- System prompt + tool definitions estables → **prompt caching** de Anthropic (savings de
  50-90% en re-runs del mismo chat).

#### 9.1.3 Stack

- **Vercel AI SDK v6 + AI Gateway.**
- Provider strings via gateway: `'anthropic/claude-haiku-4-5'` default (router barato),
  escalable a `'anthropic/claude-sonnet-4-6'` para análisis con razonamiento.
- API route: `/api/ai/chat` con streaming. UI: chat panel en Análisis.

#### 9.1.4 Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Tenant leakage por prompt injection | Context server-side inyectado; Zod schema rechaza `clientId/userId` en input |
| Cost runaway | `maxSteps`, result caps, AI Gateway observability |
| Prompt injection vía data (SKU names con instrucciones) | Tools devuelven JSON estructurado; el modelo trata data como data. Bajo-riesgo aceptable para beta |
| Log exposure de tool results | Filtrar/redactar payloads en logs (Vercel logs por defecto) |

#### 9.1.5 Costo estimado: ~16-20h

- Wrappers de tools (~6-8 tools): ~4h.
- API route con streaming: ~3h.
- UI chat panel (input + history + streaming render): ~4-6h.
- Tests + edge cases (maxSteps, error en tool, tenant isolation): ~3h.
- Tuning de modelo + cost monitoring: ~2h.

### 9.2 Forecasting — diseño congelado, build deferido a Fase 2.5

**Por qué se difiere:** en la beta VIKS ninguna serie (cliente × producto × cadena) tiene
≥ 3 meses. El feature mostraría `insufficient` en el 100% de los casos. No vale construir
el modelo baseline hasta tener data que justifique mostrarlo activo.

#### 9.2.1 Diseño (congelado, para implementar en 2.5)

`core/forecast/index.ts`:

```ts
export type ForecastResult =
  | { kind: 'forecast'; method: 'baseline-ma3'; points: ForecastPoint[]; confidence: 'low' | 'medium' }
  | { kind: 'insufficient'; monthsAvailable: number; monthsRequired: 3; nextEligible: string /* YYYY-MM */ };

export async function getForecast(
  db: PrismaClient,
  args: { clientId: string; productId: string; chain: Chain },
): Promise<ForecastResult>;
```

**Gate (donde vive la regla "3 meses"):** dentro de `getForecast`, NO en la UI. Count
distinct `(periodYear, periodMonth)` en `SelloutData` para `(clientId, productId, chain)`
con `salesUnits > 0`. Si < 3 → `kind: 'insufficient'`.

**Granularidad por (cliente × producto × cadena):** VIKS puede tener 5 meses en Soriana y
1 mes en Amazon — Soriana muestra forecast, Amazon muestra "insuficiente". Correcto.

#### 9.2.2 Modelo baseline (cuando se active)

- Media móvil 3 meses + extrapolación lineal. ~4-6h impl + tests.
- Sin librerías de ML, sin entrenamiento, sin Prophet/ARIMA. Para series cortas (3-6 meses)
  estos modelos no hacen nada distinto al baseline; no justifican la dependencia.
- Honesto sobre limitaciones: `confidence: 'low'` para 3-4 meses, `'medium'` para 6+.
  Nunca `'high'`.

#### 9.2.3 UI en Fase 2 (scaffold)

- La página Análisis muestra una sección "Forecasting" con la card del producto.
- Resultado actual = `kind: 'insufficient'`. UI renderiza mensaje honesto:
  > *"Necesito 3 meses por cadena para predecir. Tenés 1 mes en Soriana. Próxima
  > predicción: julio 2026."*
- Cuando llegue julio (build de 2.5 ya merged): esa misma card automáticamente renderiza
  el forecast. Sin re-deploy, sin cambio de código.
- **No** renderiza chart vacío con "Coming soon".

---

## 10. Importer del catálogo — Parámetros (CERRADO)

### 10.1 Scope split: parameters vs catalog (seed)

- **`core/parameters/import.ts` (NUEVO):** user-facing, expuesto en Parámetros. Columnas
  del Excel: `Código`, `Producto`, `PrecioCompra`, `PrecioVenta`. **Nunca toca
  `ProductMapping`.** Aditivo, idempotente, no destructivo.
- **`core/catalog/import.ts` (existente):** queda como código de seed only. Conoce el
  formato VIKS pivoteado (columnas por portal). One-shot, autoritativo, privilegiado. NO
  exponer en UI. NO refactor.

**Trade-off:** dos módulos en lugar de uno refactorado. Justificación: los contratos son
distintos (user-facing aditivo vs bootstrap autoritativo). Compartir código entre ambos
los acopla a un menor común denominador que oscurece el intent.

### 10.2 Round-trip Excel ↔ sistema

**Export desde Parámetros:**
- Genera Excel con `Código` como **columna A** (primera). Header literal `Código`.
- La columna está siempre, incluso si el usuario nunca la editó.

**Import comportamiento por fila:**

| Caso | Acción |
|---|---|
| `Código` presente, existe en DB | UPDATE de nombre + precios (Excel-wins, ver §10.3) |
| `Código` presente, no existe en DB | INSERT con ese código como override del usuario (caso: usa códigos internos `CL-86`, `HAB-100`) |
| `Código` vacío | INSERT con `cuid()` auto-generado |
| Columna `Código` no existe en el Excel | **Modo "catálogo nuevo":** todas las filas son insert + warning prominente *"este Excel no tiene códigos. Para actualizaciones futuras, exportá primero desde Parámetros."* |

**Microcopy en el input de import** (obligatorio):
> *"Para actualizar SKUs existentes, exportá primero el catálogo desde Parámetros. La
> columna Código es el enlace entre tu Excel y tus SKUs."*

**Por qué NO match por nombre (ni siquiera la primera vez):**
- El nombre es editable. Si el usuario renombra "Chilli Lime 86g" → "Chili Lime 86g" y
  re-importa, el matching por nombre crearía un SKU duplicado silenciosamente. Mappings y
  SelloutData quedan apuntando al viejo, dashboard se rompe.
- "Solo la primera vez" es ambiguo: la regla simple "Excel sin códigos = todo nuevo" es
  predecible y enseñable.

### 10.3 Upsert semantics — Excel-wins sin destrucción por vacío

- Celda con valor pisa DB.
- **Celda vacía deja DB intacta** (NO setea a NULL). Sin esto, una columna vacía borraría
  precios silenciosamente.
- Re-import NUNCA borra: ni SKUs ausentes del Excel, ni precios ausentes.
- Idempotente: dos re-imports seguidos del mismo Excel dejan el estado igual.

### 10.4 Footgun: rename de `skuCode` en Excel

Si el usuario edita el `skuCode` de una fila en el Excel y re-importa, el importer no lo
encuentra y **crea un Product nuevo** — el viejo Product (con todos sus mappings y
SelloutData históricos) queda fantasma.

**Mitigación cerrada:** rename de `skuCode` es **operación de UI atómica** (UPDATE
`Product SET skuCode = ? WHERE id = ?`), NO del Excel re-import. Preserva todas las FKs.

**Microcopy** en la columna del export y en el dialog de import:
> *"El código se edita desde la app, no desde el Excel. Editarlo aquí crea un SKU nuevo."*

Si el usuario igual lo edita y crea un duplicado, es visible en la UI y reparable
manualmente desde Parámetros (delete del fantasma).

### 10.5 Tests obligatorios

- Vitest: re-importar el catálogo de seed con celdas vacías de precio. Asertar que el
  Product mantiene sus precios anteriores intactos.
- Vitest: contar SelloutData antes y después de un re-import. Asertar que el count es
  idéntico (el importer no toca `SelloutData` ni `ProductMapping`).

---

## 11. Deuda demo→producto a saldar ANTES de avanzar (CERRADO)

1. **Re-habilitar branch protection** en GitHub (el trigger de ADR-001 era "inmediatamente
   después del demo ANTAD" — ya pasó).
2. **Montar CI** (GitHub Actions) que corra los **89 tests** (no 72 como decía el draft
   original) en cada PR. Desbloquea el branch protection con required status checks.
3. **Construir el registry de parsers** que el spec de Fase 1 dejó diseñado pero no se
   implementó. Hoy son if/else inline con regex en `app/api/data/upload/route.ts`.
   ~2-3h con tests. Bloquea las parsers nuevas (HEB / AL_SUPER / LA_COMER).
4. Cifrado de credenciales → diferido a Fase 3 (`onetable-fase3-spec-draft.md §1`).
5. Thresholds configurables → formalizado en Parámetros (§3.1.3 / §4.5).

---

## 12. Orden de ejecución (B0 → B6)

### 12.1 Bloques con estimados y dependencias

| Bloque | Tareas | Estimado | Bloquea |
|---|---|---|---|
| **B0 — Hardening** | Branch protection ON + CI con 89 tests | 2-3h | Todo lo demás (CI debe estar antes del primer feature PR) |
| **B1 — Pre-work paralelizable** | Registry de parsers (§11.3) + Schema migration (§4: skuCode, prices, ProductPriceOverride, ThresholdConfig, ProductMapping.status, partial unique index) | 4-6h | B2, B3, B4 |
| **B2 — Foundations (paralelo)** | classifyAlert refactor TS + SQL templatización (§4.8) **+** Fuzzy module + calibration script (§5) | 16-20h | B3 (clf), B4 (fuzzy) |
| **B3 — Parámetros + drill-down (paralelo)** | Parámetros (SKUs + importer nuevo + prices + thresholds UI con validación no-overlap) **+** Mover drill-down Dashboard→Análisis con coupling resuelto (§3.3) | 16-22h | B5 (IA necesita config completa para tener algo que analizar) |
| **B4 — Portales** | Cards por cadena + fuzzy en UI + override de precios + credenciales dummy + upload por chain + conflict resolution UI + backfill (§8) | 24-32h | B5 |
| **B5 — IA (paralelo)** | Chatbot IA tool-use (§9.1). Forecasting NO se construye en Fase 2 (diseño congelado, build 2.5; el scaffold de UI con `insufficient` va dentro de B3 / B4 según dónde renderice) | 16-20h | — |
| **B6 — Drop-in chains** | HEB / AL_SUPER / LA_COMER parsers + habilitarlos en registry | 8-12h | Bloqueado externamente (archivos Excel reales del cliente) |

### 12.2 Diagrama de dependencias

```
B0 (hardening)
  ↓
B1 (registry + schema migration)
  ├─→ B2.clf (classifyAlert refactor) ──→ B3.params (Parámetros) ──┐
  ├─→ B2.fuzzy (fuzzy module) ────────→ B4 (Portales) ────────────┤
  └─→ B3.drill (mover drill-down) ────────────────────────────────┤
                                                                   ↓
                                                                  B5 (chatbot IA)

B6 (drop-in chains) ←─ bloqueado: archivos Excel reales de VIKS
```

### 12.3 Total y scope cuts

**Total estimado: 86-115h** (con forecasting ya removido del scope de build).

Para una persona sola en beta con un solo cliente (VIKS), esto es ~3-5 meses de trabajo
focused. Si el ritmo es "evenings + weekends", multiplicá por 2-3x.

**Recomendaciones de scope cut si hay presión de tiempo:**

- **Diferir HEB/AL_SUPER/LA_COMER (ahorra 8-12h):** son drop-in, pero no se demuestran sin
  archivos reales. Hasta que el cliente los provea, son code paths sin verificación.
- **Threshold UI con defaults read-only en Fase 2 (ahorra 3-4h):** mostrá los cuts pero
  deshabilitá la edición ("editable en Fase 2.5"). Mantiene el feature visible.

**NO recortar:**
- B0 hardening (es una garantía, no un feature).
- B1 pre-work (deuda que se cobra carísima después).
- B2 fuzzy + classifyAlert refactor (foundations de B3 + B4).
- Conflict resolution en B4 (la spec lo promete, romper esa promesa es peor que cualquier
  scope cut).

---

## 13. Decisiones [CC] resueltas durante el review técnico

| [CC] del draft original | Resolución |
|---|---|
| Forma exacta de la relación `Product`–`Client` y cómo forzar 1 Client por cuenta | Schema sin cambio (`Product.clientId` FK existe). Regla en app layer vía helper `getCurrentClient(userId)` en `lib/tenant.ts`. Sin endpoint de crear cliente desde UI. Multi-marca futura = remover el helper. (§1) |
| Implementación concreta del token-set ratio (lib vs propio) + extracción de peso | Propio, ~40 LOC, Sørensen-Dice. Sin librería. Razones supply chain + determinismo. Weight como guarda dura via regex `\b(\d{1,4})\s*(g|gr|grs|gramos?)\b`. (§5.2, §5.3) |
| Estructura de `ThresholdConfig` (columnas vs JSON) | Columnas tipadas (`criticoDays/riesgoDays/atencionDays/excesoDays`). Razones: type safety, futura DB CHECK, templatización SQL limpia. (§4.5) |
| Mecánica del multi-valor de `portalString` por SKU en la UI | Schema ya soporta N-to-1 (la unique constraint impedía duplicados *del lado del portalString*). UI: lista de rows independientes por SKU dentro de la card del portal con `[+ Agregar otro string]`. (§3.2.1) |

### 13.1 [CC] que permanecen (a calibrar en implementación)

- **Calibración exacta de `T_high` / `T_low`:** depende de medición empírica con archivos
  reales vía `scripts/calibrate-fuzzy.ts` (§5.6). Arranque tentativo `T_high ≈ 0.7`,
  `T_low ≈ 0.3`; cortes finales salen del script.

---

## 14. Casos borde confirmados con data real de VIKS

Para tests y diseño de UI; salieron del archivo de mapeo real (`Catalogo_Producto`):

- **Conflicto real:** el string de AL SUPER `(T)CARNE SECA TROZO CITRUS GINGER VIKS JERKY
  100 GRAMOS` está mapeado a **dos** SKUs (`Chilli Lime 100g` y `Habanero 100g`). En
  Fase 1 se resolvió silenciosamente vía `ON CONFLICT DO NOTHING` (last-wins + warning).
  En Fase 2 este es el **caso canónico** del flujo de conflict resolution descrito en §8.
  Las NOTAS del archivo ya lo flaggean: "confirmar que sea el mismo producto".
- **Desfase de peso:** `Chilli Lime 20g` (catálogo) ↔ Soriana `...CHILLI LIME ...28GR`.
  Las etiquetas de peso del portal no son confiables → el usuario siempre puede
  sobrescribir. El fuzzy con weight penalty (§5.3) deja este caso en banda media (warning
  + palomita requerida), que es lo correcto.
- **SKU sin mapeos:** `Machaca 500g` no se vende en ningún portal. Estado válido (§3.1.1).
- **Estado `PENDING_REVIEW` = flag manual deliberado**, para los casos de la hoja NOTAS
  ("verificar si se venden", "nombre truncado en portal"). La data `PENDING_REVIEW` entra
  a los KPIs (§3.2.3); no requiere JOIN extra ni badges per fila.
