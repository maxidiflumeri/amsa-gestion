import {
    Injectable,
    Logger,
    NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { SipCryptoService } from './crypto/sip-crypto.service';
import type {
    AgenteTelefoniaResponse,
    CreateAgenteTelefoniaDto,
    SipCredentialsResponse,
    UpdateAgenteTelefoniaDto,
} from './dto/neotel-api.dto';

@Injectable()
export class AgenteTelefoniaService {
    private readonly logger = new Logger(AgenteTelefoniaService.name);

    constructor(
        private readonly prisma:  PrismaService,
        private readonly crypto:  SipCryptoService,
        private readonly config:  ConfigService,
    ) {}

    // ─────────────────────────────────────────────────────────────────────────
    // CREDENCIALES SIP PARA EL USUARIO LOGUEADO
    // ─────────────────────────────────────────────────────────────────────────

    async getCredencialesParaUsuario(usuarioId: number): Promise<SipCredentialsResponse> {
        const agente = await this.prisma.agente_telefonia.findUnique({
            where: { usuarioId },
        });

        if (!agente) {
            throw new NotFoundException(`El usuario ${usuarioId} no tiene agente de telefonía configurado`);
        }

        if (!agente.habilitado) {
            throw new NotFoundException(`El agente de telefonía del usuario ${usuarioId} está deshabilitado`);
        }

        const sipDomain = this.config.get<string>('NEOTEL_SIP_DOMAIN', '200.5.98.203');
        const wssUrl    = this.config.get<string>('NEOTEL_WSS_URL',    'wss://200.5.98.203:8089/ws');

        let sipPassword: string;
        try {
            sipPassword = this.crypto.isEncrypted(agente.sipPasswordEnc)
                ? this.crypto.decrypt(agente.sipPasswordEnc)
                : agente.sipPasswordEnc; // plain text legacy — aún sin cifrar
        } catch (err) {
            this.logger.error(`No se pudo descifrar sipPassword del agente ${agente.id}: ${(err as Error).message}`);
            throw err;
        }

        return {
            extension:   agente.device,
            sipUri:      `sip:${agente.sipAuthUser}@${sipDomain}`,
            authUser:    agente.sipAuthUser,
            password:    sipPassword,
            wssUrl,
            displayName: agente.sipDisplayName ?? agente.sipAuthUser,
        };
    }

    /**
     * Devuelve las credenciales Neotel API (usuario + clave descifrada) para un agente.
     * Solo para uso interno del backend — nunca enviar al frontend.
     */
    async getCredencialesNeotelParaUsuario(usuarioId: number): Promise<{ usuarioNeotel: string; claveNeotel: string; device: string }> {
        const agente = await this.prisma.agente_telefonia.findUnique({
            where: { usuarioId },
        });

        if (!agente) {
            throw new NotFoundException(`El usuario ${usuarioId} no tiene agente de telefonía configurado`);
        }

        let claveNeotel: string;
        try {
            claveNeotel = this.crypto.isEncrypted(agente.claveNeotelEnc)
                ? this.crypto.decrypt(agente.claveNeotelEnc)
                : agente.claveNeotelEnc; // plain text legacy
        } catch (err) {
            this.logger.error(`No se pudo descifrar claveNeotelEnc del agente ${agente.id}`);
            throw err;
        }

        return {
            usuarioNeotel: agente.usuarioNeotel,
            claveNeotel,
            device:        agente.device,
        };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // ABM ADMIN
    // ─────────────────────────────────────────────────────────────────────────

    async listar(): Promise<AgenteTelefoniaResponse[]> {
        const agentes = await this.prisma.agente_telefonia.findMany({
            orderBy: { id: 'asc' },
        });
        return agentes.map(this.mapToResponse);
    }

    async crear(dto: CreateAgenteTelefoniaDto): Promise<AgenteTelefoniaResponse> {
        const claveNeotelEnc = this.crypto.encrypt(dto.claveNeotel);
        const sipPasswordEnc = this.crypto.encrypt(dto.sipPassword);

        const agente = await this.prisma.agente_telefonia.create({
            data: {
                usuarioId:      dto.usuarioId,
                usuarioNeotel:  dto.usuarioNeotel,
                claveNeotelEnc,
                device:         dto.device,
                sipAuthUser:    dto.sipAuthUser,
                sipPasswordEnc,
                sipDisplayName: dto.sipDisplayName ?? null,
                habilitado:     dto.habilitado ?? true,
            },
        });

        this.logger.log(`Agente creado: id=${agente.id} usuarioId=${agente.usuarioId} extensión=${agente.device}`);
        return this.mapToResponse(agente);
    }

    async actualizar(id: number, dto: UpdateAgenteTelefoniaDto): Promise<AgenteTelefoniaResponse> {
        await this.findOrFail(id);

        const data: Record<string, unknown> = {};
        if (dto.usuarioNeotel  !== undefined) data.usuarioNeotel  = dto.usuarioNeotel;
        if (dto.claveNeotel    !== undefined) data.claveNeotelEnc = this.crypto.encrypt(dto.claveNeotel);
        if (dto.device         !== undefined) data.device         = dto.device;
        if (dto.sipAuthUser    !== undefined) data.sipAuthUser    = dto.sipAuthUser;
        if (dto.sipPassword    !== undefined) data.sipPasswordEnc = this.crypto.encrypt(dto.sipPassword);
        if (dto.sipDisplayName !== undefined) data.sipDisplayName = dto.sipDisplayName;
        if (dto.habilitado     !== undefined) data.habilitado     = dto.habilitado;

        const agente = await this.prisma.agente_telefonia.update({
            where: { id },
            data:  data as Parameters<typeof this.prisma.agente_telefonia.update>[0]['data'],
        });

        this.logger.log(`Agente actualizado: id=${agente.id}`);
        return this.mapToResponse(agente);
    }

    async eliminar(id: number): Promise<{ ok: true }> {
        await this.findOrFail(id);
        await this.prisma.agente_telefonia.delete({ where: { id } });
        this.logger.log(`Agente eliminado: id=${id}`);
        return { ok: true };
    }

    private async findOrFail(id: number) {
        const agente = await this.prisma.agente_telefonia.findUnique({ where: { id } });
        if (!agente) throw new NotFoundException(`Agente telefónico ${id} no encontrado`);
        return agente;
    }

    private mapToResponse(agente: {
        id: number;
        usuarioId: number;
        usuarioNeotel: string;
        device: string;
        sipAuthUser: string;
        sipDisplayName: string | null;
        habilitado: boolean;
        createdAt: Date;
        updatedAt: Date;
    }): AgenteTelefoniaResponse {
        return {
            id:             agente.id,
            usuarioId:      agente.usuarioId,
            usuarioNeotel:  agente.usuarioNeotel,
            device:         agente.device,
            sipAuthUser:    agente.sipAuthUser,
            sipDisplayName: agente.sipDisplayName,
            habilitado:     agente.habilitado,
            createdAt:      agente.createdAt,
            updatedAt:      agente.updatedAt,
        };
    }
}
