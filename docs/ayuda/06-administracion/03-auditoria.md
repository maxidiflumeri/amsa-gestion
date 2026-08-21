<!--
seccion: Administración
resumen: Averiguar quién hizo qué, cuándo, y qué cambió exactamente.
revisado: 2026-08-20
rutas: /auditoria
rutaPrincipal: /auditoria
-->
# Auditoría

## Para qué sirve

Es la bitácora del sistema. Cada acción que modifica algo queda registrada con **quién, cuándo y sobre
qué**, y desde la aplicación no hay forma de editarla ni borrarla.

Sirve para tres cosas concretas: explicarle al cedente por qué un caso está como está, entender un
cambio que nadie recuerda haber hecho, y averiguar qué permiso le falta a alguien.

## Antes de empezar

- **Ver auditoría** — muestra **solo tus propias acciones**.
- **Ver auditoría de todos** — las de todo el mundo. Sin este, la pantalla se ve igual pero filtrada.
- **Exportar auditoría** — habilita el botón de descarga.

Ver [Roles y permisos](/ayuda/administracion/roles-y-permisos).

---

## Las tres solapas

### Dashboard

El panorama: cuántas acciones hubo **hoy, en los últimos 7 días y en los últimos 30** —ventanas
móviles, no semana ni mes calendario—, **cuántas fallaron en las últimas 24 horas**, la actividad día
por día, y los rankings por módulo, por tipo de acción y por usuario. Se refresca solo cada minuto.

El número de **fallidos en 24 horas** es el que conviene mirar de reojo: se pone en rojo cuando hay
algo, y ahí entran tanto los errores como los rechazos por falta de permiso.

Esta solapa **no tiene filtros**: es siempre el panorama completo de lo que te toca ver.

> ⚠ Con una excepción: el **gráfico de actividad de los últimos 30 días no respeta el recorte por
> permisos**. Muestra el total del sistema aunque solo tengas *Ver auditoría*. Los cuatro números de
> arriba y los tres rankings sí lo respetan. Es un defecto conocido; mientras esté, ese gráfico no
> sirve como "mi actividad".

### Stream

Lo último que pasó, en vivo. Las 100 acciones más recientes, **refrescándose solas cada 30 segundos**.

Es la vista para mirar mientras corre algo: una importación grande, una acción masiva, un cierre de mes.

### Búsqueda

La que sirve para investigar. Trae 50 por página, siempre del más nuevo al más viejo.

| Filtro | Para qué |
|---|---|
| **Desde / Hasta** | El rango de fechas. Ojo con el aviso de abajo |
| **Módulo** | Gestión, importación, reportes, administración, autenticación y sistema |
| **Estado** | OK o FALLIDO |
| **Severidad** | INFO, WARN o ERROR |
| **Entidad** | Sobre qué: Deudor, Comentario, Convenio, Pago… |
| **Tipo** | Qué se hizo: CREATE, UPDATE, DELETE, LOGIN_FAIL, PERMISO_DENEGADO… |
| **Deudor ID** | Lo que pasó sobre un caso |
| **Búsqueda libre** | Texto sobre el resumen, el recurso, la entidad y el tipo |

**Entidad y Tipo son campos de texto libre y buscan por coincidencia exacta**: hay que escribir
`PERMISO_DENEGADO` o `Comentario` tal cual, con mayúsculas y acentos. No son listas.

Y faltan en el desplegable de Módulo tres que el sistema **sí** registra —telefonía, email y
tableros—: hoy no se pueden filtrar desde ahí.

Clic en una fila abre el detalle.

> ### ⚠ "Desde" y "Hasta" están corridos tres horas
>
> Las dos fechas se interpretan en horario de Greenwich, no en hora argentina, así que el corte cae a
> **las 21:00 del día anterior**:
>
> - *Hasta = hoy* devuelve todo hasta **ayer a las 21:00**: se pierde lo de hoy **y las últimas tres
>   horas de ayer**.
> - *Desde = hoy* arranca **ayer a las 21:00**: te trae de yapa el final de ayer.
>
> Si buscás algo de hoy y no aparece, poné el día siguiente en *Hasta*, o dejá el campo vacío.

---

## Cómo se lee un registro

Cada línea tiene:

- **Quién** — el usuario, o **Sistema** cuando lo hizo un proceso automático sin persona detrás,
  típicamente la consolidación por pagos. Las **importaciones sí quedan a nombre de quien las lanzó**.
- **Módulo, entidad y tipo** — dónde, sobre qué y qué.
- **Resumen** — la versión en castellano.
- **Estado y severidad** — si salió bien, y cuánto importa.
- **El detalle** — los parámetros de la operación y cómo quedó la cosa después.

Sobre el detalle, una aclaración que evita frustraciones: **el "antes" casi nunca está**. Solo se
guarda en unos pocos casos —cambios sobre el deudor y sobre los contactos—. En el resto vas a ver qué
se mandó y cómo quedó, pero no contra qué.

Las contraseñas y las claves de telefonía salen tachadas como `[REDACTED]`. Aun así, la bitácora
guarda los parámetros completos de cada operación: revisala antes de compartirla con un tercero.

---

## ⚠ Qué NO vas a encontrar acá

**Los procesos automáticos masivos no se registran caso por caso.** La consolidación por pagos y la
desasignación masiva de una importación quedan como **un solo registro de la corrida completa**.

El **vencimiento nocturno de promesas** es peor: **no deja ningún registro**. Solo queda rastro si
alguien lo dispara a mano. Los cambios de estado que produce esa corrida no se pueden rastrear desde
acá.

Consecuencia práctica: **filtrar por el ID de un deudor no te va a explicar todos sus cambios de
estado.** Vas a ver los manuales y la carga de pagos a mano; lo que movió un proceso masivo hay que
buscarlo por la corrida, no por el caso — y algunas cosas no están en ningún lado.

Tampoco quedan registrados: **consultar o exportar la propia auditoría**, ni **cerrar sesión**.

---

## Investigar algo, en la práctica

**"¿Quién le cambió el estado a este caso?"**
Búsqueda → *Deudor ID* con el número del caso. Si no aparece nada, lo movió un proceso automático.

**"¿Qué pasó ayer a la tarde?"**
Búsqueda → *Desde* ayer, *Hasta* mañana (acordate del corrimiento de tres horas).

**"¿Por qué a fulano no le anda tal cosa?"**
Búsqueda → *Estado* FALLIDO. Los rechazos por permiso salen como `PERMISO_DENEGADO` y dicen qué permiso
se pidió.

**"¿Alguien intentó entrar y no pudo?"**
Búsqueda → *Tipo* `LOGIN_FAIL`. Cada intento queda, con el motivo.

---

## Exportar

El menú **Exportar** tiene cuatro opciones y no todas hacen lo mismo:

- **Excel, CSV y PDF** bajan **el resultado de la búsqueda** con 13 columnas: fecha, usuario, email,
  empresa, módulo, entidad, tipo, severidad, estado, deudor, resumen, recurso e IP.
- **CSV (página actual)** baja **solo las 50 filas que estás viendo**, y con otras columnas. Se llama
  parecido y hace otra cosa: no lo uses para un informe.

Tres límites que conviene saber antes de mandarlo al cedente:

- **Se exportan hasta 10.000 registros** y no hay aviso cuando se corta: si el filtro devuelve más,
  bajás los 10.000 más recientes y nada te lo dice. Acotá el rango de fechas.
- **El detalle de la operación no va en la exportación.** Ese solo se ve en pantalla.
- **Exporta con los filtros del formulario, no con los de la última búsqueda.** Si cambiaste un filtro
  y no apretaste *Buscar*, el archivo sale con el filtro nuevo y la pantalla muestra el viejo. Apretá
  *Buscar* antes de exportar.

---

## Qué puede salir mal

### Veo muy pocos registros

Te falta **Ver auditoría de todos**: estás viendo únicamente lo tuyo.

### La pantalla queda vacía y no dice nada

Puede ser que no haya resultados, o que la consulta haya fallado — por ejemplo por falta de permiso. La
búsqueda no muestra ningún cartel cuando falla, así que los dos casos se ven igual.

### Busco algo de hoy y no aparece

El filtro *Hasta* corta a las 21:00 del día anterior. Poné el día siguiente.

### No encuentro el cambio de estado de un caso

Lo hizo un proceso automático. No se registra caso por caso, y el vencimiento de promesas no se
registra en absoluto.

### El Excel tiene exactamente 10.000 filas

Se cortó. Acotá el rango y bajá por partes.

### No veo el botón Exportar

Falta el permiso **Exportar auditoría**.

---

## Preguntas frecuentes

**¿Se puede borrar o editar un registro?**
Desde la aplicación no hay ninguna forma de editarlos ni borrarlos. Ese es el punto.

**¿Cuánto tiempo se guarda?**
Indefinidamente. No hay borrado automático.

**¿Queda registrado quién consultó la auditoría?**
No: ni consultar ni exportar dejan rastro.

**¿Puedo armar un reporte sobre la auditoría?**
En parte. El armador de reportes arranca siempre desde el deudor, y desde ahí se puede llegar a la
rama **Auditoría** — o sea, a los registros ligados a un caso. Los de login, permisos o importaciones
no cuelgan de ningún deudor, y esos solo salen por la exportación de esta pantalla. El detalle de la
operación tampoco está disponible en reportes.

**¿Por qué algunos registros dicen "Sistema"?**
Los hizo un proceso automático, sin una persona detrás.
