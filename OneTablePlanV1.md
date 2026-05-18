# OneTable — Plan V1

> Brief para brainstorming con Superpowers. Este documento define alcance,
> contexto, restricciones y preguntas abiertas. Las decisiones finales de
> implementación salen del brainstorming, no de este archivo.

---

## Producto

**OneTable** es una plataforma SaaS B2B para proveedores de retail en México.
Consolida datos de ventas (sell-out) e inventario de los portales web de cada
cadena (Soriana, Chedraui, HEB, Al Super, La Comer, Amazon, ect..) en una sola tabla
unificada y un dashboard accionable.

**Naming:** el proyecto se llamaba "Scopium" en el SRS original
(`docs/specs/scopium-srs-v1.docx`). El nombre oficial es **OneTable**. Todas
las referencias a Scopium en docs antiguos se ignoran.

## Problema

Un proveedor PyME en México que vende en 5-6 cadenas debe:
1. Entrar manualmente al portal de cada cadena cada mes
2. Navegar menús distintos, generar reportes distintos, descargar formatos distintos
3. Limpiar y consolidar todo en Excel a mano
4. Tomar decisiones de reposición, producción y negociación con datos
   fragmentados, atrasados y a veces incorrectos

El resultado: la mayoría de proveedores opera a ciegas. OneTable les da
visibilidad real, unificada y actualizada de su sell-out en punto de venta.

## Mercado objetivo

- Proveedores PyME de productos de consumo en México
- 5-50 SKUs activos
- Presencia en 3-10+ cadenas
- Facturación $5M-$100M MXN anuales
- Sin departamento de datos ni TI dedicado

Primer cliente real: **VIKS Jerky Co.** Datos reales en `docs/specs/viks-data/`.

## Visión por fases

**Fase 1 — Demo ANTAD (esta semana, 3-4 días).**
Lo que estamos construyendo ahora. Detalle abajo.

**Fase 2 — Beta con VIKS (1-2 meses).**
VIKS opera con OneTable como sistema principal. Se delega manualmente la
descarga de portales (el cliente sube los archivos). El equipo refina UX,
catálogo de SKUs, alertas, exports a CRM.

**Fase 3 — Automatización por scrapers (3-6 meses).**
Se monta un backend separado (probable: Python + FastAPI + Playwright en
Railway o Fargate) que descarga automáticamente los portales por el cliente.
El frontend actual sigue igual, solo cambia la fuente de los datos.

**Fase 4 — APIs directas con cadenas (6-12 meses).**
Con tracción demostrable, negociar integración via API oficial con las
cadenas grandes (Soriana, Chedraui). Esto reemplaza scrapers donde se logre.

**Fase 5 — Promotoría y servicios adicionales (12+ meses).**
Módulos de auditoría en tienda, conexión a CRM, alertas inteligentes,
recomendaciones de reposición.

## Alcance específico — Fase 1 (Demo ANTAD)

### Páginas y funcionalidad

1. **Landing page**
   - Hero que explica el producto y el dolor que resuelve
   - Sección de cómo funciona
   - Sección de features
   - CTA a registro/login
   - Debe verse production-grade, no template

2. **Auth**
   - Registro de cuentas nuevas (funcional)
   - Login
   - Un usuario demo destacado en login con la data de VIKS pre-cargada
   - Cuentas nuevas arrancan vacías
   - NextAuth v5 con JWT (no sessions en DB para simplicidad)

3. **Dashboard (página de inicio del usuario logueado)**
   - KPIs principales: ventas totales, variación %, alertas activas, etc.
   - Gráficas interactivas: tendencia de ventas, ventas por cadena,
     top SKUs, semáforo de inventario, días de inventario por SKU
   - OneTable debajo: tabla consolidada con filtros, paginación,
     export a Excel y CSV
   - Botón "conectar a CRM (próximamente)"
   - **Visualmente debe superar la calidad de los dashboards de las
     cadenas mismas.** Este es el "hook" para vender en ANTAD.

4. **Página Clientes**
   - Lista de clientes del usuario (el usuario es la agencia/consultor)
   - Botón "Agregar Cliente" → modal/pestaña con campos:
     - Nombre
     - Email
     - Contraseña del portal (campo presente, NO funcional aún —
       almacenamiento de credenciales reales viene en Fase 2 con cifrado serio)
   - Edición rápida y borrado de clientes
   - Al dar de alta cliente: selector "Ventas e inventario juntos / separados"
     (afecta cómo se parsean los archivos de ese cliente después)
   - Sub-sección o tab: **Mapeo de SKUs** del cliente. Tabla editable que
     relaciona el SKU estándar del cliente con el nombre en cada portal.
     Ejemplo: "Carne seca sal limón 20g" (estándar) ↔ "carne seca sal limón
     20g" (Chedraui) ↔ "sal y limón" (HEB).

5. **Página Análisis**
   - Panel con lista de clientes
   - Por cliente, botón para subir archivo (Excel o CSV)
   - Selector de qué portal y qué tipo (ventas / inventario / mixto)
   - Botón "Analizar" → parsea, normaliza, mapea SKUs, guarda en DB
   - Resultado se refleja en Dashboard y OneTable automáticamente
   - Esta página es donde un humano hace lo que la Fase 3 automatizará

6. **Página Promotoría**
   - Stub con "Coming Soon" visualmente atractivo
   - Preview de lo que viene (capturas de mockup, lista de features)

### Datos reales

VIKS Jerky tiene archivos reales descargados de varios portales. Se usarán
para el usuario demo. La data fluye:

`docs/specs/viks-data/<portal>.xlsx` → parser → normalizer → DB → dashboard

### Lo que NO está en Fase 1

- Scrapers de Playwright (Fase 3)
- Almacenamiento real de credenciales de portales (Fase 2, con KMS o equivalente)
- Fuzzy matching automático de SKUs con embeddings (Fase 2)
- Scheduler / cron de descargas (Fase 3)
- Alertas por email o WhatsApp (Fase 2)
- Multi-tenancy con roles complejos (Fase 2)
- Pricing real y billing (Fase 2)
- API pública para clientes Enterprise (Fase 4)

## Restricciones inmutables

### Stack (ya decidido)

- Next.js 14 App Router + TypeScript
- Tailwind CSS + shadcn/ui
- Prisma + Neon Postgres
- NextAuth v5
- Recharts
- SheetJS (xlsx) + Papaparse
- Deploy a Vercel
- Dirección visual: dark mode primero con acento de color vivo (estilo
  Linear / Vercel / Supabase)

### Arquitectura (ya decidida)

- Monorepo simple, todo dentro de un solo Next.js
- Carpeta `core/` con lógica de negocio pura, sin imports de Next.js
- `core/` debe poderse migrar a Python o lift a un servicio Node aparte
  en Fase 3 sin reescribir UI/API
- DB serverless (Neon), no PostgreSQL self-hosted

### Deadline

Presentación ANTAD: **lunes-martes (3-4 días desde hoy domingo)**.
Esto significa: máximo 30-40 horas efectivas de trabajo. El alcance está
calibrado para ese tiempo.

### Workflow

- Superpowers para brainstorming → plan → ejecución por subagentes
- TDD donde aplique (sprints self-verifiable). Gates requieren revisión humana.
- Nunca commit a main directo (hook bloquea)
- Feature branches + merge --no-ff
- Build local debe pasar antes de merge

## Preguntas abiertas (a resolver en brainstorming)

Estas son las decisiones que el brainstorming debe clarificar. **No las
respondas en este documento.**

1. **Modelo de datos final.** El SRS tiene un esquema sugerido (sellout_data,
   downloads, clients, portal_credentials, product_catalog). Hay que adaptarlo
   a la realidad de la Fase 1 (sin scrapers, sin credenciales reales) y al
   patrón "una agencia, muchos clientes finales". Definir tablas finales,
   relaciones, índices.

2. **Multi-tenancy.** El usuario logueado representa una agencia o consultor
   que maneja varios clientes finales (VIKS, otros). ¿Cómo se modela?
   ¿Tabla `agency` separada de `client`? ¿O un solo nivel?

3. **Parsers de portales.** Hay 6 portales en el SRS pero solo tenemos archivos
   reales de algunos. ¿Cuáles implementamos en Fase 1? ¿Cómo se diseña el
   contrato del parser para que agregar portales nuevos sea drop-in?

4. **Mapeo de SKUs.** ¿Cómo se inicializa el catálogo cuando se da de alta
   un cliente? ¿Se permite import desde Excel? ¿Qué pasa si llega un archivo
   con un SKU no mapeado todavía?

5. **Cálculo de KPIs y alertas.** Días de inventario, alertas (SIN STOCK / OK
   / ATENCIÓN / RIESGO / CRÍTICO). ¿Se calculan al insert o al query? Trade-off
   de performance vs simplicidad.

6. **Export a Excel/CSV.** ¿Se genera server-side o client-side? Impacto en
   serverless de Vercel.

7. **Seed del usuario demo.** ¿Cómo se ejecuta y mantiene el seed con la data
   de VIKS? ¿Resetea o acumula?

8. **Sprints vs Gates.** Identificar tentativamente qué tareas son
   self-verifiable (parsers, normalizer, cálculos) vs cuáles requieren
   revisión humana de diseño (dashboard visual, landing page, UX de upload).

## Recursos disponibles

- SRS completo: `docs/specs/scopium-srs-v1.docx` (legacy name, ignorar el
  nombre "Scopium")
- Datos reales de VIKS: pendiente de subir a `docs/specs/viks-data/`
- Cuenta Neon (DB): pendiente de provisionar
- Cuenta Vercel: existente
- Repo GitHub: `github.com/SnakeJazzzz/OneTable`
- Hooks de seguridad: activos en `.claude/hooks/`

## Definición de "demo listo para ANTAD"

El demo está listo cuando:
- Deploy a Vercel funcional en un subdominio `*.vercel.app`
- Landing page convincente
- Usuario demo entra y ve dashboard con datos reales de VIKS de varias cadenas
- Se puede subir un archivo nuevo en página Análisis y verlo reflejado
- OneTable exporta a Excel correctamente
- Páginas Clientes y Catálogo navegables y funcionales (CRUD básico)
- Promotoría con coming soon
- Build local pasa, no hay errores en consola en producción
- Probado en Chrome, Safari, y mobile (iPhone)

## Lo que NO se prueba para ANTAD

- No se prueba con múltiples usuarios concurrentes
- No se prueba con archivos gigantes (>10MB)
- No se prueba auditoría de seguridad seria
- No se prueba que la base de datos escale a producción
- No se prueba accesibilidad WCAG completa

Estos pendientes se priorizan en Fase 2.
