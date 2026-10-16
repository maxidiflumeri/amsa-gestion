import { Module } from '@nestjs/common';
import { InicioController } from './inicio.controller';
import { InicioService } from './inicio.service';

@Module({
    controllers: [InicioController],
    providers: [InicioService],
})
export class InicioModule {}
