# Dashboards / Tableros — Spec Integral

**Proyecto:** AMSA Gestión
**Módulo nuevo:** `dashboards`
**Fecha:** 2026-05-12 (revisado con códigos canónicos confirmados)
**Estado:** Diseño aprobado — arrancando Fase 1
**Spec relacionada:** `docs/reportes-dynamic-spec.md`, `docs/auditoria-spec.md`
**Catálogo de parámetros:** `backend/prisma/seed-codigos-curados.ts` (112 códigos × 24 empresas)

---

## 0. Resumen ejecutivo

Sumar a Gestión un módulo de **tableros analíticos** orientado al negocio de cobranzas (cartera, recupero, gestión y motivos de no pago) con foco en **remesa/empresa** como vista primaria, exportable a PDF y Excel, visualmente moderno (MUI v5 + Recharts), y reutilizando la infraestructura ya construida en `reportes` (catálogo, exportadores) y `transacciones` (auditoría).

Pensado para usuarios operativos y supervisores: ver de un vistazo "cómo va una remesa", clickear y entender qué pesa más, descargar a PDF para reuniones de cliente, y a XLS para análisis offline.

---

## 1. Decisión arquitectónica raíz

### Decisión: **Módulo nuevo `dashboards` que reutiliza exportadores y catálogo de `reportes`.**

**Justificación (3 razones):**

1. **Naturaleza distinta**. `reportes` resuelve "una query tabular grande, exportable, parametrizable por campos". Un tablero es **multi-widget, multi-query, visual, con drill-down**. Forzar reportes para que renderice gráficos llevaría a contaminar su DSL (que hoy es path-based tabular) con preocupaciones de layout, visualización y agregación multi-dimensional. Termina siendo dos lenguajes en un mismo modelo.
2. **Ciclo de vida y permisos separados**. Reportes tiene permisos `reportes.*` (crear/editar/ejecutar plantillas, gestionar formatos). Un tablero tiene otro flujo: ver KPIs, filtrar, exportar snapshot. La granularidad RBAC se mantiene clara separando módulos.
3. **Reusabilidad sin acoplamiento**. Los **exportadores** (`XlsxExportador`, `PdfExportador`, `CsvExportador`) en `reportes/exportadores/` ya están provistos como `@Injectable()` y son consumidos por `transacciones` (precedente exitoso). El módulo `dashboards` los importa igual, sin tocar reportes.

**Lo que SÍ se comparte con reportes:**
- Exportadores (XLSX/PDF/CSV) — reusados tal cual, sin duplicar.
- Eventualmente metadata del catálogo (`reportes/catalogo/metadata.ts`) para reutilizar labels de campos y `empresa_parametro` overrides.

**Lo que NO se comparte:**
- DSL de plantillas (no aplica a tableros).
- Engine de ejecución sync/async de reportes (los KPIs son queries cortas, sub-segundo).

---

## 2. Modelo de datos

### 2.1 Fase 1: tableros **estáticos** (sin nuevas tablas)

Para arrancar, no creamos tablas. El "Tablero de Remesa" es un layout fijo, hardcodeado en frontend, alimentado por endpoints específicos del backend. Esto permite:
- Entregar valor rápido (3-4 semanas).
- No comprometerse a un schema que después haya que migrar.
- Validar qué KPIs son realmente útiles antes de generalizar.

**No se requiere `npx prisma db push`** en fase 1.

### 2.2 Fase futura: tableros **guardables** (modelos propuestos, NO implementar ahora)

Cuando el negocio pida "guardame este filtro" o "compartilo con mi equipo":

```prisma
model tablero {
  id          Int      @id @default(autoincrement())
  nombre      String
  descripcion String?  @db.Text
  scope       String   @default("REMESA")  // 'REMESA' | 'EMPRESA' | 'GLOBAL'
  empresaId   Int?
  creadorId   Int?
  layoutJson  Json     // { filtrosDefault, widgets: [...], grid: {...} }
  compartido  Boolean  @default(false)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
  empresa     empresa? @relation(fields: [empresaId], references: [id])
  creador     usuario? @relation(fields: [creadorId], references: [id])
  widgets     tablero_widget[]

  @@index([empresaId])
  @@index([creadorId])
  @@index([scope])
}

model tablero_widget {
  id         Int      @id @default(autoincrement())
  tableroId  Int
  tipo       String   // 'KPI' | 'PIE' | 'DONUT' | 'LINE' | 'BAR' | 'TABLE' | 'FUNNEL'
  titulo     String
  configJson Json     // { metric, dimension, filtros, opciones }
  posX       Int      @default(0)
  posY       Int      @default(0)
  w          Int      @default(4)
  h          Int      @default(4)
  orden      Int      @default(0)
  tablero    tablero  @relation(fields: [tableroId], references: [id], onDelete: Cascade)

  @@index([tableroId])
}
```

**Diferimiento:** no se implementa en fase 1. Mencionado solo para que la API de fase 1 deje hooks compatibles (ej. recibir `widgets: [...]` en `POST /export` permite migrar después a layouts guardables sin romper contratos).

---

## 3. Catálogo inicial de KPIs y widgets (Fase 1)

Investigación rápida de estándares: **Salesforce Service Cloud** (Console KPIs), **Genesys/Vicidial** (campaign dashboards), **HubSpot Sales Hub**, **Tableau collections finance**, y guías argentinas (CMS — Centro de Medios y Soluciones, INFOCOB) coinciden en estos KPIs como núcleo de cobranzas. Mantenemos esos nombres traducidos al castellano rioplatense del proyecto.

### 3.1 KPIs principales — Cards (banda superior del tablero)

Cards grandes, números destacados, comparación contra período anterior cuando aplique (delta % verde/rojo). Diseño tipo Stripe/Linear.

| KPI | Cálculo (sobre la remesa/empresa filtrada y rango de fechas) | Notas |
|-----|--------------------------------------------------------------|-------|
| **Cantidad de casos** | `count(deudor)` | "Casos" = deudores. |
| **Deuda total cartera** | `sum(deudor.montoTotal)` | Saldo de la cartera filtrada. |
| **Pagos totales del período** | `sum(pago.importe) where fechaPago BETWEEN desde AND hasta` | Solo dentro del rango. |
| **% de recupero** | `pagos_periodo / deuda_total * 100` | Métrica clave. |
| **Casos con pago** | `count(deudor) where exists pago en período` | Cobertura. |
| **Ticket promedio de pago** | `avg(pago.importe)` | Período. |
| **Mora promedio (días)** | `avg(DATEDIFF(hoy, deudor.fechaVencimiento))` para no pagados | Solo casos pendientes. |
| **Promesas vigentes** | `count(deudor) where estadoSituacion.clave='SIT-020'` | Estado situación = "Promesa de pago vigente". |
| **% CPC (Contacto con Persona Correcta)** | `count(deudor) where estadoSituacion.clave IN ('SIT-011','SIT-012') / count(deudor) * 100` | SIT-011=titular + SIT-012=tercero. Estándar industria. |
| **Casos sin gestión** | `count(deudor) where estadoGestionId IS NULL` | Pipeline pendiente. |
| **Casos incobrables** | `count(deudor) where estadoSituacion.categoria='INCOBRABLE'` | SIT-100..104. |
| **Casos en proceso legal** | `count(deudor) where estadoSituacion.categoria='LEGAL'` | SIT-090..094 (intimación, quiebra, mediación). |

### 3.2 Distribuciones — Pie / Donut

Visualmente: donut con leyenda lateral, top 6 + "Otros". Hover muestra cantidad y %.

- **Por estado de situación** (`deudor.estadoSituacionId` → join `parametro`).
- **Por estado de gestión** (`deudor.estadoGestionId`).
- **Por motivo de no pago** (`deudor.motivoNoPagoId`).
- **Por rango de mora**: 0-30 / 31-60 / 61-90 / 91-180 / 180+ días (calculado desde `fechaVencimiento`).
- **Por rango de deuda**: $0-10k / $10k-50k / $50k-200k / $200k-1M / $1M+ (configurable a futuro).

### 3.3 Tendencias — Line / Area chart

Eje X: tiempo (día/semana/mes según granularidad del filtro). Eje Y: monto o cantidad.

- **Pagos por día** (área, sum de `pago.importe`).
- **Cantidad de pagos por día** (línea overlaid opcional).
- **Evolución de saldo de cartera** (línea, snapshot diario — diferido a fase 2 si requiere histórico, ver §11).
- **Cantidad de gestiones (comentarios) por día** — proxy de "actividad del equipo".

### 3.4 Tablas detalle

- **Top 10 deudores por monto** (nombre, documento, monto, estado gestión).
- **Top 5 motivos de no pago** con cantidad y %.
- **Ranking de gestores** (a futuro — depende de "usuario asignado al deudor", ver Preguntas abiertas #2).

### 3.5 Funnel de gestión

Embudo clásico de cobranzas, 4 etapas:

```
ASIGNADOS → CONTACTADOS → CON PROMESA → CON PAGO
```

- **Asignados**: todos los deudores de la remesa/empresa.
- **Contactados**: deudores con `estadoSituacion.clave IN ('SIT-010','SIT-011','SIT-012','SIT-013')` — categoría CONTACTADO (incluye CPC titular + tercero).
- **Con promesa**: deudores con `estadoGestion.clave = 'GES-030'` (acción de promesa) OR `estadoSituacion.clave = 'SIT-020'` (estado vigente).
- **Con pago**: deudores con al menos un `pago` en el período OR `estadoSituacion.categoria IN ('PAGANDO','CANCELADO')`.

Componente: `<FunnelChart>` de Recharts (existe desde v2.5).

---

## 4. Filtros del tablero

Barra superior **sticky** (queda visible al hacer scroll). Mismos filtros para todos los widgets del tablero (single source of truth, gestionado en contexto React).

| Filtro | Tipo | Comportamiento |
|--------|------|----------------|
| **Empresa** | Select single | Si el usuario tiene `dashboards.ver_todas_empresas`, ve todas. Si no, fijo a su empresa. |
| **Remesa** | Select single | Filtrado por empresa elegida. Opción "Todas las remesas" disponible. |
| **Rango de fechas** | DateRangePicker | Aplica a pagos, comentarios, gestiones. Default: últimos 30 días. |
| **Estado de situación** | Multi-select | `parametro` grupo `situacion`. Default: todos. |
| **Estado de gestión** | Multi-select | `parametro` grupo `gestion`. Default: todos. |
| **Motivo de no pago** | Multi-select | `parametro` grupo `motivo_no_pago`. Default: todos. |
| **Rango de mora** | Multi-select (chips) | `0-30`, `31-60`, `61-90`, `91-180`, `180+`. Default: todos. |
| **Usuario asignado** | Diferido | Ver Preguntas abiertas #2. |

Botón "Limpiar filtros" + "Aplicar" (este último sólo si decidimos no auto-aplicar). Recomendación: **auto-aplicar con debounce 400ms** salvo en el date picker.

---

## 5. API backend

### 5.1 Decisión clave: snapshot único vs N endpoints

**Recomendación: snapshot único `POST /dashboards/remesa/snapshot`.**

**Por qué:**
- Una sola request por vista del tablero — más simple en frontend, menos latencia agregada.
- Permite hacer **una sola validación** de permisos y armar **una sola entrada de auditoría** por carga.
- El body lleva los filtros una sola vez (no se repite en cada endpoint chico).
- Render server-side de TODOS los widgets se hace contra el **mismo snapshot** garantizando consistencia (no se ve un KPI con datos de hace 200ms y un pie con datos de ahora — importante si la cartera muta durante una jornada).

**Cuando sí abrir endpoints granulares:**
- Drill-down (clickear slice → pedir tabla detalle filtrada). Ahí sí endpoint dedicado.
- Refresh parcial de un widget (no esperado en fase 1).

### 5.2 Endpoints fase 1

```
POST /dashboards/remesa/snapshot
  body: {
    empresaId: number | null,
    remesaId: number | null,
    desde: ISO date,
    hasta: ISO date,
    situacionIds?: number[],
    gestionIds?: number[],
    motivoIds?: number[],
    moraRangos?: ('0-30'|'31-60'|'61-90'|'91-180'|'180+')[],
    granularidad?: 'dia'|'semana'|'mes',  // para series
  }
  response: {
    kpis: {
      cantidadCasos, deudaTotal, pagosPeriodo, porcentajeRecupero,
      casosConPago, ticketPromedio, moraPromediaDias, promesasVigentes,
      casosSinGestion
    },
    distribuciones: {
      porSituacion: [{ id, label, cantidad, porcentaje }],
      porGestion: [...],
      porMotivo: [...],
      porMora: [{ rango, cantidad, porcentaje }],
      porDeuda: [{ rango, cantidad, porcentaje, suma }],
    },
    series: {
      pagosPorPeriodo: [{ fecha, importe, cantidad }],
      gestionesPorPeriodo: [{ fecha, cantidad }],
    },
    top: {
      deudores: [{ deudorId, nombreCompleto, documento, monto, estadoGestion }],
      motivos: [{ id, label, cantidad, porcentaje }],
    },
    funnel: { asignados, contactados, conPromesa, conPago },
    meta: {
      empresaNombre, remesaNombre, generadoEn, filtrosResumen
    }
  }
```

```
GET /dashboards/remesa/drill-down/deudores
  ?dimension=situacion&valor=PROMESA_PAGO&...filtros_base
  → tabla paginada de deudores que matchean ese slice
```

```
POST /dashboards/remesa/export
  body: { filtros: {...}, formato: 'xlsx'|'pdf', incluir: ['kpis','distribuciones','series','top','funnel'] }
  response: archivo (mismo patrón que /reportes ejecutar)
```

### 5.3 Validaciones

- `empresaId` requerido si el usuario no tiene `dashboards.ver_todas_empresas`.
- `desde <= hasta`, máximo 366 días de rango (evita queries gigantes accidentales).
- `remesaId` opcional, pero si viene debe pertenecer a la `empresaId`.

### 5.4 Códigos de error

- `400` filtros inválidos (rango invertido, rango > 366 días).
- `403` empresa fuera del scope del usuario.
- `404` remesa no encontrada.
- `422` combinación de filtros que produce conjunto vacío (opcional — devolver 200 con respuesta vacía es más amigable).

---

## 6. Estrategia de queries

### 6.1 Approach general

**Prisma `groupBy` + `aggregate` para 80% de KPIs y distribuciones.** Sólo bajar a `$queryRaw` cuando:
- Hay buckets calculados (rangos de mora, rangos de deuda) → más legible y rápido en SQL.
- Series temporales agrupadas por día/semana/mes con `DATE_FORMAT()` de MySQL.

Patrón ya usado por `transacciones.service.ts::stats` (ver `serieRaw` con `DATE(createdAt)` + `GROUP BY`). Reusamos ese estilo.

### 6.2 Ejecutar en paralelo

Todo el snapshot se arma con `Promise.all([...])` — el endpoint debe correr ~12 queries en paralelo. Igual que `transacciones.stats`. Latencia objetivo: **< 800ms para remesas de hasta 100k deudores** con índices correctos.

### 6.3 Pseudocódigo del servicio principal

```
async snapshot(filtros, restrictEmpresaId):
  where = buildWhereBase(filtros, restrictEmpresaId)   // empresaId, remesaId, situacion, gestion, motivo

  const [
    cantidadCasos, deudaAgg, pagosAgg, casosConPago,
    distSituacion, distGestion, distMotivo, distMora, distDeuda,
    seriePagos, serieGestiones,
    topDeudores, topMotivos,
    funnel
  ] = await Promise.all([
    prisma.deudor.count({ where }),
    prisma.deudor.aggregate({ where, _sum: { montoTotal: true } }),
    prisma.pago.aggregate({ where: pagoWhere(where, desde, hasta), _sum: { importe: true }, _avg: { importe: true }, _count: true }),
    prisma.pago.findMany({ where: pagoWhere(...), distinct: ['deudorId'], select: { deudorId: true } }),
    groupByConJoin('estadoSituacion', where),
    groupByConJoin('estadoGestion', where),
    groupByConJoin('motivoNoPago', where),
    bucketsMora(where),           // $queryRaw con CASE WHEN
    bucketsDeuda(where),          // $queryRaw con CASE WHEN
    seriePagosPorGranularidad(where, granularidad),
    serieGestionesPorGranularidad(where, granularidad),
    topDeudoresPorMonto(where, 10),
    topMotivosConPorcentaje(where, 5),
    calcularFunnel(where, desde, hasta),
  ])

  return shapeResponse(...)
```

### 6.4 Performance e índices

**Índices que ya existen** (revisado en `schema.prisma`):
- `Deudor_empresaId_remesaId_idx` — bien, cubre filtro raíz.
- `Deudor_estadoSituacionId/estadoGestionId/motivoNoPagoId_fkey` — bien.
- `Pago_deudorId_fkey` — sirve.

**Índices faltantes a agregar (Fase 2):**
- `pago(fecha)` — series temporales filtran por fecha.
- `pago(deudorId, fecha)` compuesto — JOIN pago→deudor con rango.
- `comentario(fecha)` y `comentario(deudorId, fecha)` — series de gestiones.
- `deudor(fechaVencimiento)` — buckets de mora.
- `convenio(deudorId, estado)` — funnel "con promesa".

Plan: medir primero con `EXPLAIN` en una empresa real, agregar índices reactivamente con `npx prisma db push` (siguiendo CLAUDE.md — drift histórico).

### 6.5 Caching

**Fase 1**: sin cache. Cada request va a DB. Las queries son < 1s.

**Fase futura**: si una empresa tiene > 500k deudores, agregar cache en memoria con TTL 60s **por combinación de filtros** (key = hash de filtros). Invalidar manualmente vía socket cuando llega un pago/import nuevo.

### 6.6 N+1 — riesgos

- En distribuciones por situación/gestión/motivo: `groupBy` de Prisma devuelve solo `parametroId` y count. Hay que hacer **un `findMany({ where: { id: { in: ids } } })` adicional** sobre `parametro` para mapear a labels (mismo patrón que `transacciones.stats` con `usuariosMap`). NO hacer un find por cada slice — eso es N+1.

---

## 7. Frontend

### 7.1 Librería de gráficos: **Recharts**

**Recharts ya está instalada** (`"recharts": "^3.8.1"` en `frontend/package.json`). Decisión tomada de hecho. Razones:
- Tipos TS oficiales.
- Composable estilo React (`<PieChart><Pie data=... /></PieChart>`).
- Soporte de dark mode trivial (todas las colores se pasan por prop, funciona con `useTheme().palette`).
- Funnel, Line, Area, Pie, Bar, Treemap — cubre todo el catálogo de fase 1.
- Ya hay precedente en `pages/auditoria/AuditoriaDashboard.tsx` (verificar — el agente implementer debe mirar ese archivo como referencia visual y de patrones).

**ApexCharts descartado por ahora**: más rico visualmente pero introduce otra dep, otro tema de dark mode, y para fase 1 no necesitamos animaciones avanzadas.

### 7.2 Estructura de páginas

```
frontend/src/pages/dashboards/
├── DashboardsPage.tsx            # router interno, tabs si hay > 1 tablero
├── TableroRemesa.tsx             # tablero principal de fase 1
├── components/
│   ├── DashboardFiltros.tsx      # barra sticky superior
│   ├── KpiCard.tsx               # card con número grande, delta, icono
│   ├── KpiGrid.tsx               # grid de 4-5 KpiCard
│   ├── DistribucionDonut.tsx     # wrapper Recharts PieChart con leyenda
│   ├── SerieLine.tsx             # wrapper Recharts AreaChart
│   ├── TopTable.tsx              # tabla compacta MUI con avatares/chips
│   ├── FunnelGestion.tsx         # wrapper Recharts FunnelChart
│   ├── ExportarMenu.tsx          # botón split "Exportar" PDF/XLS
│   └── DrillDownDialog.tsx       # dialog full-screen con tabla detalle
└── hooks/
    └── useTableroSnapshot.ts     # fetch + estado del snapshot con react-query o swr (revisar qué se usa hoy)
```

```
frontend/src/api/
└── dashboards.api.ts             # cliente HTTP del módulo
```

### 7.3 Layout

- **MUI Grid v2** responsive (12 columnas):
  - Fila 1: KPIs (4-5 cards, 2-3 por fila en mobile).
  - Fila 2: 2 columnas — donut situación (col 6) + donut motivo (col 6).
  - Fila 3: línea de pagos full-width (col 12).
  - Fila 4: 2 columnas — top deudores (col 8) + funnel (col 4).
- **SectionCard** (ya existente) como contenedor de cada widget — mantiene consistencia visual.
- **Skeletons** durante carga inicial (`<Skeleton variant="rounded" height={120} />`).
- **Empty state** por widget cuando el query devuelve 0 filas.
- **Dark / light mode**: tomar colores de `theme.palette.primary/secondary/warning/error` para los charts. NUNCA hardcodear hex. Para paletas de gráficos: armar un helper `getChartPalette(theme)` que devuelva 6-8 colores derivados del tema.

### 7.4 Drill-down

- Clickear slice de donut → abre `DrillDownDialog` con `<DataGrid>` (o tabla MUI) listando deudores filtrados por ese valor.
- El dialog usa `GET /dashboards/remesa/drill-down/deudores?dimension=...&valor=...` con los mismos filtros base.
- Botón "Ver en página de Deudores" → navega a `/deudores?empresaId=X&remesaId=Y&situacionId=Z` (preset de filtros, requiere que la página de deudores soporte deep-link — verificar).

### 7.5 Notificaciones / feedback

- `useNotify` para errores de carga.
- Toast "Exportación lista" al descargar.
- Botón "Exportar" debe deshabilitarse durante la generación (spinner inline).

### 7.6 Sockets

**Fase 1: no usar sockets.** El tablero es pull, no push. Si en fase 2 se quiere "tablero en vivo" durante una jornada de gestión, agregar emisión `dashboard:refresh:{empresaId}` cuando entra un pago o se crea un comentario, y suscribir desde `useTableroSnapshot` con debounce 5s.

---

## 8. Permisos (RBAC)

Agregar al `permisos-catalogo.ts` una nueva sección:

```ts
{
  seccion: 'Dashboards',
  permisos: [
    { key: 'dashboards.ver', label: 'Ver tableros' },
    { key: 'dashboards.ver_todas_empresas', label: 'Ver tableros de todas las empresas', descripcion: 'Sin esta key, solo ve la empresa propia' },
    { key: 'dashboards.exportar', label: 'Exportar tableros a PDF/XLS' },
  ],
},
```

**Reglas en controller:**
- `@Permisos('dashboards.ver')` a nivel controller.
- Si **no** tiene `dashboards.ver_todas_empresas`, forzar `empresaId` a la del usuario logueado en el filtro del snapshot (resolución igual a `resolverEmpresaId` de reportes).
- `@Permisos('dashboards.exportar')` solo en el endpoint `POST /export`.

---

## 9. Auditoría

Cada acción registrable como `transaccion`:

| Acción | Modulo | Tipo | Severidad | Resumen |
|--------|--------|------|-----------|---------|
| Ver snapshot | `DASHBOARDS` | `VER_TABLERO` | INFO | "Vio tablero de remesa X / empresa Y" |
| Exportar PDF | `DASHBOARDS` | `EXPORTAR_TABLERO` | INFO | "Exportó tablero a PDF (filtros: ...)" |
| Exportar XLS | `DASHBOARDS` | `EXPORTAR_TABLERO` | INFO | "Exportó tablero a XLSX (filtros: ...)" |
| Drill-down | `DASHBOARDS` | `VER_DETALLE` | INFO | "Drill-down dimensión=X valor=Y" |

**Implementación:** agregar `DASHBOARDS = 'DASHBOARDS'` al enum `AuditModulo` en `backend/src/modules/transacciones/audit.enums.ts`. Agregar `VER_TABLERO`, `EXPORTAR_TABLERO`, `VER_DETALLE` al enum `AuditTipo`. Usar `@Audit({...})` en los endpoints.

**Nota:** los `VER_*` pueden ser ruidosos. Considerar **sampling** (solo auditar 1 de cada N) o solo auditar exports. Decisión: en fase 1 auditar **solo exports y drill-down**; el `snapshot` GET no se audita por volumen.

---

## 10. Fases de implementación

Cada fase es un **PR independiente** que deja el sistema funcionando.

### Fase 1 — Backend del snapshot mínimo (KPIs + distribuciones)
**Objetivo:** endpoint `POST /dashboards/remesa/snapshot` devolviendo KPIs y 3 distribuciones (situación, gestión, motivo).

**Archivos a crear:**
- `backend/src/modules/dashboards/dashboards.module.ts`
- `backend/src/modules/dashboards/dashboards.controller.ts`
- `backend/src/modules/dashboards/dashboards.service.ts`
- `backend/src/modules/dashboards/dto/snapshot.dto.ts`
- `backend/src/modules/dashboards/interfaces/snapshot.interface.ts`

**Archivos a modificar:**
- `backend/src/app.module.ts` (registrar `DashboardsModule`).
- `backend/src/auth/permisos-catalogo.ts` (sección Dashboards).
- `backend/src/modules/transacciones/audit.enums.ts` (`DASHBOARDS`, tipos).

**Tests:**
- Service spec: KPIs correctos sobre fixture conocido.
- Controller spec: 403 sin permiso, 400 filtros inválidos.

### Fase 2 — Backend: distribuciones por mora/deuda + series temporales + funnel + top
**Objetivo:** completar el shape del snapshot.

- Agregar `bucketsMora`, `bucketsDeuda` (raw queries con CASE).
- Series pagos/gestiones con `DATE_FORMAT`.
- Funnel (4 etapas).
- Top deudores + top motivos.

**Archivos a modificar:**
- `backend/src/modules/dashboards/dashboards.service.ts`.

**Tests:** snapshot completo contra fixture grande (10k deudores) verifica latencia < 1s.

### Fase 3 — Frontend del tablero de remesa
**Objetivo:** página `/dashboards` funcionando, con todos los widgets fase 1.

**Archivos a crear:** todos los listados en §7.2.

**Archivos a modificar:**
- `frontend/src/routes/...` — agregar ruta.
- `frontend/src/components/layout/Sidebar.tsx` (o como se llame) — entrada de menú.

### Fase 4 — Exportación PDF/XLS del tablero
**Objetivo:** botón "Exportar" funcional.

**Backend:**
- `POST /dashboards/remesa/export` que arma un PDF con:
  - Branding empresa (reusar `OpcionesPdf.brandingEmpresa`).
  - Página 1: tabla de KPIs.
  - Página 2: cada distribución como tabla.
  - Páginas siguientes: series y top.
- XLS con una pestaña por widget (KPIs / Situación / Gestión / Motivo / Mora / Deuda / Top deudores).

**Frontend:**
- `ExportarMenu.tsx` con split button PDF/XLS.
- Loading inline + descarga vía blob.

**Auditoría:** registrar cada export con `@Audit`.

**Archivos a modificar:**
- `backend/src/modules/dashboards/dashboards.controller.ts` + `dashboards.service.ts`.

### Fase 5 — Drill-down
**Objetivo:** clickear slice → ver tabla detalle filtrada.

- `GET /dashboards/remesa/drill-down/deudores`.
- `DrillDownDialog` en frontend.
- Auditoría `VER_DETALLE`.

### Fase 6 — Índices y performance
**Objetivo:** medir y agregar índices.

- Correr `EXPLAIN` en la empresa con más volumen.
- Agregar índices listados en §6.4 vía `npx prisma db push`.
- Documentar baseline de latencia en CHANGELOG.

### Fase 7 — Diferimientos hechos features (opcional)
**Cuando el negocio pida:**
- Tableros guardables (modelos `tablero`, `tablero_widget`).
- Tableros de campañas de Sender (cuando la integración esté lista — ver `project_integration.md`).
- Snapshot histórico de cartera (cron diario que guarde foto del saldo total → permite serie de evolución de saldo).
- Alertas: notificación cuando un KPI cruza umbral (ej. "% recupero < 10% en remesa X").

---

## 11. Riesgos y trade-offs

| # | Riesgo | Mitigación |
|---|--------|-----------|
| R1 | **Performance con remesas grandes (> 500k deudores)**: el snapshot puede tardar > 2s. | Índices §6.4, `Promise.all`, eventualmente cache 60s. Medir con datos reales antes de prematuramente optimizar. |
| R2 | **Frescura de datos**: usuario ve "deuda total" pero acaba de entrar un pago hace 10s. | Fase 1 = pull. Mostrar `meta.generadoEn` en el footer. Botón "Refrescar" manual. |
| R3 | **Snapshot único vs N endpoints**: si un widget falla (ej. la query de funnel rompe), cae todo el snapshot. | Try/catch por bloque dentro del service; si un bloque falla, devolver `null` en esa propiedad + log de error. Frontend renderiza error inline en ese widget. |
| R4 | **Códigos canónicos hardcodeados en el service**: si en el futuro se renombra una clave, rompe el cálculo. | Centralizar las claves en `backend/src/modules/dashboards/codigos.constants.ts` con docstring. Documentar en seed (`seed-codigos-curados.ts` ya es la fuente de verdad). |
| R5 | **PDF voluminoso con muchas distribuciones**: 8 páginas para un tablero. | Diseñar PDF compacto: 2 distribuciones por página, tablas con 5 filas + "Otros". |
| R6 | **Filtros de rango de mora calculados on-the-fly**: query con `DATEDIFF` no usa índice. | Si es lento, materializar columna `diasMora` en `deudor` actualizada por trigger/job nocturno. Diferir. |
| R7 | **Auditoría infla `transaccion`** si cada apertura del tablero se loguea. | Auditar solo export + drill-down en fase 1. Re-evaluar después. |

---

## 12. Diferimientos explícitos (NO hacer en fase 1)

- Tableros guardables / personalizables (modelos `tablero`, `tablero_widget`).
- Tableros multi-empresa (mismo tablero comparando varias empresas).
- Dashboards de campañas de email/WhatsApp del Sender.
- Tablero de gestores (ranking, productividad) — requiere usuario asignado al deudor.
- Drill-down sobre series temporales (clickear día → ver pagos de ese día).
- Alertas/umbrales con notificación push.
- Exportación a PowerPoint.
- Embebido del tablero en un iframe externo (cliente externo).
- Cache distribuido con Redis.
- Snapshot histórico (foto diaria de la cartera para serie de evolución de saldo).

---

## 13. Decisiones del usuario (cerradas 2026-05-12)

1. **% CPC**: ✅ resuelto vía código de situación. `CPC = SIT-011 (titular) + SIT-012 (tercero)`. No requiere flag adicional ni nueva columna. Los gestores clasifican al cerrar la gestión.

2. **Usuario asignado al deudor**: ✅ NO hay asignación 1-a-1 ni 1-a-N. Todos los gestores ven y gestionan todos los deudores. Ranking de gestores → **diferido fase 7** (requiere modelar asignación primero).

3. **Estados de gestión "promesa de pago"**: ✅ confirmado mediante el seed `seed-codigos-curados.ts`:
   - `GES-030` "Promesa de pago" (acción de gestión)
   - `SIT-020` "Promesa de pago vigente" (estado de situación)
   - `SIT-021` "Promesa incumplida" (estado de situación)

4. **Rangos de deuda**: ✅ confirmados: `$0-10k / $10k-50k / $50k-200k / $200k-1M / $1M+`. Hardcodeados en fase 1, configurables por empresa diferido a fase 7.

5. **PDF del tablero — branding**: ✅ logo de **AMSA** (no usamos logo del cliente porque hoy no se carga). Usar el mismo path que ya consume `reportes`.

6. **Granularidad por default**: ✅ auto según rango: `día (≤ 60d), semana (≤ 365d), mes (> 365d)`. El usuario puede override desde el filtro.

### Códigos canónicos consolidados (referencia rápida para el service)

```ts
// backend/src/modules/dashboards/codigos.constants.ts
export const CODIGOS = {
  // Contacto con Persona Correcta
  CPC_SITUACION_CLAVES: ['SIT-011', 'SIT-012'] as const,

  // Promesa de pago (acción + estados)
  PROMESA_GESTION_CLAVE: 'GES-030' as const,
  PROMESA_SITUACION_VIGENTE: 'SIT-020' as const,
  PROMESA_SITUACION_INCUMPLIDA: 'SIT-021' as const,

  // Funnel: contactados
  CONTACTADO_CATEGORIA: 'CONTACTADO' as const, // SIT-010..013

  // Estados terminales
  INCOBRABLE_CATEGORIA: 'INCOBRABLE' as const, // SIT-100..104
  LEGAL_CATEGORIA: 'LEGAL' as const,           // SIT-090..094
  CANCELADO_CATEGORIA: 'CANCELADO' as const,   // SIT-050..053
  PAGANDO_CATEGORIA: 'PAGANDO' as const,       // SIT-040..042
};
```

---

## 14. Métricas de éxito

Para validar que el módulo cumple, después del go-live:

- Usuarios distintos que abren `/dashboards` ≥ 50% del staff de cobranzas en la primera semana.
- ≥ 1 export por día por empresa activa.
- Latencia p95 del snapshot < 1.5s.
- 0 reportes de "el número del KPI no coincide con la realidad" (consistencia).

---

**Fin del spec.**
