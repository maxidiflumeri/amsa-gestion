// utils/reconciliar-actualizacion.ts
//
// Lógica PURA de reconciliación de pagos para el processor de ACTUALIZACIONES
// (docs/pagos-promesas-spec.md §3.2). Separada para poder testearla sin DB.
//
// El archivo de actualización trae, por deudor, el SALDO QUE QUEDA por pagar
// (outstanding). `montoTotal` del deudor es el ORIGINAL inmutable.

export const RECON_EPS = 1; // ruido de float (1 peso)

export type ReconResultado =
    | { tipo: 'pago'; importe: number }      // crear pago por `importe`
    | { tipo: 'ajuste'; importe: number }    // la deuda creció → factura de ajuste por `importe`
    | { tipo: 'nada' };                       // nada que hacer (ya reconciliado)

/**
 * Reconciliación por saldo (Modo B / valor único). Devuelve la acción incremental
 * a aplicar restando lo YA pagado, para no duplicar pagos manuales ni de
 * actualizaciones sucesivas.
 *
 * - objetivoPagado = montoOriginal − saldoArchivo  (cuánto debería estar pagado en total)
 * - si objetivoPagado < 0 → la deuda creció (saldo informado > original) → 'ajuste'
 * - si no → deltaPago = objetivoPagado − yaPagado; si > ε → 'pago'; si no → 'nada'
 */
export function reconciliarSaldo(
    montoOriginal: number,
    saldoArchivo: number,
    yaPagado: number,
    eps: number = RECON_EPS,
): ReconResultado {
    const objetivoPagado = montoOriginal - saldoArchivo;

    if (objetivoPagado < -eps) {
        return { tipo: 'ajuste', importe: Math.abs(objetivoPagado) };
    }

    const deltaPago = objetivoPagado - yaPagado;
    if (deltaPago > eps) {
        return { tipo: 'pago', importe: deltaPago };
    }
    return { tipo: 'nada' };
}

export type ReconAusente =
    | { tipo: 'pago'; importe: number; marcarFacturasPagadas: true }
    | { tipo: 'saldado'; marcarFacturasPagadas: true }  // ya cubierto por pagos existentes
    | { tipo: 'skip'; marcarFacturasPagadas: false };    // sin referencia (montoTotal 0/nulo) → no tocar

/**
 * Escenario C (afterAll): deudor ausente del archivo → pagó todo. Reconcilia el
 * saldo restante contra los pagos ya existentes (no suma facturas a ciegas).
 */
export function reconciliarAusente(
    montoOriginal: number | null,
    yaPagado: number,
    eps: number = RECON_EPS,
): ReconAusente {
    if (montoOriginal == null || montoOriginal <= 0) {
        return { tipo: 'skip', marcarFacturasPagadas: false };
    }
    const deltaPago = montoOriginal - yaPagado;
    if (deltaPago > eps) {
        return { tipo: 'pago', importe: deltaPago, marcarFacturasPagadas: true };
    }
    return { tipo: 'saldado', marcarFacturasPagadas: true };
}
