# Spec: Unificación y enriquecimiento del logging — AMSA Gestión backend

> Producido por el architect agent. Operativo, paso a paso.
> Decisiones del usuario (2026-05-18):
> - Retención: **14 días** (`LOG_RETENTION_DAYS=14`).
> - Formato consola: **`nestLike` coloreado siempre** (dev y prod).
> - Exclusiones del LoggingInterceptor: **ninguna por ahora**.
> - WebSocket: **un `requestId` por handler invocado** (más granular).

---

## 1. Audit del estado actual

### 1.1 Archivos que inyectan `LoggerService` (Winston propio, `src/common/logger/`)

- `src/modules/dashboards/dashboards.service.ts` (inyección presente, no se ve uso en el cuerpo visible).
- `src/modules/transacciones/transacciones.service.ts` (usado en `registrar()` con `this.logger.debug(..., 'TransaccionesService')`).

Wiring asociado:
- `src/common/logger/logger.service.ts`
- `src/common/logger/logger.module.ts`
- `src/main.ts` — `app.resolve(LoggerService)` para pasárselo al interceptor.
- `src/common/interceptors/logging.interceptor.ts` — recibe `LoggerService` por constructor.
- `src/app.module.ts` — importa `LoggerModule`.

### 1.2 Archivos que usan `new Logger(...)` de `@nestjs/common` (50 archivos)

Sin cambio de API, solo normalización donde sea necesario:
- `src/modules/neotel/neotel-http.client.ts` usa `new Logger('[NeotelHttpClient]')` (con corchetes) — emparejar al patrón `new Logger(NeotelHttpClient.name)`.

### 1.3 `console.*` directos (a reemplazar)

- `src/common/utils/direccion-utils.ts:84` → `console.error('API Georef falló en callGeoref:', err.message)`.
- `src/modules/imports/imports.service.ts:311` → `console.error("CSV ERROR:", parseErr)`.

### 1.4 Estado del `LoggingInterceptor`

Hoy:
- Loguea `➡️ METHOD url (user=X|anon)` antes.
- Loguea `⬅️ METHOD url - Nms` después (solo éxito).

Le falta:
- No genera `requestId`.
- No loguea status HTTP ni cuerpo de error en fallos (no hay `catchError`).
- Bug: lee `request.user.id`, pero el JWT decodificado vive en `req.usuario.sub` → siempre cae en `anon`.
- No diferencia latencia (debug <100ms vs warn >1s).

### 1.5 Quick wins (módulos con cobertura pobre)

- `deudores`, `contactos`, `empresas`, `parametros`, `politicas`, `roles`, `usuarios`: declaran logger pero casi no se usa en mutaciones.
- `dashboards.service.ts`: inyecta `LoggerService` y no lo usa.
- Exportadores de reportes: sin logs de tamaño/duración.
- `PrismaService`: log de conexión pero falta desconexión y try/catch en init.

---

## 2. Arquitectura nueva del logging

### 2.1 Estructura final de `src/common/logger/`

```
src/common/logger/
├── winston.config.ts             [CREAR]
├── request-context.ts            [CREAR]
├── request-context.module.ts     [CREAR]
├── sanitize.ts                   [CREAR]
├── logger.service.ts             [BORRAR]
└── logger.module.ts              [BORRAR]
```

Y:

```
src/common/interceptors/
├── logging.interceptor.ts        [REESCRIBIR]
└── request-context.interceptor.ts [CREAR]
```

### 2.2 Wiring exacto

**`main.ts`:**
- Antes de `NestFactory.create`, construir el logger Winston con `WinstonModule.createLogger(winstonConfig())`.
- `NestFactory.create(AppModule, { bufferLogs: true, logger: WinstonModule.createLogger(winstonConfig()) })`.
- Después: `app.useLogger(app.get(WINSTON_MODULE_NEST_PROVIDER))`.
- Quitar `app.resolve(LoggerService)`.
- Registrar globalmente `RequestContextInterceptor` **antes** que `LoggingInterceptor`.

**`app.module.ts`:**
- Reemplazar `LoggerModule` por `WinstonModule.forRoot(winstonConfig())` + `RequestContextModule` (`@Global()`).
- Orden recomendado de imports: `ConfigModule.forRoot({isGlobal:true})` → `WinstonModule.forRoot(...)` → `RequestContextModule` → `PrismaModule` → `BullModule.forRoot(...)` → resto.

### 2.3 `RequestContextService` (AsyncLocalStorage)

**Archivo:** `src/common/logger/request-context.ts`

**API:**
```ts
class RequestContextService {
  private readonly als = new AsyncLocalStorage<RequestContext>();

  run(ctx: RequestContext, fn: () => Promise<any>): Promise<any>
  get(): RequestContext | undefined
  getRequestId(): string | undefined
  getUserId(): number | undefined
  child(extra: Partial<RequestContext>): RequestContext
}

interface RequestContext {
  requestId: string;       // nanoid de 8 chars
  usuarioId?: number;
  ip?: string;
  userAgent?: string;
  source: 'http' | 'ws' | 'bull' | 'cron';
  jobId?: string;
  queue?: string;
}
```

**Dónde se setea:**

1. **HTTP:** `RequestContextInterceptor` global. Genera `requestId` con `nanoid(8)`, lee `req.usuario?.sub`, ejecuta `requestContext.run({...}, () => next.handle().toPromise())`. Setea header `X-Request-Id` en la response.

2. **Socket.IO:** wrappear `handleConnection` y cada `@SubscribeMessage` en `requestContext.run({...source:'ws'...}, ...)`. **Un requestId por handler invocado**, no por conexión.

3. **BullMQ:**
   - En el `queue.add(...)` del service: incluir `_ctx: ctx ? { requestId: ctx.requestId, usuarioId: ctx.usuarioId } : undefined` en el payload.
   - En el processor: wrappear `process(job)`:
     ```
     const parentCtx = job.data?._ctx;
     const ctx: RequestContext = {
       requestId: parentCtx?.requestId ?? nanoid(8),
       usuarioId: parentCtx?.usuarioId,
       source: 'bull',
       jobId: String(job.id),
       queue: job.queueName,
     };
     return this.requestContext.run(ctx, () => this.realProcess(job));
     ```

### 2.4 Formato

**Consola (`nest-winston`):**
```
format: utilities.format.nestLike('AMSA', { prettyPrint: true, colors: true })
```
Con un `format()` propio anteponiendo `[reqId=… u=…]` al mensaje **solo si el contexto existe**.

Ejemplo:
```
[AMSA] 8528  - 18/05/2026 14:32:11   LOG [HTTP] [reqId=a8c12d3f u=42] POST /api/convenios 201 18ms
[AMSA] 8528  - 18/05/2026 14:32:11   LOG [ConveniosService] [reqId=a8c12d3f u=42] Creando convenio tipo=AUTO deudor=9871
```

**Archivo (JSON estructurado):**
```json
{
  "timestamp": "2026-05-18T14:32:11.234-03:00",
  "level": "info",
  "context": "ConveniosService",
  "requestId": "a8c12d3f",
  "usuarioId": 42,
  "source": "http",
  "message": "Convenio creado id=415 cuotas=6 deudor=9871",
  "pid": 8528,
  "hostname": "..."
}
```

### 2.5 Configuración de transports

`src/common/logger/winston.config.ts` exporta `winstonConfig(): WinstonModuleOptions`:

- `level`: `process.env.LOG_LEVEL ?? 'log'`.
- Transports:
  1. `Console` con format nestLike + requestId.
  2. `DailyRotateFile` → `${LOG_DIR}/combined-%DATE%.log`, JSON, retención `${LOG_RETENTION_DAYS}d`, `maxSize: LOG_MAX_SIZE`, `zippedArchive: true`.
  3. `DailyRotateFile` → `${LOG_DIR}/error-%DATE%.log`, level error, mismas opciones.
- `LOG_DIR` default `./logs`.
- `exitOnError: false`.
- `exceptionHandlers` → `${LOG_DIR}/exceptions-%DATE%.log`.
- `rejectionHandlers` → idem para unhandledRejection.

### 2.6 BullMQ — patrón

Aplicar en: `imports.processor.ts`, `reportes/async/reportes.processor.ts`. Encolado correspondiente en `imports.service.ts` y `reportes/async/async-executor.service.ts` (o donde se haga `queue.add`).

---

## 3. Política y guidelines (copiar a CLAUDE.md)

### 3.1 Niveles

| Nivel | Cuándo | Ejemplo |
|---|---|---|
| `error` | Excepción no esperada o fallo externo no recuperado. Siempre con stack. | `Login Google: verifyIdToken falló` con stack. SMTP de Sender tras retries. |
| `warn` | Degradado, retry, permiso denegado, condición rara pero esperable. | Usuario inactivo intentando login. Redis no responde en NeotelRedis. Job stalled. |
| `log` (info) | Acción de negocio iniciada o completada. Default operativo. | "Convenio 415 creado (deudor=9871, cuotas=6)". |
| `debug` | Información para troubleshooting puntual. | "Query planner: definicion=… joins=3". |
| `verbose` | Trazas finas. Apagado en prod salvo necesidad. | "Procesando fila 1234 de remesa…". |

### 3.2 Qué NUNCA loguear

- Tokens JWT enteros (solo prefijo `tok=eyJh…`).
- idToken Google: solo `email` resultante.
- Passwords / `CLAVE` / API keys / `X-Internal-Api-Key`.
- Credenciales SIP descifradas.
- Body completo de emails.
- DNI/documento completo → ofuscar a `XX.XXX.123`.
- Body completo de `data:` de auditoría → usar `sanitizeParams`.

### 3.3 Patrón intent/done

```ts
async crearConvenio(dto) {
  this.logger.log(`Creando convenio tipo=${dto.tipo} deudor=${dto.deudorId} cuotas=${dto.cantCuotas}`);
  const t0 = Date.now();
  try {
    const c = await this.prisma.convenio.create(...);
    this.logger.log(`Convenio creado id=${c.id} en ${Date.now() - t0}ms`);
    return c;
  } catch (err) {
    this.logger.error(`Crear convenio falló deudor=${dto.deudorId}: ${err.message}`, err.stack);
    throw err;
  }
}
```

Operaciones >500ms: **siempre** intent + done con tiempo.

### 3.4 Errores

- Mensaje legible en español + contexto entre paréntesis.
- Stack como segundo arg: `this.logger.error(msg, err.stack)`.
- `NotFoundException`/`BadRequestException` de negocio → `warn`, no `error`.
- En workers BullMQ: rethrow después de loguear.

### 3.5 Sanitización (`src/common/logger/sanitize.ts`)

- `sanitizeParams(obj, sensitiveKeys?)` → copia con `[REDACTED]` en claves sensibles. Default: `password`, `clave`, `token`, `apiKey`, `idToken`, `authorization`, `data`, `xml_update` (case-insensitive).
- `obfuscateDocumento(doc)` → `XX.XXX.123`.
- `obfuscateEmail(email)` → `m***@gmail.com`.

`neotel-http.client.ts` deja su `redactSensitive` privado y usa `sanitizeParams`.

---

## 4. Plan por módulo

### 4.1 `auth/`
- `auth.service.ts`: `log` "Login Google: validando idToken email=…" ofuscado. Normalizar "Login OK usuarioId=X email=… rol=…". `error` con stack en catch alrededor de `client.verifyIdToken`. `getMe` pasa a `debug`.
- `permisos.guard.ts`: `warn` con `permisoRequerido`, `permisosUsuario`, `ruta` al denegar.

### 4.2 `prisma/prisma.service.ts`
- `log` "PrismaService desconectado" en `onModuleDestroy`.
- `error` con stack si `$connect()` falla en `onModuleInit`.
- Opcional: hook `$on('query', …)` controlado por `LOG_PRISMA_QUERIES=true`.

### 4.3 `modules/deudores/`
- Agregar `Logger` en `deudores.service.ts`.
- `log` intent+done en `create`, `update`, `delete`, cambios de estado, con `deudorId`, `empresaId`.
- `debug` en `findAll` con filtros.

### 4.4 `modules/comentarios/`
- Verificar intent+done en `crear`, `actualizar`, `eliminar` con `comentarioId`, `deudorId`, `usuarioId`.

### 4.5 `modules/convenios/`
- Agregar tiempo transcurrido al `log` de "convenio creado".
- `error` con stack en catches que hoy hacen rethrow sin loguear.

### 4.6 `modules/transacciones/`
- `transacciones.service.ts`: quitar inyección de `LoggerService`, usar `new Logger(TransaccionesService.name)`. Ajustar `this.logger.debug(..., 'TransaccionesService')` → `this.logger.debug(...)`.
- `auditoria.helper.ts`: cualquier fallo al persistir auditoría → `error` con stack (no debe romper flujo).

### 4.7 `modules/contactos/`
- Agregar `Logger`. Logs en CRUD con `contactoId`, `deudorId`.

### 4.8 `modules/empresas/`
- Agregar `Logger`. Logs en CRUD con `empresaId`, `nombre`.

### 4.9 `modules/parametros/`
- Agregar `Logger`. Logs en CRUD con `grupo`, `clave`, `categoria`.
- `warn` al borrar parámetro referenciado (si la lógica lo controla).

### 4.10 `modules/politicas/`
- Verificar logs en `aplicarPolitica`, CRUD.
- Si hay job/cron: `log` "evaluación iniciada/finalizada con N reglas".

### 4.11 `modules/usuarios/`
- `usuarios.service.ts`: logs en `crear`, `actualizar` (especialmente `agente_telefonia` upsert), `desactivar`. `warn` al desactivar usuario con sesión Neotel activa.
- `usuarios.controller.ts`: quitar logs duplicados con el interceptor.

### 4.12 `modules/roles/`
- Logs en CRUD con `rolId`, `nombre`, `cantidadPermisos`.

### 4.13 `modules/imports/`
- `imports.service.ts`: reemplazar `console.error` en línea 311. Agregar `_ctx` al `queue.add(...)`. `log` intent al iniciar import con `remesaId`, `tipo`, `archivoOriginalName`, `usuarioId`. `log` done con totales y duración.
- `imports/bullmq/imports.processor.ts`: wrap `process()` en `requestContext.run(...)`. Log con `remesaId` y `usuarioId`. `error` con `.stack`.
- `imports/processors/*.processor.ts`: agregar `Logger` por archivo. `debug` "Procesando N filas". `verbose` por fila (si `LOG_LEVEL=verbose`). `log` resumen. `warn` por error de validación.

### 4.14 `modules/reportes/`
- `reportes.service.ts`/`reportes.controller.ts`: logs en `ejecutarSync`, `encolarAsync` con `plantillaId`, `formato`, decisión, umbral.
- `async/reportes.processor.ts`: wrap en `requestContext.run` con `ejecucionId` y `usuarioId`.
- `async/async-executor.service.ts`: `debug` "executeStreaming raiz=… chunkSize=… hardLimit=…". `verbose` por chunk. `warn` si supera `hardLimit`.
- `ejecuciones/ejecuciones.cleanup.ts`: `log` resumen.
- `storage/reportes-storage.service.ts`: `log` al guardar/borrar con tamaño.
- `exportadores/*.exportador.ts`: `debug` "generando XLSX: N filas, M columnas, en Tms".
- `planner/*.ts`, `executor/*.ts`: solo `debug`, no `info`.
- `gateway/reportes.gateway.ts`: `log` conexión/desconexión. `debug` cada emit.

### 4.15 `modules/dashboards/`
- `dashboards.service.ts`: quitar inyección `LoggerService`, usar `new Logger(DashboardsService.name)`. Logs en `snapshot` y `drillDown` con duración. `warn` si `RANGO_MAX_DIAS` se aproxima.

### 4.16 `modules/notificaciones/`
- `debug` al emitir contadores (no `log`).

### 4.17 `modules/realtime/`
- `realtime.gateway.ts`: envolver `handleConnection` y `@SubscribeMessage` en `requestContext.run` con `source:'ws'`.
- Normalizar formato de rechazo: `Conexión WS rechazada motivo=… clientId=…`.
- `realtime.service.ts`: `debug` en cada `emit`. `warn` con `room`/`evento` en errores.

### 4.18 `modules/timeline/`
- `debug` en `getTimeline` con `deudorId`, `filtros`.

### 4.19 `modules/email-sender/`
- `email-sender.service.ts`: `log` intent "Enviando email template=X destinatarios=N empresa=…". `log` done con totales. `error` con stack si falla tras retries. **No loguear** body HTML.
- `sender-http.client.ts`: `debug` por request con método+URL (usar `sanitizeParams`). `log` init con `baseURL` y `timeout`.

### 4.20 `modules/neotel/`
- `neotel-http.client.ts`: `new Logger(NeotelHttpClient.name)`. Mover `redactSensitive` a `sanitize.ts`. `warn` en cada retry.
- `sesion-agente.service.ts`: tiempo transcurrido en "Sesión Neotel creada".
- `estado-agente.service.ts`: verificar `log` con `usuarioId`, `estadoAnterior`, `estadoNuevo`.
- `campaña-agente.service.ts`: `error` con stack en fallos.
- `agente-telefonia.service.ts`: `log` en CRUD con `usuarioId`, `extension`.

### 4.21 `common/utils/direccion-utils.ts`
- Reemplazar `console.error` por `new Logger('GeorefUtil').error(...)` con `err.stack`.

---

## 5. Cambios en env y CLAUDE.md

### 5.1 `backend/.env.example` — agregar:
```
# === Logging ===
LOG_LEVEL=log
LOG_DIR=./logs
LOG_MAX_SIZE=20m
LOG_RETENTION_DAYS=14
LOG_PRISMA_QUERIES=false
```

### 5.2 `backend/.env`
- Agregar las mismas claves. Para dev local: `LOG_LEVEL=debug`.

### 5.3 `CLAUDE.md`
- Sección nueva **"Política de logging"** después de "Convenciones críticas" (8-15 líneas resumiendo §3).
- Reemplazar la línea actual sobre `LoggerService` por:
  > **Logging**: usar `new Logger(ClaseName)` de `@nestjs/common` (la app está cableada con `nest-winston` + archivos rotativos vía `winston-daily-rotate-file`). Cada request HTTP tiene un `requestId` corto en `RequestContextService` (AsyncLocalStorage) que se inyecta automáticamente en cada log. Ver sección "Política de logging" debajo. No usar `console.log` en código de producción.

---

## 6. Plan de migración

**Paso 1 — Dependencias**
- `cd backend && npm i winston-daily-rotate-file nanoid@3`.

**Paso 2 — Capa nueva**
- Crear `src/common/logger/winston.config.ts` y `src/common/logger/sanitize.ts`.

**Paso 3 — RequestContext**
- Crear `src/common/logger/request-context.ts`, `request-context.module.ts`, `src/common/interceptors/request-context.interceptor.ts`.

**Paso 4 — Bootstrap**
- `main.ts`: `WinstonModule.createLogger` + `bufferLogs:true` + `useLogger(WINSTON_MODULE_NEST_PROVIDER)`. Registrar `RequestContextInterceptor` antes que `LoggingInterceptor`.
- `app.module.ts`: reemplazar `LoggerModule` por `WinstonModule.forRoot(winstonConfig())` + `RequestContextModule`.

**Paso 5 — `LoggingInterceptor`**
- Reescribir con `new Logger('HTTP')`, `RequestContextService` inyectado, latencia, status, `req.usuario.sub`, `catchError`.

**Paso 6 — Reemplazar `LoggerService`**
- `dashboards.service.ts` y `transacciones.service.ts`: quitar inyección, usar `new Logger(...)`.

**Paso 7 — Borrar logger viejo**
- Borrar `logger.service.ts` y `logger.module.ts`. Limpiar imports residuales (`grep -rn "common/logger/logger" src/`).

**Paso 8 — `console.*`**
- Reemplazar en `direccion-utils.ts` y `imports.service.ts:311`.

**Paso 9 — Propagación BullMQ**
- `imports.service.ts`: `_ctx` en `queue.add`. `imports.processor.ts`: wrap en `requestContext.run`.
- `reportes/async/...`: idem.

**Paso 10 — Pasada por módulo**
- Recorrer sección 4. Normalizar `[NeotelHttpClient]` → `NeotelHttpClient.name`. Extraer `redactSensitive` a `sanitize.ts`.

**Paso 11 — Env y docs**
- `.env.example`, `.env` local, `CLAUDE.md`.

**Paso 12 — Smoke test**
1. `npm run build` limpio.
2. `npm run start:dev`.
3. Consola con formato `[AMSA]` colorizado.
4. Request a `/api/auth/me` → `[reqId=xxxxxxxx u=N]` aparece.
5. `backend/logs/combined-YYYY-MM-DD.log` existe, JSON parseable.
6. Import chico → log del processor con `[reqId=...]` propagado.
7. Reporte async → idem en `reportes.processor.ts`.
8. 404 (`/api/no-existe`) → interceptor loguea con status.
9. WS conexión → logs con `requestId` propio.
10. `grep -rn "console\." src/` no encuentra residuales.

---

## 7. Riesgos

- `bufferLogs:true` requiere que `useLogger` se llame siempre.
- `req.user` → `req.usuario.sub`: verificar que ningún decorator/guard dependa del nombre viejo.
- `nanoid` v5 es ESM-only; usar v3 si el backend está en CommonJS (verificar `tsconfig`).
- `winston-daily-rotate-file` necesita permisos write en `LOG_DIR`.
- AsyncLocalStorage: callbacks fuera de la promise chain pierden el contexto (revisar `imports.service.ts` ~647).
- `OAuth2Client.verifyIdToken` sin try/catch hoy — al agregar logs, rethrow después de loguear.
- JSON de archivos no debe colisionar con logrotate del sistema.
