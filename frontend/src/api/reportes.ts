import api from './axios'
import { Plantilla, NodoCatalogo, Definicion, FormatoTelefono } from '../types/reportes'

export type Estimacion = {
  totalEstimado: number
  modoSugerido: 'sync' | 'async'
  umbral: number
}

export type EncolarRespuesta = {
  ejecucionId: number
  modo: 'async'
  estado: string
}

export type EstadoEjecucion =
  | 'PENDIENTE'
  | 'EJECUTANDO'
  | 'FINALIZADA'
  | 'FALLIDA'
  | 'CANCELADA'

export type Ejecucion = {
  id: number
  plantillaId: number
  usuarioId: number
  empresaId: number | null
  filtrosUsados: Record<string, any>
  totalFilas: number | null
  filasProcesadas: number
  progreso: number
  estado: EstadoEjecucion
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
  estado?: EstadoEjecucion
  plantillaId?: number
  page?: number
  pageSize?: number
}

export type ListarEjecucionesResponse = {
  items: Ejecucion[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

export const reportesApi = {
  catalogo: (raiz = 'deudor', depth = 3) =>
    api.get<NodoCatalogo[]>(`/reportes/catalogo?raiz=${raiz}&depth=${depth}`),

  camposAdicionalesKeys: (empresaId?: number) =>
    api.get<{ keys: string[] }>(
      `/reportes/catalogo/campos-adicionales${empresaId ? `?empresaId=${empresaId}` : ''}`,
    ),

  listarPlantillas: (empresaId?: number) =>
    api.get<Plantilla[]>(
      `/reportes/plantillas${empresaId ? `?empresaId=${empresaId}` : ''}`,
    ),

  obtenerPlantilla: (id: number) =>
    api.get<Plantilla>(`/reportes/plantillas/${id}`),

  crearPlantilla: (data: Omit<Plantilla, 'id'>) =>
    api.post<Plantilla>('/reportes/plantillas', data),

  actualizarPlantilla: (id: number, data: Partial<Plantilla>) =>
    api.patch<Plantilla>(`/reportes/plantillas/${id}`, data),

  eliminarPlantilla: (id: number) =>
    api.delete(`/reportes/plantillas/${id}`),

  duplicarPlantilla: (id: number, data?: { nombre?: string; empresaId?: number | null }) =>
    api.post<Plantilla>(`/reportes/plantillas/${id}/duplicar`, data ?? {}),

  cambiarEmpresaPlantilla: (id: number, empresaId: number | null) =>
    api.post<Plantilla>(`/reportes/plantillas/${id}/cambiar-empresa`, { empresaId }),

  preview: (data: { definicion: Definicion; filtrosVars?: any; raiz?: string }) =>
    api.post<{ columnas: any[]; filas: any[]; total: number }>(
      '/reportes/preview',
      data,
    ),

  estimar: (plantillaId: number, filtrosVars?: Record<string, any>) =>
    api.post<Estimacion>(`/reportes/plantillas/${plantillaId}/estimar`, {
      filtrosVars: filtrosVars || {},
    }),

  ejecutar: (id: number, filtrosVars: Record<string, any>) =>
    api.post(
      `/reportes/plantillas/${id}/ejecutar`,
      { filtrosVars },
      { responseType: 'blob' },
    ),

  listarEjecuciones: (params?: ListarEjecucionesParams) =>
    api.get<ListarEjecucionesResponse>('/reportes/ejecuciones', { params }),

  obtenerEjecucion: (id: number) =>
    api.get<Ejecucion>(`/reportes/ejecuciones/${id}`),

  descargarEjecucion: (id: number) =>
    api.get(`/reportes/ejecuciones/${id}/descargar`, {
      responseType: 'blob',
    }),

  cancelarEjecucion: (id: number) =>
    api.post(`/reportes/ejecuciones/${id}/cancelar`),

  eliminarEjecucion: (id: number) =>
    api.delete(`/reportes/ejecuciones/${id}`),

  formatosTelefono: () =>
    api.get<FormatoTelefono[]>('/reportes/formatos-tel'),

  crearFormatoTelefono: (data: { nombre: string; descripcion?: string; patron: string }) =>
    api.post<FormatoTelefono>('/reportes/formatos-tel', data),
}
