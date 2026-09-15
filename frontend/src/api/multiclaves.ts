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

// ─── Fase 2: claves del caso y cupón (docs/multiclaves-spec.md §9.1, §9.2) ──────────────────────

export interface ClaveDelCaso {
    id: number;
    tipo: 'TOTAL' | 'QUITA';
    nroConvenio: string;
    /** String: son `Decimal` en el backend (§4.1), nunca se convierten a `number` en el camino. */
    importe: string;
    saldoTramite: string;
    fechaVencimiento: string; // YYYY-MM-DD
    /** DD/MM/AAAA — D12: min(hoy + 7 días corridos AR, fechaVencimiento). */
    vtoImpreso: string;
    vencida: boolean;
    /** Solo los últimos 4 dígitos — el backend nunca manda la clave de 22 ni el código de barras
     * completos por este endpoint (D6): con esos dígitos se arma un cupón cobrable sin convenio. */
    clavePagoUltimos4: string;
    estado: 'VIGENTE' | 'REEMPLAZADA';
    lote: { remesaId: number; numeroRemesa: string; cargadaEn: string };
    convenioActivo: null | { id: number; deudorId: number; esEsteCaso: boolean; createdAt: string };
}

export interface ClavesDelCasoRespuesta {
    nroTramite: string | null;
    claves: ClaveDelCaso[];
    avisos: {
        cuentaCancelada: boolean;
        saldoDistinto: null | { saldoCaso: number; saldoTramite: string };
        otrosCasosDelTramite: Array<{ deudorId: number; numeroRemesa: string; situacion: string | null; enGestion: boolean }>;
        plantillaCuponConfigurada: boolean;
    };
}

export interface PreviewCuponRespuesta {
    clave: {
        id: number;
        tipo: 'TOTAL' | 'QUITA';
        importe: string;
        saldoTramite: string;
        nroConvenio: string;
        fechaVencimiento: string;
        /** Solo los últimos 4 dígitos — mismo criterio que `ClaveDelCaso` (D6). */
        clavePagoUltimos4: string;
        estado: 'VIGENTE' | 'REEMPLAZADA';
    };
    deudor: { nombre: string; nroTramite: string };
    vtoImpreso: string;
    puedeGenerar: boolean;
    avisos: string[];
    convenioActivo: null | { id: number; deudorId: number; esEsteCaso: boolean; createdAt: string };
    otroConvenioActivo: null | { id: number; deudorId: number; tipo: 'TOTAL' | 'QUITA' | null; importe: number };
}

export interface GenerarCuponRespuesta {
    convenioId: number;
    convenioReusado: boolean;
    convenioAnuladoId: number | null;
    gestionCambiada: boolean;
    comentarioId: number;
    envio: null;
    descargaUrl: string;
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

    clavesDelCaso(deudorId: number, incluirReemplazadas = false): Promise<ClavesDelCasoRespuesta> {
        return api
            .get(`/multiclaves/deudores/${deudorId}/claves`, { params: { incluirReemplazadas } })
            .then((r) => r.data);
    },

    previewCupon(claveId: number, deudorId: number): Promise<PreviewCuponRespuesta> {
        return api.get(`/multiclaves/claves/${claveId}/cupon/preview`, { params: { deudorId } }).then((r) => r.data);
    },

    previewCuponPdf(claveId: number, deudorId: number) {
        return api.get(`/multiclaves/claves/${claveId}/cupon/preview.pdf`, {
            params: { deudorId },
            responseType: 'blob',
        });
    },

    generarCupon(
        claveId: number,
        body: { deudorId: number; accion: 'DESCARGAR'; reemplazarConvenioActivo?: boolean; observacion?: string },
    ): Promise<GenerarCuponRespuesta> {
        return api.post(`/multiclaves/claves/${claveId}/cupon`, body).then((r) => r.data);
    },

    descargarCupon(convenioId: number) {
        return api.get(`/multiclaves/convenios/${convenioId}/cupon.pdf`, { responseType: 'blob' });
    },
};
