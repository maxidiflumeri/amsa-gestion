import api from './axios';
import type { EstadoCargaDto } from '../types/importProgreso';
import type { ErroresRespuesta, HistorialRespuesta, TipoErrorDeCarga } from '../types/importHistorial';

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

// ─── Fase C, entrega 1 (docs/imports-progreso-realtime-spec.md §10.4.4) ──────────────────────────────

/** Remesa que el backend no pudo encolar (quedó como borrador). */
export interface RemesaNoEncolada {
    remesaId: number;
    numeroRemesa: string;
}

export interface EjecutarGrupoBody {
    remesaIds: number[];
    remesaOrigenId?: number;
    remesaOrigenIds?: number[];
}

export interface EjecutarGrupoRespuesta {
    message: string;
    grupoId: string;
    /** En orden. */
    cargas: EstadoCargaDto[];
    noEncoladas?: RemesaNoEncolada[];
}

export interface GrupoCargaRespuesta {
    grupoId: string;
    /** `grupoTotal`: puede ser mayor que `remesas.length` si alguna se eliminó. */
    total: number;
    /** Por `grupoOrden`. */
    remesas: EstadoCargaDto[];
}

export type EfectoCancelacion = 'CANCELADA' | 'PEDIDA';

export interface CancelarCargaRespuesta {
    message: string;
    efecto: EfectoCancelacion;
    carga: EstadoCargaDto;
}

export interface CancelarGrupoRespuesta {
    resultados: Array<{
        remesaId: number;
        numeroRemesa: string;
        efecto: EfectoCancelacion | 'YA_TERMINADA' | 'RECHAZADA';
        motivo?: string;
        carga: EstadoCargaDto;
    }>;
}

export interface RetomarRemesaRespuesta {
    message: string;
    remesaId: number;
    carga: EstadoCargaDto;
}

export interface RetomarGrupoRespuesta {
    message: string;
    grupoId: string;
    cargas: EstadoCargaDto[];
    omitidas: Array<{ remesaId: number; numeroRemesa: string; motivo: string }>;
    /** Las que el backend no pudo mandar a la cola (siguen como borrador). */
    noEncoladas?: RemesaNoEncolada[];
}

/** Qué se sabe de un corte de la vista de cortes que ya está cargado (o a medias) en otra remesa. */
export type SituacionCorte = 'CARGADA' | 'EN_CURSO' | 'A_MEDIAS' | 'SIN_CARGAR';

export interface CorteYaCargado {
    remesaId: number;
    numeroRemesa: string;
    situacion: SituacionCorte;
    casos: number;
    retomable: boolean;
}

/** Confirma las N remesas de una carga dividida con un solo pedido; el backend las encola juntas y en orden. */
export async function ejecutarGrupo(body: EjecutarGrupoBody): Promise<EjecutarGrupoRespuesta> {
    const { data } = await api.post<EjecutarGrupoRespuesta>('/import/ejecutar-grupo', body);
    return data;
}

/** Las remesas de una carga dividida, por `grupoOrden`. Consulta de fondo. */
export async function obtenerGrupo(grupoId: string): Promise<GrupoCargaRespuesta> {
    const { data } = await api.get<GrupoCargaRespuesta>(`/import/grupos/${encodeURIComponent(grupoId)}`, {
        silencioso: true,
    });
    return data;
}

export async function cancelarCarga(remesaId: number): Promise<CancelarCargaRespuesta> {
    const { data } = await api.post<CancelarCargaRespuesta>(`/import/remesas/${remesaId}/cancelar`);
    return data;
}

export async function cancelarGrupo(grupoId: string): Promise<CancelarGrupoRespuesta> {
    const { data } = await api.post<CancelarGrupoRespuesta>(`/import/grupos/${encodeURIComponent(grupoId)}/cancelar`);
    return data;
}

export async function retomarRemesa(remesaId: number): Promise<RetomarRemesaRespuesta> {
    const { data } = await api.post<RetomarRemesaRespuesta>(`/import/remesas/${remesaId}/retomar`);
    return data;
}

export async function retomarGrupo(grupoId: string): Promise<RetomarGrupoRespuesta> {
    const { data } = await api.post<RetomarGrupoRespuesta>(`/import/grupos/${encodeURIComponent(grupoId)}/retomar`);
    return data;
}

// ─── Fase C, entrega 2a (docs/imports-progreso-c2-spec.md §4.4) ───────────────────────────────────

export interface HistorialParams {
    empresaId: number;
    page: number;
    pageSize: number;
    /** Busca en número y nombre. */
    q?: string;
}

/** Una página del Historial con el estado real de cada carga. Consulta de fondo: la pantalla muestra su propio error. */
export async function obtenerHistorial(params: HistorialParams, opciones: { silencioso?: boolean } = {}): Promise<HistorialRespuesta> {
    const { empresaId, page, pageSize, q } = params;
    const { data } = await api.get<HistorialRespuesta>('/import/historial', {
        params: { empresaId, page, pageSize, ...(q ? { q } : {}) },
        silencioso: opciones.silencioso ?? false,
    });
    return data;
}

export interface ErroresParams {
    page?: number;
    pageSize?: number;
    tipo?: 'TODOS' | TipoErrorDeCarga;
    orden?: 'asc' | 'desc';
}

/** Una página de los errores de una carga, con los totales de toda la carga. */
export async function obtenerErrores(remesaId: number, params: ErroresParams = {}, opciones: { silencioso?: boolean } = {}): Promise<ErroresRespuesta> {
    const { data } = await api.get<ErroresRespuesta>(`/import/errores/${remesaId}`, {
        params,
        silencioso: opciones.silencioso ?? false,
    });
    return data;
}

/** El CSV de errores y avisos de una carga, con la sesión del usuario (no se abre una pestaña: la API pide el token). */
export async function descargarErroresCsv(remesaId: number, tipo: 'TODOS' | TipoErrorDeCarga = 'TODOS'): Promise<Blob> {
    const { data } = await api.get<Blob>(`/import/errores/${remesaId}/csv`, {
        params: { tipo },
        responseType: 'blob',
        silencioso: true,
    });
    return data;
}

export interface ConfirmarPendientesRespuesta {
    message: string;
    grupoId: string | null;
    cargas: EstadoCargaDto[];
    noEncoladas?: RemesaNoEncolada[];
}

/** Manda a la cola los borradores que ya se habían confirmado y el servidor no pudo encolar, tal como se confirmaron. */
export async function confirmarPendientes(remesaIds: number[]): Promise<ConfirmarPendientesRespuesta> {
    const { data } = await api.post<ConfirmarPendientesRespuesta>('/import/remesas/confirmar-pendientes', { remesaIds });
    return data;
}

/** `rev`: el de la carga que la pantalla le mostró al operador. Si cambió, el servidor responde 409 CAMBIO_DE_ESTADO. */
export async function eliminarRemesa(remesaId: number, rev?: number): Promise<void> {
    await api.delete(`/import/remesas/${remesaId}`, rev != null ? { params: { rev } } : undefined);
}
