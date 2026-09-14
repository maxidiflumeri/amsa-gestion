<!--
seccion: Importación de datos
resumen: La categoría Claves de pago (multiclaves): qué archivo carga, cómo crear la plantilla, qué empresa elegir y cómo leer la vista previa.
revisado: 2026-09-14
rutas: /carga, /plantillas, /historial-importaciones
-->
# Claves de pago (multiclaves)

## Para qué sirve

Telecom/Personal manda, junto con cada asignación, un archivo con **dos claves de pago por
trámite**: una por el saldo total y otra con una quita del 50%. Esta categoría carga esas claves
para que más adelante (fase 2) se pueda generar el cupón con el código de barras y registrar el
convenio correspondiente.

**Esta carga NO crea casos.** Las claves llegan casi siempre antes que el CA del cedente — el
archivo trae trámites que todavía no existen en el sistema — así que se guardan solas y se
resuelven contra el caso cuando hace falta (cuando llega el CA, o al generar el cupón).

## El archivo

- Separador `|`, con encabezado. Cada fila trae 10 columnas: trámite, número de convenio, saldo del
  trámite, importe de la clave, la clave de pago (22 dígitos), el vencimiento, el código de barras
  (50 dígitos), el código de gestor, el nombre (se ignora — no es el cliente) y una décima columna
  sin nombre que Telecom manda en `C`.
- Cada trámite trae normalmente **dos** filas: la de menor importe es la clave **con quita**, la
  otra es la de **saldo total**. No importa el orden en que vengan. A veces Telecom manda un trámite
  con **una sola** fila — sin la clave de quita —; si el importe de esa fila **es igual al saldo del
  trámite**, se carga igual, clasificada como **TOTAL**, con el aviso **Solo TOTAL** (ver más abajo).
  Si el importe de esa única fila **no** es el saldo, se rechaza: probablemente sea una quita que
  perdió a su total en el camino, y cargarla sola inventaría un "saldo total" que en realidad es la
  mitad. Un trámite con 3 o más filas, o con 2 filas del mismo importe (no se puede decidir cuál es
  la quita), también se rechaza completo.
- El sistema valida los dígitos verificadores de la clave y del código de barras, y que los tres
  (columnas, clave, código de barras) coincidan entre sí. Una fila que no calza se rechaza — y sigue
  contando para su trámite (aunque el resto de sus datos esté roto), así que ese trámite queda con
  una fila inválida y se rechaza entero, como corresponde. Solo si ni el número de trámite de esa
  fila se puede leer queda sin poder asociarse a nada.

## Crear la plantilla

A diferencia de Facturas o Deudores, acá **no hay mapeo de columnas para elegir**: el archivo de
Telecom tiene una forma fija y el sistema la conoce de memoria (posiciones, dígitos verificadores,
todo). El único campo del editor es **Códigos de gestor aceptados** — por defecto `1008`, que es el
que usa Ana Maya. Una fila con otro código en esa columna se rechaza como "gestor ajeno".

No hace falta elegir estado de situación ni de gestión inicial: la clave no se ata a ningún deudor
al cargarla, así que esos campos no aplican y el editor no los pide.

## Qué empresa elegir

La misma que la de los casos a los que corresponden esos trámites (Telecom o Telecom Personal,
según la cartera). Si te equivocás de empresa, **no da error al cargar** — las claves entran igual,
solo que van a quedar "sin caso" para siempre en esa empresa. La vista previa está pensada
justamente para pescar este error antes de confirmar: mirá el reparto de "con caso" contra el de
"sin caso", y si la empresa correcta tiene casos y la elegida no, es la señal.

## Cómo leer la vista previa

En vez de la tabla de filas de siempre, esta categoría muestra un resumen (el archivo es chico —
unas 15 mil líneas — así que se lee entero, no una muestra):

| Dato | Qué significa |
|---|---|
| **Válidos / rechazados** | Trámites que pasaron todas las validaciones vs. los que no. Los rechazados no se cargan; el motivo de cada uno (dígito verificador, columnas incompletas, mismo importe en las dos claves…) queda en el historial |
| **Solo TOTAL** | De los válidos, cuántos trajeron una única clave cuyo importe es el saldo del trámite (sin la de quita). Se cargan igual, clasificada como TOTAL; no hay forma de fabricar la quita que Telecom no mandó. Una única clave cuyo importe **no** es el saldo no entra acá — se rechaza (ver arriba) |
| **Con caso / sin caso** | Cuántos trámites ya tienen un caso cargado en la empresa elegida, ahora mismo. Los "sin caso" se cargan igual — quedan guardados y listos para usarse desde la ficha cuando se habilite el cupón (fase 2); los "con caso" tampoco se ven todavía en la ficha, esta fase solo carga y guarda |
| **En otra empresa** | Si ninguno tiene caso en la empresa elegida pero sí los tiene otra, aparece en rojo — es la señal de "elegiste mal la empresa" |
| **Ya cargadas** | Trámites cuyas claves ya están **todas** en la base exactamente igual (recargaste el mismo archivo) — una, si el trámite es Solo TOTAL; dos, si es el par de siempre |
| **Reemisiones** | Trámites que ya tenían una tanda de claves vigente, y la nueva tiene vencimiento **igual o posterior**: la anterior queda reemplazada por esta, que pasa a ser la vigente. Esto vale aunque la tanda vieja y la nueva no tengan la misma cantidad de claves — una tanda de 2 (TOTAL + QUITA) puede ser reemplazada por una de 1 (solo TOTAL), o al revés: siempre se reemplazan **todas** las claves vigentes del trámite, para no dejar una quita vieja conviviendo con una TOTAL nueva |
| **Tandas anteriores** | Lo opuesto: la tanda que se está por cargar tiene vencimiento **anterior** a la que ya está vigente. Se carga igual (para no perder el dato ni el reclamo), pero queda reemplazada — la vigente sigue siendo la que ya estaba |
| **Conflictos** | Convenios que ya están cargados en otra empresa o en otro trámite — se rechazan; probablemente el mismo archivo se subió por error en la empresa que no era |
| **Avisos** | Cosas que no bloquean la carga pero conviene revisar: saldo distinto entre las dos filas de un trámite, marca (10ª columna) con un valor raro, quita que no es la mitad exacta, clave ya vencida al momento de cargar, etc. |

## Qué pasa al recargar el mismo archivo

Es idempotente: cada clave se identifica por su **número de convenio**, que Telecom nunca repite.
Recargar el mismo archivo en la misma empresa no duplica nada — la vista previa lo va a mostrar
como "ya cargadas". Si el mismo archivo se sube en **otra** empresa, todos sus convenios chocan
contra los que ya existen y se rechazan como conflicto.

## El número de remesa

Esta carga **no usa el correlativo de remesas** de la empresa (el `00001`, `00002`… de las demás
categorías). El campo se puede dejar vacío — el sistema genera uno con el formato
`MC-AAAAMMDD-HHmmss` — o escribir uno propio siempre que **no** sea puramente numérico. Un número
numérico en esta categoría da error: si se dejara pasar, la carga de claves consumiría el próximo
número correlativo y correría la numeración de las asignaciones de Telecom. Si dos cargas arrancan
en el mismo segundo (por ejemplo, un reintento después de un error), el sistema le agrega un sufijo
al número generado — nunca da error 500 por esto.

## Cuándo no se puede borrar

Una clave que ya tiene un convenio (o un cupón emitido — fase 2) **nunca se borra**. Si intentás
eliminar una carga de claves que ya tiene alguna en ese estado, el sistema lo rechaza y dice
cuántas. El resto del borrado se comporta distinto a las demás categorías: como esta carga no crea
casos, borrarla no toca ningún deudor — solo borra las claves. Si esa carga había reemplazado una
tanda anterior, esa tanda anterior **vuelve a quedar vigente** (salvo que después haya llegado una
tercera tanda más nueva, en cuyo caso la del medio se borra y la de más atrás sigue reemplazada).

## En el historial

El detalle de una carga de claves usa el mismo lenguaje que el resto (filas OK / con error), pero
acá "fila" es un **trámite** — normalmente dos claves, a veces una sola (Solo TOTAL). Hay una sección
aparte, **Claves de pago**, con el estado real de la base al momento de mirarla (vigentes,
reemplazadas, con caso / sin caso): a diferencia del resto del resumen, esto se recalcula cada vez
que se abre la pantalla, porque "con caso" cambia solo cuando llega el CA. Desde ahí se puede ver el
listado de trámites que todavía no tienen caso.

> **El chip "Solo TOTAL" de esta pantalla cuenta lo que ESTA carga en particular trajo**, no el
> estado actual de la base. Si recargás el mismo archivo (carga idempotente, "ya cargadas"), la carga
> nueva no escribe nada — así que su propio chip "Solo TOTAL" da 0, aunque esos trámites sigan siendo
> Solo TOTAL en la base. Para ver el estado vigente de un trámite puntual, andá a la ficha del caso
> (cuando esté disponible) o a la vista previa de una carga nueva del mismo archivo.

## Lo que todavía no hace esta fase

Cargar las claves no genera ningún cupón ni convenio — eso es la fase 2. Por ahora, cargar el
archivo deja las claves guardadas y listas para cuando la ficha del deudor las use.
