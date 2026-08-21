<!--
seccion: Ajustes
resumen: Dar de alta una cartera y qué hay que configurarle después para poder trabajarla.
revisado: 2026-08-20
rutas: /ajustes/empresas
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

### ⚠ No me deja eliminar una empresa

Si tiene casos, remesas, plantillas **o políticas**, el borrado se rechaza. El mensaje que vas a ver es
un error técnico poco claro: es eso.

Y al revés, si la empresa **sí** se deja borrar, se lleva puestas sin ningún aviso **las tasas y los
índices de recargo por mora y todo el historial de emails enviados**. No hay vuelta atrás.

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
