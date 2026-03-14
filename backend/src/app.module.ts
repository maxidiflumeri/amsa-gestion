import { Module } from '@nestjs/common';
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

@Module({
  imports: [
    LoggerModule,
    PrismaModule,
    BullModule.forRoot({
      connection: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379', 10),
      },
    }),
    DeudoresModule,
    ParametrosModule,
    TransaccionesModule,
    ContactosModule,
    ComentariosModule,
    ImportModule,
    EmpresasModule
  ],

  controllers: [AppController],
  providers: [AppService]
})

export class AppModule {}
