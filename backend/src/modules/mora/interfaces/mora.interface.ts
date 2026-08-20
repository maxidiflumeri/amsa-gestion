/**
 * Tipos del módulo de mora. Ver docs/mora-aysa-spec.md §1 para el significado de cada concepto:
 * los nombres (`intRec`, `recAjEj`, `iva`) son los que usa el estado de deuda de AYSA.
 */

/** Un renglón del cálculo: una factura valuada a una fecha. */
export interface DetalleMoraFactura {
    facturaId: number;
    nroFactura: string;
    vencimiento: string;
    /** Días corridos entre el vencimiento y la fecha de cálculo. 0 si todavía no venció. */
    diasMora: number;
    capital: number;
    /** `indice(fecha) / indice(vencimiento)`. 1 cuando no hay mora. */
    coeficiente: number;
    /** `capital × (coeficiente − 1 + recargoFijo)` */
    intRec: number;
    /** `recargoGestion × (capital + intRec)` */
    recAjEj: number;
    /** `iva × (intRec + recAjEj)` */
    iva: number;
    total: number;
    /** Por qué esta factura no devengó, si no devengó. */
    nota?: 'NO_VENCIDA' | 'SIN_INDICE';
}

/** El cálculo completo de un caso. */
export interface MoraDeudor {
    deudorId: number;
    fechaCalculo: string;
    capital: number;
    intRec: number;
    recAjEj: number;
    iva: number;
    /** `intRec + recAjEj + iva`. Es lo que se persiste en `deudor.recargoMora`. */
    recargo: number;
    /** `capital + recargo`. La deuda actualizada. */
    total: number;
    facturas: DetalleMoraFactura[];
    advertencias: string[];
}

/** Resultado de generar (o regenerar) el índice de un mes. */
export interface ResultadoGeneracion {
    periodo: string;
    tasaBase: number;
    diasGenerados: number;
    /** Índice de cierre de cada tipo, para poder verificar a ojo contra el CRM del cedente. */
    indicesFinales: Record<string, string>;
    /** Meses posteriores que hubo que recalcular porque la cadena es acumulativa. */
    periodosRegenerados: string[];
    durationMs: number;
}

/** Una fila del panel de tasas: qué se cargó y si el índice está generado. */
export interface EstadoTasa {
    periodo: string;
    tasaBase: number | null;
    fuente: string | null;
    /** Días de índice generados para el tipo 1. 0 = falta generar. */
    diasIndice: number;
    completo: boolean;
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
