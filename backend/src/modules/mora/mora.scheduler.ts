import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../prisma/prisma.service';
import { MoraService } from './mora.service';
import { TIPO_DEUDA_ACTUALIZADA } from './mora.constants';

/**
 * Recalcula la deuda actualizada de las carteras con régimen de recargos, una vez por día.
 *
 * Antes **no había ningún proceso que lo hiciera**: el recálculo dependía de que alguien apretara el
 * botón en Ajustes → Recargo por mora. Como la ficha marca en naranja la fecha de cálculo a partir de
 * las 48 horas, el indicador quedaba encendido de forma permanente y dejaba de informar nada.
 *
 * Corre a las 4 AM, después de los crons de promesas (2) y de cuotas (3), para no competir por la
 * base: el recálculo es un UPDATE ... JOIN sobre toda la cartera.
 *
 * Una empresa sin el índice del día **se saltea con un aviso**, no rompe: es el caso normal del día 1
 * de cada mes, antes de que llegue el mail con la tasa.
 */
@Injectable()
export class MoraScheduler {
    private readonly logger = new Logger(MoraScheduler.name);

    constructor(
        private readonly prisma: PrismaService,
        private readonly mora: MoraService,
    ) {}

    @Cron(CronExpression.EVERY_DAY_AT_4AM)
    async recalcularCarteras(): Promise<void> {
        // Solo las que tienen índice cargado: el resto no tiene régimen de recargos.
        const conIndice = await this.prisma.indice_mora.groupBy({
            by: ['empresaId'],
            where: { tipo: TIPO_DEUDA_ACTUALIZADA },
            _count: { _all: true },
        });

        if (conIndice.length === 0) return;

        for (const { empresaId } of conIndice) {
            try {
                const r = await this.mora.recalcularCartera(empresaId);
                this.logger.log(
                    `Recálculo diario empresaId=${empresaId}: ${r.deudoresActualizados} caso(s) en ${r.durationMs}ms`,
                );
            } catch (e: any) {
                // Lo más común y esperable: todavía no se cargó la tasa del mes.
                this.logger.warn(`Recálculo diario omitido para empresaId=${empresaId}: ${e?.message}`);
            }
        }
    }
}
