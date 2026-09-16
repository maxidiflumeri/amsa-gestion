# Claves de pago de Telecom/Personal (multiclaves) y cupón de pago

**Proyecto:** AMSA Gestión
**Módulos involucrados:** nuevo `multiclaves`; modificados `imports` (categoría nueva `MULTICLAVES`, parser, processor, preview, borrado), `convenios` (convenio de clave), `consolidacion` (cancelación por pago de clave), `email-sender` (reuso), `auth` (permiso), `empresas` (config); frontend: ficha del deudor (solapa Convenios), wizard y editor de plantillas, historial, ajustes de empresa.
**Fecha:** 2026-09-14 (fase 4 rediseñada el 2026-09-16, fase 4a implementada el mismo día)
**Estado:** Fases 1, 1.1, 2, 3 y **4a** implementadas y **desplegadas en producción el 2026-09-16**
(imagen `3f1d152`; `SIT-054` creado, plantillas de pagos 48 y 49 con `nroConvenio` en el índice 22).
**La fase 4b se cierra sin código** (decisión del 2026-09-16): el script de los 20 pagos de julio ya no
hace falta —esos pagos eran de la cartera de julio de TELECOM (remesas `00606` y `22222`, cargada dos
veces), que se borró entera ese día—, y Q5, Q6 y Q8 quedan con los defaults ya implementados
(GES-050, `CONSOLIDACION_CLAVE_MODO=SUMA`, los dos medios cancelan). Solo se toca algo si la respuesta
de Ana Maya contradice alguno. La fase 5 del plan anterior queda absorbida por la 4.
**Para el primer uso real en prod** (verificado el 2026-09-16: 0 claves cargadas, 0 convenios
`CLAVE_PAGO`): (1) cargar en TELECOM_PERSONAL la cartera `CA_20260828` —hoy solo están las de julio—,
(2) recién ahí los `MULTI_41645`/`MULTI_41647`, (3) asignar la cuenta SMTP de la empresa, (4) gate R1.
**Producción, verificado el 2026-09-16** (consultas de solo lectura contra la RDS): el schema de la
fase 1 está aplicado, pero **`clave_pago` tiene 0 filas y hay 0 convenios `CLAVE_PAGO`** — nunca se
cargó un archivo de claves ni se emitió un cupón. Hay, en cambio, **20 pagos hechos con multiclave ya
cargados** (12 `Multiclave Contado` + 8 `CONTADO_Z`, empresa 9, julio 2026), **los 20 en SIT-041 y con
el importe guardado en negativo** — ver §10.8.
Fase 2: **gate R1 (escaneo físico) pendiente** — no asignar `convenios.generar_cupon` en prod hasta
imprimir un cupón real y leerlo con un lector físico y con una app (§14, R1; §16.2 paso 10).
Fase 3: corregida la premisa de que el envío por mail necesita sí o sí una plantilla de Sender — es
**opcional** (§8.4, §20); el envío requiere además que la empresa tenga `cuentaSmtpId` asignado
(`PUT /email/empresas/:id/smtp`, ya existente) — **verificado 2026-09-15: en prod, TELECOM_PERSONAL
(empresas 1, 9, 10 y 11) no tiene ninguna cuenta asignada** — paso de despliegue, §15.
Q1, Q3 y Q4 cerradas (§19); quedan Q2, Q5, Q6, Q7 y las nuevas Q8, Q9 y Q10; ninguna bloquea lo
implementado ni la fase 4a.

Archivos analizados:

- `MULTI_41645_RA_1008_2026-08-31_10.29.22.csv` — 14.957 líneas (1 encabezado + 14.956 claves).
- `MULTI_41647_RA_1008_2026-08-31_10.31.09.csv` — 19.620 líneas (9.810 trámites, 1 SOLO_TOTAL).
- `MA_20260911_1008_POSBAJA_HW_260910_260911_C.txt` — **archivo de cobros con pagos hechos con
  multiclave** (104 filas, 23 con clave), la muestra que cierra Q4 y sobre la que se rediseñó la
  fase 4. Verificado columna por columna en §10.1.
- `CA_20260828_1008_POSBAJA_HW_260828_260828.txt` — el CA de esas nóminas, para cruzar trámites.
- `46992372.pdf` — cupón de ejemplo emitido por el sistema viejo.
- `image.png`, `image (1).png` — grilla de claves y diálogo "Carga solicitud de Cupón de Pagos" del sistema viejo.
- `CA_20260527_1008_POSBAJA_HW_260526_260527.txt` — un CA, para cruzar trámites y ver cómo mezcla productos.
- `Prebaja Fan - PAGOS_0308.csv` — un archivo de cobros, para ver si trae dato de la clave.

---

## 0. Resumen ejecutivo

Telecom/Personal manda, junto con cada asignación, un archivo con **dos claves de pago por trámite**:
una por el saldo total y otra con una quita del 50%. El operador elige una desde la ficha, el sistema
genera un **cupón PDF** con el código de barras de esa clave, lo manda por mail (o se descarga) y
registra un **convenio** por el importe de la clave. Cuando el deudor paga la clave, la cuenta tiene
que quedar **cancelada** aunque haya pagado la mitad.

Cuatro piezas:

1. **Carga** — categoría de importación nueva `MULTICLAVES` sobre el pipeline existente. Valida cada
   clave contra sus dígitos verificadores y contra su propio código de barras, agrupa por trámite,
   clasifica TOTAL/QUITA y maneja la reemisión. Las claves se guardan por `(empresaId, nroTramite)`,
   **no atadas a la remesa de deudores**, y se resuelven contra el caso cuando se usan.
2. **Cupón** — PDF de tres talones que imprime **el código de barras del archivo, tal cual**. El
   sistema nunca arma un código de barras por un importe propio.
3. **Generar cupón** — una sola acción en la ficha: valida, crea (o reusa) el convenio de la clave,
   cambia la gestión, envía el mail con el PDF adjunto y deja un comentario.
4. **Cancelación con quita** — el archivo de cobros trae el **número de convenio** de la clave con la
   que se pagó (verificado, §10.1). La consolidación aprende una regla más: un pago cuyo convenio
   corresponde a una clave del trámite, por el importe de esa clave, **cancela el caso con saldo 0** —
   a **SIT-054 "Cancelado con quita"** si fue la clave de quita, a SIT-050 si fue la del saldo total.
   No hace falta que el cupón se haya emitido desde nuestra plataforma: que Telecom haya cobrado la
   clave ya es la aceptación de la quita. La regla por convenio de clave cumplido se evaluó como
   respaldo y se **descartó** en la auditoría de la fase 4a (§10.10): condonaba deuda por un total
   acumulado sin mirar de dónde venía la plata.

### Decisiones clave

| # | Decisión | Por qué |
|---|---|---|
| D1 | Las claves se guardan por `(empresaId, nroTramite)` y **no se guarda el `deudorId`** en la clave | Llegan antes que el CA (los 7.478 trámites del archivo no existen hoy en producción), un trámite puede estar en varias remesas, y borrar/recargar un CA cambia los ids. El vínculo persistente con un caso es el **convenio** (§6) |
| D2 | `MULTICLAVES` es una categoría del pipeline de importación, con **layout fijo en código** | Da gratis historial, errores por fila, progreso por socket, archivo en el volumen y borrado. El layout no se edita desde la plantilla: la validación es estructural (dígitos verificadores, posiciones del código de barras) y un cambio de formato de Telecom requiere código de todos modos |
| D3 | `nroConvenio` es **único en toda la base** | Es el identificador de Telecom. Hace idempotente la recarga del mismo archivo y rechaza, en vez de duplicar, el mismo archivo cargado por error en otra empresa |
| D4 | TOTAL/QUITA se decide por **menor importe del trámite** | `importe < SALDO_TRAMITE` falla en 2 trámites reales (§1.5). El orden en el archivo tampoco sirve: la TOTAL viene primero solo en 3.711 de 7.478 |
| D5 | El número de remesa de una carga de multiclaves **no es numérico** (`MC-AAAAMMDD-HHmm`) | Con el correlativo automático, la carga consumiría el `00609` de la empresa y correría la numeración de las asignaciones de Telecom (§5.3) |
| D6 | La vista previa del cupón sale con marca de agua y **sin código de barras**; el PDF cobrable solo se obtiene después de registrar el convenio | Si el preview fuera el cupón real, se podría descargar y mandar por fuera sin convenio, comentario ni registro |
| D7 | Una sola clave de convenio ACTIVO por trámite a la vez. Pasar de TOTAL a QUITA (o al revés) **anula** el convenio anterior, con confirmación explícita y permiso `convenios.cancelar` | La regla de cancelación necesita un único importe objetivo; dos convenios activos por la misma deuda la vuelven ambigua |
| D8 | Generar dos veces la misma clave **reusa** el convenio activo y solo reenvía | No duplica convenios ni cuotas |
| D9 | Una clave vencida no genera cupón (400). "Vencida" = hoy (AR) > `fechaVencimiento` de la clave, sin corrimiento — el vencimiento real nunca se extiende | Un código vencido no se cobra en la boca de pago. El vencimiento **impreso** en el talón es otra cosa (D12): nunca extiende el plazo real, como mucho lo acorta |
| ~~D10~~ | ~~La regla **por convenio de clave** (respaldo, §10.10) cuenta **Σ pagos con fecha ≥ día de creación del convenio − 1 día** contra el importe de la clave, con tolerancia absoluta (default 100 centavos = $ 1,00). La regla **por archivo** (principal) no mira fechas: el número de convenio ya identifica el cobro | Fechas de cedente sin hora y el corrimiento UTC/AR. Tolerancia absoluta porque el importe de la clave es exacto y los archivos de cobros a veces truncan centavos. La ventana de fechas solo hace falta donde el vínculo es indirecto~~ — **la regla de respaldo se descartó** (§10.10), así que solo rige la tolerancia de la regla por archivo |
| D11 | El logo de Personal es un archivo del repo (`assets/`) con fallback a texto | El usuario lo reemplaza cuando lo consiga; si falta, el cupón sale igual |
| D12 | Vencimiento **impreso** en el talón = `min(hoy + 7 días corridos, fechaVencimiento de la clave)`, día de Argentina. El **código de barras** siempre lleva el vencimiento real de la clave, nunca el impreso | Respuesta de Ana Maya del 2026-09-14 (cierra Q3): apura el pago sin mentir sobre cuándo vence de verdad, y la boca de pago sigue leyendo el vencimiento real del código — no hay riesgo de cobrar algo ya vencido. Reemplaza el parámetro `mesesVtoImpreso` de la versión anterior de este spec (fase 1.1, §20) |
| D13 | El pago de una clave **cancela aunque el convenio no se haya generado desde nuestra plataforma** | Los 23 pagos con clave de la muestra salen de cupones del sistema viejo. Exigir un convenio propio significaría no cancelar **ninguno** durante toda la transición. Que Telecom haya cobrado la clave es la aceptación de la quita |
| D14 | Pago de la clave **QUITA** → **SIT-054 "Cancelado con quita"** (código nuevo, categoría CANCELADO). Pago de la clave **TOTAL** → SIT-050 | Un caso que pagó la mitad con quita y uno que pagó todo no son lo mismo para la liquidación al cedente ni para los tableros, y hoy los dos caían en SIT-050. La categoría CANCELADO es la que dispara el bloqueo de la cuenta (`deudor-bloqueo.ts:36-40`), así que SIT-054 bloquea igual desde el primer día |
| D15 | El match es por **`nroConvenio`**, que es `@@unique` global en `clave_pago` | Resuelve clave, trámite, empresa y tipo (TOTAL/QUITA) de una sola vez, sin depender de remesas, sin depender de que el trámite esté en un solo caso y sin comparar importes contra `montoTotal` |
| D16 | El pago con clave guarda `idExterno = MC-<convenio>-<AAAAMMDD>-<centavos>` cuando el archivo no trae id de cobro, y **la llave derivada NO saltea la heurística de duplicados** | Esos pagos no traen `PAYMENT_ID` (columna 29 vacía en los 23). El prefijo `MC-` hace imposible la colisión con cualquier id numérico del cedente; el día y el importe evitan que un segundo pago de la misma clave (Q6) choque contra la unique y se pierda; y no saltear la heurística evita duplicar al recargar un archivo que ya se había cargado antes de mapear el convenio (§10.3b) |
| D17 | El convenio de clave cumplido **no cambia de estado**: queda ACTIVO con la cuota PAGADA | En toda la base solo se usan `ACTIVO` y `ANULADO` (`convenios.service.ts:84,125,227`). Inventar `CUMPLIDO` obligaría a revisar cada `where estado:'ACTIVO'` del sistema por un chip. El chip "Cumplido" se deriva de la cuota |
| D18 | **No se recorre el histórico** para asignar SIT-054 | El número de convenio no se guardó nunca en `pago`, `clave_pago` está vacía en prod y el único indicio disponible ("el pago es la mitad del monto") es una corazonada. Lo que sí se hace es corregir el **signo** de los 20 pagos de julio, que hoy dejan la deuda 50% más alta (§10.8) |

---

## 1. El archivo (verificado sobre las 14.956 claves)

### 1.1 Forma

- ASCII puro, fin de línea **LF** (sin CR), sin línea vacía final.
- Separador `|`. Encabezado de **9** nombres; cada fila de datos trae **10** columnas. La 10ª no tiene
  nombre y vale `C` en las 14.956 filas.
- 7.478 trámites × exactamente 2 claves. Las dos filas de un trámite vienen **contiguas** en este
  archivo (0 trámites partidos), pero el diseño no lo asume.

| # | Columna | Forma verificada | Uso |
|---|---|---|---|
| 0 | `NRO_TRAMITE` | 10 dígitos | Identidad; cruza con `deudor.nroCliente` |
| 1 | `NRO_CONVENIO` | 8 dígitos, único por fila (14.956 distintos) | Identidad de la clave (único global) |
| 2 | `SALDO_TRAMITE` | decimal con punto | Saldo informado por Telecom; aviso contra el saldo del caso |
| 3 | `IMPORTE_TOTAL_CLAVE` | decimal con punto, **0, 1 o 2 decimales** (416 sin decimales, 984 con uno) | Importe de la clave. Mínimo 4.831,91; máximo 2.706.359,21 |
| 4 | `CLAVE_PAGO` | 22 dígitos | Se muestra en la ficha |
| 5 | `FECHA_VENCIMIENTO` | `YYYYMMDD` (todo el archivo `20261027`) | Vencimiento de la clave |
| 6 | `SEC_COD_BARRA` | 50 dígitos | Se imprime en el cupón, tal cual |
| 7 | `CODIGO_GESTOR` | `1008` en todas | Validación: la clave es de Ana Maya |
| 8 | `APELLIDO_NOMBRE_RAZON_SOCIAL` | siempre `Ana Maya S.A.` | **No** es el cliente; se ignora |
| 9 | (sin nombre) | siempre `C` | Se guarda crudo en `marca` (pregunta Q2) |

> El importe se parsea **como texto a centavos enteros** (`"19880.01"` → `1988001`), nunca con
> `parseFloat(x) * 100`: la conversión por float es la que produce `1988000.9999`.

### 1.2 `CLAVE_PAGO` (22 dígitos)

```
00 | NRO_CONVENIO (8) | importe en centavos (11) | DV (1)
0096332206000019880014  →  00 · 96332206 · 00001988001 · 4
```

### 1.3 `SEC_COD_BARRA` (50 dígitos)

```
498 | importe en centavos (10) | vto DDMMAAAA (8) | 000000000000 (12) | NRO_CONVENIO (8) | 00000000 (8) | DV (1)
49800019880012710202600000000000096332206000000007
→ 498 · 0001988001 · 27102026 · 000000000000 · 96332206 · 00000000 · 7
```

50 dígitos es par, que es lo que necesita Code 128 **set C** para codificar todo el número de a pares
de dígitos por símbolo, sin tener que alternar de set a mitad de camino (§7.3).

### 1.4 Dígito verificador

Módulo 10 con pesos `3,1,3,1…` desde la **izquierda** sobre todos los dígitos anteriores;
`DV = (10 − suma % 10) % 10`. Valida en el 100% de las claves y los códigos del archivo, en el cupón
PDF de ejemplo (`49800043782691508202600000000000094674769000000004`) y en la clave de la grilla del
sistema viejo (`0094672801000054877985`).

### 1.5 Clasificación TOTAL / QUITA

- La clave de **menor importe** del trámite es la QUITA; la otra, la TOTAL. En los 7.478 trámites los
  dos importes son distintos.
- `importe < SALDO_TRAMITE` **no sirve**. En dos trámites la fila de quita trae un `SALDO_TRAMITE`
  igual a su propio importe (la mitad), así que las dos filas "parecen" totales:

  ```
  12294: 2598157072|96315830|16414.17|16414.17|…   ← QUITA (menor importe)
  12295: 2598157072|96319178|32828.35|32828.35|…   ← TOTAL
  12850: 2598290522|96308508|13738.79|13738.79|…   ← QUITA
  12851: 2598290522|96327144|27477.59|27477.59|…   ← TOTAL
  ```

  El `saldoTramite` que se guarda para **las dos** claves es el de la fila TOTAL.

- La quita **no es recalculable**. Sobre los 7.478 trámites: 3.797 son la mitad exacta, 1.903 la mitad
  **truncada** al centavo (`39760.03` → `19880.01`) y 1.778 la mitad **redondeada** hacia arriba
  (`121143.49` → `60571.75`). Ninguno cae fuera de `{piso, techo}` de la mitad. Siempre se usa el
  importe del archivo.

### 1.6 Cruces

- Los 7.478 trámites **no están** en producción: 0 coincidencias contra `deudor.nroCliente` y
  `documento` de las empresas 1, 9, 10 y 11 (29.187 casos) — cruce hecho por el usuario, solo lectura.
- Tampoco están en el CA del 27/05: **0 de 7.478** contra la columna 8 de ese archivo (verificado
  para este spec). El archivo de claves es de una asignación que no tenemos.
- **El CA mezcla productos**: el del 27/05 trae `POS_MOV` (10.571 filas), `POS_VOZ_CO` (5.491) y
  `POS_NI` (3.476) en un mismo archivo. Es razonable esperar lo mismo del archivo de claves (Q1).
- En el CA, el trámite (col 8) es casi 1:1 con la cuenta (col 10): 19.438 trámites y 19.439 cuentas.
  Los 99 trámites repetidos son filas idénticas salvo el teléfono (col 43).
- El archivo de cobros de Prebaja Fan viene **por cuenta** de 16 dígitos
  (`CUENTA_CODE_PAYMENT_ACCOUNT`), sin trámite y **sin clave ni convenio**. El de **posbaja no es
  igual**: trae el trámite en la columna 5 y el número de convenio en la 23 (verificado el 2026-09-16
  sobre `MA_20260911…_C.txt`, §10.1). Con eso el riesgo R4 queda cerrado y la regla por archivo es
  aplicable. La cartera de prebaja, si algún día usa multiclaves, necesitaría su propio análisis.

### 1.7 El cupón del sistema viejo

A4 vertical. Arriba, tres talones en una fila separados por líneas verticales (anchos aproximados
52% / 23% / 25%) y una línea de corte punteada debajo. Abajo a la izquierda, a ~¾ de la hoja, los
medios de pago.

| Elemento | Talón 1 (Telecom Personal) | Talón 2 (banco) | Talón 3 (cliente) |
|---|---|---|---|
| Logo Personal | sí | sí | sí |
| `Importe $` (formato `43782.69`) | sí | sí | sí |
| `Nombre y apellido` | sí | sí | sí |
| `Vto: 15/09/2026` | **solo acá** | — | — |
| `Cliente n°` (= trámite) | sí | sí | sí |
| `Son Pesos: … con 69 centavos` | sí | sí | sí |
| Código de barras + dígitos debajo | **solo acá** | — | — |
| Número de referencia (`46992372`, id del caso en el sistema viejo) | — | — | sí |
| Leyenda al pie | `TALON PARA Telecom Personal Argentina S.A. - FIRMA, SELLO Y FECHA AL DORSO` | `TALON P/EL BANCO - FIRMA, SELLO Y FECHA AL DORSO` | `TALON P/EL CLIENTE - FIRMA, SELLO Y FECHA AL DORSO` |

Pie: `Usted podrá abonar este cupón en: PAGO FACIL / RAPIPAGO / BAPRO PAGOS / COBRO EXPRESS`.

Dos detalles:

- El código dice vencimiento `15082026` y el talón imprime `Vto: 15/09/2026`: un mes más. Esto era
  la pregunta Q3, cerrada el 2026-09-14 (D12): el sistema nuevo no copia esta regla del sistema
  viejo — imprime `hoy + 7 días`, con tope en el vencimiento real, nunca un corrimiento fijo sobre
  la fecha del código.
- El texto dice "cuarenta **tres** mil" — le falta la "y". El nuestro va en castellano correcto
  ("cuarenta y tres mil"); la boca de pago lee el código, no las letras.

---

## 2. Reglas de negocio

| # | Regla |
|---|---|
| R1 | Una clave pertenece a `(empresaId, nroTramite)`. Se usa desde cualquier caso de esa empresa cuyo `nroCliente` sea el trámite |
| R2 | Por trámite hay a lo sumo **una tanda vigente**: 0, o exactamente 1 TOTAL y a lo sumo 1 QUITA, siempre de la misma carga (una tanda puede traer 1 clave —SOLO_TOTAL, fase 1.1— o 2). Una tanda nueva con vencimiento igual o posterior deja **todas** las vigentes anteriores `REEMPLAZADA` — nunca quedan mezcladas una QUITA vieja con una TOTAL nueva de otra tanda. Una tanda con vencimiento anterior al vigente entra ya como `REEMPLAZADA`, con aviso |
| R3 | Una clave **nunca se borra** si tiene un convenio asociado (de cualquier estado) |
| R4 | Recargar el mismo archivo no cambia nada (idempotente por `nroConvenio`) |
| R5 | El cupón imprime el `SEC_COD_BARRA` del archivo. Si el importe, el vencimiento o el convenio del código no coinciden con las columnas, la clave se rechaza al cargar |
| R6 | Generar un cupón crea un convenio `CLAVE_PAGO` de 1 cuota, por el importe de la clave, con vencimiento de cuota = vencimiento de la clave |
| R7 | Un caso cancelado (categoría CANCELADO, `deudor-bloqueo.ts`) no genera ni reimprime cupones |
| R8 | Una clave `REEMPLAZADA` o vencida (D9) no genera cupón nuevo. Un convenio ya creado sobre una clave que después quedó reemplazada **sigue activo** y su pago sigue cancelando. Un pago **cobrado** sobre una clave reemplazada o vencida también cancela (R11): el estado de la clave en nuestra base no cambia que la plata entró |
| ~~R9~~ | ~~Cancelación por convenio de clave (regla b, respaldo)~~ — **descartada en la auditoría de la fase 4a, nunca llegó a producción** (§10.10): condonaba deuda por un TOTAL acumulado sin mirar de dónde vino la plata. No hay código que la implemente |
| ~~R10~~ | ~~Un convenio de clave ANULADO no cuenta para R9~~ — sin objeto: R9 no existe |
| R11 | **Cancelación por el archivo de cobros (única regla)**: un pago cuyo `nroConvenio` corresponde a una clave de la misma empresa, por un importe que alcanza el de la clave (tolerancia en centavos), cancela la cuenta con **saldo 0** — SIT-054 si la clave es QUITA, SIT-050 si es TOTAL — **aunque no haya ningún convenio en la plataforma** (D13). Un pago sin `nroConvenio` (manual, o de una plantilla que no mapea el campo) no cancela por esta vía, sin importar si el caso tiene un convenio `CLAVE_PAGO` |
| R12 | La consolidación sigue siendo idempotente y mandatoria: R11 se recalcula en cada corrida |
| R13 | Un pago con `nroConvenio` de una clave que **todavía no está cargada** guarda igual la referencia. Cuando se carguen las claves de esa nómina, la consolidación siguiente cancela el caso sin intervención |
| R14 | Un caso cancelado con quita **no se "descancela"** porque después suba la deuda: la clave está pagada. Solo vuelve atrás si desaparece el pago o la clave |

---

## 3. Impacto

| Área | Qué cambia | Qué se rompe si sale mal |
|---|---|---|
| `schema.prisma` | Tabla nueva `clave_pago`; columnas nuevas en `convenio`; valor `MULTICLAVES` en dos enums; dos índices en `deudor`. Fase 4: `pago.referenciaClave` | Un `db push` a medio aplicar (memoria del deploy del 28/08). Todo es aditivo; ver §4.6 |
| `imports` | Categoría, parser, processor, rama de preview, rama del runner, exención de estados por defecto, número de remesa, borrado. Fase 4: campo mapeable `nroConvenio` en PAGOS, resolución del caso por clave, `idExterno` derivado, avisos y vista previa de la carga de pagos | La numeración de remesas de la empresa (D5); el borrado de una carga que ya tiene cupones. **Fase 4: `pagos.processor` lo usan todas las carteras** — un error en el anti-duplicados duplica o pierde cobranza |
| `convenios` | Tipo `CLAVE_PAGO`, creación desde clave, reimpresión | Convenios duplicados por doble clic; convenios de clave anulables sin reconsolidar |
| `consolidacion` | Fase 4a: regla R11 (archivo, única — R9/R10 descartadas en la auditoría, §10.10), código nuevo SIT-054, contadores `aSIT054`/`aSIT050PorClave`/`sit054Degradado`, `saldo = 0` para cancelados por clave, cuota del convenio a PAGADA, dos variables de entorno | **Todas** las carteras pasan por esta consolidación. Un error en la query nueva puede cancelar casos que no pagaron, o devolverle el 50% de saldo a una cuenta ya cancelada |
| `parametro` (catálogo) | Código nuevo `SIT-054` (categoría CANCELADO), por seed y por script idempotente | Si falta en prod, la regla cancela a SIT-050 y cuenta `sit054Degradado`; se corrige sola al crear el código. Si se crea **sin** `empresa_parametro`, no aparece en los selectores |
| Códigos `SIT-050` hardcodeados | Cinco lugares comparan contra la clave y no contra la categoría (§10.7) | Una acción masiva "salteando canceladas" modifica cancelados con quita; el combo de remesas los cuenta como vivos; borrar el último pago no los devuelve al default |
| `email-sender` | Reuso de `enviar` con adjunto; plantilla de Sender configurada por empresa | Mail que sale con variables vacías; mail que falla y el operador cree que salió |
| `auth` | Permiso `convenios.generar_cupon` (backend + copia del front) | Permiso invisible si falta en la copia (el test lo frena) |
| `empresas` | `configuracion.multiclaves` | Pisar la config de mora al guardar la de multiclaves (`empresas.service.ts:31-38` reemplaza el JSON entero) |
| Ficha | Sección "Claves de pago" en la solapa Convenios, diálogo Generar cupón, chips en convenios | — |
| Wizard / plantillas / historial | Categoría nueva y su resumen | Operador que carga en la empresa equivocada sin enterarse |
| Reportes, tableros, Neotel | Tableros: **sin cambios**, agrupan por categoría CANCELADO (`dashboards.service.ts:89,101`), así que SIT-054 entra solo. Reportes: el selector de situación sale del catálogo, así que SIT-054 aparece solo; **los reportes ya guardados que filtran "situación = SIT-050" dejan de ver los cancelados con quita** — aviso en la wiki y en el CHANGELOG | Un reporte de liquidación que venía filtrando por SIT-050 empieza a devolver de menos sin dar ningún error |
| Ficha / consolidación (front) | Chip `Cumplido` en el convenio y la clave, aviso de "cancelado con quita" con el importe perdonado, filas `aSIT054` y `aSIT050PorClave` en el modal de consolidación, resumen de la carga de pagos | — |

Datos ya cargados: los **20 pagos con multiclave de julio** (empresa 9) quedan inconsistentes y ya lo
estaban — importe negativo, saldo 50% más alto que el original, los 20 casos en SIT-041. La fase 4 no
los toca: se corrigen con un script aparte (§10.8). Fuera de eso no hay backfill — `referenciaClave`
nace `NULL` y la regla no mira los pagos que no la tienen.

---

## 4. Schema (Prisma)

> `npx prisma db push`, nunca `migrate dev`. Todo lo de las fases 1–4 va en **un solo push** (fase 1),
> aunque las columnas de `convenio` no se usen hasta la fase 2: un deploy con push menos es un riesgo
> menos.

### 4.1 Modelo nuevo `clave_pago`

```prisma
/// Clave de pago precargada por el cedente (Telecom/Personal manda 2 por trámite: saldo total y quita).
///
/// Se guarda por (empresaId, nroTramite) y NO por deudor: las claves llegan antes que el CA, un trámite
/// puede estar en varias remesas y un CA borrado y recargado cambia los ids. El caso se resuelve al
/// usarla (deudor.nroCliente = nroTramite, misma empresa). Ver docs/multiclaves-spec.md §6.
model clave_pago {
  id                     Int        @id @default(autoincrement())
  empresaId              Int
  /// Remesa de categoría MULTICLAVES que la trajo.
  remesaId               Int
  nroTramite             String     @db.VarChar(20)
  /// NRO_CONVENIO de Telecom. Único en toda la base.
  nroConvenio            String     @db.VarChar(8)
  /// TOTAL | QUITA
  tipo                   String     @db.VarChar(10)
  importe                Decimal    @db.Decimal(14, 2)
  /// SALDO_TRAMITE de la clave TOTAL del par (el mismo valor en las dos claves).
  saldoTramite           Decimal    @db.Decimal(14, 2)
  fechaVencimiento       DateTime   @db.Date
  clavePago              String     @db.VarChar(22)
  codigoBarras           String     @db.VarChar(50)
  codigoGestor           String     @db.VarChar(10)
  /// 10ª columna sin nombre del archivo ('C'). Se guarda cruda hasta saber qué significa.
  marca                  String?    @db.VarChar(10)
  /// VIGENTE | REEMPLAZADA. "Vencida" no se guarda: se deriva de fechaVencimiento.
  estado                 String     @default("VIGENTE") @db.VarChar(12)
  reemplazadaEn          DateTime?
  /// Remesa MULTICLAVES cuya tanda reemplazó a esta. Sin FK a propósito: al borrar esa remesa se
  /// usa para devolver esta clave a VIGENTE (§5.8).
  reemplazadaPorRemesaId Int?
  /// Línea del archivo (1-based), para poder reclamar al cedente.
  lineaArchivo           Int
  createdAt              DateTime   @default(now())
  empresa                empresa    @relation(fields: [empresaId], references: [id], map: "ClavePago_empresaId_fkey")
  remesa                 remesa     @relation(fields: [remesaId], references: [id], map: "ClavePago_remesaId_fkey")
  convenios              convenio[]

  @@unique([nroConvenio], map: "ClavePago_nroConvenio_key")
  @@index([empresaId, nroTramite, estado], map: "ClavePago_empresa_tramite_estado_idx")
  @@index([remesaId], map: "ClavePago_remesaId_fkey")
  @@index([reemplazadaPorRemesaId], map: "ClavePago_reemplazadaPorRemesaId_idx")
}
```

Relaciones inversas: `empresa.clavesPago clave_pago[]`, `remesa.clavesPago clave_pago[]`.

`Decimal` y no `Float` (como `tasa_mora`): el importe viaja dentro de un código de barras y tiene que
ser exacto. Prisma devuelve `Decimal`; la API lo serializa como **string** `"19880.01"`.

`@db.Date` para el vencimiento: se guarda el día sin hora y el front lo muestra con
`fechaDelCedente()` (CHANGELOG 31/08).

### 4.2 `convenio` — columnas nuevas

```prisma
model convenio {
  // ...campos existentes...
  /// 'CLAVE_PAGO' cuando se generó desde una clave del cedente; null en LIBRE/AUTOMATICO.
  origen        String?     @db.VarChar(20)
  clavePagoId   Int?
  /// Saldo sobre el que Telecom calculó la clave (clave_pago.saldoTramite).
  montoOriginal Float?
  /// montoOriginal − montoTotal. 0 en una clave TOTAL.
  importeQuita  Float?
  clavePago     clave_pago? @relation(fields: [clavePagoId], references: [id], map: "Convenio_clavePagoId_fkey")

  @@index([clavePagoId], map: "Convenio_clavePagoId_fkey")
  @@index([deudorId, origen, estado], map: "Convenio_deudor_origen_estado_idx")
}
```

`convenio.tipo` toma el valor `CLAVE_PAGO` (hoy `LIBRE`/`AUTOMATICO`, `convenios.service.ts:51-57`).
Se agrega además `origen` para que las queries de la consolidación usen el índice sin depender del
texto de `tipo`.

### 4.3 Enums

`MULTICLAVES` al final de `plantillaimport_categoria` y de `remesa_categoria`
(`schema.prisma:477-501`). Mismo cambio que se hizo con `MULTIARCHIVO`, sin pérdida de datos.

### 4.4 `deudor` — índices

```prisma
  @@index([empresaId, nroCliente], map: "Deudor_empresaId_nroCliente_idx")
  @@index([nroCliente], map: "Deudor_nroCliente_idx")
```

Hoy solo existe `[empresaId, remesaId, nroCliente]` (`schema.prisma:119`), que no sirve para buscar
un trámite **sin** remesa. El segundo índice es para el aviso de "el trámite está en otra empresa"
(§5.6).

### 4.5 Fase 4 — `pago.referenciaClave`

```prisma
  /// NRO_CONVENIO de la clave con la que se pagó, si el archivo de cobros lo informa (normalizado
  /// desde convenio de 8, clave de 22 o código de barras de 50 dígitos). Ver multiclaves-spec §10.
  referenciaClave String? @db.VarChar(8)
  @@index([referenciaClave], map: "Pago_referenciaClave_idx")
```

Push aparte, en la fase 4a. Aditivo y nullable: no pide `--accept-data-loss` y no hay backfill (§10.8).
La unique existente `@@unique([deudorId, idExterno], map: "Pago_deudorId_idExterno_key")` **no se
toca**: el `idExterno` derivado de la clave (D16) convive con ella tal cual.

### 4.6 Aplicación y verificación del push

1. Local: `npx prisma db push && npx prisma generate`.
2. Revisar que el push **no pida** `--accept-data-loss`. Si lo pide, leer el warning concreto antes de
   seguir (una unique sobre una tabla nueva no debería dispararlo; una sobre una columna nueva de una
   tabla existente sí — por eso `nroConvenio` es unique solo en la tabla nueva).
3. Después del deploy, en prod: `prisma migrate diff --from-schema-datasource … --to-schema-datamodel … --script`
   tiene que dar "This is an empty migration".

Sin backfill.

---

## 5. Carga (imports)

### 5.1 Categoría y plantilla

- `processor-registry.ts:19-30`: registrar `new MulticlavesProcessor()`.
- La plantilla existe en la base solo porque el pipeline exige `plantillaId` (`imports.service.ts:612`).
  Se crea desde el editor con categoría **Claves de pago (multiclaves)**, separador `|`,
  `tieneHeader: true`, y este `mappingJson`:

  ```json
  { "entity": "MIXTO", "columns": {}, "multiclaves": { "codigosGestor": ["1008"] } }
  ```

  El único parámetro editable es `codigosGestor`. El layout vive en
  `backend/src/modules/imports/plantillas/telecom-multiclaves.ts` y **no se lee de la plantilla** (D2).
- Estados por defecto: no aplican. `imports.service.ts:1418-1424` exime hoy solo a ACCIONES; pasa a
  eximir `ACCIONES` y `MULTICLAVES`.

### 5.2 Empresa

La elige el operador en el wizard, como en toda carga. Todas las claves de la carga quedan en esa
empresa. El error típico (elegir TELECOM cuando los casos están en TELECOM_PERSONAL) se hace visible
en la vista previa (§5.6), no se corrige solo.

### 5.3 Número de remesa

`resolverNumeroRemesa` (`imports.service.ts:365-371`) → `siguienteNumeroRemesa`
(`utils/numero-remesa.ts`) toma el **máximo numérico** de la empresa y le suma 1. Una carga de
multiclaves con el número vacío consumiría el `00609` de Telecom y la próxima asignación saldría
`00610`: la numeración que el operador corrige a mano (CHANGELOG 31/08) se correría en silencio.

- En `createRemesa`, si `categoria === 'MULTICLAVES'`:
  - número vacío → `MC-AAAAMMDD-HHmm` (hora Argentina). No matchea `/^\d{1,6}$/`, así que
    `siguienteNumeroRemesa` lo ignora para siempre.
  - número tipeado **puramente numérico** → 400: *"Las cargas de claves de pago no usan el número
    correlativo de remesas. Dejá el número vacío o usá uno con letras."*
  - `divisiones` → 400 (no se divide una carga de claves).
- Varios archivos en la misma carga: se aceptan (Telecom y Personal podrían venir separados, Q1).
  Se recorren como uno solo; `nroConvenio` único resuelve las repeticiones.

### 5.4 Parser — `backend/src/modules/imports/utils/multiclaves-parser.ts`

Función pura, testeable sin base:

```ts
export function parseMulticlaves(
  archivos: Array<{ buffer: Buffer; nombre: string }>,
  cfg: { codigosGestor: string[] },
  hoy: Date,                                   // inyectable para tests de "ya vencida"
): {
  tramites: TramiteClaves[];                   // grupos listos para el processor (incluye rechazados)
  avisos: AvisoMulticlaves[];                  // agregados por código
  resumen: { lineas: number; claves: number; tramites: number; rechazados: number;
             porMotivo: Record<MotivoRechazo, number>; porAviso: Record<CodigoAviso, number> };
}

interface TramiteClaves {
  nroTramite: string;
  lineas: number[];                            // 1-based, con nombre de archivo si hay varios
  rechazo?: { motivo: MotivoRechazo; detalle: string };
  saldoTramiteCentavos?: number;               // el de la TOTAL
  claves?: Array<{                              // 1 (SOLO_TOTAL) o 2 si no hay rechazo
    tipo: 'TOTAL' | 'QUITA';
    nroConvenio: string; importeCentavos: number; clavePago: string; codigoBarras: string;
    fechaVencimiento: string /* YYYY-MM-DD */; codigoGestor: string; marca: string | null; linea: number;
  }>;
}
```

Utilidades puras en `backend/src/modules/multiclaves/utils/clave-pago.ts` (las usa el parser y el
servicio del cupón):

```ts
export function dvModulo10_31(digitos: string): number;          // pesos 3,1,3,1… desde la izquierda
export function centavosDeTexto(v: string): number | null;        // /^\d{1,12}(\.\d{1,2})?$/, sin float
export function descomponerClave(clave22: string): { convenio: string; centavos: number; dv: number } | null;
export function descomponerCodigoBarras(cb50: string): { centavos: number; vto: string /*YYYY-MM-DD*/; convenio: string; dv: number } | null;
export function formatoImporteCupon(centavos: number): string;    // 4378269 → "43782.69"
export function normalizarReferenciaClave(v: string): string | null; // 8 → tal cual; 22 → [2,10); 50 → [33,41)
```

**Pasos:**

1. Decodificar como `latin1`, separar por `\r?\n`, descartar líneas vacías.
2. **Encabezado**: si la primera línea empieza con `NRO_TRAMITE|`, comparar los 9 nombres esperados
   (sin distinguir mayúsculas). Si no coinciden → **error del archivo entero** (400 en la vista
   previa): *"El archivo no tiene el encabezado de multiclaves; ¿es el archivo correcto?"*. Si la
   primera línea no es encabezado pero parsea como datos → aviso `SIN_ENCABEZADO` y se procesa. No se
   depende de `plantilla.tieneHeader`.
3. **Por línea**, validar en este orden; el primer fallo es el motivo:

   | Motivo | Condición |
   |---|---|
   | `COLUMNAS` | menos de 9 o más de 10 columnas |
   | `TRAMITE_INVALIDO` | no es `/^\d{1,20}$/` |
   | `CONVENIO_INVALIDO` | no es `/^\d{8}$/` |
   | `IMPORTE_INVALIDO` | `centavosDeTexto` devuelve null (coma decimal, más de 2 decimales, vacío) |
   | `IMPORTE_NO_POSITIVO` | centavos ≤ 0 |
   | `SALDO_INVALIDO` | ídem sobre `SALDO_TRAMITE` |
   | `FECHA_INVALIDA` | no es `YYYYMMDD` de calendario válido |
   | `GESTOR_AJENO` | `CODIGO_GESTOR` ∉ `codigosGestor` |
   | `CLAVE_FORMATO` | no son 22 dígitos o no empieza con `00` |
   | `CLAVE_DV` | DV incorrecto |
   | `CLAVE_NO_COINCIDE` | convenio o importe embebido ≠ columnas 1 y 3 |
   | `BARRA_FORMATO` | no son 50 dígitos, no empieza con `498`, o los bloques de ceros no son ceros |
   | `BARRA_DV` | DV incorrecto |
   | `BARRA_NO_COINCIDE` | importe, vencimiento o convenio del código ≠ columnas 3, 5 y 1 |
   | `CONVENIO_REPETIDO_EN_ARCHIVO` | el `NRO_CONVENIO` ya apareció en una línea anterior |

   Una línea que no tiene ni trámite legible queda como grupo propio (`__linea_N`).
4. **Agrupar por trámite** (Map, sin asumir contigüidad).
5. **Por trámite**:

   | Motivo / aviso | Condición | Efecto |
   |---|---|---|
   | `TRAMITE_INCOMPLETO` | 3+ líneas (aunque todas sean válidas), o 1-2 líneas con alguna inválida | **Rechaza el trámite entero**, citando las líneas y el motivo de la línea caída. Cargar media tanda reemplazaría un par bueno por uno incompleto |
   | `IMPORTES_IGUALES` | las 2 claves (cuando hay 2) tienen el mismo importe | Rechaza: no se puede decidir cuál es la quita |
   | aviso `SOLO_TOTAL` (fase 1.1) | exactamente 1 línea válida, sin su par, **con `IMPORTE_TOTAL_CLAVE == SALDO_TRAMITE` exacto en centavos** | **No rechaza**: se acepta clasificada como TOTAL. No hay forma de fabricar la quita. **Esperado: 1** en `MULTI_41647` (trámite `2577727090`) |
   | `CLAVE_UNICA_NO_ES_TOTAL` (fase 1.1) | exactamente 1 línea válida y su importe ≠ `SALDO_TRAMITE` | **Rechaza el trámite**: puede ser una quita sin su total, y un cupón "por el saldo total" a mitad de precio no se puede deshacer |
   | aviso `SALDO_DISTINTO_ENTRE_FILAS` | `SALDO_TRAMITE` distinto entre las 2 filas (no aplica a SOLO_TOTAL) | Se toma el de la TOTAL. **Esperado: 2** en el archivo de muestra |
   | aviso `TOTAL_DISTINTO_DE_SALDO` | importe TOTAL ≠ saldo de la TOTAL, en un par (no aplica a una línea sola: ahí es `CLAVE_UNICA_NO_ES_TOTAL`) | Carga igual. Esperado: 0 |
   | aviso `QUITA_NO_ES_MITAD` | centavos QUITA ∉ {⌊total/2⌋, ⌈total/2⌉} (no aplica a SOLO_TOTAL: no hay quita) | Carga igual (Telecom podría cambiar el %). Esperado: 0 |
   | aviso `VTO_DISTINTO_ENTRE_CLAVES` | vencimientos distintos (no aplica a SOLO_TOTAL) | Carga igual |
   | aviso `YA_VENCIDA_AL_CARGAR` | vencimiento < hoy | Carga igual |
   | aviso `MARCA_DESCONOCIDA` | 10ª columna ausente o ≠ `C` | Carga igual, se guarda lo que venga |
   | aviso `TRAMITE_LARGO_INESPERADO` | trámite ≠ 10 dígitos | Carga igual |

6. Clasificar: menor importe = QUITA; con una única línea válida, siempre TOTAL (D4, y decisión de
   Ana Maya del 2026-09-14 para el caso SOLO_TOTAL, §20).

Los avisos se acumulan **por código** con el conteo y los primeros 20 trámites, no uno por fila.

### 5.5 Processor — `backend/src/modules/imports/processors/multiclaves.processor.ts`

El runner lo trata como preparsado, igual que MULTIRREGISTRO (`imports.service.ts:1635-1675`): una
"fila" = un trámite. Rama nueva `esMulticlaves` que llama a `parseMulticlaves` con los archivos de la
remesa (`archivosDeRemesa`), escribe los avisos en `importerror` con prefijo `[aviso]` y
`rowNumber: 0` (sin contarlos como error), y empuja los trámites al lote.

**Sin estado de instancia.** Los processors del registry son singletons compartidos entre corridas
(`processor-registry.ts:19`); `FacturasProcessor` guarda caches en la instancia. Acá no: los
contadores del resultado se calculan con queries (§5.7).

```
validateRow(row):
  si row.rechazo → { valid:false, error: `[${motivo}] líneas ${lineas}: ${detalle}` }

processBatch(rows, ctx):                                    // rows válidas del lote (≤ IMPORTS_BATCH_SIZE)
  convenios  = todos los nroConvenio del lote
  tramites   = todos los nroTramite del lote

  1. existentesPorConvenio = clave_pago WHERE nroConvenio IN convenios            (cualquier empresa)
  2. vigentesPorTramite    = clave_pago WHERE empresaId = ctx.empresaId
                               AND nroTramite IN tramites AND estado = 'VIGENTE'

  3. por trámite t (idx), con N = t.claves.length (1 si SOLO_TOTAL, 2 si TOTAL+QUITA — fase 1.1):
     ya = existentes de sus N convenios
     a. ya.length == N y todos (empresaId, nroTramite) == (ctx.empresaId, t)
          → YA_CARGADA: no escribe, cuenta OK                                    (R4)
     b. alguno de `ya` es de otra empresa o de otro trámite
          → error `[CONVENIO_YA_EXISTE] El convenio 96311343 ya está cargado para el trámite X
             en la empresa Y (remesa Z)`
     c. 0 < ya.length < N (mismo trámite, tanda incompleta)
          → error `[TANDA_PARCIAL] …` (inconsistencia; no se toca)
     d. vig = vigentesPorTramite[t]                          (0, 1 o 2 filas, de cualquier tanda previa)
        si vig vacío            → insertar N claves VIGENTE
        si max(vto nuevo) ≥ max(vto vig)
                                → vig → REEMPLAZADA (reemplazadaEn=now, reemplazadaPorRemesaId=ctx.remesaId)
                                  insertar N claves VIGENTE                        (REEMISION)
        si no                   → insertar N claves REEMPLAZADA
                                  (reemplazadaPorRemesaId = remesaId de las vig) + aviso TANDA_ANTERIOR

     El paso "d" reemplaza **todas** las filas de `vig`, sea cual sea su cantidad: una tanda vigente
     de 2 (TOTAL+QUITA) puede ser reemplazada por una de 1 (SOLO_TOTAL), y viceversa, sin que nunca
     convivan una QUITA de una tanda vieja con una TOTAL de una tanda nueva (R2).

  4. Escribir: un $transaction por lote con los updateMany de reemplazo + createMany de las nuevas.
     Si el lote falla, reintentar trámite por trámite (patrón de facturas.processor.ts:136-150) para que
     el error caiga en el trámite que lo causó.

  5. Devolver BatchRowError[] por los trámites con error.

afterAll(ctx):
  log del resumen (§12). No escribe nada. Recordatorio: los errores de afterAll se tragan
  (imports.service.ts:1763-1768), así que nada que importe puede vivir acá.
```

Concurrencia: el worker de `import-queue` no declara `concurrency` (default 1), así que dos cargas no
corren en paralelo. La unique de `nroConvenio` protege de todos modos contra duplicados.

Las claves rechazadas **no se guardan**. Quedan en `importerror` con la línea cruda y el motivo.

### 5.6 Vista previa — rama `MULTICLAVES` en `validateRemesa` (`imports.service.ts:874`)

El archivo es chico (2 MB, 15 mil líneas): se parsea **entero**, no una muestra.

```
1. parseMulticlaves(archivos, cfg, hoy)
2. trámites válidos → en chunks de 1000:
     conCaso      = SELECT DISTINCT nroCliente FROM deudor WHERE empresaId = ? AND nroCliente IN (…)
     enOtraEmpresa= SELECT nroCliente, empresaId, COUNT(*) FROM deudor
                    WHERE nroCliente IN (sinCaso) AND empresaId <> ? GROUP BY …
3. yaCargadas    = trámites cuyos 2 convenios ya existen en esta empresa
   conflictos    = convenios que existen en otra empresa u otro trámite
   reemisiones   = trámites con claves VIGENTE distintas en esta empresa
4. remesa.update(estadoProceso VALIDANDO, totalFilas = trámites, okFilas = válidos, errFilas = rechazados)
```

Respuesta (se agrega al objeto que ya devuelve `validateRemesa`):

```ts
multiclaves: {
  lineas: number; claves: number; tramites: number;
  validos: number; rechazados: number;
  soloTotal: number;   // fase 1.1: de los válidos, cuántos trajeron una única clave (sin quita)
  porMotivo: Record<string, number>;
  conCaso: number; sinCaso: number;
  enOtraEmpresa: Array<{ empresaId: number; empresa: string; tramites: number }>;
  yaCargadas: number; reemisiones: number; conflictos: number;
  vencimientos: Array<{ fecha: string; claves: number }>;
  avisos: Array<{ codigo: string; cantidad: number; ejemplos: string[] }>;
}
advertencias: string[]   // las de siempre, en texto, para el bloque que el wizard ya muestra
```

Advertencias en texto (con números exactos) que se agregan a `advertencias`:

- `sinCaso > 0`: *"3.200 de los 7.478 trámites no tienen caso en TELECOM. Las claves se cargan igual
  y van a aparecer en la ficha cuando llegue el CA."*
- `conCaso == 0 && enOtraEmpresa.length`: *"Ninguno de los 7.478 trámites tiene caso en TELECOM, pero
  5.100 están en TELECOM_PERSONAL. ¿Elegiste la empresa correcta?"* (en rojo en el wizard).
- `rechazados > 0`: *"12 trámites se van a rechazar: 8 por CLAVE_DV, 4 por TRAMITE_INCOMPLETO. Sus
  claves no se cargan."*
- `reemisiones > 0`: *"1.030 trámites ya tenían claves vigentes: las anteriores van a quedar
  reemplazadas. 14 de ellas ya tienen un convenio, que sigue activo."*
- `conflictos > 0`: *"25 convenios ya están cargados en otra empresa u otro trámite y se van a
  rechazar."*
- `soloTotal > 0` (fase 1.1): *"1 trámite(s) llegaron con una sola clave (sin la de quita): se cargan
  igual, clasificada como TOTAL."*
- avisos con `cantidad > 0`, uno por línea (salvo `SOLO_TOTAL`, que ya tiene el mensaje de arriba).

### 5.7 Resumen después de cargar

`GET /api/multiclaves/lotes/:remesaId/resumen` (§9.3) calcula con queries — no se guarda un JSON de
resultado:

- trámites y claves cargadas por la remesa (`clave_pago.remesaId`), por estado;
- **con caso / sin caso hoy** (join por `(empresaId, nroCliente)`; cambia cuando llega el CA, que es
  lo que se quiere);
- rechazados = `remesa.errFilas`, con el detalle en `importerror` (pantalla de detalle existente);
- reemplazadas por esta carga (`reemplazadaPorRemesaId = remesaId`);
- **soloTotal** (fase 1.1): trámites que esta carga trajo con una única clave. Barato — se cuenta en
  memoria agrupando por `nroTramite` las filas que ya se trajeron para los conteos de arriba, sin
  otra query;
- avisos (`importerror` con prefijo `[aviso]`).

`GET /api/multiclaves/lotes/:remesaId/sin-caso?page&pageSize` lista los trámites sin caso para
reclamar o esperar el CA.

### 5.8 Borrado — `deleteRemesa` (`imports.service.ts:2065-2127`)

Rama nueva al principio, si `remesa.categoria === 'MULTICLAVES'`:

```
1. conConvenio = COUNT convenio JOIN clave_pago ON clavePagoId WHERE clave_pago.remesaId = R
   si > 0 → 400 "No se puede eliminar: 14 claves de esta carga ya tienen convenio o cupón emitido." (R3)
2. $transaction:
   a. restaurar = claves WHERE reemplazadaPorRemesaId = R
      por trámite de `restaurar`: si NO queda otra clave VIGENTE del trámite fuera de la remesa R
          → estado VIGENTE, reemplazadaEn NULL, reemplazadaPorRemesaId NULL
        si queda (cadena A→B→C y se borra B) → quedan REEMPLAZADA
   b. DELETE clave_pago WHERE remesaId = R
   c. jobimport, importerror, remesa (como hoy)
3. log con claves borradas y restauradas
```

El chequeo de gestión existente sobre `deudor.remesaId` no cambia: una remesa de deudores con
convenios de clave ya no se puede borrar porque cuenta convenios (`imports.service.ts:2090`).

`empresas.service.ts remove` no necesita cambios: una clave siempre pertenece a una remesa, y las
remesas ya bloquean el borrado de la empresa.

---

## 6. Clave ↔ caso

### 6.1 Por qué no se guarda `deudorId` en la clave

| Guardar `deudorId` resuelto | Resolver al usar |
|---|---|
| Queda `null` para las que llegan antes del CA y hay que re-resolver cuando llega (otro job, otro punto de falla) | Funciona sin hacer nada cuando llega el CA |
| Un trámite en 3 remesas necesita 3 filas o una elección arbitraria | Devuelve los N casos y la UI decide |
| Borrar y recargar el CA deja ids apuntando a nada (o bloquea el borrado por FK) | No hay FK que romper |
| Join barato | Join por índice `(empresaId, nroCliente)` (§4.4): barato igual |

Decisión: **no se guarda**. El caso concreto queda registrado en el **convenio** (`convenio.deudorId`
+ `convenio.clavePagoId`), que es el único momento en que la elección importa.

### 6.2 Resolución

- **Desde la ficha** (caso `D`): claves `WHERE empresaId = D.empresaId AND nroTramite = TRIM(D.nroCliente)`.
  Si `D.nroCliente` es null o vacío → sin claves.
- **Otros casos del mismo trámite**: `deudor WHERE empresaId = D.empresaId AND nroCliente = D.nroCliente AND id <> D.id`,
  con remesa y situación. Si hay alguno no cancelado ni desasignado, la ficha avisa: *"Este trámite
  también está en la remesa 20608 (caso 5123). El pago puede entrar en ese caso y no cancelar este
  convenio."* (riesgo R5, §14).

---

## 7. Cupón PDF

### 7.1 Servicio

`backend/src/modules/multiclaves/cupon-pdf.service.ts`, con pdfmake (patrón de
`reportes/exportadores/pdf.exportador.ts:8,137-140`: `setFonts` con Roboto del paquete,
`createPdf(doc).getBuffer()`).

```ts
interface DatosCupon {
  importeCentavos: number;
  codigoBarras: string;                // el del archivo, 50 dígitos
  nombre: string;                      // [apellido, nombre] unidos, espacios colapsados
  nroTramite: string;
  vtoImpreso: string;                  // DD/MM/AAAA = min(hoy + 7 días corridos AR, fechaVencimiento) (D12)
  referencia: string;                  // deudor.id
  leyendaTalonCedente: string;
  mediosDePago: string[];
  vistaPrevia: boolean;                // D6: marca de agua y sin código de barras
}
generar(d: DatosCupon): Promise<Buffer>
```

Antes de dibujar, **revalida** el código contra el importe y el convenio de la clave con
`descomponerCodigoBarras` + DV. Si no coincide → `InternalServerErrorException` y log `error`: nunca
se imprime un código que no corresponde (defensa ante una edición manual de la base).

### 7.2 Layout

A4 vertical, márgenes 20 pt. Replica §1.7:

- Fila de talones de ~240 pt de alto, anchos 52% / 23% / 25%, separadores verticales de 2 pt, línea
  punteada de corte debajo.
- Cada talón: logo arriba a la izquierda (alto ~28 pt); `Importe $` con recuadro; `Nombre y apellido`
  con recuadro (hasta 2 líneas, se corta con `…`); `Cliente n°` con recuadro; `Son Pesos: …` en negrita
  9 pt.
- Talón 1: `Vto: DD/MM/AAAA`; código de barras con los 50 dígitos debajo en negrita 9 pt.
- Talón 3: referencia abajo a la derecha.
- Leyendas al pie de cada talón en 5 pt.
- Pie: `Usted podrá abonar este cupón en:` + la lista, en serif negrita 11 pt, a ~620 pt de altura.
- `vistaPrevia: true`: sin código de barras (recuadro gris con "El código de barras se genera al
  confirmar") y marca de agua diagonal *"VISTA PREVIA — NO VÁLIDO PARA PAGO"*.

Todo color en negro/gris: el cupón se imprime en impresoras de oficina y en blanco y negro.

### 7.3 Código de barras

**Simbología: Code 128 set C** (`Start C` + 25 símbolos de datos + checksum mod 103 + `Stop`), no
Interleaved 2 of 5. La versión original de este spec eligió ITF sin evidencia — una suposición del
spike, nunca confirmada. La auditoría de la fase 2 decodificó el cupón viejo (`46992372.pdf`) desde
los contornos de su propia fuente de código de barras (`TT17E6t00`, embebida en el PDF) y es Code
128-C: `Start C` (valor 105), 25 símbolos de datos (los 50 dígitos, de a pares), checksum mod 103
verificado, `Stop` (valor 106). Es la simbología que ya leen Pago Fácil/Rapipago hoy — la que había
que replicar, no una a elección.

- Dependencia: **`bwip-js`**, pero **solo para calcular el patrón de anchos de barra/espacio**
  (`raw()`, símbolo `code128`, `parsefnc: false`) — sin `includecheck` (el checksum es parte del
  símbolo, no se agrega aparte) ni `includetext` (los dígitos se imprimen aparte como texto). Con una
  cadena de 50 dígitos, `code128` de bwip-js elige el set C solo (no hace falta forzarlo): confirmado
  decodificando el patrón resultante (Start = 105 en el 100% de las claves probadas).
- **La geometría (módulo, alto, zona muda) NO sale del SVG que arma `bwip-js toSVG()`**:
  `utils/codigo-barras-pdf.ts` arma su propio `<svg>` con rectángulos en puntos exactos a partir de
  los anchos de módulo de `raw()`. Motivo: pdfmake ajusta un SVG a un `width`/`height` dados
  **conservando la relación de aspecto del SVG** — pasarle un `height` propio no alcanza para forzar
  el alto real si el aspecto ya viene fijado por el viewBox de `toSVG()` (bug encontrado por la
  auditoría: con `toSVG()` + `height: 34` el alto real terminaba en 5,74 mm, no los 12 mm pedidos).
- Dimensiones logradas (medidas leyendo el PDF generado, no calculadas): módulo **0,254 mm** (6/600 de pulgada; los PDFs de la auditoría midieron 0,2498 mm con el valor anterior de 0,25)
  (mínimo aceptado 0,20 mm), alto **14 mm** (piso pedido: 12 mm), zona muda **≥ 2,5 mm** (10 módulos)
  a cada lado, sin bordes ni texto adentro. Con 50 dígitos, Code 128-C ocupa 310 módulos (Start 11 +
  25 símbolos × 11 + checksum 11 + Stop 13 = 297 + 13 = 310) ≈ 78,7 mm a 0,254 mm/módulo — entra en el
  talón 1 (~93 mm útiles) sin ajustar el layout.
- **Riesgo R1 (§14) — CERRADO por evidencia, pendiente el gate físico**: la simbología está
  confirmada contra el cupón viejo (Code 128-C, checksum verificado, dígitos exactos). Sigue
  pendiente el gate físico de producción: imprimir un cupón y leerlo con un lector físico y con una
  app, comparando los 50 dígitos contra `SEC_COD_BARRA`. **No asignar el permiso
  `convenios.generar_cupon` en ningún rol de producción hasta hacerlo.**

### 7.4 Importe en letras — `backend/src/modules/multiclaves/utils/importe-en-letras.ts`

`importeEnLetras(centavos: number): string` → `"cuarenta y tres mil setecientos ochenta y dos con 69 centavos"`.

Reglas: `0` → "cero"; `1` → "uno"; `21` → "veintiuno"; `21.000` → "veintiún mil"; `100` → "cien";
`101` → "ciento uno"; `1.000` → "mil"; `1.000.000` → "un millón"; `2.000.000` → "dos millones";
centavos siempre con 2 dígitos ("con 05 centavos", "con 00 centavos"). Sin dependencia externa. Se
antepone "Son Pesos: " en el PDF.

### 7.5 Logo

- `backend/src/modules/multiclaves/assets/logo-personal.png`. Hasta que Ana Maya mande el definitivo,
  un placeholder en gris con la palabra "Personal".
- `nest-cli.json` hoy copia solo `common/data/*.json` a `dist`. Agregar
  `"modules/multiclaves/assets/**/*"` a `compilerOptions.assets`. Sin eso, el logo **no llega a la
  imagen** y el cupón sale sin logo en prod aunque ande en dev.
- Se lee una vez al iniciar el módulo. Si no está → `warn` una vez y el PDF lleva el texto "Personal"
  en negrita gris en lugar de la imagen. Nunca falla por el logo.
- `MULTICLAVES_LOGO_PATH` (opcional) apunta a otro archivo, por ejemplo en el volumen de uploads, para
  reemplazarlo sin deploy.

---

## 8. Generar cupón

### 8.1 Qué hace, en orden

`CuponService.generar(claveId, dto, usuario)` en `backend/src/modules/multiclaves/cupon.service.ts`:

```
t0; log intent: claveId, deudorId, accion, destinatarios=N (no las direcciones)

 1. clave  = clave_pago(claveId)                      → 404 CLAVE_NO_ENCONTRADA
 2. deudor = deudor(dto.deudorId) con nombre, apellido, nroCliente, empresaId, estadoGestionId
                                                      → 404 DEUDOR_NO_ENCONTRADO
 3. clave.empresaId == deudor.empresaId y clave.nroTramite == trim(deudor.nroCliente)
                                                      → 400 CLAVE_NO_CORRESPONDE
 4. bloqueo.assertNoBloqueado(deudorId, 'generar cupón de pago')   → 403 DEUDOR_CANCELADO (R7)
 5. cfg = configuracion.multiclaves de la empresa, con defaults (§9.5)
 6. hoy(AR) ≤ fechaVencimiento                        → 400 CLAVE_VENCIDA       (D9, siempre)
    clave.estado == VIGENTE, o REEMPLAZADA con convenio ACTIVO de esa clave en este caso (R8, se
    resuelve como REUSO en 9c)                        → si no, 400 CLAVE_REEMPLAZADA
 7. si accion incluye ENVIAR (implementado en la fase 3; la plantilla es OPCIONAL — ver §8.4 y el
    desvío del §20, esta condición reemplaza la del diseño original que exigía `cfg.templateCuponId`):
      usuario.permisos incluye 'email.enviar'          → 403
      destinatarios ≥ 1, cada uno pasa esPosibleEmail  → 400 DESTINATARIOS_INVALIDOS
      empresa.cuentaSmtpId != null (`smtpDeEmpresa`)   → 400 EMPRESA_SIN_SMTP
      si dto.templateId: variables de la plantilla sin valor (§8.4) → 400 PLANTILLA_CON_VARIABLES_VACIAS
      si NO dto.templateId: mensaje por defecto (`utils/cupon-mail.ts`), no corta nada
 8. pdf = cuponPdf.generar({... vistaPrevia:false})   (antes de escribir nada: si falla, no queda
                                                        un convenio sin cupón; si accion incluye
                                                        ENVIAR, este mismo buffer es el adjunto del
                                                        mail — no se regenera después)
 9. $transaction interactiva (timeout 10 s):
      a. SELECT id FROM clave_pago WHERE empresaId=? AND nroTramite=? FOR UPDATE
         → serializa dos clics y dos operadores sobre el mismo trámite, TOTAL y QUITA incluidas
      b. activos = convenio WHERE origen='CLAVE_PAGO' AND estado='ACTIVO'
                   AND clavePago.empresaId=? AND clavePago.nroTramite=?
      c. mismo = activo con clavePagoId == claveId
           mismo.deudorId == deudorId  → REUSO (no crea convenio ni cambia gestión; solo reenvía/descarga)
           mismo.deudorId != deudorId  → 409 CONVENIO_CLAVE_EN_OTRO_CASO {convenioId, deudorId}
      d. otro = activo con otra clave
           y !dto.reemplazarConvenioActivo → 409 CONVENIO_OTRA_CLAVE_ACTIVO {convenioId, tipo, importe, deudorId}
           y dto.reemplazarConvenioActivo:
               sin permiso 'convenios.cancelar' → 403
               otro.deudorId != deudorId          → 409 CONVENIO_CLAVE_EN_OTRO_CASO
               otro → ANULADO; observaciones += "Anulado: se generó el cupón de la clave <tipo nueva> <nro nueva> (este convenio era de la clave <tipo> <nro>)"
      e. si no es REUSO: crear convenio
           tipo 'CLAVE_PAGO', origen 'CLAVE_PAGO', clavePagoId, deudorId, usuarioId = JWT (no del body)
           montoTotal = importe, cantCuotas 1, montoCuota = importe, fechaInicio = now
           montoOriginal = saldoTramite, importeQuita = saldoTramite − importe
           observaciones = "Clave <TOTAL|QUITA> <nroConvenio> · vto <DD/MM/AAAA>"
           cuota 1: fechaVencimiento = fechaVencimiento de la clave, importe, PENDIENTE
      f. si no es REUSO y existe parametro(cfg.gestionAlGenerar) y difiere de deudor.estadoGestionId
           → deudor.estadoGestionId = ese id
         si el parámetro no existe → warn, sigue (no bloquea el cupón por un catálogo incompleto)
10. si hubo convenio creado o anulado (no en REUSO): consolidacion.consolidar({tipo:'DEUDORES', deudorIds:[deudorId]})
      (implementado ANTES del intento de mail, no después como decía este mismo punto en el diseño
      original: consolidar no depende del resultado del envío, y así el caso queda consolidado aunque
      Sender tarde o esté caído — desvío sin impacto de negocio, documentado en §20)
11. si accion incluye ENVIAR:
      try  r = emailSender.enviar({deudorId, usuarioId, templateId?, html?, destinatarios, asunto,
                 variables?, archivos:[{originalname:`cupon-pago-${nroTramite}.pdf`, buffer:pdf, mimetype:'application/pdf'}]})
           (con dto.templateId: `templateId` + `variables` merge de automáticas + propias, `asunto` =
            el de la plantilla; sin dto.templateId: `html`+`asunto` del mensaje por defecto, sin
            `templateId` — Sender acepta las dos formas, `sender-http.client.ts`)
      catch e → r = { ok:false, errores:[{error: e.message}] }   (el convenio queda: el reenvío lo reusa)
      EmailSenderService.enviar ya crea envio_email en éxito y en error, con `templateId` NULL si se
      mandó sin plantilla (columna `envio_email.templateId` pasó a `Int?` en la fase 3)
      si dto.guardarEmailComoContacto: por cada destinatario que no exista como contacto email del
      caso, crear contacto { tipo:'email', valor } — best-effort, warn si falla
12. comentario (siempre, origen 'CUPON_CLAVE'):
      "Cupón de pago generado — Con quita ($ 19.880,01, vto 27/10/2026, convenio Telecom 96332206). Enviado a 1 destinatario."
      "Cupón de pago reenviado — …"            (REUSO)
      "… El envío por mail FALLÓ: <motivo>."   (r.ok == false)
      "… Se anuló el convenio de la clave <nroConvenio>."  (paso 9d)
13. log done con resultado (incluido envio=ok|fail) y ms
```

Si el proceso muere entre 9 y 12: queda el convenio sin comentario ni mail. Generar de nuevo lo
**reusa** (paso 9c) y completa comentario y envío. No hay pérdida, solo un paso más.

### 8.2 Reimpresión

`GET /api/multiclaves/convenios/:convenioId/cupon.pdf` regenera el PDF desde el convenio y su clave.
No escribe. Exige: convenio `CLAVE_PAGO` y `ACTIVO`; caso no bloqueado (R7 — un caso cancelado no
recibe un cupón para pagar de nuevo); clave no vencida (D9). Una clave `REEMPLAZADA` **sí** se
reimprime si su convenio sigue activo (R8).

### 8.3 Vista previa

`GET /api/multiclaves/claves/:claveId/cupon/preview?deudorId=` devuelve JSON con los avisos y los datos
del diálogo; `GET /api/multiclaves/claves/:claveId/cupon/preview.pdf?deudorId=` el PDF de vista previa
(D6). Ninguno escribe.

### 8.4 Mail

> **Corrección de esta fase 3 sobre el diseño original:** el párrafo de abajo decía que Sender "no
> manda un mail sin plantilla" y que hacía falta `cfg.templateCuponId` configurado — **es falso**. El
> internal-api de Sender (`internal-email.controller.ts` `POST manual/send`, solo lectura desde acá)
> acepta `templateId` **o** `html` (con `subject` obligatorio en ese caso) y aplica el mismo layout de
> header/footer y tracking en los dos casos. La decisión de esta fase 3 es **plantilla opcional**: si
> el operador no elige una, se manda un mensaje por defecto armado en Gestión. Ver el desvío completo
> en §20.

- **Plantilla OPCIONAL**, elegida por el operador en el diálogo (§11.2) de entre las plantillas de la
  cuenta SMTP de la empresa — no hay un `templateCuponId` "fijo" por empresa que la reemplace del
  todo: `configuracion.multiclaves.templateCuponId` (§9.5) solo la **preselecciona** en el diálogo
  (ajustable desde Ajustes → Empresas), el operador puede elegir otra o ninguna igual.
- **Con plantilla:** variables de siempre (`EmailSenderService.previewVariables` →
  `autoMapearVariables` con los mapeos guardados) **más** seis propias que pisan a las automáticas
  (`utils/cupon-mail.ts#variablesPropiasCupon`):

  | Variable | Valor |
  |---|---|
  | `importe_cupon` | `$ 19.880,01` |
  | `importe_cupon_letras` | "diecinueve mil ochocientos ochenta con 01 centavos" |
  | `vencimiento_cupon` | vencimiento impreso, `DD/MM/AAAA` |
  | `tipo_cupon` | `Saldo total` / `Con quita 50%` |
  | `nro_tramite` | trámite |
  | `nombre_cliente` | nombre y apellido del caso |

  **NO** incluye la clave de pago de 22 dígitos ni el código de barras (consistente con D6, §9.1/§9.2):
  esos solo existen dentro del PDF adjunto — una plantilla de mail es contenido que un operador puede
  reenviar o editar sin que el sistema lo controle, no es el lugar para ese dato completo.

  Si alguna variable de la plantilla queda sin valor → 400 `PLANTILLA_CON_VARIABLES_VACIAS` con la
  lista, **antes** de generar el PDF o tocar la base. La vista previa JSON (`GET …/cupon/preview
  ?templateId=`) devuelve la misma lista para que el botón Enviar ya aparezca deshabilitado.
- **Sin plantilla:** mensaje por defecto (`utils/cupon-mail.ts#mensajeCuponDefault`):
  - Asunto: `Cupón de pago - Personal` (nombre comercial fijo por ahora; no hay config por empresa
    para esto todavía — ver desvío en §20).
  - HTML simple con el nombre del cliente (**siempre escapado**, `escapeHtml` — nunca interpolado
    crudo), el importe, el vencimiento impreso y los medios de pago de `cfg.mediosDePago` (§9.5).
  - Va como `html`+`asunto` a Sender, sin `templateId`: Sender le agrega el layout/tracking igual que
    a un mail con plantilla, pero no aplica ningún reemplazo de `{{variable}}` sobre este HTML — ya
    viene completo.
- **Cuenta SMTP:** la de la empresa (`empresa.cuentaSmtpId`, `EmailSenderService.smtpDeEmpresa` — no
  hay selector de cuenta en el diálogo, mismo criterio que `EnviarEmailDialog`). Sin ella → 400
  `EMPRESA_SIN_SMTP`, y el diálogo deja únicamente Descargar.
- **Resultado del envío, clasificado (`clasificarEnvio`, hallazgo de la auditoría §20):** Sender puede
  responder `ok:true` con `enviados:0` si todos los destinatarios están dados de baja — eso NO es un
  envío exitoso. `enviado` (`enviados>0`, sin omitidos), `parcial` (`enviados>0` y algún omitido),
  `omitido` (`enviados:0`, todos omitidos) y `fallo` (`ok:false`) son los cuatro estados; solo
  `enviado` persiste `envio_email.estado='ENVIADO'` — `omitido` persiste `'OMITIDO'` (nuevo, columna
  libre sin enum, sin `db push`) y `fallo` sigue siendo `'ERROR'`. El comentario y la respuesta del
  POST distinguen los cuatro (§20).
- **Variables riesgosas, aviso no bloqueante (hallazgo de la auditoría §20):** si la plantilla elegida
  usa `{{saldo}}`, `{{importe}}`, `{{monto}}` o `{{total}}` (sinónimos de los canónicos generales
  `saldo`/`monto_total`/`deuda`, `variables-mapper.ts#CATALOG`), esas variables se completan con la
  **deuda del caso**, no con el importe del cupón — en una quita, el deudor vería el total. `preview()`
  lo marca en `avisosPlantilla` y el diálogo lo muestra, sin bloquear el envío.

---

## 9. Contratos

Todo bajo `/api`, JWT global, `PermisosGuard`. Controller `MulticlavesController` (`@Controller('multiclaves')`).
Errores de negocio con cuerpo `{ code, message, ...detalle }`.

### 9.1 Claves del caso

`GET /api/multiclaves/deudores/:deudorId/claves?incluirReemplazadas=false` — permiso `convenios.ver`.

```ts
{
  nroTramite: string | null;
  claves: Array<{
    id: number; tipo: 'TOTAL' | 'QUITA'; nroConvenio: string;
    importe: string;             // "19880.01"
    saldoTramite: string;
    fechaVencimiento: string;    // "2026-10-27"
    vtoImpreso: string;          // "2026-10-27" (D12: min(hoy + 7 días AR, fechaVencimiento))
    vencida: boolean;
    // NUNCA la clave de 22 dígitos ni el código de barras de 50 completos (D6): con esos dígitos
    // se arma un cupón cobrable sin pasar por el convenio, a cualquiera con `convenios.ver`.
    // Corregido tras la auditoría de la fase 2 — antes este endpoint sí los devolvía enteros.
    clavePagoUltimos4: string; // "0014" — solo para identificar la clave en la UI
    estado: 'VIGENTE' | 'REEMPLAZADA';
    lote: { remesaId: number; numeroRemesa: string; cargadaEn: string };
    convenioActivo: null | { id: number; deudorId: number; esEsteCaso: boolean; createdAt: string };
    // Fase 4: pagos de ESTE caso cuyo `referenciaClave` es esta clave. `null` si no hay ninguno.
    pagos: null | { cantidad: number; pagado: string; ultimaFecha: string; cubreLaClave: boolean };
  }>;
  avisos: {
    cuentaCancelada: boolean;
    saldoDistinto: null | { saldoCaso: number; saldoTramite: string };   // |deudor.saldo ?? montoTotal − saldoTramite| > 1
    otrosCasosDelTramite: Array<{ deudorId: number; numeroRemesa: string; situacion: string | null; enGestion: boolean }>;
    plantillaCuponConfigurada: boolean;
    // Fase 4: el caso está cancelado con quita por el pago de esta clave.
    canceladoConQuita: null | { claveId: number; nroConvenio: string; pagado: string; importeClave: string; quita: string };
  };
}
```

404 si el caso no existe.

### 9.2 Cupón

| Método | Ruta | Permiso | Entrada | Salida |
|---|---|---|---|---|
| GET | `/multiclaves/claves/:claveId/cupon/preview` | `convenios.generar_cupon` | query `deudorId`, `templateId?` | `{ clave, deudor:{nombre, nroTramite}, vtoImpreso, avisos[], convenioActivo, otroConvenioActivo, plantilla:{id,nombre,asunto} \| null, variablesSinValor: string[], destinatariosDisponibles:[{id,valor,principal}] }` — `plantilla`/`variablesSinValor` solo se completan si se pasó `templateId` |
| GET | `/multiclaves/claves/:claveId/cupon/preview.pdf` | `convenios.generar_cupon` | query `deudorId` | `application/pdf` (vista previa) |
| POST | `/multiclaves/claves/:claveId/cupon` | `convenios.generar_cupon` (+ `email.enviar` si envía, + `convenios.cancelar` si reemplaza) | `GenerarCuponDto` | `GenerarCuponRespuesta` |
| GET | `/multiclaves/convenios/:convenioId/cupon.pdf` | `convenios.generar_cupon` | — | `application/pdf`, `Content-Disposition: attachment; filename="cupon-<tramite>-<tipo>.pdf"` |

El `clave` del preview **no incluye la clave de 22 dígitos ni el código de barras** — mismo criterio
que §9.1: solo `clavePagoUltimos4`. Los 50/22 dígitos completos solo existen adentro del PDF que se
genera después de registrar el convenio (D6).

```ts
export class GenerarCuponDto {
  @IsInt() @Type(() => Number) deudorId!: number;
  @IsIn(['DESCARGAR', 'ENVIAR', 'DESCARGAR_Y_ENVIAR']) accion!: 'DESCARGAR' | 'ENVIAR' | 'DESCARGAR_Y_ENVIAR';
  @IsOptional() @IsArray() @IsString({ each: true }) @ArrayMaxSize(5) destinatarios?: string[];
  // Fase 3: OPCIONAL — sin ella se manda el mensaje por defecto (§8.4).
  @IsOptional() @IsInt() @Type(() => Number) templateId?: number;
  @IsOptional() @IsBoolean() guardarEmailComoContacto?: boolean;
  @IsOptional() @IsBoolean() reemplazarConvenioActivo?: boolean;
  @IsOptional() @IsString() @MaxLength(500) observacion?: string;
}

interface GenerarCuponRespuesta {
  convenioId: number;
  convenioReusado: boolean;
  convenioAnuladoId: number | null;
  gestionCambiada: boolean;
  comentarioId: number;
  envio: null | { envioId: number | null; ok: boolean; errores?: Array<{ email?: string; error: string }> };
  descargaUrl: string | null;   // "/api/multiclaves/convenios/123/cupon.pdf" si la acción incluye DESCARGAR
}
```

Códigos de error: `CLAVE_NO_ENCONTRADA` 404, `DEUDOR_NO_ENCONTRADO` 404, `CLAVE_NO_CORRESPONDE` 400,
`CLAVE_REEMPLAZADA` 400, `CLAVE_VENCIDA` 400, `DEUDOR_CANCELADO` 403, `EMPRESA_SIN_SMTP` 400 (fase 3;
reemplaza al `EMPRESA_SIN_PLANTILLA_CUPON` del diseño original — la plantilla ya no es obligatoria,
ver §8.4/§20), `DESTINATARIOS_INVALIDOS` 400, `PLANTILLA_CON_VARIABLES_VACIAS` 400 (solo si se eligió
plantilla), `PLANTILLA_INVALIDA` 400 (la plantilla elegida no existe o dejó de existir en Sender entre
el preview y la confirmación — mismo código que usa `PATCH .../config`, §9.4, cuando el
`templateCuponId` que se quiere guardar no es de la cuenta SMTP de la empresa), `CONVENIO_OTRA_CLAVE_ACTIVO` 409, `CONVENIO_CLAVE_EN_OTRO_CASO` 409. Los 400/404/409 se
loguean `warn`.

Auditoría: `@Audit({ modulo: GESTION, entidad: 'Convenio', tipo: 'CUPON_GENERADO', entidadIdFromResponse: 'convenioId', resumen: … })`
en el POST; el resumen incluye clave, tipo, reuso y anulación, no las direcciones de mail (esas ya
quedan en `envio_email`).

### 9.3 Cargas

| Método | Ruta | Permiso | Salida |
|---|---|---|---|
| GET | `/multiclaves/lotes/:remesaId/resumen` | `importacion.ver_historial` | `{ tramites, claves, vigentes, reemplazadasEnEsta, reemplazadasPorEsta, soloTotal, conCaso, sinCaso, rechazados, avisos:[{codigo,cantidad}] }` |
| GET | `/multiclaves/lotes/:remesaId/sin-caso` | `importacion.ver_historial` | `{ total, items:[{nroTramite, importeTotal, importeQuita, fechaVencimiento}] }` paginado |

404 si la remesa no existe o no es `MULTICLAVES`.

### 9.4 Config de empresa

`PATCH /api/multiclaves/empresas/:empresaId/config` — permiso `empresas.editar`. Body
`MulticlavesConfigDto` (todos opcionales). **Mergea solo la clave `multiclaves`** dentro de
`empresa.configuracion`, leyendo y escribiendo en una transacción: el `update` genérico reemplaza el
JSON entero (`empresas.service.ts:31-38`) y se llevaría la config de mora.

Si el body trae `templateCuponId` (no `null`), se valida **antes** de la transacción contra
`EmailSenderService.templatesDeEmpresa(empresaId)`: si el id no aparece en esa lista (no existe, o es
de otra cuenta SMTP) → 400 `PLANTILLA_INVALIDA`, sin escribir nada. Si la empresa no tiene
`cuentaSmtpId` o Sender no responde, el error de `templatesDeEmpresa` se propaga tal cual — tampoco se
escribe nada (hallazgo de la auditoría de la fase 3, §20).

`GET /api/multiclaves/empresas/:empresaId/config` — permiso `empresas.ver`. Devuelve la config con
defaults aplicados.

### 9.5 `empresa.configuracion.multiclaves`

```json
{
  "templateCuponId": null,
  "gestionAlGenerar": "GES-050",
  "leyendaTalonCedente": "TALON PARA Telecom Personal Argentina S.A. - FIRMA, SELLO Y FECHA AL DORSO",
  "mediosDePago": ["PAGO FACIL", "RAPIPAGO", "BAPRO PAGOS", "COBRO EXPRESS"]
}
```

Sin `mesesVtoImpreso` (fase 1.1, D12): el vencimiento impreso ya no es un parámetro por empresa, es
la regla fija `min(hoy + 7 días corridos AR, fechaVencimiento)`. Validación al leer (patrón de
`promesas.service.ts:81-83`): `gestionAlGenerar` una clave `GES-*`; lo inválido cae al default con
`warn`.

### 9.6 Permiso nuevo

En `backend/src/auth/permisos-catalogo.ts` (sección Convenios, `:30-37`) **y** en
`frontend/src/utils/permisosCatalogo.ts`:

```ts
{ key: 'convenios.generar_cupon', label: 'Generar cupones de pago', descripcion: 'Emite el cupón con la clave de pago del cedente y registra el convenio' },
```

ADMIN lo recibe en `seed.ts` vía `TODAS_LAS_KEYS`. En prod los roles viven en la base: hay que
asignarlo desde la pantalla de Roles después del deploy (paso de despliegue, §15).

### 9.7 Socket

Ninguno nuevo: la carga usa `import:iniciada/progreso/finalizada` como cualquier importación. La
consolidación sigue usando `consolidacion:progreso/finalizada`, con los campos nuevos del resultado
(§9.8) adentro del payload que ya manda.

### 9.8 Fase 4 — contratos que cambian

**Ningún endpoint nuevo.** Lo que cambia son tres formas de respuesta y un campo de plantilla.

| Qué | Dónde | Cambio |
|---|---|---|
| Campo mapeable `nroConvenio` | `MappingEditor.tsx:66-74` (`CAMPOS.PAGOS`) + `mappingJson.columns` de la plantilla | Opcional. Label: *"Nº de convenio de la clave de pago (Telecom/Personal)"*. Sin transforms obligatorios. No cambia `MappingJson`: es una clave más de `columns`, como `idExterno` |
| Vista previa de PAGOS | `POST /api/imports/remesas/:id/validate` (respuesta de `validateRemesa`) | Objeto nuevo `multiclavePagos` (§10.9) + advertencias de texto con los números exactos |
| Resultado de consolidación | `ConsolidacionResult`, en `POST /api/consolidacion/preview` y `/aplicar` (por socket) y en el `afterAll` de los processors | Campos nuevos `aSIT054`, `aSIT050PorClave`, `sit054Degradado` |
| Claves del caso | `GET /api/multiclaves/deudores/:id/claves` | `claves[].pagos` y `avisos.canceladoConQuita` (§9.1) |

**Permisos: ninguno nuevo.** `consolidacion.ejecutar`, `importacion.*` y `convenios.ver` ya existen y
cubren todo. Dicho de otra forma: no hay nada que asignar en la pantalla de Roles después del deploy
de la fase 4 — a diferencia de la fase 2 (§9.6).

**Variables de entorno nuevas** (`.env.example`, §10.5c):
`CONSOLIDACION_TOLERANCIA_CLAVE_CENTAVOS` (default `100`, rango `[0, 1000]`) y
`CONSOLIDACION_CLAVE_MODO` (`SUMA` | `PAGO_UNICO`, default `SUMA`). Las dos se validan en
`onModuleInit` y un valor fuera de rango **hace fallar el arranque**, igual que
`CONSOLIDACION_TOLERANCIA_PCT` (`consolidacion.service.ts:60-80`).

---

## 10. Consolidación — cancelación por pago de clave (fase 4)

> **Rediseñada el 2026-09-16** con la muestra real de pagos ya en mano (Q4 cerrada, §19). La versión
> anterior de esta sección describía la regla (b) —convenio de clave cumplido— cancelando a SIT-050
> con `saldo = 0`, y dejaba la regla por referencia del archivo para una fase 5 bloqueada. Con la
> muestra se dio vuelta: la regla del **archivo** pasa a ser la principal (es exacta y no exige que el
> cupón lo haya emitido nuestra plataforma), la cancelación con quita va a un código de situación
> **nuevo, SIT-054 "Cancelado con quita"**, y la regla (b) —el respaldo por convenio de clave— se
> descartó en la auditoría de la fase 4a (§10.10). La fase 5 del
> plan anterior se absorbe acá: no queda una fase 5.

### 10.1 El archivo de pagos (verificado sobre la muestra real)

`MA_20260911_1008_POSBAJA_HW_260910_260911_C.txt` — **104 filas**, separador `|`, **33 campos** por
fila (la última vacía: la línea termina en `|`), sin encabezado, codificación latin1, fechas de pago
del 08 al 10/09/2026. Mezcla **todas** las nóminas posbaja (15 nóminas distintas, columna 31) y todos
los productos (`POS_MOV` 20, `POS_VOZ_CO` 55, `POS_NI` 8, `POS_CABLE` 10, `POS_Intern` 7, `POS_VOIP` 1,
`POS_CONV` 3) en un solo archivo. Hoy se carga **una vez por empresa** con las plantillas **48**
(TELECOM PERSONAL PAGOS DEIMOS, empresa 10) y **49** (TELECOM PAGOS DEIMOS, empresa 9) — verificadas
contra producción el 2026-09-16, las dos con el mismo `mappingJson`:

```json
{"entity":"PAGO","columns":{
  "monto":{"fromIndex":15,"transforms":["trim","toNumber:es-AR","removeDashes"]},
  "fechaPago":{"fromIndex":11,"transforms":["trim"]},
  "nro_cliente":{"fromIndex":5,"transforms":["trim"]},
  "observacion":{"fromIndex":13,"transforms":["trim"]}},
 "defaults":{},"matchKeys":["empresaId","documento"]}
```

Columnas que importan (índices 0-based):

| # | Contenido | Verificado |
|---|---|---|
| 1 | Producto | 7 valores distintos en 104 filas |
| 5 | **Trámite** | 10 dígitos en las 104 filas. Es lo que mapea `nro_cliente` |
| 6 | Tipo de cobro | `4` en 23 filas (pago con multiclave), `2` en 81 (pago común) |
| 10 | Vencimiento de la clave | 4 fechas distintas en los 23 pagos con clave; **vacío en las 81 filas comunes** |
| 11 | **Fecha de pago** | 08, 09 y 10/09. Es lo que mapea `fechaPago` |
| 12 | Código del medio | `H_MC_CO` 14, `H_Multi_CZ` 9, `0` en las 81 comunes |
| 13 | Descripción del medio | `Multiclave Contado` 14, `CONTADO_Z` 9, `0` en las comunes. Es lo que mapea `observacion` |
| 15 | Importe **negativo** | negativo en las 104 filas. Es lo que mapea `monto` |
| 18 | Cuenta de 16 dígitos | 16 dígitos en las 104 |
| 20 | Saldo del trámite | ≠ 0 en los 23 con clave; también ≠ 0 en 18 de las comunes |
| 22 | **NRO_CONVENIO** | 8 dígitos en los 23 con clave; `0` en las 81 comunes |
| 23 | Importe | **positivo** en los 23 con clave; **negativo** (igual a la col. 15) en las 81 comunes |
| 24 | Marca | `0` en los 23 con clave, `1` en las 81 comunes |
| 29 | Id del cobro | **vacío en los 23 con clave**; 81 valores distintos (11 dígitos) en las comunes |
| 30 | Cuenta de 11 dígitos | 11 dígitos en las 104 |
| 31 | Nómina | 15 nóminas distintas |

Tres correcciones sobre lo que se creía antes de verificar el archivo:

- **La columna 23 no es "el importe positivo"**: lo es solo en los pagos con clave. En los 81 pagos
  comunes trae el mismo negativo que la 15. Mapear el importe a la 23 arreglaría el signo de 23 filas
  y lo rompería en 81. El importe sigue saliendo de la **15** con `removeDashes`, que desde el
  2026-08-28 devuelve el valor absoluto **como número** aunque venga después de `toNumber`
  (`transforms.ts:181-185`, y el processor lo vuelve a coercer en `pagos.processor.ts:18-33`).
- **Son 6 los convenios que matchean las claves de muestra, no 7.** De los 23 pagos con clave, 6
  tienen su `NRO_CONVENIO` en `MULTI_41645`/`MULTI_41647`; los otros 17 son de nóminas cuyas claves no
  tenemos. En los 6, trámite e importe coinciden **al centavo** con la clave cargada, el vencimiento
  del pago (col. 10) coincide con el de la clave, y los 6 trámites están además en el
  `CA_20260828` (columna 7). Los 6 convenios:
  `96234420`/`1981517609`, `96296277`/`2578832982`, `96262931`/`2581507880`,
  `96327826`/`2597868787`, `96336081`/`2598220161`, `96320331`/`2598844381`.
- **Los 23 son de la clave de QUITA**: el importe de la col. 23 es exactamente `⌊saldo/2⌋` o
  `⌈saldo/2⌉` de la col. 20 en los 23 casos, y en los 6 que matchean es la clave de **menor** importe
  de su tanda. No hay ningún pago de clave TOTAL en la muestra — el diseño igual lo contempla.

Dos cosas más que salieron del archivo y cambian el diseño:

- **`H_MC_CO` y `H_Multi_CZ` no distinguen quita de total ni producto**: los dos aparecen sobre
  claves QUITA y sobre `POS_VOZ_CO`, `POS_MOV` y `POS_CABLE`. Para cancelar se tratan igual; queda Q8.
- **Ningún trámite repetido trae pagos con clave.** Hay 3 trámites con más de una fila (`2220255966`
  ×3, `2599750017` ×2, `2600315725` ×2) y las 7 filas son pagos **comunes** de días e importes
  distintos. O sea: en la muestra no hay ni un caso de clave pagada en cuotas (Q6 sigue abierta, pero
  el diseño queda parametrizado, §10.5).

### 10.2 Campo mapeable nuevo en las plantillas de PAGOS

`nroConvenio` — opcional, y **solo** lo usa la categoría PAGOS.

- `mapping-types.ts`: nada nuevo en `MappingJson` — es una clave más de `columns`, como `idExterno`.
  Se documenta en el comentario de la interfaz junto al resto de los campos de PAGOS.
- `MappingEditor.tsx:66-74` (`CAMPOS.PAGOS`): entrada nueva
  `{ value: "nroConvenio", label: "Nº de convenio de la clave de pago (Telecom/Personal)" }`,
  al lado de `idExterno`. Sin transforms obligatorios.
- **Normalización**: `normalizarReferenciaClave` (ya existe,
  `multiclaves/utils/clave-pago.ts`) — 8 dígitos tal cual, 22 (clave de pago) → posiciones [2,10),
  50 (código de barras) → [33,41). Cualquier otra cosa → `null`.
- **`0`, vacío, `-` y `00000000` se tratan como "sin clave", sin aviso**: son las 81 filas comunes de
  cada archivo. Un valor que **no** es ninguno de esos y tampoco normaliza (p. ej. `9623442` de 7
  dígitos) cuenta un aviso `REFERENCIA_CLAVE_ILEGIBLE` con el valor crudo — la fila se carga igual
  como pago común. Sin esta distinción, cada carga real dejaría 81 avisos de ruido y el aviso que
  importa se perdería adentro.
- En prod, las plantillas 48 y 49 lo mapean a `fromIndex: 22` (columna 23, 1-based), sin transforms
  más allá de `trim`. Es un paso manual del despliegue (§15).

### 10.3 `pagos.processor`: cómo se guarda el pago con clave

**a. Lectura y normalización** (arriba de la resolución del caso, junto al bloque de `idExterno`,
`pagos.processor.ts:112-114`):

```
refCruda = row.nroConvenio
refClave = (refCruda vacía | '0' | '-' | '00000000') ? null : normalizarReferenciaClave(refCruda)
si refCruda tenía contenido y refClave == null → avisos.REFERENCIA_CLAVE_ILEGIBLE++
```

**b. `idExterno` derivado.** Los 23 pagos con clave **no traen id de cobro** (columna 29 vacía,
verificado), así que sin esto quedan con la heurística de día + importe + observación como única
defensa. Se deriva:

```
si refClave y no hay idExterno del archivo:
    idExterno = `MC-${refClave}-${YYYYMMDD(fechaPago)}-${centavos(importe)}`
    idExternoDerivado = true
```

- **Prefijo `MC-`, y no el convenio pelado**: la unique es `pago(deudorId, idExterno)`
  (`schema.prisma`, modelo `pago`). En producción hay 395 pagos con `idExterno` (todos de la empresa
  10) y **ninguno** es de 8 dígitos —los `PAYMENT_ID` de Telecom son de 11— así que hoy la colisión no
  existe; con el prefijo **no puede** existir nunca, contra ningún cedente, y el valor se lee solo en
  la ficha y en el timeline.
- **Por qué también el día y los centavos**: si Telecom acepta pagar una clave en dos veces (Q6), con
  la clave sola el segundo pago chocaría contra la unique y se descartaría en silencio — plata
  perdida, que es exactamente el fallo que este sistema ya tuvo con los archivos de AYSA. Con el día
  y el importe adentro, dos pagos distintos de la misma clave entran los dos, y **recargar el mismo
  archivo sigue siendo idempotente** (misma clave, mismo día, mismo importe → misma llave).
- **Cambio obligatorio en el anti-duplicados** (`pagos.processor.ts:178`): hoy, si hay `idExterno`, la
  heurística de día + importe + observación **no se corre** (`idExterno ? null : findFirst(...)`). Con
  una llave derivada eso significa que un archivo ya cargado **antes** de mapear `nroConvenio` (sin
  `idExterno`) y recargado **después** (con la llave `MC-…`) duplicaría el pago: la búsqueda exacta no
  encuentra nada y la heurística está apagada. La condición pasa a
  `(idExterno && !idExternoDerivado) ? null : findFirst(...)` — es decir, **la llave del cedente sigue
  salteando la heurística; la derivada no**. Las carteras con `PAYMENT_ID` real no cambian en nada
  (test de regresión obligatorio, §16.1).

**c. Resolución del caso.** Hoy es
`SELECT id FROM deudor WHERE empresaId=? AND remesaId IN (origen) AND nroCliente=? LIMIT 1`
(`pagos.processor.ts:85-94`), sin `ORDER BY`. En producción, la empresa 9 (TELECOM) tiene **5.448
`nroCliente` repetidos** entre remesas (verificado 2026-09-16) — o sea que ese `LIMIT 1` es una
moneda al aire en la mitad de la cartera, no un caso de borde teórico. Con la clave se puede hacer
mejor, y para los pagos comunes al menos se puede dejar de tirar la moneda:

```
1. Si refClave:
     clave = clave_pago WHERE nroConvenio = refClave        (unique global → 0 o 1 fila)
     si clave y clave.empresaId != ctx.empresaId:
         avisos.CLAVE_DE_OTRA_EMPRESA++   → NO se usa el camino de clave; sigue por el camino común
     si clave y clave.empresaId == ctx.empresaId:
         candidatos = deudor WHERE empresaId = clave.empresaId
                        AND TRIM(nroCliente) = clave.nroTramite
                        AND remesaId IN (remesasOrigen)
         si candidatos vacío:
             candidatos = lo mismo SIN el filtro de remesa origen
             si hay → avisos.CASO_FUERA_DE_REMESA_ORIGEN++
         si candidatos vacío:
             error de fila: "El trámite <T> de la clave <conv> no tiene caso en esta empresa"
         si candidatos.length > 1 → avisos.TRAMITE_EN_VARIOS_CASOS++
         deudor = desempate(candidatos)
2. Si no hay refClave, o la clave no está cargada, o es de otra empresa:
     camino de siempre (nroCliente dentro de las remesas origen), con un ORDER BY nuevo (ver abajo)
```

**Desempate**, en este orden y siempre determinista:

1. el caso que tiene un `convenio` ACTIVO con `clavePagoId = clave.id` — el cupón se emitió desde
   nuestra plataforma **para ese caso**, no hay nada más exacto;
2. el caso con cualquier convenio `origen='CLAVE_PAGO'` ACTIVO de ese trámite;
3. el caso **no cancelado** (situación fuera de la categoría CANCELADO) de la **remesa más reciente**
   (`remesa.createdAt DESC`);
4. `deudor.id DESC`.

El criterio 3 antes que el 4 es el mismo que ya se usa para elegir la tanda ganadora al borrar una
carga de claves (`imports.service.ts`, `deleteRemesaMulticlaves`). Para el **camino común** no se
cambia el alcance (sigue restringido a las remesas origen: ensancharlo movería pagos de todas las
carteras) — solo se le agrega `ORDER BY` por los criterios 3 y 4, que convierte la moneda al aire en
una elección explicada y repetible. Es un cambio de comportamiento acotado y **querido**: hoy el
mismo archivo cargado dos veces puede dejar el pago en casos distintos.

**d. Escritura.** `pago.create` suma `referenciaClave: refClave` (schema en §4.5). Todo lo demás
—claim de pago manual, factura PAGADA por `observacion`, `processedDeudorIds`— queda igual. Ojo con
la factura: en estos archivos `observacion` es la **descripción del medio** (`Multiclave Contado`),
no un número de comprobante, así que el `factura.updateMany` de `pagos.processor.ts:229-235` no
matchea nada. Está bien: no hay factura que marcar.

**e. Avisos y resumen.** Los contadores viven en la instancia del processor como los que ya hay
(`facturasMarcadas`, `yaCargados`, `negativos`) y se **resetean en el mismo lugar**
(`pagos.processor.ts:268-270`, antes de la consolidación). En `afterAll`, además del `log`, se
escriben como filas `[aviso] CODIGO: N …` en `importerror` con `rowNumber: 0` —el patrón de
MULTICLAVES, que la pantalla de detalle de la importación ya muestra y que no suma a `errFilas`—
**envuelto en try/catch**: los errores de `afterAll` se tragan (`imports.service.ts:1763-1768`) y esto
es informativo, no puede ser la única defensa. La defensa real es la vista previa (§10.9).

### 10.4 Schema — `pago.referenciaClave`

```prisma
  /// NRO_CONVENIO de la clave con la que se pagó, normalizado desde el convenio de 8, la clave de 22
  /// o el código de barras de 50 dígitos. Lo llena `pagos.processor` cuando la plantilla mapea
  /// `nroConvenio`. Ver docs/multiclaves-spec.md §10.
  referenciaClave String? @db.VarChar(8)

  @@index([referenciaClave], map: "Pago_referenciaClave_idx")
```

`db push` de la fase 4a. Aditivo y nullable: no pide `--accept-data-loss` y no hay backfill (§10.8).
Es la **misma** columna que describe §4.5 (que antes decía "fase 5"): si se toca una, se tocan las dos.

### 10.5 La regla en `consolidacion.service.ts`

**a. Query nueva por chunk**, después de la agregada de pagos (`consolidacion.service.ts:256-267`):

```sql
SELECT p.deudorId,
       k.id            AS claveId,
       k.nroConvenio   AS nroConvenio,
       k.tipo          AS tipoClave,
       k.importe       AS importeClave,
       k.saldoTramite  AS saldoTramite,
       k.nroTramite    AS nroTramite,
       TRIM(d.nroCliente) AS nroClienteCaso,
       SUM(p.importe)  AS pagadoClave,
       MAX(p.importe)  AS mayorPagoClave,
       MAX(p.fecha)    AS ultimaFecha
FROM pago p
JOIN deudor d      ON d.id = p.deudorId
JOIN clave_pago k  ON k.nroConvenio = p.referenciaClave AND k.empresaId = d.empresaId
WHERE p.deudorId IN (${chunk}) AND p.referenciaClave IS NOT NULL
GROUP BY p.deudorId, k.id, k.nroConvenio, k.tipo, k.importe, k.saldoTramite, k.nroTramite, d.nroCliente
```

`saldoTramite` viaja en la query porque es la base contra la que se calcula la quita perdonada para
el mensaje de auditoría (§10.5e) — `importeClave − pagado` da $0 con un pago exacto, que es el caso
normal (hallazgo de la auditoría, corregido: la fórmula es `saldoTramite − pagado`).

- Se joinea por `nroConvenio` + `empresaId`, **no** por `nroCliente`: el convenio es único en toda la
  base, y volver a exigir el trámite haría que un `nroCliente` con espacios apague la regla sin que
  nadie se entere. La comparación `nroTramite == nroClienteCaso` se hace **en memoria**: si no
  coinciden, **no se cancela** y se loguea `warn` con `deudorId`, trámite y convenio (el pago quedó
  pegado a un caso que no es el del trámite: es un dato inconsistente, no una cancelación).
- `MAX(p.importe)` viaja en la misma query para que el modo `PAGO_UNICO` (Q6) sea una decisión en JS,
  sin tocar el SQL cuando llegue la respuesta.
- Un caso puede traer **varias filas** (pagó dos claves distintas del mismo trámite, o de dos tandas).
- La regla **no mira fechas**: el convenio identifica el cobro de forma exacta. (La ventana
  `fecha ≥ día(createdAt) − 1`, D10, era de la regla (b) — descartada, §10.10 — y no existe en el
  código.)

**b. Decisión por caso**, **antes** del `if (row.montoTotal == null)` (`:281`) y del salteo por
`totalPagado === 0` (`:295`) — a propósito: un caso puede tener la clave pagada y `montoTotal` nulo
(el objetivo es el importe de la clave, no la deuda), y un caso con un ajuste negativo puede tener
Σpagos = 0 y aun así haber pagado su clave.

```
TOL = CONSOLIDACION_TOLERANCIA_CLAVE_CENTAVOS            // default 100 (= $ 1,00)
MODO = CONSOLIDACION_CLAVE_MODO                          // 'SUMA' (default) | 'PAGO_UNICO'

por cada fila de clave del caso, en centavos enteros (Math.round(x * 100)):
    pagado = MODO === 'SUMA' ? pagadoClave : mayorPagoClave
    cumplida = nroTramite === nroClienteCaso && pagado >= importeClave − TOL

si alguna cumplida con tipo 'TOTAL'  → destino = SIT-050, saldo 0, porClave = 'TOTAL'
si no, alguna cumplida con 'QUITA'   → destino = SIT-054, saldo 0, porClave = 'QUITA'
si no                                 → reglas de siempre (SIT-050 / SIT-041 por Σpagos vs montoTotal)
```

TOTAL le gana a QUITA: si pagó la clave del saldo total, el caso está cancelado sin quita y así tiene
que quedar registrado. Es determinista aunque el caso tenga varias claves pagadas.

**Centavos enteros, no pesos.** `pago.importe` es `Float` y `clave_pago.importe` es
`Decimal(14,2)` (que Prisma devuelve como string en una query cruda): comparar en `Float` con una
tolerancia en pesos arrastra el error de coma flotante al lado equivocado del umbral. Se convierte
todo con `Math.round(parseFloat(x) * 100)` y se compara entero contra entero.

**c. Tolerancia y modo, por env**, validados en `onModuleInit` igual que
`CONSOLIDACION_TOLERANCIA_PCT` (`consolidacion.service.ts:60-80` — fuera de rango, el arranque
falla):

| Variable | Default | Rango | Qué hace |
|---|---|---|---|
| `CONSOLIDACION_TOLERANCIA_CLAVE_CENTAVOS` | `100` | `[0, 1000]` | Cuánto puede faltar para dar la clave por pagada. 100 = $ 1,00, que es lo que se pierde cuando el archivo del cedente trunca centavos |
| `CONSOLIDACION_CLAVE_MODO` | `SUMA` | `SUMA` \| `PAGO_UNICO` | `SUMA`: la clave se puede pagar en partes. `PAGO_UNICO`: hace falta **un** pago que alcance. Es el interruptor de Q6 |

**d. Escritura — `aplicarChunk` (`:361`)**, dos grupos nuevos además de los dos de siempre:

```
updateMany(id IN sit054Ids,        { estadoSituacionId: SIT-054, situacionConsolidadaEn, saldo: 0 })
updateMany(id IN sit050PorClaveIds,{ estadoSituacionId: SIT-050, situacionConsolidadaEn, saldo: 0 })

UPDATE cuota_convenio SET estado='PAGADA', fechaPago=<ultimaFecha de la clave>
  WHERE convenioId IN (convenios ACTIVOS con clavePagoId = la clave cumplida del caso)
    AND estado IN ('PENDIENTE','VENCIDA')
```

Los dos grupos **quedan fuera** de los dos `$executeRaw` que recalculan
`GREATEST(0, montoTotal − Σpagos)` (`:379-385` y `:400-407`): ese recálculo le devolvería a una cuenta
cancelada con quita el 50% del saldo, que es justamente lo que no puede pasar. El `saldo: 0` va en el
`updateMany`, explícito, en la misma transacción que el resto del chunk (`:410`).

**El convenio de clave no cambia de estado.** En toda la base solo se usan `ACTIVO` y `ANULADO`
(`convenios.service.ts:84,125,227`; `cupon.service.ts:588,650,671`): inventar `CUMPLIDO` significaría
revisar cada `where estado: 'ACTIVO'` del sistema por un chip. El convenio queda ACTIVO con su cuota
PAGADA, y "Cumplido" se muestra derivado de eso (§11.1). La cuenta cancelada ya está bloqueada por
`DeudorBloqueoService` (categoría CANCELADO, `deudor-bloqueo.ts:36-40`), así que no se le puede
generar otro cupón.

**e. Auditoría por caso**, sobre la que ya existe para cancelaciones (`:418-432`):

> *"Cancelado con quita por el pago de la clave QUITA 96234420: pagó $ 15.500,00 de $ 31.000,00 —
> quita $ 15.500,00"*

con `contexto: { origen: 'consolidacion', regla: 'CLAVE_PAGO_ARCHIVO', claveId, nroConvenio, tipoClave,
importeClave, pagado, deudorId }`. Un registro por caso, igual que hoy: un caso se cancela una sola
vez y en la corrida siguiente ya no cambia.

**f. `ConsolidacionResult`** (`interfaces/consolidacion-result.interface.ts`):

```ts
  /** Cancelados con quita (SIT-054) por el pago de una clave QUITA. */
  aSIT054: number;
  /** Subconjunto de aSIT050 cancelado por el pago de una clave TOTAL (no por Σpagos ≥ montoTotal). */
  aSIT050PorClave: number;
  /** Casos que debían ir a SIT-054 y quedaron en SIT-050 porque falta el código (§10.7). */
  sit054Degradado: number;
```

**g. Idempotencia.** `situacionCambia` compara ids y `saldoCambia` compara contra `0` con el
`SALDO_EPSILON` de siempre (`:311-319`): la segunda corrida sobre un caso ya cancelado con quita cae
en `sinCambios`. Las cuotas se marcan con `estado IN ('PENDIENTE','VENCIDA')`, así que el segundo
`UPDATE` toca 0 filas. Correrla N veces da exactamente lo mismo.

### 10.6 Qué pasa en cada caso

| Caso | Resultado |
|---|---|
| Pago con convenio de una clave **QUITA** cargada, importe exacto | **SIT-054**, saldo 0, cuota PAGADA si hay convenio de clave |
| Pago con convenio de una clave **TOTAL** | SIT-050, saldo 0 (cuenta en `aSIT050PorClave`) |
| Pagó $ 15.499,50 de una clave de $ 15.500,00 | SIT-054 (tolerancia 100 centavos) |
| Pagó $ 15.498,00 de $ 15.500,00 | **No** cancela por clave: regla de siempre → SIT-041 |
| Dos pagos que juntos alcanzan la clave | SIT-054 con `CONSOLIDACION_CLAVE_MODO=SUMA` (default); con `PAGO_UNICO`, no cancela (Q6) |
| El convenio del pago **no está en `clave_pago`** (claves de esa nómina sin cargar) | No cancela por clave; regla de siempre (SIT-041 con el 50%). `referenciaClave` **queda guardada**: cuando se carguen las claves de esa nómina, la consolidación siguiente lo cancela sola |
| El convenio es de **otra empresa** | No cancela (el join exige `k.empresaId = d.empresaId`). El pago entra por el camino común si el trámite existe en esta empresa; aviso `CLAVE_DE_OTRA_EMPRESA` en el resumen |
| El trámite de la clave **no tiene caso** cargado | La fila es un error de la importación, con el trámite y el convenio en el mensaje. Nada se cancela |
| El pago quedó pegado a un caso cuyo `nroCliente` no es el trámite de la clave | No cancela, `warn` con `deudorId`/trámite/convenio |
| La clave está **REEMPLAZADA** o **vencida** | **Cancela igual.** Telecom cobró: el estado de la clave en nuestra base no cambia que la plata entró (extiende R8) |
| El caso ya estaba en SIT-050 por haber pagado todo | La regla de clave solo mueve a SIT-054 si la clave cumplida es QUITA; si además pagó el total, gana TOTAL/SIT-050 |
| El caso estaba en SIT-054 y entra un ajuste que sube la deuda | Sigue en SIT-054: la clave está pagada y eso no se deshace. La cancelación reversa de §10.7 del spec de consolidación **no aplica** a la regla de clave |
| Se borra el pago | Un pago `IMPORT_PAGOS` **no se puede borrar** desde la UI (`pagos.service.ts:69-72`: solo MANUAL) y la cuenta cancelada además bloquea el borrado. Borrar la remesa de pagos **tampoco** borra los pagos (`imports.service.ts:2447`). Revertir es un script con auditoría: borrar el pago y consolidar. Queda documentado como limitación, no como flujo |
| Se recarga el archivo de pagos | Idempotente por `idExterno` derivado (§10.3b) + la heurística de día/importe/observación. La consolidación vuelve a dar lo mismo |
| Se borra la carga de claves (`clave_pago`) después de cancelar | La regla deja de matchear y la consolidación siguiente devuelve el caso a SIT-041 con el saldo recalculado. Es coherente (sin la clave no hay prueba de la quita) y visible: el borrado de una carga con convenios ya está bloqueado (R3) |

### 10.7 SIT-054: alta, despliegue y los cinco lugares que hoy dicen `SIT-050`

**Alta del código.** `SIT-054` no existe en producción — verificado el 2026-09-16: la categoría
CANCELADO tiene SIT-050 a SIT-053 y `SIT-054` está libre.

```ts
{ grupo: 'situacion', clave: 'SIT-054', descripcion: 'Cancelado con quita', categoria: 'CANCELADO', esGlobal: true },
```

- Va en `prisma/seed-codigos-curados.ts`, en el bloque CANCELADO, **y** en un script propio
  `prisma/scripts/alta-sit-054.ts` (idempotente, con `--dry-run`): crea el parámetro si falta y le
  agrega la fila de `empresa_parametro` a **todas** las empresas (el seed completo también reasigna
  todo lo demás; en prod conviene el script chico). El deploy corre `db push`, no seeds: **es un paso
  manual del despliegue** (§15).
- **La consolidación NO puede caerse si falta.** `cachearParametrosSIT`
  (`consolidacion.service.ts:82-104`) hoy lanza si no encuentra SIT-050/SIT-041 y con eso el backend
  no arranca. Para SIT-054 se resuelve igual pero **sin lanzar**: si falta, `logger.error` con la
  instrucción de correr el script, `sit054Id = null`, y la regla cancela a **SIT-050** contando
  `sit054Degradado`. Se prefiere cerrar bien la plata con la etiqueta equivocada antes que dejar el
  caso abierto, y **se arregla solo**: apenas exista el código, la consolidación siguiente mueve esos
  casos a SIT-054 (la situación cambia → no es `sinCambios`).

**Los cinco lugares que comparan contra la clave `SIT-050` y no contra la categoría.** Un código nuevo
de cancelación que la mitad del sistema no reconoce es la versión "situación" del permiso que no está
en el catálogo. Lo que sí funciona solo: `DeudorBloqueoService` resuelve por **categoría**
(`deudor-bloqueo.ts:36-40`), así que SIT-054 bloquea la cuenta desde el primer día, y los tableros
también (`dashboards.service.ts:89,101`, `CANCELADO_CATEGORIA`). Lo que hay que tocar en la fase 4a:

| Dónde | Qué pasa hoy con SIT-054 | Cambio |
|---|---|---|
| `pagos.service.ts:116` (`revertirSinPagos`) | Al borrar el último pago, solo devuelve al default de la plantilla si la situación es SIT-041 o SIT-050: un caso en SIT-054 queda cancelado **sin un solo pago** | Agregar `SIT-054` a la comparación |
| `imports.service.ts:2352` (`listRemesas`, `soloEnGestion`) | El combo "vincular a remesa de deudores" considera vivo un caso cancelado con quita → el operador elige una remesa ya cerrada | Resolver los ids por **categoría CANCELADO** (+ GES-094/GES-090) en vez de por la clave `SIT-050` |
| `acciones.processor.ts:15,186` (`saltearCanceladas`) | Una acción masiva con "saltear canceladas" **modifica** los cancelados con quita | Ídem: por categoría |
| `actualizaciones.processor.ts:131-136,169-173` | Un caso en SIT-054 se re-asigna a gestión cuando vuelve a venir en el archivo | Ídem |
| `casos-cedente.processor.ts:54,344-350` | Mismo problema en la re-asignación de esa categoría | Ídem |

Para no repetir la query cinco veces: `imports/utils/situaciones-cerradas.ts` con
`idsSituacionCancelada(prisma): Promise<number[]>` (cacheado por proceso, modo degradado = lista
vacía, como `DeudorBloqueoService`).

### 10.8 Backfill: qué se hace con lo que ya está cargado

**Lo que hay en producción, verificado el 2026-09-16:**

- `clave_pago`: **0 filas**. `convenio` con `origen='CLAVE_PAGO'`: **0**. El schema de la fase 1 está
  aplicado, pero **nunca se cargó un archivo de claves ni se emitió un cupón**.
- Pagos con la descripción del medio de multiclave (`observacion`): **12 `Multiclave Contado` + 8
  `CONTADO_Z` = 20 pagos, en 20 casos, todos de la empresa 9 (TELECOM)**, cargados entre el 15 y el
  20/07/2026, y **los 20 casos están hoy en SIT-041**.
- **Esos pagos están guardados en negativo.** De los que se pudieron listar (9 de 20), todos tienen
  `importe < 0` y su caso quedó con `saldo = montoTotal + |importe|` — es decir, con un 50% **más** de
  deuda que la original. Ejemplo: deudor 18097, `montoTotal` 13.261,59, pago −6.630,79, `saldo`
  19.892,38. Es el fallo del signo que arregló el 2026-08-28 (`removeDashes` sobre un número devuelve
  su valor absoluto, `transforms.ts:181-185`): estos pagos entraron **antes** de ese arreglo.
  La suma por descripción da ≈ 0 en los dos grupos, así que hay pagos positivos de la misma magnitud
  en otros casos — **hay que terminar de listar los 20 antes de correr nada** (§19, Q10).

**Decisión: el histórico NO se recorre para asignar SIT-054.** Razones, en orden:

1. **El dato no existe.** El número de convenio del pago está solo en el archivo original; la columna
   `referenciaClave` no existía cuando esos 20 pagos se cargaron y el processor no guardó nada que
   permita reconstruirlo.
2. **No hay contra qué matchear.** `clave_pago` tiene 0 filas en prod. Aunque se quisiera inferir la
   clave, no hay claves cargadas de esas nóminas de julio, y no está garantizado que existan los
   archivos `MULTI_*` correspondientes.
3. **Inferir por importe sería adivinar.** El único indicio disponible es "el pago es la mitad del
   `montoTotal`", que es exactamente la clase de heurística que ya canceló cosas que no correspondía
   en este sistema. Cancelar 20 casos por una corazonada no se hace.
4. **Recargar el archivo tampoco resuelve.** El anti-duplicados por día + importe + observación hace
   `skip` sin actualizar nada (`pagos.processor.ts:201-206`), así que una recarga no llenaría
   `referenciaClave`; y si además el signo sigue mal, agregaría un pago positivo y dejaría Σ = 0.

**Lo que sí se hace, y es urgente y aparte de esta fase:**

La corrección de esos datos **no se implementó como script del repo y no es parte de esta fase**. Al
mirarlos de cerca resultó ser otra cosa: los 20 pagos son 10 trámites duplicados en dos casos —la
remesa `00606` de TELECOM está cargada otra vez como `22222`, con el mismo archivo, 5.448 casos y
14.784 facturas cada una—, con el mismo cobro en negativo en un caso y en positivo en el otro. No
alcanza con invertir signos: hay que decidir antes qué remesa queda. Queda como trabajo operativo
aparte, con snapshot de la base y vista previa antes de tocar nada.
  Después del arreglo esos casos quedan en SIT-041 con el saldo correcto (la mitad), que es el estado
  honesto mientras no se pueda probar qué clave se pagó.
- **Camino para recuperarlos, opcional y posterior (fase 4b):** si aparecen los `MULTI_*` de esas
  nóminas y se cargan, un segundo script propone (solo CSV, sin escribir) los pares pago ↔ clave por
  `(empresa, trámite, importe exacto en centavos)` y aplica **únicamente** los que tengan un match
  **único**, escribiendo `pago.referenciaClave`. A partir de ahí no hay lógica especial: la regla de
  §10.5 hace el resto en la consolidación siguiente. Bloqueado por tener los archivos.

**Para la fase 4a no hay backfill de datos**: `referenciaClave` nace en `NULL` para los 395+ pagos
existentes y la regla simplemente no los mira.

### 10.9 Visibilidad — el aviso antes de ejecutar

**Vista previa de la carga de PAGOS** (`validateRemesa`, rama de PAGOS,
`imports.service.ts:1323-1404`). Hoy la vista previa solo mira las primeras `sampleRows` filas. Si la
plantilla mapea `nroConvenio`, se agrega una pasada **completa sobre esa columna** (texto, sin base) y
una consulta agrupada a `clave_pago` en tandas de 1.000 convenios:

```ts
multiclavePagos: {
  filas: number;              // filas del archivo
  conClave: number;           // filas con un nroConvenio que normaliza
  ilegibles: number;          // valor presente que no normaliza (ni 0/vacío/-)
  claveCargada: number;       // convenios que existen en clave_pago de ESTA empresa
  claveOtraEmpresa: number;   // existen, pero en otra empresa
  claveNoCargada: number;     // no existen
  quita: number; total: number;  // desglose por tipo de las cargadas
  sinCaso: number;            // trámites de claves cargadas sin caso en la empresa
  tramitesEnVariosCasos: number;
  importeConClave: string;    // suma de los importes de esas filas
}
```

Advertencias de texto, con el número exacto, en el bloque que el wizard ya muestra:

- *"23 de las 104 filas traen número de convenio de clave de pago. 6 corresponden a claves cargadas en
  TELECOM_PERSONAL (6 de quita, 0 de saldo total) y **17 a claves que no están cargadas**: esos 17
  casos NO se van a cancelar con quita. Cargá las claves de esas nóminas y volvé a consolidar."*
- *"9 convenios pertenecen a claves de OTRA empresa (TELECOM). Esas filas se cargan como pago común si
  el trámite existe acá."*
- *"2 trámites con clave están en más de un caso de esta empresa: el pago va al caso con el convenio de
  la clave, o al de la remesa más reciente."*
- *"3 filas traen algo en la columna del convenio que no se puede leer como clave (`9623442`)."*
- Las de siempre (importes negativos, colisiones de identidad) no cambian.

**Resumen después de cargar**: los mismos contadores, más `casosFueraDeRemesaOrigen`, en el `log` del
`afterAll` y como filas `[aviso]` en la pantalla de detalle de la importación (§10.3e).

**Después de cargar claves**, el `afterAll` de `multiclaves.processor` consolida (scope `DEUDORES`) los
casos de los trámites recién cargados **que ya tienen pagos con `referenciaClave`** — es la forma de
que los 17 pagos "huérfanos" se cancelen solos cuando llegue su archivo de claves. Va envuelto en
try/catch (los errores de `afterAll` se tragan) y el resumen del lote muestra el conteo, así que si
falla queda el botón "Consolidar" de siempre. Es el único caso en que el processor de multiclaves hace
algo en `afterAll`, y es best-effort a propósito (desvío consciente de §5.5).

### 10.10 Regla (b) — DESCARTADA en la auditoría de la fase 4a

> **2026-09-16, auditoría de la fase 4a.** Esta sección describía una regla de respaldo — "regla
> (b)": si el caso tenía un convenio `CLAVE_PAGO` ACTIVO y `Σ pagos con fecha ≥ día(createdAt del
> convenio) − 1 ≥ montoTotal del convenio − TOL`, cancelaba igual, pensada para pagos que llegan
> **sin** el número de convenio (un pago manual, una cartera cuyo archivo no trae la columna, una
> plantilla todavía sin mapear). Un auditor la implementó, la midió y la sacó del alcance de la fase
> **antes de cerrarla** — no llegó a producción. Se deja la sección para que quede constancia de por
> qué NO existe, en vez de borrarla y que alguien la reinvente.
>
> **Por qué se descarta.** La regla (b) condona deuda mirando solo un TOTAL acumulado desde una
> fecha, sin mirar de dónde vino esa plata. Medido: un caso con un cupón de quita emitido (convenio
> `CLAVE_PAGO` ACTIVO, `importeQuita > 0`) y un cobro **común** de $16.000 contra una deuda de
> $31.000 quedaba "Cancelado con quita" con `saldo = 0` — perdonando $15.000 sin que Telecom hubiera
> confirmado el pago de esa clave en particular. El número de convenio del archivo del cedente
> (regla del archivo, §10.5) es la única prueba real de que se pagó ESA clave; una condonación
> automática por monto no tiene ese respaldo.
>
> **Qué pasa, entonces, con un pago sin `nroConvenio` sobre un caso con cupón de quita emitido.** No
> cancela con quita por esta vía. Sigue las reglas de siempre: `Σpagos` contra `montoTotal` del
> caso, con la tolerancia porcentual de consolidación (`CONSOLIDACION_TOLERANCIA_PCT`). Si el pago
> real fue el de la clave pero llegó sin la referencia (un pago manual cargado antes del archivo, o
> una plantilla sin ese campo), la vía correcta es que el archivo del cedente eventualmente traiga
> ese convenio (el claim de un pago manual ya guarda `referenciaClave` al confirmarse, ver §10.3),
> no que el sistema adivine por el monto.
>
> **Qué queda de lo que describía esta sección**: nada del código. `CONSOLIDACION_TOLERANCIA_CLAVE_CENTAVOS`
> y `CONSOLIDACION_CLAVE_MODO` (§10.5c) siguen existiendo — son de la regla del archivo, no de esta.
> R9 (la regla en sí) y R10 (el convenio ANULADO no cuenta) quedan sin efecto práctico: no hay
> ninguna regla que mire el convenio para decidir una cancelación.

---

## 11. Frontend

### 11.1 Ficha — solapa Convenios

`FichaConveniosTab.tsx` recibe `deudorId`, `empresaId` y `cuentaCancelada` (hoy solo `disabled`).
Arriba de la lista de convenios, componente nuevo
`frontend/src/components/deudores/ficha/ClavesPagoCard.tsx`:

- Se pide `GET /multiclaves/deudores/:id/claves` al abrir la solapa. **Si no hay claves, no se
  muestra nada** (la mayoría de las carteras).
- Tabla: tipo (chip `Saldo total` / `Con quita 50%`), vencimiento (`fechaDelCedente`, con chip
  `Vencida` en `error`), importe (`es-AR`), clave de pago (monoespaciada, botón copiar), convenio de
  Telecom, estado del convenio (`Cupón emitido` si hay convenio activo en este caso).
- Toggle "Ver reemplazadas" (`incluirReemplazadas=true`), filas en `text.disabled`.
- Avisos arriba de la tabla (`Alert` de MUI): saldo distinto del saldo de Telecom; otros casos del
  mismo trámite en gestión; plantilla de mail no configurada (solo informativo: descargar sigue).
- Botón **Generar cupón** por fila. Deshabilitado con tooltip si: cuenta cancelada, clave vencida,
  clave reemplazada sin convenio, falta `convenios.generar_cupon`.
- Solapa: badge con la cantidad de claves vigentes, para que se note sin entrar.

En la lista de convenios existente: los `CLAVE_PAGO` muestran chip `Clave · Con quita` o
`Clave · Saldo total`, el `importeQuita` y un botón **Reimprimir cupón** (GET del PDF, abre en pestaña
nueva) mientras estén ACTIVOS y la cuenta no esté cancelada. Si el caso quedó cancelado por la clave,
chip `Cumplido` en `success`.

### 11.2 Diálogo `GenerarCuponDialog.tsx`

`frontend/src/components/deudores/ficha/modals/GenerarCuponDialog.tsx`.

> **Desvío de esta fase 3 sobre el diseño original:** el plan de abajo describía un asistente de
> pasos numerados (opción → destinatarios → vista previa → botones). Se implementó como **una sola
> vista** (como ya era el diálogo de la fase 2, sin envío), con una sección nueva "Enviar por mail"
> que aparece debajo de la vista previa — más simple de mantener y consistente con cómo ya se veía el
> diálogo antes de esta fase. La funcionalidad de cada "paso" está toda, solo que no son pantallas
> separadas. No implementado: el link directo desde el 409 `CONVENIO_CLAVE_EN_OTRO_CASO` (ese caso ya
> se corta antes, en la vista previa — ver `otroCasoId`/"Abrir ese caso" más abajo, que cubre el mismo
> problema desde el aviso, no desde el error del POST).

Contenido:

- **Opción**: TOTAL o QUITA (preseleccionada la de la fila, `ToggleButtonGroup` si el trámite tiene
  las dos), con importe y vencimiento impreso.
- **Avisos** (`Alert`, uno por cada string de `preview.avisos`): incluye el de `otroConvenioActivo`
  ("Ya hay un cupón emitido por…") con el checkbox obligatorio "Anular el convenio de la otra clave y
  generar este cupón" al lado (solo habilitado con `convenios.cancelar`; sin el permiso, deshabilitado
  con la explicación) y el de "esta clave ya tiene un convenio en otro caso" con un botón **"Abrir ese
  caso"** (deja el id en `localStorage` y recarga `/gestion` — la pantalla de Gestión no tiene URL por
  caso).
- **Vista previa**: el PDF de preview en un `<iframe>` (blob), con marca de agua.
- **Enviar por mail** (solo si `puedeEnviarEmail`, prop que baja de `FichaDeudor.tsx` con
  `tienePermiso('email.enviar')`): al abrir el diálogo se piden `GET /email/empresa/:id/smtp` y, si
  hay cuenta, `GET /email/empresa/:id/templates` — mismo patrón que `EnviarEmailDialog.tsx`, sin
  selector de cuenta SMTP. Sin cuenta, `Alert` informativo y la sección no ofrece nada más (solo
  Descargar); si la comprobación de la cuenta explota (Sender no responde, no "sin cuenta"), un
  `Alert` de error distinto con botón Reintentar (hallazgo de la auditoría, §20 — antes las dos cosas
  se confundían). Con cuenta:
  - Destinatarios: chips de `preview.destinatariosDisponibles` (tildable, solo se aplican como
    default la PRIMERA vez que carga el preview — cambiar de clave ya no pisa lo tipeado a mano) +
    campo para uno manual (validado con una regex simple, igual que `EnviarEmailDialog`) + checkbox
    "Guardar como contacto" (crea el contacto vía `ContactosService.create`, y solo si el envío llegó
    a alguien).
  - Select de plantilla ("Sin plantilla — mensaje por defecto" primera opción, después las de
    `templatesDeEmpresa`; nunca muestra un id preseleccionado que no esté en esa lista). Al cambiar
    (o al cambiar de clave con una plantilla ya elegida), se vuelve a pedir
    `GET …/cupon/preview?templateId=` (sin regenerar el PDF) para refrescar `variablesSinValor`,
    `avisosPlantilla` y `plantillaError` — estado que vive aparte de `preview` (`plantillaInfo`,
    hallazgo de la auditoría, §20) para no arrastrar el aviso de una plantilla vieja. `variablesSinValor`
    no vacío, o `plantillaError` no nulo (la plantilla no se pudo resolver), deshabilitan "Enviar"/
    "Enviar y descargar". `avisosPlantilla` (variables que resuelven a la deuda del caso, no al cupón)
    se muestra pero no bloquea.
- Botones: **Descargar** siempre; **Enviar** y **Enviar y descargar** solo si `puedeEnviarEmail` y hay
  cuenta SMTP. Al volver del POST: si `descargaUrl` no es `null`, se baja como blob con el token; se
  llama a `onGenerado()` (recarga claves, convenios, comentarios y el caso) **pase lo que pase con el
  mail**, porque el convenio ya se creó. Si el envío no fue un éxito total (`parcial`, `omitido` o
  `fallo` — clasificación igual a `CuponService`), el diálogo **no se cierra**: queda un `Alert`
  persistente con el detalle, `Descargar` sigue disponible y el botón "Enviar" pasa a decir
  "Reintentar envío" (reusa el mismo convenio). Solo con envío 100% exitoso, o sin envío
  (`DESCARGAR`), se cierra solo con un `notify.success` (hallazgo de la auditoría, §20 — antes se
  cerraba siempre, con un aviso de 4 segundos como única pista de que algo había fallado).

Todo con `theme.palette`, sin colores fijos. Funciona en modo oscuro.

### 11.3 Importación

- `CategorySelector.tsx`: tarjeta `MULTICLAVES`, "Claves de pago (multiclaves)", "Claves de pago
  precargadas de Telecom/Personal para emitir cupones", ícono `QrCode2`/`Receipt`, color de
  `theme.palette`.
- `PlantillaEditor.tsx:39-63`: `MULTICLAVES` en `CATEGORIAS` y `ENTITY_MAP` (`MIXTO`). Con esa
  categoría: sin `MappingEditor`, sin estados por defecto, sin división; panel de solo lectura
  `MulticlavesLayoutInfo.tsx` con las 10 columnas y un campo editable `codigosGestor`.
- `ImportWizard.tsx:142-149`: `MULTICLAVES` fuera de `needsOrigen`. Número de remesa con placeholder
  "Se genera solo (MC-…)" y validación de "no puramente numérico". En el paso de vista previa,
  `MulticlavesResumen.tsx` con la tabla de `multiclaves` (§5.6): líneas → trámites → válidos /
  rechazados por motivo, con caso / sin caso, en otra empresa (en `error` si `conCaso == 0`),
  reemisiones, ya cargadas, vencimientos, avisos. La tabla de muestra de filas no se muestra para esta
  categoría.
- `ImportDetail.tsx` / `ImportHistory.tsx`: para `MULTICLAVES`, rotular "trámites" en vez de "filas" y
  mostrar el resumen de §5.7 con link a la lista de sin caso.
- `processor-registry.spec.ts:10-14`: agregar `MULTICLAVES` a la lista.

### 11.4 Ajustes de empresa

`AjustesEmpresas.tsx`: dentro del diálogo "Editar empresa" (solo al editar una empresa existente, no
al crearla), un `Accordion` colapsable "Claves de pago (cupón de Telecom/Personal)" — visible con
`empresas.editar`: plantilla de Sender **preseleccionada** (combo con `GET /email/empresa/:id/
templates`, corregido del `/email-sender/empresa/:id/templates` del diseño original — ese prefijo no
existe, el controller de `EmailSenderModule` cuelga de `/email`; deshabilitado si la empresa no tiene
`cuentaSmtpId`, o si a quien edita le falta `email.enviar` — el pedido de plantillas a Sender ni se
hace en ese caso, hallazgo de la auditoría, §20), código de gestión al generar, medios de pago (campo
de texto separado por comas) y leyenda. Sin campo de corrimiento del vencimiento impreso: desde la
fase 1.1 (D12) es una regla fija (`hoy + 7 días`, tope en el vencimiento real), no un parámetro por
empresa. Guarda con `PATCH /multiclaves/empresas/:id/config` (§9.4), **no** con el update de
empresa — en el mismo click de "Guardar" del diálogo, después de guardar los datos básicos de la
empresa, y **solo si algo de esta sección cambió** respecto de lo que se cargó al abrir (hallazgo de
la auditoría, §20: antes se mandaba siempre, así que guardar cualquier campo de una empresa que nunca
usó multiclaves —AYSA, por ejemplo— igual le agregaba un bloque `multiclaves` con los defaults). Si
ese `PATCH` falla, el diálogo lo dice por separado — no dice "Empresa actualizada correctamente" como
si nada.

### 11.5 Fase 4 — dónde se ve la cancelación con quita

- **Editor de plantillas** (`MappingEditor.tsx:66-74`): el campo `nroConvenio` aparece en la lista de
  campos de PAGOS. Sin nada más: es un `<Select>` más de la fila de mapeo.
- **Wizard de importación, paso de vista previa**: si la plantilla mapea `nroConvenio`, un bloque
  nuevo con la tabla de `multiclavePagos` (§10.9) — filas con clave, clave cargada / de otra empresa /
  **no cargada** (en `warning` si `claveNoCargada > 0`, porque esos casos no se van a cancelar),
  trámites sin caso, trámites en varios casos, e importe total con clave. Componente
  `frontend/src/components/import/PagosConClaveResumen.tsx`, mismo patrón que `MulticlavesResumen`.
  Sin la plantilla mapeada, el bloque no aparece y la pantalla queda como hoy.
- **Detalle de la importación** (`ImportDetail.tsx`): los avisos `[aviso] …` del `afterAll` ya se
  muestran con el mecanismo existente; solo hay que asegurarse de que los códigos nuevos
  (`CLAVE_NO_CARGADA`, `CLAVE_DE_OTRA_EMPRESA`, `CASO_FUERA_DE_REMESA_ORIGEN`,
  `TRAMITE_EN_VARIOS_CASOS`, `REFERENCIA_CLAVE_ILEGIBLE`) tengan un texto legible, no la sigla sola.
- **Modal de consolidación** (`ConsolidacionModal.tsx:251-262`): dos filas nuevas debajo de SIT-050 y
  SIT-041 — **"Cancelados con quita (SIT-054)"** (`aSIT054`) y *"…de ellos, por clave de saldo total"*
  (`aSIT050PorClave`). Si `sit054Degradado > 0`, un `Alert` de `warning`: *"N casos se cancelaron como
  SIT-050 porque falta el código SIT-054. Correr `alta-sit-054.ts` y volver a consolidar."*
- **Ficha del caso**: el chip de situación muestra "Cancelado con quita" solo porque lee la
  descripción del parámetro — no hay nada que tocar. En `ClavesPagoCard`, la fila de la clave pagada
  lleva chip `Pagada` en `success` con el importe y la fecha del último pago (`claves[].pagos`), y
  arriba de la tabla un `Alert` de `success` con `avisos.canceladoConQuita`: *"Cancelado con quita:
  pagó $ 15.500,00 de $ 31.000,00 (quita $ 15.500,00) con la clave 96234420."* En la lista de
  convenios, el `CLAVE_PAGO` con su cuota PAGADA muestra el chip `Cumplido` en `success` (D17: el
  chip se deriva de la cuota, el convenio sigue ACTIVO).
- Todo con `theme.palette`, sin colores fijos, y funcionando en modo oscuro.

---

## 12. Logging

Todo con `new Logger(Clase.name)`. Sin direcciones de mail ni `documento` en logs; el trámite es un
número de cuenta del cedente y se loguea solo en conteos o en `warn` puntuales.

| Dónde | Nivel | Mensaje |
|---|---|---|
| Runner, rama multiclaves | `log` | `Multiclaves remesa=R: 14956 líneas → 7478 trámites (7478 válidos, 0 rechazados, avisos={SALDO_DISTINTO_ENTRE_FILAS:2}) en 180ms` |
| Processor, por lote | `debug` | `lote n: nuevos=… reemisiones=… yaCargadas=… errores=…` |
| Processor, `afterAll` | `log` | `Multiclaves remesa=R: cargadas=… reemplazadas=… conCaso=… sinCaso=… en …ms` (conCaso por query) |
| Vista previa | `log` | `Preview multiclaves remesa=R empresa=E: tramites=… conCaso=… enOtraEmpresa=… en …ms` |
| Borrado de carga | `log` / `warn` | intent/done con claves borradas y restauradas; `warn` si se rechaza por convenios |
| `CuponService.generar` | `log` | intent: `claveId deudorId accion destinatarios=N`; done: `convenio=… reusado=… anulado=… gestion=… envio=ok|fail en …ms` |
| Errores de negocio del cupón | `warn` | `code` + `claveId` + `deudorId` |
| PDF | `debug` / `error` | tiempo de render; `error` con stack si pdfmake o bwip-js fallan; `error` si el código no revalida (§7.1) |
| Logo ausente | `warn` (una vez) | ruta buscada |
| Mail que falla | `warn` | `envioId`, `deudorId`, primer error (el `error` con stack ya lo loguea `EmailSenderService`) |
| Consolidación | `log` (ya existe) | se agregan `aSIT054` y `aSIT050PorClave` al mensaje done |
| Consolidación, >1 convenio de clave activo | `warn` | `deudorId`, ids |
| Consolidación, SIT-054 ausente | `error` (una vez, en `onModuleInit`) | `"SIT-054 no existe: las cancelaciones con quita van a quedar en SIT-050. Correr npx ts-node prisma/scripts/alta-sit-054.ts"` |
| Regla (a), el trámite de la clave no es el `nroCliente` del caso | `warn` | `deudorId`, `nroTramite`, `nroConvenio` — el pago quedó pegado a un caso ajeno |
| Regla (a), cancelación aplicada | incluido en la auditoría por caso (`log` de la corrida) | clave, tipo, pagado, importe de la clave |
| `pagos.processor`, resumen de claves | `log` (en `afterAll`) | `Pagos remesa=R: 23 con clave (6 cargadas, 9 de otra empresa, 8 sin cargar), 2 trámites en varios casos, 1 caso fuera de la remesa origen` |
| `pagos.processor`, desempate con varios casos | `debug` | `nroTramite`, candidatos, criterio que ganó |
| Script de corrección de signo | `log` / `warn` | un renglón por caso con `deudorId` (nunca el documento), importe viejo y nuevo |

---

## 13. Fallos silenciosos

| Qué puede perderse o salir mal sin error | Cómo se va a notar |
|---|---|
| **Empresa equivocada** en la carga: todas las claves quedan "sin caso" | Vista previa: con caso / sin caso con el número exacto y "N están en OTRA_EMPRESA" en rojo (§5.6) |
| **Correlativo de remesas consumido** por la carga | No puede pasar: número `MC-…` y 400 si se tipea uno numérico (§5.3) |
| **Trámite con una sola clave válida** (SOLO_TOTAL, fase 1.1) | Se acepta solo si su importe es el saldo; aviso `SOLO_TOTAL` visible en la vista previa y en el resumen de la carga. Si el importe no es el saldo, `CLAVE_UNICA_NO_ES_TOTAL` |
| **Quita perdida por una línea con el trámite ilegible** (residual de la fase 1.1) | Si la línea rota es la QUITA y ni su columna 0 se lee, no se puede asociar: la TOTAL entra como SOLO_TOTAL y la oferta con quita de ese trámite se pierde (el cupón total sigue siendo correcto). Se nota solo por la coincidencia de 1 rechazo aislado y 1 `SOLO_TOTAL` en la vista previa, sin relacionarlos. Mismo hueco, con dos anomalías juntas, en los trámites donde las dos líneas traen importe = saldo (p. ej. `2598157072`). Salida: borrar la carga y recargar el archivo corregido (recargar sin borrar da `TANDA_PARCIAL`) |
| **Trámite con 0, o con 3+ líneas, o con alguna línea inválida entre 1-2** | Rechazo del trámite completo con las líneas y el motivo; conteo por motivo en la vista previa |
| **Clasificación invertida** en los trámites raros | Test con las líneas 12294/12295 y 12850/12851; aviso `SALDO_DISTINTO_ENTRE_FILAS` con el conteo (2) |
| **Importe mal convertido** (float, 0 o 1 decimal) | Parseo por texto a centavos + revalidación contra el importe embebido en clave y código: si no coinciden, rechazo `CLAVE_NO_COINCIDE` / `BARRA_NO_COINCIDE` |
| **Código de barras que no corresponde al importe** | Rechazo al cargar y revalidación antes de dibujar el PDF (§7.1) |
| **Reemisión que pisa claves con cupón emitido** | Las viejas quedan `REEMPLAZADA`, nunca se borran; la vista previa dice cuántas tienen convenio |
| **Borrar una carga que ya emitió cupones** | 400 con la cantidad (§5.8) |
| **Recargar el mismo archivo** duplica | Unique `nroConvenio`; la vista previa muestra "ya cargadas: 7.478" |
| **Mismo archivo en otra empresa** | Rechazo `CONVENIO_YA_EXISTE` con empresa y remesa; conteo de conflictos en la vista previa |
| **Cupón descargado sin convenio** | La vista previa no tiene código de barras (D6) |
| **Doble clic** crea dos convenios | `SELECT … FOR UPDATE` sobre las claves del trámite + reuso (§8.1, 9a/9c). Test de concurrencia |
| **Mail que no sale** y el operador cree que sí | La respuesta y la notificación lo dicen; comentario "El envío por mail FALLÓ"; `envio_email` en ERROR visible en el timeline |
| **Mail con variables vacías** | 400 antes de enviar; el diálogo muestra la lista y deshabilita Enviar |
| **Pagar la quita deja SIT-041 para siempre** | Regla R11 (archivo — la única; R9/R10 se descartaron en la auditoría, §10.10); contadores `aSIT054` y `aSIT050PorClave` en la consolidación; auditoría por caso |
| **Cancelado por quita con saldo 50%** | `saldo = 0` explícito en los grupos `sit054Ids` / `sit050PorClaveIds`, **fuera** de los dos `$executeRaw` de recálculo (`consolidacion.service.ts:379-385, 400-407`); la query de verificación de §16.2 lo controla |
| **Pago que cae en otro caso del mismo trámite** (`pagos.processor.ts:85-94`: `LIMIT 1` sin `ORDER BY`) | Medido en prod el 2026-09-16: **5.448 `nroCliente` repetidos en la empresa 9**. La fase 4 lo arregla en dos capas: con clave, el desempate explícito de §10.3c; sin clave, un `ORDER BY` determinista (remesa más reciente, `id DESC`) que reemplaza la moneda al aire |
| **El convenio del pago no tiene su clave cargada** → el caso no se cancela y nadie se entera | Vista previa de la carga con el número exacto (*"17 a claves que no están cargadas"*), aviso en el detalle de la importación, y **la referencia queda guardada**: al cargar esas claves, la consolidación cancela sola (R13) |
| **La misma clave pagada dos veces choca contra la unique de `idExterno`** y el segundo pago se pierde | La llave derivada lleva día e importe adentro (D16); dos pagos distintos de la misma clave entran los dos |
| **Recargar un archivo ya cargado antes de mapear el convenio duplica la cobranza** | La llave derivada **no saltea** la heurística de día + importe + observación (§10.3b); test de regresión con una cartera de `PAYMENT_ID` real que sí la tiene que saltear |
| **El importe negativo del archivo de cobros** (columna 15 negativa en las 104 filas) | `removeDashes` en la plantilla + coerción en el processor. **Ya pasó**: 20 pagos de julio quedaron en negativo y dejaron la deuda 50% más alta (§10.8). La vista previa lo avisa (`imports.service.ts:1397-1404`) |
| **Mapear el importe a la columna 23 "porque viene positiva"** | Es positiva **solo** en los 23 pagos con clave; en los 81 comunes es negativa (§10.1). El spec lo deja escrito y el plan de pruebas lo cubre |
| **SIT-054 sin crear en producción** → cancelaciones con quita indistinguibles de SIT-050 | La consolidación no se cae: `error` al arrancar, `sit054Degradado` en el resultado, `Alert` en el modal, y **se corrige sola** en la corrida siguiente al crear el código (§10.7) |
| **SIT-054 invisible para el resto del sistema** (acciones masivas, combo de remesas, re-asignación) | Los cinco lugares que comparan contra la clave `SIT-050` pasan a resolver por **categoría CANCELADO** (§10.7), con un helper compartido. Lo que ya andaba por categoría —bloqueo de la cuenta, tableros— no se toca |
| **Un reporte guardado que filtra "situación = SIT-050"** deja de ver los cancelados con quita | Aviso en el CHANGELOG y en la wiki de reportes; criterio de aceptación 30 |
| **Pagos de posbaja que no encuentran el caso** (vienen por cuenta y el caso está por trámite) | Cerrado con la muestra: el archivo trae el **trámite** en la columna 5 y las plantillas 48/49 lo mapean a `nro_cliente`; los 6 trámites con clave que se pudieron cruzar están en el CA (§10.1). El riesgo R4 queda cerrado |
| **El pago con clave no se puede revertir** | Un `IMPORT_PAGOS` no se borra desde la UI (`pagos.service.ts:69-72`) y borrar la remesa de pagos no borra los pagos (`imports.service.ts:2447`). Documentado como limitación en §10.6, con el camino por script |
| **Permiso nuevo invisible** | `permisos-catalogo.spec.ts` compara las dos copias; paso de despliegue para asignarlo |
| **Logo que no llega a la imagen** | `nest-cli.json` assets + test del build (§16.1) + fallback a texto con `warn` |
| **Config de mora pisada** al guardar la de multiclaves | Endpoint propio que mergea solo `multiclaves` (§9.4) + test |
| **Vencimiento mostrado un día antes** | `@db.Date` + `fechaDelCedente()` en el front |
| **Archivo subido que desaparece en el deploy** | Usa `FileStorageService` del pipeline, que escribe en el volumen `uploads` |
| **Errores del `afterAll` tragados** (`imports.service.ts:1763-1768`) | En la carga de claves, todo lo que importa ocurre en `processBatch`, que reporta por trámite. Lo único que vive en `afterAll` es **best-effort y repetible a mano**: la re-consolidación de los trámites recién cargados (§10.9) y los avisos informativos de la carga de pagos (§10.3e). Si fallan, el botón "Consolidar" y el log siguen estando |

---

## 14. Riesgos

| # | Riesgo | Mitigación |
|---|---|---|
| R1 | **Simbología del código de barras** equivocada (el cupón se imprime, no se lee en la caja) | **Parcialmente cerrado.** La versión original de este spec eligió Interleaved 2 of 5 sin evidencia; la auditoría de la fase 2 decodificó el cupón viejo desde su propia fuente y es **Code 128 set C** (Start C, 25 símbolos, checksum mod 103, Stop) — implementado y verificado por decodificación independiente del PDF generado (sin bwip-js en la verificación), con las medidas físicas objetivo (módulo 0,254 mm = 6/600", alto 14 mm, zona muda ≥ 10 módulos). Sigue pendiente el **gate físico**: imprimir un cupón y escanearlo con un lector físico y una app, comparando los 50 dígitos contra `SEC_COD_BARRA`. **No se habilita el permiso `convenios.generar_cupon` en prod hasta pasar ese gate físico** |
| R2 | Vencimiento impreso distinto del real | Cerrado (D12, fase 1.1): regla fija `min(hoy + 7 días, fechaVencimiento)`, nunca un parámetro que pueda extender el plazo real; el código de barras siempre lleva el vencimiento real |
| R3 | La regla nueva en la consolidación cancela casos que no pagaron | La regla solo mira pagos con `referenciaClave` que matchea una `clave_pago` **de la misma empresa**, y compara contra el importe de esa clave, no contra la deuda. Tests de la tabla de §10.6. **Dry-run obligatorio** de consolidación por empresa antes y después del deploy: sin pagos con clave, `aSIT054` y `aSIT050PorClave` tienen que dar **0** y el resto de los contadores tiene que ser idéntico al de antes del cambio |
| ~~R4~~ | ~~Los pagos de posbaja no caen en el caso (vienen por cuenta de 16 dígitos, el caso está por trámite)~~ | **Cerrado 2026-09-16** con el archivo real: el MA trae el **trámite** en la columna 5 (10 dígitos, las 104 filas) y las plantillas 48/49 ya lo mapean a `nro_cliente`; los 6 trámites con clave que se pudieron cruzar están los 6 en el `CA_20260828`. Las cuentas de 16 y 11 dígitos (columnas 18 y 30) están, pero no son las que se usan |
| R5 | Trámite en varias remesas: el pago cae en otro caso | **Medido**: 5.448 `nroCliente` repetidos en la empresa 9 (prod, 2026-09-16) — no es un borde. La fase 4 lo ataca: desempate explícito para los pagos con clave y `ORDER BY` determinista para el resto (§10.3c). Sigue siendo posible que el pago caiga en el caso "equivocado" cuando los dos son legítimos; la diferencia es que ahora la elección está escrita y es repetible |
| R6 | pdfmake no renderiza bien el SVG de bwip-js | PNG con `scale ≥ 4` como alternativa (§7.3) |
| R7 | Telecom cambia el % de quita o manda 3 claves | Aviso `QUITA_NO_ES_MITAD`; rechazo `TRAMITE_INCOMPLETO` visible con el conteo |
| R8 | `db push` a medio aplicar | Todo aditivo; verificación con `migrate diff` (§4.6) |
| R9 | ~~El archivo de claves mezcla Telecom y Personal y los casos están en dos empresas~~ | Cerrado (Q1, fase 1.1): el archivo es de **Personal Móvil** únicamente, viene uno por nómina asignada (`MULTI_41645` = nómina 3280/1G, `MULTI_41647` = nómina 3282/2G), y en prod la plantilla 26 (empresa 10 TELECOM_PERSONAL) usa identidad `NRO_CLIENTE` con `nro_cliente@7` = trámite — una sola empresa destino. Fase 1b (§15) queda **descartada** |
| R10 | La plantilla de Sender se borra o renombra | La vista previa detecta la plantilla inexistente y deshabilita Enviar con el motivo |
| R11 | **`pagos.processor` lo usan todas las carteras.** Tocar el anti-duplicados puede duplicar o perder cobranza de AYSA, Toyota o Fiat | El cambio es una sola condición (`idExterno && !idExternoDerivado`) y no altera el camino de una cartera que no mapea `nroConvenio`. Tests de regresión obligatorios con una cartera con `PAYMENT_ID` real y otra sin identificador (§16.1) |
| R12 | **SIT-054 no creado en prod** después del deploy | No rompe nada: `error` al arrancar, cancelación degradada a SIT-050 con contador propio, y corrección automática en la consolidación siguiente. Paso explícito de despliegue (§15) y criterio de aceptación 27 |
| R13 | **El archivo mezcla las dos empresas.** El mismo MA se carga en la 9 y en la 10; los pagos con clave de la otra empresa aparecen en las dos corridas | La regla exige `clave_pago.empresaId = deudor.empresaId`, así que nunca cancela cruzado. Aviso `CLAVE_DE_OTRA_EMPRESA` contado en la vista previa y en el resumen. Riesgo residual: un trámite que exista en las dos empresas recibe el pago en la que se está cargando — comportamiento de hoy, no lo introduce la fase 4 |
| R14 | **Los 20 pagos de julio en negativo** se "arreglan" recargando el archivo | No se arregla así: la recarga hace `skip` por el anti-duplicados sin actualizar, o —si el signo ya está corregido en la plantilla— agrega un pago positivo y deja Σ = 0. El único camino es el script de §10.8, con `--dry-run` primero |

---

## 15. Plan por fases

| Fase | Qué | Bloqueada por | Deploy |
|---|---|---|---|
| **0** | Verificaciones sin código: (1) ✅ en prod, `mappingJson.columns.nro_cliente.fromIndex` de la plantilla 26 (empresa 10, TELECOM_PERSONAL) es `7` — confirmado 2026-09-14; (2) conseguir un archivo de cobros de **posbaja con pagos hechos con multiclave** (pedido a Ana Maya, pendiente — trae el número de convenio); (3) pedirle a Ana Maya el logo (pendiente); (4) crear en Sender la plantilla de mail del cupón | — | — |
| **1** | Schema completo de §4.1–4.4 + `clave-pago.ts` + parser + processor + categoría + número de remesa + vista previa + resumen + borrado + editor de plantilla + wizard + wiki de importación | Ninguna. Q1 afecta qué empresa se elige, no el código (ver R9) — cerrada en la 1.1. Q2: se guarda `marca` cruda | `db push` |
| **1.1** | Trámite con una única clave (SOLO_TOTAL): parser, processor (idempotencia y reemisión por cantidad de claves), invariante del borrado, vista previa, resumen del lote, wiki. Ver §20 | Ninguna | Sin push |
| **2** | Cupón PDF (`importe-en-letras`, bwip-js, logo, layout) + endpoints de preview, POST con acción `DESCARGAR` y reimpresión + convenio de clave + gestión + comentario + `ClavesPagoCard` + `GenerarCuponDialog` (sin envío) + permiso + wiki de gestión | Ninguna para implementar. **Gate R1** (escaneo) antes de dar el permiso en prod. Q3 cerrada (D12, regla fija); Q5 sigue con default (`GES-050`) | Sin push |
| **3** | Envío por mail: acciones `ENVIAR`/`DESCARGAR_Y_ENVIAR` (plantilla **opcional** — corrige el diseño original, ver §8.4/§20), variables propias, chequeo de variables vacías, guardar contacto, config de empresa (endpoint + sección en ajustes), extensión de `email-sender` para mandar `html`+`asunto` sin plantilla | Ninguna. **Ya no** depende de la plantilla en Sender (fase 0.4) — sigue siendo útil tenerla, pero no bloquea | `db push` (`envio_email.templateId` pasa a nullable, aditivo) |
| **4a** ✅ | **Implementada 2026-09-16, auditada y corregida el mismo día** (ver CHANGELOG.md): `pago.referenciaClave` + push; campo mapeable `nroConvenio`; `pagos.processor` (referencia, `idExterno` derivado, resolución del caso con anti-duplicados que busca en TODOS los candidatos del trámite, desempate estable por remesa/id — SIN mirar la situación del caso —, avisos); alta de **SIT-054** (seed + script); regla R11 (única — R9/R10 descartadas, §10.10) en la consolidación con SIT-054/SIT-050, `saldo = 0` y cuota PAGADA; contadores nuevos; los cinco `SIT-050` hardcodeados a categoría (§10.7); vista previa y resumen de la carga de pagos (conteos por fila, no por convenio distinto); modal de consolidación; ficha (bloqueo por categoría, no por `SIT-050`); wiki; tests. Verificado de punta a punta contra la base local con los archivos reales, incluida una recarga con trámites duplicados (§16.3) | — | `db push` (`pago.referenciaClave`, aditivo) — corrido en local. **Pendiente en prod**: los pasos operativos del CHANGELOG (script `alta-sit-054.ts` + reinicio del backend, mapear `nroConvenio` en las plantillas 48/49) |
| **4b** | Lo que depende de respuestas o de datos que no tenemos: (1) fijar `CONSOLIDACION_CLAVE_MODO` según **Q6**; (2) `H_MC_CO` vs `H_Multi_CZ` (**Q8**) si resultara que uno de los dos no cancela; (3) script de recuperación de los 20 pagos de julio (§10.8), que necesita los `MULTI_*` de esas nóminas; (4) código de gestión "Convenio con quita" (**Q5**) | Q5, Q6, Q8 y los archivos de julio | Sin push |
| ~~**5**~~ | ~~Regla (a) por referencia de clave~~ | **Absorbida por la 4a**: con la muestra en mano dejó de ser una regla "extra" y pasó a ser la principal | — |
| ~~**1b**~~ | ~~Carga de claves con varias empresas destino~~ | **Descartada** (cierre de Q1, fase 1.1): el archivo es de una sola empresa (TELECOM_PERSONAL) | — |

**Orden operativo en producción.** La fase 4 no sirve de nada sin claves cargadas: en prod
`clave_pago` tiene **0 filas** (verificado 2026-09-16). La secuencia es:

1. Cargar en TELECOM_PERSONAL los `MULTI_*` de las nóminas vigentes (fase 1, ya desplegada).
2. Deploy de la fase 4a → `db push` de `pago.referenciaClave`.
3. **Correr `npx ts-node prisma/scripts/alta-sit-054.ts --dry-run` y después sin `--dry-run`, y
   REINICIAR el backend.** Sin esto, las cancelaciones con quita salen como SIT-050 (degradado,
   §10.7) — no porque el código esté mal, sino porque `ConsolidacionSituacionService` y
   `DeudorBloqueoService` cachean los ids de `parametro` una sola vez en `onModuleInit` (por
   proceso): crear el código en la base no alcanza mientras el proceso viejo siga corriendo con
   `sit054Id=null` en memoria.
4. Editar las plantillas **48** y **49** desde el editor: mapear `nroConvenio` → columna 23 (índice
   22). Las dos, porque el mismo archivo se carga una vez por empresa.
5. Dry-run de consolidación por empresa (9 y 10) **antes** de cargar nada: `aSIT054` y
   `aSIT050PorClave` tienen que dar 0.
6. Cargar el MA del día y leer la vista previa antes de ejecutar (§10.9).

Pasos de despliegue de cada fase con UI nueva: asignar `convenios.generar_cupon` a los roles que
corresponda desde la pantalla de Roles (fase 2), crear la plantilla `MULTICLAVES` en la empresa
(fase 1). Fase 3: `db push` (ver arriba); asignar `cuentaSmtpId` a las empresas TELECOM_PERSONAL que
vayan a mandar el cupón por mail (Ajustes → Empresas → Editar — **verificado 2026-09-15: en prod
ninguna de las 1, 9, 10 y 11 lo tiene**, sin esto el diálogo solo deja Descargar); `templateCuponId`
es opcional, se puede configurar después sin bloquear nada.

---

## 16. Plan de pruebas

### 16.1 Tests automáticos

**`backend/src/modules/multiclaves/utils/clave-pago.spec.ts`**
- DV de `0096311343000039760032` (2) y `49800039760032710202600000000000096311343000000009` (9).
- DV del cupón PDF: `49800043782691508202600000000000094674769000000004` → válido, convenio `94674769`,
  importe `4378269`, vto `2026-08-15`.
- DV de la grilla vieja: `0094672801000054877985` → válido, convenio `94672801`, importe `5487798`.
- Un dígito cambiado en cada una → DV inválido.
- `centavosDeTexto`: `"19880.01"` → 1988001; `"94972.8"` → 9497280; `"62709"` → 6270900;
  `"2706359.21"` → 270635921; `"1.234,56"`, `"12,5"`, `"1.234"` con 3 decimales, `""`, `"-5"` → null.
- `descomponerCodigoBarras` sobre un código con los ceros del bloque de 12 alterados → null.
- `normalizarReferenciaClave` con 8, 22 y 50 dígitos y con basura.

**`backend/src/modules/imports/utils/multiclaves-parser.spec.ts`** (fixture: las líneas reales, en un
string dentro del spec)
- Líneas 2–3 (`1841012140`): QUITA `19880.01` (mitad truncada), TOTAL `39760.03`.
- Líneas 16–17 (`1843742390`): QUITA `60571.75` (mitad redondeada).
- Líneas 14–15 (`1843717636`): importes con 1 decimal (`94972.8` / `47486.4`).
- Líneas 20–21 (`1844590902`): importe sin decimales (`62709`) y quita con 1 decimal (`31354.5`).
- **Líneas 12294–12295 (`2598157072`)**: QUITA `16414.17` (primera en el archivo), TOTAL `32828.35`,
  `saldoTramite` de las dos = `32828.35`, aviso `SALDO_DISTINTO_ENTRE_FILAS`.
- **Líneas 12850–12851 (`2598290522`)**: ídem con `13738.79` / `27477.59`.
- Trámite con la TOTAL primero y con la QUITA primero → misma clasificación.
- Trámite partido (filas no contiguas) → se agrupa igual.
- Una línea con DV corrupto → el trámite entero `TRAMITE_INCOMPLETO` citando `CLAVE_DV`.
- 3 claves para un trámite → `TRAMITE_INCOMPLETO`. Importes iguales → `IMPORTES_IGUALES`.
- Código de barras con otro vencimiento → `BARRA_NO_COINCIDE`.
- `CODIGO_GESTOR` `9999` → `GESTOR_AJENO`.
- `NRO_CONVENIO` repetido en dos líneas → `CONVENIO_REPETIDO_EN_ARCHIVO`.
- Sin 10ª columna → carga con aviso `MARCA_DESCONOCIDA`; con `X` → ídem.
- CRLF y línea vacía final → mismo resultado que LF.
- Encabezado con otro nombre de columna → error de archivo. Sin encabezado → aviso `SIN_ENCABEZADO`.
- **Opcional, marcado `skip` si el archivo no está**: el archivo completo de muestra da 14.956 claves,
  7.478 trámites, 0 rechazados, `SALDO_DISTINTO_ENTRE_FILAS: 2`, `QUITA_NO_ES_MITAD: 0`.
- **Fase 1.1 — SOLO_TOTAL**: trámite con 1 sola línea válida **e importe = saldo** → se acepta,
  clasificado TOTAL, aviso `SOLO_TOTAL`; con importe ≠ saldo (incluida la mitad) →
  `CLAVE_UNICA_NO_ES_TOTAL`. Línea con columnas de más o de menos pero trámite legible → se asocia a
  su trámite y lo rechaza entero (`2598949142` con la TOTAL truncada). Sigue rechazado con: única línea inválida; 3+ líneas (aunque las 3 sean válidas); 2
  líneas con una inválida; 2 líneas con el mismo importe (`IMPORTES_IGUALES`). El trámite real
  `2577727090` de `MULTI_41647_RA_1008_2026-08-31_10.31.09.csv:2180` (TOTAL 272350.9, sin quita), y
  el archivo completo (`skip` si no está): **9.810 trámites válidos, 19.619 claves, 0 rechazados,
  `SOLO_TOTAL: 1`**.

**`backend/src/modules/imports/processors/multiclaves.processor.spec.ts`** (Prisma mockeado, patrón de
`facturas.processor.spec.ts`)
- Trámite nuevo → 2 inserts VIGENTE.
- Mismo lote otra vez → 0 escrituras, OK (idempotente).
- Reemisión con vto posterior → vigentes a REEMPLAZADA con `reemplazadaPorRemesaId`, nuevas VIGENTE.
- Reemisión con vto anterior → nuevas como REEMPLAZADA + aviso.
- Convenio existente en otra empresa → error del trámite, sin escrituras.
- Uno de dos convenios ya existente → `TANDA_PARCIAL`.
- Falla del lote → reintento por trámite, el error queda en el trámite culpable.
- Dos corridas seguidas con el mismo processor singleton → sin estado arrastrado.
- **Fase 1.1**: trámite SOLO_TOTAL nuevo → 1 insert VIGENTE; recarga idempotente (no `TANDA_PARCIAL`
  por comparar contra 2 en vez de contra `claves.length`); reemisión 2→1 y 1→2 reemplaza **todas**
  las vigentes del trámite, nunca deja una QUITA vieja conviviendo con una TOTAL nueva.

**`backend/src/modules/imports/imports.service` (specs de wiring existentes, `varios-archivos-wiring.spec.ts` como patrón)**
- `createRemesa` MULTICLAVES sin número → `MC-…`; con `00609` → 400; con divisiones → 400.
- `siguienteNumeroRemesa(['00608','MC-20260914-1030'])` → `00609`.
- `processImportJob` MULTICLAVES sin estados por defecto → no lanza.
- `deleteRemesa` MULTICLAVES: con convenios → 400; sin convenios → borra y restaura; cadena A→B→C
  borrando B → A queda REEMPLAZADA.
- `processor-registry.spec.ts` con `MULTICLAVES`.
- **Fase 1.1** (`multiclaves-borrado-reemision.spec.ts`): invariante actualizado a "0 vigentes, o
  exactamente 1 TOTAL y a lo sumo 1 QUITA, todas de la misma carga" (antes "0 o 2"); secuencias que
  mezclan tandas de 1 y 2 claves, con su borrado.

**`backend/src/modules/multiclaves/utils/importe-en-letras.spec.ts`**
- 0, 1, 15, 21, 30, 100, 101, 115, 500, 999, 1.000, 1.001, 21.000, 100.000, 1.000.000, 2.000.000,
  2.706.359,21 (máximo del archivo), 43.782,69 ("cuarenta y tres mil setecientos ochenta y dos con 69
  centavos"), centavos 05 y 00.

**`backend/src/modules/multiclaves/cupon-pdf.service.spec.ts`**
- Genera un buffer que empieza con `%PDF`.
- Con código que no revalida → lanza.
- `vistaPrevia: true` → no llama a bwip-js.
- Sin logo → genera igual y loguea `warn` una vez.
- Vto impreso (D12): `hoy + 7 días` cuando cae antes del vencimiento real; el vencimiento real como
  tope cuando `hoy + 7 días` lo supera (clave por vencer en menos de 7 días).

**`backend/src/modules/multiclaves/cupon.service.spec.ts`**
- Flujo feliz DESCARGAR: crea convenio 1 cuota con `montoOriginal`, `importeQuita`, `clavePagoId`,
  `usuarioId` del JWT; cambia gestión a GES-050; comenta.
- Segunda vez misma clave → reusa, no crea, comenta "reenviado", no cambia gestión.
- Otra clave activa sin `reemplazarConvenioActivo` → 409; con él y sin `convenios.cancelar` → 403;
  con permiso → anula el anterior y crea.
- Convenio de la clave activo en otro caso → 409.
- Caso cancelado → 403 y sin escrituras. Clave vencida → 400. Clave de otro trámite → 400.
- ENVIAR con `EmailSenderService.enviar` que devuelve `ok:false` → convenio creado, respuesta
  `envio.ok=false`, comentario con "FALLÓ".
- ENVIAR con variable sin valor → 400 sin escrituras. Sin `email.enviar` → 403.
- PDF que falla → 500 sin escrituras.

**`backend/src/modules/consolidacion/consolidacion.service.spec.ts`** (extender — fase 4)
- Cada fila de la tabla de §10.6.
- Clave QUITA cumplida → **SIT-054**, `saldo = 0`, `aSIT054 = 1`; clave TOTAL cumplida → SIT-050 con
  `aSIT050PorClave = 1` y `aSIT054 = 0`.
- Caso con las dos claves pagadas → gana TOTAL (SIT-050), determinista aunque se invierta el orden de
  las filas de la query.
- **El saldo no se recalcula** para esos casos: con `montoTotal` 31.000 y un pago de 15.500, el saldo
  queda en `0`, no en `15.500` (es el bug que el spec viene avisando desde la versión inicial).
- Idempotencia: segunda corrida sobre un cancelado con quita → `sinCambios`, saldo 0 intacto, y el
  `UPDATE` de cuotas toca 0 filas.
- **Regresión**: un chunk sin ningún pago con `referenciaClave` da exactamente los mismos contadores
  que antes del cambio (mismo caso de test que ya existe, sin tocar).
- Tolerancia en centavos: pagado = importe − 100 centavos → cancela; − 101 → no.
- `CONSOLIDACION_TOLERANCIA_CLAVE_CENTAVOS=5000` o `CONSOLIDACION_CLAVE_MODO=RARO` → falla
  `onModuleInit`.
- `CONSOLIDACION_CLAVE_MODO=PAGO_UNICO`: dos pagos que suman el importe → **no** cancela; uno solo que
  alcanza → cancela.
- Clave cumplida con `montoTotal = null` → cancela igual (la regla corre antes del salteo de
  `:281-289`); Σpagos = 0 por un ajuste negativo con la clave pagada → cancela igual (antes de
  `:295-298`).
- `nroTramite` de la clave ≠ `TRIM(nroCliente)` del caso → **no** cancela y loguea `warn`.
- Clave de otra empresa con el mismo convenio → no matchea (el join exige `empresaId`).
- Clave `REEMPLAZADA` y clave vencida → cancelan igual.
- SIT-054 ausente en `parametro` → **no lanza** en `onModuleInit`, cancela a SIT-050 y cuenta
  `sit054Degradado`; con el código creado, la corrida siguiente mueve el caso a SIT-054.
- Convenio de clave ACTIVO del caso → su cuota pasa a PAGADA con `fechaPago` = fecha del último pago;
  el convenio sigue `ACTIVO` (D17).
- Prioridad: pago de la clave TOTAL + convenio activo de la QUITA → SIT-050, no SIT-054.
- dryRun → cuenta `aSIT054` sin escribir situación, saldo ni cuotas.

**`backend/src/modules/imports/processors/pagos.processor.spec.ts`** (extender — fase 4)
- Fila con `nroConvenio` de 8 dígitos → `pago.referenciaClave` guardado y `idExterno` = `MC-…`.
- `nroConvenio` en `0`, vacío o `-` → `referenciaClave = null`, **sin** aviso (son las 81 filas
  comunes del archivo real).
- `nroConvenio` ilegible (`9623442`) → carga como pago común + aviso `REFERENCIA_CLAVE_ILEGIBLE`.
- `nroConvenio` de 22 y de 50 dígitos → normaliza a los 8 (reusa `normalizarReferenciaClave`).
- **Regresión del anti-duplicados**: (a) cartera con `PAYMENT_ID` real → la heurística de día +
  importe **sigue salteada**; (b) mismo archivo con clave cargado dos veces → 1 pago; (c) archivo
  cargado primero **sin** el mapeo de `nroConvenio` y después **con** → sigue habiendo 1 pago (el
  caso que rompe si la llave derivada saltea la heurística); (d) dos pagos de la misma clave en días
  distintos → 2 pagos.
- Resolución del caso: clave de la empresa correcta y trámite en un solo caso → ese caso; trámite en
  dos casos, uno con el convenio de la clave → gana el del convenio; trámite en dos casos sin
  convenio → gana el no cancelado de la remesa más reciente, y el resultado es **el mismo** corriendo
  el test dos veces; clave de otra empresa → camino común + aviso; trámite sin caso → error de fila
  con el trámite y el convenio en el mensaje.
- Camino común (sin `nroConvenio` mapeado): mismo resultado que antes del cambio, salvo que con dos
  remesas candidatas ahora gana siempre la más reciente.
- Contadores reseteados entre corridas del mismo processor singleton.

**`backend/prisma/scripts/alta-sit-054.spec.ts`** (o verificación manual documentada)
- Corrido dos veces deja un solo `SIT-054`, con `categoria: 'CANCELADO'` y una fila
  `empresa_parametro` por empresa.

**`backend/src/auth/permisos-catalogo.spec.ts`**: pasa con el permiso en las dos copias.

**Build**: `cd backend && npm run build && test -f dist/modules/multiclaves/assets/logo-personal.png`.
Nunca `npm run lint` global (reformatea ~167 archivos).

### 16.2 Prueba manual

Con el archivo `MULTI_41645_RA_1008_2026-08-31_10.29.22.csv` en una base local:

1. **Carga sin casos.** Plantillas → nueva, categoría Claves de pago, empresa TELECOM. Nueva
   importación → Claves de pago → archivo. La vista previa tiene que decir: 14.956 líneas, 7.478
   trámites, 7.478 válidos, 0 rechazados, **con caso 0**, sin caso 7.478, aviso "2 trámites traen
   SALDO_TRAMITE distinto en sus dos filas", vencimiento 27/10/2026 (14.956 claves). El número de
   remesa propuesto empieza con `MC-`. Ejecutar. Historial: 7.478 trámites OK, 0 errores.
2. **Correlativo intacto.** Crear una carga de deudores cualquiera en TELECOM con el número vacío: el
   número propuesto es el siguiente al último numérico, no se saltea ninguno.
3. **Recarga.** Subir el mismo archivo otra vez en TELECOM: vista previa "ya cargadas 7.478",
   ejecutar, `clave_pago` sigue con 14.956 filas.
4. **Otra empresa.** Subirlo en TELECOM_PERSONAL: vista previa "conflictos 14.956", al ejecutar 7.478
   errores `CONVENIO_YA_EXISTE`.
5. **Caso con claves.** Crear (a mano o con un CA recortado) un caso en TELECOM con `nroCliente`
   `1841012140`, `montoTotal` 39.760,03. Ficha → Convenios: aparece "Claves de pago" con dos filas:
   Saldo total $ 39.760,03 y Con quita 50% $ 19.880,01, vto 27/10/2026, clave
   `0096332206000019880014` en la quita.
6. **Trámite raro.** Caso con `nroCliente` `2598157072`: Con quita = $ 16.414,17, Saldo total =
   $ 32.828,35.
7. **Cupón.** Generar cupón → Con quita → Descargar. Vista previa con marca de agua y sin barras. Al
   confirmar: PDF de 3 talones, importe `19880.01`, nombre del caso, cliente `1841012140`, "Son Pesos:
   diecinueve mil ochocientos ochenta con 01 centavos", código `49800019880012710202600000000000096332206000000007`
   con los dígitos debajo, referencia = id del caso. En la solapa: convenio `Clave · Con quita`,
   1 cuota de $ 19.880,01 al 27/10/2026, quita $ 19.880,02. Gestión = "Convenio acordado". Comentario
   nuevo.
8. **Doble generación.** Generar otra vez la misma clave → no aparece un segundo convenio; comentario
   "reenviado".
9. **Otra clave.** Generar Saldo total → aviso de anulación; sin marcar el checkbox no deja; marcándolo,
   el convenio de quita queda ANULADO y hay uno nuevo de $ 39.760,03.
10. **Escaneo (gate R1).** Imprimir el PDF del paso 7 en la impresora de la oficina y leer el código con
    un lector: tienen que salir los 50 dígitos exactos. Repetir con el `46992372.pdf` viejo.
11. **Mail** (fase 3). Con la plantilla configurada, Enviar a un email propio: llega con el PDF adjunto
    y `{{importe_cupon}}` reemplazado; aparece en la línea de tiempo. Con una plantilla que tiene una
    variable sin fuente: Enviar deshabilitado con la lista.
12. **Borrado.** Intentar borrar la carga de claves → 400 "N claves ya tienen convenio". Con el
    convenio del paso 9 **anulado** el borrado sigue dando 400: un convenio anulado también cuenta
    para R3.

### 16.3 Prueba manual de la fase 4, con los archivos reales

Base local, con `MULTI_41645` y `MULTI_41647` ya cargados en TELECOM_PERSONAL (empresa 10) y un CA
recortado de `CA_20260828_1008_POSBAJA_HW_260828_260828.txt` que traiga al menos los 6 trámites que
matchean: `1981517609`, `2578832982`, `2581507880`, `2597868787`, `2598220161`, `2598844381`.

1. **Alta del código.** `npx ts-node prisma/scripts/alta-sit-054.ts --dry-run` y después sin el flag.
   Verificar en Ajustes → Códigos que aparece "Cancelado con quita" en la categoría CANCELADO.
2. **Sin el código** (opcional, en una base de prueba): borrar SIT-054, reiniciar el backend. Tiene
   que **arrancar igual**, con un `error` en el log, y una consolidación con una clave pagada deja
   SIT-050 y `sit054Degradado: 1` en el modal. Volver a crear el código y consolidar otra vez: el
   caso pasa a SIT-054 solo.
3. **Plantilla.** Editar la plantilla de pagos de la empresa 10: mapear `nroConvenio` a la columna 23
   (índice 22), sin transforms más allá de `trim`. Guardar.
4. **Vista previa.** Nueva importación → Pagos → empresa TELECOM_PERSONAL → remesa origen = la del
   CA → archivo `MA_20260911_1008_POSBAJA_HW_260910_260911_C.txt`. La vista previa tiene que decir:
   **104 filas, 23 con clave, 6 con la clave cargada en esta empresa (6 de quita, 0 de saldo total),
   17 con clave no cargada**, 0 ilegibles, 0 de otra empresa, y la advertencia en texto de los 17.
   **No ejecutar todavía**: sacar una foto de los 6 casos (`montoTotal`, `saldo`, situación).
5. **Ejecutar.** Al terminar: 6 casos en **"Cancelado con quita"**, `saldo` $ 0,00, `montoTotal`
   intacto. Chequear uno a mano: trámite `1981517609` → pago de $ 15.500,00, clave `96234420`,
   `montoTotal` 31.000,00, saldo 0. En el modal de consolidación del `afterAll`: `aSIT054 = 6`,
   `aSIT050PorClave = 0`.
6. **Los pagos comunes no cambian de comportamiento.** De las 81 filas comunes: entran las que tienen
   caso, con importe **positivo** (columna 15 con `removeDashes`), y las 3 cuentas con varios pagos el
   mismo día (`2220255966` con 3 pagos de $15.000, $11.000 y $12.000; `2599750017` con 2;
   `2600315725` con 2) tienen que quedar con **todos** sus pagos, no con uno.
7. **Recarga.** Subir el mismo archivo otra vez: 0 pagos nuevos, el resumen dice "N ya estaban
   cargados", y la consolidación no cambia nada (`sinCambios`).
8. **Recarga en la otra empresa.** Subir el mismo archivo en TELECOM (empresa 9) con su plantilla: los
   6 pagos con clave de la empresa 10 **no** cancelan nada acá (aviso `CLAVE_DE_OTRA_EMPRESA`), y los
   que tengan trámite en la 9 entran como pago común.
9. **Sin la clave cargada.** Borrar la carga de claves de una de las dos nóminas y volver a
   consolidar: ese caso vuelve a SIT-041 con el saldo recalculado. Volver a cargar las claves y
   consolidar: vuelve a SIT-054 (R13, el camino que arregla a los 17 pagos huérfanos).
10. **Un caso ya cancelado no se toca.** Sobre un caso en SIT-054, intentar generar un cupón, cargar
    un comentario o una acción masiva con "saltear canceladas": los tres tienen que bloquearse.
11. **Regresión de otras carteras.** Dry-run de consolidación con scope EMPRESA sobre **AYSA** y sobre
    **Toyota**, antes y después del deploy: los cinco contadores de siempre tienen que dar **idénticos**,
    y `aSIT054` = `aSIT050PorClave` = 0. Cargar un archivo de pagos de AYSA (el del 25/07, el de las
    1.997 partidas) y verificar que siguen entrando los 1.997 cobros, no 1.192.
12. **Verificación en base** tras el paso 5:
    ```sql
    -- Ningún cancelado (de cualquier código) con saldo que quede por encima de la tolerancia
    SELECT COUNT(*) FROM deudor d JOIN parametro p ON p.id = d.estadoSituacionId
    WHERE p.categoria = 'CANCELADO' AND d.saldo > d.montoTotal * 0.01;   -- 0

    -- Los cancelados con quita, con su clave y lo que efectivamente pagaron
    SELECT d.id, d.nroCliente, d.montoTotal, d.saldo, k.nroConvenio, k.tipo, k.importe, SUM(pg.importe)
    FROM deudor d
    JOIN parametro p   ON p.id = d.estadoSituacionId AND p.clave = 'SIT-054'
    JOIN pago pg       ON pg.deudorId = d.id AND pg.referenciaClave IS NOT NULL
    JOIN clave_pago k  ON k.nroConvenio = pg.referenciaClave AND k.empresaId = d.empresaId
    GROUP BY d.id, d.nroCliente, d.montoTotal, d.saldo, k.nroConvenio, k.tipo, k.importe;
    -- 6 filas, saldo 0 en todas, SUM(importe) = k.importe al centavo

    -- Ningún pago duplicado por la llave derivada
    SELECT idExterno, COUNT(*) FROM pago WHERE idExterno LIKE 'MC-%' GROUP BY idExterno HAVING COUNT(*) > 1;  -- vacío
    ```
13. **Los 20 pagos de julio** (aparte de la fase): no se corrigen con un script del repo — son 10
    trámites duplicados entre las remesas `00606` y `22222` de TELECOM, y primero hay que decidir qué
    remesa queda. Trabajo operativo, con snapshot previo.

---

## 17. Documentación

### 17.1 Wiki de ayuda (`docs/ayuda/`)

En el mismo commit que el código de cada fase, y `cd frontend && npm run verificar-ayuda` sin errores.
Ninguna página se cierra sin un agente revisor (memoria del proyecto).

| Página | Fase | Qué |
|---|---|---|
| **nueva** `03-importacion/10-claves-de-pago.md` (`rutas: /carga, /plantillas, /historial-importaciones`) | 1 | Qué es el archivo de multiclaves, cómo crear la plantilla, qué empresa elegir, cómo leer la vista previa (con caso / sin caso / en otra empresa / reemisiones / rechazos por motivo), qué pasa al recargar, cuándo no se puede borrar |
| `03-importacion/02-categorias.md` | 1 | La categoría nueva (y "las diez categorías" pasa a once) |
| `03-importacion/08-historial-y-problemas.md` | 1 | Motivos de rechazo de claves y avisos |
| **nueva** `02-gestion/05-cupones-de-pago.md` (`rutas: /gestion`) | 2 | Las claves en la ficha, generar un cupón, total vs. quita, reimprimir, qué pasa si se genera dos veces o se cambia de clave, por qué una clave vencida no deja, el aviso de otros casos del trámite |
| `02-gestion/04-convenios.md` | 2 | El tipo "Clave" y por qué no se crea a mano |
| `06-administracion/01-roles-y-permisos.md` | 2 | `convenios.generar_cupon` |
| `08-telefonia-y-email/03-enviar-un-email.md` | 3 | El mail del cupón y sus variables propias |
| `05-ajustes/01-empresas.md` | 3 | La sección Claves de pago |
| `02-gestion/03-pagos-y-promesas.md` | 4a | Cuándo un pago cancela con quita y cuándo no (tabla de §10.6 en lenguaje de operador); qué significa "Cancelado con quita"; por qué el saldo queda en $ 0 aunque haya pagado la mitad |
| `03-importacion/04-pagos.md` (o la página de la categoría PAGOS que exista) | 4a | El campo `nroConvenio` en la plantilla: qué columna es, qué pasa si no se mapea, cómo leer el bloque nuevo de la vista previa (con clave / clave no cargada / de otra empresa) y qué hacer con "17 claves no cargadas" |
| `03-importacion/08-historial-y-problemas.md` | 4a | Los avisos nuevos: `CLAVE_NO_CARGADA`, `CLAVE_DE_OTRA_EMPRESA`, `CASO_FUERA_DE_REMESA_ORIGEN`, `TRAMITE_EN_VARIOS_CASOS`, `REFERENCIA_CLAVE_ILEGIBLE` |
| `04-reportes/…` (la página que explica los filtros) | 4a | **Aviso**: un reporte que filtra "situación = Cancelado / Pagado" ya no incluye a los cancelados con quita; hay que agregar SIT-054 al filtro |
| `06-administracion/…` (códigos / parámetros) | 4a | El código SIT-054, para qué está y por qué no se carga a mano |

### 17.2 Specs

- Este archivo: estado por fase al cerrar cada una.
- `docs/consolidacion-situacion-spec.md` — **se actualiza en el mismo commit que la fase 4a**:
  §1 (reglas): las reglas 2 y 3 dejan de ser las únicas — se agrega la regla por clave de pago, con su
  prioridad y con SIT-054; §1.2 el bloqueo ahora es de toda la categoría CANCELADO (ya lo era en el
  código, `deudor-bloqueo.ts`, pero el spec sigue diciendo "SIT-050"); §2.3 las dos variables de
  entorno nuevas; §3.2 `aSIT054`, `aSIT050PorClave`, `sit054Degradado`; §3.4 el pseudocódigo con la
  regla de clave **antes** de los dos salteos (`montoTotal` nulo y Σpagos = 0); §3.5 idempotencia con
  `saldo = 0`; §7 backfill (decisión D18); §8.4 la consolidación también escribe `cuota_convenio`;
  §10.7 "cancelación reversa" **no aplica** a la cancelación por clave (R14).
- `docs/pagos-promesas-spec.md`: §3.1 el anti-duplicados con la llave derivada `MC-…` y por qué esa
  llave no saltea la heurística; §8 el bloqueo alcanza a SIT-054.
- `docs/email-sender-spec.md`: envío con adjunto generado por el backend y variables propias del cupón.

### 17.3 CHANGELOG.md

Una entrada por fase, con el formato existente (qué pasaba, backend, frontend, migración, pendiente
en producción). La de la fase 1 con las cifras del archivo real; la de la fase 2 con el resultado del
escaneo.

---

## 18. Criterios de aceptación

1. Con el archivo de muestra en una empresa sin casos: la vista previa informa **7.478 trámites, 7.478
   válidos, 0 rechazados, 0 con caso, 7.478 sin caso** y el aviso `SALDO_DISTINTO_ENTRE_FILAS` con
   **2**; al ejecutar, `clave_pago` tiene **14.956** filas VIGENTE, **7.478** TOTAL y **7.478** QUITA,
   y `remesa.errFilas = 0`.
2. `SELECT tipo, importe FROM clave_pago WHERE nroTramite='2598157072'` devuelve QUITA 16414.17 y
   TOTAL 32828.35, las dos con `saldoTramite` 32828.35. Ídem `2598290522` → 13738.79 / 27477.59.
3. Para las 14.956 claves, `importe` × 100 coincide con los centavos embebidos en `clavePago` y en
   `codigoBarras`.
4. Recargar el mismo archivo en la misma empresa deja `clave_pago` en 14.956 filas y 0 errores; en otra
   empresa da 7.478 errores `CONVENIO_YA_EXISTE` y 0 filas nuevas.
5. Después de la carga, una carga de deudores de esa empresa con número vacío propone el correlativo
   siguiente al último **numérico** (la carga de claves no lo movió). Un número `00609` en una carga de
   claves da 400.
6. Una línea con el DV de la clave alterado rechaza **su trámite completo** (2 claves) con motivo que
   cita `CLAVE_DV` y la línea; las demás cargan.
7. Una segunda tanda con vencimiento posterior para un trámite deja 2 claves VIGENTE y 2 REEMPLAZADA;
   borrar esa segunda carga devuelve las primeras a VIGENTE; si alguna clave de la segunda tiene
   convenio, el borrado da 400.
8. El PDF de un cupón contiene los 50 dígitos exactos del archivo como texto y como código de barras
   **legible con un lector físico** (gate R1, con evidencia en el CHANGELOG de la fase 2).
9. La vista previa del cupón no contiene código de barras.
10. Generar dos veces la misma clave para el mismo caso deja **1** convenio `CLAVE_PAGO` ACTIVO; dos
    POST concurrentes también.
11. No puede haber dos convenios `CLAVE_PAGO` ACTIVOS del mismo trámite: pasar a la otra clave exige
    `reemplazarConvenioActivo` y `convenios.cancelar`, y anula el anterior.
12. Caso en SIT-050/051/052/053 → 403 al generar y al reimprimir.
13. Un mail que Sender rechaza deja el convenio creado, `envio_email` en ERROR, un comentario que dice
    que falló y `envio.ok=false` en la respuesta.
14. Con convenio de quita de $ 19.880,01 creado hoy, un pago de $ 19.880,01 (o $ 19.880,00) con fecha de
    hoy lleva el caso a **SIT-054** con `saldo = 0` y la cuota a PAGADA; correr la consolidación otra vez
    no cambia nada (`sinCambios`). Con un convenio de clave TOTAL, el mismo flujo lleva a SIT-050.
15. El mismo pago **sin** convenio de clave y **sin** `nroConvenio` en el archivo deja SIT-041 y saldo
    `montoTotal − 19.880,01`.
16. La consolidación de una empresa sin claves ni pagos con referencia da exactamente los mismos
    contadores antes y después del cambio (regresión), con `aSIT054 = aSIT050PorClave = 0`.
17. `permisos-catalogo.spec.ts` pasa y `convenios.generar_cupon` aparece en la pantalla de Roles.
18. `dist/modules/multiclaves/assets/logo-personal.png` existe después de `npm run build`; sin el
    archivo, el cupón se genera con el texto "Personal".
19. Guardar la config de multiclaves de una empresa con `configuracion.mora` cargada conserva la de mora
    intacta.
20. `npm run verificar-ayuda` sin errores; las páginas de §17.1 de la fase existen y declaran sus rutas.

### Fase 1.1

21. **(Fase 1.1)** Con `MULTI_41647_RA_1008_2026-08-31_10.31.09.csv` en una empresa sin casos: la vista
    previa informa **9.810 trámites válidos, 19.619 claves, 0 rechazados, `soloTotal: 1`**; el trámite
    `2577727090` carga con **1 sola** clave TOTAL de $ 272.350,90. Una reemisión que cambia la cantidad
    de claves de un trámite (2→1 o 1→2) reemplaza **todas** las vigentes anteriores — nunca coexisten
    una QUITA vieja con una TOTAL nueva de otra tanda — y borrar cualquier carga de la cadena mantiene
    el invariante "0 vigentes, o 1 TOTAL y a lo sumo 1 QUITA de la misma carga".

### Fase 4a

22. Con las claves de `MULTI_41645`/`MULTI_41647` cargadas en TELECOM_PERSONAL, los 6 trámites que
    matchean cargados como casos, y el archivo `MA_20260911_1008_POSBAJA_HW_260910_260911_C.txt`: la
    vista previa informa **104 filas, 23 con clave, 6 con clave cargada (6 QUITA / 0 TOTAL), 17 con
    clave no cargada, 0 ilegibles, 0 de otra empresa**.
23. Al ejecutar esa carga: exactamente **6 casos quedan en SIT-054 "Cancelado con quita"** con
    `saldo = 0,00` y `montoTotal` intacto; `aSIT054 = 6` y `aSIT050PorClave = 0`. Para el trámite
    `1981517609`: pago $ 15.500,00, `referenciaClave = '96234420'`, `montoTotal` 31.000,00, saldo 0.
24. Los 17 pagos con clave no cargada **no** cancelan nada y quedan con su `referenciaClave` guardada.
    Al cargar después las claves de esas nóminas y consolidar, esos casos pasan a SIT-054 **sin tocar
    los pagos**.
25. Las 81 filas de pagos comunes cargan con importe **positivo** y el mismo comportamiento de hoy: los
    3 trámites con más de un pago (`2220255966`, `2599750017`, `2600315725`) quedan con sus 3, 2 y 2
    pagos respectivamente, no con uno.
26. Recargar el archivo entero deja **0** pagos nuevos y `sinCambios` en la consolidación. Cargar el
    archivo primero **sin** el mapeo de `nroConvenio` y después **con** el mapeo tampoco duplica ningún
    pago. `SELECT idExterno, COUNT(*) FROM pago WHERE idExterno LIKE 'MC-%' GROUP BY 1 HAVING COUNT(*)>1`
    devuelve vacío.
27. Sin `SIT-054` en la tabla `parametro`, el backend **arranca**, la cancelación sale como SIT-050 y
    `sit054Degradado > 0`; creando el código y volviendo a consolidar, esos casos pasan a SIT-054 sin
    ninguna otra intervención.
28. `SELECT COUNT(*) FROM deudor d JOIN parametro p ON p.id=d.estadoSituacionId WHERE p.categoria='CANCELADO' AND d.saldo > d.montoTotal*0.01`
    devuelve **0** después de la carga.
29. Un caso en SIT-054 está bloqueado igual que uno en SIT-050: 403 al generar cupón, al comentar y al
    cambiar la gestión; una acción masiva con "saltear canceladas" no lo toca; el combo de "remesa de
    deudores" no cuenta su remesa como en gestión; borrar su último pago lo devuelve al default de la
    plantilla.
30. Los tableros cuentan los SIT-054 dentro de "Cancelado" sin ningún cambio de código; un reporte que
    filtre "situación = SIT-050" **no** los incluye, y eso está avisado en la wiki y en el CHANGELOG.
31. Dry-run de consolidación con scope EMPRESA sobre AYSA y sobre Toyota: los cinco contadores de
    siempre dan idénticos a los de antes del cambio, y `aSIT054 = aSIT050PorClave = 0`.
32. Un archivo de pagos de AYSA con `observacion` mapeada sigue cargando sus 1.997 cobros (no 1.192), y
    una cartera con `PAYMENT_ID` real sigue salteando la heurística de día + importe.
33. Con `CONSOLIDACION_CLAVE_MODO=PAGO_UNICO`, dos pagos que suman el importe de la clave **no**
    cancelan; con el default `SUMA`, sí. Un valor fuera de rango en cualquiera de las dos variables
    nuevas hace fallar el arranque.
34. Una clave `REEMPLAZADA` y una vencida cancelan igual si el archivo trae su convenio pagado.
35. ~~Criterio del script del signo~~ — retirado: los 20 pagos de julio se resuelven con la limpieza
    de la remesa duplicada, fuera de esta fase.

---

## 19. Preguntas abiertas

Cerradas por Ana Maya el 2026-09-14 (fase 1.1):

| # | Pregunta | Respuesta |
|---|---|---|
| ~~Q1~~ | ¿A qué CA corresponde `MULTI_41645`? ¿Un archivo de claves mezcla Telecom y Personal? ¿En qué empresa se cargan esos casos? | El archivo es de **Personal Móvil** únicamente, viene **uno por nómina asignada**: `MULTI_41645` = nómina 3280 / gestión 1G, `MULTI_41647` = nómina 3282 / gestión 2G. Los 17.288 trámites de los dos archivos están al 100% en `CA_20260828_1008_POSBAJA_HW_260828_260828.txt`. En prod, la plantilla 26 "Personal posbaja(M-H) - Deudores (CA)" (empresa 10, TELECOM_PERSONAL) usa identidad `NRO_CLIENTE` con `nro_cliente@7` = trámite: la verificación 1 de la fase 0 (§15) queda cumplida. No mezcla empresas → **fase 1b descartada** (R9) |
| ~~Q3~~ | El código del cupón viejo vence el 15/08 y el talón imprime 15/09. ¿Cuál es la fecha real hasta la que se puede pagar? | El vencimiento impreso en el cupón es **hoy + 7 días corridos** (día de Argentina), con tope en el vencimiento real de la clave. El código de barras lleva **siempre** el vencimiento real, nunca el impreso (D12). Reemplaza el parámetro `mesesVtoImpreso` de la versión anterior de este spec |
| ~~Q4~~ | ¿El archivo de cobros de posbaja informa con qué clave se pagó? ¿En qué columna y con qué forma? | **Cerrada 2026-09-16 con el archivo real** (`MA_20260911…_C.txt`): sí, en la **columna 23 (índice 22)**, como `NRO_CONVENIO` de **8 dígitos**, y `0` en los pagos comunes. Además: la columna 7 (índice 6) vale `4` en los pagos con multiclave y `2` en los comunes, la 13 (índice 12) trae el código del medio y la 30 (índice 29, el id del cobro) viene **vacía** en los pagos con clave. Todo verificado en §10.1 y ya incorporado al diseño de la fase 4 |

Siguen abiertas:

| # | Pregunta | Qué cambia según la respuesta | Bloquea |
|---|---|---|---|
| Q2 | ¿Qué significa la 10ª columna sin nombre (`C` en todas las filas)? | Si es un estado (p.ej. "C = convenio" vs. "A = anulada"), una clave con otro valor podría no ser cobrable y habría que excluirla o marcarla | Nada: se guarda en `marca` y se avisa si viene distinta |
| Q5 | ¿Hace falta un código de gestión "Convenio con quita" distinto de GES-050 "Convenio acordado"? | Se agrega al catálogo y se configura `gestionAlGenerar` por tipo (hoy uno solo para las dos claves) | Nada: GES-050 por default. Ojo: esto es **gestión**, no situación — no se confunde con SIT-054 (D14), que sí se implementa |
| Q6 | ¿Telecom acepta pagar el importe de la clave en más de un pago, o solo con el cupón entero? | Cambia el default de `CONSOLIDACION_CLAVE_MODO` entre `SUMA` y `PAGO_UNICO` (§10.5c) | Nada: `SUMA` por default. En la muestra **no hay ningún caso**: los 23 pagos con clave son de trámites distintos y los 3 trámites con varios pagos son todos comunes |
| Q7 (fase 1.1) | El logo de Personal (D11) — sigue sin llegar | Hasta que llegue, el cupón sale con el texto "Personal" en vez de la imagen (comportamiento ya previsto, D11) | Nada: hay fallback |
| **Q8** (fase 4) | ¿Qué diferencia hay entre `H_MC_CO` "Multiclave Contado" (14 filas) y `H_Multi_CZ` "CONTADO_Z" (9 filas)? | Si uno de los dos **no** fuera una cancelación real (p. ej. una reserva o un pago a confirmar), habría que excluirlo de la regla. En la muestra los dos aparecen sobre claves de QUITA y sobre varios productos, y los dos traen convenio e importe exacto de la clave — para cancelar son indistinguibles | Nada: los dos cancelan. Si la respuesta obliga a distinguirlos, es una condición más en la query (fase 4b) |
| **Q9** (fase 4) | ¿Qué significan la columna 25 (índice 24: `0` en los 23 pagos con clave, `1` en los 81 comunes) y la 7 (índice 6: `4` vs `2`)? | Son dos señales redundantes de "este pago es con multiclave". El diseño **no depende de ninguna de las dos** (usa la presencia del convenio), así que si Telecom las cambia no se rompe nada | Nada |
| **Q10** (fase 4) | Los 20 pagos de multiclave de julio en producción: la suma por descripción del medio da ≈ 0 en los dos grupos, pero todos los que se pudieron listar están en **negativo**. ¿Hay pagos positivos de la misma magnitud en otros casos (dos cargas del mismo archivo con la plantilla distinta)? | Hay que terminar de listar los 20 antes de correr el script de corrección de signo: si algún caso tiene un par (+X, −X), invertir el negativo lo dejaría con el doble | **El script de §10.8**, no la fase 4a |

---

## 20. Changelog del spec

### 2026-09-16 (fase 4a implementada y auditada — 14 hallazgos, 1 bloqueante)

Implementación de la fase 4a diseñada el mismo día (entrada de abajo), auditada y corregida en la
misma unidad de trabajo (ver `CHANGELOG.md`, entrada 2026-09-16 de la fase 4a, sección "Hallazgos de
la auditoría" para el detalle archivo:línea + test de cada uno).

- **Bloqueante, corregido: recargar un archivo de pagos duplicaba la cobranza en trámites con más de
  un caso.** El desempate ("caso no cancelado de la remesa más reciente") dependía de
  `estadoSituacion.categoria`, que la propia importación cambia al consolidar — la primera carga
  cancelaba el caso A, la recarga elegía el caso B (ahora "el no cancelado") y le creaba un segundo
  pago. Arreglado en dos capas: el desempate (`elegirPorRemesaMasRecienteYId`) quedó estable —
  `remesa.createdAt` e `id`, nunca la situación — y el anti-duplicados busca en **todos** los casos
  candidatos del trámite, no solo en el elegido. Medido contra MySQL local con los tres escenarios del
  auditor (con clave, sin clave, `PAYMENT_ID` real) y una recarga completa del archivo real
  (`MA_20260911…_C.txt`, 104 filas, 4 trámites con dos casos): **0 pagos nuevos** en la recarga, los
  104 pagos de la primera carga intactos.
- **Regla (b) de la consolidación (§10.10) DESCARTADA — no llegó a producción.** Cancelaba con quita
  por un convenio `CLAVE_PAGO` ACTIVO cuyo Σpagos alcanzara el monto, sin mirar si esos pagos tenían
  algo que ver con la clave. Medido: un cobro común de $16.000 sobre una deuda de $31.000 con un cupón
  de quita emitido condonaba $15.000 sin respaldo del archivo. Sacada del código y del spec (§10.10
  reescrita, R9 tachada); la única regla que cancela con quita es la del archivo
  (`pago.referenciaClave`).
- **La ampliación a la categoría CANCELADO completa no es solo "sumar SIT-054".** Cambia también el
  comportamiento para `SIT-051`/`SIT-052`/`SIT-053` en los cinco lugares que antes comparaban contra
  la clave `SIT-050` pelada: acciones masivas que saltean canceladas, desasignación y re-asignación de
  casos ausentes de una actualización diaria, y el combo de "vincular a remesa" del historial. Antes
  de esta fase esos tres códigos NO se salteaban/excluían; desde esta fase sí, igual que `SIT-050` y
  `SIT-054`. Es el comportamiento correcto (un caso "Cancelado antes de la gestión" o "a liquidar" es
  tan cancelado como uno "Pagado"), pero no estaba dicho ni probado — se agregaron tests con
  `it.each` sobre los tres códigos en los processors tocados (`AccionesProcessor`,
  `ActualizacionesProcessor`, `CasosCedenteProcessor`/`MultiarchivoProcessor`) y en `listRemesas`.
- Otros seis hallazgos menores de UI/consistencia corregidos: el claim de un pago MANUAL ahora guarda
  `referenciaClave` (si no, quedaba en SIT-041 con saldo en vez de SIT-054); el mensaje de auditoría de
  la consolidación usa `saldoTramite` (no `importeClave`) para la quita, igual que la ficha; la ficha
  del deudor bloquea por categoría CANCELADO, no por la clave `SIT-050` (daba 403 en un caso SIT-054);
  la vista previa de PAGOS deja de mostrar "23 de 23 filas" contradictorio (unificado el criterio de
  conteo); `claves.service.ts` lee la misma tolerancia/modo por variable de entorno que la
  consolidación (antes tenía `-100` y `SUMA` hardcodeados); y el `IN` de `multiclaves.processor.ts` se
  trocea de a 1.000 como el resto del módulo.

### 2026-09-16 (fase 4 rediseñada — cancelación con quita por el archivo de cobros)

Llegó la muestra de pagos que faltaba (Q4) y la fase 4 se rediseñó entera. Nada de esto está
implementado todavía: es diseño.

- **§10 reescrita.** Lo que era "regla (b): un convenio de clave cumplido cancela a SIT-050" pasa a
  ser un respaldo (§10.10), y la regla principal es la del **archivo**: un pago cuyo `nroConvenio`
  corresponde a una clave de la misma empresa, por el importe de esa clave, cancela el caso. **No
  exige que el cupón lo haya emitido nuestra plataforma** (D13): los 23 pagos con clave de la muestra
  salen de cupones del sistema viejo, y con la regla anterior no se habría cancelado ni uno.
- **Código nuevo `SIT-054` "Cancelado con quita"** (D14), categoría CANCELADO — que es la que dispara
  el bloqueo de la cuenta, así que bloquea desde el primer día sin tocar `deudor-bloqueo.ts`. Se crea
  con el seed y con un script idempotente, y **si falta, la consolidación no se cae**: cancela a
  SIT-050 contando `sit054Degradado` y se corrige sola en la corrida siguiente (§10.7).
- **Lo que el archivo real contradijo del enunciado de partida**, verificado columna por columna
  (§10.1):
  - La columna 23 **no** es "el importe positivo": lo es solo en los 23 pagos con clave; en los 81
    comunes trae el mismo negativo que la 15. Mapear el importe ahí arreglaría 23 filas y rompería 81.
  - Son **6** los convenios que matchean las claves de muestra, **no 7** (los 6 coinciden trámite,
    importe al centavo y vencimiento; y los 6 trámites están además en el CA del 28/08).
  - El archivo tiene **33 campos** por fila, no 32: termina en `|`.
- **Verificado contra producción el 2026-09-16** (solo lectura, vía SSM):
  - Las plantillas **48 y 49** mapean `monto` a la columna 15 con
    `["trim","toNumber:es-AR","removeDashes"]`, `fechaPago`@11, `nro_cliente`@5 y `observacion`@13 —
    y **`observacion` es la descripción del medio** (`Multiclave Contado`), no un número de
    comprobante: el `factura.updateMany` de `pagos.processor.ts:229-235` no matchea nada con estos
    archivos.
  - **`clave_pago` tiene 0 filas y hay 0 convenios `CLAVE_PAGO`**: las fases 1–3 están desplegadas
    pero nunca se usaron. La fase 4 no sirve de nada hasta cargar los `MULTI_*` (orden operativo en
    §15).
  - **20 pagos con multiclave ya cargados** (julio 2026, empresa 9), **los 20 en SIT-041** y guardados
    en **negativo**: el caso queda con un 50% **más** de deuda que la original (deudor 18097:
    `montoTotal` 13.261,59, pago −6.630,79, `saldo` 19.892,38). Entraron antes del arreglo de
    `removeDashes` del 2026-08-28. Ver §10.8 y Q10.
  - **5.448 `nroCliente` repetidos en la empresa 9**: el `LIMIT 1` sin `ORDER BY` de
    `pagos.processor.ts:85-94` (riesgo R5 desde la versión inicial de este spec) no es un borde, es la
    mitad de la cartera. La fase 4 lo arregla en dos capas (§10.3c).
  - `SIT-054` está libre: la categoría CANCELADO llega hasta SIT-053.
  - Ningún `pago.idExterno` de producción es de 8 dígitos (los `PAYMENT_ID` de Telecom son de 11), así
    que hoy no habría colisión con el convenio pelado — el prefijo `MC-` de D16 la hace imposible por
    construcción, no por suerte.
- **Dos hallazgos de diseño que no estaban en el enunciado y que habrían costado plata:**
  - Si el `idExterno` derivado fuera solo `MC-<convenio>`, un segundo pago de la misma clave (Q6)
    chocaría contra `@@unique([deudorId, idExterno])` y **se perdería en silencio**. Por eso la llave
    lleva día e importe (D16).
  - `pagos.processor.ts:178` **apaga** la heurística de día + importe cuando hay `idExterno`. Con una
    llave derivada eso significa que un archivo cargado antes de mapear `nroConvenio` y recargado
    después **duplica** la cobranza. La condición pasa a `idExterno && !idExternoDerivado` (§10.3b),
    con test de regresión para las carteras que sí tienen `PAYMENT_ID` real.
- **Cinco lugares del sistema comparan contra la clave `SIT-050` y no contra la categoría** — un
  código de cancelación nuevo que la mitad del sistema no reconoce es la versión "situación" del
  permiso que falta en el catálogo. Listados con archivo:línea en §10.7, con un helper compartido para
  no repetir la query cinco veces. Lo que ya andaba por categoría (bloqueo de la cuenta, tableros) no
  se toca.
- **Backfill: no se recorre el histórico** (D18), con las cuatro razones en §10.8 — el número de
  convenio no se guardó nunca, `clave_pago` está vacía, inferir por importe sería adivinar y recargar
  el archivo no actualiza nada. Lo que sí se hace es el script de corrección de **signo** de los 20
  pagos de julio, aparte de esta fase y con `--dry-run` obligatorio.
- **La fase 5 desaparece**: se absorbe en la 4a. La 4b queda con lo que depende de Q5, Q6, Q8 y de
  tener los `MULTI_*` de julio.
- Preguntas nuevas: **Q8** (`H_MC_CO` vs `H_Multi_CZ` — en la muestra son indistinguibles para
  cancelar), **Q9** (las dos columnas redundantes de "es multiclave", que el diseño no usa) y **Q10**
  (terminar de listar los 20 pagos de julio antes de invertirles el signo).

### 2026-09-15 (fase 3 implementada — envío del cupón por mail)

- **Corrección bloqueante del diseño original: la plantilla de Sender NO es obligatoria.** §8.4 y
  §9.2 (código `EMPRESA_SIN_PLANTILLA_CUPON`) decían que sin `cfg.templateCuponId` configurado no se
  podía enviar el cupón, "porque Sender no manda un mail sin plantilla". Es falso: el internal-api de
  AMSA Sender (`internal-email.controller.ts` `POST manual/send`, repo hermano, solo lectura) ya
  acepta `templateId` **o** `html` (con `subject` obligatorio en ese segundo caso), y
  `manual-email.service.ts` le aplica el mismo layout de header/footer y tracking a los dos casos —
  la única diferencia es que con `html` no hay reemplazo de `{{variables}}` porque no hace falta, el
  HTML ya viene completo. Decisión: **plantilla opcional**. Con plantilla, se arman las variables
  (automáticas + seis propias del cupón, ver abajo) y se valida que ninguna quede vacía antes de
  mandar; sin plantilla, se manda un mensaje por defecto armado en Gestión
  (`multiclaves/utils/cupon-mail.ts#mensajeCuponDefault`). El código `EMPRESA_SIN_PLANTILLA_CUPON`
  queda reemplazado por `EMPRESA_SIN_SMTP` (la única condición real: la empresa necesita una cuenta de
  mail asignada, no una plantilla).
- **Dato de producción verificado 2026-09-15 (antes de cerrar la fase, a pedido explícito):**
  `email_template_variable_mapeo` tiene 0 filas y **ninguna** empresa TELECOM_PERSONAL (ids 1, 9, 10 y
  11) tiene `cuentaSmtpId` asignado. Con el diseño original (plantilla obligatoria + `cuentaSmtpId`
  obligatorio) el envío no se podría usar en prod bajo ninguna circunstancia hasta configurar las dos
  cosas; con la plantilla opcional, alcanza con asignar `cuentaSmtpId` (paso de despliegue, §15) — la
  plantilla se puede sumar después sin bloquear nada.
- **`email-sender` extendido para mandar sin plantilla**, reusando todo lo demás (historial en
  `envio_email`, desuscripciones, tracking, adjuntos):
  - `sender-http.client.ts#enviarManual`: `templateId` pasa a opcional, nuevo parámetro `html?`
    (mutuamente excluyente con `templateId` — si no viene ninguno de los dos, lanza sin llamar a
    Sender). `variables` pasa a opcional.
  - `email-sender.service.ts#enviar`: mismos parámetros opcionales; valida que venga `templateId` o
    `html`, y que el `asunto` sea obligatorio cuando no hay plantilla (con plantilla, el asunto sigue
    siendo opcional — gana el de la plantilla). Nunca loguea `html` (política de logging).
  - Cambio de schema **imprescindible y aditivo**: `envio_email.templateId` pasa de `Int` a `Int?` —
    un envío sin plantilla no tiene ese dato. `db push` local corrido y verificado; los envíos
    existentes conservan su valor, no hace falta backfill.
- **`multiclaves/utils/cupon-mail.ts`** (nuevo, + 12 tests): `escapeHtml` (los cinco caracteres
  especiales de HTML — nunca se interpola el nombre del cliente sin pasar por acá),
  `formatearListaOr` (medios de pago: "PAGO FACIL, RAPIPAGO … o COBRO EXPRESS"),
  `variablesPropiasCupon` (las seis del cupón — ver tabla actualizada en §8.4; **sin** la clave de
  pago ni el código de barras, a propósito, ver la nota de D6 ahí mismo) y `mensajeCuponDefault`
  (asunto `Cupón de pago - Personal` + HTML fijo con el nombre, importe, vencimiento y medios de
  pago).
- **`cupon.service.ts`**: `generar()` reescrito — ya no corta `ENVIAR`/`DESCARGAR_Y_ENVIAR` con 400
  `ACCION_NO_DISPONIBLE`. Nuevo método privado `prepararEnvio` (permiso `email.enviar`, destinatarios
  con `esPosibleEmail`, `EMPRESA_SIN_SMTP`, variables de la plantilla si se eligió una) que se corre
  **antes** de generar el PDF y de la transacción — igual que el resto de las validaciones de negocio,
  para no dejar nada a medio camino. El PDF generado antes de la transacción se **reusa** como adjunto
  del mail (no se regenera después: los datos no dependen de si el convenio se creó o se reusó).
  `ejecutarEnvio` llama a `EmailSenderService.enviar` con `try/catch` — `enviar()` ya devuelve
  `ok:false` en el camino esperado (SMTP rechaza), el `catch` es la red por si algo explota antes de
  eso; ninguno de los dos casos revierte el convenio.
  **Reordenamiento sobre el punto 9 del diseño original:** el `comentario.create` de la fase 2 vivía
  **dentro** de la transacción (9c/9e) porque todavía no existía el envío; en esta fase 3 se movió
  **fuera**, después del intento de mail (§8.1, pasos 11-12), para que el texto del comentario pueda
  decir si el mail salió bien o mal. Sin impacto de negocio: si el proceso muere entre el commit de la
  transacción y el comentario, el cupón sigue siendo válido y generar de nuevo lo reusa (mismo
  invariante que ya describía el spec original para esta ventana). `consolidacion.consolidar` se
  llama inmediatamente después de la transacción (antes de intentar el mail, no después del
  comentario como decía el punto 13 original) — no depende del resultado del envío, así el caso queda
  consolidado aunque Sender esté caído.
- **`preview()`**: nuevo parámetro opcional `templateId` — con él, llama a
  `EmailSenderService.previewVariables` y arma `plantilla`/`variablesSinValor` igual que el envío real
  (misma función que arma las variables propias, para no calcular el importe/vencimiento dos veces con
  criterios distintos); si la plantilla ya no existe o Sender está caído, `warn` y sigue con
  `plantilla: null` — no rompe la vista previa. Nuevo método `destinatariosDelCaso` (contactos
  `tipo: 'email'` del caso, igual criterio que `EmailSenderService.previewVariables`) para
  `destinatariosDisponibles`, disponible aunque no se haya elegido plantilla todavía.
- **Config de empresa** (`ConfigEmpresaMulticlavesService`, nuevo, + 6 tests): `GET`/`PATCH
  /multiclaves/empresas/:id/config` tal como describía §9.4 — merge transaccional de la clave
  `multiclaves` dentro de `empresa.configuracion`, sin tocar el resto (mora, promesas). Controller:
  agregados a `MulticlavesController` con `empresas.ver`/`empresas.editar` (permisos ya existentes en
  el catálogo, sin altas nuevas).
- **Permisos:** ninguno nuevo — `email.enviar` y `convenios.generar_cupon` ya estaban en el catálogo
  (fase 2 y módulo de email existente). El backend exige los dos para `ENVIAR`/`DESCARGAR_Y_ENVIAR`
  (`email.enviar` se valida a mano en el servicio, no con `@Permisos(...)` en el controller — ese
  decorador es OR entre los permisos listados, no AND, así que la combinación "las dos cosas" no se
  puede expresar ahí; queda documentado en el controller).
- **Frontend:** `GenerarCuponDialog.tsx` reescrito con la sección "Enviar por mail" (ver desvío de UX
  en §11.2); `multiclaves.ts` (api) con `templateId`/`destinatarios` en `generarCupon`,
  `obtenerConfig`/`actualizarConfig`; `FichaDeudor.tsx` pasa `empresaId` y `puedeEnviarEmail` nuevos al
  diálogo. `AjustesEmpresas.tsx`: sección "Claves de pago" dentro de "Editar empresa" (§11.4, con la
  corrección del endpoint de plantillas).
- **Verificado contra la base local** (sin datos de prueba quedando en la base): `CuponService.generar`
  con `accion: 'ENVIAR'` sobre un `EmailSenderService` con el `SenderHttpClient` **mockeado** (no hay
  Sender local levantado, y la instrucción fue explícita: no mandar mails reales) — camino feliz con
  plantilla, camino feliz sin plantilla, variables vacías (400 antes de tocar la base), sin SMTP (400
  antes de tocar la base), mail que devuelve `ok:false`, mail que tira una excepción, reenvío
  (REUSO) con `ENVIAR`, permiso faltante (403). El convenio, la gestión y el comentario del flujo
  `DESCARGAR` (fase 2) no cambiaron de comportamiento — cubierto por los 18 tests de esa fase que
  siguen en verde.
- **Desvíos que quedan documentados, no implementados:** el nombre comercial del asunto por defecto
  ("Personal") es fijo en código, no configurable por empresa todavía — si otra cartera de Telecom
  necesita un nombre distinto, hace falta agregarlo a `configuracion.multiclaves`. El aviso
  `avisos.plantillaCuponConfigurada` de `GET .../claves` (§9.1) sigue siendo un stub que devuelve
  `false` siempre (ya lo era en la fase 2) y el frontend nunca lo mostró — con la plantilla opcional
  pierde buena parte de su sentido original; no se tocó en esta unidad de trabajo.

Un auditor revisó esta primera versión antes de darla por cerrada y la devolvió **NO PASA**, con dos
hallazgos bloqueantes. Todo lo de arriba (Backend/Frontend/Verificación) ya incluye las correcciones;
el detalle de qué estaba mal y cómo se corrigió queda acá:

- **`comentario.texto` es `varchar(191)` (confirmado contra la base local, `SHOW COLUMNS`) —
  bloqueante, corregido.** El comentario se arma DESPUÉS de la transacción (para poder incluir el
  resultado del mail), y con "El envío por mail FALLÓ: <motivo real de Gmail>" más una anulación, el
  texto se pasaba de largo — `comentario.create` tiraba `P2000` con el convenio, la cuota y (si
  correspondía) la anulación **ya escritos**, y el front recibía un 500 sin enterarse de que el cupón
  sí se había generado. `CuponService.textoComentario` ahora arma el texto en capas: la acción, el
  tipo y número de la clave, la anulación y el resultado del mail nunca se cortan (con una versión
  compacta sin importe/vencimiento como segunda opción si hiciera falta el espacio); solo el motivo
  técnico del fallo cede, truncado con "…", y como último recurso hay un slice duro a 191 que no
  debería activarse nunca (los números involucrados son de largo fijo). Además, **todo** lo que corre
  después de la transacción (`consolidacion.consolidar`, la creación del comentario) quedó envuelto en
  su propio `try/catch`: una excepción ahí nunca vuelve a ser un 500 con escrituras hechas — se
  loguea `error` con stack y se responde con éxito parcial (`comentarioId: null` si hizo falta).
- **Un envío totalmente omitido (todos los destinatarios dados de baja) quedaba registrado como
  "Enviado" — bloqueante, corregido.** Sender responde `ok:true, enviados:0, omitidos:[…]` en ese
  caso (`manual-email.service.ts`, solo lectura) — ni error ni éxito real, y ni `CuponService` ni
  `EmailSenderService.enviar` miraban `enviados`/`omitidos`: el `envio_email` quedaba `'ENVIADO'`, el
  comentario decía "Enviado a 1 destinatario" y el diálogo lo festejaba igual. Corregido en capas: (1)
  `EmailSenderService.enviar` calcula el `estado` mirando `enviados` y `omitidos` — nuevo valor
  `'OMITIDO'` cuando nadie recibió nada (columna libre, sin enum en la DB, sin `db push`); (2)
  `CuponService` clasifica el resultado en `enviado` / `parcial` / `omitido` / `fallo`
  (`clasificarEnvio`) y lo usa tanto para el comentario ("No se envió: destinatario(s) dado(s) de
  baja." / "Enviado a N, M dado(s) de baja.") como para la respuesta (`envio.enviados`,
  `envio.omitidos`); (3) `GenerarCuponDialog.tsx` usa esos campos en vez de `destinatarios.length` y
  distingue los cuatro casos en pantalla. `guardarEmailComoContacto` ahora solo guarda si
  `enviados > 0` — guardar un contacto al que no le llegó nada no aporta nada.

También corregidos, sin ser bloqueantes:

- **El diálogo se cerraba igual cuando el mail fallaba o se omitía**, con un aviso de 4 segundos como
  única pista. `GenerarCuponDialog.tsx` ahora se queda abierto en esos tres casos (`parcial`,
  `omitido`, `fallo`) con un `Alert` persistente, `Descargar` disponible al toque y el botón "Enviar"
  cambia a "Reintentar envío" (reusa el mismo convenio, no genera uno nuevo). Con envío 100% exitoso o
  sin envío (`DESCARGAR`), se sigue cerrando solo.
- **Cambiar de plantilla a "Sin plantilla" no destrababa "Enviar"**, y cambiar de clave (TOTAL/QUITA)
  con una plantilla ya elegida perdía el aviso de variables faltantes — las dos cosas por el mismo
  motivo: `variablesSinValor` colgaba de `preview`, que se pisaba entero al cambiar de clave sin
  volver a pedir las variables de la plantilla vigente, y el efecto que las recalculaba cortaba
  temprano (`if (!templateId) return`) sin limpiar el estado viejo. Ahora `plantillaInfo` vive aparte
  de `preview` y se recalcula con `[templateId, claveId]` como dependencias — sin plantilla, se limpia
  al toque.
- **`templateCuponId` no se validaba contra Sender.** El `PATCH /multiclaves/empresas/:id/config`
  guardaba cualquier id sin comprobar que existiera o que fuera de la cuenta SMTP de la empresa —
  `ConfigEmpresaMulticlavesService.actualizar` ahora llama a `EmailSenderService.templatesDeEmpresa`
  antes de escribir y corta con 400 `PLANTILLA_INVALIDA` si no aparece en la lista (sin escribir
  nada); si Sender no responde, el error se propaga tal cual, tampoco se guarda. En el otro extremo,
  `CuponService.prepararEnvio` ahora envuelve su propio `previewVariables` en `try/catch`: si la
  plantilla elegida desaparece de Sender entre el preview y la confirmación, es un 400
  `PLANTILLA_INVALIDA`, nunca un 500. Y `preview()` distingue "sin variables sin valor" (`[]`) de "no
  se pudo ni comprobar" (`plantillaError`, nuevo campo) — antes eran indistinguibles y el frontend
  habilitaba "Enviar" con una plantilla que nunca llegó a validarse. El `<Select>` del diálogo también
  descarta cualquier `templateId` preseleccionado que no aparezca en `templates`, para no mostrarle a
  MUI un value fuera de rango.
- **`{{saldo}}`/`{{importe}}`/`{{monto}}`/`{{total}}` en una plantilla resuelven a la deuda del CASO,
  no al importe del cupón** — un cupón de quita con una plantilla así le manda al deudor el total de
  la deuda. Nuevo aviso, no bloqueante: `preview()` (con `templateId`) marca `avisosPlantilla` cuando
  alguna variable de la plantilla matchea esos canónicos del catálogo general
  (`variables-mapper.ts#CATALOG`, función `normalizar` exportada para esto) y el diálogo lo muestra.
- **El asunto guardado en `envio_email` quedaba con `{{nombre_cliente}}` literal** cuando se mandaba
  con plantilla — Sender sí lo resuelve al mandar (`renderTemplate` en `manual-email.service.ts`),
  pero el historial de Gestión mostraba el texto crudo. `prepararEnvio` ahora resuelve el asunto acá
  mismo con `renderVariables` (mismo patrón `{{\w+}}` que usa Sender) antes de mandarlo — Sender lo
  vuelve a "renderizar" pero como ya no quedan variables sin resolver, es un no-op.
  **Deuda pendiente, sin resolver:** `nombre_cliente` (y el resto de las variables propias) se pasan
  **sin escapar** a la plantilla — mismo criterio que el resto de las variables del mapeo general
  (`autoMapearVariables`), que tampoco escapan nada; no se introdujo un criterio distinto solo para
  esto. Si algún día se decide escapar las variables de plantilla en general, esto tiene que ir con
  esa decisión, no suelto acá.
- **`guardarEmailComoContacto` insertaba directo por Prisma**, sin la validación de siempre
  (minúsculas, trim, chequeo de MX) — ahora reusa `ContactosService.create` (`ContactosModule` exporta
  el servicio, importado en `MulticlavesModule`).
- **`AjustesEmpresas.tsx` pedía la lista de plantillas de Sender sin `email.enviar`**, y mandaba el
  `PATCH` de "Claves de pago" cada vez que se guardaba CUALQUIER campo de la empresa — aunque nadie
  hubiera tocado esa sección (una empresa que nunca usó multiclaves, como AYSA, terminaba con un
  bloque `multiclaves` de defaults en su `configuracion` solo por renombrarla). Corregido: la lista de
  plantillas solo se pide con el permiso, y el `PATCH` solo se manda si `cuponForm` difiere de
  `cuponFormOriginal` (el snapshot cargado al abrir). Si ese `PATCH` falla, ya no dice "Empresa
  actualizada correctamente" — avisa qué se guardó y qué no.
- **El diálogo no distinguía "la empresa no tiene cuenta de mail" de "Sender no respondió"** al
  comprobar la cuenta SMTP — las dos caían en el mismo `catch` y mostraban el mismo aviso, engañoso en
  el segundo caso. Ahora un error real de red/Sender muestra su propio aviso con botón Reintentar, sin
  afirmar que la empresa "no tiene cuenta configurada" cuando en realidad no se pudo comprobar nada.
  También se corrigió que cambiar de clave (TOTAL/QUITA) pisaba los destinatarios ya tipeados a
  mano — la lista sugerida de contactos solo se aplica la primera vez que carga el preview.
- Controller: agregado el comentario que explica por qué `email.enviar` se valida a mano en el
  servicio y no con un segundo `@Permisos(...)` (ese decorador es OR entre los permisos, nunca AND).
- Wiki: `05-cupones-de-pago.md` corregida ("tu nombre" → "el nombre del cliente"; la sección "Enviar
  por mail" si aparece sin cuenta SMTP, con un aviso, en vez de no aparecer; agregado el
  comportamiento de diálogo-que-no-se-cierra y de omitido/parcial); variables del cupón documentadas
  también en `08-telefonia-y-email/03-enviar-un-email.md` y en
  `05-ajustes/01-empresas.md` (nueva sección "Claves de pago"); `03-importacion/10-claves-de-pago.md`
  ya no dice "cuando se habilite el cupón (fase 2)" — el cupón y el envío por mail ya existen.
  `docs/email-sender-spec.md` actualizada (schema `templateId` nullable, estado `OMITIDO`, envío sin
  plantilla desde Gestión).
- **Verificado contra la base local**, sin datos de prueba quedando en la base: `SHOW COLUMNS FROM
  comentario LIKE 'texto'` confirmó `varchar(191)` antes de escribir el fix. Todo lo demás, con
  `SenderHttpClient`/`EmailSenderService` mockeados (no hay Sender local levantado, y la instrucción
  fue explícita: no mandar mails reales) — incluidos el motivo real de Gmail
  ("Invalid login: 535-5.7.8 Username and Password not accepted…") con anulación en el mismo
  comentario, y la simulación de un `P2000` real en `comentario.create` para probar que ya no
  produce un 500.

### 2026-09-14 (fase 2 implementada, con una ronda de auditoría — cupón PDF, convenio de clave, ficha)

Primera versión: `importe-en-letras.ts`, `cupon-pdf.service.ts` (3 talones, D6 vista previa con marca
de agua y sin código de barras, D12 vencimiento impreso), assets del logo (placeholder gris con
"PERSONAL", `nest-cli.json` actualizado), `cupon.service.ts` (acción DESCARGAR;
ENVIAR/DESCARGAR_Y_ENVIAR cortan con 400 `ACCION_NO_DISPONIBLE` hasta la fase 3), el convenio de
clave (crear/reusar/anular con `SELECT … FOR UPDATE` para la concurrencia), cambio de gestión a
`GES-050` por default, comentario, endpoints de claves del caso/preview/generar/reimprimir, permiso
`convenios.generar_cupon` en las dos copias del catálogo, `ClavesPagoCard` y `GenerarCuponDialog`
(sin el paso de destinatarios: no hay envío por mail todavía), chips de convenio de clave y
"Reimprimir cupón" en `FichaConveniosTab`. Un auditor la revisó antes de darla por cerrada y encontró
lo siguiente — todo corregido en la misma unidad de trabajo:

- **Simbología del código de barras — bloqueante, corregido.** La primera versión usó Interleaved 2
  of 5 (`bwip-js`, `barratio: 3, spaceratio: 3`), una suposición del spike original **sin evidencia**.
  El auditor decodificó el cupón viejo (`46992372.pdf`) desde los contornos de su propia fuente de
  código de barras (`TT17E6t00`, embebida en el PDF) y es **Code 128 set C**: `Start C` (valor 105),
  25 símbolos de datos, checksum mod 103 verificado, `Stop` (valor 106) — la simbología que ya leen
  Pago Fácil/Rapipago. Reescrito: `bwip-js` se usa solo para calcular el patrón de anchos
  (`raw()`, símbolo `code128`), y `utils/codigo-barras-pdf.ts` (nuevo) arma su propio SVG con
  rectángulos en puntos exactos — nunca el `toSVG()` de bwip-js, que ajusta a un `width`/`height`
  dados conservando SU PROPIA relación de aspecto (por eso el `height: 34` de la primera versión no
  hacía nada: el alto real salía de la proporción del SVG, no del número pedido). Ver §7.3.
- **Medidas físicas — bloqueante, corregido.** La primera versión medía (leyendo el PDF real, no
  calculando) módulo 0,166 mm, alto 5,74 mm y zona muda de 1,41 mm — los tres por debajo de lo
  pedido, porque el `height` no se aplicaba (ver punto anterior) y el módulo lo decidía el ancho de
  columna, no un valor fijo. Con `utils/codigo-barras-pdf.ts` (módulo, alto y zona muda calculados
  en puntos exactos, sin depender de cómo pdfmake escale el SVG): módulo **0,25 mm** (después ajustado a 0,254 mm), alto
  **14 mm**, zona muda **≥ 2,5 mm** a cada lado — medido con un test que lee el PDF generado (ver
  punto siguiente), no con el eco de los parámetros que se le pasaron a `bwip-js`.
- **Verificación circular — bloqueante, corregido.** La "coincidencia con el cupón viejo" de la
  primera verificación se hizo con `bwip-js raw()` sobre los mismos dígitos que se le habían pasado a
  `bwip-js` para dibujar: probaba que la librería es consistente consigo misma, no que el PDF
  generado dibuja lo correcto. `cupon-pdf.service.spec.ts` ahora incluye un decodificador de Code 128
  **independiente de bwip-js**: parsea el content stream del PDF (operadores `m`/`l`/`re` + `f`,
  siguiendo la matriz de transformación), agrupa las barras por fila (los separadores verticales
  entre talones son igual de angostos y altos que las barras, y sin agrupar por fila se mezclaban con
  ellas — otro hallazgo, ver más abajo) y decodifica con la tabla estándar de 107 símbolos de Code
  128. Corrido contra el PDF completo (3 talones) generado por el servicio real, para la fila QUITA
  del spec, la fila TOTAL, y el código del cupón viejo de referencia — los tres decodifican dígito
  por dígito contra `SEC_COD_BARRA`, con `Start`/`Stop`/checksum válidos.
- **La revalidación no comparaba el vencimiento — bloqueante, corregido.** `descomponerCodigoBarras`
  ya devolvía `vto`, pero `revalidarCodigoBarras` solo comparaba importe y convenio. El auditor probó
  cambiar el vencimiento embebido en el código, recalcular el DV (quedando "válido" en sí mismo), y
  el PDF salía igual. Agregada la comparación contra `clave.fechaVencimiento` — `DatosCupon` suma el
  campo `fechaVencimiento` (además del ya agregado `nroConvenio`) para poder hacerla.
- **Fuga de datos — bloqueante, corregido.** `GET /multiclaves/deudores/:id/claves` (con
  `convenios.ver`, no `convenios.generar_cupon`) y la vista previa del cupón devolvían la clave de 22
  dígitos y el código de barras de 50 completos — con esos dígitos se arma un cupón cobrable por
  fuera del sistema, sin pasar por el convenio, anulando la intención de D6. Las dos respuestas ahora
  mandan solo `clavePagoUltimos4` (los últimos 4 dígitos, para identificar la clave en la UI) — nunca
  la clave ni el código de barras completos. Corregido §9.1 y §9.2 acá arriba.
- **La ficha solo consideraba cancelado el SIT-050** para deshabilitar "Generar cupón" y "Reimprimir
  cupón" — el resto de la categoría CANCELADO (SIT-051 a SIT-053) los dejaba pasar en la UI (el
  backend igual los bloqueaba con 403; era un problema de UX, no de seguridad). `ClavesPagoCard` ahora
  usa `avisos.cuentaCancelada` del backend (que ya cubre la categoría completa, `DeudorBloqueoService`
  mediante) y se lo reporta al padre para que `FichaConveniosTab` lo use también en "Reimprimir
  cupón".
- **La observación del convenio anulado mezclaba tipo y número** de dos claves distintas
  (`Anulado al generar cupón de la clave ${TIPO de la vieja} ${NÚMERO de la nueva}`). Corregido para
  que nombre cada clave con su tipo y número: `Anulado: se generó el cupón de la clave QUITA 96332206
  (este convenio era de la clave TOTAL 96311343)`.
- **La vista previa no avisaba que la clave ya tenía convenio en otro caso** (§11.2.5): si la MISMA
  clave que se está por generar ya tiene un convenio activo en otro deudor, `preview()` no lo
  reflejaba en `puedeGenerar`/`avisos` — el operador se enteraba recién al confirmar, con el 409. Se
  agregó el aviso y `puedeGenerar: false`; el frontend ahora ofrece "Abrir ese caso" (con las
  limitaciones de navegación de la pantalla de Gestión, que no tiene URL por caso — ver
  `GenerarCuponDialog.tsx`).
- **`otrosCasosDelTramite` comparaba `nroCliente` exacto**, mientras la resolución del propio trámite
  hace `TRIM()`: un caso hermano con espacios alrededor del `nroCliente` no aparecía en el aviso
  aunque fuera el mismo trámite. La consulta de "otros casos" ahora también usa `TRIM()` en SQL
  (`$queryRaw`, dos pasos: ids por trim + `findMany` para los datos a mostrar).
- Frontend: badge de la solapa Convenios con la cantidad de claves vigentes; `ClavesPagoCard` no pide
  las claves si falta `convenios.ver`; `GenerarCuponDialog` muestra el error (con botón Reintentar) si
  falla la vista previa o su PDF, en vez de quedarse con el esqueleto de carga para siempre.
- Wiki (`05-cupones-de-pago.md`): corregidas tres afirmaciones que no coincidían con el código —
  "el botón está pero rechaza al guardar" (en realidad sale deshabilitado con tooltip), el nombre de
  la casilla de confirmación ("Anular el convenio de la otra clave y generar este cupón", no "el
  convenio anterior"), y que el logo es un PNG de relleno, no el real.
- Desvío del contrato de `GenerarCuponDto` (§9.2), sigue vigente: el DTO acepta las tres acciones para
  no romper el contrato cuando llegue la fase 3, pero `CuponService.generar` rechaza `ENVIAR` y
  `DESCARGAR_Y_ENVIAR` con 400 `ACCION_NO_DISPONIBLE` — el envío por mail, el chequeo de variables
  vacías y `guardarEmailComoContacto` son la fase 3, fuera de esta unidad de trabajo.
- Agregado no previsto explícitamente en el spec: `DeudorBloqueoService.estaBloqueado(estadoSituacionId)`,
  variante de `assertNoBloqueado` que no lanza, para armar avisos de solo lectura (`cuentaCancelada`
  en `GET .../claves` y en la vista previa del cupón) sin duplicar la lista de códigos CANCELADO.
- `configuracion.multiclaves` (§9.5) se **lee** con sus defaults (`config-multiclaves.ts`) para
  `gestionAlGenerar`, `leyendaTalonCedente` y `mediosDePago` — el endpoint `PATCH` para escribirla y
  `templateCuponId` quedan para la fase 3, ya que dependen de la plantilla de Sender.
- **Verificado contra la base local** con el processor y los servicios reales (sin datos de prueba
  quedando en la base): carga de `MULTI_41645` (7.478 trámites, 14.956 claves, 0 rechazados), deudor
  de prueba con `nroCliente` = trámite `1841012140` en TELECOM_PERSONAL, `GET .../claves` devolvió
  QUITA $ 19.880,01 (convenio 96332206) y TOTAL $ 39.760,03 (convenio 96311343) — igual que el
  archivo. `CuponService.generar` creó el convenio, cambió la gestión a GES-050 y dejó el comentario;
  el PDF real (`obtenerPdfDeConvenio`) se leyó con el decodificador de Code 128 independiente de
  bwip-js (ver arriba) y coincidió dígito por dígito con el `SEC_COD_BARRA` de la clave.
- **Gate R1 (escaneo físico) sigue pendiente.** Todo lo de arriba es verificación **digital**
  (confirma que el PDF generado dibuja los 50 dígitos correctos en Code 128 set C, con las medidas
  físicas objetivo) — **no reemplaza** imprimir el cupón y leerlo con un lector físico y con una app,
  como pide el spec. **No asignar el permiso `convenios.generar_cupon` en producción hasta hacer esa
  prueba** — queda como paso manual de despliegue.

### 2026-09-14 (fase 1.1 implementada — trámite SOLO_TOTAL, y respuestas de Ana Maya)

- Caso real encontrado en `MULTI_41647_RA_1008_2026-08-31_10.31.09.csv:2180` (9.810 trámites válidos,
  19.619 claves): el trámite `2577727090` trae **una sola línea** (la TOTAL, importe = saldo
  272.350,90), sin su clave de quita. El parser de la fase 1 lo rechazaba entero por
  `TRAMITE_INCOMPLETO` porque exigía exactamente 2 líneas.
- Decisión de Ana Maya (2026-09-14): un trámite con **una sola línea válida** se acepta como **solo
  TOTAL**, con el aviso `SOLO_TOTAL` (no bloquea; se cuenta en la vista previa y en el resumen del
  lote como el resto de los avisos). Sigue rechazándose si esa única línea es inválida, si hay 3 o
  más líneas, si hay 2 líneas y alguna es inválida, o si hay 2 con el mismo importe
  (`IMPORTES_IGUALES`). No hay forma de fabricar una QUITA que Telecom no mandó.
- **Ajuste tras la auditoría de esta misma fase (2026-09-14):** para aceptar una línea única como
  SOLO_TOTAL, además hace falta que `IMPORTE_TOTAL_CLAVE == SALDO_TRAMITE`, exacto en centavos (el
  caso real `2577727090` cumple esto). Si no coincide, se rechaza con un motivo propio,
  `CLAVE_UNICA_NO_ES_TOTAL` ("trae una sola clave y su importe no es el saldo; puede ser una quita
  sin su total"). La decisión original no distinguía esto y aceptaba cualquier línea única —
  incluida una QUITA huérfana— como si fuera la TOTAL.
- **Hallazgo bloqueante del auditor**, en el mismo repaso: una línea con la cantidad de columnas mal
  (cortada o con una de más) quedaba con `nroTramite: null` (`validarLinea`, antes de leer siquiera
  la columna 0) y caía en su propio grupo `__linea_N`, en vez de agruparse con el resto de su
  trámite. Medido con el archivo real: cortando a 30 caracteres la línea TOTAL de `2598949142`
  (`MULTI_41645.csv:14957`), su QUITA de $ 5.074,99 (línea 14956) quedaba **sola**, sin su TOTAL
  contra la cual agruparse, y entraba como si fuera un trámite SOLO_TOTAL con saldo $ 10.149,99 —
  exactamente lo que el ajuste de arriba (`CLAVE_UNICA_NO_ES_TOTAL`) ya bloquea por sí solo en este
  caso puntual (el importe de la QUITA no es el saldo), pero el bug de fondo seguía: la línea rota NO
  se contaba como parte del trámite `2598949142`, así que recargar el archivo corregido después daba
  `TANDA_PARCIAL` en vez de volver a armar el par. Arreglado en `validarLinea`: la columna 0 se lee
  **antes** de cualquier otra validación (cantidad de columnas incluida) y, si es un trámite legible,
  la línea se asocia a él aunque el resto esté roto — el trámite entero queda con la cantidad real de
  líneas que trajo (2, una de ellas inválida) y se rechaza como corresponde (`TRAMITE_INCOMPLETO`),
  en vez de perder una línea en el camino. Solo una columna 0 verdaderamente ilegible (no numérica)
  sigue sin poder asociarse a nada — ahí no hay trámite al cual pegarla — y ese caso queda cubierto
  por el ajuste de `CLAVE_UNICA_NO_ES_TOTAL` de arriba cuando el sobreviviente del par es una quita.
- `multiclaves-parser.ts`: nuevo aviso `SOLO_TOTAL` y nuevo motivo de rechazo
  `CLAVE_UNICA_NO_ES_TOTAL`; la condición de rechazo del trámite pasa de "≠ 2 líneas válidas" a
  "3+ líneas, o 1-2 líneas con alguna inválida" — 1 línea válida ya no rechaza por sí sola (pero sí
  si esa línea no es el total).
- `multiclaves.processor.ts`: la idempotencia (R4) y la detección de `TANDA_PARCIAL` comparaban
  contra un `2` fijo (cantidad de convenios del par); ahora comparan contra `claves.length` del
  trámite entrante, para que un trámite SOLO_TOTAL sea tan idempotente como un par. El reemplazo de
  vigentes (paso "d") ya era agnóstico a la cantidad de filas (`vig.map(v => v.id)`), así que una
  reemisión que cambia de 2 a 1 clave (o de 1 a 2) ya reemplazaba **todas** las vigentes del trámite
  sin código nuevo — se agregaron tests que lo prueban explícitamente (mezcla de tandas de 1 y 2 en
  `multiclaves.processor.spec.ts` y en `multiclaves-borrado-reemision.spec.ts`).
- **`TANDA_PARCIAL` entre cargas DISTINTAS** (hallazgo del auditor sobre el comentario del código):
  el comentario decía que solo podía pasar "dentro de la misma tanda" — es falso. Puede pasar entre
  cargas: un trámite entra primero como SOLO_TOTAL (convenio T), y una carga posterior trae el par
  completo repitiendo T (la misma clave TOTAL, sin cambios) más una QUITA nueva; como T ya existe
  para este mismo (empresa, trámite) y la QUITA no, cae en `TANDA_PARCIAL` sin escribir nada. No se
  implementó una fusión automática (completar la tanda mezclando remesas rompe la trazabilidad de
  `clave_pago.remesaId` y el invariante "todas las vigentes son de la misma carga" que depende de
  eso) — se corrigió el comentario para no afirmar algo falso, y el camino de salida documentado
  (wiki `08-historial-y-problemas.md`) es manual: borrar la carga que quedó con la tanda incompleta y
  volver a subir el archivo completo. Test que confirma que el invariante se sostiene en este
  escenario exacto (SOLO_TOTAL primero, después T+Q) sin escrituras parciales.
- El invariante del borrado (§5.8, R2) pasa de **"0 o 2 vigentes por trámite"** a **"0 vigentes, o
  exactamente 1 TOTAL y a lo sumo 1 QUITA, todas de la misma carga"**. El código de
  `deleteRemesaMulticlaves` (`imports.service.ts`) ya recalculaba la ganadora **por remesa**, sin
  asumir una cantidad fija de filas por tanda, así que tampoco necesitó cambios — se actualizó el
  invariante que verifican los tests (`multiclaves-borrado-reemision.spec.ts`) y se agregaron
  secuencias que mezclan tandas de 1 y 2 claves, incluido su borrado.
- Vista previa (`imports.service.ts`) y resumen del lote (`ClavesService.resumenLote`): campo nuevo
  `soloTotal` (contado en memoria sobre datos que ya se traían, sin queries nuevas) + advertencia de
  texto propia. Frontend: chip "N solo TOTAL" en `MulticlavesResumen` (vista previa) y
  `MulticlavesLoteResumen` (detalle de la carga).
- **Otro hallazgo del auditor**, en la misma vista previa: el chequeo de "ya cargadas" comparaba
  `ex.length === 2` (cantidad fija), así que recargar el mismo archivo con un trámite SOLO_TOTAL
  nunca lo contaba como "ya cargado" — quedaba afuera del conteo, aunque el processor sí lo tratara
  bien como idempotente al ejecutar. Corregido a `ex.length === t.claves!.length`. `soloTotal` en
  `resumenLote` refleja lo que **esta carga en particular** escribió (`clave_pago.remesaId`): en una
  recarga idempotente del mismo archivo, la carga nueva no escribe nada, así que su propio
  `soloTotal` da 0 aunque el trámite siga siendo solo-TOTAL en la base — aclarado en la wiki para que
  no se lea como una regresión.
- Verificado contra los dos archivos reales: `MULTI_41645` sin cambios (7.478 trámites, 14.956 claves,
  0 rechazados, 0 `SOLO_TOTAL`); `MULTI_41647` **9.810 trámites válidos, 19.619 claves, 0 rechazados,
  `SOLO_TOTAL: 1`**. Carga real de los dos contra una base local con el processor real:
  **17.288 trámites, 34.575 claves, 17.288 TOTAL, 17.287 QUITA**, todas VIGENTE — exactamente lo
  esperado (17.288 − 17.287 = 1, el trámite SOLO_TOTAL).
- **Respuestas de Ana Maya del 2026-09-14 (§19):**
  - **Q1 cerrada.** El archivo es de **Personal Móvil**, uno por nómina asignada: `MULTI_41645` =
    nómina 3280 / gestión 1G, `MULTI_41647` = nómina 3282 / gestión 2G. Los 17.288 trámites de los dos
    archivos están al 100% en `CA_20260828_1008_POSBAJA_HW_260828_260828.txt`. En prod, la plantilla 26
    "Personal posbaja(M-H) - Deudores (CA)" (empresa 10, TELECOM_PERSONAL) usa identidad `NRO_CLIENTE`
    con `nro_cliente@7` = trámite: la verificación 1 de la fase 0 (§15) queda cumplida. No hay mezcla
    de empresas → **fase 1b descartada** (R9).
  - La columna `C` (10ª, sin nombre) no es importante: se guarda cruda y no se usa. Q2 sigue abierta
    solo por si en algún momento aparece un valor distinto de `C`.
  - **Q3 cerrada → D12.** El vencimiento impreso en el cupón es **hoy + 7 días corridos** (día de
    Argentina), con tope en el vencimiento real de la clave; el código de barras lleva **siempre** el
    vencimiento real. Reemplaza el parámetro `mesesVtoImpreso` de la versión anterior de este spec —
    **sale solo ese campo** de `configuracion.multiclaves` (§9.5); el resto de la config por empresa
    (`templateCuponId`, `gestionAlGenerar`, `leyendaTalonCedente`, `mediosDePago`) sigue igual, fase 3.
    Actualizado en §0 (D9, D12), §7.1, §8.1, §9.1, §9.5, §11.4, §14 (R2), §16.1 y §18.
  - **Q4 sigue abierta**, ya pedida a Ana Maya: la muestra del archivo de pagos de Personal posbaja con
    pagos hechos con multiclave — dice que trae el número de convenio, falta el archivo real para
    confirmar columna y forma exactas. Cuando llegue, la fase 4 (regla b de la consolidación, §10) se
    rediseña: la cancelación con quita va a quedar en un código de situación nuevo, propuesto
    **"Cancelado con quita" (SIT-054)**, en vez de reusar SIT-050. **No se rediseña ahora** — §10 sigue
    describiendo el diseño anterior a esta pregunta, sin implementar.
  - El logo de Personal (D11) sigue sin llegar (Q7, nueva, sin bloquear nada — hay fallback a texto).

### 2026-09-14 (fase 1 implementada)

- Schema (§4.1-4.4), `clave-pago.ts`, `multiclaves-parser.ts`, `multiclaves.processor.ts`, el
  wiring en `imports.service.ts` (número `MC-`, vista previa, borrado) y el módulo `multiclaves`
  (resumen + sin-caso) quedaron implementados y verificados contra el archivo real de muestra
  (14.956 claves, 7.478 trámites, 0 rechazados, `SALDO_DISTINTO_ENTRE_FILAS: 2`, exactamente lo que
  predecía este spec). Detalle completo en `CHANGELOG.md` [2026-09-14].
- Único desvío encontrado al implementar: el desglose "8 por CLAVE_DV, 4 por TRAMITE_INCOMPLETO"
  de la advertencia de rechazados (§5.6) no es un campo separado del parser — se arma en
  `imports.service.ts` citando el motivo de la línea culpable cuando el trámite cae por una sola
  línea, y usando el motivo genérico del trámite en el resto de los casos. El campo tipado
  `TramiteClaves.rechazo.motivo` sigue siendo siempre `TRAMITE_INCOMPLETO` o `IMPORTES_IGUALES`.

### 2026-09-14 (spec inicial)

- Spec inicial a partir del archivo de muestra, el cupón y las pantallas del sistema viejo, y lo
  confirmado con el usuario (claves por trámite, reemisión, cancelación con quita, logo de Personal).
- Verificado para este spec: formato y DV sobre las 14.956 claves; clasificación por menor importe
  (3.797 mitades exactas, 1.903 truncadas, 1.778 redondeadas); orden TOTAL/QUITA variable en el archivo;
  importes con 0 y 1 decimal; 0 trámites en común con el CA del 27/05; mezcla de productos en ese CA;
  el archivo de cobros de Prebaja Fan no trae clave.
- Encontrado en el código y con impacto en el diseño: el correlativo de remesas (D5), el reemplazo del
  JSON de configuración de empresa (§9.4), los assets que no llegan a `dist` (§7.5), el índice que falta
  para buscar por trámite sin remesa (§4.4), el `LIMIT 1` sin orden de `pagos.processor` (R5), el
  `afterAll` que traga errores y los processors singleton (§5.5), y el recálculo de saldo de la
  consolidación que dejaría 50% de saldo en una cuenta cancelada con quita (§10.1d).

---
## PLAN PARA IMPLEMENTER

**Orden de implementación:**
Paso 0: Verificaciones de §15 fase 0 (plantillas 26/31, archivo de cobros de posbaja, logo, plantilla de Sender). No hay código; condicionan el uso en prod de las fases 2–4.
Paso 1 (fase 1): Schema de §4.1–4.4 en un solo `db push` + `generate`. Va primero porque todo lo demás lo usa y es el único paso con riesgo de deploy.
Paso 2: `multiclaves/utils/clave-pago.ts` + su spec. Es la base del parser y del PDF, pura y testeable con las filas reales.
Paso 3: `imports/plantillas/telecom-multiclaves.ts` + `imports/utils/multiclaves-parser.ts` + spec con las líneas reales (incluidas 12294–12295 y 12850–12851).
Paso 4: `multiclaves.processor.ts` + registro + exención de estados por defecto + rama del runner + número `MC-` + rama de vista previa + borrado + specs.
Paso 5: Módulo `multiclaves` con `GET lotes/:id/resumen` y `sin-caso`. Frontend de importación (CategorySelector, PlantillaEditor, ImportWizard + MulticlavesResumen, ImportDetail). Wiki de importación. CHANGELOG fase 1.
Paso 5.1 (fase 1.1, **hecho** 2026-09-14): trámite SOLO_TOTAL — parser, idempotencia/reemisión por cantidad de claves en el processor, invariante del borrado, `soloTotal` en vista previa y resumen del lote, wiki, CHANGELOG. Sin push. Ver §20.
Paso 6 (fase 2): `importe-en-letras.ts` + spec; `bwip-js`; `cupon-pdf.service.ts` (vto impreso con D12, no `mesesVtoImpreso`) + assets + `nest-cli.json`; gate de escaneo.
Paso 7: Columnas de convenio en uso: `cupon.service.ts` (acción DESCARGAR), endpoints de preview/POST/reimpresión, permiso en las dos copias, `ClavesPagoCard` + `GenerarCuponDialog` + chips en `FichaConveniosTab`. Wiki de gestión y permisos. CHANGELOG fase 2.
Paso 8 (fase 3, ✅ implementado 2026-09-15): envío por mail (plantilla OPCIONAL, corregido del diseño
original), variables propias, chequeo de variables vacías, guardar contacto, endpoint de config con
merge + sección en AjustesEmpresas. Wiki. CHANGELOG. Detalle completo del desvío de la plantilla y de
lo verificado en §20.
Paso 9 (fase 4a) — **el orden importa, cada paso se apoya en el anterior**:
  9.1 `pago.referenciaClave` en `schema.prisma` + `db push` + `generate`. Va primero porque el processor y la consolidación lo necesitan, y es el único paso con riesgo de deploy.
  9.2 `SIT-054` en `prisma/seed-codigos-curados.ts` + `prisma/scripts/alta-sit-054.ts` (idempotente, `--dry-run`). Antes que la consolidación: sin el código no se puede probar el camino feliz.
  9.3 `imports/utils/situaciones-cerradas.ts` (ids de la categoría CANCELADO, cacheado, modo degradado) + los cinco reemplazos de `SIT-050` por categoría (§10.7). Es independiente del resto y deja el terreno listo para que SIT-054 no sea invisible.
  9.4 Campo mapeable `nroConvenio`: `MappingEditor.tsx` (`CAMPOS.PAGOS`) + comentario en `mapping-types.ts`. Sin esto no hay nada que probar de punta a punta.
  9.5 `pagos.processor.ts`: lectura y normalización de la referencia, `idExterno` derivado, **la condición del anti-duplicados** (`idExterno && !idExternoDerivado`), resolución del caso con desempate, `ORDER BY` del camino común, contadores y avisos. Tests **antes** de seguir: es el archivo que usan todas las carteras.
  9.6 `consolidacion.service.ts`: query de claves, decisión antes de los dos salteos, grupos `sit054Ids` / `sit050PorClaveIds` con `saldo: 0` fuera de los `$executeRaw`, cuotas a PAGADA, auditoría, contadores nuevos, las dos variables de entorno. `consolidacion-result.interface.ts` y `.env.example`.
  9.7 Vista previa y resumen de la carga de pagos (`imports.service.ts`, rama PAGOS) + `PagosConClaveResumen.tsx` + textos de los avisos nuevos en `ImportDetail`.
  9.8 `multiclaves.processor.afterAll`: consolidación best-effort de los trámites recién cargados que ya tienen pagos con referencia (§10.9, desvío consciente de §5.5).
  9.9 Frontend: `ConsolidacionModal` (filas `aSIT054` / `aSIT050PorClave` + alerta de `sit054Degradado`), `ClavesPagoCard` (chip `Pagada`, aviso de cancelado con quita), chip `Cumplido` en `FichaConveniosTab`, `claves.service.ts` para los campos nuevos de §9.1.
  9.10 Wiki (§17.1), `docs/consolidacion-situacion-spec.md`, `docs/pagos-promesas-spec.md`, CHANGELOG.
Paso 10 (aparte de la fase, contra prod): limpiar la remesa duplicada de TELECOM (`00606` cargada otra vez como `22222`: mismo archivo, 5.448 casos y 14.784 facturas cada una). De ahí salen los 20 pagos de julio, que son 10 trámites con el mismo cobro en negativo en un caso y en positivo en el otro. No es un script del repo: hay que decidir primero qué remesa queda, con snapshot y vista previa (Q10 cerrada).
Paso 11 (fase 4b, bloqueado): default de `CONSOLIDACION_CLAVE_MODO` según Q6; condición por medio de pago si Q8 lo pide; recuperación de los pagos de julio una vez limpia la remesa duplicada (necesita los `MULTI_*` de esas nóminas); GES de "Convenio con quita" (Q5).

**Archivos a crear:**
- `backend/src/modules/multiclaves/multiclaves.module.ts`
- `backend/src/modules/multiclaves/multiclaves.controller.ts`
- `backend/src/modules/multiclaves/claves.service.ts` (claves del caso, resumen y sin-caso de lotes, config de empresa)
- `backend/src/modules/multiclaves/cupon.service.ts` (+ `.spec.ts`)
- `backend/src/modules/multiclaves/cupon-pdf.service.ts` (+ `.spec.ts`)
- `backend/src/modules/multiclaves/dto/generar-cupon.dto.ts`, `dto/multiclaves-config.dto.ts`
- `backend/src/modules/multiclaves/utils/clave-pago.ts` (+ `.spec.ts`)
- `backend/src/modules/multiclaves/utils/importe-en-letras.ts` (+ `.spec.ts`)
- `backend/src/modules/multiclaves/utils/config-multiclaves.ts` (defaults y validación de `configuracion.multiclaves`)
- `backend/src/modules/multiclaves/assets/logo-personal.png` (placeholder)
- `backend/src/modules/imports/plantillas/telecom-multiclaves.ts`
- `backend/src/modules/imports/utils/multiclaves-parser.ts` (+ `.spec.ts`)
- `backend/src/modules/imports/processors/multiclaves.processor.ts` (+ `.spec.ts`)
- `frontend/src/api/multiclaves.ts`
- `frontend/src/components/deudores/ficha/ClavesPagoCard.tsx`
- `frontend/src/components/deudores/ficha/modals/GenerarCuponDialog.tsx`
- `frontend/src/components/import/MulticlavesResumen.tsx`
- `frontend/src/components/import/MulticlavesLayoutInfo.tsx`
- `docs/ayuda/03-importacion/10-claves-de-pago.md`, `docs/ayuda/02-gestion/05-cupones-de-pago.md`
- **Fase 4a**: `backend/prisma/scripts/alta-sit-054.ts`; `backend/src/modules/imports/utils/situaciones-cerradas.ts` (+ `.spec.ts`); `frontend/src/components/import/PagosConClaveResumen.tsx`

**Archivos a modificar:**
- `backend/prisma/schema.prisma` — `clave_pago`; columnas e índices de `convenio`; `MULTICLAVES` en los dos enums; índices de `deudor`; relaciones inversas en `empresa` y `remesa`. Fase 5: `pago.referenciaClave`.
- `backend/src/app.module.ts` — registrar `MulticlavesModule`.
- `backend/nest-cli.json` — assets `modules/multiclaves/assets/**/*`.
- `backend/package.json` — `bwip-js`.
- `backend/src/modules/imports/processors/processor-registry.ts` (+ `.spec.ts`) — registrar el processor.
- `backend/src/modules/imports/imports.service.ts` — exención de estados (`:1418`), número `MC-`/400 numérico/400 divisiones en `createRemesa`, rama `esMulticlaves` en `processImportJob`, rama en `validateRemesa`, rama en `deleteRemesa`.
- `backend/src/modules/imports/mapping-types.ts` — tipo `MulticlavesConfig` en `MappingJson`.
- `backend/src/modules/consolidacion/consolidacion.service.ts` (+ `.spec.ts`) — fase 4a: regla del archivo (R11) y regla del convenio (R9), SIT-054 sin lanzar si falta, grupos `sit054Ids`/`sit050PorClaveIds` con `saldo: 0`, cuotas a PAGADA, dos variables de entorno.
- `backend/src/modules/consolidacion/interfaces/consolidacion-result.interface.ts` — `aSIT054`, `aSIT050PorClave`, `sit054Degradado`.
- `backend/src/auth/permisos-catalogo.ts` y `frontend/src/utils/permisosCatalogo.ts` — `convenios.generar_cupon`. **La fase 4 no agrega permisos.**
- `backend/.env.example` — `CONSOLIDACION_TOLERANCIA_CLAVE_CENTAVOS`, `CONSOLIDACION_CLAVE_MODO`, `MULTICLAVES_LOGO_PATH`.
- `backend/prisma/seed-codigos-curados.ts` — `SIT-054` en el bloque CANCELADO.
- `backend/src/modules/imports/processors/pagos.processor.ts` (+ `.spec.ts`) — fase 4a: `referenciaClave`, `idExterno` derivado, condición del anti-duplicados, resolución del caso con desempate, `ORDER BY` del camino común, contadores y avisos.
- `backend/src/modules/imports/processors/acciones.processor.ts`, `actualizaciones.processor.ts`, `casos-cedente.processor.ts`, `backend/src/modules/imports/imports.service.ts` (`listRemesas`), `backend/src/modules/pagos/pagos.service.ts` (`revertirSinPagos`) — dejar de comparar contra la clave `SIT-050` y usar la categoría CANCELADO (§10.7).
- `backend/src/modules/imports/processors/multiclaves.processor.ts` — `afterAll` con la consolidación best-effort de los trámites recién cargados (§10.9).
- `backend/src/modules/multiclaves/claves.service.ts` — `claves[].pagos` y `avisos.canceladoConQuita` (§9.1).
- `frontend/src/components/import/MappingEditor.tsx` — campo `nroConvenio` en `CAMPOS.PAGOS`.
- `frontend/src/components/consolidacion/ConsolidacionModal.tsx` y `frontend/src/api/consolidacion.ts` — contadores nuevos y alerta de `sit054Degradado`.
- `frontend/src/components/deudores/ficha/tabs/FichaConveniosTab.tsx` — `ClavesPagoCard`, chips de convenio de clave, reimprimir.
- `frontend/src/components/deudores/ficha/FichaDeudor.tsx` — props nuevas a la solapa, badge, diálogo, recargas.
- `frontend/src/components/import/CategorySelector.tsx` — tarjeta.
- `frontend/src/pages/PlantillaEditor.tsx` — categoría, `ENTITY_MAP`, panel de layout fijo, sin estados.
- `frontend/src/pages/ImportWizard.tsx` — `needsOrigen`, número de remesa, `MulticlavesResumen`.
- `frontend/src/pages/ImportDetail.tsx`, `frontend/src/pages/ImportHistory.tsx` — rótulos y resumen.
- `frontend/src/pages/ajustes/AjustesEmpresas.tsx` — sección Claves de pago.
- Consolidación en el front (modal existente) — fila `aSIT050PorClave`.
- `docs/ayuda/03-importacion/02-categorias.md`, `08-historial-y-problemas.md`, `docs/ayuda/02-gestion/04-convenios.md`, `03-pagos-y-promesas.md`, `docs/ayuda/06-administracion/01-roles-y-permisos.md`, `docs/ayuda/08-telefonia-y-email/03-enviar-un-email.md`, `docs/ayuda/05-ajustes/01-empresas.md`.
- `docs/consolidacion-situacion-spec.md`, `docs/email-sender-spec.md`, `CHANGELOG.md`.

**Cambios de schema:** Tabla nueva `clave_pago` (unique `nroConvenio`, índice `(empresaId, nroTramite, estado)`); `convenio.origen`, `clavePagoId` (FK), `montoOriginal`, `importeQuita` + 2 índices; valor `MULTICLAVES` en `plantillaimport_categoria` y `remesa_categoria`; `deudor` índices `(empresaId, nroCliente)` y `(nroCliente)`. Todo aditivo, un `db push` en la fase 1, sin backfill. **Fase 4a: `pago.referenciaClave` (`VarChar(8)`, nullable) + índice, otro push, también aditivo y sin backfill** — la unique `(deudorId, idExterno)` no se toca. Dato nuevo de catálogo, no de schema: el parámetro `SIT-054` (seed + script idempotente, es un **paso manual del despliegue**).

**Tests a escribir:**
- `clave-pago.spec.ts`: DV de claves y códigos reales (archivo, PDF viejo, grilla vieja), dígito alterado, `centavosDeTexto` con 0/1/2 decimales y formatos inválidos, descomposición, normalización de referencia.
- `multiclaves-parser.spec.ts`: líneas reales 2–3, 14–15, 16–17, 20–21, **12294–12295 y 12850–12851**; orden invertido; trámite partido; DV corrupto → trámite entero; 3 claves; importes iguales; barra con otro vto; gestor ajeno; convenio repetido; 10ª columna ausente/distinta; CRLF; encabezado ajeno; sin encabezado; archivo completo (skip si no está). **Fase 1.1**: trámite de 1 línea válida con importe = saldo → SOLO_TOTAL (caso real `2577727090`); 1 línea con importe ≠ saldo → `CLAVE_UNICA_NO_ES_TOTAL`; línea con columnas de más o de menos que igual se asocia a su trámite real (caso real `2598949142`, TOTAL truncada); columna 0 ilegible → aislada, no contamina otro trámite.
- `multiclaves.processor.spec.ts`: nuevo, idempotente, reemisión posterior y anterior, conflicto de empresa, tanda parcial, reintento por trámite, sin estado entre corridas.
- Wiring de `imports.service`: número `MC-`, 400 numérico y divisiones, correlativo intacto, sin estados por defecto, `deleteRemesa` con convenios / restauración / cadena A→B→C; `processor-registry.spec.ts`.
- `importe-en-letras.spec.ts`: casos de §16.1 incluido 43.782,69 y 2.706.359,21.
- `cupon-pdf.service.spec.ts`: `%PDF`, código que no revalida, preview sin barras, sin logo, vto impreso (D12): `hoy + 7 días` cuando cae antes del vencimiento real, tope en el vencimiento real cuando lo supera.
- `cupon.service.spec.ts`: feliz, reuso, otra clave (409/403/anula), otro caso (409), cancelado, vencida, no corresponde, mail fallido, variables vacías, sin `email.enviar`, PDF que falla sin escrituras.
- `consolidacion.service.spec.ts` (fase 4a): tabla de §10.6, SIT-054 vs SIT-050, saldo 0 que **no** se recalcula, idempotencia, regresión sin pagos con referencia, borde de tolerancia en centavos, `PAGO_UNICO`, `montoTotal` nulo y Σpagos = 0, trámite que no coincide, clave de otra empresa, clave reemplazada/vencida, SIT-054 ausente y su autocorrección, cuota PAGADA, prioridad archivo > convenio, dryRun.
- `pagos.processor.spec.ts` (fase 4a): referencia normalizada / `0` sin aviso / ilegible con aviso; `idExterno` derivado; **las cuatro regresiones del anti-duplicados**; resolución y desempate del caso; camino común determinista; contadores reseteados.
- `situaciones-cerradas.spec.ts`: ids por categoría, cacheo, modo degradado con la tabla vacía.
- `permisos-catalogo.spec.ts` en verde; build con el logo en `dist`.

**Páginas de la wiki a tocar:** nuevas `docs/ayuda/03-importacion/10-claves-de-pago.md` y `docs/ayuda/02-gestion/05-cupones-de-pago.md`; actualizar `03-importacion/02-categorias.md`, `03-importacion/08-historial-y-problemas.md`, `02-gestion/04-convenios.md`, `02-gestion/03-pagos-y-promesas.md`, `06-administracion/01-roles-y-permisos.md`, `08-telefonia-y-email/03-enviar-un-email.md`, `05-ajustes/01-empresas.md`. **Fase 4a**: además la página de la categoría PAGOS (campo `nroConvenio` y el bloque nuevo de la vista previa), la de reportes (aviso del filtro por SIT-050) y la de códigos/parámetros (SIT-054) — la lista exacta en §17.1. Verificar con `cd frontend && npm run verificar-ayuda`.

**Skills a consultar:** prisma-migration (schema y push), nestjs-module (módulo `multiclaves`, DTOs, controller, auditoría), bullmq-worker (rama del runner de imports y processor; `_ctx`/requestId), react-component (ficha, diálogo, wizard, ajustes), amsa-general (logging, errores con `code`, permisos).

**Riesgos durante la implementación:**
- Simbología del código de barras no confirmada: no dar el permiso en prod sin el escaneo (R1).
- Tocar `consolidacion.service.ts` afecta a todas las carteras: la regresión sin pagos con referencia es obligatoria (criterios 16 y 31).
- **Tocar `pagos.processor.ts` afecta a todas las carteras**: la condición del anti-duplicados es una línea y equivocarla duplica o pierde cobranza. Las cuatro regresiones del criterio 26/32 son obligatorias.
- No incluir a los cancelados por clave en los `$executeRaw` de saldo (`:379-385`, `:400-407`) o quedan con 50% de saldo.
- Hacer que `cachearParametrosSIT` **lance** si falta SIT-054: dejaría el backend sin arrancar después del deploy hasta correr el script. Tiene que degradar, no morir (§10.7).
- Comparar importes en `Float` con tolerancia en pesos: se compara en **centavos enteros** (`pago.importe` es Float y `clave_pago.importe` es Decimal).
- Joinear la clave también por `nroCliente` en el SQL: un `nroCliente` con espacios apagaría la regla en silencio. El join va por `nroConvenio` + `empresaId` y la comparación del trámite se hace en memoria.
- Olvidar que el mismo archivo se carga **una vez por empresa**: la regla tiene que exigir `clave_pago.empresaId = deudor.empresaId`.
- Mapear el importe a la columna 23 "porque viene positiva": lo es solo en los pagos con clave (§10.1).
- Escribir los avisos de la carga solo en `afterAll`: sus errores se tragan. La defensa real es la vista previa.
- Parsear importes con float rompe la coincidencia con el código de barras.
- Olvidar `nest-cli.json` assets: el logo anda en dev y no en la imagen.
- Guardar la config de empresa con el update genérico pisa la de mora.
- Guardar estado en la instancia del processor (singleton del registry).
- Poner lógica en `afterAll`: sus errores se tragan.
- `db push` que pida `--accept-data-loss`: leer el warning, no forzarlo.
- No correr `npm run lint` global en el backend; verificar con `npm run build`.
- `usuarioId` del convenio desde el JWT, no del body (el create existente lo toma del DTO).

**Criterios de aceptación:**
1. Archivo de muestra en empresa sin casos: vista previa 7.478 trámites / 7.478 válidos / 0 rechazados / 0 con caso / 7.478 sin caso / aviso `SALDO_DISTINTO_ENTRE_FILAS` = 2; tras ejecutar, 14.956 claves VIGENTE (7.478 TOTAL, 7.478 QUITA), `errFilas` 0.
2. `2598157072` → QUITA 16414.17 / TOTAL 32828.35, saldo 32828.35 en ambas; `2598290522` → 13738.79 / 27477.59.
3. En las 14.956 claves, importe×100 = centavos embebidos en clave y código.
4. Recarga misma empresa: sigue en 14.956 y 0 errores; otra empresa: 7.478 errores `CONVENIO_YA_EXISTE`, 0 filas nuevas.
5. La carga no mueve el correlativo numérico de la empresa; número `00609` en carga de claves → 400.
6. DV alterado en una línea rechaza su trámite completo citando `CLAVE_DV` y la línea.
7. Reemisión posterior: 2 VIGENTE + 2 REEMPLAZADA; borrar la segunda carga restaura; con convenio, 400.
8. Cupón con los 50 dígitos del archivo, legible con lector físico (evidencia en CHANGELOG).
9. Vista previa del cupón sin código de barras.
10. Misma clave dos veces (o dos POST concurrentes) → 1 convenio `CLAVE_PAGO` ACTIVO.
11. Nunca dos convenios de clave activos por trámite; cambiar de clave exige flag + `convenios.cancelar` y anula el anterior.
12. Caso cancelado (categoría CANCELADO) → 403 al generar y reimprimir.
13. Mail rechazado → convenio creado, `envio_email` ERROR, comentario "FALLÓ", `envio.ok=false`.
14. Convenio de quita 19.880,01 + pago 19.880,01 (o 19.880,00) de hoy → **SIT-054**, saldo 0, cuota PAGADA; segunda consolidación `sinCambios`. Con clave TOTAL, SIT-050.
15. Mismo pago sin convenio y sin `nroConvenio` en el archivo → SIT-041, saldo `montoTotal − 19.880,01`.
16. Consolidación de empresa sin claves ni pagos con referencia: mismos contadores antes y después.
17. `permisos-catalogo.spec.ts` verde; permiso visible en Roles.
18. Logo en `dist` tras build; sin logo, cupón con texto "Personal".
19. Guardar config de multiclaves conserva `configuracion.mora`.
20. `npm run verificar-ayuda` sin errores y páginas de la fase presentes.
21. (Fase 1.1, **hecho**) `MULTI_41647`: vista previa 9.810 trámites válidos / 19.619 claves / 0 rechazados / `soloTotal: 1`; el trámite `2577727090` carga con 1 sola clave TOTAL. Reemisión que cambia la cantidad de claves (2→1 o 1→2) reemplaza todas las vigentes; borrado mantiene el invariante "0, o 1 TOTAL + a lo sumo 1 QUITA de la misma carga" (ver §18.21 para el detalle).
22. (Fase 4a) Vista previa del `MA_20260911…_C.txt` con las claves cargadas: **104 filas, 23 con clave, 6 con clave cargada (6 QUITA / 0 TOTAL), 17 con clave no cargada, 0 ilegibles, 0 de otra empresa**.
23. (Fase 4a) Al ejecutar: **6 casos en SIT-054 con saldo 0,00** y `montoTotal` intacto; `aSIT054 = 6`, `aSIT050PorClave = 0`; trámite `1981517609` con pago $ 15.500,00 y `referenciaClave = '96234420'`.
24. (Fase 4a) Los 17 pagos sin clave cargada no cancelan nada, conservan su referencia, y se cancelan solos al cargar esas claves y consolidar.
25. (Fase 4a) Las 81 filas comunes cargan en positivo y los 3 trámites con varios pagos conservan **todos** sus pagos.
26. (Fase 4a) Recargar el archivo no duplica nada, ni siquiera si la primera carga fue sin el mapeo de `nroConvenio`; no hay `idExterno LIKE 'MC-%'` repetido.
27. (Fase 4a) Sin SIT-054 el backend arranca, cancela a SIT-050 con `sit054Degradado > 0`, y al crear el código la consolidación siguiente mueve esos casos sin más intervención.
28. (Fase 4a) Ningún caso de categoría CANCELADO queda con `saldo > montoTotal * 0.01`.
29. (Fase 4a) Un caso en SIT-054 está bloqueado igual que uno en SIT-050, en las cinco superficies de §10.7.
30. (Fase 4a) Los tableros los cuentan como cancelados sin cambios de código; un reporte filtrado por SIT-050 no los incluye y eso está avisado.
31. (Fase 4a) Dry-run de AYSA y Toyota: contadores idénticos a los de antes del cambio, `aSIT054 = aSIT050PorClave = 0`.
32. (Fase 4a) El archivo de AYSA sigue cargando 1.997 cobros y una cartera con `PAYMENT_ID` real sigue salteando la heurística de día + importe.
33. (Fase 4a) `PAGO_UNICO` no cancela con dos pagos que suman; `SUMA` sí; un env fuera de rango hace fallar el arranque.
34. (Fase 4a) Una clave REEMPLAZADA y una vencida cancelan igual si el archivo trae su convenio pagado.
35. (Aparte) Los 20 pagos de julio se resuelven con la limpieza de la remesa duplicada de TELECOM, no con un script del repo.
