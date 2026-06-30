import { Module } from '@nestjs/common';
import { DeudoresService } from './deudores.service';
import { DeudoresController } from './deudores.controller';
import { TransaccionesModule } from '../transacciones/transacciones.module';
import { PrismaService } from 'src/prisma/prisma.service';
import { DeudorBloqueoService } from './utils/deudor-bloqueo';

@Module({
  imports: [TransaccionesModule],
  controllers: [DeudoresController],
  providers: [DeudoresService, DeudorBloqueoService, PrismaService],
  exports: [DeudoresService, DeudorBloqueoService],
})

export class DeudoresModule {}