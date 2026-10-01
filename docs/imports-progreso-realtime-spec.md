# Progreso en tiempo real de las importaciones — diagnóstico y plan

> Estado: **diagnóstico cerrado, nada implementado** (30/09/2026).
> Origen: el usuario reportó cargas que terminan (remesa FINALIZADA) pero cuyo progreso nunca se
> completa en la UI, en la página de progreso y en el panel de notificaciones. Se auditó de punta a
> punta (agente `auditor`, veredicto **NO PASA**). Este documento es el punto de partida para
> implementar: leerlo entero antes de tocar código, y releer [notificaciones-spec.md](notificaciones-spec.md)
> (§ progreso de imports) porque varias cosas que ese spec promete el código no las hace.

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
| Vista previa | `backend/src/modules/imports/imports.service.ts` ~`:1566-1574` (y `:981-1023` MULTIRREGISTRO) | Crea la remesa en PENDIENTE/VALIDANDO, guarda `okFilas/errFilas` de una **muestra de 50 filas** y `totalFilas` |
| Encolado | `imports.service.ts` + `bullmq/` | Job BullMQ con defaults (`attempts` 1, `maxStalledCount` 1, `lockDuration` 30 s) |
| Worker | `imports.service.ts` → `processImportJob` (~`:1990-2360`) | `import:iniciada` → lotes de `IMPORTS_BATCH_SIZE=1000` → `tick` por lote (`:2096-2101`) → `afterAll` (`:2278-2285`) → FINALIZADA/FALLIDA + `import:finalizada` + notificación |
| Persistencia por lote | `imports.service.ts:2091-2094` | `remesa.update` con `okFilas`, `errFilas` y **`totalFilas` = acumulado** (bug #9) |
| Socket | `backend/src/modules/realtime/realtime.service.ts:61-74`, `realtime.gateway.ts` | Emite a sala `user:<id>` y a `admin:` (los admins reciben doble). Namespace `/rt`, JWT en handshake; con JWT vencido hace `client.disconnect()` |
| En curso (HTTP) | `imports.service.ts:1811` `listarEnCurso`, `:1839` | Lista PENDIENTE/VALIDANDO/PROCESANDO; `progreso: jobimport?.progreso ?? 0` |
| Estado (HTTP) | `imports.service.ts` `status()` | `duracionMs` sale de `jobimport` (siempre null) |
| Notificaciones | `backend/src/modules/notificaciones/` | Una por carga a cada usuario con permiso, con toast |
| Panel frontend | `frontend/src/context/NotificacionesContext.tsx:104-123` (hidrata 1 vez), `:148-163` (`onImportProgreso` ignora remesas desconocidas) | Campanita + "Importaciones en curso" |
| Wizard | `frontend/src/components/import/ImportWizard.tsx:466-497` (orquesta la carga dividida), `ImportProgress.tsx:42-79`, `ImportSummary.tsx` | Paso "Importando" y "Resultado" |
| Detalle | `frontend/src/pages/ImportDetail.tsx:211-244` (solo socket), `:606` (tabla de errores solo si `errFilas>0`) | Página "Importación #N" |
| Historial | `ImportHistory` | No escucha el socket |
| Socket cliente | `frontend/src/context/SocketContext.tsx` | No muestra estado de conexión |

Processors: `backend/src/modules/imports/processors/` (singletons registrados en `processor-registry.ts`).

---

## 3. Hallazgos

Severidad del auditor. "Prod" = confirmado con datos reales (solo SELECT); "código" = por lectura.

### 3.1 Por qué el progreso no se completa

| # | Sev. | Hallazgo | Dónde | Evidencia |
|---|---|---|---|---|
| 1 | ALTO | Evento de socket perdido = UI congelada para siempre (panel, wizard y detalle). Sin re-hidratación al reconectar, sin polling, sin `visibilitychange`, sin aviso de desconexión. Con JWT vencido (`JWT_EXPIRES_IN=1d`) el server desconecta y socket.io **no reconecta**. | `NotificacionesContext.tsx:104-123,148-163`, `ImportProgress.tsx:42-70`, `ImportDetail.tsx:211-244`, `SocketContext.tsx`, gateway | código |
| 2 | ALTO | Progreso solo por lote de 1000 filas: cargas de un lote van 0→100 sin intermedios. El throttle "2 s o 5%" de `notificaciones-spec.md:97` nunca se aplica. | `imports.service.ts:2096-2101` | prod: 38/79 cargas de un solo lote (9 duraron ≥20 s); **MULTIARCHIVO 4/4 en 0%** durante 102-314 s (remesas 97, 99, 100, 107); DEUDORES 108: 14.466 filas en 768 s, saltos de ~7% cada ~51 s |
| 3 | ALTO | `afterAll` corre sin progreso y antes de FINALIZADA (barra clavada en 100% "PROCESANDO"); si tira, solo `logger.error` y se notifica "Importación finalizada". | `imports.service.ts:2278-2285`; pesados: `actualizaciones.processor.ts:937,1039`, `pagos.processor.ts:632-637`, `casos-cedente.processor.ts:826,874`, FACTURAS (recálculo monto), MULTICLAVES | código; duración real no medida (no hay logs por fase) |
| 4 | ALTO | Total 0 (solo header / todo filtrado): el wizard nunca llama `onComplete` y muestra "NaN%". Notifica "Se procesaron 0 filas correctamente." como éxito. "Confirmar e importar" no se deshabilita con total 0. | `ImportProgress.tsx:79` (`if (total===0 && ok===0 && err===0) return;`), `:55-57` (`totalFilas ?? 1` con 0) | medido con probe |
| 5 | ALTO | Carga FALLIDA mostrada como "Importación exitosa", con ok/err de la muestra de 50 filas de la vista previa. | `ImportSummary.tsx` (sin estado), `ImportWizard.tsx:466`, `imports.service.ts:2353-2356` | prod: remesas 86/87 del 08/07 fallaron así (ya borradas) |
| 6 | ALTO | Remesas fantasma "en curso" para siempre: `listarEnCurso` incluye PENDIENTE y VALIDANDO, que son vistas previas abandonadas. | `imports.service.ts:1811` | prod: **93** (MULTIRREGISTRO, PENDIENTE desde 28/07, total 0) y **98** (MULTIARCHIVO, VALIDANDO desde 31/07, 912/912 → "100% completado"). Las ven los 4 usuarios (todos ADMIN) |
| 7 | ALTO | La carga dividida (`divisionRemesa`) la encadena el **navegador**: si se cierra la pestaña, las remesas que faltan quedan PENDIENTE sin creador (y se vuelven fantasmas). La wiki dice que se puede cerrar la pantalla. | `ImportWizard.tsx:466-497`; `docs/ayuda/03-importacion/05-importar-un-archivo.md:152` | código (hoy ninguna colgada; 124-126 y 135-137 terminaron bien) |

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

---

## 4. Plan de implementación

Orden recomendado: **A → B → C → D**. A arregla la base (sin A, todo lo demás sigue siendo frágil).
Marcas: **[BUG]** arregla un hallazgo; **[MEJORA]** es funcionalidad nueva. Antes de arrancar A,
pasar este documento por el agente `architect` para cerrar las decisiones de §5 y el contrato exacto
del estado persistido y de los eventos.

### Fase A — Fuente de verdad y recuperación (~2 días)

**Backend**
- [ ] **[BUG #8 #9]** Estado persistido por carga. Opción preferida: reutilizar `jobimport` (ya existe, 0 filas) o crear `import_progreso` (decidir en §5). Campos: `remesaId`, `fase`, `procesadas`, `ok`, `err`, `descartadas`, `totalEsperado` (**separado** de `totalFilas`), `nuevos`, `actualizados`, `heartbeatAt`, `startedAt`, `finishedAt`, `error`, `advertencias` (count), `progreso` (0-100). Se escribe en el mismo update que ya se hace por lote. `prisma db push`, nunca `migrate dev`.
- [ ] **[BUG #9]** Dejar de pisar `remesa.totalFilas` con el acumulado (`imports.service.ts:2091-2094`).
- [ ] **[BUG #10]** MULTIRREGISTRO: guardar `totalFilas` y VALIDANDO en la vista previa (`:981-1023`); en `:2002` usar `||` o el total esperado explícito.
- [ ] **[BUG #6]** "En curso" = solo encoladas y PROCESANDO. La vista previa pasa a un estado BORRADOR (o equivalente) que `listarEnCurso` no lista. Reaper de borradores viejos (p. ej. >24 h). Limpiar 93 y 98 en prod (preview + confirmación del usuario).
- [ ] **[BUG #5]** Al marcar FALLIDA, guardar el motivo y **resetear/dejar en null** ok/err de la vista previa (`:2353-2356`); el evento `import:finalizada` lleva estado + motivo.
- [ ] **[BUG #3]** `afterAll` con try/catch que **persiste** el error (`advertencias`/`error` del estado) y termina como "finalizada con advertencias", no "finalizada" a secas. Notificación distinta.
- [ ] **[BUG #4]** Total 0: el backend termina normal pero la notificación lo dice ("El archivo no tenía filas para procesar"), no "0 filas correctamente". Validar en la vista previa y deshabilitar el confirmar.
- [ ] **[BUG #12]** Wipe: borrar también `notificacion` con `entidad='REMESA'` de las remesas borradas (actualizar el procedimiento en memoria `wipe-cartera-por-empresa` y `wipe-deudores-prod`). Limpiar los 50 huérfanos en prod (preview primero).
- [ ] Endpoint de estado único: `GET /import/remesas/:id/progreso` (o ampliar `status()`) que devuelve el estado persistido; `listarEnCurso` lo usa en vez de `jobimport?.progreso ?? 0`; `duracionMs` sale de `startedAt/finishedAt`.

**Frontend**
- [ ] **[BUG #1]** Re-hidratar en cada `connect`/reconexión del socket y en `visibilitychange` (`NotificacionesContext`, `ImportProgress`, `ImportDetail`).
- [ ] **[BUG #1]** Polling de respaldo cada 10-15 s mientras haya cargas activas y el socket esté caído o sin eventos >30 s.
- [ ] **[BUG #1]** `onImportProgreso`: upsert de remesas desconocidas en vez de ignorarlas (`:148-163`).
- [ ] **[BUG #1]** `ImportProgress` consulta hasta estado terminal (no un único GET).
- [ ] **[BUG #1]** Indicador de "sin conexión / reconectando" en `SocketContext`; ante desconexión por token vencido, renovar o pedir re-login y reconectar.
- [ ] **[BUG #4]** `onComplete` con **cualquier** estado terminal (también 0/0/0); proteger divisiones por cero.
- [ ] **[BUG #5]** Pasar el estado a `ImportSummary`: FALLIDA = pantalla de error con el motivo; "con advertencias" = aviso amarillo.

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
- [ ] **[BUG #14]** Heartbeat (`heartbeatAt` por lote/subfase) + reaper (cron) que marca FALLIDA si no hay heartbeat en N minutos y libera el bloqueo "una importación por usuario". Configurar BullMQ explícito (`attempts`, `lockDuration`, `maxStalledCount`) y decidir qué pasa si un job se re-ejecuta (no reiniciar el progreso en silencio).
- [ ] **[BUG #15]** `reset()` de los processors singleton al **inicio** de cada carga (o processors por carga), además de al final; cubrir el `return` temprano de `actualizaciones:897`.
- [ ] Evaluar sacar el parseo síncrono de XLSX/MULTIARCHIVO del event loop (worker thread o streaming) si se confirma el bloqueo >45 s.

**Criterios de aceptación B**
- Una carga de 900 filas muestra avance intermedio; MULTIARCHIVO deja de estar en 0% durante minutos.
- ACTUALIZACIONES muestra "Post-proceso: consolidando N/M" en vez de 100% clavado.
- Matar el worker en medio (o simular deploy) → en ≤N min la carga pasa a FALLIDA con motivo y el usuario puede volver a importar.
- Tests unitarios de la secuencia de eventos por categoría (hoy no existen): iniciada → ≥1 progreso intermedio → final; total 0; FALLIDA; error en `afterAll`.

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
- [ ] **[BUG #11]** Mostrar advertencias aunque `errFilas=0`; avisar si se truncó a 500.
- [ ] **[BUG #17]** "Ver remesas" a una ruta que exista (historial filtrado), y "Ver errores" autenticado.
- [ ] **[BUG #18]** `ImportHistory` escucha el socket (o re-consulta) para actualizar estados.
- [ ] **[MEJORA]** Mobile: panel como bottom-sheet / diálogo full-screen en `xs`, contadores en grilla de 2 columnas, ETA abreviada. Probar dark/light.

**Criterios de aceptación C**
- Cerrar la pestaña en medio de una carga dividida → las remesas restantes corren igual.
- Desde la campanita se puede ver el detalle, descargar errores y reintentar sin 401 ni pantallas en blanco.
- Revertir ACCIONES grande no da 504 y muestra progreso; un segundo clic no re-ejecuta.

### Fase D — Notificaciones y documentación (~1 día)

- [ ] **[BUG #13]** Cron de limpieza de notificaciones (N12 del spec de notificaciones). Preferencia de usuario para no recibir cargas ajenas; agrupar.
- [ ] **[BUG #18]** Una sola emisión por usuario (sin doble entrega `user:` + `admin:`); el último tick no dice 100 con PROCESANDO; FINALIZADA con ok=0 no se notifica como "fallida" sino con su motivo.
- [ ] **[MEJORA]** Notificación "terminó con advertencias".
- [ ] **[BUG]** Wiki: corregir `docs/ayuda/03-importacion/05-importar-un-archivo.md:152` y `08-historial-y-problemas.md:237`; documentar fases, cancelar/reintentar y el nuevo panel. Toda página de ayuda pasa por agente revisor antes de cerrarse (memoria `auditar-documentacion-con-agentes`).
- [ ] Actualizar [notificaciones-spec.md](notificaciones-spec.md) y CHANGELOG.

---

## 5. Decisiones abiertas (cerrar con el usuario / `architect` antes de la Fase A)

1. ¿Reusar `jobimport` o crear `import_progreso`? (`jobimport` existe sin uso; reusarlo evita tabla nueva pero su forma actual — `progreso`, `log`, `estado` — se queda corta.)
2. Nombre y semántica del estado de la vista previa (BORRADOR) y TTL del reaper de borradores.
3. Minutos sin heartbeat para declarar FALLIDA (depende de cuánto tarda el `afterAll` más largo: medirlo primero).
4. ¿Cancelar una carga deja lo ya procesado o intenta revertir? (Recomendación: deja lo procesado y lo informa.)
5. ¿Las cargas de otros usuarios siguen notificando a todos los admins, o pasa a preferencia?
6. Carga dividida: job padre propio o BullMQ FlowProducer.

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
