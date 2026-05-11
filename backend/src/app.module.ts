import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DeudoresModule } from './modules/deudores/deudores.module';
import { PrismaModule } from './prisma/prisma.module';
import { ParametrosModule } from './modules/parametros/parametros.module';
import { TransaccionesModule } from './modules/transacciones/transacciones.module';
import { ContactosModule } from './modules/contactos/contactos.module';
import { ComentariosModule } from './modules/comentarios/comentarios.module';
import { LoggerModule } from './common/logger/logger.module';
import { ImportModule } from './modules/imports/imports.module';
import { EmpresasModule } from './modules/empresas/empresas.module';
import { PoliticasModule } from './modules/politicas/politicas.module';
import { ConveniosModule } from './modules/convenios/convenios.module';
import { ReportesModule } from './modules/reportes/reportes.module';
import { AuthModule } from './auth/auth.module';
import { RolesModule } from './modules/roles/roles.module';
import { UsuariosModule } from './modules/usuarios/usuarios.module';
import { RealtimeModule } from './modules/realtime/realtime.module';
import { NotificacionesModule } from './modules/notificaciones/notificaciones.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    LoggerModule,
    PrismaModule,
    BullModule.forRoot({
      connection: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379', 10),
      },
    }),
    AuthModule,
    RolesModule,
    UsuariosModule,
    DeudoresModule,
    ParametrosModule,
    TransaccionesModule,
    ContactosModule,
    ComentariosModule,
    ImportModule,
    EmpresasModule,
    PoliticasModule,
    ConveniosModule,
    ReportesModule,
    RealtimeModule,
    NotificacionesModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
