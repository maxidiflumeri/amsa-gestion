<!--
seccion: Gestión de casos
resumen: La pantalla donde se trabaja un caso: qué muestra el encabezado y qué hay en cada solapa.
revisado: 2026-08-20
rutas: /gestion
-->
# La ficha del caso

## Para qué sirve

Es la pantalla donde se trabaja. Todo lo que se sabe de un caso está acá, y todo lo que se hace —
comentar, cargar un pago, armar un convenio, cambiar un estado — se hace desde acá.

## El encabezado

Arriba, los datos que identifican el caso: nombre, documento, empresa, remesa y número de cliente del
cedente.

A la derecha, **el número**. Cuál se muestra depende del caso, y **se muestra uno solo**:

| Si el caso… | Ves |
|---|---|
| Tiene recargo por mora calculado | **Deuda actualizada** (con el original tachado y el recargo abajo) |
| No tiene mora pero sí pagos | **Saldo actualizado** (con el original tachado y lo pagado abajo) |
| No tiene ninguna de las dos | **Deuda total** |

> **El importe original nunca baja con los pagos.** Lo que baja es el saldo. Está explicado en
> [Cómo piensa el sistema](/ayuda/primeros-pasos/como-piensa-el-sistema).

Si el caso está cancelado, aparece un cartel **CUENTA CANCELADA** y el número se pinta en verde.

## Los estados

Debajo del encabezado, tres selectores:

- **Situación del cliente** — dónde está parado el caso: sin contacto, contactado, promesa de pago,
  negativa, cancelado.
- **Estado de gestión** — dónde está el trabajo: sin gestionar, en gestión, no contesta, desasignado.
- **Motivo de no pago** — por qué no paga, cuando lo dijo.

Se cambian desde ahí mismo, y requieren el permiso **Editar estado de deudores**.

**Los tres catálogos los configura cada cedente**: los códigos que ves dependen de la empresa.

## Los contactos

En un panel aparte: teléfonos, mails y domicilios, ordenados por prioridad.

Los teléfonos muestran si son fijo o móvil, y si están marcados para WhatsApp. Los domicilios pueden
tener una etiqueta que dice de qué son — el de servicio o el de facturación, por ejemplo.

## Las solapas

| Solapa | Qué trae |
|---|---|
| **Comentarios** | La gestión escrita del caso |
| **Facturas** | El detalle de la deuda |
| **Pagos** | Las cobranzas registradas |
| **Convenios** | Los planes de pago y sus cuotas |
| **Otras Cuentas** | Los demás casos de esta misma persona |

Facturas, Pagos y Convenios muestran la cantidad en el título, así que de un vistazo sabés si hay algo
adentro.

Fuera de esas, la ficha tiene además:

- **Política** — qué formas de pago y qué tipo de atención autoriza el cedente para esta remesa. Es lo
  que mirás antes de negociar.
- **Timeline** — los envíos de mail y WhatsApp registrados por AMSA Sender.

> **La solapa Timeline no es el historial del caso.** Muestra solo las comunicaciones salientes. Los
> comentarios están en su solapa, los pagos en la suya, y los cambios de estado en la sección de
> Auditoría.

## Otras Cuentas: la solapa que más se subestima

Lista **todos los casos de esa misma persona**, incluso de otras empresas y otras remesas.

Sirve para dos cosas concretas:

- **Saber con quién estás hablando.** Alguien que debe en tres carteras no es lo mismo que alguien que
  debe en una.
- **No pisarte con otro gestor.** Si el caso de al lado tiene una promesa de la semana pasada, conviene
  saberlo antes de llamar.

---

## ⚠ Cuando la cuenta está cancelada, la ficha se bloquea

Un caso cancelado pasa a **solo lectura**. No se puede:

- comentar
- cargar un pago o una promesa
- crear o anular un convenio
- tocar los contactos
- cambiar los estados

Si intentás, el sistema lo rechaza con un aviso de cuenta cancelada.

**No es un error, es a propósito**: una cuenta cancelada ya se rindió al cedente y no debería moverse
por una gestión posterior.

Si un caso quedó cancelado por error —pasa cuando una importación de actualizaciones sale mal— **no se
arregla desde la ficha**. Hay que escalarlo.

---

## Qué puede salir mal

### No me deja escribir un comentario ni cambiar nada

La cuenta está cancelada. Fijate el cartel del encabezado.

### No veo los selectores de estado

Falta el permiso **Editar estado de deudores**. Los estados se ven pero no se cambian.

### El número del encabezado no es el que esperaba

Se muestra uno solo de los tres, según el caso. Mirá la etiqueta de arriba: dice cuál es.

### La deuda actualizada no coincide con lo que dice el cedente

Fijate la fecha de cálculo, abajo del número. Si tiene varios días, el recargo quedó corto: hay que
recalcular.

### El Timeline dice que no hay historial

Ese caso no tiene comunicaciones registradas en AMSA Sender. No quiere decir que no se haya gestionado
— los comentarios están en su propia solapa.

---

## Preguntas frecuentes

**¿Por qué la misma persona aparece varias veces?**
Porque cada asignación del cedente es un caso distinto. Se ven todos en **Otras Cuentas**.

**¿Puedo borrar un comentario?**
Solo los tuyos, y con el permiso correspondiente.

**¿Puedo borrar un pago?**
Solo los que se cargaron **a mano**. Los que entraron por una importación no se pueden eliminar.

**¿Dónde veo quién cambió un estado?**
En la sección **Auditoría**, filtrando por el caso.
