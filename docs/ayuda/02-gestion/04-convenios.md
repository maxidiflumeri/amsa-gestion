<!--
seccion: Gestión de casos
resumen: Armar un plan de pago en cuotas, registrar los cobros y qué mirar antes de ofrecerlo.
revisado: 2026-08-20
rutas: /gestion
-->
# Convenios

## Para qué sirve

Un convenio es un **plan de pago en cuotas**: el deudor no puede pagar todo junto, y se acuerda un
esquema.

A diferencia de una promesa —que es un compromiso suelto— el convenio genera **cuotas**, cada una con
su vencimiento y su importe, y se le hace seguimiento una por una.

## Antes de ofrecerlo: mirá la política

**La política de la remesa dice qué podés ofrecer**: las formas de pago y el tipo de atención que el
cedente autoriza. Está en su propia solapa de la ficha.

No todos los cedentes aceptan las mismas condiciones. Ofrecer un plan que la política no contempla es
un problema con el cliente, no con el sistema — y el sistema no te lo va a impedir.

## Antes de ofrecerlo: mirá Otras Cuentas

Si la persona tiene otros casos, conviene saberlo. Un convenio sobre una de tres deudas puede no ser la
mejor salida.

---

## Armar un convenio

Desde la solapa **Convenios**. Se define:

- **El tipo** de convenio.
- **El monto total** del plan.
- **La cantidad de cuotas** y el **importe de cada una**.
- **La fecha de inicio**, que determina los vencimientos.
- **Observaciones**, para dejar asentado lo que se acordó.

Al guardarlo se generan las cuotas, cada una con su número, su vencimiento y su importe.

Requiere el permiso **Crear convenios**.

> **El monto del convenio puede no coincidir con la deuda.** Si el cedente autorizó una quita, el plan
> va a ser menor. El sistema no lo valida: dejalo escrito en las observaciones.

---

## Registrar el pago de una cuota

Desde la misma solapa, sobre la cuota que corresponde. La cuota queda pagada con su fecha.

**Un pago de cuota también es un pago del caso**: baja el saldo igual que cualquier otro. Por eso no
hay que cargarlo dos veces — registrar la cuota alcanza.

Requiere el permiso **Registrar pagos de convenios**.

---

## Estados

**El convenio** está activo mientras se está cumpliendo, y se puede **cancelar** — cuando el deudor
dejó de pagar, o cuando se rearma el plan.

**Las cuotas** están pendientes hasta que se registra su pago.

Cancelar un convenio requiere el permiso **Cancelar convenios**.

---

## Qué mirar durante el seguimiento

**Las cuotas vencidas e impagas.** Son la señal de que el plan se está cayendo, y el momento de llamar.

**Si el saldo llegó a cero.** Cuando se pagan todas las cuotas, el caso se cancela y la ficha se
bloquea. Es lo esperado, pero conviene saberlo: después de eso ya no vas a poder agregar un comentario.

---

## Qué puede salir mal

### No me deja crear el convenio

La cuenta está **cancelada** —y entonces la ficha está bloqueada— o falta el permiso **Crear
convenios**.

### El deudor pagó pero la cuota sigue pendiente

El pago se registra sobre la cuota, en la solapa de Convenios. Si se cargó como pago suelto desde la
solapa Pagos, baja el saldo pero la cuota queda abierta.

### Armé el convenio con el monto equivocado

Cancelalo y armá uno nuevo. Dejá en las observaciones por qué, para que quede el rastro.

### El caso se canceló antes de terminar el plan

El saldo llegó a cero, probablemente porque entró un pago por otro lado además de las cuotas.

### La suma de las cuotas no da el total

El sistema no lo valida. Revisá la cuenta antes de guardar: cantidad por importe tiene que dar el
total, salvo que la última cuota ajuste.

---

## Preguntas frecuentes

**¿Puedo modificar un convenio ya creado?**
No. Se cancela y se arma uno nuevo.

**¿El convenio baja el saldo al crearlo?**
No. Lo bajan los pagos de las cuotas, a medida que entran.

**¿Puedo hacer dos convenios sobre el mismo caso?**
El sistema no lo impide, pero es mala idea: no se sabe qué cuota corresponde a qué plan. Cancelá el
anterior primero.

**¿Qué pasa si el deudor deja de pagar a la mitad?**
Cancelás el convenio. Los pagos que ya hizo quedan registrados y el saldo refleja lo que falta.

**¿Dónde veo los convenios de toda una cartera?**
En un reporte: los convenios y sus cuotas están en el catálogo de campos.
