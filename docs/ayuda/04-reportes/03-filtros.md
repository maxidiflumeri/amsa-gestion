<!--
seccion: Reportes
resumen: Cómo acotar qué casos entran, y cómo dejar filtros que se piden al ejecutar.
revisado: 2026-08-20
rutas: /reportes
-->
# Filtros

## Para qué sirve

Los filtros deciden **qué casos entran** en el reporte. Sin filtros, un reporte trae la cartera entera
— que además de inútil, suele pasar del límite y no correr.

## La regla que hay que tener clara

**El filtro decide qué casos entran. Las columnas deciden qué se muestra de cada uno.**

Un filtro sobre una rama —por ejemplo "tiene un pago mayor a $10.000"— devuelve **el caso completo**,
no solo ese pago. Si además querés ver solo esos pagos, eso es una decisión de columnas, no de
filtros.

Es la confusión más común y da reportes que "traen de más" sin que se entienda por qué.

---

## Los operadores

Cambian según el tipo de campo.

### Texto

| Operador | Qué hace |
|---|---|
| **Igual** / **Distinto** | Coincidencia exacta |
| **Contiene** | En cualquier parte del valor |
| **Empieza con** / **Termina con** | |
| **Está en la lista** / **No está en la lista** | Varios valores a la vez |
| **Entre** / **No entre** | Rango alfabético |
| **Vacío** / **No vacío** | |

### Números

Igual, distinto, mayor, mayor o igual, menor, menor o igual, entre, no entre, está en la lista, no
está, vacío y no vacío.

### Fechas

Igual, mayor, mayor o igual, menor, menor o igual, entre, no entre, vacío y no vacío.

**Entre** es el que más se usa: acota un período.

### Sí / No

Igual, vacío y no vacío.

---

## Los filtros se combinan con Y

Todos los filtros de un reporte se cumplen **a la vez**. Un reporte con dos filtros trae los casos que
cumplen **los dos**.

Si necesitás un "o", casi siempre se resuelve con **está en la lista**: en vez de "situación es A **o**
situación es B", ponés "situación está en la lista A, B".

---

## Filtros variables: los que se piden al ejecutar

Un filtro puede tener el valor **fijo** —siempre el mismo— o ser **variable**, y entonces se pide cada
vez que se ejecuta el reporte.

Es lo que convierte una plantilla en reutilizable. En vez de tener doce plantillas, una por mes, tenés
una con el período variable.

Al marcarlo como variable configurás:

- **La etiqueta** que va a ver quien lo ejecute. Poné algo claro: *"Desde qué fecha"*, no *"fecha1"*.
- **Un valor por defecto**, opcional. Ahorra tipeo y evita que alguien ejecute con el campo vacío.

Los candidatos naturales: **la empresa**, **el período**, **la situación** y **la remesa**.

> Si el reporte se va a ejecutar seguido y siempre cambia lo mismo, ese algo tiene que ser variable.

---

## Los filtros que casi siempre convienen

**La empresa.** Sin él, el reporte cruza todas las carteras. Suele ser el primero que hay que poner, y
suele convenir que sea variable.

**Un período.** Acota el volumen y hace que el reporte corra rápido.

**El estado**, si el reporte es de gestión: excluir los cancelados, por ejemplo.

---

## Qué puede salir mal

### El reporte trae muchísimas más filas de las esperadas

Dos causas, en orden: **falta el filtro de empresa** —está cruzando todas las carteras— o hay una
columna en **expandir** multiplicando las filas.

### El reporte no trae nada

Los filtros se combinan con Y: probablemente alguno se contradice con otro. Sacalos de a uno hasta
encontrar cuál.

También pasa cuando el filtro está sobre un campo que no está cargado: si filtrás por un dato
adicional que ese cedente no manda, no va a matchear ninguno.

### Filtré por un pago y me trae el caso con todos sus pagos

Es el comportamiento esperado, no un error. Ver la regla del principio.

### El reporte no me deja ejecutarlo y pide un valor

Tiene un filtro variable sin valor por defecto. Hay que completarlo.

### Filtré por texto y no encuentra lo que sé que está

Probá con **contiene** en vez de **igual**: los datos del cedente suelen traer espacios o formas
distintas de escribir lo mismo.

---

## Preguntas frecuentes

**¿Puedo hacer un filtro con "o"?**
No directamente. Usá **está en la lista**, que resuelve casi todos los casos.

**¿Puedo filtrar por un dato adicional del cedente?**
Sí, aparecen en el explorador. Pero solo existen para los casos donde el cedente los mandó y la
plantilla de importación los mapeó.

**¿Los filtros variables se guardan de una ejecución a la otra?**
No. Se piden cada vez. Por eso conviene ponerles valor por defecto.

**¿Un filtro hace que el reporte corra más rápido?**
Sí, y bastante. Es la principal herramienta para que un reporte grande sea manejable.
