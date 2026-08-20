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
cartera.

---

## 1. Cartera para el cedente

*Lo que se le manda al cliente: qué tiene asignado y cómo viene.*

| | |
|---|---|
| **Columnas** | Nº de cliente · Documento · Nombre · Apellido · Deuda original · Saldo · Situación · Gestión · Fecha de vencimiento |
| **Filtros** | Empresa (variable) · Remesa (variable) |
| **Orden** | Saldo, de mayor a menor |
| **Formato** | Excel |

Si el cedente tiene régimen de recargos, sumá **Deuda actualizada** y **Recargo por mora**.

---

## 2. Listado de gestión del día

*Para repartir entre los gestores.*

| | |
|---|---|
| **Columnas** | Nº de cliente · Nombre · Saldo · Teléfono (**concatenar**) · Email (**primero**) · Situación · Último comentario (**último**) |
| **Filtros** | Empresa (variable) · Situación **no está en la lista**: cancelado, desasignado |
| **Orden** | Saldo, de mayor a menor |
| **Formato** | Excel |

**El truco está en los teléfonos**: en concatenar salen todos en una celda, que es lo que sirve para
llamar. En expandir tendrías el mismo caso repetido una vez por teléfono.

---

## 3. Cobranza del mes

*Cuánto entró y de quién.*

| | |
|---|---|
| **Columnas** | Nº de cliente · Nombre · Deuda original · Pagos (**contar**) · Pagos (**sumar** el importe) · Último pago (**máximo** de la fecha) |
| **Filtros** | Empresa (variable) · Fecha de pago **entre** (variable) |
| **Totales** | Suma de los pagos |
| **Formato** | Excel |

Una fila por caso, con su total cobrado. Si querés **una fila por pago**, es el reporte siguiente.

---

## 4. Detalle de pagos

*Un listado de movimientos, no de casos.*

| | |
|---|---|
| **Columnas** | Nº de cliente · Nombre · Fecha del pago · Importe · Observación |
| **Cardinalidad** | Las columnas de pago, en **expandir** |
| **Filtros** | Empresa (variable) · Fecha de pago **entre** (variable) |
| **Orden** | Fecha del pago |
| **Formato** | Excel o CSV |

**Este es el caso donde expandir es lo correcto**: el listado es de pagos, no de casos. Un caso con 12
pagos tiene que aparecer 12 veces.

---

## 5. Promesas de la semana

*A quién hay que seguir.*

| | |
|---|---|
| **Columnas** | Nº de cliente · Nombre · Teléfono (**concatenar**) · Fecha de la promesa · Monto prometido · Situación |
| **Cardinalidad** | Las de promesa, en **expandir** |
| **Filtros** | Empresa (variable) · Fecha de promesa **entre** (variable) |
| **Orden** | Fecha de la promesa |
| **Formato** | Excel |

---

## 6. Casos sin contacto

*Los que no se pueden trabajar, para pedirle datos al cedente.*

| | |
|---|---|
| **Columnas** | Nº de cliente · Documento · Nombre · Saldo · Domicilio · Teléfonos (**contar**) |
| **Filtros** | Empresa (variable) · Teléfonos **contar = 0** |
| **Orden** | Saldo, de mayor a menor |
| **Formato** | Excel |

Ordenado por saldo, porque es la lista de **cuánta plata no se puede gestionar**. Es el argumento para
pedirle enriquecimiento al cedente.

---

## Cómo adaptar cualquiera de estos

Tres preguntas, en este orden:

1. **¿Cada fila es un caso o un movimiento?** Si es un movimiento (un pago, una promesa, una factura),
   esa rama va en **expandir**. Si es un caso, todo lo demás va en concatenar, primero o una cuenta.
2. **¿Qué acota el volumen?** Empresa y período. Sin eso, casi ningún reporte corre cómodo.
3. **¿Quién lo recibe?** Una persona → Excel. Un sistema → CSV con el separador que pida.

---

## El error que arruina más reportes

Poner una columna en **expandir** sin querer, y no darse cuenta.

El síntoma: **más filas de las esperadas y totales inflados**. Un caso con 12 pagos se cuenta 12 veces,
así que la suma del saldo da doce veces de más.

**Cómo detectarlo en dos segundos:** mirá la vista previa y fijate si un mismo nombre aparece repetido.
Si sí, hay una columna en expandir.
