<!--
seccion: Administración
resumen: Cuánto cuesta amaIA, cómo se controla el gasto por función y cómo usar las respuestas con 👎 para mejorar la Documentación.
revisado: 2026-10-20
rutas: /asistente/consumo
rutaPrincipal: /asistente/consumo
-->
# Consumo de amaIA

## Para qué sirve

Es la pantalla de quien administra [amaIA](/ayuda/primeros-pasos/el-asistente). Tiene tres usos:

1. **Controlar la plata**: cuánto se gastó en el mes, cuánto se va a gastar al ritmo actual y cuándo se pausa.
2. **Ver quién y cuánto lo usa.**
3. **Encontrar lo que hay que mejorar en la Documentación**: las respuestas que la gente marcó con 👎 y las
   preguntas que la Documentación no contesta.

## Antes de empezar

El permiso **Administrar amaIA**. Con él aparece, en el menú **Administración**, el ítem **Consumo de
amaIA**. Ver [Roles y permisos](/ayuda/administracion/roles-y-permisos).

## Los indicadores de arriba

El selector **Mes** cambia el período de todo lo que ves. Al entrar muestra el mes en curso.

| Indicador | Qué dice |
|---|---|
| **Gasto del mes** | Lo gastado contra el tope mensual, en dólares y en porcentaje, con una barra. La barra se pone **amarilla** al llegar al porcentaje de aviso y **roja** al llegar al 100 % |
| **Proyección a fin de mes** | Lo gastado hasta hoy, dividido por los días que pasaron y multiplicado por los días del mes. Al principio del mes varía mucho: un día con mucho uso lo dispara |
| **Preguntas** | Cuántas preguntas se hicieron, cuántas personas y cuántas llamadas al modelo (una pregunta puede necesitar más de una, por ejemplo si lee una página de la Documentación) |
| **Costo por pregunta** | El gasto dividido por las preguntas |
| **Respuestas que sirvieron** | El porcentaje de 👍 sobre las respuestas calificadas, y cuántas hay sin calificar. Si nadie votó, dice "Sin votos" |
| **Tasa de caché** | Qué parte de lo que lee el modelo ya la tenía guardada. Cuanto más alta, más barato sale cada pregunta |

### Cómo se calcula el costo

Cada llamada al modelo se paga según lo que lee y lo que escribe, con **precios por millón de tokens** que se
ven y se editan más abajo, en **Configuración**. El costo de cada llamada queda registrado, aunque la pregunta
se corte o falle: **el gasto no se pierde**.

Si el modelo en uso no tiene precio, amaIA **no responde** (queda pausada) en vez de contar el gasto en
cero. Si cambiás un precio, vale para las llamadas siguientes, no cambia lo ya registrado.

## Los avisos y el tope

- **Tope mensual**: al llegar al 100 %, amaIA se **pausa para todos**. Vuelve el día 1.º del mes
  siguiente, o antes si subís el tope. Una respuesta que ya está en curso al llegar al tope puede quedar cortada.
- **Aviso**: al llegar al porcentaje configurado (80 % por defecto), le llega una **notificación** a cada
  persona con el permiso *Administrar amaIA*. Se avisa **una sola vez por mes**; subir el tope no
  vuelve a avisar.
- **Tope por función**: en la tabla **Por función** hay dos funciones, *Ayuda y navegación* y *Constructor de
  reportes* (el modo **Armar un reporte** de amaIA, ver
  [Armar un reporte con amaIA](/ayuda/reportes/armar-con-el-asistente)). Cada una tiene su
  **interruptor**, su **tope mensual**, su **tope por pregunta** y sus **pedidos por persona y día**, y debajo
  del nombre se ve **qué modelo usa**. En el tope mensual, vacío significa "sin tope propio": rige el general. En el tope por pregunta y en los pedidos por día, los campos de *Constructor de reportes* muestran el valor que **rige** (el que configuraste, o el de arranque de la función), y vaciarlos vuelve a ese valor de arranque. El tope por pregunta va de 0,005 a 2 y los pedidos por día, de 1 a 1.000. Con la
  función apagada, la gente ve el mismo cartel de *"amaIA está pausada por un administrador"*; al llegar
  al tope de la función, ven uno que dice que **esa función** llegó a su tope.
- **Tope por pregunta**: el gasto máximo de una sola respuesta. Corta las que se descontrolan. Cuando pasa, la
  persona ve la respuesta cortada, no un error. **Cada función puede tener el suyo.** El de la ayuda es chico
  (centavos), y **no le sirve a reportes**: armar una plantilla hace varias llamadas al modelo (probarla, corregirla,
  mostrarla), y con ese tope se cortaría después de la primera prueba. Por eso *Constructor de reportes* tiene su
  tope propio, más alto.
- **Preguntas por persona por día**: protege contra errores y bucles; no es un cupo. También **por función**:
  el límite de *Constructor de reportes* cuenta pedidos de reportes, que además suman al límite general de cada persona.

> **Los valores de arranque de reportes** son un tope por pregunta de **US$ 0,30** y **40 pedidos por persona por
> día**. El tope mensual **no viene cargado**: se recomienda **US$ 30** y hay que escribirlo en la tabla; mientras
> tanto rige solo el general. La función arranca **apagada**: la prende quien administra, desde esta tabla,
> y conviene hacerlo primero para pocas personas.
> **Un pedido de reportes cuesta unas 30 veces lo que una pregunta de ayuda**: usa un modelo más potente, lleva
> el catálogo de campos entero y prueba la plantilla contra la base. Armar una plantilla suele salir entre
> US$ 0,07 y 0,20, ajustes incluidos.

Varias personas pueden preguntar al mismo tiempo, así que el gasto puede pasar un poco del tope antes de que
la pausa llegue a todas. Además puede haber un presupuesto aparte en AWS, configurado por quien administra la
cuenta, por si algo gasta sin pasar por acá. Es independiente de esta pantalla: no se mueve con el tope de acá
ni tiene por qué avisar al mismo momento.

Si ves el cartel **Nadie tiene el permiso Administrar amaIA**, los avisos no le llegan a nadie: asigná el
permiso a algún rol (ver [Roles y permisos](/ayuda/administracion/roles-y-permisos)) y pedile a esa persona que
vuelva a entrar.

## Pausar amaIA

En **Configuración**, apagá el interruptor general y apretá **Guardar**. Cada persona ve un cartel que dice que
amaIA está pausada por un administrador. Para volver, encendela y guardá. La pausa vale para todos, no
hay forma de pausarla para una sola persona.

## Las tablas

- **Por día**: un gráfico de barras con el gasto y las preguntas de cada día.
- **Por función**: gasto, preguntas, un interruptor para activar o desactivar la función y sus tres valores
  editables —tope mensual, tope por pregunta y pedidos por persona y día—, cada uno con su botón para guardarlo.
  Los dos últimos son números: el tope por pregunta admite decimales y el de pedidos tiene que ser un entero.
- **Tiempos por paso**: cuánto tarda cada parte de una respuesta (ver *Los tiempos de cada paso*, más abajo).
- **Plantillas armadas con amaIA**: aparece siempre; sin uso, con ceros. Cuenta, por función:
  cuántas propuestas se **mostraron**, cuántas se **abrieron en el editor** y cuántas se **guardaron** (con el
  porcentaje de las mostradas), qué porcentaje de las guardadas **no se cambió** en el editor y cuánto salió cada
  **plantilla guardada** en promedio. Sirve para saber si el modo da resultado: si se muestran muchas y se guardan
  pocas, las propuestas no están convenciendo; si casi todas se guardan sin tocar, la propuesta ya sale bien.
- **Por persona**: las 50 personas que más gastaron en el mes.

## Los tiempos de cada paso

La tarjeta **Tiempos por paso** responde a "¿por qué amaIA está lenta?". Para cada función hay una tabla con
una fila por paso de la respuesta (la preparación, la llamada al modelo, la espera del primer token, el
razonamiento, la respuesta, cada herramienta, guardar) y, arriba de todo, el **total en el servidor** y el **total y
el primer texto en el navegador** de la gente. Las columnas son:

| Columna | Qué dice |
|---|---|
| **Paso** | Qué parte de la respuesta es. Las herramientas llevan su nombre: *Herramienta leer_pagina*. |
| **Veces** | Cuántas veces se midió ese paso en el mes. Una respuesta puede tener más de una llamada o más de una herramienta, por eso este número no es el de respuestas |
| **Mediana** | El tiempo típico: la mitad de las veces tardó menos que esto y la otra mitad, más |
| **p95** | El tiempo de los días malos: el 95 % de las veces tardó esto o menos. Una de cada veinte tardó más |

Un ejemplo: si **Total en el servidor** dice mediana 4,1 s y p95 9,8 s, una respuesta común tarda unos 4 segundos,
pero una de cada veinte tarda más de casi 10. Si la mediana está bien y el p95 se disparó, el problema es de
algunos casos (una herramienta lenta, una espera larga a veces), no de todos. Para ver cuál, bajá por las filas
hasta encontrar el paso cuyo p95 se parece al del total.

**Qué no cuenta.** Para que los tiempos reflejen el trabajo normal:

- Una **respuesta que no terminó bien** **no suma en ningún «Total»**, ni el del servidor ni el del navegador. Son
  las que la persona **detuvo**, las cortadas por un tope, las que fallaron o vencieron por tiempo, las **cortadas
  por largo** y las que amaIA **se negó a contestar**.
- Una **llamada al modelo que no terminó bien** no suma en **Llamada** ni en los pasos de adentro (espera,
  razonamiento, respuesta y pedido): la detenida, la que no se hizo por un tope, la que venció por tiempo y la que
  dio error. Una llamada **cortada por largo** sí cuenta: su tiempo es real.
- Los pasos que **sí terminaron** (la preparación, las herramientas que no quedaron a medias y guardar) **cuentan
  siempre**, aunque la respuesta haya salido mal.

**De dónde salen.** Del detalle que se guarda con cada respuesta (ver
[amaIA](/ayuda/primeros-pasos/el-asistente), sección *El detalle de cada respuesta*). Ese detalle se borra
**a los 90 días**, junto con la conversación, así que la tabla de un mes viejo solo cuenta lo que no se borró. Si
en el mes hay más de 5.000 respuestas, la tarjeta lo avisa y trabaja con las últimas 5.000.

**Para qué sirve.** Para saber *qué* se volvió lento: una herramienta (por ejemplo, la prueba de una plantilla
contra la base), la espera del primer token (el servicio que genera las respuestas anda lento) o el guardado.
Los tiempos de una sola respuesta, paso por paso, se ven en su propio detalle.

Esta tarjeta la ve quien tiene **Administrar amaIA**: son números agregados, sin el contenido de ninguna
conversación.

## Respuestas con 👎: cómo mejorar la Documentación

Muestra las **últimas 20** respuestas con 👎: cuándo, quién, qué preguntó, qué respondió amaIA (con
**Ver completa** para leerla entera), lo que la persona escribió en "¿Qué faltó?" y las páginas en las que se
apoyó.

Al lado del título hay un contador: **No está en la documentación**. Cuenta las respuestas en las que el
amaIA dijo que el tema no está escrito. Es la lista de huecos de la Documentación: cada una es una página
que falta o una que no se encuentra.

Si además tenés el permiso **Ver el detalle de las respuestas de amaIA**, al lado de **Ver completa** aparece el
botón **Ver detalle**. Abre debajo el detalle de esa respuesta (los pasos que hizo, con su tiempo y su costo), para ver
si salió lenta o cara. El botón pide **los dos permisos** —*Administrar amaIA* y *Ver el detalle de las
respuestas de amaIA*—; con uno solo no aparece. No depende del interruptor del panel de amaIA. Si el
permiso se perdió con la sesión abierta, un cartel lo avisa.

Cómo usarlo: mirá los 👎 con regularidad, y por cada uno decidí si el problema es de la **Documentación**
(falta, está desactualizada o es confusa) o de **amaIA** (la página estaba bien y lo entendió mal). Lo
primero se arregla escribiendo la página; lo segundo se anota y se avisa.

> La gente sabe que las respuestas con 👎 las puede leer quien administra amaIA (lo dice la página
> [amaIA](/ayuda/primeros-pasos/el-asistente)). Es para mejorar la Documentación. Las respuestas con 👍 y sin voto **no se ven** acá, sino solo como números.

Ojo con el período: los números de calidad (**Respuestas que sirvieron**, **No está en la documentación** y esta
lista de 👎) se calculan a partir de las conversaciones, que se borran a los 90 días. Un mes viejo muestra
menos votos de los que hubo, o ninguno. El **gasto**, en cambio, se conserva 400 días.

## Las conversaciones se guardan 90 días

Pasado ese tiempo se borran solas, con todas sus preguntas y respuestas. Los **números de gasto se conservan
400 días** (el gasto del mes no cambia por una limpieza), aunque ya no queden las conversaciones. Los de
**calidad** (votos, preguntas sin documentar y la lista de 👎) salen de las conversaciones, así que se van con
ellas a los 90 días.

## Configuración

| Campo | Para qué |
|---|---|
| **Interruptor general** | Activa o pausa amaIA para todos |
| **Tope mensual** | En dólares. Entre 0 y 10.000, hasta 2 decimales |
| **Avisar al llegar a** | El porcentaje del tope en que se avisa. Entre 10 y 99 |
| **Preguntas por persona por día** | Entre 1 y 1.000 |
| **Tope por pregunta** | En dólares. Entre 0,005 y 1, hasta 4 decimales |
| **Precios del modelo en uso** | Entrada, salida y caché, en dólares por millón de tokens. Algunos modelos tienen un precio aparte para los prompts largos |

El botón **Guardar** se habilita cuando hay un cambio y todos los valores son válidos. Los cambios quedan
registrados en [Auditoría](/ayuda/administracion/auditoria).

## Qué puede salir mal

**La pantalla dice "No se pudo cargar el consumo de amaIA".** Probá con **Reintentar**. Si sigue, es un problema del
servidor.

**Subí el tope y amaIA sigue pausada.** Revisá el cartel de arriba: si dice que la pausó un
administrador, hay que encender el interruptor general. El tope y el interruptor son dos cosas distintas. Si
sigue igual, revisá **el interruptor y el tope de la función** en la tabla **Por función**: una función apagada
o que llegó a su tope pausa amaIA aunque el general esté bien. Si dice que falta configuración (la
Documentación o el precio del modelo), es un problema técnico.

**El gasto de acá no coincide con la factura de AWS.** Esta pantalla muestra lo que el sistema calcula con los
precios de la tabla; la factura puede traer otros conceptos o tardar días en reflejar el mes. La diferencia
normal es de centavos; si es grande, revisá que los precios cargados sean los vigentes.

**La tabla de tiempos está vacía en un mes viejo.** Los tiempos salen del detalle de las respuestas, que se borra a los
90 días con su conversación. Un mes de hace más de tres meses ya no tiene qué mostrar, aunque el **gasto** de ese mes
sí se conserve. En el mes en curso, también puede estar vacía los primeros días: se llena a medida que se hacen
preguntas.

**Falla la tarjeta de tiempos y el resto de la pantalla anda.** La tarjeta se carga aparte. Apretá **Reintentar**
dentro de ella; el consumo y el gasto no dependen de eso.

**Alguien me dice que amaIA "no le responde".** Mirá el cartel de pausa, y mirá si esa persona llegó al
límite de preguntas del día.

**Alguien me cuenta que le aparece "Llegaste al límite de … pedidos de reportes de hoy".** Es el límite propio de
*Constructor de reportes* (40 por defecto). Se sube en la tabla **Por función**, en la fila de *Constructor de reportes*, columna "Pedidos por persona y día".
Si el cartel dice "…preguntas de hoy", puede ser el límite **general** (se cambia en **Configuración**, en "Preguntas por
persona por día") o el propio de *Ayuda y navegación*, si se le cargó uno en la tabla **Por función**. Fijate en las dos.

**Armar un reporte se corta enseguida con "Me quedé sin margen de gasto".** El tope por pregunta de *Constructor
de reportes* quedó bajo para ese pedido (por ejemplo, un archivo de ejemplo con muchas columnas). Subilo en la
tabla **Por función**.

**El modo Armar un reporte no aparece para alguien.** Le falta algún permiso (ver
[Roles y permisos](/ayuda/administracion/roles-y-permisos)). Si la función está apagada, el selector aparece igual y
dice que amaIA está pausada por un administrador.
