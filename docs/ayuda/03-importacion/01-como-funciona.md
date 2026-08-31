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

> **Una carga puede crear varias remesas.** Si el cedente exporta filtrando solo por día, el archivo
> llega con todas las asignaciones de ese día adentro y la plantilla lo puede **dividir**: se crea una
> remesa por nómina, todas sobre el mismo archivo. Es el caso de Telecom y Personal. Ver
> [Importar un archivo](/ayuda/importacion/importar-un-archivo).

La remesa importa más de lo que parece, porque **forma parte de la identidad de un caso**: el mismo
cliente cargado en dos remesas distintas son dos casos distintos. Es a propósito — cada asignación del
cedente tiene su propia deuda y su propio resultado.

## No todas las cargas crean casos

Esta es la distinción que más ordena todo:

| | Categorías | Qué necesita |
|---|---|---|
| **Crean casos** | Deudores · Deudores y Facturas · Multirregistro · Multiarchivo | Solo el archivo |
| **Modifican casos existentes** | Facturas · Pagos · Contactos · Enriquecimiento · Actualizaciones | Elegir una **remesa vinculada** |
| **Actúan sobre un listado** | Acciones masivas | Remesa **opcional** |

> **Actualizaciones está en las dos columnas**: además de modificar, **crea** los casos que no
> encuentra, salvo que la plantilla lo desactive. Y Multirregistro y Multiarchivo también actualizan
> los casos que ya existen, buscándolos por número de cliente en toda la empresa.

Cuando la categoría modifica casos existentes, el asistente te pide **contra qué remesa** trabajar
—la pantalla la llama *"Vincular a remesa de deudores"*—. El sistema busca los casos ahí y **solo
ahí**.

> ⚠ **Elegir mal la remesa no siempre da "cero filas".** En Facturas, Pagos y Contactos sí: el archivo
> no matchea con nada y no pasa nada. Pero en **Actualizaciones es destructivo**: da de alta las filas
> como casos nuevos en la cartera equivocada y cancela los que ya estaban ahí. Ver
> [Actualizaciones](/ayuda/importacion/actualizaciones).

> El combo lista **solo las remesas que cargaron casos**: las de facturas, pagos o acciones no
> aparecen. Y viene con **"Solo remesas en gestión"** activado, que las acota a las que todavía tienen
> al menos un caso vivo (ni cancelado ni desasignado). Si necesitás una cartera ya cerrada, apagá el
> switch.

> **En Pagos y en Facturas podés elegir varias remesas origen a la vez.** Sirve cuando el archivo
> del cedente cubre varias asignaciones, y cuando una carga se dividió en varias remesas sobre el
> mismo archivo: una sola corrida las cubre todas, en vez de correr el mismo archivo una vez por
> remesa. Con **Seleccionar todas** marcás de una las que están en gestión, y con **Limpiar** las
> destildás todas.

> **Acciones masivas sin remesa elegida actúa sobre toda la empresa.** Es deliberado y es potente:
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
  borrarse. Y salvo que tengas el permiso para ver importaciones de otros, **solo podés borrar las
  tuyas**.
- Y borrar una remesa **de pagos o contactos no deshace lo que hizo**: esos registros cuelgan de casos
  de *otra* remesa, así que se borra la carga pero los pagos quedan.

Por eso: **vista previa antes, siempre**. Está desarrollado en
[Historial y problemas](/ayuda/importacion/historial-y-problemas).

## Una remesa puede tener varios archivos

Si el cedente parte la cartera en muchos archivos del mismo formato —uno por sucursal, por ejemplo—
se suben todos juntos y se recorren como si fueran uno solo. La remesa es una, y los totales son del
conjunto. El tope es de 100 archivos.

> **Menos en Multirregistro**, que procesa **un solo archivo por carga**: si subís varios, se lee el
> primero y los demás se ignoran sin aviso.

Es distinto de **Multiarchivo**, que es para archivos de formatos **distintos** que se cruzan entre sí.

## Una importación por vez

No se pueden correr dos importaciones tuyas en paralelo: si intentás confirmar una mientras tenés otra
en curso, el sistema avisa *"Ya tenés una importación en curso"*. Hay que esperar a que termine.
