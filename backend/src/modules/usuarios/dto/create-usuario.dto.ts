import { IsBoolean, IsEmail, IsInt, IsNotEmpty, IsOptional, IsPositive, IsString } from 'class-validator';

export class CreateUsuarioDto {
    @IsString()
    @IsNotEmpty()
    nombre: string;

    @IsEmail()
    email: string;

    @IsOptional()
    @IsInt()
    @IsPositive()
    rolId?: number;

    @IsOptional()
    @IsBoolean()
    activo?: boolean;
}
