<!--
seccion: Importación de datos
resumen: El asistente de carga, paso a paso, y qué mirar en la vista previa antes de confirmar.
revisado: 2026-08-20
rutas: /carga
rutaPrincipal: /carga
-->
# Importar un archivo

## Para qué sirve

Es la operación del día a día: llegó un archivo del cedente y hay que meterlo en el sistema. La
plantilla ya está armada; acá solo se ejecuta.

## Antes de empezar

- Tres permisos, no uno: **Ejecutar importaciones**, **Ver historial de importaciones** y **Ver
  plantillas de importación**. El menú aparece con cualquiera de ellos, así que con solo el primero vas
  a ver "Nueva Importación" y chocarte con un error en el paso 2. Para acciones masivas, además el
  permiso de acciones masivas.
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
recorren como uno solo (tope: 100). En Multirregistro no: procesa **uno solo** e ignora el resto.

Si el primer archivo es un Excel, aparece un campo para **escribir el nombre de la hoja**. No es una
lista: tiene que coincidir exacto, y si no, se lee la primera sin avisar.

Hay además campos opcionales: nombre y número de remesa, fecha de vencimiento del lote, y un switch
para **validar domicilios contra Georef** (más lento).

**La remesa origen**, solo si la categoría la necesita (Facturas, Pagos, Contactos, Enriquecimiento,
Actualizaciones). Es contra qué cartera se van a buscar los casos.

> Solo se listan remesas **finalizadas que cargaron casos**. Las de facturas, pagos o acciones no
> aparecen: no sirven como origen de nada.

> Viene activado el switch **"Solo remesas en gestión"**: se listan las que todavía tienen al menos
> un caso vivo (ni cancelado ni desasignado). Apagalo si necesitás una cartera ya cerrada.

> En **Pagos** podés marcar **varias** remesas a la vez: el archivo de cobranzas suele cubrir varias
> asignaciones y así se cargan todas en una corrida. Con **Seleccionar todas** marcás de una todas
> las que estén en gestión, que es lo habitual para el archivo de cobros del mes.

> En **Acciones masivas** la remesa origen es **opcional**. Sin elegir ninguna, la acción se aplica
> sobre **toda la empresa**.

### Si el archivo trae varias asignaciones juntas

Algunos cedentes exportan filtrando **solo por día**: si ese día asignaron cuatro nóminas, llega un
archivo con las cuatro adentro. Es el caso de Telecom y Telecom Personal, que se bajan de Deimos.

Cuando la plantilla tiene configurada la división, el botón dice **"Ver los cortes del archivo"** en
vez de "Crear remesa y validar". Se abre una tabla con **una fila por nómina y gestión**, cuántos
casos tiene cada una y qué número de remesa le va a tocar:

| Nómina | Gestión | Casos | Nº de remesa |
|---|---|---|---|
| 3082 | 3GH | 13.948 | `30100` |
| 3083 | 1G | 1.957 | `10101` |

**Compará los casos con lo que informó el cedente por mail antes de seguir.** Podés editar cualquier
número y destildar los cortes que no quieras cargar todavía.

El número se propone solo: cuando la división es por gestión, se le antepone su primer dígito al
número de remesa (la gestión `3GH` sobre la remesa `100` es la `30100`). Si dos gestiones empiezan
con el mismo dígito —`3G` y `3GH`— sale el mismo número para las dos y hay que corregir una a mano;
la pantalla te avisa y no deja seguir hasta que lo hagas.

Al confirmar se crean todas las remesas de una, **sobre el mismo archivo** (no se sube ni se guarda
varias veces), y se importan **una después de la otra**. Mientras corre vas a ver "Procesando la
remesa 2 de 5".

## Paso 3 — Vista previa

**Este es el paso que hay que mirar.**

El sistema te muestra cómo quedaría cada fila **ya mapeada y transformada**: no el archivo crudo, sino
el resultado.

Con una distinción que importa: **el Total es del archivo completo**, pero los contadores de filas OK y
con error se calculan **solo sobre las primeras 50**.

> ⚠ **Si el Excel tiene varias hojas, la vista previa lee siempre la primera** — aunque hayas escrito
> otra. La importación sí usa la que escribiste. O sea que lo que ves acá puede no ser lo que se va a
> importar.

### Los avisos en amarillo

Arriba de la vista previa pueden aparecer avisos. No frenan la carga, pero son cosas que se notan
tarde y salen caras:

- **"X cuenta(s) van a quedar sin cargar"** — el archivo trae varias cuentas por persona y la
  plantilla identifica los casos por documento, así que la última cuenta de cada DNI pisa a las
  anteriores. Si en esa cartera cada cuenta es un caso (Telecom, Personal), hay que cambiar la
  plantilla a identificar por **Nº de cliente**. Ver [Crear una plantilla](04-crear-plantilla.md).
- **"X filas traen el importe en NEGATIVO"** — en un archivo de pagos, un importe negativo
  **aumenta** la deuda en vez de bajarla, porque el saldo es la deuda menos los pagos. Si son notas
  de crédito o ajustes a favor, hay que agregar el transform `removeDashes` al importe.

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

### Errores con el número de cliente

Son dos problemas distintos con solución distinta:

- **"nro_cliente es requerido"** — la fila del archivo no trae el dato. Se arregla mapeando esa columna
  en la plantilla.
- **"Deudor no encontrado (nro_cliente=…)"** — el caso no existe con ese número en la remesa elegida.
  Puede ser la remesa equivocada, o que la cartera se haya cargado sin mapear el número de cliente. Lo
  segundo no se arregla desde acá: hay que recargar la cartera.

Facturas y Pagos matchean **solo** por número de cliente, nunca por documento. Contactos y
Enriquecimiento sí aceptan documento.

### No me deja arrancar la importación

Solo se permite **una importación por usuario a la vez**. Si tenés otra en curso, hay que esperar.

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
Muestra las primeras 50 filas. El **Total** sí es del archivo completo; los contadores de OK y error
son de esa muestra.

**¿Dónde veo los errores después?**
En Importación de Datos → **Historial**, entrando a la remesa. El botón "Ver errores" del paso 5 abre
la respuesta cruda del servidor, que no es cómoda de leer.
