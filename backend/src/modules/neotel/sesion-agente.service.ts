import {
    ConflictException,
    Injectable,
    Logger,
    NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AgenteTelefoniaService } from './agente-telefonia.service';
import { NeotelHttpClient } from './neotel-http.client';
import { NeotelRedisService } from './neotel-redis.service';

export interface SesionActivaResponse {
    sesionId: number;
    usuarioNeotel: string;
    device: string;
    conectado: true;
    loginAt: Date;
    campañaActivaId: number | null;
    estado: string;
}

export interface LogoutResponse {
    ok: true;
}

@Injectable()
export class SesionAgenteService {
    private readonly logger = new Logger(SesionAgenteService.name);

    constructor(
        private readonly prisma:   PrismaService,
        private readonly agenteSvc: AgenteTelefoniaService,
        private readonly neotel:   NeotelHttpClient,
        private readonly redis:    NeotelRedisService,
    ) {}

    // ─────────────────────────────────────────────────────────────────────────
    // loginAgente
    // ─────────────────────────────────────────────────────────────────────────

    async loginAgente(
        usuarioId: number,
        meta: { ip?: string; userAgent?: string } = {},
    ): Promise<SesionActivaResponse> {
        // 1. Verificar sesión ya abierta (validación de doble sesión)
        const sesionExistente = await this.getSesionActivaDesdeDb(usuarioId);
        if (sesionExistente) {
            throw new ConflictException(
                `El usuario ${usuarioId} ya tiene una sesión Neotel abierta (sesionId=${sesionExistente.id}). Cerrá la sesión anterior antes de iniciar una nueva.`,
            );
        }

        // 2. Obtener credenciales Neotel del agente
        const credenciales = await this.agenteSvc.getCredencialesNeotelParaUsuario(usuarioId);
        const agente = await this.prisma.agente_telefonia.findUniqueOrThrow({
            where: { usuarioId },
        });

        // 3. Login en Neotel (puede lanzar error de negocio — lo dejamos burbujear)
        this.logger.log(`Iniciando login Neotel para usuario=${usuarioId} extensión=${credenciales.device}`);
        await this.neotel.login({
            device:  credenciales.device,
            usuario: credenciales.usuarioNeotel,
            clave:   credenciales.claveNeotel,
        });

        // 4. Crear registro de sesión en DB
        const sesion = await this.prisma.sesion_agente_neotel.create({
            data: {
                agenteId:      agente.id,
                usuarioNeotel: credenciales.usuarioNeotel,
                device:        credenciales.device,
                ipCliente:     meta.ip ?? null,
                userAgent:     meta.userAgent ?? null,
            },
        });

        this.logger.log(`Sesión Neotel creada: sesionId=${sesion.id} usuario=${usuarioId}`);

        // 5. Crear evento de estado inicial DISPONIBLE
        await this.prisma.estado_agente_evento.create({
            data: {
                sesionId: sesion.id,
                estado:   'DISPONIBLE',
                origen:   'sistema',
            },
        });

        // 6. Cachear en Redis
        await this.redis.setSesion(usuarioId, {
            sesionId:      String(sesion.id),
            usuarioNeotel: sesion.usuarioNeotel,
            device:        sesion.device,
            loginAt:       sesion.loginAt.toISOString(),
            estado:        'DISPONIBLE',
        });
        await this.redis.setEstado(usuarioId, {
            estado: 'DISPONIBLE',
            desde:  sesion.loginAt.toISOString(),
        });

        return {
            sesionId:        sesion.id,
            usuarioNeotel:   sesion.usuarioNeotel,
            device:          sesion.device,
            conectado:       true,
            loginAt:         sesion.loginAt,
            campañaActivaId: null,
            estado:          'DISPONIBLE',
        };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // logoutAgente
    // ─────────────────────────────────────────────────────────────────────────

    async logoutAgente(usuarioId: number): Promise<LogoutResponse> {
        const sesion = await this.getSesionActivaDesdeDb(usuarioId);
        if (!sesion) {
            throw new NotFoundException(`El usuario ${usuarioId} no tiene sesión Neotel activa`);
        }

        const credenciales = await this.agenteSvc.getCredencialesNeotelParaUsuario(usuarioId);

        // 1. Logout en Neotel (intentar siempre; si falla, cerramos igual con causa 'error_neotel')
        let causaCierre = 'logout_manual';
        try {
            await this.neotel.logout(credenciales.usuarioNeotel);
        } catch (err) {
            this.logger.warn(`Error al llamar Neotel.Logout para usuario=${usuarioId}: ${(err as Error).message}. Se cierra sesión local igual.`);
            causaCierre = 'error_neotel';
        }

        const ahora = new Date();

        // 2. Cerrar evento de estado abierto
        await this.cerrarEventoEstadoAbierto(sesion.id, ahora);

        // 3. Marcar sesión como cerrada en DB
        await this.prisma.sesion_agente_neotel.update({
            where: { id: sesion.id },
            data: {
                logoutAt:    ahora,
                causaCierre,
            },
        });

        this.logger.log(`Sesión Neotel cerrada: sesionId=${sesion.id} usuario=${usuarioId} causa=${causaCierre}`);

        // 4. Invalida cache Redis
        await this.redis.deleteSesion(usuarioId);
        await this.redis.deleteEstado(usuarioId);

        return { ok: true };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // getSesionActiva
    // ─────────────────────────────────────────────────────────────────────────

    async getSesionActiva(usuarioId: number): Promise<SesionActivaResponse | null> {
        // 1. Intentar desde Redis
        const cache = await this.redis.getSesion(usuarioId);
        if (cache) {
            return {
                sesionId:        parseInt(cache.sesionId, 10),
                usuarioNeotel:   cache.usuarioNeotel,
                device:          cache.device,
                conectado:       true,
                loginAt:         new Date(cache.loginAt),
                campañaActivaId: cache.campañaActivaId ? parseInt(cache.campañaActivaId, 10) : null,
                estado:          cache.estado,
            };
        }

        // 2. Fallback a DB
        const sesion = await this.getSesionActivaDesdeDb(usuarioId);
        if (!sesion) return null;

        // Reconstruir estado actual desde el último evento
        const ultimoEvento = await this.prisma.estado_agente_evento.findFirst({
            where:   { sesionId: sesion.id, endedAt: null },
            orderBy: { startedAt: 'desc' },
        });
        const estadoActual = ultimoEvento?.estado ?? 'DISPONIBLE';

        // Obtener campaña activa (última sesion_campania sin leftAt)
        const campañaActiva = await this.prisma.campaña_sesion_neotel.findFirst({
            where:   { sesionId: sesion.id, leftAt: null },
            orderBy: { enteredAt: 'desc' },
        });

        // Re-hidratar Redis desde DB
        await this.redis.setSesion(usuarioId, {
            sesionId:        String(sesion.id),
            usuarioNeotel:   sesion.usuarioNeotel,
            device:          sesion.device,
            loginAt:         sesion.loginAt.toISOString(),
            campañaActivaId: campañaActiva ? String(campañaActiva.campañaId) : undefined,
            estado:          estadoActual,
        });

        return {
            sesionId:        sesion.id,
            usuarioNeotel:   sesion.usuarioNeotel,
            device:          sesion.device,
            conectado:       true,
            loginAt:         sesion.loginAt,
            campañaActivaId: campañaActiva?.campañaId ?? null,
            estado:          estadoActual,
        };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Helpers internos
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Busca la sesión Neotel activa (sin logoutAt) de un usuario.
     * Retorna null si no hay sesión abierta.
     */
    async getSesionActivaDesdeDb(usuarioId: number) {
        const agente = await this.prisma.agente_telefonia.findUnique({
            where: { usuarioId },
        });
        if (!agente) return null;

        return this.prisma.sesion_agente_neotel.findFirst({
            where: {
                agenteId: agente.id,
                logoutAt: null,
            },
            orderBy: { loginAt: 'desc' },
        });
    }

    /**
     * Cierra el último estado_agente_evento abierto de una sesión.
     */
    async cerrarEventoEstadoAbierto(sesionId: number, ahora: Date): Promise<void> {
        const eventoAbierto = await this.prisma.estado_agente_evento.findFirst({
            where:   { sesionId, endedAt: null },
            orderBy: { startedAt: 'desc' },
        });

        if (!eventoAbierto) return;

        const duracionSeg = Math.floor(
            (ahora.getTime() - eventoAbierto.startedAt.getTime()) / 1000,
        );

        await this.prisma.estado_agente_evento.update({
            where: { id: eventoAbierto.id },
            data:  { endedAt: ahora, duracionSeg },
        });
    }
}
