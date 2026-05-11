import { IsArray, IsNotEmpty, IsString, ArrayUnique } from 'class-validator';

export class CreateRolDto {
    @IsString()
    @IsNotEmpty()
    nombre: string;

    @IsArray()
    @ArrayUnique()
    @IsString({ each: true })
    permisos: string[];
}
