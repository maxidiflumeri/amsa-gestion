import { Module } from '@nestjs/common';
import { TransaccionesService } from './transacciones.service';
import { TransaccionesController } from './transacciones.controller';
import { AuditoriaHelper } from './auditoria.helper';
import { PrismaService } from 'src/prisma/prisma.service';
import { ReportesModule } from '../reportes/reportes.module';

@Module({
  imports: [ReportesModule],
  controllers: [TransaccionesController],
  providers: [TransaccionesService, AuditoriaHelper, PrismaService],
  exports: [TransaccionesService, AuditoriaHelper],
})
export class TransaccionesModule {}
