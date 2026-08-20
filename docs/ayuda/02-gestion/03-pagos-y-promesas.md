<!--
seccion: Gestión de casos
resumen: Registrar una cobranza, anotar una promesa y entender qué pasa cuando vence.
revisado: 2026-08-20
rutas: /gestion
-->
# Pagos y promesas

## La diferencia, en una línea

**Una promesa es lo que el deudor dijo que va a hacer. Un pago es lo que hizo.**

Cargar una promesa no baja el saldo. Solo el pago lo baja.

Las dos se cargan desde **el mismo botón** de la solapa Pagos: el modal tiene un interruptor para
elegir *Pago real* o *Promesa*.

---

## ⚠ Antes que nada: no toques la situación "Cancelado"

El desplegable de **Situación del cliente** incluye *Cancelado / Pagado*, y **el sistema te deja
elegirlo**. No pide permiso especial ni pregunta nada.

**Es una puerta de una sola dirección.** Apenas guardás, el caso queda bloqueado — y como cambiar
estados también está bloqueado, **no podés volver atrás desde la ficha**.

Un caso se cancela solo, cuando el saldo llega a cero. **No hay ninguna razón para marcarlo a mano.**

---

## Promesas de pago

### Cómo se carga

Desde la solapa Pagos, botón **Cargar**, interruptor en *Promesa*. Se completa la fecha prometida y,
opcionalmente, el monto.

**La fecha tiene límites**: no puede ser anterior a hoy, ni ir más allá de **7 días** (configurable por
empresa, entre 1 y 30). El calendario ya viene acotado.

### Qué pasa al cargarla

**Si el caso no tiene ningún pago registrado**, la situación pasa a *Promesa de pago vigente*.

**Si ya tenía algún pago** —por ejemplo, está en pago parcial— la promesa se guarda igual pero **la
situación no se toca**. No es un error.

> **Solo puede haber una promesa vigente por caso.** Si cargás otra, **la anterior se anula sola**, sin
> avisar.

### Los estados

| Estado | Cuándo |
|---|---|
| **Vigente** | Recién cargada |
| **Cumplida** | Entró un pago — ver abajo |
| **Incumplida** | Venció sin pago |
| **Anulada** | La diste de baja, **o cargaste otra promesa encima** |

> **Las promesas anuladas desaparecen de la ficha.** No se listan. Quedan en los reportes y en la
> auditoría, pero desde la pantalla no las vas a volver a ver.

### ⚠ Cualquier pago marca la promesa como cumplida

Apenas entra **un peso** de pago, la promesa pasa a **cumplida** — sin comparar contra el monto
prometido.

Un pago de $100 contra una promesa de $50.000 la cierra como cumplida. Y una vez cumplida **no se puede
anular ni corregir**: no hay forma de fijar el estado a mano.

**Si el deudor va a pagar bastante menos de lo prometido**, tenés que decidir antes de cargar el pago:
si la promesa se anula primero, queda anulada; si cargás el pago, queda cumplida.

### Qué pasa cuando vence

Se marca **incumplida** por un proceso que corre **todos los días a las 2 de la mañana**. Una promesa
que vence hoy se actualiza mañana a esa hora: puede haber hasta un día de demora.

### Anular en vez de dejar vencer

Si el deudor avisa que no va a poder, **anulá la promesa**. Devuelve el caso a su situación anterior —
pero solo si esa promesa había cambiado la situación, el caso sigue en promesa vigente, y el estado
anterior sigue existiendo. Si algo de eso no se cumple, el caso se queda donde está.

---

## Pagos

### De dónde vienen

| Origen | Cómo llegó |
|---|---|
| **Manual** | Lo cargó un gestor desde la ficha |
| **Bajada pagos** | Vino en el archivo del cedente |
| **Actualización** | Lo generó una reconciliación |
| **Cuota de convenio** | Se registró sobre una cuota |

> ### ⚠ Solo se borran los pagos cargados a mano
>
> Los que entraron por una importación **no se pueden eliminar**: el botón aparece deshabilitado. Y los
> de **cuota de convenio** tampoco, aunque no vengan de un archivo.
>
> Si un pago entró mal por cualquiera de esas vías, no hay forma de arreglarlo desde la aplicación: hay
> que escalarlo.
>
> (También hace falta el permiso **Eliminar pagos manuales** para que la columna de borrar siquiera
> aparezca.)

### Cargar un pago a mano

Importe, fecha y una observación. **Poné el número de comprobante en la observación**: sirve para
cruzar contra el extracto del cedente.

### Qué pasa después

El saldo se recalcula **en el momento**, antes de que la pantalla responda. No hay demora.

Cuando el saldo llega a cero —o queda dentro del **1% del monto original**, que es la tolerancia por
defecto— el caso **se cancela** y la ficha se bloquea. Un caso de $1.000.000 se cancela a los $990.000.

> **El importe original no baja.** Baja el saldo.

### El pago que cargaste y después viene en el archivo

Si cargaste un pago a mano y el cedente lo manda después en su archivo, la importación **no crea uno
nuevo**: toma el tuyo y lo marca **Confirmado** — vas a ver el chip en la solapa Pagos.

> ### ⚠ El cruce es solo por importe, y puede equivocarse
>
> Matchea **el importe exacto, sin mirar la fecha**, y toma el pago manual sin confirmar **más
> antiguo**.
>
> Si cargaste $5.000 a mano en marzo y el cedente informa **otro** pago de $5.000 en agosto, la
> importación consume el de marzo y **el de agosto no se registra**. La cobranza queda $5.000 corta y
> nada lo señala.
>
> Y como compara al centavo, $1.000,00 contra $1.000,01 **no** matchea: ahí se duplica.
>
> Después de una importación de pagos, contrastá los chips **Confirmado** contra el extracto.

---

## Qué puede salir mal

### Cargué la promesa y el estado no cambió

El caso ya tenía algún pago registrado. Es el comportamiento esperado.

### La promesa venció hace un día y sigue vigente

El proceso corre a las 2 de la mañana. Puede haber hasta un día de demora.

### La promesa quedó cumplida con un pago mínimo

Cualquier pago la cierra. No se puede corregir.

### Cargué una promesa y desapareció la anterior

Solo puede haber una vigente por caso: la nueva anula la anterior.

### No encuentro una promesa que anulé

Las anuladas no se listan en la ficha. Están en los reportes y en la auditoría.

### No me deja cargar un pago

La cuenta está cancelada, o falta el permiso **Cargar pagos manuales**.

### No puedo borrar un pago

Solo se borran los manuales. Si el botón está deshabilitado, vino de una importación o de un convenio.
Si la columna no aparece, falta el permiso **Eliminar pagos manuales**.

### Cargué un pago y el caso quedó cancelado y bloqueado

El saldo llegó a cero, o quedó dentro de la tolerancia del 1%. Si el pago estaba mal, hay que
escalarlo.

---

## Preguntas frecuentes

**¿Cargar una promesa baja el saldo?**
No. Solo el pago.

**¿Puedo marcar una promesa como incumplida a mano?**
No. Los estados los mueve el sistema: cualquier pago la cumple, el vencimiento la incumple.

**¿Puedo cargar una promesa para dentro de un mes?**
Depende de la empresa. Por defecto el máximo son 7 días.

**¿Un pago de convenio se carga acá?**
No: se registra desde la solapa de Convenios, sobre la cuota.

**¿Se puede cancelar un caso a mano?**
Se puede, pero **no lo hagas**: no tiene vuelta atrás desde la ficha. Ver la advertencia del principio.
