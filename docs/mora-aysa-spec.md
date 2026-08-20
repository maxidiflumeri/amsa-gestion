# Recargo por mora / deuda actualizada (AYSA) — spec

> Estado: **fases 1, 2 y 4 implementadas y validadas** (backend + frontend). La fórmula está
> **cerrada y verificada al centavo** contra los estados de deuda de la oficina virtual de AYSA y
> contra 15 casos del cedente (§7.3). Quedan dos cosas abiertas, ninguna bloqueante: cómo imputar los
> pagos a las facturas (§8.2) y para qué sirven los tipos 2 y 3 (fase 5).

AYSA actualiza la deuda por mora con un **número índice diario encadenado**, al estilo del CER o el
UVA. No calcula "interés sobre saldo": mantiene una serie de índices y valúa cada factura como la
razón entre el índice de hoy y el índice de su vencimiento.

Todos los meses el cedente manda por mail la **tasa activa de descuento de Documentos Comerciales del
BNA** (2,138% en julio 2026, 2,169% en agosto). Con esa tasa se alimentan tres series.

---

## 1. La mecánica

El CRM del cedente (Visual FoxPro) guarda una tabla `ud60` con una fila **por día y por tipo de
tasa**:

| campo | tipo | |
|---|---|---|
| `tipo` | C(1) | `1`, `2` o `3` |
| `fecha` | C(8) | `YYYYMMDD` |
| `tasa` | N(15,6) | tasa mensual en decimal (`0.021690`) |
| `indice` | N(15,7) | el índice acumulado |

La recurrencia, una sola línea:

```
indice(d) = indice(d-1) × (1 + tasa_mensual)^(1/30)
```

Y la valuación:

```
coeficiente       = indice(hoy) / indice(fecha_vencimiento)
deuda_actualizada = importe_original × coeficiente
```

### La fórmula completa — RESUELTA, 15/15 al centavo

Se dedujo del **estado de deuda de la oficina virtual de AYSA**, que desglosa los conceptos, y se
validó contra los 15 casos del cedente: **los 15 dan exacto al centavo** (§7.2). Sobre **cada
factura**, redondeando cada concepto a 2 decimales:

```
coef      = índice(fecha_cálculo) / índice(vencimiento)     ← cadena del ud60, tipo 1
Int/Rec   = capital × (coef − 1 + 0,05)
Rec AJ/EJ = 0,10 × (capital + Int/Rec)
IVA/RNI   = 0,21 × (Int/Rec + Rec AJ/EJ)
Total     = capital + Int/Rec + Rec AJ/EJ + IVA/RNI
```

Forma cerrada equivalente: **`Total = capital × (1,331 × coef − 0,14345)`**, con `1,331 = 1,10 × 1,21`.

Los tres componentes que no se podían adivinar desde afuera, cada uno verificado sobre los datos:

| hallazgo | evidencia |
|---|---|
| **El recargo lleva 5 puntos fijos** además del interés | `Int/capital − (coef−1) = 0,04999998` |
| **El `Rec AJ/EJ` es 10% de capital + interés** | `Rec / (capital + Int) = 0,09999996` |
| **El IVA grava solo los recargos**, no el capital | `IVA / (Int + Rec) = 0,21000008` |

Que el IVA no toque el capital tiene sentido: el capital es una factura que ya salió con IVA. Y el
`Rec AJ/EJ` es el recargo por gestión de cobranza.

> El 5% fijo era el término que faltaba y explica todo el "ajuste estadístico" de las vueltas
> anteriores: un cargo fijo sobre el capital se disfraza de tasa más alta cuando se lo mira como
> multiplicador, y de tasa más baja cuanto más largo el período. Por eso el multiplicador implícito
> daba 2,53 a 144 días de mora y 1,31 a 694.

**El `Rec AJ/EJ` se aplica siempre**, no solo a cuentas en gestión avanzada: aparece igual en una
cuenta "Desconexión iniciada" y en otra "Instalación no desconectada".

### Los tres tipos

Son la misma tasa con multiplicadores: **×1, ×1,5 y ×2**. Verificado sobre el archivo: 38 de 44 meses
de los últimos 3 años cierran exactos (los 6 desvíos son errores de tipeo del operador, que hace las
multiplicaciones a mano en el formulario).

**El tipo 1 es el que alimenta la deuda actualizada de toda la cartera.** Deducido por contradicción:
en agosto 2026 el CRM mostraba *todas* las deudas actualizadas en negativo, y la única de las tres
cadenas rota era la del tipo 1 (§8.1). Que fuera *todas* y no un subconjunto también descarta la
hipótesis "un tipo por tramo de mora".

Para qué se usan el 2 y el 3 sigue sin confirmarse. La hipótesis viva es la proyección de planes de
pago, que es el uso que menciona el propio mail del cedente. Es trabajo de fase 4.

### La convención /30 sobre-devenga, y es intencional

El exponente es siempre `1/30`, sin importar cuántos días tiene el mes. Con la tasa de agosto 2026
(2,169%), 31 días de índice acumulan **2,2421%**; febrero acumula menos. **No corregirlo**: replicar
la convención es lo que hace que nuestros montos coincidan con los del cedente.

### El redondeo se compone, pero da igual

`indice` es `N(15,7)`, y el código de FoxPro relee el valor guardado para encadenar
(`store ud60.indice to inant`), así que el redondeo entra en la cadena. Reproducirlo da paridad al
último dígito, pero el efecto sobre el coeficiente es de ~1e-11. **No hace falta replicarlo**: se
guarda en `Decimal` de precisión amplia y listo.

---

## 2. Modelo de datos

Dos tablas. La de tasas es lo que carga el operador; la de índices es derivada y existe para que el
cálculo sea un `JOIN` en vez de una descomposición por mes fila por fila.

```prisma
/// Una fila por mes. El operador carga SOLO la tasa que informa el cedente; los tres tipos
/// se derivan con los multiplicadores. Elimina la aritmética manual, que en el archivo del
/// cedente produjo 6 errores de tipeo en 3 años.
model tasa_mora {
  id        Int      @id @default(autoincrement())
  empresaId Int
  periodo   String   // "2026-08"
  tasaBase  Decimal  @db.Decimal(10, 6)  // 2.169000 — como la informa el cedente, sin dividir
  fuente    String?  // "MAIL_AYSA" | "MIGRACION_UD60"
  usuarioId Int?
  createdAt DateTime @default(now())
  empresa   empresa  @relation(fields: [empresaId], references: [id])

  @@unique([empresaId, periodo])
}

/// Índice diario derivado. ~1.100 filas por año (3 tipos x 365).
model indice_mora {
  empresaId Int
  tipo      Int      // 1 | 2 | 3
  fecha     DateTime @db.Date
  tasa      Decimal  @db.Decimal(10, 8)   // la mensual en decimal, para auditar
  indice    Decimal  @db.Decimal(30, 12)
  origen    String   // "UD60" (migrado) | "CALCULADO"

  @@id([empresaId, tipo, fecha])
  @@index([empresaId, tipo, fecha])
}
```

**`Decimal(30,12)`, no `Float`.** El tipo 3 del cedente ya está en 2,4e7 y su campo `N(15,7)` perdió
un decimal por desborde de ancho; en 3-4 años pierde otro. No repetir el problema.

> **Implementado.** Los dos modelos están en
> [`schema.prisma`](../backend/prisma/schema.prisma) con los comentarios de por qué, más
> `deudor.recargoMora` y `deudor.moraCalculadaEn` (§4.4).

### Los parámetros del régimen

Van en `empresa.configuracion.mora`, no hardcodeados: son números de una resolución y pueden cambiar.

```json
{
  "mora": {
    "recargoFijo":    0.05,
    "recargoGestion": 0.10,
    "iva":            0.21,
    "diasBase":       30,
    "multiplicadores": { "1": 1, "2": 1.5, "3": 2 }
  }
}
```

### Qué manda para la historia: el índice, no la tasa

`tasa_mora` es la tabla que opera el usuario **de acá en adelante**: carga un número por mes y el
sistema genera los tres índices. Para el pasado migrado es informativa, y hay un motivo concreto —
**39 de los 305 meses del `ud60` tienen más de una tasa** porque el cedente recargó el mes a mitad de
camino con una corrección. En esos meses la tasa no reconstruye el índice.

Regla: **para fechas ya migradas manda `indice_mora`; para meses nuevos manda `tasa_mora`.** El
importador guarda la tasa del último día del mes, que es la que gobierna el cierre.

---

## 3. Migración del `ud60`

**Importar el DBF entero, no regenerarlo desde las tasas.** Son 25 años de cadena (01/04/2001 →
31/08/2026, 9.284 días por tipo, **sin un solo hueco**) y trae correcciones incrustadas a mano —el
29/05/2022 los tres tipos bajan entre 1% y 3% respecto de la proyección, porque recargaron el mes con
una tasa corregida. Esa es la historia con la que el cedente liquidó de verdad. Regenerar daría
números parecidos y no idénticos.

Script: `backend/prisma/scripts/importar-ud60.ts` (patrón de los scripts existentes en esa carpeta;
idempotente, con `--dry-run`).

El DBF es formato dBase III (`version=0x30`), sin memo. Parseo directo: header de 32 bytes
(`nRegistros` en 4-7 LE, `hdrLen` en 8-9, `recLen` en 10-11), descriptores de campo de 32 bytes hasta
el `0x0D`, y registros a partir de `hdrLen` con un byte de borrado al frente (`0x2A` = borrado).

Tres saneos obligatorios en la importación:

1. **Descartar los 485 registros borrados.** Son el rastro de las recargas de emergencia y contienen
   basura: una carga con `tasa = 3.858` (se olvidaron de dividir por 100), un `tipo = 't'`, un
   `indice = 0`, y filas con fecha en 2028.
2. **Descartar las 93 filas con `tipo` vacío** (todo octubre 2025, cada fecha por triplicado): son
   tres cargas hechas sin seleccionar el combo. Están vivas en el archivo y no las lee nadie.
3. **Corregir el tramo roto del tipo 1** (01/06/2026 → 31/08/2026), reconstruyéndolo desde el ancla
   sana del 31/05/2026 = `6597.9126017`. Ver §8.1. Los valores corregidos:

   | fecha | índice tipo 1 |
   |---|---|
   | 31/05/2026 *(ancla)* | 6.597,9126017 |
   | 30/06/2026 | 6.741,0213261 |
   | 31/07/2026 | 6.890,0011692 |
   | 31/08/2026 | **7.044,4822042** |

Tasas 2026 confirmadas en el archivo: ene 2,663 · feb 3,593 · mar 3,223 · abr 2,533 · may 2,169 ·
jun 2,169 · jul 2,138 · ago 2,169. Las dos últimas coinciden con el mail del cedente.

> La tasa de junio (2,169%) **no hay que preguntarla**: las cadenas de los tipos 2 y 3 de junio están
> sanas y traen 3,2535% y 4,338%, que son exactamente 1,5× y 2× de 2,169%.

---

## 4. El servicio — IMPLEMENTADO

[`backend/src/modules/mora/`](../backend/src/modules/mora/). `MoraModule` se exporta porque lo van a
consumir la ficha y los reportes (fase 4).

| archivo | qué |
|---|---|
| `mora.constants.ts` | defaults del régimen y helpers de fecha |
| `mora.formula.ts` | la fórmula de §1 en aritmética decimal, sin base — es lo que se testea |
| `mora.service.ts` | generación del índice, cálculo por deudor y recálculo masivo |
| `mora.controller.ts` | endpoints bajo `/api/mora` |

### 4.1 Generación del índice

`generarMes(empresaId, periodo, tasaBase, opts)`:

1. Rechaza una tasa fuera de rango — el error clásico es cargarla ya dividida por 100.
2. Valida que exista el índice del **último día del mes anterior** para los tres tipos. Si falta,
   `BadRequestException`: **nunca** arrancar la cadena en 1. Ese es exactamente el bug que rompió el
   CRM del cedente tres meses seguidos (§8.1). El único escape es `permitirInicioDeCadena`, que
   además exige que la empresa no tenga ni una fila de índice, y deja un `warn`.
3. Encadena los días del mes con `(1 + tasaBase × mult / 100)^(1/30)`.
4. **Regenera los meses posteriores** que ya tuvieran índice: la cadena es acumulativa, así que
   cambiar un mes invalida todos los que siguen.

`mesesFaltantes(empresaId)` devuelve los meses sin índice completo hasta el mes corriente. Es la base
del aviso de "falta cargar la tasa", que hoy en el CRM del cedente es un olvido humano sin red.

### 4.2 Cálculo

El interés corre **por factura** —cada partida trae su propio `F.vto.`, mapeado a
`factura.vencimiento`— y el total del caso es la suma.

- **`calcularDeudor(deudorId, fecha?)`** devuelve el desglose por factura con los mismos conceptos
  que el estado de deuda de AYSA (`intRec`, `recAjEj`, `iva`), más las advertencias. Es lo que va a
  mostrar la ficha.
- **`recalcularCartera(empresaId, { fecha, dryRun })`** hace lo mismo para toda una empresa en un
  `UPDATE ... JOIN`, y persiste `deudor.recargoMora`. Medido sobre AYSA: **21.335 casos y 1,1M de
  facturas en ~7 segundos**.

Una factura que **todavía no venció no devenga nada**: ni interés, ni recargo fijo, ni gestión, ni
IVA. Es lo que hace AYSA — en su estado de deuda las facturas del mes siguiente salen con todas las
columnas de recargo en cero. Las facturas sin índice para su vencimiento se marcan `SIN_INDICE` y
suman una advertencia, en vez de inventar un número.

### 4.3 Las dos implementaciones tienen que dar el mismo número

Hay dos caminos —TypeScript para la ficha, SQL para la cartera— y si difieren por centavos el gestor
deja de confiar en los dos. Hacer que coincidan costó dos correcciones que vale la pena no volver a
descubrir:

1. **`factura.importe` es `Float` (DOUBLE en MySQL) y MySQL contagia el tipo**: sin un
   `CAST(... AS DECIMAL(20,2))` toda la cadena se calcula en punto flotante. Como
   `0,10 × (un valor de 2 decimales)` cae exacto en medio centavo 1 de cada 10 veces, y en binario
   ese `.635` es `.63499…`, el SQL redondeaba para abajo y el total quedaba **sistemáticamente**
   corto. No era ruido: los 300 casos de la muestra fallaban para el mismo lado.
2. **En TypeScript la aritmética va en `Prisma.Decimal`**, no en doubles, replicando lo que hace
   MySQL: el cociente de dos `DECIMAL(30,12)` se redondea a 16 decimales (escala del dividendo más
   `div_precision_increment`), y cada concepto a 2 con `ROUND_HALF_UP`.

Con las dos, **300 de 300 casos de la cartera real dan idénticos al centavo** entre el cálculo al
vuelo y el masivo.

### 4.4 Dónde se persiste

**No se toca `deudor.saldo`.** El [spec de consolidación](consolidacion-situacion-spec.md) fija que el
original es inmutable y que `saldo = montoTotal − pagos`. El recargo es otra dimensión:

```prisma
// en model deudor
recargoMora     Float?      // el recargo (Int/Rec + Rec AJ/EJ + IVA), no el total
moraCalculadaEn DateTime?
```

La deuda actualizada se deriva (`montoTotal + recargoMora`), no se guarda duplicada.

A diferencia del CRM, **no hace falta un job diario para "avanzar" nada**: el coeficiente es función
pura de (fecha, tasas). El recálculo existe solo para tener el dato materializado en listados y
reportes; la ficha lo calcula al vuelo.

> El recálculo masivo corre en transacción y sube el timeout de Prisma con
> `MORA_RECALCULO_TIMEOUT_MS` (default 5 min): los 5 segundos que da por defecto no alcanzan para un
> `UPDATE ... JOIN` sobre 1,1M de facturas.

### 4.5 Endpoints

| método | ruta | permiso |
|---|---|---|
| `GET` | `/api/mora/tasas?empresaId=` | `mora.ver` |
| `GET` | `/api/mora/tasas/faltantes?empresaId=` | `mora.ver` |
| `POST` | `/api/mora/tasas` | `mora.gestionar_tasas` |
| `GET` | `/api/mora/deudor/:id?fecha=` | `mora.ver` |
| `POST` | `/api/mora/recalcular` | `mora.recalcular` |

`tasaBase` se manda **como la informa el cedente**: `2.169` para 2,169%. Sin dividir por 100 y sin
multiplicar por nada — los tres tipos los deriva el sistema.

### 4.6 Tests

`npx jest mora --no-coverage` → **20 tests**. Los dos más importantes reproducen, concepto por
concepto, los **estados de deuda reales de AYSA** de las cuentas 987636 y 987285. Si alguno de esos
falla, la plataforma dejó de coincidir con lo que AYSA le cobra al deudor.

También están cubiertos el guard de la cadena (falla si falta el índice del día anterior), el
redondeo del medio centavo, y que una factura no vencida no devengue nada.

---

## 5. Frontend — IMPLEMENTADO

### 5.1 Ficha del deudor

Cuando el caso tiene recargo calculado, el header pasa a mostrar **DEUDA ACTUALIZADA** como número
principal —es el que el gestor le dice al deudor— y debajo, en chico: el original tachado, el recargo,
lo pagado y **a qué fecha está valuado**. Si el último recálculo tiene más de un día, la fecha se
pinta en `warning`: el número quedó corto y conviene que se note.

`ver desglose` abre [`DesgloseMoraModal`](../frontend/src/components/deudores/ficha/modals/DesgloseMoraModal.tsx),
que replica **la estructura del estado de deuda de la oficina virtual de AYSA**: mismas columnas
(`Int/Rec`, `Rec AJ/EJ`, `IVA`), mismo orden, factura por factura. La idea es que el gestor pueda
cotejar línea por línea contra lo que ve el deudor cuando consulta, sin traducir nada.

Cada columna de recargo lleva un tooltip que explica de dónde sale, y las facturas no vencidas o sin
índice salen marcadas con un chip en vez de con un cero mudo.

### 5.2 Ajustes → Recargo por mora

[`AjustesMora.tsx`](../frontend/src/pages/ajustes/AjustesMora.tsx). Una tabla con la serie mensual —la
tasa informada y las derivadas ×1,5 y ×2, para poder cotejar contra el CRM viejo— y de dónde salió
cada una (`mail del cedente` / `migrada del CRM viejo` / `calibrada`), que no valen lo mismo.

Arriba, un `Alert` con **los meses que faltan**, porque una deuda cuyo período de mora cruce un hueco
se valúa mal y hoy eso no lo avisa nadie.

Dos frenos en la carga, los dos por errores que ya pasaron en el sistema del cedente:

- Si la tasa es menor a 0,5 pide confirmación: el error clásico es cargarla **ya dividida por 100**.
- Si el mes ya tenía tasa, avisa **cuántos meses posteriores se van a regenerar**, porque la cadena es
  acumulativa.

El botón de recalcular la cartera corre primero el `dryRun` y muestra cuántos casos se van a tocar y
cuántas facturas quedarían sin índice, antes de pedir confirmación.

### 5.3 Reportes

`recargoMora`, `deudaActualizada` y `moraCalculadaEn` están en el catálogo, con etiqueta y
descripción, ordenados junto a `montoTotal` y `saldo`.

> **Por qué `deudaActualizada` es una columna y no un cálculo.** El catálogo de reportes se arma
> recorriendo el DMMF de Prisma y **no soporta campos calculados**: sin la columna, la deuda
> actualizada no se puede pedir en un reporte ni ordenar en un listado. Se desnormaliza a propósito y
> la escribe el mismo `UPDATE` que `recargoMora`. Esto revisa la decisión que decía §4.4 en la
> primera versión del spec.

### 5.4 Permisos

`mora.ver` (ficha y panel), `mora.gestionar_tasas` (cargar la tasa), `mora.recalcular` (recalcular la
cartera). El ítem del menú aparece con `mora.ver`.

---

## 6. Fases

| # | Qué | Estado |
|---|---|---|
| 1 | Modelo + importador del `ud60` | **HECHA** — corrida y validada en local (§6.1) |
| 2 | `MoraService` (generación + cálculo) + carga mensual de la tasa | **HECHA** — §4 |
| 3 | Reconciliación | **cerrada, 15/15 al centavo** (§7.3) |
| 4 | Ficha + reportes | **HECHA** — §5 |
| 5 | Proyección de planes de pago (tipos 2 y 3) | falta saber para qué son |

### Fase 1 — cómo correrla

El script es [`prisma/scripts/importar-ud60.ts`](../backend/prisma/scripts/importar-ud60.ts). Corre en
**dry-run por defecto** y en ese modo **no se conecta a la base**: parsea, audita y reporta.

```bash
cd backend
npx prisma db push          # crea tasa_mora e indice_mora
npx prisma generate

# 1) Verificar (seguro, no toca nada):
npx ts-node --transpile-only prisma/scripts/importar-ud60.ts --archivo ~/Descargas/UD60.DBF

# 2) Aplicar:
npx ts-node --transpile-only prisma/scripts/importar-ud60.ts \
    --archivo ~/Descargas/UD60.DBF --empresa <id de AYSA> --apply
```

Salida esperada del dry-run contra el archivo del 2026-08-03:

```
filas útiles       : 27852        (485 borradas + 93 con tipo inválido, descartadas)
tipo 1/2/3         : 9284 días c/u, 20010401 → 20260831
huecos 0 · duplicados 0 · rupturas 9 (todas conocidas)
reparación tipo 1  : 92 días reescritos, índice al 31/08/2026 = 7044.4822042 ✓
tasas mensuales    : 305 meses
```

**El script se planta si algo no cuadra**, en vez de importar mal: si aparece un hueco, un duplicado
o una **ruptura de cadena que no está en la lista de conocidas**, aborta y pide que alguien mire el
archivo. Lo mismo si el ancla del 31/05/2026 no vale `6597.9126017` o si la reparación no termina en
`7044.4822042`. Una ruptura nueva significa que el archivo cambió, y eso hay que entenderlo antes de
migrarlo.

Es idempotente: `createMany({ skipDuplicates })` para los índices y `upsert` con `update: {}` para las
tasas, así que **no pisa una tasa corregida a mano**.

### 6.1 Prueba de aceptación — 15/15 en SQL

[`prisma/scripts/verificar-mora-15casos.ts`](../backend/prisma/scripts/verificar-mora-15casos.ts)
calcula los 15 casos del cedente **en SQL, con el JOIN contra `indice_mora`** que después va a usar el
`MoraService`, y compara contra el `deuact` real. Verifica de una sola pasada que el índice se migró
bien, que el schema sirve para el cálculo y que la fórmula de §1 es la correcta.

```bash
npx ts-node --transpile-only prisma/scripts/verificar-mora-15casos.ts --empresa 19
```

Corrida en local el 2026-08-20 contra el índice recién importado: **15/15 exactos al centavo**, peor
diferencia **3 centavos** (redondeo acumulado en el caso de 9 facturas). Devuelve exit code 1 si
alguno no cierra, así que sirve como test de humo después de cualquier reimport.

Las facturas van embebidas en el script a propósito: son el dato que mandó el cedente junto con su
`deuact`, así la prueba corre contra cualquier base que tenga el índice, tenga o no esa cartera
cargada. La consulta es la referencia de cómo escribir el cálculo:

```sql
WITH base AS (
    SELECT p.caso, p.cap,
           ROUND(p.cap * (ih.indice / iv.indice - 1 + 0.05), 2) AS intrec
    FROM partidas p
    JOIN indice_mora iv ON iv.empresaId = ? AND iv.tipo = 1 AND iv.fecha = p.vto
    JOIN indice_mora ih ON ih.empresaId = ? AND ih.tipo = 1 AND ih.fecha = ?
),
conceptos AS (
    SELECT caso, cap, intrec, ROUND(0.10 * (cap + intrec), 2) AS recajej FROM base
)
SELECT caso, ROUND(SUM(cap + intrec + recajej + ROUND(0.21 * (intrec + recajej), 2)), 2) AS total
FROM conceptos GROUP BY caso
```

**El redondeo a 2 decimales es por factura y por concepto**, no al final. Redondear solo el total da
diferencias de centavos contra AYSA.

---

## 7. Reconciliación — primera corrida (2026-08-20)

El cedente mandó 10 casos con `deuhist` / `deuact`; 5 son de la remesa 10067 (**la #108 nuestra**) y
tienen las partidas cargadas. La clave de cruce es la columna **`nroemp` del export = `Cta. Cto.`**,
que se compara contra `deudor.nroCliente` rellenando a 12 dígitos.

**Lo que quedó confirmado:**

1. **`deuhist` = `deudor.montoTotal` = Σ importes de las facturas, exacto en los 5 casos.** Nuestra
   carga de la cartera está bien.
2. **El interés corre por partida, desde `F.vto.`** — no desde una fecha única de la cuenta. Un
   modelo de fecha única no ajusta; el de por-factura sí. Queda respondida la pregunta 1 de §8.2:
   es `factura.vencimiento`, no `F.Tol.Liq.`.
3. **Es capitalización compuesta**, la del índice: ajustando interés simple el error se multiplica
   por trece (rms 1,88% vs 0,14%).
4. **`deuact` es una foto congelada**, no un valor vivo: la fecha de valuación que ajusta es el
   **02/08/2026**, que es el `F. Proc.` del archivo. Eso explica de paso por qué el `deuact` del
   export está sano pese a que la cadena del tipo 1 del cedente está rota desde el 01/06 (§8.1):
   ese número no se recalcula.

**Lo que falta:** el interés puro no alcanza — se queda 20% corto y el faltante crece con la mora.
Hacen falta dos términos más. Segunda tanda del cedente (`aysa2.xls`, 10 casos más de la 10067) →
**15 casos en total**, y el ajuste sobre los 15:

```
deuact = 1,21 × Σ importe × Π (1 + tasaBNA_mes + 0,0026) ^ (1/30)
                              (por cada día entre el vencimiento y el 31/07/2026)
```

| estructura probada | parámetro | rms | peor caso |
|---|---|---|---|
| **sobretasa aditiva** | **+0,268%/mes** | **0,186%** | **0,384%** |
| multiplicador sobre la tasa | ×1,075 | 0,197% | 0,327% |
| corrimiento de fechas | 45 días antes | 1,421% | 2,426% |
| tasa BNA pura, sin nada | — | 1,906% | 2,980% |

El corrimiento de fechas y la BNA pura quedan descartados: **el término que falta es una sobretasa,
no una fecha distinta**. Entre aditiva y multiplicativa los datos no discriminan (rms casi igual).

En validación dejando un caso afuera los parámetros son **muy estables** (sobretasa 0,264-0,274%,
factor 1,2068-1,2082) y el peor error fuera de muestra es 0,415%. Con 2 parámetros sobre 15
observaciones, eso ya no es sobreajuste.

**La fecha de valuación y el factor no se identifican por separado** (se compensan entre sí). Lo que
sí se puede decir: la fecha que hace que el factor caiga en **1,21 exacto** es **fin de julio 2026**
— lectura natural, la deuda se valúa al cierre del mes y el archivo se procesa el 02/08.

**Sigue sin cerrar al centavo: cierra al 0,2-0,4%.** Sobre los 15 casos el total da −0,231%.

### Dónde está el error que queda

Los tres casos de **una sola factura** son los que más dicen, porque no hay ponderación que tape nada:

| caso | vencimiento | desvío |
|---|---|---|
| GALEFFI | 17/12/2025 | **−0,009%** |
| GOGMAN | 09/12/2025 | **−0,024%** |
| FORMIGLIETTI | 23/05/2025 | −0,579% |

Los dos con vencimiento en diciembre 2025 dan **exactos**. El de mayo 2025 se va medio punto. O sea:
**la fórmula está bien y el error vive en la serie de tasas de mediados de 2025** — entre mayo y
diciembre de 2025 falta acumular ~0,09% mensual. Encaja con que el `ud60` tiene tipeos del operador
en esa ventana (202505: `t1` dice 3,145% y `t2`/`t3` implican 3,415%).

### Qué hace falta para cerrarlo

El equipo del cedente **no puede responder ninguna de las preguntas de negocio**: se apoyan en la
oficina virtual de AYSA y sacan los importes de ahí. Eso reorienta la validación — la oficina virtual
es **AYSA calculando su propio régimen**, o sea la fuente y no la copia. Es mejor dato que cualquier
respuesta que pudieran darnos.

1. **Los mismos 15 casos consultados en la oficina virtual de AYSA**, con la fecha de la consulta y
   **el desglose por partida**. Ver la predicción registrada abajo.
2. **Los mails de AYSA con la tasa mensual de 2025**, que apuntan justo donde está el error residual.

### Predicción registrada (2026-08-20) — antes de ver el dato de la oficina virtual

Tener el mismo caso valuado a dos fechas (31/07 en el archivo, hoy en la OV) **aísla el devengamiento
de esas tres semanas**: mide la tasa sin depender del factor 1,21, ni de la fecha de corte, ni de la
serie histórica. El cociente `OV_hoy / deuact` tiene que caer en uno de estos dos:

| | 20 días, agosto 2026 |
|---|---|
| tasa BNA pura (2,169%) | **1,014408** |
| BNA + 0,26% mensual | **1,016128** |

**Y hay una hipótesis alternativa que la OV resuelve de una:** el factor 1,21 puede no ser IVA de
AYSA sino **honorarios de gestión que agrega el CRM del cedente**. Si es eso, no va en el cálculo de
mora sino en otro lado, y probablemente varía por remesa o política. Las dos ramas al 20/08/2026:

| cuenta | caso | facturas | `deuact` 31/07 | A) sin 1,21 | B) con 1,21 |
|---|---|---|---|---|---|
| 1600610 | BURGOS | 5 | 178.168,37 | 149.556,28 | 180.963,10 |
| 160088 | GOMEZ | 5 | 137.776,18 | 115.652,68 | 139.939,74 |
| 1601558 | CASARES | 3 | 33.931,16 | 28.562,91 | 34.561,12 |
| 160171 | RUEDA | 7 | 249.093,26 | 209.262,32 | 253.207,41 |
| 1605816 | SIMON | 4 | 173.536,03 | 145.398,91 | 175.932,68 |
| **987285** | **GALEFFI** | **1** | 52.977,20 | **44.531,51** | **53.883,13** |
| 987343 | PALOMO | 4 | 107.123,31 | 90.167,74 | 109.102,97 |
| **987636** | **FORMIGLIETTI** | **1** | 141.558,48 | **118.423,86** | **143.292,87** |
| 987899 | CAAMAÑO | 7 | 181.980,30 | 152.849,26 | 184.947,61 |
| 987975 | GUIDI | 6 | 158.084,39 | 133.068,10 | 161.012,40 |
| **989056** | **GOGMAN** | **1** | 36.801,30 | **30.930,98** | **37.426,48** |
| 991029 | MORONTA | 5 | 171.201,10 | 143.418,34 | 173.536,19 |
| 991549 | BRITOS | 9 | 253.316,37 | 212.986,97 | 257.714,24 |
| 991707 | PAZ | 10 | 234.073,94 | 196.220,36 | 237.426,64 |
| 991776 | RIZZO | 2 | 35.840,20 | 30.156,82 | 36.489,75 |

Los tres en negrita tienen **una sola factura**: ahí el coeficiente se lee directo, sin ponderación.
`FORMIGLIETTI` es el más valioso de los quince — es el que hoy tiene el desvío más grande (−0,579%),
así que es el que dice si el problema está en la serie de tasas de mediados de 2025.

**Al pedir la consulta hay que aclarar tres cosas** o el dato no sirve: la **fecha exacta** (el número
cambia todos los días), el **desglose por partida** y no solo el total (una captura de pantalla
alcanza y es mejor), y **marcar las facturas posteriores al 02/08/2026** — si AYSA facturó consumo
nuevo, el total no es comparable contra nuestra cartera. Si la OV muestra conceptos separados
(capital / recargo / IVA), eso solo responde todo.

## 7.2 El estado de deuda de AYSA cerró la regla (2026-08-20)

Llegó el **Estado de Deuda de la oficina virtual** de `FORMIGLIETTI` (cuenta contrato 987636),
calculado al 20.08.2026, con el desglose por concepto. Reproduce **al centavo**:

| | |
|---|---|
| capital (`Imp orig`) | 70.322,32 |
| `Int/Rec` | 46.886,68 |
| `Rec AJ/EJ` | 11.720,90 |
| `IVA/RNI` | 12.307,59 |
| **`Imp Total`** | **141.237,49** |

La fórmula de §1 da **141.237,49**. Exacto.

**Dos correcciones importantes sobre lo que veníamos asumiendo:**

1. **El 1,21 es IVA, pero grava solo los recargos** — no el capital, como modelábamos. Y hay un
   segundo concepto que no conocíamos, el `Rec AJ/EJ` (10% de capital + interés).
2. **El `deuact` del CRM del cedente NO es el número de AYSA.** Aplicando la fórmula de AYSA a los 15
   casos contra el `deuact`, el error es de 3,7% rms con sesgo sistemático. Y el caso testigo lo
   muestra directo: el CRM dice 141.558,48 al 02/08 y AYSA dice 141.237,49 **dieciocho días después**
   — más tiempo y menos plata. Son dos cálculos distintos.

> **Cambia el objetivo de la implementación: hay que replicar a AYSA, no al CRM del cedente.** Es lo
> que el deudor va a ver si consulta, y lo que efectivamente debe. Todo el ajuste estadístico de §7
> quedó obsoleto: apuntaba al número equivocado.

Del estado de deuda salen además dos cosas para el importador:

- **`Fec 1vto` es el vencimiento que manda** y coincide exacto con nuestro `factura.vencimiento`
  (23.05.2025), igual que `Imp orig` con nuestro `factura.importe`. La carga está bien.
- El bloque **GASTOS** trae un "Cargo por aviso" (19.191,13, emitido el 02.08.2026 — el día que se
  asignó la cartera) que **no está en nuestra cartera**. Y aparece una factura de septiembre 2026
  (vto 17.09.2026) que **hay que descartar**: la asignación llega hasta agosto.

## 7.3 Cerrado — 15/15 al centavo (2026-08-20)

El estado de deuda de **GALEFFI** (cuenta 987285) destapó el término que faltaba. Su `Int/Rec`
implicaba `0,28648890` sobre el capital cuando el índice del `ud60` daba `0,23648892`: la diferencia
es **0,04999998**, o sea **5 puntos porcentuales fijos**.

Con ese término, la fórmula de §1 aplicada a los 15 casos contra el `deuact` del cedente:

| | |
|---|---|
| casos exactos al centavo | **15 de 15** |
| peor desvío | **0,0000%** (máximo 3 centavos, por redondeo acumulado en los casos de 9-10 facturas) |
| fecha de valuación | **20/08/2026** — el `deuact` se recalcula al momento de la consulta, no es una foto |

GALEFFI cierra exacto en los **cuatro** conceptos por separado (`Int/Rec`, `Rec AJ/EJ`, `IVA`,
`Total`), no solo en el total, que es la prueba fuerte de que la descomposición es la correcta.

> **Confirmación lateral:** que el `deuact` se reproduzca con una cadena sana significa que **el
> cedente ya aplicó la corrección del `ud60`** (§8.1). Si la cadena siguiera rota, estos números
> serían basura.

### Lo único que queda: una tasa mal cargada en el `ud60`

Con la fórmula cerrada, el `deuact` del cedente y el número de AYSA coinciden **salvo en
FORMIGLIETTI**:

| caso | período | nuestro cálculo = `deuact` | AYSA (oficina virtual) |
|---|---|---|---|
| GALEFFI | 17/12/2025 → 20/08/2026 | 52.977,20 | **52.977,20** ✓ |
| FORMIGLIETTI | 23/05/2025 → 20/08/2026 | 141.558,48 | 141.237,49 |

Los dos usan la misma fórmula; lo único que cambia es el período. Aislando el tramo que FORMIGLIETTI
tiene y GALEFFI no —**23/05/2025 a 17/12/2025**— el `ud60` está **0,2145% alto**. O sea: **hay un mes
de ese semestre cuya tasa el operador cargó mal**, unos 0,21 puntos de más.

Eso ya no es un problema de fórmula sino de dato de entrada, y se resuelve de dos maneras, ninguna
bloqueante:

1. **Los mails de AYSA con la tasa mensual de junio a noviembre de 2025.** Identifican el mes exacto.
2. **Calibrando contra estados de deuda**: cualquier par de cuentas con vencimientos que acoten el
   tramo permite despejar el mes, con la misma técnica de este párrafo.

**Para la implementación esto define una decisión de diseño:** la fuente de verdad de la tasa es el
mail de AYSA, no el `ud60`. El `ud60` se importa por su historia, pero cualquier mes que se pueda
verificar contra un estado de deuda se corrige.

---

## 8. Lo que encontramos en el archivo del cedente

### 8.1 La cadena del tipo 1 estaba rota (informado el 2026-08-20)

El 01/06/2026 el `seek` del día anterior falló, `inant` volvió a 1 y la cadena arrancó de cero. El
01/07 volvió a pasar, y agosto se cargó encima. El índice valía **1,0450169** cuando debía valer
**7.044,4822042** — un factor de 6.740. Por eso el CRM mostraba todas las deudas actualizadas en
negativo.

**No fue un dato faltante**: el orden físico de los registros muestra que mayo se escribió en los
recnos 28.061-28.153 y junio recién en el 28.154, así que la fila del 31/05 existía cuando se cargó
junio. El header del DBF tiene el flag de índice estructural (`byte 28 = 0x01`), y la explicación que
queda es un **`ud60.CDX` corrupto o desactualizado** — la falla clásica de FoxPro sobre carpeta de
red. Es intermitente, y los registros borrados confirman el patrón: les pasó en nov-2025, en abr-2026
(tres intentos) y en jun-jul 2026.

Se les pasó un `.prg` de corrección que reindexa, borra el tramo roto y reconstruye la cadena sin
depender del `seek`.

**Lección para nuestra implementación**: la validación de §4.1 (fallar si falta el índice del día
anterior) no es defensiva de más. Es el bug exacto que hay que no repetir.

### 8.2 Preguntas abiertas

| # | Pregunta | Estado |
|---|---|---|
| 1 | ¿La mora corre desde `F.vto.` o desde `F.Tol.Liq.`? | **RESUELTA** — `F.vto.`, por partida (§7) |
| 2 | ¿El `deuact` lleva IVA 21%? | ajusta como 1,21; falta confirmarlo (§7) |
| 3 | ¿La tasa es la BNA pura o lleva un adicional? | ajusta ~+0,25% mensual; falta confirmarlo (§7) |
| 4 | ¿Cuándo aplican los tipos 2 y 3? | abierta. Ninguno de los dos ajusta el `deuact`, así que **no son la deuda actualizada**: la hipótesis viva sigue siendo la proyección de planes de pago |
| 5 | ¿Hay tope de recargo? | abierta, fase 5 |
| 6 | ¿El recargo se capitaliza al armar el plan de pago? | abierta, fase 5 |
| 7 | **¿Cómo imputa AYSA los pagos a las facturas?** | abierta — ver abajo |

### La limitación conocida: los pagos

El recargo se calcula sobre el **importe original de cada factura** y **no descuenta los pagos**,
porque no sabemos a qué factura imputarlos: nuestra tabla `factura` no marca cuáles están saldadas y
`pago` no trae la partida (salvo en el `observacion`, que el import de AYSA sí mapea con el
`Nro. docum.`).

Consecuencia práctica: **en un caso con pagos parciales, la deuda actualizada queda por encima de la
real.** Hoy la ficha lo dice —un tooltip sobre "Pagado" aclara que el recargo se calcula sobre el
importe original— en vez de inventar una imputación.

Se resuelve preguntando al cedente cómo imputa AYSA los pagos (¿a la factura más vieja? ¿a la que
indica el `Nro. docum.`?) y, con eso, filtrando las facturas saldadas del cálculo. El dato para
hacerlo ya está cargado: `pago.observacion` trae el número de partida.

> Sobre la cartera de AYSA el impacto hoy es chico: en la bajada del 22/06 ningún caso de la muestra
> de 300 tenía pagos. Pero con el archivo de novedades cargado deja de serlo.

> El multiplicador que ajusta el `deuact` es **1,078** sobre la tasa base — ni 1,5 ni 2. Eso descarta
> que la deuda actualizada use los tipos 2 o 3 del `ud60`, y es un argumento más para que esos dos
> tipos sean de otra cosa.

---

## 9. Gotchas

- **La cadena es acumulativa: nunca reiniciar en 1.** Recalcular un mes obliga a recalcular todos los
  posteriores.
- **Cargar siempre desde el día 1 del mes.** El formulario del cedente lo exige por la misma razón.
- **La convención `^(1/30)` no es un error** aunque el mes tenga 31 días (§1).
- **`Decimal`, no `Float`** (§2).
- **`prisma db push`, nunca `migrate dev`** — convención del repo.
