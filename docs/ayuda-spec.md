# Documentación de uso (wiki interna) — spec

> Estado: **piloto**. El visor funciona y hay 2 páginas escritas de ~40 planificadas. Falta calibrar
> el formato con el usuario antes de escribir el resto.

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

`rutas` es la lista de pantallas que esta página documenta. **Es lo que va a alimentar la ayuda
contextual**: el botón `?` de una pantalla abre la página que la declara. Esa pieza es la que decide
si la wiki se usa o junta polvo — nadie navega a "Documentación", pero sí toca el `?` cuando está
trabado.

> ### Pendiente antes de cablear la ayuda contextual (fase 5)
>
> Hoy `rutas` **no lo consume nadie**: `paginaParaRuta()` está exportada y nunca se llama.
>
> Y tal como está cargado, no serviría: **`/gestion` lo declaran seis páginas**, y la función devuelve
> la primera del orden de secciones — así que el `?` de Gestión abriría "Cómo piensa el sistema" en vez
> de "Buscar un caso".
>
> Antes de cablearlo hay que decidir **una página principal por ruta**. Dos opciones: un campo aparte
> (`rutaPrincipal`) para la página que responde al `?`, dejando `rutas` como lista de relacionadas; o
> que el `?` abra un **menú** con todas las páginas de esa pantalla, con la principal arriba. La segunda
> es más útil y no obliga a elegir.

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
| 4 | Ajustes + administración | |
| 5 | Ayuda contextual (el `?` en cada pantalla) | necesita las páginas escritas |

Escritas hasta ahora (22):

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

Las tres de mayor riesgo son `06-actualizaciones`, `07-acciones-masivas` y `08-historial-y-problemas`:
documentan operaciones que pueden cancelar una cartera, borrar contactos de toda una empresa o perder
datos sin vuelta atrás. Un error ahí no confunde: hace daño.

---

## 6. Cómo evitar que se pudra

Además de vivir en el repo, tres guardas automáticas del mismo tipo que el test de sincronía del
catálogo de permisos (que se agregó justamente porque esa clase de desincronización ya mordió):

- Cada entrada de `navConfig` tiene que tener página de ayuda asociada.
- Cada una de las 10 categorías de importación tiene que estar documentada.
- Los links internos y las anclas tienen que resolver.

Y cada página lleva su fecha de última revisión, visible al pie del visor.

## 7. Hallazgos sobre el producto que salieron de las auditorías

Auditar la documentación contra el código destapó cosas que no son de la doc. Se dejan anotadas acá
porque no tienen otro dueño:

| Hallazgo | Dónde |
|---|---|
| **El default de Actualizaciones (`PAGO_TODO`) no tiene el guard que sí tiene `DESASIGNAR`**: un archivo apuntado a la cartera equivocada la cancela entera | `actualizaciones.processor.ts` |
| Las variables `REPORTES_V2_*` de `.env.example` **no las lee nadie**: el código usa los mismos nombres sin el `V2_`. Tocar el `.env` hoy no cambia nada | `.env.example` vs `ejecuciones.service.ts` |
| **Filtrar por un dato adicional revienta la ejecución** (`PrismaClientValidationError`): el selector lo ofrece pero el planner no arma JSON | `query-planner.ts` |
| **Los rangos de fecha pierden el último día** por zona horaria | `query-planner.ts` (`coerceValor`) |
| El switch de **salto de página por grupo en PDF** se guarda y no lo consume nadie | `pdf.exportador.ts` |
| **No hay UI de ordenamiento** en el builder, aunque el motor lo soporta | `ReportesBuilder.tsx` |
| El test `query-planner.spec.ts:232` **está fallando** desde que se introdujo `obligatorio` | |
| El permiso `deudores.exportar` **está declarado y no lo usa nadie**: no hay endpoint ni botón de exportar en Gestión | `permisos-catalogo.ts` |
| Buscar por teléfono compara contra el E.164 guardado **sin normalizar lo que se tipea**: `11 5555-1234` no encuentra nada | `deudores.service.ts` |
| La búsqueda avanzada corta en **50 resultados sin avisar** y sin paginación | `deudores.service.ts` |
| **Se puede cancelar un caso a mano** eligiendo SIT-050 en el desplegable, sin permiso especial — y no se puede volver atrás desde la ficha | `FichaEstadosCard.tsx` |
| **Registrar el pago de una cuota de convenio no dispara la consolidación**: el saldo del caso no baja | `convenios.service.ts` |
| El estado **VENCIDA de cuota no lo escribe nadie**: `updateEstadosCuotas()` no tiene caller | `convenios.service.ts` |
| El importe del pago de cuota **es editable y marca la cuota como pagada igual**, sin validar | `convenios.service.ts` |
| Los pagos de cuota quedan con `origen = NULL`, así que **no se pueden borrar** ni se etiquetan bien | `convenios.service.ts` |
| **No hay UI para borrar comentarios**, aunque el endpoint y el permiso existan | `ComentariosPanel.tsx` |
| Un comentario con `usuarioId = null` **lo puede borrar cualquiera** con el permiso | `comentarios.service.ts:42` |
| Los comentarios de acciones masivas guardan `origen` pero **no se renderiza** | `ComentariosPanel.tsx` |
| El permiso `deudores.editar_estado` **no se consulta en el frontend**: el rechazo llega al guardar | `FichaEstadosCard.tsx` |
| **No se puede quitar un motivo de no pago**: al guardar se conserva el anterior | `deudores.service.ts:238` |
| Los cambios de estado **automáticos no se auditan por caso**, así que Auditoría no los explica | `consolidacion.service.ts`, `promesas.service.ts` |
| Solo **SIT-050** bloquea la ficha; SIT-051/052/053 no | `deudor-bloqueo.ts` |
| `accion_masiva_snapshot` no tiene FK a `remesa`: borrar una remesa de acciones deja filas huérfanas | `schema.prisma` |

> Estas guardas se agregan al cerrar la fase 1. Ponerlas ahora, con 2 páginas de 40, solo daría rojo.
