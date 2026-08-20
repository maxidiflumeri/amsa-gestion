<!--
seccion: Importación de datos
resumen: Qué es una remesa, qué hace falta antes de importar y cuál es el ciclo completo.
revisado: 2026-08-20
rutas: /carga
-->
# Cómo funciona una importación

## Para qué sirve

Todo lo que hay en el sistema entró por una importación. El cedente manda archivos —la cartera nueva,
los pagos del mes, los teléfonos que consiguió— y la importación los convierte en casos que se pueden
gestionar.

Esta página explica el ciclo completo. Las siguientes entran en cada parte.

## Los dos objetos que hay que tener claros

### La plantilla

Le enseña al sistema **a leer** el archivo de un cedente: qué columna es qué, cómo están separadas,
qué limpiar de cada valor. Se arma **una vez** por cedente y por tipo de archivo, y después se
reutiliza en todas las cargas.

Vive en Importación de Datos → Plantillas. Ver [Crear una plantilla](/ayuda/importacion/crear-plantilla).

### La remesa

Es **una carga concreta**. Cada vez que importás un archivo se crea una remesa, que queda con su
fecha, su plantilla, quién la hizo y cuántas filas entraron.

La remesa importa más de lo que parece, porque **forma parte de la identidad de un caso**: el mismo
cliente cargado en dos remesas distintas son dos casos distintos. Es a propósito — cada asignación del
cedente tiene su propia deuda y su propio resultado.

## No todas las cargas crean casos

Esta es la distinción que más ordena todo:

| | Categorías | Qué necesita |
|---|---|---|
| **Crean casos** | Deudores · Deudores y Facturas · Multirregistro · Multiarchivo | Solo el archivo |
| **Modifican casos existentes** | Facturas · Pagos · Contactos · Enriquecimiento · Actualizaciones | Elegir una **remesa origen** |
| **Actúan sobre un listado** | Acciones masivas | Remesa origen **opcional** |

Cuando la categoría modifica casos existentes, el asistente te pide **contra qué remesa** trabajar. El
sistema va a buscar los casos ahí y **solo ahí**: si elegís la remesa equivocada, el archivo no va a
matchear con nada y vas a terminar con una carga de cero filas.

> **En Pagos podés elegir varias remesas origen a la vez.** Sirve cuando el archivo de cobranzas
> cubre varias asignaciones: una sola corrida las cubre todas, en vez de correr el mismo archivo una
> vez por remesa.

> **Acciones masivas sin remesa origen actúa sobre toda la empresa.** Es deliberado y es potente:
> tenelo presente antes de confirmar.

## El ciclo de una importación

```
1. Categoría  →  2. Plantilla y archivo  →  3. Vista previa  →  4. Importando  →  5. Resultado
```

1. **Categoría** — qué trae el archivo.
2. **Plantilla y archivo** — elegís la plantilla de esa categoría, subís el archivo y, si hace falta,
   la remesa origen.
3. **Vista previa** — el sistema lee las primeras filas y te muestra **cómo quedarían ya
   transformadas**, antes de tocar nada. Es el momento de frenar si algo no cuadra.
4. **Importando** — corre en segundo plano. Podés cerrar la pantalla: sigue andando.
5. **Resultado** — cuántas filas entraron, cuántas fallaron y por qué.

El paso 3 es el que más problemas evita y el que más se saltea. **Una carga mal hecha no siempre se
puede deshacer** (ver más abajo), así que treinta segundos mirando la vista previa valen más que una
hora arreglando después.

## Los estados de una remesa

| Estado | Qué significa |
|---|---|
| **Pendiente** | Creada, todavía no empezó |
| **Validando** | Leyendo el archivo y armando la vista previa |
| **Procesando** | Cargando. Está en curso |
| **Finalizada** | Terminó. Puede haber tenido filas con error igual |
| **Fallida** | Se cortó |

**Finalizada no quiere decir que salió todo bien**: quiere decir que terminó. Si hubo filas con error,
el resultado las informa y se pueden ver una por una.

## Antes de importar, la lista corta

- La **empresa** creada y con sus **parámetros** cargados.
- La **plantilla** de esa categoría, ya armada y guardada.
- El **archivo**, con el formato que la plantilla espera.
- Si la categoría lo pide, saber **contra qué remesa** va.
- El permiso **Ejecutar importaciones**.

## Lo que conviene saber antes de necesitarlo

**Deshacer una importación no siempre es posible.**

- Solo las cargas de **Acciones masivas** tienen un botón de revertir.
- Las demás se pueden **borrar** —lo que borra la remesa y sus casos— pero **solo mientras nadie haya
  tocado esos casos**. Apenas alguien comentó, cargó un pago o llamó, la remesa deja de poder
  borrarse.
- Y borrar una remesa **de pagos o contactos no deshace lo que hizo**: esos registros cuelgan de casos
  de *otra* remesa, así que se borra la carga pero los pagos quedan.

Por eso: **vista previa antes, siempre**. Está desarrollado en
[Historial y problemas](/ayuda/importacion/historial-y-problemas).

## Una remesa puede tener varios archivos

Si el cedente parte la cartera en muchos archivos del mismo formato —uno por sucursal, por ejemplo—
se suben todos juntos y se recorren como si fueran uno solo. La remesa es una, y los totales son del
conjunto.

Es distinto de **Multiarchivo**, que es para archivos de formatos **distintos** que se cruzan entre sí.
