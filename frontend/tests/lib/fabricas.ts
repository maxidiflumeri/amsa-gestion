import type { EstadoCargaDto } from '@fe/types/importProgreso';
import type { ErrorDeCargaDto, GrupoHistorialDto, HistorialItemDto } from '@fe/types/importHistorial';

// Fábricas de EstadoCargaDto, HistorialItemDto y ErrorDeCargaDto. `dtoFaseA` tiene EXACTAMENTE la forma de §8.4.1 (sin los campos de la Fase B);
// `dtoFaseB` agrega los de §9.4.1 respetando el contrato (descartadasPorFiltro = descartadas − fueraDeCorte).
/** Lo que una fábrica acepta para pisar el DTO: campos del contrato o, a propósito, cualquier otro (un backend viejo o uno raro). */
export type Sobre = Partial<EstadoCargaDto> | Record<string, unknown>;

export const T0 = Date.parse('2026-10-09T14:00:00.000Z');
export const iso = (ms: number) => new Date(ms).toISOString();

export function dtoFaseA(over: Sobre = {}): EstadoCargaDto {
    const base = {
        remesaId: 141, rev: 5, numeroRemesa: '00141', nombre: 'Telecom septiembre', empresaId: 10,
        tipo: 'DEUDORES', usuarioId: 3, usuarioNombre: 'Maxi',
        estadoProceso: 'PROCESANDO', fase: 'PROCESANDO', subfase: null,
        enCurso: true, terminal: false, resultado: null,
        progreso: 20, totalEsperado: 14466, procesadas: 3000, ok: 2990, err: 10,
        descartadas: 0, advertencias: 0, nuevos: null, actualizados: null,
        error: null, errorPostProceso: null, intentos: 1,
        encoladaAt: iso(T0 - 100_000), startedAt: iso(T0 - 90_000), heartbeatAt: iso(T0 - 1_000),
        finishedAt: null, duracionMs: null, servidorAhora: iso(T0),
    };
    const d: Record<string, unknown> = { ...base, ...over };
    d.okFilas = d.ok; d.errFilas = d.err; d.totalFilas = d.terminal ? d.procesadas : d.totalEsperado; d.durationMs = d.duracionMs;
    // Las fábricas de las fases A y B devuelven a propósito un DTO con los campos de esa fase y no más: el cliente tiene que tolerar los que faltan.
    return d as unknown as EstadoCargaDto;
}

/** El DTO sin los campos que se nombran (un backend anterior no los manda). */
export function sin(dto: EstadoCargaDto, ...campos: Array<keyof EstadoCargaDto>): EstadoCargaDto {
    const copia: Partial<EstadoCargaDto> = { ...dto };
    for (const c of campos) delete copia[c];
    // El tipo sigue diciendo que está completo a propósito: es lo que el cliente recibe de un backend que no manda el campo.
    return copia as EstadoCargaDto;
}

export function dtoFaseB(over: Sobre = {}): EstadoCargaDto {
    const d = dtoFaseA({ fueraDeCorte: null, enColaDelante: null, velocidad: null, etaSegundos: null, ...over });
    if (!('descartadasPorFiltro' in over)) d.descartadasPorFiltro = Math.max(0, d.descartadas - (d.fueraDeCorte ?? 0));
    return d;
}

/** Una carga terminada. */
export function terminal(resultado: string, over: Sobre = {}, fabrica = dtoFaseB): EstadoCargaDto {
    return fabrica({
        estadoProceso: resultado === 'FALLIDA' ? 'FALLIDA' : 'FINALIZADA', fase: 'TERMINADA', enCurso: false, terminal: true,
        resultado, progreso: 100, finishedAt: iso(T0), duracionMs: 90_000, ...over,
    });
}

/** Lo que nunca puede aparecer en un texto de pantalla. */
export const BASURA = /NaN|undefined|null|Infinity|\[object/;

/** Textos de pantalla que la segunda pasada fijó (el spec se actualiza al cerrar): los dictó quien orquesta. */
export const TXT = {
    sinSenal: (n: number) => `El servidor no da señales de esta carga hace ${n} min. Si no se recupera, en unos minutos se marca sola como fallida y vas a poder hacer otras importaciones; el motivo va a decir qué hacer con esta.`,
    sinSenalLarga: (n: number) => `El servidor no da señales de esta carga hace ${n} min y todavía no se marcó como fallida. Avisá a soporte.`,
    sinSenalHeredada: (n: number) => `El servidor no da señales de esta carga hace ${n} min. Puede estar en un paso largo o haberse interrumpido. Es una carga anterior al seguimiento automático y no se va a marcar como fallida sola: avisá a soporte.`,
    antesDelCorte: (ok: string, err?: string) => `Antes del corte se cargaron al menos ${ok} filas${err ? ` y ${err} dieron error` : ''}; el cierre de la carga no corrió.`,
};

const PRIMERA = 'La importación se interrumpió: el servidor se reinició o dejó de responder mientras la procesaba.';
const QUE_HACER = 'Lo procesado hasta el corte quedó cargado en esta remesa. Eliminá esta importación desde el Historial (se puede mientras sus casos no tengan gestión) y volvé a cargar el archivo.';
/** Como lo arma el backend en esta ronda: la primera oración y el "qué hacer" separados por una línea en blanco. */
export const MOTIVO_CON_SALTO = `${PRIMERA}\n\n${QUE_HACER}`;

/** Texto de §9.5.5 para una carga interrumpida de DEUDORES, en un solo párrafo (4 oraciones, ~330 caracteres). */
export const MOTIVO_INTERRUPCION =
    'La importación se interrumpió: el servidor se reinició o dejó de responder mientras la procesaba. ' +
    'Lo procesado hasta el corte quedó cargado en esta remesa. Eliminá esta importación desde el Historial ' +
    '(se puede mientras sus casos no tengan gestión) y volvé a cargar el archivo.';

// ─── Fase C, entrega 1 (§10.4.2) ─────────────────────────────────────────────────────────────────────
/** DTO con los ocho campos de C1. `cancelable` se calcula como §10.4.1 salvo que se dicte. */
export function dtoC1(over: Sobre = {}): EstadoCargaDto {
    const d = dtoFaseB({
        grupoId: null, grupoOrden: null, grupoTotal: null,
        cancelacionPedidaAt: null, cancelada: false, canceladaPor: null, retomable: false, corteRepetidoEn: null, ...over,
    });
    if (!('cancelable' in over)) {
        d.cancelable = d.enCurso === true && d.cancelacionPedidaAt == null && d.fase !== 'POST_PROCESO'
            && !(d.tipo === 'ACCIONES' && d.startedAt != null);
    }
    return d;
}
export function terminalC1(resultado: string, over: Sobre = {}): EstadoCargaDto {
    return terminal(resultado, over, dtoC1);
}
/** Cancelada: viaja como FALLIDA + cancelada:true, con el texto de §10.5.8 en `error`. */
export function canceladaC1(over: Sobre = {}): EstadoCargaDto {
    return terminalC1('FALLIDA', { cancelada: true, canceladaPor: 'Maxi', cancelacionPedidaAt: iso(T0 - 5_000), error: TXT_CANCELADA_DEUDORES, progreso: 20, procesadas: 3000, ok: 2990, err: 10, ...over });
}
export const TXT_CANCELADA_DEUDORES =
    'La importación fue cancelada por Maxi cuando llevaba 3.000 de 14.466 filas.\n\n' +
    'Las 2.990 filas ya procesadas (10 dieron error) quedaron cargadas en esta remesa y el cierre de la carga no corrió. Para cargarla completa, eliminá esta importación desde el Historial y volvé a subir el archivo. Si no se puede eliminar (porque algún caso ya tiene gestión o porque la remesa es muy grande), avisá a soporte antes de volver a subirlo.';
export const TXT_CANCELADA_SIN_ARRANCAR =
    'La importación fue cancelada por Maxi antes de empezar.\n\nNo se cargó ninguna fila. Para cargarla, usá «Retomar» en el detalle de la importación: no hace falta volver a subir el archivo.';
export const enColaC1 = (over: Sobre = {}) =>
    dtoC1({ fase: 'EN_COLA', estadoProceso: 'PENDIENTE', rev: 2, startedAt: null, heartbeatAt: null, procesadas: 0, ok: 0, err: 0, progreso: 0, enColaDelante: 0, encoladaAt: iso(Date.now()), servidorAhora: iso(Date.now()), ...over });

// ─── Fase C, entrega 2a: Historial y errores de una carga (§4.2 y §4.3 del diseño) ───────────────────
/** Una fila del Historial. `carga` se arma con `dtoC1` (ya con `corteRepetidoEn`). */
export function itemHistorial(over: Partial<HistorialItemDto> = {}, carga: Sobre = {}): HistorialItemDto {
    const c = dtoC1(carga);
    return {
        id: c.remesaId, numeroRemesa: c.numeroRemesa, nombre: c.nombre, categoria: c.tipo, createdAt: iso(T0 - 200_000),
        plantilla: { id: 7, nombre: 'Telecom deudores' }, politicaId: null, accionRevertidaEn: null, archivos: null, corte: null,
        carga: c, pendienteDeEncolar: null, ...over,
    };
}

export function grupoHistorial(over: Partial<GrupoHistorialDto> = {}): GrupoHistorialDto {
    return { grupoId: 'g-7', total: 3, existentes: 3, enCurso: 0, cancelables: 0, retomables: 0, finalizadas: 3, noCargadas: 0, usuarioId: 3, ...over };
}

export function errorDeCarga(over: Partial<ErrorDeCargaDto> = {}): ErrorDeCargaDto {
    return { id: 1, rowNumber: 0, tipo: 'FILA', fila: 1, errorMsg: 'DNI inválido', rawRow: { dni: 'x' }, createdAt: iso(T0), ...over };
}
