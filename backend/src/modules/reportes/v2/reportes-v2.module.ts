import { Module } from '@nestjs/common';
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

@Module({
  controllers: [ReportesV2Controller],
  providers: [
    ReportesV2Service,
    CatalogoService,
    QueryPlanner,
    ExecutorService,
    XlsxV2Exportador,
    CsvV2Exportador,
    TxtV2Exportador,
    PdfV2Exportador,
    PrismaService,
  ],
  exports: [ReportesV2Service],
})
export class ReportesV2Module {}
