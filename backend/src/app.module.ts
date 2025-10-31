import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DeudoresModule } from './modules/deudores/deudores.module';
import { PrismaModule } from './prisma/prisma.module';
import { ParametrosModule } from './modules/parametros/parametros.module';
import { TransaccionesModule } from './modules/transacciones/transacciones.module';
import { ContactosModule } from './modules/contactos/contactos.module';
import { ComentariosModule } from './modules/comentarios/comentarios.module';

@Module({
  imports: [PrismaModule, DeudoresModule, ParametrosModule, TransaccionesModule, ContactosModule, ComentariosModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
