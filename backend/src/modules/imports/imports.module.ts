// src/import/import.module.ts
import { Module } from '@nestjs/common';
import { FileStorageService } from './file-storage.service';
import { ImportController } from './imports.controller';
import { ImportService } from './imports.service';
import { PrismaService } from 'src/prisma/prisma.service';

@Module({
  controllers: [ImportController],
  providers: [ImportService, PrismaService, FileStorageService],
})

export class ImportModule {}