import { Module, forwardRef } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { RealtimeGateway } from './realtime.gateway';
import { RealtimeService } from './realtime.service';
import { WsJwtGuard } from './guards/ws-jwt.guard';
import { PrismaModule } from 'src/prisma/prisma.module';
import { NotificacionesModule } from '../notificaciones/notificaciones.module';

@Module({
    imports: [
        JwtModule.register({
            secret: process.env.JWT_SECRET || 'fallback-secret-change-in-production',
        }),
        PrismaModule,
        forwardRef(() => NotificacionesModule),
    ],
    providers: [RealtimeGateway, RealtimeService, WsJwtGuard],
    exports: [RealtimeService],
})
export class RealtimeModule {}
