import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

export class ConversacionesQueryDto {
    @IsOptional()
    @Type(() => Number)
    @IsInt()
    @Min(1)
    @Max(50)
    limite?: number;

    /** Fase B. Sin esto, las de todas las funciones. */
    @IsOptional()
    @IsIn(['ayuda', 'reportes'])
    funcion?: 'ayuda' | 'reportes';
}

export class EstadoQueryDto {
    @IsOptional()
    @IsIn(['ayuda', 'reportes'], { message: 'La función no existe.' })
    funcion?: 'ayuda' | 'reportes';
}
