// processors/processor.interface.ts
import { PrismaService } from 'src/prisma/prisma.service';
import { ConsolidacionSituacionService } from '../../consolidacion/consolidacion.service';
import { PromesasService } from '../../promesas/promesas.service';
import { AuditoriaHelper } from '../../transacciones/auditoria.helper';
import { AccionAusenteActualizacion, AccionesConfig, ComportamientoDeudaMayor, ModoActualizacion, MontoDeudorMode } from '../mapping-types';

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

/**
 * Interfaz que debe implementar cada procesador de categoría.
 */
export interface ICategoryProcessor {
    readonly category: string;

    validateRow?(row: MappedRow, ctx: ProcessContext): RowValidationResult;

    processRow(row: MappedRow, ctx: ProcessContext): Promise<void>;

    /**
     * Hook opcional que se ejecuta UNA SOLA VEZ al finalizar el procesamiento
     * de todas las filas. Útil para lógica post-batch (ej: marcar deudores
     * ausentes como pagados).
     */
    afterAll?(ctx: ProcessContext): Promise<void>;
}
