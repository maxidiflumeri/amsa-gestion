<!--
seccion: Gestión de casos
resumen: La pantalla donde se trabaja un caso: qué muestra el encabezado y qué hay en cada solapa.
revisado: 2026-08-20
rutas: /gestion
-->
# La ficha del caso

## Para qué sirve

Es la pantalla donde se trabaja. Todo lo que se sabe de un caso está acá, y todo lo que se hace se hace
desde acá.

## Cómo está organizada la pantalla

**Gestión** tiene cuatro solapas arriba de todo:

| Solapa | Qué es |
|---|---|
| **Datos del deudor** | La ficha. Es donde se trabaja |
| **Lista de deudores** | Una tabla con todos los casos, con filtro y paginado |
| **Política** | Lo que el cedente autoriza para esa remesa |
| **Timeline** | Los envíos de mail y WhatsApp registrados por AMSA Sender |

Las cuatro las ve todo el mundo: el filtro por rol que había quedó sin efecto.

Y **dentro de la ficha** hay otras cinco solapas, que son las del caso. Es fácil confundirlas.

---

## El encabezado

Nombre, documento, **ID del deudor** —el número con el que después filtrás la auditoría—, empresa,
remesa y número de cliente del cedente.

A la derecha, **el número**. Se muestra **uno solo** de los tres:

| Si el caso… | Ves |
|---|---|
| Tiene recargo por mora calculado | **Deuda actualizada** |
| No tiene mora pero sí pagos | **Saldo actualizado** |
| Ninguna de las dos | **Deuda total** |

> ### ⚠ La deuda actualizada no descuenta los pagos
>
> **Deuda actualizada = importe original + recargo por mora.** El recargo se calcula sobre el importe
> original de cada factura, **sin restar lo que el deudor ya pagó**.
>
> Lo pagado aparece abajo, en letra chica.
>
> **En un caso con mora y con pagos, el número grande no es lo que el deudor debe hoy.** Antes de
> cantar un importe por teléfono, mirá también el renglón "Pagado".

Debajo del número, la fecha a la que está calculado el recargo. **Si está en naranja**, el cálculo
tiene más de un día y el número quedó corto.

Si el caso está cancelado aparece el chip **CUENTA CANCELADA**.

## Gestión y Estado

La tarjeta con los tres selectores: **Situación del cliente**, **Estado de Gestión** y **Motivo No
Pago**.

**Hay que apretar Guardar.** Cambiar el selector no persiste nada por sí solo.

> Sin el permiso **Editar estado de deudores** los tres selectores aparecen deshabilitados, y el
> tooltip dice por qué.

> **El motivo de no pago se puede quitar**: eligiendo "Sin motivo" y guardando, se borra.

Los catálogos **se pueden configurar por cedente**, aunque hoy todas las empresas comparten el mismo
set. Y en el selector solo aparecen los códigos activos: si un caso quedó con uno que después se
desactivó, el selector se ve vacío.

## Los contactos

Teléfonos, mails, domicilios y redes, más dos tarjetas: **Codeudores** y **Datos Adicionales**.

> ### El chip CODEUDOR
>
> Marca qué teléfono o mail **no es del titular**. Mirarlo antes de llamar evita reclamarle la deuda a
> la persona equivocada.

Cada teléfono muestra si está **verificado** o si tiene formato dudoso, y una estrella para el
**principal** — que es el que va primero en la lista. Los fijos no se pueden marcar como WhatsApp.

Mails, domicilios y redes se ordenan por prioridad; los teléfonos, por el principal y después por orden
de carga.

## Las cinco solapas de la ficha

| Solapa | Qué trae |
|---|---|
| **Comentarios** | La gestión escrita |
| **Facturas** | El detalle de la deuda |
| **Pagos** | Las cobranzas **y las promesas** |
| **Convenios** | Los planes de pago y sus cuotas |
| **Otras Cuentas** | Los demás casos de esta persona |

> **Las promesas viven en la solapa Pagos**, con su estado y el botón de anular. El contador del título
> cuenta solo los pagos, así que puede decir "Pagos (0)" y haber promesas adentro.

### Otras Cuentas: útil, pero suele estar vacía

Lista los demás casos de esa persona, con empresa, remesa, deuda, situación y gestión.

> **Cruza por documento exacto.** Los casos cargados **sin DNI** llevan un identificador propio, así
> que **no se agrupan entre sí**. En carteras donde el cedente no manda DNI —que son varias— la solapa
> aparece vacía aunque la persona tenga otros casos.

### Timeline: qué muestra y qué no

Los envíos de mail y WhatsApp registrados por AMSA Sender, **incluidas las aperturas y los clics**, que
suele ser lo más útil.

**No es el historial del caso**: los comentarios están en su solapa, los pagos en la suya y los cambios
de estado en Auditoría.

Tiene **filtros de canal y fecha** — si dice que no hay nada, revisalos primero. Y cruza **por
documento**: un caso sin DNI real no va a mostrar nada.

---

## ⚠ Cuando la cuenta está cancelada

Los controles se **deshabilitan**, con un aviso al pasar por encima, y la caja de comentarios
desaparece. No llegás a intentar nada.

Queda bloqueado: comentar, borrar un comentario, cargar un pago, **borrar un pago**, cargar una
promesa, tocar los contactos, crear o anular un convenio, **registrar una cuota** y cambiar los
estados.

**Sigue funcionando**: mandar un mail desde un contacto, y anular una promesa vigente.

Dos cosas que conviene saber:

> **Solo bloquea el código "Cancelado / Pagado".** Hay otros códigos de cancelación —cancelado antes de
> la gestión, a liquidar, a monto histórico— que **no bloquean nada**. Ver un caso cancelado que se
> deja editar no es un bug.

> **Si la cancelación fue por un pago mal cargado, no hay salida desde la ficha**: borrar ese pago
> también está bloqueado.

---

## Qué puede salir mal

### No me deja escribir un comentario ni cambiar nada

La cuenta está cancelada. Fijate el chip del encabezado.

### Cambié el estado y no se guardó

Falta apretar **Guardar** en la tarjeta de Gestión y Estado.

### Cambié el estado, apreté Guardar y dio error

Falta el permiso **Editar estado de deudores**. La pantalla no lo esconde.

### El selector de situación aparece vacío

El caso tiene un código que después se desactivó. Solo se listan los activos.

### El número del encabezado no es lo que el deudor debe

Si hay mora **y** pagos, el número grande no los descuenta. Mirá el renglón "Pagado".

### La fecha de cálculo está en naranja

El recargo se calculó hace más de un día y quedó corto. Hay que recalcular.

### Otras Cuentas está vacía y sé que tiene más casos

Esa cartera se cargó sin DNI. Los casos sin documento real no se cruzan entre sí.

### El Timeline dice que no hay historial

Primero revisá los **filtros de canal y fecha**. Si están limpios, puede ser que el caso no tenga DNI
real, o que no haya envíos.

---

## Preguntas frecuentes

**¿Por qué la misma persona aparece varias veces?**
Cada asignación del cedente es un caso distinto.

**¿Puedo borrar un comentario?**
**No desde la ficha**: no hay botón de borrar comentarios en la pantalla.

**¿Puedo borrar un pago?**
Solo los cargados a mano, y con el permiso correspondiente. Los de importación y los de cuota de
convenio no.

**¿Dónde veo quién cambió un estado?**
En **Auditoría**, filtrando por el ID del deudor — pero solo aparecen los cambios **manuales**. Los
automáticos no se registran por caso.
