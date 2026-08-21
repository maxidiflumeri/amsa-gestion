<!--
seccion: Telefonía y Email
resumen: Cómo conviven la Toolbar de Neotel y el sistema, y qué hace falta para que la ficha se abra sola.
revisado: 2026-08-21
rutas: /telefonia, /admin/neotel-test
rutaPrincipal: /telefonia, /admin/neotel-test
-->
# Cómo funciona la telefonía

> **Estado: sin estrenar.** La integración está implementada pero **todavía no se probó con una
> campaña real**. Lo de acá describe cómo debería funcionar; si algo no coincide con lo que ves,
> avisá — probablemente sea un ajuste pendiente y no un error tuyo.

## Para qué sirve

Que el operador **no salte entre ventanas**: mientras atiende, tiene la ficha del caso delante sin
tener que buscarlo.

## Quién hace qué

Esto es lo que hay que entender primero, porque explica casi todas las preguntas.

**La central es de Neotel y el sistema va adentro.** La **Toolbar** de Neotel es la que llama, la que
maneja el audio, la que tiene los estados del agente, las pausas y las campañas. AMSA Gestión se
muestra **embebido dentro de esa Toolbar**, y se ocupa de una sola cosa: **mostrar la ficha correcta
cuando entra la llamada**.

| Esto es de Neotel | Esto es del sistema |
|---|---|
| Marcar, atender, colgar, transferir | La ficha del caso |
| El audio | Comentarios, estados, promesas, pagos |
| El estado del agente y las pausas | El historial del deudor |
| La campaña y el orden de llamado | Los reportes y tableros |

Así que **el softphone no está acá**. Si un operador pregunta cómo poner una pausa o por qué no le
entran llamadas, eso se resuelve en la Toolbar, no en el sistema.

> ### Al operador no hay que configurarle nada en AMSA Gestión
>
> Entra al sistema de Neotel, la Toolbar se abre con la pantalla de gestión adentro, y ya está.
>
> El formulario de usuarios tiene un interruptor **Es agente** que pide credenciales SIP: **quedó del
> plan viejo**, en el que el softphone iba a vivir dentro de AMSA Gestión. No hace falta completarlo
> para atender. Ver [Usuarios](/ayuda/administracion/usuarios).

> La columna derecha describe al sistema completo, no a lo que el operador tiene a mano durante la
> llamada. **Dentro de la Toolbar no hay menú**: se ve la ficha y nada más. Reportes, tableros y las
> solapas de Política y Timeline se miran desde la ventana normal del sistema.

---

## Las dos pantallas

**Home** — la pantalla de espera. Dice *"Listo para atender"* y muestra con qué usuario está la
sesión. Tiene un botón **Buscar un caso** por si hace falta abrir uno a mano.

**Caso** — la ficha, con una barra arriba que dice **En llamada** y el nombre de la persona.

Cuando entra una llamada, **la Toolbar abre la ficha sola**. Al cortar, es la Toolbar la que decide si
vuelve a la pantalla de espera: **el sistema no se entera de que la llamada terminó**, así que la ficha
puede quedar en pantalla hasta la próxima.

En la esquina superior derecha hay un **`?`** con la ayuda de la pantalla. Se abre en un panel al
costado; si desde ahí vas a la documentación completa, se abre en una pestaña aparte para no perder la
ficha.

---

## ⚠ El primer ingreso del día

La primera vez que la Toolbar abre el sistema, te va a pedir iniciar sesión: **"Iniciá sesión en AMSA
Gestión"**.

Se abre una **pestaña nueva**, entrás con Google como siempre, y al volver la ficha ya cargó sola. Si
no vuelve solo, hay un botón **"Ya inicié sesión"**.

Es una vez por sesión, no en cada llamada. Si te lo pide en cada llamada, mirá el apartado de más
abajo: es un problema de cómo está publicada la Toolbar.

---

## ⚠ Para que esto ande hay que configurar la campaña

La ficha se abre sola solamente si la campaña de Neotel está configurada para eso. Es una configuración
que se hace **del lado de Neotel**, no en el sistema.

| Parámetro | Qué va |
|---|---|
| **MODO** | Iframe |
| **URL** | `https://amsagestion.anamayasa.com/telefonia/caso?llamada=[[CLAVE]]&data=[[DATA]]` |
| **HOME** | `https://amsagestion.anamayasa.com/telefonia/home` |
| **SEPARADOR** | El que usen al cargar la base. **Ver el aviso de abajo** |
| **POSTVIEW TIMEOUT** | Cuánto tiempo tiene el agente para cerrar la gestión antes de volver a estar disponible |

> ### El id del caso tiene que viajar en el campo DATA
>
> Es lo único imprescindible y el motivo número uno de "no me abre la ficha".
>
> Neotel manda dos cosas: una **clave**, que es su identificador interno de la llamada, y un campo
> **DATA** libre. **El número de caso nuestro tiene que ir en DATA**, porque la clave la ocupa Neotel
> con lo suyo.
>
> Quien carga la base en Neotel es quien tiene que incluir esa columna.

> ### ⚠ El SEPARADOR no viaja: hay que ponerlo en la URL
>
> El sistema **no recibe** el separador que se configura en la campaña. Asume que es `|`.
>
> Si la base se cargó con otro —una coma, un punto y coma—, hay que agregárselo a la URL:
> `&sep=;`. Sin eso el sistema no puede leer el DATA y **no abre ninguna ficha**: te lo dice
> explícitamente, en vez de arriesgarse a abrir la de otra persona.

El sistema no exige que el id esté en una posición fija de DATA: prueba los valores numéricos en orden
hasta que uno corresponda a un caso, **con un tope de cuatro intentos**. Si la base tiene más columnas
numéricas, el aviso de error te dice cuántas quedaron sin probar y ahí conviene usar `&pos=`.

### Los tres parámetros de escape

Cuando el DATA no alcanza, la URL de la campaña admite:

| Parámetro | Para qué |
|---|---|
| `&deudor=` | Mandar el id de caso aparte, sin depender de DATA. Es lo más directo |
| `&pos=N` | Decir en qué posición de DATA está el id (empezando en 0) |
| `&sep=X` | El separador, si no es `\|` |

`&pos=` es la solución concreta a "DATA trae varias columnas numéricas y agarra la equivocada".

---

## ⚠ Cuando aparece "Confirmá que es el caso correcto"

Si DATA no trajo ningún número de caso, el sistema intenta, como último recurso, con la clave de
Neotel. Y cuando lo hace, **muestra una advertencia en amarillo**.

**Hacele caso.** El identificador de Neotel y el nuestro son los dos números correlativos, así que
tarde o temprano uno coincide con un caso que existe **pero es de otra persona**. La ficha abriría a
alguien que no tiene nada que ver, en medio de una llamada, sin que nada más lo avise.

**Verificá el nombre con la persona antes de registrar cualquier gestión.** Si no coincide, usá
*Buscar otro caso*.

Y si esa advertencia aparece seguido, no es un problema del operador: **la campaña no está mandando el
id en DATA, o el separador está mal**, y hay que corregirla.

---

## ⚠ El panel de prueba de Neotel

En **Administración → Neotel (test)** hay un panel para verificar la conexión con la central.

**No solo consulta: escribe.** Puede **desloguear al agente de Neotel**, cambiarle el estado, ponerlo
**en pausa** y **moverlo de campaña**. O sea, hace exactamente lo que hace la Toolbar.

**No lo uses con la Toolbar abierta.** Los dos se pisan, y el estado que muestra cada uno deja de
coincidir con el otro y con la central.

Pide el permiso **Administrar telefonía**, que se otorga desde la pantalla de Roles. No alcanza con
*Usar softphone*: eso es a propósito, para que un agente no pueda pisarse su propio estado por fuera de
la Toolbar. Ver [Roles y permisos](/ayuda/administracion/roles-y-permisos).

---

## Qué puede salir mal

### "No se encontró el caso de esta llamada"

El mensaje te dice con qué números probó. Dos causas:

- **Probó números y ninguno existe**: puede ser un contacto viejo de la base de Neotel, que la columna
  que viaja en DATA no sea la del id de caso, o que el id esté más allá del cuarto valor numérico.
- **"La llamada llegó sin ningún número de caso"**: la campaña no está mandando DATA. Es configuración
  de Neotel.

Mientras tanto, *Buscar el caso a mano* te deja seguir atendiendo.

### Aparece la advertencia amarilla en cada llamada

La campaña no manda el id en DATA, o el separador no coincide y el DATA se lee como un solo bloque de
texto. Hay que corregir la campaña: hasta entonces, **cada ficha que se abra puede ser de otra
persona**.

### Me pide login cada vez que entra una llamada

La Toolbar se está sirviendo desde una dirección distinta a la esperada — por ejemplo una IP en vez del
dominio. En ese caso el navegador trata al sistema embebido como otro sitio y no ve tu sesión. Se
resuelve del lado de la configuración de la Toolbar.

Distinto es que te lo pida **una vez al empezar el turno**: eso es normal.

### No me entran llamadas / no puedo poner pausa

Eso es de la Toolbar de Neotel, no del sistema.

### La ficha se abre pero es de otra persona

Frená antes de registrar nada. Es el caso de la advertencia amarilla: la campaña no manda el id (o el
separador está mal) y la coincidencia fue casual.

---

## Preguntas frecuentes

**¿El sistema graba las llamadas?**
No. Las grabaciones, si las hay, son de Neotel.

**¿Puedo llamar desde la ficha?**
Las llamadas salen de la Toolbar.

**¿Qué pasa si cierro la Toolbar?**
Se cierra el sistema embebido con ella. La sesión sigue viva: se puede entrar por la ventana normal.

**¿Puedo usar el sistema normal y la Toolbar al mismo tiempo?**
Sí, es la misma sesión. Lo que hagas en uno se ve en el otro al recargar.

**¿Por qué hay una barra con chips arriba de la ficha?**
Es el contexto de la llamada: el identificador de Neotel y lo que mandó la campaña. Sirve justamente
para cotejar cuando algo no cuadra.
