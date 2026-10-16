import { Injectable, Logger, Optional } from '@nestjs/common';
import { DiscoveryService } from '@nestjs/core';
import { SchedulerRegistry } from '@nestjs/schedule';
import { WorkerHost } from '@nestjs/bullmq';
import { CortablePorCierre, esCortablePorCierre } from './cortable-por-cierre';

export interface ResultadoDrenaje {
    completo: boolean;
    ms: number;
}

/**
 * Fase 1 del cierre ordenado (spec imports-progreso-c3 §19.2): deja de aceptar trabajo nuevo y pide el corte
 * a lo que está corriendo. Nunca tira: cada paso va en su try/catch.
 */
@Injectable()
export class CierreOrdenadoService {
    private readonly logger = new Logger('CierreOrdenado');

    constructor(
        private readonly discovery: DiscoveryService,
        @Optional() private readonly scheduler?: SchedulerRegistry,
    ) {}

    async drenar(senal: string, topeMs: number): Promise<ResultadoDrenaje> {
        const t0 = Date.now();
        const workers = this.descubrirWorkers();
        const cortables = this.descubrirCortables();

        const enCurso = this.trabajosEnCurso(cortables);
        this.logger.log(
            `Cierre ordenado (${senal}): ${enCurso.length} trabajo${enCurso.length === 1 ? '' : 's'} en curso ` +
                `[${enCurso.join('; ')}]; espera hasta ${topeMs} ms`,
        );

        this.detenerCrons();

        // Primero cerrar los workers (dejan de tomar jobs), después pedir el corte: si fuera al revés, la carga
        // cortada terminaría y el worker tomaría el siguiente job de la cola antes de cerrarse.
        const cierres = workers.map((w) => this.cerrarWorker(w.nombre, w.worker));
        for (const c of cortables) {
            try {
                c.cortarPorCierre();
            } catch (err) {
                this.logger.error(`Cierre ordenado: cortarPorCierre() falló: ${(err as Error).message}`, (err as Error).stack);
            }
        }

        let timer: NodeJS.Timeout | undefined;
        const resultado = await Promise.race([
            Promise.all(cierres).then(() => true),
            new Promise<boolean>((resolve) => {
                timer = setTimeout(() => resolve(false), topeMs);
            }),
        ]);
        if (timer) clearTimeout(timer);

        const ms = Date.now() - t0;
        if (resultado) {
            this.logger.log(
                `Cierre ordenado: ${workers.length} colas cerradas y sin trabajos en curso en ${ms} ms`,
            );
        } else {
            const quedan = this.trabajosEnCurso(cortables);
            this.logger.warn(
                `Cierre ordenado: a los ${ms} ms siguen en curso [${quedan.join('; ')}]; ` +
                    `se cortan con el proceso (los cierra el reaper o el cron)`,
            );
        }
        return { completo: resultado, ms };
    }

    private descubrirWorkers(): Array<{ nombre: string; worker: { close(): Promise<void> } }> {
        const salida: Array<{ nombre: string; worker: { close(): Promise<void> } }> = [];
        try {
            for (const wrapper of this.discovery.getProviders()) {
                const inst = wrapper.instance;
                if (!inst || !(inst instanceof WorkerHost)) continue;
                try {
                    const w = inst.worker;
                    if (w) salida.push({ nombre: wrapper.name?.toString() ?? inst.constructor.name, worker: w });
                } catch (err) {
                    this.logger.warn(`Cierre ordenado: no se pudo leer el worker de ${inst.constructor.name}: ${(err as Error).message}`);
                }
            }
        } catch (err) {
            this.logger.error(`Cierre ordenado: no se pudieron descubrir los workers: ${(err as Error).message}`, (err as Error).stack);
        }
        return salida;
    }

    private descubrirCortables(): CortablePorCierre[] {
        const salida: CortablePorCierre[] = [];
        try {
            for (const wrapper of this.discovery.getProviders()) {
                if (esCortablePorCierre(wrapper.instance)) salida.push(wrapper.instance);
            }
        } catch (err) {
            this.logger.error(`Cierre ordenado: no se pudieron descubrir los cortables: ${(err as Error).message}`, (err as Error).stack);
        }
        return salida;
    }

    private trabajosEnCurso(cortables: CortablePorCierre[]): string[] {
        const lineas: string[] = [];
        for (const c of cortables) {
            try {
                lineas.push(...c.trabajosEnCurso());
            } catch (err) {
                this.logger.warn(`Cierre ordenado: trabajosEnCurso() falló: ${(err as Error).message}`);
            }
        }
        return lineas;
    }

    private detenerCrons(): void {
        if (!this.scheduler) return;
        try {
            for (const [nombre, job] of this.scheduler.getCronJobs()) {
                try {
                    void job.stop();
                } catch (err) {
                    this.logger.warn(`Cierre ordenado: no se pudo detener el cron ${nombre}: ${(err as Error).message}`);
                }
            }
        } catch (err) {
            this.logger.warn(`Cierre ordenado: no se pudieron listar los crons: ${(err as Error).message}`);
        }
    }

    private async cerrarWorker(nombre: string, worker: { close(): Promise<void> }): Promise<void> {
        try {
            await worker.close();
        } catch (err) {
            this.logger.warn(`Cierre ordenado: el worker ${nombre} no cerró limpio: ${(err as Error).message}`);
        }
    }
}
