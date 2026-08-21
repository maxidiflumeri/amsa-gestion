# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repositorio

**AMSA Gestión** — sistema de cobranzas. Monorepo con dos apps:

- [backend/](backend/) — NestJS 11 + Prisma + MySQL + BullMQ/Redis + Socket.IO
- [frontend/](frontend/) — React 18 + Vite + MUI v5 + TypeScript + socket.io-client

Antes de tocar código, **leer [CHANGELOG.md](CHANGELOG.md)**. Es el registro narrativo de desarrollo, mantenido a mano, y la fuente principal de contexto para retomar trabajo (decisiones, estado actual de cada módulo, deuda técnica). Los specs vivos están en [docs/](docs/) (`neotel-spec.md`, `email-sender-spec.md`, `timeline-spec.md`, `dashboards-spec.md`, `reportes-dynamic-spec.md`, `auditoria-spec.md`, `notificaciones-spec.md`, `consolidacion-situacion-spec.md`, `pagos-promesas-spec.md`).

## Comandos

### Backend (`cd backend`)

```bash
npm run start:dev        # NestJS watch mode (puerto 3000, env PORT=3001 en .env.example)
npm run build            # nest build
npm run lint             # eslint --fix
npm test                 # jest (unit). Single test: npx jest path/al/archivo.spec.ts -t "nombre"
npm run test:e2e         # jest e2e config en test/jest-e2e.json
npm run test:cov         # coverage

# Prisma — IMPORTANTE: usar db push, NO migrate dev (hay drift histórico)
npx prisma db push       # sincroniza schema.prisma → MySQL
npx prisma generate      # regenera client
npx prisma db seed       # corre prisma/seed.ts (config en package.json → "prisma.seed")

# Seeds parciales (correr a mano según necesidad)
npx ts-node prisma/seed-empresas.ts
npx ts-node prisma/seed-parametros.ts
npx ts-node prisma/seed-telefonia.ts
npx ts-node prisma/seed-formatos-tel.ts
npx ts-node prisma/seed-codigos-curados.ts
```

### Frontend (`cd frontend`)

```bash
npm run dev      # vite dev server en localhost:5173 (strictPort)
npm run build    # vite build
npm run preview  # preview del build
```

No hay lint ni tests configurados en el frontend.

## Convenciones críticas (no negociables)

- **Prisma**: `prisma db push` siempre, **nunca** `prisma migrate dev`. La carpeta [backend/prisma/migrations/](backend/prisma/migrations/) existe pero está desactualizada por drift histórico — no generar migraciones nuevas ahí sin acordarlo.
- **Nombres de modelos Prisma**: están en **minúscula** (`deudor`, `usuario`, `empresa`, `comentario`, `agente_telefonia`, `sesion_agente_neotel`, etc.). No camelCase.
- **Prefijo API**: todos los endpoints van bajo `/api` (`app.setGlobalPrefix('api')` en [backend/src/main.ts](backend/src/main.ts)).
- **Validación global**: `ValidationPipe({ whitelist: false, transform: true })` está activo — todos los DTOs usan `class-validator`/`class-transformer`.
- **Logging**: usar `new Logger(ClassName.name)` de `@nestjs/common` (la app está cableada con `nest-winston` + archivos rotativos diarios vía `winston-daily-rotate-file`). Cada request HTTP tiene un `requestId` corto generado por `RequestContextService` (AsyncLocalStorage) que se inyecta automáticamente en cada log. Los workers BullMQ heredan el `requestId` del job que los disparó vía campo `_ctx` en el payload. No usar `console.log` en código de producción. El `LoggingInterceptor` global ya loguea cada request.
- **Idioma**: dominio en español (`deudor`, `remesa`, `convenio`, `comentario`, `politica`, etc.). Mantenerlo.

## Política de logging

Niveles: `error` (fallo externo, siempre con `.stack`), `warn` (degradado, permiso denegado, retry), `log` (acción de negocio iniciada/completada), `debug` (troubleshooting), `verbose` (trazas finas, apagado en prod).

Patrón intent/done en mutaciones: log antes de la operación con contexto (`deudorId`, `tipo`, etc.) y log después con resultado y tiempo (`en ${Date.now()-t0}ms`). Operaciones >500ms: siempre con tiempo.

Nunca loguear: tokens JWT completos, passwords/claves, credenciales SIP descifradas, body HTML de emails, DNI completo (usar `obfuscateDocumento`). Usar `sanitizeParams` de `src/common/logger/sanitize.ts` para limpiar objetos antes de loguear.

`NotFoundException`/`BadRequestException` de negocio → `warn`, no `error`. En workers BullMQ: rethrow después de loguear. Variables de entorno: `LOG_LEVEL`, `LOG_DIR`, `LOG_MAX_SIZE`, `LOG_RETENTION_DAYS` (ver `.env.example`).

## Arquitectura backend

Punto de entrada: [backend/src/main.ts](backend/src/main.ts) → [backend/src/app.module.ts](backend/src/app.module.ts) registra todos los módulos.

### Capas

```
src/
  main.ts                 # bootstrap, CORS, ValidationPipe, LoggingInterceptor, prefijo /api
  app.module.ts           # registro central de módulos + BullMQ root
  auth/                   # JWT + RBAC (catálogo de permisos en permisos-catalogo.ts)
  common/
    logger/               # Winston (LoggerService, LoggerModule)
    interceptors/         # LoggingInterceptor global, posible @Audit
    utils/
  prisma/                 # PrismaModule + PrismaService (cliente único inyectable)
  modules/
    deudores/ comentarios/ contactos/ convenios/ transacciones/
    empresas/ parametros/ politicas/ usuarios/ roles/
    imports/              # carga masiva (CSV/XLSX) con BullMQ + processors específicos
    reportes/             # query builder dinámico + ejecución sync/async + exportadores
    dashboards/           # métricas agregadas
    notificaciones/       # notificaciones in-app vía sockets
    realtime/             # Socket.IO gateway (/rt namespace, JWT en handshake)
    timeline/             # tab unificado de eventos del deudor (Gestión + Sender)
    email-sender/         # integración con AMSA Sender (envío + mapeo de variables)
    neotel/               # integración telefonía (CTI Neotel + SIP cifrado + WebRTC)
```

### Auth y RBAC

- **JWT** en [backend/src/auth/](backend/src/auth/). El token incluye `sub`, `email`, `rol`, `permisos[]`.
- **Permisos finos** declarados en [backend/src/auth/permisos-catalogo.ts](backend/src/auth/permisos-catalogo.ts) (estructura: secciones → claves tipo `deudores.ver`, `convenios.cancelar`, `telefonia.usar`, etc.). Se aplican con `PermisosGuard` y decoradores en los controllers.
- El mismo JWT autentica también las conexiones Socket.IO (verificado en `handleConnection` del gateway).

### Background jobs (BullMQ + Redis)

`BullModule.forRoot` en `app.module.ts` lee `REDIS_HOST`/`REDIS_PORT`. Workers actuales:

- **Imports**: [backend/src/modules/imports/processors/](backend/src/modules/imports/processors/) — un processor por tipo de archivo (`deudores`, `facturas`, `pagos`, `contactos`, `actualizaciones`, `deudores-facturas`, `enriquecimiento`). Registry en `processor-registry.ts`.
- **Reportes async**: [backend/src/modules/reportes/async/](backend/src/modules/reportes/async/) — `async-executor.service.ts` decide sync vs async según `REPORTES_SYNC_THRESHOLD`. Streaming con cursor de Prisma, chunk `REPORTES_V2_CHUNK_SIZE`, hard limit `REPORTES_V2_HARD_LIMIT`.
- **Neotel state**: [backend/src/modules/neotel/neotel-redis.service.ts](backend/src/modules/neotel/neotel-redis.service.ts) usa Redis (ioredis, dependencia transitiva de BullMQ) para cachear sesión/estado del agente (`neotel:agente:{id}:sesion` y `:estado`). Modo degradado si Redis no responde.

### Realtime (Socket.IO)

Gateway principal en [backend/src/modules/realtime/realtime.gateway.ts](backend/src/modules/realtime/realtime.gateway.ts), namespace `/rt`. Auth por JWT en `handshake.auth.token`. Se usa para notificaciones in-app y eventos de progreso (importaciones, reportes). El módulo Neotel agrega su propio namespace (ver spec).

### Módulo Neotel (telefonía)

Spec completo: [docs/neotel-spec.md](docs/neotel-spec.md). Plan de fases: [docs/NEOTEL_INTEGRATION_PLAN.md](docs/NEOTEL_INTEGRATION_PLAN.md).

- **Cliente HTTP**: `neotel-http.client.ts` wrappea la API ASMX de Neotel (retry exponencial, timeout, sanitización de campos sensibles).
- **Credenciales SIP**: cifradas con AES-256-GCM (`crypto/sip-crypto.service.ts`). Clave en `NEOTEL_SIP_ENCRYPTION_KEY`. Script idempotente para migrar plain-text → cifrado: `npx ts-node --transpile-only prisma/scripts/encrypt-sip-passwords.ts` (acepta `--dry-run`).
- **ABM de agentes** se gestiona desde `PATCH /usuarios/:id` (no desde el controller de Neotel — ver CHANGELOG 2026-05-13).
- **Sesión/estado/campaña**: `sesion-agente.service.ts`, `estado-agente.service.ts`, `campaña-agente.service.ts`. Patrón: validar → llamar API Neotel → persistir en DB → cachear en Redis.

## Arquitectura frontend

Punto de entrada: [frontend/src/main.tsx](frontend/src/main.tsx) → [App.tsx](frontend/src/App.tsx) → [routes/AppRoutes.tsx](frontend/src/routes/AppRoutes.tsx).

```
src/
  api/          # clientes HTTP (axios) por dominio
  components/
    auth/ common/ deudores/ email/ feedback/ import/ layout/ ui/
  context/      # React Context (auth, theme, etc.)
  hooks/
  pages/        # una page por ruta (admin/, ajustes/, auditoria/, dashboards/, reportes/, ...)
  routes/       # AppRoutes.tsx (rutas) + PrivateRoute.tsx (guard JWT)
  theme/        # MUI theme (dark/light)
  types/
```

Layout principal: `AppShell` (sidebar + topbar). Todas las rutas protegidas están anidadas bajo `<PrivateRoute><AppShell /></PrivateRoute>`. Sockets via `socket.io-client` con namespace `/rt`.

UI con MUI v5. Editor rico con Tiptap (plantillas de email). Tablas/listas con MUI X. Drag & drop con `@dnd-kit`. Charts con Recharts.

## Variables de entorno (backend)

Plantilla en [backend/.env.example](backend/.env.example). Críticas:

- `DATABASE_URL` — MySQL
- `PORT` (default 3000 si no se define)
- `REDIS_HOST` / `REDIS_PORT` — usado por BullMQ y Neotel Redis cache
- `JWT_SECRET` — firma de tokens (también usado por el gateway Socket.IO)
- `REPORTES_SYNC_THRESHOLD` / `CHUNK_SIZE` / `HARD_LIMIT` / `STORAGE_PATH` / `RETENTION_DAYS`
- `NEOTEL_API_HOST` / `NEOTEL_TIMEOUT_MS` / `NEOTEL_RETRY_ATTEMPTS` / `NEOTEL_SIP_DOMAIN` / `NEOTEL_WSS_URL`
- `NEOTEL_SIP_ENCRYPTION_KEY` — `openssl rand -hex 32`. Rotarla obliga a re-correr `encrypt-sip-passwords.ts`.

## Tips operativos

- **Drift en Prisma**: si `db push` se queja de columnas/índices que no entiende, alinear con la DB real antes de tocar el schema; no resolver con `migrate reset` (la DB tiene datos reales). Hay scripts puntuales en [backend/prisma/scripts/](backend/prisma/scripts/) y [backend/prisma/migrate-permisos-v2.sql](backend/prisma/migrate-permisos-v2.sql).
- **CORS** permite `localhost:5173`, `localhost:3000` y `amsasender.anamayasa.com` (ver `main.ts`).
- **CHANGELOG.md decay**: la primera entrada es la más reciente. Cuando termines una unidad de trabajo significativa, agregá una entrada con fecha y secciones Backend/Frontend siguiendo el formato existente.
