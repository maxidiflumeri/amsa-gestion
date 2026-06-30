import { Module } from '@nestjs/common';
import { ConsolidacionSituacionService } from './consolidacion.service';
import { PrismaService } from '../../prisma/prisma.service';
import { TransaccionesModule } from '../transacciones/transacciones.module';

/**
 * ConsolidacionModule
 *
 * Módulo independiente (no entra dentro de imports/) porque lo consumen
 * tres lugares distintos: processors de imports (Fase 3), controller REST (Fase 4)
 * y posible cron de backfill (Fase 6).
 *
 * Exporta ConsolidacionSituacionService para que Fases 3/4 lo inyecten.
 */
@Module({
    imports: [TransaccionesModule],
    providers: [ConsolidacionSituacionService, PrismaService],
    exports: [ConsolidacionSituacionService],
})
export class ConsolidacionModule {}
