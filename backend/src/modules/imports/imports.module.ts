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
import { ReaperCargasService } from './progreso/reaper-cargas.service';
import { ReaperCargasScheduler } from './progreso/reaper-cargas.scheduler';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'import-queue',
      // Un job que tira no se reintenta (es el default; queda escrito, §9.5.1).
      defaultJobOptions: { attempts: 1 },
    }),
    RealtimeModule,
    NotificacionesModule,
    TransaccionesModule,
    ConsolidacionModule,
    PromesasModule,
  ],
  controllers: [ImportController],
  providers: [ImportService, PrismaService, FileStorageService, ImportsProcessor, ReaperCargasService, ReaperCargasScheduler],
})
export class ImportModule {}
