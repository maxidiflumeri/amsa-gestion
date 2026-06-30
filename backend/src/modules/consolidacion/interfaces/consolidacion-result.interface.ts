/**
 * Tipos públicos del módulo de consolidación de situación.
 *
 * ConsolidacionScope define los cuatro modos de operación del servicio core.
 * ConsolidacionResult es la respuesta unificada tanto para dryRun como para apply.
 */

export type ConsolidacionScope =
    | { tipo: 'DEUDORES'; deudorIds: number[] }
    | { tipo: 'REMESA'; remesaId: number }
    | { tipo: 'EMPRESA'; empresaId: number }
    | { tipo: 'TODAS' };

export interface ConsolidacionResult {
    /** Cantidad de deudores que entraron al cálculo (excluyendo skips por montoTotal nulo). */
    evaluados: number;
    /** Deudores con sum(pagos) > 0. */
    conPagos: number;
    /** Deudores que transicionarían/transicionaron a SIT-050 (Cancelado). */
    aSIT050: number;
    /** Deudores que transicionarían/transicionaron a SIT-041 (Pago parcial). */
    aSIT041: number;
    /**
     * Deudores cuya situación y saldo no cambiaron respecto al estado actual.
     * (Incluye deudores sin pagos que fueron skipeados.)
     */
    sinCambios: number;
    /** Deudores cuyo saldo cambió (independientemente de si cambió la situación). */
    saldoActualizado: number;
    /** Duración total en milisegundos. */
    durationMs: number;
}
