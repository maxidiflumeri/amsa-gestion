import { Module } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthModule } from '../../auth/auth.module';
import { NeotelModule } from '../neotel/neotel.module';
import { UsuariosController } from './usuarios.controller';
import { UsuariosService } from './usuarios.service';

@Module({
    imports: [NeotelModule, AuthModule],
    controllers: [UsuariosController],
    providers: [UsuariosService, PrismaService],
    exports: [UsuariosService],
})
export class UsuariosModule {}
