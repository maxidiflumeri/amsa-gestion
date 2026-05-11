import { IsInt, IsOptional, IsString } from 'class-validator';

export class RegistrarTransaccionDto {
    @IsOptional()
    @IsInt()
    usuarioId?: number | null;

    @IsOptional()
    @IsInt()
    empresaId?: number | null;

    @IsString()
    modulo: string;

    @IsString()
    entidad: string;

    @IsOptional()
    @IsString()
    entidadId?: string;

    @IsString()
    tipo: string;

    @IsOptional()
    @IsString()
    severidad?: string;

    @IsOptional()
    @IsString()
    estado?: string;

    @IsOptional()
    @IsInt()
    deudorId?: number;

    @IsOptional()
    @IsString()
    recursoTexto?: string;

    @IsOptional()
    @IsString()
    resumen?: string;

    @IsOptional()
    data?: any;

    @IsOptional()
    @IsString()
    ip?: string;

    @IsOptional()
    @IsString()
    userAgent?: string;
}
