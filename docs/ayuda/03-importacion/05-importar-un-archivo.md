<!--
seccion: Importación de datos
resumen: El asistente de carga, paso a paso, y qué mirar en la vista previa antes de confirmar.
revisado: 2026-10-09
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

**La subida.** Al apretar **Crear remesa y validar** (o **Ver los cortes del archivo**), abajo de la
pantalla aparece una barra que dice *"Subiendo archivos… N %"* y, debajo, *"X MB de Y MB"* (en KB si el archivo es chico; mientras no se envió ningún byte, solo el título). Cuando los
archivos terminaron de llegar al servidor, pasa a *"Armando la vista previa…"* con *"El servidor está
leyendo el archivo."* Con un archivo grande puede tardar: no cierres la pantalla hasta que aparezca la
vista previa. Si el navegador no sabe el tamaño total, la barra no muestra porcentaje y solo dice cuánto se
envió (en KB si el archivo es muy chico). En una carga dividida el archivo se envía dos veces —al buscar los
cortes y al crear las remesas—, así que la barra aparece las dos veces; lo que no pasa es que se suba una
vez por remesa.

**La remesa origen**, solo si la categoría la necesita (Facturas, Pagos, Contactos, Enriquecimiento,
Actualizaciones). Es contra qué cartera se van a buscar los casos.

> Solo se listan remesas **finalizadas que cargaron casos**. Las de facturas, pagos o acciones no
> aparecen: no sirven como origen de nada.

> Viene activado el switch **"Solo remesas en gestión"**: se listan las que todavía tienen al menos
> un caso vivo (ni cancelado ni desasignado). Apagalo si necesitás una cartera ya cerrada.

> En **Pagos**, **Facturas**, **Contactos** y **Enriquecimiento** podés marcar **varias** remesas a la vez: el archivo del cedente
> suele cubrir varias asignaciones —y una carga dividida deja varias remesas sobre el mismo
> archivo—, así que se cargan todas en una sola corrida en vez de subir el archivo una vez por
> remesa. Con **Seleccionar todas** marcás de una todas las que estén en gestión, que es lo habitual
> para el archivo del mes.

> En **Acciones masivas** la remesa origen es **opcional**. Sin elegir ninguna, la acción se aplica
> sobre **toda la empresa**.

### Si el archivo trae varias asignaciones juntas

Algunos cedentes exportan filtrando **solo por día**: si ese día asignaron cuatro nóminas, llega un
archivo con las cuatro adentro. Es el caso de Telecom y Telecom Personal, que se bajan de Deimos.

Cuando la plantilla tiene configurada la división, el botón dice **"Ver los cortes del archivo"** en
vez de "Crear remesa y validar". Se abre una tabla con una fila por corte, cuántos casos tiene cada
uno y qué número de remesa le va a tocar:

| | Nómina | Gestión | Casos | Nº de remesa |
|---|---|---|---|---|
| ☑ | 3082 | 3GH | 13.948 | `30100` |
| ☑ | 3083 | 1G | 1.957 | `10101` |

**Compará los casos con lo que informó el cedente por mail antes de seguir.** Podés editar cualquier
número y **destildar los cortes que no quieras cargar**.

El número se propone solo: el corte recibe un número base y la gestión le antepone su primer dígito.
Sobre la remesa `00608`, la `2G` es la `20608` y la `3GH` la `30608` — **la primera gestión (`1G`)
conserva el número tal cual**, sin prefijo.

Dos gestiones con el mismo dígito —`3G` y `3GH`— son **la misma gestión**: van en un solo corte, que
se muestra con las dos juntas (`3GH / 3G`). Si igual editás dos números y quedan iguales, la pantalla
te avisa y no deja seguir hasta que corrijas uno.

Al apretar **Crear N remesa(s)** —antes de la vista previa— se crean todas las remesas de una,
**sobre el mismo archivo** (se guarda una sola vez, no una por remesa). La vista previa y el **Total** son
solo los de la primera. Después se importan **una después de la otra**. Mientras corre vas a ver "Procesando la
remesa 2 de 5".

> **Si el archivo mezcla dos empresas.** Un CA puede traer nóminas de prebaja y de posbaja, que son
> carteras de empresas distintas. Subilo **dos veces, una por empresa**: en cada carga elegís la
> empresa arriba y tildás solo las nóminas que le corresponden. La columna que las distingue aparece
> en la tabla si la plantilla la declara como columna de corte.

## Paso 3 — Vista previa

**Este es el paso que hay que mirar.**

El sistema te muestra cómo quedaría cada fila **ya mapeada y transformada**: no el archivo crudo, sino
el resultado.

Con una distinción que importa: **el Total es del archivo completo**, pero los contadores de filas OK y
con error se calculan **solo sobre las primeras 50**.

> Si el Excel tiene varias hojas, la vista previa lee la que escribiste, la misma que después usa la
> importación.

### Si el archivo no tiene filas

Si el **Total** da 0, el botón **Confirmar e importar** queda **deshabilitado** y abajo de la vista
previa aparece el aviso *"El archivo no tiene filas para importar."* Si la causa es que el filtro de la
plantilla descartó todas, el aviso agrega *"El filtro de la plantilla descartó las N filas."* En una carga
dividida, las filas que pertenecen a otros cortes no cuentan como descartadas por el filtro: el aviso las
separa y agrega *"N filas son de otros cortes de la división."* Hay que
revisar el archivo o el filtro de la plantilla. Ojo: la remesa ya se creó al pasar al paso 3, así que si
volvés atrás **queda en el Historial como PENDIENTE o VALIDANDO, ocupando su número**. Si no la vas a
usar, borrala: es la forma de liberar el número. Si nadie la confirma, el sistema la borra solo (la limpieza de cada madrugada borra las de más de 24
horas; ver [Historial y problemas](/ayuda/importacion/historial-y-problemas)), pero hasta entonces el número
sigue ocupado. Si intentás confirmar una vista previa que ya se borró sola, la pantalla responde *"Remesa no
existe"*: hay que volver a subir el archivo.

### Los avisos en amarillo

Arriba de la vista previa pueden aparecer avisos. No frenan la carga, pero son cosas que se notan
tarde y salen caras:

- **"X cuenta(s) van a quedar sin cargar"** — el archivo trae varias cuentas por persona y la
  plantilla identifica los casos por documento, así que la última cuenta de cada DNI pisa a las
  anteriores. Si en esa cartera cada cuenta es un caso (Telecom, Personal), hay que cambiar la
  plantilla a identificar por **Nº de cliente**. Ver [Crear una plantilla](/ayuda/importacion/crear-plantilla).
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

La pantalla se llama **"Ejecutando importación"** y muestra en qué fase está la carga:

| Fase | Qué dice la pantalla |
|---|---|
| Recién confirmada | *Enviando a la cola…* |
| En cola | **En cola**, con la posición: *Esperando que termine otra importación.* si no se sabe, *Es la próxima: empieza en instantes.*, *Hay 1 importación antes que esta.* o *Hay N importaciones antes que esta.* Barra sin porcentaje |
| Leyendo el archivo | **Leyendo el archivo** — *Todavía no se procesó ninguna fila.* Barra sin porcentaje. Se ve solo en los archivos Excel y en Multirregistro, Multiarchivo y Claves de pago; un CSV o un TXT se leen a medida que se procesan y pasan directo a Procesando |
| Procesando | **Procesando**, con el porcentaje y los contadores: **Total**, **Procesadas**, **OK**, **Errores** y **Descartadas** (los dos últimos solo si son más de cero) y, en las categorías que lo informan, **Nuevos** y **Actualizados**. Si todavía no se sabe cuántas filas son, la barra no muestra porcentaje. Debajo de los contadores, el ritmo: *≈ 34 filas/s · faltan ~4 min para terminar las filas* (sin la segunda parte cuando todavía no se puede estimar el tiempo) |
| Post-proceso | **Post-proceso** — el paso en que está, por ejemplo *Consolidando la remesa de origen: 1.500 de 8.875*. Si el sistema todavía no informa el paso, dice *Consolidando y cerrando la carga. Puede tardar varios minutos.* Barra sin porcentaje |

**Descartadas** es lo que descartó el filtro de la plantilla: no son errores. En una carga dividida no
incluye las filas de otros cortes. **Nuevos** son los casos que creó esta carga; lo informan Deudores, Deudores y
Facturas, Actualizaciones, Multirregistro y Multiarchivo. **Actualizados** son los casos que ya existían y la
carga tocó; lo informan solo Actualizaciones, Multirregistro y Multiarchivo (en Deudores y en Deudores y
Facturas la remesa es siempre nueva, así que "ya existía" no tiene sentido y el contador no aparece). En las
demás categorías ninguno de los dos aparece. El ritmo y el "faltan" cubren las filas, no el post-proceso, que
viene después.

En **Deudores**, si **Nuevos** da menos que **OK**, la diferencia son filas que cayeron sobre un caso que la
misma carga ya había creado: dos filas con la misma identidad dentro del archivo, que el sistema tomó como un
solo caso. Es el primer síntoma del problema que describe "El control que nunca falla", más abajo.

El porcentaje no llega a 100% hasta que la carga termina.

La carga corre **en el servidor**: si cerrás la pantalla o te vas a otra, sigue. La podés ver en la
campanita de la barra superior, en **Importaciones en curso**, o entrando a su detalle desde el
Historial.

> **Excepción: la carga dividida.** Cuando el archivo se divide en varias remesas, cada una la arranca
> **esta pantalla** cuando termina la anterior. Si la cerrás, la remesa que estaba corriendo termina,
> pero **las siguientes no arrancan**. Dejala abierta hasta ver el resultado; un aviso arriba te lo
> recuerda mientras corre.

La pantalla se actualiza sola. Si se corta la conexión, igual se entera de cómo terminó la carga.
Estos avisos pueden aparecer abajo:

- *"Sin conexión en tiempo real. El estado se actualiza cada 10 segundos."* — la pantalla sigue
  consultando al servidor cada 10 segundos. No hace falta recargar: cuando vuelve la conexión, muestra
  el estado real, incluso si la carga ya terminó. Si la barra superior muestra un ícono de nube
  tachada, es lo mismo: no está llegando el tiempo real.
- *"El servidor no da señales de esta carga hace N min. Si no se recupera, en unos minutos se marca sola
  como fallida y vas a poder hacer otras importaciones; el motivo va a decir qué hacer con esta."* — aparece
  cuando la última señal del servidor es de hace 2 minutos o más, mientras la carga está leyendo, procesando
  o en post-proceso. La edad se mide con la hora del servidor: si abrís la pantalla sobre una carga que ya
  estaba colgada, avisa enseguida y no depende del reloj de tu PC. No aparece en cola. Si el servidor no se
  recupera, la carga se marca sola como **fallida**, normalmente entre 6 y 7 minutos después de la última
  señal (ver "La importación falló: qué hacer").
- *"El servidor no da señales de esta carga hace N min y todavía no se marcó como fallida. Avisá a
  soporte."* — es el segundo escalón del aviso anterior: a los 15 minutos sin señal, si la carga sigue sin
  cerrarse, es que el cierre automático no está ocurriendo (por ejemplo, el servidor sigue caído). Hay que
  avisar a soporte.
- *"El servidor no da señales de esta carga hace N min. Puede estar en un paso largo o haberse
  interrumpido. Es una carga anterior al seguimiento automático y no se va a marcar como fallida sola:
  avisá a soporte."* — el mismo aviso, pero para una remesa vieja, creada hasta el 05/10/2026 inclusive, que el
  sistema no sigue: esa no se cierra sola.
- *"Esta carga es la próxima de la cola y el servidor no la tomó hace N min. Si sigue así, avisá a soporte.
  Mientras no arranque, la podés eliminar desde el Historial."* — aparece cuando la carga es la próxima de
  la cola y lleva 2 minutos o más sin que el servidor la tome. Los minutos se cuentan desde que esta pantalla la vio como
  la próxima, no desde que la confirmaste: una carga que esperó mucho detrás de otra no avisa apenas le
  toca. Este aviso **no** promete que la carga se cierre sola.
- *"El servidor sigue trabajando, pero esta carga no muestra avances hace N min (contados desde que abriste
  esta pantalla). Puede ser un paso largo. Si sigue así, avisá a soporte: no se va a marcar como fallida
  sola."* — el servidor da señales, pero esta pantalla no vio cambiar la fase, el paso ni los contadores en
  10 minutos. Los minutos se cuentan desde que abriste la pantalla: si la recargás, la cuenta vuelve a
  empezar. Solo aparece procesando o en post-proceso, y nunca junto con el de "sin señales".
- *"Esta carga se reinició (intento N)."* — ya no se ve en cargas nuevas: una carga que se interrumpe no se
  vuelve a ejecutar sola. Puede seguir apareciendo en remesas viejas.

**La campanita.** En **Importaciones en curso** cada carga muestra la fase, el porcentaje, el "faltan" y los
contadores **Procesadas**, **OK**, **Err** y **Total**: por ejemplo, la posición en la cola, el paso del
post-proceso o *Procesando · 43% · faltan ~4 min*. No muestra Descartadas, Nuevos ni Actualizados, ni el ritmo
en filas por segundo, ni los avisos de esta pantalla: para eso, entrá al detalle. Cuando una carga de
adelante termina, la posición de las que esperan puede tardar unos segundos en actualizarse. Si una carga se
interrumpe, además llega una notificación **"Importación fallida"** con la primera oración del motivo y cuántas
filas se habían procesado.

## Paso 5 — Resultado

Cuando la carga termina, la pantalla dice cómo terminó, con un título y, si corresponde, un detalle:

| Título | Cuándo | Detalle |
|---|---|---|
| **Importación exitosa** | Ninguna fila dio error. No quiere decir que todas se hayan cargado: en Acciones masivas una fila que no encuentra ningún caso, y en Pagos un cobro que ya estaba cargado (se saltea), no son errores y cuentan como exitosas | — |
| **Importación finalizada con filas con error** | Entraron algunas y otras no | *N de M filas no se cargaron. Mirá el motivo de cada una en el detalle.* |
| **No se cargó ninguna fila** | Todas las filas dieron error | *Las N filas dieron error.* |
| **El archivo no tenía filas para procesar** | No había filas para cargar | Si el filtro de la plantilla las descartó: *El filtro de la plantilla descartó las N filas.* Si hay filas de otros cortes de la división: *N filas son de otros cortes de la división.* Las dos oraciones pueden ir juntas |
| **Importación finalizada con advertencias** | Las filas se cargaron, pero el post-proceso (consolidar, cerrar ausentes, recalcular montos) no terminó. Gana sobre "filas con error": puede haber filas con error y salir con este título | *Se cargaron N filas[ y M dieron error]. Pero el post-proceso no terminó: …* y, según la categoría, qué quedó sin hacer y qué hacer (tabla en [Historial y problemas](/ayuda/importacion/historial-y-problemas)). Termina con *"No hace falta volver a subir el archivo."* |
| **La importación falló** | La carga se cortó | El motivo. Si antes del corte se habían cargado filas: *Antes del corte se cargaron al menos N filas[ y M dieron error]; el cierre de la carga no corrió.* N son las exitosas, y el "al menos" es porque es un piso, no el número exacto (ver "La importación falló: qué hacer") |

Una carga que falló **nunca** se muestra como exitosa. Debajo del título van las métricas **Filas
procesadas**, **Exitosas**, **Con error** y **Descartadas** (las dos últimas solo si hay), **Casos nuevos**
y **Casos actualizados** (solo en las categorías que los informan) y la **Tasa de éxito** cuando se
procesó alguna fila y la carga no falló.

Si la carga registró avisos que no son errores de fila, la pantalla agrega *"N avisos del archivo — ver
el detalle"*. Cuenta los avisos de lectura del archivo (`[parseo]`), los que escriben las propias
categorías al cargar (`[aviso]`, por ejemplo los de Pagos con número de convenio y los de Claves de
pago) y el del post-proceso que no terminó (`[post-proceso]`). Pueden aparecer aunque ninguna fila haya
dado error.

**Carga dividida:** el título es el del **peor** resultado de las remesas, y debajo hay **una fila por
remesa** con su número, su resultado y sus contadores. **Descartadas** no se suma: cada remesa lee el
archivo entero, así que se muestra el valor que comparten (el del filtro de la plantilla, sin las filas de
otros cortes); si no coinciden, no hay total y cada fila de remesa lleva el suyo. Si alguna remesa falló,
no se muestra la **Tasa de éxito**.

Si una remesa de la división **no llegó a ejecutarse** —por ejemplo, porque el servidor rechazó el
pedido—, aparece un cartel rojo con el motivo de cada una: *"1 remesa de la división no se ejecutó"* o
*"N remesas de la división no se ejecutaron"*. Esas remesas quedaron creadas pero sin cargar, y si las
demás salieron bien el título es **"La importación quedó incompleta"**, no de éxito.

**Cuando no se pudo seguir la importación.** Si la pantalla no encuentra la remesa en varias consultas
seguidas (durante al menos unos 6 segundos), dice *"No se pudo seguir la importación: el servidor no
encuentra la remesa. Revisá el Historial antes de volver a cargar el archivo, porque puede estar
corriendo."* **No** quiere decir que se haya eliminado. Dónde aparece:

- **Carga común:** como **alerta fija** en el paso "Importando", con dos botones, **Ir al historial** y
  **Nueva importación**. La pantalla no se reinicia sola.
- **Carga dividida:** en el resumen, con un cartel *"1 remesa de la división no se pudo seguir"* o
  *"N remesas de la división no se pudieron seguir"* y el mismo motivo. Si las remesas que sí corrieron
  salieron bien, el título es **"No se pudo seguir la importación"** (*"No se pudo confirmar cómo
  terminaron algunas remesas de la división: pueden estar corriendo. Revisá el Historial antes de volver
  a cargar el archivo."*); si no, es el del peor resultado. Las que venían después dicen *"No se intentó
  porque no se pudo seguir la remesa anterior."* En este caso **no** se afirma que no se ejecutaron:
  pueden estar corriendo.

Los botones son **Ver detalle** (uno por remesa si fueron varias), que abre el detalle de la carga en
el Historial; **Nueva importación**, que vuelve al paso 1; e **Ir al historial**.

**Que diga "finalizada" no quiere decir que salió todo bien.** Si el título habla de filas con error,
sin filas o advertencias, entrá al detalle y mirá el motivo fila por fila.

En el **detalle** de la carga, las filas con error figuran en **Errores de fila**; si la carga solo
tuvo avisos, la tabla se llama **Avisos de la carga**. Los avisos van con **—** en lugar del número de
fila y salen primeros; una fila con error siempre lleva su número (la primera fila de datos es la 0).
Una carga que falló, terminó con advertencias o no tenía filas muestra arriba un cartel con el motivo.
El detalle muestra **solo los primeros 100** errores o avisos.

**Descartadas y filas de otros cortes.** En una remesa sin corte —el caso normal— el detalle muestra una
línea debajo de las tarjetas con *Descartadas: N* (lo que descartó el filtro de la plantilla). En una carga
dividida, cada remesa lee el archivo entero y las filas que quedan fuera de su corte no se cargan en ella: la
línea las separa en dos, por ejemplo *Descartadas por el filtro de la plantilla: 12 · De otros cortes de la
división: 14.000 (no se cargan en esta remesa)*. Una carga dividida hecha antes de que existiera este
desglose muestra solo *Descartadas: N*, y ese número puede incluir filas de otros cortes. La línea trae además
*Casos nuevos* y *Casos actualizados* cuando la categoría los informa.

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

Solo se permite **una importación por usuario a la vez**. Si tenés otra en curso, hay que esperar a que termine, o, si todavía está en cola y no arrancó, borrarla desde el Historial.

Si aparece el aviso *"No se pudo iniciar la importación: la cola de trabajos no responde. Probá de nuevo
en unos minutos."* (dura unos segundos, no queda fijo), la carga **no arrancó** y vuelve a quedar como borrador: se puede apretar
**Confirmar e importar** de nuevo.

### La carga está "En cola" y no avanza

La cola es **una sola para todos los usuarios**: *"Esperando que termine otra importación"* puede ser la
carga de otra persona, y la pantalla dice cuántas hay antes que la tuya. Si la tuya es la próxima y a los
2 minutos el servidor no la tomó, aparece el aviso *"Esta carga es la próxima de la cola…"*. Si la
que está trabada es la de **adelante**, lo único que ves es *"Hay 1 importación antes que esta"*. Esa otra
carga puede ser de otra persona o de otra empresa, y entonces no la vas a ver ni en la campanita ni en el
Historial: si la espera se alarga, avisá a soporte. La tuya no se cierra sola mientras espera. Una carga en cola que todavía no arrancó **se puede borrar** desde el Historial. Una carga que quedó en cola sin que
exista el trabajo que la procese (el servidor se reinició justo al confirmarla) se marca sola como fallida:
ver "La importación falló: qué hacer". En cambio, si el servidor se reinicia y su trabajo sí está esperando
en la cola, la carga arranca sola cuando el servidor vuelve.

### La importación falló: qué hacer

El título es **"La importación falló"**, con el motivo. Según la categoría (esto vale para una carga que
falló por un error; **si la carga se interrumpió** —el servidor se reinició o dejó de responder—, rige lo que
dice su motivo, más abajo, y no esta lista):

- **No se reintenta la misma remesa.** Una remesa que ya se ejecutó no se puede volver a ejecutar.
- **El cierre de la carga no corrió** (consolidación, ausentes, montos), aunque se hayan cargado filas
  antes del corte: el cartel dice cuántas.
- **En Deudores y en Deudores y Facturas, borrá la remesa fallida antes de volver a subir el archivo.**
  Subirlo otra vez crea una remesa nueva y los mismos clientes quedan como casos nuevos de esa remesa
  (un caso es el cliente *más* la remesa), con lo que quedarían duplicados.
- **En Pagos, no alcanza con volver a subir.** Si entraron filas antes del corte, al resubir el archivo
  esos cobros se saltean y sus casos **no se vuelven a consolidar**: consolidá desde el Historial cada
  remesa de deudores que elegiste como origen (ver la tabla de "terminó con advertencias" en
  [Historial y problemas](/ayuda/importacion/historial-y-problemas)) o avisá a soporte.
- **Otras categorías:** el cierre que no corrió es el de la misma tabla; ahí dice qué quedó pendiente y
  qué hacer.

**Si la carga se interrumpió.** Si el servidor se reinició o dejó de responder mientras procesaba, la carga
**no se vuelve a ejecutar sola**: a los pocos minutos sin señal (normalmente entre 6 y 7) se marca como
fallida, con un motivo que empieza así:

> La importación se interrumpió: el servidor se reinició o dejó de responder mientras la procesaba.

y sigue, en otro párrafo, con qué hacer según la categoría:

- **Deudores y Deudores y Facturas:** *Lo procesado hasta el corte quedó cargado en esta remesa. Eliminá
  esta importación desde el Historial y volvé a cargar el archivo. Si no se puede eliminar (porque algún
  caso ya tiene gestión o porque la remesa es muy grande), avisá a soporte antes de volver a cargarlo.* Si la remesa es un corte de un archivo dividido, el motivo agrega: *Esta remesa es un corte de un
  archivo dividido: al volver a cargarlo, tildá solo los cortes que no se cargaron. Si tildás uno que ya está
  cargado, sus casos quedan duplicados.*
- **Acciones masivas:** *Las acciones aplicadas hasta el corte quedaron hechas y **no se pueden revertir
  desde la pantalla**: los datos para deshacer se guardan recién al terminar. No vuelvas a cargar el
  archivo; avisá a soporte.*
- **Las demás categorías (incluida Pagos):** *Lo procesado hasta el corte quedó aplicado. Antes de volver a
  cargar el archivo, avisá a soporte.* En Pagos, entonces, no consolides ni resubas por tu cuenta: avisá
  primero.

Y la pantalla agrega, en otro párrafo, si se habían cargado filas: *Antes del corte se cargaron al menos N
filas…; el cierre de la carga no corrió.* Es un piso, no el número exacto: en la mayoría de las categorías
puede faltar lo del último segundo, y en Actualizaciones y Facturas el contador sube de a lotes de 1.000
filas, así que puede faltar hasta un lote.

**Si la carga era una división de Deudores o de Deudores y Facturas** (vale para la interrumpida y para la
que no llegó a empezar; en las demás categorías rige lo que dice el motivo: avisar a soporte antes de volver
a cargar). Se elimina **solo** la remesa que falló, no las demás. Las que venían después arrancan solas si la
pantalla de la carga sigue abierta y pudo confirmarlas; si el servidor se estaba reiniciando puede que no, y
entonces el resumen las lista como no ejecutadas. Para volver a cargar lo que falta, subí el archivo otra vez y **destildá los cortes que
ya se cargaron**. Para saber cuáles son, mirá en el Historial las remesas de esa división que están
FINALIZADAS: sus cortes ya están cargados. Si dejás tildado uno que ya está cargado, sus casos quedan
duplicados. Al volver a subir, el número de remesa que se propone puede no ser el de la primera vez: ver "Una
remesa de la división no arrancó".

Si no podés eliminar la remesa de Deudores interrumpida, **no vuelvas a cargar el archivo**: avisá a soporte
primero. Las causas más comunes son que no tenés el permiso, que alguno de sus casos ya tiene gestión o que
la remesa es demasiado grande (la pantalla responde *"No se pudo eliminar: la remesa es demasiado grande para
borrarla desde la pantalla. Avisá a soporte."*).

Si la carga ni siquiera llegó a empezar —quedó en la cola sin un trabajo que la procese—, el motivo tiene dos
párrafos. El primero:

> La importación no llegó a empezar: quedó en la cola sin un trabajo que la procese (el servidor se
> reinició justo al confirmarla, o la cola perdió el trabajo).

y el segundo, con qué hacer:

> No se cargó ninguna fila: volvé a importar el archivo.

Si la remesa es un corte de un archivo dividido, el segundo párrafo agrega: *Esta remesa es un corte de un
archivo dividido: al volver a cargarlo, tildá solo los cortes que no se cargaron. Si tildás uno que ya está
cargado, sus casos quedan duplicados.*

En el Historial la grilla **no se refresca sola**: el tacho de eliminar está siempre a la vista, pero se
deshabilita mientras la carga procesa. Para que se habilite en una carga que se acaba de marcar como fallida,
apretá **Actualizar**.

Si el motivo no lo entendés, avisá a soporte con el número de remesa.

### Una remesa de la división no arrancó

Hay dos formas de enterarse:

- **La pantalla seguía abierta y el pedido se rechazó.** El resumen muestra un cartel rojo *"1 remesa de
  la división no se ejecutó"* (o *"N remesas de la división no se ejecutaron"*) con el motivo de cada
  una. Las que venían después de la que falló dicen *"No se intentó porque la remesa anterior no
  arrancó."*
- **Se cerró, se recargó o se abandonó la pantalla** mientras corría la remesa anterior. **No hay
  resumen**: las que faltaban quedan en el Historial como **PENDIENTE** (o VALIDANDO), y recién al
  entrar al detalle dicen **Borrador**.

En los dos casos esas remesas ocupan su número y **no se pueden lanzar desde ningún lado**. Hay que
**borrarlas** y volver a subir el archivo **destildando los cortes que ya se cargaron**. Ojo con el
número: el Nº de remesa que se propone al volver a subir puede no ser el de la primera vez (después de
una división el correlativo salta); hay que escribir el que tenía, que queda libre al borrar el
borrador.

Si el resumen dio por no ejecutada una remesa pero el mensaje es de red (por ejemplo, *"Network Error"*),
puede que el pedido haya llegado igual: **revisá su detalle antes de borrarla**.

### Se cargaron menos casos que filas

Ver el control de arriba.

### La importación quedó "procesando" y no avanza

Mirá el detalle desde el historial. Hay dos casos distintos:

- **El servidor no da señales** (se reinició o se cayó): a los 2 minutos la pantalla avisa *"El servidor no
  da señales de esta carga…"* y, si no se recupera, la carga se marca sola como **fallida** a los pocos
  minutos (normalmente entre 6 y 7). No se vuelve a ejecutar sola. Cuando falla, podés hacer otras
  importaciones; con esta, lo que hay que hacer lo dice el motivo (ver "La importación falló: qué hacer").
  Si pasaron 15 minutos sin señal y la pantalla sigue igual, avisá a soporte: el aviso pasa a decir que
  todavía no se marcó como fallida.
- **El servidor da señales pero la carga no avanza** (un paso larguísimo o trabado): a los 10 minutos sin
  cambios, la pantalla avisa *"El servidor sigue trabajando, pero esta carga no muestra avances…"*. Esta
  carga **no se marca fallida sola**: avisá a soporte. Mientras esté procesando no se puede borrar.

### Importé el archivo equivocado

Ver [Historial y problemas](/ayuda/importacion/historial-y-problemas). La respuesta corta: **depende
de la categoría**, y no siempre se puede deshacer.

---

## Preguntas frecuentes

**¿Puedo importar el mismo archivo dos veces?**
Depende de la categoría. Una remesa ya ejecutada **no se puede volver a ejecutar**: importar de nuevo
crea **otra remesa**. En Deudores y en Deudores y Facturas eso significa que los mismos clientes quedan como casos nuevos de la
remesa nueva (un caso es el cliente más la remesa), no que se actualicen los anteriores; si la primera
carga falló, borrá esa remesa antes de volver a subir. En Pagos hay un anti-duplicados: si la plantilla mapea el **ID del cobro
en el sistema del cedente**, el mismo cobro no entra dos veces y un archivo acumulativo se puede
recargar cuantas veces haga falta. Si el cedente no manda identificador, el criterio es mismo caso,
mismo día y mismo importe. Ver [Las categorías](/ayuda/importacion/categorias).

**¿Puedo cerrar el navegador mientras carga?**
Sí, **salvo en una carga dividida**: la carga corre en el servidor, pero cada remesa siguiente la
arranca la pantalla. Si la cerrás, la recargás o te vas a otra pantalla, las que faltan no arrancan
(ver "Una remesa de la división no arrancó").

**¿Qué pasa si el archivo tiene filas con error?**
Las que están bien se cargan igual. Las que fallan quedan registradas con su motivo y se pueden
revisar desde el historial.

**¿La vista previa me muestra todo el archivo?**
Muestra las primeras 50 filas. El **Total** sí es del archivo completo; los contadores de OK y error
son de esa muestra.

**¿Dónde veo los errores después?**
En Importación de Datos → **Historial**, entrando a la remesa. El botón **Ver detalle** del paso 5 te
lleva directo a esa pantalla.
