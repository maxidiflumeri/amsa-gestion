# AMSA Gestión — Changelog de Desarrollo

> Este archivo es el registro de contexto principal para que una IA pueda retomar el trabajo.
> Stack: NestJS + Prisma + MySQL (backend) · React + MUI v5 + TypeScript (frontend)
> Convención DB: `npx prisma db push` (NO `prisma migrate dev` — hay drift histórico)

---

## [2026-04-13] — Módulo de Reportes completo (backend + frontend)

### Backend — `backend/src/modules/reportes/`

Módulo NestJS completo creado desde cero. Estructura:

```
reportes/
  reportes.module.ts
  reportes.service.ts         — CRUD plantillas, getColumnasDisponibles(), estadisticasRemesas()
  reportes.controller.ts      — todos los endpoints, descarga de archivos via @Res()
  ejecutor/
    ejecutor.service.ts       — router fuente + exportador, loguea ejecucion_reporte
    fuentes/
      deudores.fuente.ts      — builder de filtros complejos + mapearFila()
    exportadores/
      excel.exportador.ts     — xlsx con estilos (header azul #1565C0, bold, autowidth, freeze row 1)
      csv.exportador.ts       — UTF-8 BOM para compatibilidad Excel
      pdf.exportador.ts       — pdfmake, filas alternadas, landscape auto para >6 columnas
```

Endpoints disponibles:
- `GET /reportes/plantillas` — lista plantillas
- `POST /reportes/plantillas` — crear plantilla
- `PATCH /reportes/plantillas/:id` — editar
- `DELETE /reportes/plantillas/:id` — soft delete (activo=false)
- `POST /reportes/ejecutar` — ejecuta y retorna archivo (blob)
- `GET /reportes/estadisticas/remesas` — stats (query: empresaId, periodoDesde, periodoHasta)
- `GET /reportes/columnas-disponibles?fuente=deudores` — columnas disponibles por fuente
- `GET /reportes/formatos-telefono` — listar formatos
- `POST /reportes/formatos-telefono` — crear formato

Registrado en `app.module.ts`.

### Prisma — nuevos modelos (aplicados con `db push`)

```prisma
model plantilla_reporte {
  id             Int       @id @default(autoincrement())
  nombre         String
  descripcion    String?
  tipo           String    // 'base' | 'informe' | 'estadistico'
  fuente         String    // 'deudores'
  filtrosFijos   Json
  filtrosVars    Json      // string[] — qué filtros son variables en ejecución
  columnas       Json      // string[] — keys de columnas a incluir
  formatoSalida  String    // 'xlsx' | 'csv' | 'pdf'
  opcionesExcel  Json?
  opcionesPdf    Json?
  formatoTel     String?   // ej: "549{numero}"
  empresaId      Int?      // null = plantilla global
  activo         Boolean   @default(true)
  createdAt      DateTime  @default(now())
  updatedAt      DateTime  @updatedAt
}

model ejecucion_reporte {
  id             Int       @id @default(autoincrement())
  plantillaId    Int
  usuarioId      Int?
  filtrosUsados  Json
  totalFilas     Int?
  createdAt      DateTime  @default(now())
}

model formato_telefono {
  id             Int       @id @default(autoincrement())
  nombre         String    @unique
  descripcion    String?
  patron         String    // ej: "549{numero}"
  activo         Boolean   @default(true)
}
```

Seeds ejecutados:
- `backend/prisma/seed-formatos-tel.ts` — 4 formatos cargados:
  - WhatsApp Internacional AR: `549{numero}`
  - Nacional con 0: `0{numero}`
  - Solo número: `{numero}`
  - Internacional +54: `+549{numero}`

### Frontend — `frontend/src/pages/reportes/`

4 páginas nuevas:

**`ReportesHome.tsx`**
- Cards de plantillas con chips de tipo/formato
- Botones: Ejecutar → `/reportes/:id/ejecutar`, Editar → `/reportes/:id/editar`, Eliminar con confirm Dialog
- FAB "Nueva Plantilla" → `/reportes/nueva`

**`ReportesWizard.tsx`**
- Stepper de 4 pasos (crear y editar según param `:id`)
- Paso 1: nombre, descripción, tipo (base/informe), fuente (deudores), empresa (Autocomplete — null=global)
- Paso 2: filtros con Switch activo/inactivo + toggle Fijo/Variable por filtro. Filtros: empresas multi-select, situación desde/hasta + exclusiones, gestión desde/hasta, monto desde/hasta + exclusión, soloConTel, soloConEmail
- Paso 3: columnas con checkboxes (desde `/reportes/columnas-disponibles?fuente=deudores`)
- Paso 4: formatoSalida (xlsx/csv/pdf), opcionesExcel (headerColor, freezeRow), opcionesPdf (landscape), formatoTel (Autocomplete + crear nuevo inline)

**`ReportesEjecutar.tsx`**
- Carga plantilla por `:id`, muestra resumen
- Si tiene `filtrosVars`: muestra inputs para cada filtro variable
- Botón "Generar y Descargar" → POST `/reportes/ejecutar` → blob → descarga

**`ReportesEstadisticas.tsx`**
- Filtros: empresa (Autocomplete) + período desde/hasta (type="month")
- Botón "Generar" (carga solo al hacer click)
- KPIs: Total Deudores, Monto Total (ARS)
- PieChart (recharts) — distribución por situación
- BarChart (recharts) — distribución por gestión

Rutas agregadas en `AppRoutes.tsx`:
```tsx
<Route path="reportes" element={<ReportesHome />} />
<Route path="reportes/nueva" element={<ReportesWizard />} />
<Route path="reportes/:id/editar" element={<ReportesWizard />} />
<Route path="reportes/:id/ejecutar" element={<ReportesEjecutar />} />
<Route path="reportes/estadisticas" element={<ReportesEstadisticas />} />
```

Sidebar: nueva sección colapsable "Reportes" con "Mis Plantillas" y "Estadísticas".

---

## [2026-04-12] — Normalización de códigos CRM + mejoras de parametros + motivoNoPago

### Análisis y curación de códigos

Se analizaron los archivos en `/varios/` (ue1.xls, cod_situacion.xlsx, cod_gestion.xlsx, motnopago.xlsx).
Se descartaron los 717 códigos legacy (uppercase, abreviados, sin estructura) y se crearon 70 códigos curados:

- **36 GES-** (gestión): grupos CONTACTO, SIN_CONTACTO, DATO_INCORRECTO, PROMESA, PAGO, CONVENIO, NEGATIVA, RECLAMO, DERIVACION, ADMIN
- **19 SIT-** (situación): grupos AL_DIA, MORA_TEMPRANA, MORA_MEDIA, MORA_AVANZADA, JUDICIAL, ESPECIAL
- **15 MNP-** (motivo no pago): grupos ECONOMICO, DISPUTA, EXTERNO, ACTITUDINAL

Script: `backend/prisma/seed-codigos-curados.ts`
- Wipe completo: empresa_parametro → nullifica FKs en deudor → borra parametros
- Inserta 70 parametros
- Crea 1.680 asociaciones empresa_parametro (70 × 24 empresas, todas activas)

### Cambios en schema Prisma

```prisma
model parametro {
  // campos nuevos:
  categoria   String?
  esGlobal    Boolean  @default(true)
  activo      Boolean  @default(true)
  deudoresConEsteMotivoNoPago deudor[]  @relation("DeudorMotivoNoPago")
}

model empresa_parametro {
  // campos nuevos:
  nombreOverride  String?
  activo          Boolean  @default(true)
}

model deudor {
  // campo nuevo:
  motivoNoPagoId  Int?
  motivoNoPago    parametro? @relation("DeudorMotivoNoPago", fields: [motivoNoPagoId], references: [id])
  @@index([motivoNoPagoId])
}
```

### Backend — parametros mejorado

`parametros.service.ts`:
- `findAll()` acepta `activo?: boolean`
- `create()` / `update()` aceptan `categoria`, `esGlobal`, `activo`
- Nuevo `toggleActivo(id)`
- Nuevo `getGrupos()` via `prisma.groupBy`

`parametros.controller.ts`:
- `GET /parametros/grupos` declarado ANTES de `/:id` (crítico para NestJS routing)
- `PATCH /parametros/:id/activo` para toggle
- Query param `activo` pasado al service

`deudores.service.ts`:
- `findOne()` incluye `motivoNoPago: true`
- `update()` maneja `motivoNoPagoClave` → busca parametro por clave → setea `motivoNoPagoId`

`update-deudor.dto.ts`:
```typescript
export class UpdateDeudorDto {
  @IsOptional() estadoSituacionClave?: string;
  @IsOptional() estadoGestionClave?: string;
  @IsOptional() motivoNoPagoClave?: string;
}
```

### Frontend — FichaDeudor

- Tercer Select siempre visible para Motivo No Pago
- Fetch: `?grupo=motivo_no_pago&activo=true`
- Corregido: `?grupo=situacion` (antes era `estadoSituacion`), `?grupo=gestion` (antes `estadoGestion`)
- `handleGuardarEstados` incluye `motivoNoPagoClave`

### Frontend — AjustesParametros (reescritura completa)

Dos tabs:
1. **Catálogo de códigos**: árbol izquierdo (grupo→categoría con conteos), tabla derecha filtrable, Switch por fila, CRUD completo con Select para grupo y categoría dinámica
2. **Asignación por empresa**: Autocomplete con búsqueda para empresa, TextField para filtrar códigos, 3 columnas (una por grupo), checkboxes por código, marcar/desmarcar por categoría y por grupo, save detecta diffs y hace PATCH por parametro

### Limpieza

- Eliminada página duplicada "Asignaciones" del sidebar y rutas
- Eliminado `AjustesAsignaciones` de `AppRoutes.tsx`

---

## Estado actual de la DB

- **24 empresas** cargadas (nombres exactos del Excel legacy ue1.xls)
- **70 parametros** curados (GES-/SIT-/MNP-)
- **1.680 empresa_parametro** (todas las empresas tienen todos los códigos asignados y activos)
- **4 formato_telefono** cargados

## Decisiones de arquitectura tomadas

- **Sin parentesco entre códigos** (situación→gestión): el usuario puede elegir cualquier código asignado a la empresa sin restricción de jerarquía. Decisión definitiva.
- **Plantillas globales por defecto**: `empresaId` nullable en `plantilla_reporte`. Solo se bloquea a una empresa cuando se quiere customización específica.
- **`db push` siempre**: nunca usar `migrate dev` en este proyecto (drift histórico).
- **Formatos de teléfono configurables**: patron con placeholder `{numero}`, guardados en tabla `formato_telefono`.
- **Futuros módulos previstos**: call logs, SMS, WhatsApp, email — la arquitectura de reportes está diseñada para extenderse a estas fuentes.

## Qué falta / pendientes conocidos

- [ ] Probar el módulo de reportes end-to-end (ejecutar, descargar Excel/CSV/PDF)
- [ ] Ajustar columnas disponibles en `deudores.fuente.ts` según campos reales del modelo `deudor`
- [ ] Posible: agregar preview de datos (tabla paginada) en `ReportesEjecutar`
- [ ] Posible: estadísticas por período en `ReportesEstadisticas` (gráfico de línea temporal)
- [ ] Posible: módulo de convenios/planes de pago
- [ ] Posible: módulo de gestión telefónica (llamadas, SMS)
