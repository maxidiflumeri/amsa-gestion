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
      ──  Contactos
      ──  Facturas
      ──  Pagos
      ──  Convenios  ──  Cuotas
      ──  Promesas
      ──  Comentarios
      ──  Situación · Gestión · Motivo de no pago
      ──  Datos adicionales del cedente
```

Podés armar una columna con cualquier campo de cualquiera de esas ramas. El explorador de la izquierda
las muestra como un árbol.

## El problema que hay que entender: uno contra muchos

Acá está la única complejidad real de armar reportes, y vale la pena entenderla antes de empezar.

Un caso tiene **un** nombre y **un** monto: eso entra en una celda sin problema. Pero tiene **varios**
teléfonos, **varios** pagos, **varias** facturas. ¿Qué poné el reporte en esa celda?

Hay cuatro formas de resolverlo, y elegís cuál usar en cada columna:

| Opción | Qué hace | Ejemplo |
|---|---|---|
| **Primero** / **Último** | Toma uno solo | El primer teléfono |
| **Concatenar** | Los junta todos en una celda, separados por coma | Todos los teléfonos |
| **Contar** | Cuánta cantidad hay | Cuántos pagos tiene |
| **Sumar / Promediar / Mínimo / Máximo** | Una cuenta sobre los valores | La suma de los pagos |

> **Cuidado con "expandir".** Existe la opción de que cada elemento de la rama genere **una fila
> distinta**. Si la usás sobre pagos, un caso con 12 pagos aparece 12 veces. Es útil cuando querés un
> listado de pagos, pero si esperabas una fila por caso, los totales te van a dar mal.

**La regla práctica:** si querés **una fila por caso**, usá primero, concatenar o una cuenta. Reservá
expandir para cuando el listado *es* de la rama, no de los casos.

## Filtrar sobre una rama

Los filtros también pueden ir sobre las ramas, y ahí hay un matiz que confunde: filtrar por "tiene un
pago mayor a $10.000" devuelve **el caso completo**, no solo ese pago.

O sea: el filtro decide **qué casos entran**; las columnas deciden **qué se muestra de cada uno**.

## Los formatos de salida

Cuatro: **Excel**, **CSV**, **TXT** y **PDF**.

- **Excel** para trabajar con el resultado.
- **CSV y TXT** para alimentar otro sistema. Se elige el separador.
- **PDF** para imprimir o mandar. Es el único donde tienen sentido los saltos de página por grupo.

## Chico corre al toque, grande corre en segundo plano

El sistema estima cuántas filas va a devolver el reporte:

- **Menos de 5.000**: se genera en el momento y lo descargás enseguida.
- **Más de 5.000**: se encola y corre en segundo plano. Podés cerrar la pantalla; te avisa cuando está.

No lo elegís vos: lo decide el sistema por el tamaño. Y hay un tope duro de **200.000 filas** — un
reporte que supere eso hay que acotarlo con filtros.

## Las plantillas pueden ser de una empresa o globales

Una plantilla puede estar asociada a **una empresa** —y entonces solo aparece cuando trabajás con esa
cartera— o ser **global** y servir para todas.

Conviene lo primero cuando el reporte usa datos adicionales propios de ese cedente.

## Dónde está cada cosa

| Pantalla | Para qué |
|---|---|
| **Reportes → Mis plantillas** | Ver, crear, editar y ejecutar plantillas |
| **Reportes → Mis ejecuciones** | Ver las corridas y descargar los archivos |

Los archivos generados **se guardan 30 días** y después se borran. La plantilla queda; el archivo no.
