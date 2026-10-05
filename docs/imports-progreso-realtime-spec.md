# Progreso en tiempo real de las importaciones — diagnóstico y plan

> Estado: **diagnóstico cerrado (30/09/2026) · Fase A diseñada, implementada y auditada (05/10/2026),
> sin desplegar y sin probar en un navegador · fases B, C y D sin empezar.** Para retomar: lo que quedó
> distinto del diseño está en [§8.13](#813-lo-que-cambió-después-de-la-auditoría-05102026) y el guion de
> prueba manual previo al deploy en [§8.14](#814-guion-de-prueba-manual-antes-del-deploy).
> Origen: el usuario reportó cargas que terminan (remesa FINALIZADA) pero cuyo progreso nunca se
> completa en la UI, en la página de progreso y en el panel de notificaciones. Se auditó de punta a
> punta (agente `auditor`, veredicto **NO PASA**). Este documento es el punto de partida para
> implementar: leerlo entero antes de tocar código, y releer [notificaciones-spec.md](notificaciones-spec.md)
> (§ progreso de imports) porque varias cosas que ese spec promete el código no las hace.
>
> **Para implementar la Fase A: ir directo a [§8](#8-diseño-de-la-fase-a).** Las decisiones de §5.1 y
> §5.2 están cerradas. El architect verificó contra el código (HEAD `a0675dc`) cada referencia en la
> que se apoya el diseño; lo que encontró inexacto o nuevo está en [§3.6](#36-correcciones-y-hallazgos-nuevos-del-architect-05102026).

---

## 1. Resumen en una línea

El progreso vive **solo en el socket**. No hay estado persistido del que recuperarse (`jobimport` nunca
se escribe y `remesa.totalFilas` se pisa en cada lote), así que cualquier evento perdido congela la UI
hasta recargar. Encima, el progreso solo se emite cada 1000 filas, el post-proceso (`afterAll`) no
informa nada y traga sus errores, y hay varios casos en que el wizard nunca termina o miente.

---

## 2. Mapa del flujo actual (para orientarse)

| Pieza | Dónde | Qué hace |
|---|---|---|
| Alta de la remesa | `backend/src/modules/imports/imports.service.ts:623` `createRemesa` (`comun` en `:735-747`); `imports.controller.ts:198-204` | Crea la remesa en **PENDIENTE**. El controller **no pasa el usuario**: toda remesa nace con `usuarioCreadorId = null` (por eso los fantasmas figuran como "Sistema") |
| Vista previa | `imports.service.ts:958` `validateRemesa`; update en `:1566-1574` (genérico), `:1081-1084` (MULTIARCHIVO), `:1291-1299` (MULTICLAVES); MULTIRREGISTRO sale por `:1019-1025` sin escribir nada | Pasa a **VALIDANDO**, guarda `okFilas/errFilas` de una **muestra de 50 filas** y `totalFilas` del archivo completo |
| Encolado | `imports.service.ts:1752-1807` `executeRemesa` + `bullmq/imports.processor.ts` | **Vuelve a PENDIENTE** y recién ahí pone `usuarioCreadorId` (`:1782-1788`). Job BullMQ con defaults (`attempts` 1, `maxStalledCount` 1, `lockDuration` 30 s); el worker no declara `concurrency` → 1: las cargas de todos los usuarios van de a una |
| Worker | `imports.service.ts:1850-2396` `processImportJob` | PROCESANDO (`:1971-1974`) → `import:iniciada` (`:1977-1990`) → lotes de `IMPORTS_BATCH_SIZE=1000` → `tick` por lote (`:2096-2102`) → `afterAll` (`:2278-2284`) → FINALIZADA (`:2286-2294`) o FALLIDA (`:2349-2395`) + `import:finalizada` + notificación |
| Persistencia por lote | `imports.service.ts:2091-2094` | `remesa.update` con `okFilas`, `errFilas` y **`totalFilas` = acumulado** (bug #9) |
| Socket | `backend/src/modules/realtime/realtime.service.ts:61-74`, `realtime.gateway.ts:40-110` | Emite a sala `user:<id>` y a `admin:importaciones` (los admins reciben doble). Namespace `/rt`. El JWT se valida **solo en el handshake** (`:60-69`): una conexión ya establecida sobrevive al vencimiento; lo que falla es la reconexión siguiente (ver §3.6) |
| En curso (HTTP) | `imports.service.ts:1810-1847` `listarEnCurso` (`:1839`) | Lista PENDIENTE/VALIDANDO/PROCESANDO; `progreso: jobimport?.progreso ?? 0` |
| Estado (HTTP) | `imports.service.ts:2399-2450` `status()` | `duracionMs` sale de `jobimport` (siempre null) |
| Notificaciones | `backend/src/modules/notificaciones/` | Una por carga a cada usuario con permiso, con toast |
| Panel frontend | `frontend/src/context/NotificacionesContext.tsx:97-117` (hidrata 1 vez, al montar), `:156-171` (`onImportProgreso` ignora remesas desconocidas); `frontend/src/hooks/useImportacionesEnCurso.ts`; `frontend/src/components/layout/AppShell/NotificacionesPopover.tsx:131-158` e `ImportEnCursoItem.tsx` | Campanita + "Importaciones en curso" |
| Wizard | `frontend/src/pages/ImportWizard.tsx:463-495` (orquesta la carga dividida), `:1007-1036` (pasos 3 y 4); `frontend/src/components/import/ImportProgress.tsx:39-84`, `ImportSummary.tsx` | Paso "Importando" y "Resultado" |
| Detalle | `frontend/src/pages/ImportDetail.tsx:211-244` (solo socket), `:606` (tabla de errores solo si `errFilas>0`) | Página "Importación #N" |
| Historial | `frontend/src/pages/ImportHistory.tsx` | No escucha el socket |
| Socket cliente | `frontend/src/context/SocketContext.tsx` | No muestra estado de conexión; `auth: { token }` fijo (`:30-34`) |

Processors: `backend/src/modules/imports/processors/` (singletons registrados en `processor-registry.ts:20-37`).

> **PENDIENTE significa dos cosas.** Es el estado de una remesa recién subida (sin vista previa) y
> también el de una remesa **ya confirmada que espera en la cola**. Por eso "en curso" no se puede
> definir mirando solo `estadoProceso`: ver §5.2.

---

## 3. Hallazgos

Severidad del auditor. "Prod" = confirmado con datos reales (solo SELECT); "código" = por lectura.

### 3.1 Por qué el progreso no se completa

| # | Sev. | Hallazgo | Dónde | Evidencia |
|---|---|---|---|---|
| 1 | ALTO | Evento de socket perdido = UI congelada para siempre (panel, wizard y detalle). Sin re-hidratación al reconectar, sin polling, sin `visibilitychange`, sin aviso de desconexión. Con JWT vencido (`JWT_EXPIRES_IN=1d`) la **reconexión siguiente** es rechazada y socket.io **no vuelve a intentar** (precisión en §3.6). | `NotificacionesContext.tsx:97-117,156-171`, `ImportProgress.tsx:39-70`, `ImportDetail.tsx:211-244`, `SocketContext.tsx`, `realtime.gateway.ts:60-69` | código |
| 2 | ALTO | Progreso solo por lote de 1000 filas: cargas de un lote van 0→100 sin intermedios. El throttle "2 s o 5%" de `notificaciones-spec.md:97` existe (`ProgressEmitter`, `:1993-2013`) pero solo puede **suprimir** ticks de lote, nunca agregar intermedios (precisión en §3.6). | `imports.service.ts:2096-2102` | prod: 38/79 cargas de un solo lote (9 duraron ≥20 s); **MULTIARCHIVO 4/4 en 0%** durante 102-314 s (remesas 97, 99, 100, 107); DEUDORES 108: 14.466 filas en 768 s, saltos de ~7% cada ~51 s |
| 3 | ALTO | `afterAll` corre sin progreso y antes de FINALIZADA (barra clavada en 100% "PROCESANDO"); si tira, solo `logger.error` y se notifica "Importación finalizada". | `imports.service.ts:2278-2285`; pesados: `actualizaciones.processor.ts:937,1039`, `pagos.processor.ts:632-637`, `casos-cedente.processor.ts:826,874`, FACTURAS (recálculo monto), MULTICLAVES | código; duración real no medida (no hay logs por fase) |
| 4 | ALTO | Total 0 (solo header / todo filtrado): el wizard nunca llama `onComplete` y muestra "NaN%". Notifica "Se procesaron 0 filas correctamente." como éxito. "Confirmar e importar" no se deshabilita con total 0. | `ImportProgress.tsx:80` (`if (total===0 && ok===0 && err===0) return;`), `:53-54` (`totalFilas ?? 1` con 0); botón sin `disabled` en `ImportWizard.tsx:1086-1094` | medido con probe |
| 5 | ALTO | Carga FALLIDA mostrada como "Importación exitosa", con ok/err de la muestra de 50 filas de la vista previa. | `ImportSummary.tsx:16-23` (sin estado), `ImportWizard.tsx:463-495`, `imports.service.ts:2353-2356` | prod: remesas 86/87 del 08/07 fallaron así (ya borradas) |
| 6 | ALTO | Remesas fantasma "en curso" para siempre: `listarEnCurso` incluye PENDIENTE y VALIDANDO, que son vistas previas abandonadas (pero PENDIENTE es **también** una carga encolada: §3.6). | `imports.service.ts:1810-1818` | prod: **93** (MULTIRREGISTRO, PENDIENTE desde 28/07, total 0) y **98** (MULTIARCHIVO, VALIDANDO desde 31/07, 912/912 → "100% completado"). Las ven los 4 usuarios (todos ADMIN) |
| 7 | ALTO | La carga dividida (`divisionRemesa`) la encadena el **navegador**: si se cierra la pestaña, las remesas que faltan quedan PENDIENTE sin creador (y se vuelven fantasmas). La wiki dice que se puede cerrar la pantalla. | `ImportWizard.tsx:463-495`; `docs/ayuda/03-importacion/05-importar-un-archivo.md:152` | código (hoy ninguna colgada; 124-126 y 135-137 terminaron bien) |

### 3.2 Otros problemas

| # | Sev. | Hallazgo | Dónde | Evidencia |
|---|---|---|---|---|
| 8 | MEDIO | `jobimport` nunca se escribe: panel hidratado en medio de una carga muestra 0%; "Duración" = "—" en las 79 cargas. | `imports.service.ts:1839`, `status()` | prod: 0 filas en `jobimport` |
| 9 | MEDIO | `remesa.totalFilas` se pisa con el acumulado por lote (1000, 2000, 2500…): el detalle recién abierto muestra 100% en PROCESANDO y retrocede. | `imports.service.ts:2091-2094` | probe |
| 10 | MEDIO | MULTIRREGISTRO: la vista previa no guarda `totalFilas` ni VALIDANDO (return temprano) → `import:iniciada` total=0, ticks 0%, y `remesa.totalFilas ?? total` no cae porque es 0. Así quedó la 93. Ya anotado en CHANGELOG (~línea 3049). | `imports.service.ts:981-1023`, `:2002` | probe + prod |
| 11 | MEDIO | Advertencias `[parseo]`/`[aviso]` invisibles si `errFilas=0`; `advertencias.slice(0,500)` trunca sin avisar. | `ImportDetail.tsx:606` | prod: 97/99/100/107 con 2 advertencias c/u en `importerror` |
| 12 | MEDIO | Notificaciones que abren otra remesa: el wipe no borra `notificacion` y el AUTO_INCREMENT de `remesa` se reinicia. | procedimiento de wipe (memoria `wipe-cartera-por-empresa`) | prod: 50 `entidadId` huérfanos; 85-100 con 2 notificaciones de cargas distintas |
| 13 | MEDIO | Ruido: sin limpieza (N12 pendiente del spec de notificaciones), cada carga notifica a los 4 admins con toast. | notificaciones | prod: no leídas 176 / 135 / 180 (usuarios 3/4/5) |
| 14 | MEDIO | Carga colgada nunca falla: sin heartbeat/reaper/timeout. Un deploy en medio la deja PROCESANDO para siempre (bloquea "Ya tenés una importación en curso") o BullMQ la re-ejecuta desde cero (progreso vuelve a 0). La wiki dice "esperar a que falle". | BullMQ defaults; `docs/ayuda/03-importacion/08-historial-y-problemas.md:237` | código |
| 15 | MEDIO | Estado de processors singleton arrastrado entre cargas si una falla a mitad (`reset()` solo al final de `afterAll`). Ej.: FACTURAS que tira fuera del try por fila → el siguiente FACTURAS recalcula montos de la carga anterior. | `processor-registry.ts`; `acciones:325`, `facturas:187-193`, `actualizaciones:897` (return temprano antes de `reset()`) | código |
| 16 | MEDIO | Revertir ACCIONES: síncrono por HTTP, sin progreso, snapshot por snapshot con `.catch(() => {})`, sin transacción; >60 s → 504 del ALB mientras sigue corriendo, y como `accionRevertidaEn` se marca al final un segundo clic re-ejecuta. | `imports.service.ts:1695-1736` (`:1712`) | código |
| 17 | BAJO | "Ver errores" abre `/api/import/errores/:id` en pestaña nueva sin `Authorization` → 401. "Ver remesas" navega a `/remesas`, que no existe → pantalla en blanco. En carga dividida el resumen apunta solo a la primera remesa. | `ImportSummary.tsx`, `AppRoutes.tsx` | código |
| 18 | BAJO | Admin creador recibe cada evento 2 veces (sala `user:` + `admin:`); el último tick dice 100 con `PROCESANDO`; FINALIZADA con ok=0 notifica "Importación fallida" (prod: 114 PAGOS 0/12); `ImportHistory` no se actualiza solo. | `realtime.service.ts:61-74` | prod/código |

### 3.3 Tabla por categoría

| Categoría | Camino | ¿Llega a final? | Problemas propios |
|---|---|---|---|
| DEUDORES | por fila, tick por lote | Sí (si no se cae el socket) | <1000 filas: 0% todo el rato; hasta 51 s entre ticks; `afterAll` sin progreso |
| FACTURAS | `processBatch` | Sí | `afterAll` (recálculo/consolidación) sin progreso; estado arrastrado (#15) |
| DEUDORES_Y_FACTURAS | por fila | Sí | ídem DEUDORES |
| PAGOS | por fila | Sí | `afterAll` (consolidación + promesas) sin progreso; `[aviso] CLAVE_NO_CARGADA` oculto si errFilas=0 |
| CONTACTOS / ENRIQUECIMIENTO | por fila | Sí | Vacío / todo filtrado → NaN% y wizard trabado |
| ACTUALIZACIONES | por fila | Sí, pero 100% "PROCESANDO" mientras consolida la remesa origen entera | Error de `afterAll` oculto (#3); hubo una carga de 91 min en prod (52) |
| ACCIONES | por fila | Sí | Revertir sin progreso ni manejo de error (#16) |
| MULTIRREGISTRO | pre-parseado | Sin intermedios; total 0 | #10; deja PENDIENTE fantasma (93) |
| MULTIARCHIVO | pre-parseado | Sí, pero 0% durante 100-314 s | Advertencias invisibles; VALIDANDO fantasma (98) |
| MULTICLAVES | `processBatch` | Sí (rápido) | Avisos ocultos si errFilas=0 |
| Carga dividida | N remesas encadenadas por el browser | Solo con la pestaña abierta | #7; resumen apunta a una sola |
| FALLIDA (cualquiera) | catch | El wizard dice "exitosa" | #5 |

### 3.4 Lo que se verificó y está bien

- Prod: 0 remesas FINALIZADA con `ok+err ≠ total`; 0 FALLIDA; todas las FINALIZADA tienen notificación.
- Caso normal de 2.500 filas (probe sobre `processImportJob` real con prisma/realtime mockeados): emite 40/80/100/100 y finalizada.
- CloudWatch: divisiones 135-137 se encadenaron bien; sin desconexiones de socket en esas ventanas.
- Tests existentes de imports (wiring) pasan, pero **ninguno cubre los eventos de progreso**.

### 3.5 Lo que NO se pudo verificar (pendiente)

- Cuánto tarda cada `afterAll` en prod (no hay logs por fase) → agregar logs intent/done por fase en la Fase B y medir.
- Si hubo cortes reales de socket o jobs re-ejecutados por *stalled* durante cargas.
- Si un XLSX grande bloquea el event loop >45 s (`xlsx.readFile`, `parseMultiarchivo` son síncronos) y eso tira el socket.
- Cómo se ve todo en mobile y dark/light.

### 3.6 Correcciones y hallazgos nuevos del architect (05/10/2026)

Salen de leer el código de punta a punta para diseñar la Fase A. Todo es **por lectura**, salvo donde
dice otra cosa; nada se consultó en prod (los datos de prod de §3.1-§3.2 se toman tal cual del auditor).

**Referencias que estaban mal** (ya corregidas en §2 y §3):

- `ImportWizard.tsx` está en `frontend/src/pages/`, no en `components/import/`. La orquestación de la
  carga dividida es `:463-495`, no `:466-497`.
- `NotificacionesContext.tsx`: la hidratación es `:97-117` (no `:104-123`) y `onImportProgreso` es
  `:156-171` (no `:148-163`).
- `ImportProgress.tsx`: el `return` del total 0 es `:80` y el `?? 1` es `:53-54`.
- `processImportJob` va de `:1850` a `:2396` (el spec decía `~:1990-2360`).
- `ImportDetail.tsx:211-244` y `:606`, `imports.service.ts:2091-2094`, `:2353-2356`, `:1839` y las dos
  líneas de la wiki (`05:152`, `08:237`) **sí** eran exactas.

**Hallazgos que resultaron inexactos o incompletos:**

| # | Qué decía | Qué es en realidad |
|---|---|---|
| 1 | "Con JWT vencido el server desconecta" | El gateway valida el JWT **solo en el handshake** (`realtime.gateway.ts:60-69`); no hay chequeo periódico. Una conexión viva sobrevive al vencimiento. Lo que pasa es: se corta la red o se reinicia el backend → el cliente reconecta con el token vencido → el server acepta la conexión, la rechaza en `handleConnection` y hace `client.disconnect()` → el cliente ve `connect` y enseguida `disconnect` con motivo `io server disconnect`, que es el único motivo ante el cual socket.io-client **no reintenta**. Además entre el `connect` y el `join` a las salas (`:93-96`) hay un `await` a la base (`:71-74`): los eventos emitidos en esa ventana se pierden. Consecuencia para el diseño: re-hidratar al `connect` no alcanza sola, hace falta el polling de respaldo. |
| 2 | "El throttle 2 s / 5% nunca se aplica" | Se aplica (`progress-emitter.ts`, instanciado en `imports.service.ts:1993-2013` con `2000, 5`). El problema es otro: `tick` solo se llama una vez por lote, así que el throttle puede **comerse** ticks pero nunca generar intermedios. Ojo: `ProgressEmitter` también lo usa `consolidacion/bullmq/consolidacion.processor.ts:78` — no borrar el archivo. |
| 6 | "`listarEnCurso` incluye PENDIENTE y VALIDANDO, que son vistas previas abandonadas" | PENDIENTE es además el estado de una carga **encolada** (`executeRemesa` lo vuelve a poner, `:1785`). "En curso = encoladas + PROCESANDO" no se puede escribir como filtro sobre `estadoProceso`: la 93 (PENDIENTE fantasma) y una carga legítima en cola son indistinguibles por el enum. Es lo que decide §5.2. |
| 7 | "Las remesas que faltan quedan PENDIENTE sin creador" | Sin creador quedan **todas** las remesas hasta que se ejecutan, no solo las de la carga dividida: `imports.controller.ts:203` llama a `createRemesa(dto, subidos)` sin el usuario. Efecto lateral: un operador sin `importacion.ver_progreso_otros` no puede borrar su propio borrador (`deleteRemesa` compara contra `usuarioCreadorId`, `:2596-2599`). |
| — | §7: "convertir el probe en spec de jest en la Fase B" | Se adelanta a la Fase A (§8.9): sin tests de la secuencia de eventos el contrato nuevo no tiene red. Los tests **por categoría** siguen en B. |

**Hallazgos nuevos** (numeración continuada):

| # | Sev. | Hallazgo | Dónde |
|---|---|---|---|
| 19 | ALTO | **La vista previa lee otra hoja de Excel que la ejecución.** El controller llama `validateRemesa(id)` sin `hoja`, así que el preview recorre la **primera** hoja; el worker usa `remesa.hoja`. Si el operador eligió otra hoja, aprueba una vista previa (muestra, total, avisos de colisiones y de importes negativos) que no es la del archivo que se carga. Mismo problema en `previewAccionesImpacto`. No reproducido. | `imports.controller.ts:260,269`; `imports.service.ts:1381`, `:1624` vs `:2252` |
| 20 | MEDIO | **Validar y ejecutar no miran el estado.** `POST /import/validar/:id` sobre una remesa FINALIZADA la devuelve a VALIDANDO y le pisa `totalFilas/okFilas/errFilas` (y desaparece de los combos de remesa origen, que filtran `FINALIZADA`: `ImportWizard.tsx:208`). `POST /import/ejecutar/:id` sobre una FINALIZADA la vuelve a encolar. No hay UI que lo dispare, pero alcanza una pestaña vieja o un doble envío. | `imports.service.ts:1566-1574`, `:1752-1807` |
| 21 | MEDIO | **Una FALLIDA puede no notificar nada.** La notificación usa `error.message` crudo como `mensaje`, que es `VarChar(1000)`. Un error de Prisma (multilínea, con el fragmento de código) lo supera, el insert falla y `NotificacionesService.crear` solo deja un `warn`. No reproducido. | `imports.service.ts:2383`; `notificaciones.service.ts:84-93`; `schema.prisma:710` |
| 22 | MEDIO | **Carga dividida: si la remesa k no arranca, las que faltan se pierden sin aviso.** Ante un error de `ejecutarRemesa` (409, red) el wizard muestra un toast y salta a "Resultado" con los totales de las k-1 anteriores, como si hubiera terminado. | `ImportWizard.tsx:488-491` |
| 23 | MEDIO | **Si falla el encolado, el usuario queda bloqueado para siempre.** `executeRemesa` marca PENDIENTE + creador en una transacción y encola después; si `importQueue.add` tira (Redis caído), la remesa queda "en curso" y dispara el "Ya tenés una importación en curso" en cada intento. | `imports.service.ts:1766-1804` |
| 24 | MEDIO | **Una remesa encolada se puede borrar.** `deleteRemesa` solo bloquea PROCESANDO; el frontend tampoco. El worker después revienta con "Remesa/archivo/plantilla no existe". | `imports.service.ts:2592`; `ImportHistory.tsx:73-80` |
| 25 | BAJO | **Después de un login sin recargar, el panel no se hidrata.** `hidratar()` corre una sola vez al montar el provider; si en ese momento no había token, no corre nunca. Y `SocketContext` expone el socket por un `ref` memoizado por `conectado`, así que los handlers recién se registran después del primer `connect`. | `NotificacionesContext.tsx:97-117`; `SocketContext.tsx:56-59` |
| 26 | — | **Restricción de diseño, no bug:** el interceptor global de axios muestra un toast por cada error de red y cada 5xx. Un polling que no se marque como silencioso inunda la pantalla estando offline — justo la prueba de aceptación. | `frontend/src/api/setupAxiosInterceptors.ts:14-28` |

Los #19 a #24 entran en la Fase A porque el diseño los toca de todas formas (§8.1). Lo que **sí está
bien** y conviene saber: `ACTUALIZACIONES` no vacía la cartera con un archivo sin filas — las dos ramas
de ausentes abortan si ninguna fila matcheó (`actualizaciones.processor.ts:207`, `:968`).

---

## 4. Plan de implementación

Orden recomendado: **A → B → C → D**. A arregla la base (sin A, todo lo demás sigue siendo frágil).
Marcas: **[BUG]** arregla un hallazgo; **[MEJORA]** es funcionalidad nueva. Antes de arrancar A,
pasar este documento por el agente `architect` para cerrar las decisiones de §5 y el contrato exacto
del estado persistido y de los eventos.

### Fase A — Fuente de verdad y recuperación (~2 días)

> **Implementada y auditada el 05/10/2026; falta la prueba manual (§8.14) y el deploy (§8.6).** Diseño
> en [§8](#8-diseño-de-la-fase-a); lo que cambió al auditar, en §8.13. La lista de abajo queda como
> registro del plan original, con lo hecho tildado. Siguen pendientes, fuera del código: limpiar en prod
> las remesas 93/98 y las 50 notificaciones huérfanas (preview y confirmación del usuario). Cambios de
> alcance que decidió el architect (justificados en §8.1):
>
> - **Salen de A:** el reaper de borradores (pasa a B, con TTL y predicado ya decididos en §5.2) y la
>   limpieza de datos en prod — 93/98 y las 50 notificaciones huérfanas (fuera de alcance: preview y
>   confirmación del usuario).
> - **Entran a A:** #15 (processor por carga, venía en B), los dos botones rotos de #17 y la mitad de
>   #11 (venían en C), la emisión doble y el "100% PROCESANDO" de #18 (venían en D), los tests de la
>   secuencia de eventos (venían en B) y los hallazgos nuevos #19 a #24.

**Backend**
- [x] **[BUG #8 #9]** Estado persistido por carga. Opción preferida: reutilizar `jobimport` (ya existe, 0 filas) o crear `import_progreso` (decidir en §5). Campos: `remesaId`, `fase`, `procesadas`, `ok`, `err`, `descartadas`, `totalEsperado` (**separado** de `totalFilas`), `nuevos`, `actualizados`, `heartbeatAt`, `startedAt`, `finishedAt`, `error`, `advertencias` (count), `progreso` (0-100). Se escribe en el mismo update que ya se hace por lote. `prisma db push`, nunca `migrate dev`.
- [x] **[BUG #9]** Dejar de pisar `remesa.totalFilas` con el acumulado (`imports.service.ts:2091-2094`).
- [x] **[BUG #10]** MULTIRREGISTRO: guardar `totalFilas` y VALIDANDO en la vista previa (`:981-1023`); en `:2002` usar `||` o el total esperado explícito.
- [x] **[BUG #6]** "En curso" = solo encoladas y PROCESANDO. La vista previa pasa a un estado BORRADOR (o equivalente) que `listarEnCurso` no lista. ~~Reaper de borradores viejos (p. ej. >24 h). Limpiar 93 y 98 en prod (preview + confirmación del usuario).~~ → reaper a la Fase B; limpieza fuera de alcance.
- [x] **[BUG #5]** Al marcar FALLIDA, guardar el motivo y **resetear/dejar en null** ok/err de la vista previa (`:2353-2356`); el evento `import:finalizada` lleva estado + motivo.
- [x] **[BUG #3]** `afterAll` con try/catch que **persiste** el error (`advertencias`/`error` del estado) y termina como "finalizada con advertencias", no "finalizada" a secas. Notificación distinta.
- [x] **[BUG #4]** Total 0: el backend termina normal pero la notificación lo dice ("El archivo no tenía filas para procesar"), no "0 filas correctamente". Validar en la vista previa y deshabilitar el confirmar.
- [x] **[BUG #12]** Wipe: borrar también `notificacion` con `entidad='REMESA'` de las remesas borradas (actualizar el procedimiento en memoria `wipe-cartera-por-empresa` y `wipe-deudores-prod`). Limpiar los 50 huérfanos en prod (preview primero).
- [x] Endpoint de estado único: `GET /import/remesas/:id/progreso` (o ampliar `status()`) que devuelve el estado persistido; `listarEnCurso` lo usa en vez de `jobimport?.progreso ?? 0`; `duracionMs` sale de `startedAt/finishedAt`.

**Frontend**
- [x] **[BUG #1]** Re-hidratar en cada `connect`/reconexión del socket y en `visibilitychange` (`NotificacionesContext`, `ImportProgress`, `ImportDetail`).
- [x] **[BUG #1]** Polling de respaldo cada 10-15 s mientras haya cargas activas y el socket esté caído o sin eventos >30 s.
- [x] **[BUG #1]** `onImportProgreso`: upsert de remesas desconocidas en vez de ignorarlas (`:148-163`).
- [x] **[BUG #1]** `ImportProgress` consulta hasta estado terminal (no un único GET).
- [x] **[BUG #1]** Indicador de "sin conexión / reconectando" en `SocketContext`; ante desconexión por token vencido, renovar o pedir re-login y reconectar.
- [x] **[BUG #4]** `onComplete` con **cualquier** estado terminal (también 0/0/0); proteger divisiones por cero.
- [x] **[BUG #5]** Pasar el estado a `ImportSummary`: FALLIDA = pantalla de error con el motivo; "con advertencias" = aviso amarillo.

**Criterios de aceptación A**
- Cortar la red (DevTools offline) en medio de una carga y reconectar después de que termina → wizard, panel y detalle muestran el estado final **sin F5**, en ≤15 s.
- Recargar en medio de una carga → el panel muestra el % real (no 0) y el detalle no muestra 100% en PROCESANDO.
- Archivo solo-header → el wizard llega a "Resultado" con mensaje claro, sin NaN.
- Plantilla DEUDORES sin estado inicial → "Resultado" muestra error con motivo, no "exitosa".
- La campanita no muestra 93/98 ni vistas previas abandonadas.
- Error forzado en `afterAll` → notificación "con advertencias" y detalle con el error.

### Fase B — Fases y granularidad (~2 días)

- [ ] **[BUG #2]** Progreso **dentro** del lote: `ctx.reportar(n)` (o similar) cada ~200 filas o 1 s, también en processors por fila y en los pre-parseados (MULTIARCHIVO/MULTIRREGISTRO). Throttle real de 2 s / 5% como dice el spec de notificaciones, pero **sin comerse nunca el evento final**.
- [ ] **[MEJORA]** Fases visibles: SUBIENDO (axios `onUploadProgress`) → EN_COLA (posición) → LEYENDO/PARSEANDO → PROCESANDO → POST_PROCESO (subfases con su %: reconciliación, consolidación N/M, bajas, recálculo de montos) → FINALIZANDO. La fase va en el estado persistido y en cada evento.
- [ ] **[MEJORA]** `afterAll` reporta progreso propio por subfase (ACTUALIZACIONES, PAGOS, MULTI*, FACTURAS, MULTICLAVES). Logs intent/done con tiempo por fase (política de logging del CLAUDE.md) → así se mide lo de §3.5.
- [ ] **[MEJORA]** Contadores en vivo: ok, errores, descartadas por filtro, nuevos, actualizados (los processors ya cuentan altas/actualizados internamente: exponerlos). Velocidad (filas/s, promedio móvil) y ETA.
- [ ] **[BUG #14]** Heartbeat (`heartbeatAt` por lote/subfase) + reaper (cron) que marca FALLIDA si no hay heartbeat en N minutos y libera el bloqueo "una importación por usuario". Configurar BullMQ explícito (`attempts`, `lockDuration`, `maxStalledCount`) y decidir qué pasa si un job se re-ejecuta (no reiniciar el progreso en silencio). La Fase A ya deja `heartbeatAt` escrito por lote y `intentos` contado; el reaper tiene que cubrir también una carga que quedó `EN_COLA` sin job (proceso muerto entre el commit y el `queue.add`).
- [ ] **[BUG #6]** Reaper de **borradores** (viene de la Fase A). TTL y predicado ya decididos en §5.2: no reabrir.
- [x] ~~**[BUG #15]** `reset()` de los processors singleton al **inicio** de cada carga (o processors por carga)~~ → **movido a la Fase A** como "processor por carga" (§8.5.6).
- [ ] Evaluar sacar el parseo síncrono de XLSX/MULTIARCHIVO del event loop (worker thread o streaming) si se confirma el bloqueo >45 s.

**Criterios de aceptación B**
- Una carga de 900 filas muestra avance intermedio; MULTIARCHIVO deja de estar en 0% durante minutos.
- ACTUALIZACIONES muestra "Post-proceso: consolidando N/M" en vez de 100% clavado.
- Matar el worker en medio (o simular deploy) → en ≤N min la carga pasa a FALLIDA con motivo y el usuario puede volver a importar.
- Tests unitarios de la secuencia de eventos **por categoría** con progreso intermedio dentro del lote. (La secuencia del runner — iniciada → progreso → final; total 0; FALLIDA; error en `afterAll` — ya queda cubierta en la Fase A, §8.9.)

### Fase C — Interfaz (~3 días)

- [ ] **[MEJORA]** Componente único `ImportProgressCard` para wizard, panel y detalle: stepper de fases, barra, contadores, velocidad/ETA y **últimos 5 errores en vivo** con link a la tabla completa.
- [ ] **[BUG #7] / [MEJORA]** Carga dividida orquestada en el **backend** (job padre o BullMQ FlowProducer), mostrada como grupo: "remesa 2 de 3", barra total + una por hija. Resumen final con todas las hijas. Corregir la wiki (`05-importar-un-archivo.md:152`).
- [ ] **[MEJORA]** Panel de notificaciones con estado vivo y acciones: ver detalle, descargar errores (CSV autenticado vía blob, arregla el 401 de #17), reintentar FALLIDA, cancelar (flag revisado en cada lote).
- [ ] **[MEJORA]** Chip compacto de progreso en la barra superior (`AppShell`), visible en todas las pantallas mientras haya cargas activas.
- [ ] **[MEJORA]** Resumen final por categoría:
  - DEUDORES: altas, actualizados, colisiones por documento.
  - PAGOS: aplicados, ya cargados, negativos, con/sin clave.
  - ACTUALIZACIONES: ausentes desasignados o PAGO_TODO, consolidados.
  - MULTI*: casos, cuotas, bajas, advertencias.
  - ACCIONES: deudores afectados + revertir (con progreso: pasarlo a job BullMQ, arregla #16).
- [x] ~~**[BUG #11]** Mostrar advertencias aunque `errFilas=0`; avisar si se truncó a 500.~~ → **movido a la Fase A** (§8.5.4 y §8.8.6). Queda para C mostrarlas en vivo en el `ImportProgressCard`.
- [ ] **[BUG #17]** ~~"Ver remesas" a una ruta que exista, y "Ver errores" autenticado.~~ Los dos botones se arreglan en la Fase A (§8.8.5: van al detalle y al historial). Queda para C la descarga de errores en CSV vía blob.
- [ ] **[BUG #18]** `ImportHistory` escucha el socket (o re-consulta) para actualizar estados, y distingue "Borrador" y "En cola" (hasta entonces los muestra como Pendiente/Validando).
- [ ] **[MEJORA]** Mobile: panel como bottom-sheet / diálogo full-screen en `xs`, contadores en grilla de 2 columnas, ETA abreviada. Probar dark/light.

**Criterios de aceptación C**
- Cerrar la pestaña en medio de una carga dividida → las remesas restantes corren igual.
- Desde la campanita se puede ver el detalle, descargar errores y reintentar sin 401 ni pantallas en blanco.
- Revertir ACCIONES grande no da 504 y muestra progreso; un segundo clic no re-ejecuta.

### Fase D — Notificaciones y documentación (~1 día)

- [ ] **[BUG #13]** Cron de limpieza de notificaciones (N12 del spec de notificaciones). Preferencia de usuario para no recibir cargas ajenas; agrupar.
- [x] ~~**[BUG #18]** Una sola emisión por usuario; el último tick no dice 100 con PROCESANDO; FINALIZADA con ok=0 no se notifica como "fallida".~~ → **movido a la Fase A** (§8.4 y §8.5.5): salen gratis del contrato nuevo.
- [x] ~~**[MEJORA]** Notificación "terminó con advertencias".~~ → Fase A (§8.5.5).
- [ ] **[BUG]** Wiki: documentar fases, cancelar/reintentar y el nuevo panel. Las dos frases falsas (`05-importar-un-archivo.md:152` y `08-historial-y-problemas.md:237`) y todo lo que cambia la Fase A se corrigen **en la Fase A** (§8.10): la regla del repo es que la página cambia en el mismo commit que el flujo. Toda página de ayuda pasa por agente revisor antes de cerrarse (memoria `auditar-documentacion-con-agentes`).
- [ ] Actualizar [notificaciones-spec.md](notificaciones-spec.md) y CHANGELOG.

---

## 5. Decisiones

| # | Tema | Estado |
|---|---|---|
| 5.1 | `jobimport` vs tabla nueva | **Cerrada** (architect, 05/10/2026): tabla nueva `import_progreso` |
| 5.2 | Cómo se distingue un borrador de una carga en curso; TTL del reaper | **Cerrada** (architect, 05/10/2026): sin tocar el enum; TTL 24 h; reaper en la Fase B |
| 5.3 | Minutos sin heartbeat para declarar FALLIDA | Abierta — recomendación abajo; es de la Fase B |
| 5.4 | Cancelar: ¿deja lo procesado o revierte? | Abierta — **necesita OK del usuario**; es de la Fase C |
| 5.5 | Notificar las cargas ajenas a todos los admins | Abierta — **necesita OK del usuario**; es de la Fase D |
| 5.6 | Carga dividida: job padre o FlowProducer | Abierta — recomendación abajo; es de la Fase C |

### 5.1 — Tabla nueva `import_progreso`. `jobimport` no se toca. (cerrada)

Una fila por remesa, con `remesaId` como **clave primaria y FK a la vez**. El modelo exacto está en
§8.2. Por qué no reusar `jobimport`:

1. **El deploy.** Una relación 1-1 necesita unicidad sobre `remesaId`. En `jobimport` eso es un
   `@@unique` sobre una tabla que ya existe, y Prisma lo marca como posible pérdida de datos aunque la
   tabla esté vacía: el `db push` del deploy, que corre sin `--accept-data-loss`, se frena (ya pasó el
   28/08/2026). En una tabla nueva la unicidad es la PK y nace con el `CREATE TABLE`.
2. **Cero `ALTER` sobre tablas existentes.** El diff verificado contra la base local es un
   `CREATE TABLE` y un `ADD CONSTRAINT` sobre la tabla nueva (§8.2). Si el push se corta a la mitad no
   queda ninguna tabla con datos a medio migrar.
3. **La forma no sirve.** `jobimport` tiene `estado` (un enum duplicado del de la remesa), `progreso` y
   `log`. Reusarlo era agregarle ~25 columnas y dejar de usar las tres que tiene; del original solo
   quedaba el nombre, y el nombre miente: es el estado de la carga, no el de un job (una carga puede
   re-ejecutarse en otro job).

`jobimport` queda como está: se deja de leer (`listarEnCurso` y `status()`) y los `deleteMany` de
`deleteRemesa` siguen, porque son inocuos. Dropearla es otro push, aparte y a propósito; no en esta
evolución.

### 5.2 — El borrador es una fila sin encolar. No se agrega BORRADOR al enum. (cerrada)

**Decisión.** `remesa_estadoProceso` no cambia. Toda remesa nueva nace con su fila de `import_progreso`
en `fase = 'BORRADOR'` y `encoladaAt = NULL`. Confirmar la carga (`executeRemesa`) escribe `encoladaAt`
en la misma transacción que la manda a la cola. Con eso:

- **Borrador** (vista previa sin confirmar): tiene fila y `encoladaAt IS NULL`.
- **En curso**: `encoladaAt IS NOT NULL` y `finishedAt IS NULL`. Es la **única** definición, y la usan
  el listado, el bloqueo "una importación por usuario" y el bloqueo del borrado.
- **Terminal**: `finishedAt IS NOT NULL` (remesa FINALIZADA o FALLIDA).
- **Heredada**: una remesa sin fila. No está en curso por definición.

Las remesas 93 (PENDIENTE) y 98 (VALIDANDO) de prod no tienen fila, así que **dejan de figurar en curso
con solo desplegar**, sin ninguna escritura en prod. Siguen en el Historial hasta que el usuario decida
borrarlas (se puede desde la pantalla, con el botón Eliminar: PENDIENTE y VALIDANDO son eliminables).

**Por qué no un estado BORRADOR en el enum:**

1. **No resuelve el caso que hay que resolver.** La 93 está en PENDIENTE, que es también el estado de
   una carga encolada (§3.6). Con el enum nuevo seguiría pareciendo encolada hasta que alguien la
   corrija a mano en prod. Hace falta un marcador **positivo** de "se confirmó", y ese marcador ya es
   la fila de progreso.
2. **Es un `ALTER` sobre `remesa`** dentro de un push que no es transaccional, para ganar un valor que
   después hay que enseñarle a cada consumidor: los mapas de estado de `ImportHistory` y `ImportDetail`,
   `esEliminable`, el catálogo de reportes (`reportes/catalogo/metadata.ts:409`), la wiki.
3. **Deja un estado muerto.** VALIDANDO pasaría a no escribirse nunca y no se puede sacar del enum
   (eso sí es pérdida de datos).

Lo que se paga: `PENDIENTE` sigue significando dos cosas en la columna vieja. Es aceptable porque
ningún código nuevo decide mirando `estadoProceso` — decide con `enCurso` / `terminal`, que el backend
calcula en un solo lugar (§8.3).

**Reaper de borradores: TTL 24 h, y se implementa en la Fase B, no en la A.**

- *Por qué 24 h:* no hay pantalla para retomar una vista previa, así que un borrador muere cuando se
  cierra el wizard. El TTL solo tiene que ser holgadamente mayor que la carga dividida más larga,
  porque hasta la Fase C las remesas de una división que todavía no arrancaron **son** borradores (la
  carga más larga medida es de 91 min, remesa 52). 24 h deja más de 10× de margen y cubre a quien dejó
  la vista previa abierta de un día para el otro.
- *Qué borra* (predicado completo, para no reabrirlo en B): remesas con
  `estadoProceso IN ('PENDIENTE','VALIDANDO')`, con fila de progreso en `fase = 'BORRADOR'` y
  `encoladaAt IS NULL`, con `createdAt` anterior a 24 h y **sin ningún deudor**. Borra `importerror` y
  la remesa (la fila de progreso cae por cascade) dentro de una transacción que vuelve a leer
  `encoladaAt` con `FOR UPDATE`, para no pisarse con alguien que justo confirma. No borra archivos
  (tampoco lo hace `deleteRemesa`). Cron diario 04:30; `IMPORTS_BORRADOR_TTL_HORAS` (default 24).
- *Qué no toca:* las remesas **sin fila** (las heredadas, 93 y 98 incluidas). Nunca borra algo que el
  código nuevo no creó como borrador.
- *Por qué en B:* ningún criterio de aceptación de A depende de él (los borradores ya no se ven "en
  curso"); es un job que borra filas solo, y eso merece auditarse junto con el otro reaper —el de
  heartbeat—, que comparte scheduler, patrón y tests. Hasta entonces los borradores se acumulan igual
  que hoy: no hay regresión.

### 5.3 a 5.6 — Recomendaciones (no bloquean la Fase A)

- **5.3 Minutos sin heartbeat → FALLIDA.** No se puede fijar hasta medir, y medir es lo primero de la
  Fase B. Recomendación: 10 minutos, **a condición de** que el post-proceso lata por dentro (un
  heartbeat por tanda de consolidación). Sin eso el umbral tendría que superar al `afterAll` más largo
  y no serviría de nada. La Fase A ya deja en el log cuánto tarda cada `afterAll` (§8.5.4), así que el
  dato va a estar. No necesita OK del usuario, salvo el número final.
- **5.4 Cancelar.** Recomendación: deja lo ya procesado y lo informa con el número exacto ("se
  cargaron 3.000 de 14.466 filas"); no intenta revertir. Solo ACCIONES tiene con qué deshacer (los
  snapshots). **Necesita OK del usuario**: es una decisión de producto. El campo `cancelSolicitadaAt`
  ya queda en el schema.
- **5.5 Cargas ajenas.** Recomendación: los que tienen `importacion.ver_progreso_otros` las siguen
  viendo en "Importaciones en curso" y en el historial de la campanita, pero **sin toast**; el toast
  queda solo para el dueño. La preferencia por usuario, si se quiere, es un cambio de schema aparte
  (no entra en `import_progreso`). **Necesita OK del usuario.**
- **5.6 Carga dividida.** Recomendación: ni job padre ni FlowProducer. El worker tiene concurrencia 1,
  así que alcanza con **encolar las N remesas juntas y en orden** desde un endpoint de grupo, con
  `grupoId` / `grupoOrden` / `grupoTotal` en `import_progreso` (ya en el schema) para mostrarlas
  agrupadas. FlowProducer está pensado para hijos en paralelo con un padre que espera, que es lo
  contrario de lo que se necesita. Lo único que **necesita OK del usuario**: si una remesa del grupo
  falla, ¿siguen las demás? (Hoy siguen.)

---

## 6. Guion de reproducción (para validar antes y después)

1. **Fantasmas:** abrir la campanita → "Importaciones en curso (2)", "Sistema", 0%. En la MULTIARCHIVO, "Ver detalle" → "Importación #00002" en VALIDANDO con "100% completado".
2. **Socket perdido:** Nueva Importación, DEUDORES de ~3.000 filas, "Confirmar e importar"; en "Importando", DevTools → Offline hasta que termine (verificar desde otro dispositivo) y reconectar → wizard y campanita quedan en el último % hasta F5.
3. **Archivo vacío:** CSV solo con header (plantilla con encabezado) → queda en "Ejecutando importación" con "NaN%".
4. **Un solo lote:** MULTIARCHIVO o DEUDORES de ~900 filas → 0% hasta saltar a 100%.
5. **Recargar en medio:** carga de >5.000 filas, abrir su detalle desde Historial → 100% en PROCESANDO y luego retrocede; recargar → campanita en 0%.
6. **FALLIDA como exitosa:** plantilla DEUDORES sin estado inicial de situación/gestión → "Resultado" dice "Importación exitosa".
7. **Botones del resultado:** con errores, "Ver errores" → pestaña con 401; "Ver remesas" → pantalla en blanco.
8. **Advertencias ocultas:** Historial → detalle de la remesa 107 (MULTIARCHIVO): no aparece la sección de errores aunque hay 2 `[parseo]` guardados.
9. **Notificación a la remesa equivocada:** pestaña "Leídas", notificación del 10/07 "Se procesaron 100 filas correctamente." (era un DEUDORES) abre la #00002 MULTIRREGISTRO PENDIENTE.

---

## 7. Cómo verificar (herramientas)

- **Prod (solo lectura):** correr node dentro del contenedor backend vía SSM (ver memoria `prod-db-query-ssm`: perfil `amsa-gestion`, EC2 `i-09f8d6ff1ae9d99e1`, contenedor `amsa-gestion-backend`, script en `/app`, base64). Consultas útiles:
  - fantasmas: `SELECT id, categoria, estadoProceso, totalFilas, createdAt FROM remesa WHERE estadoProceso IN ('PENDIENTE','VALIDANDO','PROCESANDO')`
  - incoherentes: `SELECT id FROM remesa WHERE estadoProceso='FINALIZADA' AND okFilas+errFilas <> totalFilas`
  - `SELECT COUNT(*) FROM jobimport`
  - notificaciones huérfanas: `notificacion` con `entidad='REMESA'` cuyo `entidadId` no existe en `remesa`
  - duración real: `durationMs` dentro de los datos de las notificaciones de import.
- **Logs:** CloudWatch `/amsa-gestion/backend` (perfil `amsa-gestion`, us-east-1).
- **Probe local de eventos:** instanciar `ImportService` con `prisma`/`realtime`/`notificaciones` mockeados (Proxy) y llamar `processImportJob(job, remesaId)` sobre un CSV real en disco, registrando cada `emitImport*` y cada `remesa.update`. Así se midieron #4, #9 y #10; convertirlo en spec de jest en la Fase B.
- **Backend:** `npm run build` y `npx jest`. **No** correr `npm run lint` / `eslint --fix` (reformatea ~167 archivos).
- **Escrituras en prod** (limpiar 93/98, notificaciones huérfanas): siempre preview de solo lectura primero y confirmación del usuario.

---

## 8. Diseño de la Fase A

> Architect, 05/10/2026, sobre HEAD `a0675dc`. Es lo que ejecutan los dos `implementer` (backend y
> frontend, en paralelo) y lo que el `auditor` intenta romper. Las referencias `archivo:línea` de esta
> sección fueron verificadas una por una contra el código.
>
> **La idea en tres líneas.** (1) Cada carga tiene una fila en `import_progreso` y todo lo que la UI
> muestra sale de ahí. (2) El socket deja de ser la fuente del dato: solo avisa "hay algo nuevo" con una
> foto completa del estado; si un aviso se pierde, la UI lo recupera por HTTP. (3) El backend le dice a
> la UI **cómo terminó** la carga (`resultado` + motivo) en vez de dejarla adivinar con los contadores.

### 8.1 Alcance, impacto y riesgos

**Qué arregla** (hallazgo → dónde está diseñado):

| Hallazgo | Sección |
|---|---|
| #1 evento perdido = UI congelada; JWT vencido | §8.8.2, §8.8.3, §8.8.4 |
| #3 `afterAll` que falla en silencio | §8.5.4, §8.5.5 |
| #4 total 0: NaN, wizard trabado, "0 filas correctamente" | §8.3, §8.5.3, §8.8.5 |
| #5 FALLIDA mostrada como exitosa | §8.4, §8.5.4, §8.8.5 |
| #6 fantasmas en curso | §5.2, §8.5.7 |
| #8 `jobimport` vacío: 0% y sin duración | §8.2, §8.5.7 |
| #9 `totalFilas` pisado por lote | §8.5.4 |
| #10 MULTIRREGISTRO sin total | §8.5.2 |
| #11 (mitad) advertencias invisibles y truncadas sin aviso | §8.5.4, §8.8.6 |
| #12 (parte de código) notificaciones que sobreviven a su remesa | §8.5.7 |
| #15 estado de processors arrastrado entre cargas | §8.5.6 |
| #17 (mitad) botones rotos del resultado | §8.8.5 |
| #18 (parte) emisión doble; "100% PROCESANDO"; ok=0 notificado como "fallida" | §8.4, §8.5.5 |
| #19 a #24 (nuevos, §3.6) | §8.5.2, §8.5.3, §8.5.5, §8.5.7, §8.8.5 |

**Qué no arregla, y se va a seguir viendo después de la Fase A:**

- Las cargas de un solo lote siguen saltando de 0 a 99% (#2), y el post-proceso sigue siendo una barra
  indeterminada sin detalle. Eso es la Fase B.
- Una carga cuyo worker muere queda en PROCESANDO para siempre (#14). La Fase A no la hace fallar; lo
  único que agrega es que la pantalla **dice** hace cuánto no hay novedades (§8.8.5).
- La carga dividida sigue encadenada por el navegador (#7). La Fase A solo deja de mentir en el resumen
  (§8.8.5).
- El Historial sigue mostrando los borradores como Pendiente/Validando (#18, Fase C).
- 93, 98 y las 50 notificaciones huérfanas siguen en la base de prod. Fuera de alcance.

**Ítems que cambian de fase**

| Ítem | Movimiento | Por qué |
|---|---|---|
| Reaper de borradores | A → B | Ningún criterio de A depende de él; es un job que borra filas solo y se audita mejor junto al reaper de heartbeat (§5.2) |
| Limpieza de 93/98 y notificaciones huérfanas | A → fuera | Escribe en prod: preview y confirmación del usuario |
| #15 processor por carga | B → A | Son ~10 líneas en un archivo. La Fase A convierte el fallo de `afterAll` en un resultado visible; dejar que ese mismo fallo contamine la carga siguiente de la misma categoría sería avisar del problema chico y callar el grande. **Es separable**: si no se aprueba, se saltea el paso BE-7 sin tocar nada más |
| #17 botones "Ver errores" / "Ver remesas" | C → A | `ImportSummary` se reescribe en A; entregarlo con dos botones que se sabe que están rotos no tiene sentido. La descarga en CSV sigue en C |
| #11 advertencias con `errFilas = 0` | C → A | El contador `advertencias` ya es parte del contrato; poblarlo son 3 líneas y mostrarlo, una condición en un archivo que A ya toca |
| #18 emisión doble y "100% PROCESANDO" | D → A | Salen del contrato nuevo sin costo: una sola emisión a la unión de salas, y el porcentaje topeado en 99 hasta el estado terminal |
| Tests de la secuencia de eventos | B → A | El contrato nuevo necesita red desde el día uno. Los tests por categoría siguen en B |

**Impacto.** Backend: `ImportService` (alta, vista previa, encolado, worker, estado, listado, borrado),
`ImportController`, `RealtimeService`, `processor-registry`. No cambia ningún processor ni el gateway.
Frontend: los dos contextos (`SocketContext`, `NotificacionesContext`), el wizard (`ImportWizard`,
`ImportProgress`, `ImportSummary`), `ImportDetail`, la campanita (`NotificacionesPopover`,
`ImportEnCursoItem`, `NotificacionItem`), la barra superior y el interceptor de axios. Schema: una
tabla nueva. Jobs: el worker de imports; ningún cron nuevo.

**Qué se rompe si sale mal:**

1. *El deploy.* Si el `db push` falla, el backend no levanta. Mitigado: el cambio es una tabla nueva
   (§8.2) y hay un chequeo previo en prod (§8.6).
2. *Las cargas.* `processImportJob` es el camino por el que entra toda la cartera. Un error en el
   escritor del progreso puede tumbar cargas que hoy andan. Mitigado: el escritor es una clase aparte
   con sus tests, la emisión por socket nunca tira, y los 679 tests de hoy tienen que seguir pasando
   **sin modificarlos** (§8.9).
3. *El bloqueo por usuario.* Si la definición nueva de "en curso" se escribe mal, o nadie puede
   importar o un mismo usuario lanza dos cargas juntas. Cubierto por tests (§8.9).

**Datos ya cargados.** Ninguna fila existente se modifica. Las remesas viejas no tienen fila de
progreso y se muestran con un estado sintetizado desde `remesa` (§8.3): sin duración, sin motivo, con
el resultado deducido de los contadores. **No hay backfill** y es a propósito: sería una escritura en
prod para inventar datos que no se tienen, y la ausencia de fila es justamente lo que distingue una
remesa heredada.

### 8.2 Datos

**Modelo** (va en `backend/prisma/schema.prisma`, después de `jobimport`):

```prisma
/// Estado persistido de UNA carga: una fila por remesa, creada junto con la remesa.
/// Es la fuente de verdad del progreso de una importación — el socket solo empuja lo que ya está
/// escrito acá. Lo escribe únicamente `ProgresoTracker` (durante el job) y `ImportService`
/// (alta, vista previa y encolado). Ver docs/imports-progreso-realtime-spec.md §8.
model import_progreso {
  /// PK y FK a la vez: la relación es 1-1 sin necesitar un índice único aparte.
  remesaId           Int       @id
  /// Contador de escrituras. Se incrementa en la base (`{ increment: 1 }`), nunca se asigna. El
  /// cliente descarta cualquier estado con un `rev` menor al que ya tiene.
  rev                Int       @default(0)
  /// BORRADOR | EN_COLA | PROCESANDO | POST_PROCESO | TERMINADA. VarChar y no enum a propósito:
  /// la Fase B agrega fases sin tocar el schema.
  fase               String    @default("BORRADOR") @db.VarChar(20)
  /// Detalle de la fase ("Consolidando 120/900"). Fase B; sin poblar en la A.
  subfase            String?   @db.VarChar(160)
  /// 0-100. Se persiste en vez de derivarse al leer para que HTTP y socket digan lo mismo.
  porcentaje         Int       @default(0)
  /// Filas que el archivo tiene para procesar, según la vista previa. NUNCA se pisa con el
  /// acumulado (ese era el bug de `remesa.totalFilas`).
  totalEsperado      Int       @default(0)
  procesadas         Int       @default(0)
  ok                 Int       @default(0)
  err                Int       @default(0)
  /// Filas que el filtro de la plantilla (o el corte de la división) dejó afuera. No son error.
  descartadas        Int       @default(0)
  /// Avisos que no son filas con error: [parseo], [aviso] y el fallo del post-proceso.
  advertencias       Int       @default(0)
  /// Fase B.
  nuevos             Int?
  /// Fase B.
  actualizados       Int?
  /// null mientras no terminó. OK | CON_ERRORES | CON_ADVERTENCIAS | SIN_FILAS | FALLIDA
  resultado          String?   @db.VarChar(20)
  /// Motivo de la falla (resultado FALLIDA). Máx. 4000 caracteres, lo recorta el código.
  error              String?   @db.Text
  /// Por qué no terminó el post-proceso (resultado CON_ADVERTENCIAS).
  errorPostProceso   String?   @db.Text
  /// Resumen final por categoría (altas, actualizados, bajas…). Fase C.
  resumen            Json?
  /// Cuántas veces arrancó el worker sobre esta remesa. >1 = BullMQ la re-ejecutó.
  intentos           Int       @default(0)
  jobId              String?   @db.VarChar(64)
  /// Carga dividida mostrada como grupo. Fase C.
  grupoId            String?   @db.VarChar(40)
  grupoOrden         Int?
  grupoTotal         Int?
  /// Cancelación pedida por el usuario; el runner la revisa en cada lote. Fase C.
  cancelSolicitadaAt DateTime?
  /// null = borrador. Se escribe al confirmar, en la misma transacción que manda el job a la cola.
  encoladaAt         DateTime?
  startedAt          DateTime?
  /// Última señal de vida del worker. En la Fase A late una vez por lote.
  heartbeatAt        DateTime?
  /// null = no terminó.
  finishedAt         DateTime?
  // Cascade, como `accion_masiva_snapshot`: la fila no significa nada sin su remesa.
  remesa             remesa    @relation(fields: [remesaId], references: [id], onDelete: Cascade, map: "ImportProgreso_remesaId_fkey")

  @@index([finishedAt], map: "ImportProgreso_finishedAt_idx")
  @@index([grupoId], map: "ImportProgreso_grupoId_idx")
}
```

Y en `model remesa`, junto a `jobimport jobimport[]` (`schema.prisma:360`):

```prisma
  progreso             import_progreso?
```

La columna del porcentaje se llama `porcentaje` y no `progreso` para que el código no termine
escribiendo `remesa.progreso.progreso`. En el contrato (§8.4) el campo sigue siendo `progreso`, que es
como lo conocen los eventos de hoy.

**Lo que se puebla en cada fase.** Fase A: todo salvo `subfase`, `nuevos`, `actualizados`, `resumen`,
`grupo*` y `cancelSolicitadaAt`. Fase B: `subfase`, `nuevos`, `actualizados` y fases nuevas en `fase`.
Fase C: `resumen`, `grupo*`, `cancelSolicitadaAt`. Con esto el estado de la carga no necesita otro
cambio de schema en toda la evolución. La única excepción posible está fuera de esta tabla: la
preferencia de notificaciones de §5.5, si se aprueba.

**El `db push`.** SQL que genera, verificado con `prisma migrate diff` contra la base local (MySQL
8.0.46, que hoy está sincronizada con el schema):

```sql
CREATE TABLE `import_progreso` ( ... PRIMARY KEY (`remesaId`),
    INDEX `ImportProgreso_finishedAt_idx`(`finishedAt`), INDEX `ImportProgreso_grupoId_idx`(`grupoId`) );
ALTER TABLE `import_progreso` ADD CONSTRAINT `ImportProgreso_remesaId_fkey`
    FOREIGN KEY (`remesaId`) REFERENCES `remesa`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
```

- Ningún `ALTER` sobre una tabla existente. Ningún `@@unique`. Ningún enum tocado.
- Los avisos de pérdida de datos de Prisma son siempre sobre tablas que ya existen (columnas que se
  van, casts, uniques nuevos, valores de enum que desaparecen); este diff no tiene ninguno.
  **No verificado ejecutando el push** (habría escrito la base local): lo verifica el paso BE-1, que
  corre `npx prisma db push` **sin** `--accept-data-loss` y tiene orden de parar si Prisma lo pide.
- Si el push se corta entre las dos sentencias, queda la tabla sin la FK y el push siguiente la
  agrega. No hay estado intermedio que rompa datos.

**Sin backfill.** Ver "Datos ya cargados" en §8.1.

**Procedimientos de wipe.** La tabla nueva tiene FK a `remesa`. Un `DELETE FROM remesa` la limpia sola
(cascade), pero un `TRUNCATE remesa` con `FOREIGN_KEY_CHECKS=0` deja las filas huérfanas, y como el
`AUTO_INCREMENT` se reinicia, **la primera remesa nueva choca contra la PK de la fila huérfana y el
alta falla**: nadie puede importar hasta limpiar la tabla. Falla fuerte y no en silencio, que es el
modo de fallo preferible, pero hay que evitarlo: agregar `import_progreso` (y `notificacion` con
`entidadTipo='REMESA'`, que es el #12) a las listas de las memorias `wipe-deudores-prod` y
`wipe-cartera-por-empresa`. Lo hace quien orquesta: las memorias no están en el repo. Control
(tiene que dar 0):
`SELECT COUNT(*) FROM import_progreso p LEFT JOIN remesa r ON r.id = p.remesaId WHERE r.id IS NULL`.

### 8.3 Máquina de estados

Dos columnas cuentan la misma historia con distinto detalle: `remesa.estadoProceso` (el enum de
siempre, que no cambia y sigue alimentando el Historial, los reportes y los combos) e
`import_progreso.fase` (el detalle). Siempre se escriben **en el mismo `update`** (escritura anidada de
Prisma, que es atómica), así que no pueden contradecirse.

| Momento | Quién | `estadoProceso` | `fase` | `encoladaAt` | `finishedAt` | `resultado` |
|---|---|---|---|---|---|---|
| Se sube el archivo | `createRemesa` | PENDIENTE | BORRADOR | null | null | null |
| Vista previa | `validateRemesa` | VALIDANDO | BORRADOR | null | null | null |
| "Confirmar e importar" | `executeRemesa` | PENDIENTE | EN_COLA | ahora | null | null |
| El worker toma el job | `tracker.iniciar` | PROCESANDO | PROCESANDO | (igual) | null | null |
| Cada lote | `tracker.lote` | PROCESANDO | PROCESANDO | (igual) | null | null |
| Terminaron las filas | `tracker.entrarEnPostProceso` | PROCESANDO | POST_PROCESO | (igual) | null | null |
| Terminó | `tracker.finalizar` | FINALIZADA | TERMINADA | (igual) | ahora | OK / CON_ERRORES / CON_ADVERTENCIAS / SIN_FILAS |
| Excepción en cualquier punto | `tracker.fallar` | FALLIDA | TERMINADA | (igual) | ahora | FALLIDA |
| No se pudo encolar | `executeRemesa` | el que tenía (PENDIENTE / VALIDANDO) | BORRADOR | null | null | null |

**Reglas:**

- **En curso** ⟺ `encoladaAt != null && finishedAt == null`. Nada más. Para una remesa **sin fila**
  (heredada): en curso ⟺ `estadoProceso == 'PROCESANDO'`, solo para pintarla bien en el detalle; el
  listado de "en curso" consulta por fila, así que una heredada nunca aparece ahí.
- **Terminal** ⟺ `estadoProceso ∈ {FINALIZADA, FALLIDA}`. De un estado terminal no se sale: validar o
  ejecutar una remesa terminal o en curso es un 409 (#20). El reintento de una FALLIDA, cuando exista,
  es de la Fase C.
- **Borrador** ⟺ ni en curso ni terminal.
- **Una vez persistido el estado terminal, nada lo pisa.** Si después de `finalizar` falla la
  notificación, la carga sigue FINALIZADA.
- `validateRemesa` solo corre sobre un borrador. `executeRemesa` solo encola un borrador.
- Re-ejecución (BullMQ reencola un job *stalled*): el worker vuelve a pasar por `iniciar`, que
  incrementa `intentos`, pone los contadores en cero y lo deja en el log como `warn`. `rev` sigue
  creciendo, así que la UI ve el reinicio en vez de quedarse con el número viejo.

**Cómo se clasifica el final** (una sola función pura, `clasificarResultado`; gana la primera que
se cumple):

| # | Condición | `resultado` | `estadoProceso` |
|---|---|---|---|
| 1 | Hubo una excepción | `FALLIDA` | FALLIDA |
| 2 | El post-proceso (`afterAll`) tiró | `CON_ADVERTENCIAS` | FINALIZADA |
| 3 | `procesadas == 0` | `SIN_FILAS` | FINALIZADA |
| 4 | `err > 0` | `CON_ERRORES` | FINALIZADA |
| 5 | Ninguna de las anteriores | `OK` | FINALIZADA |

- `CON_ADVERTENCIAS` significa **una sola cosa: las filas se cargaron y el post-proceso no terminó**
  (consolidación, cierre de ausentes, recálculo de montos). Es el caso grave entre los finalizados. Los
  avisos de parseo (`[parseo]`, `[aviso]`) **no** lo disparan: todas las cargas de Toyota traen dos, y
  si cada una saliera en amarillo el aviso dejaría de leerse. Esos van en el contador `advertencias` y
  se muestran como una línea informativa.
- "Todas las filas dieron error" (`ok == 0 && err > 0`) es `CON_ERRORES`; la diferencia la hace el
  texto (§8.5.5), no un sexto valor.
- **Total 0** (`SIN_FILAS`): la carga termina FINALIZADA, con su `import:finalizada`, y la pantalla
  llega a "Resultado". Si las filas existían pero el filtro las descartó todas, `descartadas` lo dice
  y el texto lo muestra con el número. Además no debería poder llegar a ejecutarse: el botón se
  deshabilita y el backend rechaza el encolado (§8.5.3).

**Porcentaje** (función pura `calcularPorcentaje`, la misma para todas las categorías):

```
si la carga terminó FINALIZADA            → 100
si totalEsperado <= 0                     → 0          (la UI muestra barra indeterminada)
si no                                     → min(99, floor(procesadas * 100 / totalEsperado))
```

Nunca devuelve `NaN` ni 100 antes del estado terminal. Una FALLIDA conserva el último valor.

**Estado sintetizado de una remesa sin fila** (`armarEstadoCarga(remesa, null)`):

| `estadoProceso` | `fase` | `enCurso` | `resultado` | `progreso` |
|---|---|---|---|---|
| PENDIENTE, VALIDANDO | BORRADOR | false | null | 0 |
| PROCESANDO | PROCESANDO | true | null | calculado con `okFilas + errFilas` sobre `totalFilas` |
| FINALIZADA | TERMINADA | false | `SIN_FILAS` si `totalFilas == 0`; `CON_ERRORES` si `errFilas > 0`; si no `OK` | 100 |
| FALLIDA | TERMINADA | false | `FALLIDA` | 0 |

Con `rev = 0`, fechas y `duracionMs` en null, `error` en null. Así la 98 (VALIDANDO, 912/912) deja de
decir "100% completado": es un borrador en 0.

### 8.4 Contratos

Este apartado es lo que permite que el frontend se implemente sin esperar al backend. Los tipos se
copian **tal cual** en los dos lados: `backend/src/modules/imports/progreso/estado-carga.types.ts` y
`frontend/src/types/importProgreso.ts`.

#### 8.4.1 Tipos

```ts
/** Fases que existen en la Fase A. La Fase B agrega valores: el cliente trata cualquier otro
 *  string como "en curso, fase que no conozco" y muestra el texto tal cual. */
export type FaseCarga = 'BORRADOR' | 'EN_COLA' | 'PROCESANDO' | 'POST_PROCESO' | 'TERMINADA';

export type ResultadoCarga = 'OK' | 'CON_ERRORES' | 'CON_ADVERTENCIAS' | 'SIN_FILAS' | 'FALLIDA';

export type EstadoProcesoRemesa = 'PENDIENTE' | 'VALIDANDO' | 'PROCESANDO' | 'FINALIZADA' | 'FALLIDA';

/** Foto completa del estado de una carga. Es el payload de los tres eventos de socket y la
 *  respuesta de los endpoints de estado. Nunca es un delta. */
export interface EstadoCargaDto {
    remesaId: number;
    /** Crece con cada escritura. 0 = remesa heredada, sin fila de progreso. */
    rev: number;
    numeroRemesa: string;
    nombre: string;
    empresaId: number;
    /** Categoría de la remesa (DEUDORES, PAGOS, …). */
    tipo: string;
    usuarioId: number | null;
    /** 'Sistema' si la remesa no tiene creador. */
    usuarioNombre: string;

    estadoProceso: EstadoProcesoRemesa;
    fase: FaseCarga | string;
    subfase: string | null;
    /** Encolada y sin terminar. Lo calcula el backend; el cliente no lo deduce de `fase`. */
    enCurso: boolean;
    /** FINALIZADA o FALLIDA. */
    terminal: boolean;
    /** null mientras `terminal` sea false. */
    resultado: ResultadoCarga | null;

    /** Entero 0-100. Nunca 100 si `terminal` es false. */
    progreso: number;
    /** 0 = no se sabe (la UI muestra barra indeterminada). */
    totalEsperado: number;
    procesadas: number;
    ok: number;
    err: number;
    descartadas: number;
    advertencias: number;
    /** Fase B. null en la A. */
    nuevos: number | null;
    actualizados: number | null;

    /** Motivo, cuando `resultado` es FALLIDA. */
    error: string | null;
    /** Motivo, cuando `resultado` es CON_ADVERTENCIAS. */
    errorPostProceso: string | null;
    intentos: number;

    /** Fechas en ISO 8601 (UTC), armadas con `toISOString()`. */
    encoladaAt: string | null;
    startedAt: string | null;
    heartbeatAt: string | null;
    finishedAt: string | null;
    /** finishedAt − startedAt. null si no terminó o si es heredada. */
    duracionMs: number | null;
    /** Hora del servidor (ISO 8601, UTC) al armar este DTO. Sirve para medir la edad de
     *  `heartbeatAt` sin depender del reloj del navegador. (Agregado tras la auditoría, §8.13.) */
    servidorAhora: string;

    /** @deprecated Alias para las pestañas que quedaron abiertas con el frontend anterior.
     *  El código nuevo NO los lee. Se quitan en la Fase C. */
    okFilas: number;      // = ok
    errFilas: number;     // = err
    totalFilas: number;   // = terminal ? procesadas : totalEsperado
    durationMs: number | null; // = duracionMs
}
```

#### 8.4.2 Eventos de socket

Namespace `/rt`, igual que hoy. Los tres eventos llevan un `EstadoCargaDto` completo.

| Evento | Cuándo se emite | Lo que garantiza el payload |
|---|---|---|
| `import:progreso` | Al encolar (`fase` EN_COLA); después de cada lote persistido (`fase` PROCESANDO); al entrar al post-proceso (`fase` POST_PROCESO) | `enCurso: true`, `terminal: false`, `progreso <= 99` |
| `import:iniciada` | Cuando el worker toma el job. Una vez por intento | `fase: 'PROCESANDO'`, `procesadas: 0`, `intentos >= 1` |
| `import:finalizada` | **Exactamente una vez** por intento, después de persistir el estado terminal | `terminal: true`, `enCurso: false`, `resultado != null`, `finishedAt != null`; `error` si FALLIDA; `errorPostProceso` si CON_ADVERTENCIAS |

**Destinatarios.** Una **sola** emisión a la unión de `user:{usuarioId}` (si la remesa tiene dueño) y
`admin:importaciones`: `server.to([...salas]).emit(...)`. Socket.IO entrega una vez a cada socket
aunque esté en las dos salas, así que el admin que lanzó la carga deja de recibir todo duplicado.

**Lo que el cliente puede asumir y lo que no:**

1. Cada evento es una foto completa. Con cualquiera de los tres alcanza para dibujar la carga, aunque
   sea la primera noticia que se tiene de esa remesa.
2. `rev` es estrictamente creciente por remesa, y es el mismo contador para HTTP y socket. Un estado
   con `rev` menor al que ya se tiene se descarta.
3. El estado se persiste **antes** de emitirse. Un `GET` hecho después de recibir un evento nunca
   devuelve algo más viejo que ese evento.
4. Un evento **puede perderse o llegar repetido**. No hay reintento ni acuse. Por eso el cliente
   re-hidrata por HTTP (§8.8.3).
5. Si el estado terminal no se pudo persistir, `import:finalizada` no se emite.

Ejemplo de `import:finalizada` de una carga que falló antes del primer lote:

```json
{
  "remesaId": 141, "rev": 3, "numeroRemesa": "00141", "nombre": "Telecom septiembre", "empresaId": 10,
  "tipo": "DEUDORES", "usuarioId": 3, "usuarioNombre": "Maxi",
  "estadoProceso": "FALLIDA", "fase": "TERMINADA", "subfase": null,
  "enCurso": false, "terminal": true, "resultado": "FALLIDA",
  "progreso": 0, "totalEsperado": 14466, "procesadas": 0, "ok": 0, "err": 0,
  "descartadas": 0, "advertencias": 0, "nuevos": null, "actualizados": null,
  "error": "La plantilla no tiene configurado el estado inicial de situación/gestión. Edita la plantilla y completá los campos.",
  "errorPostProceso": null, "intentos": 1,
  "encoladaAt": "2026-10-05T14:02:11.120Z", "startedAt": "2026-10-05T14:02:11.480Z",
  "heartbeatAt": "2026-10-05T14:02:11.480Z", "finishedAt": "2026-10-05T14:02:11.530Z", "duracionMs": 50,
  "okFilas": 0, "errFilas": 0, "totalFilas": 0, "durationMs": 50
}
```

#### 8.4.3 HTTP

Todo bajo `/api`, con el permiso de clase del controller (`importacion.ver_historial`,
`imports.controller.ts:28`) más el que se indica. **No se agrega ningún permiso**: nada que declarar en
el catálogo.

| Método y ruta | Permiso extra | Respuesta | Errores |
|---|---|---|---|
| `GET /import/remesas/:id/progreso` **(nuevo)** | — | `200` `EstadoCargaDto` | `404` si la remesa no existe |
| `GET /import/en-curso` | — | `200` `EstadoCargaDto[]`, ordenado por `encoladaAt` ascendente (la que está corriendo, primero). Sin `importacion.ver_progreso_otros` solo las propias | — |
| `GET /import/remesas/:id` | — | Lo de hoy **más** `carga: EstadoCargaDto`. `duracionMs` pasa a ser `carga.duracionMs`. `jobimport` queda siempre en `null` (se conserva la clave para las pestañas viejas) | `404` |
| `POST /import/ejecutar/:id` | `importacion.ejecutar` | `201` `{ message: string, remesaId: number, carga: EstadoCargaDto }` con `carga.fase === 'EN_COLA'` | `404`; `400` la vista previa no encontró filas; `409` ya fue confirmada; `409` el usuario ya tiene una en curso; `503` no se pudo encolar (la remesa **vuelve a borrador**: reintentar funciona, ver §8.13) |
| `POST /import/validar/:id` | `importacion.ejecutar` | Sin cambios | **Nuevo** `409` si la remesa está en curso o es terminal |
| `POST /import/remesas` | — | Sin cambios | Sin cambios |
| `DELETE /import/remesas/:id` | `importacion.eliminar` | Sin cambios. Una carga **en cola que todavía no arrancó** se aborta: se saca su job de la cola y se borra (§8.13) | `400` si ya arrancó y no terminó, o si su job está activo o no se pudo sacar de la cola |

El endpoint nuevo es liviano a propósito (una lectura por PK con su fila de progreso): es el que
consultan los hooks cuando hacen polling. `GET /import/remesas/:id` sigue siendo el de la pantalla de
detalle, con empresa, plantilla y política.

Los errores van como hoy, con el mensaje en `message` (el frontend ya lo muestra con `notify.error`).
Textos en §8.5.3.

#### 8.4.4 Compatibilidad durante el deploy

- **Backend nuevo con pestañas viejas** (van a existir: la gente deja la pestaña abierta días). Los
  alias `okFilas` / `errFilas` / `totalFilas` / `durationMs`, más `tipo`, `usuarioNombre`,
  `estadoProceso` y `progreso` — que no cambian de nombre —, cubren todo lo que leen los handlers de
  hoy (`NotificacionesContext.tsx:134-175`, `ImportDetail.tsx:215-235`) y `ImportEnCursoItem`. El
  `import:progreso` de EN_COLA llega antes que el `import:iniciada`; el handler viejo lo ignora porque
  no conoce la remesa.
- **Frontend nuevo con backend viejo. No se soporta.** `GET …/progreso` daría 404 y los eventos
  llegarían con la forma vieja (sin `rev`, sin `terminal`). Por eso el orden de deploy de §8.6 es
  obligatorio y no una prolijidad. Como defensa, el frontend descarta cualquier payload que no pase
  `esEstadoCarga` (§8.8.1): un evento con forma vieja no puede corromper el estado, simplemente se
  ignora.

### 8.5 Backend — lógica crítica

#### 8.5.1 Un solo escritor durante el job: `ProgresoTracker`

Clase común (no un provider de Nest), en `backend/src/modules/imports/progreso/progreso-tracker.ts`.
Se instancia dentro de `processImportJob` con lo que el service ya tiene inyectado. **No se agrega
ninguna dependencia al constructor de `ImportService`**: hay 12 llamadas `new ImportService(…)` con 9
argumentos posicionales repartidas en 5 specs, y `isolatedModules` hace que un argumento de menos no
dé error de compilación sino un `undefined` en runtime.

```ts
export interface CargaInfo {          // lo que no cambia durante el job
    remesaId: number; numeroRemesa: string; nombre: string; empresaId: number;
    tipo: string; usuarioId: number | null; usuarioNombre: string;
    /** remesa.totalFilas al cargar la remesa: el total de la vista previa. */
    totalFilasVistaPrevia: number;
}

export class ProgresoTracker {
    constructor(
        deps: { prisma: PrismaService; realtime: RealtimeService; logger: Logger },
        info: CargaInfo,
        previa: import_progreso | null,       // la fila tal como estaba al tomar el job
    );
    /** Espejo en memoria de lo último que se persistió. Es lo que se emite. */
    get estado(): EstadoCargaDto;

    iniciar(jobId: string | undefined): Promise<void>;        // → import:iniciada
    fijarTotalEsperado(n: number): void;                      // memoria; viaja en la próxima escritura
    sumarAdvertencias(n: number): void;                       // ídem
    lote(c: { ok: number; err: number; descartadas: number }): Promise<void>;   // → import:progreso
    entrarEnPostProceso(): Promise<void>;                     // → import:progreso
    finalizar(c: { ok: number; err: number; descartadas: number; errorPostProceso: string | null }): Promise<EstadoCargaDto>; // → import:finalizada
    fallar(error: unknown, c: { ok: number; err: number; descartadas: number }): Promise<EstadoCargaDto>;                     // → import:finalizada
}
```

Reglas del tracker:

1. **Cada método que escribe hace un único `prisma.remesa.update`** con la fila de progreso anidada
   (`progreso: { upsert: { create, update } }`). Remesa y progreso cambian juntos o no cambia ninguno.
   El `upsert` hace que funcione igual si la fila no existe (job encolado por el código viejo, ver
   §8.6).
2. `rev` se incrementa en la base (`{ increment: 1 }`; `1` en el `create`). El tracker toma el valor
   que devuelve el `update` (`select: { progreso: { select: { rev: true } } }`); si el `update` no lo
   devuelve, usa el suyo más uno. Ese respaldo existe para que los mocks de los specs actuales, que
   devuelven `{}`, sigan sirviendo.
3. Toda escritura pone `heartbeatAt = ahora` y `porcentaje = calcularPorcentaje(…)`.
4. **Persistir primero, emitir después.** La emisión va en `try/catch` y un fallo es un `warn`: el
   socket nunca tumba una carga.
5. `lote` y `entrarEnPostProceso` **dejan pasar** el error de la base: si no se puede escribir el
   progreso tampoco se van a poder escribir las filas, y es mejor fallar en ese lote que seguir a ciegas.
6. `finalizar` y `fallar` son idempotentes (bandera `terminado`). Si `fallar` se llama con la carga ya
   terminada, no escribe ni emite: deja un `error` en el log y nada más.
7. `fallar` **nunca tira**. Si su `update` falla, lo loguea con stack y **no emite** (garantía 5 de
   §8.4.2). La carga queda en PROCESANDO: es exactamente el caso que cubre el reaper de la Fase B.

Qué escribe cada método:

| Método | En `remesa` | En `import_progreso` |
|---|---|---|
| `iniciar` | `estadoProceso: PROCESANDO`, `okFilas: 0`, `errFilas: 0` | `fase: PROCESANDO`, contadores y `advertencias` en 0, `resultado`/`error`/`errorPostProceso`/`finishedAt` en null, `startedAt: ahora`, `intentos: +1`, `jobId`, `totalEsperado`, y `encoladaAt: ahora` **solo si estaba en null** |
| `lote` | `okFilas`, `errFilas` — **no `totalFilas`** (#9) | `procesadas = ok + err`, `ok`, `err`, `descartadas`, `advertencias`, `totalEsperado` |
| `entrarEnPostProceso` | — | `fase: POST_PROCESO` |
| `finalizar` | `estadoProceso: FINALIZADA`, `totalFilas = procesadas`, `okFilas`, `errFilas` | `fase: TERMINADA`, `resultado`, `errorPostProceso`, contadores finales, `porcentaje: 100`, `finishedAt: ahora` |
| `fallar` | `estadoProceso: FALLIDA`, `okFilas`, `errFilas` (los **reales** hasta el corte) | `fase: TERMINADA`, `resultado: FALLIDA`, `error` (≤ 4000 caracteres), contadores, `finishedAt: ahora` |

`totalEsperado` en `iniciar`: el de la fila previa si es mayor que 0; si no, `totalFilasVistaPrevia`.
Si la fila previa ya tenía `startedAt`, es una re-ejecución: `warn` con el número de intento.

#### 8.5.2 Alta y vista previa

`createRemesa` (`imports.service.ts:623`):

- Recibe el usuario: `imports.controller.ts:198-204` pasa `user.sub` (el parámetro `usuarioCreadorId`
  ya existe). Los borradores dejan de ser de "Sistema" y su dueño puede borrarlos.
- Crea la fila de progreso junto con la remesa, agregando `progreso: { create: { fase: 'BORRADOR' } }`
  al objeto `comun` (`:735-747`). Así entra en los tres `create` (`:823-832`, `:846-848`, `:852-854`)
  sin tocarlos, y sigue siendo una sola escritura atómica.
- `crearRemesaConNumeroSeguro` (`:869-894`) interpreta cualquier `P2002` como "número de remesa
  repetido" y reintenta con sufijo. Ahora un `P2002` también puede venir de la PK de una fila de
  progreso huérfana (§8.2), y reintentar con otro número no lo arregla. Regla: **si `e.meta?.target`
  viene informado y no nombra a `numeroRemesa`, relanzar sin reintentar.** Escrita así, en negativo,
  porque el spec actual simula el choque sin `meta` (`multiclaves-wiring.spec.ts:17-22`) y tiene que
  seguir reintentando. *No verificado:* el valor exacto de `meta.target` que da MySQL para una PK;
  confirmarlo al implementar.

`validateRemesa` (`:958`):

- **Guarda de estado (#20).** Antes de leer el archivo: si `estadoProceso ∈ {PROCESANDO, FINALIZADA,
  FALLIDA}` o la fila tiene `encoladaAt`, `409` "Esta importación ya fue confirmada: no se puede
  volver a validar." Escribirla **en negativo**, así: las fixtures de los specs actuales no traen
  `estadoProceso` y una guarda en positivo los rompería.
- **La hoja (#19).** En `:1381` y en `previewAccionesImpacto` (`:1624`): `hoja: hoja ?? remesa.hoja ??
  undefined`. Sin esto, el total de la vista previa puede ser el de otra hoja y la guarda de "sin
  filas" de §8.5.3 bloquearía una carga legítima.
- **MULTIRREGISTRO (#10).** Antes del `return` de `:1019`, el mismo `update` que hacen las otras
  ramas: `estadoProceso: 'VALIDANDO', totalFilas: filas.length, okFilas: filas.length, errFilas: 0`.
- **Total esperado.** Los cuatro `update` (`:1081-1084`, `:1291-1299`, `:1566-1574` y el nuevo de
  MULTIRREGISTRO) agregan `progreso: { upsert: { create: { fase: 'BORRADOR', totalEsperado },
  update: { totalEsperado } } }`. No incrementa `rev`: un borrador no se transmite.

#### 8.5.3 Encolado: `executeRemesa` (`:1752-1807`)

```
remesa = buscar (404 / 400 como hoy)
log "intent"
transacción:
    1. si hay usuarioId:  SELECT id FROM usuario WHERE id = ? FOR UPDATE          ← mutex por usuario
    2. fila = SELECT r.estadoProceso, r.totalFilas, p.encoladaAt
              FROM remesa r LEFT JOIN import_progreso p ON p.remesaId = r.id
              WHERE r.id = ? FOR UPDATE
    3. si fila.estadoProceso ∉ {PENDIENTE, VALIDANDO}  o  fila.encoladaAt != null   → 409 (a)
    4. si fila.estadoProceso == VALIDANDO  y  fila.totalFilas == 0                  → 400 (b)
    5. si hay usuarioId:
         otras = SELECT p.remesaId FROM import_progreso p JOIN remesa r ON r.id = p.remesaId
                 WHERE r.usuarioCreadorId = ? AND p.encoladaAt IS NOT NULL AND p.finishedAt IS NULL
         si hay alguna                                                              → 409 (c)
    6. remesa.update: estadoProceso PENDIENTE, usuarioCreadorId, okFilas 0, errFilas 0,
         progreso.upsert → fase EN_COLA, encoladaAt ahora, totalEsperado = fila.totalFilas,
                           contadores en 0, resultado/error/finishedAt en null, rev +1
encolar el job (igual que hoy, con _ctx)
    si falla: volver la remesa a borrador (estadoProceso el que tenía, fase BORRADOR,
              encoladaAt null, rev +1), sin emitir nada, log error con stack        → 503 (d)
guardar job.id en import_progreso.jobId (update aparte; si falla, warn)
emitir import:progreso (EN_COLA) — sin tirar
log "done" con ms y jobId
devolver { message, remesaId, carga }
```

Textos: (a) "Esta importación ya fue confirmada." · (b) "La vista previa no encontró filas para
importar. Revisá el archivo y el filtro de la plantilla." · (c) "Ya tenés una importación en curso.
Esperá a que termine antes de iniciar otra." (el de hoy) · (d) "No se pudo iniciar la importación: la
cola de trabajos no responde. Probá de nuevo en unos minutos."

Por qué así:

- **El mutex es la fila del usuario**, no un rango de `remesa` como hoy (`:1769-1774`). Dos confirmaciones
  simultáneas del mismo usuario se ordenan sin depender de qué gap locks toma MySQL.
- **El paso 3 es la idempotencia**: un doble clic o una pestaña vieja no encola dos veces ni
  re-ejecuta una carga terminada (#20).
- **El paso 4** es el respaldo del botón deshabilitado (#4). Solo aplica a VALIDANDO: una remesa en
  PENDIENTE no pasó por la vista previa y su total no se conoce, así que se deja pasar y el worker la
  termina como `SIN_FILAS` si corresponde.
- **Poner `okFilas`/`errFilas` en 0 al confirmar** es la mitad del arreglo de #5: desde ese momento
  los contadores de la remesa dejan de ser los de la muestra de 50 filas.
- **La compensación (#23)** evita que un Redis caído deje al usuario bloqueado. El diseño original
  marcaba la remesa FALLIDA; la auditoría mostró que así el "Probá de nuevo" del mensaje era falso
  (reintentar daba 409 y había que volver a subir el archivo). Quedó como **vuelta a borrador**.

Queda una ventana: si el proceso muere entre el commit y el `queue.add`, la carga queda EN_COLA sin
job. El diseño original decía que era "la misma que existe hoy"; no lo era, porque al bloquear el
borrado de las cargas en cola (#24) se sacaba la única salida que tenía el usuario. Se resolvió en la
propia Fase A: una carga en cola que no arrancó se puede borrar (§8.13). El reaper de la Fase B
sigue haciendo falta para la carga que **ya arrancó** y quedó colgada.

#### 8.5.4 Worker: `processImportJob` (`:1850-2396`)

Cambia el manejo del estado, no el recorrido de filas.

```
remesa = buscar con plantilla, usuarioCreador y progreso      (si no existe: throw, como hoy)
tracker = new ProgresoTracker(…, info, remesa.progreso)
t0
try:
    tracker.iniciar(job.id)                 ← ANTES de cualquier validación
    processor = getProcessor(categoria)
    validar defaults de la plantilla (:1887-1892), armar ctx …            (igual que hoy)
    importerror.deleteMany                                                (igual que hoy)

    por cada lote (processBatch, :2020-2103):
        … procesar filas, insertar importerror …                          (igual que hoy)
        tracker.lote({ ok, err, descartadas })        ← reemplaza :2091-2094 y :2098-2102
        job.updateProgress(…)                                             (se mantiene)

    en las ramas pre-parseadas (MULTIRREGISTRO, MULTIARCHIVO, MULTICLAVES), apenas se parsea:
        tracker.fijarTotalEsperado(filas.length)
        tracker.sumarAdvertencias(cantidad REAL de advertencias o avisos)
        si se truncó a 500: una fila más en importerror
            "[parseo] Se omitieron N advertencias más (se guardan las primeras 500)."

    errorPostProceso = null
    si el processor tiene afterAll:
        tracker.entrarEnPostProceso()
        t1; log "Post-proceso remesa=… categoria=… iniciado"
        try:    processor.afterAll(ctx);  log "… terminó en Xms"
        catch:  log error CON STACK
                errorPostProceso = mensaje (≤ 4000)
                importerror.create { rowNumber: 0, rawRow: [], errorMsg: "[post-proceso] " + mensaje }
                tracker.sumarAdvertencias(1)

    estado = tracker.finalizar({ ok, err, descartadas, errorPostProceso })
    notificar según estado.resultado (§8.5.5)      ← en try/catch, como hoy
    log "done" con resultado y ms
    return { total, ok, err }
catch (error):
    estado = tracker.fallar(error, { ok, err, descartadas })
    notificar FALLIDA (§8.5.5)                     ← en try/catch
    throw error                                    ← para que BullMQ y la auditoría lo vean
```

Puntos que no son obvios:

- **`iniciar` va primero**, antes de `getProcessor` y de la validación de defaults. Hoy una plantilla
  sin estado inicial falla *antes* de emitir `import:iniciada` y la remesa nunca pasa por PROCESANDO.
  Con este orden todo job emite `iniciada` y después `finalizada`, y `fallar` siempre tiene una fila
  donde dejar el motivo.
- **`descartadas`** hoy es una variable local de la rama genérica (`:2242`). Hay que subirla al
  alcance de la función para que `lote`, `finalizar` y `fallar` la vean.
- **Después de `finalizar` nada puede tirar hacia el `catch`.** El `job.updateProgress` final
  (`:2296`) se mueve antes de `finalizar` o se envuelve en `try/catch`: si tirara después, el `catch`
  intentaría marcar FALLIDA una carga que terminó bien. El tracker lo impide igual (regla 6), pero no
  hay que depender de eso.
- **El `ProgressEmitter` deja de usarse acá.** Se saca el import (`:24`) y el bloque `:1992-2013`. El
  archivo `utils/progress-emitter.ts` **no se borra**: lo usa consolidación. En la Fase A cada
  escritura emite un evento, sin throttle: son a lo sumo uno por lote. El throttle vuelve en la Fase
  B, dentro del tracker, cuando haya reportes dentro del lote.
- **Una FALLIDA a mitad de camino conserva los contadores reales.** Las filas procesadas antes del
  corte están en la base (no hay rollback), y la pantalla lo tiene que decir.
- **El post-proceso que falla ya no es invisible** (#3), pero la carga **no** pasa a FALLIDA: las
  filas están cargadas y eso es verdad. Lo que cambia es que queda escrito, con motivo, en tres
  lugares: `import_progreso.errorPostProceso`, una fila `[post-proceso]` en `importerror` y la
  notificación.
- **El log por fase del post-proceso** (`iniciado` / `terminó en Xms`) es lo que faltaba para medir
  §3.5 y decidir §5.3.

#### 8.5.5 Notificaciones según el resultado (#18, #21)

Sin tocar el enum `TipoNotificacion` (sería un `ALTER` sobre `notificacion`). El resultado viaja en
`payload.resultado` y el frontend elige ícono y color con eso.

| `resultado` | `tipo` | Título | Mensaje |
|---|---|---|---|
| `OK` | `IMPORTACION_FINALIZADA` | Importación finalizada | Se procesaron {ok} filas correctamente. |
| `CON_ERRORES`, `ok > 0` | `IMPORTACION_FINALIZADA` | Importación finalizada con errores | Se cargaron {ok} filas y {err} dieron error. |
| `CON_ERRORES`, `ok == 0` | `IMPORTACION_ERROR` | Importación sin filas cargadas | Las {err} filas del archivo dieron error: no se cargó ninguna. |
| `SIN_FILAS` | `IMPORTACION_FINALIZADA` | Importación sin filas | El archivo no tenía filas para procesar. *(si `descartadas > 0`:)* El filtro de la plantilla descartó las {descartadas} filas. |
| `CON_ADVERTENCIAS` | `IMPORTACION_FINALIZADA` | Importación finalizada con advertencias | Las filas se cargaron ({ok} bien, {err} con error) pero el post-proceso no terminó: {primera línea del motivo}. |
| `FALLIDA` | `IMPORTACION_ERROR` | Importación fallida | {primera línea del motivo}. *(si `procesadas > 0`:)* Se habían procesado {procesadas} filas. |

- "Primera línea del motivo": la primera línea no vacía del mensaje de error, recortada a 300
  caracteres. El mensaje completo va a `import_progreso.error` (≤ 4000). El `mensaje` de la
  notificación **nunca supera los 1000** de la columna (#21).
- `payload`: `{ resultado, ok, err, procesadas, descartadas, advertencias, durationMs, tipoImport,
  okFilas, errFilas, totalFilas }` (los tres últimos, por compatibilidad).
- `rutaAccion`, `destinatarioPrincipalId` e `incluirUsuariosConPermiso` quedan como hoy
  (`:2338-2340`).
- Sin dueño (`ownerId` null) no hay a quién notificar, como hoy; se deja un `warn`. El estado se
  persiste y se emite igual a `admin:importaciones`.
- Los textos salen de una función pura (`textoNotificacion(estado)`), con su test.

#### 8.5.6 Un processor por carga (#15)

`processor-registry.ts:20-37` construye los once processors una vez y los reusa. Guardan estado en
campos de instancia (deudores tocados, contadores, cachés) y lo limpian con un `reset()` al final de
`afterAll`. Si una carga falla o su `afterAll` tira, el `reset()` no corre y la carga siguiente de esa
categoría arrastra el estado de la anterior.

Cambio: el registry guarda **fábricas** (`Map<string, () => ICategoryProcessor>`) y `getProcessor`
devuelve una instancia nueva en cada llamada. `processImportJob` la pide una sola vez por job
(`:1879`), así que cada carga arranca limpia sin tocar ningún processor. `getSupportedCategories` no
cambia. Los constructores no reciben argumentos ni hacen IO.

#### 8.5.7 Lecturas y borrado

- **`progreso(remesaId)`** (nuevo, para `GET /import/remesas/:id/progreso`): una lectura de la remesa
  con su fila y `usuarioCreador { id, nombre }`; `404` (con `warn`) si no existe; devuelve
  `armarEstadoCarga(remesa, remesa.progreso)`.
- **`listarEnCurso`** (`:1810-1847`): el `where` pasa a ser
  `{ progreso: { is: { encoladaAt: { not: null }, finishedAt: null } } }`, más
  `usuarioCreadorId: user.sub` si no tiene `importacion.ver_progreso_otros`. Ordena por
  `progreso.encoladaAt` ascendente. Devuelve `EstadoCargaDto[]`. Ya no incluye `jobimport`.
- **`status`** (`:2399-2450`): deja de incluir `jobimport`, incluye `progreso`, agrega `carga`,
  calcula `duracionMs` desde `carga` y devuelve `jobimport: null`.
- **`deleteRemesa`** (`:2588`): el bloqueo de `:2592` pasa de "está PROCESANDO" a "está en curso"
  (#24), con la excepción que agregó la auditoría (§8.13): una carga en cola que no arrancó se
  aborta sacando su job. Para eso el `findUnique` de `:2589` incluye `progreso`. Y **después** de cada una de las dos
  transacciones de borrado (`:2642-2652` y `:2699-2815`), ya confirmadas,
  `notificacion.deleteMany({ where: { entidadTipo: 'REMESA', entidadId: remesaId } })` (#12): una
  notificación no sobrevive a su remesa. Va afuera de la transacción y en `try/catch` con `warn`: si
  la limpieza falla, la remesa ya se borró y eso no se deshace por una notificación. (Además los
  specs de borrado actuales mockean un `tx` sin `notificacion`.) La fila de progreso se va sola por
  el cascade.

`armarEstadoCarga(remesa, fila | null)` es una función pura en
`backend/src/modules/imports/progreso/estado-carga.ts`, junto con `calcularPorcentaje`,
`clasificarResultado` y `textoNotificacion`. La usan las tres lecturas **y** el tracker: HTTP y socket
arman el DTO con el mismo código.

#### 8.5.8 Logging

Según la política del `CLAUDE.md`. Con `new Logger(...)`, sin `console.log`.

| Dónde | Nivel | Qué |
|---|---|---|
| `executeRemesa` | `log` ×2 | intent (`remesa`, `usuario`, `categoria`) y done (`job`, `en Xms`) |
| 409 / 400 de `executeRemesa` y `validateRemesa`, 404 de `progreso` | `warn` | motivo de negocio |
| Fallo al encolar | `error` con stack | — |
| `tracker.iniciar` con intento > 1 | `warn` | "Re-ejecución de la remesa X (intento N): el progreso se reinicia" |
| Post-proceso | `log` ×2 | iniciado / terminó `en Xms` |
| Post-proceso que tira | `error` con stack | — |
| Fin del job | `log` | `resultado`, contadores, `en Xms` |
| Emisión por socket que falla | `warn` | — |
| `tracker.fallar` que no puede escribir | `error` con stack | — |

No se agrega a ningún log la fila cruda (`rawRow`) ni el documento del deudor.

### 8.6 Deploy con cargas en vuelo y con filas viejas

**Antes de desplegar** (lo corre quien orquesta; son lecturas, pero en prod, y el architect no las
corrió):

1. **Que la base de prod esté sincronizada con el schema que hoy tiene desplegado.** El `db push`
   ejecuta *todo* el diff pendiente, no solo la tabla nueva: si hay drift latente, sale ahora y puede
   traer un aviso de pérdida de datos que no es de este cambio (pasó el 28/08). Con la imagen actual:
   `docker compose -f docker-compose.prod.yml run --rm backend npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script`
   → tiene que decir `This is an empty migration`.
2. **Que no haya ninguna carga corriendo ni en cola.**
   `SELECT id, categoria, estadoProceso, usuarioCreadorId FROM remesa WHERE estadoProceso = 'PROCESANDO' OR (estadoProceso = 'PENDIENTE' AND usuarioCreadorId IS NOT NULL)`
   → vacío. Si el reinicio del contenedor agarra una carga a la mitad y BullMQ la da por perdida sin
   re-ejecutarla, la remesa queda en PROCESANDO **sin fila de progreso**: no aparece en curso y no
   bloquea al usuario, pero tampoco se puede borrar desde la pantalla. Arreglarla es una escritura en
   prod.

**Orden: primero el backend, después el frontend.** Los dos workflows se disparan por separado según
la carpeta tocada (`deploy-backend.yml` con `backend/**`, `deploy-frontend.yml` con `frontend/**`). Si
entran en el mismo push, el frontend (S3) llega varios minutos antes que el backend (build + `db push`
+ reinicio) y durante ese rato el wizard nuevo consulta un endpoint que todavía no existe. Por eso van
en **dos commits** y se pushea primero el del backend, se espera el workflow en verde y recién ahí el
del frontend. El backend nuevo es compatible con el frontend viejo (§8.4.4), así que ese orden no
rompe nada.

**Qué pasa con cada fila que ya existe:**

| Situación | Después del deploy |
|---|---|
| Remesa 93 (PENDIENTE, sin fila) y 98 (VALIDANDO, sin fila) | Dejan de figurar en "Importaciones en curso" **sin ninguna escritura**. Siguen en el Historial. El detalle de la 98 ya no dice "100% completado". Ningún job las toca |
| Remesas FINALIZADA / FALLIDA anteriores | Se muestran con el estado sintetizado (§8.3): resultado deducido, sin duración ni motivo |
| Borrador creado antes del deploy y confirmado después | `executeRemesa` le crea la fila (upsert). Funciona normal |
| Job encolado por el código viejo que toma el worker nuevo | `tracker.iniciar` le crea la fila. Figura en curso desde que arranca; en los segundos previos no figura ni cuenta para el bloqueo por usuario |
| Carga interrumpida por el reinicio y re-ejecutada por BullMQ | Igual que el caso anterior: arranca de cero con `intentos = 1` |

**Volver atrás no es gratis.** Si se redespliega la imagen anterior, su `db push` ve una tabla que su
schema no conoce y quiere borrarla; con filas adentro Prisma pide `--accept-data-loss` y el deploy se
frena. Es lo mismo que pasa con cualquier tabla nueva. Ante un problema conviene corregir hacia
adelante.

### 8.7 Fallos silenciosos

Lo que este diseño puede perder sin avisar, y cómo se nota.

| Qué puede pasar en silencio | Cómo queda a la vista |
|---|---|
| Se pierde un evento de socket | Re-hidratación al conectar, al volver a la pestaña y por polling (§8.8.3). Si el socket está caído, la barra superior lo dice |
| El post-proceso falla y la carga igual "finaliza" | `resultado = CON_ADVERTENCIAS` con el motivo en el resumen del wizard, en el detalle, en la tabla de errores (`[post-proceso]`) y en la notificación |
| Una FALLIDA sin notificación porque el mensaje no entra en la columna | El mensaje se recorta; el completo queda en `import_progreso.error` |
| El filtro de la plantilla descarta todas las filas | **Antes de ejecutar:** la vista previa ya informa las descartadas y, con total 0, el botón queda deshabilitado con el motivo. **Si igual se ejecuta:** `SIN_FILAS` con la cantidad descartada |
| Una FALLIDA mostrada como éxito con los números de la muestra | La pantalla se dibuja con `resultado`, no con los contadores; y los contadores de la muestra se borran al confirmar |
| La vista previa era de otra hoja del Excel (#19) | Se corrige: la vista previa lee la misma hoja que la ejecución |
| Una carga dividida se corta en la remesa k | El resumen lista las remesas que **no se ejecutaron**, con el motivo |
| Advertencias de parseo recortadas a 500 | Una fila más en la tabla dice cuántas se omitieron; el contador `advertencias` guarda el total real |
| Estado de una carga anterior metido en la siguiente (#15) | No puede pasar: cada carga tiene su propia instancia del processor |
| BullMQ re-ejecuta la carga desde cero | `intentos > 1`: `warn` en el log y aviso en el detalle ("esta carga se reinició") |
| El worker muere y la carga queda en PROCESANDO | **No se arregla en la Fase A.** La pantalla muestra hace cuánto no hay novedades (`heartbeatAt`) en vez de un porcentaje quieto. Fallarla sola es la Fase B |
| Una remesa heredada sin fila parece "sin datos" | Es a propósito y está documentado (§8.3): no se inventan duración ni motivo |
| Un wipe con `TRUNCATE` que se olvida de la tabla nueva | Falla el alta de la primera remesa, fuerte; consulta de control en §8.2 |
| El polling falla y nadie se entera | Las consultas de fondo no muestran toast (si no, offline sería un toast cada 10 s), pero el indicador de conexión sí; y un 401 manda al login, como cualquier otro pedido |
| Un permiso nuevo que nadie puede asignar | No aplica: no se agrega ninguno |
| Algo escrito al disco del contenedor que se pierde en el deploy | No aplica: el estado vive en MySQL |

### 8.8 Frontend

El frontend no tiene tests ni lint. La verificación está en §8.9 y §8.12.

#### 8.8.1 Tipos, API y utilidades

- `frontend/src/types/importProgreso.ts` **(nuevo)**: los tipos de §8.4.1, tal cual.
- `frontend/src/api/imports.ts` **(nuevo)**: `obtenerEstadoCarga(remesaId)` → `GET
  /import/remesas/:id/progreso`; `obtenerCargasEnCurso()` → `GET /import/en-curso`. Las dos con
  `{ silencioso: true }`.
- `frontend/src/api/axios.ts`: declarar `silencioso?: boolean` en `AxiosRequestConfig` (module
  augmentation; nada de `any`).
- `frontend/src/api/setupAxiosInterceptors.ts:14-28`: si `error.config?.silencioso`, no llamar a
  `notifyError`. La promesa se rechaza igual. El 401 → login de `axios.ts:19-32` no se toca.
- `frontend/src/api/notificaciones.ts`: sacar `ImportEnCursoDto` y `obtenerImportsEnCurso` (pasan a
  `api/imports.ts`).
- `frontend/src/utils/estadoCarga.ts` **(nuevo)**, funciones puras que comparten el hook, el contexto
  y los componentes:
  - `esEstadoCarga(valor: unknown): valor is EstadoCargaDto`: `remesaId` y `rev` numéricos,
    `terminal` y `enCurso` booleanos. Todo lo que entra por socket pasa por acá antes de usarse.
  - `fusionarEstadoCarga(actual, nuevo)`: devuelve `nuevo` si `actual` es null o `nuevo.rev >=
    actual.rev`; si no, `actual`. Es lo que impide que una respuesta HTTP vieja pise un evento más
    nuevo.
  - `etiquetaFase(estado)`, `presentarResultado(estado)`, `barraIndeterminada(estado)`,
    `minutosSinNovedades(estado, ahora)` — textos y reglas de §8.8.8.
  - Constantes: `POLL_MS = 10_000`, `POLL_LISTA_MS = 15_000`, `SILENCIO_MS = 30_000`,
    `GRACIA_INDICADOR_MS = 5_000`, `SIN_NOVEDADES_MIN = 5`.

#### 8.8.2 `SocketContext` (`frontend/src/context/SocketContext.tsx`)

Valor del contexto — se **agregan** campos; `socket` y `conectado` siguen estando porque los usan
`ImportDetail` y `ConsolidacionModal.tsx:53`:

```ts
type EstadoConexion = 'sin_sesion' | 'conectando' | 'conectado' | 'reconectando';

interface SocketContextValue {
    socket: Socket | null;
    conectado: boolean;
    estado: EstadoConexion;
    /** Sube en cada `connect`: el primero y cada reconexión. Es el disparador de la re-hidratación. */
    conexiones: number;
    /** Epoch ms desde que se perdió la conexión; null si está conectado. */
    desconectadoDesde: number | null;
}
```

Cambios:

1. **El socket va en `useState`, no en un `ref`** (`:56-59`). Hoy los consumidores no ven el socket
   hasta después del primer `connect`, porque el valor está memoizado por `conectado` (#25).
2. **`auth` como función**: `auth: (cb) => cb({ token: localStorage.getItem('amsa_token') })`. Cada
   intento de conexión usa el token vigente, no el que había al crear el socket (`:30-34`).
3. **Estados.** `connect` → `conectado`, `conexiones + 1`, `desconectadoDesde = null`. `disconnect` y
   `connect_error` → `reconectando`, y `desconectadoDesde = ahora` si estaba en null. Sin token →
   `sin_sesion`.
4. **`io server disconnect`** (el server cerró: token vencido, usuario inactivo o un error en
   `handleConnection`). socket.io no reintenta solo. Entonces:
   - Verificar la sesión con un pedido autenticado y barato: `GET /notificaciones/contador`, silencioso.
   - **401** → no hay nada que hacer acá: el interceptor de `axios.ts:19-32` ya limpia el token y manda
     a `/login`. Es el caso del JWT vencido.
   - **200** → la sesión está bien; el corte fue otra cosa. Reintentar `socket.connect()` con espera
     creciente: 2 s, 5 s, 15 s, 30 s y de ahí siempre 30 s. La espera vuelve a 2 s cuando una conexión
     dura más de 10 s.
   - **Error de red** → reintentar la verificación con la misma espera.
   - Lo mismo ante un `connect_error` con `socket.active === false` (el server rechazó y socket.io
     abandonó).
5. `io client disconnect` (logout, desmontaje) no dispara nada.
6. Sacar los dos `console.log` (`:37`, `:42`).

**Sobre renovar el token:** no hay con qué. El login es por Google y el backend no tiene endpoint de
refresh. La decisión es **pedir re-login**: una sesión vencida termina en `/login`, que es lo que ya
hace hoy cualquier pedido HTTP. Lo nuevo es que el socket muerto lo provoca enseguida, en vez de
quedar mudo hasta el próximo clic. La carga sigue en el servidor; al volver a entrar, la campanita la
muestra con su estado real.

#### 8.8.3 El hook `useEstadoCarga` (`frontend/src/hooks/useEstadoCarga.ts`, nuevo)

Es la pieza que usan el paso "Importando" del wizard y la página de detalle. Firma:
`useEstadoCarga(remesaId: number | null): { estado: EstadoCargaDto | null; cargando: boolean;
noExiste: boolean; refrescar: () => Promise<void> }`.

```
refrescar():
    dto = obtenerEstadoCarga(remesaId)
    ok   → estado = fusionarEstadoCarga(estado, dto);  ultimaNovedad = ahora
    404  → noExiste = true; se corta el polling    (la remesa se borró)
    otro → no tocar nada                  (offline, 5xx: se reintenta en el próximo tick)

al montar o cambiar remesaId   → limpiar estado; refrescar()
eventos import:iniciada / import:progreso / import:finalizada con ese remesaId y que pasen esEstadoCarga
                               → estado = fusionarEstadoCarga(estado, dto);  ultimaNovedad = ahora
cada vez que sube `conexiones` → refrescar()         (primer connect y cada reconexión)
visibilitychange a visible, y evento `online` de window → refrescar()

polling, solo mientras la carga NO sea terminal:
    cada POLL_MS (10 s):
        si document.hidden → nada
        si el socket no está conectado  o  ahora − ultimaNovedad >= SILENCIO_MS (30 s) → refrescar()
    se corta (clearInterval) al llegar a un estado terminal o al desmontar
```

Qué cadencia da eso en la práctica: con el socket **caído**, un pedido cada 10 s; con el socket
**conectado pero callado** (post-proceso largo, parseo de MULTIARCHIVO), uno cada 30 s, porque cada
respuesta renueva `ultimaNovedad`; con eventos llegando, **ninguno**.

- El polling **no** se detiene porque fallen los pedidos por red o por 5xx, ni porque `estado` siga
  en null: se detiene solo en un estado terminal o ante un 404.
- Los handlers del socket se registran con el patrón `ref` para `notify` y demás dependencias
  inestables (ver el loop que ya hubo en `ImportDetail`, `:189-190`).
- Una remesa heredada o terminal: una sola consulta y nada más.

#### 8.8.4 `NotificacionesContext` (`frontend/src/context/NotificacionesContext.tsx`)

La lista de la campanita pasa a ser `EstadoCargaDto[]`. Se mantiene el nombre `importsEnCurso` en el
valor del contexto para no tocar a quien lo consume.

- **Cuándo hidrata** (`contador` + `obtenerCargasEnCurso()`): al montar si hay token; **cuando cambia
  el token** (login sin recargar, #25); cada vez que sube `conexiones`; al volver a la pestaña; con
  `online`; y por polling.
- **Polling de la lista:** solo si hay al menos una carga en la lista. Cada `POLL_LISTA_MS` (15 s), con
  la misma condición que el hook (socket caído, o 30 s sin novedades). Con la lista vacía no se
  consulta: lo que empiece mientras el socket está caído aparece al reconectar.
- **Cómo aplica la respuesta:** la lista del servidor reemplaza a la local, fusionando por `rev`, con
  una excepción: se conservan las cargas locales que llegaron por socket **después** de iniciar el
  pedido (guardar la hora de recepción por remesa). Sin eso, una respuesta lenta borra una carga
  recién encolada.
- **Eventos:** `import:iniciada` e `import:progreso` → **upsert** (agrega la remesa si no estaba: es
  el arreglo de `:156-171`); si el DTO llega con `enCurso: false`, la saca. `import:finalizada` → la
  saca.
- **Toasts:** siguen saliendo solo por `notificacion:nueva`, pero con severidad: `tipo`
  `IMPORTACION_ERROR` → error; si no, `payload.resultado` `CON_ADVERTENCIAS`, `CON_ERRORES` o
  `SIN_FILAS` → warning; el resto → info, como hoy.

#### 8.8.5 Wizard

**`ImportProgress.tsx`** (se reescribe sobre `useEstadoCarga`; deja de leer la lista del contexto).

- Props: `{ remesaId: number; onComplete: (estado: EstadoCargaDto) => void }`.
- `onComplete` se llama **una vez**, cuando `estado.terminal` es true, sea cual sea el resultado y
  aunque todos los contadores sean 0. Se elimina el `return` de `:80`.
- El porcentaje es `estado.progreso` (entero que manda el backend). El frontend **no divide nada**:
  desaparece la cuenta de `:53-54` y con ella el `NaN`.
- Barra indeterminada cuando `barraIndeterminada(estado)`: en cola, en post-proceso, o procesando sin
  total conocido.
- Texto de fase según §8.8.8. Chips: Total (si `totalEsperado > 0`), Procesadas, OK, Errores (si
  `> 0`), Descartadas (si `> 0`).
- Avisos, con `Alert` de MUI y colores del theme:
  - socket no conectado → "Sin conexión en tiempo real. El estado se actualiza cada 10 segundos."
  - `minutosSinNovedades >= 5` → "Sin novedades del servidor hace N min. La carga puede estar en un
    paso largo o haberse interrumpido." (solo en PROCESANDO; en POST_PROCESO el texto de la fase ya
    avisa que tarda)
  - `intentos > 1` → "Esta carga se reinició (intento N)."

**`ImportSummary.tsx`** (se reescribe).

- Props: `{ resultados: EstadoCargaDto[]; noEjecutadas: Array<{ remesaId: number; motivo: string }>;
  onNewImport: () => void }`. Navega con `useNavigate`.
- Encabezado según el **peor** resultado de la lista (orden: FALLIDA, CON_ADVERTENCIAS, CON_ERRORES
  sin ninguna cargada, SIN_FILAS, CON_ERRORES, OK), con título, severidad y detalle de
  `presentarResultado` (§8.8.8). Una FALLIDA es una pantalla de error con el motivo, nunca un tilde
  verde.
- Métricas: suma de `procesadas`, `ok`, `err` y, si hay, `descartadas`. La tasa de éxito solo si
  `procesadas > 0`.
- Si `advertencias > 0`: una línea informativa "N aviso(s) del archivo — ver el detalle".
- Con más de una remesa (carga dividida): una fila por remesa con número, resultado y contadores.
- Si `noEjecutadas` tiene elementos: alerta de error "N remesa(s) de la división **no se ejecutaron**"
  con la lista y el motivo (#22).
- Botones: **"Ver detalle"** → `/historial-importaciones/{remesaId}` (uno por remesa si son varias) y
  **"Ir al historial"** → `/historial-importaciones`. Reemplazan a "Ver errores" (abría la API sin
  token: `:37-46`) y a "Ver remesas" (iba a una ruta que no existe: `ImportWizard.tsx:1033`).

**`ImportWizard.tsx`**.

- `handleImportComplete` (`:463-495`) recibe un `EstadoCargaDto` y lo agrega a `resultados` (reemplaza
  a `finalResult`, `:185`). Si una remesa de la división termina FALLIDA, **sigue con la próxima** —
  es lo que hace hoy—, pero ahora el resumen lo cuenta.
- Si `ejecutarRemesa` de la remesa siguiente tira (`:488-491`): registrar en `noEjecutadas` esa remesa
  **y todas las que quedaban en la cola**, con el mensaje del error, y pasar al resumen.
- "Confirmar e importar" (`:1086-1094`): `disabled` si `previewStats.total === 0` o si ya se está
  enviando (evita el doble clic). Con total 0, una alerta arriba del botón: "El archivo no tiene filas
  para importar." y, si la vista previa informó descartadas, "El filtro de la plantilla descartó las N
  filas."
- El paso 4 (`:1025-1036`) pasa `resultados` y `noEjecutadas`. Se va el `window.location.href =
  "/remesas"`.

#### 8.8.6 Detalle (`frontend/src/pages/ImportDetail.tsx`)

- Usa `useEstadoCarga(Number(id))` para todo lo que se mueve; `GET /import/remesas/:id` queda para lo
  fijo (empresa, plantilla, política). Se va el bloque de handlers propios de `:211-244`.
- Cuando `carga.terminal` pasa de false a true: `fetchAll(true)` una vez, para traer los errores.
- "En progreso" es `carga.enCurso`, no el set de `:98` (que incluye PENDIENTE y VALIDANDO y es lo que
  hacía decir "100% completado" a un borrador). El porcentaje es `carga.progreso` (se va la cuenta de
  `:291-293`).
- Chip de estado: "Borrador" si no está en curso ni es terminal; "En cola" si `fase === 'EN_COLA'`; si
  no, `estadoProceso` como hoy.
- Arriba, según `resultado`: FALLIDA → alerta de error con `carga.error`; CON_ADVERTENCIAS → alerta
  amarilla con `carga.errorPostProceso`; SIN_FILAS → alerta informativa. Mismos avisos de "sin
  novedades" e "intento N" que el wizard.
- **Tabla de errores** (`:606`): se muestra si `errFilas > 0` **o** `carga.advertencias > 0`, y
  `fetchAll` pide los errores con la misma condición (`:198`). Con solo advertencias el título es
  "Avisos de la carga". Las filas `[parseo]`, `[aviso]` y `[post-proceso]` tienen `rowNumber` 0 y
  salen primeras.
- "Fecha de inicio" = `carga.startedAt` (o `createdAt` si es null); "Fecha de finalización" =
  `carga.finishedAt`; "Duración" = `carga.duracionMs`.

#### 8.8.7 Campanita y barra superior

- `NotificacionesPopover.tsx:131-158` e `ImportEnCursoItem.tsx`: el ítem recibe el `EstadoCargaDto`.
  Muestra categoría y número de remesa, usuario, la fase (§8.8.8), barra determinada o indeterminada
  con la misma regla que el wizard, y los chips. Se va el texto crudo de `:90-94`.
- Con el socket caído, una línea al pie de la sección "Importaciones en curso": "Sin conexión en
  tiempo real — actualizando cada 15 s."
- `NotificacionItem.tsx:17-34`: una `IMPORTACION_FINALIZADA` cuyo `payload.resultado` es
  `CON_ADVERTENCIAS`, `CON_ERRORES` o `SIN_FILAS` lleva el ícono de advertencia en vez del tilde
  verde. El resto, por `tipo`, como hoy (incluidas las notificaciones anteriores, que no traen
  `resultado`).
- `ConexionIndicador.tsx` **(nuevo)**, en `AppBar.tsx:136` al lado de la campanita. No muestra nada si
  el estado es `conectado` o `sin_sesion`. Si lleva más de `GRACIA_INDICADOR_MS` (5 s) sin conexión,
  un ícono con tooltip "Sin conexión en tiempo real. Reintentando…". Los 5 s evitan el parpadeo en una
  reconexión normal. Colores de `theme.palette.warning`, nada hardcodeado.
- `frontend/src/hooks/useImportacionesEnCurso.ts`: solo cambia el tipo que devuelve.

#### 8.8.8 Textos

Los mismos en el wizard, el detalle, la campanita y la wiki.

| Fase | Texto | Texto secundario |
|---|---|---|
| `BORRADOR` (en el paso "Importando") | Enviando a la cola… | — |
| `BORRADOR` (en el detalle) | Borrador | Vista previa sin confirmar. No se cargó nada. |
| `EN_COLA` | En cola | Esperando que termine otra importación. |
| `PROCESANDO` | Procesando | — |
| `POST_PROCESO` | Post-proceso | Consolidando y cerrando la carga. Puede tardar varios minutos. |
| otra | el valor de `fase` tal cual | — |

| Resultado | Severidad | Título | Detalle |
|---|---|---|---|
| `OK` | success | Importación exitosa | — |
| `CON_ERRORES`, `ok > 0` | warning | Importación finalizada con filas con error | {err} de {procesadas} filas no se cargaron. Mirá el motivo de cada una en el detalle. |
| `CON_ERRORES`, `ok == 0` | error | No se cargó ninguna fila | Las {err} filas dieron error. |
| `SIN_FILAS` | warning | El archivo no tenía filas para procesar | *(si `descartadas > 0`)* El filtro de la plantilla descartó las {descartadas} filas. |
| `CON_ADVERTENCIAS` | warning | Importación finalizada con advertencias | Las filas se cargaron, pero el post-proceso no terminó: {errorPostProceso}. Los casos pueden haber quedado sin consolidar: volvé a consolidar la remesa desde el Historial o avisá a soporte. |
| `FALLIDA` | error | La importación falló | {error}. *(si `procesadas > 0`)* Las {procesadas} filas procesadas antes del corte **quedaron cargadas**. |
| otro valor | info | Importación finalizada | — |

### 8.9 Plan de pruebas

**Línea de base, medida el 05/10/2026 sobre HEAD `a0675dc`:**

- Backend: `npx jest src/modules/imports src/modules/realtime src/modules/notificaciones` → **36
  suites, 679 tests, todos pasan.**
- Frontend: `npx tsc --noEmit -p tsconfig.json` → **5 errores que ya estaban**: `MappingEditor.tsx`
  (2), `ImportHistory.tsx:423`, `Login.tsx:104`, `theme/components.ts:165`. Importa porque `vite build`
  **no chequea tipos**: `tsc` es la única red de tipos que tiene el frontend, y con una base de 5
  errores conocidos sirve como control.

#### 8.9.1 Specs nuevos de backend

**A. `backend/src/modules/imports/progreso/estado-carga.spec.ts`** — funciones puras.

- `calcularPorcentaje`: 0 de 0 → 0; 500 de 1000 → 50; 1000 de 1000 sin terminar → 99; 1200 de 1000 →
  99; terminada FINALIZADA → 100; FALLIDA con 300 de 1000 → 30. Nunca `NaN`.
- `clasificarResultado`: las cinco filas de §8.3, más la precedencia — post-proceso fallido con
  `err > 0` → `CON_ADVERTENCIAS`; post-proceso fallido con 0 procesadas → `CON_ADVERTENCIAS`;
  `ok = 0, err = 12` → `CON_ERRORES`.
- `armarEstadoCarga` sin fila: las cuatro filas de la tabla de §8.3. En particular la 98 (VALIDANDO,
  912/912) → `enCurso: false`, `progreso: 0`; y la 93 (PENDIENTE, total 0) → `enCurso: false`.
- `armarEstadoCarga` con fila: un borrador recién validado, con `remesa.okFilas = 50` de la muestra →
  `ok: 0`; los cuatro alias; `duracionMs`; fechas en ISO.
- `textoNotificacion`: las seis filas de §8.5.5; un error de 5.000 caracteres en varias líneas →
  mensaje de 1000 o menos, de una sola línea; `SIN_FILAS` con 1.234 descartadas nombra el número.

**B. `backend/src/modules/imports/imports-progreso-eventos.spec.ts`** — el probe de §7 convertido en
spec. `ImportService` real; un `prisma` falso en memoria (una remesa y su fila de progreso, con un
`remesa.update` que aplica la escritura anidada y devuelve lo que pide el `select`); `realtime` y
`notificaciones` que graban las llamadas en orden; `jest.mock('./processors/processor-registry')` con
un processor de mentira, para probar el runner y no una categoría; un CSV de verdad en `os.tmpdir()`.

| # | Caso | Qué tiene que pasar |
|---|---|---|
| 1 | 2.500 filas, lote de 1000, processor con `afterAll` | Eventos, en este orden exacto: `iniciada` (0, PROCESANDO) · `progreso` 40 · `progreso` 80 · `progreso` 99 · `progreso` (POST_PROCESO, 99) · `finalizada` (100, `OK`, `ok` 2500, `procesadas` 2500). Una sola `iniciada` y una sola `finalizada`. `rev` estrictamente creciente. Ningún `progreso` con 100. `totalEsperado` vale 2500 en todas las escrituras. **Ninguna escritura anterior a la final toca `remesa.totalFilas`**; la final lo deja en 2500 |
| 2 | Archivo con solo el encabezado | Empieza con `iniciada` y termina con una `finalizada` con `SIN_FILAS` y `progreso` 100 (en el medio puede haber el `progreso` de POST_PROCESO). Ningún payload trae `NaN`. Notificación "Importación sin filas". Ningún texto dice "0 filas correctamente" |
| 3 | Todas las filas descartadas por `remesa.filtroFilas` | `SIN_FILAS` con `descartadas` igual a la cantidad de filas; el mensaje nombra ese número |
| 4 | DEUDORES con plantilla sin estado inicial; la remesa arranca con `okFilas: 50, errFilas: 0` (la muestra) | `iniciada` y `finalizada` (`FALLIDA`, `error` contiene "estado inicial"). En la base: `estadoProceso: FALLIDA`, `okFilas: 0`, `errFilas: 0`. `processImportJob` rechaza. Notificación `IMPORTACION_ERROR` |
| 5 | Excepción en el segundo lote (p. ej. `job.updateProgress` que rechaza) | Una sola `finalizada`, `FALLIDA`, con `ok: 2000` y `procesadas: 2000` — los reales, no cero |
| 6 | `afterAll` tira | `processImportJob` **resuelve**. `estadoProceso: FINALIZADA`, `resultado: CON_ADVERTENCIAS`, `errorPostProceso` persistido, `advertencias: 1`, una fila `[post-proceso] …` en `importerror`, notificación "…con advertencias" |
| 7 | Las 12 filas dan error | `FINALIZADA`, `CON_ERRORES`. Notificación de tipo `IMPORTACION_ERROR`, título "Importación sin filas cargadas". Ningún texto dice "fallida" |
| 8 | Re-ejecución: la fila previa trae `startedAt`, `procesadas: 1000`, `rev: 7`, `intentos: 1` | Después de `iniciada`: `intentos: 2`, `procesadas: 0`, `rev > 7`. Hay un `warn` |
| 9 | Sin fila previa (job del código viejo) | La crea y termina normal |
| 10 | Sin dueño (`usuarioCreadorId` null, job sin `usuarioId`) | Persiste y emite con `usuarioId: null`. No crea notificación |
| 11 | `notificaciones.crear` rechaza | La carga sigue `FINALIZADA`, `processImportJob` resuelve, no hay segunda `finalizada` |
| 12 | El emisor de socket tira en todas las llamadas | La carga termina `FINALIZADA` igual |

**C. `backend/src/modules/imports/imports-progreso-http.spec.ts`**

| # | Caso | Qué tiene que pasar |
|---|---|---|
| 1 | `executeRemesa` sobre un borrador validado | Un `update` con `estadoProceso: PENDIENTE`, `okFilas: 0`, `errFilas: 0` y la fila en `EN_COLA` con `encoladaAt`. `queue.add` una vez. Emite `import:progreso` (`EN_COLA`). Devuelve `carga` |
| 2 | Sobre una ya encolada | `409`; `queue.add` no se llama |
| 3 | Sobre una FINALIZADA | `409` |
| 4 | VALIDANDO con `totalFilas: 0` | `400`; no encola |
| 5 | PENDIENTE (sin vista previa) con `totalFilas: 0` | Encola |
| 6 | El usuario ya tiene otra en curso | `409` |
| 7 | `queue.add` rechaza | La remesa queda `FALLIDA` con `error`; `503` |
| 8 | `validateRemesa` sobre una FINALIZADA, y sobre una encolada | `409`; `remesa.update` no se llama |
| 9 | `validateRemesa` MULTIRREGISTRO | Persiste `VALIDANDO`, `totalFilas` y `totalEsperado` (#10) |
| 10 | `validateRemesa` con `remesa.hoja = 'Hoja2'` sobre un xlsx de dos hojas armado en el test | El total es el de la Hoja2 (#19) |
| 11 | `listarEnCurso` | El `where` filtra por la fila de progreso (`encoladaAt` no nulo, `finishedAt` nulo) y **no** por `estadoProceso`. Sin el permiso agrega `usuarioCreadorId`. Una carga con 500 de 1000 devuelve `progreso: 50`, no 0 |
| 12 | `progreso(id)` | `404` si no existe. Una heredada sin fila sale sintetizada |
| 13 | `status(id)` | Trae `carga`; `duracionMs` sale de la fila; `jobimport: null` |
| 14 | `deleteRemesa` | Una `EN_COLA` → `400`. Al borrar un borrador se llama `notificacion.deleteMany` con `REMESA` y el id |
| 15 | `createRemesa` | El `create` lleva `progreso: { create: { fase: 'BORRADOR' } }` y el `usuarioCreadorId` |
| 16 | `crearRemesaConNumeroSeguro` | `P2002` sin `meta`, o con `meta.target` del número → reintenta con sufijo. `P2002` con `meta.target` de otra clave → se relanza sin reintentar |

**D. `backend/src/modules/realtime/realtime.service.spec.ts`** (nuevo): cada uno de los tres métodos
hace **una** llamada a `server.to(...)` con las dos salas y un solo `emit`; sin `usuarioId`, solo
`admin:importaciones`; si `server.to` tira, no propaga.

**E. `backend/src/modules/imports/processors/processor-registry.spec.ts`** (existe; se agrega un
caso): dos `getProcessor('FACTURAS')` seguidos devuelven instancias distintas.

**Los specs que ya existen no se modifican.** El diseño está armado para eso, y cada una de estas
decisiones se tomó mirando el mock que la obliga:

- No cambia el constructor de `ImportService` (12 `new ImportService(…)` posicionales).
- Se mantienen los nombres `emitImportIniciada` / `emitImportProgreso` / `emitImportFinalizada`
  (`multiclaves-wiring.spec.ts:378`).
- Todas las escrituras del worker pasan por `remesa.update`, y el tracker tolera que devuelva `{}`
  (`multiclaves-wiring.spec.ts:341`). `processImportJob` sigue devolviendo `{ total, ok, err }`.
- La fila de borrador se crea anidada dentro de `remesa.create`, no con una segunda llamada (los
  specs de alta solo mockean `remesa.create`).
- Las guardas de `validateRemesa` y de `crearRemesaConNumeroSeguro` están escritas en negativo (las
  fixtures no traen `estadoProceso`; el `P2002` simulado no trae `meta`).
- La limpieza de notificaciones va fuera de la transacción de borrado (el `tx` mockeado no tiene
  `notificacion`).

Si al implementar hace falta tocar un assert existente, **parar y reportarlo**: es señal de que algo
dejó de ser compatible. La única adición admitida es el caso E.

#### 8.9.2 Frontend

Sin tests. Tres controles, los tres obligatorios:

```bash
cd frontend
npx tsc --noEmit -p tsconfig.json   # exactamente los 5 errores de base; ninguno en archivos tocados
npm run build
npm run verificar-ayuda
```

#### 8.9.3 Prueba manual (la usa el auditor; sirve también para los usuarios que prueban)

Preparación local: `IMPORTS_BATCH_SIZE=100` en `backend/.env` para que una carga chica tenga muchos
lotes; un CSV de DEUDORES de unas 3.000 filas con su plantilla.

| # | Pasos | Qué tiene que verse |
|---|---|---|
| M1 | Insertar a mano en la base **local** dos remesas sin fila de progreso: una PENDIENTE y una VALIDANDO con 912/912. Abrir la campanita y el detalle de la segunda | La campanita no muestra ninguna. `GET /api/import/en-curso` → `[]`. El detalle dice "Borrador", sin barra y sin "100% completado" |
| M2 | Lanzar la carga de 3.000 filas. En "Importando", DevTools → Network → Offline. Esperar a que termine (mirar el log del backend). Volver a Online | Mientras está offline: el aviso "Sin conexión en tiempo real" y, a los 5 s, el ícono en la barra superior. **Ningún toast repetido** de "Sin conexión con el servidor". Al volver: el wizard pasa a "Resultado" en 15 s o menos, sin F5. La campanita deja de mostrar la carga |
| M3 | Lanzar otra y apretar F5 a la mitad. Abrir la campanita y el detalle | La campanita muestra el porcentaje real (no 0) en 2 s o menos. El detalle muestra el mismo. Nunca "100%" con "Procesando" |
| M4 | Subir un CSV con solo el encabezado | La vista previa muestra total 0 y "Confirmar e importar" deshabilitado, con la alerta. Forzándolo por API (`POST /api/import/ejecutar/:id`) responde `400` |
| M5 | Hacer la vista previa de una carga, borrar del disco el archivo que figura en `remesa.archivo`, y confirmar | "Resultado" dice **"La importación falló"** con el motivo. Notificación roja. El detalle tiene la alerta de error. En el Historial figura FALLIDA con 0 / 0 |
| M6 | Con dos sesiones (dos usuarios), lanzar una carga larga con A y enseguida otra con B | La de B muestra "En cola" con barra indeterminada hasta que termina la de A, y después avanza |
| M7 | `JWT_EXPIRES_IN=2m`, iniciar sesión, esperar 3 min, reiniciar el backend | En unos 15 s la app manda a `/login`. No queda abierta con el socket muerto |
| M8 | Con sesión válida, reiniciar el backend | A los 5 s aparece el ícono de sin conexión; al reconectar desaparece y la campanita se re-hidrata |
| M9 | `POST /api/import/ejecutar/:id` dos veces seguidas sobre el mismo borrador | La segunda responde `409`. Hay un solo job y una sola carga |
| M10 | MULTIARCHIVO con un paquete que genere avisos de parseo (el de Toyota, si está en la máquina) | El detalle muestra "Avisos de la carga" con las filas `[parseo]` aunque no haya filas con error |
| M11 | Cerrar sesión y volver a entrar sin recargar, con una carga en curso de otro usuario | El contador y la carga aparecen sin F5 |
| M12 | Pasos 4 y 5 del wizard, campanita y detalle en tema claro y oscuro, y en ancho de celular | Se lee todo; ningún color fuera del theme |

El fallo del post-proceso (`CON_ADVERTENCIAS`) no tiene una forma razonable de provocarse a mano: lo
cubre el caso B-6.

### 8.10 Documentación

- **Wiki** (`docs/ayuda/03-importacion/`, paquete de frontend). La regla del repo: cambia en el mismo
  commit que el flujo.
  - `01-como-funciona.md`: la línea `:94` ("Podés cerrar la pantalla") con la salvedad de la carga
    dividida; la tabla de estados (`:103-109`): Pendiente es "creada, o confirmada y en cola",
    Validando es "con la vista previa hecha y sin confirmar"; Finalizada puede ser "con advertencias".
  - `05-importar-un-archivo.md`: paso 3, el botón deshabilitado cuando no hay filas; paso 4
    (`:150-153`), las fases En cola / Procesando / Post-proceso, el aviso de sin conexión y la
    salvedad de la carga dividida; paso 5 (`:155-160`), los seis resultados con los textos de §8.8.8;
    `:246-247`, el botón "Ver errores" ya no existe, es "Ver detalle".
  - `08-historial-y-problemas.md`: la tabla de estados (`:29-35`); "La carga quedó procesando y no
    avanza" (`:235-241`) deja de decir "hay que esperar a que falle", que hoy es falso: decir la
    verdad — no falla sola, mirar el aviso de "sin novedades hace N min" y avisar a soporte—; una
    sección nueva "Terminó con advertencias: qué hacer"; y que la campanita ya no muestra vistas
    previas sin confirmar.
  - `cd frontend && npm run verificar-ayuda`. Y antes de cerrar, cada página pasa por un agente
    revisor (memoria `auditar-documentacion-con-agentes`).
- **`docs/notificaciones-spec.md`** (paquete de backend): §3.1 `:26` (el progreso se lee de
  `import_progreso`, no de `jobimport`); §3.2 `:93-97` (el payload es `EstadoCargaDto`, una sola
  emisión, y el throttle queda para la Fase B); §3.6 `:146` y `:149` (ahora **hay** polling de
  respaldo; qué pasa con el JWT vencido); una entrada fechada en su §5.
- **`CHANGELOG.md`**: una entrada con el formato de siempre. La escribe **quien orquesta**, al cerrar,
  con lo que cada implementer devuelva en su informe: es un archivo compartido y no puede estar en
  ninguno de los dos paquetes.
- **Este documento**: quien orquesta actualiza el estado del encabezado cuando la fase quede
  implementada y auditada.
- **Memorias** (fuera del repo, las toca quien orquesta): `wipe-deudores-prod` y
  `wipe-cartera-por-empresa` (§8.2), y `progreso-imports-realtime`.

### 8.11 Criterios de aceptación

Los que parten de §4 están reescritos para que se puedan comprobar.

**Schema y deploy**

- **CA-1.** El diff entre la base local previa y el schema nuevo es un `CREATE TABLE import_progreso`
  y un `ADD CONSTRAINT ImportProgreso_remesaId_fkey`, y nada más. `npx prisma db push` termina **sin
  pedir `--accept-data-loss`**. Después, `prisma migrate diff` dice `This is an empty migration`.
- **CA-2.** El `git diff` de `schema.prisma` no toca `enum remesa_estadoProceso`, `jobimport` ni
  `TipoNotificacion`.

**Backend, automáticos**

- **CA-3.** `npm run build` pasa. Las 36 suites y 679 tests de base siguen pasando sin haber cambiado
  ninguno de sus asserts. Pasan los specs A, B, C, D y el caso E.
- **CA-4.** 2.500 filas con lote de 1000 emiten, en orden: `iniciada` (0) · `progreso` 40 · 80 · 99 ·
  `progreso` (POST_PROCESO) · `finalizada` (100, `OK`). Una `iniciada`, una `finalizada`, `rev`
  creciente (B-1).
- **CA-5.** Durante una carga, `remesa.totalFilas` no cambia hasta el estado terminal (B-1).
- **CA-6.** Un archivo sin filas termina FINALIZADA con `SIN_FILAS`; ningún texto dice "0 filas
  correctamente" (B-2).
- **CA-7.** Una plantilla de DEUDORES sin estado inicial deja la remesa FALLIDA, con el motivo
  persistido y `okFilas = errFilas = 0` (B-4).
- **CA-8.** Un `afterAll` que tira deja FINALIZADA con `CON_ADVERTENCIAS`, el motivo en
  `import_progreso`, una fila `[post-proceso]` en `importerror` y una notificación "con advertencias"
  (B-6).
- **CA-9.** Con remesas PENDIENTE y VALIDANDO **sin fila de progreso**, `GET /api/import/en-curso`
  devuelve `[]` (C-11, M1).
- **CA-10.** Confirmar dos veces la misma remesa: la segunda es un `409` y hay un solo job (C-2, M9).
- **CA-11.** Un evento de import sale en una sola emisión, a la unión de las dos salas (D).

**Frontend y manuales**

- **CA-12.** `npx tsc --noEmit` da exactamente los 5 errores de base. `npm run build` y `npm run
  verificar-ayuda` pasan.
- **CA-13.** Cortar la red en medio de una carga y reconectar después de que termina: el wizard, la
  campanita y el detalle muestran el estado final **sin F5** en 15 s o menos, y durante el corte no
  hubo toasts repetidos (M2).
- **CA-14.** Recargar en medio de una carga: la campanita muestra el porcentaje real en 2 s o menos, y
  el detalle nunca muestra 100% en Procesando (M3).
- **CA-15.** Con un archivo de solo encabezado, el botón de confirmar está deshabilitado y dice por
  qué; por API, `400`. No aparece `NaN` en ninguna pantalla (M4).
- **CA-16.** Una carga FALLIDA muestra "La importación falló" con el motivo en el wizard, el detalle y
  la notificación. En ningún lugar dice "exitosa" (M5).
- **CA-17.** El detalle de una remesa VALIDANDO heredada dice "Borrador", sin barra de progreso (M1).
- **CA-18.** Con el JWT vencido, una reconexión del socket termina en `/login` en unos 15 s (M7).
- **CA-19.** En una carga dividida, si una remesa no llega a ejecutarse, el resumen la lista como no
  ejecutada, con el motivo.
- **CA-20.** "Ver detalle" e "Ir al historial" llevan a pantallas que existen: sin 401 y sin pantalla
  en blanco.
- **CA-21.** Nada de lo nuevo usa colores fuera de `theme.palette`; se ve bien en claro y en oscuro
  (M12).
- **CA-22.** Las tres páginas de la wiki están actualizadas: ninguna dice "hay que esperar a que
  falle" ni promete que se puede cerrar la pantalla en una carga dividida.

### 8.12 Paquetes de trabajo

Dos paquetes con **conjuntos de archivos disjuntos**, para dos `implementer` en paralelo sobre el
mismo working tree. El contrato de §8.4 es el único punto de contacto.

Reglas para los dos:

- **Nadie commitea.** Al final, quien orquesta hace dos commits —backend primero, frontend después—
  para poder pushearlos por separado (§8.6).
- Nadie toca un archivo del otro paquete, ni `CHANGELOG.md`, ni este documento.
- No correr `npm run lint`, `eslint --fix` ni `npx prisma format`: reformatean cientos de archivos.
- Ante una duda de contrato, manda §8.4. Si hay que apartarse, se reporta; no se improvisa.
- Cada informe final trae: qué se hizo, qué se desvió del spec y por qué, la salida de la
  verificación, y el texto para su sección del CHANGELOG.

#### Paquete BE — backend

Archivos:

| Archivo | Qué |
|---|---|
| `backend/prisma/schema.prisma` | Modelo `import_progreso` y la relación en `remesa` (§8.2) |
| `backend/src/modules/imports/progreso/estado-carga.types.ts` | **Nuevo.** Tipos de §8.4.1 |
| `backend/src/modules/imports/progreso/estado-carga.ts` | **Nuevo.** `calcularPorcentaje`, `clasificarResultado`, `armarEstadoCarga`, `textoNotificacion` |
| `backend/src/modules/imports/progreso/estado-carga.spec.ts` | **Nuevo.** Spec A |
| `backend/src/modules/imports/progreso/progreso-tracker.ts` | **Nuevo.** §8.5.1 |
| `backend/src/modules/realtime/realtime.service.ts` | Los tres `emitImport*` reciben `EstadoCargaDto` y emiten una vez a la unión de salas (`:61-74`). Se van las tres interfaces viejas (`:4-33`) |
| `backend/src/modules/realtime/realtime.service.spec.ts` | **Nuevo.** Spec D |
| `backend/src/modules/imports/imports.service.ts` | §8.5.2 a §8.5.7 |
| `backend/src/modules/imports/imports.controller.ts` | `GET remesas/:id/progreso`; `createRemesa` pasa `user.sub` |
| `backend/src/modules/imports/imports-progreso-eventos.spec.ts` | **Nuevo.** Spec B |
| `backend/src/modules/imports/imports-progreso-http.spec.ts` | **Nuevo.** Spec C |
| `backend/src/modules/imports/processors/processor-registry.ts` | Fábricas en vez de instancias (§8.5.6) |
| `backend/src/modules/imports/processors/processor-registry.spec.ts` | Un caso más (E) |
| `docs/notificaciones-spec.md` | §8.10 |

Pasos:

1. **BE-1 — Schema.** Agregar el modelo y la relación. `npx prisma db push` **sin**
   `--accept-data-loss`: si Prisma lo pide, **parar y reportar** el aviso textual. `npx prisma
   generate`. Va primero porque todo lo demás necesita el cliente generado.
2. **BE-2 — Contrato y funciones puras**, con el spec A. No dependen de nada.
3. **BE-3 — Realtime**, con el spec D.
4. **BE-4 — Tracker.**
5. **BE-5 — Worker** (`processImportJob`), con el spec B. Es el paso de más riesgo: correr todos los
   specs de imports apenas compile.
6. **BE-6 — Alta, vista previa, encolado, lecturas y borrado**, con el spec C.
7. **BE-7 — Processor por carga** (separable: si no se aprueba, se saltea).
8. **BE-8 — `docs/notificaciones-spec.md`.**
9. **BE-9 — Verificación:**

```bash
cd backend
npx prisma migrate diff --from-schema-datasource prisma/schema.prisma \
    --to-schema-datamodel prisma/schema.prisma --script      # → "This is an empty migration."
npm run build
npx jest src/modules/imports src/modules/realtime src/modules/notificaciones
npm test
```

#### Paquete FE — frontend

Archivos:

| Archivo | Qué |
|---|---|
| `frontend/src/types/importProgreso.ts` | **Nuevo.** Tipos de §8.4.1 |
| `frontend/src/api/imports.ts` | **Nuevo.** §8.8.1 |
| `frontend/src/api/axios.ts` | Declarar `silencioso` |
| `frontend/src/api/setupAxiosInterceptors.ts` | Respetar `silencioso` |
| `frontend/src/api/notificaciones.ts` | Sacar lo que pasó a `api/imports.ts` |
| `frontend/src/utils/estadoCarga.ts` | **Nuevo.** §8.8.1 y §8.8.8 |
| `frontend/src/context/SocketContext.tsx` | §8.8.2 |
| `frontend/src/hooks/useEstadoCarga.ts` | **Nuevo.** §8.8.3 |
| `frontend/src/context/NotificacionesContext.tsx` | §8.8.4 |
| `frontend/src/hooks/useImportacionesEnCurso.ts` | Solo el tipo |
| `frontend/src/components/import/ImportProgress.tsx` | §8.8.5 |
| `frontend/src/components/import/ImportSummary.tsx` | §8.8.5 |
| `frontend/src/pages/ImportWizard.tsx` | §8.8.5 |
| `frontend/src/pages/ImportDetail.tsx` | §8.8.6 |
| `frontend/src/components/layout/AppShell/NotificacionesPopover.tsx` | §8.8.7 |
| `frontend/src/components/layout/AppShell/ImportEnCursoItem.tsx` | §8.8.7 |
| `frontend/src/components/layout/AppShell/NotificacionItem.tsx` | §8.8.7 |
| `frontend/src/components/layout/AppShell/ConexionIndicador.tsx` | **Nuevo.** §8.8.7 |
| `frontend/src/components/layout/AppShell/AppBar.tsx` | Montar el indicador |
| `docs/ayuda/03-importacion/01-como-funciona.md`, `05-importar-un-archivo.md`, `08-historial-y-problemas.md` | §8.10 |

`ImportHistory.tsx` **no** se toca en esta fase.

Pasos:

1. **FE-1 — Tipos, API y utilidades**, más el `silencioso` de axios. Es la base de todo y no depende
   del backend.
2. **FE-2 — `SocketContext`.** Sin romper a `ConsolidacionModal` ni a `ImportDetail`, que usan `socket`
   y `conectado`.
3. **FE-3 — `useEstadoCarga`.**
4. **FE-4 — Campanita:** `NotificacionesContext`, `useImportacionesEnCurso`, popover, ítem,
   notificación, `ConexionIndicador` y `AppBar`.
5. **FE-5 — Wizard:** `ImportProgress`, `ImportSummary`, `ImportWizard`.
6. **FE-6 — Detalle.**
7. **FE-7 — Wiki.**
8. **FE-8 — Verificación:** los tres comandos de §8.9.2.

La prueba contra el backend real (§8.9.3) la hace el auditor cuando los dos paquetes estén cerrados.

### 8.13 Lo que cambió después de la auditoría (05/10/2026)

Los dos paquetes se implementaron y pasaron por tres revisiones independientes (backend, frontend y
wiki). Esta sección registra **dónde el código se apartó del diseño de arriba** y por qué. Donde una
tabla o un pseudocódigo de §8.3 a §8.5 quedó contradicho, ya está corregido en su lugar; acá está el
porqué.

**Backend** (auditoría: PASA CON OBSERVACIONES; corrió el `ImportService` compilado contra MySQL
local, con concurrencia real y los archivos de cedente de la máquina).

| Qué | Diseño original | Cómo quedó | Por qué |
|---|---|---|---|
| Fallo al encolar | Remesa FALLIDA | **Vuelve a borrador**; reintentar funciona | El 503 decía "Probá de nuevo" y el reintento daba 409: había que volver a subir el archivo por un parpadeo de Redis |
| Borrar una carga en cola | Siempre 400 | Si **no arrancó**: se saca el job de la cola y se borra. Si arrancó o el job está activo: 400 | Con el 400 fijo, una carga encolada sin job dejaba al usuario sin salida (no podía importar, ni borrarla, ni revalidarla). `executeRemesa` guarda `job.id` en `import_progreso.jobId` para poder encontrarlo |
| Lectura inicial del worker que tira | Quedaba EN_COLA | Se marca FALLIDA con motivo (`marcarFallidaSinTracker`) | Mismo callejón |
| `entrarEnPostProceso` que falla | Dejaba pasar el error | `warn` y sigue | Una etiqueta de fase no puede saltear la consolidación: las filas ya están cargadas |
| Job sobre una remesa que ya terminó | La reprocesaba entera (preexistente) | `warn` y sale sin procesar | "De un terminal no se sale" (§8.3). Es lo que pasaría si BullMQ da por *stalled* un job vivo |
| Motivo del error | `error.message` crudo | `motivoLegible()`: para Prisma, la última línea más el código | La primera línea de un error de Prisma es un encabezado genérico, y el texto completo trae rutas del servidor y código; `error` va a la pantalla |
| `advertencias` | `[parseo]`, avisos de lectura de multiclaves, post-proceso | Además cuenta en la base los `[aviso]` que escriben los processors en su `afterAll` | Los avisos de PAGOS (`CLAVE_NO_CARGADA` y demás) seguían invisibles con `errFilas = 0`: era el caso original del #11 |
| FALLIDA heredada (sin fila) | Contadores de la remesa | Contadores en 0 | En una FALLIDA anterior al cambio esos números podían ser los de la muestra de la vista previa |
| `fallar()` que no puede persistir | Notificaba "fallida" | Notifica, y el texto dice que el estado no se pudo registrar | La remesa sigue PROCESANDO en la base |
| Tracker antes del chequeo de archivo/plantilla | Chequeo fuera del `try` | Dentro del `try`, después de `iniciar` | Una encolada sin archivo quedaba EN_COLA para siempre |
| Catálogo de reportes | No previsto | `import_progreso` en `MODELOS_OCULTOS` | La tabla nueva aparecía como campos reportables |
| Tope de tiempo con la cola | `queue.add` tira si Redis está caído | `IMPORTS_QUEUE_TIMEOUT_MS` (default 10 s) alrededor del `add` y de las consultas a la cola del borrado; al vencer, vuelta a borrador y 503 (o 400 en el borrado) | Medido con BullMQ 5.70.4 y Redis real: con Redis caído `add` **espera**; rechaza recién a los 238 s o nunca. Sin el tope, la compensación del #23 casi no se disparaba y el pedido quedaba colgado. No se tocó la conexión global (la comparten los workers, que bloquean a propósito) |
| Job fantasma sobre un borrador | No previsto | Si la remesa tiene fila y `encoladaAt` es null, el job se ignora con `warn` | Un `add` que venció o tiró pero igual entró llegaba al worker con la remesa ya devuelta a borrador |
| Jobs ignorados | — | `processImportJob` devuelve `ignorado: true`; `bullmq/imports.processor.ts` no los loguea como completados ni los audita `IMPORT_OK` | Un job ignorado sobre una FALLIDA quedaba auditado como importación exitosa |
| Permiso en el borrado | Después del chequeo de "en curso" | Antes de cualquier efecto sobre la cola | Un usuario sin permiso sobre la remesa recibía 403, pero el job del dueño ya había salido de la cola |
| Borrado sin `jobId` | Se borraba sin consultar la cola | Se busca el job por `data.remesaId` | La fila podía no tener `jobId` y el job estar activo |
| Borrado con lectura vieja | Chequeo fuera de la transacción | Relectura con `FOR UPDATE` dentro de la transacción (`verificarNoArrancada`); y el worker, después de `iniciar()`, vuelve a leer la remesa y corta si ya no existe | Se podía borrar una remesa con filas ya procesadas, o procesar un lote de una remesa ya borrada |
| `marcarFallidaSinTracker` | Dos escrituras | Una transacción, y no pisa una remesa terminal | Podía quedar FALLIDA con la fila EN_COLA, o pisar una FINALIZADA |
| Contrato | Sin `servidorAhora` | `EstadoCargaDto.servidorAhora` (hora del servidor al armar el DTO) | El aviso "sin novedades" o dependía del reloj de la PC o no avisaba al abrir una carga ya colgada |

Tests al cierre: 43 suites / 824 tests en imports + realtime + notificaciones (base: 36 / 679), 1500
en la suite completa. Se agregaron `progreso-tracker.spec.ts`, `imports-progreso-controller.spec.ts` y
`bullmq/imports.processor.spec.ts`, que el diseño no listaba. El auditor mutó el código en cada pasada:
en la primera sobrevivían 14 de 28 mutaciones; al cierre, las que sobrevivían tienen su test, salvo
dos huecos menores en `conTope` (`imports.service.ts`): ningún test falla si se quita el `catch` de la
promesa original —que es lo que evita un rechazo sin manejar a los ~4 minutos de una caída de Redis— ni
si no se limpia el timer. El comportamiento está medido contra Redis real; falta la red.

**Veredictos al cierre (05/10/2026):** backend PASA (cuatro pasadas), frontend PASA (cuatro pasadas),
wiki PASA en las cuatro páginas (cuatro revisiones). El tope de tiempo se midió contra un Redis real
detrás de un proxy: 503 y vuelta a borrador a los ~10 s en los cuatro modos de falla, ningún falso 503
en 228 llamadas con Redis sano (mediana 10 ms), y un `add` que entra tarde se ignora.

**Frontend** (auditoría: NO PASA en la primera pasada por un hallazgo ALTO; PASA CON OBSERVACIONES al
cierre. Corrió el wizard real en un arnés con React en modo estricto y un servidor socket.io real.)

| Qué | Diseño original | Cómo quedó | Por qué |
|---|---|---|---|
| Polling del wizard | "Mientras no sea terminal" y "una heredada: una sola consulta" | `useEstadoCarga(id, { seguirHastaTerminal })`: el wizard sigue hasta el estado terminal sin mirar `rev` ni `enCurso`, y siembra el estado con la `carga` del POST de ejecutar; el detalle consulta solo mientras está en curso | Las dos reglas chocaban: un borrador recién creado se ve igual que uno heredado (`rev 0`, no en curso). Con el socket caído el wizard no consultaba nunca; en una carga dividida la cadena se cortaba en silencio |
| "Con advertencias" | "Volvé a consolidar la remesa desde el Historial" (§8.8.8) | `pendientePostProceso(tipo)`: qué quedó sin hacer y qué hacer, por categoría | Consolidar solo recalcula los casos de esa remesa: en PAGOS evalúa 0 (los casos cuelgan de las remesas de deudores), no cierra ausentes, no recalcula importes de facturas ni guarda los snapshots de acciones |
| "Sin novedades" | Reloj del navegador contra `heartbeatAt` | Edad del latido con `servidorAhora`, más lo transcurrido en el cliente | Ver "Contrato" arriba |
| Remesa no encontrada | 404 → `noExiste`, se corta | 3 respuestas 404 y al menos 6 s; el texto no afirma que se eliminó; alerta fija sin reiniciar el wizard; en una división, textos propios en el resumen | Un 404 transitorio (o el frontend desplegado antes que el backend) hacía decir "se eliminó, podés volver a empezar" de una carga que estaba corriendo |
| Fallo al ejecutar | Toast y, en una división, pasar al resumen | Se consulta el estado real de la remesa: si se encoló se la sigue; si es borrador, se vuelve a la vista previa con el error | Una respuesta perdida informaba como "no ejecutada" una remesa que sí corrió; un 409 por doble envío rebotaba |
| Resumen de carga dividida | Peor resultado de las que corrieron | Además: "La importación quedó incompleta" si faltó alguna; no ejecutadas por número de remesa con enlace; sin "Descartadas" | El título decía "exitosa" con remesas sin ejecutar, identificadas por id interno; `descartadas` sumaba las filas de los otros cortes |
| Avisos de remesas heredadas | Tabla si `advertencias > 0` | Una terminal sin fila de progreso siempre pide los errores | Las 97/99/100/107 de prod llegan con `advertencias: 0` y seguían sin mostrar sus `[parseo]` (paso 8 de §6) |
| Hidratación de la campanita | `contador` + en curso, juntos | En curso solo con `importacion.ver_historial`; `Promise.allSettled` | Sin el permiso, cada hidratación daba 403 y escribía una auditoría de permiso denegado, y arrastraba al contador |
| Fila "—" | `rowNumber 0` | Solo si el mensaje es un aviso (`esAvisoDeCarga`) | La primera fila de datos también es la 0 |

Archivos que el diseño no listaba: `hooks/useAhora.ts`, `components/import/AvisosCarga.tsx`.

**Wiki.** Cuatro revisiones contra el código. La primera encontró diez errores factuales y dio NO
PASA; al cierre pasan las cuatro páginas (`01`, `05`, `07`, `08`). Lo más serio era el remedio de "con
advertencias", que venía del diseño y estaba también en la pantalla.

**Datos verificados que §8 daba por no verificados:**

- `e.meta.target` de un `P2002` en MySQL: `Remesa_empresaId_numeroRemesa_key` para un número de remesa
  repetido y `PRIMARY` para el choque con una fila de progreso huérfana (con `modelName: 'remesa'`
  aunque la PK que choca es la de `import_progreso`).
- El `db push` no pide `--accept-data-loss`: el diff desde HEAD son exactamente el `CREATE TABLE` y el
  `ADD CONSTRAINT`.
- §8.2 decía que con una fila huérfana "nadie puede importar hasta limpiar la tabla". Inexacto: el alta
  fallida consume el id y la siguiente pasa; con N huérfanas son N altas fallidas con 500.
- Socket.IO entrega una sola vez a un socket que está en las dos salas (probado con un servidor real).

- BullMQ 5.70.4 contra Redis real (colas de prueba): `getJob` de un job inexistente da `undefined`;
  `remove()` de un job activo tira por el lock; un job terminado sigue existiendo (la app no usa
  `removeOnComplete`); con la cola en pausa `getState` devuelve `waiting`; en 400 rondas de carrera
  entre sacar y correr, ningún job fue sacado y además corrido.

**Lo que ninguna auditoría pudo probar, y queda para la prueba manual (§8.14):** nada se vio en un
navegador; ninguna importación corrió de punta a punta con la app levantada (HTTP, guards, socket y
BullMQ juntos); MULTIRREGISTRO y MULTIARCHIVO con archivos reales de Toyota (no están en la máquina de
desarrollo; se probó con el parser reemplazado); la re-ejecución real de un job por *stalled*; los
errores de conexión de Prisma.

**Queda para las fases siguientes** (hallazgos de la auditoría que no son de la Fase A):

| Hallazgo | Fase |
|---|---|
| ACCIONES que termina con advertencias: el botón Revertir aparece igual, con snapshots parciales, y es de una sola vez (los snapshots se guardan recién en `afterAll`) | C, junto con #16 |
| `rowNumber 0` es a la vez "primera fila de datos" y "aviso"; la numeración arranca en 0 y no cuenta encabezado ni descartadas | C |
| El detalle muestra solo los primeros 100 errores, sin paginado; con más de 100 avisos no se ve ningún error de fila | C (tabla completa / CSV) |
| En una carga dividida, `descartadas` incluye las filas de los otros cortes: no distingue "filtro de la plantilla" de "fuera del corte" | B |
| No hay cómo retomar una remesa de una división que no arrancó ni reintentar una FALLIDA | C |
| `ImportHistory` muestra los borradores y las cargas en cola como PENDIENTE, y no distingue "con advertencias" | C |
| "Sin novedades" no cubre Post-proceso ni En cola; el latido es uno por lote | B |
| Una carga que **ya arrancó** y queda colgada sigue sin salida por la aplicación: no falla sola, no se puede borrar y bloquea al usuario | B (reaper por heartbeat) |
| Las remesas de origen de una carga (PAGOS, CONTACTOS, ENRIQUECIMIENTO) solo quedan en la auditoría, con ids internos: el remedio de PAGOS "con advertencias" depende de que el operador se acuerde. Guardarlas en `import_progreso.resumen` y mostrarlas en el detalle | C (resumen por categoría) |
| ACCIONES re-ejecutada por BullMQ: demostrado con el processor real que los comentarios quedan duplicados y los snapshots del primer intento se pierden | C, junto con #16 |
| Confirmar y borrar la misma remesa en el mismo instante puede dar OK a las dos (inocuo: el worker no encuentra la remesa) | B |
| La compensación del encolado puede devolver a borrador una carga que el worker ya tomó (construido a mano; termina bien: una sola pasada de filas) | B |
| El detalle de una remesa de una división muestra su `descartadas` inflado en el texto de SIN_FILAS | B, con la separación de arriba |

**Bugs del sistema encontrados de paso, ajenos a este cambio** (sin arreglar; van al backlog):

- **Seguridad:** el gateway de `/reportes` confía en un `usuarioId` que manda el cliente, sin JWT
  (`backend/src/modules/reportes/gateway/reportes.gateway.ts:51-68,97-114`): cualquiera puede unirse a
  la sala de otro usuario.
- **Permisos:** `POST /import/remesas` (subir archivo y crear la remesa) solo exige
  `importacion.ver_historial` (`imports.controller.ts:184`): un rol de solo lectura puede subir
  archivos y crear borradores.
- El socket de reportes nunca conecta: `frontend/src/pages/reportes/hooks/useReportesSocket.ts:38` lee
  `localStorage.getItem('usuario')` y la clave real es `amsa_usuario`. La pantalla vive de su intervalo.
- La tasa de éxito redondea 99,54% a 100% (`ImportDetail.tsx`, `status()`).
- `status()` tira `NotFoundException()` sin mensaje ni `warn`.
- `tsc --noEmit` del backend da errores en varios `*.spec.ts` preexistentes que jest pasa.

### 8.14 Guion de prueba manual antes del deploy

Es lo único de la Fase A que nadie vio: las auditorías corrieron el backend compilado contra MySQL y
Redis locales y el frontend en un arnés, pero **ninguna importación corrió de punta a punta con la app
levantada, y nada se vio en un navegador**. Reemplaza a M1-M12 de §8.9.3 (que quedan como referencia).
Ordenado por riesgo: si el tiempo no alcanza, los pasos 1 a 4 son los que no se pueden saltear.

Preparación, en local: `IMPORTS_BATCH_SIZE=100` en `backend/.env` (para que una carga chica tenga
muchos lotes), un CSV de DEUDORES de unas 3.000 filas con algunas filas inválidas, y una plantilla con
división de remesa.

| # | Qué hacer | Qué tiene que verse |
|---|---|---|
| 1 | **Carga simple, de punta a punta.** Importación de Datos → Nueva Importación → "Confirmar e importar" | Pasa por "Enviando a la cola…", "En cola", "Procesando" con el porcentaje subiendo por lotes **sin llegar a 100**, y "Resultado de la importación". La campanita muestra "Importaciones en curso (1)" con el mismo porcentaje y la saca al terminar. "Ver detalle" abre el detalle con inicio, fin y duración |
| 2 | **Carga dividida completa** | El cartel "Procesando la remesa N de 3" avanza solo. El resumen trae una fila por remesa con su número y no muestra "Descartadas" |
| 3 | **Tiempo real bloqueado.** DevTools → More tools → Network request blocking, patrón `*socket.io*`, y F5. Lanzar una carga simple y después una dividida | A los 5 s aparece la nube tachada en la barra superior. La carga muestra "En cola" o "Procesando" con "Sin conexión en tiempo real. El estado se actualiza cada 10 segundos." y llega al resultado a más tardar 15 s después de terminar. En la dividida corren las tres |
| 4 | **Corte de red.** En "Importando", Network → Offline hasta que la carga termine (mirar el log del backend) y volver a Online | Ningún toast repetido de error mientras está offline. Al volver, "Resultado" en 15 s o menos, sin F5 |
| 5 | **Redis caído al confirmar.** Parar el Redis local y apretar "Confirmar e importar" | A los ~10 s vuelve a "Vista previa" con el aviso "No se pudo iniciar la importación: la cola de trabajos no responde…" y los botones "Atrás" y "Confirmar e importar". Levantar Redis y confirmar de nuevo funciona **sin volver a subir el archivo** |
| 6 | **Carga colgada.** A mitad de una carga larga cortar el backend, vaciar el Redis local y volver a levantarlo. Esperar 10 minutos y abrir el detalle desde el Historial | Dice enseguida "Sin novedades del servidor hace 10 min". Con F5 la cuenta sigue, no vuelve a cero. (La carga queda PROCESANDO: no falla sola hasta la Fase B) |
| 7 | **División con una remesa que no arranca.** Mientras corre la remesa 1, en el Historial "Eliminar importación" sobre la PENDIENTE de la remesa 2 | "La importación quedó incompleta"; "Remesa <número>: … Ver detalle"; y para la 3, "No se intentó porque la remesa anterior no arrancó." |
| 8 | **Borrar una carga en cola, con dos sesiones.** A lanza una carga larga; B confirma otra, que queda "En cola". Un admin la elimina desde el Historial | El borrado funciona (la saca de la cola). A los ~6 s el wizard de B muestra la alerta fija "No se pudo seguir la importación…" con "Ir al historial" y "Nueva importación", sin reiniciarse. B puede volver a importar. Con la carga de A (ya corriendo), "Eliminar importación" responde "No se puede eliminar una importación en curso" |
| 9 | **Dos cargas del mismo usuario.** Con una corriendo, confirmar otra desde otra pestaña | Aviso "Ya tenés una importación en curso…", enseguida; no un error de servidor |
| 10 | **Detalles.** F5 a mitad de una carga; detalle de una carga en curso con filas inválidas; detalle de una remesa vieja en VALIDANDO (como la 98) | La campanita muestra el porcentaje real en 2 s. La tabla lista los errores mientras procesa. La vieja dice "Borrador", con una sola tarjeta y sin barra ni "100% completado" |
| 11 | **Archivo vacío y carga fallida.** CSV con solo el encabezado; después, hacer la vista previa de una carga, borrar del disco el archivo de `remesa.archivo` y confirmar | Con el vacío: "Confirmar e importar" deshabilitado, con "El archivo no tiene filas para importar." Con el borrado: "La importación falló" con el motivo en el wizard, en el detalle y en una notificación roja; en ningún lado dice "exitosa" |
| 12 | **Sesión y reinicio.** Con `JWT_EXPIRES_IN=2m`, iniciar sesión, esperar 3 min y reiniciar el backend. Después, con sesión válida, reiniciarlo otra vez | Con el token vencido: `/login` en unos 15 s. Con sesión válida: nube tachada a los 5 s, que se apaga al reconectar, y la campanita se re-hidrata |
| 13 | **Aspecto.** Pasos 4 y 5 del wizard, campanita y detalle en tema claro, oscuro y ancho de celular, con un motivo de error largo | Se lee todo, nada se desborda, ningún color fuera del tema |

Si alguna vez hay archivos reales de Toyota en la máquina de prueba: una carga MULTIARCHIVO y una
MULTIRREGISTRO, mirando que el total de la vista previa sea el que procesa la carga y que el detalle
muestre "Avisos de la carga" con las filas `[parseo]`.

---
## PLAN PARA IMPLEMENTER

**Orden de implementación:**
Dos paquetes en paralelo (§8.12). Dentro de cada uno:
- BE-1 schema y `db push` (todo lo demás necesita el cliente generado) → BE-2 contrato y funciones puras → BE-3 realtime → BE-4 tracker → BE-5 worker → BE-6 alta, vista previa, encolado, lecturas y borrado → BE-7 processor por carga (separable) → BE-8 `notificaciones-spec.md` → BE-9 verificación.
- FE-1 tipos, API, utilidades y axios silencioso (base de todo, no depende del backend) → FE-2 `SocketContext` → FE-3 `useEstadoCarga` → FE-4 campanita → FE-5 wizard → FE-6 detalle → FE-7 wiki → FE-8 verificación.

**Archivos a crear:**
- Backend: `backend/src/modules/imports/progreso/estado-carga.types.ts`, `estado-carga.ts`, `estado-carga.spec.ts`, `progreso-tracker.ts`; `backend/src/modules/imports/imports-progreso-eventos.spec.ts`, `imports-progreso-http.spec.ts`; `backend/src/modules/realtime/realtime.service.spec.ts`.
- Frontend: `frontend/src/types/importProgreso.ts`, `frontend/src/api/imports.ts`, `frontend/src/utils/estadoCarga.ts`, `frontend/src/hooks/useEstadoCarga.ts`, `frontend/src/components/layout/AppShell/ConexionIndicador.tsx`.

**Archivos a modificar:**
- `backend/prisma/schema.prisma` — modelo `import_progreso` y relación `progreso` en `remesa`.
- `backend/src/modules/imports/imports.service.ts` — `createRemesa`, `crearRemesaConNumeroSeguro`, `validateRemesa`, `previewAccionesImpacto`, `executeRemesa`, `listarEnCurso`, `processImportJob`, `status`, `deleteRemesa`, `deleteRemesaMulticlaves`; método nuevo `progreso`.
- `backend/src/modules/imports/imports.controller.ts` — endpoint nuevo; `createRemesa` con el usuario.
- `backend/src/modules/realtime/realtime.service.ts` — payload `EstadoCargaDto`, una sola emisión.
- `backend/src/modules/imports/processors/processor-registry.ts` y su spec — instancia por carga.
- `frontend/src/api/axios.ts`, `setupAxiosInterceptors.ts`, `notificaciones.ts`; `frontend/src/context/SocketContext.tsx`, `NotificacionesContext.tsx`; `frontend/src/hooks/useImportacionesEnCurso.ts`; `frontend/src/components/import/ImportProgress.tsx`, `ImportSummary.tsx`; `frontend/src/pages/ImportWizard.tsx`, `ImportDetail.tsx`; `frontend/src/components/layout/AppShell/NotificacionesPopover.tsx`, `ImportEnCursoItem.tsx`, `NotificacionItem.tsx`, `AppBar.tsx`.
- `docs/notificaciones-spec.md` (BE); `docs/ayuda/03-importacion/01-como-funciona.md`, `05-importar-un-archivo.md`, `08-historial-y-problemas.md` (FE).
- No se borra `backend/src/modules/imports/utils/progress-emitter.ts`: lo usa consolidación.

**Cambios de schema:** una tabla nueva, `import_progreso` (PK = FK a `remesa`, `onDelete: Cascade`), y el campo de relación `progreso` en `remesa`. Sin `ALTER` sobre tablas existentes, sin `@@unique`, sin tocar enums. **Sin backfill.** `npx prisma db push` sin `--accept-data-loss`.

**Tests a escribir:** `estado-carga.spec.ts` (porcentaje, clasificación, estado sintetizado, textos); `imports-progreso-eventos.spec.ts` (12 casos: secuencia de 2.500 filas, total 0, todo filtrado, FALLIDA antes y a mitad, `afterAll` que tira, todo con error, re-ejecución, sin fila previa, sin dueño, notificación y socket que fallan); `imports-progreso-http.spec.ts` (16 casos: encolado y sus 409/400/503, guardas de `validateRemesa`, MULTIRREGISTRO, hoja de Excel, `listarEnCurso`, `progreso`, `status`, `deleteRemesa`, `createRemesa`); `realtime.service.spec.ts` (una emisión); un caso más en `processor-registry.spec.ts`. Detalle en §8.9.1.

**Páginas de la wiki a tocar:** `docs/ayuda/03-importacion/01-como-funciona.md`, `05-importar-un-archivo.md`, `08-historial-y-problemas.md`. Verificar con `cd frontend && npm run verificar-ayuda` y pasar cada una por un agente revisor.

**Skills a consultar:** BE: `prisma-migration`, `nestjs-module`, `bullmq-worker`, `amsa-general`. FE: `react-component`, `amsa-general`.

**Riesgos durante la implementación:**
- `processImportJob` es el camino de toda la cartera: correr los specs de imports después de cada cambio en el worker.
- Si hace falta modificar un assert de un spec existente, parar: algo dejó de ser compatible.
- El `db push` de prod ejecuta también cualquier drift latente: chequeo previo de §8.6 (no se corrió).
- Si los dos commits se pushean juntos, el frontend llega antes que el backend.
- Un `P2002` en el alta ya no significa siempre "número repetido".
- En el frontend, `vite build` no chequea tipos: sin `tsc --noEmit` un error de contrato pasa de largo.
- Toda consulta de fondo tiene que ir con `silencioso`, o el modo offline inunda de toasts.
- `SocketContext` lo usan `ConsolidacionModal` e `ImportDetail`: `socket` y `conectado` no pueden cambiar de forma.
- Un rollback del backend choca con la tabla nueva (§8.6).

**Criterios de aceptación:** CA-1 a CA-22 de §8.11.
