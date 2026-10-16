import { Module, forwardRef } from '@nestjs/common';
import { NotificacionesController } from './notificaciones.controller';
import { NotificacionesService } from './notificaciones.service';
import { NotificacionesLimpiezaService } from './notificaciones-limpieza.service';
import { PrismaModule } from 'src/prisma/prisma.module';
import { RealtimeModule } from '../realtime/realtime.module';

@Module({
    imports: [
        PrismaModule,
        forwardRef(() => RealtimeModule),
    ],
    controllers: [NotificacionesController],
    providers: [NotificacionesService, NotificacionesLimpiezaService],
    exports: [NotificacionesService],
})
export class NotificacionesModule {}
