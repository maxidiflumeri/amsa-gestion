# Reportes Dinámicos — Spec Integral

**Proyecto:** AMSA Gestión
**Módulo:** `reportes`
**Fecha:** 2026-05-08 · actualizado 2026-05-11
**Estado:** Implementado (Fases F0–F7)
**Base:** commit `8d276ed` (módulo informes/reportes/bases v1)

> **NOTA 2026-05-11 — Rename v2 → reportes.** El sufijo `v2` se eliminó de todo el código, DB y URLs (v2 es ahora la versión oficial y única). El módulo v1 se removió. Este documento conserva las referencias `v2` originales como histórico del diseño; mapeo: `plantilla_reporte_v2` → `plantilla_reporte`, `ejecucion_reporte_v2` → `ejecucion_reporte`, `RaizV2`/`ColumnaV2`/`FiltroV2`/`AgrupacionV2`/`TotalV2`/`PlantillaV2`/`EjecucionV2` → sin sufijo, archivos `*-v2.ts` → sin sufijo, ruta `/reportes/v2/*` → `/reportes/*`, permisos `reportes.v2.X` → `reportes.X`. Ver CHANGELOG 2026-05-11 para detalle.

---

## 1. Objetivo

Evolucionar el módulo actual de reportes a un **constructor dinámico, parametrizable y profesional** donde el usuario final pueda armar informes a medida tomando al deudor como raíz, navegar por cualquier tabla relacionada (contactos, pagos, convenios, comentarios, facturas, transacciones, parámetros, empresa, remesa, camposAdicionales), elegir estructura de salida (orden, agrupaciones, totales) y formato (xlsx/csv/txt/pdf) — todo sin escribir código.

**No-objetivos** (para acotar el alcance):
- No reemplazar herramientas de BI (Power BI, Metabase). El target es el usuario operativo de cobranzas.
- No SQL libre. Toda la dinámica pasa por el DSL controlado.
- No multi-fuente cruzada (joins arbitrarios). La raíz es siempre `deudor` (o un modelo top-level definido).

---

## 2. Decisiones arquitectónicas

| # | Decisión | Justificación |
|---|----------|---------------|
| D1 | **Coexistencia v1/v2**. Modelos nuevos `plantilla_reporte_v2` y `ejecucion_reporte_v2`. v1 sigue funcionando hasta deprecación a 6 meses. | No romper plantillas existentes; permite rollback y migración gradual. |
| D2 | **Catálogo de campos vía DMMF de Prisma**, con cache en memoria + capa de metadata manual (labels custom, ocultar campos técnicos, agregaciones permitidas). | Evita duplicar el schema; cualquier cambio en Prisma se refleja automáticamente. |
| D3 | **DSL de paths** tipo `pagos[sum].importe`, `contactos[tipo=email][first].valor`, `convenios[count]`. | Lenguaje compacto y expresivo para representar agregaciones, filtros y cardinalidad sin hardcodear. |
| D4 | **Ejecución híbrida sync/async**. Umbral configurable (default: 5.000 filas estimadas). Bajo umbral: sync; sobre umbral: BullMQ con notificación Socket.io. | UX rápida para reportes chicos, escalable para volúmenes grandes. |
| D5 | **QueryBuilder dinámico** que arma `findMany` de Prisma con `include` anidado a partir del DSL. Sin SQL crudo. | Aprovecha tipado y seguridad de Prisma; evita inyección. |
| D6 | **Frontend tipo Power BI**: Field Explorer (árbol) + Column Canvas (drag & drop) + Filter Builder + Preview en vivo. | UX familiar para usuarios; escala con cantidad de campos sin saturar. |
| D7 | **Plantillas globales o por empresa**, con `empresaId` nullable. | Permite reuso (plantilla "Cartera para Telecom" vs "Listado deudores morosos" global). |

---

## 3. Modelo de datos (Prisma)

### 3.1 Modelos nuevos

```prisma
model plantilla_reporte_v2 {
  id            Int                    @id @default(autoincrement())
  nombre        String
  descripcion   String?                @db.Text
  raiz          String                 @default("deudor")  // entidad raíz; futuro: "convenio", "remesa", etc.
  empresaId     Int?
  activo        Boolean                @default(true)

  // DSL completo de la plantilla (ver sección 4)
  definicion    Json                   // { columnas, filtros, ordenamientos, agrupaciones, totales }
  formatoSalida String                 // 'xlsx' | 'csv' | 'txt' | 'pdf'
  opcionesFormato Json?                // opciones específicas por formato

  // Metadata
  creadoPorId   Int?
  createdAt     DateTime               @default(now())
  updatedAt     DateTime               @updatedAt

  empresa       empresa?               @relation(fields: [empresaId], references: [id])
  creadoPor     usuario?               @relation("PlantillaV2CreadoPor", fields: [creadoPorId], references: [id])
  ejecuciones   ejecucion_reporte_v2[]

  @@index([empresaId])
  @@index([activo])
}

model ejecucion_reporte_v2 {
  id            Int                  @id @default(autoincrement())
  plantillaId   Int
  usuarioId     Int
  filtrosUsados Json
  totalFilas    Int?
  estado        String               @default("PENDIENTE")  // PENDIENTE|EJECUTANDO|FINALIZADA|FALLIDA
  modo          String               @default("SYNC")        // SYNC|ASYNC
  archivoPath   String?              // si ASYNC, ruta al archivo generado
  errorMsg      String?              @db.Text
  duracionMs    Int?
  createdAt     DateTime             @default(now())
  finishedAt    DateTime?

  plantilla     plantilla_reporte_v2 @relation(fields: [plantillaId], references: [id], onDelete: Cascade)
  usuario       usuario              @relation("EjecucionV2Usuario", fields: [usuarioId], references: [id])

  @@index([plantillaId])
  @@index([usuarioId, createdAt])
  @@index([estado])
}
```

### 3.2 Migración v1 → v2

- Endpoint `POST /reportes/plantillas/:id/migrar-v2`: lee una `plantilla_reporte` v1, mapea a la estructura v2 y crea registro nuevo. Marca la v1 como `migradaV2: true` (campo a agregar en v1).
- Migración mecánica: las columnas tipo `{campo, label}` pasan a paths simples; los filtros hardcoded del wizard v1 se mapean al formato v2.
- Plantillas v1 siguen ejecutables hasta el día de deprecación.

### 3.3 Índices a agregar (performance)

- `deudor`: ya tiene `documento`, `empresaId+remesaId`. Agregar índice por `montoTotal` si se usa rangos frecuentes.
- `pago.deudorId`, `convenio.deudorId`, `factura.deudorId`, `comentario.deudorId` ya existen.

---

## 4. DSL de definición de plantilla

La columna `definicion` es un JSON con la siguiente estructura:

```typescript
type DefinicionPlantilla = {
  columnas: Columna[]
  filtros: Filtro[]
  ordenamientos: Ordenamiento[]
  agrupaciones?: Agrupacion[]
  totales?: Total[]
  cardinalidadDefault: 'expandir' | 'concatenar' | 'primero' | 'ultimo'  // qué hacer por defecto con relaciones 1-N
  limiteFilas?: number
}

type Columna = {
  id: string                  // uuid generado por UI, estable para reordenar
  path: string                // DSL — ver 4.1
  label: string               // nombre custom de la columna en la salida
  tipo?: 'texto'|'numero'|'fecha'|'boolean'|'moneda'  // override del tipo inferido
  formato?: string            // ej: 'DD/MM/YYYY', '$#,##0.00'
  ancho?: number              // px o caracteres
  cardinalidad?: 'expandir'|'concatenar'|'primero'|'ultimo'  // override por columna
  separadorConcat?: string    // si cardinalidad=concatenar (default ', ')
}

type Filtro = {
  id: string
  path: string                // mismo DSL que columnas
  operador: 'eq'|'neq'|'in'|'notIn'|'contains'|'startsWith'|'endsWith'|
            'gt'|'gte'|'lt'|'lte'|'between'|'isNull'|'isNotNull'|'rangoClaves'
  valor?: any                 // si fijo
  variable?: boolean          // si true, se pide al ejecutar
  labelVariable?: string      // label que ve el usuario al ejecutar
  valorPorDefecto?: any
}

type Ordenamiento = { path: string; direccion: 'asc'|'desc' }

type Agrupacion = {
  path: string                // ej: 'empresa.nombre' agrupa por empresa
  mostrarSubtotales?: boolean
  saltoPagina?: boolean       // pdf: nueva página por grupo
}

type Total = {
  path: string                // sobre qué columna se calcula
  funcion: 'sum'|'avg'|'count'|'min'|'max'
  label?: string
}
```

### 4.1 Gramática del path

Un **path** identifica un campo navegable desde la raíz. Sintaxis:

```
path        ::= segment ('.' segment)*
segment     ::= name modifier*
modifier    ::= '[' selector ']'
selector    ::= aggregator | filter | indexer
aggregator  ::= 'sum'|'avg'|'count'|'min'|'max'|'first'|'last'|'concat'
filter      ::= field '=' value (',' field '=' value)*
indexer     ::= integer
name        ::= identificador del modelo, relación o campo escalar
```

**Ejemplos:**

| Path | Significado |
|------|-------------|
| `documento` | Campo escalar de la raíz |
| `empresa.nombre` | Relación 1-1 → escalar |
| `estadoSituacion.descripcion` | Relación opcional → escalar |
| `pagos[sum].importe` | Suma de `importe` sobre todos los pagos del deudor |
| `pagos[count]` | Cantidad de pagos |
| `pagos[last].fecha` | Fecha del último pago (último por orden DB o por campo `fecha`) |
| `convenios[estado=ACTIVO][count]` | Cantidad de convenios activos |
| `contactos[tipo=email].valor` | Lista de emails (con cardinalidad: expandir/concatenar/primero) |
| `contactos[tipo=telefono][first].valor` | Primer teléfono |
| `comentarios[last].texto` | Último comentario |
| `camposAdicionales.cuotas_vencidas` | Acceso a JSON `camposAdicionales` |
| `convenios[estado=ACTIVO].cuotas[estado=PENDIENTE][count]` | Cuotas pendientes en convenios activos |

### 4.2 Tabla de agregadores y tipos compatibles

| Agregador | Aplica a relación | Tipo destino | Notas |
|-----------|-------------------|--------------|-------|
| `sum`, `avg`, `min`, `max` | 1-N | número | sólo campos numéricos del hijo |
| `count` | 1-N | número | no requiere campo escalar (`pagos[count]`) |
| `first`, `last` | 1-N | objeto | luego se navega `.campo` |
| `concat` | 1-N | texto | concatena con separador |

### 4.3 Columnas fijas (sin path)

Una columna **sin `path`** no sale de los datos: imprime su `valorFijo` en todas las filas, o vacío
si no se declara ninguno. El marcador es el path vacío y no una bandera aparte —una columna o sale
de un path o es fija—, así que el estado imposible de las dos cosas a la vez no existe.

```json
{ "id": "…", "path": "", "label": "telefono2", "valorFijo": "" }
```

Existen porque los archivos que consumen otros sistemas tienen una estructura de columnas **cerrada**
y hay que respetarla aunque no haya dato para todas: la base predictiva de Neotel espera ocho
columnas de teléfono, y si el caso tiene uno solo las otras siete tienen que estar igual, vacías.
Sin esto la única salida era mapear siete veces el mismo campo para ocupar el lugar, que devuelve el
dato repetido en vez de una columna vacía.

Con un `valorFijo` cargado sirven además para las constantes que pide el destino (un id de campaña,
un código de origen) sin tener que inventar un campo en el modelo.

No parsean path, no aportan `include` ni post-procesamiento, y **nunca expanden**: aunque la
plantilla tenga `cardinalidadDefault: 'expandir'`, una columna fija no sale de una relación y no hay
nada que multiplicar. En el builder se agregan con **Columna fija** y su panel muestra solo etiqueta
y valor.

### 4.4 Formatos de teléfono (`tipo: 'telefono'`)

Una columna de tipo teléfono puede apuntar a un **formato** del catálogo (`formato_telefono`), cuyo
`patron` se aplica sobre las partes del número. Los contactos se guardan en E.164
(`+5491163525026`) y todos los placeholders trabajan sobre el **número nacional significativo**: sin
el `+54` del país y **sin el `9` que marca móvil**, que no es parte del número.

| Placeholder | | Sobre `+5491163525026` |
|---|---|---|
| `{numero}` | característica + abonado (10 dígitos) | `1163525026` |
| `{area}` | solo la característica | `11` |
| `{abonado}` | solo el abonado | `63525026` |
| `{15}` | el `15` local **si la línea es móvil**, vacío si es fija | `15` |

Catálogo actual (`prisma/seed-formatos-tel.ts`):

| Nombre | Patrón | Celular | Fijo |
|---|---|---|---|
| WhatsApp Internacional AR | `549{numero}` | `5491163525026` | `5491142407390` |
| Nacional con 0 | `0{numero}` | `01163525026` | `01142407390` |
| Solo número | `{numero}` | `1163525026` | `1142407390` |
| Internacional +54 | `+549{numero}` | `+5491163525026` | `+5491142407390` |
| Local con 15 | `0{area}{15}{abonado}` | `0111563525026` | `01142407390` |

La característica **no se puede partir por longitud fija**: ocupa 2, 3 o 4 dígitos según la zona
(Bariloche es `294` con abonado de 7, no `2944` con 6). Se resuelve con `codigoAreaDe` de
`common/utils/phone-utils`, contra la tabla de ENACOM. Si no se puede determinar, `{area}` queda
vacía y `{abonado}` se lleva el número entero, así que `0{area}{15}{abonado}` degrada a `0{numero}`:
un número marcable, aunque no en el formato pedido.

Para el `{15}` se consultan dos señales, porque ninguna alcanza sola: el `9` del E.164 lo declara
explícito, pero hay celulares guardados sin él (`+541155775452`) que solo delatan los rangos de
ENACOM, y hay números con el `9` que ENACOM no tiene en ningún rango. Sin ninguna de las dos, se
asume fija: meterle un `15` a un fijo lo vuelve inmarcable.

Salvo `{15}`, el patrón se aplica tal cual, sin mirar el tipo de línea: un `549{numero}` sobre un
fijo devuelve un número con el 9 de móvil. Es responsabilidad de quien arma la plantilla.

**No hay pantalla de ABM de formatos.** El selector del builder lista lo que haya en la tabla; para
agregar uno hay que tocar la API (`reportes.service.ts`) o la base.

---

## 5. Catálogo de campos

### 5.1 Endpoint

`GET /reportes/v2/catalogo?raiz=deudor`

Devuelve un árbol jerárquico con todos los campos navegables desde la raíz, hasta `N` niveles de profundidad (default: 3).

### 5.2 Estructura

```typescript
type NodoCatalogo = {
  path: string               // path absoluto desde raíz
  nombre: string             // nombre técnico (campo o relación)
  label: string              // label human-readable (configurable)
  tipo: 'escalar'|'relacion-1-1'|'relacion-1-n'|'json'
  tipoEscalar?: 'texto'|'numero'|'fecha'|'boolean'|'enum'
  enumValues?: string[]
  cardinalidad?: '1-1'|'1-N'|'opcional'
  agregadoresPermitidos?: string[]   // ['sum','count','last',...] cuando tipo=relacion-1-n
  filtrosPermitidos?: string[]       // operadores válidos
  hijos?: NodoCatalogo[]
  oculto?: boolean           // campos técnicos que no deberían exponerse (id, createdAt internos)
}
```

### 5.3 Construcción

1. Leer `Prisma.dmmf.datamodel.models`.
2. Resolver relaciones recursivamente hasta `MAX_DEPTH` (default 3).
3. Aplicar **metadata manual** desde un archivo `backend/src/modules/reportes/v2/catalogo/metadata.ts`:
   - Labels custom: `deudor.documento → "DNI / Documento"`.
   - Ocultar campos técnicos: `id`, `createdAt`, `updatedAt`, FKs.
   - Sobreescribir agregadores: por ejemplo `comentarios[last].texto` debería ser legible.
4. Cache en memoria con TTL 1h (invalida en hot-reload o vía endpoint admin).
5. Adicional: campos del JSON `camposAdicionales` se obtienen vía query separada (ya existe `getCamposExtra`) y se inyectan como nodos hijos virtuales.

---

## 6. Motor de ejecución

### 6.1 Pipeline

```
Plantilla + Variables
    ↓
Parser DSL  ─────────────►  AST de paths/filtros
    ↓
Planner     ─────────────►  Plan de query (where + include + post-procesos)
    ↓
QueryBuilder Prisma  ────►  findMany con include anidado
    ↓
Resolver de paths  ──────►  por cada fila, resuelve cada path → valor
    ↓
Aplicador cardinalidad ──►  expande/concatena/agrega filas según config
    ↓
Aplicador formato  ──────►  fechas, números, monedas
    ↓
Filas planas (Record<string, any>[])
    ↓
Exportador (xlsx|csv|pdf)
```

### 6.2 Componentes nuevos

```
backend/src/modules/reportes/v2/
├── reportes-v2.module.ts
├── reportes-v2.controller.ts
├── reportes-v2.service.ts
├── catalogo/
│   ├── catalogo.service.ts            # construye árbol DMMF + metadata
│   └── metadata.ts                    # labels, ocultos, overrides
├── parser/
│   ├── path-parser.ts                 # tokeniza y parsea el DSL
│   └── path-ast.ts                    # tipos del AST
├── planner/
│   ├── query-planner.ts               # decide where/include/post-procesos
│   └── include-builder.ts              # arma include anidado de Prisma
├── executor/
│   ├── executor.service.ts            # orquesta todo el pipeline
│   ├── path-resolver.ts               # resuelve un path sobre una fila
│   ├── aggregator.ts                  # sum/avg/count/last/first/concat
│   ├── cardinality.ts                  # expandir/concatenar/primero/ultimo
│   └── formatter.ts                    # fechas, números, moneda
├── exportadores/
│   ├── xlsx-v2.exportador.ts          # con agrupaciones/subtotales/branding
│   ├── csv-v2.exportador.ts
│   ├── pdf-v2.exportador.ts           # con saltos por grupo, header empresa
│   └── txt-v2.exportador.ts
├── async/
│   ├── reportes.processor.ts          # BullMQ worker
│   └── reportes.queue.ts
└── dto/
    ├── plantilla-v2.dto.ts
    ├── ejecutar-v2.dto.ts
    └── catalogo.dto.ts
```

### 6.3 Sync vs Async

- **Estimación previa**: antes de ejecutar, se hace un `count` con el `where` armado.
- **Si `count <= UMBRAL` (5.000)**: ejecución sync, devuelve buffer en la respuesta HTTP.
- **Si `count > UMBRAL`**: encola job en BullMQ, devuelve `{ ejecucionId, estado: 'PENDIENTE' }`. El worker:
  1. Marca ejecución como `EJECUTANDO`.
  2. Ejecuta el pipeline en streams de 1.000 filas (cursor de Prisma).
  3. Escribe archivo en `storage/reportes/{ejecucionId}.{ext}`.
  4. Marca como `FINALIZADA`, emite evento Socket.io a `usuarioId`.
- **Endpoint de descarga**: `GET /reportes/v2/ejecuciones/:id/descargar` (auth).

### 6.4 Performance

- `take` máximo en preview: 100 filas.
- Streaming en async para no cargar todo en memoria.
- Cache de catálogo y de plantillas frecuentes.
- Índices Prisma revisados (sección 3.3).

---

## 7. Filtros dinámicos

### 7.1 Operadores por tipo

| Tipo | Operadores |
|------|------------|
| texto | eq, neq, contains, startsWith, endsWith, in, notIn, isNull, isNotNull |
| número | eq, neq, gt, gte, lt, lte, between, in, notIn, isNull, isNotNull |
| fecha | eq, gt, gte, lt, lte, between, isNull, isNotNull, relativo (últimos N días) |
| boolean | eq, isNull, isNotNull |
| enum / parámetro | eq, in, notIn, rangoClaves (rango alfabético desde-hasta + excluir) |

### 7.2 Variables

Cualquier filtro puede marcarse `variable: true`. Al ejecutar la plantilla, el frontend renderiza un form con los filtros variables y sus operadores. Los valores se mandan en `body.filtrosVars`.

### 7.3 Agrupación de condiciones

V2 inicial: AND implícito entre todos los filtros. **No** se incluye OR / paréntesis (se deja para v2.1 si hace falta).

---

## 8. Frontend

### 8.1 Pantallas

```
/reportes                        — Home (lista de plantillas v1 + v2 unificadas con badge de versión)
/reportes/v2/nuevo               — Builder
/reportes/v2/:id/editar          — Builder en modo edición
/reportes/v2/:id/ejecutar        — Form de variables + ejecución
/reportes/v2/ejecuciones         — Historial de ejecuciones del usuario
```

### 8.2 Builder (3 paneles)

```
┌──────────────────────────────────────────────────────────────┐
│  Header: Nombre / Descripción / Empresa / Formato salida     │
├─────────────┬──────────────────────────────┬─────────────────┤
│             │                              │                 │
│  Field      │  Column Canvas               │  Properties     │
│  Explorer   │  (drag & drop)               │  Panel          │
│  (árbol)    │                              │  (config        │
│             │  ┌─ Documento  ──────────┐   │   columna       │
│  Buscador   │  ┌─ Nombre + Apellido ──┐   │   seleccionada) │
│  ▸ Deudor   │  ┌─ Empresa.nombre ─────┐   │                 │
│  ▸ Empresa  │  ┌─ Pagos[sum].importe ─┐   │                 │
│  ▾ Pagos    │  ┌─ Convenios[count] ───┐   │                 │
│    fecha    │  └────────────────────────┘   │                 │
│    importe  │                              │                 │
│  ▸ Convenios│  Filtros (chips arrastrables)│                 │
│  ▸ Contactos│  ┌ Empresa = Telecom ─ x ┐   │                 │
│  ...        │  ┌ Variable: vencimiento ┐   │                 │
│             │                              │                 │
│             │  Agrupaciones / Totales      │                 │
│             │                              │                 │
└─────────────┴──────────────────────────────┴─────────────────┘
              │  Preview (toggle)            │
              └──────────────────────────────┘
```

**Field Explorer**: árbol con `react-arborist` o `@mui/x-tree-view`. Búsqueda con debounce, expansión lazy. Drag a Canvas o doble click para sumar como columna.

**Column Canvas**: lista ordenable con `@dnd-kit/sortable`. Cada chip muestra label + tipo + ícono de cardinalidad. Click abre Properties.

**Filter Builder**: chips compactos. Click "+" abre selector de path → operador → valor. Variables tienen ícono distintivo.

**Preview**: panel inferior colapsable. Botón "Refrescar preview" → llama `/reportes/v2/preview` con la plantilla actual (no requiere guardar). Muestra primeras 50 filas en tabla.

### 8.3 Librerías a sumar

| Librería | Uso | Justificación |
|----------|-----|---------------|
| `@dnd-kit/core` + `@dnd-kit/sortable` | Drag & drop columnas, filtros | **DECIDIDO**. Mantenido, accesible, ligero. Estándar actual. |
| `@mui/x-tree-view` | Field Explorer | **DECIDIDO**. Consistencia con MUI, sin sumar tema, soporta búsqueda y lazy. |
| `react-virtuoso` | Tabla de preview con muchas columnas | Render virtual para 30+ columnas. |

### 8.4 Formularios de ejecución

Para plantillas con filtros variables: pantalla auto-generada que renderiza un input por cada filtro variable, con el operador y validación apropiados.

---

## 9. Exportadores v2

### 9.1 Excel (xlsx) v2

- Usar `exceljs` (ya está).
- **Header con branding**: logo de empresa (si existe), nombre del reporte, fecha de generación, filtros aplicados.
- **Agrupaciones**: filas separadoras con label de grupo, subtotales si están definidos.
- **Totales generales**: fila final.
- **Formato condicional opcional**: ej. resaltar montos > X.
- Congelar primera fila + filas de agrupación.
- Auto-ancho de columnas (con tope).

### 9.2 PDF v2

- **DECIDIDO: `pdfmake`** (ya instalado, 0.3.7).
- Templates declarativos en JSON (serializables, futuro: editor visual de templates).
- **Branding por empresa**: logo, colores, footer configurables en `empresa.configuracion.reportes`.
- **Saltos de página por grupo** (via `pageBreak: 'before'`).
- **Subtotales y total** con estilos destacados.
- **Header/footer repetidos** en cada página (vía `header`/`footer` callbacks).
- Trade-off aceptado: layouts muy complejos no son tan flexibles como puppeteer/HTML, pero alcanza con margen para los reportes target. Cero overhead de Chromium en deploy.

### 9.3 CSV / TXT v2

- Separador configurable (coma, punto y coma, pipe, tab).
- BOM UTF-8 opcional para Excel.
- Quoting RFC 4180.

### 9.4 Opciones unificadas

```typescript
type OpcionesFormato = {
  xlsx?: { headerColor, freezeRow, autoWidth, brandingEmpresa, formatoCondicional }
  pdf?: { landscape, templateId, header, footer, brandingEmpresa }
  csv?: { separador, encoding, bom, quoting }
  txt?: { separador, anchoFijo, encoding }
}
```

---

## 10. Contratos de API (v2)

### 10.1 Catálogo

```
GET  /reportes/v2/catalogo?raiz=deudor&depth=3
     → NodoCatalogo (árbol)
GET  /reportes/v2/catalogo/campos-extra?empresaId=N
     → string[]  (claves de camposAdicionales)
```

### 10.2 Plantillas

```
GET    /reportes/v2/plantillas?empresaId=N
POST   /reportes/v2/plantillas
GET    /reportes/v2/plantillas/:id
PATCH  /reportes/v2/plantillas/:id
DELETE /reportes/v2/plantillas/:id        (soft delete)
POST   /reportes/v2/plantillas/:id/duplicar
```

### 10.3 Preview y ejecución

```
POST /reportes/v2/preview                  body: { definicion, filtrosVars, raiz }
     → { columnas, filas, total, modo: 'sync' }

POST /reportes/v2/plantillas/:id/ejecutar  body: { filtrosVars }
     → SYNC:  archivo binario (Content-Disposition)
     → ASYNC: { ejecucionId, estado: 'PENDIENTE' }

GET  /reportes/v2/ejecuciones?usuarioId=X
GET  /reportes/v2/ejecuciones/:id
GET  /reportes/v2/ejecuciones/:id/descargar
```

### 10.4 Migración

```
POST /reportes/v2/migrar/:idV1   → crea v2 a partir de v1
```

### 10.5 Eventos Socket.io

```
'reporte:ejecucion:progreso'  { ejecucionId, progreso, totalFilas }
'reporte:ejecucion:finalizada' { ejecucionId, urlDescarga }
'reporte:ejecucion:fallida'    { ejecucionId, error }
```

### 10.6 Exposición a AMSA Sender

Si en algún momento Sender necesita generar reportes (ver `project_integration.md`), exponer en el módulo `internal-api` (con guard `X-Internal-Api-Key`):

```
POST /api/internal/reportes/ejecutar  body: { plantillaId, filtrosVars }
     → mismo comportamiento sync/async
```

---

## 11. Fases de implementación

### Fase 1 — Fundación backend (2-3 sem)
**Entregables:**
- Schema v2 + migration.
- Módulo `reportes/v2/` con scaffolding.
- `CatalogoService` con DMMF + metadata + cache.
- `PathParser` con AST.
- `QueryPlanner` y `IncludeBuilder` (sin agregaciones todavía).
- `Executor` para paths simples (escalar y relación 1-1).
- Endpoints: `GET /catalogo`, CRUD de plantillas v2.
- Tests unitarios del parser y resolver.

**Criterio de aceptación:** Crear plantilla v2 con columnas tipo `documento`, `empresa.nombre`, `estadoSituacion.descripcion` y ejecutarla en formato xlsx funcional.

### Fase 2 — Agregaciones, filtros y cardinalidad (2 sem)
**Entregables:**
- Aggregator (`sum`, `count`, `avg`, `min`, `max`, `first`, `last`, `concat`).
- Aplicador de cardinalidad (expandir/concatenar/primero/último).
- Filtros con todos los operadores; soporte de `variable: true`.
- Filtros sobre paths con relaciones (ej. `pagos[fecha>2026-01-01]`).
- Endpoint `POST /preview`.

**Criterio de aceptación:** Plantilla con `pagos[sum].importe`, `convenios[estado=ACTIVO][count]`, `contactos[tipo=email][first].valor` ejecuta y devuelve resultados correctos. Preview funciona en <2s para 100 filas.

### Fase 3 — Frontend builder core (2-3 sem)
**Entregables:**
- Páginas v2 (`/reportes/v2/nuevo`, `/editar/:id`).
- Field Explorer (árbol + búsqueda).
- Column Canvas con drag & drop (`@dnd-kit`).
- Properties panel (label, formato, cardinalidad, ancho).
- Header con nombre/descripción/empresa/formato.
- Guardar/editar/duplicar plantilla v2.

**Criterio de aceptación:** Usuario puede armar una plantilla con 10+ columnas (incluyendo agregadas) sin escribir código y guardarla.

### Fase 4 — Filtros UI + preview en vivo (2 sem)
**Entregables:**
- Filter Builder (chips, selector de operador, valores).
- Marcar filtros como variables.
- Preview en vivo con debounce (refresca al cambiar definición).
- Form de ejecución con filtros variables.
- Validación de plantilla (paths inválidos, columnas duplicadas).

**Criterio de aceptación:** Usuario puede agregar filtros (fijos y variables), preview se actualiza en <2s, ejecuta plantilla y descarga xlsx.

### Fase 5 — Exportadores v2 + agrupaciones/totales (1-2 sem)
**Entregables:**
- xlsx v2 con branding, agrupaciones, subtotales, totales.
- pdf v2 con `pdfmake`, templates JSON declarativos, saltos por grupo.
- csv/txt v2 con opciones completas.
- UI de agrupaciones y totales en el builder.

**Criterio de aceptación:** Reporte con agrupación por empresa y subtotales de monto en xlsx + pdf se ve profesional.

### Fase 6 — Async + BullMQ (2 sem)
**Entregables:**
- Queue `reportes-v2`.
- `ReportesProcessor` con streaming via cursor.
- Estimador de filas previo a ejecutar.
- Endpoint de ejecuciones e historial.
- Notificaciones Socket.io.
- Storage de archivos (`storage/reportes/`).
- Cron de limpieza de archivos > 7 días.

**Criterio de aceptación:** Reporte de 50.000 filas se ejecuta en background, usuario recibe notificación, descarga funciona.

### Fase 7 — Polish, migración e integración (1-2 sem)
**Entregables:**
- Endpoint de migración v1 → v2.
- Tests e2e (Playwright o equivalente) del builder y ejecución.
- Documentación de usuario (en-app tooltips + página de ayuda).
- Endpoint interno para AMSA Sender.
- Monitoreo: métricas de ejecuciones (Winston).
- Ajustes finales de UX según feedback.

**Criterio de aceptación:** Plantillas v1 migradas funcionan en v2; doc de usuario lista; integración Sender testeada.

---

## 12. Tests críticos

### Backend
- **Path parser**: 30+ casos (paths válidos e inválidos, todos los modificadores).
- **Path resolver**: para cada combinación tipo × cardinalidad × agregador.
- **Query planner**: que genere `include` correcto para paths anidados.
- **Aggregator**: cada función con datos vacíos, nulls, edge cases.
- **Filtros**: cada operador genera el `where` Prisma correcto.
- **Executor e2e**: para 5 plantillas representativas, comparar output esperado.
- **Exportadores**: verificar buffers de salida (snapshot de xlsx parseado).

### Frontend
- **Builder**: drag & drop funciona, reorden estable, undo/redo (opcional).
- **Preview**: refresh con debounce, manejo de errores.
- **E2E**: armar plantilla + guardar + ejecutar + descargar.

---

## 13. Riesgos y trade-offs

| Riesgo | Severidad | Mitigación |
|--------|-----------|------------|
| Explosión combinatoria al expandir múltiples relaciones 1-N | Alta | Default cardinalidad: `concatenar`. Warning en UI si dos columnas son `expandir`. Límite de filas en preview. |
| Queries lentas con includes profundos | Alta | Catálogo limitado a depth 3. Estimación de filas previa. Ejecución async sobre umbral. Índices revisados. |
| DSL complejo confunde al usuario | Media | Toda la complejidad detrás de UI; el usuario nunca escribe paths manualmente. |
| Mantenimiento dual v1/v2 | Media | Deprecación a 6 meses. Migración asistida. |
| Layouts PDF muy complejos no se cubren con `pdfmake` | Baja | Aceptado. Cubre reportes target con holgura. Si hace falta layout exótico, generar como xlsx. |
| Cambios en schema Prisma rompen plantillas (paths obsoletos) | Media | Validación al cargar plantilla: marcar paths inválidos, permitir editar. |
| BullMQ ya está en Sender pero no en Gestión | Media | Verificar si hay infra Redis disponible. Si no, async se posterga a fase posterior. |

### Trade-offs irreversibles
- **DSL como string vs JSON estructurado**: elegimos string compacto (`pagos[sum].importe`). Cambiarlo después es costoso. La alternativa (estructura JSON anidada por cada path) es más verbosa pero más fácil de validar. Decidido por concisión y por experiencia previa con DSLs similares (Looker LookML, Metabase).
- **Raíz fija (`deudor`)**: se puede ampliar a otras raíces en el futuro (`convenio`, `remesa`) sin cambios estructurales, pero los catálogos por raíz hay que diseñarlos.
- **No OR / paréntesis en filtros**: limita casos de uso. Si emerge la necesidad, se agrega en v2.1 con cambio menor en estructura de filtros (de array a árbol).

---

## 14. Métricas de éxito

- **Tiempo medio de armar plantilla**: <5 min para reportes con 10 columnas.
- **Performance preview**: <2s para 100 filas.
- **Performance ejecución sync**: <10s para 5.000 filas.
- **Adopción**: 80% de plantillas nuevas en v2 a 3 meses.
- **Errores en ejecución**: <1% del total.

---

## 15. Próximos pasos

1. ✅ **Plan aprobado** (2026-05-08).
2. ✅ **BullMQ/Redis**: confirmado, ya disponible en backend (`@nestjs/bullmq@11.0.4`, `bullmq@5.70.4`, processors en `modules/imports/`).
3. ✅ **Field Explorer**: `@mui/x-tree-view`.
4. ✅ **Motor PDF**: `pdfmake` (ya instalado en `backend/package.json`).
5. ✅ **DnD**: `@dnd-kit/core` + `@dnd-kit/sortable`.
6. **Arrancar Fase 1** con el agente implementer.

### Pendientes detectados en uso (2026-08-19)

- **El path no se puede escribir a mano en el builder.** El motor soporta índices y agregadores
  (`contactos[tipo=telefono][1].valor`, `pagos[sum].importe`) —está parseado, resuelto y testeado—
  pero en el `PropertiesPanel` el path es un campo deshabilitado que solo se llena desde el árbol
  del catálogo. Sin eso no se puede armar una base con "el 1º, 2º, 3º… teléfono en su columna": los
  ocho apuntan al mismo path y devuelven lo mismo. Habilitar el campo (con validación contra el
  parser) o dar un selector de índice para las relaciones 1-N.
- **No hay ABM de formatos de teléfono** (§4.4).

---

**Apéndices** (no incluidos en este draft, generables a demanda):
- A. Ejemplo completo de plantilla v2 en JSON.
- B. Mockups detallados de UI (Figma o similar).
- C. Comparativa de librerías de tree/dnd evaluadas.
- D. Plan de pruebas detallado por fase.
