/**
 * Layout FIJO del archivo de claves de pago de Telecom/Personal (multiclaves).
 *
 * A diferencia de `aysa.ts` y `toyota-tcfa.ts` (que son la referencia de un `mappingJson` editable),
 * este layout **no se guarda en la plantilla** (D2 del spec): la validación es estructural — dígitos
 * verificadores, posiciones del código de barras — y un cambio de formato de Telecom requiere código
 * de todos modos. Lo único configurable desde la plantilla es `codigosGestor`
 * (`mappingJson.multiclaves.codigosGestor`).
 *
 * Verificado sobre `MULTI_41645_RA_1008_2026-08-31_10.29.22.csv` (14.957 líneas: 1 encabezado +
 * 14.956 claves, 7.478 trámites × 2 claves). Análisis completo en `docs/multiclaves-spec.md` §1.
 *
 * Forma del archivo: ASCII, fin de línea LF, separador `|`. Encabezado de 9 nombres; cada fila de
 * datos trae 10 columnas (la 10ª no tiene nombre y vale `C` en todo el archivo de muestra).
 */

/** Nombres del encabezado esperado, en el orden de las columnas 0-8 (comparación sin mayúsculas). */
export const MULTICLAVES_ENCABEZADO = [
    'NRO_TRAMITE',
    'NRO_CONVENIO',
    'SALDO_TRAMITE',
    'IMPORTE_TOTAL_CLAVE',
    'CLAVE_PAGO',
    'FECHA_VENCIMIENTO',
    'SEC_COD_BARRA',
    'CODIGO_GESTOR',
    'APELLIDO_NOMBRE_RAZON_SOCIAL',
] as const;

/** Índice (0-based) de cada columna de datos. La 10ª (`MARCA`) no tiene nombre en el archivo. */
export const MULTICLAVES_COLUMNAS = {
    NRO_TRAMITE: 0,
    NRO_CONVENIO: 1,
    SALDO_TRAMITE: 2,
    IMPORTE_TOTAL_CLAVE: 3,
    CLAVE_PAGO: 4,
    FECHA_VENCIMIENTO: 5,
    SEC_COD_BARRA: 6,
    CODIGO_GESTOR: 7,
    APELLIDO_NOMBRE_RAZON_SOCIAL: 8,
    MARCA: 9,
} as const;

/** Cantidad mínima y máxima de columnas que trae una fila de datos válida. */
export const MULTICLAVES_MIN_COLUMNAS = 9;
export const MULTICLAVES_MAX_COLUMNAS = 10;

/**
 * `CODIGO_GESTOR` por defecto al crear una plantilla nueva. Ana Maya recibe las claves de Telecom
 * y Personal con el código `1008` (verificado en el 100% de las 14.956 filas de la muestra); el
 * operador lo puede ajustar desde el editor si el cedente cambia el código.
 */
export const MULTICLAVES_CODIGOS_GESTOR_DEFAULT = ['1008'];
