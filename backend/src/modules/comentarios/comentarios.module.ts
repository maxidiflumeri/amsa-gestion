import { Module, forwardRef } from '@nestjs/common';
import { ComentariosService } from './comentarios.service';
import { TransaccionesModule } from '../transacciones/transacciones.module';
import { ComentariosController } from './comentarios.controller';
import { PrismaService } from 'src/prisma/prisma.service';
import { DeudoresModule } from '../deudores/deudores.module';

@Module({
  imports: [TransaccionesModule, forwardRef(() => DeudoresModule)],
  controllers: [ComentariosController],
  providers: [ComentariosService, PrismaService],
})

export class ComentariosModule {}