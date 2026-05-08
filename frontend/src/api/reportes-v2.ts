import api from './axios'
import { PlantillaV2, NodoCatalogo, DefinicionV2 } from '../types/reportes-v2'

export const reportesV2Api = {
  catalogo: (raiz = 'deudor', depth = 3) =>
    api.get<NodoCatalogo[]>(`/reportes/v2/catalogo?raiz=${raiz}&depth=${depth}`),

  listarPlantillas: (empresaId?: number) =>
    api.get<PlantillaV2[]>(`/reportes/v2/plantillas${empresaId ? `?empresaId=${empresaId}` : ''}`),

  obtenerPlantilla: (id: number) =>
    api.get<PlantillaV2>(`/reportes/v2/plantillas/${id}`),

  crearPlantilla: (data: Omit<PlantillaV2, 'id'>) =>
    api.post<PlantillaV2>('/reportes/v2/plantillas', data),

  actualizarPlantilla: (id: number, data: Partial<PlantillaV2>) =>
    api.patch<PlantillaV2>(`/reportes/v2/plantillas/${id}`, data),

  eliminarPlantilla: (id: number) =>
    api.delete(`/reportes/v2/plantillas/${id}`),

  duplicarPlantilla: (id: number) =>
    api.post<PlantillaV2>(`/reportes/v2/plantillas/${id}/duplicar`, {}),

  preview: (data: { definicion: DefinicionV2; filtrosVars?: any; raiz?: string }) =>
    api.post<{ columnas: any[]; filas: any[]; total: number }>('/reportes/v2/preview', data),

  ejecutar: (id: number, filtrosVars: Record<string, any>) =>
    api.post(`/reportes/v2/plantillas/${id}/ejecutar`, { filtrosVars }, { responseType: 'blob' }),
}
