import { Module, forwardRef } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';
import { ConsolidacionSituacionService } from './consolidacion.service';
import { ConsolidacionController } from './consolidacion.controller';
import { ConsolidacionProcessor } from './bullmq/consolidacion.processor';
import { ConsolidacionRedisLockService } from './consolidacion-redis-lock.service';
import { PrismaService } from '../../prisma/prisma.service';
import { TransaccionesModule } from '../transacciones/transacciones.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { NotificacionesModule } from '../notificaciones/notificaciones.module';

/**
 * ConsolidacionModule
 *
 * Módulo independiente (no entra dentro de imports/) porque lo consumen
 * tres lugares distintos: processors de imports (Fase 3), controller REST (Fase 4)
 * y posible cron de backfill (Fase 6).
 *
 * Fase 4 agrega:
 *  - BullModule.registerQueue('consolidacion-queue')
 *  - ConsolidacionProcessor (worker)
 *  - ConsolidacionController (endpoints REST)
 *  - ConsolidacionRedisLockService (lock distribuido)
 *
 * Dependencias externas:
 *  - RealtimeModule → RealtimeService (sockets)
 *  - NotificacionesModule → NotificacionesService (notificaciones persistentes)
 *  - TransaccionesModule → AuditoriaHelper (auditoría best-effort)
 *  - RequestContextService → global (@Global en RequestContextModule, no requiere import)
 *
 * forwardRef en RealtimeModule y NotificacionesModule por la dependencia circular
 * que ya existe entre ambos módulos (ver sus propios forwardRef).
 */
@Module({
    imports: [
        ConfigModule,
        BullModule.registerQueue({ name: 'consolidacion-queue' }),
        TransaccionesModule,
        forwardRef(() => RealtimeModule),
        forwardRef(() => NotificacionesModule),
    ],
    controllers: [ConsolidacionController],
    providers: [
        ConsolidacionSituacionService,
        ConsolidacionProcessor,
        ConsolidacionRedisLockService,
        PrismaService,
    ],
    exports: [ConsolidacionSituacionService],
})
export class ConsolidacionModule {}
