import api from './axios'
import { PlantillaV2, NodoCatalogo, DefinicionV2 } from '../types/reportes-v2'

export type EstimacionV2 = {
  totalEstimado: number
  modoSugerido: 'sync' | 'async'
  umbral: number
}

export type EncolarRespuestaV2 = {
  ejecucionId: number
  modo: 'async'
  estado: string
}

export type EstadoEjecucionV2 =
  | 'PENDIENTE'
  | 'EJECUTANDO'
  | 'FINALIZADA'
  | 'FALLIDA'
  | 'CANCELADA'

export type EjecucionV2 = {
  id: number
  plantillaId: number
  usuarioId: number
  empresaId: number | null
  filtrosUsados: Record<string, any>
  totalFilas: number | null
  filasProcesadas: number
  progreso: number
  estado: EstadoEjecucionV2
  modo: 'SYNC' | 'ASYNC'
  formato: string | null
  archivoPath: string | null
  archivoTamano: number | null
  errorMsg: string | null
  cancelado: boolean
  duracionMs: number | null
  jobId: string | null
  createdAt: string
  iniciadoEn: string | null
  finishedAt: string | null
  plantilla?: { id: number; nombre: string; formatoSalida: string }
}

export type ListarEjecucionesParams = {
  estado?: EstadoEjecucionV2
  plantillaId?: number
  page?: number
  pageSize?: number
}

export type ListarEjecucionesResponse = {
  items: EjecucionV2[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

export const reportesV2Api = {
  catalogo: (raiz = 'deudor', depth = 3) =>
    api.get<NodoCatalogo[]>(`/reportes/v2/catalogo?raiz=${raiz}&depth=${depth}`),

  listarPlantillas: (empresaId?: number) =>
    api.get<PlantillaV2[]>(
      `/reportes/v2/plantillas${empresaId ? `?empresaId=${empresaId}` : ''}`,
    ),

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
    api.post<{ columnas: any[]; filas: any[]; total: number }>(
      '/reportes/v2/preview',
      data,
    ),

  estimar: (plantillaId: number, filtrosVars?: Record<string, any>) =>
    api.post<EstimacionV2>(`/reportes/v2/plantillas/${plantillaId}/estimar`, {
      filtrosVars: filtrosVars || {},
    }),

  ejecutar: (id: number, filtrosVars: Record<string, any>) =>
    api.post(
      `/reportes/v2/plantillas/${id}/ejecutar`,
      { filtrosVars },
      { responseType: 'blob' },
    ),

  listarEjecuciones: (params?: ListarEjecucionesParams) =>
    api.get<ListarEjecucionesResponse>('/reportes/v2/ejecuciones', { params }),

  obtenerEjecucion: (id: number) =>
    api.get<EjecucionV2>(`/reportes/v2/ejecuciones/${id}`),

  descargarEjecucion: (id: number) =>
    api.get(`/reportes/v2/ejecuciones/${id}/descargar`, {
      responseType: 'blob',
    }),

  cancelarEjecucion: (id: number) =>
    api.post(`/reportes/v2/ejecuciones/${id}/cancelar`),

  eliminarEjecucion: (id: number) =>
    api.delete(`/reportes/v2/ejecuciones/${id}`),
}
