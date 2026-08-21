<!--
seccion: Ajustes
resumen: Los códigos de situación, gestión y motivo de no pago, y cómo se asignan a cada cartera.
revisado: 2026-08-20
rutas: /ajustes/parametros
rutaPrincipal: /ajustes/parametros
-->
# Parámetros

## Para qué sirve

Los parámetros son **los códigos con los que se clasifica un caso**: las situaciones, los estados de
gestión y los motivos de no pago que el gestor elige en la ficha.

Sin códigos asignados, una empresa **no se puede trabajar**: no vas a poder guardar su plantilla de
importación, y el gestor que abra un caso se va a encontrar los tres selectores vacíos.

Hoy el catálogo tiene **112 códigos** —45 de gestión, 41 de situación y 26 de motivo de no pago— y
todas las carteras existentes los tienen asignados completos.

## Antes de empezar

- **Ver parámetros** para entrar.
- **Crear parámetros** para agregar códigos al catálogo.
- **Editar parámetros** para la solapa de asignación por empresa — que es la que más se usa. Con solo
  *Crear* no alcanza.

---

## Los tres grupos

| Grupo | Qué clasifica |
|---|---|
| **Situación** | Dónde está parado el caso y su deuda |
| **Gestión** | Dónde está el trabajo sobre ese caso |
| **Motivo de no pago** | Por qué no paga, cuando lo dijo |

Dentro de cada grupo los códigos se agrupan por **categoría**, que es lo que ordena la pantalla: en
gestión hay contacto, sin contacto, dato incorrecto, promesa, pago, convenio, negativa, reclamo,
derivación y administrativos.

Cada código tiene una **clave** (`SIT-050`, `GES-094`) y una **descripción**, que es lo que ve el
gestor.

> **La clave es lo que usa el sistema, no la descripción.** Las acciones masivas que setean un estado
> desde una columna del archivo buscan **por clave exacta**. Si el archivo trae la descripción, o una
> clave que no existe, esa operación **se saltea sin avisar** — y la fila no cuenta como error: el
> resumen de la importación va a decir que salió todo bien.

---

## Las dos solapas

### Catálogo de códigos

Todos los códigos que existen, con su grupo, categoría, clave y descripción. Acá se crean, editan y
eliminan.

Al crear uno hay dos campos que conviene entender:

- **Activo** — un código inactivo deja de ofrecerse en los selectores.
- **Global (todas las empresas)** — ⚠ **este tilde hoy no hace nada.** Se guarda, pero ningún proceso
  lo lee: la visibilidad depende exclusivamente de la asignación por empresa. Un código creado como
  "global" y no asignado **no aparece en ninguna cartera**. No te fíes de él: asignalo igual.

### Asignación por empresa

**Qué códigos ve cada cartera.** Se elige una empresa y se marcan los que le corresponden.

> **Guardar acá tarda.** El sistema manda un par de pedidos por cada código que cambiaste — para una
> empresa nueva con el catálogo completo son varios cientos, uno atrás del otro. Esperá a que termine y
> verificá después: si se corta a la mitad, queda a medias.

> **No lo hagan dos personas a la vez sobre la misma cartera.** Si dos admins guardan asignaciones al
> mismo tiempo, el segundo pisa lo que hizo el primero.

---

## Códigos que el sistema necesita

Algunos códigos no son decorativos: **hay procesos que los buscan por clave**.

| Clave | Quién la usa |
|---|---|
| **SIT-050** — Cancelado / Pagado | La consolidación, cuando el caso se da por saldado |
| **SIT-041** — Pago parcial | La consolidación, cuando entró algo pero no todo |
| **SIT-020** — Promesa de pago vigente | Al cargar una promesa |
| **SIT-021** — Promesa incumplida | Cuando la promesa vence |
| **GES-094** — Desasignado | Las importaciones de actualizaciones |

> **Los busca en el catálogo global, por clave** — no importa a qué empresa estén asignados. Lo que los
> rompe no es desasignarlos de una cartera: es **borrarlos del catálogo o cambiarles la clave**.

### Si falta uno, cada uno falla distinto

- **SIT-050 y SIT-041** — el backend **no arranca**. Es imposible no darse cuenta.
- **SIT-020** — al cargar una promesa el gestor recibe *"El código SIT-020 no está configurado; no se
  pueden cargar promesas."*
- **SIT-021 y GES-094** — acá sí es silencioso. Las promesas vencidas no pasan a incumplidas, o la
  importación termina "finalizada" sin desasignar a nadie. Solo queda un aviso en el registro técnico.

### Y SIT-050 hace algo más

Un caso en *Cancelado / Pagado* **queda bloqueado**: no acepta comentarios, ni convenios, ni cambios de
gestión o de motivo, ni promesas, ni resultados de llamada. Es la consecuencia más grande de toda esta
tabla. Ver [Comentarios y estados](/ayuda/gestion/comentarios-y-estados).

La cancelación además **no espera al saldo exacto en cero**: alcanza con que lo pagado llegue al 99%
del monto original. Un caso con $99 pagados de $100 queda cancelado, no en pago parcial. La tolerancia
es configurable.

---

## Qué puede salir mal

### No puedo guardar una plantilla de importación

Esa empresa no tiene códigos de situación o gestión asignados, así que las listas de estado inicial
están vacías. Es lo primero que hay que revisar en una empresa nueva.

Las plantillas de **acciones masivas** son la excepción: esas no piden estado inicial y se guardan
igual. Ver [Crear una plantilla](/ayuda/importacion/crear-plantilla).

### El gestor abre un caso y los tres selectores están vacíos

Misma causa: la empresa no tiene códigos asignados de ese grupo. El caso se puede ver pero no se puede
clasificar.

### El selector muestra la lista pero el campo está en blanco

Distinto problema: el caso **tiene** un código, pero ese código se desactivó o se desasignó de la
empresa, y por eso no se puede mostrar. Ojo, porque si el gestor guarda cualquier otro cambio, **pierde
el valor que había**.

### Una acción masiva no aplicó el estado y no dio error

El archivo trae la descripción en vez de la clave, o una clave que no existe. Se saltea en silencio y
la importación informa que salió bien.

### La importación no desasignó a nadie

Casi siempre **no es por los códigos**: es que ninguna fila del archivo matcheó un caso de la cartera
—mapeo mal, separador equivocado, empresa equivocada— y el sistema **aborta la desasignación a
propósito**, para no vaciar la cartera entera.

Esa protección existe por un incidente real: una importación así llegó a desasignar 342.792 casos.
Revisá el mapeo antes que los códigos. Ver
[Actualizaciones](/ayuda/importacion/actualizaciones).

### Cambié la descripción de un código y se cambió en todas las carteras

El catálogo es global y la descripción es única: no hay forma de que una cartera vea otro nombre.

---

## Preguntas frecuentes

**¿Puedo borrar un código que ya se usó?**
**Desactivalo, no lo borres.** Borrarlo no oculta el dato: **lo pierde**. Todos los casos que lo tenían
quedan con el campo vacío, y volver a crear el código con la misma clave no los recupera. Lo mismo con
las plantillas que lo tuvieran como estado inicial: quedan sin estado, en silencio.

**¿Cada cedente puede tener sus propios códigos?**
Puede tener su propia **selección**: se le asignan los que le corresponden. El catálogo, en cambio, es
uno solo para todos.

**¿Qué pasa si dos empresas necesitan el mismo concepto con distinto nombre?**
Hoy no hay forma de renombrar un código por cartera. Si de verdad hacen falta dos nombres, hay que
crear dos códigos con claves distintas y asignarle uno a cada empresa.

**¿La clave se puede cambiar?**
Evitalo. Hay procesos que buscan por clave exacta y se romperían en silencio.
