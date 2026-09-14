import api from './axios';

/**
 * Claves de pago de Telecom/Personal (multiclaves). Fase 1: solo el resumen y la lista de
 * sin-caso de una carga (docs/multiclaves-spec.md §5.7, §9.3). El cupón, la config de empresa y
 * las claves del caso llegan en las fases 2-3.
 */

export interface ResumenLoteMulticlaves {
    tramites: number;
    claves: number;
    vigentes: number;
    reemplazadasEnEsta: number;
    reemplazadasPorEsta: number;
    /** Trámites que esta carga trajo con una única clave (sin la de quita), fase 1.1. */
    soloTotal: number;
    conCaso: number;
    sinCaso: number;
    rechazados: number;
    avisos: Array<{ codigo: string; cantidad: number }>;
}

export interface TramiteSinCaso {
    nroTramite: string;
    /** String, no number: viene de un `Decimal` (spec §4.1), como el resto de los importes de multiclaves. */
    importeTotal: string | null;
    importeQuita: string | null;
    fechaVencimiento: string;
}

export interface SinCasoMulticlaves {
    total: number;
    items: TramiteSinCaso[];
}

/** Vista previa de una carga MULTICLAVES, tal como la devuelve `POST /import/validar/:id`. */
export interface MulticlavesPreview {
    lineas: number;
    /** Claves de trámites aceptados únicamente — no incluye las de trámites que se van a rechazar. */
    claves: number;
    /** Líneas válidas cuyo trámite se rechazó igual (p. ej. IMPORTES_IGUALES). No se cargan. */
    clavesRechazadas: number;
    tramites: number;
    validos: number;
    rechazados: number;
    /** De los válidos, cuántos trajeron una única clave (sin la de quita, fase 1.1). */
    soloTotal: number;
    porMotivo: Record<string, number>;
    conCaso: number;
    sinCaso: number;
    enOtraEmpresa: Array<{ empresaId: number; empresa: string; tramites: number }>;
    yaCargadas: number;
    reemisiones: number;
    tandasAnteriores: number;
    conflictos: number;
    vencimientos: Array<{ fecha: string; claves: number }>;
    avisos: Array<{ codigo: string; cantidad: number; ejemplos: string[] }>;
}

export const multiclavesApi = {
    resumenLote(remesaId: number): Promise<ResumenLoteMulticlaves> {
        return api.get(`/multiclaves/lotes/${remesaId}/resumen`).then((r) => r.data);
    },

    sinCaso(remesaId: number, page = 1, pageSize = 50): Promise<SinCasoMulticlaves> {
        return api
            .get(`/multiclaves/lotes/${remesaId}/sin-caso`, { params: { page, pageSize } })
            .then((r) => r.data);
    },
};
