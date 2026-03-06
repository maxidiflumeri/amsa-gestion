// processors/processor.interface.ts
import { PrismaService } from 'src/prisma/prisma.service';

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
    /** IDs de parámetros por defecto */
    defaults: {
        estadoSituacionId: number;
        estadoGestionId: number;
    };
}

/**
 * Datos ya mapeados de una fila.
 */
export interface MappedRow {
    [key: string]: any;
    camposAdicionales?: Record<string, any>;
}

/**
 * Interfaz que debe implementar cada procesador de categoría.
 */
export interface ICategoryProcessor {
    /**
     * La categoría que procesa (DEUDORES, FACTURAS, PAGOS, CONTACTOS, etc.)
     */
    readonly category: string;

    /**
     * Valida una fila antes de procesarla (opcional, por defecto pasa).
     */
    validateRow?(row: MappedRow, ctx: ProcessContext): RowValidationResult;

    /**
     * Procesa (upsert/insert) una fila ya mapeada y validada.
     */
    processRow(row: MappedRow, ctx: ProcessContext): Promise<void>;
}
