# OneTable — Fase 1 Spec (Demo ANTAD)

> Spec resultante del brainstorming de Superpowers. Cubre Q1–Q7 del Plan V1
> con detalle suficiente para que `/superpowers:writing-plans` lo convierta
> en plan ejecutable sin ambigüedades.
>
> Fecha: 2026-05-18  •  Deadline: presentación ANTAD lunes-martes
> (3-4 días desde la fecha del spec).

---

## 0. Contexto

### Inputs leídos
- `OneTablePlanV1.md` — alcance, restricciones, preguntas abiertas.
- `docs/specs/onetable-srs-v1.docx` — SRS legacy (Scopium). §4.4 schema sugerido, §5 portales, §7 normalización. Reglas de scrapers/Celery/AWS son Fase 3+, se ignoran.
- `docs/specs/viks-data/README.md` — ground truth de los 6 portales.
- `docs/specs/viks-data/samples/*.xlsx` + `catalogo-productos.xlsx` — data real verificada.

### Inconsistencias resueltas en brainstorming
1. **La Comer "milésimas":** SRS dice dividir entre 1000; sample data confirma valores en unidades crudas. La Comer está fuera de Fase 1; nota de verificación para Fase 2.
2. **Duplicado en catálogo VIKS (AL SUPER):** misma string `(T)CARNE SECA TROZO CITRUS GINGER...` apunta a "Chilli Lime 100g" y "Habanero 100g". Es error de captura del cliente. AL SUPER fuera de Fase 1; al seedear se ejecuta `ON CONFLICT DO NOTHING` (last-wins) y se loguea warning. Cuando AL SUPER entre en Fase 2, la página Catálogo expone el conflicto para que el cliente lo resuelva.
3. **Schema SRS vs README:** README supersedea SRS (más detallado y alineado con la realidad de la data).
4. **D3 multi-tenancy aclarado:** sin tabla Agency en Fase 1. `Client.userId` FK directo. Tablas de data llevan `clientId` (FK) + `userId` (denormalizado) para queries rápidas. Tabla Agency se agrega con migración en Fase 2 si hace falta.

### Decisiones del usuario (D1–D8) ya commiteadas
- **D1** — Parsers Fase 1: solo **Soriana, Chedraui, Amazon**. HEB / AL SUPER / LA COMER aparecen en UI con tooltip "Próximamente, llegan esta semana".
- **D2** — Polish concentrado en Landing + Dashboard. El resto: functional, clean, minimal.
- **D3** — Multi-tenancy un solo nivel (`User → Client → data`). Sin tabla Agency.
- **D4** — KPIs calculados al query (no al insert). Sin materialized views.
- **D5** — Export Excel/CSV client-side con SheetJS.
- **D6** — Selector manual de portal en upload (no auto-detect).
- **D7** — Productos sin mapear: insertar `SelloutData` con `productId = NULL` + insertar/actualizar `UnmappedProduct`. Banner persistente en Dashboard "Tienes N productos sin mapear" con CTA a Catálogo.
- **D8** — Branch protection en GitHub OFF durante setup. Hook local `block-main-writes` protege. Decisión consciente registrada en ADR-001 (ver `docs/adr/ADR-001-branch-protection-off-during-setup.md`).

### Decisiones cerradas durante el brainstorming
- **Upload UX:** selector explícito por archivo en la página Análisis. Etiquetas: `Soriana — Mixto`, `Chedraui — Mixto`, `Amazon — Ventas`, `Amazon — Inventario`. Una Upload row por archivo.
- **UPSERT key de `SelloutData`:** `(clientId, chain, storeId, portalRawProduct, periodYear, periodMonth)` con `NULLS NOT DISTINCT` (Postgres 15+, Neon lo soporta). Merge con `COALESCE` por campo: un upload de solo inventario no pisa ventas previas.
- **Resumen post-upload:** `"X filas procesadas, Y nuevas, Z actualizadas, W sin mapear"`.
- **Días de inventario:** `CASE WHEN salesUnits > 0 THEN (inventoryUnits::float / salesUnits) * 30 ELSE NULL END`. Frontend renderiza `NULL` como "—" o "sin rotación".
- **Catálogo:** flujo híbrido. Modal de crear cliente con file input opcional para Excel formato VIKS pivoteado. Si no se sube, catálogo crece incremental vía unmapped queue.
- **Credenciales de portal:** tabla `PortalCredential` con `username` storeado, `password` discarded silenciosamente, `hasPasswordPending bool`. Microcopy: "Password se cifrará y almacenará en Fase 2 con KMS, por ahora solo registramos el username". Label dinámico (`Email` para Amazon, `Usuario` para el resto). UI con checkbox + Collapsible por portal.
- **Dashboard scope:** FULL SRS (4 KPI cards + 5 charts + OneTable con filtros + badges + export). ~10-12h.
- **Alert thresholds:** defaults propuestos (ver §6.3). Configurables en Fase 2.
- **Auth:** Login + sign-up funcional + botón "Probar demo" destacado. NextAuth v5 + Credentials + JWT.
- **Seed:** **estático puro** (user + client + products + mappings + portal_credentials). NO corre parsers, NO popula `SelloutData`. El demo ES el upload en vivo. Pre-flight obligatorio contra DB de prueba antes de cada presentación.
- **Time budget:** ~38h con subagentes paralelizando Sprint, ~45h conservador. Sobre 35h target. Cut priorities en §8.

---

## 1. Stack y arquitectura (recordatorio)

- **Frontend + API:** Next.js 14 App Router + TypeScript + Tailwind + shadcn/ui.
- **DB:** Postgres en Neon vía Prisma.
- **Auth:** NextAuth v5 + Credentials + JWT (sin sessions table).
- **Charts:** Recharts.
- **Excel/CSV:** SheetJS (`xlsx`) + Papaparse (cliente).
- **Deploy:** Vercel.
- **Visual:** dark mode primero + accent color (estilo Linear/Vercel).

**Layout de carpetas relevante (a confirmar en sprint S1):**

```
OneTable/
├── app/                       # Next.js App Router
│   ├── (auth)/login, signup
│   ├── (app)/dashboard, analisis, clientes, catalogo, promotoria
│   ├── api/
│   │   ├── auth/[...nextauth]/route.ts
│   │   ├── clients/...
│   │   ├── uploads/route.ts
│   │   ├── products/...
│   │   └── catalog/import/route.ts
│   └── layout.tsx, page.tsx (landing)
├── components/                # shadcn + custom UI
├── core/                      # lógica pura, sin imports de Next
│   ├── parsers/
│   │   ├── types.ts
│   │   ├── index.ts           # registry: Chain → PortalParser
│   │   ├── soriana.ts
│   │   ├── chedraui.ts
│   │   ├── amazon-ventas.ts
│   │   └── amazon-inv.ts
│   ├── normalizer/
│   │   ├── types.ts
│   │   └── index.ts
│   ├── catalog/
│   │   └── import.ts          # parsea catalogo-productos.xlsx
│   ├── kpis/
│   │   ├── compute.ts
│   │   └── queries.ts         # raw SQL helpers
│   ├── alerts/
│   │   └── classify.ts        # umbrales
│   └── chains.ts              # enum + display names
├── lib/                       # server-side helpers
│   ├── auth.ts                # NextAuth config
│   ├── db.ts                  # prisma client singleton
│   └── tenant.ts              # filter-by-userId helper
├── prisma/
│   ├── schema.prisma
│   └── migrations/
├── scripts/
│   ├── seed.ts                # demo user + client + catálogo + creds
│   └── preflight.ts           # corre los 4 uploads contra DB test
├── docs/specs/                # spec actual + viks-data/
├── tests/
│   └── parsers/               # vitest contra samples reales
├── .claude/hooks/
└── package.json
```

**Carpeta `core/` es zero-dep de Next.js** — puede empaquetarse aparte en Fase 3 y portarse a Python sin reescribir UI/API.

---

## 2. Q1 — Schema Prisma final

### 2.1 Modelos

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// =====================================================================
// Identity
// =====================================================================

model User {
  id           String   @id @default(cuid())
  email        String   @unique
  passwordHash String
  name         String?
  createdAt    DateTime @default(now())

  clients      Client[]
}

model Client {
  id        String   @id @default(cuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  name      String
  email     String?
  createdAt DateTime @default(now())

  products          Product[]
  productMappings   ProductMapping[]
  portalCredentials PortalCredential[]
  uploads           Upload[]
  selloutData       SelloutData[]
  unmappedProducts  UnmappedProduct[]

  @@index([userId])
}

// =====================================================================
// Catálogo
// =====================================================================

enum Chain {
  SORIANA
  CHEDRAUI
  HEB
  AL_SUPER
  LA_COMER
  AMAZON
}

model Product {
  id           String   @id @default(cuid())
  clientId     String
  client       Client   @relation(fields: [clientId], references: [id], onDelete: Cascade)
  nameStandard String   // viene de columna "Producto VIKS" del Excel
  createdAt    DateTime @default(now())

  mappings    ProductMapping[]
  selloutData SelloutData[]

  @@unique([clientId, nameStandard])
  @@index([clientId])
}

model ProductMapping {
  id           String   @id @default(cuid())
  clientId     String
  client       Client   @relation(fields: [clientId], references: [id], onDelete: Cascade)
  productId    String
  product      Product  @relation(fields: [productId], references: [id], onDelete: Cascade)
  chain        Chain
  // String literal del portal (ASIN para Amazon, EAN para La Comer, nombre exacto para el resto)
  portalString String
  createdAt    DateTime @default(now())

  @@unique([clientId, chain, portalString])
  @@index([clientId, chain])
  @@index([productId])
}

// =====================================================================
// Credenciales de portal (Fase 1 = solo username)
// =====================================================================

model PortalCredential {
  id                 String   @id @default(cuid())
  clientId           String
  client             Client   @relation(fields: [clientId], references: [id], onDelete: Cascade)
  chain              Chain
  username           String
  isActive           Boolean  @default(true)
  // true = el usuario indicó que el portal tiene password pero NO la storeamos en F1
  hasPasswordPending Boolean  @default(true)
  createdAt          DateTime @default(now())
  updatedAt          DateTime @updatedAt

  @@unique([clientId, chain])
}

// =====================================================================
// Uploads + data
// =====================================================================

enum FileType {
  MIXED        // Soriana, Chedraui (ventas + inv en un archivo)
  VENTAS
  INVENTARIO
}

enum UploadStatus {
  PENDING
  PROCESSING
  COMPLETED
  FAILED
}

model Upload {
  id               String       @id @default(cuid())
  clientId         String
  client           Client       @relation(fields: [clientId], references: [id], onDelete: Cascade)
  userId           String       // denormalizado para queries fast por tenant
  chain            Chain
  fileType         FileType
  originalFilename String
  fileHash         String       // sha256 hex del archivo crudo
  fileSizeBytes    Int
  status           UploadStatus @default(PENDING)
  rowsTotal        Int          @default(0)
  rowsInserted     Int          @default(0)
  rowsUpdated      Int          @default(0)
  rowsUnmapped     Int          @default(0)
  errorMessage     String?
  uploadedAt       DateTime     @default(now())
  processedAt      DateTime?

  selloutData      SelloutData[]
  unmappedProducts UnmappedProduct[]

  @@index([clientId, chain, fileType])
  @@index([userId])
  @@index([uploadedAt])
}

model SelloutData {
  id        String  @id @default(cuid())
  clientId  String
  client    Client  @relation(fields: [clientId], references: [id], onDelete: Cascade)
  userId    String  // denormalizado
  uploadId  String?
  upload    Upload? @relation(fields: [uploadId], references: [id], onDelete: SetNull)

  // Periodo (siempre presente)
  periodYear  Int
  periodMonth Int
  periodDate  DateTime? // solo para snapshots diarios (AL SUPER); usar @db.Date en migration

  // Dimensiones
  chain            Chain
  productId        String?  // NULL cuando unmapped
  product          Product? @relation(fields: [productId], references: [id], onDelete: SetNull)
  portalRawProduct String   // string crudo del portal — parte de la identidad

  // Store
  storeId     String? // NULL para AMAZON (con NULLS NOT DISTINCT en unique)
  storeName   String?
  storeFormat String? // formato de LA COMER (1=La Comer, 2=City Market, 3=Fresko)

  // Métricas (nullable per portal capability matrix del README)
  salesUnits              Int?
  salesUnitsEstimated     Boolean  @default(false) // true para AL SUPER
  salesAmountMxn          Decimal? @db.Decimal(12, 2)
  purchasesUnits          Int?
  purchasesAmountMxn      Decimal? @db.Decimal(12, 2)
  inventoryUnits          Int?
  inventoryAmountCostMxn  Decimal? @db.Decimal(12, 2)
  inventoryAmountPriceMxn Decimal? @db.Decimal(12, 2)
  daysOfInventory         Int?     // SOLO se persiste cuando el portal lo provee explícitamente (AL SUPER en Fase 2). Para todo lo demás permanece NULL y se calcula al query con CASE WHEN salesUnits > 0 THEN (inventoryUnits::float / salesUnits) * 30 ELSE NULL END

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  // Unique sobre identidad natural — ver §2.2 sobre NULLS NOT DISTINCT
  @@unique([clientId, chain, storeId, portalRawProduct, periodYear, periodMonth], map: "sellout_unique_idx")
  @@index([clientId, chain])
  @@index([clientId, productId])
  @@index([clientId, periodYear, periodMonth])
  @@index([userId])
  @@index([uploadId])
}

model UnmappedProduct {
  id                String    @id @default(cuid())
  clientId          String
  client            Client    @relation(fields: [clientId], references: [id], onDelete: Cascade)
  chain             Chain
  portalString      String
  firstSeenUploadId String
  firstSeenUpload   Upload    @relation(fields: [firstSeenUploadId], references: [id], onDelete: Cascade)
  occurrenceCount   Int       @default(1)
  resolvedAt        DateTime?
  resolvedProductId String?   // FK lógico — sin relación formal para evitar cycles, validar a mano
  createdAt         DateTime  @default(now())
  updatedAt         DateTime  @updatedAt

  @@unique([clientId, chain, portalString])
  @@index([clientId, chain, resolvedAt])
}
```

### 2.2 NULLS NOT DISTINCT en `SelloutData`

Prisma 5 no expone `NULLS NOT DISTINCT` declarativamente. Workaround:

1. Generar la migration normal con `prisma migrate dev --create-only`.
2. **Editar el SQL** de la migration antes de aplicar: cambiar
   ```sql
   CREATE UNIQUE INDEX "sellout_unique_idx" ON "SelloutData"(...);
   ```
   por
   ```sql
   CREATE UNIQUE INDEX "sellout_unique_idx" ON "SelloutData"(
     "clientId", "chain", "storeId", "portalRawProduct", "periodYear", "periodMonth"
   ) NULLS NOT DISTINCT;
   ```
3. Aplicar con `prisma migrate dev`.
4. Documentar este paso en el README de migrations para que no se regenere.

**Razón:** Amazon no tiene `storeId` (NULL). Con `NULLS DISTINCT` (default), dos rows Amazon para el mismo producto/periodo no se considerarían duplicadas y se insertarían N veces. `NULLS NOT DISTINCT` trata NULL como un valor concreto en la comparación.

### 2.3 UPSERT con COALESCE por campo

Prisma's `upsert()` no soporta merge condicional por campo. Usar SQL raw:

```typescript
// core/normalizer/upsert.ts
export async function upsertSelloutRow(tx: Prisma.TransactionClient, row: SelloutRowInput) {
  return tx.$queryRaw<{ action: 'inserted' | 'updated' }[]>`
    INSERT INTO "SelloutData" (
      id, "clientId", "userId", "uploadId",
      "periodYear", "periodMonth", "periodDate",
      chain, "productId", "portalRawProduct",
      "storeId", "storeName", "storeFormat",
      "salesUnits", "salesUnitsEstimated", "salesAmountMxn",
      "purchasesUnits", "purchasesAmountMxn",
      "inventoryUnits", "inventoryAmountCostMxn", "inventoryAmountPriceMxn",
      "daysOfInventory", "createdAt", "updatedAt"
    ) VALUES (
      ${cuid()}, ${row.clientId}, ${row.userId}, ${row.uploadId},
      ${row.periodYear}, ${row.periodMonth}, ${row.periodDate},
      ${row.chain}::"Chain", ${row.productId}, ${row.portalRawProduct},
      ${row.storeId}, ${row.storeName}, ${row.storeFormat},
      ${row.salesUnits}, ${row.salesUnitsEstimated ?? false}, ${row.salesAmountMxn},
      ${row.purchasesUnits}, ${row.purchasesAmountMxn},
      ${row.inventoryUnits}, ${row.inventoryAmountCostMxn}, ${row.inventoryAmountPriceMxn},
      ${row.daysOfInventory}, NOW(), NOW()
    )
    ON CONFLICT ("clientId", chain, "storeId", "portalRawProduct", "periodYear", "periodMonth") DO UPDATE SET
      "uploadId"               = EXCLUDED."uploadId",
      "productId"              = COALESCE(EXCLUDED."productId", "SelloutData"."productId"),
      "storeName"              = COALESCE(EXCLUDED."storeName", "SelloutData"."storeName"),
      "storeFormat"            = COALESCE(EXCLUDED."storeFormat", "SelloutData"."storeFormat"),
      "salesUnits"             = COALESCE(EXCLUDED."salesUnits", "SelloutData"."salesUnits"),
      "salesUnitsEstimated"    = EXCLUDED."salesUnitsEstimated" OR "SelloutData"."salesUnitsEstimated",
      "salesAmountMxn"         = COALESCE(EXCLUDED."salesAmountMxn", "SelloutData"."salesAmountMxn"),
      "purchasesUnits"         = COALESCE(EXCLUDED."purchasesUnits", "SelloutData"."purchasesUnits"),
      "purchasesAmountMxn"     = COALESCE(EXCLUDED."purchasesAmountMxn", "SelloutData"."purchasesAmountMxn"),
      "inventoryUnits"         = COALESCE(EXCLUDED."inventoryUnits", "SelloutData"."inventoryUnits"),
      "inventoryAmountCostMxn" = COALESCE(EXCLUDED."inventoryAmountCostMxn", "SelloutData"."inventoryAmountCostMxn"),
      "inventoryAmountPriceMxn"= COALESCE(EXCLUDED."inventoryAmountPriceMxn", "SelloutData"."inventoryAmountPriceMxn"),
      "daysOfInventory"        = COALESCE(EXCLUDED."daysOfInventory", "SelloutData"."daysOfInventory"),
      "periodDate"             = COALESCE(EXCLUDED."periodDate", "SelloutData"."periodDate"),
      "updatedAt"              = NOW()
    RETURNING (xmax = 0) AS inserted_flag, ...
  `;
}
```

**Detectar inserted vs updated:** Postgres trick — `xmax = 0` cuando la fila fue INSERT-eada en esta operación. Usar para contar `rowsInserted` vs `rowsUpdated` en stats del upload.

> **AJUSTE 5 (post-implementación S7):** PostgreSQL no permite `ON CONFLICT ON CONSTRAINT <name>` contra UNIQUE INDEX (solo contra CONSTRAINT backed por `pg_constraint`). Como `sellout_unique_idx` se crea via `CREATE UNIQUE INDEX ... NULLS NOT DISTINCT` (no `ADD CONSTRAINT UNIQUE`), el SQL usa la forma `ON CONFLICT (cols...)` que PG resuelve contra el matching unique index respetando `NULLS NOT DISTINCT` correctamente. Verificado empíricamente en S7 con Amazon UPSERT (`storeId=NULL`, segunda inserción → UPDATE como esperado).

### 2.4 Decisiones de schema importantes

- **Todas las relaciones a tablas tenant-owned** llevan `onDelete: Cascade`. Borrar un User cascade-elimina todo.
- **`SelloutData.uploadId` es `SetNull`:** preservamos data aunque se borre el Upload row (audit trail vivo).
- **`SelloutData.productId` es nullable y `SetNull`:** un producto puede borrarse del catálogo sin perder data histórica (queda como unmapped legacy).
- **`userId` denormalizado en `SelloutData` y `Upload`:** evita JOIN extra en queries de dashboard que ya filtran por tenant en cada request. Trade-off de redundancia bien acotado.
- **Sin ON CONFLICT a nivel `Product`/`ProductMapping`** — se asume que el seeder maneja duplicados explícitamente (last-wins con warning).

---

## 3. Q2 — Contrato del parser

### 3.1 Tipos compartidos

```typescript
// core/parsers/types.ts
import type { Chain, FileType } from '@prisma/client';

export type ParsedRow = {
  // Periodo (siempre presente; periodDate solo para snapshots diarios)
  periodYear: number;
  periodMonth: number;
  periodDate?: Date;

  // Identidad
  portalRawProduct: string;

  // Store (puede ser null)
  storeId: string | null;
  storeName: string | null;
  storeFormat: string | null;

  // Métricas — undefined = "este portal no provee este campo"
  salesUnits?: number;
  salesUnitsEstimated?: boolean;
  salesAmountMxn?: number;
  purchasesUnits?: number;
  purchasesAmountMxn?: number;
  inventoryUnits?: number;
  inventoryAmountCostMxn?: number;
  inventoryAmountPriceMxn?: number;
  daysOfInventory?: number;
};

export type ParserMetadata = {
  chain: Chain;
  fileType: FileType;
  originalFilename: string;
  fileHash: string;        // sha256 hex
  fileSizeBytes: number;
  rowCount: number;        // rows post-filtro (excluye header y vacíos)
};

export type ParserWarning = {
  rowIndex: number;        // 1-based excluyendo header
  field?: string;
  message: string;
};

export type ParserResult = {
  metadata: ParserMetadata;
  rows: ParsedRow[];
  warnings: ParserWarning[];
};

export interface PortalParser {
  readonly chain: Chain;
  readonly supportedFileTypes: readonly FileType[];

  parse(input: {
    buffer: Buffer;
    fileType: FileType;
    originalFilename: string;
  }): Promise<ParserResult>;
}
```

### 3.2 Registry — drop-in para nuevos portales

```typescript
// core/parsers/index.ts
import type { Chain, FileType } from '@prisma/client';
import type { PortalParser } from './types';
import { sorianaParser } from './soriana';
import { chedrauiParser } from './chedraui';
import { amazonVentasParser } from './amazon-ventas';
import { amazonInvParser } from './amazon-inv';

const REGISTRY = new Map<string, PortalParser>([
  // key = `${chain}:${fileType}`
  [`SORIANA:MIXED`, sorianaParser],
  [`CHEDRAUI:MIXED`, chedrauiParser],
  [`AMAZON:VENTAS`, amazonVentasParser],
  [`AMAZON:INVENTARIO`, amazonInvParser],
]);

export function getParser(chain: Chain, fileType: FileType): PortalParser {
  const parser = REGISTRY.get(`${chain}:${fileType}`);
  if (!parser) {
    throw new Error(`No parser for chain=${chain}, fileType=${fileType}`);
  }
  return parser;
}

export function isPortalAvailable(chain: Chain): boolean {
  return [...REGISTRY.keys()].some(k => k.startsWith(`${chain}:`));
}
```

**Drop-in nuevo portal en Fase 2:** crear `core/parsers/heb-ventas.ts` que exporte un `PortalParser` y agregar la línea al `REGISTRY`. Cero cambios en normalizer, API, UI (más allá de habilitar el portal en el selector).

### 3.3 Responsabilidades de cada parser

**Soriana (`core/parsers/soriana.ts`)**
- Input: xlsx single sheet con columnas `Código Tienda, Tienda, Artículo, Mes, Venta (Pesos), Venta (Unidades), Compra (Unidades), Compra (Pesos), Inventario (Actual)`.
- Parsea `Mes` "Ene 2026" → `(2026, 1)`. Map en `core/dates/spanish-months.ts`.
- `Código Tienda` se mantiene como string (preserva `"0001"`).
- Inventario negativo: store raw value, NO clip a 0 (eso es del dashboard).
- Compra fields: emit solo si non-null.
- `fileType = MIXED`.

**Chedraui (`core/parsers/chedraui.ts`)**
- Input: xlsx con `Column1, Tienda, Sku, Month, Inv Fin Uni, Venta Neta en Unidades`.
- Drop `Column1`.
- `Month` "Enero de 2026" → `(2026, 1)`.
- `Tienda` "00100 CHEDRAUI SELECTO MEXICO FORTUNA 03-17" → `storeId = "00100"`, `storeName = full string`.
- `Sku` se mantiene completo (incluye `(3845442)`).
- Solo unidades, sin pesos.
- `fileType = MIXED`.

**Amazon Ventas (`core/parsers/amazon-ventas.ts`)**
- Input: xlsx con `PERIODO, ASIN, Título del Producto, Unidades pedidas`.
- `PERIODO` datetime → `periodYear`, `periodMonth` (day siempre 1).
- `portalRawProduct = ASIN` (clave canónica). Título se descarta (cambia frecuentemente por SEO).
- `storeId = null`, `storeName = null`.
- `salesUnits = Unidades pedidas`. Sin pesos.
- `fileType = VENTAS`.

**Amazon Inventario (`core/parsers/amazon-inv.ts`)**
- Input: xlsx con `PERIODO, ASIN, Título del Producto, Unidades aptas para la venta disponibles, <trailing null col>`.
- Drop columna trailing nula.
- `inventoryUnits = Unidades aptas...`.
- Mismo tratamiento de PERIODO, ASIN, store.
- `fileType = INVENTARIO`.

### 3.4 Reglas comunes
- **Parser NO conoce el catálogo.** Solo emite `portalRawProduct` (el string crudo).
- **Parser NO escribe a la DB.** Solo retorna `ParserResult`.
- **Parser es deterministico** — mismo input siempre produce mismo output (test crítico).
- **Warnings (soft)** se acumulan en `result.warnings`. Errores hard (header inválido, hoja faltante) → throw.
- **Encoding:** xlsx via SheetJS maneja UTF-8 nativamente. CSVs futuros usarán Papaparse con `encoding: 'utf-8'`.

---

## 4. Q3 — Contrato del normalizer

### 4.1 Tipos

```typescript
// core/normalizer/types.ts
import type { ParserResult } from '../parsers/types';

export type MappingLookup = (chain: Chain, portalString: string) => string | null; // productId | null

export type NormalizationInput = {
  clientId: string;
  userId: string;       // denormalizado
  uploadId: string;
  parserResult: ParserResult;
  mappingLookup: MappingLookup;
};

export type NormalizationStats = {
  rowsTotal: number;
  rowsInserted: number;
  rowsUpdated: number;
  rowsUnmapped: number;      // # rows con productId = NULL
  newUnmappedProducts: number; // # distintos portalRawProduct nuevos en UnmappedProduct
  warnings: string[];
};
```

### 4.2 Responsabilidades

1. **Resolver mapping** por cada row del `ParserResult`.
2. **UPSERT en `SelloutData`** con COALESCE per campo (§2.3).
3. **Rastrear unmapped:** si `productId === null`, INSERT/UPDATE `UnmappedProduct` (incrementa `occurrenceCount`).
4. **NO calcular `daysOfInventory` al insert.** El normalizer respeta el valor que provea el parser (caso AL SUPER en Fase 2) y lo pasa tal cual. Si el parser no lo provee, persiste como NULL. El cálculo se hace al query con `CASE WHEN salesUnits > 0 THEN (inventoryUnits::float / salesUnits) * 30 ELSE NULL END`.

   > Esto respeta D4 sin excepciones. Razón: con UPSERT + COALESCE, un upload solo de inventario puede llegar antes que uno de ventas. Si `daysOfInventory` se calculara al insert con `salesUnits=NULL`, quedaría NULL aún después de recibir ventas, porque el UPSERT no recomputa campos derivados. Calcular al query elimina la asimetría.

5. **NO calcular alert** al insert. Alert es 100% derivada de `daysOfInventory` y `inventoryUnits`, y se computa al query (§6.3).
6. **Devolver `NormalizationStats`** para que el handler de upload actualice el `Upload` row.

### 4.3 Pseudocódigo

```typescript
// core/normalizer/index.ts
export async function normalize(input: NormalizationInput, db: PrismaClient): Promise<NormalizationStats> {
  const { clientId, userId, uploadId, parserResult, mappingLookup } = input;
  const stats: NormalizationStats = {
    rowsTotal: parserResult.rows.length,
    rowsInserted: 0,
    rowsUpdated: 0,
    rowsUnmapped: 0,
    newUnmappedProducts: 0,
    warnings: parserResult.warnings.map(w => `r${w.rowIndex}: ${w.message}`),
  };

  await db.$transaction(async (tx) => {
    for (const row of parserResult.rows) {
      const productId = mappingLookup(parserResult.metadata.chain, row.portalRawProduct);
      // daysOfInventory solo se persiste si viene del parser (caso AL SUPER en Fase 2). Para el resto, NULL — se calcula al query.
      const daysInv = row.daysOfInventory ?? null;

      const result = await upsertSelloutRow(tx, {
        clientId, userId, uploadId,
        chain: parserResult.metadata.chain,
        productId,
        ...row,
        daysOfInventory: daysInv,
      });

      if (result.action === 'inserted') stats.rowsInserted++;
      else stats.rowsUpdated++;

      if (productId === null) {
        stats.rowsUnmapped++;
        const upserted = await upsertUnmapped(tx, clientId, parserResult.metadata.chain, row.portalRawProduct, uploadId);
        if (upserted.isNew) stats.newUnmappedProducts++;
      }
    }
  }, { timeout: 30_000 });

  return stats;
}
```

### 4.4 Backfill cuando se resuelve un unmapped

Cuando el usuario mapea un `UnmappedProduct` a un `Product` desde la página Catálogo:

1. INSERT row en `ProductMapping` con `(clientId, chain, portalString, productId)`.
2. UPDATE `SelloutData SET productId = X WHERE clientId = Y AND chain = Z AND portalRawProduct = "..." AND productId IS NULL`.
3. UPDATE `UnmappedProduct SET resolvedAt = NOW(), resolvedProductId = X`.

Esto está en una API route `/api/catalog/resolve-unmapped` que se llama con `{ unmappedId, productId }`. Idempotente.

---

## 5. Q4 — Catálogo onboarding flow

### 5.1 Flujo híbrido (decidido)

**En el modal "+ Agregar Cliente":**
- Campos: Nombre, Email (opcional), file input "Subir catálogo (Excel) — opcional".
- Sub-sección "Portales activos" con checkbox por cadena. Activar expande Collapsible (shadcn) con campos `username` (label dinámico: "Email" para Amazon, "Usuario" para resto) y `password` (descarted backend, microcopy explica).
- Botón "Crear cliente":
  - POST `/api/clients` con todo el payload.
  - Si hay Excel: pasa a `core/catalog/import.ts` para extraer Products + ProductMappings.
  - Si no: cliente queda con catálogo vacío.

**En la página Catálogo:**
- Tabla editable estilo Excel (1 fila por producto × N columnas por cadena).
- Botón "Importar Excel" — merge no-destructivo con el catálogo actual.
- Sección inferior "Productos sin mapear" (de `UnmappedProduct WHERE resolvedAt IS NULL`):
  - Por cada unmapped, dropdown "Mapear a producto existente" + botón "Mapear y backfillear".
  - Botón "+ Agregar como nuevo producto" → crea Product + ProductMapping + backfill.
- Si se detecta conflicto en mapping (mismo `portalString` apuntando a 2 productos), banner: "Conflicto en mapeo de AL SUPER: la string X está mapeada a 2 productos. Resolve."

### 5.2 Formato de Excel importable

**Misma estructura que `catalogo-productos.xlsx` (formato VIKS pivoteado):**

- Sheet: `Catalogo_Producto` (case-sensitive).
- Columna A: `Producto VIKS` (renombrable en Fase 2; en Fase 1 es literal — header debe decir esto).

  > Decisión: Fase 1 acepta header `Producto VIKS` exacto **O** `Producto` exacto. Ambos válidos. Más permisivo que esto requiere autodetect (cortado).

- Columnas B-N: una por cadena. Headers literales: `AL SUPER, AMAZON, CHEDRAUI, HEB, LA COMER, SORIANA, 1 STOP, 7 ELEVEN, CASA LEY, PITS, SUPER NATURISTA, VINOS AMERICA`.
- Sheet `NOTAS` se ignora.
- Celdas vacías = "este producto no se vende en esta cadena". No genera ProductMapping row.
- Headers de cadenas no reconocidos (que no coincidan con el enum `Chain` post-normalización) se ignoran con warning. Esto cubre las 6 columnas "no-Fase-1" sin romper el import.
- Normalización de nombres: `"AL SUPER"` → `AL_SUPER`. `"LA COMER"` → `LA_COMER`. Resto idéntico.

### 5.3 Importer pseudocódigo

```typescript
// core/catalog/import.ts
export type CatalogImportResult = {
  productsCreated: number;
  productsExisting: number;
  mappingsCreated: number;
  mappingsSkippedDuplicate: number;
  warnings: string[];
};

export async function importCatalog(input: {
  clientId: string;
  fileBuffer: Buffer;
}, db: PrismaClient): Promise<CatalogImportResult> {
  // 1. Parse xlsx, validate "Catalogo_Producto" sheet exists
  // 2. Map header row → Chain enum (skip unknown headers with warning)
  // 3. For each data row:
  //    - INSERT Product (clientId, nameStandard) ON CONFLICT DO NOTHING, get productId
  //    - For each (chain, portalString) non-null cell:
  //      - INSERT ProductMapping (...) ON CONFLICT (clientId, chain, portalString) DO NOTHING
  //      - Si ON CONFLICT hit: contar como duplicado, warning
  // 4. Return stats
}
```

---

## 6. Q5 — Seed script + Pre-flight

### 6.1 Seed (`scripts/seed.ts`)

**Estricto: solo data estática. NO corre parsers. NO popula `SelloutData`.**

Pasos:
1. Cargar `.env.local` (DATABASE_URL apunta a Neon).
2. Confirmar entorno: si `process.env.NODE_ENV === 'production'` y no hay flag `--force`, abortar.
3. `TRUNCATE ... CASCADE` sobre todas las tablas: `SelloutData, UnmappedProduct, Upload, ProductMapping, Product, PortalCredential, Client, User`.
4. INSERT demo `User`:
   - `email: "demo@onetable.app"`
   - `passwordHash: bcrypt("demo1234", 10)`
   - `name: "Demo VIKS"`
5. INSERT demo `Client`:
   - `name: "VIKS Jerky Co."`, `userId: demoUser.id`.
6. Importar catálogo: leer `docs/specs/viks-data/catalogo-productos.xlsx`, llamar a `core/catalog/import.ts`. Loguear warnings (esperado: 1 duplicado en AL SUPER por el bug de VIKS).
7. INSERT `PortalCredential` rows para las 6 cadenas (VIKS las usa todas), con `username` dummy ("viks-demo@example.com" para Amazon, "viks-demo" para resto), `hasPasswordPending = true`.
8. Log final: `"Seed completo: 1 user, 1 client, 16 products, N mappings, 6 portal_credentials. SelloutData vacía intencionalmente — subir archivos en /analisis."`.

**Idempotencia:** TRUNCATE + INSERT garantiza que correr el seed N veces deja el estado igual.

**Comando:**
```json
// package.json
{
  "scripts": {
    "db:seed": "tsx scripts/seed.ts",
    "db:reset": "prisma migrate reset --force",
    "preflight": "tsx scripts/preflight.ts"
  },
  "prisma": {
    "seed": "tsx scripts/seed.ts"
  }
}
```

El bloque `prisma.seed` en `package.json` hace que `prisma migrate reset --force` ejecute el seed automáticamente. Llamar a `pnpm db:seed` standalone sigue funcionando para reseeds sin reset de schema.

**Tiempo esperado:** <5 segundos. Si tarda más, hay algo mal con la conexión Neon.

### 6.2 Pre-flight (`scripts/preflight.ts`)

**Propósito:** validar que el flujo end-to-end completo funciona antes del demo en vivo. Corre contra una DB de prueba (idealmente una segunda Neon branch).

Pasos:
1. Setea `DATABASE_URL` a `PREFLIGHT_DATABASE_URL` (env var aparte).
2. `prisma migrate deploy` + `db:seed`.
3. Por cada uno de los 4 archivos del demo (`soriana-sample.xlsx`, `chedraui-sample.xlsx`, `amazon-ventas-sample.xlsx`, `amazon-inv-sample.xlsx`):
   - Leer buffer.
   - Llamar al parser correspondiente.
   - Validar row count esperado (hardcoded por archivo).
   - Llamar al normalizer.
   - Validar `NormalizationStats` (rowsInserted, rowsUnmapped esperados).
4. Query final:
   - Total rows en `SelloutData` debe ser X (esperado).
   - Rows con `productId = null` debe ser Y (esperado: 0 si catálogo de VIKS está completo, ajustar si no).
   - `UnmappedProduct` count debe ser Z.
5. Exit code 0 si todo pasa, 1 + log claro si algo falla.

**Para correr antes del demo:**
```bash
PREFLIGHT_DATABASE_URL="postgresql://..." pnpm preflight
```

### 6.3 Demo flow en vivo (referencia)

1. Login con `demo@onetable.app` / `demo1234` (botón "Probar demo" auto-llena).
2. Dashboard arranca con empty state: "Subí tu primer archivo en Análisis para ver datos."
3. Ir a Análisis → seleccionar `Soriana — Mixto` → subir `soriana-sample.xlsx` → ver resumen.
4. Repetir para `Chedraui — Mixto`, `Amazon — Ventas`, `Amazon — Inventario`.
5. Volver al Dashboard. KPIs vivos. Charts vivos. OneTable poblada.
6. Mostrar Catálogo (ya seeded con 16 productos). Si quedó algún unmapped, mostrar el flujo de mapeo.
7. Mostrar Clientes (lista con VIKS). Click "+ Agregar Cliente" para mostrar el modal funcional sin completarlo.
8. Mostrar Promotoría con coming-soon.

---

## 7. Q6 — Triage Sprint vs Gate

### 7.1 Sprints (TDD self-verifiable; subagentes pueden ejecutar)

| # | Tarea | Verificación | Estim |
|---|---|---|-----|
| S1 | Prisma schema + migration inicial + NULLS NOT DISTINCT manual SQL edit | `prisma migrate dev` + smoke en psql | 1.5h |
| S2 | Parser Soriana (`core/parsers/soriana.ts`) | Vitest contra `soriana-sample.xlsx` → fixture esperada en `tests/fixtures/soriana.json` | 2h |
| S3 | Parser Chedraui | Vitest contra `chedraui-sample.xlsx` | 1.5h |
| S4 | Parser Amazon Ventas | Vitest contra `amazon-ventas-sample.xlsx` | 1h |
| S5 | Parser Amazon Inventario | Vitest contra `amazon-inv-sample.xlsx` | 1h |
| S6 | Catalog Excel importer (`core/catalog/import.ts`) | Vitest contra `catalogo-productos.xlsx` | 2h |
| S7 | Normalizer + UPSERT (raw SQL con COALESCE) + unmapped tracking | Vitest: parser output + mapping lookup → expected SelloutData + UnmappedProduct rows | 4h |
| S8 | KPI calc functions + queries (`core/kpis/`) | Vitest con fixtures sintéticas que cubren bordes (sales=0, todo NULL, mix de cadenas) | 2h |
| S9 | Alert classifier (`core/alerts/classify.ts`) | Vitest case-by-case sobre los 7 estados | 0.5h |
| S10 | Seed script (`scripts/seed.ts`) | Comando + assert row counts vía psql | 1h |
| S11 | Pre-flight (`scripts/preflight.ts`) | Auto-validating; pasa o falla | 1h |
| S12 | API routes (`app/api/*`): clients CRUD, uploads, catalog/import, catalog/resolve-unmapped, dashboard/kpis | Vitest + supertest contra Next.js test server | 3h |

**Subtotal Sprint:** 20.5h. Con subagentes paralelizando S2–S5 → ~16h real.

### 7.2 Gates (revisión humana, vos manualmente)

| # | Tarea | Razón gate | Estim |
|---|---|---|-----|
| G1 | Auth UI: login + sign-up + "Probar demo" + redirects + empty state | Flow visual + JWT cookies en browser | 3h |
| G2 | Layout shell: sidebar, topbar, theme dark + accent | Look & feel | 2h |
| G3 | Landing page: hero, how-it-works, features, CTA | Copywriting + visual | 3h |
| G4 | Dashboard FULL: 4 KPI cards + 5 charts + OneTable + filtros + export + alert badges + banner de unmapped | Polish target (D2) | 9h |
| G5 | Análisis page: file selector (4 opciones), upload progress, summary post-upload, error UI amigable, deshabilitar HEB/AL SUPER/LA COMER con tooltip | UX crítica del demo | 3h |
| G6 | Clientes page: lista + modal "+ Agregar Cliente" con sub-sección portales (checkbox + Collapsible + password microcopy) + import catálogo Excel | Modal complejo | 3h |
| G7 | Catálogo page: tabla editable + import Excel button + unmapped queue + "Mapear y backfillear" + conflict banner | UI compleja | 3h |
| G8 | Promotoría stub: 1 página con hero "Coming Soon" + 3 cards de features futuras + 1 mockup image | Visual | 0.3h |
| G9 | Vercel deploy + smoke en producción: Chrome desktop, Safari desktop, iPhone Safari. Pre-flight final con archivos reales del demo. | Manual cross-browser | 3h |

**Subtotal Gate:** 29.3h.

### 7.2.1 Criterios de aprobación por Gate

Cada gate se considera aprobado **solo** cuando todos los criterios listados se cumplen. Son criterios observables (no estéticos): se verifican en un browser real con DevTools abierto, no por sentimiento.

#### G1 — Auth UI

**Criterios de aprobación (todos deben cumplirse):**
- [ ] Página /login renderiza email + password + botón "Iniciar sesión" + botón secundario "Probar demo" + link "Crear cuenta"
- [ ] Página /signup renderiza email + password + confirm + botón "Crear cuenta" + link "Ya tengo cuenta"
- [ ] Login con `demo@onetable.app` / `demo1234` redirige a /dashboard y crea JWT cookie httpOnly
- [ ] Botón "Probar demo" hace auto-fill + submit, no requiere typing del evaluador
- [ ] Sign-up con credenciales válidas crea User en DB y redirige a /dashboard con estado vacío
- [ ] Sign-up con email duplicado muestra error inline (no toast genérico)
- [ ] Página /dashboard sin sesión redirige a /login
- [ ] Logout limpia cookie y redirige a /login

#### G2 — Layout shell

**Criterios:**
- [ ] Sidebar con 5 items: Dashboard, Análisis, Clientes, Catálogo, Promotoría
- [ ] Item activo visualmente distinguible (no solo color, debe haber al menos 2 cues: bg + border)
- [ ] Topbar con logo OneTable + nombre del usuario + dropdown logout
- [ ] Theme dark + accent color consistente en sidebar, topbar, hover states, focus rings
- [ ] Layout responsive: sidebar colapsa a icon-only en width <1024px
- [ ] En mobile (<768px), sidebar se vuelve drawer con hamburger

#### G3 — Landing page

**Criterios:**
- [ ] Hero con headline + subheadline + CTA primario "Probar demo" + CTA secundario "Crear cuenta"
- [ ] Sección "Cómo funciona" con 3 pasos visuales
- [ ] Sección "Features" con al menos 4 features (consolidación, dashboard, alertas, export)
- [ ] CTA final repetido al pie
- [ ] Render correcto en mobile (<768px): sin overflow horizontal, texto legible sin zoom
- [ ] Tiempo a interactivo <2s en Vercel deploy (verificable con Chrome DevTools Performance)

#### G4 — Dashboard FULL

**Criterios:**
- [ ] 4 KPI cards renderizan con datos reales post-upload (no placeholder)
- [ ] 5 charts renderizan con interactividad básica (hover muestra tooltip con valor exacto)
- [ ] Chart "Tendencia 6 meses" maneja el caso "solo 1 mes" sin verse roto (renderiza el punto único con mensaje contextual)
- [ ] OneTable con paginación 50/page, filtros por cadena/periodo/producto/alerta funcionan, footer muestra count total
- [ ] Export Excel descarga archivo .xlsx con datos filtrados actuales, abrible en Excel sin warnings
- [ ] Export CSV descarga .csv UTF-8 con BOM (compatible con Excel español)
- [ ] Empty state pre-upload renderiza prompt "Subí tu primer archivo en Análisis" con CTA
- [ ] Banner de unmapped products aparece cuando count > 0 con CTA a /catalogo
- [ ] Badge "estimado" visible cuando alguna fila tiene `salesUnitsEstimated = true`

#### G5 — Análisis page

**Criterios:**
- [ ] Selector con 4 opciones habilitadas: Soriana — Mixto, Chedraui — Mixto, Amazon — Ventas, Amazon — Inventario
- [ ] Selector con 6 opciones deshabilitadas con tooltip: HEB / AL SUPER / LA COMER (×2 cada uno)
- [ ] Drag-and-drop visible para upload (no solo botón "Examinar")
- [ ] Click en zona también abre file picker (drag NO es la única vía)
- [ ] Progress visible durante el procesamiento (no solo spinner — texto "Procesando fila X de Y" o barra)
- [ ] Summary post-upload renderiza: total / nuevas / actualizadas / sin mapear, con números reales
- [ ] Error en archivo malformado muestra mensaje user-friendly (NO stack trace), con detalle expandible si el usuario quiere
- [ ] Validación cliente-side: rechazar archivos que no sean .xlsx con mensaje claro
- [ ] Tamaño máximo 10MB enforced cliente-side antes de upload

#### G6 — Clientes page

**Criterios:**
- [ ] Lista de clientes con nombre + email + count de uploads + último upload (fecha)
- [ ] Botón "+ Agregar Cliente" abre modal full-width en mobile, modal centrado en desktop
- [ ] Modal tiene 3 secciones: Datos / Catálogo (opcional) / Credenciales de portales
- [ ] Sección Credenciales: checkbox por portal expande Collapsible con username + password
- [ ] Label dinámico: "Email" para Amazon, "Usuario" para resto
- [ ] Microcopy explícito bajo password: "Se cifrará y almacenará en Fase 2"
- [ ] File input Excel acepta solo .xlsx, valida tamaño <5MB
- [ ] Submit sin Excel crea cliente con catálogo vacío + portal credentials
- [ ] Submit con Excel parsea + valida + reporta warnings antes de cerrar modal
- [ ] Botón editar cliente abre el mismo modal pre-llenado (sin password visible)
- [ ] Botón borrar cliente pide confirmación, cascade-borra data del cliente

#### G7 — Catálogo page

**Criterios:**
- [ ] Tabla con columnas: Producto (`nameStandard`) + 1 columna por cadena con su mapeo string
- [ ] Botón "Importar Excel" abre file picker, hace merge no-destructivo
- [ ] Sección inferior "Productos sin mapear" lista `UnmappedProduct WHERE resolvedAt IS NULL`
- [ ] Por cada unmapped: dropdown "Mapear a producto existente" + botón "Mapear y backfillear"
- [ ] Botón "+ Agregar como nuevo producto" crea Product + ProductMapping + backfill SelloutData
- [ ] Confirmación visual cuando un mapeo se resuelve (toast + row desaparece del unmapped queue)
- [ ] Conflict banner cuando un `portalString` apunta a >1 producto (cubrirá AL SUPER en Fase 2; en F1 no debería verse pero el código existe)

#### G8 — Promotoría stub

**Criterios:**
- [ ] Hero "Próximamente" con título + subtítulo
- [ ] 3 cards de features futuras con icon + título + descripción corta
- [ ] 1 mockup/screenshot de cómo se verá (puede ser placeholder generado, no requiere asset real)
- [ ] Visualmente consistente con el resto del app (dark mode + accent)
- [ ] No tiene CTAs que vayan a páginas no implementadas

#### G9 — Vercel deploy + smoke producción

**Criterios:**
- [ ] Deploy exitoso en https://onetable.vercel.app (o subdominio definitivo)
- [ ] Login con demo user funciona en Chrome desktop (latest)
- [ ] Login con demo user funciona en Safari desktop (latest)
- [ ] Login con demo user funciona en iPhone Safari (iOS 17+)
- [ ] Flow demo §6.3 completo ejecutado sin errores en Chrome
- [ ] No hay errores rojos en console del browser en producción durante el flow
- [ ] Pre-flight script pasa 100% contra DB de prueba minutos antes del demo
- [ ] Network tab: ninguna request 4xx/5xx durante el flow demo
- [ ] Página /catalogo carga en <1s con catálogo de 16 productos en producción

---

## 8. Q7 — Orden + Time budget + Cut priorities

### 8.1 Orden por días

```
Día 1 (dom HOY, 8h efectivas) — Backend Sprint
  → S1 Schema + migrations + NULLS NOT DISTINCT
  → S2, S3, S4, S5 paralelos vía subagentes (parsers)
  → S6 Catalog import
  → S7 Normalizer + UPSERT
  → S10 Seed
  → S11 Pre-flight
  Checkpoint: pre-flight pasa contra DB de prueba.

Día 2 (lun, 12h) — Frontend foundations + Análisis
  → G1 Auth UI
  → G2 Layout shell
  → S12 API routes (en paralelo con G1/G2 vía subagente)
  → G6 Clientes page
  → G7 Catálogo page
  → G5 Análisis page ← CHECKPOINT: end-to-end upload funciona en browser
  → S8 KPI calc + S9 Alerts (si quedaron del día 1)
  Checkpoint: subo 4 archivos en /analisis, dashboard se popula.

Día 3 (mar, 12h) — Dashboard polish + Landing
  → G4 Dashboard FULL (bloque más grande del día)
  → G3 Landing (en paralelo con esperas/iteraciones del dashboard)
  Checkpoint: dashboard listo visualmente, landing publicable.

Día 4 (mié, 8h) — Deploy + buffer
  → G8 Promotoría stub
  → G9 Deploy a Vercel
  → Smoke completo (3 browsers + mobile)
  → Pre-flight final
  → Buffer de bugs + ajustes menores
```

### 8.2 Estimaciones consolidadas

| Bloque | Estimado conservador | Con subagentes |
|---|---|---|
| Sprint (S1–S12) | 20.5h | ~16h |
| Gate (G1–G9) | 29.3h | 29.3h (no paralelizable) |
| **Total** | **~50h** | **~45h** |

**Sobre target de 35h: +10h.** Aceptado por el usuario (Dashboard FULL no se corta de entrada).

### 8.3 Cut priorities (orden de cortar si vamos atrasados)

Punto de decisión: **al final del día 2.** Si Análisis no está funcionando end-to-end, ejecutar Cut 1.

1. **Cut 1 — Dashboard FULL → Trimmed (saves ~3h).**
   Quitar "Top 5 SKUs por cadena (small multiples)" y "Días de inventario por SKU (dot plot)". Quedan: 4 KPI cards, tendencia 6 meses, ventas por cadena, semáforo inventario, OneTable.

2. **Cut 2 — Catálogo in-line editing OUT (saves ~2h).**
   La tabla queda solo-lectura. Únicas mutaciones: "Importar Excel" (re-import merge) + mapear unmapped. Edición de mapeos existentes no se hace en F1.

3. **Cut 3 — Sign-up funcional OUT (saves ~1.5h).**
   Botón "Registrarse" muestra toast "Próximamente, contacta a sales@onetable.app". Demo user es la única vía de entrada. Rompe bullet explícito del Plan V1.

4. **Cut 4 — Landing → Minimal (saves ~1.5h).**
   Solo hero + 3 features blocks + CTA. Sin animaciones, sin testimonials, sin pricing.

**Total max savings:** ~8h, deja el plan en ~37h. Si los 4 cuts no alcanzan, hay un problema mayor que requiere replantear scope.

**NO cortar nunca:** Login + demo user, Dashboard KPI cards core + OneTable + export, Análisis upload (todos los 4 file types), Vercel deploy, pre-flight.

---

## 9. Lógica de KPIs y alertas (D4)

### 9.1 KPIs del Dashboard

**KPI cards (4):**
1. **Ventas MXN (mes activo)** — SUM(`salesAmountMxn`) WHERE periodo = activo. Exclude rows con `salesAmountMxn IS NULL` (Amazon, Chedraui). Tooltip: "Excluye cadenas que no reportan pesos: Amazon, Chedraui."
2. **Variación % vs mes anterior** — `(mesActivo - mesPrevio) / mesPrevio * 100`. Badge color: verde si >0, rojo si <0.
3. **Unidades vendidas (mes activo)** — SUM(`salesUnits`). Incluye estimados de AL SUPER cuando aplique (con badge).
4. **# SKUs con alerta activa** — COUNT(distinct `productId`) WHERE alerta IN (`SIN_STOCK`, `CRITICO`, `RIESGO`) AND periodo = activo.

**Charts (5):**
1. **Tendencia ventas últimos 6 meses por cadena** — line chart Recharts. Eje X: meses; Eje Y: ventas MXN o unidades (toggle). Una línea por cadena. Filtro de cadenas en el toggle. Si una cadena no tiene MXN, switch a "unidades" automático cuando se selecciona.
2. **Ventas por cadena mes activo** — bar chart horizontal. Cadenas ordenadas por venta MXN desc.
3. **Semáforo inventario por SKU** — heatmap o stacked bar. Eje Y: producto. Eje X: cadena. Color: estado de alerta agregado (worst-case por SKU).
4. **Top 5 SKUs por cadena** — small multiples (1 sub-chart por cadena, 5 barras por sub-chart).
5. **Días de inventario por SKU** — dot plot. Eje Y: producto. Eje X: días. Líneas verticales en thresholds (7, 14, 21, 60). Color por estado.

**OneTable:**
- Tabla consolidada con columnas: Cadena, Tienda, Producto (con badge unmapped si aplica), Periodo, Ventas U, Ventas MXN, Inventario U, Días Inv (calculado al vuelo desde `inventoryUnits` y `salesUnits` con la fórmula del semáforo §9.2, salvo para portales que lo provean explícitamente como AL SUPER), Alerta.
- Filtros: cadena (multi-select), periodo (range), producto (search), estado de alerta (multi-select), incluir unmapped (toggle).
- Paginación: 50 rows/page. Total al footer.
- Export: 2 botones — "Excel" y "CSV". Genera el dump filtrado actual con SheetJS client-side. Sin server round-trip.

### 9.2 Cálculo de alerta (al query)

```typescript
// core/alerts/classify.ts
export type AlertStatus =
  | 'SIN_STOCK' | 'CRITICO' | 'RIESGO' | 'ATENCION' | 'OK' | 'EXCESO' | 'SIN_DATOS';

export function classifyAlert(inventoryUnits: number | null, daysOfInventory: number | null): AlertStatus {
  if (inventoryUnits === 0) return 'SIN_STOCK';
  if (daysOfInventory === null) return 'SIN_DATOS';
  if (daysOfInventory < 7) return 'CRITICO';
  if (daysOfInventory < 14) return 'RIESGO';
  if (daysOfInventory < 21) return 'ATENCION';
  if (daysOfInventory <= 60) return 'OK';
  return 'EXCESO';
}
```

Aplicado en la query (Postgres):

```sql
SELECT *,
  CASE
    WHEN "inventoryUnits" = 0 THEN 'SIN_STOCK'
    WHEN "daysOfInventory" IS NULL THEN 'SIN_DATOS'
    WHEN "daysOfInventory" < 7 THEN 'CRITICO'
    WHEN "daysOfInventory" < 14 THEN 'RIESGO'
    WHEN "daysOfInventory" < 21 THEN 'ATENCION'
    WHEN "daysOfInventory" <= 60 THEN 'OK'
    ELSE 'EXCESO'
  END AS alert_status
FROM "SelloutData"
WHERE "clientId" = $1 AND "userId" = $2;
```

**Razón de incluir `userId` en el WHERE:** doble-cinturón. Aunque `clientId` ya garantiza tenant scoping (el cliente pertenece al user logueado), filtrar también por `userId` previene bugs donde un endpoint olvide checkear ownership del client.

---

## 10. Items fuera de scope (notas para Fase 2)

- **Persistir `daysOfInventory` precomputado:** considerar agregar columna calculada (`GENERATED ALWAYS AS`) o materialized view si el query del dashboard pasa de 200ms con datasets reales en Fase 2.
- **HEB, AL SUPER, LA COMER parsers + normalizer.** UI los deshabilita con tooltip "Llegan esta semana".
- **La Comer "milésimas":** validar empíricamente vs cliente real cuando se implemente el parser.
- **Catálogo VIKS duplicate fix:** AL SUPER duplicado expuesto en UI con conflict banner.
- **Storage real de passwords de portales:** integración con AWS KMS o equivalente. Mientras tanto, `PortalCredential.hasPasswordPending` documenta el estado.
- **Fuzzy matching de SKUs con embeddings.** Por ahora solo string-literal match.
- **Materialized views para KPIs** si performance se degrada con >100k rows por cliente.
- **Tabla `Agency`** si aparece la necesidad de teams (multi-user por agencia).
- **Tabla `AlertThreshold` por cliente** para configurar umbrales fuera de los defaults.
- **Email verification en sign-up.**
- **Auditoría/logging serio** (Sentry, structured logs).
- **WCAG AA compliance.**
- **Tests E2E (Playwright)** del flujo demo completo.
- **Branch protection re-enabled en GitHub** después del demo. ADR-001 documenta la decisión consciente.

---

## 11. Definición de "demo ready"

Checklist obligatoria antes del lunes de ANTAD:

- [ ] `pnpm db:seed` corre sin error contra Neon producción, en <5s.
- [ ] `pnpm preflight` pasa 100% contra DB de prueba.
- [ ] Deploy vivo en `https://onetable.vercel.app` (o subdominio real).
- [ ] Login con `demo@onetable.app` / `demo1234` entra correctamente.
- [ ] Demo flow §6.3 ejecutado end-to-end sin errores rojos en Chrome, Safari y iPhone Safari.
- [ ] Empty state del dashboard se ve bien (no se ve "roto").
- [ ] Dashboard FULL (o Trimmed si cortamos) se ve polished — esto es D2.
- [ ] Export Excel descarga un archivo abrible sin errores en Excel/Numbers.
- [ ] Promotoría coming-soon publicada.
- [ ] Landing publicada.
- [ ] `pnpm build` local pasa sin warnings de TypeScript.
- [ ] `pnpm test` corre todos los parsers sin fallos.
- [ ] No hay errores en console del browser en producción.

---

## 12. Glossary

- **Sprint** — tarea TDD self-verifiable, ejecutable por subagente sin review visual.
- **Gate** — tarea que requiere mi review humano (UX, visual, browser smoke).
- **Pre-flight** — script que ejecuta el flujo demo completo contra DB de prueba antes de la presentación.
- **Unmapped product** — `portalRawProduct` que aparece en un upload sin entry correspondiente en `ProductMapping`. Se trackea en `UnmappedProduct`. La fila de `SelloutData` se guarda con `productId = NULL` (no se rechaza el upload).
- **Portal "Próximamente"** — chain del enum que existe en DB pero cuyo parser no está implementado en F1. UI deshabilita el selector con tooltip.

---

*Fin del spec. Listo para handoff a `/superpowers:writing-plans`.*
