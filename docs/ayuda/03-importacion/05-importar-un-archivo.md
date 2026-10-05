<!--
seccion: Importación de datos
resumen: El asistente de carga, paso a paso, y qué mirar en la vista previa antes de confirmar.
revisado: 2026-10-05
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
**sobre el mismo archivo** (no se sube ni se guarda varias veces). La vista previa y el **Total** son
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
plantilla descartó todas, el aviso agrega *"El filtro de la plantilla descartó las N filas."* Hay que
revisar el archivo o el filtro de la plantilla. Ojo: la remesa ya se creó al pasar al paso 3, así que si
volvés atrás **queda en el Historial como PENDIENTE o VALIDANDO, ocupando su número**; borrala si no la
vas a usar.

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

La pantalla se llama **"Ejecutando importación"** y muestra en qué fase está la carga:

| Fase | Qué dice la pantalla |
|---|---|
| Recién confirmada | *Enviando a la cola…* |
| En cola | **En cola** — *Esperando que termine otra importación.* Barra sin porcentaje |
| Procesando | **Procesando**, con el porcentaje y los contadores: **Total**, **Procesadas**, **OK**, **Errores** y **Descartadas** (los dos últimos solo si son más de cero). Si todavía no se sabe cuántas filas son, la barra no muestra porcentaje |
| Post-proceso | **Post-proceso** — *Consolidando y cerrando la carga. Puede tardar varios minutos.* Barra sin porcentaje |

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
- *"Sin novedades del servidor hace N min. La carga puede estar en un paso largo o haberse
  interrumpido."* — aparece cuando el último latido del servidor es de hace 5 minutos o más, mientras la
  carga está procesando. La edad se mide con la hora del servidor: si abrís la pantalla sobre una carga
  que ya estaba colgada, avisa enseguida (no hay que esperar 5 minutos con la pantalla abierta) y no
  depende del reloj de tu PC. No aparece en cola ni en post-proceso. Una carga que se interrumpe **no
  falla sola**: si el aviso crece, avisá a soporte.
- *"Esta carga se reinició (intento N)."* — el servidor volvió a tomar la carga desde el principio.

## Paso 5 — Resultado

Cuando la carga termina, la pantalla dice cómo terminó, con un título y, si corresponde, un detalle:

| Título | Cuándo | Detalle |
|---|---|---|
| **Importación exitosa** | Ninguna fila dio error. No quiere decir que todas se hayan cargado: en Acciones masivas una fila que no encuentra ningún caso, y en Pagos un cobro que ya estaba cargado (se saltea), no son errores y cuentan como exitosas | — |
| **Importación finalizada con filas con error** | Entraron algunas y otras no | *N de M filas no se cargaron. Mirá el motivo de cada una en el detalle.* |
| **No se cargó ninguna fila** | Todas las filas dieron error | *Las N filas dieron error.* |
| **El archivo no tenía filas para procesar** | No había filas para cargar | Si el filtro de la plantilla las descartó: *El filtro de la plantilla descartó las N filas.* |
| **Importación finalizada con advertencias** | Las filas se cargaron, pero el post-proceso (consolidar, cerrar ausentes, recalcular montos) no terminó. Gana sobre "filas con error": puede haber filas con error y salir con este título | *Se cargaron N filas[ y M dieron error]. Pero el post-proceso no terminó: …* y, según la categoría, qué quedó sin hacer y qué hacer (tabla en [Historial y problemas](08-historial-y-problemas.md)). Termina con *"No hace falta volver a subir el archivo."* |
| **La importación falló** | La carga se cortó | El motivo. Si antes del corte se habían cargado filas: *Antes del corte se cargaron N filas[ y M dieron error]; el cierre de la carga no corrió.* N son las exitosas |

Una carga que falló **nunca** se muestra como exitosa. Debajo del título van las métricas **Filas
procesadas**, **Exitosas**, **Con error** y **Descartadas** (las dos últimas solo si hay), y la **Tasa
de éxito** cuando se procesó alguna fila y la carga no falló.

Si la carga registró avisos que no son errores de fila, la pantalla agrega *"N avisos del archivo — ver
el detalle"*. Cuenta los avisos de lectura del archivo (`[parseo]`), los que escriben las propias
categorías al cargar (`[aviso]`, por ejemplo los de Pagos con número de convenio y los de Claves de
pago) y el del post-proceso que no terminó (`[post-proceso]`). Pueden aparecer aunque ninguna fila haya
dado error.

**Carga dividida:** el título es el del **peor** resultado de las remesas, y debajo hay **una fila por
remesa** con su número, su resultado y sus contadores. No se muestra **Descartadas** (incluiría las filas
fuera del corte de cada remesa) y, si alguna remesa falló, tampoco la **Tasa de éxito**.

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

**Dos números que no hay que sumar con el de otra remesa.** En una carga dividida, las filas que quedan
fuera del corte de cada remesa cuentan como "descartadas" de esa remesa; por eso en ese caso la pantalla
no muestra **Descartadas**.

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
carga de otra persona. Mientras no arrancó, el aviso de "sin novedades" no aparece (solo se muestra
procesando). Una carga en cola que todavía no arrancó **se puede borrar** desde el Historial.

### La importación falló: qué hacer

El título es **"La importación falló"**, con el motivo. Según la categoría:

- **No se reintenta la misma remesa.** Una remesa que ya se ejecutó no se puede volver a ejecutar.
- **El cierre de la carga no corrió** (consolidación, ausentes, montos), aunque se hayan cargado filas
  antes del corte: el cartel dice cuántas.
- **En Deudores y en Deudores y Facturas, borrá la remesa fallida antes de volver a subir el archivo.**
  Subirlo otra vez crea una remesa nueva y los mismos clientes quedan como casos nuevos de esa remesa
  (un caso es el cliente *más* la remesa), con lo que quedarían duplicados.
- **En Pagos, no alcanza con volver a subir.** Si entraron filas antes del corte, al resubir el archivo
  esos cobros se saltean y sus casos **no se vuelven a consolidar**: consolidá desde el Historial cada
  remesa de deudores que elegiste como origen (ver la tabla de "terminó con advertencias" en
  [Historial y problemas](08-historial-y-problemas.md)) o avisá a soporte.
- **Otras categorías:** el cierre que no corrió es el de la misma tabla; ahí dice qué quedó pendiente y
  qué hacer.

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

Mirá el detalle desde el historial: si pasan 5 minutos sin novedades, la pantalla lo avisa. **Una carga
colgada no falla sola** y no se puede borrar mientras esté procesando. Si el servidor se reinició, es
posible que se retome desde el principio una vez (aparece *"Esta carga se reinició (intento 2)"*). Si el
aviso sigue creciendo y no avanza, avisá a soporte.

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
