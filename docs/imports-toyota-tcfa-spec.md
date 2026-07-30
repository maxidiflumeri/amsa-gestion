# Carga Toyota TCFA — paquete de 4 archivos (categoría MULTIARCHIVO)

**Proyecto:** AMSA Gestión
**Módulos involucrados:** `imports` (nueva categoría + parser + reuso del processor de MULTIRREGISTRO), `deudores`, `facturas`, `contactos`, frontend `PlantillaEditor` + alta de remesa.
**Fecha:** 2026-07-30
**Estado:** **fases 1 a 5 IMPLEMENTADAS** (2026-07-30, ver CHANGELOG). Decisiones D1, D3, D4 y D5
tomadas; D2 y D6 abiertas con default aplicado. **La carga es operable desde la UI.**
Falta la fase 6 (codeudores en la ficha del deudor), que no bloquea la operación.

> ⚠️ **Al deployar hace falta `npx prisma db push`** (aditivo: columna `remesa.archivos` + valor
> `MULTIARCHIVO` en los dos enums de categoría). Ya aplicado en desarrollo, **falta en prod**.
>
> ⚠️ **Falta la prueba a mano**: subir los 4 archivos desde el navegador y ejecutar la importación
> contra la base. Todo está cubierto por tests, pero el flujo real todavía no se corrió.
>
> ⚠️ **La desasignación de ausentes (fase 5) está APAGADA por default.** Para activarla hay que poner
> `"accionAusente": "DESASIGNAR"` en la plantilla, y antes **confirmar con Toyota que el archivo de
> deudores trae siempre la cartera completa** (ver D1). Si puede venir parcial, no alcanza con las
> salvaguardas implementadas.

Archivos analizados: `IO_20260529/{Deudores,DetalleDeuda,Bajas,CoDeudores}.txt` (bajada del 29/05/2026).

---

## 0. Resumen ejecutivo

Toyota TCFA manda **4 archivos separados** en vez de un TXT multirregistro. La semántica de negocio es
**la misma que Toyota cuenta 87** (cliente → contratos → cuotas; bajas por cuota individual con pago
parcial o total), pero la **forma del archivo es distinta** y el modelo de claves también.

**Veredicto: no entra en `MULTIRREGISTRO` tal como está, pero el processor sí se reutiliza casi entero.**

- El **parser** de MULTIRREGISTRO (`utils/multirregistro-parser.ts`) es inservible acá: asume un solo
  archivo, discriminador por código de línea (`CLI`/`GES`/`DET`/`BAJ`) y una clave de cruce simple
  (`aviso`). TCFA tiene 4 archivos, headers con nombres, clave de cruce compuesta y un archivo
  (`CoDeudores`) que no tiene equivalente. → **parser nuevo**.
- El **processor** (`processors/multirregistro.processor.ts`) sí sirve: ya encapsula toda la lógica
  ganada a golpes en Toyota 87 (baja por pago vs. retiro del cedente, GES-090 + SIT-071 solo si no
  quedan cuotas vigentes, consolidación de *deudores tocados* y no de la remesa, cierre de promesas,
  enriquecimiento histórico de contactos, guard de ambigüedad). → **se comparte con 5 ajustes chicos**.

Estimación: **~70 % de reuso**. Lo nuevo es el parser multi-archivo, el soporte de subir N archivos en
una remesa, y la lógica de "ausentes del snapshot" (que TCFA necesita y Toyota 87 no).

---

## 1. Análisis del formato (verificado sobre el archivo real)

Encoding: **Latin-1** (`Deudores.txt` y `CoDeudores.txt` traen acentos/Ñ; los otros dos son ASCII puro).
Separador `;`, CRLF, **con header**, campos paddeados con espacios a ancho fijo (hay que trimear),
y en `DetalleDeuda.txt` algunos campos vienen **entre comillas** (hay que desentrecomillar).

### 1.1. `Deudores.txt` — 854 filas

```
IdAsignacion;cliente;nombre;calle;numero;piso;departamento;codpostal;ciudad;codprovincia;
provincia;tipopersona;tipocodfiscal;codfiscal;ivacond;email;ddd;telefono1;telefono2;
FechaAsignacion;CuotasVencidas;TotalDeuda;DiasMoraMax
```

| Verificación | Resultado |
|---|---|
| `cliente` único | **854/854**, cero repetidos |
| `IdAsignacion` único | **854/854**, 1:1 con `cliente` **dentro del archivo** |
| `codfiscal` (CUIT/CUIL) presente y único | **854/854** — hay **documento real**, a diferencia de Toyota 87 |
| Con email / tel1 / tel2 | 843 / 843 / 132 |
| `tipopersona` | `F` (física) / `J` (jurídica) |

**El archivo es un SNAPSHOT completo de la cartera vigente, no un incremental.** Evidencia:
`FechaAsignacion` va de 13/05/2020 a 29/05/2026, y solo **120 de 854** tienen la fecha del día del
archivo. Los otros 734 son casos ya asignados en bajadas anteriores que se reenvían. → Esto abre la
decisión **D1** (qué hacer con los que dejan de venir).

### 1.2. `DetalleDeuda.txt` — 981 filas = las cuotas vencidas

```
"IdAsignacion";"cliente";"contrato";"cuota";"FehcaVto";"capital";"interes";"gastos";"gas_even";
"itf";"seg";"sev";"iva";"int_mor";"int_pun";"iva_mor_pun";"saldocontrato";"Debito";"IdNameScore";"Reverso"
```

**Una fila = una cuota vencida de un contrato = una `factura` en AMSA.**

| Verificación | Resultado |
|---|---|
| `(cliente, contrato, cuota)` único | **981/981**, cero duplicados |
| `(contrato, cuota)` único a nivel archivo | también único → el contrato identifica al cliente |
| Contratos compartidos entre clientes | **0** |
| Importe de la cuota = Σ de los 11 conceptos | ✅ ver abajo |
| Valores negativos en conceptos | **0** (a diferencia de Toyota 87, que tenía notas de crédito) |
| Cuotas con importe 0 | **0**. Rango: $34.508 – $15.172.063 |

**Importe de la cuota** = `capital + interes + gastos + gas_even + itf + seg + sev + iva + int_mor +
int_pun + iva_mor_pun`. `saldocontrato` **NO** es el importe (es el saldo del contrato, casi siempre 0)
— sumarlo da resultado incorrecto en el 100 % de los casos.

#### ⚠️ El join correcto es por `IdAsignacion`, NO por `cliente`

Es el hallazgo más importante del análisis y la diferencia entre cargar bien o inflar la deuda:

| Criterio de join | `TotalDeuda` del deudor coincide con Σ de sus cuotas | `CuotasVencidas` coincide con la cantidad de cuotas |
|---|---|---|
| por `cliente` | 786 / 854 | 786 / 854 |
| **por `IdAsignacion`** | **788 / 788** ✅ (cero diferencias) | **788 / 788** ✅ |

`DetalleDeuda.txt` trae **61 filas huérfanas** (46 `IdAsignacion` que no están en `Deudores.txt`): son
**asignaciones viejas** que el cedente sigue mandando en el detalle. 3 de esas filas pertenecen a un
cliente que **sí** está asignado hoy pero **con otro `IdAsignacion`**. Si se joinea por `cliente` esas
cuotas viejas se le pegan al caso vigente:

- cliente `475931` → deuda real $2.199.415, con join por cliente daría **$6.878.743** (+$4,6 M inventados).
- cliente `373471` → $898.231 real vs $1.091.342.

**Regla: se cargan solo las filas de `DetalleDeuda` cuyo `IdAsignacion` esté en `Deudores.txt`.
El resto se descarta (y se reporta como advertencia del import).**

Además: **66 deudores no tienen ninguna fila en el detalle** — todos son las asignaciones de 13/05/2020.
Traen `TotalDeuda` pero sin desglose. → decisión **D2**.

Cardinalidades: 700 asignaciones con 1 cuota, 124 con 2, 7 con 3, 3 con 4. Contratos por asignación:
824 con 1, 7 con 2, 2 con 3, 1 con 4.

### 1.3. `Bajas.txt` — 85 filas

```
IdAsignacion;cliente;contrato;cuota;FechaFinGestion;IDMotivo;Motivo
```

| Verificación | Resultado |
|---|---|
| `(cliente, contrato, cuota)` único | 85/85 |
| Bajas que matchean una cuota del `DetalleDeuda` **de hoy** | **0 de 85** |
| Bajas cuyo `cliente` sí está en `Deudores.txt` de hoy | 6 |
| Clientes con más de una baja en el mismo archivo | 12 |

Igual que en Toyota 87: **la baja siempre refiere a una cuota que ya NO viene en el archivo del día**
(el cedente la saca del detalle y la informa por separado). O sea que la cuota tiene que estar en
nuestra base de una bajada anterior; se resuelve buscándola **empresa-wide**, no dentro de la remesa.

**Motivos (con código numérico estable — mejor que matchear texto):**

| IDMotivo | Motivo | Cant. | Tratamiento propuesto |
|---|---|---|---|
| `1` | Pago de Cuota | 65 | **Pago** por el importe de la cuota + factura `PAGADA` |
| `4` | Envio a Gestion Especial | 18 | Retiro del cedente → factura `ANULADA`, sin pago |
| `3` | Contrato Finalizado/Terminado | 2 | Retiro del cedente → factura `ANULADA`, sin pago (ver **D3**) |

**Los 6 casos que cruzan con la cartera de hoy confirman exactamente el escenario de pago parcial que
describió el cliente.** Ejemplo textual del archivo:

```
Baja:          cliente 488744, contrato 1127530, cuota 12, "Pago de Cuota"
Detalle hoy:   cliente 488744, contrato 1127530, cuota 13, $344.483,87  ← queda vigente
Deudores hoy:  cliente 488744, CuotasVencidas=1, TotalDeuda=$344.483,87
```

→ Se descarga el pago de la cuota 12, la cuota 13 queda viva, el caso sigue en gestión. Solo cuando el
deudor se queda **sin ninguna cuota vigente** sale de gestión. Es exactamente la regla que ya implementa
`MultirregistroProcessor.procesarBaja()`.

#### `IdAsignacion` NO es estable entre bajadas

En 3 de esos 6 casos el `IdAsignacion` de la baja es distinto al que trae `Deudores.txt` hoy para el
mismo cliente (`488744`: baja 366960 vs. hoy 368366). O sea: **`IdAsignacion` sirve solo para joinear
dentro del mismo paquete de archivos; la clave estable del deudor entre días es `cliente`.**
(Coincide con lo que ya hace Toyota 87 con `nroCliente`.)

También: el cliente `508134` tiene una baja del contrato `1133300` y hoy trae el contrato `1134698` —
un cliente puede rotar de contrato.

### 1.4. `CoDeudores.txt` — 55 filas

```
IdAsignacion;ClienteTitular;ClienteCoDeudor;nombre;calle;numero;piso;departamento;codpostal;ciudad;
CodProvincia;Provincia;TipoPersona;TipoCodFiscal;CodFiscal;ivacond;email;ddd;telefono1;telefono2
```

| Verificación | Resultado |
|---|---|
| Titulares presentes en `Deudores.txt` | **55/55** |
| Codeudor que además sea titular de otro caso | **0** |
| Titulares con 2 codeudores | 2 (`407559`, `260194`) |
| Codeudores con CodFiscal / teléfono / email | 55 / 55 / 26 |

AMSA **no tiene entidad codeudor**. Ver decisión **D4**.

---

## 2. Qué se reusa y qué hay que construir

| Pieza | Estado | Trabajo |
|---|---|---|
| `MultirregistroProcessor` (bajas, pagos, GES-090/SIT-071, consolidación, promesas, contactos) | ✅ sirve | 5 ajustes chicos (§4) |
| `utils/enriquecimiento-historico.ts`, `campos-adicionales.ts`, `phone-utils.ts` | ✅ sirve | ninguno |
| Runner de imports (batch, progreso, socket, `importerror`, `afterAll`) | ✅ sirve | rama nueva de parseo (igual que la de MULTIRREGISTRO) |
| Consolidación de situación (SIT-050 / SIT-041) | ✅ sirve | ninguno |
| `utils/multirregistro-parser.ts` | ❌ no aplica | **parser nuevo** (`multiarchivo-parser.ts`) |
| Subida de 1 archivo por remesa | ❌ no alcanza | **soporte multi-archivo** (§5) |
| Lógica de "ausentes del snapshot" | ❌ no existe en MULTIRREGISTRO | portar de Feature A (ACTUALIZACIONES) — ver **D1** |
| Codeudores | ❌ no existe | §4.5 + **D4** |

**No conviene forzar esto dentro de `MULTIRREGISTRO`.** Ese formato tiene la estructura del archivo
codificada en el parser (por diseño explícito, ver comentario de `MultirregistroConfig`); meter un
segundo layout adentro lo convierte en un ETL genérico a medio hacer. La categoría nueva sale más
barata y deja `MULTIRREGISTRO` intacto (Toyota 87 está en producción).

---

## 3. Diseño propuesto — categoría `MULTIARCHIVO`

### 3.1. Contrato de config (`mapping-types.ts`)

Mismo criterio que `MultirregistroConfig`: **la estructura vive en el código, el layout vive en la
plantilla** (así, si el cedente mueve una columna, se corrige sin deploy). Como acá los archivos traen
header, el layout se declara **por nombre de columna** en vez de por índice — más legible y robusto a
que agreguen columnas al final.

```ts
export interface MultiarchivoConfig {
  encoding?: 'latin1' | 'utf8';          // TCFA: latin1
  tieneHeader?: boolean;                 // TCFA: true
  /** Cómo se reconoce cada archivo del paquete por su nombre. */
  archivos: {
    deudores:   { patron: string };      // "^Deudores"
    detalle:    { patron: string };      // "^DetalleDeuda"
    bajas?:     { patron: string };      // "^Bajas"
    codeudores?:{ patron: string };      // "^CoDeudores"
  };
  /** Layout de Deudores.txt → deudor + contactos. */
  deudores: {
    claveAsignacion: string;   // "IdAsignacion"
    nroCliente: string;        // "cliente"
    nombre: string;            // "nombre"
    documento?: string;        // "codfiscal"
    tipoDocumento?: string;    // "tipocodfiscal"
    domicilio?: string[];      // ["calle","numero","piso","departamento"]
    email?: string;
    codArea?: string;          // "ddd"
    telefonos?: string[];      // ["telefono1","telefono2"]
    montoTotal?: string;       // "TotalDeuda"
    fechaAsignacion?: string;
    adicionales?: Record<string, string>;  // { cp:"codpostal", localidad:"ciudad", ... }
  };
  /** Layout de DetalleDeuda.txt → una factura por cuota. */
  detalle: {
    claveAsignacion: string;   // "IdAsignacion" — join con deudores
    contrato: string;
    cuota: string;
    vencimiento?: string;      // "FehcaVto"
    /** Columnas que se SUMAN para dar el importe de la cuota. */
    conceptosImporte: string[];
    /** Columnas informativas que van al desglose de texto. */
    adicionales?: Record<string, string>;  // { score:"IdNameScore", debito:"Debito" }
  };
  /** Layout de Bajas.txt. */
  bajas?: {
    nroCliente: string; contrato: string; cuota: string;
    fecha?: string; motivo?: string; motivoId?: string;
    /** IDMotivo que significan "la cuota se cobró". TCFA: ["1"]. */
    motivosPagoIds?: string[];
    /** Fallback por texto si el cedente no manda código. */
    motivosPago?: string[];
  };
  /** Layout de CoDeudores.txt. */
  codeudores?: {
    titular: string; nroCodeudor: string; nombre: string;
    documento?: string; email?: string; codArea?: string; telefonos?: string[];
    domicilio?: string[];
  };
  /** Qué hacer con deudores de la cartera ausentes del snapshot. Ver D1. */
  accionAusente?: 'DESASIGNAR' | 'IGNORAR';
}
```

Y el layout concreto de TCFA va en `plantillas/toyota-tcfa.ts` como referencia (mismo patrón que
`plantillas/toyota-87.ts`).

### 3.2. Parser (`utils/multiarchivo-parser.ts`)

Recibe los 4 buffers y emite **las mismas filas normalizadas que ya consume el processor** — ésa es la
clave del reuso:

```ts
parseMultiarchivo(archivos: Record<Rol, Buffer>, cfg, sep) → {
  filas: MappedRow[],       // _tipo 'CASO' | 'BAJA'
  advertencias: string[],
  resumen: { deudores, cuotas, bajas, codeudores, huerfanas, sinDetalle }
}
```

Pasos:

1. Decodificar Latin-1, partir líneas, leer header, mapear nombre→índice, **trimear y desentrecomillar**.
2. Indexar `DetalleDeuda` por `IdAsignacion`. **Descartar** las filas cuyo `IdAsignacion` no esté en
   `Deudores.txt` → advertencia `"N cuotas de asignaciones que ya no están vigentes — se descartan"`.
3. Indexar `CoDeudores` por `ClienteTitular`.
4. Por cada fila de `Deudores.txt`, emitir una fila `CASO`:
   ```ts
   {
     _tipo: 'CASO',
     nroCliente: '488744',
     documento: '27179395431',              // codfiscal real
     nombre: 'SINCHICAY YMELDA VIVIAN',
     montoTotalDeclarado: 344483.87,        // TotalDeuda del cedente (ver D6)
     camposAdicionales: { cp, localidad, provincia, tipo_persona, cond_iva,
                          domicilio, fecha_asignacion, dias_mora_max,
                          cuotas_vencidas, codeudores: [...] },
     _blocks: [
       { entity:'FACTURA',  data:{ nroFactura:'1127530-13', importe:344483.87,
                                   contrato:'1127530', vencimiento: Date,
                                   detalle:'Capital: … | Interés: … | IVA: … | Score: 3' } },
       { entity:'CONTACTO', data:{ tipo:'telefono', valor:'3516065378' } },
       { entity:'CONTACTO', data:{ tipo:'email', valor:'…' } },
       { entity:'CONTACTO', data:{ tipo:'telefono', valor:'…', subtipo:'codeudor' } },
     ],
   }
   ```
   - `nroFactura = "${contrato}-${cuota}"` → único por deudor (verificado: único incluso a nivel global).
   - `externalId = contrato` (mismo criterio que Toyota 87).
   - `vencimiento` = `FehcaVto` real (Toyota 87 no tenía y ponía `new Date()`).
5. Por cada fila de `Bajas.txt`, emitir una fila `BAJA`:
   ```ts
   { _tipo:'BAJA', nroCliente:'488744', nroFactura:'1127530-12',
     fecha:Date, motivo:'Pago de Cuota', motivoId:'1' }
   ```
6. Advertencias que van a `importerror` (mismo mecanismo que MULTIRREGISTRO): cuotas huérfanas,
   deudores sin detalle, codeudores sin titular, filas sin clave.

### 3.3. Parseo de fechas

⚠️ **Las fechas vienen `D/M/YYYY HH:mm:ss` sin cero a la izquierda** (`29/5/2026 00:00:00`,
`1/12/2025 00:00:00`). El helper actual `parseFechaBaja()` del processor usa
`/^(\d{2})\/(\d{2})\/(\d{4})$/` y **fallaría en todas** (cae al `new Date()` del día). Hay que
reemplazarlo por `/^(\d{1,2})\/(\d{1,2})\/(\d{4})/` ignorando la parte de hora.

---

## 4. Ajustes al processor compartido ✅ IMPLEMENTADO

**Resuelto con una base abstracta + dos subclases finas**, en vez de una clase sirviendo a dos
categorías con un nombre que mentiría sobre la mitad de lo que hace:

```
CasosCedenteProcessor (abstract)   ← toda la lógica de negocio
├── MultirregistroProcessor        ← cuenta 87
└── MultiarchivoProcessor          ← TCFA
```

Cada subclase declara solo dos cosas: de dónde salen los motivos de baja y qué documento usar cuando
el archivo no trae DNI. Los cambios son todos aditivos y **retrocompatibles con Toyota 87** (sus 29
tests pasan sin cambios de comportamiento):

1. **Documento real.** Hoy fuerza `SIN_DOC_${nroCliente}`. Pasa a: `row.documento ?? \`SIN_DOC_${nroCliente}\``.
2. **Fechas de la factura.** Hoy hardcodea `fechaEmision: new Date(), vencimiento: new Date()`. Pasa a
   usar `b.data.vencimiento` si viene.
3. **Baja precisa por deudor.** Hoy busca la factura empresa-wide por `nroFactura` y **descarta la baja
   si matchea a más de un deudor** (guard de ambigüedad). TCFA trae el `cliente` en la baja → si la fila
   trae `nroCliente`, resolver primero el deudor y después la factura por `(deudorId, nroFactura)`:
   sin ambigüedad posible. Se conserva el camino viejo como fallback.
4. **Motivo de baja por código.** Además del match por texto (`motivosPago`), aceptar
   `motivosPagoIds` contra `row.motivoId`. Más robusto: el texto del cedente puede cambiar, el código no.
5. **`montoTotal` sin facturas.** `recalcularMonto()` hoy setea `Σ facturas`, que para los 66 casos sin
   detalle daría **$0** y los borraría de la cartera. Pasa a: si no hay ninguna factura y la fila trae
   `montoTotalDeclarado`, usar ése. Ver **D6**.

Y una pieza nueva (solo si D1 = `DESASIGNAR`):

6. **`afterAll` — ausentes del snapshot.** Portar la lógica de Feature A (`accionAusente`) de
   `ActualizacionesProcessor`: los deudores de la empresa que no vinieron en el snapshot de hoy →
   `estadoGestionId = GES-094` guardando `estadoGestionPrevioAId`; si reaparecen mañana se re-asignan
   solos. Respeta el bloqueo SIT-050 y **no toca deuda ni pagos**.
   ⚠️ Diferencia con Feature A: allá el universo es "la remesa origen"; acá los casos nuevos entran en
   una remesa nueva por día, así que el universo es **toda la cartera de la empresa que no esté ya en
   GES-090 (baja) ni cancelada**. Hay que definirlo explícito al implementar.

---

## 5. Soporte multi-archivo (la parte de infraestructura)

Hoy `createRemesa(dto, file)` recibe **un** archivo (`FileInterceptor`) y lo guarda en `remesa.archivo`
(`String?`). Cambios mínimos:

| Capa | Cambio |
|---|---|
| `schema.prisma` (`model remesa`) | Nueva columna `archivos Json?` — mapa `{ rol: path }`. `archivo` sigue apuntando al principal (`Deudores`) para no romper hash, borrado ni el resto del código. `db push`. |
| `imports.controller.ts` | `@UseInterceptors(FilesInterceptor('files', 6))` en `POST /remesas` cuando la categoría es `MULTIARCHIVO`. Se mantiene `FileInterceptor('file')` para el resto. |
| `imports.service.ts` | `createRemesa`: si hay varios archivos, resolver el **rol de cada uno por el patrón de nombre** de la plantilla (`^Deudores`, `^DetalleDeuda`, …), guardarlos todos y validar que estén los obligatorios (`deudores`, `detalle`). Error claro si falta uno o si dos matchean el mismo rol. |
| `imports.service.ts` (worker) | Rama nueva análoga a la de MULTIRREGISTRO: leer los N buffers → `parseMultiarchivo` → mismo `batch`/`processBatch`. |
| `imports.service.ts` (`previewFile`) | Preview del paquete: cantidad de deudores, cuotas, bajas, codeudores, huérfanas y total de deuda — igual que el preview de MULTIRREGISTRO. |
| Enum `remesa_categoria` / `plantillaimport_categoria` | Nuevo valor `MULTIARCHIVO`. |
| Frontend (alta de remesa) | Input `multiple` cuando la categoría es MULTIARCHIVO + chips mostrando qué rol se detectó para cada archivo. |
| Frontend (`PlantillaEditor`) | Editor del layout por archivo (tabs Deudores / Detalle / Bajas / CoDeudores) con selects de columna por **nombre de header**. |

**Alternativa más barata:** aceptar un **ZIP** con los 4 archivos → cero cambios en el endpoint, el DTO
y el input del frontend; solo se descomprime en el service. Cuesta menos pero le agrega un paso manual
al operador (los archivos llegan sueltos). Ver **D5**.

---

## 6. Plan de implementación por fases

| Fase | Contenido | Riesgo |
|---|---|---|
| **1** ✅ | `MultiarchivoConfig` en `mapping-types.ts` + `plantillas/toyota-tcfa.ts` + `utils/multiarchivo-parser.ts` + `utils/fecha-cedente.ts`, con 37 tests (bloque contra el paquete real del 29/05: 854 casos, 920 cuotas, 61 descartadas, `TotalDeuda` == Σ cuotas en 788/788, 85 bajas, 55 codeudores). | Bajo — es código puro, sin DB. |
| **2** ✅ | Base compartida `CasosCedenteProcessor` + `MultiarchivoProcessor` (25 tests) + `MultirregistroProcessor` como subclase fina, con sus 29 tests de no-regresión intactos. | Bajo — todos aditivos. |
| **3** ✅ | Enum `MULTIARCHIVO` + columna `remesa.archivos`, registro del processor, `FileFieldsInterceptor`, `roles-multiarchivo.ts` (12 tests), ramas de preview y worker, `multiarchivo-wiring.spec.ts` (7 tests contra el paquete real). | Medio — toca el endpoint de alta de remesa. |
| **4** ✅ | Frontend: `MultiarchivoDropZone` (subida múltiple con el rol detectado por archivo y diagnóstico previo), `MultiarchivoEditor` (layout + preset TCFA), categoría en el selector, cableado de `PlantillaEditor` e `ImportWizard`. + 6 tests de `createRemesa`. | Medio. |
| **5** ✅ | Ausentes del snapshot → `GES-094` + re-asignación (D1), con 4 salvaguardas: apagada por default, aborta si el archivo no matcheó nada, acotada a la cartera de la plantilla (nuevo `ctx.plantillaId`) y alerta de proporción ≥50%. + 15 tests. | **Alto** — por eso queda apagada. Activarla requiere confirmar con el cedente que el archivo trae siempre la cartera completa, y probarla con dos bajadas reales consecutivas en una empresa de test. |
| **6** | Codeudores: contactos con `subtipo='codeudor'` + `camposAdicionales` + **pintar el subtipo en `FichaContactosTab`** (D4). Se puede diferir sin bloquear la operación. | Bajo. |

Fases 1–4 dejan la carga operativa (altas, actualización diaria, bajas con pago parcial). 5 y 6 son
incrementales.

---

## 7. Decisiones

**Tomadas el 2026-07-30:** D1 = `DESASIGNAR` · D3 = GES-090 genérico · D4 = contactos + adicionales ·
D5 = multi-select. **Abiertas:** D2 y D6 (con default propuesto, no bloquean las fases 1–4).

### D1 — Deudores que dejan de venir en el snapshot ✅ DESASIGNAR

**Decidido:** los ausentes van a `GES-094` guardando `estadoGestionPrevioAId`, sin tocar deuda ni
pagos; si reaparecen mañana se re-asignan solos. Respeta el bloqueo SIT-050.

⚠️ **Queda pendiente confirmar con el cedente** que el archivo de deudores trae **siempre** toda la
cartera vigente. Si algún día puede venir parcial, la fase 5 tiene que llevar además el guard de
variación porcentual (ver R5). Hasta tener esa confirmación, la fase 5 no va a prod.

<details><summary>Opciones evaluadas</summary>

El archivo es un snapshot completo (734 de 854 son reasignaciones de días previos). Si mañana un
cliente **no viene**, significa que Toyota lo sacó de la cartera.

- **(a) DESASIGNAR (GES-094)** — elegida.
- (b) IGNORAR — el caso queda gestionándose aunque el cedente ya no lo mande.
- (c) DESASIGNAR + guard de variación porcentual — se incorpora a (a) si el cedente confirma que el
  archivo puede venir parcial.

</details>

### D2 — Los 66 deudores sin detalle (asignaciones de 2020) — ABIERTA

Traen `TotalDeuda` pero ninguna cuota en `DetalleDeuda`. ¿Qué son? ¿Cartera vieja que sigue viva o
basura que el cedente arrastra?

- **(a) Cargarlos con `montoTotal = TotalDeuda` y sin facturas** — recomendada para no perderlos.
- (b) Cargarlos igual pero marcados con un adicional `sin_detalle: true` para poder filtrarlos.
- (c) Descartarlos y reportarlos como advertencia.

### D3 — Motivos de baja 3 y 4 ✅ GES-090 genérico

**Decidido:** un solo tratamiento para todo lo que no sea pago.

| IDMotivo | Efecto |
|---|---|
| `1 – Pago de Cuota` (65) | `pago` por el importe de la cuota + factura `PAGADA` |
| `3 – Contrato Finalizado/Terminado` (2) | factura `ANULADA` (deja de contar como deuda), sin pago |
| `4 – Envio a Gestion Especial` (18) | factura `ANULADA`, sin pago |

En los tres casos, si el deudor queda **sin ninguna cuota vigente** → `GES-090` + `SIT-071`. El motivo
textual del cedente queda registrado en la auditoría; si más adelante hace falta medir "gestión
especial" aparte, se agrega un `mapeoBajaPorMotivo` en la config sin migrar nada.

### D4 — Codeudores ✅ contactos + camposAdicionales

**Decidido:** las dos cosas.

- Teléfonos y email del codeudor → `contacto` del titular con `subtipo='codeudor'` (usables desde la
  ficha y el softphone).
- Nombre, CUIT, tipo de persona y domicilio → `camposAdicionales.codeudores[]` del titular.
- Un titular puede tener más de un codeudor (en el archivo real hay 2 casos).

⚠️ **Incluye un cambio en el frontend**: hoy el gestor **no distingue** en la ficha un teléfono del
titular de uno del codeudor. Hay que pintar el `subtipo` en `FichaContactosTab` — es chico, pero va
junto con la fase 6, no después: llamar a un codeudor creyendo que es el titular es un problema real
de gestión.

Descartado: cargar el codeudor como un `deudor` aparte — duplicaría la deuda en todos los reportes.

### D5 — Cómo suben los 4 archivos ✅ multi-select

**Decidido:** el operador selecciona los 4 archivos sueltos, como los recibe. El rol de cada uno se
detecta por el patrón de nombre declarado en la plantilla. Implica los cambios de §5
(`FilesInterceptor`, columna `archivos Json?`, resolución de roles, input `multiple` en el frontend).

Validación obligatoria: `deudores` y `detalle` son requeridos; si falta alguno, o si dos archivos
matchean el mismo rol, el alta falla con un mensaje que nombra el rol conflictivo.

### D6 — `montoTotal` del deudor: histórico vs. vigente — ABIERTA

`TotalDeuda` del archivo es la deuda **vigente hoy** (ya excluye las cuotas dadas de baja). El processor
de Toyota 87 calcula `montoTotal = Σ facturas` (incluye las PAGADAS) y deja que la consolidación
calcule `saldo = montoTotal − pagos`. Los dos números no coinciden y eso está **bien**: son cosas
distintas.

Propuesta: mantener el criterio de Toyota 87 (`montoTotal` = deuda histórica asignada) y guardar el
`TotalDeuda` del cedente en `camposAdicionales.total_declarado` — sirve para conciliar contra el
cedente y para detectar desfasajes. **¿Alguna preferencia al revés?**

---

## 8. Riesgos

| # | Riesgo | Mitigación |
|---|---|---|
| R1 | Joinear el detalle por `cliente` en vez de por `IdAsignacion` → deuda inflada (hasta +$4,6 M en un solo caso del archivo real). | Test de fase 1 que asserta 788/788 contra el archivo real. |
| R2 | `IdAsignacion` usado como clave estable del deudor → casos duplicados a diario. | Documentado: la clave estable es `cliente`; `IdAsignacion` solo joinea dentro del paquete. |
| R3 | Fechas `D/M/YYYY` no parseadas → todo con fecha del día. | Helper nuevo + test con `29/5/2026`, `1/12/2025`, `13/5/2020`. |
| R4 | Archivo leído como UTF-8 → nombres con Ñ/acentos rotos. | `encoding: 'latin1'` en la config, igual que Toyota 87. |
| R5 | D1 = DESASIGNAR con un archivo parcial → media cartera fuera de gestión. | Guard de variación porcentual + probar con dos bajadas reales consecutivas antes de prod. |
| R6 | Baja aplicada al deudor equivocado. | TCFA trae `cliente` en la baja → resolución precisa (ajuste 3), sin el problema de ambigüedad de Toyota 87. |
| R7 | Sube 3 de los 4 archivos por error → import a medias. | Validación en `createRemesa`: `deudores` y `detalle` obligatorios, error explícito nombrando el rol faltante. |
