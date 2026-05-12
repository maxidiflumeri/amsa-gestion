import api from './axios';
import type { SnapshotFiltros, SnapshotResponse } from '../types/dashboards';

export type FormatoExportDashboard = 'xlsx' | 'pdf';

export type DimensionDrillDown = 'situacion' | 'gestion' | 'motivo' | 'mora' | 'deuda';

export interface DrillDownDeudor {
    id: number;
    nombreCompleto: string;
    documento: string;
    montoTotal: number;
    estadoSituacion: string | null;
    estadoGestion: string | null;
    motivoNoPago: string | null;
}

export interface DrillDownResponse {
    items: DrillDownDeudor[];
    total: number;
    page: number;
    pageSize: number;
    dimension: string;
    valor: string;
}

export interface DrillDownRequest extends SnapshotFiltros {
    dimension: DimensionDrillDown;
    valor: string;
    page?: number;
    pageSize?: number;
}

export interface ExportDashboardRequest extends SnapshotFiltros {
    formato: FormatoExportDashboard;
    nombreTablero?: string;
}

export const dashboardsApi = {
    snapshot(filtros: SnapshotFiltros): Promise<SnapshotResponse> {
        return api.post('/dashboards/remesa/snapshot', filtros).then((r) => r.data);
    },

    async exportar(req: ExportDashboardRequest): Promise<{ blob: Blob; filename: string }> {
        const response = await api.post('/dashboards/remesa/export', req, {
            responseType: 'blob',
        });
        const disposition: string | undefined = response.headers?.['content-disposition'];
        let filename = `tablero.${req.formato}`;
        if (disposition) {
            const match = disposition.match(/filename="?([^"]+)"?/i);
            if (match?.[1]) filename = match[1];
        }
        return { blob: response.data, filename };
    },

    drillDown(req: DrillDownRequest): Promise<DrillDownResponse> {
        return api.post('/dashboards/remesa/drill-down/deudores', req).then((r) => r.data);
    },
};
