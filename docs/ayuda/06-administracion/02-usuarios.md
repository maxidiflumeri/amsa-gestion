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

## ⚠ El bloque de telefonía: hoy no hace falta

El formulario tiene un interruptor **Es agente** que pide usuario Neotel, device, SIP auth user, clave
Neotel y SIP password.

**No lo completes.** Quedó del plan viejo, en el que el softphone iba a estar dentro de AMSA Gestión y
el sistema se logueaba contra la central con esas credenciales. Ese plan se descartó: ahora se usa la
**Toolbar de Neotel**, que tiene su propio softphone y su propia sesión, y AMSA Gestión solo muestra la
ficha del caso.

**Para que alguien atienda llamadas no hay que configurarle nada acá.** Entra al sistema de Neotel,
la Toolbar se abre con la pantalla de gestión adentro, y listo. Ver
[Cómo funciona la telefonía](/ayuda/telefonia-y-email/telefonia-como-funciona).

Lo único que todavía usa esos datos es el panel de prueba de Neotel, que es una herramienta técnica.

Si igual necesitás tocarlo: las claves se guardan cifradas y no se pueden volver a ver; al editar, se
conservan si las dejás vacías; y apagar **Es agente** borra la configuración entera, credenciales
incluidas.

---

## Dar de baja: desactivar

**Lo correcto es apagar el interruptor Activo**, y es inmediato: la persona **no puede volver a
entrar** —al intentarlo ve *"Tu cuenta está suspendida"*— y **la sesión que tenga abierta se corta
sola**, sin esperar a que venza. A la siguiente pantalla que toque le va a decir *"Tu cuenta fue
deshabilitada"*.

**Eliminar es otra cosa, y el sistema solo te deja si esa persona nunca hizo nada.** Si tiene
comentarios, pagos, promesas, convenios, importaciones, reportes ejecutados, mails enviados o
registros de auditoría, el borrado se rechaza diciéndote exactamente qué tiene:

> *No se puede eliminar a Juan Pérez: tiene 12 comentarios, 2 promesas, 69 registros de auditoría.
> Borrarlo dejaría esos registros sin autor. Para darle de baja, desactivalo con el interruptor.*

Es a propósito: borrarlo no borraría esos registros, **les sacaría el autor**, y a partir de ahí
figurarían como "Sistema". Eliminar queda para el alta equivocada que nunca se usó.

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

### "No se puede eliminar a…"

Esa persona tiene actividad registrada. El mensaje te dice cuál. Para darla de baja, desactivala.

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
Quedan intactos, con su nombre.

**¿Puedo reactivar a alguien que desactivé?**
Sí, prendiendo el interruptor. Vuelve con el mismo rol y el mismo historial.

**¿Cuántos usuarios puede haber?**
No hay límite.
