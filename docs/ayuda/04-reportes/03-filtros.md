<!--
seccion: Reportes
resumen: Cómo acotar qué casos entran, y cómo dejar filtros que se piden al ejecutar.
revisado: 2026-10-19
rutas: /reportes
-->
# Filtros

## Para qué sirve

Los filtros deciden **qué casos entran** en el reporte. Sin filtros, un reporte trae la cartera entera:
se va a encolar en segundo plano, y si pasa las 200.000 filas, falla.

## Lo primero: un filtro sobre una rama hace dos cosas

Es lo que más sorprende, así que va antes que nada.

Un filtro sobre una rama —por ejemplo "pagos con importe mayor a $10.000"— hace **las dos cosas**:

1. **Elige qué casos entran**: los que tienen algún pago de más de $10.000.
2. **Recorta lo que esa rama muestra**: las columnas de pago traen **solo esos pagos**, no todos los del
   caso.

Casi siempre es lo que querés — es lo que hace que un reporte de cobranza del mes salga bien sin
esfuerzo. Pero conviene saberlo, sobre todo si la rama está en **expandir**: vas a tener una fila por
pago **filtrado**, no por pago.

**La excepción son los filtros por Cantidad**, que eligen el caso pero no recortan nada.

---

## Los operadores

Cambian según el tipo de campo. Estos son los que ofrece la pantalla:

### Texto

**Igual a** · **Distinto de** · **Contiene** · **Comienza con** · **Termina con** · **En lista** ·
**No en lista** · **Entre** · **Fuera de** · **Vacío** · **No vacío**

### Números

**Igual a** · **Distinto de** · **Mayor que** · **Mayor o igual** · **Menor que** · **Menor o igual** ·
**Entre** · **Fuera de** · **Vacío** · **No vacío**

### Fechas

**Igual a** · **Desde** · **Hasta** · **Entre** · **Fuera de** · **Vacío** · **No vacío**

Para acotar un período se usan **Desde** y **Hasta**, o **Entre**.

**El "Hasta" incluye el día entero.** **Entre 01/01 y 31/01** trae todo enero, el 31 completo, y
**Igual a** una fecha trae todo ese día. No hace falta sumar un día: si lo hacés, el reporte trae un día
de más.

**Dos clases de fecha, y cada una cuenta el día a su manera.** Las **fechas de negocio** —vencimiento de
la deuda, de una factura, de una cuota o de una clave, emisión de la factura, fecha de un pago, fecha
prometida de una promesa, fecha de inicio de un convenio— son un día de calendario: "vence el 15/03" es
el 15 de marzo. Algún pago que entró con la hora real de la carga, si se cargó de noche (después de las
21:00), puede aparecer en el día siguiente. Las **fechas de registro** —cuándo se escribió un comentario,
cuándo se creó o se modificó algo, cuándo se envió un mail, cuándo sonó una llamada— tienen hora, y el
día es el de Argentina (de las 00:00 a las 23:59). Vos solo elegís el día; el sistema usa la cuenta que
corresponde a ese campo.

**Desde el 19/10 cambia el resultado de los filtros de fecha de negocio.** Hasta entonces se contaba
todo como fecha de registro, y las fechas guardadas sin hora (la gran mayoría de los vencimientos de los
casos) caían en el **día anterior**: un filtro "vence el 15/03" traía los del 14. Si una plantilla de
vencimientos le sumaba o restaba un día para compensarlo, hay que sacarlo.

**La fecha tiene que estar bien escrita.** Se acepta un día del calendario (`2026-07-31`, el que manda
el selector de la pantalla) o una fecha relativa a hoy (ver más abajo). Si la fecha no es válida —un texto, un
día que no existe como el 31 de febrero— el reporte **no se ejecuta** y avisa en qué filtro; antes tomaba
cualquier cosa como fecha y salía con un período cualquiera, sin avisar. Más abajo están los mensajes.

**Con una sola punta, el rango queda abierto.** **Entre** con solo el "desde" son las fechas de ahí en
adelante, y con solo el "hasta", hasta esa fecha. **Fuera de** con una sola punta deja afuera de ahí en
adelante (o hasta ahí).

### Fechas relativas a hoy

Un filtro de fecha puede guardar un día fijo o un día **que se mueve con el calendario**. Arriba de cada campo
de fecha hay dos botones: **Fecha fija** y **Relativa a hoy**. Con el segundo elegís cuántos **días** y si es
**antes de hoy** o **después de hoy**:

| Lo que elegís | Se guarda como | El chip dice |
|---|---|---|
| 0 días | `hoy` | hoy |
| 90 días antes de hoy | `hoy-90` | hace 90 días |
| 7 días después de hoy | `hoy+7` | dentro de 7 días |

Debajo del campo se ve a qué día corresponde hoy (*"hace 90 días: 21/07/2026"*). Cada vez que se ejecuta el
reporte, el sistema lo recalcula **con la fecha del día, en hora de Argentina**. Es lo que hace que "los casos con
más de 90 días de mora" (Vencimiento **Hasta** *hace 90 días*) siga siendo cierto dentro de un mes, sin
tocar la plantilla. Con una fecha fija, el filtro quedaba clavado en el día en que se armó.

- Vale con **Igual a**, **Desde**, **Hasta**, **Entre** y **Fuera de**; en estas dos últimas, cada punta es fija
  o relativa por su cuenta.
- Los días van de 0 a 3650.
- En un filtro **variable** (el que se pide al ejecutar), el valor por defecto también puede ser relativo, y al
  ejecutar se ve ya resuelto.

### Sí / No

**Es** · **Vacío**

---

## Los filtros se combinan con Y

Todos los filtros de un reporte se cumplen **a la vez**.

Si necesitás un "o", a veces se resuelve con **En lista**. Pero ojo, porque tiene un límite grande:

> **"En lista" solo funciona de verdad en cuatro campos:** empresa, situación, estado de gestión y
> motivo de no pago. En esos, el sistema te ofrece un desplegable con los valores reales.
>
> En cualquier otro campo de texto, la lista aparece **vacía y sin poder tipear**. No es que no
> encuentre el valor: no hay forma de cargarlo.

**Dos filtros sobre la misma rama no hablan del mismo elemento.** "Pagos mayores a $10.000" más "pagos
de enero" trae los casos que tienen *un* pago grande y *otro* pago de enero, aunque no sean el mismo. Y
las columnas de esa rama pueden salir vacías, porque ahí sí se exigen las dos condiciones juntas.

---

## Filtros variables: los que se piden al ejecutar

Un filtro puede tener el valor **fijo** —siempre el mismo— o ser **variable**, y entonces se pide cada
vez que se ejecuta.

Es lo que convierte una plantilla en reutilizable: en vez de doce plantillas, una por mes, tenés una
con el período variable.

Al marcarlo como variable se configuran **tres** cosas:

| | |
|---|---|
| **La etiqueta** | Lo que ve quien ejecuta. **Es obligatoria**: sin ella no se guarda el filtro |
| **Valor por defecto** | Opcional. Viene precargado al ejecutar |
| **Obligatorio al ejecutar** | Un switch. Decide si se puede correr sin ese valor |

> ### ⚠ Sin "Obligatorio", un filtro vacío se ignora en silencio
>
> Si el filtro **no** está marcado como obligatorio y quien ejecuta lo deja vacío, **el reporte corre
> sin ese filtro** — no avisa nada.
>
> El caso típico: un reporte con la empresa variable, alguien la deja vacía, y en vez de un error sale
> un reporte con **todas las carteras**.
>
> **Marcá "Obligatorio al ejecutar" en todo filtro que acote de verdad**, empezando por la empresa.

Al ejecutar, las etiquetas salen con un `*` si son obligatorias y con "(opcional)" si no.

---

## Los filtros que casi siempre convienen

**La empresa**, obligatoria. Sin él el reporte cruza todas las carteras.

**Un período**, para acotar el volumen.

**El estado**, si el reporte es de gestión.

---

## Qué NO se puede filtrar

**Ver todos los valores de un dato adicional en una lista.** Los datos adicionales del cedente se pueden
usar como filtro y como columna, pero **En lista** no te ofrece los valores para elegir. Para comparar
contra un valor, usá **Igual a** o **Contiene**.

---

## Sobre la velocidad

Un filtro sobre un campo del caso —empresa, situación, monto— hace que el reporte corra bastante más
rápido: acota antes de traer los datos.

**Los filtros por Cantidad no.** Salvo `= 0` y `> 0`, se aplican **después** de traer todo, así que
acotan el resultado pero no aceleran nada.

---

## Qué puede salir mal

### El reporte trae todas las carteras

El filtro de empresa quedó vacío al ejecutar y no estaba marcado como obligatorio, así que se ignoró.

### El reporte trae muchísimas más filas de las esperadas

Dos causas: falta el filtro de empresa, o hay una columna en **expandir** multiplicando las filas.

La estimación que decide si corre al momento o encolado **no contempla expandir**: un reporte estimado
en 3.000 puede terminar en 40.000 filas.

### El reporte no trae nada

Los filtros se combinan con Y y alguno se contradice con otro. Sacalos de a uno.

### Me trae un día de más en el período

Lo más probable es que la plantilla se armó cuando el "Hasta" se comía el último día, y se le sumó un día
a mano para compensarlo. Desde el 21/08 el "Hasta" ya incluye el día entero: poné la fecha real (para
enero, `01/01` a `31/01`).

### El reporte no se ejecuta y dice que el filtro usa un operador que el motor no soporta

> **El filtro «Rango de claves» usa un operador que el motor no soporta: rangoClaves**

La plantilla tiene un filtro con una comparación que el sistema no sabe resolver. Antes ese filtro se
descartaba en silencio y el reporte salía con **todos los casos**; ahora se frena. Abrí la plantilla,
cambiá ese filtro por uno de los que ofrece la pantalla y guardá.

### El reporte no se ejecuta y dice «Fecha inválida en el filtro»

> **Fecha inválida en el filtro «Vence desde». Usá el formato AAAA-MM-DD**

El valor de ese filtro no es una fecha. Usá el selector de fecha de la pantalla, o **Relativa a hoy** si querés
una fecha que se mueva sola. Un texto como `31/07/2026` o `ayer` no vale.

### Dice «El campo … no existe»

> **El campo «empresa.nombrecito» no existe**

La plantilla (en una columna, filtro, orden, agrupación o total) apunta a un campo que no está en el
sistema, por ejemplo porque se renombró. Antes esa columna salía **vacía en todas las filas** sin
avisar. Entrá a la plantilla, reemplazá el campo por el correcto y guardá. Los datos adicionales no se
revisan de esta forma: cada cedente manda los suyos.

### Dice «Hay dos columnas con el nombre …»

Dos columnas se llaman igual y las filas se arman por nombre: salían **todas las columnas, pero la
primera perdía su dato y repetía el de la segunda**. Cambiale el nombre a una de las dos.

### Dice «El filtro … no tiene valor»

Es un filtro **fijo** (no variable) al que se le borró el valor. Antes se ignoraba en silencio y el
reporte salía con **todos los casos**; ahora se frena. Cargale el valor o sacalo. Vale igual para un
**Entre** o **Fuera de** con las dos puntas vacías.

### Dice «El filtro … necesita dos valores (desde y hasta)»

Pasa casi solo por API: una lista de **Entre** o **Fuera de** que no tiene exactamente dos lugares. En la
pantalla, un solo extremo vacío **no** es un error: es un rango abierto.

### Casos "sin teléfono" que traía los "sin ningún contacto"

Si una plantilla pide **los casos sin teléfono** (Cantidad = 0 de los contactos de tipo teléfono), el
reporte traía los casos sin **ningún** contacto, así que se perdían los que tenían un mail pero no un
teléfono. Ya está corregido: ahora cuenta solo los teléfonos. Ese filtro **no se puede armar desde la pantalla**
(el camino de la rama no se escribe a mano): lo arma el
[amaIA](/ayuda/reportes/armar-con-el-asistente) cuando le pedís "los casos sin teléfono". En la pantalla,
**Cantidad** cuenta todos los contactos juntos.

### Filtré por un dato adicional y no trae lo que espero

Los datos adicionales se guardan **como texto**, así que las comparaciones son de texto: `mayor que 9`
deja afuera al `10`. Para "es igual a" y "contiene" funciona bien.

### "En lista" me muestra una lista vacía

Ese campo no tiene valores cargados para elegir. Solo funciona en empresa, situación, gestión y motivo
de no pago.

### Filtré por pagos y las columnas de pago salen vacías

Tenés dos filtros sobre la misma rama que ningún elemento cumple a la vez.

### Un reporte que venía trayendo todos los cancelados ahora trae menos

Desde que existe **"Cancelado con quita"** (los casos de Telecom/Personal que se cancelaron con la
clave de pago con quita, ver [Pagos y promesas](/ayuda/gestion/pagos-y-promesas)), un filtro que
compara "situación = Cancelado / Pagado" **no** incluye a esos casos: son dos códigos de situación
distintos. Si el reporte tiene que ver "todo lo cancelado", agregá también "Cancelado con quita" al
filtro (o filtrá por lo que compare contra la lista completa de situaciones, no una sola).

---

## Preguntas frecuentes

**¿Puedo hacer un filtro con "o"?**
Solo con **En lista**, y solo en los cuatro campos que tienen desplegable.

**¿Los filtros variables se guardan de una ejecución a la otra?**
No, se piden cada vez. Por eso conviene ponerles valor por defecto.

**¿Un filtro hace que el reporte corra más rápido?**
Sí, salvo los de Cantidad distintos de `= 0` y `> 0`, que se aplican después de traer los datos.
