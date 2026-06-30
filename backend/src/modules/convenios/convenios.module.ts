import { Module, forwardRef } from '@nestjs/common';
import { ConveniosController } from './convenios.controller';
import { ConveniosService } from './convenios.service';
import { PrismaService } from '../../prisma/prisma.service';
import { DeudoresModule } from '../deudores/deudores.module';

@Module({
  imports: [forwardRef(() => DeudoresModule)],
  controllers: [ConveniosController],
  providers: [ConveniosService, PrismaService],
  exports: [ConveniosService],
})
export class ConveniosModule {}
