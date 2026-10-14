<!--
seccion: Importación de datos
resumen: Marcar algo en bloque sobre un listado de casos. Incluye un modo que actúa sobre toda la empresa.
revisado: 2026-10-14
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

Una opción de la plantilla —*"No tocar cuentas canceladas"*— que **viene apagada por defecto**.
Conviene activarla casi siempre: una cuenta cancelada está bloqueada para el gestor, y las acciones
masivas **escriben igual, salteando ese bloqueo**.

Solo existe para el modo de listado de casos. En el de limpieza de contactos no aplica: se borran
también los de las cuentas canceladas.

---

## ⚠ El alcance: por defecto es TODA la empresa

En el asistente hay un selector **"Aplicar solo a una remesa (opcional)"**. Si lo dejás en *toda la
base de la empresa* —que es el default— la acción se aplica sobre **todos** los casos de esa empresa,
no solo sobre una cartera.

Vale para los dos modos:

**Modo listado de casos.** Un mismo número de cliente presente en dos remesas se toca **en las dos**.

**Modo limpieza de contactos.** Este matchea valores en vez de casos: le das una lista de teléfonos o
mails y los borra de todos los casos donde aparezcan. Sirve para un número que resultó ser de un call
center, un mail de rebote sistemático, un teléfono que es de otra persona.

**También se puede acotar a una remesa** con ese mismo selector, aunque el cartel de la vista previa
siga diciendo "toda la base de la empresa" — el aviso no contempla la remesa elegida.

En cualquier caso, la vista previa te dice **cuántos contactos se van a borrar**. Leé ese número antes
de confirmar.

---

## Revertir

Es la única categoría con **deshacer**. En el Historial de importaciones, una carga de acciones que terminó
—**finalizada, cancelada o cortada**— tiene un botón de revertir que deja los casos como estaban.

Los datos para deshacer se guardan **caso por caso, en el mismo momento en que se aplica el cambio**. Por eso
Revertir deshace exactamente lo que la acción alcanzó a hacer, aunque se haya cortado a la mitad.

Requiere el permiso de acciones masivas.

### Cómo se usa

1. En la fila de la acción (o en su detalle) apretá **Revertir**.
2. Antes de confirmar, el diálogo dice **cuánto cubre**: *"Se van a deshacer los cambios en N casos: X cambios
   de datos, Y contactos a restaurar y Z comentarios a borrar."* Si la acción se cortó, agrega *"La acción se
   cortó después de procesar F de T filas: Revertir deshace exactamente lo que alcanzó a hacer."* Y siempre
   termina con *"Si alguien editó a mano alguno de estos casos después de la acción, esos cambios se pisan."*
3. Confirmás. La reversión **corre en segundo plano** y la pantalla avisa *"Reversión en curso: te avisamos al
   terminar"*. Podés cerrar la pantalla: al terminar te llega una notificación en la campanita (*Acción masiva
   revertida*).
4. Mientras corre, la fila del Historial y el detalle muestran su avance (el detalle también sin conexión en
   tiempo real: consulta cada unos 10 segundos, así que puede tardar unos segundos en reflejarlo): **En cola**, **Revirtiendo 40 %** y,
   al terminar, **Revertida**. El detalle dice además qué deshizo: *"Se deshicieron X cambios de datos, se
   restauraron Y contactos y se borraron Z comentarios."* Si algún cambio no se pudo deshacer porque su caso ya
   no existe, lo dice aparte.

En el Historial el botón queda deshabilitado con **Se está revirtiendo** mientras corre y con **Ya se revirtió**
cuando terminó; en el detalle de la importación el botón **desaparece** en esos casos (el estado queda escrito).

### Si se interrumpe

Si el servidor se reinicia mientras revierte, la reversión **no se retoma sola**: queda como **Reversión
interrumpida: H de T** (cuántos cambios alcanzó a deshacer de cuántos) y el botón sigue habilitado, con el
cartel *"Revertir (sigue desde donde quedó)"*. Apretalo de nuevo: si alcanzó a deshacer algo, el diálogo dice *"Un intento anterior ya
revirtió R cambios; ahora se deshacen los que faltan."* y sigue exactamente desde ahí, sin repetir lo que ya
deshizo. Si el servidor se reinició, la pantalla puede seguir diciendo **Revirtiendo** y con el botón bloqueado
hasta unos 4 minutos, hasta que pasa a **Reversión interrumpida**. Si falló por otro motivo, el estado dice **La reversión falló** con el motivo, y se reintenta igual.

Una acción se revierte **una sola vez**: el único caso en que Revertir se vuelve a usar es para terminar una
reversión interrumpida o fallida.

### Cuándo el sistema se niega a revertir

El diálogo lo dice antes de confirmar, y deja el botón **Revertir** deshabilitado:

- **Todavía está corriendo**: *"La acción masiva todavía está corriendo. Cancelala, o esperá a que termine, y
  después revertila."*
- **Ya se está revirtiendo** (otra pestaña u otra persona lo pidió hace un momento): *"Esta acción ya se está
  revirtiendo. Mirá el avance en el Historial."*
- **No hizo ningún cambio** (por ejemplo, una cancelada antes de procesar alguna fila): *"Esta acción masiva no
  llegó a cambiar ningún caso: no hay nada que revertir."*
- Una acción **anterior a esta versión** que quedó a medias, con filas ya procesadas (falló o se cortó): *"Esta
  acción masiva no terminó bien: los datos para revertirla no se guardaron. Avisá a soporte; no la vuelvas a
  cargar."*
- Una acción **anterior a esta versión** que terminó **con advertencias**: *"Los datos para revertir esta
  acción no se guardaron completos: Revertir desharía solo una parte. Avisá a soporte."* Las acciones de ahora
  guardan cada cambio junto con su dato para deshacerlo, así que esto no les pasa.

Si la cola de trabajos no responde, el aviso es *"No se pudo poner la reversión en la cola. Probá de nuevo en
unos minutos; si se repite, avisá a soporte."* Si el servidor no responde al pedir revertir, la pantalla avisa
*"No llegó la respuesta del servidor. La reversión puede seguir corriendo: actualizá el Historial en unos
minutos antes de volver a intentar."* Mirá el Historial antes de repetir el pedido.

> **Revertir una acción borra los comentarios que esa acción creó.** Si la acción agregó un
> comentario, al revertir desaparece. Es coherente —se deshace todo lo que hizo— pero si el gestor
> agregó información encima, esa se pierde también.

---

## Cancelar una acción masiva

Una acción masiva se puede cancelar **en cualquier momento**, también si ya está procesando: corta al terminar
el caso en curso. Antes de confirmar, el diálogo de **Cancelar importación** dice: *"Lo que ya se aplicó queda
aplicado. Después lo podés deshacer con Revertir desde el Historial: deshace exactamente lo que alcanzó a
hacer."*

**Cancelar solo cancela.** No deshace nada: los casos que ya se tocaron quedan tocados, y el cierre de la carga
no corre. Revertir es un paso aparte, que el diálogo de Revertir describe antes de confirmar con el número
exacto de casos que cubre. Si todavía estaba en la cola, no se aplica nada y se puede retomar.

Ver [Importar un archivo](/ayuda/importacion/importar-un-archivo), "Cancelar una importación".

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

### No se creó el comentario

Si el índice de columna no existe, la variable se reemplaza por **vacío** — y si el texto entero queda
vacío, **no se crea ningún comentario** y la fila igual cuenta como OK. Los índices arrancan en **0**.

### El comentario salió con `{{col2}}` literal

La variable está mal escrita y no la reconoce. Tiene que ser exactamente `{{col2}}`: no valen
`{{col_2}}`, `{{columna2}}` ni `{{col2}`.

### Dice que entraron 500 filas OK pero no cambió nada

**Una fila que no matchea ningún caso cuenta como OK.** No es un error, solo incrementa un contador
interno. Si la corrida terminó en verde y no ves cambios, mirá el **preview de impacto**: es el único
lugar donde figura cuántos casos matchearon de verdad.

### El estado no se aplicó y no hubo error

Cuando el valor viene de una columna, se busca por el **código exacto** del parámetro. Si el archivo
trae la descripción en vez del código, o un código que no existe, la operación se saltea sin avisar.

---

## Preguntas frecuentes

**¿Puedo aplicar varias operaciones de una vez?**
Sí, se aplican en el orden en que están declaradas en la plantilla.

**¿Puedo revertir dos veces?**
No. Una acción revertida queda marcada como tal (**Ya se revirtió**). La excepción es una reversión que se
interrumpió o falló: **Revertir** la retoma y sigue desde donde quedó.

**¿La reversión devuelve los comentarios que borró?**
No. Revertir borra los comentarios que la acción creó; no hay un "revertir la reversión".

**¿Revertir respeta lo que edité a mano después?**
No: pisa el valor con el que estaba antes de la acción. La propia pantalla lo advierte al confirmar.

**¿Y una carga "finalizada con advertencias"?**
Las acciones de esta versión guardan los datos para deshacer junto con cada cambio, así que se pueden revertir
también si el cierre de la carga no terminó. Una acción **anterior** que terminó con advertencias no se puede
revertir: el sistema responde *"Los datos para revertir esta acción no se guardaron completos…"*. Avisá a
soporte.

**¿Y si el servidor se reinició mientras corría la acción?**
Una carga que se interrumpe **ya no se reinicia sola**: a los pocos minutos sin señal queda **fallida** con
el motivo *"La importación se interrumpió: el servidor se reinició o dejó de responder mientras la
procesaba."* Los cambios aplicados hasta el corte **se pueden revertir** con el botón **Revertir**, que cubre
exactamente lo que alcanzó a hacer. **No vuelvas a cargar el archivo** antes de revertir.

**¿Puedo cancelar una acción masiva que está corriendo?**
Sí. Cancelar solo corta: lo ya aplicado queda aplicado y se deshace después con **Revertir**.

**¿Puedo revertir una carga que quedó fallida?**
Sí, si es de esta versión: el botón aparece también en las canceladas y en las cortadas, y deshace lo que
alcanzó a hacer. Una acción fallida **anterior** a esta versión no se puede revertir: el sistema responde
*"Esta acción masiva no terminó bien…"*. Avisá a soporte.

**¿Sirve para cargar pagos o facturas?**
No. Acciones masivas toca estados, campos, datos adicionales, comentarios y contactos. Para plata están
Pagos y Actualizaciones.
