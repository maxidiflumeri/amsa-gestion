import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { APP_GUARD } from '@nestjs/core';
import type { StringValue } from 'ms';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtAuthGuard } from './jwt-auth.guard';
import { PermisosGuard } from './permisos.guard';
import { TransaccionesModule } from '../modules/transacciones/transacciones.module';

@Module({
    imports: [
        JwtModule.register({
            secret: process.env.JWT_SECRET || 'fallback-secret-change-in-production',
            signOptions: {
                expiresIn: (process.env.JWT_EXPIRES_IN || '1d') as StringValue,
            },
        }),
        TransaccionesModule,
    ],
    controllers: [AuthController],
    providers: [
        AuthService,
        {
            provide: APP_GUARD,
            useClass: JwtAuthGuard,
        },
        {
            provide: APP_GUARD,
            useClass: PermisosGuard,
        },
    ],
    exports: [AuthService, JwtModule],
})
export class AuthModule {}
