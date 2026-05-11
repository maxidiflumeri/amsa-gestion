# AMSA Gestión — Changelog de Desarrollo

> Este archivo es el registro de contexto principal para que una IA pueda retomar el trabajo.
> Stack: NestJS + Prisma + MySQL (backend) · React + MUI v5 + TypeScript (frontend)
> Convención DB: `npx prisma db push` (NO `prisma migrate dev` — hay drift histórico)

---

## [2026-05-11] — Auditoría 100%: `transaccion` como SOR + frontend `/auditoria`

### Decisión

`transaccion` pasa a ser el **System-of-Record** único para toda acción del sistema (escrituras de gestión, importaciones, reportes, AUTH, denegaciones de permiso, eventos de sistema). El log de Pino sigue existiendo para diagnóstico técnico pero no es fuente de verdad.

### Cambios — Backend

**Schema (`prisma/schema.prisma`)**
- `transaccion`: nuevos campos `empresaId` (FK a `empresa`, nullable), `modulo` (`GESTION` | `IMPORT` | `REPORTES` | `ADMIN` | `AUTH` | `SISTEMA`), `severidad` (`INFO` | `WARN` | `ERROR`), `estado` (`OK` | `FALLIDO`), `recursoTexto` (descripción legible del recurso afectado).
- `transaccion.usuarioId` ahora **nullable** (eventos de sistema / workers sin usuario humano).
- Índices nuevos: `(empresaId, createdAt)`, `(modulo, createdAt)`, `(estado, createdAt)`, `(severidad, createdAt)`, `(usuarioId, createdAt)`.
- `npx prisma db push`.

**Decorador + interceptor (`modules/transacciones/audit.*`)**
- `@Audit({ modulo?, entidad, tipo, severidad?, estado?, recursoTexto?, empresaId?, entidadIdParam?, before? })`.
- `AuditInterceptor` ahora: (a) lee `req.usuario.sub` correctamente (bug previo `req.user?.id ?? 1` → falsificaba autoría), (b) ejecuta hook `before(req)` para snapshot antes del cambio, (c) usa `rxjs.catchError` para registrar `estado: 'FALLIDO'` cuando el handler tira excepción, (d) redacta automáticamente `password`/`token`/`secret`/`apiKey` en `data.before/after/params`.
- `AuditoriaHelper` (servicio inyectable) para flujos no-HTTP: workers BullMQ, seeds, cron jobs.

**Endpoints (`/transacciones`)**
- `GET /transacciones` — listado con filtros: `desde/hasta`, `modulo`, `entidad`, `entidadId`, `tipo`, `severidad`, `estado`, `usuarioId`, `empresaId`, `deudorId`, `q` (búsqueda libre), paginación `limit/offset`, `orderDir`.
- `GET /transacciones/stats` — KPIs (hoy/semana/mes/fallidos 24h), serie 30d, top tipos, top usuarios, distribución por módulo.
- `GET /transacciones/:id` — detalle con relaciones (usuario, empresa, deudor).
- `POST /transacciones/export?formato=xlsx|csv|pdf` — reutiliza `XlsxExportador`/`CsvExportador`/`PdfExportador` de `reportes/exportadores/`. Devuelve Buffer + headers `Content-Disposition`. Requiere permiso `auditoria.exportar`.

**Permisos (`auth/permisos-catalogo.ts` + `seed.ts`)**
- Sección "Auditoría" con `auditoria.ver`, `auditoria.ver_todos`, `auditoria.exportar`. Sin `auditoria.ver_todos`, el usuario solo ve sus propias transacciones (filtrado por `usuarioId` en el service).

**Eventos AUTH (`auth/auth.service.ts` + `auth.controller.ts` + `permisos.guard.ts`)**
- `LOGIN_OK` / `LOGIN_FAIL` (motivos `no_existe`, `inactivo`) con `ip`/`userAgent`/`empresaId`.
- `LOGOUT` vía nuevo `POST /auth/logout`.
- `PERMISO_DENEGADO` desde `PermisosGuard` (asíncrono).

**Cobertura 100% (`@Audit` en write endpoints)**
- `convenios.controller`, `empresas.controller`, `politicas.controller`, `parametros.controller`, `roles.controller`, `usuarios.controller`, `imports.controller`, `reportes.controller` (create/update/delete/ejecutar/descargar), `comentarios.controller`, `contactos.controller` y `deudores.controller` (ya tenían `@Audit`, ajustados al nuevo shape).
- `imports.processor` (BullMQ) registra `IMPORT_OK`/`IMPORT_FAIL` vía `AuditoriaHelper` con `usuarioId` del job.

**Catálogo de reportes (`reportes/catalogo/metadata.ts` + `dto/plantilla.dto.ts`)**
- `transaccion` y `usuario` removidos de `MODELOS_OCULTOS` para que puedan ser raíz/relación en plantillas de reportes.
- `Raiz` enum gana `TRANSACCION = 'transaccion'` (permite generar reportes nativos sobre el log).
- Labels nuevos para campos de transacción (Fecha, Usuario, Módulo, Entidad, Tipo, Severidad, Estado, Resumen, Recurso, IP).

### Cambios — Frontend

**Nueva sección `/auditoria` (`pages/auditoria/*`)**
- Tres tabs: **Dashboard** (KPIs + LineChart actividad 30d + PieChart por módulo + BarChart top tipos/usuarios, auto-refresh 60s), **Stream** (timeline tiempo real, auto-refresh 30s), **Búsqueda** (filtros completos + tabla paginada + drawer detalle con diff antes/después).
- `AuditDiffView`: aplana objetos anidados (`flat()`) y pinta cambios con chips `nuevo`/`cambiado`/`eliminado`.
- Botón **Exportar** (menú: Excel/CSV/PDF server-side + CSV cliente para la página actual). Solo visible con permiso `auditoria.exportar`.

**Routing / nav (`AppRoutes.tsx`, `navConfig.ts`, `SideNav.tsx`)**
- Ruta `/auditoria` registrada.
- Entrada "Auditoría" (icono `FactCheck`) bajo "Administración", visible con `auditoria.ver`.

**API client (`api/auditoria.ts`, `types/auditoria.ts`)**
- `auditoriaApi.listar/stats/obtener/exportar` con tipos `Transaccion`, `AuditoriaStats`, `QueryAuditoria`.

### Migración de roles

- Asignar `auditoria.ver` (y opcionalmente `auditoria.ver_todos`, `auditoria.exportar`) a los roles que correspondan vía UI `/admin/roles`. Por defecto los roles existentes no tienen estos permisos.

### Pendientes / fuera de scope de esta entrega

- F5 (retención + archivado): retención indefinida confirmada por producto, no se implementa cron de archivado por ahora.
- Tests unitarios del `AuditInterceptor`: pendientes (caso `before`/`after`, FALLIDO path, usuario nulo).
- Link "Historial de cambios" desde `FichaDeudor` a `/auditoria?deudorId=X`: pendiente.

---

## [2026-05-11] — Eliminación de reportes v1 + rename de v2 → versión oficial

### Decisión

Reportes v2 (constructor dinámico tipo Power BI) reemplaza completamente al motor v1 estático. Ya no convive un v1 + v2: el módulo v1 se eliminó y v2 pasó a llamarse simplemente "reportes" (sin sufijo) en código, DB y URLs. Más adelante se construirá un módulo separado de dashboards/tableros.

### Cambios

**Eliminación v1.**
- Backend: removido `backend/src/modules/reportes/v1/*` y referencias en `app.module.ts`.
- Frontend: removidos componentes, rutas, tipos `PlantillaV1`/`PlantillaUnificada` y la lógica que mezclaba v1+v2 en `ReportesHome`.
- Prisma: drop de modelos `plantilla_reporte` y `ejecucion_reporte` v1 (no había datos relevantes en estas tablas), `db push`.
- Catálogos de permisos (`auth/permisos-catalogo.ts`, `seed.ts`, `frontend/utils/permisosCatalogo.ts`) consolidados a una única sección "Reportes".

**Rename v2 → reportes (sin sufijo).**
- Backend: carpeta `backend/src/modules/reportes/v2/*` movida a `backend/src/modules/reportes/`. Archivos `*-v2.*` renombrados (`reportes-v2.controller.ts` → `reportes.controller.ts`, idem service/module/gateway/processor/queue, DTOs, exportadores, etc.). `@Controller('reportes/v2')` → `@Controller('reportes')`. Storage path `reportes/v2/{anio}/{mes}` → `reportes/{anio}/{mes}`.
- Clases y constantes: `ReportesV2*` → `Reportes*`, `EjecucionesV2*` → `Ejecuciones*`, `Xlsx/Csv/Txt/PdfV2Exportador` → sin sufijo, `REPORTES_V2_*_ENV` → `REPORTES_*`, `RaizV2`/`ColumnaV2`/`FiltroV2`/`AgrupacionV2`/`TotalV2`/`OrdenamientoV2`/`PlantillaV2`/`EjecucionV2`/`EstadoEjecucionV2`/`DefinicionV2`/`FormatoTelefonoV2` → sin sufijo.
- Frontend: carpeta `frontend/src/pages/reportes/v2/*` movida a `frontend/src/pages/reportes/`. Páginas `ReportesV2{Home,Builder,Ejecutar,Ejecuciones}.tsx` → `Reportes*.tsx`. API client `api/reportes-v2.ts` → `api/reportes.ts`, types `types/reportes-v2.ts` → `types/reportes.ts`, hook `useReportesV2Socket` → `useReportesSocket`. Rutas `/reportes/v2/*` → `/reportes/*` y navConfig actualizado.
- Prisma: modelos `plantilla_reporte_v2`/`ejecucion_reporte_v2` renombrados a `plantilla_reporte`/`ejecucion_reporte`, relaciones `PlantillaV2Empresa`/`PlantillaV2CreadoPor`/`EjecucionV2Usuario` sin sufijo. `npx prisma db push --accept-data-loss` (tablas v2 sin datos).
- Permisos: `reportes.v2.{ver,crear,editar,eliminar,ejecutar,ver_ejecuciones,gestionar_formatos}` → `reportes.{ver,crear,editar,eliminar,ejecutar,ver_ejecuciones,gestionar_formatos}`. Migrados los roles existentes con `backend/prisma/migrate-permisos-v2.sql` (string-replace sobre el JSON de `rol.permisos`, removiendo además `reportes.v1.*`).

### Compatibilidad

- Sin retrocompatibilidad: clientes con tokens viejos verán denegación 403 hasta que sus roles se relean (lo cual ya hizo el script SQL).
- Storage existente bajo `storage/reportes/v2/*` quedará huérfano — eliminar manualmente si se quiere recuperar disco.

### Mover a un módulo separado (futuro)

- Dashboards/tableros tipo Power BI vivirá en `backend/src/modules/dashboards/` y `frontend/src/pages/dashboards/`, no en `reportes/`.

---

## [2026-05-11] — Fase 4: Sistema de notificaciones + monitoreo live de importaciones

Commits: `a3d1e6c` (main), `2607c61` (fix VALIDANDO eliminable).
Spec completo y changelog detallado: `docs/notificaciones-spec.md`.

### Backend

- **Schema Prisma** — nuevo modelo `Notificacion` (1 fila por destinatario, fan-out), enums `TipoNotificacion` (IMPORTACION_INICIADA/FINALIZADA/ERROR, REPORTE_LISTO/ERROR, CONVENIO_VENCIDO, SISTEMA) y `EntidadTipo`. Agregado `remesa.usuarioCreadorId` (FK `usuario`, `SetNull`).
- **RealtimeModule** (`backend/src/modules/realtime/`) — Socket.IO gateway con namespace `/rt`, auth JWT en handshake, rooms `user:${id}` + `admin:importaciones`. Helpers `emitImportIniciada/Progreso/Finalizada`. `WsJwtGuard` opcional para mensajes entrantes.
- **NotificacionesModule** (`backend/src/modules/notificaciones/`) — CRUD + endpoints REST: `GET /notificaciones`, `GET /notificaciones/contador`, `POST /:id/leer`, `POST /leer-todas`. Fan-out automático con `incluirUsuariosConPermiso`.
- **`GET /import/en-curso`** con filtro por permiso `importacion.ver_progreso_otros` (uno ve solo lo suyo, el otro ve todas).
- **Validación 1-por-usuario** al ejecutar remesa: transacción MySQL con `SELECT FOR UPDATE` sobre la fila del usuario → HTTP 409 `IMPORT_USUARIO_OCUPADO` si ya tiene una activa.
- **ProgressEmitter** (`backend/src/modules/imports/utils/progress-emitter.ts`) — util con throttle 2s / 5% con primer y último forzado. Integrado en los 7 processors.
- **`processImportJob`** envuelto en try/catch — marca remesa `FALLIDA`, emite `import:finalizada`, crea notificación `IMPORTACION_ERROR`, re-lanza.

### Frontend

- **`SocketContext`** + `useSocket()` — cliente Socket.IO con JWT en handshake; connect/disconnect ligado al token.
- **`NotificacionesContext`** + hooks `useNotificaciones`, `useImportacionesEnCurso` — hidratación REST al montar + suscripción a 5 eventos socket; flag `hidratadoRef` para no spammear toasts durante hidratación inicial.
- **`NotificacionesBell` + `Popover`** en AppShell — IconButton con Badge rojo, popover 360px con dos secciones (Importaciones en curso / Historial). Empty state, "Marcar todas".
- **Refactor `ImportProgress.tsx`** — eliminado polling con `setInterval`; consume el hook global. Si la remesa no está en contexto, fetch REST puntual para obtener estado final.
- **`useNotify`** wrapper sobre `notistack` con `success`, `error`, `info`.

### Robustez de imports + UX

- **Defaults de estado en plantilla** — agregados `defaultEstadoSituacionId` y `defaultEstadoGestionId` (FK `parametro`, `SetNull`) en `plantillaimport`. Reemplaza lookup hardcodeado por `grupo='estadoSituacion'/'estadoGestion'` (que no concordaba con cómo los usuarios cargan los códigos: `grupo='situacion'/'gestion'`). Sin fallback: si la plantilla no tiene defaults, falla con error descriptivo.
- **`PlantillaEditor.tsx`** — dos selects nuevos: "Estado situación inicial" y "Estado gestión inicial". Carga via `GET /parametros?empresaId=X&grupo=situacion|gestion`.
- **`PlantillasList.tsx`** — fix: `sessionStorage.setItem('plantillas_empresaId', ...)` antes de `navigate('/plantillas/nueva')` (el editor leía un key que nunca se escribía).
- **`DELETE /import/remesas/:id`** + permiso `importacion.eliminar`. Reglas: solo PENDIENTE, VALIDANDO, FALLIDA, o FINALIZADA con `okFilas === 0`. Cascade borra `jobimport` + `importerror`; **NO** borra `deudor` (datos de negocio).
- **`ImportHistory.tsx`** — botón eliminar (rojo) con permission gate + tooltip dinámico explicando por qué está deshabilitado.
- **Rediseño completo de `ImportDetail.tsx`** — hero card con número de remesa + estado, 4 stat cards (Total/OK/Err/Tasa éxito), donut Recharts con label centrado en SVG (porcentaje grande + total), info card con 8 campos (empresa, plantilla, política, usuario, archivo, duración, fechas).
- **Auto-refresh live en `ImportDetail`** — suscripción a `import:progreso` e `import:finalizada` filtradas por `remesaId`. Status backend enriquecido con includes + `duracionMs` y `tasaExitoPct` calculados.

### Bugs resueltos durante QA E2E

- **Progreso siempre en 100%**: el denominador era `total` (contador acumulado), no `remesa.totalFilas`. Fix con `Math.floor((ok + err) / totalEsperado * 100)`.
- **`rutaAccion` rota**: `/importacion/historial/:id` → en blanco. Fix a `/historial-importaciones/${remesaId}`.
- **Loop infinito de GET en `ImportDetail`**: `useNotify()` devolvía objeto nuevo cada render → `fetchAll` se recreaba → `useEffect` se re-disparaba en bucle. Fix con patrón `notifyRef` (ref actualizado por su propio effect, deps limpias).
- **Permisos cacheados**: nuevos permisos (`importacion.eliminar`) requieren logout/login completo porque se cachean en `localStorage.amsa_usuario`. Documentado.

### Decisiones tomadas

- Eventos discretos (INICIADA/FINALIZADA/ERROR) van a `Notificacion`; **el progreso NO se persiste** — solo se empuja por socket. Cada subscriber tiene su propia fila → marcar leída es siempre local al usuario.
- Sin polling fallback si el socket cae: reconexión automática + re-hidratación REST.
- Una sola importación activa por usuario (varios usuarios sí pueden ejecutar en paralelo).
- Toasts solo en vivo, nunca durante hidratación inicial.

### Pendientes

- N12 (Fase 2): cron de cleanup — borrar notificaciones leídas > 30 días y no leídas > 180 días.
- Validar con producto si los `deudor` deberían eliminarse al borrar remesa o no.
- Retake de remesa atascada en `VALIDANDO` (por ahora solo se elimina).

---

## [2026-05-11] — Fase 3: Autenticación Google + RBAC dinámico

Commit: `f86d120`.

### Backend

- **AuthModule** (`backend/src/auth/`) con verificación de id_token de Google (google-auth-library), JwtStrategy (passport-jwt), `JwtAuthGuard`, `PermisoGuard`, decoradores `@RequierePermiso(...)` y `@UsuarioActual()`.
- **Schema** — nuevos modelos `Usuario` (email único, `googleId`, `rolId`), `Rol` (con `permisos String[]` o tabla pivot según versión final), `permiso_catalogo`. Seed con roles ADMIN y OPERADOR.
- **Módulos `roles/` y `usuarios/`** — CRUD para admin. Solo accesibles con permisos `usuarios.gestionar` / `roles.gestionar`.
- **Catálogo de permisos** (`backend/src/auth/permisos-catalogo.ts`) — fuente de verdad de las keys. `TODAS_LAS_KEYS` derivado automáticamente para ADMIN.
- Todos los controllers existentes anotados con `@RequierePermiso(...)` granular (ej: `deudores.ver`, `importacion.ejecutar`, `reportes.crear`, etc.).

### Frontend

- **`AuthContext`** con `usuario`, `permisos`, helper `tienePermiso(key)`. Persistencia en `localStorage.amsa_usuario` + token. Hidratación al montar.
- **`Login.tsx`** con botón de Google Sign-In oficial; redirige a `/` tras éxito.
- **`PrivateRoute`** revisa token + opcionalmente un permiso (`requierePermiso="..."`).
- **Páginas admin** (`frontend/src/pages/admin/`) — UsuariosList, UsuarioForm, RolesList, RolForm con asignación de permisos en checklist agrupado por categoría.
- **Catálogo de permisos replicado** en `frontend/src/utils/permisosCatalogo.ts` (idéntico al backend).
- **Botones / acciones** condicionados con `tienePermiso(...)` en lugar de mostrar todo.
- `UserMenu` muestra email + rol; logout limpia storage y desconecta socket.

### Decisiones

- Sin password local: solo login con Google (dominio corporativo se valida del lado del usuario por ahora).
- Permisos cacheados en localStorage por performance — cambios de rol requieren re-login.
- ADMIN deriva permisos automáticamente de `TODAS_LAS_KEYS`; otros roles los tienen explícitos en DB.

---

## [2026-05-08] — Fase 0/1/2: Rediseño UI/UX + design system

Commits: `7fde3f4` (Fase 0), `b6134e5` (Fase 1 reportes v2), `d061907` (Fase 2 resto), `bd00036` (split FichaDeudor).

### Fase 0 — Sistema de diseño + AppShell

- **`frontend/src/components/ui/`** — librería de componentes base: `PageHeader`, `SectionCard`, `EmptyState`, `LoadingSkeleton`, `StatusChip`, `DataTableResponsive`, `KpiCard`, `FilterBar`.
- **AppShell responsive** — `AppBar`, `SideNav` colapsable, `UserMenu`. Drawer en mobile, sidenav fijo en desktop. Theme MUI ajustado (paleta, spacing, typography).
- **`navConfig.ts`** — definición declarativa del sidebar con permisos requeridos por entry.

### Fase 1 — Migración reportes v2 al design system

- Todas las páginas de `frontend/src/pages/reportes/v2/` (builder, ejecuciones, listado, detalle) reescritas con los componentes del design system.

### Fase 2 — Migración del resto de páginas

- `ImportHistory`, `ImportDetail`, `PlantillasList`, `PlantillaEditor`, `EmpresasList`, `EmpresaForm`, `ParametrosList`, `PoliticasList`, `ConveniosList`, `DeudoresList`, `FichaDeudor`, `Login` — todas migradas a `PageHeader` + `SectionCard` + `DataTableResponsive`. Tablas con vista card en mobile.

### Refactor FichaDeudor

- Split en sub-componentes: `FichaDeudorHeader`, `FichaEstadosCard`, `FichaContactoCard`, `FichaConvenioCard`, `FichaComentariosTab`, `FichaHistorialTab`. El componente raíz se redujo de ~900 a ~250 líneas.

---

## [2026-05-08] — Reportes v2: constructor dinámico tipo Power BI

Commits: `c0f3890` (spec), `5585d46` (F1+F2 backend), `ce58cbf` (F3+F4 builder frontend), `0524a43` (F5 exportadores), `27d63ca` (F6 async), `67e5d7c` (F7 mejoras).
Spec completo: `docs/reportes-dynamic-spec.md`.

### Backend (`backend/src/modules/reportes/v2/`)

- **Parser + Planner + Executor** — DSL JSON declarativo (campos, filtros, agrupaciones, métricas, orden). El planner traduce a SQL Prisma + raw cuando es necesario.
- **Catálogo de campos** (`campos/`) por fuente (`deudores`, `remesas`, `convenios`), con metadata (tipo, agregable, formato).
- **Agregadores**: sum, count, count_distinct, avg, min, max, percent_of_total.
- **Ejecución async** con BullMQ — el endpoint `POST /reportes-v2/ejecutar` encola un job, devuelve `ejecucionId`. Socket.IO emite `reporte:progreso` y `reporte:finalizado`. Storage local de archivos generados.
- **Exportadores con branding**: xlsx con header coloreado por empresa, footer con logo, agrupaciones colapsables, totales por grupo. PDF en landscape automático según número de columnas. CSV con BOM.
- **Schema** — nuevos modelos `plantilla_reporte_v2`, `ejecucion_reporte_v2` (con estado, progreso, archivo path, error).

### Frontend (`frontend/src/pages/reportes/v2/`)

- **Builder** — three-pane layout: Field Explorer (catálogo navegable a la izquierda), Canvas (drop targets para filas/columnas/filtros/métricas en el centro), Preview en vivo (a la derecha, primeras 20 filas).
- **Filtros con tipo**: rango fechas, multi-select, numérico, texto, booleano. Algunos marcables como "variables" para que se pidan en ejecución.
- **Mejoras F7**: máscaras de teléfono configurables, validaciones de DSL, mejor UX de filtros variables.
- **Ejecuciones**: listado con estado live (socket), botón descargar cuando finaliza, ver detalle con resumen del DSL usado.

---

## [2026-04-13] — Gestión de códigos / asignaciones por empresa

Commit: `1256f26`.

- Página `AjustesParametros` reescrita con dos tabs (Catálogo + Asignación por empresa) — ver entrada de [2026-04-12] para detalle del modelo de datos. Esta entrada documenta la versión final commiteada de la UI de asignaciones.

---

## [2026-04-06] — Módulo de Políticas y Convenios

Commit: `ad76551`.

### Backend (`backend/src/modules/politicas/` + `convenios/`)

- **Schema** — modelos `Politica` (configuración de descuentos, cuotas, vencimientos por empresa), `Convenio` (instancia para un deudor con cuotas, fechas, monto total/cuotas, estado).
- **PoliticasService** — CRUD + activar/desactivar. Asociadas a empresa y opcionalmente a remesa (via `remesa.politicaId`).
- **ConveniosService** — generar convenio para un deudor desde una política, registrar pagos, actualizar estado (VIGENTE/CUMPLIDO/CAIDO).

### Frontend

- **`PoliticasList`** + `PoliticaForm` — wizard de creación con descuentos, cuotas, fecha de vencimiento, condiciones.
- **`ConveniosList`** + ficha de convenio dentro de `FichaDeudor` (nuevo tab "Convenios").
- **Asociación remesa↔política** desde `ImportHistory` (Select en columna Política, persiste con `PUT /import/remesas/:id/politica`).

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
