// src/import/import.module.ts
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { FileStorageService } from './file-storage.service';
import { ImportController } from './imports.controller';
import { ImportService } from './imports.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { ImportsProcessor } from './bullmq/imports.processor';
import { RealtimeModule } from '../realtime/realtime.module';
import { NotificacionesModule } from '../notificaciones/notificaciones.module';
import { TransaccionesModule } from '../transacciones/transacciones.module';
import { ConsolidacionModule } from '../consolidacion/consolidacion.module';
import { PromesasModule } from '../promesas/promesas.module';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'import-queue',
    }),
    RealtimeModule,
    NotificacionesModule,
    TransaccionesModule,
    ConsolidacionModule,
    PromesasModule,
  ],
  controllers: [ImportController],
  providers: [ImportService, PrismaService, FileStorageService, ImportsProcessor],
})
export class ImportModule {}
