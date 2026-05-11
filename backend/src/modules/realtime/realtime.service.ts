import { Injectable, Logger } from '@nestjs/common';
import { RealtimeGateway } from './realtime.gateway';

export interface ImImportIniciadaPayload {
    remesaId: number;
    tipo: string;
    totalFilas: number;
    usuarioId: number;
    usuarioNombre: string;
    startedAt: Date;
}

export interface ImportProgresoPayload {
    remesaId: number;
    progreso: number;
    okFilas: number;
    errFilas: number;
    totalFilas: number;
    estadoProceso: string;
    usuarioId: number;
    usuarioNombre: string;
}

export interface ImportFinalizadaPayload {
    remesaId: number;
    okFilas: number;
    errFilas: number;
    totalFilas: number;
    durationMs: number;
    estadoProceso: string;
    usuarioId: number;
    usuarioNombre: string;
}

@Injectable()
export class RealtimeService {
    private readonly logger = new Logger(RealtimeService.name);

    constructor(private readonly gateway: RealtimeGateway) {}

    emitToUser(usuarioId: number, event: string, payload: unknown): void {
        try {
            this.gateway.server.to(`user:${usuarioId}`).emit(event, payload);
        } catch (err: any) {
            this.logger.warn(`Error emitiendo a user:${usuarioId} — ${err?.message}`);
        }
    }

    emitToRoom(room: string, event: string, payload: unknown): void {
        try {
            this.gateway.server.to(room).emit(event, payload);
        } catch (err: any) {
            this.logger.warn(`Error emitiendo a room ${room} — ${err?.message}`);
        }
    }

    emitToAdmins(room: string, event: string, payload: unknown): void {
        this.emitToRoom(room, event, payload);
    }

    emitImportIniciada(payload: ImImportIniciadaPayload): void {
        this.emitToUser(payload.usuarioId, 'import:iniciada', payload);
        this.emitToRoom('admin:importaciones', 'import:iniciada', payload);
    }

    emitImportProgreso(payload: ImportProgresoPayload): void {
        this.emitToUser(payload.usuarioId, 'import:progreso', payload);
        this.emitToRoom('admin:importaciones', 'import:progreso', payload);
    }

    emitImportFinalizada(payload: ImportFinalizadaPayload): void {
        this.emitToUser(payload.usuarioId, 'import:finalizada', payload);
        this.emitToRoom('admin:importaciones', 'import:finalizada', payload);
    }
}
