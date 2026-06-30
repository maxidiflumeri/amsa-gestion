/**
 * ConsolidacionRedisLockService
 *
 * Gestiona el lock Redis distribuido `lock:consolidacion` que garantiza
 * que solo un job de consolidación manual corra a la vez.
 *
 * Patrón: SET NX EX (atómico). El processor lo libera en el bloque finally.
 * El endpoint GET /estado lee la metadata almacenada junto al lock.
 *
 * TTL: 15 minutos (estimado conservador para 17k+ deudores).
 * Si el job muere sin soltar el lock, Redis lo expira automáticamente.
 */
import {
    Injectable,
    Logger,
    OnModuleDestroy,
    OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';

const LOCK_KEY = 'lock:consolidacion';
const META_KEY = 'lock:consolidacion:meta';
const LOCK_TTL_SEG = 15 * 60; // 15 minutos

export interface ConsolidacionLockMeta {
    jobId: string;
    usuarioId: number;
    iniciadoEn: string; // ISO 8601
}

@Injectable()
export class ConsolidacionRedisLockService implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(ConsolidacionRedisLockService.name);
    private client!: Redis;

    constructor(private readonly config: ConfigService) {}

    onModuleInit(): void {
        this.client = new Redis({
            host: this.config.get<string>('REDIS_HOST', 'localhost'),
            port: this.config.get<number>('REDIS_PORT', 6379),
            lazyConnect: true,
        });

        this.client.on('error', (err: Error) => {
            this.logger.error(`Redis error (lock): ${err.message}`, err.stack);
        });
    }

    async onModuleDestroy(): Promise<void> {
        try {
            await this.client.quit();
        } catch (err) {
            this.logger.warn(`Error al cerrar conexión Redis (lock): ${(err as Error).message}`);
        }
    }

    /**
     * Intenta tomar el lock.
     * Retorna true si lo tomó, false si ya estaba tomado.
     */
    async tryAcquire(meta: ConsolidacionLockMeta): Promise<boolean> {
        try {
            // SET NX EX — atómico: solo se escribe si la clave NO existe
            const result = await this.client.set(LOCK_KEY, '1', 'EX', LOCK_TTL_SEG, 'NX');
            if (result !== 'OK') {
                return false;
            }
            // Guardar metadata en clave separada con mismo TTL
            await this.client.set(META_KEY, JSON.stringify(meta), 'EX', LOCK_TTL_SEG);
            return true;
        } catch (err) {
            this.logger.error(
                `Error al intentar tomar lock:consolidacion: ${(err as Error).message}`,
                (err as Error).stack,
            );
            // Modo degradado: si Redis no responde, permitimos el encolado
            // para no bloquear al usuario. Se documenta el riesgo en el spec §10.5.
            return true;
        }
    }

    /**
     * Actualiza la metadata del lock (p. ej. con el jobId real) SIN re-tomar el lock.
     * Usar después de encolar el job, cuando ya se conoce el jobId definitivo.
     * No usa NX: sobreescribe la metadata existente manteniendo el TTL del lock.
     */
    async updateMeta(meta: ConsolidacionLockMeta): Promise<void> {
        try {
            await this.client.set(META_KEY, JSON.stringify(meta), 'EX', LOCK_TTL_SEG);
        } catch (err) {
            this.logger.warn(
                `Error al actualizar metadata de lock:consolidacion: ${(err as Error).message}`,
            );
        }
    }

    /**
     * Libera el lock y borra la metadata.
     * Llamar siempre en el bloque finally del processor (solo en jobs apply).
     */
    async release(): Promise<void> {
        try {
            await this.client.del(LOCK_KEY, META_KEY);
        } catch (err) {
            this.logger.warn(
                `Error al liberar lock:consolidacion: ${(err as Error).message}`,
            );
        }
    }

    /**
     * Lee el estado actual del lock sin modificarlo.
     * Retorna null si no hay lock activo.
     */
    async getEstado(): Promise<{ enCurso: boolean; meta?: ConsolidacionLockMeta }> {
        try {
            const [lockVal, metaRaw] = await this.client.mget(LOCK_KEY, META_KEY);
            if (!lockVal) {
                return { enCurso: false };
            }
            let meta: ConsolidacionLockMeta | undefined;
            if (metaRaw) {
                try {
                    meta = JSON.parse(metaRaw) as ConsolidacionLockMeta;
                } catch {
                    // metadata corrupta: la ignoramos
                }
            }
            return { enCurso: true, meta };
        } catch (err) {
            this.logger.warn(
                `Error al leer estado de lock:consolidacion: ${(err as Error).message}`,
            );
            // Modo degradado: retornar false (no bloquear consultas de estado)
            return { enCurso: false };
        }
    }
}
