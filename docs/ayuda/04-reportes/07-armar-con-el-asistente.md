<!--
seccion: Reportes
resumen: Armar una plantilla de reportes pidiéndosela al asistente, con o sin un archivo de ejemplo: qué hace, cómo se revisa y cómo se guarda.
revisado: 2026-10-19
rutas: /reportes
-->
# Armar un reporte con el asistente

## Para qué sirve

En vez de armar la plantilla columna por columna, se la pedís al asistente: le **describís el reporte** o le
**adjuntás un archivo de ejemplo** (el Excel o el TXT que te pidió el cedente) y te arma una plantilla con los
campos del sistema. Después la abrís en el editor de reportes, la revisás y la guardás vos.

Es un modo aparte del asistente de ayuda. El de ayuda te explica cómo se usa la plataforma (ver
[El asistente](/ayuda/primeros-pasos/el-asistente)); este **arma plantillas**.

**Lo que no hace:**

- **No guarda nada.** La plantilla no existe hasta que tocás **Guardar** en el editor.
- **No ve los datos de los casos.** Del archivo de ejemplo lee la *forma* (ver más abajo) y de la base solo recibe
  cantidades. Nunca los nombres, documentos ni teléfonos que hay en el archivo o en la base. **Lo que escribís vos en
  el mensaje sí le llega entero**: no pongas documentos, teléfonos ni nombres.
- **No ejecuta el reporte.** Eso se hace igual que siempre, desde [Ejecutar y descargar](/ayuda/reportes/ejecutar-y-descargar).

## Antes de empezar

Hacen falta **cuatro permisos**: *Usar el asistente*, *Asistente: armar reportes*, *Ver reportes* y *Crear
reportes*. Si falta alguno, no aparece el selector de modo en el panel. Se piden a quien administre los roles (ver
[Roles y permisos](/ayuda/administracion/roles-y-permisos)); después hay que cerrar sesión y volver a entrar.

> **Este modo cuesta bastante más que el de ayuda.** Usa un modelo más potente, y el panel te lo avisa apenas lo
> elegís. Usalo para armar reportes, no para preguntar cómo se hace algo: para eso está el modo **Ayuda**.

## Cómo se pide

1. Abrí el asistente. Si estás en **Reportes**, el botón **Armar con el asistente** (al lado de **Nueva
   plantilla**) lo abre ya en el modo correcto. En otra pantalla, arriba del panel elegí **Armar un reporte**.
2. Escribí qué necesitás. Si tenés un ejemplo, adjuntalo y escribí aunque sea una línea (*"armalo igual a este"*): no se puede mandar solo el archivo. El modo se acuerda de cómo lo dejaste la
   última vez; si cambiás de modo, empieza una conversación nueva.
3. Mientras trabaja, el panel va mostrando los **pasos**. Al final aparece la **tarjeta** con la propuesta.

Ejemplos de pedidos:

- *"Armame un listado de los casos de TELECOM con su teléfono."*
- *"Igual a este archivo, pero de Toyota y solo los de más de 90 días de mora."* (con el ejemplo adjunto)
- *"Un CSV con ; de separador, en latin1, con los pagos de la semana."*

Si le falta algo que cambia el resultado (de qué empresa, cuál período, cómo se parte un archivo de ancho fijo),
**te pregunta una sola cosa** antes de armar. Contestale en el mismo cuadro.

### Con un archivo de ejemplo

Tocá el clip, o **arrastrá el archivo sobre el panel**. Si lo soltás con el modo **Ayuda** puesto, el panel te
ofrece pasar a **Armar un reporte**.

| | |
|---|---|
| **Tipos** | `.xlsx`, `.xls`, `.csv`, `.txt` y `.tsv` |
| **Tamaño** | Hasta 5 MB por archivo |
| **Cantidad** | Hasta 3 archivos por mensaje y 6 por conversación |
| **Lo que lee** | Hasta 60 columnas, y de cada hoja las primeras 200 filas; hasta 5 hojas |

Si adjuntás varios, el **primero que subiste en la conversación** es el principal: las columnas del reporte salen de ese; los otros sirven para
sumar datos (por ejemplo, un archivo con el formato y otro con los teléfonos).

Cuando el archivo se sube, queda una etiqueta como **XLSX · ejemplo.xlsx · 9 columnas**, con los primeros
encabezados que se tomaron. Si el archivo tiene más de 60 columnas, más de 200 filas o más de 5 hojas, aparece un aviso
debajo. Si no tiene encabezados, lo dice el paso *"Leí el ejemplo…, sin encabezado"*. Con el menú **⋮** de la etiqueta podés:

- decir **"La primera fila no es el encabezado"**, para que el asistente tome esa fila como datos y no como títulos. Deshacerlo no se puede desde el menú: **Quitá** el archivo y volvelo a subir (el resumen no guarda la primera fila, justamente para no guardar datos);
- **Quitar** el archivo.

**No se aceptan** los `.xlsm` y `.xlsb` (guardalos como `.xlsx`), los archivos con contraseña ni los que se
llaman de una manera y son de otra (un `.xlsx` renombrado a `.csv`). Los **PDF y las imágenes** tampoco, por ahora.

#### Qué lee del archivo, y qué no

El asistente **no recibe los valores** del archivo. Recibe:

- el nombre, el tipo y las hojas;
- los **encabezados** y el orden de las columnas;
- de qué tipo es cada una (número, fecha, texto) y cómo está escrita (por ejemplo, `DD/MM/AAAA`, o "importe con 2
  decimales");
- qué columnas vienen vacías;
- la **forma** de algunos valores: cada dígito se reemplaza por un 9 y cada letra por una X. Un DNI es `99999999`,
  un nombre es `Xxxxx`. Con eso alcanza para entender que una columna es un documento o una patente.

La excepción son los valores que coinciden **exactamente con una lista del propio sistema**, por ejemplo el nombre
de una empresa o un código de situación.

**Ojo con un archivo de una sola fila.** Si esa fila tiene solo textos (por ejemplo, un nombre, una dirección y una
localidad), se puede tomar como la fila de encabezados, y esos textos llegan tal cual al asistente. Los documentos,
teléfonos, mails e importes nunca llegan: siempre se reemplazan por su forma. Antes de mandar, mirá en la etiqueta del
archivo los encabezados que se tomaron. Si son datos, usá **⋮ → La primera fila no es el encabezado**. Lo más simple
es mandar un ejemplo con la fila de títulos arriba.

**El archivo no se guarda.** Se lee, se descarta, y queda solo ese resumen sin datos, junto con la conversación
(90 días). Si hace falta leerlo de nuevo, lo volvés a subir.

## Los pasos

Son las líneas con un tilde que aparecen antes de la tarjeta. Las escribe el sistema, no el modelo, y nunca
llevan datos. Por ejemplo:

- *Leí el ejemplo «cartera.xlsx»: 9 columnas y 3 filas*
- *Busqué los valores de Empresa*
- *Probé la plantilla: 8.412 casos, sin errores*

Un ⚠ es un aviso (por ejemplo, *"1 columna vacía en la muestra"*) y un ícono rojo con una exclamación es un problema: a veces el asistente lo corrige solo
(*"La prueba encontró 2 problemas: los corrijo"*) y a veces te lo cuenta (*"la base está ocupada"*). Mientras trabaja, la última línea tiene un
círculo girando.

Una propuesta **solo se muestra si la prueba salió sin errores**: el sistema la valida contra los campos y las
reglas reales del constructor antes de mostrártela.

## La tarjeta

De arriba abajo:

1. **El mensaje** del asistente: qué no encontró, qué aproximó, qué supuso. Leelo siempre.
2. **Tu columna → Sale de.** Una fila por columna. El ícono dice cómo quedó:

   | Ícono | Significa |
   |---|---|
   | ✓ verde | **Encontrada**: hay un campo del sistema que es eso |
   | ⚠ amarillo | **Aproximada**: hay uno parecido pero no igual. La nota dice en qué difiere y se ve debajo |
   | ⊖ gris | **Sin campo**: nada del sistema la produce. Sale como **columna vacía**, para respetar la estructura del archivo |
   | ⊕ azul | **Agregada**: una columna que pediste y no estaba en el ejemplo |

   Debajo de cada una puede haber el **formato** (*DD/MM/YYYY*, *2 decimales, coma decimal, punto de miles*) y,
   cuando la columna sale de varios elementos, **qué se hace con ellos**: *todos (comentarios), separados por «, »*,
   *el último cargado (pagos)* o *una fila por cada uno*. Si son más de 6 columnas, se muestran 5 y un botón **y N columnas más** despliega el resto.
   En un celular, la tabla pasa a una lista (*DNI → Documento*).
3. **Filtros**, **Orden** y **Formato**. Si no hay filtros, la tarjeta lo marca en amarillo: **"Sin filtros: trae
   todas las carteras"**. Revisá siempre este renglón.
4. **La vista previa**: unas 5 filas de muestra, con scroll propio. Aparece sola en la tarjeta nueva; en las
   viejas, o al volver a abrir una conversación, hay un botón **Ver vista previa** en la propuesta vigente (así mirar una conversación del
   pasado no consulta la base). Las versiones viejas quedan en una línea, sin vista previa. Los datos vienen **enmascarados**:

   | Dato | Cómo se ve |
   |---|---|
   | Documento | `··· 4521` (los últimos 4) |
   | Nombre y apellido | Las iniciales: `M. L. G.` |
   | Teléfono | Característica y últimos 4: `11 ···· 8807` |
   | Mail | `m···@dominio.com` |
   | Comentarios, domicilios, observaciones | `(texto de 120 caracteres)` |
   | Datos adicionales | Solo la forma (`99-XXX`) |
   | Importes, fechas, códigos, estados, empresa | Tal cual |

   Se enmascara porque el panel queda a la vista de quien pase. **El editor, en cambio, muestra todo**, como
   siempre. Las filas de la vista previa no se guardan en ningún lado.
5. **"La consulta completa trae N casos."** Es la cantidad de casos que entran con esos filtros. **Los filtros
   variables** (los que se piden al ejecutar) **no se aplican** ni en el conteo ni en la vista previa **si no tienen
   valor por defecto**: si la empresa se pide al ejecutar y no tiene valor por defecto, el número es el de la consulta sin ese filtro
   (por ejemplo, el de todas las carteras). Si dice **(aprox.)**, el número es del primer paso de la
   consulta y el real puede ser bastante menor (ver más abajo).
6. **Avisos**, en amarillo: hasta tres, y **Ver N más**.
7. **La acción**: *"¿La abro en el editor para que la revises y la guardes?"*, con **Abrir en el editor** y
   **Ajustar algo antes**.

## Abrir en el editor y guardar

1. Tocá **Abrir en el editor**. Te lleva a **Nueva plantilla** con todo cargado: nombre, columnas, filtros y
   formato. Arriba hay un aviso: *"Esta plantilla la armó el asistente y **todavía no existe**. Revisala y tocá
   **Guardar**."*
2. Si ya tenías algo armado y sin guardar en esa pantalla, antes te pregunta si querés **reemplazar lo que tenés
   armado**. Con **Seguir con lo mío** no se toca nada: si estabas editando una plantilla que ya existe, volvés a ella con tus cambios, y **Guardar** la actualiza (no crea una copia).
3. Revisá y cambiá lo que quieras. Casi todo se edita a mano, incluidos los tipos nuevos (*Días desde la fecha*,
   decimales y separadores) y las fechas relativas (ver [Armar un reporte](/ayuda/reportes/armar-un-reporte) y
   [Filtros](/ayuda/reportes/filtros)).
4. Tocá **Guardar**, como siempre. Recién ahí la plantilla existe.

Después, la tarjeta del panel dice **Guardada como «…»** y un botón **Ver la plantilla**. Si salís del editor sin
guardar, la propuesta sigue en la conversación: dice *"La abriste en el editor"* y con **Abrir de nuevo** la
cargás otra vez.

> **En pantallas que no son muy grandes (menos de 1536 px) el panel tapa lo que hay detrás.** Por eso, al abrir
> el editor se cierra solo. Lo volvés a abrir con el botón **Asistente** y la conversación sigue ahí.

En [Auditoría](/ayuda/administracion/auditoria) el alta se ve como la de cualquier plantilla, con el dato de que
salió de una propuesta del asistente.

## Ajustar lo que armó

**Ajustar algo antes** no manda nada: lleva el cursor al cuadro de texto, que pasa a preguntar *"¿Qué querés
cambiar?"*. Escribí el cambio con tus palabras ("sumá el teléfono alternativo", "que salga en CSV separado por
punto y coma"). Debajo de la tarjeta a veces hay **sugerencias**: un clic y se manda el texto.

- **No hace falta volver a subir el ejemplo**: se acuerda de él.
- Parte de la **última propuesta** y cambia solo lo que pediste.
- Cada ajuste es una **versión nueva**: la tarjeta dice *Versión 2*, y las anteriores quedan en una línea
  (*Versión 1 · «nombre» · Abrir esta versión*), por si preferís volver a una.
- Cada ajuste vuelve a probar la plantilla y es otro pedido más del límite diario.

Una conversación de reportes aguanta unos **12 pedidos**. Después aparece *"Esta conversación ya es muy larga.
Empezá una nueva: la última propuesta sigue disponible en su tarjeta"*: la tarjeta sigue sirviendo para abrir el
editor.

## Lo que el motor de reportes no hace

Si el ejemplo pide alguna de estas cosas, la columna sale **aproximada** o **sin campo**, y el asistente te lo
dice:

- **Unir dos campos en una columna** (nombre y apellido juntos).
- **Cuentas entre campos** (saldo menos pagos). Las cuentas van en Totales o en filtros.
- **Un "o" entre campos distintos.** Solo existe "en lista" dentro de un campo.
- **Elegir el teléfono principal.** Los contactos salen en el orden en que se cargaron: el asistente puede
  armar "el primer teléfono" o "el segundo", pero no el prioritario.
- Signos de moneda, varias hojas en el Excel, fórmulas, colores, logos y anchos de columna en Excel.
- El PDF sale en A4 vertical: con muchas columnas no entra.

Lo que sí arma y la pantalla del editor **no ofrece armar a mano**:

- **el 2.º teléfono**, o el teléfono de cierto tipo;
- **columnas con una cuenta** (cuántos pagos tiene el caso, la suma de lo pagado, el último pago);
- el **TXT de ancho fijo**, con cada columna alineada a la izquierda o a la derecha y rellena con espacios o con
  ceros (los ceros exigen alineación a la derecha). El editor lo muestra en el recuadro *Opciones que no se editan acá* y lo conserva al guardar, pero no lo
  configura.

Las fechas relativas, los días desde una fecha y los decimales de los números, en cambio, también se pueden armar a
mano (ver [Armar un reporte](/ayuda/reportes/armar-un-reporte) y [Filtros](/ayuda/reportes/filtros)).

## Límites y costo

- **40 pedidos de reportes por persona por día** (quien administra puede cambiar ese número). Al llegar, el panel
  dice *"Llegaste al límite de … pedidos de reportes de hoy. Mañana se renueva."* Estos pedidos **también cuentan
  dentro de las 100 preguntas por día** de la plataforma: quien hizo 40 pedidos de reportes tiene 60 preguntas de
  ayuda para ese día. Si lo que se agotó es el límite general, el cartel dice *"Llegaste al límite de … preguntas
  de hoy…"*, también en este modo.
- Si la función llega a su **tope de gasto mensual**, el panel avisa que está pausada, igual que en la ayuda (ver
  [El asistente](/ayuda/primeros-pasos/el-asistente)). El **tope por pedido** es otra cosa: corta esa respuesta con
  *"Me quedé sin margen de gasto para esta respuesta"*; probá pedir algo más concreto o en dos partes.
- Armar una plantilla suele costar entre **US$ 0,07 y 0,20**, ajustes incluidos.

## Qué puede salir mal

**Elegí "Armar un reporte" y dice que el asistente está pausado por un administrador.** La función está apagada (nace
apagada) y la ayuda sigue andando. Avisale a quien administra el asistente.

**No veo el selector "Armar un reporte".** Te falta alguno de los cuatro permisos (ver *Antes de empezar*).
Si te los dieron hace un rato, cerrá sesión y volvé a entrar. Si lo veías y desapareció con un cartel que explica que
faltan permisos, te los sacaron: pedíselos de nuevo a quien administre los roles.

**Me preguntó de qué empresa.** Pasa cuando el nombre se puede confundir. Hay varias empresas que empiezan con
TOYOTA, por ejemplo: contestale con el nombre exacto. Ojo: la **empresa de la plantilla** (la que se elige en
*Detalles*) solo sirve para usar los datos adicionales de ese cedente. **No filtra los casos**: para que el reporte
sea de una empresa, tiene que haber un **filtro** de empresa, y la tarjeta tiene que mostrarlo.

**No entendió mi archivo de ancho fijo.** Un archivo de ancho fijo (sin separadores, columnas por posición) no
dice dónde corta cada campo. Si no tiene encabezados, el asistente te va a preguntar cómo se parte; contestale con
los anchos, en orden. Si el archivo trae títulos y la etiqueta no los muestra (no aparece *"Columnas: …"*),
escribíselos al asistente en el mensaje.

**La primera fila no es el encabezado.** Pasa con los archivos que arrancan directo con datos. En la etiqueta del
archivo, **⋮ → La primera fila no es el encabezado**. El asistente pasa a tomar esa fila como datos y a identificar
las columnas por posición. Para deshacerlo, **Quitá** el archivo y volvelo a subir.

**Una columna salió "Sin campo".** Ese dato no existe en el sistema (o el asistente no lo encontró). Sale como
columna vacía, para que el archivo conserve la cantidad de columnas que espera quien lo recibe. Si creés que
sí existe, decile cuál es ("esa columna es el modelo del auto: está en los datos adicionales de Toyota") y
la corrige.

**El teléfono no es el principal.** El reporte devuelve el primero que se cargó, no el que la ficha marca como
prioritario. La tarjeta lo marca como **aproximada**. No hay forma de pedir el prioritario.

**El total dice "aprox.".** Algunos filtros se aplican después de traer los datos, y el número que se ve es el de
la primera búsqueda. Sirve para saber si son decenas o miles de casos, no para contarlos: el real puede ser bastante menor. Si dice *"No se pudo
contar los casos a tiempo"*, la base tardó demasiado; el reporte igual se puede abrir y ejecutar.

**Dice que el ejemplo es demasiado grande.** El pedido se corta antes de llegar al asistente. Quitá un archivo o usá
uno más chico: el texto que escribiste y los archivos vuelven al cuadro, así que sacás el que sobra y mandás de nuevo.

**Al subir un archivo dice que hay muchos archivos leyéndose.** El servidor está ocupado; en la etiqueta aparece
**Reintentar**, que lo sube de nuevo.

**La vista previa tardó demasiado.** El botón **Volver a pedirla** la intenta de nuevo. La plantilla no se ve afectada.

**No me deja adjuntar un PDF o una imagen.** Por ahora solo se leen Excel, CSV y TXT. Pasalo a alguno de esos
formatos, o describí las columnas con palabras.

**Dice "Esta conversación ya es muy larga".** Empezá una conversación nueva (**Nueva conversación**, en el menú
**⋮** del panel). La última propuesta sigue disponible en su tarjeta para abrirla en el editor.

**Quedé sin pedidos por hoy.** Mañana se renueva. Mientras tanto, el editor de reportes funciona igual, a mano.

**La propuesta tiene un filtro de fecha que no entiendo (*"hace 90 días"*).** Es una fecha **relativa a hoy**: se
recalcula cada vez que ejecutás el reporte. Se ve y se cambia en la solapa **Filtros** del editor.

## Preguntas frecuentes

**¿Puedo pedirle que guarde la plantilla?**
No. La guardás vos desde el editor, con el botón de siempre.

**¿Ve los datos de la cartera?**
No. Del ejemplo ve la forma, y de la prueba solo recibe cantidades. Las filas de la vista previa van del servidor a tu
pantalla, enmascaradas, sin pasar por el asistente.

**¿Cuánto tarda?**
Una propuesta suele llevar entre 15 segundos y un minuto, porque prueba la plantilla contra la base antes de
mostrártela. Podés cerrar el panel: sigue trabajando.

**¿Puedo seguir una conversación de la semana pasada?**
Sí, desde **Conversaciones anteriores** del menú **⋮**, con el modo **Armar un reporte** elegido. Se guardan 90
días, con el resumen del ejemplo (no el archivo).

**¿Sirve para editar una plantilla que ya existe?**
No: arma plantillas nuevas. Para cambiar una que ya existe, usá el editor.
