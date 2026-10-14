import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ReaperCargasService, reaperDesactivado } from './reaper-cargas.service';
import { ReversionAccionesService } from '../reversion/reversion-acciones.service';

/**
 * Los tres crons del módulo de importaciones (docs/imports-progreso-realtime-spec.md §9.5.6 y §9.5.7).
 * Los primeros del módulo. `ScheduleModule.forRoot()` ya está en `reportes.module.ts` y descubre los
 * `@Cron` de toda la aplicación. `IMPORTS_REAPER_DESACTIVADO` los apaga a los tres sin desplegar.
 */
@Injectable()
export class ReaperCargasScheduler {
    private readonly logger = new Logger(ReaperCargasScheduler.name);

    constructor(
        private readonly reaper: ReaperCargasService,
        private readonly reversiones: ReversionAccionesService,
    ) {}

    /** Cada minuto: cierra las cargas cuyo worker murió. Nunca cierra en una sola pasada. */
    @Cron(CronExpression.EVERY_MINUTE)
    async cargasColgadas(): Promise<void> {
        try {
            await this.reaper.revisarCargasColgadas();
        } catch (e: any) {
            this.logger.error(`Error en el reaper de cargas colgadas: ${e?.message}`, e?.stack);
        }
    }

    /** Cada minuto: pasa a INTERRUMPIDA la reversión de una acción masiva que un reinicio dejó a medias (C3b, §17.5.6). */
    @Cron(CronExpression.EVERY_MINUTE)
    async reversionesColgadas(): Promise<void> {
        if (reaperDesactivado()) return;
        try {
            await this.reversiones.revisarReversionesColgadas();
        } catch (e: any) {
            this.logger.error(`Error en el cron de reversiones colgadas: ${e?.message}`, e?.stack);
        }
    }

    /** 04:30 del reloj del contenedor, que fija `TZ=America/Argentina/Buenos_Aires` (Dockerfile.backend): 04:30 de Argentina, después de los crons de promesas (2), cuotas (3) y mora (4). */
    @Cron('30 4 * * *')
    async borradores(): Promise<void> {
        try {
            await this.reaper.limpiarBorradores();
        } catch (e: any) {
            this.logger.error(`Error en el reaper de borradores: ${e?.message}`, e?.stack);
        }
    }
}
