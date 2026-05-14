import {
    IsBoolean,
    IsEmail,
    IsInt,
    IsNotEmpty,
    IsOptional,
    IsPositive,
    IsString,
    Matches,
    ValidateIf,
    ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class AgenteConfigDto {
    @IsString()
    @IsNotEmpty()
    usuarioNeotel!: string;

    @IsString()
    @IsNotEmpty()
    claveNeotel!: string;

    @IsString()
    @IsNotEmpty()
    device!: string;

    @IsString()
    @IsNotEmpty()
    sipAuthUser!: string;

    @IsString()
    @IsNotEmpty()
    sipPassword!: string;

    @IsOptional()
    @IsString()
    sipDisplayName?: string;

    @IsOptional()
    @IsBoolean()
    habilitado?: boolean;
}

export class CreateUsuarioDto {
    @IsString()
    @IsNotEmpty()
    nombre!: string;

    @IsEmail()
    email!: string;

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
    @ValidateIf((o) => o.esAgente === true)
    @ValidateNested()
    @Type(() => AgenteConfigDto)
    agente?: AgenteConfigDto;
}
