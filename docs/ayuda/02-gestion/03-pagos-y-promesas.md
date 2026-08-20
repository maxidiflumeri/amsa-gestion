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

---

## Promesas de pago

### Para qué sirve

Dejar anotado un compromiso: cuánto y para cuándo. Sirve para dos cosas — que el sistema te recuerde
hacer el seguimiento, y que el cedente vea que el caso se está gestionando.

### Cómo se carga

Desde la ficha: la fecha prometida y, opcionalmente, el monto.

**Al cargarla, la situación del caso pasa a promesa de pago.** No hace falta cambiarla a mano.

### Los estados de una promesa

| Estado | Cuándo |
|---|---|
| **Vigente** | Recién cargada, todavía no venció |
| **Cumplida** | Se registró el pago |
| **Incumplida** | Venció y no entró la plata |
| **Anulada** | La diste de baja a mano |

### ⚠ Qué pasa cuando vence

Cuando la fecha pasa y no hubo pago, la promesa se marca **incumplida** y la situación del caso cambia.

**Eso no lo hacés vos: corre en batch.** Así que puede haber una demora entre que la promesa vence y
que el caso se actualice.

Al cargar una promesa, el sistema **guarda la situación anterior** del caso, para poder volver a ella
si la promesa se anula.

### Cuándo conviene anular en vez de dejar vencer

Si el deudor te avisa que no va a poder, **anulá la promesa** en vez de dejar que venza. Anulada
devuelve el caso a su situación anterior; incumplida deja el rastro de un compromiso roto.

Las dos cosas son legítimas — la diferencia es qué historia queda escrita.

---

## Pagos

### Para qué sirve

Registrar plata que entró. Baja el saldo y, si lo cancela, cancela el caso.

### De dónde vienen los pagos

| Origen | Cómo llegó |
|---|---|
| **Manual** | Lo cargó un gestor desde la ficha |
| **Importación de pagos** | Vino en el archivo del cedente |
| **Actualización** | Lo generó una reconciliación |
| **Convenio** | Es la cuota de un plan de pago |

La distinción importa por una razón muy concreta:

> ### ⚠ Solo se pueden borrar los pagos cargados a mano
>
> Un pago que entró por una importación **no se puede eliminar** desde la ficha. El botón aparece
> deshabilitado.
>
> Si una carga de pagos entró mal, no hay forma de arreglarlo desde la aplicación: hay que escalarlo.

### Cargar un pago a mano

Desde la solapa Pagos: importe, fecha y una observación.

**Poné el número de comprobante en la observación.** Sirve para cruzar contra el extracto del cedente,
y evita que una importación posterior lo tome como duplicado.

### Qué pasa después de cargar un pago

El saldo baja. Y cuando el saldo llega a cero —o queda dentro de un margen de tolerancia— **el caso se
cancela**, y con eso la ficha se bloquea.

Ese paso lo hace la consolidación, que corre sola después de una importación de pagos, y también se
puede disparar a mano desde el historial de importaciones.

> **El importe original no baja.** Baja el saldo. El original es la referencia contra la que se le
> rinde al cedente.

### El pago que ya cargaste y después viene en el archivo

Si cargaste un pago a mano y el cedente después lo manda en su archivo de cobranzas, la importación
**no crea uno nuevo**: reconoce el tuyo y lo marca como confirmado.

Funciona por importe, sin importar la fecha. O sea que el archivo "se consume" tu carga manual, que es
justo lo que se busca.

---

## Qué puede salir mal

### Cargué la promesa y el estado no cambió

Se cambia solo al cargarla. Si no pasó, refrescá la ficha.

### La promesa venció hace días y sigue vigente

El proceso que las marca corre en batch, no al instante.

### No me deja cargar un pago

La cuenta está cancelada, o falta el permiso **Cargar pagos manuales**.

### No puedo borrar un pago

Solo se borran los manuales. Si el botón está deshabilitado, ese pago vino de una importación.

### Cargué un pago y el caso quedó cancelado y bloqueado

Es el comportamiento esperado: el saldo llegó a cero. Si el pago estaba mal, hay que escalarlo — desde
la ficha ya no se puede tocar.

### El saldo no bajó después de cargar el pago

El saldo se recalcula con la consolidación. Si acabás de cargar el pago a mano, puede tardar.

---

## Preguntas frecuentes

**¿Cargar una promesa baja el saldo?**
No. Solo el pago.

**¿Puedo cargar una promesa sin monto?**
Sí, el monto es opcional. Pero si el deudor dijo cuánto, anotalo.

**¿Qué pasa si el deudor paga menos de lo prometido?**
Cargás el pago por lo que entró. La promesa la resolvés según el criterio del equipo: cumplida si
alcanza, incumplida si no.

**¿Un pago de un convenio se carga acá?**
No: se registra desde la solapa de Convenios, sobre la cuota que corresponde.

**¿Se puede cancelar un caso a mano, sin pago?**
No desde la ficha. La cancelación la produce el saldo en cero, o una acción masiva.
