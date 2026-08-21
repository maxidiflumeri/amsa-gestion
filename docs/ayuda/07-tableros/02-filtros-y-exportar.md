<!--
seccion: Tableros
resumen: Acotar el tablero a lo que te interesa y bajarlo para una reunión.
revisado: 2026-08-21
rutas: /dashboards
-->
# Filtrar y exportar el tablero

## Para qué sirve

El tablero completo sirve para el panorama. Los filtros son para las preguntas concretas: *"¿cómo va
la remesa de julio?"*, *"¿qué pasa con los que dicen que no tienen trabajo?"*.

## Antes de empezar

**Ver tableros**, y **Exportar tableros a PDF/XLS** para bajar el archivo. Ver
[Roles y permisos](/ayuda/administracion/roles-y-permisos).

---

## Los filtros

| Filtro | Para qué |
|---|---|
| **Empresa** | La cartera. Es el primero y es obligatorio: sin empresa no hay tablero. Cambiarla limpia la remesa y los códigos elegidos |
| **Remesa** | Una asignación puntual, o todas |
| **Desde / Hasta** | El período de la actividad — pagos y gestiones. Por defecto, los últimos 30 días |
| **Granularidad** | Si las series se agrupan por día, semana o mes |
| **Estado situación** | Uno o varios códigos a la vez |
| **Estado gestión** | Uno o varios |
| **Motivo no pago** | Uno o varios |

Los tres últimos son de selección múltiple. La barra tiene además **Refrescar**, para recalcular sin
tocar nada, y **Limpiar**, que devuelve todo a los últimos 30 días sin soltar la empresa.

> **El combo de Remesa solo lista las remesas que trajeron cartera.** Las de pagos y las de
> actualizaciones no aparecen: no es que falten, es que no tienen casos propios para medir.

> **Los tres filtros de estado ofrecen solo los códigos de la empresa elegida.** Por eso están vacíos
> hasta que elijas una.

> **Dejar la granularidad en "Auto" casi siempre es lo correcto.** Elige según el rango: hasta 60 días
> agrupa por día, y de ahí en adelante por semana.

---

## El tope de 366 días

El rango no puede pasar de **366 días**. Si te pasás, los campos de fecha se ponen en rojo con un
*"Máximo 366 días"* debajo. Achicalo y el tablero vuelve solo.

Para comparar dos años hay que mirarlos de a uno.

---

## Filtrar bien, en la práctica

**Empezá por la remesa, no por los códigos.** Casi todas las preguntas reales son sobre una asignación
concreta, y acotar por remesa hace que el resto de los números tengan sentido de una.

**Un filtro de estado por vez.** Si marcás situación *y* gestión *y* motivo, lo más probable es que
quedes con cuarenta casos y ninguna conclusión.

Y hay una razón menos obvia: **los filtros de estado se aplican a todo el tablero, distribuciones
incluidas.** Si filtrás por una situación, la torta de situación queda con una sola porción al 100%.
Sirve más filtrar por uno y mirar las distribuciones de los otros dos.

**Para comparar meses, movés solo las fechas.** El resto quieto. Si cambiás dos cosas a la vez no vas
a saber cuál explica la diferencia.

**Acordate de qué respeta el período.** Filtrar de enero a marzo no te muestra "la cartera en marzo":
te muestra la cartera **de hoy** con la actividad de ese trimestre. Ver
[Cómo leer el tablero](/ayuda/tableros/como-leer-el-tablero).

---

## Exportar

El botón **Exportar** baja lo que estás viendo, con los filtros aplicados, en **Excel** o **PDF**.

**Lo que baja son los datos en tablas, no los gráficos como imagen.**

| | Qué trae |
|---|---|
| **Excel** | Una hoja por bloque: indicadores, las tres distribuciones, las dos de rangos, las dos series, top 10 de deudores y el funnel |
| **PDF** | Indicadores, funnel, las distribuciones (**los 12 valores más grandes** de cada una) y el top 10 de deudores. **No trae las series** |

El PDF es el formato "para mandar", y justo le falta la evolución de la cobranza. Si eso es lo que
querés mostrar, va el Excel.

> El archivo **se vuelve a calcular en el servidor** al exportar. Si entró un pago entre que miraste la
> pantalla y apretaste Exportar, el archivo puede diferir en algún número.

### Para una reunión con el cedente

- **Dejá el período explícito en el mensaje** con el que lo mandás. El archivo se entiende mucho menos
  solo de lo que uno cree, por la mezcla de números de cartera y de actividad.
- **Si el cedente trabaja con deuda actualizada por mora, avisalo**: el tablero muestra la deuda
  original, así que los números no van a coincidir. Conviene mandar además un reporte con ese campo.
- **Revisá el motivo de no pago antes de mostrarlo.** Es el gráfico que más se mira en una reunión y el
  que más depende de que el equipo haya cargado el dato.

---

## Del gráfico al caso

Hacer clic en una porción de las tortas o en una barra de mora o de deuda abre **el detalle de ese
pedazo**: la lista de casos que lo componen, paginada de a 25, con la ficha de cada uno a un clic (se
abre en una pestaña nueva).

No abren detalle la porción **"Otros"** ni las barras del **funnel**.

Es el camino corto para pasar del número a la acción. "El 30% son negativa de pago" no se trabaja;
"estos 42 casos son negativa de pago" sí.

---

## Qué puede salir mal

### Los campos de fecha se pusieron en rojo

Pusiste un rango de más de un año. Achicalo.

### Cambié las fechas y la mitad de los números no se movió

Es lo esperado: los de cartera son la foto de hoy. Solo la actividad respeta el período.

### Los filtros de estado están vacíos

Todavía no elegiste empresa: los códigos son de cada cartera.

### No veo el botón Exportar

Falta el permiso **Exportar tableros a PDF/XLS**.

### Los dos combos de arriba están vacíos

Te falta el permiso de **ver el historial de importaciones**, que es de donde salen las listas de
empresas y remesas.

### El PDF no coincide con lo que le mandé al cedente la semana pasada

Los números de cartera son de **hoy**. Un tablero exportado es una foto con fecha: si lo comparás
contra otro de hace un mes, van a diferir aunque los filtros sean iguales.

---

## Preguntas frecuentes

**¿Puedo guardar una combinación de filtros?**
Todavía no. Se eligen cada vez.

**¿La exportación incluye la lista de casos?**
Solo el **top 10 de deudores por monto**. Para el listado caso por caso, eso es un reporte — ver
[Armar un reporte](/ayuda/reportes/armar-un-reporte).

**¿Puedo programar que llegue por mail?**
No hay envío programado de tableros.

**¿Se puede exportar un solo gráfico?**
No, va el tablero completo.
