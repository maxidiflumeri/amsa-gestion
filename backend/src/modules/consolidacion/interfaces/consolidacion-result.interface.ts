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
    /**
     * Fase 4a de multiclaves (docs/multiclaves-spec.md §10.5f): cancelados con quita (SIT-054) por
     * el pago de una clave QUITA del cedente, con `saldo = 0` aunque hayan pagado solo la mitad.
     */
    aSIT054: number;
    /**
     * Subconjunto de `aSIT050` cancelado por el pago de una clave TOTAL (regla de multiclaves), no
     * por `Σpagos >= montoTotal` (regla de siempre).
     */
    aSIT050PorClave: number;
    /**
     * Casos que debían cancelarse con quita (SIT-054) y quedaron en SIT-050 porque el código
     * `SIT-054` todavía no existe en `parametro` (docs/multiclaves-spec.md §10.7). Se corrige solo
     * en la corrida siguiente a que se cree el código (`prisma/scripts/alta-sit-054.ts`).
     */
    sit054Degradado: number;
    /** Duración total en milisegundos. */
    durationMs: number;
}
