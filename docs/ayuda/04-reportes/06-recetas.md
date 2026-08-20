<!--
seccion: Reportes
resumen: Seis reportes armados de punta a punta, para copiar y adaptar.
revisado: 2026-08-20
rutas: /reportes
-->
# Recetas

Seis reportes que se piden seguido, armados de punta a punta. Copialos y adaptalos: casi todo lo que
te pidan es una variante de alguno.

En todos, el filtro de **empresa** conviene que sea **variable**, para no tener una plantilla por
cartera. Se arma sobre `Empresa → Nombre de la empresa`, que te ofrece un desplegable con las empresas
reales.

---

## Antes de copiar nada: los contactos vienen todos juntos

Es la limitación que hay que conocer antes de armar cualquier reporte con datos de contacto.

**Teléfonos, mails y domicilios son todos "contactos".** No hay un campo "Teléfono" y otro "Email":
hay **un** campo, `Contactos → Teléfono / email / dirección`.

Consecuencia práctica: una columna de contactos en **concatenar** trae **todo mezclado** en la misma
celda — los teléfonos, el mail y el domicilio, separados por coma. No se puede pedir "solo los
teléfonos" desde la pantalla.

Se puede vivir con eso: la celda sirve igual para llamar, solo que trae de más. Pero conviene saberlo
antes de prometerle a alguien una columna de teléfonos limpia.

---

## 1. Cartera para el cedente

*Lo que se le manda al cliente: qué tiene asignado y cómo viene.*

| | |
|---|---|
| **Columnas** | Nro de cliente del cedente · Documento · Nombre · Apellido · Deuda original · Saldo actual · Situación · Estado de gestión · Fecha de vencimiento |
| **Filtros** | Empresa (variable) · Remesa (variable) |
| **Orden** | Saldo, de mayor a menor |
| **Formato** | Excel |

Si el cedente tiene régimen de recargos, sumá **Deuda actualizada** y **Recargo por mora**.

---

## 2. Listado de gestión del día

*Para repartir entre los gestores.*

| | |
|---|---|
| **Columnas** | Nro de cliente · Nombre · Saldo actual · Contactos (**concatenar**) · Situación |
| **Filtros** | Empresa (variable) · Situación **no está en la lista**: los cuatro códigos de cancelado |
| **Orden** | Saldo, de mayor a menor |
| **Formato** | Excel |

**La columna de contactos en concatenar** trae todo lo que se sabe del caso en una celda — teléfonos,
mail y domicilio. No es prolijo, pero es lo que el gestor necesita a mano.

> **"Cancelado" no es un solo valor.** Hay cuatro códigos distintos de cancelación: al armar el filtro
> "no está en la lista" hay que elegirlos a los cuatro, no solo el primero.

> **Ojo con los casos sin situación asignada.** Un filtro de "no está en la lista" sobre la situación
> **también los deja afuera**, en silencio. Si querés incluirlos, hace falta pensar el filtro al revés.

---

## 3. Cobranza del mes

*Cuánto entró y de quién.*

| | |
|---|---|
| **Columnas** | Nro de cliente · Nombre · Fecha del pago · Importe del pago |
| **Cardinalidad** | Las columnas de pago, en **expandir** |
| **Filtros** | Empresa (variable) · Fecha de pago **entre** (variable) |
| **Totales** | **Suma** sobre el importe del pago |
| **Orden** | Fecha del pago |
| **Formato** | Excel |

**Este es el caso donde expandir es lo correcto**: el listado es de pagos, no de casos. Un caso con 12
pagos aparece 12 veces, y eso es justo lo que se quiere.

El total va en la **solapa de Totales**, que es donde viven las cuentas — sumar, promediar, contar,
mínimo y máximo. **No existen como columna**: no se puede armar una columna "suma de los pagos" al lado
del nombre del caso.

> **El filtro de fecha hace dos cosas a la vez**, y las dos son las que querés: elige qué **casos**
> entran (los que pagaron en el período) y además **recorta los pagos** que se muestran de cada uno. Sin
> eso verías todos los pagos históricos de esos casos.

---

## 4. Un pago por fila, con el detalle

*Igual que el anterior, pero para conciliar contra el extracto del cedente.*

| | |
|---|---|
| **Columnas** | Nro de cliente · Documento · Nombre · Fecha del pago · Importe · Observación del pago |
| **Cardinalidad** | Las de pago, en **expandir** |
| **Filtros** | Empresa (variable) · Fecha de pago **entre** (variable) |
| **Orden** | Fecha del pago |
| **Formato** | CSV, con el separador que pida el destino |

La **observación** es la que trae el número de comprobante, si la plantilla de importación lo mapeó. Es
lo que permite cruzar contra el extracto.

---

## 5. Promesas de la semana

*A quién hay que seguir.*

| | |
|---|---|
| **Columnas** | Nro de cliente · Nombre · Contactos (**concatenar**) · Fecha prometida · Monto · Situación |
| **Cardinalidad** | Las de promesa, en **expandir** |
| **Filtros** | Empresa (variable) · Fecha prometida **entre** (variable) |
| **Orden** | Fecha prometida |
| **Formato** | Excel |

Mezclar promesas en expandir con contactos en concatenar **no multiplica las filas**: las columnas de
una misma rama se emparejan entre sí, y las de otra rama concatenada quedan igual en cada fila.

---

## 6. Casos sin ningún dato de contacto

*Los que no se pueden trabajar, para pedirle enriquecimiento al cedente.*

| | |
|---|---|
| **Columnas** | Nro de cliente · Documento · Nombre · Apellido · Saldo actual · Situación |
| **Filtros** | Empresa (variable) · **Contactos → Cantidad** = 0 |
| **Orden** | Saldo, de mayor a menor |
| **Formato** | Excel |

**Filtrar por cantidad sí se puede**, aunque no exista como columna: en el selector de filtros, cada
rama tiene una opción **Cantidad** que compara contra un número. `= 0` son los casos sin ningún
contacto; `> 0`, los que tienen alguno.

Ordenado por saldo porque es la lista de **cuánta plata no se puede gestionar** — ese es el argumento
para pedirle datos al cedente.

> No pongas columnas de contacto en este reporte: por definición van a salir todas vacías.

---

## Lo que se puede y lo que no

Una tabla para no perder tiempo intentando lo imposible:

| Quiero… | ¿Se puede? |
|---|---|
| Una columna con todos los teléfonos | Sí, pero mezclados con mails y domicilios |
| Una columna solo con teléfonos | **No** desde la pantalla |
| Una fila por pago / factura / promesa | Sí: esa rama en **expandir** |
| Una columna "cuántos pagos tiene" | **No.** Contar existe en filtros y en totales, no como columna |
| Una columna "suma de lo pagado" al lado del nombre | **No.** La suma va en la solapa de Totales, al pie |
| Filtrar los casos sin contactos | Sí: Contactos → Cantidad = 0 |
| Filtrar por un dato adicional del cedente | Sí, si ese cedente lo manda y la plantilla lo mapea |

---

## Cómo adaptar cualquiera de estos

Tres preguntas, en este orden:

1. **¿Cada fila es un caso o un movimiento?** Si es un movimiento (un pago, una promesa, una factura),
   esa rama va en **expandir**. Si es un caso, todo lo demás va en concatenar o primero.
2. **¿Qué acota el volumen?** Empresa y período. Sin eso, casi ningún reporte corre cómodo.
3. **¿Quién lo recibe?** Una persona → Excel. Un sistema → CSV con el separador que pida.

---

## El error que arruina más reportes

Poner una columna en **expandir** sin querer.

El síntoma: **más filas de las esperadas y totales inflados**. Un caso con 12 pagos se cuenta 12 veces,
así que la suma del saldo da doce veces de más.

Por defecto una columna de rama sale en **primero**, así que expandir hay que elegirlo. La excepción es
que la plantilla tenga una **cardinalidad por defecto** puesta en expandir: ahí sale así todo el
reporte, y ese es el escenario real de "sin querer".

**Cómo detectarlo en dos segundos:** mirá la vista previa y fijate si un mismo nombre aparece repetido.
