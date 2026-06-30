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
