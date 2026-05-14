import { Module } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { NeotelModule } from '../neotel/neotel.module';
import { UsuariosController } from './usuarios.controller';
import { UsuariosService } from './usuarios.service';

@Module({
    imports: [NeotelModule],
    controllers: [UsuariosController],
    providers: [UsuariosService, PrismaService],
    exports: [UsuariosService],
})
export class UsuariosModule {}
