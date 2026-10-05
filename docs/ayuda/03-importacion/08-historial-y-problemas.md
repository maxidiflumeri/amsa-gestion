<!--
seccion: Importación de datos
resumen: Ver qué pasó con una carga, revisar los errores fila por fila, y qué se puede deshacer y qué no.
revisado: 2026-10-05
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
- Para revertir acciones masivas, el permiso de **acciones masivas**.
- Para consolidar, **Ejecutar consolidación de situación**.

---

## Los estados

| Estado | Qué significa |
|---|---|
| **Pendiente** | Creada (subiste el archivo), o confirmada y esperando su turno en la cola |
| **Validando** | Con la vista previa hecha y sin confirmar |
| **Procesando** | En curso |
| **Finalizada** | Terminó. Puede ser con filas con error, sin filas o con advertencias |
| **Fallida** | Se cortó |

En la grilla aparecen en mayúsculas. Al entrar al **detalle**, una carga que no se confirmó dice
**Borrador** (*"Vista previa sin confirmar. No se cargó nada."*) y una que espera su turno dice **En
cola** (*"Esperando que termine otra importación."*).

El Historial **no distingue** una carga "con advertencias": la muestra como FINALIZADA a secas. Lo que
queda es la notificación (con ícono de advertencia) y el cartel arriba del detalle.

**Finalizada no significa "salió bien"**: significa que terminó. Mirá siempre la columna de filas con
error, y el resultado que mostró el paso 5 (ver [Importar un archivo](05-importar-un-archivo.md)).

La campanita de la barra superior **no muestra las vistas previas sin confirmar**: en
**Importaciones en curso** solo figuran las cargas que se confirmaron y todavía no terminaron.

## Ver el detalle y los errores

Entrando a una remesa ves el resumen y, si hubo filas rechazadas, **el detalle fila por fila**: qué
número de fila era, qué traía y por qué falló. Muestra **solo los primeros 100**. Si la carga solo tuvo
avisos y ninguna fila con error, la tabla se llama **Avisos de la carga**. Los avisos
(`[aviso]`, `[parseo]`, `[post-proceso]`) figuran con **—** en lugar del número de fila y salen
primeros; una fila con error siempre lleva su número (la primera fila de datos es la 0; el número no cuenta el
encabezado ni las filas descartadas por filtro). Con varios archivos, el mensaje trae el
`[archivo:línea]`: la línea es la fila de datos dentro de ese archivo, contando desde 1 y sin el
encabezado (si el archivo tiene encabezado, es la línea siguiente). Los avisos
cuentan aunque ninguna fila haya dado error: incluyen los que escriben las propias categorías al cargar
(los de Pagos con número de convenio y los de Claves de pago, más abajo). Una carga que falló, que
terminó con advertencias o que no tenía filas muestra además un cartel arriba con el motivo.

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
  en [Claves de pago](10-claves-de-pago.md)).

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

Una carga de **Acciones masivas** finalizada tiene botón de **revertir**: deja los casos como estaban (con las salvedades de una carga "con advertencias" o reiniciada: ver la fila de Acciones masivas de la tabla de advertencias y [Acciones masivas](07-acciones-masivas.md)).
Se puede una sola vez.

**Ninguna otra categoría tiene deshacer.** No hay botón de revertir para deudores, facturas, pagos,
contactos ni actualizaciones.

### Borrar la remesa — con dos condiciones grandes

Se puede borrar una remesa en cualquier estado **salvo mientras está corriendo** (arrancó y todavía no
terminó). Una carga **en cola que todavía no arrancó sí se puede borrar**: el sistema la saca de la cola
y borra la remesa. Si está corriendo, si su trabajo está activo o si la cola no se puede consultar, el
sistema la rechaza con *"No se puede eliminar una importación en curso"*.
En la grilla el botón solo se deshabilita en las que están procesando. Pero:

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

> ### ⚠ Una acción masiva FALLIDA no se puede revertir
>
> El botón solo aparece si la carga quedó **finalizada**. Si se cortó a mitad de camino, los cambios
> que alcanzó a aplicar quedan aplicados y **no hay información para deshacerlos**: los datos que
> permiten revertir se guardan recién al terminar bien.

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

Alguien ya trabajó sus casos: hay comentarios, pagos, convenios o llamadas. Es intencional — borrarla
se llevaría ese trabajo puesto.

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

Mientras esté procesando no se puede borrar. Entrá al detalle a ver el progreso: si el último latido del
servidor es de hace 5 minutos o más, la pantalla lo avisa con *"Sin novedades del servidor hace N min…"*.
La edad se mide con la hora del servidor, así que el aviso aparece **apenas abrís la pantalla** si la
carga ya estaba colgada, aunque tu reloj esté desfasado. Solo aparece procesando: no en cola ni en
post-proceso.

**Una carga colgada no falla sola.** Hoy nada la marca como fallida ni libera el bloqueo de una
importación por vez. Si el servidor se reinició, es posible que se retome desde el principio una vez
(aparece *"Esta carga se reinició (intento 2)"*). Si el aviso sigue creciendo y la carga no avanza,
avisá a soporte.

El síntoma con el que te vas a topar: **no te deja arrancar otra importación**. El sistema permite una
sola por usuario a la vez.

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
| **Acciones masivas** | Guardar los datos que permiten revertir la acción | Avisar a soporte. **No uses Revertir**: puede deshacer solo una parte y se puede una sola vez |
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
ejecutada no se puede volver a ejecutar; subir el archivo de nuevo crea **otra remesa**. Qué pasa
depende de la categoría:

- **Deudores y Deudores y Facturas:** los mismos clientes quedan como casos **nuevos** de la remesa
  nueva (un caso es el cliente más la remesa): quedarían duplicados.
- **Pagos:** los cobros que ya estaban cargados se saltean y **no se vuelven a consolidar**, así que
  resubir no completa el cierre que faltó. Hay que consolidar como dice la tabla.

En el detalle de la remesa, arriba está el cartel con el motivo y en la tabla una fila **[post-proceso]**.

### La importación falló

Ver [Importar un archivo](05-importar-un-archivo.md): no se reintenta la misma remesa, el cierre no
corrió (la tabla de arriba dice qué es ese cierre en cada categoría) y, en Deudores y Deudores y
Facturas, hay que borrar la remesa fallida antes de volver a subir el archivo. En Pagos, si entraron
filas antes del corte, volver a subir el archivo las saltea y sus casos quedan sin consolidar: aplicá el
mismo criterio que en la tabla de advertencias.

### Los números no cierran y tampoco aparecen contactos

Además de los teléfonos, los **mails con basura evidente** (`sin@mail`, dominios sin punto) se
descartan sin registro. Los que fallan la verificación del dominio sí se guardan, marcados como no
verificados.

### Los números no cierran y no hay errores

Tres candidatos: filas descartadas por **filtro** (no cuentan como error), **casos colapsados** porque
dos filas comparten el documento, o **contactos descartados** en silencio por no poder normalizarse.

Si el cedente manda **varias cuentas por titular** —Telecom y Personal: la cuenta madre y las hijas—,
el segundo caso es sistemático: con identidad por documento entra una sola cuenta por DNI y las demás
se pisan. La plantilla tiene que identificar los casos por **Nº de cliente**, y la vista previa avisa
cuántas cuentas se van a perder antes de cargar. Es también la causa de que después fallen **todas**
las facturas y los pagos de esas cuentas con "Deudor no encontrado".

---

## Preguntas frecuentes

**¿Puedo volver a importar el mismo archivo?**
Importar de nuevo crea **otra remesa**: una remesa ya ejecutada no se puede volver a ejecutar. En
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
