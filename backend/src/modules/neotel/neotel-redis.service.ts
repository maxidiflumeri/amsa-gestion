import {
    Injectable,
    Logger,
    OnModuleDestroy,
    OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';

/**
 * NeotelRedisService — capa de caché Redis para el estado del agente.
 *
 * Usa ioredis disponible como dependencia de bullmq.
 *
 * Keys:
 *   neotel:agente:{usuarioId}:sesion  — hash con datos de sesión activa
 *   neotel:agente:{usuarioId}:estado  — hash con estado actual del agente
 *
 * TTL:
 *   sesión: 8 h (28 800 s) — se renueva en cada login
 *   estado: sin TTL fijo; se elimina al cerrar la sesión
 */

export interface SesionCache {
    sesionId: string;           // string para evitar precisión BigInt
    usuarioNeotel: string;
    device: string;
    loginAt: string;            // ISO 8601
    campañaActivaId?: string;
    estado: string;             // 'DISPONIBLE' | 'EN_PAUSA' | etc.
}

export interface EstadoCache {
    estado: string;
    motivoPausaId?: string;
    desde: string;              // ISO 8601
}

const SESION_TTL_SEG = 8 * 60 * 60; // 8 horas

@Injectable()
export class NeotelRedisService implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(NeotelRedisService.name);
    private client!: Redis;

    constructor(private readonly config: ConfigService) {}

    onModuleInit() {
        this.client = new Redis({
            host:        this.config.get<string>('REDIS_HOST', 'localhost'),
            port:        this.config.get<number>('REDIS_PORT', 6379),
            lazyConnect: true,
        });

        this.client.on('error', (err: Error) => {
            this.logger.error(`Redis error: ${err.message}`, err.stack);
        });
        this.client.on('connect', () => this.logger.log('NeotelRedisService conectado a Redis'));
    }

    async onModuleDestroy() {
        try {
            await this.client.quit();
        } catch (err) {
            this.logger.warn(`Error al cerrar conexión Redis: ${(err as Error).message}`);
        }
    }

    // ─── Claves ───────────────────────────────────────────────────────────────

    private keySesion(usuarioId: number): string {
        return `neotel:agente:${usuarioId}:sesion`;
    }

    private keyEstado(usuarioId: number): string {
        return `neotel:agente:${usuarioId}:estado`;
    }

    // ─── Sesión ───────────────────────────────────────────────────────────────

    async setSesion(usuarioId: number, data: SesionCache): Promise<void> {
        try {
            const key = this.keySesion(usuarioId);
            const flat: Record<string, string> = {};
            for (const [k, v] of Object.entries(data)) {
                if (v !== undefined && v !== null) flat[k] = String(v);
            }
            await this.client.hset(key, flat);
            await this.client.expire(key, SESION_TTL_SEG);
        } catch (err) {
            this.logger.warn(`setSesion fallo para usuario ${usuarioId}: ${(err as Error).message}`);
        }
    }

    async getSesion(usuarioId: number): Promise<SesionCache | null> {
        try {
            const data = await this.client.hgetall(this.keySesion(usuarioId));
            if (!data || Object.keys(data).length === 0) return null;
            return data as unknown as SesionCache;
        } catch (err) {
            this.logger.warn(`getSesion fallo para usuario ${usuarioId}: ${(err as Error).message}`);
            return null;
        }
    }

    async deleteSesion(usuarioId: number): Promise<void> {
        try {
            await this.client.del(this.keySesion(usuarioId));
        } catch (err) {
            this.logger.warn(`deleteSesion fallo para usuario ${usuarioId}: ${(err as Error).message}`);
        }
    }

    async updateSesionCampaña(usuarioId: number, campañaActivaId: string | null): Promise<void> {
        try {
            const key = this.keySesion(usuarioId);
            if (campañaActivaId !== null) {
                await this.client.hset(key, 'campañaActivaId', campañaActivaId);
            } else {
                await this.client.hdel(key, 'campañaActivaId');
            }
        } catch (err) {
            this.logger.warn(`updateSesionCampaña fallo para usuario ${usuarioId}: ${(err as Error).message}`);
        }
    }

    // ─── Estado ───────────────────────────────────────────────────────────────

    async setEstado(usuarioId: number, data: EstadoCache): Promise<void> {
        try {
            const key = this.keyEstado(usuarioId);
            const flat: Record<string, string> = {};
            for (const [k, v] of Object.entries(data)) {
                if (v !== undefined && v !== null) flat[k] = String(v);
            }
            await this.client.hset(key, flat);
            // Sin TTL — el estado se borra explícitamente al hacer logout
        } catch (err) {
            this.logger.warn(`setEstado fallo para usuario ${usuarioId}: ${(err as Error).message}`);
        }
    }

    async getEstado(usuarioId: number): Promise<EstadoCache | null> {
        try {
            const data = await this.client.hgetall(this.keyEstado(usuarioId));
            if (!data || Object.keys(data).length === 0) return null;
            return data as unknown as EstadoCache;
        } catch (err) {
            this.logger.warn(`getEstado fallo para usuario ${usuarioId}: ${(err as Error).message}`);
            return null;
        }
    }

    async deleteEstado(usuarioId: number): Promise<void> {
        try {
            await this.client.del(this.keyEstado(usuarioId));
        } catch (err) {
            this.logger.warn(`deleteEstado fallo para usuario ${usuarioId}: ${(err as Error).message}`);
        }
    }

    /**
     * Verifica si Redis está disponible via PING.
     * Retorna false en modo degradado — no lanza excepción.
     */
    async ping(): Promise<boolean> {
        try {
            const res = await this.client.ping();
            return res === 'PONG';
        } catch {
            return false;
        }
    }

    /**
     * Expone el cliente nativo para uso avanzado (T6 poller, etc.).
     * Solo para uso interno del módulo neotel.
     */
    getClient(): Redis {
        return this.client;
    }
}
