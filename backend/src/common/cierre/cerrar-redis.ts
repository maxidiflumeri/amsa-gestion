import type { Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';

/** Cuánto espera el `quit()` de ioredis antes de cortar la conexión. */
export const CIERRE_REDIS_MS = 2000;

/**
 * Cierra un cliente ioredis sin colgar el apagado (spec imports-progreso-c3 §19.4.6). Sin conexión (`wait`: nunca
 * conectó, `end`: ya cerró) alcanza con `disconnect()`. Con Redis caído, `quit()` encola y reintenta ~10 s antes de
 * rechazar: se le da `CIERRE_REDIS_MS` y se corta con `disconnect()` en el `finally`. Nunca tira.
 */
export async function cerrarRedisAcotado(
    client: Pick<Redis, 'status' | 'quit' | 'disconnect'> | undefined,
    nombre: string,
    logger: Logger,
    topeMs = CIERRE_REDIS_MS,
): Promise<void> {
    if (!client) return;
    const t0 = Date.now();
    if (client.status === 'wait' || client.status === 'end') {
        client.disconnect();
        return;
    }
    let timer: NodeJS.Timeout | undefined;
    try {
        const resultado = await Promise.race([
            client.quit().then(() => 'ok' as const),
            new Promise<'tope'>((resolve) => {
                timer = setTimeout(() => resolve('tope'), topeMs);
            }),
        ]);
        if (resultado === 'tope') logger.warn(`Conexión Redis (${nombre}): quit() no respondió en ${topeMs} ms; se corta la conexión`);
    } catch (err) {
        logger.warn(`Error al cerrar conexión Redis (${nombre}): ${(err as Error).message}`);
    } finally {
        if (timer) clearTimeout(timer);
        try {
            client.disconnect();
        } catch {
            // ya cerrada
        }
    }
    logger.log(`Conexión Redis (${nombre}) cerrada en ${Date.now() - t0} ms`);
}
