<!--
seccion: Administración
resumen: Dar de alta a alguien, asignarle rol y darle de baja sin romper el historial.
revisado: 2026-08-20
rutas: /admin/usuarios
rutaPrincipal: /admin/usuarios
-->
# Usuarios

## Para qué sirve

Dar de alta a la gente que entra al sistema, asignarle un rol y, si atiende llamadas, configurarle la
telefonía.

## Antes de empezar

El permiso **Gestionar usuarios**, y el rol que le vas a asignar ya creado.

---

## ⚠ Se entra con Google, no con usuario y contraseña

**El sistema no tiene contraseñas.** Se entra con una cuenta de Google, y el email que cargues acá
tiene que ser **exactamente el de esa cuenta**.

Dos consecuencias:

- **No hay nada que resetear.** Si alguien no puede entrar, el problema está en su cuenta de Google o
  en cómo quedó cargado el email.
- **El alta es obligatoria y previa.** Nadie entra por tener una cuenta de Google: si el email no está
  cargado acá, el sistema lo rechaza con *"No tenés acceso al sistema. Pedile al administrador que te
  dé de alta."*

---

## Crear un usuario

**Administración → Usuarios → Nuevo usuario.**

| Campo | Notas |
|---|---|
| **Nombre completo** | Obligatorio. Ver el aviso de abajo |
| **Email (cuenta de Google)** | Obligatorio, único, y tiene que ser el de Google |
| **Legajo** | Opcional, único |
| **DNI o CUIL** | Opcional, único. 7-8 dígitos, o 11 con o sin guiones |
| **Rol** | Sin rol la persona entra pero no puede hacer nada |
| **Activo** | Si lo apagás, no puede volver a entrar |

> ### ⚠ El email no se puede cambiar después
>
> Una vez creado el usuario, **el campo de email queda bloqueado**. Y como el email es la credencial de
> login, un error de tipeo ahí es un callejón: la única salida sería eliminar y recrear, y eliminar
> **también puede estar bloqueado** o, peor, funcionar y llevarse la trazabilidad puesta (ver abajo).
>
> **Revisá el email dos veces antes de guardar el alta.** Es el campo más caro de equivocar de toda la
> pantalla.

> **El nombre y la foto los pisa Google.** En cada login el sistema toma el nombre y el avatar de la
> cuenta de Google y sobrescribe lo que haya. Cargar acá "Juan Pérez" sirve para identificarlo hasta el
> primer login: después manda lo que diga Google.

---

## El bloque de telefonía

Si la persona atiende llamadas, se activa **Es agente** y se completan los datos que da Neotel: usuario
Neotel, device, SIP auth user, display name, clave Neotel y SIP password.

Al **crear** son obligatorios cinco: usuario Neotel, device, SIP auth user, clave Neotel y SIP
password. El display name es opcional, y así está rotulado.

Al **editar**, las claves solo se tocan si las cambiás explícitamente: dejarlas vacías las conserva.

> **Apagar "Es agente" borra la configuración de telefonía**, credenciales incluidas. Volver a
> activarla obliga a pedirle todo de nuevo a Neotel. Si es una baja temporal, usá **Habilitado** dentro
> del bloque en vez de apagar el interruptor.

Las claves se guardan cifradas y no se pueden volver a ver: si alguien las perdió, se cargan de nuevo.

---

## ⚠ Dar de baja: desactivar, nunca eliminar

**Lo correcto es apagar el interruptor Activo.** A partir de ahí la persona **no puede volver a
entrar**: al intentarlo ve *"Tu cuenta está suspendida. Contactá al administrador."*

Lo que **no** hace es echarla si ya está adentro. La sesión abierta sigue funcionando hasta que venza,
hasta un día después. Para una baja normal da igual; para una urgencia, no alcanza.

**Eliminar es otra cosa, y es peligrosa.** Borra el registro del usuario, y en la mayoría de los casos
**el sistema te deja hacerlo**: sus comentarios, pagos, promesas, convenios y registros de auditoría no
se borran, pero **pierden el autor** y a partir de ahí figuran como "Sistema". La trazabilidad de todo
lo que hizo esa persona se va, en silencio y sin vuelta atrás.

Solo falla —con un error feo, *"Internal server error"*— si la persona ejecutó reportes, mandó mails
desde el sistema o tiene telefonía configurada.

**La regla es simple: no elimines usuarios.** Desactivalos. Eliminar sirve únicamente para un alta
equivocada que nunca se usó.

---

## Qué puede salir mal

### "No tenés acceso al sistema. Pedile al administrador que te dé de alta."

El email no está cargado, o está cargado distinto del de su cuenta de Google. Es la causa más común, y
suele ser una diferencia mínima: un punto de más, otro dominio. Y ya no se puede corregir desde la
pantalla: escalalo.

### "Tu cuenta está suspendida."

El usuario está inactivo. Se prende el interruptor **Activo**.

### "Ya existe un usuario con ese email" / "El legajo ya está en uso por otro usuario" / "El DNI/CUIL ya está en uso por otro usuario"

Los tres son únicos. Suele ser que la persona ya está dada de alta, quizás inactiva — fijate en la
lista antes de crear otro.

### Entra pero no ve nada

No tiene rol asignado, o el rol no tiene permisos.

### Le cambié el rol y no le cambió nada

Tiene que cerrar sesión y volver a entrar. Ver
[Roles y permisos](/ayuda/administracion/roles-y-permisos).

### Lo desactivé y sigue trabajando

Desactivar impide volver a entrar; no corta la sesión que ya está abierta.

### Cambié el nombre y volvió al anterior

Lo pisó Google en el siguiente login.

### El DNI aparece vacío cuando edito

El campo nunca se recupera: siempre se muestra en blanco, aunque esté cargado. Guardarlo vacío **no lo
borra**, y tampoco hay forma de dejarlo vacío: solo se puede pisar con otro valor. Para saber cuál está
cargado, hoy no hay forma desde esta pantalla.

---

## Preguntas frecuentes

**¿Cómo le cambio la contraseña a alguien?**
No hay contraseñas. Se entra con Google.

**¿Puedo dar de alta a alguien con un email que no sea de Google?**
No va a poder entrar: el login valida contra Google.

**¿Qué pasa con los comentarios de un usuario desactivado?**
Quedan intactos, con su nombre. Por eso conviene desactivar y no eliminar.

**¿Puedo reactivar a alguien que desactivé?**
Sí, prendiendo el interruptor. Vuelve con el mismo rol y el mismo historial.

**¿Cuántos usuarios puede haber?**
No hay límite.
