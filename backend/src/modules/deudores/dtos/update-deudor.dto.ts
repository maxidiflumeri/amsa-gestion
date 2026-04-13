import { IsOptional } from 'class-validator';

export class UpdateDeudorDto {
    @IsOptional()
    estadoSituacionClave?: string;

    @IsOptional()
    estadoGestionClave?: string;

    @IsOptional()
    motivoNoPagoClave?: string;
}