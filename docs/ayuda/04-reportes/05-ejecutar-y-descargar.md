<!--
seccion: Reportes
resumen: Correr un reporte, qué pasa si es grande, y de dónde se bajan los archivos.
revisado: 2026-08-20
rutas: /reportes, /reportes/ejecuciones
-->
# Ejecutar y descargar

## Para qué sirve

La plantilla ya está armada; acá se corre. Es la operación del día a día una vez que el reporte existe.

## Antes de empezar

- El permiso **Ejecutar reportes**.
- La plantilla, guardada.
- Si tiene filtros variables, los valores que vas a usar.

---

## Ejecutar

Desde **Reportes → Mis plantillas**, el botón de ejecutar.

Si la plantilla tiene **filtros variables**, primero te los pide: el período, la empresa, lo que se
haya definido. Los que tengan valor por defecto vienen completados.

Después el sistema decide solo cómo correrlo:

| | Qué pasa |
|---|---|
| **Menos de ~5.000 casos** | Se genera en el momento y lo descargás ahí mismo |
| **Más de ~5.000 casos** | Te pregunta si querés encolarlo y corre en segundo plano |

**El umbral cuenta casos, no filas.** Si tenés una columna en expandir, un reporte de 4.000 casos puede
dar 40.000 filas y correr igual en el momento.

Cuando supera el umbral aparece un cartel de **"Procesamiento en segundo plano"** con la cantidad
estimada, y elegís encolarlo o volver atrás a afinar los filtros. Si encolás, te lleva solo a **Mis
ejecuciones**.

> ### ⚠ Tres cosas de los reportes encolados
>
> **No te avisa cuando termina.** Hay que volver a Mis ejecuciones a mirar; la pantalla se refresca
> sola cada 30 segundos.
>
> **Se pierde el ordenamiento.** Un reporte encolado sale ordenado por orden interno, no por el que
> configuraste en la plantilla. Si el orden importa, ordenalo en Excel después.
>
> **El tope de 200.000 filas no lo frena antes de empezar**: arranca, procesa hasta pasarse y queda
> fallida. Conviene acotar con filtros de entrada.

---

## Mis ejecuciones

**Reportes → Mis ejecuciones** lista las corridas, con su estado:

| Estado | Qué significa |
|---|---|
| **PENDIENTE** | En la cola, todavía no arrancó |
| **EJECUTANDO** | Corriendo, con barra de progreso |
| **FINALIZADA** | Terminó bien |
| **FALLIDA** | Falló |
| **CANCELADA** | La cancelaste vos |

Se puede **filtrar por estado**, y la pantalla se refresca sola cada 30 segundos.

**Cancelar** funciona mientras esté pendiente o ejecutando — pero **no es instantáneo**: el proceso
corta entre bloques, así que si ya estaba escribiendo el archivo, termina.

**Eliminar** una ejecución del listado requiere que no esté en curso: primero cancelar, después borrar.

> **Solo las ejecuciones encoladas tienen archivo para descargar.** Las que corrieron en el momento
> también figuran en el listado y con el botón habilitado, pero al apretarlo avisan que no tienen
> archivo asociado: esas se descargan cuando se ejecutan, no después.

> **Si falla, el motivo es difícil de ver.** Aparece en un aviso momentáneo, y solo si estabas parado
> en esta pantalla cuando ocurrió. No hay una pantalla de detalle del error.

---

## ⚠ Los archivos se borran a los 30 días

**La plantilla queda para siempre. La ejecución, no.**

Pasados 30 días, se borran **el archivo y el registro de la ejecución**: desaparece del listado, no
queda ni el rastro de que se corrió. (Las canceladas se conservan.)

**Si un reporte tiene valor de acá a un tiempo, guardalo en otro lado.** No uses Mis ejecuciones como
archivo histórico.

Volver a ejecutar la plantilla no reproduce el mismo archivo: los datos cambiaron desde entonces.

---

## Qué puede salir mal

### El reporte tarda muchísimo

Es grande. Lo primero es agregar filtros — sobre todo el de empresa y un período. Un reporte bien
filtrado corre en segundos.

### Me dice que supera el límite

Pasa las 200.000 filas. Además de filtrar, revisá que no haya una columna en **expandir**
multiplicando las filas.

### Quedó fallida

Los motivos más comunes son un filtro variable con un valor que no corresponde al tipo de campo, o un
reporte que se pasó de las 200.000 filas.

El sistema **reintenta hasta tres veces** antes de darla por fallida, así que un problema pasajero
puede resolverse solo.

### No encuentro una ejecución vieja

Pasaron los 30 días y se borró entera. Volvé a ejecutar la plantilla — con la salvedad de que los
datos van a ser los de hoy.

### El reporte salió desordenado

Se ejecutó encolado, y en ese modo se pierde el ordenamiento de la plantilla. Reordenalo en Excel.

### El reporte trae datos distintos a los de ayer

Es lo esperable: se ejecuta sobre los datos actuales. Si necesitás la foto de una fecha, hay que
guardar el archivo.

### Me da un error de permisos al ejecutar

Falta **Ejecutar reportes**. El botón se ve igual —la pantalla no lo esconde— y el error aparece recién
al confirmar.

---

## Preguntas frecuentes

**¿Puedo ejecutar el mismo reporte con distintos filtros?**
Sí, si los filtros son variables: te los pide en cada ejecución.

**¿Puedo ver las ejecuciones de otros?**
Con el permiso para ver todas las ejecuciones **aparecen en la lista**, pero no se pueden abrir,
descargar, cancelar ni borrar: esas acciones son solo sobre las propias.

**¿Puedo cancelar una ejecución en curso?**
Sí, mientras esté pendiente o ejecutando.

**¿Cuánto tarda un reporte grande?**
Depende del volumen y de las ramas que traiga. Un reporte con muchas columnas de relaciones tarda más
que uno de campos del caso.

**¿Se puede programar para que corra solo?**
No por ahora: se ejecutan a demanda.
