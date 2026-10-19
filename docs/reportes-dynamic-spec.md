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
            'gt'|'gte'|'lt'|'lte'|'between'|'notBetween'|'isNull'|'isNotNull'   // ver §16: rangoClaves nunca se implementó
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

El árbol sale del **DMMF de Prisma**, no de una lista escrita a mano: cualquier campo nuevo del
schema aparece solo. El precio es que aparece *todo*, y sin poda el catálogo llegó a **388 campos
elegibles** desde `deudor`, con entradas como `estadoGestion.llamadas.ringedAt` —todas las llamadas
del sistema que comparten el estado de gestión de este deudor—. Las reglas que lo bajan a ~110:

| Regla | Dónde se declara | Qué saca |
|---|---|---|
| Una colección detrás de una relación 1-1 no es un dato del caso | estructural | `estadoGestion.llamadas`, `empresa.remesa`, `motivoNoPago.promesasComoAnterior` (152 campos) |
| Las claves foráneas no van a un reporte: el dato está en la relación | estructural (`/Id$/`), con excepciones en `FKS_VISIBLES` | `estadoGestionPrevioAId`, `subcategoriaId`, `campañaId` |
| De un modelo de referencia solo interesan dos o tres campos | `CAMPOS_VISIBLES_POR_MODELO` | los 8 campos de `parametro` × 4 relaciones, los 7 de `usuario` × 6 |
| Ramas duplicadas o técnicas | `RELACIONES_OCULTAS` | `remesa.empresa`, `contactos.llamadas`, `llamadas.sesion` |
| Ruido de una tabla puntual | `CAMPOS_OCULTOS_POR_PATH` | `remesa.okFilas`, `llamadas.recordingUrl` |
| Modelos administrativos | `MODELOS_OCULTOS` | `jobimport`, `plantilla_reporte` |

Las colecciones colgadas de otra colección **sí** se conservan (`convenios.cuotas`,
`facturas`): esas siguen hablando del caso.

Cada nodo lleva además `label` (`LABELS_CUSTOM`, por path) y `descripcion` (`DESCRIPCIONES`, una
línea de hasta diez palabras). La descripción es opcional a propósito: los campos que se entienden
por el nombre no la llevan, porque una explicación obvia al lado de cada campo es más ruido. Las
ramas de primer nivel se ordenan por `ORDEN_RAMAS`, que sigue cómo se arma un reporte —quién es el
caso, de quién es, cuánto debe, cómo viene la gestión, el historial— y no el orden del schema; lo
que no esté en la lista queda al final, alfabético.

A veces el id **es** el dato —el sistema que consume el archivo lo pide con el número y no hay campo
de texto que lo reemplace—: para eso está `FKS_VISIBLES`, la lista de claves foráneas que sí se
ofrecen. Hoy tiene `remesa.politicaId`, que va en la base de Neotel.

La poda es de **catálogo**, no de motor: un path que ya no se ofrece sigue resolviéndose si está
guardado en una plantilla vieja.

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
| enum / parámetro | eq, in, notIn (`rangoClaves` se descartó: ver §16) |

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

`plantilla.opcionesFormato` guarda las opciones **por formato**, no sueltas:

```json
{ "txt": { "separador": ";", "incluirHeader": false }, "csv": { "separador": "," } }
```

Así, cambiar el formato de salida de TXT a CSV y volver no pierde lo que había configurado en el
otro. Cada exportador recibe **solo su sub-objeto**, con `opcionesDelFormato(opciones, formato)`:
pasarle el envoltorio entero hace que busque `separador` en la raíz, no lo encuentre y use el
default, ignorando en silencio todo lo configurado.

El **separador** de TXT y CSV es un `string` libre, no una lista cerrada: cada sistema destino pide
el suyo. El builder ofrece tab, `;`, `,`, `|` y espacio, más un campo para escribir otro. Default:
tab en TXT, coma en CSV.

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

---

## 16. Validaciones del motor (2026-10-19)

Antes de la Fase B del asistente (`asistente-reportes-spec.md` §0.8, §0.13, §11.5, §19) se cerraron
seis fallas **silenciosas**: el reporte salía mal y sin ningún error. Ahora todas son un `400`
(`BadRequestException`, log `warn`, nunca `error`) con el motivo en castellano.

### 16.1 Dónde se valida

`validador/definicion-validator.ts` → `validarDefinicion(definicion, raiz)`. Se llama:

| Momento | Dónde |
|---|---|
| Guardar | `ReportesService.create` y `update` (en `update`, solo si viene `definicion`; la raíz es la de la plantilla) |
| Preview y ejecución sync | `ExecutorService.execute` |
| Ejecución async y estimación | `AsyncExecutorService.executeStreaming` / `estimarFilas` |

Lo que depende del **valor** (el que llega en `filtrosVars` al ejecutar) lo revisa además el planner con
el valor real. Una plantilla vieja que no cumple falla al ejecutar con el mismo mensaje.

### 16.2 Reglas

| # | Regla | Mensaje |
|---|---|---|
| 1 | El operador del filtro está en `OPERADORES_SOPORTADOS` (`validador/operadores.ts`): eq, neq, in, notIn, contains, startsWith, endsWith, gt, gte, lt, lte, between, notBetween, isNull, isNotNull. Se valida en el servicio (no en el DTO: el `ValidationPipe` le anteponía `definicion.filtros.0.` al mensaje), en el planner (aunque el filtro variable no se haya completado) y en el post-procesado, cuyo `default` ya no devuelve `true` sino que lanza. `between` / `notBetween` exigen un array de 2 | `El filtro «<labelVariable o path>» usa un operador que el motor no soporta: X` · `El filtro «X» necesita dos valores (desde y hasta)` |
| 2 | Una fecha de filtro es `YYYY-MM-DD` (día real del calendario), un ISO completo o un `Date`. Cualquier otra cosa no se convierte. Aplica a valores fijos, por defecto (al guardar), variables al ejecutar, cada punta de `between` y filtros que se resuelven en memoria. El mensaje no lleva el valor (se loguea `err.message`) | `Fecha inválida en el filtro «X». Usá el formato AAAA-MM-DD` |
| 3 | Cada segmento de cada path (columnas, filtros, ordenamientos, agrupaciones, totales) existe en el modelo de Prisma de la raíz; los `[campo=valor]` apuntan a campos de esa relación. Una columna fija (`path: ""`) es válida. `camposAdicionales.<clave>`: se valida el prefijo, la clave es libre; filtrar por el bloque entero sin clave es error | `El campo «X» no existe` |
| 4 | No hay dos columnas con el mismo `label` (las filas se arman por label: la primera pierde su dato y repite el de la segunda) | `Hay dos columnas con el nombre «X»` |

**Contra qué se valida.** Contra el modelo de Prisma (DMMF), que es de donde sale el catálogo, y **no**
contra el catálogo ya podado: éste oculta ramas (p. ej. `empresa.remesa`) que el resolver recorre bien y
que usa la plantilla de prod #1 (`empresa.remesa.politicaId`).

### 16.3 `rangoClaves`

Figuraba en el tipo del frontend y en este spec, pero **nunca se implementó** (el planner lo dejaba
pasar con un `return null`) y el editor no lo ofrecía (`operatorMatrix.ts`). Se sacó del tipo `Filtro`
del frontend; no es un operador válido. Si hace falta un rango alfabético sobre claves, `between` sobre
texto ya lo cubre.

### 16.4 `[campo=valor][count]`

`contactos[tipo=telefono][count] = 0` se traducía a `{contactos: {none: {}}}` (casos sin **ningún**
contacto). Ahora: `{contactos: {none: {tipo: 'telefono'}}}`, con los valores pasados por `coerceValor`
(`whatsapp=true` → booleano, `prioridad=1` → número). Solo se optimiza `= 0` y `> 0` sobre una relación
que cuelga directo del caso y con campos escalares simples; todo lo demás (`>= 2`, filtro por fecha) va a
post-procesado, que resuelve los mismos `[campo=valor]` en memoria. **Las ramas anidadas
(`convenios.cuotas[count]`) cambiaron en la segunda ronda: ver §16.8, que manda sobre este párrafo.**

### 16.5 Otros cambios del mismo arreglo

- Filtros sobre datos adicionales (`JSON`) con `in`, `notIn`, `between` y `notBetween`: se descartaban
  (`return null`); ahora se arman. Un operador imposible sobre un JSON es `400`.
- `notBetween` faltaba en el post-procesado: caía en el `default` y no filtraba.
- `creadoPorId` de la plantilla se completa con el usuario del JWT al crear
  (`ReportesController.create`); `duplicar` ya lo hacía. Backfill de las existentes:
  `backend/prisma/scripts/backfill-creado-por-reportes.ts` (dry-run por defecto, `--aplicar` escribe).
- Frontend: duplicar el nombre de una columna pasa de aviso a error en `validatePlantilla`.

### 16.6 Plantilla de prod #1 como red de seguridad

`__fixtures__/plantilla-prod-1.json` es la definición de la única plantilla de prod;
`__fixtures__/plan-prod-1.esperado.json` es el plan (where / include / post-procesado) que armaba el
planner **antes** de este cambio. `plantilla-prod-1.regresion.spec.ts` verifica que pasa `validarDefinicion`
y que el plan sigue siendo idéntico, y `reportes-validaciones-ejecucion.spec.ts` que ejecuta.

### 16.7 Pendiente (Fase B)

Las fechas relativas (`hoy-90`) son la extensión E1 de la Fase B: se implementaron en §17.

### 16.8 Segunda ronda (2026-10-19)

- **`[count]` anidado:** cantidad total de la última rama (`executor/contar-rama.ts`); `= 0` / `> 0` con `some` / `none`
  anidados (`planner.condicionCantidadCero`), el resto en memoria. `[count]` va al final, solo con `[campo=valor]`, sobre
  una relación con varios elementos.
- **Rangos abiertos:** `Entre` / `Fuera de` con un extremo vacío (`null`, `''`) filtran de un solo lado; sin ninguno,
  un variable opcional no aplica y uno obligatorio o fijo es 400. `extremosDeRango` en `validador/operadores.ts`.
- **Fechas:** `validador/fechas-negocio.ts` clasifica cada `DateTime` del schema. *Calendario* → ventana UTC del día
  (D 00:00:00.000Z a D 23:59:59.999Z, toma las convenciones 00:00Z y 03:00Z); *instante* → día local. Un test falla si
  hay una columna sin clasificar. `gt` / `lt` son "después / antes del día".
- **Lista de bloqueo:** `validador/campos-sensibles.ts` (modelos de credenciales y sesiones, `usuario` limitado a
  `id` / `nombre` / `email`, y nombres que matchean `/pass|secret|token|hash|enc$|apiKey|googleId/i`).
  400 «El campo «X» no se puede usar en un reporte».
- **Filtro fijo sin valor:** 400 «El filtro «X» no tiene valor». Datos adicionales: valores como texto.
- **Valores guardados vs. efectivos:** al guardar se validan los valores fijos y por defecto; al ejecutar, el planner
  valida el valor efectivo (`validarDefinicion(def, raiz, { valores: false })`).

## 17. Extensiones del motor E1 a E4 (2026-10-19, Fase B del asistente)

Cuatro extensiones **aditivas**: solo actúan si la definición trae la propiedad o el valor nuevo. Una plantilla que no
las usa sale byte a byte igual (la plantilla de prod #1 sigue dando el mismo plan; hay tests de "sin las propiedades,
la salida no cambia"). Diseño en [asistente-reportes-spec.md §11](asistente-reportes-spec.md).

### 17.1 E1 — fechas relativas en filtros

- **Valor:** `hoy`, `hoy-N` o `hoy+N`, con N de 1 a 3650 (`hoy-0` y `hoy-3651` no valen). Helpers en
  `common/utils/dia-local.ts`: `esFechaRelativa`, `resolverFechaRelativa(valor, hoyYmd)`, `diasEntre`.
- **Dónde vale:** `valor` y `valorPorDefecto` de filtros sobre un campo `DateTime`, el valor que manda quien ejecuta en
  un filtro variable, y cada punta de `between` / `notBetween` (también el rango abierto, con una punta vacía).
  Sobre un campo que no es fecha, `"hoy"` es un texto y no se toca.
- **Dónde se resuelve:** en `QueryPlanner.planQuery`, **antes** de armar la ventana del día (`fechas-negocio.ts`:
  calendario o instante) y antes del post-procesado, que recibe ya el `YYYY-MM-DD`. Como la ejecución sincrónica, la
  encolada, la estimación y el preview pasan por `planQuery`, valen igual. El "hoy" es el día local del servidor
  (`ymdLocal()`, Argentina) y se calcula una vez por plan.
- **Validación:** `validarDefinicion` (al guardar) acepta las relativas con `permitirRelativa` de `parsearFechaFiltro`;
  el resto del motor las rechaza si llegan sin resolver. Una relativa mal escrita (`hoy-0`) es el 400 de siempre
  «Fecha inválida en el filtro X».
- **Qué queda guardado:** `ejecucion_reporte.filtrosUsados` guarda lo pedido (`"hoy-90"`). El log del planner suma la
  fecha resuelta (`Filtro «X»: fecha relativa "hoy-90" resuelta a "2026-07-19"`), sin datos personales.

### 17.2 E2 — columna «días desde la fecha» (`tipo: 'dias'`)

- Sobre un path de fecha, devuelve los **días enteros entre el día de la fecha y hoy**: fecha pasada = positivo,
  futura = negativo, `null` = vacío. Es un número, así `sum` y `avg` de los totales funcionan.
- El día de la fecha sale de la clasificación de `fechas-negocio.ts`: *calendario* (vencimiento, fecha de pago) → la
  parte de fecha del ISO (cubre lo guardado a las 00:00Z y a las 03:00Z); *instante* → el día local.
  `prepararColumnas` resuelve la clasificación una vez por columna (`tipoFecha`).
- `validarDefinicion`: «Columna «X»: el tipo dias necesita un campo de fecha.» si el path no termina en un `DateTime`.

### 17.3 E3 — decimales y separadores (`decimales`, `separadorDecimal`, `separadorMiles`)

- Columna `numero` con alguna de las tres: `decimales` 0 a 4 (sin él, los que tenga el número), `separadorDecimal`
  `,` o `.`, `separadorMiles` `.`, `,` o `''`. Defaults: coma decimal y punto de miles; si se elige solo uno, el otro se
  acomoda (decimal `.` → miles `,`). Decimal y miles iguales: 400.
- Sin ninguna de las tres, `formatNumero` queda como estaba (con `formato`, `es-AR`; sin `formato`, `toString()`).
- Un negativo que redondea a cero sale sin signo; lo que no es número sale tal cual.
- El total (`sum`, `avg`) de una columna con E3 se calcula sobre el texto formateado: `GroupingService.parseNumeric`
  toma como decimal el último separador (`1.234,50` y `1,234.50`). Con `decimales: 0` y miles `.`, `1.234` se lee como
  1,234: para totales conviene sin separador de miles.

### 17.4 E4 — ancho fijo con alineación y relleno (TXT)

- `opcionesFormato.txt.alineacion` (por columna, `izquierda` default / `derecha`) y `relleno` (por columna, `' '`
  default / `'0'`). Izquierda: `padEnd` y corte por la derecha (lo de siempre). Derecha: `padStart` y, si no entra, se
  conservan los **últimos** caracteres: un importe que no entra pierde los dígitos más significativos.
- El encabezado (`incluirHeader`) usa la misma alineación y siempre se completa con espacios.
- Menos entradas que columnas: las que faltan son `izquierda` y `' '`.

### 17.5 Otros

- `ColumnaDto` y `CreatePlantillaDto.asistentePropuestaId` (`IsInt`, opcional; lo acepta y no hace nada, el vínculo lo
  hace el módulo del asistente). `ReportesModule` exporta `CatalogoService`, `ExecutorService` y `AsyncExecutorService`.
- `fechas-negocio.ts` clasifica `asistente_adjunto` y `asistente_propuesta` (instante).

### 17.6 Endurecimientos tras la auditoría de la Fase B

- **Bloqueo:** `asistente_adjunto` y `asistente_propuesta` están en `MODELOS_BLOQUEADOS`; un test recorre el DMMF y falla
  si aparece una tabla `asistente_*` sin bloquear. Toda columna JSON que no sea `camposAdicionales` (`tarjeta`, `perfil`,
  `rawRow`, `filtroFilas`…) da 400 «no se puede usar en un reporte», con o sin clave.
- **Totales:** `TotalDto.columnaId` ata el total a una columna (`executor/totales.ts`); con solo `path` y dos columnas
  sobre el mismo campo, 400 «ambiguo». Se calculan sobre los números crudos de las columnas con E3 y se muestran con los
  decimales y separadores de la columna (`count` no se formatea).
- **TXT de ancho fijo:** `anchoFijo`, `alineacion` y `relleno` deben tener tantos valores como columnas (400 «El ancho fijo
  tiene N valores y la plantilla M columnas»), al guardar (`validarOpcionesFormato`) y al exportar. Relleno `'0'` exige
  `derecha` explícito; un negativo con ceros lleva el signo adelante (`-0001234`).
