<!--
seccion: Reportes
resumen: Excel, CSV, TXT y PDF: cuándo conviene cada uno y qué se puede configurar.
revisado: 2026-08-20
rutas: /reportes
-->
# Formatos de salida

## Para qué sirve

El formato define cómo sale el archivo. Elegirlo bien depende de una sola pregunta: **¿quién lo va a
usar del otro lado?**

| Formato | Cuándo |
|---|---|
| **Excel** | Alguien lo va a mirar, filtrar y trabajar |
| **CSV** / **TXT** | Va a alimentar otro sistema |
| **PDF** | Se imprime o se manda para leer, no para procesar |

---

## Excel

El más usado y el más cómodo. Respeta los formatos de columna: las fechas salen como fechas y los
importes como números, así que se pueden ordenar y sumar sin retocar nada.

Es el que conviene si el reporte lo va a usar una persona.

## CSV y TXT

Para cuando el archivo lo consume otro sistema. Dos cosas configurables, y las dos importan porque
cada sistema destino pide la suya:

**El separador.** Podés elegir tabulador, `;`, `,`, `|`, espacio — o escribir el que sea. No hay una
lista cerrada, justamente porque cada destino pide uno distinto.

**El encabezado.** Un switch para sacar la fila de títulos. Muchos sistemas la rechazan.

> Si el destino es un sistema, **preguntá qué separador espera antes de armar el reporte**. Es el
> error más frecuente y obliga a rehacer la ejecución.

## PDF

Para imprimir o mandar por mail. Es el único donde tienen sentido los **saltos de página por grupo**:
si agrupás por empresa, cada una arranca en hoja nueva.

No es un buen formato si el receptor va a tener que procesar los datos: para eso, Excel.

**Cuidado con el ancho.** Un reporte de 25 columnas no entra en una hoja. Si va a PDF, achicá la
cantidad de columnas o vas a terminar con algo ilegible.

---

## El formato de cada columna

Aparte del formato del archivo, **cada columna** puede tener el suyo, en el panel de propiedades:

- **Fechas**: `DD/MM/AAAA` es lo habitual.
- **Números**: con separador de miles y dos decimales para importes.

Vale la pena configurarlo aunque el destino sea Excel: un importe con formato se lee mucho mejor, y en
CSV es la única forma de controlar cómo sale.

---

## Qué puede salir mal

### El sistema destino rechaza el archivo

Casi siempre el separador o el encabezado. Confirmá los dos con quien recibe.

### El PDF salió ilegible

Demasiadas columnas. Sacá las que no son imprescindibles o pasalo a Excel.

### Las fechas salen como número en Excel

Falta el formato de esa columna en el panel de propiedades.

### Los importes salen con punto en vez de coma

Es el formato de la columna. Configuralo en propiedades.

### El archivo salió vacío pero el reporte decía que tenía filas

Verificá que la ejecución haya terminado bien: si quedó en error, el archivo puede existir pero estar
incompleto. Se ve en Mis ejecuciones.

---

## Preguntas frecuentes

**¿Puedo cambiar el formato sin rehacer la plantilla?**
Sí. Es una propiedad de la plantilla: la editás y volvés a ejecutar.

**¿Cuál pesa menos?**
CSV y TXT, por lejos. Excel pesa más y PDF más todavía.

**¿Cuál conviene para un reporte grande?**
CSV o TXT. Un Excel de 200.000 filas es incómodo hasta para abrirlo.
