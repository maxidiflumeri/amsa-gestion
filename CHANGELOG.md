# AMSA Gestión — Changelog de Desarrollo

> Este archivo es el registro de contexto principal para que una IA pueda retomar el trabajo.
> Stack: NestJS + Prisma + MySQL (backend) · React + MUI v5 + TypeScript (frontend)
> Convención DB: `npx prisma db push` (NO `prisma migrate dev` — hay drift histórico)

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
