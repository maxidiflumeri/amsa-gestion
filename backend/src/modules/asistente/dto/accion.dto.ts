import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';

export class AccionDto {
    @IsString()
    @MinLength(1)
    @MaxLength(100)
    accionId!: string;

    @IsIn(['aceptada', 'rechazada'])
    resultado!: 'aceptada' | 'rechazada';
}
