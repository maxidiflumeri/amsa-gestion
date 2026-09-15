<!--
seccion: Ajustes
resumen: Dar de alta una cartera, qué hay que configurarle después para poder trabajarla, y la config de claves de pago (cupón de Telecom/Personal).
revisado: 2026-09-15
rutas: /ajustes/empresas
rutaPrincipal: /ajustes/empresas
-->
# Empresas

## Para qué sirve

Una **empresa** en el sistema es una **cartera**, no exactamente un cedente. Un mismo cliente puede
tener varias: en el sistema conviven Toyota, Toyota Plan de Ahorro, Toyota Refinanciación y Toyota 0800
como empresas distintas, porque son carteras con reglas y gestión distintas.

Es el primer objeto que hay que crear: **todo lo demás cuelga de acá** — las plantillas de importación,
las remesas, los casos, las políticas, la asignación de parámetros y las tasas de mora.

## Antes de empezar

- **Ver empresas** para entrar y **Crear empresas** para dar de alta.
- **Editar empresas** para cambiarle algo a una que ya existe, y **Eliminar empresas** para borrarla.

---

## Crear una empresa

**Ajustes → Empresas → nueva.** Se completa:

| Campo | Para qué |
|---|---|
| **Nombre** | Como se va a ver en todo el sistema. **Es el único campo obligatorio**, y es único |
| **CUIT** | Del cedente. Opcional, y no se valida el formato |
| **Máx. días para promesas de pago** | El límite que va a tener el gestor al cargar una promesa |
| **Cuenta SMTP** | Desde qué casilla salen los mails de esta cartera. Solo la ve quien tenga el permiso de administrar cuentas SMTP |

La tabla de empresas muestra únicamente **nombre y CUIT**: para ver el máximo de días o la cuenta SMTP
hay que abrir cada una.

### El máximo de días para promesas

Define hasta cuándo puede prometer un deudor. Por defecto son **7 días**, y se puede poner entre 1 y
30.

Es un parámetro de negocio: con un cedente que quiere cobrar rápido conviene acotarlo; con uno que
acepta plazos largos, ampliarlo. El calendario del gestor queda limitado a ese rango, y el servidor lo
vuelve a verificar — no se puede eludir.

### La cuenta SMTP

Desde qué casilla salen los mails de esta cartera. Sirve para que el deudor reciba un mail que se
identifique con quien le está reclamando.

**Este campo no siempre aparece**: se muestra solo si tenés el permiso *Administrar cuentas SMTP de
empresas*. Si no lo ves y necesitás cambiar la casilla, es eso. Se puede dejar **sin asignar**.

---

## Claves de pago (cupón de Telecom/Personal)

Solo aparece al **editar** una empresa que ya existe (no al crearla), y con el permiso *Editar
empresas*: una sección colapsable "Claves de pago (cupón de Telecom/Personal)". Es la config de la
carga de claves de pago (multiclaves) — ver [Cupones de pago](/ayuda/gestion/cupones-de-pago).

| Campo | Para qué |
|---|---|
| **Plantilla de mail preseleccionada** | La plantilla de Sender que el diálogo "Generar cupón" trae elegida de entrada. El operador igual puede cambiarla por otra, o sacarla, en cada envío — esto es solo el punto de partida. Deshabilitado si la empresa no tiene cuenta de mail asignada, o si a quien edita le falta el permiso *Enviar emails a deudores* |
| **Código de gestión al generar el cupón** | La clave del catálogo de gestión (`GES-050` por defecto) a la que pasa el caso cuando se genera un cupón nuevo |
| **Leyenda del talón para el cedente** | El texto fijo que va en el talón que se queda Telecom/Personal |
| **Medios de pago** | Separados por coma — se listan en el cupón y en el mensaje por defecto del mail cuando no se elige plantilla |

Guarda aparte del resto del formulario (no se pierde si falla): si el resto de la empresa se guardó
bien pero esto no, el aviso lo dice por separado.

### Variables del cupón, para armar una plantilla en Sender

Si vas a crear o editar una plantilla de mail para el cupón en AMSA Sender, además de las variables
de siempre (nombre, apellido, etc. — ver
[Enviar un email](/ayuda/telefonia-y-email/enviar-un-email)) tenés estas seis, propias del cupón:

| Variable | Qué trae |
|---|---|
| `{{importe_cupon}}` | El importe de la clave elegida, con signo — `$ 19.880,01` |
| `{{importe_cupon_letras}}` | El mismo importe, en letras |
| `{{vencimiento_cupon}}` | El vencimiento impreso del cupón (`DD/MM/AAAA`) |
| `{{tipo_cupon}}` | `Saldo total` o `Con quita 50%` |
| `{{nro_tramite}}` | El número de trámite de Telecom |
| `{{nombre_cliente}}` | Nombre y apellido del caso |

**Ojo con `{{saldo}}`, `{{importe}}`, `{{monto}}` o `{{total}}`**: esas son variables del mapeo
general y se completan con la **deuda del caso**, no con el importe del cupón — en un cupón de quita,
el deudor recibiría el total de la deuda en vez de lo que tiene que pagar. El diálogo avisa si la
plantilla elegida usa alguna, pero no lo bloquea: revisá la plantilla antes de usarla para esto.

---

## ⚠ Crear la empresa no alcanza

Una empresa recién creada **no sirve para nada todavía**. Faltan tres cosas, y la primera es
bloqueante:

**1. Los parámetros.** Sin códigos de situación y gestión asignados, **no vas a poder guardar una
plantilla de importación** — el formulario exige elegir un estado inicial y las listas van a estar
vacías. Y el gestor que abra un caso se encuentra los tres selectores en blanco. Se hace en
[Parámetros](/ayuda/ajustes/parametros).

**2. Una política**, si el cedente tiene condiciones que el gestor tiene que conocer. Se hace en
[Políticas](/ayuda/ajustes/politicas).

**3. Las tasas de mora**, solo si el cedente tiene régimen de recargos. Ver
[Recargo por mora](/ayuda/ajustes/recargo-por-mora).

La secuencia completa, con todos los pasos hasta la primera importación, está en
[Poner una cartera nueva de cero](/ayuda/ajustes/cartera-nueva-de-cero).

---

## Nombrar bien las carteras

Suena menor y no lo es. Si un cedente tiene varias carteras, **el nombre es lo único que las
distingue** en todos los selectores del sistema — importación, reportes, tableros.

Nombres como "Toyota" y "Toyota 2" hacen que alguien elija la equivocada al importar, y una carga en la
cartera equivocada es cara de deshacer.

---

## Qué puede salir mal

### No me deja guardar una plantilla de importación para esta empresa

Faltan los parámetros. Es la consecuencia más común de crear la empresa y no configurarla.

### No aparece la empresa en el selector de una pantalla

Puede ser que esa pantalla filtre por otra cosa, o que falte el permiso de ver empresas.

### No me deja eliminar una empresa

Solo se puede borrar una empresa **vacía**. Si tiene casos, remesas, plantillas o políticas, el mensaje
te dice cuántos de cada cosa: hay que vaciar la cartera primero.

Y si tiene tasas de recargo por mora o historial de emails, tampoco: borrarla se los llevaría puestos
sin vuelta atrás, así que el sistema frena y eso lo tiene que resolver el equipo técnico.

Eliminar una empresa es para un alta equivocada, no para dar de baja una cartera que trabajó.

### Me da un error al guardar y no dice nada útil

Lo más probable es que el **nombre ya exista**: es único en todo el sistema.

### El gestor no puede cargar una promesa a la fecha que acordó

El máximo de días de esta empresa es más corto que el plazo que pactó. Se cambia acá, con el permiso
*Editar empresas*.

---

## Preguntas frecuentes

**¿Cuándo conviene crear una empresa nueva en vez de usar una existente?**
Cuando el cedente manda una cartera con **reglas distintas**: otro formato de archivo, otros códigos,
otra política, otro régimen de recargos. Si es la misma operatoria, es una remesa nueva de la empresa
que ya existe.

**¿Puedo cambiarle el nombre a una empresa?**
Sí, y se refleja en todos lados. Los casos siguen asociados igual. El nombre nuevo no puede estar en
uso por otra.

**¿El CUIT hace falta?**
No, es opcional. Tampoco se valida: lo que escribas es lo que queda.

**¿Se puede mover una cartera de una empresa a otra?**
No hay una operación para eso.
