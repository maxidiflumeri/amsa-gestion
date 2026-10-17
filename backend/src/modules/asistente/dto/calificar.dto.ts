import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class CalificarDto {
    /** 1 = 👍, -1 = 👎, 0 = quitar la calificación. */
    @IsIn([1, -1, 0])
    valor!: 1 | -1 | 0;

    @IsOptional()
    @IsString()
    @MaxLength(500)
    comentario?: string;
}
