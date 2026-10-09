# Sistema de Notificaciones General + Monitoreo Live de Importaciones

> Spec arquitectónico y plan de implementación.
> Fecha de inicio: 2026-05-11.

## 1. Objetivo

Sistema de notificaciones **general y extensible** con UI tipo campanita en el AppShell. Primer caso de uso: monitorear importaciones en tiempo real con persistencia ante cambio de pantalla, F5 y re-login.

## 2. Decisiones de producto (acordadas con el usuario)

| Tema | Decisión |
|---|---|
| Alcance | Sistema general (no solo importaciones); extensible a reportes, convenios, etc. |
| Concurrencia | Varios usuarios pueden ejecutar importaciones en paralelo. Un mismo usuario NO puede tener 2 importaciones activas. |
| Visibilidad | Por permiso (`importacion.ver_progreso_otros`). Quien lo tenga ve importaciones de todos en su campanita. |
| Persistencia | F5 / logout / login → estado se hidrata desde la DB. |
| Historial en campanita | Solo "en curso". El historial completo sigue en `ImportHistory`. |
| UX al finalizar | Toast (snackbar) + badge rojo en la campanita. |
| Marcar leída | Cada usuario tiene su propia fila → marcar leída es siempre local. |

## 3. Arquitectura

### 3.1 Modelo de datos

Una tabla `notificacion` solo para **eventos discretos** (INICIADA / FINALIZADA / ERROR). El **progreso live NO se persiste** en notificaciones — se lee de `import_progreso` (una fila por remesa, creada junto con ella; `jobimport` ya no se usa para esto: nunca se escribe). El socket "empuja" lo que ya está escrito en esa tabla, no es la fuente del dato. Ver `docs/imports-progreso-realtime-spec.md` §8.

```prisma
enum TipoNotificacion {
  IMPORTACION_INICIADA
  IMPORTACION_FINALIZADA
  IMPORTACION_ERROR
  REPORTE_LISTO
  REPORTE_ERROR
  CONVENIO_VENCIDO
  SISTEMA
}

enum EntidadTipo {
  REMESA
  REPORTE_EJECUCION
  CONVENIO
  GENERICO
}

model Notificacion {
  id            Int               @id @default(autoincrement())
  usuarioId     Int
  tipo          TipoNotificacion
  entidadTipo   EntidadTipo?
  entidadId     Int?
  titulo        String            @db.VarChar(200)
  mensaje       String            @db.VarChar(1000)
  payload       Json?
  leida         Boolean           @default(false)
  leidaEn       DateTime?
  rutaAccion    String?           @db.VarChar(500)
  creadoEn      DateTime          @default(now())
  actualizadoEn DateTime          @updatedAt
  usuario       Usuario           @relation(fields: [usuarioId], references: [id], onDelete: Cascade)

  @@index([usuarioId, leida, creadoEn(sort: Desc)])
  @@index([entidadTipo, entidadId])
  @@index([creadoEn])
  @@map("notificacion")
}
```

Adicionalmente: verificar/agregar `remesa.usuarioCreadorId` (nullable, con FK e índice) si no existe — necesario para la validación "una importación por usuario".

### 3.2 Transporte realtime (Socket.IO)

Replica del patrón AMSA Sender. Nuevo módulo `RealtimeModule`:

```
backend/src/modules/realtime/
├── realtime.module.ts
├── realtime.gateway.ts        (namespace /rt, auth JWT en handshake)
├── realtime.service.ts        (emitToUser, emitToAdmins, emitToRoom)
└── guards/ws-jwt.guard.ts
```

**Rooms al conectar:**
- `user:${usuarioId}` (siempre)
- `admin:importaciones` (si tiene `importacion.ver_progreso_otros`)

**Eventos emitidos:**

| Evento | Destinatario | Payload |
|---|---|---|
| `notificacion:nueva` | `user:${id}` | `{ id, tipo, titulo, mensaje, payload, rutaAccion, creadoEn }` |
| `notificacion:contador` | `user:${id}` | `{ noLeidas: number }` |
| `import:iniciada` | `user:${ownerId}` ∪ `admin:importaciones` | `EstadoCargaDto` completo |
| `import:progreso` | `user:${ownerId}` ∪ `admin:importaciones` | `EstadoCargaDto` completo |
| `import:finalizada` | `user:${ownerId}` ∪ `admin:importaciones` | `EstadoCargaDto` completo |

Los tres eventos de importación llevan una **foto completa** del estado de la carga (`EstadoCargaDto`, ver `backend/src/modules/imports/progreso/estado-carga.types.ts` y `docs/imports-progreso-realtime-spec.md` §8.4), nunca un delta: con cualquiera alcanza para dibujar la carga. Se emiten en **una sola llamada** a la unión de las dos salas (`server.to([...]).emit(...)`), así que un admin que además es el dueño de la carga no recibe todo duplicado. `rev` es estrictamente creciente por remesa y el estado se persiste **antes** de emitirse.

**Throttle de progreso:** vive dentro del `ProgresoTracker` (Fase B). Los processors y el runner solo anotan su avance en memoria; un reloj propio lo vuelca a la base **a lo sumo una vez por `IMPORTS_PROGRESO_INTERVALO_MS`** (default 1 s, sin la regla del 5 %) y recién después lo emite: lo emitido es siempre la foto que se persistió. Un evento por lote persistido sigue saliendo siempre. **El latido no emite nada:** cuando no hay nada que contar, el reloj escribe solo `heartbeatAt` cada 15 s. `ProgressEmitter` ya no lo usa el import (sí consolidación).

`import:finalizada` puede salir ahora **sin que haya un worker**: la emite `ImportService.cerrarCargaInterrumpida` cuando el reaper (o la guarda de re-entrega) cierra una carga interrumpida, con `resultado: 'FALLIDA'` y el motivo en `error`. Mismas salas, mismo payload.

### 3.3 Endpoints REST

| Método | Ruta | Auth | Notas |
|---|---|---|---|
| GET | `/notificaciones?soloNoLeidas&limit&offset` | JWT | Lista paginada del usuario |
| GET | `/notificaciones/contador` | JWT | `{ noLeidas: number }` |
| POST | `/notificaciones/:id/leer` | JWT + ownership | |
| POST | `/notificaciones/leer-todas` | JWT | |
| GET | `/import/en-curso` | JWT | `EstadoCargaDto[]` de las cargas encoladas y sin terminar (`import_progreso.encoladaAt != null && finishedAt == null`). Filtra por usuario o todas según permiso. Una remesa heredada, sin fila de progreso, nunca figura |
| GET | `/import/remesas/:id/progreso` | JWT | `EstadoCargaDto` de una carga. Es el que consultan los hooks al hacer polling de respaldo |

Validación "una por usuario" en `POST /import/ejecutar/:id`: HTTP 409 con el mensaje "Ya tenés una importación en curso. Esperá a que termine antes de iniciar otra." (sin código de error propio; el mutex es un `SELECT … FOR UPDATE` sobre la fila del usuario dentro de una transacción).

### 3.4 Permiso nuevo

Agregar al catálogo (`backend/src/auth/permisos-catalogo.ts` y `frontend/src/utils/permisosCatalogo.ts`, idénticos):

- `importacion.ver_progreso_otros` — "Ver importaciones de otros usuarios"

### 3.5 Frontend

```
frontend/src/
├── context/
│   ├── SocketContext.tsx           [nuevo]
│   └── NotificacionesContext.tsx   [nuevo]
├── hooks/
│   ├── useSocket.ts                [nuevo]
│   ├── useNotificaciones.ts        [nuevo]
│   └── useImportacionesEnCurso.ts  [nuevo]
├── api/notificaciones.ts           [nuevo]
└── components/layout/AppShell/
    ├── NotificacionesBell.tsx      [nuevo]
    ├── NotificacionesPopover.tsx   [nuevo]
    ├── ImportEnCursoItem.tsx       [nuevo]
    └── NotificacionItem.tsx        [nuevo]
```

Provider order en `AppProviders.tsx`: `Auth → Socket → Notificaciones → resto`.

Comportamiento:
- Al montar: hidratar via REST (`/notificaciones`, `/notificaciones/contador`, `/imports/en-curso`).
- Suscribirse a eventos socket.
- Toasts (`useNotify`) solo para eventos en vivo, NO en hidratación inicial.
- Refactor `ImportProgress.tsx`: eliminar `setInterval`, leer del hook global.

### 3.6 Riesgos y decisiones operativas

- **Socket caído**: ahora **hay polling de respaldo** (Fase A del progreso en tiempo real). El socket avisa, pero la fuente del dato es HTTP: el cliente re-hidrata al conectar, al volver a la pestaña y por polling mientras hay cargas en curso (`GET /import/en-curso`, `GET /import/remesas/:id/progreso`). Un evento perdido ya no deja la pantalla congelada.
- **Cleanup**: cron diario que borra leídas > 30 días y no leídas > 180 días (fase 2).
- **Multi-tab**: out-of-the-box gracias a Socket.IO.
- **JWT vencido y socket**: el gateway valida el JWT **solo en el handshake**; una conexión viva sobrevive al vencimiento. Si se corta la red o se reinicia el backend, el cliente reconecta con el token vencido: el server acepta la conexión, la rechaza en `handleConnection` y desconecta con motivo `io server disconnect`, ante el cual socket.io-client **no reintenta**. Por eso el polling HTTP de respaldo es obligatorio: su 401 manda a `/login` como cualquier otro pedido.
- **Race condition crear remesa**: transacción con `SELECT FOR UPDATE` sobre la fila del usuario.

## 4. Plan de implementación

| # | Paso | Estado |
|---|---|---|
| 1 | Schema Prisma + migración (`Notificacion`, enums, `remesa.usuarioCreadorId`) | completed |
| 2 | Permiso `importacion.ver_progreso_otros` en ambos catálogos | completed |
| 3 | `RealtimeModule` (gateway + service + WsJwtGuard) | completed |
| 4 | `NotificacionesModule` (service + controller + DTOs + endpoints) | completed |
| 5 | Endpoint `/imports/en-curso` + validación "una por usuario" | completed |
| 6 | `ProgressEmitter` util + integración en los 7 processors | completed |
| 7 | `SocketContext` frontend (cliente + reconexión + JWT) | completed |
| 8 | `NotificacionesContext` + hooks + API client | completed |
| 9 | `NotificacionesBell` + `Popover` en AppShell | completed |
| 10 | Refactor `ImportProgress.tsx` (sacar polling) | completed |
| 11 | QA E2E multi-usuario, F5, permisos | completed |
| 12 | (Fase 2) Cron de cleanup | pending |

## 5. Changelog

Cada cambio se documenta acá con fecha + paso + resumen + archivos clave.

### 2026-05-11

- Spec definido con el architect (este documento).
- Plan de 12 pasos acordado con el usuario.
- Decisiones de producto confirmadas (sección 2).
- Arranca implementación: pasos 1-6 (backend) en una sola tanda.

#### Pasos 1-6 completados (implementación backend)

**Paso 1 — Schema Prisma + migración**
- Agregado `remesa.usuarioCreadorId` (nullable, FK a `usuario`, `onDelete: SetNull`, índice).
- Relación inversa `usuario.remesasCreadas` agregada.
- Nuevos enums: `TipoNotificacion`, `EntidadTipo`.
- Nuevo modelo `Notificacion` con `@@map("notificacion")` y los 3 índices del spec.
- Migración aplicada: `20260511162924_add_notificaciones_y_usuario_creador_remesa`.
- **Comando pendiente para el usuario** (requiere detener el servidor NestJS): `npx prisma generate`

**Paso 2 — Permiso `importacion.ver_progreso_otros`**
- Agregado en `backend/src/auth/permisos-catalogo.ts` sección "Importación".
- Replicado idéntico en `frontend/src/utils/permisosCatalogo.ts`.
- `TODAS_LAS_KEYS` deriva automáticamente — sin cambio adicional.
- Agregado al array hardcodeado de `backend/prisma/seed.ts` para que ADMIN lo reciba.
- OPERADOR no lo incluye (decisión de diseño).

**Paso 3 — RealtimeModule**
- `backend/src/modules/realtime/realtime.gateway.ts`: namespace `/rt`, auth JWT en `handleConnection`, rooms `user:${id}` + `admin:importaciones`.
- `backend/src/modules/realtime/realtime.service.ts`: `emitToUser`, `emitToRoom`, `emitToAdmins`, `emitImportIniciada`, `emitImportProgreso`, `emitImportFinalizada`.
- `backend/src/modules/realtime/guards/ws-jwt.guard.ts`: guard opcional para mensajes entrantes.
- `backend/src/modules/realtime/realtime.module.ts`: exporta `RealtimeService`, usa `forwardRef` con `NotificacionesModule`.
- Registrado en `app.module.ts`.

**Paso 4 — NotificacionesModule**
- `backend/src/modules/notificaciones/interfaces/crear-notificacion-params.interface.ts`
- `backend/src/modules/notificaciones/dto/crear-notificacion.dto.ts`
- `backend/src/modules/notificaciones/dto/listar-notificaciones.dto.ts`
- `backend/src/modules/notificaciones/notificaciones.service.ts`: `crear`, `listar`, `contador`, `marcarLeida`, `marcarTodas`, `eliminar`.
- `backend/src/modules/notificaciones/notificaciones.controller.ts`: 4 endpoints REST.
- `backend/src/modules/notificaciones/notificaciones.module.ts`: usa `forwardRef` con `RealtimeModule`.
- Registrado en `app.module.ts`.
- **Nota**: Decorator `@UsuarioActual()` agregado a `backend/src/auth/decorators.ts`.

**Paso 5 — Endpoint `/import/en-curso` + validación 1-por-usuario**
- `GET /import/en-curso` con permiso `importacion.ver_historial` y filtro por permiso `importacion.ver_progreso_otros`.
- `executeRemesa` actualizado: recibe `usuarioId`, valida con `SELECT FOR UPDATE` en transacción MySQL, setea `usuarioCreadorId` al ejecutar.
- `createRemesa` acepta `usuarioCreadorId` opcional.

**Paso 6 — ProgressEmitter + integración en service de importación**
- `backend/src/modules/imports/utils/progress-emitter.ts`: throttle 2s / 5% con primer y último forzado.
- Integración en `ImportService.processImportJob`: emit `import:iniciada` al inicio, `import:progreso` por batch (throttled), `import:finalizada` + notificación persistente al terminar.
- NO se crea notificación de `IMPORTACION_INICIADA` (decisión H.6).
- La notificación al finalizar incluye `incluirUsuariosConPermiso: 'importacion.ver_progreso_otros'`.
- `ImportModule` actualizado para importar `RealtimeModule` y `NotificacionesModule`.

**Comandos pendientes para el usuario:**
```powershell
# 1. Detener el servidor NestJS backend, luego:
cd backend
npx prisma generate

# 2. Volver a arrancar el servidor
```

### 2026-05-11 — Pasos 7-10 completados (implementación frontend)

**Archivos creados:**
- `frontend/src/context/SocketContext.tsx` — Provider Socket.IO namespace `/rt`, JWT en handshake, connect/disconnect ligado al token. Expone `useSocket()`.
- `frontend/src/api/notificaciones.ts` — Funciones tipadas: `listarNotificaciones`, `obtenerContador`, `marcarLeida`, `marcarTodas`, `obtenerImportsEnCurso`.
- `frontend/src/context/NotificacionesContext.tsx` — Hidratación paralela REST al montar; suscripción a 5 eventos socket; flag `hidratadoRef` para no mostrar toasts durante la hidratación inicial. Expone `useNotificaciones()`.
- `frontend/src/hooks/useNotificaciones.ts` — Re-export del hook del context.
- `frontend/src/hooks/useImportacionesEnCurso.ts` — Hook derivado que devuelve solo `importsEnCurso`.
- `frontend/src/utils/fechaRelativa.ts` — Función de fecha relativa en español sin dependencias externas.
- `frontend/src/components/layout/AppShell/NotificacionesBell.tsx` — IconButton + Badge (error color) + abre popover.
- `frontend/src/components/layout/AppShell/NotificacionesPopover.tsx` — Popover 360px con dos secciones: "Importaciones en curso" e "Historial". Empty state si no hay contenido. Botón "Marcar todas".
- `frontend/src/components/layout/AppShell/ImportEnCursoItem.tsx` — Ítem con LinearProgress, chips OK/Err/Total, link a `/historial-importaciones/:id`.
- `frontend/src/components/layout/AppShell/NotificacionItem.tsx` — Ítem con ícono por tipo, estado leída/no leída visual (bold + dot + bgcolor), click marca leída + navega a `rutaAccion`.

**Archivos modificados:**
- `frontend/src/context/AppProviders.tsx` — Agregados `SocketProvider` y `NotificacionesProvider` con orden `Auth → Socket → Notificaciones → resto`.
- `frontend/src/components/layout/AppShell/AppBar.tsx` — Importado e insertado `<NotificacionesBell />` al lado del `<UserMenu />`.
- `frontend/src/components/import/ImportProgress.tsx` — Eliminado `setInterval`. Consume `useImportacionesEnCurso()`. Si la remesa no está en contexto (ya terminó), hace un fetch REST puntual para obtener estado final y llamar `onComplete`.

**Decisiones técnicas:**
- `socket` en `SocketContext` se expone desde `socketRef.current` pero el `value` se memoiza por `conectado` — esto garantiza que el socket siempre es la instancia más reciente sin re-renderizar en cada evento.
- No se usa `dayjs` ni `date-fns` (no instalados); se implementó `fechaRelativa.ts` nativo.
- `ImportProgress` detecta finalización de la remesa mediante `useEffect` sobre `estado`; usa un ref `completadoRef.disparado` para evitar llamar `onComplete` más de una vez.
- Ruta de detalle de importación: `/historial-importaciones/:id` (según `AppRoutes.tsx`).

---

### 2026-05-11 — Fix robustez imports + defaults de estado en plantilla

**Motivación:** el service hacía lookup hardcodeado de parámetros (`grupo='estadoSituacion'/'estadoGestion'`, `clave='ACTIVO'/'PENDIENTE'`) que no concuerda con cómo los usuarios cargan los códigos (`grupo='situacion'/'gestion'`). Se movieron los defaults a la plantilla y se hizo robusto el procesador.

**Archivos modificados:**

- `backend/prisma/schema.prisma`
  - Agregados `defaultEstadoSituacionId Int?` y `defaultEstadoGestionId Int?` en `model plantillaimport` con FK a `parametro` (`onDelete: SetNull`) y relaciones nombradas `PlantillaDefaultSituacion` / `PlantillaDefaultGestion`.
  - Relaciones inversas en `model parametro`: `plantillasConSituacion` y `plantillasConGestion`.
  - Migración: `plantilla_defaults_estados`.

- `backend/src/modules/imports/dtos/import.dto.ts`
  - `CreatePlantillaDto`: agregados `defaultEstadoSituacionId?: number | null` y `defaultEstadoGestionId?: number | null`.

- `backend/src/modules/imports/imports.service.ts`
  - `createPlantilla`: persiste los dos nuevos campos.
  - `updatePlantilla`: actualiza los dos campos si están presentes en el payload.
  - `processImportJob`: reemplazado lookup hardcodeado por lectura directa de `remesa.plantilla.defaultEstadoSituacionId/Id`. Si alguno falta, lanza `BadRequestException` descriptivo.
  - `processImportJob`: envuelto el cuerpo en try/catch. En el catch: marca remesa `FALLIDA`, emite socket `import:finalizada`, crea notificación `IMPORTACION_ERROR`, re-lanza el error.
  - `deleteRemesa(remesaId, user)`: nuevo método — valida estado (no VALIDANDO/PROCESANDO), valida ownership, borra `jobimport` + `importerror` + `remesa` en orden.

- `backend/src/modules/imports/imports.controller.ts`
  - `DELETE /import/remesas/:id` con permiso `importacion.eliminar`.

- `backend/src/auth/permisos-catalogo.ts`
  - Agregado `importacion.eliminar` en sección "Importación".

- `backend/prisma/seed.ts`
  - Agregado `importacion.eliminar` en `TODAS_LAS_KEYS` (ADMIN lo recibe automáticamente).

- `frontend/src/utils/permisosCatalogo.ts`
  - Replicado `importacion.eliminar`.

- `frontend/src/pages/PlantillaEditor.tsx`
  - Dos selects nuevos: "Estado situación inicial" y "Estado gestión inicial".
  - Carga parámetros via `GET /parametros?empresaId=X&grupo=situacion` y `grupo=gestion`.
  - Aviso cuando no hay parámetros cargados para la empresa.
  - Validación en `handleSave` antes de guardar.
  - En modo edición, carga valores desde la respuesta de `GET /import/plantilla/:id`.
  - Al cambiar empresa, resetea selects y recarga opciones.

- `frontend/src/pages/ImportHistory.tsx`
  - Botón "Eliminar" (icono rojo) en columna acciones.
  - Visible solo si `tienePermiso('importacion.eliminar')`.
  - Habilitado solo para estados `PENDIENTE`, `FALLIDA`, `FINALIZADA`. Tooltip explicativo cuando está en curso.
  - Dialog de confirmación nativo (MUI `Dialog`) antes de ejecutar el DELETE.
  - Actualiza lista local tras eliminar (no re-fetch).

**Decisiones tomadas:**
- Sin fallback de lookup: si la plantilla no tiene defaults configurados, el procesador falla con error descriptivo. No hay lookup silencioso.
- `deudor` no se eliminan en cascade al borrar una remesa (son datos de negocio); solo se borran `jobimport` e `importerror`.
- El permiso `importacion.eliminar` NO se agregó a OPERADOR (debe asignarse manualmente si corresponde).
- Los useEffect de carga de parámetros en PlantillaEditor están divididos: uno para modo creación (reacciona a cambio de empresa), uno para modo edición (reacciona a que empresaId se pueble luego de loadPlantilla).

---

### 2026-05-11 — Fixes UX/QA tras E2E de Fase 4

> Commits de referencia: `a3d1e6c` (Fase 4 main) y `2607c61` (VALIDANDO eliminable).
>
> Bugs y mejoras descubiertas durante el QA E2E del paso 11, todas resueltas antes de cerrar la fase.

**1. Fix navegación "Nueva plantilla" — `frontend/src/pages/PlantillasList.tsx`**
- Síntoma: al crear plantilla, `PlantillaEditor` mostraba "No se pudo determinar la empresa".
- Causa: `PlantillaEditor` lee `sessionStorage.plantillas_empresaId`, pero `PlantillasList` nunca lo escribía antes de navegar.
- Fix: agregado `sessionStorage.setItem('plantillas_empresaId', String(empresaId))` antes del `navigate('/plantillas/nueva')` en los dos puntos de entrada (botón principal + acción del empty state).

**2. Fix cálculo de progreso siempre en 100% — `backend/src/modules/imports/imports.service.ts`**
- Síntoma: la barra de progreso de "Importaciones en curso" mostraba siempre 100% apenas iniciaba.
- Causa: el cálculo usaba `(ok + err) / total`, pero `total` era un contador acumulado que crece con cada batch — quedaba siempre igual a `ok + err`.
- Fix: usar `remesa.totalFilas` como denominador fijo:
  ```ts
  progreso = totalEsperado > 0 ? Math.min(100, Math.floor((ok + err) / totalEsperado * 100)) : 0;
  ```
- Mismo arreglo en el payload del emit `import:progreso`.

**3. Fix `rutaAccion` rota — `backend/src/modules/imports/imports.service.ts`**
- Síntoma: clicar la notificación "Importación finalizada" llevaba a `/importacion/historial/:id` → página en blanco.
- Causa: ruta hardcoded incorrecta en `rutaAccion` al crear la notificación.
- Fix: cambiada a `/historial-importaciones/${remesaId}` (la real según `AppRoutes.tsx`). Aplicado tanto en finalización exitosa como en error.

**4. Rediseño de `ImportDetail.tsx` + monitoreo live**
- Pedido: la página antigua solo mostraba 4 datos sueltos (categoría, total, ok, err). Se rediseñó completa con look moderno y métricas visuales.
- Cambios:
  - Hero card con número de remesa + categoría + estado (`StatusChip`).
  - 4 stat cards: Total / OK / Errores / Tasa de éxito.
  - Donut chart (Recharts v3.8.1) con OK vs Err y **label centrado en SVG** (porcentaje grande + total).
  - Info card con 8 campos: empresa, plantilla, política, usuario creador, archivo, duración, fecha inicio, fecha fin.
  - `backend.imports.service.status()` enriquecido con includes (`empresa`, `plantilla`, `usuariocreador`, `politica`, `jobimport`) y campos derivados `duracionMs`, `tasaExitoPct`.
- **Auto-refresh por socket**: suscripción a `import:progreso` e `import:finalizada` filtradas por `remesaId`. Al recibir evento, actualiza el state local sin re-fetch.
  ```ts
  useEffect(() => {
      if (!socket || !id) return;
      const onProgreso = (p) => { if (p.remesaId === Number(id)) setRemesa(prev => ({...prev, ...p})); };
      socket.on('import:progreso', onProgreso);
      socket.on('import:finalizada', onFinalizada);
      return () => { socket.off(...); };
  }, [socket, id, fetchAll]);
  ```

**5. Fix loop infinito de requests GET — `frontend/src/pages/ImportDetail.tsx`**
- Síntoma: backend log mostraba `GET /api/import/remesas/4` disparándose sin parar.
- Causa: `useNotify()` devuelve un objeto nuevo en cada render → `fetchAll` (envuelto en `useCallback` con `notify` como dep) se recreaba → el `useEffect` que llamaba `fetchAll` se re-disparaba en bucle.
- Fix: patrón `notifyRef` — guardar `notify` en un `useRef` actualizado por su propio `useEffect`, y usar `notifyRef.current.error(...)` dentro de `fetchAll`. La dep `notify` se elimina del `useCallback`.

**6. Reglas más estrictas para eliminar remesa**
- Pedido del usuario: "Las importaciones finalizadas correctamente no deben poder eliminarse… solo las que finalizaron totalmente con errores".
- Backend (`imports.service.ts` → `deleteRemesa`):
  ```ts
  const totalmenteFallida =
      remesa.estadoProceso === 'FALLIDA' ||
      (remesa.estadoProceso === 'FINALIZADA' && (remesa.okFilas ?? 0) === 0);
  const eliminable =
      remesa.estadoProceso === 'PENDIENTE' ||
      remesa.estadoProceso === 'VALIDANDO' ||
      totalmenteFallida;
  ```
- Frontend (`ImportHistory.tsx`): nuevo helper `esEliminable(row)` con la misma lógica; tooltip dinámico explica la razón cuando el botón está deshabilitado.

**7. Permitir eliminar remesas en `VALIDANDO` (commit `2607c61`)**
- Caso real: el usuario inicia carga, cambia de pantalla y la remesa queda atascada en `VALIDANDO` para siempre (no hay UI para retomarla).
- Decisión: por ahora solo permitir eliminar (retake queda para una futura iteración).
- Cambio: agregado `VALIDANDO` al set de estados eliminables tanto en backend como en frontend. Solo `PROCESANDO` bloquea ahora.

**Bugs/dudas descubiertos pero NO resueltos en este ciclo:**
- Cascade al eliminar remesa: `deudor` NO se borra (decisión: son datos de negocio). Pendiente validar con usuario si es lo correcto a largo plazo.
- Retake de remesa en `VALIDANDO`: feature diferida.
- Permisos cacheados en `localStorage.amsa_usuario`: el botón "Eliminar" no aparecía hasta logout/login completo tras correr el seed. Documentar para futuras incorporaciones de permisos.

**Cierre de Fase 4:**
Con estos fixes, el paso 11 del plan (QA E2E multi-usuario, F5, permisos) queda marcado como `completed`. Sólo resta el paso 12 (cron de cleanup, Fase 2).

### 2026-10-05 — Progreso en tiempo real de las importaciones, Fase A (backend)

Diseño y diagnóstico: `docs/imports-progreso-realtime-spec.md` (§8). Lo que cambia en este documento:

- **Fuente de verdad.** Tabla nueva `import_progreso` (PK = FK a `remesa`, `onDelete: Cascade`), una fila por carga, que escribe solo `ProgresoTracker` durante el job y `ImportService` en el alta, la vista previa y el encolado. `jobimport` no se toca (queda sin uso para el progreso).
- **Eventos de socket.** `import:iniciada`, `import:progreso` e `import:finalizada` llevan un `EstadoCargaDto` completo (con `rev`, `fase`, `enCurso`, `terminal`, `resultado`, contadores y los alias `okFilas`/`errFilas`/`totalFilas`/`durationMs` para pestañas viejas), en una sola emisión a la unión de `user:{id}` y `admin:importaciones`. Se sacaron las tres interfaces de payload viejas de `RealtimeService`.
- **Cómo terminó.** `resultado` ∈ OK / CON_ERRORES / CON_ADVERTENCIAS / SIN_FILAS / FALLIDA. `CON_ADVERTENCIAS` significa una sola cosa: las filas se cargaron y el post-proceso (`afterAll`) no terminó.
- **Notificaciones.** El texto y el tipo salen de `textoNotificacion(estado)`; el resultado viaja en `payload.resultado` (no se tocó el enum `TipoNotificacion`). Una importación con todas las filas en error ya no se notifica como "fallida" sino como "sin filas cargadas"; el mensaje nunca supera los 1000 caracteres de la columna (antes un error largo de Prisma impedía crear la notificación).
- **"En curso"** pasa a ser `encoladaAt != null && finishedAt == null`: las vistas previas abandonadas (PENDIENTE / VALIDANDO sin confirmar) dejan de figurar en la campanita. Al borrar una remesa se borran sus notificaciones (`entidadTipo = 'REMESA'`) y se re-emite el contador de no leídas de los afectados. Una carga que ya arrancó y no terminó no se puede borrar (400; si el worker la toma entre la lectura y la transacción de borrado, la transacción relee con `FOR UPDATE` y aborta; y si es el borrado el que gana, el worker lo detecta con una relectura después de `iniciar()` y corta sin procesar filas, ni emitir nada más); una encolada que no arrancó sí se puede abortar: se saca su job de la cola (por `import_progreso.jobId`, o buscándolo por `data.remesaId`) o, si el job no existe, se borra directamente; con el job activo, o si la cola no responde dentro del tope de tiempo (`IMPORTS_QUEUE_TIMEOUT_MS`), 400. El chequeo de dueño va antes de cualquier efecto sobre la cola.
- **Endpoints.** `GET /import/remesas/:id/progreso` (nuevo); `GET /import/en-curso` y `GET /import/remesas/:id` devuelven el estado nuevo; `POST /import/ejecutar/:id` devuelve `carga` y responde 409 si ya fue confirmada, 400 si la vista previa no encontró filas y 503 si no se pudo encolar; `POST /import/validar/:id` responde 409 sobre una carga confirmada.
- **Un processor por carga.** `getProcessor` devuelve una instancia nueva en cada llamada.
- **Si el encolado falla**, la remesa vuelve a borrador (`encoladaAt` null, `fase` BORRADOR, el `estadoProceso` que tenía) y responde 503: reintentar "Confirmar e importar" funciona sin volver a subir el archivo. Con Redis caído `queue.add` **no tira: espera** (ioredis reintenta y encola offline, y la conexión compartida con los workers no lleva `commandTimeout` a propósito), así que el 503 normalmente sale por un **tope de tiempo** alrededor del `add` (`IMPORTS_QUEUE_TIMEOUT_MS`, default 10 s, por debajo de los 60 s del ALB); si el `add` entra tarde, el job llega con la remesa en borrador y lo ignora la guarda de `processImportJob`, y no escribe nada. El `job.id` se guarda en `import_progreso.jobId` al encolar.
- **Guardas al tomar el job** (`processImportJob`): un job sobre una carga ya terminada (FINALIZADA/FALLIDA con `finishedAt`) o sobre un borrador (fila de progreso sin `encoladaAt`: un job fantasma) se ignora con `warn`, sin procesar ni emitir, y devuelve `ignorado: true`; el processor de BullMQ no lo audita como OK. Si la lectura inicial de la remesa falla, la carga se marca FALLIDA con el motivo (sin pisar una ya terminal).
- **Conteo de avisos.** `advertencias` suma las advertencias de parseo, los avisos de lectura de MULTICLAVES, el fallo del post-proceso y los avisos que escriben los processors (`[aviso] …` de PAGOS y MULTICLAVES), contados después del post-proceso en `importerror` con `rowNumber = 0` y prefijo `[aviso]` / `[parseo]` / `[post-proceso]` (los errores de fila de cargas con varios archivos también empiezan con `[`, pero con el archivo y la línea). Lo que el runner ya contó no se cuenta doble, y el truncado a 500 sigue diciendo el total real.
- **`servidorAhora`** (campo nuevo de `EstadoCargaDto`): hora del servidor (ISO 8601 UTC) al armar el DTO, en los tres eventos y en todas las respuestas HTTP, también para remesas heredadas. Permite medir la edad de `heartbeatAt` sin depender del reloj del navegador.
- **Textos.** La notificación "con advertencias" dice "Se cargaron N filas y M dieron error, pero el post-proceso no terminó: …" (sin "y M…" si no hubo errores). Los errores de Prisma se guardan y notifican como su última línea más el código; el detalle completo queda solo en el log.

### 2026-10-09 — Progreso en tiempo real de las importaciones, Fase B (backend)

Diseño: `docs/imports-progreso-realtime-spec.md` (§9). Lo que cambia en este documento:

- **Throttle y latido** (ver §3.2): reloj propio del `ProgresoTracker`, un volcado por segundo como máximo y latido cada 15 s sin evento. El volcado va solo a `import_progreso` (sentencia condicionada con chequeo de filas afectadas); las escrituras que tocan `remesa` (`iniciar`, `lote`, `finalizar`, `fallar`) relean la remesa y su fila con `FOR UPDATE`, así que un estado terminal puesto por otro nunca se pisa. `rev` también crece con los latidos, que no se emiten: entre dos eventos puede saltar de a más de uno (sigue siendo estrictamente creciente).
- **Campos nuevos de `EstadoCargaDto`:** `fueraDeCorte` y `descartadasPorFiltro` (`descartadas` sigue siendo el total), `enColaDelante`, `velocidad`, `etaSegundos`, y `subfase` / `nuevos` / `actualizados` ya poblados. Nueva fase `LEYENDO`. Columna nueva `import_progreso.fueraDeCorte` (nullable).
- **Una carga no se re-ejecuta:** el worker de `import-queue` corre con `maxStalledCount: 0`, `lockDuration: 120000` y la cola con `attempts: 1`. Si el worker muere a mitad de una carga, la cierra el reaper como FALLIDA con motivo; si BullMQ igual re-entrega el job de una carga que ya había arrancado, el worker la cierra como interrumpida sin procesar ninguna fila.
- **Reaper de cargas colgadas** (cron cada minuto): cierra una carga sin latido hace `IMPORTS_LATIDO_UMBRAL_MIN` (default 5) minutos, o en cola sin job, solo si tres comprobaciones independientes lo confirman (registro de cargas vivas del proceso, latido, lock de BullMQ) en dos pasadas con al menos 45 s de diferencia: el cierre llega entre umbral + 1 y umbral + 2 minutos después del último latido. Notifica al dueño y a quienes tienen `importacion.ver_progreso_otros` ("Importación fallida") y audita `IMPORT_FAIL`.
- **Reaper de borradores** (cron 04:30 del reloj del contenedor): borra (04:30 de Argentina: el contenedor fija `TZ`) las vistas previas sin confirmar de más de `IMPORTS_BORRADOR_TTL_HORAS` (24) sin casos y cuyo creador no tiene una carga en curso. `IMPORTS_REAPER_DESACTIVADO` (solo `1`, `true`, `si`, `sí`, `yes`) apaga los dos crons.
- **Notificaciones:** el `payload` de toda notificación de importación suma `fueraDeCorte` y `descartadasPorFiltro`; la de `SIN_FILAS` separa lo que descartó el filtro de la plantilla de lo que es de otros cortes de la división.
- **Carreras:** confirmar y borrar a la vez responde 404 ("La importación fue eliminada mientras se confirmaba.") o 409 ("Esta importación se acaba de confirmar…") según quién llegó primero; un `add` que venció por tiempo pero cuyo job el worker ya tomó responde 201 con el estado real en vez de devolver la carga a borrador.
