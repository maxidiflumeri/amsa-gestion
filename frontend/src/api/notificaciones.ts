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

/** Solo la usan las consultas de fondo (hidratación, verificación de sesión): va silenciosa. */
export async function obtenerContador(): Promise<ContadorDto> {
    const { data } = await api.get<ContadorDto>('/notificaciones/contador', { silencioso: true });
    return data;
}

export async function marcarLeida(id: number): Promise<void> {
    await api.post(`/notificaciones/${id}/leer`);
}

export async function marcarTodas(): Promise<void> {
    await api.post('/notificaciones/leer-todas');
}
