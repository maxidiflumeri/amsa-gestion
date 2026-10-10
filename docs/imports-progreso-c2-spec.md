# Progreso de las importaciones — Fase C, entrega 2 (C2): la interfaz

> **Estado: diseñada el 09/10/2026; sin implementar.** Architect, sobre el árbol de trabajo de `main`
> con HEAD `58bb9e1` **más la entrega 1 (C1) sin commitear** (38 archivos). Toda referencia
> `archivo:línea` de este documento se leyó contra ese árbol, no contra `HEAD`.
>
> Documento principal: [imports-progreso-realtime-spec.md](imports-progreso-realtime-spec.md) ("el spec
> principal"). Este archivo va aparte para no mezclarse con los cambios de C1 que ese documento tiene
> esperando el commit. Lo que este diseño hereda y no rediscute: §10.4 (contrato después de C1), §10.16
> (lo que cambió al auditar C1; manda sobre §10.2 a §10.12), §9.15 y §8.13 del spec principal.
> Qué se **ejecutó**, qué se **leyó** y qué es **suposición**: [§14](#14-qué-se-verificó-y-qué-es-suposición).
> Lo que necesita el OK del usuario: [§15](#15-lo-que-necesita-el-ok-del-usuario).
>
> **La idea en cinco líneas.** (1) C2 se parte en dos: **C2a**, el Historial que dice la verdad y deja
> actuar, los errores completos y la deuda de pantalla de C1; **C2b**, la tarjeta única de progreso, la
> campanita con acciones, el chip y el celular. (2) El Historial gana **su propia lectura** paginada, que
> trae el estado real de cada remesa (`carga`) y el resumen de cada división en un número fijo de
> consultas; se actualiza por socket y, donde el socket no llega, por consulta. (3) Los errores de una
> carga se leen **paginados y separados** en errores de fila y avisos —la distinción la hace el backend,
> una sola vez—, y se bajan en CSV con la sesión del usuario. (4) Lo que la pantalla ofrece sigue
> decidiéndolo el backend: `retomable` deja de prometer un botón que responde 409, y los 409 que la
> pantalla necesita reconocer traen un **código**. (5) El frontend deja de no tener tests: el primer paso
> del paquete de frontend es traer al repo un arnés como el de los auditores, y cada pantalla nueva se
> escribe con sus pruebas.

---

## 1. Reparto: C2 en dos entregas

El esbozo de §10.15 del spec principal junta dos cosas de riesgo distinto. Se parte así:

| Entrega | Qué trae, en una línea | Qué toca | Riesgo |
|---|---|---|---|
| **C2a — El Historial dice la verdad y deja actuar** | Historial con los estados reales, las divisiones agrupadas, en vivo, paginado y con cancelar, retomar y "confirmar las que no se pudieron encolar"; errores de una carga paginados, separados de los avisos y en CSV; la deuda de pantalla de C1; **tests del frontend dentro del repo** | Backend: **todas** las lecturas que le faltan a C2 (tres rutas nuevas, dos ampliadas) y los códigos de error. Frontend: `ImportHistory` (casi entero), la sección de errores del detalle, el diálogo de cancelar, utilidades | Ninguno para los datos: no cambia qué escribe una carga. El único camino de escritura nuevo (`confirmar-pendientes`) delega en `executeRemesa` / `ejecutarGrupo`, ya auditados |
| **C2b — Una sola tarjeta de progreso, campanita con acciones, chip y celular** | Componente único de progreso para el asistente, el detalle y la campanita (con pasos, últimos errores en vivo y la barra de la división); acciones desde la campanita; chip en la barra superior; el paso por celular | **Solo frontend** (un push): `ImportProgress`, el paso "Importando" del asistente, el bloque de progreso del detalle, `ImportEnCursoItem`, `NotificacionesPopover`, `NotificacionItem`, `AppBar` | Ninguno para los datos. El de siempre al refactorizar tres pantallas auditadas: regresiones. Por eso va después de que C2a deje la red de tests |

**Por qué este corte, y no C2 entera:**

1. **Dónde se equivoca hoy el operador.** En el Historial una cancelada figura FALLIDA
   (`ImportHistory.tsx:65-71` mapea `estadoProceso` crudo), una remesa en cola figura PENDIENTE igual que
   un borrador y **se puede eliminar creyendo que lo es** (`esEliminable`, `:73-80`, solo excluye
   `PROCESANDO`; el backend la saca de la cola y la borra: `imports.service.ts:4721-4733`), no hay cómo
   cancelar ni retomar, y con más de 100 avisos no se ve ningún error de fila. Nada de lo que trae C2b
   corrige una acción equivocada: es presentación.
2. **Dependencias en un solo sentido.** La tarjeta única necesita los "últimos errores en vivo": esa
   lectura la construye C2a. La campanita con acciones reusa el diálogo de cancelar, el de retomar y la
   descarga del CSV: los deja C2a. Y refactorizar tres pantallas auditadas sin red es repetir el riesgo
   que §10.15 ya señalaba: la red (el arnés en el repo) es el primer paso de C2a.
3. **Archivos casi disjuntos.** C2a reescribe `ImportHistory.tsx` (que C1 no tocó) y cambia dos lugares
   del asistente. C2b vive en el asistente, `ImportProgress` y la barra superior. Auditar las dos juntas
   es auditar casi todo el frontend de importaciones de una vez.
4. **Cada una se despliega sola y tiene sentido sola.** Después de C2a el Historial es confiable y los
   errores se ven completos; la campanita y el asistente quedan como en C1. Después de C2b cambia el
   aspecto, no lo que se puede hacer.
5. **Todo el backend de C2 va en C2a**, para que C2b sea un solo push de frontend.

**Dónde cae cada ítem** que §10.1, §10.15, §10.16, §9.15 y §8.13 del spec principal le asignan a C2:

| Ítem | Parte | Nota |
|---|---|---|
| #18 Historial en vivo, con "Borrador" y "En cola" · §8.13 no distingue "con advertencias" · §10.16 cancelada como FALLIDA, en cola como PENDIENTE, sin botones | **C2a** | §6.3 |
| §10.15 remesas de una división agrupadas en el Historial | **C2a** | §6.3; el resumen del grupo lo arma el backend (§5.1) |
| §10.16 las remesas que no se pudieron encolar solo se confirman desde el asistente | **C2a** | §5.5, §6.4 |
| #17 errores en CSV por blob · §8.13 solo 100 errores, sin paginado | **C2a** | §5.3, §5.4, §6.5 |
| §8.13 `rowNumber 0` es a la vez primera fila y aviso; la numeración arranca en 0 | **C2a** | La ambigüedad se resuelve en el contrato (`tipo`). La base del número, con OK del usuario (§15). Que no cuente las descartadas **no** se arregla acá (§2) |
| #11 avisos en vivo | **C2a** en el detalle (la tabla se refresca mientras la carga corre); **C2b** en la tarjeta (los últimos cinco) | C2b no necesita backend nuevo: usa la lectura de C2a con `orden=desc` |
| §8.13 las remesas de origen solo quedan en la auditoría | **C2a** | `resumen.origen` ya está escrito desde C1; se muestra en el detalle (§5.7) |
| §10.16 el 409 de corte repetido se reconoce por una frase | **C2a** | §4.5 |
| §10.16 retomar un grupo responde un 409 genérico y el DTO dice `retomable: true` de más | **C2a** | §5.2, §5.6 |
| §10.16 la lista del diálogo de cancelar es la foto de cuando se abrió; si la división no se pudo leer, no lo avisa | **C2a** | El Historial reusa ese diálogo: se arregla donde se reusa (§6.6) |
| §9.15 "descartó las 1 filas" y el resto de los singulares | **C2a** | §5.8, §6.1. Un assert existente cambia (el único admitido) |
| §9.15 / §10.1 alias `okFilas` / `errFilas` / `totalFilas` / `durationMs` del DTO | **Ni C2a ni C2b** | Ya se pueden quitar, pero no conviene acá: §5.9 |
| §10.16 `ejecutar-grupo` sin respuesta deja "Enviando a la cola…" sin seguimiento | **C2b** | Vive en el paso "Importando", que C2b rehace: arreglarlo dos veces no tiene sentido. Está acotado por el tope de 10 s del backend |
| `ImportProgressCard` único, con pasos y últimos errores en vivo · barra de la división y una por remesa | **C2b** | §16 |
| Campanita con acciones · chip en la barra superior · celular | **C2b** | §16. El Historial y el detalle de C2a no pueden empeorar en celular (§6.3, §10.5) |
| Tests del frontend dentro del repo | **C2a, primer paso** | §7 |
| §9.15 el globito de no leídas un paso atrás | D | Sin cambios |

---

## 2. C2a: alcance, impacto y riesgos

**Qué entra** (y dónde está diseñado):

| Qué | Sección |
|---|---|
| `GET /import/historial`: listado paginado con `carga`, resumen de cada división y remesas pendientes de encolar | §4.4, §5.1 |
| `retomable` honesto en las lecturas HTTP, y el motivo cuando deja de serlo (`corteRepetidoEn`) | §4.1, §5.2 |
| Errores de una carga: paginados, separados en filas y avisos, con totales; CSV autenticado | §4.3, §5.3, §5.4 |
| `POST /import/remesas/confirmar-pendientes` | §4.4, §5.5 |
| Códigos de error en los 409 que la pantalla reconoce; el 409 de retomar un grupo con los motivos | §4.5, §5.6 |
| Remesas de origen y corte en el detalle | §5.7 |
| Singulares de los textos, en backend y frontend | §5.8, §6.1 |
| Historial nuevo: estados reales, división agrupada, en vivo, paginado, acciones | §6.2 a §6.4 |
| Tabla de errores del detalle, paginada y viva, con descarga | §6.5 |
| Diálogo de cancelar: versión para una fila de tabla y lista viva | §6.6 |
| Arnés de tests del frontend en el repo, y las pruebas de todo lo anterior | §7, §10 |
| Wiki | §11 |

**Qué no entra, y se va a seguir viendo después de C2a:**

- El asistente, la campanita y el bloque de progreso del detalle quedan como en C1 (C2b).
- **El número de fila sigue sin contar el encabezado ni las filas descartadas**, y en una carga de un
  solo archivo no dice la línea del archivo. Es lo que se guarda: el runner numera con un contador
  propio de las filas que pasaron los filtros (`idx: total++`, `imports.service.ts:3901`; se escribe en
  `:3675` y `:3705`), no con el índice del archivo —el comentario de `recorrer-filas.ts:40` dice lo
  contrario y está desactualizado—. Arreglarlo es cambiar lo que escribe `processImportJob`, y C2 no
  cambia qué se escribe: queda para C3, que ya toca el runner, o para el backlog. Lo que sí ubica un
  registro hoy es la columna con el contenido de la fila y, en una carga de varios archivos, el
  `[archivo:línea]` del mensaje.
- "Archivo desconocido" bajo el nombre de cada remesa: el Historial lee un campo, `archivoOriginal`
  (`ImportHistory.tsx:193`), que el backend nunca mandó. El nombre con el que se subió el archivo solo
  se guarda en las cargas de varios archivos (`remesa.archivos.nombres`, `imports.service.ts:887-890`).
  C2a muestra el nombre cuando existe y nada cuando no; guardarlo para un solo archivo es un cambio del
  alta (backlog).
- Los alias viejos del DTO siguen (§5.9).
- Lo que ya era de C3 o del backlog en §10.16 del spec principal.

**Supuesto que sostiene el diseño: un solo proceso de backend**, igual que en C1. C2a no agrega nada que
dependa de eso: son lecturas, y el único camino de escritura nuevo delega en los de C1.

**Impacto.** Backend: `ImportService` (cuatro métodos nuevos: `historial`, `confirmarPendientes`,
`erroresCsv` y el privado `cortesRepetidosDe`; `getErrors` ampliado; `status`, `progreso` y `grupo` pasan
un extra; cinco `throw` ganan un código), `ImportController` (tres rutas nuevas, una ampliada), las
funciones puras de `estado-carga.ts` (un extra, un campo y los singulares), un archivo puro nuevo
(`utils/errores-carga.ts`), tres DTO de entrada. **No se tocan** `processImportJob`, el tracker, el
reaper, `executeRemesa` (salvo la forma de un `throw`), ningún processor, `imports.module.ts`,
`listRemesas` ni su spec. Frontend: `ImportHistory.tsx`, la sección de errores de `ImportDetail.tsx`,
`BotonCancelarCarga` (en `ImportProgress.tsx`), `DataTableResponsive.tsx` (una propiedad opcional),
utilidades, tipos, API, un hook nuevo, dos ediciones en `ImportWizard.tsx`, y la carpeta `frontend/tests/`
con su configuración. Schema: **ningún cambio**. Permisos: **ninguno nuevo**. Variables de entorno:
**ninguna**. Jobs: ninguno.

**Qué se rompe si sale mal:**

1. *El Historial muestra un estado que no es.* Es la pantalla desde la que se borra. Lo acota que el
   estado sale de una sola función pura sobre el `EstadoCargaDto` que arma el backend (la misma `carga`
   que ya usan el detalle y la campanita), con su tabla de casos en los tests (§10.3).
2. *Se elimina una remesa en cola creyéndola un borrador.* Hoy pasa. Con C2a el estado dice "En cola" y
   el diálogo de eliminar dice qué es y qué pasa (§6.4).
3. *"Confirmar las que no se pudieron encolar" confirma con otra remesa de origen.* Es el accidente que
   C1 reprodujo (4.700 casos desasignados en la remesa equivocada, §10.16). El origen lo lee el
   servidor de la fila, exige que sea el mismo en todas, y el diálogo lo muestra antes de confirmar (§5.5).
4. *El CSV sale cortado y parece completo.* Una falla a mitad destruye la respuesta en vez de cerrarla;
   el tope se avisa antes de bajar y en la última línea (§5.4).
5. *La clasificación fila / aviso se equivoca* y una fila con error se cuenta como aviso. Una sola
   definición en el backend, con el caso real que la motiva como test (§5.3).
6. *El listado nuevo se vuelve lento con muchas remesas.* El número de consultas no depende del tamaño
   de la página (§5.1); un test lo afirma.
7. *`DataTableResponsive` lo usan otras nueve pantallas.* El cambio es una propiedad opcional: sin
   ella, el componente no ejecuta una línea nueva (§6.8).
8. *Los combos de remesa de origen.* No se tocan: `listRemesas` y `imports-list-remesas.spec.ts` no
   tienen diff.

**Datos ya cargados.** Ninguna fila se modifica. Sin backfill. Las cargas anteriores a C1 (sin fila de
progreso o sin `resumen`) se listan con lo que ya sintetiza `armarEstadoCarga` (`estado-carga.ts:189-247`):
"Borrador", "Finalizada" o "Fallida", sin botones.

---

## 3. Datos

**Ningún cambio de schema.** `prisma migrate diff` contra la base local da `This is an empty migration`
(ejecutado el 09/10/2026 sobre este árbol) y tiene que seguir dándolo. **No se corre `prisma db push`.**
Sin `@@unique`, sin enums, sin columnas.

Se leen columnas que ya existen:

| Columna | Uso en C2a |
|---|---|
| `import_progreso.*` (`schema.prisma:210-276`) | El estado de cada fila del Historial, vía `armarEstadoCarga` |
| `import_progreso.resumen` (`Json`) | `resumen.origen`: las remesas de origen (detalle), y la marca de "borrador que ya se confirmó una vez" (§5.5). No se escribe |
| `remesa.divisionValores` (`:429`) | El corte de cada remesa de una división ("Nómina 3082 / Gestión 3GH") |
| `remesa.archivos` (`:402`) | Los nombres con que se subieron los archivos, cuando están |
| `remesa.archivoHash`, `plantillaId`, `filtroFilas`, `createdAt` | La guarda de cortes, en modo lectura (§5.2) |
| `importerror` (`:181-191`), índice `(remesaId, rowNumber)` | Listado y CSV. El orden y la paginación van por ese índice |

**Volumen** (medido, solo `SELECT`): la base local tiene 6 remesas y 484 filas en `importerror`; prod, 149
remesas en total al 30/09 (dato de quien encargó el diseño). El índice `(empresaId, categoria)` de
`remesa` alcanza para listar por empresa con ese volumen; **no se agrega ninguno**. El caso grande es
`importerror`: una carga de FACTURAS local tiene 1.115.323 filas, y una que falla entera deja esa cantidad
de errores. Por eso el CSV pagina por clave sobre el índice y tiene tope (§5.4).

**Procedimientos de wipe.** Sin cambios.

---

## 4. Contrato

### 4.1 `EstadoCargaDto`: un campo más

`backend/src/modules/imports/progreso/estado-carga.types.ts` y, copia textual,
`frontend/src/types/importProgreso.ts`:

```ts
export interface EstadoCargaDto {
    // … todo lo de §10.4.2 del spec principal, sin cambios, más:

    /** Números de las remesas donde ya figura el corte de esta (confirmadas después de que esta se
     *  creó). Con algún valor, `retomable` es false. Lo calculan solo las lecturas HTTP y solo para una
     *  carga que por su fila sería retomable; en los eventos de socket y en cualquier otro caso es null. */
    corteRepetidoEn: string[] | null;
}
```

- `retomable` pasa a ser: lo de §10.4.1 (por la fila) **y** `corteRepetidoEn` vacío o null.
- Es el mismo criterio que `enColaDelante`: un dato que no está en la fila y se calcula al leer
  (`ExtrasEstado`, `estado-carga.ts:29-32`). Una carga terminada no emite más eventos, así que la última
  palabra la tiene siempre una lectura HTTP; los clientes ya fusionan por `rev` con `>=`
  (`utils/estadoCarga.ts:152-158`), de modo que la lectura posterior gana.
- En una remesa heredada: `null`.
- `ResultadoCarga`, `FaseCarga` y el resto del DTO **no cambian**.

### 4.2 Tipos del Historial

`backend/src/modules/imports/historial.types.ts` (nuevo) y, copia textual,
`frontend/src/types/importHistorial.ts` (nuevo):

```ts
import type { EstadoCargaDto } from './progreso/estado-carga.types';

/** Remesa de origen con la que se confirmó una carga. `numeroRemesa` null = esa remesa ya no existe. */
export interface OrigenDeCargaDto {
    remesaId: number;
    numeroRemesa: string | null;
    nombre: string | null;
}

/** Borrador que ya se confirmó una vez y el servidor no pudo mandar a la cola. */
export interface PendienteDeEncolarDto {
    /** Esta remesa y las hermanas en la misma situación (mismo archivo, plantilla, dueño y origen), por id. */
    remesas: Array<{ remesaId: number; numeroRemesa: string; corte: string | null }>;
    /** Remesas de origen con las que se había confirmado. Vacío si la categoría no usa. */
    origen: OrigenDeCargaDto[];
    /** Otras remesas del mismo archivo y la misma plantilla (y del mismo corte, si esta lo tiene) que se
     *  confirmaron DESPUÉS de que esta se creó y están en curso, cargadas o a medias. Si trae alguna,
     *  confirmar esta carga ese contenido otra vez. */
    yaCargadoEn: Array<{ remesaId: number; numeroRemesa: string }>;
}

export interface HistorialItemDto {
    id: number;
    numeroRemesa: string;
    nombre: string;
    categoria: string | null;
    /** ISO 8601. */
    createdAt: string;
    plantilla: { id: number; nombre: string } | null;
    politicaId: number | null;
    accionRevertidaEn: string | null;
    /** Nombres con que se subieron los archivos, si la remesa los guardó (hoy, solo las de varios archivos). */
    archivos: string[] | null;
    /** Corte de la división que le tocó ("Nómina 3082 / Gestión 3GH"). null si no es un corte. */
    corte: string | null;
    /** El estado, armado con `armarEstadoCarga`: el mismo que devuelve `GET /import/remesas/:id/progreso`. */
    carga: EstadoCargaDto;
    /** null salvo en un borrador que ya se confirmó una vez (§5.5). */
    pendienteDeEncolar: PendienteDeEncolarDto | null;
}

/** Resumen de una carga dividida, contando TODAS sus remesas, estén o no en la página. */
export interface GrupoHistorialDto {
    grupoId: string;
    /** `grupoTotal`: cuántas se confirmaron juntas. */
    total: number;
    /** Cuántas siguen existiendo (alguna pudo eliminarse). */
    existentes: number;
    enCurso: number;
    cancelables: number;
    /** Con el criterio de §4.1 (ya descontadas las que tienen el corte en otra remesa). */
    retomables: number;
    finalizadas: number;
    /** Fallidas y canceladas. */
    noCargadas: number;
    /** Dueño de la división (el de sus remesas). */
    usuarioId: number | null;
}

export interface HistorialRespuesta {
    data: HistorialItemDto[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
    /** Una entrada por cada `grupoId` que aparece en `data`. */
    grupos: Record<string, GrupoHistorialDto>;
    servidorAhora: string;
}
```

### 4.3 Tipos de los errores de una carga

En el mismo par de archivos:

```ts
export type TipoErrorDeCarga = 'FILA' | 'AVISO';

export interface ErrorDeCargaDto {
    id: number;
    /** El valor guardado, sin tocar: 0 es la primera fila procesada y también todo aviso. Se conserva
     *  para las pestañas viejas; el código nuevo lee `tipo` y `fila`. */
    rowNumber: number;
    tipo: TipoErrorDeCarga;
    /** Posición de la fila entre las que procesó la carga, contando desde 1. null en un aviso. */
    fila: number | null;
    errorMsg: string;
    rawRow: unknown;
    createdAt: string;
}

export interface ErroresRespuesta {
    data: ErrorDeCargaDto[];
    total: number;      // de lo pedido (según `tipo`)
    page: number;
    pageSize: number;
    totalPages: number;
    /** De toda la carga, no de la página ni del filtro. */
    totales: { filas: number; avisos: number };
}
```

### 4.4 HTTP

Todo bajo `/api/import`, con el permiso de clase del controller (`importacion.ver_historial`) más el que
se indica. **No se agrega ningún permiso**: nada que declarar en `permisos-catalogo.ts`.

| Método y ruta | Permiso | Entrada | Respuesta | Errores |
|---|---|---|---|---|
| `GET /import/historial` **(nueva)** | el de clase | Query: `empresaId` (entero, obligatorio), `page` (≥ 1, default 1), `pageSize` (1 a 100, default 25), `q` (texto de hasta 60 caracteres, opcional: busca en número y nombre) | `200` `HistorialRespuesta`, por `id` descendente | `400` parámetros inválidos |
| `GET /import/errores/:remesaId` (ampliada) | el de clase | Query: `page` (≥ 1, default 1), `pageSize` (1 a 200, default 50), `tipo` (`TODOS` \| `FILA` \| `AVISO`, default `TODOS`), `orden` (`asc` \| `desc`, default `asc`) | `200` `ErroresRespuesta`. Sin parámetros nuevos responde lo mismo que hoy más `tipo`, `fila` y `totales` | `400` `tipo`, `orden` o números inválidos (hoy un `page` no numérico llega a Prisma como `NaN`: leído, no ejecutado) |
| `GET /import/errores/:remesaId/csv` **(nueva)** | el de clase; se audita | Query: `tipo` (igual, default `TODOS`) | `200` `text/csv; charset=utf-8`, en streaming, con `Content-Disposition: attachment` | `404` la remesa no existe · `400` |
| `POST /import/remesas/confirmar-pendientes` **(nueva)** | `importacion.ejecutar` + dueño o `importacion.ver_progreso_otros` | `{ remesaIds: number[] }` (1 a 100) | `201` `{ message, grupoId: string \| null, cargas: EstadoCargaDto[], noEncoladas?: Array<{ remesaId, numeroRemesa }> }` | `400` · `403` · `404` alguna no existe · `409` `NO_ES_PENDIENTE` · `409` `ORIGEN_DISTINTO` · los de `ejecutar/:id` y `ejecutar-grupo` (otra en curso, corte ya confirmado, sin filas) · `503` la cola no responde (siguen pendientes) |
| `GET /import/remesas/:id` (ampliada) | (igual) | — | Lo de hoy más `origen: OrigenDeCargaDto[] \| null` y `corte: string \| null` | (igual) |
| `GET /import/remesas/:id/progreso`, `GET /import/grupos/:grupoId` | (igual) | — | (igual), con `retomable` y `corteRepetidoEn` de §4.1 | (igual) |
| `POST /import/grupos/:grupoId/retomar` | (igual) | — | (igual) | El `409` de "ninguna se puede retomar" trae `code` y `omitidas` (§4.5) |
| `POST /import/remesas`, `POST /import/ejecutar/:id`, `POST /import/ejecutar-grupo`, `POST /import/remesas/:id/retomar` | (igual) | (igual) | (igual) | Los `409` de corte repetido traen `code` (§4.5). El texto no cambia |

Los tres parámetros de entrada nuevos son DTO con `class-validator` y `@Type(() => Number)`
(`HistorialQueryDto`, `ErroresQueryDto`, `ConfirmarPendientesDto`), no parámetros sueltos.

`GET /import/remesas/empresa/:empresaId` (`imports.controller.ts:207-220`) **no cambia**: lo siguen usando
los combos de remesa de origen del asistente y el filtro del tablero.

### 4.5 Códigos de error

Hoy el asistente reconoce el 409 del alta buscando la frase "cortes cargados" en el mensaje
(`ImportWizard.tsx:743-748`). Los 409 que alguna pantalla necesita distinguir pasan a llevar un código,
con la convención que ya usa el módulo vecino (`multiclaves/cupon.service.ts`: `{ code, message }`):

```ts
// backend/src/modules/imports/historial.types.ts (y su copia)
export type CodigoErrorImport =
    | 'CORTE_YA_CARGADO'      // alta: el archivo ya tiene ese corte cargado, en curso o a medias
    | 'CORTE_YA_CONFIRMADO'   // confirmar / retomar: el corte ya figura en otra remesa confirmada después
    | 'NINGUNA_RETOMABLE'     // retomar un grupo: ninguna se puede
    | 'NO_ES_PENDIENTE'       // confirmar-pendientes: la remesa no es un borrador ya confirmado
    | 'ORIGEN_DISTINTO';      // confirmar-pendientes: no se confirmaron con las mismas remesas de origen
```

Cuerpo del error: `{ statusCode: 409, error: 'Conflict', message, code, ...datos }`. Es un superconjunto
del cuerpo de hoy (`{ statusCode, error, message }`): una pestaña vieja sigue leyendo `message`, que
conserva el texto exacto, y `e.message` de la excepción también (ejecutado contra Nest 11.1.8: §14).

| Dónde | `code` | Datos extra |
|---|---|---|
| `createRemesa`, corte repetido (`imports.service.ts:1006-1012`) | `CORTE_YA_CARGADO` | `cortes: Array<{ detalle, remesaId, numeroRemesa, situacion }>` |
| `executeRemesa` (`:2175-2178`) y `encolarLote` en modo confirmar (`:2526-2529`) | `CORTE_YA_CONFIRMADO` | — |
| `motivoNoRetomable`, choque de corte (`:3239-3245`) | `CORTE_YA_CONFIRMADO` | — |
| `retomarRemesas` (`:3172-3175`) y `encolarLote` (`:2531-2533`), ninguna válida | `NINGUNA_RETOMABLE` | `omitidas: Array<{ remesaId, numeroRemesa, motivo }>` |
| `confirmarPendientes` (§5.5) | `NO_ES_PENDIENTE`, `ORIGEN_DISTINTO` | — |

El frontend decide por `code` y **conserva la frase como respaldo** solo para el 409 del alta (un
backend anterior no manda `code`).

### 4.6 Eventos de socket

**Ninguno nuevo y ninguno cambia.** Los tres de §8.4.2 del spec principal, con las mismas salas
(`user:<dueño>` y `admin:importaciones`, `realtime.service.ts:38-47`). Consecuencia que el diseño tiene
en cuenta: quien mira el Historial **sin** `importacion.ver_progreso_otros` no recibe los eventos de las
cargas de otros, aunque las vea en la lista. Para esas filas la actualización es por consulta (§6.2).

### 4.7 Compatibilidad

- **Backend C2a con pestañas de C1 o de la Fase B.** Todo lo que ya existía responde lo mismo, con
  campos de más que ignoran. `GET /import/errores/:id?pageSize=100` (lo que pide el detalle viejo,
  `ImportDetail.tsx:328`) sigue dando `{ data, total, page, pageSize, totalPages }` en el mismo orden.
  Los 409 conservan su texto. `retomable` puede pasar a `false` en una remesa cuyo corte ya está en
  otra: el botón viejo desaparece, que es lo correcto.
- **Frontend C2a con backend de C1. No se soporta:** `GET /import/historial` da 404. El orden de §8 es
  obligatorio. Durante esa ventana el Historial nuevo muestra un estado de error con "Reintentar", no
  una tabla vacía.
- **Volver atrás** es gratis: no hay schema ni datos que deshacer. Primero el frontend, después el backend.

---

## 5. Backend — lógica crítica

Regla que viene de §9.15 y §10.16 del spec principal y vale acá igual: ninguna escritura condicionada
con un `update` de Prisma con `where` no único; ninguna decisión colgada de un solo resultado vacío.
C2a casi no escribe: el único camino de escritura nuevo (§5.5) **delega** en `executeRemesa` y
`ejecutarGrupo`, que ya cumplen las dos.

### 5.1 `historial`: una lectura propia, con un número fijo de consultas

Método nuevo de `ImportService` (necesita tres privados suyos: `posicionesEnCola`, `tieneCortePropio` y
la guarda de cortes). `listRemesas` (`imports.service.ts:4316-4362`) **no se toca**.

```
historial({ empresaId, page, pageSize, q }):
  1. where = { empresaId } + (q ? número CONTIENE q  O  nombre CONTIENE q)
     total  = remesa.count(where)
     filas  = remesa.findMany(where, orderBy id DESC, skip, take,
                              include progreso, usuarioCreador{id,nombre}, plantilla{id,nombre})   ── 2 consultas
  2. gids     = los grupoId distintos de `filas`
     miembros = gids.length ? remesa.findMany(progreso.grupoId IN gids, include progreso, usuarioCreador) : []   ── 0 o 1
  3. posiciones = (alguna de filas o miembros está en cola) ? posicionesEnCola() : null            ── 0 o 1
  4. repetidos  = cortesRepetidosDe([...filas, ...miembros])      // §5.2; Map<remesaId, string[]>   ── 0 o 1 por archivo
  5. pendientes = filas que son "pendiente de encolar" (§5.5)
     si hay: hermanas = borradores de la empresa con `encoladaAt` null (son pocos: el reaper los borra a las 24 h),
             filtrados en memoria por `resumen.v === 1 && resumen.origen`                           ── 0 o 1
             origenes = remesa.findMany(id IN los ids de origen, select id, numeroRemesa, nombre)   ── 0 o 1
             yaCargadoEn = por cada archivo distinto de los pendientes, las otras remesas de ese archivo
                           y plantilla confirmadas después (§5.5)                                    ── 0 o 1 por archivo
  6. armar:
       item.carga = armarEstadoCarga(r, r.progreso, ahora, { enColaDelante, corteRepetidoEn })
       item.corte = textoDeCorte(r.divisionValores)        // "Nómina 3082 / Gestión 3GH", el formato de createRemesa:990-992
       item.archivos = r.archivos?.nombres (si es un arreglo de textos no vacíos) ?? null
       grupos[gid] = contar sobre `miembros` con el mismo armarEstadoCarga
```

- **El número de consultas no depende del tamaño de la página**: entre 2 y 6, más una por cada archivo
  distinto que tenga en la página una remesa retomable con corte o un pendiente de encolar (en la
  práctica, 0). Es lo que significa
  "sin pedir N detalles", y lo afirma un test contando las llamadas al doble (§10.2, HI-9).
- **Orden por `id` descendente**, no por `createdAt`: es determinístico para paginar (las N remesas de
  una división se crean en un bucle, con `createdAt` casi iguales) y deja juntas a las de una división.
- **`pendienteDeEncolar.remesas`**: las hermanas se agrupan por
  `plantillaId | archivoHash | usuarioCreadorId | origen normalizado`, y **solo si tienen corte propio**:
  una remesa sin corte nunca tiene hermanas (confirmar dos remesas sueltas del mismo archivo como grupo
  lo rechazaría `validarMismoArchivo`, `:2718-2733`).
- `count` y `findMany` no van en una transacción: `total` puede quedar una fila atrás un instante. No
  decide nada.
- Sin filtro por estado en esta entrega. Filtrar por estado en SQL es escribir por segunda vez, en un
  `where`, lo que `armarEstadoCarga` ya decide en código: dos definiciones del estado es un listado que
  esconde o muestra de más en silencio. La búsqueda por número o nombre (`q`) sí entra, porque al
  paginar se pierde el "buscar en la página" del navegador.
- Logging: `debug` siempre; `log` con el tiempo si pasa de 500 ms.

### 5.2 `retomable` honesto: la guarda de cortes, en modo lectura

Hoy `retomable` sale solo de la fila (`esRetomable`, `estado-carga.ts:139-147`), y el endpoint rechaza
además a una remesa cuyo corte ya figura en otra que se confirmó después (`motivoNoRetomable`,
`imports.service.ts:3237-3245`). Resultado: el botón se ofrece y responde 409 siempre. Con el Historial
mostrando "Retomar" en cada fila, esa promesa falsa se multiplica.

- `ExtrasEstado` gana `corteRepetidoEn?: string[] | null`. `armarEstadoCarga` devuelve
  `retomable: esRetomable(…) && !(extras.corteRepetidoEn?.length)` y `corteRepetidoEn` tal cual (o `null`).
  Sin el extra, el resultado es el de hoy: los eventos del tracker y todo llamador que no lo pase quedan
  igual.
- **Una sola implementación de la regla.** El cuerpo de `remesasQueChocanConElCorte` (`:1115-1139`) se
  parte en la consulta y una función privada pura, `choquesDeCorte(f, otras)`, que es la que decide
  (mismo corte, confirmada después de que `f` se creó, situación distinta de `SIN_CARGAR`).
  `remesasQueChocanConElCorte(tx, f)` pasa a ser "consulta + `choquesDeCorte`", con el mismo resultado.
  El método nuevo `cortesRepetidosDe(remesas)` filtra las candidatas (`esRetomable` por la fila **y**
  `tieneCortePropio` **y** con `archivoHash` y `plantillaId`), las agrupa por
  `empresaId | plantillaId | archivoHash`, hace **una** consulta por grupo y llama a la misma
  `choquesDeCorte`. Dos implementaciones de la guarda es una guarda que no encuentra nada, en silencio:
  es la lección del hash de C1.
- Lo pasan las cuatro lecturas HTTP que devuelven una carga terminada: `historial`, `grupo`
  (`:2431-2449`), `progreso` (`:3339-3353`) y `status` (`:4223-4266`). `progreso` es la lectura liviana
  del polling: la consulta extra solo ocurre si la remesa es retomable por su fila y tiene corte, que es
  la excepción.
- No lo pasan `listarEnCurso` (nunca hay terminadas), las respuestas de cancelar y retomar (devuelven lo
  que acaban de escribir; la lectura siguiente corrige) ni el tracker.
- **El endpoint no cambia su comprobación**: sigue mirando con la fila bloqueada. La lectura es para no
  ofrecer; la que impide es la del endpoint.

### 5.3 Errores de una carga: una definición de "aviso", en el backend

**El dato real que manda** (base local, solo `SELECT`): la remesa 35 (PAGOS, varios archivos) tiene 483
errores, y el primero es `rowNumber 0` con el mensaje `[AGNEJ0_…_20260725.txt:1] Deudor no encontrado
para pago (…)`. Es una **fila** con error en la posición 0, y su mensaje empieza con corchete. Un aviso
también tiene `rowNumber 0` y empieza con corchete. Lo único que los separa es el prefijo exacto.

Archivo nuevo, puro: `backend/src/modules/imports/utils/errores-carga.ts`.

```ts
export const PREFIJOS_DE_AVISO = ['[aviso]', '[parseo]', '[post-proceso]'] as const;

/** Un aviso es rowNumber 0 Y uno de los tres prefijos. Sin distinguir mayúsculas, como la base. */
export function tipoDeError(rowNumber: number, errorMsg: string): TipoErrorDeCarga;
/** Posición de la fila contando desde 1; null en un aviso. La base (BASE_DE_FILA) es una constante. */
export function numeroDeFila(rowNumber: number, tipo: TipoErrorDeCarga): number | null;
export function whereAvisos(remesaId: number): Prisma.importerrorWhereInput;  // { remesaId, rowNumber: 0, OR: startsWith × 3 }
export function whereFilas(remesaId: number): Prisma.importerrorWhereInput;   // { remesaId, NOT: { rowNumber: 0, OR: … } }
```

- **Por qué `rowNumber === 0` además del prefijo:** todo aviso se escribe con `rowNumber 0`
  (`imports.service.ts:3849`, `:3995`, `:4206`, `:4213`; `pagos.processor.ts:577-622`;
  `multiclaves.processor.ts:286`), y con esa condición el filtro va por el índice `(remesaId, rowNumber)`.
- **Mayúsculas.** La collation de la base no distingue mayúsculas ni acentos: `startsWith '[aviso]'`
  también encuentra `[AVISO]`. `tipoDeError` usa la expresión con la marca `i` para que el `tipo` de cada
  fila coincida con el filtro que la trajo. Ningún código escribe hoy un error de fila que empiece así
  (leído); el test lo deja fijado.
- El `where` del conteo que hace el runner al cerrar (`:4014-4025`) es la misma definición, escrita a
  mano. **No se toca en esta entrega** (`processImportJob` no tiene diff). Queda como duplicación
  conocida, junto con `esAvisoDeCarga` del frontend (`utils/estadoCarga.ts:466-468`), que pasa a ser solo
  el respaldo frente a un backend viejo. Unificar la del runner es de C3, que ya lo toca.

`getErrors(remesaId, { page, pageSize, tipo, orden })` (hoy `:4269-4287`; nadie más lo llama y ningún spec
lo afirma):

```
where  = tipo === 'AVISO' ? whereAvisos : tipo === 'FILA' ? whereFilas : { remesaId }
[data, total, avisos, todos] = Promise.all([
    importerror.findMany({ where, orderBy: [{ rowNumber: orden }, { id: orden }], skip, take }),
    importerror.count({ where }),
    importerror.count({ where: whereAvisos(remesaId) }),
    importerror.count({ where: { remesaId } }),
])
devuelve data con `tipo` y `fila`, y totales = { filas: todos − avisos, avisos }
```

- El desempate por `id` es nuevo y no cambia el orden de lo que hoy se ve (hoy, a igual `rowNumber`, el
  orden no está definido).
- `orden=desc` existe para "los últimos": en filas, las de número más alto son las más recientes; en
  avisos (todos en 0) desempata el `id`. Lo usa C2b.
- Una remesa que no existe sigue devolviendo una lista vacía, como hoy.

### 5.4 CSV de errores

`GET /import/errores/:remesaId/csv`. Se genera **en streaming**; nada se escribe al disco del contenedor.

**Formato.** UTF-8 con BOM, separador `;`, fin de línea `\r\n` (lo que Excel en español abre con doble
clic; es suposición sobre las máquinas de los operadores: §14). Primera línea:
`Tipo;Fila;Mensaje;Contenido de la fila (una columna por campo)`. Después, una línea por registro:

| Columna | Fila con error | Aviso |
|---|---|---|
| Tipo | `Fila` | `Aviso` |
| Fila | `fila` de §4.3 | vacío |
| Mensaje | `errorMsg` entero (con su `[archivo:línea]` si lo trae) | `errorMsg` |
| De la cuarta en adelante | Cada elemento de `rawRow` en su columna, como texto | vacío |

Funciones puras en `utils/errores-carga.ts`: `celdaCsv(valor)`, `lineaCsv(celdas)` y
`nombreArchivoCsv(numeroRemesa)` (`errores-remesa-<número>.csv`, dejando solo letras, dígitos, punto,
guion y guion bajo).

- **Comillas:** una celda con `;`, comillas, `\n` o `\r` va entre comillas, con las comillas internas
  duplicadas.
- **Fórmulas.** El contenido de la fila es texto del archivo del cedente y se abre en Excel: una celda
  que empieza con `=`, `+`, `-`, `@`, tabulación o retorno de carro se antepone con un apóstrofo,
  **salvo que entera sea un número** (`^[+-]?\d+([.,]\d+)*$`): los importes negativos, que en este
  sistema importan, tienen que seguir siendo números.
- **Tope: 200.000 registros** (`MAX_FILAS_CSV_ERRORES`, constante en el código, no una variable de
  entorno: nada que olvidarse de definir en prod; el método lo recibe como parámetro opcional solo para
  poder probarlo). Si la carga tiene más, la última línea es
  `Aviso;;Se omitieron N registros: este archivo trae los primeros 200.000 de T.` La pantalla lo avisa
  **antes** de bajar, con los `totales` que ya tiene (§6.5).

**Algoritmo.**

```
1. remesa = findUnique(id, select numeroRemesa). No existe → warn + 404, antes de escribir nada.
2. cabeceras: Content-Type text/csv; charset=utf-8 · Content-Disposition attachment; filename="…" · Cache-Control no-store
3. escribir BOM + encabezado
4. cursor = null; escritas = 0
   repetir:
     lote = importerror.findMany({
         where: { …(según tipo), …(cursor ? { OR: [{ rowNumber: { gt: cursor.rowNumber } },
                                                   { rowNumber: cursor.rowNumber, id: { gt: cursor.id } }] } : {}) },
         orderBy: [{ rowNumber: 'asc' }, { id: 'asc' }], take: 2000 })
     por cada registro, hasta el tope: escribir la línea (esperando 'drain' si `write` devuelve false)
     si el cliente cerró la conexión → cortar sin error
   hasta que el lote venga con menos de 2.000 o se llegue al tope
5. si se llegó al tope y quedaban más → la línea de "se omitieron"
6. terminar la respuesta
```

- **Paginación por clave, no por `skip`**: sigue el índice `(remesaId, rowNumber)` y no relee lo ya
  enviado. Con un millón de errores, `skip` recorrería el índice entero en cada lote.
- **Una falla después de empezar a escribir no puede dejar un archivo corto que parezca completo.** Ya
  no se puede cambiar el status: se loguea `error` con su `.stack` y se **destruye** la respuesta
  (`res.destroy`), no se la termina. El navegador ve una descarga abortada y la pantalla muestra el error.
- **Un lote vacío termina el archivo.** Acá sí alcanza un resultado vacío: es una lectura para mostrar,
  no una decisión de escritura. El control está del otro lado: la pantalla ya conoce `totales` y, si el
  archivo trajo menos registros que los esperados, lo dice (§6.5).
- Se audita (`AuditTipo.REPORTE_DESCARGAR`, módulo `IMPORT`, entidad `Remesa`): el archivo trae datos
  personales de los casos. El mismo dato ya se ve en la tabla con el mismo permiso; por eso no hay permiso
  nuevo.
- Logging: `log` al empezar y al terminar (remesa, registros, tiempo); nunca el contenido de una fila.

### 5.5 `confirmarPendientes`: lo que hoy solo hace "Cargar las que faltan" del asistente

**Qué es un pendiente de encolar** (verificado contra las dos compensaciones): una remesa que **se
confirmó**, cuyo encolado falló y que el backend devolvió a borrador. `executeRemesa` la deja con
`fase: 'BORRADOR', encoladaAt: null` (`imports.service.ts:2273-2281`) y `encolarLote` igual, además de
quitarle el grupo (`:2769-2779`). **Ninguna de las dos toca `resumen`**, que la transacción de confirmar
ya había escrito con `{ v: 1, origen }` (`:2124-2127`, `:2575`). Un borrador que nunca se confirmó tiene
`resumen` null (`:917`, `:1262-1269`), y una confirmación rechazada por una validación no llega a
escribirlo (el `throw` es anterior al `update`, dentro de la misma transacción).

> **Pendiente de encolar** ⟺ la remesa no está en curso ni terminó (`encoladaAt` y `finishedAt` null,
> `estadoProceso` PENDIENTE o VALIDANDO) **y** su `resumen` es de la versión 1 con `origen`.

```
confirmarPendientes(remesaIds, user):
  1. ids = distintos, ordenados. 0 o más de 100 → 400.
  2. remesas = findMany(ids, include progreso). Falta alguna → warn + 404.
  3. por cada una: dueño o `importacion.ver_progreso_otros` (verificarDuenoOPermiso) → 403
  4. alguna no es pendiente de encolar → warn + 409 NO_ES_PENDIENTE, nombrándola
  5. todas con el mismo `resumen.origen` (comparado normalizado) → si no, 409 ORIGEN_DISTINTO
  6. dos con el mismo corte (`claveDeCorte` igual) → 409 CORTE_YA_CONFIRMADO, nombrando las dos
  7. log de intención
     una sola  → executeRemesa(id, user.sub, origen.remesaOrigenId ?? undefined, origen.remesaOrigenIds ?? undefined)
     dos o más → ejecutarGrupo({ remesaIds: ids, …origen }, user.sub)
  8. respuesta unificada: { message, grupoId (null si fue una), cargas, noEncoladas? } + log con el tiempo
```

- **No hay camino de escritura nuevo.** Las validaciones (vista previa hecha, total mayor que 0, la
  guarda de cortes con la fila bloqueada, una importación por usuario) y la compensación si la cola
  vuelve a fallar son las de `executeRemesa` y `encolarLote`. Los pasos 2 a 6 son lecturas sin lock que
  solo deciden **si se llama**; si algo cambió en el medio, lo frena el método llamado con su fila
  bloqueada.
- **El origen lo lee el servidor**, no lo manda la pantalla: es la regla de §10.16 ("la fila manda").
- **Paso 6:** `ejecutar-grupo` con el mismo corte dos veces en el mismo pedido carga los dos (deuda de
  C1, hasta ahora alcanzable solo por API). Este endpoint lo pondría a un clic: lo rechaza.
- **Quien confirma pasa a ser el dueño** (lo hace `executeRemesa`, `:2202`), igual que en el asistente.
  Es distinto de retomar, que conserva al dueño.
- La vista previa **no se vuelve a mostrar**: el operador ya la confirmó. El diálogo lo dice (§6.4).
- **Un pendiente viejo es una forma fácil de cargar dos veces lo mismo**: la cola falla, el operador
  vuelve a subir el archivo y lo carga en otra remesa, y el borrador del primer intento sigue en el
  Historial con su botón "Confirmar". Si la remesa es un corte, lo frena la guarda de C1 al confirmar
  (`CORTE_YA_CONFIRMADO`). Si **no** tiene corte, hoy no lo frena nada (la guarda no cubre a una remesa
  sin corte: deuda de §10.16). Por eso el listado calcula `yaCargadoEn` (§4.2) y el diálogo lo muestra
  antes de confirmar. Para una remesa con corte usa la misma `choquesDeCorte`; para una sin corte, una
  función pura hermana, `mismoArchivoConfirmadoDespues(f, otras)`: mismas empresa, plantilla y
  `archivoHash`, sin corte, con `encoladaAt` posterior al `createdAt` de `f` y situación distinta de
  `SIN_CARGAR`. Es un aviso, no una guarda nueva: cerrar ese hueco en el servidor sigue en el backlog.
- Un borrador pendiente lo borra el reaper como a cualquier otro: su predicado es `fase: 'BORRADOR'` y
  `encoladaAt: null` (`reaper-cargas.service.ts:289-301`), y las 24 horas se cuentan **desde que se creó
  la remesa**, no desde el intento de confirmar. Después hay que volver a subir el archivo. El texto de
  la pantalla no promete otra cosa.
- Se audita como `IMPORT_START`.

### 5.6 Códigos en los 409, y retomar un grupo

Un ayudante privado arma el cuerpo de §4.5:
`conflicto(code, message, datos?) → new ConflictException({ statusCode: 409, error: 'Conflict', message, code, ...datos })`.
Los cinco `throw` de la tabla de §4.5 pasan a usarlo **con el mismo texto**. Los specs que ya afirman
esos textos lo hacen sobre `e.message` o con `toThrow(/…/)` (`imports-grupo.spec.ts:1021-1023`, `:1150`,
`:1169-1170`, `:1252`), y `e.message` no cambia.

**Retomar un grupo sin ninguna retomable.** Hoy `encolarLote` descarta los motivos que acaba de juntar
en `omitidas` y tira un texto fijo (`:2531-2533`); `retomarRemesas` hace lo mismo antes (`:3172-3175`).
Los dos pasan a:

```
conflicto('NINGUNA_RETOMABLE',
    omitidas.length === 0
        ? 'Ninguna de las importaciones se puede retomar: ya procesaron filas o no terminaron.'      // el de hoy
        : 'Ninguna de las importaciones se puede retomar. ' +
          omitidas.slice(0, 5).map(o => `Remesa ${o.numeroRemesa}: ${o.motivo}`).join(' ') +
          (omitidas.length > 5 ? ` Y ${omitidas.length - 5} más.` : ''),
    { omitidas })
```

Ningún spec afirma hoy el texto fijo (revisado con grep). Con §5.2, además, la pantalla deja de ofrecer
el botón en ese caso; el 409 queda para la carrera.

### 5.7 El detalle muestra las remesas de origen y el corte

`status()` (`:4223-4266`) agrega dos claves a su respuesta:

- `origen`: `null` si la carga no tiene `resumen.origen` (anterior a C1, o un borrador); si lo tiene, la
  lista de sus remesas (`remesaOrigenId` y `remesaOrigenIds` juntos, sin repetir) resuelta con una
  consulta a `{ id, numeroRemesa, nombre }`. Una que ya no existe va con `numeroRemesa: null`. Una
  categoría que no usa origen da `[]`.
- `corte`: el mismo texto que en el Historial.

Cierra la fila de §8.13: el remedio de una PAGOS "con advertencias" manda a consolidar las remesas de
origen, y hasta ahora dependía de que el operador se acordara de cuáles eran.

### 5.8 Singulares

Un ayudante puro en `estado-carga.ts`, `plural(n, uno, varios)`, y cada oración con una cantidad de
filas gana su forma para 1. Con cualquier otro número el texto es **idéntico al de hoy**.

| Función (`estado-carga.ts`) | Hoy, con 1 | Con 1 pasa a |
|---|---|---|
| `mensajeSinFilas` (`:373`) | "descartó las 1 filas." | "descartó la única fila." |
| `mensajeSinFilas` (`:374`) | "1 filas son de otros cortes de la división." | "1 fila es de otro corte de la división." |
| `textoCancelacion` (`:470-471`) | "llevaba 1 de 1 filas." / "llevaba 1 filas." | "llevaba 1 de 1 fila." / "llevaba 1 fila." |
| `textoCancelacion` (`:478` en adelante) | "De las 1 filas ya procesadas, 0 quedaron … y 1 dieron error" | "La única fila ya procesada dio error" · con más de una: "1 quedó cargada…" y "1 dio error" donde el número sea 1 |
| `textoCancelacion` (`:487`, `:497`, `:505`) | "Las 1 filas ya procesadas quedaron…" | "La única fila ya procesada quedó…" |
| `textoNotificacion`, cancelada (`:521`) | "Las 1 filas ya procesadas quedaron cargadas." | "La única fila ya procesada quedó cargada." |
| `textoNotificacion`, OK (`:530`) | "Se procesaron 1 filas correctamente." | "Se procesó 1 fila correctamente." |
| `textoNotificacion`, con errores (`:538`, `:558`) | "Se cargaron 1 filas y 1 dieron error." | "Se cargó 1 fila y 1 dio error." (cada mitad por separado) |
| `textoNotificacion`, todo con error (`:543`) | "Las 1 filas del archivo dieron error: no se cargó ninguna." | "La única fila del archivo dio error: no se cargó." |
| `textoNotificacion`, fallida (`:569`) | "Se habían procesado 1 filas." | "Se había procesado 1 fila." |

La tabla es el piso, no el techo: el implementer revisa `textoInterrupcion` y cualquier otra oración con
una cantidad. La red es un test de propiedad (§10.2, EC-3): con todos los contadores en 1, ningún texto
producido contiene "1 filas", "las 1 ", "1 dieron", "1 quedaron" ni "1 son ".

**Un assert existente cambia, y es el único admitido en esta entrega:** `estado-carga.spec.ts:807`
afirma hoy `'De las 6 filas ya procesadas, 5 quedaron cargadas en esta remesa y 1 dieron error; …'`, que
pasa a `'…y 1 dio error; …'`. Es un cambio de política (el singular), no una incompatibilidad.

Los textos que se copian a `import_progreso.error` solo cambian para cargas futuras. La wiki cita estos
textos con números mayores que 1 (revisado con grep): no hay que tocarla por esto.

### 5.9 Los alias `okFilas` / `errFilas` / `totalFilas` / `durationMs`: se pueden quitar, no acá

**¿Queda alguna pestaña que los lea?** Solo los lee el frontend **anterior a la Fase A** (el de la A en
adelante no: revisado con grep, las lecturas de `okFilas` que quedan en `frontend/src` son de la remesa,
no del DTO). Una pestaña así tendría que estar abierta desde antes del 05/10 sin haberse recargado nunca,
y no puede: un 401 hace `window.location.href = '/login'` (`frontend/src/api/axios.ts:27-39`), que es
una recarga completa y trae el bundle nuevo (`index.html` va sin caché); el token dura un día; y cada
deploy del backend (hubo uno el 09/10) corta todos los sockets y rechaza la reconexión de un token
vencido. La única forma de sobrevivir sería cerrar sesión y volver a entrar **dentro** de la aplicación
todos los días, sin recargar, durante semanas. Con cuatro usuarios, no es un riesgo real. (Supuesto: en
prod `JWT_EXPIRES_IN` es `1d`, el default del código; lo confirma quien orquesta.)

**Por qué no en C2a, igual.** Quitarlos no es borrar cuatro líneas: `notificarResultadoCarga` copia tres
de ellos y `durationMs` al `payload` que se **persiste** en `notificacion`
(`imports.service.ts:4174-4189`), hay asserts existentes que los afirman (`estado-carga.spec.ts:175`,
`:188`) y `docs/notificaciones-spec.md:406` los documenta. Es tocar asserts de specs auditados y el
contrato de una tabla, para una ganancia que es solo limpieza. **Recomendación:** van en la Fase D, que
ya abre el payload de las notificaciones y su spec; ahí la lista de arriba es el trabajo completo. Si el
usuario los quiere antes, es un commit aparte de backend, no parte de esta entrega.

---

## 6. Frontend

Reglas que siguen valiendo: todo con `theme.palette`, ningún color escrito a mano; todo campo que puede
faltar se lee con `== null`; lo que la pantalla ofrece lo decide el backend; toda consulta de fondo va
con `silencioso: true`; `vite build` no chequea tipos, así que `tsc --noEmit` es obligatorio.

Lo que cambia respecto de las fases anteriores: **cada paso se escribe con su prueba** (§7), y el primer
paso es traer la red.

### 6.1 Tipos, API y utilidades

- `types/importProgreso.ts`: `corteRepetidoEn` (§4.1). `types/importHistorial.ts` (nuevo): §4.2, §4.3 y
  `CodigoErrorImport`.
- `api/imports.ts`: `obtenerHistorial(params, { silencioso })`, `obtenerErrores(remesaId, params, { silencioso })`,
  `descargarErroresCsv(remesaId, tipo)` (devuelve un `Blob`: `responseType: 'blob'`, con el `Authorization`
  de siempre; es el arreglo de #17), `confirmarPendientes(remesaIds)`, `eliminarRemesa(remesaId)`.
  `RetomarGrupoRespuesta` gana `noEncoladas?` (el controller ya la manda, `imports.controller.ts:401-410`,
  y el tipo no la tenía).
- `utils/estadoCarga.ts`:
  - `plural(n, uno, varios)` y los singulares de `presentarResultado` (`:291-360`): "1 de N filas no se
    cargó", "La única fila dio error", "Se cargó 1 fila", "1 dio error", "se cargó al menos 1 fila".
  - `oracionesSinFilas(porFiltro, fuera)`: las dos oraciones de `SIN_FILAS` con sus singulares ("descartó
    la única fila", "1 fila es de otro corte de la división"). La usan `presentarResultado` y el cartel
    del asistente (`ImportWizard.tsx:1564-1571`), que hoy las tiene escritas dos veces.
  - `codigoDeError(err): CodigoErrorImport | null` (lee `response.data.code` de un error de axios).
  - `TEXTO_RETOMAR_UNA` y `TEXTO_RETOMAR_VARIAS`: las dos frases del diálogo de retomar, hoy escritas
    dentro de `ImportDetail.tsx:281` y del asistente. Las usan el detalle y el Historial.
  - `motivoNoRetomablePorCorte(carga)`: si `corteRepetidoEn` trae algo, "El corte de esta remesa ya
    figura en la remesa X: no se puede retomar. Si esta ya no hace falta, eliminala." (el mismo texto del
    409, sin "desde el Historial" cuando ya se está ahí).
- `utils/historialImportaciones.ts` (nuevo, puro): §6.3 y §6.4.
- `utils/descargas.ts` (nuevo): `descargarBlob(blob, nombre)` (crea la URL, dispara la descarga y la
  libera) y `mensajeDeErrorDeBlob(err)`: con `responseType: 'blob'` el cuerpo de un error también llega
  como `Blob`, y sin leerlo el toast diría "Request failed with status code 404".

### 6.2 `useHistorialImportaciones`: la lista, viva

Hook nuevo, `hooks/useHistorialImportaciones.ts`:

```ts
useHistorialImportaciones({ empresaId, page, pageSize, q }) → {
    items: HistorialItemDto[]; grupos: Record<string, GrupoHistorialDto>;
    total: number; totalPages: number;
    cargando: boolean;      // primera carga de estos parámetros
    refrescando: boolean;   // hay una consulta en vuelo sobre datos ya mostrados
    error: boolean;         // la última consulta de primer plano falló y no hay datos que mostrar
    refrescar: () => Promise<void>;
    aplicarCarga: (dto: EstadoCargaDto) => void;   // lo que devolvió una acción
    quitar: (remesaId: number) => void;            // tras eliminar
}
```

Mismas reglas que `useEstadoCarga` y `useGrupoCarga`, que **no se tocan**:

| Disparador | Qué hace |
|---|---|
| Montar, o cambiar `empresaId`, `page`, `pageSize` o `q` | Empieza de cero y consulta (en primer plano: un fallo se ve) |
| `import:iniciada` / `import:progreso` / `import:finalizada` de una remesa **de la página** | Fusiona `carga` por `rev` (`fusionarEstadoCarga`). Lo que no pasa `esEstadoCarga`, o es de otra empresa, se ignora |
| Un evento de una remesa de esta empresa que **no** está en la página, estando en la página 1 y sin búsqueda | Es una carga recién confirmada: pide un refresco, limitado a uno cada 5 s (`crearRefrescoLimitado`, con su flanco de bajada) |
| Un evento que deja terminal a una remesa de la página | Además de fusionar, pide un refresco limitado: cambian el resumen del grupo, `retomable` y `pendienteDeEncolar`, que no viajan en el evento |
| Sube `conexiones`, vuelve la pestaña, vuelve la red | Refresca en silencio |
| Cada 15 s (`POLL_LISTA_MS`), con la pestaña visible | Si hay alguna fila en curso y (el socket está caído **o** pasaron 30 s, `SILENCIO_MS`, sin evento ni consulta): refresca. Si no hay ninguna en curso, y es la página 1 sin búsqueda: refresca cada 60 s (constante nueva, `REFRESCO_HISTORIAL_QUIETO_MS`, junto a las otras en `utils/estadoCarga.ts`) |
| Una acción de una fila responde con un error (400, 403, 404, 409) | La pantalla muestra el mensaje del backend y pide `refrescar()`: la fila puede no ser ya lo que se veía |

- **Por qué hay consulta además de socket:** quien no tiene `importacion.ver_progreso_otros` no recibe
  los eventos de las cargas de otros (§4.6), y eliminar una remesa o crear un borrador no emite nada. Con
  una carga en curso a la vista la lista nunca queda más de 30 s atrás; sin ninguna, un minuto.
- Las respuestas pueden llegar desordenadas: cada pedido lleva un número y una respuesta más vieja que la
  última aplicada se descarta (como `pedidoRef` en `NotificacionesContext.tsx:119-121`).
- Al aplicar una lista del servidor, cada `carga` se fusiona por `rev` con la que ya había: una respuesta
  lenta no pisa un evento más nuevo. Los campos que no son de `carga` (corte, pendiente, grupo) se toman
  siempre de la respuesta.
- Un refresco de fondo que falla no toca lo que se ve ni muestra toast.

### 6.3 `ImportHistory.tsx`: estados reales, división agrupada, paginado

La página conserva lo que tiene (selector de empresa, botón Actualizar, política por fila, consolidar,
revertir) y cambia de dónde saca los datos y qué dice de cada remesa.

**Estado de cada fila.** Una función pura nueva, `estadoParaHistorial(item)`, en
`utils/historialImportaciones.ts`. Se evalúa en este orden y gana la primera que se cumple:

| # | Condición sobre `item.carga` | Etiqueta | Color (`StatusValue`) | Segunda línea |
|---|---|---|---|---|
| 1 | No en curso ni terminal, y `item.pendienteDeEncolar` | **No se pudo encolar** | `warning` | "Se confirmó y la cola de trabajos no respondió. No se cargó nada." |
| 2 | No en curso ni terminal | **Borrador** | `pending` | "Vista previa sin confirmar." |
| 3 | En curso y `cancelacionPedidaAt` no nulo | **Cancelando…** | `warning` | — |
| 4 | En curso, fase `EN_COLA` | **En cola** | `pending` | La posición (`etiquetaFase(carga).secundario`) |
| 5 | En curso, fase `PROCESANDO` con total | **Procesando N %** | `running` | "3.000 de 14.466" y, si hay, `esperaAbreviada` |
| 6 | En curso, cualquier otra fase | `etiquetaFase(carga).principal` | `running` | Su secundario, si tiene |
| 7 | Terminal y `cancelada` | **Cancelada** · sin `startedAt`: **Cancelada antes de empezar** | `warning` | — |
| 8 | Terminal, `FALLIDA`, sin `startedAt` | **No llegó a empezar** | `failed` | — |
| 9 | Terminal, `FALLIDA` | **Fallida** | `failed` | — |
| 10 | Terminal, `CON_ADVERTENCIAS` | **Con advertencias** | `warning` | — |
| 11 | Terminal, `CON_ERRORES` con `ok > 0` · con `ok === 0` | **Finalizada con errores** · **Sin filas cargadas** | `warning` · `failed` | — |
| 12 | Terminal, `SIN_FILAS` | **Sin filas** | `warning` | — |
| 13 | Terminal, `OK` | **Finalizada** | `completed` | — |
| 14 | Cualquier otra cosa | **Finalizada** | `neutral` | — |

- En las filas 7 a 12, el chip lleva de tooltip el título de `presentarResultado(carga)` y la primera
  línea del motivo: el Historial dice **qué** pasó; el porqué entero está en el detalle.
- En las filas en curso, debajo del chip, una barra fina (`LinearProgress`, indeterminada según
  `barraIndeterminada`).
- `estadoEnGrupo` (`utils/estadoCarga.ts:581-601`), que usan el asistente y el detalle, **no se toca**:
  dice "Finalizada" para todo terminal no fallido. Unificarlas es de C2b, que rehace esas pantallas.
- Si una remesa terminó sin poder retomarse por su corte (`corteRepetidoEn`), bajo el chip va
  `motivoNoRetomablePorCorte`: su motivo guardado todavía dice "usá «Retomar»" y el botón no está.

**Columna "Filas".** Hoy solo muestra números en una FINALIZADA (`ImportHistory.tsx:220`), sacados de la
remesa. Pasa a salir de `carga`: en una terminal con fila de progreso, o una FINALIZADA heredada,
`procesadas / ok / err` con separador de miles (el tooltip agrega "En una carga interrumpida son un piso"
si es `FALLIDA` y no `cancelada`); en cualquier otro caso, "—".

**Columna "Importación".** Nombre; `#número`; el corte si lo tiene; "Remesa 2 de 3 de una carga dividida"
si tiene grupo; el nombre del archivo si `archivos` trae alguno ("y N más" si son varios). Sin
`archivos`, nada: se va el "Archivo desconocido" de hoy (`:193`).

**División agrupada.** Las remesas de una división vienen juntas (ids consecutivos, orden por id).
`ordenarParaMostrar(items)` (pura) deja cada tramo de filas contiguas con el mismo `grupoId` en orden de
`grupoOrden` ascendente; `inicioDeBloque(items, i)` dice si la fila `i` abre un tramo. Antes de la
primera fila de cada tramo va un **encabezado de división** que ocupa todo el ancho (§6.8):

> **Carga dividida · 5 remesas** — 3 finalizadas · 1 en curso · 1 no cargada
> *(2 de las 5 están en esta página)* ← solo si el tramo no trae todas las `existentes`
> *(1 se eliminó)* ← solo si `existentes < total`
> [Retomar las 2 que no se cargaron] ← si `grupos[gid].retomables >= 2` y el usuario puede

Los números salen de `grupos[gid]` (todas las remesas del grupo, estén o no en la página). El botón del
encabezado llama a `retomarGrupo`; con una sola retomable alcanza con el botón de su fila. **Cancelar no
está en el encabezado**: se llega desde el botón de cualquier remesa en curso del grupo, cuyo diálogo ya
ofrece "Cancelar todo lo que falta" (comportamiento auditado de C1).

Las remesas de una división que **no** se confirmaron como grupo (borradores, pendientes de encolar,
divisiones anteriores a C1 o lanzadas desde una pestaña vieja) no tienen `grupoId`: no llevan
encabezado, pero cada una muestra su corte.

**Aviso de lo que la página no muestra.** Con paginado, una carga en curso puede quedar en otra página.
Arriba de la tabla, si `useImportacionesEnCurso()` trae cargas de esta empresa que no están en `items`:
"Hay N importaciones en curso que no están en esta página: #151, #152. [Ir al principio]". Y con una
búsqueda activa: "Buscando «x» · [Quitar]".

**Paginado.** `TablePagination` de MUI, del lado del servidor: 25, 50 o 100 por página (25 por defecto),
con las etiquetas en español. Cambiar de empresa o de búsqueda vuelve a la página 1.

**Estados de la pantalla.** Primera carga: el esqueleto de hoy. Refresco: la barra fina de hoy. Sin
remesas: el `EmptyState` de hoy. **Error sin datos: un `Alert` con "No se pudo cargar el historial" y
"Reintentar"**, no una tabla vacía.

### 6.4 Acciones de la fila

Componente nuevo `components/import/historial/AccionesHistorial.tsx` (los botones y sus diálogos).
Botones con ícono y tooltip, como hoy. Qué se ofrece lo deciden dos funciones puras de
`utils/historialImportaciones.ts`, `accionesDeFila(item, usuario, tienePermiso)` y `textoEliminar(item)`.

| Acción | Se muestra si | Qué hace |
|---|---|---|
| Ver detalle | siempre | Como hoy |
| **Cancelar** | `carga.enCurso` y `puedeGestionarCarga` | `BotonCancelarCarga` en su variante de ícono (§6.6): mismo diálogo, mismas opciones, mismo motivo cuando no se puede |
| **Retomar** | `carga.retomable` y `puedeGestionarCarga` | Confirmación con `TEXTO_RETOMAR_UNA` → `retomarRemesa` → `aplicarCarga(r.carga)` + `refrescar()` |
| **Confirmar** | `item.pendienteDeEncolar`, `importacion.ejecutar` y (dueño o `ver_progreso_otros`) | Diálogo de abajo → `confirmarPendientes` |
| Consolidar | como hoy | Como hoy |
| Revertir | como hoy (`ACCIONES` y `estadoProceso === 'FINALIZADA'`) | Como hoy |
| **Eliminar** | `importacion.eliminar` | Deshabilitado, con el motivo en el tooltip, si la carga está en curso y **ya arrancó** ("No se puede eliminar una importación en curso. Para frenarla, usá Cancelar.") o si no es del usuario y no tiene `ver_progreso_otros` ("Solo podés eliminar tus importaciones."). Si no, abre el diálogo de abajo |

**En celular el motivo no puede vivir en un tooltip**: sobre un botón deshabilitado, en una pantalla
táctil, no se ve. En la vista de tarjetas (ancho menor que `md`), el motivo de cada acción deshabilitada
va escrito debajo de los íconos.

**Diálogo "Confirmar las que no se pudieron encolar".** Título: "Confirmar la importación" o "Confirmar
las N importaciones". Cuerpo:

> {Esta importación se confirmó / Estas N importaciones se confirmaron} y la cola de trabajos no
> respondió: no se cargó nada. Al confirmar se mandan a la cola tal como se habían confirmado; la vista
> previa no se vuelve a mostrar.
>
> • Remesa 00151 — Nómina 3082
> • Remesa 00152 — Nómina 3090
>
> **Remesa de origen:** 00140 (Telecom septiembre). ← solo si `origen` trae alguna; "una remesa que ya
> no existe" si `numeroRemesa` es null, y en ese caso el botón de confirmar va deshabilitado

Si `yaCargadoEn` trae alguna remesa, una alerta de advertencia arriba de los botones: "Este archivo ya
figura en la remesa 00160, que se confirmó después. Si confirmás esta, se carga otra vez." Con corte, el
botón de confirmar va deshabilitado (el servidor lo rechazaría); sin corte, el botón dice "Confirmar
igual".

Botones: "Volver" y "Confirmar". Después del `201`: `aplicarCarga` de cada una, toast "Importación
encolada" y `refrescar()`; con `noEncoladas`, un aviso que las nombra. Ante un error: el mensaje del
backend en un toast y `refrescar()`.

**Diálogo de eliminar: dice qué se elimina.** Hoy es el mismo texto para todo
(`ImportHistory.tsx:362-364`), y para una remesa en cola o una de pagos es falso. `textoEliminar(item)`
elige:

| Estado de la fila | Título | Cuerpo |
|---|---|---|
| Borrador | Eliminar vista previa | "Es una vista previa sin confirmar: no cargó nada. Al eliminarla se libera su número de remesa. No se puede deshacer." |
| No se pudo encolar | Eliminar vista previa | Lo anterior, más: "Ya se había confirmado y la cola de trabajos no respondió. Si lo que querés es cargarla, usá «Confirmar» en vez de eliminarla." |
| **En cola** | **Eliminar una importación en cola** | "Esta importación **está confirmada y espera su turno**: todavía no empezó. Si la eliminás, sale de la cola y no se carga. No se puede deshacer." · con grupo: "Es la remesa N de M de una carga dividida: las demás siguen." · "Si solo querés frenarla, usá «Cancelar»: no se carga ninguna fila y después la podés retomar." |
| Terminal, categoría que crea casos (Deudores, Deudores y Facturas, Multirregistro, Multiarchivo) | Confirmar eliminación | El texto de hoy, sin cambios |
| Terminal, Facturas, Pagos, Contactos, Enriquecimiento o Actualizaciones | Confirmar eliminación | "Eliminar esta importación borra su registro y su lista de errores. **No deshace lo que aplicó**: lo que cargó sobre los casos de otras remesas queda como está. No se puede deshacer." |
| Terminal, Acciones masivas | Confirmar eliminación | "**Eliminarla no revierte la acción** y deja sin efecto el botón Revertir para siempre. Si la acción salió mal, revertila primero." |
| Terminal, Claves de pago | Confirmar eliminación | "Elimina las claves de pago que cargó esta importación. Si alguna ya tiene un convenio o un cupón emitido, no se puede eliminar." |

Las cuatro últimas filas son lo que ya afirma la wiki, auditada contra el código
(`08-historial-y-problemas.md:193-226`); el implementer las reconfirma contra `deleteRemesa`
(`imports.service.ts:4708-4800`) antes de escribirlas, y lo que no pueda confirmar no se escribe. El
botón de confirmar del diálogo "en cola" dice "Eliminar igual".

### 6.5 Los errores en el detalle: paginados, separados, vivos y descargables

Componente nuevo, `components/import/ErroresDeCarga.tsx`, que reemplaza en `ImportDetail.tsx` el estado
`errors`, `cargarErrores`, las columnas y la tabla de hoy (`:209`, `:314-340`, `:344-377`, `:436-438`,
`:863-884`). El resto del detalle no cambia.

- **Dos pestañas** con sus cantidades, de `totales`: "Errores de fila (483)" y "Avisos (2)" (o "Trámites
  rechazados" en Claves de pago, como hoy). Si una está en cero, no se muestra la pestaña; si las dos, no
  se muestra la tarjeta. Cada pestaña pide con su `tipo`: **con más de 100 avisos, los errores de fila se
  siguen viendo**.
- **Paginado del lado del servidor** (25, 50, 100).
- **Columna "Fila":** `fila` de §4.3; en un aviso, "—". El encabezado lleva un tooltip: "Posición entre
  las filas que procesó esta carga, contando desde 1. No cuenta el encabezado ni las filas descartadas
  por un filtro. Para ubicar el registro, mirá la columna con el contenido de la fila." (En Claves de
  pago: "entre los trámites".)
- **Cuándo se pide:** con la misma condición de hoy (`carga.err > 0`, `carga.advertencias > 0`, o una
  terminal heredada). Mientras la carga está en curso, cada vez que cambian `carga.err` o
  `carga.advertencias` se vuelve a pedir la página que se está mirando y los totales, **a lo sumo una vez
  cada 5 s**, y una vez más al terminar. Como los errores nuevos van al final del orden, la página que se
  está leyendo no se mueve. Es la mitad de #11 que le toca al detalle.
- **Nunca "no hay errores" contra lo que dice la carga.** Si `carga.err > 0` y la respuesta trae
  `totales.filas === 0` (o lo mismo con los avisos), la tarjeta no dice que no hay: dice "No se pudieron
  leer los errores" con "Reintentar". Es la regla de no creer en un resultado vacío, aplicada a lo que se
  le muestra al operador.
- **"Descargar CSV".** Botón en la tarjeta, visible si hay algo. Pide el archivo con la sesión
  (`descargarErroresCsv`) y lo entrega con `descargarBlob`. Mientras baja, el botón gira y se
  deshabilita. Si `totales.filas + totales.avisos` supera 200.000, antes de pedirlo confirma: "Esta carga
  tiene N errores y avisos. El archivo va a traer los primeros 200.000." Ante un fallo, el mensaje real
  (`mensajeDeErrorDeBlob`), no un genérico.
- **Backend viejo** (la respuesta no trae `totales`): una sola lista sin pestañas, clasificando con
  `esAvisoDeCarga` como hoy, y sin el botón de descarga.

En "Información general" del detalle se agregan dos renglones, solo cuando hay dato: **Corte** y
**Remesas de origen** (número y nombre de cada una; "una remesa eliminada" si ya no existe).

### 6.6 Cancelar desde una fila, con la lista viva

`BotonCancelarCarga` (`ImportProgress.tsx:284-482`) es código auditado de C1. Se le hacen dos cambios, y
**antes de tocarlo se portan al repo sus pruebas** (§7.3, paso FE-0):

1. **Variante de ícono.** Propiedad nueva `variante?: 'boton' | 'icono'` (default `'boton'`: el asistente
   y el detalle quedan como están). Con `'icono'` dibuja un `IconButton` con tooltip; cuando no se puede
   cancelar, el tooltip es el motivo que hoy va debajo del botón.
2. **El diálogo se monta solo cuando está abierto, y lee la división en vivo.** El contenido del diálogo
   pasa a un componente interno, `DialogoCancelarCarga`, que usa `useGrupoCarga(grupoId)` en vez del
   `obtenerGrupo` único de hoy (`:303-316`). Con eso:
   - la lista de "las que no empezaron" deja de ser la foto de cuando se abrió: si una remesa arranca
     con el diálogo abierto, el texto cambia antes del clic;
   - "no se pudieron leer las demás" pasa a decidirse así: es una división, el hook terminó de cargar
     y **no hay remesas ni del hook ni de la propiedad `grupo`**. Hoy una propiedad `grupo` vacía (`[]`,
     que es lo que manda el detalle cuando su lectura falló) cuenta como leída y el aviso no sale
     (`:298`, `:368`);
   - en el Historial, veinticinco filas no registran veinticinco juegos de listeners: el hook existe
     solo mientras un diálogo está abierto.

Los textos del diálogo, las opciones y qué pedido dispara cada botón **no cambian**, con una excepción:
el singular de "Lleva N de M filas" (`:413-415`), que con un total de 1 pasa a "Lleva 1 de 1 fila" y,
sin total, a "Lleva 1 fila". El hook hace al abrir el mismo pedido que hoy (uno) y después sigue por
eventos.

### 6.7 El asistente: dos ediciones

- `ImportWizard.tsx:743-748`: la condición del 409 del alta pasa a
  `codigoDeError(err) === 'CORTE_YA_CARGADO'`, con la frase como respaldo si no hay código.
- `:1564-1571`: el cartel de "El archivo no tiene filas para importar" usa `oracionesSinFilas`.
- Nada más. El paso "Importando", el resumen y "Cargar las que faltan" son de C2b.

### 6.8 `DataTableResponsive`: una propiedad opcional

`components/ui/DataTableResponsive.tsx` lo usan diez pantallas. Gana una propiedad:

```ts
/** Si devuelve algo para una fila, se dibuja antes de ella ocupando todo el ancho (un encabezado de bloque). */
encabezadoAntesDe?: (row: T, index: number) => React.ReactNode | null;
```

En escritorio: una `TableRow` con una sola celda `colSpan={columns.length}`. En celular: un bloque entre
dos tarjetas. **Sin la propiedad no se ejecuta ninguna línea nueva** y el resultado es el de hoy; un test
lo afirma (§10.3).

### 6.9 Lo que no se toca

`SocketContext.tsx`, `NotificacionesContext.tsx`, `NotificacionesPopover.tsx`, `NotificacionItem.tsx`,
`ImportEnCursoItem.tsx`, `AppBar.tsx`, `useEstadoCarga.ts`, `useGrupoCarga.ts`, `useImportacionesEnCurso.ts`,
`ImportSummary.tsx`, `AvisosCarga.tsx`, el componente `ImportProgress` (no `BotonCancelarCarga`, que vive
en el mismo archivo), `vite.config.ts`, `tsconfig.json`.

---

## 7. Tests del frontend dentro del repo

### 7.1 Evaluación y recomendación

**Recomendación: sí, y como primer paso del paquete de frontend (FE-0).** Por qué:

- Las tres auditorías de frontend (A, B y C1) armaron el mismo arnés desde cero, fuera del repo, y lo
  perdieron al cerrar la sesión: unas 270 pruebas escritas dos veces y tiradas. C2 es casi toda pantalla
  y son dos entregas; después vienen C3 y D.
- C2a toca código de frontend **auditado** (`BotonCancelarCarga`, la sección de errores del detalle,
  `presentarResultado`) y reescribe la pantalla desde la que se borra. Sin red, la única verificación
  sería `tsc`, el build y la lectura.
- El costo es bajo y está medido: abajo.

**Qué cuesta** (medido el 09/10/2026; §14):

| Costo | Cuánto |
|---|---|
| Dependencias de desarrollo | Tres: `vitest`, `jsdom` y `socket.io` (el servidor, solo para los tests). Más `@types/node`, que ya está instalado por arrastre y pasa a ser explícito. **Ninguna dependencia de producción.** Menos de 47 MB en `node_modules` (lo que pesó la sonda, que además instaló su propio `vite`) |
| Compatibilidad | **Ejecutado:** `vitest` 3.2.7 corre con el `vite` 5.4.21 que el frontend ya tiene, `jsdom` 26.1 y los módulos reales del repo: 64 de 65 pruebas del arnés de C1 pasan (la que falla afirma un texto que se corrigió después de la auditoría). No hace falta subir `vite` |
| Build de Vite | **No se toca.** La configuración va en `frontend/vitest.config.ts`, que `vite build` no lee. Los tests viven en `frontend/tests/`, fuera de `src`: no entran al bundle ni al `tsc` de `src` |
| Deploy | El workflow del frontend hace `npm ci` y `npm run build` con Node 20: `npm ci` instala tres paquetes más (segundos). Los tests **no** se agregan como paso del deploy en esta entrega (los de tiempo real pueden parpadear); un commit que solo toque `frontend/tests/` igual dispara el deploy, que es inofensivo |
| Tiempo de la suite | Las puras, milisegundos. Las de componente con servidor falso, segundos (23 s las 65 de la sonda). Las que esperan un intervalo real de la aplicación (10, 15, 30 o 60 s) tardan minutos: van en una carpeta aparte y no corren con `npm test` |
| Trabajo de FE-0 | Del orden de un día: armar el arnés y portar unas 100 pruebas |

**Lo que no es:** copiar el arnés de los auditores tal cual. Son pruebas de auditoría: fábricas con
`any`, rutas absolutas a la máquina, `console.log` de lo observado y casos titulados "HALLAZGO" que
afirman un defecto conocido para dejarlo documentado. Y envejecen: de las 118 pruebas de la Fase B que
el auditor de C1 volvió a correr sobre el código de C1, 6 fallan porque afirman textos y flujos que C1
cambió a propósito. Se trae **la forma** (servidor falso, montaje con los providers reales, ayudantes)
y se reescribe una selección.

### 7.2 Cómo queda

```
frontend/
  vitest.config.ts            ← nuevo. vite.config.ts no se toca
  package.json                ← scripts y devDependencies
  tests/
    tsconfig.json             ← extiende ../tsconfig.json; tipos de node; incluye tests/ y src/vite-env.d.ts
    setup.ts
    lib/
      servidor-falso.ts       ← HTTP de verdad (node:http) + socket.io de verdad en /rt, en 127.0.0.1:47831
      montar.tsx              ← monta con React en modo estricto y los providers REALES del frontend
      fabricas.ts             ← EstadoCargaDto, HistorialItemDto y ErrorDeCargaDto de prueba, TIPADOS
    unit/                     ← funciones puras
    componentes/
    paginas/
    tema/
    lento/                    ← todo lo que espera un intervalo real de la aplicación
```

- **`vitest.config.ts`:** entorno `jsdom` con `url` en `http://127.0.0.1:47831/`; `setupFiles`;
  `include: ['tests/**/*.test.{ts,tsx}']`; `fileParallelism: false` (un solo servidor falso, un puerto
  fijo); `css: false`; `esbuild: { jsx: 'automatic' }`; `env: { VITE_API_URL: 'http://127.0.0.1:47831/api', VITE_GOOGLE_CLIENT_ID: 'x' }`.
  Sin el plugin de React: no hace falta (verificado en la sonda).
- **`setup.ts`:** `IS_REACT_ACT_ENVIRONMENT`; sustitutos de lo que jsdom no trae (`ResizeObserver`,
  `scrollTo`); un `matchMedia` **controlable** con `fijarAncho(px)` —sin él `useMediaQuery` siempre da
  falso y toda prueba correría en la rama de celular sin saberlo—; un seguro que hace fallar la suite si
  `VITE_API_URL` no es la del servidor falso (**el arnés jamás le habla a un backend real**); limpieza
  después de cada prueba (`document.body`, `localStorage`).
- **`servidor-falso.ts`:** `en(método, patrón, manejador)`, `levantar()`, `bajar()`, `emitir(evento, dto)`,
  el registro de pedidos (`cuantos`, `de`), `aceptarSockets`. Dos cosas que el de los auditores no tenía
  y C2a necesita: responder con un cuerpo que no sea JSON (el CSV), y **cortar una respuesta a la mitad**.
- **`montar.tsx`:** `montar(ui, { ruta, patron, conSocket, modo })`, `iniciarSesion(permisos, id)`,
  `esperar(condición)`, `pasar(ms)`, `clic`, `escribir`, `boton`, `alertas`, `dialogo`, `toasts`, `chips`.
  Sin `@testing-library`: los ayudantes del arnés alcanzan y es una dependencia menos.
- **Scripts:** `test` (todo menos `tests/lento`), `test:lento`, `test:todo`, `test:ver` (modo observación).
- **Tipos:** `npx tsc --noEmit -p tests/tsconfig.json` no puede dar errores en archivos de `tests/`. El
  `tsc` de `src` (`-p tsconfig.json`) no cambia.

**Reglas del arnés**, para que no se pudra:

1. Nada de `any` en `tests/lib/`: las fábricas reciben `Partial<…>` de los tipos reales. Si el contrato
   cambia, las pruebas dejan de compilar.
2. Ninguna ruta absoluta, ningún `console.log` de lo observado.
3. Una prueba afirma el comportamiento **querido**. Un defecto conocido que no se arregla va como
   `it.fails` con la referencia a la deuda, no como un caso verde que lo celebra.
4. Tiempo real: lo que cabe en segundos va con `npm test`; lo que espera un intervalo de la aplicación,
   a `tests/lento/`. Los intervalos no se acortan para los tests.
5. Cada archivo baja su servidor y desmonta lo que montó.
6. Los dobles se comportan como el backend real en lo que la prueba apoya: el servidor falso de una
   prueba de paginado **pagina**, no devuelve siempre la misma lista.

### 7.3 Qué se trae primero, y cómo se escribe lo nuevo

**FE-0 — antes de tocar código de producción:**

| Qué | De dónde (arnés de C1) | A dónde | Por qué primero |
|---|---|---|---|
| El arnés (`lib/`, `setup.ts`, configuración) | `lib/servidor.ts`, `lib/render.tsx`, `lib/dto.ts`, `setup.ts`, `vitest.config.ts` | `frontend/tests/` | Base de todo |
| Funciones puras del progreso | `01-puras`, `09-refresco-limitado`, `12-c1-puras` (60 pruebas) | `tests/unit/estadoCarga.test.ts` | C2a toca `presentarResultado`; son milisegundos y fijan todos los textos |
| Cancelar | `15-c1-cancelar` (11), `20-c1-cancelar-division` (16) | `tests/componentes/cancelar.test.tsx` | C2a cambia `BotonCancelarCarga`: **la red se pone antes** |
| Detalle | `05-detalle` (8) y los bloques del detalle de `16-c1-retomar` | `tests/paginas/detalle.test.tsx` | C2a reemplaza la sección de errores del detalle |
| El 409 del alta | el caso de `13-c1-cortes` | `tests/paginas/asistente-cortes.test.tsx` | C2a cambia esa condición |

- Al portar, una prueba que falla se clasifica: **afirma un texto que cambió después de la auditoría**
  (se actualiza el texto, con el commit o la fila de §10.16 que lo explica) o **es una regresión** (se
  para y se reporta). No se borra ninguna en silencio.
- FE-0 termina con `npm test` en verde, y con la cantidad de archivos, de pruebas y la duración anotadas:
  es la **línea de base** del frontend, que hasta hoy no existía.
- El resto del arnés de C1 (avisos, hooks, asistente, resumen, campanita: unas 170 pruebas) cubre código
  que C2a no toca: es la red de **C2b**, y se porta en su FE-0.

> **Los arneses de los auditores están en un directorio temporal de la sesión**
> (`/tmp/claude-1000/…/scratchpad/auditoria-fe-b/` y `…/auditoria-fe-c1/`) **y se pierden.** Quien
> orquesta tiene que copiarlos a un lugar estable antes de cerrar la sesión; si ya no están, §7.2
> alcanza para rehacer el arnés, pero las pruebas de C1 habría que escribirlas de nuevo.

**De FE-1 en adelante: ningún paso se cierra sin su prueba en verde.** Cada paso del paquete (§13) nombra
su archivo de test; la lista de casos está en §10.3. El orden dentro de un paso es el de siempre para
una función pura (caso, función) y, para una pantalla, lo que el implementer prefiera, siempre que el
paso se entregue con los dos. El auditor corre `npm test` y **muta** el código de producción para medir
si la red agarra, como hizo en las fases anteriores, pero ahora sobre pruebas que quedan.

### 7.4 Lo que el arnés no puede decir

jsdom no calcula layout ni pinta: no hay desbordes, ni contraste, ni áreas táctiles, ni teclado en
pantalla. Qué se afirma sin navegador y qué queda para la prueba manual está en §10.5.

---

## 8. Deploy y compatibilidad con pestañas viejas

**C1 va antes.** C2a se implementa sobre el contrato de C1, que al escribir esto está sin commitear. El
orden de los commits es: C1 backend, C1 frontend, C2a backend, C2a frontend. Si C1 y C2a salen el mismo
día, el backend de las dos antes que cualquier frontend.

**Antes de desplegar** (lecturas en prod; las corre quien orquesta):

1. `prisma migrate diff` con la imagen actual → `This is an empty migration`. C2a no agrega nada al
   push, pero el push corre igual y ejecuta cualquier drift pendiente.
2. Que no haya cargas en curso (la consulta de §10.6 del spec principal): el deploy del backend mata la
   que esté procesando.

**Orden: primero el backend, después el frontend, en dos commits.** El frontend nuevo contra el backend
de C1 no funciona (`GET /import/historial` no existe); el backend nuevo sí sirve a las pestañas de C1.

**El `package-lock.json` del frontend cambia** (tres dependencias de desarrollo). El workflow usa
`npm ci`, que **falla si `package.json` y el lock no coinciden**: un lock mal regenerado no rompe una
pantalla, rompe el deploy entero del frontend. Se verifica con un `npm ci` en una copia limpia antes de
commitear (§12, C2A-33).

**Qué pasa con lo que ya existe:**

| Situación | Después del deploy |
|---|---|
| Remesas anteriores a la Fase A (sin fila de progreso), incluidas la 93 y la 98 | "Borrador", "Finalizada" o "Fallida", sin botones de cancelar ni retomar. Se pueden eliminar como hoy |
| Cargas terminadas antes de C1 | Sin `resumen`: sin remesas de origen en el detalle, nunca retomables. Sin cambios a la vista salvo el estado más preciso |
| Divisiones corridas antes de C1, o lanzadas desde una pestaña vieja | Sin `grupoId`: sin encabezado de división; cada remesa muestra su corte |
| Errores ya guardados | Se ven todos, paginados. Su número de fila se muestra contando desde 1 (§15) |
| Pestañas con el frontend de C1 | Siguen andando: lo que piden responde igual (§4.7). El Historial viejo sigue mostrando PENDIENTE y FALLIDA hasta que recarguen |
| Borradores que quedaron de un encolado fallido antes del deploy | Si se confirmaron con C1 (tienen `resumen.origen`), aparecen como "No se pudo encolar" y se pueden confirmar. Los anteriores a C1, no |

**Después de desplegar:** `prisma migrate diff` vacío; abrir el Historial en un navegador (es la primera
vez que algo de esta evolución se ve); bajar un CSV de una carga con errores.

**Volver atrás** no choca con nada: sin schema, sin datos nuevos. Primero el frontend.

---

## 9. Fallos silenciosos

| Qué puede pasar en silencio | Cómo queda a la vista |
|---|---|
| Se elimina una remesa en cola creyéndola un borrador | El estado dice "En cola"; el diálogo dice que está confirmada, qué pasa si se elimina y que existe Cancelar; el botón dice "Eliminar igual" |
| Una cancelada pasa por fallida, una con advertencias por finalizada | Etiqueta propia para cada una (§6.3), de una sola función con su tabla de casos |
| Se borra una remesa de pagos creyendo que deshace los pagos; o una de acciones, y se pierde el Revertir | El diálogo de eliminar lo dice según la categoría, antes de confirmar |
| Con más de 100 avisos no se ve ningún error de fila; con más de 100 errores no se ve el resto | Pestañas separadas, paginado completo, y las cantidades reales en cada pestaña |
| Una fila con error en la posición 0 se toma por aviso (o al revés) | `tipo` lo decide el backend con el prefijo exacto y `rowNumber`; el caso real de la remesa 35 es un test |
| La tabla dice "no hay errores" porque una lectura volvió vacía | Si la carga dice que hay y la lectura trae cero, la pantalla dice que no pudo leerlos y ofrece reintentar |
| "Ver errores" abre una pestaña sin sesión y da 401 (#17) | La descarga va por `axios` con el token, como un blob |
| El CSV se corta a mitad y parece completo | Una falla después de empezar destruye la respuesta: el navegador ve una descarga abortada y la pantalla un error |
| El CSV trae menos de lo que hay, por el tope | Se avisa antes de bajar, con los dos números, y en la última línea del archivo |
| Una celda del archivo del cedente se ejecuta como fórmula al abrir el CSV | Se neutraliza con un apóstrofo, salvo que sea un número |
| Un importe negativo del CSV queda como texto | La excepción de arriba: un número sigue siendo número |
| El botón Retomar se ofrece y siempre responde 409 | `retomable` descuenta el corte repetido en las lecturas HTTP, y la fila dice por qué no se puede |
| Retomar un grupo falla sin decir por qué | El 409 trae los motivos de cada remesa, y la pantalla los lista |
| "Confirmar las que no se pudieron encolar" usa otra remesa de origen | El origen lo lee el servidor de la fila; si no es el mismo en todas, 409; el diálogo lo muestra antes; si esa remesa ya no existe, no deja confirmar |
| Se confirman dos borradores del mismo corte desde el Historial y se duplica la nómina | `confirmar-pendientes` lo rechaza nombrando las dos |
| Se confirma desde el Historial un borrador viejo cuyo archivo ya se volvió a subir y cargar | El diálogo lo avisa con `yaCargadoEn`; con corte no deja confirmar (y el servidor lo rechaza igual); sin corte pide "Confirmar igual". El hueco del servidor para remesas sin corte sigue en el backlog |
| El Historial muestra una lista vieja y se actúa sobre algo que ya cambió | Socket, y consulta de respaldo (30 s con algo en curso, 60 s si no); toda acción que responde con un error refresca la lista |
| Quien no ve importaciones de otros no recibe sus eventos y la fila queda quieta | Para esas filas manda la consulta de respaldo |
| Una carga en curso queda en la página 2 y nadie la ve | "Hay N importaciones en curso que no están en esta página" |
| Una búsqueda activa esconde remesas | "Buscando «x»", con su botón para quitarla |
| Una división partida entre dos páginas parece incompleta | El encabezado dice cuántas hay en la página y cuántas son, con los números de todas |
| El primer pedido del Historial falla y la pantalla queda en blanco | Estado de error con "Reintentar" |
| El motivo de un botón deshabilitado, en celular, queda en un tooltip que no se ve | En la vista de tarjetas va escrito |
| El número de fila cambia de base y el operador le reporta al cedente una fila corrida | Tooltip en la columna, la wiki y el CHANGELOG lo dicen; el CSV usa la misma base que la pantalla; necesita el OK del usuario (§15) |
| El número de fila no es la línea del archivo cuando hay filtro o división | **No se arregla acá.** El tooltip lo dice y manda a mirar el contenido de la fila |
| El listado nuevo esconde remesas que el viejo mostraba | Sin filtro por estado en el servidor: mismo conjunto que `listRemesas`, paginado. Un test compara los totales |
| Un combo de remesa de origen cambia por error | `listRemesas` y su spec no tienen diff |
| El cambio en `DataTableResponsive` rompe otra pantalla | Propiedad opcional; sin ella no corre código nuevo; test |
| El lock del frontend queda desincronizado y el deploy falla | `npm ci` en copia limpia antes de commitear |
| Un permiso nuevo que nadie puede asignar | No aplica: no se agrega ninguno |
| Algo escrito al disco del contenedor que se pierde en el deploy | No aplica: el CSV se transmite, no se guarda |
| Una variable de entorno nueva que en prod no existe | No se agrega ninguna: el tope del CSV es una constante |

---

## 10. Plan de pruebas

### 10.1 Línea de base

**Medida el 09/10/2026 sobre el árbol de trabajo (HEAD `58bb9e1` + C1 sin commitear):**

- Backend: `npx jest src/modules/imports src/modules/realtime src/modules/notificaciones` → **52 suites,
  1.255 tests, todos pasan.** `npx jest` completo → **102 suites y 1.931 tests pasan** (1 suite y 3 tests
  salteados, que ya lo estaban).
- `prisma migrate diff` de la base local contra el schema del árbol → `This is an empty migration`.
- Frontend: `npx tsc --noEmit -p tsconfig.json` → **los mismos 5 errores**: `MappingEditor.tsx:443` y
  `:499`, `ImportHistory.tsx:423`, `Login.tsx:104`, `theme/components.ts:165`. El de `ImportHistory.tsx`
  está en una línea que C2a reescribe: al terminar tienen que quedar **esos 5 o 4**, ninguno nuevo.
- `npm run verificar-ayuda` → OK.
- `npm run build` del frontend: **no se ejecutó** al diseñar (escribe en `frontend/dist`); vale el de
  §10.16 del spec principal.
- Tests de frontend: **no hay**. La línea de base la deja FE-0.

### 10.2 Backend

**Qué pasa con los specs que ya existen. No se toca ninguno, con una excepción nombrada:**
`estado-carga.spec.ts:807` (§5.8). El diseño se armó mirando los asserts que lo obligan:

- Los cinco `throw` que ganan código conservan `e.message`; los specs que los afirman usan el mensaje.
- `remesasQueChocanConElCorte` conserva firma y resultado; se le extrae el cuerpo.
- `armarEstadoCarga` gana un campo y un extra opcional; sin el extra devuelve lo de hoy. Ningún spec
  compara un DTO entero con `toEqual` (afirmación de §10.9.1 del spec principal; si aparece uno, es el
  primer lugar donde mirar).
- `getErrors` cambia de firma: nadie lo llama salvo el controller y ningún spec lo afirma.
- `listRemesas`, `processImportJob`, el tracker y el reaper no tienen diff.

Si hace falta tocar otro assert existente: **parar y reportar**.

**Regla para los dobles** (§9.15 y §10.9.2 del spec principal, aplicada a lecturas): el `prisma` falso de
los specs B, C y G **filtra de verdad**. Honra `where` (igualdad, `in`, `gt`, `contains` y `startsWith`
**sin distinguir mayúsculas**, como la base; `OR`, `NOT`, la relación `progreso.is`), `orderBy`, `skip` y
`take`. Un doble que devuelve una lista fija deja pasar un `where` mal escrito, que en un listado es
mostrar de más o de menos en silencio.

**A. `utils/errores-carga.spec.ts`** (nuevo, puro)

| # | Caso | Qué tiene que dar |
|---|---|---|
| EC-1 | `tipoDeError(0, '[aviso] …')`, `'[parseo] …'`, `'[post-proceso] …'` | `AVISO` |
| EC-2 | `tipoDeError(0, '[AGNEJ0_EJ_9000001028_IEQ006_20260725.txt:1] Deudor no encontrado para pago (…)')` | `FILA`: es el caso real de la remesa 35 |
| EC-3 | `tipoDeError(7, '[aviso] x')` | `FILA`: un aviso siempre está en 0 |
| EC-4 | `tipoDeError(0, '[AVISO] x')` | `AVISO`, como lo trae el filtro de la base |
| EC-5 | `numeroDeFila` | 0 → 1; 251142 → 251143; un aviso → `null` |
| EC-6 | `whereAvisos` y `whereFilas` | La forma exacta. La de avisos es el mismo objeto que arma el runner en `imports.service.ts:4014-4025`, copiado literal en el test con un comentario que lo dice |
| EC-7 | `celdaCsv` | Texto simple tal cual; con `;`, comillas o salto de línea, entre comillas y con las internas duplicadas; `null` y `undefined` → vacío; un objeto → su JSON |
| EC-8 | `celdaCsv`, fórmulas | `=1+1`, `+cmd`, `@SUM(A1)`, `-2+3` y una tabulación inicial → con apóstrofo. `-1500,50`, `-3`, `+54911` → sin apóstrofo |
| EC-9 | `lineaCsv`, `nombreArchivoCsv` | Termina en `\r\n`; `00151/A b` → `errores-remesa-00151-A-b.csv` (o equivalente saneado, sin `/` ni espacios) |

**B. `imports-errores.spec.ts`** (nuevo; `ImportService` real)

| # | Caso | Qué tiene que pasar |
|---|---|---|
| ER-1 | 3 avisos y 5 filas, una de ellas en `rowNumber 0` | `tipo=FILA` → 5; `AVISO` → 3; `TODOS` → 8. `totales` es `{ filas: 5, avisos: 3 }` en las tres |
| ER-2 | Sin parámetros | Las cinco claves de hoy, en el mismo orden de filas, más `tipo`, `fila` y `totales` |
| ER-3 | 150 avisos y 20 filas, `tipo=FILA&pageSize=100` | Las 20 filas: el caso de §8.13 |
| ER-4 | `orden=desc` | Filas de mayor a menor; avisos por `id` descendente |
| ER-5 | Paginado con `rowNumber` repetidos | Página 1 y 2 sin repetir ni saltear ninguno |
| ER-6 | Remesa sin errores, y remesa que no existe | Lista vacía, totales en 0, no tira |
| ER-7 | CSV de 2 avisos y 3 filas | BOM, encabezado, cinco líneas, `;`, `\r\n`; el aviso sin fila ni columnas; la fila con sus campos en columnas |
| ER-8 | CSV de 4.500 registros | Tres lecturas de 2.000, cada una con el cursor de la anterior; ninguna con `skip`; el orden total se conserva |
| ER-9 | CSV con el tope en 3 y 5 registros | Tres líneas y la de "Se omitieron 2 registros: este archivo trae los primeros 3 de 5." |
| ER-10 | El cliente cierra la conexión después del primer lote | Ninguna lectura más; no tira |
| ER-11 | La segunda lectura rechaza | El método rechaza; no se escribe ninguna línea de cierre |
| ER-12 | CSV de una remesa que no existe | `NotFoundException` antes de escribir nada |
| ER-13 | La salida devuelve `false` al escribir | No se escribe la línea siguiente hasta el `drain` |

**C. `imports-historial.spec.ts`** (nuevo)

| # | Caso | Qué tiene que pasar |
|---|---|---|
| HI-1 | 30 remesas, página 2 de 25 | 5 filas, por `id` descendente; `total` 30, `totalPages` 2 |
| HI-2 | `q` | Encuentra por número y por nombre, sin distinguir mayúsculas; nunca una remesa de otra empresa |
| HI-3 | Una remesa de cada estado | `item.carga` es exactamente lo que da `armarEstadoCarga` para esa remesa: la cancelada con `cancelada: true`, la en cola con su `enColaDelante`, la heredada con `rev: 0` |
| HI-4 | Ninguna en cola | `posicionesEnCola` no se consulta |
| HI-5 | Un grupo de 5 con 2 en la página | `grupos[gid]` cuenta las 5. Con una eliminada: `existentes` 4, `total` 5 |
| HI-6 | Una retomable con corte cuyo corte figura en otra confirmada después | `retomable: false`, `corteRepetidoEn: ['X70']`; el grupo no la cuenta entre las `retomables` |
| HI-7 | La misma, con la otra confirmada **antes** de que esta se creara · en `SIN_CARGAR` · de otra plantilla | `retomable: true`, `corteRepetidoEn: null` |
| HI-8 | Pendientes de encolar | Un borrador con `resumen.origen` trae `pendienteDeEncolar` con sus hermanas (mismo archivo, plantilla, dueño y origen) y el origen resuelto; una remesa de origen eliminada va con `numeroRemesa: null`. Un borrador sin `resumen` → `null`. Una sin corte → solo ella. Otra de otro dueño o con otro origen → no entra. `yaCargadoEn`: trae la remesa del mismo archivo confirmada después (con corte y sin corte); vacío si esa otra se confirmó antes, es un borrador o es de otra plantilla |
| HI-9 | **Página de 25 con 3 grupos, 4 en cola y 2 pendientes** | A lo sumo 7 llamadas al doble. Con 100 filas, las mismas |
| HI-10 | `corte` y `archivos` | Salen de `divisionValores` y de `archivos.nombres`; `null` cuando no hay |
| HI-11 | La consulta de miembros devuelve vacío sin error | No tira; los grupos salen con lo que hay en la página |
| HI-12 | El conjunto | Con los mismos datos, `total` es igual a la cantidad que devuelve `listRemesas(empresaId)` |

**D. `imports-confirmar-pendientes.spec.ts`** (nuevo; espía `executeRemesa` y `ejecutarGrupo`, no los
vuelve a probar)

| # | Caso | Qué tiene que pasar |
|---|---|---|
| CP-1 | Una pendiente con `origen: { remesaOrigenId: 40 }` | `executeRemesa(id, usuario, 40, undefined)`; respuesta con `grupoId: null` |
| CP-2 | Tres pendientes del mismo archivo | `ejecutarGrupo({ remesaIds: [asc], remesaOrigenIds })`; respuesta con el `grupoId` nuevo |
| CP-3 | Ids repetidos y desordenados | Se deduplican y ordenan |
| CP-4 | Una no es pendiente: borrador sin `resumen` · en cola · terminal | `409` `NO_ES_PENDIENTE` que la nombra; ningún método de escritura se llama |
| CP-5 | Orígenes distintos | `409` `ORIGEN_DISTINTO`; nada se llama. `[1, 2]` y `[2, 1]` son el mismo origen |
| CP-6 | Dos con el mismo corte | `409` `CORTE_YA_CONFIRMADO` que nombra las dos |
| CP-7 | No es el dueño ni tiene `ver_progreso_otros` | `403`; nada se llama |
| CP-8 | Una no existe | `404` |
| CP-9 | El método delegado tira (`409` otra en curso · `503`) | Sale tal cual |

**E. `imports-grupo.spec.ts`** (casos nuevos)

| # | Caso | Qué tiene que pasar |
|---|---|---|
| GR-1 | El 409 del alta | `getResponse()` trae `code: 'CORTE_YA_CARGADO'`, `statusCode: 409`, `error: 'Conflict'` y `cortes` con `remesaId`, `numeroRemesa` y `situacion`; `e.message` es el de antes |
| GR-2 | El 409 de confirmar (una y grupo) y el de retomar por corte | `code: 'CORTE_YA_CONFIRMADO'` |
| GR-3 | Retomar un grupo con dos fallidas cuyo corte figura en otra | `409` `NINGUNA_RETOMABLE`; `omitidas` con las dos y su motivo; el mensaje las nombra |
| GR-4 | Retomar un grupo donde todas terminaron bien | `409` `NINGUNA_RETOMABLE`, `omitidas: []`, el texto de hoy |

**F. `progreso/estado-carga.spec.ts`** (casos nuevos, y el assert de `:807`)

| # | Caso | Qué tiene que pasar |
|---|---|---|
| ES-1 | `extras.corteRepetidoEn: ['X70']` sobre una retomable | `retomable: false`, `corteRepetidoEn: ['X70']` |
| ES-2 | Sin el extra, con `[]` y con `null` | Como hoy; `corteRepetidoEn: null` |
| ES-3 | Singulares | Cada fila de la tabla de §5.8, con 1 y con 2. Con 2, el texto de hoy carácter por carácter |
| ES-4 | Propiedad | Con todos los contadores en 1, ningún texto de `textoNotificacion`, `textoCancelacion`, `mensajeSinFilas` ni `textoInterrupcion` contiene `1 filas`, `las 1 `, `1 dieron`, `1 quedaron` ni `1 son ` |

**G. Lecturas con el extra** (en `imports-historial.spec.ts`)

| # | Caso | Qué tiene que pasar |
|---|---|---|
| RT-1 | `progreso`, `status` y `grupo` de una retomable con el corte repetido | `retomable: false` y `corteRepetidoEn` en las tres |
| RT-2 | `progreso` de una carga en curso, y de una retomable sin corte | Ninguna consulta de más que hoy (se cuentan) |
| RT-3 | `status` | Trae `origen` resuelto y `corte`; sin `resumen`, `origen: null` |

**H. `imports-progreso-controller.spec.ts`** (casos nuevos): las tres rutas nuevas existen con su
permiso; el CSV y `confirmar-pendientes` llevan `@Audit`; los DTO rechazan `pageSize=500` en el
Historial y `tipo=OTRO` en errores, y aceptan `pageSize=100` en errores (lo que manda una pestaña vieja).

### 10.3 Frontend

Cada archivo es de un paso del paquete (§13). "Portado" quiere decir traído del arnés de C1 en FE-0.

**`tests/unit/estadoCarga.test.ts`** (portado + nuevo)

| # | Caso |
|---|---|
| FU-1 | `presentarResultado`: cada oración con cantidad, con 1 y con 2 (con 2, el texto de hoy) |
| FU-2 | `oracionesSinFilas`: las cuatro combinaciones y sus singulares |
| FU-3 | Propiedad: con todos los contadores en 1, ningún texto contiene `1 filas`, `las 1 `, `1 dieron` ni `1 son ` |
| FU-4 | `codigoDeError`: con `code`, sin `code`, con un error que no es de axios |
| FU-5 | `motivoNoRetomablePorCorte`: con una remesa, con dos, sin ninguna |

**`tests/unit/historial.test.ts`** (nuevo, puro)

| # | Caso |
|---|---|
| FU-6 | `estadoParaHistorial`: las 14 filas de la tabla de §6.3, una por una; y un DTO de un backend viejo (sin `cancelada`, sin `grupoId`): no tira. Nunca devuelve "PENDIENTE" ni "VALIDANDO"; nunca "Fallida" para una cancelada |
| FU-7 | `ordenarParaMostrar` e `inicioDeBloque`: un grupo entero; dos grupos pegados; un grupo con una remesa suelta en el medio; un grupo cortado por el fin de la página |
| FU-8 | `accionesDeFila`: la matriz de permisos × dueño × estado, con el motivo de cada acción deshabilitada |
| FU-9 | `textoEliminar`: las siete filas de la tabla de §6.4 |
| FU-10 | Texto del encabezado de división: singular y plural, "(2 de las 5 están en esta página)", "(1 se eliminó)" |

**`tests/paginas/historial.test.tsx`** (nuevo; la página real contra el servidor falso)

| # | Caso |
|---|---|
| FH-1 | Una remesa de cada estado: cada fila con su etiqueta. En ninguna parte de la pantalla aparece "PENDIENTE" ni "VALIDANDO" |
| FH-2 | Una remesa en cola de una división y un borrador: se ven distintas, y la primera con su posición |
| FH-3 | `import:progreso` de una fila: cambia el porcentaje **sin ninguna consulta**. `import:finalizada`: cambia el estado y hay **una** consulta de refresco |
| FH-4 | Evento de una remesa que no está: en la página 1, un refresco; en la 2, ninguno |
| FH-5 | Evento de otra empresa, o que no pasa `esEstadoCarga`: nada |
| FH-6 | Una respuesta lenta con un `rev` viejo no pisa un evento más nuevo |
| FH-7 | Paginado: pasar de página pide `page=2`; cambiar de empresa o de búsqueda vuelve a la 1 |
| FH-8 | Búsqueda: pide con `q`, muestra "Buscando «x»" y se puede quitar |
| FH-9 | División: el encabezado con los números de `grupos`, las filas en orden 1..N, y "(2 de las 5…)" cuando el tramo no las trae todas |
| FH-10 | "Hay N importaciones en curso que no están en esta página" |
| FH-11 | El primer pedido falla (500, y sin red): `Alert` con "Reintentar", no una tabla vacía; reintentar funciona |
| FH-12 | El backend no tiene la ruta (404): el mismo estado de error |
| FH-13 | Con DTOs de un backend viejo, la pantalla no muestra `NaN`, `undefined`, `null` ni `[object` |
| FH-14 | Ancho de celular (`fijarAncho(360)`): tarjetas, cada una con su estado, sus acciones y el motivo escrito de las deshabilitadas; el encabezado de división está. Ancho de escritorio: tabla |
| FH-15 | Tema oscuro: monta y muestra lo mismo |

**`tests/paginas/historial-acciones.test.tsx`** (nuevo)

| # | Caso |
|---|---|
| FA-1 | Cancelar una en cola desde la fila: el diálogo de C1, un `POST` y la fila pasa a "Cancelada antes de empezar" con la respuesta, sin esperar un evento |
| FA-2 | Cancelar desde una fila de una división: "Cancelar todo lo que falta" es un `POST` al grupo |
| FA-3 | Retomar: la confirmación con su texto, un `POST`, la fila pasa a "En cola". Dos clics seguidos, un `POST` |
| FA-4 | Retomar que responde `409`: toast con el mensaje, refresco, y el botón ya no está |
| FA-5 | "Retomar las 2 que no se cargaron" del encabezado; con `409` `NINGUNA_RETOMABLE`, se listan los motivos de `omitidas` |
| FA-6 | Confirmar pendientes: el diálogo lista remesas, cortes y origen; el `POST` lleva los ids; las filas pasan a "En cola" |
| FA-7 | Confirmar con la remesa de origen eliminada: botón deshabilitado, con el motivo. Con `yaCargadoEn`: la advertencia nombra la remesa; con corte, deshabilitado; sin corte, "Confirmar igual" |
| FA-8 | Confirmar que responde `503`: toast; siguen "No se pudo encolar" |
| FA-9 | Eliminar: el diálogo de cada estado con su texto (borrador, en cola con y sin división, pagos, acciones). Una que está procesando: deshabilitado, con el motivo |
| FA-10 | Eliminar que responde `400`, `403` o `404`: toast con el mensaje del backend y refresco |
| FA-11 | Permisos: sin `importacion.ejecutar`, ni cancelar ni retomar ni confirmar; sin `importacion.eliminar`, sin el botón; otro usuario sin `ver_progreso_otros`, nada sobre cargas ajenas |
| FA-12 | Consolidar, revertir y política siguen andando (un caso de cada uno) |

**`tests/componentes/errores-de-carga.test.tsx`** (nuevo)

| # | Caso |
|---|---|
| FE-1 | 483 filas y 2 avisos: dos pestañas con sus cantidades; cada una pide con su `tipo` |
| FE-2 | 150 avisos y 20 filas: la pestaña de filas muestra las 20 |
| FE-3 | La fila guardada en la posición 0 se muestra como "1", no como "—"; un aviso, "—" |
| FE-4 | Paginado: la página 2 pide `page=2` |
| FE-5 | Carga en curso: `carga.err` sube tres veces en dos segundos → una sola consulta nueva; al terminar, una más |
| FE-6 | La carga dice `err > 0` y la respuesta trae los totales en 0: "No se pudieron leer los errores" y "Reintentar"; nunca "No hay errores" |
| FE-7 | Descargar: un `GET` con `Authorization`; no se llama a `window.open`; el blob llega a `descargarBlob` con el nombre |
| FE-8 | Descargar con `404`: el toast dice el mensaje del backend, no un genérico |
| FE-9 | La descarga se corta a la mitad: toast de error y `descargarBlob` no se llama |
| FE-10 | Más de 200.000: pide confirmación con los dos números antes de bajar |
| FE-11 | Backend viejo (sin `totales`): una sola lista, sin pestañas ni botón; los avisos con "—" |
| FE-12 | Claves de pago: "Trámite" en vez de "Fila" |

**`tests/componentes/cancelar.test.tsx`** (portado + nuevo)

| # | Caso |
|---|---|
| FC-1 | Lo portado de C1 sigue en verde **antes y después** del cambio |
| FC-2 | Variante de ícono: `IconButton` con tooltip; no cancelable → deshabilitado, con el motivo en el tooltip |
| FC-3 | Lista viva: con el diálogo abierto llega `import:iniciada` de una hermana, y el texto pasa de "las 2 que no empezaron" a nombrarla como la que está en curso, antes de cualquier clic |
| FC-4 | La lectura del grupo falla y la propiedad `grupo` es `[]`: sale "no se pudieron leer las demás" y solo se ofrece cancelar esta |
| FC-5 | Veinticinco botones montados y ningún diálogo abierto: ningún pedido al grupo |

**`tests/componentes/tabla-responsive.test.tsx`** (nuevo)

| # | Caso |
|---|---|
| FT-1 | Sin `encabezadoAntesDe`: tantas filas (o tarjetas) como datos, y ninguna de ancho completo, en escritorio y en celular |
| FT-2 | Con la propiedad: la fila de ancho completo antes de las indicadas, en los dos modos |

**`tests/paginas/detalle.test.tsx`** (portado + nuevo): FD-1, lo portado en verde; FD-2, los renglones
"Corte" y "Remesas de origen" cuando el backend los manda y nada cuando no; FD-3, con `corteRepetidoEn`
no hay botón Retomar y está la línea que lo explica.

**`tests/paginas/asistente-cortes.test.tsx`** (portado + nuevo): FW-1, el 409 del alta con `code` y un
mensaje **sin** la frase vuelve a pedir la vista de cortes; FW-2, sin `code` y con la frase, igual; FW-3,
otro 409 no la pide.

**`tests/lento/historial-en-vivo.test.tsx`** (nuevo; `npm run test:lento`)

| # | Caso |
|---|---|
| FL-1 | Socket caído y una fila en curso: una consulta cada 15 s; cuando termina, se corta |
| FL-2 | Socket conectado, una fila en curso de la que no llegan eventos (la de otro usuario): consulta a los ~30 s y la fila se actualiza |
| FL-3 | Nada en curso: en la página 1, una consulta por minuto; en la 2, ninguna |
| FL-4 | Pestaña oculta: ninguna; al volver, una |
| FL-5 | Al desmontar: ninguna consulta después |

**`tests/tema/colores.test.ts`** (nuevo): FX-1, los archivos de `frontend/src` que C2a crea o reescribe
no contienen colores escritos a mano (`#rgb`, `#rrggbb`, `rgb(`, `rgba(`, `hsl(`). Se leen como texto.

**Y los tres controles de siempre**, obligatorios:

```bash
cd frontend
npx tsc --noEmit -p tsconfig.json        # los 5 errores de base (o 4); ninguno nuevo
npx tsc --noEmit -p tests/tsconfig.json  # ningún error en archivos de tests/
npm test                                 # todo verde
npm run test:lento                       # todo verde (aparte: tarda minutos)
npm run build
npm run verificar-ayuda
```

### 10.4 Lo que se prueba contra la base de verdad

Lecturas sobre la base local (nunca prod); las repite el auditor. Ninguna escribe.

| # | Sonda | Resultado esperado |
|---|---|---|
| SH-1 | `getErrors(35, { tipo: 'AVISO' })` y `{ tipo: 'FILA' }` sobre la remesa 35 real | 0 avisos; 483 filas; la primera con `rowNumber 0`, `tipo: 'FILA'`, `fila: 1` |
| SH-2 | `SELECT '[AVISO] x' LIKE '[aviso]%'` | 1: la base no distingue mayúsculas (lo que EC-4 supone) |
| SH-3 | `EXPLAIN` de la lectura por clave del CSV | Usa `ImportError_remesaId_rowNumber_idx`, sin `filesort` |
| SH-4 | CSV de la remesa 35 | 484 líneas (encabezado y 483), con BOM y `;`; cada línea trae el contenido de la fila en columnas |
| SH-5 | `historial(empresa 40)` con el log de consultas de Prisma | A lo sumo 6 consultas |
| SH-6 | `historial` y `listRemesas` de la misma empresa | El mismo conjunto de ids |

Y, con la aplicación levantada en local (el auditor; escribe en la base local): parar Redis, confirmar
una división de PAGOS con remesa de origen, ver el 503, cerrar el asistente, levantar Redis y confirmar
desde el Historial: las remesas corren con el origen elegido (se mira `resumen.origen` y el log
`Encolando grupo`). Todo arnés que levante la aplicación lleva `LOG_DIR` a un directorio temporal.

### 10.5 Celular y tema: qué se afirma sin navegador y qué no

| Qué | Sin navegador (test) | Solo en un navegador |
|---|---|---|
| Que cada estado, acción y texto aparezca donde tiene que aparecer | Sí | — |
| Que en ancho de celular se dibujen tarjetas y traigan el estado, las acciones y el motivo escrito de lo deshabilitado | Sí (`matchMedia` simulado: FH-14, FT-1, FT-2) | — |
| Que la pantalla monte en claro y en oscuro sin tirar | Sí (FH-15) | — |
| Que no haya colores escritos a mano | Sí (FX-1) | — |
| Que el chip se lea sobre el fondo en oscuro; contraste real | No | Sí |
| Desbordes, cortes de palabra, barra de desplazamiento horizontal, con un nombre o un motivo largos | No: jsdom no calcula layout | Sí |
| Tamaño táctil de los íconos de la fila; siete íconos en una tarjeta de 360 px | No | Sí |
| El diálogo en una pantalla baja, con el teclado abierto | No | Sí |
| El encabezado de división en celular | Que exista, sí | Cómo se ve |
| La descarga: que Excel abra el archivo, con acentos y columnas | El pedido, el nombre y el contenido (ER-7), sí | Que abra bien |
| Fluidez con 100 filas y un evento por segundo | No | Sí |

El paso completo por celular (hoja inferior, grilla de contadores) es de C2b. La vara de C2a es **no
empeorar**: el Historial ya dibuja tarjetas en celular y tiene que seguir haciéndolo, con lo nuevo adentro.

### 10.6 Prueba manual (la usan el auditor y los usuarios que prueban)

Con la aplicación levantada en local y **un navegador**: es la primera vez que esta evolución se ve.
Preparación: la de §10.9.5 del spec principal (`IMPORTS_BATCH_SIZE=100`, el CSV de DEUDORES dividido por
nómina), más un archivo de PAGOS con más de 100 filas que no encuentran su caso y una remesa de origen.

| # | Qué hacer | Qué tiene que verse |
|---|---|---|
| MH-1 | Abrir el Historial con una carga de cada tipo: borrador, en cola, procesando, finalizada, con errores, fallida, cancelada | Cada una con su etiqueta. En ningún lado dice PENDIENTE ni VALIDANDO. La cancelada dice "Cancelada", no "Fallida" |
| MH-2 | Con el Historial abierto, lanzar una carga desde otra pestaña | La fila aparece sola, avanza y termina sin tocar nada |
| MH-3 | Lo mismo, mirando con un usuario **sin** "Ver importaciones de otros usuarios" la carga de otro | Aparece y se actualiza sola, con hasta 30 s de atraso (un minuto si no había nada en curso) |
| MH-4 | Una división de 3 | Encabezado "Carga dividida · 3 remesas" con los números al día; las filas en orden; el corte de cada una |
| MH-5 | Durante la segunda, Cancelar desde su fila → "Cancelar todo lo que falta" | El diálogo de siempre. La segunda queda "Cancelada", la tercera "Cancelada antes de empezar"; el encabezado ofrece "Retomar…" solo para la que no cargó nada |
| MH-6 | Retomar desde la fila | Vuelve a "En cola" y corre, sin recargar |
| MH-7 | **Parar Redis**, confirmar una división de PAGOS con remesa de origen, esperar el aviso de la cola y **cerrar el asistente**. Abrir el Historial | Tres filas "No se pudo encolar". Levantar Redis → Confirmar: el diálogo lista las tres con su corte y la remesa de origen elegida. Corren las tres; en la base, `resumen.origen` es el elegido |
| MH-8 | Tacho sobre una remesa en cola | El diálogo dice que está confirmada y en cola, que eliminarla la saca, y nombra Cancelar. "Eliminar igual" la elimina; las otras de la división siguen |
| MH-9 | Tacho sobre una remesa de pagos terminada, y sobre una de acciones masivas | Cada diálogo dice lo suyo: no deshace; no revierte y mata el Revertir |
| MH-10 | Detalle de la carga de PAGOS con más de 100 errores | Dos pestañas con sus cantidades; paginado; la primera fila con error dice "1"; el tooltip de la columna explica el número |
| MH-11 | "Descargar CSV" y abrirlo en Excel | Baja sin pedir sesión; acentos bien; una columna por campo de la fila original |
| MH-12 | Un archivo con una celda `=1+1` y un importe `-1500,50`, que den error, y su CSV | Excel muestra `=1+1` como texto, no como 2; el importe sigue siendo un número |
| MH-13 | Detalle de una carga en curso con filas inválidas | La tabla de errores crece sola, sin recargar y sin saltar de página |
| MH-14 | Cancelar una remesa de una división en cola; volver a subir el archivo y cargar ese corte en otra remesa | La cancelada **no** ofrece Retomar, ni en el Historial ni en su detalle, y dice en qué remesa quedó su corte |
| MH-15 | Con más de 25 remesas: pasar de página, buscar por número, y dejar una carga en curso fuera de la página | Paginado y búsqueda andan; arriba avisa de la carga que no se ve |
| MH-16 | Con el bundle de C1 (pestaña vieja) contra el backend nuevo: abrir un detalle con errores; subir un archivo con un corte ya cargado | El detalle viejo muestra sus 100 errores como antes; el alta rechazada vuelve a mostrar los cortes |
| MH-17 | Todo lo anterior en claro, en oscuro, a 360 px y a 768 px, con un nombre de remesa largo y un motivo largo | Se lee todo, nada se desborda, los íconos se pueden tocar, el motivo de lo deshabilitado se lee sin tooltip |

---

## 11. Documentación

- **Wiki** (`docs/ayuda/03-importacion/`, paquete de frontend; cambia en el mismo commit que la pantalla
  y actualiza el `revisado` de cada página):
  - `08-historial-y-problemas.md` — la que más cambia. La tabla "Los estados" (`:27-35`) pasa a ser la
    de §6.3. Dejan de ser ciertos y se reescriben: que el detalle dice "Borrador" o "En cola" y la grilla
    no (`:37-40`); "Una carga cancelada figura como FALLIDA" y "los botones no están en la grilla"
    (`:42-47`); "Una remesa PENDIENTE no siempre es un borrador… entrá a su detalle" (`:49-51`); "El
    Historial no distingue una carga con advertencias" (`:65-67`); "Muestra solo los primeros 100"
    (`:78`); "la primera fila de datos es la 0" (`:81-82`), que pasa a explicar el número desde 1 **y que
    cambió**; "En la grilla el botón solo se deshabilita en las que están procesando" (`:199`); "apretá
    Actualizar en el Historial: la grilla no se refresca sola" (`:324-325`). Se agregan: las pestañas de
    errores y avisos, el paginado y el CSV; el paginado y la búsqueda del Historial; la división agrupada;
    Cancelar, Retomar y Confirmar en "Otras acciones del historial" (`:253-270`); qué dice el diálogo de
    eliminar en cada caso; cada cuánto se actualiza sola la lista y por qué a veces tarda 30 s.
  - `05-importar-un-archivo.md` — "Cargar las que faltan vive solo en el asistente… hay que eliminarlas
    y volver a subir esos cortes" (`:284-286`, `:715-716`) deja de ser cierto: se confirman desde el
    Historial mientras el borrador exista. "La primera fila de datos es la 0" (`:397`) y "solo los
    primeros 100" (`:399`). "Las remesas que esperan su turno figuran PENDIENTE… entrá a su detalle"
    (`:719-720`). Donde dice que cancelar y retomar están "en su detalle", sumar el Historial. Donde
    nombra los estados PENDIENTE o VALIDANDO del Historial (`:181`, `:192`, `:609`, `:723`), pasar a
    "Borrador".
  - `01-como-funciona.md` — la tabla de estados (`:118`).
  - `06-actualizaciones.md`, `07-acciones-masivas.md`, `09-…`, `10-…`: solo si la revisión encuentra una
    frase que dejó de ser cierta (buscar `PENDIENTE`, `VALIDANDO`, `primeros 100`, `la 0`, `no se refresca`,
    `desde su detalle`).
  - `cd frontend && npm run verificar-ayuda`. Cada página pasa por un agente revisor antes de cerrarse
    (memoria `auditar-documentacion-con-agentes`): en las tres fases anteriores todas salieron con errores
    en la primera revisión.
  - Los textos de pantalla se copian de §6, no se parafrasean.
- **`docs/notificaciones-spec.md`** (paquete de backend): los singulares de los textos de la
  notificación, y una entrada fechada. Nada más: C2a no cambia cuándo ni a quién se notifica.
- **`CHANGELOG.md`**: lo escribe quien orquesta, al cerrar, con lo que devuelva cada implementer.
- **El spec principal**: §17 de este documento dice qué actualizar.
- **`CLAUDE.md`**: en "Comandos → Frontend" hoy dice "No hay lint ni tests configurados en el frontend".
  Pasa a nombrar `npm test` y `npm run test:lento`. Lo cambia quien orquesta, con el commit del arnés.
- **Memorias** (fuera del repo, quien orquesta): `progreso-imports-realtime`.

---

## 12. Criterios de aceptación

**Schema, permisos y deploy**

"Sin diff" quiere decir **respecto del árbol al empezar C2a**, que incluye C1. Si C1 está commiteada, es
`git diff` a secas. Si no, quien orquesta guarda antes de empezar el `sha256sum` de los archivos que no
se tocan (§13) y se compara al final: con C1 sin commitear, `git diff` de esos archivos muestra C1.

- **C2A-1.** `schema.prisma` no cambia. `prisma migrate diff` da `This is an empty migration` antes y
  después. Ninguna variable de entorno nueva.
- **C2A-2.** `permisos-catalogo.ts` no cambia.
- **C2A-3.** No cambian `backend/src/modules/imports/processors/`, `progreso/progreso-tracker.ts`,
  `progreso/reaper-cargas.service.ts`, `bullmq/` ni `imports.module.ts`. En `imports.service.ts`, el
  cuerpo de `processImportJob` y el de `listRemesas` quedan idénticos.

**Backend, automáticos**

- **C2A-4.** `npm run build` pasa. Las 52 suites y los 1.255 tests de base pasan, y el único assert
  existente que cambia es `estado-carga.spec.ts:807`. `imports-list-remesas.spec.ts` no tiene diff.
- **C2A-5.** Pasan los specs A a H de §10.2.
- **C2A-6.** El Historial devuelve, para cada remesa, la misma `carga` que `GET …/progreso` (HI-3, RT-1).
- **C2A-7.** El número de consultas del Historial no depende del tamaño de la página (HI-9).
- **C2A-8.** El Historial devuelve el mismo conjunto de remesas que `listRemesas`, paginado (HI-12, SH-6).
- **C2A-9.** Una fila con error en la posición 0 es `FILA` y un aviso es `AVISO`, con el dato real de la
  remesa 35 (EC-2, SH-1).
- **C2A-10.** Con 150 avisos y 20 filas con error, `tipo=FILA` devuelve las 20 (ER-3).
- **C2A-11.** `GET /import/errores/:id?pageSize=100` responde las cinco claves de hoy en el mismo orden (ER-2).
- **C2A-12.** El CSV pagina por clave, respeta el tope avisándolo en la última línea, y una falla a mitad
  no termina la respuesta (ER-8, ER-9, ER-11).
- **C2A-13.** Una celda que empieza con `=`, `+`, `-` o `@` sale neutralizada, y un importe negativo no (EC-8).
- **C2A-14.** `retomable` es `false`, con `corteRepetidoEn`, en `historial`, `progreso`, `status` y
  `grupo` cuando el corte figura en otra remesa confirmada después; y `true` en los tres casos de HI-7.
- **C2A-15.** Los 409 de la tabla de §4.5 traen su `code` y conservan su texto (GR-1, GR-2).
- **C2A-16.** Retomar un grupo sin ninguna retomable responde con el motivo de cada una (GR-3).
- **C2A-17.** `confirmar-pendientes` no llama a ningún método de escritura si alguna remesa no es
  pendiente, si los orígenes difieren, si dos comparten corte o si el usuario no puede (CP-4 a CP-7); y
  confirma con el origen guardado en la fila, no con uno del pedido (CP-1, CP-2).
- **C2A-18.** Con todos los contadores en 1, ningún texto del backend dice "1 filas" ni "1 dieron" (ES-4).
- **C2A-19.** Las sondas SH-1 a SH-6 dan lo esperado, o está reportado cuál no.

**Frontend, automáticos**

- **C2A-20.** FE-0 está hecho **antes** que cualquier cambio de `frontend/src`: el informe trae la línea
  de base (archivos, pruebas, duración) y la clasificación de cada prueba portada que hubo que tocar.
- **C2A-21.** `npm test` y `npm run test:lento` pasan. `tsc -p tsconfig.json` da los 5 errores de base (o
  4); `tsc -p tests/tsconfig.json`, ninguno en `tests/`. `npm run build` y `npm run verificar-ayuda` pasan.
- **C2A-22.** `git diff` de `frontend/vite.config.ts` y `frontend/tsconfig.json`: vacío. Ninguna
  dependencia nueva en `dependencies`.
- **C2A-23.** El Historial nunca muestra "PENDIENTE" ni "VALIDANDO", ni "Fallida" para una cancelada
  (FU-6, FH-1).
- **C2A-24.** Un evento de progreso actualiza la fila sin ninguna consulta; uno de cierre dispara una
  sola (FH-3).
- **C2A-25.** Con el socket sin eventos para una fila en curso, la lista se actualiza a los ~30 s (FL-2).
- **C2A-26.** Cada acción de fila se ofrece solo con su permiso y sobre su estado (FU-8, FA-11), y el
  diálogo de eliminar dice un texto distinto para un borrador, una en cola, una de pagos y una de
  acciones (FU-9, FA-9).
- **C2A-27.** La tabla de errores nunca dice que no hay errores cuando la carga dice que hay (FE-6).
- **C2A-28.** La descarga del CSV va con la sesión y nunca abre una pestaña (FE-7); una descarga cortada
  se informa como error (FE-9).
- **C2A-29.** Las pruebas de cancelar portadas de C1 pasan antes y después de cambiar
  `BotonCancelarCarga` (FC-1), y el diálogo abierto refleja una remesa que arranca (FC-3).
- **C2A-30.** `DataTableResponsive` sin la propiedad nueva dibuja lo mismo que antes (FT-1).
- **C2A-31.** Ningún archivo creado o reescrito tiene colores escritos a mano (FX-1).
- **C2A-32.** Con todos los contadores en 1, ningún texto del frontend dice "1 filas" (FU-3).
- **C2A-33.** `npm ci` pasa en una copia limpia de `frontend/package.json` y `package-lock.json`.

**Manuales y documentación**

- **C2A-34.** MH-1 a MH-17 hechos **en un navegador**, o está dicho cuáles no y por qué.
- **C2A-35.** Las remesas que no se pudieron encolar se confirman desde el Historial con el asistente
  cerrado, y corren con la remesa de origen elegida (MH-7).
- **C2A-36.** Ninguna página de la wiki dice que el Historial muestra PENDIENTE o FALLIDA para lo que ya
  no, que el detalle muestra solo 100 errores, que la primera fila es la 0, que la grilla no se refresca
  sola, ni que "Cargar las que faltan" vive solo en el asistente.

---

## 13. Paquetes de trabajo

Dos paquetes con **conjuntos de archivos disjuntos**, para dos `implementer` en paralelo sobre el mismo
árbol. El contrato de §4 es el único punto de contacto: el frontend se escribe y se prueba contra el
servidor falso del arnés, sin esperar al backend. Valen las reglas de §8.12, §9.15 y §10.12 del spec
principal: nadie commitea; nadie toca un archivo del otro paquete, ni `CHANGELOG.md`, ni el spec
principal, ni este documento; nada de `npm run lint` / `eslint --fix` / `prisma format`; **nada de
`git stash` ni de ningún comando que mueva el árbol** (para comparar contra la base, `git show HEAD:ruta`;
ojo: en `HEAD` no está C1); todo arnés que levante la aplicación lleva `LOG_DIR` a un directorio
temporal; ante una duda de contrato manda §4; y cada informe trae lo hecho, los desvíos, la salida de la
verificación y el texto para el CHANGELOG.

**El árbol tiene C1 sin commitear.** Los dos paquetes trabajan encima. **Conviene commitear C1 antes de
empezar**: `git diff` pasa a mostrar solo C2a, y "este archivo no se toca" se verifica con un comando. Si
no se commitea, quien orquesta guarda antes de empezar el `sha256sum` de los archivos que no se tocan,
porque `git diff` de varios de ellos va a mostrar los cambios de C1.

### Paquete BE — backend

| Archivo | Qué |
|---|---|
| `backend/src/modules/imports/progreso/estado-carga.types.ts` | `corteRepetidoEn` (§4.1) |
| `backend/src/modules/imports/progreso/estado-carga.ts` | El extra `corteRepetidoEn` en `ExtrasEstado` y en `armarEstadoCarga`; `plural`; los singulares de §5.8 |
| `backend/src/modules/imports/progreso/estado-carga.spec.ts` | Casos nuevos (spec F) y el assert de `:807` |
| `backend/src/modules/imports/historial.types.ts` | **Nuevo.** §4.2, §4.3, `CodigoErrorImport` |
| `backend/src/modules/imports/utils/errores-carga.ts` | **Nuevo.** Clasificación, filtros, número de fila y CSV (§5.3, §5.4) |
| `backend/src/modules/imports/utils/errores-carga.spec.ts` | **Nuevo.** Spec A |
| `backend/src/modules/imports/dtos/import.dto.ts` | `HistorialQueryDto`, `ErroresQueryDto`, `ConfirmarPendientesDto` |
| `backend/src/modules/imports/imports.service.ts` | Nuevos: `historial`, `cortesRepetidosDe`, `choquesDeCorte` (extraída de `remesasQueChocanConElCorte`), `erroresCsv`, `confirmarPendientes`, `conflicto`. Cambian: `getErrors`; `status`, `progreso` y `grupo` (pasan el extra; `status` suma `origen` y `corte`); los cinco `throw` de §4.5 |
| `backend/src/modules/imports/imports.controller.ts` | `GET historial`, `GET errores/:remesaId/csv`, `POST remesas/confirmar-pendientes`; `GET errores/:remesaId` con su DTO |
| `backend/src/modules/imports/imports-errores.spec.ts` | **Nuevo.** Spec B |
| `backend/src/modules/imports/imports-historial.spec.ts` | **Nuevo.** Specs C y G |
| `backend/src/modules/imports/imports-confirmar-pendientes.spec.ts` | **Nuevo.** Spec D |
| `backend/src/modules/imports/imports-grupo.spec.ts` | Casos nuevos (spec E). Ningún assert existente |
| `backend/src/modules/imports/imports-progreso-controller.spec.ts` | Casos nuevos (spec H) |
| `docs/notificaciones-spec.md` | §11 |

No se tocan: `schema.prisma`, ningún archivo de `processors/`, `progreso/progreso-tracker.ts`,
`progreso/reaper-cargas.*`, `bullmq/`, `imports.module.ts`, `realtime/`, `permisos-catalogo.ts`,
`.env.example`, `imports-list-remesas.spec.ts`; dentro de `imports.service.ts`, ni `processImportJob` ni
`listRemesas`; ni ningún assert existente salvo `estado-carga.spec.ts:807`.

Pasos:

1. **BE-0 — Las sondas de lectura SH-1 a SH-3** (§10.4), antes de escribir código: confirman el dato
   real que motiva la clasificación, la collation y el índice. Si SH-1 no da lo esperado, **parar**.
2. **BE-1 — Contrato y funciones puras:** tipos, `estado-carga.ts` (extra y singulares) y
   `utils/errores-carga.ts`, con los specs A y F.
3. **BE-2 — Códigos en los 409 y retomar un grupo**, con el spec E. Correr `imports-grupo.spec.ts`
   entero: es donde están los asserts de esos textos.
4. **BE-3 — `retomable` honesto:** `choquesDeCorte`, `cortesRepetidosDe`, y el extra en `progreso`,
   `status` y `grupo`, con el spec G.
5. **BE-4 — `historial`**, con el spec C.
6. **BE-5 — Errores y CSV**, con el spec B.
7. **BE-6 — `confirmarPendientes`**, con el spec D.
8. **BE-7 — Controller, DTO, `origen` y `corte` en `status`, `docs/notificaciones-spec.md`**, con el spec H.
9. **BE-8 — Verificación:**

```bash
cd backend
npx prisma migrate diff --from-schema-datasource prisma/schema.prisma \
    --to-schema-datamodel prisma/schema.prisma --script      # → "This is an empty migration."
npm run build
npx jest src/modules/imports src/modules/realtime src/modules/notificaciones
npx jest
# Los archivos que no se tocan, contra el árbol al empezar (con C1 commiteada, `git diff --stat` vacío;
# si no, contra los `sha256sum` guardados antes de empezar):
sha256sum src/modules/imports/progreso/progreso-tracker.ts src/modules/imports/progreso/reaper-cargas.service.ts \
    src/modules/imports/imports.module.ts src/modules/imports/imports-list-remesas.spec.ts \
    src/auth/permisos-catalogo.ts prisma/schema.prisma
git diff --stat -- src/modules/imports/processors/        # → vacío en los dos casos: C1 no tocó ningún processor
```

### Paquete FE — frontend

| Archivo | Qué |
|---|---|
| `frontend/package.json`, `frontend/package-lock.json` | Scripts de test y las cuatro `devDependencies` (§7.2). Nada en `dependencies` |
| `frontend/vitest.config.ts` | **Nuevo** |
| `frontend/tests/**` | **Nuevo.** Arnés (§7.2) y las pruebas de §10.3 |
| `frontend/src/types/importProgreso.ts` | `corteRepetidoEn` |
| `frontend/src/types/importHistorial.ts` | **Nuevo.** Copia textual de `historial.types.ts` |
| `frontend/src/api/imports.ts` | `obtenerHistorial`, `obtenerErrores`, `descargarErroresCsv`, `confirmarPendientes`, `eliminarRemesa`; `noEncoladas?` en `RetomarGrupoRespuesta` |
| `frontend/src/utils/estadoCarga.ts` | `plural` y los singulares; `oracionesSinFilas`; `codigoDeError`; los textos de retomar; `motivoNoRetomablePorCorte` |
| `frontend/src/utils/historialImportaciones.ts` | **Nuevo.** `estadoParaHistorial`, `ordenarParaMostrar`, `inicioDeBloque`, `accionesDeFila`, `textoEliminar`, el texto del encabezado |
| `frontend/src/utils/descargas.ts` | **Nuevo.** `descargarBlob`, `mensajeDeErrorDeBlob` |
| `frontend/src/hooks/useHistorialImportaciones.ts` | **Nuevo.** §6.2 |
| `frontend/src/components/ui/DataTableResponsive.tsx` | `encabezadoAntesDe` (§6.8) |
| `frontend/src/components/import/ImportProgress.tsx` | **Solo `BotonCancelarCarga`** (§6.6). El componente `ImportProgress` no se toca |
| `frontend/src/components/import/ErroresDeCarga.tsx` | **Nuevo.** §6.5 |
| `frontend/src/components/import/historial/AccionesHistorial.tsx`, `EncabezadoDivision.tsx`, `CeldasHistorial.tsx` | **Nuevos.** §6.3, §6.4. El implementer puede juntarlos si quedan chicos |
| `frontend/src/pages/ImportHistory.tsx` | Reescritura (§6.3) |
| `frontend/src/pages/ImportDetail.tsx` | La sección de errores pasa a `ErroresDeCarga`; renglones de corte y origen; el texto de retomar desde la constante; la línea de `motivoNoRetomablePorCorte`. Nada más |
| `frontend/src/pages/ImportWizard.tsx` | Las dos ediciones de §6.7. Nada más |
| `docs/ayuda/03-importacion/01-como-funciona.md`, `05-importar-un-archivo.md`, `08-historial-y-problemas.md` (y las otras solo si la revisión encuentra algo) | §11 |

No se tocan: lo de §6.9.

Pasos (cada uno con su archivo de pruebas de §10.3):

1. **FE-0 — El arnés y lo portado** (§7.3). Termina con `npm test` en verde y la línea de base anotada.
   **Antes que cualquier cambio en `frontend/src`.**
2. **FE-1 — Tipos, API y utilidades puras** → `tests/unit/estadoCarga.test.ts`, `tests/unit/historial.test.ts`.
3. **FE-2 — `DataTableResponsive`** → `tests/componentes/tabla-responsive.test.tsx`.
4. **FE-3 — Cancelar: variante de ícono y diálogo vivo** → `tests/componentes/cancelar.test.tsx`
   (lo portado tiene que seguir verde).
5. **FE-4 — `useHistorialImportaciones`** → los casos FH-3 a FH-6 y `tests/lento/historial-en-vivo.test.tsx`.
6. **FE-5 — La página del Historial** → `tests/paginas/historial.test.tsx`.
7. **FE-6 — Acciones de la fila** → `tests/paginas/historial-acciones.test.tsx`.
8. **FE-7 — Errores en el detalle, corte y origen** → `tests/componentes/errores-de-carga.test.tsx`,
   `tests/paginas/detalle.test.tsx`.
9. **FE-8 — El asistente** → `tests/paginas/asistente-cortes.test.tsx`.
10. **FE-9 — Wiki**, con los textos de §6 copiados.
11. **FE-10 — Verificación:** los seis comandos de §10.3, `tests/tema/colores.test.ts`, y `npm ci` en una
    copia limpia de `package.json` y `package-lock.json`.

La prueba contra el backend real y en un navegador (§10.4, §10.6) la hace el auditor con los dos
paquetes cerrados.

### Estimación

| Qué | Esfuerzo |
|---|---|
| Paquete BE | Unos 2 días |
| Paquete FE | Unos 4 días, uno de ellos FE-0 |
| En paralelo | Unos 4 días de calendario |
| Auditoría (backend, frontend, wiki; dos pasadas como tope) | 1,5 a 2 días |

Con el esquema de agentes de las fases B y C1 (dos `implementer` en paralelo, tres `auditor`), eso fue
una jornada de implementación y una de auditoría por entrega. C2a es comparable a C1 en tamaño de
frontend y bastante menor en backend; lo que suma es FE-0 y, por primera vez, la prueba en un navegador.

---

## 14. Qué se verificó y qué es suposición

| Afirmación | Cómo se sabe |
|---|---|
| Línea de base: 52 suites / 1.255 tests; 102 / 1.931 en total; 5 errores de `tsc`; `verificar-ayuda` OK | **Ejecutado** el 09/10/2026 sobre el árbol con C1 (con `LOG_DIR` en un directorio temporal) |
| La base local está sincronizada con el schema del árbol; C2a no necesita ningún cambio de schema | **Ejecutado** (`prisma migrate diff`, solo lectura) y **leído** (`schema.prisma:181-276`, `:395-446`) |
| La remesa 35 tiene una fila con error en `rowNumber 0` cuyo mensaje empieza con `[archivo:1]`; los avisos también están en 0 | **Ejecutado** (`SELECT` sobre la base local: 6 remesas, 484 `importerror`) y **leído** (los seis lugares que escriben avisos) |
| `rowNumber` es un contador de las filas que pasaron los filtros, no el índice del archivo | **Leído** (`imports.service.ts:3901`, `:3675`, `:3705`) y coherente con el dato: la remesa 34 tiene un error en `rowNumber 251142` con `[…txt:11142…]` en el mensaje |
| `new ConflictException({ code, message, … })` deja `e.message` igual al texto y el cuerpo igual al objeto, sin `statusCode` ni `error` salvo que se los ponga | **Ejecutado** contra `@nestjs/common` 11.1.8 |
| `vitest` 3.2.7 + `jsdom` 26.1 corren con `vite` 5.4.21 y los módulos reales del frontend | **Ejecutado**: una sonda fuera del repo con `vite` fijado en 5.4.21 corrió cuatro archivos del arnés de C1: 64 de 65 pasan; la que falla afirma un texto que cambió después de la auditoría |
| El arnés de los auditores de C1: 22 archivos de prueba (unas 5.400 líneas) y 700 líneas de biblioteca; 6 de las 118 pruebas de la B que se volvieron a correr fallan sobre el código de C1 | **Leído** el arnés y sus salidas guardadas |
| Una respuesta destruida a mitad de un CSV le llega al navegador como un error, no como un archivo corto | **Suposición** para prod (hay un balanceador en el medio). FE-9 lo prueba contra el servidor falso, sin balanceador; MH-11 no lo cubre. Si en prod no se cumple, la defensa que queda es comparar las líneas recibidas con `totales` |
| Una compensación de encolado deja la remesa en borrador **con** `resumen.origen`; un borrador nunca confirmado no tiene `resumen` | **Leído** (`:2273-2281`, `:2769-2779`, `:917`, `:1262-1269`, `:2124-2127`, `:2575`). **No ejecutado**: lo cubren HI-8, CP-4 y la prueba con Redis parado de §10.4 |
| El Historial lee `archivoOriginal`, que el backend no manda | **Leído** (grep en `backend/` y en el schema: no existe) |
| Los eventos de una carga solo llegan al dueño y a la sala de administradores | **Leído** (`realtime.service.ts:38-47`, `realtime.gateway.ts:93-96`) |
| Un 401 recarga la página entera; por eso no puede quedar una pestaña anterior a la Fase A | **Leído** (`frontend/src/api/axios.ts:27-39`). Que en prod el token dure un día es **suposición** (default del código) |
| Los alias del DTO solo los leía el frontend anterior a la Fase A; el backend los copia al `payload` de la notificación | **Leído** (grep; `imports.service.ts:4174-4189`) |
| Ningún spec afirma `getErrors` ni el texto fijo de "Ninguna de las importaciones…" | **Leído** (grep) |
| Ningún spec compara un `EstadoCargaDto` entero con `toEqual` | **Heredado** de §10.9.1 del spec principal; un grep de `toStrictEqual` en `imports/` no encontró nada. Lo confirma BE-1 |
| `@Audit` funciona en una ruta que usa `@Res()` | **Leído**: el export de auditoría (`transacciones.controller.ts:35-63`) usa la misma combinación. **No ejecutado** acá: lo confirma el auditor mirando que la descarga deje su fila de auditoría |
| El borrado por categoría (qué deshace y qué no) | **Tomado de la wiki**, que se auditó contra el código (`08-historial-y-problemas.md:193-226`). El implementer lo reconfirma contra `deleteRemesa` antes de escribir los textos del diálogo |
| Excel de los operadores abre con doble clic un CSV con `;` y BOM | **Suposición** (configuración regional en español). Prueba MH-11 |
| La lectura por clave del CSV usa el índice `(remesaId, rowNumber)` sin ordenar aparte | **Suposición** sobre el optimizador. Sonda SH-3 |
| Con el volumen de prod (149 remesas) el Historial no necesita un índice nuevo | **Dato de quien encargó el diseño** (la última remesa era la 149) y razonamiento; no medido en prod |
| El workflow del frontend instala y construye con las dependencias nuevas en Node 20 | **Leído** (`deploy-frontend.yml`; los `engines` de `vitest` 3 y `jsdom` 26 aceptan Node 20). **No ejecutado** en Node 20. C2A-33 lo cubre en parte |
| C2b no necesita backend nuevo | **Suposición de diseño**: se confirma al diseñar C2b en detalle |
| Hay un solo proceso de backend en prod | **Dato del entorno**, de quien encargó el diseño |
| Cada referencia `archivo:línea` de este documento | **Leída** contra el árbol de trabajo (HEAD `58bb9e1` + C1 sin commitear) |

---

## 15. Lo que necesita el OK del usuario

Son decisiones sobre qué ve y qué puede hacer el operador. Van con la recomendación del diseño.

1. **Partir C2 en dos** y hacer primero C2a. Consecuencia: después de C2a la campanita y el asistente
   quedan como en C1 hasta C2b.
2. **El número de fila de un error pasa a contarse desde 1** (hoy desde 0, y la wiki lo dice así). La
   fila que hoy se ve como "0" se va a ver como "1", en la pantalla y en el CSV. Queda igual que el
   `[archivo:línea]` de las cargas de varios archivos, que ya cuenta desde 1. Se avisa en el tooltip de
   la columna, en la wiki y en el CHANGELOG. **Alternativa:** dejarlo desde 0; es una constante
   (`BASE_DE_FILA`). Lo que no cambia en ningún caso: el número sigue sin contar el encabezado ni las
   filas descartadas.
3. **Tests dentro del repo del frontend**: tres dependencias de desarrollo, una carpeta `frontend/tests/`
   y dos scripts. No se agregan al deploy. `CLAUDE.md` deja de decir que el frontend no tiene tests.
4. **Eliminar una remesa en cola sigue siendo posible desde el Historial**, ahora con un diálogo que dice
   qué es y que existe Cancelar. **Alternativa:** prohibirlo y obligar a cancelar primero (un paso más,
   y el número de remesa queda ocupado hasta eliminarla después).
5. **"Confirmar" las remesas que no se pudieron encolar, desde el Historial:** confirma sin volver a
   mostrar la vista previa, con las remesas de origen que se habían elegido; quien confirma pasa a ser
   el dueño; solo mientras el borrador exista (el sistema lo borra a las 24 horas de creado). Si ese
   archivo ya se volvió a subir y cargar en otra remesa, el diálogo lo avisa; cuando la remesa no es un
   corte de una división, **avisa pero no lo impide** (impedirlo en el servidor es deuda de C1).
6. **El CSV de errores**: trae el contenido de las filas (datos personales de los casos) con el mismo
   permiso que ya deja verlos en pantalla, sin permiso nuevo, y cada descarga queda auditada; separador
   `;`; tope de 200.000 registros.
7. **El Historial pasa a estar paginado** (25 por página) con una búsqueda por número o nombre. Hoy trae
   todo junto.
8. **El diálogo de eliminar cambia según la categoría** y dice, para pagos y parecidas, que eliminar no
   deshace nada, y para acciones masivas, que mata el Revertir. Es más alarmante que el texto único de
   hoy, a propósito.
9. **Los alias viejos del DTO no se quitan en C2** (§5.9): se pueden, pero el lugar es la Fase D.
10. **Los textos** de §6.3 y §6.4, en particular los que le dicen al operador qué hacer.

Sigue abierta y no bloquea: §5.5 del spec principal (cargas ajenas), que es de la Fase D.

---

## 16. C2b: alcance, dependencias y riesgos

No se diseña en detalle acá: se diseña cuando le toque, sobre lo que deje la auditoría de C2a.

**Decisión que sí se toma ahora, porque condiciona a C2a: la tarjeta única es presentacional.** Recibe un
`EstadoCargaDto` (y, si es una división, la lista de sus remesas) por propiedades, y **no consulta
nada**. Los tres lugares que la usan conservan de dónde sacan el estado: el asistente y el detalle, sus
hooks (`useEstadoCarga`, `useGrupoCarga`); la campanita, `NotificacionesContext`. Así no se reescribe
ningún hook auditado, y de paso desaparece un defecto de C1: en el paso "Importando" de una división,
`PasoImportandoGrupo` consulta el grupo y el `ImportProgress` que monta adentro vuelve a consultar la
remesa actual, dos pedidos por cada tic con el socket caído.

**Qué reemplaza y qué no:**

| Hoy | Con C2b | ¿Se reescribe? |
|---|---|---|
| `ImportProgress` (paso "Importando"): el cuerpo —reloj, porcentaje, barra, contadores, ritmo, fase, avisos, cancelar— y la orquestación con el asistente (`onComplete` una sola vez, `estadoInicial`, `onNoExiste`, `onSeguimiento`) | La orquestación **queda como está**; el cuerpo pasa a ser la tarjeta en su variante completa | Solo el cuerpo (`ImportProgress.tsx:116-247`) |
| Detalle: el bloque de progreso de la tarjeta superior (`ImportDetail.tsx:563-605`) | La tarjeta, variante de detalle | Ese bloque |
| `ImportEnCursoItem` (campanita) | La tarjeta, variante compacta, con acciones | El componente (93 líneas) |
| `PasoImportandoGrupo`: la lista de remesas y el `ImportProgress` de la actual | La lista y la barra de la división pasan a la tarjeta; deja de montar un segundo hook | En parte |
| `estadoEnGrupo` (asistente y detalle) y `estadoParaHistorial` (C2a) | Una sola función | Sí: en el asistente y en el detalle "Finalizada" pasa a ser la etiqueta precisa |
| `AvisosCarga`, `BotonCancelarCarga`, `ErroresDeCarga`, `useEstadoCarga`, `useGrupoCarga`, `ImportSummary`, `NotificacionesContext`, `SocketContext` | Se usan tal cual | **No** |

**Qué trae de nuevo:**

- En la tarjeta: los pasos (En cola → Leyendo, si aplica → Procesando → Post-proceso → Listo); los
  contadores en una grilla de dos columnas en `xs`; **los últimos cinco errores y avisos en vivo**, con
  la lectura de C2a (`orden=desc&pageSize=5`, a lo sumo una cada 5 s, y solo en las variantes completa y
  de detalle); en una división, la barra del grupo (remesas terminadas sobre el total) y una por remesa.
- Campanita con acciones. En un ítem en curso: ver detalle y cancelar (la variante de ícono de C2a). En
  la notificación de una carga terminada: descargar los errores si los hubo, y retomar **solo después de
  consultar el estado** (el `payload` de la notificación es una foto vieja; `retomable` se pregunta, no
  se deduce).
- Chip en la barra superior mientras haya cargas en curso ("Importando 43 %" con una, "3 importaciones"
  con varias), que abre la campanita. En `xs`, solo un ícono.
- Celular: la campanita como diálogo a pantalla completa en `xs`; el repaso de los pasos 3 y 4 del
  asistente, y del Historial y el detalle de C2a, a 360 px.
- La deuda que queda de C1: `ejecutar-grupo` sin respuesta (un vigía: si el pedido no volvió en 15 s,
  consultar la primera remesa cada 5 s y seguir al grupo si aparece), y los cosméticos de texto del
  asistente.

**Dependencias.** C2a entera: el arnés (su FE-0 es portar el resto de las pruebas de C1, unas 170, que
son la red de lo que C2b refactoriza —**si para entonces todavía existen**: §7.3—), la lectura de
errores, la variante de ícono del botón de cancelar, la descarga por blob y `estadoParaHistorial`.
Backend: ninguno, hasta donde se diseñó.

**Riesgos.**

1. **El contrato de `ImportProgress` con el asistente** es lo más auditado del frontend (`onComplete`
   exactamente una vez, la siembra con `estadoInicial`, la alerta de remesa no encontrada). Se cambia el
   cuerpo, no la orquestación; las pruebas portadas de C1 son la condición para tocarlo.
2. **Unificar las etiquetas de estado** cambia textos en dos pantallas auditadas y en la wiki.
3. **El chip en la barra superior** recibe un evento por segundo: si no está aislado en su propio
   componente, toda la barra se vuelve a dibujar cada segundo, en todas las pantallas.
4. **La campanita como diálogo en celular:** foco, botón "atrás" del navegador, y que no tape un toast.
5. **Los últimos errores en vivo** son un pedido por tarjeta visible: con varias cargas en la campanita
   sería un pedido por cada una cada 5 s. Por eso la variante compacta no los trae.
6. **Si al diseñarlo aparece una lectura que falta**, deja de ser un solo push.
7. Como siempre: nada se vio en un navegador hasta C2a. Si la prueba manual de C2a encuentra problemas
   de aspecto, cambian el alcance de C2b.

**Estimación gruesa:** 3 a 4 días de frontend y 1,5 a 2 de auditoría.

---

## 17. Qué actualizar en el spec principal

Este diseño no tocó `imports-progreso-realtime-spec.md` (tiene los cambios de C1 esperando el commit).
Lo que conviene cambiar ahí, para que lo haga quien orquesta:

| Dónde | Qué |
|---|---|
| Encabezado (`:3-10`) | "…las otras dos (C2 interfaz, C3 resumen y revertir), esbozadas" → C2 **diseñada el 09/10/2026 y partida en C2a y C2b** en [imports-progreso-c2-spec.md](imports-progreso-c2-spec.md); C3 esbozada |
| "Para retomar" (`:29-37`) | Lo siguiente es commitear y desplegar C1, y después C2a, con su documento y las diez decisiones de su §15 |
| §4 "Fase C", el recuadro (`:281-298`) | "C2 — interfaz" → "C2a — el Historial dice la verdad y deja actuar" y "C2b — tarjeta única, campanita con acciones, chip y celular", con el enlace. Agregar que C2 tampoco necesita cambio de schema |
| §4, la lista (`:300-315`) | Las marcas "→ C2" pasan a: `ImportProgressCard` → **C2b**; barra total y una por hija → **C2b**; panel con acciones → **C2b**, y el CSV → **C2a**; chip → **C2b**; #11 en vivo → **C2a** en el detalle, **C2b** en la tarjeta; #17 CSV → **C2a**; #18 Historial → **C2a**; celular → **C2b** |
| §4, criterios de aceptación C (`:317-320`) | "Desde la campanita se puede ver el detalle, descargar errores y reintentar…" → **C2b**. Agregar el de C2a: desde el Historial se cancela, se retoma y se confirma lo que no se pudo encolar, y se bajan los errores sin 401 |
| §10.1, la tabla de entregas (`:4091-4095`) | La fila C2 se parte en dos, con el enlace |
| §10.1, la tabla de ítems (`:4113-4129`) | Cada "C2" pasa a "C2a" o "C2b" según la tabla de §1 de este documento. La fila de los alias: "C2, solo si ya no quedan pestañas de la Fase A" → **Fase D** (los leía el frontend **anterior** a la Fase A; ver §5.9 acá) |
| §10.15, entrega 2 (`:5626-5648`) | Una nota al principio: reemplazado por `imports-progreso-c2-spec.md`. El esbozo queda como registro |
| §10.16, deuda conocida de C1 (`:5761-5778`) | Las filas marcadas "C2" pasan a **C2a**, salvo "`ejecutar-grupo` sin respuesta" y los cosméticos del asistente, que son **C2b** |
| §9.15 (`:4034`) y §8.13 (`:1968`, `:1969`, `:1972`, `:1975`) | "C" → **C2a** |
| §10.12 y los bloques "PLAN PARA IMPLEMENTER" | Nada: el de C2a está al final de este documento |

**Encontrado de paso, para el backlog** (leído, no ejecutado):

- El Historial muestra "Archivo desconocido" en todas las filas: lee `archivoOriginal`, que no existe.
  El nombre original solo se guarda en las cargas de varios archivos. C2a deja de mostrarlo; guardarlo
  para un solo archivo es un cambio del alta.
- El número de fila de un error no es la línea del archivo: es un contador de las filas que pasaron los
  filtros. El comentario de `recorrer-filas.ts:40` ("Es el `rowNumber` del `importerror`") está
  desactualizado. Guardar la línea real es un cambio del runner: candidato para C3.
- "Qué es un aviso" queda definido en tres lugares: el conteo del runner (`imports.service.ts:4014-4025`),
  `utils/errores-carga.ts` y `esAvisoDeCarga` del frontend. Unificar la del runner, en C3.
- El Historial arranca con `empresaId` 1 escrito a mano (`ImportHistory.tsx:87`).
- Una pestaña vieja no se entera de que hay una versión nueva del frontend: cada fase paga
  compatibilidad con pestañas que un aviso de "hay una versión nueva, recargá" haría innecesaria.
- Los tests del frontend no corren en el deploy. Cuando la suite rápida lleve un tiempo estable, se
  puede agregar como paso previo al build.

---
## PLAN PARA IMPLEMENTER — Fase C, entrega 2a

Diseño completo en este documento (§2 a §15). Antes de empezar: el OK del usuario a los diez puntos de
§15, y decidir si C1 se commitea antes (recomendado).

**Orden de implementación:**
Dos paquetes en paralelo (§13), con el contrato de §4 como único punto de contacto. Dentro de cada uno:
- BE-0 las sondas de lectura SH-1 a SH-3 (el dato real que motiva la clasificación de errores, la collation y el índice; si SH-1 no da, parar) → BE-1 contrato y funciones puras (tipos, extra y singulares de `estado-carga.ts`, `utils/errores-carga.ts`) → BE-2 códigos en los 409 y el 409 de retomar un grupo → BE-3 `retomable` honesto (`choquesDeCorte`, `cortesRepetidosDe`, el extra en `progreso`, `status` y `grupo`) → BE-4 `historial` → BE-5 errores y CSV → BE-6 `confirmarPendientes` → BE-7 controller, DTO, `origen` y `corte` en `status`, `notificaciones-spec.md` → BE-8 verificación.
- **FE-0 el arnés de tests y lo portado del de C1, con la línea de base anotada, antes de tocar `frontend/src`** → FE-1 tipos, API y utilidades puras → FE-2 `DataTableResponsive` → FE-3 cancelar (variante de ícono y diálogo vivo) → FE-4 `useHistorialImportaciones` → FE-5 la página del Historial → FE-6 acciones de la fila → FE-7 errores en el detalle, corte y origen → FE-8 el asistente (dos ediciones) → FE-9 wiki → FE-10 verificación. Cada paso se entrega con su archivo de pruebas en verde.

**Archivos a crear:**
- Backend: `backend/src/modules/imports/historial.types.ts`; `backend/src/modules/imports/utils/errores-carga.ts` y `errores-carga.spec.ts`; `backend/src/modules/imports/imports-errores.spec.ts`, `imports-historial.spec.ts`, `imports-confirmar-pendientes.spec.ts`.
- Frontend: `frontend/vitest.config.ts`; `frontend/tests/tsconfig.json`, `tests/setup.ts`, `tests/lib/{servidor-falso.ts,montar.tsx,fabricas.ts}`, `tests/unit/{estadoCarga,historial}.test.ts`, `tests/componentes/{cancelar,errores-de-carga,tabla-responsive}.test.tsx`, `tests/paginas/{historial,historial-acciones,detalle,asistente-cortes}.test.tsx`, `tests/lento/historial-en-vivo.test.tsx`, `tests/tema/colores.test.ts`; `frontend/src/types/importHistorial.ts`; `frontend/src/utils/historialImportaciones.ts`, `utils/descargas.ts`; `frontend/src/hooks/useHistorialImportaciones.ts`; `frontend/src/components/import/ErroresDeCarga.tsx`; `frontend/src/components/import/historial/{AccionesHistorial,EncabezadoDivision,CeldasHistorial}.tsx`.

**Archivos a modificar:**
- `backend/src/modules/imports/progreso/estado-carga.types.ts` — `corteRepetidoEn: string[] | null`.
- `backend/src/modules/imports/progreso/estado-carga.ts` (y su spec: casos nuevos y el assert de `:807`) — `ExtrasEstado.corteRepetidoEn`; `armarEstadoCarga` lo devuelve y lo descuenta de `retomable`; `plural`; los singulares de `mensajeSinFilas`, `textoCancelacion` y `textoNotificacion`.
- `backend/src/modules/imports/dtos/import.dto.ts` — `HistorialQueryDto`, `ErroresQueryDto`, `ConfirmarPendientesDto`.
- `backend/src/modules/imports/imports.service.ts` — nuevos: `historial`, `cortesRepetidosDe`, `choquesDeCorte` (extraída de `remesasQueChocanConElCorte`, que conserva firma y resultado), `erroresCsv`, `confirmarPendientes`, `conflicto`. Cambian: `getErrors` (tipo, orden, totales, `fila`); `status` (`origen`, `corte` y el extra), `progreso` y `grupo` (el extra); los cinco `throw` de §4.5 (mismo texto, con `code`; el de "ninguna retomable" con `omitidas`). **No cambian `processImportJob` ni `listRemesas`.**
- `backend/src/modules/imports/imports.controller.ts` — `GET historial`, `GET errores/:remesaId/csv` (con `@Res()` y `@Audit`), `POST remesas/confirmar-pendientes`; `GET errores/:remesaId` con su DTO.
- `backend/src/modules/imports/imports-grupo.spec.ts`, `imports-progreso-controller.spec.ts` — solo casos nuevos.
- `docs/notificaciones-spec.md` — los singulares y una entrada fechada.
- `frontend/package.json`, `package-lock.json` — scripts `test`, `test:lento`, `test:todo`, `test:ver`; `devDependencies`: `vitest`, `jsdom`, `socket.io`, `@types/node`.
- `frontend/src/types/importProgreso.ts` — `corteRepetidoEn`.
- `frontend/src/api/imports.ts` — `obtenerHistorial`, `obtenerErrores`, `descargarErroresCsv`, `confirmarPendientes`, `eliminarRemesa`; `noEncoladas?` en `RetomarGrupoRespuesta`.
- `frontend/src/utils/estadoCarga.ts` — `plural`, singulares de `presentarResultado`, `oracionesSinFilas`, `codigoDeError`, `TEXTO_RETOMAR_UNA` / `TEXTO_RETOMAR_VARIAS`, `motivoNoRetomablePorCorte`.
- `frontend/src/components/ui/DataTableResponsive.tsx` — la propiedad opcional `encabezadoAntesDe`.
- `frontend/src/components/import/ImportProgress.tsx` — **solo `BotonCancelarCarga`**: `variante`, `DialogoCancelarCarga` interno con `useGrupoCarga`, el singular de "Lleva N de M filas".
- `frontend/src/pages/ImportHistory.tsx` — reescritura: datos del hook, `estadoParaHistorial`, columnas, encabezado de división, paginado, búsqueda, avisos, acciones y diálogos.
- `frontend/src/pages/ImportDetail.tsx` — la sección de errores pasa a `ErroresDeCarga`; renglones "Corte" y "Remesas de origen"; el texto de retomar desde la constante; la línea de `motivoNoRetomablePorCorte`.
- `frontend/src/pages/ImportWizard.tsx` — el 409 del alta por `code` (`:743-748`) y `oracionesSinFilas` en el cartel (`:1564-1571`).
- `docs/ayuda/03-importacion/08-historial-y-problemas.md`, `05-importar-un-archivo.md`, `01-como-funciona.md`.
- No se tocan: `schema.prisma`, `processors/`, `progreso/progreso-tracker.ts`, `progreso/reaper-cargas.*`, `bullmq/`, `imports.module.ts`, `realtime/`, `permisos-catalogo.ts`, `.env.example`, `imports-list-remesas.spec.ts`; `vite.config.ts`, `tsconfig.json`, `SocketContext.tsx`, `NotificacionesContext.tsx`, `NotificacionesPopover.tsx`, `NotificacionItem.tsx`, `ImportEnCursoItem.tsx`, `AppBar.tsx`, `useEstadoCarga.ts`, `useGrupoCarga.ts`, `ImportSummary.tsx`, `AvisosCarga.tsx`, el componente `ImportProgress`.

**Cambios de schema:** ninguno. No se corre `prisma db push`; `prisma migrate diff` tiene que dar vacío antes y después. Se leen `import_progreso` (incluido `resumen.origen`), `remesa.divisionValores`, `remesa.archivos`, `remesa.archivoHash` / `plantillaId` / `filtroFilas` / `createdAt` e `importerror` por su índice `(remesaId, rowNumber)`. **Sin backfill.** Sin permisos nuevos. Sin variables de entorno.

**Tests a escribir:**
- Backend: `utils/errores-carga.spec.ts` (9 casos: clasificación con el caso real de la remesa 35, número de fila, filtros, celdas del CSV con comillas y con fórmulas, importes negativos); `imports-errores.spec.ts` (13: filtro por tipo, totales, compatibilidad sin parámetros, 150 avisos y 20 filas, orden, paginado, CSV con BOM, lectura por clave en tres lotes, tope, cierre del cliente, falla a mitad, 404, contrapresión); `imports-historial.spec.ts` (12 + 3: paginado, búsqueda, `carga` por fila, resumen de grupo, `retomable` honesto y sus tres contraejemplos, pendientes de encolar, **número de consultas fijo**, mismo conjunto que `listRemesas`; y `progreso` / `status` / `grupo` con el extra); `imports-confirmar-pendientes.spec.ts` (9: delega con el origen de la fila; no pendiente, origen distinto, mismo corte, 403, 404; errores del delegado); casos nuevos en `imports-grupo.spec.ts` (4: códigos, `omitidas`), `estado-carga.spec.ts` (4: el extra, singulares, propiedad con 1) e `imports-progreso-controller.spec.ts`. Los dobles de `prisma` **filtran de verdad** (`where` con `startsWith` sin distinguir mayúsculas, `orderBy`, `skip`, `take`). Detalle en §10.2. Más las sondas SH-1 a SH-6 de §10.4.
- Frontend: lo portado del arnés de C1 en FE-0 (unas 100 pruebas: funciones puras, cancelar, detalle, el 409 del alta) y lo nuevo de §10.3: `unit/estadoCarga` (FU-1 a FU-5), `unit/historial` (FU-6 a FU-10), `paginas/historial` (FH-1 a FH-15), `paginas/historial-acciones` (FA-1 a FA-12), `componentes/errores-de-carga` (FE-1 a FE-12), `componentes/cancelar` (FC-1 a FC-5), `componentes/tabla-responsive` (FT-1, FT-2), `paginas/detalle` (FD-1 a FD-3), `paginas/asistente-cortes` (FW-1 a FW-3), `lento/historial-en-vivo` (FL-1 a FL-5), `tema/colores` (FX-1).

**Páginas de la wiki a tocar:** `docs/ayuda/03-importacion/08-historial-y-problemas.md` (la que más cambia), `05-importar-un-archivo.md`, `01-como-funciona.md`; `06`, `07`, `09` y `10` solo si la revisión encuentra una frase que dejó de ser cierta. Actualizar `revisado`, correr `cd frontend && npm run verificar-ayuda` y pasar cada página por un agente revisor.

**Skills a consultar:** BE: `nestjs-module`, `amsa-general`, `prisma-migration` (para lo que **no** hay que hacer: ni push ni migración). FE: `react-component`, `amsa-general`.

**Riesgos durante la implementación:**
- `imports.service.ts` tiene casi 5.000 líneas y C1 sin commitear adentro: anclas únicas en cada edición y una copia antes (en la ronda de arreglos de C1 un reemplazo mal anclado borró 2.000 líneas).
- `processImportJob` y `listRemesas` no se tocan: si un cambio parece necesitarlo, parar.
- La guarda de cortes tiene que quedar en **una** función (`choquesDeCorte`) que usen la lectura y el endpoint: dos implementaciones es una guarda que no encuentra nada, en silencio.
- `confirmarPendientes` no escribe por su cuenta: delega. Si aparece un `update` en ese método, está mal.
- El origen de una confirmación pendiente sale de la fila, no del pedido; y dos remesas del mismo corte en el mismo pedido se rechazan.
- El CSV: una falla después de empezar a escribir **destruye** la respuesta, no la termina; y no se usa `skip` para paginarlo.
- Una celda que empieza con `-` puede ser un importe negativo: la neutralización de fórmulas no puede convertirlo en texto.
- Si hace falta tocar un assert existente que no sea `estado-carga.spec.ts:807`, parar.
- Un "qué hacer" para el operador solo se escribe si está verificado contra el código: los textos del diálogo de eliminar se reconfirman contra `deleteRemesa`.
- FE-0 va antes que cualquier cambio de `frontend/src`, y las pruebas de cancelar portadas tienen que estar en verde antes de tocar `BotonCancelarCarga`.
- Los arneses de los auditores están en un directorio temporal: si ya no existen, el arnés se rehace con §7.2 y las pruebas de C1 se escriben de nuevo (más trabajo en FE-0).
- Sin `matchMedia` simulado, toda prueba corre en la rama de celular sin que nadie lo note.
- Los tests no le hablan nunca a un backend real, y los que esperan intervalos reales van en `tests/lento/`.
- `npm ci` falla si `package.json` y `package-lock.json` no coinciden: rompe el deploy del frontend. Verificar en una copia limpia.
- En el frontend, `vite build` no chequea tipos, y todo campo nuevo puede llegar `undefined` desde un backend viejo.
- `DataTableResponsive` lo usan diez pantallas: la propiedad nueva es opcional y sin ella no corre código nuevo.
- En `HEAD` no está C1: `git show HEAD:ruta` de un archivo que C1 tocó devuelve la versión de la Fase B.
- Nada de `git stash` ni de comandos que muevan el árbol; `LOG_DIR` temporal en todo arnés que levante la aplicación; nada de `npm run lint`.
- Si los dos commits se pushean juntos, el frontend llega antes que el backend y el Historial da error hasta que termine el otro deploy.

**Criterios de aceptación:** C2A-1 a C2A-36 de §12.
