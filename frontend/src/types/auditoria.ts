export type AuditModulo = 'GESTION' | 'IMPORT' | 'REPORTES' | 'ADMIN' | 'AUTH' | 'SISTEMA';
export type AuditSeveridad = 'INFO' | 'WARN' | 'ERROR';
export type AuditEstado = 'OK' | 'FALLIDO';

export interface TransaccionUsuario {
    id: number;
    nombre: string;
    email: string;
    avatarUrl?: string | null;
}

export interface TransaccionEmpresa {
    id: number;
    nombre: string;
}

export interface TransaccionDeudor {
    id: number;
    documento: string;
    nombre: string;
    apellido: string;
}

export interface Transaccion {
    id: number;
    createdAt: string;
    usuarioId: number | null;
    empresaId: number | null;
    modulo: string;
    entidad: string;
    entidadId: string | null;
    tipo: string;
    severidad: AuditSeveridad;
    estado: AuditEstado;
    deudorId: number | null;
    recursoTexto: string | null;
    resumen: string | null;
    data: Record<string, any> | null;
    ip: string | null;
    userAgent: string | null;
    usuario?: TransaccionUsuario | null;
    empresa?: TransaccionEmpresa | null;
    deudor?: TransaccionDeudor | null;
}

export interface TransaccionesListado {
    total: number;
    items: Transaccion[];
}

export interface AuditoriaStats {
    totales: { hoy: number; semana: number; mes: number };
    porModulo: { modulo: string; count: number }[];
    porTipo: { tipo: string; count: number }[];
    porUsuario: { usuarioId: number | null; nombre: string | null; count: number }[];
    fallidos: { ultimas24h: number };
    seriePorDia: { fecha: string; count: number }[];
}

export interface QueryAuditoria {
    desde?: string;
    hasta?: string;
    modulo?: string;
    entidad?: string;
    entidadId?: string;
    tipo?: string;
    severidad?: string;
    estado?: string;
    usuarioId?: number;
    empresaId?: number;
    deudorId?: number;
    q?: string;
    limit?: number;
    offset?: number;
    orderDir?: 'asc' | 'desc';
}
