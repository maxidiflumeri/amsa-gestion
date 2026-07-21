# Actualización diaria de gestión + Parser multi-registro (Toyota)

**Proyecto:** AMSA Gestión
**Módulos involucrados:**
- Feature A: `imports` (processor `ACTUALIZACIONES`, `MappingJson`), `deudores` (nueva columna), `parametros` (uso de GES-094), frontend `PlantillaEditor`.
- Feature B: `imports` (nueva categoría + parser + processor), `deudores`, `contactos`, `facturas`, frontend `PlantillaEditor` + `MappingEditor`.
**Fecha:** 2026-07-17
**Estado:**
- **Feature A — IMPLEMENTADA** (2026-07-17). Ver CHANGELOG. Decisiones aplicadas: D1 flag separado, D2 columna, D3 selector visible en ambos modos, D4 sin comentario en timeline, D5 auditoría 1 por batch.
- **Feature B — pendiente de implementar.** Decisión confirmada: **D6 = GES-090** para BAJ. Resto de decisiones (D7–D10) con el default recomendado del arquitecto.

---

## 0. Resumen ejecutivo

Dos features del módulo de imports, con distinto grado de fricción sobre el pipeline actual y por lo tanto priorizadas separadamente:

### Feature A — "Actualización diaria de gestión"

Extensión de la categoría **ACTUALIZACIONES** existente. Reutiliza casi todo el processor actual y solo cambia **qué se hace con los deudores que estaban en la remesa origen pero NO aparecieron en el archivo diario**. Hoy ese caso (Escenario C) los marca como "pagó todo" (facturas PAGADAS + pago por el total → consolidación → **SIT-050**). El flujo diario tipo *Fiat MT / Fiat Prelegal* necesita que esos deudores queden **DESASIGNADOS** (`estadoGestionId = GES-094`), **sin tocar deuda ni pagos**. Se agrega además un mecanismo de **re-asignación idempotente**: si mañana el mismo deudor vuelve a aparecer en el archivo diario, se lo saca de GES-094 y se le restaura el estado de gestión previo.

Cambio principal: **nuevo flag `accionAusente: 'PAGO_TODO' | 'DESASIGNAR' | 'IGNORAR'`** en el `MappingJson` de ACTUALIZACIONES (default `PAGO_TODO` = comportamiento clásico, retrocompat total), y **nueva columna `deudor.estadoGestionPrevioAId`** para permitir la re-asignación reversible.

**Prioridad: ALTA**. Es la más pedida, reutiliza el 90% del código, riesgo bajo.

### Feature B — Parser multi-registro (Toyota cuenta 87)

Un archivo `.txt` donde cada línea empieza con un código de tipo de registro (`GES`, `CLI`, `DET`, `BAJ`) y varias líneas se agrupan por nro de contrato para armar **un** deudor. El pipeline actual asume "1 fila = 1 deudor + bloques repetitivos por columnas"; este modelo NO encaja. Se resuelve con un **adapter pre-processor** que agrupa líneas → filas normalizadas y las inyecta al pipeline existente, más una **nueva categoría `MULTIRREGISTRO`** con su propio processor y una config de mapeo por tipo de registro.

Enfoque de menor fricción: el mapping actual (`fromIndex` sobre columnas de una fila) se preserva por tipo de registro; el resto del pipeline (validación fila-a-fila, batch, progreso, errores) queda intacto.

**Prioridad: MEDIA**. Es una integración nueva completa; no es urgente hasta que Toyota efectivamente arranque a operarse.

---

# FEATURE A — Actualización diaria de gestión

## A.1. Contexto y análisis de impacto

### A.1.1. Estado actual

`ActualizacionesProcessor` (`backend/src/modules/imports/processors/actualizaciones.processor.ts`) implementa tres escenarios:

- **A**: deudor encontrado en remesa origen → reconcilia deuda (por `nroFactura` o por `montoTotal`).
- **B**: deudor en el archivo pero no en la remesa origen → crea deudor nuevo en la remesa de la actualización. Controlado por flag `crearNuevosCasos` (default `true`).
- **C** (`afterAll`): deudor en la remesa origen ausente del archivo → marca todas las facturas `PAGADA` + genera un pago por el total → la consolidación posterior lo lleva a **SIT-050**.

Modos:
- `RECONCILIAR` (default): los tres escenarios corren.
- `SOLO_DATOS`: solo identidad (DNI) + adicionales; no reconcilia deuda, no marca ausentes, no crea nuevos.

Además existen `comportamientoDeudaMayor` y `crearNuevosCasos` como flags accesorios.

### A.1.2. Diferencia semántica del "diario"

En la operatoria diaria de Fiat MT / Fiat Prelegal (y previsiblemente otras carteras análogas):
- El cedente manda **todos los días** un archivo con **la lista de casos a gestionar ese día**.
- Un deudor que no aparece en el archivo de hoy **no pagó** ni fue cancelado: fue **removido de la cartera de gestión** para hoy (motivos varios: quedó en otra área, se le suspendió gestión, etc.). Puede volver a aparecer mañana.
- La reconciliación de deuda de los presentes sigue siendo válida (el archivo trae el saldo actualizado).

Marcar a esos deudores como "pagó todo" (SIT-050) es semánticamente **incorrecto** y además destructivo: SIT-050 bloquea el deudor (ver `consolidacion-situacion-spec.md §1.2`) y borrar esa marca requiere intervención administrativa. Un mal día de bajada podría "cancelar" media cartera.

### A.1.3. Módulos y contratos afectados

| Módulo / archivo | Impacto |
|---|---|
| `backend/prisma/schema.prisma` (model `deudor`) | Nueva columna `estadoGestionPrevioAId Int?` + índice. |
| `backend/src/modules/imports/mapping-types.ts` | Nuevo `AccionAusenteActualizacion` type y campo `accionAusente?` en `MappingJson`. |
| `backend/src/modules/imports/processors/processor.interface.ts` | Nuevo `accionAusente: AccionAusenteActualizacion` en `ProcessContext`. |
| `backend/src/modules/imports/imports.service.ts` | Lectura del flag + resolución con default seguro (`PAGO_TODO`). |
| `backend/src/modules/imports/processors/actualizaciones.processor.ts` | Rama nueva en `afterAll` + rama de re-asignación en el flujo de deudores presentes. |
| `backend/src/modules/consolidacion/*` | Ningún cambio (la desasignación no toca `estadoSituacionId`, solo `estadoGestionId`). |
| `backend/src/modules/deudores/utils/deudor-bloqueo.ts` | Ningún cambio (guard sigue basándose en SIT-050). |
| `frontend/src/pages/PlantillaEditor.tsx` | Nuevo selector "Acción para deudores ausentes del archivo". |
| Auditoría (`AuditoriaHelper`) | Nuevo tipo de evento por desasignación / re-asignación. |

### A.1.4. Interacciones críticas

- **SIT-050 bloqueado**: un deudor cancelado **no se desasigna** ni **se re-asigna** — la lógica de desasignar/re-asignar debe respetar el bloqueo (skip + warn).
- **Consolidación**: la consolidación solo mueve `estadoSituacionId` y `saldo`. `estadoGestionId` es ortogonal → no hay conflicto. En modo `DESASIGNAR` NO se generan pagos por el escenario C, así que la consolidación de la remesa origen sigue corriendo pero no tocará a los ausentes (Σpagos == 0, regla 4 del spec de consolidación).
- **Promesas**: si un deudor con promesa `VIGENTE` no vino en el archivo diario → **se desasigna igual**. La promesa queda vigente y su cron sigue funcionando. Argumento: la desasignación es de gestión, no financiera.
- **Modo `SOLO_DATOS`**: la nueva flag es ortogonal al modo. Combinaciones válidas:
  - `SOLO_DATOS` + `IGNORAR` (recomendado, evita comportamientos raros).
  - `SOLO_DATOS` + `DESASIGNAR` (posible: solo actualiza identidad de los presentes y desasigna los ausentes, sin tocar deuda). Casos de uso: archivos que traen la lista de casos + DNI sin saldo.
  - `SOLO_DATOS` + `PAGO_TODO` → **no permitido** (contradictorio, el flujo original ya lo ignora). Enforcement en el service.

## A.2. Reglas de negocio

| # | Regla |
|---|-------|
| A1 | `accionAusente` define qué hacer con deudores de la remesa origen **ausentes del archivo**. Valores: `PAGO_TODO` (comportamiento actual, default), `DESASIGNAR` (nuevo), `IGNORAR`. |
| A2 | `DESASIGNAR` → `deudor.estadoGestionId = ID(GES-094)` y `deudor.estadoGestionPrevioAId = estadoGestionId anterior`. No toca deuda, ni facturas, ni pagos, ni situación. |
| A3 | **Re-asignación automática**: si un deudor presente en el archivo tiene `estadoGestionId == GES-094`, se restaura: `estadoGestionId = estadoGestionPrevioAId ?? defaults.estadoGestionId` y `estadoGestionPrevioAId = null`. Corre siempre que `accionAusente != IGNORAR`. |
| A4 | **Bloqueo SIT-050**: los deudores con `estadoSituacionId == ID(SIT-050)` NO se desasignan ni se re-asignan (skip + log). |
| A5 | **Idempotencia**: aplicar el mismo archivo N veces produce el mismo estado final. Si el deudor ya está en GES-094 y sigue ausente → no se hace nada; si el previo apuntado no existe/está inactivo → se cae al `defaults.estadoGestionId` de la plantilla. |
| A6 | Cambio de gestión disparado por desasignación/re-asignación **se audita** vía `AuditoriaHelper` con evento tipo `DESASIGNACION_MASIVA` / `REASIGNACION_MASIVA`. |
| A7 | Si `GES-094` no está seedeado (`parametro.clave='GES-094'` inexistente para esa empresa/global) → el processor loguea `warn` y **saltea el paso de desasignación** (modo degradado, análogo al `deudor-bloqueo` sin SIT-050). El resto del import sigue normalmente. |
| A8 | `accionAusente = DESASIGNAR` combinado con `modoActualizacion = SOLO_DATOS` es válido y compatible. `PAGO_TODO` + `SOLO_DATOS` se rechaza en la creación/edición de plantilla. |
| A9 | La reconciliación de deuda (Escenario A) para los deudores presentes **no cambia**: sigue funcionando exactamente como hoy. Solo cambia el `afterAll`. |

## A.3. Schema (Prisma)

> `npx prisma db push` (NO `migrate dev`).

### A.3.1. Cambios en `model deudor`

```prisma
model deudor {
  id                       Int           @id @default(autoincrement())
  // ...campos existentes...
  estadoGestionId          Int?
  // NUEVO — guarda el estadoGestionId previo cuando se desasigna, para poder revertir.
  estadoGestionPrevioAId   Int?
  estadoGestionPrevio      parametro?    @relation("DeudorEstadoGestionPrevio", fields: [estadoGestionPrevioAId], references: [id])
  // ...
  @@index([estadoGestionPrevioAId], map: "Deudor_estadoGestionPrevioAId_idx")
}
```

Y en `model parametro`, agregar el back-relation:

```prisma
model parametro {
  // ...
  deudoresGestionPrevio deudor[] @relation("DeudorEstadoGestionPrevio")
}
```

### A.3.2. Semántica del campo

- `null` en carga inicial + en re-asignación.
- Se completa **solo** al desasignar (transición `X → GES-094`), con el `X` anterior.
- Al re-asignar (`GES-094 → previo`), se limpia a `null`.
- Nunca lo tocan servicios de gestión manual — es un campo interno del processor.
- Si el deudor **nunca** fue tocado por el processor con `DESASIGNAR`, queda `null` para siempre. La columna no genera ruido en la ficha.

## A.4. Cambios de contrato

### A.4.1. `mapping-types.ts`

```ts
/**
 * Acción sobre deudores de la remesa origen que NO aparecen en el archivo de ACTUALIZACIONES.
 * - PAGO_TODO (default): comportamiento clásico. Todas sus facturas → PAGADA, pago por el total,
 *   la consolidación posterior los deja en SIT-050.
 * - DESASIGNAR: se les setea `estadoGestionId = GES-094` (guardando el previo para poder revertir).
 *   NO toca deuda, pagos, facturas ni situación. Los deudores con SIT-050 se ignoran.
 * - IGNORAR: no se hace nada con los ausentes (útil para archivos parciales o pruebas).
 */
export type AccionAusenteActualizacion = 'PAGO_TODO' | 'DESASIGNAR' | 'IGNORAR';

export interface MappingJson {
  // ...campos existentes...
  /** Acción para deudores de la remesa origen ausentes del archivo (default `PAGO_TODO`). */
  accionAusente?: AccionAusenteActualizacion;
}
```

Validación en el service al **guardar** la plantilla (evita combinaciones incoherentes):

```ts
if (mapping.modoActualizacion === 'SOLO_DATOS' && mapping.accionAusente === 'PAGO_TODO') {
  throw new BadRequestException(
    'Modo "Solo datos" es incompatible con acción de ausentes "Marcar como pagado". ' +
    'Usá "Desasignar" o "Ignorar".',
  );
}
```

### A.4.2. `processor.interface.ts`

```ts
export interface ProcessContext {
  // ...campos existentes...
  /** Acción para deudores ausentes en ACTUALIZACIONES (default `PAGO_TODO`). */
  accionAusente: AccionAusenteActualizacion;
}
```

### A.4.3. `imports.service.ts` (worker `processImportJob`)

```ts
// Default seguro: PAGO_TODO = comportamiento clásico (retrocompatible).
const accionAusente: AccionAusenteActualizacion =
  mapping?.accionAusente === 'DESASIGNAR' ? 'DESASIGNAR' :
  mapping?.accionAusente === 'IGNORAR'    ? 'IGNORAR'    :
  'PAGO_TODO';

// ... en el ctx:
const ctx: ProcessContext = {
  // ...
  accionAusente,
  // ...
};
```

## A.5. Pseudocódigo del processor modificado

### A.5.1. `processRow` (rama de re-asignación)

Corre para cada deudor **presente en el archivo** que ya existía en la remesa origen (dentro del flujo del Escenario A actual). Se llama **antes** de `actualizarIdentidadYAdicionales` para no incluir el trabajo de re-asignación en la transacción de reconciliación.

```
async reasignarSiCorresponde(deudorId, ctx):
  if ctx.accionAusente == 'IGNORAR': return
  
  desasignadoId = await this.resolverParametroDesasignado(ctx)  // cached
  if desasignadoId == null: return  // modo degradado
  
  sit050Id = await this.resolverParametroSit050(ctx)  // cached (helper existente)
  
  deudor = await prisma.deudor.findUnique({
    id: deudorId,
    select: { estadoGestionId, estadoGestionPrevioAId, estadoSituacionId }
  })
  
  if deudor.estadoSituacionId == sit050Id:
    logger.log(`Deudor ${deudorId} en SIT-050 — no se re-asigna.`)
    return
  
  if deudor.estadoGestionId != desasignadoId: return  // no estaba desasignado
  
  // Restaurar previo. Si el previo apunta a un parametro que ya no existe/no aplica → fallback al default.
  nuevoGestionId = deudor.estadoGestionPrevioAId ?? ctx.defaults.estadoGestionId
  const previoValido = await prisma.parametro.findFirst({
    where: { id: nuevoGestionId, grupo: 'gestion' }
  })
  if not previoValido:
    nuevoGestionId = ctx.defaults.estadoGestionId
  
  await prisma.deudor.update({
    id: deudorId,
    data: { estadoGestionId: nuevoGestionId, estadoGestionPrevioAId: null }
  })
  
  await ctx.auditoria.log({
    modulo: 'IMPORT',
    entidad: 'deudor',
    entidadId: deudorId,
    tipo: 'UPDATE',
    resumen: `Re-asignación por actualización diaria (remesa=${ctx.remesaId})`,
    empresaId: ctx.empresaId,
    usuarioId: ctx.usuarioId,
  })
```

### A.5.2. `afterAll` (rama nueva)

```
async afterAll(ctx):
  if !ctx.remesaOrigenId: return
  
  // Guard existente: SOLO_DATOS o sin datos de deuda → no reconcilia.
  // NUEVO: aunque estemos en SOLO_DATOS, si accionAusente=DESASIGNAR sí corre la desasignación.
  const soloDatos = ctx.modoActualizacion == 'SOLO_DATOS'
  const skipReconciliacionDeuda = soloDatos || !this.sawReconciliationData
  
  // Traer todos los deudores de la remesa origen (una sola query)
  const deudores = await prisma.deudor.findMany({
    where: { remesaId: ctx.remesaOrigenId, empresaId: ctx.empresaId },
    select: { id, montoTotal, estadoSituacionId, estadoGestionId, estadoGestionPrevioAId }
  })
  
  const sit050Id = await this.resolverParametroSit050(ctx)
  const desasignadoId = await this.resolverParametroDesasignado(ctx)  // null si no seedeado
  
  // === RAMA A: DESASIGNAR / IGNORAR ===
  if ctx.accionAusente == 'DESASIGNAR' or ctx.accionAusente == 'IGNORAR':
    if ctx.accionAusente == 'DESASIGNAR' and desasignadoId != null:
      const paraDesasignar = []
      for deudor in deudores:
        if this.processedDeudorIds.has(deudor.id): continue          // vino en el archivo
        if deudor.estadoSituacionId == sit050Id: continue             // cancelado
        if deudor.estadoGestionId == desasignadoId: continue          // ya estaba desasignado
        paraDesasignar.push({
          id: deudor.id,
          estadoGestionPrevioAId: deudor.estadoGestionId,             // guardar previo
        })
      
      // Update en chunks (evitar 1 UPDATE por deudor con 10k+ deudores).
      // Como estadoGestionPrevioAId es distinto por deudor, no se puede updateMany;
      // usar $transaction([...updates]) de a 500.
      for (const chunk of chunks(paraDesasignar, 500)):
        await prisma.$transaction(chunk.map(d => prisma.deudor.update({
          where: { id: d.id },
          data: {
            estadoGestionId: desasignadoId,
            estadoGestionPrevioAId: d.estadoGestionPrevioAId,
          }
        })))
      
      await ctx.auditoria.log({
        modulo: 'IMPORT', entidad: 'remesa', entidadId: ctx.remesaId, tipo: 'UPDATE',
        resumen: `Desasignación masiva: ${paraDesasignar.length} deudores → GES-094`,
        empresaId: ctx.empresaId,
      })
    
    if skipReconciliacionDeuda:
      this.reset(); return
    
    // Si hay datos de deuda + accionAusente=DESASIGNAR, la reconciliación de los presentes
    // ya se hizo fila-a-fila en processRow. Solo consolidamos.
    await ctx.consolidacion.consolidar({ tipo: 'REMESA', remesaId: ctx.remesaOrigenId })
    if ctx.remesaId != ctx.remesaOrigenId:
      await ctx.consolidacion.consolidar({ tipo: 'REMESA', remesaId: ctx.remesaId })
    if this.pagosDeudorIds.size > 0:
      await ctx.promesas.cerrarCumplidas([...this.pagosDeudorIds])
    this.reset(); return
  
  // === RAMA B: PAGO_TODO (comportamiento clásico) ===
  // [código actual sin cambios, respetando skipReconciliacionDeuda]
  ...
```

### A.5.3. `resolverParametroDesasignado`

Cache por instancia del processor (misma vida que el batch), busca por `grupo='gestion', clave='GES-094'`. Análogo al helper `deudor-bloqueo.ts` que ya existe para SIT-050 → se puede reutilizar el patrón (`DeudorBloqueoService` con `onModuleInit`) o resolver ad-hoc en el `afterAll` con un `findFirst`. Recomendación: **resolver ad-hoc** — se llama una vez por batch, no vale la pena inyectar un servicio nuevo.

```ts
private desasignadoIdCache: number | null | undefined = undefined;
private async resolverParametroDesasignado(ctx: ProcessContext): Promise<number | null> {
  if (this.desasignadoIdCache !== undefined) return this.desasignadoIdCache;
  const p = await ctx.prisma.parametro.findFirst({
    where: { grupo: 'gestion', clave: 'GES-094' },
    select: { id: true },
  });
  if (!p) {
    this.logger.warn('GES-094 no seedeado — el modo DESASIGNAR queda inactivo en este batch.');
  }
  this.desasignadoIdCache = p?.id ?? null;
  return this.desasignadoIdCache;
}
```

Reset del cache en el `reset()` del batch.

## A.6. Frontend

### A.6.1. `PlantillaEditor.tsx` (sección ACTUALIZACIONES)

Agregar un `RadioGroup` visible cuando `categoria === 'ACTUALIZACIONES'` y `modoActualizacion === 'RECONCILIAR'` (o siempre visible en `SOLO_DATOS` con opciones limitadas — ver A.7 puntos abiertos):

```tsx
<FormControl>
  <FormLabel>Acción para deudores ausentes del archivo</FormLabel>
  <RadioGroup
    value={accionAusente}
    onChange={(_, v) => setAccionAusente(v as AccionAusenteActualizacion)}
  >
    <FormControlLabel value="PAGO_TODO" control={<Radio />}
      label="Marcar como pagó todo (SIT-050) — comportamiento clásico" />
    <FormControlLabel value="DESASIGNAR" control={<Radio />}
      label="Desasignar (GES-094) — para archivos de gestión diaria" />
    <FormControlLabel value="IGNORAR" control={<Radio />}
      label="No hacer nada con los ausentes" />
  </RadioGroup>
  <FormHelperText>
    En "Desasignar", el deudor vuelve a su estado anterior de gestión si aparece en un archivo posterior.
    Los deudores cancelados (SIT-050) siempre se ignoran.
  </FormHelperText>
</FormControl>
```

Estado, load y save análogos a los flags existentes (`modoActualizacion`, `crearNuevosCasos`, `comportamientoDeudaMayor`).

### A.6.2. Ficha del deudor (opcional, fase 2)

Mostrar un chip "Desasignado (última: {fecha})" si `estadoGestionId == GES-094`. Este chip ya se pintaría automáticamente por el estado de gestión → **no requiere cambios en la ficha** más allá de que el nombre "Desasignado" quede visible.

## A.7. Flujo operativo documentado

1. **Día 0 — carga inicial**: se sube el archivo con **toda la cartera** con una plantilla categoría **DEUDORES** (o **DEUDORES_Y_FACTURAS**). Genera `remesa1` (la remesa madre).
2. **Día N — archivo diario**: se sube el archivo del día con una plantilla categoría **ACTUALIZACIONES**, `modoActualizacion=RECONCILIAR`, `accionAusente=DESASIGNAR`, apuntando `remesaOrigen=remesa1`. Se aplica todos los días con la misma plantilla; los deudores que vengan reciben actualización de deuda y (si estaban desasignados) re-asignación; los que no vengan reciben GES-094.
3. **Reversión de un mal día**: si un archivo diario vino mal (por ejemplo, incompleto por error del cedente), corregir → volver a subir el archivo bueno del día. Los deudores que aparecen en el segundo archivo se re-asignan automáticamente (idempotencia); los que sigan ausentes siguen desasignados.

## A.8. Consideraciones adicionales

- **Volumen**: para carteras Fiat (~50k deudores), el `findMany` + N updates individuales del `afterAll` puede tardar. Mitigación:
  - Chunkear updates en transacciones de 500 (ya en el pseudocódigo).
  - Alternativa performante: `updateMany` para los que no requieren guardar `estadoGestionPrevioAId` (rechazado: siempre queremos guardarlo).
  - Índice `Deudor_remesaId_fkey` ya existe → el `findMany` es rápido.
- **Race con edición manual**: si un gestor edita `estadoGestionId` de un deudor mientras corre el afterAll, la lectura previa puede quedar desactualizada. Mitigación: el update es directo (no un CAS). Si el gestor puso `GES-094` a mano segundos antes, el guardián de "ya estaba desasignado" filtra correctamente. Si el gestor puso otro estado segundos antes, el afterAll lo va a pisar con GES-094 y guardar ese como previo → semánticamente correcto (el archivo del día ganaba de todas formas).
- **Auditoría**: un único evento resumen por batch (`DESASIGNACION_MASIVA` con `datos: { count, remesaId, remesaOrigenId }`). No un evento por deudor (ruido). Si se necesita granularidad, se puede agregar después.

## A.9. Retrocompatibilidad

- Default de `accionAusente` es `PAGO_TODO` en el service (comportamiento actual). Plantillas ya guardadas siguen funcionando idénticamente.
- Nueva columna `estadoGestionPrevioAId` es nullable → `db push` no rompe deudores existentes.
- El helper `deudor-bloqueo.ts` no cambia; el guard SIT-050 sigue siendo el mismo.
- La consolidación no cambia; en modo `DESASIGNAR` simplemente no se generan pagos, así que la consolidación tampoco toca a esos deudores (regla 4 del spec de consolidación: `Σpagos=0 → no se toca`).

## A.10. Riesgos

| # | Riesgo | Mitigación |
|---|---|---|
| A-R1 | Un usuario cambia la plantilla de `DESASIGNAR` a `PAGO_TODO` sin darse cuenta y "cancela" media cartera. | UI con etiqueta clara + confirm modal en el editor cuando se cambia a `PAGO_TODO` en una plantilla que estaba en `DESASIGNAR`. |
| A-R2 | GES-094 no seedeado → el modo `DESASIGNAR` queda inactivo silenciosamente. | Warn log explícito en el processor + validación al guardar la plantilla (rechazar `DESASIGNAR` si el `parametro` no existe para la empresa/global). |
| A-R3 | `estadoGestionPrevioAId` apunta a un parametro eliminado → re-asignación falla. | Fallback al `defaults.estadoGestionId` de la plantilla (ya en el pseudocódigo A.5.1). |
| A-R4 | Race condition edición manual vs afterAll → el gestor pierde su cambio. | Asumido (mismo trade-off que el modo `RECONCILIAR` actual: el archivo del día siempre gana). Documentar. |
| A-R5 | Performance del `findMany` con 100k+ deudores en la remesa origen. | Select acotado, índice ya existente, chunks de 500 para updates. Se puede paginar el `findMany` en fase 2 si hace falta. |

---

# FEATURE B — Parser de archivo TXT multi-registro (Toyota cuenta 87)

## B.1. Análisis del formato

### B.1.1. Estructura del archivo

Cada línea tiene un **código de tipo de registro** al inicio (típicamente los primeros 3 caracteres, o la primera columna con separador). Cuatro tipos identificados:

| Código | Semántica | Entidad AMSA |
|---|---|---|
| `GES` | Datos del contrato — deuda total, fecha, nro contrato. | `deudor` (campos principales) |
| `CLI` | Datos del cliente — nombre, teléfonos, mails. | `deudor` (identidad) + `contacto[]` |
| `DET` | Ítem de cargo — tipo de cargo + importe. | `factura` |
| `BAJ` | Baja del contrato. | Ver B.5 (punto de decisión) |

Un contrato se arma con una combinación:
- **Alta / gestión normal**: 1 × `GES` + 1 × `CLI` + N × `DET`.
- **Baja**: 1 × `BAJ` (puede o no traer los otros — a definir con el usuario).

Todas las líneas de un mismo contrato comparten una **clave de agrupación** (nro de contrato / cuenta), configurable por tipo de registro (`GES.col3 == CLI.col3 == DET.col3 == BAJ.col3` en el ejemplo Toyota).

### B.1.2. Por qué no encaja en el pipeline actual

`imports.service.mapRow` recibe un array de valores (una fila del CSV/XLSX) y devuelve un `MappedRow` — asume "1 fila = 1 deudor + bloques repetitivos definidos por columnas del mismo array". El multi-registro requiere **agrupar varias filas** antes de aplicarles el mapeo, y cada tipo de fila tiene un layout de columnas distinto.

## B.2. Estrategia de menor fricción: adapter pre-processor

**Recomendación**: NO tocar el pipeline principal ni los processors existentes. Introducir un **adapter** que:

1. Lee el TXT línea a línea.
2. Discrimina cada línea por su código de tipo.
3. Agrupa por clave de contrato en memoria (Map<claveContrato, Buffer>).
4. Cuando el archivo termina (o se detecta cambio de clave en modo streaming), **emite un `MappedRow` por grupo** — pre-armado con los campos del deudor + los `_blocks` de facturas + contactos + un marcador de baja.
5. El worker de imports consume esos `MappedRow` y los pasa a un **`MultirregistroProcessor`** dedicado.

Ventajas:
- El pipeline (batch, progreso, errores por fila, validación, hook `afterAll`) sigue intacto.
- El mapeo por índice de columna (`fromIndex`) se preserva, ahora **por tipo de registro**.
- La UI se resuelve con tabs por tipo de registro en el editor de mapping.

Alternativas descartadas:
- **Nueva categoría con parseo entrelazado en el processor**: mezcla parseo con lógica de negocio; complica testing.
- **Pre-materializar a un CSV intermedio**: agrega IO y complica el flujo de progreso/errores.

## B.3. Contrato del nuevo mapping

### B.3.1. Tipos en `mapping-types.ts`

```ts
export type ImportCategoria =
  | 'DEUDORES' | 'FACTURAS' | 'PAGOS' | 'CONTACTOS' | 'ENRIQUECIMIENTO'
  | 'DEUDORES_Y_FACTURAS' | 'ACTUALIZACIONES' | 'ACCIONES'
  | 'MULTIRREGISTRO';  // NUEVO

/** Cómo se identifica el tipo de registro en cada línea. */
export interface DiscriminadorMultirregistro {
  modo: 'COLUMNA' | 'PREFIJO';
  /** Modo COLUMNA: índice de la columna con el código de tipo (típicamente 0). */
  fromIndex?: number;
  /** Modo PREFIJO: cantidad de caracteres iniciales que forman el código. */
  largoPrefijo?: number;
  /** Códigos válidos (para descartar líneas de padding / desconocidas). */
  codigos: string[];
}

/** Config de mapeo para un tipo de registro específico. */
export interface RegistroMultirregistro {
  tipo: string;                                   // 'GES' | 'CLI' | 'DET' | 'BAJ'
  entidad: 'DEUDOR_MAIN' | 'DEUDOR_IDENTIDAD' | 'CONTACTOS' | 'FACTURA' | 'BAJA';
  /** Columna del contrato (para agrupar). Se combina con `claveAgrupacion.tipoAncla`. */
  claveContratoFromIndex: number;
  /** Columnas mapeadas al modelo AMSA. Semántica según `entidad`. */
  columns: Record<string, MappingColumn>;
  extras?: Record<string, MappingColumn>;
  /** Solo entidad `CONTACTOS`: sub-registros (mail, tel 1, tel 2, etc.). */
  contactos?: Array<{ tipo: 'telefono' | 'email'; fromIndex: number; subtipo?: string }>;
}

export interface MultirregistroConfig {
  discriminador: DiscriminadorMultirregistro;
  registros: RegistroMultirregistro[];
  /** Cardinalidad esperada por grupo (para validación). */
  cardinalidad?: {
    GES?: { min: number; max: number };            // e.g. { min: 1, max: 1 }
    CLI?: { min: number; max: number };
    DET?: { min: number; max: number };            // e.g. { min: 0, max: 999 }
    BAJ?: { min: number; max: number };
  };
  /** Qué hacer con líneas de tipo desconocido: 'IGNORAR' (default) | 'ERROR'. */
  onTipoDesconocido?: 'IGNORAR' | 'ERROR';
  /** Qué hacer si un grupo trae BAJ + otros registros: 'BAJA_GANA' (default) | 'ERROR'. */
  onBajaMezclada?: 'BAJA_GANA' | 'ERROR';
}

export interface MappingJson {
  // ...
  entity: 'DEUDOR' | 'FACTURA' | 'PAGO' | 'CONTACTO' | 'ENRIQ_MIXTO' | 'MIXTO' | 'MULTIRREGISTRO';  // NUEVO valor
  multirregistro?: MultirregistroConfig;                                                            // NUEVO campo
}
```

### B.3.2. Ejemplo de config para Toyota

```jsonc
{
  "entity": "MULTIRREGISTRO",
  "multirregistro": {
    "discriminador": { "modo": "COLUMNA", "fromIndex": 0, "codigos": ["GES", "CLI", "DET", "BAJ"] },
    "registros": [
      {
        "tipo": "GES", "entidad": "DEUDOR_MAIN",
        "claveContratoFromIndex": 1,
        "columns": {
          "nroCliente": { "fromIndex": 1 },
          "montoTotal": { "fromIndex": 4, "transforms": ["toNumber:es-AR"] },
          "fechaVencimiento": { "fromIndex": 5, "transforms": ["toDate:DD/MM/YYYY"] }
        }
      },
      {
        "tipo": "CLI", "entidad": "DEUDOR_IDENTIDAD",
        "claveContratoFromIndex": 1,
        "columns": {
          "nombre": { "fromIndex": 2 },
          "apellido": { "fromIndex": 3 },
          "documento": { "fromIndex": 4, "transforms": ["removeQuotes"] }
        },
        "contactos": [
          { "tipo": "telefono", "fromIndex": 5, "subtipo": "movil" },
          { "tipo": "telefono", "fromIndex": 6, "subtipo": "fijo" },
          { "tipo": "email",    "fromIndex": 7 }
        ]
      },
      {
        "tipo": "DET", "entidad": "FACTURA",
        "claveContratoFromIndex": 1,
        "columns": {
          "nroFactura": { "fromIndex": 2 },                          // tipo de cargo como nro
          "importe":    { "fromIndex": 3, "transforms": ["toNumber:es-AR"] }
        }
      },
      {
        "tipo": "BAJ", "entidad": "BAJA",
        "claveContratoFromIndex": 1,
        "columns": {
          "nroCliente": { "fromIndex": 1 },
          "motivo":     { "fromIndex": 2 }
        }
      }
    ],
    "cardinalidad": {
      "GES": { "min": 1, "max": 1 },
      "CLI": { "min": 1, "max": 1 },
      "DET": { "min": 0, "max": 999 },
      "BAJ": { "min": 0, "max": 1 }
    },
    "onTipoDesconocido": "IGNORAR",
    "onBajaMezclada": "BAJA_GANA"
  }
}
```

## B.4. Parser multi-registro (pseudocódigo)

Nuevo archivo: `backend/src/modules/imports/parsers/multirregistro-parser.ts`.

```ts
// Emite un MappedRow por grupo. Devuelve un AsyncIterable para conectar con el
// mismo mecanismo de batch del imports.service (con progreso y errores).
export async function* parseMultirregistro(
  filePath: string,
  separador: string,
  config: MultirregistroConfig,
): AsyncIterable<{ row: any[]; idx: number; error?: string }> {
  const grupos = new Map<string, GrupoBuffer>();
  const lineasSinClave: number[] = [];
  const lineasSinTipo: number[] = [];
  const codigosValidos = new Set(config.discriminador.codigos);
  
  const stream = fs.createReadStream(filePath, 'utf8');
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  
  let lineNum = 0;
  for await (const linea of rl) {
    lineNum++;
    if (!linea.trim()) continue;
    
    const cols = linea.split(resolveDelimiter(separador));  // reutilizar helper existente
    
    // 1. Discriminar tipo
    let tipo: string | null = null;
    if (config.discriminador.modo === 'COLUMNA') {
      tipo = String(cols[config.discriminador.fromIndex ?? 0] ?? '').trim();
    } else {
      tipo = linea.slice(0, config.discriminador.largoPrefijo ?? 3);
    }
    
    if (!codigosValidos.has(tipo)) {
      if (config.onTipoDesconocido === 'ERROR') {
        yield { row: cols, idx: lineNum, error: `Tipo de registro desconocido: '${tipo}'` };
      }
      // IGNORAR: no emitir, no acumular
      continue;
    }
    
    // 2. Extraer clave de contrato
    const regCfg = config.registros.find(r => r.tipo === tipo);
    if (!regCfg) continue;
    const claveContrato = String(cols[regCfg.claveContratoFromIndex] ?? '').trim();
    if (!claveContrato) {
      yield { row: cols, idx: lineNum, error: `Línea ${tipo} sin clave de contrato` };
      continue;
    }
    
    // 3. Agregar al buffer del grupo
    if (!grupos.has(claveContrato)) grupos.set(claveContrato, new GrupoBuffer());
    grupos.get(claveContrato)!.add(tipo, cols, lineNum);
  }
  
  // 4. Emitir un MappedRow por grupo (streaming al pipeline)
  let idxEmit = 0;
  for (const [claveContrato, buffer] of grupos) {
    try {
      const mappedRow = this.grupoAMappedRow(claveContrato, buffer, config);
      yield { row: mappedRow, idx: idxEmit++ };
    } catch (e) {
      yield { row: [claveContrato], idx: idxEmit++, error: e.message };
    }
  }
}
```

### B.4.1. `grupoAMappedRow`

- Valida cardinalidad (`cardinalidad.GES.min/max`, etc.). Si falla → error para la fila (el pipeline lo persiste en `importerror`).
- Si el grupo tiene `BAJ` y `onBajaMezclada === 'BAJA_GANA'` → descarta las otras líneas, emite `MappedRow` marcado con `_baja: true`.
- Extrae los campos del `DEUDOR_MAIN` (GES) al top-level del `MappedRow`.
- Mergea los campos de `DEUDOR_IDENTIDAD` (CLI) al top-level (mismos campos que DEUDOR + nombre/apellido/documento).
- Los `CONTACTOS` (sub-registros de CLI) se emiten como `_blocks` con `entity='CONTACTO'`.
- Cada `DET` se emite como un `_block` con `entity='FACTURA'`.
- `BAJ` se emite como marcador `_baja: true` + `_bajaMotivo`.

Estructura resultante (compatible con el pipeline):

```ts
{
  // From GES
  nroCliente: '87001234',
  montoTotal: 145000.50,
  fechaVencimiento: Date,
  // From CLI
  nombre: 'Juan',
  apellido: 'Pérez',
  documento: '20123456789',
  // Marcador especial
  _baja: false,
  _bajaMotivo: undefined,
  // Blocks
  _blocks: [
    { entity: 'CONTACTO', data: { tipo: 'telefono', valor: '1155…', subtipo: 'movil' } },
    { entity: 'CONTACTO', data: { tipo: 'email',    valor: 'juan@…' } },
    { entity: 'FACTURA',  data: { nroFactura: 'CARGO-01', importe: 12345.67 } },
    // ...
  ],
  _raw: [claveContrato],  // no aplica el mapeo por índice tradicional
}
```

## B.5. Nuevo processor `MultirregistroProcessor`

Nuevo archivo: `backend/src/modules/imports/processors/multirregistro.processor.ts`.

Comparte helpers con `deudores-facturas.processor.ts` y `actualizaciones.processor.ts` (upsert de contacto, factura, etc.).

Pseudocódigo:

```ts
export class MultirregistroProcessor implements ICategoryProcessor {
  readonly category = 'MULTIRREGISTRO';
  
  validateRow(row, ctx) {
    if (row._baja) {
      if (!row.nroCliente && !row.documento) {
        return { valid: false, error: 'Baja sin nroCliente ni documento' };
      }
      return { valid: true };
    }
    if (!row.nroCliente && !row.documento) {
      return { valid: false, error: 'Falta identidad (nroCliente/documento)' };
    }
    return { valid: true };
  }
  
  async processRow(row, ctx) {
    if (row._baja) {
      await this.procesarBaja(row, ctx);
      return;
    }
    // Alta o actualización — resolver por (empresaId, nroCliente, remesaId).
    const existente = await this.buscarDeudor(row, ctx);
    if (!existente) {
      await this.crearDeudorConFacturasYContactos(row, ctx);
    } else {
      // "Diario de Toyota" tiene semántica de ACTUALIZACIÓN: reconciliar como lo hace
      // ActualizacionesProcessor. Se puede reutilizar los helpers reconciliarSaldo/etc.
      // → Para MVP, si el deudor ya existe, actualizar campos + agregar facturas nuevas.
      await this.actualizarDeudorExistente(existente.id, row, ctx);
    }
  }
  
  async procesarBaja(row, ctx) {
    const d = await this.buscarDeudor(row, ctx);
    if (!d) {
      // Baja de un deudor que nunca cargamos → registrar en importerror y seguir.
      throw new Error(`Baja de contrato inexistente (nroCliente=${row.nroCliente})`);
    }
    // Ver B.6 (punto de decisión abierto). Recomendación por defecto: GES-090.
    const gesBajaId = await this.resolverParametro(ctx, 'gestion', 'GES-090');
    await ctx.prisma.deudor.update({
      where: { id: d.id },
      data: { estadoGestionId: gesBajaId ?? undefined },
    });
    await ctx.auditoria.log({ /* ... */ });
  }
  
  async afterAll(ctx) {
    // Consolidación de la remesa (mismo patrón que el processor de deudores-facturas).
    await ctx.consolidacion.consolidar({ tipo: 'REMESA', remesaId: ctx.remesaId });
  }
}
```

Registrar en `processor-registry.ts`.

## B.6. Punto de decisión: semántica de BAJ

Tres opciones para BAJ, ordenadas por conservadurismo:

| Opción | Efecto | Pro | Contra |
|---|---|---|---|
| **`GES-090` "Dado de baja del sistema"** *(recomendado)* | `estadoGestionId = GES-090`. Deuda y pagos intactos. | Historial preservable, no bloquea, semántica clara. | El deudor sigue apareciendo en listados generales — hay que filtrar. |
| `GES-094` "Desasignado" | Igual que Feature A. | Consistencia con Feature A. | Confunde: la baja del cedente es más definitiva que "no gestionar hoy". |
| `SIT-050` "Cancelado / Pagado" | Deudor bloqueado (spec de bloqueo). | Bloquea todas las mutaciones. | **Incorrecto semánticamente** — SIT-050 implica pago; una baja no siempre es por pago. Además, sin pago la consolidación siguiente lo reabriría. |

**Recomendación final**: **GES-090** con back-relación opcional. Si el archivo BAJ trae un motivo específico ("baja por pago", "baja por incobrable", etc.), se puede mapear a otros códigos en fase 2 (config `mapeoBajaPorMotivo` en la plantilla). En MVP, todo BAJ → GES-090.

## B.7. Integración con `imports.service.ts`

El worker `processImportJob` bifurca antes del parseo:

```ts
if (remesa.categoria === 'MULTIRREGISTRO') {
  const mrCfg = mapping.multirregistro;
  if (!mrCfg) throw new BadRequestException('Falta config multirregistro en la plantilla');
  
  for await (const item of parseMultirregistro(remesa.archivo, remesa.plantilla.separador ?? '|', mrCfg)) {
    const idx = total++;
    if (item.error) {
      errorBatch.push({ remesaId, rowNumber: idx, rawRow: item.row, errorMsg: item.error });
      err++;
      continue;
    }
    batch.push({ row: item.row, idx });
    if (batch.length >= BATCH_SIZE) await processBatch();
  }
  if (batch.length > 0) await processBatch();
} else {
  // ... pipeline CSV/XLSX actual (sin cambios)
}
```

`mapRow` NO se invoca en multi-registro (el `MappedRow` viene pre-armado por el parser). En su lugar, el `processBatch` verifica si la `row` ya es un `MappedRow` (heurística: es un objeto no-array, o tiene la key `_baja`) y salta el mapeo.

Alternativa más limpia: `mapRow` acepta un tag `esMultirregistro: boolean` en el `ProcessContext` y devuelve la row tal cual si es true.

## B.8. Frontend

### B.8.1. `MappingEditor.tsx` — nueva vista

Cuando `categoria === 'MULTIRREGISTRO'`, el editor cambia a un layout con **tabs por tipo de registro**:

- Toolbar: definir discriminador (columna vs prefijo) + lista de códigos válidos.
- Tab por registro (`GES`, `CLI`, `DET`, `BAJ`): reutiliza el `MappingEditor` actual (mapeo por índice de columna, transforms, extras), acotado a las líneas de ese tipo del archivo de muestra.
- Sub-panel dentro del tab CLI para contactos (agregar/quitar teléfonos y mails con `fromIndex + subtipo`).
- Vista previa: leer las primeras N líneas del archivo, discriminar, agrupar por clave, mostrar 3-5 grupos resueltos.

### B.8.2. `PlantillaEditor.tsx`

Sumar `MULTIRREGISTRO` en el selector de categoría. Cuando se selecciona, ocultar la mayoría de flags de otras categorías y mostrar el editor B.8.1.

### B.8.3. `previewFile` en `imports.service.ts`

Adaptar para modo multi-registro: en vez de retornar filas crudas, retornar `{ gruposResueltos, lineasIgnoradas, cardinalidades }`.

## B.9. Fases de implementación (Feature B)

- **Fase B0 — Sin frontend, plantilla manual**: implementar backend completo (parser + processor + integración en imports.service). La plantilla se crea con `mappingJson` a mano (endpoint `POST /api/import/plantillas` con el JSON literal). Sirve para validar con Toyota real.
- **Fase B1 — UI mínima**: agregar el selector `MULTIRREGISTRO` en `PlantillaEditor` y un tab por tipo de registro reutilizando el `MappingEditor` existente sin sub-panel de contactos (los contactos se editan como extras).
- **Fase B2 — UI completa**: sub-panel de contactos, preview de grupos resueltos, validación en tiempo real del discriminador.

Fase B0 desbloquea a Toyota; Fases B1/B2 pulen la operatoria.

## B.10. Retrocompatibilidad

- Categoría nueva; no afecta ninguna plantilla ni remesa existente.
- El pipeline CSV/XLSX no se toca.
- Los enum values `MULTIRREGISTRO` en `plantillaimport_categoria` / `remesa_categoria` se agregan al final; con `db push` es no-destructivo.

## B.11. Riesgos

| # | Riesgo | Mitigación |
|---|---|---|
| B-R1 | Archivos muy grandes (>1M líneas) → agrupar en memoria explota RAM. | Documentar límite. Fase 2: modo streaming asumiendo archivo ordenado por clave. |
| B-R2 | El discriminador falla (código con espacios, otro separador, etc.). | Configurable + preview visual que muestra qué códigos detectó. |
| B-R3 | Un grupo tiene GES sin CLI o al revés. | `cardinalidad` en la config + error por grupo. |
| B-R4 | Baja de un contrato inexistente. | Error de fila (no bloquea el batch). |
| B-R5 | Toyota cambia el layout entre versiones del archivo. | Plantilla clonable con `version` (patrón ya existente en `plantillaimport`). |
| B-R6 | Nuevo processor duplica lógica de `deudores-facturas` y `actualizaciones`. | Extraer helpers compartidos a `utils/` cuando aparezca la 2da duplicación (no antes — YAGNI). |
| B-R7 | El unique `empresaId_documento_remesaId` de `deudor` falla si Toyota no manda documento. | Placeholder `SIN_DOC_{nroCliente}` (patrón ya usado por `actualizaciones.processor`). |

---

# Puntos de decisión abiertos

Antes de implementar, confirmar con el usuario:

| # | Pregunta | Recomendación del arquitecto |
|---|---|---|
| **D1** | ¿`accionAusente` como flag separado, o nuevo valor `ModoActualizacion=GESTION_DIARIA`? | **Flag separado** (`accionAusente`). Mantiene ortogonalidad con `modoActualizacion` y permite combinar `SOLO_DATOS + DESASIGNAR` (útil para archivos parciales que traen solo la lista de casos sin saldo). |
| **D2** | ¿Guardar `estadoGestionPrevioAId` como columna en `deudor`, o como tabla histórica `deudor_desasignacion`? | **Columna en `deudor`** para MVP. Se puede migrar a tabla con historial en fase 2 sin romper contratos. |
| **D3** | ¿La UI del PlantillaEditor muestra el selector de `accionAusente` en `SOLO_DATOS`? | **Sí**, con opciones limitadas a `DESASIGNAR` e `IGNORAR` (rechazar `PAGO_TODO`, ver A.4.1). |
| **D4** | Feature A — ¿generar un comentario en el timeline del deudor cuando se lo desasigna / re-asigna? | **No en MVP** (ruido si son 50k desasignaciones diarias). Solo evento resumen de auditoría. Se puede prender por config en fase 2 (`generarComentarioDesasignacion?: boolean`). |
| **D5** | Feature A — ¿el evento de auditoría es 1 por batch o 1 por deudor? | **1 por batch** con `count` y `remesaId`. La granularidad por deudor la resuelve el estado (`estadoGestionPrevioAId != null` indica que fue desasignado). |
| **D6** | Feature B — semántica de BAJ. | **GES-090** ("Dado de baja del sistema"). Reservar SIT-050 solo para "pagó todo". Reservar GES-094 solo para el flujo de actualización diaria. |
| **D7** | Feature B — parsing en dos pasadas (todo en memoria) vs streaming (asume ordenado por clave). | **Dos pasadas / memoria** en MVP; volumen esperado de Toyota manejable (<200k líneas típicas). Documentar límite. |
| **D8** | Feature B — ¿el mapeo de CONTACTOS del registro CLI usa el patrón actual de `blocks` (repetitivos) o el nuevo sub-panel con `contactos[]` fijo? | **Sub-panel fijo `contactos[]`** — más claro para el usuario (Toyota siempre trae "tel móvil en col 5, tel fijo en col 6, mail en col 7"). Los `blocks` clásicos son para archivos donde el número de contactos varía. |
| **D9** | Feature B — ¿el processor de multi-registro se comporta como DEUDORES_Y_FACTURAS (crea siempre) o como ACTUALIZACIONES (reconcilia si existe)? | **Como ACTUALIZACIONES** (reconcilia) si la plantilla tiene una `remesaOrigen` configurada; **como DEUDORES_Y_FACTURAS** si no. Coincide con la operatoria diaria de Toyota (archivo diario → reconciliar). |
| **D10** | Feature B — ¿reutilizar `actualizaciones.processor` con un pre-adapter, o crear `multirregistro.processor` propio? | **Processor propio** en MVP (menos acoplamiento). Extraer helpers si aparece duplicación repetida. |

---

# PLAN PARA IMPLEMENTER

## Feature A (priorizada)

**Orden de implementación:**

1. **Prisma**: agregar `deudor.estadoGestionPrevioAId Int?` + relación + índice. `db push`. Verificar back-relation en `parametro`.
2. **Types**: sumar `AccionAusenteActualizacion` en `mapping-types.ts` + campo `accionAusente?` en `MappingJson`. Actualizar `ProcessContext` con `accionAusente`.
3. **Service**: `imports.service.ts` → resolver default `PAGO_TODO` al armar el `ctx` (junto con los otros flags de ACTUALIZACIONES). Validar la combinación prohibida al guardar plantilla (`createPlantilla` / `updatePlantilla`).
4. **Processor**: `actualizaciones.processor.ts` → cache de `desasignadoId` + método `reasignarSiCorresponde` (llamado desde `processRow` para deudores presentes) + rama nueva en `afterAll` con las 3 opciones.
5. **Auditoría**: registrar eventos `DESASIGNACION_MASIVA` / `REASIGNACION_MASIVA` con count.
6. **Frontend**: `PlantillaEditor.tsx` → nuevo RadioGroup + carga/guardado de `accionAusente` en el mapping.
7. **Tests unitarios**: idempotencia (correr 2×), re-asignación con y sin `estadoGestionPrevioAId`, guard SIT-050, modo degradado sin GES-094.

**Archivos a crear:** ninguno.

**Archivos a modificar:**
- `backend/prisma/schema.prisma` (model `deudor` + model `parametro` back-relation + índice).
- `backend/src/modules/imports/mapping-types.ts` (type + campo `MappingJson`).
- `backend/src/modules/imports/processors/processor.interface.ts` (campo en `ProcessContext`).
- `backend/src/modules/imports/imports.service.ts` (resolver flag + validar combinación al guardar plantilla).
- `backend/src/modules/imports/processors/actualizaciones.processor.ts` (cache + `reasignarSiCorresponde` + `afterAll` con 3 ramas).
- `frontend/src/pages/PlantillaEditor.tsx` (RadioGroup + estado).

**Migraciones necesarias:** sí — solo `npx prisma db push` (agregar columna nullable + índice; no destructivo).

**Skills a consultar:** `prisma-migration` (schema push), `nestjs-module` (validación en service), `react-component` (RadioGroup + dark/light), `amsa-general` (logging + auditoría).

**Riesgos a tener en cuenta durante la implementación:**
- El `findMany` de deudores de la remesa origen no debe traer campos pesados (solo `id`, `montoTotal`, `estadoGestionId`, `estadoGestionPrevioAId`, `estadoSituacionId`).
- Los updates en el `afterAll` van en `$transaction` chunks de 500, no updateMany (porque cada deudor puede tener un `estadoGestionPrevioAId` distinto).
- El cache `desasignadoIdCache` debe resetearse en `reset()`.
- La validación de combinación `SOLO_DATOS + PAGO_TODO` debe correr también al **actualizar** plantillas, no solo al crear.
- Confirmar D3 (UI del selector en `SOLO_DATOS`) con el usuario antes de la implementación del front.

## Feature B (posterior)

**Orden de implementación:**

1. **Prisma**: sumar `MULTIRREGISTRO` a los enums `plantillaimport_categoria` y `remesa_categoria`. `db push`.
2. **Types**: agregar `MultirregistroConfig`, `RegistroMultirregistro`, `DiscriminadorMultirregistro` en `mapping-types.ts`. Sumar `'MULTIRREGISTRO'` a `ImportCategoria` y al union `entity`.
3. **Parser**: nuevo `backend/src/modules/imports/parsers/multirregistro-parser.ts` con `parseMultirregistro()` (readline + agrupación + emisión).
4. **Processor**: nuevo `backend/src/modules/imports/processors/multirregistro.processor.ts` con `processRow`, `validateRow`, `afterAll`, `procesarBaja`. Registrar en `processor-registry.ts`.
5. **Service**: bifurcar `processImportJob` en `imports.service.ts` para invocar el parser cuando `categoria === 'MULTIRREGISTRO'`. `mapRow` no se llama en ese caso (row ya es un `MappedRow`).
6. **Preview**: adaptar `previewFile` para mostrar grupos resueltos.
7. **Frontend fase B1**: sumar `MULTIRREGISTRO` en `PlantillaEditor`, layout de tabs por tipo de registro reusando `MappingEditor`.
8. **Frontend fase B2**: sub-panel de contactos + preview de grupos resueltos.

**Archivos a crear:**
- `backend/src/modules/imports/parsers/multirregistro-parser.ts`.
- `backend/src/modules/imports/processors/multirregistro.processor.ts`.
- (Frontend fase B1/B2): posiblemente `frontend/src/components/import/MultirregistroEditor.tsx`.

**Archivos a modificar:**
- `backend/prisma/schema.prisma` (enums).
- `backend/src/modules/imports/mapping-types.ts` (types nuevos + `ImportCategoria` + `entity`).
- `backend/src/modules/imports/imports.service.ts` (bifurcación + adaptación de preview).
- `backend/src/modules/imports/processors/processor-registry.ts` (registrar).
- `frontend/src/pages/PlantillaEditor.tsx` y `frontend/src/components/import/MappingEditor.tsx` (tabs por tipo).

**Migraciones necesarias:** sí — `npx prisma db push` para los enums.

**Skills a consultar:** `prisma-migration`, `nestjs-module`, `react-component`, `amsa-general`.

**Riesgos a tener en cuenta durante la implementación:**
- El parser NO debe cargar el archivo entero en un buffer; usar readline con stream.
- El `_baja: true` marker atraviesa `mapRow` — asegurar que el bifurcador de `processImportJob` NO llame `mapRow` para categoría `MULTIRREGISTRO`.
- Documentar el límite de memoria (grupos en Map) — recomendar <500k líneas por archivo en la primera versión.
- El uso de `GES-090` como código de baja depende de que esté seedeado; agregar guard degradado similar a Feature A.
- Confirmar el layout real de Toyota antes de codificar (archivo de muestra en manos del usuario).

---

**Fin del spec.**
