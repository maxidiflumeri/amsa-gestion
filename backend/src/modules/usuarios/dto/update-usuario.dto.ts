import {
    IsBoolean,
    IsInt,
    IsNotEmpty,
    IsOptional,
    IsPositive,
    IsString,
    Matches,
    ValidateNested,
    ValidateIf,
    IsEmail,
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

    /**
     * `undefined` conserva el DNI; `null` o `''` lo borran.
     *
     * El `@Matches` se salta cuando viene vacío para que borrarlo sea posible: la validación de
     * formato aplica solo cuando hay algo que validar.
     */
    @IsOptional()
    @ValidateIf((_o, v) => v !== null && v !== '')
    @IsString()
    @Matches(/^\d{7,8}$|^\d{2}-?\d{8}-?\d$/, {
        message: 'Debe ser DNI (7-8 dígitos) o CUIL (11 dígitos)',
    })
    dni?: string | null;

    /**
     * El email es la credencial de login, así que un error de tipeo en el alta deja a la persona
     * afuera. Se puede corregir; la unicidad la verifica la base.
     */
    @IsOptional()
    @IsEmail({}, { message: 'El email no tiene un formato válido' })
    email?: string;

    @IsOptional()
    @IsBoolean()
    esAgente?: boolean;

    @IsOptional()
    @ValidateNested()
    @Type(() => AgenteUpdateDto)
    agente?: AgenteUpdateDto;
}
