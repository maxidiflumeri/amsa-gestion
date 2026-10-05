import { Injectable, Logger } from '@nestjs/common';
import { RealtimeGateway } from './realtime.gateway';
import type { EstadoCargaDto } from '../imports/progreso/estado-carga.types';

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

    /**
     * Una sola emisión a la unión de `user:{usuarioId}` (si la carga tiene dueño) y
     * `admin:importaciones`: Socket.IO entrega una vez a cada socket aunque esté en las dos salas,
     * así que el admin que lanzó la carga no recibe todo duplicado. Nunca propaga: un fallo del
     * socket no puede tumbar una carga.
     */
    private emitEstadoCarga(event: string, estado: EstadoCargaDto): void {
        const salas = estado.usuarioId != null
            ? [`user:${estado.usuarioId}`, 'admin:importaciones']
            : ['admin:importaciones'];
        try {
            this.gateway.server.to(salas).emit(event, estado);
        } catch (err: any) {
            this.logger.warn(`Error emitiendo ${event} de la remesa ${estado.remesaId} — ${err?.message}`);
        }
    }

    emitImportIniciada(estado: EstadoCargaDto): void {
        this.emitEstadoCarga('import:iniciada', estado);
    }

    emitImportProgreso(estado: EstadoCargaDto): void {
        this.emitEstadoCarga('import:progreso', estado);
    }

    emitImportFinalizada(estado: EstadoCargaDto): void {
        this.emitEstadoCarga('import:finalizada', estado);
    }
}
