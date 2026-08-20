<!--
seccion: Importación de datos
resumen: La categoría de mayor impacto del sistema. Qué hace cada opción y qué pasa con los ausentes.
revisado: 2026-08-20
rutas: /carga
-->
# Actualizaciones

> **Es la categoría de mayor impacto del sistema.** Una sola corrida puede tocar una cartera entera:
> generar pagos, cancelar casos, sacarlos de gestión. Leé esta página antes de la primera vez, y mirá
> siempre la vista previa.

## Para qué sirve

El cedente manda **cómo quedó la cartera**: qué se cobró, qué deuda nueva hay, a quién ya no hay que
gestionar. El sistema **reconcilia** — compara lo que informa el archivo contra lo que tiene, y actúa
en consecuencia.

Es lo que la diferencia de todas las demás: las otras cargan lo que el archivo dice. Esta **decide**.

## Antes de empezar

- La **remesa origen**: contra qué cartera se reconcilia. Es obligatoria y define todo el alcance.
- Entender las cuatro opciones de abajo. Los defaults son razonables pero **no son inocuos**.

---

## Qué hace, en criollo

Por cada caso de la remesa origen, el sistema compara la deuda que tiene contra la que informa el
archivo:

| Situación | Qué hace |
|---|---|
| El archivo informa **menos** deuda | Genera un **pago** por la diferencia |
| El archivo informa **más** deuda | Sube la deuda (cómo, lo elegís vos) |
| El caso **no aparece** en el archivo | Depende de lo que elijas — ver abajo |
| El caso **no existe** todavía | Lo crea, salvo que le digas que no |

---

## Las cuatro opciones

### 1. Solo actualizar datos — no reconciliar deuda

Apaga toda la reconciliación. Con esto tildado, la carga **solo completa el DNI y los datos
adicionales** de casos que ya existen. No genera pagos, no crea facturas, no toca a los ausentes y no
crea casos nuevos.

**Cuándo:** el cedente te manda los DNI que faltaban, o datos de contacto extra, y no querés que nada
más se mueva.

Es la opción más segura de toda la categoría.

### 2. Qué hacer con los deudores ausentes del archivo

La más importante y la que más daño puede hacer. Un caso que estaba en la remesa origen y **no viene
en el archivo de hoy** — ¿qué significa?

| Opción | Qué hace | Cuándo |
|---|---|---|
| **Marcar como pagó todo** (por defecto) | Todas sus facturas a pagadas, un pago por el total, y la consolidación lo deja **cancelado** | El archivo es la foto completa de lo que sigue vivo: el que no está, pagó |
| **Desasignar** | Le pone estado de gestión *Desasignado*. **No toca deuda, pagos ni situación** | El archivo es la gestión **del día**: el que no viene hoy no pagó, simplemente no se gestiona hoy |
| **No hacer nada** | Los ignora | El archivo es **parcial** o estás probando |

> **Elegir mal acá cancela casos que no pagaron.** Si el cedente te manda un archivo parcial y
> quedaste en "marcar como pagó todo", todos los casos que no vinieron quedan cancelados — y una
> cuenta cancelada además queda **bloqueada** para el gestor.
>
> La pregunta para decidir: *¿este archivo es la foto completa de la cartera, o solo lo de hoy?*

Desasignar guarda el estado anterior, así que si el caso reaparece se puede revertir.

### 3. No crear casos nuevos

Por defecto, un registro del archivo que no matchea con ningún caso **se carga como caso nuevo**.

Tildando esta opción, los no encontrados se ignoran y solo se actualizan los existentes.

**Cuándo:** un mismo archivo cubre varias remesas y lo vas a correr una por una. Sin esto, la primera
corrida crea como casos nuevos todos los que en realidad pertenecen a las otras remesas.

### 4. Si el saldo informado es mayor al actual

Qué hacer cuando la deuda **creció**:

| Opción | Qué hace | Cuándo |
|---|---|---|
| **Generar una factura nueva** (por defecto) | Crea una factura de ajuste por la diferencia | La deuda creció por un cargo real, y querés que quede el detalle |
| **Actualizar el saldo** | Si el caso tiene una sola factura pendiente, le actualiza el importe | La deuda crece **todos los días por intereses**: sin esto se llena de facturas de ajuste |

---

## Sobre el importe original

Cuando el cedente informa más deuda, **el importe original del caso sube**. No es un número congelado:
lo que no lo toca son los pagos.

Es coherente con cómo lo ve el cedente —la deuda asignada es la que él dice— pero conviene saberlo,
porque el original es la referencia contra la que se compara todo lo demás.

---

## Qué mirar en la vista previa

1. **Cuántos casos matchean.** Si son muchos menos de los que esperabas, la remesa origen está mal.
2. **Cuántos ausentes hay.** Es el número que multiplica el riesgo de la opción 2.
3. **Los importes**, con el mismo cuidado de siempre.

---

## Qué puede salir mal

### Se cancelaron casos que no pagaron

El archivo era parcial y la opción de ausentes estaba en "marcar como pagó todo". Los casos quedan
cancelados y bloqueados.

No hay un "deshacer" para esto: las cargas de Actualizaciones **no se pueden revertir**. Se corrige
caso por caso, o pidiendo al cedente el archivo completo y volviendo a correr.

**Por eso la vista previa importa tanto acá.**

### Se crearon cientos de casos duplicados

El archivo cubría varias remesas y corriste sin tildar **No crear casos nuevos**: los registros de las
otras remesas entraron como casos nuevos.

### El caso se llenó de facturas de ajuste

La deuda crece por intereses y la opción de deuda mayor está en "generar una factura nueva". Cambiala
a **actualizar el saldo**.

### La carga no matcheó con nada

Remesa origen equivocada.

---

## Preguntas frecuentes

**¿Se puede deshacer una carga de actualizaciones?**
No hay botón de revertir. Se puede intentar borrar la remesa, pero eso **no deshace los pagos ni los
cambios de estado** que se aplicaron sobre casos de la remesa origen. Tratala como una operación sin
vuelta atrás.

**¿Los casos nuevos que descubre quedan en esta remesa?**
No: se cuelgan de la **remesa origen**, que es donde vive la cartera.

**¿Puedo correrla dos veces con el mismo archivo?**
La reconciliación está pensada para ser idempotente en el caso normal, pero las opciones sobre
ausentes no lo son necesariamente. Si tenés que repetir, andá por la vista previa y mirá el impacto
antes.
