// Contrato del Historial de importaciones y de los errores de una carga (docs/imports-progreso-c2-spec.md §4.2, §4.3 y §4.5).
// Es copia textual de backend/src/modules/imports/historial.types.ts: no tocar un lado sin el otro.
import type { EstadoCargaDto } from './importProgreso';

/** Remesa de origen con la que se confirmó una carga. `numeroRemesa` null = esa remesa ya no existe. */
export interface OrigenDeCargaDto {
    remesaId: number;
    numeroRemesa: string | null;
    nombre: string | null;
}

/** Borrador que ya se confirmó una vez y el servidor no pudo mandar a la cola. */
export interface PendienteDeEncolarDto {
    /** Esta remesa y las hermanas en la misma situación (mismo archivo, plantilla, dueño y origen), por id. */
    remesas: Array<{ remesaId: number; numeroRemesa: string; corte: string | null }>;
    /** Remesas de origen con las que se había confirmado. Vacío si la categoría no usa. */
    origen: OrigenDeCargaDto[];
    /** Otras remesas del mismo archivo y la misma plantilla (y del mismo corte, si esta lo tiene) que se
     *  confirmaron DESPUÉS de que esta se creó y están en curso, cargadas o a medias. Si trae alguna,
     *  confirmar esta carga ese contenido otra vez. */
    yaCargadoEn: Array<{ remesaId: number; numeroRemesa: string }>;
}

export interface HistorialItemDto {
    id: number;
    numeroRemesa: string;
    nombre: string;
    categoria: string | null;
    /** ISO 8601. */
    createdAt: string;
    plantilla: { id: number; nombre: string } | null;
    politicaId: number | null;
    accionRevertidaEn: string | null;
    /** Nombres con que se subieron los archivos, si la remesa los guardó (hoy, solo las de varios archivos). */
    archivos: string[] | null;
    /** Corte de la división que le tocó ("Nómina 3082 / Gestión 3GH"). null si no es un corte. */
    corte: string | null;
    /** El estado, armado con `armarEstadoCarga`: el mismo que devuelve `GET /import/remesas/:id/progreso`. */
    carga: EstadoCargaDto;
    /** null salvo en un borrador que ya se confirmó una vez (§5.5). */
    pendienteDeEncolar: PendienteDeEncolarDto | null;
}

/** Resumen de una carga dividida, contando TODAS sus remesas, estén o no en la página. */
export interface GrupoHistorialDto {
    grupoId: string;
    /** `grupoTotal`: cuántas se confirmaron juntas. */
    total: number;
    /** Cuántas siguen existiendo (alguna pudo eliminarse). */
    existentes: number;
    enCurso: number;
    cancelables: number;
    /** Con el criterio de §4.1 (ya descontadas las que tienen el corte en otra remesa). */
    retomables: number;
    finalizadas: number;
    /** Fallidas y canceladas. */
    noCargadas: number;
    /** Dueño de la división (el de sus remesas). */
    usuarioId: number | null;
}

export interface HistorialRespuesta {
    data: HistorialItemDto[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
    /** Una entrada por cada `grupoId` que aparece en `data`. */
    grupos: Record<string, GrupoHistorialDto>;
    servidorAhora: string;
}

export type TipoErrorDeCarga = 'FILA' | 'AVISO';

export interface ErrorDeCargaDto {
    id: number;
    /** El valor guardado, sin tocar: 0 es la primera fila procesada y también todo aviso. Se conserva
     *  para las pestañas viejas; el código nuevo lee `tipo` y `fila`. */
    rowNumber: number;
    tipo: TipoErrorDeCarga;
    /** Posición de la fila entre las que procesó la carga, contando desde 1. null en un aviso. */
    fila: number | null;
    errorMsg: string;
    rawRow: unknown;
    createdAt: string;
}

export interface ErroresRespuesta {
    data: ErrorDeCargaDto[];
    total: number; // de lo pedido (según `tipo`)
    page: number;
    pageSize: number;
    totalPages: number;
    /** De toda la carga, no de la página ni del filtro. */
    totales: { filas: number; avisos: number };
}

export type CodigoErrorImport =
    | 'CORTE_YA_CARGADO' // alta: el archivo ya tiene ese corte cargado, en curso o a medias
    | 'CORTE_YA_CONFIRMADO' // confirmar / retomar: el corte ya figura en otra remesa confirmada después
    | 'NINGUNA_RETOMABLE' // retomar un grupo: ninguna se puede
    | 'NO_ES_PENDIENTE' // confirmar-pendientes: la remesa no es un borrador ya confirmado
    | 'ORIGEN_DISTINTO' // confirmar-pendientes: no se confirmaron con las mismas remesas de origen
    | 'CAMBIO_DE_ESTADO'; // eliminar: la carga cambió (otro `rev`) desde que la pantalla la mostró
