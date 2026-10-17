import { Transform, Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class PreguntarDto {
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    conversacionId?: number;

    @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
    @IsString()
    @MinLength(1, { message: 'Escribí tu pregunta.' })
    @MaxLength(2000, { message: 'La pregunta puede tener hasta 2000 caracteres.' })
    pregunta!: string;

    @IsString()
    @MaxLength(200)
    @Matches(/^\//, { message: 'La ruta tiene que empezar con "/".' })
    ruta!: string;
}
