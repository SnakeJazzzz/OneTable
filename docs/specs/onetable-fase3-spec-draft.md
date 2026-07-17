# OneTable — Spec Fase 3 (DRAFT)

> Documento de trabajo. Contiene piezas de diseño cerradas durante el review de Fase 2 que
> NO se implementan en Fase 2 pero que vale la pena dejar congeladas para no re-discutirlas
> en el futuro. Esta spec se expandirá cuando arranque el brainstorming formal de Fase 3.

---

## 0. Premisa

Fase 3 = **automatización del onboarding de datos**. Donde Fase 2 deja al usuario subiendo
archivos a mano por portal, Fase 3 automatiza la ingesta vía scrapers. Eso obliga a guardar
credenciales reales (no solo `username`) y a tratarlas con disciplina criptográfica.

Fuera de esa premisa, Fase 3 también va a incluir:
- Migración de marca múltiple si la tracción de Fase 2 lo justifica (levantar la regla
  "1 Client por cuenta").
- Build del modelo de forecasting (heredado del diseño en
  `docs/archive/fase2/onetable-fase2-spec.md §9.2`) cuando las series acumulen ≥ 3 meses.
- Posible upgrade de gestión de claves a KMS si el volumen de clientes lo justifica.

---

## 1. Cifrado de credenciales de portal — AES-256-GCM

### 1.1 Premisa de la decisión

- Activada por Fase 3: el scraper necesita el password real del portal para autenticarse.
- Cero dependencias nuevas: `crypto` nativo de Node. AES-GCM es authenticated encryption
  (detección de tampering gratis). Cargar `libsodium` u otra librería agregaría una
  dependencia con install scripts — contra el protocolo de supply chain (Mini Shai-Hulud).

### 1.2 Gestión de la master key

- Master key en env var de Vercel: `CREDENTIAL_ENCRYPTION_KEY`, scope Production,
  generada con `openssl rand -base64 32` (256 bits).
- **NO reusar `AUTH_SECRET`.** Reusar acopla dos rotaciones que tienen lifecycles distintos.

### 1.3 Esquema por credencial

- IV aleatorio (12 bytes) por encryption op.
- Guardar en DB: `ciphertext` + `iv` + `authTag` + `keyVersion` (`"v1"` al arranque).
- La columna `keyVersion` deja la puerta abierta a rotación manual sin migración dolorosa
  cuando se renueve la master key. **NO construir rotación automática** — sobre-ingeniería
  a esta escala.

### 1.4 Disciplina operacional

- **Plaintext: cifrar en el borde de la API apenas entra.** Antes de DB, antes de logs.
- **El parser nunca toca credenciales.** Son dos subsystems separados.
- **El GET de credencial nunca devuelve el password.** Solo el booleano "seteado/no".
- **Decrypt solo en el punto de uso** (scraper), en memoria, jamás a un log.

### 1.5 Modelo de amenaza explícito

- **Qué protege:** una fuga *solo de DB* no expone credenciales. El atacante necesita
  también el app-server (donde vive la key en memoria).
- **Qué NO protege:** un compromiso del app-server. Quien ejecute código en Vercel tiene
  la key.
- **Por qué es el nivel correcto:** a < 10 clientes y pre-revenue. Si la tracción justifica
  un upgrade a KMS (AWS KMS / Vercel-managed secrets), se hace; hasta entonces, AES-GCM con
  env var es la relación costo/beneficio correcta.

---

## 2. Cambios de schema asociados

Al arrancar Fase 3 se agregan a `PortalCredential`:
- `passwordCiphertext String?` — base64 del ciphertext.
- `passwordIv String?` — base64 del IV.
- `passwordAuthTag String?` — base64 del auth tag.
- `keyVersion String?` — versión de la master key usada para cifrar.

Todas nullable hasta que el usuario active el scraping y provea el password real. La
columna `hasPasswordPending` que viene de Fase 1/2 se conserva como flag de UX.

---

## 3. Pendientes a definir en brainstorming Fase 3

- Política de rotación manual de master key (cuándo, quién, runbook).
- UX de "activar scraping" en Portales: cuándo se le pide al usuario el password real.
- Aislamiento por tenant de las credenciales si la regla "1 Client por cuenta" se levanta.
- Frecuencia de scraping (diario / semanal / por demanda).
- Manejo de fallos de auth: ¿quién se entera, por qué canal?
- Selector de KMS vs env var como decisión de migración (cuándo justifica el upgrade).

---

## 4. Heredado del review Fase 2

Las siguientes decisiones de Fase 2 quedaron diseñadas pero con build deferido a Fase 3 o
posterior, y deben revisarse cuando este draft pase a brainstorming:

- **Forecasting (`docs/archive/fase2/onetable-fase2-spec.md §9.2`):** diseño congelado (gate en query,
  discriminated union forecast|insufficient, baseline MA-3, gate por
  cliente × producto × cadena ≥ 3 meses). Build cuando alguna serie acumule la profundidad.
  Probablemente Fase 2.5; si llega tarde, cae en Fase 3.

- **Multi-marca por cuenta:** Fase 2 fuerza 1 Client por cuenta en la capa de app
  (sin constraint de schema). El mecanismo real (verificado 2026-07-17): el `clientId`
  viaja en el JWT de sesión y `requireAuth()` (`lib/auth-helpers.ts`) lo extrae; ningún
  endpoint acepta clientId del request. Habilitar multi-marca = poner la selección de
  Client en la sesión (UI de selector + claim en el JWT) en vez del 1-a-1 fijado al login.
  Sin migración de data. Decidir en Fase 3 si se prioriza.

- **Bulk-assign mapeos a escala (mapeo manual de Chedraui):** anotado en Fase 2 §5 como
  concern. Si en Fase 3 hay clientes de ≥ 50 SKUs, construir una herramienta de
  multi-select + assign by substring.
