import { IsIn, IsInt, IsOptional, IsString } from 'class-validator';
import { Type } from 'class-transformer';
import { SnapshotDto } from './snapshot.dto';

export type DimensionDrillDown = 'situacion' | 'gestion' | 'motivo' | 'mora' | 'deuda';

export class DrillDownDto extends SnapshotDto {
    @IsIn(['situacion', 'gestion', 'motivo', 'mora', 'deuda'])
    dimension!: DimensionDrillDown;

    /**
     * Para 'situacion', 'gestion', 'motivo' = id del parametro (o 'null' string para "sin asignar").
     * Para 'mora', 'deuda' = string del bucket (ej. '0-30', '$10k-50k').
     */
    @IsString()
    valor!: string;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    page?: number;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    pageSize?: number;
}
