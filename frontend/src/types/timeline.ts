export type TimelineCanal = 'whatsapp' | 'email' | 'wapi';

export interface TimelineEntry {
    id: string;
    canal: TimelineCanal;
    tipo: string;
    fecha: string;
    detalle: {
        asunto?: string;
        mensaje?: string;
        templateNombre?: string;
        estado: string;
        error?: string;
        urlDestino?: string;
    };
    campaniaId: number | null;
    campaniaNombre: string | null;
    contactoId: number;
}

export interface TimelineDeudorRef {
    id: number;
    idDeudor: number | null;
    nombre: string | null;
    documento: string | null;
    empresa: string | null;
    nroEmpresa: string | null;
}

export interface TimelineResponse {
    deudor: TimelineDeudorRef | null;
    data: TimelineEntry[];
    total: number;
    page: number;
    size: number;
    totalPages: number;
}

export interface TimelineQuery {
    page?: number;
    size?: number;
    canal?: TimelineCanal;
    desde?: string;
    hasta?: string;
}
