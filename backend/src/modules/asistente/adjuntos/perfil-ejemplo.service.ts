import { Injectable, Logger } from '@nestjs/common';
import * as path from 'path';
import { Worker } from 'worker_threads';
import { SemaforoReportes } from '../reportes/semaforo';
import { ErrorPerfil, MapaReconocibles, PerfilConAvisos, perfilarArchivo } from './perfil-ejemplo';

export const TIMEOUT_PERFIL_MS = 5_000;
export const CUPOS_PERFILADO = 2;
export const ESPERA_PERFILADO_MS = 30_000;
const LIMITES_WORKER = { maxOldGenerationSizeMb: 256, maxYoungGenerationSizeMb: 64 };

/**
 * Perfila un archivo de ejemplo en un `worker_thread` con límites de memoria (256 MB) y de tiempo (5 s)
 * (docs/asistente-reportes-spec.md §9.4). Si el tiempo se pasa, el hilo se termina y la persona ve «tardó demasiado».
 * Nest compila el worker a `dist/modules/asistente/adjuntos/perfil-ejemplo.worker.js`: no hace falta tocar nest-cli.json.
 */
@Injectable()
export class PerfilEjemploService {
    private readonly logger = new Logger(PerfilEjemploService.name);

    /** Público para que un test lo baje. */
    timeoutMs: number = TIMEOUT_PERFIL_MS;
    /**
     * Cuántos archivos se leen a la vez en todo el backend. Un .xlsx de 337 KB que se descomprime a 110 MB suma +341 MB de RSS
     * fuera del heap (el límite del worker no lo acota): cuatro a la vez dieron +1,3 GB de pico. El resto espera en cola.
     */
    readonly semaforo = new SemaforoReportes(CUPOS_PERFILADO);
    esperaMs = ESPERA_PERFILADO_MS;

    async perfilar(buffer: Buffer, nombre: string, reconocibles: MapaReconocibles): Promise<PerfilConAvisos> {
        // Solo en los tests: sin hilo. En producción no se puede activar (el parser quedaría en el hilo principal).
        if (process.env.ASISTENTE_PERFIL_EN_LINEA === '1' && process.env.NODE_ENV !== 'production') return perfilarArchivo(buffer, nombre, reconocibles);

        const liberar = await this.semaforo.adquirir(this.esperaMs);
        if (!liberar) {
            this.logger.warn('Hay demasiados archivos leyéndose a la vez: se rechaza uno');
            throw new ErrorPerfil('OCUPADO', 'Hay varios archivos leyéndose en este momento. Probá de nuevo en unos segundos.');
        }
        try {
            return await this.leerEnHilo(buffer, nombre, reconocibles);
        } finally {
            liberar();
        }
    }

    private async leerEnHilo(buffer: Buffer, nombre: string, reconocibles: MapaReconocibles): Promise<PerfilConAvisos> {
        const t0 = Date.now();
        const archivo = path.join(__dirname, __filename.endsWith('.ts') ? 'perfil-ejemplo.worker.ts' : 'perfil-ejemplo.worker.js');
        const workerData = { buffer: new Uint8Array(buffer), nombre, reconocibles };
        const opciones = { workerData, resourceLimits: LIMITES_WORKER };
        // En los tests el worker es TypeScript: se lo carga con ts-node.
        const worker = __filename.endsWith('.ts')
            ? new Worker(`require('ts-node').register({ transpileOnly: true }); require(${JSON.stringify(archivo)});`, { ...opciones, eval: true })
            : new Worker(archivo, opciones);

        return new Promise<PerfilConAvisos>((resolver, rechazar) => {
            let terminado = false;
            const fin = (accion: () => void) => {
                if (terminado) return;
                terminado = true;
                clearTimeout(timer);
                void worker.terminate();
                accion();
            };
            const timer = setTimeout(() => {
                this.logger.warn(`El archivo tardó más de ${this.timeoutMs}ms en leerse: se cortó el hilo`);
                fin(() => rechazar(new ErrorPerfil('ILEGIBLE', 'El archivo tardó demasiado en leerse.')));
            }, this.timeoutMs);

            worker.once('message', (m: { ok: true; perfil: PerfilConAvisos } | { ok: false; codigo: ErrorPerfil['codigo']; mensaje: string }) => {
                fin(() => {
                    if (m.ok) {
                        this.logger.log(`Archivo de ejemplo leído en ${Date.now() - t0}ms (${buffer.length} bytes)`);
                        resolver(m.perfil);
                    } else rechazar(new ErrorPerfil(m.codigo, m.mensaje));
                });
            });
            worker.once('error', (e: Error & { code?: string }) => {
                const memoria = e?.code === 'ERR_WORKER_OUT_OF_MEMORY';
                this.logger.warn(`Falló el hilo que lee el archivo de ejemplo: ${e?.code ?? e?.name}`);
                fin(() => rechazar(new ErrorPerfil('ILEGIBLE', memoria ? 'El archivo es demasiado grande para leerlo.' : 'No pude leer el archivo: parece dañado.')));
            });
            worker.once('exit', (codigo) => {
                if (codigo !== 0) fin(() => rechazar(new ErrorPerfil('ILEGIBLE', 'No pude leer el archivo: parece dañado.')));
            });
        });
    }
}
