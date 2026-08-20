<!--
seccion: Importación de datos
resumen: Las diez categorías, qué hace cada una y cómo elegir la correcta.
revisado: 2026-08-20
rutas: /carga, /plantillas
-->
# Las categorías

## Para qué sirve

La categoría es lo primero que se elige, tanto al armar una plantilla como al importar, y condiciona
todo lo demás: qué campos podés mapear, qué opciones aparecen y qué hace el sistema con cada fila.

Elegir mal la categoría no da un error prolijo: da una carga que "funciona" pero hace otra cosa.

## La pregunta que resuelve el 90%

**¿El archivo crea casos nuevos o le hace algo a casos que ya están?**

| | Categorías |
|---|---|
| **Crea casos** | Deudores · Deudores y Facturas · Multirregistro · Multiarchivo |
| **Le agrega datos a casos existentes** | Facturas · Pagos · Contactos · Enriquecimiento |
| **Le cambia el estado a casos existentes** | Actualizaciones · Acciones masivas |

> **Actualizaciones también crea casos.** Los registros que no encuentra los da de alta, salvo que la
> plantilla lo desactive. Está en las dos filas.

---

## Deudores

El archivo base: quién debe y cuánto. Una fila por caso.

Es la primera carga de toda cartera nueva. Todo lo demás cuelga de acá.

**Mapeá el número de cliente aunque uses el DNI como identidad.** Las cargas posteriores de Facturas y
Pagos buscan el caso **por número de cliente y solo por ahí**: si la cartera entró sin él, esos
archivos no van a matchear nunca.

## Facturas

El detalle de la deuda para casos **ya cargados**. Una fila por factura.

Pide **remesa origen**: contra qué cartera buscar los casos. Y busca **por número de cliente**.

## Pagos

Cobranzas contra casos ya cargados. Pide remesa origen, y es la única categoría donde podés elegir
**varias a la vez** — útil cuando el archivo del cedente cubre varias asignaciones.

> **El anti-duplicados.** Para que reimportar un archivo acumulativo no duplique cobranzas, el sistema
> saltea un pago si ya existe otro del **mismo caso, mismo día y mismo importe**. Con la mayoría de
> los cedentes funciona bien.
>
> Pero es destructivo cuando el deudor cancela **varias cuotas iguales el mismo día**. En un caso
> real, una cuenta canceló 36 partidas de $195,04 en la misma fecha y quedaba registrada **una sola**;
> sobre el archivo completo se perdía el **13,3% de la cobranza**.
>
> La solución: que la plantilla mapee el **número de comprobante** a `observación`. Entra en el
> criterio del anti-duplicados y dos cobros del mismo día e importe pero de comprobantes distintos
> dejan de ser "el mismo pago". **De paso marca como pagada la factura** con ese número: sin eso el
> saldo baja pero las facturas quedan todas pendientes.

> **Antes del anti-duplicados hay otra regla:** si el caso tiene un pago cargado **a mano** y sin
> confirmar por el mismo importe, el import no crea uno nuevo — **confirma ese**. Sin importar la
> fecha. Si un gestor cargó el pago antes de que llegara el archivo, el archivo se lo consume.

> **Una fila salteada cuenta como OK.** Reimportar un archivo acumulativo reporta "N filas OK" sin
> haber creado nada nuevo.

## Contactos

Teléfonos, mails y domicilios de casos ya cargados. Pide remesa origen.

Los teléfonos se **normalizan** a formato internacional. Un número al que no se le puede deducir la
característica **se descarta en silencio**: no aparece como error. Si el cedente manda números locales
sin código de área, contá con perder algunos. Lo mismo pasa en cualquier categoría que cargue
contactos, incluida Deudores.

**La diferencia real con Enriquecimiento:** Contactos usa el resto de la fila para **deducir el código
de área** —los otros teléfonos del caso y el código postal del domicilio—. Enriquecimiento no. Con un
cedente que manda números locales, Enriquecimiento descarta bastante más. Contactos además permite
declarar subtipo y prioridad.

## Enriquecimiento

**El nombre engaña: carga contactos, igual que la categoría Contactos.** No carga "datos
adicionales", aunque suene a eso.

Los datos adicionales se cargan mapeando **campos extras** desde Deudores, Deudores y Facturas,
Facturas, Actualizaciones o Acciones masivas.

> ⚠ **La sección de campos extras aparece en el editor para todas las categorías**, pero Contactos,
> Enriquecimiento y Pagos **no los guardan**: el campo se ve, se calcula y se descarta sin avisar.

## Deudores y Facturas

El caso **y** su deuda al detalle. Cubre dos formas de archivo:

- **Todo en la misma fila**, con las facturas como bloques repetitivos.
- **El deudor repetido**, una fila por factura. Es la más común.

Está desarrollado en [Crear una plantilla](/ayuda/importacion/crear-plantilla).

## Actualizaciones

El cedente informa **cómo quedó la cartera**: qué se pagó, qué deuda nueva hay, a quién ya no hay que
gestionar. El sistema reconcilia con criterio propio.

Es la categoría de **mayor impacto** del sistema: una corrida puede tocar toda una cartera. Tiene
opciones que cambian por completo lo que hace, y **tiene su propia página**:
[Actualizaciones](/ayuda/importacion/actualizaciones).

## Acciones masivas

Un listado de casos para marcarles algo en bloque: cambiar situación o gestión, pisar un campo, dejar
un comentario, cargar datos adicionales, borrar un contacto.

A diferencia de Actualizaciones, **no reconcilia nada**: hace exactamente lo que le pedís.

Por defecto actúa sobre **toda la empresa**: hay un selector opcional para acotarla a una remesa. Ver
[Acciones masivas](/ayuda/importacion/acciones-masivas).

## Multirregistro

**Un** archivo con **varios tipos de línea** mezclados: una para el cliente, otra para cada aviso,
otra para el detalle, otra para las bajas.

## Multiarchivo

**Varios** archivos de formatos **distintos** que se cargan juntos y se cruzan entre sí.

> No confundir con subir varios archivos **del mismo formato** en una carga normal: eso no necesita
> Multiarchivo. Funciona en todas las categorías **menos en Multirregistro**, que procesa un solo
> archivo por carga e ignora los demás sin aviso.

Las dos últimas **no se arman con el editor de mapeo**: se configuran pegando un JSON, partiendo de un
preset. Las arma un técnico. Ver
[Multirregistro y Multiarchivo](/ayuda/importacion/multirregistro-y-multiarchivo).

---

## Las confusiones más frecuentes

### Deudores vs. Deudores y Facturas

Si el archivo trae **una fila por factura** con el deudor repetido y usás **Deudores**, cada fila
actualiza a la anterior: la cantidad de casos da bien pero **el detalle de la deuda se pierde** y
queda el monto de la última fila. Sin ningún error a la vista.

### Contactos vs. Enriquecimiento

Cargan lo mismo, pero **Contactos deduce el código de área** a partir del resto de la fila y
Enriquecimiento no. Si el cedente manda teléfonos sin característica, la diferencia se nota en cuántos
sobreviven. Usá **Contactos**.

### Actualizaciones vs. Acciones masivas

- **Actualizaciones** es el cedente diciéndote cómo quedó la deuda. El sistema **decide** cosas:
  genera pagos, crea facturas de ajuste, marca ausentes.
- **Acciones masivas** sos vos diciéndole al sistema qué marcar. **No decide nada.**

Si el archivo trae importes y esperás que se reconcilien, es Actualizaciones. Si trae un listado de
cuentas y una etiqueta, es Acciones masivas.

### Facturas vs. Deudores y Facturas

**Facturas** requiere que los casos ya existan. **Deudores y Facturas** los crea. Si corrés Facturas
contra una cartera que no está cargada, todas las filas fallan.
