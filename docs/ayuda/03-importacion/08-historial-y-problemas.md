<!--
seccion: Importación de datos
resumen: Ver qué pasó con una carga, revisar los errores fila por fila, y qué se puede deshacer y qué no.
revisado: 2026-08-20
rutas: /historial-importaciones
-->
# Historial y problemas

## Para qué sirve

**Importación de Datos → Historial** lista todas las cargas de una empresa: cuándo se hicieron, con
qué plantilla, cuántas filas entraron y cuántas fallaron. Es donde se va a ver qué pasó y, cuando se
puede, a deshacerlo.

## Antes de empezar

- El permiso **Ver historial de importaciones**.
- Para borrar, el permiso **Eliminar importaciones**.
- Para revertir acciones masivas, el permiso de **acciones masivas**.

---

## Los estados

| Estado | Qué significa |
|---|---|
| **Pendiente** | Creada, todavía no empezó |
| **Validando** | Leyendo el archivo |
| **Procesando** | En curso |
| **Finalizada** | Terminó |
| **Fallida** | Se cortó |

**Finalizada no significa "salió bien"**: significa que terminó. Mirá siempre la columna de filas con
error.

## Ver el detalle y los errores

Entrando a una remesa ves el resumen y, si hubo filas rechazadas, **el detalle fila por fila**: qué
número de fila era, qué traía y por qué falló.

Es lo primero que hay que mirar cuando una carga no dio los números esperados. Los motivos más
frecuentes:

| Error | Qué significa |
|---|---|
| Falta el nº de cliente | La categoría busca el caso por ese campo y la fila no lo trae |
| Debe ingresar al menos una factura | En Deudores y Facturas, toda fila necesita su factura |
| Fila sin valor de contacto | El bloque de contacto vino vacío |
| Sin campo de match | Acciones masivas sin la columna de match |

> **Ojo con lo que NO aparece acá.** Las filas descartadas por un **filtro de fila** no son errores: no
> figuran en este listado. Y un **teléfono que no se pudo normalizar** se descarta en silencio, sin
> quedar registrado. Si las cuentas no cierran y el listado de errores está vacío, mirá por ahí.

---

## Qué se puede deshacer

Esta es la parte que conviene leer **antes** de necesitarla.

### Revertir — solo acciones masivas

Una carga de **Acciones masivas** finalizada tiene botón de **revertir**: deja los casos como estaban.
Se puede una sola vez.

**Ninguna otra categoría tiene deshacer.** No hay botón de revertir para deudores, facturas, pagos,
contactos ni actualizaciones.

### Borrar la remesa — con dos condiciones grandes

Se puede borrar una remesa en cualquier estado **salvo mientras esté procesando**. Pero:

**1. No se puede borrar si alguien ya trabajó los casos.** Si algún caso de la remesa tiene un
comentario, un convenio, un pago, una llamada o un mail enviado, el sistema no deja borrarla. En la
práctica, **una remesa deja de ser borrable apenas el equipo la empieza a gestionar**.

**2. Borrar no siempre deshace.** Borrar una remesa borra **los casos que esa remesa creó**. Si la
carga fue de **pagos, contactos o actualizaciones**, sus registros cuelgan de casos de *otra* remesa:
se borra la fila del historial y **los pagos quedan en la base**.

| Categoría de la carga | Borrar la remesa… |
|---|---|
| Deudores · Deudores y Facturas · Multirregistro · Multiarchivo | Borra los casos que creó ✅ |
| Facturas · Pagos · Contactos · Enriquecimiento · Actualizaciones | **No deshace nada.** Los registros quedan |
| Acciones masivas | Usá **revertir**, no borrar |

### La conclusión práctica

**La vista previa es la red de seguridad real**, no el deshacer. Treinta segundos mirándola valen más
que una hora arreglando después.

Si una carga de pagos entró mal y la remesa ya no se puede revertir, la corrección es caso por caso:
los pagos se pueden eliminar desde la ficha, con el permiso correspondiente.

---

## Otras acciones del historial

**Consolidar** recalcula el saldo y el código de situación de los casos de esa remesa según los pagos
registrados. Se usa cuando se cargaron pagos y querés que las situaciones se actualicen.

---

## Qué puede salir mal

### No me deja borrar la remesa

Alguien ya trabajó sus casos: hay comentarios, pagos, convenios o llamadas. Es intencional — borrarla
se llevaría ese trabajo puesto.

### Borré la remesa de pagos y los pagos siguen ahí

Es el comportamiento esperado: los pagos cuelgan de casos de la remesa origen, no de la de pagos. Hay
que eliminarlos desde la ficha de cada caso.

### La carga quedó "procesando" y no avanza

Mientras esté en curso no se puede borrar. Entrá al detalle a ver el progreso. Si está realmente
colgada, hay que esperar a que falle.

### Los números no cierran y no hay errores

Tres candidatos: filas descartadas por **filtro** (no cuentan como error), **casos colapsados** porque
dos filas comparten el documento, o **contactos descartados** en silencio por no poder normalizarse.

---

## Preguntas frecuentes

**¿Puedo volver a importar el mismo archivo?**
Sí. En Deudores actualiza en vez de duplicar (dentro de la misma remesa). En Pagos hay un
anti-duplicados. En Actualizaciones, cuidado con las opciones de ausentes.

**¿El historial guarda quién hizo cada carga?**
Sí, y también queda en la auditoría.

**¿Puedo ver el archivo original que se subió?**
El sistema guarda el archivo de la remesa. Si el detalle no te alcanza, ese es el recurso.

**¿Revertir una acción masiva devuelve los comentarios que borró?**
No. Revertir **borra** los comentarios que la acción creó, y eso no se recupera.
