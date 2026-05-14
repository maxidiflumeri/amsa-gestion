/**
 * DTOs internos del NeotelHttpClient.
 * Estos tipos reflejan los parámetros que se envían a la API ASMX de Neotel,
 * no los que recibe el controller (esos viven en neotel-api.dto.ts).
 */

export interface NeotelLoginParams {
    device: string;    // extensión SIP, ej. "Externo6001"
    usuario: string;   // ej. "6001"
    clave: string;     // clave en claro — NUNCA loguear
}

export interface NeotelLoginCampanaParams {
    usuario: string;
    campana: number;   // CAMPANA int — usar Login_Campaign2 (sin Ñ)
}

export interface NeotelLogoutCampanaParams {
    usuario: string;
    campaña: number;   // Logout_Campaign acepta Ñ según docs, se URL-encodea
}

export interface NeotelPauseParams {
    usuario: string;
    subtipoDescanso: number;
}

export interface NeotelTiempoAdminParams {
    usuario: string;
    tiempoAdm: boolean;
}

export interface NeotelDialParams {
    usuario: string;
    telefono: string;
}

export interface NeotelTransferParams {
    usuario: string;
    extension: string;
}

export interface NeotelDtmfParams {
    usuario: string;
    digitos: string;
}

export interface NeotelUpdateContactParams {
    crm: string;
    usuario: string;
    base: number;
    idContacto: string;
    data: string;
    subcategoria: number;
    xmlUpdate?: string;
    agenda: boolean;
    fechaAgenda?: string;   // ISO 8601
    usuarioAgenda?: string;
    telAgenda?: string;
}

export interface NeotelCrmShowContactParams {
    usuario: string;
    base: number;
    idContacto: string;
    data?: string;
}

export interface NeotelCloseContactParams {
    base: number;
    idContacto: string;
}

export interface NeotelAddScheduleCallParams {
    usuario: string;
    base: number;
    idContacto: string;
    data?: string;
    telefono: string;
    fechaAgenda: string;  // ISO 8601
}

export interface NeotelEventsParams {
    eventInfo: string;
}

/** Respuesta cruda de Position/Posicion — string libre que se parsea */
export type NeotelPositionRaw = string;
