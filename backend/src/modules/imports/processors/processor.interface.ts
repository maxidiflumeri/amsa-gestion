// processors/processor.interface.ts
import { PrismaService } from 'src/prisma/prisma.service';
import { ConsolidacionSituacionService } from '../../consolidacion/consolidacion.service';
import { PromesasService } from '../../promesas/promesas.service';
import { MontoDeudorMode } from '../mapping-types';

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
    /** ID de la remesa de deudores a la que se vincula (para FACTURAS, CONTACTOS, PAGOS) */
    remesaOrigenId?: number;
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
    /**
     * Modo de cálculo de `deudor.montoTotal` desde la suma de facturas.
     * Leído de `mappingJson.montoDeudorDesdeFacturas` (default `SI_VACIO`).
     * Aplica a las categorías FACTURAS y DEUDORES_Y_FACTURAS.
     */
    montoDeudorDesdeFacturas: MontoDeudorMode;
}

/**
 * Datos ya mapeados de una fila.
 */
export interface MappedRow {
    [key: string]: any;
    camposAdicionales?: Record<string, any>;
    _blocks?: Array<{ entity: string; data: Record<string, any> }>;
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
