import api from './axios';
import type { AuditoriaStats, QueryAuditoria, Transaccion, TransaccionesListado } from '../types/auditoria';

export const auditoriaApi = {
    listar(q: QueryAuditoria = {}): Promise<TransaccionesListado> {
        return api.get('/transacciones', { params: q }).then((r) => r.data);
    },
    stats(q: QueryAuditoria = {}): Promise<AuditoriaStats> {
        return api.get('/transacciones/stats', { params: q }).then((r) => r.data);
    },
    obtener(id: number): Promise<Transaccion> {
        return api.get(`/transacciones/${id}`).then((r) => r.data);
    },
    exportar(q: QueryAuditoria & { formato: 'xlsx' | 'csv' | 'pdf' }): Promise<Blob> {
        return api.post('/transacciones/export', null, { params: q, responseType: 'blob' }).then((r) => r.data);
    },
};
