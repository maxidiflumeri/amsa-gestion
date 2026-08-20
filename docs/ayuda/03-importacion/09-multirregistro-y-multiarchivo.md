<!--
seccion: Importación de datos
resumen: Las dos categorías para formatos complejos. Qué hacen, qué se configura en la plantilla y qué puede registrar un pago.
revisado: 2026-08-20
rutas: /plantillas, /carga
-->
# Multirregistro y Multiarchivo

## Para qué sirven

Son las dos categorías para cedentes cuyo archivo **no es una tabla**. En vez de "una fila = un caso",
la información viene repartida y hay que cruzarla.

Hoy hay dos carteras que las usan, y cada una tiene su **preset de un clic**:

| Categoría | Cartera | Cómo se llama la unidad de deuda |
|---|---|---|
| **Multirregistro** | Toyota cuenta 87 | **aviso** |
| **Multiarchivo** | Toyota TCFA | **cuota** |

---

## Multirregistro

**Un** archivo con **varios tipos de línea** mezclados. Cada línea arranca con un código:

```
CLI;0001234;PEREZ JUAN;SARMIENTO 450;...
GES;...;0001234;CONTRATO-88;...;AVISO-501
DET;AVISO-501;Días de Mora;12
DET;AVISO-501;Cargo por Pago Fuera de Termino;12030,00
BAJ;AVISO-377;15/03/2026;CANCELADO
```

- `CLI` es el cliente y sus contactos.
- `GES` es un **aviso**, que se convierte en una factura.
- `DET` es el desglose del aviso. Los conceptos son texto del cedente: *Días de Mora*, *Cargo por Pago
  Fuera de Término*, *ACR-Remanente Anticipo*.
- `BAJ` da de baja **un aviso**.

**El vínculo es en dos saltos:** `CLI` con `GES` por número de cliente, y `GES` con sus `DET` por
número de aviso.

> **La suma de los `DET` es el importe de la factura.** El total que trae el `GES` se ignora a
> propósito: manda el desglose.

> **El `BAJ` casi nunca apunta a un aviso del mismo archivo.** Sobre el paquete real, ninguna de las
> 10 bajas correspondía a un `GES` de esa misma bajada: apuntan a avisos cargados **en bajadas
> anteriores**, y el sistema los busca en toda la empresa. Por eso el ejemplo de arriba muestra un
> número distinto.

### ⚠ Solo lee UN archivo

A diferencia del resto del sistema, **Multirregistro procesa un solo archivo por carga**. Si subís
varios, se lee el primero y **los demás se ignoran sin ningún aviso**: no aparecen como error ni en el
resumen.

Si el cedente parte la bajada, hay que hacer una carga por archivo.

### Casos que se pierden (y explican diferencias de conteo)

- Un `CLI` **sin ningún `GES`** no se carga: se omite con una advertencia.
- Un `GES` **cuyo `CLI` no vino** se omite.
- Cliente repetido: gana **la primera** ficha.
- Aviso repetido: gana **el primero**.

Las advertencias quedan guardadas y se ven en el **detalle de la importación**, desde el historial. Es
la evidencia para reclamarle al cedente.

---

## Multiarchivo

**Varios archivos de formatos distintos** que se cargan juntos y se cruzan entre sí.

| Rol | ¿Obligatorio? | Qué trae |
|---|---|---|
| **Deudores** | **Sí** | Los casos |
| **Detalle de deuda** | **Sí** | Las cuotas |
| Bajas | No | Cuotas dadas de baja |
| Codeudores | No | Los codeudores del titular |

El asistente **reconoce cuál es cuál por el nombre del archivo**, con patrones declarados en la
plantilla.

> **Elegí la plantilla primero.** Sin plantilla no hay patrones y no se reconoce ningún archivo.

El cruce entre deudores y detalle es **por número de asignación, nunca por cliente**. No es un detalle
menor: joinear por cliente le infló la deuda a un caso real de $2.199.415 a **$6.878.743**.

**Los codeudores se cargan como contactos del titular**, marcados como tales, con su ficha en datos
adicionales. Sirve para saber a quién estás llamando.

### El paquete se rechaza por cuatro motivos

Todos bloqueantes, y los cuatro avisan antes de empezar:

1. **Falta un archivo obligatorio** — *"Falta el archivo de Deudores. Sin eso no se puede armar la
   cartera."*
2. Un archivo **no matchea ningún patrón**.
3. **Dos archivos para el mismo rol.**
4. Un archivo **matchea dos roles** a la vez.

---

## Ninguna de las dos pide remesa origen

Los casos nuevos entran en la remesa de esta carga, y los que ya existen se buscan **por número de
cliente en toda la empresa**.

---

## ⚠ Lo que la plantilla decide y no son posiciones de columna

La división habitual es que **el layout** (qué posición ocupa cada dato) vive en la plantilla —para
poder corregirlo sin despliegue cuando el cedente corre una columna— y **la estructura** vive en el
código.

Pero la plantilla guarda además **tres decisiones de negocio** que conviene conocer:

### 1. Qué bajas cuentan como cobro

**Una baja puede registrar un pago.** Si el motivo de la baja está en la lista de motivos de cobro
declarada en la plantilla, el sistema **crea un pago** por el importe de la factura y la marca
`PAGADA`. Si no está en esa lista, la factura se **anula**: la deuda deja de reclamarse, pero **no
entra plata**.

Es el hecho de negocio más importante de estas dos categorías. Y no es teórico: una lista mal
declarada ya provocó que **un pago de $82.706,87 se registrara como una anulación**.

### 2. Qué pasa con los ausentes

La plantilla puede declarar que todo caso que **deje de venir en el archivo** salga de gestión
(desasignado). Es lo más destructivo de la carga y el editor lo marca en rojo. Hoy las carteras
existentes lo tienen **desactivado**, pero es un interruptor que vive en la plantilla.

### 3. Codificación y encabezados

**Estos archivos vienen en Latin-1.** Si alguien los reabre y los regraba en UTF-8, se rompen las Ñ y
los acentos de los nombres.

---

## El caso sale de gestión recién cuando se le bajan todas

Dar de baja un aviso o una cuota **no da de baja el caso**. El deudor sale de gestión solo cuando se
queda **sin ninguna factura vigente**: si tenía 6 y le bajaron 2, se sigue trabajando por las otras 4.

---

## Armar la plantilla

Se editan **desde la misma pantalla de plantillas** que el resto, con el mismo formulario. Lo único
distinto es el paso de mapeo: en vez del mapeador columna→campo, hay un cuadro de configuración.

**Para las dos carteras que ya existen no hay que escribir nada.** Cada editor trae un botón —
*Restaurar layout de Toyota 87* / *Restaurar layout de Toyota TCFA* — que deja todo listo, incluido el
separador. La propia pantalla te lo dice: *"no hace falta tocar nada, solo completá el nombre y los
estados iniciales, y guardá"*.

El editor además valida en vivo: enumera qué claves faltan, muestra los tipos de línea, el encoding,
el separador, los conceptos y los motivos de baja por pago, y levanta advertencias.

**Para un cedente nuevo sí hay que escribir la configuración a mano**, y ahí conviene que lo haga
alguien técnico: hay que conocer el formato y la estructura del archivo.

---

## Qué mirar en la vista previa

Muestra el conteo por tipo: **casos, avisos o cuotas, bajas y codeudores**, más las líneas leídas de
cada tipo, las ignoradas, las cuotas descartadas por pertenecer a una asignación no vigente, los casos
sin detalle, y la lista de advertencias.

Lo que hay que mirar:

- **Que los casos sean los que esperabas.** Si faltan, mirá las líneas ignoradas.
- **Que las bajas se hayan podido aplicar.**
- **Las advertencias**, siempre.

---

## Qué puede salir mal

### "Falta el archivo de Deudores" o "de Detalle de deuda"

Son los dos obligatorios. Bajas y codeudores no lo son. Si el cedente renombró sus exports, ninguno va
a matchear: verificá los nombres contra los que venía mandando.

### Se cargaron los casos pero sin facturas (Multiarchivo)

No es que faltó el archivo de detalle —sin él la carga ni arranca—. Las causas reales son que el caso
**no trae cuotas** en el detalle, y entonces se carga con el total que declara el cedente y sin
facturas, o que sus cuotas pertenecen a **una asignación que ya no está vigente** y se descartan.

En Multirregistro esto no puede pasar: un cliente sin ningún aviso directamente no se carga.

### El import falló nombrando columnas

El cedente renombró una columna del archivo. El error dice cuáles faltan y cuáles encontró. Se corrige
en la plantilla, sin despliegue.

### Cargué varios archivos y solo entró uno (Multirregistro)

Es el comportamiento: lee un solo archivo por carga. Hacé una carga por archivo.

### Una baja no se aplicó

En Multirregistro la baja solo trae el número de aviso. Si **dos deudores de la empresa tienen ese
mismo número de factura**, no se da de baja a ninguno y hay que resolverlo a mano. En Multiarchivo no
pasa, porque la baja dice de qué cliente es.

### Los acentos salen rotos

Alguien regrabó el archivo en UTF-8. Estos vienen en Latin-1.

---

## Preguntas frecuentes

**¿Puedo armar una plantilla de estas yo mismo?**
Para Toyota 87 o TCFA, sí: aplicás el preset, completás nombre y estados iniciales y guardás. Para un
cedente nuevo hay que escribir la configuración, y eso lo hace alguien técnico.

**¿Por qué no piden remesa origen?**
Porque traen todo junto: crean los casos nuevos en su propia remesa y encuentran los existentes por
número de cliente.

**¿El filtro de filas funciona acá?**
No. Sus parsers cruzan la información antes de que exista "una fila = un registro", así que no hay
dónde aplicarlo.

**¿Dónde veo las advertencias del parseo?**
Se guardan como errores de la remesa: entrá al detalle de la importación desde el historial.
