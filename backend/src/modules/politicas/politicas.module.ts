import { Module } from '@nestjs/common';
import { PoliticasController } from './politicas.controller';
import { PoliticasService } from './politicas.service';
import { PrismaService } from '../../prisma/prisma.service';

@Module({
  controllers: [PoliticasController],
  providers: [PoliticasService, PrismaService],
  exports: [PoliticasService],
})
export class PoliticasModule {}
