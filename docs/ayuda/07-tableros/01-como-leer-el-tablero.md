<!--
seccion: Tableros
resumen: Qué mide cada número del tablero de remesa y cuáles se leen distinto de lo que parece.
revisado: 2026-08-21
rutas: /dashboards
rutaPrincipal: /dashboards
-->
# Cómo leer el tablero

## Para qué sirve

El tablero responde de un vistazo **cómo va una cartera**: cuánto se recuperó, dónde está trabada la
gestión y qué pesa más. Es la vista para la reunión con el cedente y para decidir dónde poner gente.

No reemplaza a los reportes. El tablero **muestra**; el reporte **lista**. Si necesitás los casos uno
por uno, eso es un reporte — ver [Armar un reporte](/ayuda/reportes/armar-un-reporte).

## Antes de empezar

- **Ver tableros** para entrar.
- **Exportar tableros a PDF/XLS** para el botón de descarga.
- **Ver historial de importaciones**, aunque no lo parezca: los selectores de empresa y de remesa se
  llenan con datos del módulo de importación. Sin ese permiso la pantalla abre con los dos combos
  vacíos y sin explicar por qué.

**Lo primero es elegir una empresa.** Sin empresa el tablero ni siquiera se calcula: vas a ver el
cartel *"Seleccioná una empresa para ver el tablero"*.

---

## ⚠ Lo primero: qué respeta el período y qué no

Es la confusión número uno del tablero, y hace que la gente vea contradicciones donde no las hay.

| Es una foto de hoy | Mira el período |
|---|---|
| Cantidad de casos | Cobrado en el período |
| Deuda asignada · Saldo pendiente | Casos con pago (período) |
| % Recupero acumulado | Ticket promedio |
| Promesas vigentes · % CPC | Mora promedio *(en parte — ver abajo)* |
| Casos sin gestión | Las dos series de abajo |
| Incobrables · En proceso legal | |
| El funnel y las cinco distribuciones | |

Así que "Deuda asignada" no cambia si movés las fechas, y "Cobrado en el período" sí. No está roto.

El **funnel** lo dice en su propio subtítulo: *"Estado actual de la cartera — no depende del período
seleccionado"*.

---

## Los indicadores de arriba

| Indicador | Qué es realmente |
|---|---|
| **Cantidad de casos** | Los casos que quedaron después de los filtros |
| **Deuda asignada** | Lo que el cedente asignó. No baja al cobrar |
| **Saldo pendiente** | Lo que falta cobrar hoy |
| **% Recupero acumulado** | Todo lo cobrado sobre lo asignado, desde siempre |
| **Cobrado en el período** | Lo cobrado dentro del rango de fechas |
| **Casos con pago (período)** | Cuántos casos pagaron algo en el rango. Un caso cuenta una vez |
| **Ticket promedio** | El pago promedio del período |
| **Mora promedio** | Días de atraso promedio. Ver abajo |
| **Promesas vigentes** | Casos cuya situación es *Promesa de pago vigente* |
| **% CPC** | Contacto con persona correcta. Ver abajo |
| **Casos sin gestión** | Casos que nadie tocó nunca: sin un solo comentario |
| **Incobrables** | Casos en situación de categoría incobrable |
| **En proceso legal** | Casos en instancia legal |

### Los dos números de deuda son distintos a propósito

**Deuda asignada** es lo que entró: no baja al cobrar. Es la referencia contra la que el cedente mide.

**Saldo pendiente** es lo que falta cobrar hoy, ya descontados los pagos. Es el que se mueve.

La diferencia entre los dos es, justamente, lo cobrado — y eso es el **% de recupero acumulado**.

> Ninguno de los dos incluye el recargo por mora: el tablero trabaja con la deuda original.
> Recalcular la mora no cambia ni un peso de acá.

### El % de CPC

Cuenta los casos cuya situación **actual** es *contactado con titular* (SIT-011) o *contactado con
tercero* (SIT-012).

Da más bajo de lo que uno espera, por dos motivos que conviene entender:

- Los otros dos códigos de contacto —*Contactado sin definición* (SIT-010) y *En negociación*
  (SIT-013)— **no suman**.
- Es el estado de hoy: **un caso que se contactó bien y avanzó a promesa o a pago deja de contar.**
  Cuanto mejor convierte el equipo, más baja el CPC.

Léelo como *"cuántos están hoy parados en contacto"*, no como *"a cuántos contactamos"*.

### Casos sin gestión

Cuenta los casos **sin un solo comentario**: nadie los trabajó todavía.

Es el número más accionable del tablero. Si son muchos y la cartera es vieja, hay trabajo sin empezar;
si son muchos y la remesa entró ayer, es normal.

### Mora promedio

Se calcula sobre la fecha de vencimiento del caso, y **deja afuera los que pagaron dentro del
período**, así que se mueve un poco con las fechas.

**Depende de un dato que muchas carteras no traen.** Si el cedente no manda fecha de vencimiento, este
indicador muestra "—" y la barra de rango de mora queda toda en *Sin fecha*. No es un error del
tablero: es que falta el dato de origen.

### Promesas vigentes

Cuenta **casos**, no promesas: dos promesas sobre el mismo caso cuentan una vez. Y el pase a
*incumplida* lo hace un proceso de madrugada, así que **una promesa que venció hoy puede seguir
contando hasta mañana**.

---

## Las distribuciones

Tres tortas —**por situación**, **por gestión** y **por motivo de no pago**— y dos barras: **rango de
mora** y **rango de deuda**.

Los cortes son fijos, no configurables:

- **Mora**: 0-30, 31-60, 61-90, 91-180, más de 180 días, y **Sin fecha**.
- **Deuda**: hasta $10k, $10k-50k, $50k-200k, $200k-1M, más de $1M.

**Se puede hacer clic** en las porciones de las tres tortas y en las barras de mora y de deuda: se abre
el detalle con los casos que las componen. Dos excepciones: la porción **"Otros"** no abre nada, y las
barras del funnel tampoco.

> Cada torta muestra los **seis valores más grandes** y mete todo el resto en "Otros". Si un código
> que existe no aparece, está ahí adentro.

El detalle viene **paginado de a 25** (se puede subir a 50 o 100), y cada caso abre su ficha **en una
pestaña nueva**. Es la forma rápida de pasar de "el 30% son negativa de pago" a ver quiénes son.

El de **motivo de no pago** es el que más sirve para hablar con el cedente: es la explicación que dio
la gente. Pero solo cuenta los casos donde **alguien cargó el motivo** — si el equipo no lo completa,
la torta queda casi entera en "sin asignar" y el gráfico no dice nada.

---

## El funnel de gestión

Cuatro barras, **cada una contenida en la anterior**: **Asignados**, **Contactados**, **Con promesa**,
**Promesa cumplida**. Siempre van de mayor a menor, así que la caída entre dos escalones se puede leer
como lo que es: gente que se perdió en el camino.

| Escalón | Qué cuenta |
|---|---|
| **Asignados** | Todos los casos del filtro |
| **Contactados** | Los que tienen evidencia de contacto: situación de contacto, o alguna promesa, o algún pago |
| **Con promesa** | Los que prometieron pagar alguna vez |
| **Promesa cumplida** | De los que prometieron, los que además pagaron |

Dónde se pierde la cobranza:

- **Asignados → Contactados** flojo: problema de **datos de contacto**, no de gestión. Se ataca con una
  importación de enriquecimiento, no con más llamadas. Ver
  [Las categorías de importación](/ayuda/importacion/categorias).
- **Contactados → Con promesa** flojo: se llega a la gente pero no se cierra. Es entrenamiento, o una
  política que no da margen.
- **Con promesa → Promesa cumplida** flojo: prometen y no pagan. Ahí sirve el seguimiento de promesas
  vencidas. Ver [Pagos y promesas](/ayuda/gestion/pagos-y-promesas).

> **Quien pagó sin prometer no aparece en el último escalón** — el funnel mide el camino de la
> gestión. Ese caso está en *Casos con pago*, arriba.

> **"Contactados" subestima.** No hay histórico de cambios de situación, así que un caso que se
> contactó y después se marcó incobrable, sin promesa ni pago, no cuenta. Es una limitación del dato,
> no un error de cálculo.

Los porcentajes de cada barra son sobre **Asignados**, no sobre la barra anterior.

---

## Las series y los tops

- **Pagos por día/semana/mes** — dos series: el **importe** cobrado, en área, y la **cantidad** de
  pagos, en línea, con su propio eje a la derecha. Sirven juntas: mucho importe con pocos pagos es una
  cobranza concentrada en pocos casos.
- **Gestiones por día/semana/mes** — el volumen de trabajo, para cruzar contra los pagos.
- **Top motivos de no pago** — los mismos datos de la torta, con el porcentaje al lado.
- **Top 10 deudores por monto** — dónde está concentrada la plata. En muchas carteras un puñado de
  casos explica una parte enorme del total.

---

## Qué puede salir mal

### El tablero está vacío

Lo más común: **no hay empresa elegida**. Sin empresa el tablero no se calcula. Ojo con el botón
*Limpiar*, que puede dejarla sin seleccionar.

Después: filtros de estado que no aplican a esa cartera, o demasiados filtros combinados.

### Los números no coinciden con un reporte

Casi siempre es el período, o que estás comparando **saldo pendiente** contra **deuda asignada**.
Fijate cuál de los dos números es de cartera y cuál de actividad.

### El % de CPC da mucho más bajo de lo que sabemos

Los casos que avanzaron a promesa o a pago dejaron de contar, y dos de los cuatro códigos de contacto
no suman.

### El motivo de no pago está casi todo vacío

No es del tablero: el equipo no está cargando el motivo en la ficha.

### La barra de mora está toda en "Sin fecha"

La cartera no trae fecha de vencimiento. Sin ese dato, ese widget y el indicador de mora promedio no
pueden calcular nada.

### El recupero bajó y nadie trabajó distinto

Entró una remesa nueva: el denominador creció. El recargo por mora, en cambio, no lo afecta.

### El saldo pendiente no baja aunque se cobre

El saldo lo escribe la consolidación por pagos. Si los pagos se cargaron pero no se consolidaron, el
saldo sigue en el monto original.

---

## Preguntas frecuentes

**¿Se actualiza solo?**
Se calcula cada vez que entrás o cambiás un filtro, sin caché. Hay un botón **Refrescar** para forzarlo.

**¿Puedo guardar un tablero con mis filtros?**
Todavía no. El tablero es uno solo y los filtros se eligen cada vez.

**¿Puedo ver varias carteras juntas?**
Podés ver **todas las remesas de una empresa** dejando *Remesa* en "Todas las remesas". Empresas, de a
una: el tablero siempre se calcula sobre una.

**¿Por qué el período por defecto son 30 días?**
Es el arranque del tablero. Se cambia con los campos Desde y Hasta.
