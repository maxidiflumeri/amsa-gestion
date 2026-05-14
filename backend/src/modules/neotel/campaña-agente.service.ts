import {
    Injectable,
    Logger,
    NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AgenteTelefoniaService } from './agente-telefonia.service';
import { NeotelHttpClient } from './neotel-http.client';
import { NeotelRedisService } from './neotel-redis.service';
import { SesionAgenteService } from './sesion-agente.service';

export interface CampañaResponse {
    id: number;
    idNeotel: number;
    nombre: string;
    descripcion: string | null;
    activa: boolean;
    predictiva: boolean;
    empresaId: number | null;
}

export interface AsignarCampañaResponse {
    ok: true;
    campañaActiva: CampañaResponse;
}

@Injectable()
export class CampañaAgenteService {
    private readonly logger = new Logger(CampañaAgenteService.name);

    constructor(
        private readonly prisma:    PrismaService,
        private readonly agenteSvc: AgenteTelefoniaService,
        private readonly neotel:    NeotelHttpClient,
        private readonly redis:     NeotelRedisService,
        private readonly sesionSvc: SesionAgenteService,
    ) {}

    // ─────────────────────────────────────────────────────────────────────────
    // asignarCampaña
    // ─────────────────────────────────────────────────────────────────────────

    async asignarCampaña(
        usuarioId: number,
        campañaNeotelId: number,
    ): Promise<AsignarCampañaResponse> {
        const sesion = await this.sesionSvc.getSesionActivaDesdeDb(usuarioId);
        if (!sesion) {
            throw new NotFoundException(
                `El usuario ${usuarioId} no tiene sesión Neotel activa. Hacé login primero.`,
            );
        }

        const campaña = await this.prisma.campaña_neotel.findUnique({
            where: { id: campañaNeotelId },
        });
        if (!campaña || !campaña.activa) {
            throw new NotFoundException(`Campaña Neotel ${campañaNeotelId} no encontrada o inactiva.`);
        }

        const credenciales = await this.agenteSvc.getCredencialesNeotelParaUsuario(usuarioId);
        const ahora = new Date();

        // Llamar API Neotel
        await this.neotel.loginCampaign({
            usuario: credenciales.usuarioNeotel,
            campana: campaña.idNeotel,
        });

        // Cerrar campaña anterior si la hay
        await this.cerrarCampañaActiva(sesion.id, ahora);

        // Crear nueva entrada de campaña-sesión
        await this.prisma.campaña_sesion_neotel.create({
            data: {
                sesionId:  sesion.id,
                campañaId: campaña.id,
            },
        });

        this.logger.log(
            `Campaña asignada: usuario=${usuarioId} sesion=${sesion.id} campaña=${campaña.id} (idNeotel=${campaña.idNeotel})`,
        );

        // Actualizar Redis
        await this.redis.updateSesionCampaña(usuarioId, String(campaña.id));

        return {
            ok: true,
            campañaActiva: this.mapToResponse(campaña),
        };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // desasignarCampaña
    // ─────────────────────────────────────────────────────────────────────────

    async desasignarCampaña(usuarioId: number): Promise<{ ok: true }> {
        const sesion = await this.sesionSvc.getSesionActivaDesdeDb(usuarioId);
        if (!sesion) {
            throw new NotFoundException(
                `El usuario ${usuarioId} no tiene sesión Neotel activa.`,
            );
        }

        const credenciales = await this.agenteSvc.getCredencialesNeotelParaUsuario(usuarioId);
        const ahora = new Date();

        // Obtener campaña activa para saber el idNeotel
        const campañaActiva = await this.prisma.campaña_sesion_neotel.findFirst({
            where:   { sesionId: sesion.id, leftAt: null },
            include: { campaña: true },
            orderBy: { enteredAt: 'desc' },
        });

        if (campañaActiva) {
            // Llamar API Neotel
            await this.neotel.logoutCampaign({
                usuario: credenciales.usuarioNeotel,
                campaña: campañaActiva.campaña.idNeotel,
            });

            await this.cerrarCampañaActiva(sesion.id, ahora);

            this.logger.log(
                `Campaña desasignada: usuario=${usuarioId} sesion=${sesion.id} campaña=${campañaActiva.campañaId}`,
            );
        }

        // Limpiar Redis
        await this.redis.updateSesionCampaña(usuarioId, null);

        return { ok: true };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // listarCampañasDisponibles
    // ─────────────────────────────────────────────────────────────────────────

    async listarCampañasDisponibles(): Promise<CampañaResponse[]> {
        const campañas = await this.prisma.campaña_neotel.findMany({
            where:   { activa: true },
            orderBy: { nombre: 'asc' },
        });
        return campañas.map(this.mapToResponse);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Helpers privados
    // ─────────────────────────────────────────────────────────────────────────

    private async cerrarCampañaActiva(sesionId: number, ahora: Date): Promise<void> {
        await this.prisma.campaña_sesion_neotel.updateMany({
            where: { sesionId, leftAt: null },
            data:  { leftAt: ahora },
        });
    }

    private mapToResponse(campaña: {
        id: number;
        idNeotel: number;
        nombre: string;
        descripcion: string | null;
        activa: boolean;
        predictiva: boolean;
        empresaId: number | null;
    }): CampañaResponse {
        return {
            id:          campaña.id,
            idNeotel:    campaña.idNeotel,
            nombre:      campaña.nombre,
            descripcion: campaña.descripcion,
            activa:      campaña.activa,
            predictiva:  campaña.predictiva,
            empresaId:   campaña.empresaId,
        };
    }
}
