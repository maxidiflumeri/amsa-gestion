// src/transacciones/dto/registrar-transaccion.dto.ts
import { IsInt, IsOptional, IsString, IsIP } from 'class-validator';

export class RegistrarTransaccionDto {
    @IsInt()
    usuarioId: number;

    @IsOptional()
    @IsInt()
    deudorId?: number;

    @IsString()
    entidad: string;

    @IsOptional()
    @IsString()
    entidadId?: string;

    @IsString()
    tipo: string;

    @IsOptional()
    @IsString()
    resumen?: string;

    @IsOptional()
    data?: any;

    @IsOptional()
    @IsString()
    @IsIP(4, { message: 'ip debe ser IPv4 válida' })
    ip?: string;

    @IsOptional()
    @IsString()
    userAgent?: string;
}