import { EntidadTipo, TipoNotificacion } from '@prisma/client';

export interface CrearNotificacionParams {
    tipo: TipoNotificacion;
    entidadTipo?: EntidadTipo;
    entidadId?: number;
    titulo: string;
    mensaje: string;
    payload?: Record<string, unknown>;
    rutaAccion?: string;
    /** ID del destinatario principal (dueño de la acción) */
    destinatarioPrincipalId: number;
    /**
     * Si se proporciona, se incluirán automáticamente todos los usuarios activos
     * cuyo rol tenga este permiso en su campo `permisos` (JSON array).
     *
     * Esos usuarios son **copias**: la notificación les llega a la campanita y suma a su contador
     * (`notificacion:silenciosa` + `notificacion:contador`), pero **no generan aviso emergente**. El aviso
     * (`notificacion:nueva`) es solo del `destinatarioPrincipalId`, incluso si él también tiene el permiso.
     */
    incluirUsuariosConPermiso?: string;
}
