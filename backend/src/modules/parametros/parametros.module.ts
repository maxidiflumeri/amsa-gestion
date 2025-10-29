import { Module } from '@nestjs/common';
import { ParametrosService } from './parametros.service';
import { ParametrosController } from './parametros.controller';

@Module({
  providers: [ParametrosService],
  controllers: [ParametrosController]
})
export class ParametrosModule {}
