<!--
seccion: Reportes
resumen: El constructor paso a paso: elegir columnas, configurarlas y guardar la plantilla.
revisado: 2026-08-20
rutas: /reportes
-->
# Armar un reporte

## Para qué sirve

Es la pantalla donde se define qué va a traer el reporte. Se arma una vez y después se ejecuta las
veces que haga falta.

## Antes de empezar

- Los permisos **Ver reportes** y **Crear reportes**. Para editar una que ya existe, además **Editar
  reportes**.
- Tener claro **qué querés que sea cada fila**. Casi siempre: un caso. Si no lo tenés claro, leé
  primero [Cómo funciona un reporte](/ayuda/reportes/como-funciona) — es lo que más problemas evita.

---

## La pantalla: cuatro solapas

| Solapa | Qué se hace |
|---|---|
| **Columnas** | Elegir y configurar las columnas |
| **Filtros** | Acotar qué casos entran |
| **Agrupaciones y Totales** | Cortes por grupo y filas de total |
| **Preview** | Ver una muestra del resultado |

Dentro de **Columnas** hay tres zonas: el **explorador de campos** a la izquierda, el **lienzo** en el
centro y el **panel de propiedades** a la derecha.

---

## Paso 1 — Elegir las columnas

Arrastrá del explorador al lienzo, o hacé doble clic.

> **Solo se arrastran campos, no ramas enteras.** Arrastrar "Pagos" no trae todos sus campos: hay que
> bajar hasta el campo concreto.

El explorador abre con una sección **⭐ Campos destacados** —documento, nombre, apellido, monto,
vencimiento, empresa, situación y gestión—, que resuelve la mayoría de los reportes sin buscar nada.
También hay buscador (filtra por nombre y por nombre técnico) y botones para expandir o colapsar todo.

**El orden del lienzo es el orden de las columnas** en el archivo. Se reordenan arrastrando.

### Columnas fijas

El botón **Columna fija** agrega una columna que no viene de ningún campo: imprime siempre el mismo
valor, o queda vacía.

Suena raro hasta que hace falta: sirve cuando el sistema que recibe el archivo **exige una cantidad
fija de columnas**. Por ejemplo, una base que pide ocho columnas de teléfono aunque el caso tenga uno.

---

## Paso 2 — Configurar cada columna

Seleccionando una columna, el panel de la derecha ofrece:

**Etiqueta** — cómo aparece en el encabezado del archivo. Poné el nombre que espera quien lo recibe.

**Tipo de dato** — Texto, Número, Fecha, Booleano, **Moneda** o **Teléfono**.

**Formato** — depende del tipo. Para fechas, `DD/MM/AAAA`. Para moneda, con separador de miles.

> **Para que un teléfono salga formateado hay que cambiarle el tipo a Teléfono.** Recién ahí aparece el
> selector de formato de teléfono. Con el tipo en Texto sale crudo.

**Cardinalidad** — qué hacer si hay varios valores. Es la decisión importante:

| Opción | Resultado |
|---|---|
| *Usar default de la plantilla* | Lo que esté puesto a nivel plantilla |
| **Concatenar** | Todos en una celda |
| **Primero** / **Último** | Uno solo |
| **Expandir** | **Una fila por elemento** |

> ⚠ **El default de una plantilla nueva es concatenar.** Si no tocás nada, las columnas de rama traen
> todos los valores juntos.

**Separador para concatenar** — aparece cuando la cardinalidad es concatenar. Por defecto es coma y
espacio, pero se puede cambiar.

**Ancho** — en píxeles, para los formatos que lo respetan.

### Un detalle de "Primero" que conviene saber

**"Primero" no es "el prioritario".** Los contactos tienen un campo de prioridad que la ficha usa para
ordenarlos, pero el reporte **no lo tiene en cuenta**: devuelve el que la base entregue primero.

"Último", en cambio, sí ordena por fecha cuando el registro tiene una.

Si necesitás el teléfono prioritario, hoy no hay forma de pedirlo desde el reporte.

---

## Paso 3 — Filtros

Deciden qué casos entran. Tienen su propia página: [Filtros](/ayuda/reportes/filtros).

---

## Paso 4 — Agrupaciones y Totales

**Totales** agrega una fila al pie con la suma, el promedio, la cuenta, el mínimo o el máximo de una
columna. Es el único lugar donde se hacen cuentas.

**Agrupación** parte el reporte en bloques —por ejemplo, por empresa— con la opción de mostrar
**subtotales** por grupo.

Dos cosas que ahorran una vuelta:

- **Los campos de agrupación y total se eligen entre las columnas del lienzo**, no del catálogo. Para
  agrupar por empresa tenés que tener antes esa columna puesta.
- **Los subtotales salen en blanco si no definiste ningún Total.** Se calculan usando los totales, así
  que sin ellos no hay qué mostrar.

---

## Paso 5 — Formato de salida

**Excel** para trabajar el resultado, **CSV o TXT** para alimentar otro sistema, **PDF** para imprimir.
En CSV y TXT se elige el separador y si lleva encabezado.

Está desarrollado en [Formatos de salida](/ayuda/reportes/formatos).

---

## Paso 6 — Guardar

Ponele nombre y, si el reporte usa **datos adicionales** de un cedente, asociala a esa empresa: es lo
que hace que esos campos aparezcan en el explorador.

No te va a dejar guardar sin nombre o sin al menos una columna. Y avisa si hay etiquetas repetidas, o
si una agrupación apunta a una columna que sacaste.

---

## Usá el Preview mientras armás

Es lo que más tiempo ahorra. Se recalcula solo mientras editás, y muestra el resultado ya formateado.

Tres cosas que conviene mirar ahí, y no después de ejecutar:

1. **¿Cada fila es un caso?** Si ves el mismo nombre repetido, hay una columna en expandir.
2. **¿Las celdas de las ramas traen lo que esperabas?**
3. **¿Los formatos salen bien?** Fechas, montos y teléfonos.

> **El contador del preview engaña.** Dice "mostrando N de T filas", pero **T es el total de la
> muestra**, no del reporte: el preview trae como máximo 100 filas. No lo leas como "mi reporte tiene
> 100 filas".

---

## Lo que todavía no se puede desde la pantalla

Para no perder tiempo buscándolo:

| | |
|---|---|
| **Ordenar el reporte** | No hay control de ordenamiento en el builder |
| **Una columna con una cuenta** (cuántos pagos, suma de lo pagado) | Las cuentas van en Totales o en filtros |
| **Pedir solo los teléfonos** | Los contactos vienen todos juntos |
| **Salto de página por grupo en PDF** | El switch existe pero no hace nada |

---

## Qué puede salir mal

### El reporte tiene muchas más filas que casos

Alguna columna está en **expandir**. Revisá las de ramas y cambialas a concatenar, primero o último.

### El reporte trae solo algunos pagos (o contactos) de cada caso

Es el comportamiento esperado: **un filtro sobre una rama también recorta lo que esa rama muestra**. Si
filtraste pagos del mes, las columnas de pago traen solo los de ese mes.

### Puse "Primero" en el teléfono y no me trae el principal

"Primero" no respeta la prioridad del contacto. No hay forma de pedir el prioritario.

### Una columna sale vacía en todas las filas

El campo no está cargado para esos casos. Pasa seguido con **datos adicionales**: existen solo si el
cedente los mandó y la plantilla de importación los mapeó.

### No encuentro un campo en el explorador

Tres causas posibles:

- Está podado a propósito: se sacaron los campos técnicos y las relaciones que no dicen nada del caso.
- Es un **dato adicional** que no aparece porque el explorador los descubre mirando los **últimos 1.000
  casos** de la empresa. Si la clave solo está en registros viejos, no la va a listar.
- Se agregó recién: el catálogo **se cachea una hora**.

### Los totales no cuadran

Casi siempre es expandir: si un caso aparece 12 veces, su monto se suma 12 veces.

### La plantilla no aparece en el listado

Fue **desactivada**. El listado solo muestra las activas — "eliminar" en realidad desactiva.

---

## Preguntas frecuentes

**¿Puedo duplicar una plantilla para hacer una variante?**
Sí, con **Clonar**. Es más seguro que editar una que ya se está usando.

**¿Puedo cambiarle la empresa a una plantilla?**
Sí, mientras **no se haya ejecutado nunca**. Después queda fija.

**¿Eliminar una plantilla la borra?**
No: la **desactiva**. Deja de aparecer en el listado, pero las ejecuciones anteriores siguen ahí.

**¿Editar una plantilla cambia los reportes ya generados?**
No. El cambio aplica a las próximas ejecuciones.

**¿Puedo hacer un reporte que no arranque en el caso?**
No. La raíz siempre es el caso; todo lo demás se navega desde ahí.
