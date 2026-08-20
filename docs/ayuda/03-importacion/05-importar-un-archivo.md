<!--
seccion: Importación de datos
resumen: El asistente de carga, paso a paso, y qué mirar en la vista previa antes de confirmar.
revisado: 2026-08-20
rutas: /carga
-->
# Importar un archivo

## Para qué sirve

Es la operación del día a día: llegó un archivo del cedente y hay que meterlo en el sistema. La
plantilla ya está armada; acá solo se ejecuta.

## Antes de empezar

- El permiso **Ejecutar importaciones**.
- La **plantilla** de esa categoría, ya guardada para esa empresa.
- El archivo.
- Si la categoría modifica casos existentes, saber **contra qué remesa** va.

---

## Paso 1 — Categoría

**Importación de Datos → Nueva Importación.**

Elegís qué trae el archivo. La categoría filtra las plantillas que vas a ver en el paso siguiente: si
no aparece la que buscás, casi siempre es porque está guardada con otra categoría.

Ver [Las categorías](/ayuda/importacion/categorias) si tenés dudas de cuál corresponde.

## Paso 2 — Plantilla y archivo

Tres cosas en la misma pantalla:

**La plantilla.** Solo aparecen las de esa empresa y esa categoría.

**El archivo.** Se arrastra o se busca. Podés subir **varios archivos del mismo formato** y se
recorren como uno solo — el asistente te muestra cuántos entran en la remesa.

Si es un Excel, además elegís **qué hoja** leer.

**La remesa origen**, solo si la categoría la necesita (Facturas, Pagos, Contactos, Enriquecimiento,
Actualizaciones). Es contra qué cartera se van a buscar los casos.

> Solo se listan remesas **finalizadas**. Una carga en curso no puede ser origen de otra.

> En **Pagos** podés marcar **varias** remesas a la vez: el archivo de cobranzas suele cubrir varias
> asignaciones y así se cargan todas en una corrida.

> En **Acciones masivas** la remesa origen es **opcional**. Sin elegir ninguna, la acción se aplica
> sobre **toda la empresa**.

## Paso 3 — Vista previa

**Este es el paso que hay que mirar.**

El sistema lee las **primeras 50 filas** y te muestra cómo quedaría cada una **ya mapeada y
transformada**: no el archivo crudo, sino el resultado. Junto con eso, cuántas filas están bien y
cuántas darían error.

### Qué mirar, en orden

1. **¿Los importes tienen el valor correcto?** Es el error más caro y el más silencioso. Si el archivo
   dice `145.320` y la vista previa dice `145,32`, tenés un problema de separador de miles.
2. **¿Las fechas son las que corresponden?** Especialmente el día y el mes: buscá una fecha que sepas
   y verificá que no estén cambiados.
3. **¿Los nombres y documentos salen limpios?** Sin comillas sueltas, sin espacios raros.
4. **¿La cantidad de filas es la que esperabas?** Si hay filtros de fila configurados, la vista previa
   te dice cuántas se descartan por ellos. Las descartadas por filtro **no son errores**.
5. **¿Hay filas con error?** Podés ver cuáles y por qué antes de confirmar.

### En Acciones masivas, además

La vista previa muestra un **preview de impacto**: cuántos casos matchean de verdad con tu listado y
qué operaciones se van a aplicar. Es importante porque un listado puede traer cuentas que ya no están
en la cartera, y entonces el impacto real es menor de lo que esperabas.

Si el modo es de limpieza de contactos, avisa explícitamente que **se borran de toda la base de la
empresa**.

## Paso 4 — Importando

Corre en segundo plano y vas viendo el progreso. **Podés cerrar la pantalla o irte a otra**: la carga
sigue. Se retoma desde el historial.

## Paso 5 — Resultado

Filas leídas, importadas y con error.

**Que diga "finalizada" no quiere decir que salió todo bien.** Puede haber terminado con filas
rechazadas. Si `errFilas` es mayor a cero, entrá al detalle y mirá el motivo fila por fila.

---

## El control que nunca falla

Antes de dar una carga por buena:

**Compará la cantidad de casos cargados contra la cantidad de filas del archivo.**

Si no coinciden y no era esperable, casi siempre es una de dos:

- **Dos filas comparten el documento** y el sistema las tomó como el mismo caso. Es lo que hace
  desaparecer casos sin ningún error a la vista.
- **Un filtro de fila** está descartando más de lo que creías.

Si la remesa tenía varios archivos, la cuenta es contra **el total** de todos.

---

## Qué puede salir mal

### No aparece ninguna plantilla en el paso 2

La plantilla está guardada con **otra categoría**, o pertenece a **otra empresa**. Se ve en
Importación de Datos → Plantillas.

### La carga terminó con 0 filas importadas

Casi siempre es la **remesa origen equivocada**: los casos que busca el archivo están en otra remesa.
También puede ser un filtro de fila que descarta todo.

### Muchas filas con error "sin nro_cliente"

Las cargas de **Facturas** y **Pagos** buscan el caso **por número de cliente**. Si la cartera se
cargó sin mapear ese campo, esos archivos no van a poder matchear. No se arregla desde acá: hay que
recargar la cartera con el número de cliente mapeado.

### Se cargaron menos casos que filas

Ver el control de arriba.

### La importación quedó "procesando" y no avanza

Mirá el detalle desde el historial. Si está realmente colgada, no se puede borrar mientras esté en
curso — hay que esperar a que termine o falle.

### Importé el archivo equivocado

Ver [Historial y problemas](/ayuda/importacion/historial-y-problemas). La respuesta corta: **depende
de la categoría**, y no siempre se puede deshacer.

---

## Preguntas frecuentes

**¿Puedo importar el mismo archivo dos veces?**
Depende de la categoría. En Deudores, la segunda corrida actualiza los casos en vez de duplicarlos
(dentro de la misma remesa). En Pagos hay un anti-duplicados que saltea un pago si ya existe otro del
mismo caso, mismo día y mismo importe — salvo que la plantilla mapee el número de comprobante, que lo
distingue.

**¿Puedo cerrar el navegador mientras carga?**
Sí. Corre en el servidor.

**¿Qué pasa si el archivo tiene filas con error?**
Las que están bien se cargan igual. Las que fallan quedan registradas con su motivo y se pueden
revisar desde el historial.

**¿La vista previa me muestra todo el archivo?**
No, las primeras 50 filas. Los totales de la vista previa son de esa muestra, no del archivo entero.
