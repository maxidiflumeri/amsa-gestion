import api from './axios';
import type { EstadoCargaDto } from '../types/importProgreso';

/** Estado de una carga. Liviano a propósito: es lo que consultan los hooks cuando hacen polling. */
export async function obtenerEstadoCarga(remesaId: number): Promise<EstadoCargaDto> {
    const { data } = await api.get<EstadoCargaDto>(`/import/remesas/${remesaId}/progreso`, {
        silencioso: true,
    });
    return data;
}

/** Cargas en curso (encoladas y sin terminar). Sin `importacion.ver_progreso_otros`, solo las propias. */
export async function obtenerCargasEnCurso(): Promise<EstadoCargaDto[]> {
    const { data } = await api.get<EstadoCargaDto[]>('/import/en-curso', { silencioso: true });
    return data;
}
