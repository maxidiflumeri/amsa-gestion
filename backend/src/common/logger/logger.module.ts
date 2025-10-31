import { Module, Global } from '@nestjs/common';
import { LoggerService } from './logger.service';

@Global() // 👈 hace que esté disponible en todos los módulos sin importar
@Module({
    providers: [LoggerService],
    exports: [LoggerService],
})

export class LoggerModule { }