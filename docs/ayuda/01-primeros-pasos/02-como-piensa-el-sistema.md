<!--
seccion: Primeros pasos
resumen: El modelo mental que hace que todas las pantallas se entiendan solas.
revisado: 2026-08-20
rutas: /gestion, /historial-importaciones
-->
# Cómo piensa el sistema

Vale la pena leer esta página antes que ninguna otra. Son pocos conceptos, y con ellos las pantallas
dejan de aprenderse de memoria y empiezan a tener sentido.

## La cadena

```
Empresa  →  Remesa  →  Caso  →  Facturas · Pagos · Contactos
(cartera)  (la carga)          Comentarios · Convenios · Promesas
```

**Empresa** es una **cartera**, no exactamente un cedente. Un mismo cedente puede tener varias: en el
sistema conviven Toyota, Toyota Plan de Ahorro, Toyota Refinanciación y Toyota 0800 como empresas
distintas, porque son carteras con reglas y gestión distintas.

**Remesa** es una carga concreta de archivos. Cada vez que importás, se crea una remesa.

**Caso** es lo que la pantalla llama "deudor". Ojo con el nombre: **no es "una persona"**, es un caso
de cobranza.

**Facturas, pagos, contactos, comentarios, convenios y promesas** cuelgan del caso.

## Qué hace único a un caso, y por qué importa

Un caso es único por la combinación **empresa + identificador + remesa**.

La pregunta que sigue es cuál es "el identificador", y la respuesta es la que más consecuencias
tiene: **lo define la plantilla de importación**, no el sistema.

- Si la plantilla mapea el **DNI**, entonces todas las deudas de esa persona en esa cartera son
  **un solo caso**. Es lo que pasa en Toyota TCFA: los tres créditos de un cliente entran como tres
  facturas de un único caso.
- Si la plantilla **no mapea el documento**, el sistema usa el **número de cuenta del cedente** como
  identidad. Es lo que pasa en AYSA: tres cuentas de agua de la misma persona son **tres casos
  separados**, y se gestionan por separado.

Ninguna de las dos es "la correcta": depende de cómo el cedente entiende su cartera. Pero elegir mal
tiene consecuencias silenciosas. En AYSA, mapear el DNI hizo que 141 cuentas colapsaran en 55 casos:
**86 casos desaparecieron sin que la importación reportara un solo error**.

## El caso vive dentro de su remesa

Un caso pertenece a **una** remesa. Si el mismo cliente vuelve en una carga posterior, se crea un caso
nuevo: no se mezcla con el anterior.

Es deliberado — cada asignación del cedente tiene su propia deuda, su propia gestión y su propio
resultado, y mezclarlas haría imposible rendirle cuentas.

Pero no quedás a ciegas ni empezás de cero:

- El tab **Otras Cuentas** de la ficha lista todos los casos de esa misma persona, incluso de otras
  empresas y otras remesas.
- **Los contactos se heredan solos.** Cuando entra un caso nuevo, el sistema le copia los teléfonos y
  mails que ya conocía de esa persona.

> **No todas las cargas crean casos.** Las de pagos, contactos, actualizaciones y acciones masivas
> apuntan a una **remesa origen** que elegís al importar, y modifican casos que ya existen ahí.

## Los tres números de la deuda

| | Qué es |
|---|---|
| **Original** | Lo que el cedente asignó al abrir el caso |
| **Saldo** | Original menos los pagos registrados |
| **Deuda actualizada** | Original más el recargo por mora, si el cedente tiene régimen de recargos |

Dos reglas sobre el original:

- **Los pagos no lo tocan.** Cuando el deudor paga, baja el saldo, no el original. Se mantienen
  separados porque el original es la referencia contra la que se le rinde al cedente.
- **Puede subir** si el cedente informa más deuda en una actualización. No es un número congelado: es
  un número que los pagos no mueven.

La ficha muestra **uno solo de los tres**, el que corresponde: si el cedente tiene régimen de
recargos ves la deuda actualizada; si no, y hay pagos, el saldo; y si no, la deuda total.

> **El cruce que más confunde:** ninguno de los tres es "lo que hay que cobrar hoy" si el caso tiene
> pagos parciales **y** mora. El saldo no incluye la mora, y la deuda actualizada no descuenta los
> pagos. En ese cruce, preguntá antes de cerrar un número.

Un detalle del saldo: es un valor **guardado**, que se refresca cuando corre la consolidación — no se
recalcula solo al abrir la ficha. Y la cancelación tiene una **tolerancia** (1% por defecto), así que
un caso puede quedar cancelado debiendo unos pesos.

## Los tres ejes del estado

Cada caso tiene tres estados, y no significan lo mismo:

- **Situación del cliente** — dónde está parado el caso: sin contacto, inubicable, contactado,
  promesa de pago, negativa, en mediación, cancelado.
- **Estado de gestión** — dónde está parado el trabajo: sin gestionar, en gestión, no contesta,
  desasignado.
- **Motivo de no pago** — por qué no paga, cuando lo dijo.

Los dos primeros son en buena medida catálogos espejo, y ninguno es "del gestor" o "del sistema" en
exclusiva: los mueven el gestor a mano, las promesas de pago, las importaciones y la consolidación
automática por pagos.

Un caso puede estar en gestión "no contesta" y en situación "cancelada" al mismo tiempo: nunca
atendió, pero pagó por home banking.

**Los tres catálogos son configurables por cedente**: los códigos que ves dependen de la empresa en la
que estés parado.

## La cuenta cancelada se bloquea

Cuando un caso queda cancelado, pasa a **solo lectura**. No se puede comentar, cargar un pago o una
promesa, crear un convenio ni cambiar estados. Si intentás, el sistema lo rechaza.

Es la primera pared con la que se choca un gestor, y no es un error: es a propósito.

## La política dice qué podés ofrecer

Cada remesa tiene una **política** asociada: las formas de pago y el tipo de atención que el cedente
autoriza. Está en un tab de la ficha, y es lo que mirás antes de negociar.

## Todo queda auditado (que no es lo mismo que "nada se borra")

Cada acción deja registro en la auditoría: quién, qué y cuándo. Eso no se pierde.

Los datos sí se pueden borrar, con el permiso correspondiente: comentarios, pagos manuales, y
remesas enteras.

**Sobre deshacer una carga, dos cosas que conviene saber antes de necesitarlas:**

- **Solo las cargas de acciones masivas se pueden revertir** con un botón. Las de deudores, facturas,
  pagos, contactos o actualizaciones **no tienen "deshacer"**.
- **Borrar una remesa no siempre deshace lo que hizo.** Si la carga fue de pagos o contactos, esos
  registros cuelgan de casos de *otra* remesa: al borrar la remesa de pagos, los pagos **quedan**.
  Y una remesa deja de poder borrarse apenas alguien comentó, pagó o llamó a alguno de sus casos.

Por eso conviene mirar la **vista previa** antes de confirmar una importación grande, en vez de
confiar en poder revertirla.

## Dónde se ve cada cosa

| Qué buscás | Dónde está |
|---|---|
| Comentarios, facturas, pagos, convenios, promesas | Tabs de la ficha del caso |
| Envíos de mail y WhatsApp | Tab **Timeline** de la ficha |
| Cambios de estado, quién tocó qué | Sección **Auditoría**, filtrando por el caso |

> El tab **Timeline** no es un historial completo del caso: muestra las comunicaciones salientes que
> registró AMSA Sender. Los comentarios y los pagos están en sus propios tabs.

---

Con esto, el resto de la documentación se lee sola. Si alguna pantalla no te cierra, lo más probable
es que uno de estos conceptos no esté del todo claro — volvé acá antes de seguir.
