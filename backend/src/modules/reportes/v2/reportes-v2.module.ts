import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ScheduleModule } from '@nestjs/schedule';
import { ReportesV2Controller } from './reportes-v2.controller';
import { ReportesV2Service } from './reportes-v2.service';
import { CatalogoService } from './catalogo/catalogo.service';
import { QueryPlanner } from './planner/query-planner';
import { ExecutorService } from './executor/executor.service';
import { XlsxV2Exportador } from './exportadores/xlsx-v2.exportador';
import { CsvV2Exportador } from './exportadores/csv-v2.exportador';
import { TxtV2Exportador } from './exportadores/txt-v2.exportador';
import { PdfV2Exportador } from './exportadores/pdf-v2.exportador';
import { PrismaService } from '../../../prisma/prisma.service';
import { AsyncExecutorService } from './async/async-executor.service';
import { ReportesV2Processor } from './async/reportes-v2.processor';
import { REPORTES_V2_QUEUE_NAME } from './async/reportes-v2.queue';
import { ReportesStorageService } from './storage/reportes-storage.service';
import { ReportesV2Gateway } from './gateway/reportes-v2.gateway';
import { EjecucionesV2Service } from './ejecuciones/ejecuciones-v2.service';
import { EjecucionesV2CleanupService } from './ejecuciones/ejecuciones-v2.cleanup';

@Module({
  imports: [
    BullModule.registerQueue({
      name: REPORTES_V2_QUEUE_NAME,
    }),
    ScheduleModule.forRoot(),
  ],
  controllers: [ReportesV2Controller],
  providers: [
    ReportesV2Service,
    CatalogoService,
    QueryPlanner,
    ExecutorService,
    AsyncExecutorService,
    XlsxV2Exportador,
    CsvV2Exportador,
    TxtV2Exportador,
    PdfV2Exportador,
    PrismaService,
    ReportesV2Processor,
    ReportesStorageService,
    ReportesV2Gateway,
    EjecucionesV2Service,
    EjecucionesV2CleanupService,
  ],
  exports: [ReportesV2Service, EjecucionesV2Service],
})
export class ReportesV2Module {}
