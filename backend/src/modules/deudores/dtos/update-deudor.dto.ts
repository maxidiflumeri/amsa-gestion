import { IsInt, IsOptional } from 'class-validator';

export class UpdateDeudorDto {
    @IsOptional()
    @IsInt()
    estadoSituacionId?: number;

    @IsOptional()
    @IsInt()
    estadoGestionId?: number;
}