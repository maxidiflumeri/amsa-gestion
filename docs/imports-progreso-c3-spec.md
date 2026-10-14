# Progreso de importaciones — Fase C, entrega 3 (C3)

> **Estado: C3a implementada y auditada el 14/10/2026, sin desplegar; lo que cambió al auditarla, en
> [§16](#16-lo-que-cambió-en-c3a-después-de-la-auditoría-14102026), que manda sobre §2 a §11. C3b y C3c esbozadas (§13).**
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

**Alcance.** (1) **Snapshots por lote**: hoy viven en memoria hasta el `afterAll` (`acciones.processor.ts:29`,
`:280-296`); una ACCIONES que muere a mitad deja cambios aplicados sin forma de deshacerlos, y por eso C1 no la deja
cancelar (`esCancelable`, `progreso/estado-carga.ts:158-164`). Se escriben en la misma transacción que el cambio de
cada caso (comentario + snapshot, update + snapshot, delete + snapshot) o, como mínimo, por lote con un gancho
`alTerminarLote?(ctx)` que el runner llama antes de `tracker.lote`. Se decide en ese diseño con una medición local de
50.000 casos (la transacción por caso cuesta round-trips). (2) **Cancelar una ACCIONES en curso** (quitar el 409 (d) de
§10.5.3), con los snapshots ya persistidos. (3) **Revertir sobre una cortada, fallida o con post-proceso incompleto**,
con lo que cubren los snapshots y diciendo cuántos casos cubre; los 409 de C3a pasan a ofrecer eso. (4) **Revertir como
job** (cola propia o la de imports con otro `name`), con progreso por `/rt` (`accion:revertir:progreso`), idempotente
por estado en la base (no el `Set` de C3a) — probablemente `remesa.accionRevertirEstado` o una tabla `reversion_accion`:
es cambio de schema y se decide ahí.

**Riesgos.** Cambia el orden de escritura de un processor destructivo: el control de §8 ya no es "idéntico" en
`accion_masiva_snapshot` (ids y `createdAt`), sí en deudor/contacto/comentario. Revertir como job cambia un flujo que
"funciona" en cargas chicas. **Dependencias**: C3a. **Estimación**: 1 día.

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
