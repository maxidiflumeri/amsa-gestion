export enum AuditModulo {
    GESTION = 'GESTION',
    IMPORT = 'IMPORT',
    REPORTES = 'REPORTES',
    ADMIN = 'ADMIN',
    AUTH = 'AUTH',
    SISTEMA = 'SISTEMA',
}

export enum AuditTipo {
    CREATE = 'CREATE',
    UPDATE = 'UPDATE',
    DELETE = 'DELETE',
    EJECUTAR = 'EJECUTAR',

    LOGIN_OK = 'LOGIN_OK',
    LOGIN_FAIL = 'LOGIN_FAIL',
    LOGOUT = 'LOGOUT',
    PERMISO_DENEGADO = 'PERMISO_DENEGADO',

    IMPORT_START = 'IMPORT_START',
    IMPORT_OK = 'IMPORT_OK',
    IMPORT_FAIL = 'IMPORT_FAIL',

    REPORTE_EJECUTAR = 'REPORTE_EJECUTAR',
    REPORTE_DESCARGAR = 'REPORTE_DESCARGAR',

    ROL_CAMBIO = 'ROL_CAMBIO',
    USUARIO_ALTA = 'USUARIO_ALTA',
    USUARIO_BAJA = 'USUARIO_BAJA',
    USUARIO_PWD_RESET = 'USUARIO_PWD_RESET',
}

export enum AuditSeveridad {
    INFO = 'INFO',
    WARN = 'WARN',
    ERROR = 'ERROR',
}

export enum AuditEstado {
    OK = 'OK',
    FALLIDO = 'FALLIDO',
}

export type AuditData = {
    before?: Record<string, any>;
    after?: Record<string, any>;
    params?: Record<string, any>;
    contexto?: Record<string, any>;
    [k: string]: any;
};

const CAMPOS_SENSIBLES = ['password', 'passwordHash', 'token', 'secret', 'apiKey', 'authorization'];

export function redactarCamposSensibles<T = any>(obj: T): T {
    if (obj === null || obj === undefined) return obj;
    if (Array.isArray(obj)) return obj.map(redactarCamposSensibles) as any;
    if (typeof obj !== 'object') return obj;
    const result: any = {};
    for (const [k, v] of Object.entries(obj as any)) {
        if (CAMPOS_SENSIBLES.some(s => k.toLowerCase().includes(s.toLowerCase()))) {
            result[k] = '[REDACTED]';
        } else if (v && typeof v === 'object') {
            result[k] = redactarCamposSensibles(v);
        } else {
            result[k] = v;
        }
    }
    return result;
}
