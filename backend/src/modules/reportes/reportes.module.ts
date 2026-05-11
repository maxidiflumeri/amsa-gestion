import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ScheduleModule } from '@nestjs/schedule';
import { ReportesController } from './reportes.controller';
import { ReportesService } from './reportes.service';
import { CatalogoService } from './catalogo/catalogo.service';
import { QueryPlanner } from './planner/query-planner';
import { ExecutorService } from './executor/executor.service';
import { XlsxExportador } from './exportadores/xlsx.exportador';
import { CsvExportador } from './exportadores/csv.exportador';
import { TxtExportador } from './exportadores/txt.exportador';
import { PdfExportador } from './exportadores/pdf.exportador';
import { PrismaService } from '../../prisma/prisma.service';
import { AsyncExecutorService } from './async/async-executor.service';
import { ReportesProcessor } from './async/reportes.processor';
import { REPORTES_QUEUE_NAME } from './async/reportes.queue';
import { ReportesStorageService } from './storage/reportes-storage.service';
import { ReportesGateway } from './gateway/reportes.gateway';
import { EjecucionesService } from './ejecuciones/ejecuciones.service';
import { EjecucionesCleanupService } from './ejecuciones/ejecuciones.cleanup';

@Module({
  imports: [
    BullModule.registerQueue({
      name: REPORTES_QUEUE_NAME,
    }),
    ScheduleModule.forRoot(),
  ],
  controllers: [ReportesController],
  providers: [
    ReportesService,
    CatalogoService,
    QueryPlanner,
    ExecutorService,
    AsyncExecutorService,
    XlsxExportador,
    CsvExportador,
    TxtExportador,
    PdfExportador,
    PrismaService,
    ReportesProcessor,
    ReportesStorageService,
    ReportesGateway,
    EjecucionesService,
    EjecucionesCleanupService,
  ],
  exports: [ReportesService, EjecucionesService],
})
export class ReportesModule {}
