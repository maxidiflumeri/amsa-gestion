# Asistente de IA — Detalle de la respuesta: los pasos de cada respuesta, con su tiempo y su costo — spec

> **Estado:** diseño del 20/10/2026, sobre `d4ecaf7`. Sin implementar. Va **antes** de la Fase 1a del analista de cartera.
> **Pedido del usuario:** debajo de cada respuesta, un **"Ver detalle"** con el camino que hizo el agente, cuánto tardó y
> cuánto costó cada paso, para monitorear tiempos y gasto. Lo ve solo quien tiene un permiso. Maqueta en texto aprobada
> (§12.2 la repite, con los números del caso de prueba).
> **Lo que aceptó el usuario:** un permiso nuevo y asignable, separado de `asistente.administrar`; un interruptor en el
> panel; visible en las conversaciones viejas; en **Consumo del asistente** una tabla con la mediana y el p95 de cada paso
> por función; el tiempo percibido en el navegador; que sirva para `ayuda`, `reportes` y la futura `cartera` sin trabajo
> extra.
> **Se apoya en:** [asistente-spec.md](asistente-spec.md) (Fase A, con §23 y §24) y
> [asistente-reportes-spec.md](asistente-reportes-spec.md) (Fase B, con §26 y §27).
> **Leyenda:** **[V]** verificado (código leído o comando corrido) · **[S]** suposición a confirmar. Las mediciones contra
> Bedrock que faltan están en §15, con su comando y su costo: **no se corrió ninguna**.

---

## 0. Lo que se verificó en el código (leer primero)

1. **El SDK emite todo lo que hace falta para medir, sin contenido.** `MessageStream` tiene los eventos `connect`,
   `streamEvent`, `text`, `thinking`, `signature`, `inputJson`, `contentBlock`, `message`, `finalMessage`, `error`,
   `abort` y `end` [V `node_modules/@anthropic-ai/sdk/lib/MessageStream.d.ts:6-20`, SDK 0.135.0].
   - `streamEvent` recibe cada evento crudo: `message_start`, `content_block_start` (con el tipo del bloque y, si es
     `tool_use`, su `name`), `content_block_delta`, `content_block_stop`, `message_delta` y `message_stop`
     [V `MessageStream.js:404-410`, `messages.d.ts:3622-3626`].
   - `connect` sale cuando llegan las cabeceras de la respuesta HTTP, después de los reintentos [V `MessageStream.js:167-183, 206-214`].
   - El adaptador de Bedrock convierte cada *chunk* del event stream de AWS en **un** evento con la forma de Anthropic
     [V `node_modules/@anthropic-ai/bedrock-sdk/core/streaming.js:58-82`]. Los tiempos de inicio y fin de cada bloque se
     toman al recibir `content_block_start` y `content_block_stop`.
2. **Un listener que tira una excepción rompe el stream.** `_emit` llama a cada listener sin `try`
   [V `MessageStream.js:309-321`]. Una excepción dentro de `streamEvent` corta `_addStreamEvent` y falla la llamada
   [V `MessageStream.js:184-193`], y una dentro de `connect` aborta el stream [V `MessageStream.js:173-182`].
   **Todo lo que se cuelga del stream va envuelto en `try/catch`** (§7.2).
3. **Lo que no se sabe sin una llamada real [S → M-1, §15]:** con el razonamiento adaptativo y `display` en `omitted`
   (el default de Haiku 5.5 y Sonnet 5.5), el bloque `thinking` llega con el texto vacío. No está confirmado si Bedrock
   manda el `content_block_start` del bloque **al empezar** a razonar o **junto con el `stop`, al terminar**. En el segundo
   caso el bloque dura 0 ms y su tiempo queda dentro de la espera. El diseño cubre los dos casos sin cambiar código (§7.3,
   regla de fusión). La medición decide solo el texto de la wiki.
4. **Ningún runner ejecuta herramientas en paralelo.**
   - La ayuda las ejecuta en orden y de forma sincrónica [V `turno/turno-runner.ts:486-494`].
   - Reportes, en orden y con `await` [V `reportes/turno-reportes.runner.ts:474-477`].
   - Cartera planea lo mismo [V `docs/analista-cartera-fase1-spec.md:1730`].
   - **Sí hay paralelo adentro de `probar_plantilla`:** la muestra y el conteo corren con `Promise.all`, después de esperar
     lugar en el semáforo [V `reportes/prueba-propuesta.service.ts:99-111`]. La maqueta lo muestra (§12.2). El modelo de
     datos admite herramientas en paralelo para cuando una función las use (§7.4).
5. **Los errores del SDK no tienen `name` propio.** Ninguna clase de `core/error.js` lo asigna: `err.name` da `"Error"`
   para un timeout, un 429 o un 500 [V `node_modules/@anthropic-ai/sdk/core/error.js:6-132`]. Hoy
   `asistente_llamada.error` guarda `"Error"` para todas [V `turno/llamada-modelo.ts:100`]. Sin arreglarlo, el detalle no
   puede decir "no respondió a tiempo". Se arregla (§7.3.6).
6. **Hay dos catálogos de permisos y la pantalla de Roles lee el del frontend** [V `frontend/src/pages/admin/RolesPage.tsx:32`].
   - El test de sincronía compara solo las claves [V `backend/src/auth/permisos-catalogo.spec.ts:30-42`].
   - Por eso hoy la pantalla de Roles muestra "Próximamente…" en **Asistente: armar reportes**, que funciona desde el 19/10
     [V `frontend/src/utils/permisosCatalogo.ts:164`]. Se corrige en este trabajo, con test (§13). La Fase 1b de cartera lo
     tenía anotado [V `analista-cartera-fase1-spec.md:84-85`]: si sale esto primero, no lo repite.
7. **`@Permisos` en un método reemplaza al de la clase, no se suma.** El guard usa `getAllAndOverride` y `some`
   [V `backend/src/auth/permisos.guard.ts:23-34`]. Un `@Permisos('asistente.ver_detalle')` en un método de
   `AsistenteAdminController` **sacaría** el requisito de `asistente.administrar`. Además, `@Permisos('a', 'b')` es "a **o** b".
   El segundo permiso se verifica dentro del método (§6.1).
8. **El parser SSE del frontend descarta los eventos que no conoce** [V `frontend/src/api/asistente.ts:54`]. El detalle
   viaja **dentro** de `fin` y de `error`, que ya conoce (§6.2).
9. **El permiso nuevo cambia el contexto del turno de quien lo tiene.** El mensaje `system` de cada turno lista las
   etiquetas de los permisos de la persona [V `rutas/rutas-catalogo.ts:51-54`, `prompt/armar-request.ts:136`]. El set de
   evaluación le da a ADMIN **todas** las claves [V `scripts/asistente-eval/correr-eval.ts:47`]. Es un cambio de datos, no
   del código del detalle, y no toca el `system` cacheado: el mapa de pantallas solo nombra los permisos que pide una
   pantalla [V `rutas/rutas-catalogo.ts:105-107`]. Ver D-8 y M-2.
10. **Las pruebas de ancho y de colores del frontend no ven todo.**
    - `ancho-360.test.ts` lee solo los archivos de primer nivel de `components/asistente` y `pages/asistente`
      [V `frontend/tests/tema/ancho-360.test.ts:9, 33`]: los componentes nuevos van ahí, sin subcarpeta.
    - `colores.test.ts` tiene una lista explícita [V `frontend/tests/tema/colores.test.ts:7-30`]: hay que sumarlos.
11. **Lo que ya existe y se reusa:**
    - `asistente_llamada` tiene `ms`, los tokens con `tokensThinking` aparte y `costoUsd` por llamada
      [V `backend/prisma/schema.prisma`, modelo `asistente_llamada`];
    - `MedicionService.registrarLlamada` devuelve el costo que guardó [V `medicion.service.ts:53-98`];
    - `asistente_mensaje.pasos` guarda los pasos de reportes, que ve todo el que usa la función
      [V `conversaciones.service.ts:219`].

---

## 1. Resumen de decisiones

| Tema | Decisión |
|---|---|
| Permiso | `asistente.ver_detalle`, "Ver el detalle de las respuestas del asistente", en los **dos** catálogos (D-1) |
| Qué se mide | Preparación (topes, historial, armado), cada llamada (espera del primer token, razonamiento, respuesta, pedido de herramienta), cada herramienta (con las partes de `probar_plantilla`), guardar, el total y los huecos sin medir |
| Reloj | `performance.now()`, monotónico, inyectable en los tests |
| Cómo llega del stream | `StreamModelo.onEvento?` **opcional**: eventos sin contenido (tipo de bloque, índice y nombre de la herramienta). Los dobles de los tests siguen compilando |
| Dónde se guarda | Una columna JSON nueva `asistente_mensaje.traza` (una sola lectura con el mensaje) y otra, `tiemposNavegador`. `asistente_llamada` no cambia (§4.1) |
| Retención | La de la conversación: 90 días. El costo sigue en `asistente_llamada` 400 días. La tabla de tiempos de Consumo cubre solo lo que no se borró |
| Costo | Por llamada: el **exacto** registrado. Adentro, se reparte: la entrada va a la espera; el razonamiento sale de `tokensThinking` × el precio de salida; el resto de la salida va a la respuesta y a los pedidos. Lo repartido por estimación lleva "≈" |
| Herramientas | Tiempo exacto. No gastan tokens: se muestra "≈ N tokens a la llamada siguiente", sin USD (D-4) |
| Relación con `pasos` | Separados. `pasos` no cambia ni un byte. El detalle toma el texto del paso como descripción de la herramienta (§10) |
| Al navegador | `detalle` dentro de `fin` y de `error`, y en cada mensaje de `GET conversaciones/:id`. **Solo con el permiso: lo filtra el servidor** |
| Respuestas viejas | Sin `traza`: se reconstruye desde `asistente_llamada` y se marca "parcial" (D-7) |
| Tiempo percibido | Lo mide el panel desde Enviar hasta la primera señal, el primer texto y el final. Lo manda al servidor para todos, haya permiso o no (D-6) |
| Consumo | Tabla "Tiempos por paso" con la mediana y el p95, endpoint aparte. "Ver detalle" en las 👎, con `asistente.administrar` + `asistente.ver_detalle` (D-2, D-3) |
| Pedido al modelo | **Ni un byte distinto**: lo prueba el snapshot de `params-ayuda` corrido con y sin detalle, y la comparación de los `params` en reportes |
| Si falla medir | La respuesta no falla. El medidor nunca lanza; guardar el detalle va aparte, con `try/catch` |

---

## 2. Impacto y riesgos

**Módulos tocados:**
- `backend/src/modules/asistente/`:
  - `modelo/cliente-modelo.ts` (eventos del stream);
  - `turno/llamada-modelo.ts` (enganches y la clase del error);
  - los dos runners (enganches, sin cambiar lo que hacen);
  - `reportes/prueba-propuesta.service.ts` (las partes de la prueba);
  - `asistente.service.ts`, `conversaciones.service.ts` y `medicion.service.ts`;
  - los dos controllers, los DTOs y los tipos.
- `backend/src/auth/permisos-catalogo.ts` y `frontend/src/utils/permisosCatalogo.ts`.
- `schema.prisma`: dos columnas JSON nulables en `asistente_mensaje`.
- Frontend: el panel (burbuja, menú, contexto), la pantalla de consumo, tipos, API y la wiki (3 páginas).

**Qué se rompe si sale mal:**
- **El pedido a Bedrock cambia** y se pierde la caché, o cambian las evaluaciones. Mitigación:
  - el medidor no toca `params` ni `messages`;
  - el snapshot de `params-ayuda.spec.ts` corre también con el detalle encendido (§14.1);
  - en reportes se comparan los `params` con y sin detalle.
- **Una respuesta falla por culpa del medidor.**
  - Un listener que lanza rompe el stream (§0.2): todo va en `try/catch` y hay test con un callback que lanza.
  - Guardar el detalle va en una escritura aparte: si falla, `warn` y la respuesta sigue.
- **El detalle le llega a quien no tiene el permiso.** El servidor no agrega la clave. Hay tests sobre `fin`, `error`,
  el detalle de la conversación y los endpoints de administración (§14.1).
- **Se filtran datos de personas al detalle.** El tipo no tiene ningún campo de texto libre que venga del modelo o de la
  persona. Las descripciones las arma el backend. Test de privacidad (§8).
- **Números que no cierran.** La suma de los costos del detalle tiene que dar lo que dice `asistente_llamada`
  (±0,000001). Test.

**Datos ya cargados:** ninguno cambia. Las respuestas viejas no tienen `traza`: se reconstruyen al leerlas (§7.9), sin
backfill.

**Jobs:** ninguno nuevo. La limpieza de las 04:30 ya borra los mensajes con su conversación [V
`asistente-limpieza.service.ts:80-104`].

---

## 3. Arquitectura

```
Navegador                      Backend                                                         Bedrock
─────────                      ───────                                                         ───────
Enviar ─ t0 (performance.now)
POST /asistente/preguntar ───► AsistenteService.preparar
                                 traza = new TrazaTurno({funcion, modelo, precio, reloj})      t0 del servidor
                                 parte 'topes'      ← TopesService.verificarInicio
                                 parte 'historial'  ← persona + ConversacionesService.crearTurno
◄─ inicio ──────────────────── (SSE abierto)
                               AsistenteService.ejecutar
                                 parte 'contexto'   ← (reportes: catálogo, adjuntos, vocabularios) + armado del runner
                                 Runner.correr({..., traza})
                                   loop:
                                     tl = traza.llamada(iter)          ── antes de los topes
                                     llamarModelo({..., traza: tl})
                                       stream.onEvento?(ev → tl.evento(ev)) ◄── connect · message_start ·
                                                                                content_block_start/stop · message_stop
                                       tl.cerrar({uso, costo, stopReason, largos de cada bloque})
                                     th = traza.herramienta(nombre, recurso)
                                       ejecutar(...)  ← (probar_plantilla: th.parte('muestra') ∥ th.parte('conteo'))
                                       th.cerrar({esError, caracteresResultado})
                                   traza.motivo('tope_turno' | 'detenida' | …) en cada salida
                                 parte 'guardar'    ← finalizarTurno + asignarCosto
                                 detalle = traza.armar({estado})        ── puro, nunca lanza
                                 guardarTraza(mensajeId, detalle)       ── aparte, try/catch → warn
◄─ fin {…, detalle?} ────────── detalle SOLO si el JWT tiene asistente.ver_detalle
primer texto / final medidos
POST /mensajes/:id/tiempos ──► ConversacionesService.registrarTiemposNavegador (la primera escritura gana)

GET /asistente/conversaciones/:id ──► mensajes[].detalle? (traza + tiemposNavegador; sin traza → reconstruido)
GET /asistente/consumo/tiempos      ──► MedicionService.tiempos(mes): mediana y p95 por paso y función
GET /asistente/mensajes/:id/detalle ──► el detalle de una 👎 (administrar + ver_detalle)
```

**Por qué el medidor es un objeto que se pasa y no un servicio de Nest.** Vive lo que dura un turno, se arma con el reloj
y el precio de ese turno, y los runners son puros (los usa el set de evaluación sin Nest). Es un puerto opcional más,
como `emitir`: un runner sin `traza` usa `TRAZA_NULA`.

**Por qué los enganches en los runners y no un envoltorio por fuera.** Lo que pasa entre dos llamadas (qué herramienta,
qué paso emitió, por qué terminó el turno) solo lo sabe el runner. Los enganches son líneas
`e.traza?.x(...)` que no cambian ninguna decisión del loop. Los tests actuales siguen pasando sin tocarlos.

---

## 4. Datos

### 4.1 Dónde se guarda: la decisión

| Opción | Mostrar un mensaje | Agregados de Consumo | Retención | Veredicto |
|---|---|---|---|---|
| Columnas nuevas en `asistente_llamada` (ms de espera, razonamiento, texto, pedido) | Un join con las llamadas, y la preparación, las herramientas y el guardado no tienen dónde ir | SQL directo, pero solo de lo que es llamada | 400 días | No: cubre la mitad del detalle |
| Tabla de ejecuciones de herramientas + columnas en llamadas | Dos joins por mensaje | SQL directo | La que se elija | No: tres lugares para un dibujo; cartera tendría que tocar el schema |
| **JSON `traza` en `asistente_mensaje`** | **La misma lectura** que ya hace `detalle` (`include: mensajes`, [V `conversaciones.service.ts:250-253`]) | En memoria, sobre el JSON del mes (como ya hace `consumo` con las llamadas [V `medicion.service.ts:147-189`]) | 90 días, con la conversación | **Sí** |

**Por qué el JSON:**
- se escribe una vez por respuesta;
- se lee entero con el mensaje;
- tiene `version` y tipos de nodo abiertos: cartera suma herramientas sin `db push`;
- la retención es la de la conversación, que es la de los datos que describe.

**Lo que se pierde, a sabiendas:** los tiempos de los meses de hace más de 90 días. Los **costos** no: siguen en
`asistente_llamada` 400 días y Consumo los sigue mostrando. La tabla de tiempos lo dice ("Salen del detalle de las
respuestas, que se borra a los 90 días") y muestra la cantidad de muestras.

**`tiemposNavegador` va en una columna aparte** porque lo escribe otro pedido, después de `fin`. Así no hay una carrera
con la escritura de `traza` ni un leer-modificar-escribir sobre el mismo JSON.

### 4.2 Columnas nuevas (`backend/prisma/schema.prisma`, modelo `asistente_mensaje`)

Después de `pasos`, imitando el comentario de los vecinos:

```prisma
  /// Detalle de la respuesta (docs/asistente-detalle-spec.md §6.3): los pasos con sus tiempos, tokens y costo. Sin
  /// contenido: nunca el razonamiento, los argumentos ni los resultados de las herramientas. Solo rol 'asistente'.
  /// null = respuesta de antes de esta funcionalidad, o detalle que no se pudo guardar: se reconstruye desde
  /// asistente_llamada al leerlo.
  traza            Json?
  /// Lo que midió el navegador de la persona, desde que apretó Enviar: { primeraSenalMs, primerTextoMs, totalMs }.
  /// Lo manda el panel al terminar la respuesta; la primera escritura gana.
  tiemposNavegador Json?
```

Sin índices nuevos ni uniques. `consumo/tiempos` filtra por `rol` y `createdAt` sobre una tabla que se limpia a los 90
días: con el volumen estimado (6.600 respuestas por mes como máximo, Fase A §7.5) son unas 40.000 filas. Si crece, el
índice `@@index([rol, createdAt])` queda en la deuda (§13).

### 4.3 `db push`

- Aditivo: dos columnas nulables en una tabla existente. **No requiere `--accept-data-loss`** y no toca ningún enum.
- Antes de commitear:
  1. `npx prisma db push` contra la base local;
  2. `npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script`,
     que tiene que salir vacío.
- Sin backfill ni script: lo viejo se reconstruye al leer (§7.9).

### 4.4 Tamaño

- Un turno de ayuda con una lectura de página: unos 12 nodos, unos 2 KB.
- Uno de reportes con 2 pruebas y 3 llamadas: unos 35 nodos, unos 6 KB.
- **Tope:** 200 nodos o 48 KB de JSON. Si se pasa, quedan los primeros 200 nodos en orden, el resto se cuenta en un nodo
  `otros` y va `recortado: true`.
- Con el máximo estimado, unos 13 MB por mes, y unos 40 MB en régimen con la limpieza de 90 días.

---

## 5. Backend — archivos

### 5.1 Nuevos (bajo `backend/src/modules/asistente/` salvo indicación)

| Archivo | Qué hace |
|---|---|
| `turno/traza.ts` | `TrazaTurno` (el medidor de un turno), `TRAZA_NULA`, los puertos `PuertoTraza`, `TrazaLlamada` y `TrazaHerramienta`, `RECURSO_HERRAMIENTA` y `relojMonotonico`. Cada método envuelto: nunca lanza (§7.7) |
| `turno/detalle.ts` | Puro: `nodosDeLlamada` (§7.3), `completarHuecos` (§7.6), `armarDetalle` (§7.7), `recortarDetalle`, `detalleDesdeLlamadas` (§7.9), `muestrasDeDetalle`, `percentil` y `tablaDeTiempos` (§7.11), `resumenParaLog` |
| `turno/doble-stream-con-tiempos.ts` | Para los tests: `RelojFalso` y `ClienteConTiempos`, un `ClienteModelo` cuyo guion fija en qué milisegundo llega cada evento (§14.1). Fuera del build (ver `tsconfig.build.json`) |
| `dto/tiempos-navegador.dto.ts` | `TiemposNavegadorDto` (class-validator, §6.1) |
| `turno/traza.spec.ts`, `turno/detalle.spec.ts`, `turno/traza.privacidad.spec.ts`, `modelo/cliente-modelo.spec.ts` | §14.1 |
| `backend/scripts/asistente-eval/medir-eventos.ts` | La medición M-1 (§15). No es código de producción ni corre en el deploy |

### 5.2 A modificar

| Archivo | Cambio |
|---|---|
| `modelo/cliente-modelo.ts` | `StreamModelo.onEvento?` y `EventoStreamModelo` (§6.4). `ClienteAnthropic.messages.stream().on` suma las sobrecargas `'connect'` y `'streamEvent'`. `ClienteBedrock.stream` implementa `onEvento` con `try/catch` en cada callback (§7.2) |
| `turno/llamada-modelo.ts` | `EntradaLlamada.traza?: TrazaLlamada`. `llamarModelo` llama a `traza.stream()` después de los topes, engancha `stream.onEvento?.(…)`, y al terminar `traza.cerrar(…)` con el uso, el costo devuelto por `registrarLlamada` y los largos de cada bloque. Si los topes cortan: `traza.cortadaPorTope(codigo)` y relanza. `claseDeError(err)` en vez de `String(err?.name)` (§7.3.6) |
| `turno/turno-runner.ts` | `EntradaTurno.traza?: PuertoTraza`. Antes de cada `llamarModelo`: `traza.llamada(iter)`. Cada herramienta, entre `traza.herramienta(…)` y `.cerrar(…)`, con la descripción que arma `ejecutar` (§8.2). `traza.motivo(…)` en cada salida del loop (§9). **Ninguna decisión cambia** |
| `reportes/turno-reportes.runner.ts` | Lo mismo. `emitirPaso` además describe la herramienta en curso. `probar` le pasa la herramienta en curso a `PuertoPrueba.probar` (`traza?`, opcional). `motivo('prompt_demasiado_grande')` en el corte previo [V `:283-292`] |
| `reportes/prueba-propuesta.service.ts` | Con `a.traza`: partes `validacion` (la hace el runner), `espera_base` (semáforo, `:99`), `muestra` y `conteo` (cada promesa del `Promise.all`, `:108-111`). Sin `a.traza`, idéntico a hoy |
| `asistente.service.ts` | Crea la `TrazaTurno` al empezar `preparar` (después de `turnos.tomar`). Marca las partes `topes`, `historial`, `contexto` y `guardar`. Pasa la traza al runner. Envuelve `emitir` para marcar el primer `texto`. Arma, guarda y agrega `detalle` a `fin`/`error` **solo si** `verDetalle` (§7.7). En el `catch`, `motivo('interno')`, guarda lo que haya y lo manda en `error`. El log de cierre suma el desglose |
| `conversaciones.service.ts` | `guardarTraza(mensajeId, detalle)`. `detalle(usuarioId, id, { conDetalle })` mapea `traza` + `tiemposNavegador` → `detalle`, o lo reconstruye (§7.9). Suma `registrarTiemposNavegador` y `detalleDeMensaje` (para la 👎) |
| `medicion.service.ts` | `tiempos(mes): TiemposAsistente` (§7.11) y `precioDe(modelo)` (delega en `AsistenteConfigService.precioVigente`) |
| `asistente.controller.ts` | `detalle` pasa `conDetalle = permisos incluye asistente.ver_detalle`. `POST mensajes/:id/tiempos` |
| `asistente-admin.controller.ts` | `GET consumo/tiempos` y `GET mensajes/:id/detalle`. **Sin `@Permisos` en el método** (heredan `asistente.administrar`); `ver_detalle` se verifica adentro (§0.7) |
| `dto/asistente.tipos.ts` | Tipos de §6.3. `EventoSse`: `fin.data.detalle?` y `error.data.detalle?`. `MensajeAsistente.detalle?` |
| `backend/src/auth/permisos-catalogo.ts` | El permiso nuevo en la sección Asistente (§6.5) |
| `backend/src/auth/permisos-catalogo.spec.ts` | Cuatro permisos del asistente. **Nuevo:** las etiquetas y descripciones de la sección Asistente iguales en los dos catálogos |
| `frontend/src/utils/permisosCatalogo.ts` | El permiso nuevo y la descripción de `asistente.reportes` igual a la del backend. Va en el paquete **BE-3**, para que el test de sincronía quede en verde en el mismo commit |
| `backend/tsconfig.build.json` | `exclude` suma `"**/doble-stream-*.ts"`, como el `doble-prisma-*` que ya está |
| `backend/scripts/asistente-eval/correr-eval.ts` | Opcional: `--detalle` arma una `TrazaTurno` por pregunta e imprime la tabla de tiempos con `tablaDeTiempos` (sirve para M-2) |

---

## 6. Contratos

Todo bajo `/api`, con el `JwtAuthGuard` global. **El frontend copia los tipos de §6.3 tal cual.**

### 6.1 Endpoints

| Método y ruta | Permiso | Entrada | Respuesta | Errores |
|---|---|---|---|---|
| `POST /asistente/preguntar` | `asistente.usar` (como hoy) | Como hoy | SSE (§6.2): `fin` y `error` suman `detalle` **solo** si el JWT tiene `asistente.ver_detalle` | Como hoy |
| `GET /asistente/conversaciones/:id` | `asistente.usar` | — | `ConversacionDetalle`. Cada mensaje del asistente suma `detalle: DetalleRespuesta \| null` **solo** con `asistente.ver_detalle`; sin el permiso la clave **no existe**. `null` = mensaje en curso o sin nada que mostrar | Como hoy |
| `POST /asistente/mensajes/:id/tiempos` | `asistente.usar`, mensaje propio | `TiemposNavegadorDto { primeraSenalMs?: number \| null; primerTextoMs?: number \| null; totalMs: number }`: enteros de 0 a 900.000 (`IsInt`, `Min`, `Max`, `IsOptional`) | `204`. Si ya estaba cargado, `204` sin cambiar nada | `400 {codigo:'TIEMPOS_INVALIDOS'}` si `primeraSenalMs` o `primerTextoMs` > `totalMs` · `404` si es ajeno, inexistente, del rol usuario, `en_curso` o de hace más de 30 minutos |
| `GET /asistente/mensajes/:id/detalle` | `asistente.administrar` (de la clase) **y** `asistente.ver_detalle` (verificado en el método) | — | `DetalleRespuesta` (de cualquier persona: es para las 👎) | `403 {codigo:'SIN_PERMISO_DETALLE', mensaje:'Para ver el detalle hace falta el permiso «Ver el detalle de las respuestas del asistente».'}` · `404` si no existe o es del rol usuario |
| `GET /asistente/consumo/tiempos?mes=YYYY-MM` | `asistente.administrar` | `mes` opcional (`ConsumoQueryDto`) | `TiemposAsistente` | `400` mes inválido |

- **El 403 de `mensajes/:id/detalle`** se loguea `warn`, como el del guard, y no se audita: es una lectura, como el resto
  de Consumo (Fase A §6.2).
- **`POST tiempos` no loguea a nivel `log`:** es uno por respuesta. Va `debug`, y `warn` si es inválido.

### 6.2 Eventos SSE

No hay eventos nuevos. Cambian dos:

| Evento | `data` |
|---|---|
| `fin` | Como hoy + `detalle?: DetalleRespuesta`. Lo arma el servidor después de guardar la respuesta (§7.7) |
| `error` | Como hoy + `detalle?: DetalleRespuesta`, con lo que alcanzó a pasar |

- El orden sigue igual: `inicio` primero, y `fin` o `error` último, exactamente uno.
- **El detalle no llega en vivo**, paso por paso: aparece cuando la respuesta termina. Es lo que muestra la maqueta.
- **Un frontend viejo** (caché del navegador durante el deploy) ignora la clave nueva: no se rompe nada.

### 6.3 Tipos (`backend/src/modules/asistente/dto/asistente.tipos.ts` y `frontend/src/types/asistente.ts`)

```ts
// ============ Detalle de la respuesta (docs/asistente-detalle-spec.md) ============

export const PERMISO_VER_DETALLE = 'asistente.ver_detalle';

/** Abierto a propósito: una función nueva puede sumar tipos; el panel muestra el tipo tal cual si no lo conoce. */
export type TipoNodo =
    | 'preparacion' | 'topes' | 'historial' | 'contexto'                 // la preparación y sus partes
    | 'llamada' | 'espera' | 'razonamiento' | 'respuesta' | 'pedido'      // una llamada al modelo y sus tramos
    | 'herramienta' | 'validacion' | 'espera_base' | 'muestra' | 'conteo' // una herramienta y sus partes
    | 'guardar' | 'otros' | 'sin_detalle';

/** Dónde corre la herramienta: lo que explica su tiempo. */
export type RecursoHerramienta = 'base' | 'wiki' | 'memoria';

export type MotivoFin =
    | 'tarjeta'                  // ok: terminó al mostrar la tarjeta, sin otra llamada
    | 'respuesta_vacia'          // ok: el modelo no devolvió texto y se mostró el texto de reemplazo
    | 'detenida'                 // cortado: Detener o se cerró el panel
    | 'tope_turno' | 'max_tokens' | 'iteraciones' | 'otro_corte'
    | 'rechazo'                  // rechazado
    | 'tope_mensual' | 'tope_funcion' | 'modelo_no_disponible' | 'timeout' | 'prompt_demasiado_grande' | 'interno'
    | 'sin_terminar';            // reconstruido: la respuesta quedó en curso (el servidor se reinició a mitad)

export interface NodoDetalle {
    tipo: TipoNodo | string;
    /** Desde el inicio del turno en el servidor. Ubica la barra de la cascada. */
    desdeMs: number;
    ms: number;
    /** Llamada: 1, 2, 3… */
    numero?: number;
    /** Herramienta y pedido: el nombre de la herramienta, de la lista de la función (si no, 'otra'). */
    nombre?: string;
    recurso?: RecursoHerramienta;
    /** Herramienta: lo que hizo, en palabras. Lo arma el backend (el texto del paso). Nunca argumentos ni resultados. */
    descripcion?: string;
    estado?: 'ok' | 'aviso' | 'error';
    tokens?: number;
    costoUsd?: number;
    /** Los tokens o el costo salen de un reparto (§7.3.4): se muestran con «≈». */
    estimado?: boolean;
    /** Llamada: por qué terminó. El stop_reason, o 'abortada' | 'timeout' | 'error' | 'tope_turno' | 'tope_mensual' | 'tope_funcion'. */
    fin?: string;
    /** Llamada que falló: la clase del error del SDK ('APIConnectionTimeoutError', 'RateLimitError'…). */
    error?: string;
    /** Llamada: el uso tal como lo registró asistente_llamada. */
    uso?: { entrada: number; cacheLectura: number; cacheEscritura: number; salida: number; razonamiento: number };
    /** Llamada: el stream no informó sus bloques (un doble sin onEvento, o falló el medidor). */
    sinDesglose?: boolean;
    /** Espera: cuándo llegaron las cabeceras (después de los reintentos) y el primer evento, desde el inicio de la llamada. */
    msConexion?: number | null;
    msPrimerEvento?: number | null;
    /** Espera: lo que tardó el control de topes antes de abrir el stream. */
    msTopes?: number;
    /** Espera: el razonamiento no tuvo tiempo propio y quedó adentro (§7.3.5). */
    incluyeRazonamiento?: boolean;
    /** Razonamiento: sus eventos llegaron juntos; su tiempo está en la espera. Tiene tokens y costo, no duración. */
    sinTiempoPropio?: boolean;
    /** Herramienta: lo que le devolvió al modelo, ≈ 3 caracteres por token. Se paga como entrada de la llamada siguiente. */
    tokensResultado?: number;
    /** Quedó abierto: Detener, un error o una falla a mitad. */
    cortado?: boolean;
    hijos?: NodoDetalle[];
}

export interface TiemposNavegador {
    /** El primer cambio en pantalla después de Enviar: texto, «Leyendo…», un paso, una tarjeta. */
    primeraSenalMs: number | null;
    primerTextoMs: number | null;
    totalMs: number;
}

export interface DetalleRespuesta {
    version: 1;
    funcion: string;            // 'ayuda' | 'reportes' | 'cartera'… (string: no se suma otra unión de dos funciones)
    modelo: string;             // 'us.anthropic.claude-sonnet-5-5'
    estado: 'ok' | 'cortado' | 'rechazado' | 'error';
    motivo: MotivoFin | null;   // null = terminó bien, sin nada que aclarar
    totalMs: number;
    /** Cuándo salió el primer texto del servidor, desde el inicio del turno. */
    primerTextoMs: number | null;
    /** La suma de las llamadas: el mismo número que asistente_llamada. */
    costoUsd: number;
    llamadas: number;
    nodos: NodoDetalle[];
    /** Reconstruido desde asistente_llamada: solo las llamadas, sin tramos ni herramientas. */
    parcial: boolean;
    /** Falló algo del medidor: lo que está es correcto, pero falta algo. */
    incompleto: boolean;
    recortado: boolean;
    navegador: TiemposNavegador | null;
}

export type PasoTiempo =
    | 'total' | 'navegador_total' | 'navegador_primer_texto' | 'preparacion' | 'llamada' | 'espera'
    | 'razonamiento' | 'respuesta' | 'pedido' | 'herramienta' | 'guardar';
export interface FilaTiempo { paso: PasoTiempo; herramienta: string | null; muestras: number; medianaMs: number; p95Ms: number }
export interface TiemposAsistente {
    mes: string;
    /** Respuestas con detalle en el mes (las de antes de esta funcionalidad y las de conversaciones borradas no están). */
    respuestas: number;
    /** Más de 5.000: se tomaron las 5.000 más nuevas. */
    recortado: boolean;
    porFuncion: { funcion: string; nombre: string; filas: FilaTiempo[] }[];
}

// Cambios en los existentes:
// MensajeAsistente      + detalle?: DetalleRespuesta | null      (solo con el permiso; solo rol 'asistente')
// EventoSse fin.data    + detalle?: DetalleRespuesta
// EventoSse error.data  + detalle?: DetalleRespuesta
```

**Lo que se guarda en `traza`** es el mismo `DetalleRespuesta`, con `parcial: false` y `navegador: null`. Al leerlo se
completa `navegador` desde `tiemposNavegador`.

### 6.4 El puerto del stream (`modelo/cliente-modelo.ts`)

```ts
/** Lo que el medidor necesita saber de un stream: qué bloque empieza y termina, nunca su contenido. */
export type TipoBloque = 'thinking' | 'redacted_thinking' | 'text' | 'tool_use' | 'otro';
export type EventoStreamModelo =
    | { tipo: 'conexion' }                                                     // `connect`
    | { tipo: 'inicio_mensaje' }                                               // `message_start`
    | { tipo: 'inicio_bloque'; indice: number; bloque: TipoBloque; herramienta?: string } // `content_block_start`
    | { tipo: 'fin_bloque'; indice: number }                                   // `content_block_stop`
    | { tipo: 'fin_mensaje' };                                                 // `message_stop`

export interface StreamModelo {
    onTexto(cb: (delta: string) => void): void;
    finalMessage(): Promise<Message>;
    parcial(): Message | undefined;
    /**
     * Opcional: los eventos del stream SIN contenido, para el detalle (docs/asistente-detalle-spec.md §7.2). Un doble que no
     * lo implementa da una llamada «sin desglose». El callback nunca rompe el stream: lo envuelve quien lo llama.
     */
    onEvento?(cb: (e: EventoStreamModelo) => void): void;
}
```

Los deltas **no** se reenvían: no hacen falta para medir y son la mayoría de los eventos (§7.8).

### 6.5 El permiso (`permisos-catalogo.ts`, los dos)

En la sección **Asistente**, después de `asistente.administrar`:

```ts
{ key: 'asistente.ver_detalle', label: 'Ver el detalle de las respuestas del asistente', descripcion: 'Debajo de cada respuesta, los pasos que hizo el asistente, con cuánto tardó y cuánto costó cada uno. No muestra el razonamiento del modelo ni los datos que consultó. Con «Administrar el asistente», también el de las respuestas con 👎.' },
```

En `frontend/src/utils/permisosCatalogo.ts`, además, la descripción de `asistente.reportes` pasa a ser la del backend
(§0.6).

---

## 7. La medición paso a paso

### 7.1 El reloj

- `relojMonotonico = () => performance.now()`: global en Node 20 [V `Dockerfile.backend:4`], monotónico, con fracción de
  milisegundo. `Date.now()` puede saltar con un ajuste de hora.
- `TrazaTurno` recibe `reloj?: () => number`. En los tests, el `RelojFalso` del doble.
- **Todo se guarda en milisegundos enteros relativos a `t0`,** el momento en que el pedido llega a `preparar`. Lo que
  pasa antes (guards, validación del DTO) no entra: son microsegundos.
- **`asistente_llamada.ms` sigue con `Date.now()`** y no cambia. La llamada del detalle empieza **antes** del control de
  topes, así que dura `asistente_llamada.ms + msTopes` (± 5 ms entre relojes).

### 7.2 Los eventos del stream (`ClienteBedrock.stream`)

```ts
onEvento: (cb) => {
    const seguro = (e: EventoStreamModelo) => { try { cb(e); } catch { /* el medidor nunca rompe el stream (§0.2) */ } };
    s.on('connect', () => seguro({ tipo: 'conexion' }));
    s.on('streamEvent', (ev) => {
        try {
            switch (ev.type) {
                case 'message_start': return seguro({ tipo: 'inicio_mensaje' });
                case 'content_block_start': {
                    const b = ev.content_block;
                    const bloque = b.type === 'thinking' || b.type === 'redacted_thinking' || b.type === 'text' || b.type === 'tool_use' ? b.type : 'otro';
                    return seguro({ tipo: 'inicio_bloque', indice: ev.index, bloque, ...(b.type === 'tool_use' ? { herramienta: b.name } : {}) });
                }
                case 'content_block_stop': return seguro({ tipo: 'fin_bloque', indice: ev.index });
                case 'message_stop': return seguro({ tipo: 'fin_mensaje' });
                default: return;   // deltas y message_delta: nada
            }
        } catch { /* ídem */ }
    });
},
```

- Se suscribe **después** de `messages.stream()` y **antes** de `finalMessage()`, igual que `onTexto` hoy
  [V `turno/llamada-modelo.ts:84-88`]. `connect` no puede llegar antes: la respuesta HTTP no llega en el mismo tick.
- `ClienteAnthropic` es un tipo propio con un `as unknown as` [V `asistente-modelo.service.ts:59`]: `tsc` no compara los
  nombres de evento con el SDK. Por eso `cliente-modelo.spec.ts` corre contra un `MessageStream` **real** del SDK,
  alimentado con `MessageStream.fromReadableStream` [V `MessageStream.d.ts:58`] (§14.1).
- El `nombre` del `tool_use` pasa por la lista cerrada de herramientas de la función. Si no está: `'otra'`.

### 7.3 Una llamada (`nodosDeLlamada`, puro)

**Lo que junta el medidor de una llamada (`TrazaLlamada`):**
- `tInicio`: al crearla, antes de los topes;
- `tStream`: después de los topes;
- `tConexion`, `tPrimerEvento`;
- por bloque: `{indice, tipo, herramienta?, inicio, fin?}`;
- `tFin`: al resolver o rechazar `finalMessage`;
- lo que pasa `llamarModelo` en `cerrar`: `uso`, `costo` (lo que devolvió `registrarLlamada`), `stopReason`, `error`,
  `tokensEstimados` (abortada: `usoAbortado`) y `largos: {indice, tipo, caracteres}[]`;
  - los largos salen de `msg.content`, o de `stream.parcial()?.content` si se abortó: el largo del texto, o de
    `JSON.stringify(input)` en un `tool_use`;
  - **solo el número**.

**7.3.1 Tramos.** Los hijos de la llamada **son contiguos y suman exactamente la llamada:**
1. `espera` = `[tInicio, inicio del primer bloque)`, o `[tInicio, tFin]` si no hubo bloques.
2. Los bloques se ordenan por `inicio` y se agrupan:
   - `thinking` y `redacted_thinking` seguidos → un `razonamiento`;
   - `text` seguidos → una `respuesta`;
   - cada `tool_use` → un `pedido` con su `nombre`;
   - `otro` → se suma al tramo anterior.
3. Cada tramo va desde su inicio hasta el inicio del tramo siguiente. El último, hasta `tFin`: incluye `message_delta`,
   `message_stop` y la resolución de `finalMessage`, que son milisegundos.
4. Un bloque sin `fin` (se abortó o falló a mitad) queda con `cortado: true`.
5. Si no llegó ningún evento de bloque y hubo salida (`uso.salida > 0`): `sinDesglose: true` y un solo hijo, la espera.
   Es el caso de los dobles sin `onEvento` y de un medidor que falló.

**7.3.2 La espera:**
- `msConexion = tConexion − tInicio`;
- `msPrimerEvento = tPrimerEvento − tInicio`;
- `msTopes = tStream − tInicio`.

Una espera larga con `msConexion` largo quiere decir que **Bedrock tardó en aceptar o el SDK reintentó**: `maxRetries: 2`
[V `asistente-modelo.service.ts:54`] y, con timeout, puede llegar a 3 veces el timeout. Con `msConexion` corto y
`msPrimerEvento` largo, el modelo tardó en procesar la entrada. La wiki lo explica (§17.1).

**7.3.3 Tokens:**
- `espera.tokens` = el prompt: `entrada + cacheLectura + cacheEscritura5m + cacheEscritura1h` (`tokensPrompt`
  [V `modelo/precios.ts:53-55`]), exacto. El panel muestra además el % leído de caché.
- `razonamiento.tokens` = `uso.thinking`, exacto si hay un solo tramo de razonamiento. Con varios (el razonamiento
  intercalado entre pedidos), se reparte por la duración de cada tramo: `estimado: true`.
- `salidaVisible = max(0, uso.salida − uso.thinking)`. Se reparte entre los tramos `respuesta` y `pedido` por sus
  caracteres. Exacto si hay un solo tramo. Si los caracteres suman 0, en partes iguales y estimado.

**7.3.4 Costo.** `llamada.costoUsd` = el costo devuelto por `registrarLlamada`: **el mismo número que guarda
`asistente_llamada`**. Adentro, con el precio del turno (`MedicionService.precioDe(modelo)`, resuelto una vez en
`preparar`):

```
t = tarifa que aplicó (la "larga" si tokensPrompt(uso) > umbralLargo, como calcularCosto [V `modelo/precios.ts:117-128`])
costo de cada tramo de salida = tokens × t.salida / 1e6        (razonamiento, respuesta, pedido)
espera.costoUsd = llamada.costoUsd − Σ tramos de salida          (la entrada: lo que se paga por leer el pedido)
```

- Si la resta da menos de 0 por el redondeo a 6 decimales, se recorta a 0.
- **Los hijos suman la llamada** (±0,000001).
- Sin precio (no debería pasar: sin precio no se llama, pausa `SIN_PRECIO`), los hijos van sin costo y la llamada con
  el suyo.
- Los costos repartidos por estimación heredan el `estimado` de sus tokens.

**7.3.5 La regla de fusión (el caso de §0.3).** Si `uso.thinking ≥ 50` y los tramos de razonamiento suman menos de 50 ms,
o no hubo ningún bloque de razonamiento:
- se quitan esos tramos (su tiempo, de milisegundos, pasa a la espera);
- se agrega un nodo `razonamiento` con `sinTiempoPropio: true`, `ms: 0`, ubicado al final de la espera, con sus tokens
  y su costo;
- la espera lleva `incluyeRazonamiento: true`.

El panel dice "Espera del primer token (incluye el razonamiento)" y, en el razonamiento, "—" en vez de un tiempo. **Si
M-1 da que Bedrock separa los tiempos, esta regla casi nunca actúa**, y cuando actúa es correcta.

**7.3.6 La clase del error (`claseDeError`, en `llamada-modelo.ts`):**

```ts
export function claseDeError(err: unknown): string {
    const e = err as { name?: unknown; constructor?: { name?: unknown } } | null;
    const propio = typeof e?.name === 'string' && e.name !== 'Error' ? e.name : null;          // errores de AWS: 'AccessDeniedException'
    const clase = typeof e?.constructor?.name === 'string' && e.constructor.name !== 'Error' ? e.constructor.name : null; // SDK: 'APIConnectionTimeoutError'
    return (propio ?? clase ?? 'Error').slice(0, 120);
}
```

- Se usa en `registrarLlamada({ error })`: desde ahora, `asistente_llamada.error` distingue un timeout de un 429.
- El test actual [V `turno/llamada-modelo.spec.ts:71-77`] sigue pasando: `name: 'AccessDeniedException'` gana.
- El nodo: `fin` = `'timeout'` si la clase es `APIConnectionTimeoutError`; `'abortada'` si se abortó; `'error'` en otro
  caso. `error` = la clase.

**7.3.7 Topes que cortan antes de llamar.** Si `verificarIteracion` lanza `TopeError`, `llamarModelo` llama a
`traza.cortadaPorTope(codigo)` y relanza. El nodo queda:
- con `fin = 'tope_turno' | 'tope_mensual' | 'tope_funcion'`;
- `ms` = lo que tardó el control;
- sin hijos ni costo.

El panel lo muestra como "Llamada 3: no se hizo (tope de gasto de la respuesta)".

### 7.4 Las herramientas

```ts
const th = e.traza?.herramienta(b.name, RECURSO_HERRAMIENTA[b.name]);   // inicio
const r = ejecutar(b.name, b.input, b.id);                              // (reportes: await)
th?.cerrar({ esError: r.esError, caracteresResultado: r.content.length }); // fin
```

- **`RECURSO_HERRAMIENTA`:**
  - `leer_pagina` y `buscar_en_wiki`: `wiki`;
  - `ofrecer_ir_a` y `ver_otra_hoja`: `memoria`;
  - `valores_de_campo`, `datos_adicionales`, `probar_plantilla` y `mostrar_propuesta`: `base`.

  Una herramienta que no está queda sin `recurso`: no se rompe nada.
- **`descripcion`** (§8.2):
  - en reportes, el texto del **último paso que emitió esa herramienta** (`emitirPaso` → `th.describir(p)`);
  - en la ayuda, el que arma `ejecutar`, que ya tiene el título de la página o la etiqueta de la pantalla;
  - si devolvió `is_error` sin paso: "Le devolvió un error al modelo".

  `estado`: el del paso, o `error` si `esError`.
- **`tokensResultado` = `ceil(caracteresResultado / 3)`,** estimado: la misma regla que `usoAbortado`
  [V `turno/llamada-modelo.ts:38-40`]. El panel lo muestra como "≈ N tokens a la llamada siguiente". **Sin USD** (D-4):
  - esos tokens se pagan como entrada de la llamada siguiente (casi siempre como escritura de caché, porque el
    breakpoint rodante va en el último bloque del último `user` [V `prompt/armar-request.ts:234, 269`, Fase A §7.2.6]);
  - y ese costo **ya está** en la espera de esa llamada: mostrarlo dos veces haría que la suma no cierre.
- **Las partes (`th.parte(tipo)` devuelve la función que la termina):**
  - en `probar_plantilla`:
    - `validacion`, alrededor de `validarPropuesta` [V `turno-reportes.runner.ts:534-543`];
    - `espera_base`, alrededor de `semaforo.adquirir` [V `prueba-propuesta.service.ts:99`];
    - `muestra` y `conteo`, cada una alrededor de su promesa dentro del `Promise.all`
      [V `prueba-propuesta.service.ts:108-111`]: **se solapan**;
  - con el conteo vencido por timeout, `conteo` dura lo que esperó (15 s) y la muestra lo suyo: la cascada muestra
    exactamente eso.
- **Paralelo.** Los nodos guardan su propio intervalo. Si una función ejecuta herramientas con `Promise.all`, cada una
  abre y cierra su `TrazaHerramienta` y quedan solapadas. El panel marca "en paralelo" a los hermanos que se solapan
  (§12.3). No hace falta nada más.
- Una herramienta que lanza (un bug) queda abierta y `armar` la cierra con `cortado: true` (§7.7).

### 7.5 Preparación y cierre

| Nodo | Desde | Hasta | Dónde se marca |
|---|---|---|---|
| `preparacion` | `t0` | el inicio de la primera llamada, o el de `guardar` si no hubo ninguna | `TrazaTurno` |
| └ `topes` | antes de `topes.verificarInicio` | después | `asistente.service.ts:151` |
| └ `historial` | antes de buscar la persona | después de `crearTurno` | `asistente.service.ts:152-164` |
| └ `contexto` | al empezar `ejecutar` | el inicio de la primera llamada | `asistente.service.ts:238-268` (en reportes cubre `armarRunnerReportes`, adjuntos, la última propuesta, `vocabularios.preparar` y el armado del runner [V `:214-220`, `turno-reportes.runner.ts:220-292`]) |
| `guardar` | después de que vuelve el runner | después de `finalizarTurno` y `asignarCosto` | `asistente.service.ts:269-281` |

- El total del turno es `t0` → fin de `guardar`. La escritura del detalle **no** está adentro: es la medición midiéndose.
  Se loguea en `debug` con su tiempo.
- `primerTextoMs`: el servicio envuelve `emitir` y marca el primer evento `texto`. En reportes sale al final, porque el
  texto se manda una sola vez [V `turno-reportes.runner.ts:500`].

### 7.6 Los huecos (`completarHuecos`, puro)

En cada nivel con hijos, se calcula la unión de los intervalos de los hijos (contando los solapados una sola vez) y, por
cada hueco de **100 ms o más** entre `desde` y `hasta`, se agrega un nodo `otros` en su lugar. Así:
- lo que nadie mide no queda escondido. Ejemplos: el armado del contexto en la ayuda si la wiki tarda, el
  post-procesamiento del texto o una espera que se agregue mañana;
- en la vista textual se suma casi exacto: los huecos de menos de 100 ms quedan sin nombre y la diferencia se ve en las
  barras.

Los tramos de una llamada no pasan por acá: ya son contiguos (§7.3.1).

### 7.7 Armado, guardado y envío (`asistente.service.ts`)

```
ejecutar():
  traza.parte('contexto')
  resultado = runner.correr({..., traza, emitir: emitirMedido})
  parte('guardar'): finalizarTurno; asignarCosto
  detalle = traza.armar({ estado: resultado.estado })            // puro; si lanza: warn, detalle = undefined
  si detalle: t = reloj(); guardarTraza(mensajeId, recortarDetalle(detalle)) en try/catch → warn; debug con ms y bytes
  log 'Turno asistente N terminado … en Xms' + resumenParaLog(detalle)
  emitir(fin|error, { …, ...(verDetalle && detalle ? { detalle } : {}) })
catch (e):
  traza.motivo('interno'); marcarError; detalle = traza.armar({ estado: 'error' }); guardarTraza (try/catch)
  emitir(error, { codigo:'INTERNO', …, ...(verDetalle && detalle ? { detalle } : {}) })
finally: turnos.liberar
```

- **`verDetalle = permisos.includes('asistente.ver_detalle')`**, del JWT que entró en `preparar`. **La traza se arma y se
  guarda siempre,** tenga o no el permiso quien pregunta: así Consumo tiene muestras de todos y, si se le da el permiso
  después, ve sus respuestas de antes.
- **Se guarda antes de mandar `fin`:** el detalle que se ve es el mismo que queda guardado, y reabrir la conversación
  enseguida no encuentra un hueco. Cuesta una escritura de una fila, unos milisegundos.
- **`armar` nunca lanza.** Cierra lo que haya quedado abierto en el instante de armar, con `cortado: true`. Calcula
  `costoUsd` como la suma de los costos de las llamadas y `llamadas` como la cantidad de llamadas que se hicieron (sin
  las cortadas por tope antes de llamar).
- **El medidor nunca lanza:** cada método público está envuelto. Ante una excepción interna:
  - marca `incompleto: true`;
  - loguea **una vez por turno** `warn: No se pudo medir el turno N: <mensaje>`;
  - sigue.
- **Log de cierre**, para CloudWatch, sin la pantalla:
  `Turno asistente 412 terminado estado=ok llamadas=2 costo=$0.0265 en 18400ms (prep 300 · modelo 13100 · herramientas 4800 · guardar 100)`.
  No lleva ninguna descripción ni nombre de página.

### 7.8 El costo de medir

- **Por evento del stream:** un `switch` sobre el tipo. Los deltas, que son la mayoría (cientos por llamada), salen en la
  primera comparación. Solo los inicios y fines de bloque llaman a `performance.now()`. Menos de 1 ms por llamada.
- **Por turno:** de 10 a 60 objetos, `armar` en menos de 1 ms (criterio: 200 nodos en menos de 20 ms en jest), una
  escritura de una fila y de 2 a 6 KB más en `fin`, solo para quien tiene el permiso.
- **En el navegador:** un `POST` chico después de `fin`, sin `await` en el camino de la respuesta.

### 7.9 Respuestas sin `traza` (`detalleDesdeLlamadas`, puro)

Cuando un mensaje del asistente no tiene `traza` y no está `en_curso`:
- puede ser de antes de esta funcionalidad;
- puede ser que falló guardar el detalle;
- o se reinició el servidor a mitad.

`ConversacionesService` trae sus llamadas con **una sola consulta para toda la conversación**:
`asistente_llamada.findMany({ where: { mensajeId: { in: ids } }, orderBy: { id: 'asc' } })`. Va solo si hay alguno y
solo con el permiso. Se arma:
- **una llamada por fila,** con `numero = iteracion + 1`, `ms`, el costo exacto, el `uso` y `fin`
  (`stopReason`, o `'abortada'`/`'error'` según `error`);
- **la posición, por `createdAt`,** que es el fin de la llamada (`DATETIME(3)`, con milisegundos):
  `desdeMs = (createdAt − ms) − (createdAt₀ − ms₀)`;
- **sin tramos.** Si `tokensThinking > 0`, un hijo `razonamiento` con `sinTiempoPropio`, sus tokens y su costo;
- **los huecos de 100 ms o más** entre llamadas → `sin_detalle` ("Herramientas y otros, sin detalle");
- `totalMs` = el mayor entre `mensaje.ms` y el fin de la última llamada;
- `parcial: true`, `motivo` = `'sin_terminar'` si `estado = 'error'` y el texto está vacío (el barrido de mensajes
  `en_curso` vencidos [V `conversaciones.service.ts:65-72`]); si no, `null`;
- sin llamadas: `detalle: null`.

Un mensaje `en_curso` da `detalle: null`: todavía no hay nada para mostrar.

### 7.10 El tiempo percibido (navegador)

En `AsistenteContext.enviar` [V `frontend/src/context/AsistenteContext.tsx:287`]:
- `t0 = performance.now()` al entrar, que es el clic en Enviar o el Enter;
- en `alEvento`:
  - el primer `texto`, `herramienta`, `paso`, `accion` o `propuesta` → `primeraSenalMs`;
  - el primer `texto` → `primerTextoMs`;
  - `fin` o `error` → `totalMs`.
- **Se pega al detalle de la burbuja enseguida,** si llegó un `detalle`.
- **Se manda** `POST /asistente/mensajes/:id/tiempos` sin esperar y con `silencioso: true`. Si falla, no pasa nada.
  - Va **siempre**, haya o no permiso (D-6), y solo si `fin` o `error` trajeron un `mensajeId` positivo.
  - **No se manda con Detener:** ese total no es "lo que tardó la respuesta".
- **Del lado del servidor:** `updateMany({ where: { id, usuarioId, rol: 'asistente', estado: { not: 'en_curso' }, createdAt: { gte: hace 30 min }, tiemposNavegador: { equals: Prisma.DbNull } }, data: { tiemposNavegador } })`.
  - Si `count` da 0, distingue entre "ya estaba", que devuelve `204`, y "no es tuyo o no existe", que devuelve `404`,
    con un `findFirst`.
  - [S] el filtro `equals: Prisma.DbNull` sobre un `Json?` en MySQL. Si Prisma no lo acepta, `findFirst` y después
    `update` condicionado por `id`, con la carrera aceptada: la primera que llega gana casi siempre y las dos son de la
    misma persona.

### 7.11 Los agregados de Consumo (`MedicionService.tiempos`, `tablaDeTiempos`)

1. **Lee** `asistente_mensaje.findMany({ where: { rol: 'asistente', createdAt: rango del mes (hora AR, rangoDelMes), NOT: { traza: { equals: Prisma.DbNull } } }, select: { traza: true, tiemposNavegador: true }, orderBy: { id: 'desc' }, take: 5001 })`.
   Con 5.001 filas, se usan 5.000 y va `recortado: true`.
2. **`muestrasDeDetalle(detalle)`** devuelve `[{funcion, paso, herramienta, ms}]`:

   | Paso | Cuenta | No cuenta |
   |---|---|---|
   | `total` | `totalMs` | respuestas que no terminaron `ok` |
   | `navegador_total`, `navegador_primer_texto` | `tiemposNavegador` | `null` |
   | `preparacion`, `guardar` | su nodo | — |
   | `llamada` | cada llamada | `fin` `abortada` o `tope_*`, `cortado` |
   | `espera`, `razonamiento`, `respuesta`, `pedido` | cada tramo | `cortado`, `sinTiempoPropio` |
   | `herramienta` (por `nombre`) | cada herramienta | `cortado` |

   Las partes de `probar_plantilla` no entran en la tabla: están en el detalle de cada respuesta.
3. **`percentil(ordenados, p)`,** por rango más cercano: `ordenados[ceil(p × n) − 1]`. La mediana es `p = 0,5`.
4. **Las funciones** salen de `asistente_funcion` (nombre legible). Una `funcion` de la traza que no esté ahí va con su
   clave como nombre.
5. **El orden de las filas** es fijo: `total`, `navegador_total`, `navegador_primer_texto`, `preparacion`, `llamada`,
   `espera`, `razonamiento`, `respuesta`, `pedido`, las herramientas por nombre y `guardar`. Las filas sin muestras no
   van.
6. **Log** `debug`: `Tiempos del asistente {mes}: N respuestas en Xms`.

---

## 8. Privacidad

### 8.1 Qué entra y qué no

| Entra al detalle | No entra nunca |
|---|---|
| Nombres de tipo de paso y de herramienta (de la lista cerrada de la función) | El texto del razonamiento (con `display: omitted` llega vacío, pero el medidor ni lo mira) |
| Tiempos, tokens y costos | Los argumentos de las herramientas (`tool_use.input`) |
| La descripción de cada herramienta, armada por el backend (§8.2) | Los resultados (`tool_result.content`): solo su **largo** |
| La clase del error del SDK y el `stop_reason` | La pregunta, el texto de la respuesta, los datos de las propuestas |
| El modelo y la función | El mensaje del error (puede traer el request) |

**Por construcción:**
- `EventoStreamModelo` no tiene texto;
- `cerrar` recibe largos, no contenido;
- `NodoDetalle` tiene un solo campo de texto libre, `descripcion`, y lo llenan solo los runners con textos fijos.

### 8.2 Las descripciones

- **Reportes:** el texto del `Paso`, el mismo que ya ve la persona y que se guarda en `pasos`. Esos textos no llevan
  valores [V `asistente-reportes-spec.md §6.2`]. El nombre de la hoja ya pasa por `encabezadoSeguro` [V §26.1].
- **Ayuda:**

  | Herramienta | Descripción |
  |---|---|
  | `leer_pagina` | `Leí «{título de la página}»` (del índice de la wiki), "Ya estaba en la conversación", "Pidió una página que no existe" o "Ya había leído tres páginas" |
  | `buscar_en_wiki` | "Busqué en la documentación". **Nunca el texto buscado**, igual que el evento `herramienta` [V `turno-runner.ts:338-339`] |
  | `ofrecer_ir_a` | `Ofrecí ir a «{etiqueta del catálogo}»` o "No se mostró la tarjeta" (sin el motivo, que trae la ruta pedida) |

- **Recorte:** 160 caracteres, por *code points* (el arreglo del título de la Fase A §23.5).

### 8.3 Quién lo ve

- **La persona,** sus respuestas, si tiene `asistente.ver_detalle`.
- **Quien administra,** las 👎 de cualquiera, si tiene `asistente.administrar` **y** `asistente.ver_detalle`. Ya ve la
  pregunta y la respuesta (Fase A, D-6); el detalle agrega nombres, tiempos y costos.
- **La tabla de tiempos de Consumo,** con `asistente.administrar`: son agregados sin contenido (D-3).

### 8.4 Test de privacidad (`turno/traza.privacidad.spec.ts`)

Un turno de reportes y uno de ayuda con el doble, con estos valores sensibles:
- un DNI en la pregunta;
- un razonamiento con texto (el doble simula `display: summarized`);
- argumentos con un CUIT y un mail;
- un `tool_result` con un nombre y un teléfono.

Ninguno aparece en `JSON.stringify(detalle)` ni en el log de cierre.

---

## 9. Turnos que no terminan bien

| Caso | Qué hace hoy el runner | Qué queda en el detalle | `motivo` |
|---|---|---|---|
| **Detener** a mitad de una llamada | `abortada` → `cortado` [V `turno-runner.ts:431-435`, `turno-reportes.runner.ts:419-425`] | La llamada con `fin: 'abortada'`, el bloque abierto con `cortado`, los tokens con `≈` (`usoAbortado`). Después, `guardar`. El navegador ya cortó: **se ve al reabrir** la conversación | `detenida` |
| Detener mientras corre una herramienta | La herramienta termina (no recibe el `signal`); la llamada siguiente se aborta enseguida | La herramienta completa y una llamada de ~0 ms `abortada` | `detenida` |
| Error del modelo (429 o 500 después de los reintentos) | `fallo` → `error MODELO_NO_DISPONIBLE` [V `turno-runner.ts:436-444`] | La llamada con `fin: 'error'`, `error: 'RateLimitError'`, y la espera es todo. `error` por SSE con el detalle | `modelo_no_disponible` |
| Timeout (60 s en la ayuda, 120 s en reportes, con reintentos) | Ídem | `fin: 'timeout'`, `error: 'APIConnectionTimeoutError'`. La espera puede ser de hasta 3 × el timeout, con `msConexion: null` | `timeout` |
| Tope por respuesta a mitad | `TopeError TOPE_TURNO` antes de la llamada N [V `turno-runner.ts:408-423`, `turno-reportes.runner.ts:398-410`] | La llamada N "no se hizo", con `fin: 'tope_turno'`. Estado `cortado`, u `ok` si ya estaba la tarjeta o la fuente | `tope_turno` |
| Tope mensual o de la función a mitad | `error TOPE_MENSUAL`/`TOPE_FUNCION` | Ídem, con `fin: 'tope_mensual'`. `error` por SSE con el detalle | `tope_mensual` / `tope_funcion` |
| `refusal` | `rechazado` [V `turno-runner.ts:461-469`] | La llamada con `fin: 'refusal'` | `rechazo` |
| `max_tokens` | `cortado` sin ejecutar herramientas [V `:471-480`] | La llamada con `fin: 'max_tokens'`. El último tramo (a veces un `pedido`) queda `cortado` | `max_tokens` |
| `pause_turn` u otro | `cortado` | Ídem, con su `fin` | `otro_corte` |
| Iteraciones agotadas | `cortado` [V `:507-511`] | Todas las llamadas y herramientas | `iteraciones` |
| Corte después de la tarjeta | `ok` sin otra llamada [V `:500-505`, `turno-reportes.runner.ts:481-486`] | Termina en la herramienta | `tarjeta` |
| **Respuesta vacía** (solo razonamiento o texto en blanco) | `ok` con `TEXTO_VACIO` [V `turno-runner.ts:452-456, 529`, `turno-reportes.runner.ts:440-449`] | El razonamiento con sus tokens y nada más. **El panel lo marca**: "El modelo no devolvió texto" | `respuesta_vacia` |
| `PROMPT_DEMASIADO_GRANDE` (reportes) | `error` antes de llamar [V `turno-reportes.runner.ts:283-292`] | Solo la preparación. `error` por SSE con el detalle | `prompt_demasiado_grande` |
| Excepción interna (el runner lanza) | `catch` → `marcarError` [V `asistente.service.ts:310-317`] | Lo que alcanzó a medir, con lo abierto `cortado` | `interno` |
| El proceso muere a mitad | `en_curso` → `error` al arrancar | Sin `traza`: se reconstruye desde las llamadas, `parcial` | `sin_terminar` |
| Falla guardar el detalle | — | `warn`. `fin` lleva el detalle igual. Al reabrir, el reconstruido y `parcial` | lo que corresponda |
| Falla el medidor (un bug) | — | `incompleto: true`, `warn` una vez | lo que corresponda |

En el panel, cada `motivo` tiene una línea en la cabecera del detalle (§12.3): "La detuviste a los 6,2 s", "Cortada por
el tope de gasto de la respuesta (USD 0,30)", etc.

---

## 10. La relación con los `pasos` de reportes

**Van separados.** Los `pasos` son de la persona: cuentan qué hizo el asistente y los ve todo el que usa la función. El
detalle es para monitorear y lo ve quien tiene el permiso. Unificarlos haría que lo que ve todo el mundo dependa de un
permiso, o que el detalle se filtre.

- **`pasos` no cambia ni un byte.** Ni el evento `paso`, ni `fin.pasos`, ni la columna. Test: un turno de reportes con y
  sin `traza` da los mismos `pasos`, `texto`, `apiAsistente`, `propuestas` y `params` de cada llamada.
- **Lo que comparten:** el texto del paso pasa a ser la `descripcion` de la herramienta en el detalle, sin cambiar.
- **En la burbuja,** los pasos siguen arriba, como hoy. El "Ver detalle" va abajo, después de 👍/👎, y solo con el
  permiso y el interruptor encendido.

---

## 11. Cómo se enchufa una función nueva (cartera, Fase 1b)

Nada del código del detalle pregunta qué función es. Para que `cartera` tenga detalle, su runner hace lo mismo que los
otros dos, y nada más:
1. Recibe `traza?: PuertoTraza` en su entrada y llama a `llamarModelo` con `traza: e.traza?.llamada(iter)`.
2. Envuelve cada herramienta con `e.traza?.herramienta(nombre, recurso)` … `.cerrar(…)`. `recurso` va como argumento o
   en `RECURSO_HERRAMIENTA`. Si su `emitirPaso` llama a `th.describir(p)`, la descripción sale sola.
3. Llama a `e.traza?.motivo(…)` en cada salida del loop (los `MotivoFin` de §6.3 alcanzan; si hace falta uno nuevo, se
   suma a la unión).
4. Si ejecuta herramientas en paralelo, cada una con su `TrazaHerramienta`: el panel las marca solas.

**Lo que ya queda resuelto para cartera:**
- el `funcion` del detalle es `string`;
- la tabla de Consumo agrupa por lo que diga la traza;
- el panel nombra cualquier herramienta por su `nombre`;
- el servicio arma la traza para cualquier función que despache.

Al spec de la 1b solo le corresponde agregar a su plan de pruebas un caso con `traza`. Este spec no toca
`docs/analista-cartera-*.md`.

---

## 12. Frontend

### 12.1 Archivos

| Archivo | Qué |
|---|---|
| `src/types/asistente.ts` | §6.3 copiado |
| `src/api/asistente.ts` | `asistenteApi.tiempos(mensajeId, t)` (`POST`, `silencioso`), `asistenteApi.detalleDeMensaje(id)` y `asistenteApi.tiemposConsumo(mes?)`. El parser **no cambia**: `fin` y `error` ya están en la lista |
| `src/context/AsistenteContext.tsx` | `verDetalle = tienePermiso('asistente.ver_detalle')`. `mostrarDetalle` + `alternarDetalle` (`localStorage['amsa_asistente_detalle']`, `'0'`/`'1'`, encendido por defecto, todo en `try/catch` como `leerModoGuardado` [V `:147-152`]). La medición del navegador (§7.10). En `fin` y `error`, `detalle` en el mensaje. Al reabrir, `detalle` viene de `GET conversaciones/:id` |
| `src/components/asistente/DetalleRespuesta.tsx` (nuevo) | El desplegable y la cascada (§12.3). Props: `detalle`, `abiertoInicial?` |
| `src/components/asistente/formatoDetalle.ts` (nuevo) | Puro: `formatearMs`, `formatearUsd`, `etiquetaNodo`, `textoMotivo`, `nombreModelo`, `seSolapan`, `anchoBarra` |
| `src/components/asistente/MensajeBurbuja.tsx` | Prop `mostrarDetalle`. `<DetalleRespuesta>` al final de la burbuja, después de 👍/👎 [V `:214-248`], si `mostrarDetalle && mensaje.detalle` y el mensaje no está `en_curso` |
| `src/components/asistente/AsistentePanel.tsx` | En el menu [V `:191-202`], con `verDetalle`: un `MenuItem` con `Switch`, "Mostrar el detalle de las respuestas". Pasa `mostrarDetalle` a cada burbuja |
| `src/pages/asistente/TiemposAsistente.tsx` (nuevo) | La tarjeta "Tiempos por paso" de Consumo (§12.4) |
| `src/pages/asistente/AsistenteConsumo.tsx` | Monta `<TiemposAsistente mes>` después de "Por función". En las 👎 [V `:393-428`], con `ver_detalle`, el botón **Ver detalle** |
| `tests/...` | §14.2 |
| `docs/ayuda/...` | §17.1 |

Los componentes nuevos van **sueltos** en `components/asistente/` y `pages/asistente/`, sin subcarpeta, para que
`ancho-360.test.ts` los lea (§0.10).

### 12.2 La maqueta v2 (con los números del caso dorado de §14.1)

Cerrado, debajo de la respuesta:

```
▸ Ver detalle · 18,3 s · USD 0,027
```

Abierto:

```
▾ Ver detalle
Total 18,3 s · USD 0,027 · Sonnet 5.5 · terminó bien
├─ ▸ Preparación                                   0,3 s
├─ Llamada 1                                       6,1 s   USD 0,017
│   ├─ Espera del primer token                     1,2 s   USD 0,010
│   │    lee 14.880 tokens · 76 % de caché
│   ├─ Razonamiento (412 tokens)                   3,4 s   USD 0,0045
│   └─ Pide «probar_plantilla» (180 tokens)        1,5 s   USD 0,0020
├─ Herramienta probar_plantilla (base)             4,8 s
│    Probé la plantilla: 8.412 casos, sin errores · ≈ 310 tokens a la llamada 2
│   ├─ Validación                                < 0,1 s
│   ├─ Espera de lugar en la base                < 0,1 s
│   ├─ Muestra (100 casos) · en paralelo            3,1 s
│   └─ Conteo de casos · en paralelo                4,7 s
├─ Llamada 2                                       7,0 s   USD 0,0096
│   ├─ Espera del primer token                     0,9 s   USD 0,0028
│   │    lee 15.172 tokens · 97 % de caché
│   ├─ Razonamiento (230 tokens)                   3,2 s   USD 0,0025
│   └─ Respuesta (380 tokens)                      2,9 s   USD 0,0042
└─ Guardar                                         0,1 s
En tu navegador: primer texto a los 18,5 s · completa a los 18,6 s
```

**Lo que cambió respecto de la maqueta aceptada,** cada cosa porque lo pide un punto del pedido:
- **la espera lleva el costo de la entrada:** así los hijos suman la llamada (§7.3.4);
- **la preparación se despliega** en topes, historial y armado (cerrada por defecto);
- **`probar_plantilla` muestra la muestra y el conteo en paralelo** (§0.4);
- **la línea del navegador** (§7.10);
- **"USD" con 3 decimales desde 0,01 y con 4 por debajo:** la ayuda cuesta USD 0,0028 por pregunta y con 3 decimales
  todo diría 0,003.

Cada fila tiene, debajo, una **barra de cascada**: una pista del ancho completo y la barra desde `desdeMs/totalMs` con
ancho `ms/totalMs` (mínimo 2 px).

### 12.3 El componente `DetalleRespuesta`

- **Botón** (`Button size="small" variant="text"`, `aria-expanded`, `aria-controls`): "Ver detalle · {total} · {costo}".
  Con `parcial`, "Ver detalle (parcial) · …".
- **Cabecera:** `Total {total} · {costo} · {nombreModelo(modelo)} · {textoMotivo(estado, motivo)}`.
  - `nombreModelo` toma `claude-(haiku|sonnet|opus)-(\d+)-(\d+)` → "Sonnet 5.5"; si no matchea, el id.
  - Un `motivo` que no es `null` va con `color="warning.main"` en `cortado` y `rechazado`, y `error.main` en `error`.
- **Avisos** (`Alert severity="info"`, chico):
  - `parcial`: "Detalle parcial: solo las llamadas al modelo. Pasa con las respuestas de antes de que se midieran los
    pasos, o si no se pudo guardar el detalle.";
  - `incompleto`: "Falta una parte del detalle: no se pudo medir todo.";
  - `recortado`: "El detalle es muy largo: se muestran los primeros pasos.";
  - `respuesta_vacia`: "El modelo no devolvió texto: se mostró el aviso de reemplazo."
- **Árbol:** `<ul>` anidados, sangría de 12 px por nivel.
  - Las llamadas abiertas por defecto; la preparación y las partes de las herramientas, cerradas.
  - Cada fila, una grilla `minmax(0,1fr) auto auto`: etiqueta, tiempo y costo.
  - Debajo, en `caption`: la descripción, la línea de la espera ("lee N tokens · X % de caché") y los
    `tokensResultado`.
  - Al final, la barra con `aria-hidden`.
- **Etiquetas** (`etiquetaNodo`):

  | Nodo | Etiqueta |
  |---|---|
  | `preparacion` | "Preparación" |
  | `topes` | "Topes y límite del día" |
  | `historial` | "Conversación e historial" |
  | `contexto` | "Armado del pedido" |
  | `llamada` | "Llamada N". Con `fin` `tope_*`: "Llamada N: no se hizo ({tope})". Con `abortada`, `timeout` o `error`, la etiqueta más "· detenida", "· no respondió a tiempo" o "· falló ({error})" |
  | `espera` | "Espera del primer token", o "Espera del primer token (incluye el razonamiento)" |
  | `razonamiento` | "Razonamiento (N tokens)"; con `sinTiempoPropio`, el tiempo es "—" |
  | `respuesta` | "Respuesta (N tokens)" |
  | `pedido` | "Pide «nombre» (N tokens)" |
  | `herramienta` | "Herramienta nombre (base \| documentación \| memoria)" |
  | `validacion` | "Validación" |
  | `espera_base` | "Espera de lugar en la base" |
  | `muestra` | "Muestra (100 casos)" |
  | `conteo` | "Conteo de casos" |
  | `guardar` | "Guardar" |
  | `otros` | "Otros (sin medir)" |
  | `sin_detalle` | "Herramientas y otros (sin detalle)" |
  | desconocido | el `tipo` tal cual |

- **Formatos:**
  - `formatearMs`: menos de 50 ms → "< 0,1 s"; si no, 1 decimal con coma ("6,1 s"); desde 100 s, sin decimales.
  - `formatearUsd`: desde 0,01, 3 decimales; desde 0,0001, 4; por debajo, "< USD 0,0001"; 0 o sin costo, nada.
  - "≈" delante si `estimado`, con el texto oculto "aproximado" para el lector de pantalla.
- **Paralelo** (`seSolapan`): los hermanos cuyos intervalos se solapan más de 0 ms llevan "· en paralelo" en la etiqueta.
- **Colores, solo de `theme.palette`:**
  - pista `action.hover`;
  - llamada, espera, respuesta y pedido `primary.main`;
  - razonamiento `secondary.main`;
  - herramientas y sus partes `info.main`;
  - preparación, guardar, otros y sin detalle `text.disabled`;
  - `cortado`, con borde `warning.main`.
- **A 360 px:** `minWidth: 0` en todo, la etiqueta con `overflowWrap: 'anywhere'`, el tiempo y el costo con
  `whiteSpace: 'nowrap'`. Ningún ancho numérico mayor de 280 px fuera de un objeto por breakpoint, como pide
  `ancho-360.test.ts`.
- **Accesibilidad:** cada `<li>` con un `aria-label` que junta la etiqueta, el tiempo y el costo ("Llamada 1, 6,1
  segundos, USD 0,017").

### 12.4 Consumo: la tarjeta "Tiempos por paso" (`TiemposAsistente.tsx`)

- `SectionCard title="Tiempos por paso"` con el subtítulo "Mediana y p95 de cada paso, por función. Salen del detalle
  de las respuestas, que se borra a los 90 días con su conversación."
- **Se carga sola,** con el mes del selector (`asistenteApi.tiemposConsumo(mes)`), aparte del consumo: si falla, un
  `Alert` con **Reintentar** dentro de la tarjeta, y el resto de la pantalla sigue.
- **Una tabla por función** (subtítulo con su nombre). Columnas: "Paso", "Veces", "Mediana" y "p95".
  - Filas con las etiquetas de §12.3, más "Total en el servidor", "Total en tu navegador" (de todos) y "Primer texto en
    el navegador".
  - Las herramientas, como "Herramienta leer_pagina".
- **Vacío:** "Todavía no hay respuestas medidas en {mes legible}." Con `recortado`: "Sobre las últimas 5.000 respuestas
  del mes."
- `TableContainer` con su propio scroll a 360 px.

**Ver detalle en las 👎:**
- con `tienePermiso('asistente.ver_detalle')`, un botón **Ver detalle** al lado de "Ver completa";
- pide `GET /asistente/mensajes/:id/detalle` y muestra `<DetalleRespuesta abiertoInicial>` debajo;
- un 403 o un error, con `notify`;
- **no depende del interruptor del panel**.

---

## 13. Fallos silenciosos

| Qué se puede perder o salir mal sin error | Cómo se nota / qué lo frena |
|---|---|
| Un listener del stream que lanza corta la llamada (§0.2) | `try/catch` en cada callback de `ClienteBedrock`. Test con un callback que lanza: la respuesta sale igual |
| Bedrock manda juntos los eventos del razonamiento y su tiempo se ve como "espera" | Regla de fusión (§7.3.5): "incluye el razonamiento" y "—" en el razonamiento. M-1 dice cuánto pasa |
| Los reintentos del SDK son invisibles: la espera crece hasta 3 × el timeout | `msConexion` en la espera; la wiki explica la "espera muy larga" |
| `asistente_llamada.error` dice "Error" para todo (§0.5) | `claseDeError`. Test con un `APIConnectionTimeoutError` real del SDK |
| El permiso nuevo no aparece en Roles (está solo en el backend) | Los dos catálogos en el mismo commit. El test de sincronía de claves ya existe [V `permisos-catalogo.spec.ts:30-42`] |
| La descripción del permiso miente en Roles: pasa hoy con `asistente.reportes` (§0.6) | Se corrige, y el test nuevo compara etiqueta y descripción de la sección Asistente en los dos catálogos. Queda fuera `telefonia.admin`, que también difiere [V diff de los dos archivos]: anotado en la deuda, no se toca |
| Un `@Permisos` en un método del controller de administración saca `asistente.administrar` (§0.7) | Sin decorador en el método; el segundo permiso, adentro. Test: con `ver_detalle` y sin `administrar` → 403 |
| El detalle le llega a quien no tiene el permiso | Filtro en el servidor. Tests sobre `fin`, `error`, `GET conversaciones/:id` (la clave no existe) y `GET mensajes/:id/detalle` |
| El frontend descarta un evento nuevo sin avisar (§0.8) | No hay evento nuevo: va dentro de `fin` y `error`. Test del panel con `fin` + `detalle` |
| Falla guardar el detalle | `warn`. El panel lo tiene igual en vivo; al reabrir, el reconstruido con el aviso "parcial" |
| Lo que nadie mide queda escondido | Nodo "Otros (sin medir)" en cada hueco de 100 ms o más (§7.6) |
| El detalle crece sin tope | 200 nodos o 48 KB, `recortado` y aviso (§4.4) |
| Los tiempos de un mes viejo desaparecen (90 días) | Subtítulo de la tarjeta, columna "Veces", la wiki. El costo sigue en `asistente_llamada` |
| Las respuestas detenidas o cortadas bajan la mediana | Reglas de exclusión de §7.11, con test |
| El navegador manda dos veces, o de dos pestañas | La primera escritura gana (`tiemposNavegador IS NULL`) |
| Números que no cierran entre el detalle y Consumo | El costo de la llamada es el que devolvió `registrarLlamada`. Test: Σ del detalle = Σ `asistente_llamada` del mensaje. Si el `create` de la llamada falló (ya se loguea `error` con todo [V `medicion.service.ts:82-90`]), el detalle tiene un costo que Consumo no: ese log es la red |
| `pasos` de reportes cambia sin querer | Test de igualdad con y sin `traza` (§10) |
| El pedido a Bedrock cambia | Snapshot de `params-ayuda` con y sin traza, y comparación de `params` en reportes (§14.1) |
| Un componente nuevo desborda a 360 px y la prueba no lo ve (§0.10) | Archivos sin subcarpeta; los nuevos, en la lista de `colores.test.ts` |
| `localStorage` tira (ventana privada) y el interruptor rompe el panel | `try/catch`, encendido por defecto. Test con `localStorage` que tira |
| Un detalle viejo (reconstruido) se toma por completo | Aviso "parcial", tramos sin tiempo y el nodo "sin detalle" en los huecos |
| La llamada del detalle no coincide en ms con `asistente_llamada` | Documentado (§7.1): el detalle suma el control de topes. Criterio con tolerancia |

**Deuda que queda, a sabiendas:**
- **El índice `[rol, createdAt]`,** si la tabla crece. También un `resumen` dentro de la traza que se lea con
  `JSON_EXTRACT`.
- **La descripción de `telefonia.admin`,** distinta en los dos catálogos.
- **El detalle en vivo,** paso por paso mientras corre: no se pidió.
- **Los reintentos del SDK no se cuentan uno por uno:** haría falta un `fetch` propio en el cliente.

---

## 14. Plan de pruebas

### 14.1 Backend — jest + `npm run build` (jest no chequea tipos)

**El doble con tiempos controlados (`turno/doble-stream-con-tiempos.ts`):**

```ts
export class RelojFalso { t = 0; ahora = () => this.t; avanzar(ms: number) { this.t += ms; } }

export interface GuionLlamada {
    /** En qué ms desde que se abre el stream llega cada evento. */
    eventos: { en: number; e: EventoStreamModelo }[];
    /** Deltas de texto: en qué ms y qué texto (para onTexto). */
    textos?: { en: number; delta: string }[];
    /** En qué ms resuelve (o rechaza) finalMessage. */
    duracion: number;
    content: ContentBlock[];
    stop_reason: Message['stop_reason'];
    usage?: Partial<Usage>;
    falla?: Error;                   // p. ej. new APIConnectionTimeoutError() del SDK
    sinEventos?: boolean;            // no implementa onEvento (como los dobles de hoy)
}

/** Avanza el reloj a cada `en` y emite, todo adentro de finalMessage, como el doble de llamada-modelo.spec. */
export class ClienteConTiempos implements ClienteModelo { /* registra params; con signal abortado lanza APIUserAbortError */ }
```

Las herramientas y la base avanzan el mismo reloj desde los puertos del test: por ejemplo, `prueba.probar` hace
`reloj.avanzar(…)` entre sus partes.

**El guion del caso dorado** (ms desde `t0`; Sonnet 5.5 con los precios de `PRECIOS_DEFAULT`). En el doble, cada `en`
es el absoluto menos el ms en que se abrió el stream:

| Qué | Cuándo / cuánto |
|---|---|
| Partes del servicio | `topes` 0→20 · `historial` 20→120 · `contexto` 120→300 |
| Llamada 1 | se crea en 300; `verificarIteracion` avanza 2 (stream en 302) · `conexion` 700 · `inicio_mensaje` 1.400 · `thinking` 1.500→4.880 · `tool_use probar_plantilla` 4.900→6.350 · `fin_mensaje` 6.390 · `finalMessage` en 6.400 |
| Uso de la llamada 1 | entrada 1.180 · caché leída 11.300 · escritura de 5 min 2.400 · salida 592, de la que 412 es razonamiento · `stop_reason: tool_use` · largo del input 540 caracteres |
| Herramienta | 6.400→11.200: `validacion` 0 ms; el doble de la prueba abre `espera_base` y la cierra en el acto, abre `muestra` y `conteo` en 6.400, cierra `muestra` en 9.500 y `conteo` en 11.120, y avanza 80 más. El `tool_result` mide 930 caracteres |
| Llamada 2 | se crea en 11.200 (topes 0) · `conexion` 11.500 · `inicio_mensaje` 12.000 · `thinking` 12.100→15.280 · `text` 15.300→18.150 · `fin_mensaje` 18.190 · `finalMessage` en 18.200 |
| Uso de la llamada 2 | entrada 120 · caché leída 14.700 · escritura de 5 min 352 · salida 610, de la que 230 es razonamiento · `stop_reason: end_turn` |
| Guardar | 18.200→18.300 |
| Medición | el doble devuelve `Number(calcularCosto(uso, precio).toFixed(6))`, como `registrarLlamada` |

| Spec | Casos |
|---|---|
| `turno/detalle.spec.ts` (nuevo, puro) | **Caso dorado:** el guion de §12.2 da exactamente esos `ms`, tokens, costos y `desdeMs`. **Contigüidad:** los hijos de una llamada suman la llamada. **Costos:** espera + tramos de salida = llamada (±1e-6); tarifa larga de Haiku con el prompt > 100.000; sin precio, sin costos en los hijos. **Reparto:** dos tramos de razonamiento → por duración y `estimado`; texto + `tool_use` → por caracteres y `estimado`; un solo tramo → exacto. **Fusión:** `thinking` = 300 con el bloque de 0 ms, y sin bloque de razonamiento → `sinTiempoPropio` + `incluyeRazonamiento`; con 30 tokens no fusiona. **Cortes:** abortada con el bloque abierto → `cortado`; `sinDesglose` sin eventos. **Huecos:** uno de 120 ms → `otros`; uno de 90 ms → nada; los solapados cuentan una sola vez. **Recorte:** 250 nodos → 200 + `recortado`. **Reconstrucción:** 2 llamadas viejas → posiciones por `createdAt`, `sin_detalle` en el hueco, `parcial`, Σ costos; `error` sin texto → `sin_terminar`. **Percentiles:** `[1..20]` → mediana 10, p95 19; `n = 1`; exclusiones de §7.11. **Rendimiento:** 200 nodos armados en < 20 ms |
| `turno/traza.spec.ts` (nuevo) | Partes del servicio y herramientas en el orden real. **Nunca lanza:** métodos fuera de orden (`cerrar` dos veces, un evento después de cerrar, una herramienta sin cerrar), sin llamadas, un `reloj` que lanza → `incompleto` y un solo `warn`. `TRAZA_NULA` no hace nada. Nombre de herramienta fuera de la lista → `'otra'`. `primerTextoMs` |
| `turno/traza.privacidad.spec.ts` (nuevo) | §8.4 |
| `modelo/cliente-modelo.spec.ts` (nuevo) | Contra un `MessageStream` **real** (`MessageStream.fromReadableStream` con los eventos crudos: `message_start`, `thinking` + `signature_delta`, `text` + 2 deltas, `tool_use` `leer_pagina` + `input_json_delta`, `message_delta`, `message_stop`). `onEvento` recibe `conexion, inicio_mensaje, inicio_bloque(0, thinking), fin_bloque(0), inicio_bloque(1, text), fin_bloque(1), inicio_bloque(2, tool_use, leer_pagina), fin_bloque(2), fin_mensaje`, **sin texto ni input**. `onTexto` sigue recibiendo los deltas y `finalMessage` resuelve igual. Un callback de `onEvento` que lanza **no** rompe `finalMessage` |
| `turno/llamada-modelo.spec.ts` | **Los 6 casos de hoy, sin cambios.** Nuevos: con `traza` y un stream con `onEvento`, los eventos llegan a la traza; sin `onEvento`, `sinDesglose`; `TopeError` → `cortadaPorTope` y relanza; `claseDeError` con `APIConnectionTimeoutError`, `RateLimitError` (instancias reales del SDK), `{name:'AccessDeniedException'}` y un `Error` común |
| `turno/params-ayuda.spec.ts` | **El snapshot no se regenera.** Caso nuevo: el mismo escenario con `ClienteConTiempos` (con `onEvento`) y una `TrazaTurno`: los `params` capturados son `toEqual` a los del caso sin traza **y** al snapshot |
| `turno/turno-runner.spec.ts` | **Los casos de hoy, sin cambios.** Nuevos: con `traza`, un turno con `leer_pagina` + `ofrecer_ir_a` → herramientas con su `recurso` y su descripción ("Leí «…»", "Ofrecí ir a «…»"); `buscar_en_wiki` sin el texto buscado; cada `motivo` de §9 (ayuda); el `ResultadoTurno` con y sin traza es igual salvo `ms` |
| `reportes/turno-reportes.runner.spec.ts` | **Los casos de hoy, sin cambios.** Nuevos: el caso dorado del lado del runner; la `descripcion` de cada herramienta = el texto de su último paso; `pasos`, `texto`, `apiAsistente`, `propuestas` y los `params` de cada llamada iguales con y sin traza; `PROMPT_DEMASIADO_GRANDE` → solo la preparación y su motivo; varios `tool_use` en una respuesta → herramientas en orden, sin solaparse |
| `reportes/prueba-propuesta.service.spec.ts` | Con `traza`: `espera_base` con el semáforo ocupado (la 3.ª espera), `muestra` ∥ `conteo` solapadas; el conteo vencido dura su timeout (timers falsos). Sin `traza`, igual que hoy |
| `asistente.service.spec.ts` | `fin` con `detalle` solo con `asistente.ver_detalle` (sin el permiso, `'detalle' in data` es `false`); `error` (`TOPE_MENSUAL` a mitad) con detalle; la traza se guarda también sin el permiso; `guardarTraza` que rechaza → `fin` igual y `warn`; el runner que lanza → `error INTERNO` con detalle `interno`; las partes `topes`, `historial`, `contexto` y `guardar` en orden; el log de cierre con el desglose y sin descripciones |
| `conversaciones.service.spec.ts` | `detalle` con `conDetalle: false` → ningún mensaje tiene la clave; con `true` → `traza` + `navegador`; sin traza → reconstruido con **una** consulta a llamadas para toda la conversación; `en_curso` → `null`; `registrarTiemposNavegador`: la primera gana, ajeno 404, `primerTexto > total` 400, de hace 31 minutos 404 |
| `medicion.service.spec.ts` | `tiempos(mes)` con 3 trazas de dos funciones → filas, orden, mediana y p95 exactos; 5.001 → `recortado`; mes inválido 400 |
| `asistente.controller.spec.ts` | `POST mensajes/:id/tiempos`: la validación del DTO (negativos, más de 900.000, no enteros) y el 204; `GET conversaciones/:id` pasa `conDetalle` según los permisos del JWT |
| `asistente-admin.controller.spec.ts` (nuevo) | `GET mensajes/:id/detalle`: con `administrar` sin `ver_detalle` → 403 `SIN_PERMISO_DETALLE`; con los dos → 200; **la metadata de `@Permisos` del método es `undefined`** (hereda la de la clase: `Reflect.getMetadata`); `GET consumo/tiempos` |
| `auth/permisos-catalogo.spec.ts` | Cuatro permisos del asistente; **nuevo:** etiqueta y descripción de cada permiso de la sección Asistente iguales en los dos catálogos (el parser del front se amplía para leer `label` y `descripcion`) |

Cierre:
- `npx jest src/modules/asistente src/auth` en verde;
- `git diff --exit-code src/modules/asistente/turno/__snapshots__`;
- **`npm run build` OK** (y que `dist` no tenga `doble-stream-con-tiempos.js`);
- no correr `npm run lint` global.

### 14.2 Frontend — vitest con el arnés de `frontend/tests` + `npx tsc --noEmit -p tsconfig.json`

En `tests/lib/banco-ia.tsx`:
- `ev.fin(texto, { detalle })` y `ev.error({ detalle })` ya sirven;
- se suma `detalleIA(over)`, la fábrica del detalle del caso dorado;
- y las rutas `TIEMPOS_MENSAJE`, `DETALLE_MENSAJE` y `TIEMPOS_CONSUMO`.

| Test | Casos |
|---|---|
| `tests/componentes/asistente-detalle.test.tsx` (nuevo) | Con `asistente.ver_detalle`: después de `fin` con detalle aparece "Ver detalle · 18,3 s · USD 0,027"; al abrir, las filas de §12.2 en orden, la preparación cerrada, las barras con `aria-hidden`, "en paralelo" en muestra y conteo, "≈" en lo estimado; `fin` sin `detalle` → no hay botón; sin el permiso, no hay interruptor en el menú; con el interruptor apagado no hay botón y al remontar sigue apagado; con `localStorage` que tira, encendido y sin romper; al reabrir la conversación, el detalle de `GET conversaciones/:id` y, con `parcial`, el aviso; `error` con detalle → la cabecera dice el motivo; `respuesta_vacia` → aviso; **`POST …/tiempos`** después de `fin` con `0 ≤ primeraSenal ≤ total` y `primerTexto ≤ total`, también **sin** el permiso; no se manda con Detener; la línea "En tu navegador" aparece en vivo |
| `tests/unit/formato-detalle.test.ts` (nuevo) | `formatearMs` (49 → "< 0,1 s", 6100 → "6,1 s", 125000 → "125 s"), `formatearUsd` (0,0169 → "USD 0,017", 0,0028 → "USD 0,0028", 0,00004 → "< USD 0,0001"), `nombreModelo`, `seSolapan`, `etiquetaNodo` para cada tipo y uno desconocido, `textoMotivo` para cada motivo |
| `tests/paginas/asistente-consumo.test.tsx` | La tarjeta "Tiempos por paso" con las filas del servidor falso; su 500 no rompe el resto (sigue "Gasto del mes") y tiene Reintentar; vacía → el texto; **Ver detalle** en una 👎 solo con `ver_detalle`, pide `GET mensajes/102/detalle` y muestra el detalle; un 403 → aviso |
| `tests/tema/asistente-tema.test.tsx` | El detalle abierto en claro y oscuro: las barras con los colores de la paleta (`primary`, `secondary`, `info`), sin colores propios |
| `tests/tema/colores.test.ts` | Sumar `DetalleRespuesta.tsx`, `formatoDetalle.ts` y `pages/asistente/TiemposAsistente.tsx` a `ARCHIVOS` |
| `tests/tema/ancho-360.test.ts` | Sin cambios: ya lee las dos carpetas. Comprobar que toma los archivos nuevos |

Cierre: `npm test` en verde, `tsc` sin errores nuevos, `npm run verificar-ayuda` OK.

### 14.3 Prueba manual (local, `AWS_PROFILE=amsa-gestion`, con el OK del usuario por el gasto: M-3)

1. **Sin el permiso, como ADMIN de hoy:** una pregunta de ayuda. No hay "Ver detalle" ni interruptor en el menú. En la
   pestaña de red, `fin` no trae `detalle`.
2. **Darle a ADMIN el permiso** en Roles. Tiene que aparecer con la descripción de §6.5, y **Asistente: armar reportes**
   sin el "Próximamente". Volver a entrar.
3. **"¿Dónde creo una plantilla de reportes?" desde Reportes.** Aparece "Ver detalle · ~5 s · USD 0,00xx". Al abrirlo:
   - Preparación;
   - Llamada 1 con su espera (y la caché);
   - Herramienta leer_pagina (documentación) "Leí «…»";
   - Llamada 2;
   - Guardar;
   - y la línea del navegador.

   El costo del detalle es igual a
   `SELECT SUM(costoUsd) FROM asistente_llamada WHERE mensajeId = <id>`.
4. **En "Armar un reporte",** con `ejemplo_cartera_toyota.xlsx`: "igual a este, de TOYOTA, con más de 90 días de mora".
   La herramienta probar_plantilla (base) tiene la muestra y el conteo en paralelo. Los pasos de arriba son los de
   siempre.
5. **Detener a mitad.** Reabrir la conversación: el detalle dice "La detuviste…" y la llamada tiene "≈".
6. **El interruptor apagado:** desaparece en todas las burbujas. Recargar: sigue apagado.
7. **Una respuesta de antes del deploy** (local: una conversación vieja de la base de desarrollo): "Ver detalle
   (parcial)".
8. **Consumo:**
   - "Tiempos por paso" con las dos funciones;
   - en las 👎 (marcar una), **Ver detalle**;
   - con un usuario con `administrar` y sin `ver_detalle`, la tabla se ve y el botón no.
9. **A 360 px y en oscuro:** el detalle abierto sin scroll horizontal.

---

## 15. Mediciones pendientes (ninguna corrida: todas con el OK del usuario)

| # | Qué decide | Comando | Costo estimado |
|---|---|---|---|
| **M-1** | Si Bedrock manda `content_block_start` del razonamiento al empezar a razonar o junto con el `stop` (§0.3). Si el `tool_use` dura lo que tarda en generarse. Si `usage` trae `output_tokens_details.thinking_tokens` en las dos | `cd backend && AWS_PROFILE=amsa-gestion npx ts-node --transpile-only scripts/asistente-eval/medir-eventos.ts --repeticiones=3` | Menos de **USD 0,05**: 3 llamadas de Haiku 5.5 (~USD 0,0004 cada una) y 3 de Sonnet 5.5 (~USD 0,01 cada una) |
| **M-2** | Que el cambio de la wiki (los `##` nuevos cambian el índice del `system`) y la etiqueta del permiso en el contexto de ADMIN no bajen la ayuda. De paso, las primeras medianas reales por paso | `cd backend && AWS_PROFILE=amsa-gestion npx ts-node --transpile-only scripts/asistente-eval/correr-eval.ts --tope-usd=0.5 --detalle` | ~**USD 0,18** (65 preguntas × USD 0,0028, la media del 19/10) |
| **M-3** | La prueba manual de §14.3 con Bedrock real | (el guion de §14.3) | **USD 0,05 a 0,15** (unas 4 preguntas de ayuda y 2 pedidos de reportes) |
| **M-4** | Tamaño real de la traza y cobertura del navegador en prod, a las 24 h | Por SSM, solo lectura: `SELECT COUNT(*), AVG(LENGTH(traza)), MAX(LENGTH(traza)), SUM(tiemposNavegador IS NOT NULL) FROM asistente_mensaje WHERE rol='asistente' AND createdAt > NOW() - INTERVAL 1 DAY` | 0 |

**`scripts/asistente-eval/medir-eventos.ts`:**
- Usa `AsistenteModeloService` para armar el **mismo** cliente (`AnthropicBedrock`, `maxRetries: 2`).
- Por modelo (`modelo.modelo` y `modelo.modeloReportes`) y repetición, un `messages.stream` con la forma real:
  - `max_tokens` 2048 o 16.000, `output_config: { effort: 'low' }`, sin `thinking`;
  - un `system` corto;
  - una herramienta `anotar({ resultado: string })` (con `strict` si es `runtime`);
  - el mensaje: "Calculá cuántos días hay entre el 3 de marzo y el 19 de octubre de 2026, contando los dos días, y
    anotá el resultado con la herramienta anotar."
- Registra `performance.now()` en `connect` y en cada `streamEvent`: tipo, índice, tipo de bloque y de delta, y la
  cantidad de deltas por bloque.
- **Imprime por llamada:**
  - `connect`, `message_start`;
  - cada bloque (inicio, primer delta, fin);
  - `usage.output_tokens` y `output_tokens_details`;
  - el costo con `calcularCosto`.
- **Imprime el resumen:** "razonamiento con tiempo propio: sí/no (duración media del bloque thinking X ms con Y
  tokens)".
- No escribe nada en la base. Costo acumulado por consola y corte a los USD 0,10.
- **Lectura del resultado:**
  - si el bloque thinking dura más de 100 ms cuando tiene más de 100 tokens, la wiki dice que el razonamiento se mide
    aparte;
  - si no, explica "incluye el razonamiento".

  **El código es el mismo en los dos casos.**

---

## 16. Deploy y controles en prod

1. **Push** (lo hace el usuario). Lleva el `db push` aditivo: dos columnas JSON en `asistente_mensaje`. Sin variables
   nuevas, sin IAM ni Terraform.
2. **En Administración > Roles:** asignar **Ver el detalle de las respuestas del asistente** a ADMIN. Volver a entrar: el
   permiso viaja en el JWT [V `permisos.guard.ts:31-32`].
3. **Verificar:**
   - el arranque sin ERROR;
   - `SHOW COLUMNS FROM asistente_mensaje LIKE 'traza'` y `LIKE 'tiemposNavegador'`: 1 fila cada una;
   - la primera pregunta real:
     - "Ver detalle" en el panel;
     - la línea `Turno asistente N terminado … (prep … · modelo … · herramientas … · guardar …)` en CloudWatch;
     - `SELECT JSON_LENGTH(traza, '$.nodos'), LENGTH(traza), tiemposNavegador FROM asistente_mensaje WHERE id = N`
       con valores;
     - el costo del detalle = `SUM(costoUsd)` de sus llamadas;
   - un OPERADOR no ve "Ver detalle";
   - Consumo → "Tiempos por paso" con "Veces ≥ 1".
4. **A las 24 h:** M-4. Si `AVG(LENGTH(traza))` pasa los 8 KB, revisar qué función infla el detalle.
5. **A la semana:** leer la tabla de tiempos de cada función y anotar las medianas en el CHANGELOG como línea de base.

---

## 17. Documentación

### 17.1 Wiki (paquete FE, en el mismo commit que la pantalla)

- **`docs/ayuda/01-primeros-pasos/04-el-asistente.md`**: sección nueva **`## El detalle de cada respuesta`**, después de
  "Avisar si una respuesta sirvió":
  - quién lo ve (el permiso, volver a entrar) y el interruptor del menú;
  - qué es cada fila: preparación, llamada, espera del primer token (y por qué puede ser larga), razonamiento, respuesta,
    pedido, herramienta y sus partes, guardar y "Otros (sin medir)";
  - **qué es exacto y qué es "≈":** el costo de cada llamada es el que se cobra; el reparto adentro y los tokens de lo
    que devuelve una herramienta son estimados;
  - que una herramienta no cobra mientras corre: lo que devuelve se paga en la llamada siguiente;
  - la línea "En tu navegador";
  - las respuestas viejas, "parcial";
  - **qué nunca muestra:** el razonamiento, lo que buscó ni lo que encontró.

  **En "Qué puede salir mal",** cuatro entradas `###`:
  - "La espera del primer token es muy larga" (Bedrock tardó en aceptar o reintentó);
  - "El razonamiento tiene tokens pero no tiempo" (con el resultado de M-1);
  - "Dice Detalle parcial";
  - "No veo Ver detalle" (permiso, volver a entrar, interruptor).
- **`docs/ayuda/06-administracion/04-consumo-del-asistente.md`:**
  - sección nueva **`## Los tiempos de cada paso`**: la tabla; qué son la mediana y el p95, con un ejemplo; "Veces"; qué
    no cuenta (las detenidas, las cortadas); que sale del detalle y dura 90 días; para qué sirve (qué herramienta o qué
    llamada se volvió lenta);
  - en **"Respuestas con 👎"**, el botón **Ver detalle** y los dos permisos que pide;
  - en "Qué puede salir mal", "La tabla de tiempos está vacía en un mes viejo".
- **`docs/ayuda/06-administracion/01-roles-y-permisos.md`:**
  - "Son tres" → "Son cuatro";
  - el bullet de **Ver el detalle de las respuestas del asistente**: qué muestra, que no muestra contenido, que con
    **Administrar el asistente** abre también el de las 👎, que hay que volver a entrar.
- `cd frontend && npm run verificar-ayuda` OK.
- **Revisión con un agente** antes de cerrar (memoria "Auditar la documentación con agentes").
- **Efecto en el asistente:** los `##` nuevos cambian el índice del `system` cacheado de la ayuda. La primera pregunta
  después del deploy reescribe la caché (unos USD 0,002, una vez, como en Fase A §24.2). Lo cubre M-2.

### 17.2 Lo escribe quien integra

- **`CHANGELOG.md`:** entrada "Asistente de IA: el detalle de cada respuesta, con sus tiempos y su costo", con el
  formato de la Fase B: qué hace, backend, frontend, medido (M-1 a M-3), auditorías, deploy y guion.
- **Este spec:** "§20 Lo que cambió al auditar".
- **`docs/asistente-spec.md` y `docs/asistente-reportes-spec.md`:** una línea en el encabezado de cada uno, "El detalle de
  las respuestas (tiempos y costo por paso) está en asistente-detalle-spec.md", y en §6.3 de la Fase A, que `fin` y
  `error` suman `detalle?`.
- **`CLAUDE.md`:** la línea del índice la agrega el usuario.

---

## 18. Criterios de aceptación

1. `npx jest src/modules/asistente src/auth` en verde, **sin modificar** los casos existentes de `turno-runner.spec.ts`,
   `turno-reportes.runner.spec.ts` y `llamada-modelo.spec.ts`. `git diff` vacío en `turno/__snapshots__/`.
   `npm run build` OK. Del frontend, `npm test`, `tsc` y `verificar-ayuda` OK.
2. `db push` local sin `--accept-data-loss` y `migrate diff` vacío después.
3. **Caso dorado:** con el guion de §14.1 (`RelojFalso` + `ClienteConTiempos`), el detalle tiene exactamente:
   - Preparación 300 ms (topes 20, historial 100, contexto 180);
   - Llamada 1, 6.100 ms, USD 0,016951: espera 1.200 ms (USD 0,010439, `msConexion` 400, `msPrimerEvento` 1.100,
     `msTopes` 2), razonamiento 3.400 ms (412 tokens, USD 0,004532), pedido `probar_plantilla` 1.500 ms (180 tokens,
     USD 0,00198);
   - herramienta 4.800 ms, `tokensResultado` 310, con muestra 3.100 ms y conteo 4.720 ms solapados y ningún nodo `otros`;
   - Llamada 2, 7.000 ms, USD 0,009559: espera 900 ms (USD 0,002849), razonamiento 3.200 ms (230 tokens, USD 0,00253),
     respuesta 2.900 ms (380 tokens, USD 0,00418);
   - Guardar 100 ms;
   - total 18.300 ms y USD 0,02651 (todo con `toBeCloseTo(…, 6)`).
4. **Costos:** en todo turno de los tests, `detalle.costoUsd` = `resultado.costoUsd` = Σ de las llamadas registradas
   (±0,000001), y en cada llamada la espera más los tramos de salida = la llamada.
5. **Pedido intacto:**
   - los `params` de la ayuda con traza son iguales al snapshot;
   - en reportes, `params`, `pasos`, `texto`, `apiAsistente` y `propuestas` con y sin traza, iguales.
6. **Permisos:**
   - sin `asistente.ver_detalle`, `fin` y `error` no tienen la clave `detalle`, ningún mensaje de
     `GET conversaciones/:id` la tiene, y el panel no muestra botón ni interruptor;
   - con `ver_detalle` y sin `administrar`, `GET mensajes/:id/detalle` y `GET consumo/tiempos` dan 403;
   - con `administrar` y sin `ver_detalle`, `GET mensajes/:id/detalle` da 403 `SIN_PERMISO_DETALLE` y
     `GET consumo/tiempos`, 200.
7. **Privacidad:** el test de §8.4 pasa. Ningún valor sensible en el detalle ni en el log.
8. **Robustez:**
   - un callback de `onEvento` que lanza no cambia el resultado del turno;
   - un medidor que lanza da `incompleto: true` y un solo `warn`;
   - `guardarTraza` que falla no cambia `fin`.
9. **Cortes:** cada fila de §9 tiene su test con el `motivo` y el nodo esperados.
10. **Respuestas viejas:** un mensaje sin traza con 2 llamadas da un detalle `parcial` con 2 nodos de llamada y la suma
    de sus costos, con una sola consulta para toda la conversación.
11. **Navegador:**
    - después de `fin`, el panel manda `POST …/tiempos` con números coherentes, también sin el permiso;
    - el servidor guarda solo la primera;
    - ajeno → 404;
    - `primerTexto > total` → 400.
12. **Consumo:** con trazas conocidas, la mediana y el p95 por rango más cercano coinciden. Las detenidas no cuentan
    para el total. La tarjeta que falla no rompe la pantalla.
13. **Tamaño:** un turno de reportes de 8 llamadas y 4 pruebas da menos de 16 KB. 250 nodos → 200 y `recortado`.
14. **Catálogos:**
    - Roles muestra el permiso nuevo con la etiqueta y la descripción de §6.5;
    - `asistente.reportes` sin "Próximamente";
    - el test de la sección Asistente compara las dos copias.
15. **Pantalla:** el detalle abierto, a 360 px y en claro y oscuro, sin scroll horizontal (prueba manual) y con los
    colores de la paleta (test). El interruptor se recuerda y sobrevive a un `localStorage` que tira.
16. **En prod, después del paso 2 de §16:** ADMIN ve "Ver detalle" en su primera respuesta, con el costo igual a
    `SUM(costoUsd)` de sus llamadas; un OPERADOR no lo ve.

---

## 19. Decisiones para el usuario

Si no hay respuesta, se sigue con la recomendada.

| # | Decisión | Opciones | Recomendada |
|---|---|---|---|
| D-1 | Clave y nombre del permiso | `asistente.ver_detalle` "Ver el detalle de las respuestas del asistente" · otro nombre | **La propuesta.** Va en la sección Asistente, después de Administrar |
| D-2 | Quién ve el detalle de una 👎 ajena en Consumo | a) `administrar` **y** `ver_detalle` · b) solo `administrar` | **a**: el permiso nuevo gobierna ver el detalle en todos lados; `administrar` gobierna ver lo de otros |
| D-3 | La tabla de tiempos de Consumo | a) con `administrar` · b) además con `ver_detalle` | **a**: son agregados sin contenido, como el gasto |
| D-4 | El costo de una herramienta | a) "≈ N tokens a la llamada siguiente", sin USD · b) además ≈USD al precio de escritura de caché · c) nada | **a**: ese costo ya está en la espera de la llamada siguiente; mostrarlo dos veces rompe la suma |
| D-5 | El costo de la entrada | a) en la fila "Espera del primer token" · b) solo en un tooltip de la llamada | **a**: los hijos suman la llamada y se ve qué paga la caché |
| D-6 | El tiempo del navegador | a) lo manda el panel de todos · b) solo de quien tiene el permiso | **a**: la tabla de Consumo representa a toda la gente, no a ADMIN |
| D-7 | Las respuestas de antes de esta funcionalidad | a) reconstruidas desde `asistente_llamada`, "parcial" · b) "Sin detalle" | **a**: es lo que se pidió ("visible en las viejas") y no hace falta backfill |
| D-8 | La etiqueta del permiso en el contexto del turno (§0.9) | a) como cualquier permiso: el asistente puede decir si la persona lo tiene · b) excluirla del contexto | **a**, con la regresión M-2 (que hace falta igual por el cambio de la wiki) |
| D-9 | El interruptor | a) encendido por defecto · b) apagado | **a**: quien tiene el permiso lo pidió para mirarlo |
| D-10 | Dónde va en la burbuja | a) al final, después de 👍/👎 · b) antes de 👍/👎 | **a**: no empuja la calificación y en una respuesta en curso no aparece |
| D-11 | Las partes de `probar_plantilla` (validación, espera de lugar, muestra ∥ conteo) | Sí · no | **Sí**: el semáforo y el conteo de 15 s son las demoras que hoy no se ven |
| D-12 | Correr M-1, M-2 y M-3 contra Bedrock | Sí · no | **Sí**, en ese orden, menos de USD 0,40 en total. M-1 puede ir antes de terminar el frontend, porque decide el texto de la wiki |

---

## 20. Lo que cambió al auditar

(Reservado: lo escribe quien integra.)

---

## 21. Los paquetes

Cuatro paquetes.
- **BE-1** va primero: es la base pura.
- **BE-2** y **BE-3** arrancan cuando BE-1 está en verde y no tocan los mismos archivos.
- **FE** va en paralelo desde el día uno, contra el servidor falso: el contrato es §6.

### Paquete BE-1 — el medidor (puro)

**Orden de implementación:**

Paso 1: Los tipos de §6.3 en `dto/asistente.tipos.ts`. Los usa todo lo demás.

Paso 2: `EventoStreamModelo` y `StreamModelo.onEvento?` en `cliente-modelo.ts`, y la implementación en `ClienteBedrock`
con `try/catch` (§7.2), más `cliente-modelo.spec.ts` contra un `MessageStream` real.

Paso 3: `turno/detalle.ts` (puro) con `detalle.spec.ts`, empezando por el caso dorado (§18.3).

Paso 4: `turno/traza.ts` (`TrazaTurno`, `TRAZA_NULA`, `RECURSO_HERRAMIENTA`) con `traza.spec.ts`.

Paso 5: `turno/doble-stream-con-tiempos.ts` y `tsconfig.build.json` (`exclude`).

Paso 6: `llamada-modelo.ts`: `traza?`, los enganches, `cortadaPorTope` y `claseDeError`, más los casos nuevos de su
spec.

Paso 7: `params-ayuda.spec.ts`: el caso con traza contra el mismo snapshot.

**Verificación:**
- `npx jest src/modules/asistente/turno src/modules/asistente/modelo` en verde;
- `git diff --exit-code src/modules/asistente/turno/__snapshots__`;
- `npm run build`, y que `dist/` no tenga `doble-stream`.

### Paquete BE-2 — los runners y la prueba

**Orden de implementación:**

Paso 1: `turno-runner.ts`: `traza?`, `llamada(iter)`, herramientas con su descripción (§8.2), `motivo` en cada salida
(§9). Casos nuevos en su spec. **Los de hoy, sin tocar.**

Paso 2: `turno-reportes.runner.ts`: lo mismo, más `emitirPaso` → `describir`, `validacion` alrededor de
`validarPropuesta`, la herramienta en curso a `PuertoPrueba.probar`, `motivo('prompt_demasiado_grande')`.

Paso 3: `prueba-propuesta.service.ts`: las partes `espera_base`, `muestra` y `conteo`, con su spec.

Paso 4: `traza.privacidad.spec.ts` (§8.4).

Paso 5: Opcional: `--detalle` en `correr-eval.ts` y el script `medir-eventos.ts` (§15), **sin correrlos**.

**Verificación:**
- `npx jest src/modules/asistente` en verde, con los casos de hoy sin modificar (`git diff` de los specs = solo
  agregados);
- `npm run build`.

### Paquete BE-3 — servicio, datos, contratos y permiso

**Orden de implementación:**

Paso 1: `schema.prisma` (§4.2) + `npx prisma db push` + `generate` + `migrate diff` vacío.

Paso 2: El permiso en **los dos** catálogos (§6.5), la descripción de `asistente.reportes` en el del frontend y
`permisos-catalogo.spec.ts` con la comparación de etiquetas y descripciones.

Paso 3: `medicion.service.ts`: `precioDe` y `tiempos` (§7.11), con su spec.

Paso 4: `conversaciones.service.ts`: `guardarTraza`, `detalle(…, { conDetalle })` con la reconstrucción (§7.9),
`registrarTiemposNavegador` y `detalleDeMensaje`, con su spec.

Paso 5: `asistente.service.ts`: el ciclo de la traza (§7.5, §7.7), el filtro `verDetalle`, el `catch` y el log, con su
spec.

Paso 6: Los controllers y `TiemposNavegadorDto` (§6.1). El de administración **sin** `@Permisos` en los métodos nuevos.
`asistente-admin.controller.spec.ts` nuevo.

**Verificación:**
- `npx jest src/modules/asistente src/auth` en verde;
- `npm run build`;
- `curl -N` contra el backend local con un usuario con y sin el permiso: la clave `detalle` aparece y no aparece.

### Paquete FE — panel, consumo y wiki

**Orden de implementación:**

Paso 1: Los tipos (§6.3 copiado) y la API (`tiempos`, `detalleDeMensaje`, `tiemposConsumo`).

Paso 2: `formatoDetalle.ts` con su test unitario.

Paso 3: `DetalleRespuesta.tsx` (§12.3).

Paso 4: `AsistenteContext` (`verDetalle`, interruptor, medición del navegador, `POST tiempos`), `MensajeBurbuja` y el
menú de `AsistentePanel`.

Paso 5: `TiemposAsistente.tsx` y los cambios en `AsistenteConsumo.tsx`.

Paso 6: Los tests de §14.2 y la lista de `colores.test.ts`.

Paso 7: La wiki (§17.1), `npm run verificar-ayuda` y la revisión con un agente.

**Verificación:** `npm test`, `npx tsc --noEmit -p tsconfig.json` sin errores nuevos y `verificar-ayuda` OK.

### Integración (quien orquesta)

1. Merge de los cuatro paquetes.
   - Backend: `npx jest` completo + `npm run build`.
   - Frontend: `npm test` + `tsc` + `verificar-ayuda`.
2. **Con el OK del usuario,** M-1 → ajustar el texto de la wiki según el resultado. Después M-2 y M-3. Anotar los costos
   y las medianas en §20.
3. Auditoría (`auditor`) contra §18 y §13.
4. CHANGELOG y las líneas en los specs de las Fases A y B (§17.2). Commit.
5. Deploy según §16. El push y la asignación del permiso los hace el usuario.

---
## PLAN PARA IMPLEMENTER

**Orden de implementación:**
Paso 1: BE-1, el medidor puro (tipos, `onEvento`, `detalle.ts`, `traza.ts`, el doble con tiempos, `llamada-modelo`).
Va primero porque los runners, el servicio y los tests lo usan, y es donde se prueba que el pedido no cambia.
Paso 2: BE-2, los enganches en los dos runners y en `prueba-propuesta`, sin cambiar ninguna decisión. Se prueba con los
specs de hoy intactos.
Paso 3: BE-3, el schema, el permiso en los dos catálogos, el servicio (armar, guardar, filtrar), la reconstrucción, el
tiempo del navegador y los endpoints.
Paso 4: FE en paralelo desde el paso 1: tipos, el detalle, el interruptor, la medición del navegador, Consumo y la wiki.
Paso 5: Integración, M-1 a M-3 con el OK del usuario, auditoría y deploy.

**Archivos a crear:**
- `backend/src/modules/asistente/turno/traza.ts`, `turno/detalle.ts`, `turno/doble-stream-con-tiempos.ts`;
- `backend/src/modules/asistente/dto/tiempos-navegador.dto.ts`;
- `backend/src/modules/asistente/turno/{traza,detalle,traza.privacidad}.spec.ts`, `modelo/cliente-modelo.spec.ts`,
  `asistente-admin.controller.spec.ts`;
- `backend/scripts/asistente-eval/medir-eventos.ts`;
- `frontend/src/components/asistente/DetalleRespuesta.tsx`, `frontend/src/components/asistente/formatoDetalle.ts`;
- `frontend/src/pages/asistente/TiemposAsistente.tsx`;
- `frontend/tests/componentes/asistente-detalle.test.tsx`, `frontend/tests/unit/formato-detalle.test.ts`.

**Archivos a modificar:**
- `backend/prisma/schema.prisma`: `asistente_mensaje.traza` y `.tiemposNavegador`, `Json?`.
- `backend/tsconfig.build.json`: `exclude` `**/doble-stream-*.ts`.
- `backend/src/modules/asistente/modelo/cliente-modelo.ts`: `onEvento?`, `EventoStreamModelo`, el `ClienteBedrock`
  envuelto.
- `backend/src/modules/asistente/turno/llamada-modelo.ts`: `traza?`, enganches, `cortadaPorTope`, `claseDeError`.
- `backend/src/modules/asistente/turno/turno-runner.ts`: `traza?`, llamadas, herramientas con descripción, motivos.
- `backend/src/modules/asistente/reportes/turno-reportes.runner.ts`: lo mismo, más `describir` desde `emitirPaso`,
  `validacion` y la traza a la prueba.
- `backend/src/modules/asistente/reportes/prueba-propuesta.service.ts`: las partes `espera_base`, `muestra` y `conteo`.
- `backend/src/modules/asistente/asistente.service.ts`: el ciclo de la traza, el filtro por permiso, el `catch` y el log.
- `backend/src/modules/asistente/conversaciones.service.ts`: `guardarTraza`, `detalle` con `conDetalle` y
  reconstrucción, tiempos del navegador, `detalleDeMensaje`.
- `backend/src/modules/asistente/medicion.service.ts`: `precioDe`, `tiempos`.
- `backend/src/modules/asistente/asistente.controller.ts`: `conDetalle`, `POST mensajes/:id/tiempos`.
- `backend/src/modules/asistente/asistente-admin.controller.ts`: `GET consumo/tiempos`, `GET mensajes/:id/detalle`
  (sin `@Permisos` en el método).
- `backend/src/modules/asistente/dto/asistente.tipos.ts`: los tipos de §6.3.
- `backend/src/auth/permisos-catalogo.ts` y `.spec.ts`: el permiso y la comparación de etiquetas y descripciones.
- `frontend/src/utils/permisosCatalogo.ts`: el permiso y la descripción de `asistente.reportes` (en BE-3).
- Opcional: `backend/scripts/asistente-eval/correr-eval.ts`, `--detalle`.
- `frontend/src/types/asistente.ts`: los tipos.
- `frontend/src/api/asistente.ts`: tres llamadas nuevas, el parser igual.
- `frontend/src/context/AsistenteContext.tsx`: `verDetalle`, interruptor, navegador, `detalle` en los mensajes.
- `frontend/src/components/asistente/MensajeBurbuja.tsx`: el detalle al final.
- `frontend/src/components/asistente/AsistentePanel.tsx`: el interruptor en el menú.
- `frontend/src/pages/asistente/AsistenteConsumo.tsx`: la tarjeta de tiempos y "Ver detalle" en las 👎.
- `frontend/tests/lib/banco-ia.tsx`: la fábrica `detalleIA` y las rutas.
- `frontend/tests/paginas/asistente-consumo.test.tsx`, `frontend/tests/tema/asistente-tema.test.tsx`,
  `frontend/tests/tema/colores.test.ts`.
- `docs/ayuda/01-primeros-pasos/04-el-asistente.md`, `docs/ayuda/06-administracion/04-consumo-del-asistente.md`,
  `docs/ayuda/06-administracion/01-roles-y-permisos.md`.

**Cambios de schema:** `asistente_mensaje.traza Json?` y `asistente_mensaje.tiemposNavegador Json?`. Aditivo, sin
índices, sin enums, sin backfill: lo viejo se reconstruye al leer.

**Tests a escribir:**
- `turno/detalle.spec.ts`: caso dorado, contigüidad, costos, repartos, fusión, cortes, huecos, recorte, reconstrucción,
  percentiles y rendimiento.
- `turno/traza.spec.ts`: el orden, nunca lanza, `TRAZA_NULA`, nombres fuera de lista.
- `turno/traza.privacidad.spec.ts`.
- `modelo/cliente-modelo.spec.ts`: contra un `MessageStream` real, sin contenido, un callback que lanza.
- `turno/llamada-modelo.spec.ts`: enganches, `sinDesglose`, `cortadaPorTope`, `claseDeError`.
- `turno/params-ayuda.spec.ts`: con traza = el snapshot.
- `turno/turno-runner.spec.ts` y `reportes/turno-reportes.runner.spec.ts`: herramientas, descripciones, motivos, igualdad
  con y sin traza.
- `reportes/prueba-propuesta.service.spec.ts`: las partes y el solapamiento.
- `asistente.service.spec.ts`: el filtro por permiso, `error` con detalle, la falla al guardar, `interno`, las partes.
- `conversaciones.service.spec.ts`: `conDetalle`, la reconstrucción con una consulta, `en_curso`, los tiempos del
  navegador.
- `medicion.service.spec.ts`: `tiempos`.
- `asistente.controller.spec.ts`: DTO y `conDetalle`.
- `asistente-admin.controller.spec.ts`: 403, la metadata del método y los tiempos.
- `auth/permisos-catalogo.spec.ts`.
- Frontend: `asistente-detalle.test.tsx`, `formato-detalle.test.ts`, `asistente-consumo.test.tsx`,
  `asistente-tema.test.tsx` y `colores.test.ts`.

**Páginas de la wiki a tocar:** `docs/ayuda/01-primeros-pasos/04-el-asistente.md` (sección nueva y 4 entradas de "Qué
puede salir mal"), `docs/ayuda/06-administracion/04-consumo-del-asistente.md` (los tiempos y Ver detalle en las 👎),
`docs/ayuda/06-administracion/01-roles-y-permisos.md` (el cuarto permiso).

**Skills a consultar:**
- `nestjs-module`, `prisma-migration`, `amsa-general` y `react-component`;
- `dataviz`, para las barras de la cascada y la tabla de tiempos;
- `claude-api`, para los eventos de `MessageStream` y `display: omitted`.

**Riesgos durante la implementación:**
- Un listener sin `try/catch` en el stream rompe la llamada (§0.2).
- Un `@Permisos` en un método del controller de administración reemplaza `asistente.administrar` (§0.7).
- El snapshot de `params-ayuda` no se regenera: si falla, el medidor tocó el pedido.
- Los casos de hoy de los specs de los runners y de `llamada-modelo` no se modifican.
- El catálogo del frontend va en BE-3, en el mismo commit que el del backend: si no, falla el test de sincronía.
- `ClienteAnthropic` es un tipo propio con `as unknown as`: los nombres de los eventos se prueban contra el SDK real, no
  con `tsc`.
- `ancho-360.test.ts` no lee subcarpetas: los componentes nuevos van sueltos.
- `Prisma.DbNull` en el filtro de un `Json?` en MySQL [S]: tener el plan B de §7.10.
- `armar` y cada método del medidor envueltos: la respuesta nunca falla por medir.
- No llamar a Bedrock (M-1 a M-3 los autoriza el usuario). No correr `npm run lint` global. No tocar
  `docs/analista-cartera-*.md` ni `CLAUDE.md`.

**Criterios de aceptación:** §18, puntos 1 a 16.
