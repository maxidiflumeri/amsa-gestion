<!--
seccion: Importación de datos
resumen: Cómo se le enseña al sistema a leer el archivo de un cedente, campo por campo.
revisado: 2026-08-20
rutas: /plantillas
rutaPrincipal: /plantillas
-->
# Crear una plantilla de importación

## Para qué sirve

Cada cedente manda sus archivos como quiere: uno pone el DNI en la primera columna, otro en la
séptima; uno escribe las fechas `15/03/2026` y otro `20260315`; uno separa con `;` y otro no separa
con nada. **La plantilla es la traducción entre ese archivo y el sistema.**

Se arma una vez por cedente y por tipo de archivo, y después se reutiliza en cada carga. Si el
cedente cambia el formato, se corrige la plantilla — no hace falta tocar el sistema.

## Antes de empezar

- El permiso **Crear plantillas de importación**. Sin él vas a poder abrir el formulario igual, pero
  el Guardar va a fallar.
- **La empresa ya creada** en Ajustes → Empresas.
- **Los parámetros de esa empresa cargados.** La plantilla exige elegir un *estado de situación
  inicial* y un *estado de gestión inicial*, y sin parámetros esas listas vienen vacías y no vas a
  poder guardar. Es la causa más común de que una plantilla nueva no se deje grabar.
- **Una muestra real del archivo.** No una descripción: el archivo.

> Abrí la muestra en un editor de texto plano, no en Excel. Excel te miente: convierte números en
> fechas, se come los ceros a la izquierda de un DNI y no te deja ver si el separador es `;` o tab.

---

## Las tres decisiones de una plantilla

| | Qué responde | Ejemplo |
|---|---|---|
| **Categoría** | ¿Qué *trae* el archivo? | Deudores, facturas, pagos… |
| **Formato** | ¿Cómo está *escrito*? | Separado por `;`, ancho fijo, Excel |
| **Mapeo** | ¿Qué *significa* cada columna? | La columna 3 es el monto |

Y una cuarta que no se elige pero conviene entender desde el principio: **cómo el sistema reconoce
que dos filas son el mismo caso**. Va más abajo, porque es la que más consecuencias tiene.

---

## Paso 1 — Elegir la categoría

Ir a **Importación de Datos → Plantillas → Nueva plantilla**.

La categoría condiciona todo el resto: qué campos podés mapear, qué opciones aparecen y qué hace el
sistema con cada fila.

| Categoría | Cuándo usarla |
|---|---|
| **Deudores** | El archivo trae los casos: quién debe y cuánto. Es el archivo base. |
| **Facturas** | El detalle de la deuda, para casos **ya cargados**. Una fila por factura. |
| **Pagos** | Cobranzas a registrar contra casos ya cargados. |
| **Contactos** | Teléfonos, mails y domicilios de casos ya cargados. |
| **Enriquecimiento** | También carga **teléfonos, mails y direcciones** contra casos ya cargados. Casi lo mismo que Contactos. |
| **Deudores y Facturas** | El caso **y** su deuda al detalle. Cubre dos formas de archivo distintas — ver abajo. |
| **Actualizaciones** | El cedente informa cómo quedó la cartera: qué se pagó, qué deuda nueva hay, a quién ya no se gestiona. |
| **Acciones masivas** | Un listado de casos para marcarles algo en bloque: situación, gestión, un comentario, borrar un teléfono. |
| **Multirregistro** | **Un** archivo con **varios tipos de línea** mezclados. |
| **Multiarchivo** | **Varios** archivos que se cargan juntos y se cruzan entre sí. |

> **Enriquecimiento no carga "datos adicionales".** El nombre engaña: carga contactos, igual que la
> categoría Contactos. Los datos adicionales se cargan desde Deudores, Deudores y Facturas, Facturas,
> Actualizaciones o Acciones masivas, mapeando **campos extras**.

> **Multirregistro y Multiarchivo no se arman con el editor de mapeo.** Se configuran pegando un JSON
> a mano, partiendo de un preset. Las arma un técnico, no se editan desde la pantalla como el resto.

### Deudores y Facturas cubre dos formas de archivo

Es la categoría que más se malinterpreta, porque sirve para dos cosas que parecen distintas:

**Forma A — todo en la misma fila.** El caso y sus facturas juntos, con las facturas mapeadas como
bloques repetitivos (`Factura 1`, `Vto 1`, `Factura 2`, `Vto 2`…).

**Forma B — el deudor se repite, una fila por factura.** Es la más común:

```
DOCUMENTO;NOMBRE;FACTURA;IMPORTE;VTO
20123456789;PEREZ JUAN;A-0001;15.300,00;10/01/2026
20123456789;PEREZ JUAN;A-0002;15.300,00;10/02/2026
20123456789;PEREZ JUAN;A-0003;16.100,00;10/03/2026
27987654321;GOMEZ MARIA;B-0044;42.000,00;05/02/2026
```

Ahí hay **dos casos y cuatro facturas**, no cuatro casos. El sistema reconoce que las tres primeras
filas son el mismo deudor y, en vez de duplicarlo, le va agregando cada factura. No hay que
configurar nada especial: es el comportamiento normal de la categoría.

> **Toda fila tiene que traer al menos una factura.** Una fila sin número de factura se rechaza con
> error; no carga un caso "pelado".

#### El importe del deudor

En la sección **Importe del deudor** elegís de dónde sale el monto del caso:

| Opción | Qué hace |
|---|---|
| *Solo si el deudor vino sin importe* (por defecto) | Suma las facturas únicamente si el archivo no trajo monto |
| *Siempre (las facturas son la fuente de verdad)* | Suma las facturas y pisa el monto del archivo |
| *No calcular* | Respeta lo que diga el archivo |

En el ejemplo de arriba, PEREZ queda en $46.700 y GOMEZ en $42.000. Esta opción también aparece en la
categoría **Facturas**.

### Cómo elegir sin equivocarse

**¿El archivo crea casos nuevos o le agrega algo a casos que ya están?**

- Crea casos → **Deudores** si trae solo el total; **Deudores y Facturas** si trae el detalle.
- Le agrega algo a casos existentes → **Facturas**, **Pagos**, **Contactos** o **Enriquecimiento**.
- Le cambia el estado a casos existentes → **Actualizaciones** o **Acciones masivas**.

Entre esas dos últimas, que es la confusión más común:

- **Actualizaciones** es el cedente diciéndote **cómo quedó la deuda**. El sistema reconcilia con
  criterio propio: genera pagos, crea facturas de ajuste y decide qué hacer con los ausentes. Tiene
  varias opciones y son de alto impacto — **tiene su propia página**.
- **Acciones masivas** es para **vos**: tenés un listado y querés marcarle algo. No reconcilia nada.
  También tiene su propia página, porque uno de sus modos borra contactos de toda la cartera.

---

## Paso 2 — Formato y separador

El campo se llama **Formato / Separador** y de él salen todas las variantes:

| Opción | Cuándo |
|---|---|
| Excel (.xls, .xlsx) | El cedente manda planilla |
| CSV - Coma (,) · Punto y coma (;) | Los más comunes |
| TXT - Pipe (\|) · Tabulador (TAB) | |
| **TXT - Ancho fijo (sin separador)** | Ver abajo |
| Otro personalizado… | Escribís el separador que sea |

### El archivo tiene encabezado

Tildalo si la primera fila trae los nombres de las columnas. Si no lo tildás y el archivo sí lo tiene,
esa fila se intenta importar como un caso — y vas a terminar con un deudor llamado "NOMBRE".

### Ancho fijo

Algunos cedentes (típicamente los que exportan de SAP) mandan archivos **sin separador**: cada campo
ocupa siempre las mismas posiciones, rellenado con espacios.

```
9000001028  102     0001453664BURGOS                    000001600610
```

**No midas a mano.** El editor tiene un botón **Inferir del archivo**: le das una muestra y arma el
layout solo, detectando dónde empieza y termina cada campo. Después lo revisás y corregís los nombres.

El layout se escribe con una columna por línea:

```
Of. Cobro;0;10
Distrito;10;8
Cta. Cto.;68;12
```

Es `nombre;posición inicial;cantidad de caracteres`. La posición arranca en **0**. Las líneas que
empiezan con `#` se ignoran, así que sirven para comentar.

El editor te muestra el **ancho total que cubre el layout** y lo compara con el largo real de la
línea. Si no coinciden, te avisa — pero **no te lo impide**: podés guardar e importar un layout que no
cierra, y los campos van a salir corridos. Miralo siempre.

### Codificación

**Ya viene en Latin-1 por defecto**, que es lo correcto para archivos de SAP. Si los acentos y las Ñ
te salen rotos, probá cambiando a **UTF-8** — es al revés de lo que uno supone.

> La codificación **solo existe para ancho fijo**. Si un archivo delimitado te trae los acentos rotos,
> no hay una opción para arreglarlo desde la plantilla: hay que convertir el archivo antes.

---

## Paso 3 — Cómo el sistema reconoce un caso

**Es la decisión más importante de la plantilla**, y la que más caro sale equivocar.

En **Identidad del caso** elegís qué cuenta como un caso distinto dentro de una remesa:

| Opción | Qué significa | Cuándo |
|---|---|---|
| **El documento** (por defecto) | Un DNI es un caso. Dos filas con el mismo documento **son el mismo caso**: la segunda no crea nada, actualiza a la primera. | La persona debe una sola cosa: planes de ahorro, servicios con una cuenta por titular. |
| **El Nº de cliente** | Cada número de cliente / cuenta / trámite es un caso, **aunque el DNI se repita**. | El cedente manda varias cuentas por titular. |

> **Cuándo hace falta "Nº de cliente".** En Telecom y Personal un titular tiene la cuenta madre
> —termina en `0001`— y las hijas (`0002`, `0003`), cada una con su deuda, sus facturas y sus cobros.
> Con identidad por documento entra **una sola**: la última del archivo pisa a las anteriores. En el
> CA del 27/05 eso dejaba afuera 119 de 19.439 cuentas, y después **todas** sus facturas y pagos
> fallaban con "Deudor no encontrado", porque el archivo de cobros viene por cuenta.
>
> La vista previa te avisa: si el archivo trae más cuentas que personas y la plantilla identifica por
> documento, sale un cartel amarillo con cuántas se van a perder.

Elegida la identidad, sigue importando **qué mapeás a `documento`**:

- **Si mapeás el DNI**, ese es el dato con el que se busca a la persona en el resto del sistema.
- **Si no mapeás documento**, el sistema guarda un marcador derivado del número de cliente
  (`SIN-DNI-…`), que una carga posterior de Actualizaciones puede completar con el DNI real.

> **El caso que lo dejó claro.** En la cartera de AYSA el DNI que manda el cedente trae basura:
> valores repetidos entre cuentas distintas, `NO INFORMADO`, `1`. Al mapearlo, 141 cuentas colapsaron
> en 55 casos: **86 casos desaparecieron de la cartera sin un solo error en el import**. La solución
> fue dejar el documento sin mapear y que la identidad fuera la cuenta contrato.
>
> La regla: si el identificador puede repetirse entre casos que son distintos, **no lo uses como
> identidad**.

### Mapear el Nº Cliente casi siempre conviene

Aunque uses el DNI como identidad, **mapeá igual el número de cliente**. Las cargas posteriores de
**Facturas** y **Pagos** buscan el caso **por número de cliente y solo por ahí**: si la cartera se
cargó sin él, esos archivos no van a matchear con nada.

---

## Paso 4 — Estados iniciales

Dos campos obligatorios: **Estado situación inicial** y **Estado gestión inicial**. Es el estado con
el que nacen los casos que cargue esta plantilla.

Si las listas están vacías, faltan cargar los parámetros de la empresa.

---

## Paso 5 — Mapear las columnas

El editor muestra las columnas del archivo a la izquierda, con una vista previa, y a la derecha
elegís a qué campo del sistema va cada una. Los campos disponibles cambian según la categoría.

Para **Deudores**:

| Campo | Notas |
|---|---|
| Nombre / Apellido | Si el archivo trae todo junto, mapealo a Nombre |
| Documento / DNI | Opcional si mapeás Nº Cliente — ver Paso 3 |
| Nº Cliente | El identificador del cedente |
| Monto total | La deuda asignada |
| Fecha vencimiento | El vencimiento de la deuda, no el de la gestión |

**No hace falta mapear todo**: lo que no mapees, no se carga. Y lo que no entre en un campo fijo va a
**Campos extras**, que se guardan con el nombre que les pongas y se ven en la ficha como *datos
adicionales*.

### Valores fijos

Una columna puede no venir del archivo: podés poner un valor constante para todas las filas. Sirve
para marcar que un bloque es de tipo `telefono`, o que un domicilio es el de `FACTURACION`.

Un bloque cuyas columnas reales vienen vacías **se descarta**, aunque tenga valores fijos.

### Bloques repetitivos

Cuando una fila trae varios datos del mismo tipo —siete columnas de teléfono, dos domicilios— se
declaran como bloques, que el editor llama **iteraciones**. Solo hay dos entidades posibles: Factura y
Contacto.

> **El orden de los bloques es una declaración de prioridad.** Si dos bloques producen el mismo
> contacto (mismo tipo y mismo valor), **no** se crean dos: se crea uno y **gana el primero**. Eso
> decide, por ejemplo, si un domicilio que es a la vez de servicio y de facturación queda rotulado
> como uno o como el otro.

---

## Paso 6 — Los transforms

Un transform limpia o convierte el valor antes de guardarlo. Se aplican **en el orden en que los
tildás**: si querés cambiar el orden, hay que destildar y volver a tildar.

En el editor aparecen con nombre en castellano. Esta es la equivalencia:

| En el editor | Qué hace |
|---|---|
| Quitar espacios de los extremos | Casi siempre. Ancho fijo lo necesita sí o sí |
| MAYÚSCULAS | Normaliza nombres |
| Título (Primera Letra) | Nombres que vienen todo en mayúscula |
| Quitar todos los espacios | Documentos escritos `20 12345678 9` |
| Quitar comilla simple ( ' ) | Excel exporta números como `'12345` |
| Quitar comilla doble ( " ) | CSV con valores entrecomillados |
| Quitar guiones ( - ) | Importes negativos que hay que cargar en positivo |
| Quitar prefijo CUIL / CUIT | `CUIT-20123456789` → `20123456789` |
| Partir por comas — parte 1 / parte 2 | `APELLIDO, NOMBRE` en una sola columna |
| Número (coma decimal) | Montos e importes |
| Decimal con coma, 2 dígitos | Datos adicionales que se muestran tal cual |
| Fecha (auto text) | Cualquier fecha escrita como texto |
| Fecha (serial nativo de Excel) | Excel que exporta `45678` |
| Traducir códigos del cedente (tabla) | El cedente manda `1` y querés ver `Residencial` |

Salvo la tabla de traducción, **ninguno se parametriza**: son opciones cerradas de una lista.

### El número: cuidado con los miles sin decimales

**Número (coma decimal)** detecta solo si el separador decimal es coma o punto, mirando cuál viene
último:

- `1.234,56` → `1234.56` ✅
- `1,234.56` → `1234.56` ✅
- `1234,56` → `1234.56` ✅

**Pero tiene un punto ciego:** un valor con punto de miles y **sin decimales** se lee mal.

- `145.320` → **145,32** ❌

Se pierde un factor de 1000 **en silencio**, sin error. Si el cedente usa el punto como separador de
miles y no manda decimales, **revisá los importes de la vista previa contra el archivo** antes de
importar.

### La traducción de códigos

Se escribe con pares separados por `|`:

```
1=Residencial|2=Residencial|3=No residencial|5=Baldío
```

- La clave se compara **sin distinguir mayúsculas** y sin espacios sobrantes.
- **Lo que no está en la tabla pasa tal cual, no se borra.** Si mañana aparece una categoría `6`, vas
  a ver `6` en la ficha. Es a propósito: el campo vacío no avisa nada, el `6` te dice que hay algo
  nuevo.
- **Un valor vacío sí borra.** `000=` convierte el relleno `000` en nada.

### Las fechas

**Fecha (auto text)** prueba una lista de formatos en orden. Incluye el que exporta SAP
(`21.06.2026`) y los que traen el **mes en castellano** (`3 ago 2026`, `23 abril 2026`,
`23 abr 2026, 0:00:00`), que es como los manda Deimos. La hora que venga al final se descarta.

> **Ojo con los años de dos dígitos.** El formato `M/D/YY` se prueba **antes** que `D/M/YY`, así que
> `03/04/26` se interpreta como **4 de marzo**, no 3 de abril. Con año de cuatro dígitos no hay
> ambigüedad. Si el cedente manda años de dos dígitos, verificá una fecha conocida en la vista previa.

---

## Paso 7 — Filtrar filas

Si el archivo trae filas que no querés importar, declarás condiciones. Se combinan con **Y**: la fila
entra solo si las cumple todas.

Operadores: **igual, distinto, contiene, mayor, menor, vacío, no vacío**. Los de texto no distinguen
mayúsculas. **Mayor y menor comparan como número**, y una fila cuyo valor no sea un número **no pasa
el filtro**.

Un ejemplo real: el archivo de novedades de AYSA mezcla cobros con cambios de situación que no mueven
plata. De 4.552 filas, solo 1.997 traen importe. Sin el filtro `Imp. cobrado > 0`, el import genera
**2.555 pagos de $0**.

Las filas descartadas **no cuentan como error**: se informan aparte en la vista previa.

> El filtro no está disponible en Multirregistro ni Multiarchivo.

---

## Paso 8 — Dividir la carga en varias remesas

Para los cedentes que exportan filtrando **solo por día**: si ese día asignaron cuatro nóminas, el
archivo llega con las cuatro adentro y en gestión cada una tiene que ser su propia remesa.

Las columnas tienen **dos roles**, y de ahí sale el número de remesa:

**Columnas que cortan.** Cada combinación distinta de sus valores es una remesa, y **cada una recibe
su propio número base**: `100`, `101`, `102`… Acá va la nómina.

**Columna que prefija.** La gestión. **No crea un número nuevo**: le antepone su primer dígito al
número del corte al que pertenece.

La diferencia entre los dos roles se ve cuando una nómina trae varias gestiones:

| Configuración | Archivo | Números |
|---|---|---|
| Solo nómina | 3 nóminas | `100` · `101` · `102` |
| Solo gestión | 3 gestiones | `10100` · `20100` · `30100` |
| Nómina + gestión | 1 nómina con 3 gestiones | `10100` · `20100` · `30100` |
| Nómina + gestión | 2 nóminas con 3 gestiones c/u | `10100` · `20100` · `30100` y `10101` · `20101` · `30101` |

O sea: **el número es de la nómina y la gestión solo lo prefija.** Dos nóminas son dos números; tres
gestiones de una misma nómina son el mismo número con tres prefijos.

> Si dos gestiones empiezan con el mismo dígito —`3G` y `3GH`— y no hay columna de corte que las
> separe, sale el mismo número para las dos. La pantalla de carga lo marca y no deja seguir hasta
> que corrijas una a mano.

### Cuando el archivo mezcla dos empresas

Un mismo CA puede traer nóminas de **prebaja** y de **posbaja**, que son carteras de empresas
distintas (Telecom / Telecom Personal). Agregá esa columna como **columna de corte**: se ve en la
tabla de carga, y así el operador sabe de cuál es cada nómina.

El archivo se sube **una vez por empresa**: en cada carga se tildan solo las nóminas que
corresponden a la empresa que estás cargando y las demás se destildan.

Al cargar, el operador ve la tabla de cortes con la cantidad de casos de cada uno antes de crear
nada. Las N remesas comparten **el mismo archivo**: no se sube ni se guarda varias veces.

> Solo hace falta en Telecom y Telecom Personal. Sin estas columnas declaradas, la carga se comporta
> como siempre: un archivo, una remesa.

---

## Ejemplo completo

Un cedente manda `deudores_marzo.txt`:

```
DOCUMENTO;APELLIDO Y NOMBRE;DEUDA;VTO;TELEFONO
20-12345678-9;PEREZ, JUAN CARLOS;$ 145.320,50;15/03/2026;11 4567-8900
27-98765432-1;GOMEZ, MARIA;$ 89.100,00;20/03/2026;
```

| Configuración | Valor |
|---|---|
| Nombre | Cedente X — Deudores |
| Categoría | Deudores |
| Formato / Separador | CSV - Punto y coma (;) |
| Tiene encabezado | Sí |
| Estados iniciales | Los que corresponda a la empresa |

Y el mapeo:

| Col | Campo | Transforms | Por qué |
|---|---|---|---|
| 0 | Documento | Quitar espacios de los extremos + Quitar guiones | El CUIT viene con guiones |
| 1 | Apellido | Quitar espacios + Partir por comas (parte 1) | Toma `PEREZ` |
| 1 | Nombre | Quitar espacios + Partir por comas (parte 2) + Título | Queda `Juan Carlos` |
| 2 | Monto total | Quitar espacios + Número (coma decimal) | El `$` y los puntos los limpia solo |
| 3 | Fecha vencimiento | Quitar espacios + Fecha (auto text) | Reconoce `DD/MM/YYYY` |
| 4 | Valor (bloque Contacto) | Quitar espacios + Quitar todos los espacios + Quitar guiones | El teléfono queda limpio |

Fijate que **la columna 1 se usa dos veces**, con distinta parte. Es la forma de partir un campo que
viene junto.

Dos cosas sobre el resultado: la segunda fila no tiene teléfono, así que ese bloque se descarta y el
deudor se carga igual. Y el teléfono no queda como `1145678900`: el sistema lo **normaliza** a formato
internacional, `+541145678900`.

---

## Qué puede salir mal

### Cargó bien los casos pero no quedó ninguna factura

Usaste **Deudores** para un archivo donde el deudor se repite, una fila por factura. Con esa categoría
cada fila actualiza a la anterior: la cantidad de casos da bien, pero el detalle de la deuda se pierde
y queda el monto de la última fila. Es **Deudores y Facturas**.

### Se cargaron menos casos que filas tiene el archivo

Dos filas comparten el valor de la identidad, así que el sistema las tomó como el mismo caso. Revisá
el Paso 3. **Antes de dar por buena una carga, compará la cantidad de filas contra la cantidad de
casos cargados.**

Si el cedente manda varias cuentas por titular, la identidad tiene que ser el **Nº de cliente**.

### Las facturas o los pagos fallan todos con "Deudor no encontrado"

Casi siempre es lo mismo del punto anterior visto un día después: los casos de esas cuentas nunca se
crearon, así que no hay a qué colgarles la factura. Revisá cuántos casos cargó la remesa de deudores
contra las filas del archivo.

La otra causa posible: la cartera se cargó **sin mapear el Nº de cliente**, y las facturas y los
pagos buscan el caso solo por ahí.

### El archivo de pagos tira "Internal server error" al subirlo

Ya no debería pasar: el sistema dejó de leer el encabezado del CSV, que era lo que se rompía cuando
el cedente manda **dos columnas con el mismo nombre** (el archivo de cobros de Personal manda
`PAYMENT_METHOD_DES` dos veces). Si aparece un error de formato, ahora se muestra con el nombre del
archivo y el motivo.

### Los importes quedaron mil veces más chicos

El cedente usa el punto como separador de miles y no manda decimales (`145.320`). Ver el punto ciego
del transform de número, más arriba.

### Los importes quedaron en 0 o vacíos

Falta el transform de número, o el valor trae caracteres que no limpia. La vista previa muestra el
valor **ya transformado**: mirala antes de importar.

### Todos los campos salen corridos (ancho fijo)

Una columna mal medida. El editor te avisa si el ancho del layout no coincide con la línea, pero no
te frena. Usá **Inferir del archivo** en vez de medir a mano.

### Los acentos y las Ñ salen rotos

En ancho fijo, cambiá la codificación a **UTF-8** (viene en Latin-1). En un archivo delimitado no hay
opción: hay que convertir el archivo antes de subirlo.

### Se cargaron menos teléfonos de los que trae el archivo

Un teléfono al que no se le puede deducir la característica **se descarta en silencio** — no aparece
como error. Si el cedente manda números locales sin código de área, es esperable perder algunos.

### La primera fila se cargó como un caso llamado "NOMBRE"

No tildaste **El archivo tiene encabezado**.

### No me deja guardar la plantilla

Falta elegir **Estado situación inicial** o **Estado gestión inicial**. Si las listas están vacías,
cargá primero los parámetros de la empresa.

---

## Preguntas frecuentes

**¿Puedo editar una plantilla que ya usé?**
Sí, pero las cargas anteriores no se rehacen. Hay un campo **Versión** que podés subir para dejar
constancia; es solo una etiqueta, no genera una copia.

**¿Puedo usar la misma plantilla en otra empresa?**
Hay dos acciones: **Clonar** (hace una copia) y **Cambiar de empresa** (la mueve). La segunda se
deshabilita en cuanto la plantilla tiene cargas hechas.

**¿Qué pasa si el cedente agrega una columna?**
Si la agrega **al final**, las plantillas siguen andando. Si la mete **en el medio**, se corren todos
los índices posteriores y hay que reajustar el mapeo.

**¿Puedo probar sin cargar nada?**
Sí. La **vista previa** muestra las primeras 50 filas ya mapeadas y transformadas, antes de confirmar.
Usala siempre en la primera carga de una plantilla nueva.

**¿Cómo sé si la carga salió bien?**
El resultado informa filas leídas, importadas y con error, y los errores se ven fila por fila con su
motivo. El control que nunca falla: comparar casos cargados contra filas del archivo. Y ojo, una
remesa puede tener **varios archivos**: la cuenta es contra el total.
