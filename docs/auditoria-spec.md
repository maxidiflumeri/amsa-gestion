# Auditoría / Transacciones — Spec Integral

**Fecha:** 2026-05-11
**Estado:** Aprobado para implementación
**Módulo base existente:** `backend/src/modules/transacciones/`

---

## 1. Objetivo

Toda acción relevante de la plataforma debe quedar registrada en una bitácora **inmutable**, consultable y exportable, con visualización gráfica en frontend. La tabla `transaccion` es el único Source-of-Record de auditoría.

**Cobertura objetivo: 100%** de modificaciones (create/update/delete) más eventos de seguridad (login OK/fail, logout, permiso denegado) y jobs asíncronos (BullMQ).

---

## 2. Decisiones tomadas

| # | Decisión | Implicancia |
|---|----------|-------------|
| 1 | 100% de modificaciones auditadas | Sin excepciones por granularidad |
| 2 | Login fallido + logout también se auditan | Eventos AUTH |
| 3 | `usuarioId` nullable | `null` = "sistema" (jobs, seeds, cron) |
| 4 | Retención indefinida | No se implementa F5 (cleanup) |
| 5 | `empresaId` nullable en `transaccion` | Filtrado multi-tenant |
| 6 | Reportes: A + B | A = `transaccion` como raíz en builder. B = botón export en `/auditoria`. |

---

## 3. Schema (Prisma)

### 3.1 Cambios en `transaccion`

```prisma
model transaccion {
  id          Int       @id @default(autoincrement())
  createdAt   DateTime  @default(now())

  // Actor
  usuarioId   Int?      // nullable: null = sistema
  empresaId   Int?      // multi-tenant (nullable: acción global)

  // Clasificación
  modulo      String    // enum lógico: GESTION | IMPORT | REPORTES | ADMIN | AUTH | SISTEMA
  entidad     String    // "Deudor" | "Contacto" | "Convenio" | ...
  entidadId   String?
  tipo        String    // "CREATE" | "UPDATE" | "DELETE" | "EJECUTAR" | "LOGIN_OK" | "LOGIN_FAIL" | ...
  severidad   String    @default("INFO") // INFO | WARN | ERROR
  estado      String    @default("OK")   // OK | FALLIDO

  // Contexto
  deudorId    Int?
  recursoTexto String?  // descripción human-friendly del recurso ("Comentario id=42 de deudor 7")
  resumen     String?
  data        Json?     // { before?, after?, params?, contexto? }

  // Red
  ip          String?
  userAgent   String?

  // Relaciones
  usuario   usuario? @relation(fields: [usuarioId], references: [id], map: "Transaccion_usuarioId_fkey")
  empresa   empresa? @relation(fields: [empresaId], references: [id], map: "Transaccion_empresaId_fkey")
  deudor    deudor?  @relation(fields: [deudorId], references: [id], map: "Transaccion_deudorId_fkey")

  @@index([createdAt])
  @@index([modulo, createdAt])
  @@index([empresaId, createdAt])
  @@index([usuarioId, createdAt], map: "Transaccion_usuarioId_createdAt_idx")
  @@index([deudorId, createdAt], map: "Transaccion_deudorId_createdAt_idx")
  @@index([entidad, entidadId], map: "Transaccion_entidad_entidadId_idx")
  @@index([tipo, createdAt], map: "Transaccion_tipo_createdAt_idx")
  @@index([severidad, createdAt])
  @@index([estado, createdAt])
}
```

### 3.2 TS enums espejo (no DB enums — flexible)

```ts
// backend/src/modules/transacciones/audit.enums.ts
export enum AuditModulo {
  GESTION = 'GESTION',
  IMPORT = 'IMPORT',
  REPORTES = 'REPORTES',
  ADMIN = 'ADMIN',
  AUTH = 'AUTH',
  SISTEMA = 'SISTEMA',
}

export enum AuditTipo {
  CREATE, UPDATE, DELETE, EJECUTAR,
  LOGIN_OK, LOGIN_FAIL, LOGOUT, PERMISO_DENEGADO,
  IMPORT_START, IMPORT_OK, IMPORT_FAIL,
  REPORTE_EJECUTAR, REPORTE_DESCARGAR,
  ROL_CAMBIO, USUARIO_ALTA, USUARIO_BAJA, USUARIO_PWD_RESET,
}

export enum AuditSeveridad { INFO, WARN, ERROR }
export enum AuditEstado { OK, FALLIDO }
```

### 3.3 Forma canónica de `data`

```ts
type AuditData = {
  before?: Record<string, any>;
  after?: Record<string, any>;
  params?: Record<string, any>;
  contexto?: Record<string, any>;
};
```

---

## 4. Catálogo de eventos (cobertura 100%)

| Módulo | Entidad | Tipos |
|--------|---------|-------|
| GESTION | Deudor | UPDATE (estado, codigos), DELETE |
| GESTION | Comentario | CREATE, DELETE |
| GESTION | Contacto | CREATE, UPDATE, DELETE |
| GESTION | Convenio | CREATE, UPDATE, DELETE |
| GESTION | Politica | CREATE, UPDATE, DELETE |
| GESTION | Empresa | CREATE, UPDATE, DELETE |
| GESTION | Parametro | CREATE, UPDATE, DELETE |
| ADMIN | Usuario | USUARIO_ALTA, USUARIO_BAJA, USUARIO_PWD_RESET, UPDATE |
| ADMIN | Rol | CREATE, UPDATE (incluye cambios `permisos`), DELETE |
| IMPORT | PlantillaImport | CREATE, UPDATE, DELETE |
| IMPORT | Import | IMPORT_START, IMPORT_OK, IMPORT_FAIL |
| REPORTES | PlantillaReporte | CREATE, UPDATE, DELETE |
| REPORTES | EjecucionReporte | REPORTE_EJECUTAR, REPORTE_DESCARGAR |
| AUTH | Sesion | LOGIN_OK, LOGIN_FAIL, LOGOUT, PERMISO_DENEGADO |
| SISTEMA | Job | (jobs de BullMQ) |

---

## 5. Permisos

Agregar al catálogo (`frontend/src/utils/permisosCatalogo.ts` + RBAC backend):

- `auditoria.ver` — ve solo sus propias acciones (`usuarioId = self`).
- `auditoria.ver_todos` — ve todas las acciones.
- `auditoria.exportar` — exporta xlsx/csv/pdf.

El controller filtra automáticamente por `empresaId` del usuario y por `usuarioId = self` si no tiene `auditoria.ver_todos`.

---

## 6. Backend — API

### 6.1 Endpoints

```
GET    /transacciones              — listado paginado con filtros
GET    /transacciones/stats        — agregados para dashboard
GET    /transacciones/:id          — detalle (con diff)
POST   /transacciones/export       — export xlsx/csv/pdf (perm: auditoria.exportar)
```

### 6.2 Filtros (query)

`desde`, `hasta`, `modulo`, `entidad`, `entidadId`, `tipo`, `severidad`, `estado`, `usuarioId`, `deudorId`, `empresaId`, `q` (full-text en resumen/recursoTexto), `limit`, `offset`, `orderBy`.

### 6.3 Stats (dashboard)

```jsonc
{
  "totales": { "hoy": 1234, "semana": 8765, "mes": 30000 },
  "porModulo": [{ "modulo": "GESTION", "count": 1234 }, ...],
  "porTipo":   [{ "tipo": "UPDATE", "count": 800 }, ...],
  "porUsuario":[{ "usuarioId": 7, "nombre": "...", "count": 320 }, ...],
  "seriePorDia": [{ "fecha": "2026-05-01", "count": 420 }, ...],
  "fallidos":  { "ultimas24h": 12, "topMotivos": [...] }
}
```

---

## 7. AuditInterceptor — Refactor

### 7.1 Bugs/mejoras a corregir

- **Bug crítico:** `req.user?.id ?? 1` → reemplazar por `req.usuario?.sub ?? null` (alineado con `JwtAuthGuard` actual). Sin fallback a `1`.
- Resolver `empresaId` desde `req.usuario?.empresaId` (o claim equivalente).
- Soportar `modulo`, `severidad`, `estado`, `recursoTexto` en `AuditOptions`.
- Soportar captura `before` para UPDATE/DELETE (callback `beforeHook(req)` opcional para snapshot pre-mutación).
- Si la acción throwea, registrar con `estado=FALLIDO` y `severidad=ERROR` (envolver con `catchError` además del `tap`).

### 7.2 Nuevo shape de `AuditOptions`

```ts
export interface AuditOptions {
  modulo: AuditModulo;
  entidad: string;
  tipo: AuditTipo | string;
  severidad?: AuditSeveridad;          // default INFO
  deudorIdParam?: string;
  entidadIdFromResponse?: string;
  entidadIdParam?: string;
  recursoTexto?: (result: any, req: any) => string;
  resumen?: (result: any, req: any) => string | undefined;
  data?: (result: any, req: any) => AuditData;
  before?: (req: any) => Promise<any> | any;
}
```

### 7.3 Helper para flujos no-HTTP (BullMQ, seeds)

```ts
// auditoria.helper.ts
@Injectable()
export class AuditoriaHelper {
  constructor(private tx: TransaccionesService) {}
  async log(evt: Omit<AuditOptions, 'before'> & { usuarioId?: number | null; empresaId?: number | null; ... }) { ... }
}
```

---

## 8. Frontend — `/auditoria`

### 8.1 Ruta y permiso

- Ruta: `/auditoria`
- Visible si tiene `auditoria.ver`
- Item en `SideNav` bajo "Administración"

### 8.2 Layout (3 tabs)

1. **Dashboard** (recharts)
   - KPIs: hoy / semana / mes / fallidos 24h
   - Bar chart: top usuarios
   - Pie: por módulo
   - Line: serie por día (30 días)
   - Top 5 entidades modificadas

2. **Stream** (timeline en vivo)
   - Lista cronológica reverse con avatar usuario, badge módulo/tipo, resumen, hover detalle
   - Auto-refresh 30s o polling on focus
   - Filtros laterales

3. **Búsqueda** (tabla)
   - DataGrid con todos los filtros
   - Click → drawer con `AuditDiffView` (before vs after)
   - Botón **Exportar** (xlsx/csv/pdf) si tiene `auditoria.exportar`

### 8.3 Componente reutilizable `AuditDiffView`

- Side-by-side de `data.before` vs `data.after`, highlight de campos cambiados (verde nuevo / rojo eliminado / amarillo modificado).
- Reutilizable desde la ficha de deudor ("Historial de cambios" → muestra timeline de transacciones filtradas por ese deudor).

---

## 9. Exportación de reportes

### 9.1 Opción A — `transaccion` como raíz en reportes-builder

- Agregar entry en catálogo de raíces del builder con campos: `createdAt, usuario.nombre, modulo, entidad, entidadId, tipo, severidad, estado, resumen, deudor.numeroCliente, empresa.nombre, ip`.
- Joins: `usuario`, `deudor`, `empresa`.
- Esto habilita reportes recurrentes/agendados sobre auditoría con el motor existente.

### 9.2 Opción B — Botón export ad-hoc en `/auditoria`

- Reutiliza exportadores `xlsx/csv/pdf` de reportes.
- Aplica los filtros activos en pantalla.
- Si > 50k filas, encola job async (BullMQ) y notifica por socket.

---

## 10. Fases de implementación

### F1 — Schema + Interceptor refactor (backend)
- Migrar schema `transaccion` (nuevos campos + nullable + índices).
- Crear `audit.enums.ts`.
- Refactor `AuditInterceptor` (fix bug, soporte before/after, estado FALLIDO).
- Crear `AuditoriaHelper` para flujos no-HTTP.
- Endpoints `GET /transacciones`, `/stats`, `/:id`, `POST /export`.
- Permisos `auditoria.ver`, `auditoria.ver_todos`, `auditoria.exportar`.
- Login interceptor para AUTH events.

### F2 — Cobertura 100% (@Audit en todos los controllers)
- comentarios ✓ (ya tiene)
- contactos ✓ (ya tiene)
- deudores: completar UPDATE codigos, DELETE
- convenios, politicas, empresas, parametros: CREATE/UPDATE/DELETE
- usuarios, roles: ABM + cambios de permisos
- imports, plantillas-import
- reportes-plantillas, ejecutar-reporte (incluye DESCARGAR)
- BullMQ workers: usar `AuditoriaHelper` para IMPORT_*, REPORTE_*

### F3 — Frontend `/auditoria`
- Página con 3 tabs (Dashboard/Stream/Búsqueda)
- `AuditDiffView`
- Integración recharts
- Link "Historial" en `FichaDeudor`

### F4 — Exports
- Opción A: registrar `transaccion` como raíz en catálogo reportes
- Opción B: botón export en `/auditoria`

### F5 — DEFERIDO (retención indefinida por decisión #4)

### F6 — Tests + docs
- Unit tests del interceptor (con/sin user, estado FALLIDO, before/after diff)
- Integration test de cobertura: smoke que verifica que cada @Audit registra fila esperada
- Actualizar este spec con ajustes finales
- CHANGELOG entry

---

## 11. Riesgos / consideraciones

- **Volumen:** sin retención, monitorear tamaño de tabla. Re-evaluar particionado MySQL si supera ~50M filas.
- **PII en `data`:** evitar guardar passwords; el helper debe redactar campos sensibles antes de persistir.
- **Performance UPDATE:** `before` hook lee la fila antes de mutar → +1 SELECT por endpoint auditado. Aceptable para el volumen actual.
- **Inmutabilidad:** la tabla NO debe tener endpoint de DELETE/UPDATE expuesto en API. Solo INSERT + SELECT.
