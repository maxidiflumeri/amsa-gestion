<!--
seccion: Importación de datos
resumen: Las dos categorías para formatos complejos. Qué hacen, cuándo aparecen y por qué las arma un técnico.
revisado: 2026-08-20
rutas: /plantillas
-->
# Multirregistro y Multiarchivo

## Para qué sirven

Son las dos categorías para cedentes cuyo archivo **no es una tabla**. En vez de "una fila = un caso",
la información viene repartida y hay que cruzarla.

## Lo primero que hay que saber

**Estas dos no se arman con el editor de mapeo.** No hay columnas a la izquierda y campos a la
derecha: se configuran pegando un **JSON**, partiendo de un preset existente.

Las arma un técnico, no se editan desde la pantalla como el resto. Si te toca un cedente con este
formato, lo que corresponde es pedir que te armen la plantilla, no intentar armarla vos.

Esta página es para que **entiendas qué hacen** y puedas usarlas una vez armadas.

---

## Multirregistro

**Un** archivo con **varios tipos de línea** mezclados. Cada línea arranca con un código que dice qué
es:

```
CLI;0001234;PEREZ JUAN;SARMIENTO 450;...
GES;...;0001234;CONTRATO-88;...;AVISO-501
DET;AVISO-501;CAPITAL;145320,50
DET;AVISO-501;INTERESES;12030,00
BAJ;AVISO-501;15/03/2026;CANCELADO
```

- `CLI` es el cliente y sus contactos.
- `GES` es un aviso, que se convierte en una factura.
- `DET` es el desglose de esa factura: capital, intereses, honorarios.
- `BAJ` es la baja del caso.

El sistema las agrupa: el `CLI` crea el caso, los `GES` le cuelgan facturas, los `DET` de cada aviso
se suman en el detalle de esa factura, y los `BAJ` marcan las bajas.

**Los casos nuevos entran en la remesa de esta importación**, y los que ya existen se buscan por número
de cliente en toda la empresa. Por eso **no pide remesa origen**.

## Multiarchivo

**Varios archivos de formatos distintos** que se cargan juntos y se cruzan entre sí. Por ejemplo: uno
de deudores, otro con el detalle de la deuda, otro de bajas, otro de codeudores.

Al subir, el asistente **reconoce cuál es cuál por el nombre del archivo**, usando patrones declarados
en la plantilla. Si falta alguno de los obligatorios, avisa antes de empezar: *"Falta el archivo de
deudores"*.

Igual que Multirregistro, **no pide remesa origen**: los casos nuevos entran en la remesa de esta carga
y los existentes se buscan por número de cliente.

> **No confundir con subir varios archivos del mismo formato.** Eso se puede hacer en **cualquier**
> categoría y no necesita Multiarchivo: se seleccionan todos y se recorren como uno solo. Multiarchivo
> es para archivos que traen **cosas distintas** y se cruzan.

---

## Qué se puede tocar y qué no

Lo que vive en la plantilla es **el layout**: qué posición ocupa cada dato dentro de cada tipo de línea
o de cada archivo. Eso es lo que el cedente puede mover sin avisar, y por eso está en la plantilla y
no en el código — se corrige sin necesidad de un despliegue.

Lo que **no** está en la plantilla es la **estructura**: qué tipo de línea es el cliente, cómo se
vincula un `DET` con su `GES`, qué archivo se cruza con cuál. Eso es específico del formato de cada
cedente y vive en el código.

En criollo: **si el cedente corre una columna, se arregla en la plantilla. Si cambia la estructura del
archivo, hay que tocar el sistema.**

---

## Qué mirar al importar

- **Que estén todos los archivos** (Multiarchivo). El asistente te dice cuáles reconoció.
- **Que el nombre de los archivos no haya cambiado.** El reconocimiento es por patrón de nombre: si el
  cedente renombró sus exports, ninguno va a matchear.
- **La cantidad de casos** contra lo que esperabas.

---

## Qué puede salir mal

### "Falta el archivo de deudores" (o de detalle, o de bajas)

No subiste todos los archivos del paquete, o el nombre de alguno cambió y el sistema no lo reconoció.
Verificá los nombres contra los que el cedente venía mandando.

### Se cargaron los casos pero sin facturas

Las líneas de aviso no se están reconociendo, o el archivo de detalle no entró. Si el cedente cambió
la estructura, hay que avisar para ajustar el parser.

### El detalle de la factura salió incompleto

Faltaron líneas de detalle, o cambiaron los códigos de concepto. Se ve en el detalle de la factura,
en la ficha del caso.

### El filtro de filas no me aparece

No está disponible en estas dos categorías. Sus parsers cruzan los archivos antes de que haya "una
fila = un registro", así que no hay dónde aplicarlo.

---

## Preguntas frecuentes

**¿Puedo armar una plantilla de estas yo mismo?**
En la práctica no: se configura con un JSON y hay que conocer el formato del cedente. Pedí que te la
armen.

**¿Por qué no piden remesa origen?**
Porque traen todo junto: crean los casos nuevos en su propia remesa y encuentran los existentes por
número de cliente.

**¿Sirven para cualquier cedente raro?**
No necesariamente. Cubren dos formas concretas de archivo. Un formato que no encaje en ninguna de las
dos necesita desarrollo.
