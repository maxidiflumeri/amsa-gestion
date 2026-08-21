<!--
seccion: Ajustes
resumen: Cargar la tasa mensual que informa el cedente y mantener la cadena de índices al día.
revisado: 2026-08-20
rutas: /ajustes/mora
rutaPrincipal: /ajustes/mora
-->
# Recargo por mora

## Para qué sirve

Algunos cedentes actualizan la deuda por mora. Esta pantalla es donde se carga **la tasa mensual que
informan por mail**, y con eso el sistema calcula la deuda actualizada de cada caso.

Es una tarea **mensual**: llega el mail con la tasa, se carga, se recalcula, listo.

## Antes de empezar

- Tres permisos, uno por cosa: **Ver deuda actualizada** para entrar, **Cargar la tasa mensual** para
  cargarla, y **Recalcular la cartera** para aplicarla a los casos.
- El mail del cedente con la tasa del mes.

---

## ⚠ Las tasas son por cartera, no por cedente

La pantalla arranca con un selector de empresa, y **todo lo que hagas debajo es de esa empresa**: la
tasa, el índice y el recálculo.

Si un cedente tiene varias carteras en el sistema, **hay que cargar la tasa una vez en cada una**.
Cargarla en una sola y dar por hecho que las otras quedaron al día es el error operativo más probable
de esta pantalla, y no da ningún aviso.

---

## Cargar la tasa del mes

Botón **Cargar tasa del mes**. Se elige el período y se escribe **un solo número**. Hay también un
campo de **observación**: el lugar para dejar anotado de qué mail salió.

> ### ⚠ La tasa va tal como la informa el cedente
>
> Si el mail dice 2,169%, se carga **`2.169`**. Sin dividir por 100 y sin multiplicar por nada.
>
> Los tres tipos de tasa —la base, la de 1,5× y la de 2×— **los deriva el sistema**. En el sistema
> anterior el operador hacía esas multiplicaciones a mano y se equivocó seis veces en tres años.

Si escribís un número menor a 0,5 la pantalla te pregunta *"La tasa parece muy baja"*: es el error
clásico de cargarla ya dividida.

Cargar la tasa genera el índice de **todo el mes de una vez**, incluidos los días que todavía no
pasaron. Así que apenas cargada ya se puede recalcular cualquier día de ese mes.

---

## ⚠ La cadena es acumulativa

Esto es lo más importante de la página.

El índice de cada día se construye **sobre el del día anterior**, encadenado desde 2001. Dos
consecuencias:

**No se puede saltear un mes.** El sistema verifica que exista el índice del **último día del mes
anterior**; si falta, no te deja generar y te dice *"La cadena es acumulativa y no se puede reiniciar:
generá primero los meses anteriores"*. Por eso cargar un mes futuro salteado también falla.

**Recargar un mes obliga a regenerar los siguientes.** Si corregís la tasa de marzo, abril en adelante
quedan mal, y el sistema los regenera solo.

> Esa validación no es defensiva de más: en el sistema del cedente, arrancar la cadena de cero a mitad
> de la serie dejó **todas las deudas actualizadas en negativo durante tres meses**, sin que nadie lo
> notara.

### Antes de recargar un mes viejo, leé esto

La pantalla te dice **cuántos meses posteriores va a regenerar** antes de hacer nada, sea el mes que
sea. Confirmá recién cuando el número tenga sentido: si esperabas tocar dos meses y te avisa de
doscientos, cancelá.

Y hay una segunda pregunta que puede aparecer, más seria: **si alguno de los meses a regenerar tiene
el índice migrado del cedente**, el sistema te lo dice por nombre y te pide una confirmación aparte.

Vale la pena entender por qué. El índice migrado es **el dato tal como lo informó el cedente**;
regenerarlo lo reemplaza por una reconstrucción a partir de una única tasa mensual, y eso es menos
fiel, porque hubo meses con más de una tasa vigente. **No es una corrección: es una degradación.**
Salvo que sepas que la tasa cargada está mal, cancelá.

Un detalle menor: si algún mes posterior tiene índice pero nunca tuvo tasa cargada, ese mes no se
regenera y queda desactualizado. Queda en el registro técnico, no en pantalla.

---

## El aviso de meses faltantes

Arriba de la tabla aparece un aviso cuando falta el índice de algún mes.

**No lo ignores**, pero entendé bien qué rompe: el cálculo mira **dos fechas**, el índice del día de
vencimiento de la factura y el del día del cálculo. Un hueco en el medio del período de mora **no
cambia el número**.

Lo que sí se rompe:

- **Toda factura cuyo vencimiento caiga en un mes faltante** queda **sin recargo**, marcada *sin
  índice* en el desglose.
- **Si falta el índice de hoy**, el recálculo directamente no arranca.

Ojo con un detalle: el aviso solo detecta huecos **a partir del mes más viejo que ya tenés cargado**.
Si la cartera tiene facturas más viejas que el arranque de tu índice, esos años no se reportan como
faltantes — y son justamente las facturas que van a salir sin recargo.

---

## La tabla

Una fila por mes, con la tasa informada, las dos derivadas (tipo 2 ×1,5 y tipo 3 ×2), la fuente y los
días de índice generados.

**La fuente** dice de dónde salió el dato: *mail del cedente*, *migrada del CRM viejo*, *calibrada* o
*sin tasa*. **No valen lo mismo** — las migradas pueden arrastrar errores de tipeo del operador
anterior.

Un detalle a tener en cuenta: **todo lo que cargues desde esta pantalla queda como "mail del
cedente"**, aunque estés corrigiendo un mes migrado. La pantalla no deja elegir la fuente.

**Los días de índice** muestran un chip naranja **"N incompleto"** cuando falta generar algún día del
mes.

> **La tabla muestra solo los últimos 24 meses** y no hay forma de ver más desde la pantalla. En una
> cartera con años de historia, lo que ves es la punta.

---

## Recalcular la cartera

El botón **Recalcular cartera** revalúa todos los casos de la empresa a la fecha de hoy y **guarda el
resultado**. Eso es lo que hace que la deuda actualizada aparezca en la ficha y, sobre todo, lo que la
hace **exportable en reportes**.

Primero muestra cuántos casos se van a tocar y cuántas facturas quedarían sin índice, y ahí confirmás.

> Los dos números que vas a ver no coinciden, y está bien: el del preview cuenta **todos los casos de
> la cartera**, y el del resultado final solo los que **efectivamente devengaron recargo**. El segundo
> siempre es más chico.

**Cuándo hace falta:**

- Después de cargar la tasa de un mes nuevo.
- Después de corregir una tasa vieja.
- Cuando la fecha de cálculo de las fichas está en naranja — o sea, cuando pasaron **48 horas o más**
  desde el último recálculo.

**No hay ningún proceso que lo haga solo.** Si nadie aprieta el botón, el número se queda viejo y la
fecha queda en naranja indefinidamente.

---

## La rutina mensual

1. Llega el mail con la tasa.
2. **Cargar tasa del mes**, el número tal cual, en **cada cartera** de ese cedente.
3. Verificar que el aviso de meses faltantes esté vacío.
4. **Recalcular cartera**.

---

## Qué puede salir mal

### En una cartera nueva me pregunta si quiero iniciar la cadena

Es correcto y hay que confirmarlo: en una cartera sin ningún índice, el mes que cargues es **el punto
de partida de la serie**.

Lo importante es **elegir bien ese mes**, porque las facturas que hayan vencido antes van a quedar sin
recargo y no hay forma de calcularlas después. Si la cartera trae deuda de hace tres años, arrancá por
el mes más viejo que necesites, no por el actual.

### No me deja generar el índice del mes

Falta el índice del último día del mes anterior. La cadena no se puede saltear: cargá primero los meses
que faltan, en orden.

### Me avisó que va a regenerar varios meses

Es correcto: estás recargando un mes que ya tenía índice, y los posteriores dependen de él. Si el mes
es viejo, leé la advertencia de más arriba antes de confirmar.

### "No hay índice para el {fecha}. Cargá la tasa del mes antes de recalcular."

Estás recalculando en un mes cuya tasa todavía no cargaste. Aparece apenas apretás el botón, antes de
la confirmación.

### La deuda actualizada de las fichas no cambió

Falta **recalcular la cartera**. Cargar la tasa genera el índice; recalcular lo aplica y lo guarda.

### El desglose no coincide con el número grande de la ficha

El encabezado muestra **el valor del último recálculo**; el desglose **recalcula al día de hoy**. Si
hace días que nadie recalcula, los dos números difieren. Se emparejan recalculando.

### Los números no coinciden con los del cedente

Si la diferencia es chica y constante, puede ser una tasa vieja mal cargada en su sistema o en el
nuestro. Se detecta comparando un caso concreto contra el estado de deuda que emite el cedente.

### El aviso de meses faltantes no se va

Cargá las tasas de esos meses. Si son viejos y no tenés el mail, pedíselos al cedente: sin ellos, toda
factura que venza en esos meses va sin recargo.

---

## Preguntas frecuentes

**¿Cada cuánto hay que cargar la tasa?**
Una vez por mes, cuando llega el mail, y en cada cartera de ese cedente.

**¿Qué pasa si me olvido un mes?**
Las facturas que vencen en ese mes quedan sin recargo. El aviso de la pantalla está para eso.

**¿Puedo corregir una tasa mal cargada?**
Sí: se vuelve a cargar el mes y el sistema regenera los posteriores, avisándote cuántos son. Si alguno
tiene índice migrado del cedente, te lo pregunta aparte.

**¿Y si el cedente corrige la tasa a mitad de mes?**
Hay que recargarla. El índice del mes se genera completo de una vez, así que no se ajusta solo.

**¿Todas las empresas necesitan esto?**
No, solo las que tengan régimen de recargos. Y sin recalcular, la deuda actualizada no se muestra
aunque las tasas estén cargadas.

**¿Para qué sirven las tasas derivadas de 1,5× y 2×?**
No lo sabemos con certeza. El cedente las mantiene y nosotros las replicamos; la hipótesis es que las
usa para proyectar planes de pago. **La deuda actualizada no las usa: usa la tasa base.**

**¿Puedo llevar la deuda actualizada a un reporte?**
Sí — el recargo, la deuda actualizada y la fecha de cálculo están en el catálogo de reportes. Salen del
último recálculo, así que recalculá antes de exportar. Ver
[Armar un reporte](/ayuda/reportes/armar-un-reporte).

---

Ver también: [La ficha del caso](/ayuda/gestion/la-ficha) y
[Poner una cartera nueva de cero](/ayuda/ajustes/cartera-nueva-de-cero).
