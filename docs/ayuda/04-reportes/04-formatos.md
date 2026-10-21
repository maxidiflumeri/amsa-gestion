<!--
seccion: Reportes
resumen: Excel, CSV, TXT y PDF: cuándo conviene cada uno, qué se puede configurar y qué no.
revisado: 2026-10-19
rutas: /reportes
-->
# Formatos de salida

## Para qué sirve

El formato define cómo sale el archivo. Elegirlo bien depende de una sola pregunta: **¿quién lo va a
usar del otro lado?**

| Formato | Cuándo |
|---|---|
| **Excel (XLSX)** | Alguien lo va a mirar |
| **CSV** / **Texto plano (TXT)** | Va a alimentar otro sistema |
| **PDF** | Se imprime o se manda para leer |

Se elige en la cabecera del constructor, junto al nombre y la empresa.

---

## ⚠ Todo sale como texto, en todos los formatos

Es lo más importante de esta página y lo que más sorprende.

**El sistema convierte todos los valores a texto antes de escribir el archivo.** Vale para los cuatro
formatos, Excel incluido.

Consecuencia concreta en Excel: **las fechas no son fechas y los números no son números**. Salen como
texto, así que no se ordenan como fecha ni se suman con una fórmula sin convertirlas primero.

Si quien recibe el archivo va a hacer cuentas, avisale — o convertí las columnas en Excel al abrirlo.

---

## Excel

El más cómodo para que alguien mire el resultado: una hoja, con encabezados.

**No hay nada configurable** desde la pantalla: ni orientación, ni anchos, ni colores.

## CSV y TXT

Para cuando el archivo lo consume otro sistema. Dos cosas configurables, en la cabecera del
constructor, y **solo aparecen si el formato es CSV o TXT**:

**El separador.** Tabulador, `;`, `,`, `|`, o el que escribas. Por defecto: coma en CSV, tabulador en
TXT.

**El encabezado.** Un switch para sacar la fila de títulos. Muchos sistemas la rechazan.

> **El CSV lleva una marca invisible al principio del archivo** (se llama BOM) que algunos sistemas
> viejos no entienden y hace que la primera columna llegue con basura adelante. **Desde esta pantalla no se
> puede sacar.** Sí la puede sacar [amaIA](/ayuda/reportes/armar-con-el-asistente) al armar la plantilla:
> en ese caso el editor lo muestra como **Sin BOM**, en el recuadro *Opciones que no se editan acá*, y lo
> conserva al guardar. Si el destino rechaza el archivo y la plantilla no la armó amaIA, pedí ayuda a
> sistemas.

Dos opciones más del CSV y del TXT que se pueden tener y no se cambian en esta pantalla: la **codificación
latin1** (en vez de UTF-8) y el **fin de línea** `\n` (en vez de `\r\n`). También se muestran en ese recuadro
cuando la plantilla las tiene.

### TXT de ancho fijo

En vez de separar con un carácter, cada columna ocupa un **ancho fijo** de caracteres: es el formato que piden
muchos sistemas viejos y las bases de los cedentes. Cada columna tiene, además:

- **Alineación**: a la izquierda (lo de siempre) o a la derecha. Los importes suelen ir a la derecha.
- **Relleno**: con espacios o con ceros. `0000012345` en vez de `     12345`. **El relleno con ceros exige alineación a la derecha** explícita: si no, la plantilla no se guarda ni se ejecuta y avisa *"En «X» el relleno con ceros solo se puede usar con alineación a la derecha"*.

Si un valor no entra en su ancho, **se corta**: alineado a la izquierda, pierde los últimos caracteres; alineado a
la derecha, pierde los **primeros**. En un número, eso quiere decir **perder los dígitos que más valen**, así que
conviene dejar siempre un ancho que alcance. El encabezado, si lo lleva, se alinea igual que los datos y siempre se
completa con espacios.

**Esta pantalla no tiene un editor del ancho fijo**: lo arma amaIA, y el recuadro *Opciones que no se
editan acá* lo muestra (cuántas columnas, con qué anchos y cuántas alineadas a la derecha o con ceros) y lo
conserva al guardar. Los anchos, la alineación y el relleno siguen a cada columna: una columna nueva entra con 10 caracteres, a la izquierda y con espacios (para cambiarlo, quitá el ancho fijo o armá la plantilla de nuevo con amaIA), y si la cantidad de anchos no coincide con la de columnas el editor avisa y no deja guardar. **Quitar** lo saca y el archivo pasa a salir con separador.

> Si el destino es un sistema, **preguntá qué separador espera antes de armar el reporte**.

## PDF

Para imprimir o mandar por mail.

**No hay nada configurable**: sale siempre en A4 vertical. No hay opción de apaisado.

**Por eso el ancho importa mucho.** Un reporte de 25 columnas no entra y sale ilegible. Si va a PDF,
achicá la cantidad de columnas — es la única salida.

> El switch de **salto de página por grupo** hace que cada grupo arranque en una hoja nueva, con el
> encabezado repetido. Sirve para mandarle a un cedente una sección por cartera.

---

## El formato de cada columna

En el panel de propiedades, cada columna tiene **Tipo de dato** y **Formato**. Lo que realmente
funciona:

| | Qué hace |
|---|---|
| **Fecha** con formato | Sale como `15/03/2026` — pero como texto |
| **Número** con cualquier formato | Sale con separador de miles a la argentina: `1.234,5` |
| **Teléfono** | Hay que **cambiarle el tipo a Teléfono** para que aparezca el selector de formato |

> **El patrón que escribas en el formato de un número se ignora.** Da igual poner `#,##0.00` o
> cualquier otra cosa: alcanza con que el campo no esté vacío para que aplique el formato argentino.
> **No fuerza dos decimales ni agrega el signo `$`.**

**Para fijar los decimales y los separadores, usá los campos propios.** Una columna de tipo **Número** (no
Moneda) tiene **Decimales** (de 0 a 4), **Separador decimal** y **Separador de miles**. Con cualquiera de los tres
completo, el número se arma así:

| Decimales | Separadores | Sale |
|---|---|---|
| 2 | los de siempre (coma decimal, punto de miles) | `1.234,50` |
| 2 | decimal `.`, miles ninguno | `1234.50` |
| 0 | miles `.` | `1.235` |

Lo que no completás queda en *Predeterminado* (coma decimal y punto de miles; si elegís uno solo, el otro se acomoda
para no chocar: con decimal `.`, los miles pasan a coma). Si la columna no tiene ninguno de los tres, sale como
antes (`1.234,5` con el campo **Formato** completo, y `1234.5` sin él). Los decimales **redondean**. Sigue siendo texto en el archivo, como todo.

La columna de tipo **Días desde la fecha** sale como un número entero (`132`), sin separadores.

> **El tipo "Moneda" no tiene efecto** sobre los campos de plata del sistema: se comportan como número.

---

## Qué puede salir mal

### El sistema destino rechaza el archivo

Por orden de probabilidad: el separador, el encabezado, o la marca invisible del CSV. Confirmá los tres
con quien recibe.

### El PDF salió ilegible

Demasiadas columnas para una hoja A4 vertical, que es la única que hay. Sacá columnas o pasalo a Excel.

### En Excel no puedo sumar una columna de importes

Salen como texto. Hay que convertirlas en Excel, o pedir el archivo en CSV y armarlo del otro lado.

### Las fechas en Excel salen al revés (mes y día cambiados)

Esa columna no tiene el tipo **Fecha** con formato: sale como fecha cruda y Excel la interpreta al
estilo americano. Configurando el formato sale bien, aunque quede como texto.

### Los importes salen sin los centavos

El formato argentino no fuerza dos decimales: `1.234,5` en vez de `1.234,50`. Poné **Decimales: 2** en esa
columna (tiene que ser de tipo **Número**).

---

## Preguntas frecuentes

**¿Puedo cambiar el formato sin rehacer la plantilla?**
Sí, es una propiedad de la plantilla: la editás y volvés a ejecutar.

**¿Cuál conviene para un reporte grande?**
CSV o TXT. Un Excel de 200.000 filas es incómodo hasta para abrirlo.

**¿Puedo poner el logo o encabezados personalizados?**
No desde la pantalla.
