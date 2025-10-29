import { Module } from '@nestjs/common';
import { DeudoresService } from './deudores.service';
import { DeudoresController } from './deudores.controller';

@Module({
  providers: [DeudoresService],
  controllers: [DeudoresController]
})
export class DeudoresModule {}
