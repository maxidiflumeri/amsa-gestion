import {
    IsBoolean,
    IsInt,
    IsNotEmpty,
    IsOptional,
    IsPositive,
    IsString,
    Matches,
    ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class AgenteUpdateDto {
    @IsOptional()
    @IsString()
    @IsNotEmpty()
    usuarioNeotel?: string;

    /** Si se envía y no está vacío, se recifra. Si está vacío/undefined, se preserva el actual. */
    @IsOptional()
    @IsString()
    claveNeotel?: string;

    @IsOptional()
    @IsString()
    @IsNotEmpty()
    device?: string;

    @IsOptional()
    @IsString()
    @IsNotEmpty()
    sipAuthUser?: string;

    /** Si se envía y no está vacío, se recifra. Si está vacío/undefined, se preserva el actual. */
    @IsOptional()
    @IsString()
    sipPassword?: string;

    @IsOptional()
    @IsString()
    sipDisplayName?: string;

    @IsOptional()
    @IsBoolean()
    habilitado?: boolean;
}

export class UpdateUsuarioDto {
    @IsOptional()
    @IsString()
    @IsNotEmpty()
    nombre?: string;

    @IsOptional()
    @IsInt()
    @IsPositive()
    rolId?: number;

    @IsOptional()
    @IsBoolean()
    activo?: boolean;

    @IsOptional()
    @IsString()
    legajo?: string;

    @IsOptional()
    @IsString()
    @Matches(/^\d{7,8}$|^\d{2}-?\d{8}-?\d$/, {
        message: 'Debe ser DNI (7-8 dígitos) o CUIL (11 dígitos)',
    })
    dni?: string;

    @IsOptional()
    @IsBoolean()
    esAgente?: boolean;

    @IsOptional()
    @ValidateNested()
    @Type(() => AgenteUpdateDto)
    agente?: AgenteUpdateDto;
}
