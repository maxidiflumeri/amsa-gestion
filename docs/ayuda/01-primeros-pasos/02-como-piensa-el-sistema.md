<!--
seccion: Primeros pasos
resumen: El modelo mental que hace que todas las pantallas se entiendan solas.
revisado: 2026-08-20
rutas: /gestion
-->
# Cómo piensa el sistema

Vale la pena leer esta página antes que ninguna otra. Son cinco conceptos, y con ellos las pantallas
dejan de aprenderse de memoria y empiezan a tener sentido.

## La cadena

```
Empresa  →  Remesa  →  Deudor  →  Facturas
(cedente)  (la carga)  (el caso)   Pagos
                                   Contactos
                                   Comentarios
```

**Empresa** es el cedente: quien te da la cartera para gestionar.

**Remesa** es una carga concreta de archivos. Cada vez que importás, se crea una remesa. Es la unidad
que se puede revertir: si una carga salió mal, se borra la remesa completa.

**Deudor** es el caso. Ojo con el nombre: no es "una persona", es **un caso de cobranza**. Una misma
persona puede tener varios casos —tres cuentas de agua, dos créditos— y cada uno se gestiona por
separado.

**Facturas, pagos, contactos y comentarios** cuelgan del caso.

## El caso vive dentro de su remesa

Un deudor pertenece a **una** remesa. Si el mismo cliente vuelve a venir en una carga posterior, se
crea un caso nuevo: no se mezcla con el anterior.

Esto sorprende al principio, pero es deliberado: cada asignación del cedente tiene su propia deuda,
su propia gestión y su propio resultado. Mezclarlas haría imposible rendirle cuentas al cedente.

## El importe original no cambia nunca

Este es el que más confusión genera, así que va derecho:

| | Qué es |
|---|---|
| **Original** | Lo que el cedente asignó al abrir el caso. **Inmutable.** |
| **Saldo** | Original menos los pagos registrados. |
| **Deuda actualizada** | Original más el recargo por mora, si el cedente tiene régimen de recargos. |

El original **no baja cuando el deudor paga**. Baja el saldo. Y no sube cuando corren intereses: sube
la deuda actualizada.

Se mantienen separados a propósito. El original es la referencia contra la que se le rinde al
cedente; si se pisara con cada movimiento, no habría contra qué comparar.

## Situación y gestión son dos ejes distintos

Cada caso tiene dos estados, y no significan lo mismo:

- **Situación** es cómo está la **deuda**: normal, cancelada, en plan de pago. La mueve la plata que
  entra.
- **Gestión** es cómo está el **trabajo**: sin gestionar, no contesta, promesa de pago, desasignado.
  La mueve el gestor.

Un caso puede estar en gestión "no contesta" y en situación "cancelada" al mismo tiempo: nunca
atendió el teléfono, pero pagó por home banking.

## Nada se pierde

Todo cambio queda registrado. Los comentarios, los cambios de estado, los envíos de mail, las
llamadas y los pagos se ven en la **línea de tiempo** del caso, en orden.

Y las importaciones se pueden **revertir**: si una carga entró mal, se deshace y la cartera vuelve al
estado anterior.

---

Con estos cinco conceptos, el resto de la documentación se lee sola. Si alguna pantalla no te cierra,
lo más probable es que uno de estos no esté del todo claro — volvé acá antes de seguir.
