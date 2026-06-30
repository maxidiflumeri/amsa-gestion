import { ConsolidacionScope } from './consolidacion-result.interface';

/**
 * Payload del job BullMQ de consolidación.
 * _ctx sigue el patrón estándar del repo (requestId heredado del HTTP request
 * que disparó el encolado).
 */
export interface ConsolidacionJobData {
    scope: ConsolidacionScope;
    dryRun: boolean;
    /** ID del usuario que disparó la consolidación — para notificación y auditoría. */
    usuarioId: number;
    /** Contexto de trazabilidad propagado al AsyncLocalStorage del worker. */
    _ctx?: {
        requestId?: string;
        usuarioId?: number;
    };
}
