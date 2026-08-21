# Documentación de uso (wiki interna) — spec

> Estado: **completa**. 36 páginas escritas y auditadas, visor con buscador y el `?` contextual en
> todas las pantallas. Las 17 pantallas del menú están cubiertas.

El sistema creció y no tiene documentación de uso. Hay flujos que no se entienden sin que alguien te
los explique —crear una plantilla de importación, las 10 categorías, el builder de reportes— y eso
convierte a una persona en cuello de botella. El objetivo es que un usuario pueda trabajar sin
preguntar.

Superficie a cubrir: **20 pantallas**, **64 permisos** en 17 secciones, **10 categorías** de
importación.

---

## 1. Las decisiones tomadas

### El contenido vive en el repo, no en la base

Markdown en `docs/ayuda/`, al lado de los specs técnicos. **No** un CMS con editor.

El motivo es uno y es determinante: **la documentación se pudre si no cambia en el mismo commit que
el código**. Con el contenido en la base, nadie la actualiza al tocar un flujo, y a los seis meses
miente — que es peor que no tener nada, porque el usuario confía y se equivoca. En el repo, cambiar
el editor de mapeo y no tocar su página se ve en el diff.

El costo aceptado: solo edita quien tiene acceso al repo.

### Capturas solo donde el texto no alcanza

Unas 15-20 en total, en los flujos que no se explican con palabras: editor de mapeo, builder de
reportes, layout de ancho fijo. Una captura por paso envejece mal y deja decenas de imágenes
mintiendo con cada cambio de UI.

### Se arranca con un piloto, no con el esqueleto de 40 páginas

Escribir una página completa —la más difícil— y calibrar profundidad, tono y formato antes de
escribir el resto. Corregir el formato una vez, no cuarenta.

---

## 2. Arquitectura

```
docs/ayuda/<NN>-<seccion>/<NN>-<slug>.md   →   /ayuda/<seccion>/<slug>
frontend/src/pages/ayuda/
  contenido.ts     glob de Vite + parseo de metadatos + búsqueda
  AyudaPage.tsx    índice, buscador y visor
```

**El markdown se embebe en el bundle en build time** (`import.meta.glob` con `eager`). No hay
endpoint ni fetch: la ayuda funciona aunque el backend esté caído, que es justo cuando alguien la
necesita.

Dependencias nuevas: `react-markdown` y `remark-gfm`. Nada más.

La ruta `/ayuda` **no pide permiso**: cualquiera que entre al sistema puede leerla.

### Metadatos de cada página

Un comentario HTML al principio del archivo:

```markdown
<!--
seccion: Importación de datos
resumen: Cómo se le enseña al sistema a leer el archivo de un cedente.
revisado: 2026-08-20
rutas: /plantillas
-->
# Crear una plantilla de importación
```

`rutas` es la lista de pantallas que esta página documenta y `rutaPrincipal` aquella de la que es
**la respuesta por defecto**. Las dos alimentan la ayuda contextual, que es la pieza que decide si la
wiki se usa o junta polvo — nadie navega a "Documentación", pero sí toca el `?` cuando está trabado.

### Cómo quedó resuelta la ayuda contextual (fase 5)

El problema era que `rutas` no alcanza para decidir qué abrir: **cuatro pantallas tienen cinco o seis
páginas** (`/gestion` 6, `/reportes` 6, `/carga` 6, `/plantillas` 5) y las otras diez tienen una.
Resolverlo por orden de archivo daba mal: el `?` de Gestión abría "Cómo piensa el sistema".

Lo que se hizo:

- **La principal se declara explícita**, con `rutaPrincipal`. No sale de ningún orden implícito, y hay
  una guarda que verifica que cada pantalla tenga exactamente una.
- **El `?` abre un panel lateral**, no navega. El momento en que alguien pide ayuda es, casi siempre,
  con un formulario a medio llenar: salir de la pantalla se lo llevaría puesto.
- **Muestra la principal ya abierta**, con las hermanas de esa pantalla como chips arriba. Un clic
  para el caso común, sin perder las otras cinco.
- **El botón vive en la barra superior**, no en cada página: la pantalla sale de la ruta, así que una
  página nueva queda enganchada sola con solo declarar su `rutaPrincipal`.
- El match es por **prefijo más largo**, así que `/reportes/ejecuciones` prefiere su propia página
  antes que las de `/reportes`, y `/gestion/1234` igual encuentra la ayuda de Gestión.

Dentro del panel, un enlace a otra página de ayuda **cambia el contenido del panel** en vez de
navegar. Salir a `/ayuda` es una acción aparte, explícita, al pie.

### Búsqueda

Por subcadena sobre el corpus completo, en el navegador. Con ~40 páginas (unos 300 KB de texto) no
hace falta un índice invertido: alcanza y se mantiene solo. Un título que coincide se ordena primero.

---

## 3. La plantilla de cada página

Fija, para que todas se lean igual y escribirlas no sea empezar de cero:

1. **Para qué sirve** — dos frases, en lenguaje de negocio.
2. **Antes de empezar** — permisos, datos previos, qué tener a mano.
3. **Paso a paso** — numerado, con lo que se ve en pantalla y lo que pasa después.
4. **Ejemplo completo** — un caso real de punta a punta, con datos.
5. **Qué puede salir mal** — el error tal cual aparece, qué significa, cómo se arregla.
6. **Preguntas frecuentes.**

El punto 5 es el que más consultas ahorra y el que la documentación típica no tiene. Se nutre de
incidentes reales del CHANGELOG: el DNI de AYSA que colapsaba casos, el anti-duplicados que se comía
el 13,3% de la cobranza, las fechas con puntos que devolvían el mes cambiado.

---

## 3.1 La auditoría es parte del proceso, no un extra

Escribir la página **no la termina**. El paso siguiente es un agente revisor que **verifica cada
afirmación contra el código fuente**, con `archivo:línea` como evidencia, y devuelve tres listas:
errores factuales, faltantes y mejoras.

No es una formalidad. En el piloto, las dos primeras páginas —escritas con acceso completo al
código— salieron con errores graves:

| Lo que decía la doc | Lo que dice el código |
|---|---|
| Las *match keys* definen cómo se reconoce un caso | **Nadie las lee.** La identidad está hardcodeada en `empresa + documento + remesa` |
| Enriquecimiento carga datos adicionales | Carga **contactos**; un campo extra ahí se calcula y se descarta |
| Con `toNumber` no hace falta saber la convención del cedente | `145.320` → **145,32**, sin error a la vista |
| El importe original es inmutable | **Sube** cuando el cedente informa más deuda |
| Las importaciones se pueden revertir | Solo las de **acciones masivas** |
| La línea de tiempo muestra comentarios, pagos y llamadas | Muestra **solo** los envíos de AMSA Sender |

Cada una de esas habría mandado a un usuario a hacer algo que no funciona. Documentación que miente
es peor que no tener: el usuario confía y se equivoca.

**Regla:** ninguna página se da por cerrada sin pasar la auditoría y aplicar las correcciones.

## 4. Mapa de contenido

| Sección | Páginas | Prioridad |
|---|---|---|
| Primeros pasos y modelo mental | 3 | alta |
| Importación de datos | 10-12 | **la más alta** |
| Reportes | 6-7 | alta |
| Gestión del deudor | 6 | media |
| Ajustes (empresas, parámetros, políticas, mora) | 5 | media |
| Administración (roles, usuarios, auditoría) | 4 | media |
| Tableros | 2 | baja |
| Telefonía y Email | 4 | baja |

Importación se lleva un cuarto del total, y con razón: las 10 categorías, el editor de mapeo, los 14
transforms, ancho fijo, multiarchivo, multirregistro, filtros de fila.

---

## 5. Fases

| | Qué | Estado |
|---|---|---|
| **0** | Visor + buscador + 1 página piloto + auditoría | **HECHA** |
| 1 | Importación completa (10 páginas) | **escrita**, en auditoría |
| 2 | Reportes (6 páginas) | **HECHA** — auditada y corregida |
| 3 | Primeros pasos + gestión del caso (6 páginas) | **HECHA** — auditada y corregida |
| 4 | Ajustes + administración (8 páginas) | **HECHA** — auditada y corregida |
| 5 | Ayuda contextual (el `?` en cada pantalla) | **HECHA** — panel lateral con la principal abierta |
| 6 | Tableros + telefonía y email (6 páginas) | **HECHA** — auditada y corregida |

Escritas hasta ahora (36):

| Página | Estado |
|---|---|
| `01-primeros-pasos/01-primer-dia` | auditada y corregida |
| `01-primeros-pasos/02-como-piensa-el-sistema` | auditada y corregida |
| `02-gestion/00-buscar-un-caso` | auditada y corregida |
| `02-gestion/01-la-ficha` | auditada y corregida |
| `02-gestion/02-comentarios-y-estados` | auditada y corregida |
| `02-gestion/03-pagos-y-promesas` | auditada y corregida |
| `02-gestion/04-convenios` | auditada y corregida |
| `03-importacion/01-como-funciona` | auditada y corregida |
| `03-importacion/02-categorias` | auditada y corregida |
| `03-importacion/03-formatos-de-archivo` | auditada y corregida |
| `03-importacion/04-crear-plantilla` | auditada y corregida (**el piloto**) |
| `03-importacion/05-importar-un-archivo` | auditada y corregida |
| `03-importacion/06-actualizaciones` | auditada y corregida |
| `03-importacion/07-acciones-masivas` | auditada y corregida |
| `03-importacion/08-historial-y-problemas` | auditada y corregida |
| `03-importacion/09-multirregistro-y-multiarchivo` | auditada y corregida |
| `04-reportes/01-como-funciona` | auditada y corregida |
| `04-reportes/02-armar-un-reporte` | auditada y corregida |
| `04-reportes/03-filtros` | auditada y corregida |
| `04-reportes/04-formatos` | auditada y corregida |
| `04-reportes/05-ejecutar-y-descargar` | auditada y corregida |
| `04-reportes/06-recetas` | auditada y corregida |
| `05-ajustes/01-empresas` | auditada y corregida |
| `05-ajustes/02-parametros` | auditada y corregida |
| `05-ajustes/03-politicas` | auditada y corregida |
| `05-ajustes/04-recargo-por-mora` | auditada y corregida |
| `05-ajustes/05-cartera-nueva-de-cero` | auditada y corregida |
| `06-administracion/01-roles-y-permisos` | auditada y corregida |
| `06-administracion/02-usuarios` | auditada y corregida |
| `06-administracion/03-auditoria` | auditada y corregida |
| `07-tableros/01-como-leer-el-tablero` | auditada y corregida |
| `07-tableros/02-filtros-y-exportar` | auditada y corregida |
| `08-telefonia-y-email/01-telefonia-como-funciona` | auditada y corregida |
| `08-telefonia-y-email/02-atender-una-llamada` | auditada y corregida |
| `08-telefonia-y-email/03-enviar-un-email` | auditada y corregida |
| `08-telefonia-y-email/04-linea-de-tiempo` | auditada y corregida |

Las tres de mayor riesgo son `06-actualizaciones`, `07-acciones-masivas` y `08-historial-y-problemas`:
documentan operaciones que pueden cancelar una cartera, borrar contactos de toda una empresa o perder
datos sin vuelta atrás. Un error ahí no confunde: hace daño.

---

## 6. Cómo evitar que se pudra

Además de vivir en el repo, tres guardas automáticas del mismo tipo que el test de sincronía del
catálogo de permisos (que se agregó justamente porque esa clase de desincronización ya mordió):

`npm run verificar-ayuda` (en `frontend/`, o `node frontend/scripts/verificar-ayuda.mjs`) valida:

- **Metadatos completos** y título en cada página.
- **Los enlaces internos resuelven** a un slug que existe.
- **Exactamente una principal por pantalla**, y que la principal declare también esa ruta.
- **Cada entrada de `navConfig` tiene ayuda**, salvo las que estén en la lista explícita de
  pendientes — hoy solo `/ayuda`, que es la wiki misma.
- Imprime **qué abre el `?` en cada pantalla**, que es la forma más rápida de ver si una principal
  quedó mal elegida.

Falta todavía la guarda de que las 10 categorías de importación estén documentadas.

Y cada página lleva su fecha de última revisión, visible al pie del visor.

## 7. Hallazgos sobre el producto que salieron de las auditorías

Auditar la documentación contra el código destapó cosas que no son de la doc. Se dejan anotadas acá
porque no tienen otro dueño:

| Hallazgo | Dónde |
|---|---|
| ~~**El default de Actualizaciones (`PAGO_TODO`) no tiene el guard que sí tiene `DESASIGNAR`**: un archivo apuntado a la cartera equivocada la cancela entera~~ **ARREGLADO 2026-08-21**: la rama PAGO_TODO aborta igual que DESASIGNAR si ninguna fila matchea | `actualizaciones.processor.ts` |
| ~~Las variables `REPORTES_V2_*` de `.env.example` **no las lee nadie**: el código usa los mismos nombres sin el `V2_`. Tocar el `.env` hoy no cambia nada~~ **ARREGLADO 2026-08-21**: renombradas en `.env.example` y en el `.env` real, que también las tenía mal | `.env.example` vs `ejecuciones.service.ts` |
| ~~**Filtrar por un dato adicional revienta la ejecución** (`PrismaClientValidationError`): el selector lo ofrece pero el planner no arma JSON~~ **ARREGLADO 2026-08-21**: el planner arma el filtro JSON de Prisma (`{ path, equals }`); 7 operadores verificados contra la base | `query-planner.ts` |
| ~~**Los rangos de fecha pierden el último día** por zona horaria~~ **ARREGLADO 2026-08-21**: helpers de día local compartidos en `common/utils/dia-local.ts` | `query-planner.ts` (`coerceValor`) |
| ~~El switch de **salto de página por grupo en PDF** se guarda y no lo consume nadie~~ **ARREGLADO 2026-08-21**: el PDF parte las filas en una tabla por corte; verificado contando páginas | `pdf.exportador.ts` |
| ~~**No hay UI de ordenamiento** en el builder, aunque el motor lo soporta~~ **ARREGLADO 2026-08-21**: nuevo `SortBuilder`, con varios criterios reordenables | `ReportesBuilder.tsx` |
| ~~El test `query-planner.spec.ts:232` **está fallando** desde que se introdujo `obligatorio`~~ **ARREGLADO 2026-08-21**: describía el contrato anterior a `obligatorio`; se cubrieron las dos ramas | |
| ~~El permiso `deudores.exportar` **está declarado y no lo usa nadie**: no hay endpoint ni botón de exportar en Gestión~~ **ARREGLADO 2026-08-21**: se retiró; para exportar cartera está reportes | `permisos-catalogo.ts` |
| ~~Buscar por teléfono compara contra el E.164 guardado **sin normalizar lo que se tipea**: `11 5555-1234` no encuentra nada~~ **ARREGLADO 2026-08-21**: se prueban lo tipeado, solo los dígitos y el E.164 normalizado | `deudores.service.ts` |
| ~~La búsqueda avanzada corta en **50 resultados sin avisar** y sin paginación~~ **ARREGLADO 2026-08-21**: devuelve el total y la pantalla avisa cuántos hay | `deudores.service.ts` |
| ~~**Se puede cancelar un caso a mano** eligiendo SIT-050 en el desplegable, sin permiso especial — y no se puede volver atrás desde la ficha~~ **ARREGLADO 2026-08-21**: pide confirmación explicando que la cuenta queda de solo lectura | `FichaEstadosCard.tsx` |
| ~~**Registrar el pago de una cuota de convenio no dispara la consolidación**: el saldo del caso no baja~~ **ARREGLADO 2026-08-21**: consolida igual que un pago suelto | `convenios.service.ts` |
| ~~El estado **VENCIDA de cuota no lo escribe nadie**: `updateEstadosCuotas()` no tiene caller~~ **ARREGLADO 2026-08-21**: cron diario a las 3 AM | `convenios.service.ts` |
| ~~El importe del pago de cuota **es editable y marca la cuota como pagada igual**, sin validar~~ **ARREGLADO 2026-08-21**: se admite de más pero no de menos | `convenios.service.ts` |
| ~~Los pagos de cuota quedan con `origen = NULL`, así que **no se pueden borrar** ni se etiquetan bien~~ **ARREGLADO 2026-08-21**: quedan como `CONVENIO` | `convenios.service.ts` |
| ~~**No hay UI para borrar comentarios**, aunque el endpoint y el permiso existan~~ **ARREGLADO 2026-08-21**: botón en los propios | `ComentariosPanel.tsx` |
| ~~Un comentario con `usuarioId = null` **lo puede borrar cualquiera** con el permiso~~ **ARREGLADO 2026-08-21**: sin autor no es propio: se rechaza | `comentarios.service.ts:42` |
| ~~Los comentarios de acciones masivas guardan `origen` pero **no se renderiza**~~ **ARREGLADO 2026-08-21**: salen como "Sistema" con su chip | `ComentariosPanel.tsx` |
| ~~El permiso `deudores.editar_estado` **no se consulta en el frontend**: el rechazo llega al guardar~~ **ARREGLADO 2026-08-21**: los selectores van deshabilitados sin el permiso | `FichaEstadosCard.tsx` |
| ~~**No se puede quitar un motivo de no pago**: al guardar se conserva el anterior~~ **ARREGLADO 2026-08-21**: `''` o `null` lo borran; una clave inexistente ahora es error | `deudores.service.ts:238` |
| ~~Los cambios de estado **automáticos no se auditan por caso**, así que Auditoría no los explica~~ **ARREGLADO 2026-08-21**: un registro por caso para las cancelaciones, y la corrida de promesas ahora audita | `consolidacion.service.ts`, `promesas.service.ts` |
| ~~Solo **SIT-050** bloquea la ficha; SIT-051/052/053 no~~ **ARREGLADO 2026-08-21**: bloquea toda la categoría CANCELADO | `deudor-bloqueo.ts` |
| ~~`accion_masiva_snapshot` no tiene FK a `remesa`: borrar una remesa de acciones deja filas huérfanas~~ **ARREGLADO 2026-08-21**: FK con Cascade | `schema.prisma` |

### Los de la fase 4 (ajustes + administración)

Ordenados por gravedad. Los cuatro primeros son de seguridad o de pérdida de datos.

| Hallazgo | Dónde |
|---|---|
| ~~🔴 **Desactivar un usuario no corta su sesión abierta.**~~ **ARREGLADO 2026-08-21**: `UsuarioActivoService` con caché de TTL corto, consultado por el guard e invalidado por el ABM. Verificado de punta a punta contra la app corriendo | `usuario-activo.service.ts`, `jwt-auth.guard.ts` |
| ~~🔴 **Borrar un usuario destruye trazabilidad en silencio.**~~ **ARREGLADO 2026-08-21**: se cuenta la actividad en 8 tablas y se rechaza con un mensaje que dice qué tiene y manda a desactivar | `usuarios.service.ts` |
| ~~🔴 **La clave de Neotel queda en claro en la auditoría.**~~ **ARREGLADO 2026-08-21**: se agregó `claveNeotel` a los campos sensibles, y `sipPassword` al sanitizador de logs, que hace match exacto y tampoco la cubría. **Falta revisar si en prod ya quedaron filas con la clave en claro** — el alcance es chico: con la Toolbar esas credenciales ya no se usan (ver la fila de abajo) | `audit.enums.ts`, `sanitize.ts` |
| **Todo el bloque de telefonía del ABM de usuarios es vestigial.** `claveNeotel` y `sipPassword` quedaron del plan del softphone propio, que se descartó al pasar a la Toolbar de Neotel: hoy el operador entra por Neotel y no necesita nada configurado acá. Las credenciales las consumen `agente-telefonia.service` y `sesion-agente.service`, que solo se alcanzan desde `NeotelTestPage` —el panel de prueba, que además nadie puede abrir—. Decidir si se saca el bloque del formulario, o si se deja para el panel | `UsuariosPage.tsx`, `neotel-toolbar-spec.md` §6 |
| ~~🔴 **Una cartera nueva no puede cargar su primera tasa de mora.**~~ **ARREGLADO 2026-08-21**: la pantalla consulta el estado de la cadena y ofrece iniciarla con confirmación explícita | `AjustesMora.tsx`, `mora.service.ts` |
| ~~🔴 **Recargar un mes viejo recomputa la cadena migrada sin confirmación.**~~ **ARREGLADO 2026-08-21**: el conteo de posteriores lo da el backend y pisar índice migrado exige `permitirPisarMigrado` | `AjustesMora.tsx`, `mora.service.ts` |
| ~~**Fuga en el gráfico de 30 días de Auditoría**: el `$queryRaw` ignora el `where`, así que quien solo tiene `auditoria.ver` ve el volumen global~~ **ARREGLADO 2026-08-21**: va por Prisma con el mismo `where` | `transacciones.service.ts:131` |
| ~~**La corrida nocturna de promesas vencidas no audita nada**: el `@Audit` está en el controller y el cron llama al servicio directo~~ **ARREGLADO 2026-08-21**: registra resumen y deudorIds | `promesas.scheduler.ts:16` |
| ~~**Consultar y exportar la auditoría no se audita** (cero `@Audit` en el controller), y **el logout tampoco**: el endpoint existe y el frontend no lo llama~~ **ARREGLADO 2026-08-21**: el export audita y el logout llama al endpoint | `transacciones.controller.ts`, `AuthContext.tsx:55` |
| ~~**El catálogo de permisos está triplicado y desincronizado: 63 / 59 / 48.** Backend 63, frontend 59 (falta *Telefonía* entera), y el seed una tercera copia inline con 48 — el rol ADMIN recién sembrado no tiene `mora.*`, `auditoria.*`, `dashboards.*` ni `email.*`. El endpoint `GET /roles/permisos-catalogo` existe y no lo consume nadie~~ **ARREGLADO 2026-08-21**: el seed importa el catálogo; telefonía al frontend; sin excepciones en el test | `permisos-catalogo.ts` vs `permisosCatalogo.ts` vs `seed.ts:4` |
| ~~Ítem de menú inalcanzable: **Neotel (test)** pide `telefonia.usar`, que la pantalla de Roles no sabe otorgar~~ **ARREGLADO 2026-08-21**: pide `telefonia.admin`, que ya se puede otorgar | `navConfig.ts:65` |
| ~~**El email de un usuario no es editable** después del alta, y el único remedio (borrar y recrear) puede estar bloqueado o ser destructivo~~ **ARREGLADO 2026-08-21**: editable, con la unicidad de la base | `update-usuario.dto.ts` |
| ~~**El DNI es de solo escritura**: `USUARIO_SELECT` no lo devuelve y el update ignora el valor vacío. Se puede cargar y pisar, nunca ver ni limpiar~~ **ARREGLADO 2026-08-21**: vuelve en `USUARIO_SELECT` y se puede borrar | `usuarios.service.ts:25,168` |
| ~~**Filtros de fecha de Auditoría en UTC** contra datos en hora local: corrimiento sistemático de 3 h en *Desde* y *Hasta*~~ **ARREGLADO 2026-08-21**: días completos en hora local | `transacciones.service.ts:63` |
| ~~Tres módulos (`TELEFONIA`, `EMAIL`, `DASHBOARDS`) **se registran pero no están en el desplegable** de Búsqueda~~ **ARREGLADO 2026-08-21**: los nueve del enum en el desplegable | `AuditoriaBusqueda.tsx:30` |
| ~~`buscar()` **no tiene `catch`**: un 403 o un 500 dejan la pantalla en blanco, indistinguible de "sin resultados"~~ **ARREGLADO 2026-08-21**: notifica el error | `AuditoriaBusqueda.tsx:87` |
| ~~**Exportar usa los filtros del formulario, no los de la última búsqueda**~~ **ARREGLADO 2026-08-21**: usa los de la última búsqueda | `AuditoriaBusqueda.tsx:75` |
| ~~El botón de eliminar rol **se deshabilita sin explicación**; el mensaje bueno del backend es inalcanzable~~ **ARREGLADO 2026-08-21**: tooltip con el motivo y la cantidad | `RolesPage.tsx:193` |
| ~~**`recalcularCartera` usa la fecha en UTC**~~ **ARREGLADO 2026-08-21**: nuevo helper `hoyUtc()` que toma el día del calendario local | `mora.service.ts` |
| ~~**No hay ningún proceso que recalcule la mora.** Con el umbral de 48 h, el indicador naranja de la ficha queda encendido de forma permanente~~ **ARREGLADO 2026-08-21**: cron diario a las 4 AM por empresa con índice | sin cron; `FichaHeader.tsx:41` |
| ~~La tasa **se guarda aunque la generación del índice falle**~~ **ARREGLADO 2026-08-21**: las validaciones de cadena corren antes del upsert | `mora.service.ts` |
| ~~**`mesesFaltantes` no detecta huecos anteriores** al mes más viejo cargado — justo las facturas que van a salir sin índice~~ **ARREGLADO 2026-08-21**: barre desde el vencimiento más viejo de la cartera | `mora.service.ts:532` |
| ~~Los multiplicadores ×1,5 y ×2 están **hardcodeados en la tabla de la UI**, mientras el backend los lee de la configuración de la empresa~~ **ARREGLADO 2026-08-21**: viajan con las tasas desde la configuración | `AjustesMora.tsx:270` |
| ~~El `Alert` de meses faltantes **dice algo que no es cierto** ("cuya deuda cruce esos meses se valúa mal"): lo que importa es el índice del vencimiento y el del corte~~ **ARREGLADO 2026-08-21**: dice lo que realmente pasa: la factura que vence ahí queda sin recargo | `AjustesMora.tsx:236` |
| ~~**15 códigos de parámetro son imposibles de asignar desde la UI**: la lista de categorías está hardcodeada y no incluye LEGAL, INCOBRABLE ni tres de motivo de no pago~~ **ARREGLADO 2026-08-21**: las categorías se calculan de los códigos cargados | `AjustesParametros.tsx:83` |
| ~~**El checkbox "Global (todas las empresas)" no hace nada**: se persiste y no lo lee ningún filtro~~ **ARREGLADO 2026-08-21**: se retiró del formulario | `AjustesParametros.tsx:792` vs `parametros.service.ts:14` |
| ~~**Lost update en la asignación de parámetros**: read-modify-write del listado completo + `deleteMany`/`createMany`. Dos admins configurando empresas distintas se pisan~~ **ARREGLADO 2026-08-21**: endpoint por par (parámetro, empresa) | `AjustesParametros.tsx:303`, `parametros.service.ts:72` |
| ~~`empresa_parametro.nombreOverride` y `.activo` son **columnas muertas**, y además se destruyen en cada guardado~~ **ARREGLADO 2026-08-21**: las asignaciones se guardan por diferencia y ya no se destruyen | `parametros.service.ts:72` |
| ~~**Asociar una política a una remesa no valida nada** (ni empresa, ni activa, ni existencia) y solo pide `importacion.ver_historial`~~ **ARREGLADO 2026-08-21**: valida empresa, existencia y que esté activa | `imports.service.ts:1697` |
| ~~**Borrar una empresa no tiene manejo de errores**: con FK RESTRICT sale un 500 opaco, y si pasa se lleva en cascada tasas, índices y el historial de emails~~ **ARREGLADO 2026-08-21**: cuenta lo que bloquea y lo que se iría en cascada, y explica cuál es | `empresas.service.ts:40` |
| ~~Las páginas de Ajustes **no ocultan acciones por permiso**: el 403 llega recién al confirmar~~ **ARREGLADO 2026-08-21**: Parámetros y Políticas ocultan por permiso | `AjustesParametros.tsx`, `AjustesPoliticas.tsx` |
| ~~`GET /api/politicas` sin `empresaId` **responde 400** por un `ParseIntPipe` sin `optional`~~ **ARREGLADO 2026-08-21**: `ParseIntPipe` opcional: se pueden listar todas | `politicas.controller.ts:15` |
| ~~`DeudoresPage.tsx:20` tiene **el usuario hardcodeado** (`{ nombre: 'Maxi', rol: 'admin' }`) y de él dependen las solapas de la ficha. Conectarlo al contexto real las haría desaparecer para todos~~ **ARREGLADO 2026-08-21**: se sacó el mock y el gate por rol, que nunca funcionó: quien llega a la pantalla ya tiene `deudores.ver` | `DeudoresPage.tsx:20` |
| ~~El aviso "sin política" del gestor **manda a un lugar equivocado**: dice *Ajustes → Políticas*, donde no se puede asociar~~ **ARREGLADO 2026-08-21**: manda al historial de importaciones | `PoliticaTab.tsx:53` |
| ~~Tipos de auditoría fuera del enum (`'VALIDAR'`, `'ANULAR'`) escritos como strings sueltos~~ **ARREGLADO 2026-08-21**: `VALIDAR` y `ANULAR` al enum | `imports.controller.ts:220` |

### Los de la fase 6 (tableros, telefonía y email)

| Hallazgo | Dónde |
|---|---|
| ~~🔴 **`dashboards.ver_todas_empresas` no restringe nada.**~~ **RESUELTO 2026-08-21**: se decidió que no va a haber usuarios externos, así que se sacó el permiso y el recorte muerto en vez de implementar un modelo que nadie iba a usar. Script `limpiar-permisos-obsoletos.ts` para los roles que lo tenían guardado — sin eso, `validarPermisos` no los deja volver a guardar | `permisos-catalogo.ts`, `dashboards.controller.ts` |
| ~~🔴 **El export de tableros no exige `dashboards.ver`.**~~ **ARREGLADO 2026-08-21**: el guard es OR por diseño, así que la conjunción se pide a mano en el handler, igual que en transacciones | `dashboards.controller.ts` |
| ~~🔴 **Editar el asunto de un email no hace nada.**~~ **ARREGLADO 2026-08-21** (Sender): el asunto del dto gana sobre el del template, renderizado igual | `manual-email.service.ts` |
| ~~🔴 **La lupa de vista previa puede hacerte mandar otra plantilla.**~~ **ARREGLADO 2026-08-21**: la lupa usa su propio estado y ofrece un botón "Usar esta plantilla" | `EnviarEmailDialog.tsx` |
| ~~**`{{saldo}}` no es el saldo y `{{deuda}}` no es la deuda actualizada**~~ **ARREGLADO 2026-08-21**: `{{saldo}}` resuelve al saldo consolidado y se agregó `{{deuda_actualizada}}`. Cubierto por `variables-mapper.spec.ts` | `variables-mapper.ts` |
| ~~**El envío manual no respeta la lista de desuscriptos.**~~ **ARREGLADO 2026-08-21** (Sender): se omiten y quedan con estado `Desuscripto`, y la pantalla lo avisa | `manual-email.service.ts` |
| ~~**En Timeline, todo lo malo se ve gris.**~~ **ARREGLADO 2026-08-21**: la lista estaba escrita contra los estados de WhatsApp; se agregaron `fallo`, `rebote` y `queja` en rojo, y `omitido`/`desuscripto` en naranja | `TimelineDeudorTab.tsx` |
| ~~**El envío y la lectura del Timeline resuelven el documento distinto**~~ **ARREGLADO 2026-08-21** (Sender): las dos consultas usan `orderBy id desc` | `internal-email.controller.ts` |
| ~~**La previsualización y el render real usan reglas distintas**: el front reemplaza por coincidencia exacta, Sender con `/{{\s*(\w+)\s*}}/`. Una plantilla con `{{monto-total}}` se ve bien en pantalla y sale con el `{{}}` literal en el mail~~ **ARREGLADO 2026-08-21**: la previsualización usa la misma regla que Sender | `EnviarEmailDialog.tsx:319` vs `renderTemplate.ts:4` |
| ~~**"Deuda total" y "% Recupero" suman `montoTotal`**~~ **ARREGLADO 2026-08-21**: ahora son **Deuda asignada** y **Saldo pendiente** (con `COALESCE(saldo, montoTotal)`), y el recupero pasó a ser **acumulado** —todo lo cobrado sobre lo asignado— en vez de un numerador de un mes sobre un denominador de toda la vida | `dashboards.service.ts` |
| ~~**"Casos sin gestión" es estructuralmente 0**~~ **ARREGLADO 2026-08-21**: cuenta casos **sin un solo comentario**, que es lo que el nombre promete. En la base local pasó de 0 a 21.332 de 21.335 | `dashboards.service.ts` |
| ~~**El funnel no es un embudo.**~~ **ARREGLADO 2026-08-21**: los escalones se definen por evidencia (`promesa_pago` y `pago` son históricas) y quedan **anidados por construcción**, así que siempre decrecen. El último pasó a ser *promesa cumplida* — de los que prometieron, cuántos pagaron —, que es lo único que lo deja estrictamente decreciente | `dashboards.service.ts` |
| ~~**La opción "Todas" del selector de empresa deja el tablero en blanco**~~ **ARREGLADO 2026-08-21**: se sacó la opción y *Limpiar* ya no suelta la empresa | `DashboardFiltros.tsx` |
| ~~**"Mora promedio" mezcla relojes**: excluye por pagos del período dentro de una métrica que por lo demás es foto de hoy~~ **ARREGLADO 2026-08-21**: el corte es el saldo, no los pagos del período | `dashboards.service.ts:364-376` |
| ~~**La serie de pagos no dibuja la cantidad**~~ **ARREGLADO 2026-08-21**: `ComposedChart` con la cantidad en línea y su propio eje a la derecha | `SeriePagos.tsx` |
| ~~**El PDF del tablero no incluye las series temporales** — justo el formato "para mandar al cedente" no lleva la evolución de la cobranza~~ **ARREGLADO 2026-08-21**: las incluye en tablas | `dashboards-export.service.ts:262-349` |
| ~~**El tope de 366 días no se valida en el front**~~ **ARREGLADO 2026-08-21**: los campos de fecha se marcan en rojo con "Máximo 366 días" | `DashboardFiltros.tsx` |
| ~~**Los combos de situación/gestión/motivo del tablero no filtran por empresa**~~ **ARREGLADO 2026-08-21**: se piden con `empresaId` y cambiar de empresa limpia los códigos elegidos | `DashboardFiltros.tsx` |
| ~~`casosConPago` trae **todos los `deudorId` distintos a memoria**~~ **ARREGLADO 2026-08-21**: `groupBy` | `dashboards.service.ts` |
| ~~Dos widgets dependen de `deudor.fechaVencimiento`, que casi ninguna cartera trae (3 de 21.338 en local): la barra de mora queda 100% en "Sin fecha"~~ **ARREGLADO 2026-08-21**: empty state explícito cuando la cartera no trae el dato | `dashboards.service.ts:378-395` |
| ~~**No hay forma de marcar un mail como inválido.** `contacto.validado` existe y solo lo escribe la UI de teléfonos: una dirección que rebota solo se puede borrar~~ **ARREGLADO 2026-08-21**: botón de rebote en el chip | `FichaContactosPanel.tsx:210-241` |
| ~~**Pasar de 10 adjuntos descarta los sobrantes en silencio** (`.slice(0, MAX_FILES)`); solo el exceso de tamaño avisa. Y no hay tope de tamaño **total**~~ **ARREGLADO 2026-08-21**: avisa cuántos se descartaron y hay tope total | `EnviarEmailDialog.tsx:232-237` |
| ~~`GET /email/deudores/:id/envios` y `/envios/:id/estado` **no los consume nadie**: la tabla `envio_email` —la única que sabe qué valores se mandaron— es invisible en la UI desde que Timeline reemplazó al tab "Emails enviados"~~ **ARREGLADO 2026-08-21**: panel en Timeline con los valores que se mandaron | `email-sender.controller.ts:112-122` |
| ~~**Elegir un caso a mano en telefonía lo marcaba como dudoso**~~ **ARREGLADO 2026-08-21**: la home navegaba con `?id=`, alias de la CLAVE de Neotel, así que al caso que el operador acababa de elegir le salía el cartel de "confirmá que es el correcto". Entrenaba a ignorar el único cartel que no se puede ignorar | `TelefoniaHome.tsx` |
| ~~**"Buscar otro caso" dejaba estado sucio**~~ **ARREGLADO 2026-08-21**: sobre la ficha nueva quedaban el nombre de la persona anterior y el cartel amarillo | `TelefoniaCaso.tsx` |
| ~~**El "?" dentro de la Toolbar era un viaje de ida**~~ **ARREGLADO 2026-08-21**: navegaba a `/ayuda`, que vive bajo el shell completo, dejando al operador con sidebar y todo adentro del iframe | `AyudaContextual.tsx`, `EmbeddedShell.tsx` |
| ~~**Un separador mal configurado degrada hacia el camino peligroso**: si DATA llegó con contenido pero ningún valor es entero, se cae igual a la CLAVE de Neotel y puede abrir la ficha de un tercero. Debería ser "no se encontró"~~ **ARREGLADO 2026-08-21**: si DATA vino y no se pudo leer, no se cae a la CLAVE | `resolver-caso.ts:74-97` |
| ~~**`MAX_CANDIDATOS = 4` trunca en silencio**: si el id es el quinto valor numérico de DATA no se encuentra nunca, y el error lista cuatro números que no venían al caso~~ **ARREGLADO 2026-08-21**: informa cuántos quedaron sin probar y sugiere `&pos=` | `resolver-caso.ts:21,100` |
| ~~**`/admin/neotel-test` no tiene guard de ruta y sus endpoints piden solo `telefonia.usar`.** El panel desloguea al agente de Neotel, lo pone en pausa y lo cambia de campaña: el día que se otorgue ese permiso para el softphone, cualquier agente puede pisar su estado por fuera de la Toolbar~~ **ARREGLADO 2026-08-21**: los endpoints piden `telefonia.admin`, que ya se puede otorgar desde Roles | `AppRoutes.tsx:67`, `neotel-sesion.controller.ts` |
| La integración con la Toolbar es **de una sola vía** —el sistema no se entera de que la llamada terminó— y sigue **sin probarse con una campaña real** | `neotel-toolbar-spec.md:3,185` |
| ~~**`DeudoresPage.tsx:20` tiene el usuario hardcodeado** (`{ nombre: 'Maxi', rol: 'admin' }`), lo que anula el gate por rol de las solapas Política y Timeline: hoy las ve todo el mundo. Ya estaba anotado en la fase 4 y sigue~~ **ARREGLADO 2026-08-21**: se sacó el mock y el gate por rol, que nunca funcionó: quien llega a la pantalla ya tiene `deudores.ver` | `DeudoresPage.tsx:20` |



