<!--
seccion: Telefonía y Email
resumen: Mandarle un mail al deudor desde su ficha, con plantilla y adjuntos.
revisado: 2026-08-21
rutas: /gestion
-->
# Enviar un email

## Para qué sirve

Mandarle un mail al deudor **desde su ficha**, con una plantilla ya armada y sus datos completados
solos. Sirve para el resumen de lo hablado, el comprobante de un convenio o una intimación.

El envío real lo hace **AMSA Sender**. Desde acá se arma y se dispara; queda registrado en la solapa
Timeline.

## Antes de empezar

- El permiso **Enviar emails a deudores**. Es lo único que hace falta para que aparezca el botón.
- Que el deudor tenga **al menos un mail** cargado en Contactos.
- Que la empresa tenga **una cuenta SMTP asignada**. Si no la tiene, el botón aparece igual y el error
  salta recién al abrir el asistente. Se configura en [Empresas](/ayuda/ajustes/empresas), y ese campo
  solo lo ve quien tenga el permiso de administrar cuentas SMTP.

---

## Dónde está

En la ficha, en el **panel de Contactos de la columna derecha** — no es una solapa. Cada dirección de
mail tiene un ícono de enviar al lado del de copiar.

También está durante una llamada: la pantalla de telefonía muestra la misma ficha.

Se abre un asistente de **cuatro pasos**.

---

## Paso 1 — Elegir la plantilla

La lista trae las plantillas de la cuenta SMTP de esa empresa **más las que no tienen cuenta
asignada**, que son compartidas por todas las carteras.

Cada una tiene una **lupa de vista previa**. Elegir una plantilla te lleva solo al paso 2, sin apretar
Siguiente.

La lupa es solo para mirar: no cambia la plantilla elegida. Si la que estás espiando te sirve más,
tiene un botón **Usar esta plantilla** que sí la cambia.

Las plantillas se crean en AMSA Sender, no acá.

## Paso 2 — Las variables

La plantilla trae huecos —`{{nombre}}`, `{{monto_total}}`— y el sistema los completa con los datos del
caso. Se resuelven solos el nombre, el apellido, el documento, la empresa, la remesa, el monto, el
vencimiento, los días de mora, la situación, la gestión, el motivo de no pago, y cualquier dato
adicional cuyo nombre coincida.

Los checks no son todos iguales: **verde** es un mapeo guardado, **gris** es resuelto automáticamente.
Debajo de cada uno dice de dónde salió el valor.

> ### ⚠ Mapear una variable la guarda para todos
>
> Cuando elegís "Mapear desde…", **se guarda en el momento y queda pegada a la plantilla**, no a este
> envío. El próximo que use esa plantilla, en cualquier cartera, arranca con tu mapeo.
>
> Un mapeo mal hecho no arruina un mail: arruina todos los que vengan.

### Los tres importes son distintos

| Variable | Qué manda |
|---|---|
| `{{monto_total}}` · `{{deuda}}` | La **deuda original** asignada |
| `{{saldo}}` | Lo que **falta cobrar**, ya descontados los pagos |
| `{{deuda_actualizada}}` | El monto **con el recargo por mora** |

Elegí la que corresponda a lo que le estás diciendo a la persona. Reclamarle el total a alguien que
pagó la mitad es la forma más rápida de perder un acuerdo que ya estaba cerrado.

> **`{{deuda_actualizada}}` sale del último recálculo de mora.** Si hace días que nadie recalcula esa
> cartera, el número es el de esa corrida. Y en una cartera sin régimen de recargos queda vacía. Ver
> [Recargo por mora](/ayuda/ajustes/recargo-por-mora).

## Paso 3 — Destino y adjuntos

**Destinatarios.** Viene cargada **solo la dirección que clickeaste**. Los demás mails del deudor
aparecen abajo como chips grises —con la etiqueta *(principal)* en el que corresponda— y hay que
tocarlos para sumarlos.

Se pueden agregar otros a mano: se valida que sea un mail bien formado, **no** que sea el de esa
persona.

Si ponés varios destinatarios, **sale un mail separado para cada uno**: ninguno ve a quién más se le
mandó.

**Asunto.** Sale de la plantilla, todavía con los `{{huecos}}` a la vista; en el paso 4 lo ves
completado.

Se puede editar, y lo que escribas es lo que sale. Si dejás variables entre llaves, se completan igual
que en el cuerpo.

**Adjuntos.** Hasta **10 archivos**, de **10 MB cada uno** y **20 MB en total**. Si te pasás de
cualquiera de los tres, avisa.

## Paso 4 — Previsualizar y enviar

Se ve el **contenido** como va a salir: destinatarios, asunto ya completado, cuerpo y adjuntos.

> **Si quedó alguna variable sin valor, hay un cartel amarillo arriba** que las lista. **Leelo**: una
> variable vacía no sale con el `{{hueco}}` a la vista — sale **en blanco**, y un espacio donde iba el
> nombre o el importe se lee como un error de redacción y es mucho más difícil de notar.
>
> Nada te impide mandarlo igual.

Lo que la vista previa **no** muestra es lo que AMSA Sender le agrega a todo mail: un enlace *"Ver en
mi navegador"* arriba, y abajo un *"Desuscribite"* con el pie legal de Ana Maya S.A. Eso va siempre,
aunque sea una intimación de a un caso.

---

## Antes de mandar, tres cosas

**El nombre.** Si viene de un campo mal mapeado, el mail arranca saludando a otra persona.

**Los importes.** Siempre son el monto original: ver el aviso del paso 2.

**El destinatario.** Sobre todo si lo agregaste a mano: mandarle la deuda de alguien a la dirección
equivocada es un problema de datos personales, no un error de tipeo.

---

## Después de mandar

**El envío es inmediato.** Cuando el diálogo se cierra, el mail ya salió y ya figura en la solapa
**Timeline** con su estado. Lo que puede tardar horas —o no llegar nunca— son la **apertura** y el
**clic**, que aparecen como renglones aparte. Ver
[La línea de tiempo](/ayuda/telefonia-y-email/linea-de-tiempo).

Cada envío queda además registrado en **Auditoría**, con los destinatarios y los adjuntos.

**Dejá el comentario igual.** El mail queda en Timeline, pero **la solapa de comentarios es donde se
lee la historia del caso**. Un renglón —"le mandé el detalle por mail"— le ahorra el cruce al que
venga después.

---

## Qué puede salir mal

### No veo el ícono de enviar mail

Falta el permiso **Enviar emails a deudores**, o el deudor no tiene ninguna dirección cargada. **No**
depende de la cuenta SMTP: con eso mal configurado el ícono aparece igual.

### "La empresa X no tiene cuenta SMTP asignada"

Un aviso naranja al abrir el asistente. Se resuelve en Ajustes → Empresas.

### "No hay plantillas disponibles para esta empresa"

Distinto del anterior: la cuenta SMTP existe pero no tiene plantillas. Eso se resuelve en AMSA Sender.

### No me deja avanzar de paso

Cada paso pide lo suyo: una plantilla elegida, que la vista previa se haya armado, y al menos un
destinatario.

### Agregué adjuntos y no están todos

Pasaste de diez archivos, o de 20 MB sumados. El aviso dice cuántos quedaron afuera.

### Salió un dato en blanco

Una variable quedó sin valor. El cartel amarillo del paso 4 las lista antes de mandar; no hay forma de
corregir un mail ya enviado.

### "No se envió a tal dirección: se dio de baja de los envíos"

Esa persona apretó "Desuscribite" en algún mail. No hay forma de forzarlo desde acá: si es urgente, usá
otro canal.

### El mail no aparece en Timeline

Timeline cruza por **documento**. Si el caso no tiene documento cargado, no va a encontrarlo aunque el
mail haya salido.

### Rebotó

La dirección no existe o rechaza. **No hay forma de marcarla como inválida**: la única acción sobre un
mail es borrarlo del caso, con la X del chip. Si rebota siempre, borralo y dejá un comentario diciendo
por qué, o el próximo lo vuelve a cargar.

---

## Preguntas frecuentes

**¿Puedo mandar el mismo mail a muchos deudores?**
Desde acá no: es de a un caso. Los envíos masivos se hacen desde AMSA Sender.

**¿Puedo escribir un mail libre, sin plantilla?**
No. Siempre parte de una plantilla.

**¿Se puede cancelar un envío?**
No. Una vez que se aprieta Enviar, sale.

**¿Le puedo mandar a alguien que se dio de baja?**
No: el sistema no se lo manda. Si alguno de los destinatarios apretó "Desuscribite" alguna vez, ese
queda afuera y te avisa por pantalla; a los demás les llega normalmente. En el Timeline del caso queda
el renglón, con estado *Desuscripto*.

**¿Se puede mandar un mail en una cuenta cancelada?**
Sí. El bloqueo de las cuentas canceladas no alcanza al envío de mails.

**¿Desde qué dirección le llega al deudor?**
De la cuenta SMTP de la empresa. Por eso conviene que cada cartera tenga la suya.
