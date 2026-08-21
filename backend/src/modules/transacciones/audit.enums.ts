export enum AuditModulo {
    GESTION = 'GESTION',
    IMPORT = 'IMPORT',
    REPORTES = 'REPORTES',
    DASHBOARDS = 'DASHBOARDS',
    EMAIL = 'EMAIL',
    ADMIN = 'ADMIN',
    AUTH = 'AUTH',
    SISTEMA = 'SISTEMA',
    TELEFONIA = 'TELEFONIA',
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

    VER_TABLERO = 'VER_TABLERO',
    EXPORTAR_TABLERO = 'EXPORTAR_TABLERO',
    VER_DETALLE = 'VER_DETALLE',

    EMAIL_ENVIADO = 'EMAIL_ENVIADO',
    EMAIL_FALLIDO = 'EMAIL_FALLIDO',
    EMAIL_MAPEO_GUARDADO = 'EMAIL_MAPEO_GUARDADO',
    EMPRESA_SMTP_CAMBIADO = 'EMPRESA_SMTP_CAMBIADO',

    ROL_CAMBIO = 'ROL_CAMBIO',
    USUARIO_ALTA = 'USUARIO_ALTA',
    USUARIO_BAJA = 'USUARIO_BAJA',
    USUARIO_PWD_RESET = 'USUARIO_PWD_RESET',

    TEL_LOGIN = 'TEL_LOGIN',
    TEL_LOGOUT = 'TEL_LOGOUT',
    TEL_CAMPAÑA_ENTER = 'TEL_CAMPAÑA_ENTER',
    TEL_CAMPAÑA_LEAVE = 'TEL_CAMPAÑA_LEAVE',
    TEL_ESTADO_CAMBIAR = 'TEL_ESTADO_CAMBIAR',
    TEL_LLAMADA_INICIAR = 'TEL_LLAMADA_INICIAR',
    TEL_LLAMADA_ATENDER = 'TEL_LLAMADA_ATENDER',
    TEL_LLAMADA_COLGAR = 'TEL_LLAMADA_COLGAR',
    TEL_LLAMADA_TRANSFERIR = 'TEL_LLAMADA_TRANSFERIR',
    TEL_LLAMADA_DTMF = 'TEL_LLAMADA_DTMF',
    TEL_CONTACTO_DISPOSICION = 'TEL_CONTACTO_DISPOSICION',

    // T4 — Credenciales + ABM agentes
    TEL_SIP_CREDENTIALS_OBTENIDAS = 'TEL_SIP_CREDENTIALS_OBTENIDAS',
    TEL_AGENTE_CREADO              = 'TEL_AGENTE_CREADO',
    TEL_AGENTE_ACTUALIZADO         = 'TEL_AGENTE_ACTUALIZADO',
    TEL_AGENTE_ELIMINADO           = 'TEL_AGENTE_ELIMINADO',
    TEL_AGENTE_LISTADO             = 'TEL_AGENTE_LISTADO',
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

/**
 * El match es por **substring** del nombre del campo (ver `redactarCamposSensibles`), así que hay que
 * tener cuidado con lo que se agrega: poner `clave` a secas también taparía `parametro.clave`, que es
 * un código de negocio (`SIT-050`) y no un secreto.
 *
 * `claveNeotel` estaba afuera y el alta/edición de usuario audita `req.body` entero, así que la clave
 * de la API de Neotel quedaba **legible en `transaccion.data`** para cualquiera con
 * `auditoria.ver_todos`.
 */
const CAMPOS_SENSIBLES = [
    'password',
    'passwordHash',
    'claveNeotel',
    'claveSip',
    'token',
    'secret',
    'apiKey',
    'credential',
    'authorization',
];

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
