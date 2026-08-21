<!--
seccion: Telefonía y Email
resumen: Qué se le mandó al deudor y qué hizo con eso.
revisado: 2026-08-21
rutas: /gestion
-->
# La línea de tiempo

## Para qué sirve

**Timeline** muestra **lo que se le mandó al deudor** desde AMSA Sender —mails y WhatsApp— con el
estado de cada envío.

Sirve para dos cosas concretas: saber **si le llegó** antes de volver a insistir, y saber **si lo
abrió**, que es la diferencia entre alguien que ignora y alguien que nunca se enteró.

## Dónde está

Es una de las **solapas de arriba de todo en Gestión**, al lado de *Datos del deudor* — **no** es una
solapa de adentro de la ficha. Muestra el caso que tengas seleccionado. Ver
[La ficha del caso](/ayuda/gestion/la-ficha).

Durante una llamada **no está disponible**: la pantalla de telefonía muestra solo la ficha.

## Antes de empezar

Alcanza con el permiso de **ver deudores**: es el mismo que protege el resto de la ficha.

---

## ⚠ Qué muestra y qué no

Esto es lo que más confunde: **Timeline no es la historia del caso**. Muestra **solo los envíos
salientes** hechos desde AMSA Sender.

**No están acá**: los comentarios, los pagos, las promesas, los convenios, los cambios de estado ni las
llamadas.

| Lo que buscás | Dónde está |
|---|---|
| Qué se le mandó y si le llegó | **Timeline** |
| Qué se habló, qué dijo | Comentarios |
| Qué pagó | Pagos |
| Quién cambió un estado | Auditoría |
| Las llamadas | En Neotel |

No hay una vista única con todo. Es una limitación real del sistema, no algo que estés buscando mal.

---

## Los filtros

- **Canal** — Todos, Email, **WhatsApp Web** o **WhatsApp Meta**. Los dos WhatsApp son sistemas
  distintos: filtrar por uno esconde el otro.
- **Desde / Hasta** — el rango.
- **Por página** — 5, 10, 20 o 50. **Viene en 5**, que es poco: si parece que hay poco historial,
  subilo antes de sacar conclusiones.

Lo más nuevo va arriba.

> ### ⚠ "Hasta" excluye el día que ponés
>
> La fecha de corte se toma a las cero horas, así que poner *Hasta = hoy* devuelve todo **menos lo de
> hoy**. Es la causa número uno de "mandé un mail y no aparece". Poné el día siguiente, o dejá el campo
> vacío.

No hay botón de refrescar: se recarga al tocar un filtro, o saliendo y volviendo a la solapa.

---

## Los estados

| Lo que ves | Qué significa |
|---|---|
| **enviado** | Salió del servidor. Es lo máximo que informa el sistema: **no distingue "salió" de "llegó"** |
| **pendiente** | Se creó el envío y todavía no salió |
| **rebote** | No se pudo entregar: la dirección no existe o rechaza |
| **fallo** | Falló el envío |
| **queja** | El destinatario lo marcó como spam |
| **omitido** / **Desuscripto** | No se mandó porque el destinatario está dado de baja (solo en campañas) |
| Renglón **"Email · Open"** | Lo abrió |
| Renglón **"Email · Click"** | Tocó un enlace |

> **La apertura y el clic no cambian el estado del envío**: entran como **renglones propios**, más
> arriba en la lista. Un mail abierto sigue diciendo *enviado*.

> ### ⚠ Los estados malos no se ven en rojo
>
> Hoy **rebote, fallo, queja y desuscripto salen en gris**, iguales a cualquier otro. No confíes en el
> color: leé el texto del chip. El **rebote** es el dato accionable de esta solapa y es el que más
> fácil se pasa por alto.

Y una advertencia sobre "abierto": se detecta con una imagen invisible que muchos clientes de correo
bloquean. Un mail leído puede figurar solo como *enviado*, así que **la ausencia de "Open" no prueba**
que no lo haya visto. Al revés sí vale: si aparece, lo abrió.

---

## ⚠ El cruce es por documento, y trae de menos

Timeline no busca por el caso: **busca por el número de documento** y lo resuelve a **un solo
registro** del sistema de envíos, el último cargado.

Tres consecuencias:

- **Un caso sin documento cargado no muestra nada**, aunque se le hayan mandado mails.
- **Aparecen envíos que nadie de tu equipo hizo**: campañas masivas mandadas a esa persona desde
  Sender.
- **Si esa persona figura en más de una cartera del sistema de envíos, solo ves la última.** El
  historial de las otras queda invisible.

Por eso: **que Timeline esté vacío no prueba que no se le haya mandado nada.**

---

## Qué puede salir mal

### "No se encontró historial en AMSA Sender para este deudor"

Tres causas: nunca se le mandó nada, **el caso no tiene documento cargado**, o el documento está
cargado distinto del que figura en el sistema de envíos.

### "Sin gestiones registradas con los filtros aplicados"

Distinto del anterior: **sí hay historial**, pero tus filtros lo tapan. Vaciá Desde y Hasta, y poné
Canal en Todos.

### Mandé un mail hace un minuto y no aparece

Lo más probable es el filtro *Hasta*, que corta a la medianoche del día que pusiste. El envío en sí es
inmediato.

### Aparecen envíos que nadie de mi equipo hizo

Es el cruce por documento: son envíos a esa misma persona desde el sistema de envíos, quizás de una
campaña masiva.

### Veo un renglón que dice `__envios_manuales__`

Es el nombre interno de la campaña donde caen los mails mandados de a uno desde la ficha. No es un
error.

### El estado quedó en "enviado" y sé que lo leyó

La detección de apertura se bloquea en muchos clientes de correo. *Enviado* es el piso, no el techo.

### Un mail figura con rebote y la dirección parece bien

Puede ser un buzón lleno o un servidor que rechaza. Si rebota siempre, tratala como muerta.

---

## Preguntas frecuentes

**¿Los comentarios y los pagos van a aparecer acá alguna vez?**
Hoy no están. La solapa es específicamente de envíos salientes.

**¿Puedo reenviar desde acá?**
No. Se manda de nuevo desde la solapa **Datos del deudor**, en el panel de Contactos. Ver
[Enviar un email](/ayuda/telefonia-y-email/enviar-un-email).

**¿Se puede exportar?**
Desde la solapa no.

**¿Por qué no veo las llamadas?**
La telefonía es de Neotel y no pasa por el sistema de envíos. Ver
[Cómo funciona la telefonía](/ayuda/telefonia-y-email/telefonia-como-funciona).
