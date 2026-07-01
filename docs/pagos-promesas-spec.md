# Carga manual de pagos + Promesas de pago

**Proyecto:** AMSA Gestión
**Módulos involucrados:** nuevos `pagos` y `promesas`; modificados `imports` (processors `pagos` y `actualizaciones`), `consolidacion` (reuso, sin cambios de lógica), `deudores` (bloqueo), `empresas` (config), `auth` (permisos)
**Fecha:** 2026-07-01
**Estado:** Aprobado para implementación — **v2** tras revisión adversarial del architect y decisiones del usuario.

---

## 0. Resumen ejecutivo

Dos capacidades, cargables desde la **solapa de Pagos** de la ficha del deudor con un único modal con toggle:

1. **Pago real manual**: el operador verifica en el sistema del cliente que un deudor pagó (antes de que llegue por la bajada) y lo carga a mano. Al crearlo/eliminarlo se dispara la **consolidación** (recalcula `saldo` y código).
2. **Promesa de pago**: el deudor promete pagar tal día. Se registra siempre; **solo cambia el código a SIT-020 si el deudor no tiene pagos**. Al vencer sin pago → **SIT-021**; si paga → **CUMPLIDA** (código lo pone la consolidación).

Puntos críticos resueltos en esta v2:

- **Semántica del archivo de actualización (confirmada):** trae **el saldo que queda por pagar** (outstanding), como valor único por deudor. Fórmula: `pagado = montoTotalOriginal − saldoArchivo`; se crea pago solo por `pagado − Σpagos`.
- **Interacción promesa/consolidación:** se evita el conflicto **no cambiando el código a SIT-020 cuando hay pagos**. Así la consolidación queda **intacta** (ya saltea deudores con Σpagos=0, que son los únicos que llevan SIT-020).
- **Anti-duplicación** entre carga manual y bajadas (categorías `PAGOS` y `ACTUALIZACIONES`).

### Bug preexistente que este spec corrige

`actualizaciones.processor` hoy calcula `delta = montoTotalOriginal − saldoArchivo` y crea un pago por **el delta completo, sin restar los pagos ya existentes**. Con el archivo trayendo el saldo actual (cumulativo), esto **duplica en actualizaciones sucesivas** (semana a semana suma de nuevo todo lo pagado) y duplicaría cualquier pago manual. Se corrige restando `Σpagos` (§3.2).

---

## 1. Reglas de negocio (confirmadas con el usuario)

| # | Regla |
|---|-------|
| 1 | Un **pago real** es un registro en `pago`. Al crearlo/eliminarlo se **consolida** el deudor (`consolidar({tipo:'DEUDORES', deudorIds:[id]})`). |
| 2 | La **promesa** NO es un pago (no mueve `saldo`). Vive en `promesa_pago` y **puede o no** cambiar el código. |
| 3 | **Anti-dup ACTUALIZACIONES**: el archivo trae **el saldo que queda** (valor único por deudor). `pagado = montoTotalOriginal − saldoArchivo`; `delta = pagado − Σpagos`; se crea pago solo por `delta` positivo. |
| 4 | **Anti-dup PAGOS** (detallado): antes de crear, se busca un pago `MANUAL` **no confirmado** del deudor con **importe exacto**; si existe → `confirmadoImport=true` (no duplica); si no → crea. Limitación aceptada: dos pagos reales del mismo importe. |
| 5 | **Promesa siempre se registra** (salvo bloqueo SIT-050). El código pasa a **SIT-020 solo si Σpagos=0**. Si el deudor ya tiene pagos (parcial/pagando), la promesa se guarda pero **el código no se toca**. |
| 6 | **Bloqueo SIT-050**: crear pago, eliminar pago y crear promesa están bloqueados si el deudor está en SIT-050. Consecuencia asumida: revertir una cancelación errónea requiere que un admin saque el SIT-050 primero. |
| 7 | **Cumplimiento de promesa**: si entra un pago (manual o bajada) que aumenta `Σpagos` respecto de cuando se creó la promesa → **CUMPLIDA**. El código lo pone la consolidación (SIT-041/050). Se detecta comparando `Σpagos` actual vs. `pagosAlCrear` (snapshot). |
| 8 | **Vencimiento de promesa**: el cron detecta las vencidas **por los registros `promesa_pago`** (`fechaPromesa < hoy`, `estado=VIGENTE`), **sin importar el código**. Sin pago → **INCUMPLIDA**; se setea **SIT-021 solo si el deudor sigue en SIT-020**. |
| 9 | La `fechaPromesa` no puede superar **hoy + maxDías** (default 7, parametrizable por empresa en `empresa.configuracion`). |
| 10 | Una promesa/pago **no se excluye automáticamente** de llamadas/mails: lo maneja la operación al armar bases no eligiendo los códigos. Sin lógica de exclusión. |
| 11 | Toda mutación (crear/eliminar pago, crear/anular promesa, cierres del cron) se **audita** (`@Audit` / best-effort en el cron). |

---

## 2. Schema (Prisma)

> `npx prisma db push` (NO `migrate dev`).

### 2.1 Extensión de `model pago`

```prisma
model pago {
  id               Int      @id @default(autoincrement())
  deudorId         Int
  fecha            DateTime
  importe          Float
  origenArchivo    String?
  observacion      String?
  // NUEVOS:
  origen           String?   // 'MANUAL' | 'IMPORT_PAGOS' | 'IMPORT_ACTUALIZACION' | 'CONVENIO'
  usuarioId        Int?
  confirmadoImport Boolean   @default(false)
  confirmadoEn     DateTime?
  deudor           deudor    @relation(fields: [deudorId], references: [id], map: "Pago_deudorId_fkey")
  usuario          usuario?  @relation(fields: [usuarioId], references: [id])

  @@index([deudorId], map: "Pago_deudorId_fkey")
  @@index([fecha], map: "Pago_fecha_idx")
  @@index([deudorId, fecha], map: "Pago_deudorId_fecha_idx")
  @@index([deudorId, origen, confirmadoImport], map: "Pago_dedup_idx")
}
```

- `origen` nullable: los pagos históricos quedan `null` → el claim (§3.1) **nunca** los reclama (solo aplica a pagos MANUAL nuevos). Correcto por diseño.
- Backfill opcional (no obligatorio): mapear `origen` histórico desde `origenArchivo`.

### 2.2 Nuevo `model promesa_pago`

```prisma
model promesa_pago {
  id                  Int       @id @default(autoincrement())
  deudorId            Int
  usuarioId           Int?
  fechaPromesa        DateTime
  monto               Float?              // opcional (monto prometido)
  estado              String    @default("VIGENTE") // VIGENTE | CUMPLIDA | INCUMPLIDA | ANULADA
  cambioSit020        Boolean   @default(false)     // si esta promesa cambió el código a SIT-020
  situacionAnteriorId Int?                // para revertir al anular (solo si cambioSit020)
  pagosAlCrear        Float     @default(0)         // snapshot Σpagos al crear → detectar cumplimiento
  observacion         String?
  createdAt           DateTime  @default(now())
  cerradaEn           DateTime?
  deudor              deudor     @relation(fields: [deudorId], references: [id])
  usuario             usuario?   @relation(fields: [usuarioId], references: [id])
  situacionAnterior   parametro? @relation("PromesaSituacionAnterior", fields: [situacionAnteriorId], references: [id])

  @@index([deudorId])
  @@index([estado, fechaPromesa])
  @@index([estado])
}
```

- Relaciones inversas: `deudor.promesas`, `usuario.promesas`, `usuario.pagosManuales`, `parametro` (relación nombrada).
- **Una VIGENTE por deudor**: al crear una nueva, la VIGENTE previa pasa a `ANULADA`; la nueva hereda `cambioSit020` y `situacionAnteriorId` (el SIT actual podría ya ser SIT-020).

---

## 3. Anti-duplicación (núcleo)

### 3.1 Categoría PAGOS (detallado) — claim por importe exacto

En `pagos.processor.processRow` (`backend/src/modules/imports/processors/pagos.processor.ts` ~51-59), antes del `create`:

```
claim = pago del deudor con origen='MANUAL' AND confirmadoImport=false AND ABS(importe − row.importe) <= ε, orderBy fecha asc, LIMIT 1
si claim: UPDATE {confirmadoImport:true, confirmadoEn:now, origenArchivo:<remesa>}  // NO crea
si no:    crear pago(origen='IMPORT_PAGOS', ...)  // comportamiento actual
```

- Un claim por fila (no consume dos manuales con una fila).
- `processedDeudorIds` se trackea igual (creado o confirmado → deudor tocado → consolida en afterAll).

### 3.2 Categoría ACTUALIZACIONES — reconciliación por total

**Confirmado con el usuario:** el archivo trae, por deudor, **el saldo que queda por pagar** (valor único). El processor hoy lo lee en `row.montoTotal` (nombre engañoso del mapping — es el saldo, no el original). El original inmutable es `deudor.montoTotal`.

**Rama de valor único (la que usan los cedentes) — `actualizaciones.processor.ts` ~270-296:**

```
saldoArchivo = row.montoTotal            // = saldo pendiente informado
objetivoPagado = deudor.montoTotal − saldoArchivo   // cuánto debería estar pagado (cumulativo)
yaPagado       = Σ(pagos del deudor)
delta          = objetivoPagado − yaPagado
if (delta > ε)  crear pago(importe=delta, origen='IMPORT_ACTUALIZACION')
if (delta < -ε) // el archivo informa MÁS saldo del que teníamos = la deuda creció:
                // NO es un "des-pago". Mantener la rama actual de "factura de ajuste"
                // (deuda creció → nueva factura), que es un caso distinto de pagos.
```

- Absorbe el pago manual: objetivo 2 facturas, ya pagado 1 (manual) → delta = 1 → carga solo la nueva.
- Arregla la duplicación de actualizaciones sucesivas.

**Escenario C (afterAll, deudor ausente = pagó todo) — ~308-359:**

```
delta = deudor.montoTotal − Σpagos     // saldo restante
if (delta > ε) crear pago(importe=delta, origen='IMPORT_ACTUALIZACION')
marcar facturas PENDIENTE→PAGADA SOLO si (delta > ε) o si ya Σpagos ≥ montoTotal·(1−tol)
// si delta ≤ ε (ya estaba sobre/completamente pagado) → no crear pago, no forzar facturas, warn
```

**Fuera de alcance (documentado):** la **rama por `nroFactura`** (bloques de factura, ~200-268) también crea pagos automáticos y también duplicaría, pero **los cedentes de este proyecto mandan valor único de saldo**, así que no se toca en esta iteración. ⚠️ Si a futuro algún cedente manda actualización detallada por factura, hay que aplicarle el mismo claim por importe (§3.1) antes de habilitarla — dejar un `warn`/nota en esa rama.

**Cumplimiento de promesa en el afterAll** (ver §5.5): tras consolidar los `processedDeudorIds`, cerrar sus promesas VIGENTE que hayan quedado cumplidas.

### 3.3 Epsilon

ε = 1 peso (mismo criterio que la consolidación para ruido de float). Exponer `SALDO_EPSILON` en un único lugar y reutilizarlo.

> ⚠️ `actualizaciones.processor` es crítico y ya está en producción. El cambio toca la rama de valor único + escenario C. **Tests obligatorios** antes de deploy (§13).

---

## 4. Backend — Módulo `pagos`

Nuevo módulo `backend/src/modules/pagos/`. Inyecta `ConsolidacionSituacionService`, `DeudorBloqueoService` y `PromesasService` (para cerrar promesas cumplidas).

### 4.1 Endpoints

| Método | Ruta | Permiso | Descripción |
|--------|------|---------|-------------|
| POST | `/pagos` | `pagos.crear` | Crea pago manual. `{ deudorId, fecha, importe, observacion? }`. |
| DELETE | `/pagos/:id` | `pagos.eliminar` | Elimina un pago (solo `origen='MANUAL'`; ver I8) y reconsolida. |
| GET | `/pagos?deudorId=` | `pagos.ver` | Lista (opcional; la ficha ya los trae vía `GET /deudores/:id`). |

### 4.2 `PagosService.crearManual(dto, usuarioId)`

```
$transaction:
  1. assertNoBloqueado(deudorId, 'cargar pago')          // regla 6
  2. crear pago { origen:'MANUAL', usuarioId, fecha, importe, observacion }
  (fin transacción)
  3. consolidar({tipo:'DEUDORES', deudorIds:[deudorId]}) // idempotente, fuera de la tx
  4. PromesasService.cerrarCumplidas([deudorId])         // §5.5 (marca CUMPLIDA si Σpagos subió)
  5. auditar
```

- La consolidación queda fuera de la transacción (es idempotente y hace su propia `$transaction`). Si crashea entre 2 y 3, el operador reintenta o corre "Consolidar" — se recupera.

### 4.3 `PagosService.eliminar(id, usuarioId)`

```
1. leer pago → { deudorId, origen }
2. si origen != 'MANUAL' → 400 (o override admin explícito) + warn/auditoría alta   // I8
3. assertNoBloqueado(deudorId, 'eliminar pago')          // regla 6
4. borrar pago; consolidar({tipo:'DEUDORES', deudorIds:[deudorId]})
5. auditar
```

---

## 5. Backend — Módulo `promesas`

Nuevo módulo `backend/src/modules/promesas/`. Cachea `SIT-020`/`SIT-021` por clave en `onModuleInit` (patrón de la consolidación). Inyecta `DeudorBloqueoService`, lee config de empresa. **No modifica la consolidación.**

### 5.1 Endpoints

| Método | Ruta | Permiso | Descripción |
|--------|------|---------|-------------|
| POST | `/promesas` | `promesas.crear` | `{ deudorId, fechaPromesa, monto?, observacion? }`. |
| GET | `/promesas?deudorId=` | `promesas.ver` | Lista promesas del deudor. |
| PATCH | `/promesas/:id/anular` | `promesas.cancelar` | Anula una VIGENTE (revierte SIT si corresponde). |
| POST | `/promesas/procesar-vencidas` | `promesas.procesar_vencidas` | Dispara el proceso del cron a mano (ADMIN). |

### 5.2 `PromesasService.crear(dto, usuarioId)`

```
$transaction (con lectura consistente del deudor):
  1. assertNoBloqueado(deudorId, 'cargar promesa')                  // regla 6
  2. validar fechaPromesa <= hoy + maxDias(empresa) (y maxDias válido, M3)  // regla 9
  3. Σpagos = sum(pagos del deudor); situActual = deudor.estadoSituacionId
  4. si hay promesa VIGENTE → ANULADA (superseded); heredar cambioSit020 / situacionAnteriorId
  5. cambiaCodigo = (Σpagos == 0)                                   // regla 5
  6. crear promesa {
        estado:'VIGENTE', fechaPromesa, monto, observacion, usuarioId,
        pagosAlCrear: Σpagos, cambioSit020: cambiaCodigo,
        situacionAnteriorId: cambiaCodigo ? situActual : null
     }
  7. si cambiaCodigo:
        UPDATE deudor SET estadoSituacionId = SIT-020
        WHERE id = ? AND estadoSituacionId = situActual   // update condicional (I5)
        si 0 filas → 409 (la situación cambió; refrescar ficha)
  8. auditar
```

- **Update condicional** (paso 7) cierra la race con una consolidación/bajada concurrente (I5): si entre el paso 3 y el 7 el deudor cambió de código (p.ej. entró un pago), no se pisa.

### 5.3 `PromesasService.anular(id, usuarioId)`

```
1. leer promesa VIGENTE → { deudorId, cambioSit020, situacionAnteriorId }
2. estado=ANULADA, cerradaEn=now
3. si cambioSit020 AND deudor.estadoSituacionId == SIT-020:
     si situacionAnteriorId != null AND parametro(situacionAnteriorId).activo:
        estadoSituacionId = situacionAnteriorId
     else:
        no restaurar (dejar como está) + warn        // C5
4. auditar
```

### 5.4 `PromesasSchedulerService` (`@Cron`)

`@nestjs/schedule` ya instalado; `ScheduleModule.forRoot()` ya registrado (reportes). Basta un provider con `@Cron` (patrón `reportes/ejecuciones/ejecuciones.cleanup.ts`).

```
@Cron(EVERY_DAY_AT_2AM)   // o env
async procesarVencidas():
  lock Redis simple (reusar patrón consolidacion-redis-lock) para no solaparse con el endpoint manual  // M5
  vencidas = promesa_pago WHERE estado='VIGENTE' AND fechaPromesa < inicioDeHoy   // por registros, no por código (regla 8)
  para cada p:
    Σpagos = sum(pagos del deudor)
    if (Σpagos > p.pagosAlCrear + ε):                 // cumplió (entró pago después de crear)
        p.estado=CUMPLIDA, cerradaEn=now              // el código ya lo puso la consolidación
    else:                                             // no cumplió
        p.estado=INCUMPLIDA, cerradaEn=now
        if deudor.estadoSituacionId == SIT-020:       // solo si la promesa había cambiado el código
            estadoSituacionId = SIT-021
        // si el deudor tiene código por pagos (SIT-041/040/...), NO se pisa: la promesa
        // queda INCUMPLIDA solo en su registro (visible en historial/reportes).
```

- El **cumplimiento temprano** (pago que entra antes de vencer) se cierra en `§5.5` (hook del afterAll y del pago manual), no solo acá.

### 5.5 `PromesasService.cerrarCumplidas(deudorIds[])`

Llamado desde: `PagosService.crearManual` (paso 4) y desde el `afterAll` de los processors `PAGOS` y `ACTUALIZACIONES` (tras consolidar los `processedDeudorIds`) — elimina la ventana de inconsistencia (I6).

```
para cada deudorId con promesa VIGENTE:
  Σpagos = sum(pagos)
  if (Σpagos > promesa.pagosAlCrear + ε):
     promesa.estado=CUMPLIDA, cerradaEn=now   // el código lo puso la consolidación
```

---

## 6. Parámetro por empresa: `maxDías`

- `empresa.configuracion` JSON: `{ "promesa_pago": { "maxDias": 7 } }`. Default 7.
- **Validar** (M3): `maxDias` numérico y `1 ≤ maxDias ≤ 30`; si no, usar default + `warn`.
- Edición: por el update de empresa (ya acepta `configuracion`). UI dedicada = fase posterior.

---

## 7. Permisos

`backend/src/auth/permisos-catalogo.ts` + `frontend/src/utils/permisosCatalogo.ts`:

```
Pagos:            pagos.ver | pagos.crear | pagos.eliminar
Promesas de pago: promesas.ver | promesas.crear | promesas.cancelar | promesas.procesar_vencidas
```

- `promesas.procesar_vencidas` = ADMIN (no `promesas.crear`) — I7. ADMIN recibe todos por defecto.

---

## 8. Bloqueo SIT-050

- `DeudorBloqueoService.assertNoBloqueado(deudorId, accion)` en: crear pago, eliminar pago (I8: además solo MANUAL), crear promesa.
- Sin bloqueo en processors de import ni en la consolidación (como hoy).
- Consecuencia asumida (regla 6): revertir cancelación errónea requiere admin que saque SIT-050 primero.

---

## 9. Frontend

Base: `frontend/src/components/deudores/ficha/`.

### 9.1 `NuevoPagoModal` (nuevo, sobre `modals/PagoCuotaModal.tsx`)

- Toggle superior: **Pago real** | **Promesa de pago**.
- Pago real: `fecha` (default hoy), `importe`, `observacion?` → `POST /pagos`.
- Promesa: `fechaPromesa` (`max` = hoy + maxDías empresa, con hint), `monto?`, `observacion?` → `POST /promesas`. Manejar `409` (situación cambió → sugerir refresh).
- `onSaved` → `cargarInicial()` (refetch deudor: `saldo`, `estadoSituacion`, `pagos`) + refetch de promesas si se muestran aparte.

### 9.2 `FichaPagosTab` (extender)

- Botón **"Cargar"** (`pagos.crear`), columna **Origen** + badge **"Confirmado por bajada"** (`confirmadoImport`), acción **eliminar** por fila (`pagos.eliminar`, solo MANUAL) con confirmación.

### 9.3 Promesa vigente

- Mostrar promesa VIGENTE (fecha + monto + estado) en el header/situación o como sección de la solapa. Útil sobre todo para deudores con pago parcial (donde el código NO es SIT-020 pero hay promesa activa).

### 9.4 `FichaDeudor.tsx`

- Estado `openModalPago`, handlers, `onSaved` → `cargarInicial()` (patrón `handlePagoCuotaSaved`, ~240-243 / ~400-406).

---

## 10. Auditoría

`@Audit` en crear/eliminar pago y crear/anular promesa; best-effort en los cierres del cron.

---

## 11. Edge cases

| Caso | Comportamiento |
|------|----------------|
| Pago manual sobre `montoTotal=0` | La consolidación lo marcaría SIT-050. Se asume `montoTotal` correcto (feature de facturas). |
| Dos pagos reales del mismo importe | La bajada consume el manual (claim); un segundo real del mismo importe se crea igual. **Limitación aceptada.** |
| Dos pagos MANUAL del mismo importe, bajada trae uno | La bajada confirma uno; el otro manual queda sin confirmar. Ver reporte sugerido abajo. |
| Actualización informa más saldo (`delta<0`) | No es des-pago: rama de factura de ajuste (deuda creció), se mantiene. |
| Promesa en deudor con pago parcial | Permitida; **no** cambia el código (queda SIT-041). Se trackea en `promesa_pago`. |
| Promesa nueva con una VIGENTE previa | La previa → ANULADA; la nueva hereda `cambioSit020`/`situacionAnteriorId`. |
| Pago antes de vencer la promesa | `cerrarCumplidas` (manual o afterAll) la marca CUMPLIDA; código por consolidación. |
| Promesa vencida sin pago, deudor con código por pagos | INCUMPLIDA en el registro; el código (SIT-041/…) **no** se pisa (solo SIT-021 si estaba en SIT-020). |
| `situacionAnteriorId` null/desactivado al anular | No restaurar; `warn`. |
| Eliminar un pago no-MANUAL | 400 (o override admin) + auditoría alta; si no, la bajada lo re-crearía. |

**Reporte operativo sugerido** (fuera de alcance de core): "pagos MANUAL sin confirmar por bajada con antigüedad > N días" para revisión.

---

## 12. Fases de implementación

1. **Schema** (`pago` + `promesa_pago` + relaciones) → `db push` + `generate`. Permisos back/front.
2. **Módulo `pagos`**: crear/eliminar manual + consolidación + bloqueo + `cerrarCumplidas` + auditoría.
3. **Módulo `promesas`**: crear/anular + cache SIT-020/021 + `cerrarCumplidas` + cron + endpoint manual + lock.
4. **Anti-dup en processors**: `pagos.processor` (claim) + `actualizaciones.processor` (reconciliación por total, rama valor único + escenario C) + hook `cerrarCumplidas` en afterAll. **Tests (§13).**
5. **Frontend**: `NuevoPagoModal` (toggle) + botón/eliminar en `FichaPagosTab` + refetch + promesa vigente.
6. **Config empresa** `maxDías` + doc + CHANGELOG.

---

## 13. Tests que bloquean el deploy

**`actualizaciones.processor` (alto riesgo, sin tests hoy):**
- Actualización única (saldo) → pago correcto (`original − saldo`).
- Actualización sucesiva (semana N+1) → **no duplica** (resta Σpagos).
- Actualización con pago manual previo → **absorbe** (delta incremental).
- Escenario B (deudor nuevo) → sin regresión.
- Escenario C (deudor ausente) → reconcilia contra Σpagos; facturas PAGADA solo si `delta>ε`.
- `delta<0` (deuda creció) → rama de ajuste, no des-pago.

**`pagos.processor` (claim):** manual + bajada mismo importe → 1 confirmación, sin duplicar; dos reales mismo importe → ambos.

**Pagos manuales:** crear → consolida (saldo/código); eliminar → revierte; idempotencia; bloqueo SIT-050.

**Promesas:** Σpagos=0 → SIT-020; parcial → sin cambio de código; vencida sin pago → INCUMPLIDA (+SIT-021 solo si estaba SIT-020); pago antes/después → CUMPLIDA; anular → revierte SIT solo si corresponde; race de update condicional; maxDías por empresa.

---

## 14. Acciones de despliegue

1. `prisma db push` (campos nuevos de `pago` + tabla `promesa_pago`, no destructivo). `deploy.sh` ya corre `db push`.
2. Seedear/asignar permisos nuevos a ADMIN (patrón `consolidacion.ejecutar`).
3. **Redeploy backend** (incluye el cron — verificar arranque + el lock).
4. Sin backfill obligatorio. Opcional: `origen` de pagos históricos.
5. Env opcional para horario del cron.

> Referencias: processors en `backend/src/modules/imports/processors/`; consolidación en `backend/src/modules/consolidacion/`; bloqueo en `backend/src/modules/deudores/utils/deudor-bloqueo.ts`; SIT-020/021 en `backend/prisma/seed-codigos-curados.ts` (líneas 82-83); ficha en `frontend/src/components/deudores/ficha/`; cron ejemplo en `backend/src/modules/reportes/ejecuciones/ejecuciones.cleanup.ts`.
