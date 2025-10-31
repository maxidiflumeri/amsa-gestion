import { Module } from '@nestjs/common';
import { ComentariosService } from './comentarios.service';
import { TransaccionesModule } from '../transacciones/transacciones.module';
import { ComentariosController } from './comentarios.controller';
import { PrismaService } from 'src/prisma/prisma.service';

@Module({
  imports: [TransaccionesModule],
  controllers: [ComentariosController],
  providers: [ComentariosService, PrismaService],
})

export class ComentariosModule {}