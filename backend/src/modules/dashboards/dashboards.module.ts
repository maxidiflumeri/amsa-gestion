import { Module } from '@nestjs/common';
import { DashboardsService } from './dashboards.service';
import { DashboardsController } from './dashboards.controller';
import { DashboardsExportService } from './dashboards-export.service';
import { PrismaService } from 'src/prisma/prisma.service';

@Module({
    controllers: [DashboardsController],
    providers: [DashboardsService, DashboardsExportService, PrismaService],
    exports: [DashboardsService],
})
export class DashboardsModule { }
