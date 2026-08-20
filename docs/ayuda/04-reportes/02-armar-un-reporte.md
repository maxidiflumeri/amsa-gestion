<!--
seccion: Reportes
resumen: El constructor paso a paso: elegir columnas, ordenarlas y guardar la plantilla.
revisado: 2026-08-20
rutas: /reportes
-->
# Armar un reporte

## Para qué sirve

Es la pantalla donde se define qué va a traer el reporte. Se arma una vez y después se ejecuta las
veces que haga falta.

## Antes de empezar

- El permiso **Crear reportes**.
- Tener claro **qué querés que sea cada fila**. Casi siempre: un caso. Si no lo tenés claro, leé
  primero [Cómo funciona un reporte](/ayuda/reportes/como-funciona) — es lo que más problemas evita.

---

## La pantalla

Tres zonas:

**A la izquierda, el explorador de campos.** Un árbol con el caso arriba y sus ramas debajo: empresa,
remesa, contactos, pagos, facturas, convenios, comentarios. Se despliega y se busca.

**En el centro, el lienzo de columnas.** Lo que arrastres acá son las columnas del reporte, en ese
orden.

**A la derecha, el panel de propiedades.** Al seleccionar una columna, acá se configura: cómo se
llama, qué formato tiene, y —cuando es una rama— qué hacer si hay varios valores.

Abajo, la **vista previa**: una muestra del resultado, en vivo.

---

## Paso 1 — Elegir las columnas

Arrastrá del explorador al lienzo, o hacé doble clic.

Empezá por lo del caso: nombre, documento, monto, situación. Después sumá lo de las ramas.

**El orden del lienzo es el orden de las columnas** en el archivo final. Se reordenan arrastrando.

> El catálogo tiene alrededor de **113 campos** elegibles. Si te cuesta encontrar uno, usá el buscador
> del explorador: filtra por nombre.

## Paso 2 — Configurar cada columna

Seleccionando una columna, en el panel de la derecha:

**Nombre de la columna.** Cómo va a aparecer en el encabezado. Por defecto usa la etiqueta del campo,
pero conviene ponerle el nombre que espera quien recibe el reporte.

**Formato.** Para fechas y números. Sirve para que un Excel salga con la fecha en `DD/MM/AAAA` y los
importes con separador de miles, en vez de crudos.

**Qué hacer si hay varios** (solo en campos de una rama). Es la decisión importante:

| Opción | Resultado |
|---|---|
| **Primero** / **Último** | Una celda con uno solo |
| **Concatenar** | Una celda con todos, separados por coma |
| **Expandir** | **Una fila por elemento** |

> Repito lo de la página anterior porque es donde más se tropieza: **expandir multiplica las filas**.
> Un caso con 12 pagos aparece 12 veces. Si querés una fila por caso, no uses expandir.

## Paso 3 — Agregaciones

En vez del valor, una columna de rama puede traer una **cuenta**:

| | Sobre qué campos |
|---|---|
| **Sumar** · **Promediar** | Números |
| **Mínimo** · **Máximo** | Números y fechas |
| **Contar** | Cualquiera |
| **Concatenar** | Texto |

Ejemplos típicos: *cuántos pagos tiene*, *la suma de lo pagado*, *la fecha del último comentario*.

## Paso 4 — Filtros

Deciden **qué casos entran** en el reporte. Están en su propia página:
[Filtros](/ayuda/reportes/filtros).

## Paso 5 — Ordenar y agrupar

**Ordenamiento**: por qué columna y en qué sentido. Se pueden encadenar varios.

**Agrupación**: parte el reporte en bloques, por ejemplo por empresa. Con la opción de mostrar
**subtotales** por grupo, y en PDF, de arrancar cada grupo en **página nueva**.

**Totales**: una fila al final con la suma, el promedio, el mínimo, el máximo o la cuenta de una
columna.

## Paso 6 — Formato de salida

**Excel** para trabajar el resultado, **CSV o TXT** para alimentar otro sistema (elegís el separador y
si lleva encabezado), **PDF** para imprimir o mandar.

Está desarrollado en [Formatos de salida](/ayuda/reportes/formatos).

## Paso 7 — Guardar

Ponele nombre y, si corresponde, asociala a una **empresa**. Una plantilla de empresa solo aparece al
trabajar con esa cartera; una global sirve para todas.

Si el reporte usa **datos adicionales** propios de un cedente, asociala a esa empresa: en otra no van a
existir esas columnas.

---

## Usá la vista previa mientras armás

Es lo que más tiempo ahorra. Muestra una muestra del resultado real, con los datos ya formateados.

Tres cosas que conviene mirar ahí, y no después de ejecutar:

1. **¿Cada fila es un caso?** Si ves el mismo nombre repetido, hay una columna en expandir.
2. **¿Las celdas de las ramas traen lo que esperabas?** Un teléfono, todos, o la cuenta.
3. **¿Los formatos salen bien?** Fechas y montos.

---

## Qué puede salir mal

### El reporte tiene muchas más filas que casos

Alguna columna está en **expandir**. Revisá las de ramas —pagos, facturas, contactos, comentarios— y
cambialas a primero, concatenar o una cuenta.

### Una columna sale vacía en todas las filas

El campo no está cargado para esos casos. Pasa seguido con **datos adicionales**: existen solo si el
cedente los mandó y la plantilla de importación los mapeó.

### No encuentro un campo en el explorador

Usá el buscador. Y tené presente que el catálogo está **podado a propósito**: se sacaron los campos
técnicos y las relaciones que no dicen nada del caso. Si falta uno que necesitás de verdad, avisá.

### Los totales no cuadran

Casi siempre es expandir otra vez: si un caso aparece 12 veces, su monto se suma 12 veces.

### Guardé la plantilla pero no aparece al ejecutar

Está asociada a **otra empresa**. Las de empresa solo se ven en esa cartera.

---

## Preguntas frecuentes

**¿Puedo duplicar una plantilla para hacer una variante?**
Sí, y conviene: es más seguro que editar una que ya se está usando.

**¿Editar una plantilla cambia los reportes ya generados?**
No. Los archivos ya generados quedan como estaban; el cambio aplica a las próximas ejecuciones.

**¿Cuántas columnas puedo poner?**
No hay un tope duro, pero un reporte de 40 columnas es incómodo de leer y tarda más. Si tenés dudas,
armá dos.

**¿Puedo hacer un reporte que no arranque en el caso?**
No. La raíz siempre es el caso; todo lo demás se navega desde ahí.
