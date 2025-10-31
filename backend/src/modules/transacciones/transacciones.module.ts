import { Module } from '@nestjs/common';
import { TransaccionesService } from './transacciones.service';
import { TransaccionesController } from './transacciones.controller';
import { PrismaService } from 'src/prisma/prisma.service';

@Module({
  controllers: [TransaccionesController],
  providers: [TransaccionesService, PrismaService],
  exports: [TransaccionesService],
})
export class TransaccionesModule {}
