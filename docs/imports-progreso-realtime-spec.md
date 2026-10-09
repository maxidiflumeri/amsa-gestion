# Progreso en tiempo real de las importaciones — diagnóstico y plan

> Estado: **diagnóstico cerrado (30/09/2026) · Fase A implementada, auditada y desplegada en prod el
> 05/10/2026 (imagen `a5ed9c4`) · Fase B diseñada, implementada y auditada el 09/10/2026
> ([§9](#9-diseño-de-la-fase-b)), sin desplegar y sin ver en un navegador · fases C y D sin empezar.**
> Al 09/10 la Fase A no corrió ni una vez con una carga real en prod: `import_progreso` tiene 0 filas (la
> última remesa es la 149, del 30/09). En local sí: la auditoría de la Fase B levantó la aplicación
> completa y corrió importaciones de punta a punta por primera vez (HTTP, socket, BullMQ, crons y MySQL
> juntos). Lo que cada fase dejó distinto de su diseño está en
> [§8.13](#813-lo-que-cambió-después-de-la-auditoría-05102026) y en
> [§9.15](#915-lo-que-cambió-después-de-la-auditoría-09102026): **donde §9.1 a §9.12 y §9.15 se
> contradicen, vale §9.15.** Las decisiones de producto de la Fase B que se tomaron por defecto y esperan
> la confirmación del usuario están en [§9.14](#914-lo-que-necesita-el-ok-del-usuario-antes-de-implementar).
> Origen: el usuario reportó cargas que terminan (remesa FINALIZADA) pero cuyo progreso nunca se
> completa en la UI, en la página de progreso y en el panel de notificaciones. Se auditó de punta a
> punta (agente `auditor`, veredicto **NO PASA**). Este documento es el punto de partida para
> implementar: leerlo entero antes de tocar código, y releer [notificaciones-spec.md](notificaciones-spec.md)
> (§ progreso de imports) porque varias cosas que ese spec promete el código no las hace.
>
> **Para retomar:** antes de desplegar la Fase B, el chequeo previo de [§9.6](#96-deploy) y, si se
> puede, el guion manual de §9.9.5 en un navegador. La fase siguiente es la C (§4), que necesita las
> decisiones abiertas de §5.4 y §5.6. Las decisiones de §5.1, §5.2 y §5.3 están cerradas. El diseño de la
> Fase A está en [§8](#8-diseño-de-la-fase-a); el architect verificó contra el código (HEAD `a0675dc`
> para la A, `a5ed9c4` para la B) cada referencia en la que se apoya, y lo que encontró inexacto o nuevo
> está en [§3.6](#36-correcciones-y-hallazgos-nuevos-del-architect-05102026) y en §9.1.

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

> **Actualización 09/10/2026 (architect, al diseñar la Fase B).** Los tres primeros puntos se pudieron
> medir sin esperar a la Fase B, leyendo CloudWatch (solo lectura, 181 corridas entre el 25/06 y el
> 30/09): la consolidación nunca pasó de 633 ms, hubo **una** re-ejecución por *stalled* (remesa 102, el
> 10/08, 60 s después de un deploy) y no hay ni una falla de renovación de lock, que es la huella que
> dejaría un bloqueo del event loop de más de 15-30 s. Los números y lo que cambian están en
> [§9.1](#91-alcance-impacto-y-riesgos).

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

> **Implementada y auditada el 05/10/2026, y desplegada en prod ese mismo día** (commits `51f5a2c`
> backend y `a5ed9c4` frontend + wiki; imagen del backend `a5ed9c4` desde las 21:42 UTC). **La prueba
> manual de §8.14 no se hizo:** se desplegó sin ella. Al 09/10/2026 tampoco hubo ninguna carga real
> encima (`import_progreso` con 0 filas en prod; última remesa, la 149 del 30/09), así que la Fase A
> todavía no corrió de punta a punta con la app real y el log `Post-proceso remesa=… terminó en …ms`
> nunca se escribió. Diseño en [§8](#8-diseño-de-la-fase-a); lo que cambió al auditar, en §8.13. La
> lista de abajo queda como registro del plan original, con lo hecho tildado. Siguen pendientes, fuera
> del código: limpiar en prod las remesas 93/98 y las notificaciones huérfanas (288 filas sobre 50
> remesas que ya no existen; preview y confirmación del usuario). Cambios de alcance que decidió el
> architect (justificados en §8.1):
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

> **Diseñada, implementada y auditada el 09/10/2026; sin desplegar.** Diseño en
> [§9](#9-diseño-de-la-fase-b); lo que cambió al auditar, en §9.15. La lista de abajo es el plan
> original, con lo hecho tildado; lo que el diseño cambió respecto de ella (justificado en §9.1):
>
> - **No se crea la fase FINALIZANDO** (duraría milisegundos) y **LEYENDO solo existe donde hay una
>   lectura que bloquea** (Excel y las tres categorías pre-parseadas). SUBIENDO es del navegador.
> - **El throttle es de 1 segundo, sin la regla del 5 %**, y persistir y emitir van siempre juntos.
> - **El latido deja de depender del avance**: lo da un reloj del tracker, cada 15 s.
> - **Una carga interrumpida no se re-ejecuta**: falla con motivo. Hoy BullMQ la re-ejecuta una vez
>   (pasó con la remesa 102 el 10/08).
> - **El umbral del reaper baja de 10 a 5 minutos** (§5.3).
> - **El parseo síncrono no se saca del event loop**: no hay evidencia de que haga falta (§9.5.12).
> - **Entra un cambio de schema**: una columna nullable, `import_progreso.fueraDeCorte` (§9.2).
> - **La estimación sube**: unos 4 días de backend y 2 de frontend, no 2 en total.

- [x] **[BUG #2]** Progreso **dentro** del lote: `ctx.reportar(n)` (o similar) cada ~200 filas o 1 s, también en processors por fila y en los pre-parseados (MULTIARCHIVO/MULTIRREGISTRO). Throttle real de 2 s / 5% como dice el spec de notificaciones, pero **sin comerse nunca el evento final**.
- [x] **[MEJORA]** Fases visibles: SUBIENDO (axios `onUploadProgress`) → EN_COLA (posición) → LEYENDO/PARSEANDO → PROCESANDO → POST_PROCESO (subfases con su %: reconciliación, consolidación N/M, bajas, recálculo de montos) → FINALIZANDO. La fase va en el estado persistido y en cada evento.
- [x] **[MEJORA]** `afterAll` reporta progreso propio por subfase (ACTUALIZACIONES, PAGOS, MULTI*, FACTURAS, MULTICLAVES). Logs intent/done con tiempo por fase (política de logging del CLAUDE.md) → así se mide lo de §3.5.
- [x] **[MEJORA]** Contadores en vivo: ok, errores, descartadas por filtro, nuevos, actualizados (los processors ya cuentan altas/actualizados internamente: exponerlos). Velocidad (filas/s, promedio móvil) y ETA.
- [x] **[BUG #14]** Heartbeat (`heartbeatAt` por lote/subfase) + reaper (cron) que marca FALLIDA si no hay heartbeat en N minutos y libera el bloqueo "una importación por usuario". Configurar BullMQ explícito (`attempts`, `lockDuration`, `maxStalledCount`) y decidir qué pasa si un job se re-ejecuta (no reiniciar el progreso en silencio). La Fase A ya deja `heartbeatAt` escrito por lote y `intentos` contado; el reaper tiene que cubrir también una carga que quedó `EN_COLA` sin job (proceso muerto entre el commit y el `queue.add`).
- [x] **[BUG #6]** Reaper de **borradores** (viene de la Fase A). TTL y predicado ya decididos en §5.2: no reabrir.
- [x] ~~**[BUG #15]** `reset()` de los processors singleton al **inicio** de cada carga (o processors por carga)~~ → **movido a la Fase A** como "processor por carga" (§8.5.6).
- [x] ~~Evaluar sacar el parseo síncrono de XLSX/MULTIARCHIVO del event loop (worker thread o streaming) si se confirma el bloqueo >45 s.~~ → **evaluado y diferido** (§9.5.12): no hay evidencia de bloqueo; la deriva del reloj del tracker lo deja medido en el log.

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
| 5.3 | Minutos sin heartbeat para declarar FALLIDA | **Cerrada** (architect, 09/10/2026): 5 minutos, por variable de entorno. Falta el OK del usuario al número (§9.14) |
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

### 5.3 — Cinco minutos sin latido, y el latido no depende del avance. (cerrada)

**Decisión (architect, 09/10/2026).** Una carga que ya arrancó se da por interrumpida cuando lleva **5
minutos sin latido** (`IMPORTS_LATIDO_UMBRAL_MIN`, default 5, acotado a [3, 120]) y además se cumplen
las tres condiciones de §9.5.6. El número necesita el OK del usuario (§9.14); el mecanismo, no.

**Por qué cambia la recomendación anterior** (10 minutos "a condición de que el post-proceso lata por
dentro"). Esa recomendación suponía un latido atado al avance: uno por lote o por tanda de
consolidación. Con ese latido el umbral tiene que superar al paso silencioso más largo, y ese paso no
se conoce: al 09/10 la Fase A lleva cuatro días en prod sin una sola carga, así que el log de
duración del post-proceso todavía no existe. La Fase B corta el problema de raíz en vez de adivinar el
número: **el latido lo da un reloj del tracker, cada 15 segundos, haga lo que haga la carga** (§9.5.2).
Mientras el proceso esté vivo, late; el umbral deja de depender de cuánto tarda un `afterAll`.

**Por qué 5 y no 10.** Con el latido por reloj, 5 minutos son 20 latidos seguidos perdidos. Lo único
que puede producir eso con la carga viva es un bloqueo del event loop de 5 minutos o una base que no
acepta escrituras durante 5 minutos, y en los dos casos el reaper no la mata igual, porque antes de
cerrar nada comprueba otras dos cosas que no dependen del latido (§9.5.6). El umbral ya no protege
contra un falso positivo: solo decide cuánto espera el usuario bloqueado. **Por qué no menos:** tiene
que superar con margen al lock de BullMQ (2 minutos, §9.5.1), que es una de esas dos comprobaciones.

Lo que sí se midió, y no hacía falta esperar a la Fase B para medirlo, está en §9.1.

### 5.4 a 5.6 — Recomendaciones (no bloquean la Fase B)

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

Las seis filas marcadas **B** están diseñadas en [§9](#9-diseño-de-la-fase-b); el mapa de cuál va en
qué sección está en §9.1. Además, la fila de ACCIONES re-ejecutada por BullMQ (marcada C) deja de
poder ocurrir con la política de §9.5.1: una carga interrumpida ya no se re-ejecuta. Lo que sigue
para la C es qué hace el botón Revertir en una carga interrumpida o con advertencias.

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

## 9. Diseño de la Fase B

> Architect, 09/10/2026, sobre HEAD `a5ed9c4` (árbol limpio). Es lo que ejecutan dos `implementer` en
> paralelo (backend y frontend) y lo que tres `auditor` intentan romper. Las referencias
> `archivo:línea` de esta sección se verificaron una por una contra el código. Qué se verificó
> **ejecutando**, qué **leyendo** y qué es **suposición** está en [§9.13](#913-qué-se-verificó-y-qué-es-suposición).
>
> **La idea en cinco líneas.** (1) El tracker gana un reloj propio: late cada 15 segundos aunque no
> avance ninguna fila, y vuelca a la base —a lo sumo una vez por segundo— lo que el runner y los
> processors le fueron contando en memoria. (2) Una carga nunca se re-ejecuta sola: si su worker
> murió, falla con motivo y decide una persona. (3) Un reaper la cierra a los 5 minutos sin latido, y
> solo si tres comprobaciones independientes dicen que nadie la está procesando. (4) El post-proceso
> deja de ser una caja negra: cada processor dice en qué paso está y cuánto lleva. (5) Un borrador de
> más de 24 horas se borra solo.

### 9.1 Alcance, impacto y riesgos

**Qué entra** (ítem de §4 "Fase B" o fila "B" de §8.13 → dónde está diseñado):

| Ítem | Sección |
|---|---|
| #2 progreso dentro del lote y throttle | §9.5.2, §9.5.3, §9.5.4 |
| Fases visibles (subiendo, posición en la cola, leyendo, subfases del post-proceso) | §9.3, §9.5.9, §9.8 |
| `afterAll` con progreso propio y logs con tiempo por paso | §9.4.4, §9.5.4, §9.5.11 |
| Contadores en vivo: nuevos, actualizados, descartadas por filtro; velocidad y ETA | §9.4.1, §9.5.4, §9.5.9 |
| #14 latido, reaper de cargas colgadas, BullMQ explícito, política de re-ejecución | §9.5.1, §9.5.2, §9.5.5, §9.5.6 |
| La carga `EN_COLA` sin job (proceso muerto entre el commit y el `queue.add`) | §9.5.6 (caso R2) |
| #6 reaper de borradores (predicado y TTL de §5.2) | §9.5.7 |
| Parseo síncrono fuera del event loop ("evaluar") | §9.5.12 — **se difiere**, con el motivo |
| §8.13: `descartadas` no distingue "filtro de la plantilla" de "fuera del corte" (y el texto inflado de SIN_FILAS en el detalle) | §9.2, §9.5.3, §9.5.10, §9.8 |
| §8.13: "sin novedades" no cubre Post-proceso ni En cola; el latido es uno por lote | §9.5.2, §9.8.3 |
| §8.13: una carga que ya arrancó y queda colgada no tiene salida por la aplicación | §9.5.5, §9.5.6 |
| §8.13: confirmar y borrar la misma remesa a la vez puede dar OK a las dos | §9.5.8 |
| §8.13: la compensación del encolado puede devolver a borrador una carga que el worker ya tomó | §9.5.8 |
| Tests de la secuencia de eventos por categoría | §9.9 |

**Mediciones nuevas.** §3.5 daba por no medible, hasta la Fase B, cuánto tarda cada `afterAll`, si
hubo jobs re-ejecutados y si un archivo grande bloquea el event loop. Tres de esas cosas ya estaban en
los logs de prod. Lectura de CloudWatch (`/amsa-gestion/backend`, Logs Insights, solo lectura; el grupo
no tiene vencimiento), del 25/06 al 30/09/2026: **181 corridas** de `processImportJob`.

| Qué | Medido | Qué cambia |
|---|---|---|
| Duración total de una corrida | 78 de hasta 10 s · 27 de hasta 30 s · 18 de hasta 1 min · 14 de hasta 2 min · 18 de hasta 5 min · 17 de hasta 10 min · 6 de hasta 30 min · **2 de más de una hora** (remesas 52 y 49, 5.494 s y 5.092 s, las dos del 21/07, antes de la optimización por lote del 27/07) | El latido no puede depender de que la carga sea corta |
| Parseo síncrono de las categorías pre-parseadas | MULTIRREGISTRO **18 a 22 ms** (1.570 a 1.790 líneas) · MULTIARCHIVO **53 a 110 ms** (unos 850 casos) · MULTICLAVES **1.123 ms** (16.535 líneas) | El "0 % durante 102-314 s" de MULTIARCHIVO (§3.1) **no era el parseo**: eran ~850 filas procesadas de a una, a 0,12-0,37 s cada una, dentro de un único lote. Lo arregla el progreso por fila, no un worker thread |
| `consolidar` (la parte del `afterAll` que se suponía pesada) | 68 llamadas registradas, la más lenta **633 ms**; 17.358 deudores en 238 ms; 8.875 en 130 ms | La consolidación no es el paso lento. Lo son los bucles por deudor: la desasignación (342.792 deudores en la remesa 50, corrida de 1.347 s) y el cierre de ausentes de ACTUALIZACIONES |
| Re-ejecución por *stalled* | **Una**: remesa 102 (job 144), el 10/08. Arrancó 17:52:45; el contenedor nuevo levantó 18:00:52; BullMQ la volvió a entregar **18:01:52**, y falló porque los archivos ya no estaban | Con la configuración de hoy un deploy a mitad de carga **sí re-ejecuta** la carga, un minuto después de levantar. Es el comportamiento que §9.5.1 cambia |
| `could not renew lock` / `Missing lock` | **0 líneas** sobre unos 2,1 millones de eventos | Es lo que deja BullMQ cuando el event loop se bloquea más de 15-30 s con un job activo. No pasó ni una vez |

Y una medición local, sintética (máquina de desarrollo, `xlsx.readFile` + `sheet_to_json` con las
mismas opciones que `recorrer-filas.ts:104-110`, 20 columnas): 5.000 filas, 0,17 s · 20.000, 0,77 s ·
60.000, 2,4 s · 150.000, **5,9 s y 1,4 GB de heap**. Un Excel no llega a bloquear 45 s: antes se queda
sin memoria. Y un proceso que muere por memoria es, justamente, el caso del reaper.

**Qué no entra, y se va a seguir viendo después de la Fase B:**

- El componente único `ImportProgressCard`, el stepper de fases, los últimos errores en vivo, el
  Historial que distingue borradores y "con advertencias" (Fase C).
- La carga dividida orquestada en el backend, cancelar y reintentar una FALLIDA (Fase C). Una carga
  interrumpida queda FALLIDA con el motivo; volver a cargarla es volver a subir el archivo.
- El resumen final por categoría. PAGOS no informa `nuevos` / `actualizados` (sus números son otros:
  aplicados, ya cargados, negativos) y eso va en el `resumen` de la Fase C.
- **Una carga viva que no avanza** (un `await` que nunca vuelve) no se cierra sola: el proceso está
  vivo y late. Se ve —en el log del reaper y en la pantalla— pero cerrarla desde afuera con el
  worker todavía ocupado dejaría la cola trabada sin que nadie lo sepa. Sale con un reinicio.
- El cierre ordenado al recibir `SIGTERM` (marcar la carga como interrumpida en el momento del
  deploy, en vez de 5 a 7 minutos después): necesita el mismo mecanismo que "cancelar". Fase C.
- Los archivos de los borradores que el reaper borra quedan en el disco (decisión de §5.2: tampoco los
  borra `deleteRemesa`). Es deuda conocida: se acumulan en el volumen `uploads`.
- 93, 98 y las notificaciones huérfanas siguen en la base de prod. Fuera de alcance.

**Ítems que cambian respecto del plan de §4**

| Ítem | Cambio | Por qué |
|---|---|---|
| Fase FINALIZANDO | **No se crea** | Entre el fin del post-proceso y el estado terminal hay un `count`, un `updateProgress` y una escritura: milisegundos. Sería una escritura y un evento más por carga, y una palabra en mayúsculas en las pestañas viejas, para un estado que nadie llega a ver |
| Fase LEYENDO | Solo en Excel y en las tres categorías pre-parseadas | Un CSV o un TXT se leen por *stream*, intercalados con el procesamiento: no hay una fase de lectura que mostrar |
| Throttle "2 s o 5 %" | **1 segundo, sin la regla del 5 %** | Persistir y emitir van juntos (si no, un `GET` devuelve algo más viejo que el último evento y la barra retrocede). Con una sola cadencia fija no hay ráfagas, y un `UPDATE` por segundo es ruido al lado de lo que hace cada fila. La regla del 5 % solo agregaba hasta 20 escrituras en cargas que duran segundos |
| Progreso dentro del lote en los processors por lote | En ACTUALIZACIONES y FACTURAS; MULTICLAVES no | MULTICLAVES resuelve el lote en una transacción: no hay un "adentro" que informar |
| `nuevos` / `actualizados` | Cinco categorías; las otras seis quedan en `null` | Solo se expone lo que el processor sabe con certeza (§9.5.4) |
| Umbral del reaper | 10 → **5 minutos** | §5.3 |
| Parseo síncrono | **Se difiere** | §9.5.12 |
| Schema | **Una columna nueva** | §9.2. Contradice lo que decía §8.2 ("no necesita otro cambio de schema en toda la evolución"): separar las descartadas no se había previsto |
| Carreras de §8.13 | Entran las dos | §9.5.8 |

**Supuesto que sostiene el diseño: hay un solo proceso de backend.** Prod es una EC2 con un contenedor
de backend y uno de Redis; el deploy recrea el contenedor (para el viejo y levanta el nuevo: no hay
dos procesos de la app a la vez). La garantía más fuerte del reaper —"esta carga la estoy procesando
yo"— es un registro en memoria, por proceso. Con dos procesos el diseño no se rompe (siguen
protegiendo el latido y el lock de BullMQ), pero esa garantía ya no cubriría las cargas del otro
proceso y habría que llevar el registro a Redis. **Si alguna vez se escala el backend, releer §9.5.6.**

**Impacto.** Backend: `ProgresoTracker`, `ImportService` (worker, encolado, borrado, vista previa,
lecturas), `ImportsProcessor` e `ImportModule` (opciones de BullMQ), el contrato de los processors y
ocho archivos de processors, que cubren nueve de las once categorías (solo agregan llamadas de
reporte: no cambia ninguna regla de negocio),
`utils/monto-facturas.ts`, y dos crons nuevos —los primeros del módulo de imports—. Frontend: el
wizard (subida, "Importando", resultado), `AvisosCarga`, el detalle y el ítem de la campanita. No
cambian `SocketContext`, `NotificacionesContext`, `useImportacionesEnCurso` ni `ImportHistory`.
Schema: una columna nullable. Ningún permiso nuevo.

**Qué se rompe si sale mal:**

1. *El reaper mata una carga viva.* Es el peor desenlace: el usuario ve "falló", vuelve a cargar, y la
   primera sigue corriendo. Mitigado con tres comprobaciones independientes, dos pasadas seguidas y
   una relectura bajo `FOR UPDATE` (§9.5.6); y si igual pasara, el tracker de la carga viva se detiene
   solo en su próxima escritura (§9.5.2), no la deja seguir a ciegas.
2. *El reloj del tracker tumba el proceso.* Una promesa rechazada sin manejar dentro de un
   `setInterval` mata a Node. Todo lo que corre en el reloj va en `try/catch` y hay un test que lo
   prueba (§9.9).
3. *El reaper de borradores borra lo que no debe.* Es el primer job del sistema que borra remesas
   solo. Su predicado está fijado en §5.2, se relee bajo `FOR UPDATE` por remesa, y no toca nada que
   tenga un caso ni nada que el código nuevo no haya creado como borrador (§9.5.7).
4. *Un reporte de progreso cambia lo que hace un processor.* Los ocho archivos tocados son el camino
   de toda la cartera, y dos de ellos (ACTUALIZACIONES, PAGOS) son destructivos. Los reportes son
   sincrónicos, no hacen IO, no pueden tirar, y el campo del contexto es opcional: los specs de los
   processors pasan sin tocarlos (§9.4.4, §9.9).
5. *El deploy.* El `db push` agrega una columna; si pidiera confirmación, el backend no levanta.
   Mitigado: el diff verificado es un único `ADD COLUMN … NULL` (§9.2).

**Datos ya cargados.** Ninguna fila existente se modifica. **No hay backfill:** `fueraDeCorte` queda en
`null` en las cargas anteriores, y `null` significa exactamente eso ("la remesa no tiene corte, o es
anterior a la Fase B"). En prod, hoy, `import_progreso` no tiene filas.

### 9.2 Datos

**Un campo nuevo** en `model import_progreso` (`backend/prisma/schema.prisma`), a continuación de
`descartadas`:

```prisma
  /// Fase B. De las `descartadas`, cuántas pasaban el filtro de la plantilla pero pertenecen a otro
  /// corte de la división (`remesa.filtroFilas`). Siempre es <= `descartadas`.
  /// null = la remesa no tiene corte propio, o la carga es anterior a la Fase B.
  fueraDeCorte       Int?
```

Y se corrige el comentario de `descartadas`, que hoy dice "(o el corte de la división)" sin separar:
"Filas del archivo que no entraron en esta remesa y no son error: las que descartó el filtro de la
plantilla **más** las de otros cortes (`fueraDeCorte`)."

**Por qué una columna y no otra cosa:**

- *No se cambia el significado de `descartadas`.* Sigue siendo el total, como en la Fase A, y
  `fueraDeCorte` es un subconjunto. Las pestañas viejas siguen viendo lo mismo que hoy, y el único
  assert existente que mira ese número (`imports-progreso-eventos.spec.ts:277-279`, caso B-3, que
  filtra justamente con `remesa.filtroFilas`) pasa sin tocarlo. Lo que el usuario quiere ver —las
  descartadas por el filtro de la plantilla— es la resta, y la hace el backend
  (`descartadasPorFiltro`, §9.4.1).
- *No va en `resumen` (JSON).* Es un contador en vivo, que se escribe en cada escritura junto con
  `descartadas`; `resumen` es el resumen final por categoría de la Fase C. Meterlo ahí obligaría a
  leer y reescribir un JSON una vez por segundo y le condicionaría el formato a la Fase C.
- *Es la única.* La posición en la cola, la velocidad y la ETA **no se persisten**: se calculan al
  armar el DTO (§9.5.9). La subfase usa la columna `subfase` que ya existe, como texto ya armado
  ("Consolidando casos: 1.500 de 8.875"): no se agregan columnas para sus números.

**El `db push`.** SQL que genera, verificado con `prisma migrate diff` (solo lectura) contra la base
local —MySQL 8.0, sincronizada con el schema de HEAD (el diff de HEAD contra sí misma da `This is an
empty migration`)—:

```sql
ALTER TABLE `import_progreso` ADD COLUMN `fueraDeCorte` INTEGER NULL;
```

- Una sola sentencia, sobre una tabla que en prod tiene 0 filas. Sin `@@unique`, sin enum, sin columna
  obligatoria, sin cambio de tipo: ninguna de las condiciones por las que Prisma pide
  `--accept-data-loss`. **No verificado ejecutando el push** (está fuera de lo que el architect puede
  correr): lo verifica el paso BE-1, con orden de parar si Prisma lo pide.
- Si el push se corta, o la columna está o no está: no hay estado intermedio.

**Lo que se puebla en la Fase B:** `subfase`, `nuevos`, `actualizados`, `fueraDeCorte`, y el valor
`LEYENDO` en `fase`. Siguen para la Fase C: `resumen`, `grupo*`, `cancelSolicitadaAt`. `intentos` deja
de pasar de 1 (§9.3).

**Procedimientos de wipe.** Sin cambios: la columna vive en una tabla que las listas ya incluyen.

### 9.3 Máquina de estados: lo que cambia

La tabla de §8.3 sigue valiendo. Se agregan cuatro filas y cambian dos reglas.

| Momento | Quién | `estadoProceso` | `fase` | `finishedAt` | `resultado` |
|---|---|---|---|---|---|
| Antes de leer un Excel o de parsear un paquete | `tracker.entrarEnLectura` | PROCESANDO | **LEYENDO** | null | null |
| Llega la primera fila | `tracker.avance` (memoria; lo persiste el reloj o el primer lote) | PROCESANDO | PROCESANDO | null | null |
| El worker murió y nadie la procesa | `cerrarCargaInterrumpida` (reaper, o el worker si BullMQ se la vuelve a entregar) | FALLIDA | TERMINADA | ahora | FALLIDA |
| Quedó en la cola sin job | `cerrarCargaInterrumpida` (reaper) | FALLIDA | TERMINADA | ahora | FALLIDA |

**Fases.** El valor de `fase` que se persiste puede ser: `BORRADOR`, `EN_COLA`, `LEYENDO`,
`PROCESANDO`, `POST_PROCESO`, `TERMINADA`. Nada más.

- **SUBIENDO no es una fase de la carga.** El archivo se sube al crear el borrador
  (`POST /import/remesas`, `ImportWizard.tsx:409`), antes de la vista previa: cuando existe una carga,
  el archivo ya está en el servidor. Es un estado de la pantalla, medido con `onUploadProgress`
  (§9.8.4). No se persiste ni viaja por el socket.
- **La posición en la cola no es una fase:** es un dato de `EN_COLA` (`enColaDelante`, §9.5.9).
- **LEYENDO** va desde que el worker tomó el job hasta que hay una primera fila para procesar, y solo
  cuando esa espera es una lectura que bloquea: un Excel (`xlsx.readFile`, síncrono) o una categoría
  pre-parseada. `import:iniciada` se sigue emitiendo con `fase: 'PROCESANDO'` (es lo que promete
  §8.4.2 y lo que afirma el caso B-1); LEYENDO llega enseguida, en un `import:progreso`.
- **Las subfases** son texto libre dentro de `POST_PROCESO` (columna `subfase`), no fases.

**Regla que cambia 1 — una carga no se re-ejecuta.** §8.3 decía: "Re-ejecución: el worker vuelve a
pasar por `iniciar`, que incrementa `intentos`, pone los contadores en cero…". Pasa a ser:

> Si BullMQ vuelve a entregar el job de una carga que **ya había arrancado** (la fila tiene
> `startedAt` y no tiene `finishedAt`), el worker **no la procesa**: la cierra como FALLIDA, con el
> motivo de interrupción, y el job termina sin haber tocado una fila. `intentos` queda en 1.

Con `maxStalledCount: 0` BullMQ no debería volver a entregarla nunca (§9.5.1); la guarda en el código
es la que **garantiza** la política aunque alguien cambie esa opción o reintente un job a mano.

**Regla que cambia 2 — "un estado terminal nunca se pisa" pasa de convención a condición de la
escritura.** En la Fase A lo sostenían una lectura previa y una bandera en memoria del tracker. Ahora
que hay un segundo escritor del estado terminal (el reaper), cada escritura del tracker lleva la
condición en su `where`, y la del reaper relee bajo `FOR UPDATE` (§9.5.2, §9.5.5):

- El tracker solo escribe si `estadoProceso ∉ {FINALIZADA, FALLIDA}`. Si no, la escritura no afecta
  nada, el tracker se da por **cerrado por fuera** y la carga se detiene en el próximo lote.
- `cerrarCargaInterrumpida` no escribe si la remesa ya es terminal, si no está encolada, o si la
  carga está viva en este proceso.

`clasificarResultado` y `calcularPorcentaje` no cambian. Una carga cerrada por interrupción conserva
el último porcentaje y los contadores **que estaban persistidos**, que pueden ir hasta un segundo
atrás de lo realmente procesado (el intervalo del reloj).

### 9.4 Contratos

Igual que en §8.4: este apartado es lo que permite implementar el frontend sin esperar al backend.

#### 9.4.1 Tipos (lo que se agrega a §8.4.1)

`backend/src/modules/imports/progreso/estado-carga.types.ts` y, copia textual,
`frontend/src/types/importProgreso.ts`:

```ts
/** La Fase B agrega LEYENDO. El cliente sigue tratando cualquier otro string como
 *  "en curso, fase que no conozco". */
export type FaseCarga = 'BORRADOR' | 'EN_COLA' | 'LEYENDO' | 'PROCESANDO' | 'POST_PROCESO' | 'TERMINADA';

export interface EstadoCargaDto {
    // … todo lo de §8.4.1, sin cambios de nombre ni de tipo, más:

    /** Texto del paso del post-proceso, ya armado para mostrar ("Consolidando casos: 1.500 de 8.875").
     *  null fuera de POST_PROCESO o si el processor no informa. (El campo ya existía; ahora se puebla.) */
    subfase: string | null;

    /** Filas del archivo que no entraron en esta remesa y no son error. Mismo significado que en la
     *  Fase A: el TOTAL (filtro de la plantilla + otros cortes). */
    descartadas: number;
    /** De las `descartadas`, las que eran de otro corte de la división. null = la remesa no tiene
     *  corte propio, o la carga es anterior a la Fase B. */
    fueraDeCorte: number | null;
    /** `descartadas − (fueraDeCorte ?? 0)`: las que descartó el filtro de la plantilla. Es el número
     *  que se muestra como "Descartadas". Lo calcula el backend. */
    descartadasPorFiltro: number;

    /** Casos que esta carga creó. null si la categoría no lo informa (§9.5.4). */
    nuevos: number | null;
    /** Casos que ya existían y esta carga tocó. null si la categoría no lo informa. */
    actualizados: number | null;

    /** Solo en EN_COLA: cuántas cargas en curso se confirmaron antes que esta, contando la que
     *  está corriendo. 0 = es la próxima. null si no aplica o no se pudo calcular. */
    enColaDelante: number | null;
    /** Solo en PROCESANDO: filas por segundo, promedio desde que arrancó, con un decimal.
     *  null si no aplica o todavía no hay con qué calcularla. */
    velocidad: number | null;
    /** Solo en PROCESANDO: segundos que faltan para terminar las FILAS a esa velocidad. No incluye
     *  el post-proceso. null si no aplica. */
    etaSegundos: number | null;
}
```

Cambia una precisión de un campo existente: **`procesadas` ya no es siempre `ok + err`.** En las
categorías que procesan por lote (ACTUALIZACIONES, FACTURAS) puede ir adelantada dentro del lote en
curso: son filas ya trabajadas que todavía no se sabe si salieron bien. En cada fin de lote, y en el
estado terminal, vuelve a valer `ok + err`. Siempre `procesadas >= ok + err`.

`intentos` deja de pasar de 1. El campo se conserva (lo leen las pestañas viejas).

#### 9.4.2 Eventos de socket

Los tres eventos, las salas y las cinco garantías de §8.4.2 no cambian. Cambia **cuándo** sale
`import:progreso`:

| Cuándo | Cadencia | Novedad |
|---|---|---|
| Al encolar (`EN_COLA`), con `enColaDelante` | Una vez | El campo |
| Antes de una lectura que bloquea (`LEYENDO`) | Una vez, solo en Excel y pre-parseadas | Nuevo |
| Después de cada lote persistido | Siempre, como en la Fase A | — |
| **Dentro** de un lote, y durante el post-proceso | **A lo sumo uno por `IMPORTS_PROGRESO_INTERVALO_MS`** (default 1.000 ms), y solo si algo cambió desde la última escritura | Nuevo |
| Al entrar al post-proceso | Una vez, como en la Fase A | — |

- Sigue valiendo "se persiste **antes** de emitirse": no hay eventos sin escritura detrás.
- **El latido no emite nada.** Cuando no hay nada que contar, el reloj escribe solo `heartbeatAt` cada
  15 s. El cliente lo ve en el próximo evento o en su próxima consulta por HTTP (el hook ya consulta
  cada 30 s cuando el socket está callado: `utils/estadoCarga.ts:10`, `useEstadoCarga.ts:157-164`).
- `import:finalizada` puede salir ahora **sin que haya un worker**: la emite `cerrarCargaInterrumpida`
  cuando el reaper cierra una carga. Mismas salas, mismo payload, `resultado: 'FALLIDA'`.
- `rev` crece también con las escrituras del latido, que no se emiten: entre dos eventos seguidos
  puede saltar de a más de uno. Sigue siendo estrictamente creciente, que es lo único que se promete.

#### 9.4.3 HTTP

Ninguna ruta nueva, ningún permiso nuevo (nada que declarar en `permisos-catalogo.ts`).

| Método y ruta | Qué cambia |
|---|---|
| `GET /import/remesas/:id/progreso`, `GET /import/en-curso`, `GET /import/remesas/:id` (`carga`) | El DTO trae los campos de §9.4.1. `enColaDelante` se calcula en estas tres lecturas |
| `POST /import/ejecutar/:id` | `carga.enColaDelante`. **Nuevo `404`** "La importación fue eliminada mientras se confirmaba." (§9.5.8). **`201` en vez de `503`** cuando el encolado venció por tiempo pero el worker ya tomó la carga (§9.5.8) |
| `POST /import/validar/:id` | La respuesta agrega `fueraDeCorte?: number`. `descartadas` no cambia de significado (total). `filtro` describe solo el filtro de la plantilla (§9.5.10) |
| `DELETE /import/remesas/:id` | **Nuevo `409`** "Esta importación se acaba de confirmar. Si igual querés eliminarla, volvé a intentarlo." (§9.5.8) |

#### 9.4.4 Contrato con los processors

Un campo **opcional** en `ProcessContext` (`processors/processor.interface.ts:20-105`):

```ts
/** Canal por el que el processor le cuenta su avance al runner. OPCIONAL: los specs que arman el
 *  contexto a mano no lo traen, y todo processor lo usa con `ctx.progreso?.…`. */
progreso?: ReporteProgreso;

export interface ReporteProgreso {
    /** Solo en `processBatch`: cuántas filas del lote en curso ya están resueltas (acumulado
     *  dentro del lote, de 0 a `rows.length`). */
    filasDelLote(n: number): void;
    /** Solo en `afterAll`: en qué paso está y cuánto lleva. Sin `total` (o con 0) es un paso sin
     *  medida. Llamarla con otro `nombre` es pasar al paso siguiente. */
    subfase(nombre: string, hecho?: number, total?: number): void;
    /** Casos nuevos y actualizados de la carga hasta ahora: valores ABSOLUTOS, no incrementos. */
    contadores(c: { nuevos?: number; actualizados?: number }): void;
}
```

Reglas, que son las que hacen que tocar ocho processors no sea un riesgo:

1. **Los tres métodos son sincrónicos y devuelven `void`.** No hacen IO: anotan en la memoria del
   tracker y vuelven. No hay nada que esperar (`await`) ni promesa que pueda quedar sin manejar.
2. **Nunca tiran.** Cada uno va en `try/catch` del lado del tracker; un reporte roto es un `warn`.
3. **El throttle no es problema del processor.** Puede llamar en cada vuelta de un bucle: cuándo se
   escribe y se emite lo decide el reloj del tracker (§9.5.2).
4. **Con `ctx.progreso` ausente no cambia ninguna llamada a un colaborador.** Esto es literal y está
   afirmado por un test que ya existe: `facturas.processor.spec.ts:253` espera
   `consolidar` llamado con **un solo argumento** (`toHaveBeenCalledWith({ tipo: 'DEUDORES',
   deudorIds: [1] })`). Pasarle siempre un segundo argumento con `onProgress` lo rompería. Por eso
   toda consolidación del post-proceso pasa por un único helper:

```ts
// backend/src/modules/imports/utils/reporte-progreso.ts (nuevo)
export function consolidarConProgreso(ctx: ProcessContext, scope: ConsolidacionScope, nombre: string) {
    // Sin canal de reporte, la llamada es EXACTAMENTE la de siempre (un argumento).
    if (!ctx.progreso) return ctx.consolidacion.consolidar(scope);
    ctx.progreso.subfase(nombre);
    return ctx.consolidacion.consolidar(scope, {
        onProgress: (hecho, total) => ctx.progreso?.subfase(nombre, hecho, total),
    });
}
```

   `consolidar` ya acepta `onProgress` y lo llama una vez por tanda de 500 deudores
   (`consolidacion.service.ts:206-214`, `:268-269`): no se toca `ConsolidacionSituacionService`.
5. **Los nombres de las subfases viven en un solo lugar** (`reporte-progreso.ts`, constante
   `SUBFASE`), para que la pantalla, la wiki y los tests digan lo mismo. Lista en §9.5.4.

El runner arma el canal y lo pone en el contexto que ya construye (`imports.service.ts:2147-2175`).
`afterAll(ctx)` no cambia de firma.

#### 9.4.5 Compatibilidad

- **Backend nuevo con pestañas de la Fase A** (las va a haber):
  - Campos nuevos: los ignora. `descartadas` significa lo mismo que hoy.
  - `fase: 'LEYENDO'`: `etiquetaFase` muestra el valor tal cual y `barraIndeterminada` devuelve
    `true` para cualquier fase en curso que no sea PROCESANDO (`utils/estadoCarga.ts:68-69`,
    `:214-215`). Se ve la palabra "LEYENDO" con una barra sin porcentaje, unos segundos.
  - `subfase`: el frontend de la Fase A no lo dibuja en ningún lado. Sigue mostrando su texto fijo.
  - Un evento por segundo en vez de uno por lote: los handlers fusionan por `rev`; no cambia nada.
  - El aviso "Sin novedades del servidor hace N min" de la Fase A (5 minutos, solo PROCESANDO) pasa a
    ser más preciso sin tocarlo: `heartbeatAt` ahora late cada 15 s.
  - Una carga cerrada por el reaper le llega como una `import:finalizada` FALLIDA común, con el motivo
    en `error`: la muestra como "La importación falló" más el texto.
- **Frontend nuevo con backend de la Fase A.** Degrada sin romperse —`enColaDelante`, `velocidad`,
  `fueraDeCorte` y `descartadasPorFiltro` llegan `undefined` y cada lectura tiene su respaldo
  (§9.8.1)—, pero **mentiría**: los textos nuevos prometen que una carga sin señal "se marca como
  fallida sola", y el backend de la Fase A no lo hace. El orden de §9.6 sigue siendo obligatorio.
- **Jobs en vuelo durante el deploy:** §9.6.

### 9.5 Backend — lógica crítica

#### 9.5.1 BullMQ explícito y política de re-ejecución

Hoy el worker y la cola corren con los defaults (`bullmq/imports.processor.ts:10`,
`imports.module.ts:17-19`). Pasan a declararlos, como constantes exportadas para poder afirmarlas en
un test:

```ts
// bullmq/imports.processor.ts
export const OPCIONES_WORKER_IMPORT = {
    concurrency: 1,          // las cargas van de a una: es lo que supone todo el diseño
    lockDuration: 120_000,   // BullMQ lo renueva cada 30 a 60 s
    stalledInterval: 30_000, // el default, explícito
    maxStalledCount: 0,      // un job cuyo worker murió NO se vuelve a ejecutar
} as const;

@Processor('import-queue', OPCIONES_WORKER_IMPORT)

// imports.module.ts
BullModule.registerQueue({ name: 'import-queue', defaultJobOptions: { attempts: 1 } })
```

**La política, en una frase: una carga nunca se re-ejecuta sola.** Si el worker muere a mitad de una
carga —un deploy, un corte, el proceso sin memoria—, la carga **falla con motivo**, con los contadores
de lo que llegó a procesar, y una persona decide qué hacer.

Por qué no re-ejecutar desde cero, que es lo que hace hoy:

1. **Está demostrado que rompe datos.** ACCIONES re-ejecutada duplica los comentarios y pierde los
   snapshots del primer intento (§8.13): el botón Revertir deja de deshacer lo que ese intento cambió.
2. **Del resto no hay demostración de lo contrario.** Que DEUDORES o FACTURAS sean idempotentes ante
   un corte a mitad de camino es razonable por lectura, pero ninguna categoría se probó así. En un
   sistema cuyo modo de falla es perder datos en silencio, "razonable" no alcanza para automatizar.
3. **La re-ejecución corre con el código nuevo sobre una carga a medias del código viejo.** Un deploy
   es justo el momento en que cambia el código.
4. **Es la regla de §4:** no reiniciar el progreso en silencio.
5. **Ya salió mal en prod.** El 10/08 la remesa 102 se re-ejecutó sola un minuto después de un deploy y
   falló porque los archivos ya no estaban.

La re-ejecución de una FALLIDA va a existir, como una acción explícita de una persona, en la Fase C
("reintentar"), que es donde corresponde discutir la idempotencia categoría por categoría.

**Qué hace cada opción:**

- **`maxStalledCount: 0`.** Cuando BullMQ detecta un job activo sin lock (su worker murió), lo
  devuelve a la cola marcado para fallar, y el worker que lo toma lo falla **sin llamar al processor**
  (`moveStalledJobsToWait-8.lua:87-92`; `classes/worker.js:562`, `:596-599`, en
  `backend/node_modules/bullmq/dist/cjs/`). Con el default (1) lo volvía a ejecutar una vez.
- **`attempts: 1`.** Un job que tira no se reintenta. Es el default; queda escrito.
- **`lockDuration: 120_000`.** El lock es la señal de vida que BullMQ mira. Se renueva por un timer
  cada 30 a 60 s (`lock-manager.js:74`, `:83`), así que siempre le quedan al menos 60 s: un bloqueo
  del event loop de menos de un minuto no lo pierde. Con el default (30 s) lo perdía a partir de 15 s.
  El costo: BullMQ tarda hasta un minuto y medio más en notar un worker muerto. No importa, porque
  el que cierra la carga es el reaper, no BullMQ.
- **`concurrency: 1`.** Es el default. Explícito porque el registro de cargas vivas, la posición en la
  cola y el orden de las remesas de una división lo dan por hecho.

**Qué pasa en cada caso:**

| Situación | Hoy (defaults) | Con la Fase B |
|---|---|---|
| El worker muere a mitad de una carga (deploy, corte, memoria) | BullMQ la vuelve a entregar ~60 s después de que levanta el proceso nuevo y se **re-ejecuta desde cero**. La pantalla dice "se reinició (intento 2)" | BullMQ falla el job sin ejecutarlo. La carga queda PROCESANDO hasta que el reaper la cierra como **FALLIDA, con motivo**, entre 5 y 7 minutos después del último latido (§9.5.6). Nadie la re-ejecuta |
| El event loop se bloquea con el worker **vivo** más de lo que dura el lock | A partir de 15-30 s: BullMQ da el job por perdido, y cuando la corrida viva termina, lo vuelve a entregar (lo ignora la guarda de la Fase A: la carga ya terminó) | A partir de 60-120 s: igual, salvo que BullMQ falla el job en vez de re-entregarlo. **La carga termina bien**: su estado lo da la base, no BullMQ. El reaper no la toca (§9.5.6) |
| BullMQ vuelve a entregar igual el job de una carga que ya arrancó (alguien cambió la opción, o reintentó a mano) | Se re-ejecuta | La guarda de §9.5.3 la cierra como interrumpida sin procesar nada |
| El job tira | No se reintenta | Igual |

**Tres listeners que solo loguean**, en `ImportsProcessor`, con `@OnWorkerEvent` (el patrón ya está en
`consolidacion/bullmq/consolidacion.processor.ts`):

| Evento | Nivel | Qué |
|---|---|---|
| `stalled` (jobId) | `warn` | "BullMQ dio por perdido el job N de la cola de importaciones" |
| `error` (err) | `warn` | El mensaje. Hoy BullMQ lo manda a `console.error`, sin `requestId`; acá entra la falla de renovación de lock, que es la huella de un event loop bloqueado |
| `failed` (job, err) | `warn`, **solo** si el mensaje dice `stalled` | "El job N (remesa X) falló sin ejecutarse: …; la carga la cierra el reaper" |

**Ninguno escribe en la base.** Se evaluó usar `failed` como vía rápida para cerrar la carga en 2-3
minutos en vez de 5-7. Se descartó: habría dos escritores del cierre por interrupción en vez de uno, y
el segundo dependería de un comportamiento de BullMQ que se leyó en el código pero no se ejecutó
(§9.13). Un solo camino que cierra, el reaper, se audita mejor.

#### 9.5.2 El tracker: un reloj, reportes en memoria y escrituras condicionadas

`ProgresoTracker` (`progreso/progreso-tracker.ts`) deja de escribir solo cuando el runner se lo pide.
La API de la Fase A se conserva entera; se agrega:

```ts
export interface ContadoresCarga {
    ok: number; err: number; descartadas: number;
    /** Opcional para no romper las llamadas de hoy. undefined = no se toca lo que había. */
    fueraDeCorte?: number | null;
}

export class ProgresoTracker {
    // ── Fase A, sin cambio de firma ──
    iniciar(jobId): Promise<void>;                 // ahora además arranca el reloj
    fijarTotalEsperado(n): void;  sumarAdvertencias(n): void;
    lote(c): Promise<void>;                        // persiste y emite SIEMPRE, como hoy
    entrarEnPostProceso(): Promise<void>;
    finalizar(c): Promise<EstadoCargaDto>;         // detiene el reloj antes de escribir
    fallar(error, c): Promise<EstadoCargaDto>;     // ídem

    // ── Fase B ──
    /** Fase LEYENDO. Persiste y emite. Nunca tira (un fallo es un `warn`: una etiqueta no frena una carga). */
    entrarEnLectura(): Promise<void>;
    /** Contadores después de una fila. SINCRÓNICO: solo memoria. Si la fase era LEYENDO, pasa a PROCESANDO. */
    avance(c: ContadoresCarga): void;
    /** Filas del lote en curso ya resueltas (processors por lote). Sincrónico. */
    avanceDelLote(n: number): void;
    /** Paso del post-proceso. Sincrónico. Arma el texto y loguea el tiempo del paso anterior. */
    subfase(nombre: string, hecho?: number, total?: number): void;
    /** Casos nuevos y actualizados (absolutos). Sincrónico. */
    contadores(c: { nuevos?: number; actualizados?: number }): void;
    /** Detiene el reloj. Idempotente. Lo llama el `finally` del runner. */
    cerrar(): void;
    /** Una escritura encontró la carga ya terminal o borrada: otro la cerró. */
    get cerradaPorFuera(): boolean;
    /** Milisegundos desde el último reporte que cambió algo. Para el log del reaper. */
    get sinAvanceMs(): number;
}

/** La tiran `iniciar`, `lote`, `entrarEnPostProceso` y `finalizar` cuando su escritura no afecta nada. */
export class CargaCerradaPorFueraError extends Error {}
```

`TrackerDeps` gana dos campos opcionales, para los tests: `ahora?: () => number` (default `Date.now`)
e `intervaloMs?: number` (default, la variable de entorno).

**Los reportes no escriben.** `avance`, `avanceDelLote`, `subfase` y `contadores` cambian la memoria y
prenden una bandera (`sucio`). Nada más. Por eso se pueden llamar en cada fila sin costo y sin `await`.

**El reloj.** Un único `setInterval`, con `.unref()`, que arranca al final de `iniciar` y corre cada
`IMPORTS_PROGRESO_INTERVALO_MS` (default 1.000; acotado a [250, 10.000]). En cada tic:

```
deriva = ahora − (tic anterior + intervalo)
si deriva >= 5.000 ms → warn "Event loop bloqueado ~N ms durante la remesa X (fase, subfase)"
si la carga terminó, el reloj se cerró o la carga fue cerrada por fuera → nada
si hay una escritura en vuelo → nada                          (el tic siguiente vuelve a mirar)
si `sucio`                                  → ESCRIBIR PROGRESO: foto completa + emitir import:progreso
si no, y pasaron >= 15 s de la última escritura → ESCRIBIR LATIDO: solo heartbeatAt, sin emitir
```

- **Escribir progreso** —**(Cambió al auditar: §9.15.)** hoy va solo a `import_progreso`— es la misma escritura que `lote` (un `remesa.update` con la fila anidada y los
  mismos `okFilas` / `errFilas`), seguida del `import:progreso`. `sucio` se apaga **antes** del
  `await`; si la escritura falla, se vuelve a prender y el próximo tic reintenta.
- **Escribir latido** es `import_progreso.updateMany({ where: { remesaId, finishedAt: null }, data: {
  heartbeatAt, rev: { increment: 1 } } })`. Una sentencia sobre una fila que ningún processor toca: no
  compite por locks con la carga. Si devuelve `count: 0`, la carga fue cerrada por fuera.
- **Todo el cuerpo del tic va en `try/catch`.** Un fallo es un `warn` (a lo sumo uno por minuto) y
  nunca una promesa rechazada sin manejar, que tumbaría el proceso entero.
- **El latido es de vida, no de avance.** Dice "el proceso está vivo y el event loop gira". Que la
  carga *avance* se ve en los contadores y en la subfase.
- **La deriva del tic es el instrumento que faltaba para §3.5:** si alguna vez una lectura bloquea el
  event loop más de 5 s, queda en el log con la remesa y la fase.

**Una escritura por vez.** El tic que encuentra una escritura en vuelo no hace nada; las escrituras
que pide el runner (`lote`, `entrarEn…`, `finalizar`, `fallar`) esperan a que termine la que esté en
vuelo y recién ahí escriben. Dos consecuencias que hay que respetar al implementarlo:

1. Después de una escritura, en memoria **solo se actualizan `rev` y `heartbeatAt`**. No se reemplaza
   el objeto entero, como hace hoy (`this.mem = siguiente`, `:201`, `:229`, `:236`): mientras la
   escritura del reloj estaba en vuelo, la carga siguió y los reportes cambiaron la memoria; pisarla
   con la foto vieja haría retroceder los contadores.
2. Lo que se emite es **la foto que se persistió**, con el `rev` que devolvió la base, no la memoria
   del momento de emitir.

**El evento final no se pierde, y después de él no sale nada.** `finalizar` y `fallar` (a) marcan que
la carga está terminando —desde ahí el reloj no hace nada—, (b) hacen `clearInterval`, (c) esperan la
escritura en vuelo, y (d) escriben el estado terminal **sin pasar por ningún throttle** y emiten
`import:finalizada`. El terminal lleva `subfase: null`.

**Escrituras condicionadas** (regla 2 de §9.3). **(Cambió al auditar: §9.15.)** El `where` condicionado de Prisma resultó no ser
atómico; lo reemplazó una relectura `FOR UPDATE`. `persistir` (`:334-368`) pasa a usar:

```ts
where: { id: remesaId, estadoProceso: { notIn: ['FINALIZADA', 'FALLIDA'] } }
```

y, **solo en `iniciar`**, además: `NOT: { progreso: { is: { encoladaAt: null } } }` — la carga tiene
que seguir encolada (cierra la carrera de §9.5.8). Escrito en negativo, para que una remesa sin fila
(job encolado por el código viejo, caso B-9) siga entrando. Si el `where` no encuentra la fila, Prisma
tira `P2025`; el tracker lo traduce: prende `cerradaPorFuera`, detiene el reloj y tira
`CargaCerradaPorFueraError` (el reloj no tira: solo prende la bandera). `fallar` conserva su contrato
de no tirar nunca: ante un `P2025` no marca "no se pudo registrar", marca cerrada por fuera.

Qué escribe cada método nuevo, y qué se agrega a los de la Fase A:

| Método | En `remesa` | En `import_progreso` |
|---|---|---|
| `iniciar` (se agrega) | — | `subfase`, `nuevos`, `actualizados`, `fueraDeCorte` en null |
| `entrarEnLectura` | — | `fase: LEYENDO` |
| reloj, progreso | `okFilas`, `errFilas` | `fase`, `subfase`, `procesadas`, `ok`, `err`, `descartadas`, `fueraDeCorte`, `nuevos`, `actualizados`, `porcentaje`, `advertencias`, `totalEsperado`, `heartbeatAt` |
| reloj, latido | — | `heartbeatAt` |
| `lote` (se agrega) | — | `fueraDeCorte`, `nuevos`, `actualizados`; `procesadas = ok + err` (el adelanto del lote vuelve a 0) |
| `entrarEnPostProceso` (se agrega) | — | `subfase: null` |
| `finalizar`, `fallar` (se agrega) | — | `subfase: null`; `fueraDeCorte`, `nuevos`, `actualizados` finales |

`procesadas` en memoria es `ok + err + adelantoDelLote`. `avanceDelLote(n)` fija el adelanto (acotado
a lo que le falta al total); `lote` lo pone en 0; `avance` no lo toca.

**El texto de la subfase** lo arma el tracker: `nombre` si no hay total; si lo hay,
`"{nombre}: {hecho} de {total}"`, con punto de miles (función propia, sin `toLocaleString`: no se
depende del ICU del contenedor), recortado a 160 caracteres. Cuando cambia el `nombre`, el tracker
loguea el paso que terminó: `Post-proceso remesa=N «Consolidando casos» en 1234ms` (§9.5.11).

#### 9.5.3 El runner: `processImportJob` (`imports.service.ts:2009-2539`)

Cambia el manejo del estado alrededor del recorrido; el recorrido de filas, no.

```
remesa = buscar                                                     (:2013-2033, igual)
guardas de la Fase A: ya terminó → ignorado · borrador con fila → ignorado      (:2038-2054, igual)

NUEVO — re-entrega de una carga que ya había arrancado (regla 1 de §9.3):
    si remesa.progreso?.startedAt y no remesa.progreso.finishedAt:
        si this.cargasVivas.has(remesaId) → warn; return { total: 0, ok: 0, err: 0, ignorado: true }
        await this.cerrarCargaInterrumpida(remesaId, 'REENTREGA', { jobId: job.id })    (§9.5.5)
        return { total: 0, ok: 0, err: 0, ignorado: true }

tracker = new ProgresoTracker(…)                                    (:2060-2073, igual)
this.cargasVivas.set(remesaId, tracker)                             ← NUEVO: registro de cargas vivas
try:
    try:    await tracker.iniciar(job.id)                           ← escritura condicionada
    catch:  si es CargaCerradaPorFueraError → warn "ya no está en cola (se borró, terminó o volvió a
            borrador)"; return { total: 0, ok: 0, err: 0, ignorado: true }.   Si no, relanzar.
    relectura de existencia                                         (:2091-2095, igual)
    … validaciones y armado de ctx …                                (:2097-2175, igual)
    ctx.progreso = { filasDelLote: n => tracker.avanceDelLote(n),
                     subfase: (nombre, hecho, total) => tracker.subfase(nombre, hecho, total),
                     contadores: c => tracker.contadores(c) }

    processBatch (el closure de :2203-2278):
        si tracker.cerradaPorFuera → throw new CargaCerradaPorFueraError()       ← la carga se corta acá
        por cada fila del grupo (:2210-2240):
            … igual que hoy …
            tracker.avance({ ok, err, descartadas, fueraDeCorte })    ← después de cada fila, sin await
        processor.processBatch(…)                                   (:2246-2249; los processors por lote
                                                                     informan con ctx.progreso.filasDelLote)
        await tracker.lote({ ok, err, descartadas, fueraDeCorte })  (:2275: persiste y emite SIEMPRE)

    ramas pre-parseadas:  await tracker.entrarEnLectura()  ANTES de leer y parsear
                          (antes de :2290, :2327 y :2364)
    rama genérica (:2404-2443):
        si algún path es Excel:  await tracker.entrarEnLectura()
        { dePlantilla, deCorte } = this.filtrosSeparados(remesa, mapping)
        fueraDeCorte = deCorte.length > 0 ? 0 : null
        por cada fila leída (:2422-2433):
            si no pasa dePlantilla → descartadas++ ;                  tracker.avance(…) ; seguir
            si no pasa deCorte     → descartadas++ ; fueraDeCorte++ ; tracker.avance(…) ; seguir
            … igual que hoy …

    post-proceso, conteo de avisos, finalizar, notificar            (:2447-2525, igual)
catch (error):
    si es CargaCerradaPorFueraError, o tracker.cerradaPorFuera:
        warn "La remesa N fue cerrada por fuera mientras se procesaba: se corta sin tocar su estado"
        return { total, ok, err, ignorado: true }                   ← NI fallar() NI notificar
    … igual que hoy: fallar, notificar, throw …                     (:2527-2538)
finally:
    tracker.cerrar()                                                ← detiene el reloj, pase lo que pase
    this.cargasVivas.delete(remesaId)
```

Puntos que no son obvios:

- **`cargasVivas`** es un `Map<number, ProgresoTracker>` privado de `ImportService`. No se agrega nada
  al constructor (siguen los 9 argumentos posicionales de los specs). Lo consulta el reaper por un
  método público, `cargaVivaEnEsteProceso(remesaId)`, que devuelve `null` o `{ sinAvanceMs, fase,
  subfase }`. El `finally` es obligatorio: una entrada que quedara en el mapa haría inmortal a esa
  carga para el reaper.
- **El orden de los filtros define los dos contadores.** Una fila que no pasa el filtro de la
  plantilla es "descartada por filtro" aunque tampoco sea de este corte: la plantilla la habría
  descartado en cualquier remesa. `fueraDeCorte` cuenta solo las que la plantilla dejaba pasar. Con
  eso, para todas las remesas de una misma división, `descartadasPorFiltro` da **el mismo número** y
  `procesadas + descartadas` da las filas del archivo. `filtrosSeparados` es un método nuevo al lado
  de `filtrosDeRemesa` (`:494-498`), que no se toca porque lo usan la vista previa y el preview de
  acciones.
- **`processImportJob` sigue devolviendo exactamente `{ total, ok, err }`** en el camino normal: el
  caso B-1 lo afirma con `toEqual`.
- **Para saber si hay un Excel** se usa el mismo criterio que la lectura: `esExcel`, que hoy es
  privada de `utils/recorrer-filas.ts:73`. Se exporta; no se copia la expresión regular.
- **La secuencia del caso B-1 no cambia.** Un CSV no pasa por LEYENDO; el lote sigue emitiendo
  siempre; el reloj solo agrega eventos si un lote dura más de un segundo, y en el test dura
  milisegundos. Es deliberado: el contrato nuevo **agrega** eventos intermedios, no reordena los de la
  Fase A.
- **El corte por "cerrada por fuera" es por lote, no por fila.** Una carga que otro cerró termina el
  lote que tenía empezado (hasta 1.000 filas) y corta en el siguiente. Hoy solo puede dispararlo un
  reaper de otro proceso; es el mismo gancho que va a usar "cancelar" en la Fase C.

#### 9.5.4 Los processors: qué informa cada uno

Tres caminos de filas, tres formas de informar el avance:

| Camino | Categorías | Quién informa dentro del lote |
|---|---|---|
| Por fila (`processRow`) | DEUDORES, DEUDORES_Y_FACTURAS, PAGOS, CONTACTOS, ENRIQUECIMIENTO, ACCIONES | El **runner**, después de cada fila. El processor no hace nada |
| Pre-parseado + por fila | MULTIRREGISTRO, MULTIARCHIVO (`CasosCedenteProcessor.processRow`) | El runner, igual. Es lo que saca a MULTIARCHIVO del 0 % |
| Por lote (`processBatch`) | ACTUALIZACIONES, FACTURAS, MULTICLAVES | El **processor**, con `ctx.progreso?.filasDelLote(n)` |

`filasDelLote` en los processors por lote:

- **ACTUALIZACIONES** (`actualizaciones.processor.ts:349`): dentro del bucle que resuelve cada fila
  (`:421`), que es donde están las altas secuenciales, y en el de reconciliación de deuda. Al menos
  una llamada cada 100 filas; el valor es el acumulado del lote y nunca supera `rows.length`.
- **FACTURAS** (`facturas.processor.ts:59`): después de cada tanda del upsert en bloque (`:145`).
- **MULTICLAVES**: no informa. Resuelve el lote en una transacción; el avance es por lote.

**Subfases del post-proceso.** Nombre exacto, en orden, y sobre qué unidad cuenta:

| Processor | Subfase (`SUBFASE.…`) | Unidad de "N de M" | Dónde |
|---|---|---|---|
| ACTUALIZACIONES, ausentes = desasignar | `Desasignando ausentes` | deudores, de a 500 | `:238-248` |
| ACTUALIZACIONES, ausentes = pagó todo | `Cerrando ausentes` | deudores de la remesa de origen recorridos; informar cada 200 | bucle de `:1002-1036` |
| ACTUALIZACIONES | `Consolidando la remesa de origen` | deudores evaluados, de a 500 | `:937`, `:1039` |
| ACTUALIZACIONES (solo si la remesa de la carga no es la de origen) | `Consolidando la remesa de la carga` | ídem | `:939`, `:1045` |
| ACTUALIZACIONES | `Cerrando promesas cumplidas` | sin medida | `:942`, `:1050` |
| PAGOS | `Consolidando casos con pagos` | deudores | `:632`, `:637` |
| PAGOS | `Cerrando promesas cumplidas` | sin medida | `:634` |
| FACTURAS, DEUDORES_Y_FACTURAS | `Recalculando importes` | deudores, de a 500 | `utils/monto-facturas.ts:32-45` |
| FACTURAS, DEUDORES_Y_FACTURAS | `Consolidando casos` | deudores | `monto-facturas.ts:49` |
| FACTURAS | `Uniendo datos adicionales` | deudores, de a 500 | `monto-facturas.ts:67` |
| MULTIRREGISTRO, MULTIARCHIVO | `Desasignando ausentes` (solo si la plantilla lo activa) | casos, de a 500 | `casos-cedente.processor.ts:465-476` |
| MULTIRREGISTRO, MULTIARCHIVO | `Consolidando casos tocados` | deudores | `:874` |
| MULTIRREGISTRO, MULTIARCHIVO | `Cerrando promesas cumplidas` | sin medida | `:884` |
| MULTICLAVES | `Buscando pagos de estas claves` | convenios, de a 1.000 | bucle de `multiclaves.processor.ts:354-362` |
| MULTICLAVES | `Consolidando casos con pagos` | deudores | `:365` |
| ACCIONES | `Guardando datos para revertir` | snapshots, de a 500 | `acciones.processor.ts:282-292` |
| DEUDORES, CONTACTOS, ENRIQUECIMIENTO | ninguna | — | Su `afterAll` solo limpia cachés y loguea |

- Toda consolidación se llama con `consolidarConProgreso` (§9.4.4), nunca directo.
- Un paso que no corre no se informa (por ejemplo, `Cerrando promesas cumplidas` solo si hay
  deudores con pagos, como hoy).
- El avance se informa **después** de cada tanda, con lo que ya se hizo.
- **Ningún processor cambia una condición, un orden ni una consulta.** El diff de cada uno son líneas
  `ctx.progreso?.…`, el reemplazo de `ctx.consolidacion.consolidar(…)` por el helper, y los contadores
  de abajo.

**`nuevos` y `actualizados`.** Una sola definición, en **casos**:

> `nuevos` = casos que esta carga creó. `actualizados` = casos que ya existían y esta carga tocó.

| Categoría | `nuevos` | `actualizados` | Lo que ya tiene el processor |
|---|---|---|---|
| DEUDORES | Deudores creados | ~~Deudores distintos que ya estaban **en la remesa** y una fila tocó~~ `null`: daba siempre 0 (§9.15) | `creado`, que devuelve `upsertDeudorPorIdentidad` (`deudores.processor.ts:55`). Hay que llevar dos conjuntos de ids (creados / ya existentes) |
| DEUDORES_Y_FACTURAS | Ídem | Ídem. Las filas siguientes de un caso creado por esta misma carga **no** cuentan | `creado` (`deudores-facturas.processor.ts:91`) y `touchedDeudorIds` |
| ACTUALIZACIONES | Altas en la remesa de origen | Casos de la remesa de origen que vinieron en el archivo | `crearNuevoDeudor` (`:595`) y `processedDeudorIds` |
| MULTIRREGISTRO, MULTIARCHIVO | `altasCount` | `actualizadosCount` | Ya los cuenta (`casos-cedente.processor.ts:289`, `:307`). Son por fila de caso: si el archivo repite un cliente, cuenta dos veces |
| FACTURAS | `null` | `null` | El upsert en bloque no dice cuáles insertó y cuáles actualizó |
| PAGOS | `null` | `null` | Sus números son otros (aplicados, ya cargados, negativos, con clave): van al `resumen` de la Fase C |
| CONTACTOS, ENRIQUECIMIENTO | `null` | `null` | `upsert` de Prisma: no distingue |
| ACCIONES | `null` | `null` | No crea casos |
| MULTICLAVES | `null` | `null` | Carga claves, no casos; el detalle ya tiene su propio resumen (`MulticlavesLoteResumen`) |

- En DEUDORES, `ok − nuevos − actualizados` son las filas que cayeron sobre un caso **creado por esta
  misma carga**: identidades repetidas dentro del archivo, que es el colapso de casos del catálogo de
  fallos silenciosos. La Fase B no le pone nombre en la pantalla (va al resumen de la Fase C), pero
  el número ya se puede deducir, y la vista previa lo sigue avisando antes de ejecutar.
- Se informa con `ctx.progreso?.contadores({ nuevos, actualizados })`, valores absolutos, después de
  cada fila (por fila) o al final de cada `processBatch` (por lote).
- Donde es `null`, la pantalla no muestra el contador: no muestra un cero.

#### 9.5.5 Cerrar una carga interrumpida: una sola función

`ImportService.cerrarCargaInterrumpida(remesaId, motivo, detalle?)`, pública. La llaman el reaper y la
guarda de re-entrega; nadie más. Devuelve el `EstadoCargaDto` terminal, o `null` si no cerró nada.

```ts
type MotivoInterrupcion = 'SIN_LATIDO' | 'SIN_JOB' | 'REENTREGA';
```

```
si this.cargasVivas.has(remesaId) → warn; return null              ← nunca una carga viva en este proceso
transacción:
    f = SELECT r.estadoProceso, r.categoria, p.encoladaAt, p.startedAt, p.heartbeatAt, p.finishedAt,
               p.ok, p.err, p.jobId
        FROM remesa r JOIN import_progreso p ON p.remesaId = r.id WHERE r.id = ? FOR UPDATE
    sin fila (se borró, o es heredada sin fila de progreso)          → return null
    f.estadoProceso ∈ {FINALIZADA, FALLIDA}, o f.finishedAt != null   → return null    ← un terminal no se pisa
    f.encoladaAt == null                                              → return null    ← es un borrador
    comprobación del motivo, otra vez, ya con el lock:
        SIN_LATIDO: f.startedAt != null y (f.heartbeatAt ?? f.startedAt) más viejo que el umbral.
                    Si latió mientras tanto                           → return null
        SIN_JOB:    f.startedAt == null.  Si arrancó mientras tanto   → return null
        REENTREGA:  f.startedAt != null
    remesa:          estadoProceso FALLIDA, okFilas = f.ok, errFilas = f.err   (los persistidos)
    import_progreso: fase TERMINADA, resultado FALLIDA, error = texto, subfase null,
                     finishedAt = ahora, rev + 1.   heartbeatAt NO se toca: queda el último real.
    releer la remesa con su fila y su creador, para armar el DTO
fuera de la transacción, cada paso en su try/catch:
    emitir import:finalizada                      (mismas salas que el tracker)
    notificar                                     (notificarResultadoCarga, :2571-2604, sin cambios)
    auditar IMPORT_FAIL                           ("Importación interrumpida remesa N", con el motivo)
    log warn con remesa, motivo, minutos sin latido y filas procesadas
return el DTO
```

- El `SELECT … FOR UPDATE` serializa el cierre contra todo lo demás que escribe esa fila: el `iniciar`
  del worker, el borrado, la confirmación. El que llega segundo ve el resultado del primero.
- Notifica al dueño y a quienes tienen `importacion.ver_progreso_otros`, igual que cualquier otra
  FALLIDA: "Importación fallida", con la primera oración del motivo y "Se habían procesado N filas".
- **El texto va en `import_progreso.error`** y por eso lo ven también las pestañas viejas. Sale de una
  función pura nueva en `estado-carga.ts`, `textoInterrupcion(motivo, categoria)`, con su test.

Texto, cuando la carga **había arrancado** (`SIN_LATIDO`, `REENTREGA`): una primera oración fija —

> La importación se interrumpió: el servidor se reinició o dejó de responder mientras la procesaba.

— seguida de qué hacer, **según la categoría**:

| Categoría | Qué hacer | Verificado contra |
|---|---|---|
| DEUDORES, DEUDORES_Y_FACTURAS | ~~"Lo procesado hasta el corte quedó cargado en esta remesa. Eliminá esta importación desde el Historial (se puede mientras sus casos no tengan gestión) y volvé a cargar el archivo."~~ Texto definitivo en §9.15 | `deleteRemesa` (`:2908-2992`): una FALLIDA se puede borrar, y borra sus casos, facturas, contactos y campos extra si ninguno tiene gestión. Estas dos categorías solo escriben en su propia remesa |
| ACCIONES | "Las acciones aplicadas hasta el corte quedaron hechas y **no se pueden revertir desde la pantalla**: los datos para deshacer se guardan recién al terminar. No vuelvas a cargar el archivo; avisá a soporte." | Los snapshots están en memoria y se escriben en `afterAll` (`acciones.processor.ts:279-292`); Revertir solo aparece en una finalizada |
| El resto | "Lo procesado hasta el corte quedó aplicado. Antes de volver a cargar el archivo, avisá a soporte." | No se afirma ningún remedio: estas categorías escriben sobre casos de otras remesas (pagos, bajas, contactos, facturas) y borrar la remesa no lo deshace |

Cuando **no había arrancado** (`SIN_JOB`):

> La importación no llegó a empezar: quedó en la cola sin un trabajo que la procese (el servidor se
> reinició justo al confirmarla, o la cola perdió el trabajo). No se cargó ninguna fila: volvé a
> importar el archivo.

**Regla para el implementer y el auditor**, que viene de la Fase A (el remedio de "con advertencias"
del diseño era falso para casi todas las categorías, §8.13): **un remedio solo se escribe si está
verificado contra el processor y contra `deleteRemesa`.** Si al implementar aparece una duda sobre los
dos primeros renglones, esa categoría pasa al texto genérico y se reporta.

La pantalla agrega después lo que ya agrega hoy para cualquier FALLIDA con filas: "Antes del corte se
cargaron N filas…; el cierre de la carga no corrió." (`utils/estadoCarga.ts:161-172`).

#### 9.5.6 Reaper de cargas colgadas

Dos archivos nuevos en `backend/src/modules/imports/progreso/`: `reaper-cargas.service.ts` (la lógica)
y `reaper-cargas.scheduler.ts` (los dos `@Cron`, con el patrón de `convenios/convenios.scheduler.ts`:
`try/catch` alrededor de todo, `error` con stack). Se registran como providers de `ImportModule`.
**No** se vuelve a importar `ScheduleModule.forRoot()`: ya está en `reportes.module.ts:27` y descubre
los `@Cron` de toda la aplicación (así funcionan hoy los de convenios, promesas y mora).

El servicio depende de `PrismaService` y de `ImportService`. Todo lo que habla con la cola queda en
`ImportService`, al lado de `sacarJobDeLaCola` (`:2831-2861`) y bajo el mismo tope de tiempo
(`conTope`, `:2815-2824`), en un método público nuevo:

```ts
/** Qué dice BullMQ del job de una carga. Nunca tira. */
estadoDelJobDeCarga(remesaId: number, jobId: string | null): Promise<
    { estado: 'ACTIVO_CON_LOCK' | 'ACTIVO_SIN_LOCK' | 'EN_ESPERA' | 'TERMINADO' | 'NO_EXISTE' | 'DESCONOCIDO' }
>;
```

```
job = jobId ? getJob(jobId) : null
si job trae data.remesaId y NO es esta remesa → job = null  ← el id ya no es de esta carga (ver abajo)
si no hay job: buscarlo por data.remesaId entre getJobs(['waiting','active','delayed','paused','prioritized'])
sin job                                                  → NO_EXISTE
según job.getState():
    active                                               → EXISTS de la clave `${queue.toKey(job.id)}:lock`
                                                           1 → ACTIVO_CON_LOCK · 0 → ACTIVO_SIN_LOCK
    waiting, delayed, prioritized, paused, waiting-children → EN_ESPERA
    completed, failed                                    → TERMINADO
cualquier excepción, tope de tiempo vencido, o una cola sin lo necesario para mirar el lock → DESCONOCIDO
```

**La pasada**, `@Cron(CronExpression.EVERY_MINUTE)`:

```
si IMPORTS_REAPER_DESACTIVADO está puesto, o hay otra pasada corriendo → return
candidatas = import_progreso con encoladaAt != null y finishedAt == null, cuya remesa no es terminal
             (índice ImportProgreso_finishedAt_idx; lo normal es que sean 0, 1 o 2 filas)
por cada candidata:
    viva = importService.cargaVivaEnEsteProceso(remesaId)
    si viva:                                                        ← (1) la estoy procesando yo: NO SE TOCA
        si su latido tiene más de 60 s  → warn "latido atrasado N s en una carga viva (event loop o base lentos)"
        si viva.sinAvanceMs >= 15 min   → warn "viva y sin avance hace N min (fase, subfase)"   (uno cada 15 min)
        seguir con la próxima
    si startedAt != null:                                           ── R1: arrancó y no terminó
        si ahora − (heartbeatAt ?? startedAt) < umbral → seguir     ← (2) late: alguien la está procesando
        j = estadoDelJobDeCarga(…)
        si j es DESCONOCIDO      → warn "no se pudo consultar la cola"; olvidar la sospecha; seguir
        si j es ACTIVO_CON_LOCK  → warn "otro proceso la tiene viva"; olvidar; seguir     ← (3) BullMQ dice que vive
        motivo = SIN_LATIDO
    si no:                                                          ── R2: en cola y nunca arrancó
        si ahora − encoladaAt < 2 min → seguir                      (la ventana normal entre el commit y el add)
        j = estadoDelJobDeCarga(…)
        si j es DESCONOCIDO → olvidar; seguir
        si j es EN_ESPERA, ACTIVO_CON_LOCK o ACTIVO_SIN_LOCK → olvidar; seguir     ← tiene job: espera su turno
            (si es EN_ESPERA, lleva más de 5 min y este proceso no tiene ninguna carga viva:
             warn "hay un job esperando y el worker no lo toma", uno cada 15 min. No se cierra.)
        motivo = SIN_JOB                                            (NO_EXISTE o TERMINADO)

    ── DOS PASADAS SEGUIDAS ──
    si no era sospechosa, o lo era por otro motivo → anotarla { motivo, desde: ahora }; log "sospechosa"; seguir
    si ahora − desde < 45 s → seguir
    estado = importService.cerrarCargaInterrumpida(remesaId, motivo, { umbralMs })
    si cerró y j es EN_ESPERA → sacar el job de la cola             (para que no se entregue nunca)
    olvidar la sospecha
olvidar las sospechas de las cargas que ya no son candidatas
```

**Por qué no puede matar una carga viva.** La pregunta de fondo: el reaper vive en el mismo proceso
que el worker, y un bloqueo largo del event loop frena por igual al reloj del tracker, al cron y a la
renovación del lock; cuando el event loop se libera, ¿quién corre primero? **No importa**, porque
ninguna de las barreras depende del orden:

1. **El registro de cargas vivas** se consulta antes que nada, es memoria del mismo proceso y no
   depende de ningún timer. Si el cron corre, el proceso está vivo; si el proceso está vivo y tiene la
   carga, el registro la tiene. Es la barrera que alcanza por sí sola con un único proceso.
2. **Dos pasadas seguidas, con al menos 45 s entre una y otra.** La primera solo anota. Para la
   segunda, el reloj de una carga viva ya tuvo decenas de tics y `heartbeatAt` es reciente.
3. **La relectura bajo `FOR UPDATE`** dentro de `cerrarCargaInterrumpida`, que vuelve a mirar el
   latido con la fila bloqueada.
4. **El lock de BullMQ**, que es una señal de vida ajena a la base y es la que protegería a una carga
   viva en **otro** proceso, si algún día lo hay.
5. **Ante la duda, no se cierra.** Si Redis no responde, no se decide en esa pasada y la sospecha se
   borra: hacen falta dos pasadas seguidas *con respuesta*.

Y si todas fallaran a la vez, la carga viva no sigue a ciegas: su próxima escritura encuentra el
estado terminal, el tracker se da por cerrado por fuera y la carga corta en el lote siguiente (§9.5.2).

**Lo que deliberadamente no cierra:**

- **Una carga viva que no avanza.** Ver §9.1: el proceso está vivo, y marcarla FALLIDA con el worker
  todavía ocupado dejaría las cargas siguientes esperando detrás de una "terminada". Queda en el log.
- **Una carga en cola con su job esperando**, lleve el tiempo que lleve: puede haber una carga de 91
  minutos adelante. La antigüedad sola nunca cierra una carga en cola.
- **Las remesas sin fila de progreso** (93, 98 y toda heredada): la consulta parte de
  `import_progreso`. Es estructuralmente imposible que las vea.
- **Los borradores**: no tienen `encoladaAt`.

**Qué hace con el job de BullMQ.** Nada si está activo (BullMQ lo falla solo cuando lo detecta, por
`maxStalledCount: 0`); nada si ya terminó o no existe. Si está **en espera** —BullMQ ya lo devolvió a
la cola—, lo saca, reusando `sacarJobDeLaCola`. Aunque no pudiera sacarlo, el job llegaría a una carga
terminal y lo ignoraría la guarda de la Fase A (`:2038-2046`).

**Un bug de la Fase A que este diseño obliga a arreglar.** `sacarJobDeLaCola` busca el job por el `id`
guardado en `import_progreso.jobId` y **no comprueba que sea de esa remesa**. Los ids de BullMQ son un
contador que vive en Redis: si Redis pierde sus datos, el contador vuelve a 1 y un `jobId` viejo puede
pertenecer al job de otra carga. Borrar una carga en cola podría sacar de la cola el job de otra. Se
arregla en el mismo lugar: si el job trae `data.remesaId` y **no** es el de esta remesa, no es el
buscado. Escrito así, en negativo, a propósito: los jobs falsos de los specs de borrado
(`imports-progreso-http.spec.ts:548-567`) no traen `data` y se tienen que seguir sacando.

**Umbral.** `IMPORTS_LATIDO_UMBRAL_MIN`, default **5**, acotado a [3, 120]; un valor inválido es 5. El
porqué está en §5.3. Tiempo real hasta que se cierra: ~~entre 5 y 7~~ **entre 6 y 7** minutos desde el último latido (el
umbral, más hasta dos pasadas). La gracia de la carga en cola sin job es fija, 2 minutos: es un caso
sin zona gris —un job que no está a los dos minutos de confirmar no va a aparecer—, y el encolado
tiene un tope de 10 segundos (`IMPORTS_QUEUE_TIMEOUT_MS`).

**La primera pasada después de un deploy no puede cerrar nada:** la memoria de sospechas arranca
vacía y hacen falta dos pasadas. El primer cierre posible es entre uno y dos minutos después de
levantar, y solo de una carga que ya llevaba 5 minutos sin latido.

#### 9.5.7 Reaper de borradores

Predicado, TTL y horario están cerrados en §5.2. Acá, lo ejecutable. Mismo servicio y mismo scheduler
que el otro reaper.

`@Cron('30 4 * * *')` — las 04:30 **del reloj del contenedor**, que en prod es **hora de Argentina** (`Dockerfile.backend:6` fija `TZ`; medido en prod, §9.15) y no UTC como se supuso acá (~~01:30 de
Argentina~~). Queda después de los crons de promesas (2), cuotas y limpieza de reportes (3) y mora (4),
que usan el mismo reloj.

```
si IMPORTS_REAPER_DESACTIVADO está puesto → return
ttl   = IMPORTS_BORRADOR_TTL_HORAS (default 24; acotado a [1, 720]; inválido → 24)
corte = ahora − ttl
candidatas = remesa.findMany({
    where: { estadoProceso: { in: ['PENDIENTE', 'VALIDANDO'] },
             createdAt: { lt: corte },
             progreso: { is: { fase: 'BORRADOR', encoladaAt: null } },     ← exige fila: una heredada no entra
             deudor: { none: {} } },
    select: { id, numeroRemesa, empresaId, categoria, createdAt },
    orderBy: { id: 'asc' }, take: 500 })
por cada candidata, en SU transacción:
    f = SELECT r.estadoProceso, p.fase, p.encoladaAt
        FROM remesa r JOIN import_progreso p ON p.remesaId = r.id WHERE r.id = ? FOR UPDATE
    si no hay fila, o estadoProceso ∉ {PENDIENTE, VALIDANDO}, o fase != 'BORRADOR', o encoladaAt != null → saltar
    si existe algún deudor con ese remesaId → saltar
    importerror.deleteMany · jobimport.deleteMany · remesa.delete        (la fila de progreso cae por cascade)
    un error en una remesa → warn con el id, y seguir con la siguiente
log: "Reaper de borradores: N eliminados de más de 24 h (remesas: 00151, 00152, …)", con el tiempo
```

- **La relectura con `FOR UPDATE`** es la que evita pisarse con alguien que justo confirma: la
  confirmación toma el mismo lock (`:1829-1834`). Si confirma primero, el reaper ve `encoladaAt` y
  saltea; si el reaper borra primero, la confirmación no encuentra la remesa y responde 404.
- **Una transacción por remesa**, no una para todas: la que falla no arrastra a las demás y ningún
  lock dura más que un borrado.
- **Ante cualquier referencia inesperada, no borra.** Un borrador no procesó nada, así que no tiene
  casos, ni claves de pago, ni snapshots. Si igual hubiera una clave (su FK no es cascade), el
  `delete` falla, se loguea y esa remesa queda. El reaper no borra nada más que `importerror`,
  `jobimport` y la remesa.
- **No borra archivos** (§5.2). No hay notificaciones que limpiar: un borrador nunca tuvo.
- **El tope de 500 por corrida** es un freno: si hubiera más, se van en las noches siguientes, y un
  `warn` dice que quedó cola.
- **Queda registrado** en el log, con el número de cada remesa borrada. Es el único rastro: no hay
  papelera.

#### 9.5.8 Las dos carreras que §8.13 dejó para la B

**Confirmar y borrar la misma remesa a la vez.** Hoy las dos pueden responder OK, de dos maneras.

*(a) El borrado leyó la remesa cuando todavía era borrador, y la confirmación hizo commit antes de la
transacción del borrado.* `verificarNoArrancada` (`:2869-2885`) solo aborta si la carga **arrancó**;
una recién encolada pasa. Cambio: el `SELECT … FOR UPDATE` agrega `p.encoladaAt`, y la función recibe
si la lectura inicial la había visto en cola:

```
si la lectura inicial NO la vio en cola, y ahora encoladaAt != null y finishedAt == null:
    → 409 "Esta importación se acaba de confirmar. Si igual querés eliminarla, volvé a intentarlo."
```

El segundo intento entra por el camino de "en cola sin arrancar", que saca el job y borra. Las
fixtures de los specs actuales devuelven filas sin `encoladaAt`: la guarda está escrita para que
`undefined` no la dispare.

*(b) El borrado llega en la ventana entre el commit de la confirmación y el `queue.add`.* El borrado
busca el job, no lo encuentra (todavía no entró) y borra; el `add` entra después, sobre una remesa que
ya no existe, y la confirmación responde 201. Cambio en `executeRemesa`: el `update` que guarda el
`jobId` (`:1926-1935`) hoy traga cualquier error con un `warn`. Si el error es `P2025` —la remesa ya
no está—, se saca el job recién encolado (bajo `conTope`; si no se puede, `warn`: el worker tampoco va
a encontrar la remesa) y se responde:

```
404 "La importación fue eliminada mientras se confirmaba."
```

Con las dos partes, la fila de la remesa es el punto de serialización: gana la operación que hace
commit primero y la otra recibe un error que dice qué pasó.

**La compensación del encolado devuelve a borrador una carga que el worker ya tomó.** Pasa cuando el
`queue.add` vence por tiempo (10 s) pero el job igual entró y el worker lo tomó: la compensación
(`:1941-1953`) pisa una carga que está corriendo y le dice 503 al usuario. Dos cambios:

1. **La compensación se vuelve condicional, en el mismo `update`.** Se conserva la llamada
   (`this.prisma.remesa.update`, con el mismo `data`: los casos C-7, F5 y H1 la afirman tal cual) y
   solo cambia su `where`:

   ```ts
   where: { id: remesaId,
            estadoProceso: { in: ['PENDIENTE', 'VALIDANDO'] },
            progreso: { is: { fase: 'EN_COLA', startedAt: null } } }
   ```

   Si no encuentra la fila (`P2025`), no era compensable. Se relee la remesa:
   - está en curso o terminó → el job **sí** entró y el worker la tomó: `warn`, y se responde **201**
     con el estado real. La importación está corriendo; decirle "probá de nuevo" sería mentir.
   - no existe → 404, el mismo de arriba.
   - cualquier otro caso → 503, como hoy.
2. **`iniciar` no arranca una carga que volvió a borrador** (el `NOT` de §9.5.2). Cubre el orden
   inverso: la compensación hizo commit primero, y el worker —que había leído la remesa cuando
   todavía estaba en cola— llega a `iniciar`: su escritura no encuentra la fila y el job se ignora.

Queda una ventana residual de milisegundos —los que pasan dentro del `update` condicional de Prisma
entre su lectura y su escritura—, con el desenlace que ya está probado hoy: una sola pasada de filas.
No se cierra con una transacción explícita porque los tres specs que afirman la compensación la
esperan como una llamada directa a `prisma.remesa.update`.

#### 9.5.9 Posición en la cola, velocidad y ETA

Las tres se **calculan al armar el DTO**. No se persisten y no tocan el schema. Las calcula el
backend, no el frontend, por una razón práctica: el frontend no tiene tests, y `armarEstadoCarga` es
una función pura con los suyos. Además así HTTP y socket dicen lo mismo, y todos los que miran la
misma carga ven el mismo número.

`armarEstadoCarga(remesa, fila, ahora = new Date(), extras: { enColaDelante?: number | null } = {})`:

```
descartadasPorFiltro = max(0, fila.descartadas − (fila.fueraDeCorte ?? 0))
fueraDeCorte         = fila.fueraDeCorte ?? null          (las fixtures viejas no traen el campo)
enColaDelante        = fase == 'EN_COLA' ? (extras.enColaDelante ?? null) : null

velocidad y etaSegundos: null salvo que fase == 'PROCESANDO', no sea terminal, y startedAt != null
    transcurrido = (ahora − startedAt) en segundos
    si transcurrido < 5 o procesadas <= 0 → null, null    (sin base para estimar; y nunca una división por cero)
    velocidad = max(0.1, redondear a un decimal(procesadas / transcurrido))
    si totalEsperado > procesadas:
        etaSegundos = ceil((totalEsperado − procesadas) × transcurrido / procesadas)
        si etaSegundos > 172.800 (48 h) → null            (un número así no informa nada)
    si no → etaSegundos = null
```

- **Promedio desde que arrancó, no promedio móvil.** Sale de un solo DTO (`procesadas`, `startedAt`,
  `servidorAhora`), así que funciona apenas se recarga la página, sin historia. Un promedio móvil
  necesita estado: o vive en la memoria del tracker —y entonces el `GET` no puede darlo y HTTP y
  socket se contradicen— o hay que persistir una ventana. Lo que se pierde: si el ritmo cambia a mitad
  de la carga, la estimación tarda en acomodarse.
- **La ETA es de las filas.** No sabe cuánto va a tardar el post-proceso, y la pantalla lo dice.
- En una remesa heredada, sin fila: `fueraDeCorte: null`, `descartadasPorFiltro: 0` y lo demás `null`.
- **La notificación de `SIN_FILAS`** (`textoNotificacion`, `estado-carga.ts`) pasa a usar las dos
  oraciones de §9.8.2 —la del filtro con `descartadasPorFiltro`, la de los otros cortes con
  `fueraDeCorte`—, leyendo `descartadasPorFiltro ?? descartadas` para que un DTO armado a mano sin el
  campo nuevo (los de `estado-carga.spec.ts`) dé el mismo texto que hoy. El `payload` de toda
  notificación de importación suma `fueraDeCorte` y `descartadasPorFiltro`.

**Posición en la cola.** Número de cargas en curso confirmadas antes que esta, contando la que está
corriendo:

```sql
SELECT COUNT(*) FROM import_progreso
WHERE finishedAt IS NULL AND encoladaAt IS NOT NULL
  AND (encoladaAt < :suEncoladaAt OR (encoladaAt = :suEncoladaAt AND remesaId < :suId))
```

- Se calcula donde se arma el DTO de una carga `EN_COLA`: en `executeRemesa` (respuesta y evento), en
  `progreso(id)`, en `status(id)`, y en `listarEnCurso` (una sola consulta con todas las cargas en
  curso, y las posiciones en memoria: el listado de quien no tiene `importacion.ver_progreso_otros`
  trae solo las suyas, y la posición tiene que contar las de todos). Es un número; no expone de quién
  son las cargas de adelante.
- **Es el mejor esfuerzo.** Va en `try/catch`: si la consulta falla, `enColaDelante` es `null` y la
  pantalla muestra el texto de la Fase A. Nunca hace fallar un encolado ni una lectura.
- **Es aproximada.** El orden de `encoladaAt` no es exactamente el de la cola (dos confirmaciones
  casi simultáneas pueden entrar a Redis al revés).
- **No hay un evento cuando la posición cambia.** El cliente la refresca con la consulta que ya hace
  cada 30 s cuando no llegan eventos, y los que reciben los eventos ajenos, enseguida (§9.8.5).

#### 9.5.10 Vista previa: las descartadas, separadas igual

`validateRemesa` cuenta las descartadas con los filtros combinados (`:1382-1383`, `:1434-1435`) y las
devuelve en `descartadas` y `filtro` (`:1633-1634`). Para que la vista previa y la carga digan lo
mismo:

- Evalúa en el mismo orden que el worker (`filtrosSeparados`) y devuelve `descartadas` (el total,
  como hoy) más `fueraDeCorte` (solo si la remesa tiene corte).
- `filtro` pasa a describir **solo** el filtro de la plantilla. Hoy, en una remesa de una división,
  incluye la condición del corte y el operador lee "se descartaron N filas que no cumplen col 3 EN
  3082" como si la plantilla hubiera tirado media cartera.

`previewDivision` (`:555-601`) ya cuenta solo con el filtro de la plantilla: no cambia.

#### 9.5.11 Logging y variables de entorno

Según la política del `CLAUDE.md`. Lo que se agrega a §8.5.8:

| Dónde | Nivel | Qué |
|---|---|---|
| Arranque del servicio del reaper (`onModuleInit`) | `log` ×1 | "Reaper de importaciones activo: sin latido a los N min, borradores a las N h" — o `warn` "desactivado por IMPORTS_REAPER_DESACTIVADO" |
| Fin de la lectura (primera fila después de LEYENDO) | `log` | `Lectura remesa=N terminó en Xms` |
| Fin de las filas | `log` | `Filas remesa=N: P procesadas en Xms (V filas/s)` |
| Cada paso del post-proceso, cuando cambia el nombre de la subfase y al terminar el `afterAll` | `log` | `Post-proceso remesa=N «Consolidando casos» en Xms` |
| Deriva del reloj de 5 s o más | `warn` | "Event loop bloqueado ~N ms durante la remesa X (fase, subfase)" |
| Escritura del reloj que falla | `warn`, a lo sumo uno por minuto | — |
| Carga cerrada por fuera | `warn` | — |
| Reaper: carga sospechosa (primera pasada) | `log` | remesa, motivo, minutos sin latido, lo que dijo la cola |
| Reaper: carga cerrada | `warn`, intent y done con tiempo | remesa, motivo, filas procesadas, qué se hizo con el job |
| Reaper: cola que no responde; carga viva en otro proceso; carga viva sin avance | `warn` | — |
| Reaper: una pasada de más de 500 ms | `log` con el tiempo | — |
| Reaper de borradores | `log`, intent y done con tiempo | cantidad y números de remesa |
| Listeners de BullMQ | `warn` | §9.5.1 |
| 404 y 409 nuevos de `executeRemesa` y `deleteRemesa` | `warn` | motivo de negocio |
| Reaper o cron que tira | `error` con stack | — |

Los tres logs con tiempo por paso son los que §3.5 pedía: con la primera carga real ya se puede saber
cuánto tarda cada paso de cada categoría. No se loguea ninguna fila cruda ni ningún documento.

**Variables de entorno.** Todas con un default en el código que sirve en prod sin tocar nada: el
`docker-compose.prod.yml` no viaja con el deploy. Se documentan en `backend/.env.example`.

| Variable | Default | Cotas | Para qué |
|---|---|---|---|
| `IMPORTS_PROGRESO_INTERVALO_MS` | 1000 | [250, 10000] | Cada cuánto el reloj vuelca el progreso |
| `IMPORTS_LATIDO_UMBRAL_MIN` | 5 | [3, 120] | Minutos sin latido para cerrar una carga |
| `IMPORTS_BORRADOR_TTL_HORAS` | 24 | [1, 720] | Antigüedad de un borrador para borrarlo |
| `IMPORTS_REAPER_DESACTIVADO` | sin definir | ~~cualquier valor no vacío lo activa~~ solo `1`, `true`, `si`, `sí`, `yes`, `on`, `y`, `s` (§9.15) | Apaga los dos crons. Es la llave de emergencia de dos jobs que cierran y borran solos |

Un valor que no es un número, o que queda fuera de las cotas, cae al default o a la cota, como hace
`IMPORTS_BATCH_SIZE` (`:59-63`). El latido cada 15 s y la gracia de 2 minutos son constantes del
código: tienen que guardar una proporción con el umbral, y hacerlos configurables es poder romperla.

#### 9.5.12 El parseo síncrono se queda donde está

§4 pedía "evaluar sacar el parseo síncrono del event loop si se confirma el bloqueo >45 s". **No se
confirma, y no entra en la Fase B.**

- **Lo medido en prod** (§9.1): el parseo síncrono más largo registrado es de 1,1 s. Los minutos en
  0 % de MULTIARCHIVO eran filas, no parseo.
- **Lo que dejaría un bloqueo de más de 15-30 s** —una falla de renovación de lock en el log— no
  aparece ni una vez en 181 corridas.
- **Excel**, que es la única lectura síncrona de tamaño libre: 150.000 filas son 6 s y 1,4 GB de
  memoria en la máquina de desarrollo. Antes de bloquear 45 s, el proceso se queda sin memoria. Y eso
  ya tiene respuesta: el proceso muere, el latido se corta, el reaper cierra la carga con motivo.
- **El costo de hacerlo no es chico ni neutro.** Un worker thread obliga a serializar cientos de miles
  de filas entre hilos o a mover el pipeline entero. Leer Excel por *stream* es cambiar de librería, y
  con ella cómo salen las fechas y los números (`raw: false`, `dateNF`): justo el tipo de cambio que
  produce valores mal convertidos, el fallo silencioso más caro de este sistema.
- **La Fase B deja el bloqueo inofensivo y medible.** Inofensivo: el lock aguanta un minuto (§9.5.1) y
  el reaper no mata una carga viva aunque el event loop se frene (§9.5.6). Medible: la deriva del
  reloj lo deja en el log con la remesa y la duración (§9.5.2).

**Cuándo reabrirlo:** si aparece en prod un `warn` "Event loop bloqueado" de más de 30 s. Con ese dato
—qué categoría, qué archivo, cuánto— se decide entre un tope de tamaño para Excel y sacar la lectura
del hilo principal.

### 9.6 Deploy

**Antes de desplegar** (lecturas en prod; las corre quien orquesta, el architect no las corrió):

1. **Que la base esté sincronizada con el schema desplegado** (`prisma migrate diff` con la imagen
   actual → `This is an empty migration`). Mismo motivo que en §8.6: el `db push` ejecuta todo el diff
   pendiente, no solo la columna nueva.
2. **Que no haya cargas en curso:**
   `SELECT remesaId, fase, encoladaAt, startedAt, heartbeatAt FROM import_progreso WHERE encoladaAt IS NOT NULL AND finishedAt IS NULL`
   → vacío. Si hay una procesando, esperar: el deploy la mata. La diferencia con hoy es que ya no
   queda colgada ni se re-ejecuta: se cierra FALLIDA con motivo entre 5 y 7 minutos después.
3. **Qué va a borrar el reaper de borradores en su primera corrida**, para que el usuario lo vea antes:
   `SELECT r.id, r.numeroRemesa, r.categoria, r.createdAt FROM remesa r JOIN import_progreso p ON p.remesaId = r.id WHERE r.estadoProceso IN ('PENDIENTE','VALIDANDO') AND p.fase = 'BORRADOR' AND p.encoladaAt IS NULL AND r.createdAt < NOW() - INTERVAL 24 HOUR AND NOT EXISTS (SELECT 1 FROM deudor d WHERE d.remesaId = r.id)`
   Hoy da vacío (la tabla no tiene filas). Si para el día del deploy lista algo que se quiere
   conservar, se despliega con `IMPORTS_REAPER_DESACTIVADO` puesto y se resuelve antes de sacarlo.

**Orden: primero el backend, después el frontend, en dos commits**, igual que en §8.6 y por el motivo
de §9.4.5: el frontend nuevo contra el backend viejo no se rompe, pero promete un cierre automático
que el backend viejo no hace.

**Qué pasa con lo que ya existe:**

| Situación | Después del deploy |
|---|---|
| Remesas 93 y 98, y toda heredada sin fila | Ningún reaper puede verlas: los dos parten de `import_progreso`. Siguen en el Historial |
| Cargas terminadas antes del deploy | `fueraDeCorte: null`; `descartadasPorFiltro` igual a `descartadas`. Sin cambios a la vista |
| Borradores con fila, de más de 24 h y sin casos | Se borran a las 04:30 (reloj del contenedor) de esa noche. Punto 3 de arriba |
| Carga **en cola** cuando el contenedor se reinicia | Su job sigue en Redis: el worker nuevo la toma y corre normal. El reaper la ve con job y no la toca |
| Carga **procesando** cuando el contenedor se reinicia | **No se re-ejecuta.** El chequeo de jobs perdidos lo hace el worker nuevo, con `maxStalledCount: 0`, así que BullMQ falla el job aunque lo haya encolado el código viejo. El reaper la cierra FALLIDA entre 5 y 7 minutos después de su último latido |
| Pestañas abiertas con el frontend de la Fase A | §9.4.5 |

**La primera corrida de cada reaper no puede hacer nada indebido:**

- *Cargas colgadas:* la primera pasada después de levantar nunca cierra (hacen falta dos); la segunda
  solo cierra lo que lleva 5 minutos sin latido, no está en el proceso y BullMQ no tiene vivo. En
  prod, hoy, no hay ninguna fila que pueda ser candidata.
- *Borradores:* no corre al levantar sino a las 04:30; el punto 3 muestra antes qué va a borrar; y
  la variable de entorno lo apaga sin desplegar código.

**Después de desplegar:**

1. En CloudWatch, la línea `Reaper de importaciones activo: sin latido a los 5 min, borradores a las 24 h`.
2. `prisma migrate diff` vacío, y la columna `fueraDeCorte` en `import_progreso`.
3. Con la primera carga real: la fila de `import_progreso` (que `heartbeatAt` se mueva cada 15 s) y
   los logs `Filas remesa=…` y `Post-proceso remesa=… «…» en …ms`. Es la primera medición real de
   cuánto tarda cada paso, y la primera vez que las Fases A y B corren de punta a punta.

**Volver atrás no es gratis**, por partida doble. La imagen anterior querría borrar la columna, y con
valores no nulos Prisma pide `--accept-data-loss` y frena el deploy. Y con la imagen anterior vuelven
los defaults de BullMQ: una carga interrumpida se re-ejecuta. Ante un problema con los reapers, la
salida rápida es `IMPORTS_REAPER_DESACTIVADO`; para lo demás, corregir hacia adelante.

### 9.7 Fallos silenciosos

| Qué puede pasar en silencio | Cómo queda a la vista |
|---|---|
| El worker muere y la carga queda PROCESANDO para siempre | El reaper la cierra FALLIDA con motivo y con qué hacer; notificación roja; el bloqueo "una importación por usuario" se libera solo |
| La carga se re-ejecuta sola y duplica (comentarios de ACCIONES) o pisa lo ya cargado | No se re-ejecuta: BullMQ no la vuelve a entregar y, si igual lo hiciera, el worker la cierra sin procesar. Test dedicado |
| **El reaper cierra una carga que estaba viva** | Tres comprobaciones independientes y dos pasadas (§9.5.6). Si igual pasara: la carga viva corta en el lote siguiente y lo deja en el log, y la cerrada dice cuántas filas tenía |
| Un estado terminal pisado por una escritura tardía | La condición va en el `where` de cada escritura del tracker (§9.3) |
| El reaper de borradores borra una carga que alguien estaba por confirmar | Relee con `FOR UPDATE` el mismo lock que toma la confirmación. Y deja en el log el número de cada remesa que borró |
| El reaper de borradores borra algo con datos | No toca nada con un caso, ni sin fila de progreso, ni fuera de PENDIENTE/VALIDANDO; y ante una referencia inesperada el `delete` falla y esa remesa queda |
| Una carga queda en cola y nunca arranca (el job se perdió) | El reaper la cierra a los ~4 minutos con "no llegó a empezar. No se cargó ninguna fila" |
| Una carga en cola **legítima** cerrada por vieja | No puede pasar: la antigüedad sola no cierra una carga en cola; tiene que faltar el job |
| Una carga en cola con su job, y un worker que no lo toma | **No se cierra sola** (no hay cómo distinguirla de una espera legítima sin arriesgar la anterior). Se ve: `warn` del reaper cada 15 minutos, la pantalla avisa que es la próxima y nadie la tomó, y el operador la puede eliminar |
| El post-proceso parece colgado y está trabajando (o al revés) | La subfase con "N de M" se mueve; el latido distingue "el servidor trabaja" de "el servidor no da señales" |
| Una carga viva que no avanza (un `await` que no vuelve) | **No se cierra sola** (§9.1). Se ve: `warn` del reaper cada 15 minutos, y en la pantalla "no muestra avances hace N min… no se va a marcar como fallida sola" |
| Un reporte de progreso que falla frena o tumba una carga | Los reportes son sincrónicos, sin IO y con `try/catch`; el reloj nunca deja una promesa sin manejar |
| El reloj sigue escribiendo después de terminada la carga | `finalizar`, `fallar` y el `finally` del runner lo detienen; la escritura del latido lleva `finishedAt: null` en su condición |
| Descartadas infladas en una carga dividida (se leían como "el filtro tiró media cartera") | `fueraDeCorte` las separa. En todas las remesas de una división, `descartadasPorFiltro` da el mismo número |
| Filas de otros cortes que no se cargan y nadie cuenta | Se cuentan y se muestran en el detalle de cada remesa. `procesadas + descartadas` = filas del archivo |
| Casos que colapsan por identidad repetida | La vista previa lo sigue avisando antes de ejecutar. Además, en DEUDORES, `ok − nuevos − actualizados` es esa cantidad; el nombre en pantalla llega con el resumen de la Fase C |
| `nuevos` / `actualizados` en cero donde en realidad no se sabe | Donde la categoría no lo informa es `null`, y la pantalla no muestra el contador |
| La ETA promete una hora que no es | Es de las filas y el texto lo dice; no hay ETA del post-proceso |
| Un bloqueo largo del event loop | `warn` con la remesa, la fase y la duración |
| BullMQ da por perdido un job | Los listeners lo dejan en el log con formato (hoy sale por `console.error`, sin `requestId`) |
| Un `jobId` que ya es de otra carga (Redis perdió sus datos) hace sacar de la cola el job equivocado | Se comprueba `job.data.remesaId` antes de tocar un job (§9.5.6). Es un bug de la Fase A |
| Confirmar y borrar a la vez, y las dos dicen OK | 409 o 404, según quién llegó primero (§9.5.8) |
| El encolado "falla" pero la carga está corriendo | Se responde 201 con el estado real, no "probá de nuevo" (§9.5.8) |
| Los contadores de una carga interrumpida, hasta un segundo atrasados | Es el intervalo del reloj. Lo dice la wiki; el texto del motivo no afirma un número exacto |
| Un permiso nuevo que nadie puede asignar | No aplica: no se agrega ninguno |
| Algo escrito al disco del contenedor que se pierde en el deploy | No aplica: el estado vive en MySQL. (Los archivos de los borradores borrados quedan en el volumen: deuda conocida, §9.1) |
| Una variable de entorno nueva que en prod no existe | Todas tienen un default en el código (§9.5.11) |

### 9.8 Frontend

Sin el componente único de la Fase C: cada pantalla que ya existe muestra lo nuevo en su lugar. El
frontend sigue sin tests ni lint; la verificación está en §9.9.4.

#### 9.8.1 Tipos y utilidades

- `frontend/src/types/importProgreso.ts`: los tipos de §9.4.1, copiados tal cual.
- `frontend/src/utils/estadoCarga.ts`. Todo lo que es texto o regla vive acá, en funciones puras:
  - `etiquetaFase(estado, contexto)`: la tabla de §9.8.2. Pasa a leer `subfase` y `enColaDelante`.
  - `descartadasPorFiltro(estado)`: `estado.descartadasPorFiltro ?? estado.descartadas`. Es el
    respaldo de §9.4.5; los componentes usan la función, no el campo.
  - `lineaDeRitmo(estado)`: `null` si `velocidad` no es un número; si no, "≈ 34 filas/s" y, si hay
    `etaSegundos`, " · faltan ~4 min para terminar las filas".
  - `formatearEspera(segundos)`: "menos de 1 min" · "~N min" · "~H h M min".
  - `formatearNumero(n)`: separador de miles.
  - `minutosSinSenal(estado, recibidoEn, vistoEn, ahora)`: reemplaza a `minutosSinNovedades`
    (`:226-244`) con la misma cuenta, pero vale para `LEYENDO`, `PROCESANDO` y `POST_PROCESO`.
  - `minutosEnColaSinTomar(estado, recibidoEn, ahora)`: solo `EN_COLA` con `enColaDelante === 0`; es
    la edad de `encoladaAt`, medida con `servidorAhora`. Con `enColaDelante` `null` o `undefined`
    devuelve `null`: no se avisa de lo que no se sabe.
  - `presentarResultado`: en `SIN_FILAS`, el detalle de §9.8.2.
  - Constantes: `SIN_SENAL_MIN = 2` (reemplaza a `SIN_NOVEDADES_MIN = 5`, `:14`),
    `EN_COLA_SIN_TOMAR_MIN = 2`, `SIN_CAMBIOS_MIN = 10`.

Todo campo nuevo se lee tolerando `undefined`: `== null` y nunca `=== null`.

#### 9.8.2 Textos

Los mismos en el wizard, el detalle, la campanita y la wiki. Reemplazan a la tabla de fases de §8.8.8;
la tabla de resultados de §8.8.8 sigue valiendo, salvo `SIN_FILAS`.

| Fase | Texto | Texto secundario |
|---|---|---|
| *Subiendo* (solo wizard, paso 2) | Subiendo archivos… N % | X de Y MB |
| *Archivo recibido* (solo wizard, paso 2) | Armando la vista previa… | El servidor está leyendo el archivo. |
| `BORRADOR` (en "Importando") | Enviando a la cola… | — |
| `BORRADOR` (en el detalle) | Borrador | Vista previa sin confirmar. No se cargó nada. |
| `EN_COLA`, posición desconocida | En cola | Esperando que termine otra importación. |
| `EN_COLA`, `enColaDelante = 0` | En cola | Es la próxima: empieza en instantes. |
| `EN_COLA`, `enColaDelante = 1` | En cola | Hay 1 importación antes que esta. |
| `EN_COLA`, `enColaDelante = n > 1` | En cola | Hay n importaciones antes que esta. |
| `LEYENDO` | Leyendo el archivo | Todavía no se procesó ninguna fila. |
| `PROCESANDO` | Procesando | — (debajo de los contadores, la línea de ritmo) |
| `POST_PROCESO`, sin subfase | Post-proceso | Consolidando y cerrando la carga. Puede tardar varios minutos. |
| `POST_PROCESO`, con subfase | Post-proceso | {subfase}, tal cual llega |
| otra | el valor de `fase` tal cual | — |

Línea de ritmo: "≈ {velocidad} filas/s · faltan {espera} para terminar las filas". Sin ETA, solo la
primera parte. En el post-proceso no hay línea de ritmo.

`SIN_FILAS`, detalle: *(si `descartadasPorFiltro > 0`)* "El filtro de la plantilla descartó las
{descartadasPorFiltro} filas." *(si `fueraDeCorte > 0`)* "{fueraDeCorte} filas son de otros cortes de
la división." Las dos oraciones pueden ir juntas.

Una carga interrumpida no tiene texto propio en el frontend: es una `FALLIDA`, y el motivo y qué hacer
vienen escritos en `error` (§9.5.5).

#### 9.8.3 Avisos de una carga en vivo (`components/import/AvisosCarga.tsx`)

Los usan el wizard y el detalle. Pasan a cubrir las fases que §8.13 dejó afuera:

| Aviso | Cuándo | Severidad | Texto |
|---|---|---|---|
| Sin conexión | Igual que hoy | warning | Igual que hoy |
| Sin señal del servidor | `LEYENDO`, `PROCESANDO` o `POST_PROCESO`, y `minutosSinSenal >= 2` | warning | "El servidor no da señales de esta carga hace N min. Si no se recupera, en unos minutos se marca sola como fallida y vas a poder volver a importar." |
| En cola y nadie la toma | `EN_COLA`, `enColaDelante = 0`, y `minutosEnColaSinTomar >= 2` | warning | "Esta carga es la próxima de la cola y el servidor no la tomó hace N min. Si sigue así, avisá a soporte. Mientras no arranque, la podés eliminar desde el Historial." |
| Sin cambios | `PROCESANDO` o `POST_PROCESO`, **con** señal, y este navegador no vio cambiar `fase`, `subfase`, `procesadas`, `ok` ni `err` en 10 minutos | info | "El servidor sigue trabajando, pero esta carga no muestra avances hace N min (contados desde que abriste esta pantalla). Puede ser un paso largo. Si sigue así, avisá a soporte: no se va a marcar como fallida sola." |
| Reinicio | `intentos > 1` | info | Igual que hoy. Ya no debería verse (§9.3); se deja por las cargas anteriores |

- **"Sin señal" baja de 5 a 2 minutos** porque el latido pasó de uno por lote a uno cada 15 segundos:
  dos minutos son ocho latidos perdidos.
- **Los textos no dicen "5 minutos":** el umbral es una variable del servidor y el frontend no la
  conoce. Dicen "en unos minutos".
- **El aviso de la cola no promete un cierre automático**, a diferencia del de "sin señal". El reaper
  cierra una carga en cola solo si su job **no existe**; si el job está y el worker no lo toma, no la
  cierra (§9.5.6), y la pantalla no puede distinguir un caso del otro. Lo que sí es cierto siempre:
  una carga en cola que no arrancó se puede eliminar (Fase A).
- **"Sin cambios" se mide en el navegador**, desde que se abrió la pantalla, y el texto lo dice. No hay
  en la base un dato de "último avance": recargar la página reinicia la cuenta. Es una limitación
  aceptada (§9.1): el aviso es una pista para el operador, no una decisión del sistema.
- "Sin señal" y "sin cambios" se excluyen: sin señal no se sabe si avanza.

#### 9.8.4 Wizard

**Subida** (`pages/ImportWizard.tsx`). Los dos `POST` que mandan archivos —`division-preview`
(`:322-324`) y `remesas` (`:409-411`)— agregan `onUploadProgress` y guardan `{ enviados, total }` en
un estado. Mientras ese estado existe, la barra genérica del pie (`:1286`) se reemplaza por una barra
con porcentaje y los textos de §9.8.2. Con `total` desconocido, barra sin porcentaje y los MB
enviados. Cuando `enviados` llega a `total`, pasa a "Armando la vista previa…" hasta que responde la
validación (`:428`). El estado se limpia en el `finally`. No toca el backend.

**Vista previa** (paso 3). El texto de las descartadas (`:1040-1044`) usa `descartadas −
(fueraDeCorte ?? 0)`. En la alerta de "no tiene filas" (`:1124-1130`) se va la condición
`!esDivision`: con los dos números separados el texto es correcto también en una división, y agrega
la oración de los otros cortes de §9.8.2.

**Importando** (`components/import/ImportProgress.tsx`):

- La fase, con `etiquetaFase` (`:86`, `:186-195`): posición en la cola, "Leyendo el archivo", y en el
  post-proceso, la subfase.
- Debajo de los contadores, la línea de ritmo.
- Contadores (`:165-183`): Total, Procesadas, OK, Errores, **Descartadas** —que pasa a ser
  `descartadasPorFiltro`— y, si no son `null`, **Nuevos** y **Actualizados**. Con separador de miles.
- Se va la prop `ocultarDescartadas` (`:25-26`, `:42`, `:175`, y `ImportWizard.tsx:1105`): existía porque el
  número mezclaba las dos cosas.
- La barra no cambia de regla: con porcentaje solo en `PROCESANDO` con total conocido.

**Resultado** (`components/import/ImportSummary.tsx`):

- "Descartadas" vuelve a mostrarse en una carga dividida (`:100-105`, `:224`). En una carga simple es
  `descartadasPorFiltro`. En una dividida **no se suma** —cada remesa lee el archivo entero, y sumar
  multiplicaría el número por la cantidad de remesas—: se muestra el valor común, y si las remesas no
  coinciden no se muestra total y cada fila de remesa lleva el suyo.
- Métricas "Casos nuevos" y "Casos actualizados", sumadas, solo si todas las remesas del resumen las
  informan.

#### 9.8.5 Detalle, campanita y hook

- **`pages/ImportDetail.tsx`.** El bloque de la carga en curso (`:435-452`) muestra la fase con
  posición o subfase y la línea de ritmo. Los avisos ya están montados (`:454-458`). Debajo de las
  cuatro tarjetas (`:477-512`), una línea con lo que no entra en ellas, mostrando solo lo que
  corresponda: "Casos nuevos: N · Casos actualizados: M · Descartadas por el filtro de la plantilla:
  D · De otros cortes de la división: F (no se cargan en esta remesa)". Vale para cargas en curso y
  terminadas. Es el arreglo de la última fila "B" de §8.13.
- **`components/layout/AppShell/ImportEnCursoItem.tsx`.** Ya dibuja el texto de fase (`:43-46`) y su
  secundario (`:67-71`): con `etiquetaFase` nuevo aparecen solos la posición y la subfase. En `PROCESANDO`
  agrega la espera abreviada: "Procesando · 43% · faltan ~4 min". No muestra avisos ni los contadores
  nuevos: es una fila angosta.
- **`hooks/useEstadoCarga.ts`.** Un solo cambio: si llega un evento de importación de **otra** remesa
  mientras la propia está `EN_COLA`, se llama a `refrescar()` —la cola se movió—, con un mínimo de 5
  segundos entre refrescos por esa vía. Quien no recibe eventos ajenos ve la posición actualizada por
  la consulta de cada 30 s que ya existe.
- **No cambian:** `NotificacionesContext`, `NotificacionesPopover`, `SocketContext`, `ImportHistory`,
  `api/imports.ts`.

Todo con `theme.palette`, sin colores escritos a mano, y probado en claro, oscuro y ancho de celular.

### 9.9 Plan de pruebas

**Línea de base, medida el 09/10/2026 sobre HEAD `a5ed9c4`:**

- Backend: `npx jest src/modules/imports src/modules/realtime src/modules/notificaciones` → **43
  suites, 824 tests, todos pasan.** `npx jest` completo → **93 suites y 1.500 tests pasan** (1 suite y
  3 tests salteados, que ya lo estaban).
- Frontend: `npx tsc --noEmit -p tsconfig.json` → **los mismos 5 errores de la Fase A**:
  `MappingEditor.tsx:443` y `:499`, `ImportHistory.tsx:423`, `Login.tsx:104`,
  `theme/components.ts:165`.

#### 9.9.1 Qué pasa con los specs que ya existen

**Los specs de los processors pasan sin tocar una línea.** El diseño se armó mirando los asserts que
lo obligan:

- `ctx.progreso` es opcional, y sin él ninguna llamada a un colaborador cambia de forma
  (`facturas.processor.spec.ts:253`, §9.4.4).
- `processImportJob` sigue devolviendo `{ total, ok, err }` exactos y la secuencia de eventos del caso
  B-1 es la misma (§9.5.3).
- `descartadas` no cambia de significado (caso B-3, §9.2).
- La compensación del encolado sigue siendo la misma llamada con el mismo `data` (casos C-7, F5 y H1).
- La escritura del `jobId` sigue siendo la misma llamada (caso C-1).
- Las guardas nuevas están en negativo: las fixtures sin `estadoProceso`, sin fila o sin `encoladaAt`
  no las disparan.

**Un único caso existente cambia, y cambia porque cambia la política:** `B-8`, en
`imports-progreso-eventos.spec.ts:350-369`, afirma que una re-ejecución reinicia los contadores y suma
un intento. Con la regla 1 de §9.3 eso ya no es lo que tiene que pasar. **Se borra de ese archivo** y
lo reemplaza el caso FB-4 de abajo. Es la única modificación admitida a un spec existente; cualquier
otra es señal de que algo dejó de ser compatible: **parar y reportar**.

A `progreso/estado-carga.spec.ts` y a `bullmq/imports.processor.spec.ts` se les **agregan** casos; no
se toca ninguno de los que tienen.

#### 9.9.2 Specs nuevos de backend

**A. `progreso/estado-carga.spec.ts`** (casos nuevos)

- `armarEstadoCarga`: `fueraDeCorte` null en una fila sin el campo; `descartadasPorFiltro` = 7 − 4 = 3;
  nunca negativo; en una heredada, `fueraDeCorte: null` y `descartadasPorFiltro: 0`.
- Velocidad y ETA: 3.000 de 14.466 a los 90 s → 33,3 filas/s y 344 s; a los 4 s → `null`; con
  `procesadas: 0` → `null`; fuera de `PROCESANDO` → `null`; con `procesadas >= totalEsperado` →
  velocidad sí, ETA `null`; una ETA de más de 48 h → `null`. Ningún caso da `NaN` ni `Infinity`.
- `enColaDelante`: sale solo en `EN_COLA`; con `extras` en otra fase → `null`.
- `textoNotificacion`, `SIN_FILAS`: con filtro, con corte y con los dos.
- `textoInterrupcion`: las tres familias de categorías más `SIN_JOB`; empieza siempre con la oración
  fija; la primera oración entra en los 300 caracteres de la notificación; el total, en 4.000.

**B. `progreso/progreso-tracker-reloj.spec.ts`** (nuevo; timers falsos de jest, reloj inyectado)

| # | Caso | Qué tiene que pasar |
|---|---|---|
| R-1 | Tras `iniciar`, 60 s sin ningún reporte | 4 escrituras de latido (a los 15, 30, 45 y 60 s); ningún evento; ninguna toca `remesa` |
| R-2 | 500 llamadas a `avance` en un mismo tic | Cero escrituras hasta el tic; en el tic, una escritura y un `import:progreso` con los últimos contadores |
| R-3 | `avance` continuo durante 10 s | A lo sumo 10 escrituras del reloj; `rev` creciente; el porcentaje no baja nunca |
| R-4 | El intervalo se configura | Con `intervaloMs: 250`, hasta 4 por segundo; un valor fuera de las cotas cae a la cota |
| R-5 | Una escritura del reloj tarda 3 s | Los tics de esos 3 s no lanzan otra: nunca hay dos escrituras en vuelo |
| R-6 | `lote` con una escritura del reloj en vuelo | Espera a que termine y recién escribe; al final la memoria tiene los contadores de `lote` |
| R-7 | Un reporte llega **durante** una escritura del reloj | No se pierde: la escritura siguiente lo lleva (prueba que la memoria no se pisa con la foto vieja) |
| R-8 | `finalizar` con un tic pendiente | El último evento es `finalizada`; avanzando 60 s más no hay ni una escritura ni un evento |
| R-9 | `fallar` y `cerrar` | Detienen el reloj; `cerrar` dos veces no tira |
| R-10 | La escritura del reloj rechaza, diez veces seguidas | Ninguna promesa rechazada sin manejar (listener de `unhandledRejection`); `sucio` sigue prendido; un solo `warn` en ese minuto; al volver la base, escribe |
| R-11 | La escritura no encuentra la fila (`P2025`), o el latido devuelve `count: 0` | `cerradaPorFuera` pasa a `true`; el reloj se detiene; el próximo `lote` tira `CargaCerradaPorFueraError` |
| R-12 | `subfase('Consolidando casos', 1500, 8875)` | El texto persistido y emitido es "Consolidando casos: 1.500 de 8.875"; sin total, solo el nombre; un nombre de 300 caracteres se recorta a 160 |
| R-13 | Cambia el nombre de la subfase | Un `log` con el nombre del paso que terminó y su tiempo |
| R-14 | `avanceDelLote(300)` con `ok: 1000, err: 0` | `procesadas: 1300`; después de `lote({ ok: 2000, … })`, `procesadas: 2000` |
| R-15 | `entrarEnLectura` y después el primer `avance` | Fase `LEYENDO` persistida y emitida; con el primer `avance`, la memoria pasa a `PROCESANDO` |
| R-16 | Un tic llega 7 s tarde | `warn` "Event loop bloqueado" con la remesa y la fase |
| R-17 | `contadores({ nuevos: 5 })` y `fueraDeCorte` | Viajan en la escritura siguiente; sin informar quedan en `null`, no en 0 |
| R-18 | El `where` de las escrituras | Todas llevan `estadoProceso: { notIn: [...] }`; solo la de `iniciar` lleva además el `NOT` del borrador |

**C. `imports-progreso-fase-b.spec.ts`** (nuevo; `ImportService` real y un arnés propio, con el mismo
enfoque que `imports-progreso-eventos.spec.ts`: no se le importa el arnés a ese archivo para no tocarlo)

| # | Caso | Qué tiene que pasar |
|---|---|---|
| FB-1 | 900 filas, un solo lote, cada fila tarda (timers falsos) | Entre `iniciada` y el `progreso` del lote hay eventos intermedios con porcentaje creciente, a lo sumo uno por intervalo. **Es el "0 a 99 de golpe" de #2** |
| FB-2 | Por fila: el processor informa `contadores` y, en `afterAll`, dos subfases con "N de M" | Los eventos de `POST_PROCESO` traen `subfase` con el texto armado, en orden; el terminal trae `subfase: null`, y `nuevos` / `actualizados` |
| FB-3 | Por lote: el processor llama `filasDelLote` a mitad del lote | Un evento intermedio con `procesadas > ok + err`; el del fin de lote, con `procesadas = ok + err` |
| FB-4 | **Re-entrega** (reemplaza a B-8): la fila previa tiene `startedAt` y no `finishedAt` | `processRow` no se llama ni una vez. Una sola `finalizada`, `FALLIDA`, con el texto de interrupción. `intentos` no sube. Notificación. Devuelve `ignorado: true` |
| FB-5 | Re-entrega de una carga que está viva en este proceso | No se cierra nada; `ignorado: true` |
| FB-6 | `iniciar` no encuentra la fila (la carga volvió a borrador o ya es terminal) | Ningún evento, nada procesado, `ignorado: true` |
| FB-7 | Cerrada por fuera en el segundo lote | El tercer lote no se procesa; **no** hay `fallar` ni notificación; `ignorado: true`; el estado que dejó el otro no se toca |
| FB-8 | 10 filas: 3 no pasan el filtro de la plantilla, 4 son de otro corte, 3 entran | `descartadas: 7`, `fueraDeCorte: 4`, `descartadasPorFiltro: 3`, `procesadas: 3` |
| FB-9 | Lo mismo en una remesa sin corte | `fueraDeCorte: null` |
| FB-10 | Una fila que no pasa ni el filtro ni el corte | Cuenta en `descartadas` y **no** en `fueraDeCorte` |
| FB-11 | Categoría pre-parseada | Hay un `progreso` con `LEYENDO` antes del primero con `PROCESANDO` |
| FB-12 | Un CSV | Ningún evento con `LEYENDO` |
| FB-13 | Un Excel (armado en el test) | `LEYENDO` antes de la primera fila |
| FB-14 | El registro de cargas vivas | Durante el job, `cargaVivaEnEsteProceso(1)` no es `null`. Después de terminar bien, de fallar, de un job ignorado y de uno cerrado por fuera, es `null` |
| FB-15 | El `ctx` que recibe el processor | Trae `progreso` con los tres métodos, y ninguno tira aunque el tracker esté cerrado |

**D. `processors/progreso-reportes.spec.ts`** (nuevo: **la secuencia por categoría** que pedía §4)

Processors reales, cada uno con un `prisma` falso mínimo —como en sus specs— y un `ctx.progreso` que
graba las llamadas. Un bloque por categoría:

| Categoría | Qué se afirma |
|---|---|
| ACTUALIZACIONES (desasignar) | Subfases, en orden: `Desasignando ausentes` (N de M creciente, de a 500) → `Consolidando la remesa de origen` → `Cerrando promesas cumplidas` solo si hubo pagos. `contadores` con altas y existentes. `filasDelLote` creciente y nunca mayor que el lote |
| ACTUALIZACIONES (pagó todo) | `Cerrando ausentes`, N de M sobre los deudores de la remesa de origen |
| PAGOS | `Consolidando casos con pagos` → `Cerrando promesas cumplidas`. `contadores` no se llama nunca |
| FACTURAS | `Recalculando importes` → `Consolidando casos` → `Uniendo datos adicionales`. `filasDelLote` por tanda |
| DEUDORES_Y_FACTURAS | `Recalculando importes` → `Consolidando casos`. Tres filas del mismo caso nuevo: `nuevos: 1`, `actualizados: 0` |
| DEUDORES | Sin subfases. Fila que crea → `nuevos`; fila sobre un caso que ya estaba en la remesa → `actualizados`; segunda fila sobre un caso creado por esta carga → ninguno de los dos |
| MULTIRREGISTRO, MULTIARCHIVO | `Desasignando ausentes` solo con la plantilla en desasignar; `Consolidando casos tocados`; `contadores` con altas y actualizados |
| MULTICLAVES | `Buscando pagos de estas claves` → `Consolidando casos con pagos` solo si hay pagos. Ni `filasDelLote` ni `contadores` |
| ACCIONES | `Guardando datos para revertir`, N de M sobre los snapshots |
| CONTACTOS, ENRIQUECIMIENTO | Ninguna llamada a `progreso` |

Y dos casos transversales: **(1)** cada processor, corrido **sin** `ctx.progreso`, llama a `consolidar`
con un solo argumento; **(2)** un `ctx.progreso` cuyos métodos tiran no cambia el resultado del
processor (lo ataja el tracker; acá se prueba el uso con `?.` y que el flujo no dependa del reporte).

**E. `progreso/reaper-cargas.service.spec.ts`** (nuevo; `prisma` e `ImportService` falsos, reloj inyectado)

| # | Caso | Qué tiene que pasar |
|---|---|---|
| RC-1 | Carga **viva en este proceso**, con el latido de hace 30 minutos | No se cierra ni en la primera pasada ni en la décima. `warn` de latido atrasado |
| RC-2 | Arrancada, latido de hace 6 min, sin job | Primera pasada: no cierra, la anota. Segunda (60 s después): cierra con `SIN_LATIDO` |
| RC-3 | Igual, pero entre las dos pasadas vuelve a latir | No cierra y olvida la sospecha |
| RC-4 | Latido de hace 4 min | Ni siquiera consulta la cola |
| RC-5 | Job `ACTIVO_CON_LOCK` | No cierra nunca |
| RC-6 | Job `ACTIVO_SIN_LOCK` | Cierra a la segunda pasada; no toca el job |
| RC-7 | Job `EN_ESPERA` con la carga arrancada | Cierra a la segunda pasada **y saca el job** |
| RC-8 | La cola no responde (`DESCONOCIDO`) | No cierra; y una sospecha anterior se borra (hacen falta dos pasadas seguidas con respuesta) |
| RC-9 | Dos pasadas con 20 s de diferencia | No cierra: faltan los 45 s |
| RC-10 | En cola hace 10 horas, **con** el job esperando | No cierra. Es la carga que espera detrás de otra |
| RC-11 | En cola hace 3 min, sin job | Cierra a la segunda pasada, con `SIN_JOB` |
| RC-12 | En cola hace 1 min, sin job | No es candidata |
| RC-13 | En cola, con el job activo | No cierra: el worker la está tomando |
| RC-14 | Viva en este proceso y sin avance hace 20 min | No cierra; un `warn`, y no otro hasta 15 min después |
| RC-15 | La consulta de candidatas | Parte de `import_progreso`, con `encoladaAt` no nulo y `finishedAt` nulo: una remesa sin fila, un borrador y una terminal no pueden aparecer |
| RC-16 | `IMPORTS_REAPER_DESACTIVADO` | Ninguna de las dos funciones consulta nada |
| RC-17 | Una pasada arranca con otra en curso | La segunda sale sin hacer nada |
| RC-18 | Umbral: sin definir, `abc`, `1`, `500` | 5, 5, 3, 120 |
| RC-19 | En cola hace 10 min, con el job esperando, y ninguna carga viva en el proceso | No cierra; un `warn` "hay un job esperando y el worker no lo toma", y no otro hasta 15 min después |
| RB-1 | Borradores: el `where` | Exactamente el predicado de §5.2: estados, antigüedad, fila en `BORRADOR` sin `encoladaAt`, y ningún deudor |
| RB-2 | Un borrador de 25 h | Se borran `importerror`, `jobimport` y la remesa, en ese orden, dentro de **su** transacción |
| RB-3 | Entre el listado y el lock, alguien la confirmó | No se borra |
| RB-4 | Entre el listado y el lock, apareció un deudor | No se borra |
| RB-5 | El borrado de una falla | `warn` con el id; las demás se borran igual |
| RB-6 | TTL: sin definir, `abc`, `0`, `9999` | 24, 24, 1, 720 |
| RB-7 | Hay 600 candidatas | Procesa 500 y avisa que quedó cola |

**F. `imports-progreso-http-fase-b.spec.ts`** (nuevo)

| # | Caso | Qué tiene que pasar |
|---|---|---|
| H-1 | `cerrarCargaInterrumpida` sobre una remesa terminal, un borrador, una sin fila, y una inexistente | `null` en las cuatro; ninguna escritura |
| H-2 | Sobre una carga viva en este proceso | `null`; ni siquiera abre la transacción |
| H-3 | `SIN_LATIDO`, pero al releer con el lock el latido es reciente | `null` |
| H-4 | `SIN_JOB`, pero al releer ya tiene `startedAt` | `null` |
| H-5 | Cierre real | Remesa `FALLIDA` con `okFilas` / `errFilas` de la fila; fila `TERMINADA`, `FALLIDA`, `error` con el texto de la categoría, `subfase` null, `finishedAt`; `heartbeatAt` sin tocar. Emite `import:finalizada`, notifica y audita `IMPORT_FAIL`, en ese orden y después del commit |
| H-6 | La notificación, el socket o la auditoría tiran | El cierre queda hecho y la función devuelve el estado |
| H-7 | `estadoDelJobDeCarga` | Los seis resultados, con una cola falsa. Un `jobId` cuyo job es de **otra** remesa se trata como inexistente y se busca por `data.remesaId`. Una excepción o el tope vencido dan `DESCONOCIDO` |
| H-8 | `sacarJobDeLaCola` con un `jobId` que es de otra remesa | No lo saca |
| H-9 | Borrar: la lectura inicial la vio borrador y, con el lock, está encolada | `409`; no borra |
| H-10 | Borrar: la vio en cola, sacó el job, y con el lock sigue en cola sin arrancar | Borra (es el camino de la Fase A) |
| H-11 | Confirmar: el `update` del `jobId` da `P2025` | Saca el job recién encolado y responde `404`; no emite |
| H-12 | Confirmar: el `add` falla y la compensación da `P2025`, con la carga ya arrancada | Responde `201` con el estado real; `warn` |
| H-13 | Confirmar: lo mismo, pero la remesa ya no existe | `404` |
| H-14 | La compensación | Su `where` lleva `fase: 'EN_COLA'` y `startedAt: null` |
| H-15 | `enColaDelante` | En la respuesta de `executeRemesa`, en `progreso(id)`, en `status(id)` y en `listarEnCurso`; cuenta las cargas de otros usuarios aunque el listado no las traiga; si la consulta falla, es `null` y nada más cambia |
| H-16 | Vista previa de una remesa con corte | `descartadas` (total), `fueraDeCorte`, y `filtro` sin la condición del corte |

**G. `bullmq/imports.processor.spec.ts`** (casos nuevos)

- `OPCIONES_WORKER_IMPORT` vale exactamente `{ concurrency: 1, lockDuration: 120000,
  stalledInterval: 30000, maxStalledCount: 0 }`, y las opciones por defecto de la cola,
  `{ attempts: 1 }`.
- Los tres listeners loguean y **no llaman** a ningún método de `ImportService`.

#### 9.9.3 Lo que solo se puede probar contra Redis y MySQL de verdad

Los tests de arriba no levantan Redis. Lo que el diseño **leyó** en el código de BullMQ y no ejecutó
(§9.13) se comprueba en el paso BE-0, **antes de escribir código de producción**, con colas de prueba
(nunca `import-queue`) contra el Redis local, y lo repite el auditor:

| # | Sonda | Resultado esperado | Si no da |
|---|---|---|---|
| S-1 | Con `maxStalledCount: 0`, un proceso toma un job y se lo mata con `kill -9`; otro proceso levanta un worker de la misma cola | El processor **no se vuelve a llamar**. El job termina `failed` con "job stalled more than allowable limit" | Reportar. La política igual se sostiene por la guarda de re-entrega (§9.5.3) |
| S-2 | Con un job activo y su worker vivo: `EXISTS bull:<cola>:<id>:lock` | `1`. Después de matar al worker, `0` al vencer `lockDuration` | Reportar: `estadoDelJobDeCarga` no puede distinguir `ACTIVO_CON_LOCK` |
| S-3 | Un job bloquea el event loop 150 s, con `lockDuration: 120_000` | El job termina; BullMQ lo marca fallido después; el processor se llamó **una** vez; el worker toma el job siguiente | Reportar |
| S-4 | Contra MySQL local: `remesa.update` con `where: { id, estadoProceso: { notIn }, NOT: { progreso: { is: { encoladaAt: null } } } }` | Encuentra una remesa sin fila y una con `encoladaAt`; no encuentra una con fila y `encoladaAt` null; cuando no encuentra, tira `P2025` | Reportar: cambia cómo se escribe la condición de `iniciar` |

#### 9.9.4 Frontend

Sin tests. Los mismos tres controles que en §8.9.2, obligatorios:

```bash
cd frontend
npx tsc --noEmit -p tsconfig.json   # exactamente los 5 errores de base; ninguno en archivos tocados
npm run build
npm run verificar-ayuda
```

#### 9.9.5 Prueba manual (la usan el auditor y los usuarios que prueban)

Con la app levantada en local. Preparación: `IMPORTS_BATCH_SIZE=1000` (el default: lo que se prueba es
justamente el lote grande), un CSV de DEUDORES de unas 900 filas y otro de unas 3.000, una plantilla
con división de remesa y filtro de filas, y `IMPORTS_LATIDO_UMBRAL_MIN=3` para no esperar de más.

| # | Qué hacer | Qué tiene que verse |
|---|---|---|
| MB-1 | Importar el CSV de 900 filas | El porcentaje sube varias veces antes de terminar (no 0 → 99). Debajo de los contadores, "≈ N filas/s · faltan ~…". Aparecen **Nuevos** y **Actualizados** |
| MB-2 | Volver a importar el mismo archivo en otra remesa, y después una carga de ACTUALIZACIONES sobre una remesa de origen grande | En el post-proceso, "Post-proceso — Consolidando la remesa de origen: N de M", con N creciendo. Nunca "100 %" clavado |
| MB-3 | A mitad de la carga de 3.000 filas, matar el backend (`kill -9`) y volver a levantarlo | El detalle dice "El servidor no da señales de esta carga hace N min…" a partir de los 2 min. Entre 3 y 5 min después del corte pasa a **FALLIDA**, con el texto de interrupción y "Antes del corte se cargaron N filas". Notificación roja. En el log **no hay** un segundo "Iniciando importación" de esa remesa. El mismo usuario puede importar de nuevo |
| MB-4 | Con una carga larga de A corriendo, B confirma otra; esperar más que el umbral | La de B dice "En cola — Hay 1 importación antes que esta" y **no** se marca fallida. Cuando termina la de A, arranca |
| MB-5 | Confirmar una carga y, antes de que arranque, borrar su job de Redis a mano (con el worker ocupado en otra carga) | A los ~4 min, FALLIDA: "La importación no llegó a empezar… No se cargó ninguna fila" |
| MB-6 | Reiniciar el backend con una carga **en cola** | Después de levantar, arranca sola. El reaper no la toca |
| MB-7 | Crear tres vistas previas sin confirmar; en la base local, poner `createdAt` de dos de ellas 25 horas atrás, y a una de esas dos agregarle un caso; disparar el reaper de borradores | Se borra una sola (la vieja sin casos), y el log dice su número. Una remesa PENDIENTE sin fila de progreso, insertada a mano, no se toca |
| MB-8 | Carga dividida en 3 remesas, con una plantilla que además filtra filas | En "Importando" se ve **Descartadas** con el mismo número en las tres. En el detalle de cada una, "Descartadas por el filtro de la plantilla: D · De otros cortes de la división: F". `procesadas + D + F` da las filas del archivo en las tres |
| MB-9 | Subir un archivo de más de 50 MB | "Subiendo archivos… N %" con los MB, y después "Armando la vista previa…" |
| MB-10 | Importar un Excel de unas 100.000 filas (generado) | "Leyendo el archivo" antes de la primera fila. En el log, el `warn` de event loop bloqueado si la lectura pasó de 5 s. La carga termina bien |
| MB-11 | Con el bundle del frontend de la Fase A (pestaña vieja) contra el backend nuevo, repetir MB-1 y MB-3 | Nada se rompe. Puede verse "LEYENDO" en mayúsculas. La carga interrumpida aparece como "La importación falló" con el texto |
| MB-12 | Mientras corre una carga, mirar `import_progreso.heartbeatAt` | Se mueve al menos cada 15 s, también durante el post-proceso |
| MB-13 | Paso "Importando", detalle y campanita en claro, oscuro y ancho de celular, con una subfase larga | Se lee todo, nada se desborda, ningún color fuera del tema |

Un `await` que nunca vuelve (el aviso "sin cambios") y un bloqueo del event loop de más de dos minutos
no tienen forma razonable de provocarse a mano: los cubren los casos R-16, RC-1 y RC-14.

### 9.10 Documentación

- **Wiki** (`docs/ayuda/03-importacion/`, paquete de frontend; cambia en el mismo commit que el flujo y
  actualiza el `revisado` de cada página):
  - `05-importar-un-archivo.md` — la que más cambia. El paso 2 (la subida y sus dos textos). La tabla
    de fases de "Importando" (`:162-168`): En cola con la posición, Leyendo el archivo, Procesando con
    la línea de ritmo y Nuevos / Actualizados, Post-proceso con la subfase. Los avisos (`:180-194`):
    el de "sin novedades" pasa a ser "sin señal", a los 2 minutos, **también en post-proceso**; el de
    "en cola y nadie la toma"; el de "sin cambios"; y se va la frase "una carga que se interrumpe no
    falla sola" (`:192-193`), que deja de ser cierta, junto con "Esta carga se reinició" (`:194`). El
    resultado de la carga dividida (`:218-221`, `:255-257`): Descartadas se vuelve a mostrar, y qué
    son las filas de otros cortes. "La carga está En cola y no avanza" (`:310-314`). "La importación
    falló: qué hacer": la carga interrumpida, con los tres textos de §9.5.5. "La importación quedó
    procesando y no avanza" (`:360-365`): ahora falla sola.
  - `08-historial-y-problemas.md` — la tabla de estados (`:27-35`), igual que la de `01`. "La carga
    quedó procesando y no avanza" (`:263-277`) se reescribe:
    se marca fallida sola a los ~5 minutos sin señal, libera el bloqueo, y no se re-ejecuta. La
    excepción —el servidor trabaja pero la carga no avanza— no se cierra sola: avisar a soporte.
    Sección nueva: **las vistas previas sin confirmar se borran solas a las 24 horas**. Y en el
    detalle, la línea de nuevos, actualizados, descartadas por filtro y de otros cortes.
  - `07-acciones-masivas.md` — "¿Y si la carga muestra «Esta carga se reinició»?" (`:183-186`) se
    reemplaza: una carga interrumpida ya no se reinicia; queda fallida, lo aplicado no se puede
    revertir desde la pantalla y **no** hay que volver a cargarla.
  - `01-como-funciona.md` — en la tabla de estados (`:109-115`), "Fallida: se cortó" agrega que una
    carga interrumpida se marca sola; y donde dice que una vista previa sin confirmar es un borrador
    (`:101`, `:117-118`), que se borra sola a las 24 horas.
  - Revisar, y tocar solo si hay algo que dejó de ser cierto: `03-formatos-de-archivo.md:175` y
    `04-crear-plantilla.md:355` (descartadas por filtro), `09-multirregistro-y-multiarchivo.md`
    (progreso de MULTIARCHIVO).
  - `cd frontend && npm run verificar-ayuda`. Cada página pasa por un agente revisor antes de
    cerrarse (memoria `auditar-documentacion-con-agentes`): en la Fase A las cuatro salieron con
    errores en la primera revisión.
- **`docs/notificaciones-spec.md`** (paquete de backend): la línea del throttle (`:99`) —un segundo,
  sin regla del 5 %, dentro del `ProgresoTracker`, y el latido que no emite—; que `import:finalizada`
  puede emitirla el reaper; y una entrada fechada en su §5.
- **`backend/.env.example`**: las cuatro variables de §9.5.11.
- **`CHANGELOG.md`**: lo escribe quien orquesta, al cerrar, con lo que devuelva cada implementer.
- **Este documento**: quien orquesta actualiza el encabezado y §4, y agrega un §9.15 con lo que cambió
  al auditar, como se hizo con §8.13.
- **Memorias** (fuera del repo, quien orquesta): `progreso-imports-realtime` y `prod-aws-acceso-logs`,
  cuya frase "un deploy mata las importaciones en curso… y BullMQ reintenta el job" deja de valer.

### 9.11 Criterios de aceptación

**Schema y deploy**

- **CB-1.** El diff entre la base local previa y el schema nuevo es exactamente
  ``ALTER TABLE `import_progreso` ADD COLUMN `fueraDeCorte` INTEGER NULL`` y nada más. `npx prisma db
  push` termina **sin pedir `--accept-data-loss`**. Después, `prisma migrate diff` da vacío.
- **CB-2.** El `git diff` de `schema.prisma` no toca ningún enum, ninguna otra tabla ni ningún índice.
- **CB-3.** Sin ninguna variable de entorno nueva definida, el backend levanta y loguea `Reaper de
  importaciones activo: sin latido a los 5 min, borradores a las 24 h`.

**Backend, automáticos**

- **CB-4.** `npm run build` pasa. Las 43 suites y los 824 tests de base pasan **sin que cambie ningún
  assert, salvo el caso B-8**, que se borra. Los specs de `processors/` no tienen ni una línea de diff.
- **CB-5.** Pasan los specs A a G de §9.9.2.
- **CB-6.** Una carga de 900 filas en un solo lote emite eventos intermedios entre `iniciada` y el
  fin del lote (FB-1).
- **CB-7.** Con reportes continuos, el reloj escribe y emite a lo sumo una vez por intervalo, y sin
  reportes escribe el latido cada 15 s sin emitir (R-1, R-3).
- **CB-8.** Después del estado terminal no hay ninguna escritura ni ningún evento más, y el último
  evento es siempre `import:finalizada` (R-8).
- **CB-9.** Una escritura del reloj que falla nunca deja una promesa rechazada sin manejar (R-10).
- **CB-10.** El job de una carga que ya había arrancado **no procesa ninguna fila**: la carga queda
  FALLIDA con el texto de interrupción (FB-4).
- **CB-11.** El reaper **no cierra una carga viva en el proceso**, por viejo que sea su latido (RC-1).
- **CB-12.** El reaper no cierra nada en una sola pasada, ni cuando la cola no responde (RC-2, RC-8).
- **CB-13.** Una carga en cola con su job esperando no se cierra aunque lleve horas (RC-10).
- **CB-14.** Una carga cerrada por el reaper: remesa FALLIDA con los contadores reales, motivo según
  la categoría, `import:finalizada`, notificación y auditoría (H-5).
- **CB-15.** `cerrarCargaInterrumpida` no escribe sobre una remesa terminal, un borrador ni una
  remesa sin fila (H-1).
- **CB-16.** El reaper de borradores consulta exactamente el predicado de §5.2 y no borra una remesa
  confirmada o con casos entre el listado y el lock (RB-1, RB-3, RB-4).
- **CB-17.** Los processors informan las subfases de la tabla de §9.5.4, con esos nombres y en ese
  orden (spec D).
- **CB-18.** Sin `ctx.progreso`, `consolidar` se llama con un solo argumento en todos los processors
  (spec D, caso transversal 1).
- **CB-19.** 10 filas con 3 fuera por filtro y 4 de otro corte: `descartadas: 7`, `fueraDeCorte: 4`,
  `descartadasPorFiltro: 3` (FB-8).
- **CB-20.** `velocidad` y `etaSegundos` nunca son `NaN` ni `Infinity`, y son `null` fuera de
  `PROCESANDO` (spec A).
- **CB-21.** Confirmar y borrar a la vez nunca responde OK a las dos (H-9, H-11). Una carga que el
  worker ya tomó no vuelve a borrador (H-12, H-14, FB-6).
- **CB-22.** Las cuatro sondas de §9.9.3 dan el resultado esperado, o está reportado cuál no.

**Frontend y manuales**

- **CB-23.** `npx tsc --noEmit` da exactamente los 5 errores de base. `npm run build` y `npm run
  verificar-ayuda` pasan.
- **CB-24.** Una carga de 900 filas muestra avance intermedio, velocidad y ETA (MB-1).
- **CB-25.** ACTUALIZACIONES muestra "Post-proceso — Consolidando la remesa de origen: N de M" (MB-2).
- **CB-26.** Con el backend muerto a mitad de una carga, y `IMPORTS_LATIDO_UMBRAL_MIN=3`, la carga
  pasa a FALLIDA con motivo en 5 minutos o menos, **no se re-ejecuta**, y el usuario puede volver a
  importar (MB-3). Con el default, en 7 minutos o menos.
- **CB-27.** Una carga en cola detrás de otra larga muestra su posición y no se marca fallida (MB-4).
- **CB-28.** Una carga en cola sin job se marca "no llegó a empezar" en 5 minutos o menos (MB-5).
- **CB-29.** En una carga dividida, las tres remesas muestran el mismo número de descartadas por
  filtro, y el detalle separa las de otros cortes (MB-8).
- **CB-30.** La subida de un archivo grande muestra su porcentaje (MB-9).
- **CB-31.** Una pestaña con el frontend de la Fase A sigue funcionando contra el backend nuevo (MB-11).
- **CB-32.** Ninguna página de la wiki dice que una carga colgada "no falla sola" ni que "se reinició",
  y la de Historial dice que los borradores se borran a las 24 horas.
- **CB-33.** Nada de lo nuevo usa colores fuera de `theme.palette` (MB-13).

### 9.12 Paquetes de trabajo

Dos paquetes con **conjuntos de archivos disjuntos**, para dos `implementer` en paralelo sobre el mismo
working tree. El contrato de §9.4 es el único punto de contacto. Valen las cinco reglas de §8.12:
nadie commitea, nadie toca un archivo del otro paquete ni el `CHANGELOG.md` ni este documento, nada de
`npm run lint` / `eslint --fix` / `prisma format`, ante una duda de contrato manda §9.4, y cada
informe trae lo hecho, los desvíos, la salida de la verificación y el texto para el CHANGELOG.

#### Paquete BE — backend

| Archivo | Qué |
|---|---|
| `backend/prisma/schema.prisma` | Campo `fueraDeCorte` y el comentario de `descartadas` (§9.2) |
| `backend/src/modules/imports/progreso/estado-carga.types.ts` | Tipos de §9.4.1 |
| `backend/src/modules/imports/progreso/estado-carga.ts` | `armarEstadoCarga` (campos nuevos, velocidad, ETA), `textoNotificacion` (`SIN_FILAS`), `textoInterrupcion` (nueva) |
| `backend/src/modules/imports/progreso/estado-carga.spec.ts` | Casos nuevos (spec A) |
| `backend/src/modules/imports/progreso/progreso-tracker.ts` | §9.5.2 |
| `backend/src/modules/imports/progreso/progreso-tracker-reloj.spec.ts` | **Nuevo.** Spec B |
| `backend/src/modules/imports/progreso/reaper-cargas.service.ts` | **Nuevo.** §9.5.6 y §9.5.7 |
| `backend/src/modules/imports/progreso/reaper-cargas.scheduler.ts` | **Nuevo.** Los dos `@Cron` |
| `backend/src/modules/imports/progreso/reaper-cargas.service.spec.ts` | **Nuevo.** Spec E |
| `backend/src/modules/imports/utils/reporte-progreso.ts` | **Nuevo.** `SUBFASE` y `consolidarConProgreso` |
| `backend/src/modules/imports/processors/processor.interface.ts` | `ReporteProgreso` y `ctx.progreso?` |
| `backend/src/modules/imports/processors/{deudores,deudores-facturas,facturas,pagos,actualizaciones,casos-cedente,multiclaves,acciones}.processor.ts` | Reportes de §9.5.4. **Ningún cambio de lógica** |
| `backend/src/modules/imports/utils/monto-facturas.ts` | Subfases de recálculo y de datos adicionales; `consolidarConProgreso` |
| `backend/src/modules/imports/utils/recorrer-filas.ts` | **Solo** se exporta `esExcel` |
| `backend/src/modules/imports/processors/progreso-reportes.spec.ts` | **Nuevo.** Spec D |
| `backend/src/modules/imports/imports.service.ts` | §9.5.3, §9.5.5, `estadoDelJobDeCarga`, el arreglo de `sacarJobDeLaCola`, §9.5.8, §9.5.9, §9.5.10 |
| `backend/src/modules/imports/imports.module.ts` | `defaultJobOptions` y los dos providers del reaper |
| `backend/src/modules/imports/bullmq/imports.processor.ts` | `OPCIONES_WORKER_IMPORT` y los tres listeners |
| `backend/src/modules/imports/bullmq/imports.processor.spec.ts` | Casos nuevos (spec G) |
| `backend/src/modules/imports/imports-progreso-eventos.spec.ts` | **Solo** se borra el caso B-8 |
| `backend/src/modules/imports/imports-progreso-fase-b.spec.ts` | **Nuevo.** Spec C |
| `backend/src/modules/imports/imports-progreso-http-fase-b.spec.ts` | **Nuevo.** Spec F |
| `backend/.env.example` | Las cuatro variables |
| `docs/notificaciones-spec.md` | §9.10 |

No se tocan: `multirregistro.processor.ts`, `multiarchivo.processor.ts`, `contactos.processor.ts`,
`enriquecimiento.processor.ts`, `processor-registry.ts`, `consolidacion/`, `realtime/`,
`utils/progress-emitter.ts`, ni ningún `*.spec.ts` de `processors/` que ya exista.

Pasos:

1. **BE-0 — Las cuatro sondas de §9.9.3**, antes de escribir código de producción. Si alguna no da lo
   esperado: **parar y reportar**. Va primero porque dos decisiones del diseño descansan en lo que
   BullMQ hace y eso solo se leyó.
2. **BE-1 — Schema.** `npx prisma db push` **sin** `--accept-data-loss`; si Prisma lo pide, parar y
   reportar el aviso textual. `npx prisma generate`.
3. **BE-2 — Contrato y funciones puras**, con el spec A.
4. **BE-3 — Tracker**, con el spec B. Es el paso con más riesgo de concurrencia: el reloj, la
   escritura única y la memoria que no se pisa.
5. **BE-4 — Runner** (`processImportJob`): registro, guardas, LEYENDO, `avance`, filtros separados,
   `ctx.progreso`, `finally`. Spec C, y borrar B-8. Correr **todos** los specs de imports apenas
   compile.
6. **BE-5 — Processors y helper**, con el spec D. Después de cada processor, correr su spec: tiene que
   pasar sin haberlo tocado.
7. **BE-6 — BullMQ:** opciones, listeners, spec G.
8. **BE-7 — Cierre por interrupción y reapers:** `cerrarCargaInterrumpida`, `estadoDelJobDeCarga`, el
   arreglo de `sacarJobDeLaCola`, servicio, scheduler, y sus specs (E y parte del F).
9. **BE-8 — Carreras, posición en la cola y vista previa**, con el resto del spec F.
10. **BE-9 — `.env.example` y `docs/notificaciones-spec.md`.**
11. **BE-10 — Verificación:**

```bash
cd backend
npx prisma migrate diff --from-schema-datasource prisma/schema.prisma \
    --to-schema-datamodel prisma/schema.prisma --script      # → "This is an empty migration."
npm run build
npx jest src/modules/imports src/modules/realtime src/modules/notificaciones
npx jest
git diff --stat -- 'src/modules/imports/processors/*.spec.ts'  # → vacío
```

#### Paquete FE — frontend

| Archivo | Qué |
|---|---|
| `frontend/src/types/importProgreso.ts` | Tipos de §9.4.1 |
| `frontend/src/utils/estadoCarga.ts` | §9.8.1 y §9.8.2 |
| `frontend/src/components/import/AvisosCarga.tsx` | §9.8.3 |
| `frontend/src/components/import/ImportProgress.tsx` | §9.8.4 |
| `frontend/src/components/import/ImportSummary.tsx` | §9.8.4 |
| `frontend/src/pages/ImportWizard.tsx` | Subida, vista previa y la prop que se va (§9.8.4) |
| `frontend/src/pages/ImportDetail.tsx` | §9.8.5 |
| `frontend/src/components/layout/AppShell/ImportEnCursoItem.tsx` | §9.8.5 |
| `frontend/src/hooks/useEstadoCarga.ts` | El refresco en cola (§9.8.5) |
| `docs/ayuda/03-importacion/01-como-funciona.md`, `05-importar-un-archivo.md`, `07-acciones-masivas.md`, `08-historial-y-problemas.md` (y `03`, `04`, `09` solo si la revisión encuentra algo) | §9.10 |

No se tocan: `SocketContext.tsx`, `NotificacionesContext.tsx`, `NotificacionesPopover.tsx`,
`ImportHistory.tsx`, `api/imports.ts`, `useImportacionesEnCurso.ts`.

Pasos:

1. **FE-1 — Tipos y utilidades.** Base de todo; no depende del backend.
2. **FE-2 — `AvisosCarga`.**
3. **FE-3 — Wizard:** subida, vista previa e `ImportProgress`.
4. **FE-4 — `ImportSummary`.**
5. **FE-5 — Detalle.**
6. **FE-6 — Campanita y hook.**
7. **FE-7 — Wiki**, con los textos de §9.8.2, §9.8.3 y §9.5.5 copiados, no parafraseados.
8. **FE-8 — Verificación:** los tres comandos de §9.9.4.

La prueba contra el backend real (§9.9.5) la hace el auditor con los dos paquetes cerrados.

### 9.13 Qué se verificó y qué es suposición

| Afirmación | Cómo se sabe |
|---|---|
| Línea de base: 43 suites / 824 tests; 93 / 1.500 en total; 5 errores de `tsc` | **Ejecutado** el 09/10/2026 sobre `a5ed9c4` |
| La base local está sincronizada con el schema de HEAD | **Ejecutado** (`prisma migrate diff`, solo lectura) |
| El SQL de la columna nueva es un único `ADD COLUMN … NULL` | **Ejecutado** (`prisma migrate diff` contra una copia del schema con el campo agregado, fuera del repo) |
| El `db push` de esa columna no pide `--accept-data-loss` | **Suposición fundada**: es una columna nullable sobre una tabla sin filas en prod. No se ejecutó ningún push. Lo verifica BE-1 |
| Duraciones, parseos, consolidaciones, la re-ejecución de la remesa 102 y la ausencia de fallas de lock (§9.1) | **Leído de prod** (CloudWatch Logs Insights, solo lectura) el 09/10/2026 |
| Tiempos y memoria de `xlsx` | **Ejecutado** en la máquina de desarrollo, con archivos sintéticos sin comprimir. Orientativo: la EC2 es más lenta |
| La clave del lock es `${queue.toKey(jobId)}:lock`; los jobs de la app se guardan con `attempts: 0` (sin reintentos); los jobs terminados no se borran | **Leído** en `scripts.js:360` y en el Redis local (solo lectura) |
| Con `maxStalledCount: 0` BullMQ falla un job perdido sin llamar al processor | **Leído** en BullMQ 5.70.4 (`moveStalledJobsToWait-8.lua:87-92`, `worker.js:562`, `:596-599`). **No ejecutado.** Sonda S-1 |
| Un bloqueo del event loop más largo que el lock no produce una doble ejecución | **Leído** (`lock-manager.js`, `worker.js`). **No ejecutado.** Sonda S-3. El diseño no depende del detalle: lo cubren la guarda de re-entrega y la de "ya terminó" |
| El chequeo de jobs perdidos usa el `maxStalledCount` del worker que lo corre, no el del que encoló | **Leído** (`scripts.js:1001-1020`) |
| `@Processor(nombre, opciones)` le pasa las opciones al worker; `@OnWorkerEvent` funciona en un `WorkerHost` | **Leído** en el repo: `consolidacion.processor.ts` usa las dos cosas |
| `ScheduleModule.forRoot()` de `reportes.module.ts` alcanza para los `@Cron` de otros módulos | **Leído**: los schedulers de convenios, promesas y mora no lo importan y corren |
| `update` de Prisma 6.18 acepta condiciones no únicas y de relación en el `where`, y tira `P2025` si no encuentra la fila | **Suposición** sobre una función documentada de Prisma. No ejecutado contra MySQL. Sonda S-4 |
| Cada referencia `archivo:línea` de §9 | **Leído** contra `a5ed9c4` |
| Los remedios por categoría de una carga interrumpida (§9.5.5) | DEUDORES, DEUDORES_Y_FACTURAS y ACCIONES: **leídos** contra `deleteRemesa` y los processors. El resto no afirma remedio. **Ninguno se ejecutó**: lo tiene que atacar el auditor |
| Los specs de los processors pasan sin tocarlos | **Suposición de diseño**, sostenida en los asserts que se leyeron (el de `facturas.processor.spec.ts:253` entre ellos). Lo confirma BE-5 |
| El caso B-1 pasa sin tocarlo | **Suposición de diseño**: depende de que un lote de filas falsas dure menos que el intervalo del reloj (1 s) |
| Hay un solo proceso de backend en prod | **Dato del entorno** (una EC2, un contenedor; el deploy recrea), no verificado por el architect |
| En prod `import_progreso` tiene 0 filas, y las remesas 93 y 98 siguen sin fila | **Dato de quien encargó el diseño**, consultado el 09/10/2026 |
| El reloj del contenedor de prod es UTC | **Suposición**: el compose no define `TZ` |

### 9.14 Lo que necesita el OK del usuario antes de implementar

> **Estado al cierre de la implementación (09/10/2026).** Quien orquestó avanzó con los valores de este
> diseño **por defecto**, porque todos se pueden cambiar antes del deploy (nada se commiteó ni se pusheó
> sin que el usuario lo vea). **El usuario todavía no los confirmó.** Los puntos 1 a 5 siguen siendo
> suyos; el 6 y el 7 ya son hechos: la columna se agregó en la base local sin que Prisma pidiera
> `--accept-data-loss`, y la fase llevó una jornada de agentes. Dos números cambiaron al auditar: el
> cierre automático llega entre 6 y 7 minutos (no entre 5 y 7), y el texto de Deudores es el de §9.15.

Ninguna de estas cosas es técnica: son decisiones sobre qué le pasa a una carga y qué ve el operador.

1. **Una carga interrumpida no se re-ejecuta: falla con motivo** (§9.5.1). Hoy, tras un deploy, se
   re-ejecuta sola una vez. Es el cambio de comportamiento más grande de la fase. Lo que se gana: nada
   se duplica ni se pisa en silencio. Lo que se paga: después de un corte hay que volver a cargar a
   mano, y hasta la Fase C no hay botón de reintentar.
2. **El número: 5 minutos sin latido** (§5.3), y que el cierre sea automático. El usuario afectado
   queda entre 5 y 7 minutos sin poder importar; bajar el número acorta la espera, subirlo no agrega
   seguridad.
3. **Que el reaper de borradores arranque activo.** El predicado y las 24 horas ya estaban decididos
   (§5.2); lo que falta confirmar es que el primer job que borra remesas solo corra desde el primer
   día. Hay una consulta para ver antes qué borraría (§9.6) y una variable para apagarlo.
4. **Los textos que ve el operador cuando una carga se interrumpe** (§9.5.5), en particular los dos
   que mandan a hacer algo: "eliminá esta importación y volvé a cargar el archivo" (DEUDORES y
   DEUDORES_Y_FACTURAS) y "no vuelvas a cargar el archivo" (ACCIONES).
5. **Lo que queda afuera** (§9.1): no hay fase FINALIZANDO; el parseo síncrono no se toca; PAGOS no
   muestra nuevos ni actualizados hasta la Fase C; y una carga viva que no avanza no se cierra sola.
6. **Un cambio de schema**, que §8.2 había dicho que no iba a hacer falta: una columna nullable (§9.2).
7. **El tamaño:** unos 4 días de backend y 2 de frontend, más las rondas de auditoría. §4 decía 2 en
   total.

No bloquean la Fase B y siguen abiertas: §5.4 (cancelar), §5.5 (cargas ajenas) y §5.6 (carga dividida).

### 9.15 Lo que cambió después de la auditoría (09/10/2026)

Los dos paquetes se implementaron y pasaron por tres auditorías independientes (backend, frontend y
wiki), tres pasadas cada una; el backend tuvo además una cuarta ronda de arreglos que **no** volvió a
pasar por el auditor (ver "Veredictos al cierre"). Esta sección registra **dónde el código se apartó del diseño de §9.1 a
§9.12** y por qué. A diferencia de §8.13, las tablas y el pseudocódigo de arriba **no** se reescribieron
(solo llevan una marca en los lugares más engañosos): donde se contradicen, vale lo de acá.

**Lo que se vio funcionar por primera vez.** La auditoría de backend levantó la aplicación completa en
local (`node dist/main`, MySQL y Redis reales, un cliente `socket.io` de verdad) y corrió importaciones
de punta a punta: es la primera vez que las Fases A y B corren con HTTP, guards, socket, BullMQ y crons
juntos. Medido:

- Carga de 60.000 filas: 328 eventos del reloj separados entre 973 y 1.027 ms; 357 eventos comparados
  contra la fila con el mismo `rev`, 0 diferencias; latido p50 1.000 ms.
- `kill -9` a mitad de una carga: no se re-ejecutó (mismos casos antes y después, `intentos` 1); el lock
  de BullMQ venció a los 120 s, el job quedó `failed` a los 156 s y el reaper cerró la carga a los 248 s
  y a los 286 s del último latido (dos corridas, umbral de 3 minutos). 409 "ya tenés una importación en
  curso" mientras figuraba en curso, 201 después.
- Proceso congelado 200 s con `SIGSTOP` (más que el umbral y que el lock): el reaper logueó "latido
  atrasado 200 s en una carga viva", **no la cerró**, y la carga terminó bien.
- Una carga en cola esperó 8,8 minutos detrás de otra sin que nadie la cerrara y arrancó sola; después de
  un reinicio, una carga en cola arrancó 1,4 s después de levantar.
- Carga en cola con el job borrado de Redis: FALLIDA "no llegó a empezar" a los 185 s.
- Carga dividida con filtro: en las tres remesas, 900 procesadas, 300 por filtro y 1.800 de otros cortes.
- El estado de la base es idéntico con y sin `ctx.progreso` en DEUDORES, FACTURAS, PAGOS, ACTUALIZACIONES
  (desasignar y pagó todo) y ACCIONES.

**Backend** (primera pasada NO PASA por un hallazgo ALTO; segunda y tercera, PASA CON OBSERVACIONES).

| Qué | Diseño de §9 | Cómo quedó | Por qué |
|---|---|---|---|
| "Un terminal nunca se pisa" | Un `where` condicionado en el `remesa.update` del tracker (`estadoProceso notIn`); un `P2025` significaba "cerrada por fuera" | **Compuerta**: cada escritura del tracker que toca `remesa` (`iniciar`, `lote`, `entrarEnLectura`, `entrarEnPostProceso`, `finalizar`, `fallar`) corre en una transacción que primero relee la remesa y su fila con `SELECT … FOR UPDATE` y recién después escribe. `TX_TRACKER = { maxWait: 10 s, timeout: 60 s }` | El `update` condicionado de Prisma **no es atómico**: hace un `SELECT` y después un `UPDATE … WHERE`; si la remesa pasó a terminal en el medio, el `UPDATE` afecta 0 filas, **no tira `P2025`**, y el `UPDATE import_progreso` anidado corre igual. Contra `cerrarCargaInterrumpida`, 84 de 150 rondas terminaban con el terminal pisado o con dos `import:finalizada`: remesa FALLIDA con la fila "en curso", y el usuario bloqueado sin salida. La sonda S-4 solo lo había probado sin concurrencia. Hoy lo tapaba el registro de cargas vivas (con un proceso no se disparaba), pero es el gancho de "cancelar" de la Fase C. Con los tiempos por defecto de Prisma (2 s / 5 s) la compuerta hacía fallar un lote si el pool estaba ocupado 3 s: por eso las opciones explícitas |
| Escritura de progreso del reloj | La misma que `lote` (un `remesa.update`) | **Solo `import_progreso`**: `updateMany` con `where { remesaId, finishedAt: null }`, chequeo de filas afectadas y lectura del `rev`, en una transacción corta. `remesa.okFilas / errFilas` se escriben al cierre de cada lote, como en la Fase A | Es atómica en una sentencia y deja de competir por la fila de la remesa: detrás de una transacción de 12 s que insertaba hijos de la remesa, la escritura del reloj esperaba 11,8 s (y el latido con ella, y un tercer escritor, 9,1 s); ahora tarda 8 ms. §9.5.2 afirmaba que el latido "no compite por locks": recién ahora es cierto |
| Carga cerrada por fuera al entrar al post-proceso | `entrarEnPostProceso` que falla: `warn` y sigue (decisión de §8.13) | `CargaCerradaPorFueraError` se relanza: **no corre el `afterAll`**, ni `fallar`, ni la notificación | Ejecutado: ACTUALIZACIONES con "pagó todo" cerrada desde otra instancia generó 50 pagos automáticos y 50 casos a SIT-050 sobre una carga ya FALLIDA |
| Compensación del encolado | Un `update` condicional directo, con una "ventana residual" admitida (§9.5.8) | Transacción con `FOR UPDATE`: en cola sin arrancar → vuelve a borrador y 503; tomada o terminada → 201 con el estado real; sin fila → 404 | Misma causa que la primera fila: 23 de 150 rondas respondían 503 "probá de nuevo" con la carga FINALIZADA y sus casos cargados |
| Carga terminal sin fila de progreso | El caso F4 de la Fase A decía que se procesaba | **Se ignora** (FINALIZADA o FALLIDA sin fila); una PENDIENTE sin fila sí se procesa | "De un terminal no se sale" (§8.3). F4 pasaba porque su doble contestaba PROCESANDO; se corrigieron el doble y el assert |
| Evento de `LEYENDO` | — | Sale **antes** del parseo, con el total de la vista previa (que puede ser 0) | Un assert de la Fase A exigía el total del parseo en todos los `progreso`: ahora excluye ese evento |
| `actualizados` en DEUDORES y DEUDORES_Y_FACTURAS | Casos que ya estaban en la remesa | **`null`** (siguen informando `nuevos`) | "Ya existía" se mira dentro de la propia remesa, que siempre es nueva: daba siempre 0 y el operador leía "ningún cliente existía". Lo útil es otra cosa: `ok − nuevos` son las filas que cayeron sobre un caso creado por la misma carga (identidades repetidas) |
| `contadores()` | Entran a la memoria al llamarse | Se anotan y entran a la foto con el `avance` o el `lote` siguiente | El processor informa a mitad de fila: una carga matada quedó con `nuevos` 7.684 y `ok` 7.683. Lo que se garantiza es `nuevos <= ok + err` |
| Texto de una carga interrumpida | Corrido | La oración fija, `\n\n`, y el qué hacer | La notificación lleva solo la primera línea del motivo |
| Remedio de DEUDORES / DEUDORES_Y_FACTURAS | "…(se puede mientras sus casos no tengan gestión) y volvé a cargar el archivo." | "Lo procesado hasta el corte quedó cargado en esta remesa. Eliminá esta importación desde el Historial y volvé a cargar el archivo. Si no se puede eliminar (porque algún caso ya tiene gestión o porque la remesa es muy grande), avisá a soporte antes de volver a cargarlo." | El remedio no andaba con remesas grandes (ver `deleteRemesa`) |
| Remesa que es un corte de un archivo dividido | No previsto | El motivo agrega: "Esta remesa es un corte de un archivo dividido: al volver a cargarlo, tildá solo los cortes que no se cargaron. Si tildás uno que ya está cargado, sus casos quedan duplicados." En la interrumpida de DEUDORES / DEUDORES_Y_FACTURAS y en "no llegó a empezar" de cualquier categoría | Al resubir el archivo vienen todos los cortes tildados y no hay ninguna guarda (`archivoHash` se guarda y no se compara): las nóminas ya cargadas se duplican |
| `deleteRemesa` | No se tocaba | Tope previo `IMPORTS_BORRADO_MAX_CASOS` (60.000): más casos responde 400 "No se pudo eliminar: la remesa es demasiado grande para borrarla desde la pantalla. Avisá a soporte." sin abrir la transacción. `TX_BORRADO = { timeout: 120 s, maxWait: 5 s }`. Si la causa es de tiempo o de conexión (`P2028`, `P1017`, lock wait timeout 1205), el 400 dice "No se pudo eliminar: la base de datos no respondió a tiempo. Probá de nuevo en unos minutos; si se repite, avisá a soporte." | Con el timeout por defecto (5 s), una remesa real de 60.020 casos daba `P2028` y no se podía eliminar, justo donde el motivo manda al operador; ahora 60.000 casos con contactos se borran en 4,6 a 10,3 s. El tope está en 60.000 porque el límite real, anterior a esta fase, es 65.535: con más, `comentario.count` con `deudorId IN (…)` tira MySQL 1390 "too many placeholders". Y el timeout está en 120 s **para que no venza**: ver la fila siguiente |
| Transacciones que vencen | No previsto | El tracker **no cree en un solo resultado vacío**: si el `updateMany` del reloj o del latido devuelve `count: 0`, lo confirma con una lectura nueva (fila viva → falla transitoria y reintento; lectura también vacía → hacen falta dos tics seguidos para darse por cerrado); la compuerta reintenta la transacción una vez si el `FOR UPDATE` no devuelve fila. Un terminal visible se sigue detectando al instante | El `timeout` de una transacción interactiva de Prisma **no corta la sentencia en curso** (con 8 s, el borrado respondió a los 18,2 s) y, cuando vence con la sentencia en vuelo, **contamina la operación siguiente de ese cliente**: de 80 casos, 75 dieron error (`P1017` / `P1001`) y 5 devolvieron vacío **sin error** sobre una fila que existe. Con un borrado vencido a mitad de una carga, el reloj recibió `count: 0`, el tracker lo tomó por "cerrada por fuera" y el runner cortó una carga sana en 1.300 de 2.500 filas, sin avisar. Es un riesgo anterior a esta fase (en `a5ed9c4` el borrado vence a los 5 s) y de cualquier lectura del módulo, no solo del tracker |
| Reaper de borradores | El predicado de §5.2 | Además **no borra un borrador cuyo creador tiene una carga en curso** (en el predicado y en la relectura bajo el lock) | Las remesas de una carga dividida que todavía no arrancaron son borradores: con una vista previa de más de 24 h y la división corriendo a las 04:30, se borraban |
| Hora del reaper de borradores | 04:30 UTC (01:30 de Argentina) | **04:30 de Argentina** | `Dockerfile.backend:6` fija `TZ=America/Argentina/Buenos_Aires`. Medido en prod: el cron de las 3 AM corre a las 06:00 UTC |
| Tiempo hasta el cierre automático | Entre 5 y 7 minutos | **Entre umbral + 1 y umbral + 2 minutos** desde el último latido: 6 a 7 con el default | La pasada que supera el umbral solo anota la sospecha; cierra la siguiente |
| `IMPORTS_REAPER_DESACTIVADO` | Cualquier valor no vacío lo apaga | Solo `1`, `true`, `si`, `sí`, `yes`, `on`, `y`, `s` | `=false` y `=0` apagaban los dos crons |
| `sacarJobDeLaCola` con un `jobId` de otra remesa | "No es el buscado" | Lo ignora y busca el job por `data.remesaId`; el método pasó a ser público (lo usa el reaper) | — |
| Guardado del `jobId` en `executeRemesa` | Dentro del `try` del `add` | Fuera | El 404 por `P2025` lo capturaba la compensación y salía como 503 |
| `textoNotificacion` de `SIN_FILAS` | Lee `descartadasPorFiltro ?? descartadas` | Calcula `descartadas − (fueraDeCorte ?? 0)` | Las fixtures de la Fase A ya traen `descartadasPorFiltro: 0` y el respaldo no caía |
| Listener `failed` | "…falló sin ejecutarse…" | "BullMQ dio por perdido el job N (remesa X); si la carga no terminó, la cierra el reaper" | Tras congelar el proceso, lo logueaba justo después de "Importación completada" |
| `motivoLegible` | — | `P2028` → "La base de datos no respondió a tiempo (P2028)."; `P1017` → "La base de datos cerró la conexión (P1017)." | Iban crudos a la notificación |
| API que el diseño no listaba | — | `ProgresoTracker.cerrarSubfase()` y `faseActual`; `ImportService.hayCargasVivasEnEsteProceso()`; el `warn` de "latido atrasado en una carga viva", a lo sumo uno cada 5 minutos | — |

Variables de entorno al cierre: las cuatro de §9.5.11 más `IMPORTS_BORRADO_MAX_CASOS` (default 100.000,
acotado a [1.000, 65.000]). Todas con default en el código.

**Frontend** (PASA CON OBSERVACIONES en la primera y la segunda pasada, PASA en la tercera; 149 pruebas
sobre los módulos reales con jsdom, React en modo estricto y un servidor socket.io real).

| Qué | Diseño de §9 | Cómo quedó | Por qué |
|---|---|---|---|
| `NotificacionesContext` | No se tocaba | La lista de la campanita se re-hidrata con cada `import:iniciada` / `import:finalizada` si hay otra carga en cola, y cada 30 s mientras haya alguna en cola | La posición quedaba vieja: cada evento de la carga que corre renovaba la única marca de "última novedad" y el polling no disparaba nunca. Una carga en cola eliminada seguía listada |
| Mínimo de 5 s entre refrescos | Sin flanco de bajada | `crearRefrescoLimitado`: un pedido dentro de la ventana se programa para cuando cierra | La posición podía quedar vieja 40 s |
| Aviso "sin señal" | "…se marca sola como fallida y vas a poder volver a importar." | "El servidor no da señales de esta carga hace N min. Si no se recupera, en unos minutos se marca sola como fallida y vas a poder hacer otras importaciones; el motivo va a decir qué hacer con esta." | Contradecía el motivo de ACCIONES ("no vuelvas a cargar el archivo") y el genérico |
| Segundo escalón del aviso | — | Con 15 minutos o más (`SIN_SENAL_AVISAR_MIN`): "El servidor no da señales de esta carga hace N min y todavía no se marcó como fallida. Avisá a soporte." | El cierre automático no ocurre si el servidor sigue caído, si la cola no responde o si el control está apagado |
| "Sin señal" en una remesa heredada (`rev === 0`) | El mismo texto | "…Puede estar en un paso largo o haberse interrumpido. Es una carga anterior al seguimiento automático y no se va a marcar como fallida sola: avisá a soporte." | El reaper no puede ver una remesa sin fila |
| "En cola y nadie la toma" | Mide la edad de `encoladaAt` | Mide desde que **esta pantalla** la vio como la próxima | Una carga que esperó 30 minutos detrás de otra avisaba "no la tomó hace 30 min" en el instante del traspaso |
| Motivo de una FALLIDA con filas | "Antes del corte se cargaron N filas…" | "Antes del corte se cargaron **al menos** N filas…", en párrafo propio | En ACTUALIZACIONES y FACTURAS `ok` avanza de a un lote: N es un piso, con hasta 999 filas más aplicadas. §9.3 y §9.7 decían "hasta un segundo atrás": falso para los processors por lote |
| Texto de la subida | "X de Y MB" | "X MB de Y MB"; en KB por debajo de 0,1 MB; sin cantidades antes del primer byte | "0,0 de 0,0 MB" en archivos chicos |
| Descartadas en el detalle | Siempre el desglose | Con `fueraDeCorte == null`, el rótulo neutro "Descartadas: N"; el desglose solo si es un número | Una carga dividida anterior a la Fase B mostraba las filas de otros cortes como "por el filtro de la plantilla" |
| `error` y `errorPostProceso` | — | Se muestran con `white-space: pre-line` | El motivo llega en párrafos |
| Números | — | Separador de miles en todos los contadores; los formateadores no tiran con un valor ausente (devuelven "0") | Un evento malformado tiraba un `TypeError` en la campanita, y el frontend no tiene `ErrorBoundary` |
| `ImportSummary`, `SIN_FILAS` en una división | Suma | Los números de esa remesa | Sumar repetía las descartadas una vez por remesa |

**Wiki** (primera pasada NO PASA en la página `05`, por un ALTO; segunda, PASA CON OBSERVACIONES). Se
tocaron seis páginas de `docs/ayuda/03-importacion/`: `01`, `03`, `04`, `05`, `07` y `08`. Lo más serio
no era de redacción sino del sistema, y por eso terminó también en el código: una carga dividida
interrumpida mandaba a "volver a cargar el archivo" sin decir que hay que destildar los cortes ya
cargados. De paso aparecieron **ocho enlaces relativos rotos** (siete anteriores a esta fase): el visor
solo trata como internos los que empiezan con `/ayuda/`, y desde el "?" de la pantalla de carga sacaban
al operador del asistente, lo que en una carga dividida corta la cadena de remesas. `verificar-ayuda`
ahora marca como error cualquier enlace que no empiece con `/`, `http://`, `https://`, `mailto:` o `#`.

**Datos verificados que §9.13 daba por leídos o supuestos:**

- Las cuatro sondas de §9.9.3 dieron lo esperado contra Redis y MySQL locales. Con `maxStalledCount: 0`
  BullMQ falla el job de un worker muerto sin volver a llamar al processor, a los 120 s (`lockDuration`).
  Tras un bloqueo del event loop más largo que el lock, emite dos `error` "Missing lock for job …
  moveToFinished" antes de marcarlo fallido: el processor se llamó una sola vez.
- **La conclusión de la sonda S-4 era incompleta**: el `update` de Prisma con condiciones no únicas
  encuentra o no la fila como se esperaba, pero no es atómico (primera fila de la tabla de backend).
- El `db push` de la columna `fueraDeCorte` no pide `--accept-data-loss` (ejecutado en local).
- El reloj del contenedor de prod es hora de Argentina, no UTC.
- Ningún processor escribe sobre `remesa` dentro de una transacción: no hay cómo armar un deadlock por
  upgrade de lock (leído; 0 deadlocks y 0 `Lock wait timeout` en todas las corridas).

**Deuda conocida y lo que queda para las fases siguientes:**

| Qué | Dónde se resuelve |
|---|---|
| Nada se vio en un navegador: aspecto, tema claro y oscuro, ancho de celular, los eventos reales de subida de un archivo grande, el "?" con los enlaces arreglados | Prueba manual (§9.9.5) antes o después del deploy |
| Una carga viva que no avanza no se cierra sola; un cierre que llega durante el `afterAll` no lo interrumpe | C, con "cancelar" |
| Una carga en cola cuyo job nadie toma no se cierra sola, y mientras tanto no se limpian los borradores de ese usuario | C |
| No hay cómo reintentar una FALLIDA ni retomar un corte de una división: es volver a subir el archivo destildando a mano | C (carga dividida orquestada en el backend) |
| Remesas de más de 60.000 casos no se pueden eliminar desde la pantalla (antes tampoco: fallaban por timeout, o por el límite de 65.535, con un 500). El borrado dura lo que su sentencia más larga: una remesa con 21.000 casos y 1.050.000 facturas tardó 22,9 s en local; en RDS no se midió | Backlog: borrado por tandas o en un job |
| Una transacción interactiva de Prisma que vence con una sentencia en vuelo contamina la operación siguiente (error o, ~6 % de las veces, vacío sin error). El tracker ya no se deja engañar y el borrado ya no debería vencer, pero **cualquier otra lectura del módulo sigue expuesta** (un `findFirst` de un processor que devuelve `null` de más). Otras transacciones con timeout: la de MULTICLAVES (30 s) y las que usan el default de 5 s | Backlog: revisar los timeouts de transacción de todo el backend |
| Con una escritura del tracker esperando un lock, el latido puede atrasarse hasta ~100 s (menos que el umbral mínimo del reaper, 3 minutos); un lock de más de 50 s hace fallar la carga con "La base de datos tardó demasiado en liberar un bloqueo (1205)." | — |
| `deleteRemesa` no cuenta ni borra `promesa_pago` (su FK a `deudor` no tiene `onDelete`): un caso con promesa y sin otra gestión daría un error de base en vez del mensaje de gestión. Leído, no ejecutado; anterior a esta fase | Backlog |
| `remesa.okFilas / errFilas` van hasta un lote atrás durante la carga (como en la Fase A). Ninguna pantalla los usa como dato vivo; `GET /import/remesas/:id` los devuelve junto a `carga`, que es el dato bueno, y `multiclaves/claves.service.ts:101` los lee | — |
| Una carga dividida corrida con el código de la Fase A (entre el 05/10 y el deploy de la B) muestra sus descartadas sin desglose | Sin backfill, a propósito |
| "descartó las 1 filas": el singular de los textos de `SIN_FILAS` | C |
| El globito de no leídas puede quedar uno atrás si la re-hidratación se cruza con el alta de la notificación (solo con tiempos forzados) | D |
| El pool de conexiones y las latencias de RDS no se midieron: definen cuán probable es que una escritura del tracker espere | Primera carga real en prod |
| DEUDORES_Y_FACTURAS, MULTIRREGISTRO y MULTIARCHIVO no corrieron contra la base en la auditoría (solo leídos); MULTICLAVES corrió con filas sintéticas | Primera carga real, o archivos de cedente en la máquina de prueba |
| El cron de las 04:30 nunca se vio disparar solo (se llamó al método) | Primer día en prod: el log "Reaper de borradores: …" |

**Veredictos al cierre (09/10/2026).** Frontend: PASA (tercera pasada). Wiki: PASA en las seis páginas
(tercera pasada); después se aplicaron cinco ajustes menores de redacción que el revisor sugirió (T1 a
T5), verificados solo con `verificar-ayuda`. Backend: PASA CON OBSERVACIONES en la tercera pasada; las
observaciones (las dos filas de `deleteRemesa` y de las transacciones que vencen, el tope y los textos)
se arreglaron en una cuarta ronda que **no volvió a pasar por el auditor**: quedó verificada con el
build, la suite completa, mutaciones del propio implementer y los arneses del auditor corridos por el
implementer (el tope responde 400 en 5 a 8 ms sin abrir transacción; siete rondas de carga con un
borrado forzado a vencer, 0 anomalías). El caso del resultado vacío es probabilístico (~6 %): que no
haya salido en siete rondas no lo prueba contra la base real; lo cubren los tests con el doble que
devuelve vacío.

Tests al cierre: 49 suites / 1.069 tests en imports + realtime + notificaciones (base: 43 / 824) y 99
suites / 1.745 en la suite completa (base: 93 / 1.500). Frontend: `tsc --noEmit` con los 5 errores de
base, `npm run build` y `npm run verificar-ayuda` en verde. Los arneses de las tres auditorías quedaron
fuera del repo y no se conservan.

**Dos cosas que salieron mal durante el trabajo, para no repetirlas:**

- **Un arnés de auditoría borró logs locales.** Levantó el `AppModule` desde `backend/` sin redirigir
  `LOG_DIR`, y la retención de 14 días de winston eliminó cinco archivos de `backend/logs/` de mediados
  de septiembre. Todo arnés que levante la aplicación tiene que llevar `LOG_DIR` a un directorio temporal.
- **Dos implementers usaron `git stash` sobre el árbol compartido** (para comparar contra la base). No se
  perdió nada, pero durante unos segundos los archivos del otro paquete figuraron revertidos mientras
  otros agentes trabajaban. Con varios agentes sobre el mismo árbol: `git show HEAD:ruta`, nunca `stash`.

---
## PLAN PARA IMPLEMENTER

> Este bloque es el de la **Fase A**, ya ejecutada. El de la Fase B está al final del documento.

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

---
## PLAN PARA IMPLEMENTER — Fase B

Diseño completo en [§9](#9-diseño-de-la-fase-b). Antes de empezar: el OK del usuario a los siete puntos
de §9.14.

**Orden de implementación:**
Dos paquetes en paralelo (§9.12), con el contrato de §9.4 como único punto de contacto. Dentro de cada uno:
- BE-0 las cuatro sondas contra Redis y MySQL locales (dos decisiones del diseño descansan en un comportamiento de BullMQ que solo se leyó: si no da, parar) → BE-1 schema y `db push` → BE-2 contrato y funciones puras → BE-3 tracker (reloj, reportes en memoria, escrituras condicionadas) → BE-4 runner → BE-5 processors y helper → BE-6 opciones y listeners de BullMQ → BE-7 cierre por interrupción y los dos reapers → BE-8 carreras, posición en la cola y vista previa → BE-9 `.env.example` y `notificaciones-spec.md` → BE-10 verificación.
- FE-1 tipos y utilidades (no depende del backend) → FE-2 `AvisosCarga` → FE-3 wizard (subida, vista previa, "Importando") → FE-4 resumen → FE-5 detalle → FE-6 campanita y hook → FE-7 wiki → FE-8 verificación.

**Archivos a crear:**
- Backend: `backend/src/modules/imports/progreso/progreso-tracker-reloj.spec.ts`, `reaper-cargas.service.ts`, `reaper-cargas.scheduler.ts`, `reaper-cargas.service.spec.ts`; `backend/src/modules/imports/utils/reporte-progreso.ts`; `backend/src/modules/imports/processors/progreso-reportes.spec.ts`; `backend/src/modules/imports/imports-progreso-fase-b.spec.ts`, `imports-progreso-http-fase-b.spec.ts`.
- Frontend: ninguno.

**Archivos a modificar:**
- `backend/prisma/schema.prisma` — campo `fueraDeCorte Int?` en `import_progreso` y el comentario de `descartadas`.
- `backend/src/modules/imports/progreso/estado-carga.types.ts` — `LEYENDO` y los campos nuevos del DTO.
- `backend/src/modules/imports/progreso/estado-carga.ts` (y su spec, con casos nuevos) — `armarEstadoCarga` con `fueraDeCorte`, `descartadasPorFiltro`, `enColaDelante`, velocidad y ETA; `textoNotificacion` de `SIN_FILAS`; `textoInterrupcion` nueva.
- `backend/src/modules/imports/progreso/progreso-tracker.ts` — reloj único (latido cada 15 s y volcado de progreso a lo sumo cada 1 s), `entrarEnLectura`, `avance`, `avanceDelLote`, `subfase`, `contadores`, `cerrar`, escrituras condicionadas y `CargaCerradaPorFueraError`.
- `backend/src/modules/imports/processors/processor.interface.ts` — `ReporteProgreso` y `ctx.progreso?` (opcional).
- `backend/src/modules/imports/processors/{deudores,deudores-facturas,facturas,pagos,actualizaciones,casos-cedente,multiclaves,acciones}.processor.ts` y `utils/monto-facturas.ts` — solo llamadas de reporte y `consolidarConProgreso`; ningún cambio de lógica. `utils/recorrer-filas.ts` — solo se exporta `esExcel`.
- `backend/src/modules/imports/imports.service.ts` — `processImportJob` (registro de cargas vivas, guarda de re-entrega, LEYENDO, `avance` por fila, filtros separados, `ctx.progreso`, `finally`); `cerrarCargaInterrumpida`, `estadoDelJobDeCarga`, `cargaVivaEnEsteProceso` (nuevos, públicos); `sacarJobDeLaCola` (comprobar `data.remesaId`); `verificarNoArrancada`, `executeRemesa` (las dos carreras, `enColaDelante`); `progreso`, `status`, `listarEnCurso` (`enColaDelante`); `validateRemesa` (`fueraDeCorte`, `filtro`).
- `backend/src/modules/imports/imports.module.ts` — `defaultJobOptions: { attempts: 1 }` y los providers del reaper.
- `backend/src/modules/imports/bullmq/imports.processor.ts` (y su spec, con casos nuevos) — `OPCIONES_WORKER_IMPORT` y tres listeners que solo loguean.
- `backend/src/modules/imports/imports-progreso-eventos.spec.ts` — **solo** se borra el caso B-8.
- `backend/.env.example`; `docs/notificaciones-spec.md`.
- `frontend/src/types/importProgreso.ts`, `utils/estadoCarga.ts`; `components/import/AvisosCarga.tsx`, `ImportProgress.tsx`, `ImportSummary.tsx`; `pages/ImportWizard.tsx`, `ImportDetail.tsx`; `components/layout/AppShell/ImportEnCursoItem.tsx`; `hooks/useEstadoCarga.ts`.
- No se tocan: `multirregistro`, `multiarchivo`, `contactos` y `enriquecimiento` (`.processor.ts`), `processor-registry.ts`, `consolidacion/`, `realtime/`, `utils/progress-emitter.ts`, ningún spec existente de `processors/`; `SocketContext.tsx`, `NotificacionesContext.tsx`, `NotificacionesPopover.tsx`, `ImportHistory.tsx`, `api/imports.ts`.

**Cambios de schema:** una columna nullable, `import_progreso.fueraDeCorte` (`ALTER TABLE import_progreso ADD COLUMN fueraDeCorte INTEGER NULL`, verificado con `prisma migrate diff`). Sin `@@unique`, sin enums, sin tocar otra tabla. **Sin backfill:** `null` significa "sin corte propio o anterior a la Fase B". `npx prisma db push` sin `--accept-data-loss`.

**Tests a escribir:** casos nuevos en `estado-carga.spec.ts` (campos nuevos, velocidad y ETA sin `NaN`, textos de interrupción); `progreso-tracker-reloj.spec.ts` (18 casos: latido sin emitir, volcado a lo sumo una vez por intervalo, una escritura por vez, la memoria no se pisa, el evento final es el último, ninguna promesa sin manejar, cerrada por fuera, subfases); `imports-progreso-fase-b.spec.ts` (15 casos: avance dentro de un lote de 900 filas, subfases y contadores en los eventos, la re-entrega que reemplaza a B-8, cerrada por fuera, descartadas separadas, LEYENDO, registro de cargas vivas); `processors/progreso-reportes.spec.ts` (la secuencia por categoría con los processors reales, y que sin `ctx.progreso` `consolidar` se llama con un solo argumento); `reaper-cargas.service.spec.ts` (19 casos del reaper de cargas y 7 del de borradores); `imports-progreso-http-fase-b.spec.ts` (16 casos: cierre por interrupción, estado del job, las dos carreras, posición en la cola, vista previa); casos nuevos en `imports.processor.spec.ts`. Detalle en §9.9.2. Más las cuatro sondas de §9.9.3.

**Páginas de la wiki a tocar:** `docs/ayuda/03-importacion/05-importar-un-archivo.md`, `08-historial-y-problemas.md`, `07-acciones-masivas.md`, `01-como-funciona.md`; y `03-formatos-de-archivo.md`, `04-crear-plantilla.md`, `09-multirregistro-y-multiarchivo.md` solo si la revisión encuentra algo que dejó de ser cierto. Actualizar `revisado`, correr `cd frontend && npm run verificar-ayuda` y pasar cada página por un agente revisor.

**Skills a consultar:** BE: `bullmq-worker`, `prisma-migration`, `nestjs-module`, `amsa-general`. FE: `react-component`, `amsa-general`.

**Riesgos durante la implementación:**
- El reloj del tracker corre en un `setInterval`: una promesa rechazada sin manejar tumba el proceso entero. Todo el cuerpo del tic va en `try/catch`.
- La escritura del reloj y las del runner no pueden solaparse, y después de escribir no se reemplaza la memoria (solo `rev` y `heartbeatAt`): si no, los contadores retroceden.
- `consolidar` con un segundo argumento rompe un assert existente (`facturas.processor.spec.ts:253`): siempre por `consolidarConProgreso`.
- Una entrada que quede en el registro de cargas vivas hace inmortal a esa carga para el reaper: el `finally` es obligatorio.
- El reaper nunca cierra en una sola pasada ni con la cola sin responder. Ante la duda, no cierra.
- ACTUALIZACIONES y PAGOS son destructivos: el diff de cada processor son líneas de reporte y nada más. Si hace falta mover una condición o una consulta, parar.
- Si hace falta tocar un assert existente que no sea B-8, parar: algo dejó de ser compatible.
- Lo que hace BullMQ con un job perdido se leyó en su código y no se ejecutó: por eso BE-0 va primero.
- El diseño supone un solo proceso de backend.
- Un remedio para una carga interrumpida solo se escribe si está verificado contra el processor y contra `deleteRemesa`.
- En el frontend, `vite build` no chequea tipos, y todo campo nuevo puede llegar `undefined` desde un backend viejo.
- Si los dos commits se pushean juntos, el frontend llega antes que el backend.
- Volver a la imagen anterior choca con la columna nueva y restaura la re-ejecución automática.

**Criterios de aceptación:** CB-1 a CB-33 de §9.11.
