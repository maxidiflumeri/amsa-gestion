/** Constantes de la función `reportes` del asistente (docs/asistente-reportes-spec.md §5, §7.1 y §14.3). */

export const FUNCION_REPORTES = 'reportes';
export const MODELO_REPORTES_DEFAULT = 'us.anthropic.claude-sonnet-5-5';

/** Iteraciones del loop por turno. */
export const MAX_ITERACIONES_REPORTES = 8;
/** `probar_plantilla` por turno. */
export const MAX_PRUEBAS = 4;
/** `valores_de_campo` por turno. */
export const MAX_VALORES = 6;
/** `ver_otra_hoja` por turno. */
export const MAX_HOJAS = 2;
/** Una conversación de reportes se corta a los 12 turnos o a los 100.000 tokens de prompt. */
export const MAX_TURNOS_REPORTES = 12;
export const MAX_PROMPT_REPORTES = 100_000;
/** Tokens estimados (3 caracteres por token) que puede tener el request ANTES de la primera llamada: el tope del turno se verifica después. */
export const MAX_PROMPT_ESTIMADO = 120_000;
/** Tope de salida por llamada: una prueba de 40 columnas mide ~2.000 tokens. */
export const MAX_TOKENS_REPORTES = 16_000;
export const TIMEOUT_REPORTES_MS_DEFAULT = 120_000;

/** Lo que vale la función mientras `asistente_funcion` tenga la columna en null. */
export const DEFAULTS_REPORTES = { topeTurnoUsd: 0.3, limiteDiarioUsuario: 40 } as const;

/** Permisos que pide la función entera: sin poder guardar, armar la propuesta es gastar. */
export const PERMISOS_REPORTES = ['asistente.reportes', 'reportes.ver', 'reportes.crear'] as const;

export const MAX_VALORES_LISTADOS = 40;
export const MAX_CLAVES_ADICIONALES = 60;
export const MAX_MENSAJE_TARJETA = 800;
export const MAX_SUGERENCIAS = 3;
export const MAX_SUGERENCIA_LARGO = 60;

export function leerModeloReportes(env: NodeJS.ProcessEnv = process.env): string {
    return (env.ASISTENTE_MODELO_REPORTES ?? '').trim() || MODELO_REPORTES_DEFAULT;
}

export function leerTimeoutReportes(env: NodeJS.ProcessEnv = process.env): number {
    const raw = (env.ASISTENTE_REPORTES_TIMEOUT_MS ?? '').trim();
    const n = /^\d+$/.test(raw) ? Number(raw) : NaN;
    return Number.isInteger(n) && n >= 10_000 && n <= 600_000 ? n : TIMEOUT_REPORTES_MS_DEFAULT;
}

export const MENSAJE_SIN_PERMISO_FUNCION =
    'Para armar reportes con el asistente hacen falta los permisos «Asistente: armar reportes», «Ver reportes» y «Crear reportes». Pedíselos a un administrador.';

/** Cada función es de una sola conversación: el mensaje dice de cuál es la que se intentó cruzar. */
export function mensajeFuncionDistinta(deLaConversacion: string): string {
    return deLaConversacion === 'reportes'
        ? 'Esta conversación es de «Armar un reporte». Para preguntar algo de ayuda, empezá una nueva en el modo Ayuda.'
        : 'Esta conversación es de ayuda. Empezá una nueva en «Armar un reporte».';
}
