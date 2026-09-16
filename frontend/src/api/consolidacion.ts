import api from './axios';

export type ConsolidacionScopeDto =
    | { tipo: 'REMESA'; remesaId: number }
    | { tipo: 'EMPRESA'; empresaId: number }
    | { tipo: 'TODAS' };

export interface ConsolidacionResult {
    evaluados: number;
    conPagos: number;
    aSIT050: number;
    aSIT041: number;
    sinCambios: number;
    saldoActualizado: number;
    /** Fase 4a (multiclaves): cancelados con quita (SIT-054) por el pago de una clave QUITA. */
    aSIT054: number;
    /** Subconjunto de `aSIT050` cancelado por el pago de una clave TOTAL, no por Σpagos. */
    aSIT050PorClave: number;
    /** Casos que debían ir a SIT-054 y quedaron en SIT-050 porque falta el código en `parametro`. */
    sit054Degradado: number;
    durationMs: number;
}

export interface ConsolidacionJobResponse {
    jobId: string;
}

export interface ConsolidacionEstado {
    enCurso: boolean;
    jobId?: string;
    usuarioId?: number;
    iniciadoEn?: string;
}

export const consolidacionApi = {
    preview(scope: ConsolidacionScopeDto): Promise<ConsolidacionJobResponse> {
        return api.post<ConsolidacionJobResponse>('/consolidacion/preview', scope).then((r) => r.data);
    },

    aplicar(scope: ConsolidacionScopeDto): Promise<ConsolidacionJobResponse> {
        return api.post<ConsolidacionJobResponse>('/consolidacion/aplicar', scope).then((r) => r.data);
    },

    estado(): Promise<ConsolidacionEstado> {
        return api.get<ConsolidacionEstado>('/consolidacion/estado').then((r) => r.data);
    },
};
