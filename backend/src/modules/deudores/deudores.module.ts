import { Module } from '@nestjs/common';
import { DeudoresService } from './deudores.service';
import { DeudoresController } from './deudores.controller';
import { TransaccionesModule } from '../transacciones/transacciones.module';
import { PrismaService } from 'src/prisma/prisma.service';

@Module({
  imports: [TransaccionesModule],
  controllers: [DeudoresController],
  providers: [DeudoresService, PrismaService],
  exports: [DeudoresService],
})

export class DeudoresModule {}