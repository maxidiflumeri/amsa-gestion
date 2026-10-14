<!--
seccion: Importación de datos
resumen: Ver qué pasó con una carga, revisar los errores fila por fila, y qué se puede deshacer y qué no.
revisado: 2026-10-14
rutas: /historial-importaciones
rutaPrincipal: /historial-importaciones
-->
# Historial y problemas

## Para qué sirve

**Importación de Datos → Historial** lista todas las cargas de una empresa: cuándo se hicieron, con
qué plantilla, cuántas filas entraron y cuántas fallaron. Es donde se va a ver qué pasó y, cuando se
puede, a deshacerlo.

## Antes de empezar

- El permiso **Ver historial de importaciones**. Hace falta para todo lo de esta pantalla, incluso
  borrar y revertir.
- Para borrar, además **Eliminar importaciones** — y **solo podés borrar las tuyas**, salvo que tengas
  el permiso para ver importaciones de otros.
- Para **Cancelar**, **Retomar** y **Confirmar**, el permiso para ejecutar importaciones, y que la carga sea
  tuya o que tengas el permiso para ver importaciones de otros.
- Para revertir acciones masivas, el permiso de **acciones masivas**.
- Para consolidar, **Ejecutar consolidación de situación**.

---

## Cómo se ve cada carga

La grilla dice el estado **real** de cada carga, el mismo que ves en su detalle, y se actualiza sola mientras la
mirás (ver "Cuánto tarda en actualizarse", más abajo). Por cada importación muestra el nombre, el número, el corte
si lo tiene, el nombre del archivo si el sistema lo guardó (hoy, solo en las cargas de varios archivos), la
categoría, el estado, las filas, la fecha, la política y los botones.

| Estado | Qué significa |
|---|---|
| **Borrador** | Subiste el archivo y viste la vista previa, pero no confirmaste. No se cargó nada. Debajo dice *"Vista previa sin confirmar."* |
| **No se pudo encolar** | Confirmaste y la cola de trabajos no respondió. No se cargó nada. Se manda a la cola desde el Historial con **Confirmar** (ver más abajo) |
| **En cola** | Confirmada y esperando su turno. Debajo dice la posición: *"Es la próxima: empieza en instantes."* o *"Hay N importaciones antes que esta."* |
| **Leyendo el archivo** · **Procesando N %** · **Post-proceso** | En curso. Procesando muestra *"3.000 de 14.466"* y, si se puede calcular, cuánto falta. Debajo del estado hay una barra fina |
| **Cancelando…** | Alguien pidió cancelarla y todavía no cortó: se corta al terminar la fila o el lote en curso |
| **Cancelada** · **Cancelada antes de empezar** | La cortó una persona. Lo ya procesado quedó cargado (en la que se canceló antes de empezar, no se cargó nada) |
| **No llegó a empezar** · **Fallida** | Se cortó sin una cancelación. La primera no cargó ninguna fila. Si el servidor se reinició o dejó de responder mientras procesaba, la carga se marca sola como fallida a los pocos minutos |
| **Con advertencias** | Las filas se cargaron, pero el cierre de la carga (el post-proceso) no terminó |
| **Finalizada con errores** | Cargó filas y algunas dieron error |
| **Sin filas cargadas** | Terminó, pero todas las filas dieron error |
| **Sin filas** | El archivo no tenía filas para procesar |
| **Finalizada** | Terminó sin problemas |

En una carga de **Acciones masivas**, si se pidió revertirla, debajo del estado aparece el de la **reversión**: **En cola**,
**Revirtiendo 40 %**, **Revertida**, **Reversión interrumpida: H de T** (cuántos cambios alcanzó a deshacer de cuántos, y el
motivo) o **La reversión falló**. Se actualiza sola, igual que las cargas.

En las que ya terminaron mal o con salvedades (de **Cancelada** a **Sin filas**), pasando el mouse por el estado ves
el título del resultado y la primera línea del motivo; el motivo entero está en el detalle. Si una carga no se
puede retomar porque su corte ya figura en otra remesa, la grilla lo dice debajo del estado.

La columna **Filas** muestra, en las cargas que terminaron, el total de filas procesadas, cuántas entraron y cuántas
dieron error (*"Filas: total / OK / con error"*; en Claves de pago, *"Trámites: total / válidos / rechazados"*). En
una carga interrumpida son un piso: lo que se alcanzó a contar. En las demás dice **—**.

**Finalizada no significa "salió bien"**: significa que terminó. Mirá siempre la columna de filas y el
resultado que mostró el paso 5 (ver [Importar un archivo](/ayuda/importacion/importar-un-archivo)). Una carga
cancelada dice **Cancelada**, no fallida; en su detalle y en la notificación también (es una notificación de error,
no de advertencia, y no siempre llega: una carga cancelada en la cola notifica solo al dueño y solo si la canceló otra
persona).

**Las cargas en cola se pueden eliminar, y el sistema te lo dice.** Una remesa **En cola** está confirmada: eliminarla
la saca de la cola y no se carga. Por eso el diálogo de eliminar dice qué estás borrando en cada caso (ver "Borrar la
remesa", más abajo). Si lo que querés es frenarla y poder retomarla después, usá **Cancelar**.

**Una carga dividida se muestra agrupada.** Las remesas que se confirmaron juntas aparecen una abajo de la otra, en
el orden de la división, con un encabezado que ocupa todo el ancho:
**Carga dividida · 5 remesas** — *3 finalizadas · 1 en curso · 1 fallida o cancelada*. Esos números cuentan **todas** las
remesas de la división, estén o no en la página que estás mirando. Si en la página están solo algunas, el encabezado
dice *(2 de las 5 están en esta página)*, y si alguna se eliminó, *(1 se eliminó)*. Cada remesa lleva su corte y
*"Remesa 2 de 5 de una carga dividida"*. Si hay dos o más que no se cargaron y se pueden retomar, el encabezado
trae el botón **Retomar las N que no se cargaron**. Las remesas de una división que no se confirmaron como grupo
(borradores, o divisiones anteriores a este cambio) no llevan encabezado, pero muestran su corte.

**Las vistas previas sin confirmar se borran solas.** Una remesa que quedó como **Borrador**
porque nunca se confirmó se elimina automáticamente cuando tiene más de **24 horas**. La
limpieza corre una vez por día, de madrugada (04:30, hora de Argentina), así que en la práctica un borrador
dura entre uno y dos días. Hasta entonces sigue ocupando su número: si querés liberarlo antes, borralo a mano
desde el Historial. Una vez borrada no se recupera: si todavía querías esa carga, hay que volver a subir el
archivo (y confirmar una vista previa que ya se borró responde *"Remesa no existe"*). Solo se borran las que
no cargaron ningún caso: una remesa confirmada, en cola o con casos no se toca. Tampoco se borran las vistas
previas de un usuario que en ese momento tiene una importación en curso, por lo que esas pueden durar más de
dos días. Las remesas de una carga dividida ya confirmada no son vistas previas: están en la cola y esta
limpieza no las toca. Las remesas creadas
hasta el 05/10/2026 inclusive no entran en esta limpieza: esas se eliminan desde el Historial.

Una carga con advertencias también tiene su notificación (con ícono de advertencia) y el cartel arriba del detalle.

La campanita de la barra superior **no muestra las vistas previas sin confirmar**: en
**Importaciones en curso** solo figuran las cargas que se confirmaron y todavía no terminaron.

**La campanita y el chip de la barra superior.** Mientras haya cargas en curso, al lado de la campanita aparece un
chip que las resume: *Importando 43 %* si hay una procesando, *Importación en cola* si todavía no arrancó,
*Cancelando importación* si se pidió cortarla, y *3 importaciones* si son varias. Tocarlo abre la campanita. En el
celular el chip se reduce a un ícono (el texto queda como etiqueta del botón) y la campanita se abre a pantalla
completa, con el botón **Cerrar** arriba a la derecha. La campanita también se cierra sola al ir a otra pantalla, y el
botón "atrás" del navegador del celular hace las dos cosas: la cierra y vuelve a la pantalla anterior.

Desde la campanita se puede actuar sobre las cargas:

- **En curso:** **Ver detalle** lleva al detalle de esa remesa y cierra la campanita. El ícono de cancelar abre el mismo
  diálogo del asistente y del Historial; en una carga dividida ofrece **Cancelar todo lo que falta** aunque la remesa
  que está corriendo ya no se pueda cortar. Solo aparece para quien cargó la importación (o tiene el permiso para ver
  las de otros) y puede ejecutar importaciones.
- **Terminadas:** la notificación puede traer **Descargar errores** (cuando dice que hubo errores o avisos) y
  **Retomar** (solo si la carga se canceló o falló sin haber procesado ninguna fila). Los botones no abren el detalle
  ni marcan la notificación como leída; tocar el resto de la notificación sí. Antes de hacer algo, el sistema consulta
  cómo está la carga ahora, porque la notificación puede ser vieja: si la importación ya no existe, dice *"Esta
  importación ya no existe."*; si ya la retomó otra persona, *"Esta importación ya está en curso."*; si ya no se puede
  retomar, dice por qué o te manda a mirar el detalle; y si la cargó otra persona y no tenés permiso para ver las
  importaciones de otros, *"Solo quien la cargó puede retomarla."* **Descargar errores** baja el mismo
  `errores-remesa-N.csv` que el detalle (con el mismo aviso si son más de 200.000) y, si la carga ya no tiene
  errores ni avisos, lo dice en vez de bajar un archivo vacío. **Retomar** pide confirmación, deja la carga en la cola
  (*"Importación retomada: quedó en la cola."*) y la ves aparecer en **Importaciones en curso**.
- **Retomar desde una notificación retoma solo esa remesa**, aunque sea parte de una carga dividida. Para retomar toda
  la división de una vez, usá el encabezado de la división en el Historial.

## Buscar, paginar y cuánto tarda en actualizarse

- **Paginado.** El Historial muestra **25** importaciones por página (se puede elegir 50 o 100), de la más nueva a la
  más vieja. Cambiar de empresa o de búsqueda vuelve a la primera página.
- **Búsqueda.** El campo *Buscar por número o nombre* filtra la lista. Mientras hay una búsqueda activa aparece
  *"Buscando «x»"* con el botón **Quitar**.
- **Importaciones en curso que no ves.** Si hay cargas en curso de esta empresa que quedaron en otra página, arriba
  de la tabla dice *"Hay N importaciones en curso que no están en esta página: #151, #152."* con el botón **Ir al
  principio**.
- **Se actualiza sola.** Una carga que corre cambia su porcentaje en vivo. Las cargas de otros usuarios las ves en vivo
  solo si tenés el permiso para ver importaciones de otros; si no, la lista se actualiza consultando al servidor:
  **hasta 30 segundos** después de un cambio mientras haya una carga en curso a la vista, y **cada minuto** si no hay
  ninguna (solo en la primera página y sin búsqueda: en las demás páginas, o con una búsqueda puesta, no se
  actualiza sola si no hay ninguna carga en curso a la vista). Si la conexión en tiempo real está caída y hay una
  carga en curso a la vista, consulta cada 15 segundos.
  Una carga que otra persona crea o elimina puede tardar eso en aparecer o desaparecer. El botón **Actualizar** de la
  barra superior fuerza la lectura.
- **Si no carga.** Si el servidor no responde, la pantalla dice *"No se pudo cargar el historial"* con el botón
  **Reintentar**; no te muestra una lista vacía.

## Ver el detalle y los errores

Entrando a una remesa ves el resumen y, si hubo filas rechazadas, **el detalle fila por fila**: qué
número de fila era, qué traía y por qué falló. La tarjeta tiene **dos pestañas con su cantidad**: **Errores de fila
(483)** y **Avisos (2)** (en Claves de pago, **Trámites rechazados**). Si una está en cero no se muestra. Cada una
está **paginada** (25, 50 o 100 por página), así que se ven **todos** los errores, y una carga con muchos avisos no
tapa los errores de fila. Mientras la carga corre, la tabla se va actualizando sola a medida que aparecen errores
(a lo sumo una vez cada 5 segundos) y una vez más al terminar. El botón **Descargar CSV** baja el archivo con
todos los errores y avisos de la carga; si son más de 200.000, antes avisa que el archivo trae los primeros 200.000.
Si la carga dice que hubo errores y no se pueden leer, la tarjeta lo dice (*"No se pudieron leer los errores"*, con
**Reintentar**) en vez de mostrar que no hay ninguno.

**Mientras la carga corre**, arriba del detalle se ve su progreso: los pasos (**En cola → Procesando → Post-proceso →
Listo**; en el celular, una línea como *"Paso 2 de 4 · Procesando"*), la fase con el porcentaje, la barra y el botón
para cancelar. Si hubo errores o avisos, debajo aparecen **los últimos cinco** (*"Fila 1.204 · …"*) con el total
(*"En total: 1.204 errores de fila y 3 avisos"*). Son los **cinco más nuevos**, errores de fila y avisos juntos,
del último que apareció al más viejo: un aviso reciente figura entre ellos aunque haya muchos errores de fila.
El total cuenta los dos. En una carga dividida se suma
la barra de la división, *"Remesas terminadas: 2 de 3"*, que avanza sola a medida que terminan las otras remesas.
Cuando la carga termina, ese bloque deja lugar al resumen.

Los avisos
(`[aviso]`, `[parseo]`, `[post-proceso]`) figuran con **—** en lugar del número de fila; una fila con error siempre
lleva su número. **En las cargas nuevas de CSV, Excel y ancho fijo el número es la fila del archivo**, contando el encabezado y
las filas vacías: en Excel, el número de fila de la hoja, y el CSV que se descarga trae el mismo número.
**Multirregistro, Multiarchivo y Claves de pago** no traen ese dato y siguen como las cargas viejas: el número es la
posición de la fila entre las que procesó la carga, con el mismo tooltip. En las **cargas anteriores a esta función** el número es otra cosa: la posición
de la fila entre las que procesó la carga, contando desde 1, sin el encabezado ni las filas descartadas por un
filtro, así que no es la línea del archivo (para ubicar el registro, usá la columna con el contenido de la fila).
Pasando el mouse por el encabezado de la columna, la pantalla dice cuál de las dos es. Con varios archivos, el mensaje trae el
`[archivo:línea]`: la línea es la fila de datos dentro de ese archivo, contando desde 1 y sin el
encabezado (si el archivo tiene encabezado, es la línea siguiente). Por eso, con varios archivos y encabezado, la
columna **Fila** y el `[archivo:línea]` del mensaje pueden diferir en 1: la columna cuenta el encabezado y el
mensaje no. Los avisos
cuentan aunque ninguna fila haya dado error: incluyen los que escriben las propias categorías al cargar
(los de Pagos con número de convenio y los de Claves de pago, más abajo). Una carga que falló, que se
canceló, que terminó con advertencias o que no tenía filas muestra además un cartel arriba con el motivo. El estado grande de arriba del detalle usa las mismas palabras que la grilla (**Finalizada con errores**, **Cancelada**, **En cola**…), y
los de las otras remesas de la división también. Si
la remesa es parte de una carga dividida, el detalle lo dice bajo el número (*"Remesa 2 de 5 de una carga
dividida"*) y enlaza a las otras remesas. En *Información general* aparecen, cuando corresponden, el **Corte** que le
tocó a la remesa y las **Remesas de origen** con las que se confirmó (*"una remesa eliminada"* si ya no existe).

Debajo de las cuatro tarjetas (total, OK, con error y tasa de éxito) hay una línea con lo que no entra en
ellas, y muestra solo lo que corresponde: *Casos nuevos*, *Casos actualizados* (las categorías que los
informan), *Descartadas: N* (en toda remesa sin corte, que es el caso normal) y, en una carga dividida, el
desglose en dos: *Descartadas por el filtro de la plantilla* y *De otros cortes de la división (no se cargan
en esta remesa)*. Vale para cargas en curso y terminadas.

Es lo primero que hay que mirar cuando una carga no dio los números esperados. Los motivos más
frecuentes:

| Error | Qué significa |
|---|---|
| Falta el nº de cliente | La categoría busca el caso por ese campo y la fila no lo trae |
| Debe ingresar al menos una factura | En Deudores y Facturas, toda fila necesita su factura |
| Fila sin valor de contacto | El bloque de contacto vino vacío |
| Sin campo de match | Acciones masivas sin la columna de match |
| Deudor no encontrado (nro_cliente=…) | El caso no existe en la remesa elegida. Si fallan **todas** las filas, el problema está en la carga de la cartera, no en este archivo |
| El importe "…" no es un número | El valor no se pudo convertir. Revisá los transforms del importe en la plantilla |

**Claves de pago (multiclaves):** acá "fila" es un trámite (normalmente dos claves; a veces una
sola, ver más abajo). Hay dos momentos distintos en los que un trámite se puede caer, y no son lo
mismo:

**Al leer el archivo** (vista previa y carga), un trámite se rechaza por completo, citando entre
corchetes la razón real de la línea que lo tiró abajo — `CLAVE_DV` (dígito verificador de la clave no
calza), `BARRA_NO_COINCIDE` (el código de barras no coincide con las columnas), `GESTOR_AJENO`
(código de gestor que no es el configurado en la plantilla), `CONVENIO_REPETIDO_EN_ARCHIVO` (el mismo
número de convenio aparece dos veces en el archivo), entre otros. Los casos concretos:

| Cuántas líneas trajo | Qué pasa |
|---|---|
| **1, con importe = saldo del trámite** | Se acepta, clasificada **TOTAL**, con el aviso `SOLO_TOTAL` (no es un error — Telecom a veces manda un trámite sin su clave de quita) |
| **1, con importe ≠ saldo del trámite** | Se rechaza: `CLAVE_UNICA_NO_ES_TOTAL`. Una única clave cuyo importe no es el saldo probablemente es una quita sin su total (el total puede haberse perdido en el camino, o venir con el trámite ilegible) |
| **1, y esa línea es inválida** (DV roto, gestor ajeno, columnas de más o de menos, etc.) | `TRAMITE_INCOMPLETO`, citando el motivo real de esa línea |
| **2, las dos válidas, con importes distintos** | Se carga: la de menor importe es la quita, la otra el saldo total (el orden en el archivo no importa) |
| **2, las dos válidas, con el mismo importe** | `IMPORTES_IGUALES`: no se puede decidir cuál es la quita |
| **2, y alguna es inválida** | `TRAMITE_INCOMPLETO`, citando el motivo de la línea que falló — la línea válida no se carga sola |
| **3 o más** | `TRAMITE_INCOMPLETO`, aunque todas sean individualmente válidas: no hay forma de saber cuál sobra |

Una línea con las columnas mal (cortada, o con una de más) **sigue contando para su trámite** aunque
el resto de sus datos esté roto, siempre que el número de trámite (la primera columna) se pueda leer
— así el sistema sabe que ese trámite trajo 2 líneas (una inválida) y lo rechaza como corresponde, en
vez de dejar a su par entrar solo como si fuera un caso de una sola línea. Solo cuando ni el número de
trámite se puede leer, esa línea queda sin poder asociarse a nada y se rechaza por sí sola.

> **Ojo con ese último caso.** Si la línea con el trámite ilegible era la **quita**, la del saldo
> total de ese trámite entra sola como `SOLO_TOTAL`, y la oferta con quita de ese caso se pierde. El
> cupón por el total sigue siendo correcto. En la vista previa se ve como **1 rechazado** más **1 solo
> TOTAL**, pero el sistema no los relaciona. Si ves esa combinación, revisá la línea rechazada: si era
> la quita de un trámite que entró solo, borrá la carga y volvé a subir el archivo corregido
> (recargarlo sin borrar da `TANDA_PARCIAL`).

**Al cargar contra la base** (ya pasado el parseo), un trámite puede rechazarse por lo que ya hay
guardado:
- `CONVENIO_YA_EXISTE`: alguna de las claves del trámite ya está cargada, pero para **otra empresa**
  o **otro trámite** — típicamente, el mismo archivo subido por error en la empresa que no era.
- `TANDA_PARCIAL`: alguna de las claves de este trámite ya existe y el resto de su tanda no (por
  ejemplo, la TOTAL sí y la QUITA no). No se modifica nada hasta revisarlo a mano. Puede pasar dentro
  de la misma carga, pero también **entre cargas distintas**: un trámite que entró primero con una
  sola clave (`SOLO_TOTAL`) y después recibe una carga con el par completo, repitiendo esa misma
  clave y sumando la que faltaba, también cae acá — el sistema no fusiona tandas de cargas distintas
  automáticamente. **Cómo salir:** borrar la carga que dejó la tanda incompleta y volver a subir el archivo completo. El borrado se
  bloquea si **cualquier** clave de esa carga ya tiene un convenio (ver "Cuándo no se puede borrar"
  en [Claves de pago](/ayuda/importacion/claves-de-pago)).

Ninguno de estos motivos indica un problema del sistema: siempre es un dato del archivo, o de lo que
ya había cargado antes, que no calza.

> **`TANDA_ANTERIOR` no es un rechazo.** Si la tanda que se está cargando tiene un vencimiento
> **anterior** al de la que ya está vigente, la clave se carga igual (para no perder el dato), pero
> queda `REEMPLAZADA` desde el vamos — la vigente sigue siendo la que ya estaba. Aparece como aviso,
> no como error, y no resta de las filas OK.

> **Ojo con lo que NO aparece acá.** Las filas descartadas por un **filtro de fila** no son errores: no
> figuran en este listado. Y un **teléfono que no se pudo normalizar** se descarta en silencio, sin
> quedar registrado. Si las cuentas no cierran y el listado de errores está vacío, mirá por ahí.

**Pagos con número de convenio (claves de pago de Telecom/Personal):** si la plantilla de una carga
de **Pagos** mapea el campo *"Nº de convenio de la clave de pago"*, el detalle puede traer estos
avisos — nunca restan de las filas OK, son informativos:

| Aviso | Qué significa |
|---|---|
| `CLAVE_NO_CARGADA` | El número de convenio no corresponde a ninguna clave cargada en esta empresa todavía. El pago se guarda igual: en cuanto se carguen las claves de esa nómina (categoría **Claves de pago**) y se vuelva a consolidar, el caso se cancela solo |
| `CLAVE_DE_OTRA_EMPRESA` | El convenio existe, pero en **otra** empresa — típicamente porque el mismo archivo se carga una vez por empresa. La fila entra como pago común si el trámite existe acá |
| `TRAMITE_EN_VARIOS_CASOS` | El trámite de la clave está en más de un caso de esta empresa. El sistema desempata solo: primero el caso con el convenio de esa clave, si no el de la remesa más reciente |
| `CASO_FUERA_DE_REMESA_ORIGEN` | El caso del trámite existe, pero no en la(s) remesa(s) de origen que elegiste para esta carga — igual se usa |
| `REFERENCIA_CLAVE_ILEGIBLE` | La columna trae algo que no se puede leer como número de convenio, clave de pago ni código de barras. La fila se carga igual como pago común |

---

## Qué se puede deshacer

Esta es la parte que conviene leer **antes** de necesitarla.

### Revertir — solo acciones masivas

Una carga de **Acciones masivas** terminada —finalizada, **cancelada o cortada**— tiene botón de **revertir**: deja
los casos como estaban, y deshace exactamente lo que la acción alcanzó a hacer. Revertir corre **en segundo plano**:
antes de confirmar, el diálogo dice cuántos casos cubre; después la fila muestra el avance (**En cola**,
**Revirtiendo 40 %**, **Revertida**) y, al terminar, llega una notificación. Se puede una sola vez, salvo para
terminar una reversión **interrumpida** o fallida: ahí el botón queda habilitado (*"Revertir (sigue desde donde
quedó)"*) y sigue desde donde quedó. Todo el detalle está en [Acciones masivas](/ayuda/importacion/acciones-masivas).

El botón se ve con el permiso de acciones masivas. En el Historial queda deshabilitado con **Se está revirtiendo**
mientras corre y con **Ya se revirtió** cuando terminó; en el detalle de la importación **desaparece**. El diálogo se niega a revertir (y dice por qué) en estos casos:

| Aviso | Qué pasó | Qué hacer |
|---|---|---|
| *"La acción masiva todavía está corriendo. Cancelala, o esperá a que termine, y después revertila."* | La acción sigue en cola o procesando | Cancelarla, o esperar |
| *"Esta acción ya se está revirtiendo. Mirá el avance en el Historial."* | Alguien más (u otra pestaña) ya pidió revertirla | Esperar y mirar el avance en el Historial |
| *"Esta acción masiva no llegó a cambiar ningún caso: no hay nada que revertir."* | No quedó ningún cambio para deshacer | Nada |
| *"Esta acción masiva no terminó bien: los datos para revertirla no se guardaron. Avisá a soporte; no la vuelvas a cargar."* | Una acción **anterior a esta versión** que falló o se cortó **con filas ya procesadas** (si no procesó ninguna, el aviso es el de «no hay nada que revertir») | Avisar a soporte |
| *"Los datos para revertir esta acción no se guardaron completos: Revertir desharía solo una parte. Avisá a soporte."* | Una acción **anterior a esta versión** que terminó **con advertencias** | Avisar a soporte |

Si la pantalla no recibe respuesta al pedir revertir, el aviso es *"No llegó la respuesta del servidor. La
reversión puede seguir corriendo: actualizá el Historial en unos minutos antes de volver a intentar."* No
vuelvas a apretar Revertir enseguida: mirá primero la fila.

**Ninguna otra categoría tiene deshacer.** No hay botón de revertir para deudores, facturas, pagos,
contactos ni actualizaciones.

### Borrar la remesa — con dos condiciones grandes

Se puede borrar una remesa en cualquier estado **salvo mientras está corriendo** (arrancó y todavía no
terminó) y salvo que sea demasiado grande (ver "No me deja borrar la remesa"). Una carga **en cola que todavía no arrancó sí se puede borrar** (o cancelar, que la deja retomable): el sistema la saca de la cola
y borra la remesa. Si está corriendo, si su trabajo está activo o si la cola no se puede consultar, el
sistema la rechaza con *"No se puede eliminar una importación en curso"*.
En la grilla el botón de eliminar queda **deshabilitado** en las que ya están corriendo (*"No se puede eliminar una importación en curso. Para frenarla, usá Cancelar."*) y en las que no son tuyas si no tenés el permiso para ver importaciones de otros (*"Solo podés eliminar tus importaciones."*); el motivo está en el mensaje del botón y, en el celular, escrito debajo de los botones. Antes de borrar, el diálogo dice qué se elimina:

| Qué estás eliminando | Qué dice el diálogo |
|---|---|
| Un **borrador** | *Eliminar vista previa*: no cargó nada, se libera su número de remesa |
| Uno que **no se pudo encolar** | Lo mismo, y avisa que si lo que querés es cargarlo uses **Confirmar** en vez de eliminarlo |
| Una **En cola** | *Eliminar una importación en cola*: está confirmada y espera su turno; si la eliminás sale de la cola y no se carga. Si es parte de una división, dice *"Es la remesa N de M de una carga dividida: las demás siguen."*. Si solo querés frenarla, usá **Cancelar**. El botón dice **Eliminar igual** |
| Una terminada de **Deudores**, **Deudores y Facturas**, **Multirregistro** o **Multiarchivo** | Elimina la importación junto con sus casos y lo que cargó, si ninguno tiene gestión |
| Una terminada de **Facturas**, **Pagos**, **Contactos**, **Enriquecimiento** o **Actualizaciones** | Borra su registro y su lista de errores. **No deshace lo que aplicó** |
| Una de **Acciones masivas** | **Eliminarla no revierte la acción** y deja sin efecto el botón Revertir para siempre. Mientras se revierte no se puede eliminar: da *"Se está revirtiendo esta acción masiva: esperá a que termine para eliminarla."* |
| Una de **Claves de pago** | Elimina las claves que cargó; si alguna ya tiene convenio o cupón emitido, no se puede |

Pero:

**1. No se puede borrar si alguien ya trabajó los casos** — pero solo aplica a las remesas que
**crearon** casos. Si algún caso de la remesa tiene un comentario, un convenio, un pago, una llamada o
un mail enviado, el sistema no deja borrarla.

Una remesa de **pagos, contactos, facturas, enriquecimiento, actualizaciones o acciones** no tiene
casos propios, así que **esa validación no se aplica**: se borra siempre, por gestionada que esté la
cartera.

**2. Borrar no siempre deshace.** Borrar una remesa borra **los casos que esa remesa creó**. Si la
carga fue de **pagos, contactos o actualizaciones**, sus registros cuelgan de casos de *otra* remesa:
se borra la fila del historial y **los pagos quedan en la base**.

| Categoría de la carga | Borrar la remesa… |
|---|---|
| Deudores · Deudores y Facturas · Multirregistro · Multiarchivo | Borra los casos que creó ✅ |
| Facturas · Pagos · Contactos · Enriquecimiento · Actualizaciones | **No deshace nada.** Los registros quedan |
| Acciones masivas | ⚠ **Nunca borres**: ver abajo |
| Claves de pago (multiclaves) | Borra las claves de esa carga (no toca ningún deudor: esta categoría no crea casos). **Bloqueada** si alguna clave ya tiene convenio o cupón emitido — el sistema dice cuántas. Si había otras tandas del mismo trámite, se recalcula cuál queda vigente entre las que sobreviven (por vencimiento) — no simplemente "la anterior", para no dejar dos tandas vigentes ni ninguna si hay una cadena de varias reemisiones |

> ### ⚠ Borrar una remesa de acciones masivas destruye el deshacer
>
> El sistema **te deja borrarla**, y al hacerlo: no se revierte nada, los cambios quedan aplicados, y
> el botón de revertir **deja de funcionar para siempre**. Es una operación irreversible que además
> elimina la única forma de arreglarla.
>
> Si una acción masiva salió mal: **revertir primero**. Nunca borrar.

> ### Una acción masiva cancelada o cortada también se revierte
>
> El botón aparece también si la carga se canceló o se cortó a mitad de camino: los datos para deshacer se guardan
> caso por caso, junto con cada cambio, así que Revertir cubre exactamente lo que alcanzó a hacer. La excepción son
> las acciones **anteriores a esta versión** que quedaron a medias con filas ya procesadas: no tienen esos datos, y
> el sistema responde *"Esta acción masiva no terminó bien…"* y no toca nada. Una cancelada sin ninguna fila
> procesada dice que no hay nada que revertir.

### La conclusión práctica

**La vista previa es la red de seguridad real**, no el deshacer. Treinta segundos mirándola valen más
que una hora arreglando después.

> ### ⚠ Una carga de pagos mal importada no tiene arreglo desde el sistema
>
> **Los pagos que entraron por una importación no se pueden eliminar.** La ficha solo permite borrar
> los que se cargaron **a mano**: el botón aparece deshabilitado, con el aviso *"Solo se pueden
> eliminar pagos manuales"*.
>
> Y si el pago dejó la cuenta cancelada, se suma una segunda pared: una cuenta cancelada queda
> bloqueada y no admite cambios.
>
> Si una carga de pagos entró mal, **no hay camino dentro de la aplicación**: hay que escalarlo a
> sistemas para que se corrija sobre la base. Por eso la vista previa no es una recomendación.

---

## Otras acciones del historial

**Cancelar** frena una carga en curso. Aparece en las filas que están **En cola**, **Leyendo el archivo**, **Procesando**
o en **Post-proceso**; si en ese momento no se puede cortar (por ejemplo, ya está cerrando), el botón queda
deshabilitado con el motivo. Abre el mismo diálogo que el asistente y el detalle (ver
[Importar un archivo](/ayuda/importacion/importar-un-archivo), "Cancelar una importación"). En una carga dividida el
diálogo ofrece **Cancelar solo esta remesa** o **Cancelar todo lo que falta**, y la lista de las remesas que no
empezaron se mantiene al día mientras el diálogo está abierto.

**Retomar** vuelve a encolar una carga que no llegó a cargar ninguna fila (por ejemplo, una cancelada antes de
empezar). Pide confirmación (*"Se vuelve a encolar la misma remesa, con el mismo archivo. No se cargó ninguna fila la
vez anterior."*). El botón aparece solo cuando el sistema dice que se puede: si el corte de la remesa ya figura en otra
remesa que se confirmó después, no aparece y la grilla explica por qué (*"El corte de esta remesa ya figura en la
remesa N: no se puede retomar. Si esta ya no hace falta, eliminala."*). En una división, el encabezado trae **Retomar
las N que no se cargaron**; si ninguna se puede, el sistema dice el motivo de cada una.
También se puede retomar una remesa desde su notificación en la campanita (ver "La campanita y el chip de la barra
superior"): retoma solo esa remesa.

**Confirmar** manda a la cola un borrador que **ya se había confirmado** y la cola no pudo recibir (el estado
**No se pudo encolar**). El diálogo (*"Confirmar la importación"* o *"Confirmar las N importaciones"*) lista las remesas
con su corte y la **remesa de origen** con la que se confirmaron, y avisa que se mandan a la cola tal como se habían
confirmado: **la vista previa no se vuelve a mostrar**. Si la remesa de origen ya no existe, no se puede confirmar. Si el
mismo archivo ya figura en otra remesa que se confirmó después, el diálogo lo advierte (*"Este archivo ya figura en la
remesa N, que se confirmó después. Si confirmás esta, se carga otra vez."*): con corte, el botón queda deshabilitado; sin
corte, dice **Confirmar igual**. Es lo mismo que el botón **Cargar las que faltan** del resultado del asistente, que
sigue existiendo; la diferencia es que desde acá se puede hacer aunque ya hayas cerrado el asistente, mientras el
borrador exista.

**Consolidar** recalcula el saldo y el código de situación de los casos de una remesa según los pagos
registrados. En la grilla es un **ícono sin texto** (tooltip *"Consolidar situacion de deudores de esta
remesa"*) y **solo aparece con el permiso** Ejecutar consolidación de situación. Abre una ventana
*"Consolidar situacion — …"* que corre en dos pasos: **Calcular preview** y, después de revisar los
cambios, **Aplicar consolidacion**. El título muestra *"Remesa #…"* con el **ID interno** de la remesa, no
su número. Consolidar reevalúa **todos** los casos de la remesa que tienen pagos, no solo los que tocó
el archivo: mirá el preview antes de aplicar.

> **Apretalo en la remesa de deudores, no en la de pagos.** Consolida los casos **de esa** remesa, y
> una remesa de pagos no tiene casos propios: te va a decir que evaluó 0. Hay que correrlo sobre la
> cartera.

Una importación de pagos **ya consolida sola al terminar**, así que el botón es para volver a correrlo,
no un paso obligatorio.

**Política** — desde la misma grilla se puede asociar o cambiar la política de una remesa.

---

## Qué puede salir mal

### No me deja borrar la remesa

Hay varias causas, cada una con su mensaje:

- **Alguien ya trabajó sus casos**: hay comentarios, pagos, convenios o llamadas. Es intencional — borrarla
  se llevaría ese trabajo puesto.
- **Está corriendo**: *"No se puede eliminar una importación en curso"*. Esperá a que termine o falle.
- **Se está revirtiendo** (una acción masiva): *"Se está revirtiendo esta acción masiva: esperá a que termine para eliminarla."* (409). Esperá a que la reversión termine.
- **Cambió mientras mirabas**: *"La importación cambió desde que abriste este diálogo (por ejemplo, alguien la
  confirmó). Revisala antes de eliminarla."* Pasa si, con el diálogo abierto, otra persona confirmó esa vista previa
  o la carga avanzó. No se borró nada: mirá en qué estado está ahora antes de volver a intentar.
- **No es tuya**: *"No tenés permiso para eliminar esta importación"*. Solo la borra quien la cargó o alguien
  con permiso para ver las importaciones de otros.
- **Es demasiado grande**: *"No se pudo eliminar: la remesa es demasiado grande para borrarla desde la
  pantalla. Avisá a soporte."* No hay nada que hacer desde la pantalla; avisá a soporte.
- **La base tardó demasiado**: *"No se pudo eliminar: la base de datos no respondió a tiempo. Probá de nuevo
  en unos minutos; si se repite, avisá a soporte."* No se borró nada: probá más tarde, mejor cuando no haya
  otra importación corriendo.

### Borré la remesa de pagos y los pagos siguen ahí

Es el comportamiento esperado: los pagos cuelgan de casos de la remesa vinculada, no de la de pagos.
Y **no se pueden eliminar desde la ficha**: hay que escalarlo a sistemas.

### El archivo ni siquiera se pudo leer

El error dice el nombre del archivo y el motivo: *"No se pudo leer «cobros.csv»: … Revisá que el
separador y el formato de la plantilla sean los del archivo."* Casi siempre es el separador declarado
en la plantilla, o un archivo que no es el que se creía.

> **Dos columnas con el mismo nombre ya no rompen la carga.** El sistema no lee los nombres del
> encabezado, mapea por **posición**. El archivo de cobros de Personal manda `PAYMENT_METHOD_DES` dos
> veces y entra igual.

### La carga quedó "procesando" y no avanza

Mientras esté procesando no se puede borrar. Entrá al detalle a ver el progreso. Hay dos casos distintos:

**El servidor no da señales** (se reinició, se cayó o dejó de responder). A los 2 minutos sin señal, la
pantalla lo avisa con *"El servidor no da señales de esta carga hace N min. Si no se recupera, en unos
minutos se marca sola como fallida y vas a poder hacer otras importaciones; el motivo va a decir qué hacer
con esta."* El aviso aparece en cuanto abrís la
pantalla si la carga ya estaba así, y también en la lectura del archivo y en el post-proceso; no en cola.
Si el servidor no se recupera, **la carga se marca sola como fallida** a los pocos minutos sin señal
(normalmente entre 6 y 7 desde la última señal), con el motivo y qué hacer según la categoría (ver
[Importar un archivo](/ayuda/importacion/importar-un-archivo), "La importación falló"). Al fallar se libera el
bloqueo de una importación por vez: podés hacer **otras** importaciones; con esta, lo que hay que hacer lo
dice el motivo. **No se vuelve a ejecutar sola**: después de un corte hay que decidir qué hacer, porque lo
procesado hasta ahí quedó aplicado. Si pasaron **15 minutos** sin señal y la pantalla sigue igual, el aviso
pasa a decir *"El servidor no da señales de esta carga hace N min y todavía no se marcó como fallida. Avisá a
soporte."*: el cierre automático no está ocurriendo, y hay que avisar a soporte.

El Historial se actualiza solo: en cuanto la carga figure como fallida, el estado cambia y se habilita el tacho para
eliminarla (puede tardar hasta 30 segundos; el botón **Actualizar** de la barra superior fuerza la lectura).

**El servidor trabaja pero la carga no avanza.** Es la excepción: **esta carga no se cierra sola**. Si la
pantalla lleva 10 minutos sin ver cambiar la fase, el paso ni los contadores, avisa *"El servidor sigue
trabajando, pero esta carga no muestra avances hace N min (contados desde que abriste esta pantalla)…
avisá a soporte: no se va a marcar como fallida sola."* Avisá a soporte.

Una carga **en cola** tampoco se cierra sola mientras su trabajo siga esperando en la cola. Si es la próxima
y el servidor no la toma en 2 minutos, la pantalla avisa y mientras no arranque la podés **cancelar** desde su
detalle (queda cancelada sin cargar nada y se puede retomar) o eliminar desde el Historial.

Mientras una carga ocupa su lugar, **no te deja arrancar otra importación**: el sistema permite una sola
por usuario a la vez, y una carga dividida cuenta como una hasta que termina su última remesa.

### La carga terminó con advertencias: qué hacer

El título del resultado es **"Importación finalizada con advertencias"**. Significa que **las filas se
cargaron** (el texto dice cuántas, y cuántas dieron error si hubo), pero el **post-proceso** no terminó:
el cierre que corre después de cargar. Qué es ese cierre depende de la categoría, y por eso el remedio
también. La pantalla lo dice (*"Quedó sin hacer…"*); esta es la tabla completa:

| Categoría de la carga | Qué quedó sin hacer | Qué hacer |
|---|---|---|
| **Pagos** | Recalcular el saldo y la situación de los casos que recibieron pagos, y cerrar las promesas cumplidas | **Consolidar desde el Historial cada remesa de deudores que elegiste como origen al importar** (no la de pagos: no tiene casos propios). Si no te acordás cuáles fueron, o el detalle trae el aviso `CASO_FUERA_DE_REMESA_ORIGEN`, avisá a soporte. Las promesas las resuelve soporte |
| **Actualizaciones** | El cierre de los ausentes del archivo (según la plantilla: darlos por pagados, desasignarlos o nada), la consolidación de los casos y el cierre de las promesas cumplidas | Avisar a soporte |
| **Facturas** | El cálculo del importe de los casos desde sus facturas (salvo que la plantilla diga **«No calcular»**), la unión de los datos adicionales del archivo y la consolidación. Los casos que vinieron sin importe pueden haber quedado sin él | Avisar a soporte |
| **Deudores y Facturas** | El cálculo del importe de los casos desde sus facturas (salvo que la plantilla diga **«No calcular»**) y la consolidación. Los casos que vinieron sin importe pueden haber quedado sin él | Avisar a soporte |
| **Multirregistro** | La consolidación de los casos tocados y el cierre de las promesas cumplidas (esta categoría nunca desasigna ausentes) | Avisar a soporte |
| **Multiarchivo** | El cierre de los ausentes (desasignarlos, solo si la plantilla tiene activada la desasignación), la consolidación de los casos tocados y el cierre de las promesas cumplidas | Avisar a soporte |
| **Acciones masivas** | En las acciones **anteriores a esta versión**, guardar los datos que permiten revertir la acción | Avisar a soporte. Revertir no te lo va a permitir: dice *"Los datos para revertir esta acción no se guardaron completos…"* |
| **Claves de pago** | Pudo quedar sin hacer la re-consolidación de los casos que ya tenían pagos con esas claves | Avisar a soporte |
| **Deudores** · **Contactos** · **Enriquecimiento** | Nada de lo que se carga: en estas categorías el cierre solo limpia datos internos | Avisar a soporte con el motivo |

La opción de la plantilla se llama *"Calcular importe desde las facturas"*; su valor por defecto es
*"Solo si el deudor vino sin importe (recomendado)"*, así que **salvo que alguien eligiera «No calcular»,
el cálculo corre**.

**Consolidar** en el Historial recalcula saldo y situación de los casos **de esa remesa** y nada más:
por eso en una carga de Pagos hay que hacerlo sobre la remesa de deudores (ver "Otras acciones del
historial", más arriba). No cierra ausentes, no recalcula montos de facturas ni guarda los datos para
revertir una acción masiva.

**No hace falta volver a subir el archivo, y no conviene.** Las filas ya están cargadas y una remesa
que procesó filas no se puede volver a ejecutar (Retomar existe solo para una que no cargó ninguna); subir el archivo de nuevo crea **otra remesa**. Qué pasa
depende de la categoría:

- **Deudores y Deudores y Facturas:** los mismos clientes quedan como casos **nuevos** de la remesa
  nueva (un caso es el cliente más la remesa): quedarían duplicados.
- **Pagos:** los cobros que ya estaban cargados se saltean y **no se vuelven a consolidar**, así que
  resubir no completa el cierre que faltó. Hay que consolidar como dice la tabla.

En el detalle de la remesa, arriba está el cartel con el motivo y en la tabla una fila **[post-proceso]**.

### La importación falló

Ver [Importar un archivo](/ayuda/importacion/importar-un-archivo): **Retomar** existe solo para una carga que no
cargó ninguna fila (la que "no llegó a empezar", por ejemplo); una que ya procesó filas no se puede volver a
ejecutar. El cierre no corrió (la tabla de arriba dice qué es ese cierre en cada categoría) y, en Deudores y
Deudores y Facturas, hay que borrar la remesa fallida antes de volver a subir el archivo. En Pagos, si entraron
filas antes del corte, volver a subir el archivo las saltea y sus casos quedan sin consolidar: aplicá el
mismo criterio que en la tabla de advertencias. Si la causa fue que el servidor se reinició o dejó de
responder, el motivo de la carga lo dice y trae su propio paso a seguir según la categoría (no es el mismo
en Deudores que en Acciones masivas): está en ese mismo apartado de Importar un archivo. Para una carga
interrumpida rige ese motivo, no el criterio de arriba. En Deudores y Deudores y Facturas el motivo manda
eliminar la remesa y volver a cargar; si no se puede eliminar (algún caso ya tiene gestión, o la remesa es
demasiado grande y la pantalla responde *"No se pudo eliminar: la remesa es demasiado grande para borrarla
desde la pantalla. Avisá a soporte."*), avisá a soporte antes de volver a cargar. Si el archivo era una división, solo se elimina la
remesa interrumpida y al volver a subir el archivo los cortes que ya se cargaron vienen destildados. **Si en la
vista de cortes no aparece la columna Estado ni ningún corte destildado, el sistema no reconoció el archivo** (lo
reconoce por sus bytes exactos: si volviste a bajarlo del cedente y salió distinto, no lo reconoce): no sigas
tildando todo, mirá en el Historial las remesas de esa división y destildá a mano los cortes de las que están
FINALIZADAS, de las que todavía se están cargando y de las fallidas que llegaron a cargar casos.

Si el título es **"Importación cancelada"**, la carga no falló: alguien la cortó. Lo ya procesado quedó cargado
y el cierre no corrió; qué hacer lo dice su motivo (ver [Importar un archivo](/ayuda/importacion/importar-un-archivo),
"Cancelar una importación").

### Los números no cierran y tampoco aparecen contactos

Además de los teléfonos, los **mails con basura evidente** (`sin@mail`, dominios sin punto) se
descartan sin registro. Los que fallan la verificación del dominio sí se guardan, marcados como no
verificados.

### Los números no cierran y no hay errores

Tres candidatos: filas descartadas por **filtro** (no cuentan como error), **casos colapsados** porque
dos filas comparten el documento, o **contactos descartados** en silencio por no poder normalizarse.
En una carga nueva, la tarjeta **Qué hizo la carga** (en el resultado y en el detalle) pone número a los dos
últimos: *"N filas cayeron sobre un caso que esta misma carga ya había creado…"* (en Deudores) y *"N filas no
tenían un contacto principal válido…"* (en Contactos y Enriquecimiento), los dos en naranja. Lo segundo es solo
el contacto principal: los contactos de bloques descartados en Deudores, Deudores y Facturas o Actualizaciones
no se cuentan en ningún lado.

Si el cedente manda **varias cuentas por titular** —Telecom y Personal: la cuenta madre y las hijas—,
el segundo caso es sistemático: con identidad por documento entra una sola cuenta por DNI y las demás
se pisan. La plantilla tiene que identificar los casos por **Nº de cliente**, y la vista previa avisa
cuántas cuentas se van a perder antes de cargar. Es también la causa de que después fallen **todas**
las facturas y los pagos de esas cuentas con "Deudor no encontrado".

---

## Preguntas frecuentes

**¿Puedo volver a importar el mismo archivo?**
Importar de nuevo crea **otra remesa**: una remesa que procesó filas no se puede volver a ejecutar (solo se retoma la que no cargó ninguna). En
Deudores y en Deudores y Facturas los mismos clientes quedan como casos nuevos de esa remesa (un caso
es el cliente más la remesa), no se actualizan los de la anterior; si la primera carga falló, borrá esa
remesa antes de volver a subir. En Pagos hay un
anti-duplicados: con el **ID del cobro** mapeado en la plantilla, un archivo acumulativo se puede
recargar todas las veces que haga falta. En Actualizaciones, cuidado con las opciones de ausentes.

**¿El historial guarda quién hizo cada carga?**
Sí, y también queda en la auditoría — igual que borrar una remesa y revertir una acción.

**¿Puedo ver el archivo original que se subió?**
Queda guardado en el servidor, pero **no se puede descargar desde la aplicación**. Si lo necesitás, hay
que pedirlo a sistemas.

**¿Revertir una acción masiva devuelve los comentarios que borró?**
No. Revertir **borra** los comentarios que la acción creó, y eso no se recupera.
