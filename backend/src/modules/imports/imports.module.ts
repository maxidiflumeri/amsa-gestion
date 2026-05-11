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

@Module({
  imports: [
    BullModule.registerQueue({
      name: 'import-queue',
    }),
    RealtimeModule,
    NotificacionesModule,
  ],
  controllers: [ImportController],
  providers: [ImportService, PrismaService, FileStorageService, ImportsProcessor],
})
export class ImportModule {}