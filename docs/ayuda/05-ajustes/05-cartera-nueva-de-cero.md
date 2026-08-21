<!--
seccion: Ajustes
resumen: La checklist completa para dejar una cartera nueva lista para trabajar.
revisado: 2026-08-20
rutas:
-->
# Poner una cartera nueva de cero

## Para qué sirve

Llega un cedente nuevo, o una cartera nueva de uno que ya está. Esta es la secuencia completa, en
orden, con lo que hay que tener a mano en cada paso.

El orden **importa**: cada paso necesita el anterior. Saltearse uno se nota tarde y mal — el más
clásico es querer armar la plantilla de importación antes de asignar los parámetros, y quedarse
trabado sin entender por qué.

## Antes de empezar

Del cedente hacen falta cuatro cosas. Si falta alguna, conseguila **antes** de arrancar:

- **Un archivo de muestra** de la cartera. Idealmente el real, no uno inventado.
- **Qué significa cada columna.** Sobre todo cuál identifica al deudor y cuál es el importe.
- **Las condiciones comerciales**: cuotas, quitas, medios de pago.
- **Si actualiza la deuda por mora**, y con qué tasa.

---

## Paso 1 — Crear la empresa

**Ajustes → Empresas.** Nombre, CUIT, el máximo de días para promesas y, si la cartera va a mandar
mails, la cuenta SMTP.

Si el cedente ya tiene otras carteras, **nombrala de forma que no se confunda con las demás**: el
nombre es lo único que las distingue en todos los selectores del sistema.

Ver [Empresas](/ayuda/ajustes/empresas).

## Paso 2 — Asignarle los parámetros

**Ajustes → Parámetros → Asignación por empresa.**

**Este paso es bloqueante.** Sin códigos de situación y de gestión asignados no vas a poder guardar la
plantilla del paso 4: el formulario pide un estado inicial y las listas están vacías. (Las plantillas
de **acciones masivas** son la excepción: esas no piden estado inicial.)

Lo práctico es asignarle **el catálogo completo** y sacarle después lo que sobre. Asignar de a uno
manda un pedido por código, así que tarda: dejalo terminar y verificá.

> El tilde **"Global (todas las empresas)"** del formulario de un código **no hace nada**. Si creás un
> código nuevo, asignalo igual desde esta solapa o no lo va a ver ninguna cartera.

Ver [Parámetros](/ayuda/ajustes/parametros).

## Paso 3 — Cargar la política

**Ajustes → Políticas.** Lo que el cedente autoriza a ofrecer.

Se puede dejar para después, pero conviene tenerla antes de que el primer gestor atienda una llamada.
Acordate de que **asociarla se hace desde el historial de importaciones**, no desde acá.

Ver [Políticas](/ayuda/ajustes/politicas).

## Paso 4 — Armar la plantilla de importación

**Importación de Datos → Plantillas.** Es el paso largo: hay que decidir la categoría, mapear cada
columna del archivo del cedente contra los campos del sistema y elegir los estados iniciales.

Si ya existe una plantilla para un archivo con el mismo formato, **no la rehagas a mano**: usá
**Clonar** desde el listado y elegí la empresa destino. Se lleva el mapeo entero; lo único que hay que
volver a elegir son los estados iniciales, porque son parámetros de la empresa.

Acá se paga tener el archivo de muestra real. Ver
[Crear una plantilla](/ayuda/importacion/crear-plantilla).

## Paso 5 — Importar una muestra chica

El asistente ya valida el archivo completo antes de importar y te muestra las primeras 50 filas ya
mapeadas, con la cuenta de filas con error. **Usalo**, es la primera red.

Pero no alcanza: la vista previa no te deja abrir una ficha y mirar cómo quedaron los contactos. Así
que **no arranques con el archivo completo**. Cortá las primeras 20 o 50 filas, importá eso, y después
abrí tres o cuatro casos y verificá:

- Que el **nombre y el documento** estén donde corresponde.
- Que los **importes** tengan la magnitud correcta. El error clásico es de mil: `145.320` interpretado
  como 145,32.
- Que las **fechas** sean las del archivo y no otro mes.
- Que los **teléfonos** hayan quedado usables.

Si algo está mal, se corrige la plantilla y se vuelve a probar. Con 20 casos es barato; con 40.000 no.

## Paso 6 — Cargar las tasas de mora, si corresponde

Solo si el cedente actualiza la deuda. **Ajustes → Recargo por mora.**

> ⚠ **Hoy esto no se puede hacer desde la pantalla en una cartera nueva.** El sistema exige que ya
> exista el índice del día anterior, y una cartera que arranca de cero no tiene ninguno. Las carteras
> que funcionan hoy tienen el índice cargado por migración. Si la cartera nueva necesita recargos, hay
> que escalarlo a sistemas.

Ver [Recargo por mora](/ayuda/ajustes/recargo-por-mora).

## Paso 7 — Importar la cartera completa

Con la plantilla ya validada. Ver
[Importar un archivo](/ayuda/importacion/importar-un-archivo).

## Paso 8 — Darle acceso a la gente

**Administración → Usuarios**, y verificar que los gestores tengan un rol con los permisos que
necesitan.

Recordá que los permisos **se aplican recién en el próximo login**. Ver
[Roles y permisos](/ayuda/administracion/roles-y-permisos).

---

## La checklist, corta

| | Paso | Bloquea a… |
|---|---|---|
| 1 | Crear la empresa | todo |
| 2 | Asignar parámetros | la plantilla |
| 3 | Cargar la política | nada, pero el gestor la necesita |
| 4 | Armar la plantilla | la importación |
| 5 | Importar una muestra chica | — |
| 6 | Cargar tasas de mora *(si aplica)* | la deuda actualizada |
| 7 | Importar la cartera completa | — |
| 8 | Revisar roles y accesos | que la gente trabaje |

---

## Qué puede salir mal

### No me deja guardar la plantilla

Falta el paso 2. Es el tropiezo más frecuente de todos.

### Importé y los importes están mil veces más chicos

El sistema deduce el separador decimal mirando cuál aparece último en el número, y **no hay forma de
forzarlo desde la plantilla**. Si el archivo trae `145.320` como ciento cuarenta y cinco mil, se lee
como 145,32 y no hay ningún ajuste que lo arregle: hay que pedirle al cedente el archivo con otro
formato de importe, o escalarlo a sistemas.

Por eso el paso 5 existe. Detectarlo con 20 filas es una molestia; detectarlo con la cartera entera
cargada es un problema.

### Importé la cartera completa en la empresa equivocada

Se elimina la remesa desde el historial de importaciones y se vuelve a cargar en la correcta.

**Pero no siempre se puede**: si algún caso de esa remesa ya tiene comentarios, convenios, pagos,
llamadas o mails enviados, el borrado se rechaza. Por eso conviene resolverlo rápido, antes de que
alguien empiece a gestionar — y que los nombres de las carteras no se parezcan.

### La deuda actualizada no aparece

O el cedente no tiene régimen de recargos —y entonces está bien—, o faltan tasas, o falta recalcular.

---

## Preguntas frecuentes

**¿Cuánto lleva todo esto?**
La parte de configuración es rápida. Lo que lleva tiempo es la plantilla, y depende de lo prolijo que
sea el archivo del cedente.

**¿Puedo saltear la muestra chica e importar todo de una?**
Podés, pero si la plantilla está mal vas a tener que borrar la remesa entera y rehacerlo — y si alguien
ya gestionó un caso, ni siquiera vas a poder borrarla. La muestra cuesta cinco minutos.

**¿Y si el cedente cambia el formato del archivo más adelante?**
Se edita la plantilla. La cartera y los casos ya cargados no se tocan.

**¿Puedo reusar la plantilla de otra empresa?**
Sí. Desde el listado de plantillas, **Clonar** hace una copia y te deja elegir la empresa destino; se
lleva el mapeo entero. Lo único que no viaja son los estados iniciales, porque son parámetros de la
empresa. Y si la plantilla nunca se usó, también está **Cambiar de empresa**, que la mueve en vez de
copiarla.
