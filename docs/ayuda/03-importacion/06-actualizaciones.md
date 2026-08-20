<!--
seccion: Importación de datos
resumen: La categoría de mayor impacto del sistema. Qué hace cada opción, qué no protege nada y cómo correrla sin riesgo.
revisado: 2026-08-20
rutas: /carga, /plantillas
-->
# Actualizaciones

> ## ⚠ Leé esto antes de la primera vez
>
> Esta categoría puede **cancelar una cartera entera en una corrida**, y la opción que hace eso es la
> que viene **por defecto**.
>
> Si apuntás el archivo a la **remesa equivocada**, el sistema no lo detecta: da de alta todas las
> filas como casos nuevos en la cartera equivocada y **marca como "pagó todo" a todos los casos que ya
> estaban ahí**. Quedan cancelados y bloqueados.
>
> **La vista previa no te va a avisar.** No hay ningún número de "cuántos casos matchearon" para esta
> categoría. Más abajo está el procedimiento seguro, que sí funciona.

## Para qué sirve

El cedente manda **cómo quedó la cartera**: qué se cobró, qué deuda nueva hay, a quién ya no hay que
gestionar. El sistema **reconcilia** — compara lo que informa el archivo contra lo que tiene, y actúa.

Es lo que la diferencia del resto: las otras categorías cargan lo que el archivo dice. Esta **decide**.

## Dónde se configura

**Las cuatro opciones viven en la plantilla, no en la carga.** Se editan en Importación de Datos →
Plantillas → editar. En el asistente de importación no se pueden cambiar: lo único que elegís ahí es
contra qué remesa correr (la pantalla la llama **"Vincular a remesa de deudores"**).

O sea: cambiar de criterio implica editar la plantilla, no la corrida.

---

## Qué hace, en criollo

Por cada caso de la remesa vinculada, compara la deuda que tiene contra la que informa el archivo:

| Situación | Qué hace |
|---|---|
| El archivo informa **menos** deuda | Genera un **pago** por la diferencia (contra lo ya pagado) |
| El archivo informa **más** deuda | Sube la deuda, y `montoTotal` sube con ella |
| El caso **no aparece** en el archivo | Depende de la opción — ver abajo |
| El caso **no existe** todavía | Lo crea, salvo que le digas que no |

Cómo matchea: **por documento** dentro de la remesa vinculada, y para las filas que no matchearon por
ahí, prueba por **número de cliente**.

> **Una factura que no viene en el archivo se marca PAGADA.** Toda factura del caso que no aparezca
> en la carga pasa a pagada y, si tiene importe, genera un pago. Esto corre **siempre**,
> independientemente de la opción de ausentes. Si el cedente cambia la numeración de sus facturas, se
> marca pagada la cartera de facturas completa.

---

## Las cuatro opciones

### 1. "Solo actualizar datos (DNI / adicionales) — no reconciliar deuda"

Apaga la reconciliación de deuda: no genera pagos ni facturas de ajuste.

**Pero no apaga todo lo demás**, y acá hay dos sorpresas:

- **Sigue creando casos nuevos**, salvo que además tildes "No crear casos nuevos".
- **Sigue desasignando ausentes**, si esa opción está en desasignar.

> No es "el modo seguro". La combinación que desasignó 342.792 deudores de Toyota era justamente
> *solo datos + desasignar*. Lo seguro es **solo datos + no hacer nada con los ausentes**.

Con este modo, la opción "marcar como pagó todo" **no está disponible**: el sistema la oculta y
rechaza la combinación al guardar.

### 2. "Deudores ausentes del archivo"

La más importante. Un caso que estaba en la remesa vinculada y **no viene en el archivo de hoy** —
¿qué significa?

| Etiqueta exacta | Qué hace | Cuándo |
|---|---|---|
| *Marcar como pagó todo (SIT-050) — comportamiento clásico* **(por defecto)** | Facturas a pagadas, pago por lo que falta, y la consolidación lo deja **cancelado** | El archivo es la foto completa de lo que sigue vivo |
| *Desasignar (GES-094) — para archivos de gestión diaria* | Le pone estado de gestión *Desasignado*. **No toca deuda ni situación** | El archivo es la gestión **del día** |
| *No hacer nada con los ausentes* | Los ignora | El archivo es **parcial**, o es la primera corrida |

**La pregunta para decidir:** *¿este archivo es la foto completa de la cartera, o solo lo de hoy?*

> ### La asimetría que hay que conocer
>
> **Desasignar está protegido. Marcar como pagó todo, no.**
>
> Si ninguna fila del archivo matchea la cartera, *desasignar* **aborta solo** y no toca a nadie — ese
> guard se agregó después del incidente de los 342.792 deudores.
>
> *Marcar como pagó todo* **no tiene ese guard**. Con un archivo bien formado apuntado a la cartera
> equivocada, procede y cancela todo.
>
> O sea: **la opción destructiva por defecto es justamente la desprotegida.**

Un caso desasignado que reaparece en una corrida posterior **se re-asigna solo** — pero solo si la
opción sigue en *desasignar*. Con las otras dos, queda desasignado para siempre, y no hay pantalla
para revertirlo a mano.

### 3. "No crear casos nuevos — solo actualizar deudores existentes"

Por defecto, un registro que no matchea con ningún caso **se carga como caso nuevo** (en la remesa
vinculada, no en la de la actualización).

Tildando esto, los no encontrados se ignoran.

**Cuándo:** un mismo archivo cubre varias remesas y lo vas a correr una por una. Sin esto, la primera
corrida crea como casos nuevos todos los que pertenecen a las otras.

> Los casos nuevos **heredan los contactos** de cualquier caso de esa misma persona que ya exista en
> el sistema. Si se crearon duplicados por error, vienen con teléfonos y todo.

### 4. "Si el saldo informado es mayor al actual"

| Etiqueta exacta | Qué hace |
|---|---|
| *Generar una factura nueva por la diferencia* **(por defecto)** | Crea una factura de ajuste |
| *Actualizar la factura existente, sin generar nuevas* | Si el caso tiene **una sola** factura pendiente, le actualiza el importe |

**Solo aplica cuando el archivo trae un saldo total**, no cuando trae facturas con sus importes. Con
facturas reales, la deuda nueva se aplica directo y esta opción se ignora.

Y si el caso tiene **cero o más de una** factura pendiente, la segunda opción sube el saldo igual pero
**no toca ninguna factura**: las facturas dejan de sumar la deuda del caso.

---

## El procedimiento seguro

La vista previa **no alcanza** para esta categoría, por tres razones concretas:

- **No hay preview de impacto.** Ese existe solo para acciones masivas. Acá no vas a ver cuántos casos
  matchean ni cuántos ausentes hay.
- Los contadores de filas OK y con error se calculan **solo sobre las primeras 50 filas**.
- La vista previa **no corre la validación propia de la categoría**. El archivo del incidente de
  Toyota —351.943 filas que fallaban esa validación— habría mostrado un preview en verde.

**Lo que sí funciona:**

1. **Primera corrida con "No hacer nada con los ausentes".** Es la única opción que no puede hacer
   daño.
2. **Mirá el resultado**: cuántas filas entraron, cuántas fallaron, y sobre todo **cuántos casos
   nuevos se crearon**. Si se crearon muchos más de los esperados, el archivo está apuntado a la
   cartera equivocada. Frená ahí.
3. **Recién entonces**, si el archivo es la foto completa, cambiá la plantilla a la opción de ausentes
   que corresponda y volvé a correr.

Correr dos veces el mismo archivo contra la misma remesa **es seguro**: no duplica pagos ni vuelve a
desasignar. El peligro no es repetir — es apuntar mal.

---

## Qué mirar después de correr

- **Casos nuevos creados.** El indicador más confiable de que apuntaste bien o mal.
- **El detalle de errores**, fila por fila, desde el historial.
- **La auditoría**: la desasignación y la re-asignación dejan un evento por corrida con el conteo de
  casos tocados. Es el único lugar donde ver cuántos se movieron.

Un detalle para dashboards y reportes: los pagos que genera esta categoría llevan **la fecha de la
corrida**, no la que informa el cedente.

---

## Si salió mal

**No hay deshacer.** Y hay tres paredes que conviene conocer antes de necesitarlas:

- Los pagos que genera esta categoría **no se pueden borrar** desde la ficha: solo se borran los
  cargados a mano.
- Un caso cancelado **no acepta cambio de estado manual**: la ficha lo bloquea.
- Volver a correr con el archivo completo **tampoco lo deshace**: la reconciliación compara contra los
  pagos ya registrados, así que el pago falso queda absorbido y el caso sigue cancelado.
- **Borrar la remesa no sirve y encima borra la evidencia.** Como los casos nuevos van a la remesa
  vinculada, la remesa de actualizaciones suele tener cero casos propios: el sistema la deja borrar
  sin advertir nada, y se lleva puesto el detalle de errores.

**El único camino de reparación real** es una carga de **Acciones masivas** que setee la situación de
esos casos, con *saltear canceladas* **desactivado**. Tiene la ventaja de que sí se puede revertir.

---

## Qué puede salir mal

### Se cancelaron casos que no pagaron

El archivo era parcial, o estaba apuntado a la remesa equivocada, y la opción de ausentes estaba en
"marcar como pagó todo". Ver arriba el camino de reparación.

### Se crearon cientos de casos duplicados

El archivo cubría varias remesas y corriste sin tildar "No crear casos nuevos". Vienen con contactos
heredados, así que parecen casos legítimos.

### Se marcaron pagadas todas las facturas

El cedente cambió la numeración de sus facturas: las que están en el sistema ya no matchean con
ninguna del archivo, y toda factura ausente se marca pagada.

### La desasignación no hizo nada

Si el estado *Desasignado* no está cargado en los parámetros, la opción **no hace nada** y solo deja un
aviso en el log. La importación termina como finalizada, sin señal visible.

### El caso quedó desasignado para siempre

Volvió a aparecer en una corrida posterior, pero para entonces la plantilla ya no estaba en
"desasignar". La re-asignación automática solo corre con esa opción activa.

---

## Preguntas frecuentes

**¿Se puede deshacer una carga de actualizaciones?**
No. Tratala como una operación sin vuelta atrás y usá el procedimiento seguro.

**¿Los casos nuevos quedan en esta remesa?**
No: se cuelgan de la **remesa vinculada**, que es donde vive la cartera.

**¿Puedo correr el mismo archivo dos veces?**
Sí, es seguro. No duplica pagos ni re-desasigna.

**¿Un pago parcial cambia la situación del caso?**
Sí: la consolidación posterior lo deja en situación de pago parcial. Y diferencias de hasta un peso
no producen nada.
