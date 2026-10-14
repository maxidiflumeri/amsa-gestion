// Funciones puras del Historial de importaciones (docs/imports-progreso-c2-spec.md §6.3 y §6.4).
// Todo campo que puede faltar (un backend anterior, una remesa heredada) se lee con `== null`.
import type { GrupoHistorialDto, HistorialItemDto } from '../types/importHistorial';
import {
    esRetomable,
    etiquetaDeEstado,
    motivoNoCancelable,
    plural,
    puedeGestionarCarga,
    type EtiquetaDeEstado,
} from './estadoCarga';

/** Lo que el Historial dibuja de una fila: la etiqueta única de la carga (utils/estadoCarga.ts). */
export type EstadoDeFila = EtiquetaDeEstado;

/** Qué dice el Historial de una remesa (tabla de §6.3): la etiqueta única, más si quedó pendiente de encolar. */
export function estadoParaHistorial(item: Pick<HistorialItemDto, 'carga' | 'pendienteDeEncolar'>): EstadoDeFila {
    return etiquetaDeEstado(item.carga, { pendienteDeEncolar: item.pendienteDeEncolar });
}

/**
 * Deja cada tramo de filas contiguas con el mismo `grupoId` en orden de `grupoOrden`. No mueve filas de un tramo a
 * otro: una remesa suelta en el medio parte el grupo en dos tramos.
 */
export function ordenarParaMostrar(items: HistorialItemDto[]): HistorialItemDto[] {
    const salida: HistorialItemDto[] = [];
    let i = 0;
    while (i < items.length) {
        const gid = items[i].carga.grupoId ?? null;
        let j = i + 1;
        if (gid !== null) while (j < items.length && (items[j].carga.grupoId ?? null) === gid) j++;
        const tramo = items.slice(i, j);
        if (gid !== null) {
            tramo.sort(
                (a, b) =>
                    (a.carga.grupoOrden ?? Number.MAX_SAFE_INTEGER) - (b.carga.grupoOrden ?? Number.MAX_SAFE_INTEGER) || a.id - b.id,
            );
        }
        salida.push(...tramo);
        i = j;
    }
    return salida;
}

/** La fila `i` (de una lista ya ordenada) abre un tramo de una carga dividida. */
export function inicioDeBloque(items: HistorialItemDto[], i: number): boolean {
    const gid = items[i]?.carga.grupoId ?? null;
    if (gid === null) return false;
    return i === 0 || (items[i - 1].carga.grupoId ?? null) !== gid;
}

/** El tramo de la fila `i` (ordenada): las filas contiguas con su mismo `grupoId`. */
export function tramoDeBloque(items: HistorialItemDto[], i: number): HistorialItemDto[] {
    const gid = items[i]?.carga.grupoId ?? null;
    if (gid === null) return [];
    const tramo: HistorialItemDto[] = [];
    for (let j = i; j < items.length && (items[j].carga.grupoId ?? null) === gid; j++) tramo.push(items[j]);
    return tramo;
}

/** El renglón de resumen del encabezado de división, con las partes que corresponden ("3 finalizadas · 1 en curso · …"). */
export function textoEncabezadoDivision(g: GrupoHistorialDto, enPagina: number): {
    titulo: string;
    resumen: string;
    nota: string | null;
    eliminadas: string | null;
} {
    const partes: string[] = [];
    if (g.finalizadas > 0) partes.push(`${g.finalizadas} ${plural(g.finalizadas, 'finalizada', 'finalizadas')}`);
    if (g.enCurso > 0) partes.push(`${g.enCurso} en curso`);
    // `noCargadas` cuenta las fallidas y las canceladas, también una cancelada a mitad que sí cargó filas: no se rotula "no cargada".
    if (g.noCargadas > 0) partes.push(`${g.noCargadas} ${plural(g.noCargadas, 'fallida o cancelada', 'fallidas o canceladas')}`);
    const existentes = g.existentes;
    const aqui =
        enPagina < existentes
            ? `(${enPagina} de las ${existentes} ${enPagina === 1 && existentes === 1 ? 'está' : 'están'} en esta página)`
            : null;
    const faltan = g.total - g.existentes;
    return {
        titulo: `Carga dividida · ${g.total} ${plural(g.total, 'remesa', 'remesas')}`,
        resumen: partes.join(' · '),
        nota: aqui,
        eliminadas: faltan > 0 ? (faltan === 1 ? '(1 se eliminó)' : `(${faltan} se eliminaron)`) : null,
    };
}

/** Texto del botón del encabezado de división. */
export function textoRetomarDivision(retomables: number): string {
    return `Retomar las ${retomables} que no se cargaron`;
}

export interface AccionesDeFila {
    cancelar: boolean;
    retomar: boolean;
    confirmar: boolean;
    consolidar: boolean;
    revertir: { visible: boolean; deshabilitado: boolean; motivo: string | null };
    eliminar: { visible: boolean; deshabilitado: boolean; motivo: string | null };
    /** Motivo de cada acción que se muestra deshabilitada, para escribirlo en la tarjeta del celular (no hay tooltip). */
    motivos: string[];
}

export const MOTIVO_ELIMINAR_EN_CURSO = 'No se puede eliminar una importación en curso. Para frenarla, usá Cancelar.';
export const MOTIVO_ELIMINAR_AJENA = 'Solo podés eliminar tus importaciones.';
export const MOTIVO_REVERTIDA = 'Acción ya revertida';

/**
 * Qué se ofrece en una fila. Lo decide el backend (`cancelable`, `retomable`, `pendienteDeEncolar`) más los permisos:
 * acá no se deduce de los contadores.
 */
export function accionesDeFila(
    item: HistorialItemDto,
    usuarioId: number | null | undefined,
    tienePermiso: (key: string) => boolean,
): AccionesDeFila {
    const c = item.carga;
    const gestiona = puedeGestionarCarga(c, usuarioId, tienePermiso);
    const motivos: string[] = [];

    // BotonCancelarCarga: se muestra si hay `cancelable` informado; si la carga no se puede cortar, queda deshabilitado con el motivo.
    const cancelar = c.enCurso && c.cancelable != null && gestiona;
    if (cancelar && c.cancelable === false) {
        const m = motivoNoCancelable(c);
        if (m !== null) motivos.push(m);
    }

    const retomar = esRetomable(c) && gestiona;
    const confirmar = item.pendienteDeEncolar != null && !c.enCurso && !c.terminal && gestiona;

    const puedeRevertir = tienePermiso('deudores.acciones_masivas') && item.categoria === 'ACCIONES' && c.estadoProceso === 'FINALIZADA';
    const revertida = item.accionRevertidaEn != null;
    const revertir = {
        visible: puedeRevertir,
        deshabilitado: puedeRevertir && revertida,
        motivo: puedeRevertir && revertida ? MOTIVO_REVERTIDA : null,
    };
    if (revertir.motivo !== null) motivos.push(revertir.motivo);

    let eliminar = { visible: false, deshabilitado: false, motivo: null as string | null };
    if (tienePermiso('importacion.eliminar')) {
        const yaArranco = c.enCurso && c.fase !== 'EN_COLA';
        const esDelUsuario = usuarioId != null && c.usuarioId === usuarioId;
        let motivo: string | null = null;
        if (yaArranco) motivo = MOTIVO_ELIMINAR_EN_CURSO;
        else if (!esDelUsuario && !tienePermiso('importacion.ver_progreso_otros')) motivo = MOTIVO_ELIMINAR_AJENA;
        eliminar = { visible: true, deshabilitado: motivo !== null, motivo };
        if (motivo !== null) motivos.push(motivo);
    }

    return { cancelar, retomar, confirmar, consolidar: tienePermiso('consolidacion.ejecutar'), revertir, eliminar, motivos };
}

export interface TextoEliminar {
    titulo: string;
    /** Párrafos. Lo que va entre `**` se muestra en negrita. */
    parrafos: string[];
    confirmar: string;
}

const CATEGORIAS_QUE_SOLO_REGISTRAN = ['FACTURAS', 'PAGOS', 'CONTACTOS', 'ENRIQUECIMIENTO', 'ACTUALIZACIONES'];

export const TEXTO_ELIMINAR_BASE =
    'Esta acción eliminará la importación junto con sus casos (deudores) y los datos cargados (contactos, facturas, etc.). ' +
    'Si la remesa ya tiene gestión (comentarios, convenios, pagos, llamadas o emails enviados), no se podrá eliminar. ' +
    'Esta operación no se puede deshacer.';

/** El diálogo de eliminar dice qué se elimina de verdad, según el estado y la categoría (§6.4). */
export function textoEliminar(item: HistorialItemDto): TextoEliminar {
    const c = item.carga;
    const vistaPrevia = 'Es una vista previa sin confirmar: no cargó nada. Al eliminarla se libera su número de remesa. No se puede deshacer.';
    if (!c.enCurso && !c.terminal) {
        if (item.pendienteDeEncolar != null) {
            return {
                titulo: 'Eliminar vista previa',
                parrafos: [
                    vistaPrevia,
                    'Ya se había confirmado y la cola de trabajos no respondió. Si lo que querés es cargarla, usá «Confirmar» en vez de eliminarla.',
                ],
                confirmar: 'Eliminar',
            };
        }
        return { titulo: 'Eliminar vista previa', parrafos: [vistaPrevia], confirmar: 'Eliminar' };
    }
    if (c.enCurso) {
        const parrafos = [
            'Esta importación **está confirmada y espera su turno**: todavía no empezó. Si la eliminás, sale de la cola y no se carga. No se puede deshacer.',
        ];
        if (c.grupoOrden != null && c.grupoTotal != null) {
            parrafos.push(`Es la remesa ${c.grupoOrden} de ${c.grupoTotal} de una carga dividida: las demás siguen.`);
        }
        parrafos.push('Si solo querés frenarla, usá «Cancelar»: no se carga ninguna fila y después la podés retomar.');
        return { titulo: 'Eliminar una importación en cola', parrafos, confirmar: 'Eliminar igual' };
    }
    const categoria = item.categoria ?? '';
    if (categoria === 'ACCIONES') {
        return {
            titulo: 'Confirmar eliminación',
            parrafos: ['**Eliminarla no revierte la acción** y deja sin efecto el botón Revertir para siempre. Si la acción salió mal, revertila primero.'],
            confirmar: 'Eliminar',
        };
    }
    if (categoria === 'MULTICLAVES') {
        return {
            titulo: 'Confirmar eliminación',
            parrafos: ['Elimina las claves de pago que cargó esta importación. Si alguna ya tiene un convenio o un cupón emitido, no se puede eliminar.'],
            confirmar: 'Eliminar',
        };
    }
    if (CATEGORIAS_QUE_SOLO_REGISTRAN.includes(categoria)) {
        return {
            titulo: 'Confirmar eliminación',
            parrafos: [
                'Eliminar esta importación borra su registro y su lista de errores. **No deshace lo que aplicó**: lo que cargó sobre los casos de otras remesas queda como está. No se puede deshacer.',
            ],
            confirmar: 'Eliminar',
        };
    }
    // Categorías que crean casos (Deudores, Deudores y Facturas, Multirregistro, Multiarchivo) y cualquier otra que no se conozca: el texto de siempre.
    return { titulo: 'Confirmar eliminación', parrafos: [TEXTO_ELIMINAR_BASE], confirmar: 'Eliminar' };
}
