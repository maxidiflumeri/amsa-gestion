import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ConveniosService } from './convenios.service';

/**
 * Marca las cuotas de convenio vencidas, una vez por día.
 *
 * `updateEstadosCuotas()` existía desde siempre y **no la llamaba nadie**: el estado VENCIDA no lo
 * escribía ningún camino, así que una cuota impaga se quedaba en PENDIENTE para siempre y no había
 * forma de distinguir "todavía no vence" de "no pagó".
 *
 * Corre a las 3 AM, después del cron de promesas vencidas, para no pisarse.
 */
@Injectable()
export class ConveniosScheduler {
    private readonly logger = new Logger(ConveniosScheduler.name);

    constructor(private readonly convenios: ConveniosService) {}

    @Cron(CronExpression.EVERY_DAY_AT_3AM)
    async revisarCuotasVencidas(): Promise<void> {
        try {
            const r = await this.convenios.updateEstadosCuotas();
            if (r.count > 0) {
                this.logger.log(`Cron de cuotas vencidas: ${r.count} cuota(s) pasaron a VENCIDA`);
            }
        } catch (e: any) {
            this.logger.error(`Error en cron de cuotas vencidas: ${e?.message}`, e?.stack);
        }
    }
}
