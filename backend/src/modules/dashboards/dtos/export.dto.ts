import { IsIn, IsOptional, IsString } from 'class-validator';
import { SnapshotDto } from './snapshot.dto';

export type FormatoExportDashboard = 'xlsx' | 'pdf';

export class ExportDashboardDto extends SnapshotDto {
    @IsIn(['xlsx', 'pdf'])
    formato!: FormatoExportDashboard;

    @IsOptional()
    @IsString()
    nombreTablero?: string;
}
