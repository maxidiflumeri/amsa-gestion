<!--
seccion: Importación de datos
resumen: Cómo mirar el archivo del cedente antes de armar la plantilla, y las trampas de cada formato.
revisado: 2026-08-20
rutas: /plantillas
-->
# Los formatos de archivo

## Para qué sirve

Antes de armar una plantilla hay que entender el archivo. Esta página es sobre **el archivo en sí**:
cómo mirarlo, qué formatos existen y con qué trampas viene cada uno.

Cómo se *declara* el formato en la plantilla está en
[Crear una plantilla](/ayuda/importacion/crear-plantilla).

---

## Lo primero: abrilo en un editor de texto

**No lo abras en Excel para inspeccionarlo.** Excel te miente de varias formas a la vez:

- Convierte números en fechas y fechas en números.
- Se come los ceros a la izquierda: un documento `04123456` te lo muestra `4123456`.
- Redondea números largos y te los muestra en notación científica.
- No te deja ver si el separador es `;`, tab o coma — ya lo interpretó.
- No te muestra si hay comillas alrededor de los valores.

Usá el Bloc de notas, Notepad++, VS Code o cualquier editor de texto plano. Lo que veas ahí es lo que
el sistema va a leer.

Un Excel de verdad (`.xlsx`) sí se abre con Excel, obviamente — la advertencia es para los `.txt` y
`.csv`.

---

## Los tres formatos

### Delimitado

El más común. Los campos van separados por un carácter: `;`, `,`, `|` o tabulador.

```
20123456789;PEREZ JUAN;145320,50;15/03/2026
```

**La trampa:** que el separador también aparezca **dentro** de un valor. Un nombre `PEREZ, JUAN` en un
archivo separado por comas parte la fila en dos. Por eso muchos cedentes entrecomillan los valores, y
por eso conviene el `;` antes que la coma.

Si el archivo trae comillas alrededor de todo, hay transforms para sacarlas.

### Excel

El cedente manda `.xlsx` o `.xls`. Las celdas ya vienen separadas, así que no hay separador que
declarar. Al importar elegís **qué hoja** leer.

**Las trampas de Excel:**

- **Las fechas pueden venir como número.** Excel guarda las fechas como un número de días
  (`45678`). Para eso está el transform *Fecha (serial nativo de Excel)*.
- **Los ceros a la izquierda se pierden.** Si el cedente armó el Excel a mano, los documentos que
  empiezan con cero pueden haber quedado sin él, y ahí ya no hay transform que lo arregle.
- **Los números como texto traen un apóstrofo** (`'12345`). Se saca con *Quitar comilla simple*.

### Ancho fijo

Sin ningún separador: cada campo ocupa siempre las mismas posiciones y se rellena con espacios. Es lo
que exportan los sistemas SAP.

```
9000001028  102     0001453664BURGOS                    000001600610
```

Se declara un **layout**: para cada campo, dónde empieza y cuántos caracteres ocupa. **No lo midas a
mano** — el editor tiene un botón **Inferir del archivo** que lo arma solo desde una muestra.

**La trampa:** un solo carácter mal medido corre todos los campos que siguen. El editor compara el
ancho del layout contra el largo real de la línea y te avisa si no coinciden, pero **no te lo impide**.

---

## La codificación

Es lo que decide cómo se leen los acentos y las Ñ. Si te salen `LARRA?AGA` o símbolos raros, es esto.

**Para ancho fijo el default es Latin-1**, que es lo correcto para archivos de SAP. Si aun así salen
rotos, probá cambiando a **UTF-8**.

> **En archivos delimitados no hay opción de codificación.** Se leen como UTF-8. Si un `.csv` te trae
> los acentos rotos, hay que **convertir el archivo antes de subirlo** — por ejemplo abriéndolo en
> VS Code y guardándolo como UTF-8, o desde el Bloc de notas con *Guardar como → Codificación UTF-8*.

---

## Varios archivos en una carga

Si el cedente parte la cartera en muchos archivos **del mismo formato** —uno por sucursal, por
ejemplo— se suben **todos juntos** y se recorren como si fueran uno solo. Se crea **una** remesa y los
totales son del conjunto.

No hace falta ninguna configuración especial: se seleccionan todos al subir.

> Esto **no** es la categoría Multiarchivo. Multiarchivo es para archivos de formatos **distintos**
> que se cruzan entre sí (uno de deudores, otro de detalle de deuda, otro de bajas). Ver
> [Multirregistro y Multiarchivo](/ayuda/importacion/multirregistro-y-multiarchivo).

**Antes de subir un paquete, verificá que los encabezados sean idénticos entre archivos.** Si uno
tiene una columna de más, todo lo que siga en ese archivo va a salir corrido.

---

## Cómo mirar un archivo nuevo, en orden

1. **Abrilo en un editor de texto.**
2. **¿Tiene encabezado?** La primera fila, ¿son nombres de columna o ya son datos?
3. **¿Cómo están separados los campos?** Buscá el carácter que se repite entre valores. Si no hay
   ninguno, es ancho fijo.
4. **¿Los acentos se ven bien?** Si no, es codificación.
5. **Contá las columnas** y anotá qué es cada una. Vas a necesitar el índice de cada una para el
   mapeo, contando desde 0.
6. **Mirá los importes:** ¿usan coma o punto decimal? ¿tienen separador de miles?
7. **Mirá las fechas:** ¿qué formato? Prestá atención a si el día puede confundirse con el mes.
8. **Contá las filas.** Es el número contra el que vas a comparar la carga.

Ese último punto es el más subestimado y el que más veces salva una carga.

---

## Qué puede salir mal

### Los acentos y las Ñ salen rotos

Codificación. En ancho fijo, cambiá a UTF-8 (viene en Latin-1). En delimitado, convertí el archivo
antes de subirlo.

### Los campos salen corridos

Ancho fijo con una columna mal medida. Usá **Inferir del archivo**.

### Faltan filas y no hay errores

Si subiste varios archivos, revisá que **todos** hayan entrado: el asistente muestra cuántos.

### El documento perdió el cero de adelante

El cedente armó el archivo con Excel. No se arregla desde la plantilla: hay que pedirle el archivo
exportado como texto.

### Una fila se partió en dos

El separador aparece dentro de un valor. Si el cedente puede, pedile el archivo con `;` en vez de
coma, o con los valores entrecomillados.
