import {
    BadRequestException,
    Injectable,
    Logger,
    NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AgenteTelefoniaService } from './agente-telefonia.service';
import { NeotelHttpClient } from './neotel-http.client';
import { NeotelRedisService } from './neotel-redis.service';
import { SesionAgenteService } from './sesion-agente.service';

/**
 * Estados válidos del agente.
 * OFFLINE es el estado al hacer logout — no se puede setear manualmente.
 * EN_LLAMADA lo setea el sistema al recibir un evento NeotelEvents.
 */
export type EstadoAgente =
    | 'DISPONIBLE'
    | 'EN_PAUSA'
    | 'ADMINISTRATIVO'
    | 'EN_LLAMADA'
    | 'WRAP_UP'
    | 'OFFLINE';

/** Estados que puede setear el agente manualmente vía API */
const ESTADOS_MANUALES: EstadoAgente[] = ['DISPONIBLE', 'EN_PAUSA', 'ADMINISTRATIVO'];

export interface CambioEstadoResponse {
    estado: EstadoAgente;
    motivoPausaId: number | null;
    motivoNombre: string | null;
    desde: Date;
}

export interface MotivoPausaResponse {
    id: number;
    subtipoNeotel: number;
    nombre: string;
    descripcion: string | null;
    contabilizaProductivo: boolean;
    orden: number;
}

@Injectable()
export class EstadoAgenteService {
    private readonly logger = new Logger(EstadoAgenteService.name);

    constructor(
        private readonly prisma:     PrismaService,
        private readonly agenteSvc:  AgenteTelefoniaService,
        private readonly neotel:     NeotelHttpClient,
        private readonly redis:      NeotelRedisService,
        private readonly sesionSvc:  SesionAgenteService,
    ) {}

    // ─────────────────────────────────────────────────────────────────────────
    // setEstado
    // ─────────────────────────────────────────────────────────────────────────

    async setEstado(
        usuarioId: number,
        nuevoEstado: EstadoAgente,
        motivoPausaId?: number,
    ): Promise<CambioEstadoResponse> {
        // Validar que el estado sea uno de los manuales
        if (!ESTADOS_MANUALES.includes(nuevoEstado)) {
            throw new BadRequestException(
                `Estado "${nuevoEstado}" no es válido para seteo manual. Estados aceptados: ${ESTADOS_MANUALES.join(', ')}.`,
            );
        }

        // Obtener sesión activa
        const sesion = await this.sesionSvc.getSesionActivaDesdeDb(usuarioId);
        if (!sesion) {
            throw new NotFoundException(
                `El usuario ${usuarioId} no tiene sesión Neotel activa. Hacé login primero.`,
            );
        }

        // Validar motivo de pausa si corresponde
        let motivoPausa: { id: number; nombre: string; subtipoNeotel: number } | null = null;
        if (nuevoEstado === 'EN_PAUSA') {
            if (!motivoPausaId) {
                throw new BadRequestException('El cambio a EN_PAUSA requiere motivoPausaId.');
            }
            const mp = await this.prisma.motivo_pausa_neotel.findUnique({
                where: { id: motivoPausaId },
            });
            if (!mp || !mp.activo) {
                throw new NotFoundException(`Motivo de pausa ${motivoPausaId} no encontrado o inactivo.`);
            }
            motivoPausa = mp;
        }

        const credenciales = await this.agenteSvc.getCredencialesNeotelParaUsuario(usuarioId);
        const ahora = new Date();

        // Llamar API Neotel según el estado
        await this.llamarApiNeotelSegunEstado(
            nuevoEstado,
            credenciales.usuarioNeotel,
            motivoPausa,
        );

        // Cerrar evento de estado anterior
        await this.sesionSvc.cerrarEventoEstadoAbierto(sesion.id, ahora);

        // Crear nuevo evento de estado
        const nuevoEvento = await this.prisma.estado_agente_evento.create({
            data: {
                sesionId:     sesion.id,
                estado:       nuevoEstado,
                motivoPausaId: motivoPausa?.id ?? null,
                origen:       'manual',
            },
        });

        this.logger.log(
            `Estado cambiado: usuario=${usuarioId} sesion=${sesion.id} estado=${nuevoEstado}${motivoPausa ? ` motivo=${motivoPausa.nombre}` : ''}`,
        );

        // Actualizar Redis
        const estadoCache = {
            estado:         nuevoEstado,
            desde:          ahora.toISOString(),
            ...(motivoPausa ? { motivoPausaId: String(motivoPausa.id) } : {}),
        };
        await this.redis.setEstado(usuarioId, estadoCache);

        // También actualizar el campo estado en la key de sesion
        const sesionCache = await this.redis.getSesion(usuarioId);
        if (sesionCache) {
            await this.redis.setSesion(usuarioId, { ...sesionCache, estado: nuevoEstado });
        }

        // TODO(T8): emitir evento socket estado:cambio a la room agente:<usuarioId> y supervisor:telefonia

        return {
            estado:        nuevoEstado,
            motivoPausaId: motivoPausa?.id ?? null,
            motivoNombre:  motivoPausa?.nombre ?? null,
            desde:         nuevoEvento.startedAt,
        };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // getEstadoActual
    // ─────────────────────────────────────────────────────────────────────────

    async getEstadoActual(usuarioId: number): Promise<CambioEstadoResponse | null> {
        // 1. Intentar desde Redis
        const cache = await this.redis.getEstado(usuarioId);
        if (cache) {
            return {
                estado:        cache.estado as EstadoAgente,
                motivoPausaId: cache.motivoPausaId ? parseInt(cache.motivoPausaId, 10) : null,
                motivoNombre:  null, // Redis no guarda el nombre — OK para el frontend
                desde:         new Date(cache.desde),
            };
        }

        // 2. Fallback a DB
        const sesion = await this.sesionSvc.getSesionActivaDesdeDb(usuarioId);
        if (!sesion) return null;

        const evento = await this.prisma.estado_agente_evento.findFirst({
            where:   { sesionId: sesion.id, endedAt: null },
            orderBy: { startedAt: 'desc' },
            include: { motivoPausa: true },
        });

        if (!evento) return null;

        // Re-hidratar Redis
        await this.redis.setEstado(usuarioId, {
            estado:         evento.estado,
            motivoPausaId:  evento.motivoPausaId ? String(evento.motivoPausaId) : undefined,
            desde:          evento.startedAt.toISOString(),
        });

        return {
            estado:        evento.estado as EstadoAgente,
            motivoPausaId: evento.motivoPausaId,
            motivoNombre:  evento.motivoPausa?.nombre ?? null,
            desde:         evento.startedAt,
        };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // listarMotivosPausa
    // ─────────────────────────────────────────────────────────────────────────

    async listarMotivosPausa(): Promise<MotivoPausaResponse[]> {
        const motivos = await this.prisma.motivo_pausa_neotel.findMany({
            where:   { activo: true },
            orderBy: { orden: 'asc' },
        });

        return motivos.map((m) => ({
            id:                    m.id,
            subtipoNeotel:         m.subtipoNeotel,
            nombre:                m.nombre,
            descripcion:           m.descripcion,
            contabilizaProductivo: m.contabilizaProductivo,
            orden:                 m.orden,
        }));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Helpers privados
    // ─────────────────────────────────────────────────────────────────────────

    private async llamarApiNeotelSegunEstado(
        estado: EstadoAgente,
        usuarioNeotel: string,
        motivoPausa: { subtipoNeotel: number } | null,
    ): Promise<void> {
        switch (estado) {
            case 'DISPONIBLE':
                await this.neotel.unpause(usuarioNeotel);
                break;

            case 'EN_PAUSA':
                if (!motivoPausa) throw new BadRequestException('Falta motivo de pausa para llamar a Neotel.Pause');
                await this.neotel.pause({
                    usuario:         usuarioNeotel,
                    subtipoDescanso: motivoPausa.subtipoNeotel,
                });
                break;

            case 'ADMINISTRATIVO':
                await this.neotel.tiempoAdministrativo({
                    usuario:   usuarioNeotel,
                    tiempoAdm: true,
                });
                break;

            default:
                // EN_LLAMADA, WRAP_UP, OFFLINE — no se llama a la API manualmente
                break;
        }
    }
}
