# Fase 2 — Notas de Implementación

**Fecha:** 2026-05-08
**Estado:** Completado
**Tests:** 126/126 passing

---

## Decisiones técnicas tomadas

### 1. Post-procesamiento de filtros con agregadores

**Problema:** Filtros como `pagos[sum].importe > 1000` no se pueden expresar directamente en el `where` de Prisma.

**Solución:**
- Filtros simples optimizables (`pagos[count] > 0`, `pagos[count] = 0`) se mapean a `some`/`none` de Prisma.
- Filtros complejos con agregadores (`sum`, `avg`, etc.) se aplican en **post-procesamiento**: traemos todos los deudores que pasan los filtros básicos, calculamos el agregador en memoria, y luego filtramos las filas.
- Esto genera un warning en logs para que quede registrado que el filtro no está optimizado.

**Documentado en:** `query-planner.ts` líneas 74-105.

### 2. Cardinalidad `expandir` con múltiples columnas

**Problema:** Si dos columnas tienen `cardinalidad: 'expandir'` (ej: emails y teléfonos), se genera producto cartesiano.

**Solución:**
- Implementar producto cartesiano correcto en `cardinality.ts`.
- Emitir **warning** cuando se detectan múltiples columnas con `expandir`, indicando que puede multiplicar filas exponencialmente.
- Si el factor de expansión > 10x, warning adicional con sugerencia de cambiar a `concatenar` o `primero`.

**Documentado en:** `cardinality.ts` líneas 33-41, 66-71.

### 3. Agregador `last` ordenado por fecha

**Problema:** `last` puede significar "último insertado en DB" o "último cronológicamente".

**Decisión:**
- Si la relación tiene campo `fecha` o `createdAt`, `last` ordena por esa fecha **desc** y retorna el primero (más reciente).
- Si no tiene campo fecha, retorna el último elemento del array (orden DB).

**Documentado en:** `aggregator.ts` líneas 94-120.

### 4. Campos JSON (`camposAdicionales`)

**Problema:** `camposAdicionales` es un campo JSON escalar, no una relación. El IncludeBuilder intentaba incluirlo y causaba error de Prisma.

**Solución:**
- Lista hardcodeada de campos escalares conocidos (`SCALAR_FIELDS_KNOWN`) que el IncludeBuilder debe ignorar.
- Para acceso a JSON anidado (`camposAdicionales.cuotas_vencidas`), el PathResolver navega directamente sin necesidad de `include`.

**Documentado en:** `include-builder.ts` líneas 5-6, 27-28.

### 5. Relaciones anidadas con agregadores

**Ejemplo:** `convenios[estado=ACTIVO].cuotas[estado=PENDIENTE][count]`

**Implementación actual (F2):**
- El PathResolver resuelve cada convenio activo, filtra cuotas pendientes, cuenta, y suma.
- **Limitación:** Si queremos mostrar el count individual por convenio, necesitaríamos cambiar el diseño del path (pendiente para F3 si hace falta).

**Actualmente funciona para:** Contar total de cuotas pendientes en todos los convenios activos de un deudor.

---

## Casos edge identificados y resolución

### 1. Array vacío en expansión

**Caso:** `contactos[tipo=email].valor` donde el deudor no tiene emails.

**Resolución:** `expandRows` genera una fila con `null` en esa columna. Si el array está vacío, se convierte a `[null]` para que siempre haya al menos una fila base.

**Test:** `cardinality.spec.ts` línea 139.

### 2. Filtros variables requeridos sin valor

**Caso:** Filtro marcado como `variable: true` sin `valorPorDefecto` y sin valor en `filtrosVars`.

**Resolución:** `BadRequestException` con mensaje claro: `"Filtro variable 'X' es requerido pero no se proporcionó valor"`.

**Test:** `reportes-v2-f2.integration.spec.ts` línea 91.

### 3. Operador `between` con valor mal formado

**Caso:** `between` recibe un valor que no es array de 2 elementos.

**Resolución:** Warning en logs y se ignora el filtro (no se agrega al `where`).

**Documentado en:** `query-planner.ts` línea 234.

### 4. Path con modificador sobre no-array

**Caso:** `empresa[count]` (empresa es 1-1, no 1-N).

**Resolución:** Warning en logs: `"agregador [count] aplicado sobre no-array"`, retorna `null`.

**Documentado en:** `path-resolver.ts` línea 60.

### 5. Agregadores numéricos sin campo escalar

**Caso:** `pagos[sum]` sin `.importe` después.

**Resolución:** `BadRequestException` descriptivo: `"agregador [sum] requiere campo escalar después (ej: pagos[sum].importe)"`.

**Documentado en:** `path-resolver.ts` líneas 78-82.

---

## Performance

### Preview (100 filas)

**Objetivo:** < 2s

**Resultado:** ~20-70ms en tests con DB local (muestra vacía/chica).

**Cuellos de botella identificados:**
- Include de múltiples relaciones: si el deudor tiene 10 relaciones incluidas, Prisma hace joins.
- Post-procesamiento de filtros: si hay 10.000 deudores y filtramos por `pagos[sum].importe > 1000`, calculamos sum en todos antes de filtrar.

**Optimizaciones aplicadas:**
- `take: 100` en preview se aplica **antes** de calcular agregadores, no después.
- Filtros `pagos[count] > 0` optimizados con `some`/`none` de Prisma.

**Pendiente para F6 (async):**
- Streaming con cursor de Prisma para volúmenes grandes.
- Cache de agregadores frecuentes (ej: sum de pagos) si se vuelve bottleneck.

---

## Limitaciones conocidas de Prisma anotadas para F6

### 1. Ordenamiento por paths relacionados

**Limitación:** `orderBy: { empresa: { nombre: 'asc' } }` funciona, pero con limitaciones cuando hay múltiples niveles o agregadores.

**Workaround F2:** Ordenamiento en post-procesamiento si es necesario (no implementado aún, pendiente si emerge necesidad).

### 2. Filtros complejos con OR / paréntesis

**Fuera de scope F2:** Solo AND entre filtros. OR pendiente para v2.1.

### 3. Include condicional

**Limitación:** Prisma no permite `include` condicional basado en filtros. Si incluimos `pagos`, trae todos los pagos del deudor, aunque luego filtremos por fecha.

**Impacto:** Si deudor tiene 1.000 pagos y solo queremos los de 2026, Prisma trae los 1.000 y luego el PathResolver filtra. Esto puede causar overhead.

**Workaround:** Aplicar `where` en el include cuando sea posible (no implementado en F2, pendiente para F6 si es crítico).

**Ejemplo ideal (no implementado):**
```typescript
include: {
  pagos: {
    where: { fecha: { gte: '2026-01-01' } }
  }
}
```

---

## Tests

### Unitarios

- `aggregator.spec.ts`: 10 tests (sum, avg, count, min, max, first, last, concat con casos edge).
- `cardinality.spec.ts`: 8 tests (expandir, concatenar, primero, último, producto cartesiano).
- `path-resolver.spec.ts`: 15 tests (escalares, relaciones, agregadores, filtros, JSON).
- `query-planner.spec.ts`: 10 tests (filtros básicos, relaciones, agregadores, variables).
- `path-parser.spec.ts`: 40+ tests (herencia de F1, todos pasan).

**Total unitarios:** 118 tests.

### Integración

- `reportes-v2-f2.integration.spec.ts`: 8 tests end-to-end con DB real.

**Total integración:** 8 tests.

**Total general:** **126 tests** pasando.

---

## Cómo correr tests

### Todos los tests v2:
```bash
npx jest --testPathPatterns="reportes/v2"
```

### Solo tests F2:
```bash
npx jest reportes-v2-f2.integration.spec.ts
```

### Test específico:
```bash
npx jest path-resolver.spec.ts
npx jest aggregator.spec.ts
npx jest cardinality.spec.ts
npx jest query-planner.spec.ts
```

### Compilación TypeScript:
```bash
npx tsc --noEmit
```

---

## Archivos creados/modificados

### Creados (nuevos):

1. `executor/aggregator.ts` — Funciones puras de agregación.
2. `executor/aggregator.spec.ts` — Tests unitarios.
3. `executor/cardinality.ts` — Resolver de cardinalidad y expansión de filas.
4. `executor/cardinality.spec.ts` — Tests unitarios.
5. `executor/path-resolver.spec.ts` — Tests del resolver (nuevo en F2).
6. `planner/query-planner.spec.ts` — Tests del planner (nuevo en F2).
7. `reportes-v2-f2.integration.spec.ts` — Tests de integración E2E.
8. `examples/plantilla-f2-completa.json` — Ejemplo de plantilla con todos los features.
9. `FASE2-NOTAS.md` — Este archivo.

### Modificados (actualización F1 → F2):

1. `executor/path-resolver.ts` — Agregadores, filtros sobre relaciones, JSON anidado.
2. `planner/query-planner.ts` — Filtros completos, variables, optimizaciones, post-procesamiento.
3. `planner/include-builder.ts` — Detectar campos escalares vs relaciones.
4. `executor/executor.service.ts` — Post-procesamiento de filtros, cardinalidad expandir.
5. `reportes-v2.service.ts` — Endpoint `getVariables`.
6. `reportes-v2.controller.ts` — Endpoint `GET /plantillas/:id/variables`.
7. `dto/plantilla-v2.dto.ts` — DTOs tipados para `FiltroDto`, `OrdenamientoDto`.

---

## Siguiente fase (F3)

**Scope:** Frontend builder core.

**Bloqueadores resueltos en F2:**
- ✅ Backend soporta todos los operadores de filtro.
- ✅ Backend soporta agregadores y cardinalidad.
- ✅ Endpoint `/variables` listo para renderizar form de variables.
- ✅ Preview endpoint funciona con definición completa.

**Pendientes para F3:**
- Field Explorer (árbol de campos).
- Column Canvas (drag & drop).
- Filter Builder (UI de filtros).
- Preview en vivo.

---

**Fin de Fase 2.**
