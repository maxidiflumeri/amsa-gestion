// processors/processor.interface.ts
import { PrismaService } from 'src/prisma/prisma.service';
import { ConsolidacionSituacionService } from '../../consolidacion/consolidacion.service';
import { PromesasService } from '../../promesas/promesas.service';
import { AuditoriaHelper } from '../../transacciones/auditoria.helper';
import { AccionAusenteActualizacion, AccionesConfig, ComportamientoDeudaMayor, ModoActualizacion, MontoDeudorMode, MultiarchivoConfig, MultirregistroConfig } from '../mapping-types';

/**
 * Resultado de validar una fila.
 * Si `error` tiene contenido, la fila se considera inválida.
 */
export interface RowValidationResult {
    valid: boolean;
    error?: string;
}

/**
 * Contexto compartido que cada procesador recibe.
 */
export interface ProcessContext {
    prisma: PrismaService;
    remesaId: number;
    empresaId: number;
    /** Usuario que disparó la importación (para autoría de comentarios y auditoría). */
    usuarioId?: number;
    /**
     * Plantilla con la que se está importando. MULTIARCHIVO la usa para acotar "la cartera" al
     * desasignar ausentes: los casos de esa cartera son los que cargó esta misma plantilla, no
     * todos los deudores de la empresa (que puede tener otras carteras cargadas por otras).
     */
    plantillaId?: number;
    /** ID de la remesa de deudores a la que se vincula (para FACTURAS, CONTACTOS, PAGOS) */
    remesaOrigenId?: number;
    /**
     * PAGOS: varias remesas de deudores origen para una sola corrida. Permite que un archivo
     * de pagos que abarca toda la empresa (N remesas) se procese una sola vez en vez de N.
     * Si viene con elementos, el deudor se busca por nroCliente en cualquiera de esas remesas.
     * Si está vacío/ausente, se usa `remesaOrigenId` (comportamiento clásico de una sola remesa).
     */
    remesaOrigenIds?: number[];
    /** Si true, los domicilios se validan/normalizan contra Georef (más lento). Si false, se cargan con formato sin verificar. */
    validarDomicilios?: boolean;
    /** IDs de parámetros por defecto */
    defaults: {
        estadoSituacionId: number;
        estadoGestionId: number;
    };
    /** Servicio de consolidación de situación (Fase 3). Inyectado por ImportService. */
    consolidacion: ConsolidacionSituacionService;
    /** Servicio de promesas de pago — para cerrar promesas cumplidas tras generar pagos. */
    promesas: PromesasService;
    /** Helper de auditoría (categoría ACCIONES registra su resumen). */
    auditoria: AuditoriaHelper;
    /** Config de la categoría ACCIONES (leída de `mappingJson.acciones`). */
    accionesConfig?: AccionesConfig;
    /**
     * Modo de cálculo de `deudor.montoTotal` desde la suma de facturas.
     * Leído de `mappingJson.montoDeudorDesdeFacturas` (default `SI_VACIO`).
     * Aplica a las categorías FACTURAS y DEUDORES_Y_FACTURAS.
     */
    montoDeudorDesdeFacturas: MontoDeudorMode;
    /**
     * Modo del import de ACTUALIZACIONES. Leído de `mappingJson.modoActualizacion`
     * (default `RECONCILIAR`). Ver {@link ModoActualizacion}.
     */
    modoActualizacion: ModoActualizacion;
    /**
     * Comportamiento ante deuda mayor en ACTUALIZACIONES (Modo B). Leído de
     * `mappingJson.comportamientoDeudaMayor` (default `FACTURA_NUEVA`).
     * Ver {@link ComportamientoDeudaMayor}.
     */
    comportamientoDeudaMayor: ComportamientoDeudaMayor;
    /**
     * ACTUALIZACIONES: si `false`, los registros que no matchean la remesa origen se ignoran
     * (no se crea deudor nuevo). Leído de `mappingJson.crearNuevosCasos` (default `true`).
     */
    crearNuevosCasos: boolean;
    /**
     * ACTUALIZACIONES: acción sobre deudores de la remesa origen ausentes del archivo.
     * Leído de `mappingJson.accionAusente` (default `PAGO_TODO`). Ver {@link AccionAusenteActualizacion}.
     */
    accionAusente: AccionAusenteActualizacion;
    /**
     * Config de la categoría MULTIRREGISTRO (leída de `mappingJson.multirregistro`). El processor
     * la necesita para saber qué motivos de baja significan "pagó" y cuáles son un retiro del
     * cedente sin pago.
     */
    multirregistroConfig?: MultirregistroConfig;
    /**
     * Config de la categoría MULTIARCHIVO (leída de `mappingJson.multiarchivo`). El processor la
     * necesita para saber qué códigos de motivo de baja significan "se cobró" y cuáles son un
     * retiro del cedente sin pago.
     */
    multiarchivoConfig?: MultiarchivoConfig;
}

/**
 * Datos ya mapeados de una fila.
 */
export interface MappedRow {
    [key: string]: any;
    camposAdicionales?: Record<string, any>;
    _blocks?: Array<{ entity: string; data: Record<string, any> }>;
    /** Fila cruda (array de valores por índice de columna). La usa la categoría ACCIONES. */
    _raw?: any[];
}

/** Fila ya mapeada y validada, lista para procesar, con su número de fila en el archivo. */
export interface BatchRow {
    row: MappedRow;
    idx: number;
}

/** Error de una fila puntual dentro de un lote (el resto del lote sigue adelante). */
export interface BatchRowError {
    idx: number;
    error: string;
}

/**
 * Interfaz que debe implementar cada procesador de categoría.
 */
export interface ICategoryProcessor {
    readonly category: string;

    validateRow?(row: MappedRow, ctx: ProcessContext): RowValidationResult;

    processRow(row: MappedRow, ctx: ProcessContext): Promise<void>;

    /**
     * Hook OPCIONAL de procesamiento por lote. Si un processor lo implementa, el runner le pasa
     * todo el lote de filas válidas de una sola vez en vez de llamar a `processRow` una por una.
     *
     * Existe por performance: permite resolver las lecturas con un `findMany ... IN (...)` por lote
     * y agrupar las escrituras, en vez de pagar un round-trip a la DB por fila. En archivos grandes
     * (cientos de miles de filas contra RDS) la diferencia es de horas a minutos.
     *
     * Devuelve un error por cada fila que falló; las que no aparecen se consideran OK. Un throw
     * hace fallar el lote entero, así que conviene capturar por fila y reportar acá.
     *
     * Los processors que no lo implementan siguen funcionando igual vía `processRow`.
     */
    processBatch?(rows: BatchRow[], ctx: ProcessContext): Promise<BatchRowError[]>;

    /**
     * Hook opcional que se ejecuta UNA SOLA VEZ al finalizar el procesamiento
     * de todas las filas. Útil para lógica post-batch (ej: marcar deudores
     * ausentes como pagados).
     */
    afterAll?(ctx: ProcessContext): Promise<void>;
}
