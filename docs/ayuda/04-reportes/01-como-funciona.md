<!--
seccion: Reportes
resumen: Cómo se piensa un reporte dinámico: la raíz, las ramas y qué pasa cuando un caso tiene varios de algo.
revisado: 2026-08-20
rutas: /reportes
-->
# Cómo funciona un reporte

## Para qué sirve

El módulo de reportes arma listados a medida sin que nadie escriba código. Elegís qué columnas querés,
con qué filtros y en qué formato, lo guardás como plantilla y lo ejecutás cuantas veces haga falta.

No es una herramienta de BI ni reemplaza a Power BI: está pensada para el trabajo operativo de
cobranzas — sacar la cartera de un cedente, el listado de promesas de la semana, los casos sin
contacto.

## Los dos objetos

**La plantilla** es la definición del reporte: sus columnas, filtros, ordenamiento y formato. Se arma
una vez y queda guardada.

**La ejecución** es cada vez que lo corrés. Genera un archivo, queda registrada y se puede descargar.

Una plantilla se ejecuta muchas veces; cada ejecución es independiente.

## Todo arranca en el caso

Un reporte siempre tiene la misma **raíz**: el caso (lo que la pantalla llama deudor). Cada fila del
resultado es un caso.

Desde ahí se navega a todo lo que le cuelga:

```
Caso  ──  Empresa
      ──  Remesa  ──  Política
      ──  Contactos          (teléfonos, mails y domicilios, todos juntos)
      ──  Facturas
      ──  Pagos
      ──  Convenios  ──  Cuotas
      ──  Promesas
      ──  Comentarios
      ──  Llamadas
      ──  Emails enviados
      ──  Auditoría
      ──  Situación · Gestión · Motivo de no pago
      ──  Datos adicionales del cedente
```

> **Teléfonos, mails y domicilios son todos "contactos"**, en un mismo campo. No hay una columna
> "Teléfono" y otra "Email": hay una sola, y trae los tres tipos mezclados.

Podés armar una columna con cualquier campo de cualquiera de esas ramas. El explorador de la izquierda
las muestra como un árbol.

## El problema que hay que entender: uno contra muchos

Acá está la única complejidad real de armar reportes, y vale la pena entenderla antes de empezar.

Un caso tiene **un** nombre y **un** monto: eso entra en una celda sin problema. Pero tiene **varios**
teléfonos, **varios** pagos, **varias** facturas. ¿Qué poné el reporte en esa celda?

La opción se llama **Cardinalidad** y tiene cuatro valores:

| Opción | Qué hace |
|---|---|
| **Concatenar** *(el que viene puesto)* | Los junta todos en una celda, con el separador que elijas |
| **Primero** / **Último** | Toma uno solo |
| **Expandir** | **Una fila por elemento** |

> **Cuidado con "expandir".** Si la usás sobre pagos, un caso con 12 pagos aparece 12 veces. Es lo que
> querés cuando el listado *es* de pagos; si esperabas una fila por caso, los totales van a dar
> inflados.

**La regla práctica:** si querés **una fila por caso**, usá concatenar, primero o último. Reservá
expandir para cuando el listado sea de la rama.

### Las cuentas no van en las columnas

"Cuántos pagos tiene" o "la suma de lo pagado" **no se pueden poner como columna**. Las cuentas viven
en otros dos lugares:

- **En la solapa de Totales**, que agrega una fila al pie con la suma, el promedio, la cuenta, el
  mínimo o el máximo de una columna.
- **En los filtros**, donde cada rama tiene una opción **Cantidad** para comparar contra un número
  (por ejemplo, casos con cero contactos).

Es una limitación de la pantalla, no del sistema: el motor sabe hacerlo, pero todavía no hay dónde
pedirlo por columna.

## Filtrar sobre una rama hace dos cosas

Un filtro sobre una rama —por ejemplo, "pagos del mes pasado"— hace **las dos cosas a la vez**:

1. **Elige qué casos entran**: los que tienen algún pago del mes pasado.
2. **Recorta lo que esa rama muestra**: en las columnas de pago vas a ver **solo los del mes pasado**,
   no todos los pagos históricos del caso.

Casi siempre es justo lo que querés, y es lo que hace que un reporte de cobranza del mes salga bien
sin esfuerzo.

**La excepción son los filtros por Cantidad.** Ese tipo de filtro elige el caso pero **no recorta**
nada de las columnas.

## Los formatos de salida

Cuatro: **Excel**, **CSV**, **TXT** y **PDF**.

- **Excel** para trabajar con el resultado.
- **CSV y TXT** para alimentar otro sistema. Se elige el separador.
- **PDF** para imprimir o mandar.

## Chico corre al toque, grande corre en segundo plano

El sistema estima cuántos **casos** va a traer el reporte:

- **Menos de ~5.000**: se genera en el momento y lo descargás ahí mismo.
- **Más de ~5.000**: te pregunta si querés encolarlo, y corre en segundo plano.

**Cuenta casos, no filas.** Con una columna en expandir, un reporte de 4.000 casos puede terminar
devolviendo 40.000 filas y correr igual en el momento.

Los reportes encolados tienen un tope de **200.000 filas**, pero no los frena antes de empezar: corren
hasta pasarse y quedan fallidos. Conviene acotar con filtros desde el principio.

## Asociar una plantilla a una empresa

Una plantilla puede estar asociada a **una empresa** o ser **global**.

> **No cambia qué plantillas ves**: el listado las muestra todas, con una columna que dice de qué
> empresa es cada una.

Lo que sí cambia es que, al armarla, el explorador te ofrece los **datos adicionales de ese cedente** —
que son los que ese cedente manda y no existen en otras carteras. Si el reporte los usa, hay que
asociarla.

Y una vez que la plantilla se ejecutó, **ya no se puede mover a otra empresa**.

## Dónde está cada cosa

| Pantalla | Para qué |
|---|---|
| **Reportes → Mis plantillas** | Ver, crear, editar y ejecutar plantillas |
| **Reportes → Mis ejecuciones** | Ver las corridas y descargar los archivos |

Las ejecuciones **se guardan 30 días** y después se borran enteras: el archivo y el registro. La
plantilla queda para siempre; la ejecución no.
