import { Module } from '@nestjs/common';
import { ReportesController } from './reportes.controller';
import { ReportesService } from './reportes.service';
import { EjecutorService } from './ejecutor/ejecutor.service';
import { DeudoresFuente } from './ejecutor/fuentes/deudores.fuente';
import { ExcelExportador } from './ejecutor/exportadores/excel.exportador';
import { CsvExportador } from './ejecutor/exportadores/csv.exportador';
import { PdfExportador } from './ejecutor/exportadores/pdf.exportador';
import { PrismaModule } from 'src/prisma/prisma.module';

import { GenericaFuente } from './ejecutor/fuentes/generica.fuente';

@Module({
  imports: [PrismaModule],
  controllers: [ReportesController],
  providers: [ReportesService, EjecutorService, DeudoresFuente, GenericaFuente, ExcelExportador, CsvExportador, PdfExportador],
})
export class ReportesModule {}
