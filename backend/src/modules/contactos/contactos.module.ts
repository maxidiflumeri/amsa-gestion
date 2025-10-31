import { Module } from '@nestjs/common';
import { ContactosService } from './contactos.service';
import { ContactosController } from './contactos.controller';
import { TransaccionesModule } from '../transacciones/transacciones.module';
import { PrismaService } from 'src/prisma/prisma.service';

@Module({
  imports: [TransaccionesModule],
  controllers: [ContactosController],
  providers: [ContactosService, PrismaService],
})
export class ContactosModule {}
