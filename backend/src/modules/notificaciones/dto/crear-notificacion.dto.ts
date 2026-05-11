import { EntidadTipo, TipoNotificacion } from '@prisma/client';
import { IsEnum, IsInt, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

export class CrearNotificacionDto {
    @IsEnum(TipoNotificacion)
    tipo: TipoNotificacion;

    @IsOptional()
    @IsEnum(EntidadTipo)
    entidadTipo?: EntidadTipo;

    @IsOptional()
    @IsInt()
    entidadId?: number;

    @IsString()
    @MaxLength(200)
    titulo: string;

    @IsString()
    @MaxLength(1000)
    mensaje: string;

    @IsOptional()
    @IsObject()
    payload?: Record<string, unknown>;

    @IsOptional()
    @IsString()
    @MaxLength(500)
    rutaAccion?: string;

    @IsInt()
    destinatarioPrincipalId: number;

    @IsOptional()
    @IsString()
    incluirUsuariosConPermiso?: string;
}
