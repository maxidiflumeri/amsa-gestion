<!--
seccion: Reportes
resumen: Cómo acotar qué casos entran, y cómo dejar filtros que se piden al ejecutar.
revisado: 2026-08-20
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

> ### ⚠ El rango de fechas se come el último día
>
> Si ponés **Entre 01/01 y 31/01**, el 31 de enero **queda afuera**. Es un problema de zona horaria: el
> sistema toma el "hasta" a la medianoche, y con nuestro huso eso cae antes de que empiece el día.
>
> **El workaround: poné un día más en el Hasta.** Para cubrir enero, `01/01` a `01/02`.

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

**Los datos adicionales del cedente.** Aparecen en el selector de filtros, pero **el reporte falla al
ejecutarse**. Se pueden usar como columna, no como filtro.

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

### Falta el último día del período

Es el problema de zona horaria. Poné un día más en el Hasta.

### El reporte falla al ejecutar

Si el filtro es sobre un **dato adicional del cedente**, es eso: no se puede filtrar por ahí.

### "En lista" me muestra una lista vacía

Ese campo no tiene valores cargados para elegir. Solo funciona en empresa, situación, gestión y motivo
de no pago.

### Filtré por pagos y las columnas de pago salen vacías

Tenés dos filtros sobre la misma rama que ningún elemento cumple a la vez.

---

## Preguntas frecuentes

**¿Puedo hacer un filtro con "o"?**
Solo con **En lista**, y solo en los cuatro campos que tienen desplegable.

**¿Los filtros variables se guardan de una ejecución a la otra?**
No, se piden cada vez. Por eso conviene ponerles valor por defecto.

**¿Un filtro hace que el reporte corra más rápido?**
Sí, salvo los de Cantidad distintos de `= 0` y `> 0`, que se aplican después de traer los datos.
