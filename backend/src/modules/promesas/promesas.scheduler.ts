import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PromesasService } from './promesas.service';

/**
 * Revisa diariamente las promesas de pago vencidas (docs/pagos-promesas-spec.md §5.4).
 * Detecta por los registros de `promesa_pago` (no por código). El guard de concurrencia
 * vive en PromesasService.procesarVencidas (evita solaparse con el endpoint manual).
 */
@Injectable()
export class PromesasScheduler {
    private readonly logger = new Logger(PromesasScheduler.name);

    constructor(private readonly promesas: PromesasService) {}

    @Cron(CronExpression.EVERY_DAY_AT_2AM)
    async revisarVencidas(): Promise<void> {
        try {
            await this.promesas.procesarVencidas();
        } catch (e: any) {
            this.logger.error(`Error en cron de promesas vencidas: ${e?.message}`, e?.stack);
        }
    }
}
