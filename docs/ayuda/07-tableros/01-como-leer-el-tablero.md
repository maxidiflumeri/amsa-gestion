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
| Cantidad de casos | Pagos del período |
| Deuda total | % Recupero |
| Promesas vigentes | Casos con pago (período) |
| % CPC | Ticket promedio |
| Casos sin gestión | Mora promedio *(en parte — ver abajo)* |
| Incobrables · En proceso legal | Las dos series de abajo |
| El funnel y las cinco distribuciones | |

Así que "Deuda total" no cambia si movés las fechas, y "Pagos del período" sí. No está roto.

El **funnel** lo dice en su propio subtítulo: *"Estado actual de la cartera — no depende del período
seleccionado"*.

---

## Los indicadores de arriba

| Indicador | Qué es realmente |
|---|---|
| **Cantidad de casos** | Los casos que quedaron después de los filtros |
| **Deuda total** | La suma de la deuda **original asignada**. Ver abajo |
| **Pagos del período** | Lo cobrado dentro del rango de fechas |
| **% Recupero** | Pagos del período sobre la deuda original. Ver abajo |
| **Casos con pago (período)** | Cuántos casos pagaron algo en el rango. Un caso cuenta una vez |
| **Ticket promedio** | El pago promedio del período |
| **Mora promedio** | Días de atraso promedio. Ver abajo |
| **Promesas vigentes** | Casos cuya situación es *Promesa de pago vigente* |
| **% CPC** | Contacto con persona correcta. Ver abajo |
| **Casos sin gestión** | Casos sin código de gestión. Ver abajo |
| **Incobrables** | Casos en situación de categoría incobrable |
| **En proceso legal** | Casos en instancia legal |

### ⚠ Deuda total es la deuda original, no el saldo

Suma **lo que se asignó**, no lo que falta cobrar. **No resta los pagos** y **no suma el recargo por
mora**.

O sea: cobrás y el número no baja. Solo se mueve si entra una remesa nueva o si una importación pisa
el monto.

### El % de recupero, con cuidado

Es *pagos del período* dividido *deuda original de la cartera*. Mezcla un numerador de un mes con un
denominador de toda la vida de la cartera, así que:

- **Una cartera vieja y bien cobrada igual muestra un recupero mensual bajo.** El denominador no se
  achica nunca.
- **Baja cuando entra una remesa nueva**, aunque nadie haya trabajado peor.

Sirve para comparar el mismo tablero mes contra mes. **No** sirve como "cuánto recuperamos de esta
cartera".

Y no lo toca el recargo por mora: el tablero trabaja con la deuda original. Recalcular la mora no
cambia ni un peso de acá.

### El % de CPC

Cuenta los casos cuya situación **actual** es *contactado con titular* (SIT-011) o *contactado con
tercero* (SIT-012).

Da más bajo de lo que uno espera, por dos motivos que conviene entender:

- Los otros dos códigos de contacto —*Contactado sin definición* (SIT-010) y *En negociación*
  (SIT-013)— **no suman**.
- Es el estado de hoy: **un caso que se contactó bien y avanzó a promesa o a pago deja de contar.**
  Cuanto mejor convierte el equipo, más baja el CPC.

Léelo como *"cuántos están hoy parados en contacto"*, no como *"a cuántos contactamos"*.

### ⚠ Casos sin gestión da 0 casi siempre

Cuenta los casos que **no tienen ningún código de gestión**, y la importación le pone uno a todos: es
obligatorio en la plantilla.

Así que el número va a ser 0 para cualquier cartera cargada por el flujo normal. **Para ver el trabajo
sin empezar**, mirá en la torta de estado de gestión cuántos siguen en el código inicial — típicamente
*Gestión sin definición*.

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

Cuatro barras: **Asignados**, **Contactados**, **Con promesa**, **Con pago**.

> ### ⚠ No es un embudo
>
> Las tres primeras leen **la situación actual del caso, que es una sola**. Un caso que llegó a
> *promesa* **deja de contar en Contactados**; uno cancelado tampoco cuenta ahí.
>
> Por eso las barras **pueden no ir de mayor a menor**, y la diferencia entre dos de ellas **no es una
> "caída"**: es gente parada en otro estado. Los porcentajes, además, son sobre Asignados, no sobre la
> barra anterior.

Lo que sí se lee bien es **la primera diferencia**: cuántos casos todavía no llegaron a ningún
contacto. Si son muchos y la cartera es vieja, hay un problema de datos de contacto — eso se ataca con
una importación de enriquecimiento, no con más llamadas. Ver
[Las categorías de importación](/ayuda/importacion/categorias).

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

Casi siempre es el período, o que el reporte está mirando **saldo** y el tablero muestra **deuda
original**. Fijate cuál de los dos números es de cartera y cuál de actividad.

### El % de CPC da mucho más bajo de lo que sabemos

Los casos que avanzaron a promesa o a pago dejaron de contar, y dos de los cuatro códigos de contacto
no suman.

### El motivo de no pago está casi todo vacío

No es del tablero: el equipo no está cargando el motivo en la ficha.

### La barra de mora está toda en "Sin fecha"

La cartera no trae fecha de vencimiento. Sin ese dato, ese widget y el indicador de mora promedio no
pueden calcular nada.

### El recupero bajó y nadie trabajó distinto

Mirá el denominador: entró una remesa nueva. El recargo por mora, en cambio, no lo afecta.

### "Casos sin gestión" siempre en cero

Es lo esperado. Ver arriba.

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
