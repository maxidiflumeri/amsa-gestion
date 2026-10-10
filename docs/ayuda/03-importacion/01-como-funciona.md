<!--
seccion: Importación de datos
resumen: Qué es una remesa, qué hace falta antes de importar y cuál es el ciclo completo.
revisado: 2026-10-09
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

> **En Pagos, Facturas, Contactos y Enriquecimiento podés elegir varias remesas origen a la vez.**
> Sirve cuando el archivo del cedente cubre varias asignaciones, y cuando una carga se dividió en
> varias remesas sobre el mismo archivo: una sola corrida las cubre todas, en vez de correr el mismo
> archivo una vez por remesa. Con **Seleccionar todas** marcás de una las que están en gestión, y con
> **Limpiar** las destildás todas. Si la misma persona está en dos de las remesas elegidas, una
> factura o un pago van a un solo caso, pero un contacto se carga en **todos** sus casos.
>
> **Actualizaciones admite una sola remesa**: la toma como la cartera, así que ahí crea los casos
> nuevos y sobre ella decide a quién desasignar. Si el archivo cubre varias, se corre una vez por
> remesa (ver Actualizaciones).

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
4. **Importando** — corre en segundo plano, en el servidor: si cerrás la pantalla o te vas a otra, la
   carga sigue y la podés ver en la campanita de la barra superior. También una carga dividida: las
   remesas se confirman juntas y el servidor las carga una después de la otra. Mientras corre se puede
   **cancelar** (ver [Importar un archivo](/ayuda/importacion/importar-un-archivo)).
5. **Resultado** — cómo terminó la carga: si salió bien, si hubo filas con error, si no tenía filas, si
   terminó con advertencias, si falló o si se canceló. Con cuántas filas y, cuando hay un problema, el motivo.

Hasta que confirmás en el paso 3 **no se carga nada**: una vista previa sin confirmar es un borrador, y
un borrador que nadie confirma **se borra solo**: la limpieza corre una vez por día, de madrugada, y borra
los de más de 24 horas, así que en la práctica duran entre uno y dos días (más, si el usuario que los creó
tiene una importación en curso en ese momento).

El paso 3 es el que más problemas evita y el que más se saltea. **Una carga mal hecha no siempre se
puede deshacer** (ver más abajo), así que treinta segundos mirando la vista previa valen más que una
hora arreglando después.

## Los estados de una remesa

| Estado | Qué significa |
|---|---|
| **Pendiente** | Creada (subiste el archivo), o confirmada y esperando su turno en la cola |
| **Validando** | Con la vista previa hecha y sin confirmar |
| **Procesando** | Cargando. Está en curso |
| **Finalizada** | Terminó. Puede haber terminado con filas con error, sin filas o con advertencias |
| **Fallida** | Se cortó. Si el servidor se reinició o dejó de responder mientras procesaba, la carga se marca sola como fallida a los pocos minutos (normalmente entre 6 y 7) y no se vuelve a ejecutar sola. **Una carga cancelada también figura como fallida** en el Historial; en su detalle y en la notificación dice **Cancelada** (la notificación no siempre llega: una carga cancelada en la cola notifica solo al dueño y solo si la canceló otra persona) |

En el Historial los estados aparecen en mayúsculas. En el **detalle** de una carga, una que todavía no
se confirmó dice **Borrador**, una que espera su turno dice **En cola** y una que se canceló dice
**Cancelada**.

**Finalizada no quiere decir que salió todo bien**: quiere decir que terminó. El resultado (paso 5)
dice cómo terminó de verdad: con filas con error, sin filas, o con advertencias porque las filas se
cargaron pero el post-proceso no terminó. Los errores se pueden ver uno por uno en el detalle.

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
en curso, el sistema avisa *"Ya tenés una importación en curso"*. Hay que esperar a que termine (o, si la otra todavía está en cola y no arrancó, cancelarla —queda para retomar— o borrarla desde el Historial). Una carga dividida cuenta como una sola: te ocupa hasta que termina su última remesa.
