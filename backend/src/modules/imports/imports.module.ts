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
import { ReversionAccionesService } from './reversion/reversion-acciones.service';
import { ReversionAccionesProcessor } from './bullmq/reversion-acciones.processor';
import { COLA_REVERSION } from './reversion/reversion-accion.reglas';

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'import-queue',
      // Un job que tira no se reintenta (es el default; queda escrito, §9.5.1).
      defaultJobOptions: { attempts: 1 },
    }),
    // Cola propia de las reversiones de acciones masivas (C3b): no espera detrás de una carga.
    BullModule.registerQueue({
      name: COLA_REVERSION,
      defaultJobOptions: { attempts: 1 },
    }),
    RealtimeModule,
    NotificacionesModule,
    TransaccionesModule,
    ConsolidacionModule,
    PromesasModule,
  ],
  controllers: [ImportController],
  providers: [ImportService, PrismaService, FileStorageService, ImportsProcessor, ReaperCargasService, ReaperCargasScheduler, ReversionAccionesService, ReversionAccionesProcessor],
})
export class ImportModule {}
