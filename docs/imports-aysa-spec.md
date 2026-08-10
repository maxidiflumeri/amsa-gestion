# Carga de AYSA — spec

> Estado: **implementado y verificado contra el paquete real** (bajada del 2026-06-22, oficina de
> cobro 9000001028). Falta la corrida desde el navegador y definir la oficina 9000000506.

AYSA manda la cartera partida en **muchos TXT del mismo formato, uno por sucursal**: 31 archivos de
cuentas + 31 de partidas por bajada mensual, más ~56 de novedades y ~18 de bajas. La carga se resuelve
con **plantillas normales** —las arma el operador como cualquier otra cartera— apoyada en dos
capacidades nuevas del módulo de imports, que son genéricas y sirven para cualquier cedente:

- **Varios archivos por remesa** (`utils/recorrer-filas.ts`): N archivos del mismo formato se
  recorren como si fueran uno solo.
- **Ancho fijo** (`utils/ancho-fijo.ts`): archivos sin separador, con los campos en posiciones fijas.

No hay categoría ni processor dedicados a AYSA. La única pieza específica es el preset de layouts en
[`plantillas/aysa.ts`](../backend/src/modules/imports/plantillas/aysa.ts), que es una referencia:
lo que manda en producción es lo que quede guardado en la plantilla.

---

## 1. Los archivos

Son exports de SAP en **ancho fijo**, codificados en **Latin-1** (leerlos como UTF-8 rompe las Ñ y los
acentos: `LARRAÑAGA` → `LARRA?AGA`) y con una fila de encabezado. Tres layouts:

| Grupo | Nombre | Ancho | Archivos | Filas | Categoría |
|---|---|---|---|---|---|
| Cuentas | `AGAEJ0_cuentas_EJ_<ofcobro>_<suc>_<fecha>.txt` | 1006 | 31 | 21.335 | DEUDORES |
| Partidas | `AGAEJ0_partidas_EJ_<ofcobro>_<suc>_<fecha>.txt` | 274 | 31 | 1.115.323 | FACTURAS |
| Novedades | `AGNEJ0_EJ_<ofcobro>_IEQ<suc>_<fecha>.txt` | 274 | 27 | 4.552 | PAGOS |
| Desasignaciones | `AGNEJ1_ZDES_EJ_<ofcobro>_<fecha>.txt` | 1006 | 3 | 3 | ACCIONES |
| Extinciones | `AGNEJ1_ZNEX_EJ_<ofcobro>_<fecha>.txt` | 1006 | 4 | 4 | ACCIONES |

**Las novedades comparten layout con las partidas** y **las bajas con las cuentas**: son el mismo
registro con distintos campos cargados. Los 31 encabezados de cada grupo son idénticos entre sí, así
que concatenar los archivos es seguro.

Los layouts completos, con la posición y el largo de cada columna, están en
[`plantillas/aysa.ts`](../backend/src/modules/imports/plantillas/aysa.ts). Los dos **cierran exacto
con el largo del encabezado** (1006 y 274), que es la validación más fuerte que se le puede pedir a
un layout derivado a mano, y hay tests que lo assertan contra los archivos reales.

## 2. Las claves

**`Cta. Cto.` (cuenta contrato) es la clave del caso.** Verificado sobre el paquete completo:

- 21.335 cuentas, **21.335 valores únicos** — no hay una sola repetida.
- Las partidas cruzan con **0 huérfanas en los dos sentidos**: ninguna partida sin cuenta, ninguna
  cuenta sin partidas.
- **`Imp. Asignado` = Σ de los importes de las partidas del caso en 21.334 de 21.335** (§6 explica el
  único desvío). Es el control que valida el layout entero de una.

`(Cta. Cto., Nro. docum.)` es único en las 1.115.323 partidas → `Nro. docum.` sirve directo como
`nroFactura`.

### El documento NO se mapea

**Decisión: la identidad del caso es la cuenta contrato, no la persona.** El campo `documento` se deja
sin mapear, así `documentoDeFila()` genera el placeholder `SIN-DNI-<Cta. Cto.>`, y el DNI y el CUIT
van a datos adicionales.

Dos motivos, los dos medidos sobre el paquete real:

1. **El campo DNI del cedente trae basura.** De los 9.011 registros con DNI, hay 55 valores repetidos
   entre 141 cuentas, y los más frecuentes son `1` (15 cuentas), `NO INFORMADO` (11), `10000000000`
   (8) y `SIN TELEFONO` (4).
2. **Una persona puede tener varias cuentas de agua, y cada una es un caso de cobranza distinto.**

`DeudoresProcessor` identifica al deudor por `(empresaId, documento, remesaId)`. Mapeando el DNI, esas
141 cuentas colapsaban en 55 deudores: **86 casos desaparecían de la cartera, sin ningún error en el
import**. Se detectó en la corrida de prueba (1.207 filas → 1.197 deudores) y se confirmó extrapolando
al paquete completo.

Cobertura de datos de contacto: 78,4% de las cuentas trae al menos un teléfono (hay 7 columnas) y
54,8% trae email. Sin DNI: 57,8%. Sin CUIT: 98,5%. Sin ninguno de los dos: 56,7%.

## 3. Las plantillas

Cuatro plantillas sobre la empresa AYSA, todas con **formato ancho fijo** y **varios archivos**.

### 3.1 Cuentas → DEUDORES

| Campo | Columna |
|---|---|
| `nro_cliente` | `Cta. Cto.` |
| `nombre` | `Denominación IC` |
| `montoTotal` | `Imp. Asignado` (`toNumber:es-AR`) |
| `documento` | **sin mapear** (ver §2) |
| adicionales | `Distrito / División` → `sucursal`, `Exped.`, `Categoría`, `Nro. DNI`, `Nro. CUIT` |
| contactos | 7 bloques `telefono` + 1 `email` + 1 `direccion` (calle / nro / CP / localidad) |

El domicilio va como contacto de tipo `direccion` —no como dato adicional— para que aparezca en la
sección de Direcciones de la ficha y se pueda normalizar contra Georef si la remesa lo pide.

### 3.2 Partidas → FACTURAS

Remesa origen: la de cuentas.

| Campo | Columna |
|---|---|
| `nro_cliente` | `Cta. Cto.` |
| `nroFactura` | `Nro. docum.` |
| `importe` | `Importe` (`toNumber:es-AR`) |
| `vencimiento` | `F.vto.` (`toDate:auto`) |
| `fechaEmision` | `F. Proc.` (`toDate:auto`) |

`montoDeudorDesdeFacturas: 'NO'` — el total ya viene en las cuentas y coincide con la suma.

### 3.3 Novedades → PAGOS

Filtro de filas: **`Imp. cobrado` > 0**. Sin eso se cargan 2.555 pagos de $0.

| Campo | Columna |
|---|---|
| `nro_cliente` | `Cta. Cto.` |
| `importe` | `Imp. cobrado` |
| `fecha` | `F. cobro` |
| `observacion` | `Nro. docum.` — **no es opcional**, ver abajo |

#### El nº de partida no es un adorno: sin él se pierde el 13,3% de la cobranza

`PagosProcessor` tiene un anti-duplicados que saltea un pago si ya existe otro **del mismo deudor,
mismo día y mismo importe**. Existe para que reimportar un archivo acumulativo no duplique pagos, y
con las otras carteras funciona bien.

Con AYSA es destructivo, porque los clientes cancelan varias cuotas **iguales** de un plan el mismo
día. Medido sobre el archivo del 25/07:

| | |
|---|---|
| Filas con cobro | 1.997 · **$18.353.107,86** |
| Combinaciones distintas de (cuenta, fecha, importe) | 1.192 |
| Filas que el anti-duplicados saltearía | **805 → $2.443.138,61 (13,3%)** |

El caso extremo: la cuenta `000003462007` canceló **36 partidas de $195,04 el 17/07** y quedaba
registrada una sola.

La solución es mapear `Nro. docum.` a `observacion`: el anti-duplicados lo incorpora al criterio, así
que dos cobros del mismo día e importe pero de partidas distintas dejan de ser "el mismo pago". De
paso, el gestor ve en la ficha qué factura pagó cada cobro.

El comportamiento **no cambia para las plantillas que no mapean `observacion`**: ahí el criterio
sigue siendo deudor + día + importe.

### 3.4 Desasignaciones + extinciones → ACCIONES

Los dos grupos **se suben juntos en una sola remesa**: comparten layout con las cuentas y los dos
significan lo mismo para la gestión —el cedente retira el caso—, así que van al mismo estado.

- Match: `nro_cliente` = `Cta. Cto.`
- `SET_GESTION` → `GES-094` (Desasignado)
- `ADD_COMENTARIO` con la novedad y los motivos, para que quede el rastro en la ficha
- `saltearCanceladas: true` — un caso ya cancelado no vuelve a gestión por una baja administrativa

La diferencia entre los dos archivos queda en el comentario, no en el estado: `Nov. = N` +
`F. Desas.`/`Mot.Des.` es una desasignación; `Nov. = M` + `F. Extin.`/`Mot. Ex.` es una extinción.

**Muchas de las cuentas dadas de baja no están en la cartera cargada**: las bajas del 20-21/07 traen
7 cuentas y solo 3 estaban en el paquete del 22/06. Es esperable —el cedente da de baja casos de
asignaciones anteriores— y por eso conviene mirar el **preview de impacto** antes de ejecutar, que
dice cuántas de las cuentas del archivo matchean de verdad.

> `SET_GESTION` de ACCIONES no guarda `estadoGestionPrevioAId` (eso es del flujo `DESASIGNAR` de
> ACTUALIZACIONES). El undo de una remesa de acciones va por `revertirAcciones`, que trabaja con un
> snapshot propio.

## 4. Por qué las novedades llevan filtro

**El archivo de novedades no es una lista de pagos: es una lista de novedades, y solo algunas son un
cobro.** Sobre la bajada del 25/07 de la oficina 1028, mirando la columna `Imp. cobrado`:

| `Cod. situ.` | Filas | `Imp. cobrado` | `F. cobro` | `Nro. PP` | ¿Entró plata? |
|---|---|---|---|---|---|
| `A` | 1.697 | **315,22** | 17.07.2026 | — | **sí** |
| `F` | 300 | **500,50** | 22.07.2026 | 000602187127 | **sí** |
| `E` | 2.483 | 0,00 | — | 000602198113 | no |
| `J` | 72 | 0,00 | — | — | no |

*(los importes son los de una fila de ejemplo de cada código)*

Sin el filtro `Imp. cobrado > 0`, el import genera **2.555 pagos de $0**. Con él entran 1.997 filas
por **$18.353.107,86** sobre 85 cuentas, sin un solo duplicado en
`(cuenta, documento, fecha, importe)`.

El criterio no depende de interpretar las letras: se filtra por el importe, que es el dato duro.

### Qué parecen ser los códigos (deducido, a confirmar con el cedente)

No hace falta para cargar, pero explica qué son las filas que se descartan:

- **`A`** — cobro al contado de la partida: el importe cobrado es igual al de la partida y no hay plan.
- **`F`** — cobro de una cuota de un plan: trae `Nro. PP` **y** `Cuota Cob.` (`01`) además del importe.
- **`E`** — la partida entra en un plan de pago: trae `Nro. PP`, `Fec. PP` y `Cant. cuotas` (6, 12,
  24…) pero cobrado en 0. Sería una refinanciación, no un cobro.
- **`J`** — otra novedad, sin identificar. Solo trae `Mot. situ.` = 08.

**Las refinanciaciones (`E`) no generan nada en el sistema.** El módulo de convenios existe, pero
mapear el plan —cuotas, vencimientos, seguimiento— es una unidad de trabajo aparte que nadie pidió.
Hoy esas filas se descartan y la deuda del caso queda como está.

## 5. Resultados de la corrida real

Contra la base de desarrollo, paquete completo de la oficina 1028:

| Etapa | Archivos | Filas | Resultado | Tiempo |
|---|---|---|---|---|
| Cuentas | 31 | 21.335 | 21.335 deudores · 46.799 contactos · **0 errores** | 5,8 min |
| Partidas | 31 | 1.115.323 | 1.115.322 facturas · **1 error** (§6) | **91 s** |
| Novedades | 27 | 4.552 | 1.997 procesadas (2.555 descartadas) · 944 pagos por $13.669.887 | 8 s |
| Bajas | 7 | 7 | 3 casos a GES-094 con comentario · **0 errores** | 1 s |

Contactos cargados: 21.335 direcciones, 13.762 teléfonos, 11.702 emails.

**Σfacturas = `Imp. Asignado` en 21.334 de 21.335 deudores.**

Los 483 errores de las novedades son cuentas que no están en el paquete de junio: las novedades son de
julio y la cartera cambió entre las dos bajadas. No es un problema de la carga.

> Esa corrida se hizo **antes** de mapear `observacion`, así que los 944 pagos sobre 1.514 filas son
> el anti-duplicados fusionando cuotas iguales del mismo día (§3.3). Con el mapeo corregido tiene que
> registrar una fila por partida cobrada.

### Performance

Las partidas pasaron de **165 s a 3,7 s** (mismo subconjunto de 42.096 filas, 45×) por dos cambios que
resultaron ser el mismo problema:

- `FacturasProcessor.processBatch` resuelve los deudores del lote con un `IN (...)` cacheado entre
  lotes y escribe las facturas con `INSERT … ON DUPLICATE KEY UPDATE` de a 500.
- **Ese camino solo se usa si la fila trae los tres campos** (importe, emisión, vencimiento). Con las
  fechas rotas (§7) todas las filas caían al `upsert` de a una: 1,1M de round-trips.

Las cuentas siguen en ~61 filas/s porque `DeudoresProcessor` va fila por fila (contactos,
autoenriquecimiento). 5,8 minutos para una carga mensual es aceptable; optimizarlo es trabajo aparte.

## 6. El único registro raro del paquete

Una fila en 1.115.323 (`partidas_072`, fila 111.422, cuenta `000003751403`):

```
T.Comp. 00600010 · Nro. docum. (vacío) · Importe "558.9-" · F.vto. 09.06.2022
```

Es un ajuste o nota de crédito: **sin número de comprobante** y con **importe negativo en formato SAP
(signo al final)**. Se rechaza con `Campo requerido faltante: nroFactura`, y es la razón del único
deudor donde Σfacturas no da el `Imp. Asignado` (faltan $1.117,80 = 2 × 558,90).

No se resolvió a propósito: es un caso en 1,1M. Si aparecieran más, hacen falta dos cosas —un número
de factura sintético y un transform que entienda el signo al final (`toNumber:es-AR` hoy lee `558.9-`
como **+558,90**, no como −558,90).

## 7. El bug de fechas que destapó esta carga

`toDate:auto` no soportaba el formato `DD.MM.YYYY` separado por **puntos**, que es como exporta SAP.
Caía al fallback flexible de dayjs, con dos efectos silenciosos:

| Valor | Antes | Ahora |
|---|---|---|
| `10.05.2024` | 5 de **octubre** de 2024 | 10 de **mayo** de 2024 |
| `21.06.2026` | `null` | 21 de junio de 2026 |
| `00.00.0000` | `null` | `null` (correcto: el cedente lo usa como "sin fecha") |

O sea: los vencimientos con día ≤ 12 quedaban con el mes y el día invertidos, y los demás en nulo —que
en `FacturasProcessor` se traducía en la fecha del día. Cualquier reporte de mora salía mal.

El arreglo agrega `DD.MM.YYYY` y `D.M.YYYY` a los formatos estrictos, **antes** del fallback. No hay
ambigüedad que resolver: `MM.DD.YYYY` no existe como convención. 7 tests nuevos en `transforms.spec.ts`.

## 8. Pendientes

- **Correr el flujo desde el navegador.** Todo está verificado por código y por la corrida contra la
  base, pero el wizard con 31 archivos arrastrados no se probó a mano.
- **Definir la oficina de cobro 9000000506.** Mismo formato; de ella solo llegaron novedades y bajas,
  no el paquete de cuentas y partidas. Falta decidir si va como otra remesa de la misma empresa o como
  empresa aparte.
- **Confirmar con AYSA los códigos de situación** de §4. No bloquea la carga —el filtro va por el
  importe cobrado— pero sirve para saber qué se está dejando afuera. Sobre todo `J` y el `D` que
  aparece 4 veces en la 506.
- **Las refinanciaciones (`E`) no se cargan como convenios** (§4). Es una decisión, no un olvido.

---

## Apéndice — Layouts para pegar en el editor de plantillas

Al crear la plantilla: **Formato / Separador → "TXT - Ancho fijo (sin separador)"**, encabezado
activado, codificación Latin-1. Después se pega el bloque que corresponda en el campo *Layout de
columnas* y se sube un archivo de ejemplo para ver el corte.

También se puede usar el botón **"Inferir del archivo"**, pero no acierta al 100%: los campos que
vienen pegados tanto en el encabezado como en los datos (`F. Desde` / `F. Hasta`, `Of. Cobro` /
`Distrito`) quedan fusionados y hay que separarlos a mano. Pegar esto es más rápido.

### Cuentas — también desasignaciones (`ZDES`) y extinciones (`ZNEX`)

<details>
<summary>58 columnas · ancho 1006</summary>

```
Of. Cobro;0;10
Distrito / División;10;8
Interloc.;18;10
Denominación IC;28;40
Cta. Cto.;68;12
Cta. Cto. sis. ant.;80;20
Exped.;100;10
Circuns.;110;8
Sección;118;8
Manzana;126;8
Coef. zonal;134;12
Un. Func.;146;10
Pto. Sum.;156;10
Dist.Cat;166;8
Categoría;174;10
Tipo usu.;184;10
Cl. Ind.;194;8
Regime;202;6
F. Proc.;208;10
NR;218;3
F. Desde;221;10
F. Hasta;231;10
F.Tol.Liq.;241;10
Imp. Asignado;251;15
Imp. No Venc.;266;15
Imp.PP No Caid;281;15
Imp. PP Caído;296;15
F. Extin.;311;10
Mot. Ex.;321;8
F. Desas.;329;10
Mot.Des.;339;8
F. Prolon.;347;10
Nov.;357;4
Nombre de calle;361;60
Nro.puer.;421;10
Nro. Anterior;431;20
Nro.piso;451;10
Nro.dpto.;461;10
Cod. Pos.;471;10
Localidad;481;40
Nombre de calle (postal);521;60
Nro.puer. (postal);581;10
Nro. Anterior (postal);591;20
Nro.piso (postal);611;10
Nro.dpto. (postal);621;10
Cod. Pos. (postal);631;10
Localidad (postal);641;40
Nro. de Teléfono 1;681;30
Nro. de Teléfono 2;711;30
Nro. de Teléfono 3;741;30
Nro. de Teléfono 4;771;30
Nro. de Teléfono 5;801;30
Nro. de Teléfono 6;831;30
Nro. de Teléfono 7;861;30
Nro. DNI;891;30
Nro. CUIT;921;30
Correo Electrónico;951;40
Observaciones 1;991;15
```

</details>

### Partidas — también novedades (`AGNEJ0`)

```
F. Proc.;0;10
Of. Cobro;10;10
Distrito / División;20;10
Interloc.;30;10
Cta. Cto.;40;12
Cta. Cto. sis. ant.;52;20
Dist. Cat.;72;12
F.Desde;84;10
F.Hasta;94;10
T.Comp.;104;8
Nro. docum.;112;16
F.vto.;128;10
Importe;138;13
Nro. PP;151;13
Fec. PP;164;10
Cant. cuotas;174;13
Primer cuota impaga;187;21
Fec. situ.;208;11
Cod. situ.;219;11
Mot. situ.;230;11
Cuota Cob.;241;11
F. cobro;252;10
Imp. cobrado;262;12
```
