# Progreso de importaciones — Fase C, entrega 3 (C3)

> **Estado:**
> - **C3a en prod desde el 14/10/2026** (imagen `8e8c49b`). Lo que cambió al auditarla está en
>   [§16](#16-lo-que-cambió-en-c3a-después-de-la-auditoría-14102026), que manda sobre §2 a §11.
> - **C3b en prod desde el 14/10/2026** (21:59 de Argentina; imagen `b49e95f`). El diseño está en
>   [§17](#17-c3b-diseño-ejecutable).
>   Lo que cambió al auditarla está en [§18](#18-lo-que-cambió-en-c3b-después-de-la-auditoría-14102026), que manda
>   sobre §17.
> - **C3c esbozada** (§13.2).
>
> Architect, 14/10/2026, sobre HEAD `38a25c2` (árbol limpio; A, B, C1, C2a y C2b en prod). Las referencias
> `archivo:línea` son contra ese commit. Continúa [imports-progreso-realtime-spec.md](imports-progreso-realtime-spec.md)
> §10.15 "Entrega 3" (el esbozo) y [imports-progreso-c2-spec.md](imports-progreso-c2-spec.md) §17 y §19 (lo que C2 dejó
> para acá). Qué se ejecutó, qué se leyó y qué es suposición: §15.
>
> **La idea en cinco líneas.** (1) C3 se parte en tres entregas y un descarte: **C3a** dice lo que la carga ya sabe
> (resumen por categoría, la fila del archivo, los avisos en "los últimos cinco") y hace que Revertir deje de mentir;
> **C3b** vuelve cortable y reversible a una acción masiva, con el Revertir como job; **C3c** hace que un deploy corte
> las cargas con números exactos en vez de matarlas. (2) Re-ejecutar sobre lo ya cargado se **descarta**. (3) Puntos de
> corte dentro del post-proceso: backlog, hasta medir. (4) C3a **no cambia qué escriben los processors** salvo una
> regla nueva y aislada (D1: una baja por pago repetida no crea otro pago). (5) Un solo cambio de schema, aditivo:
> `importerror.linea`.

---

## 1. Partición

Prod no tiene cargas reales desde el 30/09 (§15): nada de lo que sigue puede apoyarse en tiempos medidos. Por eso lo
que necesita medición va al final o al backlog, con la medición que lo destraba.

| Parte | Qué trae, en una línea | Riesgo para los datos | Valor para el operador | Necesita | Estimación |
|---|---|---|---|---|---|
| **C3a — La carga dice lo que hizo** | Resumen por categoría en los once processors, en el Resultado y en el detalle; la fila del error es la del archivo; los avisos entran en "los últimos cinco"; una sola definición de aviso; Revertir rechaza lo que no puede deshacer y no corre dos veces; una baja por pago repetida no duplica el pago (D1) | Bajo: contadores en memoria por el canal de §9.4.4, con el control de base idéntica (§8). La regla de D1 es el único cambio de lógica, y va en un commit propio | **Alto**: hace visibles cuatro fallos silenciosos del catálogo (casos que colapsan, pagos ya cargados y negativos, contactos descartados, "pagó todo" abortado sin coincidencias) | Nada nuevo | Backend y frontend en paralelo, ~1 h cada uno; una pasada de auditoría y arreglos: **medio día** |
| **C3b — Acciones masivas cortables y reversibles** | Snapshots de ACCIONES persistidos por lote (no al final); cancelar una ACCIONES en curso; Revertir sobre una cortada o con post-proceso incompleto, con lo que cubren los snapshots; Revertir como job de BullMQ con progreso | **Alto**: cambia el orden de escritura de un processor destructivo y el flujo de Revertir | Alto si se usan acciones masivas grandes; hoy una muerta a mitad queda irreversible | C3a (el Revertir honesto y su contrato de errores). Una prueba con volumen: 50.000 casos locales | **1 día** (diseño 40 min, dos implementers, auditoría con volumen) |
| **C3c — El deploy no mata cargas a ciegas** | `enableShutdownHooks` + al recibir `SIGTERM` el runner corta como una cancelación del sistema, con números exactos y "interrumpida por un reinicio"; `stop_grace_period` en el compose; opcional, `deploy.sh` espera a que termine la carga en curso | Medio: toca el cierre del proceso entero (Prisma, Redis, Neotel) | Medio: los deploys son frecuentes; hoy la carga muere con SIGKILL a los 10 s y el reaper la cierra "al menos N" | C1. Mejor después de C3b (si no, una ACCIONES queda fuera del corte). `terraform apply` del parámetro `_compose` | **Medio día** + el `apply` |
| **C3d — Re-ejecutar sobre lo ya cargado** | — | — | — | — | **Descartada** (abajo) |
| Backlog | Puntos de corte dentro del post-proceso | — | — | Medición (abajo) | — |

**Por qué este orden.** C3a no cambia qué se escribe y destapa fallos silenciosos que hoy solo están en el log: es la
de más valor por unidad de riesgo y la que conviene tener en prod **antes** de la primera carga real, para que esa
carga ya informe. C3b es la de más riesgo y la única que necesita una prueba con volumen; su contrato de errores de
Revertir lo fija C3a. C3c se beneficia de C3b (con snapshots por lote, una ACCIONES también se puede cortar en el
deploy) y es la única que exige un paso de infraestructura manual.

**Descartado: re-ejecutar sobre lo ya cargado (§10.5.5).** Se ofrecería en DEUDORES, DEUDORES_Y_FACTURAS, FACTURAS y
MULTICLAVES, y solo después de una sonda por categoría (cortar con `kill -9`, re-ejecutar, comparar contra una carga
limpia). Razones para no hacerlo: (1) ninguna carga real desde el 30/09, así que no hay evidencia de que haga falta;
(2) el remedio que existe está verificado (eliminar la remesa y volver a subir, con los cortes cargados destildados);
(3) en las categorías donde haría más falta (PAGOS, ACTUALIZACIONES, ACCIONES, MULTI\*) es inseguro por construcción.
Se reabre si un operador se encuentra con una carga a medias que no se puede eliminar (más de 60.000 casos). La
variante "vaciar la remesa y volver a cargarla en un paso" para DEUDORES queda en el backlog con la misma condición.

**Backlog: puntos de corte dentro del post-proceso.** Lo destraba esta medición, con las primeras cargas reales: las
líneas `Post-proceso remesa=… terminó en Xms` y los tiempos por subfase que la Fase B ya deja en CloudWatch. Si una
ACTUALIZACIONES o una MULTIARCHIVO real pasa de 2 minutos en el post-proceso, se diseña un corte **entre** subfases
idempotentes (las consolidaciones), nunca dentro de "cerrando ausentes". La consulta para mirarlo está en §13.4.

**Lo "encontrado de paso" de §10.15**, dónde cae: bajas por pago sin anti-duplicados → **C3a** (D1);
`revertirAcciones` no mira el estado → **C3a**; PAGOS con pago manual confirmado sin id de cobro, el filtro FINALIZADA
del combo de origen solo en el frontend, el alta de una división no transaccional → backlog (no son del ciclo de vida
de una carga, y el segundo merece su propio arreglo con un 400 del backend).

---

## 2. C3a: alcance, impacto y riesgos

| # | Qué | Backend | Frontend |
|---|---|---|---|
| A1 | **Resumen por categoría** | Un método más en el canal `ctx.progreso` (`resumen`); cada processor lo llama con sus contadores; el tracker lo guarda en `import_progreso.resumen.categoria` al cerrar (`finalizar`, `cancelar`, `fallar`); `EstadoCargaDto.resumenCategoria` | `ResumenDeCarga` en el Resultado del asistente y en el detalle |
| A2 | **La fila del error es la del archivo** | `importerror.linea` (columna nueva); `recorrerFilas` la calcula; el runner la escribe; `ErrorDeCargaDto.fila` pasa a ser la línea cuando existe | El encabezado y el tooltip de la columna "Fila" dicen cuál es |
| A3 | **Los avisos entran en "los últimos cinco"** | `GET /import/errores/:id?reciente=true`: los cinco más nuevos, avisos incluidos | `useUltimosErrores` lo pide |
| A4 | **Una sola definición de aviso** | El conteo del runner (`imports.service.ts:4116-4127`) usa `whereAvisos` de `utils/errores-carga.ts` | `esAvisoDeCarga` (solo para un backend viejo) con la misma expresión, sin distinguir mayúsculas |
| A5 | **Revertir honesto** | `revertirAcciones` rechaza una carga que no terminó bien o cuyo post-proceso no guardó los snapshots completos; no corre dos veces a la vez; la marca final es condicional | El diálogo muestra el motivo del 409; un pedido sin respuesta dice que puede seguir corriendo |
| A6 | **Una baja por pago repetida no crea otro pago** (D1) | `casos-cedente.processor.ts`: si la factura ya está PAGADA, no crea el pago ni la vuelve a tocar; cuenta `bajasYaAplicadas` | Una línea en el resumen |

**Impacto.** Backend: `imports.service.ts` (runner, `getErrors`, `revertirAcciones`), el tracker, los tipos, los once
processors (una llamada al canal cada uno, más A6), `recorrer-filas.ts`, `errores-carga.ts`, `schema.prisma`.
Frontend: `ImportSummary`, `ImportDetail`, `ErroresDeCarga`, `useUltimosErrores`, el diálogo de Revertir del Historial.
Ningún permiso, evento de socket ni variable nueva.

**Qué se rompe si sale mal.**

- Un processor que, al informar, cambia lo que escribe (un `await` agregado, una consulta para contar, un `reset()`
  movido). Es el riesgo de §9.4.4 y se controla igual: el canal es sincrónico y sin IO, y la base tiene que quedar
  idéntica con y sin el cambio (§8).
- Un `resumen` mezclado fuera del lock pisaría `origen` o `cancelacion` y rompería retomar. La mezcla va por la
  compuerta, como en C1 (§5.3).
- A2 con un cálculo de línea equivocado: el operador le manda al cedente la fila que no es. Por eso la línea solo se
  escribe donde se puede afirmar, y en el resto queda `null` y se muestra lo de hoy (§5.4).
- A5 rechaza un Revertir que hoy "funciona": una FINALIZADA con post-proceso incompleto hoy revierte una parte y queda
  marcada como revertida para siempre (el texto de la pantalla ya dice "no uses Revertir").

**Datos ya cargados.** Nada queda inconsistente: las cargas anteriores no tienen `resumen.categoria` (el resumen no se
muestra) ni `linea` (la fila se muestra como hoy). No hay backfill.

---

## 3. Datos

### 3.1 Schema: `importerror.linea`

```prisma
model importerror {
  id        Int      @id @default(autoincrement())
  remesaId  Int
  rowNumber Int
  /// Fila del registro en SU archivo, como la ve el operador (Excel: el número de fila de la hoja; texto: el número de
  /// registro contando el encabezado). null = no se puede afirmar (avisos, MULTIRREGISTRO, MULTIARCHIVO, MULTICLAVES, y
  /// toda carga anterior a C3a). Con varios archivos, cuál es lo dice el prefijo `[archivo:N]` del mensaje.
  linea     Int?
  rawRow    Json
  …
}
```

- **`prisma db push` sin pérdida de datos**: columna nula agregada; en MySQL 8 es `ALGORITHM=INSTANT`. El deploy la
  corre antes de levantar el backend nuevo (`infra/ec2/deploy.sh:32`) mientras el viejo sigue procesando: el cliente
  viejo no la conoce e inserta sin ella (queda `null`). Verificar después del deploy con `prisma migrate diff` vacío
  (receta en la memoria `db-push-deploy-falla-parcial`).
- `rowNumber` **no cambia de significado**: sigue siendo el contador 0-based de filas que pasaron los filtros. Es la
  clave del índice `(remesaId, rowNumber)`, del orden de la tabla y del cursor del CSV (`imports.service.ts:4722-4748`),
  y es monótono en el orden de procesamiento; la línea por archivo no lo es (con 31 archivos se repite).

### 3.2 `import_progreso.resumen`: la clave `categoria`

Se agrega una clave opcional al sobre de C1 (`progreso/estado-carga.types.ts:16-26`). `v` sigue en 1: retomar mira
`v === 1` y `origen` (`imports.service.ts:3302`, `:3317`), y una clave nueva no lo afecta.

```ts
export interface ResumenCarga {
    v?: number;
    origen?: …; sinFilasEntregadas?: true; cancelacion?: …; retomas?: number;   // igual que hoy
    /** Lo que hizo el processor (C3a). Lo escribe el runner vivo al cerrar; una carga cerrada por el reaper no lo tiene. */
    categoria?: ResumenCategoria & { v: 1 };
}
```

Wipe y borrado de remesas: sin cambios (`importerror` y `import_progreso` ya se borran con la remesa).

---

## 4. Contratos

### 4.1 `ResumenCategoria`

En `backend/src/modules/imports/progreso/estado-carga.types.ts` y, **copia textual**, en
`frontend/src/types/importProgreso.ts`. Todos los números son **absolutos** (lo hecho hasta ahora), nunca incrementos.

```ts
/** Lo que hizo una carga, por categoría. El processor lo informa entero en cada llamada; el último reemplaza al anterior. */
export type ResumenCategoria =
    | { tipo: 'DEUDORES'; casosNuevos: number; contactosCopiados: number }
    | { tipo: 'DEUDORES_Y_FACTURAS'; casosNuevos: number; casosConFacturas: number; contactosCopiados: number }
    | { tipo: 'FACTURAS'; casosConFacturas: number; clientesInexistentes: number }
    | { tipo: 'CONTACTOS' | 'ENRIQUECIMIENTO'; contactosCargados: number; filasSinContactoValido: number }
    | {
          tipo: 'PAGOS';
          casosConPagos: number; yaCargados: number; negativos: number; facturasMarcadas: number;
          /** Solo si la plantilla trae clave de pago (convenio / referencia). */
          claves: { cargada: number; noCargada: number; otraEmpresa: number; ilegible: number; tramitesEnVariosCasos: number; casosFueraDeRemesaOrigen: number } | null;
      }
    | {
          tipo: 'ACTUALIZACIONES';
          coincidencias: number; casosNuevos: number; reasignados: number; contactosCopiados: number;
          ausentes: {
              accion: 'PAGO_TODO' | 'DESASIGNAR' | 'IGNORAR';
              /** NO_LLEGO = el cierre no corrió (cancelada, fallida, o todavía en filas). */
              resultado: 'APLICADO' | 'OMITIDO_SOLO_DATOS' | 'ABORTADO_SIN_COINCIDENCIAS' | 'SIN_REMESA_ORIGEN' | 'NO_LLEGO';
              pagosGenerados: number; desasignados: number; salteadosSinMonto: number;
          };
      }
    | { tipo: 'ACCIONES'; deudoresAfectados: number; comentariosCreados: number; contactosEliminados: number; saltadosCancelados: number; filasSinMatch: number }
    | {
          tipo: 'MULTIRREGISTRO' | 'MULTIARCHIVO';
          altas: number; actualizados: number; reasignados: number; desasignados: number; contactosCopiados: number;
          bajas: number; bajasPago: number; bajasRetiradas: number; bajasYaAplicadas: number; bajasSinMatch: number; bajasAmbiguas: number;
          casosDadosDeBaja: number;
      }
    | { tipo: 'MULTICLAVES'; yaCargadas: number; tramites: number | null; conCaso: number | null; sinCaso: number | null; casosReconsolidados: number | null };
```

`EstadoCargaDto` gana un campo (`estado-carga.types.ts:30-104` y la copia del frontend):

```ts
    /** Lo que hizo la carga, por categoría (C3a). null mientras corre, en una carga anterior a C3a, y en una que cerró
     *  el reaper (interrumpida). Sale de `import_progreso.resumen.categoria`. */
    resumenCategoria: ResumenCategoria | null;
```

`armarEstadoCarga` (`progreso/estado-carga.ts:177`) lo lee con `leerResumen(fila.resumen)?.categoria ?? null`, solo si
`terminal`; en la rama heredada sin fila (`:250-253`), `null`. El tracker (`armar`, `progreso-tracker.ts:331`) pasa por
la misma función, así que HTTP y socket dicen lo mismo.

### 4.2 El canal: `ReporteProgreso.resumen`

`processors/processor.interface.ts:118-127`, un método más, con las cuatro reglas de §9.4.4 sin cambio:

```ts
    /** Lo que hizo la carga hasta ahora, por categoría: el objeto ENTERO, con valores absolutos; reemplaza al anterior.
     *  Sincrónico, sin IO, nunca tira. Se puede llamar en cada fila. */
    resumen(r: ResumenCategoria): void;
```

### 4.3 `ErrorDeCargaDto` y `GET /import/errores/:remesaId`

`historial.types.ts` y su copia `frontend/src/types/importHistorial.ts`:

```ts
export interface ErrorDeCargaDto {
    id: number; rowNumber: number; tipo: TipoErrorDeCarga; errorMsg: string; rawRow: unknown; createdAt: string;  // igual
    /** Lo que se muestra en la columna "Fila": la del archivo si se conoce (`linea`), si no la posición entre las filas
     *  procesadas contando desde 1 (lo de C2a). null en un aviso. */
    fila: number | null;
    /** true = `fila` es la fila del archivo (C3a). false = es la posición entre las procesadas (carga anterior, o
     *  categoría sin filas de archivo). */
    filaEsDelArchivo: boolean;
}
```

| Método y ruta | Permiso | Entrada | Respuesta | Errores |
|---|---|---|---|---|
| `GET /api/import/errores/:remesaId` | el de clase (`importacion.ver_historial`), igual que hoy | Lo de hoy (`dtos/import.dto.ts:~150-165`: `page`, `pageSize`, `tipo`, `orden`) **más** `reciente?: boolean` (`@IsOptional() @Transform(v => v === 'true' \|\| v === true) @IsBoolean()`) | Igual (`ErroresRespuesta`). Con `reciente=true`: los `pageSize` más nuevos (máx. 20) de errores **y** avisos, del más nuevo al más viejo; `page` se ignora; `totales` igual | Los de hoy |
| `GET /api/import/errores/:remesaId/csv` | igual | igual | La columna "Fila" lleva `fila` (la del archivo cuando existe). Sin columnas nuevas | igual |

`reciente` es un parámetro **nuevo** y no un valor nuevo de `orden` a propósito: el backend de hoy trata cualquier
`orden` que no sea `desc` como `asc` (`imports.service.ts:4641`), así que un frontend nuevo contra un backend viejo
mostraría las **primeras** cinco. Con `orden=desc&reciente=true`, un backend viejo ignora `reciente` y responde lo de hoy.

### 4.4 `POST /api/import/remesas/:id/revertir-acciones`

Ruta, permiso (`deudores.acciones_masivas`, `imports.controller.ts:274-275`) y respuesta 200 sin cambios
(`{ yaRevertida, deudoresRevertidos, contactosRestaurados, comentariosBorrados }`). Errores nuevos, con `code` como los
409 de C2a (§5.6 del documento de C2):

| Condición | HTTP | `code` | Texto |
|---|---|---|---|
| La remesa no es FINALIZADA (FALLIDA, en curso, borrador) | 409 | `REVERTIR_NO_TERMINO` | "Esta acción masiva no terminó bien: los datos para revertirla no se guardaron. Avisá a soporte; no la vuelvas a cargar." |
| FINALIZADA con `import_progreso.errorPostProceso` no nulo | 409 | `REVERTIR_INCOMPLETO` | "Los datos para revertir esta acción no se guardaron completos: Revertir desharía solo una parte. Avisá a soporte." |
| Otro pedido de revertir la misma remesa está corriendo en este proceso | 409 | `REVERSION_EN_CURSO` | "Esta acción ya se está revirtiendo. Esperá a que termine y actualizá el Historial." |

Una FINALIZADA **sin** fila de progreso (anterior a la Fase A) se sigue pudiendo revertir: no hay con qué saber si su
post-proceso terminó, y hoy es el comportamiento.

### 4.5 Eventos de socket

Ninguno nuevo. `import:finalizada` lleva `resumenCategoria` (es un `EstadoCargaDto`).

### 4.6 Compatibilidad y orden de deploy

- **Backend C3a con frontend C2b** (las pestañas abiertas): ignora `resumenCategoria` y `filaEsDelArchivo`; muestra
  `fila`, que ahora es la del archivo: correcto, con un tooltip que dice "posición entre las procesadas" (impreciso
  hasta que recarga). `useUltimosErrores` viejo no manda `reciente`: lo de hoy.
- **Frontend C3a con backend C2b**: `resumenCategoria` y `filaEsDelArchivo` llegan `undefined` → no se muestra el
  resumen y el tooltip es el de hoy; `reciente` se ignora → lo de hoy. Los 409 nuevos de Revertir no existen. **Nada se
  rompe**, pero el orden recomendado es **backend primero** (lleva el `db push`).
- **Volver atrás** la imagen del backend: la columna `linea` queda (nula para el cliente viejo); `resumen.categoria`
  queda en las filas y nadie la lee. Sin pasos.

---

## 5. Backend — lógica crítica

### 5.1 El runner arma el canal

`imports.service.ts:3700-3704`, una línea más, con el mismo `reportar` (`:3690`), que ya traga y avisa una vez:

```ts
resumen: (r) => reportar('resumen', () => tracker.resumenCategoria(r)),
```

### 5.2 Qué informa cada processor, y dónde

**Regla única**: la llamada es `ctx.progreso?.resumen({ … })` con el objeto entero, y va en uno de estos dos lugares:
(a) al final de `processRow` / `processBatch`, **después** de la última escritura de la fila o el lote (donde hoy está
`ctx.progreso?.contadores(…)`, si existe); (b) en `afterAll`, **inmediatamente antes de cada `this.reset()`** y antes de
cada `return` que lo saltee. Los números salen de campos que el processor ya lleva; donde hace falta uno nuevo, es un
`++` dentro de una rama que ya existe. **Prohibido**: una consulta nueva, un `await` nuevo, mover un `reset()`, cambiar
el orden de una escritura. Los `logger.log` de cierre no se tocan (siguen siendo la fuente para soporte).

| Processor | De dónde sale cada número | Contadores nuevos (`++` en rama existente) |
|---|---|---|
| DEUDORES (`deudores.processor.ts`) | `casosNuevos` = `creadosIds.size` (`:17`, ya informado en `:69`); `contactosCopiados` = `contactosEnriquecidos` (`:14`) | — |
| DEUDORES_Y_FACTURAS | ídem + `casosConFacturas` = `touchedDeudorIds.size` (`:23`) | — |
| FACTURAS | `casosConFacturas` = `touchedDeudorIds.size` (`:17`); `clientesInexistentes` = `inexistentes.size` (`:29`) | — |
| CONTACTOS | `contactosCargados` | `contactosCargados++` después del `upsert` (`contactos.processor.ts:~72`); `filasSinContactoValido++` en `if (!prep) return;` (`:~69`), **antes** del `return` |
| ENRIQUECIMIENTO | ídem, en sus ramas equivalentes (el implementer las ubica; si no hay una rama "sin contacto válido", 0 y una nota en el reporte) | ídem |
| PAGOS (`pagos.processor.ts`) | `casosConPagos` = `processedDeudorIds.size` (`:102`); `yaCargados` (`:108`); `negativos` (`:111`); `facturasMarcadas` (`:105`); `claves` de `:116-126` (null si la plantilla no mapea clave). **Ojo**: hay `resetContadores()` (`:128`); la llamada (b) va antes | — |
| ACTUALIZACIONES (`actualizaciones.processor.ts`) | `coincidencias` = `matchedExistingCount` (`:81`); `casosNuevos` = `altasIds.size` (`:74`); `reasignados` (`:102`); `contactosCopiados` (`:104`) | `pagosGenerados++` junto a `this.pagosDeudorIds.add` de la rama PAGO_TODO (`:~1044`); `salteadosSinMonto++` en `r.tipo === 'skip'` (`:~1034`); `desasignados` = `paraDesasignar.length` que ya calcula `desasignarAusentes` (`:~236`), guardado en un campo. `resultado` según la rama de `afterAll` que corre: `:921` sin origen → `SIN_REMESA_ORIGEN`; `:967-975` → `OMITIDO_SOLO_DATOS`; `:983-1012` → `ABORTADO_SIN_COINCIDENCIAS`; el resto → `APLICADO`. En `processBatch`, `NO_LLEGO` |
| ACCIONES (`acciones.processor.ts`) | `deudoresAfectados.size`, `comentariosCreados`, `contactosEliminados`, `saltadosCancelados`, `sinMatch` (`:29-34`). (b) antes del `reset()` de `:326` | — |
| MULTIRREGISTRO, MULTIARCHIVO (`casos-cedente.processor.ts`) | `altasCount`, `actualizadosCount`, `reasignadosCount`, `desasignadosCount`, `contactosEnriquecidos`, `bajasCount`, `bajasPagoCount`, `bajasRetiradasCount`, `bajasSinMatchCount`, `bajasAmbiguasCount`, `deudoresDadosDeBajaCount` (`:105-140`). (b) antes del `reset()` de `:894` | `bajasYaAplicadas` (A6, §5.8) |
| MULTICLAVES (`multiclaves.processor.ts`) | `yaCargadas` acumulado; en `afterAll`, los números que ya calcula para su log (`:~322-340`: trámites, con caso, sin caso; casos con pagos re-consolidados `:~370`). Si una rama no llega a calcularlos, `null` | `this.yaCargadas += yaCargadas` al final de `processBatch` (la variable local de `:104`/`:136`) |

**Por qué el objeto entero y no incrementos.** Igual que `contadores()` (§9.4.4 regla 3): el processor puede llamar en
cada vuelta; el tracker guarda el último. Así un reporte perdido no deja un número corrido.

### 5.3 El tracker

`progreso/progreso-tracker.ts`:

```ts
/** Canal `resumen` (C3a). Solo memoria, sincrónico, nunca tira. */
resumenCategoria(r: ResumenCategoria): void;   // this.resumenCat = r  (en try/catch; un objeto raro es un warn)
```

- **Se escribe solo al cerrar**, nunca en el reloj: `persistirSoloProgreso` (`:974`) es un `updateMany` sin lock, y el
  `resumen` se mezcla siempre bajo el lock de la fila (regla de C1, §10.3). En `finalizar` (`:631`), `cancelar`
  (`:748`) y `fallar` (`:685`), si `resumenCat` no es null, `mezclarResumen` agrega `categoria: { v: 1, ...resumenCat }`
  a lo que ya mezcla cada uno. `fallar` deja de cumplir "la clave `resumen` entra solo con el marcador": ahora entra con
  el marcador **o** con `categoria`; nunca de otra forma.
- **Una carga que cierra el reaper** (`cerrarCargaInterrumpida`) no tiene `categoria`: el proceso que la llevaba murió.
  La pantalla no muestra el resumen (§6), y eso es lo cierto.
- **Una cancelada o fallida** lleva lo informado hasta el corte: en ACTUALIZACIONES, `ausentes.resultado: 'NO_LLEGO'`.

### 5.4 La fila del archivo (A2)

`utils/recorrer-filas.ts`:

- `FilaLeida` gana `linea: number | null`. **Texto** (CSV y ancho fijo): `fila + (tieneHeader ? 1 : 0)`, con `fila` el
  contador 1-based por archivo que ya existe (`:91-99`). Es el número de **registro**; coincide con la línea física
  salvo un campo entrecomillado con saltos de línea (raro en estos cedentes; se documenta en el tooltip, no se
  calcula). **Excel**: `filaInicial + i + 1`, con `filaInicial = xlsx.utils.decode_range(sheet['!ref']).s.r` (0-based):
  `sheet_to_json` empieza en la primera fila del rango, no en la 1, y el `i` de `:110` ya cuenta las vacías que se
  saltean. **Sonda obligatoria del implementer** antes de escribirlo: un `.xlsx` con dos filas vacías arriba y una en el
  medio, y comprobar que `linea` es la que muestra Excel; si no coincide, `linea: null` para Excel y una nota en el
  reporte (no se adivina).
- Corregir el comentario de `:40` ("Es el `rowNumber` del `importerror`") y el de `:45-47` (el 1-based de `origen` no
  cuenta el encabezado; `linea` sí).

`imports.service.ts`:

- `batch.push` de `:4003` agrega `linea` (desde `alFila`). Los de `:3866`, `:3909`, `:3963` (preparsados) no: `linea`
  queda `undefined` → `null`.
- `errorBatch` (`:3741`) y sus dos `push` (`:3775-3780`, `:3805-3811`) agregan `linea: … ?? null` (en el lote, desde
  `porIdx.get(f.idx)?.linea`). Los `importerror.create`/`createMany` de avisos no la escriben.
- `errorDeCarga` (`:4666-4677`): `fila = tipo === 'AVISO' ? null : (e.linea ?? e.rowNumber + BASE_DE_FILA)`,
  `filaEsDelArchivo = tipo !== 'AVISO' && e.linea != null`. `numeroDeFila` de `errores-carga.ts:24` recibe la línea.
- El CSV (`:4743-4744`) usa `dto.fila`: ninguna columna cambia de lugar.

### 5.5 "Los últimos cinco" con avisos (A3)

`getErrors` (`imports.service.ts:4635-4664`), con `reciente === true` y `tipo` TODOS:

```
n = min(pageSize, 20)
filas  = findMany({ where: whereFilas(id),  orderBy: [{ rowNumber: 'desc' }, { id: 'desc' }], take: n })   ← índice (remesaId, rowNumber)
avisos = findMany({ where: whereAvisos(id), orderBy: [{ id: 'desc' }], take: n })                         ← rowNumber 0 fijo: el índice ya viene por id
data   = [...filas, ...avisos].sort(id desc).slice(0, n)
```

Las dos lecturas usan el índice existente (en `(remesaId, rowNumber = 0)` InnoDB ordena por la clave primaria), así que
no hay ordenamiento en memoria de 200.000 filas. `totales` se calcula como hoy. Con `reciente` y `tipo` FILA o AVISO,
la lectura de ese tipo sola.

### 5.6 Una sola definición de aviso (A4)

El `count` de `imports.service.ts:4116-4127` pasa a `this.prisma.importerror.count({ where: whereAvisos(remesaId) })`.
Es la misma condición (`rowNumber: 0` y los tres prefijos, `utils/errores-carga.ts:30-35`), así que el SQL no cambia:
un test lo afirma comparando el `where` armado con el literal de hoy. En el frontend, `esAvisoDeCarga`
(`utils/estadoCarga.ts:497`) queda solo para un backend sin `tipo`, con `/i` como el backend.

### 5.7 Revertir honesto (A5)

`revertirAcciones` (`imports.service.ts:2137-2199`), en este orden:

```
log intent (remesaId, usuarioId)
remesa = findUnique({ include: { progreso: { select: { errorPostProceso, finishedAt } } } })   (404 si no)
categoria != ACCIONES                         → 400 (igual que hoy)
accionRevertidaEn != null                     → return { yaRevertida: true, … }                (igual que hoy)
estadoProceso != FINALIZADA                   → 409 REVERTIR_NO_TERMINO     (warn)
progreso && progreso.errorPostProceso != null → 409 REVERTIR_INCOMPLETO     (warn)
si this.reversionesEnCurso.has(id)            → 409 REVERSION_EN_CURSO      (warn)
this.reversionesEnCurso.add(id)
try:
    … lo de hoy, sin cambios, hasta antes de la marca …
    { count } = remesa.updateMany({ where: { id, accionRevertidaEn: null }, data: { accionRevertidaEn, accionRevertidaPorId } })
    count == 0 → warn "otra reversión la marcó antes" (no tira: lo revertido es idempotente)
    auditoría (igual) ; log done con los tres números y los ms
finally:
    this.reversionesEnCurso.delete(id)
```

- `reversionesEnCurso` es un `Set<number>` del servicio: prod corre **un** contenedor (`docker-compose.prod.yml`), y el
  objetivo es el doble clic y el reintento tras un 504. Con más de una instancia no alcanza; C3b lo reemplaza por un job.
- Los `deudor.update(...).catch(() => {})` de `:2161` se dejan como están (un caso borrado después no frena el resto),
  pero se cuentan y se loguean en el `done` ("N casos ya no existían").
- Lo que **no** se hace acá (C3b): revertir como job, revertir parcial de una cortada.

### 5.8 Una baja por pago repetida (A6, D1)

`casos-cedente.processor.ts:673-707`. `buscarFacturaDeBaja` (`:735`) devuelve también `estado` (un campo más en el
`select` de sus dos lecturas, sin consultas nuevas). Antes de `esBajaPorPago`:

```
si encontrada.estado === 'PAGADA':
    this.bajasYaAplicadas++ ; this.bajasCount++ ; return      ← no crea pago, no toca la factura ni el monto ni la gestión
```

- Cubre las dos causas: la misma baja en un paquete vuelto a cargar o reenviado por el cedente, y una factura que ya
  marcó como PAGADA un archivo de PAGOS (el pago ya existe). Una factura **ANULADA** que llega como baja por pago sigue
  creando el pago (es un cambio de motivo real).
- No hay aviso en `importerror` (sería una escritura nueva): el número sale en el resumen (§6.2).
- Va en **un commit propio**, para que el control de §8 compare el resto sin ruido.

### 5.9 Logging

`revertirAcciones`: intent/done con ms (hoy no tiene); los 409 en `warn`. El tracker: un `warn` si `resumenCategoria`
recibe algo que no es un objeto con `tipo` (una sola vez por carga, como `reportar`). El runner no loguea el resumen
(ya lo hacen los `logger.log` de cierre de cada processor).

---

## 6. Frontend

### 6.1 `ResumenDeCarga` (nuevo) y `utils/resumenCategoria.ts` (nuevo)

- `lineasDeResumen(r: ResumenCategoria, carga: Pick<EstadoCargaDto, 'ok' | 'err' | 'cancelada' | 'resultado'>):
  Array<{ texto: string; tono: 'normal' | 'aviso' }>` — pura, con sus tests. Singulares y punto de miles con las
  utilidades de C2 (`formatearNumero`). Una línea con 0 **no se muestra**, salvo las marcadas "siempre".
- `ResumenDeCarga` las dibuja como lista compacta (`SectionCard` "Qué hizo la carga"), tono `aviso` con
  `theme.palette.warning`. Se monta en el **Resultado del asistente** (`ImportSummary.tsx`, debajo de las métricas de
  `:262-263`) para cada remesa con `resumenCategoria`, y en el **detalle** (`pages/ImportDetail.tsx`, debajo del
  `Alert` del resultado, `:544-548`) cuando la carga es terminal. En una división, el Resultado lo muestra por remesa
  (no se suman: los números de una MULTI\* no son sumables con sentido).

### 6.2 Textos

| Categoría | Línea | Tono | Cuándo |
|---|---|---|---|
| DEUDORES, D\_Y\_F | "{casosNuevos} casos nuevos" | normal | siempre |
| | "{ok − casosNuevos} filas cayeron sobre un caso que esta misma carga ya había creado: el archivo repite la identidad del caso y la última fila pisó a la anterior" | **aviso** | `ok − casosNuevos > 0` |
| | "{contactosCopiados} contactos copiados de casos anteriores del mismo cliente" | normal | |
| FACTURAS | "Facturas en {casosConFacturas} casos" · "{clientesInexistentes} clientes del archivo no existen en la remesa de origen (sus filas figuran como error)" | normal · aviso | |
| CONTACTOS, ENRIQ. | "{contactosCargados} contactos cargados" · "{filasSinContactoValido} filas no tenían un contacto válido (vacío, o un teléfono o mail que no se pudo normalizar): no se cargó nada de ellas y no figuran como error" | normal · **aviso** | |
| PAGOS | "Pagos en {casosConPagos} casos" · "{yaCargados} pagos ya estaban cargados y no se duplicaron" · "{negativos} pagos con importe negativo: **aumentan** la deuda del caso" · "{facturasMarcadas} facturas marcadas como pagadas" | normal · normal · **aviso** · normal | |
| | Con `claves`: "{noCargada} claves no están cargadas", "{otraEmpresa} claves son de otra empresa", "{ilegible} referencias ilegibles", "{casosFueraDeRemesaOrigen} casos fuera de las remesas de origen" | aviso | |
| ACTUALIZACIONES | "{coincidencias} filas coincidieron con casos de la cartera · {casosNuevos} casos nuevos · {reasignados} reasignados" | normal | siempre la primera |
| | `APLICADO` + PAGO\_TODO: "{pagosGenerados} casos ausentes del archivo se dieron por pagados" (+ "{salteadosSinMonto} ausentes sin importe no se tocaron", aviso) | normal | |
| | `APLICADO` + DESASIGNAR: "{desasignados} casos ausentes del archivo se desasignaron" | normal | |
| | `APLICADO` + IGNORAR: "Los casos ausentes del archivo no se tocaron (la plantilla dice ignorarlos)" | normal | |
| | `ABORTADO_SIN_COINCIDENCIAS`: "**No se dio por pagado a ningún ausente**: ninguna fila del archivo coincidió con la cartera de origen. Revisá el archivo, la plantilla y la remesa de origen." | **aviso** | |
| | `OMITIDO_SOLO_DATOS`: "Los ausentes no se tocaron: la plantilla solo actualiza datos, o el archivo no trajo importes" | normal | |
| | `NO_LLEGO` en una cancelada o fallida: "El cierre de los ausentes no corrió" | aviso | |
| ACCIONES | "{deudoresAfectados} casos afectados · {comentariosCreados} comentarios · {contactosEliminados} contactos eliminados" · "{saltadosCancelados} casos cancelados se saltearon" · "{filasSinMatch} filas no encontraron ningún caso" | normal · normal · **aviso** | |
| MULTI\* | "{altas} altas · {actualizados} actualizados · {reasignados} reasignados · {desasignados} desasignados" · "{bajas} bajas: {bajasPago} por pago, {bajasRetiradas} retiradas por el cedente" · "{bajasYaAplicadas} bajas por pago ya estaban aplicadas y no se volvieron a registrar" · "{bajasSinMatch} bajas sin factura que coincida, {bajasAmbiguas} ambiguas" · "{casosDadosDeBaja} casos quedaron sin facturas vigentes y salieron de gestión" | normal · normal · normal · **aviso** · normal | |
| MULTICLAVES | "{tramites} trámites: {conCaso} con caso, {sinCaso} sin caso · {yaCargadas} ya estaban cargados" | normal | |

### 6.3 Errores y Revertir

- `ErroresDeCarga.tsx:144-149`: con `filaEsDelArchivo === true`, la columna dice la fila y el tooltip "Fila del
  archivo (en Excel, el número de fila de la hoja). Con varios archivos, cuál es lo dice el mensaje."; con `false`,
  el tooltip de hoy. La etiqueta de la columna no cambia ("Fila").
- `useUltimosErrores.ts:8`: `PARAMS = { tipo: 'TODOS', orden: 'desc', reciente: true, page: 1, pageSize: 5 }`, y
  `obtenerErrores` (`api/imports`) pasa el parámetro.
- `pages/ImportHistory.tsx:224-240`: un 409 con `code` muestra su texto (el del backend) en el toast de error; un error
  **sin respuesta** o con 502/503/504 muestra "No llegó la respuesta del servidor. La reversión puede seguir corriendo:
  actualizá el Historial en unos minutos antes de volver a intentar." El diálogo (`:344-359`) no cambia.

---

## 7. Fallos silenciosos

| Qué puede pasar en silencio | Cómo se va a notar |
|---|---|
| Un processor cambia lo que escribe al agregarle el reporte | Control de §8 (jest: misma secuencia de llamadas a Prisma con y sin el canal; MySQL: dump idéntico). Criterio CA-2 |
| `resumen` mezclado sin lock pisa `origen` o `cancelacion` | Test del tracker: cancelar con `categoria` conserva `cancelacion` y `origen`; retomar sigue funcionando (CA-4) |
| Un `reset()` corre antes del reporte y el resumen sale en 0 | Test por processor: el `resumen` final trae los números del log de cierre (mismo escenario) |
| La fila del archivo mal calculada (encabezado, Excel con filas vacías arriba, varios archivos) | Tests de `recorrer-filas` con los tres casos + la sonda del Excel; si no se puede afirmar, `null` y se muestra lo de hoy |
| Un `resumenCategoria` de un tipo que el frontend no conoce | `lineasDeResumen` devuelve `[]` y el componente no se monta (test) |
| Revertir se niega a una remesa que se podía revertir | Solo rechaza FALLIDA, en curso o con `errorPostProceso`; la heredada sin fila pasa (test) |
| Una baja repetida con una factura que se marcó PAGADA **por error** deja de crear el pago | Es el comportamiento buscado (D1); el número sale en el resumen con su texto |
| Lo que **sigue** silencioso después de C3a | Una carga cerrada por el reaper no tiene resumen; ENRIQUECIMIENTO puede no distinguir "sin contacto válido"; los descartes por filtro siguen siendo solo un contador (ya visibles desde la Fase B) |

---

## 8. El control "estado de la base idéntico con y sin el cambio"

Dos capas. La primera corre en cada `npm test`; la segunda la corre el auditor una vez.

### 8.1 Jest: la misma secuencia de llamadas a Prisma (automático)

En `processors/progreso-reportes.spec.ts` (ya instancia los processors reales con un `prisma` falso mínimo), un helper
`grabarPrisma(falso)`: un `Proxy` de dos niveles que registra `modelo.metodo(args)` (args con `JSON.stringify`
estable) y delega. Por cada uno de los once processors, el mismo escenario dos veces —`ctx.progreso` **ausente** y
`ctx.progreso` con el espía completo (incluido `resumen`)— y `expect(llamadasCon).toEqual(llamadasSin)`. En ACTUALIZACIONES,
tres escenarios (PAGO\_TODO, DESASIGNAR, sin coincidencias); en MULTI\*, uno con bajas por pago y retiradas. Esto
prueba "sin consultas nuevas ni cambios de orden" con independencia del dato.

### 8.2 MySQL: el dump normalizado, base contra C3a (el auditor)

Contra MySQL y Redis locales, con el arnés `auditoria-be-c1` (copia en
`~/.claude/projects/-home-maxi-Documentos-GitHub-amsa-gestion/arneses-auditoria/`; ajustar rutas y **volver a medir
`BASE` y `REMESA_MIN` en `limpiar-todo.js`** antes de limpiar):

1. `mysqldump --single-transaction --routines <base> > $SCRATCH/c3a-base.sql` (incluye los `AUTO_INCREMENT`, así los
   ids nuevos coinciden entre corridas).
2. Worktree en `38a25c2` (`git worktree add $SCRATCH/wt-base 38a25c2`), `npm ci && npx prisma generate && npm run build`.
   Levantar `node dist/main` con `PORT=3901 LOG_DIR=$SCRATCH/logs-base`. Correr, **en este orden y de a una**, las
   cargas del arnés: DEUDORES (con dos filas de identidad repetida), DEUDORES\_Y\_FACTURAS, FACTURAS, CONTACTOS (con un
   teléfono basura), PAGOS (con un negativo y una fila ya cargada), ACTUALIZACIONES PAGO\_TODO, ACTUALIZACIONES DESASIGNAR,
   ACTUALIZACIONES sin coincidencias, ACCIONES (SET\_SITUACION + ADD\_COMENTARIO + DELETE\_CONTACTO), MULTIRREGISTRO (el
   archivo generado con el layout Toyota del repo, con bajas por pago y retiradas, **sin** bajas repetidas). Volcar
   `$SCRATCH/antes.tsv` con el script de abajo. Bajar la app.
3. `mysql <base> < $SCRATCH/c3a-base.sql`. Lo mismo con el árbol de C3a (`PORT=3902`, `LOG_DIR=$SCRATCH/logs-c3a`;
   antes, `npx prisma db push` sobre la base restaurada) → `$SCRATCH/despues.tsv`.
4. `diff antes.tsv despues.tsv` tiene que dar **solo**: `import_progreso.resumen` (la clave `categoria`) e
   `importerror.linea` (columna nueva, que en `antes` no existe: se vuelca como `\N`).

El volcado (`$SCRATCH/volcar.sql`): `SELECT` con `ORDER BY id` de `deudor`, `factura`, `pago`, `contacto`,
`comentario`, `accion_masiva_snapshot`, `clave_pago`, `promesa_pago`, `campoextra`, `importerror`, `remesa`,
`import_progreso` y `transaccion` (solo `modulo='IMPORT'`), **sin** las columnas que dependen del reloj: `createdAt`,
`updatedAt`, `confirmadoEn`, `encoladaAt`, `startedAt`, `heartbeatAt`, `finishedAt`, `accionRevertidaEn`; `pago.fecha`
truncada a fecha (los pagos automáticos usan `new Date()`); y de `import_progreso`, también `velocidad`/ritmo y `rev`
(dependen de cuántos tics hubo). MULTIARCHIVO y MULTICLAVES no tienen archivos locales: quedan cubiertos solo por 8.1,
y se dice en el reporte.

A6 tiene su propia prueba (no es "sin cambio"): el mismo paquete MULTIRREGISTRO cargado dos veces; en la segunda, 0
pagos nuevos por bajas y `bajasYaAplicadas` igual a las bajas por pago de la primera.

---

## 9. Plan de pruebas

### 9.1 Backend (jest; y **`npm run build`**, porque jest no chequea tipos y el backend compila con `isolatedModules`)

| Archivo | Casos |
|---|---|
| `processors/progreso-reportes.spec.ts` | §8.1 para los once; el `resumen` final de cada uno con los números esperados del escenario; ACTUALIZACIONES con los cinco `resultado` (incluido `NO_LLEGO` en `processBatch`); el reporte va **antes** del `reset()` (el resumen no sale en 0) |
| `processors/multirregistro.processor.spec.ts` (y `multiarchivo`) | A6: baja por pago sobre factura PAGADA → sin `pago.create`, sin `factura.update`, `bajasYaAplicadas` 1; sobre ANULADA → crea el pago; sobre vigente → lo de hoy |
| `progreso/progreso-tracker.spec.ts` | `resumenCategoria` no escribe; `finalizar`/`cancelar`/`fallar` mezclan `categoria` con lo leído bajo el lock y conservan `origen`, `cancelacion` y `sinFilasEntregadas`; `fallar` sin marcador ni categoría no agrega la clave `resumen`; el reloj nunca la escribe |
| `progreso/estado-carga.spec.ts` | `resumenCategoria` null mientras corre, en heredada y sin `categoria`; el objeto en terminal; un `resumen` string JSON (como lo devuelve un `$queryRaw`) también |
| `utils/recorrer-filas.spec.ts` | `linea` con y sin encabezado; dos archivos (la línea reinicia, `indice` no); Excel con filas vacías arriba y en el medio (fixture generado en el test con `xlsx`) |
| `imports-errores.spec.ts` (o el de C2a que cubre `getErrors`) | `fila` = `linea` con `filaEsDelArchivo`; sin `linea`, `rowNumber + 1` y `false`; aviso `null`; `reciente`: 7 errores de fila y 2 avisos → los 5 más nuevos por id con los avisos adentro; `reciente` con `pageSize` 50 → 20; sin `reciente`, igual que hoy |
| `imports.service` (runner) | El `count` de avisos usa `whereAvisos` (el `where` es igual al literal de hoy); `errorBatch` lleva `linea` en el camino por fila y por lote; preparsados con `linea` null |
| `imports-revertir.spec.ts` (nuevo) | 409 `REVERTIR_NO_TERMINO` (FALLIDA, PROCESANDO); 409 `REVERTIR_INCOMPLETO`; heredada FINALIZADA sin fila → revierte; dos pedidos a la vez → uno 200 y otro 409 `REVERSION_EN_CURSO`; el `Set` se libera si tira; `updateMany` condicional; ya revertida → `yaRevertida` |
| `imports.controller.spec.ts` | `reciente=true` llega como booleano; `reciente=foo` → 400 |

Suite completa en verde (base: la del cierre de C2b) y `npm run build` sin errores. **No** correr `npm run lint`.

### 9.2 Frontend (vitest con el arnés de `frontend/tests`, `npx tsc --noEmit -p tsconfig.json`, `npm run build`)

- `tests/utils/resumenCategoria.test.ts`: cada categoría con sus líneas, singulares, ceros que no se muestran, la línea
  "cayeron sobre un caso…" solo con `ok − casosNuevos > 0`, los cinco `resultado` de ACTUALIZACIONES, un `tipo`
  desconocido → `[]`.
- `tests/componentes/resumenDeCarga.test.tsx`: Resultado del asistente con una remesa con resumen y otra sin (backend
  viejo); detalle terminal con resumen; detalle en curso sin resumen.
- `tests/componentes/erroresDeCarga*.test.tsx`: tooltip según `filaEsDelArchivo` (y `undefined`).
- `tests/hooks/useUltimosErrores*.test.ts`: el pedido lleva `reciente=true`; con el servidor falso devolviendo avisos,
  la tarjeta los muestra entre los cinco.
- `tests/paginas/historial*.test.tsx`: Revertir con 409 `REVERTIR_INCOMPLETO` muestra el texto del backend; con un
  pedido que no responde (el servidor falso cierra la conexión) muestra "puede seguir corriendo".

### 9.3 Prueba manual (auditor y usuarios que prueban)

Con el backend y el frontend de C3a contra la base local (o el primer uso real en prod):

1. Cargar un DEUDORES con dos filas que repiten documento → en el Resultado, "1 fila cayó sobre un caso que esta misma
   carga ya había creado…" en tono de aviso; lo mismo en el detalle desde el Historial.
2. Cargar un PAGOS con un importe negativo y el mismo archivo otra vez → la segunda dice "N pagos ya estaban
   cargados…" y la primera "1 pago con importe negativo: aumenta la deuda del caso".
3. ACTUALIZACIONES "pagó todo" con un archivo de otra cartera → "No se dio por pagado a ningún ausente…".
4. Una carga con 6 errores de fila y un aviso de parseo, mirada en vivo → el aviso aparece entre los últimos cinco.
5. Un Excel con el encabezado en la fila 1 y un error en la fila 8 de la hoja → la tabla de errores dice 8; el CSV
   también.
6. Revertir una ACCIONES FINALIZADA dos veces muy rápido (dos pestañas) → una revierte y la otra dice "ya se está
   revirtiendo"; Revertir por API sobre una ACCIONES FALLIDA → 409 con el texto, y `accionRevertidaEn` sigue null.
7. 360 px y 1280, claro y oscuro: el bloque "Qué hizo la carga" no desborda.

---

## 10. Documentación

- **Wiki** (`docs/ayuda/03-importacion/`): `05-importar-un-archivo.md` (el Resultado: "Qué hizo la carga", con un
  ejemplo por categoría que más se usa); `08-historial-y-problemas.md` (la columna Fila es la del archivo en las cargas
  nuevas; los avisos en los últimos cinco; los tres motivos nuevos de Revertir); `07-acciones-masivas.md` (cuándo no se
  puede revertir y por qué); `06-actualizaciones.md` (qué significa "no se dio por pagado a ningún ausente");
  `09-multirregistro-y-multiarchivo.md` (bajas ya aplicadas). Verificar con `cd frontend && npm run verificar-ayuda`.
- **Spec principal**: la línea al principio de §10.15 "Entrega 3" (hecha con este documento); al cerrar C3a, §10.1
  marca C3 → C3a/C3b/C3c con el enlace.
- **CHANGELOG.md**: una entrada "Importaciones, entrega C3a" con el formato de C2a/C2b (estado, decisiones, Backend,
  Frontend, Documentación, deuda y prueba manual), y el `db push` de `importerror.linea` dicho explícitamente.
- `schema.prisma`: el `///` de `import_progreso.resumen` suma `categoria`.

---

## 11. Criterios de aceptación (C3a)

- **CA-1** Para cada una de las once categorías, `progreso-reportes.spec.ts` afirma la misma secuencia de llamadas a
  Prisma con y sin el canal (§8.1) y pasa.
- **CA-2** El diff de §8.2 entre `38a25c2` y C3a, con las diez cargas, contiene solo `import_progreso.resumen.categoria`
  e `importerror.linea`.
- **CA-3** Una DEUDORES de 100 filas con 3 identidades repetidas termina con `resumenCategoria = { tipo: 'DEUDORES',
  casosNuevos: 97, … }` en `GET /import/remesas/:id/progreso`, en `import:finalizada` y en el Historial, y el Resultado
  muestra "3 filas cayeron sobre un caso…".
- **CA-4** Una carga cancelada a mitad tiene `resumen.categoria` con lo hecho hasta el corte **y** conserva
  `resumen.origen` y `resumen.cancelacion`; una cancelada en cola sigue siendo retomable y se retoma (201).
- **CA-5** Una ACTUALIZACIONES PAGO\_TODO sin ninguna coincidencia termina con `ausentes.resultado =
  'ABORTADO_SIN_COINCIDENCIAS'`, 0 pagos creados, y el texto en tono de aviso en el Resultado y en el detalle.
- **CA-6** En un CSV con encabezado, un error en la línea 10 del archivo tiene `linea = 10`, `fila = 10`,
  `filaEsDelArchivo = true`; en el CSV de errores la columna "Fila" dice 10. En una carga anterior a C3a, `fila` =
  `rowNumber + 1` y `filaEsDelArchivo = false`.
- **CA-7** `GET /import/errores/:id?orden=desc&reciente=true&pageSize=5` sobre una carga con 7 errores de fila y 2
  avisos devuelve 5 elementos ordenados por `id` descendente que incluyen a los avisos si están entre los 5 más nuevos;
  sin `reciente`, la respuesta es idéntica a la de C2b.
- **CA-8** `POST …/revertir-acciones` sobre una ACCIONES FALLIDA responde 409 `REVERTIR_NO_TERMINO` y no toca
  `accionRevertidaEn`; dos pedidos simultáneos sobre una FINALIZADA dan un 200 y un 409 `REVERSION_EN_CURSO`, y la
  auditoría tiene **un** "Revirtió acción masiva".
- **CA-9** Cargar dos veces el mismo paquete MULTIRREGISTRO con 5 bajas por pago crea 5 pagos en total (no 10), y la
  segunda carga informa `bajasYaAplicadas: 5`.
- **CA-10** `prisma migrate diff` (base local con `db push` hecho) vacío; `npm run build` del backend y del frontend en
  verde; `tsc --noEmit` sin errores nuevos (base: 4); `npm run verificar-ayuda` en verde.

---

## 12. Paquetes de trabajo (dos implementers en paralelo, sin archivos en común)

El contrato está fijado en §4 (tipos textuales). Ninguno espera al otro.

**Paquete BE — backend** (y nada de `frontend/` ni `docs/ayuda/`):
`backend/prisma/schema.prisma`; `backend/src/modules/imports/progreso/{estado-carga.types.ts, estado-carga.ts,
progreso-tracker.ts}` y sus specs; `processors/processor.interface.ts`, los once processors y sus specs,
`processors/progreso-reportes.spec.ts`; `utils/{recorrer-filas.ts, errores-carga.ts}` y specs; `historial.types.ts`;
`dtos/import.dto.ts`; `imports.controller.ts`; `imports.service.ts`; `imports-revertir.spec.ts` (nuevo). Commits: (1) A1+A2+A3+A4+A5,
(2) A6 sola.

**Paquete FE — frontend y wiki** (y nada de `backend/`):
`frontend/src/types/{importProgreso.ts, importHistorial.ts}` (copia textual de §4); `utils/resumenCategoria.ts`
(nuevo); `components/import/ResumenDeCarga.tsx` (nuevo); `components/import/ImportSummary.tsx`; `pages/ImportDetail.tsx`;
`components/import/ErroresDeCarga.tsx`; `hooks/useUltimosErrores.ts`; `api/imports.ts` (el parámetro `reciente`);
`utils/estadoCarga.ts` (solo `esAvisoDeCarga`); `pages/ImportHistory.tsx` (solo `handleRevertirConfirmado`); tests en
`frontend/tests/`; `docs/ayuda/03-importacion/{05,06,07,08,09}`. Para correr dos suites a la vez, `FE_TEST_PUERTO`.

**Quien orquesta**: CHANGELOG, la marca en §10.1 del spec principal, y este documento ("lo que cambió al auditar").

**Deploy**: un push con los dos; el workflow del backend (con el `db push` de `importerror.linea`) **antes** que el del
frontend, como en C1. Si el frontend sale primero no se rompe nada (§4.6), solo no se ve lo nuevo. Después del deploy:
`migrate diff` vacío y la columna `linea` en `importerror` (recetas `prod-db-query-ssm` y `db-push-deploy-falla-parcial`).

---

## 13. Las partes siguientes, esbozadas

### 13.1 C3b — Acciones masivas cortables y reversibles

Reemplazado por el diseño ejecutable de [§17](#17-c3b-diseño-ejecutable). Lo que cambió respecto de este esbozo: los
snapshots van **en la misma transacción que cada caso** y no por lote (decidido con la medición de §17.1); el estado
de la reversión vive en una tabla nueva, `reversion_accion`, y cada snapshot se marca con `revertidoEn`.

### 13.2 C3c — El deploy no mata cargas a ciegas

**Lo que se leyó** (§15): `main.ts` no llama a `app.enableShutdownHooks()` y `PrismaService.enableShutdownHooks`
(`prisma.service.ts:21-37`) no se llama nunca; el contenedor corre `node dist/main` como PID 1 (`Dockerfile.backend`) y
el compose no tiene `init` ni `stop_grace_period`. Así, en un deploy el `SIGTERM` no lo atiende nadie (Node como PID 1
sin handler lo ignora), Docker espera 10 s y manda `SIGKILL`; la carga en curso muere a mitad de un lote, BullMQ falla
el job (`maxStalledCount: 0`, `bullmq/imports.processor.ts:22`) y el reaper la cierra "al menos N".

**Alcance.** (1) `app.enableShutdownHooks()` en `main.ts` (y borrar el método muerto de `PrismaService`, que además
registraría un segundo handler). (2) Un `beforeApplicationShutdown` en el servicio de imports: para cada carga viva,
`tracker.avisarCancelacion()` con un origen "sistema"; el runner corta en su próximo punto de corte y cierra con
**`fallar`** (no `cancelar`: nadie la canceló) con el texto de interrupción "por un reinicio del servidor" y los
números exactos, más `sinFilasEntregadas` si corresponde (retomable). Espera hasta `IMPORTS_GRACIA_CIERRE_MS` (por
defecto 60 s) a que la carga cierre; después deja seguir el cierre de Nest (`worker.close()`, que espera el job). Una
carga en post-proceso no se corta: si no termina dentro de la gracia, `SIGKILL` y reaper, como hoy. (3)
`stop_grace_period: 90s` en `docker-compose.prod.yml` — **llega a la EC2 solo por SSM**: el parámetro `_compose` se
escribe con `terraform apply` (`infra/terraform/ssm.tf:47-51`), no con el push. (4) Opcional (decisión de ese diseño):
`deploy.sh` espera hasta N minutos a que no haya cargas en `PROCESANDO` antes del `up -d`.

**Riesgos.** `enableShutdownHooks` activa los `onModuleDestroy` de Neotel y de la consolidación (Redis) por primera vez
en prod: hay que probar que no cuelgan. **Lo destraba** la medición de cuánto tarda un lote real (log `Filas remesa=…
filas/s`): con eso se fija la gracia; sin ella, 60/90 s y la degradación es la de hoy. **Dependencias**: C1; mejor
después de C3b. **Estimación**: medio día + el `apply`.

### 13.3 C3d — Descartada (ver §1)

### 13.4 Backlog con su medición

| Qué | Lo destraba |
|---|---|
| Puntos de corte dentro del post-proceso | Post-procesos reales de más de 2 min. En prod: `fields @message | filter @message like /Post-proceso remesa=.*terminó en/` en CloudWatch `/amsa-gestion/backend` |
| "Vaciar y volver a cargar" una DEUDORES en un paso | Un operador con una carga a medias de más de 60.000 casos (no se puede eliminar) |
| PAGOS: pago manual confirmado sin id de cobro se duplica al recargar un acumulativo | Una plantilla real sin id de cobro en uso |
| El combo de remesa de origen filtra FINALIZADA solo en el frontend | Arreglo chico propio (400 en el backend) |
| El alta de una división no es transaccional | — (lo limpia el reaper) |

---

## 14. Lo que necesita el OK del usuario

Si no hay respuesta, se sigue con la recomendada.

- **D1 — Una baja por pago que llega sobre una factura ya PAGADA.** (a) **Recomendada**: no crea otro pago y se cuenta
  como "baja ya aplicada" en el resumen (A6, en C3a, commit propio). (b) Dejarla en el backlog: recargar o reenviar un
  paquete MULTIRREGISTRO/MULTIARCHIVO sigue duplicando pagos y puede cancelar un caso con cuotas vigentes.
- **D2 — Revertir una acción masiva cuyo post-proceso no guardó los snapshots completos.** (a) **Recomendada**: el
  backend la rechaza con un 409 que manda a soporte (es lo que la pantalla ya dice) hasta C3b, que ofrece revertir lo
  cubierto diciendo cuánto. (b) Revertir lo que haya, como hoy, y marcarla revertida.
- **D3 — La columna "Fila" de los errores.** (a) **Recomendada**: en las cargas nuevas es la fila del archivo (en Excel,
  la de la hoja), con el tooltip que lo dice; las anteriores siguen como están. (b) Dejar "Fila" como la posición entre
  las procesadas y agregar la del archivo como columna aparte (cambia el CSV de columnas).

---

## 15. Qué se verificó y qué es suposición

**Ejecutado**: nada contra MySQL ni Redis; solo lecturas del árbol con `grep`/`sed`. `docker` no está instalado en este
entorno, así que lo de PID 1 no se probó.

**Leído** (contra `38a25c2`): `imports.service.ts` (`revertirAcciones` `:2137-2199`, runner `:3458-4186`, `getErrors`
`:4635-4677`, CSV `:4680-4750`), `progreso/progreso-tracker.ts` (`finalizar`, `fallar`, `cancelar`, `persistir`),
`progreso/estado-carga.types.ts`, `progreso/estado-carga.ts`, `processors/processor.interface.ts`, los once processors
(campos contadores y cierres), `acciones.processor.ts` entero, `actualizaciones.processor.ts:920-1081`,
`casos-cedente.processor.ts:670-760`, `utils/recorrer-filas.ts`, `utils/errores-carga.ts`, `bullmq/imports.processor.ts`,
`main.ts`, `prisma.service.ts`, `Dockerfile.backend`, `docker-compose.prod.yml`, `infra/ec2/deploy.sh`,
`infra/terraform/ssm.tf`, `.github/workflows/deploy-backend.yml`, `schema.prisma` (`importerror`, `import_progreso`,
`accion_masiva_snapshot`, `remesa`); frontend `useUltimosErrores.ts`, `ErroresDeCarga.tsx`, `estadoCarga.ts`,
`ImportHistory.tsx` (Revertir), `historialImportaciones.ts`, `ImportDetail.tsx`, `ImportSummary.tsx`. Que prod no
tiene cargas desde el 30/09 sale de la memoria del proyecto y del CHANGELOG, no de una consulta de hoy.

**Suposiciones a confirmar por el implementer** (cada una con su salida si falla): las líneas citadas con `~` (ramas de
CONTACTOS, ENRIQUECIMIENTO, MULTICLAVES y la rama "skip" de ACTUALIZACIONES); que `sheet_to_json` empieza en la fila de
`!ref` (sonda de §5.4; si no, `linea: null` en Excel); que `docker compose up -d` usa el `stop_grace_period` del
compose nuevo al reemplazar el contenedor (C3c, a verificar en ese diseño).

---

## 16. Lo que cambió en C3a después de la auditoría (14/10/2026)

El mismo formato que en C2:
- dos implementers en paralelo: backend 13 min, frontend 12;
- una sola pasada de auditoría: 11 min, **PASA CON OBSERVACIONES**, sin bloqueantes ni altos;
- una revisión aparte de la wiki contra el código;
- los arreglos los hizo quien orquesta, cada uno con su test.

Donde §2 a §11 y esto se contradicen, vale esto.

**El control de §8.2, ejecutado contra MySQL local.** No hay `mysqldump` en el entorno. El auditor lo reemplazó con
un volcado normalizado de las filas nuevas de las 37 tablas con `id`, y repuso los `AUTO_INCREMENT` entre la corrida
base (worktree en `38a25c2`) y la de C3a.

Cargas corridas:
- DEUDORES ×3, con identidades repetidas;
- FACTURAS, CONTACTOS;
- PAGOS ×2, el mismo archivo;
- ACTUALIZACIONES: pagó todo, desasignar y sin coincidencias;
- ACCIONES;
- MULTIRREGISTRO en dos días, con bajas.

Resultado: 225 filas en cada corrida.
- El diff solo muestra `importerror.linea` (7 filas) y `import_progreso.resumen.categoria` (13 cargas), más ruido
  revisado a mano (nombres con timestamp, `jobId`, el orden de 4 filas de auditoría que la consolidación escribe en
  paralelo).
- Con D1, el día 2 recargado deja 2 pagos en vez de 4.
- Sin correr en MySQL, cubiertas solo por la prueba de jest de §8.1: DEUDORES_Y_FACTURAS, ENRIQUECIMIENTO,
  MULTIARCHIVO y MULTICLAVES.

| Qué | Cómo quedó | Por qué |
|---|---|---|
| **PAGOS: `negativos`** (MEDIO) | Cuenta solo los pagos negativos que esta carga creó. Ni los ya cargados ni un pago manual que se confirma suman, porque no mueven la deuda ahora. También cambia el `warn` del log, que usa el mismo contador | En una recarga del mismo archivo, la pantalla avisaba en tono de alerta de "1 pago con importe negativo: aumenta la deuda" sin haber cargado nada (reproducido) |
| **Auditoría de Revertir** (BAJO) | El texto distingue tres casos: un pedido rechazado da "Intentó revertir la acción masiva de la remesa N" (el interceptor lo marca FALLIDO); una que ya estaba revertida da "La acción masiva de la remesa N ya estaba revertida"; una reversión real sigue diciendo "Revirtió…" | Con un segundo clic, el 409 `REVERSION_EN_CURSO` y el `yaRevertida` quedaban auditados como "Revirtió…": cuatro filas para una sola reversión |
| **ACTUALIZACIONES: la protección de "0 coincidencias" contaba casos creados por la misma carga** (grave, ya venía de antes; lo encontró la revisión de la wiki) | `matchedExistingCount` solo cuenta los casos que ya estaban en la remesa de origen, no los de `altasIds`. Va en su propio commit. Un caso creado por la carga nunca queda como ausente: se agrega a `processedDeudorIds` | Un archivo apuntado a la remesa equivocada, con `crearNuevosCasos` y un documento repetido (Telecom/Personal repiten la cuenta madre y las hijas), pasaba la protección y daba por pagados o desasignaba **todos** los casos de la remesa. Es la protección del incidente de Toyota (CHANGELOG 2026-07-21) |
| ACTUALIZACIONES: el cierre de ausentes y su resumen | La desasignación abortada informa `ABORTADO_SIN_COINCIDENCIAS` (antes, `APLICADO` con 0). El resumen del cierre se informa apenas terminan las escrituras, antes de consolidar, así que una carga CON_ADVERTENCIAS conserva los números reales; si el bucle falla a mitad, refleja lo escrito. `afterAll` hace `reset()` en un `finally` | El `reset()` que no corría si fallaba la consolidación dejaba `matchedExistingCount` en la instancia y desactivaba la protección de la carga siguiente |
| Ancho fijo: `linea` | La línea física del archivo, con el encabezado y las líneas vacías (`crearStreamAnchoFijo` con `conLinea`) | Saltear las vacías corría el número |
| Pantalla y wiki | DEUDORES_Y_FACTURAS sin el falso "filas que cayeron sobre un caso…" (es una fila por factura) y con "Facturas en N casos"; CONTACTOS/ENRIQUECIMIENTO hablan del contacto principal; ACTUALIZACIONES dice cuándo se abortó la desasignación y cuándo el cierre no terminó en una carga con advertencias. La wiki aclara qué cargas traen la fila del archivo (no Multirregistro, Multiarchivo ni Claves de pago), la regla de ceros, y que el total de bajas incluye las ya aplicadas | La revisión de la wiki contra el código: la tarjeta afirmaba de más en esos casos |
| Desvíos de los implementers, aceptados | Backend: D1 solo para bajas **por pago**; `reciente=foo` da 400; con `reciente`, `page` se ignora y `pageSize` ≤ 20; `processRow` como envoltorio con `try/finally` en PAGOS, ACCIONES y MULTI\* (lo sostienen el diff de la base y §8.1). Frontend: solo los campos de la tabla de §6.2, más una línea para `SIN_REMESA_ORIGEN`; `silencioso: true` en el POST de revertir | Revisados por el auditor |

**Deuda conocida:**
- Dos valores de `resultado` propuestos y no agregados, porque cambian el contrato:
  - el modo degradado de la desasignación (parámetro GES-094 no resuelto) sigue informando `APLICADO` con 0;
  - un cierre que falla a mitad del bucle informa `APLICADO` con lo escrito, no `INCOMPLETO`.
- En MULTI\*, una baja **retirada** que llega repetida se vuelve a contar como retirada. Ya pasaba antes de C3a. Para
  arreglarlo hace falta un contador nuevo en el contrato, para que la suma de bajas siga cerrando.
- La severidad ERROR de un 409 en la auditoría es del interceptor, para todos los endpoints.
- Sin ejecutar en vivo:
  - `linea` en Excel y en ancho fijo (sí con la sonda de jest);
  - avisos mezclados en "los últimos cinco";
  - el resumen de una carga cancelada o fallida, y retomarla;
  - los 409 `REVERTIR_NO_TERMINO` y `REVERTIR_INCOMPLETO`.

  Los cubren los tests, y el guion manual de §9.3 los recorre.
- Nada se vio en un navegador.

---

## PLAN PARA IMPLEMENTER — Fase C, entrega 3a

**Orden de implementación:**
Paso 1 (BE): tipos de §4 en `estado-carga.types.ts` y `historial.types.ts`; `resumen` en `ReporteProgreso`; `linea` en
`schema.prisma` + `npx prisma db push` local + `npx prisma generate`. Va primero porque todo lo demás compila contra eso.
Paso 2 (BE): tracker (`resumenCategoria`, mezcla en los tres cierres) y `armarEstadoCarga`; sus tests.
Paso 3 (BE): el helper `grabarPrisma` y la prueba "misma secuencia" de §8.1 **en rojo contra nada todavía** (debe pasar
ya con el código de hoy); recién después, los once processors, uno por uno, corriendo esa prueba después de cada uno.
Paso 4 (BE): `recorrer-filas` (`linea`, con la sonda del Excel), runner (`linea` en `errorBatch`, el canal, `whereAvisos`),
`getErrors` (`fila`, `filaEsDelArchivo`, `reciente`), DTO y controller.
Paso 5 (BE): `revertirAcciones` (§5.7) y su spec. Commit 1.
Paso 6 (BE): A6 en `casos-cedente.processor.ts` con sus tests. Commit 2.
Paso 7 (BE): suite completa + **`npm run build`**.
En paralelo, FE: tipos (copia textual de §4) → `resumenCategoria.ts` y sus tests → `ResumenDeCarga` en Resultado y
detalle → `ErroresDeCarga` y `useUltimosErrores` → Revertir en el Historial → wiki → `npm test`, `tsc`, `npm run build`,
`verificar-ayuda`.

**Archivos a crear:** `frontend/src/utils/resumenCategoria.ts`, `frontend/src/components/import/ResumenDeCarga.tsx`,
`backend/src/modules/imports/imports-revertir.spec.ts`, tests del frontend de §9.2.
**Archivos a modificar:** BE: `schema.prisma` (`importerror.linea`, comentario de `resumen`); `estado-carga.types.ts`
(`ResumenCategoria`, `ResumenCarga.categoria`, `EstadoCargaDto.resumenCategoria`); `estado-carga.ts` (lo lee);
`progreso-tracker.ts` (canal y mezcla al cerrar); `processor.interface.ts` (`resumen`); los once processors (una
llamada; contadores nuevos solo los de §5.2; A6 en `casos-cedente`); `recorrer-filas.ts` (`linea`, comentarios);
`errores-carga.ts` (`numeroDeFila` con línea); `historial.types.ts` (`filaEsDelArchivo`); `dtos/import.dto.ts`
(`reciente`); `imports.controller.ts` (pasa `reciente`); `imports.service.ts` (canal, `linea`, `whereAvisos`,
`getErrors`, `revertirAcciones`). FE: `types/importProgreso.ts`, `types/importHistorial.ts`, `ImportSummary.tsx`,
`ImportDetail.tsx`, `ErroresDeCarga.tsx`, `useUltimosErrores.ts`, `api/imports.ts`, `estadoCarga.ts`
(`esAvisoDeCarga` con `/i`), `ImportHistory.tsx` (`handleRevertirConfirmado`); wiki `03-importacion/{05,06,07,08,09}`.
**Cambios de schema:** `importerror.linea Int?` (aditivo, `db push` sin `--accept-data-loss`, sin backfill). Sin
modelos nuevos. `import_progreso.resumen` gana la clave `categoria` (JSON, sin schema).
**Tests a escribir:** §9.1 y §9.2. El indispensable: "misma secuencia de llamadas a Prisma con y sin el canal" para los
once processors.
**Páginas de la wiki a tocar:** `docs/ayuda/03-importacion/05-importar-un-archivo.md`, `06-actualizaciones.md`,
`07-acciones-masivas.md`, `08-historial-y-problemas.md`, `09-multirregistro-y-multiarchivo.md`.
**Skills a consultar:** nestjs-module, prisma-migration, react-component, amsa-general.
**Riesgos durante la implementación:**
- Agregar un `await`, una consulta o mover un `reset()` en un processor al informar: lo frena la prueba de §8.1; correrla
  después de cada processor.
- `imports.service.ts` tiene ~5.500 líneas y en C1 un reemplazo mal anclado borró 2.000: anclas únicas, copia antes
  de cada edición grande, y `git diff --stat` al final (no debería pasar de unas 150 líneas en ese archivo).
- Jest no chequea tipos: `npm run build` antes de dar por terminado (así cayó el deploy de C2a).
- La línea de Excel: si la sonda no la confirma, `null`; no adivinar.
- No usar `git stash`, no correr `npm run lint`/`eslint --fix` global, `LOG_DIR` al scratchpad si se levanta la app.
**Criterios de aceptación:** CA-1 a CA-10 de §11.

---

## 17. C3b: diseño ejecutable

> Architect, 14/10/2026, sobre HEAD `8e8c49b` (árbol limpio; C3a desplegándose). Las referencias `archivo:línea` son
> contra ese commit. Reemplaza el esbozo de §13.1. Qué se ejecutó y qué es suposición: §17.13.

**La idea en cinco líneas.** (1) Cada caso de una acción masiva se escribe **en una transacción con sus snapshots**:
medido, es **más rápido** que hoy (§17.1), y deja lo aplicado siempre revertible, también tras un `kill -9`.
(2) Una ACCIONES en curso **se puede cancelar**, como cualquier carga: corta entre filas.
(3) **Revertir pasa a ser un job** (cola propia), con su estado en una tabla nueva, `reversion_accion`, y cada snapshot
marcado al revertirse (`revertidoEn`). Así el estado sobrevive al reinicio, se puede retomar desde donde quedó y no hay
dos a la vez. (4) Revertir **acepta una cortada, una fallida o una con el post-proceso incompleto** si sus snapshots son
por caso, y antes de confirmar dice cuántos casos cubre. (5) Un `db push` aditivo: tabla nueva y tres columnas nuevas.

### 17.1 La medición: snapshots en la transacción del caso, no por lote

**Qué se midió.** Script `bench.ts` en el scratchpad de la sesión (no está en el repo), contra el MySQL 8.0.46 de
`~/infra` (`innodb_flush_log_at_trx_commit=1`, `sync_binlog=1`, binlog prendido: el mismo perfil de durabilidad que el
RDS de prod). Cada variante corrió sobre una cartera propia: una empresa `BENCH C3b …`, una remesa de origen con N casos
en SIT-001 y un teléfono por caso. La acción masiva hacía, en cada caso, SET_SITUACION + ADD_COMENTARIO + DELETE_CONTACTO,
la combinación más pesada del arnés de §8.2, con «saltear canceladas» prendido. Al final se borró todo lo creado,
en el orden de las FKs, y la base quedó como estaba (§17.13).

| Variante | Qué hace | ms por caso (N=10.000) | 50.000 casos (extrapolado) |
|---|---|---|---|
| **A — hoy** | `AccionesProcessor` real; snapshots en memoria, `createMany` de a 500 en el `afterAll` (`acciones.processor.ts:301-317`) | **12,04** | **~602 s (10,0 min)** |
| **C — por lote** | El processor real más un gancho que vuelca los snapshots de memoria cada 1.000 filas, antes de `tracker.lote` | 12,15 | ~608 s (10,1 min) |
| **B1 — en la transacción, un INSERT por snapshot** | Cada caso, una transacción interactiva: el comentario y su snapshot, los contactos y sus snapshots, el update y su snapshot | 8,91 | ~446 s (7,4 min) |
| **B2 — en la transacción, un `createMany` por caso** | Igual que B1, pero los snapshots del caso van en un solo `createMany` al final de la transacción | **7,42** | **~371 s (6,2 min), un 38 % menos que hoy** |

Los cuatro dejaron lo mismo en la base: 3 snapshots, 1 comentario, 0 contactos y SIT-002 por caso.

**Por qué B es más rápido que hoy.** Hoy cada escritura es su propio commit: `comentario.create`, `contacto.deleteMany`
y `deudor.update` (`acciones.processor.ts:271`, `:74`, `:294`). Son tres `fsync` por caso, y con esta durabilidad el
`fsync` es lo que cuesta, no el round-trip. B junta las tres en un commit. C no gana nada, porque tiene los mismos tres
commits más el volcado. Con 1.000 casos (la primera corrida, de humo) dio igual: A 12,25 ms, C 12,16, B1 8,91 y B2 7,24
ms por caso. Entre 1.000 y 10.000 casos el costo por caso de A no cambió (12,25 contra 12,04 ms): es lineal, y por
eso los 50.000 se extrapolan multiplicando.

**En prod.** El RDS suma la red de la EC2 (~0,3-1 ms por round-trip contra ~0,05 ms en local). B tiene dos round-trips
más por caso que A (`BEGIN` y `COMMIT`), pero dos commits menos, y en un RDS el commit con `fsync` (EBS, con Multi-AZ
si lo hubiera) cuesta más que un round-trip. La conclusión no se invierte. Si en prod resultara al revés, el peor caso
acotado es 2 round-trips × 50.000 = 100 s más en una carga de minutos. La línea `Filas remesa=… filas/s` del runner lo
mide en la primera acción masiva real.

**Decisión: B2.** No es por velocidad, aunque también gana en eso. Es por lo que garantiza:
- con B, cada cambio que quedó en la base tiene su snapshot. Vale para un corte entre filas, un `kill -9`, un deploy o
  un deadlock que deshace el caso;
- con C, un proceso muerto deja hasta 1.000 filas aplicadas sin datos para revertir, y no hay forma de saber cuáles;
- para que C fuera exacto, el corte tendría que volcar antes de tirar. Eso cubre la cancelación, pero no la muerte del
  proceso, que es justo el caso de C3c y del reaper.

### 17.2 Partición: una entrega, dos commits de backend

C3b1 sería «la acción masiva por caso + cancelar» y C3b2 «revertir como job». Se hacen como **dos commits** en la
misma entrega, con una auditoría que los recorre en ese orden, y no como dos despliegues. Las razones:
- cancelar una ACCIONES solo es seguro de ofrecer si Revertir acepta la cortada;
- hacer que el Revertir sincrónico de C3a acepte cortadas es trabajo que C3b2 tira;
- el riesgo de datos está entero en C3b1: es el orden de escritura de un processor destructivo, y lo cubre el control
  de §17.9. C3b2 es un flujo nuevo encima de eso, y no se vuelve más seguro por salir después.

El frontend arranca a la vez, contra el contrato de §17.4.

### 17.3 Datos (`schema.prisma`, un `db push` aditivo)

```prisma
model accion_masiva_snapshot {            // :550-564, se agregan dos campos
  ...
  /// Caso al que pertenece el cambio (C3b). Null en los snapshots anteriores a C3b.
  deudorId     Int?
  /// Cuándo lo deshizo una reversión (C3b). Null = pendiente. Es la marca de idempotencia de revertir.
  revertidoEn  DateTime?
}

model remesa {                            // :399-450, se agregan un campo y una relación
  ...
  /// La acción masiva escribió cada caso junto con sus snapshots (C3b): lo aplicado está cubierto entero,
  /// aunque la carga se haya cortado. false = anterior a C3b (los snapshots se guardaban al final).
  accionSnapshotsPorCaso Boolean @default(false)
  reversion            reversion_accion?
}

/// Estado de la reversión de una acción masiva (C3b). Una fila por remesa; un nuevo intento la reusa.
model reversion_accion {
  remesaId             Int       @id
  estado               String    @db.VarChar(20) // EN_COLA | REVIRTIENDO | TERMINADA | FALLIDA | INTERRUMPIDA
  usuarioId            Int?
  jobId                String?   @db.VarChar(64)
  intentos             Int       @default(0)
  total                Int       @default(0)   // snapshots a revertir: los ya revertidos + los pendientes al arrancar
  hechos               Int       @default(0)
  deudoresRevertidos   Int       @default(0)
  contactosRestaurados Int       @default(0)
  comentariosBorrados  Int       @default(0)
  casosQueNoExistian   Int       @default(0)
  contactosSinCaso     Int       @default(0)
  error                String?   @db.Text
  encoladaAt           DateTime  @default(now())
  startedAt            DateTime?
  heartbeatAt          DateTime?
  finishedAt           DateTime?
  remesa remesa @relation(fields: [remesaId], references: [id], onDelete: Cascade, map: "ReversionAccion_remesaId_fkey")
}
```

- **Por qué así.** `reversion_accion` imita a `import_progreso`: `remesaId` como `@id`, el estado en un
  `String @db.VarChar(20)` y la FK en cascada con `map` PascalCase.
  - Es tabla aparte y no columnas en `remesa`: la reversión tiene su propio ciclo de vida y sus contadores, y `remesa`
    es la tabla caliente del historial.
  - El estado no es un `enum`: agregar un valor después sería un `ALTER` del `enum`, y `fase` ya usa este patrón.
- **El `db push`.** Una tabla nueva, tres columnas nulas o con default, una FK nueva. Nada borra ni estrecha:
  **entra sin `--accept-data-loss`** y sin backfill.
  - Los snapshots anteriores quedan con `deudorId` null; §17.5.4 los resuelve con un `JOIN`.
  - Las remesas anteriores quedan con `accionSnapshotsPorCaso=false`, que es lo correcto: sus snapshots son de los de
    antes.
- **Sin índice nuevo.** Revertir recorre los snapshots con keyset (`id < cursor`) sobre `@@index([remesaId])`, que en
  InnoDB ya trae el `id`.
- **`remesa.accionRevertidaEn` se queda.** Sigue siendo la marca de «revertida» para el historial, las pestañas viejas y
  el texto de Eliminar. La escribe el job al terminar.
- **Verificación después del deploy:** `migrate diff` vacío (receta `db-push-deploy-falla-parcial`) y `SHOW CREATE
  TABLE reversion_accion`.

### 17.4 Contratos (textuales: el frontend los copia)

```ts
// backend/src/modules/imports/reversion/reversion-accion.types.ts  →  frontend/src/types/reversionAccion.ts
export type EstadoReversion = 'EN_COLA' | 'REVIRTIENDO' | 'TERMINADA' | 'FALLIDA' | 'INTERRUMPIDA';

/** Lo que viaja en el historial (`ImportHistoryItem.reversion`) y en los dos eventos de socket. */
export interface ReversionResumenDto {
    remesaId: number;
    empresaId: number;
    estado: EstadoReversion;
    total: number;              // snapshots a revertir (ya revertidos + pendientes al arrancar el intento)
    hechos: number;
    porcentaje: number;         // floor(hechos*100/total); 100 con total 0 y TERMINADA
    deudoresRevertidos: number; // cambios de caso deshechos (como hoy: un caso con dos cambios cuenta dos)
    contactosRestaurados: number;
    comentariosBorrados: number;
    casosQueNoExistian: number; // cambios sobre casos que ya no existen: no se pudo restaurar nada
    contactosSinCaso: number;   // contactos que no se restauraron porque su caso ya no existe
    usuarioId: number | null;
    error: string | null;       // FALLIDA o INTERRUMPIDA: el motivo, legible
    encoladaAt: string;
    startedAt: string | null;
    finishedAt: string | null;
}

export type CodigoNoRevertible =
    | 'YA_REVERTIDA'            // ya hay una reversión TERMINADA (o accionRevertidaEn)
    | 'REVERSION_EN_CURSO'      // hay una EN_COLA o REVIRTIENDO
    | 'REVERTIR_CARGA_EN_CURSO' // la acción masiva todavía corre (o está en cola)
    | 'REVERTIR_NO_TERMINO'     // anterior a C3b y no FINALIZADA (C3a)
    | 'REVERTIR_INCOMPLETO'     // anterior a C3b y con errorPostProceso (C3a)
    | 'REVERTIR_NADA';          // no quedó ningún cambio pendiente de revertir

export interface CoberturaReversion {
    exacta: boolean;            // true: los snapshots cubren todo lo que la carga aplicó
    casos: number;              // casos distintos con algo pendiente de revertir
    cambiosDeCaso: number;      // snapshots pendientes por tipo
    contactos: number;
    comentarios: number;
    yaRevertidos: number;       // snapshots ya revertidos por un intento anterior (retomar)
    casosAfectadosInformados: number | null; // resumen.categoria.deudoresAfectados de C3a, si lo hay
    cargaCortada: boolean;      // la acción masiva terminó FALLIDA (cancelada, fallida o cerrada por el reaper)
    filasProcesadas: number | null;          // import_progreso.procesadas
    totalFilas: number | null;               // import_progreso.totalEsperado
}

export interface ReversionAccionDto {
    remesaId: number;
    revertible: boolean;
    motivo: { code: CodigoNoRevertible; texto: string } | null; // null ⟺ revertible
    cobertura: CoberturaReversion;
    reversion: ReversionResumenDto | null;                      // null: nunca se pidió
    accionRevertidaEn: string | null;
}
```

| Método y ruta (bajo `/api`) | Permiso | Entrada | Respuesta | Errores |
|---|---|---|---|---|
| `GET /import/remesas/:id/reversion` (nuevo) | `deudores.acciones_masivas` | — | 200 `ReversionAccionDto` | 404 remesa; 400 no es ACCIONES |
| `POST /import/remesas/:id/reversion` (nuevo) | `deudores.acciones_masivas` | sin body | **202** `ReversionAccionDto` con `reversion.estado='EN_COLA'`; **200** con `reversion.estado='TERMINADA'` si ya estaba revertida (idempotente) | 404; 400; 409 con `code` = cualquiera de `CodigoNoRevertible` salvo `YA_REVERTIDA`, con el `texto` de §17.8; 503 `REVERSION_NO_ENCOLADA` si Redis no aceptó el job |
| `POST /import/remesas/:id/revertir-acciones` (existe, `imports.controller.ts:274-292`) | igual | igual | **igual que hoy**: 200 `{ yaRevertida, deudoresRevertidos, contactosRestaurados, comentariosBorrados }` | Los 409 de hoy, más `REVERTIR_CARGA_EN_CURSO` y `REVERTIR_NADA`. Si en 20 s no terminó, 409 `REVERSION_EN_CURSO` con el texto «La reversión sigue en segundo plano…» (§17.8). Si falló, 409 `REVERSION_FALLIDA` |

- **El endpoint viejo pasa a ser de compatibilidad**, para las pestañas abiertas antes del deploy. Pide lo mismo que el
  nuevo y espera hasta 20 s, mirando la fila cada 500 ms. Ya no revierte en el request.
  - El `@Audit` del endpoint viejo no cambia.
  - El nuevo POST lleva `@Audit({ tipo: DELETE, resumen: res == null ? 'Intentó revertir…' : res.reversion?.estado === 'TERMINADA' ? '… ya estaba revertida' : 'Pidió revertir la acción masiva de la remesa N' })`.
  - El «Revirtió…» real lo escribe el job al terminar, con `auditoria.log`, como hoy hace el service
    (`imports.service.ts:2224-2230`).
  - Se marca `@deprecated`; se borra cuando no quede frontend C3a en uso (deuda anotada).
- **`GET /import/history` (el historial)**: cada ítem gana `reversion: ReversionResumenDto | null`, junto a
  `accionRevertidaEn` (`imports.service.ts:4549`). Es `null` si nunca se pidió y en las categorías que no son ACCIONES.
  Va con un `include: { reversion: true }` en la consulta del listado.
- **Socket `/rt`**: dos eventos con payload `ReversionResumenDto`, a `user:{usuarioId}` (quien la pidió) y
  `admin:importaciones`, con el mismo patrón que `emitEstadoCarga` (`realtime.service.ts:37-46`).
  - `accion:revertir:progreso`: después de cada tanda, como mucho uno por segundo.
  - `accion:revertir:terminada`: siempre, al cerrar como TERMINADA, FALLIDA o INTERRUMPIDA.
- **Campanita**: al cerrar, una notificación al que la pidió, con `entidadTipo: 'REMESA'` y `entidadId: remesaId`.
  - TERMINADA: `tipo: 'IMPORTACION_FINALIZADA'`, título «Acción masiva revertida».
  - FALLIDA o INTERRUMPIDA: `tipo: 'IMPORTACION_ERROR'`, título «La reversión no terminó».
  - `payload: { reversion: ReversionResumenDto }`, **sin** `resultado`, `err` ni `procesadas`, así
    `accionesDeNotificacion` (`frontend/src/utils/campanita.ts:41-56`) no ofrece Descargar ni Retomar.
  - Sin valor nuevo en el `enum TipoNotificacion` (`schema.prisma:763`).
- **`EstadoCargaDto.cancelable`** de una ACCIONES en curso pasa a seguir la regla general (§17.6). No hay campo nuevo.

### 17.5 Lógica crítica — backend

#### 17.5.1 El processor escribe cada caso con sus snapshots (commit C3b1)

`acciones.processor.ts`, sin cambiar qué operaciones aplica ni en qué orden:

```
procesarFila(row, ctx):                                  // :158
  si !this.marcada:                                      // una vez por carga, ANTES de la primera escritura
      prisma.remesa.update({ id: ctx.remesaId }, { accionSnapshotsPorCaso: true }); this.marcada = true
  modo CONTACTO: conCaso(ctx, db => eliminarContactos(where, db, snaps))      // una transacción por fila
  modo DEUDOR:   deudores = findMany(...)   (FUERA de la transacción, como hoy :194)
                 por cada d no salteado:  conCaso(ctx, db => aplicarOperaciones(d, row, cfg, db, snaps))

conCaso(ctx, fn):                                        // nuevo, privado
  delta = contadores en cero ; snaps = []
  intento 1..2:
    try:
      ctx.prisma.$transaction(async tx => {
          await fn(tx)                                   // comentario.create, contacto.findMany/deleteMany, deudor.update: con `tx`
          if snaps.length: tx.accion_masiva_snapshot.createMany({ data: snaps (con deudorId) })
      }, { maxWait: 10_000, timeout: 30_000 })
      sumar delta a los contadores de la instancia (deudoresAfectados, comentariosCreados, contactosEliminados)
      return
    catch e:
      si e.code == 'P2034' (deadlock / conflicto de escritura) y es el intento 1: warn y reintentar con delta y snaps en cero
      si no: throw e      // el runner la cuenta como error de fila; el caso quedó SIN tocar (rollback)
```

- **Los contadores se suman después del commit.** Hoy suben a medida que se escribe (`:75`, `:276`, `:298`). Con la
  transacción, un caso que hace rollback no puede contar.
- **Las lecturas siguen afuera:** `findMany` de deudores, `idsSituacionCancelada` y `resolveParametroId` (con su
  caché). Es lo que se midió en B2. El `datosPrevios` sale de esa lectura, como hoy (§17.10, carrera preexistente).
- **El orden de los snapshots de un caso no cambia:** comentario, contactos, update, el mismo orden que hoy en el
  arreglo. Revertir los recorre por `id` descendente. Si un mismo caso aparece en dos filas, su segundo snapshot
  tiene `id` mayor y se deshace primero, como hoy.
- **`afterAll`** (`:301-349`):
  - ya no vuelca ni abre la subfase `GUARDANDO_DATOS_PARA_REVERTIR`. La constante queda, para el texto de las cargas
    viejas;
  - el `auditoria.log` va en `try/catch` con `warn`. Una ACCIONES de C3b no puede terminar con `errorPostProceso`
    por la auditoría, y así el texto de `estadoCarga.ts:289` («quedaron sin guardar los datos…») sigue siendo cierto:
    solo lo ven las cargas anteriores;
  - el log, `informarResumen` y `reset` quedan como están.
- **La marca `accionSnapshotsPorCaso` va antes de cualquier escritura.** Una carga que muere antes de marcarse no
  aplicó nada. Una retomada se vuelve a marcar, y el `update` es idempotente.

#### 17.5.2 Cancelar una ACCIONES en curso (commit C3b1)

- Se borra el rechazo de `imports.service.ts:3028-3031` y el mensaje `MSG_CANCELAR_ACCIONES` (`:190-191`).
- En `esCancelable` (`progreso/estado-carga.ts:165-171`), la última línea pasa a `return true`. Se actualiza el
  comentario de `:164`.
- No hace falta nada más: ACCIONES no tiene `processBatch`, así que el runner ya corta **entre filas**
  (`imports.service.ts:3790-3794`). Cada fila es una o varias transacciones cerradas, y el contador queda exacto.
- Un pedido que llega con una transacción en vuelo espera a que ese caso termine.
- Lo demás es lo de C1:
  - el corte antes del cierre (`:4089-4092`) evita el `afterAll`;
  - `cerrarCargaCancelada` deja la remesa FALLIDA con `resultado=CANCELADA`;
  - se puede retomar solo si no se entregó ninguna fila.

#### 17.5.3 Pedir una reversión (commit C3b2)

Va en `ReversionAccionesService.solicitar(remesaId, usuarioId)`, un archivo nuevo
(`imports/reversion/reversion-acciones.service.ts`). La lógica de `revertirAcciones`
(`imports.service.ts:2139-2242`) se muda ahí y el `Set` de `:231` se borra.

```
log intent
$transaction (TX_C1):
   SELECT … FROM remesa r LEFT JOIN import_progreso p … LEFT JOIN reversion_accion v … WHERE r.id=? FOR UPDATE OF r
   404 / 400 como hoy
   pendientes = COUNT snapshots (remesaId, revertidoEn IS NULL)
   motivo = evaluarReversion(r, p, v, pendientes)          // pura, §17.5.5; misma función que el GET
   motivo == YA_REVERTIDA → return { yaEstaba: true }
   motivo != null        → 409 { code, message: texto }    (warn)
   intentos = (v?.intentos ?? 0) + 1 ; jobId = `revertir-${remesaId}-${intentos}`
   upsert reversion_accion: estado EN_COLA, usuarioId, jobId, intentos, error null, encoladaAt now, finishedAt null
       (hechos y los contadores NO se ponen en cero: un nuevo intento sigue sumando)
fuera de la transacción:
   try queue.add('revertir', { remesaId, usuarioId, _ctx }, { jobId, removeOnComplete: 100, removeOnFail: 100 })
   catch → updateMany(estado EN_COLA, jobId) → FALLIDA, error "No se pudo encolar…"; 503 REVERSION_NO_ENCOLADA
emitir accion:revertir:progreso ; log done
```

- **La exclusión mutua es la fila de `remesa` bloqueada más el estado en la base**, no la memoria del proceso.
  - Dos clics: el segundo espera el lock y ve EN_COLA, así que recibe 409 `REVERSION_EN_CURSO`.
  - Un reintento después de un 504 también.
  - Dos instancias, también.
- **El `jobId` es único por intento.** BullMQ ignora sin avisar un `add` con un `jobId` que ya está en `completed` o
  `failed`.

#### 17.5.4 El job (commit C3b2)

Cola `acciones-revertir-queue`, registrada en `imports.module.ts` con `defaultJobOptions: { attempts: 1 }`. El worker es
`bullmq/reversion-acciones.processor.ts`.
- Opciones: `concurrency: 1`, `lockDuration: 120_000`, `stalledInterval: 30_000`, `maxStalledCount: 0`; las mismas
  razones que `OPCIONES_WORKER_IMPORT` (`bullmq/imports.processor.ts:15-23`).
- El `_ctx` lleva el `requestId`.
- **Es una cola propia y no `import-queue`.** La de imports es FIFO y de a una: una reversión quedaría detrás de una
  carga de 20 minutos. Además, sus jobs entran en la «posición en la cola» y en el reaper de C1, que suponen que cada
  job es una carga con `import_progreso`.

```
ejecutar(remesaId, jobId):
  t0 ; log intent
  claim = updateMany reversion_accion WHERE remesaId AND estado='EN_COLA' AND jobId=?
              SET estado='REVIRTIENDO', startedAt=COALESCE(startedAt, now), heartbeatAt=now
  claim.count == 0 → warn "la reversión ya no estaba en cola" ; return          (lo cerró el reaper o es un job viejo)
  pendientes = COUNT(remesaId, revertidoEn IS NULL) ; update total = hechos + pendientes
  cursor = +∞
  loop:
     tanda = findMany { remesaId, revertidoEn: null, id < cursor } orderBy id desc take 200
     vacía → break
     $transaction(async tx => {
        m = tx.accion_masiva_snapshot.updateMany({ id in tanda, revertidoEn: null } → revertidoEn = now)
        m.count != tanda.length → throw ReversionConcurrenteError        // rollback: alguien más la está revirtiendo
        por cada s (desc):
           deudor/UPDATE   → r = tx.deudor.updateMany({ id: s.entidadId }, data(dp))   // updateMany: 0 filas = no existe, sin tirar
                             r.count==0 ? casosQueNoExistian++ : deudoresRevertidos++
           contacto/DELETE → acumular
           comentario/INSERT → acumular id
        vivos = tx.deudor.findMany({ id in deudorIds de los contactos }, select id)
        contactosSinCaso += los que no están en vivos
        r = tx.contacto.createMany({ los de casos vivos, skipDuplicates: true })   // unique (deudorId,tipo,valor)
        tx.comentario.deleteMany({ id in ids })
        tx.reversion_accion.update({ hechos += tanda.length, contadores += …, heartbeatAt: now })
     }, { maxWait: 10_000, timeout: 60_000 })
     cursor = último id ; emitir progreso (throttle 1 s)
  cierre: $transaction:
     reversion_accion.update(estado TERMINADA, finishedAt now)
     remesa.updateMany({ id, accionRevertidaEn: null } → accionRevertidaEn now, accionRevertidaPorId usuarioId)
  auditoría "Revirtió acción masiva (remesa N)" con los números ; notificación ; accion:revertir:terminada
  log done con números y ms
catch e:
  updateMany(remesaId, estado REVIRTIENDO, jobId) → FALLIDA, error motivoLegible(e), finishedAt now
  emitir terminada ; notificación ; log error con stack ; throw e          (regla de workers: re-lanzar)
```

- **La idempotencia está en la base.** Cada snapshot se marca en la misma transacción en la que se deshace.
  - Si el worker muere a mitad de una tanda, esa tanda hizo rollback entera.
  - Lo ya revertido tiene `revertidoEn` y no se vuelve a tocar.
  - Reintentar sigue exactamente desde ahí.
- **Una sola tanda a la vez.** El `updateMany` condicional al principio de la transacción toma los locks de esas filas.
  Una segunda reversión simultánea (que el lock de §17.5.3 ya no debería dejar pasar) espera, ve `count != n`, hace
  rollback y falla sin tocar nada.
- **Contactos de casos borrados.** Hoy `createMany` sin filtrar tira por la FK y deja la reversión a medias
  (`imports.service.ts:2207-2211`). Ahora se filtran, se cuentan y se informan.
- **El orden se respeta.** Las tandas van por `id` descendente, y adentro también.
- **Volumen.** 50.000 casos con 3 snapshots son 150.000 snapshots: 750 tandas de 200.
  - Cada tanda hace hasta 200 `updateMany` de deudor, más `createMany`, `deleteMany` y dos `update`, en un solo commit.
  - Se estima del orden de 0,5 s por tanda en local, y la reversión se mide en §17.11.3.
  - Cada tanda deja 200 casos bloqueados como mucho unos cientos de ms.

#### 17.5.5 `evaluarReversion` (pura, en `reversion-accion.types.ts` o al lado; la usan el GET y el POST)

Va en orden y devuelve el primer motivo que aplica:
1. `v?.estado === 'TERMINADA' || r.accionRevertidaEn` → `YA_REVERTIDA`.
2. `v?.estado` es EN_COLA o REVIRTIENDO → `REVERSION_EN_CURSO`.
3. Carga en curso: `p && p.encoladaAt != null && p.finishedAt == null`, o `estadoProceso` en PENDIENTE, VALIDANDO o
   PROCESANDO con `p.encoladaAt`. → `REVERTIR_CARGA_EN_CURSO`.
4. `!r.accionSnapshotsPorCaso` (anterior a C3b):
   - `estadoProceso !== 'FINALIZADA'` → `REVERTIR_NO_TERMINO`;
   - `p?.errorPostProceso != null` → `REVERTIR_INCOMPLETO`. Son los de C3a, sin cambios: D5 de §17.12.
5. `pendientes === 0`:
   - sin ninguna hecha → `REVERTIR_NADA`;
   - con todas hechas pero sin la marca final (murió entre la última tanda y el cierre) → revertible. El job no
     encuentra tandas y solo cierra.
6. Si no aplica ninguno → `null` (revertible).

`cobertura`, en el GET:
- `exacta = r.accionSnapshotsPorCaso || (estadoProceso === 'FINALIZADA' && !p?.errorPostProceso)`.
- Los pendientes por tipo y los ya revertidos, con un `groupBy`.
- `casos` es un `COUNT(DISTINCT …)` crudo que entiende los snapshots viejos sin `deudorId`:

```sql
SELECT COUNT(DISTINCT COALESCE(s.deudorId,
         CASE s.entidad WHEN 'deudor' THEN s.entidadId
                        WHEN 'contacto' THEN CAST(JSON_UNQUOTE(JSON_EXTRACT(s.datosPrevios,'$.deudorId')) AS UNSIGNED)
                        WHEN 'comentario' THEN c.deudorId END)) AS casos
FROM accion_masiva_snapshot s
LEFT JOIN comentario c ON s.entidad = 'comentario' AND c.id = s.entidadId
WHERE s.remesaId = ? AND s.revertidoEn IS NULL
```

El GET no va en el listado del historial: se pide al abrir el diálogo.

#### 17.5.6 Una reversión en curso y el reinicio del backend (commit C3b2)

**No se reanuda sola** (D4). Con `maxStalledCount: 0`, al levantar el proceso nuevo BullMQ da el job por fallado sin
volver a correrlo.

Un cron nuevo, `revisarReversionesColgadas()`, cada minuto. Va en `reaper-cargas.scheduler.ts`, con un método nuevo
que llama al servicio, y lo apaga el mismo `IMPORTS_REAPER_DESACTIVADO`:
- **REVIRTIENDO con `heartbeatAt` de hace más de 3 min** → INTERRUMPIDA, con «Se interrumpió por un reinicio del
  servidor o una falla: se revirtieron H de T. Revertir de nuevo sigue desde ahí.».
  - Es un `updateMany` condicionado a `estado` y `heartbeatAt`, para no pisar una que acaba de latir.
  - Se emite `terminada` y se notifica.
- **EN_COLA de hace más de 3 min** cuyo job, según `queue.getJob(jobId)`, no existe o está `failed` o `completed` →
  INTERRUMPIDA, con «No llegó a empezar».
  - Una que espera detrás de otra reversión (`waiting`) no se toca.

Se retoma con Revertir: el POST acepta FALLIDA e INTERRUMPIDA, y el job sigue con los pendientes.

**Ventana:** entre el reinicio y la marca INTERRUMPIDA pasan hasta ~4 min, y en ese rato la pantalla dice
«Revirtiendo». C3c puede acortarla: corta entre tandas al recibir `SIGTERM` y marca INTERRUMPIDA en el acto.

#### 17.5.7 Eliminar una remesa con la reversión en curso

`deleteRemesa` (`imports.service.ts:5314`): si la remesa tiene `reversion_accion` EN_COLA o REVIRTIENDO, devuelve 409
«Se está revirtiendo esta acción masiva: esperá a que termine para eliminarla.». Sin esto, la cascada borra los
snapshots en medio de la reversión.

### 17.6 Frontend

| Dónde | Qué cambia |
|---|---|
| `types/reversionAccion.ts` (nuevo) | Copia textual de §17.4 |
| `types/importHistorial.ts` | `reversion?: ReversionResumenDto \| null` en el ítem (`:33`). Los códigos nuevos en la unión de `:109-111` |
| `api/imports.ts` | `getReversion(id)` y `pedirReversion(id)` (`silencioso: true`, como el POST de C3a) |
| `hooks/useReversionAccion.ts` (nuevo) | GET al abrir. Escucha `accion:revertir:progreso` y `…:terminada` filtrando por `remesaId`, y deja de escuchar al desmontar |
| `hooks/useHistorialImportaciones.ts` | Suma los dos eventos: actualiza `item.reversion` de la fila con ese `remesaId`, sin refetch. Con `terminada` y TERMINADA hace un refetch (trae `accionRevertidaEn`) |
| `utils/reversionAccion.ts` (nuevo, puro) | Textos: el estado, la cobertura (§17.8) y el motivo por código |
| `utils/historialImportaciones.ts:130-137` | Regla del botón (abajo) |
| `components/import/historial/DialogoRevertirAccion.tsx` (nuevo) | Reemplaza al diálogo de `ImportHistory.tsx:347-362`. Muestra la cobertura y, si la hay, la advertencia de cortada. Confirmar hace el POST; con 202 cierra y avisa «Reversión en curso: te avisamos al terminar» |
| `components/import/ReversionEstado.tsx` (nuevo) | Chip y barra: «En cola», «Revirtiendo 40 %», «Revertida», «Reversión interrumpida: H de T», «La reversión falló» con el error. En la fila del historial y en el detalle |
| `pages/ImportHistory.tsx` | `handleRevertirConfirmado` (`:224-245`) y el diálogo pasan a `DialogoRevertirAccion`. **Con un backend viejo** (`item.reversion === undefined`) queda el camino de C3a, sin cambios |
| `pages/ImportDetail.tsx` | `ReversionEstado` y el botón Revertir, con el mismo diálogo, en una ACCIONES terminada |
| `components/import/ImportProgress.tsx` (diálogo de cancelar, `:323-345`) | Si `carga.tipo === 'ACCIONES'` y está procesando: «Lo que ya se aplicó queda aplicado. Después lo podés deshacer con **Revertir** desde el Historial: deshace exactamente lo que alcanzó a hacer.» |
| `utils/estadoCarga.ts` | `CODIGOS_DE_ERROR` (`:797`) suma los códigos nuevos. `motivoNoCancelable` (`:561-563`) **no se toca**: solo explica un `cancelable=false`, que con el backend nuevo ya no llega para ACCIONES, y con el viejo sigue siendo cierto |

**Regla del botón Revertir.** Va en `accionesDeHistorial`, `historialImportaciones.ts:130`.

Con el backend nuevo (`'reversion' in item`), es visible si se dan las tres condiciones:
- tiene el permiso `deudores.acciones_masivas`;
- `categoria === 'ACCIONES'`;
- la carga terminó, FINALIZADA o FALLIDA, y no está en curso.

Está deshabilitado en dos casos:
- revertida (`accionRevertidaEn`, o `reversion.estado === 'TERMINADA'`), con «Ya se revirtió»;
- EN_COLA o REVIRTIENDO, con «Se está revirtiendo».

Con FALLIDA o INTERRUMPIDA está habilitado, con el tooltip «Revertir (sigue desde donde quedó)».

El resto de los motivos (`REVERTIR_NO_TERMINO`, `REVERTIR_INCOMPLETO` y `REVERTIR_NADA`) los dice el diálogo
con el GET. La lista no los calcula, porque necesitaría contar snapshots.

Con el backend viejo, la regla es la de hoy: solo FINALIZADA.

### 17.7 Compatibilidad y orden de deploy

| Combinación | Qué pasa |
|---|---|
| **Backend C3b + pestaña C3a** (abierta antes del deploy) | Revertir usa el endpoint viejo. Encola, y si termina en 20 s responde como hoy. Si no, 409 `REVERSION_EN_CURSO` con «sigue en segundo plano», y C3a muestra el texto de los 409. Cancelar una ACCIONES en curso: el botón aparece habilitado (`cancelable` viene del backend) y funciona, pero el diálogo no tiene el texto de §17.6 |
| **Backend C3b + pestaña C2b o anterior** | Igual con Revertir, salvo que el 409 se ve con el manejo de errores genérico |
| **Frontend C3b + backend C3a** (si el frontend sale primero) | `item.reversion` es `undefined` y queda el camino de C3a. No se rompe nada |
| **Volver atrás el backend** | Las columnas y la tabla quedan. El código viejo: lee `accion_masiva_snapshot` sin las columnas nuevas, así que una reversión con el código viejo vuelve a deshacer también lo ya revertido (idempotente en deudor y comentario; contacto con `skipDuplicates`); `accionSnapshotsPorCaso` no la lee nadie; una ACCIONES cortada con C3b es FALLIDA y el código viejo la rechaza con `REVERTIR_NO_TERMINO`. Sin pasos manuales |

**Orden:** un push con los dos. El workflow del backend, con el `db push`, va **antes** que el del frontend, como en C1
y C3a.

**Antes del deploy**, que lo corra quien orquesta, con la receta `prod-db-query-ssm` y solo lectura:

```sql
SELECT r.estadoProceso, (p.errorPostProceso IS NOT NULL) post, COUNT(*)
FROM remesa r LEFT JOIN import_progreso p ON p.remesaId = r.id
WHERE r.categoria = 'ACCIONES' AND r.accionRevertidaEn IS NULL
GROUP BY 1, 2;
```

Así se sabe cuántas acciones anteriores quedan con el 409 de D5. Además, que no haya una ACCIONES en curso: el deploy
la mataría y quedaría con los snapshots del modo viejo, es decir sin ninguno.

### 17.8 Textos (backend → `motivo.texto` y 409; frontend → `utils/reversionAccion.ts`)

| Código / situación | Texto |
|---|---|
| `REVERSION_EN_CURSO` | «Esta acción ya se está revirtiendo. Mirá el avance en el Historial.» |
| ídem, endpoint viejo a los 20 s | «La reversión sigue en segundo plano. Actualizá el Historial en unos minutos para ver cómo terminó.» |
| `REVERTIR_CARGA_EN_CURSO` | «La acción masiva todavía está corriendo. Cancelala, o esperá a que termine, y después revertila.» |
| `REVERTIR_NO_TERMINO`, `REVERTIR_INCOMPLETO` | Los de C3a (§4.4), sin cambios |
| `REVERTIR_NADA` | «Esta acción masiva no llegó a cambiar ningún caso: no hay nada que revertir.» |
| `REVERSION_FALLIDA` (endpoint viejo) | «La reversión falló: {error}. Revertir de nuevo sigue desde donde quedó.» |
| `REVERSION_NO_ENCOLADA` (503) | «No se pudo poner la reversión en la cola. Probá de nuevo en unos minutos; si se repite, avisá a soporte.» |
| Cobertura, exacta y carga completa | «Se van a deshacer los cambios en **N casos**: X cambios de datos, Y contactos a restaurar y Z comentarios a borrar.» |
| Cobertura, exacta y cortada | Lo anterior, más «La acción se cortó después de procesar F de T filas: Revertir deshace exactamente lo que alcanzó a hacer.» |
| Cobertura con `yaRevertidos > 0` | «Un intento anterior ya revirtió R cambios; ahora se deshacen los que faltan.» |
| Siempre | «Si alguien editó a mano alguno de estos casos después de la acción, esos cambios se pisan.» (el texto de hoy, `ImportHistory.tsx:351-353`) |

### 17.9 El control «estado de la base» (el auditor, contra MySQL local)

Lo que **cambia por diseño**:
- en `accion_masiva_snapshot`: los `id`, el `createdAt`, el momento en que se escribe, y las columnas nuevas
  `deudorId` y `revertidoEn`;
- en `remesa`, la columna `accionSnapshotsPorCaso`;
- en `import_progreso`, la `subfase` del post-proceso.

Lo que tiene que ser **idéntico** se mide con el arnés de §8.2, como en C3a: un worktree en `8e8c49b` contra el árbol
de C3b, partiendo de la misma base con los `AUTO_INCREMENT` repuestos.

**Escenario.** Una cartera de 2.000 casos con:
- 20 documentos repetidos (dos casos por fila);
- 10 casos en SIT-050 y «saltear canceladas» prendido;
- 15 filas sin match;
- 30 casos con dos teléfonos que matchean.

La plantilla hace SET_SITUACION + SET_ADICIONALES + ADD_COMENTARIO + DELETE_CONTACTO. Además, una segunda ACCIONES en
modo CONTACTO.

1. **Después de aplicar las dos.** Se compara:
   - `deudor`, todas las columnas menos `updatedAt`, por `id`: idéntico;
   - `contacto`, por `id`: idéntico;
   - `comentario`, sin `fecha`, por `id`: idéntico;
   - `accion_masiva_snapshot`, como **multiconjunto ordenado** de `(remesaId, entidad, entidadId, accion,
     JSON_EXTRACT normalizado de datosPrevios)`, sin `id`, `createdAt`, `deudorId` ni `revertidoEn`: idéntico;
   - en C3b, además, ningún `deudorId` nulo y `deudorId` coherente con la entidad;
   - `remesa`, sin `updatedAt` ni `accionSnapshotsPorCaso`: idéntico;
   - `import_progreso`, sin los campos de reloj de §8.2 ni `subfase`: idéntico;
   - `transaccion` de `modulo='IMPORT'`, sin fechas: idéntico.
2. **Después de revertir las dos** (base con el endpoint sincrónico; C3b con el job):
   - `deudor`: idéntico, e idéntico también al volcado **anterior a la acción**;
   - `contacto`: los restaurados tienen `id` nuevo en las dos corridas, así que se compara el multiconjunto de
     `(deudorId, tipo, valor, subtipo, prioridad, validado, whatsapp)`, que tiene que ser idéntico al anterior a la
     acción;
   - `comentario`: los de la acción, borrados en las dos;
   - en C3b, todos los snapshots con `revertidoEn` y una `reversion_accion` TERMINADA con los mismos números que
     devolvió la base.

Lo automático, en jest, es el `grabarPrisma` de §8.1. Ahora tiene que entender `$transaction(fn)`: le pasa el mismo
proxy como `tx` y graba `$transaction:begin` y `:end`. Sigue probando que ACCIONES hace la misma secuencia con el
canal y sin él. **No** prueba igualdad con el código anterior: eso es lo de MySQL.

### 17.10 Fallos silenciosos

| Qué puede pasar en silencio | Cómo se nota / qué lo evita |
|---|---|
| Un caso aplicado sin snapshot (muerte a mitad) | No puede: cambio y snapshot van en el mismo commit. Lo prueba el `kill -9` de §17.11.3 |
| Contadores que cuentan un caso que hizo rollback | Se suman después del commit (§17.5.1). Test |
| Una ACCIONES vieja, parcial, «revertida» a medias | `accionSnapshotsPorCaso=false` más FALLIDA o `errorPostProceso` dan el 409 de C3a (D5) |
| Reversión que muere y queda «Revirtiendo» para siempre | El cron la pasa a INTERRUMPIDA en ≤4 min, con H de T, y avisa por la campanita |
| Reversión que se reanuda y duplica contactos | `revertidoEn` en la misma transacción, más `skipDuplicates` sobre la unique `(deudorId,tipo,valor)` |
| Contactos que no se restauran porque su caso ya no existe | Hoy la FK tira la reversión entera. Ahora `contactosSinCaso`, en el resultado y en el log |
| Casos que ya no existen | `casosQueNoExistian`, en el resultado (hoy solo en el log) |
| El segundo clic, o el reintento tras un 504, que revierte dos veces | El lock de la fila más el estado en la base. 409 `REVERSION_EN_CURSO` |
| Revertir mientras la acción todavía corre | 409 `REVERTIR_CARGA_EN_CURSO` |
| Eliminar la remesa durante la reversión (cascada) | 409 (§17.5.7) |
| `datosPrevios` viejo si otro escribe el caso entre la lectura y la transacción | Preexistente, igual que hoy. La ventana es la de un caso, no la de la carga. No se arregla acá |
| Revertir pisa ediciones posteriores | Preexistente y dicho en el diálogo |
| Un job encolado que BullMQ ignora por `jobId` repetido | El `jobId` lleva `intentos`, y el cron pasa a INTERRUMPIDA una EN_COLA sin job |
| La tabla `reversion_accion` sin crear en prod (falla el `db push`) | El POST falla con 500. Verificación posterior al deploy de §17.3 |

### 17.11 Plan de pruebas

#### 17.11.1 Backend (jest más **`npm run build`**: jest no chequea tipos, `isolatedModules`)

**`processors/acciones.processor.spec.ts`** (nuevo o ampliado), con un `prisma` falso que tiene `$transaction(fn)`:
- un caso escribe comentario, contactos, update y **un** `createMany` con 3 snapshots dentro de la misma `$transaction`,
  con `deudorId`;
- **el borde que motiva esto:** la transacción del caso 2 tira, así que el caso 1 queda con sus snapshots, el caso 2
  sin nada, los contadores reflejan solo el 1 y la fila es un error;
- un P2034 se reintenta una vez; un segundo P2034, o cualquier otro error, no se reintenta;
- la marca `accionSnapshotsPorCaso` se escribe una sola vez y antes de la primera escritura, también en modo CONTACTO;
- el `afterAll` no escribe snapshots; si `auditoria.log` tira, no tira;
- un documento repetido en dos filas da dos transacciones y el orden de los snapshots de hoy.

**`progreso/estado-carga.spec.ts`**: `esCancelable('ACCIONES', en curso y arrancada)` es `true`.

**`imports-cancelar*.spec.ts`**: cancelar una ACCIONES PROCESANDO escribe el pedido, sin 409.

**`reversion/reversion-acciones.service.spec.ts`** (nuevo):
- `evaluarReversion`: los seis códigos y el revertible, incluida la de «todas hechas sin la marca final»;
- `solicitar`:
  - el 409 de cada código;
  - devuelve 200 si ya estaba revertida;
  - el `jobId` lleva el intento;
  - un 503 deja la fila FALLIDA;
  - dos `solicitar` simultáneos, con el lock simulado, dan 202 al primero y 409 al segundo;
- `ejecutar`:
  - el orden descendente con dos snapshots del mismo caso;
  - una tanda que tira deja los snapshots sin marcar y la fila FALLIDA;
  - un reintento solo procesa los pendientes y suma los contadores;
  - un `count != n` hace rollback;
  - los contactos de casos borrados terminan en `contactosSinCaso`;
  - con el claim en 0, no hace nada;
  - el cierre escribe `accionRevertidaEn` solo si era null.
- El cron: REVIRTIENDO con latido viejo pasa a INTERRUMPIDA; con latido fresco no; EN_COLA con el job `waiting` no;
  EN_COLA sin job sí.

**`imports-revertir.spec.ts`** (el de C3a): pasa a probar el endpoint de compatibilidad, con la espera de 20 s
simulada: TERMINADA da la forma vieja; un timeout da 409; FALLIDA da 409.

**`bullmq/reversion-acciones.processor.spec.ts`**: las opciones del worker y que relanza.

**`processors/progreso-reportes.spec.ts`**: `grabarPrisma` con `$transaction`, y ACCIONES vuelve a dar la misma
secuencia con el canal y sin él.

#### 17.11.2 Frontend (`npm test` con el arnés de `frontend/tests`, `FE_TEST_PUERTO` si corre a la vez que otro, `npx tsc --noEmit -p tsconfig.json`, `npm run build`, `npm run verificar-ayuda`)

**`tests/unit/reversionAccion.test.ts`**: los textos de §17.8, uno por código y uno por cada tipo de cobertura.

**`tests/unit/historial.test.ts`**: la regla del botón.
- Con el backend nuevo: FINALIZADA, FALLIDA cancelada, REVIRTIENDO deshabilitado, INTERRUMPIDA habilitado y TERMINADA
  deshabilitado.
- Con el backend viejo (`reversion` ausente): solo FINALIZADA.

**`tests/paginas/historial-revertir.test.tsx`** (ampliar):
- el diálogo pide el GET y muestra la cobertura, incluida la línea de cortada;
- el POST da 202, la fila pasa a «Revirtiendo 0 %», el socket `progreso` la pasa a 40 % y `terminada` a «Revertida»,
  con un refetch;
- cada 409 muestra su texto;
- sin respuesta, aparece el texto de C3a;
- **backend viejo:** sin `reversion` en el ítem, se usa el endpoint viejo y su mensaje.

**`tests/paginas/detalle-c3b.test.tsx`** (nuevo): `ReversionEstado` y el botón en el detalle.

**`tests/componentes/cancelar.test.tsx`**: el diálogo de una ACCIONES procesando muestra el texto nuevo.

**`tests/paginas/campanita-contexto.test.tsx`**: una notificación de reversión sin `resultado` no ofrece Descargar ni
Retomar y lleva a la remesa.

#### 17.11.3 Prueba local con volumen (el auditor; MySQL y Redis de `~/infra`, `LOG_DIR` al scratchpad)

1. **Cartera.** Una empresa y una remesa propias con 50.000 casos y un teléfono cada uno: el `preparar` de `bench.ts`
   o el arnés. La plantilla ACCIONES hace SET_SITUACION + ADD_COMENTARIO + DELETE_CONTACTO, y el archivo trae los
   50.000 `nroCliente`.
2. **La carga completa.** Tiene que tardar a lo sumo lo que A en §17.1 (~10 min en local). La línea `Filas remesa=…
   filas/s` lo mide; se anota.
3. **Cancelar a mitad.** Con otra copia de la cartera, se cancela a los ~2 min.
   - Se anota `procesadas` y se cuenta `COUNT(DISTINCT deudorId)` de los snapshots: tiene que ser igual a los casos en
     SIT-002 y a los comentarios creados.
   - Revertir cubre exactamente eso: después, 0 casos en SIT-002, 0 comentarios de la acción y todos los teléfonos.
4. **`kill -9` del backend a mitad de la carga.** El reaper la cierra FALLIDA.
   - Lo mismo que en 3: snapshots, casos cambiados y comentarios coinciden.
   - Revertir deja la cartera como antes.
5. **`kill -9` a mitad de la reversión** (de la carga del paso 2).
   - Al minuto 3 o 4, el cron la pasa a INTERRUMPIDA con H de T. Se pide Revertir de nuevo.
   - Termina con la cartera igual a la de antes de la acción: 0 contactos duplicados
     (`GROUP BY deudorId,tipo,valor HAVING COUNT(*)>1` vacío).
   - `hechos = total`.
6. **Doble clic** en Revertir: el segundo da 409.
7. **Limpieza:** se borra la empresa, en el orden de FKs de `bench.ts`, y se verifican los conteos de antes.

### 17.12 Decisiones para el usuario (si no responde, se sigue con la recomendada)

- **D4. Una reversión que corta un reinicio.**
  - (a) **Recomendada:** no se reanuda sola. Queda «interrumpida» con cuánto hizo, y **Revertir** sigue exactamente
    desde ahí. Es la política de las cargas (una carga nunca se re-ejecuta sola) y el operador ve qué pasó.
  - (b) BullMQ la reanuda sola una vez (`maxStalledCount: 1`). Es más cómodo, pero un proceso que se cae por la
    reversión misma la repite.
- **D5. Acciones masivas anteriores a C3b que quedaron parciales** (FALLIDA o con el post-proceso incompleto).
  - (a) **Recomendada:** siguen con el 409 que manda a soporte (C3a). No hay forma de saber qué les falta, y la
    consulta de §17.7 dice cuántas son; se espera que ninguna.
  - (b) Revertir lo que tengan guardado, diciendo «puede faltar una parte que no se puede deshacer».
- **D6. Qué ve el operador al cancelar una acción masiva en curso.**
  - (a) **Recomendada:** solo se cancela. Lo hecho queda, y Revertir es un paso aparte que antes de confirmar dice
    cuánto cubre.
  - (b) Un botón «Cancelar y deshacer» que encadena las dos cosas. Es más rápido en el apuro, pero deshace sin mostrar
    antes cuánto.

### 17.13 Qué se ejecutó y qué es suposición

**Ejecutado** (local, 14/10/2026), solo contra la base:
- `npx ts-node --transpile-only bench.ts 1000 A,C,B1,B2` y `bench.ts 10000 A,C,B1,B2`, con `NODE_PATH` al
  `node_modules` del backend;
- el script crea la empresa `BENCH C3b <tag>`, dos remesas por variante (origen y acción), N casos y N contactos por
  variante, y al final borra en orden de FKs: comentario, contacto, snapshots, deudor, remesa, empresa;
- después se verificó que no quedaron empresas `BENCH%` ni remesas `bench-%`: 0 empresas `BENCH%`, 0 remesas `bench-%`, 21.338 deudores (los mismos que antes), y los `AUTO_INCREMENT` de `accion_masiva_snapshot`, `comentario`, `contacto`, `deudor`, `empresa` y `remesa` repuestos a los valores leídos antes de empezar (`ALTER TABLE … AUTO_INCREMENT`, verificado con `information_schema` después de `ANALYZE TABLE`).

El backend no se levantó. No se tocó prod.

**Leído** (contra `8e8c49b`):
- backend: `acciones.processor.ts` entero; `imports.service.ts` (`:180-200`, `revertirAcciones` `:2139-2242`, cancelar
  `:2975-3060`, runner `:3655-3670`, `:3740-3900`, `:4080-4260`, historial `:4540-4552`);
  `progreso/estado-carga.ts:140-200`; `bullmq/imports.processor.ts`; `processor-registry.ts`; `imports.module.ts`;
  `reaper-cargas.scheduler.ts`; `realtime.service.ts`; `imports.controller.ts:265-292`; `schema.prisma`
  (`accion_masiva_snapshot`, `remesa`, `import_progreso`, `contacto`, `comentario`, `TipoNotificacion`);
- frontend: `ImportHistory.tsx` (Revertir), `historialImportaciones.ts`, `estadoCarga.ts`, `campanita.ts`,
  `ImportProgress.tsx` (diálogo de cancelar);
- wiki: `07-acciones-masivas.md` y las menciones de `05`/`08`.

**Suposiciones:**
- **Que el orden de costos se mantiene en RDS** (§17.1). La primera acción masiva real lo confirma con
  `Filas remesa=… filas/s`.
- **Que `tx.deudor.updateMany` acepta `Prisma.JsonNull` para `camposAdicionales`**, como `update`. Lo confirma el test.
- **Que el `include` de `reversion` en el listado del historial no lo vuelve lento.** Es una tabla 1:1 por PK.
- **Lo de BullMQ al reiniciar:** con `maxStalledCount: 0`, al reiniciar el job activo pasa a `failed` sin
  re-ejecutarse. Es la política documentada de C1, y no se probó con una reversión.

### 17.14 Documentación

- **Wiki `docs/ayuda/03-importacion/07-acciones-masivas.md`.**
  - «Revertir»: es un proceso en segundo plano con avance; se puede sobre una acción terminada, cancelada o cortada,
    diciendo cuántos casos cubre; si se interrumpe, Revertir sigue desde ahí. La advertencia de «con advertencias»
    queda solo para las acciones anteriores a C3b.
  - «Cancelar una acción masiva»: se puede, lo hecho queda y se revierte aparte.
  - Las preguntas frecuentes de `:193-218`: revertir dos veces sigue siendo no, salvo retomar una interrumpida.
- **`05-importar-un-archivo.md`.**
  - `:525` y `:544`: se borra la excepción de la ACCIONES empezada.
  - `:738`: las acciones aplicadas hasta el corte **se pueden** revertir.
- **`08-historial-y-problemas.md`**: el estado de la reversión en la fila («Revirtiendo 40 %», «Reversión
  interrumpida») y el permiso.
- **`docs/imports-progreso-realtime-spec.md`.**
  - §10.5.3: una nota que remite acá por el 409 (d) quitado.
  - §10.1: la marca de la entrega.
- **CHANGELOG**: entrada «Importaciones, entrega C3b», con el formato de la de C3a.

### 17.15 Criterios de aceptación (C3b)

1. Con la plantilla de §17.11.3 y 50.000 casos en local, la carga termina con 50.000 casos en SIT-002, 50.000
   comentarios, 0 teléfonos y 150.000 snapshots, todos con `deudorId`. Tarda **no más** que la variante A medida en
   §17.1 para el mismo N.
2. El control de §17.9 da idéntico en `deudor`, `contacto`, `comentario` y el multiconjunto de snapshots, después de
   aplicar y después de revertir. La única diferencia es la de las columnas listadas como «cambian por diseño».
3. Una ACCIONES en PROCESANDO se puede cancelar: el botón está habilitado y el POST de cancelar no da 409. Después del
   corte, `COUNT(DISTINCT deudorId)` de sus snapshots es igual a los casos que cambiaron.
4. Revertir sobre esa cancelada, y sobre una cortada con `kill -9`, deja la cartera igual a antes de la acción:
   `deudor` por columnas y `contacto` por multiconjunto.
5. Un `kill -9` a mitad de la reversión deja `reversion_accion` en INTERRUMPIDA en ≤4 min. Revertir de nuevo termina
   con 0 contactos duplicados y `hechos = total`.
6. Dos POST seguidos dan 202 y 409 `REVERSION_EN_CURSO`. Durante la reversión, eliminar la remesa da 409.
7. Una ACCIONES anterior a C3b (`accionSnapshotsPorCaso=false`) FALLIDA da 409 `REVERTIR_NO_TERMINO`, y con
   `errorPostProceso` da 409 `REVERTIR_INCOMPLETO`. Una FINALIZADA limpia se revierte como hoy.
8. El endpoint viejo con una reversión chica responde 200 con la forma de hoy y los mismos números que el job.
9. El frontend con un backend sin C3b (ítems sin `reversion`) se comporta como C3a: tests del arnés.
10. `npm run build` (backend), `npx tsc --noEmit`, `npm run build` (frontend), `npm test` en los dos y
    `npm run verificar-ayuda` pasan. El `db push` local entra sin `--accept-data-loss`.

---

## 18. Lo que cambió en C3b después de la auditoría (14/10/2026)

Cómo se trabajó:
- Dos implementers en paralelo: backend en 16 min y frontend en 17.
- Dos auditorías en paralelo:
  - Backend, con la app real y MySQL: 20 min, **PASA CON OBSERVACIONES**.
  - Frontend y wiki contra el código: 25 min, **PASA CON OBSERVACIONES**.
- Los arreglos: los de backend, quien orquesta; los de frontend y wiki, un implementer. Cada arreglo, con su prueba.

Donde §17 y esto se contradicen, vale esto.

**La prueba grande (§17.11.3), ejecutada con la app real.** Se hizo con 20.000 casos, no 50.000, por tiempo:

| Paso | Resultado |
|---|---|
| Carga completa | 127 filas/s, es decir 7,87 ms por caso, contra 12,04 de hoy en el banco de §17.1 |
| Revertirla | ~3.600 snapshots/s |
| Cancelar a mitad | Lo aplicado tiene sus snapshots, y la cobertura da `exacta` |
| `kill -9` durante la carga | Casos con snapshots = casos cambiados = comentarios. El reaper la cerró a los ~4,5 min |
| `kill -9` durante la reversión | El cron la pasó a INTERRUMPIDA a los 3 min 49 s. Retomarla terminó sin duplicar contactos |
| Doble clic | 202 y 409 |
| Eliminar mientras revierte | 409 |

**El control de §17.9** se corrió con un worktree en `8e8c49b` contra C3b, con 2.000 casos, en modo DEUDOR y en modo
CONTACTO.
- Después de aplicar y después de revertir dan idénticos: los casos, los contactos por id, los comentarios y los
  snapshots como multiconjunto.
- Lo único distinto son los `deudorId` de los snapshots, que cambian por diseño.

| Qué | Cómo quedó | Por qué |
|---|---|---|
| **Revertir no restauraba los contactos como estaban** (importante, ya venía de antes) | El snapshot de un contacto borrado guarda también `relacion`. La restauración respeta `prioridad` null, que antes volvía 0, y `relacion`, para que el teléfono de un codeudor siga siendo del codeudor. Los snapshots anteriores, sin `relacion`, vuelven como del titular | Medido: 602 de 3.010 contactos restaurados pasaban de `prioridad` null a 0. El multiconjunto de contactos después de revertir no daba igual al de antes |
| **Una ACCIONES cancelada antes de procesar ninguna fila ofrecía Revertir y mandaba a soporte** (importante) | `evaluarReversion` devuelve `REVERTIR_NADA` si `procesadas === 0` y no hay snapshots, antes del chequeo D5. `solicitar` lee `procesadas`. El frontend no ofrece Revertir en una FALLIDA sin filas | Nunca marcó `accionSnapshotsPorCaso`, porque no escribió nada, y caía en el texto de las anteriores a C3b. Contradecía al Retomar que aparecía al lado |
| **El texto de una ACCIONES cancelada con filas mandaba a soporte** (importante) | `textoCancelacion` tiene un caso ACCIONES: lo aplicado se deshace con Revertir | Contradecía al diálogo de cancelar y al texto de una cortada |
| **El detalle dependía solo del socket** (importante) | Mientras la reversión está viva, el detalle la consulta periódicamente y también al volver a la pestaña o recuperar la red. Sin `deudores.acciones_masivas`, no pide el GET | Los eventos van a `user:{dueño}` y a `admin:importaciones`. Otro usuario veía "Revirtiendo" para siempre |
| Textos duplicados | La notificación de una interrumpida y el 409 `REVERSION_FALLIDA` ya no repiten "Revertir de nuevo…", ni dejan doble punto | — |
| Cobertura de una revertida antes de C3b | En cero, con `yaRevertidos` = todos | C3a no marcaba `revertidoEn` |
| Frontend: varios | El 202 no pisa un estado más nuevo del socket. El detalle relee después del POST, respeta `revertible: false` y dice cuándo ya se revirtió. En celular aparece el tooltip de "sigue desde donde quedó". `pendientePostProceso('ACCIONES')` pasa a un texto neutro, cierto antes y después de C3b | Hallazgos menores de la auditoría de frontend |
| Wiki `05`, `07` y `08` | La pregunta frecuente de cancelar; el texto de una cancelada; el comportamiento del detalle; la ventana de ~4 min después de un reinicio; el 409 de eliminar mientras se revierte | Revisión de la wiki contra el código |

**Deuda conocida:**
- **`deleteRemesa` mira la reversión sin bloquear la fila.** Un borrado y un pedido de revertir que entren en el
  mismo instante podrían dejar una reversión sobre una remesa borrada. Está solo leído.
- **El cierre del job y `solicitar` bloquean `reversion_accion` y `remesa` en orden inverso.** Hay riesgo de deadlock,
  solo con un pedido rechazado que coincida con el cierre. MySQL corta una de las dos transacciones, y la reversión
  queda INTERRUMPIDA y se retoma.
- **No probado:** los 50.000 casos y la medición en RDS.
- **No visto en un navegador:** el chip "Reversión interrumpida: H de T" en la tarjeta a 360 px.

---

## PLAN PARA IMPLEMENTER — Fase C, entrega 3b

**Orden de implementación:**
- Paso 1 (BE): schema (§17.3) + `npx prisma db push` local (sin `--accept-data-loss`; si lo pide, parar) +
  `npx prisma generate`. Tipos de §17.4 en `reversion/reversion-accion.types.ts`. Va primero porque todo compila
  contra eso.
- Paso 2 (BE, commit C3b1): `acciones.processor.ts` (§17.5.1) y su spec; `grabarPrisma` con `$transaction` en
  `progreso-reportes.spec.ts`. Después, cancelar (§17.5.2): `imports.service.ts:3028-3031` y `:190-191`,
  `estado-carga.ts:165-171`, y sus specs. **`npm run build`**. Commit.
- Paso 3 (BE, commit C3b2): `reversion-acciones.service.ts` (`evaluarReversion`, `solicitar`, `ejecutar`, la cobertura
  y el cron), el worker, la cola en `imports.module.ts` y el cron en `reaper-cargas.scheduler.ts`. Después, los
  endpoints en `imports.controller.ts`, el de compatibilidad, `reversion` en el historial, el guard de `deleteRemesa`,
  y los emisores en `realtime.service.ts`. Borrar `revertirAcciones` y el `Set` de `imports.service.ts`. Specs.
  **`npm run build`**. Commit.
- En paralelo (FE y wiki): tipos (copia de §17.4) → `utils/reversionAccion.ts` con sus tests →
  `api` y hooks → `ReversionEstado` y `DialogoRevertirAccion` → Historial (con el camino viejo intacto) → detalle →
  diálogo de cancelar → tests de páginas → wiki → `npm test`, `tsc`, `npm run build`, `verificar-ayuda`.
- Paso final (quien orquesta y el auditor): §17.9 y §17.11.3 contra MySQL local; CHANGELOG; la consulta de §17.7
  antes del deploy.

**Paquete BE** (nada de `frontend/` ni `docs/ayuda/`): `backend/prisma/schema.prisma`;
`processors/acciones.processor.ts` y su spec; `processors/progreso-reportes.spec.ts`; `progreso/estado-carga.ts` y su
spec; `progreso/reaper-cargas.scheduler.ts`; `imports.service.ts` (cancelar, historial, `deleteRemesa`, borrar
`revertirAcciones`); `imports.controller.ts`; `imports.module.ts`; `historial.types.ts`;
`reversion/{reversion-accion.types.ts, reversion-acciones.service.ts, reversion-acciones.service.spec.ts}` (nuevos);
`bullmq/reversion-acciones.processor.ts` y su spec (nuevos); `imports-revertir.spec.ts`; `imports-cancelar*.spec.ts`;
`modules/realtime/realtime.service.ts`.

**Paquete FE** (nada de `backend/`): `frontend/src/types/{reversionAccion.ts (nuevo), importHistorial.ts}`;
`api/imports.ts`; `hooks/{useReversionAccion.ts (nuevo), useHistorialImportaciones.ts}`;
`utils/{reversionAccion.ts (nuevo), historialImportaciones.ts, estadoCarga.ts}`;
`components/import/{ReversionEstado.tsx (nuevo), historial/DialogoRevertirAccion.tsx (nuevo), ImportProgress.tsx}`;
`pages/{ImportHistory.tsx, ImportDetail.tsx}`; tests de §17.11.2; wiki
`docs/ayuda/03-importacion/{05,07,08}`.

**Quien orquesta:** CHANGELOG, `docs/imports-progreso-realtime-spec.md` (§10.1, §10.5.3) y este documento («lo que
cambió al auditar»).

**Archivos a crear:**
- backend: `backend/src/modules/imports/reversion/reversion-accion.types.ts`, `reversion-acciones.service.ts`,
  `reversion-acciones.service.spec.ts`, y `backend/src/modules/imports/bullmq/reversion-acciones.processor.ts` con su
  spec;
- frontend: `frontend/src/types/reversionAccion.ts`, `utils/reversionAccion.ts`, `hooks/useReversionAccion.ts`,
  `components/import/ReversionEstado.tsx`, `components/import/historial/DialogoRevertirAccion.tsx`;
- tests: `frontend/tests/unit/reversionAccion.test.ts`, `frontend/tests/paginas/detalle-c3b.test.tsx`.

**Archivos a modificar:** los de los paquetes, con lo que dicen §17.5 y §17.6.

**Cambios de schema:**
- `accion_masiva_snapshot.deudorId Int?` y `revertidoEn DateTime?`;
- `remesa.accionSnapshotsPorCaso Boolean @default(false)` y la relación `reversion`;
- el modelo nuevo `reversion_accion`.

Es aditivo, sin `--accept-data-loss` y sin backfill.

**Tests a escribir:** §17.11.1 y §17.11.2. El indispensable es «la transacción del caso 2 tira y el caso 1 queda con
sus snapshots y los contadores exactos», seguido de «reintentar una reversión no duplica contactos».

**Páginas de la wiki a tocar:** `docs/ayuda/03-importacion/07-acciones-masivas.md`, `05-importar-un-archivo.md`,
`08-historial-y-problemas.md`.

**Skills a consultar:** prisma-migration, bullmq-worker, nestjs-module, react-component, amsa-general.

**Riesgos durante la implementación:**
- **`imports.service.ts` tiene 5.586 líneas.** Hay que usar anclas únicas y hacer una copia antes de cada edición
  grande. Al terminar, `git diff --stat`: es neto negativo, porque se va `revertirAcciones`.
- **Un `await` fuera de la transacción del caso** (usar `ctx.prisma` en vez de `tx` dentro de `aplicarOperaciones`)
  rompe la garantía sin que ningún test lo note, salvo el del proxy. Dentro de la transacción, solo `db`.
- **El timeout por defecto de las transacciones interactivas de Prisma (5 s)** corta tandas de reversión grandes:
  pasar `timeout` explícito.
- **Jest no chequea tipos:** correr `npm run build` antes de cada commit.
- **No** usar `git stash`. **No** correr `npm run lint` ni `eslint --fix` global. Con la app levantada, `LOG_DIR` al
  scratchpad. El `db push` local no se fuerza con `--accept-data-loss`.

**Criterios de aceptación:** los de §17.15.
