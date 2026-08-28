# AMSA Gestión — Changelog de Desarrollo

> Este archivo es el registro de contexto principal para que una IA pueda retomar el trabajo.
> Stack: NestJS + Prisma + MySQL (backend) · React + MUI v5 + TypeScript (frontend)
> Convención DB: `npx prisma db push` (NO `prisma migrate dev` — hay drift histórico)

---

## [2026-08-28] — Telecom y Personal: las cuentas que no entraban y los pagos que no se podían subir

Barrida sobre lo que salió de las pruebas de las carteras de telefonía. Los archivos de referencia
son el `CA_20260527_1008_POSBAJA` (19.538 filas) y los de cobros y notas de crédito de Prebaja Fan.

### Lo que perdía casos en silencio

- **Un DNI con varias cuentas cargaba una sola.** La identidad del caso era la clave única
  `(empresaId, documento, remesaId)`, así que la segunda y la tercera fila de un mismo documento no
  creaban nada: hacían `update` sobre la primera y ganaba la última del archivo. En Telecom y
  Personal el titular tiene la cuenta madre (`…0001`) y las hijas (`…0002`, `…0003`), cada una con
  su deuda. Sobre el CA del 27/05 se perdían **119 de 19.439 cuentas**, y después **todas** sus
  facturas y sus pagos fallaban con "Deudor no encontrado" —el archivo de cobros viene justamente
  por cuenta. Ya se ve en producción: la remesa 47 de Telecom tiene 1.672 filas en error.

  Ahora lo decide la plantilla (`identidadDeudor`: `DOCUMENTO` por defecto, `NRO_CLIENTE` para
  telefonía) y lo resuelve `utils/identidad-deudor.ts` con un SELECT explícito, igual que hacen
  MULTIRREGISTRO y MULTIARCHIVO desde siempre. Se retiró la clave única del schema: la protección
  pasó a estar en el código, que es donde puede depender de la cartera.

- **La pérdida era invisible.** El archivo entraba "sin errores" y el problema aparecía días
  después. La vista previa ahora cuenta las cuentas y las personas del archivo y avisa cuántos casos
  van a colapsar antes de ejecutar nada.

### Lo que no se podía subir

- **`Internal server error` al cargar el archivo de pagos de Personal.** El archivo manda
  `PAYMENT_METHOD_DES` en dos columnas, y con `headers: true` fast-csv corta con `Duplicate headers
  found`; la excepción subía sin capturar hasta el controller. Las remesas 112 y 113 quedaron en
  PENDIENTE con 0 filas el 26/08 por esto. El pipeline mapea **por índice** y nunca usa los nombres
  de columna, así que ahora el encabezado se saltea con `skipRows` en vez de interpretarse. Cualquier
  otro error de formato sale como 400 con el nombre del archivo y el motivo, no como un 500 opaco.

### Lo que guardaba números y fechas equivocados

- **El importe del pago llegaba como texto.** `removeDashes` hacía `String(...)`, así que el orden
  `toNumber` → `removeDashes` —el de las plantillas 48 y 49— devolvía `"68062.52"` y Prisma mataba la
  fila con `Expected Float, provided String` (3 de las 12 filas de la remesa 114). Ahora
  `removeDashes` sobre un número devuelve su valor absoluto **como número**, y el processor coerce el
  importe igual, sin confiar en el orden de los transforms. Una fila con un importe ilegible se
  rechaza con un mensaje que se entiende.

- **Las fechas en castellano caían en 2001.** `toDate:auto` cortaba en el primer espacio antes de
  parsear, así que de `3 ago 2026` quedaba `3` — y `dayjs('3')` devuelve el 1 de marzo de 2001. Lo
  que no parseaba quedaba en null y el pago se fechaba **el día de la carga**, que además rompía el
  anti-duplicados. Ahora se reconocen `D MMM YYYY` y `D MMMM YYYY` con el locale `es`, se descarta
  solo la hora final, y el parseo flexible pide que el valor **parezca** una fecha antes de aceptarlo.
  Medido sobre el archivo real: de 5.438 cobros, 0 fechas nulas y 0 en 2001.

- **Un pago negativo aumenta la deuda.** El saldo es `montoTotal − Σpagos`, así que las 2.767 notas
  de crédito de Prebaja Fan —todas en negativo— la subían en vez de bajarla. No se corrige solo (un
  negativo puede ser la contracara de un cobro dado de baja): la vista previa avisa y el worker lo
  loguea. El arreglo es agregar `removeDashes` al mapeo, que ahora funciona en cualquier orden.

### Archivos acumulativos

- **`pago.idExterno`**, único por `(deudorId, idExterno)`. Es el `PAYMENT_ID` que mandan Telecom y
  Personal: mientras esté mapeado, un archivo acumulativo se puede recargar cuantas veces haga falta
  sin duplicar nada y sin depender de que la fecha y el importe coincidan. El criterio viejo —mismo
  caso, mismo día, mismo importe— queda de fallback para los cedentes que no mandan identificador.

### Un archivo con varias asignaciones adentro

Telecom y Personal se bajan de Deimos filtrando **solo por día**: si ese día hubo cuatro
asignaciones, el CA y el MA llegan con las cuatro. El del 27/05 trae 5 nóminas y 4 gestiones.

- **`mappingJson.divisionRemesa`** declara las columnas de nómina y de gestión. Al cargar, el
  operador ve una tabla con los casos de cada corte —la 3082 da 13.948, exactamente lo que informó el
  cedente por mail—, confirma los números y se crean N remesas **sobre el mismo archivo**, que se
  guarda una sola vez.
- El número se propone solo: por nómina avanza el correlativo, y la gestión le antepone su primer
  dígito (`3GH` sobre la `100` → `30100`). `3G` y `3GH` comparten dígito, así que ahí sale repetido y
  hay que corregir a mano: la pantalla lo marca y el backend lo rechaza.
- La implementación es deliberadamente chica: **dividir es crear N remesas con un filtro de filas
  extra**. Campo `remesa.filtroFilas`, que el runner suma a los de la plantilla, y se reusa
  `filtro-filas.ts` entero. Las remesas se importan una atrás de la otra.

### El combo de remesas y el link de la factura

- **El selector de "vincular a remesa de deudores" listaba todo**: las remesas de facturas, de pagos
  y de acciones incluidas. El backend ya sabía filtrar (`conDeudores`) y el frontend no lo usaba. Se
  agregó además `enGestion` —remesas con al menos un caso ni cancelado ni desasignado—, que viene
  activado, y **Seleccionar todas** / **Limpiar**. Es la diferencia entre elegir de 10 y elegir de
  100.
- **`factura.urlComprobante`**: el link al comprobante en el portal del cedente. Mapeable desde la
  plantilla, se muestra como número de factura clickeable en la ficha y abre una pestaña nueva. Solo
  se guardan URLs `http`/`https` —un `NI` no se renderiza como link— y una bajada sin link no borra
  el que ya estaba.

### Migración

`prisma db push` (la corre el CI/CD). Cambia el schema en cinco lugares: se **retira** el unique
`Deudor_empresaId_documento_remesaId_key` y se agrega un índice equivalente no único; `pago.idExterno`
con su unique; `factura.urlComprobante`; `remesa.filtroFilas` y `remesa.divisionValores`.

Las plantillas de Telecom y Personal hay que editarlas a mano después del deploy: identidad por
**Nº de cliente** en las de deudores, `PAYMENT_ID` → **ID del cobro** en las de pagos, `removeDashes`
en el importe de la de ajustes, y las columnas de nómina y gestión en las que se dividen.

---

## [2026-08-21] — La pantalla de la Toolbar mostraba una sola solapa

**Reportado mirando la pantalla real:** dentro de la Toolbar de Neotel solo se veía el contenido de
*Datos del deudor*. Las solapas **Lista de deudores**, **Política** y **Timeline** no aparecían.

### Frontend

- `TelefoniaCaso` renderizaba `FichaDeudor` **directamente**, salteándose el `TabsPanel` que arma las
  cuatro solapas. La ficha es la solapa 0: por eso se veía justo eso y nada más. Ahora monta el mismo
  `TabsPanel` que usa la pantalla de Gestión, así que el operador tiene Política (qué puede ofrecer) y
  Timeline (qué se le mandó antes) con la persona en línea, que es cuando hacen falta.
- El `BuscadorAvanzadoModal` que tenía `TelefoniaCaso` se sacó: `TabsPanel` ya renderiza el suyo. Para
  no perder el refresco del chip *"En llamada — Apellido, Nombre"*, la selección pasa por un único
  `seleccionarDeudor()` que se le pasa como `setSelectedDeudorId`. Con eso el nombre también se
  actualiza al elegir una fila desde *Lista de deudores*, cosa que antes no existía.
- El panel se monta aunque el caso **no** se haya resuelto: con `deudorId` en null la solapa de datos
  queda vacía —el cartel de arriba ya explica por qué— pero el operador puede ir a *Lista de deudores*
  y encontrarlo a mano sin salir de la Toolbar.
- Cada llamada nueva vuelve a la solapa 0. Si no, el screen pop del caso siguiente abría en la solapa
  donde había quedado el anterior.

### Documentación

Tres páginas describían la limitación como si fuera el comportamiento esperado, e incluso daban
rodeos para compensarla (*"abrí la política en otra pestaña antes de arrancar el turno"*). Se
corrigieron: la sección *"Lo que NO vas a tener durante la llamada"* pasó a ser *"Qué ves durante la
llamada"* con una tabla de las cuatro solapas, y `04-linea-de-tiempo.md` ahora responde también a la
ruta `/telefonia`.

---

## [2026-08-21] — Se cerró el backlog de la auditoría: 87 de 89 hallazgos

Barrida completa de `docs/ayuda-spec.md` §7, módulo por módulo. Lo que sigue son los cambios que no
son evidentes del diff, agrupados por lo que hacían mal.

### Lo que borraba o corrompía datos sin avisar

- **La rama PAGO_TODO de Actualizaciones no tenía el guard de DESASIGNAR.** Si ninguna fila del
  archivo matchea la cartera, todos los deudores quedan "ausentes" y esa rama los marca como que
  pagaron todo: **cancela la cartera entera**. Es la versión cara del bug que desasignó 342.792
  deudores de Toyota — ahí se perdía la asignación, acá se perdería la deuda.
- **Borrar un usuario funcionaba** y huerfanaba comentarios, pagos, promesas y auditoría a "Sistema".
- **Borrar una empresa** llamaba a `delete` en seco: 500 opaco con FK RESTRICT, o cascada silenciosa
  que se llevaba tasas de mora e historial de emails.
- **Un comentario sin autor lo podía borrar cualquiera** con el permiso de "eliminar propios": no es
  de nadie, así que tampoco es propio — lo dejó una acción masiva o una importación.
- **`empresa_parametro.nombreOverride` y `.activo` se destruían en cada guardado**, porque la
  asignación era `deleteMany` + `createMany` y recreaba en cero hasta lo que no cambiaba.
- **Lost update en la asignación de parámetros**: read-modify-write sobre la lista completa de
  empresas de cada código. Dos admins en carteras distintas se pisaban. Ahora hay un endpoint por par
  (parámetro, empresa) y una sola llamada por código.

### Lo que mostraba o mandaba números equivocados

- **Pagar una cuota de convenio no disparaba la consolidación**: el saldo del caso no bajaba, así que
  un convenio pagado entero dejaba la cuenta como si no se hubiera cobrado nada. Y el importe era
  editable sin validar: una cuota de $50.000 se saldaba con $100.
- **Filtrar por un dato adicional reventaba la ejecución.** `camposAdicionales.x` no es una relación
  sino una clave en una columna JSON; Prisma la filtra con `{ path, equals }`. Los 7 operadores
  soportados se probaron contra la base real.
- **Los rangos de fecha perdían el último día** en reportes y en auditoría: `'YYYY-MM-DD'` es
  medianoche UTC, o sea las 21:00 del día anterior. Los helpers salieron a
  `common/utils/dia-local.ts` y ahora los usan los tres lugares donde apareció el mismo error.
- **"Mora promedio" mezclaba relojes**: excluía por pagos del período dentro de una métrica que por lo
  demás es foto de hoy. Ahora el corte es el saldo.

### Lo que prometía algo que no pasaba

- **15 de los 112 códigos de parámetro no se podían asignar a ninguna empresa**: la solapa iteraba
  sobre una lista de categorías hardcodeada a la que le faltaban cinco. Ahora se calculan de los
  códigos cargados.
- **El check "Global (todas las empresas)" no hacía nada**: se persistía y ningún filtro lo leía, así
  que un código creado como global no aparecía en ninguna cartera. Se retiró.
- **El switch de salto de página en PDF** se guardaba y no lo leía nadie. En pdfmake el `pageBreak` va
  en un nodo de contenido, no en una fila, así que las filas se parten en una tabla por corte.
  Verificado contando páginas del PDF: 3 grupos con salto → 3 páginas.
- **El builder no tenía UI de ordenamiento**, aunque el motor lo soporta: las plantillas se guardaban
  con `ordenamientos: []`.
- **Las `REPORTES_V2_*` de `.env.example` no las leía nadie** — y el `.env` real tenía las cinco con
  el prefijo viejo, así que esa configuración nunca tuvo efecto. **Hay que corregirlo en producción.**
- **`deudores.exportar`** estaba declarado sin endpoint ni botón: se retiró.

### Lo que no se podía deshacer

- **El motivo de no pago no se podía quitar**: `''` y `undefined` caían en la misma rama.
- **El DNI era de solo escritura**: `USUARIO_SELECT` no lo devolvía y el update ignoraba el vacío.
- **El email no era editable** después del alta, siendo la credencial de login.
- **No había forma de marcar un mail como rebotado**: `contacto.validado` solo lo escribía la UI de
  teléfonos.

### Lo que no dejaba rastro

- **El cron nocturno de promesas vencidas no auditaba nada**: el `@Audit` estaba en el controller, así
  que solo dejaba rastro el disparo manual.
- **Los cambios automáticos no se podían rastrear desde el caso.** Ahora la consolidación deja un
  registro **por caso** para las cancelaciones, que es la pregunta que más se hace.
- **Exportar la auditoría** —la acción que se lleva datos afuera— no quedaba auditada, y **el logout**
  tampoco: el endpoint existía y no lo llamaba nadie.
- **`updateEstadosCuotas()` no tenía caller**: el estado VENCIDA no lo escribía nadie. Cron a las 3 AM.
- **No había ningún proceso que recalculara la mora**, así que el indicador naranja de la ficha (48 h)
  estaba encendido de forma permanente. Cron a las 4 AM.

### Seguridad y permisos

- **Fuga en el gráfico de 30 días de Auditoría**: el `$queryRaw` ignoraba el `where`, así que quien
  solo tiene `auditoria.ver` veía el volumen de todo el sistema.
- **El catálogo de permisos estaba en tres copias** (63/59/48). El seed tenía la suya inline y le
  faltaban `mora.*`, `auditoria.*`, `dashboards.*` y `email.*`: **el rol ADMIN recién sembrado no
  tenía todos los permisos**. Ahora importa el catálogo; ADMIN pasó de 48 a 61.
- **Los 4 permisos de telefonía no se podían otorgar** desde Roles. Ya están, y el test de sincronía
  quedó sin excepciones.
- **Los endpoints del panel de Neotel pedían `telefonia.usar`** y no son de solo lectura: desloguean
  al agente, lo pausan y lo mueven de campaña. Pasan a `telefonia.admin`.
- **El bloqueo por cuenta cancelada miraba solo SIT-050**: un caso en "Cancelado antes de la gestión",
  "a liquidar" o "a monto histórico" se seguía pudiendo gestionar. Ahora bloquea la categoría entera.
- **`deudores.editar_estado` no se consultaba en el frontend**, y **Parámetros y Políticas** tampoco
  ocultaban acciones: el 403 llegaba al confirmar.
- **`DeudoresPage` tenía el usuario hardcodeado** (`{ nombre: 'Maxi', rol: 'admin' }`) y de él
  dependía el gate de las solapas. Se sacó: quien llega ya tiene `deudores.ver`.

### Los que se veían como un error del usuario

- **Buscar por teléfono no encontraba nada**: los contactos se guardan en E.164 y se comparaba contra
  el texto tipeado. Ahora se prueban lo tipeado, solo los dígitos y el E.164 normalizado.
- **La búsqueda avanzada cortaba en 50 en silencio.** Devuelve el total y avisa.
- **`buscar()` de auditoría no tenía catch**: un 403 dejaba la pantalla en blanco, indistinguible de
  "sin resultados". Y **exportar usaba los filtros del formulario**, no los de la última búsqueda.
- **El botón de eliminar rol se deshabilitaba sin explicación**, y el mensaje bueno del backend era
  inalcanzable justamente porque nunca se llegaba a llamarlo.
- **Un separador mal configurado en telefonía** hacía que el sistema se cayera a la CLAVE de Neotel y
  abriera la ficha de un tercero. Ahora, si DATA vino y no se pudo leer, lo dice y no abre nada.
- **`MAX_CANDIDATOS = 4` truncaba en silencio**: ahora informa cuántos quedaron sin probar.
- **La previsualización del email usaba otra regla que Sender**: `{{ nombre }}` con espacios se veía
  mal y salía bien; `{{monto-total}}` se veía bien y salía con el `{{}}` literal.
- **Pasar de 10 adjuntos descartaba los sobrantes en silencio**, y no había tope de tamaño total.
- **`GET /api/politicas` sin `empresaId` respondía 400** por un `ParseIntPipe` sin `optional`.
- **Los comentarios de procesos se veían como "Usuario"**, indistinguibles de uno escrito a mano.
- **No había botón para borrar un comentario propio**, aunque el endpoint y el permiso existían.
- **`accion_masiva_snapshot` no tenía FK a `remesa`**: borrar una remesa dejaba filas huérfanas.
- **`envio_email` era invisible**: sus endpoints no los llamaba nadie desde que Timeline reemplazó al
  tab de "emails enviados", y es la única fuente que sabe **qué valores se mandaron** en cada variable.

### La suite

Quedó **en verde por primera vez**: 821 tests, 0 fallando. Los 6 suites que fallaban desde hacía meses
eran cuatro causas distintas y **ninguna era un bug de producción** —providers faltantes en los módulos
de test, un fixture usando `{ id }` donde el JWT trae `{ sub }`, y dos tests que describían el contrato
anterior a `obligatorio`—, pero tapaban los que sí lo fueran.

### Lo que queda abierto, a propósito

Dos de los 89. El **bloque de telefonía del ABM de usuarios** sigue ahí por decisión explícita, con la
documentación avisando que no hay que completarlo. Y que **la integración con la Toolbar es de una sola
vía** no es un bug: es una limitación del modelo, y sigue sin probarse con una campaña real.

### Para el deploy — verificado contra producción

- **Los permisos retirados ya se limpiaron en prod** (2026-08-21, por SSM). El rol ADMIN tenía las dos
  claves y pasó de 63 a 61, que es lo mismo que quedó en local. Se hizo con un script equivalente y no
  con `limpiar-permisos-obsoletos.ts`, porque ese deriva las claves **del catálogo del código**: corrido
  antes del deploy no habría encontrado nada. Después del deploy conviene correrlo igual —es idempotente—
  para que quede como el camino oficial.
- `npx prisma db push` — la FK nueva de `accion_masiva_snapshot`. Lo hace el CI/CD.
- **Las `REPORTES_*` de producción ya estaban bien.** El compose define `REPORTES_STORAGE_PATH` y
  `REPORTES_RETENTION_DAYS` con los nombres correctos; lo único era un `REPORTES_V2_STORAGE_PATH`
  duplicado, que se sacó. Ojo que `SYNC_THRESHOLD`, `CHUNK_SIZE` y `HARD_LIMIT` **no se definen en
  prod**: corren con los defaults del código (5000 / 1000 / 200000).
- **La clave de Neotel nunca llegó a filtrarse**: 0 filas de `transaccion` la mencionan, aunque hay 1
  agente cargado — se dio de alta por fuera de la API. Nada que limpiar.

---

## [2026-08-21] — Tableros: los números pasan a significar lo que dicen

> Backend: `dashboards.service.ts`, `.controller.ts`, `snapshot.interface.ts`,
> `dashboards-export.service.ts`, `permisos-catalogo.ts`. Frontend: `KpiGrid.tsx`,
> `FunnelGestion.tsx`, `DashboardFiltros.tsx`, `types/dashboards.ts`.
> Script nuevo: `prisma/scripts/limpiar-permisos-obsoletos.ts`.

Las cuatro decisiones de producto que quedaban del backlog de la auditoría, ya tomadas.

### La deuda: dos números, no uno

`deudaTotal` sumaba `montoTotal` —lo asignado— y se llamaba "Deuda total", así que se leía como el
saldo. Ahora son dos:

- **Deuda asignada** — lo que entró. No baja al cobrar; es la referencia contra la que mide el cedente.
- **Saldo pendiente** — lo que falta cobrar hoy. Va en SQL crudo por el `COALESCE(saldo, montoTotal)`:
  `saldo` lo escribe la consolidación por pagos y es `NULL` en un caso que nunca se consolidó, donde lo
  que falta cobrar es el monto original.

Y el recupero pasó a ser **acumulado**: todo lo cobrado sobre lo asignado. El anterior dividía los
pagos **del período** por la deuda de **toda la vida** de la cartera — un híbrido que daba 0,18% y no
servía para nada. Lo del período sigue estando, ahora rotulado **Cobrado en el período**.

### El funnel: anidado por construcción

Las tres primeras etapas leían `estadoSituacionId`, que es un solo valor: un caso que llegaba a
promesa **dejaba de contar en "contactados"**. Medido en la base local daba `21.335 / 0 / 0 / 68` — la
última barra mayor que las dos anteriores.

Ahora cada escalón se define **por evidencia** y es subconjunto del anterior:

| Escalón | Qué cuenta |
|---|---|
| Asignados | todos |
| Contactados | situación de contacto **∪** tiene alguna promesa **∪** tiene algún pago |
| Con promesa | tiene alguna promesa registrada |
| **Promesa cumplida** | de los que prometieron, los que además pagaron |

`promesa_pago` y `pago` son tablas históricas, así que ahí sí hay memoria. El cuarto escalón cambió de
significado a propósito: *"con pago"* no es subconjunto de *"con promesa"* —se puede pagar sin
prometer— y era lo único que impedía que el embudo fuera monótono. Quien pagó sin prometer no
desaparece: está en el KPI *Casos con pago*.

Lo que **no** se pudo arreglar: no hay histórico de transiciones de situación, así que "contactados"
subestima — un caso contactado que después se marcó incobrable, sin promesa ni pago, no cuenta. Queda
documentado en la ayuda como limitación del dato.

Verificado contra la cartera real de la base local: `21.335 / 68 / 0 / 0`, decreciente en todos los
escalones, con `saldo ≤ asignada` y el recupero dentro de `[0,100]`.

### "Casos sin gestión": de 0 siempre a los que nadie tocó

Contaba `estadoGestionId: null`, que da 0 para cualquier cartera cargada por el flujo normal: la
importación exige un estado inicial y se lo pone a todos. Ahora cuenta los casos **sin un solo
comentario**, que es lo que el nombre promete. En la base local pasó de 0 a **21.332 de 21.335**.

### `dashboards.ver_todas_empresas`: se retiró

El controller leía `usuario.empresaId`, campo que no existe ni en el JWT ni en el schema, así que el
recorte era siempre `null`. Se decidió **no implementar el modelo**: todos los usuarios son internos y
trabajan sobre varias carteras, así que agregar `usuario.empresaId` habría sido inventar un requisito —
y con todos en `null` no habría cambiado nada igual.

Se sacó el permiso de los dos catálogos y el recorte muerto del controller y del servicio.

> **Retirar un permiso no es gratis**: `RolesService.validarPermisos` rechaza cualquier clave
> desconocida, así que un rol que lo tenía guardado **no se podía volver a guardar** desde la pantalla
> de Roles. Por eso va `limpiar-permisos-obsoletos.ts`, idempotente y con dry-run por defecto. En local
> limpió el rol ADMIN (56 → 55 claves). **Hay que correrlo en producción al desplegar.**

---

## [2026-08-21] — Seguridad: la sesión que no se cortaba, el borrado que huerfanaba y la clave en claro

> `auth/usuario-activo.service.ts` (nuevo), `auth/jwt-auth.guard.ts`, `auth/auth.module.ts`,
> `modules/usuarios/usuarios.service.ts` y `.module.ts`, `modules/transacciones/audit.enums.ts`,
> `common/logger/sanitize.ts`. Tres specs nuevos (33 casos).

Los tres 🔴 del backlog que no dependían de ninguna decisión de producto.

### 1. Desactivar a alguien no le cortaba la sesión

`JwtAuthGuard` verificaba **solo la firma del token**. El `activo` se miraba únicamente en el login,
así que desactivar a una persona no la echaba: seguía operando con todos sus permisos hasta que el
token venciera —con `JWT_EXPIRES_IN=1d`, hasta un día— y **ni siquiera recargar la página la cortaba**,
porque el frontend restaura la sesión desde `localStorage` sin consultar al servidor.

**`UsuarioActivoService`**, con caché en memoria de TTL corto (`AUTH_ESTADO_CACHE_TTL_MS`, default
30 s). No se le pega a la base en cada request a propósito: esto está en el camino de **todas** las
llamadas autenticadas y los endpoints de polling —notificaciones, importaciones en curso— multiplican
el tráfico. El ABM de usuarios llama a `invalidar()` al guardar, así que **por la app el corte es
inmediato**; el TTL es el techo para cambios hechos por fuera (o desde otra instancia).

Un detalle que casi se escapa: el `throw` del rechazo tiene que ir **fuera del `try`** del
`verifyAsync`, si no el `catch` se lo come y lo reporta como "Token inválido o expirado", que manda al
usuario a mirar el lugar equivocado.

### 2. Borrar un usuario funcionaba, y se llevaba la trazabilidad puesta

Casi todas las FKs que apuntan al usuario son `ON DELETE SET NULL`, así que el borrado **no fallaba**:
sus comentarios, pagos, promesas, convenios y registros de auditoría quedaban huérfanos y pasaban a
figurar como "Sistema", en silencio y sin vuelta atrás. Justo lo contrario de lo que una bitácora
inmutable promete.

Ahora `remove()` cuenta la actividad en 8 tablas y rechaza con un 409 que dice **qué** tiene:

> *No se puede eliminar a Juan Pérez: tiene 12 comentarios, 2 promesas, 69 registros de auditoría.
> Borrarlo dejaría esos registros sin autor. Para darle de baja, desactivalo con el interruptor.*

Sigue permitido borrar un alta equivocada que nunca se usó, que es el único caso legítimo.

### 3. La clave de Neotel quedaba en claro en la auditoría

`CAMPOS_SENSIBLES` no incluía `claveNeotel`, y el alta/edición de usuario audita `req.body` **entero**:
la clave de la API de Neotel quedaba legible en `transaccion.data` para cualquiera con
`auditoria.ver_todos`.

Se agregó ahí y, de paso, al sanitizador de logs — que hace match **exacto** y por eso tampoco cubría
`sipPassword` ni `claveNeotel`. Hay un test que verifica que **`parametro.clave` siga visible**: el
match de la auditoría es por substring, así que agregar `clave` a secas habría tapado un código de
negocio (`SIT-050`) creyendo que es un secreto.

> ⚠ **Pendiente**: revisar si en producción ya quedaron filas de `transaccion` con la clave en claro.
> Si hay agentes de telefonía cargados, las hay.

### Verificación

Además de los 33 tests nuevos, se probó **contra la app corriendo** con la base local:

| | |
|---|---|
| Usuario activo, token válido | `200` |
| Desactivado por base, dentro del TTL | `200` (cacheado) |
| Desactivado por base, pasado el TTL | `401` *"Tu cuenta fue deshabilitada"* |
| Desactivado **por la app** (`PATCH /usuarios/:id`) | `401` **sin esperar el TTL** |
| Reactivado | `200` |
| `DELETE` de un usuario con actividad | `409` con el detalle |

La suite queda con los mismos 6 suites y 19 tests fallando de siempre, todos preexistentes y ajenos.

---

## [2026-08-21] — Tableros y timeline: siete arreglos, y una decisión que queda abierta

> Backend: `dashboards.controller.ts`, `dashboards.service.ts`.
> Frontend: `DashboardFiltros.tsx`, `SeriePagos.tsx`, `TimelineDeudorTab.tsx`.

Todo lo del backlog de tableros que **no depende de decidir qué debería significar un número**. Lo que
sí depende quedó anotado abajo.

- **El export de tableros no exigía `dashboards.ver`.** El `@Permisos` de método pisa al de la clase
  (`reflector.getAllAndOverride`), así que un rol con solo "Exportar tableros" bajaba el tablero
  entero por API. **No alcanza con listar los dos permisos en el decorador**: el guard los resuelve
  con `.some()`, o sea OR. La conjunción se pide a mano en el handler, igual que hace
  `transacciones.controller.ts` con `auditoria.exportar`.

- **La opción "Todas" del selector de empresa** dejaba el tablero en blanco con el cartel de
  "seleccioná una empresa": el snapshot no se calcula sin empresa. Se sacó. Y **Limpiar** reseteaba la
  empresa a `null` justo para quien tenía el permiso de elegir entre varias: ahora la conserva.

- **Los combos de situación, gestión y motivo no filtraban por empresa**, aunque el endpoint acepta
  `empresaId`. Se podía filtrar por un código que esa cartera no usa y quedarse en cero sin ningún
  aviso. Ahora se piden por empresa, y cambiar de empresa limpia los códigos elegidos.

- **El tope de 366 días no se validaba en el front**: se escribía el rango y volvía un error rojo del
  servidor. Ahora los campos de fecha se marcan con *"Máximo 366 días"*.

- **La serie de pagos no dibujaba la cantidad.** El backend siempre la calculó y el tooltip ya tenía
  su rama, pero no había ninguna serie con ese `dataKey`. Ahora es un `ComposedChart` con la cantidad
  en línea y **su propio eje a la derecha**: sin eso, un mes de $8M y 40 pagos deja la línea pegada al
  piso.

- **`casosConPago` traía todos los `deudorId` distintos a memoria** para hacer `.length` — un array
  enorme en el proceso Node por cada refresco, para usar un solo número. Ahora `groupBy`.

- **En Timeline, todo lo malo se veía gris.** `estadoColor()` buscaba `fallido/failed/error/bounced`,
  que son los estados de **WhatsApp**, y Sender escribe `fallo` y `rebote` para email. Un rebote —el
  dato accionable de toda la solapa— era indistinguible de "desconocido". Se agregaron `fallo`,
  `rebote` y `queja` en rojo, y `omitido`/`desuscripto` en naranja.

### Lo que queda abierto, y por qué

**`dashboards.ver_todas_empresas` no restringe nada** y no se arregló, porque no es un bug: es un
modelo que no existe. El controller lee `usuario.empresaId`, campo que no está ni en el JWT ni en el
schema, así que la restricción es siempre `null`. Y **el sistema no tiene el concepto de "empresa del
usuario"** — el `resolverEmpresaId` de reportes, que el spec de dashboards cita como referencia, lee
un header `x-empresa-id` del cliente, que no es una frontera de seguridad.

Son dos caminos y los dos son decisiones de producto: implementar el modelo (`usuario.empresaId` +
JWT + campo en el ABM de usuarios) o **sacar el permiso** y dejar de prometer un recorte que no
ocurre. Mientras tanto, cualquiera con `dashboards.ver` puede pedir el tablero de otra empresa.

Tampoco se tocaron los tres números que la auditoría marcó como engañosos —"Deuda total" sumando
`montoTotal`, el funnel que no es un embudo, y "Casos sin gestión" que da 0 siempre—: los tres
requieren decidir **qué tienen que medir**, no cómo. Están en `docs/ayuda-spec.md` §7.

---

## [2026-08-21] — Email: cinco arreglos de lo que le llega mal al deudor

> Gestión: `variables-mapper.ts` (+ spec nuevo), `email-sender.service.ts`, `sender-http.client.ts`,
> `EnviarEmailDialog.tsx`, `types/email.ts`.
> **Sender** (repo `amsa-sender`): `manual-email.service.ts`, `internal-email.controller.ts`.

Todos salieron de la auditoría de documentación de la fase 6. El criterio para arrancar por acá: es el
único grupo donde el bug **sale del sistema y llega a una persona**.

**1. `{{saldo}}` devolvía el monto original.** En el catálogo, `deuda` tenía `synonyms: ['deuda',
'saldo']` y resolvía a `montoTotal`. Un deudor que había pagado la mitad recibía un mail reclamándole
el total, con la palabra "saldo" adelante; y en una cartera con recargo por mora el número quedaba
corto. Ahora son tres variables distintas:

| Variable | Qué manda |
|---|---|
| `{{monto_total}}` · `{{deuda}}` | la deuda original asignada |
| `{{saldo}}` | lo que falta cobrar, ya descontados los pagos |
| `{{deuda_actualizada}}` | el monto con el recargo por mora |

`{{saldo}}` cae al monto original si la consolidación todavía no escribió el saldo —que es lo que se
debe—, y `{{deuda_actualizada}}` queda **vacía** en vez de mentir si esa cartera nunca se recalculó.
Cubierto por `variables-mapper.spec.ts` (8 casos).

**2. Editar el asunto no hacía nada.** Con `templateId` presente, Sender hacía
`subject = renderTemplate(template.asunto, vars)` y nunca leía `dto.subject`; Gestión siempre manda
`templateId`. El gestor editaba, **veía su texto en la previsualización del paso 4**, y al destinatario
le llegaba otro. Ahora el asunto del dto gana, renderizado igual para que las variables resuelvan. Si
no viene, el comportamiento es idéntico al anterior.

**3. La lupa hacía mandar otra plantilla.** `handlePreview` pisaba `previewBase` —que alimenta los
pasos 2 y 4— sin tocar `templateSeleccionado`, que es lo que se envía. Elegir A, volver atrás, espiar B
con la lupa y seguir: se leía B y se mandaba A. La lupa ahora usa su propio estado, y de paso tiene un
botón **Usar esta plantilla**.

**4. El envío manual ignoraba la lista de desuscriptos.** Las campañas la consultan
(`email-worker.service.ts`); el envío de a uno, no. Quien había apretado "Desuscribite" seguía
recibiendo los de la ficha. Ahora se omiten con el mismo estado `Desuscripto` que usan las campañas
—así aparece en el timeline del deudor— y la pantalla lo avisa por separado: **no es un error del
envío**, los demás destinatarios salen igual.

**5. El mail podía no aparecer nunca en Timeline.** `Deudor.documento` no es único en Sender (hay una
fila por cartera). Al mandar, la resolución era `findFirst` **sin orden** → id más bajo; al leer el
timeline, `orderBy: { id: 'desc' }` → el más alto. Con documentos repetidos, el mail se colgaba de un
registro y se leía de otro. Las dos consultas ahora ordenan igual.

### Verificación

`variables-mapper.spec.ts` pasa (8/8). El resto de la suite queda igual que antes: **6 suites y 19
tests fallando, todos preexistentes y ajenos** (reportes, consolidación y comentarios, con errores de
inyección en los módulos de test). Los dos backends compilan.

El flujo de email **no se pudo probar de punta a punta en local**: las 26 empresas tienen
`cuentaSmtpId = null` y `envio_email` está vacía, así que nunca se ejercitó acá. Lo verificado es la
lógica del mapper y la compilación.

---

## [2026-08-21] — Wiki completa: tableros, telefonía y email (+ 3 bugs de telefonía)

> Docs: `docs/ayuda/07-tableros/` y `08-telefonia-y-email/` (6 páginas nuevas).
> Frontend: `TelefoniaHome.tsx`, `TelefoniaCaso.tsx`, `AyudaContextual.tsx`, `EmbeddedShell.tsx`.

Cierra la wiki: **36 páginas, las 17 pantallas del menú cubiertas**. La única sin página propia es
`/ayuda`.

### Los tres agentes revisores volvieron con 40 correcciones

Las seis páginas salieron con errores, como todas. Las que más dolieron:

- **Tableros (15 errores).** "Deuda total" suma `montoTotal`, no el saldo: **no resta lo cobrado ni
  incluye el recargo por mora**. El **funnel no es un embudo** —las tres primeras etapas leen
  `estadoSituacionId`, que es excluyente, así que un caso que llegó a promesa deja de contar en
  "Contactados"— y medido en local da 21.335 / 0 / 0 / **68**: la última barra es mayor que las dos
  anteriores. **"Casos sin gestión" es estructuralmente 0**, porque la importación exige estado
  inicial. Y el `%` CPC baja cuanto mejor convierte el equipo, porque mira el estado actual.
- **Email.** Una variable sin mapear **no sale con el `{{hueco}}`: sale vacía**. Editar el asunto
  **no hace nada**. Solo viene precargado el destinatario que clickeaste. Y mapear una variable
  **la guarda pegada a la plantilla, para todo el equipo y para siempre**.
- **Timeline.** La tabla de estados que había escrito estaba inventada entera: los reales son
  `enviado`, `pendiente`, `rebote`, `fallo`, `queja`, `omitido`, `Desuscripto`. **No existe
  "entregado"**, y apertura y clic **no son estados**: son renglones aparte. Y el cruce por documento
  trae **de menos**, no de más: resuelve a un solo registro de Sender, así que si la persona figura en
  varias carteras solo se ve la última.
- **Telefonía.** Política y Timeline **no son solapas de la ficha**: son hermanas, y dentro de la
  Toolbar no existen. El panel de prueba de Neotel **no es de solo lectura**: desloguea al agente, lo
  pone en pausa y lo cambia de campaña.

### Tres bugs arreglados en el camino

1. **El `?` dentro de la Toolbar era un viaje de ida.** Lo había agregado el mismo día: navegaba a
   `/ayuda`, que vive bajo el shell completo, así que el operador terminaba con el sistema entero
   —sidebar incluido— adentro del iframe y sin forma de volver a la ficha hasta la próxima llamada.
   Ahora abre en pestaña nueva.
2. **Elegir un caso a mano lo marcaba como dudoso.** La home navegaba con `?id=`, que es alias de la
   **CLAVE de Neotel**, no del deudor: al caso que el operador acababa de elegir le salía el cartel
   *"Confirmá que es el caso correcto"*. El efecto de segundo orden es el peor — entrena a ignorar el
   único cartel que no se puede ignorar.
3. **"Buscar otro caso" dejaba estado sucio.** Sobre la ficha nueva quedaban el nombre de la persona
   anterior en el chip y el cartel amarillo, porque `nombre` y `dudoso` no se reseteaban. Justo el
   botón que la documentación recomienda cuando la ficha abrió mal.

### Guarda

Al sacar `/dashboards` y `/admin/neotel-test` de la lista de pendientes, `verificar-ayuda` tiró un
`TypeError`: una página declaraba una ruta sin ser principal de ella. El error de fondo era real —lo
detecta la regla de "una principal por pantalla"— pero el script moría antes de reportarlo. Ahora
informa en vez de explotar.

### Hallazgos de producto

Los más graves, en `docs/ayuda-spec.md` §7: **`dashboards.ver_todas_empresas` no restringe nada**
(lee `usuario.empresaId`, campo que no existe, así que cualquiera con `dashboards.ver` puede ver la
cartera de otra empresa, drill-down con nombres y documentos incluido); **el export de tableros no
exige `dashboards.ver`**; **`{{saldo}}` y `{{deuda}}` resuelven a `montoTotal`**, así que un deudor
que pagó la mitad recibe un mail reclamándole el total; y **el envío manual no respeta la lista de
desuscriptos**.

---

## [2026-08-21] — Ayuda contextual: el botón "?" en todas las pantallas

> Frontend: `pages/ayuda/AyudaContextual.tsx` y `Markdown.tsx` (nuevos), `contenido.ts`,
> `AyudaPage.tsx`, `AppShell/AppBar.tsx`. Guarda nueva: `frontend/scripts/verificar-ayuda.mjs`
> (`npm run verificar-ayuda`). Spec: [docs/ayuda-spec.md](docs/ayuda-spec.md) §2 y §6.

Cierra la fase 5 de la wiki. El `?` de la barra superior abre la ayuda **de la pantalla en la que
estás**, en un panel lateral.

**El problema no era cablear, era decidir qué abrir.** `rutas` ya existía en el frontmatter y
`paginaParaRuta()` estaba exportada sin que la llamara nadie — pero no alcanzaba: cuatro pantallas
tienen cinco o seis páginas (`/gestion` 6, `/reportes` 6, `/carga` 6, `/plantillas` 5) y la función
devolvía la primera por orden de archivo. El `?` de Gestión habría abierto "Cómo piensa el sistema"
en vez de "Buscar un caso".

Se resolvió declarando la principal explícita (`rutaPrincipal`) en 14 páginas, con una guarda que
verifica que cada pantalla tenga exactamente una. Nada sale de un orden implícito.

### Decisiones

- **Panel lateral, no navegación.** El momento en que alguien pide ayuda es, casi siempre, con un
  formulario a medio llenar. Salir de la pantalla se lo llevaría puesto.
- **Abre la principal ya renderizada**, con las hermanas de esa pantalla como chips arriba: un clic
  para el caso común, sin perder las otras cinco.
- **El botón vive en la barra, no en cada página.** La pantalla sale de `useLocation()`, así que una
  página de ayuda nueva queda enganchada sola con solo declarar su `rutaPrincipal`.
- **Match por prefijo más largo**: `/reportes/ejecuciones` prefiere su propia página antes que las de
  `/reportes`, y `/gestion/1234` igual encuentra la ayuda de Gestión.
- Dentro del panel, un enlace a otra página de ayuda **cambia el contenido del panel** en vez de
  navegar. Ir a `/ayuda` es una acción aparte, al pie.

### De paso

- El renderer de markdown salió de `AyudaPage.tsx` a su propio `Markdown.tsx`, que ahora comparten el
  visor y el panel.
- **Los enlaces internos ya no recargan la app**: usaban `<a href>` pelado, así que cada link entre
  páginas de ayuda era un full reload. Ahora van por React Router.

### La guarda

`npm run verificar-ayuda` valida metadatos, que los enlaces internos resuelvan, que haya exactamente
una principal por pantalla, y que cada entrada de `navConfig` tenga ayuda salvo las que estén en la
lista explícita de pendientes. Además imprime qué abre el `?` en cada pantalla, que es la forma más
rápida de ver si una principal quedó mal elegida.

Encontró un error apenas se corrió: la ruta de Tableros es `/dashboards`, no `/tableros`.

Pendientes: Tableros, Telefonía y Email siguen sin página (están en la lista de la guarda), y falta
la guarda de que las 10 categorías de importación estén documentadas.

---

## [2026-08-21] — Mora: tres guardas que faltaban, encontradas auditando la documentación

> Backend: `mora.service.ts`, `mora.controller.ts`, `cargar-tasa.dto.ts`, `mora.interface.ts`.
> Frontend: `AjustesMora.tsx`, `api/mora.ts`. Script nuevo: `prisma/scripts/verificar-mora-guardas.ts`.

Los tres salieron de los agentes revisores de la wiki de ayuda, no de un incidente. Ninguno se había
manifestado todavía porque **la única cartera con recargos es AYSA y su índice vino migrado del
`ud60`** — que es justamente lo que los tapaba.

**1. Una cartera nueva no podía cargar su primera tasa. La funcionalidad no arrancaba.**
`generarMes` exige el índice del día anterior y, sin él, solo cede con `permitirInicioDeCadena`. Ese
flag existía en el servicio y en el DTO desde el día uno, pero **el frontend no lo mandaba nunca** —
ni estaba en el tipo de `moraApi.cargarTasa`. Resultado: en cualquier empresa sin índice previo el
error mandaba a "generá primero los meses anteriores", meses que tampoco se podían generar por la
misma razón. Un callejón cerrado.

**2. Recargar un mes viejo recomputaba la cadena migrada sin preguntar nada.**
El confirm de la pantalla se calculaba sobre `tasas`, que trae **24 meses**. Un mes más viejo que esa
ventana caía en `yaExiste === false` y se regeneraba en silencio hacia adelante — en AYSA, 295 meses.
Y peor que el silencio: reemplazaba índice `origen='UD60'` por `CALCULADO`. **39 de los 305 meses
históricos tuvieron más de una tasa vigente** (spec §5.2), así que reconstruirlos desde la tasa
mensual única los empeora. Era una degradación disfrazada de corrección.

**3. La fecha de corte salía en UTC.**
`normalizarFecha(new Date())` leía los componentes con `getUTC*`. En Argentina, a partir de las 21:00
devolvía **el día de mañana**: el último día del mes, recalcular fallaba con *"No hay índice para el
{fecha}"* aunque la tasa del mes estuviera perfectamente cargada.

### Lo que se hizo

- **`preverGeneracion(empresaId, periodo)`** — método nuevo, expuesto en `GET /mora/tasas/previo`.
  Devuelve si la cadena está vacía, si falta el día anterior, **cuántos meses posteriores hay de
  verdad** y **cuáles de los que se tocarían tienen índice migrado**. La pantalla ya no deduce nada de
  las filas que tenga a mano.
- **Las validaciones se hoistearon a `generarMes` y corren antes del `upsert` de `tasa_mora`.** Antes
  la tasa se escribía primero, así que una generación rechazada dejaba una fila con 0 días de índice
  que en la tabla se lee como si estuviera cargada.
- **`permitirPisarMigrado`** — bandera nueva. Sin ella, regenerar un mes con índice del cedente se
  rechaza nombrando los meses afectados. Con ella, queda un `warn` con el usuario y los periodos.
- **`hoyUtc()`** — helper que arma el día del calendario local. Reemplaza a
  `normalizarFecha(new Date())` en `calcularDeudor`, `recalcularCartera` y `mesesFaltantes`.
  `normalizarFecha` se queda para lo que sí es UTC: las columnas `@db.Date`.
- **La pantalla pregunta lo que corresponde**, en tres confirmaciones distintas y con el texto que
  explica la consecuencia: iniciar la cadena (con el aviso de que la deuda anterior a ese mes queda
  sin recargo), regenerar N posteriores, y pisar índice del cedente (en rojo, "Pisar igual").

### Verificación

`npx ts-node --transpile-only prisma/scripts/verificar-mora-guardas.ts [--apply]` — 15 checks contra
la base real, sin empresas ni fechas hardcodeadas. Sin `--apply` no escribe nada; con `--apply` prueba
el arranque de cadena en una empresa sin mora y borra lo que creó.

Confirmado además que **la carga mensual de rutina no cambió**: para el mes siguiente al último con
índice, el preview da `periodosPosteriores: []` y `periodosMigrados: []`, así que no aparece ninguna
confirmación nueva. Los 20 tests unitarios de mora siguen pasando.

Quedan sin arreglar, anotados en `docs/ayuda-spec.md` §7: que no hay ningún proceso que recalcule la
mora (el indicador naranja de la ficha, con umbral de 48 h, está encendido de forma permanente), que
la tabla muestra solo 24 meses sin manera de ver más, y que los multiplicadores ×1,5 y ×2 están
hardcodeados en la UI mientras el backend los lee de la configuración de la empresa.

---

## [2026-08-20] — AYSA: descifrado el recargo por mora, y un bug de 3 meses en el CRM del cedente

> Sin cambios de código. Spec nuevo: [docs/mora-aysa-spec.md](docs/mora-aysa-spec.md).

AYSA actualiza la deuda por mora con un **número índice diario encadenado**, estilo CER/UVA. El
equipo del cedente no sabía explicar el cálculo: solo tenían un instructivo para cargar tres tasas
en un formulario de Visual FoxPro y el código del botón. Alcanzó para deducirlo entero, y el
`UD60.DBF` que después nos pasaron lo confirmó.

```
indice(d)         = indice(d-1) × (1 + tasa_mensual)^(1/30)
deuda_actualizada = importe × indice(hoy) / indice(vencimiento)
```

**515 de 515 pasos reproducidos al último dígito** sobre los datos reales. La convención `^(1/30)`
se aplica tenga el mes 28 o 31 días, así que un mes de 31 acumula 2,2421% con una tasa nominal de
2,169% — hay que replicarla igual para que los montos coincidan.

Los tres tipos del formulario son la misma tasa ×1, ×1,5 y ×2. El **tipo 1 es el que alimenta la
deuda actualizada de toda la cartera**, deducido por contradicción (§1 del spec). Para qué sirven el
2 y el 3 sigue abierto.

### El archivo del cedente: 25 años de historia y un bug vivo

`UD60.DBF` trae 9.284 días por tipo (01/04/2001 → 31/08/2026) **sin un solo hueco**. Se migra entero
en vez de regenerarlo: tiene correcciones incrustadas a mano (el 29/05/2022 los tres tipos bajan 1-3%
respecto de la proyección) que son la historia con la que el cedente liquidó de verdad.

Auditándolo apareció el motivo por el que **el CRM del cedente venía mostrando todas las deudas
actualizadas en negativo**: el 01/06/2026 el `seek` del día anterior falló, `inant` volvió a 1 y la
cadena del tipo 1 arrancó de cero. El 01/07 se repitió y agosto se cargó encima. El índice valía
**1,0450169** cuando debía valer **7.044,4822042**.

No fue un dato faltante —el orden físico de los registros prueba que la fila del 31/05 existía—, sino
el `ud60.CDX` corrupto. Los 485 registros borrados muestran que ya les había pasado en nov-2025 y en
abr-2026 (tres intentos). Se les pasó un `.prg` que reindexa, borra el tramo roto y reconstruye la
cadena sin depender del `seek`.

De ahí sale la regla más importante para nuestra implementación: **fallar duro si falta el índice del
día anterior**, nunca arrancar la cadena en 1.

### La reconciliación cerró el mismo día: 15/15 al centavo

El cedente pasó 15 casos con su deuda actualizada, y AYSA —vía el **estado de deuda de la oficina
virtual**, que desglosa los conceptos— puso las piezas que faltaban. La regla completa, por factura:

```
coef      = índice(fecha_cálculo) / índice(vencimiento)
Int/Rec   = capital × (coef − 1 + 0,05)      ← 5 puntos fijos ademas del interes
Rec AJ/EJ = 0,10 × (capital + Int/Rec)       ← recargo por gestion de cobranza
IVA/RNI   = 0,21 × (Int/Rec + Rec AJ/EJ)     ← el IVA grava solo los recargos
Total     = capital + Int/Rec + Rec AJ/EJ + IVA/RNI
```

Aplicada a los 15 casos contra el `deuact` del cedente: **los 15 exactos**, con un máximo de tres
centavos de diferencia por redondeo acumulado. El caso testigo cierra exacto en los cuatro conceptos
por separado, no solo en el total.

El 5% fijo era lo que desordenaba todo: un cargo fijo sobre el capital se disfraza de tasa alta en
períodos cortos y de tasa baja en los largos, y por eso el multiplicador implícito daba 2,53 a 144
días de mora y 1,31 a 694.

Queda una sola cosa abierta, y no bloquea: comparando dos cuentas con distinto período se aisló que
**un mes entre junio y noviembre de 2025 tiene la tasa mal cargada en el `ud60`**, unos 0,21 puntos
de más. Es dato de entrada, no fórmula. De ahí sale una decisión de diseño: **la fuente de verdad de
la tasa es el mail mensual de AYSA, no el `ud60`**.

### Fases 1 y 2 implementadas

**Modelo**: `tasa_mora` (una fila por mes; el operador carga UN número y el sistema deriva los tres
tipos) e `indice_mora` (el índice diario, `Decimal(30,12)`), más `deudor.recargoMora`.

**Importador** `prisma/scripts/importar-ud60.ts`: 27.852 filas migradas del DBF del CRM viejo, 0
huecos, 0 duplicados, las 9 rupturas de cadena conocidas y documentadas. Descarta los 485 registros
borrados y las 93 filas basura, y **repara el tramo del tipo 1 que el cedente tenía roto**
reconstruyéndolo desde el ancla sana. Se planta en vez de importar mal si aparece un hueco o una
ruptura nueva.

**`MoraService`**: genera el índice del mes desde la tasa —fallando duro si falta el índice del día
anterior, que es el bug que rompió el CRM del cedente— y valúa la deuda, por caso o por cartera.
Sobre AYSA: **21.335 casos y 1,1M de facturas en ~7 segundos**.

**La trampa que costó encontrar**: hay dos implementaciones del cálculo, TypeScript para la ficha y
SQL para la cartera, y diferían por centavos siempre para el mismo lado. `factura.importe` es DOUBLE
y MySQL contagia el tipo, así que sin un `CAST(... AS DECIMAL(20,2))` la cadena entera se calculaba
en punto flotante; como `0,10 × (un valor de 2 decimales)` cae exacto en medio centavo 1 de cada 10
veces, y en binario ese `.635` es `.63499…`, el SQL redondeaba para abajo. Con el CAST y con
`Prisma.Decimal` del lado de TS, **300 de 300 casos reales dan idénticos al centavo**.

**Tests**: 20, y los dos que más valen reproducen concepto por concepto los estados de deuda reales
de AYSA. Si esos fallan, la plataforma dejó de coincidir con lo que AYSA le cobra al deudor.

### Fase 4: la ficha, los ajustes y los reportes

**Ficha del deudor**: cuando hay recargo calculado, el header muestra **DEUDA ACTUALIZADA** como
número principal —es el que el gestor le dice al deudor— con el original tachado, el recargo, lo
pagado y a qué fecha está valuado. Si el último recálculo tiene más de un día, la fecha se pinta en
`warning`: el número quedó corto y conviene que se note.

`ver desglose` abre un modal que **replica la estructura del estado de deuda de la oficina virtual de
AYSA**: mismas columnas (`Int/Rec`, `Rec AJ/EJ`, `IVA`), mismo orden, factura por factura. La idea es
que el gestor pueda cotejar línea por línea contra lo que ve el deudor, sin traducir nada.

**Ajustes → Recargo por mora**: la serie mensual con la tasa informada y las derivadas ×1,5 y ×2, de
dónde salió cada una, y un aviso con **los meses que faltan** —una deuda que cruce un hueco se valúa
mal y hoy eso no lo avisa nadie—. Dos frenos en la carga, los dos por errores que ya pasaron en el
sistema del cedente: si la tasa es menor a 0,5 pide confirmación (el clásico es cargarla ya dividida
por 100), y si el mes ya tenía tasa avisa cuántos meses posteriores se van a regenerar.

**Reportes**: `recargoMora`, `deudaActualizada` y `moraCalculadaEn` en el catálogo. `deudaActualizada`
quedó como **columna desnormalizada** porque el catálogo se arma del DMMF de Prisma y no soporta
campos calculados: sin ella la deuda actualizada no se puede pedir en un reporte ni ordenar en un
listado. La escribe el mismo `UPDATE` que el recargo.

### Desplegado y activado en prod el mismo día

El cedente aplicó el `.prg` de corrección y mandó el `ud60` nuevo. **Su cadena reparada coincide con
la nuestra hasta el último decimal** en los siete puntos de control, incluido el 7.044,4822042 del
31/08/2026 que les habíamos pasado; las rupturas bajaron de 9 a 7 (desaparecieron las dos del bug).

La EC2 no tiene permisos de S3, así que el DBF se subió por SSM: gzip + base64 en 7 chunks de 50 KB,
con verificación de `sha256` en el host, dentro del contenedor y contra el original local.

| | |
|---|---|
| `indice_mora` | 27.852 filas · 2001-04-01 → 2026-08-31 |
| `tasa_mora` | 305 meses |
| Prueba de aceptación en prod | **15/15 al centavo** |
| Recálculo de la cartera | 14.466 casos en 2,9 s · **0 facturas sin índice** |
| Control SQL vs cálculo al vuelo | 300/300 idénticos |
| Cartera AYSA | capital $4.053M → actualizada **$7.070M** (×1,7442) |

Que las facturas sin índice sean 0 importa: la cartera tiene vencimientos desde 2006, y el `ud60`
arranca en 2001, así que cubre hasta la más vieja.

### La limitación que queda anotada

El recargo se calcula sobre el importe original de cada factura y **no descuenta los pagos**, porque
no sabemos a qué factura imputarlos. En un caso con pagos parciales la deuda actualizada queda por
encima de la real. La ficha lo dice en un tooltip en vez de inventar una imputación. El dato para
resolverlo ya está cargado: `pago.observacion` trae el número de partida; falta que el cedente
confirme el criterio.

## [2026-08-19] — Reportes: separador configurable, y el catálogo de campos de 388 a 113

> ⚠️ **Redeploy back + front.** Sin cambios de schema ni de datos. El catálogo se cachea una hora en
> memoria del backend, así que el árbol nuevo aparece al reiniciar el contenedor.

### El separador de columnas se elige

TXT y CSV ya aceptaban un separador, pero **no había UI para configurarlo** y, peor, no habría
servido: `plantilla.opcionesFormato` guarda las opciones por formato (`{ txt: {...}, csv: {...} }`)
y se le pasaba el **objeto entero** al exportador, que buscaba `separador` en la raíz. No lo
encontraba nunca, así que toda opción configurada se ignoraba en silencio. Ahora hay
`opcionesDelFormato(opciones, formato)` y los dos caminos —sincrónico y async— lo usan.

El separador pasó de una lista cerrada (`\t`, espacio, pipe) a un `string` libre: cada sistema
destino pide el suyo y no hay razón para adivinar cuáles valen. En el builder aparece, cuando el
formato es TXT o CSV, un selector con tab, `;`, `,`, `|` y espacio, más un campo para escribir
cualquier otro, y un switch para sacar la fila de encabezado. 9 tests nuevos.

### El catálogo de campos: 388 → 113

El explorador ofrecía **388 campos elegibles** desde un deudor, muchos repetidos y varios que no
significaban nada. El caso testigo es `estadoGestion.llamadas.ringedAt`: el catálogo se construye
recorriendo el DMMF de Prisma, y desde el estado de gestión —que es una fila de `parametro`— se
podía seguir a *todas las llamadas del sistema que comparten ese estado*. Nada de eso habla del
deudor de la fila.

Cinco reglas, en `catalogo/metadata.ts`:

| Regla | Saca |
|---|---|
| Una colección detrás de una relación 1-1 no es un dato del caso | 152 campos: `estadoGestion.llamadas`, `empresa.remesa`, `motivoNoPago.promesasComoAnterior` |
| Las claves foráneas no van a un reporte | `estadoGestionPrevioAId`, `subcategoriaId`, `campañaId`… |
| De un modelo de referencia solo interesan dos campos | los 8 de `parametro` × 4 relaciones, los 7 de `usuario` × 6 |
| Ramas duplicadas o técnicas | `remesa.empresa`, `contactos.llamadas`, `llamadas.sesion` |
| Ruido de una tabla puntual | `remesa.okFilas`, `llamadas.recordingUrl`, `transacciones.data` |

Las colecciones colgadas de otra colección se conservan (`convenios.cuotas`): esas siguen siendo del
caso. Las dos primeras reglas son estructurales —no hay que mantener una lista— y las otras tres son
listas cortas y explícitas.

**Cuando el id es el dato.** La regla de las claves foráneas tiene excepciones declaradas en
`FKS_VISIBLES`: la base de Neotel lleva el **id** de la política, no su nombre, así que
`remesa.politicaId` se sigue ofreciendo. De paso `politica` dejó de estar entre los modelos ocultos,
y ahora la remesa también ofrece el nombre y la descripción de su política.

**Nombres y explicaciones.** Se reescribieron las etiquetas: se acabaron los `Ringed At`, `Ip`,
`Cambio Sit020` y `Creado At` que salían de humanizar el nombre del campo. Y cada campo que no se
entiende solo trae una línea de hasta diez palabras: *"Lo asignado al abrir el caso; no baja con los
pagos"* en `montoTotal`, *"Vacío es del titular; CODEUDOR es de otra persona"* en
`contactos.relacion`. Los que se explican por el nombre **no** llevan descripción a propósito: una
aclaración obvia al lado de cada campo es más ruido.

**Orden.** Las ramas de primer nivel siguen cómo se arma un reporte —quién es el caso, de quién es,
cuánto debe, cómo viene la gestión, cómo contactarlo, el historial— y no el orden del schema. Lo que
no esté en la lista queda al final, alfabético, así un campo nuevo aparece pero no se mezcla.

13 tests nuevos: el catálogo no tenía ninguno, y estos son sobre todo un cerco contra la vuelta del
ruido.

> La poda es de catálogo, no de motor: un path que ya no se ofrece **sigue resolviéndose** si está
> guardado en una plantilla vieja. La plantilla #1 usa `empresa.remesa.numeroRemesa`, que ya no se
> ofrece —y que además nunca fue lo que parecía: es la primera remesa *de la empresa*, no la del
> caso—. Sigue funcionando; conviene cambiarla por `remesa.numeroRemesa`.

---

## [2026-08-19] — Reportes: columnas fijas, y el formato de teléfono que el modo async ignoraba

> ⚠️ **Redeploy back + front.** Sin cambios de schema. **La plantilla #1 de prod quedó sin tocar a
> propósito**: una columna fija con el backend viejo hace fallar el reporte entero con "Path vacío o
> inválido". Después del deploy hay que agregarle las siete columnas fijas y elegirle el formato de
> teléfono a `telefono1`.

Por qué `telefono2..8` traían el dato crudo repetido: **la estructura de columnas que acepta Neotel
es cerrada** y las ocho columnas de teléfono tienen que estar sí o sí, aunque el caso tenga un solo
teléfono. Como no había forma de agregar una columna vacía, se mapeó siete veces el mismo campo para
ocupar el lugar. El problema no era el mapeo: era que faltaba la columna vacía.

### Columnas fijas

Una columna **sin `path`** no sale de los datos: imprime su `valorFijo` en todas las filas, o vacío
si no se declara ninguno. Con un valor cargado sirve además para las constantes que pide el destino
—un id de campaña, un código de origen— sin inventar un campo en el modelo.

El marcador es el path vacío y no una bandera aparte: una columna o sale de un path o es fija, y
tenerlo en un solo lugar (`esColumnaFija`) evita el estado imposible de las dos cosas a la vez. No
parsean path, no aportan `include` ni post-procesamiento, y nunca expanden. En el builder se agregan
con el botón **Columna fija**, se ven en el canvas como `vacía` / `fija: <valor>`, y su panel de
propiedades muestra solo etiqueta y valor.

### El modo async ignoraba el formato de teléfono

Aparecido al tocar esto: hay **dos** executors —el sincrónico y el de streaming— y cada uno armaba
sus columnas por su cuenta. El de streaming nunca resolvió el `formatoTelefonoId` contra el
catálogo, así que **todo reporte grande —justo los que se van a async— ignoraba en silencio el
formato de teléfono elegido en la plantilla**. La base de IPLAN corrió en async, de modo que el
formato no habría tenido efecto ni con el arreglo del `9`.

La preparación de columnas se movió a `executor/columnas-preparadas.ts`, que usan los dos: parseo
del path, cardinalidad contra el default de la plantilla, patrón de teléfono y valor fijo. La misma
función también decide qué columnas expanden, que era el otro pedazo duplicado. 11 tests nuevos.

---

## [2026-08-19] — Reportes: los teléfonos salían inmarcables y los filtros de rango no decían cuál era cuál

> ⚠️ **Redeploy back + front.** Sin cambios de schema. En prod ya está el formato de teléfono nuevo
> (`formato_telefono` #5) y la plantilla de reporte #1 ajustada (backup de la definición previa en
> `/app/storage/backup-plantilla-reporte-1.json`). **El formato nuevo necesita el deploy**: con el
> backend viejo, un patrón con `{area}`/`{15}` sale literal en la celda.

Salió de probar la primera plantilla de reporte de verdad, "Neotel - base predictivo IPLAN".

### El `9` de móvil rompía todos los formatos de teléfono

Los contactos se guardan en E.164 (`+5491163525026`) y `formatTelefono` le sacaba **solo el `54`**,
así que `{numero}` quedaba `91163525026` con el `9` de móvil pegado adelante. Con eso, los cuatro
patrones del catálogo devolvían números imposibles de marcar:

| Patrón | Devolvía | Devuelve ahora |
|---|---|---|
| `549{numero}` | `54991163525026` (dos nueves, 14 dígitos) | `5491163525026` |
| `0{numero}` | `091163525026` | `01163525026` |
| `{numero}` | `91163525026` | `1163525026` |
| `+549{numero}` | `+54991163525026` | `+5491163525026` |

Los fijos salían bien —no tienen ese `9`—, así que el problema se comía justo los celulares, que
son casi toda la base de un predictivo. Ahora el patrón se aplica sobre el **número nacional
significativo**, que es lo que prometen las descripciones del propio catálogo.

El cálculo reusa `phone-utils` (el mismo de importaciones) con un camino rápido por regex para lo
que ya está en E.164 —el 99% de la base—, para no pagar libphonenumber en cada fila de un reporte de
cientos de miles. Lo que no se puede interpretar se imprime como vino: en un reporte, un teléfono
raro es mejor que una celda vacía. 22 tests nuevos (`formatter.spec.ts`, que no existía).

### `{area}`, `{abonado}` y `{15}` — patrones que meten algo en el medio

Neotel necesita el discado local para las llamadas por las tramas de IPLAN: `0` + característica +
`15` + abonado. Con un solo `{numero}` no se puede escribir, porque el `15` va en el medio. Los
placeholders nuevos lo resuelven y quedan disponibles para cualquier formato futuro:

| | Sobre `+5491163525026` |
|---|---|
| `{numero}` | `1163525026` |
| `{area}` | `11` |
| `{abonado}` | `63525026` |
| `{15}` | `15` — vacío si la línea es fija |

Formato nuevo en el catálogo: **Local con 15** → `0{area}{15}{abonado}`. Celular
`0111563525026`, fijo `01142407390`.

El `15` sale solo para celulares, y para decidirlo no alcanza una sola señal: el `9` del E.164 lo
declara explícito, pero hay celulares guardados sin él (`+541155775452`) que solo delatan los rangos
de ENACOM, y hay números con el `9` que ENACOM no tiene en ningún rango. Se consultan las dos; sin
ninguna, fija —meterle un `15` a un fijo lo vuelve inmarcable—. La característica se resuelve contra
la tabla de ENACOM, que es la única forma: ocupa 2, 3 o 4 dígitos según la zona (Bariloche es `294`
con abonado de 7, no `2944` con 6).

### Los filtros de rango no mostraban su nombre

`between` / `notBetween` se dibujan como dos campos **Desde** / **Hasta**, y esos dos rótulos son
fijos: el nombre que el autor le puso al parámetro no entraba en ninguno de los dos. La plantilla de
IPLAN tiene dos rangos sobre `remesa.numeroRemesa` —una que incluye y otra que omite—, así que al
ejecutar aparecían cuatro cajas iguales sin forma de saber cuál era cuál. Ahora el nombre va arriba
del par.

### La plantilla #1, y una columna que no se puede escribir desde el builder

`telefono1` a `telefono8` apuntaban todos a `contactos.valor` **sin índice**: `telefono1` con
`expandir` (una fila por teléfono) y los otros siete con `concatenar`, o sea el mismo valor repetido
siete veces —y con varios teléfonos, todos concatenados en cada celda—. Se dejó una fila por
teléfono y se borraron `telefono2..8`.

Para la otra forma —una fila por caso con ocho columnas de teléfono— el motor **ya sirve**: el
indexador del path (`contactos[tipo=telefono][1].valor`) está implementado y probado. Lo que falta
es poder escribirlo: en el builder el path es un campo deshabilitado que solo se llena desde el
árbol del catálogo, así que ni los índices ni los agregadores (`pagos[sum].importe`) son alcanzables
desde la UI. Queda anotado como pendiente.

También estaba mal el texto de ayuda del selector de formato: mandaba a "Reportes → Formatos", una
pantalla que no existe. Ahora documenta los placeholders.

---

## [2026-08-19] — AYSA: el coeficiente zonal y el recicle, los dos que faltaban

> ⚠️ **Redeploy back + front.** Sin cambios de schema. La plantilla #61 de prod ya tiene los dos
> campos nuevos (backups del `mappingJson` en `/app/storage/backup-plantilla61-pre-coef.json` y
> `-pre-recicle.json`) y los **14.466 casos ya cargados se completaron por backfill**, así que los
> datos se ven sin repetir la carga. El transform `toDecimal:es-AR` viaja en el deploy: hasta que
> salga, una importación nueva guardaría el coeficiente con punto (`1.30`) en vez de coma — el
> transform desconocido deja pasar el valor sin tocarlo. **Desplegar antes de la próxima bajada.**

El equipo pidió dos datos más después de ver la cartera cargada a la mañana. Los dos estaban en el
archivo desde el principio, en columnas ya declaradas en el layout pero que no se llevaban a ningún
lado. Los dos están en el **100%** de las cuentas de las dos bajadas.

### El "recicle" era `NR`

Es la que había quedado marcada como pendiente el 18/08: el equipo lo pedía por nombre y **ninguno
de los cuatro layouts tiene una columna que se llame así**. Quedó sin mapear antes que inventarle el
significado a una columna.

Lo resolvió el equipo describiendo dónde está en vez de cómo se llama: *"dice `No Med`, después una
fecha, después un `003`, después otra fecha"*. Eso es exactamente `Regime` → `F. Proc.` → **`NR`** →
`F. Desde`, el contador de 3 dígitos de la posición 218 que ya se había señalado como el único
candidato. Va como `numero_de_recicle`, con el relleno de ceros, que es como lo nombra el equipo.

No arranca de 1 en todas las bajadas: 001–004 en la del 03/08 (oficina 0506, la cargada) y 005–009
en la del 22/06 (oficina 1028).

### `toDecimal:es-AR` — decimal con coma para los datos adicionales

El `Coef. zonal` (columna 10, posición 134) viene `1.30`: SAP exporta con punto y el gestor lo lee
con coma. `toNumber` no sirve acá porque devuelve un **número**, y los adicionales se guardan como
texto y se muestran tal cual en la ficha.

El transform nuevo formatea el decimal a la convención local y completa los que falten: `1.30` →
`1,30`, `1.8` → `1,80`. Por defecto dos decimales; `toDecimal:es-AR:3` los que se le pidan. Lo que
no parsea como número pasa igual, sin borrarse —misma regla que `mapear:`—. Está en el catálogo del
editor de mapeo, así que sirve para cualquier cedente que mande decimales con punto. 13 tests
nuevos (40 en `transforms`).

Son 11 valores entre 1,10 y 3,50; el 1,30 cubre el 31% de la cartera.

> **Corrección de una medición.** En la primera pasada del análisis reporté que el cedente mandaba
> `1.8` y `1.80` para el mismo coeficiente. Era falso: el pipeline de análisis convertía el archivo
> a UTF-8 y después cortaba las columnas por byte, y como los nombres con Ñ y acentos ocupan un byte
> de más, las filas con esos nombres se leían corridas. Los archivos son **latin1** y hay que
> cortarlos ahí (`readFileSync(f, 'latin1')`, que es lo que hace el importador y lo que hizo el
> backfill). Leídos bien: el coeficiente trae siempre sus dos decimales, `Regime` es solo `No Med` /
> `Medido` y `NR` solo 001–004. Los datos cargados en prod están bien; lo que estaba mal era la
> justificación del transform, que igual sigue haciendo falta por el punto decimal.

### Backfill en vez de rehacer la carga

La carga se corrió el 19/08 a la mañana (14.466 casos, 138.234 facturas, 0 errores) y un dato
adicional nuevo solo aparece cuando se vuelve a importar. En vez de repetir la carga entera se
completaron los dos campos desde los mismos 28 archivos que quedaron en `/app/uploads/19/DEUDORES/`,
cruzando por `Cta. Cto.`: **14.466 de 14.466** en los dos, ninguno sin dato.

---

## [2026-08-18] — AYSA: los datos que pidió el equipo, y el domicilio de servicio arriba

> ⚠️ **Redeploy back + front.** Sin cambios de schema. **Las plantillas #61 y #65 de prod ya están
> actualizadas** (backup del `mappingJson` previo en `/app/storage/backup-plantillas-aysa.json`).
> Los datos nuevos **no aparecen solos**: se ven recién cuando se vuelva a correr la carga.
>
> **La cartera de AYSA se vació en prod el 18/08** para rehacerla limpia: 14.466 casos, 138.234
> facturas, 36.061 contactos, 1.070 pagos, 4.097 errores de import y las 4 remesas. Snapshot previo
> `amsa-gestion-pre-wipe-aysa-20260818`. Se conservaron la empresa, sus 5 plantillas y la auditoría
> (`transaccion`). No había gestión encima: 0 comentarios, 0 convenios, 0 promesas, 0 emails. Los
> archivos subidos siguen en el volumen (`/app/uploads/19/`), ya huérfanos.

Pedido del equipo tras ver la ficha: el domicilio principal tiene que ser el de prestación del
servicio, la categoría tiene que decir qué significa, y faltan seis datos de la cuenta. Se cruzó
contra los 31 archivos reales de la bajada del 22/06 (21.335 cuentas).

### Los datos que faltaban

Cinco estaban en el archivo con otro nombre y se agregaron a los adicionales de la plantilla #61:

| Pedido | Columna del archivo | Índice |
|---|---|---|
| oficina de cobro | `Of. Cobro` | 0 |
| interlocutor | `Interloc.` | 2 |
| nro de partida anterior | `Cta. Cto. sis. ant.` | 5 |
| unidad funcional | `Un. Func.` | 11 |
| punto de suministro | `Pto. Sum.` | 12 |

**"Recicle" no existe en ninguno de los cuatro layouts** (cuentas, partidas, novedades, bajas). El
único candidato es `NR`, un contador de 3 dígitos entre `F. Proc.` y la ventana de asignación, con
valores 005–009 que no correlacionan con la categoría ni con la clase de inmueble. Queda sin mapear
hasta confirmarlo con AYSA: inventar el significado de una columna es peor que no mostrarla.

La `Un. Func.` viene con el relleno `000`/`00000` en el **82%** de los casos; se carga vacía en vez
de mostrar un cero que no es una unidad funcional.

### `mapear:` — traducir los códigos del cedente desde la plantilla

La `Categoría` es un dígito suelto (`1`) y el gestor no puede saber qué es. El transform nuevo lleva
la tabla adentro de la plantilla:

```
mapear:1=1 - residencial|2=2 - residencial|3=3 - no residencial|4=4 - no residencial|5=5 - baldío
```

Lo que **no** está en la tabla pasa igual, sin traducir: si mañana aparece una categoría 6, el gestor
ve `6` en vez de un campo vacío, que es lo que avisa que hay algo nuevo. Un valor vacío sí borra
(`mapear:000=`), que es lo que resuelve el relleno de la unidad funcional.

Sirve para cualquier cedente que mande códigos —motivos de baja, tipos de usuario— y la tabla se
corrige desde el editor de plantillas **sin deploy**. En el editor aparece como un transform más, con
su campo para la tabla.

### El domicilio de servicio queda arriba

La plantilla le pone `prioridad` 1 al bloque de servicio y 2 al de facturación, y la ficha ordena las
direcciones por ese campo —hasta ahora solo ordenaba los teléfonos—.

Faltaba un detalle que lo rompía: **los dos domicilios coinciden en el 68,2% de la cartera** (14.554
de 21.335). Ahí el par `(deudor, tipo, valor)` es el mismo, así que es **un solo** contacto, y el
segundo bloque le hacía `update` al primero: el domicilio que era los dos terminaba etiquetado
FACTURACION y ordenado abajo, justo al revés de lo pedido.

`procesarBloquesDeudor` ahora **deduplica los contactos de una misma fila**: gana el primero que
aportó el dato, que es el orden en que el operador declaró los bloques. La comparación es sobre el
contacto **ya normalizado**, así que el mismo teléfono escrito de dos formas (`42407390` y
`+541142407390`) también cuenta como uno. 13 tests nuevos (`transforms`, `procesar-bloques`); 434
entre imports y common.

---

## [2026-08-11] — Contactos: normalizar los teléfonos sin característica y tirar la basura

> ⚠️ **Redeploy back + front.** Sin cambios de schema. **Cambia el comportamiento de TODAS las
> carteras**, no solo AYSA — ver "Qué cambia para el resto".

Feedback del equipo tras la primera carga de AYSA, sobre el caso 394905:

```
[direccion] NOMEOLVIDES 5935, SAN FRANCISCO SOLANO (CP B1843---)   ← falta el domicilio de facturación
[email]     sin@mail                                                ← basura cargada
[telefono]  +541142407390     ✓        [telefono] 1564435038  ✗ crudo, "en rojo"
```

Medido sobre la bajada del 22/06 (21.335 cuentas): **el 56% de los teléfonos estaba mal procesado y
la mitad de los emails era basura.**

| | En el archivo | Antes | Ahora |
|---|---|---|---|
| Teléfonos | 26.506 | 8.215 útiles (31%) | **17.660 (66,6%)** |
| Emails | 11.702 | 11.702 (con 5.910 `sin@mail`) | **5.766 (49,3%)** |
| Direcciones | 2 por caso | 1 | **2, etiquetadas** |

### Teléfonos: cascada de deducción del código de área

El cedente los manda en formato **local**: `42996640` (fijo) y `1564435038` (celular, con el `15`
que se marca localmente). Sin característica no se puede llamar. De los 26.506, **8.904 (34%) eran
de 8 dígitos y se descartaban en silencio**, y **5.869 (22%) quedaban "en rojo"** e inservibles.

`normalizarTelefonoArgentino` acepta ahora un contexto del caso y prueba en orden:

1. El número ya trae la característica (lo de siempre).
2. **Otro teléfono del mismo caso** la declara → se le presta. Recupera el 5,7%.
3. **El código postal del domicilio** la determina → tabla nueva `cp-area-telefonica.json`. 30%.
4. No se pudo → **se descarta**.

**La tabla se derivó de los datos, no de una suposición.** Para cada CP se miró qué característica
tienen los teléfonos que sí la declaran en casos de ese mismo CP; entran los 120 donde una sola
explica ≥90% con al menos 3 observaciones, más 20 zonas (`B184`) como fallback. Los ambiguos quedan
afuera a propósito.

Era tentador asumir "área 11" para toda la cartera, pero **AYSA no es solo CABA/GBA**: aparecen 220,
223, 230 y 237. Un teléfono con el área equivocada es peor que ninguno — el gestor llama y no es.

Dos salvaguardas que valen la pena mencionar:

- **Control anti-invención**: se tomaron 4.652 teléfonos que sí traen característica, se les sacó, y
  se verificó que la cascada reconstruyera exactamente la misma. **100% de aciertos, 0 errores.**
- La cascada **descarta el área candidata que no da un número válido**. El número nacional argentino
  tiene 10 dígitos: un área de 3 va con 7 locales, no con 8. Si el hermano sugiere un área
  incompatible, se pasa al candidato siguiente en vez de armar un número inexistente.

### Emails: `esPosibleEmail`

Para teléfonos existía `esPosibleTelefono`, que filtra la basura evidente; para emails no había nada
y se guardaba cualquier cosa "en rojo". Ahora se descarta:

1. Lo que no puede ser un email (sin arroba, dominio sin punto, TLD incompleto): 5.918 casos, de los
   cuales 5.910 son `sin@mail`.
2. Una lista corta de rellenos **bien formados** (`sin@mail.com`, `no@tiene.com`, `nn@nn.com`). Son
   sintácticamente válidos y con dominio real, así que ningún filtro técnico los distingue de un
   email de verdad.

El filtro **no mira la frecuencia**: un email repetido suele ser el de una inmobiliaria o un
administrador de consorcio con varias cuentas, no basura.

### Los dos domicilios

AYSA manda el de prestación del servicio y el de facturación, y los dos salen en las cartas. Se
cargan los dos, distinguidos con `contacto.subtipo` (`SERVICIO` / `FACTURACION`), y la ficha los
muestra con una etiqueta.

### Facturas: dejan de quedar todas en "pendiente"

Las 138.234 facturas tenían `estado = null` y la ficha mostraba "PENDIENTE" por defecto. Dos cambios:

- Se crean con `estado: 'PENDIENTE'` explícito. En el camino por lote el estado **solo se escribe al
  crear**: si la factura ya existe puede estar PAGADA o ANULADA, y reimportar el archivo del cedente
  no debe resucitarla.
- **`PagosProcessor` marca PAGADA la factura que el pago identifica.** El archivo de novedades dice
  qué partida se cobró y ese dato ya se guardaba en `pago.observacion`; ahora además cierra la
  factura. Aplica a cualquier cartera cuyo archivo de pagos identifique el comprobante.

### Qué cambia para el resto de las carteras

**Un teléfono que no normaliza ya no se guarda "en rojo": se descarta.** Es lo pedido —un número sin
característica no se puede marcar y solo ensucia la ficha— pero si alguna cartera venía apoyándose en
revisar esos números a mano, deja de tenerlos. Los ya cargados no se tocan.

33 tests nuevos (`phone-utils`, `email-utils`, `pagos.processor`). 421 entre imports y common.

**La carga de AYSA hay que rehacerla** para que tome los contactos corregidos: lo ya cargado no se
migra solo.

---

## [2026-08-11] — Los archivos subidos no sobrevivían a un deploy

> ⚠️ **Requiere actualizar el parámetro SSM `/amsa-gestion/_compose` y recrear el contenedor.**
> Sin cambios de schema. El cambio del compose **no viaja con el deploy normal**: ese parámetro lo
> genera Terraform desde el archivo del repo (`infra/terraform/ssm.tf`).

Reportado como "la importación #10067 falló después de cargar 10 mil casos". La remesa es la **#102**
(el 10067 es el número de remesa): 28 archivos de cuentas de AYSA de la oficina 9000000506, categoría
DEUDORES, estado FALLIDA con `totalFilas=10000`, `okFilas=10000`, **0 errores registrados** y
**10.261 deudores efectivamente cargados**.

### Qué pasó

| Hora (UTC) | |
|---|---|
| 17:52:38 | el operador crea la remesa y sube los 28 archivos a `/app/uploads/19/DEUDORES/` |
| 17:52:45 | arranca el job 144 y empieza a procesar |
| ~18:00 | va por el lote 11: 10.261 casos insertados, contadores persistidos en 10.000 |
| **18:00:50** | **se recrea el contenedor** (deploy). El proceso muere y `uploads/` vuelve al contenido de la imagen |
| 18:01:52 | BullMQ recupera el job huérfano y lo reintenta — **los archivos ya no existen** |
| | `BadRequestException: No se encuentra(n) en el disco 28 archivo(s)` → remesa FALLIDA |

BullMQ hizo lo correcto reintentando; lo que no podía era inventar los archivos.

### La causa: `uploads/` no era un volumen

`docker-compose.prod.yml` montaba `storage` y `logs`, **no `uploads`**. `FileStorageService` escribe
en `cwd/uploads` → `/app/uploads`, o sea **adentro del contenedor**. Cada deploy lo borraba.

La firma que lo delató: todo `/app/uploads` tenía exactamente el mismo timestamp
(`2026-08-10 14:52:15`), que es lo que deja un `COPY` de Docker — el contenido no era de los
operadores, era el del build.

Dos consecuencias más allá de esta importación:

- **Ninguna remesa conservaba su archivo original.** Se perdía la única forma de auditar qué se cargó.
- **La imagen cargaba 158 MB de archivos de prueba** de la máquina de desarrollo (uno solo de 88 MB),
  porque `.dockerignore` excluía `backend/logs` y `backend/storage` pero no `backend/uploads`.

### El arreglo

- **`docker-compose.prod.yml`** — volumen `uploads:/app/uploads`.
- **`.dockerignore`** — se excluye `backend/uploads` del contexto de build.
- **`archivosDeRemesa`** ahora nombra los archivos faltantes con **el nombre que subió el operador**,
  no con el `<timestamp>_<hash>.txt` del disco, que era lo que salía en el error y no le dice nada a
  nadie.

### Qué NO arregla esto

Un deploy en medio de una importación la sigue matando: el job se reintenta, pero los casos ya
cargados quedan a medias. Con el volumen puesto, **el reintento ahora sí puede completarla** —
`DeudoresProcessor` hace upsert, así que reprocesar es idempotente. Antes ni eso era posible.

---

## [2026-08-10] — Neotel: la integración pasa a ser por la Toolbar (adiós softphone propio)

> ⚠️ **Redeploy front.** Sin cambios de schema ni de backend. **El cambio de headers en CloudFront ya
> está aplicado en producción** (ver abajo).

Neotel resolvió lo que veníamos empujando desde mayo, pero por el lado opuesto: en vez de que nosotros
metamos un softphone WebRTC en la app, **su Toolbar hostea AMSA Gestión en un iframe** y ella pone el
audio. Spec completo en [docs/neotel-toolbar-spec.md](docs/neotel-toolbar-spec.md).

| | Plan original | Toolbar |
|---|---|---|
| Quién contiene a quién | nosotros embebemos el softphone | la Toolbar nos embebe |
| Audio | nuestro, JsSIP sobre WSS | de Neotel |
| Estado, pausas, campañas | nuestros, contra la API ASMX | de Neotel |
| Nuestro trabajo | todo | mostrar la ficha correcta cuando entra la llamada |

**Queda descartado**: el Sprint 3 del plan viejo (softphone JsSIP), el upgrade de Asterisk a
chan_pjsip + WSS, y el certificado de `sip.anamayasa.com`. El de `neotel.anamayasa.com` **sí** está en
uso —sirve la Toolbar en el 8443— y **vence el 2026-09-24**.

La capa de sesión / estado / campañas de `modules/neotel/` queda **en stand-by**, no eliminada: el
agente maneja eso desde la Toolbar, y mostrar además nuestro panel llevaría a que la UI diga una cosa
y la central otra.

### Frontend

- **`EmbeddedShell`** — el `AppShell` sin barra superior ni menú lateral. Dentro del iframe esos dos
  solo comen el alto que el operador necesita para gestionar.
- **`TelefoniaCaso`** (`/telefonia/caso?llamada=[[CLAVE]]&data=[[DATA]]`) — la ficha que abre la
  llamada. `[[CLAVE]]` es el id del contacto **en Neotel**; **nuestro id de deudor viaja en `[[DATA]]`**,
  así que la resolución arma una lista de candidatos y prueba hasta que uno exista, en vez de asumir
  una posición fija.

  La `CLAVE` se prueba **solo si `DATA` no aportó nada**, y avisando en pantalla: los dos ids son
  enteros correlativos, así que tarde o temprano uno coincide con un deudor real y la Toolbar abriría
  la ficha de **otra persona** en medio de una llamada. Gestionar sobre el caso equivocado es peor que
  no abrir ninguno.
- **`TelefoniaHome`** (`/telefonia/home`) — lo que ve el agente conectado sin llamada.
- **`Login`** ahora vuelve a la ruta original en vez de a `/`: si al operador le tocaba loguearse justo
  cuando entraba una llamada, terminaba en la home con menú en lugar de en la ficha del caso.

### Infra: `frame-ancestors` en vez de `X-Frame-Options`

CloudFront servía `x-frame-options: DENY` — cualquier iframe quedaba en blanco. No alcanzaba con
`SAMEORIGIN` porque la Toolbar es otro origen, y ese header solo sabe decir "nadie" o "solo yo".
La policy `amsa-gestion-security-headers` pasa a:

```
content-security-policy: frame-ancestors 'self' https://neotel.anamayasa.com:8443 https://neotel.anamayasa.com
```

`X-Frame-Options` se **removió**: varios navegadores le dan prioridad sobre el CSP y volvería a
bloquear. Para el resto de la web quedamos más restrictivos que antes — solo esos dos orígenes.

### El detalle que hace que esto funcione

Los navegadores particionan `localStorage` por **sitio**, no por dirección exacta. Como la Toolbar está
en `neotel.anamayasa.com` y nosotros en `amsagestion.anamayasa.com`, los dos son `anamayasa.com`: **el
mismo sitio**, así que el iframe ve la sesión que el operador ya tiene abierta.

Si la Toolbar quedara en `http://200.5.98.203` —la IP que aparece en la documentación de Neotel— eso
sería *otro* sitio y **al operador le pediría login en cada llamada**. Mismo código, mismo navegador;
lo único que cambia es la dirección. Por suerte ya estaba servida por su dominio.

El puerto no altera el sitio (`:8443` sigue siendo `anamayasa.com`), pero **sí** importa en
`frame-ancestors`, donde el origen se compara completo — de ahí que la directiva lo incluya.

### Pendiente

Probar con una campaña real, y preguntarle a Neotel si hay **`postMessage`** entre la Toolbar y el
iframe. Sin eso la integración es de una sola vía: nos abren la ficha, pero no nos enteramos de cuándo
se cortó la llamada.

---

## [2026-08-10] — Pagos: el anti-duplicados se comía el 13,3% de la cobranza de AYSA

> ⚠️ **Redeploy back.** Sin cambios de schema. Continuación de la entrada de abajo.

Apareció al crear las plantillas de AYSA en producción, antes de la primera carga real.

`PagosProcessor` saltea un pago si ya existe otro **del mismo deudor, mismo día y mismo importe**.
Es el anti-duplicados que hace idempotente reimportar un archivo acumulativo, y con las otras
carteras funciona bien.

Con AYSA es destructivo, porque los clientes cancelan varias cuotas **iguales** de un plan de pago el
mismo día. Sobre el archivo del 25/07:

| | |
|---|---|
| Filas con cobro | 1.997 · **$18.353.107,86** |
| Combinaciones distintas de (cuenta, fecha, importe) | 1.192 |
| Filas que se saltearían | **805 → $2.443.138,61 (13,3%)** |

El caso extremo: la cuenta `000003462007` canceló **36 partidas de $195,04 el 17/07** y quedaba una
sola registrada.

**El arreglo**: si la plantilla mapea un identificador del comprobante en `observacion`, ese campo
entra en el criterio del anti-duplicados. Dos cobros del mismo día e importe pero de comprobantes
distintos dejan de ser "el mismo pago", y reimportar el mismo comprobante sigue siendo idempotente.
De paso, el gestor ve en la ficha qué factura pagó cada cobro.

**Las plantillas que no mapean `observacion` no cambian**: ahí el criterio sigue siendo deudor + día
+ importe. 7 tests nuevos, incluido el caso de las 36 cuotas.

---

## [2026-08-10] — AYSA: varios archivos por remesa + ancho fijo

> ⚠️ **Redeploy back + front.** Sin cambios de schema (`remesa.archivos` ya existe desde TCFA fase 3).
> Todo aditivo: ninguna plantilla ni remesa existente cambia de comportamiento.

AYSA manda la cartera partida en **muchos TXT del mismo formato, uno por sucursal**: 31 de cuentas +
31 de partidas por bajada, más ~56 de novedades y ~18 de bajas. Cargar una bajada eran ~100
importaciones a mano. Spec completo en [docs/imports-aysa-spec.md](docs/imports-aysa-spec.md).

Analizando el paquete real aparecieron **dos huecos**, no uno. La categoría `MULTIARCHIVO` ya existía
pero resuelve otra cosa —N archivos con **roles distintos** que se cruzan entre sí (Toyota TCFA)—, y
además estos archivos son **exports de SAP sin separador**, que el pipeline no sabía leer.

Las dos piezas se construyeron **genéricas**: AYSA se carga con plantillas normales, armadas por el
operador como cualquier otra cartera.

### Backend

- **`utils/ancho-fijo.ts`** — corta las líneas por posición y emite `string[]` por índice, **la misma
  forma que fast-csv**: el mapeo, los transforms, los bloques y todos los processors funcionan sin
  enterarse. Va por stream (el TXT de partidas más grande son 64 MB, el conjunto 250 MB). Incluye un
  inferidor de layout para el editor de plantillas.
- **`utils/recorrer-filas.ts`** — recorre N archivos como si fueran uno solo, en los tres formatos
  (delimitado, Excel, ancho fijo). Reemplaza **tres copias** del mismo bucle en `validateRemesa`,
  `previewAccionesImpacto` y `processImportJob`.
- **`utils/archivos-homogeneos.ts`** — rechaza al subir el lote con un archivo repetido, con otro
  encabezado o que mezcla Excel con texto. Es el caso que de verdad pasa: colar un TXT de partidas
  entre los de cuentas.
- **`utils/filtro-filas.ts`** — condiciones que una fila tiene que cumplir para importarse. Las
  descartadas **no cuentan como error**.
- **`createRemesa`** guarda la lista en `remesa.archivos.lista` con los nombres originales; `archivo`
  sigue apuntando al primero. El hash del conjunto no depende del orden de subida.
- Los errores de fila llevan **el archivo y la posición**: `[cuentas_072.txt:8891] Deudor no
  encontrado`. Con 31 archivos, el índice global no sirve para encontrar nada.
- **`plantillas/aysa.ts`** — los dos layouts como referencia.

### Frontend

`FileDropZone` acepta varios archivos (lista, quitar individual, aviso si mezcla Excel con texto);
con uno solo se ve igual que antes. `AnchoFijoEditor` nuevo: layout como texto `nombre;inicio;largo`,
botón "Inferir del archivo" y **preview de cómo queda cortada la primera fila** —que es lo que hace
usable un editor de texto para esto—. `FiltroFilasEditor` nuevo. El wizard muestra en el preview qué
archivos entraron y cuántas filas descartó el filtro.

### Tres hallazgos de la corrida real

**1. `toDate:auto` leía mal las fechas de SAP.** El formato `DD.MM.YYYY` separado por **puntos** no
estaba soportado y caía al fallback flexible de dayjs:

| Valor | Antes | Ahora |
|---|---|---|
| `10.05.2024` | 5 de **octubre** | 10 de **mayo** |
| `21.06.2026` | `null` | 21 de junio |

Los vencimientos con día ≤ 12 quedaban con mes y día invertidos, y el resto en nulo —que en
`FacturasProcessor` se traduce en la fecha del día—. Afecta a cualquier cartera que mande fechas con
puntos, no solo a AYSA.

**2. El DNI de AYSA colapsaba casos.** `DeudoresProcessor` identifica por `(empresaId, documento,
remesaId)`. El cedente manda `1`, `NO INFORMADO`, `10000000000` y `SIN TELEFONO` en el campo DNI, y
además una persona puede tener varias cuentas de agua. Mapeando el DNI, **86 casos desaparecían de la
cartera sin ningún error en el import**. La identidad pasa a ser la cuenta contrato (placeholder
`SIN-DNI-`) y el DNI va a datos adicionales. Se detectó porque 1.207 filas daban 1.197 deudores.

**3. `recorrerFilas` cierra una ventana de carrera que ya existía.** El `end` del stream no esperaba
al último callback en vuelo: si el archivo terminaba justo cuando el lote llegaba a `BATCH_SIZE`, el
`processBatch` final podía solaparse con el `afterAll`. Apareció con un test que verificaba el orden.

### Performance: las partidas, de 165 s a 3,7 s

`FacturasProcessor` hacía **2 queries por fila** — con 1,1M de partidas, horas. Ahora implementa
`processBatch`: resuelve los deudores del lote con un `IN (...)` cacheado entre lotes y escribe con
`INSERT … ON DUPLICATE KEY UPDATE` de a 500.

El camino en bloque **solo se usa si la fila trae importe, emisión y vencimiento**: si falta alguno se
cae al `upsert` de a una, que es el único que sabe "no toques esta columna". Por eso el hallazgo 1 y
la performance eran el mismo problema — con las fechas rotas, el 100% de las filas iba de a una.

### Corrida real (paquete completo del 22/06, oficina 9000001028)

| Etapa | Archivos | Filas | Resultado | Tiempo |
|---|---|---|---|---|
| Cuentas | 31 | 21.335 | 21.335 deudores · 46.799 contactos · **0 errores** | 5,8 min |
| Partidas | 31 | 1.115.323 | 1.115.322 facturas · **1 error** | **91 s** |
| Novedades | 27 | 4.552 | 1.997 procesadas, 2.555 descartadas por el filtro | 8 s |
| Bajas (desas. + extinciones) | 7 | 7 | 3 casos a GES-094 con comentario · **0 errores** | 1 s |

**Σfacturas = `Imp. Asignado` en 21.334 de 21.335 deudores.** El único desvío y el único error son la
misma fila: un ajuste sin número de comprobante e importe negativo en formato SAP (signo al final).

Las desasignaciones y las extinciones van **juntas en una sola remesa** de ACCIONES: comparten layout
y las dos significan lo mismo para la gestión. De las 7 cuentas dadas de baja el 20-21/07, solo 3
estaban en el paquete del 22/06 — el resto son de asignaciones anteriores. El preview de impacto lo
avisa antes de ejecutar.

118 tests nuevos en imports (263 → 381), incluidos bloques que corren contra los TXT reales y se
saltean si no están.

### Pendiente

Correr el flujo **desde el navegador** con los 31 archivos, y definir la oficina de cobro 9000000506
(mismo formato; solo llegaron sus novedades y bajas).

---

## [2026-07-31] — Tablero: el funnel mide estado, los KPIs miden período

> ⚠️ **Redeploy back + front.** Sin cambios de schema.

Continuación del arreglo del rango de fechas (abajo). Resuelta la causa principal, quedaba una
diferencia de criterio: el KPI **"Casos con pago"** contaba pagos *del período* y el funnel
**"Con pago"** sumaba además los casos en situación *Pagando* / *Cancelado*, **sin mirar la fecha**.

Mirando cómo se calculan los otros escalones, quedó claro cuál de los dos estaba fuera de lugar:

| Escalón | Cómo se calculaba |
|---|---|
| Asignados | estado actual — sin fecha |
| Contactados | situación categoría CONTACTADO — sin fecha |
| Con promesa | situación/gestión de promesa — sin fecha |
| **Con pago** | situación **+ pagos del período** ← el único mezclado |

**El funnel pasa a ser íntegramente estado acumulado**: "con pago" = casos con *algún* pago
registrado ∪ casos en situación Pagando/Cancelado, sin filtrar por fecha. Ahora los cuatro escalones
miden lo mismo y sus proporciones son comparables entre sí.

**No se hizo lo inverso** (que el funnel respete el período) porque **no hay dato para hacerlo bien**:
no existe histórico de transiciones de estado, así que "contactado dentro de julio" habría que
reconstruirlo desde la tabla de auditoría, que guarda el detalle en un JSON sin índice. Caro y frágil
para algo que se recalcula en cada refresh.

No son dos versiones del mismo número, son dos preguntas distintas — y las dos sirven:

- **KPI** → *¿cuánto entró este mes?* Es lo que justifica el selector de fechas.
- **Funnel** → *¿en qué estado está la cartera?* Foto acumulada.

Por eso el cambio se completa **rotulándolo**, que era lo que faltaba: el KPI pasa a
**"Casos con pago (período)"** con la aclaración *"Dentro del rango de fechas"*, y el funnel lleva el
subtítulo *"Estado actual de la cartera — no depende del período seleccionado"*.

De paso, el cálculo pasa de dos queries + un `Set` en memoria a **un solo `count` con `OR`**, que
deduplica en la base.

> Efecto a tener en cuenta: en carteras con pagos viejos, el "Con pago" del funnel va a mostrar más
> que antes, porque ya no se limita a los del período. Es lo correcto —es coherente con "Contactados",
> que siempre funcionó así— pero va a llamar la atención el primer día. En las dos remesas de Toyota
> el número no cambia (16 y 43): todos sus pagos caen dentro del período.

---

## [2026-07-31] — Tablero: el rango de fechas se comía el último día (y subestimaba la cobranza)

> ⚠️ **Redeploy back.** Sin cambios de schema ni de frontend.

Reportado como una incongruencia visual: para una remesa, las tarjetas de arriba decían
**"Pagos del período $0" y "Casos con pago 0"**, pero el funnel de más abajo decía **"Con pago 16"**.

La causa no era el funnel: era el **rango de fechas**. `new Date('2026-07-31')` devuelve **medianoche
UTC**, que en Argentina (UTC−3) son las **21:00 del 30/07**. O sea que el rango del tablero estaba
corrido tres horas hacia atrás en las dos puntas:

- **`hasta`**: todo lo del **último día del rango quedaba afuera**. Los pagos que genera el import
  quedan a medianoche local (`2026-07-31T03:00:00Z`), o sea justo del lado de afuera.
- **`desde`**: entraban de más las **últimas 3 horas del día anterior** al inicio del rango.

### No era solo esa remesa: venía subestimando toda la cobranza

Medido sobre producción con el rango 01/07–31/07:

| Remesa | Antes | Después |
|---|---|---|
| 00003 | $0 · 0 casos | **$24.118.853 · 16 casos** |
| 00001 | $54.305.123 · 28 casos | **$80.704.462 · 43 casos** |

La 00001 no se veía "rota" —mostraba un número plausible— pero le faltaban **$26,4 M y 15 casos**.
El síntoma visible fue la 00003 solo porque ahí *todos* los pagos caían el último día.

El bug afectaba a todo lo que se filtra por fecha: pagos del período, % recupero, ticket promedio,
casos con pago, mora promedio (que por eso mostraba "—"), y las series de pagos y de gestiones, a las
que siempre les faltaba el último día.

- Nuevo helper [rango-fechas.ts](backend/src/modules/dashboards/rango-fechas.ts): interpreta el
  `YYYY-MM-DD` del front en hora **local** y devuelve el día completo (`00:00:00.000` a
  `23:59:59.999`). Usado por `snapshot()` y por `drillDown()`, que tenían el mismo parseo duplicado.
- 9 tests sobre los bordes, que es justamente donde fallaba.

### Queda una diferencia de criterio (no es bug)

El KPI **"Casos con pago"** cuenta deudores con un pago **dentro del período**; el funnel **"Con
pago"** suma además los que están en situación *Pagando* o *Cancelado/Pagado*, **sin mirar la fecha**.
Con el rango arreglado los dos dan 16 en el caso reportado, pero pueden seguir difiriendo: un caso
cancelado en mayo cuenta en el funnel aunque se mire el tablero de julio. Es defendible (el funnel es
estado acumulado, el KPI es actividad del período), pero los rótulos no lo dejan claro.

---

## [2026-07-30] — Toyota TCFA: el domicilio va como contacto, no como dato adicional

> ⚠️ **Redeploy back + front.** Sin cambios de schema.

Reportado al revisar la primera carga real: el domicilio se estaba guardando en
`camposAdicionales.domicilio`, o sea en el cajón de "Datos Adicionales" de la ficha, cuando el
sistema ya tiene un tipo de contacto `direccion` con su propia sección, editable y validable.

Estaba además desaprovechando `prepararContactoImport()`, el helper canónico que usan el resto de las
categorías: arma el texto a partir de calle/número/CP/localidad/provincia y, **solo si la remesa pidió
validar domicilios**, lo normaliza contra Georef. Sin ese flag no hay llamadas de red.

- El layout del domicilio pasa de una lista de columnas a concatenar a una **forma estructurada**
  (`{ calle, numero, piso, departamento, cp, localidad, provincia }`). Es lo que le permite a Georef
  filtrar por localidad y provincia en vez de adivinar. Se sigue aceptando la forma vieja (array) para
  las plantillas ya guardadas.
- El domicilio del **codeudor** también va como contacto `direccion`, marcado `relacion=CODEUDOR`.
- Piso y departamento se anexan al número, que es el único lugar donde entran en el contacto.

### Los rellenos del cedente

Verificando contra el paquete real apareció que TCFA usa `0`, `S/N`, `SN`, `S/C` y `SIN_` como "este
campo no aplica". Sin filtrarlos quedaban direcciones como
`Barrio 7 de mayo mz 10 casa 25 **0 Dpto 0**` — que además de leerse mal arruina el matcheo con
Georef. Se comparan **completos**, así que una calle llamada `JOSE LUIS DEVOTA S/N` conserva su texto.

Resultado sobre el paquete del 29/05: **905 direcciones** (850 titulares + 55 codeudores). Los 4
titulares sin dirección son los que vienen con calle `S/C` y número `0`: no tienen domicilio, y ahora
no se les inventa uno. Los que traen piso/depto real bajaron de 100 a 69 (los otros 31 eran `0`).

5 tests nuevos. 263 en imports.

---

## [2026-07-30] — Toyota TCFA (fase 6): codeudores visibles en la ficha

> ⚠️ **Redeploy back + front + `npx prisma db push`** (nueva columna `contacto.relacion`, aditiva).

Última fase. Cierra la funcionalidad de TCFA: los codeudores que informa el cedente ya se cargaban,
pero el gestor no los distinguía del titular en la ficha.

### El bug que destapó: `subtipo` ya estaba ocupado

La fase 2 marcaba los contactos del codeudor con `contacto.subtipo = 'codeudor'`. **Esa columna ya
tiene dueño**: guarda el tipo de línea según los rangos de ENACOM (`MOBILE` / `FIXED_LINE`) y la ficha
la usa para **no dejar marcar un teléfono fijo como WhatsApp**
(`FichaContactosPanel`: `const esFijo = c.subtipo === 'FIXED_LINE'`).

Pisarla con `'codeudor'` rompía ese guard justo para los teléfonos del codeudor: se podía marcar un
fijo como WhatsApp y el envío iba a fallar en silencio. Apareció al abrir la ficha para la fase 6, no
antes: en el backend las dos cosas convivían sin quejarse.

**Arreglo: columna propia.** `contacto.relacion String?` — `null` = del titular, `"CODEUDOR"` = del
codeudor. El schema documenta los dos campos y por qué no hay que confundirlos.

### Backend

- `contacto.relacion` (aditiva, nullable). El detalle del deudor la devuelve sola (`contactos: true`).
- El parser emite `relacion: 'CODEUDOR'` y el processor la persiste; se sacó el paso de `subtipo`.
- Los contactos del codeudor se emiten **después** de los del titular a propósito: el unique es
  `(deudorId, tipo, valor)` y en el archivo real hay casos que comparten teléfono (el cliente 254056
  y su codeudor 254057). Con `skipDuplicates` gana el primero, que es el del titular.

### Frontend

- Los contactos del codeudor llevan una etiqueta **CODEUDOR** al lado del valor, en teléfonos, mails,
  direcciones y redes. Llamar a un codeudor creyendo que es el titular y reclamarle la deuda a la
  persona equivocada es un problema de gestión real, no cosmético.
- Tarjeta **Codeudores** con nombre, CUIT y domicilio de cada uno, desde
  `camposAdicionales.codeudores`. Esa clave se saca del grid de "Datos Adicionales", donde caía en el
  `JSON.stringify` del render genérico y se veía como un chorizo ilegible.

Con esto la carga de Toyota TCFA queda completa (fases 1 a 6).

---

## [2026-07-30] — Toyota TCFA (fase 5): desasignación de ausentes del snapshot

> ⚠️ **Redeploy back + front.** Sin cambios de schema.
> **La función queda APAGADA por default** — ver "Cómo se activa" abajo.

Última fase funcional de la carga de TCFA. El archivo de deudores es un snapshot completo de la
cartera vigente (en la bajada del 29/05, solo 120 de 854 casos eran del día), así que un caso que
deja de venir es un caso que el cedente retiró de la gestión. Con esto pasa a `GES-094` (Desasignado)
guardando su estado previo, y vuelve solo si reaparece.

### Cuatro salvaguardas, porque es la operación más destructiva del import

Un archivo que llegue parcial o mal mapeado saca de gestión media cartera de una. Ya pasó: el
**2026-07-21 un batch fallido desasignó 342.792 deudores de Toyota**. Por eso:

1. **Apagada por default.** `accionAusente` es `IGNORAR` si no se declara. La cuenta 87 —que comparte
   la misma clase base— ni siquiera resuelve los parámetros: no paga el costo de una función que no usa.
2. **Aborta si el archivo no matcheó nada.** Cero casos procesados → no se toca a nadie. Es el mismo
   guard que se le agregó a ACTUALIZACIONES después del incidente.
3. **Acotada a la cartera de la plantilla**, no a la empresa. Nuevo `ProcessContext.plantillaId`: el
   universo son los deudores cuya remesa se cargó con **esta misma plantilla**. Si fuera `empresaId` a
   secas, un import de TCFA desasignaría de rebote las otras carteras de la misma empresa.
4. **Alerta de proporción.** Si se desasigna ≥50% de la cartera, un `warn` con los números
   (desasignados / cartera / casos en el archivo) y la proporción queda también en la auditoría. No
   frena —desasignar es una decisión explícita de la plantilla— pero deja el rastro que faltó en julio.

Además no toca deuda, pagos, facturas ni situación, y saltea a los cancelados (SIT-050) y a los ya
dados de baja (GES-090).

### Re-asignación

El inverso: un caso que venía en `GES-094` y vuelve a aparecer recupera su estado de gestión anterior
(`estadoGestionPrevioAId`, o el default de la plantilla si el previo ya no existe) y se le limpia el
campo. No se re-asigna a los cancelados. Es idempotente.

Una sutileza que tiene su test: **una baja no cuenta como "presente"**. Que al caso le hayan bajado
una cuota no significa que el cedente lo siga asignando, así que el conjunto de presentes
(`deudoresEnSnapshot`) es distinto del de tocados (`deudoresTocados`).

### Cómo se activa

En el JSON de la plantilla: `"accionAusente": "DESASIGNAR"`. El preset de TCFA viene con `IGNORAR` y
el editor muestra un **chip rojo** y una alerta explicando la consecuencia cuando está en DESASIGNAR.

**Precondición para activarlo: confirmar con Toyota que el archivo de deudores trae SIEMPRE la cartera
completa.** Si puede venir parcial, no alcanza con estas salvaguardas — haría falta el guard de
variación porcentual bloqueante que se evaluó en la decisión D1.

### Tests

15 tests nuevos (39 en el processor de TCFA, 258 en imports): que está apagada por default y sin
queries de más, que desasigna solo a los ausentes guardando el previo, que acota por plantilla, que
saltea cancelados / dados de baja / ya desasignados, los dos abortos, el modo degradado sin GES-094,
que una baja no cuenta como presente, la auditoría con la proporción, y los cuatro casos de
re-asignación.

---

## [2026-07-30] — Toyota TCFA (fase 4): frontend del paquete multi-archivo

> ⚠️ **Redeploy back + front + `npx prisma db push`** (el push viene de la fase 3, todavía falta en prod).

Cuarta fase: la carga de Toyota TCFA queda operable desde la UI de punta a punta.

### Frontend

- **`MultiarchivoDropZone.tsx`** — zona de subida de varios archivos a la vez. Muestra un chip con el
  **rol detectado de cada archivo** (Deudores / Detalle de deuda / Bajas / Codeudores) y avisa antes de
  subir si falta un obligatorio, si hay uno sin reconocer, si sobra un duplicado o si alguno matchea
  más de un patrón. Se pueden arrastrar de a uno o todos juntos, en cualquier orden, y quitar los que
  sobren.
- **`MultiarchivoEditor.tsx`** — editor del layout de la plantilla, con el preset de TCFA en un click
  (mismo criterio que el editor de multirregistro: es config técnica que se toca al dar de alta la
  cartera). Valida el JSON en vivo y avisa si las bajas no declaran qué motivos son un cobro.
- **`CategorySelector`** — nueva tarjeta "Multiarchivo".
- **`PlantillaEditor`** — cableado de la categoría (10 puntos: lista, entity, estado, carga, guardado,
  separador por defecto en `;`, render).
- **`ImportWizard`** — estado del paquete, `FormData` con `files`, alerta del resumen en el preview
  (casos, cuotas, bajas, codeudores, cuotas descartadas y casos sin detalle) y las guardas de avance.

La detección de roles del front usa los mismos patrones de la plantilla que el backend, pero es
**solo para dar feedback**: decirle al operador "te falta DetalleDeuda" antes de subir es mejor que un
400 después de esperar la carga. La validación que vale sigue siendo la del backend.

### Un bug que casi se va con el cambio

El wizard tenía **dos** validaciones del paso 1: la del handler y la del botón "Siguiente"
(`canGoNext()`), que exigía `file` no nulo. Con MULTIARCHIVO `file` queda en `null` —el paquete va en
otro estado—, así que el botón hubiera quedado **deshabilitado para siempre** y la categoría sería
imposible de usar, sin ningún mensaje de error. Apareció revisando el diff, no probando.

### Tests

6 tests nuevos en `multiarchivo-wiring.spec.ts` sobre `createRemesa`, que era la última pieza del
backend sin cubrir: guarda los 4 archivos con su mapa de roles, el hash del paquete no depende del
orden de subida, rechaza el paquete incompleto / el archivo no clasificable / la plantilla sin layout,
y una regresión de que las categorías de un solo archivo siguen guardando igual. Total en imports:
**244 tests**.

### Pendiente de probar a mano

Todo está cubierto por tests, pero **el flujo real todavía no se corrió**: subir los 4 archivos desde
el navegador y ejecutar la importación contra la base. Es lo que falta antes de darlo por bueno.

### Deuda menor

El preset de TCFA está duplicado entre `backend/.../plantillas/toyota-tcfa.ts` y
`frontend/.../MultiarchivoEditor.tsx`, igual que el de la cuenta 87: el front necesita ofrecerlo sin
pedirlo al backend. Lo que manda en producción es lo que quede guardado en la plantilla, así que la
copia del front es solo el valor inicial — pero si se corrige un layout hay que tocar los dos.

---

## [2026-07-30] — Toyota TCFA (fase 3): cableado multi-archivo

> ⚠️ **Redeploy back + `npx prisma db push`.** El schema cambia (aditivo: una columna nullable y dos
> enums ampliados). Ya aplicado en la base de desarrollo; **falta correrlo en prod al deployar.**

Tercera fase: la categoría `MULTIARCHIVO` queda operativa de punta a punta en el backend. Con esto se
puede crear la remesa subiendo los 4 archivos, validarla y ejecutarla. Falta el frontend (fase 4).

### Base de datos

```sql
ALTER TABLE remesa ADD COLUMN archivos JSON NULL;
-- + MULTIARCHIVO en los enums remesa.categoria y plantillaimport.categoria
```

`remesa.archivos` guarda el mapa rol → path (`{ deudores, detalle, bajas, codeudores }`). `archivo`
sigue apuntando al principal (Deudores) para no romper hash, borrado ni el resto del código que lo
asume. El diff se verificó con `prisma migrate diff` antes de aplicarlo: sin drops ni pérdida de datos.

### Backend

- **`utils/roles-multiarchivo.ts`** + 12 tests — resuelve qué archivo es cuál por su nombre, con los
  patrones de la plantilla. **Falla fuerte ante cualquier duda** en vez de adivinar: si falta un
  obligatorio, si sobra uno que no matchea, si dos compiten por el mismo rol o si un archivo matchea
  varios patrones, tira un 400 que nombra el archivo concreto. Cargar CoDeudores como si fuera
  Deudores generaría 55 casos basura y le pisaría la deuda a la cartera; es más barato que el operador
  vuelva a subir. Tolera sufijos de fecha (`Deudores_20260529.txt`) sin tocar código.
- **`imports.controller.ts`** — `FileFieldsInterceptor` con los campos `file` (1) y `files` (hasta 6).
  **Retrocompatible**: el frontend actual manda `file` y sigue funcionando igual.
- **`imports.service.ts`** — `createRemesa` guarda el paquete y calcula un hash determinístico del
  conjunto; `leerPaqueteMultiarchivo()` lo relee validando que siga en el disco; ramas nuevas de
  preview y de worker; `ctx.multiarchivoConfig`.
- **`processor-registry.ts`** — se registra `MultiarchivoProcessor` (el cabo suelto que dejó la fase 2),
  ahora que el enum existe. Nuevo `processor-registry.spec.ts` que asserta las 10 categorías, para que
  un processor sin registrar no vuelva a pasar desapercibido.
- **`multiarchivo-wiring.spec.ts`** — 7 tests que ejercitan el service completo contra el paquete real
  del 29/05 con `prisma` mockeado: el preview devuelve 854 casos, 920 cuotas, 85 bajas, 55 codeudores,
  61 cuotas descartadas y 66 casos sin detalle, cruzando los 4 archivos de verdad.

El preview de MULTIARCHIVO **persiste `totalFilas`**, que es lo que usa el runner para el % de
progreso. MULTIRREGISTRO no lo hace (sale por un `return` temprano) y por eso su barra queda clavada
en 0 — no se tocó para no cambiar el comportamiento de la cuenta 87 en una fase de TCFA.

### Hallazgo: la mitad de la suite de tests no estaba corriendo

Al escribir el test de wiring apareció que `jest` no tenía **`moduleNameMapper`**, así que cualquier
spec que importara —aunque fuera transitivamente— un archivo con el estilo de path absoluto
`src/prisma/prisma.service` (que usa medio backend) **moría al cargar el módulo**, sin llegar a correr
un solo test.

Se agregó `"moduleNameMapper": { "^src/(.*)$": "<rootDir>/$1" }` en `package.json`. Efecto medido:

| | Suites en rojo | Tests en rojo | Pasando |
|---|---|---|---|
| Antes | 6 | 7 | 364 |
| Solo con el mapper | las mismas 6 | **18** | 364 |
| Con la fase 3 completa | las mismas 6 | 18 | **458** |

O sea: **el mapper no rompió nada, destapó 11 fallas que ya existían y estaban ocultas.** Las 6 suites
en rojo (reportes, comentarios, consolidación) son las mismas de siempre y ninguna es de imports —
quedan pendientes de arreglar aparte, ahora con el detalle visible.

---

## [2026-07-30] — Toyota TCFA (fase 2): processor compartido con la cuenta 87

> Sin impacto en runtime: el processor nuevo **todavía no está registrado** (ver "Cabo suelto").
> El refactor de MULTIRREGISTRO sí toca código en producción — **requiere redeploy back**, sin migración.

Segunda fase de la carga de Toyota TCFA (ver fase 1 abajo y
[docs/imports-toyota-tcfa-spec.md](docs/imports-toyota-tcfa-spec.md)).

La lógica de negocio de las dos carteras es la misma —casos completos + bajas por factura, con pago
parcial— y ya estaba resuelta en `MultirregistroProcessor`, con varios incidentes de prod incorporados.
Se extrajo a una base compartida en vez de duplicarla:

```
CasosCedenteProcessor (abstract)   ← toda la lógica de negocio
├── MultirregistroProcessor        ← cuenta 87: motivos por texto, placeholder SIN_DOC_
└── MultiarchivoProcessor          ← TCFA: motivos por código, placeholder canónico
```

Las subclases quedan en ~25 líneas cada una: solo declaran de dónde salen los motivos de baja y qué
documento usar cuando el archivo no trae DNI. Los 29 tests de la cuenta 87 pasan sin cambios de
comportamiento (una sola aserción ajustada, que fijaba la proyección del `aggregate`).

### Backend

- **`processors/casos-cedente.processor.ts`** — base nueva con la lógica compartida.
- **`processors/multiarchivo.processor.ts`** — subclase de TCFA + 25 tests.
- **`processors/multirregistro.processor.ts`** — pasa a ser una subclase fina.
- **`processor.interface.ts`** — nuevo `ProcessContext.multiarchivoConfig`.

### Los seis ajustes sobre la lógica de la cuenta 87

1. **Documento real.** Si el archivo trae CUIT/CUIL se usa ése (TCFA lo trae en el 100%). Además, si
   el caso ya estaba cargado **con placeholder**, se completa con el documento real. Nunca se pisa un
   documento real con otro: eso es un cambio de identidad que tiene que revisar una persona.
2. **Vencimiento real** de la factura, y se actualiza si el cedente lo corre. Antes se hardcodeaba
   `new Date()` porque la cuenta 87 no manda vencimiento.
3. **Baja resuelta por cliente.** TCFA dice de quién es la baja → se llega al deudor y a la factura por
   su unique, sin ambigüedad. La cuenta 87 solo manda el nro de aviso y conserva el camino viejo
   (búsqueda empresa-wide + guard que no da de baja a nadie si matchea a dos deudores).
4. **Motivo de baja por código.** Se prefiere `IDMotivo` sobre el texto cuando la plantilla lo declara:
   el cedente puede reescribir el texto, el código no. TCFA: solo el `1` (Pago de Cuota) es plata que
   entró; el `4` (Envio a Gestion Especial) y el `3` (Contrato Finalizado) son retiros.
5. **`montoTotal` de los casos sin cuotas.** Los 66 casos de TCFA que traen `TotalDeuda` pero ya no
   traen detalle quedaban en deuda 0 y desaparecían de la cartera. Ahora se usa el total declarado —
   pero **solo si el deudor no tiene ninguna factura cargada**: si las tiene todas anuladas, el saldo
   real es 0 y restaurar el declarado resucitaría deuda que el cedente retiró. Hay un test para eso.
6. **`subtipo` en los contactos.** El parser marca los del codeudor y ahora el processor lo persiste.
   Llamar a un codeudor creyendo que es el titular es un problema real de gestión (la mitad visible,
   en la ficha, queda para la fase 6).

Además, `parseFechaBaja()` —el regex de ancho fijo que rompía con las fechas de TCFA— se reemplazó por
`parseFechaCedente()` de la fase 1.

### Cabo suelto deliberado

**`MultiarchivoProcessor` NO está en `processor-registry.ts`.** `getCategories()` devuelve
`getSupportedCategories()` y alimenta el combo de categorías del frontend: registrarlo ahora dejaría
elegir una categoría que la DB todavía no puede guardar (falta el valor `MULTIARCHIVO` en los enums
`remesa_categoria` y `plantillaimport_categoria`). **La fase 3 agrega enum + registro + endpoint juntos.**

### Deuda técnica anotada

La cuenta 87 genera su placeholder de documento como `SIN_DOC_${nroCliente}`, distinto del
`placeholderDocumento()` canónico (`SIN-DNI-`) que usa el resto de las categorías. **Se dejó como
estaba a propósito**: hay cartera en prod cargada con ese prefijo desde 2026-07 y cambiarlo dejaría la
misma empresa con dos convenciones conviviendo, que es peor que una sola no estándar. Consecuencia:
`esDocumentoPlaceholder()` no reconoce esos deudores (`enriquecimiento-historico.ts` sí contempla los
dos prefijos). Unificar requiere un UPDATE puntual sobre los deudores ya cargados. TCFA arranca
directamente con el canónico.

---

## [2026-07-30] — Toyota TCFA (fase 1): parser del paquete de 4 archivos

> Sin impacto en runtime todavía: es código nuevo, sin cablear al pipeline. No requiere redeploy.

Carga nueva de Toyota TCFA: el cedente manda **4 archivos separados** (`Deudores`, `DetalleDeuda`,
`Bajas`, `CoDeudores`) en vez del TXT multirregistro de la cuenta 87. La semántica de negocio es la
misma (cliente → contratos → cuotas, bajas por cuota con pago parcial o total), pero el formato y el
modelo de claves no. Análisis completo y decisiones en
[docs/imports-toyota-tcfa-spec.md](docs/imports-toyota-tcfa-spec.md).

**Decisión de arquitectura: parser nuevo, processor reusado.** El parser de MULTIRREGISTRO no sirve
(asume un archivo, discriminador por código de línea y clave de cruce simple); el processor sí, porque
ya encapsula la lógica difícil de las bajas. El parser nuevo emite **las mismas filas normalizadas**
(`_tipo: 'CASO' | 'BAJA'` con `_blocks`), así que la fase 2 solo tiene que adaptar el processor.

### Backend

- **`utils/multiarchivo-parser.ts`** — cruza los 4 archivos y emite las filas del pipeline. Layout por
  **nombre de columna** (no por índice: los archivos traen header) y sin distinguir mayúsculas, porque
  el cedente escribe `codprovincia` en un archivo y `CodProvincia` en otro.
- **`utils/fecha-cedente.ts`** — `parseFechaCedente()`. Las fechas vienen `D/M/YYYY` **sin cero a la
  izquierda** (`29/5/2026 00:00:00`, `1/12/2025 00:00:00`): el regex de ancho fijo que usa el processor
  de la cuenta 87 fallaría en la mayoría y caería silenciosamente a la fecha del día. Valida además que
  el día exista (`31/2/2026` → `null`, no 3 de marzo).
- **`mapping-types.ts`** — `MultiarchivoConfig` + `MappingJson.multiarchivo`. Aditivo, sin tocar nada
  existente.
- **`plantillas/toyota-tcfa.ts`** — el layout real como referencia para crear la plantilla y testear.
- 37 tests nuevos, incluido un bloque contra el paquete real del 2026-05-29 (se saltea si no está).

### El hallazgo que define la carga

**El detalle se joinea por `IdAsignacion`, nunca por `cliente`.** `DetalleDeuda.txt` trae cuotas de
asignaciones viejas que el cedente sigue mandando, y un cliente reasignado tiene las suyas en el mismo
archivo bajo otro `IdAsignacion`:

| Join | `TotalDeuda` coincide con Σ cuotas | `CuotasVencidas` coincide |
|---|---|---|
| por `cliente` | 786 / 854 | 786 / 854 |
| **por `IdAsignacion`** | **788 / 788** | **788 / 788** |

Joineando por cliente, al `475931` se le pegan cuotas de 2025 y su deuda pasa de $2.199.415 a
**$6.878.743**. Hay un test dedicado a esto y el bloque del archivo real lo asserta sobre los 788 casos.

Corolario: **`IdAsignacion` no es estable entre bajadas** (el cliente `488744` tiene 366960 en la baja
y 368366 hoy), así que sirve para joinear dentro del paquete pero **no** como clave del deudor. La clave
estable es `cliente`, igual que en la cuenta 87.

### Otros datos del paquete real (2026-05-29)

854 deudores · 981 cuotas (920 vigentes + 61 descartadas) · 85 bajas · 55 codeudores.

- Viene **CUIT/CUIL real en el 100%** (único en los 854) → a diferencia de la cuenta 87, no hacen falta
  placeholders `SIN-DNI-`.
- El importe de la cuota es la suma de **11 conceptos** (`capital`…`iva_mor_pun`). `saldocontrato` **no**
  es el importe: sumarlo da mal en el 100% de los casos.
- `nroFactura` se compone `contrato-cuota` (el archivo no trae identificador de cuota; el par es único
  incluso a nivel global porque el contrato no se comparte entre clientes).
- Las 85 bajas refieren a cuotas que **no** vienen en el detalle del día (0 de 85 matchean), igual que
  en la cuenta 87 → se resuelven contra lo ya cargado. Motivos: `1` Pago de Cuota (65), `4` Envio a
  Gestion Especial (18), `3` Contrato Finalizado (2). **Solo el 1 es plata que entró.**
- 66 casos (todas asignaciones de 2020) no traen ninguna cuota: se cargan con el total declarado y sin
  facturas.

### Decisiones tomadas

Ausentes del snapshot → `GES-094` (el archivo es snapshot completo: solo 120 de 854 son del día) ·
bajas 3 y 4 → factura `ANULADA` + `GES-090`/`SIT-071` · codeudores → contactos con `subtipo='codeudor'`
+ `camposAdicionales` · subida → multi-select con rol detectado por nombre de archivo.

**Pendiente antes de la fase 5:** confirmar con el cedente que `Deudores.txt` trae siempre la cartera
completa. Si puede venir parcial, desasignar es peligroso y hace falta un guard de variación.

---

## [2026-07-27] — Tablero: el filtro de remesa muestra el número, y solo las que tienen cartera

> ⚠️ **Redeploy back + front** (solo código, sin migración).

Reportado por los usuarios: en el tablero, el combo de remesas de Toyota mostraba
`Remesa 28/7/2026, 11:52:15` y `Remesa 28/7/2026, 11:48:13` — dos cargas del mismo día imposibles de
distinguir. Ese texto es el **nombre**, que el wizard autogenera con la fecha cuando el operador no
escribe uno; lo que la gente usa para referirse a una carga es el **número**.

- Nuevo helper [utils/remesa.ts](frontend/src/utils/remesa.ts) `etiquetaRemesa()`, usado en el filtro del
  tablero y en los dos selectores de remesa origen del wizard, para que no se desincronicen.
- **El combo del tablero ahora lista solo las remesas con cartera cargada** (`?conDeudores=true` en
  `GET /import/remesas/empresa/:id`). Filtrar el tablero por una remesa de PAGOS o ACTUALIZACIONES
  devuelve 0 casos —los deudores cuelgan de la remesa donde se crearon—, así que eran opciones inútiles.

Los datos de prod explican por qué esto además resuelve el problema de los números feos:

| Categoría | Remesas | Con número timestamp | Con deudores |
|---|---|---|---|
| DEUDORES | 14 | **0** | 14 |
| MULTIRREGISTRO | 3 | **0** | 3 |
| ACTUALIZACIONES · PAGOS · FACTURAS · CONTACTOS · ACCIONES | 31 | **31** | **0** |

Las **17 remesas con deudores tienen todas número legible** (`00102`, `00503`, `00606`, `00001`…); los
`numeroRemesa` con timestamp del wizard viejo están exactamente en las categorías que no representan una
cartera. Aun así el helper contempla el caso (muestra `s/n · fecha` en vez del chorizo de 13 dígitos),
porque el selector del wizard sí puede toparse con ellas.

> El combo de Toyota pasa a mostrar `00003` / `00002` / `00001`; TELECOM, `22222` / `00606`.

---

## [2026-07-27] — Categoría MULTIRREGISTRO: archivo diario de Toyota cuenta 87 (backend)

> ⚠️ **Redeploy back + `npx prisma db push`** (columna nueva `factura.detalle` + valor `MULTIRREGISTRO`
> en los dos enums de categoría; ambos aditivos, no destructivos). **Sin frontend todavía**: la plantilla
> se crea con el `mappingJson` a mano, como estaba previsto en la Fase B0 del spec.

Toyota manda **un solo archivo diario con cuatro tipos de línea** (`GES`/`CLI`/`DET`/`BAJ`) que hay que
agrupar para armar cada caso. El pipeline asume "1 fila = 1 registro", así que no encajaba.

**Decisión de arquitectura**: híbrido, no motor genérico configurable. La **estructura** (qué tipo de
línea es el deudor, cuál la factura, cómo se vinculan) vive en código, porque generalizar "N tipos de
registro con M relaciones" es construir un ETL para un solo cedente — y el formato de config que proponía
el spec ni siquiera podía expresar los dos saltos de vínculo del archivo real. El **layout** (qué índice
de columna es cada dato), que es lo que puede moverse sin aviso, va en la plantilla y se corrige sin deploy.

**Parser** ([utils/multirregistro-parser.ts](backend/src/modules/imports/utils/multirregistro-parser.ts))
- Decodifica **Latin-1** (el cedente no manda UTF-8: leído mal se rompen las Ñ y los acentos), discrimina
  por código de línea, agrupa y emite filas ya normalizadas: `CASO` (cliente + sus facturas + contactos) y
  `BAJA` (aviso suelto). El pipeline las consume sin pasar por `mapRow`.
- El importe de cada factura se **calcula sumando los `DET` con su signo** — hay 5 notas de crédito
  negativas, una de −930.790,81 — en vez de leer el total del `GES`. Da idéntico (verificado en los 271
  avisos) pero es robusto si el cedente cambia el total.
- El desglose de conceptos se arma como texto, con los días de mora al final; se descarta el ruido del
  formato (`Cargo por Pago Fuera de Termino`, que viene en los 271 avisos con importe 0 y un fijo de 180.90).
- Devuelve advertencias por caso (cliente sin ficha, aviso repetido) que el runner guarda como errores de
  la remesa para que queden visibles.

**Processor** ([processors/multirregistro.processor.ts](backend/src/modules/imports/processors/multirregistro.processor.ts))
- **El deudor se busca EMPRESA-WIDE por `nroCliente`**, no por remesa. Es la consecuencia directa de que
  los casos nuevos entren en una remesa nueva por día (B-D6): buscarlo por remesa lo duplicaría a diario.
- Las facturas se upsertean por `(deudorId, nroFactura=aviso)` y **solo se escriben si algo cambió** — en
  un archivo diario la mayoría llega igual que ayer salvo los días de mora. El contrato va en `externalId`.
- `montoTotal` del deudor = Σ de sus facturas. Los contactos se normalizan con el mismo criterio que el
  resto de los processors (E.164 + descarte de basura).
- Las bajas resuelven aviso → factura → deudor → **GES-090**, también empresa-wide, porque refieren a
  avisos que no vienen en el `GES` del mismo archivo. Si el aviso no está cargado, avisa y sigue.

**Correlativo de remesa** ([utils/numero-remesa.ts](backend/src/modules/imports/utils/numero-remesa.ts))
- El `numeroRemesa` lo mandaba el frontend y, si el operador lo dejaba vacío, caía a `Date.now()` — el
  origen de los "números de remesa random" (`1784657478166`) reportados hoy. Ahora el backend genera el
  **correlativo de la empresa** (último + 1, conservando el ancho: `00001` → `00002`). Los timestamps
  viejos se ignoran a propósito: si entraran al cálculo, el contador saltaría a 1784657478167 sin vuelta atrás.

**Schema**: `factura.detalle` (Text, para el desglose) y `MULTIRREGISTRO` en `plantillaimport_categoria`
y `remesa_categoria`.

**Verificación end-to-end contra la base**, corriendo el archivo real (1.720 líneas) **dos veces seguidas**
para simular dos días:

| | Día 1 | Día 2 (mismo archivo) |
|---|---|---|
| Deudores | 162 | 162 — **no duplica** |
| Facturas | 271 | 271 — **no duplica** |
| Contactos | 370 | 370 — **no duplica** |
| Remesa | `00001` | `00002` (correlativo) |

Σ facturas = Σ `montoTotal` de los deudores = **26.759.681,60**. El aviso 170502 quedó con importe
55.406,65, contrato `2009869` en `externalId` y desglose `Comisión Gestoria Multas: 45790.62 | Cob IVA ctr
fin 346395: 9616.03 | Días de mora: 87`. El cliente 103966 (6 contratos) quedó como **un** caso con 6
facturas. Los nombres con Ñ y acentos se guardaron bien (`ACUÑA HAEDO IVÁN`). Las 10 bajas no matchearon
ninguna factura, que es lo correcto: sus avisos no vienen en el `GES`.

**Tests**: 127 verdes en `imports` (+42). El spec del parser corre **contra el archivo real** del cedente
y verifica que los 271 importes calculados coincidan con el total del `GES`, sin advertencias.

**Frontend** (completado en el mismo día — la feature queda operable de punta a punta)
- [CategorySelector.tsx](frontend/src/components/import/CategorySelector.tsx): card **Multirregistro**.
- [MultirregistroEditor.tsx](frontend/src/components/import/MultirregistroEditor.tsx) **(nuevo)**: editor
  del layout en el `PlantillaEditor`, con botón **"Cargar layout de Toyota 87"** que deja el preset listo,
  validación en vivo del JSON (avisa si falta un bloque obligatorio) y chips con los tipos de línea
  detectados. Se edita como JSON a propósito: es config técnica que se toca una vez al dar de alta la
  cartera. Reemplaza al mapeador de columnas para esta categoría, igual que hace ACCIONES con su editor.
- [ImportWizard.tsx](frontend/src/pages/ImportWizard.tsx): MULTIRREGISTRO **no pide remesa origen** (el
  archivo trae todo), y el paso de vista previa muestra un resumen del parseo —
  *"162 casos · 271 avisos · 10 bajas · se leyeron 1.720 líneas (GES: 271 · CLI: 162 · DET: 1277 · BAJ: 10)"*—
  con las advertencias listadas si las hubo.
- [FichaFacturasTab.tsx](frontend/src/components/deudores/ficha/tabs/FichaFacturasTab.tsx): columna
  **Contrato** (solo aparece si alguna factura lo trae, para no ensuciar el resto de las carteras) y el
  **desglose desplegable** por factura, con un chip por concepto.
- **Preview del backend** (`POST /import/validar/:id`): para MULTIRREGISTRO el preview no puede ser "las
  primeras N filas del CSV" —una fila suelta no significa nada— así que devuelve los primeros **casos ya
  armados** (cliente, nombre, cantidad de avisos, importe total, contratos) más el resumen del parseo.

**Corrección del `numeroRemesa` en el wizard**: el frontend mandaba `Date.now()` cuando el operador dejaba
el campo vacío, lo que **anulaba el correlativo nuevo**. Ahora manda vacío y decide el backend. El texto de
ayuda del campo lo explica.

> ⚠️ **Bug del cambio anterior, corregido el mismo día** (reportado en la prueba): con el frontend ya
> mandando el campo vacío, el DTO seguía con `@IsNotEmpty()` en `numeroRemesa`, así que crear la remesa
> fallaba con **"numeroRemesa should not be empty"** antes de llegar al servicio. Los tests del correlativo
> no lo detectaron porque prueban la función pura, no el contrato HTTP. `numeroRemesa` pasa a `@IsOptional()`
> y se agrega [create-remesa.dto.spec.ts](backend/src/modules/imports/dtos/create-remesa.dto.spec.ts) que
> valida el DTO con el campo vacío, ausente y cargado a mano.

**La baja es POR AVISO, no por deudor** (2026-07-27, definido con los usuarios durante la prueba). Un
cliente con 6 avisos al que le dan de baja 2 **sigue vigente con los otros 4**; antes un solo `BAJ`
mandaba el caso entero a GES-090. Qué se hace con el aviso lo decide el **motivo**:

| Motivo | Efecto |
|---|---|
| `Pago de Cuota/Aviso` (configurable en `baj.motivosPago`) | Se registra un **pago** por el importe del aviso (con la fecha del `BAJ`) y la factura queda `PAGADA`. |
| Cualquier otro — en el archivo real, `Días de Mora Excedidos` | **No se registra pago.** La factura queda `ANULADA`: el cedente la retiró de la gestión y deja de sumar a la deuda. |

> La distinción no es un detalle: en el archivo del 24/07, **9 de las 10 bajas son "Días de Mora
> Excedidos"**. Cargar un pago por cada baja habría inventado plata que nunca entró — el mismo error que
> causó el incidente del 2026-07-21.

- `montoTotal` del deudor pasa a ser Σ de sus facturas **excluyendo las ANULADAS**. Las `PAGADA` sí siguen
  sumando (fueron deuda real) y es el pago registrado el que baja el saldo vía consolidación.
- El deudor pasa a **GES-090 solo cuando se queda sin ningún aviso vigente**.
- El resumen del import y la auditoría discriminan: avisos dados de baja por pago, retirados, y deudores
  que quedaron fuera de gestión.
- Ficha de facturas: la `ANULADA` se muestra atenuada, con el importe tachado y un tooltip que aclara que
  no se reclama ni suma a la deuda.

**Bug en prod: una baja por cobro se anuló en vez de registrar el pago** (2026-07-27, detectado por los
usuarios con un caso testigo). El aviso `171298` del deudor 382060 vino como `Pago de Cuota/Aviso` y
terminó con la factura **ANULADA** y sin pago: se perdió el registro de un cobro de **$82.706,87**.

No fue un error de la lógica de match sino de **configuración silenciosa**: la plantilla de Toyota se
creó *antes* de que existiera `motivosPago`, así que el campo no estaba en su `mappingJson`. El código
hacía `motivosPago ?? []` → lista vacía → ningún motivo contaba como pago → todas las bajas caían en la
rama "retirado por el cedente".

- **`resolverMotivosPago`**: si la plantilla **no trae el campo**, se cae a un default (`['Pago']`) y se
  loguea un `warn` una vez por corrida, en vez de asumir en silencio que ninguna baja es un cobro. Un
  array **vacío explícito** sí se respeta: eso es una decisión, no un olvido.
- **Editor de plantilla**: avisa en amarillo si la config de bajas no declara `motivosPago`, y muestra un
  chip con los motivos configurados.
- **Corregido en prod**: la plantilla 57 ahora declara `motivosPago: ["Pago de Cuota"]`; la factura
  `171298` pasó a `PAGADA`, se registró el pago de $82.706,87 con fecha 27/07 y el `montoTotal` del deudor
  volvió a 82.706,87. El deudor queda en GES-090, que es correcto: era su único aviso y se cerró.

> Las otras dos facturas anuladas de la empresa (`170724`, `170493`) sí corresponden a "Días de Mora
> Excedidos" y quedaron bien.

**La consolidación no alcanzaba a los deudores de remesas previas** (2026-07-27, detectado por los usuarios
sobre el mismo caso: el pago quedó registrado pero el deudor seguía con `saldo` en null y sin pasar a
cancelado). El `afterAll` consolidaba `{ tipo: 'REMESA', remesaId }` — o sea **solo la remesa del import**,
donde únicamente están los casos nuevos del día. Como el match del deudor es empresa-wide y los nuevos
entran en una remesa nueva cada día (B-D6), un deudor de una remesa previa al que hoy se le registra un
pago por baja **nunca se recalculaba**: ni el saldo ni la situación.

- El processor acumula ahora los **deudores tocados** (altas, actualizaciones y bajas) y al final consolida
  `{ tipo: 'DEUDORES', deudorIds }`, sin importar en qué remesa esté cada uno. El log de cierre informa
  cuántos quedaron cancelados y cuántos en pago parcial.
- Se agrega el cierre de **promesas cumplidas** por los pagos que generan las bajas, igual que hacen PAGOS
  y ACTUALIZACIONES.
- **Corregido en prod**: el deudor 382060 quedó con `saldo` 0 y **SIT-050 (Cancelado / Pagado)**.

**El caso dado de baja también marca la SITUACIÓN** (2026-07-27, pedido de los usuarios). Hasta ahora la
baja solo tocaba la gestión (`GES-090`, "sale del circuito de trabajo"); faltaba decir **en qué terminó la
deuda**. Al quedarse sin avisos vigentes, el deudor pasa además a **`SIT-071` (Dado de baja / Rescisión)**.

El orden del `afterAll` resuelve solo la interacción con la consolidación, sin lógica extra:

| Cómo se cerró el caso | Situación final |
|---|---|
| El cliente **pagó** el último aviso | Se pone SIT-071 y la consolidación lo **pisa con SIT-050** (Σpagos ≥ montoTotal) |
| El cedente lo **retiró** por mora, sin pago | Σpagos = 0 → la consolidación lo **saltea** y queda **SIT-071** |

Si `SIT-071` no estuviera seedeado, se loguea un `warn` y la baja de gestión se aplica igual: la situación
es un dato de color, no debe frenar el cierre del caso.

> **Corregido en prod**: el deudor 381877 (baja por mora, sin pagos) pasó de SIT-001 a **SIT-071**. El
> 382060 se dejó en SIT-050 porque pagó.

**Baja segura ante números de factura ambiguos** (2026-07-27, salido de la prueba con usuarios): el
registro `BAJ` trae **solo el nro de aviso**, sin cliente ni contrato, así que la baja se resuelve
`aviso → factura → deudor`. El problema: el unique de `factura` es `(deudorId, nroFactura)`, **no** por
empresa, así que dos deudores distintos pueden compartir el número — y en prod pasa a lo grande
(`Saldo Impago` lo comparten **690 deudores** en la empresa 16, 419 en la 7; en la empresa 3 hay números
`85`..`89` repetidos en ~60 deudores cada uno). Un `findFirst` habría dado de baja a uno al azar,
sacando de gestión un caso activo sin que nadie se entere. Ahora, si el aviso matchea más de un deudor,
**no se da de baja a ninguno**: se cuenta como `bajasAmbiguas`, se loguea con los ids involucrados y se
resuelve a mano.

> **Pendiente para operar**: crear la plantilla desde *Plantillas → Nueva → Multirregistro*, apretar
> "Cargar layout de Toyota 87" y elegir los estados iniciales. **Ojo con la empresa**: en prod hay
> `TOYOTA PLAN DE AHORRO`, `TOYOTA REFINANCIACION`, `TOYOTA RELEVAMIENTO` y `TOYOTA VENTA SEGUROS`, pero
> ninguna identificada como la cuenta 87 — hay que definir cuál usar o darla de alta.
>
> El `prisma db push` lo corre solo el pipeline de deploy. Los cambios son aditivos (columna nullable +
> valores de enum) y en prod hay 48.240 facturas sobre MySQL 8.0.45, donde `ADD COLUMN NULL` es instantáneo:
> no debería trabar el deploy.

---

## [2026-07-27] — Transformaciones nuevas: quitar comilla doble y quitar guiones

> ⚠️ **Redeploy back + front** (solo código, sin migración). Retrocompatible: las plantillas
> existentes no cambian, son dos opciones más en el selector de transformaciones.

Dos pedidos de los usuarios sobre el mapeo de columnas:

**Backend** ([transforms.ts](backend/src/modules/imports/transforms.ts))
- **`removeDoubleQuotes`** — quita la comilla doble recta `"` y las tipográficas `“ ”` (Word/Excel las
  autocorrigen). Para CSV que traen los valores entrecomillados y el parser no las saca. Es la hermana
  de `removeQuotes`, que sigue siendo solo para la comilla simple.
- **`removeDashes`** — quita guiones. El caso que lo motivó: **pagos que vienen con el signo negativo
  adelante** (`-1.234,56` → `1.234,56`), para cargarlos por su valor absoluto. Contempla las variantes
  unicode además del guión ASCII: hyphen `‐`, en dash `–`, em dash `—` y el signo menos real `−`.
  Quita **todos** los guiones del valor, no solo el del principio (aplicado a un CUIT
  `20-12345678-9` devuelve `20123456789`).

**Frontend** ([MappingEditor.tsx](frontend/src/components/import/MappingEditor.tsx))
- Dos opciones nuevas en el selector: `Quitar comilla doble ( " )` y
  `Quitar guiones ( - ) — ej. importes negativos`.

**Tests**: nuevo [transforms.spec.ts](backend/src/modules/imports/transforms.spec.ts) (16 casos; antes
no había spec de transformaciones). 85 verdes en `imports`.

> ⚠️ **El orden importa** para el pago negativo: `removeDashes` tiene que ir **antes** de
> `Número (coma decimal)`. Las transformaciones se aplican en secuencia, así que si `toNumber` corre
> primero ya devolvió `-1234.56` y el guión no está más para quitar (queda `"1234.56"` como texto).
> El orden correcto en la plantilla es: quitar comilla doble → quitar guiones → número.

---

## [2026-07-27] — Performance de ACTUALIZACIONES: procesamiento por lote (91 min → menos de 1 min)

> ⚠️ **Redeploy back** (solo código, sin migración). Sin cambios de comportamiento ni de UI:
> mismo resultado, muchísimas menos idas y vueltas a la base.

**Reporte.** La actualización diaria de Toyota 0800 (archivo de 3 columnas — CUIL/DNI/nombre — y
~350k filas) tardaba **~2 horas**. Medido en prod: la remesa 52 del 21/07 procesó 351.943 filas en
**91,7 minutos**.

**Causa raíz — no eran queries lentas, eran queries de más.** Por cada fila que matcheaba un deudor
existente, el processor hacía **4 round-trips secuenciales**:

| # | Query | ¿Necesaria? |
|---|---|---|
| 1 | `findUnique` del deudor por `(empresa, documento, remesa)` | sí |
| 2 | `findUnique` **del mismo deudor** en `reasignarSiCorresponde` | no — ya lo trajo la 1 |
| 3 | `findUnique` **del mismo deudor** en `actualizarIdentidadYAdicionales` | no — ya lo trajo la 1 |
| 4 | `UPDATE` de `camposAdicionales` | no — reescribía el mismo JSON |

351.867 × 4 = **1,4M round-trips** en 5.502 s = **3,9 ms cada uno**: el costo era íntegramente la ida
y vuelta a RDS. La query 4 salía siempre porque `mergeAdicionales` devuelve un objeto nuevo aunque el
contenido sea idéntico, y la plantilla de Toyota mapea la columna 1 como campo adicional (`DNI`) —
o sea que todos los días se reescribía el mismo valor para las 350k filas.

**Backend**
- [processor.interface.ts](backend/src/modules/imports/processors/processor.interface.ts): nuevo hook
  **opcional** `processBatch(rows, ctx)` (+ tipos `BatchRow` / `BatchRowError`). Si un processor lo
  implementa, el runner le pasa el lote entero; devuelve un error por fila fallida. Los 8 processors
  que no lo implementan siguen exactamente igual por `processRow`.
- [imports.service.ts](backend/src/modules/imports/imports.service.ts): el runner acumula las filas que
  pasaron mapeo + validación y, si el processor tiene `processBatch`, las manda todas juntas. El conteo
  `ok`/`err` sale de lo que devuelve el hook; si el hook tira una excepción, se reporta el lote entero.
- [actualizaciones.processor.ts](backend/src/modules/imports/processors/actualizaciones.processor.ts):
  - **`processRow` ahora delega en `processBatch`** con un lote de 1 → una sola implementación, sin
    divergencias entre ambos caminos.
  - **Prefetch del lote**: 1 `findMany ... documento IN (...)` (+1 por `nroCliente` solo para las filas
    que no matchearon) trayendo de una todos los campos que antes pedían las queries 2 y 3. Cubierto por
    el unique `(empresaId, documento, remesaId)` y por el índice `(empresaId, remesaId, nroCliente)`.
  - **`reasignarSiCorresponde` → `calcularReasignacion`** y **`actualizarIdentidadYAdicionales` →
    `calcularIdentidadYAdicionales`**: funciones puras que deciden en memoria y devuelven el `data` del
    update (o `null`). El `findFirst` de validación del estado previo se reemplazó por
    `resolverGestionesValidas`, un set cacheado por batch.
  - **Nuevo `adicionalesEquivalentes`** ([campos-adicionales.ts](backend/src/modules/imports/utils/campos-adicionales.ts)):
    comparación profunda e independiente del orden de claves. Si el merge no cambia nada, no se emite
    UPDATE. Éste solo es el grueso del ahorro en un archivo diario.
  - **Escrituras agrupadas**: los updates del lote viajan en un `$transaction` (1 round-trip para N
    updates). Con **fallback**: si la transacción falla, se reintenta fila por fila para que solo la
    culpable quede como error y no se caiga el lote de 200.
  - **Dedupe intra-lote en las altas**: el prefetch corre una vez por lote, así que un documento nuevo
    repetido dentro del mismo lote se registra en el mapa al crearse y no se duplica (antes lo evitaba
    el hecho de que cada fila releía la DB).

**Medición** (benchmark contra MySQL real, 20.000 filas existentes sin cambios — el régimen diario):

| Camino | Queries | Tiempo local |
|---|---|---|
| Viejo (fila a fila) | 160.008 | 119,9 s |
| Nuevo (`processBatch`) | **101** | **0,4 s** |

101 queries = 1 prefetch por lote de 200 + 1 del cache de parámetros, y **cero updates** porque nada
cambió. Extrapolado a las 351.867 filas de Toyota: de 1.407.468 queries a **~1.761** (≈800x menos).
A los 3,9 ms/query medidos en prod son **~7 s de base de datos**; el resto pasa a ser el parseo del CSV
y el `remesa.update` de progreso por lote. **Estimado: 91 min → menos de 1 minuto.**

**Dos correcciones que salieron de revisar el impacto colateral del cambio:**
- **Un error por fila**: una fila podía acumular dos errores (el flush del update y la reconciliación),
  y el runner cuenta `err` por elemento devuelto → `ok + err` no daba el total del lote. Ahora las filas
  que ya fallaron se saltean en la reconciliación y el retorno se deduplica por `idx`.
- **Placeholder de filas sin documento**: `SIN_DOC_${Date.now()}` chocaba con el unique
  `(empresaId, documento, remesaId)` si dos altas caían en el mismo milisegundo. Ya podía pasar antes,
  pero el lote lo hace más probable (no intercala queries entre altas). Se le sumó una secuencia.

**Tests**: 69 verdes en `imports` (+17). Nuevos: una sola lectura por lote, sin UPDATE cuando los datos
son idénticos, agrupación en transacción, dedupe intra-lote, aislamiento de la fila que falla, fallback
del flush, un error por fila, placeholders distintos, `crearNuevosCasos=false`, match por `nro_cliente`,
y 7 casos de `adicionalesEquivalentes`.

**Verificación de que no se rompe nada más** (el cambio toca una interfaz compartida):
- Ningún otro processor implementa `processBatch` → los 8 restantes siguen por `processRow`, sin cambios.
- Los métodos renombrados (`reasignarSiCorresponde`, `actualizarIdentidadYAdicionales`) eran privados y
  no tenían referencias fuera del processor. `mergeAdicionales` no se modificó (lo usa `acciones.processor`).
- **Mismo deudor repetido en un lote**: da el mismo resultado que antes. `mapRow` genera siempre el mismo
  conjunto de claves en `camposAdicionales` (recorre `mapping.extras` completo, aun con valores vacíos) y
  el prefetch trae el JSON real de la DB, así que el merge conserva las claves preexistentes y el valor
  final sigue siendo el de la última fila.
- **Reordenar las fases es seguro**: `reconciliarDeudor` solo lee `montoTotal` y facturas — ninguno de los
  campos que escribe el update de identidad (`documento`, `nombre`, `apellido`, `camposAdicionales`) — y
  **relee todo de la DB** en vez de usar el prefetch, así que un deudor repetido sigue viendo el efecto de
  la fila anterior.
- **`afterAll` sin cambios de código**: la desasignación, el "pagó todo" de los ausentes, la consolidación
  y el cierre de promesas quedaron intactos (solo se tocaron comentarios).

**Verificación del modo RECONCILIAR contra la base** (lo usan 6 de las 7 plantillas). Se corrió el
processor viejo (fila a fila, commit `0bf4b71`) y el nuevo sobre **carteras idénticas**, comparando el
estado final de deudores (`montoTotal`, `saldo`, identidad, adicionales), facturas (importe, estado) y
pagos (importe, origen). **Los 9 escenarios dieron idéntico**:

| Escenario | Resultado |
|---|---|
| Cuota pagada (en DB, no en archivo) → PAGADA + pago | ✓ |
| Cuota nueva → la deuda total crece | ✓ |
| Corrección de importe de una cuota existente → delta | ✓ |
| Saldo único (cuotas en 0) → un solo pago por la diferencia | ✓ |
| Saldo que crece → ajuste de deuda + factura de ajuste | ✓ |
| Modo B (valor único sin bloques) → reconciliación por saldo | ✓ |
| Archivo idéntico a lo guardado → no pasa nada | ✓ |
| Mismo deudor repetido en el lote (2 filas) | ✓ |
| Completa DNI placeholder + mergea adicionales (match por `nro_cliente`) | ✓ |

> **Alcance**: las ALTAS de casos nuevos siguen siendo secuenciales (arrastran facturas, contactos y
> autoenriquecimiento). En el flujo diario son una fracción mínima de las filas; en un archivo que sea
> casi todo altas, el tiempo se parece al de antes. La reconciliación de deuda (modo `RECONCILIAR`)
> también sigue por deudor: ahí se ganan las queries 1-3 pero no las de facturas/pagos.
>
> **Sin test automatizado del runner**: el cableado de `processBatch` en `imports.service` no tiene test
> (no hay infraestructura de tests para ese servicio). Conviene mirar el resultado de la primera corrida
> real: `okFilas`/`errFilas` de la remesa deben coincidir con lo de siempre.
>
**Tamaño de lote configurable**: el `BATCH_SIZE` hardcodeado en 200 pasa a la variable de entorno
**`IMPORTS_BATCH_SIZE`**, con **default 1000** y acotada a `[1, 5000]` (un valor inválido o fuera de rango
cae al default / al tope, no rompe el import). Subirlo divide proporcionalmente el prefetch y los
`remesa.update` de progreso, que tras el batch lookup pasaron a ser el costo dominante: de 200 a 1000 son
5x menos de ambos. A cambio, la transacción de updates es más larga (más tiempo de locks) y el progreso
en la UI se refresca cada 1000 filas. Aplica a todas las categorías; las que no usan `processBatch` no
cambian su velocidad de procesamiento pero igual bajan el overhead de progreso. El log de inicio de cada
importación ahora dice el lote efectivo y si el processor usa el camino por lote
(`lote=1000 porLote=si`), para poder verificarlo en prod.

---

## [2026-07-27] — ACTUALIZACIONES: los casos nuevos van SIEMPRE a la remesa origen (no a una remesa nueva)

> ⚠️ **Redeploy back + front** (solo código, sin migración). Backfill de datos ya aplicado en prod
> (ver abajo). Reportado por los usuarios que testearon el lote del 2026-07-21.

**Reporte.** Toyota 0800 anduvo OK (los casos nuevos se sumaron a la remesa `00001`), pero **FIAT MORA
TEMPRANA** repitió el síntoma viejo: los casos nuevos quedaron en una remesa aparte con un número
"random" en vez de sumarse a la cartera.

**Causa raíz.** El fix del 2026-07-21 dejó el destino del alta **atado a `accionAusente`**:

```ts
const esDiario = ctx.accionAusente === 'DESASIGNAR' && !!ctx.remesaOrigenId;
const remesaDestinoId = esDiario ? ctx.remesaOrigenId : ctx.remesaId;
```

`TOYOTA 0800 DIARIO` (plantilla 51) está en `DESASIGNAR` → anduvo. `FIAT MORA TEMPRANA` (plantilla 43)
está en `PAGO_TODO` → cayó en la rama clásica y creó 35 deudores en la remesa 53 (`numeroRemesa` =
timestamp `1784657478166`, el "número random" del reporte) en vez de la remesa 17 (`00001`).

**Backend** ([actualizaciones.processor.ts](backend/src/modules/imports/processors/actualizaciones.processor.ts))
- **`crearNuevoDeudor` usa siempre `ctx.remesaOrigenId`.** La remesa de un import ACTUALIZACIONES es el
  contenedor del job, no una cartera: los casos nuevos van a la cartera en cualquier modo
  (`RECONCILIAR`/`SOLO_DATOS`) y con cualquier `accionAusente`. Se eliminó la bifurcación `esDiario`.
- **Los nuevos se marcan PRESENTES siempre** (`processedDeudorIds`), no solo en el flujo diario. Es la
  contracara imprescindible del cambio anterior: bajo `PAGO_TODO` el `afterAll` recorre la remesa origen
  y reconcilia como "pagó todo" a todo el que no esté en ese set — sin esto, un caso nuevo se habría
  creado y **cancelado (SIT-050) en la misma corrida**.
- `matchedExistingCount` no se toca: el guard anti-desasignación masiva del 2026-07-21 sigue contando
  solo matches reales contra la cartera.

**Frontend** ([PlantillaEditor.tsx](frontend/src/pages/PlantillaEditor.tsx))
- Texto de ayuda de "crear casos nuevos": ya no dice que el alta en la remesa vinculada pasa solo en
  "Desasignar"; ahora aclara que es siempre.

**Tests** ([actualizaciones-desasignacion.spec.ts](backend/src/modules/imports/processors/actualizaciones-desasignacion.spec.ts))
- Se invirtió el caso "flujo clásico → remesa del import" (codificaba el comportamiento viejo) por
  `RECONCILIAR + PAGO_TODO → remesa origen + presente`.
- Nuevo test de **regresión**: con `PAGO_TODO`, un caso nuevo dado de alta no genera pago de "pagó todo"
  en el `afterAll` de la misma corrida (solo lo genera el ausente real). 12/12 verdes; 51/51 en `imports`.

**Backfill en prod (aplicado)**: los 35 deudores de la remesa 53 se movieron a la 17 (`00001`) y la
remesa 53 se eliminó. Preview previo: 0 colisiones del unique `(empresaId, documento, remesaId)`, 0
duplicados internos, 0 `jobimport`/`importerror` colgando. La `00001` pasó de 330 → **365 deudores**;
las 35 facturas y 154 contactos viajaron con el deudor (cuelgan de `deudorId`).

> **Decisión de negocio**: `FIAT MORA TEMPRANA` se **queda en `PAGO_TODO`** — el archivo trae la cartera
> viva y el ausente efectivamente canceló. Los 31 SIT-050 de la remesa 17 son correctos y se dejaron como
> están. (Distinto de Toyota, que es atención al cliente y usa `DESASIGNAR`.)

---

## [2026-07-21] — Actualización diaria sin saldo (atención al cliente): alta de casos nuevos en SOLO_DATOS + guard anti-desasignación masiva

> ⚠️ **Redeploy back + front** (solo código, sin migración). **Post-deploy**: reconfigurar la plantilla
> `TOYOTA 0800 DIARIO` (id 51) a `modoActualizacion: SOLO_DATOS` (hoy `RECONCILIAR`).

**Incidente en prod (resuelto).** Toyota 0800 es una gestión de **atención al cliente**, no de cobranza:
el archivo diario trae solo `[CUIL, DNI, nombre]`, sin saldo ni facturas. La plantilla quedó en modo
`RECONCILIAR` (exige factura/`montoTotal` por fila) → las **351.943 filas fallaron** la validación
(`"Debe incluir bloques con nroFactura o el campo montoTotal"`). Como ninguna fila entró a
`processedDeudorIds`, el `afterAll` (DESASIGNAR) tomó a **toda la cartera como ausente** y desasignó
**342.792 deudores → GES-094**. Recuperado por SSM: revert de los 342.792 a su gestión previa (GES-001,
guardada en `estadoGestionPrevioAId`) y destrabe de una remesa fantasma (id 51, `VALIDANDO` sin job).

**Causa raíz — 2 problemas:**
- **A (footgun):** `desasignarAusentes` desasignaba a cualquiera fuera de `processedDeudorIds`. Un archivo
  que falla entero (validación, separador/mapeo/empresa equivocada) borraba la cartera completa.
- **B (capacidad faltante):** no existía config válida para "gestión sin saldo que igual crea casos nuevos".
  `SOLO_DATOS` no creaba nuevos y `RECONCILIAR` exigía saldo → el operador puso `RECONCILIAR` y explotó.

**Backend** ([actualizaciones.processor.ts](backend/src/modules/imports/processors/actualizaciones.processor.ts))
- **Guard de seguridad:** nuevo contador `matchedExistingCount` (filas que matchearon un deudor
  existente de la remesa origen). Si es **0**, `desasignarAusentes` **aborta** con `warn` — no borra la
  cartera cuando el archivo no le corresponde. Distinto de `processedDeudorIds`, que ahora también incluye
  las altas del flujo diario.
- **`crearNuevosCasos` es ortogonal al modo:** se quitó el corte temprano `if (soloDatos) return` en el alta.
  Ahora `SOLO_DATOS` también da de alta casos nuevos (sin tocar deuda) cuando `crearNuevosCasos=true`.
- **Altas del flujo diario van a la remesa madre:** en `accionAusente=DESASIGNAR`, `crearNuevoDeudor` crea el
  deudor en la **remesa origen** (no en la del import) y lo marca **presente** (`processedDeudorIds`), para
  que mañana se matchee (no se duplique) y no se auto-desasigne. El resto de flujos (escenario B clásico)
  siguen creando en la remesa del import.

**Frontend** ([PlantillaEditor.tsx](frontend/src/pages/PlantillaEditor.tsx))
- El toggle "crear casos nuevos" ahora se muestra en **ambos modos** (antes solo en `RECONCILIAR`). Textos
  de ayuda actualizados: `SOLO_DATOS` ya no dice "no se crean nuevos"; se aclara que en "Desasignar" los
  nuevos se suman a la remesa vinculada. El selector "si el saldo es mayor" queda solo en `RECONCILIAR`.

**Tests** ([actualizaciones-desasignacion.spec.ts](backend/src/modules/imports/processors/actualizaciones-desasignacion.spec.ts))
- +3 casos: guard con 0 matches (no desasigna), alta `SOLO_DATOS` en remesa origen + marcado presente, y
  alta clásica en la remesa del import. 11/11 verdes; 50/50 en todo `imports`.

> **Combinación destino de Toyota:** `SOLO_DATOS` + `accionAusente=DESASIGNAR` + `crearNuevosCasos=true`.
> Efecto: presentes → actualiza identidad/adicionales y re-asigna si venían de GES-094; nuevos → alta en la
> cartera; ausentes → GES-094; **no toca deuda/pagos/situación**.

---

## [2026-07-20] — Autoenriquecimiento de contactos desde la base: helper compartido en todos los processors

> ⚠️ **Redeploy back** (solo código, sin migración). No cambia el comportamiento: unifica una lógica
> que ya existía duplicada en 3 processors.

El autoenriquecimiento (cuando entra un caso nuevo, se le arrastran los contactos históricos de la
propia base que tengan el **mismo DNI** en otra remesa, sin duplicar) estaba **copiado y pegado en 3
processors** con variantes sutiles (ej. ACTUALIZACIONES chequeaba el placeholder `SIN_DOC` y los otros
`SIN-DNI-`). Se consolidó en un único helper para que corra **igual en todo processor que dé de alta
deudores**.

**Backend**
- Nuevo [utils/enriquecimiento-historico.ts](backend/src/modules/imports/utils/enriquecimiento-historico.ts):
  `enriquecerContactosHistoricos(ctx, deudorId, documento)` — match **exacto por DNI**, cross-empresa y
  cross-remesa (excluye la remesa actual), `distinct` por (tipo, valor), `createMany skipDuplicates` sobre
  el unique (deudorId, tipo, valor). Saltea placeholders (`SIN-DNI-` / `SIN_DOC`). Devuelve la cantidad copiada.
- Reemplaza el bloque inline en [deudores.processor.ts](backend/src/modules/imports/processors/deudores.processor.ts),
  [deudores-facturas.processor.ts](backend/src/modules/imports/processors/deudores-facturas.processor.ts) y
  [actualizaciones.processor.ts](backend/src/modules/imports/processors/actualizaciones.processor.ts) (escenario
  "caso nuevo"). Cada uno acumula un contador y loguea un **resumen por importación** (`log`): "Autoenriquecimiento
  histórico: N contactos copiados desde la base" — para poder verificar en prod si trajo datos.
- Tests: [enriquecimiento-historico.spec.ts](backend/src/modules/imports/utils/enriquecimiento-historico.spec.ts)
  (match exacto, sin histórico, placeholders, trim). Verificado además end-to-end contra la DB con el processor real.

> **Nota diagnóstica**: el match es por **string exacto** de `documento`. Si el mismo DNI está guardado con
> formatos distintos entre cargas (CUIL vs DNI, espacios, ceros a la izquierda), no matchea — se resuelve
> normalizando el documento en las transformaciones de la plantilla, no acá.

---

## [2026-07-17] — Actualización diaria de gestión: ausentes → desasignado (GES-094) en vez de "pagó todo"

> ⚠️ **Redeploy back + front + `npx prisma db push`** (columna nullable nueva, no destructiva).
> Feature A del spec [imports-actualizacion-diaria-y-multirregistro-spec.md](docs/imports-actualizacion-diaria-y-multirregistro-spec.md).
> Retrocompatible: el default de `accionAusente` es `PAGO_TODO` (comportamiento clásico), las plantillas
> existentes no cambian.

Para los archivos diarios de gestión (Fiat MT / Prelegal y análogos), un deudor que **no viene** en el
archivo del día **no pagó**: hay que sacarlo de la gestión del día, no marcarlo como cancelado. Se agrega
el flag **`accionAusente`** a ACTUALIZACIONES con 3 valores: `PAGO_TODO` (default, clásico → SIT-050),
`DESASIGNAR` (→ GES-094) e `IGNORAR`.

**Prisma**
- Nueva columna `deudor.estadoGestionPrevioAId Int?` (+ relación `DeudorEstadoGestionPrevio` + índice):
  guarda el estado de gestión previo al desasignar, para poder **revertir** la desasignación cuando el
  deudor reaparece. `db push` aplicado.

**Backend**
- [mapping-types.ts](backend/src/modules/imports/mapping-types.ts): tipo `AccionAusenteActualizacion` +
  campo `accionAusente?` en `MappingJson`. [processor.interface.ts](backend/src/modules/imports/processors/processor.interface.ts):
  `accionAusente` en `ProcessContext`.
- [actualizaciones.processor.ts](backend/src/modules/imports/processors/actualizaciones.processor.ts):
  - `afterAll` con 3 ramas. En `DESASIGNAR`, los deudores de la remesa origen ausentes del archivo →
    `estadoGestionId = GES-094` (guardando el previo). **No** toca deuda/pagos/facturas/situación. Ignora
    cancelados (SIT-050) y ya-desasignados. Updates en transacciones chunked de 500.
  - **Re-asignación** (`reasignarSiCorresponde`): un deudor presente que venía en GES-094 se restaura a su
    gestión previa (o al default de la plantilla si el previo ya no existe). Idempotente.
  - Modo degradado si GES-094 no está seedeado (warn + skip). Auditoría resumen (1 evento por batch).
- [imports.service.ts](backend/src/modules/imports/imports.service.ts): resuelve el flag con default
  seguro `PAGO_TODO`; rechaza la combinación incoherente `SOLO_DATOS` + `PAGO_TODO` al guardar plantilla.
- Tests: [actualizaciones-desasignacion.spec.ts](backend/src/modules/imports/processors/actualizaciones-desasignacion.spec.ts)
  (8 casos: desasignación, guard SIT-050, idempotencia, modo degradado, re-asignación + fallback).

**Frontend**
- [PlantillaEditor.tsx](frontend/src/pages/PlantillaEditor.tsx): RadioGroup "Deudores ausentes del archivo"
  en la sección ACTUALIZACIONES (visible en ambos modos; en "Solo datos" se ocultan las opciones
  incompatibles y se coacciona `PAGO_TODO` → `IGNORAR`).

**Flujo operativo**: la 1ª carga de la cartera va con categoría DEUDORES (remesa madre); a partir de ahí
los diarios usan una plantilla ACTUALIZACIONES con `accionAusente=DESASIGNAR` apuntando a esa remesa origen.

> Pendiente: **Feature B** (parser TXT multi-registro Toyota GES/CLI/DET/BAJ, con BAJ → GES-090) — spec
> listo, sin implementar.

---

## [2026-07-17] — Fixes de imports: preview por coma, dedup de pagos, multi-remesa origen, filtro de empresa exacto

> ⚠️ **Redeploy back + front** (sin migración: todos los cambios son de código). Lote de 4 arreglos
> reportados. Además queda el spec de dos features nuevas (archivo diario de gestión + TXT multi-registro
> Toyota) en [docs/imports-actualizacion-diaria-y-multirregistro-spec.md](docs/imports-actualizacion-diaria-y-multirregistro-spec.md), pendiente de implementar.

**Frontend**

- **Preview del mapeo no respetaba el separador elegido después de subir el archivo**
  ([MappingEditor.tsx](frontend/src/components/import/MappingEditor.tsx)): el preview sólo se parseaba
  al subir el archivo de muestra. Si se cambiaba el separador *después* (típico: default `|` → CSV por
  coma), la vista previa quedaba con el separador viejo y mostraba todo en **una sola columna** (caso
  `IVR_ANA_MAYA.txt`, CSV por coma mostrado como 1 columna). Ahora un `useEffect` re-parsea el archivo
  ya cargado cada vez que cambia el separador o el header.
- **Pagos — selector de VARIAS remesas origen** ([ImportWizard.tsx](frontend/src/pages/ImportWizard.tsx)):
  para la categoría PAGOS el selector de remesa origen pasa a ser múltiple (checkboxes). Un archivo de
  pagos que abarca toda la empresa (N remesas) se corre **una sola vez** en vez de N. El resto de
  categorías siguen con selección simple.

**Backend**

- **Pagos — dedup acumulativo** ([pagos.processor.ts](backend/src/modules/imports/processors/pagos.processor.ts)):
  reimportar un archivo de pagos acumulativo (que repite pagos ya cargados) **ya no duplica**. Antes de
  crear un `IMPORT_PAGOS` se chequea si ya existe uno idéntico (mismo deudor, mismo día e importe) y se
  saltea. La comparación es por día (no timestamp) para el caso en que la fecha no viene mapeada.
- **Pagos — matcheo multi-remesa** ([pagos.processor.ts](backend/src/modules/imports/processors/pagos.processor.ts)):
  el deudor se busca por `nroCliente` con `remesaId IN (...)` sobre todas las remesas origen elegidas
  (nuevo `remesaOrigenIds` en `ProcessContext`, hilado por controller → service → BullMQ processor). Si
  no vienen, cae al comportamiento clásico de una sola `remesaOrigenId`.
- **Filtro de empresa — match EXACTO** ([deudores.service.ts](backend/src/modules/deudores/deudores.service.ts)):
  la búsqueda avanzada usaba `contains` sobre el nombre de la empresa, así "FIAT" también traía "FIAT PLAN"
  y "TELECOM" traía "TELECOM_PERSONAL". Como el valor sale de un combo de empresas (no texto libre), pasa
  a `equals`.

---

## [2026-07-14] — Fixes de imports: total de deuda en actualizaciones + búsqueda de deudor en pagos

> ⚠️ **Redeploy back** (sin migración: solo código). Dos arreglos reportados sobre el lote del 2026-07-08
> que no habían quedado del todo bien.

**Backend**

- **Actualizaciones — la deuda total ahora refleja el importe corregido de una cuota existente**
  ([actualizaciones.processor.ts](backend/src/modules/imports/processors/actualizaciones.processor.ts)):
  en el modelo "factura con importe", cuando una actualización trae una cuota nueva **y** además corrige
  el importe de una cuota ya cargada, el `montoTotal` se recalculaba sumando el valor **viejo** de la cuota
  corregida. Ahora la corrección aporta su **delta** (nuevo − viejo) a `deudaAgregada`, además del importe
  de la cuota nueva. Ej. cuota 74 pasa de $385.974,85 a $387.605,54 y llega la cuota 75 de $399.999,99:
  el total pasa de mostrar $785.974,84 (mal) a **$787.605,53** (correcto).

- **Pagos — el deudor se busca en la remesa de origen, no en la del propio archivo**
  ([pagos.processor.ts](backend/src/modules/imports/processors/pagos.processor.ts)): la búsqueda por
  `nroCliente` usaba `ctx.remesaId` (la remesa del archivo de pagos) en vez de `ctx.remesaOrigenId ?? ctx.remesaId`
  como hacen facturas/contactos/enriquecimiento. Por eso fallaba con "Deudor no encontrado para pago
  (nro_cliente=…)" aunque el nro de cliente se viera bien en la vista previa. Ahora apunta a la remesa origen.

- **Separador de plantillas — el tabulador y el separador personalizado dejaban todo en una columna**:
  el combo "Formato / Separador" guardaba el tabulador como la cadena literal `"\t"` (2 caracteres:
  barra + t), porque un atributo JSX `value="\t"` **no** interpreta secuencias de escape. `fast-csv`
  necesita un delimitador de 1 solo carácter, así que ese `"\t"` nunca matcheaba → archivo en una columna.
  Además la opción "Otro personalizado" era un callejón sin salida (nunca mostraba el campo) y tipear una
  coma saltaba a "CSV - Coma".
  - Frontend ([PlantillaEditor.tsx](frontend/src/pages/PlantillaEditor.tsx)): el `MenuItem` del tabulador
    ahora usa un tab real (`value={'\t'}`); modo explícito `STD`/`OTRO` para que "personalizado" muestre el
    campo y no se auto-cambie al tipear; al cargar una plantilla vieja se repara el `"\t"` literal.
  - Backend ([utils/delimitador.ts](backend/src/modules/imports/utils/delimitador.ts) nuevo + los 4 puntos
    de parseo en [imports.service.ts](backend/src/modules/imports/imports.service.ts)): `resolveDelimiter`
    convierte `"\t"`/`"tab"`/`"TAB"` al carácter real antes de pasarlo a `fast-csv`. Repara también las
    plantillas ya guardadas con el valor incorrecto (preview, validación y import real).

---

## [2026-07-08] — Acciones masivas: comentario con plantilla de variables

> ⚠️ **Redeploy back + front** (sin migración: es un campo más dentro de `mappingJson.acciones`).

La operación **"Agregar comentario"** de la categoría ACCIONES suma un tercer origen del valor,
**"Plantilla con variables"**: el usuario escribe el texto libre e inserta variables de columna
`{{colN}}` (N = índice de columna 0-based) que se reemplazan por el valor de esa columna en cada
fila. Cubre y supera la concatenación (permite maquetar el texto como se quiera, ej.
`tarjeta {{col1}} - motivo {{col2}} - por {{col3}}`).

**Backend**
- [mapping-types.ts](backend/src/modules/imports/mapping-types.ts): `ADD_COMENTARIO` suma `modo: 'PLANTILLA'`
  y el campo `plantilla?: string`.
- [acciones.processor.ts](backend/src/modules/imports/processors/acciones.processor.ts): `valorTexto`
  resuelve la plantilla sustituyendo `{{colN}}` (regex tolerante a espacios/mayúsculas) por el valor
  crudo de la columna; las variables sin valor quedan vacías y el texto literal se respeta.

**Frontend**
- [AccionesEditor.tsx](frontend/src/components/import/AccionesEditor.tsx): builder visual para el modo
  plantilla — textarea multilínea + chips clickeables por columna (con muestra del valor) que insertan
  `{{colN}}` **en la posición del cursor**, y **vista previa en vivo** con la 1ª fila del archivo de muestra.

Retrocompatible: los orígenes "Texto fijo" y "Desde una columna" no cambian; las plantillas ya guardadas
siguen funcionando igual.

---

## [2026-07-08] — Fixes de imports: actualizaciones, transformaciones, pagos y vista de deudores

> ⚠️ **Redeploy back + front** (sin migración: todos los cambios son de código).
> Lote de 7 arreglos reportados sobre importaciones. Ninguno cambia el comportamiento por defecto de
> los flujos existentes (defaults seguros).

**Backend**

- **Actualizaciones — pago parcial con saldo total ya no genera "pagos fantasma"**
  ([actualizaciones.processor.ts](backend/src/modules/imports/processors/actualizaciones.processor.ts)):
  el "Modo A" (reconciliación por `nroFactura`) separa ahora dos modelos que estaban mezclados:
  - *Factura con importe propio*: pago por cuota = importe real de la factura (sin cambios).
  - *Saldo total único* (planes de ahorro, cuotas con importe 0): se eliminó la división
    `montoTotal / cantidadCuotas` que registraba un pago por cada cuota faltante con un monto mal
    calculado. Las cuotas ausentes solo se marcan `PAGADA` y el pago se calcula **una sola vez** por el
    total vía el helper compartido `reconciliarSaldoTotal` (mismo criterio que el Modo B). Caso
    1843155: antes 2 pagos de $2.154.164 y saldo $3.154.164; ahora 1 pago de $1.000.000 y saldo
    $6.462.493,19.
- **Actualizaciones — la deuda total crece al llegar una cuota nueva**: en el modelo "factura con
  importe", al insertar una factura nueva se acumula `deudaAgregada` y se sube `montoTotal` + `saldo`
  del deudor (antes la factura se agregaba pero la deuda quedaba en el valor de la carga original).
- **Actualizaciones — flag `crearNuevosCasos`** (default `true`): si se desactiva, los registros que no
  matchean la remesa origen se ignoran en vez de crearse como deudor nuevo. Resuelve el caso Fiat
  Plan/Jeep Plan (un archivo que abarca 4 remesas, aplicado una por una, ya no duplica los de las otras).
  Sumado a `MappingJson`, `ProcessContext` e `imports.service` (parseo con default seguro).
- **Pagos — se acepta `monto` como alias de `importe`** ([pagos.processor.ts](backend/src/modules/imports/processors/pagos.processor.ts)):
  la UI de mapeo de PAGOS expone la clave interna `monto`, pero el processor leía `importe` → rechazaba
  toda fila con "Falta Importe" (afectaba a AUSA y a cualquier plantilla de pagos nueva). Retrocompatible.
- **Pagos — se respeta la fecha mapeada**: `fecha` (o su alias `fechaPago` de la UI); si no viene o es
  inválida, se usa la fecha del día. Antes la fecha mapeada se ignoraba y siempre quedaba la de hoy.
- **Transformaciones** ([transforms.ts](backend/src/modules/imports/transforms.ts)): nueva `removeQuotes`
  (quita comilla simple recta y tipográficas, para XLS de Excel con números como texto `'12345`).

**Frontend**

- **Lista de deudores — Nº Cliente ya no muestra siempre "-"**
  ([DeudoresTable.tsx](frontend/src/components/deudores/DeudoresTable.tsx),
  [BuscadorAvanzadoModal.tsx](frontend/src/components/deudores/BuscadorAvanzadoModal.tsx)): la columna leía
  solo `camposAdicionales.nro_cliente` (JSON legacy, null en los deudores actuales); ahora lee la columna
  nativa `nroCliente` con fallback al JSON, igual que la ficha.
- **Transformaciones** ([MappingEditor.tsx](frontend/src/components/import/MappingEditor.tsx)): la limpieza
  de prefijo pasa de `CUIL ` a `CUI[LT][^0-9]*` (limpia CUIL **y** CUIT, evita que el CUIT quede pegado al
  documento); nueva opción "Quitar comilla simple ( ' )".
- **PlantillaEditor** ([PlantillaEditor.tsx](frontend/src/pages/PlantillaEditor.tsx)): toggle "No crear
  casos nuevos — solo actualizar deudores existentes" en la sección ACTUALIZACIONES (persiste
  `mappingJson.crearNuevosCasos`).

---

## [2026-07-06] — Acciones masivas: Fase 2 (eliminar contacto) + Fase 3 (revertir)

> ⚠️ **Redeploy back + front** (sin migración; el modelo del snapshot ya se creó en la Fase 1).

**Fase 2 — Eliminar contacto**:
- `AccionesProcessor.DELETE_CONTACTO` (modo DEUDOR): borra los contactos del deudor matcheado cuyo tipo+valor
  coincidan (normalizando teléfono/email como en el import), con snapshot `DELETE` (fila completa) para el undo.
- **Modo CONTACTO** (limpieza global): un listado de teléfonos/emails se borra de **toda la base** de la empresa
  (scopeable a una remesa), sin importar el deudor. `valoresCandidatos` matchea el valor crudo + normalizado.
- Preview: `previewAccionesImpacto` ahora cuenta "N contactos a eliminar" en modo CONTACTO. El wizard lo muestra.
- Frontend `AccionesEditor`: selector "Tipo de acción" (modificar deudores / eliminar contacto de toda la base);
  operación "Eliminar contacto" (tipo tel/email/cualquiera + valor fijo o por columna).

**Fase 3 — Revertir (undo)**:
- `POST /import/remesas/:id/revertir-acciones` (permiso `deudores.acciones_masivas`): lee
  `accion_masiva_snapshot` en orden inverso y deshace — `UPDATE`→re-setea los campos, `DELETE`→re-inserta el
  contacto (`createMany` skipDuplicates), `INSERT`→borra el comentario. Marca `remesa.accionRevertidaEn/PorId`.
  Idempotente (si ya está revertida, no hace nada). Auditoría del revert.
- Frontend: botón **"Revertir acción"** (ícono Undo) en el historial para remesas ACCIONES finalizadas y no
  revertidas, con diálogo de confirmación. Aviso: si alguien editó a mano después, esos cambios se pisan.

Con esto la feature de acciones masivas queda **completa** (Fases 1-3).

---

## [2026-07-06] — Importación "Acciones masivas" (Fase 1)

> Diseño completo (3 fases) en el plan aprobado. Esta entrega es la **Fase 1**: núcleo usable de acciones
> sobre deudores por listado. Faltan Fase 2 (eliminar contacto + limpieza global) y Fase 3 (botón revertir).
>
> ⚠️ **Deploy**: `prisma db push` (enum `ACCIONES` en `plantillaimport_categoria`/`remesa_categoria`, tabla
> `accion_masiva_snapshot`, campos `remesa.accionRevertidaEn/PorId`) + asignar el permiso nuevo
> `deudores.acciones_masivas` a ADMIN (re-seed).

**Feature**: nueva categoría de importación **ACCIONES** para manipular la base de deudores desde un listado sin
entrar a MySQL. En vez de mapear columnas→campos, la plantilla define **un matcheo + operaciones** de un catálogo
cerrado (sin SQL libre).

### Fase 1 (implementado)
- **Modelo**: enum `ACCIONES` (x2), tabla `accion_masiva_snapshot` (undo: UPDATE/DELETE/INSERT con `datosPrevios`),
  `remesa.accionRevertidaEn/PorId`. `mappingJson.acciones` = `AccionesConfig` (matchMode DEUDOR, matchColumn,
  saltearCanceladas, operaciones[]).
- **AccionesProcessor** ([processors/acciones.processor.ts](backend/src/modules/imports/processors/acciones.processor.ts)):
  matchea deudores **empresa-wide** por Nº Cliente/Documento; por cada uno aplica `SET_SITUACION/GESTION/MOTIVO`,
  `SET_CAMPO` (nombre/apellido/monto/vencimiento/nroCliente), `SET_ADICIONALES` (merge new-wins con `mergeAdicionales`)
  y `ADD_COMENTARIO`, **grabando snapshot** de cada cambio para el futuro undo. Salta SIT-050 si `saltearCanceladas`.
  `afterAll` audita el resumen (`AuditoriaHelper`, módulo IMPORT).
- **Preview de impacto** (`GET /import/remesas/:id/acciones-preview`): cuenta "N deudores afectados" leyendo las
  claves de match del archivo, sin escribir. El wizard lo muestra en un Alert antes de confirmar.
- **Permiso** `deudores.acciones_masivas` (catálogos back/front + seed ADMIN). `ProcessContext` sumó `usuarioId`,
  `auditoria`, `accionesConfig` y `MappedRow._raw` (fila cruda). Las plantillas ACCIONES no exigen estado inicial.
- **Frontend**: card "Acciones masivas" en `CategorySelector`; `AccionesEditor` (constructor de match + operaciones)
  reemplaza el editor de columnas en `PlantillaEditor` para esta categoría; el wizard no pide remesa origen
  (empresa-wide) y muestra el impacto en el paso de preview.

### Pendiente (Fase 2/3)
- Fase 2: `DELETE_CONTACTO` (por deudor y limpieza global `matchMode=CONTACTO`).
- Fase 3: endpoint + botón **"Revertir acción"** que lee `accion_masiva_snapshot` y deshace.

---

## [2026-07-06] — ACTUALIZACIONES: saldo correcto cuando la deuda crece + switch factura/saldo

> ⚠️ **Redeploy back + front** (solo código, sin migración). Aplica a importaciones nuevas.

**Problema** (feedback de usuarios) en ACTUALIZACIONES Modo B (valor único = saldo que queda):
1. **Bug**: si el archivo trae un saldo mayor (debía 100, viene 200), se creaba una factura de AJUSTE por la
   diferencia pero **el saldo del deudor no subía** (quedaba en 100). La consolidación deriva
   `saldo = montoTotal − Σpagos` con `montoTotal` inmutable y **saltea** a los deudores con `Σpagos == 0`, así
   que la factura de ajuste no movía nada.
2. **Proliferación**: con intereses diarios (100→102→104…) se generaba una factura de $2 por día.

**Cambios**:
- **`montoTotal` pasa de "inmutable" a "monótono no-decreciente"**: en ACTUALIZACIONES solo crece cuando el
  cedente reporta más deuda; las bajas siguen siendo pagos. Es el único lever para que suba el saldo.
- Nueva rama `subirDeudaDeudor` en `actualizaciones.processor.ts`: ante deuda mayor sube
  `montoTotal = saldoArchivo + Σpagos` y setea `saldo = saldoArchivo` **directo** (la consolidación saltea sin
  pagos; con pagos recomputa el mismo valor). El crecimiento se detecta relativo al `montoTotal` ya crecido, así
  que las corridas diarias de intereses se reconcilian una a una (`reconciliarSaldo` sin cambios).
- **Nuevo switch por plantilla** `mappingJson.comportamientoDeudaMayor: 'FACTURA_NUEVA' (default) | 'ACTUALIZAR_SALDO'`
  (propagado por `ProcessContext`):
  - `FACTURA_NUEVA`: genera la factura de ajuste por la diferencia (comportamiento clásico, ahora con el saldo corregido).
  - `ACTUALIZAR_SALDO`: no crea facturas; si el deudor tiene **una única** factura pendiente le pisa el importe al
    saldo informado (para intereses diarios). Con 0 o >1 facturas solo corrige el saldo del deudor y loguea `warn`.
- **Frontend** (`PlantillaEditor`): selector "Si el saldo informado es mayor al actual" en la sección de
  ACTUALIZACIONES, visible cuando el modo no es "solo datos".
- Tests: `reconciliar-actualizacion.spec.ts` +2 casos (100→200 y la secuencia de intereses diarios); los 13
  previos intactos. Alcance: solo Modo B de RECONCILIAR (no afecta Modo A por nroFactura ni SOLO_DATOS).

---

## [2026-07-06] — Filtro de teléfonos basura en la importación

> ⚠️ **Redeploy del backend** (solo código, sin migración). Aplica solo a importaciones nuevas;
> no toca los contactos ya cargados.

**Problema** (feedback de usuarios): al importar cartera o datos adicionales, un teléfono que no valida
se cargaba igual "en rojo" para revisión manual — pero se cargaba **cualquier cosa**: `0`, `123`, un número
solo, o rellenos como `(02941) 1111-1111` / `(02941) 11111111` (característica real pero abonado repetido).

**Fix**: nuevo `esPosibleTelefono(input)` en `common/utils/phone-utils.ts` — filtro de plausibilidad que se
aplica **solo** cuando el número NO valida (si valida, sigue quedando verde en E.164). Un teléfono que no
valida se carga en rojo únicamente si tiene forma de teléfono; si es basura evidente o relleno, se **descarta**
(`prepararContactoImport` devuelve `null`). Reglas: entre **10 y 15 dígitos** y sin **corridas de 6+ dígitos
idénticos** seguidos (esto último es lo que caza `1111-1111` aunque tenga característica válida y 13 dígitos).
Mantiene reales aunque no validen, ej. `15-(02941) 64-3701` (dígitos variados).

- Aplicado en el punto central `imports/utils/contacto-import.ts` (cubre cartera/DEUDORES, ENRIQUECIMIENTO,
  CONTACTOS, DEUDORES_Y_FACTURAS) y en el `upsertContacto` inline de `actualizaciones.processor.ts` (escenario
  deudor nuevo). Tests: `phone-utils.spec.ts` (21 casos, con los ejemplos reales reportados).

---

## [2026-07-06] — Cargar asignaciones sin DNI + completar DNI/adicionales por ACTUALIZACIONES

> ⚠️ **Acciones de despliegue**:
> 1. **Sin migración de schema**: el placeholder llena `documento` (sigue NOT NULL), `camposAdicionales`
>    ya es `Json?`, y el modo nuevo vive dentro de `mappingJson.modoActualizacion`. No hace falta `db push`.
> 2. **Sin backfill**: aplica a importaciones nuevas.
> 3. **Redeploy back + front**.

**Problema** (feedback de usuarios): varias asignaciones llegan **sin DNI** (el DNI viene después en un
archivo de adicionales), pero la carga de DEUDORES exigía `documento` y no dejaba avanzar. La identidad del
deudor es la clave única `(empresaId, documento, remesaId)` con `documento` **NOT NULL**, así que no se puede
hacer nullable (rompe dedup/upsert).

### 1. Cargar deudores SIN DNI (placeholder estable)

- Nuevo util `imports/utils/documento.ts`: `placeholderDocumento(nroCliente)` → `SIN-DNI-<nroCliente>`,
  `esDocumentoPlaceholder()`, `documentoDeFila()`. Cuando la fila no trae DNI se guarda un placeholder
  **determinístico** derivado del `nroCliente` (respeta la clave única y la reimportación es idempotente).
- `DeudoresProcessor` y `DeudoresYFacturasProcessor`: `validateRow` ahora exige `documento` **o**
  `nro_cliente` (antes ambos). El enriquecimiento histórico de contactos se saltea con placeholder
  (no hay histórico que matchear hasta que llegue el DNI real).

### 2. Completar DNI + adicionales por ACTUALIZACIONES (modo "solo datos")

- Nuevo `mappingJson.modoActualizacion: 'RECONCILIAR' (default) | 'SOLO_DATOS'`, propagado a `ProcessContext`.
- `ActualizacionesProcessor`:
  - **Escenario A** (deudor existente, match por documento/nro_cliente): siempre corre
    `actualizarIdentidadYAdicionales` — pisa el **DNI placeholder** con el real (con chequeo de conflicto en
    la remesa), **mergea** `camposAdicionales` con "gana el valor nuevo" (`mergeAdicionales`, util nuevo
    `campos-adicionales.ts`), y rellena nombre/apellido solo si estaban vacíos.
  - **Modo SOLO_DATOS**: `validateRow` no exige montos/facturas; NO reconcilia deuda; escenario B (no
    encontrado) **no crea** deudores; y el **`afterAll` (escenario C) se saltea** — no marca a los ausentes
    como "pagó todo" (el riesgo principal de usar ACTUALIZACIONES para un archivo parcial de solo-DNI).
  - Defensa en profundidad: aunque el modo sea RECONCILIAR, si ninguna fila trajo datos de deuda
    (`sawReconciliationData=false`) el escenario C también se saltea.

### 3. Frontend

- `PlantillaEditor`: switch **"Solo actualizar datos (DNI / adicionales) — no reconciliar deuda"** (solo
  categoría ACTUALIZACIONES), persistido en `mappingJson.modoActualizacion`.
- `MappingEditor`: labels de DEUDORES / DEUDORES_Y_FACTURAS aclaran que el DNI es opcional si hay Nº Cliente
  (se agregó `nro_cliente` como campo principal en DEUDORES_Y_FACTURAS). `CategorySelector`: descripción de
  ACTUALIZACIONES ampliada.
- Nuevo util `frontend/src/utils/documento.ts` (`mostrarDocumento`): la ficha (`FichaHeader`) y el listado
  (`DeudoresTable`) muestran **"Sin DNI"** en vez del placeholder `SIN-DNI-…`.

### 4. Tests

- `documento.spec.ts` + `campos-adicionales.spec.ts` (16 casos). Los 13 tests de
  `reconciliar-actualizacion.spec.ts` siguen verdes (la reconciliación de montos no cambió).

---

## [2026-07-01] — Carga manual de pagos + Promesas de pago

> Diseño completo: [docs/pagos-promesas-spec.md](docs/pagos-promesas-spec.md) (v2, revisado por el agente architect).
> Implementado en la rama `feat/pagos-promesas`.
>
> ⚠️ **Acciones de despliegue**:
> 1. `prisma db push` aplica los campos nuevos de `pago` (`origen`, `usuarioId`, `confirmadoImport`, `confirmadoEn`) + la tabla `promesa_pago` (no destructivo).
> 2. **Asignar los permisos nuevos** (`pagos.*`, `promesas.*`) al rol ADMIN: se agregaron a `TODAS_LAS_KEYS` en `seed.ts`, así que correr el seed los asigna. En prod, re-seedear o asignarlos vía gestión de roles.
> 3. **Redeploy del backend** (incluye el cron diario de promesas — verificar que arranca).
> 4. Sin backfill obligatorio. El `maxDías` de promesa se configura por empresa en **Ajustes → Empresas** (guardado en `empresa.configuracion.promesa_pago.maxDias`, default 7, rango 1–30).

**Feature** (feedback de usuarios): cargar pagos a mano desde la ficha (cuando el operador verifica en el sistema del cliente que el deudor pagó, antes de la bajada) y registrar **promesas de pago**. Ambas desde la solapa de Pagos con un modal con toggle.

### 1. Modelo

- `pago`: nuevos `origen` (`MANUAL|IMPORT_PAGOS|IMPORT_ACTUALIZACION|CONVENIO`), `usuarioId`, `confirmadoImport`, `confirmadoEn` + índice `Pago_dedup_idx`.
- Nuevo `promesa_pago` (`estado`, `cambioSit020`, `situacionAnteriorId`, `pagosAlCrear`, `fechaPromesa`, `monto?`).

### 2. Módulo `pagos`

- `POST /pagos` (manual → consolida el deudor → cierra promesa cumplida), `DELETE /pagos/:id` (solo `MANUAL`), `GET /pagos`. Bloqueo SIT-050 + `@Audit`.
- **Fix de reversión**: al eliminar el último pago, la consolidación saltea `Σpagos=0` y no revertía; ahora se resetea `saldo=null` y —si el código era SIT-041/050— se vuelve al default de la plantilla.

### 3. Módulo `promesas`

- `POST /promesas` (se registra siempre; **código a SIT-020 solo si Σpagos=0**; update condicional anti-race; supersede la VIGENTE previa), `PATCH /:id/anular` (revierte el código si corresponde), `GET /promesas`, `POST /procesar-vencidas`.
- **Cron diario** (`@Cron` 2 AM): detecta vencidas por los registros (no por código); con pago → CUMPLIDA, sin pago → INCUMPLIDA + SIT-021 (solo si seguía en SIT-020). Cache de SIT-020/021.
- `cerrarCumplidas(deudorIds)` por snapshot `pagosAlCrear`, llamado desde pagos y desde el `afterAll` de los import processors.

### 4. Anti-duplicación (carga manual vs bajadas)

- **PAGOS** (detallado): claim por **importe exacto** — confirma un pago `MANUAL` no confirmado en vez de duplicar.
- **ACTUALIZACIONES** (saldo): reconciliación por **total** (`pagado = montoTotal − saldoArchivo − Σpagos`), en helper puro `reconciliar-actualizacion.ts` con **13 tests**. Arregla también la duplicación preexistente de bajadas sucesivas. Escenario C (afterAll) reconcilia contra `montoTotal − Σpagos`. Rama por `nroFactura` fuera de alcance (los cedentes mandan valor único de saldo).

### 5. Frontend

- `NuevoPagoModal` (toggle **Pago real / Promesa**). `FichaPagosTab`: botón "Cargar", columna Origen legible + badge "Confirmado por bajada", eliminar por fila (solo MANUAL), sección de promesas con chips de estado. Refetch (`cargarInicial` + `cargarPromesas`). Bloqueado en SIT-050.
- Permisos nuevos en catálogos back/front (`pagos.*`, `promesas.*`).

---

## [2026-07-01] — Fix: consolidación desde UI quedaba "Calculando..." (usuarioId undefined)

> ⚠️ Requiere **redeploy del backend** (solo código, sin migración).

**Problema**: el `ConsolidacionModal` (preview y aplicar) quedaba colgado en "Calculando preview..." para siempre. El job corría bien en el backend (dry-run en ~100ms, `evaluados=4113 aSIT050=40 aSIT041=306`), pero `ConsolidacionController` leía `usuario.id` del `@UsuarioActual()`, cuando el payload JWT expone el id del usuario en **`sub`** (`req['usuario'] = payload` en `jwt-auth.guard.ts`; el resto del código usa `usuario.sub`). Con `usuarioId = undefined`, el `emitToUser(undefined, 'consolidacion:finalizada')` emitía a una room inexistente y el front nunca recibía el resultado del preview → el modal no transicionaba a `preview-listo` y no se podía llegar a "Aplicar".

**Fix**: `usuario.id` → `usuario.sub` en `preview()` y `aplicar()` de `ConsolidacionController`. Único lugar del código con este error (el resto de los `@UsuarioActual()` ya usaban `sub`).

---

## [2026-07-01] — Importe del deudor desde facturas + datos adicionales unificados

> ⚠️ **Acciones de despliegue**:
> 1. **Sin migración de schema**: la opción nueva se guarda dentro de `plantillaimport.mappingJson` (`montoDeudorDesdeFacturas`). No hace falta `prisma db push` por esta feature.
> 2. **Sin backfill**: aplica solo a importaciones nuevas. Los deudores ya cargados con importe en 0 quedan como están (siguen expuestos a que un pago los marque SIT-050 vía consolidación — pendiente si aparece el caso).
> 3. Las plantillas de facturas existentes toman el default **`SI_VACIO`** al abrirlas/guardarlas (comportamiento seguro: solo rellenan importes en 0).

**Problema** (feedback de usuarios en pruebas): en el flujo de dos archivos (primero deudores, después facturas), el archivo de deudores muchas veces **no trae el importe**, así que el deudor quedaba con `montoTotal`/saldo en **0**. El de facturas sí trae los importes, pero el `FacturasProcessor` nunca tocaba al deudor. Además, los "datos adicionales" mapeados en la carga de facturas se **descartaban** (la tabla `factura` no tiene campo JSON) y no se veían en ningún lado. Un `montoTotal = 0` además rompe la consolidación (cualquier pago dispara **SIT-050**).

### 1. Importe del deudor calculado desde las facturas (configurable por plantilla)

- Nuevo modo `mappingJson.montoDeudorDesdeFacturas: 'NO' | 'SI_VACIO' | 'SIEMPRE'` (default **`SI_VACIO`**), propagado a `ProcessContext`. `NO` = no toca `montoTotal`; `SI_VACIO` = lo completa con Σfacturas solo si quedó null/0; `SIEMPRE` = pisa con Σfacturas.
- Util compartido `imports/utils/monto-facturas.ts` → `recalcularMontoTotalDesdeFacturas(ctx, deudorIds)`: recálculo **idempotente** con `UPDATE ... SET montoTotal = (SELECT SUM(importe) FROM factura ...)` en chunks de 500 (no incrementos), y luego `ConsolidacionSituacionService.consolidar({ tipo: 'DEUDORES', deudorIds })` para reconciliar saldo/situación (si Σpagos == 0 hace skip → no-op barato en carga inicial).
- `FacturasProcessor`: trackea los `deudorId` tocados y corre el recálculo en un nuevo `afterAll`.
- `DeudoresYFacturasProcessor`: se unificó a la misma lógica. Antes usaba `montoTotal: ?? rowInvoicesSum` + `{ increment }` (no idempotente, duplicaba al reimportar); ahora el importe se reconcilia en `afterAll` desde la suma real de facturas.

### 2. Datos adicionales de facturas → datos adicionales del deudor

- `FacturasProcessor` ahora acumula `row.camposAdicionales` por deudor y en `afterAll` los **mergea** dentro de `deudor.camposAdicionales` (`mergeCamposAdicionalesEnDeudores`), **sin pisar** las claves que ya tenía del import de deudores (ante clave repetida gana el último valor). Antes se descartaban.
- Quedan visibles automáticamente en la card "Datos Adicionales" de la ficha y en el catálogo de reportes (no hubo que tocar la visualización).

### 3. Frontend (`PlantillaEditor` + `MappingEditor`)

- `PlantillaEditor`: sección **"Importe del deudor"** con el selector de modo, visible solo para categorías `FACTURAS` y `DEUDORES_Y_FACTURAS`; se persiste en `mappingJson.montoDeudorDesdeFacturas` (default `SI_VACIO`).
- `MappingEditor`: la sección "Campos extras" muestra un subtítulo aclaratorio en flujos de facturas ("se cargan en los Datos Adicionales del DEUDOR, no de la factura; se mergean con los que ya tenga").

---

## [2026-06-30] — Consolidación automática de situación según pagos (SIT-050 / SIT-041)

> ⚠️ **Acciones de despliegue**:
> 1. `prisma db push` aplica los campos nuevos de `deudor`: `saldo`, `situacionConsolidadaEn` + índice `Deudor_estadoSituacion_empresa_idx` (el `deploy.sh` ya corre `db push`).
> 2. **Códigos SIT-050/SIT-041 deben estar seedeados** (`seed-codigos-curados.ts`): el `ConsolidacionSituacionService` **falla al bootstrap** si faltan (por diseño). Ya están en la base de prod.
> 3. Env opcional `CONSOLIDACION_TOLERANCIA_PCT` (default `0.01` = 1%, rango `[0, 0.05]`).
> 4. **Backfill post-deploy** de datos existentes: snapshot de `deudor(id, estadoSituacionId, montoTotal, saldo)` → botón "Consolidar" (preview → aplicar) o `npx ts-node --transpile-only prisma/scripts/backfill-consolidacion.ts --apply`.

**Problema**: al cargar pagos/actualizaciones se generaban los pagos pero el **código de situación del deudor nunca cambiaba**. Se replica la lógica del CRM anterior: si la deuda queda cancelada → **SIT-050** (Cancelado); si hay pago parcial → **SIT-041** (Pago parcial).

### 1. Modelo: `montoTotal` inmutable + `saldo` persistido

- **Schema** (`deudor`): `saldo Float?` (= `montoTotal − Σpagos`, mantenido por la consolidación), `situacionConsolidadaEn DateTime?`, índice `[estadoSituacionId, empresaId]`.
- `montoTotal` pasa a ser **inmutable** (el importe original del cedente). `actualizaciones.processor` deja de pisarlo (se eliminaron las 3 escrituras de `montoTotal` en escenarios A/B y `afterAll` C; se conserva en la **creación** de deudores nuevos). La baja se refleja vía pagos/`saldo`.

### 2. Servicio core idempotente (`backend/src/modules/consolidacion/`)

- `ConsolidacionSituacionService.consolidar(scope, opts)` con scopes `DEUDORES | REMESA | EMPRESA | TODAS`, procesado en **chunks de 500** con query agregada (`GROUP BY`, no fila por fila). Regla: `Σpagos == 0` → skip; `Σpagos ≥ montoTotal·(1−tolerancia)` → SIT-050; parcial → SIT-041; `saldo = max(0, montoTotal − Σpagos)`. Escritura por chunk en transacción (`updateMany` de situación + `$executeRaw GREATEST(0, ...)` para el saldo). `dryRun` no escribe. Idempotente. Tolerancia configurable por env, validada al bootstrap. Auditoría agregada best-effort.

### 3. Disparo automático (afterAll de processors)

- `pagos.processor` y `actualizaciones.processor` consolidan en `afterAll`: pagos usa scope `DEUDORES` (trackea `processedDeudorIds`); actualizaciones consolida la remesa origen (y la propia si difiere). Sin paso manual.

### 4. Job batch + endpoints + bloqueo de cuenta cancelada

- **Job BullMQ** `consolidacion-queue` (concurrency 1, attempts 1) con progreso por socket (`consolidacion:iniciada/progreso/finalizada`), notificación persistente y auditoría. **Lock Redis** (`lock:consolidacion`, TTL 15 min) → un solo apply a la vez; el preview no toma lock.
- **Endpoints** `/api/consolidacion`: `POST /preview` (dryRun, `202 {jobId}`), `POST /aplicar` (`409 CONSOLIDACION_EN_CURSO` si hay otro), `GET /estado`. Permiso fino `consolidacion.ejecutar` (catálogos back/front + seed; ADMIN lo recibe).
- **Bloqueo SIT-050**: `DeudorBloqueoService.assertNoBloqueado()` rechaza con `ForbiddenException(DEUDOR_CANCELADO)` toda mutación de un deudor cancelado — cableado en deudores (update/delete), comentarios (create/remove/removePropio), convenios (create/marcarCuotaPagada/anularConvenio) y contactos (create/update/remove). El consolidador y los workers de import están exceptuados.

### 5. Frontend

- **Ficha del deudor** (`FichaHeader`): muestra "Saldo actualizado" (campo `saldo`) con el "Original" tachado e inmutable y el monto pagado; fallback a "Deuda total" si `saldo` es null. Chip "CUENTA CANCELADA" y saldo en verde cuando SIT-050. Se eliminó el cálculo viejo de saldo por cuotas de convenio (el `saldo` del backend ya contempla todos los pagos).
- **Modo bloqueado**: cuando `estadoSituacion.clave === 'SIT-050'` se deshabilitan (con tooltip) los estados, contactos, convenios y comentarios de la ficha — sin clonar la vista.
- **`ConsolidacionModal`** reutilizable (preview → tabla resumen → aplicar, progreso por socket, manejo de 409) y botón "Consolidar" por remesa en `ImportHistory` (gateado por `consolidacion.ejecutar`).

> Spec de diseño completo: [docs/consolidacion-situacion-spec.md](docs/consolidacion-situacion-spec.md). Pendiente opcional (Fase 6, no implementada): cron diario + dashboard de consolidaciones + métricas.

---

## [2026-06-29] — Tanda de mejoras de UX y robustez (feedback de usuarios)

> ⚠️ **Acciones de despliegue**:
> 1. `prisma db push` aplica los campos nuevos: `remesa.validarDomicilios`, `deudor.nroCliente` + índice `Deudor_empresaId_remesaId_nroCliente_idx` (el `deploy.sh` ya corre `db push`).
> 2. **Correr una vez post-deploy** el backfill de número de cliente: `npx ts-node --transpile-only prisma/scripts/backfill-nro-cliente.ts` (idempotente). Migra el `nro_cliente` histórico desde `camposAdicionales` a la columna nueva.

### 1. Búsqueda de deudores por número de remesa

- **Backend**: `AdvancedSearchDto` suma `nroRemesa?`. `deudores.service.searchAdvanced` filtra por la relación `remesa.numeroRemesa` (`contains`).
- **Frontend**: `BuscadorAvanzadoModal.tsx` agrega el campo "Nº Remesa" al formulario.

### 2. Entorno de desarrollo: `npm run dev` en la raíz

- Nuevo `package.json` raíz con `concurrently`: `npm run dev` levanta backend (watch) + frontend (Vite) juntos. Scripts `dev:backend`, `dev:frontend`, `build`, `install:all`.
- **Fix**: `backend/tsconfig.json` ahora apunta `tsBuildInfoFile` a `./dist/...`. Antes el `.tsbuildinfo` quedaba huérfano fuera de `dist` (que `nest start` borra con `deleteOutDir`), y tsc incremental no re-emitía → `Cannot find module dist/main`.

### 3. Teléfono WhatsApp + principal: chip mitad y mitad

- **Frontend** (`FichaContactosPanel.tsx`): cuando un teléfono es WhatsApp **y** principal, el chip se pinta con un gradiente diagonal mitad naranja (principal) / mitad verde (WhatsApp), respetando dark/light mode.

### 4. WhatsApp solo en celulares — clasificación móvil/fijo por ENACOM

- En Argentina el formato no distingue móvil de fijo sin el "9"/"15" (un celular se carga como `1155775452`). `libphonenumber` devuelve `UNKNOWN` para todos los AR. La distinción real está en los rangos asignados por ENACOM.
- **Dataset**: `backend/src/common/data/enacom-prefijos.json` (≈48.900 bloques `área+central → móvil/fijo`, publicación ENACOM 2026-06-09). Versionado en git; `nest-cli.json` lo copia a `dist` (assets + watchAssets).
- **Backend** (`phone-utils.ts`): `normalizarTelefonoArgentino` clasifica `subtipo` (`MOBILE`/`FIXED_LINE`) con longest-prefix-match sobre el dataset (señal explícita del `+549` primero). `contactos.service` (create/update) rechaza marcar WhatsApp en líneas fijas; **autocorrección perezosa**: al intentar marcar un fijo legacy, persiste su `subtipo` antes de rechazar para que el frontend lo deshabilite a futuro.
- **Frontend** (`FichaContactosPanel.tsx`): el botón de WhatsApp queda deshabilitado (con tooltip) en teléfonos fijos según `contacto.subtipo`.

### 5. Importación: switch "Validar domicilios" (default OFF)

- La validación de domicilios contra Georef hacía la carga lenta (hasta 4 requests HTTP por dirección). Ahora es opcional.
- **Schema**: `remesa.validarDomicilios Boolean @default(false)`.
- **Backend**: `CreateRemesaDto` + `createRemesa` persisten el flag; `processImportJob` lo lee de la remesa y lo propaga vía `ProcessContext`. `contacto-import.ts`: si está OFF, arma el domicilio con formato pero **sin** llamar a Georef (`validado=false`). Los 3 processors que cargan contactos pasan `ctx.validarDomicilios`.
- **Frontend** (`ImportWizard.tsx`): switch "Validar domicilios contra Georef" (default OFF) en el paso de configuración.

### 6. Editor de plantillas: botón "Agregar" abajo + auto-scroll

- **Frontend** (`MappingEditor.tsx`): en las 3 secciones (campos principales, extras, bloques repetitivos) el botón de agregar pasó del header al final de la lista, con auto-scroll al nuevo ítem (solo al agregar). Evita el ir y venir de scroll.

### 7. Plantillas: clonar y cambiar de empresa (importación + reportes)

- **Importación** (`imports.service` + controller + DTOs): `POST /import/plantillas/:id/clonar` (copia config; resuelve `version` por el unique; estados por defecto → null si cambia de empresa) y `POST /import/plantillas/:id/cambiar-empresa` (**bloqueado si la plantilla tiene remesas**). El listado expone `_count.remesa`.
- **Reportes** (`reportes.service` + controller + DTOs): `/duplicar` mejorado (acepta nombre + empresa destino, `@Audit`, permiso `reportes.crear`) y nuevo `/cambiar-empresa` (**bloqueado si tiene ejecuciones**; admite "Global"). El listado expone `_count.ejecuciones`.
- **Frontend**: diálogos reutilizables `ClonarPlantillaDialog` y `CambiarEmpresaDialog` (`components/plantillas/`), integrados en `PlantillasList` y `ReportesHome`. El botón "Cambiar empresa" se deshabilita si la plantilla ya se usó.

### 8. Número de cliente como campo principal del deudor

- El `nro_cliente` (clave del match de pagos/facturas/contactos/actualizaciones/bloques) vivía como dato adicional en `camposAdicionales` con clave mágica `nro_cliente` hardcodeada en 5 processors → frágil y sin índice.
- **Schema**: nueva columna `deudor.nroCliente String?` + índice compuesto `[empresaId, remesaId, nroCliente]`. Backfill idempotente `prisma/scripts/backfill-nro-cliente.ts`.
- **Backend**: la carga de deudores (`deudores` y `deudores-facturas` processors) ahora **exige** `nro_cliente` y lo guarda en la columna; helper `utils/nro-cliente.ts` lo toma como campo principal o como adicional (compatibilidad con plantillas viejas). Los 5 processors de match ahora usan la columna indexada en vez de `JSON_EXTRACT`. `searchAdvanced` busca por `nroCliente` (+ fallback a datos viejos).
- **Frontend** (`MappingEditor.tsx`): "Nº Cliente (match)" agregado a los campos principales de DEUDORES.

### 9. Borrar remesa terminada junto con sus casos

- **Backend** (`imports.service.deleteRemesa`): permite borrar remesas terminadas con casos **solo si ningún deudor tiene gestión** (comentarios, convenios, pagos, llamadas, emails). Si la tiene, rechaza con el detalle. Borrado transaccional en cascada controlada (contactos + campoextras + facturas → deudores → jobs/errores → remesa); la auditoría se conserva (transacciones quedan desvinculadas).
- **Frontend** (`ImportHistory.tsx`): el botón eliminar se habilita en cualquier estado salvo "en curso"; el diálogo aclara que se borran los casos y que se bloquea si hay gestión.

### 10. Políticas: editor enriquecido en las 3 secciones + tabs

- **Frontend** (`AjustesPoliticas.tsx`): el modal de carga/edición se reorganizó en **3 tabs** (Descripción/Metodología · Formas de pago · Tipo de atención). Las 3 secciones usan ahora `RichTextEditor` (Tiptap: títulos, negrita/cursiva/subrayado, colores, listas, alineación) — antes solo la descripción. Modal a `maxWidth="md"`; la tabla limpia el HTML (`stripHtml`) en las columnas de formas de pago y tipo de atención.
- **Frontend** (`PoliticaTab.tsx`): en la ficha del deudor, "formas de pago" y "tipo de atención" se renderizan como HTML (`RichTextEditor` readOnly), igual que la descripción.
- **Backend**: sin cambios — los 3 campos ya eran `@db.Text`. Los datos viejos en texto plano se siguen viendo bien y quedan como HTML al re-editarlos.

### 11. Número de cliente en el encabezado de gestión

- **Frontend** (`FichaHeader.tsx`): se muestra el **Nº Cliente** junto a Empresa y Remesa en el header de la ficha del deudor. Toma `deudor.nroCliente` con fallback a `camposAdicionales.nro_cliente` (datos previos a la migración).

### 12. Bloques repetitivos en todas las categorías de importación

- **Bug detectado en prod**: una plantilla con bloques repetitivos (contactos/facturas) cargada con categoría `DEUDORES` mostraba los bloques en el preview pero **no los persistía** — solo `DEUDORES_Y_FACTURAS` (y parcialmente `ACTUALIZACIONES`) procesaban `_blocks`. Resultado: deudores creados sin sus facturas/contactos.
- **Backend**: nueva función común `procesarBloquesDeudor(deudorId, blocks, ctx)` en `utils/procesar-bloques.ts` que procesa bloques `FACTURA` y `CONTACTO` (respetando `validarDomicilios`). Se llama tras resolver el deudor en **todos** los processors: `deudores`, `contactos`, `enriquecimiento`, `pagos`, `facturas`; y `deudores-facturas` se refactorizó para usarla. En `contactos`/`enriquecimiento` los bloques se procesan aunque no haya contacto principal en la fila.
- `ACTUALIZACIONES` se dejó intacto (tiene reconciliación especial de facturas).

### 13. Notificaciones: fix del contador + rediseño con tabs y paginación

- **Bug**: el badge mostraba un número que no coincidía con la ventana (badge con N pero lista vacía). Causa: el cliente `listarNotificaciones` devolvía el objeto `{ data, total, ... }` entero en vez del array → la lista quedaba sin renderizar. Además `/import/en-curso` devolvía la remesa cruda (campos con otros nombres) y `crear` podía emitir el socket con `id` undefined.
- **Backend**: `listarEnCurso` ahora aplana al shape `ImportEnCursoDto` (`remesaId`, `tipo`, `progreso`, `usuarioNombre`, `startedAt`). `listar` soporta filtro `soloLeidas` (además de `soloNoLeidas`) y devuelve `total` para paginar. `crear` inserta una por una y emite el socket con el `id` real.
- **Frontend**: `listarNotificaciones` devuelve `{ data, total }` correctamente. El contexto usa el contador real de no-leídas para el badge, expone un `nonce` para refrescar y ya no guarda la lista. El popover se rediseñó con **2 tabs (Sin leer / Leídas)** + **scroll infinito** (páginas de 20 por `offset`); las importaciones en curso quedan arriba.

---

## [2026-05-13] — Usuarios: legajo, DNI y telefonía integrada en ABM

### Backend

- **Schema Prisma**: campos `legajo String? @unique` y `dni String? @unique` en modelo `usuario`. Aplicado con `db push`.
- **DTOs nuevos**: `CreateUsuarioDto` y `UpdateUsuarioDto` extienden con `legajo`, `dni` (validación DNI 7-8 dígitos o CUIL 11 dígitos con regex), `esAgente` y objeto `agente` con campos SIP. `UpdateUsuarioDto` usa `AgenteUpdateDto` (todos opcionales; passwords vacíos preservan los existentes en DB).
- **UsuariosService**: inyecta `SipCryptoService`. `create()` y `update()` operan dentro de `$transaction`. Lógica de agente_telefonia: crear, actualizar o DELETE según `esAgente`. `findAll()` devuelve `esAgente` y `agente` (sin campos `*Enc`). Manejo de P2002 con `ConflictException` descriptivo por campo.
- **UsuariosModule**: importa `NeotelModule` para acceder a `SipCryptoService`.
- **neotel.controller.ts**: `NeotelAdminController` conserva solo `GET /admin/neotel/agentes` (debug). Se eliminaron `POST`, `PATCH` y `DELETE` de ese controller — el ABM de agentes ahora se gestiona desde `PATCH /usuarios/:id`.

### Frontend

- **`PasswordField`** (`frontend/src/components/ui/PasswordField.tsx`): componente reutilizable. En alta: input editable + toggle ojito. En edición: input disabled con placeholder `••••••••` + botón "Cambiar" para habilitarlo.
- **`UsuariosPage.tsx`**: Dialog refactorizado a `maxWidth="md"` con 3 accordions (Datos personales / Acceso / Telefonía). Columna "Legajo" agregada en tabla. Chip "Agente" junto al nombre cuando `esAgente=true`. Validación client-side de DNI/CUIL con helperText de error en tiempo real. Lógica de payload que omite passwords vacíos en edición.
- **Types**: interfaces `Usuario` y `AgenteTelefonia` actualizadas con campos nuevos.

---

## [2026-05-13] — Neotel T5: sesión, estado y campaña del agente

### T5 — Sesión + Estado + Campaña del Agente (backend)

Nuevos servicios y controller en `backend/src/modules/neotel/`:

- **`neotel-redis.service.ts`** — capa de caché Redis para el estado del agente. Usa ioredis (dependencia transitiva de bullmq). Keys: `neotel:agente:{id}:sesion` (hash, TTL 8h) y `neotel:agente:{id}:estado` (hash, sin TTL — se borra al logout). Modo degradado: si Redis falla, los métodos loguean warn y retornan null sin lanzar excepción. Expone `ping()` y `getClient()` para uso interno.
- **`sesion-agente.service.ts`** — `loginAgente(usuarioId, meta)`: valida sesión duplicada → llama `NeotelHttpClient.login` → crea `sesion_agente_neotel` + `estado_agente_evento` inicial (DISPONIBLE) → cachea en Redis. `logoutAgente(usuarioId)`: llama `NeotelHttpClient.logout` (tolera error de red) → cierra evento de estado abierto (calcula duracionSeg) → actualiza `logoutAt` + `causaCierre` en DB → elimina keys Redis. `getSesionActiva(usuarioId)`: Redis first, fallback a DB con re-hidratación.
- **`estado-agente.service.ts`** — `setEstado(usuarioId, estado, motivoPausaId?)`: valida estado manual (DISPONIBLE/EN_PAUSA/ADMINISTRATIVO) → valida motivo si EN_PAUSA → llama API Neotel correspondiente (Unpause/Pause/Tiempo_Administrativo) → cierra evento anterior → crea nuevo `estado_agente_evento` → actualiza Redis. `getEstadoActual(usuarioId)`: Redis first, fallback DB. `listarMotivosPausa()`: desde tabla `motivo_pausa_neotel` (activos, ordenados por `orden`). TODO(T8): emitir socket `estado:cambio` al completar `setEstado`.
- **`campaña-agente.service.ts`** — `asignarCampaña(usuarioId, campañaNeotelId)`: valida sesión activa → valida campaña activa → llama `loginCampaign` → cierra campaña anterior si la hay → crea `campaña_sesion_neotel` → actualiza Redis. `desasignarCampaña(usuarioId)`: llama `logoutCampaign` → cierra registro en DB → limpia Redis. `listarCampañasDisponibles()`: todas las activas de `campaña_neotel`.
- **`neotel-sesion.controller.ts`** — controller dedicado `@Controller('neotel')` con todos los endpoints de sesión/estado/campaña (ver abajo). Todos con `@Audit`.
- **`dto/neotel-api.dto.ts`** — extendido con `SetEstadoDto` (estado + motivoPausaId optional) y `AsignarCampañaDto`.
- **`neotel.module.ts`** — registra `NeotelRedisService`, `SesionAgenteService`, `EstadoAgenteService`, `CampañaAgenteService`, `NeotelSesionController`.

### Endpoints nuevos

| Método | Ruta | Descripción | Permiso |
|---|---|---|---|
| `POST` | `/neotel/sesion/login` | Login en Neotel + crea sesión DB + Redis | `telefonia.usar` |
| `POST` | `/neotel/sesion/logout` | Logout Neotel + cierra sesión + invalida Redis | `telefonia.usar` |
| `GET` | `/neotel/sesion/actual` | Sesión activa (Redis → DB) | `telefonia.usar` |
| `PUT` | `/neotel/estado` | Cambia estado (DISPONIBLE/EN_PAUSA/ADMINISTRATIVO) | `telefonia.usar` |
| `GET` | `/neotel/estado/actual` | Estado actual (Redis → DB) | `telefonia.usar` |
| `GET` | `/neotel/motivos-pausa` | Lista motivos de pausa activos | `telefonia.usar` |
| `GET` | `/neotel/campañas` | Lista campañas activas | `telefonia.usar` |
| `POST` | `/neotel/campaña/asignar` | Asigna a campaña + llama Login_Campaign2 | `telefonia.usar` |
| `POST` | `/neotel/campaña/desasignar` | Desasigna de campaña + llama Logout_Campaign | `telefonia.usar` |

### Variables de entorno

No se requieren variables nuevas. Usa `REDIS_HOST` y `REDIS_PORT` ya declaradas por BullMQ.

### Smoke test esperado

- `POST /neotel/sesion/login` → error 502 "Position Externo6001 not found" si la extensión no está activa (comportamiento correcto, se registra el intento de login en logs). DB: NO crea sesion porque el error ocurre antes de `sesion_agente_neotel.create`.
- `GET /neotel/motivos-pausa` → 4 motivos seedeados (Almuerzo/Baño/Capacitación/Reunión).
- `GET /neotel/campañas` → campaña 115.

### AuditTipo usados

`TEL_LOGIN`, `TEL_LOGOUT`, `TEL_ESTADO_CAMBIAR`, `TEL_CAMPAÑA_ENTER`, `TEL_CAMPAÑA_LEAVE` (ya existían en audit.enums.ts desde T3/T4).

---

## [2026-05-13] — Neotel T3 + T4: cliente HTTP + credenciales SIP cifradas

### T3 — NeotelHttpClient (backend)

Módulo `neotel` nuevo en `backend/src/modules/neotel/`:

- **`neotel-http.client.ts`** — cliente HTTP a la API ASMX de Neotel. Cubre todos los endpoints de §4.1 (auth/sesión), §4.2 (campañas), §4.3 (estados), §4.4 (llamadas), §4.6 (eventos), §4.7 (contactos CRM). Método core `call<T>()` con retry exponencial (3 intentos, 300ms/600ms de backoff), timeout configurable (default 8s), sanitización de campos sensibles en logs (CLAVE, DATA, XML_UPDATE). Usa `fetch` nativo de Node 18+.
- **`parsers/xml-response.parser.ts`** — parser de respuestas XML mínimas de Neotel (`<string>`, `<boolean>`, void). Soporte de respuestas planas (sin wrapper XML).
- **`errors/neotel.errors.ts`** — `NeotelApiError`, `NeotelTimeoutError`, `NeotelAuthError`, `NeotelInvalidResponseError`.
- **`dto/neotel-http.dto.ts`** — interfaces tipadas para todos los parámetros de la API Neotel.
- Config desde env: `NEOTEL_API_HOST`, `NEOTEL_API_USER`, `NEOTEL_API_PASS`, `NEOTEL_TIMEOUT_MS`, `NEOTEL_RETRY_ATTEMPTS`.

Smoke test: `POST http://200.5.98.203/neoapi/webservice.asmx/Login` → HTTP 500 con body "Position Externo6001 not found" (API accesible, error de estado Neotel — la extensión no está activa en este momento).

### T4 — Credenciales SIP cifradas (AES-256-GCM)

- **`crypto/sip-crypto.service.ts`** — servicio AES-256-GCM. Formato: `<iv_base64>:<authTag_base64>:<ciphertext_base64>`. Acepta key como 64 hex chars o base64 de 32 bytes. Valida al boot (`OnModuleInit`) y falla rápido si no está configurada. Detecta tampering via authTag GCM. Método `isEncrypted()` para distinguir plain text de cifrado (soporta credenciales legacy).
- **`crypto/sip-crypto.service.spec.ts`** — 19 tests unitarios: round-trip, IV aleatorio, tampering authTag, tampering ciphertext, formato inválido, key incorrecta, edge cases. Todos pasan.
- **`prisma/scripts/encrypt-sip-passwords.ts`** — script idempotente de migración. Detecta plain text vs cifrado (por formato IV base64), cifra solo los que lo necesitan. Soporta `--dry-run`. Migrado agente 1 (6001): `Externo6001` y `10066001` → ciphertext AES-256-GCM.
- **`agente-telefonia.service.ts`** — ABM completo: `listar()` (sin passwords), `crear()` (cifra al guardar), `actualizar()` (cifra si llega password), `eliminar()`. Soporta credenciales legacy en plain text (las descifra correctamente).
- **`neotel.controller.ts`** — `GET /neotel/sip-credentials` (permiso `telefonia.usar`; descifra y devuelve `{extension, sipUri, authUser, password, wssUrl, displayName}`). ABM admin en `/admin/neotel/agentes` (permiso `telefonia.admin`).
- **`neotel.module.ts`** — módulo registrado en AppModule. Importa TransaccionesModule para auditoría.

### Configuración requerida

Variables nuevas en `.env`:
```
NEOTEL_API_HOST=http://200.5.98.203
NEOTEL_API_USER=6001
NEOTEL_API_PASS=10066001
NEOTEL_TIMEOUT_MS=8000
NEOTEL_RETRY_ATTEMPTS=3
NEOTEL_SIP_DOMAIN=200.5.98.203
NEOTEL_WSS_URL=wss://200.5.98.203:8089/ws
NEOTEL_SIP_ENCRYPTION_KEY=<64 hex chars — generar con: openssl rand -hex 32>
```

Para cifrar credenciales existentes en la DB:
```bash
npx ts-node --transpile-only prisma/scripts/encrypt-sip-passwords.ts --dry-run  # previsualizacion
npx ts-node --transpile-only prisma/scripts/encrypt-sip-passwords.ts             # aplicar
```

### AuditTipo nuevos en audit.enums.ts

`TEL_SIP_CREDENTIALS_OBTENIDAS`, `TEL_AGENTE_CREADO`, `TEL_AGENTE_ACTUALIZADO`, `TEL_AGENTE_ELIMINADO`, `TEL_AGENTE_LISTADO`.

### Permisos nuevos en permisos-catalogo.ts

Sección "Telefonía": `telefonia.usar`, `telefonia.click_to_call`, `telefonia.supervisar`, `telefonia.admin` (ya existían en la DB desde T2; ahora registrados también en el catálogo de permisos del frontend/admin).

---

## [2026-05-12] — Timeline de deudor unificado (Gestión ↔ Sender)

### Decisión

Tab top-level **Timeline** en la sección de deudores que consume el internal-api de AMSA Sender y muestra cronológicamente todas las acciones salientes (emails, WhatsApp Web legacy, WhatsApp Meta/WAPI) con sus estados (entregado, abierto, click, fallido, rebote). Match Gestión ↔ Sender por `documento` (no por id — los sistemas conviven sin relación 1:1). Reemplaza el tab "Emails" interno de la ficha: como los envíos de Gestión van por Sender, quedan unificados en este timeline.

### Cambios — Backend Gestión

- **`modules/timeline/`** — nuevo módulo (DTO + controller). `GET /timeline/deudores/:id` protegido por `deudores.ver`. Si el deudor no tiene documento → devuelve vacío sin llamar a Sender.
- **`email-sender/sender-http.client.ts`** — método `timelinePorDocumento(documento, query)` + tipos `SenderTimelineEntry/Response/Query`. El cliente HTTP ahora se exporta desde `EmailSenderModule` para reuso entre módulos.
- **`email-sender/email-sender.service.ts`** — al enviar email pasa `deudorDocumento` para que Sender pueda linkear `ContactoEmail.deudorId` (sino el envío queda sin match y no aparece en el timeline).

### Cambios — Frontend Gestión

- **`components/deudores/TimelineDeudorTab.tsx`** — nuevo componente. Filtros canal/desde/hasta + selector "Por página" (5/10/20/50, default 5) para evitar scroll infinito en deudores con muchas acciones. Cards con borde izquierdo coloreado por canal, chip de estado, asunto/mensaje/URL/error/campaña según corresponda.
- **`components/deudores/TabsPanel.tsx`** — tab top-level "Timeline" (índice 3) junto a Datos/Lista/Política. Solo monta el componente cuando `selectedTab === 3` (no necesita guard `active`).
- **`components/deudores/ficha/FichaDeudor.tsx`** — removidos sub-tab "Emails" y sub-tab "Timeline" internos. El botón de enviar email del chip de contacto sigue funcionando vía `EnviarEmailDialog`.
- Eliminado `FichaEmailsTab.tsx` (huérfano).
- `api/timeline.ts` + `types/timeline.ts` nuevos.

### Notas

- Pagination ya existente (5/10/20/50 por página). Default 5 para que el tab no haga scroll infinito.
- Spec completa: `docs/timeline-spec.md`.
- Endpoint Sender: `GET /api/internal/timeline/por-documento/:documento` con scope `timeline:read` (ver changelog de Sender).
- Conversaciones WAPI entrantes y llamadas Neotel quedan fuera de scope (siguiente fase).

---

## [2026-05-11] — Contactos: UX de chips, validación de direcciones (Georef) y normalización en imports

### Decisión

Unificar el ciclo de vida de un contacto (alta manual + import + auditoría) bajo un único pipeline de normalización: teléfono → E.164, email → MX, dirección → nomenclatura canónica de Georef Argentina con filtros por localidad/provincia. La nomenclatura canónica (`MUÑIZ 683, Comuna 5, Ciudad Autónoma de Buenos Aires (CP 1182)`) pasa a ser la forma de almacenamiento estándar tanto en cargas manuales como en imports.

### Cambios — Frontend (ficha del deudor)

**`FichaContactosPanel.tsx` — sistema de chips tri-estado**
- Esquema de color por estado: `warning` (principal/dorado), `success` (WhatsApp/verde), `primary` (validado), `error` (no validado). `variant=filled` cuando hay estado distintivo o no validado, `outlined` cuando es validado neutro.
- En chips filled (principal/whatsapp), el label/iconos/delete-icon se fuerzan a `common.white` para evitar contraste roto en modo oscuro (sobreescribe `.MuiChip-label`/`.MuiChip-deleteIcon`/`.MuiChip-icon`).
- Iconos de estrella/whatsapp siempre coloreados (`warning.main`/`success.main`) cuando no están filled — antes se veían gris por default.
- Ordenamiento: `prioridad === 1` siempre se renderiza primero.
- Botón "copiar al portapapeles" movido **dentro del chip** para email/direccion/red_social (antes vivía fuera del Stack). Ya no abre confirm modal — copia directa.

**`AgregarContactoModal.tsx` — alta manual de direcciones**
- Botón "Validar Dirección" llama a Georef con `{ localidad, provincia }` separados (antes concatenaba en el texto y producía falsos positivos cuando la calle existía en otra localidad).
- Alert de resultado con JSX: muestra sugerencia con `<strong>{calle}</strong> en <strong>{loc}, {prov}</strong>` cuando Georef encontró match en otra localidad.
- Permite guardar como "no validada" si el usuario insiste (se persiste con `validado=false`).
- POST `/contactos` ahora envía `direccionLocalidad`, `direccionProvincia` y `direccionCp` para que el backend pueda validar con filtros y componer la forma canónica.

### Cambios — Backend (contactos)

**`contactos.service.ts`**
- `create()` y `update()` para `tipo='direccion'`: llaman `normalizarDireccionArgentina(valor, { localidad, provincia })`. Si valida → guardan `nomenclatura + " (CP X)"` y `validado=true`. Si no → guardan el texto crudo recortado con `validado=false` (ya no tiran 400 BadRequest — el usuario decide).
- `update()` cambia su shape de retorno a `{ before, after, deudorId }` para alimentar el snapshot del audit interceptor (igual patrón que `deudores.service`).
- `create()` para teléfono con `prioridad=1`: corre en transacción que primero hace `updateMany prioridad=null` en los otros tel/wapp del mismo deudor.

**`contactos.controller.ts` — resúmenes de auditoría humanos**
- `etiquetaTipo()`, `flagsContacto()`, `resumenUpdateContacto()`: en lugar de "Actualizó contacto 11" ahora dice "Marcó WhatsApp el teléfono +5491124624268", "Quitó principal del email x@y.com", "Editó dirección de Deudor X", etc.
- `@Audit` en update lee `before` para detectar diffs (whatsapp/prioridad/valor cambiados).

**`dtos/create-contacto.dto.ts`**
- Nuevos campos opcionales: `direccionLocalidad`, `direccionProvincia`, `direccionCp` (strings).

### Cambios — Backend (utils de dirección y email)

**`common/utils/direccion-utils.ts`**
- `DireccionFiltros = { provincia?, localidad? }` exportado.
- Aliases CABA (`capital federal`, `caba`, `ciudad autonoma de buenos aires`, `ciudad de buenos aires`) tratados como equivalentes vía `normalizarParaComparar()` (strip de acentos + minúsculas) y `coincideLocalidad()`.
- `callGeoref(direccionStr, filtros)` ahora usa `URLSearchParams` con `provincia=`/`localidad=` (antes concatenaba en el texto y daba falsos positivos).
- `intentarVariantes()` reintenta variaciones (sin abreviaturas, etc.) antes de declarar no encontrada.
- `normalizarDireccionArgentina(input, filtros)` valida match real de localidad antes de devolver `valido=true`. Si Georef devuelve resultado en otra localidad, expone `sugerencia` para que el UI ofrezca corrección.

### Cambios — Backend (imports)

**Nuevo helper `modules/imports/utils/contacto-import.ts`**
- `prepararContactoImport(data)` unifica la normalización de contactos entre los 3 processors (`contactos`, `enriquecimiento`, `deudores-facturas`).
- Acepta input `{ tipo, valor, direccion_calle, direccion_numero, direccion_cp, direccion_localidad, direccion_provincia }`. Devuelve `{ tipo, valor, validado } | null`.
- Cache in-memory (`Map`) por proceso para evitar llamar Georef/DNS-MX repetidas veces para el mismo dato dentro de una remesa grande.
- `clearContactoImportCaches()` para limpiar en `afterAll` de cada processor.

**Processors refactorizados**
- `contactos.processor.ts`: usa `prepararContactoImport()`. `validateRow` acepta direcciones aún sin `valor` cuando llegan estructuradas. `afterAll` limpia caches.
- `enriquecimiento.processor.ts`: mismo refactor.
- `deudores-facturas.processor.ts`: `upsertContacto(deudorId, data, ctx)` ahora delega al helper. Bloques de tipo `CONTACTO` se aceptan también cuando traen solo columnas estructuradas (calle/numero/loc/prov) sin `valor`.

**Comportamiento de almacenamiento**
- Si Georef valida → se guarda la `nomenclatura` canónica + `(CP X)` cuando hay CP. Mismo formato que las altas manuales.
- Si Georef no valida → se guarda texto compuesto (`calle numero, localidad, provincia (CP X)`) con `validado=false`. La fila no falla.

### Cambios — Frontend (imports y preview)

**`MappingEditor.tsx`**
- Categorías `CONTACTOS` y `ENRIQUECIMIENTO` ganan dest fields nuevos: `direccion_calle`, `direccion_numero`, `direccion_cp`, `direccion_localidad`, `direccion_provincia`.
- El usuario puede mapear direcciones de dos formas: (a) monolítica vía `valor`, (b) estructurada vía columnas separadas. Mezcla válida también (calle+numero+localidad+provincia con o sin CP).

**`PreviewTable.tsx`**
- Para bloques `CONTACTO` con `tipo=direccion`, el resumen se arma a partir de los campos estructurados: `calle numero, localidad, provincia (CP X)` cuando vienen mapeados; fallback al `valor` monolítico. Antes mostraba "DIRECCION: -" porque solo leía `data.valor`.

### Cambios — Frontend (auditoría)

**`AuditDiffView.tsx`**
- Bloque "Contexto/parámetros" migrado de `<pre style={{background:'#f5f5f5'}}>` (hardcoded) a `Box component="pre"` con `sx` theme-aware (`grey.900` en dark, `grey.100` en light). Soluciona contraste roto en modo oscuro.
- Nueva `limpiarExtra()`: filtra `undefined`/`null`/objetos vacíos/arrays vacíos antes de renderizar para no mostrar bloques con `{}`.

**`AuditoriaStream.tsx` + `AuditoriaBusqueda.tsx`**
- Drawer de detalle: en lugar de pasar solo `data.params` y `data.contexto` como `extra` (lo que dejaba la mayoría de las entradas vacías), pasa todas las claves de `data` excepto `before`/`after`:
  ```tsx
  extra={(() => {
    const { before: _b, after: _a, ...rest } = selected.data ?? {};
    return rest;
  })()}
  ```

### Bug fixes y micro-ajustes

- `AuditInterceptor.entidadIdFromResponse: 'after.id'` no funcionaba (el interceptor hace `result[opts.entidadIdFromResponse]` literal, sin resolver dot-paths). Workaround: usar `entidadIdParam: 'id'` desde el param de URL.
- `result?.deudorId` se resuelve en top-level del shape devuelto → los servicios refactorizados (`deudores`, `contactos`) hacen spread `{ before, after, deudorId: after.deudorId }`.

### Cómo retomar / verificar

1. Backend: `npm run start:dev` desde `backend/`. No requiere migración (no hay cambios de schema).
2. Frontend: `npm run dev` desde `frontend/`.
3. Probar alta manual de dirección con `(CP 1182)` y verificar que queda en formato canónico.
4. Probar import con bloque `CONTACTO` mapeando `direccion_calle/numero/cp/localidad/provincia` por separado: la preview debe mostrar el resumen compuesto, y al confirmar las direcciones deben guardarse normalizadas.
5. Truncado para repruebas:
   ```sql
   SET FOREIGN_KEY_CHECKS = 0;
   TRUNCATE `amsa-gestion`.`campoextra`;
   TRUNCATE `amsa-gestion`.`comentario`;
   TRUNCATE `amsa-gestion`.`contacto`;
   TRUNCATE `amsa-gestion`.`factura`;
   TRUNCATE `amsa-gestion`.`pago`;
   TRUNCATE `amsa-gestion`.`convenio`;
   UPDATE `amsa-gestion`.`transaccion` SET deudorId = NULL WHERE deudorId IS NOT NULL;
   TRUNCATE `amsa-gestion`.`deudor`;
   SET FOREIGN_KEY_CHECKS = 1;
   ```

---

## [2026-05-11] — Auditoría 100%: `transaccion` como SOR + frontend `/auditoria`

### Decisión

`transaccion` pasa a ser el **System-of-Record** único para toda acción del sistema (escrituras de gestión, importaciones, reportes, AUTH, denegaciones de permiso, eventos de sistema). El log de Pino sigue existiendo para diagnóstico técnico pero no es fuente de verdad.

### Cambios — Backend

**Schema (`prisma/schema.prisma`)**
- `transaccion`: nuevos campos `empresaId` (FK a `empresa`, nullable), `modulo` (`GESTION` | `IMPORT` | `REPORTES` | `ADMIN` | `AUTH` | `SISTEMA`), `severidad` (`INFO` | `WARN` | `ERROR`), `estado` (`OK` | `FALLIDO`), `recursoTexto` (descripción legible del recurso afectado).
- `transaccion.usuarioId` ahora **nullable** (eventos de sistema / workers sin usuario humano).
- Índices nuevos: `(empresaId, createdAt)`, `(modulo, createdAt)`, `(estado, createdAt)`, `(severidad, createdAt)`, `(usuarioId, createdAt)`.
- `npx prisma db push`.

**Decorador + interceptor (`modules/transacciones/audit.*`)**
- `@Audit({ modulo?, entidad, tipo, severidad?, estado?, recursoTexto?, empresaId?, entidadIdParam?, before? })`.
- `AuditInterceptor` ahora: (a) lee `req.usuario.sub` correctamente (bug previo `req.user?.id ?? 1` → falsificaba autoría), (b) ejecuta hook `before(req)` para snapshot antes del cambio, (c) usa `rxjs.catchError` para registrar `estado: 'FALLIDO'` cuando el handler tira excepción, (d) redacta automáticamente `password`/`token`/`secret`/`apiKey` en `data.before/after/params`.
- `AuditoriaHelper` (servicio inyectable) para flujos no-HTTP: workers BullMQ, seeds, cron jobs.

**Endpoints (`/transacciones`)**
- `GET /transacciones` — listado con filtros: `desde/hasta`, `modulo`, `entidad`, `entidadId`, `tipo`, `severidad`, `estado`, `usuarioId`, `empresaId`, `deudorId`, `q` (búsqueda libre), paginación `limit/offset`, `orderDir`.
- `GET /transacciones/stats` — KPIs (hoy/semana/mes/fallidos 24h), serie 30d, top tipos, top usuarios, distribución por módulo.
- `GET /transacciones/:id` — detalle con relaciones (usuario, empresa, deudor).
- `POST /transacciones/export?formato=xlsx|csv|pdf` — reutiliza `XlsxExportador`/`CsvExportador`/`PdfExportador` de `reportes/exportadores/`. Devuelve Buffer + headers `Content-Disposition`. Requiere permiso `auditoria.exportar`.

**Permisos (`auth/permisos-catalogo.ts` + `seed.ts`)**
- Sección "Auditoría" con `auditoria.ver`, `auditoria.ver_todos`, `auditoria.exportar`. Sin `auditoria.ver_todos`, el usuario solo ve sus propias transacciones (filtrado por `usuarioId` en el service).

**Eventos AUTH (`auth/auth.service.ts` + `auth.controller.ts` + `permisos.guard.ts`)**
- `LOGIN_OK` / `LOGIN_FAIL` (motivos `no_existe`, `inactivo`) con `ip`/`userAgent`/`empresaId`.
- `LOGOUT` vía nuevo `POST /auth/logout`.
- `PERMISO_DENEGADO` desde `PermisosGuard` (asíncrono).

**Cobertura 100% (`@Audit` en write endpoints)**
- `convenios.controller`, `empresas.controller`, `politicas.controller`, `parametros.controller`, `roles.controller`, `usuarios.controller`, `imports.controller`, `reportes.controller` (create/update/delete/ejecutar/descargar), `comentarios.controller`, `contactos.controller` y `deudores.controller` (ya tenían `@Audit`, ajustados al nuevo shape).
- `imports.processor` (BullMQ) registra `IMPORT_OK`/`IMPORT_FAIL` vía `AuditoriaHelper` con `usuarioId` del job.

**Catálogo de reportes (`reportes/catalogo/metadata.ts` + `dto/plantilla.dto.ts`)**
- `transaccion` y `usuario` removidos de `MODELOS_OCULTOS` para que puedan ser raíz/relación en plantillas de reportes.
- `Raiz` enum gana `TRANSACCION = 'transaccion'` (permite generar reportes nativos sobre el log).
- Labels nuevos para campos de transacción (Fecha, Usuario, Módulo, Entidad, Tipo, Severidad, Estado, Resumen, Recurso, IP).

### Cambios — Frontend

**Nueva sección `/auditoria` (`pages/auditoria/*`)**
- Tres tabs: **Dashboard** (KPIs + LineChart actividad 30d + PieChart por módulo + BarChart top tipos/usuarios, auto-refresh 60s), **Stream** (timeline tiempo real, auto-refresh 30s), **Búsqueda** (filtros completos + tabla paginada + drawer detalle con diff antes/después).
- `AuditDiffView`: aplana objetos anidados (`flat()`) y pinta cambios con chips `nuevo`/`cambiado`/`eliminado`.
- Botón **Exportar** (menú: Excel/CSV/PDF server-side + CSV cliente para la página actual). Solo visible con permiso `auditoria.exportar`.

**Routing / nav (`AppRoutes.tsx`, `navConfig.ts`, `SideNav.tsx`)**
- Ruta `/auditoria` registrada.
- Entrada "Auditoría" (icono `FactCheck`) bajo "Administración", visible con `auditoria.ver`.

**API client (`api/auditoria.ts`, `types/auditoria.ts`)**
- `auditoriaApi.listar/stats/obtener/exportar` con tipos `Transaccion`, `AuditoriaStats`, `QueryAuditoria`.

### Migración de roles

- Asignar `auditoria.ver` (y opcionalmente `auditoria.ver_todos`, `auditoria.exportar`) a los roles que correspondan vía UI `/admin/roles`. Por defecto los roles existentes no tienen estos permisos.

### Pendientes / fuera de scope de esta entrega

- F5 (retención + archivado): retención indefinida confirmada por producto, no se implementa cron de archivado por ahora.
- Tests unitarios del `AuditInterceptor`: pendientes (caso `before`/`after`, FALLIDO path, usuario nulo).
- Link "Historial de cambios" desde `FichaDeudor` a `/auditoria?deudorId=X`: pendiente.

---

## [2026-05-11] — Eliminación de reportes v1 + rename de v2 → versión oficial

### Decisión

Reportes v2 (constructor dinámico tipo Power BI) reemplaza completamente al motor v1 estático. Ya no convive un v1 + v2: el módulo v1 se eliminó y v2 pasó a llamarse simplemente "reportes" (sin sufijo) en código, DB y URLs. Más adelante se construirá un módulo separado de dashboards/tableros.

### Cambios

**Eliminación v1.**
- Backend: removido `backend/src/modules/reportes/v1/*` y referencias en `app.module.ts`.
- Frontend: removidos componentes, rutas, tipos `PlantillaV1`/`PlantillaUnificada` y la lógica que mezclaba v1+v2 en `ReportesHome`.
- Prisma: drop de modelos `plantilla_reporte` y `ejecucion_reporte` v1 (no había datos relevantes en estas tablas), `db push`.
- Catálogos de permisos (`auth/permisos-catalogo.ts`, `seed.ts`, `frontend/utils/permisosCatalogo.ts`) consolidados a una única sección "Reportes".

**Rename v2 → reportes (sin sufijo).**
- Backend: carpeta `backend/src/modules/reportes/v2/*` movida a `backend/src/modules/reportes/`. Archivos `*-v2.*` renombrados (`reportes-v2.controller.ts` → `reportes.controller.ts`, idem service/module/gateway/processor/queue, DTOs, exportadores, etc.). `@Controller('reportes/v2')` → `@Controller('reportes')`. Storage path `reportes/v2/{anio}/{mes}` → `reportes/{anio}/{mes}`.
- Clases y constantes: `ReportesV2*` → `Reportes*`, `EjecucionesV2*` → `Ejecuciones*`, `Xlsx/Csv/Txt/PdfV2Exportador` → sin sufijo, `REPORTES_V2_*_ENV` → `REPORTES_*`, `RaizV2`/`ColumnaV2`/`FiltroV2`/`AgrupacionV2`/`TotalV2`/`OrdenamientoV2`/`PlantillaV2`/`EjecucionV2`/`EstadoEjecucionV2`/`DefinicionV2`/`FormatoTelefonoV2` → sin sufijo.
- Frontend: carpeta `frontend/src/pages/reportes/v2/*` movida a `frontend/src/pages/reportes/`. Páginas `ReportesV2{Home,Builder,Ejecutar,Ejecuciones}.tsx` → `Reportes*.tsx`. API client `api/reportes-v2.ts` → `api/reportes.ts`, types `types/reportes-v2.ts` → `types/reportes.ts`, hook `useReportesV2Socket` → `useReportesSocket`. Rutas `/reportes/v2/*` → `/reportes/*` y navConfig actualizado.
- Prisma: modelos `plantilla_reporte_v2`/`ejecucion_reporte_v2` renombrados a `plantilla_reporte`/`ejecucion_reporte`, relaciones `PlantillaV2Empresa`/`PlantillaV2CreadoPor`/`EjecucionV2Usuario` sin sufijo. `npx prisma db push --accept-data-loss` (tablas v2 sin datos).
- Permisos: `reportes.v2.{ver,crear,editar,eliminar,ejecutar,ver_ejecuciones,gestionar_formatos}` → `reportes.{ver,crear,editar,eliminar,ejecutar,ver_ejecuciones,gestionar_formatos}`. Migrados los roles existentes con `backend/prisma/migrate-permisos-v2.sql` (string-replace sobre el JSON de `rol.permisos`, removiendo además `reportes.v1.*`).

### Compatibilidad

- Sin retrocompatibilidad: clientes con tokens viejos verán denegación 403 hasta que sus roles se relean (lo cual ya hizo el script SQL).
- Storage existente bajo `storage/reportes/v2/*` quedará huérfano — eliminar manualmente si se quiere recuperar disco.

### Mover a un módulo separado (futuro)

- Dashboards/tableros tipo Power BI vivirá en `backend/src/modules/dashboards/` y `frontend/src/pages/dashboards/`, no en `reportes/`.

---

## [2026-05-11] — Fase 4: Sistema de notificaciones + monitoreo live de importaciones

Commits: `a3d1e6c` (main), `2607c61` (fix VALIDANDO eliminable).
Spec completo y changelog detallado: `docs/notificaciones-spec.md`.

### Backend

- **Schema Prisma** — nuevo modelo `Notificacion` (1 fila por destinatario, fan-out), enums `TipoNotificacion` (IMPORTACION_INICIADA/FINALIZADA/ERROR, REPORTE_LISTO/ERROR, CONVENIO_VENCIDO, SISTEMA) y `EntidadTipo`. Agregado `remesa.usuarioCreadorId` (FK `usuario`, `SetNull`).
- **RealtimeModule** (`backend/src/modules/realtime/`) — Socket.IO gateway con namespace `/rt`, auth JWT en handshake, rooms `user:${id}` + `admin:importaciones`. Helpers `emitImportIniciada/Progreso/Finalizada`. `WsJwtGuard` opcional para mensajes entrantes.
- **NotificacionesModule** (`backend/src/modules/notificaciones/`) — CRUD + endpoints REST: `GET /notificaciones`, `GET /notificaciones/contador`, `POST /:id/leer`, `POST /leer-todas`. Fan-out automático con `incluirUsuariosConPermiso`.
- **`GET /import/en-curso`** con filtro por permiso `importacion.ver_progreso_otros` (uno ve solo lo suyo, el otro ve todas).
- **Validación 1-por-usuario** al ejecutar remesa: transacción MySQL con `SELECT FOR UPDATE` sobre la fila del usuario → HTTP 409 `IMPORT_USUARIO_OCUPADO` si ya tiene una activa.
- **ProgressEmitter** (`backend/src/modules/imports/utils/progress-emitter.ts`) — util con throttle 2s / 5% con primer y último forzado. Integrado en los 7 processors.
- **`processImportJob`** envuelto en try/catch — marca remesa `FALLIDA`, emite `import:finalizada`, crea notificación `IMPORTACION_ERROR`, re-lanza.

### Frontend

- **`SocketContext`** + `useSocket()` — cliente Socket.IO con JWT en handshake; connect/disconnect ligado al token.
- **`NotificacionesContext`** + hooks `useNotificaciones`, `useImportacionesEnCurso` — hidratación REST al montar + suscripción a 5 eventos socket; flag `hidratadoRef` para no spammear toasts durante hidratación inicial.
- **`NotificacionesBell` + `Popover`** en AppShell — IconButton con Badge rojo, popover 360px con dos secciones (Importaciones en curso / Historial). Empty state, "Marcar todas".
- **Refactor `ImportProgress.tsx`** — eliminado polling con `setInterval`; consume el hook global. Si la remesa no está en contexto, fetch REST puntual para obtener estado final.
- **`useNotify`** wrapper sobre `notistack` con `success`, `error`, `info`.

### Robustez de imports + UX

- **Defaults de estado en plantilla** — agregados `defaultEstadoSituacionId` y `defaultEstadoGestionId` (FK `parametro`, `SetNull`) en `plantillaimport`. Reemplaza lookup hardcodeado por `grupo='estadoSituacion'/'estadoGestion'` (que no concordaba con cómo los usuarios cargan los códigos: `grupo='situacion'/'gestion'`). Sin fallback: si la plantilla no tiene defaults, falla con error descriptivo.
- **`PlantillaEditor.tsx`** — dos selects nuevos: "Estado situación inicial" y "Estado gestión inicial". Carga via `GET /parametros?empresaId=X&grupo=situacion|gestion`.
- **`PlantillasList.tsx`** — fix: `sessionStorage.setItem('plantillas_empresaId', ...)` antes de `navigate('/plantillas/nueva')` (el editor leía un key que nunca se escribía).
- **`DELETE /import/remesas/:id`** + permiso `importacion.eliminar`. Reglas: solo PENDIENTE, VALIDANDO, FALLIDA, o FINALIZADA con `okFilas === 0`. Cascade borra `jobimport` + `importerror`; **NO** borra `deudor` (datos de negocio).
- **`ImportHistory.tsx`** — botón eliminar (rojo) con permission gate + tooltip dinámico explicando por qué está deshabilitado.
- **Rediseño completo de `ImportDetail.tsx`** — hero card con número de remesa + estado, 4 stat cards (Total/OK/Err/Tasa éxito), donut Recharts con label centrado en SVG (porcentaje grande + total), info card con 8 campos (empresa, plantilla, política, usuario, archivo, duración, fechas).
- **Auto-refresh live en `ImportDetail`** — suscripción a `import:progreso` e `import:finalizada` filtradas por `remesaId`. Status backend enriquecido con includes + `duracionMs` y `tasaExitoPct` calculados.

### Bugs resueltos durante QA E2E

- **Progreso siempre en 100%**: el denominador era `total` (contador acumulado), no `remesa.totalFilas`. Fix con `Math.floor((ok + err) / totalEsperado * 100)`.
- **`rutaAccion` rota**: `/importacion/historial/:id` → en blanco. Fix a `/historial-importaciones/${remesaId}`.
- **Loop infinito de GET en `ImportDetail`**: `useNotify()` devolvía objeto nuevo cada render → `fetchAll` se recreaba → `useEffect` se re-disparaba en bucle. Fix con patrón `notifyRef` (ref actualizado por su propio effect, deps limpias).
- **Permisos cacheados**: nuevos permisos (`importacion.eliminar`) requieren logout/login completo porque se cachean en `localStorage.amsa_usuario`. Documentado.

### Decisiones tomadas

- Eventos discretos (INICIADA/FINALIZADA/ERROR) van a `Notificacion`; **el progreso NO se persiste** — solo se empuja por socket. Cada subscriber tiene su propia fila → marcar leída es siempre local al usuario.
- Sin polling fallback si el socket cae: reconexión automática + re-hidratación REST.
- Una sola importación activa por usuario (varios usuarios sí pueden ejecutar en paralelo).
- Toasts solo en vivo, nunca durante hidratación inicial.

### Pendientes

- N12 (Fase 2): cron de cleanup — borrar notificaciones leídas > 30 días y no leídas > 180 días.
- Validar con producto si los `deudor` deberían eliminarse al borrar remesa o no.
- Retake de remesa atascada en `VALIDANDO` (por ahora solo se elimina).

---

## [2026-05-11] — Fase 3: Autenticación Google + RBAC dinámico

Commit: `f86d120`.

### Backend

- **AuthModule** (`backend/src/auth/`) con verificación de id_token de Google (google-auth-library), JwtStrategy (passport-jwt), `JwtAuthGuard`, `PermisoGuard`, decoradores `@RequierePermiso(...)` y `@UsuarioActual()`.
- **Schema** — nuevos modelos `Usuario` (email único, `googleId`, `rolId`), `Rol` (con `permisos String[]` o tabla pivot según versión final), `permiso_catalogo`. Seed con roles ADMIN y OPERADOR.
- **Módulos `roles/` y `usuarios/`** — CRUD para admin. Solo accesibles con permisos `usuarios.gestionar` / `roles.gestionar`.
- **Catálogo de permisos** (`backend/src/auth/permisos-catalogo.ts`) — fuente de verdad de las keys. `TODAS_LAS_KEYS` derivado automáticamente para ADMIN.
- Todos los controllers existentes anotados con `@RequierePermiso(...)` granular (ej: `deudores.ver`, `importacion.ejecutar`, `reportes.crear`, etc.).

### Frontend

- **`AuthContext`** con `usuario`, `permisos`, helper `tienePermiso(key)`. Persistencia en `localStorage.amsa_usuario` + token. Hidratación al montar.
- **`Login.tsx`** con botón de Google Sign-In oficial; redirige a `/` tras éxito.
- **`PrivateRoute`** revisa token + opcionalmente un permiso (`requierePermiso="..."`).
- **Páginas admin** (`frontend/src/pages/admin/`) — UsuariosList, UsuarioForm, RolesList, RolForm con asignación de permisos en checklist agrupado por categoría.
- **Catálogo de permisos replicado** en `frontend/src/utils/permisosCatalogo.ts` (idéntico al backend).
- **Botones / acciones** condicionados con `tienePermiso(...)` en lugar de mostrar todo.
- `UserMenu` muestra email + rol; logout limpia storage y desconecta socket.

### Decisiones

- Sin password local: solo login con Google (dominio corporativo se valida del lado del usuario por ahora).
- Permisos cacheados en localStorage por performance — cambios de rol requieren re-login.
- ADMIN deriva permisos automáticamente de `TODAS_LAS_KEYS`; otros roles los tienen explícitos en DB.

---

## [2026-05-08] — Fase 0/1/2: Rediseño UI/UX + design system

Commits: `7fde3f4` (Fase 0), `b6134e5` (Fase 1 reportes v2), `d061907` (Fase 2 resto), `bd00036` (split FichaDeudor).

### Fase 0 — Sistema de diseño + AppShell

- **`frontend/src/components/ui/`** — librería de componentes base: `PageHeader`, `SectionCard`, `EmptyState`, `LoadingSkeleton`, `StatusChip`, `DataTableResponsive`, `KpiCard`, `FilterBar`.
- **AppShell responsive** — `AppBar`, `SideNav` colapsable, `UserMenu`. Drawer en mobile, sidenav fijo en desktop. Theme MUI ajustado (paleta, spacing, typography).
- **`navConfig.ts`** — definición declarativa del sidebar con permisos requeridos por entry.

### Fase 1 — Migración reportes v2 al design system

- Todas las páginas de `frontend/src/pages/reportes/v2/` (builder, ejecuciones, listado, detalle) reescritas con los componentes del design system.

### Fase 2 — Migración del resto de páginas

- `ImportHistory`, `ImportDetail`, `PlantillasList`, `PlantillaEditor`, `EmpresasList`, `EmpresaForm`, `ParametrosList`, `PoliticasList`, `ConveniosList`, `DeudoresList`, `FichaDeudor`, `Login` — todas migradas a `PageHeader` + `SectionCard` + `DataTableResponsive`. Tablas con vista card en mobile.

### Refactor FichaDeudor

- Split en sub-componentes: `FichaDeudorHeader`, `FichaEstadosCard`, `FichaContactoCard`, `FichaConvenioCard`, `FichaComentariosTab`, `FichaHistorialTab`. El componente raíz se redujo de ~900 a ~250 líneas.

---

## [2026-05-08] — Reportes v2: constructor dinámico tipo Power BI

Commits: `c0f3890` (spec), `5585d46` (F1+F2 backend), `ce58cbf` (F3+F4 builder frontend), `0524a43` (F5 exportadores), `27d63ca` (F6 async), `67e5d7c` (F7 mejoras).
Spec completo: `docs/reportes-dynamic-spec.md`.

### Backend (`backend/src/modules/reportes/v2/`)

- **Parser + Planner + Executor** — DSL JSON declarativo (campos, filtros, agrupaciones, métricas, orden). El planner traduce a SQL Prisma + raw cuando es necesario.
- **Catálogo de campos** (`campos/`) por fuente (`deudores`, `remesas`, `convenios`), con metadata (tipo, agregable, formato).
- **Agregadores**: sum, count, count_distinct, avg, min, max, percent_of_total.
- **Ejecución async** con BullMQ — el endpoint `POST /reportes-v2/ejecutar` encola un job, devuelve `ejecucionId`. Socket.IO emite `reporte:progreso` y `reporte:finalizado`. Storage local de archivos generados.
- **Exportadores con branding**: xlsx con header coloreado por empresa, footer con logo, agrupaciones colapsables, totales por grupo. PDF en landscape automático según número de columnas. CSV con BOM.
- **Schema** — nuevos modelos `plantilla_reporte_v2`, `ejecucion_reporte_v2` (con estado, progreso, archivo path, error).

### Frontend (`frontend/src/pages/reportes/v2/`)

- **Builder** — three-pane layout: Field Explorer (catálogo navegable a la izquierda), Canvas (drop targets para filas/columnas/filtros/métricas en el centro), Preview en vivo (a la derecha, primeras 20 filas).
- **Filtros con tipo**: rango fechas, multi-select, numérico, texto, booleano. Algunos marcables como "variables" para que se pidan en ejecución.
- **Mejoras F7**: máscaras de teléfono configurables, validaciones de DSL, mejor UX de filtros variables.
- **Ejecuciones**: listado con estado live (socket), botón descargar cuando finaliza, ver detalle con resumen del DSL usado.

---

## [2026-04-13] — Gestión de códigos / asignaciones por empresa

Commit: `1256f26`.

- Página `AjustesParametros` reescrita con dos tabs (Catálogo + Asignación por empresa) — ver entrada de [2026-04-12] para detalle del modelo de datos. Esta entrada documenta la versión final commiteada de la UI de asignaciones.

---

## [2026-04-06] — Módulo de Políticas y Convenios

Commit: `ad76551`.

### Backend (`backend/src/modules/politicas/` + `convenios/`)

- **Schema** — modelos `Politica` (configuración de descuentos, cuotas, vencimientos por empresa), `Convenio` (instancia para un deudor con cuotas, fechas, monto total/cuotas, estado).
- **PoliticasService** — CRUD + activar/desactivar. Asociadas a empresa y opcionalmente a remesa (via `remesa.politicaId`).
- **ConveniosService** — generar convenio para un deudor desde una política, registrar pagos, actualizar estado (VIGENTE/CUMPLIDO/CAIDO).

### Frontend

- **`PoliticasList`** + `PoliticaForm` — wizard de creación con descuentos, cuotas, fecha de vencimiento, condiciones.
- **`ConveniosList`** + ficha de convenio dentro de `FichaDeudor` (nuevo tab "Convenios").
- **Asociación remesa↔política** desde `ImportHistory` (Select en columna Política, persiste con `PUT /import/remesas/:id/politica`).

---

## [2026-04-13] — Módulo de Reportes completo (backend + frontend)

### Backend — `backend/src/modules/reportes/`

Módulo NestJS completo creado desde cero. Estructura:

```
reportes/
  reportes.module.ts
  reportes.service.ts         — CRUD plantillas, getColumnasDisponibles(), estadisticasRemesas()
  reportes.controller.ts      — todos los endpoints, descarga de archivos via @Res()
  ejecutor/
    ejecutor.service.ts       — router fuente + exportador, loguea ejecucion_reporte
    fuentes/
      deudores.fuente.ts      — builder de filtros complejos + mapearFila()
    exportadores/
      excel.exportador.ts     — xlsx con estilos (header azul #1565C0, bold, autowidth, freeze row 1)
      csv.exportador.ts       — UTF-8 BOM para compatibilidad Excel
      pdf.exportador.ts       — pdfmake, filas alternadas, landscape auto para >6 columnas
```

Endpoints disponibles:
- `GET /reportes/plantillas` — lista plantillas
- `POST /reportes/plantillas` — crear plantilla
- `PATCH /reportes/plantillas/:id` — editar
- `DELETE /reportes/plantillas/:id` — soft delete (activo=false)
- `POST /reportes/ejecutar` — ejecuta y retorna archivo (blob)
- `GET /reportes/estadisticas/remesas` — stats (query: empresaId, periodoDesde, periodoHasta)
- `GET /reportes/columnas-disponibles?fuente=deudores` — columnas disponibles por fuente
- `GET /reportes/formatos-telefono` — listar formatos
- `POST /reportes/formatos-telefono` — crear formato

Registrado en `app.module.ts`.

### Prisma — nuevos modelos (aplicados con `db push`)

```prisma
model plantilla_reporte {
  id             Int       @id @default(autoincrement())
  nombre         String
  descripcion    String?
  tipo           String    // 'base' | 'informe' | 'estadistico'
  fuente         String    // 'deudores'
  filtrosFijos   Json
  filtrosVars    Json      // string[] — qué filtros son variables en ejecución
  columnas       Json      // string[] — keys de columnas a incluir
  formatoSalida  String    // 'xlsx' | 'csv' | 'pdf'
  opcionesExcel  Json?
  opcionesPdf    Json?
  formatoTel     String?   // ej: "549{numero}"
  empresaId      Int?      // null = plantilla global
  activo         Boolean   @default(true)
  createdAt      DateTime  @default(now())
  updatedAt      DateTime  @updatedAt
}

model ejecucion_reporte {
  id             Int       @id @default(autoincrement())
  plantillaId    Int
  usuarioId      Int?
  filtrosUsados  Json
  totalFilas     Int?
  createdAt      DateTime  @default(now())
}

model formato_telefono {
  id             Int       @id @default(autoincrement())
  nombre         String    @unique
  descripcion    String?
  patron         String    // ej: "549{numero}"
  activo         Boolean   @default(true)
}
```

Seeds ejecutados:
- `backend/prisma/seed-formatos-tel.ts` — 4 formatos cargados:
  - WhatsApp Internacional AR: `549{numero}`
  - Nacional con 0: `0{numero}`
  - Solo número: `{numero}`
  - Internacional +54: `+549{numero}`

### Frontend — `frontend/src/pages/reportes/`

4 páginas nuevas:

**`ReportesHome.tsx`**
- Cards de plantillas con chips de tipo/formato
- Botones: Ejecutar → `/reportes/:id/ejecutar`, Editar → `/reportes/:id/editar`, Eliminar con confirm Dialog
- FAB "Nueva Plantilla" → `/reportes/nueva`

**`ReportesWizard.tsx`**
- Stepper de 4 pasos (crear y editar según param `:id`)
- Paso 1: nombre, descripción, tipo (base/informe), fuente (deudores), empresa (Autocomplete — null=global)
- Paso 2: filtros con Switch activo/inactivo + toggle Fijo/Variable por filtro. Filtros: empresas multi-select, situación desde/hasta + exclusiones, gestión desde/hasta, monto desde/hasta + exclusión, soloConTel, soloConEmail
- Paso 3: columnas con checkboxes (desde `/reportes/columnas-disponibles?fuente=deudores`)
- Paso 4: formatoSalida (xlsx/csv/pdf), opcionesExcel (headerColor, freezeRow), opcionesPdf (landscape), formatoTel (Autocomplete + crear nuevo inline)

**`ReportesEjecutar.tsx`**
- Carga plantilla por `:id`, muestra resumen
- Si tiene `filtrosVars`: muestra inputs para cada filtro variable
- Botón "Generar y Descargar" → POST `/reportes/ejecutar` → blob → descarga

**`ReportesEstadisticas.tsx`**
- Filtros: empresa (Autocomplete) + período desde/hasta (type="month")
- Botón "Generar" (carga solo al hacer click)
- KPIs: Total Deudores, Monto Total (ARS)
- PieChart (recharts) — distribución por situación
- BarChart (recharts) — distribución por gestión

Rutas agregadas en `AppRoutes.tsx`:
```tsx
<Route path="reportes" element={<ReportesHome />} />
<Route path="reportes/nueva" element={<ReportesWizard />} />
<Route path="reportes/:id/editar" element={<ReportesWizard />} />
<Route path="reportes/:id/ejecutar" element={<ReportesEjecutar />} />
<Route path="reportes/estadisticas" element={<ReportesEstadisticas />} />
```

Sidebar: nueva sección colapsable "Reportes" con "Mis Plantillas" y "Estadísticas".

---

## [2026-04-12] — Normalización de códigos CRM + mejoras de parametros + motivoNoPago

### Análisis y curación de códigos

Se analizaron los archivos en `/varios/` (ue1.xls, cod_situacion.xlsx, cod_gestion.xlsx, motnopago.xlsx).
Se descartaron los 717 códigos legacy (uppercase, abreviados, sin estructura) y se crearon 70 códigos curados:

- **36 GES-** (gestión): grupos CONTACTO, SIN_CONTACTO, DATO_INCORRECTO, PROMESA, PAGO, CONVENIO, NEGATIVA, RECLAMO, DERIVACION, ADMIN
- **19 SIT-** (situación): grupos AL_DIA, MORA_TEMPRANA, MORA_MEDIA, MORA_AVANZADA, JUDICIAL, ESPECIAL
- **15 MNP-** (motivo no pago): grupos ECONOMICO, DISPUTA, EXTERNO, ACTITUDINAL

Script: `backend/prisma/seed-codigos-curados.ts`
- Wipe completo: empresa_parametro → nullifica FKs en deudor → borra parametros
- Inserta 70 parametros
- Crea 1.680 asociaciones empresa_parametro (70 × 24 empresas, todas activas)

### Cambios en schema Prisma

```prisma
model parametro {
  // campos nuevos:
  categoria   String?
  esGlobal    Boolean  @default(true)
  activo      Boolean  @default(true)
  deudoresConEsteMotivoNoPago deudor[]  @relation("DeudorMotivoNoPago")
}

model empresa_parametro {
  // campos nuevos:
  nombreOverride  String?
  activo          Boolean  @default(true)
}

model deudor {
  // campo nuevo:
  motivoNoPagoId  Int?
  motivoNoPago    parametro? @relation("DeudorMotivoNoPago", fields: [motivoNoPagoId], references: [id])
  @@index([motivoNoPagoId])
}
```

### Backend — parametros mejorado

`parametros.service.ts`:
- `findAll()` acepta `activo?: boolean`
- `create()` / `update()` aceptan `categoria`, `esGlobal`, `activo`
- Nuevo `toggleActivo(id)`
- Nuevo `getGrupos()` via `prisma.groupBy`

`parametros.controller.ts`:
- `GET /parametros/grupos` declarado ANTES de `/:id` (crítico para NestJS routing)
- `PATCH /parametros/:id/activo` para toggle
- Query param `activo` pasado al service

`deudores.service.ts`:
- `findOne()` incluye `motivoNoPago: true`
- `update()` maneja `motivoNoPagoClave` → busca parametro por clave → setea `motivoNoPagoId`

`update-deudor.dto.ts`:
```typescript
export class UpdateDeudorDto {
  @IsOptional() estadoSituacionClave?: string;
  @IsOptional() estadoGestionClave?: string;
  @IsOptional() motivoNoPagoClave?: string;
}
```

### Frontend — FichaDeudor

- Tercer Select siempre visible para Motivo No Pago
- Fetch: `?grupo=motivo_no_pago&activo=true`
- Corregido: `?grupo=situacion` (antes era `estadoSituacion`), `?grupo=gestion` (antes `estadoGestion`)
- `handleGuardarEstados` incluye `motivoNoPagoClave`

### Frontend — AjustesParametros (reescritura completa)

Dos tabs:
1. **Catálogo de códigos**: árbol izquierdo (grupo→categoría con conteos), tabla derecha filtrable, Switch por fila, CRUD completo con Select para grupo y categoría dinámica
2. **Asignación por empresa**: Autocomplete con búsqueda para empresa, TextField para filtrar códigos, 3 columnas (una por grupo), checkboxes por código, marcar/desmarcar por categoría y por grupo, save detecta diffs y hace PATCH por parametro

### Limpieza

- Eliminada página duplicada "Asignaciones" del sidebar y rutas
- Eliminado `AjustesAsignaciones` de `AppRoutes.tsx`

---

## Estado actual de la DB

- **24 empresas** cargadas (nombres exactos del Excel legacy ue1.xls)
- **70 parametros** curados (GES-/SIT-/MNP-)
- **1.680 empresa_parametro** (todas las empresas tienen todos los códigos asignados y activos)
- **4 formato_telefono** cargados

## Decisiones de arquitectura tomadas

- **Sin parentesco entre códigos** (situación→gestión): el usuario puede elegir cualquier código asignado a la empresa sin restricción de jerarquía. Decisión definitiva.
- **Plantillas globales por defecto**: `empresaId` nullable en `plantilla_reporte`. Solo se bloquea a una empresa cuando se quiere customización específica.
- **`db push` siempre**: nunca usar `migrate dev` en este proyecto (drift histórico).
- **Formatos de teléfono configurables**: patron con placeholder `{numero}`, guardados en tabla `formato_telefono`.
- **Futuros módulos previstos**: call logs, SMS, WhatsApp, email — la arquitectura de reportes está diseñada para extenderse a estas fuentes.

## Qué falta / pendientes conocidos

- [ ] Probar el módulo de reportes end-to-end (ejecutar, descargar Excel/CSV/PDF)
- [ ] Ajustar columnas disponibles en `deudores.fuente.ts` según campos reales del modelo `deudor`
- [ ] Posible: agregar preview de datos (tabla paginada) en `ReportesEjecutar`
- [ ] Posible: estadísticas por período en `ReportesEstadisticas` (gráfico de línea temporal)
- [ ] Posible: módulo de convenios/planes de pago
- [ ] Posible: módulo de gestión telefónica (llamadas, SMS)
