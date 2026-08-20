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
| **Reporte chico** (menos de ~5.000 filas) | Se genera en el momento y lo descargás enseguida |
| **Reporte grande** | Se encola, corre en segundo plano y te avisa cuando está |

**No lo elegís vos**: depende de cuántas filas estime. Y si el reporte supera las **200.000 filas**, no
se ejecuta — hay que acotarlo con filtros.

> En un reporte grande **podés cerrar la pantalla o irte a otra**: sigue corriendo en el servidor.

---

## Mis ejecuciones

**Reportes → Mis ejecuciones** lista las corridas, con su estado:

| Estado | Qué significa |
|---|---|
| **Pendiente** | En la cola, todavía no arrancó |
| **Ejecutando** | Corriendo, con barra de progreso |
| **Completada** | Lista para descargar |
| **Error** | Falló. El detalle dice por qué |

Mientras está pendiente o ejecutando se puede **cancelar**. Una vez completada, ya no.

Desde ahí se **descarga** el archivo.

---

## ⚠ Los archivos se borran a los 30 días

**La plantilla queda para siempre. El archivo generado, no.**

Pasados 30 días de la ejecución, el archivo se elimina y el botón de descarga deja de servir. La
ejecución sigue figurando en el listado, pero sin archivo.

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

### Quedó en error

Entrá al detalle: el mensaje dice el motivo. Los más comunes son un filtro variable con un valor que
no corresponde al tipo de campo, o un reporte que se pasó del límite.

### No puedo descargar un reporte viejo

Pasaron los 30 días y el archivo se borró. Volvé a ejecutar la plantilla — con la salvedad de que los
datos van a ser los de hoy, no los de entonces.

### El reporte trae datos distintos a los de ayer

Es lo esperable: se ejecuta sobre los datos actuales. Si necesitás la foto de una fecha, hay que
guardar el archivo.

### No veo el botón de ejecutar

Falta el permiso **Ejecutar reportes**.

---

## Preguntas frecuentes

**¿Puedo ejecutar el mismo reporte con distintos filtros?**
Sí, si los filtros son variables: te los pide en cada ejecución.

**¿Puedo ver las ejecuciones de otros?**
Solo con el permiso para ver todas las ejecuciones. Sin él, ves las tuyas.

**¿Puedo cancelar una ejecución en curso?**
Sí, mientras esté pendiente o ejecutando.

**¿Cuánto tarda un reporte grande?**
Depende del volumen y de las ramas que traiga. Un reporte con muchas columnas de relaciones tarda más
que uno de campos del caso.

**¿Se puede programar para que corra solo?**
No por ahora: se ejecutan a demanda.
