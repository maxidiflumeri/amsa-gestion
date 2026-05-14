import api from './axios';

export type EstadoAgenteManual = 'DISPONIBLE' | 'EN_PAUSA' | 'ADMINISTRATIVO';

export interface SipCredentialsResponse {
    extension: string;
    sipUri: string;
    authUser: string;
    password: string;
    wssUrl: string;
    displayName: string;
}

export interface MotivoPausa {
    id: number;
    codigo: string;
    nombre: string;
    activo: boolean;
}

export interface CampañaNeotel {
    id: number;
    nombre: string;
    activa: boolean;
}

export const neotelApi = {
    getSipCredentials(): Promise<SipCredentialsResponse> {
        return api.get('/neotel/sip-credentials').then((r) => r.data);
    },

    login(): Promise<unknown> {
        return api.post('/neotel/sesion/login').then((r) => r.data);
    },

    logout(): Promise<unknown> {
        return api.post('/neotel/sesion/logout').then((r) => r.data);
    },

    getSesionActual(): Promise<unknown> {
        return api.get('/neotel/sesion/actual').then((r) => r.data);
    },

    setEstado(estado: EstadoAgenteManual, motivoPausaId?: number): Promise<unknown> {
        return api
            .put('/neotel/estado', { estado, motivoPausaId })
            .then((r) => r.data);
    },

    getEstadoActual(): Promise<unknown> {
        return api.get('/neotel/estado/actual').then((r) => r.data);
    },

    listarMotivosPausa(): Promise<MotivoPausa[]> {
        return api.get('/neotel/motivos-pausa').then((r) => r.data);
    },

    listarCampañas(): Promise<CampañaNeotel[]> {
        return api.get('/neotel/campanias').then((r) => r.data);
    },

    asignarCampaña(campañaNeotelId: number): Promise<unknown> {
        return api
            .post('/neotel/campania/asignar', { campañaNeotelId })
            .then((r) => r.data);
    },

    desasignarCampaña(): Promise<unknown> {
        return api.post('/neotel/campania/desasignar').then((r) => r.data);
    },
};
