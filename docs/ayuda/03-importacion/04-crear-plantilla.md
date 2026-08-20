<!--
seccion: Importación de datos
resumen: Cómo se le enseña al sistema a leer el archivo de un cedente, campo por campo.
revisado: 2026-08-20
rutas: /plantillas
-->
# Crear una plantilla de importación

## Para qué sirve

Cada cedente manda sus archivos como quiere: uno pone el DNI en la primera columna, otro en la
séptima; uno escribe las fechas `15/03/2026` y otro `20260315`; uno separa con `;` y otro no separa
con nada. **La plantilla es la traducción entre ese archivo y el sistema.**

Se arma una vez por cedente y por tipo de archivo, y después se reutiliza en cada carga. Si el
cedente cambia el formato, se corrige la plantilla — no hace falta tocar el sistema.

## Antes de empezar

Necesitás tres cosas:

- El permiso **Crear plantillas de importación**. Si no ves el botón, pedíselo a un administrador.
- **La empresa ya creada** en Ajustes → Empresas. La plantilla pertenece a una empresa.
- **Una muestra real del archivo.** No una descripción de lo que trae: el archivo. Vas a necesitar
  mirar las columnas para saber cuál es cuál.

> Abrí la muestra en un editor de texto plano, no en Excel. Excel te miente: convierte números en
> fechas, se come los ceros a la izquierda de un DNI y no te deja ver si el separador es `;` o tab.

---

## Las cuatro decisiones de una plantilla

Antes del paso a paso, conviene tener claro qué le estás declarando al sistema. Son cuatro cosas
independientes, y confundirlas es el origen de la mayoría de los problemas:

| | Qué responde | Ejemplo |
|---|---|---|
| **Categoría** | ¿Qué *trae* el archivo? | Deudores, facturas, pagos… |
| **Formato** | ¿Cómo está *escrito*? | Separado por `;`, ancho fijo, Excel |
| **Mapeo** | ¿Qué *significa* cada columna? | La columna 3 es el monto |
| **Match keys** | ¿Cómo se reconoce un caso ya cargado? | Por empresa + documento |

Las match keys son la que más se subestima. Definen cuándo dos filas son **el mismo caso**: si
elegís mal, o duplicás casos que ya existían, o pisás casos distintos creyendo que son el mismo.

---

## Paso 1 — Elegir la categoría

Ir a **Importación de Datos → Plantillas → Nueva plantilla**.

La categoría es lo primero y condiciona todo el resto: qué campos podés mapear, qué opciones
aparecen y qué hace el sistema con cada fila.

| Categoría | Cuándo usarla |
|---|---|
| **Deudores** | El archivo trae los casos: quién debe, cuánto, desde cuándo. Es el archivo base. |
| **Facturas** | El detalle de la deuda, para casos **ya cargados**. Una fila por factura. |
| **Pagos** | Cobranzas a registrar contra casos ya cargados. |
| **Contactos** | Teléfonos, mails y domicilios de casos ya cargados. |
| **Enriquecimiento** | Datos extra que no entran en un campo fijo (los "datos adicionales" de la ficha). |
| **Deudores y Facturas** | Un archivo que trae el caso **y** su deuda al detalle. Ver abajo: cubre dos formas distintas de archivo. |
| **Actualizaciones** | El cedente manda cómo quedó la cartera: qué se pagó, qué deuda nueva hay, quién ya no se gestiona. |
| **Acciones masivas** | Un listado de casos para marcarles algo en bloque: cambiar situación, dejar un comentario, borrar un teléfono. |
| **Multirregistro** | **Un** archivo con **varios tipos de línea** mezclados (una para el cliente, otra para cada aviso, otra para el detalle). |
| **Multiarchivo** | **Varios** archivos que se cargan juntos y se cruzan entre sí. |

### Deudores y Facturas cubre dos formas de archivo

Es la categoría que más se malinterpreta, porque sirve para dos cosas que parecen distintas:

**Forma A — todo en la misma fila.** El caso y sus facturas vienen juntos, y las facturas se mapean
como un bloque repetitivo (columnas `Factura 1`, `Vto 1`, `Factura 2`, `Vto 2`…).

**Forma B — el deudor se repite, una fila por factura.** Es la más común:

```
DOCUMENTO;NOMBRE;FACTURA;IMPORTE;VTO
20123456789;PEREZ JUAN;A-0001;15.300,00;10/01/2026
20123456789;PEREZ JUAN;A-0002;15.300,00;10/02/2026
20123456789;PEREZ JUAN;A-0003;16.100,00;10/03/2026
27987654321;GOMEZ MARIA;B-0044;42.000,00;05/02/2026
```

Ahí hay **dos casos y cuatro facturas**, no cuatro casos. El sistema reconoce que las tres primeras
filas son el mismo deudor —por las match keys— y en vez de duplicarlo, le va agregando cada factura.

No hay que configurar nada especial para esto: **es el comportamiento normal de la categoría**.
Alcanza con que las match keys estén bien elegidas.

> Si usás **Deudores** a secas para un archivo así, cada fila pisa a la anterior y terminás con dos
> casos con una sola factura cada uno. Es el error más frecuente con esta categoría.

#### El monto total cuando el deudor se repite

En la forma B, lo natural es que el monto del caso salga de **sumar sus facturas**. La opción
**Calcular importe desde las facturas** controla eso:

| Opción | Qué hace |
|---|---|
| **Solo si está vacío** (por defecto) | Suma las facturas únicamente si el archivo no trajo un monto |
| **Siempre** | Suma las facturas y pisa cualquier monto del archivo |
| **No** | No toca el monto: manda lo que diga el archivo |

Con el ejemplo de arriba, PEREZ queda en $46.700 (la suma de sus tres facturas) y GOMEZ en $42.000.

### Cómo elegir sin equivocarse

La pregunta que resuelve el 90% de los casos: **¿el archivo crea casos nuevos o le agrega algo a
casos que ya están?**

- Crea casos → **Deudores** si el archivo trae solo el total adeudado; **Deudores y Facturas** si
  trae además el detalle (una fila por factura, o las facturas en columnas). *Multirregistro* y
  *Multiarchivo* son para cuando el formato del archivo es raro, no por lo que trae.
- Le agrega algo a casos existentes → **Facturas**, **Pagos**, **Contactos** o **Enriquecimiento**,
  según qué agregue.
- Le cambia el estado a casos existentes → **Actualizaciones** o **Acciones masivas**.

Y entre esas dos últimas, que es la confusión más común:

- **Actualizaciones** es para que el cedente te diga **cómo quedó la deuda**. El sistema reconcilia:
  genera pagos, crea facturas de ajuste, y decide qué hacer con los casos que no aparecen en el
  archivo. Es un proceso con criterio propio.
- **Acciones masivas** es para **vos**: tenés un listado de casos y querés marcarles algo. No
  reconcilia nada, hace exactamente lo que le pedís.

---

## Paso 2 — Declarar el formato

### Separador

Si el archivo es un `.txt` o `.csv`, el sistema necesita saber cómo están separados los campos.
Elegís entre `;`, `,`, `|`, tab, espacio, o escribís el que sea.

Si es un Excel (`.xlsx`), no hace falta: las celdas ya vienen separadas.

### El archivo tiene encabezado

Tildalo si la primera fila trae los nombres de las columnas en vez de datos. Si no lo tildás y el
archivo sí tiene encabezado, esa primera fila se va a intentar importar como si fuera un caso — y va
a fallar, o peor, va a cargar un deudor llamado "NOMBRE".

### Ancho fijo

Algunos cedentes (típicamente los que exportan de SAP) mandan archivos **sin ningún separador**:
cada campo ocupa siempre las mismas posiciones y se rellena con espacios.

```
9000001028  102     0001453664BURGOS                    000001600610
```

Ahí elegís formato **Ancho fijo** y declarás el layout: para cada columna, el nombre, en qué
posición empieza (contando desde 0) y cuántos caracteres ocupa.

> **La validación que no hay que saltear:** la suma de los largos tiene que dar **exactamente** el
> largo de una línea del archivo. Si no cierra, hay una columna mal medida y todos los campos
> posteriores van a salir corridos. Es la forma más rápida de verificar un layout armado a mano.

También podés elegir la codificación. **Los archivos de SAP vienen en Latin-1**: si los leés como
UTF-8, las Ñ y los acentos se rompen y `LARRAÑAGA` queda `LARRA?AGA`.

---

## Paso 3 — Elegir las match keys

Las match keys le dicen al sistema **por qué campos reconocer un caso**. Se escriben separadas por
coma, por ejemplo `empresaId,documento`.

La combinación más común es **empresa + documento**. Pero hay cedentes donde el documento no sirve, y
ahí hay que usar **el número de cliente del cedente**.

> **Un caso real que costó caro.** En la cartera de AYSA, el DNI que manda el cedente trae basura:
> valores repetidos entre cuentas distintas, `NO INFORMADO`, `1`. Al mapearlo como documento, 141
> cuentas colapsaron en 55 deudores: **86 casos desaparecieron de la cartera sin un solo error en el
> import**. La solución fue no mapear el documento y usar la cuenta contrato como identidad.
>
> La lección: si el identificador del cedente puede repetirse entre casos distintos, **no** es una
> match key.

---

## Paso 4 — Mapear las columnas

Acá le decís qué significa cada columna del archivo. El editor te muestra las columnas a la
izquierda —con una vista previa de las primeras filas— y a la derecha elegís a qué campo del sistema
va cada una.

Los campos disponibles cambian según la categoría. Para **Deudores** son:

| Campo | Notas |
|---|---|
| Nombre / Apellido | Si el archivo trae todo junto, mapealo a Nombre |
| Documento / DNI | Opcional si mapeás Nº Cliente |
| Nº Cliente | El identificador del cedente. Requerido si no hay DNI |
| Monto total | La deuda asignada |
| Fecha vencimiento | El vencimiento de la deuda, no el de la gestión |

**No hace falta mapear todo.** Lo que no mapees, no se carga. Y lo que no entre en ningún campo fijo
podés mandarlo a **datos adicionales**, que se guardan con el nombre que vos les pongas y aparecen en
la ficha del deudor.

### Valores fijos

Una columna puede no venir del archivo: podés poner un **valor fijo**, el mismo para todas las filas.
Sirve, por ejemplo, para marcar que un bloque de teléfonos es de tipo `telefono`, o que un domicilio
es el de `FACTURACION`.

### Bloques repetitivos

Cuando una fila trae **varios** datos del mismo tipo —siete columnas de teléfono, dos domicilios— se
declaran como bloques. Cada bloque genera un registro aparte.

Ojo con un detalle: un bloque cuyas columnas reales vienen vacías **se descarta**, aunque tenga
valores fijos. Un valor fijo solo no alcanza para crear un contacto vacío.

---

## Paso 5 — Los transforms

Un transform limpia o convierte el valor **antes** de guardarlo. Se aplican en orden, uno tras otro:
si ponés `trim` y después `toNumber`, primero saca los espacios y después convierte a número.

| Transform | Qué hace | Cuándo lo necesitás |
|---|---|---|
| `trim` | Saca espacios de los extremos | Casi siempre. Ancho fijo lo necesita sí o sí |
| `upper` | Todo a mayúsculas | Normalizar nombres |
| `title` | Primera Letra De Cada Palabra | Nombres que vienen todo en mayúscula |
| `removeSpaces` | Saca **todos** los espacios | Documentos escritos `20 12345678 9` |
| `removeQuotes` | Saca comillas simples | Excel exporta números como `'12345` |
| `removeDoubleQuotes` | Saca comillas dobles | CSV con valores entrecomillados |
| `removeDashes` | Saca guiones | Importes negativos que hay que cargar en positivo |
| `removePrefix:XX` | Saca ese prefijo del principio | `CUIT-20123456789` → `20123456789` |
| `splitComma:N` | Parte por comas y toma el pedazo N (desde 0) | `APELLIDO, NOMBRE` en una sola columna |
| `toNumber:es-AR` | Texto → número | Montos e importes |
| `toDecimal:es-AR` | Número → texto con coma decimal | Datos adicionales que se muestran tal cual |
| `toDate:auto` | Texto → fecha, probando formatos | Cualquier fecha |
| `toDate:excel` | El número de fecha de Excel → fecha | Excel que exporta `45678` |
| `mapear:...` | Traduce códigos a texto legible | El cedente manda `1` y querés ver `Residencial` |

### `toNumber:es-AR` es más inteligente de lo que parece

Detecta solo si el separador decimal es la coma o el punto, mirando cuál viene último:

- `1.234,56` → `1234.56` (formato argentino)
- `1,234.56` → `1234.56` (formato inglés)
- `1234,56` → `1234.56`

Así que no tenés que saber de antemano en qué convención exporta el cedente.

### `mapear` deja pasar lo que no conoce

Se escribe con pares separados por `|`:

```
mapear:1=Residencial|2=Residencial|3=No residencial|5=Baldío
```

Dos reglas que importan:

- **Lo que no está en la tabla pasa tal cual, no se borra.** Si mañana el cedente agrega una
  categoría `6`, vas a ver `6` en la ficha en vez de un campo vacío. Eso es a propósito: el campo
  vacío no avisa nada, el `6` te dice que apareció algo nuevo.
- **Un valor vacío sí borra.** `mapear:000=` convierte el relleno `000` en nada. Sirve para los
  "sin dato" que algunos cedentes mandan como ceros.

### Las fechas con puntos

`toDate:auto` prueba una lista de formatos en orden, y contempla el que exporta SAP (`21.06.2026`).
Sin ese formato declarado pasaban dos cosas silenciosas: `10.05.2024` se leía como 5 de octubre, y
cualquier día mayor a 12 devolvía nulo.

---

## Paso 6 — Filtrar filas

Si el archivo trae filas que **no** querés importar, podés declarar condiciones. Se combinan con Y:
la fila entra solo si las cumple todas.

Un ejemplo real: el archivo de novedades de AYSA mezcla los cobros con cambios de situación que no
mueven plata. De 4.552 filas, solo 1.997 traen importe. Sin el filtro
`Imp. cobrado > 0`, el import genera **2.555 pagos de $0**.

Las filas descartadas **no cuentan como error**: no aparecen en el listado de errores, se informan
aparte en la vista previa.

---

## Ejemplo completo

Un cedente manda `deudores_marzo.txt`:

```
DOCUMENTO;APELLIDO Y NOMBRE;DEUDA;VTO;TELEFONO
20-12345678-9;PEREZ, JUAN CARLOS;$ 145.320,50;15/03/2026;11 4567-8900
27-98765432-1;GOMEZ, MARIA;$ 89.100,00;20/03/2026;
```

La plantilla queda así:

| Configuración | Valor |
|---|---|
| Nombre | Cedente X — Deudores |
| Categoría | Deudores |
| Separador | `;` |
| Tiene encabezado | Sí |
| Match keys | `empresaId,documento` |

Y el mapeo:

| Col | Campo | Transforms | Por qué |
|---|---|---|---|
| 0 | Documento | `trim`, `removeDashes` | El CUIT viene con guiones |
| 1 | Apellido | `trim`, `splitComma:0` | Toma `PEREZ` |
| 1 | Nombre | `trim`, `splitComma:1`, `title` | Toma `JUAN CARLOS` → `Juan Carlos` |
| 2 | Monto total | `trim`, `toNumber:es-AR` | El `$` y los puntos los limpia solo |
| 3 | Fecha vencimiento | `trim`, `toDate:auto` | Reconoce `DD/MM/YYYY` |
| 4 | Contacto (bloque) | `trim`, `removeSpaces`, `removeDashes` | Queda `1145678900` |

Fijate que **la columna 1 se usa dos veces**, con distinto `splitComma`. Eso es válido y es la forma
de partir un campo que viene junto.

La segunda fila no tiene teléfono: ese bloque de contacto se descarta y el deudor se carga igual.

---

## Qué puede salir mal

### "No se subió ningún archivo"

El archivo no llegó. Suele ser tamaño o una extensión que el navegador no mandó. Probá con un
archivo más chico para descartar.

### Todos los campos salen corridos (ancho fijo)

Hay una columna mal medida. Verificá que **la suma de los largos dé exactamente el largo de la
línea**. Un solo carácter de diferencia corre todo lo que sigue.

### Los acentos y las Ñ salen como `?` o símbolos raros

Codificación equivocada. Cambiá a **Latin-1** en el layout de ancho fijo. Es lo habitual en archivos
de SAP.

### Se cargaron menos deudores que filas tiene el archivo

Casi siempre es la match key. Si dos filas comparten el valor de la match key, el sistema las trata
como el mismo caso y la segunda pisa a la primera. **Antes de dar por buena una carga, compará la
cantidad de filas del archivo contra la cantidad de casos cargados.** Si no coinciden, revisá si el
identificador se repite.

### Cargó bien los casos pero no quedó ninguna factura

Usaste **Deudores** para un archivo donde el deudor se repite, una fila por factura. Con esa
categoría cada fila pisa a la anterior: la cantidad de casos da bien, pero el detalle de la deuda se
pierde y queda el monto de la última fila. Es **Deudores y Facturas**.

### Los importes quedaron en 0 o en null

Falta `toNumber:es-AR`, o el valor trae caracteres que el transform no limpia. Mirá la vista previa:
muestra el valor ya transformado, antes de importar.

### Las fechas quedaron vacías o con el mes y el día cambiados

Falta `toDate:auto`, o el formato no está en la lista. Si el cedente usa algo exótico, avisá para
agregarlo — no lo resuelvas cargando la fecha como texto en datos adicionales.

### La primera fila se cargó como un deudor llamado "NOMBRE"

No tildaste **El archivo tiene encabezado**.

---

## Preguntas frecuentes

**¿Puedo editar una plantilla que ya usé?**
Sí, pero las cargas anteriores no se rehacen. Si el cambio es grande, conviene crear una versión
nueva y dejar la vieja para poder entender cargas pasadas.

**¿Puedo usar la misma plantilla en dos empresas?**
La plantilla pertenece a una empresa. Se puede copiar a otra, pero verificá que el formato del
archivo sea realmente el mismo.

**¿Qué pasa si el cedente agrega una columna?**
Si la agrega **al final**, las plantillas existentes siguen andando: los índices no se corren. Si la
mete **en el medio**, se corren todos los índices posteriores y hay que reajustar el mapeo.

**¿Puedo probar sin cargar nada?**
Sí. La **vista previa** del asistente muestra cómo quedaría cada fila ya transformada, antes de
confirmar. Usala siempre en la primera carga de una plantilla nueva.

**¿Cómo sé si la carga salió bien?**
El resultado informa filas leídas, importadas y con error. Los errores se ven fila por fila, con el
motivo. Y el control que nunca falla: comparar la cantidad de casos cargados contra las filas del
archivo.
