<!--
seccion: Gestión de casos
resumen: Armar un plan de pago en cuotas, registrar los cobros y qué mirar antes de ofrecerlo.
revisado: 2026-08-20
rutas: /gestion
-->
# Convenios

## Para qué sirve

Un convenio es un **plan de pago en cuotas**: el deudor no puede pagar todo junto y se acuerda un
esquema.

A diferencia de una promesa —un compromiso suelto— el convenio genera **cuotas**, cada una con su
vencimiento y su importe.

## Antes de ofrecerlo

**Mirá la política.** Dice qué formas de pago y qué tipo de atención autoriza el cedente, además de la
metodología acordada. Está en la solapa **Política** de la pantalla de Gestión — arriba de todo, al
lado de "Datos del deudor", no adentro de la ficha.

El sistema **no te impide** ofrecer condiciones que la política no contempla.

**Mirá Otras Cuentas.** Si la persona tiene otros casos, un convenio sobre uno de tres puede no ser la
mejor salida.

---

## Los dos tipos

| Tipo | Cómo arma las cuotas |
|---|---|
| **Automático** | Todas iguales: divide el total por la cantidad. Vencen **cada 30 días** |
| **Libre** | Cargás vencimiento e importe de cada cuota a mano |

### Automático

Se completa: **tipo, monto total, cantidad de cuotas, fecha del primer vencimiento y observaciones**.

**El importe de la cuota no se carga: se calcula** — total dividido cantidad.

> **Los vencimientos van cada 30 días corridos, no por mes.** Doce cuotas desde el 15/01 terminan el
> 05/12, no el 15/12. El **preview de cuotas** del formulario te lo muestra antes de guardar: miralo.

> **No hay redondeo ni cuota de ajuste.** Un total de $3.000.000 en 3 cuotas da tres cuotas de
> $1.000.000; uno de $1.000.000 en 3 da tres de $333.333,33…

### Libre

Cargás cada cuota. Es el único tipo donde **la suma puede no coincidir con el total**: el sistema
verifica que la cantidad de cuotas sea la que declaraste, pero **no valida la suma**. Un convenio libre
puede quedar guardado con un total que no cierra con sus propias cuotas.

---

## Registrar el pago de una cuota

Desde la solapa **Convenios**, sobre la cuota. El importe viene precargado con el de la cuota.

> ### ⚠ Dos cosas del pago de cuota
>
> **El importe no puede ser menor al de la cuota.** Si el deudor pagó menos, el sistema no te deja
> marcarla como pagada: cargalo como un pago suelto desde la solapa Pagos. De más sí acepta, porque es
> pagar adelantado.
>
> **No se puede deshacer.** La cuota no se puede volver a pagar ni despagar. Si te equivocaste, hay
> que escalarlo.
>
> El saldo del caso **sí baja solo**: registrar el pago de una cuota dispara la consolidación, igual
> que cargar un pago suelto.

---

## El seguimiento

Las cuotas impagas pasan a **vencida** solas, en una corrida nocturna. Durante el día una cuota que
venció hoy puede seguir figurando como pendiente hasta la madrugada siguiente.

El convenio queda **activo** mientras exista, y se da de baja con **Anular convenio**.

> **En pantalla el botón dice "Anular", no "Cancelar"** — aunque el permiso se llame "Cancelar
> convenios".

> **Anular no pide confirmación** y **no se puede deshacer**: el botón ejecuta directo.

> **Pagar todas las cuotas no cierra el convenio**: queda activo para siempre. No hay estado de plan
> terminado.

---

## ⚠ Si el caso se cancela, el convenio queda trabado

Cuando el saldo llega a cero el caso se cancela y la ficha se bloquea. A partir de ahí, sobre ese
convenio **no se puede hacer nada**: ni registrar cuotas, ni anularlo.

Si el caso se cancela con cuotas pendientes, el convenio queda activo e intocable.

---

## Qué puede salir mal

### No me deja crear el convenio

La cuenta está cancelada. Si en cambio el formulario se abre y **falla al guardar**, es que falta el
permiso **Crear convenios**: la pantalla no esconde el botón, el rechazo llega al final.

### El deudor pagó pero la cuota sigue pendiente

Se cargó como pago suelto desde la solapa Pagos en vez de sobre la cuota. Ahí baja el saldo pero la
cuota queda abierta.

### Registré mal el importe de una cuota

No hay forma de corregirlo desde la aplicación: ni la cuota ni el pago se pueden deshacer. Escalalo.

### Armé el convenio con el monto equivocado

Anulalo y armá uno nuevo — siempre que el caso no esté cancelado. Dejá el motivo en las observaciones.

### El convenio dice un total que no coincide con sus cuotas

Es un convenio **libre**: el sistema no valida la suma. El encabezado muestra el promedio de las
cuotas, que puede verse plausible y estar mal.

### Una cuota venció hoy y sigue en pendiente

El pase a vencida lo hace un proceso de madrugada. Mañana va a estar.

---

## Preguntas frecuentes

**¿Puedo modificar un convenio ya creado?**
No. Se anula y se arma uno nuevo.

**¿El convenio baja el saldo al crearlo?**
No. Lo bajan los pagos de las cuotas — y ni siquiera al instante: hay que consolidar.

**¿Puedo hacer dos convenios sobre el mismo caso?**
El sistema no lo impide, pero es mala idea: **las cuotas de los dos descuentan del mismo saldo**.
Anulá el anterior primero.

**¿El monto del convenio tiene que ser la deuda?**
No hay ninguna atadura: el formulario **sugiere** un monto, pero se puede cambiar. Si el cedente
autorizó una quita, dejalo escrito en las observaciones.

**¿Dónde veo los convenios de toda una cartera?**
En un reporte: los convenios y sus cuotas están en el catálogo, y filtrar por estado "vencida" ahora
sí devuelve algo.
