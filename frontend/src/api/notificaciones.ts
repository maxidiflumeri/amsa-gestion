import api from './axios';

export interface NotificacionDto {
    id: number;
    tipo: string;
    titulo: string;
    mensaje: string;
    payload?: Record<string, unknown> | null;
    rutaAccion?: string | null;
    leida: boolean;
    creadoEn: string;
}

export interface ContadorDto {
    noLeidas: number;
}

export interface ImportEnCursoDto {
    remesaId: number;
    tipo: string;
    totalFilas: number;
    progreso: number;
    okFilas: number;
    errFilas: number;
    estadoProceso: string;
    usuarioId: number;
    usuarioNombre: string;
    startedAt: string;
}

export interface ListarNotificacionesParams {
    soloNoLeidas?: boolean;
    soloLeidas?: boolean;
    limit?: number;
    offset?: number;
}

export interface ListarNotificacionesResp {
    data: NotificacionDto[];
    total: number;
    limit: number;
    offset: number;
}

export async function listarNotificaciones(
    params?: ListarNotificacionesParams,
): Promise<ListarNotificacionesResp> {
    const { data } = await api.get<ListarNotificacionesResp>('/notificaciones', { params });
    return data;
}

export async function obtenerContador(): Promise<ContadorDto> {
    const { data } = await api.get<ContadorDto>('/notificaciones/contador');
    return data;
}

export async function marcarLeida(id: number): Promise<void> {
    await api.post(`/notificaciones/${id}/leer`);
}

export async function marcarTodas(): Promise<void> {
    await api.post('/notificaciones/leer-todas');
}

export async function obtenerImportsEnCurso(): Promise<ImportEnCursoDto[]> {
    const { data } = await api.get<ImportEnCursoDto[]>('/import/en-curso');
    return data;
}
