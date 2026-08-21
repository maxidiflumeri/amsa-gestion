import { Module, forwardRef } from '@nestjs/common';
import { ConveniosController } from './convenios.controller';
import { ConveniosService } from './convenios.service';
import { ConveniosScheduler } from './convenios.scheduler';
import { PrismaService } from '../../prisma/prisma.service';
import { DeudoresModule } from '../deudores/deudores.module';
import { ConsolidacionModule } from '../consolidacion/consolidacion.module';

@Module({
  imports: [forwardRef(() => DeudoresModule), ConsolidacionModule],
  controllers: [ConveniosController],
  providers: [ConveniosService, PrismaService, ConveniosScheduler],
  exports: [ConveniosService],
})
export class ConveniosModule {}
