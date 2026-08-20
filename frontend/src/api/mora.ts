import api from './axios';

/**
 * Recargo por mora. Los nombres de los conceptos son los que usa el estado de deuda de AYSA,
 * a propósito: así el gestor puede cotejar la ficha contra la oficina virtual línea por línea.
 * Ver docs/mora-aysa-spec.md.
 */

export interface DetalleMoraFactura {
    facturaId: number;
    nroFactura: string;
    vencimiento: string;
    diasMora: number;
    capital: number;
    coeficiente: number;
    /** Interés más el recargo fijo del 5%. */
    intRec: number;
    /** Recargo por gestión de cobranza: 10% de capital + interés. */
    recAjEj: number;
    /** 21% sobre los recargos. No grava el capital. */
    iva: number;
    total: number;
    nota?: 'NO_VENCIDA' | 'SIN_INDICE';
}

export interface MoraDeudor {
    deudorId: number;
    fechaCalculo: string;
    capital: number;
    intRec: number;
    recAjEj: number;
    iva: number;
    recargo: number;
    total: number;
    facturas: DetalleMoraFactura[];
    advertencias: string[];
}

export interface EstadoTasa {
    periodo: string;
    tasaBase: number | null;
    fuente: string | null;
    diasIndice: number;
    completo: boolean;
}

export interface ResultadoGeneracion {
    periodo: string;
    tasaBase: number;
    diasGenerados: number;
    indicesFinales: Record<string, string>;
    periodosRegenerados: string[];
    durationMs: number;
}

export interface ResultadoRecalculo {
    empresaId: number;
    fechaCalculo: string;
    deudoresEvaluados: number;
    deudoresActualizados: number;
    facturasSinIndice: number;
    dryRun: boolean;
    durationMs: number;
}

export const moraApi = {
    tasas(empresaId: number, meses = 24): Promise<EstadoTasa[]> {
        return api.get('/mora/tasas', { params: { empresaId, meses } }).then((r) => r.data);
    },

    faltantes(empresaId: number): Promise<{ empresaId: number; faltantes: string[]; cantidad: number }> {
        return api.get('/mora/tasas/faltantes', { params: { empresaId } }).then((r) => r.data);
    },

    /** `tasaBase` va como la informa el cedente: 2.169 para 2,169%. Sin dividir por 100. */
    cargarTasa(body: {
        empresaId: number;
        periodo: string;
        tasaBase: number;
        fuente?: string;
        observacion?: string;
    }): Promise<ResultadoGeneracion> {
        return api.post('/mora/tasas', body).then((r) => r.data);
    },

    deudor(deudorId: number, fecha?: string): Promise<MoraDeudor> {
        return api.get(`/mora/deudor/${deudorId}`, { params: fecha ? { fecha } : {} }).then((r) => r.data);
    },

    recalcular(body: { empresaId: number; fecha?: string; dryRun?: boolean }): Promise<ResultadoRecalculo> {
        return api.post('/mora/recalcular', body).then((r) => r.data);
    },
};
