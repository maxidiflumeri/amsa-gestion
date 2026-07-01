# AMSA Gestión — Changelog de Desarrollo

> Este archivo es el registro de contexto principal para que una IA pueda retomar el trabajo.
> Stack: NestJS + Prisma + MySQL (backend) · React + MUI v5 + TypeScript (frontend)
> Convención DB: `npx prisma db push` (NO `prisma migrate dev` — hay drift histórico)

---

## [2026-07-01] — Importe del deudor desde facturas + datos adicionales unificados

> ⚠️ **Acciones de despliegue**:
> 1. **Sin migración de schema**: la opción nueva se guarda dentro de `plantillaimport.mappingJson` (`montoDeudorDesdeFacturas`). No hace falta `prisma db push` por esta feature.
> 2. **Sin backfill**: aplica solo a importaciones nuevas. Los deudores ya cargados con importe en 0 quedan como están (siguen expuestos a que un pago los marque SIT-050 vía consolidación — pendiente si aparece el caso).
> 3. Las plantillas de facturas existentes toman el default **`SI_VACIO`** al abrirlas/guardarlas (comportamiento seguro: solo rellenan importes en 0).

**Problema** (feedback de usuarios en pruebas): en el flujo de dos archivos (primero deudores, después facturas), el archivo de deudores muchas veces **no trae el importe**, así que el deudor quedaba con `montoTotal`/saldo en **0**. El de facturas sí trae los importes, pero el `FacturasProcessor` nunca tocaba al deudor. Además, los "datos adicionales" mapeados en la carga de facturas se **descartaban** (la tabla `factura` no tiene campo JSON) y no se veían en ningún lado. Un `montoTotal = 0` además rompe la consolidación (cualquier pago dispara **SIT-050**).

### 1. Importe del deudor calculado desde las facturas (configurable por plantilla)

- Nuevo modo `mappingJson.montoDeudorDesdeFacturas: 'NO' | 'SI_VACIO' | 'SIEMPRE'` (default **`SI_VACIO`**), propagado a `ProcessContext`. `NO` = no toca `montoTotal`; `SI_VACIO` = lo completa con Σfacturas solo si quedó null/0; `SIEMPRE` = pisa con Σfacturas.
- Util compartido `imports/utils/monto-facturas.ts` → `recalcularMontoTotalDesdeFacturas(ctx, deudorIds)`: recálculo **idempotente** con `UPDATE ... SET montoTotal = (SELECT SUM(importe) FROM factura ...)` en chunks de 500 (no incrementos), y luego `ConsolidacionSituacionService.consolidar({ tipo: 'DEUDORES', deudorIds })` para reconciliar saldo/situación (si Σpagos == 0 hace skip → no-op barato en carga inicial).
- `FacturasProcessor`: trackea los `deudorId` tocados y corre el recálculo en un nuevo `afterAll`.
- `DeudoresYFacturasProcessor`: se unificó a la misma lógica. Antes usaba `montoTotal: ?? rowInvoicesSum` + `{ increment }` (no idempotente, duplicaba al reimportar); ahora el importe se reconcilia en `afterAll` desde la suma real de facturas.

### 2. Datos adicionales de facturas → datos adicionales del deudor

- `FacturasProcessor` ahora acumula `row.camposAdicionales` por deudor y en `afterAll` los **mergea** dentro de `deudor.camposAdicionales` (`mergeCamposAdicionalesEnDeudores`), **sin pisar** las claves que ya tenía del import de deudores (ante clave repetida gana el último valor). Antes se descartaban.
- Quedan visibles automáticamente en la card "Datos Adicionales" de la ficha y en el catálogo de reportes (no hubo que tocar la visualización).

### 3. Frontend (`PlantillaEditor` + `MappingEditor`)

- `PlantillaEditor`: sección **"Importe del deudor"** con el selector de modo, visible solo para categorías `FACTURAS` y `DEUDORES_Y_FACTURAS`; se persiste en `mappingJson.montoDeudorDesdeFacturas` (default `SI_VACIO`).
- `MappingEditor`: la sección "Campos extras" muestra un subtítulo aclaratorio en flujos de facturas ("se cargan en los Datos Adicionales del DEUDOR, no de la factura; se mergean con los que ya tenga").

---

## [2026-06-30] — Consolidación automática de situación según pagos (SIT-050 / SIT-041)

> ⚠️ **Acciones de despliegue**:
> 1. `prisma db push` aplica los campos nuevos de `deudor`: `saldo`, `situacionConsolidadaEn` + índice `Deudor_estadoSituacion_empresa_idx` (el `deploy.sh` ya corre `db push`).
> 2. **Códigos SIT-050/SIT-041 deben estar seedeados** (`seed-codigos-curados.ts`): el `ConsolidacionSituacionService` **falla al bootstrap** si faltan (por diseño). Ya están en la base de prod.
> 3. Env opcional `CONSOLIDACION_TOLERANCIA_PCT` (default `0.01` = 1%, rango `[0, 0.05]`).
> 4. **Backfill post-deploy** de datos existentes: snapshot de `deudor(id, estadoSituacionId, montoTotal, saldo)` → botón "Consolidar" (preview → aplicar) o `npx ts-node --transpile-only prisma/scripts/backfill-consolidacion.ts --apply`.

**Problema**: al cargar pagos/actualizaciones se generaban los pagos pero el **código de situación del deudor nunca cambiaba**. Se replica la lógica del CRM anterior: si la deuda queda cancelada → **SIT-050** (Cancelado); si hay pago parcial → **SIT-041** (Pago parcial).

### 1. Modelo: `montoTotal` inmutable + `saldo` persistido

- **Schema** (`deudor`): `saldo Float?` (= `montoTotal − Σpagos`, mantenido por la consolidación), `situacionConsolidadaEn DateTime?`, índice `[estadoSituacionId, empresaId]`.
- `montoTotal` pasa a ser **inmutable** (el importe original del cedente). `actualizaciones.processor` deja de pisarlo (se eliminaron las 3 escrituras de `montoTotal` en escenarios A/B y `afterAll` C; se conserva en la **creación** de deudores nuevos). La baja se refleja vía pagos/`saldo`.

### 2. Servicio core idempotente (`backend/src/modules/consolidacion/`)

- `ConsolidacionSituacionService.consolidar(scope, opts)` con scopes `DEUDORES | REMESA | EMPRESA | TODAS`, procesado en **chunks de 500** con query agregada (`GROUP BY`, no fila por fila). Regla: `Σpagos == 0` → skip; `Σpagos ≥ montoTotal·(1−tolerancia)` → SIT-050; parcial → SIT-041; `saldo = max(0, montoTotal − Σpagos)`. Escritura por chunk en transacción (`updateMany` de situación + `$executeRaw GREATEST(0, ...)` para el saldo). `dryRun` no escribe. Idempotente. Tolerancia configurable por env, validada al bootstrap. Auditoría agregada best-effort.

### 3. Disparo automático (afterAll de processors)

- `pagos.processor` y `actualizaciones.processor` consolidan en `afterAll`: pagos usa scope `DEUDORES` (trackea `processedDeudorIds`); actualizaciones consolida la remesa origen (y la propia si difiere). Sin paso manual.

### 4. Job batch + endpoints + bloqueo de cuenta cancelada

- **Job BullMQ** `consolidacion-queue` (concurrency 1, attempts 1) con progreso por socket (`consolidacion:iniciada/progreso/finalizada`), notificación persistente y auditoría. **Lock Redis** (`lock:consolidacion`, TTL 15 min) → un solo apply a la vez; el preview no toma lock.
- **Endpoints** `/api/consolidacion`: `POST /preview` (dryRun, `202 {jobId}`), `POST /aplicar` (`409 CONSOLIDACION_EN_CURSO` si hay otro), `GET /estado`. Permiso fino `consolidacion.ejecutar` (catálogos back/front + seed; ADMIN lo recibe).
- **Bloqueo SIT-050**: `DeudorBloqueoService.assertNoBloqueado()` rechaza con `ForbiddenException(DEUDOR_CANCELADO)` toda mutación de un deudor cancelado — cableado en deudores (update/delete), comentarios (create/remove/removePropio), convenios (create/marcarCuotaPagada/anularConvenio) y contactos (create/update/remove). El consolidador y los workers de import están exceptuados.

### 5. Frontend

- **Ficha del deudor** (`FichaHeader`): muestra "Saldo actualizado" (campo `saldo`) con el "Original" tachado e inmutable y el monto pagado; fallback a "Deuda total" si `saldo` es null. Chip "CUENTA CANCELADA" y saldo en verde cuando SIT-050. Se eliminó el cálculo viejo de saldo por cuotas de convenio (el `saldo` del backend ya contempla todos los pagos).
- **Modo bloqueado**: cuando `estadoSituacion.clave === 'SIT-050'` se deshabilitan (con tooltip) los estados, contactos, convenios y comentarios de la ficha — sin clonar la vista.
- **`ConsolidacionModal`** reutilizable (preview → tabla resumen → aplicar, progreso por socket, manejo de 409) y botón "Consolidar" por remesa en `ImportHistory` (gateado por `consolidacion.ejecutar`).

> Spec de diseño completo: [docs/consolidacion-situacion-spec.md](docs/consolidacion-situacion-spec.md). Pendiente opcional (Fase 6, no implementada): cron diario + dashboard de consolidaciones + métricas.

---

## [2026-06-29] — Tanda de mejoras de UX y robustez (feedback de usuarios)

> ⚠️ **Acciones de despliegue**:
> 1. `prisma db push` aplica los campos nuevos: `remesa.validarDomicilios`, `deudor.nroCliente` + índice `Deudor_empresaId_remesaId_nroCliente_idx` (el `deploy.sh` ya corre `db push`).
> 2. **Correr una vez post-deploy** el backfill de número de cliente: `npx ts-node --transpile-only prisma/scripts/backfill-nro-cliente.ts` (idempotente). Migra el `nro_cliente` histórico desde `camposAdicionales` a la columna nueva.

### 1. Búsqueda de deudores por número de remesa

- **Backend**: `AdvancedSearchDto` suma `nroRemesa?`. `deudores.service.searchAdvanced` filtra por la relación `remesa.numeroRemesa` (`contains`).
- **Frontend**: `BuscadorAvanzadoModal.tsx` agrega el campo "Nº Remesa" al formulario.

### 2. Entorno de desarrollo: `npm run dev` en la raíz

- Nuevo `package.json` raíz con `concurrently`: `npm run dev` levanta backend (watch) + frontend (Vite) juntos. Scripts `dev:backend`, `dev:frontend`, `build`, `install:all`.
- **Fix**: `backend/tsconfig.json` ahora apunta `tsBuildInfoFile` a `./dist/...`. Antes el `.tsbuildinfo` quedaba huérfano fuera de `dist` (que `nest start` borra con `deleteOutDir`), y tsc incremental no re-emitía → `Cannot find module dist/main`.

### 3. Teléfono WhatsApp + principal: chip mitad y mitad

- **Frontend** (`FichaContactosPanel.tsx`): cuando un teléfono es WhatsApp **y** principal, el chip se pinta con un gradiente diagonal mitad naranja (principal) / mitad verde (WhatsApp), respetando dark/light mode.

### 4. WhatsApp solo en celulares — clasificación móvil/fijo por ENACOM

- En Argentina el formato no distingue móvil de fijo sin el "9"/"15" (un celular se carga como `1155775452`). `libphonenumber` devuelve `UNKNOWN` para todos los AR. La distinción real está en los rangos asignados por ENACOM.
- **Dataset**: `backend/src/common/data/enacom-prefijos.json` (≈48.900 bloques `área+central → móvil/fijo`, publicación ENACOM 2026-06-09). Versionado en git; `nest-cli.json` lo copia a `dist` (assets + watchAssets).
- **Backend** (`phone-utils.ts`): `normalizarTelefonoArgentino` clasifica `subtipo` (`MOBILE`/`FIXED_LINE`) con longest-prefix-match sobre el dataset (señal explícita del `+549` primero). `contactos.service` (create/update) rechaza marcar WhatsApp en líneas fijas; **autocorrección perezosa**: al intentar marcar un fijo legacy, persiste su `subtipo` antes de rechazar para que el frontend lo deshabilite a futuro.
- **Frontend** (`FichaContactosPanel.tsx`): el botón de WhatsApp queda deshabilitado (con tooltip) en teléfonos fijos según `contacto.subtipo`.

### 5. Importación: switch "Validar domicilios" (default OFF)

- La validación de domicilios contra Georef hacía la carga lenta (hasta 4 requests HTTP por dirección). Ahora es opcional.
- **Schema**: `remesa.validarDomicilios Boolean @default(false)`.
- **Backend**: `CreateRemesaDto` + `createRemesa` persisten el flag; `processImportJob` lo lee de la remesa y lo propaga vía `ProcessContext`. `contacto-import.ts`: si está OFF, arma el domicilio con formato pero **sin** llamar a Georef (`validado=false`). Los 3 processors que cargan contactos pasan `ctx.validarDomicilios`.
- **Frontend** (`ImportWizard.tsx`): switch "Validar domicilios contra Georef" (default OFF) en el paso de configuración.

### 6. Editor de plantillas: botón "Agregar" abajo + auto-scroll

- **Frontend** (`MappingEditor.tsx`): en las 3 secciones (campos principales, extras, bloques repetitivos) el botón de agregar pasó del header al final de la lista, con auto-scroll al nuevo ítem (solo al agregar). Evita el ir y venir de scroll.

### 7. Plantillas: clonar y cambiar de empresa (importación + reportes)

- **Importación** (`imports.service` + controller + DTOs): `POST /import/plantillas/:id/clonar` (copia config; resuelve `version` por el unique; estados por defecto → null si cambia de empresa) y `POST /import/plantillas/:id/cambiar-empresa` (**bloqueado si la plantilla tiene remesas**). El listado expone `_count.remesa`.
- **Reportes** (`reportes.service` + controller + DTOs): `/duplicar` mejorado (acepta nombre + empresa destino, `@Audit`, permiso `reportes.crear`) y nuevo `/cambiar-empresa` (**bloqueado si tiene ejecuciones**; admite "Global"). El listado expone `_count.ejecuciones`.
- **Frontend**: diálogos reutilizables `ClonarPlantillaDialog` y `CambiarEmpresaDialog` (`components/plantillas/`), integrados en `PlantillasList` y `ReportesHome`. El botón "Cambiar empresa" se deshabilita si la plantilla ya se usó.

### 8. Número de cliente como campo principal del deudor

- El `nro_cliente` (clave del match de pagos/facturas/contactos/actualizaciones/bloques) vivía como dato adicional en `camposAdicionales` con clave mágica `nro_cliente` hardcodeada en 5 processors → frágil y sin índice.
- **Schema**: nueva columna `deudor.nroCliente String?` + índice compuesto `[empresaId, remesaId, nroCliente]`. Backfill idempotente `prisma/scripts/backfill-nro-cliente.ts`.
- **Backend**: la carga de deudores (`deudores` y `deudores-facturas` processors) ahora **exige** `nro_cliente` y lo guarda en la columna; helper `utils/nro-cliente.ts` lo toma como campo principal o como adicional (compatibilidad con plantillas viejas). Los 5 processors de match ahora usan la columna indexada en vez de `JSON_EXTRACT`. `searchAdvanced` busca por `nroCliente` (+ fallback a datos viejos).
- **Frontend** (`MappingEditor.tsx`): "Nº Cliente (match)" agregado a los campos principales de DEUDORES.

### 9. Borrar remesa terminada junto con sus casos

- **Backend** (`imports.service.deleteRemesa`): permite borrar remesas terminadas con casos **solo si ningún deudor tiene gestión** (comentarios, convenios, pagos, llamadas, emails). Si la tiene, rechaza con el detalle. Borrado transaccional en cascada controlada (contactos + campoextras + facturas → deudores → jobs/errores → remesa); la auditoría se conserva (transacciones quedan desvinculadas).
- **Frontend** (`ImportHistory.tsx`): el botón eliminar se habilita en cualquier estado salvo "en curso"; el diálogo aclara que se borran los casos y que se bloquea si hay gestión.

### 10. Políticas: editor enriquecido en las 3 secciones + tabs

- **Frontend** (`AjustesPoliticas.tsx`): el modal de carga/edición se reorganizó en **3 tabs** (Descripción/Metodología · Formas de pago · Tipo de atención). Las 3 secciones usan ahora `RichTextEditor` (Tiptap: títulos, negrita/cursiva/subrayado, colores, listas, alineación) — antes solo la descripción. Modal a `maxWidth="md"`; la tabla limpia el HTML (`stripHtml`) en las columnas de formas de pago y tipo de atención.
- **Frontend** (`PoliticaTab.tsx`): en la ficha del deudor, "formas de pago" y "tipo de atención" se renderizan como HTML (`RichTextEditor` readOnly), igual que la descripción.
- **Backend**: sin cambios — los 3 campos ya eran `@db.Text`. Los datos viejos en texto plano se siguen viendo bien y quedan como HTML al re-editarlos.

### 11. Número de cliente en el encabezado de gestión

- **Frontend** (`FichaHeader.tsx`): se muestra el **Nº Cliente** junto a Empresa y Remesa en el header de la ficha del deudor. Toma `deudor.nroCliente` con fallback a `camposAdicionales.nro_cliente` (datos previos a la migración).

### 12. Bloques repetitivos en todas las categorías de importación

- **Bug detectado en prod**: una plantilla con bloques repetitivos (contactos/facturas) cargada con categoría `DEUDORES` mostraba los bloques en el preview pero **no los persistía** — solo `DEUDORES_Y_FACTURAS` (y parcialmente `ACTUALIZACIONES`) procesaban `_blocks`. Resultado: deudores creados sin sus facturas/contactos.
- **Backend**: nueva función común `procesarBloquesDeudor(deudorId, blocks, ctx)` en `utils/procesar-bloques.ts` que procesa bloques `FACTURA` y `CONTACTO` (respetando `validarDomicilios`). Se llama tras resolver el deudor en **todos** los processors: `deudores`, `contactos`, `enriquecimiento`, `pagos`, `facturas`; y `deudores-facturas` se refactorizó para usarla. En `contactos`/`enriquecimiento` los bloques se procesan aunque no haya contacto principal en la fila.
- `ACTUALIZACIONES` se dejó intacto (tiene reconciliación especial de facturas).

### 13. Notificaciones: fix del contador + rediseño con tabs y paginación

- **Bug**: el badge mostraba un número que no coincidía con la ventana (badge con N pero lista vacía). Causa: el cliente `listarNotificaciones` devolvía el objeto `{ data, total, ... }` entero en vez del array → la lista quedaba sin renderizar. Además `/import/en-curso` devolvía la remesa cruda (campos con otros nombres) y `crear` podía emitir el socket con `id` undefined.
- **Backend**: `listarEnCurso` ahora aplana al shape `ImportEnCursoDto` (`remesaId`, `tipo`, `progreso`, `usuarioNombre`, `startedAt`). `listar` soporta filtro `soloLeidas` (además de `soloNoLeidas`) y devuelve `total` para paginar. `crear` inserta una por una y emite el socket con el `id` real.
- **Frontend**: `listarNotificaciones` devuelve `{ data, total }` correctamente. El contexto usa el contador real de no-leídas para el badge, expone un `nonce` para refrescar y ya no guarda la lista. El popover se rediseñó con **2 tabs (Sin leer / Leídas)** + **scroll infinito** (páginas de 20 por `offset`); las importaciones en curso quedan arriba.

---

## [2026-05-13] — Usuarios: legajo, DNI y telefonía integrada en ABM

### Backend

- **Schema Prisma**: campos `legajo String? @unique` y `dni String? @unique` en modelo `usuario`. Aplicado con `db push`.
- **DTOs nuevos**: `CreateUsuarioDto` y `UpdateUsuarioDto` extienden con `legajo`, `dni` (validación DNI 7-8 dígitos o CUIL 11 dígitos con regex), `esAgente` y objeto `agente` con campos SIP. `UpdateUsuarioDto` usa `AgenteUpdateDto` (todos opcionales; passwords vacíos preservan los existentes en DB).
- **UsuariosService**: inyecta `SipCryptoService`. `create()` y `update()` operan dentro de `$transaction`. Lógica de agente_telefonia: crear, actualizar o DELETE según `esAgente`. `findAll()` devuelve `esAgente` y `agente` (sin campos `*Enc`). Manejo de P2002 con `ConflictException` descriptivo por campo.
- **UsuariosModule**: importa `NeotelModule` para acceder a `SipCryptoService`.
- **neotel.controller.ts**: `NeotelAdminController` conserva solo `GET /admin/neotel/agentes` (debug). Se eliminaron `POST`, `PATCH` y `DELETE` de ese controller — el ABM de agentes ahora se gestiona desde `PATCH /usuarios/:id`.

### Frontend

- **`PasswordField`** (`frontend/src/components/ui/PasswordField.tsx`): componente reutilizable. En alta: input editable + toggle ojito. En edición: input disabled con placeholder `••••••••` + botón "Cambiar" para habilitarlo.
- **`UsuariosPage.tsx`**: Dialog refactorizado a `maxWidth="md"` con 3 accordions (Datos personales / Acceso / Telefonía). Columna "Legajo" agregada en tabla. Chip "Agente" junto al nombre cuando `esAgente=true`. Validación client-side de DNI/CUIL con helperText de error en tiempo real. Lógica de payload que omite passwords vacíos en edición.
- **Types**: interfaces `Usuario` y `AgenteTelefonia` actualizadas con campos nuevos.

---

## [2026-05-13] — Neotel T5: sesión, estado y campaña del agente

### T5 — Sesión + Estado + Campaña del Agente (backend)

Nuevos servicios y controller en `backend/src/modules/neotel/`:

- **`neotel-redis.service.ts`** — capa de caché Redis para el estado del agente. Usa ioredis (dependencia transitiva de bullmq). Keys: `neotel:agente:{id}:sesion` (hash, TTL 8h) y `neotel:agente:{id}:estado` (hash, sin TTL — se borra al logout). Modo degradado: si Redis falla, los métodos loguean warn y retornan null sin lanzar excepción. Expone `ping()` y `getClient()` para uso interno.
- **`sesion-agente.service.ts`** — `loginAgente(usuarioId, meta)`: valida sesión duplicada → llama `NeotelHttpClient.login` → crea `sesion_agente_neotel` + `estado_agente_evento` inicial (DISPONIBLE) → cachea en Redis. `logoutAgente(usuarioId)`: llama `NeotelHttpClient.logout` (tolera error de red) → cierra evento de estado abierto (calcula duracionSeg) → actualiza `logoutAt` + `causaCierre` en DB → elimina keys Redis. `getSesionActiva(usuarioId)`: Redis first, fallback a DB con re-hidratación.
- **`estado-agente.service.ts`** — `setEstado(usuarioId, estado, motivoPausaId?)`: valida estado manual (DISPONIBLE/EN_PAUSA/ADMINISTRATIVO) → valida motivo si EN_PAUSA → llama API Neotel correspondiente (Unpause/Pause/Tiempo_Administrativo) → cierra evento anterior → crea nuevo `estado_agente_evento` → actualiza Redis. `getEstadoActual(usuarioId)`: Redis first, fallback DB. `listarMotivosPausa()`: desde tabla `motivo_pausa_neotel` (activos, ordenados por `orden`). TODO(T8): emitir socket `estado:cambio` al completar `setEstado`.
- **`campaña-agente.service.ts`** — `asignarCampaña(usuarioId, campañaNeotelId)`: valida sesión activa → valida campaña activa → llama `loginCampaign` → cierra campaña anterior si la hay → crea `campaña_sesion_neotel` → actualiza Redis. `desasignarCampaña(usuarioId)`: llama `logoutCampaign` → cierra registro en DB → limpia Redis. `listarCampañasDisponibles()`: todas las activas de `campaña_neotel`.
- **`neotel-sesion.controller.ts`** — controller dedicado `@Controller('neotel')` con todos los endpoints de sesión/estado/campaña (ver abajo). Todos con `@Audit`.
- **`dto/neotel-api.dto.ts`** — extendido con `SetEstadoDto` (estado + motivoPausaId optional) y `AsignarCampañaDto`.
- **`neotel.module.ts`** — registra `NeotelRedisService`, `SesionAgenteService`, `EstadoAgenteService`, `CampañaAgenteService`, `NeotelSesionController`.

### Endpoints nuevos

| Método | Ruta | Descripción | Permiso |
|---|---|---|---|
| `POST` | `/neotel/sesion/login` | Login en Neotel + crea sesión DB + Redis | `telefonia.usar` |
| `POST` | `/neotel/sesion/logout` | Logout Neotel + cierra sesión + invalida Redis | `telefonia.usar` |
| `GET` | `/neotel/sesion/actual` | Sesión activa (Redis → DB) | `telefonia.usar` |
| `PUT` | `/neotel/estado` | Cambia estado (DISPONIBLE/EN_PAUSA/ADMINISTRATIVO) | `telefonia.usar` |
| `GET` | `/neotel/estado/actual` | Estado actual (Redis → DB) | `telefonia.usar` |
| `GET` | `/neotel/motivos-pausa` | Lista motivos de pausa activos | `telefonia.usar` |
| `GET` | `/neotel/campañas` | Lista campañas activas | `telefonia.usar` |
| `POST` | `/neotel/campaña/asignar` | Asigna a campaña + llama Login_Campaign2 | `telefonia.usar` |
| `POST` | `/neotel/campaña/desasignar` | Desasigna de campaña + llama Logout_Campaign | `telefonia.usar` |

### Variables de entorno

No se requieren variables nuevas. Usa `REDIS_HOST` y `REDIS_PORT` ya declaradas por BullMQ.

### Smoke test esperado

- `POST /neotel/sesion/login` → error 502 "Position Externo6001 not found" si la extensión no está activa (comportamiento correcto, se registra el intento de login en logs). DB: NO crea sesion porque el error ocurre antes de `sesion_agente_neotel.create`.
- `GET /neotel/motivos-pausa` → 4 motivos seedeados (Almuerzo/Baño/Capacitación/Reunión).
- `GET /neotel/campañas` → campaña 115.

### AuditTipo usados

`TEL_LOGIN`, `TEL_LOGOUT`, `TEL_ESTADO_CAMBIAR`, `TEL_CAMPAÑA_ENTER`, `TEL_CAMPAÑA_LEAVE` (ya existían en audit.enums.ts desde T3/T4).

---

## [2026-05-13] — Neotel T3 + T4: cliente HTTP + credenciales SIP cifradas

### T3 — NeotelHttpClient (backend)

Módulo `neotel` nuevo en `backend/src/modules/neotel/`:

- **`neotel-http.client.ts`** — cliente HTTP a la API ASMX de Neotel. Cubre todos los endpoints de §4.1 (auth/sesión), §4.2 (campañas), §4.3 (estados), §4.4 (llamadas), §4.6 (eventos), §4.7 (contactos CRM). Método core `call<T>()` con retry exponencial (3 intentos, 300ms/600ms de backoff), timeout configurable (default 8s), sanitización de campos sensibles en logs (CLAVE, DATA, XML_UPDATE). Usa `fetch` nativo de Node 18+.
- **`parsers/xml-response.parser.ts`** — parser de respuestas XML mínimas de Neotel (`<string>`, `<boolean>`, void). Soporte de respuestas planas (sin wrapper XML).
- **`errors/neotel.errors.ts`** — `NeotelApiError`, `NeotelTimeoutError`, `NeotelAuthError`, `NeotelInvalidResponseError`.
- **`dto/neotel-http.dto.ts`** — interfaces tipadas para todos los parámetros de la API Neotel.
- Config desde env: `NEOTEL_API_HOST`, `NEOTEL_API_USER`, `NEOTEL_API_PASS`, `NEOTEL_TIMEOUT_MS`, `NEOTEL_RETRY_ATTEMPTS`.

Smoke test: `POST http://200.5.98.203/neoapi/webservice.asmx/Login` → HTTP 500 con body "Position Externo6001 not found" (API accesible, error de estado Neotel — la extensión no está activa en este momento).

### T4 — Credenciales SIP cifradas (AES-256-GCM)

- **`crypto/sip-crypto.service.ts`** — servicio AES-256-GCM. Formato: `<iv_base64>:<authTag_base64>:<ciphertext_base64>`. Acepta key como 64 hex chars o base64 de 32 bytes. Valida al boot (`OnModuleInit`) y falla rápido si no está configurada. Detecta tampering via authTag GCM. Método `isEncrypted()` para distinguir plain text de cifrado (soporta credenciales legacy).
- **`crypto/sip-crypto.service.spec.ts`** — 19 tests unitarios: round-trip, IV aleatorio, tampering authTag, tampering ciphertext, formato inválido, key incorrecta, edge cases. Todos pasan.
- **`prisma/scripts/encrypt-sip-passwords.ts`** — script idempotente de migración. Detecta plain text vs cifrado (por formato IV base64), cifra solo los que lo necesitan. Soporta `--dry-run`. Migrado agente 1 (6001): `Externo6001` y `10066001` → ciphertext AES-256-GCM.
- **`agente-telefonia.service.ts`** — ABM completo: `listar()` (sin passwords), `crear()` (cifra al guardar), `actualizar()` (cifra si llega password), `eliminar()`. Soporta credenciales legacy en plain text (las descifra correctamente).
- **`neotel.controller.ts`** — `GET /neotel/sip-credentials` (permiso `telefonia.usar`; descifra y devuelve `{extension, sipUri, authUser, password, wssUrl, displayName}`). ABM admin en `/admin/neotel/agentes` (permiso `telefonia.admin`).
- **`neotel.module.ts`** — módulo registrado en AppModule. Importa TransaccionesModule para auditoría.

### Configuración requerida

Variables nuevas en `.env`:
```
NEOTEL_API_HOST=http://200.5.98.203
NEOTEL_API_USER=6001
NEOTEL_API_PASS=10066001
NEOTEL_TIMEOUT_MS=8000
NEOTEL_RETRY_ATTEMPTS=3
NEOTEL_SIP_DOMAIN=200.5.98.203
NEOTEL_WSS_URL=wss://200.5.98.203:8089/ws
NEOTEL_SIP_ENCRYPTION_KEY=<64 hex chars — generar con: openssl rand -hex 32>
```

Para cifrar credenciales existentes en la DB:
```bash
npx ts-node --transpile-only prisma/scripts/encrypt-sip-passwords.ts --dry-run  # previsualizacion
npx ts-node --transpile-only prisma/scripts/encrypt-sip-passwords.ts             # aplicar
```

### AuditTipo nuevos en audit.enums.ts

`TEL_SIP_CREDENTIALS_OBTENIDAS`, `TEL_AGENTE_CREADO`, `TEL_AGENTE_ACTUALIZADO`, `TEL_AGENTE_ELIMINADO`, `TEL_AGENTE_LISTADO`.

### Permisos nuevos en permisos-catalogo.ts

Sección "Telefonía": `telefonia.usar`, `telefonia.click_to_call`, `telefonia.supervisar`, `telefonia.admin` (ya existían en la DB desde T2; ahora registrados también en el catálogo de permisos del frontend/admin).

---

## [2026-05-12] — Timeline de deudor unificado (Gestión ↔ Sender)

### Decisión

Tab top-level **Timeline** en la sección de deudores que consume el internal-api de AMSA Sender y muestra cronológicamente todas las acciones salientes (emails, WhatsApp Web legacy, WhatsApp Meta/WAPI) con sus estados (entregado, abierto, click, fallido, rebote). Match Gestión ↔ Sender por `documento` (no por id — los sistemas conviven sin relación 1:1). Reemplaza el tab "Emails" interno de la ficha: como los envíos de Gestión van por Sender, quedan unificados en este timeline.

### Cambios — Backend Gestión

- **`modules/timeline/`** — nuevo módulo (DTO + controller). `GET /timeline/deudores/:id` protegido por `deudores.ver`. Si el deudor no tiene documento → devuelve vacío sin llamar a Sender.
- **`email-sender/sender-http.client.ts`** — método `timelinePorDocumento(documento, query)` + tipos `SenderTimelineEntry/Response/Query`. El cliente HTTP ahora se exporta desde `EmailSenderModule` para reuso entre módulos.
- **`email-sender/email-sender.service.ts`** — al enviar email pasa `deudorDocumento` para que Sender pueda linkear `ContactoEmail.deudorId` (sino el envío queda sin match y no aparece en el timeline).

### Cambios — Frontend Gestión

- **`components/deudores/TimelineDeudorTab.tsx`** — nuevo componente. Filtros canal/desde/hasta + selector "Por página" (5/10/20/50, default 5) para evitar scroll infinito en deudores con muchas acciones. Cards con borde izquierdo coloreado por canal, chip de estado, asunto/mensaje/URL/error/campaña según corresponda.
- **`components/deudores/TabsPanel.tsx`** — tab top-level "Timeline" (índice 3) junto a Datos/Lista/Política. Solo monta el componente cuando `selectedTab === 3` (no necesita guard `active`).
- **`components/deudores/ficha/FichaDeudor.tsx`** — removidos sub-tab "Emails" y sub-tab "Timeline" internos. El botón de enviar email del chip de contacto sigue funcionando vía `EnviarEmailDialog`.
- Eliminado `FichaEmailsTab.tsx` (huérfano).
- `api/timeline.ts` + `types/timeline.ts` nuevos.

### Notas

- Pagination ya existente (5/10/20/50 por página). Default 5 para que el tab no haga scroll infinito.
- Spec completa: `docs/timeline-spec.md`.
- Endpoint Sender: `GET /api/internal/timeline/por-documento/:documento` con scope `timeline:read` (ver changelog de Sender).
- Conversaciones WAPI entrantes y llamadas Neotel quedan fuera de scope (siguiente fase).

---

## [2026-05-11] — Contactos: UX de chips, validación de direcciones (Georef) y normalización en imports

### Decisión

Unificar el ciclo de vida de un contacto (alta manual + import + auditoría) bajo un único pipeline de normalización: teléfono → E.164, email → MX, dirección → nomenclatura canónica de Georef Argentina con filtros por localidad/provincia. La nomenclatura canónica (`MUÑIZ 683, Comuna 5, Ciudad Autónoma de Buenos Aires (CP 1182)`) pasa a ser la forma de almacenamiento estándar tanto en cargas manuales como en imports.

### Cambios — Frontend (ficha del deudor)

**`FichaContactosPanel.tsx` — sistema de chips tri-estado**
- Esquema de color por estado: `warning` (principal/dorado), `success` (WhatsApp/verde), `primary` (validado), `error` (no validado). `variant=filled` cuando hay estado distintivo o no validado, `outlined` cuando es validado neutro.
- En chips filled (principal/whatsapp), el label/iconos/delete-icon se fuerzan a `common.white` para evitar contraste roto en modo oscuro (sobreescribe `.MuiChip-label`/`.MuiChip-deleteIcon`/`.MuiChip-icon`).
- Iconos de estrella/whatsapp siempre coloreados (`warning.main`/`success.main`) cuando no están filled — antes se veían gris por default.
- Ordenamiento: `prioridad === 1` siempre se renderiza primero.
- Botón "copiar al portapapeles" movido **dentro del chip** para email/direccion/red_social (antes vivía fuera del Stack). Ya no abre confirm modal — copia directa.

**`AgregarContactoModal.tsx` — alta manual de direcciones**
- Botón "Validar Dirección" llama a Georef con `{ localidad, provincia }` separados (antes concatenaba en el texto y producía falsos positivos cuando la calle existía en otra localidad).
- Alert de resultado con JSX: muestra sugerencia con `<strong>{calle}</strong> en <strong>{loc}, {prov}</strong>` cuando Georef encontró match en otra localidad.
- Permite guardar como "no validada" si el usuario insiste (se persiste con `validado=false`).
- POST `/contactos` ahora envía `direccionLocalidad`, `direccionProvincia` y `direccionCp` para que el backend pueda validar con filtros y componer la forma canónica.

### Cambios — Backend (contactos)

**`contactos.service.ts`**
- `create()` y `update()` para `tipo='direccion'`: llaman `normalizarDireccionArgentina(valor, { localidad, provincia })`. Si valida → guardan `nomenclatura + " (CP X)"` y `validado=true`. Si no → guardan el texto crudo recortado con `validado=false` (ya no tiran 400 BadRequest — el usuario decide).
- `update()` cambia su shape de retorno a `{ before, after, deudorId }` para alimentar el snapshot del audit interceptor (igual patrón que `deudores.service`).
- `create()` para teléfono con `prioridad=1`: corre en transacción que primero hace `updateMany prioridad=null` en los otros tel/wapp del mismo deudor.

**`contactos.controller.ts` — resúmenes de auditoría humanos**
- `etiquetaTipo()`, `flagsContacto()`, `resumenUpdateContacto()`: en lugar de "Actualizó contacto 11" ahora dice "Marcó WhatsApp el teléfono +5491124624268", "Quitó principal del email x@y.com", "Editó dirección de Deudor X", etc.
- `@Audit` en update lee `before` para detectar diffs (whatsapp/prioridad/valor cambiados).

**`dtos/create-contacto.dto.ts`**
- Nuevos campos opcionales: `direccionLocalidad`, `direccionProvincia`, `direccionCp` (strings).

### Cambios — Backend (utils de dirección y email)

**`common/utils/direccion-utils.ts`**
- `DireccionFiltros = { provincia?, localidad? }` exportado.
- Aliases CABA (`capital federal`, `caba`, `ciudad autonoma de buenos aires`, `ciudad de buenos aires`) tratados como equivalentes vía `normalizarParaComparar()` (strip de acentos + minúsculas) y `coincideLocalidad()`.
- `callGeoref(direccionStr, filtros)` ahora usa `URLSearchParams` con `provincia=`/`localidad=` (antes concatenaba en el texto y daba falsos positivos).
- `intentarVariantes()` reintenta variaciones (sin abreviaturas, etc.) antes de declarar no encontrada.
- `normalizarDireccionArgentina(input, filtros)` valida match real de localidad antes de devolver `valido=true`. Si Georef devuelve resultado en otra localidad, expone `sugerencia` para que el UI ofrezca corrección.

### Cambios — Backend (imports)

**Nuevo helper `modules/imports/utils/contacto-import.ts`**
- `prepararContactoImport(data)` unifica la normalización de contactos entre los 3 processors (`contactos`, `enriquecimiento`, `deudores-facturas`).
- Acepta input `{ tipo, valor, direccion_calle, direccion_numero, direccion_cp, direccion_localidad, direccion_provincia }`. Devuelve `{ tipo, valor, validado } | null`.
- Cache in-memory (`Map`) por proceso para evitar llamar Georef/DNS-MX repetidas veces para el mismo dato dentro de una remesa grande.
- `clearContactoImportCaches()` para limpiar en `afterAll` de cada processor.

**Processors refactorizados**
- `contactos.processor.ts`: usa `prepararContactoImport()`. `validateRow` acepta direcciones aún sin `valor` cuando llegan estructuradas. `afterAll` limpia caches.
- `enriquecimiento.processor.ts`: mismo refactor.
- `deudores-facturas.processor.ts`: `upsertContacto(deudorId, data, ctx)` ahora delega al helper. Bloques de tipo `CONTACTO` se aceptan también cuando traen solo columnas estructuradas (calle/numero/loc/prov) sin `valor`.

**Comportamiento de almacenamiento**
- Si Georef valida → se guarda la `nomenclatura` canónica + `(CP X)` cuando hay CP. Mismo formato que las altas manuales.
- Si Georef no valida → se guarda texto compuesto (`calle numero, localidad, provincia (CP X)`) con `validado=false`. La fila no falla.

### Cambios — Frontend (imports y preview)

**`MappingEditor.tsx`**
- Categorías `CONTACTOS` y `ENRIQUECIMIENTO` ganan dest fields nuevos: `direccion_calle`, `direccion_numero`, `direccion_cp`, `direccion_localidad`, `direccion_provincia`.
- El usuario puede mapear direcciones de dos formas: (a) monolítica vía `valor`, (b) estructurada vía columnas separadas. Mezcla válida también (calle+numero+localidad+provincia con o sin CP).

**`PreviewTable.tsx`**
- Para bloques `CONTACTO` con `tipo=direccion`, el resumen se arma a partir de los campos estructurados: `calle numero, localidad, provincia (CP X)` cuando vienen mapeados; fallback al `valor` monolítico. Antes mostraba "DIRECCION: -" porque solo leía `data.valor`.

### Cambios — Frontend (auditoría)

**`AuditDiffView.tsx`**
- Bloque "Contexto/parámetros" migrado de `<pre style={{background:'#f5f5f5'}}>` (hardcoded) a `Box component="pre"` con `sx` theme-aware (`grey.900` en dark, `grey.100` en light). Soluciona contraste roto en modo oscuro.
- Nueva `limpiarExtra()`: filtra `undefined`/`null`/objetos vacíos/arrays vacíos antes de renderizar para no mostrar bloques con `{}`.

**`AuditoriaStream.tsx` + `AuditoriaBusqueda.tsx`**
- Drawer de detalle: en lugar de pasar solo `data.params` y `data.contexto` como `extra` (lo que dejaba la mayoría de las entradas vacías), pasa todas las claves de `data` excepto `before`/`after`:
  ```tsx
  extra={(() => {
    const { before: _b, after: _a, ...rest } = selected.data ?? {};
    return rest;
  })()}
  ```

### Bug fixes y micro-ajustes

- `AuditInterceptor.entidadIdFromResponse: 'after.id'` no funcionaba (el interceptor hace `result[opts.entidadIdFromResponse]` literal, sin resolver dot-paths). Workaround: usar `entidadIdParam: 'id'` desde el param de URL.
- `result?.deudorId` se resuelve en top-level del shape devuelto → los servicios refactorizados (`deudores`, `contactos`) hacen spread `{ before, after, deudorId: after.deudorId }`.

### Cómo retomar / verificar

1. Backend: `npm run start:dev` desde `backend/`. No requiere migración (no hay cambios de schema).
2. Frontend: `npm run dev` desde `frontend/`.
3. Probar alta manual de dirección con `(CP 1182)` y verificar que queda en formato canónico.
4. Probar import con bloque `CONTACTO` mapeando `direccion_calle/numero/cp/localidad/provincia` por separado: la preview debe mostrar el resumen compuesto, y al confirmar las direcciones deben guardarse normalizadas.
5. Truncado para repruebas:
   ```sql
   SET FOREIGN_KEY_CHECKS = 0;
   TRUNCATE `amsa-gestion`.`campoextra`;
   TRUNCATE `amsa-gestion`.`comentario`;
   TRUNCATE `amsa-gestion`.`contacto`;
   TRUNCATE `amsa-gestion`.`factura`;
   TRUNCATE `amsa-gestion`.`pago`;
   TRUNCATE `amsa-gestion`.`convenio`;
   UPDATE `amsa-gestion`.`transaccion` SET deudorId = NULL WHERE deudorId IS NOT NULL;
   TRUNCATE `amsa-gestion`.`deudor`;
   SET FOREIGN_KEY_CHECKS = 1;
   ```

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
