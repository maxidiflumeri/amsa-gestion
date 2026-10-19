import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

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

    /** Fase B. Sin esto rige la función de la conversación y, en una nueva, `ayuda`. */
    @IsOptional()
    @IsIn(['ayuda', 'reportes'])
    funcion?: 'ayuda' | 'reportes';

    /** Fase B: los archivos de ejemplo (ids de `POST /asistente/adjuntos`) que se mandan con este mensaje. */
    @IsOptional()
    @IsArray()
    @ArrayMaxSize(3)
    @IsInt({ each: true })
    adjuntos?: number[];
}
