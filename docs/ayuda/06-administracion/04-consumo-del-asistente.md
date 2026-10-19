<!--
seccion: Administración
resumen: Cuánto cuesta el asistente, cómo se controla el gasto por función y cómo usar las respuestas con 👎 para mejorar la Documentación.
revisado: 2026-10-19
rutas: /asistente/consumo
rutaPrincipal: /asistente/consumo
-->
# Consumo del asistente

## Para qué sirve

Es la pantalla de quien administra el [asistente](/ayuda/primeros-pasos/el-asistente). Tiene tres usos:

1. **Controlar la plata**: cuánto se gastó en el mes, cuánto se va a gastar al ritmo actual y cuándo se pausa.
2. **Ver quién y cuánto lo usa.**
3. **Encontrar lo que hay que mejorar en la Documentación**: las respuestas que la gente marcó con 👎 y las
   preguntas que la Documentación no contesta.

## Antes de empezar

El permiso **Administrar el asistente**. Con él aparece, en el menú **Administración**, el ítem **Consumo del
asistente**. Ver [Roles y permisos](/ayuda/administracion/roles-y-permisos).

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

Si el modelo en uso no tiene precio, el asistente **no responde** (queda pausado) en vez de contar el gasto en
cero. Si cambiás un precio, vale para las llamadas siguientes, no cambia lo ya registrado.

## Los avisos y el tope

- **Tope mensual**: al llegar al 100 %, el asistente se **pausa para todos**. Vuelve el día 1.º del mes
  siguiente, o antes si subís el tope. Una respuesta que ya está en curso al llegar al tope puede quedar cortada.
- **Aviso**: al llegar al porcentaje configurado (80 % por defecto), le llega una **notificación** a cada
  persona con el permiso *Administrar el asistente*. Se avisa **una sola vez por mes**; subir el tope no
  vuelve a avisar.
- **Tope por función**: en la tabla **Por función** hay dos funciones, *Ayuda y navegación* y *Constructor de
  reportes* (el modo **Armar un reporte** del asistente, ver
  [Armar un reporte con el asistente](/ayuda/reportes/armar-con-el-asistente)). Cada una tiene su
  **interruptor**, su **tope mensual**, su **tope por pregunta** y sus **pedidos por persona y día**, y debajo
  del nombre se ve **qué modelo usa**. En el tope mensual, vacío significa "sin tope propio": rige el general. En el tope por pregunta y en los pedidos por día, los campos de *Constructor de reportes* muestran el valor que **rige** (el que configuraste, o el de arranque de la función), y vaciarlos vuelve a ese valor de arranque. El tope por pregunta va de 0,005 a 2 y los pedidos por día, de 1 a 1.000. Con la
  función apagada, la gente ve el mismo cartel de *"El asistente está pausado por un administrador"*; al llegar
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

Si ves el cartel **Nadie tiene el permiso Administrar el asistente**, los avisos no le llegan a nadie: asigná el
permiso a algún rol (ver [Roles y permisos](/ayuda/administracion/roles-y-permisos)) y pedile a esa persona que
vuelva a entrar.

## Pausar el asistente

En **Configuración**, apagá el interruptor general y apretá **Guardar**. Cada persona ve un cartel que dice que
el asistente está pausado por un administrador. Para volver, encendelo y guardá. La pausa vale para todos, no
hay forma de pausarlo para una sola persona.

## Las tablas

- **Por día**: un gráfico de barras con el gasto y las preguntas de cada día.
- **Por función**: gasto, preguntas, un interruptor para activar o desactivar la función y sus tres valores
  editables —tope mensual, tope por pregunta y pedidos por persona y día—, cada uno con su botón para guardarlo.
  Los dos últimos son números: el tope por pregunta admite decimales y el de pedidos tiene que ser un entero.
- **Plantillas armadas con el asistente**: aparece siempre; sin uso, con ceros. Cuenta, por función:
  cuántas propuestas se **mostraron**, cuántas se **abrieron en el editor** y cuántas se **guardaron** (con el
  porcentaje de las mostradas), qué porcentaje de las guardadas **no se cambió** en el editor y cuánto salió cada
  **plantilla guardada** en promedio. Sirve para saber si el modo da resultado: si se muestran muchas y se guardan
  pocas, las propuestas no están convenciendo; si casi todas se guardan sin tocar, la propuesta ya sale bien.
- **Por persona**: las 50 personas que más gastaron en el mes.

## Respuestas con 👎: cómo mejorar la Documentación

Muestra las **últimas 20** respuestas con 👎: cuándo, quién, qué preguntó, qué respondió el asistente (con
**Ver completa** para leerla entera), lo que la persona escribió en "¿Qué faltó?" y las páginas en las que se
apoyó.

Al lado del título hay un contador: **No está en la documentación**. Cuenta las respuestas en las que el
asistente dijo que el tema no está escrito. Es la lista de huecos de la Documentación: cada una es una página
que falta o una que no se encuentra.

Cómo usarlo: mirá los 👎 con regularidad, y por cada uno decidí si el problema es de la **Documentación**
(falta, está desactualizada o es confusa) o del **asistente** (la página estaba bien y lo entendió mal). Lo
primero se arregla escribiendo la página; lo segundo se anota y se avisa.

> La gente sabe que las respuestas con 👎 las puede leer quien administra el asistente (lo dice la página
> [El asistente](/ayuda/primeros-pasos/el-asistente)). Es para mejorar la Documentación. Las respuestas con 👍 y sin voto **no se ven** acá, sino solo como números.

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
| **Interruptor general** | Activa o pausa el asistente para todos |
| **Tope mensual** | En dólares. Entre 0 y 10.000, hasta 2 decimales |
| **Avisar al llegar a** | El porcentaje del tope en que se avisa. Entre 10 y 99 |
| **Preguntas por persona por día** | Entre 1 y 1.000 |
| **Tope por pregunta** | En dólares. Entre 0,005 y 1, hasta 4 decimales |
| **Precios del modelo en uso** | Entrada, salida y caché, en dólares por millón de tokens. Algunos modelos tienen un precio aparte para los prompts largos |

El botón **Guardar** se habilita cuando hay un cambio y todos los valores son válidos. Los cambios quedan
registrados en [Auditoría](/ayuda/administracion/auditoria).

## Qué puede salir mal

**La pantalla dice "No se pudo cargar el consumo del asistente".** Probá con **Reintentar**. Si sigue, es un problema del
servidor.

**Subí el tope y el asistente sigue pausado.** Revisá el cartel de arriba: si dice que lo pausó un
administrador, hay que encender el interruptor general. El tope y el interruptor son dos cosas distintas. Si
sigue igual, revisá **el interruptor y el tope de la función** en la tabla **Por función**: una función apagada
o que llegó a su tope pausa el asistente aunque el general esté bien. Si dice que falta configuración (la
Documentación o el precio del modelo), es un problema técnico.

**El gasto de acá no coincide con la factura de AWS.** Esta pantalla muestra lo que el sistema calcula con los
precios de la tabla; la factura puede traer otros conceptos o tardar días en reflejar el mes. La diferencia
normal es de centavos; si es grande, revisá que los precios cargados sean los vigentes.

**Alguien me dice que el asistente "no le responde".** Mirá el cartel de pausa, y mirá si esa persona llegó al
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
dice que el asistente está pausado por un administrador.
