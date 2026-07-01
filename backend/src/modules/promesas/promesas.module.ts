import { Module, forwardRef } from '@nestjs/common';
import { PromesasController } from './promesas.controller';
import { PromesasService } from './promesas.service';
import { PromesasScheduler } from './promesas.scheduler';
import { DeudoresModule } from '../deudores/deudores.module';

@Module({
    imports: [forwardRef(() => DeudoresModule)],
    controllers: [PromesasController],
    providers: [PromesasService, PromesasScheduler],
    exports: [PromesasService],
})
export class PromesasModule {}
