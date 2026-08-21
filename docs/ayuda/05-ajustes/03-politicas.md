<!--
seccion: Ajustes
resumen: Dejar escrito qué puede ofrecer el gestor en cada cartera.
revisado: 2026-08-20
rutas: /ajustes/politicas
-->
# Políticas

## Para qué sirve

Una política es **lo que el cedente autoriza**: qué formas de pago se pueden ofrecer, cómo hay que
atender, y la metodología acordada.

Se asocia a una remesa, y el gestor la ve en la solapa **Política** de la ficha, al lado de los datos
del caso.

> **El sistema no valida contra la política.** No te va a impedir armar un convenio en condiciones que
> el cedente no aceptó. La política es información para el gestor, no una restricción automática.

Justamente por eso importa que esté bien escrita: es lo único que separa al gestor de ofrecer algo que
después el cliente rechaza.

## Antes de empezar

- **Ver políticas** para entrar, **Crear políticas** para darlas de alta y **Editar políticas** para
  modificarlas o desactivarlas.
- La empresa creada: **las políticas son por empresa**.

---

## Armar una política

**Ajustes → Políticas.** Lo primero es **elegir la empresa**: hasta que no lo hagas, el botón de nueva
política está deshabilitado.

Tiene un nombre y tres solapas de contenido, las tres con editor de texto enriquecido:

| Solapa | Qué va |
|---|---|
| **Descripción / Metodología** | Lo acordado con el cedente. Suele ser el cuerpo principal |
| **Formas de pago** | Qué se puede ofrecer: cuotas, quitas, medios de pago |
| **Tipo de atención** | Cómo hay que tratar el caso |

Una política puede estar **activa o inactiva**. No hay borrado: lo que la pantalla ofrece es
desactivarla.

---

## ⚠ Cómo llega la política al caso

**La política se asocia a la remesa, no al caso.** Todos los casos de esa remesa ven la misma.

Y se asocia **en un solo lugar**: la columna **Política** del historial de importaciones. El asistente
de importación no la pide, así que hay que volver al historial después de cargar el archivo.

> El aviso que ve el gestor cuando falta dice *"Podés asociarla desde Ajustes → Políticas o desde el
> Historial de Importaciones"*. **La primera mitad es engañosa**: en Ajustes → Políticas solo se
> crean. Asociar se hace únicamente desde el historial.

Ver [Historial y problemas](/ayuda/importacion/historial-y-problemas).

---

## Qué escribir, en la práctica

La política la lee alguien **con el deudor esperando del otro lado del teléfono**. Eso condiciona cómo
conviene escribirla:

- **Lo concreto arriba.** Cuántas cuotas como máximo, si hay quita y de cuánto, qué medios de pago.
- **En listas, no en párrafos.** Un texto de tres párrafos no se lee en una llamada.
- **Los límites explícitos.** "Hasta 6 cuotas" es accionable; "cuotas a convenir" obliga a preguntar.
- **Qué hacer cuando se sale del libreto**: a quién consultar si el deudor pide algo que no está
  contemplado.

Ver [Convenios](/ayuda/gestion/convenios).

---

## Qué puede salir mal

### El gestor dice que no ve la política

Esa remesa no tiene política asociada. Se asigna desde el historial de importaciones.

### La política está pero es de otra cartera

Se asoció la equivocada. El sistema **no valida** que la política pertenezca a la empresa de la remesa,
así que el error es posible y no avisa. Se cambia desde la misma columna del historial.

### No aparece ninguna política al querer asociarla

Tres causas posibles, y las tres se ven igual —el combo vacío, sin ningún error—:

- No hay ninguna creada para esa empresa.
- Están todas inactivas: el combo solo lista las activas.
- **Te falta el permiso Ver políticas.** Este es el que más despista, porque no da ningún mensaje.

### Se ofreció algo que el cedente no acepta

El sistema no lo impide. Si es un caso recurrente, conviene que la política lo diga explícitamente en
la solapa de formas de pago.

### Desactivé una política y el gestor la sigue viendo

Desactivar **no la retira de las remesas que ya la tenían**: solo impide asociarla de nuevo. En la
ficha aparece marcada como inactiva. Para sacarla de verdad hay que asociarle otra a esa remesa.

---

## Preguntas frecuentes

**¿Puedo tener varias políticas por empresa?**
Sí. Cada remesa se asocia a la que corresponda — sirve cuando el cedente cambia las condiciones entre
asignaciones.

**¿Cambiar una política afecta a las remesas ya asociadas?**
Sí: muestran el contenido actualizado. No hay versionado.

**¿Un caso puede cambiar de política?**
Sí, y es fácil que pase sin que nadie lo decida: si la misma cuenta vuelve a entrar en una remesa
nueva, pasa a ver la política de esa remesa.

**¿Se puede borrar una política?**
No, solo desactivarla.

**¿Los deudores ven la política?**
No. Es interna, para el gestor.

**¿Se puede exigir que se cumpla?**
No hay validación automática. Es información, no una regla del sistema.
