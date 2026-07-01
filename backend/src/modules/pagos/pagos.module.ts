import { Module, forwardRef } from '@nestjs/common';
import { PagosController } from './pagos.controller';
import { PagosService } from './pagos.service';
import { DeudoresModule } from '../deudores/deudores.module';
import { ConsolidacionModule } from '../consolidacion/consolidacion.module';
import { PromesasModule } from '../promesas/promesas.module';

@Module({
    imports: [forwardRef(() => DeudoresModule), ConsolidacionModule, PromesasModule],
    controllers: [PagosController],
    providers: [PagosService],
    exports: [PagosService],
})
export class PagosModule {}
