import { AnchoFijoConfig } from '../mapping-types';

/**
 * Layouts de los archivos de AYSA (`AGAEJ0_*` y `AGNEJ*`), exports de SAP en **ancho fijo**.
 *
 * Son el `mappingJson.anchoFijo` de las plantillas. Viven en código como **referencia** para poder
 * crear la plantilla y testear contra los archivos reales, pero lo que manda en producción es lo que
 * quede guardado en la plantilla: si el cedente mueve una columna se corrige ahí, sin deploy.
 *
 * Verificado sobre la bajada del 2026-06-22 de la oficina de cobro 9000001028
 * (21.335 cuentas en 31 archivos, 1.115.323 partidas en otros 31).
 * Análisis completo en `docs/imports-aysa-spec.md`.
 *
 * Los dos layouts cierran **exactamente** con el largo del encabezado (1006 y 274 caracteres), que
 * es la validación más fuerte que se le puede pedir a un layout derivado a mano. Además:
 * `Imp. Asignado` de la cuenta coincide con la suma de los importes de sus partidas en 21.334 de
 * los 21.335 casos.
 *
 * Los archivos vienen en Latin-1: leídos como UTF-8 se rompen las Ñ y los acentos
 * (`LARRAÑAGA` → `LARRA?AGA`), que en este cedente aparecen en nombres y calles.
 */

/** El cedente rotula esta columna `División` en las cuentas y `Distrito` en las novedades y bajas. */
const DISTRITO = 'Distrito / División';

/**
 * `AGAEJ0_cuentas_*` → un caso por línea (1006 caracteres).
 *
 * Es también el layout de `AGNEJ1_ZDES_*` (desasignaciones) y `AGNEJ1_ZNEX_*` (extinciones): el
 * mismo registro, con `F. Desas.`/`Mot.Des.` o `F. Extin.`/`Mot. Ex.` cargados y el discriminador
 * `Nov.` en `N` o `M` en vez de `K`.
 *
 * `Cta. Cto.` es la clave: única en los 21.335 casos y la que cruza con las partidas sin una sola
 * huérfana en ninguno de los dos sentidos. **No** se puede usar el documento: el 42% de los casos no
 * trae ni DNI ni CUIT.
 */
export const AYSA_CUENTAS_ANCHO_FIJO: AnchoFijoConfig = {
    encoding: 'latin1',
    columnas: [
        { nombre: 'Of. Cobro', inicio: 0, largo: 10 },
        { nombre: DISTRITO, inicio: 10, largo: 8 },
        { nombre: 'Interloc.', inicio: 18, largo: 10 },
        { nombre: 'Denominación IC', inicio: 28, largo: 40 },
        { nombre: 'Cta. Cto.', inicio: 68, largo: 12 },
        { nombre: 'Cta. Cto. sis. ant.', inicio: 80, largo: 20 },
        { nombre: 'Exped.', inicio: 100, largo: 10 },
        { nombre: 'Circuns.', inicio: 110, largo: 8 },
        { nombre: 'Sección', inicio: 118, largo: 8 },
        { nombre: 'Manzana', inicio: 126, largo: 8 },
        { nombre: 'Coef. zonal', inicio: 134, largo: 12 },
        { nombre: 'Un. Func.', inicio: 146, largo: 10 },
        { nombre: 'Pto. Sum.', inicio: 156, largo: 10 },
        { nombre: 'Dist.Cat', inicio: 166, largo: 8 },
        { nombre: 'Categoría', inicio: 174, largo: 10 },
        { nombre: 'Tipo usu.', inicio: 184, largo: 10 },
        // El encabezado dice "Cl. Ind."; es la clase de inmueble.
        { nombre: 'Cl. Ind.', inicio: 194, largo: 8 },
        { nombre: 'Regime', inicio: 202, largo: 6 },
        { nombre: 'F. Proc.', inicio: 208, largo: 10 },
        { nombre: 'NR', inicio: 218, largo: 3 },
        { nombre: 'F. Desde', inicio: 221, largo: 10 },
        { nombre: 'F. Hasta', inicio: 231, largo: 10 },
        { nombre: 'F.Tol.Liq.', inicio: 241, largo: 10 },
        // Deuda asignada. Coincide con Σ de los importes de las partidas del caso.
        { nombre: 'Imp. Asignado', inicio: 251, largo: 15 },
        { nombre: 'Imp. No Venc.', inicio: 266, largo: 15 },
        { nombre: 'Imp.PP No Caid', inicio: 281, largo: 15 },
        { nombre: 'Imp. PP Caído', inicio: 296, largo: 15 },
        { nombre: 'F. Extin.', inicio: 311, largo: 10 },
        { nombre: 'Mot. Ex.', inicio: 321, largo: 8 },
        { nombre: 'F. Desas.', inicio: 329, largo: 10 },
        { nombre: 'Mot.Des.', inicio: 339, largo: 8 },
        { nombre: 'F. Prolon.', inicio: 347, largo: 10 },
        // K = asignación vigente · N = desasignada · M = extinguida.
        { nombre: 'Nov.', inicio: 357, largo: 4 },
        // Domicilio del inmueble.
        { nombre: 'Nombre de calle', inicio: 361, largo: 60 },
        { nombre: 'Nro.puer.', inicio: 421, largo: 10 },
        { nombre: 'Nro. Anterior', inicio: 431, largo: 20 },
        { nombre: 'Nro.piso', inicio: 451, largo: 10 },
        { nombre: 'Nro.dpto.', inicio: 461, largo: 10 },
        { nombre: 'Cod. Pos.', inicio: 471, largo: 10 },
        { nombre: 'Localidad', inicio: 481, largo: 40 },
        // Domicilio postal. El encabezado repite los mismos nombres; se desambiguan acá porque el
        // editor de mapeo los lista y hay que poder distinguirlos.
        { nombre: 'Nombre de calle (postal)', inicio: 521, largo: 60 },
        { nombre: 'Nro.puer. (postal)', inicio: 581, largo: 10 },
        { nombre: 'Nro. Anterior (postal)', inicio: 591, largo: 20 },
        { nombre: 'Nro.piso (postal)', inicio: 611, largo: 10 },
        { nombre: 'Nro.dpto. (postal)', inicio: 621, largo: 10 },
        { nombre: 'Cod. Pos. (postal)', inicio: 631, largo: 10 },
        { nombre: 'Localidad (postal)', inicio: 641, largo: 40 },
        { nombre: 'Nro. de Teléfono 1', inicio: 681, largo: 30 },
        { nombre: 'Nro. de Teléfono 2', inicio: 711, largo: 30 },
        { nombre: 'Nro. de Teléfono 3', inicio: 741, largo: 30 },
        { nombre: 'Nro. de Teléfono 4', inicio: 771, largo: 30 },
        { nombre: 'Nro. de Teléfono 5', inicio: 801, largo: 30 },
        { nombre: 'Nro. de Teléfono 6', inicio: 831, largo: 30 },
        { nombre: 'Nro. de Teléfono 7', inicio: 861, largo: 30 },
        // Vacíos en el 91% y el 45% de los casos respectivamente; ninguno de los dos en el 42%.
        { nombre: 'Nro. DNI', inicio: 891, largo: 30 },
        { nombre: 'Nro. CUIT', inicio: 921, largo: 30 },
        { nombre: 'Correo Electrónico', inicio: 951, largo: 40 },
        { nombre: 'Observaciones 1', inicio: 991, largo: 15 },
    ],
};

/**
 * `AGAEJ0_partidas_*` → una factura por línea (274 caracteres).
 *
 * Es también el layout de `AGNEJ0_*` (novedades): el mismo registro, con la cola de situación y
 * cobro cargada. En las partidas esa cola viene vacía.
 *
 * `Cta. Cto.` cruza con la cuenta y el par `(Cta. Cto., Nro. docum.)` es único en las 1.115.323
 * filas, así que `Nro. docum.` sirve directo como número de factura.
 *
 * `Cod. situ.` de las novedades, deducido de los datos (a confirmar con el cedente):
 *   A → cobro al contado de la partida (`Imp. cobrado` = `Importe`, sin plan de pago)
 *   E → la partida entró en un plan de pago (trae `Nro. PP`, cobrado en 0)
 *   F → cobro de una cuota del plan (trae `Nro. PP` y `Cuota Cob.`)
 *   J → otra novedad, sin identificar (`Mot. situ.` = 08, cobrado en 0)
 *
 * Solo A y F son plata que entró: 1.997 de las 4.552 filas de la bajada del 25/07. Por eso la
 * plantilla de pagos filtra por `Imp. cobrado` > 0.
 */
export const AYSA_PARTIDAS_ANCHO_FIJO: AnchoFijoConfig = {
    encoding: 'latin1',
    columnas: [
        { nombre: 'F. Proc.', inicio: 0, largo: 10 },
        { nombre: 'Of. Cobro', inicio: 10, largo: 10 },
        { nombre: DISTRITO, inicio: 20, largo: 10 },
        { nombre: 'Interloc.', inicio: 30, largo: 10 },
        { nombre: 'Cta. Cto.', inicio: 40, largo: 12 },
        { nombre: 'Cta. Cto. sis. ant.', inicio: 52, largo: 20 },
        { nombre: 'Dist. Cat.', inicio: 72, largo: 12 },
        { nombre: 'F.Desde', inicio: 84, largo: 10 },
        { nombre: 'F.Hasta', inicio: 94, largo: 10 },
        { nombre: 'T.Comp.', inicio: 104, largo: 8 },
        // El dato ocupa 14 caracteres y el campo 16; se declara completo para no dejar huecos.
        { nombre: 'Nro. docum.', inicio: 112, largo: 16 },
        { nombre: 'F.vto.', inicio: 128, largo: 10 },
        { nombre: 'Importe', inicio: 138, largo: 13 },
        { nombre: 'Nro. PP', inicio: 151, largo: 13 },
        { nombre: 'Fec. PP', inicio: 164, largo: 10 },
        { nombre: 'Cant. cuotas', inicio: 174, largo: 13 },
        { nombre: 'Primer cuota impaga', inicio: 187, largo: 21 },
        { nombre: 'Fec. situ.', inicio: 208, largo: 11 },
        { nombre: 'Cod. situ.', inicio: 219, largo: 11 },
        { nombre: 'Mot. situ.', inicio: 230, largo: 11 },
        { nombre: 'Cuota Cob.', inicio: 241, largo: 11 },
        { nombre: 'F. cobro', inicio: 252, largo: 10 },
        { nombre: 'Imp. cobrado', inicio: 262, largo: 12 },
    ],
};
