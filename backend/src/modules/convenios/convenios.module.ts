import { Module } from '@nestjs/common';
import { ConveniosController } from './convenios.controller';
import { ConveniosService } from './convenios.service';
import { PrismaService } from '../../prisma/prisma.service';

@Module({
  controllers: [ConveniosController],
  providers: [ConveniosService, PrismaService],
  exports: [ConveniosService],
})
export class ConveniosModule {}
