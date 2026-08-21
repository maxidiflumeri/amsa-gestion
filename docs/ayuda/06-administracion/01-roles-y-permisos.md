<!--
seccion: Administración
resumen: Qué puede hacer cada persona en el sistema, y por qué un permiso nuevo no se ve hasta volver a entrar.
revisado: 2026-08-20
rutas: /admin/roles
-->
# Roles y permisos

## Para qué sirve

Un **rol** es un nombre y una lista de permisos. Cada usuario tiene un rol, y **todo lo que puede hacer
sale de ahí**.

No hay un usuario todopoderoso. El rol se puede llamar "Administrador", pero para el sistema eso no
significa nada: si no tiene el permiso tildado, no puede. No existe ningún atajo por nombre de rol.

## Antes de empezar

El permiso **Gestionar roles**.

---

## Crear o editar un rol

**Administración → Roles.** Se le pone un nombre y se tildan los permisos, agrupados por sección.

Cada sección tiene su tilde propia que **marca o desmarca todo el bloque de una** — útil para armar un
rol de solo lectura rápido.

---

## ⚠ Los permisos no se aplican hasta que la persona vuelva a entrar

Este es el motivo número uno de "le di el permiso y sigue sin poder".

Los permisos **viajan dentro de la sesión**, y se arman en el momento del login. Si le cambiás el rol a
alguien que ya está trabajando, **su sesión sigue con los permisos viejos** hasta que la renueve. Ni
siquiera recargar la página alcanza.

**Qué hay que hacer:** pedirle que cierre sesión y vuelva a entrar. La sesión dura **un día**, así que
si no hace nada, al día siguiente lo tiene igual.

**Vale en los dos sentidos: sacarle un permiso a alguien tampoco es inmediato.**

Y ojo con la salida fácil: **desactivar el usuario tampoco corta la sesión abierta.** El "Activo" se
verifica al entrar, no en cada operación, así que quien ya está adentro sigue trabajando hasta que su
sesión venza —puede ser hasta un día— incluso si recarga la página. Desactivar sirve para que **no
vuelva a entrar**, no para echarlo ahora mismo. Si hace falta cortar el acceso en el momento, hay que
pedirle que cierre sesión, o escalarlo a sistemas.

---

## Cómo se nota que falta un permiso

De dos maneras distintas, y conviene saber cuál estás viendo:

**En el menú.** Los ítems que la persona no puede usar **no aparecen**. Si alguien dice "no me figura
Plantillas", es que le falta *Ver plantillas de importación*.

**Al operar.** Si entra igual —por un enlace o escribiendo la dirección—, la pantalla abre pero no trae
nada. Lo que ve depende de la pantalla: a veces un *"No se pudieron cargar los datos"* genérico, a veces
**una tabla vacía sin ningún cartel**, que se confunde con "no hay resultados". El mensaje explícito
*"No tenés permiso para realizar esta acción"* aparece recién si intenta **guardar o borrar** algo.

Por eso conviene no diagnosticar por lo que ve el usuario, sino ir a **Auditoría**: todos los rechazos
quedan registrados como acciones fallidas del módulo AUTH, y **el registro dice el nombre exacto del
permiso que faltó**. Ver [Auditoría](/ayuda/administracion/auditoria).

---

## Cómo leer el catálogo

Los permisos vienen en pares: **ver** y **hacer**. *Ver convenios* deja mirar; *Crear convenios* deja
armarlos. Un rol de consulta se arma tildando solo los "ver".

Tres que no son obvios:

- **Eliminar comentarios propios** — solo los suyos, nunca los de otro.
- **Ver auditoría** vs **Ver auditoría de todos** — sin el segundo, solo ve sus propias acciones.
- **Ver tableros de todas las empresas** — sin este, el tablero queda acotado a su empresa.

---

## ⚠ Los permisos de telefonía no están en esta pantalla

El sistema tiene cuatro permisos de telefonía —usar el softphone, click-to-call, supervisar y
administrar— que **la pantalla de Roles no muestra**, porque la lista que dibuja está desactualizada
respecto de la del servidor.

Consecuencia práctica: **desde acá no se pueden otorgar**. Lo bueno es que tampoco se pierden: si un rol
ya los tiene, editarlo y guardarlo **los conserva**, aunque no los veas. El único síntoma raro es el
contador de arriba del diálogo, que va a decir más permisos de los que tenés tildados — la diferencia
son esos.

El efecto visible es que el ítem de menú **Neotel (test)** no lo puede ver nadie: pide un permiso que
esta pantalla no sabe dar. Si un rol necesita telefonía, hay que cargarlo por fuera de acá —escalalo a
sistemas.

---

## Armar roles, en la práctica

**Menos roles y más claros.** Tres o cuatro bien definidos se entienden; doce con diferencias de un
tilde no los entiende nadie a los seis meses.

Un punto de partida razonable:

| Rol | Idea |
|---|---|
| **Gestor** | Ver deudores, comentar, cargar promesas y pagos, armar convenios |
| **Supervisor** | Lo del gestor + reportes, tableros y auditoría de todos |
| **Administrador** | Todo, incluido empresas, parámetros, usuarios y roles |
| **Consulta** | Solo los "ver" |

**Cuidado con el propio.** Si te sacás *Gestionar roles* a vos mismo, al volver a entrar **no vas a
poder devolvértelo**: no hay puerta de atrás desde la aplicación. Recuperarlo requiere intervención
técnica sobre el servidor. Que siempre quede otra persona con ese permiso.

---

## Qué puede salir mal

### Le di el permiso y sigue sin poder

No cerró sesión. Es lo primero a descartar siempre.

### Lo desactivé y sigue trabajando

Desactivar impide **entrar de nuevo**, no corta la sesión abierta. Puede seguir hasta un día.

### No me deja eliminar un rol

Si el rol tiene usuarios asignados, **el botón de eliminar aparece en gris**, sin ninguna explicación.
La columna *Usuarios* de la misma fila te dice cuántos son. Hay que moverlos a otro rol primero: recién
ahí el botón se habilita.

### A alguien le falta un permiso y no sé cuál

Auditoría → Búsqueda, filtrando por Estado **FALLIDO**. El rechazo dice qué permiso se pidió.

### Un usuario sin rol

Puede entrar, pero **sin ningún permiso**: no ve casi nada. Se le asigna rol desde
[Usuarios](/ayuda/administracion/usuarios).

---

## Preguntas frecuentes

**¿Un usuario puede tener dos roles?**
No, uno solo.

**¿Puedo copiar un rol para armar otro parecido?**
No hay botón de duplicar: se crea uno nuevo y se tildan los permisos.

**¿Cambiar los permisos de un rol afecta a todos los que lo tienen?**
Sí, a todos — cuando cada uno vuelva a entrar.

**¿Hay algún rol que no se pueda tocar?**
No. Todos son editables y borrables, con la única condición de que no tengan usuarios asignados.
