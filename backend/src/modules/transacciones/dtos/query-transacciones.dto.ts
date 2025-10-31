// src/transacciones/dto/query-transacciones.dto.ts
import { IsInt, IsOptional, IsString } from 'class-validator';
import { Type } from 'class-transformer';

export class QueryTransaccionesDto {
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    deudorId?: number;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    usuarioId?: number;

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
    @Type(() => Number)
    @IsInt()
    limit?: number;

    @IsOptional()
    @Type(() => Number)
    @IsInt()
    offset?: number;
}