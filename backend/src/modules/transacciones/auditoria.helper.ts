import { Injectable, Logger } from '@nestjs/common';
import { TransaccionesService } from './transacciones.service';
import {
    AuditData,
    AuditEstado,
    AuditModulo,
    AuditSeveridad,
    AuditTipo,
    redactarCamposSensibles,
} from './audit.enums';

export interface AuditEvent {
    modulo: AuditModulo | string;
    entidad: string;
    tipo: AuditTipo | string;
    severidad?: AuditSeveridad | string;
    estado?: AuditEstado | string;
    usuarioId?: number | null;
    empresaId?: number | null;
    deudorId?: number | null;
    entidadId?: string | number | null;
    recursoTexto?: string;
    resumen?: string;
    data?: AuditData;
    ip?: string | null;
    userAgent?: string | null;
}

@Injectable()
export class AuditoriaHelper {
    private readonly logger = new Logger(AuditoriaHelper.name);

    constructor(private readonly tx: TransaccionesService) {}

    async log(evt: AuditEvent) {
        try {
            await this.tx.registrar({
                usuarioId: evt.usuarioId ?? null,
                empresaId: evt.empresaId ?? null,
                modulo: String(evt.modulo),
                entidad: evt.entidad,
                entidadId: evt.entidadId != null ? String(evt.entidadId) : undefined,
                tipo: String(evt.tipo),
                severidad: String(evt.severidad ?? AuditSeveridad.INFO),
                estado: String(evt.estado ?? AuditEstado.OK),
                deudorId: evt.deudorId ?? undefined,
                recursoTexto: evt.recursoTexto,
                resumen: evt.resumen,
                data: evt.data ? redactarCamposSensibles(evt.data) : undefined,
                ip: evt.ip ?? undefined,
                userAgent: evt.userAgent ?? undefined,
            });
        } catch (e: any) {
            this.logger.error(`Auditoría (helper) falló [${evt.modulo}/${evt.entidad}:${evt.tipo}]: ${e?.message}`);
        }
    }
}
