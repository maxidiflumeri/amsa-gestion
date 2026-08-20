<!--
seccion: Importación de datos
resumen: Marcar algo en bloque sobre un listado de casos. Incluye un modo que actúa sobre toda la empresa.
revisado: 2026-08-20
rutas: /carga
-->
# Acciones masivas

## Para qué sirve

Tenés un listado de casos y querés marcarles algo a todos: cambiarles la situación, dejarles un
comentario, cargarles un dato, borrarles un teléfono.

A diferencia de [Actualizaciones](/ayuda/importacion/actualizaciones), **no reconcilia nada ni decide
nada**: hace exactamente lo que le pedís, sobre los casos que matchean.

**Es la única categoría que se puede revertir con un botón.**

## Antes de empezar

- Un archivo con la lista de casos.
- Saber por qué campo van a matchear: número de cliente, documento o ID interno.
- Las operaciones que querés aplicar, definidas en la plantilla.

---

## Cómo matchea

Se declara **una columna de match** y por qué campo compara:

| Campo | Cuándo |
|---|---|
| **Nº de cliente** | Lo normal: el identificador del cedente |
| **Documento** | Si el listado viene por DNI |
| **ID interno** | El ID del sistema. Sirve cuando el listado salió de un reporte nuestro |

Un archivo sin esa columna no se puede procesar.

## Las operaciones

Se aplican **en orden** y se pueden combinar varias en una misma corrida:

| Operación | Qué hace |
|---|---|
| **Situación / Gestión / Motivo de no pago** | Les setea el estado. El valor puede ser fijo para todos, o venir de una columna |
| **Pisar un campo** | Cambia nombre, apellido, monto, fecha de vencimiento o nº de cliente |
| **Cargar datos adicionales** | Agrega campos extras desde columnas del archivo |
| **Agregar comentario** | Un texto fijo, el de una columna, o **una plantilla con variables** |
| **Borrar contacto** | Elimina un teléfono o un mail |

### El comentario con plantilla

La opción más flexible: escribís un texto libre y metés `{{col0}}`, `{{col3}}`, etc. Cada variable se
reemplata por el valor de esa columna **en cada fila**, contando desde 0.

```
Gestión del cedente: {{col2}}. Motivo informado: {{col3}}. Fecha: {{col4}}.
```

Sirve para dejar en la ficha el detalle de por qué se hizo la acción, con los datos del archivo.

### Saltear canceladas

Una opción de la plantilla: **no tocar los casos cancelados**. Conviene tenerla activada casi siempre.
Una cuenta cancelada está bloqueada para el gestor, y no tiene sentido moverle el estado por una
acción administrativa.

---

## ⚠ El modo que actúa sobre toda la empresa

Hay un segundo modo de match que **no trabaja sobre un listado de casos**: la limpieza global de
contactos.

En vez de matchear casos, matchea **valores de contacto**: le das una lista de teléfonos o mails y los
borra **de toda la base de la empresa**, en todos los casos donde aparezcan.

Sirve para lo que fue pensado: un número que resultó ser de un call center, un mail de rebote
sistemático, un teléfono que pertenece a otra persona.

**Pero no tiene listado que lo acote.** El asistente avisa explícitamente en la vista previa, y ahí
mismo te dice cuántos contactos se van a borrar. **Leé ese número antes de confirmar.**

Además, en el asistente la remesa origen es **opcional** para esta categoría: sin elegir ninguna, las
acciones se aplican sobre toda la empresa. Es deliberado y a veces es lo que querés, pero conviene
saberlo.

---

## Revertir

Es la única categoría con **deshacer**. En el historial de importaciones, una carga de acciones
finalizada tiene un botón de revertir que deja los casos como estaban.

Requiere el permiso de acciones masivas, y solo se puede revertir **una vez**: después queda marcada
como ya revertida.

> **Revertir una acción borra los comentarios que esa acción creó.** Si la acción agregó un
> comentario, al revertir desaparece. Es coherente —se deshace todo lo que hizo— pero si el gestor
> agregó información encima, esa se pierde también.

---

## Qué mirar en la vista previa

El **preview de impacto** es lo más valioso de esta categoría:

- **Cuántos casos matchean de verdad.** Un listado suele traer cuentas que ya no están en la cartera.
  Si mandás 500 y matchean 80, algo no cuadra: puede ser la remesa origen, o el campo de match.
- **Qué operaciones se van a aplicar**, listadas.
- Si es limpieza de contactos, **cuántos contactos se borran**.

---

## Qué puede salir mal

### Matchearon muchos menos casos de los que mandé

Tres causas, en orden de probabilidad: el **campo de match** equivocado (mandás DNI y la cartera se
identificó por número de cliente), la **remesa origen** equivocada, o el listado trae cuentas que
efectivamente ya no están.

### Se marcaron casos cancelados

Faltó activar **saltear canceladas** en la plantilla.

### Borré contactos de más

Fue el modo de limpieza global. Se puede revertir desde el historial si la carga fue de acciones.
Hacelo pronto: es lo único que lo deshace.

### El comentario salió con `{{col2}}` literal

El índice de columna no existe en el archivo, o está mal escrito. Los índices arrancan en **0**.

---

## Preguntas frecuentes

**¿Puedo aplicar varias operaciones de una vez?**
Sí, se aplican en el orden en que están declaradas en la plantilla.

**¿Puedo revertir dos veces?**
No. Una carga revertida queda marcada como tal.

**¿La reversión devuelve los comentarios que borró?**
No. Revertir borra los comentarios que la acción creó; no hay un "revertir la reversión".

**¿Sirve para cargar pagos o facturas?**
No. Acciones masivas toca estados, campos, datos adicionales, comentarios y contactos. Para plata están
Pagos y Actualizaciones.
