// Funciones puras del estado de una carga (docs/imports-progreso-realtime-spec.md §8.3 y §8.5).
// Las usan las tres lecturas HTTP y el `ProgresoTracker`: HTTP y socket arman el DTO con el mismo código.
import type { import_progreso } from '@prisma/client';
import type { EstadoCargaDto, EstadoProcesoRemesa, ResultadoCarga, ResumenCarga } from './estado-carga.types';

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

/** Lo que no está en la fila de progreso y se calcula aparte (§9.5.9). */
export interface ExtrasEstado {
    /** Cargas en curso confirmadas antes que esta. Solo se usa si la fase es EN_COLA. */
    enColaDelante?: number | null;
}

/** Separador de miles propio (sin `toLocaleString`: no se depende del ICU del contenedor). */
export function conPuntoDeMiles(n: number): string {
    const entero = Math.max(0, Math.floor(n));
    return String(entero).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/** Una ETA de más de esto no informa nada. */
const MAX_ETA_SEGUNDOS = 172_800;
/** Antes de tantos segundos de proceso no hay base para estimar la velocidad. */
const MIN_SEGUNDOS_PARA_RITMO = 5;

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

/**
 * Velocidad (filas/s, un decimal) y ETA de las FILAS (no incluye el post-proceso). Promedio desde que
 * arrancó: sale de un solo DTO, así que funciona apenas se recarga la página. Nunca NaN ni Infinity.
 */
export function calcularRitmo(
    fase: string,
    terminal: boolean,
    startedAt: Date | null,
    procesadas: number,
    totalEsperado: number,
    ahora: Date,
): { velocidad: number | null; etaSegundos: number | null } {
    const nulo = { velocidad: null, etaSegundos: null };
    if (fase !== 'PROCESANDO' || terminal || !startedAt) return nulo;
    const transcurrido = (ahora.getTime() - startedAt.getTime()) / 1000;
    if (!Number.isFinite(transcurrido) || transcurrido < MIN_SEGUNDOS_PARA_RITMO) return nulo;
    if (!Number.isFinite(procesadas) || procesadas <= 0) return nulo;
    const velocidad = Math.max(0.1, Math.round((procesadas / transcurrido) * 10) / 10);
    let etaSegundos: number | null = null;
    if (Number.isFinite(totalEsperado) && totalEsperado > procesadas) {
        const eta = Math.ceil(((totalEsperado - procesadas) * transcurrido) / procesadas);
        etaSegundos = Number.isFinite(eta) && eta <= MAX_ETA_SEGUNDOS ? eta : null;
    }
    return { velocidad, etaSegundos };
}

function iso(d: Date | null | undefined): string | null {
    return d ? d.toISOString() : null;
}

/** Valor de `import_progreso.resultado` de una carga cancelada. En el DTO viaja como `FALLIDA` + `cancelada: true` (§10.4.2). */
export const RESULTADO_CANCELADA = 'CANCELADA';

/**
 * Lee `import_progreso.resumen`. Acepta el objeto o su texto JSON (`$queryRaw` y Prisma no tienen por qué
 * devolver la misma forma) y nunca tira: algo ilegible, o que no es un objeto, es `null`.
 */
export function leerResumen(raw: unknown): ResumenCarga | null {
    let valor = raw;
    if (typeof valor === 'string') {
        try {
            valor = JSON.parse(valor);
        } catch {
            return null;
        }
    }
    if (valor === null || typeof valor !== 'object' || Array.isArray(valor)) return null;
    return valor as ResumenCarga;
}

/**
 * Retomable ⟺ la remesa está FALLIDA, terminó, su `resumen` es de la versión 1 con `origen`, y nunca arrancó o
 * el runner vivo marcó que no le entregó ninguna fila a un processor (§10.4.1). Los contadores no prueban nada.
 */
export function esRetomable(
    estadoProceso: string,
    fila: { finishedAt?: Date | null; startedAt?: Date | null; resumen?: unknown } | null,
): boolean {
    if (!fila || estadoProceso !== 'FALLIDA' || !fila.finishedAt) return false;
    const resumen = leerResumen(fila.resumen);
    if (!resumen || resumen.v !== 1 || !resumen.origen || typeof resumen.origen !== 'object') return false;
    return !fila.startedAt || resumen.sinFilasEntregadas === true;
}

/** Cancelable ⟺ está en curso, nadie pidió cancelar, no está en post-proceso y no es una ACCIONES que ya arrancó (§10.4.1). */
export function esCancelable(
    categoria: string | null | undefined,
    fila: { fase: string; encoladaAt?: Date | null; finishedAt?: Date | null; startedAt?: Date | null; cancelSolicitadaAt?: Date | null },
): boolean {
    const enCurso = fila.encoladaAt != null && fila.finishedAt == null;
    if (!enCurso || fila.cancelSolicitadaAt != null || fila.fase === 'POST_PROCESO') return false;
    return !(categoria === 'ACCIONES' && fila.startedAt != null);
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
    extras: ExtrasEstado = {},
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
            fueraDeCorte: null,
            descartadasPorFiltro: 0,
            advertencias: 0,
            nuevos: null,
            actualizados: null,
            enColaDelante: null,
            velocidad: null,
            etaSegundos: null,
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
            grupoId: null,
            grupoOrden: null,
            grupoTotal: null,
            cancelacionPedidaAt: null,
            cancelada: false,
            canceladaPor: null,
            cancelable: false,
            retomable: false,
        };
    }

    const enCurso = fila.encoladaAt != null && fila.finishedAt == null;
    // La columna guarda `CANCELADA` (la verdad, consultable por SQL); el DTO la traduce a `FALLIDA` + `cancelada`:
    // una pestaña que no conoce el campo la muestra como fallida con el motivo, que es cierto (§10.4.2).
    const cancelada = terminal && fila.resultado === RESULTADO_CANCELADA;
    const resultado: ResultadoCarga | null = terminal
        ? cancelada
            ? 'FALLIDA'
            : ((fila.resultado as ResultadoCarga | null) ??
                (estadoProceso === 'FALLIDA' ? 'FALLIDA' : resultadoHeredada({ ...r, totalFilas: fila.procesadas, errFilas: fila.err })))
        : null;
    const resumen = leerResumen(fila.resumen);
    const progreso = terminal
        ? estadoProceso === 'FINALIZADA' ? 100 : Math.min(99, fila.porcentaje)
        : Math.min(99, fila.porcentaje);
    const fueraDeCorte = fila.fueraDeCorte ?? null;
    const ritmo = calcularRitmo(fila.fase, terminal, fila.startedAt, fila.procesadas, fila.totalEsperado, ahora);
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
        fueraDeCorte,
        descartadasPorFiltro: Math.max(0, fila.descartadas - (fueraDeCorte ?? 0)),
        advertencias: fila.advertencias,
        nuevos: fila.nuevos ?? null,
        actualizados: fila.actualizados ?? null,
        enColaDelante: fila.fase === 'EN_COLA' && !terminal ? (extras.enColaDelante ?? null) : null,
        velocidad: ritmo.velocidad,
        etaSegundos: ritmo.etaSegundos,
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
        grupoId: fila.grupoId ?? null,
        grupoOrden: fila.grupoOrden ?? null,
        grupoTotal: fila.grupoTotal ?? null,
        cancelacionPedidaAt: iso(fila.cancelSolicitadaAt),
        cancelada,
        canceladaPor: typeof resumen?.cancelacion?.nombre === 'string' ? resumen.cancelacion.nombre : null,
        cancelable: esCancelable(r.categoria, fila),
        retomable: esRetomable(estadoProceso, fila),
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
    // Errores de conexión / transacción de Prisma: el texto original ("Transaction API error: Unable to start a
    // transaction in the given time.") no le dice nada a un operador.
    if (code === 'P2010' && /1205|lock wait timeout/i.test(msg)) return 'La base de datos tardó demasiado en liberar un bloqueo (1205).';
    if (code === 'P2028') return 'La base de datos no respondió a tiempo (P2028).';
    if (code === 'P1017') return 'La base de datos cerró la conexión (P1017).';
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

/** `SIN_FILAS`: separa lo que tiró el filtro de la plantilla de lo que es de otros cortes (§9.8.2). */
function mensajeSinFilas(e: EstadoCargaDto): string {
    // Se deriva de `descartadas` y `fueraDeCorte` (que es exactamente como el backend arma
    // `descartadasPorFiltro`) y no se lee el campo: un DTO armado a mano a partir de uno heredado, que
    // trae `descartadasPorFiltro: 0`, tiene que dar el mismo texto que antes (estado-carga.spec.ts).
    const deOtroCorte = e.fueraDeCorte ?? 0;
    const porFiltro = Math.max(0, e.descartadas - deOtroCorte);
    return (
        'El archivo no tenía filas para procesar.' +
        (porFiltro > 0 ? ` El filtro de la plantilla descartó las ${porFiltro} filas.` : '') +
        (deOtroCorte > 0 ? ` ${deOtroCorte} filas son de otros cortes de la división.` : '')
    );
}

export type MotivoInterrupcion = 'SIN_LATIDO' | 'SIN_JOB' | 'REENTREGA';

const ORACION_INTERRUMPIDA =
    'La importación se interrumpió: el servidor se reinició o dejó de responder mientras la procesaba.';

const ORACION_SIN_JOB =
    'La importación no llegó a empezar: quedó en la cola sin un trabajo que la procese (el servidor se ' +
    'reinició justo al confirmarla, o la cola perdió el trabajo).';

/**
 * Qué hacer con una carga interrumpida, por categoría. Un remedio solo se escribe si está verificado
 * contra el processor y contra `deleteRemesa` (§9.5.5): DEUDORES y DEUDORES_Y_FACTURAS solo escriben en
 * su propia remesa (casos, facturas, contactos, campos extra) y `deleteRemesa` lo borra todo si ningún
 * caso tiene gestión; ACCIONES guarda los datos para revertir recién en el `afterAll`. El resto
 * escribe sobre casos de otras remesas: no se afirma ningún remedio.
 */
export const AVISO_CORTE =
    ' Esta remesa es un corte de un archivo dividido: al volver a subirlo, los cortes que ya están cargados aparecen destildados; dejalos así. ' +
    'Si no aparece ninguno destildado, el sistema no reconoció el archivo: destildá a mano los que ya figuran cargados en el Historial.';

/** Segundo párrafo de una carga que no le entregó ninguna fila a un processor (§10.5.8). */
const QUE_HACER_SIN_FILAS =
    'No se cargó ninguna fila. Para cargarla, usá «Retomar» en el detalle de la importación: no hace falta volver a subir el archivo.';

function remedioDeInterrupcion(categoria: string | null | undefined, conCorte: boolean): string {
    switch (categoria) {
        case 'DEUDORES':
        case 'DEUDORES_Y_FACTURAS':
            return (
                'Lo procesado hasta el corte quedó cargado en esta remesa. Eliminá esta importación desde el ' +
                'Historial y volvé a cargar el archivo. Si no se puede eliminar (porque algún caso ya tiene gestión ' +
                'o porque la remesa es muy grande), avisá a soporte antes de volver a cargarlo.' +
                // Al resubir el archivo vienen todos los cortes tildados y no hay ninguna guarda: las nóminas ya
                // cargadas se duplicarían.
                (conCorte ? AVISO_CORTE : '')
            );
        case 'ACCIONES':
            return (
                'Las acciones aplicadas hasta el corte quedaron hechas y no se pueden revertir desde la pantalla: ' +
                'los datos para deshacer se guardan recién al terminar. No vuelvas a cargar el archivo; avisá a soporte.'
            );
        default:
            return 'Lo procesado hasta el corte quedó aplicado. Antes de volver a cargar el archivo, avisá a soporte.';
    }
}

/**
 * Texto de `import_progreso.error` de una carga cerrada por interrupción (§9.5.5). La primera línea es
 * la oración fija —es la que viaja en la notificación—; el qué hacer va en un párrafo aparte.
 */
export function textoInterrupcion(
    motivo: MotivoInterrupcion,
    categoria: string | null | undefined,
    opciones: { conCorte?: boolean; retomable?: boolean } = {},
): string {
    if (motivo === 'SIN_JOB') {
        // Retomable (§10.5.4): no se cargó nada y se puede volver a encolar la misma remesa; no hay que subir nada.
        if (opciones.retomable === true) return `${ORACION_SIN_JOB}\n\n${QUE_HACER_SIN_FILAS}`;
        // Con corte propio, resubir con todos los cortes tildados duplicaría los que ya se cargaron (cualquier categoría).
        return `${ORACION_SIN_JOB}\n\nNo se cargó ninguna fila: volvé a importar el archivo.${opciones.conCorte === true ? AVISO_CORTE : ''}`;
    }
    return `${ORACION_INTERRUMPIDA}\n\n${remedioDeInterrupcion(categoria, opciones.conCorte === true)}`;
}

export interface EntradaTextoCancelacion {
    /** Filas ya resueltas ok / con error. */
    ok: number;
    err: number;
    /** Total esperado según la vista previa; 0 o ausente = no se sabe. */
    total?: number | null;
    categoria?: string | null;
    conCorte?: boolean;
    /** Nombre de quien pidió cancelar. */
    por?: string | null;
    /** El worker llegó a tomar la carga. */
    arranco: boolean;
    /** Ningún processor fue llamado. */
    sinFilasEntregadas: boolean;
}

/**
 * Texto de `import_progreso.error` de una carga cancelada (§10.5.8). La primera línea es la que viaja en la
 * notificación; el qué hacer va en un párrafo aparte y solo se afirma lo verificado contra el processor y
 * contra `deleteRemesa`.
 */
export function textoCancelacion(d: EntradaTextoCancelacion): string {
    const por = d.por && d.por.trim() ? ` por ${d.por.trim()}` : '';
    const procesadas = d.ok + d.err;
    const total = d.total != null && Number.isFinite(d.total) && d.total > 0 ? d.total : null;
    let primera: string;
    if (!d.arranco) primera = `La importación fue cancelada${por} antes de empezar.`;
    else if (total != null) {
        primera = `La importación fue cancelada${por} cuando llevaba ${conPuntoDeMiles(procesadas)} de ${conPuntoDeMiles(total)} filas.`;
    } else primera = `La importación fue cancelada${por} cuando llevaba ${conPuntoDeMiles(procesadas)} filas.`;
    if (primera.length > MAX_PRIMERA_LINEA) primera = `${primera.slice(0, MAX_PRIMERA_LINEA - 1).trimEnd()}…`;

    if (!d.arranco || d.sinFilasEntregadas) return `${primera}\n\n${QUE_HACER_SIN_FILAS}`;

    // Con filas con error el "ok" solo no dice la verdad ("Las 0 filas ya procesadas (40 dieron error) quedaron cargadas").
    const conError = d.err > 0;
    const de = `De las ${conPuntoDeMiles(procesadas)} filas ya procesadas, ${conPuntoDeMiles(d.ok)}`;
    const err = conPuntoDeMiles(d.err);
    let segundo: string;
    switch (d.categoria) {
        case 'DEUDORES':
        case 'DEUDORES_Y_FACTURAS':
            segundo =
                (conError
                    ? `${de} quedaron cargadas en esta remesa y ${err} dieron error; el cierre de la carga no corrió. `
                    : `Las ${conPuntoDeMiles(d.ok)} filas ya procesadas quedaron cargadas en esta remesa y el cierre de la carga no corrió. `) +
                'Para cargarla completa, eliminá esta importación desde el Historial y volvé a subir el archivo. ' +
                'Si no se puede eliminar (porque algún caso ya tiene gestión o porque la remesa es muy grande), ' +
                'avisá a soporte antes de volver a subirlo.' +
                (d.conCorte === true ? AVISO_CORTE : '');
            break;
        case 'ACTUALIZACIONES':
            segundo =
                (conError
                    ? `${de} quedaron aplicadas sobre la remesa de origen y ${err} dieron error. `
                    : `Las ${conPuntoDeMiles(d.ok)} filas ya procesadas quedaron aplicadas sobre la remesa de origen. `) +
                'El cierre de la carga no corrió: los casos ausentes del archivo no se tocaron y los casos no se consolidaron. ' +
                'Antes de volver a cargar el archivo, avisá a soporte.';
            break;
        default:
            segundo =
                (conError
                    ? `${de} quedaron aplicadas y ${err} dieron error; el cierre de la carga no corrió. `
                    : `Las ${conPuntoDeMiles(d.ok)} filas ya procesadas quedaron aplicadas y el cierre de la carga no corrió. `) +
                'Antes de volver a cargar el archivo, avisá a soporte.';
    }
    return `${primera}\n\n${segundo}`;
}

/** Título, mensaje y tipo de la notificación según cómo terminó la carga (§8.5.5). */
export function textoNotificacion(e: EstadoCargaDto, opciones: { sinRegistrar?: boolean } = {}): TextoNotificacion {
    let r: TextoNotificacion;
    // Una cancelada es de tipo ERROR y no FINALIZADA: una pestaña vieja le pondría el tilde verde (§10.5.8).
    if (e.cancelada === true) {
        r = {
            tipo: 'IMPORTACION_ERROR',
            titulo: 'Importación cancelada',
            mensaje:
                conPunto(primeraLineaDelMotivo(e.error)) +
                (e.ok > 0 ? ` Las ${conPuntoDeMiles(e.ok)} filas ya procesadas quedaron cargadas.` : ' No se cargó ninguna fila.'),
        };
        return aplicarNota(r, opciones.sinRegistrar === true);
    }
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
                mensaje: mensajeSinFilas(e),
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
    return aplicarNota(r, opciones.sinRegistrar === true);
}

/** Si la falla no se pudo persistir, la base todavía dice PROCESANDO: la notificación lo avisa. Y el mensaje entra en 1000. */
function aplicarNota(r: TextoNotificacion, sinRegistrar: boolean): TextoNotificacion {
    const nota = sinRegistrar ? ' El estado no se pudo registrar: la carga puede figurar todavía en proceso.' : '';
    const tope = MAX_MENSAJE_NOTIFICACION - nota.length;
    if (r.mensaje.length > tope) {
        r.mensaje = `${r.mensaje.slice(0, tope - 1)}…`;
    }
    r.mensaje += nota;
    return r;
}
