import { INestApplicationContext, Logger } from '@nestjs/common';
import type { Duplex } from 'stream';
import { CierreOrdenadoService } from './cierre-ordenado.service';

/** Lo que espera Nest a que los sockets contesten el cierre antes de cortarlos (fase 2). */
export const CORTE_SOCKETS_MS = 1000;

/** El servidor HTTP, si la app lo tiene (un contexto sin HTTP no lo tiene). Solo hace falta escuchar `upgrade`. */
interface ServidorConUpgrade {
    on(evento: 'upgrade', f: (req: unknown, socket: Duplex) => void): unknown;
}

function servidorHttp(app: INestApplicationContext): ServidorConUpgrade | null {
    try {
        const s = (app as { getHttpServer?: () => unknown }).getHttpServer?.();
        return s && typeof (s as ServidorConUpgrade).on === 'function' ? (s as ServidorConUpgrade) : null;
    } catch {
        return null;
    }
}

export interface DepsCierre {
    proceso: Pick<NodeJS.Process, 'on'>;
    salir: (codigo: number) => void;
    env: NodeJS.ProcessEnv;
}

export interface TopesCierre {
    esperaTrabajosMs: number;
    appMs: number;
    totalMs: number;
}

function leerEntero(valor: string | undefined, porDefecto: number, min: number, max: number): number {
    const n = valor === undefined || valor.trim() === '' ? NaN : Number(valor);
    if (!Number.isFinite(n)) return porDefecto;
    return Math.min(max, Math.max(min, Math.trunc(n)));
}

/** Topes del cierre, del entorno y acotados (spec §19.2). El total nunca es menor que la suma de los otros + 2 s. */
export function leerTopesCierre(env: NodeJS.ProcessEnv): TopesCierre {
    const esperaTrabajosMs = leerEntero(env.CIERRE_ESPERA_TRABAJOS_MS, 75000, 1000, 600000);
    const appMs = leerEntero(env.CIERRE_APP_MS, 10000, 1000, 120000);
    const totalMin = esperaTrabajosMs + appMs + 2000;
    const totalMs = Math.max(totalMin, leerEntero(env.CIERRE_TOPE_TOTAL_MS, 90000, 1000, 1000000));
    return { esperaTrabajosMs, appMs, totalMs };
}

/**
 * Handler propio de SIGTERM/SIGINT en lugar de `enableShutdownHooks` (spec imports-progreso-c3 §19.2):
 * drena, cierra la app con tope y sale con `process.exit` (el proceso 1 de un contenedor ignora señales sin handler).
 */
export function instalarCierreOrdenado(app: INestApplicationContext, deps?: Partial<DepsCierre>): void {
    const logger = new Logger('CierreOrdenado');
    const proceso = deps?.proceso ?? process;
    const salir = deps?.salir ?? ((c: number) => process.exit(c));
    const topes = leerTopesCierre(deps?.env ?? process.env);
    let cerrando = false;

    // Las conexiones de socket.io (WebSocket). Nest cierra socket.io con el cierre del WebSocket, que espera la
    // respuesta del navegador: una pestaña cuyo equipo murió no contesta y la fase 2 llegaba a su tope de 10 s.
    const conexionesWs = new Set<Duplex>();
    servidorHttp(app)?.on('upgrade', (_req, socket) => {
        conexionesWs.add(socket);
        socket.once('close', () => conexionesWs.delete(socket));
    });

    const alSenal = async (senal: string): Promise<void> => {
        if (cerrando) {
            logger.warn(`Cierre ordenado: llegó ${senal} otra vez; ya se está cerrando`);
            return;
        }
        cerrando = true;
        const t0 = Date.now();
        const vigia = setTimeout(() => {
            logger.error(`Cierre ordenado: pasaron ${topes.totalMs} ms sin terminar; sale con código 1`);
            salir(1);
        }, topes.totalMs);
        vigia.unref();

        let codigo = 0;
        try {
            const drenaje = await app.get(CierreOrdenadoService, { strict: false }).drenar(senal, topes.esperaTrabajosMs);
            if (!drenaje.completo) {
                // Con un trabajo todavía vivo, cerrar Nest le desconecta Prisma en medio de un lote: falla con errores
                // que parecen reales y ni siquiera puede marcar la carga. Se sale sin cerrar, como un SIGKILL, y lo
                // cierra el reaper o el cron (spec §19.7).
                logger.warn('Cierre ordenado: sale sin cerrar Nest para no cortarle la base a lo que sigue en curso');
                codigo = 1;
            } else {
                let timer: NodeJS.Timeout | undefined;
                let corte: NodeJS.Timeout | undefined;
                const cerro = await Promise.race([
                    app.close().then(() => true),
                    new Promise<boolean>((resolve) => {
                        timer = setTimeout(() => resolve(false), topes.appMs);
                        corte = setTimeout(() => {
                            if (conexionesWs.size === 0) return;
                            logger.warn(
                                `Cierre ordenado: ${conexionesWs.size} conexión(es) de socket no contestaron el cierre ` +
                                    `en ${CORTE_SOCKETS_MS} ms; se cortan`,
                            );
                            for (const s of conexionesWs) s.destroy();
                        }, CORTE_SOCKETS_MS);
                    }),
                ]);
                if (timer) clearTimeout(timer);
                if (corte) clearTimeout(corte);
                if (!cerro) {
                    logger.warn(`Cierre ordenado: Nest no terminó de cerrar en ${topes.appMs} ms`);
                    codigo = 1;
                }
            }
        } catch (err) {
            logger.error(`Cierre ordenado falló: ${(err as Error).message}`, (err as Error).stack);
            codigo = 1;
        }
        clearTimeout(vigia);
        logger.log(`Cierre ordenado terminado en ${Date.now() - t0} ms; sale con código ${codigo}`);
        salir(codigo);
    };

    proceso.on('SIGTERM', () => void alSenal('SIGTERM'));
    proceso.on('SIGINT', () => void alSenal('SIGINT'));
    logger.log(
        `Cierre ordenado listo: espera hasta ${topes.esperaTrabajosMs} ms, Nest ${topes.appMs} ms, vigía ${topes.totalMs} ms`,
    );
}
