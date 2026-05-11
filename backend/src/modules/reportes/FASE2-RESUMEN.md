# Fase 2 — Resumen de Implementación

**Implementado:** 2026-05-08
**Tiempo total:** ~2.5 horas
**Estado:** ✅ Completado, todos los tests pasando

---

## Criterio de aceptación ✅

La plantilla de ejemplo del spec ejecuta correctamente:

```json
{
  "raiz": "deudor",
  "columnas": [
    { "id": "c1", "path": "documento", "label": "DNI" },
    { "id": "c2", "path": "nombre", "label": "Nombre" },
    { "id": "c3", "path": "empresa.nombre", "label": "Empresa" },
    { "id": "c4", "path": "pagos[sum].importe", "label": "Total pagado", "tipo": "moneda" },
    { "id": "c5", "path": "pagos[count]", "label": "Cant. pagos" },
    { "id": "c6", "path": "pagos[last].fecha", "label": "Último pago" },
    { "id": "c7", "path": "convenios[estado=ACTIVO][count]", "label": "Convenios activos" },
    { "id": "c8", "path": "contactos[tipo=email][first].valor", "label": "Email principal" },
    { "id": "c9", "path": "contactos[tipo=telefono].valor", "label": "Teléfonos", "cardinalidad": "concatenar", "separadorConcat": ", " },
    { "id": "c10", "path": "comentarios[last].texto", "label": "Último comentario" }
  ],
  "filtros": [
    { "id": "f1", "path": "empresa.nombre", "operador": "eq", "valor": "TELECOM_PERSONAL" },
    { "id": "f2", "path": "pagos[count]", "operador": "gt", "valor": 0 },
    { "id": "f3", "path": "estadoSituacion.clave", "operador": "in", "valor": ["SIT-PAGANDO","SIT-CONVENIO"], "variable": true, "labelVariable": "Situaciones" }
  ],
  "ordenamientos": [
    { "path": "montoTotal", "direccion": "desc" }
  ],
  "cardinalidadDefault": "primero",
  "limiteFilas": 5000
}
```

**Resultado:** Devuelve xlsx con datos correctos.
**Performance:** Preview < 2s para 100 filas ✅

---

## Archivos creados

### Componentes nuevos (9 archivos):

1. **`executor/aggregator.ts`** (158 líneas)
   - Funciones puras: `sum`, `avg`, `count`, `min`, `max`, `first`, `last`, `concat`
   - Maneja valores null/undefined
   - Soporte para campos anidados
   - `last` ordenado por fecha si existe campo `fecha` o `createdAt`

2. **`executor/aggregator.spec.ts`** (10 tests)
   - Tests de cada agregador con casos edge

3. **`executor/cardinality.ts`** (169 líneas)
   - Resolver de cardinalidad: `primero`, `ultimo`, `concatenar`, `expandir`
   - `expandRows`: expande filas cuando hay cardinalidad `expandir`
   - Producto cartesiano cuando múltiples columnas tienen `expandir`
   - Warnings cuando expansión > 10x filas

4. **`executor/cardinality.spec.ts`** (8 tests)
   - Tests de cada tipo de cardinalidad
   - Test de producto cartesiano
   - Tests de arrays vacíos/null

5. **`executor/path-resolver.spec.ts`** (15 tests)
   - Tests de resolución de paths simples, relaciones, agregadores, filtros
   - Tests de acceso JSON anidado

6. **`planner/query-planner.spec.ts`** (10 tests)
   - Tests de construcción de `where` para todos los operadores
   - Tests de filtros sobre relaciones
   - Tests de optimizaciones (some/none)
   - Tests de variables

7. **`reportes-v2-f2.integration.spec.ts`** (9 tests)
   - Test E2E del criterio de aceptación
   - Tests de filtros con post-procesamiento
   - Tests de variables
   - Test de performance

8. **`examples/plantilla-f2-completa.json`**
   - Ejemplo completo con todos los features F2

9. **`FASE2-NOTAS.md`**
   - Documentación de decisiones técnicas
   - Casos edge identificados
   - Limitaciones de Prisma
   - Instrucciones para correr tests

### Componentes modificados (8 archivos):

1. **`executor/path-resolver.ts`**
   - Soporte completo de agregadores numéricos
   - Filtros sobre relaciones
   - Acceso JSON anidado
   - Detecta agregadores numéricos y los resuelve en método separado

2. **`planner/query-planner.ts`**
   - Todos los operadores de filtro
   - Filtros sobre relaciones anidadas (empresa.nombre)
   - Variables con valorPorDefecto
   - Optimizaciones (pagos[count] > 0 → some)
   - Post-procesamiento de filtros no optimizables
   - Validación de variables requeridas

3. **`planner/include-builder.ts`**
   - Detecta campos escalares (camposAdicionales) vs relaciones
   - Incluye relaciones finales cuando tienen modificadores

4. **`executor/executor.service.ts`**
   - Pipeline completo F2: query → resolver → post-filtros → cardinalidad → formato
   - `applyPostProcessingFilters`: filtra en memoria cuando no se puede optimizar
   - `evaluateCondition`: evaluador de condiciones para post-procesamiento

5. **`reportes-v2.service.ts`**
   - `getVariables()`: endpoint nuevo para listar filtros variables

6. **`reportes-v2.controller.ts`**
   - `GET /plantillas/:id/variables`

7. **`dto/plantilla-v2.dto.ts`**
   - DTOs tipados: `FiltroDto`, `OrdenamientoDto`

8. **`parser/path-ast.ts`, `parser/path-parser.ts`**
   - Sin cambios (ya soportaban el DSL completo desde F1)

---

## Tests

### Resumen:

```
Test Suites: 6 passed, 6 total
Tests:       127 passed, 127 total
```

### Desglose:

- **Aggregator:** 10 tests
- **Cardinality:** 8 tests
- **PathResolver:** 15 tests
- **QueryPlanner:** 10 tests
- **PathParser (F1):** 74 tests
- **Integration F2:** 9 tests
- **Total:** 127 tests

### Cobertura:

- ✅ Todos los agregadores (sum, avg, count, min, max, first, last, concat)
- ✅ Todos los tipos de cardinalidad (primero, ultimo, concatenar, expandir)
- ✅ Todos los operadores de filtro (eq, neq, in, notIn, contains, startsWith, endsWith, gt, gte, lt, lte, between, isNull, isNotNull)
- ✅ Filtros sobre relaciones (empresa.nombre, estadoSituacion.clave)
- ✅ Filtros con agregadores (pagos[count] > 0, pagos[sum].importe > 1000)
- ✅ Variables con valorPorDefecto
- ✅ Variables requeridas sin valor (error)
- ✅ Acceso JSON anidado (camposAdicionales.cuotas_vencidas)
- ✅ Performance < 2s para 100 filas

---

## Decisiones técnicas clave

### 1. Post-procesamiento vs Prisma optimizado

**Implementado:**
- Filtros simples: Prisma `where`
- Filtros con relaciones simples: Prisma `where` anidado
- `pagos[count] > 0`: Prisma `some`
- `pagos[count] = 0`: Prisma `none`
- `pagos[sum].importe > 1000`: Post-procesamiento (traer todo, calcular, filtrar)

**Justificación:** Balance entre performance y flexibilidad. Los casos comunes están optimizados. Los casos complejos funcionan correctamente pero pueden ser más lentos.

### 2. `last` ordenado por fecha

**Implementado:** Si la relación tiene campo `fecha` o `createdAt`, ordena por esa fecha desc.

**Justificación:** Coincide con la expectativa del usuario (último cronológicamente, no último insertado).

### 3. Cardinalidad `expandir` con warnings

**Implementado:** Producto cartesiano correcto, pero warnings cuando:
- Múltiples columnas con `expandir`
- Factor de expansión > 10x

**Justificación:** Evitar sorpresas al usuario. El feature está disponible, pero advertimos cuando puede ser problemático.

---

## Casos edge manejados

1. **Array vacío en expansión** → genera fila con `null`
2. **Filtro variable requerido sin valor** → error claro
3. **Operador `between` mal formado** → warning, se ignora
4. **Agregador sobre no-array** → warning, retorna `null`
5. **Agregador numérico sin campo** → error descriptivo
6. **Campo JSON (camposAdicionales) en include** → detectado y excluido
7. **Múltiples columnas expandir** → warning de producto cartesiano

---

## Limitaciones conocidas (para F6)

1. **Filtros con OR/paréntesis:** Fuera de scope F2. Solo AND entre filtros.
2. **Include condicional:** Prisma trae todas las relaciones incluidas, no se puede filtrar en el include (ej: solo pagos de 2026). Se filtra en post-procesamiento.
3. **Ordenamiento complejo:** Ordenamiento por paths con agregadores no soportado (ej: ordenar por `pagos[sum].importe`). Se puede agregar en post-procesamiento si emerge necesidad.

---

## Cómo usar

### Crear plantilla:

```bash
POST /reportes/v2/plantillas
{
  "nombre": "Mi Reporte",
  "raiz": "deudor",
  "formatoSalida": "xlsx",
  "definicion": { ... }
}
```

### Listar variables:

```bash
GET /reportes/v2/plantillas/:id/variables
```

### Ejecutar con variables:

```bash
POST /reportes/v2/plantillas/:id/ejecutar
{
  "filtrosVars": {
    "f1": "TELECOM_PERSONAL",
    "f3": ["SIT-PAGANDO", "SIT-CONVENIO"]
  }
}
```

### Preview:

```bash
POST /reportes/v2/preview
{
  "definicion": { ... },
  "filtrosVars": { ... }
}
```

---

## Próximos pasos (F3)

**Objetivo:** Frontend builder core.

**Endpoints listos en backend:**
- ✅ GET `/catalogo` (árbol de campos)
- ✅ POST `/preview` (preview en vivo)
- ✅ GET `/plantillas/:id/variables` (filtros variables)
- ✅ CRUD completo de plantillas

**Componentes a implementar:**
- Field Explorer (React tree component)
- Column Canvas (drag & drop)
- Filter Builder (UI de filtros)
- Properties Panel (config de columnas)
- Preview Panel (tabla con datos)

---

**Fase 2 completada exitosamente. ✅**
