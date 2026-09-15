<!--
seccion: Gestión de casos
resumen: Las claves de pago de Telecom/Personal en la ficha, cómo emitir el cupón y qué pasa si lo generás dos veces o cambiás de clave.
revisado: 2026-09-14
rutas: /gestion
-->
# Cupones de pago

## Para qué sirve

Telecom/Personal manda, junto con la asignación, dos **claves de pago** por trámite: una por el
**saldo total** y otra con una **quita del 50%**. Desde la ficha se elige una, el sistema arma un
**cupón en PDF** con el código de barras de esa clave y registra un **convenio** por ese importe.

Esto es propio de las carteras de Telecom/Personal Móvil que llegan con el archivo de "claves de
pago" (multiclaves). Si tu cartera no lo usa, esta sección de la ficha ni aparece.

## Antes de generar un cupón

Necesitás el permiso **Generar cupones de pago** (sección Convenios). Sin él, el botón **Generar
cupón** aparece deshabilitado, con un tooltip que explica por qué — pedíselo a quien administra roles.

---

## Dónde está

Ficha del caso → solapa **Convenios** → sección **Claves de pago**, arriba de la lista de convenios.
**Si el caso no tiene claves, la sección no se muestra** — es la mayoría de los casos, incluso en una
cartera de Telecom/Personal: la clave llega por trámite (`nroCliente`), y hasta que ese trámite entra
al archivo de multiclaves, no hay nada que ver acá.

La tabla trae, por cada clave vigente del trámite:

| Columna | Qué es |
|---|---|
| **Tipo** | `Saldo total` o `Con quita 50%` |
| **Vencimiento** | El real de la clave. Con el chip **Vencida** si ya pasó — ese día no se puede generar un cupón nuevo |
| **Importe** | El de esa clave puntual (la quita ya viene calculada por Telecom, no es "la mitad" siempre exacta) |
| **Clave de pago** | Los 22 dígitos, con un botón para copiar |
| **Convenio Telecom** | El número de convenio del cedente (8 dígitos) |
| **Estado** | "Cupón emitido" si ya hay un convenio activo generado con esa clave para este caso |

Un interruptor **"Ver reemplazadas"** muestra además las claves que quedaron viejas porque llegó una
tanda nueva del cedente para el mismo trámite — atenuadas, sin poder generar un cupón nuevo con ellas
(salvo que ya tengan un convenio activo: ver más abajo).

### Un trámite con una sola clave

Algunos trámites llegan con **una sola clave** (sin la de quita — el cedente no siempre manda las
dos). Ahí la tabla trae una sola fila, "Saldo total": no hay quita para ofrecer.

### Avisos arriba de la tabla

- **El saldo no coincide.** Si el saldo del caso difiere del que informó Telecom para este trámite,
  aparece un aviso — puede ser que el caso tenga pagos o ajustes que Telecom todavía no vio, o al
  revés. No bloquea nada, es para que lo mires antes de ofrecer el cupón.
- **Este trámite está en otro caso.** El mismo número de trámite puede aparecer en más de una remesa
  (una reasignación, una carga duplicada). Si hay otro caso abierto con el mismo trámite, el pago de
  la clave puede terminar cancelando *ese* caso y no este. Avisá al supervisor si ves esto.

---

## Generar el cupón

**Generar cupón**, en la fila de la clave que corresponda. Se abre un diálogo:

1. Si el trámite tiene las dos claves (total y quita), podés cambiar la selección arriba del todo.
2. Una vista previa del PDF, con **marca de agua y sin código de barras** — a propósito: así nadie se
   lleva un cupón que se pueda cobrar sin que quede el convenio registrado.
3. **Descargar.** Genera el PDF de verdad (con el código de barras) y lo baja.

Al confirmar, además del PDF:

- se crea un **convenio** por el importe exacto de la clave (chip `Clave · Con quita` o
  `Clave · Saldo total` en la lista de convenios, ver [Convenios](/ayuda/gestion/convenios));
- la gestión del caso pasa a **"Convenio acordado"**;
- queda un **comentario** nuevo con el detalle (clave, importe, vencimiento).

### El cupón, tal cual sale

Tres talones — para Telecom/Personal, para el banco y para el cliente —, cada uno con el logo, el
importe, el nombre del caso, "Cliente n°" (el trámite) y el importe en letras. Solo el talón de
Telecom/Personal lleva el **vencimiento impreso** y el **código de barras**.

> **El vencimiento impreso no es el vencimiento real de la clave.** Se imprime **hoy + 7 días**, para
> apurar el pago, con tope en el vencimiento real (si a la clave le quedan menos de 7 días, se imprime
> ese). El código de barras, en cambio, **siempre** lleva el vencimiento real — la boca de pago no lee
> las letras. Reimprimir el mismo cupón otro día corre el vencimiento impreso (no el real).

---

## Generarlo dos veces

Volver a apretar **Generar cupón** sobre la **misma** clave no arma un segundo convenio: **reusa** el
que ya existe y solo vuelve a dejarte descargar el PDF. El comentario nuevo dice "reenviado" en vez de
"generado". Es a propósito: un doble clic, o el mismo cupón perdido y hay que volver a bajarlo, no
tiene que duplicar nada.

## Cambiar de clave (de saldo total a quita, o al revés)

Solo puede haber **un** convenio de clave activo por trámite a la vez. Si ya generaste el cupón de
"Saldo total" y después generás el de "Con quita" (o al revés), el diálogo te avisa que hay un cupón
emitido y pide:

- tildar **"Anular el convenio de la otra clave y generar este cupón"** — sin el tilde, no deja seguir;
- el permiso **Cancelar convenios**, además de *Generar cupones de pago*. Sin ese permiso, la casilla
  aparece deshabilitada y cambia de texto para explicarlo.

Al confirmar, el convenio anterior queda **anulado** (visible en la lista de convenios, con la
observación de por qué) y se crea el nuevo con el importe de la otra clave.

## Reimprimir un cupón ya generado

Desde la lista de convenios de la solapa, cualquier convenio `Clave · …` que siga **activo** tiene un
botón **Reimprimir cupón** — vuelve a generar el mismo PDF (con el código de barras real) sin tocar
nada más. Sirve para un cupón que el deudor perdió o que no llegó a imprimirse bien.

---

## Cuándo NO te deja

| Situación | Qué pasa |
|---|---|
| **La clave está vencida** | No genera ni reimprime. El chip "Vencida" ya te lo avisa en la tabla |
| **La cuenta está cancelada** | No genera ni reimprime — ni siquiera para reimprimir un cupón viejo |
| **La clave fue reemplazada** por una carga posterior, y nunca tuvo convenio | No se puede generar un cupón nuevo con ella. Si ya tenía un convenio activo, ese convenio y su reimpresión siguen funcionando igual — la clave vieja "reemplazada" no invalida lo ya emitido |
| **Falta el permiso** | El botón **Generar cupón** aparece deshabilitado, con el motivo en un tooltip. Pedíselo a quien administra roles |

---

## Qué puede salir mal

### Generé el cupón pero no veo el botón para mandarlo por mail

Todavía no existe: por ahora el cupón se **descarga**, no se envía por mail desde acá. Se avisa cuando
esté disponible.

### La ficha no muestra "Claves de pago" y sé que el trámite tiene clave

Revisá que el **número de cliente** del caso (`nroCliente`) coincida exactamente con el trámite del
archivo de Telecom, y que sea la misma empresa en la que se cargó el archivo de claves. Si el CA llegó
después que las claves, puede que el caso todavía no exista — la carga de claves no depende de que
exista el caso.

### Quiero cambiar de clave pero no tengo el tilde disponible

Te falta el permiso **Cancelar convenios**. Pedíselo a quien administra roles, o que lo haga otra
persona con ese permiso.

### El PDF sale sin el logo de Personal (o con uno gris genérico)

Hoy el sistema trae un **PNG de relleno** (un placeholder gris) en lugar del logo real de Personal,
hasta que Ana Maya lo mande. El logo se reemplaza en el servidor; mientras tanto, o si ese archivo
llegara a faltar, el cupón sale con el texto "Personal" en gris en su lugar. No afecta el código de
barras ni el cobro.
