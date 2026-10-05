// Funciones puras del estado de una carga (docs/imports-progreso-realtime-spec.md §8.3 y §8.5).
// Las usan las tres lecturas HTTP y el `ProgresoTracker`: HTTP y socket arman el DTO con el mismo código.
import type { import_progreso } from '@prisma/client';
import type { EstadoCargaDto, EstadoProcesoRemesa, ResultadoCarga } from './estado-carga.types';

/** Máximo de caracteres del motivo que se persiste en `import_progreso.error`. */
export const MAX_ERROR_PERSISTIDO = 4000;
/** `notificacion.mensaje` es VarChar(1000): el texto nunca puede pasarse. */
const MAX_MENSAJE_NOTIFICACION = 1000;
/** Largo máximo de la "primera línea del motivo" que viaja en la notificación. */
const MAX_PRIMERA_LINEA = 300;

/** Lo que se necesita de la remesa para armar el estado (subconjunto de lo que devuelve Prisma). */
export interface RemesaParaEstado {
    id: number;
    numeroRemesa: string;
    nombre: string;
    empresaId: number;
    categoria: string | null;
    usuarioCreadorId: number | null;
    usuarioCreador?: { id: number; nombre: string } | null;
    estadoProceso: string;
    totalFilas: number;
    okFilas: number;
    errFilas: number;
}

export function esEstadoTerminal(estadoProceso: string): boolean {
    return estadoProceso === 'FINALIZADA' || estadoProceso === 'FALLIDA';
}

/**
 * Porcentaje 0-100 de una carga. La misma para todas las categorías.
 *   - terminó FINALIZADA          → 100
 *   - total esperado <= 0         → 0 (la UI muestra barra indeterminada)
 *   - si no                       → min(99, floor(procesadas * 100 / total))
 * Nunca devuelve NaN ni 100 antes del estado terminal. Una FALLIDA conserva el último valor.
 */
export function calcularPorcentaje(
    procesadas: number,
    totalEsperado: number,
    terminal: 'FINALIZADA' | 'FALLIDA' | null = null,
): number {
    if (terminal === 'FINALIZADA') return 100;
    if (!Number.isFinite(totalEsperado) || totalEsperado <= 0) return 0;
    if (!Number.isFinite(procesadas) || procesadas <= 0) return 0;
    return Math.max(0, Math.min(99, Math.floor((procesadas * 100) / totalEsperado)));
}

export interface EntradaClasificacion {
    /** Hubo una excepción en cualquier punto del job. */
    huboExcepcion: boolean;
    /** El post-proceso (`afterAll`) tiró. */
    postProcesoFallo: boolean;
    procesadas: number;
    err: number;
}

/** Cómo terminó la carga. Gana la primera condición que se cumple (§8.3). */
export function clasificarResultado(e: EntradaClasificacion): ResultadoCarga {
    if (e.huboExcepcion) return 'FALLIDA';
    if (e.postProcesoFallo) return 'CON_ADVERTENCIAS';
    if (e.procesadas === 0) return 'SIN_FILAS';
    if (e.err > 0) return 'CON_ERRORES';
    return 'OK';
}

function iso(d: Date | null | undefined): string | null {
    return d ? d.toISOString() : null;
}

function resultadoHeredada(r: RemesaParaEstado): ResultadoCarga {
    if (r.totalFilas === 0) return 'SIN_FILAS';
    if (r.errFilas > 0) return 'CON_ERRORES';
    return 'OK';
}

/**
 * Arma el `EstadoCargaDto` de una remesa. Con `fila = null` sintetiza el estado de una remesa
 * heredada (sin fila de progreso) a partir de lo que tiene `remesa`: sin duración, sin motivo.
 */
export function armarEstadoCarga(
    r: RemesaParaEstado,
    fila: import_progreso | null,
    ahora: Date = new Date(),
): EstadoCargaDto {
    const estadoProceso = r.estadoProceso as EstadoProcesoRemesa;
    const terminal = esEstadoTerminal(estadoProceso);
    const base = {
        remesaId: r.id,
        numeroRemesa: r.numeroRemesa,
        nombre: r.nombre,
        empresaId: r.empresaId,
        tipo: r.categoria ?? '',
        usuarioId: r.usuarioCreadorId ?? r.usuarioCreador?.id ?? null,
        usuarioNombre: r.usuarioCreador?.nombre ?? 'Sistema',
        estadoProceso,
        terminal,
    };

    if (!fila) {
        const procesando = estadoProceso === 'PROCESANDO';
        // Una FALLIDA anterior a la fila de progreso no afirma filas procesadas: sus `okFilas`/`errFilas`
        // pueden ser los de la muestra de la vista previa (el fallo viejo no los tocaba).
        const contadoresReales = procesando || estadoProceso === 'FINALIZADA';
        const ok = contadoresReales ? r.okFilas : 0;
        const err = contadoresReales ? r.errFilas : 0;
        const procesadas = ok + err;
        const resultado: ResultadoCarga | null =
            estadoProceso === 'FINALIZADA' ? resultadoHeredada(r) : estadoProceso === 'FALLIDA' ? 'FALLIDA' : null;
        const progreso =
            estadoProceso === 'FINALIZADA' ? 100
            : estadoProceso === 'FALLIDA' ? 0
            : procesando ? calcularPorcentaje(procesadas, r.totalFilas)
            : 0;
        return {
            ...base,
            servidorAhora: ahora.toISOString(),
            rev: 0,
            fase: terminal ? 'TERMINADA' : procesando ? 'PROCESANDO' : 'BORRADOR',
            subfase: null,
            enCurso: procesando,
            resultado,
            progreso,
            totalEsperado: r.totalFilas,
            procesadas,
            ok,
            err,
            descartadas: 0,
            advertencias: 0,
            nuevos: null,
            actualizados: null,
            error: null,
            errorPostProceso: null,
            intentos: 0,
            encoladaAt: null,
            startedAt: null,
            heartbeatAt: null,
            finishedAt: null,
            duracionMs: null,
            okFilas: ok,
            errFilas: err,
            totalFilas: terminal ? procesadas : r.totalFilas,
            durationMs: null,
        };
    }

    const enCurso = fila.encoladaAt != null && fila.finishedAt == null;
    const resultado: ResultadoCarga | null = terminal
        ? ((fila.resultado as ResultadoCarga | null) ??
            (estadoProceso === 'FALLIDA' ? 'FALLIDA' : resultadoHeredada({ ...r, totalFilas: fila.procesadas, errFilas: fila.err })))
        : null;
    const progreso = terminal
        ? estadoProceso === 'FINALIZADA' ? 100 : Math.min(99, fila.porcentaje)
        : Math.min(99, fila.porcentaje);
    const duracionMs =
        fila.finishedAt && fila.startedAt ? Math.max(0, fila.finishedAt.getTime() - fila.startedAt.getTime()) : null;
    return {
        ...base,
        servidorAhora: ahora.toISOString(),
        rev: fila.rev,
        fase: fila.fase,
        subfase: fila.subfase,
        enCurso,
        resultado,
        progreso,
        totalEsperado: fila.totalEsperado,
        procesadas: fila.procesadas,
        ok: fila.ok,
        err: fila.err,
        descartadas: fila.descartadas,
        advertencias: fila.advertencias,
        nuevos: fila.nuevos,
        actualizados: fila.actualizados,
        error: fila.error,
        errorPostProceso: fila.errorPostProceso,
        intentos: fila.intentos,
        encoladaAt: iso(fila.encoladaAt),
        startedAt: iso(fila.startedAt),
        heartbeatAt: iso(fila.heartbeatAt),
        finishedAt: iso(fila.finishedAt),
        duracionMs,
        okFilas: fila.ok,
        errFilas: fila.err,
        totalFilas: terminal ? fila.procesadas : fila.totalEsperado,
        durationMs: duracionMs,
    };
}

/** Primera línea no vacía del mensaje, recortada. Un mensaje vacío da 'Error desconocido'. */
export function primeraLineaDelMotivo(motivo: string | null | undefined, max = MAX_PRIMERA_LINEA): string {
    const linea = (motivo ?? '')
        .split(/\r?\n/)
        .map((l) => l.trim())
        .find((l) => l.length > 0);
    if (!linea) return 'Error desconocido';
    return linea.length > max ? `${linea.slice(0, max - 1).trimEnd()}…` : linea;
}

/** Recorta el motivo completo a lo que entra en `import_progreso.error`. */
export function recortarMotivo(motivo: string | null | undefined): string {
    const m = (motivo ?? '').trim() || 'Error desconocido';
    return m.length > MAX_ERROR_PERSISTIDO ? m.slice(0, MAX_ERROR_PERSISTIDO) : m;
}

/**
 * Motivo legible de una falla, para `import_progreso.error`, `errorPostProceso` y la notificación.
 * Un error de Prisma trae el fragmento de código y rutas del servidor en varias líneas, con el motivo
 * en la última: de esos se toma la última línea no vacía más el código (`P2002`). El resto va como
 * viene. El detalle completo va solo al log, con stack.
 */
export function motivoLegible(error: unknown): string {
    const msg = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
    const code = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
    const nombre = typeof error === 'object' && error !== null ? (error as object).constructor?.name ?? '' : '';
    const esPrisma =
        /^\s*Invalid `[^`]*` invocation/.test(msg) ||
        /^PrismaClient/.test(nombre) ||
        (typeof code === 'string' && /^P\d{4}$/.test(code));
    if (!esPrisma) return recortarMotivo(msg);
    const ultima =
        msg.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0).pop() ?? 'Error de base de datos';
    const conCodigo = typeof code === 'string' && !ultima.includes(code) ? `${ultima} (${code})` : ultima;
    return recortarMotivo(conCodigo);
}

function conPunto(texto: string): string {
    return /[.!?…]$/.test(texto) ? texto : `${texto}.`;
}

export interface TextoNotificacion {
    tipo: 'IMPORTACION_FINALIZADA' | 'IMPORTACION_ERROR';
    titulo: string;
    mensaje: string;
}

/** Título, mensaje y tipo de la notificación según cómo terminó la carga (§8.5.5). */
export function textoNotificacion(e: EstadoCargaDto, opciones: { sinRegistrar?: boolean } = {}): TextoNotificacion {
    let r: TextoNotificacion;
    switch (e.resultado) {
        case 'OK':
            r = {
                tipo: 'IMPORTACION_FINALIZADA',
                titulo: 'Importación finalizada',
                mensaje: `Se procesaron ${e.ok} filas correctamente.`,
            };
            break;
        case 'CON_ERRORES':
            r = e.ok > 0
                ? {
                    tipo: 'IMPORTACION_FINALIZADA',
                    titulo: 'Importación finalizada con errores',
                    mensaje: `Se cargaron ${e.ok} filas y ${e.err} dieron error.`,
                }
                : {
                    tipo: 'IMPORTACION_ERROR',
                    titulo: 'Importación sin filas cargadas',
                    mensaje: `Las ${e.err} filas del archivo dieron error: no se cargó ninguna.`,
                };
            break;
        case 'SIN_FILAS':
            r = {
                tipo: 'IMPORTACION_FINALIZADA',
                titulo: 'Importación sin filas',
                mensaje:
                    'El archivo no tenía filas para procesar.' +
                    (e.descartadas > 0 ? ` El filtro de la plantilla descartó las ${e.descartadas} filas.` : ''),
            };
            break;
        case 'CON_ADVERTENCIAS':
            r = {
                tipo: 'IMPORTACION_FINALIZADA',
                titulo: 'Importación finalizada con advertencias',
                mensaje:
                    `Se cargaron ${e.ok} filas${e.err > 0 ? ` y ${e.err} dieron error` : ''}, ` +
                    `pero el post-proceso no terminó: ${conPunto(primeraLineaDelMotivo(e.errorPostProceso))}`,
            };
            break;
        case 'FALLIDA':
        default:
            r = {
                tipo: 'IMPORTACION_ERROR',
                titulo: 'Importación fallida',
                mensaje:
                    conPunto(primeraLineaDelMotivo(e.error)) +
                    (e.procesadas > 0 ? ` Se habían procesado ${e.procesadas} filas.` : ''),
            };
            break;
    }
    // Si la falla no se pudo persistir, la base todavía dice PROCESANDO: la notificación lo avisa.
    const nota = opciones.sinRegistrar
        ? ' El estado no se pudo registrar: la carga puede figurar todavía en proceso.'
        : '';
    const tope = MAX_MENSAJE_NOTIFICACION - nota.length;
    if (r.mensaje.length > tope) {
        r.mensaje = `${r.mensaje.slice(0, tope - 1)}…`;
    }
    r.mensaje += nota;
    return r;
}
