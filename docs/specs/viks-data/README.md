# VIKS Jerky — Sample Data Documentation

> Source of truth for how each retail portal delivers data to the client.
> This document drives the design of `core/parsers/` and `core/normalizer/`.
> All examples here come from real VIKS Jerky Co. data.

---

## Folder contents

| File | Purpose |
|---|---|
| `README.md` | This file — portal-by-portal documentation |
| `catalogo-productos.xlsx` | Original SKU mapping by VIKS (manually maintained) |
| `sellout-maestro-vix.xlsm` | Full reference: VIKS's existing Power Query consolidation in Excel |
| `samples/` | One xlsx per portal, replicating the raw download format |

## How VIKS works today (the manual process we automate)

1. Login to each portal monthly
2. Navigate menus, generate report, download to local machine
3. Open `SellOut_Maestro.xlsm` (the file in this folder)
4. Paste each portal's raw data into its corresponding `Base_<PORTAL>` sheet
5. Power Query consolidates everything into the `SellOut_Total` sheet
6. Manual SKU mapping is maintained in `catalogo-productos.xlsx`

OneTable replaces steps 3-5 (and eventually 1-2 in Phase 3 with scrapers).
**In v1 the client uploads the raw portal file via the Análisis page; the
parser does the rest.**

---

## Portal capability matrix

What each portal delivers natively. `❌` means the metric is not available
from that portal's export; `(calc)` means we can derive it.

| Field | SORIANA | CHEDRAUI | HEB | AL SUPER | LA COMER | AMAZON |
|---|---|---|---|---|---|---|
| Sales units | ✅ | ✅ | ✅ | ❌ (estimable) | ✅ | ✅ |
| Sales MXN | ✅ | ❌ | ✅ | ❌ | ✅ | ❌ |
| Purchases units | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Purchases MXN | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |
| Inventory units | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| Inventory MXN (cost) | ❌ | ❌ | ✅ | ❌ | ✅ | ❌ |
| Inventory MXN (price) | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ |
| Days of inventory | (calc) | (calc) | (calc) | ✅ given | (calc) | (calc) |
| Store dimension | ✅ | ✅ | ✅ | ✅ | ✅ (formato+sucursal) | ❌ (no stores) |
| Period granularity | month | month | month | day-snapshot | month | month |

**Implication for OneTable's schema:** every metric column is nullable.
The unified table holds whatever each portal provides; the dashboard
gracefully handles missing values.

---

## 1. SORIANA — `soriana-sample.xlsx`

**The richest portal.** Sales, purchases, inventory — all in one file.

### Source

Portal Soriana → Comercial → Indicadores Comerciales → Export Data.

### Headers (exact)

| Column | Type | Example |
|---|---|---|
| `Código Tienda` | string (4-digit) | `"0001"` |
| `Tienda` | string | `"SANTO DOMINGO"` |
| `Artículo` | string (portal product name) | `"BEEFJERKY - CHILLI LIME 86 GR VIK'S 86"` |
| `Mes` | string (3-letter Spanish month + year) | `"Ene 2026"`, `"Feb 2026"`, `"Mar 2026"` |
| `Venta (Pesos)` | decimal | `406.93` |
| `Venta (Unidades)` | int | `3` |
| `Compra (Unidades)` | int / null | `null` (often) |
| `Compra (Pesos)` | decimal / null | `null` (often) |
| `Inventario (Actual)` | int (can be negative!) | `8` |

### Parser notes

- **Mes parsing:** Spanish month abbreviation. Map `Ene→1, Feb→2, Mar→3, Abr→4, May→5, Jun→6, Jul→7, Ago→8, Sep→9, Oct→10, Nov→11, Dic→12`.
- **Inventory can be negative.** Treat as `0` for display, but **store the raw value** so we can flag it.
- **Compra columns are often null.** That's normal — only retain when present.
- **Código Tienda is a string, not int** (leading zeros: `"0001"` not `1`).

### Particularidades

- The richest data quality of all portals. Use it as the gold standard for the demo dashboard.
- Multiple rows per (store, product, month) **should not occur** — if they do, sum them and log a warning.

---

## 2. CHEDRAUI — `chedraui-sample.xlsx`

**Sales + inventory, unit-only (no pesos).**

### Source

Chedraui Link → Administrador Empresarial → `TiendaSKU_InventarioVentaMejor` report.

### Headers (exact)

| Column | Type | Example |
|---|---|---|
| `Column1` | int (garbage row index) | `1, 2, 3, ...` |
| `Tienda` | string (composite: ID + format + location + suffix) | `"00100 CHEDRAUI SELECTO MEXICO FORTUNA 03-17"` |
| `Sku` | string (portal product name w/ internal code) | `"Carne Seca Vik s Jerky Co Res Hab 86 gr (3845442)"` |
| `Month` | string (full Spanish month + year) | `"Enero de 2026"` |
| `Inv Fin Uni` | int | `14` |
| `Venta Neta en Unidades` | int | `2` |

### Parser notes

- **Drop `Column1` entirely.** It's a row index from the portal's UI, not real data.
- **Month parsing:** full Spanish month + " de " + year. `"Enero de 2026"` → `(2026, 1)`. Map `Enero→1 ... Diciembre→12`.
- **Tienda is composite.** Format: `<5-digit store ID> <chain format> <location parts>`. Example: `"00100"` is the store ID, `"CHEDRAUI SELECTO"` is the format, `"MEXICO FORTUNA 03-17"` is the location/suffix.
  - **Extract store_id:** first 5 characters (digits).
  - **Keep full string** as `store_name` for display.
- **SKU encoding quirk:** "Vik s" appears without apostrophe (was "Vik's" originally, portal stripped it). The mapping table in `catalogo-productos.xlsx` already has the literal portal string.
- **SKU has internal code in parentheses** at the end: `(3845442)`. Keep it — it's stable across months.

### Particularidades

- No sales in MXN. Only units.
- All amounts are integers (no decimals).

---

## 3. HEB — `heb-ventas-sample.xlsx` + `heb-inv-sample.xlsx`

**Sales and inventory come as two separate downloads.** Must be joined on `(ID_TIENDA, ARTICULO, year, month)`.

### Source

Portal HEB → Business Info → two separate reports.

### Headers — Ventas (`heb-ventas-sample.xlsx`)

| Column | Type | Example |
|---|---|---|
| `AÑO` | int | `2026` |
| `MES_NOMBRE` | string (full Spanish month) | `"Febrero"`, `"Marzo"` |
| `ID_TIENDA` | int | `2936` |
| `TIENDA` | string (composite: ID + name) | `"2936 HEB TAM MADERO"` |
| `ARTICULO` | string (portal product name w/ leading code) | `"00787155 VIK'S JERKY CARNE SECA   SAL DE MAR"` |
| `VENTAS_PESOS` | int (yes, integer pesos here) | `1450` |
| `VENTAS` | int (units) | `10` |

### Headers — Inventario (`heb-inv-sample.xlsx`)

| Column | Type | Example |
|---|---|---|
| `Fecha` | datetime | `2026-03-01 00:00:00` |
| `Tienda` | int (store ID) | `2160` |
| `ID_Tienda` | string (composite: ID + name) | `"2160 Cat Monterrey"` |
| `Articulo` | string (portal product name w/ leading code) | `"00787154 VIK'S JERKY CARNE SECA   CITRUS GINGER HABANERO"` |
| `Inventario` | int | `0`, `5`, etc. |
| `Inventario a Costo` | decimal | `0`, etc. |
| `Inventario a Precio` | decimal | `0`, etc. |

### Parser notes

- **`MES_NOMBRE` parsing (ventas):** Spanish month name. Map `Enero→1 ... Diciembre→12`.
- **`Fecha` (inventario):** snapshot date. Extract year and month.
- **Tienda is composite in both files, but encoded differently:**
  - Ventas: `TIENDA = "2936 HEB TAM MADERO"` → 4-digit ID + space + name
  - Inv: `ID_Tienda = "2160 Cat Monterrey"` → 4-digit ID + space + name
  - **In both cases:** the first 4 chars (digits) are the store_id. Strip the leading `"<digits> "` (4 digits + 1 space = 5 chars) to get the clean store name.
- **ARTICULO has a leading product code:** `"00787155 VIK'S JERKY ..."`. The 8-digit prefix is the SKU code at HEB. **Keep the full string for mapping** — `catalogo-productos.xlsx` has it verbatim with the code.
- **Note the apostrophe:** HEB uses real ASCII apostrophe `'` (not Unicode). Other portals strip it. SKU matching must handle this.
- **Multiple internal spaces in ARTICULO** (e.g. `"CARNE SECA   SAL DE MAR"` with 3 spaces). Preserve them — they're part of the mapping key.

### Particularidades

- **Joining ventas + inv:** match on `(ID_TIENDA, ARTICULO, year, month)`. The mapping is: a sales row for "Febrero 2026" in store 2936 should join with an inventory snapshot dated `2026-02-01` or end of February.
  - **Open question for brainstorming:** which date to use for inventory? End of month is most common; HEB's snapshot date convention should be clarified with the client.
- **Inventario a Costo / Precio:** unique to HEB. Store in `inventory_amount_cost_mxn` / `inventory_amount_price_mxn`.
- **Inventario is often 0.** That's real (out of stock), not an error.

---

## 4. AL SUPER — `al-super-sample.xlsx`

**Inventory-only.** No sales data. Sales must be **estimated** from inventory + days-of-inventory.

### Source

Portal Al Super → Existencias → Exportar.

### Headers (exact)

| Column | Type | Example |
|---|---|---|
| `Sucursal` | int (store ID) | `53` |
| `Nombre Sucursal` | string | `"Alsuper Maravillas"` |
| `Artículo` | int (internal article code) | `442722` |
| `Código` | int (EAN / barcode) | `7500326673092` |
| `Nombre Artículo` | string (portal product name) | `"(T)CARNE SECA MACHACA  NATURAL VIKS JERKY 100 GRAMOS"` |
| `Existencias` | int | `22` |
| `Días Inventario` | int | `1000` |
| `Tecla` | int (always `51`) | `51` |
| `Fecha Inventario` | string (`dd/mm/yyyy`) | `"05/11/2025"` |

### Parser notes

- **`Fecha Inventario` is a STRING, not a date.** Format: `dd/mm/yyyy`. Parse manually.
- **`Días Inventario = 1000` is a sentinel** meaning "no rotation" (product hasn't sold in ages). Treat as `null` for analytics; flag the row as `'EXCESO'` alert.
- **Sales estimation formula:** when `Días Inventario` is valid (`< 1000`), estimate monthly sales as:
  ```
  estimated_sales_units = round((Existencias / Días Inventario) * 30)
  ```
  Store this in `sales_units` and **mark it as estimated** (need a column for that, or rely on `chain='AL SUPER'` as the signal).
- **`Tecla` column is meaningless** for OneTable. It's always `51`. Drop.
- **`Nombre Artículo` has double spaces** (e.g. `"CARNE SECA MACHACA  NATURAL"`). Preserve for mapping (catalog uses literal strings).
- **`Código` is the EAN barcode.** Stable. Can be used as a secondary key when product names mutate.

### Particularidades

- **The only portal that gives `Días Inventario` directly.** Trust it.
- **The only portal with daily snapshot granularity** (not monthly). For OneTable, derive `period_year` and `period_month` from `Fecha Inventario`, but store the exact date too.
- **No sales data at all** — this is a serious limitation for AL SUPER comparisons in the dashboard. Communicate this clearly to the user in the UI ("AL SUPER: sales estimated from inventory rotation").

---

## 5. LA COMER — `lacomer-ventas-sample.xlsx` + `lacomer-inv-sample.xlsx`

**The most complex portal.** Two-step download process (schedule day 1, retrieve day 2 — only relevant for scrapers in Phase 3). For v1 (manual upload), the user uploads both CSVs.

### Source

Portal La Comer → Descarga de info → Programación → Ventas + Inventario (two separate files).

### Headers — Ventas (`lacomer-ventas-sample.xlsx`)

| Column | Type | Example |
|---|---|---|
| `tipo` | string (always `"VENT"`) | `"VENT"` |
| `fecha` | int (YYYYMM) | `202601` |
| `formato` | int (chain format code) | `1`, `2`, `3` |
| `sucursal` | int (store ID) | `317` |
| `articulo` | int (EAN barcode) | `7500326673078` |
| `cantidad_ventas` | int | `17` |
| `importe_ventas` | decimal (MXN) | `2227.5` |
| (columns 8-14) | empty | `null` |

### Headers — Inventario (`lacomer-inv-sample.xlsx`)

| Column | Type | Example |
|---|---|---|
| `tipo` | string (always `"INVE"`) | `"INVE"` |
| `fecha` | int (YYYYMM) | `202601` |
| `formato` | int | `3` |
| `sucursal` | int | `407` |
| `articulo` | int (EAN) | `7500326673061` |
| `inve_cant` | decimal (**in thousandths!**) | `9` (means 9 units) — see below |
| `inve_imp` | decimal | `1215` |

### Parser notes

- **`fecha` is YYYYMM as an int.** Parse: `period_year = fecha // 100`, `period_month = fecha % 100`.
- **`articulo` is the EAN barcode.** Must be matched against the catalog by EAN, not by product name.
- **`inve_cant` is in milésimas (thousandths) per the SRS** — but in the sample data the values look like raw units (`9`, `8`, `31`). **VERIFY WITH CLIENT** during brainstorming whether the data in this file is already converted or still in milésimas.
- **Ventas file has 7 trailing null columns** (cols 8-14). Likely garbage from the export. Drop.
- **`formato` distinguishes La Comer's brands:** `1=La Comer`, `2=City Market`, `3=Fresko`, etc. **Confirm exact mapping with client.** For now, concatenate `formato + sucursal` as store_id or treat as two-level dimension.
- **No store name.** Only IDs. The catalog of store_id → store_name lives outside the file. **Open question:** does VIKS have this mapping? If not, store_name stays null and we show just the ID.
- **Ventas and inventory files share the same `(formato, sucursal, articulo, fecha)` key.** Join in the normalizer.

### Particularidades

- The "two files for the same period" pattern is unique to LA COMER among our portals. The Análisis page UI must handle "ventas e inventario por separado" (the toggle the SRS mentions).
- **`tipo` column is redundant** within each file (always `"VENT"` or `"INVE"`) but useful as a sanity check: if a row in `lacomer-ventas-sample.xlsx` has `tipo != "VENT"`, something is wrong.

---

## 6. AMAZON — `amazon-ventas-sample.xlsx` + `amazon-inv-sample.xlsx`

**Two separate files. No store dimension** — Amazon ships from FBA, the supplier doesn't see per-store data.

### Source

Amazon Vendor Central. Currently downloaded manually; in Phase 3 we replace this with the official SP-API (no scraping needed).

### Headers — Ventas (`amazon-ventas-sample.xlsx`)

| Column | Type | Example |
|---|---|---|
| `PERIODO` | datetime | `2026-01-01 00:00:00` |
| `ASIN` | string (Amazon SKU) | `"B0D22Y7LZR"` |
| `Título del Producto` | string (full marketing title) | `"Carne Seca 100% de Res Sabor Chilli Lime 86g \| Snack Saludable..."` |
| `Unidades pedidas` | int | `346` |

### Headers — Inventario (`amazon-inv-sample.xlsx`)

| Column | Type | Example |
|---|---|---|
| `PERIODO` | datetime | `2026-01-01 00:00:00` |
| `ASIN` | string | `"B0D22Y7LZR"` |
| `Título del Producto` | string | full marketing title |
| `Unidades aptas para la venta disponibles` | int | `338` |
| (col 5) | empty trailing column | `null` |

### Parser notes

- **`PERIODO` is a datetime but represents a month.** Extract year and month from the date (day is always `1`).
- **`ASIN` is the canonical key.** The catalog already maps ASIN → standard product name. Use ASIN, ignore `Título del Producto` for mapping (titles change frequently for SEO).
- **No store dimension.** Set `store_id = null`, `store_name = null` in the unified schema.
- **Trailing null column in inventory file:** drop.
- **Marketing titles are very long** (`200+ chars`). Don't display them raw — use the catalog-mapped standard name for the dashboard.

### Particularidades

- **No sales in MXN, no inventory in MXN.** Only units. (Amazon Vendor Central does report POs in MXN but in different reports we're not pulling.)
- This is the lowest-volume portal in our sample (only 9 rows in each file). For VIKS specifically, AMAZON is a smaller channel.

---

## SKU Mapping — `catalogo-productos.xlsx`

The single source of truth for product name normalization. Maintained manually by VIKS today.

### Structure (Sheet: `Catalogo_Producto`)

| Column | Purpose |
|---|---|
| `Producto VIKS` | **Standard name** — the display name in OneTable's dashboard |
| `AL SUPER` | Exact string as it appears in `Nombre Artículo` from AL SUPER export |
| `AMAZON` | The ASIN |
| `CHEDRAUI` | Exact string as it appears in `Sku` column (with internal code in parens) |
| `HEB` | Exact string as it appears in `ARTICULO` (with leading 8-digit code) |
| `LA COMER` | The EAN barcode (`articulo` column from La Comer) |
| `SORIANA` | Exact string from `Artículo` in Soriana export |
| `1 STOP`, `7 ELEVEN`, `CASA LEY`, `PITS`, `SUPER NATURISTA`, `VINOS AMERICA` | Other chains (not in scope for v1) |

### Known issues to flag during brainstorming

1. **Possible duplicate mapping in AL SUPER column:**
   The current catalog has `(T)CARNE SECA TROZO CITRUS GINGER VIKS JERKY 100 GRAMOS` mapped to **both** "Chilli Lime 100g" and "Habanero 100g". This is almost certainly a data entry error — one VIKS product cannot map to the same portal string in two ways. **Verify with VIKS before seeding** which one is correct.

2. **Empty cells = product not sold at that chain.** Per `NOTAS` sheet in the original catalog: `"Si una cadena no vende ese SKU, deja la celda vacía."` So `null` in the mapping table means "this chain does not carry this product" — not "not yet mapped".

3. **Apostrophe variations:**
   - HEB uses `'` (ASCII apostrophe): `"VIK'S JERKY"`
   - Some chains strip the apostrophe: `"Vik s"` (CHEDRAUI)
   - Catalog is verbatim — handles both via separate columns.

4. **Whitespace variations:** Several entries have double spaces (`"CARNE SECA MACHACA  NATURAL"`). Preserve verbatim — they're part of the literal match key.

### Onboarding flow for new clients

When a new client signs up, the agency must build this catalog. The Análisis page should:
- Allow upload of an Excel matching this structure
- Surface unmapped SKUs after each file ingest ("Found 3 products in your CHEDRAUI file that aren't in your catalog — map them now?")
- Allow manual editing of any cell

**For the demo:** seed the VIKS catalog as-is.

---

## Unified output schema

The target shape that all parsers feed into. Each row represents one
(client, chain, store, product, period) combination.

```
sellout_data
─────────────────────────────────────────────────────────────────
  -- Identity
  client_id            FK
  upload_id            FK (which file this came from)
  
  -- Period (always present)
  period_year          int
  period_month         int
  period_date          date          NULL (only for daily snapshots like AL SUPER)
  
  -- Dimensions (always present)
  chain                text          'SORIANA' | 'CHEDRAUI' | 'HEB' | 'AL_SUPER' | 'LA_COMER' | 'AMAZON'
  product_standard     text          (post-catalog mapping)
  portal_raw_product   text          (original string from the portal, for debug)
  
  -- Store (NULL for AMAZON)
  store_id             text          NULL
  store_name           text          NULL
  store_format         text          NULL (LA COMER's formato dimension)
  
  -- Metrics (NULLABLE — populated only when portal provides)
  sales_units          int           NULL
  sales_units_estimated boolean      DEFAULT false   (true for AL SUPER)
  sales_amount_mxn     decimal(12,2) NULL
  
  purchases_units      int           NULL
  purchases_amount_mxn decimal(12,2) NULL
  
  inventory_units      int           NULL
  inventory_amount_cost_mxn   decimal(12,2) NULL
  inventory_amount_price_mxn  decimal(12,2) NULL
  days_of_inventory    int           NULL  (given or calculated)
  
  -- Derived (computed post-ingest)
  alert_status         text          NULL  'SIN_STOCK'|'OK'|'ATENCION'|'RIESGO'|'CRITICO'|'EXCESO'
  
  -- Metadata
  created_at           timestamptz
```

### Open design questions for brainstorming

1. **Multiple measurements per cell?** Can `(client, chain, store_id, product_standard, period_year, period_month)` have more than one row? (E.g. if the user re-uploads the same file). Best practice: enforce uniqueness with `ON CONFLICT UPDATE`.

2. **Sales estimation provenance.** Do we want a separate `sales_units_source` column (`'reported' | 'estimated_from_days_inv'`) instead of a boolean?

3. **Currency.** Everything is MXN today. Document it. Future-proof for USD (Amazon US) later.

4. **Days of inventory normalization.** If portal gives it (AL SUPER), use that. If portal gives inventory + we have sales for that period, calculate: `days = (inventory / sales) * 30`. If no sales → `NULL`. Document this in the normalizer.

5. **Alert thresholds.** What ranges define ATENCION vs RIESGO vs CRITICO? Need product spec from VIKS.

---

## What to ignore in the original SRS

The SRS (`docs/specs/onetable-srs-v1.docx`) describes:
- Playwright scrapers, Celery, Redis, etc. — **Phase 3+**, ignore for v1
- Encrypted credential storage — **Phase 2**, store as dummy field in v1
- Anti-detection strategy — **Phase 3**, irrelevant for v1
- AWS Fargate, Bright Data proxies — **Phase 3-4**, ignore

What still applies from the SRS:
- The list of portals and their characteristics
- The data normalization concept
- The alert types
- The unified schema (this README's version supersedes it)
- The pricing model and market sizing (product context)
