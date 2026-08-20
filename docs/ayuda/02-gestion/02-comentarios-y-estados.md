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

**Enter envía el comentario; Shift+Enter hace un salto de línea.** Y si te vas de la ficha a mitad de
escribir, el borrador se guarda: al volver sigue ahí.

> **Los comentarios se listan del más viejo al más nuevo**, en un panel con scroll. Lo último escrito
> está abajo.

> **Un comentario no se puede borrar desde la ficha**: no hay botón. Tampoco se puede editar.

> **Los comentarios que deja una importación de acciones masivas no se distinguen a simple vista**:
> aparecen sin autor, igual que cualquier otro comentario sin usuario.

## Los tres estados

Debajo del encabezado de la ficha. **Los tres los configura cada cedente**: los códigos que ves
dependen de la empresa.

### Situación del cliente

Dónde está parado el caso. Ejemplos reales del catálogo: *Sin contacto*, *Inubicable*, *Se mudó*,
*Contactado con titular*, *Promesa de pago vigente*, *Pago parcial*, *Negativa de pago*, *Fallecido*,
*En mediación*, *Cancelado / Pagado*.

### Estado de Gestión

Dónde está el trabajo. Ejemplos reales: *Gestión sin definición*, *Sin contacto*, *Teléfono no contesta
- múltiples intentos*, *Desasignado*.

### Motivo No Pago

Por qué no paga, cuando lo dijo. Es el dato que después se le informa al cedente.

> **Hay que apretar Guardar.** Mover el selector no persiste nada.

---

## Qué mueve cada estado

Esto es lo que más confunde, porque **no todos los estados los movés vos**:

| Lo mueve… | Qué |
|---|---|
| **Vos, a mano** | Cualquiera de los tres, apretando Guardar |
| **Cargar una promesa** | La situación pasa a promesa vigente — **solo si el caso no tenía pagos** |
| **Anular una promesa** | Devuelve la situación anterior |
| **Que la promesa venza** | La marca incumplida, si el caso sigue en promesa vigente |
| **La consolidación por pagos** | Cancela el caso, o lo marca como pago parcial |
| **Borrar un pago manual** | Puede devolver la situación al estado inicial de la plantilla. Es la única forma de "descancelar" desde la aplicación |
| **Una importación de casos** | El estado inicial de los nuevos, el desasignado de los ausentes, o la re-asignación cuando el caso reaparece |
| **Una acción masiva** | Pisa los tres directamente. Es el más potente |
| **Revertir una acción masiva** | Devuelve los tres al valor previo, pisando lo que hayas cambiado después |

O sea: **si un estado cambió solo, no es un error**. Casi siempre lo movió un pago, una promesa o una
importación.

> **La cancelación no espera al saldo en cero exacto**: alcanza con que lo pagado llegue al 99% del
> monto original. La tolerancia es configurable.

---

## Situación y gestión no son lo mismo

Un caso puede estar en gestión **"no contesta"** y en situación **"cancelada"** al mismo tiempo: nunca
atendió el teléfono, pero pagó por home banking.

Los dos catálogos se parecen bastante y por eso se confunden. La forma corta de distinguirlos:

- **Situación** es sobre **el cliente y su deuda**.
- **Gestión** es sobre **tu trabajo con ese caso**.

---

## ⚠ Una cuenta cancelada no acepta cambios

Cuando un caso queda cancelado, los controles se deshabilitan y **la caja de comentarios desaparece**.
No vas a poder dejar constancia de nada posterior desde la ficha.

Solo bloquea el código *Cancelado / Pagado*: hay otros códigos de cancelación que no bloquean nada.

Y una salvedad: el caso **sí se sigue moviendo solo**. Si entran pagos, la consolidación le recalcula
el saldo y la situación igual, porque no pasa por ese bloqueo.

---

## Qué puede salir mal

### No me deja cambiar el estado

Dos causas: la cuenta está **cancelada**, o falta el permiso **Editar estado de deudores**.

### El estado cambió solo

Lo movió una promesa, un pago o una importación.

> **Auditoría no siempre lo va a explicar.** Filtrando por el ID del deudor aparecen los cambios
> **manuales** y la carga de pagos a mano. Los automáticos —la consolidación, el vencimiento de
> promesas, la desasignación masiva— **no quedan registrados por caso**: se auditan como una sola
> operación de la corrida completa.

### No encuentro el código que necesito

Los catálogos se configuran **por empresa**. Si falta uno, se agrega en Ajustes → Parámetros.

### Escribí un comentario y desapareció

Si el caso tuvo una reversión de acción masiva, **los comentarios que esa acción creó se borran**. Los
escritos por una persona no se tocan.

Lo que sí se pisa al revertir son **los estados y los campos del caso**, que vuelven al valor previo a
la acción — incluyendo cualquier cambio manual posterior.

---

## Preguntas frecuentes

**¿Puedo editar o borrar un comentario?**
No. Desde la ficha no se puede ninguna de las dos cosas.

**¿Los comentarios los ve el cedente?**
No directamente, pero salen en los reportes. Escribilos como si los fuera a leer.

**¿Cuál es la diferencia entre motivo de no pago y situación?**
La situación es el estado del caso; el motivo es la explicación que dio el deudor. Un caso en
"negativa de pago" con motivo "desconoce la deuda" cuenta una historia distinta que el mismo caso con
motivo "sin trabajo".

**¿Dónde veo todo lo que se hizo en un caso?**
No hay una vista única: los comentarios en su solapa, los pagos en la suya, las comunicaciones en
Timeline y los cambios de estado en Auditoría.
