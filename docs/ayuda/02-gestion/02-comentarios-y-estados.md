<!--
seccion: Gestión de casos
resumen: Dejar registro de la gestión y mover los estados del caso.
revisado: 2026-08-20
rutas: /gestion
-->
# Comentarios y estados

## Para qué sirve

Es el núcleo del trabajo diario: dejar escrito qué pasó en la gestión y reflejarlo en los estados del
caso.

## Los comentarios

La solapa **Comentarios** de la ficha. Cada comentario queda con quién lo escribió y cuándo.

**Escribí para el que venga después.** El comentario no es para vos: es para el gestor que agarre el
caso en tres semanas, o para responderle al cedente por qué no se cobró. Un "no atiende" sirve mucho
menos que "llamé a los dos teléfonos, el 4567 da fuera de servicio, el celular suena y corta".

Lo que conviene que quede escrito:

- **A qué número llamaste** y qué pasó.
- **Con quién hablaste**: el titular, un familiar, nadie.
- **Qué dijo**, si dijo algo. Sobre todo si prometió algo o dio un motivo.
- **Qué acordaste**: cuándo vuelve a llamar, qué se le mandó.

Un comentario se puede borrar, pero **solo el propio** y con el permiso correspondiente.

> Los comentarios que crea una importación de acciones masivas quedan marcados como tales, así que se
> distinguen de los que escribió una persona.

## Los tres estados

Debajo del encabezado de la ficha. **Los tres los configura cada cedente**: los códigos que ves
dependen de la empresa.

### Situación del cliente

Dónde está parado el caso. Ejemplos típicos: sin contacto, inubicable, se mudó, contactado con el
titular, promesa de pago, negativa de pago, fallecido, en mediación, cancelado.

### Estado de gestión

Dónde está el trabajo: sin gestionar, en gestión, no contesta, desasignado.

### Motivo de no pago

Por qué no paga, cuando lo dijo. Es el dato que después se le informa al cedente.

---

## Qué mueve cada estado

Esto es lo que más confunde, porque **no todos los estados los movés vos**:

| Lo mueve… | Qué |
|---|---|
| **Vos, a mano** | La mayoría de las situaciones y estados de gestión |
| **Cargar una promesa** | Pone la situación en promesa de pago |
| **Que la promesa venza** | La pasa a promesa incumplida |
| **La consolidación por pagos** | Cancela el caso cuando el saldo llega a cero, o lo marca como pago parcial |
| **Una importación** | El estado inicial de los casos nuevos, o el desasignado de las actualizaciones diarias |

O sea: **si un estado cambió solo, no es un error**. Casi siempre lo movió un pago o una importación.

---

## Situación y gestión no son lo mismo

Un caso puede estar en gestión **"no contesta"** y en situación **"cancelada"** al mismo tiempo: nunca
atendió el teléfono, pero pagó por home banking.

Los dos catálogos se parecen bastante y por eso se confunden. La forma corta de distinguirlos:

- **Situación** es sobre **el cliente y su deuda**.
- **Gestión** es sobre **tu trabajo con ese caso**.

---

## ⚠ Una cuenta cancelada no acepta cambios

Cuando un caso queda cancelado, la ficha entera pasa a solo lectura: no se puede comentar ni cambiar
estados.

Si querés dejar constancia de algo posterior, no vas a poder hacerlo desde la ficha.

---

## Qué puede salir mal

### No me deja cambiar el estado

Dos causas: la cuenta está **cancelada**, o falta el permiso **Editar estado de deudores**.

### El estado cambió solo

Lo movió una promesa, un pago o una importación. Se puede ver quién y cuándo en **Auditoría**,
filtrando por el caso.

### No encuentro el código que necesito

Los catálogos se configuran **por empresa**. Si falta uno, se agrega en Ajustes → Parámetros.

### Borré un comentario y no puedo recuperarlo

No hay papelera. El dato se borra; queda el registro de que alguien lo borró, en Auditoría.

### Escribí un comentario y desapareció

Si el caso tuvo una reversión de acción masiva, **los comentarios que esa acción creó se borran** — y
si alguien escribió encima, eso también se pierde.

---

## Preguntas frecuentes

**¿Puedo editar un comentario?**
No. Se borra y se escribe de nuevo, si es tuyo.

**¿Los comentarios los ve el cedente?**
No directamente, pero salen en los reportes. Escribilos como si los fuera a leer.

**¿Cuál es la diferencia entre motivo de no pago y situación?**
La situación es el estado del caso; el motivo es la explicación que dio el deudor. Un caso en
"negativa de pago" con motivo "desconoce la deuda" cuenta una historia distinta que el mismo caso con
motivo "sin trabajo".

**¿Dónde veo todo lo que se hizo en un caso?**
No hay una vista única: los comentarios en su solapa, los pagos en la suya, las comunicaciones en
Timeline y los cambios de estado en Auditoría.
