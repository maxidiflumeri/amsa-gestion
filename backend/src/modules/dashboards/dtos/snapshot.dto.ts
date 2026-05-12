import { IsArray, IsInt, IsISO8601, IsOptional, IsString } from 'class-validator';
import { Type } from 'class-transformer';

export class SnapshotDto {
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    empresaId?: number;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    remesaId?: number;

    @IsISO8601()
    desde!: string;

    @IsISO8601()
    hasta!: string;

    @IsOptional()
    @IsArray()
    @Type(() => Number)
    @IsInt({ each: true })
    situacionIds?: number[];

    @IsOptional()
    @IsArray()
    @Type(() => Number)
    @IsInt({ each: true })
    gestionIds?: number[];

    @IsOptional()
    @IsArray()
    @Type(() => Number)
    @IsInt({ each: true })
    motivoIds?: number[];

    @IsOptional()
    @IsString()
    granularidad?: 'dia' | 'semana' | 'mes';
}
