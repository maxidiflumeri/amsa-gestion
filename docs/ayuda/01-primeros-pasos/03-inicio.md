<!--
seccion: Primeros pasos
resumen: Qué muestra Inicio, quién ve cada bloque y de dónde sale cada número.
revisado: 2026-10-16
rutas: /
rutaPrincipal: /
-->
# Inicio

## Para qué sirve

Inicio es la primera pantalla que ves al entrar. Junta en un solo lugar **lo que hiciste hoy** y **lo que
tenés pendiente**, para que no tengas que ir a buscarlo: tus últimos casos, tus gestiones del día y, si
cargás promesas o convenios, tu agenda.

Todo lo que ves es **tuyo**: tus gestiones, tus promesas, tus reportes. Inicio no muestra lo que hizo el
resto del equipo (con una excepción: la actividad reciente, ver más abajo).

## Lo de arriba

- **El saludo**, con la fecha y una línea de estado. Si ya registraste gestiones dice "Llevás N
  gestiones hoy"; si no, "Todavía no registraste gestiones hoy". Si tenés promesas que vencen hoy, suma
  "N promesas tuyas vencen hoy".
- **Los accesos rápidos**, hasta cuatro botones según tus permisos: Gestión, Nueva importación (o
  Historial de importaciones, si no podés importar), Reportes y Tableros.
- **El buscador de casos**, a todo el ancho. Se abre con un clic o con **Ctrl+K** (ver "Buscar con Ctrl+K",
  más abajo).

## Los bloques, y quién los ve

Cada bloque depende de **tus permisos**, no del nombre de tu rol. Si no tenés el permiso, el bloque
directamente no aparece. Los bloques que sí aparecen se acomodan solos, sin dejar huecos.

| Bloque | Qué muestra | Lo ves si tenés |
|---|---|---|
| **Tu día** | Cuatro indicadores (ver abajo) | Ver comentarios o Crear comentarios |
| **Tus gestiones, últimos 14 días** | Un gráfico de barras, una por día, y el total de la semana | Ver comentarios o Crear comentarios |
| **Retomá donde quedaste** | Los últimos 8 casos donde registraste una gestión en los últimos 30 días | Ver comentarios **y** Ver deudores |
| **Tu agenda** | Tus promesas y las cuotas de los convenios que armaste | Ver promesas de pago, o Crear convenios junto con Ver convenios |
| **Importaciones** | Tus cargas en curso y las que terminaron hoy | Ver historial de importaciones, **y solo si hay alguna** |
| **Actividad reciente** | Los últimos 6 eventos de gestión de la auditoría | Ver auditoría |
| **Tus reportes** | Tus últimas 5 ejecuciones de los últimos 7 días | Ver reportes |

> Si falta alguno de estos bloques y creías que te correspondía, es una cuestión de permisos: se
> resuelve con quien administre los roles (ver [Roles y permisos](/ayuda/administracion/roles-y-permisos)).

### Tu día

Los dos primeros indicadores son siempre los mismos:

- **Gestiones hoy**: cuántas gestiones registraste hoy, con una línea de los últimos 7 días y la
  comparación "a esta hora" (ver abajo).
- **Casos trabajados hoy**: en cuántos casos distintos, contra "Ayer a esta hora".

Los otros dos dependen de si tenés el permiso **Ver promesas de pago**:

- **Con** el permiso: **Promesas tomadas** (las de los últimos 7 días, con el porcentaje que se cumplió
  de las que vencieron en los últimos 30) y **Vencen hoy** (cuántas y por cuánta plata, con un botón
  "Ver" que te lleva a la agenda de hoy).
- **Sin** el permiso: **Gestiones de la semana** y **Casos de la semana**, desde el lunes.

### Tu agenda

Tiene tres pestañas, cada una con su cantidad:

- **Hoy**: lo que vence hoy.
- **Próximos 7 días**: promesas vigentes y cuotas pendientes de los próximos siete días.
- **Sin cumplir**: lo que venció en los últimos 7 días y no se cumplió. Si el sistema todavía no cerró
  una promesa o una cuota que ya venció, aparece acá con la marca **Sin cerrar**.

Cada lista muestra hasta 50 filas. Si hay más, al pie dice "Se muestran 50 de N". Hacer clic en una fila
abre el caso.

## De dónde sale cada número

**Una gestión es un comentario que escribiste vos en la ficha.** Solo cuentan esos. No cuentan los
comentarios que deja una acción masiva, ni los que genera el cupón de pago, aunque los haya disparado
tu usuario.

- **Casos trabajados** son los casos distintos donde registraste al menos una gestión.
- **Los días** se cuentan en horario de Argentina: una gestión de las 22:30 es de ese día, no del
  siguiente.
- **La semana** empieza el lunes.
- Si alguna vez ves un número con un **+** (por ejemplo "120+"), el sistema alcanzó el tope de
  registros que lee y el valor real puede ser mayor. Pasa solo con muchísimas gestiones en dos semanas.

Ningún número de Inicio suma importes cobrados. Los montos que ves son los de las promesas y las
cuotas, no los de los pagos.

### Qué quiere decir "a esta hora"

Comparar tus gestiones de las 10 de la mañana contra un día completo daría siempre "menos". Por eso
Inicio compara **hasta la misma hora**: toma tu promedio de gestiones hasta esta hora en los últimos 7
días en los que trabajaste (se buscan en los 13 días anteriores, y los días sin ninguna gestión no
cuentan).

- **▲ verde** si estás 5 % o más arriba, **▼ rojo** si estás 5 % o más abajo, **=** en el medio.
- Si todavía no hay días anteriores con gestiones, dice "Sin días anteriores para comparar". No es un
  error: es una cuenta nueva.

## Una promesa "Cumplida" no siempre pagó lo prometido

En la agenda, una promesa cerrada por un pago dice **Cumplida**, y no dice cuánto se pagó. El sistema
cierra una promesa como cumplida con **cualquier pago** del caso, de cualquier origen y por cualquier
importe: un pago de $1 cierra una promesa de $50.000. Inicio muestra el estado tal como lo dejó el
sistema (ver [Pagos y promesas](/ayuda/gestion/pagos-y-promesas)); si necesitás saber cuánto entró, mirá
la solapa de pagos del caso.

## Buscar con Ctrl+K

En Inicio, **Ctrl+K** (o **Cmd+K** en Mac) abre el buscador de casos sin tocar el mouse. Es la misma
búsqueda avanzada de Gestión (ver [Buscar un caso](/ayuda/gestion/buscar-un-caso)): al elegir un
resultado se abre el caso. El atajo funciona **solo en Inicio**, y solo si tenés el permiso Ver
deudores.

## Cada cuánto se actualiza

- Se actualiza solo **cada 5 minutos**, y solo mientras la pestaña está a la vista.
- Si volvés a la pestaña y lo que ves tiene más de un minuto, se actualiza al instante.
- Si una actualización falla, Inicio conserva lo último que cargó y te lo avisa con un botón para
  reintentar.
- Tus cargas en curso se mueven en vivo, sin esperar los 5 minutos.

## Qué puede salir mal

**No veo "Tu agenda".** Falta el permiso Ver promesas de pago (o Crear convenios junto con Ver convenios). Si lo tenés y la
agenda está vacía, es que no cargaste promesas ni convenios: la agenda es solo de lo que **vos** cargaste.

**Armé un convenio y sus cuotas no aparecen.** La agenda muestra solo las cuotas de convenios activos
que vencen hoy o en los próximos 7 días, y las de los últimos 7 días que quedaron sin pagar. Una cuota que vence más adelante
todavía no aparece. Si el convenio se canceló, sus cuotas ya no figuran. Y hace falta el permiso Ver convenios.

**Un bloque dice "No se pudo cargar este bloque".** Falló solo ese bloque; los demás están bien. El
botón **Reintentar** lo vuelve a pedir. Un bloque en error no es lo mismo que un bloque vacío: el vacío
tiene su propio texto.

**Mis gestiones de hoy son menos de las que hice.** Solo cuentan los comentarios escritos a mano en la
ficha. Lo que hizo una acción masiva no suma.

**Hago clic en un caso y Gestión muestra un aviso de error.** El caso ya no existe (por ejemplo, se
borró la carga que lo trajo). Elegí otro con el buscador.

**La actividad reciente muestra lo de todos.** Con el permiso Ver auditoría de todos, "Actividad
reciente" muestra la de todos los usuarios; sin él, se llama "Tu actividad reciente" y muestra solo la
tuya.
