# Consolidación automática del código de situación según pagos

**Proyecto:** AMSA Gestión
**Módulos involucrados:** `deudores`, `imports` (processors), nuevo `consolidacion`, `realtime`, `notificaciones`, `permisos-catalogo`
**Fecha:** 2026-06-30
**Estado:** Aprobado para implementación

---

## 0. Resumen ejecutivo

Hoy, ningún processor de import toca `deudor.estadoSituacionId`. Después de cargar pagos o actualizaciones, el código de situación del deudor queda congelado en el valor que vino del archivo de carga inicial (típicamente "ACTIVO") o el default de la plantilla. El sistema necesita reconciliar la situación del deudor con la realidad financiera: si pagó todo → **SIT-050 (Cancelado / Pagado)**, si pagó algo → **SIT-041 (Pago parcial)**, si no pagó nada → no se toca.

A su vez, hoy `deudor.montoTotal` es **mutable** (lo pisa `actualizaciones.processor`), lo cual viola el requisito de que el importe original sea inmutable. Y la "deuda actualizada" se calcula en frontend restando solo cuotas de convenio (no la tabla `pago`).

Este spec propone:

1. **`deudor.montoTotal` se vuelve inmutable** (= original informado por el cedente).
2. **Nuevo campo `deudor.saldo`** persistido, mantenido por el consolidador (= `montoTotal − sum(pagos)`).
3. **Un servicio core idempotente** `ConsolidacionSituacionService` que recalcula `saldo` y transiciona `estadoSituacionId` en bloque, usando queries agregadas (`groupBy`).
4. **Tres disparadores** sobre el mismo servicio:
   - **Automático** vía hook `afterAll` de `pagos` y `actualizaciones`.
   - **Batch manual** vía endpoint REST + job BullMQ + botón "Consolidar" en el front con **dry-run / preview** y progreso por Socket.IO.
   - **Backfill** corriendo el mismo job una vez por remesa/empresa para datos ya cargados.
5. **Cuenta cancelada (SIT-050) queda bloqueada**: ningún flujo de mutación (situación, gestión, comentarios, convenios, motivoNoPago, llamada Neotel con resultado) puede modificarla. Enforcement en backend (helper compartido + check inline en cada service) + UI deshabilitada en el front.
6. **Tolerancia configurable** (default 1% del `montoTotal`) para considerar "saldo cero" — protege contra redondeos.
7. **Frontend**: ficha del deudor muestra **Original** (tachado/grisado) + **Saldo** (calculado contra `pago`), botón "Consolidar" en historial de remesa, ficha bloqueada cuando `estadoSituacionId == SIT-050`.

---

## 1. Reglas de negocio (confirmadas con el usuario)

| # | Regla |
|---|-------|
| 1 | Pago = registro en tabla `pago` (relación `deudor.pagos`). `saldo = montoTotal − sum(pagos)`. |
| 2 | Si `sum(pagos) ≥ (1 − tolerancia) * montoTotal` con `tolerancia` configurable (default 1%) → `estadoSituacionId = SIT-050`. |
| 3 | Si `0 < sum(pagos) < (1 − tolerancia) * montoTotal` → `estadoSituacionId = SIT-041`. |
| 4 | Si `sum(pagos) == 0` → el deudor **no se toca** (mantiene situación actual). |
| 5 | La consolidación es **mandatoria y sobrescribe** cualquier situación cargada manualmente (incluido por gestor). |
| 6 | Una cuenta en SIT-050 queda **bloqueada**: no la puede modificar gestor, comentario, convenio, cambio de gestión, motivoNoPago, ni resultado de llamada. Salvo el job de consolidación mismo (que solo escribe `saldo` / `estadoSituacionId`). |
| 7 | `montoTotal` queda **inmutable** una vez creado el deudor (= original informado por el cedente). |
| 8 | El "importe actualizado" / saldo es un **campo persistido** `deudor.saldo`. NO cálculo dinámico. |
| 9 | La consolidación es **idempotente**: correrla N veces sobre el mismo conjunto produce el mismo resultado. |
| 10 | Sólo se evalúan códigos `SIT-050` y `SIT-041`. **`SIT-040` (Pagando) NO se aplica** desde acá. |

### 1.1 Aclaración importante sobre SIT-040 ("Pagando")

`SIT-040` queda reservado para gestión manual o futuras reglas (por ej. "tiene convenio activo y al menos una cuota pagada"). La consolidación automática **nunca** transiciona a SIT-040.

### 1.2 Bloqueo SIT-050: alcance preciso

- Bloquear **mutaciones** del deudor (situación, gestión, motivoNoPago, crear/cancelar convenio, agregar comentario, registrar resultado de llamada, registrar pago de cuota, ABM de contactos).
- **NO bloquear** lecturas (consultar ficha, ver historial, ver timeline, ejecutar reportes).
- **NO bloquear** la consolidación misma: el servicio puede tocar `saldo` y `estadoSituacionId` de un deudor en SIT-050 (necesario por idempotencia + posible reversión si entrara un ajuste negativo).
- **NO bloquear** workers de importación que generan pagos automáticos: pasan por las mismas tablas y la consolidación posterior actualiza la situación.

---

## 2. Schema (Prisma)

### 2.1 Cambios en `model deudor`

```prisma
model deudor {
  id                Int           @id @default(autoincrement())
  // ...campos existentes...
  montoTotal        Float?        // INMUTABLE post-creación (= original del cedente)
  saldo             Float?        // NUEVO: persistido por ConsolidacionSituacionService
  situacionConsolidadaEn DateTime? // NUEVO: timestamp de la última consolidación
  // estadoSituacionId queda como está (FK a parametro, deriva el bloqueo)
  // ...
  @@index([estadoSituacionId, empresaId], map: "Deudor_estadoSituacion_empresa_idx") // NUEVO
}
```

**Decisión sobre flag de bloqueo:** **derivar del valor `estadoSituacionId == SIT-050`** (NO agregar columna `bloqueado`). Razones:
- Evita drift entre dos columnas que deberían estar sincronizadas.
- El check requiere un solo join (o un cache en memoria de los `parametro.id` que mapean a SIT-050).
- Si el costo de performance del join se vuelve molesto, se puede agregar un boolean derivado en una segunda iteración sin migrar datos (se setea por trigger del consolidador).

**Para el helper de bloqueo se cachea en memoria el `id` del parámetro `SIT-050`** (lookup único al startup del module + invalidación en hot reload). Ver §4.4.

### 2.2 Aplicación

Como en todo el repo: **`npx prisma db push`** (NUNCA `migrate dev`). Tras el push, el implementer corre el backfill descrito en §7 que llena `saldo` y `situacionConsolidadaEn` para todos los deudores existentes.

### 2.3 Plantilla/parámetro de tolerancia

La tolerancia se lee de variable de entorno (rápido, sin trip a la DB en cada job):

```env
CONSOLIDACION_TOLERANCIA_PCT=0.01   # 1%. Rango aceptado: [0, 0.05]
```

Validar al startup en `ConsolidacionSituacionService.onModuleInit`: si el valor está fuera de rango, fallar el bootstrap con error descriptivo (mismo patrón que otros configs críticos).

> Alternativa rechazada: poner la tolerancia en `parametro` (con grupo `consolidacion`). Se evaluó pero agrega un round-trip a DB por cada batch y no aporta valor (la tolerancia cambia muy rara vez y siempre la define un admin de sistema, no de negocio).

---

## 3. Servicio core: `ConsolidacionSituacionService`

### 3.1 Ubicación

```
backend/src/modules/consolidacion/
├── consolidacion.module.ts
├── consolidacion.service.ts          # servicio core (este)
├── consolidacion.controller.ts        # endpoints REST
├── bullmq/
│   └── consolidacion.processor.ts     # worker batch
├── dto/
│   ├── consolidar-scope.dto.ts        # payload del endpoint
│   └── consolidacion-preview.dto.ts   # respuesta dry-run
└── interfaces/
    └── consolidacion-result.interface.ts
```

Es un módulo nuevo (no se mete en `imports`) porque lo van a consumir 3 lugares distintos (processors, controller manual, backfill cron eventual).

### 3.2 Tipos

```ts
export type ConsolidacionScope =
  | { tipo: 'DEUDORES'; deudorIds: number[] }     // disparador automático afterAll
  | { tipo: 'REMESA'; remesaId: number }
  | { tipo: 'EMPRESA'; empresaId: number }
  | { tipo: 'TODAS' };

export interface ConsolidacionResult {
  evaluados: number;                  // deudores que entraron al cálculo
  conPagos: number;                   // deudores con sum(pagos) > 0
  aSIT050: number;                    // transicionarían/transicionaron a SIT-050
  aSIT041: number;                    // transicionarían/transicionaron a SIT-041
  sinCambios: number;                 // saldo y situación quedaron igual
  saldoActualizado: number;           // deudores cuyo saldo cambió (incluye sinCambios de situación)
  durationMs: number;
  // En modo dryRun no se persiste nada. En modo apply, los conteos reflejan lo aplicado.
}
```

### 3.3 Firma del método principal

```ts
@Injectable()
export class ConsolidacionSituacionService {
  private sit050Id: number | null = null;
  private sit041Id: number | null = null;
  private toleranciaPct: number = 0.01;

  async onModuleInit(): Promise<void> {
    // Cachear ids de parametros y validar config
  }

  async consolidar(
    scope: ConsolidacionScope,
    opts?: {
      dryRun?: boolean;                 // default false
      onProgress?: (avance: number, total: number) => void;
      batchSize?: number;               // default 500
      requestId?: string;               // para logging
    }
  ): Promise<ConsolidacionResult>;
}
```

### 3.4 Algoritmo (pseudocódigo)

```
1. Resolver el conjunto de deudorIds según scope:
   - DEUDORES: usa la lista tal cual.
   - REMESA: SELECT id FROM deudor WHERE remesaId = $1
   - EMPRESA: SELECT id FROM deudor WHERE empresaId = $1
   - TODAS: SELECT id FROM deudor

2. Para procesar en chunks (batchSize por defecto 500):
   2a. Para el chunk actual:
       - Query agregada (UNA sola query, no fila por fila):
         SELECT d.id, d.montoTotal, d.estadoSituacionId,
                COALESCE(SUM(p.importe), 0) AS totalPagado
         FROM deudor d
         LEFT JOIN pago p ON p.deudorId = d.id
         WHERE d.id IN ($chunk)
         GROUP BY d.id

3. Para cada fila del chunk:
   - Si totalPagado == 0 → skip (regla 4).
   - Calcular saldoNuevo = max(0, montoTotal − totalPagado).
   - Calcular umbralCancelado = montoTotal * (1 - toleranciaPct).
   - Decidir situacionNuevaId:
       * Si totalPagado >= umbralCancelado → sit050Id
       * Else → sit041Id
   - Comparar contra estado actual:
       * saldoCambia = abs(saldoNuevo - (saldoActual ?? montoTotal)) > 0.001
       * situacionCambia = situacionNuevaId !== estadoSituacionId
   - Acumular en buffer para update batched.
   - Acumular contadores (aSIT050, aSIT041, sinCambios, saldoActualizado).

4. Si dryRun → NO escribir. Devolver contadores.

5. Si apply → escribir todo el chunk en una transacción Prisma:
   - $transaction([
       updateMany(WHERE id IN [...], data: { saldo, estadoSituacionId, situacionConsolidadaEn }),
       ...
     ])
   - Estrategia preferida: UNA sola query SQL templated por chunk
     (UPDATE deudor JOIN ... SET saldo=..., estadoSituacionId=...)
     para evitar N updates dentro de la transacción.
     Implementer: si no se puede expresar en una sola query Prisma,
     hacer un `prisma.$executeRaw` con CASE WHEN o agrupar por situacionNuevaId
     y hacer 2 `updateMany` por chunk.

6. Reportar progreso (onProgress callback) cada chunk procesado.

7. Repetir hasta agotar el universo. Sumar resultados parciales.

8. Devolver ConsolidacionResult final.
```

### 3.5 Idempotencia

- Si se corre N veces sobre el mismo estado, el resultado es el mismo: el cálculo solo depende de `montoTotal` (inmutable) y `sum(pagos)` (snapshot al momento).
- Concurrencia: ver §10. La transacción por chunk no protege contra un pago que llega entre el SELECT y el UPDATE, pero la regla 9 (mandatoria) hace que ese caso se autocorrija en la próxima consolidación.

### 3.6 Logging

Patrón intent/done en `consolidar()`:

```ts
const t0 = Date.now();
this.logger.log(`Consolidación iniciada scope=${scope.tipo} dryRun=${opts?.dryRun ?? false} req=${opts?.requestId}`);
// ...
this.logger.log(`Consolidación done scope=${scope.tipo} evaluados=${r.evaluados} aSIT050=${r.aSIT050} aSIT041=${r.aSIT041} sinCambios=${r.sinCambios} en ${Date.now() - t0}ms`);
```

Para batch > 500 deudores con `verbose` activado: loguear cada chunk con su rango (`chunk 5/40 evaluados=500 aSIT050=12 …`).

### 3.7 Integración con auditoría

Cada `apply` (no dry-run) emite UN registro de auditoría agregado:

```ts
this.auditoria.log({
  modulo: AuditModulo.IMPORT,                       // o nuevo CONSOLIDACION
  entidad: 'Deudor',
  tipo: AuditTipo.UPDATE,                           // o nuevo CONSOLIDACION_APPLY
  resumen: `Consolidación scope=${scope.tipo} aSIT050=${r.aSIT050} aSIT041=${r.aSIT041}`,
  data: { params: scope, contexto: r },
});
```

> NO se emite una fila por deudor consolidado (volumen impractical para 17k+ deudores). El registro agregado se compagina con el log de Winston que sí tiene granularidad.

---

## 4. Integración en `afterAll` de processors

### 4.1 Disparo automático

En `pagos.processor.ts` y `actualizaciones.processor.ts`: agregar hook `afterAll(ctx)` que llama al servicio con scope `{ tipo: 'REMESA', remesaId: ctx.remesaId }`.

Para evitar import circular (los processors no son providers Nest sino clases planas), se inyecta el servicio vía el `ProcessContext`. Patrón:

```ts
// processor.interface.ts (modificar)
export interface ProcessContext {
  prisma: PrismaService;
  remesaId: number;
  empresaId: number;
  remesaOrigenId?: number;
  validarDomicilios?: boolean;
  defaults: { estadoSituacionId: number; estadoGestionId: number };
  consolidacion: ConsolidacionSituacionService;  // NUEVO
}
```

`ImportService.processImportJob` ya construye `ctx` — solo agrega el service.

### 4.2 `PagosProcessor.afterAll`

```ts
async afterAll(ctx: ProcessContext): Promise<void> {
  // En PAGOS la remesa es de pagos, no de deudores. Necesitamos los deudores
  // que recibieron pagos en este batch. Como pagos.processor solo hace
  // pago.create con deudores de remesaOrigenId, consolidamos contra esa remesa
  // (o, mejor, los deudorIds tocados — lo trackea processRow).
  await ctx.consolidacion.consolidar({
    tipo: 'REMESA',
    remesaId: ctx.remesaOrigenId ?? ctx.remesaId,
  });
}
```

**Caveat**: `pagos.processor` solo crea pagos para deudores de `remesaOrigenId` (parámetro de la importación de pagos). Si `remesaOrigenId` está definido, usar ese; si no, usar `ctx.remesaId`. Validar con el implementer que el flag siempre viene en las importaciones tipo PAGOS (revisar `imports.service.processImportJob` para confirmar).

> **Optimización opcional para PAGOS**: trackear `processedDeudorIds: Set<number>` durante `processRow` y consolidar solo esa lista (`scope DEUDORES`). Ahorra evaluar deudores de la remesa que no recibieron pagos. Recomendar al implementer hacerlo así.

### 4.3 `ActualizacionesProcessor.afterAll` y eliminación del pisado de `montoTotal`

**Cambios obligatorios en `actualizaciones.processor.ts`** (mantener inmutabilidad de `montoTotal`):

| Línea actual | Acción |
|---|---|
| ~277 `deudor.update({ data: { montoTotal: totalFinal } })` | **ELIMINAR**. No tocar `montoTotal`. Si entran facturas nuevas en escenario A, el growth de deuda se refleja como facturas PENDIENTE y NO cambia el original. |
| ~304 `deudor.update({ data: { montoTotal: montoNuevo } })` | **ELIMINAR**. En escenario B (solo `montoTotal`, sin bloques): si `delta > 0` ya genera pago automático; si `delta < 0` ya genera factura de AJUSTE. El `montoTotal` queda en su valor original. |
| ~356 `deudor.update({ data: { montoTotal: 0 } })` (afterAll C) | **ELIMINAR**. Generar el pago y marcar facturas como PAGADA es suficiente. La consolidación posterior lleva la situación a SIT-050. |
| `processedDeudorIds: Set<number>` (línea ~26) | **MANTENER**. Pasarlo al afterAll. |

**Nuevo `afterAll`** (queda solo este, el actual escenario C se delega a la consolidación):

```ts
async afterAll(ctx: ProcessContext): Promise<void> {
  if (!ctx.remesaOrigenId) return;

  // 1. Escenario C: deudores de remesa origen ausentes del archivo → pagaron todo.
  //    Para cada uno, crear el pago automático Y marcar las facturas pendientes
  //    como PAGADA (esto NO cambia, sigue como hoy menos la línea ~356).
  const deudoresOrigen = await ctx.prisma.deudor.findMany({
    where: { remesaId: ctx.remesaOrigenId, empresaId: ctx.empresaId },
    select: { id: true },
  });

  for (const { id: deudorId } of deudoresOrigen) {
    if (this.processedDeudorIds.has(deudorId)) continue;
    // ...crear pago automático y marcar facturas PAGADA (igual que hoy)...
    // NO escribir montoTotal: 0
  }

  // 2. Consolidar TODOS los deudores tocados (los del archivo + los ausentes
  //    de remesa origen). Usar scope REMESA sobre la remesa origen para cubrir
  //    los ausentes + los del archivo que estaban en esa remesa. Para los nuevos
  //    creados en escenario B (que viven en ctx.remesaId), agregar también esa
  //    remesa con una segunda llamada.
  await ctx.consolidacion.consolidar({ tipo: 'REMESA', remesaId: ctx.remesaOrigenId });
  if (ctx.remesaOrigenId !== ctx.remesaId) {
    await ctx.consolidacion.consolidar({ tipo: 'REMESA', remesaId: ctx.remesaId });
  }
}
```

> **Sobre crecimiento de deuda** (escenario A donde el archivo trae más facturas o un `montoTotal` mayor): la **suma `montoTotal` + facturas PENDIENTE** queda decoupleada del original. El `saldo` ya no representa "lo que falta" en sentido estricto; representa **lo que falta del importe original**. Si las facturas crecieron por ajuste, eso se ve en la tabla `factura`, no en `saldo`. Esto se asume aceptable por el usuario, dado que la regla fue "el original es inmutable y manda". Documentar en la ficha del deudor con un tooltip ("El saldo se calcula sobre el monto original. Ver facturas para ajustes posteriores").

### 4.4 Cache de IDs de parámetros SIT

`onModuleInit` del service hace:

```ts
const sit050 = await this.prisma.parametro.findUnique({ where: { clave: 'SIT-050' } });
const sit041 = await this.prisma.parametro.findUnique({ where: { clave: 'SIT-041' } });
if (!sit050 || !sit041) {
  throw new Error('Parámetros SIT-050 y SIT-041 no seedeados. Correr seed-codigos-curados.ts');
}
this.sit050Id = sit050.id;
this.sit041Id = sit041.id;
```

Estos IDs **no cambian en runtime** (los parámetros son seedeados). Si en el futuro hace falta invalidar, exponer un método admin `refrescarCache()`.

---

## 5. Job BullMQ batch

### 5.1 Queue + processor

```
backend/src/modules/consolidacion/bullmq/consolidacion.processor.ts
```

**Queue:** `consolidacion-queue` (registrada en `consolidacion.module.ts` vía `BullModule.registerQueue`).

**Payload del job:**

```ts
interface ConsolidacionJobData {
  scope: ConsolidacionScope;
  dryRun: boolean;
  usuarioId: number;          // para auditoría y notificación
  _ctx?: { requestId?: string; usuarioId?: number };  // patrón estándar
}
```

**Patrón del processor** (siguiendo `imports.processor.ts`):

```ts
@Processor('consolidacion-queue')
export class ConsolidacionProcessor extends WorkerHost {
  private readonly logger = new Logger(ConsolidacionProcessor.name);

  constructor(
    private readonly consolidacion: ConsolidacionSituacionService,
    private readonly realtime: RealtimeService,
    private readonly notificaciones: NotificacionesService,
    private readonly auditoria: AuditoriaHelper,
    private readonly requestContext: RequestContextService,
  ) { super(); }

  async process(job: Job<ConsolidacionJobData>): Promise<ConsolidacionResult> {
    const { _ctx } = job.data;
    const ctx = {
      requestId: _ctx?.requestId ?? nanoid(8),
      usuarioId: _ctx?.usuarioId ?? job.data.usuarioId,
      source: 'bull' as const,
      jobId: String(job.id),
      queue: job.queueName,
    };
    return this.requestContext.run(ctx, () => this.realProcess(job));
  }

  private async realProcess(job: Job<ConsolidacionJobData>): Promise<ConsolidacionResult> {
    const { scope, dryRun, usuarioId } = job.data;

    // 1. Emitir socket "iniciada" al usuario
    this.realtime.emitToUser(usuarioId, 'consolidacion:iniciada', { scope, dryRun, jobId: job.id });

    // 2. Llamar al service con onProgress que emite throttled
    const emitter = new ProgressEmitter((pct, ok, err) => {
      this.realtime.emitToUser(usuarioId, 'consolidacion:progreso', {
        jobId: job.id,
        progreso: pct,
        evaluados: ok,
        scope,
      });
    });

    const result = await this.consolidacion.consolidar(scope, {
      dryRun,
      onProgress: (avance, total) => {
        const pct = total > 0 ? Math.min(100, Math.floor((avance / total) * 100)) : 0;
        emitter.tick(pct, avance, 0);
      },
      requestId: ctx.requestId,
    });

    // 3. Emitir socket "finalizada"
    this.realtime.emitToUser(usuarioId, 'consolidacion:finalizada', { jobId: job.id, result });

    // 4. Crear notificación persistente (REPORTE_LISTO o tipo nuevo CONSOLIDACION_LISTA)
    await this.notificaciones.crear({
      usuarioId,
      tipo: 'SISTEMA',                                  // o agregar CONSOLIDACION_LISTA al enum
      titulo: dryRun ? 'Preview de consolidación listo' : 'Consolidación completada',
      mensaje: `Scope=${scope.tipo} · SIT-050: ${result.aSIT050} · SIT-041: ${result.aSIT041} · Sin cambios: ${result.sinCambios}`,
      payload: { result, scope, dryRun },
    });

    // 5. Auditoría
    await this.auditoria.log({
      modulo: AuditModulo.IMPORT,                        // o nuevo CONSOLIDACION
      tipo: dryRun ? AuditTipo.EJECUTAR : AuditTipo.UPDATE,
      entidad: 'Deudor',
      usuarioId,
      resumen: `Consolidación ${dryRun ? 'DRY' : 'APPLY'} scope=${scope.tipo}`,
      data: { params: scope, contexto: result },
    });

    return result;
  }
}
```

### 5.2 Throttle de progreso

Reusar `ProgressEmitter` de `backend/src/modules/imports/utils/progress-emitter.ts` (2s / 5%, primer y último forzados). No reimplementar.

### 5.3 Dry-run / Preview

El campo `dryRun: boolean` del payload se pasa tal cual al service. El service:
- Hace el cálculo completo (mismas queries).
- **NO ejecuta** los `UPDATE` ni la transacción de write.
- Devuelve `ConsolidacionResult` con los contadores "como si se aplicara".
- Emite los mismos eventos socket (UX coherente: el usuario ve la barra de progreso del preview).

El front muestra la respuesta como tabla resumen y un CTA "Aplicar consolidación" que dispara un segundo job con `dryRun: false`.

### 5.4 Eventos socket

| Evento | Destinatario | Payload |
|---|---|---|
| `consolidacion:iniciada` | `user:${usuarioId}` | `{ scope, dryRun, jobId }` |
| `consolidacion:progreso` | `user:${usuarioId}` | `{ jobId, progreso, evaluados, scope }` |
| `consolidacion:finalizada` | `user:${usuarioId}` | `{ jobId, result }` |

> No se emite a `admin:importaciones` por ahora — feature 1-a-1 con quien lo dispara. Si se necesita más adelante, agregar el room en una segunda iteración.

### 5.5 Concurrencia

- **Un solo job de consolidación activo a la vez** (global). El processor checa con un lock Redis (clave `lock:consolidacion`, TTL = duración máxima esperada del job, ej. 15 min). Si está tomado → el endpoint REST devuelve `409 CONSOLIDACION_EN_CURSO`. Patrón ya usado en otros módulos (ver `neotel-redis.service.ts`).
- **Excepción para el disparo automático del `afterAll`**: NO usa el job; llama al service síncronamente desde el processor de imports. Es secuencial con el import y queda dentro del scope del job de import. Esto evita encolar otro job que compita con consolidaciones manuales.

### 5.6 Reintentos

- `attempts: 1` (NO reintentar). Si el job falla, el usuario debe volver a dispararlo manualmente. Razón: un fallo a mitad de un `apply` deja medios chunks aplicados, y reintentar puede generar dobles updates de auditoría. La idempotencia del service permite re-correrlo limpio, pero esa decisión la toma un humano.
- En `onFailed` del processor: emitir `consolidacion:finalizada` con `result: null, error: msg`, notificación de tipo ERROR, log con stack.

---

## 6. Endpoints REST

Todos bajo `/api/consolidacion`, controller protegido con JWT global y permisos finos.

### 6.1 `POST /api/consolidacion/preview`

**Auth:** JWT + permiso `consolidacion.ejecutar`.

**Body (DTO `ConsolidarScopeDto`):**

```ts
class ConsolidarScopeDto {
  @IsIn(['REMESA', 'EMPRESA', 'TODAS'])
  tipo: 'REMESA' | 'EMPRESA' | 'TODAS';

  @IsOptional() @IsInt() @IsPositive()
  remesaId?: number;   // requerido si tipo === 'REMESA'

  @IsOptional() @IsInt() @IsPositive()
  empresaId?: number;  // requerido si tipo === 'EMPRESA'
}
```

Validación cruzada en el service (`if tipo === 'REMESA' && !remesaId throw BadRequest`).

> **Nota**: scope `DEUDORES` (lista explícita) NO se expone vía endpoint manual — es solo para el disparo automático. Para hacer "consolidar este deudor", el front usa `tipo: REMESA` con la remesa del deudor.

**Response:** `202 Accepted` con `{ jobId }`. El resultado del preview llega por socket (`consolidacion:finalizada` con `dryRun: true` en el payload).

> Alternativa rechazada: hacer el preview síncrono. Para 17k+ deudores tarda demasiado (timeout HTTP). Mejor uniformar con el flujo de apply.

### 6.2 `POST /api/consolidacion/aplicar`

**Auth:** JWT + permiso `consolidacion.ejecutar`.

**Body:** Mismo DTO que preview.

**Comportamiento:** Encola el job con `dryRun: false`. Devuelve `202 Accepted` con `{ jobId }`.

**Validación de concurrencia:** Antes de encolar, intentar tomar `lock:consolidacion` en Redis. Si ya está tomado → `409 CONFLICT { code: 'CONSOLIDACION_EN_CURSO' }`.

### 6.3 `GET /api/consolidacion/estado`

**Auth:** JWT.

**Response:** `{ enCurso: boolean; jobId?: string; usuarioId?: number; iniciadoEn?: ISO }`.

Utilidad: que el front, al cargar la página de consolidación, sepa si ya hay un job corriendo para suscribirse a sus eventos.

### 6.4 Permiso nuevo

Agregar al catálogo en **ambos** archivos (idénticos):
- `backend/src/auth/permisos-catalogo.ts`
- `frontend/src/utils/permisosCatalogo.ts`

Nueva sección o agregar a "Importación":

```ts
{
  seccion: 'Importación',
  permisos: [
    // ...existentes...
    {
      key: 'consolidacion.ejecutar',
      label: 'Ejecutar consolidación de situación',
      descripcion: 'Recalcula saldo y código de situación según pagos cargados',
    },
  ],
}
```

Agregar también a `backend/prisma/seed.ts` en `TODAS_LAS_KEYS` (ADMIN lo recibe automáticamente). OPERADOR **no** lo recibe por default — se asigna manualmente.

---

## 7. Backfill de datos existentes

### 7.1 Estrategia

Después del `db push` que agrega `saldo`, todos los deudores existentes tienen `saldo = NULL`. El backfill los llena.

**Paso 1 — Inicialización de `saldo` para deudores sin pagos:**

```sql
UPDATE deudor SET saldo = montoTotal WHERE saldo IS NULL;
```

Esto deja `saldo == montoTotal` para todos. Para los que sí tienen pagos, el siguiente paso lo corrige.

**Paso 2 — Correr el job de consolidación con scope `TODAS`:**

Desde el front (botón "Consolidar todas las empresas") o vía CLI:

```bash
# Opcional: script one-off
npx ts-node backend/prisma/scripts/backfill-consolidacion.ts
```

El script llama directamente al service (sin job BullMQ — corre síncrono en CLI) con `tipo: TODAS`, `dryRun: false`. Loguea progreso por chunk a stdout.

### 7.2 Orden recomendado y verificación

1. **Antes**: snapshot de `deudor.estadoSituacionId, deudor.montoTotal` en una tabla temporal o CSV (`SELECT id, estadoSituacionId, montoTotal INTO OUTFILE ...`).
2. `db push` (agrega `saldo` y `situacionConsolidadaEn`).
3. Paso 1 (UPDATE saldo = montoTotal).
4. Correr **dry-run** con scope `TODAS` desde el endpoint → revisar `ConsolidacionResult` con el usuario (cuántos a SIT-050, cuántos a SIT-041).
5. Si el preview es razonable → correr `apply` con scope `TODAS`.
6. **Después**: queries de verificación:
   ```sql
   -- Cuántos deudores en SIT-050
   SELECT COUNT(*) FROM deudor d
   JOIN parametro p ON p.id = d.estadoSituacionId
   WHERE p.clave = 'SIT-050';

   -- Deudores en SIT-050 con saldo > 0 (debería ser ~0, dentro de la tolerancia)
   SELECT COUNT(*) FROM deudor d
   JOIN parametro p ON p.id = d.estadoSituacionId
   WHERE p.clave = 'SIT-050' AND d.saldo > d.montoTotal * 0.01;
   ```

### 7.3 Rollback

Como `montoTotal` no se toca y los pagos no se modifican, el rollback es:

```sql
-- Si el preview reveló algo inesperado, antes del apply: nada que rollbackear.
-- Después del apply, si se necesita revertir:
UPDATE deudor SET estadoSituacionId = NULL, saldo = NULL, situacionConsolidadaEn = NULL
WHERE situacionConsolidadaEn >= '2026-XX-XX 00:00:00';
-- Luego, restaurar estadoSituacionId desde el snapshot del paso 1.
```

El snapshot del paso 1 es la red de seguridad. **Es OBLIGATORIO sacarlo antes del apply.**

---

## 8. Enforcement del bloqueo SIT-050

### 8.1 Helper compartido

```ts
// backend/src/modules/deudores/utils/deudor-bloqueo.ts
@Injectable()
export class DeudorBloqueoService implements OnModuleInit {
  private sit050Id: number | null = null;

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    const sit050 = await this.prisma.parametro.findUnique({ where: { clave: 'SIT-050' } });
    this.sit050Id = sit050?.id ?? null;
  }

  /**
   * Lanza ForbiddenException si el deudor está cancelado.
   * Si no, no hace nada.
   */
  async assertNoBloqueado(deudorId: number, accion: string): Promise<void> {
    if (this.sit050Id == null) return;  // sin SIT-050 seedeado: no bloquea (modo degradado)
    const d = await this.prisma.deudor.findUnique({
      where: { id: deudorId },
      select: { estadoSituacionId: true },
    });
    if (d?.estadoSituacionId === this.sit050Id) {
      throw new ForbiddenException({
        code: 'DEUDOR_CANCELADO',
        message: `El deudor está cancelado (SIT-050). Acción '${accion}' no permitida.`,
      });
    }
  }
}
```

Exportar desde `DeudoresModule`; importar en cualquier módulo que mute al deudor.

### 8.2 Lista de superficies a guardar

| Módulo | Service / método | Acción |
|---|---|---|
| `deudores` | `DeudoresService.update` (cambia situación/gestión/motivo) | `assertNoBloqueado(id, 'actualizar estados')`. **Excepción**: el propio job de consolidación NO usa este service — usa `prisma.deudor.update` directo. |
| `deudores` | `DeudoresService.delete` | `assertNoBloqueado(id, 'eliminar')`. |
| `comentarios` | `ComentariosService.create` | `assertNoBloqueado(dto.deudorId, 'crear comentario')`. |
| `comentarios` | `ComentariosService.update / delete` | Idem. |
| `convenios` | `ConveniosService.create` | `assertNoBloqueado(dto.deudorId, 'crear convenio')`. |
| `convenios` | `ConveniosService.marcarCuotaPagada` | Resolver `deudorId` desde la cuota y validar. |
| `convenios` | `ConveniosService.anularConvenio` | Resolver `deudorId` y validar. |
| `contactos` | `ContactosService.create / update / delete` | `assertNoBloqueado(deudorId, '<accion>')`. |
| `neotel` | Registro de resultado de llamada (revisar `sesion-agente.service.ts` o el endpoint que persiste el resultado de gestión post-llamada) | `assertNoBloqueado(deudorId, 'registrar resultado de llamada')`. **No bloquear** la llamada en sí, solo el "guardar resultado de gestión". |

> **Implementer**: hacer un grep `prisma.deudor.update\|prisma.comentario.create\|prisma.convenio.create\|prisma.contacto.\|prisma.pago.create` en `backend/src/modules/` para confirmar que cubrimos todas las mutaciones. Documentar en el PR cualquier superficie nueva encontrada.

### 8.3 Estrategia: check inline (NO decorator/guard)

Se prefirió **check inline en el service** sobre `@BloqueoDeudorGuard()` por razones:
- Los guards de NestJS reciben `ExecutionContext`, no el body parseado — sería frágil parsear `deudorId` desde body / param / nested DTO.
- Los services se llaman desde múltiples puntos (controller, workers, internal-api) y necesitamos el check en todos.
- El check inline es trivial (1 línea) y deja el error muy localizado.

### 8.4 Excepciones explícitas (NO bloquear)

Lista whitelist de operaciones que pueden tocar al deudor cancelado:

- `ConsolidacionSituacionService` (escribe `saldo`, `estadoSituacionId`, `situacionConsolidadaEn`).
- Workers de import (`pagos.processor`, `actualizaciones.processor`, `deudores.processor`, etc.) — pueden generar pagos y modificar facturas, dato económico real.
- Internal-api de timeline / lectura (no muta).

---

## 9. Frontend

### 9.1 Ficha del deudor — header con Original + Saldo

`frontend/src/components/deudores/ficha/FichaHeader.tsx`:

Reemplazar el cálculo actual (`deudaActualizada = montoTotal − totalPagadoConvenios`) por uso del campo `saldo` que viene del backend (la API `/api/deudores/:id` debe incluirlo automáticamente porque ya es campo del modelo).

```tsx
// Pseudocódigo del bloque de importes
{deudor.saldo != null && deudor.saldo < deudor.montoTotal ? (
  <>
    <Typography variant="overline" color="text.secondary" fontWeight="bold">
      SALDO ACTUALIZADO
    </Typography>
    <Typography variant="h4" fontWeight="bold" color={cuentaCancelada ? 'success.main' : 'text.primary'}>
      ${deudor.saldo.toLocaleString('es-AR', { minimumFractionDigits: 2 })}
    </Typography>
    <Tooltip title="Importe original informado por el cedente. Inmutable.">
      <Typography
        variant="caption"
        color="text.disabled"
        display="block"
        sx={{ textDecoration: 'line-through', cursor: 'default' }}
      >
        Original: ${deudor.montoTotal?.toLocaleString('es-AR', { minimumFractionDigits: 2 })}
      </Typography>
    </Tooltip>
    <Typography variant="caption" color="success.main" display="block">
      Pagado: -${(deudor.montoTotal - deudor.saldo).toLocaleString('es-AR', { minimumFractionDigits: 2 })}
    </Typography>
  </>
) : (
  <>
    <Typography variant="overline" color="text.secondary" fontWeight="bold">DEUDA TOTAL</Typography>
    <Typography variant="h4" fontWeight="bold">${deudor.montoTotal?.toLocaleString('es-AR', { minimumFractionDigits: 2 })}</Typography>
  </>
)}
```

Cuando el deudor está cancelado: pintar el saldo en `success.main` con un chip "CANCELADA" arriba.

### 9.2 Ficha del deudor — modo bloqueado

`FichaDeudor.tsx`:

1. Derivar `const cuentaCancelada = deudor?.estadoSituacion?.clave === 'SIT-050';`.
2. Pasar `cuentaCancelada` a los componentes hijos.
3. **`FichaEstadosCard`**: deshabilitar los tres `TextField` y el botón "Guardar" cuando `cuentaCancelada`. Tooltip "Cuenta cancelada — no se puede modificar".
4. **`FichaContactosPanel`**: deshabilitar botones de agregar/editar/eliminar contacto, toggle whatsapp, marcar principal.
5. **Botones de "Nuevo convenio", "Pagar cuota", "Anular convenio"**: deshabilitar.
6. **Sección comentarios** (tab): deshabilitar input nuevo comentario y eliminación. Permitir solo lectura.
7. **Header**: mostrar `Chip color="success" icon=<CheckCircleIcon/> label="CUENTA CANCELADA"`.

> **Patrón**: pasar `disabled` como prop a cada subcomponente. No clonar la ficha en una "ficha read-only" (evita duplicación).

### 9.3 Botón "Consolidar" en historial de remesas

`frontend/src/pages/ImportHistory.tsx` o vista nueva `ConsolidacionPage.tsx`:

- Nuevo botón en la fila de cada remesa: "Consolidar".
- Click → modal con dos pasos:
  - **Paso 1 — Preview**: dispara `POST /api/consolidacion/preview` con `tipo: REMESA, remesaId: row.id`. Muestra loader. Recibe `jobId`.
  - Se suscribe a `consolidacion:progreso` (barra) y `consolidacion:finalizada` (cierre).
  - Al recibir `finalizada` con `dryRun: true`: muestra tabla resumen:
    ```
    Deudores evaluados: 1.247
    Con pagos: 832
    Pasarán a SIT-050 (Cancelado): 412
    Pasarán a SIT-041 (Pago parcial): 420
    Sin cambios: 415
    ```
  - **Paso 2 — Confirmar**: botón "Aplicar consolidación" dispara `POST /api/consolidacion/aplicar`. Misma UX de progreso. Al finalizar, snackbar de éxito.

Vista alternativa "consolidar empresa" o "consolidar todas": agregar en una página de admin (sección Importación o Ajustes), solo para usuarios con `consolidacion.ejecutar`.

### 9.4 Suscripción a eventos socket

Reusar `SocketContext` y `useSocket()`. No agregar nuevo provider. El modal de consolidación se suscribe localmente:

```tsx
useEffect(() => {
  if (!socket || !jobId) return;
  const onProgreso = (p: any) => { if (p.jobId === jobId) setProgreso(p.progreso); };
  const onFinalizada = (p: any) => { if (p.jobId === jobId) setResultado(p.result); };
  socket.on('consolidacion:progreso', onProgreso);
  socket.on('consolidacion:finalizada', onFinalizada);
  return () => {
    socket.off('consolidacion:progreso', onProgreso);
    socket.off('consolidacion:finalizada', onFinalizada);
  };
}, [socket, jobId]);
```

### 9.5 Manejo del 409 `CONSOLIDACION_EN_CURSO`

Si el endpoint devuelve 409: mostrar un snackbar "Ya hay una consolidación en curso. Esperá a que termine." y deshabilitar el botón hasta que llegue un `consolidacion:finalizada` o se recargue la página.

### 9.6 Dark/light mode

Toda la UI nueva sigue el `theme` de MUI. Para el chip "CUENTA CANCELADA" usar `theme.palette.success.main` (no color hardcoded). El tachado del "Original" usa `text.disabled`.

---

## 10. Edge cases y riesgos

### 10.1 Deudor sin `montoTotal`

`montoTotal` es `Float?` (nullable). Si está NULL:
- No se evalúa (skip silencioso, contado como `sinCambios`).
- Logged a `warn` para detección: `Deudor id=X tiene montoTotal nulo y pagos > 0, no se consolida`.

### 10.2 Pagos que superan el total

`sum(pagos) > montoTotal`: `saldoNuevo = max(0, montoTotal − totalPagado) == 0` → SIT-050.

El `max(0, ...)` evita saldos negativos persistidos.

### 10.3 Tolerancia 0%

Si `CONSOLIDACION_TOLERANCIA_PCT=0`: solo si `sum(pagos) === montoTotal` exactamente → SIT-050. Para floats puede fallar por redondeo (`1000.00 vs 999.99999`). Por eso el default es 1% — protege.

### 10.4 Convenios vs pagos sueltos

Los pagos generados por cuotas de convenio entran en la tabla `pago` (ver `convenios.service.ts:marcarCuotaPagada`). El consolidador los suma como cualquier otro pago — no hay distinción especial. **Confirmar con el usuario que esto es lo deseado** (probable que sí, dado que el convenio se "honra" pagando).

### 10.5 Concurrencia del job

- Lock Redis global (§5.5): un solo job manual a la vez.
- El disparo automático del `afterAll` corre dentro del job de import; no toma el lock, pero como es secuencial con el import no compite con sí mismo. Si un usuario manualmente dispara consolidación mientras corre un import: el import termina rápido y la consolidación manual lo barre. Sin pérdida de datos por idempotencia.
- Race entre `consolidacion.consolidar` y un `pago.create` que entra en el medio: el pago nuevo no se incluye en este pase, pero se incluirá en el próximo. La situación queda "atrasada" por un pago hasta el próximo trigger. Aceptable (auto-corrige).

### 10.6 Remesas grandes (17k+ deudores)

- **Performance del cálculo**: una query `GROUP BY` con JOIN sobre `pago` para 500 deudores por chunk debe correr en <100ms si hay índice `pago(deudorId)` (ya existe: `@@index([deudorId])` en `model pago`). Para 17k deudores: ~35 chunks × ~100ms = ~3-5s de tiempo de cálculo + tiempo de updates.
- **Writes**: si usamos 2 `updateMany` por chunk (uno por situacionNuevaId), son ~70 queries de update para 17k deudores. Aceptable.
- **Memoria**: los chunks de 500 mantienen footprint chico. No cargar 17k filas a memoria de una.
- **Timeout del job**: BullMQ no tiene timeout default que mate jobs. Para safety: agregar `lockDuration: 30 * 60 * 1000` (30 min) en `WorkerHost`.

### 10.7 Cancelación reversa

Si un deudor está en SIT-050 y *después* entra un ajuste negativo (factura de AJUSTE que aumenta la deuda — escenario A de actualizaciones), el saldo subiría. El consolidador lo detectaría y bajaría a SIT-041. Esto es deseable: la situación refleja la realidad.

**Caveat de la regla 6 (bloqueo)**: durante el período entre el ingreso del ajuste y la siguiente consolidación, el deudor sigue marcado SIT-050 → bloqueado. La consolidación automática del `afterAll` lo descancela en cuestión de segundos. No es un problema operativo siempre que las actualizaciones pasen por el processor.

### 10.8 `montoTotal` cambia tras un import inicial buggy

Si por alguna razón hay que corregir `montoTotal` a posteriori (ej. cedente reenvió la remesa con valores correctos):
- **NO se hace por update directo en producción.**
- Se elimina la remesa (vía `imports.service.deleteRemesa`) y se reimporta.
- Si eso no es posible: usar un script one-off documentado en `prisma/scripts/` con auditoría manual, luego correr consolidación.

### 10.9 Deudor recién creado por `actualizaciones.processor` escenario B

El deudor se crea con `montoTotal = montoCalculado` y sin pagos en su tabla. La consolidación lo evalúa, `sum(pagos) === 0`, NO se toca (regla 4). Queda en el `defaults.estadoSituacionId` de la plantilla.

### 10.10 `prisma.deudor.update` directo en el consolidador esquiva el bloqueo SIT-050

Por diseño. El `DeudorBloqueoService` se usa en los services de negocio, no en el consolidador. El consolidador escribe directo con `prisma.deudor.update` / `updateMany` / `$executeRaw`. Documentar en el header del archivo para no confundir al implementer.

---

## 11. Plan de implementación por fases

### Fase 1 — Schema + helper de bloqueo (1 PR)

1. Editar `backend/prisma/schema.prisma`: agregar `saldo Float?` y `situacionConsolidadaEn DateTime?` en `model deudor`. Agregar índice.
2. Correr `npx prisma db push` + `npx prisma generate`.
3. Crear `backend/src/modules/deudores/utils/deudor-bloqueo.ts` con `DeudorBloqueoService`.
4. Exportar desde `DeudoresModule`. Importar en `ComentariosModule`, `ConveniosModule`, `ContactosModule`, `NeotelModule`.
5. Inyectar y agregar `await this.bloqueo.assertNoBloqueado(deudorId, 'X')` en cada superficie listada en §8.2.
6. Tests unitarios: el helper con/sin SIT-050 seedeado, deudor cancelado vs no cancelado.

### Fase 2 — Servicio core de consolidación (1 PR)

1. Crear `backend/src/modules/consolidacion/` con `module`, `service`, `dto`, `interfaces`.
2. Implementar `ConsolidacionSituacionService.consolidar` con todos los scopes y dry-run.
3. Variable de entorno `CONSOLIDACION_TOLERANCIA_PCT` con validación de rango.
4. Tests unitarios cubriendo: pago exacto = total, pago < tolerancia, pago > tolerancia, deudor sin pagos, pagos > total, idempotencia (correr 2x mismo input).

### Fase 3 — Integración en processors (1 PR)

1. Modificar `processor.interface.ts`: agregar `consolidacion: ConsolidacionSituacionService` en `ProcessContext`.
2. Modificar `ImportService.processImportJob`: inyectar `ConsolidacionSituacionService` y pasarlo al `ctx`.
3. Agregar `afterAll` a `PagosProcessor`.
4. Modificar `ActualizacionesProcessor`:
   - **Eliminar** las 3 líneas que pisan `montoTotal` (~277, ~304, ~356).
   - Modificar `afterAll` para llamar a consolidación.
5. Backfill: snapshot, db push paso 1 (UPDATE saldo = montoTotal), correr consolidación `TODAS` en preview, revisar, aplicar.

### Fase 4 — Job BullMQ + endpoints REST (1 PR)

1. `ConsolidacionProcessor` (worker).
2. `BullModule.registerQueue({ name: 'consolidacion-queue' })` en `ConsolidacionModule`.
3. Permiso `consolidacion.ejecutar` en `permisos-catalogo.ts` (ambos archivos) y `seed.ts`.
4. `ConsolidacionController` con los 3 endpoints (`/preview`, `/aplicar`, `/estado`).
5. Lock Redis para concurrencia.
6. Tests de integración: preview no escribe, apply sí, 409 si hay job activo.

### Fase 5 — Frontend (1 PR)

1. Modificar `FichaHeader.tsx` para mostrar Original + Saldo desde el campo `saldo`.
2. Modificar `FichaDeudor.tsx` para derivar `cuentaCancelada` y propagar `disabled`.
3. Modificar `FichaEstadosCard`, `FichaContactosPanel` y tabs/modales relevantes para respetar `disabled`.
4. Nuevo componente `ConsolidacionModal.tsx` (preview → confirm → progreso) reutilizable.
5. Botón "Consolidar" en `ImportHistory.tsx` (por remesa) y/o nueva página `ConsolidacionPage.tsx` (admin / batch global).
6. Manejo del 409 con snackbar.

### Fase 6 — Hardening + observabilidad (1 PR opcional)

1. Cron diario (3 AM) que corre consolidación `TODAS` como red de seguridad. Solo si el usuario lo pide.
2. Dashboard de "histórico de consolidaciones" con la auditoría.
3. Métricas: latencia promedio por chunk, ratio aSIT050/aSIT041 a lo largo del tiempo.

---

## 12. Changelog del spec

### 2026-06-30

- Spec inicial definido con el architect a partir de los requisitos confirmados con el usuario.
- Decisión clave: `saldo` persistido (no calculado), `montoTotal` inmutable, bloqueo derivado de `estadoSituacionId == SIT-050`, tolerancia configurable via env, un solo job a la vez con lock Redis.
- Sin implementación todavía. La Fase 1 arranca cuando se apruebe el spec.
