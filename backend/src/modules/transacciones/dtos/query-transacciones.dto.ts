import { IsInt, IsOptional, IsString, IsIn } from 'class-validator';
import { Type } from 'class-transformer';

export class QueryTransaccionesDto {
    @IsOptional()
    @IsString()
    desde?: string;

    @IsOptional()
    @IsString()
    hasta?: string;

    @IsOptional()
    @IsString()
    modulo?: string;

    @IsOptional()
    @IsString()
    entidad?: string;

    @IsOptional()
    @IsString()
    entidadId?: string;

    @IsOptional()
    @IsString()
    tipo?: string;

    @IsOptional()
    @IsString()
    severidad?: string;

    @IsOptional()
    @IsString()
    estado?: string;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    usuarioId?: number;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    empresaId?: number;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    deudorId?: number;

    @IsOptional()
    @IsString()
    q?: string;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    limit?: number;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    offset?: number;

    @IsOptional()
    @IsIn(['asc', 'desc'])
    orderDir?: 'asc' | 'desc';
}
